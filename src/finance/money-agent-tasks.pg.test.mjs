// Postgres-backed tests for migration 464 (money_agent_tasks + the
// money_agent_log words) and the W5 writers that use it.
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. The table itself refuses money that skips the client's approval of an
//      exact account — whoever writes, not only proposeTransfer.
//   2. One open row per step per client is the partial unique index, not a
//      SELECT-then-INSERT that two presses can race past.
//   3. money_agent_log accepts the new action words and item kind, and still
//      refuses a word nobody declared.
//   4. "Ready to get funded" really writes the Capital Blueprint's own prep-call
//      task, once; "Do task" on a person step writes the row, the CSM task and
//      the log line, linked.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Nothing this file
// writes survives it, whatever database it is pointed at. Expected failures run
// inside SAVEPOINTs so the transaction stays usable.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12:
// a skip is not a pass — CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { proposeTransfer } from "./money-transfer-seam.mjs";
import { logMoneyAction } from "./clarity-payments.mjs";
import { requestReadyToFund } from "./ready-to-fund.mjs";
import { doTask, STAFF_TASK_SOURCE } from "./money-tasks.mjs";
import { CSM_PREP_SOURCE, CSM_PREP_TITLE, PREP_CALL_DEDUPE } from "../blueprint/closer-ready.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TODAY = "2026-10-07";

describe("money_agent_tasks (migration 464)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c;
  let orgId;
  let clientId;
  let cardId;
  let checkingId;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    orgId = (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'MoneyTasks PgTest Org') RETURNING id`,
      [`money-tasks-pg-test-${process.pid}-${Date.now()}`]
    )).rows[0].id;
    clientId = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'MoneyTasks', 'PgTest') RETURNING id`,
      [orgId]
    )).rows[0].id;
    cardId = (await c.query(
      `INSERT INTO bank_accounts (org_id, client_id, provider, name, account_type)
       VALUES ($1, $2, 'manual', 'PgTest Card', 'credit') RETURNING id`,
      [orgId, clientId]
    )).rows[0].id;
    checkingId = (await c.query(
      `INSERT INTO bank_accounts (org_id, client_id, provider, name, account_type)
       VALUES ($1, $2, 'manual', 'PgTest Checking', 'depository') RETURNING id`,
      [orgId, clientId]
    )).rows[0].id;
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function expectRefused(sql, params, code) {
    await c.query("SAVEPOINT refused");
    try {
      await c.query(sql, params);
      assert.fail(`expected ${code}`);
    } catch (e) {
      assert.equal(e.code, code, e.message);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT refused");
    }
  }

  const proposal = (over = {}) => ({
    orgId, clientId, taskKey: `due:${cardId}:2026-10-15`, kind: "due", title: "Pay $135.00 to PgTest Card",
    why: "The minimum on your latest statement.", dueOn: "2026-10-15", source: "dues",
    amountCents: 13500, toKind: "card", toAccountId: cardId, requestedByKind: "client", requestedByStaffId: null, ...over
  });

  const INSERT = `INSERT INTO money_agent_tasks
      (org_id, client_id, task_key, kind, title, source, assignee, status, moves_money,
       amount_cents, to_kind, to_account_id, from_account_id, approved_at, requested_by_kind)
    VALUES ($1, $2, $3, 'due', 'x', 'dues', $4, $5, $6, $7, $8, $9, $10, $11, 'client')`;

  test("proposeTransfer writes ONE proposal at needs_approval; a second press answers with it", async () => {
    const a = await proposeTransfer(c, proposal());
    assert.equal(a.ok, true);
    assert.equal(a.created, true);
    assert.equal(a.status, "needs_approval");
    const b = await proposeTransfer(c, proposal());
    assert.deepEqual({ ok: b.ok, created: b.created, id: b.proposalId }, { ok: true, created: false, id: a.proposalId });
    const row = (await c.query(`SELECT status, moves_money, amount_cents, to_kind, to_account_id, from_account_id, approved_at FROM money_agent_tasks WHERE id = $1`, [a.proposalId])).rows[0];
    assert.equal(row.status, "needs_approval");
    assert.equal(row.moves_money, true);
    assert.equal(Number(row.amount_cents), 13500);
    assert.equal(row.to_kind, "card");
    assert.equal(row.to_account_id, cardId);
    assert.equal(row.from_account_id, null);
    assert.equal(row.approved_at, null);
  });

  test("a destination that is not the client's own open account is refused before any row", async () => {
    const other = await proposeTransfer(c, proposal({ taskKey: "due:x:1", toAccountId: "00000000-0000-4000-8000-0000000000ff" }));
    assert.deepEqual(other, { ok: false, reason: "destination_not_found" });
  });

  test("the table refuses money that skips the client's approval of an exact account", async () => {
    // handed straight to the agent
    await expectRefused(INSERT, [orgId, clientId, "due:a:1", "agent", "queued", true, 100, "card", cardId, null, null], "23514");
    // approved, claimed or done without the client's yes on an account
    for (const status of ["approved", "claimed", "done"]) {
      await expectRefused(INSERT, [orgId, clientId, `due:b:${status}`, "agent", status, true, 100, "card", cardId, null, null], "23514");
      await expectRefused(INSERT, [orgId, clientId, `due:c:${status}`, "agent", status, true, 100, "card", cardId, checkingId, null], "23514");
    }
    // no amount / no destination
    await expectRefused(INSERT, [orgId, clientId, "due:d:1", "agent", "needs_approval", true, null, "card", cardId, null, null], "23514");
    // a person never moves money
    await expectRefused(INSERT, [orgId, clientId, "due:e:1", "person", "needs_approval", true, 100, "card", cardId, null, null], "23514");
    // Fundhub takes no account id; a card must name one
    await expectRefused(INSERT, [orgId, clientId, "clarity:f:1", "agent", "needs_approval", true, 100, "fundhub", cardId, null, null], "23514");
    await expectRefused(INSERT, [orgId, clientId, "due:g:1", "agent", "needs_approval", true, 100, "card", null, null, null], "23514");
    // an approval on a row that moves no money
    await expectRefused(INSERT, [orgId, clientId, "waypoint:h:1", "agent", "approved", false, null, null, null, checkingId, new Date()], "23514");
  });

  test("the approval shape is accepted, and done needs done_at", async () => {
    const p = await proposeTransfer(c, proposal({ taskKey: "due:approve:1", amountCents: 4000 }));
    await c.query(
      `UPDATE money_agent_tasks SET status = 'approved', approved_at = now(), from_account_id = $2 WHERE id = $1`,
      [p.proposalId, checkingId]
    );
    await c.query(`UPDATE money_agent_tasks SET status = 'claimed', claimed_by = 'rules', claimed_at = now() WHERE id = $1`, [p.proposalId]);
    await expectRefused(`UPDATE money_agent_tasks SET status = 'done' WHERE id = $1`, [p.proposalId], "23514");
    await c.query(`UPDATE money_agent_tasks SET status = 'done', done_at = now() WHERE id = $1`, [p.proposalId]);
    const row = (await c.query(`SELECT status FROM money_agent_tasks WHERE id = $1`, [p.proposalId])).rows[0];
    assert.equal(row.status, "done");
  });

  test("one open row per step per client is the index: a second open row is refused", async () => {
    await c.query(INSERT, [orgId, clientId, "waypoint:open:1", "person", "queued", false, null, null, null, null, null]);
    await expectRefused(INSERT, [orgId, clientId, "waypoint:open:1", "agent", "queued", false, null, null, null, null, null], "23505");
  });

  test("money_agent_log takes the new words and still refuses an undeclared one", async () => {
    const a = await logMoneyAction(c, {
      orgId, clientId, itemKind: "money_task", itemId: null, itemLabel: "Pay $135.00 to PgTest Card", decidedOn: TODAY,
      action: "task_assigned", actor: "client", amountCents: 13500, idempotencyKey: `money-task:pg:${Date.now()}:assigned`
    });
    assert.equal(a.created, true);
    for (const action of ["task_done", "task_failed", "task_cancelled"]) {
      const r = await logMoneyAction(c, {
        orgId, clientId, itemKind: "money_task", decidedOn: TODAY, action, actor: "agent", brain: "rules",
        idempotencyKey: `money-task:pg:${action}:${Date.now()}`
      });
      assert.equal(r.created, true, action);
    }
    await expectRefused(
      `INSERT INTO money_agent_log (org_id, client_id, item_kind, decided_on, action, actor) VALUES ($1, $2, 'client', $3, 'moved_money', 'client')`,
      [orgId, clientId, TODAY], "23514"
    );
  });

  test("Ready to get funded writes the Blueprint's own prep-call task once, and one log row", async () => {
    const first = await requestReadyToFund(c, { orgId, clientId, todayIso: TODAY });
    assert.equal(first.created, true);
    assert.equal(first.status, "requested");
    const again = await requestReadyToFund(c, { orgId, clientId, todayIso: TODAY });
    assert.equal(again.created, false);
    const tasks = (await c.query(
      `SELECT title, assignee_role, body, done FROM tasks WHERE client_id = $1 AND source_workflow = $2`,
      [clientId, CSM_PREP_SOURCE]
    )).rows;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].title, CSM_PREP_TITLE);
    assert.equal(tasks[0].assignee_role, "csm");
    assert.equal(tasks[0].body, PREP_CALL_DEDUPE);
    const logs = (await c.query(
      `SELECT action, task_id FROM money_agent_log WHERE client_id = $1 AND action = 'ready_to_fund'`, [clientId]
    )).rows;
    assert.equal(logs.length, 1);
    assert.ok(logs[0].task_id);
  });

  test("Do task on a person step: the row, one CSM task (source money-task), the log line, linked", async () => {
    const step = {
      id: "waypoint:7a1c0000-0000-4000-8000-0000000000aa", title: "Talk to your advisor about a personal loan", why: "Raise it early.",
      due_on: "2026-10-20", kind: "checkpoint", can_do: "person", late_days: null, amount_cents: null, moves_money: false,
      transfer: null, source: "waypoints", from: "your checklist", link: "/progress.html", assignment: null, _order: 0
    };
    const out = await doTask(c, {
      orgId, clientId, taskId: step.id, asOf: new Date(`${TODAY}T12:00:00Z`),
      collect: async () => ({ today: TODAY, now: new Date(`${TODAY}T12:00:00Z`), all: [step], sources: [] })
    });
    assert.equal(out.ok, true);
    assert.equal(out.created, true);
    assert.equal(out.task.assignment.assignee, "person");
    assert.equal(out.task.assignment.status, "queued");
    const row = (await c.query(`SELECT id, staff_task_id FROM money_agent_tasks WHERE client_id = $1 AND task_key = $2`, [clientId, step.id])).rows[0];
    assert.ok(row.staff_task_id);
    const t = (await c.query(`SELECT source_workflow, assignee_role, body FROM tasks WHERE id = $1`, [row.staff_task_id])).rows[0];
    assert.equal(t.source_workflow, STAFF_TASK_SOURCE);
    assert.equal(t.assignee_role, "csm");
    assert.equal(t.body, `money-task:${row.id}`);
    const log = (await c.query(`SELECT action, item_kind, task_id FROM money_agent_log WHERE idempotency_key = $1`, [`money-task:${row.id}:assigned`])).rows[0];
    assert.equal(log.action, "task_assigned");
    assert.equal(log.item_kind, "money_task");
    assert.equal(log.task_id, row.staff_task_id);
  });
});
