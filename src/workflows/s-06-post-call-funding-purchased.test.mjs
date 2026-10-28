import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-06-post-call-funding-purchased.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: funding-path deposit.paid tags + sets lifecycle, creates intake task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", tags: ["client:repair"], custom_fields: {} }] });
  const res = await handle({ event: ev("deposit.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "Funding Client");
  assert.equal(db.clients[0].custom_fields.product_path, "Funding");
  assert.deepEqual(db.clients[0].tags, ["client:funding"]);
});

test("a verified funding deposit reaches the advisor even when the earlier assessment says repair only", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "REPAIR_ONLY", custom_fields: {} }] });
  const res = await handle({ event: ev("deposit.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks[0].assignee_role, "funding_advisor");
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "Funding Client");
});

test("a funding deposit does not erase a separately purchased repair program", async () => {
  const db = pgFake({ clients: [{
    id: "cl-1", org_id: "org-1", email: "a@b.com",
    outcome_tier: "REPAIR_ONLY", tags: ["client:repair"], custom_fields: {}
  }] });
  const query = db.query.bind(db);
  db.query = async (sql, params) => {
    if (/SELECT DISTINCT pr.category AS category/.test(sql)) {
      assert.deepEqual(params, ["org-1", "cl-1"]);
      return { rows: [{ category: "funding" }, { category: "repair" }] };
    }
    return query(sql, params);
  };
  const res = await handle({ event: ev("deposit.paid", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.deepEqual(db.clients[0].tags.sort(), ["client:funding", "client:repair"]);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", outcome_tier: "FULL_FUNDING", custom_fields: {} }] });
  const event = ev("deposit.paid", {}, { id: "evt-dup-s06", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});
