// Downstream fulfillment email/document events cannot create CRM leads, patch
// foreign clients, or dispatch staff/customer work before same-org identity proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { handle as f06 } from "./f-06-funding-conditions-missing-docs.mjs";
import { handle as f09 } from "./f-09-funding-declined-no-path.mjs";
import { handle as f11 } from "./f-11-bank-email-event-router.mjs";

const scenarios = [
  {
    name: "F-06 incoming bank missing-docs",
    handle: f06, event: () => ev("mail.response", {
      classification: "MISSING_DOCS", conditionDescription: "Please send documents"
    })
  },
  {
    name: "F-06 docs.received release",
    handle: f06, event: () => ev("docs.received", {})
  },
  {
    name: "F-09 final-denial review",
    handle: f09, event: () => ev("mail.response", { classification: "DENIED" })
  },
  {
    name: "F-11 bank approval task/card",
    handle: f11, event: () => ev("mail.response", { classification: "APPROVED" })
  }
];

for (const scenario of scenarios) {
  test(`${scenario.name}: explicit foreign clientId refuses even if payload email belongs locally`, async () => {
    const db = pgFake({ clients: [
      { id: "foreign-client", org_id: "org-2", email: "other@example.invalid" },
      { id: "local-client", org_id: "org-1", email: "local@example.invalid",
        outcome_tier: "FULL_FUNDING" }
    ] });
    const before = JSON.stringify(db.clients);
    const event = {
      ...scenario.event(), clientId: "foreign-client",
      payload: { ...scenario.event().payload, email: "LOCAL@EXAMPLE.INVALID" }
    };
    const result = await scenario.handle({ event, db, step: fakeStep() });
    assert.deepEqual(result, { done: false, reason: "no_client" });
    assert.equal(JSON.stringify(db.clients), before, "foreign/local identity remains untouched");
    assert.equal(db.tasks.length, 0, "no advisor task");
    assert.equal(db.cards.length, 0, "no funding card");
    assert.equal(db.messages.length, 0, "no email/SMS queued");
  });

  test(`${scenario.name}: unknown email does not create a phantom client`, async () => {
    const db = pgFake({ clients: [
      { id: "existing", org_id: "org-1", email: "real@example.invalid" }
    ] });
    const event = {
      ...scenario.event(), clientId: null,
      payload: { ...scenario.event().payload, email: "nobody@example.invalid" }
    };
    const result = await scenario.handle({ event, db, step: fakeStep() });
    assert.deepEqual(result, { done: false, reason: "no_client" });
    assert.equal(db.clients.length, 1, "mail response is never a signup");
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
  });
}

test("existing same-org client resolves from an email-only DENIED bank message", async () => {
  const db = pgFake({ clients: [
    { id: "local", org_id: "org-1", email: "real@example.invalid", outcome_tier: "FULL_FUNDING" }
  ] });
  const result = await f09({
    event: ev("mail.response", { classification: "DENIED", email: " REAL@EXAMPLE.INVALID " },
      { clientId: null }),
    db, step: fakeStep()
  });
  assert.deepEqual(result, { done: false, reason: "no_funding_round" },
    "owned email-only bank mail still reaches no-path's independent round evidence gate");
  assert.equal(db.clients.length, 1);
});

test("existing same-org client resolves from an email-only DENIED routing message", async () => {
  const db = pgFake({ clients: [{ id: "local", org_id: "org-1", email: "real@example.invalid" }] });
  const result = await f11({
    event: ev("mail.response", { classification: "DENIED", email: " REAL@EXAMPLE.INVALID " },
      { clientId: null }),
    db, step: fakeStep()
  });
  assert.equal(result.done, true);
  assert.equal(result.task.created, true);
  assert.equal(db.tasks.length, 1);
});
