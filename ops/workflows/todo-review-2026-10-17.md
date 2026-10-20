# To Do review — 2026-10-17

## Scope

Review only. No customer data, app settings, sends, or code changed.

## What is current

- The live Fundhub web release is verified: Netlify deploy `6ad41f35fb3b4dd15d416b7b` is published and guarded push routes return `401` when signed out. Source: `ops/workflows/two-ios-apps-launch.md`.
- Fundhub Portal is **not launched** in the App Store. Build 1.0 (2) is valid and attached, but App Review has not been submitted. Source: `ops/workflows/two-ios-apps-launch/asc-review-packet.md`.
- Fundhub Prompter is **not launch-ready**. Its source tests/build prove compilation only; real-iPhone recording and saved-file proof remain open. Source: `TODO.md` and `ops/workflows/two-ios-apps-launch/release-proof.md`.

## First four To Do items

1. Finish the Portal review packet: screenshot, test-client reviewer access/contact, navigation notes, truthful privacy answers, and content-rights answer. Then submit it to Apple.
2. Wait for Apple beta review. When TestFlight build 2 is available, register a real device and prove one approved push banner and tap. Build 3 cannot replace build 2 while build 2 is under review.
3. On a real iPhone, record a Prompter take and inspect the saved original for frame rate, resolution, audio, camera switching, Photos save, and Drive upload. Browser proof measured below 60 fps, so it does not close this gate.
4. Restore the three missing email and two missing SMS templates, prove one allowed provider receipt for each channel, then rerun the delivery pulse.

## Backlog cleanup finding

- `TODO.md` contains 496 unchecked boxes: 8 dated 2026-10-17, 31 under an expired 2026-10-13 "Today" block, 10 teleprompter launch proofs, and 447 mixed pulse, product, marketing, and personal items.
- Its older release statements are not current launch truth. Use `ops/workflows/two-ios-apps-launch.md` and `ops/workflows/two-ios-apps-launch/asc-review-packet.md` for the current iOS launch gate.
- Do not merge or close duplicate historical items until the four current gates above have proof.

## Evidence checked

- `TODO.md`
- `ops/workflows/two-ios-apps-launch.md`
- `ops/workflows/two-ios-apps-launch/asc-review-packet.md`
- `ops/workflows/two-ios-apps-launch/push-send.md`
- `ops/workflows/two-ios-apps-launch/test-logins-push.md`
