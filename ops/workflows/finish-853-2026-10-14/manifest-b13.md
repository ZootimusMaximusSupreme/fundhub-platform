# Batch 13 manifest (finish-853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b13`, cut from `fin/base` (2f4f574a0). Nothing was pushed or merged.
Rows: the Hiring desk (`hiring.html`, 26 rows), the app front door (`index.html`, 1 row) and the Specialist desk (`inquiry-remover.html`, 13 rows), all in `desks-c.json`.

Generation 1 built it. Generation 2 challenged the one row left open. **Repair cycle 1** (this version) answers an independent checker that broke 28 rows and found each one stayed green while the product was wrong. Every one of the 28 was fixed, or the attachment was taken off and the row went back to NOT_PROVED with the exact reason (section "Repair cycle 1" below).

## The numbers

| | Rows of this batch (40) |
|---|---|
| Live check (a saved-result read that can go red) | 14 |
| ...of which also have a practice test attached | 12 |
| Practice test only | 20 |
| Not attachable (left NOT_PROVED, reason below) | 6 |

Whole lane, same script (`node scripts/pulse/count-not-proved.mjs`): 853 open on `fin/base`; 814 at the start of repair cycle 1; **819 after it** (the other lanes did not move: routes 135, flows 23, reads 15; display 646). The five rows that went back to NOT_PROVED are the cost of not leaving a check that stays green on a break.

A **live check** reads real saved rows on the live server and goes red when one is wrong. A **practice test** is a real Chromium on the real page with fake API answers; it reads no live data. Twelve rows have both: the live check judges the saved rows behind the control, the practice test judges what the page does with them, and both are attached (a break on either side is red). Nothing here is called "deep" or "proof".

## Repair cycle 1: the 28 rows the checker broke

| Row | Final outcome | What changed |
|---|---|---|
| Board column: Screening, Hired, Onboarding, Ramp, Performing, Withdrawn (6 rows) | live-check (+ practice test) | The sentence over-claimed "a named person and the words". The database does not require either for a move forward (`advance()` header: a scheduling job may move people, the reason is optional), so the SQL is right and the words were wrong. Each column's requirement text now says exactly what is judged. Onboarding, Ramp, Performing and Withdrawn say in the PASS words that nothing on the screen moves anyone there, so they read no results today and go red if someone is placed there wrong (finding 6). New practice test: every stage column holds exactly its own people, name and count (this also judges the page half of Offer and Not Moving Forward). |
| Board filter: flagged only | practice-test | The test now asserts the pressed look (`.on` class) as well as `aria-pressed`, both on and off. |
| Board filter: role select | practice-test | All three roles are chosen in turn (sales_coordinator included), the option list is asserted, and each role's people and count are exact. |
| Board filter: source select | practice-test | One person for each of the nine sources; each source is chosen and shows only its own person; the option list equals the row's nine and equals `candidates_source_ck` read from `051_hiring.sql`. |
| Demo Mode rows | practice-test | Six demo rows (both signs, source_detail only, name only, hyphen, em dash, one on the bench) plus a real surname that starts DEMO. Bench numbers, the waiting count line, the demo badge in the waiting table, the demo note on every tile and the hidden count are asserted. |
| Summary tiles | live-check (+ practice test) | The live text only recounted the view against its own predicates. Two parts that read the saved applications were added: an open application sitting in Hired, Onboarding, Ramp, Performing, Not Moving Forward or Withdrawn, and an open application on a role that is not active. A new practice test adds up the bench rows role by role, checks WAITING ON YOU counts a closed flagged person while "still open" does not, and checks the chip. The requirement says WAITING ON YOU is judged by the page test. |
| Postings: state rail and channel rail | live-check (+ practice test) | Two reachability conditions read the page's own button lists (checked against `hiring.html` by a test). A Zoho posting (channel `zoho`, written by `src/hiring/zoho.mjs`, allowed by migration 298) is counted in all channels and in no channel button, so it now goes red, and so does a state no button names. |
| Reset filters | practice-test | The postings channel rail, the decision-log kind rail, the funnel days select and the decision-log role and days are all moved first, then every one is asserted back, the funnel is read again for 90 days, and every rail is back on its "all" button. |
| Reports disclosure | practice-test | `#dcTbl` hidden while closed and visible when open, and both tables are inside the `<details>`. |
| Waiting-on-a-person table | practice-test | Each row is opened by click, by Enter and by Space, for the second row as well as the first, and the application read is for the person opened. The table's own "in stage" column is cut from the fixed date (finding 1); the row's words are only about opening the drawer, so that column is left to finding 1 and is not part of this attachment. |
| Page gate | practice-test | client and affiliate are signed in and sent away; owner and admin must have the row marked `data-fh-gated` by shell.js itself (the CSS rule hides it too, so visibility alone proved nothing). |
| 'Retry' button | practice-test | The `.catch` branch is tested as well, both ways it can fail (connection dropped, proxy answers with a page). |
| Bureau chips | live-check (+ practice test) | Demo rows are no longer left out (the page lists and counts them). The spelling list is checked against `BUREAU_KEYS` on the page by a test. New practice test: every spelling lands in its own chip, the filter reaches each, a finished removal is counted in none. |
| Case drawer send options | live-check (+ practice test) | Two new parts read the attempt first: a portal upload logged with no reference on the case, and a letter logged "sent" with no provider id on the case (the write is two statements with no transaction). Queued and Blocked are both asserted as "still waiting" in both halves. Practice test adds: no portal block on an Equifax case, and a portal-only request. The Mail service choice is saved nowhere (finding 4), so only the page's request is judged for it; the server's choice of level is unit-tested in `src/inquiry-ops/call-scheduler.test.mjs`. |
| Desk headline number + next | practice-test | Thirteen cases of every kind: blocked, mailed, portal, call due, delivered, call fired, completed, no bureau, escalated, in progress, scheduled. The number is the three that can be sent now, the sentence names the oldest and the two that need a person, and each case's label is asserted. |
| Letter list item | practice-test | A file with two letters: each opens its own title, rules and words (and not the other's), the keyboard opens the second, and Send this one mails the second letter. |
| Repair headline 'Open <client>' | practice-test | A waiting file first in the list is not offered; no needing file means no button and the exact quiet line. |
| Repair tile filters | practice-test | Twelve files, one for every reason a file can belong to a tile (agreement, answer to read, letters, ready stage, round done, server flag, waiting, in transit, stalled, late, upsell, program upsell). Each tile's number is the server's field of its own name (all different), and each tile keeps exactly its files. |
| Decisions log | **not-attachable** | The days select cuts from `var NOW = new Date(2026,6,30,15,20)` (hiring.html line 546), not from today. Measured in the checker's Chromium: a 90-day window still lists a 148-day-old decision. A test that is green pins the bug; a test that tells the truth is red today. Nothing was attached. |
| Page load | **not-attachable** | Same fixed date: every live row entered after 2026-07-30 paints a negative "in stage" number on the board card and in the waiting table, and the stage-age stripes never fire. The row says it paints the board and the tables. |
| Funnel: role + days select | **not-attachable** | The select re-reads the server's funnel correctly, but the caption under it ("N turned down in this window") is cut from the same fixed date, so it disagrees with the table above it for any live date. The caption is part of what the selects drive. |
| 'Show more' button | **not-attachable** | The row says "25 rows a time". The page shows 25, then one press shows ALL the rest (`pageSize = allCases.length`, line 2988). Measured with 60 cases: 25, then 60. A test that passes pins words that are false. |
| Stat tiles | **not-attachable** | After a confirm the page bumps Worked by one even for a row that already had attempts (`bump('worked', 1)`, line 2159): Worked reads 1 on load and 2 after confirming the worked row, true answer 1. The row's words say the tiles move by the server's counts. A saved-result read cannot see a client-side bump, and a test that tells the truth is red. The live check was removed (it judged only the saved counts and hid the false claim). |

### What each not-attachable row needs, so it can be closed

1. **One line closes three rows** (Decisions log, Page load, Funnel): `var NOW = new Date();` in `public/app/hiring.html` line 546. Then add one assertion that a candidate who entered a stage 5 days ago reads "in stage 5d", re-point the date-built test (`the funnel re-reads ...; the decision log filters ...`, already built from the page's own clock so it passes before and after) at those three rows in `fin-b13-display-practice.mjs`, and recompile. The brief forbids product fixes in this run.
2. **Show more**: either the button shows 25 more per press, or the row's words become "25 rows, then a button for the rest". Then attach `the case queue shows 25 rows and a button, and the button brings in the rest` (it passes today as cover).
3. **Stat tiles**: bump Worked only when the row was not already counted (`wasAttempts === 0`), or recompute the tiles from the server's counts. Then re-add the saved-count check (it is in git history at commit `b8aaafbdd`, key `specialist-stat-tiles`) and attach the test `stat tiles and bureau chips count the open work, and a confirm moves them by the server's answer` after adding the already-worked row case.
4. **Case row Enter** (unchanged from generation 2): add `tabindex="0"` and an Enter/Space handler to `tr.case-main` in `renderCases()`, add one test that focuses the row and presses both keys, register it.

## Every row (40)

| Row | Outcome | File | What proves it |
|---|---|---|---|
| hiring.html - Board column: Screening (screening) | live-check + practice-test | `fin-b13-display-contracts.mjs`, `fin-b13-hiring-page.test.mjs` | check `hiring-column-screening` (open, recorded move in; no person or words, a move forward may be a scheduling job). Test: every stage column holds exactly its own people. |
| hiring.html - Board column: Offer (offer) | live-check + practice-test | same | check `hiring-column-offer` (open, recorded move in, an offer decision that names a person). Same column test. |
| hiring.html - Board column: Hired (hired) | live-check + practice-test | same | check `hiring-column-hired` (marked hired, recorded move in). Same column test. |
| hiring.html - Board column: Onboarding (onboarding) | live-check + practice-test | same | check `hiring-column-onboarding`. Reads no results today (nothing on the screen puts anyone here); red if someone is there and not marked hired. Same column test. |
| hiring.html - Board column: Ramp (60-day trial) (ramp) | live-check + practice-test | same | check `hiring-column-ramp`. Same words as Onboarding. Same column test (two people count as two). |
| hiring.html - Board column: Performing (performing) | live-check + practice-test | same | check `hiring-column-performing`. Same words as Onboarding. Same column test. |
| hiring.html - Board column: Not Moving Forward (rejected) | live-check + practice-test | same | check `hiring-column-rejected` (marked rejected, recorded move in, a reject decision with a named person and written words). Same column test (reads as closed). |
| hiring.html - Board column: Withdrawn (withdrawn) | live-check + practice-test | same | check `hiring-column-withdrawn`. Nothing in the product writes this stage; reads no results today. Same column test (empty words). |
| hiring.html - Board filter: 'flagged only' toggle | practice-test | `fin-b13-hiring-page.test.mjs` | 'role select, source select and the flagged-only toggle each narrow the board, and clear again' |
| hiring.html - Board filter: role select | practice-test | same | same test (three roles, option list) |
| hiring.html - Board filter: source select | practice-test | same | 'the source select names all nine sources the database allows, and each one shows only its own people' |
| hiring.html - Decisions log | not-attachable | - | Fixed date (finding 1). |
| hiring.html - Demo Mode rows | practice-test | same | 'summary tiles drop Demo Mode rows from every number and say how many were left out' and 'demo session (fh_demo=1) shows sample rows and reads no hiring endpoint' |
| hiring.html - Drawer close: X button, scrim click, Escape key | practice-test | same | 'drawer closes from the X button, a click on the scrim, and the Escape key' (unchanged) |
| hiring.html - Drawer: Reject button + required reason box | live-check | `fin-b13-display-contracts.mjs` | check `hiring-reject` (unchanged); also covered by 'drawer Reject needs a written reason, ...' |
| hiring.html - Drawer: stage select + Advance button | live-check | same | check `hiring-advance` (unchanged); also covered by the two Advance tests |
| hiring.html - Funnel: role select + days select | not-attachable | - | Fixed date (finding 1), caption. |
| hiring.html - Page gate | practice-test | same | 'only owner and admin stay on the Hiring page; every other staff role is sent to its own home' |
| hiring.html - Page load | not-attachable | - | Fixed date (finding 1). |
| hiring.html - Postings table row: expand/collapse detail | practice-test | same | 'postings rails filter by state and by channel, show the counts, and a row opens and closes its detail' (unchanged) |
| hiring.html - Postings: state rail and channel rail | live-check + practice-test | both | check `hiring-postings` (now with the two reachability conditions); same postings test |
| hiring.html - Reports disclosure | practice-test | same | 'the reports fold is closed until asked, and holds both the funnel and the decisions tables' |
| hiring.html - Reset filters button | practice-test | same | 'Reset filters puts every filter, rail and select back to its starting value' |
| hiring.html - Stage rail | practice-test | same | 'stage rail shows one column for one stage, and 'all stages' brings all eleven back' (unchanged) |
| hiring.html - Summary tiles | live-check + practice-test | both | check `hiring-bench-tiles` (view recount + two saved-application parts); 'the four tiles add up the bench rows the server sent, and the waiting tile counts closed people too' and the demo test |
| hiring.html - Waiting-on-a-person table | practice-test | same | 'a card and a waiting-on-a-person row (click or Enter) open that candidate's drawer' |
| index.html - No session / unknown role | practice-test | `fin-b13-specialist-desk.test.mjs` | 'the app front door sends a person with no session, or with no role, to the sign-in page' (unchanged) |
| inquiry-remover.html - 'Retry' button | practice-test | same | three tests: server error, connection dropped, proxy answers with a page |
| inquiry-remover.html - 'Show more' button | not-attachable | - | Words false (finding 8). |
| inquiry-remover.html - Bureau chips | live-check + practice-test | both | check `specialist-bureau-chips`; 'every spelling of a bureau lands in its own chip, ...' and 'a bureau chip filters the work queue ...' |
| inquiry-remover.html - Case drawer send options | live-check + practice-test | both | check `specialist-send-options` (five parts); 'send options: mail ticked by default, a service level, the Experian portal block only on an Experian case' |
| inquiry-remover.html - Case drawer: 'Open documents' link | practice-test | same | unchanged |
| inquiry-remover.html - Case row: click or Enter | not-attachable | - | The Enter half does not exist (finding 1 of generation 2, now finding 5 below). Unchanged. |
| inquiry-remover.html - Desk headline number + 'next' button | practice-test | same | 'the headline number counts only cases that can be sent now, and its button names the oldest of them' and the older one |
| inquiry-remover.html - Desk tabs | practice-test | same | unchanged |
| inquiry-remover.html - Expanded row 'Soft pull' button | practice-test | same | unchanged |
| inquiry-remover.html - Letter list item | practice-test | same | 'each letter in the list opens its own words, rules and title, and Send this one mails that letter' and the older close test |
| inquiry-remover.html - Repair headline 'Open <client>' | practice-test | same | 'the repair headline offers a file only when one needs her: ...' and the older one |
| inquiry-remover.html - Repair tile filters | practice-test | same | 'each repair tile prints the server's own number and keeps every file that belongs to it, by every reason' and the older one |
| inquiry-remover.html - Stat tiles | not-attachable | - | Worked bump wrong (finding 2). |

## Files added or changed on this branch

- `src/pulse/catalog/proofs/fin-b13-display-contracts.mjs` (14 live checks; built from named bad conditions, one SELECT per kind of saved row)
- `src/pulse/catalog/proofs/fin-b13-sql-kit.mjs` (test kit: real table and column names from db/, stand-in database; unchanged this cycle)
- `src/pulse/catalog/proofs/fin-b13-live-contracts.test.mjs` (119 tests: every condition alone, only that condition catches it, other company never read, demo rows, page lists tied to the SQL lists, 29 text breaks)
- `src/pulse/catalog/proofs/fin-b13-display-practice.mjs` (the 32 practice proof cases and what each asserts)
- `src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs` (19 Chromium practice tests)
- `src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs` (21 Chromium practice tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b13.md` (this file)

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B13_DISPLAY_CONTRACTS`) and 1 spread line `...FIN_B13_DISPLAY_CONTRACTS,` at the START of `DISPLAY_RESULT_CONTRACTS`. Unchanged this cycle. |
| `src/pulse/catalog/compiler.mjs` | 14 lines in `compileDisplayRuntimeData`: a tracked row that owns a contract marked `anyImpact: true` is judged even when it is not money or customer. Same hunk as `fin/b15`. Unchanged this cycle. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and `...FIN_B13_DISPLAY_PROOF_CASES,` at the end of `PLUGIN_DISPLAY_PROOF_CASES`. Unchanged this cycle. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count is now **640** (was 648 at the end of generation 2, 672 on `fin/base`): 32 rows are attached to a practice test, 4 rows left the list in this cycle (Page load, Funnel, Decisions log, Show more). Sum the other batches. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | contracts 40 to **54**, pass-capable 27 to **41**, distinct SQL 27 to **41**, DB calls 27 to **41**, passes 27 to **41**, shipped-data copy 40 to **54**. The Stat tiles check was removed, so this is one less than generation 2. Add every batch and use the numbers the test prints. |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog`. Do not hand-merge; recompile after merging. |

No product file was changed. `public/app/*` and `shell.js` were broken on purpose one line at a time and restored by the harness; `git status` shows no product file changed.

## Product findings (found, not fixed)

1. **The hiring page runs on a fixed date.** `var NOW = new Date(2026,6,30,15,20)` (hiring.html line 546, with a comment that it is deliberate: "no aging column"). Every "in stage Nd" number on the board card and in the waiting table, the stage-age stripes, the funnel caption and the whole Decisions log window are cut from 30 July 2026, not from today. For a person who entered a stage on 10 October the card reads "in stage -72d". Measured by the checker in a real Chromium on 15 October. One line, `new Date()`, fixes it. It is why three rows are not attachable.
2. **Specialist desk, Worked tile double counts.** On load a row with attempts and not done is in Worked. Confirming that row adds one again (`bump('worked', 1)`). Measured: 2 rows, one with 1 attempt; Worked reads 1 on load, 2 after confirming the worked row, 1 again after a reload. Still open, Confirmed and Calls move correctly.
3. **A failed mail still moves the case on.** `sendCase` logs the letter attempt with `mail_failed:...` and then still sets the case to In Progress and moves the card to Letters sent, and the API answers ok. The live send-options check goes red on a failed letter that was never re-sent.
4. **The mail service choice leaves no trace.** `mail_service_level` goes to the mail provider only; it is not stored on the case or on the attempt. The page's request is covered by the practice test; the server's choice of level by `call-scheduler.test.mjs`; nothing saved can say which level was used.
5. **Specialist desk, case row: Enter does nothing.** `renderCases()` builds `tr.case-main` with a click listener only: no `tabindex`, no keydown. The work-queue rows below it do have Enter. (Unchanged from generation 2; row stays NOT_PROVED.)
6. **The decide API accepts moves the screen hides.** `api/hiring/decide.mjs` takes `to_stage` onboarding, ramp or performing for an open application; `advance()` sets status hired only for hired, so that person stays open and is counted in OPEN APPLICATIONS. The drawer stops at Hired for this reason. The three board column checks and the new open-application part of the tiles check go red on such a row.
7. **Hiring reads use the default company, not the session's** (same as S5 finding 3). The live checks read the company the pulse runs for; they agree only when that is the default company.
8. **Show more reveals everything at once.** The button's number is all the rows held back, not another 25. The row says "25 rows a time"; the page shows 25 and then the rest.
9. **index.html never goes to portal-login.** It always goes to `/login.html?next=/app/index.html`. The portal-login branch in the row text belongs to `client-portal.html`.
10. **A Zoho posting is reachable from no channel button (new).** `src/hiring/zoho.mjs` `ensurePosting` writes every Zoho posting on channel `zoho` (allowed by migration 298). The page's `POST_CHANNELS` has four channels and no zoho, so the posting is counted in "all channels" (measured by the checker: all channels 2, buttons add to 1) and in no channel button. The postings check now goes red on one.
11. **The queue page counts demo inquiries (new).** `api/read/inquiries.mjs` has no `is_demo` filter and the page does not drop those rows, so Still open and the chips include demo rows. The bureau check therefore reads them too (the send-options check still leaves demo cases out: a seeded demo case has no send trail).
12. **Integration risk, display lane time.** The display lane runs each distinct SQL one after another inside one pulse step (Netlify cuts a step at 26 seconds). It had 27 distinct texts on `fin/base`; this batch adds 14 (one fewer than before), and the send-options text is now five parts long. The integrator should count them after the merge and run them in parallel or in two steps if needed, then check the time with `npm run pulse:prove`. The new SQL has not run against a Postgres (there is none on this Mac); it ran over stand-in rows with the real table and column names.

## Can each check fail? (break, then red, then restored)

- **Live checks**: `fin-b13-live-contracts.test.mjs` runs each exact SQL text over stand-in rows. For every named bad condition the wrong row goes red with the exact bad count, and the same row is NOT caught when only that condition is cut from the text. A second block makes 29 edits to the text itself (a status or stage changed, a list shortened or lengthened, a spelling dropped, a company or demo filter removed, an `u.created_at > t.created_at` excuse removed, Blocked or Queued left out of each waiting list) and fails if any edit changes nothing or stays green. A third test reads the page and fails if the SQL's bureau spellings or posting rails differ from `BUREAU_KEYS`, `POST_STATES` or `POST_CHANNELS`.
- **Hiring page**: 71 edits to `hiring.html` and `shell.js`, one line at a time, restored each time by the harness; 71 of 71 red (filters 16, demo 12, reset 11, waiting table 5, gate 5, tiles 8, postings 5, reports 3, columns 6).
- **Specialist desk**: 47 edits to `inquiry-remover.html`, 47 red once two pairs of redundant clauses (the "in transit" stage and the "late" flag are each tested twice in the page, by the chip and by the set) are removed together; removed one at a time they change nothing (equivalent edits, not a gap). Chips 8, send options 9, headline 9, Retry 2, letters 4, repair headline 3, tiles 12.
- Where a test stayed green on the first pass it was strengthened and re-run (the three filter lists, the `.catch` Retry, the second letter, the gone-out cases). A race in the new letters test (it asserted the drawer closed before the page had) was found and fixed by waiting on the drawer.

## What I ran

- `node scripts/pulse/count-not-proved.mjs` before and after: 814 to 819 open (whole lane); batch rows 1 to 6.
- `npm run pulse:catalog` and `node scripts/pulse/compile-catalog.mjs --check`: fresh.
- `node --test src/pulse/catalog/proofs/fin-b13-live-contracts.test.mjs`: 119 of 119.
- `node --test src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs`: 19 of 19. `fin-b13-specialist-desk.test.mjs`: 21 of 21. The three files together, three runs in a row: 159 of 159 each time.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs`: pass.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs --test-name-pattern="every display proof case names|unmapped display rows"`: 2 of 2 (red count 640).
- `npm run lint`: 3,568 files and inline scripts parse clean.
- `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (all three tests, including the aggregator that runs every executable test named by every case, 139 files): **3 of 3 pass** on this branch, on a Mac at load average 6 to 13. Earlier cycles could not finish this test under heavier load; it needs a quiet machine and several minutes.
