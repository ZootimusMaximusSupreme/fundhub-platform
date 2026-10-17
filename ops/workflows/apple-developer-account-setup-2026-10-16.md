# Apple developer account setup — 2026-10-16

## Owner

Chris approved account setup work on 2026-10-16.

## Workflows

| Workflow | Owner | Status | Next action |
| --- | --- | --- | --- |
| Apple account | This session | Complete | Build 1 was signed and accepted by Apple TestFlight. Apple must finish its normal processing before it can be installed. |
| App prep | This session | Complete | Added the Fundhub favicon as the complete iPhone and iPad app icon set Apple requires. |

## Parallel prompt

> Inspect `tools/teleprompter-ios/` and its build spec. Do not change code. Report the exact first TestFlight build steps, missing Apple details, and the files that would need edits. Update this board with findings.

## Evidence

- User says the Apple Developer Program enrollment was paid.
- Enrollment ID reported in chat: `37G25693D9`.
- Apple Developer Program is active: Team ID `8VDXL37RR6`; individual membership renews October 16, 2027.
- App Store Connect API access is active. Existing Admin key: `F8CX6NNF2D`; Issuer ID: `9a240a4e-6a7e-461b-9729-245258841181`.
- Private key saved locally (gitignored): `credentials/AuthKey_F8CX6NNF2D.p8`.
- Apple app identifier registered: `ai.fundhub.prompter` (Fundhub Prompter).
- App Store Connect app created: Fundhub Prompter (Apple app ID `6823825669`), iOS, English (U.S.), SKU `fundhub-prompter-ios`.
- Project signing config now uses Team ID `8VDXL37RR6`. An unsigned iPhone Release build passed on 2026-10-16.
- Connected iPhone registered with Apple Developer as `Chris iPhone` on 2026-10-16.
- Added `Assets.xcassets/AppIcon.appiconset` using Fundhub's existing `f.` favicon and configured `CFBundleIconName = AppIcon`.
- Signed archive export passed. Apple TestFlight upload succeeded on 2026-10-16 (delivery UUID `0d484085-a93d-4c1c-9e01-ae8e310842b9`).
