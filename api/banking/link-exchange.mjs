// POST /api/banking/link-exchange { client_id, public_token, institution? }
//   → { ok, item_id, environment, institution_name, written, accounts[] }
//
// Finishes Plaid Link: trades the public_token, stores the encrypted item, reads
// every account on it (checking, savings, credit cards) and saves them. Same
// gate as link-token. The access token never appears in a response.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { completeLink } from "../../src/banking/plaid-link.mjs";
import { describeAccount } from "../../src/banking/accounts-store.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const complete = deps.completeLink || completeLink;
  const clock = deps.now || (() => new Date());
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
  if (!body.public_token || typeof body.public_token !== "string") {
    return res.status(400).json({ ok: false, error: "public_token is required" });
  }
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return;

  const institution = body.institution && typeof body.institution === "object"
    ? { institution_id: body.institution.institution_id ?? null, name: body.institution.name ?? null }
    : null;

  const r = await complete(database, {
    orgId: staff.org_id,
    clientId: String(clientId).trim(),
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
