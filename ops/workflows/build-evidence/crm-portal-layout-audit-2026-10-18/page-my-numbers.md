# My numbers source recovery — 2026-10-18

Recovered by the original sole page builder from retained source/tool-argument history after the original executor disconnected. Base: current main 0998ff49969c6e2663a6e1851b4634ab5896113d. Recovery branch: codex/recover-my-numbers. This is a source recovery, not a deployment or current test pass.

## Reconciliation

The current production page has the same nine original IDs and the original my-numbers.js paint contract. The recovered presentation preserves every existing ID, both page APIs, all existing metric and link semantics, and the production sidebar markup. It adds page-specific IDs for stable rendering after reordered sections. No shared source, API handler, role gate, workflow or deployment configuration changes.

| Feature | Preserved behavior |
| --- | --- |
| Cash/target/rank/shift | Session-scoped cash, deposit target progress, target reason, team rank/count, shift on/off and elapsed time |
| Eight month metrics | Deposits, close rate, show rate, downsells, deposit-to-funded, average funded/reason, held calls/no-shows, unlogged; prior comparisons retained |
| Offer stack | Every product and total; units/sold/cash; retired label; refunds; explicit reasons for missing values; actual zero remains zero |
| Commission boxes | Paid and pending from ledger; unknown at-risk stays dash with explanation |
| Team | Rank, staff identity/You, deposits, cash and close rate, including phone layout |
| Owed actions | Urgency/title/detail, exact encoded client/task links, plain non-client items, honest empty and shown-count states |
| Quality/compliance/streak | Unavailable reasons retained, no invented measurement |
| Refresh and retry | Read-only reload, explicit loading/error, retry recovery, last-loaded values labeled after refresh failure |
| API text | Displayed as escaped text rather than injectable markup |

Exact page calls remain GET /api/auth/session and FHData.read("my-numbers") -> GET /api/read/my-numbers, with no added query or write. Owed links remain closer-dashboard.html?client_id=<encoded> and optional &task_id=<encoded>. Existing role/organization enforcement remains in the shared shell and API.

The page removes its old Inter/Google Fonts links and local --sans definition. All page font rules use var(--sans), inheriting the integrated shared native rounded font adapter. Shared header owns identity, Search, Chat, account and Your performance scope.

## Proof status

Historic proof on the lost original checkout: 13 focused Playwright cases passed (11 new + 2 existing), 12 focused Node cases passed plus one targeted HTML case. Historic screenshots are not recovered in this commit. These are not claims about this new commit.

CURRENT RECOVERY PROOF IS PENDING. The root will merge into its shared-foundation integration branch and run the cloud Chromium proof before release. The focused spec checks full/empty/loading/error at 1440x960, 390x844 and 320x844, no horizontal overflow, exact links, keyboard Enter, minimum touch target, early phone action, null versus zero, refunds, unavailable states, API string safety and refresh/retry. It also asserts the integrated shared header's Your performance/session-staff scope.

Focused browser command:
npx playwright test e2e/my-numbers-layout.spec.mjs e2e/sales-dashboards.spec.mjs -g 'my numbers|my-numbers' --reporter=line

Existing Node command:
node --test src/http/closer-ui-honest.test.mjs src/http/fin-b26-read-my-numbers.test.mjs

The historic wider crm-html suite had an unrelated messaging clock assertion failure. Current lint, type, Node, browser and live result must be judged by the new root cloud run.
