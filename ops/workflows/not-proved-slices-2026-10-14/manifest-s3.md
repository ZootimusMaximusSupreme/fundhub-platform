# Slice 3 manifest: customer-data routes and page reads

Branch: `prf/s3-data-routes` (local only, nothing pushed). Builder S3 of 5.
This file was updated a second time, after a second checker broke the product on purpose
and found proofs that stayed green.

## The short answer

- Rows in my slice: 131 (104 routes, 27 page reads).
- Not proved at the start of this repair: **52** (37 routes, 15 reads). Measured by running the four lanes offline.
- Not proved now: **52** (37 routes, 15 reads). Measured the same way. No row had to go back to "not proved":
  every weak proof I found could be made strong.
- Rows proved: 67 routes and 12 page reads (79 rows).
- The six breaks the checker named (seven rows) now go red. Each one was broken by hand again and the files were put back.
- I scanned the other proofs for the same weakness by making small breaks in the product and running the attached
  tests (see "How I scanned"). Of the 677 different breaks that sit on lines the tests run, 193 went red right
  after the six named fixes and 484 stayed green. Now 616 go red and 61 stay green. None of the 61 is inside the
  words of a row (see "Left").

## The six weak proofs the checker found, and what I did

| # | Row | The break that stayed green | What I did | Now |
|---|---|---|---|---|
| 1 | `read/inbox` | `ASC` for `DESC`, `needs_reply` computed as `'outbound'`, the `?needs_reply` filter inverted | The test now pins the words of each clause in the statement it sent (page order, final order, last message, `needs_reply`, the needs-reply filter, the company join). It also checks the five spellings of `?needs_reply` bind true or false. | red |
| 2 | `merchant/events` (2 rows) | `ON CONFLICT ... DO NOTHING` removed in `recordEvents` | The stand-in database used to throw repeats away by itself. It now refuses a repeat with the Postgres error (`23505`) unless the statement says `ON CONFLICT (connection_id, provider_event_id) DO NOTHING`. Also pinned: bad events listed by place, the key stored as sha256 only, each good event stored once on the connection the key names, the euro sale counted apart. | red |
| 3 | `bookings` GET | `b.client_id` and `b.status` filters dropped | The stand-in now holds this client's booked call, the same client's cancelled call, another client's call and another company's call, and answers by the conditions the SQL names. All four filter combinations are checked. | red |
| 4 | `money/vault` | `readVault` returning `reason: null` | After a reject, the answer to staff and the client's own read both must carry the reason and the rejected status. The reason's column, the upsert that replaces it and the read that selects it are pinned. | red |
| 5 | `read/entitlements` | company condition turned into `$5::uuid IS NOT NULL` | The stand-in now understands `($4::boolean OR org_id = $5::uuid)` and holds two clients of this company and one client of another. Staff see their own company only, a staff session with no company reads nothing, a client reads only their own file. | red |
| 6 | `read/bank-inbox` | `amount_candidates` column dropped | The test pins the column, the found-count column, the received time, the order, and the company and client conditions. The stand-in holds another client's mail and another company's mail. | red |

## Earlier repair (kept): the first checker's six findings

| # | The break that stayed green | What I did | Now |
|---|---|---|---|
| 1 | Role gate removed in `api/money/plan.mjs` | The plan test now logs in as each role. Owner, admin, sales manager and closer get through. Setter, csm, funding advisor and inquiry specialist get a 403 before any lookup. | red |
| 2 | Same gate removed in `api/money/vault.mjs` and `api/money/ready-to-fund.mjs` | Same role table in both files. | red |
| 3 | Both company checks removed in ready-to-fund | The stand-in used to answer by a flag. Now it holds a real `clients` table and answers by the id and company the SQL names. The door check and the logic check are each proved alone (a spy proves the door stops it before the logic runs). Both removed goes red. | red |
| 4 | Push unsubscribe `all:true` lost its `client_id` | The stand-in now holds two clients' phones, plus another client's phone with the same endpoint. The test checks which rows were retired, and the SQL text. | red |
| 5 | Waypoint tick lost its `client_id` | The stand-in holds two clients' steps with the same key. The test sends the other client's step id and checks the answer is 404 and nothing changed. | red |
| 6 | Agent promotion gate numbers broken | The browser test now types 59 and 60 characters, 19 and 20 characters, clears the escalation person, and opens a draft with no trigger. | red |

Each one was broken again by hand after the fix and went red. The files were put back with the original text.

### What I found when I scanned my own proofs for the same weakness

The checker named four kinds of weakness. I looked for each across all my proofs.

1. **Role gate tried only with allowed roles.** New file `src/http/s3-role-gates.test.mjs`: 43 doors in one table (62 tests: one per door, plus a client-login test on 19 staff-only doors).
   Each door gets one real login per role. Allowed roles pass the gate. Other roles are refused with a 403
   before the handler reads the database. Doors that say "staff only" are also tried with a client login.
2. **Company check decided by a stand-in flag.** New file `src/http/s3-company-boundary.test.mjs`: 31 doors in one table.
   The client sits in another company. The handler may run only the login check and one `clients` lookup,
   then must answer 404 or 403. A control run with the client in the caller's company must get further.
   Also made honest: container rename, document download, cross-company case ids on the inquiry desk,
   bank-todo moves, reminder acknowledge, bank-login disconnect, bank account classify and close,
   bureau answer confirm, authorized rep remove, and the privacy erasure (new file
   `src/http/s3-privacy-erasure-handler.test.mjs`: three clients' rows, only the named one is erased).
3. **Params asserted but not the SQL condition.** Where the stand-in could not judge the SQL, the test now
   also asserts the WHERE text (push unsubscribe, waypoint tick, authorized rep, erasure).
4. **A compound row bound to a test that covers only half.** I used test coverage to list handler lines no
   attached test runs. Soft-pull `GET` history had no test: added. Three rows were half covered and I took them back.

I also added one test the checker listed as a note: a blank amount on a hand-entered account is stored as
NULL (unknown), never 0.

## How I scanned the other proofs for the same weakness

I did not read them by eye only. I made small breaks in the product SQL and ran each handler's attached tests.

- 1,373 breaks were made in the 54 handler files and the store files they use (1,092 different ones, because
  several handlers share a store file): flip `DESC` and `ASC`, turn `col = $N` into `$N IS NOT NULL`, drop a
  condition line, change a status word, drop a column, drop `ON CONFLICT`.
- 1,192 were run offline. 677 different ones sit on lines the attached tests really run. The rest sit on lines no
  attached test runs (other actions, other doors, fallbacks).
- Right after the six named fixes, 193 of the 677 went red and 484 stayed green. That is the weakness.
- Most of the 484 were one kind: the stand-in answered by table name and the test only checked the bound values,
  so a lost `org_id =` or `client_id =` condition was still "bound" and nothing noticed.
- I fixed, measured again, fixed, and measured again, six rounds. Last measure: 616 red, 61 green.

What I changed, in order of how much it killed:

1. **The stand-in databases now refuse what Postgres refuses.** `bindProblem` in `src/testing/s3-scoped-rows.mjs`:
   a value the call supplies but the statement never uses, and a value used only in an `IS NULL` test, are both
   protocol errors. `strictFakeDb` (in `src/testing/s3-handler-call.mjs`), `callShared`, the task stand-in, the
   merchant stand-in and every inline stand-in of an attached older test run it. A handler that loses a condition
   now fails the way a real database would. This alone turned most of the 605 red.
2. **`assertSqlHas` pins the words of a clause** where the stand-in cannot run it (ordering, a status word, a
   select-list column, `ON CONFLICT`, the join that holds a company boundary). It ignores comments and spacing.
3. **Stand-ins that did the product's job were made honest.** The merchant stand-in dropped repeats on its own
   (item 2 above). The task stand-in held the unique keys itself: it now refuses a repeat unless the statement
   says `ON CONFLICT DO NOTHING`, and it has a `race` mode where the pre-check sees nothing, so only that clause
   stands between two presses and two tasks. The ready-to-fund and ask-for-a-person rows each have that test now.
4. **Rows that were only canned rows now use real rows:** bookings, entitlements, bank inbox, ad attribution,
   push list, push unsubscribe (with switched-off and expired devices), the unsubscribe-link lookup.
5. **New cases found on the way:** a product or task of another company on a customer interview, a device
   another client of the company registered, the soft-pull open-request lookup, the erasure writes (what each
   statement empties), the repair letter claim and release, the cashflow, bills, money-map, liabilities,
   transactions, underwrite, containers, banking-accounts, revoke, closer-deck, repair-queue, inquiry-case,
   partner-apply and welcome statements.

The six rows the earlier manifest said it did not close (`read/money-map`, `read/transactions`, `finance/cashflow`
GET, `finance/bills` GET, `finance/liabilities` GET, `finance/bank-accounts` GET) are closed now. Each has its
statements pinned and the stand-in refuses a lost condition.

### Left (honest list)

After the last measured round, 61 different breaks still stay green. None of them is inside the words of a row:

- `money/payments` (21, in `money-overview.mjs`): the money overview reads that the same test file runs for the
  alerts page. The row says "ask_for_person". No attached test names the overview.
- `money/banks` (18, in `bank-strategy.mjs`): the bank-plan reads. The five POST actions in the row do not run them.
  They belong to the GET plan, which is another row.
- `inquiry-cases` and `repair/send` (11, in `inquiry-ops/call-scheduler.mjs`, `send.mjs` and `cases.mjs`): the call
  scheduler, the send path and the list order of open cases. The send rows were taken back already.
- `read/repair-cases` (4, in `repair/cases.mjs`): a fallback letters statement that only runs when a column is
  missing, and two list orders. No test makes the column go missing.
- `blueprint/staff-actions` (2, `next-sequence-plan.mjs`): the candidate list the next-funding-sequence alert uses.
- `read/finance-os-suggestions` (2, `underwrite/letter-pack.mjs`): the business read the letter pack makes.
- One list order each: `privacy/erasure` history, `finance/business-info` save lookup.
- `read/inbox` (1): a word inside a SQL comment. That is not code.

If a later checker names one of these in a row, the fix is one `assertSqlHas` line.

## What "proved" means here

A row leaves "not proved" only when a test calls the real `api/` handler (or opens the real page) with fake data and
a stand-in database, and judges the exact result: the answer given, and which company and client each statement is
bound to. The stand-in refuses a statement Postgres would refuse. No live database, no vendor call, no text,
no email, no charge.

A canned answer that only proves the answer was used is not a proof. A test that asserts bound values but not the
condition they were bound to is not a proof either. Both were the cause of this round.

## Rows I took back earlier (still red, still on the monitor)

| Row | Why no honest test is possible today |
|---|---|
| `public/climate-match` (0afa1181d191c2bd75c2) | The existing test never runs the handler's POST success path. It uses the shared database and a lender cache, so a safe stand-in is a bigger build. |
| `inquiry-cases` send (4bf572fddb1ef89eff8c) | The mailing itself calls the mail provider and cannot be handed a stand-in from the handler. |
| `inquiry-cases (send)` (af74d4321e47c5c9eddc) | Same reason. |
| `inquiry-cases (clear_inquiry)` (72fad5cb5f5f84a3aa0f) | The row says "org from the session". The product does not do that for this action. See product finding 5. |

## Product findings (the product is wrong; nothing fixed)

1. **`POST /api/soft-pull-approve` with `action=stamp_incorporated` crashes.** `stampIncorporatedAsStaff` is called at
   `api/soft-pull-approve.mjs:279` but is never defined or imported. The Present screen calls it
   (`public/app/present.js:1610`), so that button gets a server error.
2. **`/api/pii` has no company check.** It looks a person up by `client_id` only. A signed-in owner, admin, funding
   advisor or inquiry specialist of one company who knows another company's client id can read that person's
   identity and reveal the full Social Security number. `store` can also overwrite it.
3. **`/api/partner-brand` has no company check.** An admin of company A who knows a partner id of company B can read
   and change B's brand.
4. Wording only: the authorized-rep removal row says "ends their sessions". The code moves the rep's session to their
   next file or to none. It does not revoke the session row. I proved what it really does.
5. **`POST /api/inquiry-cases` with `action=clear_inquiry` has no company check.** `api/inquiry-cases.mjs` hands
   only the inquiry id and the staff id to `clearInquiry` (`src/inquiry-removal/cases.mjs:404`). That function reads
   `inquiry_log WHERE id = $1` and updates by id, with no company in either statement. Staff of company A who know
   an inquiry id of company B can clear it, complete B's case, and the `inquiry.removed` event goes out stamped with
   company A and B's client. Every other action on that door is scoped by company; I proved that.
6. **Small:** `update_bank_todo_state` is scoped by company but not by client. A staff member of the same company can
   move a todo that belongs to a different client of that company.
7. **Small:** `claimLetterForMailing` in `src/repair/send.mjs` answers "claimed" when the letter id is not found for
   this company and client, so the mailing goes ahead and the mailed stamp then updates nothing. Another company's
   letter row is never touched.
8. **New, small:** three reads take no company in their own SQL and rely on the handler checking the client first:
   `crs_results WHERE client_id = $1` (finance-os-suggestions), `card_liabilities WHERE client_id = $1`
   (liabilities positions), `soft_pull_requests WHERE client_id = $1` (history). Each handler does check the
   client's company before it, and the tests prove that check. A later caller of the store function alone would not
   get it.

## How the route proofs attach

- `src/pulse/catalog/proofs/s3-door-contracts.mjs` lists each proved route row by the same 20-letter id the catalog
  compiler gives it, and the test files that prove it. A row whose words change is a new row. This repair did not
  change the list: no row was added and none was taken back.
- `src/pulse/catalog/proofs/s3-door-contracts.test.mjs` checks every entry against the coverage map and checks that
  each test file exists and calls a real handler.
- `proofForDoor` in `door-proof.mjs` asks this list. A row on the list drops out of the red route monitor
  (`gap-door-batch-routes.mjs`).

## How the read proofs attach

Twelve of the 27 read rows already had an exact real-browser proof written after the red list was made. They go
through `src/pulse/catalog/proofs/s3-read-contracts.mjs`. The agent promotion gate row has its edge cases.
Nothing in the read proofs changed in this repair.

## Files from the first repair

| File | What it holds |
|---|---|
| `src/testing/s3-scoped-rows.mjs` | Stand-in rows that answer a statement by the conditions its SQL names (equality, alias, literal, IS NULL, null-safe, optional filter, any-of group). SELECT, UPDATE and DELETE. |
| `src/testing/s3-scoped-rows.test.mjs` | Pins each rule above so the helper cannot quietly keep a row it should drop. |
| `src/http/s3-role-gates.test.mjs` | 43 doors, 62 tests: who may call each one. |
| `src/http/s3-company-boundary.test.mjs` | 31 doors: staff of another company are turned away. |
| `src/http/s3-privacy-erasure-handler.test.mjs` | Erasure touches only the named client (3 tests). |
| `src/testing/s3-mem-tasks-db.mjs` | Now holds a real `clients` table (no more `inOrg` flag). Also the two role lists. |
| the eleven older `src/http/s3-*.test.mjs` files | Honest tables added in place (same table-driven files, no copies). |
| `src/pulse/catalog/proofs/flow-read-contracts.test.mjs` | Gate edge cases added. A second agent (a bare draft) was added to its fixture. |

All new files are under 400 lines (largest 281).

## Files changed in this repair

| File | What changed |
|---|---|
| `src/testing/s3-scoped-rows.mjs` | New: flag-or-equality rule, `plainSql`, `assertSqlHas`, `bindProblem`, `assertBind`. |
| `src/testing/s3-scoped-rows.test.mjs` | Pins the new rules (7 tests). |
| `src/testing/s3-handler-call.mjs` | `strictFakeDb`; `callShared` uses it. |
| `src/testing/s3-mem-tasks-db.mjs` | Statement log, bind rules, unique keys refused unless `ON CONFLICT DO NOTHING`, `race` mode. |
| `src/testing/s3-container-pins.mjs` | New, 35 lines: the container reads' clauses, written once for two tests. |
| `src/merchant/memory-db.mjs` | Refuses a repeat event without the `ON CONFLICT` clause; bind rules. |
| 14 `src/http/s3-*.test.mjs` files | Real rows, statement pins, race cases, strict stand-in. |
| 17 older attached tests under `src/http/` | `assertBind` in each inline stand-in, and statement pins: bank-accounts-endpoints, banking-revoke, bills-cashflow-endpoints, blueprint-staff-actions-next-sequence, client-archive, finance-containers, finance-liabilities, finance-os-suggestions, inquiry-cases-actions-handler, money-accounts, money-connections, money-map, partner-apply, partner-brand-verify-domain-handler, privacy-erasure, repair-cases-read, repair-send, transactions, underwrite-read. |

No product file was changed. No new file is over 400 lines (largest new file: 35).

## What I ran

- All 38 test files attached to my rows plus the ones I changed: 708 tests, 708 pass, 0 skipped, three runs in a row.
- The 32 files I changed: 581 tests, three runs in a row, 581 pass each time.
- Every `src/pulse/catalog/**` test (not `.pg.`), the `gap-catalog*` and `gap-door-batch*` tests: 1,257 tests,
  1,253 pass, 4 fail. The same four fail the same way on a clean `origin/main` because the Playwright command-line
  tool is not in the work folder: `display-batch-staff-ui`, `display-proof-cases`, `read-proof-cases`,
  `read-reviewed-e2e`.
- `npm run lint`: parse-clean count in the task report.
- Not-proved count, measured offline with the four lanes (gap-door-batch-routes, gap-catalog-display,
  gap-catalog-flow, gap-catalog-reads): 52 before, 52 after.
- The named breaks, one at a time, on the final files: 26 breaks, all red (the six named, plus extra variants).
- The SQL break sweep described above, on a full copy of the folder (never on the work folder).

## Shared lines for the integrator

The other four builders touch some of the same lines. This repair did not touch any of them again; the numbers
below are unchanged from the first repair.

1. `src/pulse/catalog/proofs/door-proof.mjs`: one `import { s3DoorProof }` line and one `|| s3DoorProof(sourceFile, row)` line.
2. `src/pulse/catalog/proofs/door-proof.test.mjs`: one word added to the `exactSafeHandler` pattern: `|s3-door-contracts`.
3. `src/pulse/coverage/gap-door-batch-routes.mjs`: `EXPECTED_ROUTE_GAP_COUNTS` is 84 / 77 / 50 / 32, total 243.
4. `src/pulse/coverage/gap-door-batch-routes.test.mjs`: the total, 243, in five places.
5. `src/pulse/catalog/proofs/door-batch-route-result.test.mjs`: `rows.length` 243 and `targets.length` 196.
6. `src/pulse/coverage/gap-catalog-reads.mjs`: twelve `gap(...)` entries removed from `READ_GAPS`.
7. `src/pulse/coverage/gap-catalog-reads.test.mjs`: 27 to 15 in three places.
8. `src/pulse/catalog/proofs/read-proof-cases.mjs`: one import line and one `...S3_READ_PROVED,` line.
9. `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: partition numbers follow the shorter read list.

To re-count after merging all five slices: the route row total is the number of route rows whose recipe proof still
names `gap-door-batch-routes.mjs`. `src/pulse/catalog/generated.json` was NOT regenerated.

## Left undone

Routes still not proved (37): the same list as before. Product findings above; taken back in the first repair
(`climate-match`, `inquiry-cases` send twice, `clear_inquiry`); needs a deeper stand-in than I could build safely
(`contracts` 4 rows, `contracts/sign` 3, `read/contracts`, `money/tasks`, `money/fundability`, `money/strategy`,
`money/banks` GET, `read/lender-matches`, `read/client-progress`, `dashboard/pipeline`, `documents-upload`,
`inquiries`, `repair/inbound-mail`, `repair/generate`, `blueprint/declines`, `brand/review`, `partner-pages`,
`public/education-enroll`, `banking/accounts` import, `demo/simulate` 2, `campaigns/meta-agency`, `inquiry` launch);
`partner-marketing/generate-copy` needs an AI call and AI spend is on hold.

Page reads still not proved (15): `campaign-fatigue-label` (the catalog row names the older partial test and a guard in
`door-flow-read-contracts-2.test.mjs` expects it to stay red) and 14 with no browser proof yet: `money-helper-poll`,
`money-trends`, the four `ops-admin` reads, `present-send-lock`, `teleprompter-reread`, `teleprompter-fullscreen`,
`portal-welcome-video`, `closer-logbar`, `plaid-link`, `social-oauth`, `climate-map`. The pattern to copy is
`src/pulse/catalog/proofs/read-second-pass-browser.test.mjs`.
