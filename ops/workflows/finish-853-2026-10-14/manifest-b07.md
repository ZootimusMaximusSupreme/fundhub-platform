# Batch 07 manifest: Specialist desk, lenders Apply, vault, Plaid, soft pull, agreements, social

Branch `fin/b07`, built from `fin/base` (2f4f574a0). Nothing was pushed or merged. Tests and catalog data only. No product file was changed.
Generation 1 of at most 3. Lane `gap-catalog-display`, 46 rows.

## The number

| | Rows |
|---|---|
| Rows in this batch | 46 |
| Open (NOT_PROVED) before | 46 |
| Open after | 2 |
| Live checks | 40 |
| Practice tests | 4 |
| Not attachable (exact reason below) | 2 |

Measured with `node scripts/pulse/count-not-proved.mjs` and the batch file: the four lanes, offline, stub fetch. The whole count went 853 to 809 on this branch (44 fewer, all in `gap-catalog-display`).

## What each row ended as

| Row | Outcome | What judges it |
|---|---|---|
| lenders.html — Lender row Apply button (only on a client-scoped view ?client_id=; opens the bank page thr | live-check | fin-b07-lender-apply: every proxy session has a real client, an application address, a lender or application of the same client, an exit address when active, and none sits verifying past fifteen minutes. |
| lenders.html — Apply dialog: Copy proxy string, End session, Close (manual fallback when the Chrome exten | live-check | fin-b07-apply-dialog: every ended, failed or mismatched proxy session has an end time not before its start and a staff member. Copy and Close leave no trace. |
| money-banks.html — Page gate: client reads own file; staff (owner, admin, sales_manager, closer) need ?client | not-attachable | public/app/money-banks.js draws the staff plan forms when ?client_id= is in the address (var staff = !!clientId), not by role, so a signed-in client who types it sees them; the row's claim 'only staff see plan controls' is not true of the page. Needs a product change (gate by role). |
| inquiry-remover.html — Page gate: inquiry_specialist, owner, admin, funding_advisor roles; setter/closer-only rol | practice-test | fin-b07-page-gates.test.mjs: the real read handlers let in only owner, admin, inquiry_specialist, funding_advisor and refuse every other staff role and a client before any read; the real page tells a refused role 'This queue is for staff on this desk.' and not an empty queue. The page does not leave its URL (see product finding 4). |
| inquiry-remover.html — Case queue table: one row per inquiry removal case, oldest first (Client, Waiting, Bureau, | live-check | fin-b07-case-queue: every open case has a real client, requested time, bureau, non-negative item count, and a funding round that exists. Oldest-first order is not judged. |
| inquiry-remover.html — Case statuses shown in the Status column: Queued, Scheduled, In Progress, Escalated, Block | live-check | fin-b07-case-statuses: Completed has a completed stamp, Canceled a closed stamp, and every status is one of the seven. |
| inquiry-remover.html — Case drawer: 'Upload FTC or police report' (file input + button; attaches as additional_fr | live-check | fin-b07-case-upload: every additional_fraud_docs file has a current version with key, size, checksum and a sniffed pdf/png/jpeg type. |
| inquiry-remover.html — Case drawer: 'Generate letters' button (writes inquiry items from the credit file; mails n | live-check | fin-b07-case-generate: every inquiry attached to a case is the same client and company and a bureau the case names. 'Mails nothing' is not judged. |
| inquiry-remover.html — Case drawer: 'Send' button (letter to the bureau by PostGrid mail and/or Experian portal;  | live-check | fin-b07-case-send: a case holding a provider id or portal reference has the matching sent letter or portal attempt and never reads Queued. The refusal while the packet is short leaves no trace of its own and is not judged. |
| inquiry-remover.html — Case drawer: 'Mark cleared' button (case Completed; emits inquiry.removed) | live-check | fin-b07-case-cleared: every Completed case has a completed stamp and an inquiry.removed receipt for that client after the request. |
| inquiry-remover.html — Case drawer: 'Close' button (case Canceled) | live-check | fin-b07-case-close: every Canceled case has a closed stamp and a real client, and no inquiry.removed receipt unless it completed first. |
| inquiry-remover.html — Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Cal | live-check | fin-b07-work-queue: every open disputed line has a real client, a bureau, the reported name and a non-negative attempt count. |
| inquiry-remover.html — Work row: click or Enter expands the work strip; loads attempt history and the masked iden | live-check | fin-b07-work-row: every attempt in a row's history names a real staff member of the same company, and every identity on file holds ciphertext, never plain digits. |
| inquiry-remover.html — Work strip: attempt kind select (call, letter, portal, note) + 'Log an attempt' button | live-check | fin-b07-log-attempt: every attempt names a staff member and inquiry of the same company and the inquiry's counter equals its call, letter and portal attempts. |
| inquiry-remover.html — Work strip: 'Mark confirmed' button (confirms removal; sets confirmed_at) | live-check | fin-b07-mark-confirmed: every confirmed inquiry is closed with a cleared stamp, the case's client, and its case is Completed once none is still open. Rows confirmed through 'Set status' also turn this red (finding 2). |
| inquiry-remover.html — Work strip: free-text status input + 'Set status' button | live-check | fin-b07-set-status: every status is trimmed and not blank, and a removed/confirmed/deleted/cleared status carries the confirmed stamp. |
| inquiry-remover.html — Work strip: expected-name input + 'Save expected' button | live-check | fin-b07-save-expected: every expected name is trimmed, not blank, and at most 200 characters. |
| inquiry-remover.html — Identity line: reason input + 'Reveal SSN' / 'Hide' button (writes name and reason to the  | live-check | fin-b07-reveal: every reveal in the log names its reason, a real client, and a staff id of this company. |
| inquiry-remover.html — Recent Letters Issued list + 'All letters' link (documents.html) | live-check | fin-b07-recent-letters: every listed letter or portal upload has a real inquiry, client, bureau and staff member, and a failed mail has a later sent letter. |
| inquiry-remover.html — Repair queue table: Client, Program, Round, Stage, Needs chip, Due (need-me first, most ov | live-check | fin-b07-repair-queue: every optimization card has a real client, a stage of that board, and an entry time. Need-me-first order is not judged. |
| inquiry-remover.html — Repair stage: intake (SLA 3 business days -> chase_contract task) | live-check | fin-b07-stage-intake: no file in intake is past three business days (judged at five calendar days). The 'chase_contract task' is never created by any code (finding 7). |
| inquiry-remover.html — Repair stage: awaiting_documents (SLA 14 days -> owner_contact_client) | live-check | fin-b07-stage-await-docs: no file waiting on papers is past fourteen days. |
| inquiry-remover.html — Repair stage: analysis (SLA 1 hour -> engineering_engine_failure) | live-check | fin-b07-stage-analysis: no file in analysis is past one hour. |
| inquiry-remover.html — Repair stage: letters_generated (SLA 30 minutes -> generation_or_variance) | live-check | fin-b07-stage-letters-generated: no file is past thirty minutes and every one holds a letter. |
| inquiry-remover.html — Repair stage: ready_to_send (SLA 4 hours -> dispatch_failure; shows as 'Ready') | live-check | fin-b07-stage-ready: no file is past four hours and every one holds a generated or ready letter. |
| inquiry-remover.html — Repair stage: in_transit (SLA 10 days -> check_postgrid_tracking; shows as 'Waiting') | live-check | fin-b07-stage-transit: no file is past ten days and every one holds a sent or delivered letter. |
| inquiry-remover.html — Repair stage: awaiting_response (bureau due date + 5 days -> bureau_deadline_breach; shows | live-check | fin-b07-stage-await-response: every file holds an open case with a due time and none is more than five days past it. |
| inquiry-remover.html — Repair stage: response_received (SLA 24 hours -> owner_reviews_parse; shows as 'Answer in' | live-check | fin-b07-stage-response-received: no file is past twenty-four hours and every one holds a saved bureau response. |
| inquiry-remover.html — Repair stage: round_complete (no clock; chip 'Round done - next?') | live-check | fin-b07-stage-round-complete: every file holds a saved response or a round-complete / response-parsed receipt. |
| inquiry-remover.html — Repair stage: stalled (the human queue; shows as 'Stuck') | live-check | fin-b07-stage-stalled: every stuck file holds a stall decision in repair_decision_log or a case marked stalled. |
| inquiry-remover.html — Repair stage: program_complete (shows as 'Done') | live-check | fin-b07-stage-program-complete: every Done file's program is complete or upsell_pending, or it holds the repair.program.complete receipt. |
| inquiry-remover.html — Repair stage: cancelled (shows as 'Cancelled') | live-check | fin-b07-stage-cancelled: no cancelled file belongs to a client whose repair program is still active. Nothing in the code emits repair.cancelled (finding 8). |
| inquiry-remover.html — Repair row: click or Enter expands the file (items, letters this round, what is next, time | live-check | fin-b07-repair-row: every open dispute case holds only its own client's items and letters and a board card of the same client. |
| inquiry-remover.html — Letter drawer 'Send this one' button (mails one letter) | live-check | fin-b07-letter-send-one: every mailed letter has a bureau, a furnisher address when needed, and no twin carrying a mailed stamp for the same case, bureau, round and target. |
| inquiry-remover.html — Expanded row 'Send' button (mails every sendable letter; fails closed without mail=true) | live-check | fin-b07-row-send: every mailed letter has both stamps and a case whose 30-day bureau clock started; no claim older than a day sits unmailed. 'Fails closed without mail=true' leaves no trace and is not judged. |
| inquiry-remover.html — Expanded row 'Stage' button (generates the round's letters; mails nothing) | live-check | fin-b07-row-stage: every staged letter has a case of the same client, its words, a furnisher address when it goes to a furnisher, and no mailed stamp. |
| inquiry-remover.html — Expanded row 'Clean personal info' button (owner and admin only; asks to confirm; cannot b | live-check | fin-b07-clean-personal: every completed erasure leaves no identity, bank login or bank account from before it finished, and a cleared client row. The owner/admin role gate is held by s3-privacy-erasure-handler.test.mjs, not here. |
| public/app/money-vault.html — documents-upload (server): stores the file, one document per file, sniffs the bytes | live-check | fin-b07-vault-upload: every client or staff upload is one document with a current version holding key, size, checksum and a sniffed pdf/png/jpeg type, filed under a business of the same client. |
| public/app/money.html — link-token (server): mints a Plaid Link token for the client's own file, or for staff on a | practice-test | fin-b07-link-token.test.mjs: the real handler with a two-company clients table: client pinned to its own file, finance roles only for staff, other company's client is a 404, affiliate/partner refused, 503/502 never a 200 without a token. Leaves no saved result. |
| public/app/money.html — link-exchange (server): trades the public token, stores the encrypted item, saves every ac | live-check | fin-b07-link-exchange: every active bank link holds an encrypted token, a consent stamp, a Plaid item id and at least one saved account of the same client. |
| public/app/partner-galaxy.ht — Open the page (partner home; PRINCIPAL_ONLY and NAV_HIDDEN in shell.js, owner reaches it,  | practice-test | fin-b07-page-gates.test.mjs: the real page and shell: owner and a partner stay, every other staff role is sent to its own home, the three tiles paint a real zero as $0 and an unknown as 'not known'. |
| social-studio.html — Connect Facebook / Connect Instagram / Connect LinkedIn buttons (+ LinkedIn organization I | live-check | fin-b07-social-connect: every connected channel belongs to a partner of the same company, a known channel, an account, no urn prefix on LinkedIn, and a token when active. |
| soft-pull-approve.html — Business fields: name, street, city, state, ZIP, EIN, incorporated month, extra owner | live-check | fin-b07-business-fields: every soft_pull_approve business has name, street, city, state, ZIP, an EIN NN-NNNNNNN, an incorporated month and an age not over its age today. Replaces the always-red gap contract. |
| staff-teams.html — Editor 'Employment agreements' list and 'Open signed / Open' (downloads the PDF) | live-check | fin-b07-agreements: every staff agreement has a real staff member, a file once sent, and for signed ones a signed time, signer and an existing signed copy. |
| shell.js chrome (loaded by s — Search button and Cmd/Ctrl+K: global CRM search (clients, contracts, documents, conversati | practice-test | fin-b07-search.test.mjs: the real handler: every group statement carries the session company in its WHERE and as $1, partner/affiliate/client refused before any read, empty term reads nothing, wildcards escaped, a failed group is not a 200. |
| page:leads/<32-hex>/index.ht — Private leads list page (noindex, secret folder name): a local table with Name, Number, Fo | not-attachable | public/leads/<32-hex>/index.html is excluded from git (.git/info/exclude) and exists only in the owner's main folder; no checkout, CI run or deployed bundle can read it, and the page keeps edits in the browser only, so there is no saved result either. |

## How a live check works here (so a reviewer can challenge it)

Each live check is one read-only SQL text in `src/pulse/catalog/proofs/fin-b07-display-contracts.mjs`. It takes the company as `$1::uuid` and answers `sample_count` and `bad_count`. All 40 are `emptyAs: "quiet"`: a control nobody used in the window reads green with the words "no saved results yet", and goes red on the first wrong one.

- Windows: 60 days on `updated_at` / `created_at` / `started_at` (30 days for letters, which carry the mailing stamps only since 2026-09-05; 400 days for erasures). Demo rows are never judged.
- The SQL is in the common subset of Postgres and SQLite (no regexes, no arrays, no `DISTINCT ON`), so the test can run the exact text. Where Postgres would raise on a bad cast, the cast sits under a `CASE` guard.
- The test kit reads the real table and column names from `db/schema` + `db/migrations` (`fin-b07-sql-kit.mjs`). A stand-in table can only hold real columns, and `fin-b07-live-contracts.test.mjs` checks every `alias.column` in every contract against that schema.
- Every scenario (`fin-b07-case-runner.mjs`) does four things: a right result is counted and none is wrong; no rows reads 0 of 0; one wrong row is counted as exactly the expected number wrong; and the same SQL with the named clause switched off reads that wrong row clean. That last step is the "break it on purpose, see it red, put it back" step, done inside the test for every wrong-result case (see the counts at the end). Another company's wrong row is never counted.
- File-level breaks, by hand, restored with `git checkout`: closed-stamp clause dropped from the Canceled check (red), in_transit ten-day clock removed (red), Plaid "saved no account" clause removed (red).

### Practice tests broken on purpose

| Test | Break made in the product file | Result |
|---|---|---|
| `fin-b07-page-gates.test.mjs` | `closer` added to `ROLE_SETS.SPECIALIST_DESK` in `src/http/read-api.mjs` | red (2 tests) |
| same | refusal sentence changed on `public/app/inquiry-remover.html` | red |
| same | `partner-galaxy.html` removed from `ADMIN_BLOCKED` in `public/app/shell.js` | red |
| same | tile dollars divided by 1000 / unknown cost shown as `$0` on `public/app/partner-galaxy.html` | red / red |
| `fin-b07-link-token.test.mjs` | org condition dropped from `src/http/client-scope.mjs` | red (5) |
| same | client session reads `client_id` from the body | red |
| same | role gate widened to `setter` / partner kind accepted / 503 turned into 200 | red / red / red |
| `fin-b07-search.test.mjs` | contracts group loses its company condition | red (2) |
| same | wildcards not escaped / client page moved / failure painted as 200 / company taken from the address | red / red / red / red |

Every break was restored with `git checkout -- <file>`; `git status` showed only my new files afterwards.

## Files added

- `src/pulse/catalog/proofs/fin-b07-display-contracts.mjs` (40 contracts, row table, live and practice cases, the two not-attachable reasons)
- `src/pulse/catalog/proofs/fin-b07-sql-kit.mjs`, `fin-b07-case-runner.mjs` (test kit)
- `src/pulse/catalog/proofs/fin-b07-live-contracts.test.mjs` (shape guard: 8 tests)
- `src/pulse/catalog/proofs/fin-b07-live-cases-desk.test.mjs` (111 tests), `fin-b07-live-cases-repair.test.mjs` (90), `fin-b07-live-cases-misc.test.mjs` (64)
- `src/pulse/catalog/proofs/fin-b07-page-gates.test.mjs` (5), `fin-b07-link-token.test.mjs` (10), `fin-b07-search.test.mjs` (6)
- this manifest

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | import of `FIN_B07_RESULT_CONTRACTS` at the top; `...FIN_B07_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`; **one existing line removed**: the always-red `gap("Business fields: name, street, ...")` (my live contract replaces it; two contracts for one control throws "must be unique") |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line, one `...FIN_B07_DISPLAY_CASES,` line at the end of `PLUGIN_DISPLAY_PROOF_CASES` |
| `scripts/pulse/compile-catalog.mjs` | one import line; `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B07_LIVE_CASES]` |
| `src/pulse/catalog/generated.json` | recompiled. Recompile after merging; do not hand-merge |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 40 to 79 contracts (+40 mine, -1 removed gap), pass-capable 27 to 67, unmeasured 13 to 12, SQL batches 27 to 67, shipped-bundle cases 40 to 79. Sum the other batches' changes and take the number the test prints |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 632 (-40 here) |

Five of my rows (work queue table, work row, Mark confirmed, repair row, business fields) are already deep cases in `display-batch-staff-ui.mjs`. They are not repeated in `FIN_B07_LIVE_CASES`: the contract alone turns them live. `fin-b07-live-contracts.test.mjs` keeps `FIN_B07_ALREADY_DEEP` equal to the staff file.

## Product findings (nothing fixed)

1. `src/handlers/inquiry-gate.mjs` (`upsertBureauCase`) writes `case_status = Queued` or `Blocked` over an existing ACTIVE case, including an `In Progress` case that was already mailed. `createCase` documents this exact hazard ("would tell the desk to send a letter that is already in the mail") and guards it; this UPDATE does not. The Send live check goes red on a mailed case reading Queued.
2. `setStatus` (Set status button) with a removed/confirmed/deleted/cleared word sets `confirmed_at` but leaves `is_open = true` and `cleared_at` null. Migration 143 says `is_open` is "False once Cleared/Removed". The row is still counted in "Still open" and its case never completes. The Mark confirmed live check goes red on such a row.
3. `listRecentLetters` (Recent Letters Issued) lists every `letter` attempt including `mail_failed:*` outcomes, so a failed mail reads as an issued letter. The Recent letters check goes red on a failed mail with no later sent letter.
4. `public/app/inquiry-remover.html` has no page-level role gate: closer, setter, csm and sales_manager stay on the page (the shell offers them the Specialist tab) and are told "This queue is for staff on this desk." because the two read handlers answer 403. The row's word "bounced" is true of the data, not of the URL.
5. `public/app/money-banks.js` switches the staff plan forms on by `?client_id=` in the address, not by role (S4 finding 7, confirmed). The row cannot be attached.
6. `ensureCaseInquiries` in `src/inquiry-ops/send.mjs` inserts carrier `inquiry_log` rows and never refreshes `open_inquiry_count`, so the Items column can be stale after a Send. Not asserted (it would be red on correct data).
7. `evaluateSlaBreach` in `src/repair/handlers.mjs` is never called and no code creates the tasks the stage rows name (`chase_contract`, `owner_contact_client`, `engineering_engine_failure`, `generation_or_variance`, `dispatch_failure`, `check_postgrid_tracking`, `bureau_deadline_breach`, `owner_reviews_parse`). The SLA clock is only ever read, by the pulse. The stage live checks judge the clock; the "-> task" half does not exist.
8. Nothing in `src/` emits `repair.cancelled`; the Cancelled stage is reachable only by a manual card move or an event emitted from outside. The check judges "no active program on a cancelled file".
9. The `update` action of `POST /api/inquiry-cases` can set `Canceled` or `Completed` without writing `closed_at` / `completed_at`. The Close and statuses checks go red if that path is used.
10. The webhook path (`closeCase` in `src/inquiry-removal/cases.mjs`) stamps `completed_at` on a Canceled case, so a canceled case reads completed. Harmless to the checks, but wrong.

## Not attachable

- `money-banks.html` Page gate: finding 5. A test that asserted the row's claim would be false. The server half ("a client can never change the plan") already has a test in `src/http/money-banks.test.mjs` and is not this row.
- Leads list page: the file is excluded from git. The owner would have to commit it (or move it under a tracked path) before any test can read it. It also leaves no saved result (edits live in the browser).

## Risks for the integrator

- **First-run reds are expected, and real.** Findings 1, 2 and 3 will show as reds the first time the lane reads live data, if such rows exist in the last 60 days. That is the point of the check; nobody should read them as a regression of this batch.
- **Not run against live data.** No database access was used (brief). The 40 SQL texts were run only on stand-in rows in SQLite. They were written with Postgres types in mind (casts under `CASE`, `::text` on uuids, `bytea` only through `length()`), and every table and column was checked against the migrations. A Postgres-only mistake would show as a `skip` ("was not read") on the morning report, not as a false PASS.
- **Lane time.** 40 more statements run one after another in the display lane. Each is a count over a windowed table; none was timed against production.
- `display-proof-cases.test.mjs` "the focused proof test runs every executable test named by every case" now also runs 8 more files (three scenario files, the shape guard, and three practice files, one of them in Chromium through the S4 harness and its queue).

## Commands run

Measured on this Mac while other builders ran browser suites at the same time (load average 16 to 40).

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` then the batch-07 intersection (before) | 853 open in all, 46 of the 46 batch rows open |
| `npm run pulse:catalog`, then the same count (after) | 809 open in all, 2 of the 46 batch rows open (the two not-attachable) |
| `node scripts/pulse/compile-catalog.mjs --check` | catalog current |
| `node --test src/pulse/catalog/proofs/fin-b07-*.test.mjs` | 294 tests, 294 pass |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs` | 81 tests, 81 pass |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | 2 of 2 pass (red count 632) |
| `npm run lint` | 3572 files and inline scripts parse clean |
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the full file, which runs every executable test named by every case) | see the last line of this file |

