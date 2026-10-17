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
- 2026-10-17: Chris approved repair of all five failed required browser checks as part of this launch and directed us to stop asking for repeat approval. The standing rule is being added to `AGENTS.md`, `CLAUDE.md`, and the paired Cursor/Claude rules. This does not change the live-data, money, or credential gates.

## Required browser-check repair split (approved 2026-10-17)

| Workflow | Owner | State | Copy-paste prompt |
| --- | --- | --- | --- |
| Release rule and final integration | this session | IN PROGRESS | “Codify that failed required checks are included in an approved launch; combine the repairs, rerun the release gate, and verify live before saying live.” |
| Company Brain chat (2 checks) | company-brain worker | OPEN — API CREDITS | “Diagnose the two `embed_failed` Company Brain browser failures; make the smallest real fix and rerun them without weakening checks.” |
| Campaign budget and optimize intake (2 checks) | campaign-checks worker | LOCAL PASS — CI PENDING | “Repair the budget-value and analytics-request browser failures without touching live money or customer data; rerun both checks.” |
| Teleprompter viewport (1 check) | teleprompter-check worker | LOCAL PASS — CI PENDING | “Diagnose the Chromium viewport failure, fix the test harness or app behavior without weakening proof, and rerun that check.” |

The three repairs run together. Final CI, ship, and live verification wait for the combined result.

- Campaign drawer: a re-render discarded the typed daily budget and sent the old value. The draft now survives a re-render; the existing confirmation and server checks remain. Campaign and intake browser specs passed 62/62, including 24 repeated budget checks. The intake test now rejects first-party POSTs, not unrelated Clarity telemetry.
- Teleprompter: desktop Chromium entered fullscreen on first tap, then rejected the test's simulated phone resize. The test now exits fullscreen and checks that it ended before resizing. Full spec passed 60/60 and the focused check passed 10/10 repeats. No app camera or recording code changed; real-iPhone acceptance is not claimed.
- Company Brain: the current live read API returned `embed_http_429` with `insufficient_quota` / `credit_balance_exhausted` from the AI provider. The test still requires a successful answer; its failure message now includes the API error. Unit checks passed 39/39, but the two live browser checks stay red. Netlify's displayed key is a mask, not a key to test or replace. The production account behind the existing key needs API credits before these checks can pass. No credential or customer data changed.
- The combined source still needs GitHub CI and live proof. Do not describe this release as live or in Apple review from these local results.
- 2026-10-17: Chris directed a fresh agent split and said **no API credit purchase**. The current Company Brain live error remains red while a real no-credit path is checked; no payment, fake provider, or skipped test is authorized.

## Final launch follow-through (approved 2026-10-17)

| Workflow | Owner | State | Copy-paste prompt |
| --- | --- | --- | --- |
| Current PR checks and real no-credit Company Brain path | release-ci-no-credit worker | IN PROGRESS: browser done; long suites pending | “Check PR #63 and the current Company Brain live failure. Find a real no-credit path using existing configuration if one exists; do not weaken checks, buy credits, or change live customer data.” |
| Apple iOS/macOS release and APNs readiness | apple-release-apns worker | DONE: signed build 2 valid; submission blocked | “Verify App Store build/submission state and genuine APNs signing readiness. Carry out safe release prep under Chris's standing account authorization; never claim review or push delivery without proof.” |
| Board, integration, final release gate | this session | IN PROGRESS | “Combine agent findings, verify the live path, and publish only after the approved checks and account gates are genuinely clear.” |

The first two workflows run together. Publishing waits for their proof and the final release gate.

- Latest PR #63 browser runs `39061260132` and `39061263499`: 1,343 passed / 2 failed. Campaign budget, optimize intake, and teleprompter checks are now green on GitHub. Both remaining failures are Company Brain's real OpenAI embedding path: chat reports `credit_balance_exhausted`; upload returns `embed_failed`. No check was skipped or weakened.
- Chris says no API credit purchase. The no-credit worker found no configured alternate embedding provider: Company Brain embeds every question and expects 1536-dimensional vectors. Its two checks run against existing live production, not PR #63 code, and stay red; no credit purchase, weaker test, or speculative search rewrite was made.
- Chris explicitly authorized available account access for assigned work, including Apple Developer and App Store Connect for this launch, superseding the saved denial. The standing rule is in the paired Cursor/Claude rules and shared instructions. No money or unrelated app changes were authorized.
- Apple validated and uploaded a fresh signed Fundhub iOS 1.0 build 2 to App Store Connect on 2026-10-17 (delivery UUID `e58759b7-dbcf-4a8c-a953-38aaedead2e9`). Apple marked it `VALID` / `APP_STORE_ELIGIBLE`, and the iOS 1.0 version now selects build 2. The uploaded IPA itself contains `UILaunchScreen` and `aps-environment=production`; an earlier archive without the launch-screen key failed validation. Review submission and public availability are **not yet proved**. The macOS version is still Prepare for Submission; the locally installed Mac app is ad-hoc signed and does not match the App Store Mac bundle.
- Apple reports Push Notifications enabled for `ai.fundhub.app`, but no genuine APNs server `.p8` key is available locally or configured for the deployed sender. A real iPhone alert is still unproved. App Review contact, notes, and test login are now verified below.
- The owner-supplied `client@fundhub.ai` test password returned HTTP 200 from the live `/api/auth/login` endpoint. On the current iPhone 17 simulator build it reached native client Home and the full portal, which identified `TEST — Client Role` and loaded. This proves the review login path, not a real-device sign-in. Native Home also displayed push and Face ID warnings in the simulator; do not use that screen as a store image or claim those features work on a physical phone.
- Apple accepted the fresh high-contrast build 2 sign-in screenshot for iOS 1.0 English (`APP_IPHONE_61`, screenshot ID `67000019-6bdb-8f88-802d-92309a7471ea`, `COMPLETE`). The old gray-text image was not used. The screenshot is truthful but does not prove signed-in app quality.
- The APNs key form was prepared for `Fundhub Push`, **Production**, **Topic Specific: `ai.fundhub.app`**. Its final Save/Register action was explicitly auto-review rejected; no key was saved or created and no Apple credential changed. Owner action is needed to complete that security-sensitive key creation. A separate sandbox key would be needed for Debug-device testing.
- The two superseded GitHub test runs were canceled after they held the branch queue; the new `09433ceff` runs started. Their full browser/no-database/Postgres results are pending. No test was weakened.
- App Store Connect review contact and notes are now complete: Chris Stanbridge, `chris@fundhub.ai`, the business-published `+15613048368`, and the exact client password path. The review draft `042bc18d-51c5-48b6-933a-c7223f7f0721` is `READY_FOR_REVIEW` but **not submitted**. Build 2 encryption and third-party-content declarations were set after source review. Apple's current validation reports exactly one metadata failure: unpublished App Privacy data-use answers (`APP_DATA_USAGES_REQUIRED`). App Store Connect's public API does not expose that resource; the in-app browser is at Apple Account sign-in, so the signed-in App Privacy UI remains required.
- Read-only App Privacy inventory for the signed-in iOS native/client-portal paths: disclose linked name, email, phone, address, user/device identifiers, credit and other financial info, payment method info (masked bank/card details), purchase/payment history, uploaded photos/videos and other user content, and in-app private messages for app functionality. The reachable soft-pull approval form also collects/stores raw SSN, DOB, and optional EIN; disclose these as linked **Other Data**. Opt-in marketing push adds a marketing purpose for contact/identifier data, not financial documents or chat. The current iOS login/portal paths showed no ad scripts or direct Fundhub home-page link, so Tracking=No is supportable for this iOS binary. The separate local Mac binary is not uploaded to this App Store app; its webview can reach the home page with Meta Pixel and Clarity, so reassess tracking before any Mac Store build. Face ID stays local, and no crash/performance collection was proved. Product-interaction log linkage still needs a decision based on actual retention. These are source/live-page findings, not published Apple answers.
- A newly opened signed-in App Store Connect tab reached Fundhub Portal → App Privacy. The initial data-collection modal is open with **Yes** and the source-backed contact, finance, content, identifier, product-interaction, and Other Data categories selected. Nothing in that modal has been saved or published. Privacy purposes/linkage/tracking still need completion and a final action-time confirmation before publication.
- The paired physical iPhone 17 Pro Max now has Fundhub `ai.fundhub.app` 1.0 build 2 and Fundhub Prompter `ai.fundhub.prompter` 1.0 build 1, verified with `devicectl device info apps` after a safe build-2 install over the existing Fundhub app. Prompter was untouched; no uninstall or data reset occurred. The physical screen mirror stayed at “Connecting display…”, and a launch attempt lost its remote connection, so real-device sign-in, Face ID, and push receipt remain unproved. `/Applications/Fundhub.app` is installed and running on Mac as `ai.fundhub.mac` 1.0 build 1; its code signature verifies and its Team/Client sign-in landing view was observed. This local Mac app is ad-hoc signed, not a Mac App Store build.
- Both latest `09433ceff` browser jobs finished 1,343 passed / 2 failed. The only failures are the existing live Company Brain upload/chat embedding path, with upstream OpenAI 429 `insufficient_quota` / `credit_balance_exhausted`; all three previously repaired campaign/intake/teleprompter browser failures passed. The full no-database and Postgres jobs remain running. A completed `main` run from 2026-10-15 timed out after a similar long no-output period. A local full-suite run showed the last visible marketing worker test had already exited while nested pulse/Playwright proof tests continued with buffered output; the last visible line alone does not identify a hung test. Keep the current suite runs pending until their actual conclusions are known.
- Release-suite repair: the full runner proves all 289 mapped display tests are in its outer file list, then avoids running those same 289 a second time from the nested focused proof. Standalone focused proof still runs them. The stale display-red snapshot was independently reproduced on `main` (actual 119 vs expected 637); exact assertions now require 1,496 tracked controls, 1,379 mapped, 2 deliberately mapped-red, and 119 total red. This does not turn an unmapped control green. Focused flag-path proof passed 3/3, lint parsed 3,965 files, and both files passed syntax/diff checks; full-suite CI remains pending.

## Leftovers outside this launch scope

- `api/finance/lnr-business-report.mjs` is untracked and is not routed by `netlify/functions/api.mjs`. It is not part of the two-iOS-app launch, so this session will not test or repair it.
