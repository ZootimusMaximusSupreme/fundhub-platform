// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7) — fee timing. The money for a
// self-serve round has landed. This handler records it and stages the work.
//
// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT STAGES THE MAIL. IT DOES NOT SEND IT.
//
// This is the file most likely to be edited into breaking that rule, so it is
// stated here as well as in the module it calls. src/metro2/delivery/send.mjs:3
// and api/repair/send.mjs:3 both forbid mailing from payment.received, in those
// words. What this handler does on a paid round is:
//
//   1. mark the request `paid`, and
//   2. ORDER A FRESH REPORT and put the round on a human's board (`staged`).
//
// It imports no mail function. It emits no event a mailer listens for. There
// are no letters to mail at this point in any case — they are built from the
// report that has only just been ordered. A staff member presses send in the
// existing screen, afterwards, as they always have.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THIS IS A SEPARATE HANDLER AND NOT A BRANCH IN money-chain
//
// src/handlers/money-chain.mjs already owns payment.received: it writes the
// sale, the transaction and the commissions, and it calls
// grantFromTransaction() (:654) for entitlements. ENTITLEMENTS ARE ITS JOB AND
// STAY ITS JOB — this file does not grant anything, does not call
// grantFromTransaction, and does not invent a second unlock path. That is the
// brief's instruction and it is also the only way the two cannot disagree.
//
// This handler is registered AFTER money-chain, so by the time it runs the
// transaction row and any entitlement grant already exist. Handler order on the
// bus is registration order (src/register-all.mjs), and the bus catches per
// handler, so a failure here cannot roll back the money chain.
//
// ═══════════════════════════════════════════════════════════════════════════
// HOW IT KNOWS THE PAYMENT IS FOR A ROUND
//
// It ignores every payment that does not name a paid_service_requests row.
// src/paid-services/checkout.mjs mints the session with metadata
// { link_ref: <request id>, ... } and src/adapters/commas.mjs:237-246 reads that
// bag back out as `payload.ref`. So the reference is the row id, and a payment
// for anything else carries a `pl_…` link ref or nothing at all and is skipped.
//
// THE AMOUNT DOES NOT FIND THE ROW, BUT IT IS CHECKED ONCE THE ROW IS FOUND.
// Two different things, and an earlier version of this comment ran them
// together. Matching a payment to a request BY its dollar amount would attach a
// client's unrelated $100 payment to a round they never asked for, so the
// lookup is the id or nothing. But after the id has found the row,
// recordPayment() compares the amount the processor stated against the amount
// the client was billed and REFUSES a short one — `payment_short`, nothing
// staged, no pull ordered. Before that guard existed a webhook reporting one
// cent against a $110 round staged the work for real.
//
// ORG IS CHECKED, NOT ASSUMED. The reference arrives from outside, so the row
// is loaded WITH the event's org id. A reference naming another tenant's
// request finds nothing.

import { on } from "../events/registry.mjs";
import { recordPayment, stageRound, SERVICE_KIND } from "../paid-services/round.mjs";
import { fulfillPaidBlueprintHelp } from "../blueprint/client-services.mjs";
import { createTask } from "../lib/create-task.mjs";
import { REFUSAL } from "../paid-services/refusals.mjs";

export const SKIPPED = "[paid-service] skipped";
export const STAGED = "[paid-service] round staged, not mailed";

/** uuid shape only — a `pl_1a2b…` payment-link ref is not one of ours here. */
function asUuidOrNull(v) {
  const s = v == null ? "" : String(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}

/** The paid_service_requests id this payment names, or null. */
export function requestIdFromEvent(event) {
  const p = (event && event.payload) || {};
  return asUuidOrNull(p.paidServiceRequestId)
    || asUuidOrNull(p.paid_service_request_id)
    || asUuidOrNull(p.ref)
    || null;
}

/** Integer cents from the event, or **null for unknown**. Never 0: a payment of
 *  zero and a payment whose amount we cannot read are different facts, and only
 *  one of them is a payment. */
export function paidCentsFromEvent(event) {
  const p = (event && event.payload) || {};
  const raw = p.amountCents ?? p.amount_cents ?? null;
  if (Number.isInteger(raw)) return raw;
  const dollars = p.amount ?? null;
  if (typeof dollars === "number" && Number.isFinite(dollars)) {
    return Math.round(dollars * 100);
  }
  return null;
}

/**
 * onPaidServicePaymentReceived — the whole of it.
 *
 * Returns `{ done, reason }` in the shape the other money handlers return, so a
 * dead-letter reader sees the same vocabulary.
 */
export async function onPaidServicePaymentReceived(event, db) {
  const requestId = requestIdFromEvent(event);
  if (!requestId) return { done: false, reason: "no_paid_service_ref" };

  const orgId = event?.orgId || null;
  const row = (await db.query(
    `SELECT * FROM paid_service_requests
      WHERE id = $1::uuid AND ($2::uuid IS NULL OR org_id = $2::uuid)`,
    [requestId, orgId]
  )).rows[0];

  if (!row) {
    // A reference that names nothing of ours. Not an error — most payments are
    // not for a paid service — but say so rather than returning a bare false.
    return { done: false, reason: "paid_service_request_not_found" };
  }

  const blueprintService = String(row.idempotency_key || "").startsWith("blueprint-help:");
  const paidClientId = event?.clientId || event?.payload?.client_id || null;
  const currency = event?.payload?.currency;
  if (blueprintService && (!orgId || !paymentRefOf(event) || paidCentsFromEvent(event) !== Number(row.price_total_cents)
    || (row.payment_ref && row.payment_ref !== paymentRefOf(event))
    || (paidClientId && String(paidClientId) !== String(row.client_id))
    || (currency && String(currency).toUpperCase() !== "USD"))) {
    if (orgId) {
      await db.query(`UPDATE blueprint_client_services SET state='needs_review',updated_at=now()
        WHERE id=$1 AND org_id=$2 AND state NOT IN ('in_progress','completed')`, [row.id, orgId]);
      await createTask(db, { orgId, clientId: row.client_id, assigneeRole: "csm",
        title: "Reconcile payment for a Blueprint service", sourceWorkflow: "blueprint-service-payment",
        eventId: `blueprint-service-payment:${row.id}`, detail: `Service ${row.id}: the callback did not match the saved quote or payment receipt. Review the provider's receipt before fulfillment.` });
    }
    return { done: false, reason: "blueprint_service_payment_mismatch" };
  }

  const payment = await recordPayment(db, {
    requestId: row.id,
    paymentRef: paymentRefOf(event),
    amountCents: paidCentsFromEvent(event),
    paidAt: paidAtOf(event)
  });

  if (blueprintService) {
    const fulfillment = await fulfillPaidBlueprintHelp(db, { requestId: row.id, orgId });
    return { done: fulfillment.ok === true, reason: fulfillment.reason || "blueprint_service_handoff", ...fulfillment };
  }

  if (!payment.applied) {
    /* MONEY ARRIVED AND IT WAS SHORT. recordPayment has already closed the
       request `failed` with both figures on the row. Logged at the same volume
       as the pull failure below and for the same reason: a sum has left a
       client's account and no work has started, so nobody should have to go
       looking for it. Nothing is staged. */
    if (payment.reason === REFUSAL.PAYMENT_SHORT) {
      console.warn(
        `[paid-service] round ${row.id} received ${payment.amountCents} of `
        + `${payment.pricedCents} cents (short by ${payment.shortfallCents}); `
        + "request closed failed, nothing staged"
      );
      return {
        done: false,
        reason: REFUSAL.PAYMENT_SHORT,
        requestId: row.id,
        shortfallCents: payment.shortfallCents,
        mailed: false
      };
    }
    /* A replayed webhook, or a request that has already moved on. Not a
       failure. The one case worth continuing on is a row that is already 'paid'
       but never staged — which is exactly what a crash between the two writes
       leaves behind, and the state a retry exists to repair. */
    if (payment.request?.status !== "paid") {
      return { done: false, reason: payment.reason || "not_applied" };
    }
  }

  if (row.service_kind !== SERVICE_KIND) {
    // Paid, recorded, and nothing to stage: a credit pull or a funding
    // application bought through the same table is fulfilled by its own path.
    return { done: true, reason: `paid_no_staging:${row.service_kind}` };
  }

  const staged = await stageRound(db, {
    requestId: row.id,
    orgId: row.org_id,
    clientId: row.client_id
  });

  if (!staged.ok) {
    /* THE PULL REFUSED AFTER THE MONEY LANDED. stageRound has already marked
       the request `failed` with the reason on the row, so a human can see it.
       Logged loudly because this is money taken for work that has not started,
       and it is the one outcome here nobody should have to go looking for. */
    console.warn(
      `[paid-service] round ${row.id} was paid but could not be staged: ${staged.reason || staged.detail || "unknown"}`
    );
    return { done: false, reason: staged.reason || "stage_failed", requestId: row.id };
  }

  return {
    done: true,
    reason: STAGED,
    requestId: row.id,
    softPullRequestId: staged.softPullRequestId || null,
    mailed: false
  };
}

function paymentRefOf(event) {
  const p = (event && event.payload) || {};
  const ref = p.paymentId ?? p.payment_id ?? p.transactionId ?? p.providerRef ?? p.provider_ref ?? null;
  return ref == null ? null : String(ref).slice(0, 200);
}

function paidAtOf(event) {
  const p = (event && event.payload) || {};
  const at = p.paidAt ?? p.paid_at ?? p.occurredAt ?? event?.occurredAt ?? null;
  if (!at) return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* register() — wired from src/register-all.mjs, which is NOT this lane's file.
   Until that one line is added this handler is inert: it is exported, tested
   and unreachable from the live bus. Said plainly here so nobody reads the
   presence of this file as proof the path runs in production. */
export function register() {
  on("payment.received", onPaidServicePaymentReceived);
}
