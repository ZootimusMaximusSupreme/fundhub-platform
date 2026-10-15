# Batch 15 manifest: Lenders desk and Marketing Command Center (finish the 853)

Branch `fin/b15`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b15`. Nothing was pushed or merged.
Lane: `gap-catalog-display`. Tier 4. Generation 1 of 3 (resumed 2026-10-14 night: the muted Try again tests found in the working folder were finished, mutation-checked and committed; row 31 moved from left-out to practice test).

## The number

| | Rows |
|---|---|
| Rows in this batch | 40 |
| Open (NOT_PROVED) before | **40** (measured again on `fin/base` in a clean checkout) |
| Open after | **0** |
| Live checks | 26 |
| Practice tests | 14 |
| Not attachable (with the exact reason) | 0 |

Measured with `node scripts/pulse/count-not-proved.mjs` in this worktree, intersected with `batch-15.json`.
Whole lane: 853 open before, 813 after (40 fewer, all from this batch).

How to read "live check" honestly: the count script runs the lane with no database, so a live check
reads as `skip` there and leaves the NOT_PROVED list. With a database (the morning pulse) each of the 26
runs its read-only SQL for the company and answers PASS, or FAIL on the first wrong saved result. A control
nobody has used yet has no results; those 25 checks say "no saved results yet, none are wrong" and go
red on the first wrong one (`emptyAs: "quiet"`). The lender book check leaves that off on purpose: an
empty book is red, like the page's own empty-book banner. None of the SQL was run against the live
database (there is no local Postgres on this Mac and the brief forbids it). Each text runs unchanged over
stand-in rows in SQLite (see below).

## Every row

| # | Row (screen: control) | Outcome | Where | What judges it |
|---|---|---|---|---|
| 1 | lenders.html: Mismatch queue row: Dismiss button | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-dismiss`: every dismissed observation is flagged as a mismatch, still says which bureau was seen, still names its lender |
| 2 | lenders.html: Page gate: owner, admin, funding_advisor only (read + write endpoints return 403 to every other role) | practice-test | `src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs` | the real handlers, all 10 sign-in kinds; only owner, admin, funding advisor get past; 6/6 breaks red |
| 3 | lenders.html: Page load: list read + mismatch-queue read; empty-book banner | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-page-load`: the book must have non-demo lenders (empty book is red), every lender named, every open mismatch complete |
| 4 | lenders.html: Tab: AI bureau config | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-ai-bureau-tab`: code and name present, at least one try, no negative wait or hold, verified-by never blank |
| 5 | lenders.html: Tab: Bureau mismatch queue (with open-count badge) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-mismatch-tab`: each open mismatch names the bureau seen, names a lender, and points only at a lender of this company |
| 6 | lenders.html: Tab: Lender list | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-list-tab`: name present, no negative dollar amount, starting line not above the biggest known line (demo lenders left out like the page does) |
| 7 | marketing-command-center.html: Frame: 5-minute auto reload, reload on focus, footer 'as of' stamp | practice-test | `e2e/marketing-command-center.spec.mjs (3 tests) + new test 'the reload on focus: ...'` | 5-minute reload, reload on focus (new test), hung read, footer stamp; 6 breaks red |
| 8 | marketing-command-center.html: Frame: gear button (opens Settings tab, Today comes back as it was) | practice-test | `e2e/marketing-command-center.spec.mjs` | gear opens Settings, Today comes back as it was (2 breaks red) |
| 9 | marketing-command-center.html: Frame: tab strip (Today, Ideas, Scripts, Shoot, Launch, Numbers) with hash routing that keeps its place | practice-test | `e2e/marketing-command-center.spec.mjs` | strip order and members, hash routing, address corrected, last tab remembered; 5 breaks red |
| 10 | marketing-command-center.html: Ideas flywheel step 1 (avatar): run button 'Build the avatar', Read it, Approve, Tweak, Resume / Start over / ... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-1-avatar`: step 1: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued |
| 11 | marketing-command-center.html: Ideas flywheel step 2 (ad-research): run button 'Research the market', Read it, Approve, Tweak, Resume / Start... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-2-ad-research`: step 2: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued |
| 12 | marketing-command-center.html: Ideas flywheel step 3 (offer): run button 'Write the offer', Read it, Approve, Tweak, Resume / Start over / Re... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-3-offer`: step 3: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued (offer: holds offer and document) |
| 13 | marketing-command-center.html: Ideas flywheel step 4 (copy): run button 'Write the copy; needs step 3 approved', Read it, Approve, Tweak, Res... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-4-copy`: step 4: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued |
| 14 | marketing-command-center.html: Ideas flywheel step 5 (ad-strategy): run button 'Pick the strategy; needs steps 3 and 4 approved', Read it, Ap... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-5-strategy`: step 5: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued |
| 15 | marketing-command-center.html: Ideas flywheel step 6 (spend): run button 'Read the spend (free, no model)', Read it, Approve, Tweak, Resume /... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-flywheel-6-spend`: step 6: saved stage file starts with its own stamp, approve sets status approved only, finished run has its file queued (spend: saved as the spend file) |
| 16 | marketing-command-center.html: Ideas funnels: 'Change the address' input + 'Save the address' | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-funnel-rename`: every built funnel has exactly its 3 pages and each page sits at the address the funnel makes |
| 17 | marketing-command-center.html: Ideas funnels: 'See the pages' / 'Hide the pages' + preview role buttons (sandboxed page preview) | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | See the pages, sandbox with no scripts, the three page buttons, Hide the pages; 4 breaks red |
| 18 | marketing-command-center.html: Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-funnel-build`: every written page comes from a finished funnel job with a passed copy check and carries tag, tracking config and pixel |
| 19 | marketing-command-center.html: Ideas: 'Go to step N' jump button | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | Go to step N moves focus to that step's run button and sends nothing (1 break red) |
| 20 | marketing-command-center.html: Ideas: angles list: 'Make more of this' button on each angle | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-ideas-make-more`: each make-more idea carries its angle key, names the angle, and has its idea file queued in the repo outbox |
| 21 | marketing-command-center.html: Ideas: month spend meter (used of cap) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-month-meter`: priced models are saved with their price (opus not zero, claude-code free), none saved unknown; SQL names every model in MODEL_PRICES |
| 22 | marketing-command-center.html: Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain'... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-research-card`: finished report has its file queued, approved report has a named approver and its approved file queued, tweak points at a real earlier run with a note |
| 23 | marketing-command-center.html: Ideas: research form: question box, depth toggle (Quick look / Leave nothing unturned), 3 source checkboxes, b... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-research-form`: question kept, depth is quick or deep, stop amount above zero, finished run names its repo file |
| 24 | marketing-command-center.html: Launch: 'Load all approved' (asks first, then {all:true}) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-launch-load-all`: every meta_load job names an approved ad video of this company; a loaded video carries its Meta ad id and our ad row |
| 25 | marketing-command-center.html: Launch: 'Load to Meta' per approved video, and 'Retry load' (creates the ad PAUSED, $0) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-launch-load-one`: loaded video was approved by a person, has three Meta ids and our ads row, no load error; every load job names an approved ad |
| 26 | marketing-command-center.html: Launch: links: 'Open Settings', 'Open Videos', 'Open Campaigns to pause a campaign or change its budget' | practice-test | `e2e/fin-b15-cc-controls.spec.mjs + e2e/cc-tab-launch.spec.mjs` | Open Settings (new test), Open Videos and Open Campaigns href (existing tests); 3 breaks red |
| 27 | marketing-command-center.html: Launch: load-state poll every 20 s (uploading, waiting for Meta, making the ad, saving) + ad-video list | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | read again at 20 seconds, not before, with the approved list; no timer when nothing is loading; 2 breaks red |
| 28 | marketing-command-center.html: Numbers: Ads table: 'Ad N' row button opens the drawer (watch curve, day select, 'What to film next', Close) | practice-test | `e2e/cc-tab-numbers.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | row button opens the drawer, curve, Day select (new test), What to film next, Close; 4 breaks red |
| 29 | marketing-command-center.html: Numbers: Angles cards: 'Make more of this' -> idea box (text + Save idea / Cancel) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-numbers-make-more`: each angle idea keeps Chris's words and has its idea file queued |
| 30 | marketing-command-center.html: Numbers: Funnels view: page views, click to page, page to lead, lead to call, call to sale, spend, ROAS per fu... | practice-test | `e2e/cc-tab-numbers.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | step rates, spend, ROAS, unknown stays unknown (new test), Open Settings when none (new test); 5 breaks red |
| 31 | marketing-command-center.html: Scripts: 'Try again' buttons on a failed part | practice-test | `e2e/marketing-cc-scripts.spec.mjs (3 tests) + e2e/fin-b15-cc-controls.spec.mjs (2 new tests)` | Try again on the scripts list, ideas list and batch history is pressed on the page as shipped (existing tests). Try again on the Rules fold and the Every version fold is pressed with ONE thing muted: the page's own restart of a failed read on every repaint (product finding 1). With that muted, only the button can read again; 2 breaks red (each button made dead). The fault itself is measured by an expected-to-fail test and held by `fin-b15-findings.test.mjs` |
| 32 | marketing-command-center.html: Scripts: 'Write now' batch button (hidden while write_now_ready is false) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-write-now`: every Write now batch has its start job, a release time, and ready or released means at least one script counted |
| 33 | marketing-command-center.html: Scripts: card 'Edit' (one box per part) + 'Save new version' / Cancel | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-edit`: an edit sits one version after the one it replaced, same script, replaced one retired, one live version, its repo file queued |
| 34 | marketing-command-center.html: Scripts: card 'Fix' (note + 'Make this a rule' + 'Rewrite it'; rewrite job returns a new version) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-fix`: a rewrite sits one version after the old one, same script and ad number, old one retired; a fix request has its note and a script of this company |
| 35 | marketing-command-center.html: Scripts: card Previous / Next buttons and swipe between drafts (never saves) | practice-test | `e2e/marketing-cc-scripts.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | swipe (existing), Previous and Next buttons (new); 2 breaks red |
| 36 | marketing-command-center.html: Scripts: conflict banner: 'Use mine' / 'Use theirs' / 'Read the new version' (409 on a stale version) | practice-test | `e2e/marketing-cc-scripts.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | Use mine (existing), Use theirs and Read the new version (new); 4 breaks red |
| 37 | marketing-command-center.html: Scripts: filter chips: Drafts, Approved, Filmed, Rejected, All (with counts) | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | five chips with counts, each shows only its own scripts, never writes; 2 breaks red |
| 38 | marketing-command-center.html: Scripts: idea box: idea text, format, funnel, 'Save idea', 'Write it now', 'Show all N' / 'Show fewer', 'Open ... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-idea-box`: idea keeps his words, has its idea file queued, names a funnel of this company, written means it points at a script |
| 39 | marketing-command-center.html: Scripts: rules: 'Change' + 'Save the rule', 'Add the rule', 'Ban the phrase' (rule saved to the repo through t... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-rules`: rule edits go to the right file for their kind, carry words (or phrase), a change names a rule number |
| 40 | marketing-command-center.html: Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo, unknown),... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-settings-funnel-card`: mix uses only the 6 script kinds with numbers of zero or more, default ad set belongs to the funnel's campaigns, no campaign on two funnels |

## Files added

- `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` (the 26 live checks, built from named bad-result conditions)
- `src/pulse/catalog/proofs/fin-b15-sql-kit.mjs` (test kit: real table and column names from db/schema and db/migrations, Postgres to SQLite spelling, stand-in tables)
- `src/pulse/catalog/proofs/fin-b15-live-contracts.test.mjs` (163 tests: good rows, one wrong row per condition, the same row not caught when that one condition is left out, another company's wrong rows never read)
- `src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs` (page gate, 6 tests, real handlers, stand-in database)
- `src/pulse/catalog/proofs/fin-b15-display-specs.mjs` and `fin-b15-display-specs.test.mjs` (the 14 practice rows, bound to spec test titles, and the runner that runs them in Chromium)
- `src/pulse/catalog/proofs/fin-b15-findings.mjs` and `fin-b15-findings.test.mjs` (the Try again finding: a source test that goes red when the page stops restarting a failed read, and says what to take back out of the specs; also proves the row is attached and the mute is narrow). These replaced `fin-b15-not-attachable.*`, which held row 31 as left out.
- `e2e/fin-b15-cc-controls.spec.mjs` (15 browser tests for controls no earlier spec pressed: 14 pass, 1 expected-to-fail that measures the finding)
- `ops/workflows/finish-853-2026-10-14/manifest-b15.md`

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line, and `...FIN_B15_DISPLAY_CONTRACTS,` as the last entry of `DISPLAY_RESULT_CONTRACTS` |
| `src/pulse/catalog/compiler.mjs` | one loop (13 lines) in `compileDisplayRuntimeData`: a tracked row that owns a registered contract marked `anyImpact: true` is judged even though its impact is staffOnly or none (the base only judged money and customer rows). Another batch (b06) added a similar loop limited to money and customer impact; keep one, and let it also pass rows whose contract says `anyImpact` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line, and `...FIN_B15_DISPLAY_PROOF_CASES,` in the plug-in list |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 658 (14 practice rows left it) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts and cases 40 to 66, PASS-capable 27 to 53, SQL batches 27 to 53, lane run calls 27 to 53, PASS rows 27 to 53 (26 live checks added, 13 always-red unchanged) |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`; after merging run it again and take its output |
| `e2e/marketing-command-center.spec.mjs` | one test added ("the reload on focus: ..."); nothing else in that file changed |

If other batches also change these numbers, add the changes together and use what the tests print.

## Breaks made on purpose (each made alone, the test run, then the file put back with `git checkout`)

Practice tests, real page:
- Frame reload and stamp (6 red): reload timer 5 to 50 minutes in the frame and the Today tab together; Today's timer alone; both focus listeners removed; both visibility listeners removed; the stamp's time wrong; the 30 second focus gap removed.
- Gear (2 red): link pointed at Today; Today re-drawn when it comes back.
- Tab strip (5 red): the gear tab shown in the strip; the address hash ignored; strip order by key; address not corrected for an unknown tab; last tab not remembered.
- See the pages (4 red): sandbox lets scripts run; label never says Hide; preview never closes; page buttons ignored.
- Go to step N (1 red): focus no longer moves.
- Launch links (3 red): Open Settings goes to Videos; Open Videos goes to Settings; Open Campaigns link points elsewhere.
- Launch poll (2 red): 20 seconds became 60; the poll runs with nothing loading.
- Numbers drawer (4 red): Day select ignored; Close button dead; drawer reads another ad; What to film next fix blank.
- Numbers funnels view (5 red): lead to call and call to sale use the wrong fields; ROAS to one decimal; unknown ROAS printed as 0.00x; Open Settings goes to Settings without the funnels place.
- Scripts Previous and Next (2 red): each button made dead.
- Scripts chips (2 red): a chip does nothing; the counts all show the All number.
- Scripts conflict banner (4 red): the banner stays after Use theirs; Use theirs sends my words; the Read the new version button missing; a stale Approve not turned into a banner.
- Page gate (6 red): each of 4 read and write handlers opened to every staff role; the bureau save opened to closers; the lender role set narrowed.
- Try again on the Rules fold and the Every version fold (2 red, 1 more check): the Rules Try again case made a no-op (Rules test red, Versions test green); the Every version Try again made a no-op (Versions test red, Rules test green). With the restart on a failed fold fixed in the page (a one-line change, made on purpose and put back), the two button tests stay green and the expected-to-fail FINDING test reports "Expected to fail, but passed": the signal to take the mutes out. The earlier working-folder edit that renamed the button to "Retry" was a leftover break from a stopped run; it was put back with `git checkout` and is not in any commit.

Live checks: the SQL text is broken one named condition at a time inside `fin-b15-live-contracts.test.mjs`
(26 checks, 105 named conditions, each goes red on its own wrong row and the row is not caught once the
condition is left out). A product break here means a wrong saved row, which is what the stand-in rows are.

Breaks that stayed green, and why (equivalent, not weak):
- The frame's own `REFRESH_MS` alone: the Today tab runs its own 5-minute timer, so the frame's is a second
  copy of the same job (changing both, or Today's alone, goes red).
- Removing `loadScripts()` after "Use theirs": the stale-save handler already reads the list again.
- Putting the gear tab's place to "strip" in `fromMainTab`, and dropping the unknown-tab fallback in `route`:
  the tab registers its own place, and `pickTab` falls back to the first tab by itself. Replaced by the
  five effective strip breaks above.

## Product findings (not fixed, one line each)

1. Scripts tab: when the Rules read or the Every version read fails, `onToggle` in `public/app/marketing-cc-scripts.js` starts it again on every repaint (1,059 reads in 1.5 seconds with a Rules read that answers 500). The Try again button on those two folds cannot be pressed in time, and the server is hit hundreds of times a second while it is down (the page heals by itself when the server answers). Row 31 is attached as a practice test with this one restart muted in the test (see the row and the breaks below); `fin-b15-findings.test.mjs` goes red when the page is fixed and says to take the mute out.
2. `api/read/ai-bureau-config.mjs` gates the read with `ROLE_SETS.STAFF`, while the save is owner, admin and funding advisor only. Any staff role can read the bureau call numbers and menu paths.
3. `reviewObservation` in `src/lenders/store.mjs` saves only `review_status` (and `created_by` only when empty): no reviewer and no time are recorded for Confirm, Corrected or Dismiss, and it does not check the observation was flagged as a mismatch. The Dismiss check can only judge what stays on the row.
4. Two save paths for script versions: `api/scripts/write.mjs` saves a new version with the column default `source = 'chris'`, a parent, and no repo path or outbox file; the Scripts tab edit always queues a repo file. The live edit check judges only versions that name their repo file, so the older path is not read.
5. The Frame has two copies of the 5-minute reload and the focus reload (frame `REFRESH_MS`/`REFOCUS_MS` and the Today tab's `RELOAD_MS`/`FOCUS_GAP_MS`), with different focus gaps (60 and 30 seconds).

## Commands run and results

Measured on this Mac while other builders ran (load average high at times).

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` (before) | 853 open, 40 of them this batch |
| `node scripts/pulse/count-not-proved.mjs` (after, `npm run pulse:catalog` first) | 813 open, 0 of them this batch |
| `node scripts/pulse/compile-catalog.mjs --check` | fresh |
| `node --test src/pulse/catalog/proofs/fin-b15-live-contracts.test.mjs` | 163 pass |
| `node --test src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs` | 6 pass |
| `node --test src/pulse/catalog/proofs/fin-b15-findings.test.mjs` | 4 pass |
| `node --test src/pulse/catalog/proofs/fin-b15-display-specs.test.mjs` (runs 5 spec files in Chromium) | first run 5 of 6 passed while the Mac was at load average 40 to 400 (other builders): the one that failed was an older frame test, `a read that never answers is given up on after 20 seconds`, a fake-clock test that read 1 instead of 2; it passed twice alone right after. Later, the whole set of 139 test files the display proof cases name (this runner included) ran: 1,896 tests, 1,896 pass, 0 fail |
| `npx playwright test e2e/fin-b15-cc-controls.spec.mjs` | 15 reported passed (14 pass, the FINDING test is expected to fail and does) |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 pass |
| `node --test src/pulse/catalog/*.test.mjs` | 70 pass (with the lane test above) |
| `node --test --test-name-pattern "unmapped display rows" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | pass at 658 |
| `npm run lint` | 3,570 files parse clean (re-run after the row 31 change) |
