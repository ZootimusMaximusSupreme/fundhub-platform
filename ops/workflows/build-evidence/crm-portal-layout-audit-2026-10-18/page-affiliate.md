# Affiliate — professional workspace refinement

Sole page builder: `/root/page_affiliate`. Worktree `fundhub-layout`, branch `codex/crm-portal-layout-professional`. Assigned source only: `public/app/affiliate.html`, `public/app/affiliate-ios.css`; focused `e2e/page_affiliate.spec.mjs` and page evidence. No shared, API, role, entitlement, sample-account or backend changes. No commit/deploy/real customer writes.

Read assignment, AGENTS, shared audit board and existing page/handlers/tests before replacing presentation. The existing preservation inventory remains the behavior contract; owner Mac reference replaces previous gradient/pastel visual authority.

## Before → after feature matrix

| Inventoried control / conditional state | Preserved behavior and refined placement |
|---|---|
| Identity/header/shell staff rail, collapse/menu, client conditional own dashboard | Shared shell still authenticates/navigation gates. Client frame alone hides legacy rail; staff and affiliate retain own rail; partner remains denied and returns partner-galaxy. |
| Each server-provided offer URL, Copy link, Copy code, real code | First working panel, white bordered surface and black Copy link. Same `offerLinks`, `affCode`, copy handlers/IDs; code copy now next to code. Clipboard refusal gets honest feedback, never Copied. |
| Clicks 30d, rate/range/downline note, first-touch/no-expiry | Compact neutral metadata beneath URL, all original values/caveats retained. No inferred numbers. |
| Referral/conversion/accrued/paid figures, missing tracking and NULL caveats | One neutral financial summary strip; original /read/affiliates rollup and commission helpers intact. No rollup inferred from incomplete local rows. |
| License and tax gates + document reference and chips | Original gate fields and visibility; held payouts remain held. No fake signing/release controls. |
| Referrals / Payouts / Terms tabs, keyboard arrows/Home/End | Promoted ahead of secondary tools; same ARIA-controlled panels, active tab and handlers. |
| Referred/Converted/Paid/Void status filter, business search, unknown/zero commission, total shown caveat | Original row renderer and helper preserved; NULL still dash, zero remains zero, known totals name unknown rows. |
| Complete referral date/business/status/product/basis/commission/payout columns | Same columns with accessible named keyboard-focusable horizontal scroll region on narrow screens. No hidden financial columns. |
| Own payout history, sorted dates/period, client counts, method, amount/status/hold reason | Same renderer, named keyboard scroll region and readable table. |
| Full partner terms / visible-data scope explanation | All text retained. Scope details remain expandable; terms retain original tab. |
| Funnel clicks/referred/converted, tracked denominator and unavailable caveats | Same calculation/source; moved below working records as secondary overview. |
| Partner brain prompt/answer/approved document sources + demo/error states | Same POST `/api/read/company-brain-affiliate`, payload and source links; lower explicit Partner resources section. |
| Message Blaster download, authenticated blob, demo/denial/error feedback | Same GET `/api/gifts/message-blaster`; instructions/download still available below activity. No outbound sends. |
| Loading / failed read+retry / unjoined / enrolled empty / full | All states explicit, tested at1440/390/320. HTTP503 with success-shaped body remains failure and never paints code. |
| Late staff rollup / own read race | Prior `paintMine` matching-row guard retained; delayed-empty-rollup regression retained. |

Exact page APIs unchanged: GET `/api/auth/session`; GET `/api/read/affiliate-portal` with own bearer token, no client-supplied identity; GET `/api/read/affiliates` through FHData; POST `/api/read/company-brain-affiliate`; GET `/api/gifts/message-blaster`. Browser tests intercept every API; no real transactions.

## Visual changes and evidence

Removed62px marketing slogan, dark gradient hero, pastel metric rainbow and repeated metric card frames. Added32px action heading, offer-specific URL first, black copy action, grouped code/rate/attribution, neutral earnings strip, primary activity tabs before secondary tools, two-column resources on desktop/stacked phone. Client224px warm rail is lead-owned. Visible Referrals link retains accessible Affiliate Dashboard name from shared foundation.

Raw captures: `page_affiliate-{1440,390,320}.png` and `-fold.png`. Marked review captures: `page_affiliate-{1440,390,320}-review.png` red outline/caption around the exact task panel. State captures: `page_affiliate-{empty,loading,error,unjoined}-{1440,390,320}.png`. Inspected desktop and phone folds: actual URL and copy action visible above fold, no generic promise hero or rainbow; narrow financial tables scroll inside their named regions.

## Checks

- Node `src/http/affiliate-screen.test.mjs`, `src/http/affiliates-self-read.test.mjs`, `src/affiliates/share-link.test.mjs`: **23 passed, zero skips**. Includes forged-query own-client scope, unenrolled no-query and exact live-offer links.
- First focused browser pass: existing commission + referral persistence/refusal/signout integration + three widths/control/race: **14 passed**.
- Expanded browser coverage includes five states × three widths, held payout/reason, both gates, keyboard clipboard success and rejection, owner/affiliate frame, partner denial. Initial partner expectation incorrectly assumed dashboard access; observed canonical ROLE_TABS denies partner and redirects partner-galaxy; corrected test asserts existing gate, no role source changes.
- Final combined focused browser result recorded below when complete.
- Root owns combined lint/TypeScript/performance suite. No live database/account permission or real enrollment write performed by this page builder; mocked integration proves UI handling/persistence against server fixture, not a production database claim.
- Final Playwright: `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_affiliate.spec.mjs e2e/affiliate-commission.spec.mjs e2e/client-ios-integration.spec.mjs --reporter=line`: **30 passed (24.0s)**, including successful real-flow UI referral reveal across refresh/fresh context, HTTP refusal with success-shaped data, own-code race and all recorded page states/roles. Mocked APIs only.
