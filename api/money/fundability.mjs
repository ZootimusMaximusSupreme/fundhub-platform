// GET /api/money/fundability[?client_id=<uuid>]
//
// The Fundability section of FinanceOS (/app/money-fundability.html): the
// fundability score now, the same file looked at 3, 6 and 12 months ahead, and
// each business read on its own. The rules live in src/finance/fundability.mjs
// (how the score is counted is written at the top of that file); this file
// gates and fetches. Read only. It never runs a pull and never writes.
//
// TWO CALLERS — the same gate as api/money/overview.mjs, line for line.
//
//   * A signed-in CLIENT (an account session) sees their own file and nothing
//     else. The client_id comes off the SESSION; a `client_id` in the query
//     string is never read on this branch.
//   * STAFF: a staff session + requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg
//     on ?client_id=. The role check is its own call; requireAuth drops a `roles`
//     key (CLAUDE.md §12).
//
// A client in another org is 404, not 403.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { fundability } from "../../src/finance/fundability.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const build = deps.fundability || fundability;
  const clock = deps.now || (() => new Date());

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  let orgId;
  let clientId;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
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
    if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return;
    const qid = req.query && req.query.client_id;
    if (!isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    }
    clientId = String(qid).trim();
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;
    orgId = staff.org_id;
  }

  try {
    const payload = await build(database, { orgId, clientId, asOf: clock() });
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
