# E2E scorecard — marketing machine + FinanceOS (2026-10-06)

**Audit time (Arizona):** Oct 7, 2026, ~12:30 a.m.  
**Live ship:** `ddcabb29` (ship log 2026-10-06 23:46) · `origin/main` `f0c0e597`  
**Part 1 rules:** test only, no fixes; `MESSAGING_DRY_RUN=1` / `ADAPTERS_DRY_RUN=1` on drivers; owner routes via Way-A (`chris@fundhub.ai` staff row, no session mint); live UI login uses `owner@fundhub.ai` + `STAFF_E2E_PASSWORD` (not Chris’s personal password).

---

## Part 1 — Marketing machine (Command Center, bridge, teleprompter)

| # | Test | Result | Proof (Arizona time ~12:08–12:30 a.m.) |
|---|------|--------|------------------------------------------|
| 1 | Ship / health | **PASS** | `GET https://fundhub.ai/api/health` → `pending:0`, `migrations:372`. Ship log last commit `ddcabb29`; `origin/main` `f0c0e597` (`git merge-base --is-ancestor ddcabb29 origin/main`). Driver: `ops/workflows/e2e-marketing-machine-run.mjs`. |
| 2 | CI on `main` | **PASS** | GitHub Actions run **37583359128** (`ship: ddcabb29 is live`). Only red: `climate page: no approval odds, no promised amount, no guarantee` (owner-known). No other `not ok` tests. |
| 3 | Command Center (390 + 1280) | **PASS** | **Logged out:** `ops/workflows/e2e-marketing-machine-live-click.mjs` → both viewports land on `login.html?next=/app/marketing-command-center.html`, console clean (401 network noise ignored). **Logged in (owner):** all tabs `today, ideas, scripts, shoot, launch, numbers, settings` via hash — `bad:[]`, no sideways scroll, no “This tab did not open”. Safe controls clicked (spend/queue buttons skipped). **Handlers (real DB):** `GET marketing/today`, `scripts`, `shoot`, `settings`, `research` → 200. **Offline button proof:** `npx playwright test` → **137** CC/tab specs + **48** `teleprompter-touch` (iPhone + iPad viewports) green. |
| 4 | Clock / worker | **PASS** | `marketing_heartbeats` (`name`/`last_at`): clock `2026-10-07T07:00:58Z`, worker `2026-10-07T07:01:01Z` (<20 min). Worker after last queued job (`marketing_jobs` last create `2026-10-06T16:28:43Z`). |
| 5 | Bridge — one copy job | **NOT RUN** | Battery `5-bridge-copy-job` stopped on SQL (`marketing_model_usage.cost_cents` column mismatch in driver). No fresh enqueue + `npm run marketing:run-queue -- --once` proof in this pass. |
| 6 | Bridge — flywheel avatar retry | **PASS** (done) / **FAIL** (retry tap) | Job `95c0a082-2d05-40a2-a884-1ecd70816619` is **`done`** (steps through `save` finished ~07:28 UTC). `POST marketing/flywheel/run` with `retry_job_id` → **404** (“not a stopped or failed avatar run”) — expected once finished. Research/offer not started. |
| 7 | Scripts — write now + approve | **PASS** (re-proved 2026-10-07 ~4:57 a.m. Arizona) | The Oct 6 count of 0 was a query with no staff scope, plus the battery reading `marketing_scripts` (that table does not exist). Real table is `ad_scripts`. A write-now from that pass had left `write_slot` `1b51e657` queued. `npm run marketing:run-queue -- --once` finished it in 53s (checker passed, ledger model `claude-code`, cost **$0**). Live Scripts tab: Approve → `POST marketing/scripts/approve` **200**, ad number **91**, status **locked**. Second open of Approved shows **Ad 91 · The Conveyor Belt**. `repo_outbox` rows for the script file and `registry.json` are uncommitted; `outbox_drain` heartbeat `held_reason: no_token`. `finish_batch` **done**. |
| 8 | Shoot + teleprompter | **PASS** (offline and live sign-in) | **Offline:** unchanged from the Oct 6 pass. **Live, twice, after `owner@fundhub.ai` login:** phone **390** and iPad **768**. `fh_token` is set, `#wall` stays hidden, `GET marketing/shoot` **200**. The page says no shoot is planned. The Oct 6 “sign-in wall” was the hidden line that is always in the page; the battery counted it even when it was hidden. |
| 9 | Numbers — Meta spend | **PASS** (re-proved 2026-10-07 ~4:52 a.m. Arizona) | A query as `fundhub_app` with no staff flag sees **0** rows (row security). The same sum as staff is **70** rows, **156313** cents through Oct 4 (**$1,563.13**), plus Oct 6 at **$0**. Oct 5 has no row. Meta connection `last_synced_at` `2026-10-07T11:30:05Z`, `last_error` empty. Live Numbers tab, same login: last 30 days (Sep 8–Oct 7) **91549** cents and last 7 days (Oct 1–Oct 7) **44557** cents, ads 90 / 86 / 89 / 84. Those cents match a staff `SELECT` on the same Arizona days. Screen says numbers were pulled Oct 7, 4:30 a.m. Arizona. |
| 10 | Launch safety | **PASS** | `POST marketing/meta/load` without video ids → **400** `invalid` / `ad_video_id` (battery + run driver). Launch tab loads live with no tab fault. No Meta load sent. |
| 11 | iPhone app (simulator) | **PASS** (iPhone) / **NOT RUN** (iPad sim) | `DEVELOPER_DIR=… xcodebuild test` · `tools/teleprompter-ios/FundhubPrompter.xcodeproj` · **iPhone 17 Pro Max** → **42** tests, **0** failures (~00:29 AZ). iPad simulator destination not re-run this pass. Real device only: 4K/60 camera, Photos save, BLE remote, production login. |
| 12 | Funnel builder | **PASS** | Funnel `d6e3726c-d9ee-4dff-9721-268582ef1f9f` **`draft`**, path `/blueprint`. `GET https://apply.fundhub.ai/blueprint` → **404** (not live — owner choice). `/roadmap` → **200** (unchanged live page spot-check). |

### Five-line summary — Part 1 (Chris)

1. Live site is shipped and healthy; CI only failed the known climate test.
2. Command Center works at phone and desktop sizes when you sign in; every tab opens with real API data.
3. The clock and worker ran in the last few minutes; the Blueprint avatar job is **done**.
4. **Update 2026-10-07:** Those three reds are closed. Spend was already saved; the audit query could not see it. The teleprompter was already signed in. Write-now finished on the Mac and Ad 91 is approved.
5. Offline Playwright clicked teleprompter controls; iPhone simulator tests passed. We did not push the funnel or send anything to Meta.

---

## Part 2 — FinanceOS

**Sim client (14a/16 re-score):** Sim FinanceOS `39f748e1-9fce-4233-8642-1b09dff22d64` · `e2e+financeos-14a16-1791356831368@fundhub.ai` (new plus-tag; not Test Test)  
**Sim client (13–15, 17–19):** Test Test `f1cb9c27-f858-4db1-b6bb-4eddc898bb8e` (S1 sample, board `finance-os-wave5-2026-10-06.md`)  
**Rules:** test only, no fixes, no live money moves, Plaid sandbox (`PLAID_ENV=sandbox`), `MESSAGING_DRY_RUN=1` / `ADAPTERS_DRY_RUN=1` on sim pay path.

**Wave 5 gate:** Board merged W1–W5 + W7 (live proof on ship `6234ead8`). Table still lists W6 `queued`; live DB has agent **FOS-01** (shadow). W6 code is live; full live flip not scored here.

| # | Test | Result | Proof |
|---|------|--------|--------|
| 13a | `/app/financeos.html` — all 16 tabs at **390×844**, real data, no core “coming soon” | **PASS** | `npm run test:e2e:live -- e2e/live-financeos-part2.spec.mjs` (390 run green). API `GET /api/money/overview` staff Way-A: personal cash **1,338,500**¢, business **2,140,600**¢ = `moneyOverview()` SQL same numbers. Overview UI at 1280 shows **$13,385** personal cash. |
| 13b | Same page at **1280×900** | **PASS** | Headless Playwright staff login: all wave5 tabs `overview,next,plan,banks,strategy,fundability` — `tabFailures:[]`. (First live config retry hit `net::ERR_ABORTED`; rerun passed.) |
| 13c | `/app/finance-os.html` staff desk loads (390 + 1280) | **PASS** | Live Playwright: body visible, no console errors (390 + 1280). |
| 14a | Paid setup fee turns FinanceOS **on** for sim client | **PASS** | Minted setup link `pl_72213674437d988a71670847` ($497, `Finance OS setup`) for plus-tag sim. `scripts/sim/push-payment.mjs` → live `POST /api/webhooks/commas` (simulated receipt, no card). Inbox drained with `ensureRegistered()` so `payment.received` handlers ran. SQL: link **paid**; `subscriptions` tier **finance-os** `provider_ref=payment_link:6fb69b2d-9207-408d-b1cc-586fa9618cde`; `readSetupStatus`: `entitled: true`, `paid: true`. Driver: `ops/workflows/e2e-marketing-machine-financeos-14a-16.mjs`. |
| 14b | Staff see FinanceOS card / open from client panel | **PASS** | Playwright: `https://fundhub.ai/app/client-control-panel.html?client_id=f1cb9c27-…` — `#ccp-link-financeos` visible, not hidden. Opens `financeos.html?client_id=…`. |
| 15 | Loans: due date, payment, reminders; loan on Overview; Plaid sandbox loan dates | **PASS** | SQL: SBA Loan `account_statement_cycles.payment_due_day=1`, `minimum_payment_cents=105000`. `moneyOverview()` upcoming: `loan_due` SBA Loan **2026-11-01**, **105000**¢. Plan pins include `dues` source (6 pins total from `GET /api/money/plan`). |
| 16 | Commas payment marks Clarity/BNPL installment; merchant API pull (Commas/Whop) | **PASS** (Commas mark) / **NOT RUN** (merchant pull) | Same plus-tag sim: open Clarity plan `a4b38fd8-39ed-43d4-94ef-5472e856187b`, one $333 installment. Mint custom link `pl_a00d1b70496a67f7da284928`; `push-payment.mjs` + inbox drain. Installment `paid_cents` **0 → 33300**; link **paid**; `money_agent_log` `payment_recorded` / `via: commas` / `rule: next_installment` / `payment_id=sim-pay-1791356836126`. Merchant API pull not re-run this pass (still wired on `merchant_connections`). |
| 17a | `GET /api/money/plan` — dated pins from plan sources | **PASS** | HTTP 200; **6 pins**; sources include `dues`, `clarity`, `agent`. |
| 17b | `GET /api/money/banks` — bank strategy | **PASS** | HTTP 200; body has `recommended_banks`, `card_stacking`, `next_round`, `relationships`. |
| 17c | `GET /api/money/fundability` — now / projected / per business | **PASS** | HTTP 200; `now`, `projections`, `businesses`, `has_pull: true` (sim CRS on file). |
| 17d | `GET/POST /api/money/strategy` — payoff math | **PASS** (GET only) | GET 200 with `targets`, `methods`, `saved`. POST not exercised (would write saved strategy). |
| 17e | Ready to get funded → CSM / Blueprint upsell | **PASS** (read path) | `GET /api/money/ready-to-fund` 200; `status: none`, `process: blueprint-csm-prep`, offers block present. UI: **1** “ready” control on Next tab. Press not sent (would write). |
| 17f | “Do task” buttons | **PASS** (UI + list) | `GET /api/money/tasks`: 4 tasks; one `can_do: agent` ($500 Fundhub plan). Live UI `#tab-next`: **1** `Do task` button. POST `do_task` **not** fired (live write + possible outbound). |
| 18 | Money agent — Mac bridge / shadow roleplay | **PASS** (rules shadow) / **NOT RUN** (bridge this pass) | `npm run money:roleplay -- --scripted --brain=rules --persona=a` → PASS; report `ops/workflows/finance-os-wave5-2026-10-06-evidence/w6/roleplay-2026-10-07T07-02-22-414Z.md`. Agent **FOS-01** status **shadow** in DB. Mac bridge (`--brain=bridge`) not re-run here; ship log wave5 cites live bridge turn 2026-10-07. |
| 19 | Plaid sandbox transfer: propose → approve → events / ledger / limits | **PASS** (historical proof) | SQL: `money_transfers` **settled** $20.00 (`2000`¢), **13** rows in `money_transfer_events`. Local `.env`: `FINANCE_OS_TRANSFER_MAX_CENTS` + `FINANCE_OS_TRANSFER_DAILY_MAX_CENTS` set; `PLAID_ENV=sandbox`; `FINANCE_OS_TRANSFERS_LIVE` unset. `node scripts/finance-os-sandbox-transfer.mjs` dry run OK. **Not re-applied** in this pass (would write + Plaid). |

### Five-line summary — Part 2 (Chris)

1. FinanceOS pages work on live for Test Test at phone and desktop sizes; cash on screen matches the database.
2. Wave 5 reads work: Plan, Banks, Strategy, Fundability, Next steps, and tasks all return real rows.
3. Sample loan due dates and the $20 sandbox transfer from yesterday are still in the database.
4. **Setup fee + Commas installment:** proved on a **new plus-tag** sim (`39f748e1-…`); Test Test still has no setup payment (S1 sample unchanged).
5. Money helper role-play passed in safe shadow mode; we did not click “Do task” or “Ready to fund” because that would write live.

---

## Overall next action

**Marketing (2026-10-07):** Rows 7, 8, and 9 are PASS. No product code change. Row 5 (copy job) was not re-run. **Finance:** unchanged from this pass.

**Part 1 pass/fail after the 2026-10-07 re-prove:** PASS **10** (rows 1–4, 7–12), FAIL **1** (row 6 retry tap only), NOT RUN **1** (row 5). **Part 2:** committed separately (`02f14ba5`).
