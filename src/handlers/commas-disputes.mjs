/* Disputes and refunds — what happens after money that already moved is
 * called back into question.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A DISPUTE IS A TASK AND NOT A LEDGER ENTRY.
 *
 * A chargeback has a RESPONSE DEADLINE. Commas sends it as `data.due_by`. Miss
 * it and the dispute is lost by default — not judged and lost, just forfeited,
 * with the money gone and a fee on top. That deadline is the entire reason
 * this handler exists: the one thing that must not happen is a dispute sitting
 * in an events table that nobody reads until after the date has passed.
 *
 * So the dispute becomes a task, owned by a named role, with `due_at` set from
 * the provider's own deadline.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS DELIBERATELY DOES NOT DO: TOUCH THE MONEY.
 *
 * No reversal, no clawback, no commission adjustment, for either a refund or a
 * dispute. That is not an oversight and it is not laziness.
 *
 *   * A REFUND and a CHARGEBACK are different events with different
 *     accounting. A refund is a decision we made; a chargeback is one made
 *     against us and may still be won.
 *   * Whether a closer's commission is clawed back when a client is refunded
 *     is a POLICY QUESTION with real consequences for someone's pay. It has
 *     not been decided. src/commissions/commission-model-open-questions.md is
 *     where that decision belongs.
 *   * A dispute is not final. Reversing the ledger on `dispute.created` and
 *     then winning the dispute would leave the books wrong in the other
 *     direction, and nothing here would ever put them back.
 *
 * Guessing any of that in an event handler would silently rewrite somebody's
 * pay, and nobody would find out until payroll. The events are recorded, the
 * work is assigned to a person, and the money waits for a decision.
 */

import { createTask } from "../lib/create-task.mjs";
import { findClient } from "./purchase-routing.mjs";
import { on } from "../events/registry.mjs";

/* Who owns a chargeback response. The owner, not an advisor: responding needs
   the payment processor login and the contract, and getting it wrong costs the
   full amount plus a fee. */
export const DISPUTE_ROLE = "owner";
export const REFUND_ROLE = "owner";

const money = (amount) =>
  amount == null || Number.isNaN(Number(amount))
    ? "an unknown amount"
    : `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* parseDueBy — the provider's deadline, or null.
 *
 * NULL IS NOT A DEFAULT DATE. If Commas sends no deadline, or sends one we
 * cannot read, the task is created with no due date rather than a guessed one.
 * A made-up deadline is worse than none: an invented date that is later than
 * the real one reads as "there is time" right up until the dispute is lost. */
export function parseDueBy(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* Existing-payer resolution for refunds and chargebacks. Never lead-capture.
 * The succeeded transaction's provider reference is stronger evidence than
 * an email or client ID echoed on a late refund/dispute callback.
 * A same-org, same-payment original receipt wins. If none exists, permit only
 * an already-existing same-org customer; otherwise route the event to the
 * event bus dead-letter queue for manual investigation, not a phantom CRM row. */
export async function knownReversalClient(db, event) {
  if (!event?.orgId) return null;
  const ref = event.payload?.paymentId || event.payload?.providerRef || null;
  if (ref) {
    const original = await db.query(
      `SELECT t.client_id
         FROM transactions t
         JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
        WHERE t.org_id = $1 AND t.provider_ref = $2
          AND t.status = 'succeeded'
        LIMIT 1`,
      [event.orgId, String(ref)]
    );
    if (original.rows[0]?.client_id) return original.rows[0].client_id;
  }
  return findClient(db, event);
}

function requireReversalClient(event, clientId) {
  if (clientId) return clientId;
  // Throwing here preserves the canonical event in the bus failure/DLQ path.
  // A false success would bury a time-sensitive dispute with no owner task.
  throw new Error(`[commas-disputes] unowned ${event?.name || "reversal"} event needs manual reconciliation`);
}

/* onPaymentDisputed — the deadline-bearing one.
 * If no owned original payer can be found, deliberately fail to dead-letter
 * review rather than invent a client and claim the dispute has an owner. */
export async function onPaymentDisputed(event, db) {
  const p = event?.payload || {};
  const dueAt = parseDueBy(p.dueBy);
  const clientId = requireReversalClient(event, await knownReversalClient(db, event));

  const deadline = dueAt
    ? `Respond by ${dueAt.toISOString().slice(0, 10)}.`
    : "NO DEADLINE WAS SUPPLIED by the processor — check the Commas dashboard for the response date before assuming there is time.";

  const title = `URGENT — payment disputed: ${money(p.amount)}${p.productName ? ` (${p.productName})` : ""}`;

  return createTask(db, {
    orgId: event.orgId,
    clientId,
    title,
    sourceWorkflow: "commas-dispute",
    assigneeRole: DISPUTE_ROLE,
    eventId: event.id,
    dueAt,
    body: [
      `A chargeback was opened against ${money(p.amount)}.`,
      p.email ? `Customer: ${p.email}.` : null,
      p.paymentId ? `Commas payment id: ${p.paymentId}.` : null,
      deadline,
      "Missing the deadline forfeits the money automatically. The ledger has NOT been adjusted — do that only once the dispute is resolved."
    ].filter(Boolean).join(" ")
  });
}

/* onPaymentRefunded — no deadline, but still a person's decision.
 *
 * A refund is recorded and surfaced. It does not reverse commission, because
 * whether it should is undecided — see the header. */
export async function onPaymentRefunded(event, db) {
  const p = event?.payload || {};
  const clientId = requireReversalClient(event, await knownReversalClient(db, event));

  return createTask(db, {
    orgId: event.orgId,
    clientId,
    title: `Refund issued: ${money(p.amount)}${p.productName ? ` (${p.productName})` : ""}`,
    sourceWorkflow: "commas-refund",
    assigneeRole: REFUND_ROLE,
    eventId: event.id,
    body: [
      `${money(p.amount)} was refunded.`,
      p.email ? `Customer: ${p.email}.` : null,
      p.paymentId ? `Commas payment id: ${p.paymentId}.` : null,
      "Commission and entitlements were NOT adjusted — clawback policy is undecided (src/commissions/commission-model-open-questions.md)."
    ].filter(Boolean).join(" ")
  });
}

/* expired / canceled get NO handler, on purpose.
 *
 * They are abandoned checkouts. Creating a task for every checkout somebody
 * closed the tab on would bury the disputes that actually need answering. The
 * events are on the bus and in the events table for anyone counting
 * abandonment; nothing is asked of a person. */

export function register() {
  on("payment.disputed", onPaymentDisputed);
  on("payment.refunded", onPaymentRefunded);
}

export default register;
