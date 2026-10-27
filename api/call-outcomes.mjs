// POST /api/call-outcomes — log a closer disposition (hotkeys 1–5).
// Cash is derived from the payment record. Never accept an amount from the body.

import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../src/http/read-api.mjs";
import { getOffer } from "../src/config/offers.mjs";
import {
  CallOutcomeError,
  logCallOutcome,
  paidTransactionForLink,
  presentOutcome
} from "../src/sales/call-outcomes.mjs";

const CLOSER_ROLES = new Set(["closer", "sales_manager", "owner", "admin"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  if (!CLOSER_ROLES.has(String(staff.role || "").toLowerCase())) {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "Only closers (and sales managers / owners) log call outcomes."
    });
  }

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const body = req.body || {};
  if (!isUuid(body.client_id)) {
    return res.status(400).json({
      ok: false,
      error: "client_id is required and must be a uuid"
    });
  }
  if (body.cash_collected != null || body.cash_collected_cents != null || body.amount != null) {
    return res.status(400).json({
      ok: false,
      error: "cash_not_accepted",
      message: "Cash collected is read from the payment record. Do not send an amount."
    });
  }
  if (body.transaction_id != null) {
    return res.status(400).json({ ok: false, error: "payment_link_required", message: "Use the checkout link from this call to record cash." });
  }
  if (body.payment_link_id && !isUuid(body.payment_link_id)) {
    return res.status(400).json({ ok: false, error: "invalid_payment_link", message: "That checkout link is invalid." });
  }
  const offer = getOffer(body.offer_key);
  if (body.payment_link_id && !offer) {
    return res.status(400).json({ ok: false, error: "offer_required", message: "Choose the offer on this call." });
  }

  try {
    const paidOutcome = body.outcome === "deposit" || body.outcome === "downsell";
    const offerMatchesOutcome = offer && (body.outcome === "deposit"
      ? offer.paymentPurpose === "deposit"
      : offer.paymentPurpose !== "deposit");
    const transactionId = paidOutcome && offerMatchesOutcome
      ? await paidTransactionForLink(database, {
          orgId, clientId: body.client_id, staffId: staff.id,
          paymentLinkId: body.payment_link_id, productCode: offer.productCode
        })
      : null;
    const result = await logCallOutcome(database, {
      orgId,
      clientId: body.client_id,
      staffId: staff.id,
      taskId: isUuid(body.task_id) ? body.task_id : null,
      bookingRef: body.booking_ref || null,
      outcome: body.outcome,
      beliefFailed: body.belief_failed ?? body.belief ?? null,
      transactionId,
      offerKey: offer?.key || null,
      recordingUrl: body.recording_url || null,
      durationSeconds: body.duration_seconds ?? null,
      notes: body.notes || null,
      checklist: body.checklist || null,
      repairReferral: body.repair_referral === true || body.repairReferral === true
    });
    return res.status(result.created ? 201 : 200).json({
      ok: true,
      created: result.created,
      outcome: presentOutcome(result.row)
    });
  } catch (e) {
    if (e instanceof CallOutcomeError) {
      return res.status(e.status).json({
        ok: false,
        error: e.code,
        message: e.message
      });
    }
    throw e;
  }
}
