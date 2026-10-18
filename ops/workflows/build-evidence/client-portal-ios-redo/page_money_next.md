# What to do next — page_money_next

Implemented client-only iOS presentation on the existing standalone next-steps page. Ownership: money-next.html, money-next-ios.css, page_money_next.spec.mjs and this page's evidence. No shared renderer, API or authorization changes.

## Before / after inventory

| Feature / state | Before | After |
|---|---|---|
| Tasks | GET /api/money/tasks, names, due dates, late words, origins, explanations, assignee | Same renderer and exact API |
| Delegate task | POST /api/money/tasks {action:"do_task",task_id}; disabled pending; server replacement; inline error; focus result | Preserved, browser success/failure verified |
| Payment proposal | Explicit exact-amount approval warning; never claims money moved | Preserved and verified |
| Self-only task | Open your checklist; no Do task | Preserved in untouched renderer, unit proof |
| Funding request | GET/POST /api/money/ready-to-fund; requested, assigned, done states, retry | Preserved, keyboard/touch browser proof |
| Capital Blueprint | Entitlement-sensitive booking URL, new tab | Preserved |
| Empty / partial sources / loading / errors | Account link, source warning, layout skeleton, retry, classified errors | Preserved |
| Staff client context | client_id query/body; all navigation carries client_id, staff Finance OS return | Preserved; staff never activates new styles |
| Navigation | Six existing FinanceOS hash links and portal return | All retained; shared verified-client navigation added |
| Auth | Bearer/cookie existing API gate, 401 redirects per role | Unchanged; visual activation requires auth/session principal client |

## Verification

- Chromium Playwright: 4/4 passed; 1440, 390 and 320 widths; full/empty/error/loading; no horizontal page overflow; actual shared activation principal:'client'; keyboard delegation, inline failed delegation, successful exact-amount proposal, funding request, booking URL, retry and staff context.
- Existing money-next-screen Node tests: 19/19 passed, zero skips.
- Screenshots: page_money_next-{full,empty,error,loading}-{1440,390,320}.png. Full screenshots show safe fixture action responses, no real writes. Phone image visually inspected: controls intact, one column, no clipped page content.
- Added one small CSS file and existing shared cached assets; no new library or image payload. Slow-4G performance budgets not measured by this page agent; aggregate lint/TypeScript and release checks are lead-owned.
- Read AGENTS.md, relevant CLAUDE.md notes, UI/PERF rules, heartbeat flow, money-helper intended journey and approved HTML. Existing API/section heartbeat and tripwire paths remain unchanged.
