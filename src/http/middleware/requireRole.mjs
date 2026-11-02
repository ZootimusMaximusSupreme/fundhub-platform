// requireRole — role gate layered on top of requireAuth.
//
// Gates on the primary staff.role and the server-resolved staff.roles array.
// verifySession joins active, same-org staff_role_assignments to the catalog;
// this helper never reads role claims from a browser or an account principal.
//
// 401 when there is no valid session, 403 when there is one and it is the wrong
// role. Those are different facts and the caller is entitled to both: a 403
// means "log in as someone else", a 401 means "log in".

import { requireAuth } from "./requireAuth.mjs";

// Roles that pass every gate. An owner is not listed on each individual route.
export const SUPER_ROLES = ["owner"];

const norm = (r) => String(r ?? "").trim().toLowerCase();

// hasRole — pure predicate. Exported because handlers frequently need to branch
// on role without rejecting the request outright.
export function hasRole(staff, allowed) {
  const want = (Array.isArray(allowed) ? allowed : [allowed]).map(norm).filter(Boolean);
  if (!staff) return false;
  const primary = norm(staff.role);
  if (!primary) return false;
  const canStackRoles = !["partner", "client", "affiliate", "outbound_rep"].includes(primary);
  const have = [primary, ...(canStackRoles && Array.isArray(staff.roles)
    ? staff.roles.map(norm).filter((role) => role !== "owner") : [])];
  if (SUPER_ROLES.includes(primary)) return true;
  return want.length === 0 || have.some((role) => want.includes(role));
}

// requireRole(...allowed) → async (req, res, opts) => staff | null
//
//   const staff = await requireRole("admin", "closer")(req, res);
//   if (!staff) return;
//
export function requireRole(...allowed) {
  const want = allowed.flat();
  return async function roleGate(req, res, opts = {}) {
    const staff = await requireAuth(req, res, opts);
    if (!staff) return null;              // requireAuth already wrote the 401
    if (!hasRole(staff, want)) {
      res.status(403).json({ ok: false, error: "forbidden", required: want.map(norm) });
      return null;
    }
    return staff;
  };
}

export default requireRole;
