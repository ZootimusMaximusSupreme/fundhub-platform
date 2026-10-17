# Fundhub first screen, 2026-10-17

Owner approved the split and redesign. This work stays on `codex/two-ios-apps-launch` and feeds the Fundhub App Store release. The two native apps were installed and launched on the paired iPhone before this design pass.

## Workflows

| Work | Owner | State | Output |
| --- | --- | --- | --- |
| Review current first screen and propose one focused visual direction | design agent | DONE | `ops/workflows/fundhub-first-page-design.md` |
| Capture present phone state and plan a repeatable real-device check | phone agent | DONE | `ops/workflows/fundhub-first-page-phone.md` |
| Build, test, install, review, and commit the redesign | this session | DONE, pending physical visual review | This board |

## Prompts

> Review the existing Fundhub company iOS first screen in `tools/fundhub-ios/` against `docs/journeys/fundhub-ios-intended.md` and `docs/rules/UI-STANDARDS.md`. Inspect existing screenshots and source without changing product code. Propose a concrete, polished first-screen layout and copy that fits the current sign-in journey. Put findings in `ops/workflows/fundhub-first-page-design.md` only.

> Inspect the paired iPhone's current Fundhub first screen and the available real-device screenshot/check path. Do not change app source or sign into any account. Record the current appearance, device constraints, and a repeatable verification plan in `ops/workflows/fundhub-first-page-phone.md` only.

## Gate

- [x] First screen uses the approved client-first layout and preserves both client email-link and staff password paths.
- [x] Simulator build and relevant tests pass.
- [x] New build installs and opens on the paired iPhone.
- [ ] Real-device screen is reviewed; any untested signed-in state stays open.
- [x] Scoped change reaches GitHub with a direct link: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/56

## Build gate, approved scope

1. Role: client on first launch; staff can switch to password sign-in.
2. Job: get into the right Fundhub workspace.
3. First question: how do I open my file?
4. Reuse: `SignInView`, `FundhubSessionStore`, `BrandMark`, the existing Keychain and email-link path.
5. Data: no new source; current auth replies only.
6. Files: `tools/fundhub-ios/Fundhub/App/FundhubApp.swift`, this board, and small visual evidence. Existing journey remains true.
7. Risk and proof: preserve client link, saved unlock, and staff password; test the simulator, install the build on iPhone, and check the rendered first screen.

The iPhone was active in Messages during the initial device capture. Its installed-app and launch checks passed, but the first-screen visual check still needs Fundhub left open on that phone.

## Result and proof

- Draft: `ops/workflows/fundhub-first-page-simulator.png` (iPhone 17 simulator). The email-link and paste-link actions are visible without scrolling. This is a visual draft, not proof of physical-device appearance or sign-in success.
- `xcodebuild -project tools/fundhub-ios/Fundhub.xcodeproj -scheme Fundhub -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test`: 8 tests passed, 0 failed on 2026-10-17.
- `npm run lint`: 3,952 files and inline scripts parsed clean. Swift compilation in the Xcode test and archive builds provided the relevant type check; there is no repo `typecheck` script.
- A Release archive succeeded with development signing and the revised `ai.fundhub.app` installed and launched on the paired iPhone 17 Pro Max on 2026-10-17. This does not prove the app is public or that a real sign-in works.
- A device screenshot after launch showed the owner's other active app, not Fundhub. That temporary capture was removed. Physical visual review remains open until Fundhub is left in front on the phone.
- The iPhone archive cannot be opened directly on the Mac (`incorrect executable format`). A separate native Mac WebKit app is now installed at `/Applications/Fundhub.app`; see `ops/workflows/fundhub-mac-install.md`. It opens the existing live Team and Client sign-in pages, but a signed-in workspace was not tested.
- Commit `b3aedfe67` is on the open PR above; merge commit `fb3fd6c9e` reconciles the remote branch without overwriting unrelated working-tree edits. GitHub checks were queued when last checked.
