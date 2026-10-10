// GET  /api/money/payments[?client_id=<uuid>]
// POST /api/money/payments  { action, client_id?, ... }
//
// The Payments page (/app/money-payments.html): Clarity Payments — money a
// client owes Fundhub LLC or a subsidiary, incl. BNPL — with their schedules
// and late status, what is coming up (cards and bills, from the overview read),
// and what the money helper did (money_agent_log).
//
// A Commas payment to Fundhub marks an installment paid on its own
// (src/finance/clarity-autopay.mjs): its log row carries via: "commas" and the
// page says "Paid via Commas". A Commas payment that could not be tied to a
// plan is listed for STAFF only, under unmatched_payments.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT reads their own file only. client_id comes off the
//     session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg on client_id.
//
// POST actions:
//   ask_for_person    client OR staff — opens a CSM task; the helper stops texting
//   add_plan          staff only — { kind, owed_to?, label?, installments: [{ due_on, amount_cents }] }
//   record_payment    staff only — { plan_id, amount_cents, paid_at? }
//   mark_settled      staff only — { plan_id }
//
// Nothing here moves money. "Record a payment" writes down one staff saw land.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { moneyOverview, UPCOMING_DAYS } from "../../src/finance/money-overview.mjs";
import { daysBetween } from "../../src/banking/statement-cycles.mjs";
import {
  listClarityPayments, addClarityPayment, recordClarityPayment, settleClarityPayment,
  logMoneyAction, readMoneyLog, readUnmatchedPayments, ClarityInputError
} from "../../src/finance/clarity-payments.mjs";
import { askForPerson } from "../../src/finance/money-agent.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

const STAFF_ACTIONS = new Set(["add_plan", "record_payment", "mark_settled"]);
const ALL_ACTIONS = new Set([...STAFF_ACTIONS, "ask_for_person"]);

/** Who is asking, and for which file. Returns { orgId, clientId, kind, staffId }
 *  or writes the refusal and returns null. */
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

/** GET payload builder — exported for tests and the fixture server. */
export async function paymentsPayload(database, {
  orgId, clientId, asOf, env, staff = false,
  overview = moneyOverview, list = listClarityPayments, readLog = readMoneyLog, readUnmatched = readUnmatchedPayments
}) {
  const today = asOf.toISOString().slice(0, 10);
  const [plans, ov, log, unmatched] = await Promise.all([
    list(database, { orgId, clientId, today }),
    overview(database, { orgId, clientId, env, asOf }),
    readLog(database, { orgId, clientId, limit: 25 }),
    staff ? readUnmatched(database, { orgId, clientId, limit: 25 }) : Promise.resolve(null)
  ]);
  if (!ov) return null;
  const open = plans.filter((p) => p.status === "open");
  /* Each open plan's next payment that is not already late, inside the same
     30-day window the overview's own list uses. Late ones live on the plan. */
  const comingClarity = open
    .map((p) => ({ p, i: (p.installments || []).find((x) => x.left_cents > 0 && x.state !== "late") }))
    .filter(({ i }) => i && i.due_on && daysBetween(today, i.due_on) < UPCOMING_DAYS)
    .map(({ p, i }) => ({ type: "clarity", name: p.name, on: i.due_on, amount_cents: i.left_cents, plan_id: p.id }));
  const upcoming = [...comingClarity, ...(Array.isArray(ov.upcoming) ? ov.upcoming : [])]
    .sort((a, b) => String(a.on || "9999").localeCompare(String(b.on || "9999")));
  return {
    ok: true,
    client: ov.client,
    as_of: asOf.toISOString(),
    owed: {
      open_count: open.length,
      left_cents: open.reduce((s, p) => s + (p.left_cents || 0), 0),
      late_cents: open.reduce((s, p) => s + (p.late_cents || 0), 0),
      late_count: open.filter((p) => p.is_late).length
    },
    plans,
    upcoming,
    agent_log: log,
    // Staff only: Commas payments the matcher would not guess at.
    ...(staff ? { unmatched_payments: unmatched || [] } : {}),
    agent: { brain: "rules" }
  };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const store = {
    list: deps.listClarityPayments || listClarityPayments,
    add: deps.addClarityPayment || addClarityPayment,
    record: deps.recordClarityPayment || recordClarityPayment,
    settle: deps.settleClarityPayment || settleClarityPayment,
    log: deps.logMoneyAction || logMoneyAction,
    readLog: deps.readMoneyLog || readMoneyLog,
    readUnmatched: deps.readUnmatchedPayments || readUnmatchedPayments,
    ask: deps.askForPerson || askForPerson,
    overview: deps.moneyOverview || moneyOverview
  };

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
      const payload = await paymentsPayload(database, {
        orgId, clientId, asOf: now, env, staff: who.kind === "staff",
        overview: store.overview, list: store.list, readLog: store.readLog, readUnmatched: store.readUnmatched
      });
      if (!payload) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(payload);
    }

    const action = String(body.action || "");
    if (!ALL_ACTIONS.has(action)) return res.status(400).json({ ok: false, error: "unknown_action" });
    if (STAFF_ACTIONS.has(action) && who.kind !== "staff") {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Only Fundhub staff can change a payment plan." });
    }

    if (action === "ask_for_person") {
      const r = await store.ask(database, { orgId, clientId, todayIso: today, note: typeof body.note === "string" ? body.note : null });
      return res.status(200).json({ ok: true, action, created: !!r.created });
    }

    if (action === "add_plan") {
      const r = await store.add(database, { orgId, clientId, input: body, staffId: who.staffId });
      await store.log(database, {
        orgId, clientId, itemKind: "clarity_payment", itemId: r.id, itemLabel: r.plan.label || r.plan.kind,
        decidedOn: today, action: "plan_added", actor: "staff", amountCents: r.plan.original_cents,
        reason: `${r.plan.installments.length} payments owed to ${r.plan.owed_to}`
      });
      return res.status(201).json({ ok: true, action, id: r.id });
    }

    if (!isUuid(body.plan_id)) return res.status(400).json({ ok: false, error: "plan_id is required and must be a uuid" });

    if (action === "record_payment") {
      const cents = Number(body.amount_cents);
      const paidAt = body.paid_at && !Number.isNaN(Date.parse(body.paid_at)) ? new Date(body.paid_at) : now;
      const r = await store.record(database, { orgId, clientId, planId: body.plan_id, amountCents: cents, paidAt });
      if (!r.ok) return planError(res, r.error);
      await store.log(database, {
        orgId, clientId, itemKind: "clarity_payment", itemId: body.plan_id, itemLabel: r.plan?.label || r.plan?.kind || null,
        decidedOn: today, action: "payment_recorded", actor: "staff", amountCents: cents,
        reason: r.settled ? "payment recorded; plan paid in full" : "payment recorded"
      });
      return res.status(200).json({ ok: true, action, settled: r.settled, applied: r.moves });
    }

    // mark_settled
    const r = await store.settle(database, { orgId, clientId, planId: body.plan_id, at: now });
    if (!r.ok) return planError(res, r.error);
    await store.log(database, {
      orgId, clientId, itemKind: "clarity_payment", itemId: body.plan_id, itemLabel: r.plan?.label || r.plan?.kind || null,
      decidedOn: today, action: "plan_settled", actor: "staff", reason: "marked settled by staff"
    });
    return res.status(200).json({ ok: true, action });
  } catch (e) {
    if (e instanceof ClarityInputError) return res.status(400).json({ ok: false, error: e.code, message: e.message });
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (e && e.code === "23514") return res.status(400).json({ ok: false, error: "schedule_mismatch", message: "The payments must add up to the plan." });
    if (dbDown(res, e)) return;
    throw e;
  }
}

function planError(res, error) {
  if (error === "not_found") return res.status(404).json({ ok: false, error });
  if (error === "conflict") return res.status(409).json({ ok: false, error, message: "Someone else just changed this plan. Reload and try again." });
  return res.status(409).json({ ok: false, error, message: "That plan is already closed." });
}
