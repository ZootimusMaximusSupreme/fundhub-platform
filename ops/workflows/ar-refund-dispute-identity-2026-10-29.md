# A/R independent evidence — refund and dispute identity

**October 29, 2026 UTC — proposed change, NOT LIVE PROVED.** This note is
separate from the dedicated A/R matrix because active A/R PR #216 currently owns
`ops/workflows/accounts-receivable-e2e-2026-10-28.md`. Reconcile the findings
into that board as A48 / A30–A31 after #216 is merged; do not edit an active PR file.

## Source-reproduced defect

A refund or dispute is a **reversal of an existing payment**, never permission to
create a new lead. On the live `src/adapters/commas.mjs` baseline,
`processCommasInboxRow()` sets `mayCreate=true` for `payment.refunded` and
`payment.disputed` because neither was included in
`NO_HANDLER_CREATES_A_CLIENT`. For an unfamiliar email, `resolveInboxClientId`
called `resolveClient`, which can INSERT a customer and initiate CRM linkage.
In addition, `src/handlers/commas-disputes.mjs` called `resolveClient` again:
a direct bus replay with a foreign `clientId` could patch contact details
before any same-organization ownership check. The resulting owner task could
point to the wrong buyer. This is **source evidence of a reachable path**, not
evidence of a real merchant dispute or real incident.

## Proposed acceptance rows

| ID | Scenario | Expected source of truth | Proposed outcome | Verdict |
| --- | --- | --- | --- | --- |
| A48a | Unknown email on signed refund/dispute provider event | Original same-org succeeded Commas transaction, or unresolved | Adapter records unattributed event; creates no new client, CRM contact, or task on another buyer | FAIL BASELINE / FIX PROPOSED / NOT LIVE PROVED |
| A48b | Webhook supplied a wrong same-org buyer/email but original PSP payment ID matches | `transactions(org_id,provider_ref,status='succeeded')` joined to owned client | Owner task points to original transaction's client, not event's claimed buyer; original amount/status unchanged | FAIL BASELINE / FIX PROPOSED / NOT LIVE PROVED |
| A48c | Foreign or nonexistent buyer ID; unknown PSP payment | Original same-org succeeded Commas transaction absent | No client mutation or cross-tenant task; event handler fails into durable dead-letter review rather than acknowledging a completed owner task | FAIL BASELINE / FIX PROPOSED / NOT LIVE PROVED |
| A48d | Duplicate same dispute event / distinct refund on same PSP ID | Processor ID + canonical event ID, `tasks` unique key | One urgent owner task with exact deadline per dispute event, distinct refund task allowed; no automatic ledger clawback | NOT LIVE PROVED |
| A48e | Live dispute provider deadline/receipt, merchant dashboard, named-owner queue | Read-only provider receipt and production task with same org/client/PSP reference | Explicit owner acknowledgment and deadline visible; any unresolved callbacks appear in monitored dead-letter queue | NOT LIVE PROVED |

## Engineering changes and tests in this branch

- A/R-only files: `src/adapters/commas.mjs`,
  `src/handlers/commas-disputes.mjs`, their focused tests, and a new
  `commas-disputes-owned-client.pg.test.mjs`. No shared front-house, fulfillment
  or `src/invoices/allocate.mjs` (#216) edits.
- The adapter no longer lead-creates clients for refunds/disputes (it continues
  to do so for eligible, actually successful first-time payment events).
- The owner task handler **requires** the original succeeded Commas
  transaction in the same organization. An event's claimed email/ID can never
  substitute for a missing original receipt. Unknown/foreign events enter bus
  dead-letter review, with no new buyer, cross-org task, money reversal or
  commission clawback.
- Focused in-memory fixture covers signed webhook -> inbox -> canonical event,
  original payment ownership, duplicate event, unmatched email and foreign ID.
  Rollback-only, local-`fundhub_ci` PostgreSQL fixtures cover real
  `transactions` and `tasks` writes; they refuse any production DB URL.
- Required release: all **14 GitHub Actions** checks green, protected merge,
  subsequent successful `main` ship, and read-only PSP/task-provider matching.
  Until those receipts exist, **not a full A/R PASS**.

## Financial boundaries preserved

No refund, dispute or pending chargeback automatically posts a negative
invoice receipt, cancels an entitlement, changes commission or writes off debt.
Those policies must remain explicitly authorized and reconciled. Fee-basis
(A05) remains a separate cross-lane discrepancy: a lender approval does not
prove received funding. No production writes, SMS/email, refunds or processor
requests were made in this audit.
