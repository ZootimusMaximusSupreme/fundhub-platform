# Money Overview page — 2026-10-18

Scope: `public/app/money.html`, `money.js`, `money-ios.css`, and the offline `e2e/page_money.spec.mjs`. The same `overview.mount` renderer is embedded in FinanceOS. No backend, financial engine, permission, live-account, commit, or deployment changes.

## Inventory before changes

| Surface / control | Existing source and contract | Preservation approach |
| --- | --- | --- |
| Cash, debt, card use, next due | `GET /api/money/overview`; integer cents; null dash; floor totals labeled; personal/business/unknown cash never combined | Keep financial helpers and derived card-use calculation; show a concise summary |
| Connect a bank | Plaid link-token, Link window, link-exchange; success reload and all failure copy | Keep handlers and endpoints; secondary on a full account with dues, primary for an empty account |
| Upcoming and recurring bills | Every server row, date order, card/loan/bill words | Named native disclosure with all rows |
| Containers and account detail | Container grouping, masks, provider/institution/subtype, balances, card facts and past due | Named native disclosure, all rows preserved |
| Debt detail | All/kind/container rollups, every card and loan column | Named native disclosure, horizontal table scroll stays inside its box |
| Trends | Existing `money-trends.js` mount, ranges, line charts and data tables | Named disclosure; existing mount contract unchanged |
| Cashflow | Monthly in/out per cash kind, null gaps, no activity state | Same charts and source, inside history disclosure |
| Billing | Existing container count and price / unknown-price display | Named disclosure, values unchanged |
| Four page states | Loading skeleton, honest empty state, retryable error, full | All states retained and checked offline |
| Local / global routing | Six static fallback links, staff client query, back route, shared client navigation and sign out | Static links preserved for staff / fallback; root's shared client picker exposes all 16 sections; staff context preserved |

Read: `AGENTS.md`, `docs/rules/UI-STANDARDS.md`, `docs/journeys/finance-os-trends-flow.md`, relevant Finance OS build/direction specs, renderer unit tests, existing offline page and sample tests. Owner's current warm neutral Swift reference supersedes the old visual rules where they conflict. Existing modules, API behavior and financial calculations remain authority.

## Checks

Passed:

- `node --test src/http/money-screen.test.mjs src/http/money-trends-screen.test.mjs src/finance/money-overview.test.mjs` — 59 tests, zero failures or skips.
- `node --check public/app/money.js` and `node --check e2e/page_money.spec.mjs` — clean.
- Final unknown-price copy correction: `node --test src/http/money-screen.test.mjs` — 19 tests passed; null and undefined say pricing is unavailable, a known zero still renders its actual zero amount, and known monthly math remains correct. Syntax and whitespace checks passed. Browser cases were not repeated for this text-only correction.
- Final priority review: `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43123 npx playwright test e2e/page_money.spec.mjs -g 'Money priority' --output=/tmp/money-priority-results --reporter=line` — 6 focused tests passed in 3.2s: both standalone Money and embedded FinanceOS at 1440, 390 and 320px. The due row is directly after the Review payments controls, entirely above the phone navigation / desktop fold, and before cash balances. Both cash-kind balances are visible; Cash details opens and closes with Enter, preserving counts for all three kinds, unknown-account status and the never-combine explanation. No overflow or writes. The 19 renderer tests also pass after the placement change.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium E2E_PORT=43123 npx playwright test e2e/page_money.spec.mjs --output=/tmp/money-page-results --reporter=line` — 3 tests passed, at 1440, 390 and 320 pixels.
- Browser coverage: canonical fictional sample; full / empty / error / loading; retry; all five disclosures opened and closed with keyboard; all four account rows and both card rows; masks and past-due column; no-loan and plan states; cashflow split; existing Trends 90-day range and Show the numbers; primary Review payments opens the real FinanceOS Payments module and returns; mocked unavailable-bank-link feedback; staff client query kept on primary / fallback links and back route. No page overflow or browser errors at any tested width.
- Offline write guard recorded exactly one explicitly simulated `POST /api/banking/link-token` returning unavailable. No bank window, bank exchange, payment, customer data or live action was used.
- A source comparison confirms 22 existing financial/helper/render/API functions are unchanged, including cents/date/percent formatting, card-use calculation, sorting, grouping, account rows, cashflow, bills, upcoming rows, classify and Plaid loading. `renderBilling` intentionally changes only unknown-price copy to “Pricing is not available”; known-price math is unchanged. The existing connect/retry handlers and endpoint bodies are unchanged.

## Result and evidence

The default view has a single Overview title, an early Review payments action when a due item exists and a compact Next due row immediately below it. The date, account name, payment kind and minimum amount are visible before supporting cash/debt/utilization facts. Personal and business cash balances remain visibly separate; account counts and the no-unknown-accounts explanation sit in a keyboard-operable Cash details disclosure. Real unknown cash balances and “at least” qualifications remain visible when present. This deliberate order makes the next real payment clear before explanatory account detail. Complete rows sit in Payments & repeating bills, Accounts & containers, Debt details, Trends & cashflow and Your plan disclosures. Native details preserve keyboard behavior. The existing Trends module now also loads on the standalone route.

Latest red-boxed priority proofs: `page-money-priority-money-{1440,390,320}.png` and `page-money-priority-financeos-{1440,390,320}.png`. Earlier draft / detail / error evidence remains in `page-money-overview-{1440,390,320}.png`, `page-money-debt-{1440,390,320}.png`, and `page-money-error-{1440,390,320}.png`. The earlier default captures were 1231px tall at 1440px wide, 1572px at 390px and 1625px at 320px; the original audit recorded 3609px desktop / 6281px phone. Supporting rows were disclosed, not deleted; the latest priority proofs supersede the earlier summary order.

Integration: root owns the `money-ios.css` link after `financeos-ios.css`, shared client navigation, full-project lint, and cross-page checks. This page's CSS addresses only the two Overview roots or explicit standalone Money chrome; its fallback nav rules exclude the shared section picker. Unknown pricing now truthfully says “Pricing is not available”; the focused renderer proof distinguishes null/undefined prices from a known zero price and preserves known per-container/monthly calculations. No new backend or money movement capability was added. No commit or deployment was made.
