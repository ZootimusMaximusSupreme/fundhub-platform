# Independent review — 2026-10-18 UTC

Read-only review of application code; no application/test edits or commits. Evidence generated from safe mocked API browser runs, never live writes. Read AGENTS, CLAUDE notes, UI/PERF rules, shared board, client intended journey and heartbeat journey. Consent desk is staff-only by design; client inline authorization remains the intended client path.

## Observed findings

1. **Mobile navigation partly covered by chat (shared integration).** At 390px Home and Affiliate pages, bottom-right Chat FAB paints over the Affiliate Dashboard bottom-nav entry. `public/app/chat-widget.js` uses fixed bottom18/right18 and z-index2147482800; client bottom nav occupies the same area. Reproduce with `page_client_portal.spec.mjs` full enrolled fixture at390 and inspect bottom-right. Marked evidence: `independent-review-chat-overlap-390.webp`. Move chat above client bottom nav, including safe area; verify open chat panel also stays usable.
2. **Home stage label readability and approved composition (page owner).** Desktop1440 image splits Diagnostic inside its word, Submitted as Submitte/d and Approved as Approve/d. At390 horizontal scroll preserves stages but the hero shows clipped following stages and tall wrapped labels. Approved sample instead has compact progress and an in-card View progress button. Current progress link exists immediately below the hero; no functionality removed by that relocation, but visual parity is incomplete. Preserve real eight-stage meaning while fixing stage typography and restoring clear action hierarchy. Marked evidence: `independent-review-stage-labels-1440.webp`.
3. **Client Affiliate KPI summary remains unknown (existing behavior, acceptance limitation).** Affiliate page still gets four KPI tiles from staff-only `FHData.affiliates`; own-identity read renders referral rows correctly. Even the full own-referral fixture shows dashes for Referred/Converted/Owed/Paid. Do not fake totals or widen staff API. A scoped source/calculation is needed if full usable client KPI summary is part of acceptance; this was pre-existing rather than an introduced loss.
4. **Demo population not independently proved.** Repo establishes client@fundhub.ai as client role-test account and chris@fundhub.ai as staff owner; account sentinel identified. At review snapshot no account-scoped sample provider was found by source search. Browser fixtures are synthetic mock responses, not evidence that requested client login has coherent cross-portal samples. No actual account lookup performed by reviewer.

## Referral/security source review

- POST `/api/affiliates/refer` requires client principal, org and account; locks the account row FOR UPDATE, reuses prior affiliate, creates/link-updates within a transaction. Session verification queries `accounts.affiliate_id` afresh. Therefore persistent linkage is implemented in source rather than localStorage.
- GET `/api/read/affiliate-portal` uses session affiliateId for clients; client supplied query IDs cannot select another affiliate. Queries bind both affiliateId and orgId. Missing enrollment is honest empty state.
- Shared client nav activates on server session principal=client only. Nav dashboard entry is based on successful enrolled own-affiliate read; Home successful POST refreshes it. HTTP500 success-shaped response is refused in browser proof.
- Staff Home theme isolation passed. Client-only CSS uses body data-client-ios; public pages opt in intentionally. Consent desk restriction should remain.
- **Not proved:** real scratch-DB enrollment, concurrent writes, refresh and fresh sign-in persistence, DB migrations applied, identity isolation under actual sessions, demo identity account authorization. Source review and mocked tests do not replace those checks. No DB test is reported as pass.

## Browser/node verification

- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/page_client_portal.spec.mjs e2e/page_affiliate.spec.mjs --reporter=line --workers=2`:12passed. Covers all three widths, Home staff isolation/refusal, Affiliate tabs/filter/null commission/retry/unenrolled.
- `node --test src/http/affiliates-self-read.test.mjs src/http/affiliate-screen.test.mjs src/http/portal-refer-a-friend.test.mjs`:16passed,0skipped. Supplied portal-refer glob matched no additional test; do not read this as full referral server proof.
- Broad current page suite75 cases: final result appended below. Consent specs still assume client consent desk elements which were intentionally removed; these are stale tests to update to staff-only rejection and separate inline client consent proof, never permission-widening requests.
- Visually inspected current Home desktop/phone against approved phone, Affiliate phone, FinanceOS desktop and Payments phone. Broad screenshots exist but full manual control coverage for every conditional upload/course/booking/payment/push state is not proved by this review. No mobile slow4G performance measurements run.

Review conclusion: work in progress; do not label complete or production-ready until named findings and unverified acceptance checks are resolved.

Broad suite final result: **72 passed, 3 failed**,37.9s. All three failures are stale client consent-capture specs at1440/390/320 waiting for missing #ccStatusLede. Staff consent case passed.

## Fix recheck — same session

Lead/page owner changed source during review. Reran Home page suite: **8passed**,5.4s, current source. Visually inspected regenerated390px Home screenshot: Chat is now above bottom navigation and Affiliate Dashboard is fully visible; issue1 resolved at tested width. Debug chip removed; real Sign out button visible. Stage disclosure preserves all eight stages (browser clicks/open visibility at1440/390/320 pass); compact closed summary and prominent in-card View progress now replace broken labels, resolving issue2. Screenshot marked failures above are **before-fix evidence**, not current preview. Current screenshot `page_client_portal-home-390.webp` reflects fixes.

Sign out source review: existing shell logout button clicked when present; fallback POSTs auth/logout and only clears local session after HTTP success, displays retry/error on failed request. Visible button observed, but no independent logout click proof run. Real DB checks remain unverified as above.

## Shared/API followup review

Independently reread `api/read/affiliates.mjs`, `src/http/read-api.mjs`, the four self-read tests, new integration spec, PG fresh-password-sign-in assertion, shared CSS/JS. The API change **resolves finding3 in source**: linked client principal enters exactly the affiliate self-read branch, not the staff roster branch. No affiliateId returns [] before querying. SQL keeps mandatory org filter and session affiliate ID; query affiliate_id/org_id ignored. Staff still passes unchanged ROLE_SETS.FINANCE gate. No other principal kinds added. This is authorized own-dashboard read permission, no observed widening to other affiliates or staff roster. Mocked query tests prove bound own identity, not actual database contents.

Independently reran:
- `node --test src/http/affiliates-self-read.test.mjs`: **4passed,0skipped**.
- `PLAYWRIGHT_CHROMIUM=/workspace/scratch/browser-tools/chromium npx playwright test e2e/client-ios-integration.spec.mjs --reporter=line --workers=1`: **3passed**,2.5s. Proves safe mocked referral success reveals own dashboard, reload/new browser context retains server fixture enrollment, no duplicate POST, success-shapedHTTP500 does not reveal entry, Chat/nav geometry clear at390, hidden debug chip, logout failure retains token and retry, logout HTTPsuccess clears token/redirects.

New PG test correctly checks real password login returns kindclient and affiliateId, and both dashboard/stats ignore another affiliate query ID; **NOT RUN** due unavailable DB. Browser fixture retains JS server state across contexts; this is UI integration proof, not real persistence proof. Real account/DB isolation and designated account sample coherence remain unverified. Shared skeleton precedes session resolution and marks readiness after response, retaining staff display afterward; no new auth authority introduced.

## Final CI workflow source check

Read `.github/workflows/client-portal-ios-proof.yml` before push. Both DATABASE_URL and MIGRATION_DATABASE_URL are literal127.0.0.1:5432/fundhub_portal_ci pointing at the disposable pgvectorpg16 service. No secrets references, deployment step, production URL, outbound message/payment/bank command, or credentials import. Workflow permissionscontents:read. Node22 matches repo; migrations create fundhub_app before scratch-only ALTER ROLE. Fixture owner has@example.test identity and no persisted credential provision. No observed production-targeting concern.

Fresh-password PG assertion uses the same fixture password/account created in setup; reads persisted affiliateId after actual login, checks original token refresh, then forged other-affiliate query against both own-dashboard and own-KPI endpoint. Valid intended proof from source. Owner fixture requirement present for both suites. CI not executed by reviewer; run/passed status must be supplied by actual GitHub result. Referral tests run as scratch owner because cleanup requires ownership; final unprivileged guards validate runtime role flags/RLS shape, **not full referral flow under fundhub_app**. Keep that evidence boundary explicit.

No additional observed source issue in workflow. Earlier broad suite3consent failures predate removal of unused consent experiment; final all-page clean result is lead-owned until rerun completes. Accounts/Credit/Connections supplemental browser claims were reported by lead; not independently rerun in this final check. No application/test/workflow source edited by reviewer.
