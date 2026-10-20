# Staff CRM — Astra rollout

Lane A. Approved Astra direction, scoped to the 33 staff manifest pages plus the `closer-call.html` redirect. Shared board: `../crm-astra-rollout-2026-10-20.md`. No Git, release, credentials, native app, or customer-data writes belong to this lane.

## Page purpose recorded before the cohort changes

Existing server role checks remain the authority; the role below describes the page's existing intended audience, not a new permission grant.

| Page | Role / existing audience | One job | First question |
| --- | --- | --- | --- |
| agent-editor | Owner / admin | Configure and review agents | Which agent needs attention? |
| automations | Owner / operations | Inspect workflow readiness | Which workflows can start? |
| brand-studio | Owner / partner admin | Maintain workspace branding | Is this brand ready to use? |
| calendar | Staff | Work the day's schedule | What is next today? |
| campaign-manager | Owner / marketing | Review campaign results and decisions | Which campaign needs a decision? |
| client-control-panel | Staff assigned to the file | Advance one client file | What does this file need next? |
| closer-dashboard | Closer | Prepare for and run the next call | Who am I calling next? |
| company-brain | Staff with document access | Ask questions of accessible company records | What do our records say? |
| consent-capture | Authorized staff | Record the selected client's consent | What consent is on file? |
| content-admin | Owner / admin | Maintain portal videos and content | What content will a client see? |
| contracts | Owner / admin | Maintain agreement templates | Which wording needs an update? |
| creative-factory | Owner / marketing | Create and review partner creative | What creative needs work? |
| csm-queue | Client success | Work due client calls | Which client should I call? |
| documents | Authorized staff | Track documents and signatures | Which document needs follow-up? |
| finance-os | Authorized staff | Review one client's financial state | What is happening with this client's money? |
| galaxy | Owner / operations | Inspect current team activity | Who or what is active? |
| hiring | Owner / hiring manager | Work hiring shortages and decisions | Where do we need people? |
| inquiry-remover | Inquiry specialist | Work inquiry and repair files | Which file needs me? |
| journeys | Owner / authorized workflow editor | Review and edit journey steps | Which step needs changing? |
| lenders | Funding staff | Maintain and review lender eligibility | Which lender record fits or needs review? |
| marketing-command-center | Owner / marketing | Work the current marketing task | What should I work on now? |
| messaging | Authorized staff | Read and answer client conversations | Who needs a reply? |
| morning-brief | Authorized brief-link holder | Read the daily operational brief | What needs action today? |
| my-numbers | Sales staff | Review personal sales and follow-ups | How am I doing and what do I owe? |
| ops-admin | Owner / operations | Inspect company money and people | Is the operation healthy? |
| pipeline | Role-scoped staff | Advance active client work | Which card is waiting on us? |
| present | Closer | Present the client-facing call deck | What should the client see now? |
| products-commissions | Owner / admin | Maintain products and dated commission rules | Which product or rate needs review? |
| sales-floor | Sales manager | Direct the sales floor | Is the floor on pace? |
| social-studio | Owner / marketing | Manage drafts and connected social accounts | What needs writing or sending? |
| staff-teams | Owner | Manage team members and access | Who is on the team? |
| teleprompter-remote | Recording operator | Control the current script remotely | Which script is playing? |
| teleprompter | Recording operator | Film and save the current take | Am I ready to record this script? |
| closer-call | Closer | Redirect to the current call workspace | Where is my call workspace? |

## Design and scope

Keep official Fundhub branding, Nunito, tenant colors and the shared sidebar. Shared `.fh-astra` foundation loads after legacy styles; staff cohort follows. Staff layouts use grouped summary strips, quieter tabs, 16px body and inputs, captions at least 13px, and controls at least 44px. Phone layouts keep all controls and avoid compressed multi-column forms.

The approved Team & Access draft is ported with its original scripts preserved except the reviewed roster-result presentation hook. Loading, empty and failed-read panels are presentation-only. The comparison files remain fixed.

Every other page keeps all original inline and external scripts, IDs, data attributes and handler wiring. Scope is HTML classes/section headings and scoped CSS only. No new endpoint, pricing, consent, permission, send or money behavior.

Teleprompter and its remote are retained specialist recording surfaces under `TELEPROMPTER-VIDEO.md`. The closer-call redirect keeps its URL/query/hash behavior. Their exact treatment and source receipts are recorded below once checked.

## Build and proof receipts

- **Built:** 31 staff pages opt into the shared Astra foundation plus the staff cohort. Team & Access uses the approved composition; other staff pages receive scoped hierarchy, summary, form, queue, editor and phone-layout changes.
- **Retained, not counted as redesigned:** `teleprompter.html`, `teleprompter-remote.html` and `closer-call.html`. Recording behavior and the redirect's query/hash handling are unchanged.
- **Source contract:** root's independent check reports all 62 rollout pages retain original scripts and IDs, with only the approved Team roster-result presentation hook exception. No other staff business-logic edits were made.
- **Automated staff behavior:** 72/72 passed in Chromium on isolated fixture port `43242` (2026-10-20). Existing suites: `staff-teams`, `agent-editor`, `products-commissions-ledger`, `content-admin-clicks`, `contracts-wording-clicks`, `csm-queue-clicks`, `messaging-inbox`, `finance-os-staff-clicks`, `galaxy-clicks`, and `company-brain-clicks`. Output: `/private/tmp/astra-staff-browser-results-43242`.
- **Pipeline follow-up:** 35/35 passed after the phone-control repair, using `pipeline`, `pipeline-waiting-on`, `pipeline-new-archive`, and `pipeline-honest` on the same isolated fixture port. Output: `/private/tmp/astra-pipeline-browser-results-43242-recheck`. The first pass caught two hidden-link failures caused by an added display rule (33 passed, 2 failed); constraining that rule to `:not([hidden])` repaired the regression. Both failed and clean-run receipts are retained.
- **Discarded infrastructure run:** the first attempt used the client lane's `43241` port. Its server stopped mid-run: 2 passed, 33 connection-refused failures, 1 interrupted, 36 not run. That run was stopped and replaced by the clean 72-test run above; it is not product-failure evidence.
- **Independent phone findings repaired:** Team search/select/action controls now meet the 44px/16px input floor; primary buttons are 48px. Team selects use explicit 44px height to address native desktop WebKit sizing. Pipeline's legacy compact type map is overridden only inside the Astra cohort: 16px inputs and record text, captions at least 13px, and 44px rail, view-switch, Move, Archive, Details and touch-drag targets. Root owns the confirming captures.
- **Limits:** these existing controlled browser tests cover behavior on the listed screens, not every staff page, every state, or real customer traffic. Root separately owns responsive Chromium/WebKit review, lint, TypeScript, marked evidence, and release checks. No real-iPhone, native Mac-app, performance, deployment or live-customer pass is claimed here.
