# Batch 14 manifest (finish the 853, tier 4, lane gap-catalog-display, 40 rows)

Branch `fin/b14`, from `fin/base` (`2f4f574a0`). Worktree `.claude/worktrees/fin-b14`. Nothing was pushed or merged.
Pages: `journeys.html` (23 rows) and `lenders.html` (17 rows), both in `desks-c.json`.

## The numbers

| | Rows |
|---|---|
| Batch rows | 40 |
| Open (NOT_PROVED) before, measured with `node scripts/pulse/count-not-proved.mjs` | 40 |
| Open after | 1 |
| Whole lane before / after (all four lanes, this branch only) | 853 / 814 |
| live-check | 6 |
| practice-test | 33 |
| na-verified | 0 |
| not-attachable | 1 |

The display red count test (`display-proof-cases.test.mjs`) goes from 672 to 633: exactly the 39 attached rows.

## Every row

| Surface | Control | Outcome | Where |
|---|---|---|---|
| journeys.html | Bottom bar: Discard (revert unsaved edits) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Canvas: '+' between steps opens the add-step menu (10 types: text, email, wait, question, move card, assign, hand off, agent, take payment, save) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Canvas: 'Keep it' / 'Throw it away' on an AI patch | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Canvas: click a step to select it (opens Step panel) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Header: 'Test against the code' (walks every branch with throwaway clients inside a rolled-back transaction) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). Also `src/http/journeys-run-handler.test.mjs` (rolled back on every exit, never committed) and `fin-b14-journeys-handlers.test.mjs`. |
| journeys.html | Header: Apply to code and bottom-bar Apply (saves every edited journey) | live-check | fin-b14-display-contracts.mjs `journeysApplySql`. Every saved journey: steps a list, name, start, end, a key the editor owns, and every step (also inside a question's paths) a known kind with what it cannot work without; no single braces in text or email. Tests: `fin-b14-live-contracts.test.mjs`. |
| journeys.html | Header: Save version | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Header: Undo (also Cmd/Ctrl+Z) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | History tab: 'Roll back to this' (saved version) and 'Put it back' (single change) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Affiliate | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Client | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Closer | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Funding Advisor | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: Setter | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Journey list tab: White-Label Partner | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Page gate: owner and admin author journeys (PUT/ask/run answer 403 to others); no sidebar row exists (NAV_HIDDEN), reached only by URL or link | not-attachable | See finding 1: the run door lets the sales manager in; the row says owner and admin only. Exercised in `fin-b14-journeys-handlers.test.mjs`; held by `fin-b14-rows.test.mjs`. |
| journeys.html | Page load: reads saved journeys; falls back to seeded example trees if the table is empty | live-check | fin-b14-display-contracts.mjs `journeysLoadSql`. Every saved journey holds a step, a name, a start and an end and a key the page asks for, or the page draws its own example in its place. Tests: `fin-b14-live-contracts.test.mjs`. |
| journeys.html | Run report panel: Close button | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Simulate tab: 'At a question' select + Run the journey / Stop | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel fields: text body and timing (text), subject/body/timing (email), wait length + unit, question field + test, stage + pipeline, role, agent + note, payment amount + product, note | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel: 'Make the change' (AI rewrites one step) and canvas ask box 'Make the change' + example prompts | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-journeys-handlers.test.mjs` (the ask door: gate, words, key, answer). |
| journeys.html | Step panel: 'Run from here' (plays the journey in the browser from this step) | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| journeys.html | Step panel: Move up / Move down / Delete | practice-test | `fin-b14-journeys.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Add blank row button (prompts for a lender name, creates one row) | live-check | fin-b14-display-contracts.mjs `lendersAddSql`. Hand-made lenders of the last 90 days: a name, who made it, a stamp date, and no double press. Tests: `fin-b14-live-contracts.test.mjs`. |
| lenders.html | AI bureau config row: 7 fields (code, name, service number, IVR version, menu path, hold minutes, active) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | AI bureau config: Add bureau row button (adds an empty editable row) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Apply filters button | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | Export CSV button (downloads lenders.csv for the current filters) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | Import CSV button (opens paste box) and Cancel button | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Import now button (paste CSV, creates and updates lender rows) | live-check | fin-b14-display-contracts.mjs `lendersImportSql`. Imported lenders touched in the last 90 days: name, row id, who, stamp date, not a tip, no amount below zero. Tests: `fin-b14-live-contracts.test.mjs`. |
| lenders.html | Lender row inline cells: name, product table, bureaus, requirements, tier, status, eligible states (7 editable fields) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). |
| lenders.html | Lender row Save button (writes the 7 fields, stamps last_updated_by) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Bureau pulled input (EX / EQ / TU) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Eligible state input | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Name search input | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Priority tier select (1, 2, 3) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Product table select (OnlineBizCC, InBranchBizCC, BizLOC_Stated, BizLOC_Documented, PersonalCC, PersonalLoans, PersonalLOC) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | List filter: Status select (Active / Inactive) | practice-test | `fin-b14-lenders.test.mjs` (real page in Chromium, fake /api). Also `fin-b14-lenders-handlers.test.mjs` (the real handler: SQL parts, values, who is let in). |
| lenders.html | Mismatch queue row: Confirm button | live-check | fin-b14-display-contracts.mjs `mismatchConfirmSql`. Confirmed observations: flagged, bureau named, lender of this company, a person on it. Tests: `fin-b14-live-contracts.test.mjs`. |
| lenders.html | Mismatch queue row: Corrected button | live-check | fin-b14-display-contracts.mjs `mismatchCorrectSql`. Corrected observations: same five conditions. Tests: `fin-b14-live-contracts.test.mjs`. |

## What was built (all new files are `fin-b14-*`, all under `src/pulse/catalog/proofs/`)

| File | What it is |
|---|---|
| `fin-b14-display-contracts.mjs` | The six live checks: one read-only SQL text each, built from named bad-result conditions (40 conditions in all), `emptyAs: "quiet"`. Imports nothing. |
| `fin-b14-sql-kit.mjs` | Test kit. Real table and column names read from `db/schema` and `db/migrations`; the Postgres text spelled for SQLite (`$1`, casts, `BTRIM`, `jsonb_array_elements`, `jsonb_typeof`, `~` and `!~` as `regexp()`); a stand-in database. Tests only. |
| `fin-b14-live-contracts.test.mjs` | 57 tests. Runs the exact SQL text over stand-in rows. For every named condition: a row that breaks only it is red, and the same text without that condition does not catch it. Clean, other-company, demo and out-of-window rows are never counted. |
| `fin-b14-kit.mjs` | Row tracker (a row is claimed only inside the callback that asserts it) and the browser helpers. |
| `fin-b14-rows.json` | The practice rows, by test file. |
| `fin-b14-display-proofs.mjs` | The proof cases handed to the catalog: 6 live (name the display lane, stay in the lane) and 33 practice (name only the test files, leave the lane). |
| `fin-b14-not-attachable.mjs` | The one row left out, and exactly why. |
| `fin-b14-rows.test.mjs` | Guard: every listed row is one exact map row, every test file is a plain test with no live call, one proof case per attached row, and the reason for the left-out row is held against the repo (it goes red the moment it stops being true). |
| `fin-b14-journeys.test.mjs` | 17 browser tests, 20 claimed rows (plus the page-load fallback and the step rewrite read in full). |
| `fin-b14-lenders.test.mjs` | 6 browser tests, 13 claimed rows. |
| `fin-b14-journeys-handlers.test.mjs` | The real `api/journeys.mjs`, `api/journeys/ask.mjs`, `api/journeys/run.mjs` on a stand-in database: who gets in (all 8 staff roles), what a save writes and refuses, the ask door. |
| `fin-b14-lenders-handlers.test.mjs` | The real `api/read/lenders.mjs`, `api/lenders.mjs`, `api/lender-observations.mjs`: each filter's SQL part and value, the csv, Save, create, import, review, and who gets in. |

Browser tests use the S4 harness (`s4-screen-harness.mjs`): static server for `public/`, one Chromium, every `/api` call answered by the test, every other host aborted. The AI door is a fake answer. Nothing reaches a database or a vendor.

## Shared lines touched

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | 1 import line (`FIN_B14_RESULT_CONTRACTS`) and 1 line `...FIN_B14_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`. |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line and 1 line `...FIN_B14_DISPLAY_PROOF_CASES,` in the plug-in list. |
| `scripts/pulse/compile-catalog.mjs` | 1 import line and `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B14_LIVE_CASES]`. |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | Guard numbers: contracts 40 to 46, pass-capable 27 to 33, sql batches 27 to 33, db calls 27 to 33, focused PASS 27 to 33, shipped data 40 to 46. My add is +6 each. Add the other batches' changes and use the number the test prints. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | Red count 672 to 633 (my decrease is 39). Same rule. |
| `src/pulse/catalog/generated.json` | Recompiled with `npm run pulse:catalog`. A conflict here is expected: take the integrator's recompile. |

No existing test was weakened, skipped or deleted.

## Breaks made on purpose (each one: break, see red, put back)

Every break was made in the product file, the test run, and the file restored by writing the original text back (`git status` clean afterwards).

| Where | Breaks | Red |
|---|---|---|
| `public/app/lenders.html` | 24 (each filter's name and trim, Apply, export format and file name, import toggle and Cancel, dirty marks, active and tier as text, blank as empty text, Save action, row not redrawn, add bureau row twice, new row inactive, hold minutes as text, upsert as save, state length cap, empty banner, status option values) | 24 of 24 |
| `public/app/journeys.html` | 59 (tab target, count, name, selected; step pick; menu kinds, position, close on pick, Escape, outside click, new question paths; step boxes and lists; move direction and end stop; delete; Undo count, button, Ctrl+Z; Discard target and count; Throw it away, Keep it tag and toast; ask button, examples, payload, step scope, no-key words, empty step box; Save version cancel, History tab, step count; Roll back; Put it back twice and restore; simulator paths, both, report, Stop, fake client, from-here, mode select; run body, Testing words, Close, refused words, report numbers, button stays off; update op title, tag, settings; page-load empty and ignored) | 59 of 59 after the repairs below |
| `api/read/lenders.mjs`, `api/lenders.mjs`, `api/lender-observations.mjs`, `src/lenders/store.mjs` | 25 (each filter's column and value, state rows, search notes, sample rows, company condition, role set, csv file name, export demo flag, Save field list, stamp, company condition, blank name, tier and status coercion, unchanged row 409, create stamp and trim, import tips and external id match, review reviewer and role set and company) | 25 of 25 |
| `api/journeys.mjs`, `api/journeys/ask.mjs`, `api/journeys/run.mjs` | 16 (closer let in, company from the body, conflict clause, saver stamp, key, name, step shape, wait unit, single braces, read shape; ask words, size, key, role set, bad answer; run role set) | 16 of 16 |
| `api/journeys/run.mjs` against the existing `src/http/journeys-run-handler.test.mjs` | 4 (closing rollback, rollbacks as commits, begin removed, connection not released) | 4 of 4 |
| the six SQL texts | 40 named conditions, each dropped from the text | each catches only its own row |

Four breaks stayed green on the first run and were repaired, none taken back: one of my own break texts matched nothing (redone); one removed a different thing from the menu than I meant (redone as a real removal, red); two were real weak spots in my tests and are strengthened: Roll back (the test had already put the whole journey back through Put it back, so a Roll back that restored nothing passed) and the run report (paths and test clients were both 6, so a swapped number passed; now 6 and 5).

## Commands run and results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs out.json` before any edit | total 853, 40 of them this batch |
| `npm run pulse:catalog` | 3,975 mapped, 3,942 unique, 3,919 wired, 23 red (56 red before) |
| `node scripts/pulse/count-not-proved.mjs out.json` after | total 814, 1 of them this batch (the Page gate row) |
| `node --test src/pulse/catalog/proofs/fin-b14-live-contracts.test.mjs` | 57 of 57 |
| `node --test src/pulse/catalog/proofs/fin-b14-lenders.test.mjs` | 7 of 7 |
| `node --test src/pulse/catalog/proofs/fin-b14-journeys.test.mjs` | 17 of 17 |
| `node --test src/pulse/catalog/proofs/fin-b14-lenders-handlers.test.mjs` | 10 of 10 |
| `node --test src/pulse/catalog/proofs/fin-b14-journeys-handlers.test.mjs` | 6 of 6 |
| `node --test src/pulse/catalog/proofs/fin-b14-rows.test.mjs` | 3 of 3 |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 |
| `npm run lint` | 3,573 files parse clean |
| `node --test` on the catalog group (19 files: the catalog recipe tests, `display-proof-cases`, `door-proof`, `gap-catalog*`, `gap-door-batch*`, and four of my test files: rows guard, live checks, the two handler files. The two browser files are named by the display proofs, so the nested run below starts them; they were also run alone and 3 times in a row), measured with other builders on the same Mac, load average 30 to 36 | 1,150 tests, 1,149 pass, 1 stopped by hand. The one is `display-proof-cases` "the focused proof test runs every executable test named by every case": it starts a nested run of every file any display proof names, and I stopped it at 16 minutes because `display-batch-staff-ui.test.mjs` (the staff batch, not a batch 14 file) was still waiting on browser specs. No failure line was printed by any other file in that nested run before I stopped it. |
| `node --test --test-name-pattern=... src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the other two tests in the file) | 2 of 2 (red count 633) |
| each browser file run 3 times in a row, under the same load | `fin-b14-lenders.test.mjs` 7 of 7, 7 of 7, 7 of 7; `fin-b14-journeys.test.mjs` 17 of 17, 17 of 17, 17 of 17 |
| `node --test src/lib/no-unfenced-transmit.test.mjs src/lib/outbound-*.test.mjs` | 35 of 35 (my test files fake `fetch`, none sends) |

## Product findings (not fixed)

1. `POST /api/journeys/run` gates on `ROLE_SETS.FINANCE` (owner, admin, sales_manager). The page row ("PUT/ask/run answer 403 to others"), the page's own refusal text ("Only an owner or admin can run this") and the file header of `api/journeys/run.mjs` all say owner and admin only. `src/http/journeys-run-handler.test.mjs` names the wider set on purpose. This is why the Page gate row is left out.
2. `lenders.html` Save turns an empty Name box into `name: null` (`patch[k] = v === "" ? null : v`). The handler's blank-name guard tests `String(patch.name).trim() === ""`, and `String(null)` is `"null"`, so the guard does not fire: measured with the real handler on a stand-in database, it sends `UPDATE lenders SET name = $3 ...` with `null`. The column is NOT NULL, so the database refuses it and the handler re-throws: a raw 500 instead of "Name is required."
3. `PUT /api/journeys` accepts `nodes: []`. On the next page load `journeys.html` throws that saved journey away and draws its own example (`r.nodes.length` is false). This is the wrong result the Page load live check goes red on.
4. `journeys.html` History: after "Put it back" the page marks the new "Reverted: ..." entry as reverted too (`log[0].reverted = true`), so the entry that records the put-back also shows a disabled Reverted button. Cosmetic.

## Left not proved

| Row | Why |
|---|---|
| journeys.html Page gate | Finding 1. It is exercised (`fin-b14-journeys-handlers.test.mjs` measures all eight staff roles on all four doors) and held by `fin-b14-rows.test.mjs`. Attach it the moment the run door's set is owner and admin only, or the row words change. |

## For the integrator

- Run `npm run pulse:catalog` once after merging.
- The browser tests ask the S4 queue (`s4-browser-slots.mjs`, 3 places on the machine) before they start. With many batches running at once a file can wait for a place. Set `S4_BROWSER_PLACES` higher for a focused run.
- `fin-b14-sql-kit.mjs` is a near copy of the kits in batches 10 and 15 plus the jsonb and regex spellings the journeys check needs. If you want one kit, merge them there; nothing else depends on it.
