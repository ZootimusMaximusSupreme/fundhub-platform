# page_progress — feature preservation and verification

Owner: page_progress. One page: `public/progress.html`; page-only style: `public/progress-ios.css`; new proof: `e2e/page_progress.spec.mjs`. No shared/API/other-page edits. Existing source was inventoried before replacement; the original application script, control IDs and server data contracts remain intact except the narrow successful-referral navigation refresh hook and stricter rejection of `ok:false`.

## Before / after matrix

| Existing feature / control | Exact source / API | After |
|---|---|---|
| Session authority; client cannot choose another file | bearer `fh_token`, same-origin cookie; GET `/api/read/client-progress`; client_id/id retained only as server-authorized selector | Preserved; no local sign-in guess or role conversion |
| Staff preview returns to same file | `paintBackLink`, `/app/client-portal.html?id=…` | Preserved; client styles gated by shared verified role |
| File stage, real round/cap, response date and waiting owner | `paintStage`, GET progress | Preserved; dark approved-design status card; no invented four-step count |
| Personal score panels and report opening | `paintScores`, GET `/api/documents-download?id=…` | Preserved; unknown remains “Not pulled yet”; one-column phone panels |
| Business selector and per-business scores | `businessIndex`, `paintScores` | Preserved; no blended score |
| Real score movement, removals/disputes, SVG history | `paintMovement`, progress payload | Preserved |
| One next step and owner/due/overdue state | `paintNext`, nextStep/waypoints | Preserved; tinted next card |
| Checklist order, done/blocked/ongoing/report-closed states | `paintWaypoints`, `waypointCard` | Preserved |
| Accessible tick/untick + failure + immediate next-step update | POST `/api/waypoint-tick`, `waypoint_id`, `done` | Preserved; keyboard target 44px |
| Mailing-proof upload; server decides completion | POST `/api/documents-upload`, multipart kind `client_upload`, subtype `dispute_mail_receipt` | Preserved; no automatic success tick |
| Paid alternatives, optional components, total and confirmation | GET/POST `/api/paid-services`, `paid_round`, creditor/escalation booleans, waypoint/idempotency | Preserved; no real checkout attempted |
| Existing in-flight request and payment resume | `paidResumePromise`, in-flight gates | Preserved; second-purchase and checkout-pending protections intact |
| Safe checkout/download URL allowlist | `safeUrl` | Preserved |
| Owned documents awaiting generation | `paintDeliverables`, `ownedNotReady` | Preserved; no empty-list hiding |
| Timeline dates and client-safe wording | `paintTimeline`, `timelineParts` | Preserved |
| Referral enroll / failure / retry | POST `/api/affiliates/refer` | Preserved; `ok:false` now rejected even on 200; only real successful response calls shared `FHClientIOS.refreshAffiliate()` |
| Existing referral link/code/copy/dashboard | `paintReferralEnrolled`, `/app/affiliate.html` | Preserved; input labeled for assistive technology |
| Loading, empty, fatal 403/404/400/other/network | existing branches, added `progressLoading` skeleton | Preserved; skeleton hides only once read settles |
| Dialog close/action/new-tab behavior | native `dialog` and existing action renderer | Preserved; named by existing title/description |
| Root route + no framework/chart dependency | `/progress.html` | Preserved |

## Visual implementation

Approved iOS system type, dark real-status hero, white rounded groups, tinted next-step panel, 12-column desktop layout and single-column mobile. Shared lead assets load after existing page assets. Page-specific visual rules require `data-client-ios`; staff previews keep prior visual rules. Root back link is unchanged. No demo records or sample values were added to this page.

## Executed checks

- `node --test src/http/progress-page-boot.test.mjs src/http/fin-b08-client-progress.test.mjs src/progress/read.test.mjs src/progress/scores.test.mjs src/progress/timeline.test.mjs src/progress/escalations.test.mjs`: **142 passed, 0 failed, 0 skipped**.
- `node --check e2e/page_progress.spec.mjs` and extracted inline page script: passed.
- Existing `npx playwright test e2e/progress-page.spec.mjs --reporter=line`: attempted; **20 launch failures**, exact blocker missing `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`. No browser exists in the cloud filesystem. This is no browser proof.
- New page-specific spec written for 1440/390/320 widths, keyboard tick, referral success/failure, no horizontal overflow, loading/empty/error/full. Not yet executed: awaits browser and lead-owned shared assets.
- Screenshots, computed styles, actual touch/keyboard/browser control proof, constrained-network performance: **not yet verified**. No screenshot or performance pass claimed.
- Database-backed persistent referral linkage is lead-owned and remains separately required. Mock UI proofs cannot establish it.

## Heartbeat

Existing `progress.html` registry row and `read/client-progress` registry route retained. Existing tripwire map names `portal:progress-read-real-client` for both route and page. No new live page/API/job/send path added. Bundle/live pulse proof and project-wide lint/TypeScript are lead integration checks; this page agent has not claimed them green.

## Browser follow-up — cloud Chromium provisioned

The initial missing-browser note above is superseded for this page. Lead supplied `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium`. Fixed the new test's auth fixture to use the actual shared session contract (`principal: "client"`); no forced body attributes. Browser inspection found the page gutter competed with the shared rail; fixed page-only gutter specificity. Disabled score buttons now retain readable ink and business-credit heading keeps its section spacing.

- Final `PLAYWRIGHT_CHROMIUM=… E2E_PORT=43129 npx playwright test e2e/page_progress.spec.mjs --reporter=line`: **6 passed (5.1s)**. Log `/tmp/page_progress-browser-final.log`.
- Existing `e2e/progress-page.spec.mjs`: **20 passed** in the combined run. Combined initial run was 25/26 because the first new desktop test had loaded the pre-gutter-fix CSS; all six new cases passed on the clean final rerun.
- 1440/390/320 full state checks assert real shared auth activation, round/cap, owned pending document, upload with safe mock file, keyboard Space tick, successful enrollment/link, and no sideways page overflow. Failed referral keeps no enrollment/dashboard claim. Empty/error/loading states also pass.
- Screenshots: `page_progress-{1440,390,320}.png` (full page), matching `-fold.png` captures, and `page_progress-{empty,error,loading}.png`. These use isolated mocked test values, not real client records.
- Inspected desktop full/fold, 390 full, and 320 fold images. Dark status card, scores, checklist, documents, referral and navigation remain readable; rail no longer overlaps controls; narrow layout stacks panels.
- Still not proven by this page agent: real persistent database affiliate linkage, actual external checkout/download outcomes, real device touch, constrained-network performance, live bundled pulse. These remain lead integration checks.
