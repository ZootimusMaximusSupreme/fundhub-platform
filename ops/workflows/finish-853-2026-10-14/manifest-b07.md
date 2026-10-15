# Batch 07 manifest: Specialist desk, lenders Apply, vault, Plaid, soft pull, agreements, social

Branch `fin/b07`, built from `fin/base` (2f4f574a0). Nothing was pushed or merged. Tests and catalog data only. No product file was changed.
Generation 3 (repair cycle 1, 2026-10-15) follows generation 2. Lane `gap-catalog-display`, 46 rows.
**Read "Repair cycle 1" first.** Everything after it is the generation 1 and 2 record; where it disagrees with the cycle section, the cycle section wins.


## Repair cycle 1 (2026-10-15): twenty rows an independent checker kept green while the product was broken

An independent checker broke each of twenty rows on purpose and watched the check stay green. Every one of the
twenty was challenged again here. Each row now ends in exactly one of three states, and none is left green over a
break the checker named. Tests, catalog data and this manifest only. No product file was changed (every break
below was made in a throwaway copy of a file, then put back with the original text; `git status` shows only
the files listed under "Files").

| | Rows |
|---|---|
| Rows in this batch | 46 |
| Attached as a live check (saved-result SQL, 39; live page read, 1) | 40 |
| Attached as a practice test only (page home, link token, search) | 3 |
| Not attachable, so NOT_PROVED (Banks page gate, Page gate, Work queue table) | 3 |
| Open before this cycle, whole count | 808 |
| Open after this cycle, whole count | 810 (the two rows taken off are the +2) |

Measured with `node scripts/pulse/count-not-proved.mjs`: 808 before, 810 after. The two that came back are
`Page gate: inquiry_specialist...` and `Work queue table: one row per disputed inquiry line...`. The Banks page
gate was already open and stays open.

Honest direction: a row that the product makes false is not proved, and it is better red on the board than green.

### What each of the twenty ended as

| Row | Outcome | What now judges it |
|---|---|---|
| inquiry-remover.html Page gate (roles; setter/closer bounced) | not-attachable | Taken off. See finding A: the Work queue read is open to every staff role, so the row's claim is false of the product. The practice test that was attached only held 2 of the 4 doors. |
| Letter drawer 'Send this one' | live-check | `fin-b07-letter-send-one`. The dead "two mailed stamps" clause (migration 332's unique index makes that state impossible) is gone. Reads a twin that is out by status (sending, sent, delivered) with no stamp, and one provider letter id on two rows. Plus a page test: the drawer sends exactly that one letter with mail on, and never offers a letter already mailed. |
| Case drawer 'Mark cleared' | live-check | `fin-b07-case-cleared`. The receipt is matched to THIS case (`payload.inquiryRemovalCaseId` or `payload.caseId`), for that client, not any receipt of the client. A sibling case's receipt no longer covers a case whose own emit was lost. |
| Case drawer 'Send' | live-check | `fin-b07-case-send` + `src/inquiry-ops/send.test.mjs`. Sent attempt must be the case's own bureau and after the request (a sibling bureau's cannot cover it). A case that reads In Progress after a failed mail and never sent is read too. The packet refusal is held by `send.test.mjs` (broken on purpose: gate removed, red). Removing the In Progress update is not held by `send.test.mjs`; the live SQL reads a mailed case that still reads Queued. |
| Expanded row 'Clean personal info' | live-check | `fin-b07-clean-personal` now reads last name, CRM contact id, CRM field bag, tags, and merchant name and raw payload on every transaction. Plus a round trip: the real `eraseClient` over a stand-in, then the live SQL; the owner/admin door; the page button (owner and admin only, asks first, sends this client with the confirmation). |
| Case drawer 'Upload FTC or police report' | live-check | `fin-b07-case-upload`. Starts from either the subtype or `metadata.label.given`, so a file the button sent and the handler filed as "other" is wrong. Plus a page test (sends this case's client, subtype additional_fraud_docs, says "choose file" with no file). |
| Case queue table | live-check | `fin-b07-case-queue`: dead clauses removed (requested_at, client NOT NULL); Items below the open inquiries attached to the case; round of another client; client in another company. Plus page test (nine cells, ready first then oldest first), handler test (each case carries its own client's packet; a failed read gives no verdict) and `src/inquiry-ops/cases.test.mjs` (ORDER BY). |
| Repair queue table | live-check | `fin-b07-repair-queue`: an active repair program with no card on the board is wrong (a paid file nobody can see); program word; rounds. Plus page test (columns, need-me first, most overdue first), `fin-b07-repair-read.test.mjs` and the two older repair read tests. |
| Repair row click/Enter expands | live-check | `fin-b07-repair-row`: letters of another client or another round, a timeline entry of another client's case, client in another company; scope clauses pinned. Plus page test (items, letters, what is next, timeline, Enter) and the repair read tests. |
| Repair stage awaiting_response | live-check | `fin-b07-stage-await-response` judges the file's CURRENT round (R1..R6, then FURNISHER). A round-2 file with an unclosed round-1 case no longer reads red. The closed/cancelled clause is pinned. |
| Work queue table | not-attachable | Taken off. See finding B: the Hold column compares `call_state` to "holding", the database enum spells it "on_hold". The SQL check and the seven working columns are written and tested but not attached. |
| Work row click/Enter expands | live-check | `fin-b07-work-row` + `fin-b07-desk-page.test.mjs` (a real browser: click and Enter expand; the attempt history loads, newest on top; the masked identity line; folds back). |
| Apply dialog (Copy, End session, Close) | live-check + practice test | `fin-b07-apply-dialog.test.mjs`: the REAL `launchProxySession` and `endActiveProxySession` write a stand-in `proxy_sessions` table and the live SQL reads what they wrote; the page's Copy, End session (ends THAT session), Close (ends nothing). |
| Lender row Apply button | live-check + practice test | `fin-b07-lender-apply`: the saved page must be the lender's (or application's) own; an active city session's granted city must hold the requested one; state sessions the right state. Plus the same round trip, `src/proxy/launch.test.mjs`, and a page test that Apply appears only on a client-scoped list and only for a lender with an address. |
| Private leads list page | live-check | `fin-b07-leads-page.mjs`: scripts are read by a small lexer (comments and strings are not code). Sinks: location, open, write, href/src/formAction/ping assignment (except an address made by `URL.createObjectURL`, a file made inside the browser), setAttribute of an address, eval, postMessage, worker, import, ping attribute, formaction, base tag, CSS url(). localStorage must be read AND written in code. The stricter judge could not be run on the real page (it is 404 live and git-excluded, and I may not read the main checkout), so its first live read is the first real test of it: a red naming a sink word means the judge is stricter than the page, not that data left. See finding C: the live page answers 404 today. |
| documents-upload (server) | live-check | `fin-b07-vault-upload`: a document with more than one version, two documents on one stored file, a container that is not a business or was archived before the paper arrived. Plus `fin-b07-vault-upload.test.mjs`: the real handler with a stand-in (one document per file, bytes sniffed, size limit, client pinned, company pinned, business folder checked). |
| link-exchange (server) | live-check + practice test | `fin-b07-link-exchange`: sealed token (four parts, never a bare access token), consent scope not empty. Plus `fin-b07-link-exchange.test.mjs`: the real `completeLink` with Plaid answered by a stand-in that returns THREE accounts; all three are saved, token sealed and bound to the item id, errored link carries a code. |
| link-token (server) | practice-test | `fin-b07-link-token.test.mjs` now also runs the real `startLink` with Plaid's address answered by a stand-in and reads `client_user_id` off the request, end to end from the door for a client, a staff member and a refused role. |
| Search button and Cmd/Ctrl+K | practice-test | `fin-b07-search.test.mjs` (server) + `fin-b07-shell-search.test.mjs` (the real shell.js on a real staff screen: button, Ctrl+K and Cmd+K open and close, Escape and backdrop close, the typed word is what is asked, five groups in order, hit links, "no matches" and "not signed in" copy). |
| Business fields | live-check | `fin-b07-business-fields`: city and state clauses are now pinned; state two capital letters; ZIP five digits (or ZIP+4) as digits; EIN made of digits; incorporated month 01 to 12; age within one month of the months to the saved day, judged BOTH ways. Plus `fin-b07-business-save.test.mjs` (the real parser and saver, then the SQL) and `src/http/soft-pull-approve.test.mjs` (extra owner saved). |

### The not attachable rows, exact

- **A. Page gate, inquiry-remover.html.** The row says setter and closer roles are bounced. Measured through the real
  handlers on 2026-10-15 (stand-in database): `GET /api/read/inquiries` (the Work queue) answers 200 with the client's
  name, bureau and inquiry name to owner, admin, inquiry_specialist, funding_advisor AND closer, setter, csm and
  sales_manager. `GET /api/read/inquiry-cases`, `GET /api/read/repair-cases` and `GET /api/inquiries?recent=letters`
  answer 403 to the last four, as the row says. The page has no role gate of its own; it only says "This queue is for
  staff on this desk." when a door answers 403. Needs a product change: gate `api/read/inquiries.mjs`
  (`roles: ROLE_SETS.STAFF`) to `ROLE_SETS.SPECIALIST_DESK`, or restate the row.
- **B. Work queue table.** The row names a Hold column. `public/app/inquiry-remover.html` line 1756 draws Hold as
  "live" only when `it.call_state === 'holding'`. `inquiry_log.call_state` is the enum `inquiry_call_state`
  (`db/migrations/140_inquiry_ops.sql`), whose spelling is `on_hold`, and `src/inquiry-removal/cases.mjs`
  (`CALL_STATE_TO_ENUM`: holding to on_hold) writes the enum spelling. `api/read/inquiries.mjs` hands the enum
  spelling back. So on real data no line shows a hold, and a row green over that would be a lie about the screen.
  The other seven columns are held by `fin-b07-desk-page.test.mjs` and the stored fields by the unattached
  `fin-b07-work-queue` SQL (kept in `FIN_B07_UNATTACHED_CONTRACTS`, scenario-tested). Needs a product change:
  compare the page to the enum's spelling (`on_hold`).
- **C. Money Banks page gate** (unchanged, still open): see the generation 2 note below.

### Product findings from this cycle (nothing fixed)

1. `api/read/inquiries.mjs` is open to every staff role (finding A).
2. The Hold column cannot light on real data (finding B).
3. **The private leads page is not live.** `GET` of the registry address answered 404 (Netlify, 3356 bytes) on
   2026-10-15 while `https://fundhub.ai/` answered 200. The generation 2 note had warned that a ship from a runner
   without `PRIVATE_LEADS_PAGE_B64` drops it. The row's live check will read red ("the live page is gone"), which is
   correct. The file is on the Mac under `public/leads/`.
4. **The Apply dialog does not scroll and is taller than a laptop screen.** Measured in Chromium with the sample
   proxy string: the dialog box is 1095 pixels tall in a fixed, centered, non-scrolling overlay. On a 900 pixel
   window its End session and Close buttons sit below the fold and cannot be clicked. (The test uses a 2000 pixel
   window for that reason.)
5. `api/soft-pull-approve.mjs` accepts any non-blank ZIP (`!postal`), so "abc" is saved. The live SQL now judges the
   shape (five digits or ZIP+4); a row saved that way reads red the first time.
6. `src/repair/cases.mjs` (`LIST_SQL`) and `src/repair/read-repair-signals.mjs` (`DUE_SQL`) take the queue's Due from
   `MIN(response_due_at)` over EVERY open case, and nothing closes a case, so a file in round 2 shows round 1's
   long-gone due date. The stage check was fixed to judge the current round; the screen still shows the oldest.
7. The expanded repair row's card is titled "Letters this round" but `LETTERS_SQL` returns every round's letters
   (newest 50 by `created_at`, no round filter).
8. `sendCase` (`src/inquiry-ops/send.mjs`) writes the failed-mail attempt, writes no provider id, then sets the case
   In Progress anyway, and the page reads In Progress as "Sent". The Send check now reads that state.
9. The Items column is stale after Send (`ensureCaseInquiries` inserts lines and never refreshes
   `open_inquiry_count`, earlier finding 6). The Case queue check now reads it, so it will be red the first time it
   meets such a case.
10. `evaluateSlaBreach` is still never called and the tasks the stage rows name are never created (earlier
    finding 7). The stage checks judge the clock only.

### How each was broken on purpose and put back

`mutate.mjs` (scratchpad) made one edit to one product file, ran the named test files, and restored the original
text whether or not they failed. `git status` after each batch showed only my own files. R = the tests went red,
G = they stayed green.

| Row | Break (one at a time) | Result |
|---|---|---|
| Work row | loadHistory() never called; loadIdentity() never called; Enter no longer expands | R R R |
| Work queue columns (held, not attached) | Client always "(unnamed client)"; Bureau blank; Actual shows expected name | R R R |
| Case queue | Items from another field; Round always a dash; no oldest-first sort; Docs fixed; Delivery empty; Call fixed | R R R R R R |
| Case queue (server) | packet from the wrong client; failed read coerced to "not complete"; newest first; company dropped from the list; signature consent ignored; role gate widened to closer | R R R R R R |
| Repair queue (page) | need-me no longer first; most overdue no longer first; Program shows round; Due fixed | R R R R |
| Repair queue (server) | need-me stages emptied; order flipped; latest instead of oldest; company dropped; optimization board filter dropped; due from MAX; need_me flag always false | R R R R R R R |
| Repair row (page) | Enter no longer expands; letters cut to one; timeline not drawn; what is next not drawn; items not drawn | R R R R R |
| Repair row (server) | items read loses the company; letters cut to one; letters read loses the client; letter words shown for a sent letter; items never returned; timeline never returned | R R R R R R |
| Upload button | wrong subtype; no client sent; sends with no file chosen; never says attached | R R R R |
| Clean personal info (erasure) | last name left; CRM contact id left; CRM field bag left; tags left; email left; merchant name left; raw payload left; identity row not deleted; bank login not deleted; company dropped; kept data deleted | R x 11 |
| Clean personal info (door) | closer allowed; role gate removed; inquiry_specialist allowed | R R R (the older handler test did not catch the third; the door test in `fin-b07-clean-personal.test.mjs` does) |
| Clean personal info (button) | shown to every role; sends without asking; no confirmation id; another client | R R R R |
| Send | packet gate removed; short packet never marks Blocked; portal for any bureau; portal with no reference | R R R R |
| Apply and dialog | launch saves another bank's page; citiesMatch always true; statesMatch always true; End session stops writing ended_at; End session never takes effect; any staff may end; Apply with no client; Apply for the wrong lender; Copy copies nothing; End session posts no id; Close also ends; End session button does not end | R x 12 |
| Letter buttons | drawer sends the letter twice; mail flag off; wrong client; enabled for a sent letter; row Send includes a sent letter; Stage also mails | R x 6 |
| Search | shortcut key changed; button does nothing; read address changed; group order changed; Escape no longer closes; refused read drawn as no matches | R x 6 |
| Vault upload | no per-file key; bytes not sniffed; declared type stored; client names another client; staff company check dropped; business folder not checked; size limit ignored | R x 7 |
| Business fields (save) | city, state, ZIP, street, EIN, incorporated month no longer required; extra owner dropped; extra owner never parsed; age not saved; incorporated date not saved; state saved lower case; EIN saved without dash; delete takes another form's rows | R x 13 |

SQL and scenario breaks are made inside the test (`fin-b07-case-runner.mjs`): every wrong-result case reads clean
once its named clause is switched off, and every scope clause (60 day window, closed and cancelled, demo, company)
is pinned by a case that must not be counted until that clause is switched off.

### Files

New: `src/pulse/catalog/proofs/` `fin-b07-desk-page-kit.mjs`, `fin-b07-desk-page.test.mjs`,
`fin-b07-desk-buttons.test.mjs`, `fin-b07-case-queue-read.test.mjs`, `fin-b07-repair-read.test.mjs`,
`fin-b07-clean-personal.test.mjs`, `fin-b07-apply-dialog.test.mjs`, `fin-b07-link-exchange.test.mjs`,
`fin-b07-vault-upload.test.mjs`, `fin-b07-shell-search.test.mjs`, `fin-b07-business-save.test.mjs`,
`fin-b07-live-cases-work.test.mjs` (the work-side scenarios split out of `fin-b07-live-cases-desk.test.mjs`).

Changed (mine): the four SQL text files, `fin-b07-sql-kit.mjs` (adds `translate`, column defaults, a Postgres-shaped
`pg()` handle over the stand-in, `rows()`), `fin-b07-case-runner.mjs` (adds the `ignored` scope case),
`fin-b07-display-contracts.mjs`, the three scenario files, `fin-b07-live-contracts.test.mjs`,
`fin-b07-link-token.test.mjs`, `src/pulse/coverage/fin-b07-leads-page.mjs` and its test.

Shared lines touched (the integrator must merge these):

| File | Change |
|---|---|
| `src/pulse/coverage/gap-catalog-display.test.mjs` | the deep-control count 80 to 79 (the Work queue contract came off), PASS-capable 67 to 66, SQL batches 67 to 66, lane PASS 68 to 67, bundle case count 80 to 79; and the stand-in leads page now says `setItem` and `getItem` (the stricter judge requires both). Sum with the other batches: take -1 contract and -1 PASS. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | display red count 631 to 632 (+1: the Page gate row is unmapped again). The Work queue row keeps the staff file's case and is not in the red count. |
| `src/pulse/catalog/generated.json` | recompiled. Recompile after merging; do not hand-merge. |

`display-saved-result.mjs`, `display-proof-cases.mjs` and `compile-catalog.mjs` are unchanged this cycle.

### Commands run (this cycle)

Measured on this Mac while other builders ran browser suites at the same time (load average 16 to 25).

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` before this cycle | 808 open in all |
| `npm run pulse:catalog`, then `node scripts/pulse/count-not-proved.mjs` | 810 open in all (the two rows taken off). Of the twenty ids, 18 are no longer open and 2 are (`Page gate`, `Work queue table`) |
| `node scripts/pulse/compile-catalog.mjs --check` | exit 0, 3975 mapped, catalog current |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs src/pulse/na-conditions.test.mjs src/lib/no-unfenced-transmit.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/coverage/fin-b07-leads-page.test.mjs src/pulse/catalog/proofs/fin-b07-*.test.mjs` | 574 tests, 574 pass, 0 fail, 0 skipped, 25 seconds |
| `npm run lint` | 3589 files and inline scripts parse clean |
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the full file: runs every executable test named by every case, including the new Chromium files and the staff browser specs) | 2 of 3 pass. The third ran 2385 tests, 2384 pass. The one failure is `e2e/teleprompter-take-flow.spec.mjs:1419` (recording still paints and rolls on a browser without video-frame callbacks): not a file this batch touches. It passes alone (`E2E_PORT=47123 node node_modules/@playwright/test/cli.js test e2e/teleprompter-take-flow.spec.mjs:1419`, 1 passed, 9.5 s), so it is a load flake of the 380 spec browser run (7.9 minutes). 8 minutes 2 seconds in all |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | 2 of 2 pass (red count 632) |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass (79 contracts, 66 SQL batches, lane PASS 67, 12 always-red) |
| every break in "How each was broken" above | each run before and after on the same files; the original text was restored every time (`git status` clean for `public/` and the product `src/` files) |
| one live GET of the leads page address (read only, only the status printed) | 404 (not live), see finding 3 |
| the four real handlers called as eight staff roles on the stand-in database (read only) | the Work queue read answered 200 to closer, setter, csm and sales_manager, with the client's name |

Notes for a reviewer:

- Every live check is `emptyAs: "quiet"`, so a control nobody used reads green with "no saved results yet" and goes red on the first wrong one.
- **First-run reds are expected and real** the first time the lane meets rows like these in the last 60 days: a case whose Items count is stale after Send (finding 9), a failed mail left In Progress (finding 8), a ZIP that is not a ZIP (finding 5), the leads page (finding 3).
- The Postgres statements were not run on Postgres (there is none on this Mac and the brief forbids the live database). They are the common subset of Postgres and SQLite, plus `translate()` (the stand-in defines it) and a `VALUES` list; every table and column is checked against `db/schema` and `db/migrations` by `fin-b07-live-contracts.test.mjs`. A Postgres-only mistake would show as `skip` ("was not read") on the morning report, never as a false PASS.
- The two older not-proved facts still stand: the Banks page gate is open (generation 2, finding 5) and the Work queue and Page gate rows are open now.


---

# Generations 1 and 2 (the record before repair cycle 1)

## Generation 2: what changed

Both leftover rows were challenged by reading the real page, the real handler and the real registry.

- **Leads list page: no longer "not attachable". Now a live check.** Generation 1 said no checkout can read the
  file because git excludes it. That is true of the file, but the page is live and the registry already names its
  address (`SHIPPED_OUTSIDE_GIT` and the `public_static` row in `src/pulse/registry.mjs`; the morning pulse pings
  it). So the lane GETs the live page once and judges five promises of the row: it opens, it says noindex, its
  columns are Name, Number, Follow up date, Response, Status, nothing in it can send data out, and edits are kept
  in the browser (localStorage). It goes red when any of these breaks, and red when the page is gone. It never
  returns anything the page holds. Measured live on 2026-10-14: the real page PASSES all five (one GET, about 1
  second). Details in "The leads page read" below.
- **Banks page gate: the reason stands, and is now measured, not just read.** See "Not attachable".

Open for this batch: 2 before generation 2, 1 after. Whole count 809 to 808.

## The number

| | Rows |
|---|---|
| Rows in this batch | 46 |
| Open (NOT_PROVED) before generation 1 | 46 |
| Open at the start of generation 2 | 2 |
| Open after | 1 |
| Live checks (saved-result SQL, 40; live page read, 1) | 41 |
| Practice tests | 4 |
| Not attachable (exact reason below) | 1 |

Measured with `node scripts/pulse/count-not-proved.mjs` and the batch file: the four lanes, offline, stub fetch. The whole count went 853 to 808 on this branch (45 fewer, all in `gap-catalog-display`).

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
| page:leads/<32-hex>/index.ht — Private leads list page (noindex, secret folder name): a local table with Name, Number, Fo | live-check | fin-b07-leads-page.mjs, run by the display lane: one GET of the live page (address from the registry). PASS only if it opens, says noindex, has the five columns in order, holds no way to send data out, and keeps edits in localStorage. Red when any breaks or the page is gone; skip when the read fails. Judge tested in fin-b07-leads-page.test.mjs. |

## The leads page read (generation 2)

Why it is a live check and not a practice test: the file is git-excluded (it holds real names and numbers), so a
test of the file can never run on a checkout. The page that matters is the one the server hands out, and that
can be read every morning.

- **Address.** `leadsPagePath()` takes it from the one `public_static` registry row whose file starts with
  `leads/`. If the registry has no row or two rows, the check is `skip` with that reason. The folder name is not
  copied into any new tracked file (it is already in `src/pulse/registry.mjs`).
- **Read.** One GET, no body, redirects not followed, 5 second limit, `ctx.fetchImpl` and `ctx.baseUrl` the same
  way the retired-page read uses them. The GET sits in `gap-catalog-display.mjs`, which is already on the reviewed
  read-only list in `src/lib/no-unfenced-transmit.test.mjs`, so that list was not edited. The new file has no
  network call of its own.
- **Judge.** `judgeLeadsHtml()` is pure. Five promises, each named in plain words in the detail line.
  "Nothing can send data out" means none of these is present: fetch, XMLHttpRequest, sendBeacon, WebSocket,
  EventSource, run-time import, `new Image`, a script-set `src`, a script-created script/img/iframe/link/form tag,
  a form, a frame/embed/object, a script file, a file loaded from another address, a meta refresh. A same-address
  file, a data image, a plain link and a `tel:` link are not a send. HTML comments are ignored.
- **Statuses.** 200 and all five hold: PASS. 200 and one breaks: FAIL, naming which. 404 or 410: FAIL (gone). 3xx:
  FAIL (the page moved). 401, 403, 429, 5xx, no answer, no GET client, bad base address, no single registry row:
  skip with the reason. A read that failed is never green.
- **Privacy.** The page text is judged and thrown away. No detail line or fix line repeats anything it holds
  (a test plants a marker word in the stand-in page and asserts it never comes back).
- **Measured live, 2026-10-14**, read only, only the shape printed: the real page answers 200, has
  `noindex,nofollow,noarchive` in its robots tag, one table with the five headings in order, one inline script,
  no outside address, none of the send patterns, and `localStorage` twice. The judge says PASS.

The contract is a new mode, `live-page`, next to `query` and `always-red`, in the same registry
(`FIN_B07_PAGE_CONTRACTS`). It has no SQL. The lane judges it before any database work, so it also runs when a
run has no database.

## How a live check works here (so a reviewer can challenge it)

Each live check is one read-only SQL text (in `fin-b07-sql-desk.mjs`, `fin-b07-sql-repair.mjs`, `fin-b07-sql-misc.mjs`, listed by `fin-b07-display-contracts.mjs`). It takes the company as `$1::uuid` and answers `sample_count` and `bad_count`. All 40 are `emptyAs: "quiet"`: a control nobody used in the window reads green with the words "no saved results yet", and goes red on the first wrong one.

- Windows: 60 days on `updated_at` / `created_at` / `started_at` (30 days for letters, which carry the mailing stamps only since 2026-09-05; 400 days for erasures). Demo rows are never judged.
- The SQL is in the common subset of Postgres and SQLite (no regexes, no arrays, no `DISTINCT ON`), so the test can run the exact text. Where Postgres would raise on a bad cast, the cast sits under a `CASE` guard.
- The test kit reads the real table and column names from `db/schema` + `db/migrations` (`fin-b07-sql-kit.mjs`). A stand-in table can only hold real columns, and `fin-b07-live-contracts.test.mjs` checks every `alias.column` in every contract against that schema.
- Every scenario (`fin-b07-case-runner.mjs`) does four things: a right result is counted and none is wrong; no rows reads 0 of 0; one wrong row is counted as exactly the expected number wrong; and the same SQL with the named clause switched off reads that wrong row clean. That last step is the "break it on purpose, see it red, put it back" step, done inside the test for every wrong-result case (145 cases across the 40 checks). Another company's wrong row is never counted.
- File-level breaks, by hand, restored with `git checkout`: closed-stamp clause dropped from the Canceled check (red), in_transit ten-day clock removed (red), Plaid "saved no account" clause removed (red).

### The leads page judge, broken on purpose (generation 2)

Each break was made alone in the judge or the lane, the two test files run, then the file put back from a copy.
Every break turned the tests red.

| Break | Result |
|---|---|
| noindex check always true | red (4) |
| column check always true | red (3) |
| send check always true | red (2) |
| localStorage check always true | red (3) |
| 404 or 410 not red | red (2) |
| redirect not red | red (2) |
| a non-200 answer judged as a page | red (2) |
| lane stops routing live-page rows (no database, and with a database) | red (13, and 1) |
| lane sends POST instead of GET | red (2) |
| lane follows redirects | red (2) |
| lane drops the 5 second limit | red (1) |
| lane ignores the X-Robots-Tag header | red (1) |
| fetch pattern, meta refresh pattern, comment stripping, robots tag matched anywhere, outside-address pattern removed (first round, judge only) | red (1 to 2 each) |

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
- `src/pulse/catalog/proofs/fin-b07-sql-desk.mjs`, `fin-b07-sql-repair.mjs`, `fin-b07-sql-misc.mjs` (the SQL texts, 252 / 139 / 128 lines)
- `src/pulse/catalog/proofs/fin-b07-sql-kit.mjs`, `fin-b07-case-runner.mjs` (test kit)
- `src/pulse/catalog/proofs/fin-b07-live-contracts.test.mjs` (shape guard: 8 tests)
- `src/pulse/catalog/proofs/fin-b07-live-cases-desk.test.mjs` (111 tests), `fin-b07-live-cases-repair.test.mjs` (90), `fin-b07-live-cases-misc.test.mjs` (64)
- `src/pulse/catalog/proofs/fin-b07-page-gates.test.mjs` (5), `fin-b07-link-token.test.mjs` (10), `fin-b07-search.test.mjs` (6)
- generation 2: `src/pulse/coverage/fin-b07-leads-page.mjs` (address lookup, judge, no network call) and
  `src/pulse/coverage/fin-b07-leads-page.test.mjs` (16 practice tests of the judge and of the lane wiring)
- this manifest

## Shared lines I touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | import of `FIN_B07_RESULT_CONTRACTS` at the top; `...FIN_B07_RESULT_CONTRACTS,` at the end of `DISPLAY_RESULT_CONTRACTS`; **one existing line removed**: the always-red `gap("Business fields: name, street, ...")` (my live contract replaces it; two contracts for one control throws "must be unique") |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | one import line, one `...FIN_B07_DISPLAY_CASES,` line at the end of `PLUGIN_DISPLAY_PROOF_CASES` |
| `scripts/pulse/compile-catalog.mjs` | one import line; `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B07_LIVE_CASES]` |
| `src/pulse/catalog/generated.json` | recompiled. Recompile after merging; do not hand-merge |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | 40 to 79 contracts (+40 mine, -1 removed gap), pass-capable 27 to 67, unmeasured 13 to 12, SQL batches 27 to 67, shipped-bundle cases 40 to 79. Sum the other batches' changes and take the number the test prints |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 631 (-41 here: 40 in generation 1, 1 in generation 2) |
| `src/pulse/catalog/proofs/display-saved-result.mjs` (generation 2) | import now `{ FIN_B07_PAGE_CONTRACTS, FIN_B07_RESULT_CONTRACTS }` and one added line `...FIN_B07_PAGE_CONTRACTS,` after `...FIN_B07_RESULT_CONTRACTS,` |
| `src/pulse/coverage/gap-catalog-display.mjs` (generation 2) | one import (`LIVE_PAGE_JUDGES`), one export (`LIVE_PAGE_CONTRACT_COUNT`), a 4 line `live-page` branch in `judgeDisplayResult` (returns skip when called bare), a new `livePageRow()` helper above `gapChecks`, a pre-pass in `gapChecks` and two `pages.has(entry.id)` lines in its two returns |
| `src/pulse/coverage/gap-catalog-display.test.mjs` (generation 2) | 79 to 80 contracts, 3 modes (query 67, always-red 12, live-page 1), PASS count 67 to 68 in the lane test, bundle test 79 to 80; the stand-in GET client answers the leads address with a page that keeps its promises (`LEADS_PAGE`). When summing with other batches: take +1 contract and +1 PASS |
| `src/pulse/catalog/proofs/fin-b07-live-contracts.test.mjs` (mine) | counts for 40 + 1 + 4 + 1 |

Five of my rows (work queue table, work row, Mark confirmed, repair row, business fields) are already deep cases in `display-batch-staff-ui.mjs`. They are not repeated in `FIN_B07_LIVE_CASES`: the contract alone turns them live. `fin-b07-live-contracts.test.mjs` keeps `FIN_B07_ALREADY_DEEP` equal to the staff file.

## Product findings (nothing fixed)

Generation 2 added none. The leads page passes every promise the row makes. One note: it is shipped from outside
git (the Mac's `public/leads/` folder, or the `PRIVATE_LEADS_PAGE_B64` secret in `ship.yml`), so a ship from a
runner that lacks the secret would drop it; the new check would go red with "the live page is gone" in that case.

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
  Generation 2 re-read the page and the server and then measured it: with the real `money-banks.js` loaded in a
  stand-in window whose stored role is `client` and whose address holds `?client_id=<uuid>`, the page asks
  `/api/money/banks?client_id=<uuid>` and paints 5 staff forms ("Staff only" blocks) on the sample file; with no
  `client_id` it paints none. The real server (`api/money/banks.mjs`, `scope()`) answers a client session with
  its own file and never reads the address, so the page gets a 200 and shows the controls. A save would be
  refused 403 ("Only Fundhub staff can change the bank plan."), so no data is at risk, but the row's words "only
  staff see plan controls" are false of the page. The page's own header comment says "a client never does". A
  live check could only read the page script and would be red forever; that is the always-red gap this row
  already is. The fix is one product change: draw the staff forms by role, not by address.
  **Challenged a second time (generation 2 re-run after the Mac restart), same answer.** Read `public/app/money-banks.js`
  (`mount()` line 444 `var staff = !!clientId`; `initPage()` takes `clientId` from `param("client_id")`),
  `public/app/money-banks.html` (no `shell.js`, no role script: the page says "The gate is the endpoint") and
  `api/money/banks.mjs` (`scope()` pins a client to its own file and never reads the query). Then measured it in
  Chromium with the real page and script through the S4 harness (stand-in server, banks sample file, `can_set_date`
  true): client with no address paints 0 staff blocks and 0 forms; client with `?client_id=<uuid>` typed paints
  6 staff blocks and 6 forms; staff with the address paints 6 and 6. The existing S4 test
  `s4-money-banks.test.mjs` "the page gate" is green and proves the first and third lines (a client who opens
  the page the normal way sees none; staff see them; staff with no client are told so), but it never types the
  address as a client, and the row says "only staff". Attaching it would paint the row green over the second line.
  S4 left the row open on purpose for the same reason (S4 manifest, finding 7). Nothing here changed in the
  product or in the registry.
- Leads list page: no longer in this list. See "The leads page read".

## Risks for the integrator

- **Generation 2, the leads page read.** It adds one GET (5 second limit) to the display lane, before the SQL
  statements. It reads a page that holds private names and numbers: the body is judged in memory and never
  returned or logged, and the pulse already pings the same address every morning. The first live run is a real
  PASS (measured today). It goes red if the page is gone (a ship from a runner without `PRIVATE_LEADS_PAGE_B64`),
  loses noindex or a column, gains a way to send data out, or stops using localStorage. It reads `skip`, never
  green, when the read fails. Its source is a tiny new mode (`live-page`) on the existing contract registry:
  anyone summing guard numbers across batches takes +1 contract and +1 PASS in `gap-catalog-display.test.mjs`.

- **First-run reds are expected, and real.** Findings 1, 2 and 3 will show as reds the first time the lane reads live data, if such rows exist in the last 60 days. That is the point of the check; nobody should read them as a regression of this batch.
- **Not run against live data.** No database access was used (brief). The 40 SQL texts were run only on stand-in rows in SQLite. They were written with Postgres types in mind (casts under `CASE`, `::text` on uuids, `bytea` only through `length()`), and every table and column was checked against the migrations. A Postgres-only mistake would show as a `skip` ("was not read") on the morning report, not as a false PASS.
- **Lane time.** 40 more statements run one after another in the display lane. Each is a count over a windowed table; none was timed against production.
- `display-proof-cases.test.mjs` "the focused proof test runs every executable test named by every case" now also runs 7 more files (three scenario files, the shape guard, and three practice files, one of them in Chromium through the S4 harness and its queue).

## Commands run (generation 2 first, then generation 1)

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` and the batch-07 intersection, before compile | 809 open in all, 2 of the 46 batch rows open |
| `npm run pulse:catalog`, then the same count | 808 open in all, 1 of the 46 open (the Banks page gate) |
| `node scripts/pulse/compile-catalog.mjs --check` | catalog current |
| one real GET of the live leads page through `gapChecks({})` (read only; only status and the five promises printed) | PASS, 1.1 seconds |
| `node --test src/pulse/coverage/fin-b07-leads-page.test.mjs` | 16 of 16 pass |
| the judge and lane broken on purpose, 25 breaks, one at a time (tables above) | every one red; files restored; `git status` shows only intended changes |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs src/lib/no-unfenced-transmit.test.mjs` | pass (the fence test first failed on the new file because it had its own GET; the GET moved into the lane, which is already on the reviewed list) |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs src/pulse/na-conditions.test.mjs src/lib/no-unfenced-transmit.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/coverage/fin-b07-leads-page.test.mjs src/pulse/catalog/proofs/fin-b07-*.test.mjs` (all but the long focused proof test) | 437 tests, 437 pass, 0 fail, 0 skipped |
| `node --test --test-name-pattern="every display proof case names\|unmapped display rows" src/pulse/catalog/proofs/display-proof-cases.test.mjs` | 2 of 2 pass (red count 631) |
| `npm run lint` | 3577 files and inline scripts parse clean |
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the full file: runs every executable test named by every case, including the new leads page test and the Chromium files) | 3 of 3 pass, 9 minutes 4 seconds, load average about 40 |
| Re-run after the restart: `node scripts/pulse/count-not-proved.mjs` and the batch-07 intersection | 808 open in all, 1 of the 46 open (the Banks page gate) before and after; nothing to compile |
| Re-run: `node scripts/pulse/compile-catalog.mjs --check` | 3975 mapped, catalog current, `git status` clean |
| Re-run: the 437 test command above | 437 tests, 437 pass, 0 fail, 0 skipped |
| Re-run: `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` | 3 of 3 pass, 7 minutes 47 seconds |
| Re-run: one scratch Chromium measure of the Banks page (real `money-banks.html` + `money-banks.js`, S4 harness; the script is not kept) | client no address 0 / 0, client typed address 6 / 6, staff with address 6 / 6 (staff blocks / forms) |

Generation 1 commands:

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
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (the full file, which runs every executable test named by every case, including my seven files) | 3 of 3 pass, about 11 minutes, started before the SQL files were split (the SQL text did not change, `compile-catalog.mjs --check` still says current) |
| the seven `fin-b07-*.test.mjs` files together, 10 runs in a row | 294 of 294 pass, 10 of 10 runs (includes the Chromium file) |
| `node --test src/pulse/catalog/*.test.mjs src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs src/pulse/na-conditions.test.mjs src/lib/no-unfenced-transmit.test.mjs` (after the last commit) | 122 tests, 122 pass |

