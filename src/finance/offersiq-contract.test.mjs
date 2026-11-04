import test from "node:test";
import assert from "node:assert/strict";
import {
  assertOffersIqWireBody,
  buildOffersIqRequest,
  isOffersIqSandboxIdentity,
  isOffersIqProductionFixtureIdentity,
  parseOffersIqResponse
} from "./offersiq-contract.mjs";

const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440000";
const consent = { accepted: true, termsUrl: "https://fundhub.ai/credit-consent", consentVersion: "offersiq-v1" };
const identity = {
  firstName: "Pat", lastName: "Smith", phone: "+1 (602) 555-0123",
  ssn: "never-send", dob: "never-send",
  address: { line1: "123 Main St", line2: "", city: "Phoenix", state: "az", zip: "85001" }
};

test("OffersIQ request selects only no-SSN fields and keeps a numbered street intact", () => {
  const body = buildOffersIqRequest({ ruleSetId: 752, identity, consent });
  assert.deepEqual(body.consumerData, {
    fname: "Pat", lname: "Smith", streetName: "Main St", city: "Phoenix",
    state: "AZ", zip: "85001", houseNumber: "123", phone: "6025550123"
  });
  assert.equal(JSON.stringify(body).includes("never-send"), false);
  assert.equal(body.userConsent.accepted, true);
  assert.equal(body.userConsent.termsUrl, consent.termsUrl);
});

test("OffersIQ rejects consent coercion, unit loss, long names and long streets", () => {
  for (const accepted of [false, "true", 1, null]) {
    assert.throws(() => buildOffersIqRequest({ ruleSetId: 752, identity, consent: { ...consent, accepted } }),
      e => e.code === "consent_required");
  }
  assert.throws(() => buildOffersIqRequest({ ruleSetId: 752, identity: {
    ...identity, address: { ...identity.address, line2: "Apt 2" }
  }, consent }), e => e.code === "address_needs_review");
  assert.throws(() => buildOffersIqRequest({ ruleSetId: 752, identity: {
    ...identity, address: { ...identity.address, line1: "123 Main St Apt 2" }
  }, consent }), e => e.code === "address_needs_review");
  assert.throws(() => buildOffersIqRequest({ ruleSetId: 752, identity: { ...identity, firstName: "A".repeat(16) }, consent }),
    e => e.code === "identity_invalid");
  assert.throws(() => buildOffersIqRequest({ ruleSetId: 752, identity: {
    ...identity, address: { ...identity.address, line1: "123 Very Long Street Name That Cannot Fit" }
  }, consent }), e => e.code === "identity_invalid");
});

test("OffersIQ last-point guard refuses forbidden wire fields and wrong sandbox consumer", () => {
  const body = buildOffersIqRequest({ ruleSetId: 752, identity, consent });
  assert.throws(() => assertOffersIqWireBody({ ...body, consumerData: { ...body.consumerData, ssn: "000000000" } }),
    e => e.code === "request_invalid");
  assert.throws(() => assertOffersIqWireBody(body, { sandbox: true }),
    e => e.code === "identity_not_allowed_on_sandbox");
  const fixture = buildOffersIqRequest({ ruleSetId: 752,
    identity: { fname: "YXHVVO", lname: "IMAEIF", streetName: "SYMFO", city: "HUNTSVILLE", state: "AL", zip: "35692" },
    consent });
  assert.equal(isOffersIqSandboxIdentity(fixture.consumerData), true);
  assert.deepEqual(assertOffersIqWireBody(fixture, { sandbox: true }), fixture);
  const withPhone = { ...fixture.consumerData, phone: "6025550123" };
  assert.equal(isOffersIqSandboxIdentity(withPhone), false);
  assert.equal(isOffersIqProductionFixtureIdentity(withPhone), true);
  assert.equal(isOffersIqProductionFixtureIdentity({ ...withPhone, mname: "G", suffix: "JR", city: "Huntsville" }), true);
  assert.equal(isOffersIqProductionFixtureIdentity({ ...withPhone, fname: "Real" }), false);
  const freeformFixture = buildOffersIqRequest({ ruleSetId: 752,
    identity: { firstName: "PAMQLOH", lastName: "ADJNXZ", address: {
      line1: "791 GIGUZQTTQSA PNES", city: "BIRMINGHAM", state: "AL", zip: "35107"
    } }, consent });
  assert.equal(isOffersIqSandboxIdentity(freeformFixture.consumerData), false);
  assert.equal(isOffersIqProductionFixtureIdentity(freeformFixture.consumerData), true);
});

test("OffersIQ decisions distinguish pass, fail, no-hit and provider error", () => {
  const base = { ruleSetId: "752", processedAt: "2026-11-04T00:00:00Z" };
  const rootGroup = { operator: "OR", status: "PASSED", groups: [], conditions: [] };
  const approved = parseOffersIqResponse({ body: { ...base, decisionStatus: "APPROVED", overallDecision: true,
    ruleEvaluation: { rootGroup }, offersIQSummary: { creditScore: 742 } }, requestId: REQUEST_ID, expectedRuleSetId: 752 });
  assert.equal(approved.outcome, "matched");
  assert.equal(approved.ruleEvaluation.rootGroup.operator, "OR");
  assert.equal(approved.offersIQSummary.creditScore, 742);
  assert.equal(Object.hasOwn(approved, "exactScore"), false);
  assert.equal(parseOffersIqResponse({ body: { ...base, decisionStatus: "DECLINED", overallDecision: false }, requestId: REQUEST_ID, expectedRuleSetId: 752 }).outcome, "not_matched");
  assert.equal(parseOffersIqResponse({ body: { ...base, decisionStatus: "INSUFFICIENT_DATA", overallDecision: false }, requestId: REQUEST_ID, expectedRuleSetId: 752 }).outcome, "needs_review");
  assert.equal(parseOffersIqResponse({ body: { ...base, decisionStatus: "ERROR" }, requestId: REQUEST_ID, expectedRuleSetId: 752 }).outcome, "error");
  assert.equal(parseOffersIqResponse({ body: { ...base, decisionStatus: "APPROVED" }, requestId: null, expectedRuleSetId: 752 }).outcome, "needs_review");
  assert.equal(parseOffersIqResponse({ body: { ...base, decisionStatus: "APPROVED" }, requestId: REQUEST_ID, expectedRuleSetId: 999 }).reason, "ruleset_mismatch");
});
