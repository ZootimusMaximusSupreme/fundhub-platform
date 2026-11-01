# A/R staff finance list: invoice buyer ownership boundary

**Lane:** Accounts Receivable only. **Date:** 2026-10-29. **Status:** source-reproduced risk; proposed code/test fix, NOT LIVE PROVED.

## Control A57 / U01–U04, U16

**Visible action:** Ops & Admin > AR > open/all invoices, paging and row details.
**Access:** finance roles owner/admin/sales_manager; setter/closer/client unauthorized.
**Backend source:** `GET /api/read/invoices` in `api/read/invoices.mjs`.
**Canonical data:** `invoices(org_id, client_id, amount_due)` -> `v_invoice_aging`, `clients(org_id, client_code)`, `invoice_payments`.
**Expected:** A finance user in org A can see only A's genuinely owned invoices, their unpaid balance and aging, never a buyer or client code from org B.
**Actual before patch, source proof:** migration 017 makes `invoices.client_id` reference `clients(id)` without checking org; migration 031's `v_invoice_balance` joins client by ID alone and supplies `client_code`. The finance list scopes `v.org_id=A` but used a *LEFT* join of client scoped to A, so a contradictory `invoices.org_id=A, invoices.client_id=B-buyer` still appeared in A's finance list with the B buyer UUID, client code and inflated A/R amount; the client name merely appeared NULL. This is a code-level risk, **not evidence of an existing production incident**.
**Proposed guard:** require a same-org buyer row through an INNER JOIN on `c.id=v.client_id AND c.org_id=v.org_id`. Preserve the existing role gate, session-org filter, demo suppression, partial-payment balances and oldest-first ordering. Export exact SQL for test execution; no underlying balances are changed.
**Focused regression:** `src/http/read-invoices-owned-client.pg.test.mjs` creates two synthetic organizations and plus-tag buyers, an A/$125 issued invoice, an inconsistent A/$999 invoice pointing to B's buyer, and a legitimate B/$600 invoice. Execute the **exact production SQL** against GitHub Actions disposable localhost `/fundhub_ci`, assert A sees only $125 in open and all, and B sees only $600. `CI=true` and loopback URL required, `BEGIN/ROLLBACK`, no outside sends.
**Current verdict:** **FAIL baseline / fix proposed / NOT LIVE PROVED** pending 14/14 required CI, protected merge, exact main production ship, read-only finance role-screen verification and ledger/provider reconciliation.
**Residual issue:** the shared `v_invoice_balance` view's unscoped client join and other consuming reports may still leak or count misbound invoices; producer-side org/client/sale/round integrity is a separate fulfillment/F-07 gate. Do not rewrite view schema, alter production data, or edit another lane's files without coordinated migration. An excluded inconsistent invoice must be surfaced through an authorized owner-only reconciliation check, not silently treated as settled or written off.
**Production safety:** no real Supabase write, customer, processor charge/refund, message send, secret or source contract change. This patch filters read-only staff results.
