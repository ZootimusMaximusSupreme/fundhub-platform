import { test } from "node:test";
import assert from "node:assert";
import { handle, templateForOffer, OFFER_EMAIL, isMasteryPaidLink } from "./s-offer-bucket.mjs";
import { pgFake, fakeStep, ev } from "./test-support.mjs";

test("templateForOffer reads offerKey, not outcome", () => {
  assert.equal(templateForOffer({ offerKey: "SOFT_PULL", outcome: "deposit" }), OFFER_EMAIL.SOFT_PULL);
  assert.equal(templateForOffer({ offerKey: "FUNDING_DFY", outcome: "deposit" }), OFFER_EMAIL.FUNDING_DFY);
  assert.equal(templateForOffer({ offerKey: null, outcome: "not_a_fit" }), OFFER_EMAIL.not_a_fit);
  assert.equal(templateForOffer({ offerKey: "none" }), OFFER_EMAIL.none);
  assert.equal(templateForOffer({ offerKey: null, outcome: "callback" }), null);
});

test("offer bucket: closer SOFT_PULL sends the payment-received email only for a verified transaction", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.SOFT_PULL, channel: "email", body: "soft", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "SOFT_PULL", outcome: "downsell", transactionId: "txn-1" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].template_key, OFFER_EMAIL.SOFT_PULL);
  assert.equal(db.messages[0].channel, "email");
});

test("offer bucket: an unpaid soft-pull link plus callback sends no payment-received email", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.SOFT_PULL, channel: "email", body: "Payment received", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "SOFT_PULL", outcome: "callback", transactionId: null }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "soft_pull_unpaid");
  assert.equal(db.messages.length, 0);
});

test("offer bucket: second closer save does not send again", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.SOFT_PULL, channel: "email", body: "soft", compliance_passed: true }]
  });
  const first = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "SOFT_PULL", outcome: "downsell", transactionId: "txn-1" }, { id: "evt-1", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  const second = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "FUNDING_DFY", outcome: "deposit" }, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(first.done, true);
  assert.equal(second.done, false);
  assert.equal(second.reason, "already_locked");
  assert.equal(db.messages.length, 1);
});

test("offer bucket: Bland AI call does not send", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com" }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.none, channel: "email", body: "none", compliance_passed: true }]
  });
  const res = await handle({
    event: ev("call.completed", { disposition: "completed" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "not_closer_disposition");
  assert.equal(db.messages.length, 0);
});

test("isMasteryPaidLink: unpaid or other products are not paid Mastery", () => {
  assert.equal(isMasteryPaidLink({ status: "sent", description: "Funding Mastery course (A to Z)" }), false);
  assert.equal(isMasteryPaidLink({ status: "paid", description: "Funding, done-for-you" }), false);
  assert.equal(isMasteryPaidLink({ status: "paid", product_code: "funding-mastery" }), true);
  assert.equal(isMasteryPaidLink({ paid_at: "2026-08-26T17:00:00Z", description: "Funding Mastery course (A to Z)" }), true);
});

test("offer bucket: unpaid Mastery does not send you're enrolled", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.FUNDING_MASTERY, channel: "email", body: "enrolled", compliance_passed: true }],
    paymentLinks: [{
      org_id: "org-1",
      client_id: "cl-1",
      status: "sent",
      paid_at: null,
      description: "Funding Mastery course (A to Z)",
      product_code: "funding-mastery"
    }]
  });
  const res = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "FUNDING_MASTERY", outcome: "downsell" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, false);
  assert.equal(res.reason, "mastery_unpaid");
  assert.equal(db.messages.length, 0);
  const again = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "FUNDING_MASTERY", outcome: "downsell" }, { id: "evt-2", clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(again.done, false);
  assert.equal(again.reason, "mastery_unpaid");
  assert.equal(db.messages.length, 0);
});

test("offer bucket: paid Mastery sends the enrolled email", async () => {
  const db = pgFake({
    clients: [{ id: "cl-1", org_id: "org-1", email: "a@b.com", custom_fields: {} }],
    templates: [{ org_id: "org-1", template_key: OFFER_EMAIL.FUNDING_MASTERY, channel: "email", body: "enrolled", compliance_passed: true }],
    paymentLinks: [{
      org_id: "org-1",
      client_id: "cl-1",
      status: "paid",
      paid_at: "2026-08-26T17:00:00Z",
      description: "Funding Mastery course (A to Z)",
      product_code: "funding-mastery"
    }]
  });
  const res = await handle({
    event: ev("call.completed", { disposition: "closer", offerKey: "FUNDING_MASTERY", outcome: "downsell" }, { clientId: "cl-1" }),
    db, step: fakeStep()
  });
  assert.equal(res.done, true);
  assert.equal(res.templateKey, OFFER_EMAIL.FUNDING_MASTERY);
  assert.equal(db.messages.length, 1);
  assert.equal(db.messages[0].template_key, OFFER_EMAIL.FUNDING_MASTERY);
});
