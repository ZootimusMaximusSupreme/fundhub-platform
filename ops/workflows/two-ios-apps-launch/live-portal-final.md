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

- Commit and push the repair, merge it to `main`, then verify the new GitHub Ship run.
- Read the shipped client-portal HTML and test the call-confirmation card on the live page before calling it live.
- A real iPhone push delivery is still unproved. The hourly beat checks readiness and ownership, not a delivered banner.
