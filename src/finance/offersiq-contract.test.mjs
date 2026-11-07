import test from "node:test";
import assert from "node:assert/strict";
import { requestCrsSandbox } from "../messaging/providers/crs-softview.mjs";
import { createCrsClient } from "./crs-client.mjs";
import {
  OFFERSIQ_SANDBOX_IDENTITIES,
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
const loadedProfile = Object.freeze({
  fname: "AAJKITH", mname: "Z", lname: "PDNSX", suffix: "6", houseNumber: "856",
  streetName: "BPOJVAB", streetType: "XRD", city: "HUNTSVILLE", state: "AL", zip: "35659"
});

// Current published guide: nine additional catalogue profiles and the KBJGCP
// request example. These are production deny-only, never new sandbox inputs.
const productionOnlyGuideProfiles = [
  { fname: "KBJGCP", lname: "XSCNF", streetName: "1886 VBPLDNRC", city: "TUSCALOOSA", state: "AL", zip: "35425" },
  { fname: "KKKUKUA", lname: "LFYAFGM", houseNumber: "6876", streetName: "REFPP", streetType: "MTN", city: "KETCHIKAN", state: "AK", zip: "99913" },
  { fname: "MKPLOHN", lname: "TUBOSC", houseNumber: "302", streetName: "UCEFSYMLPPLVH", streetType: "PIKE", city: "MOBILE", state: "AL", zip: "36537" },
  { fname: "MDEZF", lname: "WZPZZK", houseNumber: "2753", streetName: "BVUENNXPHLG", streetType: "PL", city: "LU VERNE", state: "AL", zip: "36049" },
  { fname: "DWFXTNT", lname: "NBGTN", houseNumber: "204", streetName: "NMVEUFSY", streetType: "FLDS", city: "BIRMINGHAM", state: "AL", zip: "35204" },
  { fname: "IAEVLOYV", lname: "YOFGUKFJC", houseNumber: "1895", streetName: "NABJCWPV", streetType: "BYU", city: "MOUNTHOPE", state: "AL", zip: "35651" },
  { fname: "INBYNNQQ", lname: "RUJDPP", houseNumber: "715", streetName: "ODCW", streetType: "LK", city: "SELMA", state: "AL", zip: "36734" },
  { fname: "RBDX", lname: "NJMFNUFJWED", houseNumber: "952", streetName: "QJNE", streetType: "MT", city: "SWAINSBORO", state: "GA", zip: "30483" },
  { fname: "NIMR", lname: "VJUNEGZNFOCH", houseNumber: "83", streetName: "DRNVHLJGI", streetType: "PLN", city: "MONTGOMERY", state: "AL", zip: "36055" },
  { fname: "SOXDNLTP", lname: "DJNJV", houseNumber: "66", streetName: "FHMASTXE", streetType: "INLT", city: "MONTGOMERY", state: "AL", zip: "36174" }
];

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

test("OffersIQ permits only the exact guide profile 2 no-SSN sandbox variant", () => {
  const body = buildOffersIqRequest({ ruleSetId: 1232, identity: loadedProfile, consent });
  assert.deepEqual(body.consumerData, loadedProfile);
  assert.equal(Object.hasOwn(body.consumerData, "ssn"), false);
  assert.equal(Object.hasOwn(body.consumerData, "dob"), false);
  assert.deepEqual(assertOffersIqWireBody(body, { sandbox: true }), body);
  for (const consumerData of [
    { ...body.consumerData, houseNumber: "857" },
    { ...body.consumerData, phone: "6025550123" },
    { ...body.consumerData, fname: "Pat", lname: "Smith" }
  ]) {
    assert.equal(isOffersIqSandboxIdentity(consumerData), false);
    assert.throws(() => assertOffersIqWireBody({ ...body, consumerData }, { sandbox: true }),
      error => error.code === "identity_not_allowed_on_sandbox");
  }
});

test("OffersIQ production transport blocks guide profile 2 including normalized and optional variants", async () => {
  let transmitted = 0;
  for (const consumerData of [
    { ...loadedProfile },
    { ...loadedProfile, fname: " aajkith ", lname: " pdnsx ", streetName: " bpojvab ",
      streetType: "xrd", city: " huntsville " },
    { ...loadedProfile, mname: "Q", suffix: "JR", phone: "6025550123" }
  ]) {
    assert.equal(isOffersIqProductionFixtureIdentity(consumerData), true);
    const result = await requestCrsSandbox({
      url: "https://mware.crscreditapi.com/api/offersiq/evaluate",
      method: "POST",
      body: JSON.stringify({ ruleSetId: 1677, consumerData, userConsent: consent }),
      env: { CRS_ALLOW_LIVE: "on", ADAPTERS_DRY_RUN: "off" },
      fetchImpl: async () => { transmitted++; throw new Error("fixture must not reach production"); }
    });
    assert.equal(result.blocked, true);
    assert.match(result.error, /sandbox identity on production/);
  }
  assert.equal(transmitted, 0);
});

test("new published production-deny profiles do not broaden the four-person sandbox fence", () => {
  assert.deepEqual(OFFERSIQ_SANDBOX_IDENTITIES.map(profile => `${profile.fname}/${profile.lname}`),
    ["YXHVVO/IMAEIF", "PAMQLOH/ADJNXZ", "SLRRZJ/RXSXYEX", "AAJKITH/PDNSX"]);
  assert.equal(productionOnlyGuideProfiles.length, 10);
  for (const profile of [...OFFERSIQ_SANDBOX_IDENTITIES, ...productionOnlyGuideProfiles]) {
    assert.equal(isOffersIqProductionFixtureIdentity(profile), true);
    assert.equal(Object.hasOwn(profile, "ssn"), false);
    assert.equal(Object.hasOwn(profile, "dob"), false);
  }
  for (const profile of OFFERSIQ_SANDBOX_IDENTITIES) {
    const body = buildOffersIqRequest({ ruleSetId: 1237, identity: profile, consent });
    assert.deepEqual(assertOffersIqWireBody(body, { sandbox: true }), body);
  }
  for (const profile of productionOnlyGuideProfiles) {
    const body = buildOffersIqRequest({ ruleSetId: 1237, identity: profile, consent });
    assert.equal(isOffersIqSandboxIdentity(body.consumerData), false);
    assert.throws(() => assertOffersIqWireBody(body, { sandbox: true }),
      error => error.code === "identity_not_allowed_on_sandbox");
  }
});

test("new guide fixtures and optional/address-format variants are blocked before production login and wire", async () => {
  let transmitted = 0;
  const env = { CRS_API_HOST: "mware.crscreditapi.com", CRS_API_USERNAME: "unit-user-not-real",
    CRS_API_PASSWORD: "unit-password-not-real", CRS_ALLOW_LIVE: "on", ADAPTERS_DRY_RUN: "off" };
  const fetchImpl = async () => { transmitted++; throw new Error("fixture must not reach production"); };
  const client = createCrsClient({ env, fetchImpl });
  let checked = 0;
  for (const profile of productionOnlyGuideProfiles) {
    const freeform = buildOffersIqRequest({ ruleSetId: 1677, consent, identity: {
      firstName: profile.fname, lastName: profile.lname, address: {
        line1: [profile.houseNumber, profile.streetName, profile.streetType].filter(Boolean).join(" "),
        city: profile.city, state: profile.state, zip: profile.zip
      }
    } }).consumerData;
    for (const consumerData of [
      { ...profile },
      { ...profile, mname: "OTHER", suffix: "JR", phone: "6025550123" },
      { ...profile, fname: ` ${profile.fname.toLowerCase()} `, lname: ` ${profile.lname.toLowerCase()} `,
        streetName: profile.streetName.toLowerCase(), city: profile.city.toLowerCase() },
      freeform
    ]) {
      assert.equal(isOffersIqProductionFixtureIdentity(consumerData), true);
      await assert.rejects(client.evaluateOffersIq({ ruleSetId: 1677, identity: consumerData, consent }),
        error => error.code === "test_identity_on_production");
      const result = await requestCrsSandbox({ url: "https://mware.crscreditapi.com/api/offersiq/evaluate",
        method: "POST", body: JSON.stringify({ ruleSetId: 1677, consumerData, userConsent: consent }), env, fetchImpl });
      assert.equal(result.blocked, true);
      assert.match(result.error, /sandbox identity on production/);
      checked++;
    }
  }
  assert.equal(checked, 40);
  assert.equal(transmitted, 0);
});

test("production fixture expansion leaves an ordinary consumer on the existing client and transport path", async () => {
  const calls = [];
  const client = createCrsClient({
    env: { CRS_API_HOST: "mware.crscreditapi.com", CRS_API_USERNAME: "unit-user-not-real",
      CRS_API_PASSWORD: "unit-password-not-real", CRS_ALLOW_LIVE: "on", ADAPTERS_DRY_RUN: "off" },
    fetchImpl: async url => {
      calls.push(new URL(url).pathname);
      const body = url.endsWith("/users/login") ? { token: "unit-token-not-real", expires: 3600 }
        : { ruleSetId: 1677, decisionStatus: "APPROVED", overallDecision: true };
      return { ok: true, status: 200, text: async () => JSON.stringify(body),
        headers: { forEach(callback) { callback(REQUEST_ID, "requestid"); } } };
    }
  });
  assert.equal(isOffersIqProductionFixtureIdentity(buildOffersIqRequest({ ruleSetId: 1677, identity, consent }).consumerData), false);
  const result = await client.evaluateOffersIq({ ruleSetId: 1677, identity, consent });
  assert.equal(result.ok, true);
  assert.equal(result.decision.outcome, "matched");
  assert.deepEqual(calls, ["/api/users/login", "/api/offersiq/evaluate"]);
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

test("malformed decision fields and mismatched nested rulesets cannot produce a match", () => {
  const base = { ruleSetId: "752", decisionStatus: "APPROVED", overallDecision: true };
  for (const patch of [
    { ruleSetId: [752] }, { overallDecision: "false" }, { decisionStatus: {} },
    { decisionStatus: "" }, { ruleEvaluation: { ruleSetId: "678" } },
    { ruleEvaluation: { ruleSetId: [752] } }
  ]) {
    const decision = parseOffersIqResponse({ body: { ...base, ...patch }, requestId: REQUEST_ID, expectedRuleSetId: 752 });
    assert.ok(["error", "needs_review"].includes(decision.outcome), JSON.stringify(patch));
  }
  const matched = parseOffersIqResponse({ body: { ...base, ruleEvaluation: { ruleSetId: 752 } },
    requestId: REQUEST_ID, expectedRuleSetId: 752 });
  assert.equal(matched.outcome, "matched");
});

test("a decisive OffersIQ outcome must agree with the final root when it is returned", () => {
  function decide(overallDecision, rootGroup) {
    const body = { ruleSetId: "752", overallDecision, decisionStatus: overallDecision ? "APPROVED" : "DECLINED",
      ruleEvaluation: { ruleSetId: "752", rootGroup } };
    return parseOffersIqResponse({ body, requestId: REQUEST_ID, expectedRuleSetId: 752 }).outcome;
  }
  for (const root of [null, [], {}, { passed: "true" }, { status: "UNVERIFIABLE" },
    { status: "FAILED", passed: false }, { status: "PASSED", passed: false }]) {
    assert.equal(decide(true, root), "needs_review");
  }
  assert.equal(decide(false, { status: "PASSED", passed: true }), "needs_review");
  assert.equal(decide(false, { status: "FAILED", passed: false }), "not_matched");
  for (const negated of [false, true]) {
    assert.equal(decide(true, { operator: "OR", negated, status: "PASSED", passed: true,
      conditions: [{ status: "FAILED", passed: false }, { status: "PASSED", passed: true }] }), "matched");
  }
});
