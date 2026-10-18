# Soft-pull approval professional layout

Retained sole builder `/root/page_soft_pull_approve`. Implemented only assigned HTML, page-specific CSS and focused test. Warm off-white/black Mac-reference hierarchy replaces prior pastel styling. Desktop separates readable consent/next-step guidance from the actual details form; phone stacks the same content in reading order. Existing shared assets remain. No mock information added to production.

## Feature preservation inventory and matrix

| Existing contract / control / state | Result |
|---|---|
| Dedicated public signed page; org/client/exp/sig | Unchanged tokens and security flow. Incomplete link makes no API request. No session nav added. |
| GET `/api/soft-pull-approve` query and escaped response | Unchanged. Server contact, disclosure/version, pricing and prior consent remain the authority. |
| Disclosure and authorization meaning | Original copy, visibility and submission action retained. |
| Full legal name, SSN, DOB and current address | Same IDs/names, required fields and payload. New semantic details heading. |
| Business name/address/EIN/incorporation/extra owner | Unchanged; add/remove, retained drafts, normalization and twenty-item safety cap preserved. |
| Running total and per-business price | Same calculation from returned pricing; neutral divided total presentation. |
| POST `/api/soft-pull-approve` signed fields and personal/business values | No changes. Safe existing mocks prove complete payload and validation. |
| Consent saved and checkout URL/amount | Existing success and actual server-returned link unchanged; missing URL retains advisor fallback. No live consent or payment invoked. |
| Empty/missing link, expired link, failure/retry | Original no-form errors and recoverable POST rejection remain. |
| Loading/full | Existing skeleton retained with neutral style; full test has server prior-consent mock and empty optional businesses. |
| Staff/permissions/other journeys | No shared/API/session/role edits; this surface retains its signed-link authorization model. |

## Checks and screenshots

`PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/soft-pull-approve-clicks.spec.mjs e2e/page_soft_pull_approve.spec.mjs --reporter=line`: **12 passed**. Original 9 cover incomplete/expired links, totals, cap, validation, payload, checkout/fallback and recoverable server refusal. Focused 3 cover 1440/390/320 loading/full/empty-error, no horizontal overflow, keyboard Enter and pointer add/remove. Focused test aborts external URLs and uses safe API mocks. No real authorizations, banks, messages or payments.

Screenshots alongside note: `page_soft_pull_approve-{1440,390,320}-{loading,full,empty-error,review}.png`. Review copies mark the changed header in red; raw full screenshots preserve the full form. Visually inspected desktop and phone. Root owns combined lint/TypeScript/integration gates. Live database and throttled performance not run or claimed. Page adds no API calls or third-party dependencies. No commit/deploy.
