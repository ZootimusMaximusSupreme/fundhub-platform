# Fundability page — preservation and proof

Owner: page_money_fundability. Scope: `public/app/money-fundability.html`, new standalone client CSS, new browser spec. Existing section JavaScript and shared FinanceOS styles were not changed.

## Before / after feature matrix

| Existing surface/control/state | Before | After |
|---|---|---|
| Read | GET `/api/money/fundability`, bearer token when present, same-origin credentials | Same module and endpoint |
| Client ownership / staff access | Endpoint gates own client file; staff use `client_id`; 401 chooses client/staff sign-in | Unchanged; styling activates only verified session principal `client` |
| Header/back | Portal link; staff `client_id` switches to Finance OS back link | Preserved ID, href and behavior |
| Money navigation | Overview/accounts/credit/fundability/connections/payments/setup; selected page, horizontal internal scroll, carries staff ID | All preserved; shared client navigation additionally mounted by lead-owned script |
| Current score/funding estimate/future score | Real API values, null stays dash, fundability tier, checks and estimate caveat | Same rendering; dark/violet/mint cards |
| Now/later chart | Plan + optional if-removed line, distinct shapes/dashes, date assumptions; keyboard/click/hover controls | Same module; keyboard Enter and touch tested |
| Drivers/tips/limits | Words and shapes for pass/miss/unknown; engine sentences and projection limits | Same rendering |
| Businesses | Separate cards, per-business projections/band/estimate/credit; optional missing-details/add links | Same renderer, no summation; internal table scroll retained |
| Sample disclosure | Only API `sample:true` renders explicit sample warning | Unchanged; no new client/account sample injection |
| Loading / empty / error | Layout skeleton; soft-pull setup link; named error with retry | Preserved and browser tested |
| Staff rendering | Original standalone page theme and same APIs | Verified staff receives no `data-client-ios`; back and nav retain client_id |

## Changes

Approved iOS canvas, pill navigation, large heading using existing title token, rounded cards, native system type, dark primary metric, pastel comparison tiles. All new rules scoped under `body[data-client-ios]`. Mobile factor statuses wrap on a second row to avoid collisions at 320px. No new dependencies, endpoints, data writes or flow changes.

## Verification

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_money_fundability.spec.mjs --workers=1`: 3 passed. Each width (1440/390/320) covers all four states, error retry, setup link, selected nav, keyboard Enter chart selection, touch chart selection, staff ID link preservation, and no document overflow. All API calls are safe fixture mocks; writes counter is zero.
- `node --test src/finance/fundability.test.mjs src/http/money-fundability-screen.test.mjs src/http/fin-b08-money-fundability.test.mjs`: 75 passed, 0 skipped.
- Full-page screenshots: `page_money_fundability-{full,empty,error,loading}-{1440,390,320}.png` alongside this file. These are approved-result review drafts, not issue screenshots. Phone full state visually inspected.
- No DB or production claims: browser uses existing real-contract fixture. Live authorization/account permissions remain server-owned and were not changed. Database integration tests not run by this page agent. Lead owns whole-build lint/TypeScript/performance/release checks.
- Added CSS is about 5KB, JS reuse unchanged; no performance benchmark claimed.
