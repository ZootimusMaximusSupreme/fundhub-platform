// GET  /api/money/strategy[?client_id=<uuid>]
// POST /api/money/strategy  { action: "save_plan", method, monthly_cents, goal?, client_id? }
// POST /api/money/strategy  { action: "cancel_bill", bill_id, client_id? }
// POST /api/money/strategy  { action: "set_cancel_link", bill_id, url, client_id }   (staff only)
//
// "Cancel it for me" (Finance OS wave 4, unit CANCEL): GET also carries
// bill_cancel — every repeat bill with where its cancel ask stands (Requested /
// Working / Cancelled, read from the Fundhub team task the press opened) and
// the merchant's own cancel link when a team member saved one
// (src/banking/bill-cancel.mjs). cancel_bill opens that team task; it cancels
// nothing itself and calls no merchant. set_cancel_link is a team member saving
// the merchant's own cancel page they used.
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
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg on client_id.
//     A client in another org is 404, not 403.
//
// Nothing here moves money. A saved plan is a plan; it pays nothing.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { strategyPayload, savePlan, readSettings } from "../../src/finance/payment-strategy.mjs";
import { readBillCancel, requestBillCancel, setCancelLink } from "../../src/banking/bill-cancel.mjs";
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
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;
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
  const readCancel = deps.readBillCancel || readBillCancel;
  const askCancel = deps.requestBillCancel || requestBillCancel;
  const saveLink = deps.setCancelLink || setCancelLink;

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
      /* The repeat bills block reads on its own; a failed read is
         { ok: false } inside it and the rest of the plan still answers. */
      let billCancel;
      try { billCancel = await readCancel(database, { orgId, clientId, viewer: who.kind }); }
      catch { billCancel = { ok: false, reason: "read_failed" }; }
      return res.status(200).json({ ...payload, bill_cancel: billCancel });
    }

    if (body.action === "cancel_bill" || body.action === "set_cancel_link") {
      const billId = typeof body.bill_id === "string" ? body.bill_id.trim() : "";
      if (!isUuid(billId)) return res.status(400).json({ ok: false, error: "bad_bill_id", message: "Pick a bill from the list." });
      let r;
      if (body.action === "cancel_bill") {
        r = await askCancel(database, { orgId, clientId, billId, actor: who.kind, staffId: who.staffId, now });
      } else {
        /* A team member saves the merchant's own cancel page. A client never does. */
        if (who.kind !== "staff") return res.status(403).json({ ok: false, error: "staff_only", message: "Only the Fundhub team can save a cancel link." });
        r = await saveLink(database, { orgId, clientId, billId, url: body.url, staffId: who.staffId });
      }
      if (!r || !r.ok) {
        const error = (r && r.error) || "not_saved";
        const status = error === "bill_not_found" ? 404 : error === "bad_url" || error === "bad_bill_id" ? 400 : 500;
        const message = error === "bill_not_found" ? "That bill is not on your file anymore. Reload the page."
          : error === "bad_url" ? "Use the full link. It starts with https://"
            : "That did not save. Try again in a moment.";
        return res.status(status).json({ ok: false, error, message });
      }
      const { ok, ...rest } = r;
      return res.status(200).json({ ok: true, action: body.action, ...rest });
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
