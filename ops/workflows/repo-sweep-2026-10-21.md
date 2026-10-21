# Repo sweep — nothing stranded (2026-10-21)

Owner order (Chris, 2026-10-21): "make sure all changes are committed to main and GitHub... not just your thread work. ALL work. We need to ensure everything is live."

Owner of this board: the sweep session (`unruffled-panini`). Started by the coordinator session. Read-only analysis was split across five analysts (prompts in the last section).

Rules held the whole time: no force-push, no rewrite of main, no deleted branch or data, no weaker test, no secret in git, Braum FH-000507 untouched, nothing merged that changes dashboard design (Codex owns design).

Main at the time of the sweep: `97860f770` → moved to `a21647dc2` while this ran (PRs #94, #101 merged by their own sessions).

## The short answer (4th grade English)

- **Nothing is lost.** All unsaved work in 8 folders is on GitHub in `backup/*-2026-10-21` branches. All 39 old git stashes are saved too (`backup/stashes-2026-10-21`). No secret went into any backup.
- **Most old branches are already on main.** 32 of the 88 unmerged branches and PRs are the same change that landed another way. 39 more are older versions of work that was redone. Merging them would undo newer fixes, so none was merged.
- **What I moved onto main** (in one sweep PR, so there is only one deploy): the morning-brief line, the teleprompter camera rules and tests (PR #50), the ad tonality tool (PR #52), the Blueprint timelapse (PR #115), two money-screen guard tests, 11 test files from the fin-b26 worktree, an iPhone Prompter crash fix, the Apple App Review record from 10-20, three work boards, Chris's Crafty/MCA to-do lines, and this board. PRs #94 and #101 were merged by their own sessions while this ran.
- **Closed because it is all on main already:** PRs #60 and #80.
- **Waiting on Chris:** permanent portal invite links, the Mac Bridge app (PR #88), the Cortana payment feed, the Crafty/MCA to-do lines.
- **Waiting on Codex (design or iPhone screens):** PRs #54, #64, #68, #72, #74 and the pieces listed in section D.
- Nothing was deleted. Nothing was force-pushed. No dashboard design was merged.

## A. Backups of unsaved work (done)

Method: a temporary index file, `git add -A`, `write-tree`, `commit-tree` on top of that folder's HEAD, then push to `refs/heads/backup/<name>-2026-10-21`. The folder, its real index, its stash and its branch were never touched. Every snapshot was scanned for key/token patterns before pushing (0 real hits; one fake test value in fin-b26).

| Backup branch on GitHub | From folder (branch) | Files | Notes |
|---|---|---|---|
| `backup/root-2026-10-21` | root checkout `/Users/chrisstanbridge/Developer/fundhub-platform` (`codex/two-ios-apps-launch`) | 179 | The big one: Capital Blueprint / Whop, invoice checkout retirement, LNR report, docs, rules. Triage in section B. |
| `backup/cortana-fee-invoices-2026-10-21` | `~/.codex/worktrees/cortana-fee-invoices` (`claude/cortana-weighted-feed`) | 24 | Cortana payment feed |
| `backup/dashboard-ux-polish-2026-10-21` | `~/.codex/worktrees/dashboard-ux-polish` (`codex/crm-astra-phone-stability`) | 3 | Three ops docs |
| `backup/exciting-ramanujan-2026-10-21` | `.claude/worktrees/exciting-ramanujan-40ff0e` | 16 | `.agents/skills/**`, `.codex/hooks.json` |
| `backup/nervous-swanson-2026-10-21` | `.claude/worktrees/nervous-swanson-5eba12` | 16 | Same 16 tooling files |
| `backup/fin-b11-2026-10-21` | `.claude/worktrees/fin-b11` | 14 | Old finish-853 proof tests |
| `backup/fin-b22-2026-10-21` | `.claude/worktrees/fin-b22` | 1 | One proof file |
| `backup/fin-b26-2026-10-21` | `.claude/worktrees/fin-b26` | 13 | Old read-contract tests |
| `backup/client-portal-ios-redo-local-2026-10-21` | local branch `codex/client-portal-ios-redo` | — | Local copy was 4 commits behind the remote copy, so nothing unique; saved anyway. |
| `backup/stashes-2026-10-21` | the shared stash stack (39 stashes, 2026-10-05 → 10-08) | 39 | One commit that has all 39 stash commits as parents, so each stays reachable. Scanned: no secrets. |

Left out on purpose (never in any backup):
- `.env*` files and `credentials/` (ignored anyway; only the names-only `.env.example` change was kept).
- Root `personal/` folder (5 private files: `cook-packet.pdf`, `meal-plan-arizona.md`, `my-meal-guide.md`, `reality-transurfing-steps-i-v.pdf`, `reality-transurfing-study-guide.md`).
- `.codex/config.toml` in the root, `exciting-ramanujan` and `nervous-swanson`: it holds a live access key in plain text. It stays out of git. Not touched.
- Root `.codex/worktrees/` (a nested worktree, clean), `test-results-webkit/` (test output).
- `research_notes/Licensed finance software access/vendor_routes.md` was CHECKED and is kept in the root backup: public vendor research with links, no credentials.

Other places checked for stranded work:
- 108 worktrees listed by git. 8 had uncommitted changes (all backed up above). 19 `/private/tmp` ones are already gone (git marks them prunable); nothing to save.
- 6 detached-HEAD worktrees: every commit is already inside main.
- `.claude/worktrees/slo-197`: an old (Oct 4) copy of the repo, not a git worktree. All 4,634 of its files already exist in git history (0 unique). Nothing to save.
- Local branches not on GitHub: none (the one diverged branch is covered above).
- Local `fin/b01`..`fin/b26`, `fin/base`, `fin/integrate`: all already inside main.

## B. Every unmerged branch and open PR, sorted

The four classes (Chris's rule): **1** already on main (same change landed another way) · **2** still needed and not design · **3** changes dashboard design / HTML / CSS / visible words (Codex owns it, never merged here) · **4** obsolete or superseded (older version of work redone and merged).

How each was judged (read-only, pinned to main `97860f770`): `git cherry` patch ids, `git merge-tree` (what a merge would really change), file-by-file blob compare against main, then a hand check of every claim that mattered. Full evidence per branch is in the five appendix files in `ops/workflows/repo-sweep-2026-10-21/`. Nothing was deleted. No branch was force-pushed. No dashboard design file was merged.

### Numbers (88 branches and PRs, plus the 28 `fin/*` branches)

| | Count |
|---|---|
| Class 1 — already on main | 32 (+ all 28 local `fin/*` branches) |
| Class 2 — still needed, not design | 15 |
| Class 3 — design / Codex | 2 |
| Class 4 — obsolete / superseded | 39 |

Of the 15 class-2 items: **9 were carried to main or merged** (brief line, PR #50, #52, #115, #94, #101, the netlify doc line, the App Review record from #68, the fin-b26 tests), **6 are waiting** (PR #88, PR #64, the Cortana feed, fin-b11 tests, dashboard-ux-polish notes, the exciting-ramanujan skills). The root checkout backup is judged separately in section C.

### Open PRs (16 at the start)

| PR | Branch | Class | After the sweep |
|---|---|---|---|
| #50 | `claude/teleprompter-lock` | 2 needed | CARRIED to main in the sweep PR (both commits). PR #50 closes as carried. |
| #52 | `claude/ad-tonality-system` | 2 needed | CARRIED to main in the sweep PR (the tool + first report; the old TODO.md commit was left out). PR #52 closes as carried. |
| #53 | `todo/mca-flow-2026-10-16` | 4 obsolete | CARRIED: Chris's three 10-16 items copied word for word into TODO.md. Chris, say if they are still open. PR #53 closes as carried. |
| #54 | `codex/company-app-funnel-download` | 3 design | WAITING FOR CODEX: changes a public funnel page (visible words). App is not live yet. |
| #55 | `codex/fundhub-prompter-appstore` | 4 obsolete | Crash fix CARRIED to main (empty scroll track no longer stops the iPhone Prompter app; proved by running it). The rest is obsolete (login was removed). |
| #60 | `codex/appstore-release-records` | 1 on main | CLOSED by the sweep: all of it is already on main (7 of 8 commits match main commits; the 8th only drops the word "now"). |
| #62 | `codex/portal-release-evidence` | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| #64 | `codex/call-invite-push` | 2 needed | WAITING FOR CODEX: the backend (push 15 min before a call) is real work main lacks and merges nearly clean. Not merged because it adds a customer send path with no pulse row of its own (repo law: a failed change), the app is not live yet, and the Join Call button is design. Files are listed in the appendix. |
| #68 | `codex/two-ios-apps-launch` | 2 needed | PARTLY CARRIED: the 2026-10-20 Apple App Review record + 3 screenshots and the three boards went to main. The iPhone app shell (same as PR #72), Cortana notes and Ghost Guard files stay on this branch (saved on GitHub). Draft PR #68 stays open for Codex. |
| #72 | `codex/live-ios-teleprompter` | 3 design | WAITING FOR CODEX: iPhone app screens. The 2 red checks are one flaky test (same commit passed in the sister run). Same change is also inside PR #68. |
| #74 | `codex/crm-live-font-reconcile` | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| #80 | `codex/astra-team-access-comparison` | 1 on main | CLOSED by the sweep: its one commit is already on main through PR #81, and its base branch was merged in PR #76. |
| #88 | `feat/mac-bridge-v1` | 2 needed | WAITING FOR CHRIS: draft, all new files, CI 28/28, nothing deploys. Needs a yes because v2 lets the phone start tasks on the Mac, the helper listens on all network interfaces over plain HTTP with a token, the PR text is out of date, and 26 files are an iPhone app (Codex owns iPhone screens). |
| #94 | `claude/silly-elion-fb36a2` | 2 needed | MERGED to main by its own session (908cca964) while this sweep ran. |
| #101 | `claude/awesome-shaw-4103bc` | 2 needed | MERGED to main by its own session (a21647dc2) while this sweep ran. |
| #115 | `demo/blueprint-timelapse` | 2 needed | CARRIED to main in the sweep PR (script, fixtures, 4K video, 3 stills; adds 8.6 MB). PR #115 closes as carried. |

### All items

| Branch / PR | Class | What it does | After the sweep |
|---|---|---|---|
| `codex/heartbeat-catalog-guards-c (none)` | 1 on main | Fixes three old test checks so they match the shipped product. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-crm-staff-display-2026-10-18 (none)` | 1 on main | Fixes the display checks for the CRM staff pages after main moved. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-customer-journey-d-handoff (none)` | 1 on main | Fixes red checks in the customer journey (climate map file, private leads page, final-results test, two workflows). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-proof-f (none)` | 1 on main | One note file that lists the display checks still open. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-flow-read-proof (none)` | 1 on main | Adds a check that the climate catalog read gives the right answer. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-galaxy-teams-links-2026-10-18 (none)` | 1 on main | Fixes the galaxy page link checks. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-money-b (none)` | 1 on main | Test-only fixes for the money checks (bank role, poll time, database test setup). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-money-workspace (none)` | 1 on main | Fixes the money workspace heartbeat checks. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-route-proofs (none)` | 1 on main | Ties each route check to one exact test case. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-route-repair-j (none)` | 1 on main | Closes the last route repair batch (J) for the heartbeat. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-stale-expectations-a (none)` | 1 on main | Updates two old test expectations (journey, accounts receivable). | Already on main. Marked done. Nothing to merge. |
| `codex/ship-admin-migrations (PR #61, merged 2026-10-17)` | 1 on main | Makes the ship step run database changes through the admin connection. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-messaging-c-main (none)` | 1 on main | Stops the same text going out twice to one person, and tests that the push alert follows. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-public-links (none)` | 1 on main | Adds checks that public page links land on the right place. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-shell-sidebar-current-main (none)` | 1 on main | Updates the sidebar and shell checks to the new CRM look, plus a small status-chip color rule in shell.js. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-20-25 (none)` | 1 on main | Fixes the display checks for rows 20 to 25 (inquiry remover and bank pages). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-26-33 (none)` | 1 on main | Fixes display checks for rows 26 to 33 (ops admin, partner galaxy, pipeline). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-34-36 (none)` | 1 on main | Fixes the commission ledger and the sales floor daily target. | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-37-45 (none)` | 1 on main | Fixes display checks for rows 37 to 45 (social studio, teleprompter, teams). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-display-repair-i (none)` | 1 on main | Fixes the first six display check gaps (agent editor, client control panel, documents, galaxy). | Already on main. Marked done. Nothing to merge. |
| `codex/heartbeat-catalog-four (none)` | 4 obsolete | Proves four catalog results at the third proof level. | Obsolete / superseded. Marked, not deleted. |
| `codex/heartbeat-display-13-19-work (none)` | 4 obsolete | Fixes the messaging and journeys display checks (rows 13 to 19). | Obsolete / superseded. Marked, not deleted. |
| `codex/heartbeat-messaging-c (none)` | 4 obsolete | Wires the messaging heartbeat checks (duplicate text guard, push alert policy, job proofs). | Obsolete / superseded. Marked, not deleted. |
| `codex/heartbeat-customer-journey-d (none)` | 4 obsolete | Draft of the customer journey fix, plus a booking-failure retry change. | Obsolete / superseded. Marked, not deleted. |
| `fix/display-lane-time (none)` | 4 obsolete | Makes the display check lane run fast enough for ship (under 20 seconds). | Obsolete / superseded. Marked, not deleted. |
| `codex/home-upload-retry-reconcile (none)` | 4 obsolete | Fixes one upload test and adds a short evidence note. | Obsolete / superseded. Marked, not deleted. |
| `fix/brief-whole-suite (none)` | 2 needed | Adds one sentence to the morning and evening brief: "Whole company: N of M items have a test or live check behind them." It says nothing if the catalog row is missing. | CARRIED to main in the sweep PR (the brief now says the whole-company number). |
| `codex/recover-contracts` | 1 on main | New look for the Contract templates page. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-csm-queue` | 1 on main | New look for the Client Success queue page. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-finance-os` | 1 on main | New look for the Finance OS staff page, plus tests. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-lenders` | 1 on main | New look for the Lenders page. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-my-numbers` | 1 on main | New look for the My numbers page for sales staff. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-sales-floor` | 1 on main | New look for the Sales floor page, plus tests. | Already on main. Marked done. Nothing to merge. |
| `codex/recover-automations` | 4 obsolete | Older 10-18 redo of the Workflows page layout. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-consent-capture` | 4 obsolete | Older 10-18 redo of the Consent desk page look. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-inquiry-remover` | 4 obsolete | Older 10-18 redo of the Specialist (inquiry) page look. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-journeys` | 4 obsolete | Older 10-18 redo of the Journeys editor look, with keyboard helpers. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-ops-admin` | 4 obsolete | Older 10-18 redo of the Ops and Admin page look. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-payment-success` | 4 obsolete | Older 10-18 redo of the payment return page. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-reset-password` | 4 obsolete | Older 10-18 redo of the password reset page. | Obsolete / superseded. Marked, not deleted. |
| `codex/recover-staff-teams` | 4 obsolete | Older 10-18 redo of the Staff and Teams page, with read-state handling. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-live-font-reconcile (PR #74, draft, open)` | 4 obsolete | Second wave of the professional-layout redo for four account pages. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-portal-layout-professional (PR #69 closed draft)` | 1 on main | The big 10-18 redo of CRM and client-portal pages. | On main. Two guard tests CARRIED to main in the sweep PR. Everything else on it is a design redo main has newer versions of. Do not merge. |
| `codex/fundhub-crm-html-export` | 4 obsolete | A copy of the app's web pages for Gemini to read, saved as a branch. | Obsolete / superseded. Marked, not deleted. |
| `codex/client-portal-ios-redo (PR #67 closed draft)` | 4 obsolete | First iOS-style redo of the client portal pages. | Obsolete / superseded. Marked, not deleted. |
| `backup/client-portal-ios-redo-local-2026-10-21` | 4 obsolete | A saved copy of the older iOS redo branch. | Nothing unique (older than the remote copy). Kept. |
| `codex/crm-reconcile-scan` | 4 obsolete | A bot report saying how a merge of the old design would go. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39158495327` | 4 obsolete | Same bot report, run id 39158495327. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39158754152` | 4 obsolete | Same bot report, run id 39158754152. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39160267751` | 4 obsolete | Same bot report, run id 39160267751. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39160775087` | 4 obsolete | Same bot report, run id 39160775087. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39162023133` | 4 obsolete | Same bot report, run id 39162023133. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39163499187` | 4 obsolete | Same bot report, run id 39163499187. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39164009036` | 4 obsolete | Same bot report, run id 39164009036. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39164519842` | 4 obsolete | Same bot report, run id 39164519842. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39164782650` | 4 obsolete | Same bot report, run id 39164782650. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39165734460` | 4 obsolete | Same bot report, run id 39165734460. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39166186746` | 4 obsolete | Same bot report, run id 39166186746. | Obsolete / superseded. Marked, not deleted. |
| `codex/crm-reconcile-scan-39167073054` | 4 obsolete | Same bot report, run id 39167073054. | Obsolete / superseded. Marked, not deleted. |
| `PR #80 codex/astra-team-access-comparison (draft, OPEN, base codex/dashboard-ux-polish)` | 1 on main | Evidence-only comparison of the Astra Team and Access screen. | Already on main. Marked done. Nothing to merge. |
| `codex/two-ios-apps-launch (PR #68, draft)` | 2 needed | Kitchen-sink "launch follow-through" branch. It holds: (a) the Apple App Review record for 2026-10-20 (Apple rejected iOS 1.0 (2) under 2.3.3, 3 new screenshots, resubmitted, Waiting for Review) that main does not have; (b) the sa | PARTLY CARRIED: the 2026-10-20 Apple App Review record + 3 screenshots and the three boards went to main. The iPhone app shell (same as PR #72), Cortana notes and Ghost Guard files stay on this branch (saved on GitHub). Draft PR #68 stays open for Codex. |
| `codex/live-ios-teleprompter (PR #72)` | 3 design | Makes the separate iPhone Prompter app open the live web teleprompter (`https://fundhub.ai/app/teleprompter.html`) straight away: no login, no bundled practice scripts, camera/mic allowed only for fundhub.ai, takes saved to the ap | WAITING FOR CODEX: iPhone app screens. The 2 red checks are one flaky test (same commit passed in the sister run). Same change is also inside PR #68. |
| `codex/call-invite-push (PR #64)` | 2 needed | 15 minutes before a booked call, after the real "handoff" text is sent, send one fixed lock-screen push ("Your call starts soon. Open Fundhub to join.") to the client's iPhone app only. It first re-checks the booking and that the  | WAITING FOR CODEX: the backend (push 15 min before a call) is real work main lacks and merges nearly clean. Not merged because it adds a customer send path with no pulse row of its own (repo law: a failed change), the app is not live yet, and the Join Call button is design. Files are listed in the appendix. |
| `codex/appstore-release-records (PR #60)` | 1 on main | App Store release notes (Apple build identity, privacy answers, review packet, Mac/Prompter status) and the export options file. | Already on main. Marked done. Nothing to merge. |
| `codex/fundhub-prompter-appstore (PR #55, draft)` | 4 obsolete | Prepares Prompter App Store "build 2": fixes a startup crash, removes the 4K picker the camera code could not honor, adds a Privacy link, drafts the store listing and screenshots. | Crash fix CARRIED to main (empty scroll track no longer stops the iPhone Prompter app; proved by running it). The rest is obsolete (login was removed). |
| `codex/company-app-funnel-download (PR #54, draft)` | 3 design | Adds a hidden "Take Fundhub with you" App Store card to the `/thank-you` funnel page. Stays hidden until a verified Apple listing URL is set; removes the old Prompter card from that page. | WAITING FOR CODEX: changes a public funnel page (visible words). App is not live yet. |
| `codex/portal-release-evidence (PR #62)` | 4 obsolete | A dated note that the 10-17 release was blocked on one expired deploy credential. | Obsolete / superseded. Marked, not deleted. |
| `codex/netlify-modern-ad-video-worker` | 2 needed | A one-line history note: PR #79 merged, ship passed, site healthy. | CARRIED to main in the sweep PR (one true doc line). |
| `codex/outreach-network-diagnosis` | 4 obsolete | A one-off experiment to find why the hourly proof stalled on the release runner. | Obsolete / superseded. Marked, not deleted. |
| `claude/teleprompter-lock (PR #50, open)` | 2 needed | Adds tests that lock the owner's camera rules (front camera saved mirrored, back camera not, no editor on long-press) and writes the rule for Claude and Cursor. No app code changes. | CARRIED to main in the sweep PR (both commits). PR #50 closes as carried. |
| `claude/ad-tonality-system (PR #52, draft)` | 2 needed | A Python tool that listens to the filmed ad takes and scores pace, pauses, pitch and loudness against the script marks, plus the first report on 17 takes. | CARRIED to main in the sweep PR (the tool + first report; the old TODO.md commit was left out). PR #52 closes as carried. |
| `todo/mca-flow-2026-10-16 (PR #53, open)` | 4 obsolete | A dated TODO block: get a new MCA referral link from Crafty, set up the MCA email flow, push the MCA and SBA deals. | CARRIED: Chris's three 10-16 items copied word for word into TODO.md. Chris, say if they are still open. PR #53 closes as carried. |
| `feat/mac-bridge-v1 (PR #88, draft)` | 2 needed | A Mac helper plus an iPhone app that shows Claude/Codex/Cursor chats and commands, and (v2) lets Chris start a task from the phone. | WAITING FOR CHRIS: draft, all new files, CI 28/28, nothing deploys. Needs a yes because v2 lets the phone start tasks on the Mac, the helper listens on all network interfaces over plain HTTP with a token, the PR text is out of date, and 26 files are an iPhone app (Codex owns iPhone screens). |
| `demo/blueprint-timelapse (PR #115, draft)` | 2 needed | A demo script and a 20-second 4K timelapse of six months of the Capital Blueprint, driven on the real portal screens with fake data. | CARRIED to main in the sweep PR (script, fixtures, 4K video, 3 stills; adds 8.6 MB). PR #115 closes as carried. |
| `claude/silly-elion-fb36a2 (PR #94, open)` | 2 needed | Docs: a lesson that the morning scorecard never stopped saving, plus the board listing that day's red ids. | MERGED to main by its own session (908cca964) while this sweep ran. |
| `claude/awesome-shaw-4103bc (PR #101, open)` | 2 needed | Records the owner-approved delete of the fake test data (100 clients, 817 rows) with the plan and the scripts, plus a one-minute clock-flake fix in one test. | MERGED to main by its own session (a21647dc2) while this sweep ran. |
| `claude/inngest-stop-2026-10-20 (PR #109, CLOSED 2026-10-21 17:04:47Z)` | 4 obsolete | An older fix for the Inngest free-plan overrun: run the timed jobs less often. | Obsolete / superseded. Marked, not deleted. |
| `board/blueprint-launch` | 1 on main | A board doc for the 10-15 Capital Blueprint launch. | Already on main. Marked done. Nothing to merge. |
| `claude/funny-sinoussi-765e2b` | 1 on main | A board doc for the bank-outreach automation (owner GO, live settings). | Already on main. Marked done. Nothing to merge. |
| `lp/r15-csm-picker-no-demo` | 1 on main | Stops the Blueprint CSM picker from giving a paying client to the demo CSM row. | Already on main. Marked done. Nothing to merge. |
| `diag/linux-get-stall-fix (no PR)` | 4 obsolete | Throwaway diagnostics for the Linux ship hang (silent GET to fundhub.ai from GitHub runners). | Obsolete / superseded. Marked, not deleted. |
| `backup/cortana-fee-invoices-2026-10-21` | 2 needed | The Cortana payment feed: each paid Commas/Whop payment is sent once to three Cortana buckets (Soft Pull, New Deals Closed, All Payments). Off unless CORTANA_FEED_ENABLED=1 and 3 webhook URL env vars are set. | WAITING FOR CHRIS: real work found nowhere else (Cortana payment feed). Not merged as is: it is unfinished work from a Codex folder that may still be active, four files conflict, its timed job must move to the new Netlify clock, migration 499 is taken on main, and when switched on it sends customer name, email, phone and amount to Cortana. Off unless CORTANA_FEED_ENABLED=1. |
| `backup/dashboard-ux-polish-2026-10-21` | 2 needed | Codex's status notes for the CRM Astra rollout: PR #84 CI result (14/14 jobs), the 18-run live speed measurement (4 pages miss a budget), two read-only diagnosis tasks handed out. Notes only; no design change. | LEFT FOR CODEX: 3 Codex status notes with dead evidence links. Backup kept. |
| `backup/exciting-ramanujan-2026-10-21` | 2 needed | Gives Codex its own copies of the Fundhub skills and a Codex hook file (session-start "split first" reminder, block edits to *-intended.md, lint+tsc on stop). | LEFT FOR CODEX: Codex copies of 15 Fundhub skills + hooks file. 12 of 15 are exact copies of .cursor/skills (they can drift). Backup kept. |
| `backup/nervous-swanson-2026-10-21` | 4 obsolete | Same Codex skills/hooks files as exciting-ramanujan, saved a second time from another worktree. | Duplicate of backup/exciting-ramanujan. Marked obsolete; kept. |
| `backup/fin-b11-2026-10-21` | 2 needed | Stronger practice tests for the Company Brain and Creative Factory screens and their handlers. | LEFT FOR AN AGENT WITH A BROWSER: 6 new test files found nowhere else; the page tests drive pages restyled many times since, and generated.json conflicts. Backup kept. |
| `backup/fin-b22-2026-10-21` | 4 obsolete | A one-line tweak to a "not shipped" pulse proof. It would drop the check that the page is still the Lending Climate Dashboard. | Obsolete / superseded. Marked, not deleted. |
| `backup/fin-b26-2026-10-21` | 2 needed | Stronger practice tests for the Inquiry desk, Inbox, Message templates, My numbers, Social and Training endpoints. | 11 of 13 files CARRIED to main (suite 139 -> 152 passing). Left: social-posts test (main changed it, needs a hand port) and inquiry-cases test (saved draft has a syntax error). |

## C. The root checkout backup (`backup/root-2026-10-21`), cluster by cluster

114 of 179 files are already on main (59 identical, 55 where main has a newer version). 65 are not. Only 3 groups of real code are at risk; the rest is old boards, evidence and tool config. Do NOT merge the whole backup branch: its old copies would undo PR #113 (Inngest cron removal), drop migrations 482-502 from `db/expected-migrations.mjs`, and bring back older hardened code.

| Cluster | Class | After the sweep |
|---|---|---|
| A. Capital Blueprint checkout, price, advisor/voice context (40 files: src/payments/whop-blueprint*, src/messaging/providers/whop-payments.mjs, src/co | 1 on main | Already on main. Marked done. Nothing to merge. |
| D. Whop billing inbox + sweeper (14 files: src/payments/whop-billing-*, src/workflows/whop-billing-inbox-drain*, netlify/functions/whop-billing-inbox- | 1 on main | Already on main. Marked done. Nothing to merge. |
| E. Invoice checkout retirement + per-round consulting invoices + AR copy (31 files: src/payment-links/*, src/handlers/invoice-checkout-retirement*, sr | 1 on main | Already on main. Marked done. Nothing to merge. |
| F. Funding-fee-task reconcile (5 files: src/funding/reconcile-fee-tasks*, scripts/reconcile-funding-fee-tasks.mjs, billed-fee-check*) | 1 on main | Already on main. Marked done. Nothing to merge. |
| G. Cortana funnel tracking (4 files: public/funnel/fh-events.js, src/ads/fh-events-*, docs/tracking/tracking-spec.md) | 1 on main | Already on main. Marked done. Nothing to merge. |
| H1. Agent rules (finish-the-requested-job, split-and-proceed, settings.json; CLAUDE.md, AGENTS.md, .env.example) | 1 on main | Already on main. Marked done. Nothing to merge. |
| H2. .agents/skills (15 files) + .codex/hooks.json | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| H3. ops/workflows/AGENTS-local-backup-2026-10-12.md (49 KB) | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| I. Teleprompter live evidence for commit 0b42d2de (8 files, 4 JSON + 3 PNG + 1 JSON, ~1,077 lines + 3 images) | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| J. Ops boards (14 not on main + 5 where main has a newer copy) | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| N. Banks page "staff or client" fix + desk fixes (11 files: api/money/banks.mjs, public/app/money-banks.js, money-banks tests, inquiry-remover.html, p | 1 on main | Already on main. Marked done. Nothing to merge. |
| K. Permanent client portal invites (10 files) | 2 needed | WAITING FOR CHRIS: real code found nowhere else, touches sign-in and adds a database change that applies on the next deploy. Decide first: should EVERY staff-sent portal link never expire (it also changes soft-pull and the SLO buyer link)? Then an agent opens a fresh branch with only the 10 invite files. |
| L. LNR business report desk (6 files) | 2 needed | WAITING FOR CHRIS/CODEX: not wired in (no route, no pulse rows); adding the handler alone fails the routes test. The page is design. Backup kept. |
| M. Prompter thank-you card: TestFlight to App Store (7 files) | 3 design | WAITING FOR CODEX: changes visible words and the link rule on a funnel page. |
| M2. cf-push-snapshots head/footer html (2 files) + fundhub-live-marketing-push-preference.png | 4 obsolete | Obsolete / superseded. Marked, not deleted. |
| O. research_notes/Licensed finance software access/vendor_routes.md (15 KB) | 4 obsolete | Obsolete / superseded. Marked, not deleted. |

## D. Waiting on someone (nothing here is lost; each is saved on GitHub)

**Chris decides**
1. **Permanent portal invite links** (`backup/root-2026-10-21`, 10 files incl. migration 480). Should every staff-sent portal link never expire? It also changes the soft-pull and SLO buyer links. After a yes: a fresh branch off main with only the invite files, migration slot 480 (free on main), drop the duplicate seed 035, run the pg test on a scratch database.
2. **Mac Bridge** (PR #88, draft). Publish it? v2 starts tasks on the Mac from the phone; the helper listens on all interfaces over plain HTTP with a token; the PR text is stale; 26 files are an iPhone app.
3. **Cortana payment feed** (`backup/cortana-fee-invoices-2026-10-21`). Finish and ship? It needs a port first (4 conflicting files, cron onto the Netlify clock, new migration number) and it sends customer name, email, phone and amount to Cortana when switched on.
4. **Crafty / MCA to-do lines** (now in `TODO.md`). Still open?
5. `recordBooking` throwing on a failed booking write (idea dropped from `codex/heartbeat-customer-journey-d`; main's own comment says it must not throw). Only if Chris wants it.

**Codex (design or iPhone screens — not merged by this sweep)**
- PR #72 (live iPhone teleprompter; same change is inside PR #68), PR #68 rest (iPhone shell, Cortana notes, Ghost Guard files), PR #54 (company app download card), the root-backup Prompter thank-you card (cluster M), PR #64 Join Call button and iOS parts, LNR business report page.
- PR #64 backend (push 15 min before a call): real, merges nearly clean, needs its own pulse row first (repo law for a new send path), then land with the portal card.
- PR #74 and the 8 older `recover-*` page redos: main carries the newer Astra version of every page. Codex confirms they are obsolete.
- `codex/fundhub-crm-html-export` is a generated export for Gemini. Merging it would delete about 6,700 files. Never merge.
- 13 `crm-reconcile-scan-*` branches are one bot report copied 13 times. `crm-live-reconcile.yml` makes a new one every time `codex/crm-live-font-reconcile` is pushed.
- `.agents/skills` + `.codex/hooks.json` copies, and three Codex status notes (`backup/exciting-ramanujan`, `backup/dashboard-ux-polish`).

**An agent with a browser**
- `backup/fin-b11-2026-10-21`: 6 new "cycle 2" proof tests + kit. `backup/fin-b26-2026-10-21`: two files left (`social-posts`, `read-inquiry-cases`, which has a syntax error in the saved draft).

**Ship gate, known leftover (not fixed here)**
- On the Linux runner the `apply-links` beat takes 3.4–6.5 s. In 5 of 12 ship runs it passed half its 12 s deadline and the pre-deploy proof stopped the ship (ship run 39645331437 for main `97860f770` stopped this way, and an earlier one on a connection-count check). Main is the source of truth and live health reads pending 0, but a stopped ship means the newest main is not deployed until a run passes. Written up in `ops/workflows/codex-finish-2026-10-20.md`, section D.

## E. Follow-up prompts (copy, paste, go — each stands alone)

1. *Permanent portal invites:* "In /Users/chrisstanbridge/Developer/fundhub-platform, after Chris says yes, make a fresh branch off origin/main and bring over only the 10 invite files listed in `ops/workflows/repo-sweep-2026-10-21/triage-G5-root-checkout-backup.md` section S1 from `origin/backup/root-2026-10-21`. Use migration slot 480, drop the duplicate seed 035, add the line to `db/expected-migrations.mjs`, run `src/auth/magic-link.pg.test.mjs` on a scratch database (never production), open a PR, wait for 28/28, merge."
2. *fin-b11 and fin-b26 leftovers:* "Read `ops/workflows/repo-sweep-2026-10-21/triage-G4-claude-and-misc.md` ('Class 2 detail'). Carry the remaining files from `origin/backup/fin-b11-2026-10-21` and the two left from `origin/backup/fin-b26-2026-10-21` onto a fresh branch off origin/main. Run each test first with a browser; never weaken a test; PR, 28/28, merge."
3. *Apply-links timing:* see `ops/workflows/codex-finish-2026-10-20.md` section D, the prompt under "Leftover — apply-links timing".

## F. How this was checked

- Back-ups: temporary index file → `commit-tree` on top of each folder's HEAD → push to `refs/heads/backup/...`. Each snapshot was scanned for key/token/private-key/password patterns before pushing.
- Triage: five read-only analysts (one per group), then spot-checked by the sweep session. Each claim in a table has a commit sha, a PR number or a file behind it.
- Carry-over: every carried piece was run before it went in (brief tests 40/40; money tests 37/37; fin-b26 152/152; `npm run lint` clean; the Prompter fix compiled and run on this Mac: main's code stops with "Range requires lowerBound <= upperBound", the fixed code returns zeros). The PR's CI (28 checks) is the gate for the rest.
