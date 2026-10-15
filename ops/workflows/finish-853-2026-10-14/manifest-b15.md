# Batch 15 manifest: Lenders desk and Marketing Command Center (finish the 853)

Branch `fin/b15`, built from `fin/base` (`2f4f574a0`). Work folder `.claude/worktrees/fin-b15`. Nothing was pushed or merged.
Lane: `gap-catalog-display`. Tier 4. Generation 1 of 3, repair cycle 1 (2026-10-14 night: an independent checker broke
21 of the 40 rows and found checks that stayed green. The repair is the section "Repair cycle 1" below).

## The number

| | Rows |
|---|---|
| Rows in this batch | 40 |
| Open (NOT_PROVED) before the repair | **0** of 40 (all 40 were attached; the checker found 21 of the attachments dishonest) |
| Open (NOT_PROVED) after the repair | **0** of 40 (every one of the 21 was made honest; none had to be taken back out) |
| Live check only | 20 |
| Live check and a practice test on the same row | 5 |
| Practice test only | 15 |
| Not attachable (with the exact reason) | 0 |

Measured with `node scripts/pulse/count-not-proved.mjs` in this worktree, intersected with `batch-15.json`: 0 of the 40
open. Whole lane: 813 open, unchanged by this repair (the repair moved no row out of the lane and put none back in).

How to read "live check" honestly: the count script runs the lane with no database, so a live check reads as `skip`
there and leaves the NOT_PROVED list. With a database (the morning pulse) each of the 25 runs its read-only SQL for the
company and answers PASS, or FAIL on the first wrong saved result. A control nobody has used yet has no results; those
24 checks say "no saved results yet, none are wrong" and go red on the first wrong one (`emptyAs: "quiet"`). The lender
book check leaves that off on purpose: an empty book is red, like the page's own empty-book banner. None of the SQL was
run against the live database (there is no local Postgres on this Mac and the brief forbids it). Each text runs
unchanged over stand-in rows in SQLite (see below).

## Every row

| # | Row (screen: control) | Outcome | Where | What judges it |
|---|---|---|---|---|
| 1 | lenders.html: Mismatch queue row: Dismiss button | practice-test | `src/pulse/catalog/proofs/fin-b15-lenders-dismiss.test.mjs` + `e2e/fin-b15-lenders-dismiss.spec.mjs` | the real handler and the real UPDATE over stand-in rows (right row, right word, only this company, created_by kept) and the real button on the page (its row id and its word, the row leaves the queue); 9 breaks red. The live check was taken out: the saved row records no reviewer and no time |
| 2 | lenders.html: Page gate: owner, admin, funding_advisor only (read + write endpoints return 403 to every other role) | practice-test | `src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs` | the real handlers, all 10 sign-in kinds; only owner, admin, funding advisor get past; 6/6 breaks red |
| 3 | lenders.html: Page load: list read + mismatch-queue read; empty-book banner | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-page-load`: the book must have non-demo lenders (empty book is red), every lender named, every open mismatch complete |
| 4 | lenders.html: Tab: AI bureau config | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-ai-bureau-tab`: code and name present, at least one try, no negative wait or hold, verified-by never blank |
| 5 | lenders.html: Tab: Bureau mismatch queue (with open-count badge) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-mismatch-tab`: each open mismatch names the bureau seen, names a lender, and points only at a lender of this company |
| 6 | lenders.html: Tab: Lender list | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `lenders-list-tab`: name present, no negative dollar amount, starting line not above the biggest known line (demo lenders left out like the page does) |
| 7 | marketing-command-center.html: Frame: 5-minute auto reload, reload on focus, footer 'as of' stamp | practice-test | `e2e/marketing-command-center.spec.mjs (3 tests: Today's own timers) + e2e/fin-b15-cc-frame.spec.mjs (the frame's own reload)` | Today's stamp and timers, and the frame's own `due()` on a tab that registers `refresh()`: nothing before 5 minutes, one at 5, a focus inside a minute reads nothing, a focus after a minute reads, coming back into view reads, a hidden page never reads; 8 frame breaks red |
| 8 | marketing-command-center.html: Frame: gear button (opens Settings tab, Today comes back as it was) | practice-test | `e2e/marketing-command-center.spec.mjs` | gear opens Settings, Today comes back as it was (2 breaks red) |
| 9 | marketing-command-center.html: Frame: tab strip (Today, Ideas, Scripts, Shoot, Launch, Numbers) with hash routing that keeps its place | practice-test | `e2e/marketing-command-center.spec.mjs (3 tests) + e2e/fin-b15-cc-frame.spec.mjs (2 tests)` | strip order and members, hash routing, address corrected; every strip link goes to its own address (pressed, one by one), the gear goes to Settings, the last tab is remembered for any tab, a view inside a tab (#probe/ads, #probe/ads/91) keeps its place; 4 more breaks red |
| 10 | marketing-command-center.html: Ideas flywheel step 1 (avatar): run button 'Build the avatar', Read it, Approve, Tweak, Resume / Start over / ... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-flywheel-1-avatar`: saved stage file starts with its own stamp, approve sets status approved only, Tweak notes are one dated line under Notes, finished run has its file queued |
| 11 | marketing-command-center.html: Ideas flywheel step 2 (ad-research): run button 'Research the market', Read it, Approve, Tweak, Resume / Start... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-flywheel-2-ad-research`: stamp, approve, Tweak notes; a finished run is either thin on purpose (result.board.thin, no file, not read) or names its board file and has it queued |
| 12 | marketing-command-center.html: Ideas flywheel step 3 (offer): run button 'Write the offer', Read it, Approve, Tweak, Resume / Start over / Re... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-flywheel-3-offer`: stamp, approve, Tweak notes, finished run holds offer and document |
| 13 | marketing-command-center.html: Ideas flywheel step 4 (copy): run button 'Write the copy; needs step 3 approved', Read it, Approve, Tweak, Res... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-flywheel-4-copy`: stamp, approve, Tweak notes, finished run has its file queued |
| 14 | marketing-command-center.html: Ideas flywheel step 5 (ad-strategy): run button 'Pick the strategy; needs steps 3 and 4 approved', Read it, Ap... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-flywheel-5-strategy`: stamp, approve, Tweak notes, finished run has its file queued |
| 15 | marketing-command-center.html: Ideas flywheel step 6 (spend): run button 'Read the spend (free, no model)', Read it, Approve, Tweak, Resume /... | live-check (+ practice test) | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs + `src/pulse/catalog/proofs/fin-b15-spend-read.test.mjs` | check `mkt-flywheel-6-spend`: stamp, approve, Tweak notes, spend read saved as the spend file; practice test: the real readSpend over known rows prints exactly those numbers, the file agrees with itself (total = ads with a number + ads with none), unknown never 0, the conclusion is read from the same numbers; 4 breaks red |
| 16 | marketing-command-center.html: Ideas funnels: 'Change the address' input + 'Save the address' | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-funnel-rename`: exactly 3 pages at the address the funnel makes, a draft funnel's landing address is its own, every written page names its own address and sends its button on to the next page's address (a rename that left the old links is red) |
| 17 | marketing-command-center.html: Ideas funnels: 'See the pages' / 'Hide the pages' + preview role buttons (sandboxed page preview) | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | See the pages, sandbox with no scripts, the three page buttons, Hide the pages; 4 breaks red |
| 18 | marketing-command-center.html: Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check) | live-check (+ practice test) | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs + `src/pulse/catalog/proofs/fin-b15-funnel-build.test.mjs` | check `mkt-funnel-build`: from a finished job, saved words have the shape the copy check holds, tag/config/pixel in the head, both tracking scripts loaded; practice test: the real job refuses an answer the copy check refuses twice and saves nothing, takes a clean second answer, never rewrites a live funnel; 4 breaks red |
| 19 | marketing-command-center.html: Ideas: 'Go to step N' jump button | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | Go to step N moves focus to that step's run button and sends nothing (1 break red) |
| 20 | marketing-command-center.html: Ideas: angles list: 'Make more of this' button on each angle | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-ideas-make-more`: each make-more idea carries its angle key, names the angle, and has its idea file queued in the repo outbox |
| 21 | marketing-command-center.html: Ideas: month spend meter (used of cap) | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-month-meter`: all three priced models (opus, sonnet, claude-code) saved with a cost, and that cost equals tokens at the model's price plus a cent per search; the price table in the SQL is held equal to model-usage.mjs's own table by a test |
| 22 | marketing-command-center.html: Ideas: research card buttons: Read it / Hide it, Approve, Tweak (+ 'Run the tweak'), Redo, 'Save to the brain'... | live-check (+ practice test) | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs + `src/pulse/catalog/proofs/fin-b15-research-brain.test.mjs` | check `mkt-research-card`: report/approved file queued, approver named, tweak parent real, and every brain page for a report belongs to a finished report, holds chunks, and opens with the report's own words; practice test: Save to the brain hands the finished report whole to the brain under its own key and title; 5 breaks red. Redo and Retry leave the run row the form check judges |
| 23 | marketing-command-center.html: Ideas: research form: question box, depth toggle (Quick look / Leave nothing unturned), 3 source checkboxes, b... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-research-form`: question, depth, sources object with a place to look, belief is words and 500 letters or fewer, stop amount above zero and not spent past twice, finished run names its repo file |
| 24 | marketing-command-center.html: Launch: 'Load all approved' (asks first, then {all:true}) | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-launch-load-all`: every meta_load job names an approved ad video of this company; a loaded video carries its Meta ad id and our ad row |
| 25 | marketing-command-center.html: Launch: 'Load to Meta' per approved video, and 'Retry load' (creates the ad PAUSED, $0) | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-launch-load-one`: loaded video approved by a person, three Meta ids and our ads row, no load error, and a video loaded in the last 14 days is not ON unless Turn on left its receipt; every load job names an approved ad |
| 26 | marketing-command-center.html: Launch: links: 'Open Settings', 'Open Videos', 'Open Campaigns to pause a campaign or change its budget' | practice-test | `e2e/fin-b15-cc-controls.spec.mjs + e2e/cc-tab-launch.spec.mjs` | Open Settings (new test), Open Videos and Open Campaigns href (existing tests); 3 breaks red |
| 27 | marketing-command-center.html: Launch: load-state poll every 20 s (uploading, waiting for Meta, making the ad, saving) + ad-video list | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | on a paused clock, to the millisecond: not at 19.999 s, read at 20 s with the approved list, again 20 s later, for an ad loading and an ad waiting; the four step words painted; no timer with nothing in flight; 11 breaks red (POLL_MS 1000, 5000, 15000, 19000, 21000, 60000; waiting or loading dropped; two step words garbled; the approved list not read) |
| 28 | marketing-command-center.html: Numbers: Ads table: 'Ad N' row button opens the drawer (watch curve, day select, 'What to film next', Close) | practice-test | `e2e/cc-tab-numbers.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | row button opens the drawer, curve, Day select (new test), What to film next, Close; 4 breaks red |
| 29 | marketing-command-center.html: Numbers: Angles cards: 'Make more of this' -> idea box (text + Save idea / Cancel) | live-check (+ practice test) | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs + `e2e/cc-tab-numbers.spec.mjs` + `e2e/fin-b15-cc-controls.spec.mjs` | check `mkt-numbers-make-more`: Chris's own script ideas with an angle key keep his words and have their file queued (the machine's idea and an opening idea are read as nothing, and each turns red the moment its filter is dropped); practice tests: the saved request carries the angle's key and source (3 breaks red), Cancel closes the box and saves nothing (1 break red) |
| 30 | marketing-command-center.html: Numbers: Funnels view: page views, click to page, page to lead, lead to call, call to sale, spend, ROAS per fu... | practice-test | `e2e/cc-tab-numbers.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | step rates, spend, ROAS, Open Settings (earlier); and now every step of a funnel with nothing saved prints unknown (page to lead, lead to call, call to sale, leads, showed), a real zero prints 0, a rate over nobody is unknown, Showed is the showed count; 6 more breaks red |
| 31 | marketing-command-center.html: Scripts: 'Try again' buttons on a failed part | practice-test | `e2e/marketing-cc-scripts.spec.mjs (3 tests) + e2e/fin-b15-cc-controls.spec.mjs (2 new tests)` | Try again on the scripts list, ideas list and batch history is pressed on the page as shipped (existing tests). Try again on the Rules fold and the Every version fold is pressed with ONE thing muted: the page's own restart of a failed read on every repaint (product finding 1). With that muted, only the button can read again; 2 breaks red (each button made dead). The fault itself is measured by an expected-to-fail test and held by `fin-b15-findings.test.mjs` |
| 32 | marketing-command-center.html: Scripts: 'Write now' batch button (hidden while write_now_ready is false) | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-scripts-write-now`: start job queued, release time is the moment it was made (later than 5 minutes is held back), not planned over 2 hours, ready or released counted a script |
| 33 | marketing-command-center.html: Scripts: card 'Edit' (one box per part) + 'Save new version' / Cancel | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-scripts-edit`: one version after the old one, same script, and ITS OWN edit file queued (op id u25:edit-file at the path with that version in its front matter; the machine's file at the same path is not enough) |
| 34 | marketing-command-center.html: Scripts: card 'Fix' (note + 'Make this a rule' + 'Rewrite it'; rewrite job returns a new version) | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-scripts-fix`: one version after the old one, same script, keeps the ad number the old version had (an old version with no number yet is not compared: the number is given at approval), fix request has its note and a script of this company |
| 35 | marketing-command-center.html: Scripts: card Previous / Next buttons and swipe between drafts (never saves) | practice-test | `e2e/marketing-cc-scripts.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | swipe (earlier); Previous and Next over THREE drafts: one at a time, stop at the ends, back one lands on the middle draft, never saves; 2 more breaks red (Next jumps two, Previous jumps to the first) |
| 36 | marketing-command-center.html: Scripts: conflict banner: 'Use mine' / 'Use theirs' / 'Read the new version' (409 on a stale version) | practice-test | `e2e/marketing-cc-scripts.spec.mjs + e2e/fin-b15-cc-controls.spec.mjs` | stale Edit: Use mine sends MY words (the same body as the first try) on the live version, Use theirs; stale Approve, stale Fix and stale Reject: the banner with the saved version, no Use mine, Read the new version closes it and sends nothing more; 3 more breaks red |
| 37 | marketing-command-center.html: Scripts: filter chips: Drafts, Approved, Filmed, Rejected, All (with counts) | practice-test | `e2e/fin-b15-cc-controls.spec.mjs` | five chips with counts, each shows only its own scripts, never writes; 2 breaks red |
| 38 | marketing-command-center.html: Scripts: idea box: idea text, format, funnel, 'Save idea', 'Write it now', 'Show all N' / 'Show fewer', 'Open ... | live-check | `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` | check `mkt-scripts-idea-box`: idea keeps his words, has its idea file queued, names a funnel of this company, written means it points at a script |
| 39 | marketing-command-center.html: Scripts: rules: 'Change' + 'Save the rule', 'Add the rule', 'Ban the phrase' (rule saved to the repo through t... | live-check | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs | check `mkt-scripts-rules`: right file for the kind, carries words or phrase, a change names a rule number, and a save still uncommitted an hour after it was queued is red (the repo refused it and the outbox keeps trying) |
| 40 | marketing-command-center.html: Settings: funnel card: name, landing page, lane select (funding600, premium, sorting, uwiq, wl, slo, unknown),... | live-check (+ practice test) | src/pulse/catalog/proofs/fin-b15-display-contracts.mjs + `e2e/fin-b15-cc-settings-funnel.spec.mjs` + `e2e/marketing-cc-settings.spec.mjs` | check `mkt-settings-funnel-card`: mix kinds and numbers, default ad set inside the funnel's own campaigns, no campaign on two funnels (read from the funnels' own lists, so an unsynced campaign still counts); practice tests: every box sends exactly what was typed or picked (name, landing page, lane, ad button, weight, Running, books a call, the mix), one box alone sends one field, a refused box is named and nothing is sent; 9 breaks red |

## Files added

- `src/pulse/catalog/proofs/fin-b15-display-contracts.mjs` (the 25 live checks, built from named bad-result conditions)
- `src/pulse/catalog/proofs/fin-b15-sql-kit.mjs` (test kit: real table and column names from db/schema and db/migrations, Postgres to SQLite spelling, stand-in tables, a pg-shaped `query` so a real handler can run over stand-in rows)
- `src/pulse/catalog/proofs/fin-b15-live-contracts.test.mjs` (194 tests: good rows, one wrong row per condition, the same row not caught when that one condition is left out, another company's whole world never read and read the moment the company filter is dropped, the checks run over pages and files the product's own code made)
- `src/pulse/catalog/proofs/fin-b15-lenders-gate.test.mjs` (page gate, 6 tests, real handlers, stand-in database)
- `src/pulse/catalog/proofs/fin-b15-lenders-dismiss.test.mjs` (Dismiss, 5 tests, the real handler and the real UPDATE) ** repair cycle 1 **
- `src/pulse/catalog/proofs/fin-b15-funnel-build.test.mjs` (the real page writer, 4 tests) ** repair cycle 1 **
- `src/pulse/catalog/proofs/fin-b15-spend-read.test.mjs` (the real step 6 read and file, 4 tests) ** repair cycle 1 **
- `src/pulse/catalog/proofs/fin-b15-research-brain.test.mjs` (the real Save to the brain handler, 3 tests) ** repair cycle 1 **
- `src/pulse/catalog/proofs/fin-b15-display-specs.mjs` and `fin-b15-display-specs.test.mjs` (the 20 practice rows, bound to spec test titles and node tests, and the runner that runs them in Chromium)
- `src/pulse/catalog/proofs/fin-b15-findings.mjs` and `fin-b15-findings.test.mjs` (the Try again finding)
- `e2e/fin-b15-cc-controls.spec.mjs` (22 browser tests for controls no earlier spec pressed: 21 pass, 1 expected-to-fail that measures the finding)
- `e2e/fin-b15-cc-frame.spec.mjs` (the frame's own reload and strip, 3 tests) ** repair cycle 1 **
- `e2e/fin-b15-lenders-dismiss.spec.mjs` (the Dismiss button on the page, 3 tests) ** repair cycle 1 **
- `e2e/fin-b15-cc-settings-funnel.spec.mjs` (the funnel card's every box, 3 tests) ** repair cycle 1 **
- `ops/workflows/finish-853-2026-10-14/manifest-b15.md`

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line, and `...FIN_B15_DISPLAY_CONTRACTS,` as the last entry of `DISPLAY_RESULT_CONTRACTS` (unchanged this cycle) |
| `src/pulse/catalog/compiler.mjs` | one loop (13 lines) in `compileDisplayRuntimeData`: a tracked row that owns a registered contract marked `anyImpact: true` is judged even though its impact is staffOnly or none (unchanged this cycle). Another batch (b06) added a similar loop limited to money and customer impact; keep one, and let it also pass rows whose contract says `anyImpact` |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line, and `...FIN_B15_DISPLAY_PROOF_CASES,` in the plug-in list (unchanged this cycle) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count was 672. 14 practice rows left it in the first pass (658) and 6 more in this cycle (Dismiss, Angles, step 6, write pages, settings card, research card): **652** |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts and cases 40 to 65 (was 66: the Dismiss live check is gone), PASS-capable 27 to 52, SQL batches 27 to 52, lane run calls 27 to 52, PASS rows 27 to 52, `DISPLAY_RESULT_CASES.length` 65 in the shipped-data test |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`; after merging run it again and take its output |
| `e2e/marketing-command-center.spec.mjs` | one test added in the first pass ("the reload on focus: ..."); nothing changed in this cycle |

If other batches also change these numbers, add the changes together and use what the tests print.

## Repair cycle 1 (2026-10-14 night)

An independent checker broke 21 rows of this batch on purpose and found that each kept its attachment while a real
break went by. This cycle answered every one. The rule that came out of it, written at the top of
`fin-b15-display-contracts.mjs`: a live check may not count a row it cannot judge, and may not go red on a designed
outcome; where it cannot be honest the row is a practice test, or is left open.

| # | Row | Final | What was wrong | What was done | Break made, result |
|---|---|---|---|---|---|
| 1 | lenders.html: Dismiss | practice-test | the check judged fields set when the observation was logged (the saved row has no reviewer and no time) | live check removed; handler + store SQL over stand-in rows, and the button on the page | handler writes another word; UPDATE drops the id; UPDATE drops the company; UPDATE no longer sets the word; created_by overwritten; button sends confirmed; sends no id; queue not read again; Corrected sends dismissed: 9 of 9 red |
| 2 | Frame reload | practice-test | Today runs its own timers, so the frame's own `due()` (the only reload for 5 tabs) was never pressed | pressed on a tab that registers `refresh()` (the frame probe) | `due()` returns; REFRESH_MS 500, 4 and 7 minutes; focus listener removed; visibilitychange listener removed; REFOCUS_MS 5 s; hidden page read: 8 of 8 red |
| 3 | Frame tab strip | practice-test | only Today was ever pressed; no sub-view; only Settings shown as remembered | every strip link pressed and its address read, last tab remembered for a non-gear tab, `#probe/ads` and `#probe/ads/91` | all links to #today; only settings remembered; sub-view dropped; gear to #today: 4 of 4 red |
| 4 | Step 2 | live-check | red on a thin run, a designed result with no file | thin runs (result.board.thin) are read as nothing; a non-thin run must name its board file and have it queued; fixtures use the shape finish() writes | thin run is green (and red again the moment the exclusion is removed: 9 tests red) |
| 5 | Month meter | live-check | named only opus and claude-code; the test held the wrong price table | names all three models of model-usage.mjs; cost must equal tokens at price plus a cent a search; the SQL's rates are held equal to the product's table by a test, and the product's own writer is run over each model | sonnet with unknown cost; sonnet at the opus price; opus at zero; a search fee left out: red |
| 6 | Research form | live-check | no sources, belief or spend-against-stop condition | sources object, a place to look, belief is words and 500 or fewer, spent not past twice the stop amount (design rule 13 allows one step to overshoot) | no sources; both places off; $60 on a $5 stop; blank and 501-letter belief: red |
| 7 | Load to Meta | live-check | never read the ad's status | a video loaded in the last 14 days must not be ACTIVE without a successful turn-on receipt in action_log | ad ACTIVE with no receipt; a refused turn-on is not a receipt: red |
| 8 | Launch poll | practice-test | the "not before 20 s" read raced the request; only `loading` used; step words never painted | clock paused, advanced to the millisecond; `waiting` and `loading` both; all four real step keys; the fallback line | POLL_MS 1000, 5000, 15000, 19000, 21000, 60000; waiting dropped; loading dropped; step 2 and 4 words garbled; approved list not read: 11 of 11 red |
| 9 | Change the address | live-check | read only the paths | landing address for a draft funnel; each page names its own address; the landing button goes to the booking page; the booking page goes on to the thank-you page. Run over pages the product's own `renderPage` drew | pages left on the old address: red (3 pages) |
| 10 | Write the pages | live-check + practice test | `checks: "passed"` is a constant; tracking found anywhere in the file; two scripts not read | words must have the copy check's shape; tag, config, pixel must be in the head; both scripts loaded; the real job run over a fake model | refused answer accepted; three rounds; pages never saved; usage not logged: 4 of 4 red |
| 11 | Research card buttons | live-check + practice test | Save to the brain, Redo, Retry were not read | brain pages: belong to a finished report, hold chunks, open with the report's words (run over the product's own chunker, CRLF included); the handler hands the report whole to the brain | empty text; question instead of report; wrong key; skipped finished check; any company's run: 5 of 5 red |
| 12 | Step 6 spend | live-check + practice test | numbers in the file never read; Tweak note never read | Tweak notes read for all six steps; the real read and file run over known rows | totals doubled; one ad doubled; unmatched dropped; missing printed as $0; conclusion rule moved; checkout and Meta counts swapped: 6 of 6 red |
| 13 | Fix | live-check | red on every fix-then-approve (the old version has no ad number); two dead conditions; hollow company guard | compare the number only when the old version has one; dead conditions removed; far-company fixtures are whole chains | fix then approve is green; company filter removed: red |
| 14 | Edit | live-check | the machine's own file at the same path satisfied the file test; two dead conditions; hollow company guard | the edit's own file: op id u25:edit-file at that path with that version in its front matter (checked against the product's serializeScript and opIdFor) | machine file only: red; a later edit's file only: red; another company's file at the path: red |
| 15 | Conflict banner | practice-test | Use mine's body never read; stale Fix and Reject never pressed | Use mine sends the same body as the first try, on the live version; stale Fix and Reject pressed | Use mine sends the saved words; stale Fix and stale Reject shown as plain errors: 3 of 3 red |
| 16 | Rules | live-check | never read whether the repo took it | a rule save uncommitted an hour after it was queued is red | refused 'Part 0 has no rule 7', 41 attempts: red |
| 17 | Numbers Funnels | practice-test | unknown only pressed for 5 of the fields | all five steps unknown, a real zero, a rate over nobody, Showed is the showed count | 6 of 6 red |
| 18 | Write now | live-check | release time and status filter not read | release later than 5 minutes after it was made is red; planned over 2 hours is red; a young planned batch with no scripts is green | release pushed to Monday; stuck planned; status filter dropped: red |
| 19 | Settings funnel card | live-check + practice test | seven boxes unjudged; unsynced campaign invisible | the table refuses a blank name, non-https, a bad lane (enum), weight below zero and a blank ad button, so those are not read; every box pressed on the page; campaign duplicates read from the funnels' own lists | 9 of 9 red |
| 20 | Previous / Next | practice-test | two drafts could not tell a step from a jump | three drafts | Next jumps two; Previous jumps to the first: 2 of 2 red |
| 21 | Numbers Angles | live-check + practice test | key-less ideas unseen; filters untested; no Cancel | filters tested; the existing Angles tests bound; Cancel pressed | key not sent; name sent as key; saved as the machine; Cancel not closing: 4 of 4 red |

Breaks that were made against the SQL itself (each alone, file put back): the company filter removed from the
rewrite part of Fix, from Edit, from the meter and from the brain part (4 red); the company check removed inside the
file lookup of Edit, the funnel lookup of the idea box, the job lookup of the page build, the parent lookup of a
research tweak and the script lookup of a fix request (5 red, each needs another company holding the row that would
have satisfied it); the thin exclusion removed (red); the executed-receipt rule removed from Load to Meta (red); the
status filter removed from the Write now count rule (red).

## Breaks made on purpose (each made alone, the test run, then the file put back)

First pass (still true):
- Frame reload and stamp (6 red): reload timer 5 to 50 minutes in the frame and the Today tab together; Today's timer alone; both focus listeners removed; both visibility listeners removed; the stamp's time wrong; the 30 second focus gap removed.
- Gear (2 red): link pointed at Today; Today re-drawn when it comes back.
- See the pages (4 red): sandbox lets scripts run; label never says Hide; preview never closes; page buttons ignored.
- Go to step N (1 red): focus no longer moves.
- Launch links (3 red): Open Settings goes to Videos; Open Videos goes to Settings; Open Campaigns link points elsewhere.
- Numbers drawer (4 red): Day select ignored; Close button dead; drawer reads another ad; What to film next fix blank.
- Numbers funnels view (5 red): lead to call and call to sale use the wrong fields; ROAS to one decimal; unknown ROAS printed as 0.00x; Open Settings goes to Settings without the funnels place.
- Scripts chips (2 red): a chip does nothing; the counts all show the All number.
- Page gate (6 red): each of 4 read and write handlers opened to every staff role; the bureau save opened to closers; the lender role set narrowed.
- Try again on the Rules fold and the Every version fold (2 red): each button made a no-op in turn. With the page's restart fixed (a one-line change, made on purpose and put back) the two button tests stay green and the expected-to-fail FINDING test reports "Expected to fail, but passed".

This cycle: see the table above. Live checks: the SQL text is broken one named condition at a time inside
`fin-b15-live-contracts.test.mjs` (25 checks, 132 named conditions, each goes red on its own wrong row and the row
is not caught once the condition is left out), and every check is run with another company's whole world present.

## Product findings (not fixed, one line each)

1. Scripts tab: when the Rules read or the Every version read fails, `onToggle` in `public/app/marketing-cc-scripts.js` starts it again on every repaint (1,059 reads in 1.5 seconds with a Rules read that answers 500). Row 31 is attached as a practice test with this one restart muted in the test; `fin-b15-findings.test.mjs` goes red when the page is fixed and says to take the mute out.
2. `api/read/ai-bureau-config.mjs` gates the read with `ROLE_SETS.STAFF`, while the save is owner, admin and funding advisor only. Any staff role can read the bureau call numbers and menu paths.
3. `reviewObservation` in `src/lenders/store.mjs` saves only `review_status` (and `created_by` only when empty): no reviewer and no time are recorded for Confirm, Corrected or Dismiss, and it does not check the observation was flagged as a mismatch. This is why the Dismiss live check was taken out.
4. Two save paths for script versions: `api/scripts/write.mjs` saves a new version with the column default `source = 'chris'`, a parent, and no repo path or outbox file; the Scripts tab edit always queues a repo file. The live edit check judges only versions that name their repo file, so the older path is not read.
5. The Frame has two copies of the 5-minute reload and the focus reload (frame `REFRESH_MS`/`REFOCUS_MS` and the Today tab's `RELOAD_MS`/`FOCUS_GAP_MS`), with different focus gaps (60 and 30 seconds).
6. Save to the brain: `upsertGeneratedDocument` writes the page row (with its content hash) before the chunks are made, so a failed embedding leaves a page with no chunks, and the next press answers "unchanged" because the hash matches. The page is then never embedded until the report text changes. The new brain check is red on exactly that state.
7. The funnel job's `checks: "passed"` (`summary()` in `src/marketing/funnel-build.mjs`) is a constant, and a retry resets `attempts`, so the number of model calls a funnel job made cannot be bounded from saved data; the "one model call" half of that row is held by the practice test on the job (two rounds at most, nothing saved after two refusals).
8. The frame's 5-minute reload is counted from the moment the tab drew, but its 30 second beat started earlier, so the first reload of a tab comes at the 5:30 beat and not at 5:00.
9. A research run may overshoot its stop amount by one step's own calls (design rule 13). The new check allows up to twice the stop amount; a run past that is read as a runaway.
10. Turning an ad on from Meta's own Ads Manager (not from the Launch tab) leaves no turn-on receipt, so the Load to Meta check reads such an ad as red for its first 14 days after loading.

## Commands run and results

Measured on this Mac while other builders ran.

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` (before and after this cycle) | 813 open, 0 of them this batch, both times |
| `npm run pulse:catalog`, then `node scripts/pulse/compile-catalog.mjs --check` | fresh |
| `node --test src/pulse/catalog/proofs/fin-b15-live-contracts.test.mjs` | 194 pass |
| `node --test` on `fin-b15-lenders-dismiss`, `-funnel-build`, `-spend-read`, `-research-brain`, `-lenders-gate`, `-findings` | 5, 4, 4, 3, 6, 4 pass |
| `node --test src/pulse/catalog/proofs/fin-b15-display-specs.test.mjs` (runs 9 spec files in Chromium) | 11 pass |
| `npx playwright test e2e/fin-b15-cc-controls.spec.mjs --repeat-each=4` | 88 passed (22 tests x 4) |
| `npx playwright test e2e/fin-b15-cc-frame.spec.mjs e2e/fin-b15-lenders-dismiss.spec.mjs --repeat-each=5` | 30 passed |
| `npx playwright test e2e/fin-b15-cc-settings-funnel.spec.mjs --repeat-each=8` | 24 passed |
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (runs every executable test named by every case) | 3 pass in 7 minutes 26 seconds |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 pass |
| `node --test src/pulse/catalog/*.test.mjs` | pass |
| `npm run lint` | 3,574 files parse clean |
