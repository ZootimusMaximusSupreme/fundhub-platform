# Fundhub Accounts Receivable — independent end-to-end acceptance matrix

**Started:** 2026-10-28. **Lane owner:** A/R audit. **Source baseline:** `main` at `1f6c005fb36aee0a2b4a3f7832ccd9904d78a610`. **Status:** OPEN / NOT SIGNED OFF.

## Boundaries and proof rules
- Scope: a contractually valid receivable after a paid sale/verified financing result -> invoice and amount due -> provider payment and allocation -> reconciliation, settlement or authorized write-off/collections escalation. Front-of-house purchase and fulfillment execution are separate audits. Keep attribution and financial event contracts synchronized, but never edit their active PR files.
- `PASS` requires execution evidence for that exact row and scenario. `FAIL` requires source/fixture reproduction and a test/PR. `NOT LIVE PROVED` is the correct verdict where only static code, isolated tests or previous mixed walkthroughs exist. A CI PASS for a module is **not** a live merchant receipt, email delivery, role-screen proof or full E2E PASS.
- Safety: GitHub Actions disposable Postgres, a test-only mock payment/bureau/messaging adapter, plus-tag synthetic fixtures. Never write to live Supabase, charge real cards, send real messages, make bureau pulls, or create production demo clients. No real payout/refund/write-off tests.
- Audit inventory and old evidence: `ops/workflows/manual-e2e-2026-10-26.md`, `src/handlers/money-chain.mjs`, `src/invoices/{index,allocate,ar-filter}.mjs`, `src/workflows/ar-collections.mjs`, `src/workflows/invoice-sent-recovery.mjs`, `src/workflows/f-07-funding-locked.mjs`, `api/read/invoices.mjs`, `public/app/{ops-admin,client-portal,payment-success,closer-dashboard}.html`, `src/handlers/commas-disputes.mjs`, `src/payments/whop-billing-reconcile.mjs`, `src/workflows/subscription-billing-sweeper.mjs`, `db/migrations/031_invoices.sql`.
- Open PR ownership check at start: #156 (payment-success screen), #157 (manual E2E board), #160 (no-show + test-support fake), #166 (Pulse sales metrics), #182 (Hiring), #187 (funding handoff); this A/R branch edits **none** of their files. Do not take over payment-success, Pulse or client portal visual pages; only check and report finance contract mismatches.

## Acceptance matrix — backend money and events

| ID | Control/path and scenarios to drive | Source / role | Verdict | Evidence or missing receipt |
| --- | --- | --- | --- | --- |
| A01 | Sale created: upfront cash receipt; sale status, currency, exact product and org | `money-chain.mjs` / closer | NOT LIVE PROVED | Isolated `money-chain*.pg.test.mjs` exist; no same-client live PSP receipt + invoice proof. |
| A02 | Deposit and installment amounts stay separate from success fee, including payment before invoice | `money-chain.mjs` / A/R | NOT LIVE PROVED | Source `paymentKindFor`, `successFeeInvoiceFor`; full mixed payment E2E pending. |
| A03 | 0% down, 2+ installments, term dates, final settlement and arrears | checkout/contract/payments | NOT LIVE PROVED | Confirm live offers first; do not fabricate pricing or deem non-offered plans PASS. |
| A04 | ACH failure, rejected card, delayed settlement, missing PSP receipt | Commas/Whop inbox | NOT LIVE PROVED | Mock provider failures + actual read-only merchant reconciliation necessary. |
| A05 | Approved lender amount vs VERIFIED funded result; success fee only when contract authorizes | F-07 and funding event / funding advisor | NOT LIVE PROVED | F-07 currently uses **confirmed approvals x agreed fee %** on `round.funded`; Oct 28 A/R acceptance specifies **never mere approval/estimate**. Resolve event-level source of cash receipt and product contract without editing fulfillment lane's files. |
| A06 | Fee-percent null, >100, zero confirmed base, missing sale/round IDs | `f-07-funding-locked.mjs` | NOT LIVE PROVED | `resolveFee` has refusal/task; real provider and client proof missing. |
| A07 | Invoice created, `source`, legacy `invoice_type`, amount due, org/client, sale/round, unique key | `src/invoices/index.mjs` | NOT LIVE PROVED | Postgres `invoices.pg.test.mjs` verifies schema/unique paths; not full receipt trace. |
| A08 | Invoice `draft -> sent`, durable event, recovery of lost send event | `index.mjs`, `invoice-sent-recovery.mjs` | NOT LIVE PROVED | `invoice-workflows.pg.test.mjs` covers F-07/DS-02; replay + provider handoff still needed. |
| A09 | Unpaid success fee A/R-01 + exact remaining balance + current payment link | `ar-collections.mjs` | NOT LIVE PROVED | Existing fixture `ar-collections.test.mjs` verifies template and one link, no live dispatch receipt. |
| A10 | A/R-02 at +7 days only if balance still due | `ar-collections.mjs` | NOT LIVE PROVED | Inngest step.sleep and re-read tested by fake clock, not live scheduler. |
| A11 | A/R-03 at +14 days only if balance still due | `ar-collections.mjs` | NOT LIVE PROVED | Ditto; verify provider receipts and cancellation on payment. |
| A12 | AR-04 CSM-owned task after 3 notices; exact invoice and due balance; replay once | `ar-collections.mjs` / CSM | NOT LIVE PROVED | Existing fixture proves `assigneeRole:csm` and dedupe; staff queue role screen not witnessed. |
| A13 | Collections pause after exact/full payment, including payment between notices | `ar-collections.mjs` | NOT LIVE PROVED | Source checks `stillOpen` per step; `invoice.paid` cancelOn; external receipts missing. |
| A14 | Partial payment remainder and refreshed payment link; prior link retired | `allocate.mjs`, `attachInvoicePayLink` | NOT LIVE PROVED | Source and fixture tests present; no live PSP link retirement receipt. |
| A15 | Old, void, expired or wrong amount checkout link refused; fresh link idempotent | `retire-invoice-checkout.mjs` | NOT LIVE PROVED | Source tests and recovery exist; provider-level validation pending. |
| A16 | Exact payment: one invoice receipt, paid status, event, bank/payment reconciliation | `allocate.mjs` | NOT LIVE PROVED | Existing fixtures cover paid; real merchant settlement missing. |
| A17 | Underpayment: partial status, notice balance; never mark fully paid | `allocate.mjs` | NOT LIVE PROVED | Existing fixtures cover underpay; ledger/UI same-client check pending. |
| A18 | Overpayment: apply at most amount due, leave surplus unallocated with task | `allocate.mjs` | NOT LIVE PROVED | Existing tests `overpay` and concurrent receipts; account credit/refund method still unproven. |
| A19 | Same PSP receipt replay and concurrent distinct envelopes: one allocation | `allocate.mjs` | NOT LIVE PROVED | Existing tests cover receipt lock/idempotency; PG concurrency + webhook inbox pending. |
| A20 | Distinct receipts concurrently: never more than due, remainder flagged | `allocate.mjs` | NOT LIVE PROVED | Unit concurrency fixture exists; real PG/PSP replay proof pending. |
| A21 | Conflicting invoice ID, payment link, ref, client, round or tenant | `allocate.mjs` | NOT LIVE PROVED | Existing mismatch tests; add real PG isolation and staff queue proof. |
| A22 | Unmatched success fee with no invoice identifier: unallocated advisor task | `allocate.mjs` | NOT LIVE PROVED | Source/test path exists; staff queue arrival not externally proved. |
| A23 | Deposit event with success-fee invoice ID: cannot settle fee by accident | `allocate.mjs` | FAIL ON BASELINE; FIX PROPOSED | Old handler matched any hinted invoice ID. A/R branch introduces explicit deposit skip; 1 fake and 1 real-PG regression added, CI pending. |
| A24 | A non-success-fee invoice ID cannot receive a success-fee receipt | `allocate.mjs` | FAIL ON BASELINE; FIX PROPOSED | Old allocator never gated the authoritative invoice source. A/R branch adds source guard + task when marked fee; unit + PG regressions added. |
| A25 | Bogus `invoice.sent` payload cannot chase non-success-fee invoice | `ar-collections.mjs` | FAIL ON BASELINE; FIX PROPOSED | Old code trusted event `source` and omitted stored-source recheck. A/R branch adds stored-source guard + test. |
| A26 | Cross-client/cross-org `invoice.sent`: no wrong recipient or link | `ar-collections.mjs` | FAIL ON BASELINE; FIX PROPOSED | Old notices used resolved event client, but invoice row and checkout came from unscoped ID. A/R branch validates row org/client before every notice; tests added. |
| A27 | Changed/voided/replaced invoice during 7/14-day sleep; suppress later notices | `ar-collections.mjs` | NOT LIVE PROVED | New regression for reclassified invoice + old void/paid tests; need provider proof. |
| A28 | Forged invoice number in envelope cannot appear in customer demand | `ar-collections.mjs` | FAIL ON BASELINE; FIX PROPOSED | Previously event override; A/R branch computes number from stored invoice + regression. |
| A29 | Late payment on voided/reissued invoice must not settle new invoice | `allocate.mjs` | NOT LIVE PROVED | Existing specific unit tests, provider replay proof pending. |
| A30 | Refund and reversal: invoice payment reversal ledger entry and re-open if owed | `money-chain.mjs`, `commas-disputes.mjs`, `invoice_payments` | NOT LIVE PROVED | Payment refund/task paths exist but need exact invoice ledger replay/re-open proof. |
| A31 | Chargeback pending, won, lost and deadline; never treat pending as final | `commas-disputes.mjs` / owner | NOT LIVE PROVED | Dispute creates deadline-bearing owner task; financial reversal only after verified final state. |
| A32 | Write-off/manual correction: permissions, reason, audit, aging recalculation | `invoices` / owner/admin | NOT LIVE PROVED | DB states include `written_off`; find live action and audit trail or mark non-live. |
| A33 | Void/cancel/reissue, credits/unapplied receipts, no duplicate invoice | `invoices/index.mjs`, `payment-links` | NOT LIVE PROVED | Void and uniqueness tests exist; replacement invoice-to-PSP receipts pending. |
| A34 | Refund/chargeback/reissue replay does not duplicate task, receipt or credit | event bus + reversal handlers | NOT LIVE PROVED | Need disposable PG provider inbox integration + offscreen side-effect assertions. |
| A35 | WHOP Blueprint financing/billing: enabled-state, subscription cycle, failure/retry, plan cancel | `whop-billing-inbox`, subscription sweeper | NOT LIVE PROVED | Plan availability and actual offered flows must be evidenced; never auto-activate billing flags. |
| A36 | Repair payment/fee, arrears, emergency fee and upgrades only per signed offer | sale ledger + contract | NOT LIVE PROVED | Distinguish repair price vs funding success fee; verify actual signed terms. |

## Acceptance matrix — pages, roles, actions and reconciliation

| ID | Surface/control | Required role/proof | Verdict | Missing evidence |
| --- | --- | --- | --- | --- |
| U01 | Ops & Admin > AR table: load, oldest-first pagination, amount, open filter | owner/admin/sales_manager; `public/app/ops-admin.html` -> `GET /api/read/invoices?status=open` | NOT LIVE PROVED | Endpoint test `src/http/read-invoices-handler.test.mjs` covers SQL/scope; actual read-only role-screen rows and browser navigation pending. |
| U02 | AR row expand/details, due date, aging, timeline and CSM | owner/admin/sales_manager | NOT LIVE PROVED | Browser click proof for full, partial, no date, error and no rows pending. |
| U03 | AR paging/sorting: >50 overdue across companies, no demo rows or wrong org | finance read API + view | NOT LIVE PROVED | Test `?status=open`, 400 invalid filter, null org; real PG multi-tenant RLS/browser proof pending. |
| U04 | AR list permission: setter, closer, funding advisor, client cannot read all invoices | `ROLE_SETS.FINANCE` only owner/admin/sales_manager | NOT LIVE PROVED | Static role gate observed, actual read-only 403 per role unproven. |
| U05 | Ops & Admin > Outbox: dispatch queued messages | owner/admin, real-send button | NOT LIVE PROVED | UI has explicit confirmation; no live send allowed in audit. Prove with mock dispatcher only. |
| U06 | Ops & Admin > Outbox: outbound on/off toggle | owner/admin | NOT LIVE PROVED | Button triggers live setting; use mock only, never flip production. |
| U07 | Ops & Admin > Outbox: email unsent invoice backlog | owner/admin | NOT LIVE PROVED | Button exists; test duplicate suppression with mocks, never live send. |
| U08 | Client portal > Account & history > Payments tab | client own invoice/payments `public/app/client-portal.html` | NOT LIVE PROVED | `src/http/portal-staff-payments.test.mjs` checks shape; read-only same-client and cross-client screens pending. |
| U09 | Portal: correct Commas checkout URL, balance and partial/refund entries | client owning invoice | NOT LIVE PROVED | Test active link preference; real PSP URL/provider receipt unavailable. |
| U10 | Portal payment tab empty/loading/offline/error, overdue partial + mobile | client | NOT LIVE PROVED | Browser specs/page screenshots needed for real current release. |
| U11 | Checkout receipt / payment-success: correct sale, no duplicate and proper return state | client/closer; PR #156 owns page | NOT LIVE PROVED | Coordinate with front-house agent; do not touch their page. |
| U12 | Closer Present > Invoice this client financial action and response | closer via sales workspace | NOT LIVE PROVED | Verify correct amount, contract, authorization and invoice row; front-end agent owns visual page. |
| U13 | CSM Collections task list: assignment, open, notes, callback, payment link, close | CSM | NOT LIVE PROVED | Existing AR-04 creates task, no actual CSM screen proof. |
| U14 | Funding advisor unallocated payment task: open, resolve, audit trail | funding_advisor | NOT LIVE PROVED | Source creates task, delivery and resolution state not yet proved. |
| U15 | Owner refund/dispute response task and audit trail | owner/admin | NOT LIVE PROVED | Source creates deadline-bearing task, role-only read/control unproved. |
| U16 | Pulse/ops finance totals: amount billed, amount received, open, aged, excluded demos | owner/admin/sales manager | NOT LIVE PROVED | PR #166 owns Pulse metrics; require same invoice/client figures and exact status. |
| U17 | Separate ledger views: sale installments vs funding success fees | owner/admin/sales manager | NOT LIVE PROVED | Verify money-chain payment kind and A/R view reconcile; don't double count. |
| U18 | Read/update permissions/tenant boundaries for invoice staff action | client/closer/setter/csm/manager/owner | NOT LIVE PROVED | Enumerate actual live POST controls first; unauthorized write tests isolated only. |
| U19 | No fictional clients or simulated receipts in production reports | all dashboards | NOT LIVE PROVED | Synthetic data only in test DB; check no contamination via authorized read-only snapshots. |
| U20 | All financial screens with mobile, tab, error, no items, stale data | all applicable roles | NOT LIVE PROVED | Playwright scenario matrix per available production/dev screen; no render-only PASS. |

## Test execution and current fix
- Isolated A/R branch: `audit/ar-invoice-source-guards-2026-10-28`. New authoritative invoice classification helper; source, org and client checks before each collection message; deposit/diagnostic payment skip; allocator invoice source check before receipt write and again under invoice lock; canonical invoice number. Eight in-memory regressions and 3 disposable Postgres regressions added.
- **Not yet green:** These new files require GitHub Actions/unit/real-Postgres CI and code review; a source change or PR does not count as merged/deployed or production verified.
- Unit evidence already present before this run: `src/workflows/ar-collections.test.mjs` (~30 scenarios), `src/invoices/invoices.pg.test.mjs` (real schema), `src/workflows/invoice-workflows.pg.test.mjs` (invoice-writing workflows), `src/http/read-invoices-handler.test.mjs`, `src/http/portal-staff-payments.test.mjs`. Each is partial proof only.
- Production live Supabase is already configured in the app. This agent has no Supabase-admin write session and will not ask for a replacement database; real-Postgres CI uses **throwaway GitHub Actions Postgres, not Supabase**.
- Initial deploy status: `main` head included ship metadata; latest `Ship to live` for that metadata commit was **skipped** on 2026-10-28. Never infer a deployment solely from a merge.
- **Completion condition:** all applicable rows above either have exact E2E PASS with clean role, provider receipt and cross-org proof or are reasoned N/A because feature is confirmed not live; only then mark signed off. Until then remain OPEN.
