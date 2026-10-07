// GET  /api/money/strategy[?client_id=<uuid>]
// POST /api/money/strategy  { action: "save_plan", method, monthly_cents, goal?, client_id? }
//
// The FinanceOS Strategy section (/app/money-strategy.html): how to pay the
// cards and loans down — highest rate first, card use first, or smallest
// balance first — month by month, with the interest, the card-use path against
// UnderwriteIQ's 30% and 10% targets, the money a month a goal date needs, and
// a check of this month's payments against the cash on hand.
//
// GET returns the INPUTS (the debts, each kind's safe amount this month) plus
// the plan for the saved or default settings. The page then recomputes the plan
// in the browser on every slider move with the SAME file the server uses
// (public/app/money-strategy-math.js) — no request per move.
//
// POST save_plan recomputes everything on the server from fresh reads (never
// from the browser's numbers), refuses a first month the cash cannot cover, and
// stores the plan. Its steps then show as pins on the FinanceOS timeline
// (src/finance/plan-sources/payoff.mjs).
//
// SAME TWO CALLERS AND SAME GATE AS api/money/overview.mjs:
//   * a signed-in CLIENT reads and saves their own file only. client_id comes
//     off the session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) + requireClientInOrg on client_id.
//     A client in another org is 404, not 403.
//
// Nothing here moves money. A saved plan is a plan; it pays nothing.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { strategyPayload, savePlan, readSettings } from "../../src/finance/payment-strategy.mjs";
import { CashflowInputError } from "../../src/banking/cashflow.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/** Who is asking, and for which file. Same block as api/money/payments.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client", staffId: null };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff", staffId: isUuid(staff.id) ? staff.id : null };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const load = deps.strategyPayload || strategyPayload;
  const save = deps.savePlan || savePlan;

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const who = await scope(req, res, { database, gate, body });
  if (!who) return;
  const { orgId, clientId } = who;
  const now = clock();

  try {
    if (method === "GET") {
      const payload = await load(database, { orgId, clientId, env, asOf: now });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    if (body.action !== "save_plan") return res.status(400).json({ ok: false, error: "unknown_action" });
    const read = readSettings(body);
    if (read.error) return res.status(400).json({ ok: false, error: "invalid_settings", message: read.error });

    const r = await save(database, {
      orgId,
      clientId,
      settings: read.settings,
      savedByKind: who.kind,
      savedById: who.staffId,
      env,
      asOf: now
    });
    if (!r.ok) {
      const { ok, status, ...rest } = r;
      return res.status(status || 400).json({ ok: false, ...rest });
    }
    return res.status(200).json({ ok: true, action: "save_plan", saved: r.saved, plan: r.plan });
  } catch (e) {
    if (e instanceof CashflowInputError) {
      return res.status(400).json({ ok: false, error: "invalid_parameter", message: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
