import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./f-01-funding-intake.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding-path client with no pod gets tagged + a pod task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.podTask.created, true);
  assert.ok(new Date(db.tasks[0].due_at) > new Date(), "undated pod tasks disappear from the Calendar");
  assert.deepEqual(db.clients[0].tags.sort(), ["client:funding", "ops:action-required"]);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "Funding Client");
  assert.equal(db.clients[0].custom_fields.employee_next_action, "Collect Documents");
});

test("branch: repair-only client exits, not funding path", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY" }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_funding_path:REPAIR_ONLY");
  assert.equal(db.clients[0].tags, undefined);
});

test("branch: pod already assigned — no task created", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: { pod_name: "Pod Alpha" } }] });
  const res = await handle({ event: ev("round.started", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.podTask.created, false);
  assert.equal(db.tasks.length, 0);
});

test("duplicate delivery: replaying the same event does not double-create the pod task or double-tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const event = ev("round.started", {}, { id: "evt-dup-f01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.deepEqual(db.clients[0].tags.sort(), ["client:funding", "ops:action-required"]);
});

test("paid funding overrides a stale repair-only assessment for advisor assignment", async () => {
  const db = pgFake({ clients: [{
    id: "cl-1", org_id: "org-1", email: "a@b.com",
    outcome_tier: "REPAIR_ONLY", custom_fields: {}
  }] });
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/SELECT DISTINCT pr.category AS category/.test(sql)) {
      assert.deepEqual(params, ["org-1", "cl-1"]);
      return { rows: [{ category: "funding" }] };
    }
    return query(sql, params);
  };
  const e = ev("round.started", {}, { clientId: "cl-1", id: "paid-stale-tier" });
  const first = await handle({ event: e, db, step: fakeStep() });
  assert.equal(first.done, true);
  assert.equal(first.podTask.created, true);
  assert.equal(db.tasks[0].assignee_role, "funding_advisor");
  assert.ok(new Date(db.tasks[0].due_at) > new Date());
  await handle({ event: e, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1, "replaying the funding round must not create a second pod task");
});
