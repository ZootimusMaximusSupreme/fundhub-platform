// finish-853 batch 08: POST /api/money/tasks action=do_task. The real handler runs the real task
// list and the real "Do task" (src/finance/money-tasks.mjs, the transfer seam, the CSM task writer,
// the money agent log) over stand-in tables. The row's words: hands one step to the money agent or
// a CSM; a payment becomes a transfer proposal that waits for the client's yes; nothing moves here.
// Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/tasks.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FOREIGN = "c9000000-0000-4000-8000-000000000009";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const PLAN = "d1000000-0000-4000-8000-000000000001";
const INSTALLMENT = "d2000000-0000-4000-8000-000000000002";
const LOAN_STEP = "e1000000-0000-4000-8000-000000000001";
const LLC_STEP = "e2000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-10-14T12:00:00Z");

/**
 * The tables a "Do task" reads and writes. money_agent_tasks keeps its one-open-row rule the way the
 * database does: a second row for the same task while one is open is absorbed by ON CONFLICT DO NOTHING.
 */
function taskFile({ installmentDue = "2026-10-20" } = {}) {
  const state = { agentTasks: [], staffTasks: [], log: [], proposalSql: [] };
  let n = 0;
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", custom_fields: {} },
      { id: OTHER_CLIENT, org_id: ORG, first_name: "Pat", last_name: "Other", custom_fields: {} },
      { id: FOREIGN, org_id: OTHER_ORG, first_name: "Foreign", last_name: "Person", custom_fields: {} },
    ],
    bank_accounts: [],
    clarity_payments: [
      { id: PLAN, org_id: ORG, client_id: CLIENT, kind: "plan", owed_to: "Fundhub LLC", label: null, original_cents: 30000, status: "open", settled_at: null, invoice_id: null, created_at: "2026-09-01T00:00:00Z" },
    ],
    clarity_payment_installments: [
      { id: INSTALLMENT, org_id: ORG, clarity_payment_id: PLAN, seq: 1, due_on: installmentDue, amount_cents: 10000, paid_cents: 0, paid_at: null },
    ],
    client_waypoints: [
      { id: LOAN_STEP, org_id: ORG, client_id: CLIENT, key: "personal_loan", title: "Talk to your advisor about a personal loan", detail: null, owner_kind: "client", state: "not_started", due_at: null, verify_kind: null, position: 1 },
      { id: LLC_STEP, org_id: ORG, client_id: CLIENT, key: "file_llc", title: "File your LLC", detail: null, owner_kind: "client", state: "not_started", due_at: null, verify_kind: null, position: 2 },
    ],
  };
  const openStatus = ["queued", "claimed", "needs_approval", "approved"];
  const db = tablesDb({
    tables,
    rules: [
      [/FROM money_agent_tasks m\s+LEFT JOIN tasks t/i, (s, p) => state.agentTasks
        .filter((r) => r.org_id === p[0] && r.client_id === p[1])
        .map((r) => ({ ...r, staff_done: false, staff_updated_at: null }))],
      [/^\s*INSERT INTO money_agent_tasks/i, (s, p) => {
        state.proposalSql.push(s);
        const proposal = /'needs_approval'/.test(s);
        const row = proposal
          ? { org_id: p[0], client_id: p[1], task_key: p[2], kind: p[3], title: p[4], why: p[5], due_on: p[6], source: p[7], assignee: "agent",
            status: "needs_approval", moves_money: true, amount_cents: p[8], to_kind: p[9], to_account_id: p[10], requested_by_kind: p[11], requested_by_staff_id: p[12] }
          : { org_id: p[0], client_id: p[1], task_key: p[2], kind: p[3], title: p[4], why: p[5], due_on: p[6], source: p[7], assignee: p[8],
            status: "queued", moves_money: false, amount_cents: null, to_kind: null, requested_by_kind: p[9], requested_by_staff_id: p[10] };
        const open = state.agentTasks.find((r) => r.org_id === row.org_id && r.client_id === row.client_id && r.task_key === row.task_key && openStatus.includes(r.status));
        if (open) return [];
        n += 1;
        const saved = { id: `f${String(n).padStart(7, "0")}-0000-4000-8000-000000000000`, created_at: NOW.toISOString(), done_at: null, result: null, ...row };
        state.agentTasks.push(saved);
        return [{ id: saved.id }];
      }],
      [/^\s*SELECT id, status FROM money_agent_tasks/i, (s, p) => state.agentTasks.filter((r) => r.org_id === p[0] && r.client_id === p[1] && r.task_key === p[2] && p[3].includes(r.status))],
      [/^\s*SELECT id FROM money_agent_tasks/i, (s, p) => state.agentTasks.filter((r) => r.org_id === p[0] && r.client_id === p[1] && r.task_key === p[2] && p[3].includes(r.status))],
      [/^\s*UPDATE money_agent_tasks SET staff_task_id/i, (s, p) => { const r = state.agentTasks.find((x) => x.id === p[0]); if (r) r.staff_task_id = p[1]; return { rows: [], rowCount: 1 }; }],
      [/^\s*SELECT id FROM tasks/i, (s, p) => state.staffTasks.filter((t) => t.client_id === p[0] && t.source_workflow === p[1] && t.body === p[2])],
      [/^\s*INSERT INTO tasks/i, (s, p) => {
        const [org_id, client_id, title, body, due_at, source_workflow, assignee_role] = p;
        if (state.staffTasks.some((t) => t.client_id === client_id && t.source_workflow === source_workflow && t.body === body)) return [];
        const row = { id: `t${state.staffTasks.length + 1}`, org_id, client_id, title, body, due_at, source_workflow, assignee_role };
        state.staffTasks.push(row);
        return [{ id: row.id }];
      }],
      [/^\s*INSERT INTO money_agent_log/i, (s, p) => {
        const key = p[13];
        if (state.log.some((r) => r.idempotency_key === key)) return [];
        const row = { id: `log${state.log.length + 1}`, org_id: p[0], client_id: p[1], item_kind: p[2], action: p[6], actor: p[7], reason: p[9], amount_cents: p[12], idempotency_key: key };
        state.log.push(row);
        return [{ id: row.id }];
      }],
      [/^\s*UPDATE money_agent_log SET task_id/i, []],
    ],
  });
  return { db, tables, state };
}

async function call({ body, principal, file = taskFile() } = {}) {
  const res = makeRes();
  await handler({ method: "POST", query: {}, body }, res, { db: file.db, requirePrincipal: gateAs(principal), env: {}, now: () => NOW, pins: null });
  return { res, file };
}
const staff = (role = "closer", orgId = ORG) => staffPrincipal(role, orgId, STAFF);
const press = (taskId, extra = {}) => ({ action: "do_task", task_id: taskId, client_id: CLIENT, ...extra });

describe("POST /api/money/tasks do_task", () => {
  test("a payment to Fundhub becomes a transfer proposal that waits for the client's yes, for the amount the server's own list holds", async () => {
    const { res, file } = await call({ body: press(`clarity:${INSTALLMENT}`, { amount_cents: 99999999, to_kind: "bank_account", title: "Pay a million" }), principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.task.can_do, "agent");
    assert.equal(res.body.task.moves_money, true);
    assert.equal(res.body.task.assignment.status, "needs_approval");
    assert.equal(file.state.agentTasks.length, 1);
    const row = file.state.agentTasks[0];
    assert.equal(row.status, "needs_approval", "it waits for the client's yes");
    assert.equal(row.moves_money, true);
    assert.equal(row.amount_cents, 10000, "the amount is the installment on file, never what the browser sent");
    assert.equal(row.to_kind, "fundhub");
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.requested_by_kind, "client");
    assert.equal(row.title, "Pay $100.00 to Fundhub LLC");
    assert.equal(file.state.log[0].action, "task_assigned");
    assert.equal(file.state.log[0].amount_cents, 10000);
  });

  test("nothing moves here: the only writes are the proposal, the log row and the CSM task rows — no transfer, no payment, no balance", async () => {
    const { file } = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(CLIENT, ORG) });
    const writes = file.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql));
    assert.ok(writes.length >= 2);
    for (const w of writes) assert.match(w.sql, /money_agent_tasks|money_agent_log|\btasks\b/i, w.sql.slice(0, 70));
    assert.equal(file.db.calls.some((c) => /transfers|bank_transactions|clarity_payment_installments\s+SET|SET\s+paid_cents/i.test(c.sql) && /^\s*(INSERT|UPDATE)/i.test(c.sql)), false);
  });

  test("pressing it twice while one is open answers with the open one and adds no second proposal", async () => {
    const file = taskFile();
    const first = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(CLIENT, ORG), file });
    const second = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(first.res.body.created, true);
    assert.equal(second.res.statusCode, 200);
    assert.equal(second.res.body.created, false);
    assert.equal(file.state.agentTasks.length, 1);
    assert.equal(file.state.log.length, 1);
  });

  test("a step only a person can do opens one queued row and one CSM task, named by staff when staff pressed it", async () => {
    const { res, file } = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff("closer") });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.task.can_do, "person");
    assert.equal(file.state.agentTasks.length, 1);
    const row = file.state.agentTasks[0];
    assert.equal(row.assignee, "person");
    assert.equal(row.status, "queued");
    assert.equal(row.moves_money, false);
    assert.equal(row.requested_by_kind, "staff");
    assert.equal(row.requested_by_staff_id, STAFF);
    assert.equal(file.state.staffTasks.length, 1);
    assert.equal(file.state.staffTasks[0].assignee_role, "csm");
    assert.equal(file.state.staffTasks[0].source_workflow, "money-task");
    assert.equal(file.state.staffTasks[0].client_id, CLIENT);
    assert.match(file.state.staffTasks[0].title, /^FinanceOS: Talk to your advisor about a personal loan/);
    assert.equal(file.state.agentTasks[0].staff_task_id, "t1");
  });

  test("a step only the client can do is refused as self_task and nothing is saved", async () => {
    const { res, file } = await call({ body: press(`waypoint:${LLC_STEP}`), principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "self_task");
    assert.equal(file.state.agentTasks.length, 0);
    assert.equal(file.state.staffTasks.length, 0);
  });

  test("a task that is not on this client's own list is 404, whatever id is sent", async () => {
    const file = taskFile();
    const unknown = await call({ body: press("clarity:00000000-0000-4000-8000-0000000000ff"), principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(unknown.res.statusCode, 404);
    assert.equal(unknown.res.body.error, "task_not_found");
    // Another client's installment id, sent by this client, is not on this client's list either.
    const bad = await call({ body: press("not a task id"), principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "bad_task_id");
    assert.equal(file.state.agentTasks.length, 0);
  });

  test("another client of the same company cannot hand over this client's task: the list is rebuilt from their own file", async () => {
    const file = taskFile();
    const { res } = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(OTHER_CLIENT, ORG), file });
    assert.equal(res.statusCode, 404);
    assert.equal(file.state.agentTasks.length, 0);
  });

  test("a client's own session decides the file: a client_id in the body is ignored", async () => {
    const file = taskFile();
    const { res } = await call({ body: press(`clarity:${INSTALLMENT}`, { client_id: FOREIGN }), principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(res.statusCode, 200);
    assert.equal(file.state.agentTasks[0].client_id, CLIENT);
  });

  test("staff of another company get 404 and nothing is saved; only the four FinanceOS roles may press it", async () => {
    const file = taskFile();
    const other = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff("owner", OTHER_ORG), file });
    assert.equal(other.res.statusCode, 404);
    assert.equal(file.state.agentTasks.length, 0);
    const letIn = [];
    for (const role of ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
      const f = taskFile();
      const { res } = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff(role), file: f });
      if (res.statusCode === 403) assert.equal(f.state.agentTasks.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "owner", "sales_manager"]);
  });

  test("an unknown action is 400 and nothing is saved", async () => {
    const { res, file } = await call({ body: { action: "send_money", task_id: `clarity:${INSTALLMENT}`, client_id: CLIENT }, principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
    assert.equal(file.state.agentTasks.length, 0);
  });

  // ── what the saved row and the log say ───────────────────────────────────────────────────────────

  test("a payment already set up and finished for that due date is never proposed again", async () => {
    const file = taskFile();
    file.state.agentTasks.push({
      id: "f9999999-0000-4000-8000-000000000001", org_id: ORG, client_id: CLIENT, task_key: `clarity:${INSTALLMENT}`, kind: "due",
      title: "Pay $100.00 to Fundhub LLC", assignee: "agent", status: "done", moves_money: true, amount_cents: 10000, to_kind: "fundhub",
      created_at: "2026-10-10T00:00:00Z", done_at: "2026-10-11T00:00:00Z", requested_by_kind: "client",
    });
    const { res } = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.created, false);
    assert.equal(file.state.agentTasks.length, 1, "no second proposal");
    assert.equal(file.state.log.length, 0, "and nothing is logged as assigned again");
  });

  test("the proposal keeps the due day, the reason and the kind from the server's own list", async () => {
    const { res, file } = await call({ body: press(`clarity:${INSTALLMENT}`, { due_on: "2030-01-01", why: "forged", kind: "other" }), principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(res.statusCode, 200);
    const row = file.state.agentTasks[0];
    assert.equal(row.due_on, "2026-10-20", "the installment's own due day");
    assert.ok(row.why && row.why !== "forged");
    assert.equal(row.why, res.body.task.why);
    assert.equal(row.kind, res.body.task.kind);
    assert.notEqual(row.kind, "other");
    assert.equal(row.source, res.body.task.source);
    assert.equal(res.body.task.due_on, "2026-10-20");
  });

  test("a person's step keeps its due day on the saved row and on the team's task", async () => {
    const file = taskFile();
    file.tables.client_waypoints[0].due_at = "2026-10-25T00:00:00Z";
    const { res } = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff("closer"), file });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(file.state.agentTasks[0].due_on, "2026-10-25");
    assert.equal(file.state.staffTasks[0].due_at, "2026-10-25", "the team's task is due the same day");
    assert.match(file.state.agentTasks[0].why, /\S/);
  });

  test("two different hand-overs are two team tasks and two log rows, each under its own key", async () => {
    const file = taskFile();
    const LOAN_STEP_2 = "e3000000-0000-4000-8000-000000000003";
    file.tables.client_waypoints.push({ id: LOAN_STEP_2, org_id: ORG, client_id: CLIENT, key: "personal_loan", title: "Talk to your advisor about a second loan", detail: null, owner_kind: "client", state: "not_started", due_at: null, verify_kind: null, position: 3 });
    const a = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff("closer"), file });
    const b = await call({ body: press(`waypoint:${LOAN_STEP_2}`), principal: staff("closer"), file });
    assert.equal(a.res.statusCode, 200, JSON.stringify(a.res.body));
    assert.equal(b.res.statusCode, 200, JSON.stringify(b.res.body));
    assert.equal(file.state.agentTasks.length, 2);
    assert.equal(file.state.staffTasks.length, 2, "the second step is not swallowed as a repeat of the first");
    assert.deepEqual(file.state.agentTasks.map((r) => r.task_key), [`waypoint:${LOAN_STEP}`, `waypoint:${LOAN_STEP_2}`]);
    assert.ok(file.state.agentTasks.every((r) => r.staff_task_id), "each row points at its own team task");
    assert.notEqual(file.state.agentTasks[0].staff_task_id, file.state.agentTasks[1].staff_task_id);
    assert.equal(file.state.log.length, 2);
    assert.equal(new Set(file.state.log.map((r) => r.idempotency_key)).size, 2);
    for (const row of file.state.agentTasks) {
      assert.ok(file.state.log.some((l) => l.idempotency_key === `money-task:${row.id}:assigned`), `the log key names the row ${row.id}`);
    }
  });

  test("the log says who pressed it and why: staff or client, a person on the team or a payment set up for the client's OK", async () => {
    const byStaff = await call({ body: press(`waypoint:${LOAN_STEP}`), principal: staff("closer") });
    assert.equal(byStaff.file.state.log[0].actor, "staff");
    assert.equal(byStaff.file.state.log[0].reason, "to a person on our team");
    assert.equal(byStaff.file.state.log[0].amount_cents ?? null, null, "a talk has no amount");
    const byClient = await call({ body: press(`clarity:${INSTALLMENT}`), principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(byClient.file.state.log[0].actor, "client");
    assert.equal(byClient.file.state.log[0].reason, "set up for your OK: $100.00");
    assert.equal(byClient.file.state.log[0].amount_cents, 10000);
    const staffMoney = await call({ body: press(`clarity:${INSTALLMENT}`), principal: staff("owner") });
    assert.equal(staffMoney.file.state.log[0].actor, "staff");
    assert.equal(staffMoney.file.state.agentTasks[0].requested_by_staff_id, STAFF);
    assert.equal(staffMoney.file.state.agentTasks[0].requested_by_kind, "staff");
  });
});
