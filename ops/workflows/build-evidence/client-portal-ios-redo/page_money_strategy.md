# Payment strategy — page owner evidence

Scope: `public/app/money-strategy.html`, `public/app/money-strategy-ios.css`, `e2e/page_money_strategy.spec.mjs`. No shared strategy modules, API contracts or math changed. Read AGENTS/CLAUDE notes, UI/PERF standards, client intended journey, heartbeat journey and approved visual source before implementation.

## Before/after feature matrix

| Existing behavior | After |
|---|---|
| GET `/api/money/strategy`; bearer/cookie session; client own-file server gate | Unchanged existing module |
| Staff `?client_id=` forwarded to read/save, back link and all Money links | Unchanged; browser verified staff context links and client theme absence |
| Loading skeleton, empty state/Add account, database/error with retry, full plan | Unchanged; three-width browser proof |
| Three methods, monthly range/amount, goal and date, live local calculations | Preserved; browser changed method, amount, range by keyboard, goal/date |
| POST same endpoint `action:save_plan`, safe limits, saving/success/failure feedback | Unchanged; browser intercepted safe save and checked method/payload |
| Four summary metrics; ordered debts; missing-data warnings; chart and legend | Preserved original renderer/math; existing screen tests |
| Month-by-month expansion/pagination; cash check; explanation details; suggestion buttons | Preserved original renderer/listeners; screen test coverage, no new behavior |
| Sandbox banner only when server says sandbox | Preserved |
| Seven Money links, current Strategy state and portal back link | Preserved; shared client workspace added only after server verifies client |
| Staff styles and permissions | No staff style activation; server remains authority |

## Visual change

Light iOS canvas, rounded white cards, pastel metric cards, pill navigation, larger heading, soft form controls and shared rail/mobile navigation. All new CSS is scoped to verified `body[data-client-ios]`. No fabricated values or static progress added.

## Verification

- Browser spec: actual shared-session activation, 1440/390/320 widths, full/loading/empty/error, retry, method selection, amount/range keyboard action, goal/date, safe mocked save, staff scope and links. Screenshots named `page_money_strategy-*.png` (12 views). No page horizontal overflow in any checked state.
- Images show approved draft, no issue finding requiring a red-box annotation.
- Existing screen + shared math checks: 64 passed, 0 skipped. Catalog browser proof attempt could not launch its default Chromium: its harness calls chromium.launch without respecting PLAYWRIGHT_CHROMIUM. Attempt was stopped; not a pass. The page-specific Playwright runner above uses the supplied working browser and passed all three tests.
- No live account, banking action, payment, outbound message or production data used. Browser fixtures are tests only.
- Lint, TypeScript and integrated performance gates remain lead-owned. No live database proof claimed. POST integration/real permissions are outside this presentation-only page owner's UI mocks.
