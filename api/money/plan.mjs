// GET  /api/money/plan[?month=YYYY-MM | ?from=YYYY-MM-DD&to=YYYY-MM-DD][&client_id=<uuid>]
// POST /api/money/plan  { action: "mark", client_id, source, pin_id, status: "done" | "missed" }
//
// The FinanceOS Plan tab (/app/money-plan.html, FinanceOS.sections.plan): a month
// of dated pins — checklist steps, card and loan due dates, payments owed to
// Fundhub, and whatever plan sources are registered next to them
// (src/finance/plan-sources/index.mjs). Default window: this month (UTC).
// The read lives in src/finance/money-plan.mjs; this file gates and fetches.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads their own file only. client_id comes off the
//     SESSION; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) (owner / admin / sales_manager) +
//     requireClientInOrg on client_id. The role check is its own call;
//     requireAuth drops a `roles` key (CLAUDE.md §12).
//   A client in another org is 404, not 403.
//
// POST is STAFF ONLY. It marks one pin, and only through the source that owns
// it (markPin) — a waypoint goes through completeWaypoint() and its proof
// rules (src/finance/plan-sources/waypoints.mjs). A source with no writer
// answers 409 not_markable. Nothing here moves money.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { moneyPlan, planWindow } from "../../src/finance/money-plan.mjs";
import { markPin, MARK_STATUSES } from "../../src/finance/plan-sources/index.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const SOURCE_NAME = /^[a-z0-9-]{2,40}$/;

/** Who is asking, and for which file. Returns { orgId, clientId, kind } or
 *  writes the refusal and returns null. Same block as api/money/payments.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client" };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff" };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const build = deps.moneyPlan || moneyPlan;
  const mark = deps.markPin || markPin;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;

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
  const today = now.toISOString().slice(0, 10);

  try {
    if (method === "GET") {
      const window = planWindow(req.query || {}, today);
      if (!window.ok) return res.status(400).json({ ok: false, error: window.error, message: window.message });
      const payload = await build(database, { orgId, clientId, window, today, now, env, viewer: who.kind });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    if (who.kind !== "staff") {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Only Fundhub staff can mark a date on the plan." });
    }
    if (body.action !== "mark") return res.status(400).json({ ok: false, error: "unknown_action" });
    const source = typeof body.source === "string" ? body.source.trim() : "";
    const pinId = typeof body.pin_id === "string" ? body.pin_id.trim() : "";
    const status = typeof body.status === "string" ? body.status.trim() : "";
    if (!SOURCE_NAME.test(source)) return res.status(400).json({ ok: false, error: "source is required" });
    if (!pinId || pinId.length > 200) return res.status(400).json({ ok: false, error: "pin_id is required" });
    if (!MARK_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: "status must be done or missed" });
    }

    const r = await mark(database, { orgId, clientId, source, pinId, status, at: now, now, today });
    if (r && r.ok) return res.status(200).json({ ok: true, action: "mark", changed: r.changed === true, pin: r.pin || null });
    const reason = (r && r.reason) || "not_found";
    if (reason === "not_found") return res.status(404).json({ ok: false, error: "not_found" });
    if (reason === "unknown_source" || reason === "bad_status") return res.status(400).json({ ok: false, error: reason });
    return res.status(409).json({
      ok: false,
      error: reason,
      message: (r && r.message) || "This date cannot be marked here."
    });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
