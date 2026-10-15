# Batch 06 manifest: customer-data screen controls (tier 3, lane gap-catalog-display)

Branch `fin/b06`, built from `fin/base` at `2f4f574a0`. Generation 1 wrote 39 of the 40; generation 2 challenged the
one row left open; repair cycle 1 (this update, 2026-10-15) answers a checker that found 16 rows whose check could
stay green while the product was broken. Nothing was pushed.

## The number

| | |
|---|---|
| Rows in batch | 40 |
| Open before generation 1 (NOT_PROVED, offline count script) | 40 |
| Open at the start of generation 2 | 1 |
| Open after generation 2 | 0 |
| Open at the start of repair cycle 1 | 0 |
| Open after repair cycle 1 | 1 (the Save month/year button, whose handler is dead; see below) |
| Whole count before / after generation 1 | 853 / 814 |
| Whole count after generation 2 | 813 |
| Whole count after repair cycle 1 | 814 (one honest row went back to not proved) |

Outcomes after repair cycle 1: 33 live checks (4 of them also carry a practice test for the half no saved row can
show), 5 practice tests only, 1 verified "nothing to judge" (re-read from the live page on every run), and 1
not-attachable (the dead Save month/year button, left NOT_PROVED on purpose).

A live check reads real saved rows on the live server and goes red when one is wrong. A control nobody has used
yet has no results, so it is green ("no saved results yet, none are wrong") and goes red on the first wrong one
(`emptyAs: "quiet"`). A practice test uses fake data in a real Chromium; it is not a live check.

## What each row ended as

| # | Screen | Control | Outcome | Where |
|---|---|---|---|---|
| 1 | climate/index.html#See how man | See how many banks in our book fit your state: scrolls to the form (drawn by bundled scripts... | na-verified | live page read every run, section below |
| 2 | client-control-panel.html | Authorized rep: Take them off this file button | live-check | check `authorized-rep-removed` |
| 3 | client-control-panel.html | Businesses cards: Save month/year button (stamp incorporation) | not-attachable | button is dead today (handler calls a function that does not exist); row stays NOT_PROVED, see repair cycle 1 |
| 4 | client-control-panel.html | Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs) | live-check | check `blueprint-bank-todo` |
| 5 | client-control-panel.html | Capital Blueprint: Add credit partner button and First/Last/Email/Phone inputs | live-check | check `blueprint-credit-partner` |
| 6 | client-control-panel.html | Capital Blueprint: Bank list state buttons | practice-test | practice test in fin-b06-display-browser.test.mjs (two banks, each button must send its own row's id) |
| 7 | client-control-panel.html | Capital Blueprint: Offer bank tracker button | live-check | check `blueprint-tracker-offered` |
| 8 | client-control-panel.html | Capital Blueprint: Save ready date button | live-check | check `blueprint-ready-date` |
| 9 | client-control-panel.html | Capital Blueprint: Take the offer back button | live-check | check `blueprint-tracker-taken-back` |
| 10 | client-control-panel.html | Declines: Record decline and build the plan button (bank, product, date, bureaus, letter text) | live-check | check `blueprint-decline-recorded` |
| 11 | client-control-panel.html | Declines: Save and mark done / Skip / Open again step buttons | live-check | check `blueprint-decline-steps` |
| 12 | client-control-panel.html | Declines: Save call date button | live-check | check `blueprint-decline-call-date` |
| 13 | client-control-panel.html | Declines: Upload letter button | live-check | check `blueprint-decline-letter` |
| 14 | client-control-panel.html | Documents toggle, drop zone, file input, drag and drop upload | live-check | check `documents-staff-dropzone` |
| 15 | client-control-panel.html | Identity-on-file state line and client approval link box + Copy link | practice-test | four practice tests in fin-b06-display-browser.test.mjs (the live check judged another control and was removed) |
| 16 | client-control-panel.html | Issue Inquiry Removal button (opens a case, goes to Inquiry Remover) | live-check | check `inquiry-removal-case-opened` |
| 17 | client-control-panel.html | Lender row: Apply button (proxy launch, opens bank page) | live-check | check `proxy-apply-session` |
| 18 | client-control-panel.html | Lender row: Pending button | live-check | check `bank-decision-pending` |
| 19 | client-control-panel.html | Notes textarea and Save notes button | live-check | check `client-notes-saved` |
| 20 | client-portal.html | Agreements tab: Review & sign link per contract | live-check | check `contract-sign-link` |
| 21 | client-portal.html | Authorized-rep file switcher buttons (one per file) | live-check | check `authorized-rep-file-switch` |
| 22 | client-portal.html | Sign to authorize dispute letters: legal name input | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 23 | client-portal.html | Sign to authorize dispute letters: signature pad (draw) | practice-test | practice test in fin-b06-display-browser.test.mjs |
| 24 | client-portal.html | Sign to authorize dispute letters: submit button | live-check | check `dispute-authorization-signed` |
| 25 | client-portal.html | Upload door: bureau response (type select, Upload button, file picker) | live-check | check `documents-door-bureau` (+ practice test of what the page posts) |
| 26 | client-portal.html | Upload door: ID and personal documents (type select, Upload button, file picker) | live-check | check `documents-door-identity` (+ practice test of what the page posts) |
| 27 | client-portal.html | Upload door: Inquiry documents (type select, Upload button, file picker) | live-check | check `documents-door-inquiry` (+ practice test of what the page posts) |
| 28 | client-portal.html | What You Own: Download link per file | live-check | check `documents-download-link` |
| 29 | consent-capture.html | Consent wording, version badge and current status banner (read from the server, never typed ... | live-check | check `consent-wording-matches-server` (+ practice test of the banner and what the page posts) |
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

## Repair cycle 1 (2026-10-15): 16 rows a checker showed could stay green

An independent checker broke the product on purpose under each of these and the check stayed green. Each one
below says what was broken, what the check does now, and how it was proved. "Red on" means a stand-in row the
judge and the printed SQL both count as wrong; every break was run through both (see "How the checks work").

| # | Row | The break that stayed green | Outcome now | What is red now |
|---|---|---|---|---|
| 1 | climate button ("See how many banks...") | the button hidden by `import()`, an iframe, a tag between the words, or words joined at run time | na-verified, with a much stronger live read | all four, and more: see "Row 1" below |
| 2 | Save month/year (stamp incorporation) | the button is dead (ReferenceError) and the check read rows from other doors | not-attachable. Row left NOT_PROVED | not a check any more. The requirement text names the missing function |
| 3 | Save ready date | 2026-02-31 and 2026-04-31 passed the day pattern; Postgres then fails the daily closer read | live-check, now a real calendar day | 31 Feb, 31 Apr, 31 Jun, 30 Feb, 29 Feb in a non-leap year and in 2100, padding. 29 Feb 2028 and 2000 stay green |
| 4 | Bank list state buttons | a test with one bank cannot tell which row's id a button sends | practice-test with two banks | a button that sends the first row's id, or the last row's id (both run on the real page) |
| 5 | Add bank to the list | only two clauses could ever go red, both already database rules; the "offer first" rule and Notes were not judged | live-check | a row written by this button (no FinanceOS bank name) on a client who was never offered, on a client with no paid Blueprint order, with a blank or padded note, or with a key not trimmed lower case |
| 6 | Offer bank tracker | a failed or pending Blueprint order passed | live-check, paid order only | a flagged client whose only Blueprint order failed or is pending |
| 7 | Take the offer back | same | live-check, paid order only | same. The same paid-order rule now sits on the credit partner and ready date checks too, because the handlers use one gate |
| 8 | Identity-on-file line, link box, Copy link | the check read the approval page's result, so no change to this control could turn it red | practice-test (four tests), live check removed | an inverted line, an empty link box, a Copy link that copies nothing, a missing "why no link" sentence, a revoked consent that still offers the link (9 breaks run on the real page) |
| 9 to 11 | the three upload doors | the type picked was never compared with the type filed; a file filed as "other" because the server did not know the type stayed green | live-check, plus a practice test of what each door posts | a file whose picked type is not the type filed; a file with no sender or the wrong sender in its metadata; a file with no label written after labels shipped; a file with a missing current version, object or checksum. Page: a dropped door kind, a dropped type, a wrong client, every door reading the first door's select (5 breaks run on the real page) |
| 12 | What You Own: Download link | judged 5 of the 11 deliverable types | live-check, every deliverable that has not expired | a missing object on any of the 11 types, each one on its own. An expired file is left out on purpose: the portal gives it no link by design |
| 13 | Consent wording, version badge, status banner | soft pull consents were not judged; marketing use was untested; the banner was not judged | live-check on all four kinds, plus a practice test of the screen | a soft pull consent (last 60 days, real clients) with the caller's words, a wrong version, or no version; marketing use with other words. Screen: words drawn as markup, a hardcoded version badge, each server status painting the wrong tone or sentence, the words posted back (9 breaks run on the real page) |
| 14 | Save (edit an existing wording) | false red on every edited PDF wording (its body is empty by design), and an edit that stopped recording who made it dropped out of the sample | live-check | a changed wording with no editor, when no migration ran near that moment; an editor who is not staff in this company; a sent contract whose words no longer match its fingerprint |
| 15 | 'Needs a human read' list | only answers already marked checked were read, so a list that hid an answer stayed green | live-check, both halves | an answer left unchecked past the repair program's own 24 hour clock (this is how a hidden answer shows up); a checked answer with no confidence at all and no confirmer |
| 16 | Call bureau | a second launch on one case, or a call whose case stamp never landed, stayed green | live-check, with one limit said out loud | more bureau calls logged in 30 days than cases marked fired, for one client. Limit: below |

### What each outcome rests on

- **Rows 5, 6, 7 (paid order).** `isCapitalBlueprintBuyer` needs `status = 'succeeded'`. Nothing in the repo updates
  `transactions.status` after it is written (checked: no `UPDATE transactions` outside tests), so a later refund
  leaves the order paid and cannot turn an old flag red. The earlier manifest said the opposite. It was wrong.
- **Row 5 split.** Migration 461 gave the table a `bank_name`. This button's insert never sets it; FinanceOS
  `planBank` and `openAccount` always do and have no offer gate. So a row with no bank name was written by this
  button. Taking the offer back later sets the flag to "false" and leaves the rows, so only a client who was never
  offered (flag absent) is wrong. Blank bank keys and account kinds other than personal or business are refused by
  database rules, so those two old clauses were removed rather than kept as checks that cannot fire.
- **Rows 9 to 11.** The type select is optional ("What is this? (helps us file it)"). A client who picks nothing is
  filed as "other" with source `none_given`, which is not wrong. So the saved row can show a type the server did
  not know (picked and filed differ) but cannot show a dropped choice. That half is the practice test of the page.
  The phone-text intake also writes `client_upload` files (generated_by `inbound-mms`, no label); the door checks
  now select their own files by `generated_by` starting with `client:` or `staff:`, which only
  `api/documents-upload.mjs` writes. Label rules only judge files created from 2026-09-07 on, the day after labels
  shipped (commit `7d9a80f58`).
- **Row 13.** Soft pull consents are judged for the last 60 days only. The wording table and the consent record both
  arrived on 2026-07-31 and older rows can predate them. A demo client's consent is left out. The status banner has
  no saved result of its own (it is worked out from the same rows when the screen opens), so it is covered by the
  practice test of the screen and not by the SQL.
- **Row 14.** `created_by` is NOT NULL on every template (migration 124), so it cannot tell a person's wording from a
  seed. Migrations 273, 287 and 288 rewrite seeded wordings and record no editor. `schema_migrations.applied_at`
  says when each migration ran (the app role already reads that table in `src/http/health.mjs`), so a wording whose
  `updated_at` is within 5 minutes of a migration is left out as "a migration is not a person". Blank name, words and
  signature sentence are refused by database rules (124, 125), so those clauses were removed.
- **Row 15.** `STAGE_SLA.response_received` in `src/repair/sla.mjs` is 24 hours, task `owner_reviews_parse`. The
  check imports that number, so the two cannot drift. Demo clients are left out of the stuck half.
- **Row 16.** `outbound_calls` stores no case id and the launch writes the call row and the case stamp in two steps.
  So a repeat is read at the client over 30 days: calls logged must not exceed cases marked fired. Limits that
  need a product change (store `case_id` on the call, or refuse a launch when `call_fired_at` is set): a repeat on
  one case is hidden when the same client has other cases the scheduler already stamped fired
  (`call-scheduler.mjs` stamps `call_fired_at` without placing a call); and a call that was placed but whose log write
  failed leaves nothing to read (the launch swallows that error).

## Row 1: the climate button, challenged in generation 2 and again in repair cycle 1 (na-verified)

Generation 1 said not-attachable: the button is on no shipped page. Generation 2 read the real page and the real
handler and agrees the sentence is exactly true, so no saved-result check and no click test can exist for it. It
was a permanent NOT_PROVED. That is the one outcome the heartbeat law does not allow (a "nothing to judge" must be
re-checkable), so it now ends as a verified N/A that reads the live page on every run.

What is true, read on 2026-10-14:

- `public/climate/index.html` is the lending-climate dashboard ("Loading lending climate..."). Its page script
  calls only `/api/climate` and `/api/climate/geocode`. The `climate-lead-magnet` page and form were reverted in
  commit `f39cec357` ("Revert Claude climate visitor page; keep API and map JSON").
- A read-only GET of `https://fundhub.ai/climate/` and each script it loads (7 own chunks plus `/funnel/rb2b.js`)
  found neither the words "See how many banks in our book fit your state" nor the string `climate-match`. The live
  page is byte-for-byte the repo page (4820 bytes).
- No file under `public/`, `marketing/` or `api/` names the button. Only `docs/` and `ops/` do.

How it works (`src/pulse/coverage/fin-b06-not-shipped.mjs`, GET only, redirects not followed, 4 s per request and
an 8 s budget for the whole read):

1. GET the page, and the sibling route `/climate/lender-climate/` (the claim lists both). Not 200, not a web page, or
   a network error: row says `skip` with the reason.
2. Follow what the page leads to on the same site, up to 5 hops and 40 files: script tags, preloaded modules,
   iframes, `import()` targets, static imports, workers, and any string that names a script or page (a Next build
   payload, a webpack chunk map). A file the page really loads that fails is `skip`, never "absent". A path that
   was only guessed from a string may be missing (a 404 is ignored); guesses past the cap are dropped.
3. Search every file after undoing the easy ways to hide a word: tags between words, entities, escapes,
   `"a" + "b"`, `.concat`, `["a","b"].join(" ")`, `atob(...)`, `String.fromCharCode(...)`. The markers are the
   button words, `climate-match`, `climate_match` and `website:climate`.
4. Nothing found and every file read: the row says `na`, code `catalog-display-control-not-shipped`. The morning
   audit asks this file again before it lets `na` stand.
5. Anything found: the control ships now. The row goes back to `NOT_PROVED` with a fix line, and a person attaches
   a real check for the scroll and for the form it saves (the form row already has the `climate-lead-saved` live
   check).

What it still cannot see, said plainly: words built at run time from something that is not a literal in any file
(an API reply, a computed template). A page that does that can ship the button and this read will not find it.
The form it opens is judged on its saved lead by `climate-lead-saved`, so a working form still shows up there.
The real page is read in 10 GETs (page, sibling route, 8 files), about 1 second on 2026-10-15.

The claim data lives on the contract (`contract.notShipped` in `fin-b06-display-contracts.mjs`), so it travels
through `generated.json` like the rest. The contract is still `mode: "always-red"` (no saved result exists).

The climate form row (`POST /api/public/climate-match`) is a live check on the saved lead, so a lead filed by any
caller (the door has `Access-Control-Allow-Origin: *`) is judged. With no caller today it reads "no saved
results yet". That is quiet, not proved by use.

## How the checks work (no local Postgres on this Mac)

There is no local Postgres here. Each check is written once in a small builder (`fin-b06-sql-kit.mjs`) that prints
the read-only SQL and also runs the same definition as a JavaScript judge over stand-in rows. The test file builds a
good world for each check (green, with a real sample, not vacuous) and then breaks it one way at a time (250+ cases
across breaks and "still green" cases that prove a check does not cry wolf).

Repair cycle 1 added a second execution of the same cases: `fin-b06-sqlite.mjs` runs the PRINTED SQL for real in
SQLite (`node:sqlite`, built in to Node 22) over the same stand-in rows, after a small mechanical dialect step, and
the test requires its `sample_count` and `bad_count` to equal the judge's, for every world, every break and every
"still green" case. It also sweeps every calendar day for 12 years against JavaScript's own calendar. That catches
a typo or a wrong NULL rule that only lives in the SQL. It is not Postgres: its regular expressions and timestamp
parsing are stood in by JavaScript. The first live pulse is still the first Postgres run.

The SQL text is also checked by `fin-b06-schema.mjs`: every table named after FROM or JOIN and every
`alias.column` must exist in `db/schema` + `db/migrations` (plus `schema_migrations`, which `db/migrate.mjs` makes).

Proof that the tests are not decoration: after the repair, each new rule was removed from the check definition and
the contracts test went red every time (27 definition mutants, 5 kit mutants, 22 mutants of the not-shipped read, 23
breaks of the shipped pages; two of the not-shipped mutants first stayed green and two tests were added). Every page was restored after its run and `git status` shows the pages untouched.

## Files added

- `src/pulse/catalog/proofs/fin-b06-sql-kit.mjs` (the builder; repair cycle 1 added `realDay`, `startsWith`, `onOrAfter`
  and the paid-order rule)
- `src/pulse/catalog/proofs/fin-b06-schema.mjs` (the migration reader; repair cycle 1 added `schema_migrations`)
- `src/pulse/catalog/proofs/fin-b06-sqlite.mjs` (repair cycle 1: runs the printed SQL in SQLite over the stand-in rows)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.mjs` (33 checks and 2 gaps)
- `src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs`
- `src/pulse/catalog/proofs/fin-b06-display-practice.mjs` (9 practice proof cases: 5 practice only, 4 that also keep a live check)
- `src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` (11 Chromium tests)
- `src/pulse/coverage/fin-b06-not-shipped.mjs` (the live-page read for a control that is not shipped; rebuilt in repair cycle 1)
- `src/pulse/coverage/fin-b06-not-shipped.test.mjs` (36 practice tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b06.md` (this file)

## Shared lines touched (for the integrator)

| File | What |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | one import line; eight old `gap(...)` lines removed (Save changes, Showing/Hidden switch, name box, outcome copy box, Save create wording, Save edit wording, Consent wording banner, Void button); one `...FIN_B06_DISPLAY_CONTRACTS,` line at the end of the array |
| `src/pulse/catalog/compiler.mjs` | `compileDisplayRuntimeData`: a tracked money or customer row that owns a registered contract is now judged even when no browser spec names it (16 new lines, plus `DEEP_IMPACT`). Without this a contract keyed by control text was never attached or queried |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line and one `...FIN_B06_DISPLAY_PROOF_CASES,` line |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 662 (rows that now have a live check or a practice test); repair cycle 1: 662 to 661 (the identity-on-file row has a practice test now) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers 40 / 27 / 13 became 68 / 62 / 6 (contracts, pass-capable, unmeasured), `SQL_BATCHES` 27 to 62, result cases 40 to 68. Repair cycle 1 moved them again to 67 / 60 / 7 and `SQL_BATCHES` 60: the identity-on-file row left the live lane for a practice test, and Save month/year became an unmeasured contract. The two `NOT_PROVED` counts are 6 |
| `src/pulse/catalog/generated.json` | recompiled with `npm run pulse:catalog` (a conflict is expected; recompile after merging). Generation 2 changes one contract in it (the climate button gains `notShipped`) |
| `src/pulse/coverage/gap-catalog-display.mjs` | generation 2: one import line; in `gapChecks` a `notShipped` map and one `if (notShipped.has(entry.id)) return ...` line at the top of `judge`; one `[NOT_SHIPPED_CODE]` entry at the end of `naVerify` |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | generation 2: two `NOT_PROVED` counts 6 became 5 (the climate row is no longer NOT_PROVED while the live page lacks the button). Comment says why |
| `src/pulse/na-conditions.mjs` | generation 2: one new code `catalog-display-control-not-shipped` (`verify: "lane"`), inserted before the `no-sender` block. The closed list is now 15 codes |
| `src/pulse/na-conditions.test.mjs` | generation 2: the closed list (14 to 15), the lane-code list, and the sample args for the sentence test. Three lines |

Do not trust my guard numbers after the merge (they are 67 / 60 / 7 and `SQL_BATCHES` 60 on this branch). Re-derive: contracts = base contracts minus replaced gaps plus every
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
   not on the shipped page; no page calls `/api/public/climate-match`. Re-confirmed on the LIVE site on 2026-10-14
   (page and all its scripts read by GET). The page was reverted on purpose in `f39cec357`. (Also found by slice 4.)
5. `api/content/tiles.mjs` Save runs no transaction by design (its own comment says so): tile words can be saved and
   the video map fail. A read cannot see which half landed.
6. `parseReadyDate` in `src/blueprint/next-funding-sequence.mjs` accepts a day that is not on the calendar (JavaScript
   rolls `2026-02-31` to 3 March) and stores the text as typed. `dueForNextSequenceAlert` then casts every saved day
   with `::date` in Postgres, which refuses `2026-02-31`, so the daily closer-alert read fails for the WHOLE company
   on one bad day. The ready date check goes red on it now; the product is not fixed.
7. `launchBureauCallForCase` (`src/inquiry-ops/bureau-call.mjs`) never refuses a launch when the case already has
   `call_fired_at` set ("disabled once fired" is the page only), uses `coalesce(call_fired_at, now())`, and
   `outbound_calls` stores no case id. A second launch places a second call to the bureau. A call whose log write
   fails is swallowed in a `catch`, so it leaves nothing to read.
8. `api/repair/exceptions.mjs` lists only unconfirmed answers that are under 0.85 confidence or stamped held. An
   answer with no confidence at all is auto-confirmed by `runParseAdvanceLoop` (NaN is not under the threshold) and
   is hidden from that list too. The check now reads a confirmed answer with no confidence as one that needed a person.

## Things the integrator and Chris should know

- The display lane now runs 60 SQL reads one after another (it ran 27). Each is scoped to one company, and the heavy
  ones (events, documents, account sessions, client notes) use equality joins the planner can index. I could not time
  them against the real database. If the morning pulse step gets slow, split the lane. The 26 second step cut is the
  limit.
- First live run: these checks have never touched real rows. A red on day one means either a real wrong result or a
  legacy row the code path no longer writes. Each check's requirement text names the exact invariant, so the red
  names itself.
- The `blueprint-*` checks now need a PAID Blueprint order (`status = 'succeeded'`, the handlers' own gate). Nothing
  updates a transaction's status afterwards, so a refund cannot turn an old flag red.
- The not-shipped read does up to 40 GETs of the site's own static files (10 on the real page) inside the display lane's
  step, under an 8 second budget for the whole read. If it runs out of time the row says `skip`, never `na`.
- Day-one reds are real findings, not noise, but they will name old rows: the ready date check will name any client
  already holding a day that is not on the calendar; the unchecked-answer half will name every bureau answer nobody
  has read in 24 hours; the bureau call check names a client with more calls than fired cases in 30 days.

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

### Generation 2 commands (2026-10-14)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` at the start | `{"total":814,...,"gap-catalog-display":641}`; batch rows open: 1 |
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":813,...,"gap-catalog-display":640}`; batch rows open: 0. The stub page here is empty, so the climate row reads `skip` offline; served the real `public/` files it reads `na` |
| display lane run with the real `public/climate` files served as the live site | climate row `na`, code `catalog-display-control-not-shipped`; "/climate/ opens, and neither the page nor its 8 own scripts carry it or the door it would call" |
| read-only GET of `https://fundhub.ai/climate/` and its 7 chunks plus `/funnel/rb2b.js` | 200 each; none carry the button words or `climate-match`; page is 4820 bytes, same as the repo file |
| `node --test src/pulse/coverage/fin-b06-not-shipped.test.mjs` | 20 pass |
| mutation of the real page (button text added to `public/climate/index.html`; script made to call the lead door), each restored after its run | 4 and 3 tests red, then 20 pass after restore |
| mutation of the new check's own code (9 breaks: scripts not read, non-200 read as absent, failed script ignored, audit verify always true, door string not looked for, other sites fetched, redirects followed, script cap removed, empty body accepted) plus lane hook removed and audit hook removed | every one red (1 to 15 tests each), restored, 20 pass |
| `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check` | exit 0, `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs` | 2391 tests, 2191 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs scripts/pulse/*.test.mjs` | 1113 tests, 1097 pass, 0 fail, 16 skipped |
| `node --test src/pulse/na-conditions.test.mjs` | 36 pass |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` (re-run) | 4 pass |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass |
| every other `src/pulse/catalog/proofs/*.test.mjs` in one run | NOT finished. It spawned playwright e2e specs and ran for over 15 minutes on a busy Mac; stopped. 13 results before the stop, 0 failed. Nothing in it touches this change |

What was not run: `npm run pulse:prove` (it builds the bundle and reads the live database; there is no database
here and the brief says never to run against production). The new read adds up to 9 GETs (4 s each, in parallel
after the first) to the display lane, plus the audit asks once more. If the lane step gets slow, this is the first
thing to look at.

### Repair cycle 1 commands (2026-10-15)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` after | `{"total":814,...,"gap-catalog-display":641}`. Batch rows open: 1 (Save month/year). The count went from 813 to 814 on purpose: one false green went back to not proved |
| `npm run pulse:catalog` then `node scripts/pulse/compile-catalog.mjs --check` | exit 0, `3975 mapped, 33 marked repeats, 3942 unique; 3919 wired, 23 red` |
| `node --test src/pulse/coverage/*.test.mjs src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/fin-b06-display-contracts.test.mjs` | 2408 tests, 2208 pass, 0 fail, 200 skipped (pg tests, no database here) |
| `node --test src/pulse/*.test.mjs src/pulse/beats/*.test.mjs scripts/pulse/*.test.mjs` | 1113 tests, 1097 pass, 0 fail, 16 skipped |
| every `src/pulse/catalog/proofs/*.test.mjs` that opens no browser and is not display-proof-cases | 1465 tests, 1465 pass, 0 fail |
| `node --test src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs` | 11 pass |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" display-proof-cases.test.mjs` | 2 pass |
| `node --test src/security/*.test.mjs` | 15 pass, 1 skipped |
| `node scripts/lint.mjs` | 3571 files and inline scripts parse clean |
| definition mutants (27) of `fin-b06-display-contracts.mjs`, kit mutants (5) of `fin-b06-sql-kit.mjs`, each restored after its run | all red |
| mutants (22) of `fin-b06-not-shipped.mjs` | all red, restored |
| breaks of the real pages: `client-control-panel.html` 9, `consent-capture.html` 9, `client-portal.html` 5, each restored after its run | all red; `git status` shows no page changed |
| read-only GET of `https://fundhub.ai/climate/` and `/climate/lender-climate/` and what they lead to, through the new read | `absent`, 10 GETs, no marker found |

Not run: `npm run pulse:prove` (no database here, and the brief forbids production), and the third test in
`display-proof-cases.test.mjs` (it spawns every proof test in the repo).
