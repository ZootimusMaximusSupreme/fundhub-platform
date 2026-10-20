// POST /api/closer-deck — live actions from the presenter cockpit.
//
//   { action: "send_soft_pull", client_id }
//   { action: "send_pay_link", client_id, offer_key, amount_cents? }
//   { action: "generate_letters", client_id, offer_key, edu?, force_repair?, tier? }
//   { action: "log_disposition", client_id, offer_key, route?, temperature?, beliefs_count?, cost_of_inaction? }
//
// COMPLIANCE REVIEW REQUIRED — payment rails, fee timing, consent, credit pull,
// dispute letter send. Soft pull amount is fixed ($32). Letters NEVER fire on
// the qualified funding offer.

import { db } from "../src/db.mjs";
import { requireAuth as defaultRequireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid } from "../src/http/read-api.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import {
  CloserDeckError,
  sendDeckPayLink,
  sendDeckSoftPull,
  generateDeckLetters,
  logDeckDisposition
} from "../src/sales/closer-deck.mjs";

const CLOSER_DECK_ROLES = new Set(["closer", "sales_manager", "owner", "admin"]);

async function ownsClient(database, orgId, clientId) {
  const r = await database.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const requireAuth = deps.requireAuth ?? defaultRequireAuth;
  const env = deps.env ?? process.env;

  if (req.method && req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, CLOSER_DECK_ROLES)) return;

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
  const clientId = String(body.client_id).trim();

  try {
    if (!(await ownsClient(database, orgId, clientId))) {
      return res.status(404).json({ ok: false, error: "client_not_found" });
    }

    if (body.action === "send_soft_pull") {
      const result = await sendDeckSoftPull(database, {
        orgId,
        clientId,
        staffId: staff.id,
        staffRole: staff.role,
        checkoutBaseUrl: process.env.COMMAS_CHECKOUT_BASE_URL,
        env: process.env
      });
      return res.status(200).json({ ok: true, action: "send_soft_pull", ...result });
    }

    if (body.action === "send_pay_link") {
      const result = await sendDeckPayLink(database, {
        orgId,
        clientId,
        staffId: staff.id,
        staffRole: staff.role,
        offerKey: body.offer_key,
        saleMotion: body.sale_motion || null,
        amountCents: body.amount_cents,
        provider: body.provider ?? "commas",
        checkoutBaseUrl: env.COMMAS_CHECKOUT_BASE_URL,
        env
      });
      return res.status(200).json({ ok: true, action: "send_pay_link", ...result });
    }

    if (body.action === "generate_letters") {
      const result = await generateDeckLetters(database, {
        orgId,
        clientId,
        staffId: staff.id,
        offerKey: body.offer_key,
        edu: !!body.edu,
        forceRepair: !!body.force_repair,
        tier: body.tier || null
      });
      return res.status(200).json({ ok: true, action: "generate_letters", ...result });
    }

    if (body.action === "log_disposition") {
      const result = await logDeckDisposition(database, {
        orgId,
        clientId,
        staffId: staff.id,
        offerKey: body.offer_key,
        route: body.route || null,
        temperature: body.temperature,
        beliefsCount: body.beliefs_count,
        costOfInaction: body.cost_of_inaction,
        taskId: isUuid(body.task_id) ? body.task_id : null,
        repairReferral: body.repair_referral === true || body.repairReferral === true
      });
      return res.status(result.created ? 201 : 200).json({
        ok: true,
        action: "log_disposition",
        ...result
      });
    }

    return res.status(400).json({
      ok: false,
      error: "unknown_action",
      message: "action must be send_soft_pull, send_pay_link, generate_letters, or log_disposition"
    });
  } catch (err) {
    if (err instanceof CloserDeckError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "bad_request",
        message: err.message
      });
    }
    if (dbDown(res, err)) return;
    return res.status(500).json({
      ok: false,
      error: "send_failed",
      message: err && err.message
        ? String(err.message).slice(0, 180)
        : "Something went wrong sending that. Try again in a moment."
    });
  }
}
