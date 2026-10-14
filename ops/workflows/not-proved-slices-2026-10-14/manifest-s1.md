# Slice 1 manifest — money routes and money screens

Branch `prf/s1-money`, built from `origin/main` at `cda3951d4`. Nothing was pushed.

This file has two rounds. Round 2 (the repair) is first, because it changes the
numbers. Round 1 (the first build) is kept below it.

## Round 2 — the repair (checker found proofs that stayed green)

An independent checker broke the product on purpose and found proofs that stayed
green when the product was wrong. A proof that cannot fail is not a proof, so
every one was fixed or taken back.

### The count now

| | Rows |
|---|---|
| Slice 1 rows | 149 (40 routes, 109 screen controls) |
| Not proved at the start of round 2 | 52 |
| Not proved after round 2 | 55 |
| Taken back to "not proved" in round 2 | 3 (all screen controls) |
| Proved now | 94 (39 routes, 55 screen controls) |

Measured with the four lanes offline (stub fetch that answers 200 with an empty
body). Rows with status `NOT_PROVED` whose id is in `slice-1.json` were counted:
52 before the repair, 55 after. `src/pulse/catalog/generated.json` was rebuilt
with `node scripts/pulse/compile-catalog.mjs`.

### The four findings, and the fix for each

| Finding | What was wrong | Fix |
|---|---|---|
| 1. marketing/meta/load `all:true` | Only one video was queued in the test. Taking the "approved only" or "not loaded yet" filter out of `queueLoads` stayed green. | New tests give a stand-in ad-video table (approved, delivered, draft, no stamp, no approver, already loaded, not an ad, other company). The stand-in keeps a row only while the SQL text carries that row's condition. The test says exactly which jobs are queued, that a load already waiting is reused, and that nothing queues when nothing qualifies. |
| 2. Deal calculator Minimum payment % | The test typed 3, the same as the page default and the page fallback. | The test now types fee 12 and minimum 4 (the boxes open on 10 and 3), and checks the net and monthly numbers the answer paints (4,800 and 400). |
| 3. Launch Turn on, disabled while budget unknown | The bound test never opened an unknown-budget row. | The row is now also bound to the test that opens the unknown-budget row, and that test now also checks the button is disabled and the reason is shown. |
| 4. From picker (1 account) and Stop this move (only while) | No fixture had one account to pick from, and every history row could be cancelled. | New tests: one account to send from shows fixed text with a hidden id, and Yes sends it. A settled move shows no Stop button and an open one does. |

### Same weakness, found elsewhere and fixed

| Class | Where | Fix |
|---|---|---|
| Box typed with the page's own default | Set up this move (From and Date) on both transfer pages; Add a payment plan "Owed to" | Different values typed; the body is checked. |
| Only one branch of a conditional | Set up this move: To = a bank account (only "Fundhub" was tried); product editor category; default price under the minimum | Added the other branch to each. |
| "Staff only" never tested from a client | Payments (add plan, record, settle) on two pages; Set up this move on two pages | A client login now opens each page and sees none of them. |
| Compound row, half covered | "Offer stack ... per closer" (closers had no stack); roster close rate and funded rate; PAID MTD (no old-month paid row) and ACCRUED (no voided row); "Amount needed" chip (negative case not bound); batch cap (only the month cap was tried); "+ Add a business (up to 20)" (cap never reached); Winner's Board and Live Trial "button stays off until the price is read" (title promised it, test did not check it); Stop this move on the FinanceOS tab "asks first" | Added the missing half and bound the test. |
| Org check decided by a stand-in flag, or only by the parameter | closer-deck, repair/enroll, payment-links, finance-command, partner-addons (buy and cancel), products, content/tiles, slo-connections, paid-services, funding-rounds, partners, commission-rules, resume_ad, marketing/meta/load (one video), affiliate-portal | The stand-in is now a small table with two companies. It keeps a row only while the SQL text carries that condition (`src/pulse/catalog/proofs/s1-proof-kit.mjs`). Taking the condition out of the SQL puts the other company's row on top and the test goes red. |
| Role gate tried with one allowed role and one denied role | commission-rules, sales-floor, read/partners, funding-rounds, finance-command, meta/load, partner-addons, closer-deck, repair/enroll, resume_ad, products, content/tiles, slo-connections, payment-links (GET and POST), trials provision and convert, affiliates/refer, paid-services | Every staff role is tried (8 roles), and the exact list that gets in is checked. `rolesLetIn` in the kit does the loop. |
| Test title promised more than the test did | `commissions approve` ("in this company") checked status but not the company condition | One text assertion added in `src/http/commissions-handler.test.mjs` for `WHERE org_id = $1` and the id list. |

### Rows taken back to "not proved" (3)

| Row | Why no honest test is possible from a browser |
|---|---|
| soft-pull-approve.html "I agree - submit soft-pull approval: saves consent, SSN and DOB, businesses, a portal account and sign-in email, and mints the exact-total checkout" | The page sends the consent, SSN, DOB and businesses and paints the checkout. The portal account and the sign-in email are made by the server (`api/soft-pull-approve.mjs`). A browser test cannot see them. The server side needs its own handler proof. |
| ops-admin.html "email_invoice_backlog (server): emails every invoice ... bounded to 200" | The page only sends the action. "Bounded to 200" is the server's limit, and that is a route row in slice 2. The page tests stay as extra cover. |
| marketing-command-center.html "Frame: cost sheet and two-tap confirm sheet drawn before every paid tap (Cancel / yes)" | "Every paid tap" is more than one spec can show. One paid tap (the avatar row) is tested. |

The three spec files still run and pass; they are simply no longer the proof of
those three rows.

### Can each proof fail now? (break, then red, then restored)

All were done with `git checkout -- <file>` after each break. Every one went red.

Screens (real browser). Each break was made once in the page file, the spec was
run, it went red, and the file was restored with `git checkout`:
- closer-dashboard.html: min, fee, deposit and debts sent as fixed numbers, fee
  and deposit crossed, guard % fixed, draw fixed (7 breaks, 7 red).
- cc-tab-launch.js: turn-on enabled while budget unknown; button never disabled
  (2 red). Removing only the second layer (the early return inside `turnOn()`)
  stays green on purpose: the button is still disabled, so nothing a person sees
  changes.
- money-transfers.js: always a select; always fixed text; Stop button for any
  move; From read from the first option; Date read from today; To id dropped;
  To kind fixed; staff form shown to a client (8 breaks, 8 red).
- money-payments.js: staff flag always on; plan controls without the staff check;
  add form without the staff check; owed_to fixed; kind fixed (5 breaks, 5 red).
- products-commissions.html: category fixed; default under the minimum allowed;
  default over the maximum allowed; variable flag fixed; PAID MTD counts old
  months; ACCRUED counts voided rows; ACTIVE RULES off by one; variable caption
  off by one (8 breaks, 8 red). One more (the product-read writer of the ACTIVE
  RULES tile) stays green because the rules read writes the tile last (finding 7).
- sales-floor.js: per-closer stack removed; close rate shows funded rate; funded
  rate shows close rate (3 red).
- funnel.js and the Board page: button not disabled at start; always enabled;
  last name sent as first name; track dropped (4 red).
- pipeline.html: chip always shown; chip never shown (2 red).
- soft-pull-approve.html: Add button never disabled (1 red). The page default of
  20 is overridden by the server's number, so changing the default alone stays
  green.
- marketing-cc-settings.js: batch cap box writes the month field; month warning
  reads the batch cap (2 red).

Routes (real handler, stand-in database): 39 breaks in the handlers, 9 more in
`queueLoads` (marketing/meta/load all:true), all red:
- 24 breaks of a SQL condition or lock (company, client, status filter, partner,
  add-on, the staff-id list on resume_ad, the ad-company lock),
- 15 breaks of a role gate (13 widened by one role, 1 narrowed, 1 role lock on
  resume_ad),
- 9 breaks inside `queueLoads` all:true (status, approved stamp, approver, not
  loaded, an ad, company, and a widened approved list).
Three breaks stayed green on the first run and were fixed: one of my break texts
hit a different statement than the one I meant (redone, red), and two stayed
green because my stand-in read both halves of one SQL statement (the stand-in now
reads only the UPDATE half, red).

## Shared lines I touched in round 2 (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/generated.json` | Rebuilt again. After merging all slices run `node scripts/pulse/compile-catalog.mjs` and take its output. |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | The "red count" went from 1,005 to 1,006. Only one of the three rows taken back is counted red by that test; the other two keep their older browser-batch proof (as they did at the start), but the pulse lane still says NOT_PROVED for them. If other slices change this number, add the changes together and use the number the test prints. |
| `src/http/commissions-handler.test.mjs` | One added assertion line (org condition). |
| `e2e/closer-dashboard-calculators.spec.mjs`, `e2e/cc-tab-launch.spec.mjs`, `e2e/money-transfers-clicks.spec.mjs`, `e2e/marketing-cc-settings.spec.mjs`, `e2e/soft-pull-approve-clicks.spec.mjs` | Existing specs, stricter (added tests or assertions only; nothing removed or skipped). |

New file: `src/pulse/catalog/proofs/s1-proof-kit.mjs` (about 50 lines, tests only).

## Tests run in round 2

See the "Tests run" list at the end of this file.

## Product findings (the product itself is wrong or the row is stale)

Unchanged from round 1, and one new:
1. closer-deck `send_ebook`: the handler refuses the action as `unknown_action`.
2. Sales floor "Funded, not just sold" bar: `public/app/sales-floor.js` sets the bar to 0%.
3. Products & Commissions ledger table: Client and Rule version are hardcoded dashes.
4. `public/optimize.html` never POSTs to `/api/public/optimize`.
5. pipeline-cards: "no confirmed bank yes" and "no such stage" both answer 404.
6. GET read/sales-floor writes (Drive recordings on a GET).
7. NEW: Products & Commissions writes the ACTIVE RULES tile from two places (the
   product read and the rules read). The last one to answer wins. Today both say
   the same number; if a product's `active_rules` ever differs from the rule
   list, the tile will flicker between them.

---

# Round 1 — the first build (kept as written)

## The count

| | Rows |
|---|---|
| Slice 1 rows | 149 (40 routes, 109 screen controls) |
| Not proved before | 149 |
| Not proved after | 52 |
| Proved by this work | 97 (39 routes, 58 screen controls) |

How it was measured: the four lanes were run offline with a stub that always
answers 200, and rows with status `NOT_PROVED` whose id is in `slice-1.json` were
counted. The same script gave 149 before and 52 after.

## What was built (all tests, no product code changed)

### Routes (39 rows) — real handler, stand-in database, fake data

| File | Routes judged |
|---|---|
| `s1-door-staff-reads.test.mjs` | commission-rules (read, change rate), dashboard/kpis, read/sales-floor, read/funding-rounds, read/partners |
| `s1-door-partner-addons.test.mjs` | partner-addons buy, activate, cancel |
| `s1-door-money-moves.test.mjs` | pipeline-cards (Funded move), repair/enroll, campaigns/write resume_ad |
| `s1-door-closer-deck.test.mjs` | closer-deck send_pay_link, send_soft_pull (and send_ebook is refused) |
| `s1-door-trials.test.mjs` | trials/provision, trials/convert (convert and decline) |
| `s1-door-client-money.test.mjs` | affiliates/refer, paid-services, public/optimize POST |
| `s1-door-money-reads.test.mjs` | read/finance-command, read/affiliate-portal, marketing/meta/load |
| `s1-door-ladder.test.mjs` | products, content/tiles, slo-connections |
| `s1-door-payment-links.test.mjs` | payment-links (list, create, create invoice) |
| `s1-door-slo-pull.test.mjs` | public/slo-pull (CORS answer, SLO_DEMO_PAY stores nothing) |

Already-good tests were attached instead of rewritten for: commissions approve
(`commissions-handler.test.mjs`), finance/cards and finance/subscriptions
(`subscriptions-endpoints.test.mjs`), dashboard/seed (`dashboard-seed-handler.test.mjs`),
money/payments, money/transfers, public/funnel-checkout, public/slo-repair-checkout.

The plug-in `s1-door-contracts.mjs` binds each row to its tests. Its guard test
`s1-door-contracts.test.mjs` checks that every row is one exact map row, its
handler is routed, each named test file is a plain runnable test (not a database
test), and each named test title is really in that file.

### Screens — real browser, fake API answers
A runner test (`s1-display-specs.test.mjs`) runs Playwright on the bound spec
tests only and fails if one does not pass or a bound title did not run.
`s1-display-specs.mjs` holds the bindings (58 in round 1, 55 after round 2).

New browser specs (round 1):
- `e2e/s1-money-payments-setup.spec.mjs`: payments staff controls and setup steps, on the standalone page and the FinanceOS tab.
- `e2e/s1-money-transfers-tab.spec.mjs`: the same transfer buttons on the FinanceOS Transfers tab.
- `e2e/s1-products-commissions.spec.mjs`: ladder, tiles, editor price rules, SLO connections.
- `e2e/s1-sales-floor.spec.mjs`: funnel columns, roster, offer stack, cold deals.
- `e2e/s1-funnel-buy-forms.spec.mjs`: Board and Trial buy forms.

Existing specs attached (pages match the row): bank-amount-suggestion,
closer-dashboard-calculators, content-admin-clicks, marketing-avatar-row (now only
extra cover), marketing-cc-settings, cc-tab-ideas, cc-tab-launch,
money-transfers-clicks, ops-admin-outbound (now only extra cover), funded-amount,
products-commissions-ledger, controls-persist, soft-pull-approve-clicks.

## Shared lines I touched in round 1 (the integrator must merge these)
| File | Change |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | 1 import line + 1 `\|\| s1DoorContractsProof(...)` line in the plug-in chain |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line + `...S1_DISPLAY_SPEC_PROOFS,` in the plug-in list |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS`: routes-0 97 to 87, routes-1 110 to 93, routes-2 63 to 56, routes-3 40 to 35 (my decrease: 10, 17, 7, 5) |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | 310 to 271 (five places). My decrease is 39. |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | 310 to 271 rows, and unique handlers 240 to 215 |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | regex that names exact-handler proof tests now includes `s1-door-contracts`; the "known partial rows" sample changed from `affiliates/refer` to `auth/invite` |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 1,039 to 1,005 |
| `src/pulse/catalog/generated.json` | recompiled with `node scripts/pulse/compile-catalog.mjs` |

If other slices also lower these counts, add the decreases together and use the
number the tests print.

## Left not proved (round 1 list; round 2 added the three rows above)
| Rows | Why |
|---|---|
| route closer-deck send_ebook (1) | finding 1 |
| agent-editor authority switches (3), brand-studio Generation / Write page copy (2), campaign-manager (11), client-control-panel Declines + three bureau Pull buttons (4), client-portal unlock / pay / FinanceOS card / Copy (5), closer-dashboard pay link panel (3), inquiry-remover Enroll + PULL modal (2), money-next Do task (1), money-transfers "Open the page; 401" (1), pipeline Funded column (1), present.html (11) | no browser test presses these controls yet; each page needs its own fake-API harness |
| closer-dashboard Draw amount input (1), content-admin price shown box (1) | held by an explicit `always-red` contract in `display-saved-result.mjs` |
| products-commissions ledger table (1), sales-floor Hero (1), sales-floor Page open (1), optimize.html form (1), climate Gate button (1) | findings 3, 2, 6, 4; climate gate button is drawn by bundled scripts the page does not carry |

## For the integrator
- Run `node scripts/pulse/compile-catalog.mjs` once after merging all slices.
- Port note: my runner picks its own port from the process id. The staff batch
  picks from the process id too. If both flake, give each a different base.
- A manual Playwright run must set `CI=1` and its own `E2E_PORT`, or it may attach
  to another session's static server and test the wrong tree.

## Tests run (final, round 2)

Round 2, on this branch, with other builders running on the same Mac (load
average 10 to 177):

- The ten route files plus `commissions-handler.test.mjs`: 79 tests, 79 pass, no
  database.
- `s1-door-contracts.test.mjs` (the guard): 6 pass.
- The four lanes, offline, counted for the slice: 55 NOT_PROVED of 149 (52 before
  the repair).
- Each of the 24 browser tests I added or changed, run 10 times alone with
  `--repeat-each=10`: 240 of 240 pass.
- Every catalog, gap-catalog and gap-door-batch test file (70 files, 1,339
  tests), the group command, run three times:
  - run 1: 3 failed. One was real and fixed (the display red count, now 1,006).
    Two were pre-existing tests that timed out under load (`closer-deck.test.mjs`
    took 44 s inside `flow-result-proofs`; `display-contracts-ef-public-2` lost a
    row). Both pass alone (27 of 27 and 8 of 8).
  - run 2: 1 failed, `read-reviewed-e2e` (the `agent-editor-promote-demote` spec,
    which waits 5 s for a select to fill).
  - run 3: 3 failed, the same `closer-deck` timeout and the same
    `agent-editor-promote-demote` wait, counted twice by two suites.
  None of the failing tests touch a file in this slice. They pass alone:
  `agent-editor-promote-demote` 3 times in a row (24 of 24), `closer-deck` 27 of
  27, and the four suites `flow-result-proofs`, `display-proof-cases`,
  `s1-display-specs` and `read-reviewed-e2e` passed together except the
  `agent-editor-promote-demote` wait again (28 of 29). I did not change those
  tests. They need a longer wait or a quieter Mac.
- `npm run lint`: 3,467 files parse clean.

