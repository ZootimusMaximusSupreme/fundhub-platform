// Additional jobs use the existing owner/admin edit flow, never browser claims.
import { hashToken } from "./session.mjs";
export const ADDITIONAL_STAFF_ROLES = Object.freeze([
  "sales_manager", "setter", "closer", "outbound_rep",
  "inquiry_specialist", "funding_advisor", "csm"
]);
export async function setStaffRoles(db, { actor, token, staffId, role, roles } = {}) {
  if (!actor?.org_id || !["owner", "admin"].includes(actor.role) || !token) {
    return { ok: false, status: 403, error: "forbidden" };
  }
  if (!Array.isArray(roles) || roles.length > 12 || roles.some(r =>
    typeof r !== "string" || !ADDITIONAL_STAFF_ROLES.includes(r))) {
    return { ok: false, status: 400, error: "invalid_roles" };
  }
  // The DB rechecks live session, primary authority and target tenant atomically.
  const result = await db.query(
    "SELECT public.set_staff_role_assignments($1, $2::uuid, $3, $4::text[]) AS result",
    [hashToken(token), staffId, role, [...new Set(roles)]]
  );
  return result.rows[0]?.result || { ok: false, status: 503, error: "roles_unavailable" };
}
