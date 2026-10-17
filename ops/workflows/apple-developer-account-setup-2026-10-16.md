# Apple developer account setup — 2026-10-16

## Owner

Chris approved account setup work on 2026-10-16.

## Workflows

| Workflow | Owner | Status | Next action |
| --- | --- | --- | --- |
| Apple account | This session | Waiting for Xcode system setup | Apple account, upload key, bundle ID, and TestFlight app are active. The unsigned iPhone release build passes. Xcode is installing its required system components before it can create the signing profile and upload build 1. |
| App prep | Available parallel session | Ready | Inspect `tools/teleprompter-ios/` and prepare the first TestFlight build. |

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
