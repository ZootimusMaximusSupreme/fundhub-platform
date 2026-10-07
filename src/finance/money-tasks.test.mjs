// "What to do next" + "Do task" (src/finance/money-tasks.mjs) — the builders,
// who-can-do-it, the plan-pin seam, and the routing of a press. No network, no
// Postgres: stubbed reads and an in-memory recorder for writes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NEXT_DAYS, MAX_TASKS, CAN_DO, CAN_DO_RULES, STAFF_TASK_SOURCE, STAFF_TASK_ROLE, TASK_ID_RE,
  clarityTasks, cardTasks, loanTasks, waypointTasks, tipTask, pinTasks, sortTasks, buildTasks,
  assignmentView, attachAssignments, collectTasks, moneyTasks, doTask, addDays
} from "./money-tasks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_464 = fs.readFileSync(path.resolve(HERE, "../../db/migrations/464_money_agent_tasks.sql"), "utf8");

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const TODAY = "2026-10-07";
const AMEX = "d6ce2c94-3632-4c63-af98-802fef41ac62";
const VISA = "f26a03e9-698d-4e58-9ba7-4d2a3a9fc9ea";
const LOAN = "6af70e59-db5c-4220-95b7-69f6a4a87ff8";
const STAFF = "5aff0000-0000-4000-8000-000000000001";

/* The test client's Fundhub plan, as listClarityPayments returns it on Oct 7:
   payment 1 paid, payment 2 ($500, Oct 3) unpaid and late, payment 3 coming. */
const PLAN = {
  id: "a159a137-ac24-4398-9f83-e236c36f6126", kind: "clarity", owed_to: "Fundhub LLC", label: null,
  name: "Fundhub payment plan", status: "open",
  installments: [
    { id: "i-1", seq: 1, due_on: "2026-09-03", amount_cents: 50000, paid_cents: 50000, left_cents: 0, state: "paid" },
    { id: "824c8cf7-3885-4570-8e72-4858aca547d5", seq: 2, due_on: "2026-10-03", amount_cents: 50000, paid_cents: 0, left_cents: 50000, state: "late", days_late: 4 },
    { id: "i-3", seq: 3, due_on: "2026-11-03", amount_cents: 50000, paid_cents: 0, left_cents: 50000, state: "upcoming" }
  ]
};

describe("the readers", () => {
  test("a plan with Fundhub: one task, its OLDEST unpaid payment, late in days, a proposal to Fundhub", () => {
    const out = clarityTasks([PLAN], { today: TODAY });
    assert.equal(out.length, 1);
    const t = out[0];
    assert.equal(t.id, "clarity:824c8cf7-3885-4570-8e72-4858aca547d5");
    assert.equal(t.title, "Pay $500.00 to Fundhub LLC");
    assert.equal(t.why, "Payment 2 of 3 on your Fundhub payment plan.");
    assert.equal(t.late_days, 4);
    assert.equal(t.can_do, "agent");
    assert.equal(t.moves_money, true);
    assert.deepEqual(t.transfer, { to_kind: "fundhub", to_account_id: null, amount_cents: 50000 });
  });

  test("a plan's next payment far off, a settled plan, and a fully paid plan give no task", () => {
    const later = { ...PLAN, installments: [PLAN.installments[0], { ...PLAN.installments[2], due_on: addDays(TODAY, NEXT_DAYS) }] };
    assert.equal(clarityTasks([later], { today: TODAY }).length, 0);
    assert.equal(clarityTasks([{ ...PLAN, status: "settled" }], { today: TODAY }).length, 0);
    const paid = { ...PLAN, installments: [PLAN.installments[0]] };
    assert.equal(clarityTasks([paid], { today: TODAY }).length, 0);
    const soon = { ...PLAN, installments: [PLAN.installments[0], { ...PLAN.installments[2], due_on: addDays(TODAY, NEXT_DAYS - 1) }] };
    assert.equal(clarityTasks([soon], { today: TODAY })[0].late_days, null);
  });

  test("cards: due inside the window with the statement minimum; a late card once, as late; minimum 0 left out", () => {
    const cards = [
      { account_id: AMEX, name: "Business Amex", due_on: "2026-10-15", min_due_cents: 13500 },
      { account_id: VISA, name: "Personal Visa", due_on: "2026-10-25", min_due_cents: 4000 },
      { account_id: "c0ffee00-0000-4000-8000-000000000003", name: "Zero card", due_on: "2026-10-10", min_due_cents: 0 },
      { account_id: "c0ffee00-0000-4000-8000-000000000004", name: "Paid card", due_on: "2026-10-01", min_due_cents: 2500 }
    ];
    const late = [{ id: "c0ffee00-0000-4000-8000-000000000005", label: "Old Card", dueOn: "2026-10-02", daysLate: 5, amountCents: 3500 }];
    const out = cardTasks(cards, late, { today: TODAY });
    assert.deepEqual(out.map((t) => t.id), [
      "due:c0ffee00-0000-4000-8000-000000000005:2026-10-02",
      `due:${AMEX}:2026-10-15`
    ], "Visa is 18 days out, the zero card owes nothing, the past date is not called late without the late test");
    assert.equal(out[0].late_days, 5);
    assert.equal(out[0].why, "No payment is on file since your last statement.");
    assert.equal(out[1].title, "Pay $135.00 to Business Amex");
    // Plaid Transfer cannot pay a card: the step is the client's own, with the exact amount.
    assert.equal(out[1].can_do, "self");
    assert.equal(out[1].transfer, null);
    assert.equal(out[1].moves_money, false);
    assert.equal(out[1].amount_cents, 13500);
  });

  test("an unknown amount is never proposed: the step is the client's own", () => {
    const out = cardTasks([{ account_id: AMEX, name: "Business Amex", due_on: "2026-10-15", min_due_cents: null }], [], { today: TODAY });
    assert.equal(out[0].can_do, "self");
    assert.equal(out[0].transfer, null);
    assert.equal(out[0].moves_money, false);
    assert.equal(out[0].amount_cents, null);
    assert.equal(out[0].title, "Pay Business Amex");
  });

  test("loans: the monthly payment inside the window", () => {
    const out = loanTasks([{ account_id: LOAN, name: "SBA Loan", due_on: "2026-10-12", payment_cents: 105000 }], { today: TODAY });
    assert.equal(out[0].title, "Pay $1,050.00 to SBA Loan");
    assert.equal(out[0].from, "your loan");
    // Plaid Transfer cannot pay a loan either: a reminder with the exact payment.
    assert.equal(out[0].can_do, "self");
    assert.equal(out[0].transfer, null);
    assert.equal(out[0].amount_cents, 105000);
    assert.equal(loanTasks([{ account_id: LOAN, name: "SBA Loan", due_on: "2026-11-01", payment_cents: 105000 }], { today: TODAY }).length, 0);
  });

  test("checklist: the client's own open steps; the advisor talk is a person; no-new-credit and Fundhub's steps are not listed", () => {
    const rows = [
      { id: "w1", key: "paydown_chase", title: "Pay CHASE down to $1,000", detail: "You do not have to do it in one payment.", owner_kind: "client", state: "not_started", due_at: "2026-10-01T00:00:00Z", verify_kind: "paydown" },
      { id: "w2", key: "personal_loan", title: "Talk to your advisor about a personal loan", detail: null, owner_kind: "client", state: "in_progress", due_at: null, verify_kind: null },
      { id: "w3", key: "no_new_credit", title: "Do not open new credit while we work on your file", owner_kind: "client", state: "not_started", verify_kind: "no_new_credit" },
      { id: "w4", key: "blueprint_dispute_round_1", title: "We mail your round 1 letters", owner_kind: "fundhub", state: "not_started" },
      { id: "w5", key: "get_ein", title: "Get your EIN from the IRS", owner_kind: "client", state: "done" }
    ];
    const out = waypointTasks(rows, { today: TODAY });
    assert.deepEqual(out.map((t) => t.id), ["waypoint:w1", "waypoint:w2"]);
    assert.equal(out[0].can_do, "self");
    assert.equal(out[0].kind, "pay_down");
    assert.equal(out[0].late_days, 6);
    assert.equal(out[0].link, "/progress.html");
    assert.equal(out[0].moves_money, false, "a paydown step names a credit-file card, not an account money can be sent to");
    assert.equal(out[1].can_do, "person");
    assert.equal(out[1].why, "A step on your checklist.");
  });

  test("the UnderwriteIQ tip: verbatim, the client's own, a stable id", () => {
    const s = "Pay Chase down to $1,000 to lift your approval odds.";
    const a = tipTask(s);
    assert.equal(a.title, s);
    assert.equal(a.can_do, "self");
    assert.equal(a.source, "underwriteiq");
    assert.equal(tipTask(s).id, a.id);
    assert.match(a.id, TASK_ID_RE);
    assert.equal(tipTask(null), null);
    assert.equal(tipTask("   "), null);
  });
});

describe("plan pins (W1 seam)", () => {
  const pin = (over) => ({
    id: "bank-strategy:open:2026-10-12", date: "2026-10-12", kind: "open_account", title: "Open a business checking at Bank X",
    detail: "Why, in one sentence.", amount_cents: null, bank: "Bank X", container_id: null, status: "planned", source: "bank-strategy", ...over
  });

  test("the three sources read directly are skipped, so nothing counts twice", () => {
    const out = pinTasks([
      pin({ id: "clarity:x", source: "clarity", kind: "due" }),
      pin({ id: `due:${AMEX}:2026-10-15`, source: "dues", kind: "due" }),
      pin({ id: "waypoint:w1", source: "waypoints", kind: "checkpoint" }),
      pin({})
    ], { today: TODAY });
    assert.deepEqual(out.map((t) => t.id), ["bank-strategy:open:2026-10-12"]);
    assert.equal(out[0].can_do, "self");
  });

  test("a deposit with an amount AND the client's account is a proposal; without the account it is the client's", () => {
    const withAcct = pinTasks([pin({ id: "bank-strategy:dep:1", kind: "deposit", amount_cents: 2000000, to_account_id: VISA })], { today: TODAY })[0];
    assert.equal(withAcct.can_do, "agent");
    assert.deepEqual(withAcct.transfer, { to_kind: "bank_account", to_account_id: VISA, amount_cents: 2000000 });
    const noAcct = pinTasks([pin({ id: "bank-strategy:dep:2", kind: "deposit", amount_cents: 2000000 })], { today: TODAY })[0];
    assert.equal(noAcct.can_do, "self");
    assert.equal(noAcct.transfer, null);
  });

  test("apply goes to a person; done pins and far-off pins drop; a missed pin is late", () => {
    const out = pinTasks([
      pin({ id: "funding-rounds:apply:1", kind: "apply", date: "2026-10-09", source: "funding-rounds" }),
      pin({ id: "bank-strategy:done", status: "done" }),
      pin({ id: "bank-strategy:far", date: "2026-12-01" }),
      pin({ id: "bank-strategy:missed", date: "2026-10-01", status: "missed" })
    ], { today: TODAY });
    assert.deepEqual(out.map((t) => [t.id, t.can_do, t.late_days]), [
      ["funding-rounds:apply:1", "person", null],
      ["bank-strategy:missed", "self", 6]
    ]);
  });

  test("a pin id the queue cannot store becomes a stable safe id", () => {
    const a = pinTasks([pin({ id: "weird id with spaces" })], { today: TODAY })[0];
    assert.match(a.id, /^bank-strategy:[0-9a-f]{16}$/);
    assert.equal(pinTasks([pin({ id: "weird id with spaces" })], { today: TODAY })[0].id, a.id);
  });
});

describe("order and merge", () => {
  test("late first (most late first), then by date, then undated steps in checklist order, then the tip", () => {
    const list = buildTasks({
      today: TODAY,
      plans: [PLAN],
      cards: [{ account_id: AMEX, name: "Business Amex", due_on: "2026-10-15", min_due_cents: 13500 }],
      lateCards: [{ id: VISA, label: "Personal Visa", dueOn: "2026-09-29", daysLate: 8, amountCents: 4000 }],
      waypoints: [
        { id: "wB", key: "get_ein", title: "Get your EIN from the IRS", owner_kind: "client", state: "not_started", due_at: null },
        { id: "wA", key: "form_llc", title: "File your LLC", owner_kind: "client", state: "not_started", due_at: "2026-10-20T00:00:00Z" }
      ],
      tip: "A funding tip."
    });
    assert.deepEqual(list.map((t) => t.id.split(":")[0] + ":" + (t.late_days || t.due_on || "-")), [
      "due:8", "clarity:4", "due:2026-10-15", "waypoint:2026-10-20", "waypoint:-", "uwiq:-"
    ]);
  });

  test("the same id from two readers is listed once", () => {
    const list = buildTasks({ today: TODAY, plans: [PLAN, PLAN] });
    assert.equal(list.length, 1);
  });

  test("sortTasks never mutates its input", () => {
    const a = [{ id: "b:1", title: "B", late_days: null, due_on: null, source: "x", _order: 1 }, { id: "a:1", title: "A", late_days: 2, due_on: "2026-10-01", source: "x", _order: 0 }];
    const copy = JSON.stringify(a);
    sortTasks(a);
    assert.equal(JSON.stringify(a), copy);
  });
});

describe("who can do it", () => {
  test("the rules table names all three, each with a reason", () => {
    assert.deepEqual([...CAN_DO], ["agent", "person", "self"]);
    for (const c of CAN_DO) assert.ok(CAN_DO_RULES.some((r) => r.can_do === c && r.why.length > 20), c);
  });

  test("every agent step today moves money, and every one of them has an exact amount and a destination", () => {
    const list = buildTasks({
      today: TODAY, plans: [PLAN],
      cards: [{ account_id: AMEX, name: "Business Amex", due_on: "2026-10-15", min_due_cents: 13500 }],
      loans: [{ account_id: LOAN, name: "SBA Loan", due_on: "2026-10-12", payment_cents: 105000 }]
    });
    for (const t of list.filter((x) => x.can_do === "agent")) {
      assert.equal(t.moves_money, true, t.id);
      assert.ok(Number.isSafeInteger(t.transfer.amount_cents) && t.transfer.amount_cents > 0, t.id);
      assert.ok(t.transfer.to_kind === "fundhub" ? t.transfer.to_account_id === null : !!t.transfer.to_account_id, t.id);
    }
  });
});

describe("assignments", () => {
  test("a person's row reads done once its CSM task is done; a failed row carries the agent's words", () => {
    const person = assignmentView({ id: "m1", assignee: "person", status: "queued", staff_done: true, staff_updated_at: "2026-10-09T15:00:00Z", created_at: "2026-10-07T00:00:00Z" });
    assert.equal(person.status, "done");
    assert.equal(person.open, false);
    assert.equal(person.done_at, "2026-10-09T15:00:00.000Z");
    const failed = assignmentView({ id: "m2", assignee: "agent", status: "failed", result: { client_message: "Your bank said no." } });
    assert.equal(failed.message, "Your bank said no.");
    const proposal = assignmentView({ id: "m3", assignee: "agent", status: "needs_approval", moves_money: true, amount_cents: "13500", to_kind: "card" });
    assert.equal(proposal.open, true);
    assert.equal(proposal.amount_cents, 13500);
  });

  test("the newest row per task wins", () => {
    const tasks = [{ id: "clarity:x", assignment: null }];
    const out = attachAssignments(tasks, [
      { id: "new", task_key: "clarity:x", assignee: "agent", status: "needs_approval", moves_money: true, amount_cents: 1 },
      { id: "old", task_key: "clarity:x", assignee: "agent", status: "cancelled" }
    ]);
    assert.equal(out[0].assignment.id, "new");
  });
});

/* ── the read, with stubbed readers ──────────────────────────────────────── */

const OV = {
  ok: true,
  client: { id: CLIENT, name: "Test Test" },
  debt: { cards: [{ account_id: AMEX, name: "Business Amex", due_on: "2026-10-15", min_due_cents: 13500 }], loans: [] },
  tip: null
};
function readers(over = {}) {
  return {
    overview: async () => OV,
    listClarity: async () => [PLAN],
    readWaypoints: async () => [],
    lateCards: async () => [],
    assignments: async () => [],
    log: () => {},
    ...over
  };
}

describe("moneyTasks — the read", () => {
  test("builds the test client's list: the late Fundhub payment, then the Amex minimum", async () => {
    const out = await moneyTasks({}, { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`), ...readers() });
    assert.equal(out.ok, true);
    assert.equal(out.window_days, NEXT_DAYS);
    assert.deepEqual(out.tasks.map((t) => t.title), ["Pay $500.00 to Fundhub LLC", "Pay $135.00 to Business Amex"]);
    assert.ok(!("_order" in out.tasks[0]));
    assert.deepEqual(out.sources.map((s) => s.name), ["clarity", "dues", "late_cards", "waypoints", "underwriteiq"]);
  });

  test("a reader that fails is reported, never silently empty, and the others still show", async () => {
    const out = await moneyTasks({}, {
      orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`),
      ...readers({ listClarity: async () => { throw new Error("boom"); } })
    });
    assert.deepEqual(out.sources.find((s) => s.name === "clarity"), { name: "clarity", ok: false, error: "load_failed" });
    assert.deepEqual(out.tasks.map((t) => t.title), ["Pay $135.00 to Business Amex"]);
  });

  test("a client outside the org is null (the endpoint answers 404)", async () => {
    assert.equal(await moneyTasks({}, { orgId: ORG, clientId: CLIENT, ...readers({ overview: async () => null }) }), null);
  });

  test("the list is capped and says how many more there are", async () => {
    const many = Array.from({ length: MAX_TASKS + 3 }, (_, i) => ({ id: `w${i}`, key: `step_${i}`, title: `Step ${i}`, owner_kind: "client", state: "not_started" }));
    const out = await moneyTasks({}, { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`), ...readers({ readWaypoints: async () => many }) });
    assert.equal(out.tasks.length, MAX_TASKS);
    assert.equal(out.more, 5);
  });

  test("plan pins: the seam is called with allPins' arguments and its pins become steps", async () => {
    let asked = null;
    const pins = async (_db, args) => {
      asked = args;
      return { pins: [{ id: "bank-strategy:open:1", date: "2026-10-12", kind: "open_account", title: "Open a business checking at Bank X", status: "planned", source: "bank-strategy" }], sources: [] };
    };
    const out = await moneyTasks({}, { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`), pins, ...readers() });
    assert.equal(asked.from, "2026-08-08");
    assert.equal(asked.to, addDays(TODAY, NEXT_DAYS));
    assert.equal(asked.today, TODAY);
    assert.ok(out.tasks.some((t) => t.id === "bank-strategy:open:1" && t.from === "your plan"));
    assert.ok(out.sources.some((s) => s.name === "plan" && s.ok));
  });

  test("plan pins: a plan source allPins could not load makes the plan part 'not loaded', never empty", async () => {
    const pins = async () => ({ pins: [], sources: [{ name: "bank-strategy", ok: false, error: "load_failed" }, { name: "payoff", ok: true, count: 0 }] });
    const out = await moneyTasks({}, { orgId: ORG, clientId: CLIENT, asOf: new Date(`${TODAY}T12:00:00Z`), pins, ...readers() });
    assert.deepEqual(out.sources.find((s) => s.name === "plan"), { name: "plan", ok: false, error: "load_failed", parts: ["bank-strategy"] });
    assert.equal(out.tasks.length, 2, "the other parts still show");
  });
});

/* ── "Do task" routing ───────────────────────────────────────────────────── */

const T_MONEY = {
  id: `due:${AMEX}:2026-10-15`, title: "Pay $135.00 to Business Amex", why: "The minimum on your latest statement.", due_on: "2026-10-15",
  kind: "due", can_do: "agent", late_days: null, amount_cents: 13500, moves_money: true,
  transfer: { to_kind: "card", to_account_id: AMEX, amount_cents: 13500 }, source: "dues", from: "your card statement", link: null, assignment: null, _order: 0
};
const T_PERSON = {
  id: "waypoint:7a1c0000-0000-4000-8000-000000000002", title: "Talk to your advisor about a personal loan", why: "Raise it early.", due_on: "2026-10-20",
  kind: "checkpoint", can_do: "person", late_days: null, amount_cents: null, moves_money: false, transfer: null,
  source: "waypoints", from: "your checklist", link: "/progress.html", assignment: null, _order: 0
};
const T_SELF = { ...T_PERSON, id: "waypoint:7a1c0000-0000-4000-8000-000000000003", title: "File your LLC", can_do: "self" };

function recorder() {
  const calls = { sql: [], propose: [], createTask: [], log: [] };
  const db = {
    async query(sql, params) {
      calls.sql.push({ sql, params });
      if (/INSERT INTO money_agent_tasks/.test(sql)) return { rows: [{ id: "m-person-1" }] };
      return { rows: [] };
    }
  };
  return {
    calls, db,
    propose: async (_db, p) => { calls.propose.push(p); return { ok: true, created: true, proposalId: "m-money-1", status: "needs_approval" }; },
    createTask: async (_db, spec) => { calls.createTask.push(spec); return { created: true, id: "task-csm-1" }; },
    log: async (_db, row) => { calls.log.push(row); return { created: true, id: "log-1" }; }
  };
}
const collectWith = (all) => async () => ({ today: TODAY, now: new Date(`${TODAY}T12:00:00Z`), all, sources: [] });

describe("doTask — the press", () => {
  test("a payment becomes a PROPOSAL with the server's own amount and destination; no CSM task; logged once", async () => {
    const r = recorder();
    const out = await doTask(r.db, {
      orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: collectWith([T_MONEY]),
      propose: r.propose, createTask: r.createTask, log: r.log,
      deps: { assignments: async () => [{ id: "m-money-1", task_key: T_MONEY.id, assignee: "agent", status: "needs_approval", moves_money: true, amount_cents: 13500, to_kind: "card" }] }
    });
    assert.equal(out.ok, true);
    assert.equal(out.created, true);
    assert.equal(r.calls.propose.length, 1);
    const p = r.calls.propose[0];
    assert.equal(p.amountCents, 13500);
    assert.equal(p.toKind, "card");
    assert.equal(p.toAccountId, AMEX);
    assert.equal(p.taskKey, T_MONEY.id);
    assert.equal(p.requestedByKind, "client");
    assert.equal(r.calls.createTask.length, 0);
    assert.equal(r.calls.log.length, 1);
    assert.equal(r.calls.log[0].action, "task_assigned");
    assert.equal(r.calls.log[0].itemKind, "money_task");
    assert.equal(r.calls.log[0].idempotencyKey, "money-task:m-money-1:assigned");
    assert.equal(r.calls.log[0].amountCents, 13500);
    assert.equal(out.task.assignment.status, "needs_approval");
    assert.ok(!r.calls.sql.some((q) => /UPDATE money_agent_tasks SET status/.test(q.sql)), "nothing approved or sent");
  });

  test("a person step opens ONE CSM task (role csm, source money-task — not the helper's own) and links it", async () => {
    const r = recorder();
    const out = await doTask(r.db, {
      orgId: ORG, clientId: CLIENT, taskId: T_PERSON.id, actor: "staff", staffId: STAFF, collect: collectWith([T_PERSON]),
      propose: r.propose, createTask: r.createTask, log: r.log, deps: { assignments: async () => [] }
    });
    assert.equal(out.ok, true);
    assert.equal(r.calls.propose.length, 0);
    const ins = r.calls.sql.find((q) => /INSERT INTO money_agent_tasks/.test(q.sql));
    assert.ok(ins, "an assignment row");
    assert.equal(ins.params[8], "person");
    assert.equal(ins.params[9], "staff");
    assert.equal(ins.params[10], STAFF);
    assert.equal(r.calls.createTask.length, 1);
    const st = r.calls.createTask[0];
    assert.equal(st.assigneeRole, STAFF_TASK_ROLE);
    assert.equal(st.assigneeRole, "csm");
    assert.equal(st.sourceWorkflow, STAFF_TASK_SOURCE);
    assert.notEqual(st.sourceWorkflow, "money-agent");
    assert.equal(st.eventId, "money-task:m-person-1");
    assert.equal(st.title, "FinanceOS: Talk to your advisor about a personal loan");
    assert.ok(r.calls.sql.some((q) => /UPDATE money_agent_tasks SET staff_task_id/.test(q.sql) && q.params[1] === "task-csm-1"));
    assert.equal(r.calls.log[0].actor, "staff");
    assert.equal(r.calls.log[0].reason, "to a person on our team");
  });

  test("a step only the client can do is refused, and nothing is written", async () => {
    const r = recorder();
    const out = await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_SELF.id, collect: collectWith([T_SELF]), propose: r.propose, createTask: r.createTask, log: r.log });
    assert.deepEqual(out, { ok: false, error: "self_task" });
    assert.equal(r.calls.sql.length + r.calls.propose.length + r.calls.createTask.length + r.calls.log.length, 0);
  });

  test("a step already handed over answers with it and writes nothing (one open row per step)", async () => {
    const r = recorder();
    const open = { ...T_MONEY, assignment: { id: "m-money-1", assignee: "agent", status: "needs_approval", open: true } };
    const out = await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: collectWith([open]), propose: r.propose, createTask: r.createTask, log: r.log });
    assert.equal(out.ok, true);
    assert.equal(out.created, false);
    assert.equal(r.calls.propose.length + r.calls.createTask.length + r.calls.log.length + r.calls.sql.length, 0);
  });

  test("a person step whose CSM task is done is closed first, then can be handed over again", async () => {
    const r = recorder();
    const done = { ...T_PERSON, assignment: { id: "m-old", assignee: "person", status: "done", open: false } };
    await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_PERSON.id, collect: collectWith([done]), propose: r.propose, createTask: r.createTask, log: r.log, deps: { assignments: async () => [] } });
    const close = r.calls.sql.findIndex((q) => /UPDATE money_agent_tasks SET status = 'done'/.test(q.sql));
    const ins = r.calls.sql.findIndex((q) => /INSERT INTO money_agent_tasks/.test(q.sql));
    assert.ok(close >= 0 && ins > close);
    assert.equal(r.calls.sql[close].params[0], "m-old");
  });

  test("an id not on the client's own list, a malformed id, and a refused proposal", async () => {
    const r = recorder();
    assert.deepEqual(await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: "clarity:not-mine", collect: collectWith([T_MONEY]) }), { ok: false, error: "task_not_found" });
    assert.deepEqual(await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: "no colon", collect: collectWith([T_MONEY]) }), { ok: false, error: "bad_task_id" });
    assert.deepEqual(await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: async () => null }), { ok: false, error: "not_found" });
    const refused = await doTask(r.db, {
      orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: collectWith([T_MONEY]),
      propose: async () => ({ ok: false, reason: "destination_not_found" }), log: r.log
    });
    assert.deepEqual(refused, { ok: false, error: "proposal_refused", reason: "destination_not_found" });
    assert.equal(r.calls.log.length, 0);
  });

  test("the press rebuilds the task from the database: the proposal's amount is the statement's, whatever the caller sent", async () => {
    let proposed = null;
    let reads = 0;
    const out = await doTask({}, {
      // The money task is the late Fundhub plan payment: cards and loans are the client's own
      // (Plaid Transfer cannot pay them), so they are never proposed.
      orgId: ORG, clientId: CLIENT, taskId: "clarity:824c8cf7-3885-4570-8e72-4858aca547d5", asOf: new Date(`${TODAY}T12:00:00Z`),
      // A caller cannot pass a title or an amount: doTask takes only the task id.
      amount_cents: 1, title: "forged",
      propose: async (_db, p) => { proposed = p; return { ok: true, created: true, proposalId: "m", status: "needs_approval" }; },
      log: async () => ({ created: true, id: "l" }),
      // Nothing handed over yet when the list is rebuilt; the proposal is there after the write.
      deps: readers({ assignments: async () => (reads++ === 0 ? [] : [{ id: "m", task_key: "clarity:824c8cf7-3885-4570-8e72-4858aca547d5", assignee: "agent", status: "needs_approval", moves_money: true, amount_cents: 50000 }]) })
    });
    assert.equal(out.ok, true);
    assert.equal(out.task.assignment.status, "needs_approval");
    assert.equal(proposed.amountCents, 50000, "the amount left on the late payment, from the plan rows");
    assert.equal(proposed.toKind, "fundhub");
  });
});

describe("migration 464 — the rules live in the database", () => {
  test("money only ever moves as a proposal the client approved", () => {
    assert.match(SQL_464, /CREATE TABLE IF NOT EXISTS money_agent_tasks/);
    assert.match(SQL_464, /money_agent_tasks_money_shape_ck\s+CHECK \(NOT moves_money OR \(amount_cents IS NOT NULL AND to_kind IS NOT NULL\)\)/);
    assert.match(SQL_464, /money_agent_tasks_money_never_queued_ck\s+CHECK \(NOT moves_money OR status <> 'queued'\)/);
    assert.match(SQL_464, /money_agent_tasks_money_needs_ok_ck[\s\S]*?OR status IN \('needs_approval', 'cancelled', 'failed'\)[\s\S]*?OR \(approved_at IS NOT NULL AND from_account_id IS NOT NULL\)/);
    assert.match(SQL_464, /money_agent_tasks_person_no_money_ck\s+CHECK \(assignee = 'agent' OR NOT moves_money\)/);
    assert.match(SQL_464, /money_agent_tasks_approval_is_money_ck/);
  });

  test("one open row per step per client", () => {
    assert.match(SQL_464, /CREATE UNIQUE INDEX IF NOT EXISTS money_agent_tasks_one_open\s+ON money_agent_tasks \(org_id, client_id, task_key\)\s+WHERE status IN \('queued', 'needs_approval', 'approved', 'claimed'\)/);
  });

  test("RLS on with a policy and grants (no bare lock)", () => {
    assert.match(SQL_464, /ALTER TABLE public\.money_agent_tasks ENABLE ROW LEVEL SECURITY/);
    assert.match(SQL_464, /ALTER TABLE public\.money_agent_tasks FORCE ROW LEVEL SECURITY/);
    assert.match(SQL_464, /CREATE POLICY money_agent_tasks_app_all/);
    assert.match(SQL_464, /GRANT SELECT, INSERT, UPDATE ON public\.money_agent_tasks TO fundhub_app/);
  });

  test("money_agent_log keeps every earlier word and adds the new ones", () => {
    const action = /ADD CONSTRAINT money_agent_log_action_check\s+CHECK \(action IN \(([\s\S]*?)\)\);/.exec(SQL_464)[1];
    for (const w of ["reminder", "late_check_in", "second_check_in", "csm_task", "held", "plan_added", "payment_recorded",
      "plan_settled", "asked_for_person", "payment_unmatched", "task_assigned", "task_done", "task_failed", "task_cancelled", "ready_to_fund"]) {
      assert.match(action, new RegExp(`'${w}'`), w);
    }
    const kinds = /ADD CONSTRAINT money_agent_log_item_kind_check\s+CHECK \(item_kind IN \(([\s\S]*?)\)\);/.exec(SQL_464)[1];
    for (const k of ["clarity_installment", "clarity_payment", "card_due", "client", "money_task"]) assert.match(kinds, new RegExp(`'${k}'`), k);
  });

  test("the task ids this file makes fit the column's CHECK", () => {
    const re = /task_key ~ '([^']+)'/.exec(SQL_464)[1];
    const pg = new RegExp(re);
    for (const id of ["clarity:824c8cf7-3885-4570-8e72-4858aca547d5", `due:${AMEX}:2026-10-15`, "waypoint:7a1c0000-0000-4000-8000-000000000002", tipTask("x").id, "bank-strategy:open:2026-10-12"]) {
      assert.match(id, pg, id);
      assert.match(id, TASK_ID_RE, id);
    }
  });
});

describe("doTask — a payment is never set up twice", () => {
  test("a payment the agent already finished for this due date answers with it and writes nothing", async () => {
    const r = recorder();
    const paid = { ...T_MONEY, assignment: { id: "m-done", assignee: "agent", status: "done", open: false, moves_money: true, amount_cents: 13500 } };
    const out = await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: collectWith([paid]), propose: r.propose, createTask: r.createTask, log: r.log });
    assert.equal(out.ok, true);
    assert.equal(out.created, false);
    assert.equal(r.calls.propose.length + r.calls.log.length + r.calls.sql.length, 0);
  });

  test("a failed or stopped proposal may be set up again", async () => {
    for (const status of ["failed", "cancelled"]) {
      const r = recorder();
      const t = { ...T_MONEY, assignment: { id: "m-x", assignee: "agent", status, open: false, moves_money: true, amount_cents: 13500 } };
      const out = await doTask(r.db, { orgId: ORG, clientId: CLIENT, taskId: T_MONEY.id, collect: collectWith([t]), propose: r.propose, createTask: r.createTask, log: r.log, deps: { assignments: async () => [] } });
      assert.equal(out.ok, true, status);
      assert.equal(r.calls.propose.length, 1, status);
    }
  });
});
