# Credit — professional layout implementation

Owner: same single builder `/root/page_money_credit`. Inventory completed before changes by reading standalone HTML, shared section module, existing screen/API tests and canonical sample bundle. Approved owner direction supersedes old gradient/oversized rules.

## Before / after feature matrix

| Surface | Before | After |
| --- | --- | --- |
| Read and privacy | GET /api/money/credit; bearer/session auth; server client/org gate; staff client_id | Unchanged |
| Credit identity | Generic 64px heading; pastel tiles | 32px title, 36px scores, neutral 18px panels; real client/as-of retained |
| Personal bureau scores | EX/EQ/TU, dates, band/range, deltas, accessible gauges | Every field retained, smaller dark gauges |
| Business score | Intelliscore/risk/name/FSR or truthful missing dash | Retained; missing remains missing |
| File facts | Cards used/partial limits, open accounts, bureau inquiries, negative and late counts | Same data, quieter compact factual panels |
| Next work | Escaped verbatim UnderwriteIQ sentences | Same source text, readable section hierarchy |
| Score history | Minimum 2 pulls; distinct dashes, gaps, point titles | Unchanged |
| Tradelines | Lender/last4/type/balance/limit/used/opened/status | All retained; table remains locally scrollable on phones |
| Empty | No-pull explanation, working soft-pull setup link | Same action and message; restrained card |
| Error | Offline/database/forbidden/not-found/server/bad-request classification and Retry | Same controls/messages |
| Loading | Layout skeleton and busy state | Retained |
| Sample | API sample flag warning only | Retained; canonical safe demo bundle used for browser fixtures |
| Navigation | Existing staff back/client_id and compatibility nav markup | Preserved; shared root-owned native 16-section picker for clients, no page CSS restores old subset |
| FinanceOS integration | Same money-credit.js mounts #fos-credit | Shared presentation scopes cleanly to #fos-credit and standalone #credit-root |
| Other actions | No upload/sign/payment/chat/send controls on this section | No features deleted or fabricated |

## Changed files

- public/app/money-credit-ios.css — replaced old gradient/64px/card28 theme; reusable root-scoped neutral section presentation plus verified-client standalone chrome.
- public/app/money-credit.js — only adds credit-scores/credit-facts CSS hooks to existing rendered grids; no API/data/action changes.
- e2e/page_money_credit.spec.mjs — canonical src/demo/client-portal-sample-bundle.json, unified picker semantics, marked screenshots.
- This evidence note and 12 page-money-credit-{full,empty,error,loading}-{1440,390,320}.png files.

No shared files, backend, board, commits or deploys changed by this builder.

## Checks

PASS `node --test src/http/money-credit-screen.test.mjs src/http/money-credit.test.mjs`: 27 pass, 0 fail, 0 skipped. Covers null/zero, sample truthfulness, escaped suggestions, all fields, role/org gates and existing routes.

PASS `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_credit.spec.mjs --project=chromium --workers=1`: 3 pass. Full/empty/error/loading at 1440/390/320; genuine shared client activation from safe session response; 16-option Money picker keyboard navigation; touch setup link and Retry; staff back and client_id links preserved; zero writes; no document overflow in all states. Screenshot area marked with red outline/caption; desktop and phone full renders inspected.

Root owns combined lint/TypeScript/integrated FinanceOS frame regression. CSS ready for root frame bundle. These are safe fixture/browser and API-unit checks, not live account/database acceptance or measured performance claims. Native picker is root-owned; retained legacy nav markup still serves staff fallback. No new libraries, fetches, images or write paths.
