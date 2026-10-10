# FinanceOS — wave 3: close the gaps (2026-10-06)

Chris said go. Direction: `docs/finance/finance-os-direction-2026-10-06.md`. Wave 2: `ops/workflows/finance-os-pages-2026-10-06.md`.
Orchestrator merges, regenerates journeys/diagrams, ships, proves. Agents never merge, push, ship, or run `npm run journeys`.

| # | Unit | Status | Migration # |
|---|---|---|---|
| G1 | Setup fee paid → FinanceOS turns on; staff see the FinanceOS button | claimed | 450 |
| G2 | Loans: due date + minimum, Accounts tab + reminders | claimed | 451 |
| G3 | Commas payouts into Connections (from Commas docs only) | claimed | 452 |
| G4 | Business scores saved and shown on the Credit tab | claimed | 453 |

Waiting on Chris: Plaid real-bank form (no answer yet = do not submit). AI brain waits on AI spend.

Workflow count pin (`src/journeys/runner/index.test.mjs` REGISTERED) is 94 on main. Only bump it if you add a workflow; say so in your report.

## Manifests
(orchestrator fills in)

### Result — 2026-10-06
- G1 setup fee → FinanceOS grant (idempotent on link id) + staff card: merged.
- G2 loans: migration 451 (reminder kind 'loan'), Accounts/Overview/reminders: merged. Sample loan via `scripts/seed-sample-loan.mjs --apply` after ship.
- G3 Commas payouts: NOT built — Commas docs (commasdocs.com) and all 55 stored Commas payloads have no payout event. Payouts arrive as bank deposits via Plaid or via the open API.
- G4 business score: Credit tab now reads `crs_results.result.businessReports[]`; no real business pull stored yet, so it shows a dash.
