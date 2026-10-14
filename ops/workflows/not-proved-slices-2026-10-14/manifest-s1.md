# Slice 1 manifest — money routes and money screens

Branch `prf/s1-money`, built from `origin/main` at `cda3951d4`. Nothing was pushed.

## The count

| | Rows |
|---|---|
| Slice 1 rows | 149 (40 routes, 109 screen controls) |
| Not proved before | 149 |
| Not proved after | 52 |
| Proved by this work | 97 (39 routes, 58 screen controls) |

How it was measured: the four lanes (`gap-door-batch-routes`, `gap-catalog-display`,
`gap-catalog-flow`, `gap-catalog-reads`) were run offline with a stub that always
answers 200, and rows with status `NOT_PROVED` whose id is in `slice-1.json` were
counted. The same script gave 149 before and 52 after.

## What was built (all tests, no product code changed)

### Routes (39 rows) — real handler, stand-in database, fake data
Each file calls the real `api/` handler and checks the exact result. Each also
checks the refusals (wrong role, other company, bad input) and that nothing was
written on a refusal.

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

### Screens (58 rows) — real browser, fake API answers
A runner test (`s1-display-specs.test.mjs`) runs Playwright on the bound spec
tests only and fails if one does not pass or a bound title did not run.
`s1-display-specs.mjs` holds the 58 bindings.

New browser specs:
- `e2e/s1-money-payments-setup.spec.mjs` (20 tests): payments staff controls and setup steps, on the standalone page and the FinanceOS tab.
- `e2e/s1-money-transfers-tab.spec.mjs` (4 tests): the same transfer buttons on the FinanceOS Transfers tab.
- `e2e/s1-products-commissions.spec.mjs` (9 tests): ladder, tiles, editor price rules, SLO connections.
- `e2e/s1-sales-floor.spec.mjs` (10 tests): funnel columns, roster, offer stack, cold deals.
- `e2e/s1-funnel-buy-forms.spec.mjs` (6 tests): Board and Trial buy forms.

Existing specs attached (pages match the row): bank-amount-suggestion,
closer-dashboard-calculators, content-admin-clicks, marketing-avatar-row,
marketing-cc-settings, cc-tab-ideas, cc-tab-launch, money-transfers-clicks,
ops-admin-outbound, funded-amount, products-commissions-ledger, controls-persist,
soft-pull-approve-clicks.

## Can each proof fail? (rule 2)
Each handler or control was broken on purpose once, the test went red, then the
file was restored with `git checkout`.
- Route files: 30 handler breaks were run (a status code or a key value). 29 went
  red on the first try. The 30th (paid-services) used the wrong line and stayed
  green; it was redone on the right line and went red.
- Browser specs: money-payments.js, money-setup.js, money-transfers.js,
  products-commissions.html, sales-floor.js, funnel.js, ops-admin.html,
  soft-pull-approve.html, closer-dashboard.html were each broken once; all red.
  Two first tries stayed green because the anchor line was not the real logic;
  both were redone and went red.

## Shared lines I touched (the integrator must merge these)
| File | Change |
|---|---|
| `src/pulse/catalog/proofs/door-proof.mjs` | 1 import line + 1 `\|\| s1DoorContractsProof(...)` line in the plug-in chain |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | 1 import line + `...S1_DISPLAY_SPEC_PROOFS,` in the plug-in list |
| `src/pulse/coverage/gap-door-batch-routes.mjs` | `EXPECTED_ROUTE_GAP_COUNTS`: routes-0 97 to 87, routes-1 110 to 93, routes-2 63 to 56, routes-3 40 to 35 (my decrease: 10, 17, 7, 5) |
| `src/pulse/coverage/gap-door-batch-routes.test.mjs` | 310 to 271 (five places). My decrease is 39. |
| `src/pulse/catalog/proofs/door-batch-route-result.test.mjs` | 310 to 271 rows, and unique handlers 240 to 215 |
| `src/pulse/catalog/proofs/door-proof.test.mjs` | regex that names exact-handler proof tests now includes `s1-door-contracts`; the "known partial rows" sample changed from `affiliates/refer` to `auth/invite` (affiliates/refer is now proved) |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 1,039 to 1,005 |
| `src/pulse/catalog/generated.json` | recompiled with `node scripts/pulse/compile-catalog.mjs`. It is generated: after merging all slices, run that command again and take its output. |

If other slices also lower these counts, add the decreases together and use the
number the tests print.

## Product findings (the product itself is wrong or the row is stale)
1. **closer-deck `send_ebook`**: the row says it mints an ad-hoc priced link and
   sends it. The handler refuses the action as `unknown_action` (retired). The
   row stays not proved. `s1-door-closer-deck.test.mjs` pins the refusal.
2. **Sales floor "Funded, not just sold" target bar**: `public/app/sales-floor.js`
   sets the bar width to `0%` every time, so the bar never moves. The row says
   "rate and target bar". Left not proved.
3. **Products & Commissions ledger table**: the page hardcodes Client and Rule
   version as dashes, so the table cannot show those values the row names
   (also recorded in `display-saved-result.mjs`). Left not proved.
4. **`public/optimize.html`** has no "Pay for Audit" and never POSTs to
   `/api/public/optimize` (it only reads the config with GET). The row says it
   posts and mints the $32 checkout. The route itself is proved
   (`public/optimize` POST), the page row is left not proved.
5. **pipeline-cards**: when a Funded move has no confirmed bank yes, the handler
   answers 404 with `error: no_confirmed_approvals`, the same status as a missing
   stage. The screen cannot tell "no such stage" from "no bank yes yet" by status.
   (The refusal itself works and nothing moves.)
6. **GET read/sales-floor writes**: the row notes the read attaches Drive
   recordings (a write on a GET). That is not provable from a browser; left as is.

## Left not proved (52 rows) and why
| Rows | Why |
|---|---|
| route closer-deck send_ebook (1) | finding 1 |
| agent-editor authority switches (3), brand-studio Generation / Write page copy (2), campaign-manager (11), client-control-panel Declines + three bureau Pull buttons (4), client-portal unlock / pay / FinanceOS card / Copy (5), closer-dashboard pay link panel (3), inquiry-remover Enroll + PULL modal (2), money-next Do task (1), money-transfers "Open the page; 401" (1), pipeline Funded column (1), present.html (11) | no browser test presses these controls yet; each page needs its own fake-API harness |
| closer-dashboard Draw amount input (1), content-admin price shown box (1) | held by an explicit `always-red` contract in `display-saved-result.mjs` that asks for a saved receipt the page does not write. My browser specs for both pass, but the lane keeps them red on purpose. |
| products-commissions ledger table (1), sales-floor Hero (1), sales-floor Page open (1), optimize.html form (1), climate Gate button (1) | findings 3, 2, 6, 4; climate gate button is drawn by bundled scripts the page does not carry |

## Tests run (this branch)
- All 10 new `s1-door-*.test.mjs` files: pass (no database).
- `s1-door-contracts.test.mjs`: 6 pass.
- `s1-display-specs.test.mjs`: 18 pass (runs 17 spec files in Chromium).
- New specs: 20 + 4 + 9 + 10 + 6 pass.
- Every catalog, gap-catalog and gap-door-batch test file (118 files), run in two
  groups. The 98 files the focused proof test names: 1,634 tests; the only two
  failures were my runner's own static title check (fixed) and the staff-batch
  flake below. The other group: 1,211 tests, 1,210 pass; the one failure is the
  same staff-batch flake inside `display-proof-cases`.
- The flake: `staff display batch presses every mapped control` fails only when it
  runs with everything at once on a busy machine. One spec in it
  (`agent-editor-promote-demote ... a draft agent is not offered Return to
  shadow`) took 6.4 s and timed out. The same batch passes alone, twice. I did
  not touch that spec.
- `npm run lint`: 3,466 files parse clean.

## For the integrator
- Run `node scripts/pulse/compile-catalog.mjs` once after merging all slices.
- Port note: my runner picks its own port from the process id. The staff batch
  picks from the process id too. If both flake, give each a different base.
