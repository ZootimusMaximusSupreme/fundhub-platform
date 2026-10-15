# Batch 08 manifest (finish the 853) — Sonnet builder, lane gap-door-batch-routes

Branch `fin/b08` (worktree `.claude/worktrees/fin-b08`), cut from `fin/base`. Not pushed. Not merged.

## Numbers

| | Count |
|---|---|
| Rows in this batch (all open at the start) | 37 |
| Still open after this branch | 3 (each one justified below) |
| Whole catalog, before / after (`node scripts/pulse/count-not-proved.mjs`) | 853 / 819 |
| Route lane `gap-door-batch-routes`, before / after | 135 / 101 |
| Route lane per file (routes-0 / 1 / 2 / 3) | 54/36/25/20 to 44/26/16/15 |

Generation 2 (a fresh agent) re-read the three open rows from the real handlers and screens, re-measured
two of them on the real handlers, and found none of the three attachable (see "Generation 2 challenge").
It also mutation-checked the 34 attached tests again and hardened four of them (see "Generation 2 hardening").
The numbers above are unchanged: 37 rows, 34 practice tests, 3 not-attachable.
A third pass (see "Re-verification run") re-measured and hardened two more tests; the numbers did not move.
A fourth pass (see "Generation 3") ran a guard-off sweep over every handler of the batch, found 86 guards
the row tests never asserted, and pinned them with 60 new tests; the numbers did not move
(37 rows, 34 practice tests, 3 not-attachable).

Words used on purpose: every attached row is a **practice test** (the real handler and the real library
run over in-memory stand-in tables, fake data, no network, no database). None is a live check. None is
called "deep" or "proof" in what is handed back. (The catalog still stores `depth: "deep"` on a plug-in
entry because the guard in `door-proof.test.mjs` requires it for customer-data rows; that is the
catalog's own field name, not a claim made here.)

## Every row

| # | Row (file : surface : first words of the control) | Outcome | Test that judges it |
|---|---|---|---|
| 1 | routes-1 route:banking/accounts : POST action=import | practice-test | `src/http/fin-b08-banking-import.test.mjs` |
| 2 | routes-2 route:blueprint/declines : GET/POST decline defense | practice-test | `src/http/fin-b08-blueprint-declines.test.mjs` |
| 3 | routes-2 route:brand/review : POST submit / approve / reject | practice-test | `src/http/fin-b08-brand-review.test.mjs` |
| 4 | routes-1 route:campaigns/meta-agency : POST partner Meta business id | practice-test | `src/http/fin-b08-meta-agency.test.mjs` |
| 5 | routes-0 route:contracts : Drafts (create_client, create_draft, save_draft, preview) | practice-test | `src/http/fin-b08-contracts-write.test.mjs` |
| 6 | routes-0 route:contracts : send (freezes the words, signed link) | practice-test | `src/http/fin-b08-contracts-write.test.mjs` |
| 7 | routes-0 route:contracts : Template authoring | practice-test | `src/http/fin-b08-contracts-write.test.mjs` |
| 8 | routes-0 route:contracts : void | practice-test | `src/http/fin-b08-contracts-write.test.mjs` |
| 9 | routes-1 route:contracts/sign : GET view for signing | practice-test | `src/http/fin-b08-contracts-sign.test.mjs` |
| 10 | routes-1 route:contracts/sign : POST sign | practice-test | `src/http/fin-b08-contracts-sign.test.mjs` |
| 11 | routes-1 route:contracts/sign : POST action=decline | not-attachable | see "Left red" |
| 12 | routes-3 route:dashboard/pipeline : GET board | practice-test | `src/http/fin-b08-dashboard-pipeline.test.mjs` |
| 13 | routes-0 route:demo/simulate : DELETE teardown | practice-test | `src/http/fin-b08-demo-simulate.test.mjs` |
| 14 | routes-0 route:demo/simulate : POST load one demo client | practice-test | `src/http/fin-b08-demo-simulate.test.mjs` |
| 15 | routes-3 route:documents-upload : POST multipart file | practice-test | `src/http/fin-b08-documents-upload.test.mjs` |
| 16 | routes-3 route:inquiries : GET attempt history / recent letters | practice-test | `src/http/fin-b08-inquiries.test.mjs` |
| 17 | routes-0 route:inquiry : POST action=launch | practice-test | `src/http/fin-b08-inquiry-launch.test.mjs` |
| 18 | routes-1 route:inquiry-cases : POST action=send {mail, portal} | practice-test | `src/http/fin-b08-inquiry-cases-send.test.mjs` |
| 19 | routes-2 route:inquiry-cases (clear_inquiry) | not-attachable | see "Left red" |
| 20 | routes-2 route:inquiry-cases (send) | practice-test | `src/http/fin-b08-inquiry-cases-send.test.mjs` |
| 21 | routes-1 route:money/banks : GET | practice-test | `src/http/fin-b08-money-banks.test.mjs` |
| 22 | routes-1 route:money/fundability : GET | practice-test | `src/http/fin-b08-money-fundability.test.mjs` |
| 23 | routes-2 route:money/strategy : GET/POST | practice-test | `src/http/fin-b08-money-strategy.test.mjs` |
| 24 | routes-0 route:money/tasks : POST do_task | practice-test | `src/http/fin-b08-money-tasks.test.mjs` |
| 25 | routes-1 route:partner-brand : GET | practice-test | `src/http/fin-b08-partner-surface.test.mjs` |
| 26 | routes-1 route:partner-brand : PUT | practice-test | `src/http/fin-b08-partner-surface.test.mjs` |
| 27 | routes-2 route:partner-marketing/generate-copy : POST | practice-test | `src/http/fin-b08-partner-copy.test.mjs` |
| 28 | routes-2 route:partner-pages : GET/POST/PATCH | practice-test | `src/http/fin-b08-partner-surface.test.mjs` |
| 29 | routes-2 route:pii : GET/POST | practice-test | `src/http/fin-b08-pii.test.mjs` |
| 30 | routes-2 route:public/climate-match : GET/POST | practice-test | `src/http/fin-b08-climate-match.test.mjs` |
| 31 | routes-0 route:public/education-enroll : POST | practice-test | `src/http/fin-b08-education-enroll.test.mjs` |
| 32 | routes-3 route:read/client-progress : GET | practice-test | `src/http/fin-b08-client-progress.test.mjs` |
| 33 | routes-1 route:read/contracts : GET | practice-test | `src/http/fin-b08-read-contracts.test.mjs` |
| 34 | routes-3 route:read/lender-matches : GET | practice-test | `src/http/fin-b08-lender-matches.test.mjs` |
| 35 | routes-2 route:repair/generate : POST | practice-test | `src/http/fin-b08-repair-generate.test.mjs` |
| 36 | routes-0 route:repair/inbound-mail : POST | practice-test | `src/http/fin-b08-repair-inbound-mail.test.mjs` |
| 37 | routes-1 route:soft-pull-approve : POST action=stamp_incorporated | not-attachable | see "Left red" |

34 practice tests, 0 live checks, 0 verified N/A, 3 not-attachable. The full row ids are the ones in
`ops/workflows/finish-853-2026-10-14/batch-08.json`; the attached ones are named in
`src/pulse/catalog/proofs/fin-b08-door-contracts.mjs` by the same 20-hex id the catalog compiler gives them.

## How a row is attached

`src/pulse/catalog/proofs/fin-b08-door-contracts.mjs` is a plug-in for the proof chain in `door-proof.mjs`
(same shape as `s3-door-contracts.mjs`). A row leaves the red route monitor only when its exact
file + surface + control words are listed. Its test (`fin-b08-door-contracts.test.mjs`) fails if an id is
not one exact customer-data route row, if a listed test file is missing, skipped, parked, or does not
import an `api/` handler, if the words of a row change, or if one of the three red rows is attached.

## What every practice test does

Each file runs the real `api/` handler through the real sign-in and role gate and the real library under it,
over stand-in tables that answer by the conditions the SQL text itself names (company, client, state).
A handler that drops a condition, a column or a guard changes the answer, and the test goes red. Where the
stand-in cannot run a statement (the dashboard board's joined statement, the demo teardown's catalog
question) the file says so and pins the clauses of the statement text instead.

Every file was broken on purpose at least once per behaviour it claims: the product line was changed, the
test was seen red, and the line was put back. A few mutations stayed green because a second layer already
guards the same thing (for example the handler checks the role and the library checks it again). Those were
either pinned at the statement text, or left as stated equivalents in the file comments. Nothing was left
weak on purpose.

## Files added

Tests (`src/http/`): `fin-b08-banking-import`, `fin-b08-blueprint-declines`, `fin-b08-brand-review`,
`fin-b08-client-progress`, `fin-b08-climate-match`, `fin-b08-contracts-sign`, `fin-b08-contracts-write`,
`fin-b08-dashboard-pipeline`, `fin-b08-demo-simulate`, `fin-b08-documents-upload`, `fin-b08-education-enroll`,
`fin-b08-inquiries`, `fin-b08-inquiry-cases-send`, `fin-b08-inquiry-launch`, `fin-b08-lender-matches`,
`fin-b08-meta-agency`, `fin-b08-money-banks`, `fin-b08-money-fundability`, `fin-b08-money-strategy`,
`fin-b08-money-tasks`, `fin-b08-partner-copy`, `fin-b08-partner-surface`, `fin-b08-pii`,
`fin-b08-read-contracts`, `fin-b08-repair-generate`, `fin-b08-repair-inbound-mail` (all `.test.mjs`).

Generation 3 added `src/http/fin-b08-door-guards.test.mjs` (41 tests; see "Generation 3").

Stand-in helpers (`src/testing/`): `fin-b08-tables.mjs` (generation 2 added `orderAndLimit`),
`fin-b08-partner-tables.mjs`, `fin-b08-contracts-db.mjs`.

Plug-in: `src/pulse/catalog/proofs/fin-b08-door-contracts.mjs` and `fin-b08-door-contracts.test.mjs`.

This manifest: `ops/workflows/finish-853-2026-10-14/manifest-b08.md`.

## Shared lines touched (smallest possible edits)

| File | Edit |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | one import line, and `\|\| finB08DoorProof(sourceFile, row)` added at the end of the plug-in chain in `proofForDoor` |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | `\|fin-b08-door-contracts` added to the `exactSafeHandler` regex |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS` 54/36/25/20 to 44/26/16/15 |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | the row total 135 to 101 (title, three lengths, results length) |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | rows 135 to 101, unique routes 115 to 91 |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog` (conflict with sibling batches expected; recompile after merge) |

The integrator will see conflicts on the three count lines and the plug-in chain from the other route
batches. Each batch's count change is its own number of attached rows (34 here); apply them together.

## Generation 2 challenge: the three rows left red

Each reason was re-read from the code and the screens, not taken from the first pass. Two were also
measured by running the real handler (a scratch script, not committed).

1. `routes-1 route:contracts/sign : POST action=decline {reason}` ("recorded and the sender is told").
   Still not attachable. The recorded half is judged (fin-b08-contracts-sign.test.mjs). The told half has
   nothing to judge:
   - `api/contracts/sign.mjs` calls `declineSigner` and answers "The person who sent this has been told";
     after it there is no message, event, task or notify call, here or in `src/contracts/signers.mjs`.
   - the contract's own status does not change: `contracts.status` only allows draft, sent, viewed,
     signed, void (`db/migrations/124_contracts.sql:169`).
   - the Documents screen (`public/app/documents.html`) reads the contract list, which carries no signer
     state, so a declined contract still shows as sent / Awaiting there, with a Remind button.
   - the one place the decline is visible to staff is `GET /api/read/contracts?id=` (signers[].status and
     decline_reason). No screen in `public/` calls that read.
   - the heartbeat (`src/pulse/coverage/gap-contracts.mjs`) labels the contract declined for the owner. That
     is not the sender.
2. `routes-2 route:inquiry-cases (clear_inquiry)` ("org from the session"). Still not attachable.
   Measured on the real handler with a stand-in table: staff of company A clear an inquiry whose row says
   company B (answer 200, case_cleared true). The statements the handler runs carry no company:
   `SELECT * FROM inquiry_log WHERE id = $1` and `UPDATE inquiry_log ... WHERE id = $1`. The `inquiry.removed`
   event goes out with `orgId` = company A and the case's client of company B. The session company is used
   for the sign-in gate and for the event, never for the read or the write. `inquiry_log` has no row policy
   in `db/`. The rest of the control (clears one inquiry, completes its case, emits `inquiry.removed` once,
   keyed to the case, staff roles only) is already judged by `s3-inquiry-cases-handler.test.mjs`; the one
   claim that is false today is the company boundary, and a green mark here would hide it.
3. `routes-1 route:soft-pull-approve : POST action=stamp_incorporated`. Still not attachable. Measured on
   the real handler: the call throws `ReferenceError: stampIncorporatedAsStaff is not defined`
   (`api/soft-pull-approve.mjs:279`). The function was added in commit ddcd92d18 and is not in the file
   today; nothing else in `api/`, `src/`, `public/` or `scripts/` defines or imports it. The Present screen
   (`public/app/present.js:1610`) and the client control panel
   (`public/app/client-control-panel.html:2662`) both call it. No working result exists to judge.

The three reasons are also written, with the same facts, in `FIN_B08_NOT_ATTACHED` in
`src/pulse/catalog/proofs/fin-b08-door-contracts.mjs`, and `fin-b08-door-contracts.test.mjs` fails if any of
the three is attached by mistake.

## Generation 2 hardening of the attached tests

Mutation check: 40 hand-picked product changes (role gates, the reason-required rule, masking, the tamper
check, the paid-Blueprint gate, partner approve, the upload company check, payoff comparators, stacking
order, newest-record picks) and 78 `ORDER BY` flips across the handlers and the libraries they call, each
restored after its run (git status clean). Most turned the matching test RED. Four areas had a claim the
test could not tell from a broken product (the first four rows below); each is closed and each new check was
seen RED against the break. A fifth stand-in, which hard-coded the product's own order, was made honest.

| Row | What stayed green | Fix | Now |
|---|---|---|---|
| dashboard/pipeline | dropping or changing the stage statement's `ORDER BY s.sort_order` (the stand-in returned stages in the order the test stored them) | stages stored out of order; the stand-in answers in the order the statement's own ORDER BY names; the statement text is pinned; the two "newest message" ORDER BYs (text and email) are counted | `ORDER BY s.name`, no ORDER BY, `sort_order DESC`, either newest-message ORDER BY flipped: all RED |
| money/strategy | the "card use first" claim: with the old fixture the highest-use card was also the highest-rate card, so dropping the whole card-use phase changed nothing | third card (lowest rate, most of its limit used) so avalanche, snowball and utilization each put a different card first; a card with an unknown rate is paid after every known rate | `[...phase1, ...avalanche]` reduced to `avalanche`, unknown rate sorted first, avalanche, snowball and utilization comparators flipped: all RED |
| repair/generate | "analyses a client's stored credit file": nothing told the newest file from an older one | the client has an older pull stored first and the newest second; the letter must come from the newest | `ORDER BY created_at ASC` and no ORDER BY: RED |
| blueprint/declines | the plan's steps order and newest decline first: the shared stand-in sorted by itself | the two reads are answered from the stored rows in the statement's own order (steps stored last step first); new test reads two declines and the plan steps in order | declines oldest first, steps unordered, steps `position DESC`: all RED |
| client-progress | the stand-in hard-coded the newest-first sort of the pulls | it now follows the statement's ORDER BY (the library re-sorts, so this stays an equivalent mutant; noted) | n/a |

The shared stand-in `src/testing/fin-b08-tables.mjs` now applies a statement's closing plain `ORDER BY` and
`LIMIT` (`orderAndLimit`, exported). Every test that uses it still passes; a statement that orders by an
expression keeps the stored order and applies no LIMIT.

Mutants left green, on purpose (each is a second layer or an unclaimed read): the 3 account/holding list
orders in banking import (reads, not the import), signer list order in contracts/sign (turn is computed in
code from `signer_index`), pull series order in client-progress (the library sorts again), the first of two
identical sorts in lender match (the second sort decides), `unknown rate treated as 0%` in the payoff math
(only differs from a card with a known 0% rate, which no fixture has).

## Re-verification run (2026-10-14, evening, after the Mac restart)

The run was handed to a fresh agent as generation 1, but the branch already held generation 1 and 2. That
agent did not redo the work. It re-measured, re-ran, and broke the product again on purpose.

- Re-measured: 819 total, route lane 101, this batch 37 to 3 (same three ids as above). The three
  not-attachable reasons were checked against the code again; `stampIncorporatedAsStaff` is still
  referenced at `api/soft-pull-approve.mjs:279` and defined nowhere.
- Product broken on purpose, 24 changes across 20 handlers, each restored (the handler file was clean after
  each): a role gate removed or widened, an org or entity condition dropped, the signed-link check bypassed,
  a stage key and an SMS consent flag changed, the teaser limit raised. 22 turned the matching test RED at once.
- Two stayed green and were closed (each new check seen RED against the break, and green on the product):

| Row | What stayed green | Fix | Now |
|---|---|---|---|
| documents-upload : POST multipart file | dropping `kind = 'business'` from the entity statement: the fixture held no personal container for the same client | this client's personal container and one archived business added; both must be refused 404 "no such business" and nothing saved | `AND archived_at IS NULL` only: RED. `AND kind = 'business'` only: RED |
| contracts : Drafts / send / Template authoring / void | removing the staff role gate in `api/contracts.mjs`: every fixture role was already a staff role | a signed-in role outside the staff set must get 403 on create_draft, create_template and void, and nothing is saved | gate removed: RED |

- `node --test src/http/fin-b08-*.test.mjs src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs`: 258
  tests, 258 pass, 0 skipped (one test added).
- `npm run pulse:catalog`: 3975 mapped, 3919 wired, 23 red; `generated.json` did not change.

Still stated plainly: every attached row is a **practice test**, not a live check.

## Product findings (written down, not fixed)

1. `clear_inquiry` has no company check: staff of one company can clear another company's inquiry by id,
   and the `inquiry.removed` event is emitted with the caller's company and the other company's client
   (`api/inquiry-cases.mjs` clear_inquiry branch; `src/inquiry-removal/cases.mjs` `clearInquiry`).
2. `api/pii.mjs` and `src/pii/index.mjs` read, reveal (full SSN) and list history by `client_id` with no
   company check; `store` takes `org_id` from the request body when the session has none. The row's own
   words already record the missing check, so its practice test pins role gate, masking, the reason
   and the access log, and does not pin a boundary.
3. `contracts/sign` decline tells the signer "the sender has been told" but nothing is sent.
4. `soft-pull-approve` action `stamp_incorporated` calls an undefined function (500 on every call). The
   Present screen and the client control panel both call it.
5. `src/metro2/inbound/parse-response.mjs:48` (`excerptAround`): when a letter names neither the account's
   last four nor its creditor, that item is judged from the letter's first 400 characters. Deletion
   language about another account at the top of a letter marks an unnamed item deleted, and with one open
   item that read is confident enough (0.90) to advance without a person.

6. `soft-pull-approve` stamp_incorporated, exact cause (added generation 3): merge `8d9a693ae` (2026-08-27,
   "Merge remote-tracking branch 'origin/main' into merge/2026-08-27-threads-live") brought in the call at
   `api/soft-pull-approve.mjs:279` but not `stampIncorporatedAsStaff` and `stampBusinessIncorporated`, which commit
   `ddcd92d18` (2026-08-25) added. The text of both functions is in that commit.
7. `contracts/sign` decline has no way in for a person (added generation 3): `public/contract.html` defines
   `decline()` (line 563) and nothing calls it (owner answer 2026-08-17: "contract sign has no decline button").
   Only a direct call to the endpoint declines, and that call answers "the person who sent this has been told"
   while nothing tells anyone (finding 3).
8. `public/education-enroll` with no default company row answers 500, not 400: `defaultOrgId` (`src/events/bus.mjs`)
   throws when the `orgs` row is missing, so the `org_required` branch in `runEducationEnroll` and its 400 mapping
   in the handler cannot be reached by the handler's own call. Nothing is saved either way (added generation 3).

## Commands run (generation 2, on top of the list below)

- `node scripts/pulse/count-not-proved.mjs`: 819 total, route lane 101, this batch 3 (unchanged).
- `node --test src/http/fin-b08-*.test.mjs src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs`:
  257 tests, 257 pass, 0 skipped.
- `node --test src/pulse/coverage/gap-door-batch-routes.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs
  src/pulse/catalog/proofs/door-proof.test.mjs src/pulse/catalog/proofs/s3-door-contracts.test.mjs`:
  998 tests, 998 pass, 0 skipped.
- `node scripts/lint.mjs`: 3593 files and inline scripts parse clean.
- `npm run pulse:catalog`: 3975 mapped, 3919 wired, 23 red; `generated.json` did not change.
- Mutation runs (not kept): 40 hand-picked product mutations and 78 ORDER BY flips (run before and after the
  hardening), each restored; the flips ran in a throwaway worktree that was removed afterwards.

## Commands run (generation 1)

- `node scripts/pulse/count-not-proved.mjs` before and after: 853 / 819 total, route lane 135 / 101, this
  batch 37 / 3.
- `node --test src/http/fin-b08-*.test.mjs`: 26 files, 248 tests, 248 pass, 0 skipped.
- The catalog and door tests that read the route map, the proof chain or `generated.json`
  (`src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/door-*.test.mjs`, `s1/s2/s3-door-contracts`,
  `fin-b08-door-contracts`, `flow-read-contracts`, `src/pulse/coverage/gap-catalog*.test.mjs`,
  `gap-door-batch-routes.test.mjs`): 1070 + 84 tests, all pass, 0 skipped.
- `node scripts/lint.mjs`: 3593 files and inline scripts parse clean.
- The whole `src/pulse` suite was started once and stopped: it launches Playwright browsers and nested test
  runs and did not finish in 12 minutes on a busy machine. The tests named above are the ones that touch
  what this branch changed.
- `npm run pulse:catalog`: regenerated `generated.json` (3975 mapped, 3919 wired, 23 red).
- Plug-in mutations seen red: a changed id, a removed chain line, a skipped test file.

## Generation 3 (2026-10-14, night, a fresh Sonnet builder)

Handed this batch as "generation 2 of 3" with the three open rows. The branch already held the work of the
earlier passes, so this agent did not redo it. It (a) re-challenged the three red rows from the code, (b) tried
to prove its predecessors wrong with a method they had not used, and (c) closed what that method found.

### Numbers

| | Count |
|---|---|
| Rows in this batch | 37 |
| Open at the start of this generation (`count-not-proved.mjs`, intersected with `batch-08.json`) | 3 |
| Open after (same measure) | 3 (the same three ids, each still justified) |
| Whole catalog, before / after | 819 / 819 |
| Practice tests in the batch (`src/http/fin-b08-*.test.mjs` + the plug-in test) | 258 before, 318 after (60 new), 0 skipped |

### The three red rows, challenged again

Each reason was re-read in the code, and two were re-measured by running the real handler.

1. `contracts/sign` POST action=decline ("recorded and the sender is told"). Still true: `declineSigner` only
   updates `contract_signers` and the handler answers that the sender was told. Nothing in `api/`, `src/contracts/`,
   `src/workflows/`, `netlify/` or `db/` consumes a declined signer except the heartbeat label. New fact: the signing
   page has a `decline()` function and no button calls it (finding 7). A green mark would hide a false sentence.
2. `inquiry-cases` clear_inquiry ("org from the session"). Still true: `clearInquiry` reads and updates
   `inquiry_log` by id alone; no row policy for `inquiry_log` exists in `db/` (checked every RLS enable and
   policy loop in `db/migrations` and `db/schema`; the only `inquiry_log` loop is the `updated_at` trigger).
   The reading "org from the session" as only "the org comes off the session, not the body" was considered and
   rejected: attaching the row would put a green mark on a route that lets staff of one company clear another
   company's inquiry and complete its case. The `s3` plug-in already judges the rest of the action under its own row.
3. `soft-pull-approve` stamp_incorporated. Re-measured this run: the handler throws
   `ReferenceError: stampIncorporatedAsStaff is not defined`. Exact cause in finding 6.

### The method: turn each guard off, see if any test notices

A scratch harness (not committed) took every `if (` in the 27 handler files of the batch that sits in front of a
4xx/5xx answer or a `throw` (297 of them), replaced that one condition with `true ? false : <condition>`, ran every
test of the batch that imports the handler, and put the file back. Run once on the branch as it was: 165 of 297
survived. Run again after this generation's tests: 80 of 297 survived; the shift gate in `api/inquiries.mjs` was
closed right after that run, so 79 of 297 survive and 218 are killed.

The 86 that were closed (each seen red against its break, and green on the product; the harness refuses to
run a mutant on a red baseline):

| Test (new or sharpened) | Guards it now holds |
|---|---|
| `fin-b08-door-guards.test.mjs` (new, 41 tests) | a staff sign-in with no company is refused before any data table is touched, on 15 doors (`banking/accounts`, `blueprint/declines`, `contracts`, `documents-upload`, `inquiries`, `inquiry-cases`, `inquiry`, `money/banks`, `money/fundability`, `money/strategy`, `money/tasks`, `read/client-progress`, `read/lender-matches`, `repair/generate`, `repair/inbound-mail`); a client login with no client file is refused on 6; a staff caller who names no client is 400 on 5; a method the door does not take is 405 on 10 (banks, strategy, tasks and declines take a PUT; fundability, progress and lender-matches a POST; repair/generate, inbound-mail and generate-copy a GET); a non-JSON body is 400 on 4 |
| `fin-b08-contracts-sign.test.mjs` | a link with a good signature that names a signer not on this contract opens nothing, hands out no file, records no decline and no signature (GET, `?file=1`, decline, sign); no signing secret is 503 `not_configured`; a draft answers exactly as a forged link does |
| `fin-b08-partner-surface.test.mjs` | a partner cannot start a page for another partner of the same company (403, no page); no company on the sign-in is 403 `no_org_scope` on GET, POST and PATCH; page and brand requests must name a real partner and, to change a page, a real page with something to change |
| `fin-b08-brand-review.test.mjs` | a staff sign-in with no company is refused before the brand table is read (the one tenancy guard the handler's own comment calls "no other one"); a reason over 2000 characters is refused; the wrong-state sentence names the real state; GET, an unknown action and a bad partner id are refused |
| `fin-b08-contracts-write.test.mjs` | a malformed id, client id, template id or staff id is 400 with its own error before any contract table is read, across 8 write actions (11 requests) of the rows |
| `fin-b08-read-contracts.test.mjs` | another company's contract or template is "not found" (not "no file"); the list filters (client, staff, document ids, more than 200) are 400 before any list is read |
| `fin-b08-repair-generate.test.mjs` | a round past the client's repair program cap is 400 `round_cap_exceeded` with no letter made; a round that does not exist is refused before the client is looked up |
| `fin-b08-banking-import.test.mjs` | a PUT, PATCH or DELETE carrying an import body imports nothing (405); an import with no client id is 400 and nothing is looked up |
| `fin-b08-pii.test.mjs` | POST with a client id that is not an id is 400 for store and reveal; a store with no company on the sign-in and none in the body saves nothing |
| `fin-b08-inquiries.test.mjs` | no login is 401 and the handler stops cleanly; a bad inquiry id is 400 on GET and POST; the shift gate stops after its 403 instead of carrying on |
| `fin-b08-inquiry-cases-send.test.mjs` | a GET or an unknown action sends no letter and touches no case table |
| `fin-b08-documents-upload.test.mjs` | an entity id that is not an id is 400 and is not looked up |
| `fin-b08-blueprint-declines.test.mjs` | a paste with no letter in it is 400 `letter_required` for a client and for staff |
| `fin-b08-partner-copy.test.mjs` | a page that is not on file is 404: no model call, no tokens metered, nothing saved |

The plug-in `fin-b08-door-contracts.mjs` now lists `fin-b08-door-guards.test.mjs` as evidence on the 20 rows whose
handler it covers (so the catalog names it); no row id changed.

### The 79 that still survive, by kind (none is a claim of a row)

| Kind | Count | Why it cannot be judged here |
|---|---|---|
| A. Database error mapping (`CLIENT_DATA_ERRORS`, `dbDown`, a named input error, a CHECK-constraint message) | 27 | needs a real database error code; a stand-in that returns rows cannot raise one (judged by the `.pg.test.mjs` files, which the brief forbids running against production) |
| B. Another action of the same file that is not in this batch's rows | 34 | `banking` create_account / set_cycle / replace_holdings; `contracts` remind; `inquiry-cases` create / update / clear_inquiry / close; `inquiry` cases and status; `money/banks` POST actions; `money/tasks` GET. Judged under their own rows or left red on purpose |
| C. Equivalent or unreachable | 18 | a second layer gives the same answer (partner-pages PATCH owner check, contracts unknown action falls to `default`, `sign` id shape checks covered by the signature, banking `no_org_on_session` answered again by `requireClientInOrg`); or the branch cannot be reached by the handler's own call (`documents-upload` `ownsClient`, `education-enroll` `org_required`); or a store that only returns null for a client the earlier company check already refused |

### Shared lines touched this generation

| File | Edit |
|---|---|
| `src/pulse/catalog/proofs/fin-b08-door-contracts.mjs` | (our file) `fin-b08-door-guards.test.mjs` added to 20 entries; two of the three `FIN_B08_NOT_ATTACHED` reasons gained one sentence each |
| `src/pulse/catalog/generated.json` | regenerated with `npm run pulse:catalog` (evidence strings only; 3975 mapped, 3919 wired, 23 red, unchanged) |

No shared list, count or chain line was touched: no row was attached or detached, so the three count lines in
`gap-door-batch-routes.mjs`, `gap-door-batch-routes.test.mjs` and `door-batch-route-result.test.mjs`, the
`door-proof.mjs` chain and the `door-proof.test.mjs` regex are exactly as the earlier passes left them.

### Commands run (generation 3)

- `node scripts/pulse/count-not-proved.mjs`: 819 total, route lane 101, this batch 3 (unchanged), before and after.
- `node --test src/http/fin-b08-*.test.mjs src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs`:
  318 tests, 318 pass, 0 skipped.
- `node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/door-*.test.mjs
  src/pulse/catalog/proofs/s1-door-contracts.test.mjs s2-door-contracts s3-door-contracts fin-b08-door-contracts
  src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs`: 1127 tests, 1127 pass.
- `node scripts/lint.mjs`: 3594 files and inline scripts parse clean.
- `npm run pulse:catalog`: 3975 mapped, 3919 wired, 23 red; `generated.json` evidence strings changed.
- Guard-off sweep: twice over 297 mutants (not kept), each restored; worktree clean after each run.
- A probe script (not kept) ran each handler with a staff session whose `org_id` is null, once as is and once per
  guard turned off, to tell a guard that changes the answer from one that a second layer repeats.

Still stated plainly: every attached row is a **practice test**, not a live check. The three red rows are product
findings 1, 3 and 4 above, not gaps in the test work.
