// GET /api/money/overview[?client_id=<uuid>]
//
// The client's Finance OS dashboard in one read: cash per kind (never added
// together), debt three ways, every account, month-by-month cashflow, bills, what
// is due next, the container count for billing, and one UnderwriteIQ sentence.
// The shape is the contract on ops/workflows/finance-os-build-2026-10-06.md. The
// math lives in src/finance/money-overview.mjs; this file gates and fetches.
//
// TWO CALLERS.
//
//   * A signed-in CLIENT (an account session, src/auth/account-session.mjs) sees
//     their own file and nothing else. The client_id comes off the SESSION. A
//     `client_id` in the query string is never read on this branch — not
//     validated and ignored, just never consulted.
//   * STAFF: a staff session (resolved by the same authenticate() requireAuth
//     uses) + requireRole(ROLE_SETS.FINANCE)
//     (owner / admin / sales_manager) + requireClientInOrg on ?client_id=. The
//     role check is its own call; requireAuth drops a `roles` key (CLAUDE.md §12).
//
// A client in another org is 404, not 403 — "that file is not yours" would tell a
// prober the uuid is real.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { moneyOverview } from "../../src/finance/money-overview.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const build = deps.moneyOverview || moneyOverview;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  let orgId;
  let clientId;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/read/client-progress.mjs. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      return res.status(403).json({
        ok: false,
        error: "forbidden",
        message: "Your login is not attached to a client file."
      });
    }
  } else {
    const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
    if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
    const qid = req.query && req.query.client_id;
    if (!isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    }
    clientId = String(qid).trim();
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;
    orgId = staff.org_id;
  }

  try {
    const payload = await build(database, { orgId, clientId, env, asOf: clock() });
    if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
    return res.status(200).json(payload);
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
