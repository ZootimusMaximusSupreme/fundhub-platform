import { test } from "node:test";
import assert from "node:assert";
import { handle, isStaffEngagementCloseout, EMAIL_TEMPLATE_KEY, SMS_TEMPLATE_KEY } from "./n-04-post-funding-nurture.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

const withTemplates = () => [
  { org_id: "org-1", template_key: EMAIL_TEMPLATE_KEY, channel: "email", body: "Post-funding email body", compliance_passed: true },
  { org_id: "org-1", template_key: SMS_TEMPLATE_KEY, channel: "sms", body: "Post-funding sms body", compliance_passed: true }
];

test("happy path: staff closeout sends the post-funding touch", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: withTemplates()
  });
  const res = await handle({ event: ev("round.closeout", { stage: "closed", engagementComplete: true }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.sent, true);
  assert.equal(db.messages.length, 2);
});

test("branch: no resolvable client — no send, no throw", async () => {
  const db = pgFake({ templates: withTemplates() });
  const res = await handle({ event: ev("round.closeout", { stage: "closed" }), db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "no_client");
});

test("branch: template not yet seeded — safe no-op", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: [] });
  const res = await handle({ event: ev("round.closeout", { stage: "closed" }, { clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(res.email.reason, "template_pending");
  assert.equal(db.messages.length, 0);
});

test("duplicate delivery: replaying the same event does not double-send", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  const event = ev("round.closeout", { stage: "closed" }, { id: "evt-dup-4", clientId: "cl-1" });
  await handle({ event, db, step: fakeStep() });
  await handle({ event, db, step: fakeStep() });
  assert.equal(db.messages.length, 2);
});

test("distinct rounds (different event ids) each send their own touch", async () => {
  const db = pgFake({ clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }], templates: withTemplates() });
  await handle({ event: ev("round.closeout", { stage: "closed" }, { id: "evt-round-1", clientId: "cl-1" }), db, step: fakeStep() });
  await handle({ event: ev("round.closeout", { stage: "closed" }, { id: "evt-round-2", clientId: "cl-1" }), db, step: fakeStep() });
  assert.equal(db.messages.length, 4, "two rounds closeout, two touches each");
});

test("money-chain per-round closeout does not send N-04", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: withTemplates()
  });
  const res = await handle({
    event: ev("round.closeout", { fundingRoundId: "fr-1", closeoutId: "co-1" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_engagement_closeout");
  assert.equal(db.messages.length, 0);
});

test("Card Stacking round closeout explicitly unfinished must NEVER send engagement completion messages", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: withTemplates()
  });
  const closedRound = ev("round.closeout", {
    rail: "card_stacking", source: "card_stacking", stage: "closed",
    roundNumber: 1, engagementComplete: false
  }, { id: "round-1-still-active", clientId: "cl-1" });
  const res = await handle({ event: closedRound, db, step: fakeStep() });
  assert.equal(res.sent, false);
  assert.equal(res.reason, "not_engagement_closeout");
  assert.equal(db.messages.length, 0, "do not tell a client the engagement ended after one round");
});

test("N-04 sequence-close gate respects explicit false, even if stage claims closed", () => {
  assert.equal(isStaffEngagementCloseout({ stage: "closed", engagementComplete: false }), false);
  assert.equal(isStaffEngagementCloseout({ stage: "closed", engagementComplete: true }), true);
  assert.equal(isStaffEngagementCloseout({ stage: "submitted", engagementComplete: true }), true);
  assert.equal(isStaffEngagementCloseout({ stage: "closed" }), true,
    "preserve compatibility for older staff closeout payloads without the explicit field");
});
