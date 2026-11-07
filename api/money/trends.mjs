// GET /api/money/trends[?range=30d|90d|12m][&client_id=<uuid>]
// GET /api/money/trends?from=YYYY-MM-DD&to=YYYY-MM-DD[&account=<uuid>][&client_id=<uuid>]
//
// FinanceOS tracking over time (wave 4, unit H6): the series the Overview's
// Trends area draws as lines — cash per kind (never added together), debt,
// cards used %, money in vs out per month (personal and business apart),
// merchant net sales per month, and the credit score history. The math and the
// shape live in src/finance/money-trends.mjs; this file gates and fetches.
//
// SAME TWO CALLERS AND THE SAME GATE AS api/money/overview.mjs:
//
//   * A signed-in CLIENT sees their own file only. client_id comes off the
//     SESSION; a client_id in the query string is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) (owner / admin / sales_manager) +
//     requireClientInOrg on ?client_id=. A client in another org is 404.
//
// range defaults to 90d. Anything else than 30d / 90d / 12m is a 400.
//
// ANY DATES (Finance OS CFO build, unit A, 2026-11-07): from=&to= instead of
// range. Both real days, from not after to, at most 24 months apart, and never
// together with range — anything else is a 400 that says why (readWindow in
// src/finance/money-trends.mjs).
//
// ONE ACCOUNT: account=<uuid> adds that account's own daily lines. It must be
// one of the file's open accounts — the client's own on the client branch, the
// ?client_id file on the staff branch. Anything else is 404, the same answer as
// a client outside the org, so the read never says whether another client's
// account exists. A malformed id is a 400.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { moneyTrends, readWindow } from "../../src/finance/money-trends.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const build = deps.moneyTrends || moneyTrends;
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

  const q = req.query || {};
  const win = readWindow({ range: q.range, from: q.from, to: q.to });
  if (!win.ok) {
    return res.status(400).json({ ok: false, error: win.error });
  }
  const rawAccount = q.account === undefined || q.account === null ? "" : String(q.account).trim();
  if (rawAccount !== "" && !isUuid(rawAccount)) {
    return res.status(400).json({ ok: false, error: "account must be a uuid" });
  }
  const accountId = rawAccount === "" ? null : rawAccount;

  try {
    const payload = await build(database, {
      orgId, clientId, range: win.range, from: win.from, to: win.to, accountId, asOf: clock()
    });
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
