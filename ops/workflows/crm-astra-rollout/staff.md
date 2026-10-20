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

## Named phone repair batch — 2026-10-20

Root explicitly assigned these repairs from B's independent review, temporarily pausing A's read-only client review. Changes remain confined to staff HTML include placement and the staff cohort sheet.

- **Cascade corrected:** B found the Astra links before later legacy styles on30 of31 opted-in pages. Moved those30 shared/staff link pairs to the end of the head; Team & Access was already correctly ordered. A read-only include-order check confirms all31 now load shared Astra then staff cohort after all legacy styles. No original script or ID was edited.
- **Native fields / targets:** explicit44px single-select height fixes WebKit's23px native select boxes; input/select/textarea text stays16px. Controls have44px minimum targets; primary and Marketing confirmation buttons retain48px. Color swatches, content switches and ledger checkboxes expose full touch targets; existing actions and handlers remain unchanged.
- **Readable content:** repaired the measured small-label families in Calendar, Closer, Contracts, CSM, Documents, Finance OS, Lenders, Messaging, My Numbers and Sales Floor. Present's spoken script is16px. Small back/client/template/affiliate links now have44px targets. Decorative dots are not promoted into text.
- **Layout repairs:** removed the broad adjacent-card margin that shifted grid siblings24px; tightened duplicate Marketing card-header padding; reduced Pipeline toolbar/header spacing and Closer identity/funding spacing without removing content, shrinking text or hiding controls.
- **Exact existing tests:** first four-suite run (`closer-dashboard-layout`, `pipeline-workspace`, `marketing-cc-settings`, `marketing-command-center`) on isolated port43242: **66 passed,7 failed**. Output `/private/tmp/astra-staff-repair-layout-results`. The residuals were Pipeline fold positions, Marketing copy-button bottom904px and a44px confirmation button where48px was required.
- **Final four-suite run:** **72 passed,1 failed** in Chromium, output `/private/tmp/astra-staff-repair-layout-results-final`. All Closer call ordering/fold, Pipeline full/zero-waiting fold, touch moves, Marketing card alignment and48px confirmation constraints pass. The remaining failure is the old `#copyAngle` exact15px expectation at `marketing-command-center.spec.mjs:358`; actual16px follows the owner's requirement. Root owns that expectation update; A did not weaken/edit a test.
- **Closer measured credit-facts y:**1440px=650.06;390px=655.73;320px=673.98, all below the unchanged700px threshold. Real credit/deal fixture values and call-tools→funding→credit ordering assertions pass.
- **Pipeline measured first-card y:**full fixture at1440/390/320=425/428.5/427.25; zero-waiting=401/384.5/383.25. Phone zero-waiting headline is44px high, below the unchanged60px limit. All pages report zero horizontal document overflow.
- **Self-diagnostic, not independent audit:**31 Pro Max WebKit pages plus reachable disclosures/forms and lower sections were measured with fictional blocked-write fixtures. `evidence/staff-repair/expanded/after-floors/results.json` has92 captures, no page overflow or page exceptions, and only the Finance OS caption residual subsequently fixed plus two scrollable tab-edge geometric flags. B owns the independent final confirmation and original red screenshots; A resumed client review after the repairs.

## Final named residual repairs and receipts

- **Repeated staff behavior check:** the same 72 existing behavior tests passed **72/72** again after the cascade/type/control repairs. Output: `/private/tmp/astra-staff-repair-behavior-final`.
- **Marketing expectation:** root updated the old 15px input assertion to the approved 16px floor and reported the focused 1280px test **1/1 passed**. A did not edit any test.
- **Independent residuals:** B's 154-capture staff recheck found Present's 9px step labels and 11px coaching text, a clipped seventh step, Finance OS's 32px jump links, a 12px Lenders kicker, and a 12px Messaging context empty-state. Scoped fixes now use 13px step labels, 16px coaching/empty-state text, a wrapping four-column step grid, 44px jump links and a 13px kicker. B independently rechecked these four pages in **23 captures**, all clear. Decorative Calendar initials next to the full name are not graded as required reading.
- **Documents phone hierarchy:** retained the single-column metric summary and moved status/sort controls into their own full-width rows. Removed wasted noninteractive spacing instead of shrinking fields or removing choices. Final fictional fixture `#body` top is **644.625px at 390**, **639.672px at 320**, and **643.578px in Pro Max WebKit**; the unchanged limit is 650px. Native fields remain 44px high with 16px text. Evidence: `evidence/staff-repair/documents-final/geometry.json`. B independently confirmed the first-record geometry and the complete selected “Age: oldest first” text at both 390px and 320px.
- **My Numbers phone hierarchy:** removed the duplicate 24px top inset on `.numbers-shell` below the toolbar. B measured the first task at **y642px on 320px**, below the unchanged 650px threshold.
- **Messaging short portrait:** at widths up to 350px, the destination label and field share a row, the message field and Send share a row, and noninteractive header/composer spacing is reduced. Inputs remain 16px and every control keeps its target size. The full existing short-phone touch test still checks actual Send visibility and a thread reading area above 90px.
- **Three full suites:** Documents, professional Messaging layout and My Numbers passed **39/39** after the final full-width Documents filters and initial portrait fixes. Output: `/private/tmp/astra-final-three-layouts`. This includes the exact reminder payload, PDF bytes, document loading/empty/error states, message draft/permission/destination behavior, and personal-task route/fixture assertions.
- **Additional landscape finding retained:** B then confirmed that Messaging at 838×390 clipped its composer inside a 276px non-scrollable column with 507px of content. A scoped `max-width:860px` and `max-height:600px` rule now lets the opened workspace scroll vertically, removes column clipping, and keeps a 160px bounded message reader. The portrait header now adds 14px more reading room. No action or supporting text is removed. The post-landscape full-suite and independent reachability results are recorded below; the earlier 39/39 result alone is not landscape proof.
- **Post-landscape regression run:** all three complete suites passed **39/39** again after the short-height rule and portrait header adjustment. Output: `/private/tmp/astra-final-three-layouts-landscape`. Independent landscape scroll/hit verification is recorded by B below. Scoped `git diff --check` passes.
- **Independent Messaging confirmation:** B reports **68 captures across 8 profiles** clear of measured size, horizontal-overflow and page-error issues. The landscape reader is **160px** high; ordinary workspace scrolling to `scrollTop=360` brings the composer to **y229** and Send to **y278**, both visible and center-hit reachable. The 320×740 reader is **103.7px** high with invalid-destination guidance and **149.7px** with a valid destination. Details open/close and Back are reachable. A further **18 captures** confirm enabled Send after a valid fictional destination and draft: its target is **45.5px high**, center-hit reachable, with a **16px, 94px-high composer**. Send was not clicked in this independent read-only check. No measured finding remains open in B's final report; no live send or real-device pass is claimed.
