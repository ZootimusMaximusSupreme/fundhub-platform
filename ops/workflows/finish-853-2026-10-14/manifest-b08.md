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

Stand-in helpers (`src/testing/`): `fin-b08-tables.mjs`, `fin-b08-partner-tables.mjs`, `fin-b08-contracts-db.mjs`.

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

## Left red, with the exact reason (3)

1. `routes-1 route:contracts/sign : POST action=decline {reason}`. The handler records the decline on the
   signer (`declineSigner`, status `declined`, reason, time) and answers "the person who sent this has been
   told". Nothing tells the sender: no message, event or notify call follows `declineSigner` anywhere in
   `api/contracts/sign.mjs` or `src/contracts/signers.mjs`. The control says "recorded and the sender is
   told", and the second half has no code to judge. The recorded half is covered in
   `fin-b08-contracts-sign.test.mjs`, but attaching the row would call a half-built control green.
2. `routes-2 route:inquiry-cases (clear_inquiry)`. The control says the company comes from the session.
   `clearInquiry` (`src/inquiry-removal/cases.mjs`) reads and updates `inquiry_log` by id alone, and the
   session's company never reaches it; no row-level policy exists on `inquiry_log` in `db/`. A company
   boundary test goes red on today's product, and a test that skips the boundary would claim a control
   the code does not keep. (The existing `s3-inquiry-cases-handler.test.mjs` deliberately leaves
   `clear_inquiry` out of its "another company's case" list.)
3. `routes-1 route:soft-pull-approve : POST action=stamp_incorporated`. `api/soft-pull-approve.mjs:279`
   calls `stampIncorporatedAsStaff`, which is defined and imported nowhere in the repo. The action throws
   a ReferenceError and answers 500. There is no working result to judge.

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

## Commands run

- `node scripts/pulse/count-not-proved.mjs` before and after: 853 / 819 total, route lane 135 / 101, this
  batch 37 / 3.
- `node --test src/http/fin-b08-*.test.mjs`: 26 files, 248 tests, 248 pass, 0 skipped.
- `node --test src/pulse/catalog/proofs/fin-b08-door-contracts.test.mjs src/pulse/coverage/gap-door-batch-routes.test.mjs src/pulse/catalog/proofs/door-batch-route-result.test.mjs src/pulse/catalog/proofs/door-proof.test.mjs`: all pass.
- `npm run pulse:catalog`: regenerated `generated.json` (3975 mapped, 3919 wired, 23 red).
- Plug-in mutations seen red: a changed id, a removed chain line, a skipped test file.
