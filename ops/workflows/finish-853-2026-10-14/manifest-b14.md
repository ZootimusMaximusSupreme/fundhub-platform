# Batch 14 manifest (finish the 853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b14`, from `fin/base` (`2f4f574a0`). Worktree `.claude/worktrees/fin-b14`. Nothing was pushed or merged.
Pages: `journeys.html` (23 rows) and `lenders.html` (17 rows), both in `desks-c.json`.

This file is the state after repair cycle 1 (see "Repair cycle 1" at the end). In that cycle an independent
checker found 29 attached rows that stayed green when the product broke. Each one was made red on its exact break,
or taken back out of the catalog with the exact reason.

## The numbers

| | Rows |
|---|---|
| Batch rows | 40 |
| Open (NOT_PROVED) before this cycle, `node scripts/pulse/count-not-proved.mjs` on `97ae30022` | 1 of the batch (whole lane 814) |
| Open after this cycle | 7 of the batch (whole lane 820) |
| live-check | 6 (4 of them also name practice tests for the button's own request) |
| practice-test | 27 |
| na-verified | 0 |
| not-attachable | 7 |

The seven open rows are the Page gate row (one decision for Chris) and six rows whose control gives a wrong
result today (findings 6, 9, 10, 11, 12 and 2). The display red count test (`display-proof-cases.test.mjs`) goes
from 633 to 639: six rows came back out.

## Every row

| Surface | Control | Outcome | Where |
|---|---|---|---|
| lenders.html | List filter: Product table select (OnlineBizCC, InBranchBizCC, BizLOC_Stated, BizLOC_Documented, PersonalCC, PersonalLoans, PersonalLOC) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | List filter: Bureau pulled input (EX / EQ / TU) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | List filter: Priority tier select (1, 2, 3) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | List filter: Status select (Active / Inactive) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | List filter: Eligible state input | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | List filter: Name search input | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | Apply filters button | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | Export CSV button (downloads lenders.csv for the current filters) | not-attachable | Left out. A refused export is saved as lenders.csv (finding 12). |
| lenders.html | Import CSV button (opens paste box) and Cancel button | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Import now button (paste CSV, creates and updates lender rows) | live-check | `fin-b14-display-contracts.mjs` `lendersImportSql` (every lender touched in 90 days, with or without a row id; every tip prefix and all four money columns judged); the button's own request in `fin-b14-lenders.test.mjs`. |
| lenders.html | Add blank row button (prompts for a lender name, creates one row) | live-check | `fin-b14-display-contracts.mjs` `lendersAddSql`. |
| lenders.html | Lender row inline cells: name, product table, bureaus, requirements, tier, status, eligible states (7 editable fields) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Lender row Save button (writes the 7 fields, stamps last_updated_by) | not-attachable | Left out. An emptied Name is sent as null and the handler's guard misses it (finding 2). |
| lenders.html | Mismatch queue row: Confirm button | live-check | `fin-b14-display-contracts.mjs` `mismatchConfirmSql` (the saved row); the button's word and the handler's write in `fin-b14-lenders.test.mjs`, `fin-b14-lenders-handlers.test.mjs`, `fin-b14-lenders-sql.test.mjs`. |
| lenders.html | Mismatch queue row: Corrected button | live-check | `fin-b14-display-contracts.mjs` `mismatchCorrectSql` (the saved row); the button's word and the handler's write in the same three files. |
| lenders.html | AI bureau config: Add bureau row button (adds an empty editable row) | not-attachable | Left out. Add redraws the table and throws away typed text (finding 11). |
| lenders.html | AI bureau config row: 7 fields (code, name, service number, IVR version, menu path, hold minutes, active) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Page gate: owner and admin author journeys (PUT/ask/run answer 403 to others); no sidebar row exists (NAV_HIDDEN), reached only by URL or link | not-attachable | Left out. The run door lets the sales manager in (finding 1). |
| journeys.html | Page load: reads saved journeys; falls back to seeded example trees if the table is empty | live-check | `fin-b14-display-contracts.mjs` `journeysLoadSql`. |
| journeys.html | Journey list tab: Client | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Setter | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Closer | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Funding Advisor | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Affiliate | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: White-Label Partner | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Canvas: click a step to select it (opens Step panel) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Canvas: '+' between steps opens the add-step menu (10 types: text, email, wait, question, move card, assign, hand off, agent, take payment, save) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel fields: text body and timing (text), subject/body/timing (email), wait length + unit, question field + test, stage + pipeline, role, agent + note, payment amount + product, note | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel: Move up / Move down / Delete | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel: 'Make the change' (AI rewrites one step) and canvas ask box 'Make the change' + example prompts | not-attachable | Left out. An answer that only removes steps is applied with no bar and called empty (finding 9). |
| journeys.html | Canvas: 'Keep it' / 'Throw it away' on an AI patch | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel: 'Run from here' (plays the journey in the browser from this step) | not-attachable | Left out. From a step on the path not taken the whole journey plays (finding 10). |
| journeys.html | Simulate tab: 'At a question' select + Run the journey / Stop | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | History tab: 'Roll back to this' (saved version) and 'Put it back' (single change) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Header: Undo (also Cmd/Ctrl+Z) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Header: Save version | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Header: Apply to code and bottom-bar Apply (saves every edited journey) | live-check | `fin-b14-display-contracts.mjs` `journeysApplySql` (the saved row against what `api/journeys.mjs` refuses on save, 69 crafted journeys, same answer on every one); the button's own request in `fin-b14-journeys.test.mjs`. |
| journeys.html | Bottom bar: Discard (revert unsaved edits) | not-attachable | Left out. Discard on one journey zeroes the page-wide unsaved count (finding 6). |
| journeys.html | Header: 'Test against the code' (walks every branch with throwaway clients inside a rolled-back transaction) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). Also `journeys-run-handler.test.mjs`, `fin-b14-journeys-handlers.test.mjs`, `fin-b14-journeys-run.test.mjs`. |
| journeys.html | Run report panel: Close button | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |

## What was built (all new files are `fin-b14-*`, all under `src/pulse/catalog/proofs/`)

| File | What it is |
|---|---|
| `fin-b14-display-contracts.mjs` | The six live checks: one read-only SQL text each, built from named bad-result conditions, `emptyAs: "quiet"`. Imports nothing. Cycle 1: the Apply check is the product's own refusal (see below); the Import check reads every lender touched in 90 days; a live row may name `alsoTests`. |
| `fin-b14-sql-kit.mjs` | Test kit: real table and column names read from `db/schema` and `db/migrations`; Postgres text spelled for SQLite; a stand-in database. Cycle 1: `jsonb_typeof`, `jsonb_array_length` and `regexp_replace` answer the way Postgres answers; `ILIKE`, `~*` and every cast run. Tests only. |
| `fin-b14-live-contracts.test.mjs` | 64 tests. Runs the exact SQL text over stand-in rows; every named condition red on its own row and only on that condition; clean, other-company, demo and out-of-window rows never counted. Cycle 1: a corpus of 69 crafted journeys run through `findBadSteps` and `findSingleBraceTagsInNodes` and through the SQL (same answer on every one); the tip rule against `isTipRow` name for name, with the prefixes read out of `src/lenders/tips.mjs`; each of the four money columns. |
| `fin-b14-kit.mjs` | Row tracker (a row is claimed only inside the callback that asserts it) and browser helpers. Cycle 1: dialogs also log the text a prompt opens with. |
| `fin-b14-rows.json` | The rows, by test file. Cycle 1: six rows moved to `notAttached`; the Apply row listed (live). |
| `fin-b14-display-proofs.mjs` | The proof cases handed to the catalog: 6 live and 27 practice. |
| `fin-b14-not-attachable.mjs` | The seven rows left out, and exactly why. |
| `fin-b14-rows.test.mjs` | Guard: every listed row is one exact map row, every test file is a plain test with no live call, one proof case per attached row, and each reason is held against the source line it rests on (it goes red the moment the line changes). |
| `fin-b14-journeys.test.mjs` | 28 browser tests, real page in Chromium, fake /api. Cycle 1 added: the + placement and every kind's settings, Apply for every edited journey (and a refusal, and the brace guard), Undo for every kind of change, History (two versions, typed change, another journey), Move and Delete inside a path and on a question, the AI engine's operations, the page side of the run report, Save version across journeys, and five KNOWN BREAK guards. |
| `fin-b14-lenders.test.mjs` | 17 browser tests. Cycle 1 added: the desk opened from a client, failed and slow reads, singular words, Import now (request, result words, eight-issue cap, refusal), blank lender cells, several lenders, all seven bureau values (inactive stays inactive), the mismatch queue's Confirm and Corrected, and three KNOWN BREAK guards. |
| `fin-b14-lenders-sql.test.mjs` | 15 tests. The REAL `api/read/lenders.mjs`, `api/read/lender-observations.mjs` and `api/lender-observations.mjs` and their real SQL, run over stand-in rows: what each filter returns, AND not OR, every way of saying any state, the company and sample-lender scope, the export, the queue, and what Confirm and Corrected write. New in cycle 1. |
| `fin-b14-journeys-run.test.mjs` | 6 tests. The REAL `api/journeys/run.mjs` and the real walker, to the success answer: both lanes of a question walked, every path in the answer, never committed, rolled back last, the connection released, every throwaway client marked synthetic in the caller's own company. New in cycle 1. |
| `fin-b14-journeys-handlers.test.mjs`, `fin-b14-lenders-handlers.test.mjs` | The real handlers on a stand-in database. Cycle 1: the review SET clause carries the word sent; one KNOWN BREAK guard for the handler half of the row Save finding. |

Browser tests use the S4 harness (`s4-screen-harness.mjs`): static server for `public/`, one Chromium, every `/api` call answered by the test, every other host aborted. The AI door is a fake answer. Nothing reaches a database or a vendor.

## Shared lines touched

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B14_RESULT_CONTRACTS`) and 1 line `...FIN_B14_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`. (Cycle 0, unchanged.) |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 line `...FIN_B14_DISPLAY_PROOF_CASES,` in the plug-in list. (Cycle 0, unchanged.) |
| `scripts/pulse/compile-catalog.mjs` | 1 import line and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B14_LIVE_CASES]`. (Cycle 0, unchanged.) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | Guard numbers: contracts 40 to 46, pass-capable 27 to 33, sql batches 27 to 33, db calls 27 to 33, focused PASS 27 to 33, shipped data 40 to 46. My add is +6 each. (Cycle 0, unchanged in cycle 1: still six contracts.) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | Red count 672 to 639 (my decrease is 33: 6 live and 27 practice). It was 633 in cycle 0; six rows came back out. Add the other batches' changes and use the number the test prints. |
| `src/pulse/catalog/generated.json` | Recompiled with `npm run pulse:catalog`. A conflict here is expected: take the integrator's recompile. |

No existing test was weakened, skipped or deleted. Every rewritten test keeps its earlier assertions and adds to them.

## Breaks made on purpose (cycle 1: each one broken, seen red, put back)

Every break was made in the product file or the SQL text, the tests run, and the file written back from its original bytes.
A shell wrapper did the break and restore and printed red or green per break; `git status` was clean afterwards.

| Where | Breaks | Red |
|---|---|---|
| `public/app/journeys.html` | 72: + placement (path, empty path, last +, kind mapping, defaults, History), Keep it / Throw it away (toast count, stale undo, no History line, tag), click a step (name box, selected mark), Save version (journey, order, default name, time, empty name), Undo (Cmd+Z, move, add, typed change, journey switch, kept answer, count), History (version picked, journey of a put-back, open journey, undo, counts, typed entry, reverted mark), Simulate (select, Stop, email fill, wait words, portal link, spaces in braces, second path), step fields (three misspelled options, quote escaping, trimming, three prefills, wrong key), Move and Delete (nested delete, nested move, first not refused, question not deletable, history word), Apply (open journey only, open journey's steps, name, count cleared on failure, braces, bar button), run report page side (held block, rows left out, journeys nothing can start, could not check, unreadable screens, signed out, 500, stats, source) | 72 of 72 (two needed a stronger test first, one a redone break text, see below) |
| `public/app/lenders.html` | 54: bureau config (hold, path, inactive, failed save, re-read, maxlength, number, blank, upsert, new row, add twice), Apply filters (failed read, plural, Loading, client table, client id, door, rows, "fit", could-not-load words, every box dropped or renamed, button dead), Import now (action, empty box, first line, counts, issue cap, re-read, refusal, issue count, toggle, cancel), cells (null words, null tier, input mark, name cell, active, tier), mismatch (three words, row id, queue request, re-read, refusal, badge) | 53 of 54. The other is an equivalent mutant: removing the cell's `change` listener changes nothing a person can see, because `input` fires first on every typed or picked value. |
| `src/lenders/store.mjs`, `api/read/lenders.mjs`, `api/read/lender-observations.mjs`, `api/lender-observations.mjs` | 27: AND to OR, each filter turned inside out (six), each part of the any-state clause (four), notes, company scope, sample lenders, export includes samples, review word, review company, reviewer overwrite, queue mismatch / status / door, two role sets, import tips, row-id match, name trim, stamp | 27 of 27 |
| `api/journeys/run.mjs`, `src/journeys/runner/index.mjs`, `src/journeys/runner/synthetic.mjs` | 15: COMMIT after the walk, COMMIT before the answer, ok false, paths dropped, connection not released on success, first path of a question only, no synthetic marker, company from the body, demo rows walked, unknown keys walked, routing flip off, text content type, rollback skipped, journey filter ignored, one path per journey | 15 of 15 |
| `fin-b14-display-contracts.mjs` | 14: brace strip pass, wait upper bound, hex, true, JSON number, number counts as filled, import population narrowed, a tip prefix dropped, tip length, two money columns dropped, subject reads the body, settings shape, paths shape | 14 of 14 |

Four breaks stayed green on the first run and were answered with a stronger test, then seen red: P3c (a new Move the card step
starts blank; the pick list showed its first option over a blank saved setting, so the test now reads what Apply sends), F4b (a
double quote in a one-line box; the test now types one into a one-line box), the tip prefix (the test took its list from the
SQL's own list; it now reads the product's list out of `src/lenders/tips.mjs`) and the mismatch row id (the test pressed the
first row both times; it now presses the second row first). Two break texts matched nothing the first time (F3 and the
AND-to-OR join, which sits in two places) and were redone. One break is an equivalent mutant and was left as it is (the
cell's `change` listener).

## Commands run and results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` on `97ae30022` (start of cycle) | total 814, 1 of them this batch |
| `npm run pulse:catalog` | 3,975 mapped, 3,919 wired, 23 red |
| `node scripts/pulse/count-not-proved.mjs` after | total 820, 7 of them this batch (the Page gate row and the six rows left out) |
| `node --test` on `fin-b14-live-contracts`, `-journeys`, `-journeys-handlers`, `-journeys-run`, `-lenders`, `-lenders-handlers`, `-lenders-sql`, `-rows`, `src/http/journeys-run-handler.test.mjs`, `src/pulse/coverage/gap-catalog-display.test.mjs` together | 178 of 178 |
| the two browser files run three times in a row | 45 of 45, three times |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs gap-door-batch*.test.mjs modules.test.mjs` | 85 of 85 |
| `display-proof-cases.test.mjs`, the two map tests (the third runs every file every batch names, and was not run whole) | 2 of 2 (red count 639) |
| `npm run lint` | 3,575 files parse clean |

## Repair cycle 1: what changed in the way the checks judge

* **Apply to code (live check).** The SQL used to be narrower than the product's own refusal and had two false reds. It is now the
  product's two checks written as named conditions: the settings must be a list of settings, a wait length is read the way
  JavaScript reads a number (`.5`, `1e2`, spaces, `0x10`, true, a JSON number), a question's field must be text and its paths stored
  properly, a stage and pipeline must be text, and single braces are found the way the product finds them (real `{{tokens}}` are
  stripped first, so `{{first_name}` and `{first_name}}` are caught and a good token next to a bad one is caught), in a text or
  an email, body or subject. A corpus of 69 crafted journeys is run through the product's `findBadSteps` and
  `findSingleBraceTagsInNodes` and through the SQL, and the test asks for the same answer on every one. The browser test now
  claims the half the SQL cannot see: one save for every edited journey, each with its own key and steps, and nothing cleared
  when one is refused.
* **Test against the code.** The run handler is now driven to its success answer on the stand-in database (it needed only a row
  back from the client insert and the event insert). Committing, a false `ok`, dropped paths, an unreleased connection, a walker
  that takes one path of a question, a missing synthetic marker and a company taken from the body are each red. The page side
  paints every section of the report from the answer (held back, rows left out, journeys nothing can start, could not check,
  unreadable screens, signed-out words).
* **Import now (live check).** Population is every lender touched in 90 days, with or without a row id. A normal paste has no row
  id column and is inserted like a lender made by hand; the old check never read it. All fifteen tip prefixes and all four money
  columns are exercised, and the button's own request is judged.
* **Mismatch Confirm / Corrected.** A saved confirmed row cannot say which button wrote it, so the SQL still judges only the row.
  The word each button sends, the row it sends, the queue request, the handler's SET clause, the company scope and the reviewer
  stamp are judged by the practice tests (the handler half on stand-in rows, executed, not read as text).
* **The six list filters.** The handler's real SQL is run over stand-in lender rows, so a filter turned inside out, AND turned
  into OR and each part of the any-state clause are red.
* **Rows left out.** Discard, Make the change, Run from here, Add bureau row, Export CSV and the row Save button each give a wrong
  result today (findings below). Each has a KNOWN BREAK test that pins the wrong result in a real browser run, a source-line guard
  in `fin-b14-rows.test.mjs`, and a written reason. The moment the page is fixed those go red and say which row to attach; the
  rest of each control is exercised and passes in the same files.

## Product findings (not fixed)

1. `POST /api/journeys/run` gates on `ROLE_SETS.FINANCE` (owner, admin, sales_manager). The page row ("PUT/ask/run answer 403 to others"), the page's own refusal text ("Only an owner or admin can run this") and the file header of `api/journeys/run.mjs` all say owner and admin only. `src/http/journeys-run-handler.test.mjs` names the wider set on purpose. This is why the Page gate row is left out.
2. `lenders.html` Save turns an empty Name box into `name: null` (`patch[k] = v === "" ? null : v`). The handler's blank-name guard tests `String(patch.name).trim() === ""`, and `String(null)` is `"null"`, so the guard does not fire: measured with the real handler, it sends `UPDATE lenders SET name = $3 ...` with `null`. The column is NOT NULL, so the database refuses it and the handler re-throws: a raw 500 instead of "Name is required." Left-out row: Lender row Save button.
3. `PUT /api/journeys` accepts `nodes: []`. On the next page load `journeys.html` throws that saved journey away and draws its own example (`r.nodes.length` is false). This is the wrong result the Page load live check goes red on.
4. `journeys.html` History: after "Put it back" the page marks the new "Reverted: ..." entry as reverted too (`log[0].reverted = true`), so the entry that records the put-back also shows a disabled Reverted button. Cosmetic.
5. `journeys.html` (900 ms timer in `setCfg`): a typed change is written to the history and the undo stack 900 ms after the last key. A Roll back, Discard or Put it back pressed inside that 900 ms still gets the late "Edited ..." entry on top afterwards, and its undo copy is the page as it was before the typing. Read from the code, not run as a user path.
6. `journeys.html` Discard sets the one page-wide unsaved count to zero (`dirty=0;delete touched[active]`). With changes on Client and Setter, Discard on Setter leaves the header saying nothing is unsaved, Apply answering "Nothing to apply" and sending nothing, while Client's change is still there and cannot be saved. Undo after a Discard returns the edits with the same zero. Measured in a real browser run. Left-out row: Discard.
7. `journeys.html` Roll back of a saved version that belongs to another journey, then Undo: the undo copy is the open journey's, so Undo puts the open journey's whole tree (name included) into the journey that was rolled back (measured: after Roll back of a Setter version from Client, Undo makes Setter a copy of Client). Not claimed by any row.
8. `journeys.html` Undo button stays dark after a typed change on its own (the button is redrawn only by the next change, but Ctrl+Z works). Measured. Cosmetic.
9. `journeys.html` an AI answer that only removes steps: `stagePatch` applies the delete, finds nothing added or changed, pops the undo copy and says "That came back empty". The step is gone with no Keep it bar, no unsaved count and no undo. The page's own prompt tells the AI it may delete. Measured. Left-out row: Make the change.
10. `journeys.html` Run from here on a step that is inside a path the simulator is not taking plays the whole journey from the top (the plan has no such step, `findIndex` is -1, nothing is cut). Measured. Left-out row: Run from here.
11. `lenders.html` Add bureau row redraws every row from the stored list, so text typed into a saved row and not yet saved is replaced by the saved value. Measured. Left-out row: Add bureau row.
12. `lenders.html` Export CSV does not read the status of the answer, so a refused export (signed out, wrong role) is saved as `lenders.csv` holding the error text, and nothing is said. Measured. Left-out row: Export CSV.
13. `lenders.html` opened from a client (`?client_id=`): Apply filters reads `/api/read/lender-matches` with only `client_id` and the product table. The bureau, tier, status, state and name boxes are on screen and are not sent. The matches door's own header says it takes structural filters from the client's file, so this is recorded and not claimed as wrong; the test pins what is sent, not what is left out.
14. `journeys.html` pick list for "Move the card" is a flat fifteen stages; the database has stages the list never offers (for example Action Required, and the Alt-Fin and Repair stages). The test pins the list as it is.
15. Import now cannot tell a row it stamped from a row a script stamped: both read "system" when no staff is on the call (`stamp()` in `src/lenders/store.mjs`), so the live check judges "nobody's name on it" but not "system".

## Left not proved

| Row | Why |
|---|---|
| journeys.html Page gate | Finding 1. Attach it the moment the run door's set is owner and admin only, or the row words change. A decision only Chris can make. |
| journeys.html Bottom bar: Discard | Finding 6. Attach with the tests already there once the count is per journey. |
| journeys.html Step panel: Make the change | Finding 9. |
| journeys.html Step panel: Run from here | Finding 10. |
| lenders.html AI bureau config: Add bureau row | Finding 11. |
| lenders.html Export CSV | Finding 12. |
| lenders.html Lender row Save button | Finding 2. |

## For the integrator

* Run `npm run pulse:catalog` once after merging.
* The browser tests ask the S4 queue (`s4-browser-slots.mjs`, 3 places on the machine) before they start. With many batches running at once a file can wait for a place. Set `S4_BROWSER_PLACES` higher for a focused run.
* `fin-b14-sql-kit.mjs` is a near copy of the kits in batches 10 and 15 plus the jsonb, regex, ILIKE and `~*` spellings the checks here need. If you want one kit, merge them there; nothing else depends on it.
* The scratchpad folder of a session is shared between agents: a runner left there by another batch had the same file name as mine. Use a folder of your own.
