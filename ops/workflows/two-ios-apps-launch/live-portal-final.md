# Fundhub live portal release repair

## Why the first ship stopped

- GitHub Ship run [39041196248](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39041196248) failed before deploy. The new `route:push/native-device` had no hourly beat; the guard named it exactly.
- The portal call-confirmation page was not live at that point. The old live health door still answered, with the database up and no pending migrations.

## Repair

- Added `native-push` to the hourly beat list. On the live server it checks that APNs signing and device storage keys are usable, the unsigned-in native route answers as expected, and no live device row belongs to the wrong client.
- It uses only GET and a read-only database query. It never sends a notification or prints a key or device token.
- Before deploy, the new route and table cannot be observed on the old live server. That local proof names all three steps as skipped; the beat's self-tests run both green and red cases. The live hourly run will check the real route and table after release.

## Proof so far

- `node --test src/pulse/beats/beat-native-push.test.mjs src/pulse/beats/beats.test.mjs`: **22 passed, 0 failed**. The new beat catches an invalid APNs key, missing route, and wrong-client device row.
- `node --test src/pulse/coverage/gap-native-push.test.mjs`: **3 passed, 0 failed**.
- `node --test src/http/native-push-device.test.mjs src/http/middleware/requirePrincipal.native-push.test.mjs`: **4 passed, 0 failed**.
- `npx tsc --noEmit`: passed.
- `npm run pulse:prove -- --beats`: bundle built and loaded all **16** listed beats, with **0** cut, refused reads, or sends. The new beat's live-only steps were explicitly skipped before deploy. Existing `email-path` and `text-path` were red for five missing templates; this repair did not change those paths or mark them green.
- `npm run lint`: 3,966 files and inline scripts parsed clean.
- `npm run pulse:prove`: running when this note was written.

## Release gate still open

- The beat repair merged in [PR 57](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/57). Its [Ship run 39042208135](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39042208135) stopped before deploy because the morning proof read migration 481's table before it existed.
- The full morning bundle proof, run before migration 481, found `client_apns_devices` absent. It also found a separate slow catalog-display check (39.7 seconds versus the 20-second lane limit). The schema error is the release-order repair in `scripts/ship.mjs`: after lint and safety guards, apply the checked migrations before either schema-reading pulse proof. The slow lane stays red and is not changed here.
- [PR 58](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/58) moved migrations before pulse, but its [Ship run 39043208756](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39043208756) stopped before deploy: migration 481 tried the restricted `fundhub_app` connection and PostgreSQL denied `CREATE` in `public`. The app role and grants stay unchanged. The follow-up repair uses `MIGRATION_DATABASE_URL` only when a real owner connection is set; otherwise it uses the existing Supabase Management API admin-token path with its transaction probe. The local admin token returned HTTP 401 in a read-only check, so the GitHub secret still needs a Ship-run proof.
- The failed morning proof also reported catalog-display at 55.9 seconds and crm-links at 36.1 seconds (both over 20 seconds). They stay red; this repair does not loosen their limits.
- Read the shipped client-portal HTML and test the call-confirmation card on the live page before calling it live.
- A real iPhone push delivery is still unproved. The hourly beat checks readiness and ownership, not a delivered banner.
