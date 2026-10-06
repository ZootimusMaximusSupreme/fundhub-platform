// POST /api/banking/link-token { client_id } → { ok, link_token, expiration, environment }
//
// Opens Plaid Link for one client. Two callers:
//   * STAFF, ROLE_SETS.FINANCE — the same gate as banking/sync-accounts, because
//     finishing the link writes bank rows. The role check is its own
//     requireRole() call: requireAuth drops a `roles` key.
//   * A signed-in CLIENT (account session), for their OWN file only. The
//     client_id comes off the session; a client_id in the body is never read.
import { db } from "../../src/db.mjs";
import { requireAuth, AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { resolvePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { startLink } from "../../src/banking/plaid-link.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const resolve = deps.resolvePrincipal || resolvePrincipal;
  const start = deps.startLink || startLink;
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const scope = await clientScope(req, res, { database, auth, resolve, env });
  if (!scope) return;

  const r = await start({ clientId: scope.clientId, env });
  if (!r.ok) {
    const status = r.reason === "not_configured" ? 503 : 502;
    return res.status(status).json({ ok: false, error: r.reason, missing: r.missing ?? [], detail: r.error ?? null });
  }
  return res.status(200).json({
    ok: true, link_token: r.linkToken, expiration: r.expiration, environment: r.environment
  });
}

/* clientScope — who is asking, and for which file. Returns { orgId, clientId }
   or writes the refusal and returns null. Same block as link-exchange.mjs (kept in each file so
   each handler's own text shows its gate).

   A CLIENT session is pinned to its own client_id from the session. Staff go
   through the unchanged staff gate: requireAuth, FINANCE, client_id in the
   body, client in their org. Any other principal kind (affiliate, partner) is
   refused. No session at all falls through to requireAuth, which answers 401. */
async function clientScope(req, res, { database, auth, resolve, env } = {}) {
  const who = await resolve(req, { db: database, env });
  if (who === AUTH_UNAVAILABLE) {
    res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
    return null;
  }

  if (who && who.kind === "client") {
    const clientId = who.clientId || null;
    const orgId = who.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    if (!(await requireClientInOrg(res, database, { org_id: orgId }, clientId))) return null;
    return { orgId, clientId };
  }
  if (who && who.kind !== "staff") {
    res.status(403).json({ ok: false, error: "forbidden", message: "this endpoint serves staff, client" });
    return null;
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return null;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;

  const body = readBody(req.body);
  if (body === null) {
    res.status(400).json({ ok: false, error: "body must be JSON" });
    return null;
  }
  const clientId = body.client_id;
  if (!isUuid(clientId)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return null;
  return { orgId: staff.org_id, clientId: String(clientId).trim() };
}
