// POST /api/affiliates/payouts — finance staff act on one affiliate payout run.
//
//   { action: "send",            payout_id }                       Plaid Transfer
//   { action: "mark_paid",       payout_id, method, reference, paid_at? }  paid by hand
//   { action: "hold",            payout_id, reason }
//   { action: "release",         payout_id }                       held → pending
//   { action: "void",            payout_id, reason }
//   { action: "record_tax_form", affiliate_id, reference, received_at? }
//   { action: "stamp_license",   affiliate_id }                    from a signed contract
//
// The read is GET /api/read/affiliate-payouts. Logic: src/affiliates/payout-rail.mjs.
// The database (033 + 490) refuses every illegal move whatever this file does.
// Flow: docs/journeys/affiliate-payout-flow.md.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";
import {
  isUuid, sendPayoutViaPlaid, markPayoutPaid, holdPayout, releasePayout, voidPayout,
  recordTaxForm, stampAffiliateLicense
} from "../../src/affiliates/payout-rail.mjs";

export const ACTIONS = Object.freeze(["send", "mark_paid", "hold", "release", "void", "record_tax_form", "stamp_license"]);

function readBody(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw || "{}"); } catch { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const env = deps.env || process.env;
  const now = deps.now || new Date();

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  // Separate call: requireAuth drops a `roles` key (CLAUDE.md §12).
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const body = readBody(req.body);
  if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  const action = String(body.action || "").trim().toLowerCase();
  if (!ACTIONS.includes(action)) return res.status(400).json({ ok: false, error: "action_required", allowed: ACTIONS });

  const payoutId = String(body.payout_id || "").trim();
  const affiliateId = String(body.affiliate_id || "").trim();
  const forPayout = ["send", "mark_paid", "hold", "release", "void"].includes(action);
  if (forPayout && !isUuid(payoutId)) return res.status(400).json({ ok: false, error: "payout_id is required and must be a uuid" });
  if (!forPayout && !isUuid(affiliateId)) return res.status(400).json({ ok: false, error: "affiliate_id is required and must be a uuid" });

  try {
    let r;
    if (action === "send") r = await sendPayoutViaPlaid(database, { orgId, payoutId, staff, env, now, provider: deps.provider || null });
    else if (action === "mark_paid") r = await markPayoutPaid(database, { orgId, payoutId, method: body.method, externalRef: body.reference, paidAt: body.paid_at || null, staff, now });
    else if (action === "hold") r = await holdPayout(database, { orgId, payoutId, reason: body.reason, staff });
    else if (action === "release") r = await releasePayout(database, { orgId, payoutId, staff });
    else if (action === "void") r = await voidPayout(database, { orgId, payoutId, reason: body.reason, staff });
    else if (action === "record_tax_form") r = await recordTaxForm(database, { orgId, affiliateId, ref: body.reference, receivedAt: body.received_at || null, staff, now });
    else r = await stampAffiliateLicense(database, { orgId, affiliateId });

    const { ok, status, ...rest } = r;
    return res.status(status || (ok ? 200 : 400)).json({ ok, action, ...rest });
  } catch (err) {
    if (dbDown(err)) return res.status(503).json({ ok: false, error: "db_unavailable" });
    // A database rule (033/490) refusing the move is a 409, said plainly.
    const msg = String((err && err.message) || "");
    if (/affiliate_payouts|affiliate_payout_lines|affiliates /.test(msg)) {
      return res.status(409).json({ ok: false, action, error: "refused_by_database", message: msg.slice(0, 300) });
    }
    return res.status(500).json({ ok: false, action, error: safeError(err) });
  }
}
