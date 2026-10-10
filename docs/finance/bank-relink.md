# Bank relink — the contract (back end → screen)

FinanceOS F2. When a real bank login breaks (Plaid says the client must sign in again),
the daily refresh marks it `link_state = 'error'` and stops reading it. Before this, nothing
let the client fix it. This is the back end for that: a list of the client's bank logins
with what is wrong in plain words, a Link token in **update mode** to repair one, and a
"done" call that checks the repair by reading the bank again. It also queues one text
telling the client to reconnect.

This file is for the unit that builds the screen. It says what the API returns, what to
call, and what you must not do. Flow and states: `docs/journeys/bank-relink-flow.md`.

Plaid's own pages, if a row here is disputed: update mode
<https://plaid.com/docs/link/update-mode/>, item errors <https://plaid.com/docs/errors/item/>.

## 1. One door: `/api/banking/relink`

Same two callers and the same gate as `POST /api/banking/link-token`:

* a signed-in **client** works on their own file only. `client_id` comes off the session; one
  in the query or body is ignored. A login id that is not theirs is a 404, the same answer as
  an id that never existed.
* **staff** (`owner`, `admin`, `sales_manager`) pass `client_id` (query on GET, body on POST).
  A client in another org is 404. A closer, setter or any other role is 403.

| Call | Does | Answer |
|---|---|---|
| `GET /api/banking/relink` | lists the client's bank logins | §2 |
| `POST /api/banking/relink` `{ action:"start", item_id, add_accounts? }` | a Link token in update mode for one login | §3 |
| `POST /api/banking/relink` `{ action:"finish", item_id }` | "I am done" — reads the bank again | §4 |

`item_id` is the `item_id` from the GET (our `plaid_items` uuid, never Plaid's own id).
Other methods are 405. The access token never appears in any answer.

## 2. `GET` — the logins

One object per bank login, oldest first. Sample (the same client as the file-protection
alerts sample: the sandbox bank linked on Oct 6, the daily read of Oct 10 the last good one,
the bank asking for the login again on Oct 11):

<!-- sample:get -->
```json
{
  "ok": true,
  "as_of": "2026-10-12T12:00:00.000Z",
  "environment": "sandbox",
  "plaid_ready": true,
  "needs_reconnect": 1,
  "logins": [
    {
      "item_id": "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27",
      "institution": "First Platypus Bank (Plaid sandbox — test data)",
      "state": "needs_reconnect",
      "state_label": "Needs reconnect",
      "real": true,
      "account_count": 4,
      "connected_at": "2026-10-06T22:57:00.000Z",
      "last_good_refresh_at": "2026-10-10T07:00:05.000Z",
      "error": {
        "code": "ITEM_LOGIN_REQUIRED",
        "plain": "Your bank needs you to sign in again.",
        "fix": "reconnect",
        "at": "2026-10-11T07:00:02.000Z"
      }
    }
  ]
}
```

Top level:

* `plaid_ready` — false when Plaid is not set up on this deploy. Hide the buttons and say so;
  `environment` is then null. Otherwise `"sandbox"` or `"production"`.
* `needs_reconnect` — how many logins are in `state: "needs_reconnect"`. Use it for a banner.
* `logins` — an empty list is a fact (no bank connected), not an error.

Each login:

| Key | Meaning |
|---|---|
| `item_id` | what you send back in `start` and `finish` |
| `institution` | the bank's name as stored. A sandbox bank carries "(Plaid sandbox — test data)" on purpose: show it as it is. A bank we do not know is `"Unknown bank"`, never a guess. |
| `state`, `state_label` | see the table below. Show `state_label`; branch on `state`. |
| `real` | false for a practice login (the mock provider) and for a row that never had a Plaid Item. Show no buttons for it. |
| `account_count` | open accounts under the login (a closed account is not counted) |
| `connected_at` | when the login was first made |
| `last_good_refresh_at` | the last time we successfully read this login (the later of the balance read and the transactions read). `null` = never read. Say "last updated Oct 10", not "live". |
| `error` | `null` when nothing is wrong. Otherwise `{ code, plain, fix, at }`: Plaid's code (for staff), a sentence for the client, the button to offer, and when it was recorded. |

`state`:

| `state` | `state_label` | Means | Offer |
|---|---|---|---|
| `active` | Connected | being read every morning | nothing (see "Add accounts" below) |
| `needs_reconnect` | Needs reconnect | stopped being read; `error` says why | the button for `error.fix` |
| `revoked` | Disconnected | the client or the bank pulled access | nothing here; "connect your bank again" uses the normal link flow |
| `pending` | Connecting | a link was started and has not finished | nothing |
| `not_connected` | Not connected | a placeholder row with no bank behind it | nothing |

An `active` login can also carry an `error`: its latest morning read failed (the bank was
down) and nothing has read it successfully since. Show the sentence as a small note. An older
failure that a later read outlived is not sent.

### `error.fix` — which button

| `fix` | Offer | Calls |
|---|---|---|
| `reconnect` | **Reconnect** | `start` → open Plaid Link → `finish` (§5) |
| `check_again` | **Check again** | `finish` only — no Link. The bank or Plaid was busy, or still getting data ready. |
| `connect_again` | **Connect this bank again** | the normal flow: `POST /api/banking/link-token`, Link, `POST /api/banking/link-exchange`. Plaid says this login cannot be repaired. |

Some `reconnect` codes need something done at the bank first (`PASSWORD_RESET_REQUIRED`,
`USER_SETUP_REQUIRED`, `ITEM_LOCKED`); `error.plain` already says so ("Do that at your bank
first. Then reconnect."). The button still works.

The sentence for every code is in `src/banking/plaid-item-errors.mjs`, with the Plaid page it
was read from. A code nobody has mapped gets "Your bank connection stopped working. Reconnect
it to keep your balances fresh." and the `reconnect` fix. Use `error.plain` as it comes; do not
write your own sentence per code.

## 3. `POST start`

Body `{ "action": "start", "item_id": "<uuid>" }` (staff add `client_id`). Optional
`"add_accounts": true` also lets the client pick **new** accounts at the same bank (Plaid's
`update.account_selection_enabled`, US and Canada). It must be exactly `true`; anything else is off.
It works on an `active` login too, so an "Add accounts" link is possible. A repair does not need it.

<!-- sample:start -->
```json
{
  "ok": true,
  "link_token": "link-sandbox-4f6c1d2e-8a35-4b7c-9d10-6e2b7a5c8f43",
  "expiration": "2026-10-12T12:30:00Z",
  "environment": "sandbox",
  "item_id": "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27",
  "institution": "First Platypus Bank (Plaid sandbox — test data)"
}
```

The token lasts about 30 minutes. Open Link with it right away; if it expires, call `start` again.

A login that cannot go through update mode (a revoked, unlinked or pending login, a practice
login, one with no saved connection) is refused with the same shape as every refusal (§6):

<!-- sample:start-refused -->
```json
{
  "ok": false,
  "error": "not_reconnectable",
  "message": "This bank was disconnected. Connect your bank again.",
  "fix": "connect_again",
  "code": null,
  "state": null,
  "missing": [],
  "detail": null
}
```

## 4. `POST finish`

Body `{ "action": "finish", "item_id": "<uuid>" }` (staff add `client_id`). Call it when Link's
`onSuccess` fires, and also from a **Check again** button. **It does not take the client's word for
it.** It reads the bank again, and only a read that works leaves the login active.

* The login is `needs_reconnect`: it is claimed (`active`, error cleared), read through the same code
  as the daily refresh, and judged. A read that works keeps it active and ends the "we texted you"
  episode. Plaid still saying "sign in again" puts it back in `needs_reconnect` (409
  `still_needs_reconnect`). The bank or Plaid being busy also puts it back, and says `check_again`.
* The login is already `active`: nothing happens. `already_active: true`, no Plaid call, `accounts: []`.
  A second tap on Done is harmless.
* The read uses the same rules as the morning job: an account the bank stopped listing is reported in
  `vanished` and never closed or deleted, an unknown balance stays unknown, and `entity_kind`
  (personal or business) is never changed.
* Transactions are **not** read here. Plaid keeps what was missed while the login was broken, and the
  07:00 UTC job reads it from the saved cursor, so nothing is lost; the new charges show up tomorrow.

Success — here the client has signed in again and Plaid returns the same four accounts:

<!-- sample:finish-ok -->
```json
{
  "ok": true,
  "item_id": "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27",
  "state": "active",
  "already_active": false,
  "institution": "First Platypus Bank (Plaid sandbox — test data)",
  "refreshed_at": "2026-10-12T12:00:00.000Z",
  "written": 4,
  "accounts": [
    {
      "id": "c5f61f5c-1111-4b1c-8c32-0a6c4a1f0b11",
      "summary": "Personal Checking · ••1101 · depository · 4210.55",
      "name": "Personal Checking",
      "mask": "1101",
      "type": "depository",
      "subtype": "checking",
      "entity_kind": "personal"
    },
    {
      "id": "d7a81c3e-2222-4c2d-9d43-1b7d5b2f1c22",
      "summary": "Business Checking · ••2202 · depository · 18750.00",
      "name": "Business Checking",
      "mask": "2202",
      "type": "depository",
      "subtype": "checking",
      "entity_kind": "business"
    },
    {
      "id": "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e",
      "summary": "Business Amex · ••4404 · credit · 5400.00",
      "name": "Business Amex",
      "mask": "4404",
      "type": "credit",
      "subtype": "credit card",
      "entity_kind": "business"
    },
    {
      "id": "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17",
      "summary": "Personal Visa · ••3303 · credit · 1320.40",
      "name": "Personal Visa",
      "mask": "3303",
      "type": "credit",
      "subtype": "credit card",
      "entity_kind": "personal"
    }
  ],
  "created": [],
  "vanished": [],
  "login": {
    "item_id": "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27",
    "institution": "First Platypus Bank (Plaid sandbox — test data)",
    "state": "active",
    "state_label": "Connected",
    "real": true,
    "account_count": 4,
    "connected_at": "2026-10-06T22:57:00.000Z",
    "last_good_refresh_at": "2026-10-12T12:00:00.000Z",
    "error": null
  }
}
```

* `accounts` — every account the read wrote, in the shape `link-exchange` returns.
* `created` — accounts that were not stored before (the client picked new ones). Each is
  `{ id, name, mask, account_type, account_subtype }`.
* `vanished` — stored accounts the bank no longer listed. Reported, never closed.
* `login` — the login as it stands now, so you repaint the one row from this answer with no second GET.
  It is also there on a refusal, except `no_such_login`, where it is `null`.
* `refreshed_at` — when the read was stamped. `null` when `already_active`.

Still broken (HTTP 409). The login is back in `needs_reconnect` with the new time:

<!-- sample:finish-still-broken -->
```json
{
  "ok": false,
  "error": "still_needs_reconnect",
  "message": "Your bank needs you to sign in again.",
  "fix": "reconnect",
  "code": "ITEM_LOGIN_REQUIRED",
  "state": "needs_reconnect",
  "missing": [],
  "detail": "the login details of this item have changed",
  "login": {
    "item_id": "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27",
    "institution": "First Platypus Bank (Plaid sandbox — test data)",
    "state": "needs_reconnect",
    "state_label": "Needs reconnect",
    "real": true,
    "account_count": 4,
    "connected_at": "2026-10-06T22:57:00.000Z",
    "last_good_refresh_at": "2026-10-10T07:00:05.000Z",
    "error": {
      "code": "ITEM_LOGIN_REQUIRED",
      "plain": "Your bank needs you to sign in again.",
      "fix": "reconnect",
      "at": "2026-10-12T12:00:00.000Z"
    }
  }
}
```

## 5. The browser: Plaid Link in update mode

```js
// 1. the list (§2) → for a login with error.fix === "reconnect":
const s = await post({ action: "start", item_id });            // §3
// 2. open Link with the token. Script: https://cdn.plaid.com/link/v2/stable/link-initialize.js
const handler = Plaid.create({
  token: s.link_token,
  onSuccess: async () => {
    // Update mode: Plaid's access token does not change, so the public_token passed
    // here is NOT used. Do not call link-exchange. Just say "done":
    const r = await post({ action: "finish", item_id });       // §4
    // r.ok → repaint from r.login; !r.ok → show r.message and offer the button for r.fix
  },
  onExit: () => { /* nothing was saved; the login is exactly as it was */ }
});
handler.open();
```

Do not exchange a public token after update mode, and do not call `finish` before Link has closed
with success. A login that was broken stays broken until `finish` reads it successfully.

## 6. Refusals

Every refusal has the same shape: `{ ok:false, error, message, fix, code, state, missing, detail }`
(plus `login` on `finish`). `message` is the sentence for the client; `fix` is the button to offer
(or `null`); `code` is Plaid's code, for staff; `detail` is Plaid's own text, for staff.

| HTTP | `error` | When |
|---|---|---|
| 400 | `bad_request`, `unknown_action`, `item_id must be a uuid`, `client_id is required…`, `body must be JSON` | the request is wrong |
| 401 | `unauthorized` | no session |
| 403 | `forbidden` | a role outside the staff set, a login not attached to a client file, an affiliate or partner session |
| 404 | `no_such_login`, `not_found` | the login (or client) is not this caller's, or does not exist — the same answer for both |
| 409 | `not_reconnectable` | revoked / unlinked / pending / practice / no saved connection / no consent on file |
| 409 | `token_unreadable` | the saved connection will not open (a key problem, not the client's) — `fix: connect_again` |
| 409 | `still_needs_reconnect` | `finish`: Plaid still says sign in again |
| 502 | `upstream_error`, `held` | Plaid or the bank could not answer — `fix` is usually `check_again`, or `connect_again` when Plaid says the login is gone (`ITEM_NOT_FOUND`) |
| 503 | `not_configured` (`missing` lists env names, never values), `auth_unavailable`, `db_unavailable` | Plaid not set up / the auth store or database is down |
| 500 | `write_failed` | Plaid answered but our own write was refused; the login stays active and tomorrow's read tries again |

## 7. The reconnect text

When a login goes to `needs_reconnect` for a reason a reconnect fixes, the client is texted **once**:

> Fundhub alert: your Chase connection needs a quick reconnect in FinanceOS. Open FinanceOS and tap Reconnect. Reply STOP to opt out.

**THE TEXT IS HELD UNTIL THE RECONNECT SCREEN SHIPS.** It tells the client to tap **Reconnect**, and that
button is not built yet. A text that goes out cannot be taken back, so migration 474 seeds the template
**not approved** (`compliance_passed = false`). `sendTemplated` refuses an unapproved template
(`template_pending`), so today the daily job queues nothing, writes no message, and marks no login as told.
Every login stays waiting. **Whoever ships the screen turns the text on in the same change**, with a new
migration that sets `compliance_passed = true` for `SMS-FINANCE-OS-RECONNECT` and nothing else. The first
07:00 UTC pass after that texts each paying client whose login is still broken, once. While it is held, the
pulse lane `bank-relink-error-login-not-told` still goes red the day a paying client's login has been broken
for 2 days with nobody told, so a held text never hides a client who is stuck.

* **Who:** a client with an active `finance-os` subscription, or who paid for the Capital Blueprint, and who
  has not opted out of SMS. The job's own query leaves everyone else out, so a login that will never be texted
  cannot fill the daily batch of 200 ahead of a paying client's. Nobody else is texted; their broken login
  only shows on this screen.
* **Which codes:** only the `fix: "reconnect"` codes. Not a bank that is down (`check_again`), not a login
  Plaid cannot repair (`connect_again`), not a code nobody mapped.
* **When:** the daily Plaid job (`plaid-transactions-sweeper`, 07:00 UTC) queues it right after the reads,
  as its last step, for every such login — including one an earlier day left broken, whose client
  dropped out of the job's own client list the day it broke. The text only **queues**: the dispatcher
  sends it behind the dry-run switch, quiet hours and the opt-out check.
* **Once per error episode:** an episode starts when a login goes to `needs_reconnect` and ends when
  `finish` reads it successfully. A failed `finish` does not start a new one, so a client who tries and
  fails is not texted again. A login that breaks again later is a new episode: one more text.
* **A text that could not be queued** (the client opted out, the template is not approved) is not marked
  as sent. The next morning's pass tries again while the login is still broken.
* The bank's name is the one stored, with the sandbox label left off. "bank" when it is not known.
* The wording lives in `message_templates` as `SMS-FINANCE-OS-RECONNECT` (migration 474, seeded the way
  433, 444 and 471 seed theirs, except **not approved**; an edited copy is never overwritten). A test renders
  the template against the sentence the code stores, so the two cannot drift.

The screen should send the client to the same place the text does: the FinanceOS page, where the
**Reconnect** button for a `needs_reconnect` login lives.

## 8. What is stored (migration 474)

* `plaid_items.reconnect_notified_at` — `timestamptz`, nullable, no default. When the text was queued for the
  login's **current** error. `NULL` = not texted for this error (or no error). Cleared only by a `finish` whose read
  worked. Never returned by an API.
* One SMS template, `SMS-FINANCE-OS-RECONNECT`, seeded **not approved** (see §7).

Nothing else changes. No login is deleted, no account is closed, no credential is touched.

## 9. Known limits

* **No Plaid webhook route exists** (`api/webhooks/[provider].mjs` has no Plaid adapter), so Plaid's
  `LOGIN_REPAIRED`, `PENDING_EXPIRATION` and `PENDING_DISCONNECT` calls are not received. A login Plaid repaired on
  its own stays `needs_reconnect` here until the client taps **Reconnect** or **Check again**; an expiring
  consent is not seen until it has already broken. The words for those codes are mapped for the day a route exists.
* `finish` reads accounts and balances only. Charges and deposits that were missed catch up at the next 07:00 UTC
  job, from the saved cursor.
* The morning reads mark a login `needs_reconnect` for every ITEM_ERROR Plaid sends, and Plaid files some codes that are
  not the client's doing (`PRODUCT_NOT_READY`) under ITEM_ERROR. Those show `fix: "check_again"`; **Check again**
  brings them back.
* Banks that sign in through an OAuth redirect need a registered `redirect_uri` in the Link token. The Link token
  calls (`link-token` and this one) send none today.
* Plaid's sandbox cannot repair an Item that `/sandbox/item/reset_login` broke without the Link screen in a browser,
  so the Link step itself has not been run end to end.

## 10. Check it yourself

* **Against Plaid's sandbox, no browser, no database, throwaway Items:**
  `node --env-file=.env scripts/plaid-relink-sandbox-proof.mjs` — makes an Item, reads it, breaks it with
  `/sandbox/item/reset_login`, shows the refresh marking it, makes an update-mode Link token, and checks `finish` both
  ways. It prints no token.
* **Tests:** `src/banking/plaid-relink.test.mjs`, `plaid-item-errors.test.mjs`, `providers/plaid-http.test.mjs`
  (the update-mode request shape), `src/finance/bank-reconnect-notice.test.mjs` (the text and migration 474),
  `src/http/bank-relink.test.mjs` (the gate), `src/http/bank-relink-doc.test.mjs` (this file's JSON is what the API
  returns), `src/workflows/plaid-transactions-sweeper.test.mjs`, and `src/banking/plaid-relink.pg.test.mjs`
  (real Postgres, runs in CI).
