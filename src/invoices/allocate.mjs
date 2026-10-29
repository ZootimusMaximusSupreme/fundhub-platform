// Allocate a payment.received to one success-fee invoice.
// COMPLIANCE REVIEW REQUIRED — payment rails.
//
// Owner 2026-08-23: a payment applies to the invoice for its own round.
// Not oldest-first. Do not guess. Do not spread leftover money to another invoice.
//
// Path 1 — invoice identity on the payment (metadata / payment_links / external_ref).
// Path 2 — oldest unpaid success_fee invoice for the funding_round_id on the payment.
// Path 3 — leave unallocated, staff task, every invoice untouched.
//
// Live counts for path 2 / path 3: grep Netlify logs for
//   [ar-allocate] path=round
//   [ar-allocate] path=unresolved
// No new metrics table.

import { toCents, fromCents } from "../commissions/money.mjs";
import { getInvoice, markPaid, announceInvoice } from "./index.mjs";
import { isFundingSuccessFeeInvoice } from "./success-fee-source.mjs";
import { createTask } from "../lib/create-task.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

// Only issued invoices are collectible. A receipt naming a draft must go to
// human review instead of silently paying a bill the customer was never sent.
const OPEN = ["sent", "reminded", "escalated", "partially_paid"];
const SOURCE = "ar-allocate";

/** Convert a known dollar amount to cents. NULL / blank stays NULL. */
export function knownCents(value) {
  if (value === null || value === undefined || value === "") return null;
  return toCents(value);
}

export async function paidOnInvoiceCents(db, invoiceId) {
  const r = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'payment' THEN amount ELSE -amount END), 0) AS paid
       FROM invoice_payments WHERE invoice_id = $1`,
    [invoiceId]
  );
  // Empty sum is 0 — "no payments yet", a real zero, not unknown.
  return toCents(r.rows[0]?.paid ?? 0);
}

export async function remainingDueCents(db, invoice) {
  if (!invoice) return null;
  const due = knownCents(invoice.amount_due);
  if (due === null) return null;
  return due - await paidOnInvoiceCents(db, invoice.id);
}

export function remainingDueAmount(remainingCents) {
  if (remainingCents === null) return null;
  return Number(fromCents(remainingCents));
}

async function findByProviderRef(db, { orgId, refs }) {
  const cleaned = [...new Set(refs.filter((v) => v != null && String(v).trim() !== "").map(String))];
  if (!cleaned.length) return null;
  const r = await db.query(
    `SELECT * FROM invoices
      WHERE org_id = $2 AND external_ref = ANY($1::text[])
      ORDER BY created_at ASC
      LIMIT 1`,
    [cleaned, orgId]
  );
  return r.rows[0] || null;
}

async function findByPaymentLink(db, { orgId, paymentLinkId, ref }) {
  if (paymentLinkId) {
    const r = await db.query(
      `SELECT invoice_id FROM payment_links
        WHERE id = $1 AND org_id = $2 AND invoice_id IS NOT NULL
        LIMIT 1`,
      [paymentLinkId, orgId]
    );
    // When a provider explicitly supplies a checkout ID, that ID is the
    // authority. A missing/foreign ID must never be rescued by a second
    // `ref` field that happens to point at a payable local invoice.
    // Otherwise contradictory checkout metadata could credit the wrong bill.
    const invoiceId = r.rows[0]?.invoice_id;
    if (!invoiceId) return null;
    if (ref) {
      // Both locators may be individually valid yet point at DIFFERENT same-org
      // invoices. Never silently prefer one and book the receipt to the wrong
      // sale. Unknown refs are allowed: some provider callbacks use non-link
      // reference strings; only a positively identified conflict is refused.
      const byRef = await db.query(
        `SELECT invoice_id FROM payment_links
          WHERE link_ref = $1 AND org_id = $2 AND invoice_id IS NOT NULL
          LIMIT 1`,
        [String(ref), orgId]
      );
      if (byRef.rows[0]?.invoice_id &&
          String(byRef.rows[0].invoice_id) !== String(invoiceId)) {
        return null;
      }
    }
    return getInvoice(db, { invoiceId });
  }
  if (ref) {
    const r = await db.query(
      `SELECT invoice_id FROM payment_links
        WHERE link_ref = $1 AND org_id = $2 AND invoice_id IS NOT NULL
        LIMIT 1`,
      [String(ref), orgId]
    );
    if (r.rows[0]?.invoice_id) return getInvoice(db, { invoiceId: r.rows[0].invoice_id });
  }
  return null;
}

async function findByRound(db, { orgId, clientId, fundingRoundId }) {
  if (!clientId || !fundingRoundId) return null;
  const r = await db.query(
    `SELECT * FROM invoices
      WHERE client_id = $1
        AND funding_round_id = $2
        AND org_id = $4
        AND (source = 'funding_success_fee' OR invoice_type = 'success_fee')
        AND status = ANY($3)
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [clientId, fundingRoundId, OPEN, orgId]
  );
  return r.rows[0] || null;
}

async function alreadyRecorded(db, { orgId, providerPaymentId }) {
  if (!orgId || !providerPaymentId) return null;
  const r = await db.query(
    `SELECT * FROM invoice_payments
      WHERE org_id = $1 AND external_ref = $2
        AND kind = 'payment' AND method = 'commas'
      LIMIT 1`,
    [orgId, String(providerPaymentId)]
  );
  return r.rows[0] || null;
}

// A legacy invoice may identify a buyer in a DIFFERENT organization: the
// invoices.client_id FK verifies client existence, not invoice/client tenant
// agreement. A provider receipt often carries no customer locator, so invoice
// identity alone cannot authorize a credit, replay, paid event or review task.
// Throw to retain the original signed event in retry/dead-letter rather than
// silently acknowledging an unallocated merchant payment.
async function requireInvoiceBuyerOwned(db, invoice) {
  if (!invoice?.org_id || !invoice?.client_id) {
    throw new Error("ar_invoice_buyer_not_owned_by_org");
  }
  const owned = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [invoice.client_id, invoice.org_id]
  );
  if (!owned.rows[0]) throw new Error("ar_invoice_buyer_not_owned_by_org");
}

function partialEventKey(invoiceId, paymentKey) {
  if (!paymentKey) throw new Error(`Partial invoice ${invoiceId} has no stable receipt identity`);
  return `invoice.partially_paid:${invoiceId}:${paymentKey}`;
}

async function replayRecordedPayment(db, prior) {
  const invoice = await getInvoice(db, { invoiceId: prior.invoice_id });
  // The receipt and status may have committed before the post-commit event
  // write failed. Announcing again is safe: invoice.paid is keyed by invoice ID.
  if (invoice?.status === "paid") await announceInvoice(db, "invoice.paid", invoice);
  if (invoice?.status === "partially_paid") {
    await announceInvoice(db, "invoice.partially_paid", invoice, {
      idempotencyKey: partialEventKey(invoice.id, prior.external_ref || prior.source_event_id || prior.id)
    });
  }
  return { done: true, replay: true, invoiceId: prior.invoice_id, path: "replay" };
}

// A provider payment ID is immutable. A replay may reannounce the original
// invoice event, but it cannot confirm somebody else's invoice or client.
async function replayIdentityMatches(db, prior, { orgId, clientId, hintedId, roundId, paymentLinkId, ref }) {
  const original = await getInvoice(db, { invoiceId: prior.invoice_id });
  if (!original || String(original.org_id) !== String(orgId)) return false;
  await requireInvoiceBuyerOwned(db, original);
  if (clientId && String(original.client_id) !== String(clientId)) return false;
  if (hintedId && String(original.id) !== String(hintedId)) return false;
  if (roundId && String(original.funding_round_id || "") !== String(roundId)) return false;
  if (paymentLinkId || ref) {
    const linked = await findByPaymentLink(db, { orgId, paymentLinkId, ref });
    // An explicit checkout ID must resolve inside this org. Otherwise the
    // envelope may be borrowing a different tenant's link while naming a
    // legitimate local invoice, including on a replayed PSP reference.
    if (paymentLinkId && !linked) return false;
    if (linked && String(linked.id) !== String(original.id)) return false;
  }
  return true;
}

async function conflictingReplay(db, { orgId, clientId, eventId, providerPaymentId, originalInvoiceId = null }) {
  // The original provider receipt, not an untrusted replay customer locator,
  // owns any review task. Never create a task on another tenant's client.
  const original = originalInvoiceId ? await getInvoice(db, { invoiceId: originalInvoiceId }) : null;
  const reviewClientId = original && String(original.org_id) === String(orgId)
    ? original.client_id : clientId;
  await staffTask(db, {
    orgId, clientId: reviewClientId, eventId,
    title: "Conflicting payment reference — review original receipt",
    body: providerPaymentId ? `receipt-conflict:${providerPaymentId}` : eventId
  });
  return { done: true, allocated: false, replay: false, reason: "receipt_reference_mismatch", path: "unresolved" };
}

async function insertPayment(db, { orgId, invoiceId, clientId, amount, externalRef, sourceEventId }) {
  const r = await db.query(
    `WITH payable AS (
       SELECT id FROM invoices
        WHERE id = $2 AND org_id = $1 AND client_id = $7
          AND status = ANY($6::text[])
        FOR UPDATE
     )
     INSERT INTO invoice_payments
       (org_id, invoice_id, kind, amount, method, external_ref, source_event_id)
     SELECT $1, payable.id, 'payment', $3, 'commas', $4, $5
       FROM payable WHERE true
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [orgId, invoiceId, amount, externalRef, sourceEventId, OPEN, clientId]
  );
  return r.rows[0] || null;
}

async function markPartiallyPaid(db, { invoiceId }) {
  const r = await db.query(
    `UPDATE invoices
        SET status = 'partially_paid'
      WHERE id = $1
        AND status = ANY($2)
     RETURNING *`,
    [invoiceId, OPEN]
  );
  return r.rows[0] || null;
}

async function staffTask(db, { orgId, clientId, eventId, title, body }) {
  if (!orgId || !clientId) return null;
  // The tasks table's client foreign key is not an org+client ownership check.
  // An untrusted receipt must not mint a review task for another company's buyer.
  const owned = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  if (!owned.rows[0]) return null;
  return createTask(db, {
    orgId,
    clientId,
    title,
    sourceWorkflow: SOURCE,
    assigneeRole: "funding_advisor",
    eventId,
    body
  });
}

/**
 * allocatePayment(db, event) — payment.received → one invoice, or none.
 *
 * Deposit / diagnostic / DIY payments with no invoice identity are skipped.
 * A success-fee payment that cannot be matched is left unallocated.
 */
export async function allocatePayment(db, event) {
  const payload = event.payload || {};
  const orgId = event.orgId;
  const clientId = event.clientId;
  const providerPaymentId = payload.paymentId || payload.providerRef || null;
  const hintedId = payload.invoiceId || payload.invoice_id || null;
  const roundId = payload.fundingRoundId || payload.funding_round_id || null;

  // Deposit and diagnostic receipts never pay a funding success fee, even if
  // their webhook accidentally carries a stale invoice identifier.
  if (["deposit", "diagnostic"].includes(String(payload.purpose || "").toLowerCase()) ||
      ["deposit", "diagnostic"].includes(String(payload.product || "").toLowerCase())) {
    return { done: true, skipped: true, reason: "not_invoice_payment" };
  }

  const replayContext = {
    orgId, clientId, hintedId, roundId,
    paymentLinkId: payload.paymentLinkId, ref: payload.ref
  };
  if (orgId && providerPaymentId) {
    const prior = await alreadyRecorded(db, { orgId, providerPaymentId });
    if (prior) {
      if (!await replayIdentityMatches(db, prior, replayContext)) {
        return conflictingReplay(db, { orgId, clientId, eventId: event.id, providerPaymentId, originalInvoiceId: prior.invoice_id });
      }
      return replayRecordedPayment(db, prior);
    }
  }

  let invoice = null;
  let path = null;

  if (hintedId) {
    invoice = await getInvoice(db, { invoiceId: hintedId });
    if (invoice) path = "provider_ref";
  }
  let linkedInvoice = null;
  if (payload.paymentLinkId || payload.ref) {
    linkedInvoice = await findByPaymentLink(db, {
      orgId,
      paymentLinkId: payload.paymentLinkId,
      ref: payload.ref
    });
  }
  // A payment naming an explicit checkout ID must actually own that link.
  // A foreign or unknown checkout cannot be ignored merely because the same
  // envelope also carries a perfectly valid local invoice ID.
  if (payload.paymentLinkId && !linkedInvoice) {
    return { done: true, allocated: false, reason: "invoice_mismatch", path: "unresolved" };
  }
  if (!invoice) {
    invoice = linkedInvoice;
    if (invoice) path = "provider_ref";
  }
  if (!invoice) {
    invoice = await findByProviderRef(db, { orgId, refs: [
      payload.providerRef,
      payload.itemId,
      payload.ref,
      payload.invoiceRef
    ] });
    if (invoice) path = "provider_ref";
  }

  if (!invoice && roundId) {
    invoice = await findByRound(db, { orgId, clientId, fundingRoundId: roundId });
    if (invoice) {
      path = "round";
      console.warn(`[ar-allocate] path=round invoice=${invoice.id} payment=${providerPaymentId || "none"}`);
    }
  }

  if (!invoice) {
    const looksLikeSuccessFee = payload.product === "success_fee" || hintedId || roundId;
    if (!looksLikeSuccessFee) {
      return { done: true, skipped: true, reason: "not_invoice_payment" };
    }
    console.warn(`[ar-allocate] path=unresolved payment=${providerPaymentId || "none"} client=${clientId || "none"}`);
    await staffTask(db, {
      orgId,
      clientId,
      eventId: event.id,
      title: "Unallocated payment — no matching invoice",
      body: providerPaymentId ? `unallocated:${providerPaymentId}` : event.id
    });
    return { done: true, allocated: false, reason: "unresolved", path: "unresolved" };
  }

  // A foreign-org invoice ID is an untrusted locator, never permission to
  // create a review task on that tenant's buyer or reveal invoice metadata.
  // Check BEFORE invoice source/type/status and before the task fallback.
  if (!orgId || String(invoice.org_id) !== String(orgId)) {
    return { done: true, allocated: false, reason: "invoice_mismatch", path: "unresolved" };
  }
  // Invoice org/client columns are not a tenant-ownership guarantee. Missing
  // owned buyer leaves the signed receipt for staff review in the event DLQ.
  await requireInvoiceBuyerOwned(db, invoice);

  // This allocator owns *only* funding success fees. A payment that names a
  // repair, DIY, deposit or other invoice must not write a success-fee receipt.
  if (!isFundingSuccessFeeInvoice(invoice)) {
    const likelySuccessFee = payload.product === "success_fee" || !!roundId;
    if (likelySuccessFee) {
      await staffTask(db, {
        orgId, clientId: invoice.client_id, eventId: event.id,
        title: "Unallocated payment — invoice is not a funding success fee",
        body: providerPaymentId ? `invoice-type:${providerPaymentId}` : event.id
      });
    }
    return {
      done: true, allocated: false, skipped: !likelySuccessFee,
      reason: "not_success_fee_invoice", invoiceId: invoice.id, path: "unresolved"
    };
  }

  const identityMismatch = !orgId || String(invoice.org_id) !== String(orgId)
    || (clientId && String(invoice.client_id) !== String(clientId))
    || (roundId && String(invoice.funding_round_id || "") !== String(roundId))
    || (linkedInvoice && String(linkedInvoice.id) !== String(invoice.id));
  if (identityMismatch || !OPEN.includes(String(invoice.status || ""))) {
    const reason = identityMismatch ? "invoice_mismatch" : "invoice_unavailable";
    console.warn(`[ar-allocate] path=unresolved reason=${reason} invoice=${invoice.id}`);
    await staffTask(db, {
      orgId,
      clientId: invoice.client_id,
      eventId: event.id,
      title: "Unallocated payment — invoice needs review",
      body: providerPaymentId ? `${reason}:${providerPaymentId}` : event.id
    });
    return { done: true, allocated: false, reason, invoiceId: invoice.id, path: "unresolved" };
  }

  const payCents = knownCents(payload.amount);
  if (payCents === null || payCents <= 0) {
    // Reversals and failed attempts are not payment.received credits.
    // Do not silently acknowledge a zero/negative receipt as a payment.
    const reason = payCents === null ? "unknown_amount" : "non_positive_amount";
    console.warn(`[ar-allocate] path=unresolved reason=${reason} invoice=${invoice.id}`);
    await staffTask(db, {
      orgId,
      clientId: invoice.client_id,
      eventId: event.id,
      title: "Unallocated payment — invalid receipt amount",
      body: providerPaymentId ? `${reason}:${providerPaymentId}` : event.id
    });
    return { done: true, allocated: false, reason, invoiceId: invoice.id, path: "unresolved" };
  }

  const result = await withTransaction(db, async (tx) => {
    // The lock spans the balance read, receipt insert, and invoice status.
    // A standalone FOR UPDATE statement would release its lock on autocommit.
    const locked = (await tx.query(
      `SELECT * FROM invoices WHERE id = $1 FOR UPDATE`,
      [invoice.id]
    )).rows[0];
    if (!locked || !OPEN.includes(String(locked.status || ""))) {
      return { reason: "invoice_unavailable" };
    }
    if (!isFundingSuccessFeeInvoice(locked)) return { reason: "invoice_kind_mismatch" };
    if (String(locked.org_id) !== String(orgId)
      || (clientId && String(locked.client_id) !== String(clientId))
      || (roundId && String(locked.funding_round_id || "") !== String(roundId))) {
      return { reason: "invoice_mismatch" };
    }
    // Re-check under the invoice lock; a buyer could have changed since the
    // initial read. This lookup makes no writes to client or provider rows.
    await requireInvoiceBuyerOwned(tx, locked);

    // Two webhook envelopes can carry the same Commas payment ID but different
    // event IDs. Both may pass the early replay lookup. Recheck only after the
    // invoice lock is ours, before reading the balance or inserting a receipt.
    // The matching unique index also protects a crossed-invoice race.
    if (providerPaymentId) {
      const prior = await alreadyRecorded(tx, { orgId, providerPaymentId });
      if (prior) return { reason: "replay", prior };
    }

    const dueCents = knownCents(locked.amount_due);
    if (dueCents === null) return { reason: "unknown_due" };
    const alreadyPaid = await paidOnInvoiceCents(tx, locked.id);
    const remaining = dueCents - alreadyPaid;
    const applyCents = Math.min(payCents, Math.max(remaining, 0));
    const surplusCents = payCents - applyCents;

    let inserted = null;
    if (applyCents > 0) {
      inserted = await insertPayment(tx, {
        orgId: locked.org_id,
        invoiceId: locked.id,
        clientId: locked.client_id,
        amount: fromCents(applyCents),
        externalRef: providerPaymentId,
        sourceEventId: event.id || null
      });
      if (!inserted) {
        const latest = await getInvoice(tx, { invoiceId: locked.id });
        const prior = providerPaymentId
          ? await alreadyRecorded(tx, { orgId, providerPaymentId })
          : null;
        return prior
          ? { reason: "replay", prior }
          : { reason: !latest || !OPEN.includes(String(latest.status || ""))
            ? "invoice_unavailable" : "replay" };
      }
    }

    const newRemaining = remaining - applyCents;
    let paidRow = null;
    let partialRow = null;
    if (newRemaining <= 0 && applyCents > 0) {
      paidRow = await markPaid(tx, { invoiceId: locked.id });
      if (!paidRow) throw new Error(`Could not settle invoice ${locked.id} after recording its receipt`);
    } else if (applyCents > 0) {
      partialRow = await markPartiallyPaid(tx, { invoiceId: locked.id });
      if (!partialRow) throw new Error(`Could not mark invoice ${locked.id} partially paid after recording its receipt`);
    }
    return {
      applyCents, surplusCents, newRemaining, paidRow, partialRow,
      receiptKey: providerPaymentId || event.id || inserted?.id || null
    };
  });

  if (result.reason === "replay") {
    // Repeat the identity check after the invoice row lock: a concurrent
    // envelope may have recorded this PSP reference against another invoice.
    if (result.prior && !await replayIdentityMatches(db, result.prior, replayContext)) {
      return conflictingReplay(db, { orgId, clientId, eventId: event.id, providerPaymentId, originalInvoiceId: result.prior.invoice_id });
    }
    return replayRecordedPayment(db, result.prior || {
      invoice_id: invoice.id, external_ref: providerPaymentId, source_event_id: event.id
    });
  }
  if (result.reason) {
    const reason = result.reason;
    console.warn(`[ar-allocate] path=unresolved reason=${reason} invoice=${invoice.id}`);
    await staffTask(db, {
      orgId,
      clientId: invoice.client_id,
      eventId: event.id,
      title: reason === "unknown_due"
        ? "Unallocated payment — invoice amount unknown"
        : "Unallocated payment — invoice changed before allocation",
      body: providerPaymentId ? `${reason}:${providerPaymentId}` : event.id
    });
    return { done: true, allocated: false, reason, invoiceId: invoice.id, path: "unresolved" };
  }

  const { applyCents, surplusCents, newRemaining, paidRow, partialRow, receiptKey } = result;
  if (paidRow) await announceInvoice(db, "invoice.paid", paidRow);
  if (partialRow) {
    await announceInvoice(db, "invoice.partially_paid", partialRow, {
      idempotencyKey: partialEventKey(partialRow.id, receiptKey)
    });
  }
  const settled = !!paidRow;

  if (surplusCents > 0) {
    console.warn(`[ar-allocate] path=overpay surplus_cents=${surplusCents} invoice=${invoice.id}`);
    await staffTask(db, {
      orgId,
      clientId: invoice.client_id,
      eventId: event.id,
      title: "Overpayment leftover — do not apply to another invoice",
      body: providerPaymentId ? `overpay:${providerPaymentId}` : event.id
    });
  }

  if (applyCents <= 0 && surplusCents > 0) {
    return {
      done: true,
      allocated: false,
      reason: "already_settled",
      invoiceId: invoice.id,
      path,
      surplusCents
    };
  }

  return {
    done: true,
    allocated: applyCents > 0,
    invoiceId: invoice.id,
    path,
    appliedCents: applyCents,
    surplusCents,
    remainingCents: newRemaining,
    settled
  };
}
