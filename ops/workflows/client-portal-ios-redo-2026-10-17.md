# Client portal iOS redesign — cloud execution board

## Owner approval and scope

On 2026-10-17, Chris approved the revised design sample and said: "make the whole client portal redo, dont miss features as well! in cloud please" and "1 agent per page". He also required: when a client assigns a referral, the Affiliate Dashboard appears. These are approved build instructions; do not ask for the same go-ahead again.

- Repository: `https://github.com/ZootimusMaximusSupreme/fundhub-platform`
- Source branch: `codex/two-ios-apps-launch`
- Approved design commit: `8798ba9021cf3ff32a3dd5ad62f3f0eb7a184c3b`
- Approved sample: `ops/workflows/company-ux-refresh-2026-10-18/client-portal-home-preview.html`
- Sample images: `ops/workflows/company-ux-refresh-2026-10-18/client-portal-home-desktop.png` and `client-portal-home-mobile-fold.png`.
- Scope: the complete client-facing portal experience, its existing linked client pages and existing features, plus the requested referral-to-Affiliate-Dashboard behavior. Preserve staff and other roles on shared pages.
- Use real server values. The sample's stages, step count, and copy are design examples, not a new data contract.
- Build, verify, commit, push, and leave a reviewable PR with desktop/phone evidence. Present the full implemented portal for the final production-release choice.

## Work split and order

1. **Cloud lead / shared foundation:** inventory the actual client journey, every client-facing page, feature, control, entitlement, API, and state before rewriting. Compare with `origin/main` and preserve existing branch work. Own shared client-only design tokens, navigation, and integration. Do not restyle the staff CRM accidentally.
2. **Exactly one implementation agent per page:** the lead creates a concrete page manifest and a self-contained prompt per page, then assigns a distinct agent to each page. Run available agents in parallel waves. An agent owns one page and its page-specific assets/tests only; it requests shared-file changes from the lead. Do not use one builder to rewrite several pages.
3. **Independent review and regression proof:** after a page is implemented, check it against its before/after feature inventory, all four states, real role permissions, and the approved design. Fix the named failures and repeat the affected check. Integration waits for the shared foundation and page work.

This local chat owns the cloud handoff only. Cloud execution owns the implementation. Shared progress belongs in this file, with evidence under `ops/workflows/build-evidence/client-portal-ios-redo/`.

## Initial discovery seeds — verify, do not treat as a complete inventory

- `public/app/client-portal.html`: welcome video, booked-call confirmation, dispute authorization/signature, community link, FinanceOS entry, agreements, real status/progress, credit scores, owned products/deliverables/courses, uploads, payment/account history, documents, activity, messages, advisor/chat, booking, PWA/install/push, and staff/client differences.
- `public/app/shell.js` currently lists client access to `client-portal.html`, `affiliate.html`, `financeos.html`, and the `money*.html` client pages. Determine which are actual pages, embedded tabs, or compatibility redirects; preserve them all without rebuilding redirects as new features.
- Trace linked root pages such as sign-in, `progress.html`, agreement/signature, upload/download, and support flows. Search `src/`, `scripts/`, `api/`, `db/`, `public/`, and `docs/` before calling a feature absent.
- Relevant ground truth includes `docs/journeys/client-intended.md`, `client-actual.md`, `client-progress-flow.md`, `client-call-confirmation-intended.md`, the client-facing money journeys/specs, and `fundhub-ios-intended.md`.

## Required acceptance: referral reveals Affiliate Dashboard

- [ ] Find the real client referral assignment/submission flow and the existing affiliate linkage, permissions, and dashboard navigation.
- [ ] After a successful client referral assignment, show the Affiliate Dashboard entry and let the same client open their own dashboard. Do not rely on a transient browser flag.
- [ ] Verify the entry and access survive refresh and a fresh sign-in, using a safe test account/data.
- [ ] Verify a failed referral request does not falsely show success, duplicate a referral, or leak another client's affiliate data.
- [ ] Preserve every existing affiliate/referral feature and existing role checks. Record the exact trigger and expected behavior from verified code.

## Copy-paste workflow prompts

### Cloud lead

> Implement the approved Fundhub client portal iOS redesign from `ops/workflows/client-portal-ios-redo-2026-10-17.md`. Read `AGENTS.md`, relevant repo rules and journey specs. The owner has approved the sample and whole-client-portal build, requested cloud execution, and required exactly one implementation agent per page. First inventory all real pages, controls, APIs, entitlements and features; write a page/feature manifest and concrete agent assignments on this board. Own only the shared client foundation and integration; page agents own one page each. Use the approved sample as the visual source, preserve all existing features and real data, and implement referral assignment revealing the client's Affiliate Dashboard. Verify phone/desktop states and controls, run relevant checks, push a reviewable PR, and present the implemented result for the production-release choice. Do not ask again for the approved build scope.

### One page agent — expand once per actual page

> Own only PAGE_PATH and the page-specific assets/tests explicitly assigned on `ops/workflows/client-portal-ios-redo-2026-10-17.md`. Read that board, `AGENTS.md`, the page's existing code and relevant intended journey. Redesign this one page using `ops/workflows/company-ux-refresh-2026-10-18/client-portal-home-preview.html` and the shared client design foundation. Inventory every current feature/control before editing and map each to the completed page. Preserve APIs, real data, permissions, entitlements, forms, uploads, payment and signature behavior, links, loading/empty/error/full states, accessibility and responsive behavior. Do not edit another page or shared files; send shared requests to the lead. Capture 1440px and 390px proof, click every visible control safely, run relevant checks, and report exact files and any incomplete proof on the shared board.

### Independent reviewer

> Review the implemented client portal pages against the approved sample, the before/after feature manifest, and the intended journeys on `ops/workflows/client-portal-ios-redo-2026-10-17.md`. Read the actual code and evidence. Reproduce page controls and four states at desktop/phone widths, check real role permissions, and verify that client referral assignment reveals a persistent, usable Affiliate Dashboard for that client. Report only observed failures with exact reproduction and evidence; do not invent a pass or rewrite app code. The lead/page owner repairs findings, then you recheck them.

## Completion evidence

- [ ] Page manifest lists every client-facing page/redirect and the single assigned page agent.
- [ ] Before/after feature matrix has no unexplained missing item.
- [ ] Shared styles are client-scoped; staff/shared roles keep working.
- [ ] Real loading, empty, error, and full states; no sample client data shipped.
- [ ] Phone/desktop screenshots and control checks, including upload/download, signing, booking, chat, payments, entitlements, FinanceOS, and referral/Affiliate Dashboard.
- [ ] Relevant lint, TypeScript, tests, browser regressions, and performance evidence; skipped checks are named.
- [ ] Branch pushed and PR linked; final implemented pages ready for release review.

## Cloud task and progress

Cloud task: awaiting creation from this chat. Record the task URL and page-agent manifest when available.
