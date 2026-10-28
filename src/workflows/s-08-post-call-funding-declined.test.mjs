import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-08-post-call-funding-declined.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: declined outcome tags + creates the follow-up task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { outcome: "declined" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.deepEqual(db.clients[0].tags, ["offer:funding-didnt-buy"]);
  assert.equal(db.tasks.length, 1);
});

test("closer not_a_fit enters funding follow-up without entering repair referral", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { disposition: "closer", outcome: "not_a_fit", repairReferral: false }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.tasks.length, 1);
});

test("repair referral does not create a funding follow-up", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { disposition: "closer", outcome: "not_a_fit", repairReferral: true }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(db.tasks.length, 0);
});

test("branch: other outcomes ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("call.completed", { outcome: "transferred" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const event = ev("call.completed", { outcome: "declined" }, { id: "evt-dup-s08", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});

test("declined funding creates a next-day closer deadline, stable on replay", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const event = ev("call.completed",
    { disposition: "closer", outcome: "not_a_fit", repairReferral: false },
    { id: "evt-s08-due", clientId: "cl-1" });
  const before = Date.now();
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].assignee_role, "closer");
  const dueAt = new Date(db.tasks[0].due_at).getTime();
  assert.ok(Number.isFinite(dueAt), "follow-up must have a valid calendar due date");
  const oneDay = 24 * 60 * 60 * 1000;
  assert.ok(dueAt >= before + oneDay && dueAt <= Date.now() + oneDay,
    "the task is due within 24 hours of processing, never undated");
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1, "replay cannot create another follow-up");
  assert.equal(new Date(db.tasks[0].due_at).getTime(), dueAt, "replay cannot shift the deadline");
});
