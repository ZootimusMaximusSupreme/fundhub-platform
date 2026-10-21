// Four money controls that are on the live screen today and that nobody has pressed for real yet
// (measured read-only on 2026-10-20: no task_assigned or ready_to_fund log, no commission.approved or
// commission.paid receipt, no approved or paid commission row). Their checks said "no saved receipt
// exists" every morning. Owner rule 2026-10-14: a control nobody has used yet is green until the first
// wrong result. So each one is now `emptyAs: "quiet"`, and this file proves that is earned:
//
//   1. the REAL writer behind each press is run on fake data, its saved rows go into an in-memory
//      database with the real column names, and the exact live SQL judges them green;
//   2. one real way each saved result can be wrong is red on its own;
//   3. for the two commission checks, an approved or paid row with no receipt is red even while the
//      control is new, so a press that saves the row but not the receipt can never hide as "quiet".
//
//   financeos.html#next  'Do task'                 src/finance/money-tasks.mjs doTask
//   financeos.html#next  'I'm ready to get funded'  src/finance/ready-to-fund.mjs requestReadyToFund
//   products-commissions 'Approve selected'         src/commissions/payout.mjs approveCommissions
//   products-commissions 'Mark paid...'             src/commissions/payout.mjs markCommissionsPaid
//
// Practice tests with fake data. No real client, no live database.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeStandIn } from "./fin-b02-sql-kit.mjs";
import { displaySavedResultContract } from "./display-saved-result.mjs";
import { DISPLAY_RESULT_CASES, judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { doTask } from "../../../finance/money-tasks.mjs";
import { requestReadyToFund } from "../../../finance/ready-to-fund.mjs";
import { CSM_PREP_SOURCE } from "../../../blueprint/closer-ready.mjs";
import { approveCommissions, markCommissionsPaid } from "../../../commissions/payout.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const LEDGER = "b1000000-0000-4000-8000-000000000001";
const STAFF = { id: "a1000000-0000-4000-8000-000000000001", name: "Owner Chris" };

const DO_TASK = "'Do task' button on a step the helper or a person can do";
const READY = "'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task)";
const APPROVE = "'Approve selected': moves Accrued rows to Approved";
const PAID = "'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money)";
const CONTROLS = [DO_TASK, READY, APPROVE, PAID];

function contractFor(control) {
  const hit = displaySavedResultContract({ control });
  assert.ok(hit, `no contract for: ${control}`);
  return hit;
}

/* The stand-in is SQLite. Postgres `a ~ 'pattern'` is spelled `a REGEXP 'pattern'` there, backed by a
   JavaScript regexp, so the commission SQL runs as written apart from that one operator. */
function standIn(tables) {
  const s = makeStandIn(tables);
  s.db.function("regexp", (pattern, value) => (value == null ? 0 : (new RegExp(pattern).test(String(value)) ? 1 : 0)));
  const run = s.run.bind(s);
  s.run = (sql, orgId) => run(sql.replace(/\s~\s/g, " REGEXP "), orgId);
  return s;
}

test("the four live controls are quiet when unused, red on a wrong result, and the compiled catalog says the same", () => {
  for (const control of CONTROLS) {
    const contract = contractFor(control);
    assert.equal(contract.mode, "query", control);
    assert.equal(contract.emptyAs, "quiet", control);
    assert.match(contract.sql, /\$1::uuid/);
    assert.doesNotMatch(contract.sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);

    const entry = { id: `x:${control}`, control, surface: "s", contract };
    const empty = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
    assert.equal(empty.status, "PASS", control);
    assert.match(empty.detail, /no saved results yet, so none are wrong/);
    const wrong = judgeDisplayResult(entry, { sample_count: 2, bad_count: 1 });
    assert.equal(wrong.status, "FAIL", control);
    assert.match(wrong.detail, /1 of 2/);

    // The live lane reads generated.json, not this module. It must carry the same contract.
    const compiled = DISPLAY_RESULT_CASES.filter((item) => item.control === control);
    assert.equal(compiled.length, 1, control);
    assert.deepEqual(compiled[0].contract, { ...contract }, `generated.json is stale for: ${control}`);
  }
});

// ---- 'Do task' on financeos.html#next -------------------------------------------------------------

const STEP = {
  person: {
    id: "waypoint:7a1c0000-0000-4000-8000-000000000002", title: "Talk to your advisor about a personal loan", why: "Raise it early.",
    due_on: "2026-10-20", kind: "checkpoint", can_do: "person", late_days: null, amount_cents: null, moves_money: false, transfer: null,
    source: "waypoints", from: "your checklist", link: "/progress.html", assignment: null, _order: 0
  },
  helper: {
    id: "uwiq:9f3c0000-0000-4000-8000-000000000007", title: "Open a business checking account", why: "Needed before the next round.",
    due_on: "2026-10-25", kind: "open_account", can_do: "agent", late_days: null, amount_cents: null, moves_money: false, transfer: null,
    source: "underwriteiq", from: "your report", link: null, assignment: null, _order: 1
  },
};

/* Everything doTask writes to, kept so it can be judged. `keyFor` lets a test change the idempotency
   key the log saves, which is one real way the receipt can stop naming its task. */
function moneyWorld({ keyFor = (key) => key } = {}) {
  const state = { money_agent_tasks: [], money_agent_log: [], tasks: [] };
  let n = 0;
  const next = (p) => `${p}-${(n += 1)}`;
  const db = {
    async query(sql, params = []) {
      if (/INSERT INTO money_agent_tasks/.test(sql)) {
        const row = {
          id: next("m"), org_id: params[0], client_id: params[1], task_key: params[2], kind: params[3], title: params[4],
          why: params[5], due_on: params[6], source: params[7], assignee: params[8], status: "queued",
        };
        state.money_agent_tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/UPDATE money_agent_tasks SET staff_task_id = \$2 WHERE id = \$1/.test(sql)) {
        const row = state.money_agent_tasks.find((r) => r.id === params[0]);
        if (row) row.staff_task_id = params[1];
        return { rows: [] };
      }
      if (/UPDATE money_agent_log SET task_id = \$2 WHERE id = \$1/.test(sql)) {
        const row = state.money_agent_log.find((r) => r.id === params[0]);
        if (row) row.task_id = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return {
    state, db,
    createTask: async (_db, spec) => {
      const row = { id: next("t"), org_id: spec.orgId, client_id: spec.clientId, title: spec.title, source_workflow: spec.sourceWorkflow, assignee_role: spec.assigneeRole, body: spec.eventId };
      state.tasks.push(row);
      return { created: true, id: row.id };
    },
    log: async (_db, e) => {
      const row = {
        id: next("l"), org_id: e.orgId, client_id: e.clientId, item_kind: e.itemKind, item_id: e.itemId, item_label: e.itemLabel,
        action: e.action, actor: e.actor, reason: e.reason, amount_cents: e.amountCents, idempotency_key: keyFor(e.idempotencyKey),
        detail: e.detail, task_id: null,
      };
      state.money_agent_log.push(row);
      return { created: true, id: row.id };
    }
  };
}

async function pressDoTask(step, options = {}) {
  const w = moneyWorld(options);
  const out = await doTask(w.db, {
    orgId: ORG, clientId: CLIENT, taskId: step.id, actor: "client",
    collect: async () => ({ today: "2026-10-20", now: new Date("2026-10-20T12:00:00Z"), all: [step], sources: [] }),
    createTask: w.createTask, log: w.log, deps: { assignments: async () => [] }
  });
  assert.equal(out.ok, true);
  const s = standIn(["money_agent_log", "money_agent_tasks", "tasks"]);
  try {
    for (const table of ["money_agent_tasks", "money_agent_log", "tasks"]) for (const row of w.state[table]) s.insert(table, row);
    return { state: w.state, mine: s.run(contractFor(DO_TASK).sql, ORG), other: s.run(contractFor(DO_TASK).sql, OTHER) };
  } finally { s.close(); }
}

test("Do task: the real press for a person's step and for a helper's step each saves a receipt the live check passes", async () => {
  for (const step of [STEP.person, STEP.helper]) {
    const { state, mine, other } = await pressDoTask(step);
    assert.equal(state.money_agent_log.length, 1, step.id);
    assert.equal(state.money_agent_log[0].action, "task_assigned");
    assert.deepEqual(mine, { sample_count: 1, bad_count: 0 }, step.id);
    assert.deepEqual(other, { sample_count: 0, bad_count: 0 }, "another company's press is not counted");
  }
});

test("Do task: a receipt that no longer names its task by the exact key is red", async () => {
  const { mine } = await pressDoTask(STEP.helper, { keyFor: (key) => `${key}:again` });
  assert.deepEqual(mine, { sample_count: 1, bad_count: 1 });
});

// ---- 'I'm ready to get funded' on financeos.html#next ---------------------------------------------

/* The real requestReadyToFund reads the client and its prep calls with its own SQL, run on the stand-in.
   The prep-call writer and the log writer save into the same stand-in. `linkTask: false` drops the id the
   log hands back, so the log is never pointed at its task: one real way the receipt can be wrong. */
async function pressReady({ linkTask = true, presses = 1 } = {}) {
  const s = standIn(["clients", "tasks", "money_agent_log"]);
  try {
    s.insert("clients", { id: CLIENT, org_id: ORG });
    let n = 0;
    const createPrepCall = async (_db, { orgId, clientId, eventId }) => {
      const id = `t-${(n += 1)}`;
      s.insert("tasks", { id, org_id: orgId, client_id: clientId, source_workflow: CSM_PREP_SOURCE, body: eventId, done: false, created_at: "2026-10-20 12:00:00", updated_at: "2026-10-20 12:00:00" });
      return { created: true, id };
    };
    const log = async (_db, e) => {
      const id = `l-${(n += 1)}`;
      s.insert("money_agent_log", {
        id, org_id: e.orgId, client_id: e.clientId, item_kind: e.itemKind, item_id: e.itemId, item_label: e.itemLabel,
        action: e.action, actor: e.actor, reason: e.reason, idempotency_key: e.idempotencyKey, detail: e.detail,
      });
      return { created: true, id: linkTask ? id : null };
    };
    for (let i = 0; i < presses; i += 1) {
      const out = await requestReadyToFund(s.asPg(), { orgId: ORG, clientId: CLIENT, todayIso: "2026-10-20", createPrepCall, log });
      assert.ok(out, "the client is found");
    }
    return { logs: s.all("money_agent_log"), mine: s.run(contractFor(READY).sql, ORG), other: s.run(contractFor(READY).sql, OTHER) };
  } finally { s.close(); }
}

test("Ready to get funded: the real press opens the prep call, logs it once, and the live check passes", async () => {
  const { logs, mine, other } = await pressReady({ presses: 2 });
  assert.equal(logs.length, 1, "a second press while the call is open writes nothing new");
  assert.equal(logs[0].idempotency_key, `ready-to-fund:${CLIENT}:r1`);
  assert.deepEqual(mine, { sample_count: 1, bad_count: 0 });
  assert.deepEqual(other, { sample_count: 0, bad_count: 0 });
});

test("Ready to get funded: a log that never points at its prep-call task is red", async () => {
  const { mine } = await pressReady({ linkTask: false });
  assert.deepEqual(mine, { sample_count: 1, bad_count: 1 });
});

// ---- 'Approve selected' and 'Mark paid...' on products-commissions.html -------------------------

/* The real approve / mark-paid writers, against a db that keeps the ledger row and the receipts. */
function ledgerWorld(row) {
  const ledger = { ...row };
  const events = [];
  const db = {
    async query(sql, params = []) {
      if (/UPDATE commission_ledger/.test(sql) && /SET status = 'approved'/.test(sql)) {
        if (ledger.status !== "earned") return { rows: [] };
        Object.assign(ledger, { status: "approved", approved_at: "2026-10-20 12:00:00", approved_by: params[2] });
        return { rows: [{ ...ledger }] };
      }
      if (/UPDATE commission_ledger/.test(sql) && /SET status = 'paid'/.test(sql)) {
        if (ledger.status !== "approved") return { rows: [] };
        Object.assign(ledger, { status: "paid", paid_at: "2026-10-20 13:00:00", paid_by: params[2], payout_ref: params[3] });
        return { rows: [{ ...ledger }] };
      }
      if (/INSERT INTO events/.test(sql)) {
        events.push({ id: `e-${events.length + 1}`, org_id: params[0], name: params[1], idempotency_key: params[3], client_id: params[4], payload: params[5] });
        return { rows: [{ id: `e-${events.length}` }] };
      }
      throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    }
  };
  return { db, ledger, events };
}

const EARNED = { id: LEDGER, org_id: ORG, staff_id: STAFF.id, client_id: CLIENT, amount: "500.00", currency: "USD", status: "earned", is_demo: false };

function judgeCommissions(ledgers, events) {
  const s = standIn(["commission_ledger", "events"]);
  try {
    for (const row of ledgers) {
      const { currency: _currency, ...stored } = row;
      s.insert("commission_ledger", stored);
    }
    for (const row of events) s.insert("events", row);
    return {
      approved: s.run(contractFor(APPROVE).sql, ORG),
      paid: s.run(contractFor(PAID).sql, ORG),
      otherApproved: s.run(contractFor(APPROVE).sql, OTHER),
    };
  } finally { s.close(); }
}

test("Approve selected then Mark paid: the real writers save receipts both live checks pass", async () => {
  const w = ledgerWorld(EARNED);
  const approved = await approveCommissions(w.db, { orgId: ORG, ledgerIds: [LEDGER], staff: STAFF });
  assert.equal(approved.updated, 1);
  let verdict = judgeCommissions([w.ledger], w.events);
  assert.deepEqual(verdict.approved, { sample_count: 1, bad_count: 0 });
  assert.deepEqual(verdict.paid, { sample_count: 0, bad_count: 0 }, "nothing is paid yet");
  assert.deepEqual(verdict.otherApproved, { sample_count: 0, bad_count: 0 });

  const paid = await markCommissionsPaid(w.db, { orgId: ORG, ledgerIds: [LEDGER], payoutRef: "ACH-20261020-1", staff: STAFF });
  assert.equal(paid.updated, 1);
  verdict = judgeCommissions([w.ledger], w.events);
  assert.deepEqual(verdict.approved, { sample_count: 1, bad_count: 0 }, "the approval receipt still matches the paid row");
  assert.deepEqual(verdict.paid, { sample_count: 1, bad_count: 0 });
});

test("Approve selected: an approved row with no receipt is red, even though the control is new", () => {
  const row = { ...EARNED, status: "approved", approved_at: "2026-10-20 12:00:00", approved_by: "Owner Chris" };
  assert.deepEqual(judgeCommissions([row], []).approved, { sample_count: 1, bad_count: 1 });
  // A demo row is not judged; nothing is saved, so the check is quiet.
  assert.deepEqual(judgeCommissions([{ ...row, is_demo: true }], []).approved, { sample_count: 0, bad_count: 0 });
});

test("Approve selected: a receipt whose amount differs from its row is red", async () => {
  const w = ledgerWorld(EARNED);
  await approveCommissions(w.db, { orgId: ORG, ledgerIds: [LEDGER], staff: STAFF });
  const events = w.events.map((e) => ({ ...e, payload: { ...e.payload, amount: "400.00" } }));
  assert.deepEqual(judgeCommissions([w.ledger], events).approved, { sample_count: 1, bad_count: 1 });
});

test("Mark paid: a paid row with no paid receipt is red, and a receipt with another payout id is red", async () => {
  const w = ledgerWorld(EARNED);
  await approveCommissions(w.db, { orgId: ORG, ledgerIds: [LEDGER], staff: STAFF });
  await markCommissionsPaid(w.db, { orgId: ORG, ledgerIds: [LEDGER], payoutRef: "ACH-20261020-1", staff: STAFF });
  const approvalOnly = w.events.filter((e) => e.name === "commission.approved");
  assert.deepEqual(judgeCommissions([w.ledger], approvalOnly).paid, { sample_count: 1, bad_count: 1 });
  const otherRef = w.events.map((e) => (e.name === "commission.paid" ? { ...e, payload: { ...e.payload, payout_ref: "CHECK-9" } } : e));
  assert.deepEqual(judgeCommissions([w.ledger], otherRef).paid, { sample_count: 1, bad_count: 1 });
});
