# Finance OS — owner direction (2026-10-06)

Owner-set by Chris, 2026-10-06. Adds to `client-finance-os-build-spec-2026-09-19.md`. Where they differ, this file wins.

## What Chris said

- Finance OS is a **Finance Oversight System**. It tracks and reminds. It never moves money.
- **Fundhub is client #1.** Fundhub's own bank accounts, personal cards, business cards, and other businesses go in first. It becomes its own testimonial.
- **Containers.** Each business is a container. Each person is a container.
  - Business container: business bank accounts, business credit cards.
  - Personal container: personal bank accounts, personal credit cards, personal loans.
- **Billing is per container.** The monthly price depends on how many containers a client has. (Price per container: not set.)
- Tracks every repeating expense, its date, and every payment due date. Sends reminders.
- Easy "add an account" flow: the user enters the account, the system fills in the rest.
- Merchant processor connection.
- Month-over-month cashflow.
- Target user: a business owner with 20+ credit cards. The goal is less overwhelm through awareness.
- Later: UnderwriteIQ sits on top with tips like "bring balances down to qualify for funding," tied into the Blueprint.

## What the repo already has (measured 2026-10-06)

| Need | In the repo | State |
|---|---|---|
| Containers | `entities` table (106). `bank_accounts`, `recurring_bills`, `tradelines`, `card_liabilities` each have `entity_id` | Built |
| Business vs personal tag | `bank_accounts.entity_kind` personal / business / unknown | Built |
| Bank login | Plaid Link: `api/banking/link-token`, `api/banking/link-exchange` (staff side) | Sandbox works, 2026-10-06 |
| Accounts + balances + card limits | `bank_accounts` filled from Plaid `/accounts/get` | Works |
| Charges and deposits | `bank_transactions` table (085) | Table only — nothing pulls them from Plaid yet |
| Repeating expenses | `recurring_bills`, `src/banking/recurring.mjs` | Built; needs transactions to find bills |
| Due dates | `card_liabilities`, statement cycles (097) | Built |
| Reminders | `cashflow_reminders`, SMS send path | Built; no Finance OS agent row yet |
| Month-over-month cashflow | `src/banking/cashflow.mjs` | Built; needs transactions |
| Billing per container | — | Not built |
| Merchant processor | — | Not built |
| Page | `/app/finance-os.html` (staff). `/app/finance.html` is 404 | Staff page only |
| Real banks | Plaid production secret: "You don't have access" | Blocked until Plaid grants access |

## More direction — same day (owner-set 2026-10-06)

- Add a business and all its info. Containers sit inside the business structure.
- Setup: one-time setup fee (price not set), soft pulls for business credit (no hard inquiries), quick payment to activate.
- Dashboard: business credit like Credit Karma, every bank account in one view, full money overview.
- AI agent: help and guidance, reminders, personal money advice, keeps business credit on track.

| Need | In the repo (measured 2026-10-06) |
|---|---|
| Soft pull, 3 bureaus + Experian business scores | `src/adapters/crs.mjs`, `api/read/portal-summary.mjs` (returns them, client-safe) |
| Pay to activate | Commas checkout; "Business Financial Assessment" is the $32 soft-pull gate (`src/adapters/commas.mjs`) |
| One-time setup fee | Price not set |
| Reminders | Card-due texts (Unit C, 2026-10-06) |
| Advice | UnderwriteIQ sentences (`tip` in `/api/money/overview`) |
| AI chat agent | Waits — owner 2026-10-06: no API spend for now |

## Owner calls — later the same day (owner-set 2026-10-06)

- All data is sample data for now. That is fine. Build and show with it.
- Price per container: show it as **X** until Chris sets a number.
- Merchant integrations: **Commas**, **Whop**, and an **open API** so any other merchant processor can send sales and payouts in.
- Past due: a **Clarity Payment** is debt a client owes to Fundhub LLC — or any other debt owed to Fundhub or its subsidiaries, including buy now, pay later (BNPL) plans. Track each one; when it is late, check in (agent first, then a person).
- AI agent: build it in-house. (No outside AI spend yet — the agent runs on rules until an AI brain is switched on.)
- **One page.** Chris (2026-10-06): it is all one page — a one-page CRM for finances, called **FinanceOS**. Sections on that page: Overview · Accounts · Credit · Connections · Payments · Setup. Page: `/app/financeos.html`. (The staff desk `/app/finance-os.html` stays as it is.)

## FinanceOS platform — owner vision (owner-set 2026-10-06, evening)

- Optimize the whole money life: banking, credit, real-time feedback on payment strategy, math showing how to lower payments and reach goals sooner.
- AI tells you exactly what to do. A "Do task" button hands the task to an agent. Owner wants automated money movement and task execution.
- **Waypoints timeline:** a month view (e.g. October 2026) with pins on dates (e.g. Oct 20): open this account, deposit $20,000 / $10,000 / $2,000 — to build banking history and relationships.
- **Banking relationship strategy:** which accounts to open based on location, pre-plan funding rounds, credit card stacking opportunities.
- **Fundability:** score now, future projection, and per business when more businesses are added.
- **Blueprint synergy:** same method, two doors. Blueprint can be an upsell from FinanceOS; FinanceOS a side sell to Blueprint. Journey: prep in FinanceOS → "ready to get funded" button in the portal → CSM reaches out (same as Blueprint).

| Need | In the repo (measured 2026-10-06) |
|---|---|
| Payment strategy math | `api/finance/paydown-simulator.mjs` |
| Waypoints | `api/waypoint-tick.mjs`, migrations 361/362 waypoint definitions |
| Bank relationships | `src/blueprint/bank-relationship.mjs`; 313 banks in `docs/legacy-strong/lenders-legacy-strong.csv` |
| Funding rounds | `src/blueprint/next-funding-sequence.mjs`, migration 403 |
| Fundability | UnderwriteIQ engine (`src/underwrite/`) |
| AI "Do task" | Waits on AI spend; agent runs on rules today |
| Automated money movement | Not in the repo — needs a money-moving provider (e.g. Plaid Transfer, custom plan) |
