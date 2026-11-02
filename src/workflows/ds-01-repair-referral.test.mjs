import { test } from "node:test";
import assert from "node:assert";
import { handle, isRepairReferral, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./ds-01-repair-referral.mjs";
import { handle as handleFundingFollowup } from "./s-08-post-call-funding-declined.mjs";
import { handle as handleOffer, OFFER_EMAIL } from "./s-offer-bucket.mjs";
import {
  handle as handleRebook,
  EMAIL_TEMPLATE_KEY as REBOOK_EMAIL,
  SMS_TEMPLATE_KEY as REBOOK_SMS
} from "./s-05a-no-show-recovery.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "repair referral email", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "repair referral sms", compliance_passed: true }
];

const client = (over = {}) => [{ id: "cl-1", org_id: "org-1", email: "a@b.com", phone: "+15550000",
  outcome_tier: "REPAIR_ONLY", custom_fields: {}, ...over }];

const referral = (extra = {}) => ({ outcome: "declined", repairReferral: true, ...extra });

// --- trigger discrimination (05/30 doc 74-78, 84-86, 157) -------------------

test("isRepairReferral: the explicit Stage 5 Sales Outcome wins when present", () => {
  assert.equal(isRepairReferral({ salesOutcome: "Repair Referral Sent" }), true);
  assert.equal(isRepairReferral({ salesOutcome: "Funding Didn't Buy" }), false);
  assert.equal(isRepairReferral({ salesOutcome: "DIY Letters Purchased" }), false);
});

// THE REGRESSION: this used to fire on ANY declined disposition.
test("REGRESSION: a plain declined call is no longer a repair referral", () => {
  assert.equal(isRepairReferral({ outcome: "declined" }), false);
});

test("REGRESSION: hard declines (OFAC / fraud / severe record) never get a partner referral", () => {
  for (const reason of ["OFAC", "fraud_flag", "hard_decline", "disqualified"]) {
    assert.equal(isRepairReferral(referral({ declineReason: reason })), false, `reason ${reason}`);
  }
});

test("isRepairReferral: a genuine repair referral passes", () => {
  assert.equal(isRepairReferral(referral()), true);
  assert.equal(isRepairReferral({ disposition: "closer", outcome: "not_a_fit", repairReferral: true }), true);
  assert.equal(isRepairReferral({ disposition: "closer", outcome: "not_a_fit", repairReferral: false }), false);
});

test("closer not_a_fit without referral enters funding follow-up only", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const call = ev("call.completed", {
    disposition: "closer", outcome: "not_a_fit", repairReferral: false
  }, { id: "sim-funding", clientId: "cl-1" });
  const funding = await handleFundingFollowup({ event: call, db, step: fakeStep() });
  const repair = await handle({ event: call, db, step: fakeStep() });
  assert.equal(funding.done, true);
  assert.equal(repair.done, false);
  assert.equal(db.tasks.length, 1);
  assert.equal(db.messages.length, 0);
});

// --- the workflow -----------------------------------------------------------

test("happy path: repair referral on a non-funding path sends and routes to Referred", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.product_path, "Referred");
  assert.ok(db.clients[0].tags.includes("client:repair-referral"));
});

test("REGRESSION: a hard decline reaches the workflow and sends nothing", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral({ declineReason: "fraud" }), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_repair_referral");
  assert.equal(db.messages.length, 0, "a fraud decline must never receive a repair partner referral");
});

test("branch: never fires on the funding route", async () => {
  const db = pgFake({ clients: client({ outcome_tier: "FULL_FUNDING" }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.done, false);
  assert.equal(res.reason, "blocked_funding_route:FULL_FUNDING");
  assert.equal(db.messages.length, 0);
});

// Doc 1284-1285 / Part B 140-141 — this workflow sends an SMS, so both must be present.
test("branch: missing phone fails the identity gate before anything is written", async () => {
  const db = pgFake({ clients: client({ phone: null }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.reason, "missing_identity");
  assert.equal(db.messages.length, 0);
  assert.equal(db.clients[0].custom_fields.product_path, undefined);
});

test("branch: pending copy — template not seeded yet, safe no-op", async () => {
  const db = pgFake({ clients: client(), templates: [] });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sms.reason, "template_pending");
});

// workflow-migration-table.md row 25: the "never fires on the funding route" guard reads
// clients.outcome_tier, which is unwritten at call.completed (decision.rendered — the
// only handler that writes it — hasn't fired yet at that point in the real event order).
// NOT fixed here — that's the open Stage-5 Sales Outcome signal question, and the trigger
// stays as-is per instruction. Every other test in this file pre-seeds a non-null tier,
// which masks this: this locks in what handle() actually does today on the real,
// genuinely-null-at-call-time shape, so the gap stays visible instead of hidden by fixture.
test("DS-01 — outcome_tier is genuinely null at call.completed: locks in current (unfixed) behavior", async () => {
  const db = pgFake({ clients: client({ outcome_tier: null }), templates: withTemplates() });
  const res = await handle({ event: ev("call.completed", referral(), { clientId: "cl-1" }), db, step: fakeStep() });
  // isFundingPath(null) is false, so the guard does not block — DS-01 proceeds and sends
  // the repair referral even though the real tier is still unknown at this point.
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 2);
  assert.equal(db.clients[0].custom_fields.product_path, "Referred");
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: client(), templates: withTemplates() });
  const event = ev("call.completed", referral(), { id: "evt-dup-ds01", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});

test("one simulated client routes closer referral, offer, and no-show rebook separately", async () => {
  const db = pgFake({
    clients: client(),
    templates: [
      ...withTemplates(),
      { org_id: "org-1", template_key: OFFER_EMAIL.REPAIR_DFY, channel: "email", body: "repair offer", compliance_passed: true },
      { org_id: "org-1", template_key: REBOOK_EMAIL, channel: "email", body: "rebook email", compliance_passed: true },
      { org_id: "org-1", template_key: REBOOK_SMS, channel: "sms", body: "rebook sms", compliance_passed: true }
    ]
  });
  const call = ev("call.completed", {
    disposition: "closer", outcome: "not_a_fit", repairReferral: true, offerKey: "REPAIR_DFY"
  }, { id: "sim-call", clientId: "cl-1" });
  const [funding, repair, offer] = await Promise.all([
    handleFundingFollowup({ event: call, db, step: fakeStep() }),
    handle({ event: call, db, step: fakeStep() }),
    handleOffer({ event: call, db, step: fakeStep() })
  ]);
  assert.equal(funding.done, false);
  assert.equal(repair.done, true);
  assert.equal(offer.done, true);
  assert.equal(db.tasks.length, 0, "repair referral must not create a funding follow-up");
  assert.deepEqual(db.messages.map((m) => m.template_key).sort(),
    [EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY, OFFER_EMAIL.REPAIR_DFY].sort());

  // S-05A stops on a booking saved after the miss, so the no-show and the rebook carry their saved times.
  db.events.push({ id: "sim-noshow", org_id: "org-1", client_id: "cl-1", name: "booking.noshow", payload: {}, created_at: "2026-11-04T19:35:00.000Z" });
  const rebookStep = {
    run: async (id, fn) => {
      const result = await fn();
      if (id === "send-touch-1") db.events.push({ org_id: "org-1", client_id: "cl-1", name: "booking.created", created_at: "2026-11-05T17:00:00.000Z" });
      return result;
    },
    sleep: async () => {},
    // S-05A waits for each touch's planned moment (9 a.m. to 5 p.m. Arizona) with sleepUntil.
    sleepUntil: async () => {}
  };
  const rebook = await handleRebook({
    event: ev("booking.noshow", {}, { id: "sim-noshow", clientId: "cl-1" }),
    db, step: rebookStep
  });
  assert.equal(rebook.stoppedAt, "before-touch-2");
  assert.equal(db.tasks.length, 1);
  assert.equal(db.tasks[0].source_workflow, "s-05a-no-show-recovery");
  assert.equal(db.messages.length, 5, "rebooking stops later touches");
});
