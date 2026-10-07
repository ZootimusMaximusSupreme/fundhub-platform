# FinanceOS — wave 4: the rest of the undone list (2026-10-06)

Chris: "get the undone done. go." Direction: `docs/finance/finance-os-direction-2026-10-06.md`.
Orchestrator merges, regenerates journeys/diagrams, ships, proves. Agents never merge, push, ship, or run `npm run journeys`.

| # | Unit | Owner | Status | Migration # |
|---|---|---|---|---|
| H1 | Commas + Whop payments to Fundhub auto-mark Clarity / BNPL installments paid | agent | claimed | 455 |
| H2 | Loans: Overview loan table + Plaid loan due dates (student, mortgage) | agent | claimed | 456 |
| H3 | Staff open FinanceOS from the staff client screen (admin + sales_manager can't open the portal page) | agent | claimed | — |
| H4 | Plaid real-bank (Production) request form — fill it, stop before submit, Chris says yes | orchestrator | claimed | — |

Not in this wave: AI brain (waits on AI spend, owner call). Commas payouts (Commas sends no payout event — docs + 55 stored payloads checked).

Workflow count pin is 94 on main. Bump only if you add a workflow.

## Manifests
(orchestrator fills in)

### Result — 2026-10-06
- H1 auto-match: merged (migration 455). Live sample: $150 payment marked BNPL installment 2 paid; repeat did nothing.
- H2 loans: merged. Overview "By loan" table; Plaid student + mortgage dues; card reminder query skips loans (no double text).
- H3 staff link: merged. "Open FinanceOS" in Quick launch on `client-control-panel.html` for owner/admin/sales_manager.
- H4 Plaid Production: products step needs Chris's yes; plan (billing) and verify business (EIN) are Chris-only.

## Wave 4b (2026-10-06, owner: "we use API to track merchant processing for any merchant… line graphs… 100% done")
| # | Unit | Status | Migration # |
|---|---|---|---|
| H5 | Client merchant processing pulled by API key (Commas, Whop, provider registry for any merchant) + Sync now | claimed | 457 |
| H6 | Daily balance history + backfill + `/api/money/trends` + line graphs (Overview, Connections, Credit) | claimed | 458 |
Then: final 100% pass (every tab, every state) before calling it done.
