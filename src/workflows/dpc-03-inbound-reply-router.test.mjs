import { test } from "node:test";
import assert from "node:assert";
import { handle, SMS_CONFIRM_ACK_TEMPLATE_KEY } from "./dpc-03-inbound-reply-router.mjs";
import { pgFake, fakeStep, ev, withPanelReads } from "./test-support.mjs";

const withStages = () => ({
  pipelineStages: [
    { pipeline_key: "sales", stage_key: "closed_won", pipeline_id: "pl-sales", stage_id: "st-closed" },
    { pipeline_key: "sales", stage_key: "downsell", pipeline_id: "pl-sales", stage_id: "st-downsell" }
  ]
});

// NOT gated on dpc03_awaiting_decision — that field is the dead flag the fix removed
// (nothing in the repo ever writes it). Setting it here would make this test pass
// identically on the pre-fix `isDpc03Context` gate too, masking the regression it's
// meant to prove is gone. Leaving custom_fields empty means this only passes because
// the call-state disambiguation (doc 3576-3578) lets a plain YES through on its own.
test("happy path: YES reply creates the contract task without claiming payment", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "YES let's do it" }), db, step: fakeStep() });
  assert.equal(res.decision, "yes");
  assert.equal(res.task.created, true);
  assert.equal(db.cards.length, 0);
});

test("branch: RESCHEDULE reply creates the booking-link task + sends the reschedule SMS, no card move", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: "SMS-DPC04-RESCHEDULE-REBOOKING", channel: "sms", body: "reschedule", compliance_passed: true }],
    ...withStages()
  });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "can we reschedule" }), db, step: fakeStep() });
  assert.equal(res.decision, "reschedule");
  assert.equal(res.sms.sent, true);
  assert.deepEqual(db.clients[0].tags, ["setter:reschedule"]);
  assert.equal(db.cards.length, 0);
});

test("branch: CLOSE reply moves to downsell + clears nurture tags", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", tags: ["nurture:warm"], custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "please close my file" }), db, step: fakeStep() });
  assert.equal(res.decision, "close_file");
  assert.equal(db.clients[0].tags.includes("nurture:warm"), false);
  assert.equal(db.cards[0].stage_id, "st-downsell");
});

test("branch: no decision keyword — ignored", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567" }] });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "what time is my call" }), db, step: fakeStep() });
  assert.equal(res.done, false);
});

test("branch: unknown phone number does not mint a client", async () => {
  const db = pgFake({});
  const res = await handle({ event: ev("message.inbound", { from: "+19998887777", body: "YES" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_client");
  assert.equal(db.clients.length, 0);
});

test("branch: STOP SMS is ignored (telco opt-out, not a DPC-03 keyword)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: {} }], ...withStages() });
  const res = await handle({ event: ev("message.inbound", { from: "+15551234567", body: "STOP" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "no_decision_keyword");
});

// REGRESSION: the YES purchase branch was gated on `dpc03_awaiting_decision`, a field
// NOTHING in the repo ever writes — so it was permanently unreachable. 05/30 doc
// 3576-3578 disambiguates by call state instead.
test("REGRESSION: YES after the call reaches the purchase branch (no dead context flag)", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "showed" } }] });
  const res = await handle({ event: ev("message.inbound", { body: "YES", from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(res.decision, "yes");
  assert.equal(res.task.created, true);
});

test("YES while the call is still booked is a CALL CONFIRMATION, not a sale", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "booked" } }],
    bookings: [
      { org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: "2099-10-27T18:00:00Z" },
      { org_id: "org-1", client_id: "cl-1", status: "booked", starts_at: "2099-10-27T17:00:00Z" }
    ],
    templates: [{ org_id: "org-1", template_key: SMS_CONFIRM_ACK_TEMPLATE_KEY, channel: "sms", body: "You're set for {{appointment.start_time}}.", compliance_passed: true }]
  });
  const drained = [];
  const event = ev("message.inbound", { body: "yes", from: "+1555" }, { clientId: "cl-1", id: "evt-confirm" });
  const run = () => handle({ event, db, step: fakeStep(), drainNowImpl: async (_db, messageId) => { drained.push(messageId); return { sent: 1 }; } });
  const res = await run();
  assert.equal(res.decision, "call_confirmed");
  assert.equal(db.clients[0].custom_fields.call_confirmed, true);
  assert.equal(db.clients[0].custom_fields.decision_status, undefined, "must not close a sale off a confirmation");
  assert.equal(db.tasks.length, 0);
  assert.equal(db.messages[0].template_key, SMS_CONFIRM_ACK_TEMPLATE_KEY);
  assert.match(db.messages[0].rendered_body, /Oct 27, 2099.*10:00 AM/);
  assert.equal(drained.length, 1);
  await run();
  assert.equal(db.messages.length, 1, "replayed inbound event must not queue a second acknowledgment");
});

test("CONFIRM while the call is still booked is a CALL CONFIRMATION (same as YES)", async () => {
  for (const body of ["CONFIRM", "confirm", "  Confirm  "]) {
    const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "booked" } }] });
    const res = await handle({ event: ev("message.inbound", { body, from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep(), drainNowImpl: async () => ({ sent: 0 }) });
    assert.equal(res.decision, "call_confirmed", `"${body}" must confirm the call`);
    assert.equal(db.clients[0].custom_fields.call_confirmed, true);
    assert.equal(db.clients[0].custom_fields.decision_status, undefined, "must not close a sale off a confirmation");
    assert.equal(db.tasks.length, 0);
  }
});

test("REGRESSION: a hard-stopped contact cannot trigger the contract+payment task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: { call_outcome: "showed", hard_stop_reason: "fraud_flag" } }] });
  const res = await handle({ event: ev("message.inbound", { body: "YES", from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "hard_stopped");
  assert.equal(db.tasks.length, 0);
});

// REGRESSION: the invented bare-"no" keyword closed files off ordinary replies.
test("REGRESSION: 'no thanks' no longer closes the file", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+1555", custom_fields: {} }] });
  for (const body of ["no thanks", "no worries", "not today"]) {
    const res = await handle({ event: ev("message.inbound", { body, from: "+1555" }, { clientId: "cl-1" }), db, step: fakeStep() });
    assert.equal(res.reason, "no_decision_keyword", `"${body}" must not be a decision`);
  }
});

test("duplicate delivery: replaying does not double-create the task", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15551234567", custom_fields: { dpc03_awaiting_decision: true } }], ...withStages() });
  const event = ev("message.inbound", { from: "+15551234567", body: "YES" }, { id: "evt-dup-dpc03" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.tasks.length, 1);
});

test("TENANT: a foreign-org client ID in an inbound event cannot change the file", async () => {
  const inner = pgFake({ clients: [
    { id: "home-1", org_id: "org-1", email: "home@example.invalid", phone: "+15550101", custom_fields: { call_outcome: "showed" } },
    { id: "foreign-1", org_id: "org-2", email: "foreign@example.invalid", phone: "+15550202", custom_fields: { call_outcome: "showed" } }
  ] });
  // This wrapper models PostgreSQL's explicit org_id predicate. Bare pgFake
  // resolves IDs globally, so it cannot establish tenant-isolation evidence.
  const db = withPanelReads(inner);
  for (const body of ["YES", "RESCHEDULE", "CLOSE"]) {
    const result = await handle({
      event: ev("message.inbound", { from: "+15550101", body },
        { id: `evt-foreign-${body}`, clientId: "foreign-1", orgId: "org-1" }),
      db, step: fakeStep()
    });
    assert.equal(result.done, false, `${body} must not act on a foreign file`);
    assert.equal(result.reason, "client_not_in_org");
  }
  assert.deepEqual(inner.clients[1].custom_fields, { call_outcome: "showed" });
  assert.deepEqual(inner.clients[1].tags || [], []);
  assert.equal(inner.tasks.length, 0, "no wrong-company task");
  assert.equal(inner.messages.length, 0, "no wrong-company SMS");
  assert.equal(inner.cards.length, 0, "no wrong-company stage change");
});

test("TENANT: a same-org inbound YES still opens the unpaid follow-up task", async () => {
  const inner = pgFake({ clients: [
    { id: "home-1", org_id: "org-1", email: "home@example.invalid",
      phone: "+15550101", custom_fields: { call_outcome: "showed" } }
  ] });
  const res = await handle({
    event: ev("message.inbound", { from: "+15550101", body: "YES" },
      { clientId: "home-1", orgId: "org-1" }),
    db: withPanelReads(inner), step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.decision, "yes");
  assert.equal(inner.tasks.length, 1);
  assert.equal(inner.cards.length, 0, "YES is not verified cash");
});
