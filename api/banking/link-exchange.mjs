// POST /api/banking/link-exchange { client_id, public_token, institution? }
//   → { ok, item_id, environment, institution_name, written, accounts[] }
//
// Finishes Plaid Link: trades the public_token, stores the encrypted item, reads
// every account on it (checking, savings, credit cards) and saves them. Same
// gate as link-token: staff (FINANCE, client in their org) or a signed-in client
// for their OWN file — the client_id then comes off the session and a client_id
// in the body is never read. The access token never appears in a response.
import { db } from "../../src/db.mjs";
import { requireAuth, AUTH_UNAVAILABLE } from "../../src/http/middleware/requireAuth.mjs";
import { resolvePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { completeLink } from "../../src/banking/plaid-link.mjs";
import { describeAccount } from "../../src/banking/accounts-store.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const resolve = deps.resolvePrincipal || resolvePrincipal;
  const complete = deps.completeLink || completeLink;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const scope = await clientScope(req, res, { database, auth, resolve, env });
  if (!scope) return;

  const body = readBody(req.body) || {};
  if (!body.public_token || typeof body.public_token !== "string") {
    return res.status(400).json({ ok: false, error: "public_token is required" });
  }

  const institution = body.institution && typeof body.institution === "object"
    ? { institution_id: body.institution.institution_id ?? null, name: body.institution.name ?? null }
    : null;

  const r = await complete(database, {
    orgId: scope.orgId,
    clientId: scope.clientId,
    publicToken: body.public_token,
    institution,
    asOf: clock().toISOString(),
    env
  });
  if (!r.ok) {
    const status = r.reason === "not_configured" ? 503 : r.reason === "bad_request" ? 400 : 502;
    return res.status(status).json({ ok: false, error: r.reason, missing: r.missing ?? [], detail: r.error ?? null });
  }
  return res.status(200).json({
    ok: true,
    item_id: r.itemRowId,
    environment: r.environment,
    institution_name: r.institutionName,
    written: r.written,
    accounts: r.accounts.map((a) => ({
      id: a.id,
      summary: describeAccount(a),
      name: a.name,
      mask: a.mask,
      type: a.account_type,
      subtype: a.account_subtype,
      entity_kind: a.entity_kind
    }))
  });
}

/* clientScope — who is asking, and for which file. Returns { orgId, clientId }
   or writes the refusal and returns null. Same block as link-token.mjs, kept in this file on
   purpose: the journey extractor and src/http/cross-org-guard.mjs read each
   handler's own text for its gate.

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
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;

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
