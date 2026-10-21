// GET /api/read/affiliate-payouts[?status=pending|held|processing|paid|void]
//
// Finance staff: every affiliate payout run, open ones first by due day, with
// the bank it goes to, the Plaid transfer state and the paperwork gates. The
// actions are POST /api/affiliates/payouts. Logic: src/affiliates/payout-rail.mjs.
// Read only. Never returns a Plaid token.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requireRole, ROLE_SETS } from "../../src/http/read-api.mjs";
import { requireSessionOrg } from "../../src/http/session-org.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { safeError } from "../../src/http/health.mjs";
import { payoutsView } from "../../src/affiliates/payout-rail.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;
  try {
    const status = req.query && req.query.status ? String(req.query.status) : null;
    // The company comes off the session, never the query string.
    const view = await payoutsView(database, { orgId: staff.org_id, status, now: deps.now || new Date(), env: deps.env || process.env });
    return res.status(200).json({ ok: true, ...view });
  } catch (err) {
    if (dbDown(err)) return res.status(503).json({ ok: false, error: "db_unavailable" });
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
