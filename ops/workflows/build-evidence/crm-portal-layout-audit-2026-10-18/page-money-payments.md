# Payments — professional workspace refinement

Builder: `/root/page_money_payments`, same single Payments builder. Owned files: page-specific CSS, presentation markup in the existing module, focused browser test. No backend/shared page/API/account changes. Read assignment, AGENTS, shared audit board, current page/module/tests and native visual reference before work. Owner supersedes old visual layout rules.

## Before / after feature matrix

| Feature / contract inventoried before editing | Preserved result |
| --- | --- |
| GET `/api/money/payments`, optional staff `client_id`; server session own-file isolation | Same request/permission handling; no transport/auth edits |
| Actual owed balance, open count, late amount/count, next due date/amount/plan | Same values and calculation, reordered owed → next → late in one neutral summary; no sample injection or null/zero changes |
| Plan status, original/paid/remaining amounts, progress, installment dates/amount/paid/status | Same renderer values; clearer balance hierarchy, compact schedule; keyboard-focusable labelled table scroll region |
| Client help POST `ask_for_person`, disabled saving, inline success/failure | Same action/handler; moved support beside its clear primary action above plans |
| Staff-only add-plan with schedule validation, record-payment, settle consequence/confirmation, unmatched Commas receipts | Same controls, IDs, forms, payloads and role logic; no hiding of authorized controls |
| Upcoming list and helper history; text sent/not-sent distinctions | Same content; independent card heights remove empty matching panels |
| Loading, empty, error, retry, sign-in redirects, staff client selection | Same behavior and handlers; neutral styles cover each state |
| Standalone money-back/nav links; FinanceOS payments module export/mount | Same IDs/routes/query propagation and section registration. New CSS also targets `#fos-payments .fh-payments`; lead owns loading stylesheet on FinanceOS |
| Entitlements, billing fees, collections, other portal features | No logic changes. No payment execution, bank, upload, consent or outbound path added |

## Exact verification

- `node --test src/http/money-payments-screen.test.mjs src/http/money-payments.test.mjs`: **29 pass, 0 fail, 0 skip** after final markup change.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_payments.spec.mjs --workers=1 --reporter=line`: **5 pass**. Full/empty/loading/error at 1440/390/320, no document overflow, verified client session activation, keyboard Enter invokes exact mocked help POST and success, staff controls retain original role behavior, embedded module retains 18px card hierarchy. Final rerun follows accessible scroll enhancement.
- Existing `e2e/s1-money-payments-setup.spec.mjs`, filtered to `Payments, staff controls on the standalone page`: **7 pass**. Add/invalid schedule/record/invalid amount/settle Yes and No/server-refusal behavior preserved.
- All API calls intercepted using safe existing fixture; no real payments, customer writes, outbound messages or bank actions.
- Twelve raw state/width screenshots named `page-money-payments-{full,empty,error,loading}-{1440,390,320}.png` alongside this note. Three `...full-{width}-marked.png` add red summary review box and caption. Inspected full desktop and phone; tables scroll within their own container; primary help remains reachable.
- Root owns combined lint/TypeScript/performance and full FinanceOS integration check. Embedded local test uses the real module on its real mount ID inside standalone shell, not a claim of a full FinanceOS backend journey. No database proof claimed.
