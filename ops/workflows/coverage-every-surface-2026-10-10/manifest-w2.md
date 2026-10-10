# W2 Money B: manifest

Batch: `ops/workflows/coverage-every-surface-2026-10-10.md`. Unit: W2, payments, checkouts, money moves, ad spend.
Builder branch: `cov/w2-money-payments`. Folder: `.claude/worktrees/cov-w2`. Written 2026-10-10.

This unit built checks. It fixed nothing. Nothing was pushed, merged or sent. The board file was not touched.

## In one line

Twelve new money checks and one new hourly beat, all read only, all proved on live data. Sixteen surfaces left the unsorted list.

## The checks

Each row is one yes-or-no question a buyer or a client would feel. The ids are written in the lane files under `src/pulse/coverage/`.

| Brief item | Check id | The question | Red when |
|---|---|---|---|
| 1 | `checkout:paid-service` | Did every "do it for me" dispute round get a link that works, and once paid, did it start? | Priced 10 minutes with no link. Waiting with no link. Money in the Commas inbox for it and the request never moved to paid. Paid 20 minutes and never staged. Closed failed with the buyer's money on it. Staged and waiting on a person over 48 hours. A live checkout link answers 404, 410, a server error, or is not a web address (HEAD, then GET only if the host refuses HEAD). |
| 2 | `checkout:repair-price` | Did the repair plan a buyer picked get a link at the price the door wrote down? | The payment link asks for another amount than the `slo.repair_checkout_started` event. No link row for the event. Not a repair link. A price that moved since is a note, not red. |
| 2 | `checkout:funnel-door` | Can a stranger on a /partner/ page see a price and press buy? | The till says checkout is not ready, or autopsy, board or trial has no price, is turned off, or is gone. 500, 404, or not JSON. |
| 2 | `checkout:funnel-no-sale` | Did people press buy on a /partner/ page and nobody ever paid? | 3 or more presses on one item in 7 days (a press under a day old is left out) and no payment for any of them. Under 3 presses is "nothing to judge" (code `low-traffic`, re-checked each morning). |
| 3 | `finance-os-setup:paid-turns-on` | Did every client who paid the FinanceOS setup fee get FinanceOS turned on? | A paid setup link (20 minutes old) with no finance-os plan opened for it and no active finance-os plan. |
| 3 | `finance-os-setup:price-set` | Does the Setup page have a price, or does it show "$X"? | `FINANCE_OS_SETUP_FEE_CENTS` is not a whole number of cents above zero. A mask on the laptop copy is a skip. |
| 4 | `payments-unmatched:receipt-waiting` | Is Commas money sitting on the Payments tab with nobody having touched it? | An `payment_unmatched` row over 1 day old and no staff action on that client since. |
| 4 | `payments-unmatched:installment-late-no-flag` | Is a plan payment a week late with no CSM task and no hold from the money helper? | 8 or more days late (UTC day), open plan, no invoice, not a sample plan, no `money-agent:clarity_installment:<id>:3` row. |
| 5 | `subscriptions:past-due` | Is every past-due plan on our own billing rail being retried or in a person's hands? | No clock can ever pick it up. Never tried after 2 sweeps. Retry missed. Charge went out and never came back. Out of tries. Paid but still past due. |
| 5 | `subscriptions:addon-paid-no-plan` | Did every partner who paid for a monthly add-on get the plan? | A paid partner add-on link (20 minutes old) with no plan covering the pay day. Lead Flow is per call and has no plan on purpose. |
| 6 | `money-moves:stuck` | Is any money move a client said yes to stuck? | Approved and dated before today (New York day). Sent and not settled in 10 days. Failed, declined or returned with its task still open. No real client move on file is "nothing to judge" (code `not-connected`, re-read each morning). |
| 7 | `ads-meta:matches` | Does what we show for each campaign (running or paused, daily budget) equal what Meta says? | Meta's campaign list (GET only, Bearer header, up to 3 pages) disagrees with our row AND Meta stopped changing it before our row was last saved. A change in Meta since our last sync is a note, not red. A running campaign Meta does not list is red only when the list was read to its end. |
| 7 | `ads-meta:load-jobs` | Are the Load-to-Meta jobs moving? | `meta_load` jobs failed in 7 days, queued over 45 minutes, claimed and silent over 31 minutes, or an approved video holding a load error and never loaded. |

Files: `gap-checkout.mjs`, `gap-finance-os-setup.mjs`, `gap-payments-unmatched.mjs`, `gap-subscriptions.mjs`, `gap-money-moves.mjs`, `gap-ads-meta.mjs`, and the helper `money-reads.mjs` (not a lane). The brief's `checkout:repair-and-funnel` is three rows (repair-price, funnel-door, funnel-no-sale) so each has one question. The brief's `payments:unmatched` is two rows.

New lane files were used on purpose. Existing lane tests pin exact lists, and other builders may touch `gap-finance-os.mjs` and `gap-partners.mjs`.

## The hourly beat

`src/pulse/beats/beat-checkout-doors.mjs` (id `checkout-doors`, kind probe, damp 2, 9 second deadline).

- `funnel-till`: GET the till, same rules as the morning lane.
- `repair-door`: GET the POST-only repair door. It must answer 405 with its own words.
- `paid-service-link`: HEAD the newest 3 waiting hosted checkout links (all at once). No link waiting is a skipped step.

It never presses Pay. The judging rules are in `src/pulse/beats/lib/checkout-doors.mjs` so the beat and the morning lane cannot disagree.

## Surfaces sorted (16, all out of the baseline)

In `src/pulse/tripwires.mjs` TRIPWIRES, each with its check ids:

`route:paid-services`, `route:public/slo-repair-checkout`, `route:public/funnel-checkout`, `route:money/setup`, `route:money/payments`, `route:money/transfers`, `route:finance/subscriptions`, `route:finance/cards`, `route:partner-addons`, `route:campaigns/write`, `desk:money-setup.html`, `desk:money-payments.html`, `desk:money-transfers.html`, `desk:campaign-manager.html`, `job:finance-os-money-transfers`, `job:subscription-billing-sweeper`.

Baseline: 494 to 478. Nothing was added to it.

## Shared files I touched (for the integrator)

Only my own lines. Pull `origin/main`, re-run the tests, merge one at a time.

| File | What I did |
|---|---|
| `src/pulse/coverage/modules.mjs` | 6 literal lines: gap-ads-meta, gap-checkout, gap-finance-os-setup, gap-money-moves, gap-payments-unmatched, gap-subscriptions. |
| `src/pulse/beats/index.mjs` | 1 line: beat-checkout-doors. |
| `src/pulse/tripwires.mjs` | One block of 16 entries added at the end of TRIPWIRES. |
| `src/pulse/tripwires-baseline.json` | 16 lines deleted. |
| `src/pulse/tripwires.test.mjs` | `BASELINE_MAX` 494 to 478. Other builders lower it too. After the merge, set it to the final length of the baseline file. |
| `src/lib/no-unfenced-transmit.test.mjs` | One entry in `ALLOWED_RAW_FETCH`: `src/pulse/coverage/money-reads.mjs`. It is the only new file that makes a network call. The lanes call its `request()`, which throws on anything but GET or HEAD. |
| `docs/journeys/heartbeat-flow.md` | One bullet about the new beat. |
| `src/pulse/self-audit.mjs` | Not touched. The audit builds its list from each lane's `CHECK_IDS`. `audit:expected-present` showed all 1040 checks present, mine included. |
| `src/pulse/na-conditions.mjs` | Not touched. Both "nothing to judge" rows use existing lane codes (`low-traffic`, `not-connected`) and answer through the lane's own `naVerify`. |

## Proof

All run in this folder, 2026-10-10. Live reads were `BEGIN READ ONLY`, GET and HEAD only, nothing written, sent or charged.

- `npm run pulse:prove` (builds the real bundle): **OK**. 52 steps, 640 rows from the lanes. 49 of 49 gap lanes answered. `audit:expected-present`: all 1040 checks showed up, mine included. Slowest lane 11 s (`gap-finance-os`, not mine). My six lanes each ran under 1 second.
- `npm run pulse:prove -- --beats`: **OK**. 10 beats from the built function, 0 red, 0 cut, 0 refused, 4.6 s. `checkout-doors` green in 1.3 s with `paid-service-link` skipped (no link is waiting on live data).
- `node scripts/pulse/run-beat.mjs --selftest checkout-doors`: green when the till is sound, red at `funnel-till` when it says checkout is not ready.
- The SQL under every new row was also run for real, on made-up tables, inside `BEGIN READ ONLY`: 54 + 24 + 36 + 37 + 24 + 40 tests in the six lane test files, all passing (DATABASE_URL set for those six files only, never for the suite).
- New test files: 6 lane tests, `money-reads.test.mjs` (9), `beat-checkout-doors.test.mjs` (15), `checkout-doors.test.mjs` (9). Every row has a PASS test and a FAIL test.
- `npm run lint`: 3244 files parse clean.
- `npx tsc --noEmit`: 1 error, in `src/marketing/filmed-receive.mjs` (a file I did not touch). None in my files.
- `npm test` with no database: unit half 20046 tests, 20021 pass, 2 fail, 23 skipped. Pg half 927 tests, 83 pass, 0 fail, 844 skipped (no database, as always). The 2 failures are not mine and fail the same way without my changes: `climate page: no approval odds...` (fails on main too) and `registry: every registry row names a real handler or desk file` (a git-ignored `public/leads/...` page that this folder does not have).
- One test of mine failed on the first run: the list order in `modules.mjs` (`gap-finance-os-setup` and `gap-payments-unmatched` must sort before their plain siblings). Fixed, and the second full run is the one counted above.

## Live reds found (real breaks, plain words)

1. **FinanceOS setup has no price.** `finance-os-setup:price-set` is RED on live data. The name `FINANCE_OS_SETUP_FEE_CENTS` is not set on Netlify production (names checked, no values read). Step 1 on the Setup page shows "$X" and the Pay button answers 409. The price is Chris's call. W5 puts the same key on the keys list, so expect two red lines for one cause.

Nothing else is red on live data from these checks. Every other new row is PASS or "nothing to judge" today, with reasons:

- `checkout:paid-service`, `finance-os-setup:paid-turns-on` (the 2 paid setup links belong to test clients), `payments-unmatched:*` (the one old plan is a sample plan), `subscriptions:*` (3 plans, all active), `ads-meta:*` (2 paused campaigns agree with Meta) are green.
- `money-moves:stuck` is green: 1 practice move, settled.
- `checkout:funnel-no-sale` is "nothing to judge": 0 presses in 7 days.

## Breaks the checks are built to catch (not red today, found while reading code)

- **A paid dispute round would not start.** `src/handlers/paid-service-payment.mjs` is not registered in `src/register-all.mjs` (checked again 2026-10-10). A real payment would leave the request at `awaiting_payment`, and the hourly sweeper would cancel it after 7 days with the buyer's money paid. `checkout:paid-service` goes red the first time it happens (money in the Commas inbox naming the request, request never paid).
- **The billing sweeper has no charger.** `src/subscriptions/charger.mjs` ships an empty list, so a due plan is skipped before an attempt row is written. `subscriptions:past-due` goes red for any past-due plan on our own rail.
- **Funnel buyers leave no row.** `api/public/funnel-checkout.mjs` writes its event before it asks Commas for the link and saves no link row. A failed link and an abandoned cart look the same, so the check needs 3 presses and no sale.

## Leftover cards (for the board; I did not edit the board)

- [ ] Register `src/handlers/paid-service-payment.mjs` in `src/register-all.mjs`. Until then a paid dispute round never reaches `paid`.
- [ ] Set `FINANCE_OS_SETUP_FEE_CENTS` on Netlify production (owner price).
- [ ] The billing sweeper has no charger, and an active plan that is due but never charged is not read by any check (the brief named past-due plans only).
- [ ] Funnel purchases need a row, so a failed link can be told from an abandoned cart.
- [ ] `ads-meta:matches` compares campaign status and daily budget only. Ad set budgets, ad status and delivery are not compared with Meta.

## Numbers I had to name (owner can change; each has a source)

| Setting | Value | Where it comes from |
|---|---|---|
| Quoted request with no link | 10 minutes | `CHECKOUT_LINK_WAIT_MS` in gap-payments |
| Paid and not staged | 20 minutes | `INBOX_PROCESSING_WAIT_MS` in gap-payments (the inbox clock retries until a claim goes stale, plus 5) |
| Staged and waiting on a person | 48 hours | `HUMAN_QUEUED_HOURS` in gap-soft-pull |
| Unmatched Commas receipt waits | 1 day | One money-helper cycle. The code has no clock for it. |
| Late plan payment | 8 days | `LADDER` rung 3 is 7 days (held equal by a test), plus 1 day for the daily run |
| Settle window for a money move | 10 days | **My choice.** The engine states none. An ACH debit, its hold, then the credit leg. `SETTLE_WINDOW_DAYS` in gap-money-moves. |
| Funnel presses before "no sale" means something | 3 in 7 days | Same number gap-leads uses (`MIN_EXPECTED_LEADS`) |
| Two sweeps before a past-due plan is "unworked" | 2 hours | Sweeper runs hourly at :17 |
| Load-to-Meta queued / claimed | 45 / 31 minutes | `QUEUE_WAIT_MS` in gap-marketing-queue / `STALE_AFTER_MINUTES` 16 plus the 15 minute clock |

## Left undone

- Not pushed, not merged, no pull request. The integrator merges.
- The board file and its task table were not edited (the override said so).
- No `-actual.md` journey changed: no product journey changed.
