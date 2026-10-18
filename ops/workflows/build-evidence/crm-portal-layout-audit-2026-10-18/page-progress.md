# Progress — professional workspace refinement

Single retained builder `/root/page_progress`. Files: `public/progress.html`, `public/progress-ios.css`, `e2e/page_progress.spec.mjs`, this evidence note and `page_progress-*` screenshots in this folder. No shared file/API/board edits, commits or deployments.

## Inventory and preservation matrix

The existing full page, earlier preservation inventory, progress intended journey, heartbeat rules, Mac WelcomeView and current shared-header integration were read before changing presentation. All application JS is unchanged in this refinement.

| Existing behavior | Before → after |
|---|---|
| Server-authorized client/staff file selection, bearer token/cookie, 401/403/400 handling | Retained; client styling requires verified shared session; staff uses original theme |
| Root URL and return-to-same-client portal link | Retained `/progress.html`, `/app/client-portal.html?id=…`; original hTitle/hSub/back remain |
| Real file stage, round/cap, response due, waiting owner, regulator-safe language | Retained; compact neutral status panel; no invented progress |
| Next task owner, title, due/overdue and paid option | Retained; now adjacent to status on desktop and immediately after status in phone/DOM order |
| Personal/business score panels, business selector, no-pull/sample labels, report URLs | Retained; readable metrics and all three personal bureaus |
| Movement counts, score history SVG, baseline/null semantics | Retained unchanged |
| Checklist order/states, tick/untick, report-closed/ongoing, upload proof and errors | Retained; original IDs/handlers and 44px controls |
| Paid service selection, totals, confirmation, checkout resume/in-flight/idempotency/URL safeguards | Retained unchanged |
| Deliverable downloads and owned-not-ready rows | Retained unchanged |
| Timeline dates and wording | Retained unchanged |
| Referral enrollment, failure/retry, copy link/code, affiliate dashboard and successful shared nav refresh | Retained unchanged; failed requests do not reveal enrollment |
| Loading/empty/error/full, dialogs and login recovery | Retained; neutral loading skeleton; no fake data |
| Exact APIs | GET `/api/read/client-progress`, GET/POST `/api/paid-services`, POST `/api/waypoint-tick`, POST `/api/documents-upload`, GET `/api/documents-download`, POST `/api/affiliates/refer`; all unchanged |

## Layout

Warm #f8f8f6 canvas, rounded system typography, 30px title, 18px sections, 34px scores, 18px white cards, black/outlined controls and a two-pixel spectrum accent. Removed purple/blue gradients, large promotional status headline and duplicate page wordmark for verified clients. Shared header/account/nav remains lead-owned. Scoped only the original `.client-ios-page-intro`, so the inserted workspace header is unaffected. Existing staff theme remains outside `data-client-ios`.

## Verification

- Focused node run: **142 passed, 0 failed, 0 skipped**. Log `/tmp/progress-professional-node.log`.
- Initial combined browser run: **26 passed** (6 focused plus existing 20 progress regressions). Log `/tmp/progress-professional-browser.log`.
- Expanded focused run: **10 passed**: full/loading/empty/error at 1440/390/320, one shared header, hidden duplicate wordmark, compact title, no horizontal overflow, keyboard Space checklist save, safe mocked upload, referral success/failure and touch enrollment. Log `/tmp/progress-professional-final.log`.
- Safe mocks intercept all APIs; no customer, payment, bank or outbound writes. Test fixture data stays in tests.
- Captures: `page_progress-{1440,390,320}-fold.png`, full pages, width-specific loading/empty/error. Inspected 1440 and 320 folds: status/next work both clear and no duplicate brand; phone follows the same order. Annotated 1440/320 review captures mark the refined content hierarchy.
- Existing source registry/tripwire coverage is retained; no new live route/page/job/send.

Unrun by this page builder: real device validation, live data/database referral persistence, constrained-network performance, project-wide lint/TypeScript and bundled heartbeat proof. Lead owns integration checks; mocked browser passes do not establish those results.
