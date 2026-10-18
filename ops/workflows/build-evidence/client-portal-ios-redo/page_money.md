# Standalone Money overview — page_money

Owner: one implementation agent, `page_money`, assigned only `public/app/money.html`. The route is a real standalone overview shell, not a redirect. The existing `money.js` also renders the FinanceOS overview tab and remains untouched.

## Before / after feature matrix

| Existing feature/control/state | Before | After |
|---|---|---|
| Own-file read | GET `/api/money/overview`; server authorization | Same endpoint and renderer |
| Staff selected file | `?client_id=` carried to requests, six nav links and back link | Unchanged; staff receives no new theme |
| Navigation | Back to portal/Finance OS; overview/accounts/credit/connections/payments/setup links | Same IDs, hrefs, query handling; verified-client foundation adds shared portal nav |
| Connect bank | POST `/api/banking/link-token`, Plaid SDK, POST `/api/banking/link-exchange`; disabled/opening/saving/cancel/failure feedback | Unchanged handler and permission behavior |
| Retry | `data-act=retry` reloads overview | Unchanged |
| Full | Personal/business/unknown cash kept separate; debt/card utilization/next due; upcoming/bills; containers/accounts/masks/card facts; loans; cashflow; tips and billing | Every section still rendered by unchanged `money.js` |
| Missing values | Dash for unknown, “at least” for partial totals; no fabricated cash sum or chart bars | Unchanged |
| Sandbox | Explicit sandbox banner only when API says sandbox | Unchanged; no demo data injected |
| Loading | Skeleton tiles and caption | Unchanged plus rounded client presentation |
| Empty | Clear explanation and Connect a bank | Unchanged |
| Error | Specific words and Try again | Unchanged |
| Accessibility | Labels, semantic headings, live root/action feedback, reduced motion | Preserved plus shared focus rings and 44px targets |
| Other portal capabilities | No uploads, signatures, payments, courses, booking, advisor, push or referral submission controls on this page | No controls removed or invented |

## Changes

Added shared `client-ios.css`/`client-ios.js`, `data-client-page="money"`, and page-only `money-ios.css`. The account-session endpoint must verify principal `client` before any style applies. The new presentation uses approved dark feature/pastel tiles, fluid content, rounded grouped cards, system typography and phone stacking. No API, money section module, role rule or data changes.

## Verification

- `node --test src/http/money-screen.test.mjs`: 18 passed, zero skipped.
- Added `e2e/page_money.spec.mjs`: safe mocked client/staff sessions, full/empty/error/loading at 1440/390/320, overflow, all six nav links, selected FinanceOS nav, bank configuration failure feedback with keyboard Enter, retry recovery and staff query retention.
- `npx playwright test e2e/page_money.spec.mjs --workers=1`: all 3 widths failed before browser launch because `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell` is absent. No screenshots exist yet; browser proof is not passed.
- Lint/TypeScript/full integration and performance checks remain lead-owned. CSS-only scope adds no data computation or bank traffic; measured performance still required before declaring budget compliance.
