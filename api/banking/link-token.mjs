// POST /api/banking/link-token { client_id } → { ok, link_token, expiration, environment }
//
// Opens Plaid Link for one client. Staff only, ROLE_SETS.FINANCE — the same gate
// as banking/sync-accounts, because finishing the link writes bank rows. The
// role check is its own requireRole() call: requireAuth drops a `roles` key.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { startLink } from "../../src/banking/plaid-link.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const start = deps.startLink || startLink;
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const body = readBody(req.body);
  if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  const clientId = body.client_id;
  if (!isUuid(clientId)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return;

  const r = await start({ clientId: String(clientId).trim(), env });
  if (!r.ok) {
    const status = r.reason === "not_configured" ? 503 : 502;
    return res.status(status).json({ ok: false, error: r.reason, missing: r.missing ?? [], detail: r.error ?? null });
  }
  return res.status(200).json({
    ok: true, link_token: r.linkToken, expiration: r.expiration, environment: r.environment
  });
}
