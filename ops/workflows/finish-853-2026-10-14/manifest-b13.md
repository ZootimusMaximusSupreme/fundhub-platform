# Batch 13 manifest (finish-853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b13`, cut from `fin/base` (2f4f574a0). Nothing was pushed or merged. Generation 1.
Rows: the Hiring desk (`hiring.html`, 26 rows), the app front door (`index.html`, 1 row) and the Specialist desk (`inquiry-remover.html`, 13 rows), all in `desks-c.json`.

## The numbers

| | Rows |
|---|---|
| Open before (count script, this batch) | 40 |
| Open after | 1 |
| Live check | 15 |
| Practice test | 24 |
| Not attachable | 1 |

Whole lane, same script: 853 open before, 814 after (the other lanes did not move: routes 135, flows 23, reads 15).

A **live check** reads real saved rows on the live server and goes red when one is wrong. A **practice test** is a real Chromium on the real page with fake API answers; it reads no live data. Seven rows have both (the live check is the attachment; the practice test judges the part a read cannot see).

## Every row

| Row | Outcome | File | What proves it |
|---|---|---|---|
| hiring.html - Board column: Hired (hired) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-hired`. Every real application in the Hired stage must be marked hired and have a recorded move into hired. |
| hiring.html - Board column: Not Moving Forward (rejected) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-rejected`. Every real application in Not Moving Forward must be marked rejected, have a recorded move in, and a reject decision with a named person and written words. |
| hiring.html - Board column: Offer (offer) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-offer`. Every real application at Offer must be open, have a recorded move to offer, and an offer decision with a named person. |
| hiring.html - Board column: Onboarding (onboarding) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-onboarding`. Every real application in Onboarding must be marked hired and have a recorded move in. |
| hiring.html - Board column: Performing (performing) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-performing`. Every real application in Performing must be marked hired and have a recorded move in. |
| hiring.html - Board column: Ramp (60-day trial) (ramp) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-ramp`. Every real application in Ramp must be marked hired and have a recorded move in. |
| hiring.html - Board column: Screening (screening) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-screening`. Every real application in Screening must be open and have a recorded move to screening. |
| hiring.html - Board column: Withdrawn (withdrawn) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-column-withdrawn`. Nothing writes this stage; any application found there must be marked withdrawn and have a recorded move (green with no results). |
| hiring.html - Board filter: 'flagged only' toggle | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'role select, source select and the flagged-only toggle each narrow the board, and clear again' |
| hiring.html - Board filter: role select (all, closer, setter, sales_coordinator) | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | same test: role select narrows the board and 'all' restores it |
| hiring.html - Board filter: source select (referral, client_base, audience, social, job_board, ads, linkedin, recruiter, ... | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | same test: source select narrows and clears |
| hiring.html - Decisions log: role select, days select, decision-kind rail (advance, reject, offer, offer_accepted, offer_... | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'the reports fold is closed until asked; the funnel re-reads for its role and days; the decision log filters' |
| hiring.html - Demo Mode rows: shown with a demo label when demo mode is on, counted nowhere; sample data when localStorag... | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'summary tiles drop Demo Mode rows ...' (three demo marks, each load-bearing) and 'demo session (fh_demo=1) shows sample rows and reads no hiring endpoint' |
| hiring.html - Drawer close: X button, scrim click, Escape key | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'drawer closes from the X button, a click on the scrim, and the Escape key' |
| hiring.html - Drawer: Reject button + required reason box (asks confirm, no undo) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-reject`. Every reject decision keeps a named person who still exists, the written reason, ends at rejected with the application closed, and has its candidate-feedback job. Also covered by practice test: fin-b13-hiring-page.test.mjs 'drawer Reject needs a written reason, asks to confirm, and sends nothing when she says no'. |
| hiring.html - Drawer: stage select + Advance button (move to next stage up to hired, optional reason) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-advance`. Every advance/offer decision names a forward stage and its start, logged as offer only for Offer, the person moved, hired closes the application. Also covered by practice test: fin-b13-hiring-page.test.mjs 'drawer Advance lists the stages up to Hired and sends the chosen stage and reason' (and 'with no reason sends a null reason'). |
| hiring.html - Funnel: role select + days select (30, 90, 180, 365, 730) -> where applications come from | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | same reports test: role and days go to /api/hiring/funnel and the answer is painted |
| hiring.html - Page gate: only owner and admin open Hiring; no sidebar row exists (NAV_HIDDEN), so it is reached only by t... | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'only owner and admin stay on the Hiring page; every other staff role is sent to its own home' (also checks the sidebar row is hidden) |
| hiring.html - Page load: fires demo/mode + candidates + postings + decisions + bench reads, paints tiles, board and tables | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'page load reads demo mode, candidates, postings, decisions and bench, then paints tiles, board and tables' |
| hiring.html - Postings table row: expand/collapse detail | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'postings rails filter ... and a row opens and closes its detail' (click, Enter, Space) |
| hiring.html - Postings: state rail (all, draft, posted, paused, closed, failed) and channel rail (all, linkedin, facebook... | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-postings`. Every real posting reads the way its state says (failed keeps the channel's words, posted has a date and is live outside, closed has a date, closing not before posting). Also covered by practice test: fin-b13-hiring-page.test.mjs 'postings rails filter by state and by channel...'. |
| hiring.html - Reports disclosure (summary toggle) holding the funnel and decisions tables | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | reports test: closed by default, one press opens, another closes |
| hiring.html - Reset filters button | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'Reset filters puts every filter, rail and select back to its starting value' |
| hiring.html - Stage rail: 'all stages' button + one button per stage (filters the board, 11 buttons) | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'stage rail shows one column for one stage, and all stages brings all eleven back' |
| hiring.html - Summary tiles: SHORT BY, WAITING ON YOU, ON THE BENCH, OPEN APPLICATIONS + bench chip | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `hiring-bench-tiles`. Recounts each role's open applications, bench people and short-by number from candidate_applications against v_hiring_bench. Not quiet when empty: a company with no hiring role at all is red. Also covered by practice test: fin-b13-hiring-page.test.mjs 'page load ... paints tiles' and 'summary tiles drop Demo Mode rows ...'. |
| hiring.html - Waiting-on-a-person table: click or Enter on a row opens the candidate drawer | practice-test | `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` | 'a card and a waiting-on-a-person row (click or Enter) open that candidate's drawer' |
| index.html - No session / unknown role: sends person to sign-in (login.html?next= or portal-login) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the app front door sends a person with no session, or with no role, to the sign-in page' (index.html always goes to /login.html?next=/app/index.html; the portal-login branch belongs to client-portal.html) |
| inquiry-remover.html - 'Retry' button when the queue fails to load | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the repair Retry button reads the queue again and paints the rows when the second read works' |
| inquiry-remover.html - 'Show more' button under the case queue (25 rows a time) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the case queue shows 25 rows and a button, and the button brings in the rest' |
| inquiry-remover.html - Bureau chips: Equifax, TransUnion, Experian (filter the work queue; show open counts) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `specialist-bureau-chips`. Every open inquiry names one of the three bureaus a chip counts. Also covered by practice test: fin-b13-specialist-desk.test.mjs 'a bureau chip filters the work queue ...' and the counts in 'stat tiles and bureau chips ...'. |
| inquiry-remover.html - Case drawer send options: 'Mail letter (PostGrid)' checkbox, 'Mail service' select (bureau default, first c... | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `specialist-send-options`. Portal uploads: Experian case, reference kept, portal attempt logged, case moved on. Mailed letters: provider id kept, letter attempt logged, case moved on, a failed mail with no later success is red. The service-level choice itself is only in the request (see findings). Also covered by practice test: fin-b13-specialist-desk.test.mjs 'send options: mail ticked by default, a service level, ...'. |
| inquiry-remover.html - Case drawer: 'Open documents' link (documents.html?client_id=) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the case drawer's Open documents link carries this client's id' |
| inquiry-remover.html - Case row: click or Enter expands the case drawer (items, letter draft, identity packet, send options) | not-attachable | - | The click half works and is covered as extra cover by 'a case row expands its drawer on a click and folds it on the next' (not registered as proof). The Enter half does not exist: renderCases() in public/app/inquiry-remover.html builds `tr.case-main` with only a click listener, no tabindex and no keydown, so a keyboard cannot reach or open a case row. Attaching a test would prove half of what the row says. A product change is needed (tabindex=0 plus Enter/Space on tr.case-main). |
| inquiry-remover.html - Desk headline number + 'next' button (Ready to send / Need me; opens the next case or file) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the headline counts cases ready to send, and its next button opens the oldest one' (the Need me half is the repair headline test) |
| inquiry-remover.html - Desk tabs: 'Inquiries' and 'Repair' (remembers the last pane in browser storage) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'desk tabs switch between Inquiries and Repair, swap the headline, and remember the last pane' |
| inquiry-remover.html - Expanded row 'Soft pull' button (owner, admin, closer, funding_advisor only; opens the PULL modal) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the Soft pull button is offered to owner, admin, closer and funding advisor only, and opens the type-PULL box' |
| inquiry-remover.html - Letter list item in an expanded row: opens the letter drawer (letter text, rules, signature); drawer Close ... | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'an expanded repair file lists its letters; a letter opens the drawer ...' |
| inquiry-remover.html - Repair headline 'Open <client>' next button | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'the repair headline's next button opens the first file that needs her, by name' |
| inquiry-remover.html - Repair tile filters: Need me, Ready to send, Waiting on bureau, Stuck, Trial ending (press again to clear) | practice-test | `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` | 'repair tile filters keep only the files in that set, and pressing the tile again clears them' |
| inquiry-remover.html - Stat tiles: Still open, Worked, Calls, Confirmed (move by the server's counts after each write) | live-check | `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` | check `specialist-stat-tiles`. A confirmed removal reads as done and closed; a row with logged attempts has the same count of counted attempts; worked rows name who and when. CAVEAT (finding 2): the page's own Worked bump after a confirm is wrong for a row that already had attempts, so the claim that the tiles move by the server's counts after each write is not true for that one tile; this attachment judges the saved counts the tiles read, not that bump. Also covered by practice test: fin-b13-specialist-desk.test.mjs 'stat tiles and bureau chips count the open work, and a confirm moves them by the server's answer'. |

## Files added

- `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs (the 15 live checks: one SQL text per control, built from named bad conditions)`
- `src/pulse/catalog/proofs/fin-b13-sql-kit.mjs (test kit: real table and column names from db/, stand-in database, Postgres spellings made portable)`
- `src/pulse/catalog/proofs/fin-b13-live-contracts.test.mjs (115 tests that run every live check over stand-in rows and break each condition)`
- `src/pulse/catalog/proofs/fin-b13-display-practice.mjs (the 24 practice proof cases and what each asserts)`
- `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs (15 Chromium practice tests, hiring.html)`
- `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs (14 Chromium practice tests, inquiry-remover.html and index.html)`
- `ops/workflows/finish-853-2026-10-14/manifest-b13.md (this file)`

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B13_DISPLAY_CONTRACTS`) and 1 spread line `...FIN_B13_DISPLAY_CONTRACTS,` at the START of `DISPLAY_RESULT_CONTRACTS` (not the end, so it does not collide with siblings that append). |
| `src/pulse/catalog/compiler.mjs` | 14 lines in `compileDisplayRuntimeData`: a tracked row that owns a contract marked `anyImpact: true` is judged even when it is not money or customer. This hunk is byte-for-byte the same as the one in `fin/b15`, so the two merge as one. `fin/b06` has a different hunk in the same place for money and customer rows; the two together need one loop that accepts both. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and `...FIN_B13_DISPLAY_PROOF_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES`. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count `672` to `648` (24 rows moved from red to a practice test). Sum the other batches. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to 55, pass-capable 27 to 42, distinct SQL 27 to 42, DB calls 27 to 42, passes 27 to 42, shipped-data copy 40 to 55. Add every batch together and use the numbers the test prints. |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`. Do not hand-merge; recompile after merging. |

No product file was changed. `public/app/*` and `shell.js` were broken on purpose one line at a time and restored with `git checkout`; `git status` was clean afterwards.

## Product findings (found, not fixed)

1. **Specialist desk, case row: Enter does nothing.** `renderCases()` in `public/app/inquiry-remover.html` builds `tr.case-main` with a click listener only: no `tabindex`, no keydown. The row says "click or Enter". Measured: the row cannot be focused and Enter does not expand it. Row left NOT_PROVED (`not-attachable`). The work-queue rows below it do have Enter.
2. **Specialist desk, Worked tile double counts.** On load a row with attempts and not done is already in Worked. Confirming that row adds one to Worked again. Measured: 2 rows, one with 1 attempt; Worked reads 1 on load, 2 after confirming the worked row, and 1 again after a reload. Still open, Confirmed and Calls move correctly. The live check on this row judges the saved counts behind the tiles; the after-write bump is the page's own and is wrong for already-worked rows.
3. **A failed mail still moves the case on.** `sendCase` logs the letter attempt with `mail_failed:...` and then still sets the case to In Progress and moves the card to Letters sent, and the API answers ok. The page then shows the case as Sent. The `specialist-send-options` check goes red on a failed letter that was never re-sent.
4. **The mail service choice leaves no trace.** `mail_service_level` goes to the mail provider only; it is not stored on the case or on the attempt. No saved result can say which level was used. The request half is covered by the practice test; there is nothing to read.
5. **Portal gate, page and server disagree on spelling.** The page shows the Experian portal block when `bureauKey(selected_bureaus_raw)` is EX (so "Experian" counts). `sendCase` refuses unless the raw text upper-cased is exactly "EX". A case saved as "Experian" shows the box and the server answers `portal_ex_only`. Latent: depends on what is stored.
6. **The decide API accepts moves the screen hides.** `api/hiring/decide.mjs` takes `to_stage` onboarding, ramp or performing for an open application; `advance()` sets status hired only for hired. That person stays open and is counted in OPEN APPLICATIONS. The drawer stops at hired for this reason. The three board column checks go red on such a row.
7. **Hiring reads use the default company, not the session's** (same as S5 finding 3). The live checks read the company the pulse runs for; they agree only when that is the default company.
8. **Show more reveals everything at once.** The button's number is all the rows held back, not another 25. The row text says "25 rows a time"; the page shows 25 first and then the rest.
9. **index.html never goes to portal-login.** It always goes to `/login.html?next=/app/index.html` (or `/login.html` after a sign-out). The portal-login branch in the row text belongs to `client-portal.html`.
10. **Integration risk, display lane time.** The display lane runs each distinct SQL one after another inside one pulse step (Netlify cuts a step at 26 seconds). It had 27 distinct texts on `fin/base`; this batch adds 15, and the other batches add more. Not fixed here. The integrator should count them after the merge and run them in parallel or in two steps if needed, then check the time with `npm run pulse:prove`.

## Can each check fail? (break, then red, then restored)

- Live checks: `fin-b13-live-contracts.test.mjs` runs each exact SQL text over stand-in rows (115 tests). For every named bad condition it shows the wrong row goes red with the exact bad count, and that the same row is NOT caught when only that condition is cut from the text. It also shows good rows read green, another company is never read, and demo rows (each of the three demo marks) are never read.
- Live checks, source breaks: 22 breaks of the contract text itself (a condition cut, a company filter dropped, a wrong stage or table, a wrong comparison); every one turned the test red. Three stayed green on the first pass: the written-reason half of the turn-down check and the Experian spelling were not in any fixture (fixtures strengthened, re-run red), and one of my break texts was a no-op (redone, red).
- Hiring page: 35 breaks across `hiring.html` and `shell.js`, each red. One stayed green on the first pass (the DEMO mark: both marks were on the same fake row); the test now has three demo rows with one mark each, and each mark is load-bearing.
- Specialist desk and front door: 38 breaks across `inquiry-remover.html` and `shell.js`, each red.

## What I ran

- `node scripts/pulse/count-not-proved.mjs` in the worktree: 853 open before, 814 after (this batch: 40 before, 1 after).
- `node scripts/pulse/compile-catalog.mjs` and `--check`: fresh.
- `node --test src/pulse/catalog/proofs/fin-b13-live-contracts.test.mjs`: 115 of 115 pass.
- `node --test src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs`: 15 of 15 pass. `fin-b13-specialist-desk.test.mjs`: 14 of 14 pass. The three files together, run three times in a row: 144 of 144 each time.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs`: 53 of 53 pass.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs --test-name-pattern="every display proof case names|unmapped display rows"`: 2 of 2 pass (red count 648).
- `npm run lint`: 3,568 files and inline scripts parse clean.
- The third test inside `display-proof-cases.test.mjs` ("runs every executable test named by every case", 139 files) did NOT finish green in this run, and I cannot call it green. Three tries: one inside the test (436 s, child exited 1, its captured text is cut and names no failing test), and two direct runs of the same files on my branch. All stopped at the same place, test 609 (`public display contracts click every mapped control`), then waited on the long Playwright batches while the Mac sat at load average 50 to 160 from sibling builders. The same 137 files on a clean checkout of `fin/base` reached the same test 609 and the same wait, so this is the known load behavior in the earlier slice manifests, not these files. My own files do not appear in that cut-off output at all. What I ran instead: my three test files alone (144 of 144, three times), every test file that imports the catalog, the display lane or the proof registry (`na-conditions`, `gap-catalog`, `modules`, `no-unfenced-transmit`, `compiler`, `door-contracts-routes-01`, `door-contracts-routes-01-2`, `display-contracts-ab`, `-ab-2`, `-ab-3`: 141 of 141) and the lane test (11 of 11). The integrator should run the aggregator once on a quiet machine.

