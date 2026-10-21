// GET /api/chat/peers — who the chat widget lets a staff member message.
// Narrower than /api/read/staff (which is FINANCE-only).
//
//   staff    the active, working teammates (src/chat/internal.mjs
//            listWorkingTeammates): no test logins, fixtures, demo rows or
//            switched-off people, never the caller.
//   clients  the clients this staff member is the assigned CSM for
//            (clients.assigned_csm_staff_id). Owner, 2026-10-20.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { listWorkingTeammates, listAssignedClients } from "../../src/chat/internal.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  if (!staff.org_id) return res.status(403).json({ ok: false, error: "no_org_scope" });

  try {
    const teammates = await listWorkingTeammates(db, { orgId: staff.org_id, staffId: staff.id });
    const clients = await listAssignedClients(db, { orgId: staff.org_id, staffId: staff.id });
    return res.status(200).json({ ok: true, staff: teammates, clients });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
