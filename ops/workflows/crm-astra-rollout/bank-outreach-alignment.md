# Bank outreach alignment — read-only review

## Decision and release order

The owner approved Astra for the **whole CRM, customer and affiliate experience**. This is not an unapproved comparison. Keep Bank's working manager/rep hierarchy and behavior; integrate it with the approved Astra system, then repair the measured Bank-specific sizes below.

Source reviewed: Bank PR [77](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/77), checkout `/private/tmp/fundhub-bank-outreach.0jXudA`, HEAD independently read as `fe0dbfb32d74b3bc6ee5a8cbe8186fa733fb167e`. Read-only comparison confirms all three Bank assets plus `shell.js`, `fundhub-brand.css` and `crm-sidebar.css` are unchanged from visual source `f97bc66ac96aaa71534aefaf48109933fa95d3e5`. These current local files were rendered. Other worktree changes belong to the Bank lane and were not edited.

Approved foundation is present in `4560cceb22ba4d1224484b8fee5b377e4f9df9ac`; **that is not the final release SHA**. Two narrow release repairs remain with the Astra parent. Safe order: finish Astra PR81/foundation and parent release proof → Bank parent integrates that exact canonical main SHA → change only Bank opt-in/page styling → rerun Bank role, state, phone, desktop and required CI proof → publish Bank PR77. Do not copy a moving stylesheet or revert the Astra additions in shared page conflicts.

## Required integration, separate from visual defects

Current Bank body is `bank-outreach-page`, without `fh-astra`, and loads neither `/app/fundhub-astra.css` nor `/app/fundhub-astra-staff.css`. That is an integration dependency, not proof of broken business logic.

After canonical integration, use `class="bank-outreach-page fh-astra fh-astra-staff fh-astra--bank-outreach"` on body and load `/app/fundhub-astra.css`, then `/app/fundhub-astra-staff.css`, **after** legacy and Bank styles. The first two Astra body classes are the active shared contract; the last follows the page-specific modifier convention. Use the canonical include order, not draft comparison CSS. Preserve routes, shell/navigation behavior, IDs, role gates, drawer actions, fixtures and all backend logic. Bank-local selectors may need targeted sizing after this cascade; do not assume opt-in alone fixes native WebKit controls.

## Measured fixes for the Bank author

| Priority | Actual result | Exact marked evidence | Required outcome |
| --- | --- | --- | --- |
| 1 — phone dropdowns | WebKit iPhone 17 Pro Max 440×763: queue selects render **21px high**; drawer selects **23px high**, despite declared `min-height:44px`. | [Rep queue](evidence/bank-alignment/shots/rep-promax440-queue-MARKED.png), [touch drawer](evidence/bank-alignment/shots/rep-promax440-touch-drawer-MARKED.png) | Measure the rendered native controls after Astra integration; make every select at least 44px high without losing choices. |
| 1 — editable text | Queue search/select text is **13px**; drawer editable inputs/textarea **13px**, drawer selects **15px**. Page body is **15px**. | [Rep queue](evidence/bank-alignment/shots/rep-promax440-queue-MARKED.png), [product editor](evidence/bank-alignment/shots/rep-promax440-product-form-MARKED.png) | Body and editable controls 16px; captions at least 13px. Keep readable wrapping and single-column phone forms. |
| 1 — expanded shared account | Manager's expanded account/Technical details makes document width **478px at 440px**, and **876px at 838px** landscape. Shared labels are 11–12px; visible shell controls are 20–40px high in several cases. | [Manager expanded account](evidence/bank-alignment/shots/manager-promax440-account-open-MARKED.png), [landscape](evidence/bank-alignment/shots/manager-landscape838-account-open-MARKED.png) | Integrate the approved scoped foundation repair, then recheck expanded menu at 390/440/838/768/1024; no horizontal page overflow, captions ≥13px, targets ≥44px, bottom controls reachable. Do not duplicate the shared repair in Bank CSS. |
| 2 — preferred primary size | Bank primary buttons render **44px**, meeting the hard minimum but below the owner's preferred 48px primary size. | [Manager overview](evidence/bank-alignment/shots/manager-desktop1440-overview-MARKED.png), [reachable phone save](evidence/bank-alignment/shots/rep-promax440-product-footer-MARKED.png) | Prefer 48px primary actions while retaining page density and drawer scrolling. This is not a failed 44px minimum. |

Rules: `docs/rules/UI-STANDARDS.md` §§1, 3–6, 8–11; owner phone addendum on `ops/workflows/crm-astra-rollout-2026-10-20.md` requires 16px body/inputs, ≥13px captions, ≥44px interactive targets, preferably 48px primary actions. The native dropdown finding is an actual WebKit box measurement, not a CSS-source inference.

Narrow source targets: `public/app/bank-outreach.css:36–37` makes controls inherit their 13px label font; line 67 raises drawer selects only to the current 15px body token. Line 17 sets the 44px primary baseline. Keep captions at 13px while explicitly sizing editable controls to 16px. Test native select boxes with real WebKit after styling.

## Manager screen

- Keep verified products and the next bank action at the top-left; retain team comparison and real bank records.
- Primary “Review next bank” is above the fold at 1440×900 and 440×763. No need to redesign the information hierarchy.
- Keep manager assignment/import controls and queue switching. The assigned-rep fixture does not receive manager assignment controls.
- Main queue, drawer and account need the measured fixes above, not business-logic changes.
- [Desktop overview](evidence/bank-alignment/shots/manager-desktop1440-overview-MARKED.png); [phone overview](evidence/bank-alignment/shots/manager-promax440-overview-MARKED.png); [phone account](evidence/bank-alignment/shots/manager-promax440-account-open-MARKED.png).
- Design note, not a failed role control: [desktop Assigned to context](evidence/bank-alignment/shots/manager-desktop1440-queue-record-MARKED.png) remains visible in the [440px phone card](evidence/bank-alignment/shots/manager-promax440-queue-record-MARKED.png), but is hidden in the [768px table](evidence/bank-alignment/shots/manager-intermediate768-queue-record-MARKED.png), 838px landscape and 1024px table. `bank-outreach.css:69` hides `.manager-column` through 1100px; the more specific phone `td` rule at line 70 restores it below 600px. The relationship drawer assignment remains available and worked. This is a scan-context tradeoff, not a security/behavior failure or required new feature.

## Assigned-rep screen

- Keep “next bank” as the primary job, with relationship/next action together and the actual bank queue below.
- Desktop table becomes stacked phone records. Keep drawer tabs, products and “Edit facts”; the optional manager intermediate-width note above does not affect the rep's role controls.
- Save remains reachable by vertical drawer scrolling, including 838×390 landscape. A long form is not itself a clipped-control defect.
- Primary next-bank action is above the fold on 390 and 440 portrait. Short landscape needs normal vertical scrolling.
- [Phone overview](evidence/bank-alignment/shots/rep-phone390-overview-MARKED.png); [queue](evidence/bank-alignment/shots/rep-promax440-queue-MARKED.png); [landscape save](evidence/bank-alignment/shots/rep-landscape838-product-footer-MARKED.png).

## Visual alignment that should stay

The current screen already uses Fundhub's shared rounded font, tenant brand, semantic colors, left-aligned content, 12-column desktop arrangement, 8/16/24/32px spacing, 10px white panels and the shared shadow token. Main content uses four type sizes (13/15/22/32); the fix is the approved 16px body scale, not a new font/theme. Manager comparison and rep next-work content are useful; no iOS/glass treatment or generic KPI redesign is justified. Tablet/fold-width captures retain usable table/form space; phone cards and one-column forms avoid squeezed multi-column panels.

## Evidence boundary

Local fixture audit: Chromium 1440×900, 390×844, 768×1024 and 1024×768; WebKit iPhone 17 Pro Max 440×763 and landscape 838×390. This is browser emulation, not real-phone or future-fold certification. Manager is the existing owner fixture, rep is the assigned outbound-rep fixture; admin/sales-manager sessions were not walked.

The audit covers filled manager/rep views across six profiles, drawer touch/product/relationship controls, expanded account/Technical details, and loading/empty/error states at 1440 and 390. Local fixture clicks logged a touch, saved manager assignment, checked absence of rep assignment, opened product facts, used Escape, and triggered empty/error recovery. No live sends, database writes, authentication isolation or cross-org security claims.

Evidence runner: `evidence/bank-alignment/inspect.mjs`; measurements: `evidence/bank-alignment/results.json`; raw screenshots: `evidence/bank-alignment/shots/_raw/`; marked screenshots: `evidence/bank-alignment/shots/*-MARKED.png`. Initial probe output is preserved in `results-initial-visibility-probe.json`; its nearest-closed-disclosure check overcounted a hidden nested summary. The corrected probe checks every closed ancestor. Open-account, native-control and text findings remain unchanged. Sizing observations include rendered controls below the current viewport; screenshots and save-footer checks establish actual scroll reach. There are no main-page overflow findings in the filled overview, queue or drawer captures; the two measured page-width failures are the expanded owner account.

Final evidence set: **114 observations — 102 raw/marked screenshot pairs and 12 action records**. Every action record contains `log_touch`; all six manager records also contain `assign`; rep assignment controls were asserted absent. These are fixture interaction checks, not a claim that 114 automated acceptance tests passed. Read-only code review and this local visual audit were run; the broader Bank lint/TypeScript/DB/security/CI suite was not rerun in this lane.

Audit correction: an initial source-only reading of the 1100px manager-column rule wrongly suggested the phone card also lost the assignee. Actual screenshots and computed `firstQueueCells` show the phone override restores it. Queue annotations now use measured visibility; the note above is limited to the measured intermediate widths. No app defect was inferred from that superseded source-only reading.

Representative state evidence: [loading](evidence/bank-alignment/shots/manager-phone390-loading-MARKED.png), [rep empty](evidence/bank-alignment/shots/rep-phone390-empty-MARKED.png), [rep error](evidence/bank-alignment/shots/rep-phone390-error-MARKED.png). Loading uses placeholders, unavailable results use dashes, empty state explains the next step, and retry issues another fixture read. Fixture figures are not live business results.

## Shared-file integration overlap

Read-only GitHub file inventories: [PR77 files](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/77/files) (138) and [PR81 files](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/81/files) (325), all pagination read. Overlap is `AGENTS.md`, `CLAUDE.md`, `public/app/shell.js`, and these 32 `public/app/` HTML files:

`affiliate`, `agent-editor`, `automations`, `brand-studio`, `calendar`, `campaign-manager`, `client-control-panel`, `closer-dashboard`, `company-brain`, `consent-capture`, `content-admin`, `contracts`, `creative-factory`, `csm-queue`, `documents`, `finance-os`, `galaxy`, `hiring`, `inquiry-remover`, `journeys`, `lenders`, `marketing-command-center`, `messaging`, `my-numbers`, `ops-admin`, `partner-galaxy`, `partner-training`, `pipeline`, `products-commissions`, `sales-floor`, `social-studio`, `staff-teams` (each `.html`).

These are changed-file intersections, not a claim that all produce merge conflicts. Retain Bank's Relationships navigation additions and role routing while retaining Astra body opt-ins, final CSS ordering, page hierarchy and phone repairs. Bank also changes `public/app/sidebar.fragment.html`; do not lose consistency with `shell.js` and inline sidebar copies. The three shared Astra stylesheets are supplied by Astra, not duplicated in Bank.

Pending release coordination from the Astra parent: `.github/workflows/tests.yml` will install Chromium **and WebKit** for the existing browser job and run the same full collection with `--workers=2` inside its existing 25-minute budget; no retries or Postgres/morning-proof job changes. The fetched Bank PR inventory changes `.github/workflows/bank-outreach-proof.yml`, not `tests.yml`; if Bank's ongoing Mac-runner work also touches `tests.yml`, deliberately retain both intended changes instead of replacing the file. This is a pending integration note, not a claim that the final release SHA or CI result exists.

No Bank application, tests, configuration, Git, database or deployment changed by this review.
