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
- 2026-10-17: App Store Connect now has **Fundhub Portal**, app ID `6823985032`, with iOS and macOS version 1.0 in Prepare for Submission. This is a created record, not an uploaded build or review submission.
- 2026-10-17: Chris chose to keep Supabase Free. Egress is 7.591/5 GB for the current cycle; it is not safe to call production usage fixed yet. Climate lender reads were narrowed and tested on the release branch.
- 2026-10-17: Ship run `39044005237` attempt 2 applied migration 481 and strict health showed 394 migrations, 0 pending, but the pre-deploy pulse timed out. Catalog display reads were batched without changing its budget or hiding reds; built-bundle proof finished that lane in 4.1 seconds. No new site deploy has been verified.

## Push expansion (approved 2026-10-17)

| Workflow | Owner | State | Evidence |
| --- | --- | --- | --- |
| Service email/SMS companion push | this session | SOURCE PROVEN | `docs/journeys/client-message-push-intended.md`; gated text to decrypted test-device proof; 321 focused tests passed |
| BS marketing push preference | marketing workflow | SOURCE PROVEN | `docs/journeys/marketing-push-intended.md`; portal GET/PUT and UI tests; default off |
| Safe native call-invite tap | call-invite workflow | SOURCE PROVEN | `docs/journeys/call-invite-push-intended.md`; 13/13 simulator tests; authenticated portal only, no auto-call |
| Supabase Free egress and Ship proof | production workflow | SOURCE PROVEN | Narrowed climate query and batched catalog read; live deployment remains open |

Push source work is isolated on `codex/push-mirror-marketing` while the owner's dirty `codex/two-ios-apps-launch` checkout is preserved. Next gate: full tests, GitHub PR, successful deploy, then real iPhone APNs receipt, visible alert, and portal tap. A Join Call button still needs a verified current meeting URL; ClickFunnels often supplies none. No push is claimed live yet.

- 2026-10-17: Chris chose **Go live** for the marked marketing-switch draft after release checks pass. Review PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/63. The combined focused push/API checks passed 95/95 and the marketing-switch browser test passed 1/1 on the release branch.
- 2026-10-17: The fresh PR browser run `39058655368` finished 1,339 passed / 5 failed in Company Brain (2), campaign manager, optimize intake, and teleprompter. These are not the changed portal-push spec; the release gate stays open rather than treating a failed proof as green. The no-database and Postgres jobs were still running when this row was written.
- 2026-10-17: Live strict health returned `up` with 394 migrations and 0 pending. Both new push routes still returned 404, so no production push release is verified. The only local `.p8` found is the existing App Store Connect API key `F8CX6NNF2D`; no APNs Auth Key was found and Netlify's APNs signing variable names were absent at the last check. An iPhone alert and tap remain unproved.

## Leftovers outside this launch scope

- `api/finance/lnr-business-report.mjs` is untracked and is not routed by `netlify/functions/api.mjs`. It is not part of the two-iOS-app launch, so this session will not test or repair it.
