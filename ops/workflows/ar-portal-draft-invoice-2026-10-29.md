# A/R client portal — refuse draft invoice payment demand (2026-10-29)

**Lane:** independent A/R. **Status:** source-level FAIL reproduced; isolated fix proposed, full CI/production proof pending. **Production:** Fundhub is LIVE. No live DB/provider writes or customer sends authorized.

## Reproduction / contract

`GET /api/read/portal-summary` computes `invoice_due` from `v_invoice_aging`. Before this change the predicate was `org_id=$1 AND client_id=$2 AND open_balance>0`. A newly created **draft** invoice has the full amount open even though it has not been issued. The portal therefore could display the unissued bill as "Due now" and include it in the displayed total. A link created out of order could also be displayed whenever its saved state/amount matched. This is a **source-level risk**, not proof any real customer saw a draft.

The invoice writer, recipient email and receipt allocator already refuse draft payment/collection. The client-visible read must enforce the SAME issuance boundary. No product prices are assumed.

## Scenario matrix (synthetic CI only)

| Scenario | Actor/source | Invoice row and expected customer total | Baseline | Proposed behavior / proof |
| --- | --- | --- | --- | --- |
| Draft with positive balance | Authenticated client; `invoices.status=draft`, `v_invoice_aging` | $475 draft; **$0 due** and no pay link | FAIL (query included draft) | Exclude until sent; disposable Postgres exact production SQL |
| Sent unpaid alongside draft | Same client/org | $125 sent + $475 draft; **$125 due** | FAIL (would total $600) | Show only issued $125; SQL against two rows |
| Paid-but-stale balance | Same client/org | $210 status paid with no receipt in synthetic inconsistency; **not collectible** | FAIL baseline query could show | Exclude paid state regardless of computed balance |
| Different tenant's issued invoice | Foreign signed-in buyer / staff preview | $830 issued in company B; org A client must never see B data | Existing org/client scope | Retain both scoped predicates; 2-org PG test |
| Issued partial, reminder or escalation | Invoice owner | Show exact positive computed net due, not full face | Applicable | Status allowlist: sent/reminded/escalated/partially_paid; existing balance, link and demo guards preserved |

**Implementation:** export `PORTAL_INVOICE_DUE_SQL` as the exact query used by the live endpoint, keep the existing `org_id`/`client_id`, demo, positive balance and matched-Commas-pay-link restrictions, add an issued-only status allowlist. `src/http/portal-staff-payments.test.mjs` pins the status boundary; `src/http/portal-invoice-issued.pg.test.mjs` exercises real schema on GitHub Actions disposable loopback `/fundhub_ci`, synthetic plus-tag identities, one transaction with `ROLLBACK`, no payment-provider calls.

**Relevant board:** `ops/workflows/accounts-receivable-e2e-2026-10-28.md` items U08/U09 and new candidate A58. **Do not edit that matrix while A/R evidence PR #248 owns it.** After #248 is merged, independently update A58 with exact PR CI, main Ship and customer/pay-provider read-only receipts. CI success must never be counted as a live payment or portal screen observation.

## Still NOT LIVE PROVED

PR full CI, protected merge, exact main-to-production Ship, client/staff role-screen checkout status, genuine merchant receipt, credits/partial/return reconciliation, and the upstream F-07 **verified funded cash vs approval** fee basis. The latter is owned by the independent fulfillment lane; this PR does not edit fulfillment, money-chain, payment provider, portals' HTML, other agents' PR files or contracts.
