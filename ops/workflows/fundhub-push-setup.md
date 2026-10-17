# Fundhub native push setup

## Builder gate (owner said GO)

1. **Role:** Signed-in Fundhub client on the native iPhone app. Staff push is not part of this first pipe.
2. **One job:** Let that client turn on notifications for this iPhone and receive an approved Fundhub alert.
3. **First question:** “Are notifications on for this iPhone?” The app must answer before offering an action.
4. **Reuse:** Existing client session, `src/push/payload.mjs` lock-screen whitelist, `PUSH_SUB_ENC_KEY` AES-GCM helpers, and the portal's device lifecycle pattern. Native APNs tokens are not web-push subscriptions.
5. **Data:** APNs device token and sandbox/production environment; org, client, and account come from the bearer session. New client-scoped `/api/push/native-device` route and `client_apns_devices` table. Server delivery needs an Apple APNs signing key, key ID, and team ID.
6. **Files:** `tools/fundhub-ios/Fundhub/App/FundhubApp.swift`, `tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift`, `tools/fundhub-ios/Fundhub/Core/Models.swift`, `tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj`, new native push Swift file and Debug/Release entitlement files, `tools/fundhub-ios/FundhubTests/FundhubTests.swift`, `db/migrations/481_client_apns_devices.sql`, new `src/push/native-store.mjs`, `src/push/apns.mjs`, `src/push/native-send.mjs`, `api/push/native-device.mjs`, focused tests and manual test script, `src/http/middleware/requirePrincipal.mjs` (pass through verified account session ID), `netlify/functions/api.mjs`, push registry/tripwire coverage files required by existing tests, `docs/journeys/push-flow.md`, `docs/journeys/fundhub-ios-intended.md`, `docs/journeys/fundhub-ios-actual.md`, `tools/fundhub-ios/README.md`, and this board. Do not touch portal UI, portal API, or `db/expected-migrations.mjs` while another lane owns them.
7. **Risk/proof:** A shared or signed-out phone must never receive the prior client's alerts; sandbox tokens must not hit production APNs. Prove auth scoping, register/revoke/reassign, encrypted storage, APNs request shape and retire-on-invalid, Swift unit tests and signed device build. A real delivered iPhone alert remains unproved until Apple enables the App ID and a signing key is configured.

## Status

- Existing browser push: built, not wired to an automatic send; no real-phone delivery proof.
- Native APNs: client opt-in, session-bound encrypted device rows, APNs transport, and manual test command built in source. No automatic send is connected because the booking message dispatcher gates do not yet cover APNs; no real iPhone alert has been observed.
- Apple App Store Connect update (2026-10-17): `ai.fundhub.app` has the Fundhub Portal record `6823985032`, and Chris superseded the prior account-access denial. Apple reports Push Notifications enabled on the App ID; a genuine APNs server key is still unverified.
- GitHub: commit `d6acfd1cc` pushed to [PR #56](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/56). Not merged or live.

## Proof and handoff

- Focused Node push/auth/coverage/route tests: 18 passed, 0 failed. APNs ES256 signing, sandbox/production host routing, lock-screen whitelist, encrypted storage, reassignment/revocation, revoked-session sender exclusion, account-session scoping, and client-only route access are covered.
- iPhone 17 simulator `xcodebuild ... test`: passed. Unsigned Release iOS build: passed. Release build settings select `Fundhub.Release.entitlements` and `FUNDHUB_APNS_PRODUCTION`; source entitlement says `production`. A signed App Store archive was **not** made or inspected.
- The generated Release `Info.plist` did not contain the custom `APNSEnvironment` key; a build inspection caught and removed that dead runtime check. The app now uses a compile-time APNs environment chosen by the same Debug/Release configuration as its entitlement. Native and in-portal sign-out both retry server revocation; a 401 means the web portal already closed that session.
- `npm run lint`: passed (3961 parsed files). `npx tsc --noEmit`: passed. `node --check` passed for the native route, sender, store, coverage, and manual test script.
- Registry/tripwire suite still fails solely on unrelated, concurrently added `finance/lnr-business-report` route/page not yet registered; the native push route is registered and its tripwire IDs resolve. Do not call the whole suite green until that lane is integrated.
- Local environment has none of `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY_BASE64`, `PUSH_SUB_ENC_KEY`, or `DATABASE_URL`, so no database migration, signed-device install, APNs acceptance, or observed iPhone banner was possible here. Parent owns the dirty `db/expected-migrations.mjs` manifest and integration.

## Owner/Apple steps before a real alert

1. Push Notifications is enabled for `ai.fundhub.app` and the current signed Release build has the production entitlement. Create a genuine APNs Auth Key in Apple Developer; the earlier account-access denial no longer applies. Follow any Apple sign-in or tool-enforced confirmation when it appears.
2. Put `APNS_KEY_ID`, `APNS_TEAM_ID`, and the complete `.p8` file base64-encoded as `APNS_PRIVATE_KEY_BASE64` into the deployed Netlify environment; retain `PUSH_SUB_ENC_KEY`. Apply migration 481 and include it in the expected-migrations manifest.
3. Make a signed Debug iPhone build and signed Release archive, inspect each app's `aps-environment` (`development`/`production`), opt in from a real client iPhone, then run `scripts/push/send-test-native.mjs --client <uuid> --send` from an authorized environment. A visible banner, not just Apple's HTTP 200, is delivery proof.

Automatic booking/reminder alerts are a separate integration step: route APNs through the existing dispatch/consent/cap/quiet-hours gates first. This setup does not send them and should not be described as fully live push.
