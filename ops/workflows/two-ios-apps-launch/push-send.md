# Native booking-confirmation push send — 2026-10-17

## Source result

- The existing `SMS-S04-01-CONFIRM` booking text is the only trigger. In `src/messaging/dispatch.mjs`, a native alert is attempted **after** the text provider answers `sent` and the message row is saved as `sent`. This applies whether the text goes out immediately or after an overnight deferral.
- The text's existing opt-out, quiet-hours, company-pause, cap, compliance, draft, route, synthetic-record and dry-run checks all run first. A blocked, deferred, failed, unrelated or non-transmitting-provider text cannot unlock native send. The queue's atomic claim also prevents duplicate alerts on a second dispatch of the same message.
- The fixed approved lock-screen payload is `call_confirmation`: “Please confirm your upcoming call in FundHub.” It carries no client name, meeting time, financial detail or URL parameter. An opted-in device's eligibility is rechecked by `src/push/native-store.mjs` before APNs send.
- APNs failure is caught **after** the text's sent status is recorded. It cannot mark the SMS failed or queue a duplicate SMS. The native send is best-effort and is not an independent guaranteed delivery channel.
- The send hook is inert unless `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY_BASE64`, and `PUSH_SUB_ENC_KEY` are present. No credentials were committed or printed.

## Proof

- `node --test src/messaging/dispatch.test.mjs src/push/payload.test.mjs`: 108 pass, 0 fail. Covers one alert on sent text, opt-out, quiet hours, dry-run, missing APNs settings, unrelated template, APNs failure isolation, atomic-claim dedupe, and lock-screen whitelist.
- `node --test src/workflows/s-04b-booking-reminders.test.mjs src/push/apns.test.mjs src/push/native-store.test.mjs`: 28 pass, 0 fail.
- `npx tsc --noEmit`: pass. `npm run lint`: pass (`3966` files and inline scripts parse clean).
- No real device registration, APNs 200 response, or visible iPhone banner has been observed. Production delivery is **not proved**.

## Exact production gate

- The signed iOS App Store IPA has `aps-environment=production`, `get-task-allow=false`, and bundle `ai.fundhub.app` (root's archive proof).
- Production Netlify functions currently have `PUSH_SUB_ENC_KEY`, but **not** `APNS_KEY_ID`, `APNS_TEAM_ID`, or `APNS_PRIVATE_KEY_BASE64` (presence-only check). The existing App Store Connect Admin `.p8` file is not a proven APNs Auth Key.
- In Apple Developer, enable Push Notifications on App ID `ai.fundhub.app`, create/download an APNs Auth Key, then set the three `APNS_*` variables in Netlify production. Rebuild/release if the App ID/profile capability was not already enabled. On an installed real iPhone, sign into the client account, opt into alerts, verify the native-device route stores an eligible token, and use `scripts/push/send-test-native.mjs --client <uuid> --send` for the approved generic test alert. Only after an APNs receipt and visible banner should live push be called working.
- The live `/api/push/native-device` probe returned 404 during a deploy window; recheck after the route is shipped. The separate hourly readiness beat introduced in PR #57 is not an outbound-delivery receipt. A separate `send:native-booking-confirm` pulse proof is being coordinated with `live_portal_ship`; until it lands, coverage is not green.
