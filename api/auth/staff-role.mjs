// POST /api/auth/staff-role — owner/admin changes a staff job.
//
// { staff_id, role } → { ok, staff }
//
// Same gate as invite and suspend. Cannot mint owner. Cannot rewrite an owner.

import { db } from "../../src/db.mjs";
import { requireRole } from "../../src/http/middleware/requireRole.mjs";
import { setStaffRole } from "../../src/auth/invite.mjs";
import { staffRoleKey } from "../../src/auth/company-email.mjs";

import { setStaffRoles } from "../../src/auth/staff-role-assignments.mjs";
import { bearerToken } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid } from "../../src/http/read-api.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireRole("owner", "admin")(req, res);
  if (!staff) return;

  const body = req.body || {};
  const staffId = String(body.staff_id || "").trim();
  const role = staffRoleKey(body.role) || String(body.role || "").trim().toLowerCase();
  if (!staffId) return res.status(400).json({ ok: false, error: "staff_id_required" });
  if (!role) return res.status(400).json({ ok: false, error: "unknown_role" });

  if (!isUuid(staffId)) return res.status(400).json({ ok: false, error: "invalid_staff_id" });
  const result = Object.prototype.hasOwnProperty.call(body, "roles")
    ? await setStaffRoles(db, { actor: staff, token: bearerToken(req), staffId, role, roles: body.roles })
    : await setStaffRole(db, { actor: staff, staffId, role });
  if (!result.ok) {
    return res.status(result.status || 400).json({ ok: false, error: result.error });
  }
  return res.status(200).json({ ok: true, staff: result.staff });
}
