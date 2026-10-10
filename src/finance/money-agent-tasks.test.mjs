// The money agent's side of W5's "Do task" queue (src/finance/money-agent-tasks.mjs),
// built to docs/finance/money-agent-tasks.md §4: claim → work → done / failed,
// one money_agent_log line per finish, and never a cent moved by this unit.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { claimAgentTask, runAgentTask, finishTask, sweepAgentTasks, CLIENT_MESSAGE_MAX } from "./money-agent-tasks.mjs";
import { HELPER_PROMPT, HELPER_GUARDRAILS } from "./money-agent-ai.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const NOW = new Date("2026-10-07T17:00:00.000Z");
const AGENT = { code: "FOS-01", status: "shadow", prompt: HELPER_PROMPT, guardrails: HELPER_GUARDRAILS };
const ROW = {
  id: "11111111-2222-4333-8444-555555555555", org_id: ORG, client_id: CLIENT, task_key: "pin:open-savings",
  kind: "open_account", title: "Open a business savings account", why: "From your bank plan.", due_on: null,
  source: "bank-strategy", assignee: "agent", status: "claimed", moves_money: false, amount_cents: null,
  to_kind: null, to_account_id: null, from_account_id: null, requested_by_kind: "client", requested_by_staff_id: null
};

function world({ halted = null, finishOk = true } = {}) {
  const w = {
    calls: [], finishes: [], holds: [], turns: [],
    async query(sql, params = []) {
      w.calls.push({ sql, params });
      if (/FROM money_helper_threads WHERE client_id/.test(sql)) return { rows: halted ? [{ halted_at: NOW, halt_reason: halted }] : [] };
      if (/INSERT INTO money_helper_turns/.test(sql)) {
        const t = { id: "turn-1", org_id: params[0], client_id: params[1], kind: params[2], actor: params[3], staff_id: params[4], input: params[5], task_id: params[6], status: params[7] };
        w.turns.push(t);
        return { rows: [t] };
      }
      if (/UPDATE money_agent_tasks\s+SET status = \$4, done_at/.test(sql)) { w.finishes.push(params); return { rows: finishOk ? [{ id: params[0] }] : [] }; }
      if (/UPDATE money_agent_tasks SET result = \$4::jsonb/.test(sql)) { w.holds.push(params); return { rows: [] }; }
      throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
    }
  };
  return w;
}

function spyLog() {
  const rows = [];
  const fn = async (_db, row) => { rows.push(row); return { created: true, id: "log-1" }; };
  fn.rows = rows;
  return fn;
}
const turnDone = (fields) => async (_db, turn) => ({ ...turn, status: "answered", brain: "ai", ...fields });

describe("claiming", () => {
  test("the contract's own claim: an agent row, queued — approved only with an engine wired in", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
    await claimAgentTask(db);
    assert.match(seen[0].sql, /SET status = 'claimed', claimed_by = \$1, claimed_at = now\(\)/);
    assert.match(seen[0].sql, /assignee = 'agent'\s+AND \(status = 'queued' OR \(\$2::boolean AND status = 'approved'\)\)/);
    assert.match(seen[0].sql, /ORDER BY created_at, id\s+FOR UPDATE SKIP LOCKED/);
    assert.deepEqual(seen[0].params, ["money-helper", false]);
    await claimAgentTask(db, { includeApproved: true });
    assert.equal(seen[1].params[1], true);
  });

  test("the sweep never claims an approved money row without an engine", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push(params); return { rows: [] }; } };
    await sweepAgentTasks(db, { max: 3 });
    assert.deepEqual(seen, [["money-helper", false]]);
  });
});

describe("working a no-money row", () => {
  test("a 'task' turn on the thread; finished done with the helper's words; task_done logged", async () => {
    const w = world();
    const log = spyLog();
    const r = await runAgentTask(w, ROW, {
      now: NOW, agent: AGENT, log,
      processTurnFn: turnDone({ reply: "I put opening a business savings account on your plan for Oct 20.", actions: [{ type: "schedule_pin", status: "done" }] })
    });
    assert.equal(r.outcome, "done");
    assert.deepEqual([w.turns[0].kind, w.turns[0].task_id, w.turns[0].input, w.turns[0].status], ["task", ROW.id, "Do task: Open a business savings account", "running"]);
    assert.equal(w.finishes[0][3], "done");
    const result = JSON.parse(w.finishes[0][4]);
    assert.equal(result.client_message, "I put opening a business savings account on your plan for Oct 20.");
    assert.equal(result.turn_id, "turn-1");
    assert.deepEqual(
      [log.rows[0].action, log.rows[0].itemKind, log.rows[0].itemId, log.rows[0].actor, log.rows[0].brain, log.rows[0].idempotencyKey],
      ["task_done", "money_task", ROW.id, "agent", "ai", `money-task:${ROW.id}:task_done`]
    );
  });

  test("marked in progress: stays claimed, says where it stands, no finish logged", async () => {
    const w = world();
    const log = spyLog();
    const r = await runAgentTask(w, ROW, {
      now: NOW, agent: AGENT, log,
      processTurnFn: turnDone({ reply: "I set a reminder. Opening the account is still your step.", actions: [{ type: "mark_task_in_progress", task_id: ROW.id, status: "done" }] })
    });
    assert.equal(r.outcome, "in_progress");
    assert.equal(w.finishes.length, 0);
    assert.equal(JSON.parse(w.holds[0][3]).in_progress, true);
    assert.equal(log.rows.length, 0);
  });

  test("the helper off or stopped → failed, in plain words the page shows", async () => {
    const off = world();
    const log = spyLog();
    assert.equal((await runAgentTask(off, ROW, { now: NOW, agent: { ...AGENT, status: "draft" }, log })).outcome, "failed");
    assert.match(JSON.parse(off.finishes[0][4]).client_message, /not switched on/);
    assert.equal(log.rows[0].action, "task_failed");
    const stopped = world({ halted: "stop" });
    assert.equal((await runAgentTask(stopped, ROW, { now: NOW, agent: AGENT, log: spyLog() })).outcome, "failed");
    assert.match(JSON.parse(stopped.finishes[0][4]).client_message, /stopped/);
  });

  test("a turn that could not be answered fails the row", async () => {
    const w = world();
    const r = await runAgentTask(w, ROW, { now: NOW, agent: AGENT, log: spyLog(), processTurnFn: async (_db, t) => ({ ...t, status: "failed" }) });
    assert.equal(r.outcome, "failed");
    assert.equal(w.finishes[0][3], "failed");
  });

  test("a row that is not claimed is not ours", async () => {
    assert.equal((await runAgentTask(world(), { ...ROW, status: "queued" }, {})).outcome, "skipped");
  });
});

describe("money rows — W6 never moves money", () => {
  const MONEY = { ...ROW, moves_money: true, kind: "due", amount_cents: 13500, to_kind: "card", to_account_id: "d6ce2c94-3632-4c63-af98-802fef41ac62", from_account_id: "c73daf51-36a8-4c25-a365-3b2281ae9fc7", approved_at: NOW };

  test("no engine: skipped, nothing written", async () => {
    const w = world();
    assert.equal((await runAgentTask(w, MONEY, { now: NOW })).outcome, "skipped");
    assert.equal(w.calls.length, 0);
  });

  test("an engine (W7) sends it with the row as it is; a failure says nothing moved", async () => {
    const seen = [];
    const ok = world();
    const r = await runAgentTask(ok, MONEY, { now: NOW, log: spyLog(), engine: async (_db, row) => { seen.push(row); return { ok: true, message: "Sent $135.00 to your Amex." }; } });
    assert.equal(r.outcome, "done");
    assert.equal(seen[0], MONEY, "the engine gets the approved row untouched");
    const bad = world();
    await runAgentTask(bad, MONEY, { now: NOW, log: spyLog(), engine: async () => ({ ok: false }) });
    assert.match(JSON.parse(bad.finishes[0][4]).client_message, /Nothing moved/);
  });
});

describe("finishing", () => {
  test("only a row still claimed is finished; the message is cut to what the page shows", async () => {
    const w = world({ finishOk: false });
    const log = spyLog();
    const r = await finishTask(w, ROW, { status: "done", result: { client_message: "x".repeat(400) }, todayIso: "2026-10-07", log });
    assert.equal(r.finished, false);
    assert.equal(log.rows.length, 0, "no log line for a row someone else already closed");
    assert.equal(JSON.parse(w.finishes[0][4]).client_message.length, CLIENT_MESSAGE_MAX);
    await assert.rejects(() => finishTask(w, ROW, { status: "claimed" }), /done or failed/);
  });
});
