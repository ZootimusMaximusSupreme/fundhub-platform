// POST /api/banking/sync-liabilities { client_id }
//   → { ok, environment, written, items[{ item_id, ok, error_code, error, written, skipped[] }] }
//
// Reads card bills (next due date, minimum, last statement, last payment) from
// Plaid for every linked bank login this client has, and writes them onto each
// card's statement cycle (account_statement_cycles). Never moves money. Same gate
// as banking/link-token: staff, ROLE_SETS.FINANCE, its own requireRole() call
// (requireAuth drops a `roles` key). No token appears in the response.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { syncClientLiabilities } from "../../src/banking/plaid-liabilities.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const sync = deps.syncClientLiabilities || syncClientLiabilities;
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
  if (!(await requireClientInOrg(res, database, staff, String(clientId).trim()))) return;

  const r = await sync(database, {
    orgId: staff.org_id,
    clientId: String(clientId).trim(),
    asOf: clock().toISOString(),
    env
  });
  if (!r.ok) {
    const status = r.reason === "not_configured" ? 503 : r.reason === "bad_request" ? 400 : 502;
    return res.status(status).json({ ok: false, error: r.reason, missing: r.missing ?? [] });
  }
  return res.status(200).json({
    ok: true,
    environment: r.environment ?? null,
    written: r.written,
    items: r.items.map((it) => ({
      item_id: it.itemRowId,
      ok: it.ok,
      error_code: it.errorCode,
      error: it.error,
      written: it.written,
      skipped: it.skipped
    }))
  });
}
