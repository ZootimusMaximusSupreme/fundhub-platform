// requirePrincipal — the gate for endpoints a non-employee may reach.
//
// requireAuth answers "is this a signed-in employee". This answers "who is this,
// of any kind", and refuses to let the two blur:
//
//   a STAFF token resolves to { kind: "staff", … }
//   an ACCOUNT token resolves to { kind: "client" | "affiliate" | "partner", … }
//
// A staff token is tried first because staff endpoints are the hot path, but the
// two token spaces are separate tables and a token is only ever valid in one of
// them — sessions and account_sessions both store sha256(token) and a collision
// across them is a 2^-256 event, not a design assumption.
//
// THE POINT OF THIS FILE is that an endpoint says which kinds it accepts, and a
// kind it did not name is refused. `/api/tasks` naming only "staff" is what makes
// a client session get a 403 there rather than a task list.

import { db as defaultDb } from "../../db.mjs";
import { authenticate, AUTH_UNAVAILABLE } from "./requireAuth.mjs";
import { verifyAccountSession } from "../../auth/account-session.mjs";
import { bearerToken } from "./requireAuth.mjs";

export const ALL_KINDS = ["staff", "client", "affiliate", "partner"];

/* resolvePrincipal — request → principal or null. Never throws. */
export async function resolvePrincipal(req, { db = defaultDb, env = process.env } = {}) {
  const staffResult = await authenticate(req, { db, env });
  // Short-circuit: if the staff check could not run, the account check is about
  // to fail the same way. Falling through would still be correct but would
  // double the timeout during an outage.
  if (staffResult === AUTH_UNAVAILABLE) return AUTH_UNAVAILABLE;
  if (staffResult && staffResult.staff) {
    const s = staffResult.staff;
    return {
      kind: "staff",
      staffId: s.id,
      orgId: s.org_id,
      email: s.email,
      name: s.name,
      role: s.role,
      staff: s
    };
  }

  const token = bearerToken(req);
  if (!token) return null;
  try {
    const acct = await verifyAccountSession(db, token, { env });
    return acct ? { ...acct.principal, sessionId: acct.session.id } : null;
  } catch {
    // Same distinction requireAuth makes: could-not-check is not not-signed-in.
    return AUTH_UNAVAILABLE;
  }
}

/* requirePrincipal — returns the principal, or writes the refusal and returns
   null. `kinds` is required: an endpoint that does not say who it serves gets
   nobody, so forgetting to configure one fails closed.

   401 for "no session", 403 for "a session of the wrong kind" — the caller needs
   to know whether to sign in or to stop asking. */
export async function requirePrincipal(req, res, kinds, opts = {}) {
  const allowed = new Set(
    (Array.isArray(kinds) ? kinds : [kinds]).filter(Boolean)
      .map((k) => String(k).trim().toLowerCase())
  );
  if (!allowed.size) {
    res.status(403).json({ ok: false, error: "forbidden",
      message: "this endpoint declares no principal kinds" });
    return null;
  }

  const principal = await resolvePrincipal(req, opts);
  if (principal === AUTH_UNAVAILABLE) {
    res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
    return null;
  }
  if (!principal) {
    res.status(401).json({ ok: false, error: "unauthorized" });
    return null;
  }
  if (!allowed.has(principal.kind)) {
    res.status(403).json({ ok: false, error: "forbidden",
      message: `this endpoint serves ${[...allowed].join(", ")}` });
    return null;
  }
  return principal;
}

export default requirePrincipal;
