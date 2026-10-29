import { test } from "node:test";
import assert from "node:assert";
import { handle, checkinDueAt, CHECKIN_DAYS } from "./f-08-post-funding-monitoring.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("happy path: round.funded creates the 30-day check-in task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const res = await handle({ event: ev("round.funded", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.task.created, true);
  assert.equal(db.tasks.length, 1);
});

test("branch: no resolvable client — no task, no throw", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("round.funded", {}), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("duplicate delivery: replaying the same event does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const event = ev("round.funded", {}, { id: "evt-dup-f08", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});

test("F-08 check-in has a real 30-day Calendar deadline and owned advisor role", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const now = new Date("2026-10-29T14:00:00.000Z");
  const out = await handle({
    event: ev("round.funded", { fundedAmount: 12000 }, { clientId: "cl-1", id: "funded-round-one" }),
    db, step: fakeStep(), now
  });
  assert.equal(out.task.created, true);
  assert.equal(CHECKIN_DAYS, 30);
  assert.equal(db.tasks[0].source_workflow, "f-08-post-funding-monitoring");
  assert.equal(db.tasks[0].assignee_role, "funding_advisor");
  assert.equal(db.tasks[0].due_at.toISOString(), "2026-11-28T14:00:00.000Z");
  assert.equal(checkinDueAt(now).toISOString(), db.tasks[0].due_at.toISOString());
  assert.throws(() => checkinDueAt("not-a-date"), /invalid check-in start date/);
});

test("F-08 replays retain the first deadline, but a genuinely new funded round gets a new task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }] });
  const e1 = ev("round.funded", {}, { clientId: "cl-1", id: "funded-first" });
  const e2 = ev("round.funded", {}, { clientId: "cl-1", id: "funded-second" });
  const first = new Date("2026-10-29T14:00:00Z");
  await handle({ event: e1, db, step: fakeStep(), now: first });
  await handle({ event: e1, db, step: fakeStep(), now: new Date("2026-11-10T14:00:00Z") });
  assert.equal(db.tasks.length, 1, "replay cannot create an extra task or shift due_at");
  assert.equal(db.tasks[0].due_at.toISOString(), "2026-11-28T14:00:00.000Z");
  await handle({ event: e2, db, step: fakeStep(), now: new Date("2026-10-31T14:00:00Z") });
  assert.equal(db.tasks.length, 2, "distinct funded events need distinct follow-ups");
  assert.equal(db.tasks[1].due_at.toISOString(), "2026-11-30T14:00:00.000Z");
});

test("F-08 foreign company client is refused without a staff task", async () => {
  const db = pgFake({ clients: [{ id: "cl-foreign", org_id: "org-other", email: "f@b.com" }] });
  const e = ev("round.funded", {}, { orgId: "org-1", clientId: "cl-foreign", id: "foreign-funding" });
  const out = await handle({ event: e, db, step: fakeStep() });
  assert.equal(out.done, false);
  assert.equal(out.reason, "no_client");
  assert.equal(db.tasks.length, 0);
});
