// POST /api/banking/sync-transactions { client_id }
//   → { ok, ran, environment, items[], totals, bills }
//
// Pulls one client's charges and deposits from every linked Plaid bank into
// bank_transactions, then re-runs the repeating-bill detector. Same gate as
// banking/link-token: ROLE_SETS.FINANCE_OS, as its own requireRole() call because
// requireAuth drops a `roles` key, then the client must be in the caller's org.
// The access token never appears in a response.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { syncClientTransactions } from "../../src/banking/plaid-transactions.mjs";
import { readBody } from "./sync-accounts.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const sync = deps.syncClientTransactions || syncClientTransactions;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return;

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
    return res.status(status).json({
      ok: false, error: r.reason, missing: r.missing ?? [],
      items: (r.items ?? []).map(itemView)
    });
  }
  return res.status(200).json({
    ok: true,
    ran: r.ran,
    reason: r.reason ?? null,
    environment: r.environment,
    items: r.items.map(itemView),
    totals: r.totals,
    bills: r.bills
  });
}

/* Hand-picked fields. Nothing from plaid_items' token or cursor columns. */
function itemView(x) {
  return {
    item_id: x.itemRowId,
    ok: x.ok,
    error: x.reason,
    error_code: x.errorCode,
    detail: x.error,
    added: x.added,
    modified: x.modified,
    removed: x.removed,
    written: x.written,
    marked_removed: x.markedRemoved,
    dropped: x.dropped,
    capped: x.capped,
    update_status: x.updateStatus,
    cursor_saved: x.cursorSaved
  };
}
