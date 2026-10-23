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
- 2026-10-17: PR #57 merged the native push-device heartbeat repair and started [Ship run 39042208135](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39042208135). Live portal and push are not marked shipped until the run and live checks pass.
- 2026-10-17: Ship run 39042208135 **failed before deploy**. Morning proof read `client_apns_devices` before migration 481 existed; its catalog-display and crm-links timing lanes also exceeded 20 seconds and remain red. [PR #58](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/58) moves migrations before the morning proof without weakening the proof. Its checks and replacement Ship are pending.
- 2026-10-17: Native call-confirmation push send code is pushed in `3126ae32b`; it is not live. Production has no APNs auth key configured, and no real-device push delivery is verified.
- 2026-10-17: Supabase's previous release token was expired. A new 90-day token limited to the Fundhub project and Database read-write passed a read-only `SELECT 1` Management API check. The GitHub `SUPABASE_ACCESS_TOKEN` secret was updated; [Ship run 39044005237, attempt 2](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39044005237) is being verified. No token value is stored on this board.
- 2026-10-17: Supabase Free-plan egress is 7.591/5 GB in the current cycle, entirely Shared Pooler. Oct 8–9 contributed 4.268 GB. The latest three complete days averaged about 172 MB/day. Free logs no longer cover the spike, so no query-level cause or safe code fix is proven. The account shows a grace period through 2026-11-09; no plan change has been made.
- 2026-10-17: Owner decided to keep Supabase Free. Ship run 39044005237 attempt 2 applied migration 481, and strict live health reports database up, 394 applied migrations, 0 pending. The same run **failed before deploy** on the existing morning proof (catalog-display 80.9s, crm-links 40.5s, partner-board staff access). `/api/push/native-device` still returns 404; no live push claim.

## Push beside email and SMS — approved 2026-10-17

Three workflows run in parallel: A, this session, wires approved push to the existing successful email/SMS dispatcher; B maps marketing and BS selling messages to eligible push copy and taps; C maps a time-bound Join Call invitation. B and C may draft journeys now but live sends wait for A's transport and device proof. Each workflow owns only its named files.

Copy-paste prompts:

> A — Trace the existing Fundhub email/SMS dispatch and web/native push senders. After a real provider send succeeds, send an approved generic push to the same signed-in client without changing message status on push failure. Keep opt-outs, dry-run, company pause, caps, and test-provider fences. Prove blocked/failed/duplicate paths with tests. Own the dispatcher integration, tests, and notification-sync journey; do not send to real people during tests.

> B — Map Fundhub marketing workflows, including BS selling, to existing sent email/SMS events. Define which client push alerts are eligible, approved generic copy, tap target, opt-in/opt-out, cap, and quiet hours. Write `docs/journeys/marketing-push-intended.md` and `ops/workflows/two-ios-apps-launch/marketing-push.md`. Do not touch shared dispatcher or send to real people.

> C — Map existing booked-call and live-call links. Define an expiring Join Call push invitation that opens a verified call path, with role, timing, duplicate, and fallback rules. Write `docs/journeys/call-invite-push-intended.md` and `ops/workflows/two-ios-apps-launch/call-invite-push.md`. Do not touch shared dispatcher or place a live call.

Builder plan gate for A: role = signed-in client; one job = notice a delivered message and open their portal; first question = “What changed?”; reuse = `dispatchOne`, `sendToClient`, `sendNativeToClient`, existing payload allowlist and portal tap path; data = sent `messages` row plus this client's existing web/native device rows, no new endpoint; files = `src/messaging/dispatch.mjs`, its focused tests, `docs/journeys/push-flow.md` and a new notification-sync journey; risk = duplicate or blocked sends causing alerts; proof = fake-provider path tests, gates, lint/TypeScript, then real-device acceptance before live claim. The owner's “go” approves this named scope, not unrelated sends or changing billing.

## Leftovers outside this launch scope

- `api/finance/lnr-business-report.mjs` is untracked and is not routed by `netlify/functions/api.mjs`. It is not part of the two-iOS-app launch, so this session will not test or repair it.

## Release continuation — 2026-10-17

- Chris approved two parallel agents: `ios_push_release` owns the iOS push build and Colin's TestFlight invite; `github_branch_finish` owns safe GitHub branch cleanup. This session owns the Netlify production deploy and final live proof. The agents use separate worktrees and report here through this session.
- [PR #63](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/63) (service and marketing push) and [PR #65](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/65) (apply-link timing repair) are merged to GitHub main. [PR #64](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/64) (Join Call push) remains open pending compatible iOS build 3 proof.
- The Netlify production deploy rejected the merged push build because the Fundhub team exhausted deploy credits. The team is already on credit-based Pro with auto recharge off. Chris chose to restore Netlify rather than move hosts. One 1,500-credit pack is $10; purchase is pending with the owner. No new deploy has been claimed.
- A clean deploy worktree was moved to GitHub main `d2f29eee6`. `netlify build --context production` completed locally: zero migrations applied, database privilege and row-access checks passed, and functions and edge function bundled. This does not make the new push routes live.
- Apple's external TestFlight build 1.0 (2) is still Waiting for Review. Colin Schmidt is assigned as its sole individual tester, but Apple shows No Builds Available and no usable invite yet. Build 1.0 (2) remains in public App Review; no public launch claim.
- Forty-one remote branches already merged into main were deleted. The remaining unique/open-PR branches and dirty local worktrees were preserved. The GitHub push script can recreate merged branch refs and can try to overwrite newer main from a stale checkout; the branch agent is preparing a safe fix before another ship push.
- Latest GitHub [Ship run 39077745176](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39077745176) failed before deploy on live-check timeouts and missing templates. Those failures stay red; the manual deploy candidate above is separate from that proof.
- The `Client@fundhub.ai` test login succeeded on the live site and opened `/app/client-portal.html` as `TEST — Client Role`; the notifications card is visible. This proves login only, not APNs delivery. No password was written to this board or Git.
- Netlify reports its current published deploy as `6ad09192c1b1fa3d1c545bd1`, published 2026-10-15 08:43 UTC. The live `/api/push/native-device` route still returns 404. The prepared GitHub-main build is not published.
- Apple validated and processed signed iOS build 1.0 (3) from PR #64 head `9685f4db3`. Its IPA has production push entitlement and TestFlight reporting, but build 3 is only Ready to Submit. Apple permits one beta-review build for version 1.0 at a time; build 2 remains Waiting for Review, so build 3 cannot yet be submitted or offered to Colin. The paired iPhone is currently unavailable for a real banner/tap check. PR #64 remains open.
- On the prepared GitHub-main checkout, 233 focused push/dispatch/portal tests passed, `tsc --noEmit` passed, and lint parsed 3,968 files/scripts cleanly. No live delivery was inferred from these checks.
- [PR #66](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/66) merged the safe GitHub push guard. It refuses non-fast-forward main updates and skips local branches already contained in the main it pushes. Its remote and local task branches were removed after merge. Eleven other remote branches remain because each has unique work (eight open PR heads, three without PRs); none was deleted as a shortcut.
- The clean production candidate was refreshed to GitHub main `12e8a60c6`, and `netlify build --context production` completed again with zero new migrations, database/row-access guards passing, and functions/edge function bundled. It remains unpublished pending the Netlify credit purchase.

## Production release verified — 2026-10-17

- After Chris said the Netlify credit issue was handled, a single production deploy from the clean GitHub-main worktree at `12e8a60c6` succeeded. Netlify published deploy `6ad41f35fb3b4dd15d416b7b` to `https://fundhub.ai` at 2026-10-18 01:22:58 UTC. [Deploy log](https://app.netlify.com/projects/transcendent-wisp-888771/deploys/6ad41f35fb3b4dd15d416b7b).
- Strict live health returned HTTP 200: database and state up, 394 migrations applied, zero pending. Unauthenticated `/api/push/native-device` and `/api/push/preferences` now return 401 rather than the pre-deploy 404, proving both guarded routes are live.
- A live browser check signed into the test client portal, turned marketing updates on for that test account, and reloaded. The page still showed “Marketing updates are on.” Screenshot: `ops/workflows/fundhub-live-marketing-push-preference.png`. This proves the saved preference path, not a real push, email, SMS, or iPhone banner.
- Fresh App Store Connect check: public iOS 1.0 remains **Waiting for Review** with build 2. TestFlight build 2 is **Waiting for Review**; signed push-capable build 3 is **Ready to Submit** and cannot replace that active beta review yet. Colin Schmidt is listed as the sole tester but still has **No Builds Available**. No public App Store or TestFlight delivery is claimed.
- PR #64 remains open until a compatible native build is available and a real-device push banner/tap is proven. The paired iPhone was unavailable at the prior device check; no later phone proof has been recorded.
- A fresh `xcrun devicectl list devices` attempt timed out while CoreDeviceService initialized, so phone availability and banner delivery remain unverified. GitHub run 39085770819 could not be rechecked during a temporary `api.github.com` connection failure; the independently verified Netlify production deploy above remains the release evidence.

## Apple information request — 2026-10-17

- [iOS submission 042bc18d-51c5-48b6-933a-c7223f7f0721](https://appstoreconnect.apple.com/apps/6823985032/distribution/reviewsubmissions/details/042bc18d-51c5-48b6-933a-c7223f7f0721) changed to **Rejected / Unresolved Issues**. Apple's message is “Guideline 2.1 - Information Needed - New App Submission”; it cites the account's limited App Review history and does not identify a specific code bug.
- Apple asks for a physical-device, latest-OS recording of the submitted app from launch through its normal flow (including applicable account creation/login/deletion, user-content safety, and paid-content access), plus purpose/audience, feature access and demo credentials, external services, regional differences, and regulated-industry/protected-material authorization where applicable. The answer must be sent in App Review messages and also retained in the version's App Review Information Notes. App Store Connect accepts `.mp4` attachments.
- Build 1.0 (2) remains the attached public-review build and is still Waiting for Review separately in external TestFlight; Colin remains listed with No Builds Available. The local device probe again timed out in CoreDeviceService, and USB inventory showed no attached iPhone. No recording or reply has been submitted yet.
- Draft answers and a recording checklist are saved in `ops/workflows/two-ios-apps-launch/app-review-response.md` and `app-review-video.md`; neither was sent to Apple. A new internal TestFlight group, [Fundhub Review QA](https://appstoreconnect.apple.com/teams/9a240a4e-6a7e-461b-9729-245258841181/apps/6823985032/testflight/groups/88fc36b9-6624-4b16-8bb0-81c5d66ffd46), was created with automatic distribution off and exact review build 1.0 (2) assigned as Ready to Test. It has **0 testers**: adding the account holder was stopped by access-change review pending explicit recipient/build approval, and the dialog was canceled. No TestFlight invitation was sent.
- Chris explicitly approved adding `bakerskater987@gmail.com` to that exact internal group/build. App Store Connect then confirmed **1 tester added**; the group shows **1 Tester / 1 Build**, with Chris's status **Invited**. No other access was changed.
- The wired physical iPhone 17 Pro Max is connected and has the exact submitted `ai.fundhub.app` version **1.0 (2)** installed. Its OS is **iOS 26.7.1**. Apple's current security-release page lists **iOS 27.0.1** as the latest version (`https://support.apple.com/en-us/100100`), so the device is not yet on the latest OS requested by App Review.
- The phone auto-locked during setup; a direct launch of `ai.fundhub.app` was rejected by iOS as **Locked**, and a device screenshot was black. Device Hub cannot screen-share this phone until iOS 27.0, and iPhone Mirroring on this Mac is signed out of iCloud. `devicectl device capture screen-record` is available as the direct recording route, but no walkthrough video has been captured or sent to Apple. The version's App Review Notes still contain only the prior brief login instructions.
- Chris reconnected and unlocked the iPhone; a direct launch of the installed review build then succeeded. Finder confirmed iOS 27.0.1 is available, and Chris explicitly approved that exact OS update. The update flow reached Apple's new iOS Software License Agreement; the user must personally click **Agree** in Finder. No agent accepted the agreement, and installation is not yet proven to have started.
- Chris replied “agree” to the Finder license handoff. The license sheet is no longer visible, but a fresh wired-device probe still reports **iOS 26.7.1**; the iOS 27.0.1 installation has not been verified. No latest-OS walkthrough recording or Apple response has been submitted.
- Follow-up device check at about 22:00 local still showed the phone connected and booted on **iOS 26.7.1**, with its passcode required. Finder's iOS-device sidebar option is enabled, but the iPhone is absent from its sidebar; Device Hub also reports that screen sharing requires iOS 27.0 or later. Recent MobileDeviceUpdater logs showed no download or installation progress. The update may need an on-phone unlock/prompt; do not infer that it started from the dismissed license sheet.

## Physical-device review capture — 2026-10-18

- The physical iPhone 17 Pro Max is now connected over `localNetwork`, booted on **iOS 27.0.1**, and unlocked. `devicectl device info apps` confirms the exact submitted `ai.fundhub.app` **1.0 (2)** is installed. Device Hub can now show and control its screen; a direct tap opened the native Fundhub sign-in screen.
- `devicectl device capture screen-record` reports that Screen Recording is unsupported on this wireless connection. A local Mac capture of the isolated Device Hub window is technically possible, and the mirror was enlarged to a readable portrait view. The brief test caught the owner using Messages, so its temporary video and extracted frame were deleted. No Fundhub walkthrough has been saved or sent.
- App Store Connect's existing in-app-browser tab currently shows an Apple sign-in page rather than an authenticated review page. Do not claim that the response or video is attached. The next capture should start only when the owner has paused other iPhone use, then include app launch, demo login, native Home, full portal, and sign-out; crop the Mac window recording to the phone image before attaching it.
- Chris made the phone available. A continuous **83-second** Mac recording of the live physical iPhone 17 Pro Max mirror now shows Home Screen launch of the exact installed Fundhub 1.0 (2), demo-client password login, native Home/file status, full client portal, marketing-notification section, and sign-out. The phone was on **iOS 27.0.1**. The portal exposed a temporary sign-in link in chat; the review copy covers that link for its entire appearance. The verified H.264 review file is `credentials/apple-review/fundhub-app-review-iphone17promax-ios27-build2-review.mp4` (intentionally ignored by Git because it records the owner's device). This is a Mac capture of a physical-device mirror, not a native iPhone screen-recording file. Do not send the unredacted source.
- App Store Connect is still signed out. Its passkey button in the in-app browser returned to the login form without authenticating, so **the recording is not yet attached, the App Review response is not sent, and the rejection is not resolved**.
- Apple's official App Store Connect API accepted review attachment `72840569-6961-47b5-8ed8-f7c3b065dfde` for the iOS 1.0 review detail and processed it to **COMPLETE**. The final 2,984-character response in `app-review-final-notes.txt` was saved to App Review Information → Notes and read back unchanged. Apple confirms the demo account name and password fields are populated; no password was printed or committed.
- The exact rejected iOS 1.0 item in submission `042bc18d-51c5-48b6-933a-c7223f7f0721` was marked resolved and the same submission resubmitted through Apple's API. A second read confirmed **WAITING_FOR_REVIEW** for both the submission and iOS version, with the video still **COMPLETE**. Fundhub is **not live**; Apple has not approved it. The separate App Review message thread was not sent because both available browser sessions were signed out (and the Chrome login frame did not load). The complete response is in Apple's version-specific Notes, not only in this repo.

## App Review 2.3.3 screenshots — 2026-10-20

- Apple rejected iOS 1.0 (2) again on 2026-10-20 (reviewed on iPad Air 11-inch M3) under **Guideline 2.3.3 Accurate Metadata**: the 6.1-inch iPhone screenshot set showed only the login screen. The 2.1 information request was not raised again. Source: the App Review message in App Store Connect submission `042bc18d-51c5-48b6-933a-c7223f7f0721`.
- Fix: three 1206 × 2622 screenshots of the app in use were cut from the existing physical-iPhone review recording of build 1.0 (2) (`credentials/apple-review/…-review.mp4`, seconds 59, 61 and 75, outside the 33–54 s redacted span): native Home "Your file", client portal welcome, and portal "What you own". Copies: `ops/workflows/two-ios-apps-launch/app-store-screenshots/`. They show the isolated review test client (`TEST — Client Role`), not a customer.
- Uploaded to the `APP_IPHONE_61` set through the App Store Connect API (all three `COMPLETE`), removed the old sign-in screenshot, marked the rejected item resolved and resubmitted. API and the App Store Connect page both read **WAITING_FOR_REVIEW** for the submission and iOS 1.0. Not approved, not live.
- The app is iPhone-only (`TARGETED_DEVICE_FAMILY = 1`), so no iPad screenshot set was added. Fundhub Prompter iOS 1.0 is still `PREPARE_FOR_SUBMISSION`; it was never sent to Apple.
- fundhub.ai and `/api/health` returned 200 (database up, 0 pending) during this check; the website was not down.

## Portal app live check — 2026-10-23

- App Store Connect API (read at 2026-10-23 21:29 UTC): **Fundhub Portal** (`ai.fundhub.app`, app 6823985032) iOS **1.0 is READY_FOR_SALE** (Ready for Distribution). Submission `042bc18d…` reads COMPLETE.
- Public store page returns 200: https://apps.apple.com/us/app/fundhub-portal/id6823985032 (title "Fundhub Portal App - App Store"). The iTunes lookup API still returned 0 results at the same moment; that search index lags behind the page.
- iOS **1.0.1** was submitted today (submission `beabaddf…`) and is **WAITING_FOR_REVIEW**. It is not live yet; 1.0 is what people download now.
- Fundhub Prompter iOS 1.0 and the Portal Mac 1.0 are still PREPARE_FOR_SUBMISSION (never sent to Apple).
- fundhub.ai `/api/health` 200, database up, 0 pending.

## Portal Mac submission — 2026-10-23

- Turned on Mac Catalyst for the existing `Fundhub` target. Bundle id stays `ai.fundhub.app`, so the Mac app joins the same App Store Connect record (universal purchase). Project changes: `SUPPORTS_MACCATALYST = YES`, `DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO`, `TARGETED_DEVICE_FAMILY = "1,6"` (iPhone plus Mac, no iPad), `LSMinimumSystemVersion 14.0`, and Mac-only entitlement files `Fundhub.Mac.entitlements` / `Fundhub.Mac.Release.entitlements` (App Sandbox, network client, camera, photo library, user-selected files, `com.apple.developer.aps-environment`). The Mac entitlements apply only to the macOS SDK, so the iOS build still uses its two original entitlement files. No Swift code needed changes; Catalyst built clean.
- iOS effect: none. Still iPhone-only (family 1,6 does not add iPad), so no iPad screenshot rule changes. `FundhubTests` on the iOS simulator: 14 tests, 0 failures.
- To sign the Mac development profile, this Mac mini (Provisioning UDID ending 420C01E) was registered as a MAC_OS device in the developer team through the API.
- Archive + upload: `Fundhub.xcarchive`, version 1.0, **build 5** (builds 1-4 were iOS), uploaded to App Store Connect with cloud-managed distribution signing. Build processed to VALID (min macOS 14.0). Export compliance set: `usesNonExemptEncryption = false`, same as iOS.
- MAC_OS 1.0 filled in from iOS 1.0: description (iPhone to Mac), keywords, promo text, support URL, copyright `2026 FUNDHUB LLC`, release MANUAL, review contact, demo account (same test client, password read from the iOS 1.0 review detail, not written here) and Mac-specific review notes. Category FINANCE, age rating and privacy URL are app-level and already shared.
- Four 1280 × 800 screenshots (signed in as the test client: Home, Money, Progress, Documents) are in `ops/workflows/two-ios-apps-launch/mac-app-store-screenshots/`, uploaded to the `APP_DESKTOP` set, all `UPLOAD_COMPLETE`.
- Separate review submission `acb738c1-7f7a-4b99-bad5-9553eb707c92` (platform MAC_OS) created and submitted 2026-10-23 21:51 UTC. Read back: submission `WAITING_FOR_REVIEW`; MAC_OS 1.0 `WAITING_FOR_REVIEW`. iOS 1.0.1 still `WAITING_FOR_REVIEW`, iOS 1.0 still `READY_FOR_SALE`, both untouched.
- Open: Apple has not reviewed it. The window shows the phone-width layout centered on dark sides at 1280 × 800; Apple could ask about that. The old local `ai.fundhub.mac` Prompter app is unrelated and unchanged.
