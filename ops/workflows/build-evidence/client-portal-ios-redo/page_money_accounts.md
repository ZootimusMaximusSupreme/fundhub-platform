# page_money_accounts — standalone Accounts

Actual page: `public/app/money-accounts.html`. Builder owns that HTML and `public/app/money-accounts-ios.css` only; existing `money-accounts.js` stays unchanged. Read AGENTS, relevant CLAUDE notes, UI/PERF standards, money-helper and heartbeat journeys, approved source HTML and assigned board prompt. The approved source informs the light canvas, system type, soft pill navigation, large account heading, rounded white cards and muted input surfaces. No sample numbers are introduced here.

## Before / after feature matrix

| Existing feature / state | After redesign |
| --- | --- |
| Back to my portal, staff contextual back link | Same `money-back` element and existing script handling |
| Money / Accounts / Credit / Connections / Payments / Setup links | Same six hrefs, active Accounts marker; mobile wraps in two columns; existing script preserves staff `client_id` query |
| Loading skeleton | Same renderer and live Accounts root; cards receive scoped style |
| Empty businesses/accounts | Same add-business disclosure, personal container and manual account form |
| Full business / personal / unsorted accounts, cards and loans | Same renderers and null handling; no invented balances or progress |
| Business create / save details | Same forms, fields and POST actions `create_business` / `save_business` |
| Personal container create | Same `create_personal` form and POST |
| Manual account addition | Same checking/savings/credit-card/loan choices, last-four restriction, conditional limits/due/minimum fields and POST `add_account` |
| Move account / unsort | Same selector and POST `assign` / `unassign`; credit report items remain immovable |
| Connect bank | Same Plaid loader, `/api/banking/link-token` and `/api/banking/link-exchange` flow; not exercised against real banks |
| Billing disclosure / sandbox banner | Same data-derived display and warnings |
| Request / write errors, retry and Saving feedback | Same renderer, alert/live regions, disabled controls and retry handler |
| Sign-in redirect / staff contextual access | Same module, token behavior and server API permissions; client presentation only activates through shared verified session script |
| Keyboard / touch | Native forms/details/buttons retained; shared visible focus rules; buttons/summary/select at least 44px; mobile account values stack |
| API data reads/writes | Existing GET/POST `/api/money/accounts` and `client_id` semantics unchanged |
| Shared FinanceOS section | No module or shared section CSS changed; standalone stylesheet loaded only by this page |

No downloads, uploads, signatures, payments execution, chat, booking or course controls existed in this standalone page; FinanceOS tab and portal links remain intact.

## Verification

- `node --test src/http/money-accounts-screen.test.mjs`: **9 passed, 0 skipped**. Includes all four renderer states, one default primary action, null balances, last-four privacy, refused-write feedback, host module integration, loan due fields and original navigation.
- Static diff: only viewport safe-area support, three presentation assets/attributes and page stylesheet added; IDs, existing nav links and module script retained.
- CSS uses scoped `body[data-client-ios]` selectors exclusively. Staff sessions do not activate the client theme.
- Responsive rules authored for desktop and <=760px, including 320px narrow wrapping and single-column account rows; no fixed page width.
- Browser proof now completed with `/workspace/scratch/browser-tools/chromium` using `scripts/page_money_accounts-browser.mjs`: 1440/390/320 each passed real shared activation via mocked client session, loading/empty/error/full state rendering, no horizontal overflow, keyboard opening/focus, loan/card conditional fields, refused mocked save without false success, keyboard retry, and staff isolation/context preservation. Twelve screenshots saved as `page_money_accounts-{full,empty,error,loading}-{1440,390,320}.png`.
- Reviewed the phone capture and corrected the observed broken Connections label by using two-column phone tab navigation. Reran all browser cases after the fix.
- Browser fixtures use in-memory sample data and intercepted APIs only. This proves UI wiring, not live server role enforcement or bank integration. Real touch-device interaction and measured Lighthouse performance remain unrun.
- No real bank, payment, client data or outbound actions performed. Database integration proof is outside this presentation-only agent scope and remains required centrally where relevant.
