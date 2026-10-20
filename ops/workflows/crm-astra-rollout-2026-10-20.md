# Astra extra-high CRM / customer / affiliate rollout

Owner chose the Astra extra-high comparison on 2026-10-20: “For the whole crm and customer portal as well affiliate ... as well.” Build the approved direction across the existing surfaces. Do not ask for the split again. Keep all working capabilities, route/role rules and customer data intact. The earlier Team & Access comparison stays available at `http://127.0.0.1:43229/comparison`.

## Split, owner and dependencies

All design/build lanes run GPT-6 Astra with xhigh reasoning. Root owns integration, independent checks, screenshots, GitHub and release truth, not redesign authorship. Shared foundation starts alongside page discovery. Staff/client final styling waits for the shared CSS contract. Final checks wait for the built pages. No overlapping file ownership.

| Lane | Model | Files / ownership | State |
| --- | --- | --- | --- |
| A — staff CRM | Astra xhigh | 33 non-client pages in `crm-portal-layout-manifest.json`, excluding the two partner pages owned by C; plus `closer-call.html`. `fundhub-astra-staff.css` and lane report. | starting |
| B — customer portal | Astra xhigh | 25 client-facing pages in the manifest, excluding `affiliate.html`; `fundhub-astra-client.css` and lane report. | starting |
| C — shared + affiliate/partner | Astra xhigh | `public/app/fundhub-astra.css`, `affiliate.html`, `partner-galaxy.html`, `partner-training.html`, and lane report. Shared original shell/sidebar/font files are read-only. | starting |
| Root — proof/integration | current session | This board, rollout inventory/check scripts/evidence, relevant tests, Git commits/PR integration. No independent design substitution. | active |

Checkout `/private/tmp/fundhub-astra-comparison.t8PMKZ`; branch `codex/crm-astra-rollout`, starting at the saved comparison `074db93fb` plus current main. The primary `codex/two-ios-apps-launch` checkout remains dirty and untouched. The prior polish release checkout `/private/tmp/fundhub-crm-evidence.ENBglA` is preserved. Main independently merged the Netlify modern-worker repair; do not duplicate/revert it.

## Approved seven-part plan

1. Roles: existing role-scoped views, not one owner view for everyone. Staff follows the current role; customer sees only their file/money; affiliate sees only their referrals/earnings. Separate page owners above.
2. One job: each existing screen keeps its current single job, stated in its lane report before changes.
3. First question: preserve role-specific daily priorities from UI standards and existing intended journeys; do not replace actionable queues with company metrics.
4. Reuse: approved Astra Team & Access draft, existing shared shell/sidebar/wordmark/F/Nunito/pastel tokens, current controls, navigation, data layer and endpoints. Add one opt-in shared stylesheet and scoped cohort styles, not a new UI framework.
5. Data: existing endpoints, fields, roles and flows only. No new routes, dependencies, auth/entitlement changes, real customer writes, sends or money movement. Use fictional controlled fixtures for evidence.
6. Files: exact manifest-owned HTML lists per lane above; A also owns `public/app/closer-call.html`. Three new scoped stylesheets above. `public/app/index.html` redirect and `sidebar.fragment.html` stay read-only unless integration discovers a necessary scoped include. No native Swift or recording implementation changes.
7. Risk/proof: keep IDs/data attributes and scripts intact; verify source contracts and relevant automated journeys after build. Capture marked 1440/390 views and loading/empty/error/full states with realistic fixture volume; click scoped controls. Run lint/TypeScript and relevant browser suites. Real iPhone/WebKit and Mac app checks are separate receipts, not inferred from viewport success. Never call unchecked pages or skipped tests passed.

## Shared design contract

C publishes the shared CSS contract first and messages A/B/root. Opt-in body class `fh-astra`; shared stylesheet `/app/fundhub-astra.css`. Cohort sheets `/app/fundhub-astra-staff.css` and `/app/fundhub-astra-client.css`. Preserve the established Fundhub sidebar rather than redesigning it three ways. Clean professional CRM, not the rejected iOS/glass theme. Short useful labels, quiet tabs, grouped summaries, data/queues first, readable phone records and intact actions. No hiding functional controls to make screenshots clean.

Published contract: `.fh-astra-page`, `.fh-astra-heading`, `.fh-astra-subtitle`, `.fh-astra-summary`, `.fh-astra-stat`, `.fh-astra-workspace`, `.fh-astra-tabs`, `.fh-astra-tab`, `.fh-astra-toolbar`, `.fh-astra-table-wrap`, `.fh-astra-table`, `.fh-astra-state`, `.fh-astra-action`, `.fh-astra-primary`, `.fh-astra-caption`. Shared sheet loads after legacy styles; cohort sheet follows it. Existing tenant tokens remain the source of colors/fonts.

### Owner phone requirement — 2026-10-20

Owner uses iPhone 17 Pro Max. Phone layouts must be useful and readable, not merely squeezed into the screen. Main body and inputs: 16px; captions: at least 13px. All interactive hit areas at least 44px, primary actions preferably 48px. Keep all actions available, allow clear form/editor scrolling, prevent clipping inside cards as well as whole-page overflow, and check actual visible text/controls. Check 390, the locally available Pro Max profile, and intermediate/wider sizes for fold-style use. No claim about unreleased foldable-iPhone specifications or certification. Staff, client and foundation Astra agents have received this requirement.

## Self-contained prompts

### A — staff CRM

Use GPT-6 Astra xhigh. Work only in `/private/tmp/fundhub-astra-comparison.t8PMKZ` on the shared rollout branch. Read this board, CLAUDE.md section 0, the Fundhub builder skill at `/Users/chrisstanbridge/Developer/fundhub-platform/.agents/skills/fundhub-builder/SKILL.md`, UI/PERF standards, actual brand CSS, owner-scope rule and relevant intended journeys. Own the 33 manifest pages with `client_facing:false` except `partner-galaxy.html` and `partner-training.html` (C owns those), plus `closer-call.html`; only those HTML files, `public/app/fundhub-astra-staff.css`, and `ops/workflows/crm-astra-rollout/staff.md`. Use the approved Team & Access draft as the design reference and C's opt-in shared CSS contract. Inventory/read each screen before changing it; state each role/job/first question in the report. Make consistent useful layout/hierarchy changes, preserve all controls and original scripts/IDs/data attributes, no new capabilities or endpoint/auth changes. Port the approved Team & Access draft into the existing live source only after preserving its path semantics and reviewing its narrow state hook. Read TELEPROMPTER-VIDEO.md before considering recording-page styles; camera/recording stages and native app are not yours to change. Treat those recording tools as retained specialist surfaces if a safe visual-only change cannot be proven. No deployments, Git actions, credentials, production/customer writes or dependency installs. Build first, then run relevant existing source/browser checks and save exact receipts. Root independently grades and integrates. Begin immediately; no approval wait. Message root when first representative pages are ready, then finish all assigned pages honestly.

### B — customer portal

Use GPT-6 Astra xhigh. Work only in `/private/tmp/fundhub-astra-comparison.t8PMKZ` on the shared rollout branch. Read this board, CLAUDE.md section 0, Fundhub builder skill at `/Users/chrisstanbridge/Developer/fundhub-platform/.agents/skills/fundhub-builder/SKILL.md`, UI/PERF standards, actual brand CSS, owner-scope rule and client intended journey. Own exactly the 25 manifest `client_facing:true` HTML pages except `affiliate.html`, plus `public/app/fundhub-astra-client.css` and `ops/workflows/crm-astra-rollout/client.md`. This includes client-portal, financeos, all money screens, payment-success, soft-pull-approve, and the existing login/portal-login/reset-password/contract/progress entry screens. Keep their functions, role/entitlement gates, prices/offers, next-step and contact actions; no financial/API/auth/marketing logic edits. Read every page and state its role/job/first question before changing it. Apply the approved Astra direction with C's shared contract, meaningful hierarchy and compact single-column phone layouts. Preserve scripts, IDs/data attributes and all useful actions; do not remove capabilities/offers or fabricate client data. No new endpoints, dependencies, real writes/sends, native-app edits, deployments or Git actions. Use scoped CSS rather than inline style growth. Build first, then run the relevant existing source/browser checks and report exact results. Root owns independent audit. Start now; no approval wait. Show root representative portal and money pages as soon as ready, then finish assigned inventory.

### C — shared foundation, affiliate and partner

Use GPT-6 Astra xhigh. Work only in `/private/tmp/fundhub-astra-comparison.t8PMKZ`. Read this board, CLAUDE.md section 0, Fundhub builder skill at `/Users/chrisstanbridge/Developer/fundhub-platform/.agents/skills/fundhub-builder/SKILL.md`, UI/PERF/brand/owner-scope rules and affiliate/white-label intended journeys. Own only new `public/app/fundhub-astra.css`, existing `affiliate.html`, `partner-galaxy.html`, `partner-training.html`, and `ops/workflows/crm-astra-rollout/foundation-affiliate.md`. First derive a reusable opt-in `.fh-astra` CSS contract from the approved Team & Access draft; send A/B/root the class names and include pattern promptly. Do not rewrite original fundhub-brand.css, shared sidebar, font or shell logic; preserve tenant custom branding. Build the same Astra quality into affiliate/referral and partner home/training with their real role priorities, intact controls, payouts/referral data and current endpoints. No business logic, auth, commission or money changes. No new dependencies, real customer writes/sends, Git or deployment. Read each owned page, preserve scripts and IDs, then run relevant checks and report exact receipts. Root independently grades. No approval wait; begin now.

## Device answer / evidence

The existing native iPhone `WorkspaceWebView.swift` and Mac `FundhubMac.swift` both display the CRM website in WebKit, so responsive web changes carry into those wrappers. The comparison is verified at 390 and 1440 in Chromium, not on a real iPhone or in the Mac app. Repo Mac README describes a local ad-hoc-signed bundle, not a notarized public release. Existing iOS release board says real-phone journey proof remains open. These facts do not establish whole-CRM device readiness.

## Results and leftovers

No rollout pages are claimed complete or live yet. Preserve the previous red CI receipts and the comparison's repaired phone-width evidence. Root will add exact inventory counts, checks and preview links as each lane lands.
