import test from "node:test";
import assert from "node:assert/strict";
import {
  closerReviewSignal, nextManagerDueAt, runManagerKpiReview, SOURCE_WORKFLOW
} from "./manager-kpi-review.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const MANAGER = "00000000-0000-4000-8000-000000000003";
const NOW = new Date("2026-10-30T14:30:00.000Z");

test("the established Sales Floor sample bar yields a review, not a personnel decision", () => {
  assert.equal(closerReviewSignal({ held: 9, deposits: 0 }), null);
  assert.equal(closerReviewSignal({ held: 10, deposits: 3 }), null);
  assert.deepEqual(closerReviewSignal({ held: 10, deposits: 2 }), {
    metric: "close_rate", held: 10, deposits: 2, close_rate: 0.2, bar: 0.25
  });
  assert.equal(nextManagerDueAt(NOW).toISOString(), "2026-11-02T17:00:00.000Z");
  assert.equal(nextManagerDueAt(new Date("2026-10-31T02:00:00Z")).toISOString(), "2026-11-02T17:00:00.000Z");
});

test("one real KPI miss reaches the named manager's dated calendar once", async () => {
  const tasks = new Map();
  const created = [];
  const db = { async query(sql, params) {
    if (/FROM staff s/.test(sql)) {
      assert.match(sql, /EXISTS \(SELECT 1 FROM clients c/);
      assert.match(sql, /COALESCE\(c\.is_demo, false\) = false/);
      return { rows: [
      { org_id: ORG, staff_id: STAFF, name: "Real Closer", email: "rep@fundhub.ai", role: "closer", is_demo: false, held: 10, deposits: 2 },
      { org_id: ORG, staff_id: "demo", name: "DEMO Closer", email: "demo@example.com", role: "closer", is_demo: true, held: 12, deposits: 0 }
      ] };
    }
    if (/SELECT id FROM staff WHERE id/.test(sql)) return { rows: [{ id: MANAGER }] };
    if (/FROM tasks/.test(sql)) return { rows: tasks.has(params[2]) ? [{ id: tasks.get(params[2]) }] : [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const createTask = async (_db, spec) => {
    created.push(spec);
    tasks.set(spec.body, "task-1");
    return { created: true, id: "task-1" };
  };
  const assigneeFor = async (_db, spec) => {
    assert.deepEqual(spec, { orgId: ORG, roleKey: "closer" });
    return { assigneeRole: "sales_manager", assigneeStaffId: MANAGER };
  };

  const first = await runManagerKpiReview(db, { now: NOW, createTask, assigneeFor });
  const second = await runManagerKpiReview(db, { now: NOW, createTask, assigneeFor });
  assert.equal(first.created, 1);
  assert.equal(second.created, 0);
  assert.equal(created.length, 1);
  assert.equal(created[0].sourceWorkflow, SOURCE_WORKFLOW);
  assert.equal(created[0].assigneeStaffId, MANAGER);
  assert.equal(created[0].dueAt.toISOString(), "2026-11-02T17:00:00.000Z");
  assert.match(created[0].detail, /2 deposits from 10 held calls/);
  assert.match(created[0].detail, /decide whether coaching or a PIP is needed/);
});

test("a missing named hiring role resolves the sole active sales manager", async () => {
  const writes = [];
  const db = { async query(sql) {
    if (/FROM staff s/.test(sql)) return { rows: [
      { org_id: ORG, staff_id: STAFF, name: "Closer", email: "rep@fundhub.ai", role: "closer", held: 11, deposits: 1 }
    ] };
    if (/SELECT id FROM staff WHERE org_id/.test(sql)) return { rows: [{ id: MANAGER }] };
    if (/FROM tasks/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  await runManagerKpiReview(db, {
    now: NOW,
    assigneeFor: async () => { const err = new Error("no role"); err.code = "NOT_FOUND"; throw err; },
    createTask: async (_db, spec) => { writes.push(spec); return { created: true, id: "task-2" }; }
  });
  assert.equal(writes[0].assigneeRole, "sales_manager");
  assert.equal(writes[0].assigneeStaffId, MANAGER);
});

test("an ambiguous manager roster leaves the task in the manager queue", async () => {
  const writes = [];
  const db = { async query(sql) {
    if (/FROM staff s/.test(sql)) return { rows: [
      { org_id: ORG, staff_id: STAFF, name: "Closer", email: "rep@fundhub.ai", role: "closer", held: 11, deposits: 1 }
    ] };
    if (/SELECT id FROM staff WHERE org_id/.test(sql)) return { rows: [{ id: MANAGER }, { id: "other" }] };
    if (/FROM tasks/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  await runManagerKpiReview(db, {
    now: NOW,
    assigneeFor: async () => ({ assigneeRole: "sales_manager", assigneeStaffId: null }),
    createTask: async (_db, spec) => { writes.push(spec); return { created: true, id: "task-3" }; }
  });
  assert.equal(writes[0].assigneeRole, "sales_manager");
  assert.equal(writes[0].assigneeStaffId, null);
});

test("when no sales manager is active, the review reaches the sole owner", async () => {
  const writes = [];
  const db = { async query(sql) {
    if (/FROM staff s/.test(sql)) return { rows: [
      { org_id: ORG, staff_id: STAFF, name: "Closer", email: "rep@fundhub.ai", role: "closer", held: 10, deposits: 1 }
    ] };
    if (/role = \$2/.test(sql)) return { rows: [] };
    if (/role = 'owner'/.test(sql)) return { rows: [{ id: MANAGER }] };
    if (/FROM tasks/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const result = await runManagerKpiReview(db, {
    now: NOW,
    assigneeFor: async () => ({ assigneeRole: "sales_manager", assigneeStaffId: null }),
    createTask: async (_db, spec) => { writes.push(spec); return { created: true, id: "task-4" }; }
  });
  assert.equal(result.ok, true);
  assert.equal(writes[0].assigneeRole, "owner");
  assert.equal(writes[0].assigneeStaffId, MANAGER);
});

test("no active manager or owner leaves an error receipt and no task", async () => {
  const db = { async query(sql) {
    if (/FROM staff s/.test(sql)) return { rows: [
      { org_id: ORG, staff_id: STAFF, name: "Closer", email: "rep@fundhub.ai", role: "closer", held: 10, deposits: 1 }
    ] };
    if (/SELECT id FROM staff/.test(sql)) return { rows: [] };
    throw new Error(`unexpected SQL: ${sql}`);
  } };
  const result = await runManagerKpiReview(db, {
    now: NOW,
    assigneeFor: async () => ({ assigneeRole: "sales_manager", assigneeStaffId: null }),
    createTask: async () => { throw new Error("no task should be created"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.created, 0);
  assert.match(result.failures[0].error, /No active manager or owner/);
});
