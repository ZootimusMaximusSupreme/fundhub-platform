# Fundhub front-of-house complete screen inventory — 2026-10-27

**Status: OPEN / AUDIT INCOMPLETE.** This is a route-level acceptance ledger, not a claim that any page is perfect. It complements `ops/workflows/manual-e2e-2026-10-26.md` (the detailed live/simulated findings). Source: files under `public/app` and `public` on `main` after PR #148 merged. Some files may be redirects, legacy, fragments or role-restricted; do **not** silently exclude them without checking the actual route and role matrix.

**Gate for EVERY navigable route**: verify authorized roles, denied roles and organization isolation; desktop and phone render; every menu/navigation link; every visible functional button, tab, filter, input, selector, modal, upload and export; initial/empty/loading/error/failure states; saved write/read-after-refresh; event/notification side effect and idempotent replay; accessibility basics and no console/HTTP errors. When a route is a redirect, prove destination, session and permissions. Mark each control PASS only with test/run/screenshot/API/DB evidence, FAIL with reproduction, or NOT LIVE PROVED. A Playwright test filename is a **test pointer**, not proof it passed.

**Inventory size:** 60 staff/account HTML candidates under `public/app`, 13 top-level public HTML candidates, **73 files total** (excluding the non-navigable sidebar fragment). Separately inventory hosted ClickFunnels pages, iOS-native flows, and JavaScript-rendered controls; those are not fully represented by these HTML filenames.

## Public visitor and client entry pages

| Route candidate | Likely audience (verify RBAC) | Related automated proof candidate | Full acceptance |
| --- | --- | --- | --- |
| `/404.html` | Public visitor | No direct test identified | **NOT FULLY PROVED** |
| `/careers.html` | Public visitor | No direct test identified | **NOT FULLY PROVED** |
| `/contract.html` | Visitor / client | `e2e/contracts-layout.spec.mjs`, `e2e/contracts-wording-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/crm.html` | Public visitor | `e2e/crm-flows.spec.mjs`, `e2e/partner-brand-crm.spec.mjs` | **NOT FULLY PROVED** |
| `/index.html` | Public visitor | No direct test identified | **NOT FULLY PROVED** |
| `/login.html` | Visitor / client | `e2e/login.spec.mjs`, `e2e/page_login.spec.mjs` | **NOT FULLY PROVED** |
| `/optimize-plan.html` | Visitor / client | No direct test identified | **NOT FULLY PROVED** |
| `/optimize.html` | Visitor / client | `e2e/fin-b01-optimize-intake.spec.mjs` | **NOT FULLY PROVED** |
| `/portal-login.html` | Visitor / client | `e2e/page_portal_login.spec.mjs` | **NOT FULLY PROVED** |
| `/progress.html` | Visitor / client | `e2e/page_progress.spec.mjs`, `e2e/progress-page.spec.mjs` | **NOT FULLY PROVED** |
| `/reset-password.html` | Visitor / client | No direct test identified | **NOT FULLY PROVED** |
| `/start.html` | Visitor / client | `e2e/staff-teams-startup.spec.mjs` | **NOT FULLY PROVED** |
| `/unsubscribe.html` | Visitor / client | No direct test identified | **NOT FULLY PROVED** |

## Staff, owner, partner and client-account screens

| Route candidate | Likely audience (verify RBAC) | Related automated proof candidate | Full acceptance |
| --- | --- | --- | --- |
| `/app/affiliate.html` | Partner / admin | `e2e/affiliate-commission.spec.mjs`, `e2e/affiliate-payouts.spec.mjs` | **NOT FULLY PROVED** |
| `/app/agent-editor.html` | Owner / admin (verify) | `e2e/agent-editor-promote-demote.spec.mjs`, `e2e/agent-editor.spec.mjs` | **NOT FULLY PROVED** |
| `/app/automations.html` | Owner / admin (verify) | No direct test identified | **NOT FULLY PROVED** |
| `/app/bank-outreach.html` | Fulfillment / operations | `e2e/bank-outreach-live-guard.spec.mjs`, `e2e/bank-outreach.spec.mjs` | **NOT FULLY PROVED** |
| `/app/brand-studio.html` | Owner / admin (verify) | `e2e/fin-b01-brand-studio-generation.spec.mjs` | **NOT FULLY PROVED** |
| `/app/calendar.html` | Sales / operations | `e2e/calendar-claim-done.spec.mjs`, `e2e/calendar-workspace.spec.mjs` | **NOT FULLY PROVED** |
| `/app/campaign-manager.html` | Marketing / content | `e2e/fin-b01-campaign-manager.spec.mjs` | **NOT FULLY PROVED** |
| `/app/client-control-panel.html` | Sales / operations | No direct test identified | **NOT FULLY PROVED** |
| `/app/client-portal.html` | Client / account | `e2e/client-portal-ux.spec.mjs`, `e2e/fin-b01-client-portal.spec.mjs` | **NOT FULLY PROVED** |
| `/app/closer-call.html` | Closer | `e2e/closer-call-rhythm.spec.mjs` | **NOT FULLY PROVED** |
| `/app/closer-dashboard.html` | Closer | `e2e/closer-dashboard-calculators.spec.mjs`, `e2e/closer-dashboard-layout.spec.mjs` | **NOT FULLY PROVED** |
| `/app/company-brain.html` | Fulfillment / operations | `e2e/company-brain-chat.paused.spec.mjs`, `e2e/company-brain-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/consent-capture.html` | Client / account | `e2e/consent-capture-clicks.spec.mjs`, `e2e/consent-capture-kinds.spec.mjs` | **NOT FULLY PROVED** |
| `/app/content-admin.html` | Marketing / content | `e2e/content-admin-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/contracts.html` | Sales / operations | `e2e/contracts-layout.spec.mjs`, `e2e/contracts-wording-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/creative-factory.html` | Marketing / content | `e2e/creative-factory-decide.spec.mjs`, `e2e/live-creative-factory-marketing-menu.spec.mjs` | **NOT FULLY PROVED** |
| `/app/csm-queue.html` | Fulfillment / operations | `e2e/csm-queue-clicks.spec.mjs`, `e2e/csm-queue-layout.spec.mjs` | **NOT FULLY PROVED** |
| `/app/documents.html` | Fulfillment / operations | `e2e/documents-clicks.spec.mjs`, `e2e/documents-workspace.spec.mjs` | **NOT FULLY PROVED** |
| `/app/finance-os.html` | Fulfillment / operations | `e2e/finance-os-staff-clicks.spec.mjs`, `e2e/finance-os-workspace.spec.mjs` | **NOT FULLY PROVED** |
| `/app/financeos.html` | Client / account | `e2e/financeos-tabs-clicks.spec.mjs`, `e2e/page_financeos.spec.mjs` | **NOT FULLY PROVED** |
| `/app/galaxy.html` | Owner / admin (verify) | `e2e/galaxy-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/hiring.html` | Owner / admin (verify) | No direct test identified | **NOT FULLY PROVED** |
| `/app/index.html` | Owner / admin (verify) | No direct test identified | **NOT FULLY PROVED** |
| `/app/inquiry-remover.html` | Fulfillment / operations | `e2e/fin-b01-inquiry-remover-repair.spec.mjs` | **NOT FULLY PROVED** |
| `/app/journeys.html` | Owner / admin (verify) | `e2e/journeys-report-layout.spec.mjs` | **NOT FULLY PROVED** |
| `/app/lenders.html` | Fulfillment / operations | `e2e/fin-b15-lenders-dismiss.spec.mjs`, `e2e/lenders-inquiry-ops.spec.mjs` | **NOT FULLY PROVED** |
| `/app/marketing-command-center.html` | Marketing / content | `e2e/marketing-command-center.spec.mjs` | **NOT FULLY PROVED** |
| `/app/messaging.html` | Sales / operations | `e2e/messaging-inbox.spec.mjs`, `e2e/messaging-layout-professional.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-accounts.html` | Client / account | No direct test identified | **NOT FULLY PROVED** |
| `/app/money-alerts.html` | Client / account | `e2e/s2-money-alerts.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-banks.html` | Client / account | `e2e/page_money_banks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-connections.html` | Client / account | `e2e/page_money_connections.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-credit.html` | Client / account | `e2e/page_money_credit.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-declines.html` | Client / account | No direct test identified | **NOT FULLY PROVED** |
| `/app/money-fundability.html` | Client / account | `e2e/page_money_fundability.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-helper.html` | Client / account | `e2e/page_money_helper.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-next.html` | Client / account | `e2e/page_money_next.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-payments.html` | Client / account | `e2e/s1-money-payments-setup.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-plan.html` | Client / account | `e2e/page_money_plan.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-setup.html` | Client / account | `e2e/page_money_setup.spec.mjs`, `e2e/s1-money-payments-setup.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-strategy.html` | Client / account | `e2e/page_money_strategy.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-transfers.html` | Client / account | `e2e/money-transfers-clicks.spec.mjs`, `e2e/s1-money-transfers-tab.spec.mjs` | **NOT FULLY PROVED** |
| `/app/money-vault.html` | Client / account | No direct test identified | **NOT FULLY PROVED** |
| `/app/money.html` | Client / account | `e2e/money-transfers-clicks.spec.mjs`, `e2e/page_money.spec.mjs` | **NOT FULLY PROVED** |
| `/app/morning-brief.html` | Owner / admin (verify) | `e2e/morning-brief.spec.mjs` | **NOT FULLY PROVED** |
| `/app/my-numbers.html` | Closer | `e2e/my-numbers-layout.spec.mjs` | **NOT FULLY PROVED** |
| `/app/ops-admin.html` | Owner / admin (verify) | `e2e/ops-admin-outbound.spec.mjs`, `e2e/ops-admin.spec.mjs` | **NOT FULLY PROVED** |
| `/app/partner-galaxy.html` | Owner / admin (verify) | No direct test identified | **NOT FULLY PROVED** |
| `/app/partner-training.html` | Partner / admin | `e2e/partner-training.spec.mjs` | **NOT FULLY PROVED** |
| `/app/payment-success.html` | Client / account | No direct test identified | **NOT FULLY PROVED** |
| `/app/pipeline.html` | Sales / operations | `e2e/pipeline-honest.spec.mjs`, `e2e/pipeline-new-archive.spec.mjs` | **NOT FULLY PROVED** |
| `/app/present.html` | Closer | `e2e/ccp-present-param-aliases.spec.mjs`, `e2e/fin-b01-present-deck.spec.mjs` | **NOT FULLY PROVED** |
| `/app/products-commissions.html` | Owner / admin (verify) | `e2e/products-commissions-ledger.spec.mjs`, `e2e/s1-products-commissions.spec.mjs` | **NOT FULLY PROVED** |
| `/app/sales-floor.html` | Sales manager / owner | `e2e/s1-sales-floor.spec.mjs`, `e2e/sales-floor-layout.spec.mjs` | **NOT FULLY PROVED** |
| `/app/setter-dashboard.html` | Setter | `e2e/setter-dashboard.spec.mjs` | **NOT FULLY PROVED** |
| `/app/social-studio.html` | Marketing / content | No direct test identified | **NOT FULLY PROVED** |
| `/app/soft-pull-approve.html` | Client / account | `e2e/soft-pull-approve-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/staff-teams.html` | Owner / admin (verify) | `e2e/staff-teams-startup.spec.mjs`, `e2e/staff-teams.spec.mjs` | **NOT FULLY PROVED** |
| `/app/teleprompter-remote.html` | Marketing / content | `e2e/teleprompter-remote-clicks.spec.mjs` | **NOT FULLY PROVED** |
| `/app/teleprompter.html` | Marketing / content | `e2e/teleprompter-camera-steady.spec.mjs`, `e2e/teleprompter-local-preview.spec.mjs` | **NOT FULLY PROVED** |

## Priority per-control ledger from actual page markup and journey files

These are starting controls only; **complete all dynamic controls and tab/subpage states before marking any screen PASS**. Sidebars are shared but must be checked for each actual role, not only once.

| Screen | Visible action IDs / journeys requiring verification | Evidence gate |
| --- | --- | --- |
| Setter Dashboard | `setter-refresh`, queue selection, dial link, `log-dial`, disposition, call attempts, send intro, handoff notes, `save`, `complete`, `send_handoff`, rebook links and retry states | New setter dials/books/shows passed fixtures in PR #148. Real staff read-after-write and actual provider handoff **NOT LIVE PROVED**. |
| Closer Dashboard | `fh-join`, `fh-present`, send contract, payment-link modal/template/offer/motion, deposit & credit calculators, objection tags, save/next call | Wrong-call Join fixed by PR #148 fixtures. Exact current live call, provider contract and paid checkout **NOT LIVE PROVED**. |
| Present | Consent/$32 authorization, sample credit and true CRS gate, score/tier, offer, contract, checkout, accepted-vs-paid, decline, callback, referral, save and next call | In-memory sample and payment-gate tests exist. Full click-to-DB/provider chain **NOT LIVE PROVED**. |
| Client Portal | `call-confirm-btn`, agreement sign/clear/submit, app links, unlock, upload documents/inquiry/bureau response, Payments/Agreements/Documents/Activity/Messages tabs, ask for call, download, referral copy, sign contract, Pay now | Portal magic link and basic render seen in manual walk; confirmation persistence and all permissions/actions **NOT FULLY PROVED**. |
| Pipeline | Sales/funding/optimization/inquiry/AR/affiliate stage views, board/fulfillment lenses, search/sort/filter/clear, new client, client drawer, delete confirmation, status move, real money & sample provenance | Verify every changed stage has matching event and tenant-safe saved state; **NOT LIVE PROVED**. |
| Sales Floor | `fh-floor-refresh`, role numbers, source/belief, unlogged/unrecorded, recordings, table filters, save/refresh, empty and error states | Missing-record false positives repaired PR #148; totals >200 fix under PR #151. Post-call cross-screen numeric equality **NOT LIVE PROVED**. |
| My Numbers | `numbersRefresh`, `numbersRetry`, owner/closer self-scoped revenue, conversion, recordings, no-show, call activity, error states | Self-scoped read and paid-vs-decision consistency **NOT LIVE PROVED**. |
| External ClickFunnels | `/watch` -> apply 9-screen survey -> booking/reschedule -> `/thank-you` -> iOS install/confirm/email/SMS | Manual 2026-10-26 walk found redirect, identity, confirmation and Meet mismatches. Retest fixes; **NOT FULLY PROVED**. |

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

## Coverage rule

No screen, control, or cross-role path may be called fully PASS merely because its source file exists, an isolated assertion passed, or a signed-in screenshot renders. Required live-provider receipts not safely obtainable remain **NOT LIVE PROVED**. Continue repairing independent code defects in isolated PRs while retaining this honest boundary.

