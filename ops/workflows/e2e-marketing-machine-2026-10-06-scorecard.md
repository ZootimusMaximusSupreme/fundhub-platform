# E2E scorecard — marketing machine + FinanceOS (2026-10-06)

Part 1 (Command Center, bridge, teleprompter): see Part 1 agent / `ops/workflows/e2e-marketing-machine-run-output.json`. This file adds **Part 2 — FinanceOS** only.

**Audit time (Arizona):** Oct 7, 2026, ~12:04 a.m.  
**Sim client:** Test Test `f1cb9c27-f858-4db1-b6bb-4eddc898bb8e` (S1 sample, board `finance-os-wave5-2026-10-06.md`)  
**Rules:** test only, no fixes, no live money moves, Plaid sandbox, no outbound SMS/email fired in this pass.

**Wave 5 gate:** Board merged W1–W5 + W7 (live proof on ship `6234ead8`). Table still lists W6 `queued`; live DB has agent **FOS-01** (shadow). W6 code is live; full live flip not scored here.

| # | Test | Result | Proof |
|---|------|--------|--------|
| 13a | `/app/financeos.html` — all 16 tabs at **390×844**, real data, no core “coming soon” | **PASS** | `npm run test:e2e:live -- e2e/live-financeos-part2.spec.mjs` (390 run green). API `GET /api/money/overview` staff Way-A: personal cash **1,338,500**¢, business **2,140,600**¢ = `moneyOverview()` SQL same numbers. Overview UI at 1280 shows **$13,385** personal cash. |
| 13b | Same page at **1280×900** | **PASS** | Headless Playwright staff login: all wave5 tabs `overview,next,plan,banks,strategy,fundability` — `tabFailures:[]`. (First live config retry hit `net::ERR_ABORTED`; rerun passed.) |
| 13c | `/app/finance-os.html` staff desk loads (390 + 1280) | **PASS** | Live Playwright: body visible, no console errors (390 + 1280). |
| 14a | Paid setup fee turns FinanceOS **on** for sim client | **FAIL** | SQL: `subscriptions` tier `finance-os` for Test Test = **0 rows**. `payment_links` description `Finance OS setup` = **0 rows**. `GET /api/money/setup`: `entitled: false`, step `pay: false`, `live: false`. No client in DB has both paid setup + active finance-os sub. |
| 14b | Staff see FinanceOS card / open from client panel | **PASS** | Playwright: `https://fundhub.ai/app/client-control-panel.html?client_id=f1cb9c27-…` — `#ccp-link-financeos` visible, not hidden. Opens `financeos.html?client_id=…`. |
| 15 | Loans: due date, payment, reminders; loan on Overview; Plaid sandbox loan dates | **PASS** | SQL: SBA Loan `account_statement_cycles.payment_due_day=1`, `minimum_payment_cents=105000`. `moneyOverview()` upcoming: `loan_due` SBA Loan **2026-11-01**, **105000**¢. Plan pins include `dues` source (6 pins total from `GET /api/money/plan`). |
| 16 | Commas payment marks Clarity/BNPL installment; merchant API pull (Commas/Whop) | **FAIL** | Clarity installments show `paid_cents>0` (seed/history), but `payment_links` paid = **0**, `merchant_payments` for client = **0**. `merchant_connections`: provider `api`, status `active` (pull wired). **Not proved:** a Commas webhook marking an installment in this pass. |
| 17a | `GET /api/money/plan` — dated pins from plan sources | **PASS** | HTTP 200; **6 pins**; sources include `dues`, `clarity`, `agent`. |
| 17b | `GET /api/money/banks` — bank strategy | **PASS** | HTTP 200; body has `recommended_banks`, `card_stacking`, `next_round`, `relationships`. |
| 17c | `GET /api/money/fundability` — now / projected / per business | **PASS** | HTTP 200; `now`, `projections`, `businesses`, `has_pull: true` (sim CRS on file). |
| 17d | `GET/POST /api/money/strategy` — payoff math | **PASS** (GET only) | GET 200 with `targets`, `methods`, `saved`. POST not exercised (would write saved strategy). |
| 17e | Ready to get funded → CSM / Blueprint upsell | **PASS** (read path) | `GET /api/money/ready-to-fund` 200; `status: none`, `process: blueprint-csm-prep`, offers block present. UI: **1** “ready” control on Next tab. Press not sent (would write). |
| 17f | “Do task” buttons | **PASS** (UI + list) | `GET /api/money/tasks`: 4 tasks; one `can_do: agent` ($500 Fundhub plan). Live UI `#tab-next`: **1** `Do task` button. POST `do_task` **not** fired (live write + possible outbound). |
| 18 | Money agent — Mac bridge / shadow roleplay | **PASS** (rules shadow) / **NOT RUN** (bridge this pass) | `npm run money:roleplay -- --scripted --brain=rules --persona=a` → PASS; report `ops/workflows/finance-os-wave5-2026-10-06-evidence/w6/roleplay-2026-10-07T07-02-22-414Z.md`. Agent **FOS-01** status **shadow** in DB. Mac bridge (`--brain=bridge`) not re-run here; ship log wave5 cites live bridge turn 2026-10-07. |
| 19 | Plaid sandbox transfer: propose → approve → events / ledger / limits | **PASS** (historical proof) | SQL: `money_transfers` **settled** $20.00 (`2000`¢), **13** rows in `money_transfer_events`. Local `.env`: `FINANCE_OS_TRANSFER_MAX_CENTS` + `FINANCE_OS_TRANSFER_DAILY_MAX_CENTS` set; `PLAID_ENV=sandbox`; `FINANCE_OS_TRANSFERS_LIVE` unset. `node scripts/finance-os-sandbox-transfer.mjs` dry run OK. **Not re-applied** in this pass (would write + Plaid). |

## Five-line summary (Chris)

1. FinanceOS pages work on live for Test Test at phone and desktop sizes; cash on screen matches the database.
2. Wave 5 reads work: Plan, Banks, Strategy, Fundability, Next steps, and tasks all return real rows.
3. Sample loan due dates and the $20 sandbox transfer from yesterday are still in the database.
4. **Broken for the sample person:** nobody paid the setup fee, so FinanceOS is not “on,” and we did not prove Commas paying a Clarity bill live.
5. Money helper role-play passed in safe shadow mode; we did not click “Do task” or “Ready to fund” because that would write live.

**Next action:** Run one sim setup-fee pay + Commas installment on a **plus-tag** sim (not Chris’s inbox), then re-score rows 14 and 16.
