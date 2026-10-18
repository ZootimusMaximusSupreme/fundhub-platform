# Money setup preservation evidence

Owner: `page_money_setup`, only builder for `public/app/money-setup.html`.

## Before / after inventory

| Existing feature or state | After |
|---|---|
| Four setup steps, true completed count, current/done/later markers and dates | Original `money-setup.js` renders unchanged; no sample progress inserted |
| GET `/api/money/setup`, same-origin cookies/Bearer token | Unchanged |
| POST `{action:"start_checkout"}` and `{action:"request_soft_pull"}` | Unchanged; real checkout and signed approval redirects retained |
| Entitled/already-paid checkout prevention; stale plan reload | Unchanged |
| Missing price `$X`, no fabricated free price; open checkout resume | Unchanged |
| Soft-pull waiting/no duplicate button, finished Credit link | Unchanged |
| Accounts add/add-more link; completed Open Money link | Unchanged |
| Price per container, count, monthly explanation | Unchanged |
| Skeleton, offline/database/server/permission/not-found errors and retry | Unchanged |
| Six FinanceOS section links and Back to my portal | Same targets retained |
| Staff `client_id` through nav, finance desk back link and role-specific sign-in | Unchanged; new presentation only activates after server session reports client |
| Native keyboard buttons/links, busy disable, action error live region | Unchanged; touch target minimum 44px, focus shared outline |

## Implementation

Scoped `money-setup-ios.css`: approved neutral canvas, large title, rounded Setup/price cards, lavender active step and mint completed steps, segmented navigation, responsive single column. Shared client navigation activated through lead-owned `client-ios.js`. No shared JS, API, IDs, actions or staff CSS changed. Viewport supports safe-area insets.

## Verification

`node --test src/http/money-setup-screen.test.mjs src/http/money-setup.test.mjs src/finance/money-setup.test.mjs`: **61 passed, 0 skipped, 0 failed**. Includes org/client isolation, entitled prevention, safe null pricing and signed approval behavior; mocked DB tests, not live DB proof.

Added `e2e/page_money_setup.spec.mjs` for 1440/390/320, full/empty/done/error/loading, keyboard checkout, safe failed POSTs, retry, staff unchanged, overflow assertions and screenshots. Browser execution/screenshots remain unverified: central runtime has no installed browser; lead requested no installation. No real write/payment/pull performed.

Shared lint/TypeScript and full integration checks remain lead-owned. No new endpoint, job, send path or route; existing heartbeat/tripwire coverage remains unchanged. No new JS dependency or image payload. Performance timings unmeasured without browser.
