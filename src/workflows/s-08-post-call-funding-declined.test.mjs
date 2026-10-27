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
