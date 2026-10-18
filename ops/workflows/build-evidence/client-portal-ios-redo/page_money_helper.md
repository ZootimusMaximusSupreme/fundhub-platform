# Money helper page — implemented

Owned page: `public/app/money-helper.html`. Added `money-helper-ios.css` and `e2e/page_money_helper.spec.mjs`. Shared module and APIs unchanged. Client presentation activates only after `/api/auth/session` returns `principal: client`; staff retains legacy styling.

## Before / after feature matrix

| Existing feature or state | Before | After / proof |
| --- | --- | --- |
| Real history and helper status, AI/rules labels, timestamps | money-helper.js GET `/api/money/helper` | Unchanged; four fixture turns and action approval label asserted |
| Composer and length cap | Labelled textarea, 2000 limit, Send | Unchanged; keyboard submit asserts exact `{action:send,message}` payload |
| Empty suggested messages | Three send buttons | All three present; first sends through existing POST |
| Failed send | Status words, draft retained | Verified failure feedback and draft retention |
| Loading / empty / error / full | Module render branches | All captured at 1440, 390 and 320 |
| Stopped/off, pending polling, retry/check again | Existing module conditions | Module unchanged; existing 22 screen tests pass |
| Helper actions / no automatic money transfer | Existing permission-checked server actions | Module unchanged; proposal remains needs approval |
| Staff client selection | `?client_id` scoped request and finance-os backlink | Staff client backlink asserted; no client style activation |
| Money navigation and portal backlink | All eight existing links | IDs/hrefs retained; horizontally scrollable phone nav |
| API auth, role restrictions | Server enforced; 401 sign-in, forbidden/not-found errors | Unchanged |

## Verification

- Playwright: 4/4 tests pass, no skips. Three viewport tests exercise all four states plus controls; fourth checks staff presentation.
- `node --test src/http/money-helper-screen.test.mjs`: 22/22 pass, no skips.
- 12 screenshots: `page_money_helper-{full,empty,error,loading}-{1440,390,320}.png`. No horizontal document overflow at any width. Phone full screenshot visually inspected; rounded thread, composer and navigation usable.
- Fixtures and intercepted APIs only; no real outbound messages, payments, bank actions or client writes.
- Existing heartbeat/tripwire entry `desk:money-helper.html` maps to `helper:rows-stuck` and `finance-os:helper`; no endpoint or journey changes.
- Global lint/TypeScript and independent review remain lead-owned. Database/server integration is not claimed by browser fixtures.
