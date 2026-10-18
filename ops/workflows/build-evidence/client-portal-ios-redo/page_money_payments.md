# Payments page — preservation matrix

Owner: `page_money_payments`. Scope: `public/app/money-payments.html` and its new client-only stylesheet. Shared money section remains unchanged so the FinanceOS embedded payment tab and staff desk keep their behavior.

| Before feature/control | After |
| --- | --- |
| `payments-root` mounts existing FinanceOS payment module | Same ID, script, renderers, event handlers |
| GET `/api/money/payments` with optional staff `client_id` | Unchanged; session/server still pins client data |
| Own-file client view; FINANCE staff controls with `client_id` | Unchanged; shared style activation requires verified client session |
| Paid, late, due soon, upcoming, next payment, totals, schedules, progress bars | Same real-data renderers; new rounded cards and muted/pastel summary tiles |
| Money helper timeline, sent/not-sent distinctions | Unchanged |
| Talk to a person POST `ask_for_person`; inline saving/success/failure | Unchanged |
| Staff add-plan form, record-payment form, settle confirmation, unmatched Commas list | Unchanged; client CSS has no effect on staff sessions |
| Loading skeleton, no plans, client-required/forbidden/network/server errors, retry, auth redirect | Unchanged renderers and retry/auth handlers |
| Six FinanceOS hash links; `money-back`; staff query propagation | Same links, IDs, aria-current, query handling |
| Keyboard/touch/reduced motion | Shared focus ring and reduced motion; client navigation/control hit areas >=44px; local table scrolling retained |
| PWA/install/push, uploads, signatures, courses, referrals | This page contains none; no removal or API changes |

## Review and verification

- Read AGENTS.md, relevant CLAUDE notes, UI/PERF standards, client intended journey, heartbeat flow, approved HTML and page module/styles.
- `node --test src/http/money-payments-screen.test.mjs`: 13 pass, 0 fail, 0 skip.
- `node --test src/http/money-payments.test.mjs`: 16 pass, 0 fail, 0 skip.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_payments.spec.mjs --workers=1`: 4 pass. Mock session returns verified `principal: client`; no forced styling attribute. Full/empty/error/loading at 1440/390/320; assert no page overflow; exact help POST and success; staff retains original controls and theme. All API calls intercepted safely.
- Existing standalone payment/setup browser regression: 12 pass (includes all seven payment staff/control regression cases; other five cover unchanged setup page).
- Twelve screenshots alongside this matrix: `page_money_payments-{full,empty,error,loading}-{1440,390,320}.png`. Visually inspected full phone screenshot; table overflow remains inside schedule container. These are page review deliverables, not issue/fix screenshots; no issue boxes added.
- Central lead owns repository lint, TypeScript applicability, performance gate and final cross-page/independent review. No database verification claimed here.
- No backend/action changes; no new route, job, outbound send path, money movement, real customer writes, account samples, or credential changes. Existing heartbeat/tripwire scope remains unchanged.
