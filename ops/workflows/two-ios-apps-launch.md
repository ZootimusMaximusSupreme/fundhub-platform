# Fundhub launch — two iOS apps

## Owner decision

- Chris approved the launch split on 2026-10-17.
- Branch: `codex/two-ios-apps-launch`.
- Scope: identify the two iOS launch candidates, prove their release readiness, prove the live Fundhub path, then ship only work that passes the release gate.

## Parallel work

| Workflow | Owner | State | Report |
| --- | --- | --- | --- |
| iOS apps | iOS release worker | DONE | `ops/workflows/two-ios-apps-launch/ios-release.md` |
| Live platform | production worker | DONE | `ops/workflows/two-ios-apps-launch/live-platform.md` |
| Release proof | launch-proof worker | DONE | `ops/workflows/two-ios-apps-launch/release-proof.md` |
| Final gate, fixes, commit, push, and ship | this session | IN PROGRESS | This board |

## Prompts

### iOS apps

> Find the two iOS app launch candidates in this repository. Read their intended journeys and the relevant release files. Do not change app code. Record the exact build/signing/App Store/live-device facts that are proven, what needs a fix, and exact evidence paths in `ops/workflows/two-ios-apps-launch/ios-release.md`. Do not touch any other report or the shared board.

### Live platform

> Inspect the Fundhub production release path in this repository. Read DEPLOY.md, the ship script, Netlify routing, the heartbeat journey, and any linked launch docs. Do not change code or configuration. Run safe local release-readiness checks when available. Record proven facts, failed checks, and exact next fixes in `ops/workflows/two-ios-apps-launch/live-platform.md`. Do not touch any other report or the shared board.

### Release proof

> Find the existing automated and live proof for the Fundhub app launch, with focus on the iOS journey and teleprompter where it applies. Read related journey docs and test configuration. Do not change code. Run only safe local checks that directly cover launch readiness. Record what passed, what failed, and exact commands or files for missing proof in `ops/workflows/two-ios-apps-launch/release-proof.md`. Do not touch any other report or the shared board.

## Release gate

- [x] Both iOS app candidates identified and their device/build proof recorded.
- [ ] Production release route and required environment names verified without exposing values.
- [ ] Relevant checks pass, or named fixes are made and retested.
- [x] A reviewable commit is pushed to GitHub: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/56
- [ ] Live release is verified before calling it launched.

## Findings and action log

- 2026-10-17: Work started after Chris approved the split.
- 2026-10-17: `https://fundhub.ai/api/health?strict=1` and the Netlify target both returned HTTP 200 with database state `up`, 393 applied migrations, and 0 pending migrations.
- 2026-10-17: The launch branch has existing unrelated working-tree changes and is ahead 3 / behind 1 against `origin/codex/two-ios-apps-launch`; they are preserved while the release gate is assessed.
- 2026-10-17: Both development-signed native apps, `ai.fundhub.app` and `ai.fundhub.prompter`, installed and launched on the paired iPhone 17 Pro Max. Actual signed-in journeys and camera/file acceptance are not yet proven.
- 2026-10-17: Fundhub's redesigned first screen was tested (8/8 iOS simulator tests), archived with development signing, and installed on the iPhone. Simulator visual draft: `ops/workflows/fundhub-first-page-simulator.png`. The owner's other app remained foreground during attempted physical screenshot, so phone visual proof remains open.
- 2026-10-17: Company App Store upload failed because App Store Connect has no app record for `ai.fundhub.app`. The current browser login returned `authResult=FAILED`; no public listing or review submission is proven. The iPhone archive is iPhone-only.
- 2026-10-17: A separate Fundhub Mac app was installed at `/Applications/Fundhub.app`. Its native welcome, live Team sign-in, and live Client sign-in were visually checked; authenticated use remains untested. Evidence: `ops/workflows/fundhub-mac-install.md`.
- 2026-10-17: Production strict health returned 200 with database up and no pending migrations. A targeted pulse found five missing outbound message templates, so customer message delivery is not release-green. No new production ship was made.
- 2026-10-17: Chris created App Store Connect app `6823985032` (Fundhub Portal, SKU `FUNDHUB-APP-001`, bundle `ai.fundhub.app`). The iPhone build 1.0 (1) was signed, validated, uploaded as delivery `2dbc0fed-41c5-4723-81f1-f4cf0c6bbf3d`, processed `VALID / APP_STORE_ELIGIBLE`, and attached to the draft iOS version. This is not an App Review submission.
- 2026-10-17: The iOS listing has saved description, keywords, support and privacy URLs, Finance category, 18+ age rating, free U.S. availability, and automatic release after approval. The App Privacy answers, content-rights declaration, reviewer credentials/contact, and screenshot remain open before review submission.
- 2026-10-17: PR #57 merged the native push-device heartbeat repair; [Ship run 39042208135](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39042208135) is in progress. Live portal and push are not marked shipped until the run and live checks pass.

## Leftovers outside this launch scope

- `api/finance/lnr-business-report.mjs` is untracked and is not routed by `netlify/functions/api.mjs`. It is not part of the two-iOS-app launch, so this session will not test or repair it.
