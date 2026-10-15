// Finish-853 batch 02, repair cycle 1: the "Do task" press, run end to end on fake data and then
// judged by the live check's own SQL.
//
// Row (desks-d.json, public/app/money-next.html): "Do task (per step the money helper or a person
// can do)". The live check (fin-b02-display-contracts.mjs, marker do-task-person-leg) reads what the
// press saved: the money task row, the log row, and (for a person's step) the CSM task.
//
// A fresh checker found that the old check never looked at the person leg: a step handed to a person
// whose CSM task was never made stayed green. The SQL now judges that leg. This file closes the other
// side: the real doTask() (src/finance/money-tasks.mjs) is run against a stand-in that SAVES what it is
// told to save, and those saved rows are then run through the exact live SQL on an in-memory database
// whose tables carry the real column names. If doTask stops saving a link, the live SQL turns red here.
//
// Practice test with fake data. It is not a real client's press.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeStandIn } from "./fin-b02-sql-kit.mjs";
import { FIN_B02_RESULT_CONTRACTS } from "./fin-b02-display-contracts.mjs";
import { doTask } from "../../../finance/money-tasks.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const STAFF = "a1000000-0000-4000-8000-000000000001";
const AMEX = "b1000000-0000-4000-8000-000000000001";
const TODAY = "2026-10-14";
const CONTRACT = FIN_B02_RESULT_CONTRACTS[6];

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
  money: {
    id: `due:${AMEX}:2026-10-15`, title: "Pay $135.00 to Business Amex", why: "The minimum on your latest statement.", due_on: "2026-10-15",
    kind: "due", can_do: "agent", late_days: null, amount_cents: 13500, moves_money: true,
    transfer: { to_kind: "card", to_account_id: AMEX, amount_cents: 13500 }, source: "dues", from: "your card statement", link: null, assignment: null, _order: 2
  }
};

/**
 * A stand-in for everything doTask writes to. It does what the real tables do with what it is given
 * (a row gets an id; an update changes the row it names) and keeps the rows, so they can be judged.
 * `breaks` switches a piece of the product's saving off, so the test can see the live SQL go red.
 */
function world(breaks = {}) {
  const state = { money_agent_tasks: [], money_agent_log: [], tasks: [] };
  let n = 0;
  const next = (p) => `${p}-${(n += 1)}`;
  const db = {
    async query(sql, params = []) {
      if (/INSERT INTO money_agent_tasks/.test(sql)) {
        const row = {
          id: next("m"), org_id: params[0], client_id: params[1], task_key: params[2], kind: params[3], title: params[4],
          why: params[5], due_on: params[6], source: params[7], assignee: params[8], status: "queued", moves_money: false,
          amount_cents: null, staff_task_id: null, requested_by_kind: params[9], requested_by_staff_id: params[10],
        };
        state.money_agent_tasks.push(row);
        return { rows: [{ id: row.id }] };
      }
      let m = /UPDATE money_agent_tasks SET staff_task_id = \$2 WHERE id = \$1/.exec(sql);
      if (m) {
        const row = state.money_agent_tasks.find((r) => r.id === params[0]);
        if (row) row.staff_task_id = params[1];
        return { rows: [] };
      }
      m = /UPDATE money_agent_log SET task_id = \$2 WHERE id = \$1/.exec(sql);
      if (m) {
        const row = state.money_agent_log.find((r) => r.id === params[0]);
        if (row) row.task_id = params[1];
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return {
    state, db,
    // a money step is a proposal: the row names the amount and where it goes (db/migrations/464)
    propose: async (_db, p) => {
      const row = {
        id: next("m"), org_id: p.orgId, client_id: p.clientId, task_key: p.taskKey, kind: p.kind, title: p.title, source: p.source,
        assignee: "agent", status: "needs_approval", moves_money: true, amount_cents: p.amountCents, staff_task_id: null,
        requested_by_kind: p.requestedByKind,
      };
      state.money_agent_tasks.push(row);
      return { ok: true, created: true, proposalId: row.id, status: row.status };
    },
    createTask: async (_db, spec) => {
      if (breaks.noCsmTask) return null;
      const row = {
        id: next("t"), org_id: spec.orgId, client_id: spec.clientId, title: spec.title,
        source_workflow: spec.sourceWorkflow, assignee_role: spec.assigneeRole, body: spec.eventId,
      };
      state.tasks.push(row);
      return { created: true, id: row.id };
    },
    log: async (_db, e) => {
      const row = {
        id: next("l"), org_id: e.orgId, client_id: e.clientId, item_kind: e.itemKind, item_id: e.itemId, item_label: e.itemLabel,
        action: e.action, actor: e.actor, reason: e.reason, amount_cents: e.amountCents, idempotency_key: e.idempotencyKey,
        detail: e.detail, task_id: null,
      };
      state.money_agent_log.push(row);
      return { created: true, id: row.id };
    }
  };
}

const collectWith = (all) => async () => ({ today: TODAY, now: new Date(`${TODAY}T12:00:00Z`), all, sources: [] });

/** Press Do task on one step, then run the live SQL on what was saved. */
async function press(step, { breaks = {}, actor = "client" } = {}) {
  const w = world(breaks);
  const out = await doTask(w.db, {
    orgId: ORG, clientId: CLIENT, taskId: step.id, actor, staffId: actor === "staff" ? STAFF : null,
    collect: collectWith([step]), propose: w.propose, createTask: w.createTask, log: w.log, deps: { assignments: async () => [] }
  });
  const s = makeStandIn(["money_agent_log", "money_agent_tasks", "tasks"]);
  try {
    for (const table of ["money_agent_tasks", "money_agent_log", "tasks"]) {
      for (const row of w.state[table]) s.insert(table, row);
    }
    return { out, state: w.state, verdict: s.run(CONTRACT.sql, ORG) };
  } finally { s.close(); }
}

test("a step handed to a person: one CSM task, the row and the log both point at it, and the live check is green", async () => {
  const { out, state, verdict } = await press(STEP.person, { actor: "staff" });
  assert.equal(out.ok, true);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].source_workflow, "money-task");
  assert.equal(state.tasks[0].assignee_role, "csm");
  assert.equal(state.money_agent_tasks[0].staff_task_id, state.tasks[0].id);
  assert.equal(state.money_agent_log[0].task_id, state.tasks[0].id);
  assert.deepEqual(verdict, { sample_count: 1, bad_count: 0 });
});

test("a step the helper can do: no CSM task is made, and the live check is green", async () => {
  const { state, verdict } = await press(STEP.helper);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.money_agent_tasks[0].assignee, "agent");
  assert.equal(state.money_agent_log[0].detail.assignee, "agent");
  assert.deepEqual(verdict, { sample_count: 1, bad_count: 0 });
});

test("a payment: a proposal with the same amount on the row and on the log, and the live check is green", async () => {
  const { state, verdict } = await press(STEP.money);
  assert.equal(state.money_agent_tasks[0].amount_cents, 13500);
  assert.equal(state.money_agent_log[0].amount_cents, 13500);
  assert.deepEqual(verdict, { sample_count: 1, bad_count: 0 });
});

test("the log carries the task key, the assignee and the idempotency key of its own row", async () => {
  const { state } = await press(STEP.person);
  const [row] = state.money_agent_tasks;
  const [log] = state.money_agent_log;
  assert.equal(log.item_id, row.id);
  assert.equal(log.idempotency_key, `money-task:${row.id}:assigned`);
  assert.equal(log.detail.task_key, STEP.person.id);
  assert.equal(log.detail.assignee, "person");
});

test("when the CSM task could not be made, the press still saves the row and the log, and the live check goes red", async () => {
  // A product finding, written as a fact: createTask answers null, so the step says "to a person on
  // our team" and nobody has a task. The live SQL is what makes it visible.
  const { out, state, verdict } = await press(STEP.person, { breaks: { noCsmTask: true } });
  assert.equal(out.ok, true);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.money_agent_tasks[0].staff_task_id, null);
  assert.equal(state.money_agent_log[0].reason, "to a person on our team");
  assert.deepEqual(verdict, { sample_count: 1, bad_count: 1 });
});
