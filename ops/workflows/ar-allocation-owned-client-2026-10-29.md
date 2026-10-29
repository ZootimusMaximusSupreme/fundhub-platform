# A/R: Invoice buyer tenant guard for merchant receipt allocation

**2026-10-29 — isolated A/R lane. Status: source-reproduced risk / fix proposed; NOT LIVE PROVED.**

## Source-level failure
`invoices.client_id` references a real `clients(id)` but the legacy FK does **not** require `clients.org_id = invoices.org_id`. A contradictory invoice for org A pointing to org B's client can pass receipt allocation when a signed provider event supplies an org and invoice/session but no customer locator. Before the patch, the allocator checked that the event org/client agreed with the **invoice columns**, not the actual client's organization, and could insert `invoice_payments`, flip status to paid, or acknowledge replay on such an invoice. Even if such an invoice arose upstream, money must not be allocated across that boundary. No actual customer incident or provider receipt is established by this source finding.

## Narrow fix
`src/invoices/allocate.mjs` requires an existing buyer owned by the invoice organization before allocating, inside the locked allocation transaction, and before acknowledging a prior receipt on replay. An inconsistent buyer raises `ar_invoice_buyer_not_owned_by_org` so the signed event can enter retry/dead-letter rather than being silently acknowledged as paid or attached to a foreign client task. No mutation of clients, contracts, balances, or payment provider accounts occurs in the guard.

`allocate-owned-client.pg.test.mjs` runs **only** when `CI=true`, `DATABASE_URL` is loopback, and its database is exactly `/fundhub_ci`. All synthetic plus-tag customers and invoices belong to a transaction that rolls back. It exercises a contradictory invoice-only receipt, valid same-org partial payment, replay of a contradictory prior receipt, and a conflicting checkout path. It must run in the disposable PostgreSQL Actions shard, not Supabase. No provider, email or SMS is contacted.

## Merge and evidence requirements
Only A/R's allocator, new isolated PG regression and this document change in this PR. No edits to the active fulfillment, front-house, or A/R evidence PR #240 files. Require full green PR CI, protected merge, exact-main deployment and read-only production/merchant reconciliation. A passing synthetic PG test is **not** proof of merchant receipt or live client invoice accuracy. Follow-up A/R matrix item after #240 merges. Fulfillment owns upstream prevention of contradictory invoice creation; this patch is independent downstream defense.
