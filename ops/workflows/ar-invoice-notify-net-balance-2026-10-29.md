# A/R payment-demand email uses net unpaid balance — A49 evidence

**2026-10-29 UTC.** Dedicated A/R lane; change proposed, NOT LIVE PROVED. The main acceptance matrix is concurrently edited by A/R evidence PR #218; do not overlap its file.

## Source-level reproduction
`src/invoices/notify.mjs` previously allowed `partially_paid` invoices into the email queue but rendered `{{invoice.amount}}` from the immutable original `invoices.amount_due`. The deployed `INVOICE-SENT-EMAIL` template prints that amount in BOTH subject and body. Example: issued $1,000 invoice with a $400 already-applied payment would send a $1,000 amount demand instead of $600. This is a reachable code defect, **not evidence** that any real customer received an incorrect email.

There was also a distinct stale-state risk: an invoice still labelled `sent` could already have a full $1,000 in `invoice_payments` while its paid status update lagged; a manual resend or backlog email could still queue another demand.

## Targeted change
- Keep `invoices.amount_due` immutable at $1,000; use the canonical immutable receipt ledger (`remainingDueCents`) to calculate the actual $600 due.
- Render `invoice.amount` in subject and body as $600 for partially paid invoices, never $1,000. Other uses of `invoiceContext` remain backward-compatible.
- Refuse the send with `no_balance` if canonical receipt rows already settle the debt, even when invoice status still says `sent` or `partially_paid`. Refuse unknown balances rather than guess.
- Add injectable *test-only* `drainOutbox` fake so the PG test exercises real queued messages without transmitting email. Real callers keep default production drain.
- Test partial receipt → one message with the exact remaining amount, same-purpose replay → no second message/drain, final receipt plus stale status → zero new demands, unchanged original invoice amount.

## Safety and proof
- New PG test requires `CI=true`, loopback `DATABASE_URL` and database path `/fundhub_ci`; all synthetic plus-tag rows roll back.
- No live Supabase writes, synthetic production accounts, Commas charges/refunds, email/SMS, or staff actions.
- Full 14 GitHub Actions checks and protected merge required before release. Provider outbox-delivery receipt, actual read-only client billing screen, and production deployment commit remain **NOT LIVE PROVED** after CI alone.
- Remaining race: if an invoice is settled **after** its email is already queued but **before** provider drain, delivery-time outbox suppression must be verified separately; this patch only prevents stale amounts at queue creation and already-settled ledger states.
