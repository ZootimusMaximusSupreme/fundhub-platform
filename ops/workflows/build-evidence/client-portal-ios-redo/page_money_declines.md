# Applications page — before/after preservation

Assigned builder: `page_money_declines`. Scope: only `money-declines.html`, new page CSS, page-specific browser script/evidence. Existing section JS/API unchanged.

Read: AGENTS.md, CLAUDE.md, UI-STANDARDS.md, PERF-STANDARDS.md, decline-defense-flow.md, heartbeat-flow.md, shared board, approved HTML reference, existing applications shell/module/styles. Existing rules keep four type sizes on this surface; iOS treatment uses approved canvas, lavender/blue cards, rounded inputs, shared client navigation and client-only system font.

| Existing capability | Before | After / evidence |
|---|---|---|
| Applications list and statuses | Server view | Same exact section module; full fixture rendered at all three widths |
| Decline reason, letter quote and human review | Server fields, escaped | Same fields and escaping; full screenshot and 18 existing screen tests |
| Your steps / Fundhub steps | Status words, disclosure | Same statuses; disclosure keyboard Enter verified |
| Letter input / bank / another bank | Entitlement gated | Same IDs/controls, another-bank fields verified |
| Paste action | POST `/api/blueprint/declines`, action paste | Same request; rejected mock write displays error, no success flash |
| Loading / error / retry | Skeleton and retry | All widths captured; Enter retry makes one new GET |
| Empty / entitlement denied | Honest empty copy, no editor without permission | Empty locked fixture captured; no text editor |
| Client scope | Server pins client session | Same GET and server scope; real shared session activation mocked with `principal:'client'` |
| Staff scope | `client_id` preserved on nav/back/read/write | Same module, staff receives no data-client-ios activation; back scope verified |
| Navigation | 7 money links and portal back | Same links/IDs/aria-current; no routes added |
| Sign-in errors | Role-aware sign-in destination | Module unchanged; existing screen tests pass; real session sign-in not exercised here |

Verification executed:
- `node scripts/page_money_declines-browser.mjs`: passed at 1440, 390, 320; full/empty/error/loading screenshots; no horizontal document overflow; keyboard disclosure, retry and paste; failure honesty; staff theme isolation.
- `node --test src/http/money-declines-screen.test.mjs`: 18 passed, 0 skipped.
- Visual review: `page_money_declines-full-390.webp` inspected. Screenshots are clean review drafts, not issue annotations: no detected issue is being asserted.

Limits: browser uses safe API mocks, not production accounts or DB. This page does not add or modify a payment, bank action, send path, API, journey or heartbeat. Database-backed write proof, root lint/TypeScript/performance and cross-portal referral acceptance remain lead-owned; these page checks do not claim those are passed. No production actions taken.
