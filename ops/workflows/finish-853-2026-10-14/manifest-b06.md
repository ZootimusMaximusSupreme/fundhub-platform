# Batch 06 manifest: customer-data screen controls (tier 3, lane gap-catalog-display)

Branch `fin/b06`, built from `fin/base` at `2f4f574a0`. Generation 1. Nothing was pushed.

## The number

| | |
|---|---|
| Rows in batch | 40 |
| Open before (NOT_PROVED, offline count script) | 40 |
| Open after | 1 |
| Whole count before / after | 853 / 814 |

Outcomes: 35 live checks, 4 practice tests, 1 not-attachable.

A live check reads real saved rows on the live server and goes red when one is wrong. A control nobody has used
yet has no results, so it is green ("no saved results yet, none are wrong") and goes red on the first wrong one
(`emptyAs: "quiet"`). A practice test uses fake data in a real Chromium; it is not a live check.

## What each row ended as

| # | Screen | Control | Outcome | Where |
|---|---|---|---|---|
| 1 | climate/index.html#See how man | See how many banks in our book fit your state: scrolls to the form (drawn by bundled scripts... | not-attachable | stays NOT_PROVED, reason below |
| 2 | client-control-panel.html | Authorized rep: Take them off this file button | live-check | check `authorized-rep-removed` |
| 3 | client-control-panel.html | Businesses cards: Save month/year button (stamp incorporation) | live-check | check `business-incorporated-stamp` |
| 4 | client-control-panel.html | Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs) | live-check | check `blueprint-bank-todo` |
| 5 | client-control-panel.html | Capital Blueprint: Add credit partner button and First/Last/Email/Phone inputs | live-check | check `blueprint-credit-partner` |
| 6 | client-control-panel.html | Capital Blueprint: Bank list state buttons | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 7 | client-control-panel.html | Capital Blueprint: Offer bank tracker button | live-check | check `blueprint-tracker-offered` |
| 8 | client-control-panel.html | Capital Blueprint: Save ready date button | live-check | check `blueprint-ready-date` |
| 9 | client-control-panel.html | Capital Blueprint: Take the offer back button | live-check | check `blueprint-tracker-taken-back` |
| 10 | client-control-panel.html | Declines: Record decline and build the plan button (bank, product, date, bureaus, letter text) | live-check | check `blueprint-decline-recorded` |
| 11 | client-control-panel.html | Declines: Save and mark done / Skip / Open again step buttons | live-check | check `blueprint-decline-steps` |
| 12 | client-control-panel.html | Declines: Save call date button | live-check | check `blueprint-decline-call-date` |
| 13 | client-control-panel.html | Declines: Upload letter button | live-check | check `blueprint-decline-letter` |
| 14 | client-control-panel.html | Documents toggle, drop zone, file input, drag and drop upload | live-check | check `documents-staff-dropzone` |
| 15 | client-control-panel.html | Identity-on-file state line and client approval link box + Copy link | live-check | check `identity-on-file-after-approval` |
| 16 | client-control-panel.html | Issue Inquiry Removal button (opens a case, goes to Inquiry Remover) | live-check | check `inquiry-removal-case-opened` |
| 17 | client-control-panel.html | Lender row: Apply button (proxy launch, opens bank page) | live-check | check `proxy-apply-session` |
| 18 | client-control-panel.html | Lender row: Pending button | live-check | check `bank-decision-pending` |
| 19 | client-control-panel.html | Notes textarea and Save notes button | live-check | check `client-notes-saved` |
| 20 | client-portal.html | Agreements tab: Review & sign link per contract | live-check | check `contract-sign-link` |
| 21 | client-portal.html | Authorized-rep file switcher buttons (one per file) | live-check | check `authorized-rep-file-switch` |
| 22 | client-portal.html | Sign to authorize dispute letters: legal name input | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 23 | client-portal.html | Sign to authorize dispute letters: signature pad (draw) | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 24 | client-portal.html | Sign to authorize dispute letters: submit button | live-check | check `dispute-authorization-signed` |
| 25 | client-portal.html | Upload door: bureau response (type select, Upload button, file picker) | live-check | check `documents-door-bureau` |
| 26 | client-portal.html | Upload door: ID and personal documents (type select, Upload button, file picker) | live-check | check `documents-door-identity` |
| 27 | client-portal.html | Upload door: Inquiry documents (type select, Upload button, file picker) | live-check | check `documents-door-inquiry` |
| 28 | client-portal.html | What You Own: Download link per file | live-check | check `documents-download-link` |
| 29 | consent-capture.html | Consent wording, version badge and current status banner (read from the server, never typed ... | live-check | check `consent-wording-matches-server` |
| 30 | content-admin.html | Locked tile editor: client-facing name box | live-check | check `content-tile-name` |
| 31 | content-admin.html | Locked tile editor: outcome copy box (one line shown to the client) | live-check | check `content-tile-copy` |
| 32 | content-admin.html | Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too) | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 33 | content-admin.html | Save changes button (saves tiles and the tier-to-video map) | live-check | check `content-save-changes` |
| 34 | contracts.html | PDF editor: drag on a page to draw a box; click a box to select; drag to move; drag corner t... | live-check | check `contract-pdf-boxes` |
| 35 | contracts.html | Save (create a new wording) | live-check | check `contract-wording-created` |
| 36 | contracts.html | Save (edit an existing wording) | live-check | check `contract-wording-edited` |
| 37 | documents.html | Contract cell: Void button (asks for a reason in a prompt; owner/admin only) | live-check | check `contract-voided` |
| 38 | climate/index.html#Four answer | Four answers (home state required, business state, do you have a business, your credit guess... | live-check | check `climate-lead-saved` |
| 39 | inquiry-remover.html | 'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked... | live-check | check `repair-parse-confirmed` |
| 40 | inquiry-remover.html | Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once ... | live-check | check `inquiry-bureau-call` |

## The one row that stays open (not-attachable)

Row 1, the climate "See how many banks in our book fit your state" button. The shipped page
`public/climate/index.html` is a lending-climate dashboard ("Loading lending climate...") with no such button and no
four-answers form, and no page in `public/` calls `/api/public/climate-match`. The control is not on any page that
ships, and a scroll saves no row. There is nothing to click and nothing saved to read. It stays NOT_PROVED with that
exact sentence (a `gap()` contract in `fin-b06-display-contracts.mjs`).

The climate form row (`POST /api/public/climate-match`) is a live check on the saved lead, so a lead filed by any
caller (the door has `Access-Control-Allow-Origin: *`) is judged. With no caller today it will read "no saved
results yet". That is quiet, not proved by use.

## How the checks work (no local Postgres on this Mac)

SQL could not be run here. So each check is written once in a small builder
(`fin-b06-sql-kit.mjs`) that prints the read-only SQL and also runs the same definition as a JavaScript judge over
stand-in rows. The test file builds a good world for each check (green, with a real sample, not vacuous) and then
breaks it one way at a time. 150+ breaks, every one red; a few "still green" cases (a signed-out session, a
re-linked representative, and so on) prove a check does not cry wolf.

The SQL text itself is checked by `fin-b06-schema.mjs`: every table named after FROM or JOIN and every `alias.column`
must exist in `db/schema` + `db/migrations`. That guard was itself tested (a made-up column and a made-up table are
refused). The SQL was not executed against Postgres. The first live pulse is its first real run.

The four practice tests were broken on purpose in the real pages (15 breaks across `client-control-panel.html`,
`client-portal.html`, `content-admin.html`), and every break went red. Each page was restored after its run and
`git status` shows the three pages untouched.

## Files added

- `src/pulse/catalog/proofs/fin-b06-sql-kit.mjs` (the builder)
- `src/pulse/catalog/proofs/fin-b06-schema.mjs` (the migration reader)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.mjs` (35 checks and 1 gap)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs`
- `src/pulse/catalog/proofs/fin-b06-display-practice.mjs` (4 practice proof cases)
- `src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` (4 Chromium tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b06.md` (this file)

## Shared lines touched (for the integrator)

| File | What |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line; eight old `gap(...)` lines removed (Save changes, Showing/Hidden switch, name box, outcome copy box, Save create wording, Save edit wording, Consent wording banner, Void button); one `...FIN_B06_DISPLAY_CONTRACTS,` line at the end of the array |
| `src/pulse/catalog/compiler.mjs` | `compileDisplayRuntimeData`: a tracked money or customer row that owns a registered contract is now judged even when no browser spec names it (16 new lines, plus `DEEP_IMPACT`). Without this a contract keyed by control text was never attached or queried |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B06_DISPLAY_PROOF_CASES,` line |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 662 (rows that now have a live check or a practice test) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers 40 / 27 / 13 became 68 / 62 / 6 (contracts, pass-capable, unmeasured), `SQL_BATCHES` 27 to 62, result cases 40 to 68 |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; recompile after merging) |

Do not trust my guard numbers after the merge. Re-derive: contracts = base contracts minus replaced gaps plus every
batch's contracts; pass-capable = base query contracts plus every batch's queries.

## Product findings (one line each, nothing fixed)

1. `api/soft-pull-approve.mjs` line 279 calls `stampIncorporatedAsStaff`, which is not defined anywhere in the repo
   (commit `ddcd92d18` added it; a later change removed the function). A POST with `action: "stamp_incorporated"`
   throws `ReferenceError`, so the "Save month/year" button on the client file and the same call from the present deck
   fail. Confirmed by calling the handler.
2. The dispute-authorization signature pad never saves the drawing: the page checks that ink exists and then sends
   only the typed name and `capture_method: "signature"`. No image is stored anywhere.
3. `api/consent/capture.mjs` takes `document_id` from the request body and stores it on the consent with no check that
   the document belongs to that client or company (the column is only a foreign key).
4. The climate lead-magnet page and its form are described in `docs/journeys/climate-lead-magnet-intended.md` but are
   not on the shipped page; no page calls `/api/public/climate-match`. (Also found by slice 4.)
5. `api/content/tiles.mjs` Save runs no transaction by design (its own comment says so): tile words can be saved and
   the video map fail. A read cannot see which half landed.

## Things the integrator and Chris should know

- The display lane now runs 62 SQL reads one after another (it ran 27). Each is scoped to one company, and the heavy
  ones (events, documents, account sessions, client notes) use equality joins the planner can index. I could not time
  them against the real database. If the morning pulse step gets slow, split the lane. The 26 second step cut is the
  limit.
- First live run: these checks have never touched real rows. A red on day one means either a real wrong result or a
  legacy row the code path no longer writes. Each check's requirement text names the exact invariant, so the red
  names itself.
- The `blueprint-*` checks accept any transaction for the Blueprint product (not only a paid one), so a later refund
  does not turn an old flag red.

## Commands run and results

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` before | `{"total":853,...,"gap-catalog-display":680}` |
| `npm run pulse:catalog` | `coverage catalog: 3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `npm run pulse:catalog -- --check` | up to date |
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":814,...,"gap-catalog-display":641}`; batch rows 40 before, 1 after |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs` plus both new test files | 2375 tests, 2175 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs` | 1090 pass, 0 fail |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass (the third test in that file spawns every proof test in the repo; not run to the end, see below) |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` | 4 pass |
| mutation script (15 breaks in 3 real pages, each restored after its run) | all 15 red |

Not run to the end: the third test in `display-proof-cases.test.mjs` ("the focused proof test runs every executable
test named by every case") spawns every proof test file in the repo in one process. With 26 agents on this Mac it did
not finish in 15 minutes, so I stopped it. My own files run inside it and pass alone.
