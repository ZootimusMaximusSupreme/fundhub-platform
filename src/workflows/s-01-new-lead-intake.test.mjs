import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-01-new-lead-intake.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const SALES_STAGES = [
  { org_id: "org-1", pipeline_key: "sales", stage_key: "new_lead",
    pipeline_id: "pipe-sales", stage_id: "stage-new-lead", sort_order: 0 }
];

test("happy path: entry.captured sets lifecycle status + lead:new tag and a board card", async () => {
  const alerted = [];
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    pipelineStages: SALES_STAGES
  });
  const res = await handle({
    event: ev("entry.captured", {}, { clientId: "cl-1", orgId: "org-1" }),
    db, step: fakeStep(), alertsImpl: async (_db, args) => { alerted.push(args); return { queued: 1 }; }
  });
  assert.equal(res.done, true);
  assert.equal(db.clients[0].custom_fields.lifecycle_status, "New Lead");
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
  assert.equal(db.cards.length, 1);
  assert.equal(db.cards[0].stage_id, "stage-new-lead");
  assert.equal(res.card && res.card.moved, true);
  assert.deepEqual(alerted, [{ orgId: "org-1", clientId: "cl-1", eventId: "evt-x" }]);
  assert.equal(res.alerts.queued, 1);
});

test("duplicate delivery: replaying does not duplicate the tag or the card", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    pipelineStages: SALES_STAGES
  });
  const event = ev("entry.captured", {}, { id: "evt-dup-s01", clientId: "cl-1", orgId: "org-1" });
  await handle({ event, db, step: fakeStep(), alertsImpl: async () => ({ queued: 1 }) });
  await handle({ event, db, step: fakeStep(), alertsImpl: async () => ({ queued: 0 }) });
  assert.deepEqual(db.clients[0].tags, ["lead:new"]);
  assert.equal(db.cards.length, 1);
});
