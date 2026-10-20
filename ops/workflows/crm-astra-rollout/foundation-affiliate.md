# Astra foundation, affiliate and partner lane

Shared board: `ops/workflows/crm-astra-rollout-2026-10-20.md`.

## Approved scope and page jobs

| Page | Role | One job | First question |
| --- | --- | --- | --- |
| `affiliate.html` | Affiliate, plus existing role-scoped client/staff views | Share an attributed referral and track its earnings. | What have my referrals earned, and what can I share next? |
| `partner-galaxy.html` | White-label partner for their own book; existing staff selector retained | See the state of the partner's book and handle the next task. | What needs my attention in my business today? |
| `partner-training.html` | White-label partner | Track progress toward the next training gate. | What is my next module or gate? |

Reuse: approved Astra Team & Access comparison, existing Fundhub font/brand/sidebar/shell, all existing fields/endpoints/actions. Data, access rules, financial calculations and scripts remain unchanged. Exact owned files are these three HTML pages, new `public/app/fundhub-astra.css`, and this report. No dependencies, routes, credential changes, customer writes, sends, Git or deployment actions.

Risk: broad presentation overrides can shrink controls, break phone layout or hide existing state/actions. Source contracts, controlled browser fixtures, computed target sizes and overflow checks verify the visual change; root independently audits and owns release.

## Shared contract — available

Load `/app/fundhub-astra.css` after legacy page styles and before cohort sheets. Add `fh-astra` to the body. Foundation is entirely scoped to that opt-in.

Semantic classes:

- `fh-astra-page`: fluid padded content.
- `fh-astra-heading`, `fh-astra-subtitle`: page identity and context.
- `fh-astra-summary`, `fh-astra-stat`: grouped totals with subtle brand tints.
- `fh-astra-workspace`: white work panel with the existing border/shadow token.
- `fh-astra-tabs`, `fh-astra-tab`: quiet tabs and visible current state.
- `fh-astra-toolbar`: wrapping controls above a queue.
- `fh-astra-table-wrap`, `fh-astra-table`: contained table scroll and typography.
- `fh-astra-state`: meaningful empty/error region.
- `fh-astra-action`, `fh-astra-primary`: secondary and primary action.
- `fh-astra-caption`: readable caption.

Uses existing brand variables rather than a fixed tenant palette. Body and inputs 16px, captions 13px, interactive targets 44px minimum and primary buttons 48px. Single-column summaries at 700px and below. Cohort/page styles own conversion of wide data tables to labelled phone records. Existing sidebar/font/brand/shell files are read-only.

## Evidence

Foundation created. Page work in progress. No browser or release success is claimed yet.

Serena manual loaded; HTML symbol extraction returned unsupported with only the TypeScript language server active. Standard file tools are used for the HTML/CSS presentation work.

## Limits / leftovers

Existing intended affiliate and white-label journey documents describe route access; they are explicitly marked as after-the-fact route inventories. This visual lane does not rewrite or expand them.

Real iPhone/WebKit, Mac app, and production proof belong to the root receipt. Intermediate widths exercise adaptable layouts; they do not certify any unannounced folding Apple device.
