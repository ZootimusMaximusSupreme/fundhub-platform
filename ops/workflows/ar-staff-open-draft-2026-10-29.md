# A/R staff Open queue — exclude unissued invoice drafts (2026-10-29)

**Independent lane:** A/R, candidate A59/U01-U03/U16. **Production:** Fundhub is LIVE. **Verdict:** FAIL baseline by source query, FIX PROPOSED, NOT LIVE PROVED. Do not claim a real client was misbilled. No merchant/provider/customer/production database writes or messages are authorized.

## Source-level problem

`GET /api/read/invoices?status=open` drives Ops & Admin > AR > Open, the finance-owner/admin/sales_manager unpaid/oldest-first queue. The endpoint previously treated `v_invoice_aging.open_balance > 0` as enough for Open. Migration 031 computes that field as the invoice face value for a `draft` row before an invoice has been issued. As a result, a $475 **unissued** synthetic draft and a $125 **sent** synthetic invoice would both appear collectible in this queue ($600 total if added), even though the contractually payable balance represented there is $125. `paid` rows with inconsistent/stale payment-ledger state could also be visible while an outstanding positive balance remained in the view. This is a query-level reproduction, **not** an observed live finance-screen incident.

The **all-history** and explicit `?status=draft` finance reads must continue showing drafts for review; this fix does not delete or rewrite debt and does not change other product terms.

## Exact proposed control and synthetic proof

- **Role/action:** owner/admin/sales_manager only, Ops & Admin > AR > Open / All / draft selection. Setter, closer, CSM and client should not gain finance-list access. Staff UI proof still required.
- **Source-of-truth:** `invoices.status`, immutable `invoice_payments`, `v_invoice_aging.open_balance`, same-org `clients`, `invoices.is_demo`, session-bound organization. SQL in `api/read/invoices.mjs` (`AR_INVOICE_LIST_SQL`); authorization in `src/http/read-api.mjs`.
- **Fix:** when and only when the request is `status=open`, require positive `open_balance` **AND** an issued, unpaid status (`sent`, `reminded`, `escalated`, `partially_paid`). Keep the existing same-org buyer INNER JOIN, demo exclusion, paging, oldest-first sorting and all-history access.
- **Test:** `src/http/read-invoices-issued-only.pg.test.mjs` executes that exact SQL with organization A plus-tag buyer ($475 draft, $125 sent, $210 paid but intentionally stale ledger), and organization B plus-tag buyer ($830 sent). Expected A/Open: **one $125 row**, no draft/paid/other-tenant row. A/all: three rows; A/`draft`: $475 for internal authorized review. B/Open: only B's $830. The $475/$125/$210/$830 are **test fixtures, not prices offered to customers**.
- **Execution limit:** GitHub Actions disposable `localhost/fundhub_ci`, `CI=true`, `BEGIN/ROLLBACK`; no external provider, production Supabase, email, SMS, credit bureau or customer access. Handler-level unit regression also guards the issued-status requirement.

## CI and remaining work

**Pending:** all 14 mandatory checks (six without DB, six with disposable PostgreSQL, PG blocks and browser); protected PR merge; exact successful `main` production Ship; authorized read-only finance role/paging screenshot; live invoice/payment-provider receipt reconciliation; customer Payments tab comparison; suppression and collection notices; any legal/compliance approval.

**Boundary:** `v_client_ar_balance` also sums drafts into account-level receivable totals in migration 031. This PR is deliberately a narrow *staff Open list* display fix and does NOT prove dashboards/Pulse are fixed. That downstream financial-total inconsistency remains **NOT LIVE PROVED** and needs a separately reviewed migration or scoped query; never assume this PR repairs it. The client portal issued-state fix lives separately in A/R PR #261; that PR also needs canonical buyer-ownership proof before merge. Funding approval versus verified disbursement and success-fee timing remain the fulfillment lane's producer contract, not modified here.

**Coordination:** The A/R master matrix `ops/workflows/accounts-receivable-e2e-2026-10-28.md` is currently owned by open A/R PR #266. Do not edit it concurrently; record A59 in that matrix after #266 merges. Staff/client portal HTML, fulfillment, front-house, Blueprint and any other active agent PR files are untouched.
