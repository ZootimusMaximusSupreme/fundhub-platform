# Soft-pull approval — implementation evidence

Single assigned builder: `page_soft_pull_approve`. Scope: signed public `public/app/soft-pull-approve.html`, its new CSS, new responsive browser test and this evidence. Existing scripts, APIs, server authorization and price/consent language remain unchanged.

| Before feature / state | After and verification |
|---|---|
| Signed query: org/client/exp/sig; GET `/api/soft-pull-approve` | Unchanged; missing query makes no API request; expired link has no form (existing browser tests pass). |
| Server disclosure text/version, greeting, prior consent | Same escaped values; mocked prior consent visible in responsive screenshots. |
| Name, SSN, DOB, street/city/state/ZIP | Same IDs, required fields and submitted values; full existing payload test passes. |
| Add/remove businesses; business name/address/EIN/incorporation/extra owner | Preserved; normalization, 20 safety cap and running total covered by original tests; Enter-key add/remove checked at all three widths. |
| POST consent `/api/soft-pull-approve` with signed query fields | Original JSON and request behavior preserved; no real writes used. |
| Success with server checkout URL/total; fallback without link | Existing tests verify same payment link and advisor fallback. No payment initiated. |
| Invalid/address/EIN/server/network errors | Original rejection and retry handling retained; missing/expired/server refusal tested. |
| Loading / empty / error / full | New structured loading skeleton; absent signed link is the correct empty/error state (no unauthorized blank form); expired links preserve server error; full mock form includes prior consent and optional empty businesses. |
| Staff and access controls | Dedicated public presentation uses shared `data-client-public`, no session-based portal navigation; no API/auth/permission changes. |

Design: approved native system font, large heading, canvas, rounded white groups, mint total and 44px+ controls; single column at 390/320. No mock data introduced in production. All form data continues to come from the authorized existing endpoint.

Verification: `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/soft-pull-approve-clicks.spec.mjs` — 9 passed. `... npx playwright test e2e/page_soft_pull_approve.spec.mjs` — 3 passed; widths 1440/390/320, loading/full/empty-error snapshots, zero horizontal overflow, keyboard add/remove. Visually inspected 390 full screenshot. Review PNGs mark the redesigned header in red; adjacent original snapshots cover full page and states. Page-specific CSS ~4KB, no new external dependencies, no added API requests. Full throttled performance/database acceptance not claimed; lead owns integration lint/TypeScript/full verification.
