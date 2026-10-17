# Call-invite push lane — 2026-10-17

## Builder gate (owner said GO to the call-invite workflow)

1. **Role:** Signed-in Fundhub client with native notifications enabled.
2. **One job:** Tap an invite and reach the current call's real join link.
3. **First question:** “Can I join my call now?” The client call card answers it before showing a button.
4. **Reuse:** `ai-set-04-3way-handoff` at T-15, `SMS-AISET04-HANDOFF`, the message dispatcher gates, `bookings`, `sendNativeToClient`, the fixed push-payload whitelist, the native app's existing session and portal sheet.
5. **Data:** Current client-scoped booking status, start/end, and `meeting_url`; the existing message's `provider_ref` carries `booking-start:<client>:<ISO time>`. `api/read/portal-summary.mjs` currently returns `upcoming_call` without a link, so the authenticated read must expose a joinable current URL or a new client-scoped read must do it. Do not put that URL in APNs.
6. **Implementation files after core push delivery is proved:** `src/messaging/dispatch.mjs`, `src/push/payload.mjs`, `src/push/apns.mjs` / `src/push/native-send.mjs` for expiry, `api/read/portal-summary.mjs`, `public/app/client-portal.html`, `tools/fundhub-ios/Fundhub/Core/Models.swift`, `tools/fundhub-ios/Fundhub/Core/NativePush.swift`, `tools/fundhub-ios/Fundhub/App/FundhubApp.swift`, focused tests, and the heartbeat/tripwire map for the new send. No separate notification queue or new dependency is needed. Only this intended journey and this board are edited in this lane now.
7. **Risk/proof:** A stale push could open a moved or cancelled call, or reveal a join link to a signed-out or wrong client. Recheck the current booking at dispatch **and** tap, scope every read to session client/company, keep APNs generic, and prove real-phone tap + visible banner. The existing SMS result must stay independent of APNs failure.

## What source proves now

- `src/workflows/ai-set-04-3way-handoff.mjs` runs at T-15 and queues the handoff SMS once per client/call time. Its `meetingLinkFor` can return `portalLoginUrl()`; that is a working sign-in door, **not** a call link. `docs/journeys/booking-notifications-flow.md` records that ClickFunnels usually supplies no meeting link.
- `src/messaging/dispatch.mjs` already sends `call_confirmation` native push only after a successfully recorded booking-confirmation SMS. The exact adjacent hook is its `result.status === "sent"` branch, after the `UPDATE messages SET status = 'sent'` statement. The new handoff branch should key on `message.channel === "sms"`, `message.template_key === "SMS-AISET04-HANDOFF"`, a transmitting provider, and configured APNs, then revalidate the matching booking/time/link before sending. Never parse the rendered SMS body for a URL.
- `src/push/payload.mjs` currently allows `call_confirmation`, but no `call_invite`; its only approved tap path is `/app/client-portal.html`. Add a fixed `call_invite` kind/body/tag there. Keep the same path and `allowDetail: false`.
- `api/read/portal-summary.mjs` currently returns upcoming call ID, time, and confirmation flag only. The native `PortalSummary` model also lacks a call field. `FundhubPushDelegate` registers the device and presents foreground banners but has no notification-tap handler. These are implementation gaps, not live features.
- No automatic native alert has yet been seen on a real iPhone. Do not call this lane shipped until the parent lane proves the APNs path and this lane's tests and tap path pass.

## Focused tests for the implementation lane

- One invite after a genuinely sent T-15 handoff SMS. None after blocked, deferred, opted-out, paused, capped, dry-run, test-provider, failed, or unrelated messages; an APNs error cannot change SMS status. Replay/atomic claim yields one invite.
- Matching org/client, booking status and time, HTTPS URL, and T-15-to-start send window required. Missing URL, portal sign-in fallback, old-time move, cancel, past call, delayed send, and wrong-client booking produce no invite.
- Push payload has fixed body/tag and portal path; no meeting URL or identifiers. APNs expiration is the earlier of `ends_at` (when present) or start plus 30 minutes, and only eligible devices are tried.
- A real native tap while signed in opens the current call card; signed out opens sign-in; stale/moved/cancelled call has no Join Call. Join Call needs a second user tap and opens only the refreshed HTTPS URL. Check on a physical iPhone, not simulator alone.

Status: intended journey written; no call-invite code or live notification sent in this lane. Waiting for core APNs delivery proof before implementation or release claims.
