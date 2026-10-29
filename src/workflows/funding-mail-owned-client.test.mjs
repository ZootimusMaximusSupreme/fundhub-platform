// Downstream fulfillment email/document events cannot create CRM leads, patch
// foreign clients, or dispatch staff/customer work before same-org identity proof.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pgFake, fakeStep, ev } from "./test-support.mjs";
import { handle as f02 } from "./f-02-portal-id-missing.mjs";
import { handle as f03 } from "./f-03-round-submitted.mjs";
import { handle as f04 } from "./f-04-round-approvals.mjs";
import { handle as f07 } from "./f-07-funding-locked.mjs";
import { handle as f08 } from "./f-08-post-funding-monitoring.mjs";
import { handle as f10 } from "./f-10-client-funding-inbox-provisioner.mjs";
import { handle as n04 } from "./n-04-post-funding-nurture.mjs";
import { handle as n06 } from "./n-06-renewal-second-wave.mjs";
import { handle as f06 } from "./f-06-funding-conditions-missing-docs.mjs";
import { handle as f09 } from "./f-09-funding-declined-no-path.mjs";
import { handle as f11 } from "./f-11-bank-email-event-router.mjs";

const scenarios = [
  { name: "N-04 staff engagement closeout messaging", handle: n04,
    event: () => ev("round.closeout", { stage: "closed", engagementComplete: true }) },
  { name: "N-06 six-month second-wave outreach", handle: n06,
    event: () => ev("round.funded", { fundedAmount: 1000 }) },
  { name: "F-02 onboarding document reminders", handle: f02,
    event: () => ev("round.started", { roundNumber: 1 }) },
  { name: "F-03 submitted-round customer messages", handle: f03,
    event: () => ev("round.submitted", { roundNumber: 1 }) },
  { name: "F-04 approval customer messages", handle: f04,
    event: () => ev("round.approved", { approvedAmount: 2000 }) },
  { name: "F-07 funding-locked billing and messages", handle: f07,
    event: () => ev("round.funded", { approvedAmount: 2000, feePercent: 10 }) },
  { name: "F-08 funded 30-day check-in", handle: f08,
    event: () => ev("round.funded", { fundedAmount: 2000 }) },
  { name: "F-10 bank inbox provisioning", handle: f10,
    event: () => ev("round.started", { roundNumber: 1 }) },
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
    assert.equal(result.reason, "no_client");
    assert.equal(result.done ?? result.sent, false, "no action allowed without owned identity");
    assert.equal(JSON.stringify(db.clients), before, "foreign/local identity remains untouched");
    assert.equal(db.tasks.length, 0, "no advisor task");
    assert.equal(db.cards.length, 0, "no funding card");
    assert.equal(db.messages.length, 0, "no email/SMS queued");
    assert.equal(db.invoices.length, 0, "no fee invoice for mismatched client");
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
    assert.equal(result.reason, "no_client");
    assert.equal(result.done ?? result.sent, false, "no action allowed without owned identity");
    assert.equal(db.clients.length, 1, "mail response is never a signup");
    assert.equal(db.tasks.length, 0);
    assert.equal(db.messages.length, 0);
    assert.equal(db.invoices.length, 0);
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
