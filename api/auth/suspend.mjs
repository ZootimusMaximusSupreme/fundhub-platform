// POST /api/auth/suspend — owner/admin turns off a staff login.
//
// { staff_id } → { ok, staff, sessionsRevoked }
//
// Scoped to the session org. Cannot revoke yourself.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { suspendStaff, removeStaff } from "../../src/auth/invite.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return;

  const staffId = String((req.body || {}).staff_id || "").trim();
  if (!staffId) return res.status(400).json({ ok: false, error: "staff_id_required" });

  const result = req.body?.action === "remove"
    ? await removeStaff(db, { actor: staff, staffId })
    : await suspendStaff(db, { actor: staff, staffId });
  if (!result.ok) {
    return res.status(result.status || 400).json({ ok: false, error: result.error });
  }
  return res.status(200).json({
    ok: true,
    staff: result.staff,
    sessionsRevoked: result.sessionsRevoked
  });
}
