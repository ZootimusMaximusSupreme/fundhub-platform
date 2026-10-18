# Payment strategy — professional refinement

Single builder: `/root/page_money_strategy`. Scoped files: standalone HTML, `money-strategy-ios.css`, presentation wrapper in `money-strategy.js`, focused Playwright test. No shared/API/engine/other-page edits; no commit or deployment.

## Inventory before replacement / feature preservation

| Existing feature | Result |
|---|---|
| GET `/api/money/strategy` plus bearer/cookie auth; optional staff `client_id` | Unchanged; staff back/nav context assertions retained |
| Loading skeleton, empty debt state/Add account, error classifications and retry, full plan | Preserved; all four rendered at 1440/390/320 |
| Monthly range and amount, minimum and safe-cash explanation | Existing handlers/math unchanged; keyboard and below-minimum recovery checked |
| Highest APR / utilization / snowball selections and explanations | IDs/method keys/pressed state unchanged; one selected black control, alternatives outlined |
| Goal and optional date; computed recommendations/Use amount controls | Preserved; goal/date, amount recommendation checked |
| Save plan POST `action:save_plan`, optional goal/client_id, safe-cash checks, save feedback | Preserved; safe mock success then server rejection checked; rejection does not show Saved |
| Debt-free / interest-v-minimum / card use / cash metrics | Same renderer and numeric/null semantics; neutral cards without decorative positive colors |
| Seven-column ordered debt table, missing APR/minimum warnings | Same renderer and data; own table horizontal scroll preserved |
| Utilization chart / targets / legend | Same calculations and SVG; no engine changes |
| Month-by-month detail and Show more months | Same render/listener; expansion/pagination clicked |
| Cash and mathematical assumptions details, staff source explanation | Existing details preserved, grouped under Assumptions & cash checks |
| Sandbox banner only from server, user role/client file scope | Unchanged; ordinary clients receive no new samples |
| Old Money subset navigation | Shared lead-owned native 16-section picker verified; no page CSS overrides picker |
| Combined FinanceOS strategy panel | CSS supports exact `#fos-strategy` module root; lead must load this page CSS into frame |

## Design

32px desktop/28px phone heading; 15px body, 13px explanations; 18px sections, neutral 18px cards and 11px controls. Amount and method are first; saved status and action grouped below goal. Missing data/earliest estimates remain explicit. No new payment, money movement or approval flow.

## Verification

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_strategy.spec.mjs --workers=1 --reporter=line`: **3 passed**. Every width checks full/empty/loading/error, no page overflow, real shared session activation, selected method, amount, range ArrowRight, goal/date, successful save then rejected save, all three disclosure controls, Show more months, below-minimum recovery, exact 16-section picker, staff context and no client theme on staff.
- `node --test src/http/money-strategy-screen.test.mjs src/finance/payment-strategy-math.test.mjs`: **64 passed, 0 skipped**.
- Initial 320px run exposed the 12-column form's minimum column-gap width. Replaced mobile grid with one real column; repeated all tests successfully.
- Full/empty/loading/error screenshots at 1440/390/320; red-box review images at 1440 and 390 label the primary control group. All use canonical intercepted API fixture; no real customer/bank/payment/message action.
- Integrated FinanceOS frame, combined lint/TypeScript, throttled performance and real server/database permission checks remain lead-owned; not claimed from UI mocks. No database skip counted as pass.
