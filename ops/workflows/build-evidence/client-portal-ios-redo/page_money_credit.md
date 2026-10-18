# money-credit standalone page — preservation evidence

Owner: page_money_credit. Scope: money-credit.html and money-credit-ios.css only, plus this evidence. Existing money-credit.js unchanged. Approved reference: company-ux-refresh-2026-10-18/client-portal-home-preview.html.

## Before / after inventory

| Feature/control/state | Existing behavior retained after redesign |
| --- | --- |
| Credit read | GET /api/money/credit; session credentials and optional bearer token unchanged |
| Client authorization | Server chooses session client, ignores foreign client_id; shared client theme only activates on verified client principal |
| Staff authorization | Staff finance roles, explicit client_id and org restriction unchanged; no client-specific restyling on staff sessions |
| Back link | Client portal by default; staff Finance OS with client_id unchanged |
| Money/Accounts/Credit/Connections/Payments/Setup navigation | All six existing FinanceOS hash links retained, active Credit, staff client_id preserved |
| Personal scores | Three bureaus, pull dates, FICO words/ranges, previous score delta, accessible gauges retained |
| Business score | Intelliscore, risk band, business name, financial stability and absent-value dash retained |
| Report facts | Utilization, partial-limit notice, open accounts, inquiry counts per bureau, negatives and lates retained |
| Suggestions | Original escaped UnderwriteIQ text retained |
| History | Multi-pull chart, gaps, distinct line dashes, legend and point titles retained |
| Account details | Lender/last4/type/balance/limit/used/opened/status table retained inside local horizontal scroll |
| Loading | Same skeleton cards and loading words |
| Empty | Same no-pull explanation and real soft-pull setup link |
| Error | Same offline/database/server/forbidden/not-found/bad-request messages and working Retry button |
| Unauthenticated | Existing role-aware redirect to login preserved |
| Sample data | Existing API sample flag controls warning; no invented or client-wide fixture introduced |
| Writes, payments, upload/download, signature, chat | No standalone controls on this page before or after; no new writes introduced |

## Implementation

Added scoped client presentation: approved system type, large score numerals, rounded white/pastel panels, gray canvas, pill section navigation and shared client sidebar/mobile dock. Preserved every original DOM ID and JS behavior. CSS targets body[data-client-ios][data-client-page="money-credit"]. Layout uses two score columns on phones, single at 320px, table-scoped scrolling. Existing staff CSS untouched. No new runtime dependency, image or data request from page-specific CSS.

## Verification

`node --test src/http/money-credit-screen.test.mjs src/http/money-credit.test.mjs`: 27 pass, 0 fail, 0 skipped. Covers full/loading/empty/error renders, sample isolation, null semantics, controls/navigation and API role/org restrictions. This is fixture/unit coverage, not a database end-to-end proof.

1440/390/320 screenshots, actual keyboard/touch/browser checks and measured browser performance remain outstanding: browser runtime absent in this checkout; lead investigating centrally. CSS responsiveness has been reviewed statically, not claimed as measured visual proof. Shared lint/TypeScript checks remain lead-owned.

## Browser completion (2026-10-18)

Chromium became available at `/workspace/scratch/browser-tools/chromium`. Ran `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_credit.spec.mjs --project=chromium --workers=1`: **3 pass**, no skips. Safe routed fixtures only, zero write requests. Real shared session activation verified with `{ok:true, principal:'client'}`; no body attribute forced by test. Full/loading/empty/error states captured at 1440, 390 and 320px (12 `page_money_credit-{state}-{width}.png` screenshots). Document overflow checked in every state/width. Keyboard Enter follows real Credit nav; touch follows soft-pull setup and Retry restores full data. Staff fixture retains unthemed layout and client_id on existing back/nav links. Reviewed 390px and 1440px full screenshot for score panels, nav, account-table containment and responsive stack. No page fix needed. Browser performance measurement remains outside this focused interaction proof; no database end-to-end claims made.
