# Fundhub front-of-house complete screen inventory — 2026-10-27

**Status: OPEN / AUDIT INCOMPLETE.** This is a route-level acceptance ledger, not a claim that any page is perfect. It complements `ops/workflows/manual-e2e-2026-10-26.md` (the detailed live/simulated findings). Source: files under `public/app` and `public` on `main` after PR #148 merged. Some files may be redirects, legacy, fragments or role-restricted; do **not** silently exclude them without checking the actual route and role matrix.

**Gate for EVERY navigable route**: verify authorized roles, denied roles and organization isolation; desktop and phone render; every menu/navigation link; every visible functional button, tab, filter, input, selector, modal, upload and export; initial/empty/loading/error/failure states; saved write/read-after-refresh; event/notification side effect and idempotent replay; accessibility basics and no console/HTTP errors. When a route is a redirect, prove destination, session and permissions. Mark each control PASS only with test/run/screenshot/API/DB evidence, FAIL with reproduction, or NOT LIVE PROVED. A Playwright test filename is a **test pointer**, not proof it passed.

**Inventory size:** 60 staff/account HTML candidates under `public/app`, 13 top-level public HTML candidates, **73 files total** (excluding the non-navigable sidebar fragment). Separately inventory hosted ClickFunnels pages, iOS-native flows, and JavaScript-rendered controls; those are not fully represented by these HTML filenames.

**Expanded candidate inventory (2026-10-28):** A new read of GitHub's actual `public/` directory tree found **28 additional nested HTML candidates** under `affiliates`, `climate`, `consulting`, `education`, `leads`, `partner`, `privacy`, `terms`, and `roadmap`. The earlier 73 count covers only top-level `public/app` and `public` HTML; therefore **101 repository HTML candidates** (excluding the sidebar fragment) must be dispositioned as live, redirect, legacy, static/legal, or out-of-scope with direct proof. **101 is a file-inventory count, not 101 verified live routes.** No files were silently excluded. Hosted ClickFunnels pages and native apps are additional entries, not counted in the 101.

## Additional nested public route candidates — unverified live status

These files exist in `public/`, but their current deployment, audience, entry points, runtime interactions, and role/tenant controls have **not** been established. Each remains **NOT LIVE PROVED** until a browser reachability and action inventory distinguishes live routes from stored prototypes. The lead-specific directory is deliberately redacted in this public ledger.

| Route candidate | Potential surface; not a role assertion | Full acceptance |
| --- | --- | --- |
| `/affiliates/` | Partner prospect / affiliate registration | **NOT LIVE PROVED** |
| `/climate/` | Climate public entry / product | **NOT LIVE PROVED** |
| `/climate/404.html` | Climate not-found path | **NOT LIVE PROVED** |
| `/climate/404/` | Climate alternate not-found path | **NOT LIVE PROVED** |
| `/climate/lender-climate/` | Climate offer / information | **NOT LIVE PROVED** |
| `/consulting/` | Consulting lead / offer | **NOT LIVE PROVED** |
| `/consulting/privacy/` | Consulting policy | **NOT LIVE PROVED** |
| `/consulting/refund/` | Consulting refund policy | **NOT LIVE PROVED** |
| `/consulting/terms/` | Consulting terms | **NOT LIVE PROVED** |
| `/education/` | Education lead / offer | **NOT LIVE PROVED** |
| `/education/enroll/` | Education purchase / enrollment | **NOT LIVE PROVED** |
| `/education/learn/` | Education course access | **NOT LIVE PROVED** |
| `/education/privacy/` | Education policy | **NOT LIVE PROVED** |
| `/education/refund/` | Education refund policy | **NOT LIVE PROVED** |
| `/education/terms/` | Education terms | **NOT LIVE PROVED** |
| `/leads/<existing-slug>/` | Lead-specific public landing candidate; do not expose identity | **NOT LIVE PROVED** |
| `/partner/` | Partner sales landing | **NOT LIVE PROVED** |
| `/partner/autopsy/` | Partner autopsy experience | **NOT LIVE PROVED** |
| `/partner/board/` | Partner board experience | **NOT LIVE PROVED** |
| `/partner/board/live/` | Partner board live variant | **NOT LIVE PROVED** |
| `/partner/menu/` | Partner menu | **NOT LIVE PROVED** |
| `/partner/trial/` | Partner trial offer | **NOT LIVE PROVED** |
| `/partner/trial/live/` | Partner live-trial variant | **NOT LIVE PROVED** |
| `/privacy/` | Site privacy policy | **NOT LIVE PROVED** |
| `/terms/` | Site terms | **NOT LIVE PROVED** |
| `/roadmap/` | Public roadmap / assessment | **NOT LIVE PROVED** |
| `/roadmap/pay.html` | Roadmap checkout entry | **NOT LIVE PROVED** |
| `/roadmap/pull.html` | Roadmap credit / consent entry | **NOT LIVE PROVED** |

## Public visitor and client entry pages

| Route candidate | Likely audience (verify RBAC) | Related automated proof candidate | Full acceptance |
| --- | --- | --- | --- |
| `/404.html` | Public visitor | No direct test identified | **NOT LIVE PROVED** |
| `/careers.html` | Public visitor | No direct test identified | **NOT LIVE PROVED** |
| `/contract.html` | Visitor / client | `e2e/contracts-layout.spec.mjs`, `e2e/contracts-wording-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/crm.html` | Public visitor | `e2e/crm-flows.spec.mjs`, `e2e/partner-brand-crm.spec.mjs` | **NOT LIVE PROVED** |
| `/index.html` | Public visitor | No direct test identified | **NOT LIVE PROVED** |
| `/login.html` | Visitor / client | `e2e/login.spec.mjs`, `e2e/page_login.spec.mjs` | **NOT LIVE PROVED** |
| `/optimize-plan.html` | Visitor / client | No direct test identified | **NOT LIVE PROVED** |
| `/optimize.html` | Visitor / client | `e2e/fin-b01-optimize-intake.spec.mjs` | **NOT LIVE PROVED** |
| `/portal-login.html` | Visitor / client | `e2e/page_portal_login.spec.mjs` | **NOT LIVE PROVED** |
| `/progress.html` | Visitor / client | `e2e/page_progress.spec.mjs`, `e2e/progress-page.spec.mjs` | **NOT LIVE PROVED** |
| `/reset-password.html` | Visitor / client | No direct test identified | **NOT LIVE PROVED** |
| `/start.html` | Visitor / client | `e2e/staff-teams-startup.spec.mjs` | **NOT LIVE PROVED** |
| `/unsubscribe.html` | Visitor / client | No direct test identified | **NOT LIVE PROVED** |

## Staff, owner, partner and client-account screens

| Route candidate | Likely audience (verify RBAC) | Related automated proof candidate | Full acceptance |
| --- | --- | --- | --- |
| `/app/affiliate.html` | Partner / admin | `e2e/affiliate-commission.spec.mjs`, `e2e/affiliate-payouts.spec.mjs` | **NOT LIVE PROVED** |
| `/app/agent-editor.html` | Owner / admin (verify) | `e2e/agent-editor-promote-demote.spec.mjs`, `e2e/agent-editor.spec.mjs` | **NOT LIVE PROVED** |
| `/app/automations.html` | Owner / admin (verify) | No direct test identified | **NOT LIVE PROVED** |
| `/app/bank-outreach.html` | Fulfillment / operations | `e2e/bank-outreach-live-guard.spec.mjs`, `e2e/bank-outreach.spec.mjs` | **NOT LIVE PROVED** |
| `/app/brand-studio.html` | Owner / admin (verify) | `e2e/fin-b01-brand-studio-generation.spec.mjs` | **NOT LIVE PROVED** |
| `/app/calendar.html` | Sales / operations | `e2e/calendar-claim-done.spec.mjs`, `e2e/calendar-workspace.spec.mjs` | **NOT LIVE PROVED** |
| `/app/campaign-manager.html` | Marketing / content | `e2e/fin-b01-campaign-manager.spec.mjs` | **NOT LIVE PROVED** |
| `/app/client-control-panel.html` | Sales / operations | No direct test identified | **NOT LIVE PROVED** |
| `/app/client-portal.html` | Client / account | `e2e/client-portal-ux.spec.mjs`, `e2e/fin-b01-client-portal.spec.mjs` | **NOT LIVE PROVED** |
| `/app/closer-call.html` | Closer | `e2e/closer-call-rhythm.spec.mjs` | **NOT LIVE PROVED** |
| `/app/closer-dashboard.html` | Closer | `e2e/closer-dashboard-calculators.spec.mjs`, `e2e/closer-dashboard-layout.spec.mjs` | **NOT LIVE PROVED** |
| `/app/company-brain.html` | Fulfillment / operations | `e2e/company-brain-chat.paused.spec.mjs`, `e2e/company-brain-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/consent-capture.html` | Client / account | `e2e/consent-capture-clicks.spec.mjs`, `e2e/consent-capture-kinds.spec.mjs` | **NOT LIVE PROVED** |
| `/app/content-admin.html` | Marketing / content | `e2e/content-admin-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/contracts.html` | Sales / operations | `e2e/contracts-layout.spec.mjs`, `e2e/contracts-wording-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/creative-factory.html` | Marketing / content | `e2e/creative-factory-decide.spec.mjs`, `e2e/live-creative-factory-marketing-menu.spec.mjs` | **NOT LIVE PROVED** |
| `/app/csm-queue.html` | Fulfillment / operations | `e2e/csm-queue-clicks.spec.mjs`, `e2e/csm-queue-layout.spec.mjs` | **NOT LIVE PROVED** |
| `/app/documents.html` | Fulfillment / operations | `e2e/documents-clicks.spec.mjs`, `e2e/documents-workspace.spec.mjs` | **NOT LIVE PROVED** |
| `/app/finance-os.html` | Fulfillment / operations | `e2e/finance-os-staff-clicks.spec.mjs`, `e2e/finance-os-workspace.spec.mjs` | **NOT LIVE PROVED** |
| `/app/financeos.html` | Client / account | `e2e/financeos-tabs-clicks.spec.mjs`, `e2e/page_financeos.spec.mjs` | **NOT LIVE PROVED** |
| `/app/galaxy.html` | Owner / admin (verify) | `e2e/galaxy-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/hiring.html` | Owner / admin (verify) | No direct test identified | **NOT LIVE PROVED** |
| `/app/index.html` | Owner / admin (verify) | No direct test identified | **NOT LIVE PROVED** |
| `/app/inquiry-remover.html` | Fulfillment / operations | `e2e/fin-b01-inquiry-remover-repair.spec.mjs` | **NOT LIVE PROVED** |
| `/app/journeys.html` | Owner / admin (verify) | `e2e/journeys-report-layout.spec.mjs` | **NOT LIVE PROVED** |
| `/app/lenders.html` | Fulfillment / operations | `e2e/fin-b15-lenders-dismiss.spec.mjs`, `e2e/lenders-inquiry-ops.spec.mjs` | **NOT LIVE PROVED** |
| `/app/marketing-command-center.html` | Marketing / content | `e2e/marketing-command-center.spec.mjs` | **NOT LIVE PROVED** |
| `/app/messaging.html` | Sales / operations | `e2e/messaging-inbox.spec.mjs`, `e2e/messaging-layout-professional.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-accounts.html` | Client / account | No direct test identified | **NOT LIVE PROVED** |
| `/app/money-alerts.html` | Client / account | `e2e/s2-money-alerts.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-banks.html` | Client / account | `e2e/page_money_banks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-connections.html` | Client / account | `e2e/page_money_connections.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-credit.html` | Client / account | `e2e/page_money_credit.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-declines.html` | Client / account | No direct test identified | **NOT LIVE PROVED** |
| `/app/money-fundability.html` | Client / account | `e2e/page_money_fundability.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-helper.html` | Client / account | `e2e/page_money_helper.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-next.html` | Client / account | `e2e/page_money_next.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-payments.html` | Client / account | `e2e/s1-money-payments-setup.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-plan.html` | Client / account | `e2e/page_money_plan.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-setup.html` | Client / account | `e2e/page_money_setup.spec.mjs`, `e2e/s1-money-payments-setup.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-strategy.html` | Client / account | `e2e/page_money_strategy.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-transfers.html` | Client / account | `e2e/money-transfers-clicks.spec.mjs`, `e2e/s1-money-transfers-tab.spec.mjs` | **NOT LIVE PROVED** |
| `/app/money-vault.html` | Client / account | No direct test identified | **NOT LIVE PROVED** |
| `/app/money.html` | Client / account | `e2e/money-transfers-clicks.spec.mjs`, `e2e/page_money.spec.mjs` | **NOT LIVE PROVED** |
| `/app/morning-brief.html` | Owner / admin (verify) | `e2e/morning-brief.spec.mjs` | **NOT LIVE PROVED** |
| `/app/my-numbers.html` | Closer | `e2e/my-numbers-layout.spec.mjs` | **NOT LIVE PROVED** |
| `/app/ops-admin.html` | Owner / admin (verify) | `e2e/ops-admin-outbound.spec.mjs`, `e2e/ops-admin.spec.mjs` | **NOT LIVE PROVED** |
| `/app/partner-galaxy.html` | Owner / admin (verify) | No direct test identified | **NOT LIVE PROVED** |
| `/app/partner-training.html` | Partner / admin | `e2e/partner-training.spec.mjs` | **NOT LIVE PROVED** |
| `/app/payment-success.html` | Client / account | No direct test identified | **NOT LIVE PROVED** |
| `/app/pipeline.html` | Sales / operations | `e2e/pipeline-honest.spec.mjs`, `e2e/pipeline-new-archive.spec.mjs` | **NOT LIVE PROVED** |
| `/app/present.html` | Closer | `e2e/ccp-present-param-aliases.spec.mjs`, `e2e/fin-b01-present-deck.spec.mjs` | **NOT LIVE PROVED** |
| `/app/products-commissions.html` | Owner / admin (verify) | `e2e/products-commissions-ledger.spec.mjs`, `e2e/s1-products-commissions.spec.mjs` | **NOT LIVE PROVED** |
| `/app/sales-floor.html` | Sales manager / owner | `e2e/s1-sales-floor.spec.mjs`, `e2e/sales-floor-layout.spec.mjs` | **NOT LIVE PROVED** |
| `/app/setter-dashboard.html` | Setter | `e2e/setter-dashboard.spec.mjs` | **NOT LIVE PROVED** |
| `/app/social-studio.html` | Marketing / content | No direct test identified | **NOT LIVE PROVED** |
| `/app/soft-pull-approve.html` | Client / account | `e2e/soft-pull-approve-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/staff-teams.html` | Owner / admin (verify) | `e2e/staff-teams-startup.spec.mjs`, `e2e/staff-teams.spec.mjs` | **NOT LIVE PROVED** |
| `/app/teleprompter-remote.html` | Marketing / content | `e2e/teleprompter-remote-clicks.spec.mjs` | **NOT LIVE PROVED** |
| `/app/teleprompter.html` | Marketing / content | `e2e/teleprompter-camera-steady.spec.mjs`, `e2e/teleprompter-local-preview.spec.mjs` | **NOT LIVE PROVED** |

## Priority per-control ledger from actual page markup and journey files

These are starting controls only; **complete all dynamic controls and tab/subpage states before marking any screen PASS**. Sidebars are shared but must be checked for each actual role, not only once.

| Screen | Visible action IDs / journeys requiring verification | Evidence gate |
| --- | --- | --- |
| Setter Dashboard | `setter-refresh`, queue selection, dial link, `log-dial`, disposition, call attempts, send intro, handoff notes, `save`, `complete`, `send_handoff`, rebook links and retry states | New setter dials/books/shows passed fixtures in PR #148. Real staff read-after-write and actual provider handoff **NOT LIVE PROVED**. |
| Closer Dashboard | `fh-join`, `fh-present`, send contract, payment-link modal/template/offer/motion, deposit & credit calculators, objection tags, save/next call | Wrong-call Join fixed by PR #148 fixtures. Exact current live call, provider contract and paid checkout **NOT LIVE PROVED**. |
| Present | Consent/$32 authorization, sample credit and true CRS gate, score/tier, offer, contract, checkout, accepted-vs-paid, decline, callback, referral, save and next call | In-memory sample and payment-gate tests exist. Full click-to-DB/provider chain **NOT LIVE PROVED**. |
| Client Portal | `call-confirm-btn`, agreement sign/clear/submit, app links, unlock, upload documents/inquiry/bureau response, Payments/Agreements/Documents/Activity/Messages tabs, ask for call, download, referral copy, sign contract, Pay now | Portal magic link and basic render seen in manual walk; confirmation persistence and all permissions/actions **NOT LIVE PROVED**. |
| Pipeline | Sales/funding/optimization/inquiry/AR/affiliate stage views, board/fulfillment lenses, search/sort/filter/clear, new client, client drawer, delete confirmation, status move, real money & sample provenance | Verify every changed stage has matching event and tenant-safe saved state; **NOT LIVE PROVED**. |
| Sales Floor | `fh-floor-refresh`, role numbers, source/belief, unlogged/unrecorded, recordings, table filters, save/refresh, empty and error states | Missing-record false positives repaired PR #148; totals >200 fix under PR #151. Post-call cross-screen numeric equality **NOT LIVE PROVED**. |
| My Numbers | `numbersRefresh`, `numbersRetry`, owner/closer self-scoped revenue, conversion, recordings, no-show, call activity, error states | Self-scoped read and paid-vs-decision consistency **NOT LIVE PROVED**. |
| External ClickFunnels | `/watch` -> apply 9-screen survey -> booking/reschedule -> `/thank-you` -> iOS install/confirm/email/SMS | Manual 2026-10-26 walk found redirect, identity, confirmation and Meet mismatches. Retest fixes; **NOT LIVE PROVED**. |

## Mandatory cross-role purchase handoff gates

| Customer path | Must prove end to end | Status |
| --- | --- | --- |
| Visitor -> lead -> book | Campaign source retained; nine survey screens save; exact name/phone; booking.created dedup; intended redirect and confirm; host Calendar/Meet matches | **NOT LIVE PROVED** |
| Setter -> closer | Real setter task/dial attribution, saved handoff, correct/current Meet link, closer cockpit and Present show same client; no other company data | **NOT LIVE PROVED** |
| Closer -> consent/diagnostic | Explicit consent for $32, fake/scratch sample & provenance, authentic pull gated; visible scores match saved CRS where authorized | **NOT LIVE PROVED** |
| Funding purchase -> funding team | Signed correct agreement, exact provider-paid receipt, no decision=money confusion, funding intake card/task/entitlement and correct purchaser identity | **NOT LIVE PROVED** |
| Repair purchase -> repair team | Same verified paid/consent gate; correct trial/full entitlement and repair queue; no cross-product fulfillment | **NOT LIVE PROVED** |
| Blueprint purchase -> Blueprint team | Exact-priced sent agreement/provider checkout/receipt, no duplicate credit, welcome kit & correct Blueprint queue/access | **NOT LIVE PROVED** |
| Decline / no show / callback | Explicit disposition, nonpurchase routing, referral vs follow-up split, deduplicated recovery, read-after-refresh on seller and manager desks | **NOT LIVE PROVED** |
| Recording and metrics | Exact call recording -> Drive -> words -> context; no false alarms; displayed counts per role agree; sim records never present as real funded cash | **NOT LIVE PROVED** |

## Paid sale and recording-count follow-up — October 27, 2026

**Paid fulfillment entry — FAIL in code review, fix proposed, NOT LIVE PROVED.**
`src/handlers/purchase-routing.mjs` previously interpreted any active `sales` row as a purchased
funding/repair product, without checking its actual sale payments. An unrelated
`payment.received` event could therefore route a signed-but-unpaid client to fulfillment.
PR [#154](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/154)
introduces a same-sale, same-org positive net front-end payment requirement
(deposits + installments - refunds; success fees excluded) with a real-Postgres
regression covering unpaid funding, unpaid repair, fee-only and fully refunded sales.
**Proof pending CI and deployment; do not treat this as a verified purchase handoff.**

**Repair-program tier escalation — FAIL in reviewed source; targeted fix in [PR #162](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/162), CI/ship NOT YET PROVED.**
The top-level paid sale gate in #154 correctly requires positive net payments on the same sale, but the downstream `repairPurchase()` previously chose the first signed non-trial repair sale regardless of money and summed refunds as positive. A buyer who paid $200 for two trial rounds and later signed an **unpaid or fully refunded** full repair offer could therefore receive the six-round program without purchasing it. #162 scopes the selected program to the same company's individual sale's positive net deposits/installments less refunds; success fees never count. Unit scenarios plus a real-Postgres trial+unpaid/refunded bundle regression are added, but no provider paid receipt, role-screen confirmation or final team handoff has been observed. **Keep the repair-purchase gate NOT LIVE PROVED until green PR/main/ship checks and a verified buyer-to-repair-team trace.**

**Sales Floor recording totals — failing fixture diagnosed, repair proposed, NOT LIVE PROVED.**
PR [#151](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/151)
uncaps the true missing-recording total but exposed an older canned-DB proof
that does not mock its aggregate query. CI run `40540991198` / unit shard 0/6
reproduced `0 !== 1` in `fin-b20-repair-floor.test.mjs:74`.
Test-only PR [#153](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/153)
adds the aggregate fixture and cross-panel equality check. Passing provider
Drive-to-call evidence and staff-screen truth remain **NOT LIVE PROVED**.

All eight cross-role gates above still require final independent evidence.


## October 28 verification delta (source-status only; no live customer writes)

- **Protected-main merged patches:** #154 binds front-of-house fulfillment entry to the same sale's verified positive net payment; #162 prevents unpaid/refunded full-repair upgrade from displacing a paid two-round trial; #163 scopes inbound replies to the correct company; #164 adds due-dated declined-funding follow-up; #165 binds closer outcomes to the exact client; #167 updates independently stale Sales Floor/Pulse proof fixtures. These are **CODE/CI improvements, not live payment-to-team handoff PASS**.
- **Current isolated follow-ups:** #166 prevents demo sales records inflating Sales Floor and Pulse, but its original head has four red CI jobs and must be updated/retested after #167; #168 adds a 24-hour closer callback task without tagging a decline, but the first Actions attempt failed a separate Funding Papers sort browser test. #169 supplies a test-only save/repaint synchronization correction for that independent proof. #156 checkout timeout and #160 no-show rescheduling also remain open/red on their checked heads. No production claims follow from those PRs.
- **Catalog scope versus real acceptance:** `src/pulse/catalog/generated.json` currently enumerates **3,980 control mapping rows, 3,947 unique items** and reports all 3,947 as **wired** with zero catalog-red items. That status proves mapping only. Each page's actual rendered controls, role authorization, save/readback, mobile/errors, and notification/provider receipts still require separate **PASS**, **FAIL** or **NOT LIVE PROVED** rows. The 73 primary route ledger and 28 additional candidates above are an inventory, **not a completed action-by-action ledger**.
- **Provider boundary:** The verified-paid-funding, verified-paid-repair, and verified-paid-Blueprint customer-to-specific-fulfillment-team handoffs, including task, document, entitlement and replay evidence, are still **NOT LIVE PROVED**. Scratch payment/bureau only; never call live provider delivery, pull, payment or production writes without separate authorization.

## Coverage rule

No screen, control, or cross-role path may be called fully PASS merely because its source file exists, an isolated assertion passed, or a signed-in screenshot renders. Required live-provider receipts not safely obtainable remain **NOT LIVE PROVED**. Continue repairing independent code defects in isolated PRs while retaining this honest boundary.

## October 28 follow-on: staff conversation reply and overdue-call count

**Evidence type: source review + synthetic CI, never production-provider PASS.** This checkpoint adds action-level acceptance gates without changing any existing FAIL or NOT LIVE PROVED finding.

| Screen / control | Scenario and required truth | Source/CI state | Full acceptance |
| --- | --- | --- | --- |
| `/app/messaging.html` — staff Reply on existing SMS/email thread | A same-organization conversation with a client ID owned by another organization must be refused *before* address resolution, message insertion or provider call. Normal same-company replies must still work. | **CODE PASS** — [#176](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/176) merged to protected main at `5ff92c24235b12c296b96a24ec06cb17d18fdcb7` after 14/14 pull-request tests; focused DB fixture and memory-provider negative-path proof in `src/messaging/compose.pg.test.mjs` and `src/messaging/compose-conversation-org.test.mjs`. | **NOT LIVE PROVED** — read-only staff role screen, provider receipt, deployed behavior and mobile/error states still need independent proof. |
| `/app/my-numbers.html` + `/app/sales-floor.html` — Calls not logged metric | Count all overdue closer booking tasks, not just the 200 records allowed in a detail list; organization and staff assignment scope must match. | **CODE PASS / MERGED** — [#174](https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/174) merged to protected main at `16457531b9eabab6a7ec12da799ecb89b418673a` after 14/14 passing pull-request checks and 14/14 push checks on head `77ee5118d6a887cab832415cfd750f354d43f91d`. An uncapped SQL count with an organization guard replaces the 200-row list proxy; a SELECT-only PostgreSQL 256-task regression proves the exact count without stored test records. Main CI and Ship to live began on 2026-10-28 at 13:27Z; deployment and live staff-screen values still need separate verification. | **NOT LIVE PROVED** — same-customer and same-period read-only role-screen counts, deployment, error/loading states unverified. |
| Purchase / funding, repair, Blueprint staff team assignment | Correct org, verified positive net payment *on the same sale*, correct entitlement, task and documents, no duplicate replay or wrong-team dispatch. | Previous #154/#162/#173 and other fixture-level repairs remain evidence of code guards only. | **NOT LIVE PROVED** for all three complete purchase-to-team traces and provider receipts. |

**Deployment gate:** `Ship to live` succeeded for main `5ff92c24235b12c296b96a24ec06cb17d18fdcb7` in [run 40687916827](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/40687916827), followed by a ship-marker commit `9bccfcb0c028088f5f39b0138f3ef382f58cd23c`; this proves an automated deployment run, **not** a signed-in production messaging receipt or role-screen PASS. For #174, `Ship to live` [run 40696530380](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/40696530380) and main CI [run 40696530483](https://github.com/ZootimusMaximusSupreme/fundhub-platform/actions/runs/40696530483) were still in progress at 2026-10-28 13:27Z. Preserve all unproven rows until independent role-screen/customer-to-team verification; no real test charges, bureau pulls, or outbound messages.
