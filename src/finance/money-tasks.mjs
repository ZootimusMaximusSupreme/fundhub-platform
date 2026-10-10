// "What to do next" — FinanceOS's list of a client's next steps
// (GET /api/money/tasks), and the "Do task" press that hands one to the money
// agent or to a person (POST /api/money/tasks, action do_task).
//
// FinanceOS wave 5, unit W5. Owner (2026-10-06): "AI tells you exactly what to
// do; press 'Do task' to assign actions to AI agents." Contract for the money
// agent (W6) and the transfer engine (W7): docs/finance/money-agent-tasks.md.
//
// NOTHING HERE INVENTS A STEP. Every task is a row that already exists, read by
// the code that already owns it:
//
//   money owed to Fundhub      clarity_payment_installments, via listClarityPayments
//                              (src/finance/clarity-payments.mjs) — the Payments tab's read
//   card and loan payments     bank_accounts + account_statement_cycles + card_liabilities,
//                              via moneyOverview (src/finance/money-overview.mjs) — the
//                              same due dates and minimums the Overview prints
//   late card payments         cardLateItem (src/finance/money-agent.mjs) — the money
//                              helper's own "no payment on file since the statement" test
//   checklist steps            client_waypoints (330) — the client's own open steps
//   funding tip                the one UnderwriteIQ sentence the Overview prints, verbatim
//   plan pins                  W1's allPins (src/finance/plan-sources/index.mjs), passed in
//                              as `pins` — see PLAN PINS below
//
// A PAYMENT ON A PLAN WITH FUNDHUB IS ITS OLDEST UNPAID ONE. allocatePayment
// pays the oldest unpaid installment first, so offering "payment 3" while
// payment 2 is unpaid would set up money that lands on payment 2. One task per
// open plan: its next unpaid payment, when it is late or due inside the window.
//
// THE WINDOW. Dated payments show when they are late or due within NEXT_DAYS.
// Checklist steps show while they are open. The list is capped at MAX_TASKS;
// `more` says how many were left off. Order: late (most late first), then by
// date, then undated steps in checklist order, then the funding tip.
//
// WHO CAN DO IT — `can_do`, one table: CAN_DO_RULES below, each row with its
// reason. In short:
//   agent   the money agent can do it. Today every agent task moves money, so
//           "Do task" writes a PROPOSAL (proposeTransfer,
//           src/finance/money-transfer-seam.mjs) that waits for the client to
//           approve that exact amount and account. Nothing moves here.
//   person  a person on our team does it: "Do task" opens a CSM task.
//   self    only the client can do it. No "Do task".
//
// PLAN PINS (W1). moneyTasks takes a `pins` function with allPins' signature;
// api/money/tasks.mjs passes PINS_PROVIDER, which runs allPins over every plan
// source except the three this file already reads directly (clarity, dues,
// waypoints — same rows, same ids). pinTasks skips those three as well, so
// nothing is counted twice; pins from every other source (bank strategy,
// funding rounds, payoff plan) become tasks.
//
// MONEY IS INTEGER CENTS. An unknown amount stays null and is never proposed.

import crypto from "node:crypto";
import { moneyOverview as defaultOverview } from "./money-overview.mjs";
import { listClarityPayments as defaultListClarity, logMoneyAction as defaultLog } from "./clarity-payments.mjs";
import { cardLateItem } from "./money-agent.mjs";
import { providerCycles } from "../workflows/finance-os-card-due-reminders.mjs";
import { daysBetween, parseIsoDate, formatIsoDate } from "../banking/statement-cycles.mjs";
import { dollars } from "../banking/card-due-reminders.mjs";
import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { proposeTransfer as defaultPropose, OPEN_STATUSES } from "./money-transfer-seam.mjs";

export const NEXT_DAYS = 14;
export const MAX_TASKS = 12;
export const CAN_DO = Object.freeze(["agent", "person", "self"]);
export const TASK_KINDS = Object.freeze(["due", "pay_down", "deposit", "open_account", "apply", "checkpoint", "other"]);
/** A CSM task opened by "Do task" carries this source_workflow — NOT the money
 *  helper's own 'money-agent', whose open tasks pause the helper's texts. */
export const STAFF_TASK_SOURCE = "money-task";
export const STAFF_TASK_ROLE = "csm";
export const TASK_ID_RE = /^[a-z][a-z0-9_-]{0,40}:[A-Za-z0-9:._-]{1,200}$/;
/** Plan sources this file reads directly; their pins are skipped. */
export const BUILT_IN_SOURCES = Object.freeze(["clarity", "dues", "waypoints"]);
export { OPEN_STATUSES };

/** Who can do what, and why. The code below follows this table. */
export const CAN_DO_RULES = Object.freeze([
  Object.freeze({
    when: "A payment with a known amount to Fundhub (a plan), or a deposit into one of the client's bank accounts that a plan pin names.",
    can_do: "agent",
    why: "The money agent can set the payment up. It is a proposal: nothing moves until the client approves that exact amount and the account it comes from."
  }),
  Object.freeze({
    when: "A card or loan payment, or a plan pin of kind pay_down.",
    can_do: "self",
    why: "Plaid Transfer cannot pay a card or a loan (W7, plaid.com/docs/transfer). The client pays it in their bank or card app; FinanceOS reminds them."
  }),
  Object.freeze({
    when: "A payment whose amount is not on file.",
    can_do: "self",
    why: "There is no exact amount to propose, so nothing can be set up. The client pays it in their bank or card app."
  }),
  Object.freeze({
    when: "Checklist step personal_loan (\"Talk to your advisor about a personal loan\").",
    can_do: "person",
    why: "The step is a talk with a person on our team."
  }),
  Object.freeze({
    when: "A plan pin of kind apply.",
    can_do: "person",
    why: "Funding applications go through a person on our team (the Capital Blueprint's closer path)."
  }),
  Object.freeze({
    when: "Any other checklist step, plan pin, or the UnderwriteIQ tip.",
    can_do: "self",
    why: "Only the client can file an LLC, get an EIN, open an account, or pay a card down from their own money."
  })
]);

/* ── small helpers ─────────────────────────────────────────────────────── */

const isInt = (v) => typeof v === "number" && Number.isSafeInteger(v);
const posCents = (v) => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return isInt(n) && n > 0 ? n : null;
};
const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The UTC calendar day of a timestamp, or null. */
export function utcDay(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && parseIsoDate(v.slice(0, 10)) && v.length === 10) return v;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function addDays(isoDay, n) {
  const d = parseIsoDate(isoDay);
  if (!d) return null;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

function sha(s, n = 12) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, n);
}

function task({
  id, title, why = null, due_on = null, kind, can_do, late_days = null, amount_cents = null,
  transfer = null, source, from, link = null, order = 0
}) {
  return {
    id,
    title,
    why,
    due_on,
    kind: TASK_KINDS.includes(kind) ? kind : "other",
    can_do,
    late_days: isInt(late_days) && late_days > 0 ? late_days : null,
    amount_cents,
    moves_money: !!transfer,
    transfer,
    source,
    from,
    link,
    assignment: null,
    _order: order
  };
}

/* ── the readers, as pure builders ─────────────────────────────────────── */

/**
 * clarityTasks(plans, { today }) — one task per open plan with Fundhub: its
 * oldest unpaid payment, when late or due inside the window. `plans` are
 * listClarityPayments() views.
 */
export function clarityTasks(plans = [], { today } = {}) {
  const out = [];
  for (const p of Array.isArray(plans) ? plans : []) {
    if (!p || p.status !== "open") continue;
    const items = Array.isArray(p.installments) ? p.installments : [];
    const next = items.find((i) => i && posCents(i.left_cents) !== null);
    if (!next || !next.id || !parseIsoDate(next.due_on)) continue;
    const n = daysBetween(today, next.due_on);
    if (n === null || n >= NEXT_DAYS) continue;
    const amount = posCents(next.left_cents);
    const owedTo = text(p.owed_to) || "Fundhub LLC";
    out.push(task({
      id: `clarity:${next.id}`,
      title: `Pay ${dollars(amount)} to ${owedTo}`,
      why: `Payment ${next.seq ?? "?"} of ${items.length} on your ${text(p.name) || "plan with Fundhub"}.`,
      due_on: next.due_on,
      kind: "due",
      can_do: "agent",
      late_days: n < 0 ? -n : null,
      amount_cents: amount,
      transfer: { to_kind: "fundhub", to_account_id: null, amount_cents: amount },
      source: "clarity",
      from: "your plan with Fundhub"
    }));
  }
  return out;
}

function paymentTask({ accountId, name, accountKind, dueOn, amount, lateDays = null, why }) {
  const known = amount !== null;
  return task({
    id: `due:${accountId}:${dueOn}`,
    title: known ? `Pay ${dollars(amount)} to ${name}` : `Pay ${name}`,
    why,
    due_on: dueOn,
    kind: "due",
    /* Cards and loans are paid by the client: Plaid Transfer cannot send money to
       them (see CAN_DO_RULES). The task is a reminder with the exact amount. */
    can_do: "self",
    late_days: lateDays,
    amount_cents: amount,
    transfer: null,
    source: "dues",
    from: accountKind === "loan" ? "your loan" : "your card statement"
  });
}

/**
 * cardTasks(cards, lateItems, { today }).
 *   cards      moneyOverview().debt.cards — due_on and min_due_cents as the Overview prints them
 *   lateItems  cardLateItem() results — cards past due with no payment on file
 * A card that is late is listed once, as late. A statement with nothing due
 * (minimum 0) is left out.
 */
export function cardTasks(cards = [], lateItems = [], { today } = {}) {
  const out = [];
  const late = new Set();
  for (const i of Array.isArray(lateItems) ? lateItems : []) {
    if (!i || !i.id || !parseIsoDate(i.dueOn) || !(i.daysLate >= 1)) continue;
    late.add(String(i.id));
    out.push(paymentTask({
      accountId: i.id,
      name: text(i.label) || "your credit card",
      accountKind: "card",
      dueOn: i.dueOn,
      amount: posCents(i.amountCents),
      lateDays: i.daysLate,
      why: "No payment is on file since your last statement."
    }));
  }
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || !c.account_id || late.has(String(c.account_id))) continue;
    const n = daysBetween(today, c.due_on);
    if (n === null || n < 0 || n >= NEXT_DAYS) continue;
    if (c.min_due_cents === 0) continue;
    const amount = posCents(c.min_due_cents);
    out.push(paymentTask({
      accountId: c.account_id,
      name: text(c.name) || (c.mask ? `card ending ${c.mask}` : "your credit card"),
      accountKind: "card",
      dueOn: c.due_on,
      amount,
      why: amount !== null ? "The minimum on your latest statement." : "The amount is not on file yet."
    }));
  }
  return out;
}

/** loanTasks(loans, { today }) — moneyOverview().debt.loans due inside the window. */
export function loanTasks(loans = [], { today } = {}) {
  const out = [];
  for (const l of Array.isArray(loans) ? loans : []) {
    if (!l || !l.account_id) continue;
    const n = daysBetween(today, l.due_on);
    if (n === null || n < 0 || n >= NEXT_DAYS) continue;
    const amount = posCents(l.payment_cents);
    out.push(paymentTask({
      accountId: l.account_id,
      name: text(l.name) || (l.mask ? `loan ending ${l.mask}` : "your loan"),
      accountKind: "loan",
      dueOn: l.due_on,
      amount,
      why: amount !== null ? "Your monthly payment." : "The payment amount is not on file yet."
    }));
  }
  return out;
}

/**
 * waypointTasks(rows, { today }) — the client's own open checklist steps
 * (owner_kind 'client'). Fundhub's own steps are ours, not the client's. The
 * no-new-credit row is a standing rule that never closes, so it is not a step.
 */
export function waypointTasks(rows = [], { today } = {}) {
  const out = [];
  (Array.isArray(rows) ? rows : []).forEach((w, i) => {
    if (!w || !w.id || !text(w.title)) return;
    if (w.owner_kind !== "client" || w.state === "done" || w.state === "skipped") return;
    if (w.verify_kind === "no_new_credit") return;
    const due = utcDay(w.due_at);
    const past = due ? daysBetween(due, today) : null;
    out.push(task({
      id: `waypoint:${w.id}`,
      title: text(w.title),
      why: text(w.detail) || "A step on your checklist.",
      due_on: due,
      kind: w.verify_kind === "paydown" ? "pay_down" : w.key === "business_checking" ? "open_account" : "checkpoint",
      can_do: w.key === "personal_loan" ? "person" : "self",
      late_days: past !== null && past > 0 ? past : null,
      source: "waypoints",
      from: "your checklist",
      link: "/progress.html",
      order: i
    }));
  });
  return out;
}

/** tipTask(tip) — the Overview's one UnderwriteIQ sentence, verbatim, or null. */
export function tipTask(tip) {
  const t = text(tip);
  if (!t) return null;
  return task({
    id: `uwiq:${sha(t)}`,
    title: t,
    why: "From UnderwriteIQ, Fundhub's funding math, on your latest credit file.",
    kind: "other",
    can_do: "self",
    source: "underwriteiq",
    from: "UnderwriteIQ"
  });
}

/**
 * pinTasks(pins, { today }) — plan pins (the board's contract shape) from every
 * source except the three read directly above.
 *   deposit / pay_down with an amount AND a destination account on the pin
 *   (`to_account_id`, the client's own account) → agent, as a proposal
 *   apply → person · anything else → self
 */
export function pinTasks(pins = [], { today } = {}) {
  const out = [];
  for (const p of Array.isArray(pins) ? pins : []) {
    if (!p || !text(p.id) || !parseIsoDate(p.date) || !text(p.title)) continue;
    if (BUILT_IN_SOURCES.includes(p.source)) continue;
    if (p.status === "done") continue;
    const n = daysBetween(today, p.date);
    if (n === null || n >= NEXT_DAYS) continue;
    const amount = posCents(p.amount_cents);
    const dest = typeof p.to_account_id === "string" && UUID.test(p.to_account_id) ? p.to_account_id : null;
    const source = typeof p.source === "string" && /^[a-z][a-z0-9_-]{0,40}$/.test(p.source) ? p.source : "plan";
    let canDo = "self";
    let transfer = null;
    if (p.kind === "deposit" && amount !== null && dest) {
      canDo = "agent";
      transfer = { to_kind: "bank_account", to_account_id: dest, amount_cents: amount };
    } else if (p.kind === "apply") {
      canDo = "person";
    }
    out.push(task({
      id: TASK_ID_RE.test(p.id) ? p.id : `${source}:${sha(p.id, 16)}`,
      title: text(p.title),
      why: text(p.detail),
      due_on: p.date,
      kind: p.kind,
      can_do: canDo,
      late_days: n < 0 ? -n : null,
      amount_cents: amount,
      transfer,
      source,
      from: "your plan"
    }));
  }
  return out;
}

/** Late (most late first), then by date, then undated steps in order, then the tip. */
export function sortTasks(list = []) {
  const rank = (t) => (t.late_days > 0 ? 0 : t.due_on ? 1 : t.source === "underwriteiq" ? 3 : 2);
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0 && a.late_days !== b.late_days) return b.late_days - a.late_days;
    if (ra <= 1 && a.due_on !== b.due_on) return String(a.due_on) < String(b.due_on) ? -1 : 1;
    if (ra === 2 && a._order !== b._order) return a._order - b._order;
    const t = String(a.title).localeCompare(String(b.title));
    if (t !== 0) return t;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/** Every reader's output → one list, de-duplicated by id (first wins), sorted. */
export function buildTasks({
  today, plans = [], cards = [], loans = [], lateCards = [], waypoints = [], tip = null, pins = []
} = {}) {
  const all = [
    ...clarityTasks(plans, { today }),
    ...cardTasks(cards, lateCards, { today }),
    ...loanTasks(loans, { today }),
    ...waypointTasks(waypoints, { today }),
    ...pinTasks(pins, { today })
  ];
  const tipT = tipTask(tip);
  if (tipT) all.push(tipT);
  const seen = new Map();
  for (const t of all) if (!seen.has(t.id)) seen.set(t.id, t);
  return sortTasks([...seen.values()]);
}

/* ── assignments: what "Do task" already did ───────────────────────────── */

/** One money_agent_tasks row (joined to its CSM task) → what the page shows. */
export function assignmentView(row) {
  if (!row || !row.id) return null;
  // A person's row closes when its CSM task is done. The row itself is
  // closed the next time "Do task" is pressed on that task (doTask).
  const staffDone = row.assignee === "person" && row.status === "queued" && row.staff_done === true;
  const status = staffDone ? "done" : String(row.status);
  const result = row.result && typeof row.result === "object" ? row.result : {};
  const msg = typeof result.client_message === "string" && result.client_message.trim()
    ? result.client_message.trim().slice(0, 200) : null;
  return {
    id: String(row.id),
    assignee: row.assignee === "person" ? "person" : "agent",
    status,
    open: OPEN_STATUSES.includes(status),
    moves_money: !!row.moves_money,
    amount_cents: posCents(row.amount_cents),
    to_kind: row.to_kind || null,
    created_at: iso(row.created_at),
    done_at: iso(row.done_at) || (staffDone ? iso(row.staff_updated_at) : null),
    message: status === "failed" || status === "cancelled" ? msg : null
  };
}

/** Newest assignment per task id onto each task. `rows` come newest first. */
export function attachAssignments(tasks = [], rows = []) {
  const latest = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.task_key && !latest.has(r.task_key)) latest.set(r.task_key, r);
  }
  return tasks.map((t) => ({ ...t, assignment: assignmentView(latest.get(t.id)) }));
}

export async function readAssignments(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT m.id, m.task_key, m.assignee, m.status, m.moves_money, m.amount_cents, m.to_kind,
            m.created_at, m.done_at, m.result, t.done AS staff_done, t.updated_at AS staff_updated_at
       FROM money_agent_tasks m
       LEFT JOIN tasks t ON t.id = m.staff_task_id AND t.org_id = m.org_id
      WHERE m.org_id = $1 AND m.client_id = $2
      ORDER BY m.created_at DESC, m.id
      LIMIT 200`,
    [orgId, clientId]
  );
  return r.rows;
}

/** The client's open checklist steps (their own, not Fundhub's). */
export async function readOpenWaypoints(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, key, title, detail, owner_kind, state, due_at, verify_kind, position
       FROM client_waypoints
      WHERE org_id = $1 AND client_id = $2
        AND owner_kind = 'client'
        AND state NOT IN ('done', 'skipped')
        AND COALESCE(verify_kind, '') <> 'no_new_credit'
      ORDER BY due_at ASC NULLS LAST, position ASC, key ASC
      LIMIT 40`,
    [orgId, clientId]
  );
  return r.rows;
}

/** Late card items, by the money helper's own rule. */
export async function readLateCards(db, { orgId, clientId, today }) {
  const rows = await providerCycles(db, { orgId, clientId });
  return rows.map((row) => cardLateItem(row, today)).filter(Boolean);
}

/* ── the read ──────────────────────────────────────────────────────────── */

/**
 * collectTasks — every task for one client, unsliced, with the sources report.
 * null when the client is not in this org.
 */
export async function collectTasks(db, {
  orgId, clientId, env = process.env, asOf = new Date(), pins = null,
  overview = defaultOverview, listClarity = defaultListClarity, readWaypoints = readOpenWaypoints,
  lateCards = readLateCards, assignments = readAssignments, log = (m) => console.error(m)
} = {}) {
  const now = new Date(asOf);
  const today = now.toISOString().slice(0, 10);
  const ov = await overview(db, { orgId, clientId, env, asOf: now });
  if (!ov) return null;

  const sources = [{ name: "dues", ok: true }, { name: "underwriteiq", ok: true }];
  const guarded = (name, fn) => Promise.resolve()
    .then(fn)
    .then((v) => { sources.push({ name, ok: true }); return v; },
      (e) => {
        log(`money tasks: ${name} failed: ${e && e.message ? e.message : e}`);
        sources.push({ name, ok: false, error: "load_failed" });
        return null;
      });

  const [plans, late, waypoints, pinOut, rows] = await Promise.all([
    guarded("clarity", () => listClarity(db, { orgId, clientId, today })),
    guarded("late_cards", () => lateCards(db, { orgId, clientId, today })),
    guarded("waypoints", () => readWaypoints(db, { orgId, clientId })),
    typeof pins === "function"
      ? guarded("plan", () => pins(db, { orgId, clientId, from: addDays(today, -60), to: addDays(today, NEXT_DAYS), env, now, today }))
      : Promise.resolve(null),
    assignments(db, { orgId, clientId })
  ]);

  const tasks = buildTasks({
    today,
    plans: plans || [],
    cards: ov.debt?.cards || [],
    loans: ov.debt?.loans || [],
    lateCards: late || [],
    waypoints: waypoints || [],
    tip: ov.tip ?? null,
    pins: Array.isArray(pinOut) ? pinOut : (pinOut && Array.isArray(pinOut.pins) ? pinOut.pins : [])
  });
  /* allPins reports each plan source on its own; one that failed makes the
     plan part "not loaded", never an empty plan. */
  const planParts = pinOut && Array.isArray(pinOut.sources)
    ? pinOut.sources.filter((x) => x && x.ok === false).map((x) => String(x.name || "plan"))
    : [];
  const planEntry = sources.find((x) => x.name === "plan");
  if (planEntry && planParts.length) {
    planEntry.ok = false;
    planEntry.error = "load_failed";
    planEntry.parts = planParts;
  }
  const order = ["clarity", "dues", "late_cards", "waypoints", "plan", "underwriteiq"];
  sources.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return { client: ov.client, now, today, all: attachAssignments(tasks, rows || []), sources };
}

function strip(t) {
  const { _order, ...rest } = t;
  void _order;
  return rest;
}

/**
 * moneyTasks — GET /api/money/tasks. null when the client is not in this org.
 */
export async function moneyTasks(db, opts = {}) {
  const c = await collectTasks(db, opts);
  if (!c) return null;
  const shown = c.all.slice(0, MAX_TASKS);
  return {
    ok: true,
    client: c.client,
    as_of: c.now.toISOString(),
    today: c.today,
    window_days: NEXT_DAYS,
    tasks: shown.map(strip),
    more: Math.max(0, c.all.length - shown.length),
    sources: c.sources
  };
}

/* ── "Do task" ─────────────────────────────────────────────────────────── */

async function insertAssignment(db, row) {
  const ins = await db.query(
    `INSERT INTO money_agent_tasks
       (org_id, client_id, task_key, kind, title, why, due_on, source,
        assignee, status, moves_money, requested_by_kind, requested_by_staff_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, 'queued', false, $10, $11, $12::jsonb)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      row.orgId, row.clientId, row.taskKey, row.kind, row.title, row.why ?? null, row.dueOn ?? null, row.source,
      row.assignee, row.requestedByKind, row.requestedByStaffId ?? null, row.detail ? JSON.stringify(row.detail) : null
    ]
  );
  if (ins.rows[0]) return { id: String(ins.rows[0].id), created: true };
  const open = await db.query(
    `SELECT id FROM money_agent_tasks
      WHERE org_id = $1 AND client_id = $2 AND task_key = $3 AND status = ANY($4::text[])
      ORDER BY created_at DESC LIMIT 1`,
    [row.orgId, row.clientId, row.taskKey, [...OPEN_STATUSES]]
  );
  return open.rows[0] ? { id: String(open.rows[0].id), created: false } : null;
}

/**
 * doTask — hand one task to the money agent or to a person.
 *
 * The task is looked up in the client's OWN list, rebuilt here from the
 * database. Nothing the browser sends — a title, an amount, an account — is
 * used. So a forged amount cannot become a proposal.
 *
 *   agent + moves money → proposeTransfer (status needs_approval). No money moves.
 *   agent, no money     → a 'queued' row for the money agent (W6) to claim.
 *   person              → a 'queued' row + a CSM task (source 'money-task').
 *   self                → refused: only the client can do it.
 * One open row per task: a second press answers with the open one. A payment
 * already finished for that task is not set up again.
 *
 * @returns {Promise<{ ok: true, created: boolean, task: object }
 *                 | { ok: false, error: string, reason?: string }>}
 */
export async function doTask(db, {
  orgId, clientId, taskId, actor = "client", staffId = null, env = process.env, asOf = new Date(), pins = null,
  collect = collectTasks, propose = defaultPropose, createTask = defaultCreateTask, log = defaultLog, deps = {}
} = {}) {
  if (typeof taskId !== "string" || !TASK_ID_RE.test(taskId)) return { ok: false, error: "bad_task_id" };
  const rowsOf = deps.assignments || readAssignments;
  const c = await collect(db, { orgId, clientId, env, asOf, pins, ...deps });
  if (!c) return { ok: false, error: "not_found" };
  const t = c.all.find((x) => x.id === taskId);
  if (!t) return { ok: false, error: "task_not_found" };
  if (t.can_do === "self") return { ok: false, error: "self_task" };

  const a = t.assignment;
  if (a && a.open) return { ok: true, created: false, task: strip(t) };
  // A payment the agent already finished for this exact due date is never set
  // up twice. (The step can still be on the list until the next statement lands.)
  if (a && a.moves_money && a.status === "done") return { ok: true, created: false, task: strip(t) };
  if (a && a.assignee === "person" && a.status === "done") {
    // Its CSM task is done: close the row so the task can be handed over again.
    await db.query(
      `UPDATE money_agent_tasks SET status = 'done', done_at = now()
        WHERE id = $1 AND org_id = $2 AND client_id = $3 AND assignee = 'person' AND status = 'queued'`,
      [a.id, orgId, clientId]
    );
  }

  const byStaff = actor === "staff";
  const base = {
    orgId, clientId,
    taskKey: t.id, kind: t.kind, title: String(t.title).slice(0, 300), why: t.why, dueOn: t.due_on, source: t.source,
    requestedByKind: byStaff ? "staff" : "client",
    requestedByStaffId: byStaff && UUID.test(String(staffId || "")) ? staffId : null,
    detail: { from: t.from, late_days: t.late_days, can_do: t.can_do, built_on: c.today }
  };

  let row;
  let staffTaskId = null;
  if (t.can_do === "agent" && t.moves_money && t.transfer) {
    const r = await propose(db, {
      ...base,
      amountCents: t.transfer.amount_cents,
      toKind: t.transfer.to_kind,
      toAccountId: t.transfer.to_account_id
    });
    if (!r || !r.ok) return { ok: false, error: "proposal_refused", reason: r?.reason || "unknown" };
    row = { id: r.proposalId, created: !!r.created };
  } else if (t.can_do === "agent") {
    row = await insertAssignment(db, { ...base, assignee: "agent" });
  } else {
    row = await insertAssignment(db, { ...base, assignee: "person" });
    if (row && row.created) {
      const st = await createTask(db, {
        orgId, clientId,
        title: `FinanceOS: ${String(t.title).slice(0, 180)}`,
        sourceWorkflow: STAFF_TASK_SOURCE,
        assigneeRole: STAFF_TASK_ROLE,
        eventId: `money-task:${row.id}`,
        dueAt: t.due_on || null
      });
      staffTaskId = st?.id || null;
      if (staffTaskId) {
        await db.query(`UPDATE money_agent_tasks SET staff_task_id = $2 WHERE id = $1`, [row.id, staffTaskId]);
      }
    }
  }
  if (!row) return { ok: false, error: "not_saved" };

  if (row.created) {
    const amount = t.moves_money ? t.transfer.amount_cents : null;
    const entry = await log(db, {
      orgId, clientId,
      itemKind: "money_task",
      itemId: row.id,
      itemLabel: String(t.title).slice(0, 200),
      decidedOn: c.today,
      action: "task_assigned",
      actor: byStaff ? "staff" : "client",
      reason: t.moves_money
        ? `set up for your OK: ${dollars(amount)}`
        : t.can_do === "person" ? "to a person on our team" : "to your money helper",
      amountCents: amount,
      idempotencyKey: `money-task:${row.id}:assigned`,
      detail: { task_key: t.id, assignee: t.can_do, moves_money: t.moves_money, to_kind: t.transfer?.to_kind || null, source: t.source }
    });
    if (entry?.created && entry.id && staffTaskId) {
      await db.query(`UPDATE money_agent_log SET task_id = $2 WHERE id = $1`, [entry.id, staffTaskId]);
    }
  }

  const fresh = await rowsOf(db, { orgId, clientId });
  const mine = fresh.find((r) => String(r.id) === String(row.id));
  return { ok: true, created: row.created, task: strip({ ...t, assignment: assignmentView(mine) || null }) };
}

export default { moneyTasks, collectTasks, doTask, buildTasks, CAN_DO_RULES, NEXT_DAYS };
