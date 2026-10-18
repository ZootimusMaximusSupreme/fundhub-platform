# Money helper professional refinement

Builder: same sole `/root/page_money_helper`; branch `codex/crm-portal-layout-professional`. Presentation scoped to verified clients and the actual `#helper-root` standalone / `#fos-helper` FinanceOS module roots. No other page, shared file, backend or real records changed.

## Inventory and feature preservation

| Before: control / contract | After |
| --- | --- |
| GET `/api/money/helper`, client authentication, staff `?client_id` selection | Request/auth code unchanged. Staff backlink and absence of client styling verified. |
| POST `{action:"send",message}`; staff adds `client_id` | Handler/schema unchanged; exact safe-fixture payload and keyboard Enter verified. |
| Labelled `#mh-input`, 20,000-character paste cap, suggestions | IDs, cap, all three suggestions retained; suggestion sends verified. |
| Composer busy/disable, empty submission, retry, draft preservation | Logic unchanged. Failed-send feedback and retained draft verified. |
| Loading, empty, error, full thread | All rendered at 1440/390/320 with no document overflow. |
| Helper on/off, STOP/halt, restricted viewer | Logic unchanged; stopped/off/403 hide composer and no POST occurs. |
| Stored history, timestamp tooltips, AI/rules attribution/reasons | Every rendered turn/action retained; 4 fixture replies verified. |
| Pending polling / Thinking / check again / failed answer | Logic unchanged; covered in existing screen tests. |
| Actions: reminders, plan steps, person tasks, transfer proposals, saved declines | No action code changed. Approval language remains explicit. Chat approval does not move money. |
| Portal backlink and Money navigation | IDs/hrefs preserved. Unified native Money picker is lead-owned. |
| Staff/API permissions, consent/financial decisions and server guardrails | No backend changes, no client-side fabricated success or automatic approval. |

## Layout

Replaced giant title, gradient messages and pastel cards with 28/32px title, 15px conversation body, 13px detail, warm off-white canvas, white 18px cards, neutral statuses, 11px controls and black Send. Empty state now says “Start a conversation” with precise available work and unchanged suggestions. Existing empty-copy-only test assertion updated to require both new heading and actionable decline/person guidance.

## Checks and review evidence

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_helper.spec.mjs --reporter=line`: five standalone/staff/safety tests PASS; added sixth actual FinanceOS module style assertion currently FAILS because lead-owned FinanceOS has not included `money-helper-ios.css`. Integration request sent to lead; do not call that proof passed until included and rerun.
- `node --test src/http/money-helper-screen.test.mjs`: 22 PASS, 0 skipped.
- Twelve screenshots `page-money-helper-{full,empty,error,loading}-{1440,390,320}.png`; full captures include failed-send feedback and preserved draft exercised by test.
- Red-box review files `page-money-helper-review-{1440,390}.png` mark task/history/composer area. Phone screenshot visually inspected: helper refusal and failed draft readable; all touch controls and primary action remain usable.
- All browser API calls intercepted, synthetic fixture only. No real messages/payments/banks/client writes.
- Global lint/TypeScript, broader integration and independent review remain lead-owned. No database/live-account proof claimed. Existing helper heartbeat/tripwire path untouched.
