# W1 manifest: Money A (funding, fees, payouts)

Batch board: `ops/workflows/coverage-every-surface-2026-10-10.md` (not edited by this workflow).
Branch: `cov/w1-money-funding`. Work folder: `.claude/worktrees/cov-w1`. Built 2026-10-10.

## In one minute

- I built **6 new daily checks** that read the money books and go red when the answer is wrong.
- They live in **one new file**: `src/pulse/coverage/gap-money-funding.mjs`. It runs as its own lane (its own step, 1.3 seconds).
- All 6 read **PASS today**, because the live books are empty: 0 funded rounds, 0 closeouts, 0 commission rows, 0 held payouts, 0 ClickFunnels sales.
- A PASS today means "nothing to judge yet". It does **not** mean the money chain was proved on live. The first real funded round is the first real test.
- I fixed **no** product bug. I found none of the board's leftover cards worse than the board said.

## The 6 checks

| Check id | The yes-or-no question | Goes red when |
|---|---|---|
| `funding:funded-no-bill` | Did every funded round get its closeout, its success-fee bill and its staff commission rows? | A round funded in the last 60 days, and older than 30 minutes, is missing any of the three. Also red when a card sits in Funded on the card-stacking board and the client has no funded round. The detail names the likely cause (no bank yes with an amount, no fee percent on the sale, no sale link, or F-07 did not run). |
| `funding:approved-no-amount` | Is any bank yes missing its dollar amount? | A bank yes (Approved) has no amount (or 0), is not marked "does not count", and is older than 1 day. Uses the same rule the biller uses. |
| `partners:payout-held` | Is an affiliate or partner payout stuck on hold, and why? | A payout is `held` and older than 1 day. The detail names the empty stamp: `partner_license_signed_at`, `tax_form_received_at` (affiliate) or `agreement_signed_at` (partner). |
| `commissions:ledger` | Is approved pay left unpaid, does a row name no rate, or does one pay scope have two open rates? | (a) a row is `approved`, not paid, for more than 35 days. (b) an `earned` or `approved` row names no rule, or names a rule that was not open on the sale date. (c) one pay scope has two open base rate versions. |
| `commissions:slo-map` | Does every product sold through ClickFunnels have an active map and a commission rule? | A product sold through ClickFunnels in the last 60 days has no active `slo_connections` row, or no front-end commission rule open now that covers it. |
| `books:sample-rows` | Did the dashboard "sample client" tool leave fake money in the live books? | A client `sample+<digits>@fundhub.demo`, or a payment `seed_t32_*` / `seed_tdep_*`, or a sale, commission row, invoice or message hanging off them, is in the live books and not flagged demo. |

## Honest limits (plain words)

1. **The money chain has no wait.** The closeout and the commission rows are written in the same call that funds the round. The bill is made by F-07 right after, with no sleep. So there is no "designed" delay. I used 30 minutes, which is the pulse's own limit for a workflow that does not sleep (`OPEN_LIMIT_MS`). I did not invent a number.
2. **There is no staff pay date anywhere.** `src/commissions/commission-model-open-questions.md` section 13 says who approves and when "is not modelled". So "approved and not paid past the payout date" cannot use a real date. I used **35 days** (one monthly cycle plus 5 days; the only payout rhythm in the code is the monthly affiliate run). It is a named constant, `APPROVED_UNPAID_AFTER_MS`. Chris can set the real number.
3. **"More than one open rate per product" cannot happen today.** The database refuses it (`commission_rules_no_overlap`, which also includes `sale_motion`). The check still reads it, so a migration that weakens the rule turns the morning red. It is tested red with made-up rows.
4. **An unmapped ClickFunnels order leaves no row anywhere.** `handleSloPaidWebhook` returns `unmapped` in the HTTP answer only. So `commissions:slo-map` can see a product that was sold and lost its map. It cannot see an order that was turned away. A product fix (record the turned-away order) would be needed first. Not done.
5. **The rule half of `commissions:slo-map` is weak while any all-products rule is open.** Today `CSM — upsell` has no product, so it covers every product. If that is the only rule that covers a product, the check reads green. It goes red the day that rule closes.
6. **A funded alt-fin (Lendflow) round is judged on the bill and the commission only.** It has no per-bank rows, so no closeout is ever made for it (the money chain says so). Not a break.
7. **A card-stacking round where a person marked every bank yes "does not count" bills nothing on purpose.** It is not red. This is the escape hatch in `src/funding/success-fee.mjs`.
8. **Held payouts stay red until fixed.** There is no look-back on them. Money owed to a person that cannot leave is a standing debt. `funding:funded-no-bill` and `funding:approved-no-amount` look back 60 days so old legacy rows do not shout forever.
9. **Sim receipts (`sim-pay-*`) are not counted as sample rows.** The board named the dashboard seed tool. The live books do hold 13 `sim-pay-` payments and one $5,000 sale made by the sim tool. That is a different tool, so it is not in this check. (See "found, not fixed".)

## Live reds found

**None.** All six checks read PASS on live data (read only, 2026-10-10). Why: the money books are empty. Counts read live: `funding_rounds` 0, `funding_closeout` 0, `commission_ledger` 0, `slo_connections` 0, `applications` 0, `invoices` 0, `affiliate_payouts` 1 (paid), `partner_payouts` 0, `commission_rules` 11, `sales` 1 (a sim sale).

## Found, not fixed (one line each, no fixing)

- 21 of 23 affiliates have no `partner_license_signed_at` and 23 of 23 have no `tax_form_received_at`. The board already has this card. The day the first payout run builds a row, `partners:payout-held` goes red on it. That is correct.
- The live `sales` table holds one $5,000 "Consulting Services Package" sale from a sim client (`sim-pay-1790742620460`) and the live `transactions` table holds 13 `sim-pay-` receipts (of 43). They are not flagged demo. `books:sample-rows` does not count them (see limit 9).
- `src/marketing/filmed-receive.mjs(159,75)` has a TypeScript error on `npx tsc --noEmit`. Not in my files. Not caused by this work.
- `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails **inside a fresh worktree** because `public/leads/c01cb7592c8b…/index.html` is git-ignored and is only on Chris's main folder. It passes in `/Users/chrisstanbridge/Developer/fundhub-platform` (8 of 8). Known trap, see `docs/lessons/pulse-lessons.md` 2026-10-09 "tripwire map". Not caused by this work.

## Files changed

New:
- `src/pulse/coverage/gap-money-funding.mjs` : the lane. Exports `CHECK_IDS`, `gapChecks`, the 9 SQL strings, 6 pure `judge*` functions, `roundProblems`, `heldReason`, and the named windows.
- `src/pulse/coverage/gap-money-funding.test.mjs` : 43 unit tests (fake database).
- `src/pulse/coverage/gap-money-funding.pg.test.mjs` : 27 SQL tests on a real Postgres. Skips without `DATABASE_URL`. Read only on a real database: `BEGIN READ ONLY`, every table shadowed by made-up rows, always rolled back.

Changed (shared lists, only my own lines):
- `src/pulse/coverage/modules.mjs` : +1 line, `["gap-money-funding.mjs", () => import("./gap-money-funding.mjs")]` in `GAP_FILES`, after `gap-meet.mjs`.
- `src/pulse/tripwires.mjs` : +10 entries in `TRIPWIRES` (below) and a 3-line comment.
- `src/pulse/tripwires-baseline.json` : -10 entries (494 down to 484).
- `src/pulse/tripwires.test.mjs` : `BASELINE_MAX` 494 down to 484, as the test comment tells you to.

Not changed: the shared board, any product code, any migration, any workflow, any existing test.

## Tripwire map sorts (all `impact: "money"`)

| Surface | Deep checks that go red on its break |
|---|---|
| `route:pipeline-cards` | `funding:funded-no-bill` (W3 adds its own board ids here after this merges) |
| `route:applications` | `funding:approved-no-amount`, `funding:funded-no-bill` |
| `route:commissions` | `commissions:ledger` |
| `route:commission-rules` | `commissions:ledger`, `commissions:slo-map` |
| `route:slo-connections` | `commissions:slo-map` |
| `route:dashboard/seed` | `books:sample-rows` |
| `route:read/affiliates` | `partners:payout-held` |
| `desk:products-commissions.html` | `commissions:ledger`, `commissions:slo-map` |
| `desk:client-control-panel.html` | `funding:funded-no-bill`, `funding:approved-no-amount` |
| `desk:affiliate.html` | `partners:payout-held` |

All 10 were removed from `src/pulse/tripwires-baseline.json`.

## For the integrator (merge notes)

- **Shared lines:** `modules.mjs` (1 line), `tripwires.mjs` (10 entries), `tripwires-baseline.json` (10 removals), `tripwires.test.mjs` (`BASELINE_MAX`). Nothing in `self-audit.mjs` or `beats/index.mjs` was needed: the self-audit builds its list from `CHECK_IDS` in the lane file.
- **`BASELINE_MAX`:** I set 484 (494 minus my 10). After all five workflows merge, set it to the final baseline length. It must never go up.
- **`route:pipeline-cards`:** W3 should add its own check ids to the same entry, not make a second one.
- **Lane id on the scorecard:** `gap-money-funding:funding:funded-no-bill` (and so on). The morning text ranks it as money, because `src/ops/morning-brief.mjs` matches every part after a colon against `TRIPWIRES[*].checks`.
- **Heartbeat law:** no new page, route, job or send path was added, so no new ping row. Each check is a lane row. No hourly beat was added: the brief asks for the daily lane, and law item 11 is for a new money surface. These are existing surfaces.
- **Journeys:** no journey changes, so no `-actual.md` edit and no changelog line.

## What was proved

| What | Result |
|---|---|
| `node --test src/pulse/coverage/gap-money-funding.test.mjs` | 43 of 43 pass |
| `gap-money-funding.pg.test.mjs` against the live schema (read only, shadowed tables) | 27 of 27 pass (RED and GREEN for every check) |
| Mutation check: removed the void-bill rule and the reversal rule from the SQL | 2 SQL tests went red, as they should. File restored. |
| All pulse tests: `src/pulse/*.test.mjs`, `src/pulse/beats/*`, `src/pulse/coverage/*` | 2752 tests, 2669 pass, 1 fail, 82 skipped (the 1 fail is the worktree-only registry trap above; it passes in the main folder, 8 of 8). The 82 skips are `.pg.test.mjs` files with no `DATABASE_URL`. |
| `npm run lint` | 3228 files parse clean |
| `npx tsc --noEmit` | 1 error, in `src/marketing/filmed-receive.mjs`, not my file |
| `npm run pulse:prove` (built api bundle, live data, read only) | **OK**: every listed file is in the bundle, no step threw or passed 20 s, no SQL error, nothing tried to write. 47 steps. All 44 gap lanes answered. All 1033 expected checks showed up. My lane took 1.3 s. |

I did **not** run the whole `npm test` suite (see the note below).

## An accident I caused, said plainly

I started the full `npm test` in my folder, then stopped it with `pkill -f "scripts/run-suite.mjs"`. That pattern matches **every** run-suite process on this Mac, not only mine. It almost certainly stopped another builder's `npm test` runner too (a `cov-w3` unit-test run was left with no parent). Their test run needs to be run again. No data was touched. I killed nothing else. I then stopped only my own leftovers, by my folder path.

## Left undone

- The whole `npm test` suite was not run in this folder (stopped on purpose, see above). Targeted runs above cover everything my change touches.
- A real staff pay date (so `commissions:ledger` can use it instead of 35 days). That is Chris's number to set.
- Recording a turned-away ClickFunnels order (limit 4).
- A "rate closed and nothing took its place" check. It would false-red on rates that were ended on purpose, so I did not build it.
