# Push notifications — the pipe

**COMPLIANCE REVIEW REQUIRED** (CLAUDE.md §7) — credit-repair messaging. The gate in
`src/push/payload.mjs` decides what words can reach a client's phone.

What this is: a client can add the portal to their phone's home screen, turn on
notifications, and a message we send arrives on that phone and opens the portal.

What this is **not**: any message. Nothing sends a notification today. No nudge, no
payment alert, no reminder. The pipe is built and the taps are not connected — see
**Wiring it to something** at the bottom.

## Native Fundhub iPhone app (built in source; not live)

The native app has a separate APNs pipe. Its client Home card checks `/api/push/native-device`
before asking iOS for permission, then registers the iPhone's APNs token under the signed-in
client's account session. Tokens are encrypted in `client_apns_devices`; the server refuses to
send to a revoked, expired, or wrong-client session. Turning the card off sends an idempotent
DELETE. Native sign-out tries the same DELETE and server logout, then clears local sign-in even
if the phone is offline. If both server requests fail, the old server session may remain live
until expiry; the app says so. A later sign-in on the same installation retires the old row.

`src/push/apns.mjs` can transmit the existing approved lock-screen payloads through Apple;
`src/push/native-send.mjs` fans out to eligible devices. **No workflow calls it yet.** Booking
messages pass through opt-out, quiet-hour, company-pause, cap, and compliance gates in the
message dispatcher. Adding a push beside those sends without the same gates would be a new
outbound path and is not done here. No alert has been delivered on a real iPhone.

APNs needs the `ai.fundhub.app` App ID's Push Notifications capability, a matching provisioning
profile, and `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY_BASE64` in the Netlify environment;
it reuses `PUSH_SUB_ENC_KEY` for encrypted device storage. Debug uses the development APNs
entitlement and sandbox host; Release uses a separate production entitlement and production host.
The signed archive's `aps-environment` still needs to be checked before TestFlight distribution.
Once those pieces are in place and a client opts in on a real iPhone,
`node scripts/push/send-test-native.mjs --client <uuid>` reports eligible devices without
sending. Adding `--send` deliberately transmits only the approved generic test body.

---

## The state a device moves through

```mermaid
flowchart TD
    START([Client opens the portal on a phone]) --> SIGNED{Signed in?}
    SIGNED -->|No| NOTHING[No card shown. Nothing registered.]
    SIGNED -->|Yes| KILL{URL has ?push=off}
    KILL -->|Yes| TEARDOWN[Every service worker removed<br/>and every cache emptied on this device]
    KILL -->|No| IOS{iPhone or iPad?}

    IOS -->|Yes| IOSVER{iOS 16.4 or newer?<br/>Checked FIRST, installed or not}
    IOSVER -->|No| TOOOLD[Card says: this phone needs iOS 16.4 or newer.<br/>No steps, no button. Nobody below 16.4 is<br/>ever sent to add it to the home screen.]
    IOSVER -->|Yes, and not on the home screen| ADDHOME[Card shows the three add-to-home-screen steps.<br/>NO button — asking Safari for permission here throws.]
    ADDHOME -.client adds it and reopens.-> SUPPORT

    IOSVER -->|Yes, and on the home screen| SUPPORT
    IOS -->|No| SUPPORT{Browser supports<br/>service workers + push?}
    SUPPORT -->|No, on an iPhone| IOSDEAD[Card says this iPhone cannot show them yet<br/>and what it would need. Never a blank space.]
    SUPPORT -->|No, anywhere else| HIDDEN[Card stays hidden. Nothing the person can do.]
    SUPPORT -->|Yes| REG[Service worker registered<br/>scope = /app/client-portal.html only]

    REG --> PERM{Notification permission}
    PERM -->|denied| BLOCKED[Card says notifications are blocked<br/>and where to unblock them. No button.]
    PERM -->|granted, subscription exists| ON[Card says notifications are on.<br/>Button reads Turn notifications off.]
    PERM -->|default| OFFER[Button reads Turn on notifications]

    OFFER --> TAP([Client taps the button])
    TAP --> KEYCHECK[GET /api/push/key]
    KEYCHECK --> CONFIGURED{VAPID key AND storage key<br/>both set on the server?}
    CONFIGURED -->|No| NOTREADY[Card says notifications are not switched on<br/>for this site yet. The permission prompt is NOT spent.]
    CONFIGURED -->|Yes| ASK[Browser shows the permission prompt<br/>— once, ever]

    ASK --> ANSWER{Client's answer}
    ANSWER -->|Refused| REFUSED[Card says the browser will not ask again.<br/>Permanent from our side.]
    ANSWER -->|Allowed| SUBSCRIBE[Browser mints a subscription:<br/>endpoint + two keys]
    SUBSCRIBE --> POST[POST /api/push/subscribe]

    POST --> STORE{Stored?}
    STORE -->|No| ROLLBACK[Browser subscription undone,<br/>so the two sides cannot disagree]
    STORE -->|Yes, new device| LIVE[(Row live<br/>expired_at NULL, revoked_at NULL)]
    STORE -->|Yes, device already known| LIVE

    LIVE --> OFFTAP([Client taps Turn notifications off])
    OFFTAP --> REVOKED[(revoked_at stamped.<br/>Row kept — 'they asked us to stop')]

    LIVE --> SEND([Something calls sendToClient])
    SEND --> GATE{Is the body one of the approved ones?<br/>A whitelist — free text is not a body}
    GATE -->|No| REFUSEDBODY[Refused before the network.<br/>Permanent — a retry refuses it again.]
    GATE -->|Yes| ENCRYPT[Encrypted for this device<br/>RFC 8291 aes128gcm]
    ENCRYPT --> PUSHSVC[POST to the push service<br/>signed with our VAPID key]

    PUSHSVC --> RESULT{Push service answered}
    RESULT -->|201| SENT[last_success_at stamped<br/>failure_count reset to 0]
    RESULT -->|404 or 410| EXPIRED[(expired_at stamped.<br/>Never retried. Different fact from revoked.)]
    RESULT -->|429 / 5xx / timeout| FAILED[failure_count + 1. Row kept.<br/>Retryable.]
    RESULT -->|400 / 413| BADMSG[Rejected. Not retried.]

    SENT --> PHONE([Banner on the lock screen])
    PHONE --> CLICK([Client taps it])
    CLICK --> OPEN[Portal opens at the path in the payload<br/>same-origin only]

    LIVE --> NONE([sendToClient with no live row])
    NONE --> NOSUB[Answers no_subscription_on_file.<br/>Not an error — most clients have no phone registered.]
```

---

## What is actually built

| Piece | File |
|---|---|
| The table | `db/migrations/352_client_push_subscriptions.sql` |
| Encryption at rest | `src/push/store.mjs` (same shape as `src/banking/plaid.mjs`) |
| Encryption in transit + VAPID | `src/push/crypto.mjs`, proven in `src/push/crypto.test.mjs` |
| What a notification may say | `src/push/payload.mjs` |
| The one place that transmits | `src/messaging/providers/web-push.mjs` |
| Fan-out and retire-the-dead | `src/push/send.mjs` |
| Routes | `api/push/key.mjs`, `api/push/subscribe.mjs`, `api/push/unsubscribe.mjs` |
| Service worker | `public/app/client-portal-sw.js` |
| Install manifest | `public/manifest.webmanifest`, icons in `public/app/icons/` |
| The card and the ask | `public/app/client-portal.html` |
| Prove one arrives | `scripts/push/send-test-push.mjs` |

## Configuration

Four variables. Nothing works without all four, and nothing pretends to.

| Name | What it is |
|---|---|
| `VAPID_PUBLIC_KEY` | Public. Sent to every browser that subscribes. |
| `VAPID_PRIVATE_KEY` | Secret. Signs our requests to the push services. |
| `VAPID_SUBJECT` | `mailto:` or `https://` contact, so a push service can reach a human. |
| `PUSH_SUB_ENC_KEY` | Secret. 32 bytes, base64. Encrypts subscriptions at rest. |

Generate the VAPID pair: `node scripts/push/send-test-push.mjs --generate-keys`
Generate the storage key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

## The kill switch

Two of them, and either one is enough.

1. **One deploy.** Change `const KILL_SWITCH = false` to `true` in
   `public/app/client-portal-sw.js` and deploy. Every installed copy deletes its
   caches and unregisters itself the next time the browser checks the file.
2. **One URL, no deploy.** Open `/app/client-portal.html?push=off`. That device
   unregisters every service worker on the origin and empties every cache.

Turning it off for everyone without touching code: unset `VAPID_PRIVATE_KEY`. The
button disappears, and nothing can send.

## What the service worker can and cannot touch

Scope is the single URL `/app/client-portal.html`. Not `/app/`, which is where every
staff CRM screen lives, and not `/`. Two consequences, both deliberate:

- A request to `/api/` is **outside its scope** and never reaches it, so a client's
  financial data cannot enter a cache even by mistake.
- It cannot sit in front of a staff screen, so a bad worker cannot take the CRM down.

`src/push/service-worker.test.mjs` runs the worker in a fake browser and fails if an
`/api/` URL ever lands in the cache.

## Wiring it to something (NOT DONE — this is the follow-up)

Nothing sends a notification today. To connect the nudge engine:

1. Import `sendToClient` from `src/push/send.mjs`.
2. Call it beside the existing text-message send, not instead of it:
   `await sendToClient(db, { orgId, clientId, notification: { kind: "check_in" } })`.
3. If it answers `reason: "no_subscription_on_file"`, fall back to the text. If it
   answers `sent >= 1`, skip the text — that is the whole saving.
4. Add the notification's `kind` — and the complete sentence it should say — to
   `APPROVED_BODIES` in `src/push/payload.mjs` first. An unknown kind is refused,
   on purpose, and so is any body that is not already written down in that file.
   There is no way to pass words in from a caller with the detail flag off.

To route it through the message dispatcher instead (a bigger change, not needed for
the above):

1. Add `web-push` to `REGISTERED` in `src/messaging/providers/index.mjs`.
2. Add a `push` channel and a routing row to `message_channel_routing`.
3. Teach `src/messaging/dispatch.mjs` to resolve a push address from
   `client_push_subscriptions` rather than from a column on `clients` — a push
   address is a row, not a field, which is why `ADDRESS_FIELD` on that provider is a
   name and not a real column.

## What has not been proven

- No notification has been delivered to a real phone. That needs a deployed site, a
  real browser and a real push service, and it is the one step only a human can take.
  `scripts/push/send-test-push.mjs` is the tool for it.
- The iPhone branch is written from Apple's documented rules (iOS 16.4, home screen
  required) and tested as a code path. It has not been run on an iPhone.
