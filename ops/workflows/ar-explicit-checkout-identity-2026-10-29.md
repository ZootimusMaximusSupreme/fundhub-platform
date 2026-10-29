# A/R checkout-link conflict: explicit ID must be authoritative (2026-10-29)

**Lane:** Accounts receivable only. **Scope:** `src/invoices/allocate.mjs` provider receipt to success-fee invoice allocation. **State:** FAIL BASELINE, proposed isolated repair; **NOT LIVE PROVED** until all required CI, protected merge, main deployment and authorized read-only merchant/invoice reconciliation.

## Reproduced source path
Before this change, `findByPaymentLink({ paymentLinkId, ref })` queried the explicit `paymentLinkId` under the event org but, if the ID was unknown or belonged to another org, silently retried using `ref`. When a receipt carried a foreign checkout ID plus the valid local `link_ref`, the fallback returned the local invoice. An otherwise well-formed event could therefore credit that local invoice despite internally contradictory payment metadata. The same fallback was reachable in `replayIdentityMatches`, which could mark a contradictory PSP replay successful rather than routing it to manual review. This is a deterministic code-level risk, **not proof of an actual production incident**.

## Targeted change and acceptance
An explicit payment-link ID now either resolves inside the current org or returns null; `ref` is a fallback only when no explicit checkout ID was supplied. Existing `allocatePayment` handling rejects the wrong ID with `invoice_mismatch` before recording a payment; conflicting PSP-ID replays produce `receipt_reference_mismatch` and the original same-org invoice owner's review task.

Rollback-only disposable PostgreSQL regression file `src/invoices/allocate-checkout-id.pg.test.mjs` exercises:
1. Foreign checkout ID + valid local link ref + valid local invoice ID must credit neither invoice.
2. Same contradictory metadata on a previously valid payment ID must be refused as a replay and produce one original-buyer review task.
3. Matching local checkout ID/ref allows one partial payment and a safe idempotent replay.

**No test data may run on Supabase:** execution is restricted to `CI=true`, `DATABASE_URL` loopback and path `/fundhub_ci`; test inserts are inside an explicit rollback-only transaction. No Commas charges, provider receipts, emails, SMS, real clients or production changes. No shared money-chain handler edits; fulfillment agent owns round-funded source-contract fixes.

## Remaining gates
- Full 14/14 GitHub CI including real disposable PostgreSQL and browser checks: **NOT LIVE PROVED** until successful.
- Protected merge into main and successful main production Ship for exact SHA: **NOT LIVE PROVED**.
- Authorized read-only Commas receipt ↔ local invoice/link ↔ client/tenant/amount, customer Payments tab and finance exception queue: **NOT LIVE PROVED**.
- Reconcile with main A/R matrix (A51 proposed) once active docs-only PR #225 finishes to avoid simultaneous editing of that board. All other existing matrix gaps remain open.
