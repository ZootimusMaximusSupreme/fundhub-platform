# Finance OS — wave 2: five pages (2026-10-06)

Chris said "go go". Direction (wins): `docs/finance/finance-os-direction-2026-10-06.md`. Wave 1 board: `ops/workflows/finance-os-build-2026-10-06.md`.

Orchestrator = main session: merges, regenerates journeys/diagrams, ships, proves. Agents never merge to main, push, ship, or run `npm run journeys`.

## Units (all parallel, no dependencies)

| # | Page | Back end | Status | Migration # (only if needed) |
|---|---|---|---|---|
| P1 | `/app/money-credit.html` — business credit, like Credit Karma | read of existing soft-pull scores | claimed | 440 |
| P2 | `/app/money-accounts.html` — add business + info, add account by hand, connect bank, sort into containers | reuse containers + bank-accounts APIs | claimed | 441 |
| P3 | `/app/money-connections.html` — Commas, Whop, open API | merchant sales/payouts in | claimed | 442 |
| P4 | `/app/money-payments.html` — Clarity Payments + reminders + in-house agent | debts owed to Fundhub, late check-ins, rule agent | claimed | 443, 444 |
| P5 | `/app/money-setup.html` — setup fee $X, soft pull, activate; "Money" button in portal; nav on money.html | checkout + entitlement | claimed | 445 |

## Shared nav (every money page uses these exact links, in this order)

Money `/app/money.html` · Accounts `/app/money-accounts.html` · Credit `/app/money-credit.html` · Connections `/app/money-connections.html` · Payments `/app/money-payments.html` · Setup `/app/money-setup.html`

Copy the header from `public/app/money.html` and add this nav. P5 adds the same nav to `money.html` itself.

## Owner calls used
- Sample data is fine.
- Price per container shows "$X" until set. Setup fee shows "$X" until set.
- Clarity Payment = any debt owed to Fundhub LLC or its subsidiaries, incl. BNPL.
- AI agent built in-house; runs on rules now (no outside AI spend yet).

## Manifests
(orchestrator fills in)

### Result — 2026-10-06 (all done, shipped 27211ea6)
- P1 credit, P2 accounts, P3 connections (migration 442, MERCHANT_SECRET_ENC_KEY set), P4 Clarity Payments + money helper (443, 444; workflow count 94), P5 setup + portal card, P6 one page `/app/financeos.html` — all merged and live. `/api/health` pending 0.
- Live proof: open API POST to fundhub.ai inserted 4 events, re-post 0 inserted / 4 duplicates. Clarity sample seeded for Test Test ($1,500 clarity, $600 BNPL); client not entitled, so the helper sends nothing.
- Not done: business scores (none stored), Commas payouts format, paying setup fee does not grant the plan, staff don't see the portal card, loans have no due-date home.
