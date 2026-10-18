# Funding plan page refinement

Sole builder: `/root/page_money_plan`. Checkout `fundhub-layout`, branch `codex/crm-portal-layout-professional`. No additional builders, commits, backend edits, live writes or deploys.

## Inventory before implementation

`money-plan.html` is the standalone wrapper for `FinanceOS.sections.plan`, mounted into `#plan-root`; FinanceOS uses `#fos-plan`. The shared module reads `GET /api/money/plan?month=YYYY-MM`, with optional staff `client_id`. Existing backend sources supply dated pins, amounts, banks, containers, reasons, statuses, source names and permitted staff marks. `POST /api/money/plan` marks only a permitted pin, with confirmation, source/pin/status and staff client context. This is a dated plan presentation, not a proposal/approval editor; no stack, wave, application or underwriting engine changed.

| Feature/control | Before | After |
| --- | --- | --- |
| Next planned date/title/cost | Static summary of first planned future/current pin | Same existing selection/data, plus read-only View next step opening its existing detail |
| Month and missed metrics | Three equally prominent cards, pastel highlight | Quiet neutral cards; real next task gets priority, secondary counts compact |
| Dated work | All source pins below desktop calendar | Complete ordered list comes before optional desktop calendar |
| Desktop calendar | Always expanded before work list | Native keyboard-accessible View month calendar disclosure; all pin/day controls preserved |
| Phone calendar | Existing calendar hidden, full list shown | Same phone behavior; no duplicate unusable calendar disclosure |
| Previous/next/Today | Month controls | Preserved IDs, month query, conditional Today and handlers |
| Pin detail | Date/amount/status/bank/container/why/source/link | All preserved, readable typography and higher overlay layer |
| Close/Escape/focus trap | Existing modal behavior | Preserved; new next-step trigger restores keyboard focus correctly |
| Missing/zero amounts | Existing formatter and unknown copy | Formatter untouched; existing tests retained |
| Staff marks | Confirm, allowed source marks, POST, inline error | Same flow; cancellation and mocked 403 explicitly browser-proved |
| Sources partly failed | Named warning plus retry | Preserved |
| Full/empty/loading/error | Real data, Add account, skeleton, retry | Preserved and rendered at all three widths |
| Navigation | Shared Money section handling | Complete shared native 16-section picker left intact; no old seven-link client subset restored |
| Staff context | Staff unthemed wrapper, carried client ID/back link | Preserved and browser-checked |

## Visual implementation

Warm neutral canvas and shared rounded system typography; 32px page title, 20px month heading, 18px section label, 15px body, 13px captions. Neutral 18px cards and 11px controls replace pastel/large pill treatment. The next step and its actual cost stay visible before the ordered work list. Calendar is secondary detail, not removed. No commitment, eligibility, approval or progress value is fabricated.

`money-plan-ios.css` scopes page chrome only to `body[data-client-ios][data-client-page="money-plan"]`, and module rules only to that page's `#plan-root` or the verified-client FinanceOS `#fos-plan`. Lead must bundle this CSS in FinanceOS; no other modules or shared navigation are restyled. The HTML already includes this page stylesheet and shared foundation; no HTML change was needed.

## Exact checks

- `node --test src/http/money-plan-screen.test.mjs`: 29 passed, zero skipped. Replaced an obsolete layout-only "no primary" assertion with a stronger assertion for exactly one read-only next-step action and no staff marks.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_plan.spec.mjs --reporter=line`: 4 passed, zero skipped. Three viewport/state flows (1440, 390, 320) and a dedicated staff cancellation/refusal flow.
- Viewport flows use actual shared session activation, assert all 16 Money destinations, open actual next-step detail by keyboard, restore focus, open/collapse desktop calendar, open row detail, close by Escape, change month, recover retry, and check no horizontal overflow/full/empty/error/loading. Staff context remains unthemed and keeps its back-link client ID.
- Staff test cancels a mark and proves zero POSTs; then accepts a mark against a mocked 403 and proves the exact failure remains visible without "Marked done" success. All API calls intercepted; no real bank/payment/customer/outbound activity.
- Full/empty/loading/error captures: `money-plan-{1440,390,320}[{-empty,-loading,-error}].png`. Review captures `money-plan-{1440,390,320}-marked.png` box/caption the next-task hierarchy. Desktop and phone full captures visually inspected.
- No DB, real-account permission, performance/Lighthouse, production or real-bank verification claimed. Combined lint/TypeScript/regressions and FinanceOS integration are lead-owned.

## Integration note

Full-page desktop capture shows shared fixed nav logo beginning around y666 in a 1566px full-page capture, while phone nav is fixed as expected. Reported to lead for shared foundation inspection; no page-specific nav override added. The screenshot may reflect fixed-layer full-page capture behavior. This does not change page interactions; shared foundation owner should resolve or document it.
