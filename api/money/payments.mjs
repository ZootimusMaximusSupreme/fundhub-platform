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
//
// PHONE ALERTS (unit D2, owner-set 2026-11-07). GET also answers `phone`: whether
// the client's phone alerts are on, and for each open plan the day its next
// installment's phone alert goes (src/push/finance-alerts.mjs phoneSummary; the
// daily file-alerts pass queues it 3 days ahead, the dispatcher sends it 9 to 5
// Arizona). null when that read failed — the page then says it could not check.
//
// WHOP PLANS (unit W, owner ask 2026-11-07). GET also answers `whop`: the plans the
// client pays Fundhub on Whop, saved by the daily Whop read (src/finance/whop-plans.mjs,
// whop_memberships), each with its phone alert day from the same phone summary. Their
// next charges join `upcoming` as type "whop". null when that read failed. No Whop call
// is made here.
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
import { phoneSummary } from "../../src/push/finance-alerts.mjs";
import { listWhopPlans, whopPlansBlock } from "../../src/finance/whop-plans.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { cardPayNow, recordCardPaid, withdrawCardPaid } from "../../src/finance/card-pay-now.mjs";

const STAFF_ACTIONS = new Set(["add_plan", "record_payment", "mark_settled"]);
/* card_paid / card_paid_undo: "I paid" on a card's due row (unit I6), client or staff. */
const ALL_ACTIONS = new Set([...STAFF_ACTIONS, "ask_for_person", "card_paid", "card_paid_undo"]);

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
/** Each open plan's next installment: the day its phone alert goes, or why none, and what already went. Pure. */
export function planPhoneView(plans = [], summary, today) {
  if (!summary) return null;
  const on = summary.enabled !== false && !summary.opted_out;
  const days = Number.isInteger(summary.days_before) ? summary.days_before : 3;
  const out = {};
  for (const p of plans) {
    if (p.status !== "open" || !p.next || !p.next.due_on) continue;
    const inst = (p.installments || []).find((i) => i.seq === p.next.seq) || null;
    const until = daysBetween(today, p.next.due_on);
    const sent = (summary.sent || []).find((a) => inst && a.subject_id === String(inst.id) && a.about_on === p.next.due_on);
    out[p.id] = {
      due_on: p.next.due_on,
      alert_on: !on || until === null || until < 0 ? null : until <= days ? today : addDays(p.next.due_on, -days),
      reason: !on ? (summary.opted_out ? "opted_out" : "phone_alerts_off") : until !== null && until < 0 ? "late" : null,
      sent: sent ? sent.state : null
    };
  }
  return out;
}

function addDays(iso, n) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? new Date(t + n * 86_400_000).toISOString().slice(0, 10) : null;
}

export async function paymentsPayload(database, {
  orgId, clientId, asOf, env, staff = false,
  overview = moneyOverview, list = listClarityPayments, readLog = readMoneyLog, readUnmatched = readUnmatchedPayments,
  phone = phoneSummary, whop = listWhopPlans
}) {
  const today = asOf.toISOString().slice(0, 10);
  const [plans, ov, log, unmatched, summary, whopRows] = await Promise.all([
    list(database, { orgId, clientId, today }),
    overview(database, { orgId, clientId, env, asOf }),
    readLog(database, { orgId, clientId, limit: 25 }),
    staff ? readUnmatched(database, { orgId, clientId, limit: 25 }) : Promise.resolve(null),
    // A phone read that fails answers null, never a made-up "no phone".
    Promise.resolve().then(() => phone(database, { orgId, clientId })).catch(() => null),
    // A Whop read that fails answers null, never a made-up "no plans".
    Promise.resolve().then(() => whop(database, { orgId, clientId })).catch(() => null)
  ]);
  if (!ov) return null;
  const whopBlock = whopPlansBlock(whopRows, summary, today);
  const open = plans.filter((p) => p.status === "open");
  /* Each open plan's next payment that is not already late, inside the same
     30-day window the overview's own list uses. Late ones live on the plan. */
  const comingClarity = open
    .map((p) => ({ p, i: (p.installments || []).find((x) => x.left_cents > 0 && x.state !== "late") }))
    .filter(({ i }) => i && i.due_on && daysBetween(today, i.due_on) < UPCOMING_DAYS)
    .map(({ p, i }) => ({ type: "clarity", name: p.name, on: i.due_on, amount_cents: i.left_cents, plan_id: p.id }));
  const upcoming = [...comingClarity, ...(whopBlock ? whopBlock.upcoming : []), ...(Array.isArray(ov.upcoming) ? ov.upcoming : [])]
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
    phone: summary
      ? { enabled: summary.enabled !== false, opted_out: !!summary.opted_out, has_phone: summary.has_phone ?? null,
        days_before: summary.days_before ?? 3, plans: planPhoneView(plans, summary, today) }
      : null,
    whop: whopBlock,
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
    phone: deps.phoneSummary || phoneSummary,
    whop: deps.listWhopPlans || listWhopPlans,
    ask: deps.askForPerson || askForPerson,
    overview: deps.moneyOverview || moneyOverview
  };
  /* "Pay now" / "I paid" (unit I6, 2026-11-07) — src/finance/card-pay-now.mjs.
     GET ?part=pay_now answers only { ok, pay_now }: each open card, the card
     company's own website from Plaid (or null), and its "I paid" status.
     Plaid cannot pay a card (see that file), so nothing here moves money. */
  const payNow = {
    read: deps.cardPayNow || cardPayNow,
    record: deps.recordCardPaid || recordCardPaid,
    withdraw: deps.withdrawCardPaid || withdrawCardPaid
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
      if (req.query && req.query.part === "pay_now") {
        const pay = await payNow.read(database, { orgId, clientId, asOf: now });
        if (!pay) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, pay_now: pay });
      }
      const payload = await paymentsPayload(database, {
        orgId, clientId, asOf: now, env, staff: who.kind === "staff",
        overview: store.overview, list: store.list, readLog: store.readLog, readUnmatched: store.readUnmatched,
        phone: store.phone, whop: store.whop
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

    /* "I paid": { account_id, due_on, paid_on?, amount_cents? }. "Undo": { claim_id }.
       Both answer with the fresh pay_now block so the row repaints from one shape. */
    if (action === "card_paid" || action === "card_paid_undo") {
      const r = action === "card_paid"
        ? await payNow.record(database, { orgId, clientId, input: body, byKind: who.kind, staffId: who.staffId, today })
        : await payNow.withdraw(database, { orgId, clientId, claimId: body.claim_id });
      if (!r.ok) {
        const status = r.error === "card_not_found" || r.error === "claim_not_found" ? 404 : 400;
        return res.status(status).json({ ok: false, error: r.error, message: r.message });
      }
      const pay = await payNow.read(database, { orgId, clientId, asOf: now });
      return res.status(200).json({ ok: true, action, claim: r.claim || null, pay_now: pay });
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
