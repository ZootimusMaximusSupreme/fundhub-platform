# Money plan — page builder evidence

Owned page: `public/app/money-plan.html`; page-specific stylesheet: `public/app/money-plan-ios.css`; browser proof: `e2e/page_money_plan.spec.mjs`.

## Before / after feature matrix

| Existing surface or control | Before | After |
|---|---|---|
| Plan API | GET `/api/money/plan?month=YYYY-MM`, optional staff `client_id` | Unchanged shared section |
| Staff plan marking | POST `/api/money/plan`; only server-provided allowed marks | Unchanged; no marks appear for clients |
| Month navigation | Previous, next, conditional Today | Preserved, keyboard action exercised |
| Plan overview | Next date, month counts, missed count | Preserved; soft iOS cards |
| Calendar | Desktop Mon–Sun dated pins, overflow-day controls, today marker | Preserved desktop; existing phone list collapse |
| Full dated list | Every pin with status, amount or unknown amount | Preserved at all widths |
| Pin detail | Amount, bank/container, date, reason, source, status, close/Escape/focus controls | Preserved; drawer raised above client navigation |
| Source link | Payments link, carries staff `client_id` | Unchanged module |
| Empty | No pins; Add an account action | Preserved |
| Error / partial failure | Retry action; source failures distinguished from empty | Preserved |
| Loading | In-layout skeletons | Preserved |
| Navigation | All seven Money/Plan/Accounts/Credit/Connections/Payments/Setup destinations | Preserved with existing hash destinations and current Plan |
| Back link | Client portal; staff FinanceOS file link | Preserved and staff link browser-tested |
| Permissions and identity | API session binds client data; staff context uses query | Unchanged; iOS theme activates only after shared session verification |

## Implementation and safety

Only the standalone wrapper and new page-specific CSS changed. `money-plan.js`, its shared stylesheet, APIs, payment/bank logic, source adapters, heartbeat and tripwire routes remain unchanged. No new page/API/send path was created. Demo samples are used only inside browser route fixtures, never written into the product. Staff gets the original chrome. Shared lead-owned foundation adds navigation after verified client session.

## Verification

- `node --test src/http/money-plan-screen.test.mjs`: 29 passed, zero skipped.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_plan.spec.mjs --reporter=line`: 3 passed (1440/390/320).
- Browser checks real shared session activation, no horizontal overflow, current navigation, keyboard pin opening, Escape close, month navigation, empty/error/loading, retry recovery, absence of client mark controls, staff unthemed rendering and context back link. All API traffic is mocked; zero write requests occur.
- Full-page captures `page_money_plan-{1440,390,320}.png` and matching `-empty`, `-error`, `-loading` states. Phone capture visually inspected: one-column cards, full labels, usable controls.
- Initial launch failed because default bundled browser was absent; rerun with lead-provided Chromium succeeded. Repository-wide lint/TypeScript/performance checks are lead-owned; no database/live permissions proof claimed by this page builder.

Review notes: approved design intentionally replaces general staff 10px card radius with client-only 28px cards, within the user-approved design scope. No functionality removed. Fixed bottom navigation is safe over the page scroll; modal detail layer stays above it.
