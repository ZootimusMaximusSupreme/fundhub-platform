# Dashboard completion and Kanban scan — 2026-10-19

Lane C is read-only on app/config/tests. No customer records, login, outbound sends, POSTs to production, commits or publication. Inventory source: `ops/workflows/crm-portal-layout-manifest.json` and `ops/workflows/crm-live-font-reconcile-2026-10-18.md`. Source checked on `codex/dashboard-ux-polish`, base `842ebfc6e10faa0de4e915b33f85f88f94288dc3`.

## Completion inventory

| State | Count | What the evidence supports |
| --- | ---: | --- |
| Integrated and published checkpoint | 36 | Fresh public reads below confirm all 36 HTML files match the recorded published checkpoint. This is source/publication proof, not every action/role proof. |
| Individual result retained; not integrated | 3 | Payment Success and Reset Password source recovery is recorded; fresh integration checks remain. Consent Capture completed-result recovery is still recorded as pending. |
| Original owner implementation recorded active; not integrated | 2 | Automations and Inquiry Specialist. The manifest records this state; this scan did not independently establish whether those workers are running now. |
| Unfinished; original owner retained; recorded inactive | 20 | Exact list below. These rebuilds are not complete just because an existing page can open. |
| **Total** | **61** | **25 rebuilds are not integrated. The full overhaul is not complete.** |

### Published pages

Staff/shared workspaces (12): Calendar, Client Workspace (`client-control-panel.html`), Sales Workspace (`closer-dashboard.html`), Contracts, Client Success (`csm-queue.html`), Documents, Finance (`finance-os.html`), Lenders, Messaging, My Numbers, Pipeline, Sales Floor.

Client/entry pages (24): Affiliate, Client Home (`client-portal.html`), FinanceOS (`financeos.html`), Money, Money Accounts, Alerts, Banks, Connections, Credit, Declines, Fundability, Helper, Next, Payments, Plan, Setup, Strategy, Transfers, Vault, Soft Pull Approve, Login, Portal Login, Contract, Progress.

### Retained completed results awaiting integration (3)

| Page | Original owner | Remaining checkpoint |
| --- | --- | --- |
| `public/app/payment-success.html` | `/root/page_payment_success` | Recovered source; fresh tests/integration pending |
| `public/reset-password.html` | `/root/page_reset_password` | Recovered source; fresh tests/integration pending |
| `public/app/consent-capture.html` | `/root/page_consent_capture` | Retained result still being recovered; not integrated |

### Unfinished implementation (22)

Manifest records implementation active for Automations (`/root/page_automations`) and Inquiry Specialist (`/root/page_inquiry_remover`).

The other 20 are Agent Editor, Brand Studio, Campaign Manager, Company Brain, Content Admin, Creative Factory, Galaxy, Hiring, Journeys, Marketing Command Center, Morning Brief, Ops Admin, Partner Galaxy, Partner Training, Present, Products & Commissions, Social Studio, Staff & Teams, Teleprompter Remote, Teleprompter. Their original `single_builder` owners remain in the manifest. No duplicate builders were started by this lane.

### Inventory checks and evidence gaps

- All 61 manifest HTML files exist. All directly linked local `<script>`, `<link>` and `<img>` resources resolve to existing files. This does not cover runtime-generated links, external resources, API availability or role access.
- Eleven per-page Markdown reports referenced by the manifest exist in this checkout. Fifty referenced per-page report paths do not. The retained client build and shared release/font evidence live elsewhere under `ops/workflows/build-evidence/`; missing individual report paths do **not** mean those 50 pages are missing or broken. The manifest's retained source reference is `codex/crm-portal-layout-professional`.
- Historical integrated build evidence: `ops/workflows/build-evidence/crm-font-live/runs/39167073054/checks.json`; the published checkpoint notes 877 source checks and 380 browser cases. Those historical totals were not re-counted as fresh checks by this lane.

## Fresh public HTML verification

Read **2026-10-19 10:22:56–10:23:00 PM Phoenix** (`2026-10-20T05:22:56.494Z`–`05:23:00.466Z`). Only unauthenticated static HTML GETs and public `/api/health` were requested.

- **36/36** published HTML URLs returned HTTP 200 and **36/36** byte-matched release checkpoint `7719773083f07ea71f762d8428f170d35016d5bf` by SHA256.
- **30/36** also match base main `842ebfc6e10faa0de4e915b33f85f88f94288dc3`. Affiliate, Client Control Panel, Documents, Lenders, Messaging and Pipeline differ from that newer main but exactly match the published checkpoint. Merge #70 changed those six source pages; their newer HTML is not in these live responses.
- Public health: HTTP 200, `ok:true`, `db:"up"`, `migrations:394`. Health returns no release version, so an exact current whole-deployment commit cannot be established from it.
- Release record: checkpoint commit above; ship-log commit `95f7a2d8711027f7dc51d8ee44d0bce277527a40`; recorded ship [39169158721](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/39169158721). Do not treat these 36 source matches as proof of every workflow or of newer uncommitted preview work being live.

Full per-file URL, response date, live/source/checkpoint SHA256 and ETag: [live-html-inventory.json](scan-evidence/live-html-inventory.json).

## Fresh Kanban checks

`docs/journeys/role-owner-intended.md`, `role-closer-intended.md` and `role-funding-advisor-intended.md` define reachable doors, not a complete event sequence. `ops/workflows/system-map-2026-08-26.md` explicitly forbids calling a board load or one write a full journey pass. This scan makes no journey-completion claim.

**35 Chromium cases passed** across `pipeline.spec.mjs`, `pipeline-honest.spec.mjs`, `pipeline-waiting-on.spec.mjs`, `pipeline-new-archive.spec.mjs`. Isolated local port 43219; outputs `/private/tmp/dashboard-scan-results`; all APIs intercepted with synthetic data. These ran current branch source, not the different live Pipeline HTML.

Covered: API cards render; desktop drag and Move post the expected stage/client/rail payloads; entered-at stage clock; age filter; mutually exclusive waiting buckets and counts; oldest-wait link and computed highlight ring; matching counter/select filters and clear; 40-card volume and phone layout; honest empty/failed/loading-to-full states; New Client required fields/exact payload/refusal/cancel; Archive exact-DELETE gate/cancel/Escape/refusal/drawer behavior.

**135 source/handler checks passed, zero skips** across `src/http/pipeline-screen.test.mjs`, `pipeline-drawer.test.mjs`, `pipeline-cards.test.mjs`, `pipeline-counts.test.mjs`, `pipeline-clients.test.mjs`, `pipeline-stage-amount.test.mjs`. These use source checks and fake dependencies; they are not a real-database persistence check.

Independent owner-fixture visual captures at 1440px and 390px, each in full/empty/error states: zero sideways page overflow in all six. Full state has 40 cards and 14 waiting; first card top is 394px desktop / 402px phone. Empty state has zero cards and waiting 0. Failed read has zero cards and waiting unknown (`—`). `#boardStatus` retains hidden loading text after success; it is hidden, not a visible stuck-loading finding.

Marked review images: [desktop full](scan-evidence/pipeline-full-1440-MARKED.png), [phone full](scan-evidence/pipeline-full-390-MARKED.png), [desktop empty](scan-evidence/pipeline-empty-1440-MARKED.png), [phone empty](scan-evidence/pipeline-empty-390-MARKED.png), [desktop error](scan-evidence/pipeline-error-1440-MARKED.png), [phone error](scan-evidence/pipeline-error-390-MARKED.png). Raw copies are in `scan-evidence/_raw/`; measurements in [metrics.json](scan-evidence/metrics.json). These are local test fixtures. Root's in-progress shared branding is visible in captures; publication is not implied.

## Verified finding and remaining proof

| Finding | Screen / role | Standard | Expected | Observed | Evidence | Severity |
| --- | --- | --- | --- | --- | --- | --- |
| KBN-01 | Pipeline / owner fixture, forced failed read | UI-STANDARDS §6 error state | Explain failure in user words and give a next recovery step | “Sales — could not load the board (nodb: …)” includes an internal code and provides no retry/recovery step. Unknown counters correctly stay `—`. This is an error-state UX finding, not a claim of a live outage. | `scan-evidence/pipeline-error-1440-MARKED.png`, `pipeline-error-390-MARKED.png`, mark 1 | MEDIUM |

No other Kanban functional failure was observed in the targeted checks. No app changes were made by this lane. KBN-01 is left for the parent named repair task.

### Parent repair result

After the read-only scan completed, the parent repaired KBN-01 in the named Kanban polish scope. The message now says “Sales — could not load the board. Refresh to try again.” It omits internal source/error values from both the board note and banner. Unknown counters remain `—`. The strengthened failure-state proof and full 40-case Kanban/branding command pass on the final draft.

Green draft evidence: [desktop](evidence/kanban-error-after-1440-MARKED.png) · [phone](evidence/kanban-error-after-390-MARKED.png). The red scan screenshots remain the original finding. This repair is not published yet.

Remaining proof: full role-by-role/client-page audit, all visible controls on every one of 61 pages, live data correctness and live move persistence were not exercised. Other roles, physical phone/Safari behavior and complete funding/customer event sequences remain unverified by this scan. The 25 unfinished/unintegrated rebuilds need their original owner results integrated and tested before the full overhaul can be called complete.
