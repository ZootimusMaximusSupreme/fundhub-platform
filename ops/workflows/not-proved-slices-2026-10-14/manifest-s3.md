# Slice 3 manifest — customer-data routes and page reads

Branch: `prf/s3-data-routes` (local only, nothing pushed). Builder S3 of 5.

## The short answer

- Rows in my slice: 131 (104 routes, 27 page reads).
- Not proved before: 131.
- Not proved after: 48 (33 routes, 15 reads). Measured by running the four lanes offline.
- Rows proved: 71 routes and 12 page reads (83 rows).

## What "proved" means here

A row leaves "not proved" only when a test calls the real `api/` handler (or opens the real page) with fake
data and a stand-in database, and judges the exact result: the answer given, and which company and client
each statement is bound to. No live database, no vendor call, no text, no email, no charge.

Every test file that proves a row was broken on purpose (one change to the handler, the logic under it, or
the page), went red, and was put back with `git checkout`-clean files. Several tests were made stronger after
a first break did not turn them red (the company filter in the SQL text is now asserted in five places).

## How the route proofs attach

- `src/pulse/catalog/proofs/s3-door-contracts.mjs` lists each proved route row by the same 20-letter id the
  catalog compiler gives it, and the test files that prove it. A row whose words change is a new row.
- `src/pulse/catalog/proofs/s3-door-contracts.test.mjs` checks every entry against the coverage map and
  checks that each test file exists and calls a real handler.
- `proofForDoor` in `door-proof.mjs` asks this list. A row on the list drops out of the red route monitor
  (`gap-door-batch-routes.mjs`).

## How the read proofs attach

The 27 read rows came from a fixed red list (`READ_GAPS` in `gap-catalog-reads.mjs`). Twelve of them
already had an exact real-browser proof, written after the list was made (`flow-read-contracts.test.mjs`,
`display-contracts-ab.test.mjs`, `display-contracts-ef-public.test.mjs`), but the list was never updated, so
the lane kept printing them as not proved. I did not write new browser tests for them. I checked each
assertion against the row's words, broke each page once (twelve page breaks, all went red), then moved the
twelve from `READ_GAPS` to the proved list through `src/pulse/catalog/proofs/s3-read-contracts.mjs`.

Rows moved: agent owner picker, agent promotion gates, affiliate license chip, affiliate tax banner,
campaign can-launch, portal agreements, my-numbers offer stack, money boxes and streak, partner census,
payment-success bounded check, payment-success states.

## New files (mine, all prefixed s3-)

| File | Rows it proves | Tests |
|---|---|---|
| `src/http/s3-auth-handler.test.mjs` | authorized-rep remove, authorized-rep-file (2), magic-link-verify, auth/reset confirm | 15 |
| `src/http/s3-client-file-handler.test.mjs` | client-notes, customer-insights (save, read), bookings, entitlements, bank-inbox, conversations, ad-attribution, inbox | 22 |
| `src/http/s3-client-portal-handler.test.mjs` | push subscribe, push unsubscribe, email unsubscribe link, waypoint tick, affiliate click | 16 |
| `src/http/s3-money-handler.test.mjs` | ready-to-fund, money alerts, ask-for-a-person | 8 |
| `src/http/s3-money-vault-handler.test.mjs` | money vault (accept, reject, waive, unwaive, add, retire) | 5 |
| `src/http/s3-blueprint-bank-handler.test.mjs` | credit partner, next sequence date, bank tracker, money/banks POST | 15 |
| `src/http/s3-inquiry-cases-handler.test.mjs` | inquiry-case create, update, generate, gate override, clear inquiry | 13 |
| `src/http/s3-finance-handler.test.mjs` | container rename, soft-pull request, finance-ask | 10 |
| `src/http/s3-banking-handler.test.mjs` | banking accounts (read, hand entry), card-bill pull | 9 |
| `src/http/s3-closer-deck-handler.test.mjs` | closer deck log_disposition, read/closer-deck payload | 5 |
| `src/http/s3-documents-handler.test.mjs` | documents-download | 3 |
| `src/http/s3-money-plan-handler.test.mjs` | money plan mark | 4 |
| `src/http/s3-repair-handler.test.mjs` | repair exceptions (read, confirm) | 5 |
| `src/testing/s3-handler-call.mjs`, `src/testing/s3-mem-tasks-db.mjs` | helpers (call one handler; in-memory tasks and log) | — |
| `src/pulse/catalog/proofs/s3-door-contracts.mjs` and `.test.mjs` | the route attach list and its check | 4 |
| `src/pulse/catalog/proofs/s3-read-contracts.mjs` | the twelve read rows that moved to proved | — |

All new files are under 260 lines. 130 new handler tests plus 4 attach-list tests (134), all passing.

## Existing tests I attached (not changed)

Routes: `bank-accounts-endpoints`, `banking-revoke`, `bills-cashflow-endpoints`,
`blueprint-staff-actions-next-sequence`, `client-archive`, `climate-match`, `finance-containers`,
`finance-crs-pull`, `finance-liabilities`, `finance-os-suggestions`, `inquiry-cases-actions-handler`,
`money-accounts`, `money-connections`, `money-map`, `partner-apply`, `partner-brand-verify-domain-handler`,
`privacy-erasure`, `repair-cases-read`, `repair-send`, `transactions`, `underwrite-read` (all `src/http/`).
Reads: the three plugin browser tests named above. I read each one, checked that every action named in the
row's words appears in it, and broke the handler or page once to see it go red.

## Shared lines I touched (for the integrator)

These are the only edits outside my own files. The other four builders will touch some of the same lines,
so expect conflicts and re-count.

1. `src/pulse/catalog/proofs/door-proof.mjs`: one `import { s3DoorProof }` line and one
   `|| s3DoorProof(sourceFile, row)` line in the plug-in chain of `proofForDoor`.
2. `src/pulse/catalog/proofs/door-proof.test.mjs`: one word added to the `exactSafeHandler` pattern:
   `|s3-door-contracts`.
3. `src/pulse/coverage/gap-door-batch-routes.mjs`: the four numbers in `EXPECTED_ROUTE_GAP_COUNTS`
   (now 84 / 76 / 47 / 32, total 239; was 97 / 110 / 63 / 40, total 310). This guard stops the module from
   loading when the count drifts, so the number must go down with every proved row.
4. `src/pulse/coverage/gap-door-batch-routes.test.mjs`: the total, 310 to 239, in five places.
5. `src/pulse/catalog/proofs/door-batch-route-result.test.mjs`: `rows.length` 310 to 239 and
   `targets.length` 240 to 194 (unique routes still on the red monitor).
6. `src/pulse/coverage/gap-catalog-reads.mjs`: twelve `gap(...)` entries removed from `READ_GAPS`.
7. `src/pulse/coverage/gap-catalog-reads.test.mjs`: 27 to 15 in three places.
8. `src/pulse/catalog/proofs/read-proof-cases.mjs`: one import line and one `...S3_READ_PROVED,` line at the
   top of the `PROVED` list. The total of 78 read proof cases and the red count of 14 do not change.
9. `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: the partition numbers follow the shorter read
   list: read 27 to 15, total 150 to 138, unproved 138 to 135 (three places and the test title).

To re-count the route numbers after merging all five slices: the row total is the number of route rows whose
recipe proof still names `gap-door-batch-routes.mjs`. The unique-route number is the count of distinct route
keys among those rows.

`src/pulse/catalog/generated.json` was NOT regenerated (no test required it, and five builders would
conflict). `npm run ship` regenerates it; or run `node scripts/pulse/compile-catalog.mjs` once after the merge.

## What I ran

- My 13 new http test files plus the attach-list test: 134 tests, 0 failing.
- `node --test` on every `src/pulse/catalog/**` test (not `.pg.`), the `gap-catalog*` and `gap-door-batch*`
  tests, and my 13 files: 1,387 tests, 1,383 pass, 4 fail. All four fail the same way on a clean
  `origin/main` (checked in a second work folder), because this machine has no Playwright command-line tool
  in the work folder or the display batch is not set up here: `display-batch-staff-ui` ("Playwright CLI is
  not installed"), `read-reviewed-e2e` (cannot find `@playwright/test/cli.js`), `display-proof-cases` (one
  nested test, about 30 seconds) and `read-proof-cases` "the 64 proved read rows run their real focused
  result tests" (runs the same nested files).
- `npm run lint`: 3,470 files parse clean.

## Product findings (the product is wrong; row left NOT_PROVED, nothing fixed)

1. **`POST /api/soft-pull-approve` with `action=stamp_incorporated` crashes.** The handler calls
   `stampIncorporatedAsStaff(...)` at `api/soft-pull-approve.mjs:279`, but that function is never defined or
   imported in the file. Running it throws `ReferenceError: stampIncorporatedAsStaff is not defined`. The
   Present screen calls this action (`public/app/present.js:1610`), so the "stamp the incorporation date"
   button gets a server error.
2. **`/api/pii` has no company check.** `readIdentity`, `revealSsn` and `accessHistory` look a person up by
   `client_id` only (`WHERE client_id = $1`), and the handler never calls `requireClientInOrg`. A signed-in
   owner, admin, funding advisor or inquiry specialist of one company who knows another company's client id
   can read that person's date of birth, addresses and last four, the access history, and reveal the full
   Social Security number. `store` can also overwrite it (`ON CONFLICT (client_id) DO UPDATE`). I ran the
   handler with a session in company A and a stand-in row owned by company B: it answered 200 with company
   B's identity, and the statement had no `org_id` filter.
3. **`/api/partner-brand` has no company check either.** The gate is a role check only
   (`canAccessBrand`: owner or admin). The read is `WHERE partner_id = $1`. The write looks up the partner's
   own company and writes into it. An admin of company A who knows a white-label partner id of company B can
   read and change B's brand (trading name, address, support email, domain, funnels). I ran it: a session in
   company A got 200 and the write was bound to company B.
4. Wording note only: the route for removing an authorized representative says "ends their sessions". The
   code stamps the link removed and points that login's sessions at their next file, or at nothing. The
   session row itself is not revoked. After removal the login cannot act on the removed file, so I proved
   what it really does and kept the row proved.

## Left undone (and why)

Routes still not proved (33):

- Product findings above: `soft-pull-approve` stamp, `pii`, `partner-brand` GET and PUT (2 rows).
- Needs a deeper stand-in than I could build safely in this run: `contracts` (4 rows), `contracts/sign` (3),
  `read/contracts`, `money/tasks`, `money/fundability`, `money/strategy`, `money/banks` GET,
  `read/lender-matches`, `read/client-progress`, `dashboard/pipeline`, `documents-upload`, `inquiries`,
  `repair/inbound-mail`, `repair/generate`, `blueprint/declines`, `brand/review`, `partner-pages`,
  `public/education-enroll`, `banking/accounts` import, `demo/simulate` (2), `campaigns/meta-agency`,
  `inquiry` launch (a phone call).
- `partner-marketing/generate-copy`: the existing test proves only the refusals. The rewrite itself needs
  an AI call, and AI spend is on hold, so there is no safe fake-data proof of the named result.

Page reads still not proved (15):

- `campaign-fatigue-label`: an exact browser proof exists (`flow-read-contracts.test.mjs`, which also asserts
  the label button), but the catalog row names the older partial test, and a guard in
  `door-flow-read-contracts-2.test.mjs` expects the row to stay on the red list. I left it red rather than
  edit that guard. The integrator can move it the same way the other twelve moved.
- The other 14 have no browser proof yet: `money-helper-poll`, `money-trends`, the four `ops-admin` reads
  (AR, compliance, failed events, consent), `present-send-lock`, `teleprompter-reread`,
  `teleprompter-fullscreen`, `portal-welcome-video`, `closer-logbar`, `plaid-link`, `social-oauth`,
  `climate-map`. The pattern to copy is `src/pulse/catalog/proofs/read-second-pass-browser.test.mjs` (static
  server, Chromium, stubbed `/api`, `page.clock` for timers). When one is proved, its entry must also leave
  `READ_GAPS` and the count in `gap-catalog-reads.test.mjs` (now 15) must go down.
