# Slice 3 manifest: customer-data routes and page reads

Branch: `prf/s3-data-routes` (local only, nothing pushed). Builder S3 of 5.
This file was updated after the checker broke the product on purpose and found proofs that stayed green.

## The short answer

- Rows in my slice: 131 (104 routes, 27 page reads).
- Not proved at the start: 131.
- Not proved after the first build: 48 (33 routes, 15 reads).
- Not proved now, after the repair: **52** (37 routes, 15 reads). Measured by running the four lanes offline.
- Rows proved now: 67 routes and 12 page reads (79 rows).
- Four rows went back to "not proved" in the repair because no honest test is possible today. See "Rows I took back".

## What the checker found, and what I did

| # | The break that stayed green | What I did | Now |
|---|---|---|---|
| 1 | Role gate removed in `api/money/plan.mjs` | The plan test now logs in as each role. Owner, admin, sales manager and closer get through. Setter, csm, funding advisor and inquiry specialist get a 403 before any lookup. | red |
| 2 | Same gate removed in `api/money/vault.mjs` and `api/money/ready-to-fund.mjs` | Same role table in both files. | red |
| 3 | Both company checks removed in ready-to-fund | The stand-in used to answer by a flag. Now it holds a real `clients` table and answers by the id and company the SQL names. The door check and the logic check are each proved alone (a spy proves the door stops it before the logic runs). Both removed goes red. | red |
| 4 | Push unsubscribe `all:true` lost its `client_id` | The stand-in now holds two clients' phones, plus another client's phone with the same endpoint. The test checks which rows were retired, and the SQL text. | red |
| 5 | Waypoint tick lost its `client_id` | The stand-in holds two clients' steps with the same key. The test sends the other client's step id and checks the answer is 404 and nothing changed. | red |
| 6 | Agent promotion gate numbers broken | The browser test now types 59 and 60 characters, 19 and 20 characters, clears the escalation person, and opens a draft with no trigger. | red |

Each one was broken again by hand after the fix and went red. The files were put back with the original text.

## What I found when I scanned my own proofs for the same weakness

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

## Rows I took back (they are red again and will show on the monitor)

| Row | Why no honest test is possible today |
|---|---|
| `public/climate-match` (0afa1181d191c2bd75c2) | The existing test never runs the handler's POST success path (lines 253 to 260). It calls the two helper functions instead. The handler uses the shared database and a lender cache, so a safe stand-in is a bigger build. |
| `inquiry-cases` send (4bf572fddb1ef89eff8c) | The row says "mail the bureau letter". The test only covers the failures (no return address, documents missing) and the portal upload. The mailing itself calls the mail provider and cannot be handed a stand-in from the handler. |
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
5. **New: `POST /api/inquiry-cases` with `action=clear_inquiry` has no company check.** `api/inquiry-cases.mjs` hands
   only the inquiry id and the staff id to `clearInquiry` (`src/inquiry-removal/cases.mjs:404`). That function reads
   `inquiry_log WHERE id = $1` and updates by id, with no company in either statement. Staff of company A who know
   an inquiry id of company B can clear it, complete B's case, and the `inquiry.removed` event goes out stamped with
   company A and B's client. Every other action on that door is scoped by company; I proved that.
6. **New, small: `update_bank_todo_state` is scoped by company but not by client.** `src/blueprint/bank-relationship.mjs`
   updates `WHERE id AND org_id`. Another company is refused (proved). A staff member of the same company can move
   a todo that belongs to a different client of that company.
7. **New, small: repair letter claim.** `claimLetterForMailing` in `src/repair/send.mjs` answers "claimed" when the
   letter id is not found for this company and client, so the mailing goes ahead with the content in the request
   and the mailed stamp then updates nothing. Another company's letter row is never touched.

## What "proved" means here

A row leaves "not proved" only when a test calls the real `api/` handler (or opens the real page) with fake data and
a stand-in database, and judges the exact result: the answer given, and which company and client each statement is
bound to. No live database, no vendor call, no text, no email, no charge.

## How the route proofs attach

- `src/pulse/catalog/proofs/s3-door-contracts.mjs` lists each proved route row by the same 20-letter id the catalog
  compiler gives it, and the test files that prove it. A row whose words change is a new row. The role table and the
  company table are named as evidence on every row whose door they cover.
- `src/pulse/catalog/proofs/s3-door-contracts.test.mjs` checks every entry against the coverage map and checks that
  each test file exists and calls a real handler.
- `proofForDoor` in `door-proof.mjs` asks this list. A row on the list drops out of the red route monitor
  (`gap-door-batch-routes.mjs`).

## How the read proofs attach

Twelve of the 27 read rows already had an exact real-browser proof written after the red list was made. I moved them
through `src/pulse/catalog/proofs/s3-read-contracts.mjs` (checked each assertion against the row's words and broke
each page once). The agent promotion gate row now has the edge cases it was missing (finding 6 above).

## New and changed files (mine)

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

## Shared lines I touched (for the integrator)

The other four builders touch some of the same lines. Expect conflicts and re-count.

1. `src/pulse/catalog/proofs/door-proof.mjs`: one `import { s3DoorProof }` line and one `|| s3DoorProof(sourceFile, row)` line.
2. `src/pulse/catalog/proofs/door-proof.test.mjs`: one word added to the `exactSafeHandler` pattern: `|s3-door-contracts`.
3. `src/pulse/coverage/gap-door-batch-routes.mjs`: the four numbers in `EXPECTED_ROUTE_GAP_COUNTS` are now
   **84 / 77 / 50 / 32, total 243** (the first build said 84 / 76 / 47 / 32, total 239; the original was 97 / 110 / 63 / 40, total 310).
4. `src/pulse/coverage/gap-door-batch-routes.test.mjs`: the total, now 243, in five places.
5. `src/pulse/catalog/proofs/door-batch-route-result.test.mjs`: `rows.length` 243 and `targets.length` 196
   (unique routes still on the red monitor).
6. `src/pulse/coverage/gap-catalog-reads.mjs`: twelve `gap(...)` entries removed from `READ_GAPS`.
7. `src/pulse/coverage/gap-catalog-reads.test.mjs`: 27 to 15 in three places.
8. `src/pulse/catalog/proofs/read-proof-cases.mjs`: one import line and one `...S3_READ_PROVED,` line.
9. `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: partition numbers follow the shorter read list
   (read 27 to 15, total 150 to 138, unproved 138 to 135), plus the new gate cases.

To re-count after merging all five slices: the route row total is the number of route rows whose recipe proof still
names `gap-door-batch-routes.mjs`. The unique-route number is the count of distinct route keys among those rows.

`src/pulse/catalog/generated.json` was NOT regenerated. `npm run ship` regenerates it, or run
`node scripts/pulse/compile-catalog.mjs` once after the merge.

## What I ran

- My 14 `s3-*` test files, the helper test, and the 36 attached test files: 697 tests, 697 pass, 0 skipped.
- Every `src/pulse/catalog/**` test (not `.pg.`), the `gap-catalog*` and `gap-door-batch*` tests: 1,257 tests,
  1,253 pass, 4 fail. The same four fail the same way on a clean `origin/main` because the Playwright command-line
  tool is not in the work folder: `display-batch-staff-ui` (staff display batch), `display-proof-cases` (focused
  proof test), `read-proof-cases` (64 proved read rows), `read-reviewed-e2e`.
- `npm run lint`: 3,475 files parse clean.
- The browser file I changed (`flow-read-contracts`): 10 runs alone, 3 runs with the group. All passed.
- A mutation sweep (each role gate, each company check, each `org_id` or `client_id` condition on a line a test
  runs, one at a time) on a full copy of the folder. The six named breaks and every break I fixed went red.

## Left undone (and why)

Routes still not proved (37):

- Product findings above: `soft-pull-approve` stamp, `pii`, `partner-brand` GET and PUT (2 rows), `inquiry-cases` clear_inquiry.
- Taken back in the repair: `climate-match`, `inquiry-cases` send (2 rows).
- Needs a deeper stand-in than I could build safely: `contracts` (4 rows), `contracts/sign` (3), `read/contracts`,
  `money/tasks`, `money/fundability`, `money/strategy`, `money/banks` GET, `read/lender-matches`, `read/client-progress`,
  `dashboard/pipeline`, `documents-upload`, `inquiries`, `repair/inbound-mail`, `repair/generate`, `blueprint/declines`,
  `brand/review`, `partner-pages`, `public/education-enroll`, `banking/accounts` import, `demo/simulate` (2),
  `campaigns/meta-agency`, `inquiry` launch (a phone call).
- `partner-marketing/generate-copy`: the rewrite needs an AI call, and AI spend is on hold.

Weakness I did not close (rows stay attached; they still go red on the breaks the checker tried):

- **Statement-level client scoping on canned reads in the older attached tests.** For `read/money-map`,
  `read/transactions`, `finance/cashflow` GET, `finance/bills` GET, `finance/liabilities` GET and
  `finance/bank-accounts` GET, the door checks are proved honestly. The `client_id` condition inside each
  individual SELECT is not: those tests hand back canned rows. If someone dropped `client_id` from one of those
  SELECTs, only that statement would leak across clients of the same company. Closing it needs a stand-in table
  for each of those statements. The sweep lists the exact lines (the `read` rows in the sweep log).
- `repair/send`: the per-letter claim SQL is canned in the older test (see finding 7).

Page reads still not proved (15):

- `campaign-fatigue-label`: an exact browser proof exists but the catalog row names the older partial test and a guard
  in `door-flow-read-contracts-2.test.mjs` expects the row to stay on the red list. Left red rather than edit that guard.
- The other 14 have no browser proof yet: `money-helper-poll`, `money-trends`, the four `ops-admin` reads (AR, compliance,
  failed events, consent), `present-send-lock`, `teleprompter-reread`, `teleprompter-fullscreen`, `portal-welcome-video`,
  `closer-logbar`, `plaid-link`, `social-oauth`, `climate-map`. The pattern to copy is
  `src/pulse/catalog/proofs/read-second-pass-browser.test.mjs`. When one is proved its entry must also leave
  `READ_GAPS` and the count in `gap-catalog-reads.test.mjs` (now 15) must go down.
