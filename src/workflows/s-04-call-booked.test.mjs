import { test } from "node:test";
import assert from "node:assert";
import { handle } from "./s-04-call-booked.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withStage = () => ({
  pipelineStages: [{
    org_id: "org-1",
    pipeline_key: "sales",
    stage_key: "booked",
    pipeline_id: "pl-sales",
    stage_id: "st-booked",
    sort_order: 2
  }]
});

test("happy path: booking.created tags, sets outcome, moves the card", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStage() });
  const res = await handle({ event: ev("booking.created", {}, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.deepEqual(db.clients[0].tags, ["call:booked"]);
  assert.equal(db.clients[0].custom_fields.call_outcome, "booked");
  assert.equal(db.cards[0].stage_id, "st-booked");
});

test("duplicate delivery: replaying does not duplicate the card or tag", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }], ...withStage() });
  const event = ev("booking.created", {}, { id: "evt-dup-s04", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.cards.length, 1);
  assert.deepEqual(db.clients[0].tags, ["call:booked"]);
});

test("a delayed booking workflow cannot reopen a Lost card", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    pipelineStages: [...withStage().pipelineStages,
      { org_id: "org-1", pipeline_key: "sales", stage_key: "lost", pipeline_id: "pl-sales", stage_id: "st-lost", sort_order: 9 }],
    cards: [{ id: "card-1", org_id: "org-1", client_id: "cl-1", pipeline_id: "pl-sales", stage_id: "st-lost" }]
  });
  const res = await handle({ event: ev("booking.created", { startTime: "2026-10-30T22:00:00Z" },
    { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.card.reason, "already_at_or_past");
  assert.equal(db.cards[0].stage_id, "st-lost");
});
