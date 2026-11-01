// F-07 — Funding Locked (F22).
// Source: the CRM workflow 992e1734-3d5b-4d51-91cb-7b665650f407 (the CRM source-of-truth export).
// Audit fix applied: real ready-to-paste SMS + email-subject copy (the FR22 "Total
// Funding Locked" body from EMAIL-TEMPLATES-SOURCE-OF-TRUTH.md, grepped for this one
// key only), seeded via src/workflows/templates-seed.mjs.
//
// Trigger: round.funded (F22 "Funding Locked" is the funded-round terminal stage).
// Gate: a confirmed approved total AND an agreed fee percent. Both or neither.
//
// ── THE BUG THIS FILE CARRIED, AND WHAT IT COST ────────────────────────────
// This handler required `feePercent` on the event before it would invoice, and
// nothing ever put `feePercent` on the event. Card Stacking's emitter did not
// (src/funding/card-stacking-rounds.mjs) and neither did the Lendflow adapter.
// So EVERY funded round fell into the not-ready branch below: a tag, a task
// reading "Fix fee lock/percent before invoicing", and no invoice, no email, no
// SMS. No client has ever been billed automatically. The emitter now carries
// the fee percent, the confirmed approved total, and the sale/round ids.
//
// ── THE FEE BASIS — SETTLED (owner-set 2026-08-30) ─────────────────────────
// The old FLAG here asked whether `approvedAmount` was the funded base or the
// fee itself. It is the base, and the base is CONFIRMED APPROVALS. Chris:
// "Approved is correct... make sure we bill based on confirmed approvals."
//
//   feeAmount = confirmed approved total × agreed fee percent
//
// CRM's "Commission Owed" field copy is still not ported, and still should not
// be: it set Commission Owed = total_approved_amount with no multiplication
// anywhere in the crawl. Under this decision the formula is defined in
// src/funding/success-fee.mjs and nowhere else, and it is that module — not a
// field copy from a dead CRM — that both this workflow and the closeout record
// read. Logged in workflow-migration-table.md.
//
// A round with nothing confirmed, or a client whose sale agreed no rate, gets a
// NAMED REFUSAL and a task for a person. It never gets a $0 invoice.
//
// COMPLIANCE REVIEW REQUIRED: fee basis.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
// This is downstream paid-fulfillment activity, never a new lead capture.
// Only already-existing clients owned by this event's org may be changed;
// resolveClient could patch an explicit foreign ID or mint an unknown email.
import { findClient } from "../handlers/purchase-routing.mjs";
import { sendTemplated } from "./messaging.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { addTags } from "./tags.mjs";
import { createInvoice, successFeeKey, markSent, announceInvoice } from "../invoices/index.mjs";
import { createTask } from "../lib/create-task.mjs";
import {
  resolveSuccessFee,
  successFeeCents,
  amountOrNull,
  REFUSAL_TEXT,
  NO_CONFIRMED_APPROVALS,
  NO_AGREED_FEE_PERCENT
} from "../funding/success-fee.mjs";
import { fromCents } from "../commissions/money.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-F07-FUNDING-LOCKED";
export const SMS_TEMPLATE_KEY = "SMS-F07-FUNDING-LOCKED";
const INVOICE_TASK_SOURCE = "f-07-funding-locked";
const FEE_FIX_TASK_SOURCE = "f-07-funding-locked-fee-not-ready";

/**
 * F-07 is an independent subscriber to round.funded. The money-chain handler's
 * ownership checks do NOT gate this handler: the event bus invokes each
 * subscriber separately. Never send a funding-locked message or create an
 * invoice using a sale/round ID taken on faith from a separate event payload.
 *
 * The Card Stacking rail always provides both IDs. Older provider integrations
 * may supply neither; retain that legacy behavior until their adapter carries
 * verifiable IDs, and keep that gap explicitly NOT LIVE PROVED on the board.
 */
const FEE_REF_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function validateFundedFeeSource(db, { orgId, clientId, saleId, fundingRoundId, rail } = {}) {
  const hasRef = Boolean(saleId || fundingRoundId);
  if (!hasRef && rail !== "card_stacking") {
    return { ok: true, legacyUnverified: true };
  }
  if (!orgId || !clientId || !saleId || !fundingRoundId) {
    return { ok: false, reason: "fee_source_missing" };
  }
  if (!FEE_REF_UUID.test(String(saleId)) || !FEE_REF_UUID.test(String(fundingRoundId))) {
    return { ok: false, reason: "fee_source_invalid_ref" };
  }
  const { rows } = await db.query(
    `SELECT fr.id
       FROM funding_rounds fr
       JOIN funding_round_sales frs
         ON frs.funding_round_id = fr.id AND frs.org_id = fr.org_id
       JOIN sales s
         ON s.id = frs.sale_id AND s.org_id = fr.org_id
        AND s.client_id = fr.client_id
       JOIN products pr
         ON pr.id = s.product_id AND pr.org_id = s.org_id
        AND pr.category = 'funding'
      WHERE fr.id = $1::uuid AND fr.org_id = $2::uuid AND fr.client_id = $3::uuid
        AND s.id = $4::uuid AND s.status = 'active'
      LIMIT 1`,
    [fundingRoundId, orgId, clientId, saleId]
  );
  return rows[0]
    ? { ok: true, legacyUnverified: false }
    : { ok: false, reason: "fee_source_mismatch" };
}


async function createTaskOnce(db, { orgId, clientId, eventId, source, title }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, source, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: title,
      sourceWorkflow: source,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

/**
 * What this round can be billed, and why not when it cannot.
 *
 * The event is the first source of truth: the emitter reads the confirmed
 * approvals and the agreed rate out of the database at the moment of funding
 * and freezes them on the event, so a replay bills the same amount it billed
 * the first time. When the event is missing either half — a rail that does not
 * carry them yet — the database answers, but only when the event names the
 * round. Nothing is ever guessed, and nothing is ever defaulted to zero.
 */
export async function resolveFee(db, event) {
  const p = event.payload || {};
  const orgId = event.orgId || null;
  const fundingRoundId = p.fundingRoundId ?? null;

  let approvedAmount = amountOrNull(p.approvedAmount);
  let feePercent = amountOrNull(p.feePercent);
  let saleId = p.saleId ?? null;

  if ((approvedAmount == null || feePercent == null) && fundingRoundId) {
    const looked = await resolveSuccessFee(db, { orgId, fundingRoundId });
    if (approvedAmount == null) approvedAmount = looked.confirmedApprovedAmount;
    if (feePercent == null) feePercent = looked.feePercent;
    if (!saleId) saleId = looked.saleId;
  }

  if (approvedAmount == null || !(approvedAmount > 0)) {
    return { ok: false, reason: NO_CONFIRMED_APPROVALS, approvedAmount: null, feePercent, saleId, fundingRoundId };
  }
  if (feePercent == null || !(feePercent > 0) || feePercent > 100) {
    return { ok: false, reason: NO_AGREED_FEE_PERCENT, approvedAmount, feePercent: null, saleId, fundingRoundId };
  }

  const feeCents = successFeeCents(approvedAmount, feePercent);
  if (feeCents == null || !(feeCents > 0)) {
    return { ok: false, reason: NO_CONFIRMED_APPROVALS, approvedAmount, feePercent, saleId, fundingRoundId };
  }

  return {
    ok: true,
    reason: null,
    approvedAmount,
    feePercent,
    saleId,
    fundingRoundId,
    feeAmount: fromCents(feeCents),
    feeCents
  };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => findClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;

  // A valid customer ID alone is insufficient: a funded event with someone
  // else's round or sale must not notify this buyer or raise a bill. Verify
  // before ANY messaging, status, task, invoice or external-facing mutation.
  const p = event.payload || {};
  const feeSource = await step.run("verify-owned-fee-source", () =>
    validateFundedFeeSource(db, {
      orgId, clientId, saleId: p.saleId, fundingRoundId: p.fundingRoundId,
      rail: p.rail || p.source
    }));
  if (!feeSource.ok) {
    console.error(`[f-07] refused unowned or incomplete fee source: ${feeSource.reason} (event=${eventId || "?"})`);
    return { done: false, feeReady: false, reason: feeSource.reason };
  }
  const fee = await step.run("resolve-success-fee", () => resolveFee(db, event));

  if (!fee.ok) {
    await step.run("tag-ops-action-required", () => addTags(db, clientId, ["ops:action-required"]));
    const task = await step.run("create-fee-fix-task", () =>
      createTaskOnce(db, {
        orgId, clientId, eventId, source: FEE_FIX_TASK_SOURCE,
        title: REFUSAL_TEXT[fee.reason] || "Fix fee lock/percent before invoicing"
      }));
    return { done: true, feeReady: false, reason: fee.reason, task };
  }

  await step.run("set-funding-locked-date", () => mergeCustomFields(db, clientId, { funding_locked_date: event.payload?.lockedAt || null }));
  const email = await step.run("send-email", () =>
    sendTemplated(db, { orgId, clientId, channel: "email", templateKey: EMAIL_TEMPLATE_KEY, eventId }));
  const sms = await step.run("send-sms", () =>
    sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId }));
  const { saleId, fundingRoundId, approvedAmount, feePercent, feeAmount } = fee;
  const invoice = await step.run("create-success-fee-invoice", () =>
    createInvoice(db, {
      orgId,
      clientId,
      source: "funding_success_fee",
      amount: feeAmount,
      saleId: saleId ?? null,
      fundingRoundId: fundingRoundId ?? null,
      idempotencyKey: (saleId && fundingRoundId) ? successFeeKey(saleId, fundingRoundId) : null,
      // Guards a replay that arrives without sale/round ids, which would
      // otherwise write a NULL key and bill the success fee twice.
      sourceEventId: eventId ?? null,
      notes: `round.funded — confirmed approvals ${approvedAmount} @ ${feePercent}%`,
    }));
  await step.run("announce-invoice-created", () =>
    invoice ? announceInvoice(db, "invoice.created", invoice) : null);
  const sentInvoice = await step.run("mark-invoice-sent", () =>
    invoice?.id ? markSent(db, { invoiceId: invoice.id }) : null);
  await step.run("announce-invoice-sent", () =>
    sentInvoice ? announceInvoice(db, "invoice.sent", sentInvoice) : null);
  const invoiceTask = await step.run("create-invoice-task", () =>
    createTaskOnce(db, { orgId, clientId, eventId, source: INVOICE_TASK_SOURCE, title: `Invoice client — confirmed approvals ${approvedAmount} @ ${feePercent}% = ${feeAmount} (send)` }));
  await step.run("set-next-action", () => mergeCustomFields(db, clientId, { last_progress_action: "invoice_sent" }));

  return { done: true, feeReady: true, feeAmount, email, sms, invoice, invoiceTask };
}

export const f07FundingLocked = inngest.createFunction(
  { id: "f-07-funding-locked", name: "F-07 — Funding Locked" },
  { event: "round.funded" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
