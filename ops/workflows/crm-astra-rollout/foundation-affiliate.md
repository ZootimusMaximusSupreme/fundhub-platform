# Astra foundation, affiliate and partner lane

Shared board: `ops/workflows/crm-astra-rollout-2026-10-20.md`.

## Approved scope and page jobs

| Page | Role | One job | First question |
| --- | --- | --- | --- |
| `affiliate.html` | Affiliate, plus existing role-scoped client/staff views | Share an attributed referral and track its earnings. | What have my referrals earned, and what can I share next? |
| `partner-galaxy.html` | White-label partner for their own book; existing staff selector retained | See the state of the partner's book and handle the next task. | What needs my attention in my business today? |
| `partner-training.html` | White-label partner | Track progress toward the next training gate. | What is my next module or gate? |

Reuse: approved Astra Team & Access comparison, existing Fundhub font/brand/sidebar/shell, all existing fields/endpoints/actions. Data, access rules, financial calculations and action scripts remain unchanged. The partner canvas has a root-approved presentation-only script exception, itemized below. Exact owned files are these three HTML pages, new `public/app/fundhub-astra.css`, and this report. No dependencies, routes, credential changes, customer writes, sends, Git or deployment actions.

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

Built:

- Shared opt-in foundation: readable type, grouped totals, quiet tabs, white work panels, larger existing shell targets and captions, and an explicit `[hidden]` guard so visual display rules cannot reveal gated controls.
- Affiliate: earnings first, referral sharing second, then complete referral/payout records. Existing field IDs, downloads, copy actions, tabs, filtering, joins, gates and financial values retained. Phone records show every original field with labels.
- Partner home: real partner-scoped figures first, service map second, gift download after that. Restored normal page scrolling. Honest existing “not connected” state retained. Map labels are 13px minimum, service/node names 16px, and narrow available widths use five separated rows in a 900px-tall map instead of shrinking labels. The detail panel fits the viewport and scrolls internally.
- Partner training: current position, next module/gate, gates, then full module record. Added an honest visual loading state without changing the request or its entitlement decisions. Phone modules retain all values as labelled records.

Local source tests: **65 passed, 0 failed, 0 skipped**:

```text
node --test --test-reporter=spec \
  src/http/affiliate-screen.test.mjs \
  src/http/partner-galaxy-banner.test.mjs \
  src/http/partner-galaxy-tiles.test.mjs \
  src/http/partner-training-read.test.mjs \
  src/http/affiliates-self-read.test.mjs \
  src/ui/shell-is-fluid.test.mjs
```

Existing browser tests: **30 passed**:

```text
E2E_PORT=43237 npx playwright test \
  e2e/affiliate-commission.spec.mjs \
  e2e/page_affiliate.spec.mjs \
  e2e/partner-training.spec.mjs \
  --output=/private/tmp/fundhub-astra-affiliate-playwright --reporter=line
```

These verify ledger-sourced commission/unknown states, filtering, retry, unenrolled state, gated downloads, referral links, role frames, partner entitlement, and no self-certification controls.

Controlled responsive probe: `/private/tmp/fundhub-astra-c-proof.mjs`; results and marked images in `/private/tmp/fundhub-astra-c-proof/`. The completed 39-case layout pass found no horizontal page overflow, browser errors, visible targets below 44px, or inputs below 16px. Body/main text measured 16px; sampled real captions 13px. Profiles: Chromium 1440×1000, 390×844, 440×763, 700×900, 900×1000, 838×390; WebKit's iPhone 17 Pro Max profile 440×763. Loading/empty/error covered all three pages at desktop and phone. All requests were intercepted local fictional fixtures; external HTTPS was aborted.

The expanded map probe checks drawn font values and existing cluster → node → detail panel → close behavior. It recorded one WebKit `ResizeObserver loop completed with undelivered notifications` during a tall-element screenshot run. The original failed receipt is retained at `results-resize-observer-failure.json`; a focused 1024px Chromium + iPhone WebKit rerun was clean. The full final pass adds 1024px and phase-tagged browser errors; final outcome is recorded below.

Final expanded responsive result: **42 cases, no page overflow, no page errors, no visible DOM targets below 44px, no inputs below 16px**. All eight full-state map profiles measured drawn text at **13px minimum** and opened/closed the existing detail panel. At viewport 1024×900, the canvas measured **750×900**, confirming that the container condition matches the stacked layout. The phone canvas measured 356×900 at viewport 390 and 406×900 on iPhone 17 Pro Max emulation. The detail panel now uses viewport-limited height with its existing internal scroll. No zoom, hit-test or action handler was changed. The earlier one-off observer notification remains recorded; its cause was not proven, so the clean final run does not erase that observation.

Additional no-screenshot detail check: **4/4 passed**, including reachable panel footer after internal scrolling. Measured panel/viewport heights: 868/900px at 1024px, 812/844px at 390px, 358/390px landscape, and 731/763px in iPhone 17 Pro Max WebKit. No page errors. Receipt: `results-map-detail.json`.

The existing affiliate browser suite also regenerates its established screenshots under `ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/`; root owns whether to include those generated outputs in the release.

Serena manual loaded; HTML symbol extraction returned unsupported with only the TypeScript language server active. Standard file tools are used for the HTML/CSS presentation work.

## Narrow canvas script exception for root review

Only the first nonempty canvas IIFE in `partner-galaxy.html` changes; all request, session, census, home-tile, download and business scripts remain unchanged.

- `layout()`: adds `stacked = W<=900`; the existing five clusters use `W/2`, vertically separated positions from 140px through `GH-100px`, and a 64px maximum visual cluster radius in that mode. The CSS uses the matching `.partner-map` **container** width, not viewport width, to provide 900px height. Desktop radial layout remains unchanged.
- `drawRails()`: 8.5/9.5px text becomes 13px.
- `drawClusterLabels()`: names become 16px, notes 13px, note baseline offset becomes 22px, and label alpha increases for readable contrast.
- `drawThreads()`: both text lines become 13px; second baseline moves from +3px to +11px.
- `drawNodes()`: minimum initials 13px, names 16px, other labels 13px; subordinate baselines change from +20/+32/+45px to +29/+49/+69px.
- `drawBreadcrumb()`: all text 13px; wraps a crumb when it would exceed available width; instruction baseline offset becomes 22px.
- `drawFootnote()`: 13px, stronger alpha, measured word wrapping within `W-32`, 18px line spacing.

No changes to `NODES`, `CLUSTERS` data, camera target/zoom constants, animation timing, `hitTest`, `hitCluster`, click/mouse/keyboard handlers, navigation functions, API calls or financial data. Existing cluster diameter is at least 54px at the minimum scale; the settled focused node remains selectable using the unchanged hit-test math. This is not a general canvas interaction or accessibility rewrite.

## Limits / leftovers

Existing intended affiliate and white-label journey documents describe route access; they are explicitly marked as after-the-fact route inventories. This visual lane does not rewrite or expand them.

WebKit emulation is checked, not a physical iPhone. Native Mac/iOS apps, production, tenant-specific live data and sends are not tested here. Intermediate widths exercise adaptable layouts; they do not certify any unannounced folding Apple device. Root owns independent audit, lint/TypeScript, GitHub, go-live approval and release proof.

## Shared-header phone repair — 2026-10-20

Explicit repair scope: only `public/app/fundhub-astra.css` and this receipt. Read B's independent `staff-independent/results.json` and marked Team account/technical evidence. It measured 483px page width in a 440px WebKit viewport and 11px LIVE text. Builder/Fixer scope rules keep this a shared presentation repair, not an account, role or route change.

Changed selectors, all behind `body.fh-astra`:

- `#fh-workspace-header`: releases fixed height before wrapping, preventing a larger title/scope row from escaping its header.
- `#fh-workspace-header .fh-workspace-tools`: permits wrapping within the available width, retaining every tool.
- `.fh-account-menu` / `.fh-context-panel`: viewport-limited vertical scrolling. At 860px and below, the account menu is fixed between 16px side gutters, starting at 104px, with height limited to `100dvh - 120px`.
- `.fh-account-person>div` / `.fh-account-technical`: names and long diagnostic text can shrink/wrap without extending the page.
- `.fh-account-person strong` / `.fh-account-technical p` / `.fh-context-panel :is(p,strong)`: 16px body text.
- `#fh-shell-src` / `.fh-account-technical .clock`: 13px captions.
- `#fh-shell-avatar`: 16px symbol overrides the existing inline 11px setting; the 44px control is retained.
- `#fh-shell-chip>input[type="file"]`: the already invisible, programmatically activated photo picker stays 1px and contained instead of inheriting visible form-control minimums. It remains callable; it is not removed or disabled.

Local proof script: `/private/tmp/fundhub-astra-menu-proof.mjs`. Results and marked screenshots: `/private/tmp/fundhub-astra-menu-proof/`. Root may copy these generated outputs into its tracked evidence; no proof or application files belonging to other lanes were edited.

**30/30 expanded-layout cases passed**: Team & access, Calendar and Pipeline; Chromium and WebKit; 440×763, 390×844, 838×390 landscape, 768×1024 and 1024×768. Four states per case: initial, account, expanded Technical details and scope/context. All stayed within page width; visible controls were at least 44px, text at least 13px; no page errors. The menu footer was reachable through internal scrolling. Photo picker activation, search opening and Escape closing passed without uploads or production calls.

A CSS-intercepted before case reproduced the independent failure exactly: **483px page width at 440px**, LIVE11px and photo symbol11px. The fixed case measured440px, LIVE13px and photo symbol16px. The first probe used the preview server's saved Team baseline by mistake; that run is preserved as `results-first-pass-wrong-team-variant.json`. The corrected probe explicitly requests `?variant=rollout` and asserts `body.fh-astra`.

An isolated before-case experiment applied only the hidden photo input containment rule: page width changed from **483px to 440px** while the old menu/text styles remained. This proves the hidden picker's intrinsic overflow caused the extra width. Receipt: `results-isolation.json`. A separate four-case 440/landscape context-menu screenshot pass also passed and is saved in `results-context.json`.

Existing regression receipts:

- `node --test src/http/mobile-shell.test.mjs src/ui/shell-is-fluid.test.mjs`: **72 passed, 0 failed, 0 skipped**.
- `E2E_PORT=43238 npx playwright test e2e/workspace-brand-polish.spec.mjs --output=/private/tmp/fundhub-astra-menu-existing --reporter=line`: **5 passed** (role navigation, keyboard menu return, tenant branding, compact rail and existing recovery behavior).

No JS, HTML, role rules, routes, staff/client cohort styles, dependencies, Git, deployment, live data or customer writes were changed. Original independent failure and earlier map ResizeObserver warning remain preserved. This is controlled local repair proof, not live or physical-device proof; B/root independently recheck the result.
