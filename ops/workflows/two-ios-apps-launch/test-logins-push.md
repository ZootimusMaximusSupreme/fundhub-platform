# Test logins and native push — 2026-10-17

## Test logins: live proof

- `chris@fundhub.ai`: the existing, active, non-demo `owner` staff row was the only row changed. Its password was reset to the owner-provided test value. Live `POST /api/auth/login` returned HTTP 200, `principal=staff`, `role=owner`; the proof session was logged out (HTTP 200).
- `client@fundhub.ai`: a new, isolated test client (`client_master_key=FDH-TEST-CLIENT-ROLE-ACCOUNT`) and active, non-demo `client` account were created in one short transaction. No other role accounts were seeded. Live `POST /api/auth/login` returned HTTP 200, `principal=client`; live `GET /api/read/portal-summary` returned HTTP 200 with `ok=true`; both proof sessions were logged out (HTTP 200).
- The shared password is saved locally at `credentials/fundhub-launch-test-accounts.env` with mode `0600`. That path is excluded from Git. The tracked record names the two logins and where the password is held, but does **not** publish the live owner credential.
- The native iPhone app calls this same `/api/auth/login` path from its password screen. It accepts the returned `client` principal. For App Review, use the isolated **client** login, never Chris's owner login. Current iPhone UI path: tap **Fundhub team? → Use your password**, then enter `client@fundhub.ai` and the saved password. This is proven in code and live API, not yet by an App Review iPhone sign-in.

## Native push: partial, not delivered

- iOS source has client opt-in, APNs device registration, separate development/production entitlements, encrypted token storage, and a guarded generic test sender. Root's 2026-10-17 signed/exported App Store IPA check found `aps-environment=production`, `get-task-allow=false`, bundle `ai.fundhub.app`.
- Production Netlify function environment has `PUSH_SUB_ENC_KEY`, but no `APNS_KEY_ID`, `APNS_TEAM_ID`, or `APNS_PRIVATE_KEY_BASE64` (presence-only check). The local `.env` has the same gap. The available `credentials/AuthKey_F8CX6NNF2D.p8` is recorded as an App Store Connect API Admin key, not a proven APNs Auth Key.
- Live authenticated `GET /api/push/native-device?installation_id=launch-readiness-check` returned HTTP 404 `not_found` during the deploy window, though the route exists in current source. Recheck after the pending production ship; do not call the registration path live yet.
- Current source now hooks a detail-free native alert to a successfully dispatched booking-confirmation text; see `push-send.md`. This is not live-delivery proof. No real iPhone token registration, Apple APNs acceptance, or visible banner has been proved.

Next: enable Push Notifications for App ID `ai.fundhub.app` in Apple Developer, make an APNs Auth Key, put the three `APNS_*` settings into Netlify production, then recheck the live native-device route and send the approved test notification to an opted-in real iPhone. The signed IPA entitlement alone does not complete that pipe.
