import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  evaluateLeadOffersIq, getOffersIqStatus, offersIqConfigFromEnv,
  offersIqIdentityKeyForClient, offersIqSummaryForClient
} from "./offersiq.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ACTOR = { id: STAFF, org_id: ORG, role: "setter" };
const CONSENT = { accepted: true, termsUrl: "https://fundhub.ai/terms/#offer-matching",
  consentVersion: "offersiq-2026-11-04", consentTimestamp: "2026-11-04T18:00:00.000Z" };
const ENV = { CRS_OFFERSIQ_API_HOST: "mware.crscreditapi.com",
  CRS_OFFERSIQ_API_USERNAME: "synthetic-user", CRS_OFFERSIQ_API_PASSWORD: "synthetic-password",
  CRS_OFFERSIQ_RULESET_ID: "752", CRS_OFFERSIQ_ALLOW_LIVE: "on", ADAPTERS_DRY_RUN: "off" };

function fakeDb() {
  const client = {
    id: CLIENT, first_name: "Pat", last_name: "Lee", phone: "+15551234567",
    custom_fields: {
      unrelated: { keep: true }, setter_residential_address: {
        line1: "123 Main St", line2: "", city: "Phoenix", state: "AZ", zip: "85001",
        source: "setter_confirmed", confirmed_at: "2026-11-04T17:00:00.000Z",
        confirmed_by_staff_id: STAFF
      }
    }
  };
  const task = { assignee_staff_id: STAFF };
  const ledger = [];
  const db = { async query(sql, params) {
    if (sql.includes("FROM clients") && sql.includes("WHERE id = $1 AND org_id = $2")) {
      return { rows: params[0] === CLIENT && params[1] === ORG ? [structuredClone(client)] : [] };
    }
    if (sql.includes("FROM tasks")) return { rows: task ? [structuredClone(task)] : [] };
    if (sql.includes("FROM offersiq_requests") && sql.includes("operation_id")) {
      return { rows: ledger.filter(row => row.org_id === params[0] && row.operation_id === params[1]).map(row => structuredClone(row)) };
    }
    if (sql.includes("FROM offersiq_requests") && sql.includes("identity_fingerprint")) {
      return { rows: ledger.filter(row => row.org_id === params[0] && row.client_id === params[1]
        && row.rule_set_id === params[2] && row.environment === params[3]
        && row.identity_fingerprint === params[4]).map(row => structuredClone(row)) };
    }
    if (sql.includes("FROM offersiq_requests") && sql.includes("status = 'in_flight'")) {
      return { rows: ledger.filter(row => row.org_id === params[0] && row.client_id === params[1]
        && row.status === "in_flight").map(row => ({ id: row.id })) };
    }
    if (sql.includes("INSERT INTO offersiq_requests")) {
      if (ledger.some(row => row.org_id === params[0] && (row.operation_id === params[3]
          || (row.client_id === params[1] && row.rule_set_id === params[4]
            && row.environment === params[5] && row.identity_fingerprint === params[6])))) {
        return { rows: [] };
      }
      const row = { id: randomUUID(), org_id: params[0], client_id: params[1],
        requester_staff_id: params[2], operation_id: params[3], rule_set_id: params[4],
        environment: params[5], identity_fingerprint: params[6],
        address_confirmed_at: params[7], consent_terms_url: params[8],
        consent_version: params[9], consent_accepted_at: params[10],
        status: "in_flight", created_at: new Date().toISOString() };
      ledger.push(row);
      return { rows: [structuredClone(row)] };
    }
    if (sql.includes("UPDATE offersiq_requests")) {
      const row = ledger.find(value => value.id === params[0] && value.org_id === params[1]
        && value.client_id === params[2] && value.status === "in_flight");
      if (!row) return { rows: [] };
      Object.assign(row, { status: params[3], provider_request_id: params[4],
        normalized_response: JSON.parse(params[5]), error_code: params[6], finished_at: params[7] });
      return { rows: [{ id: row.id }] };
    }
    if (sql.includes("UPDATE clients SET custom_fields")) {
      if (params[0] !== CLIENT || params[1] !== ORG) return { rows: [] };
      client.custom_fields.offersiq = JSON.parse(params[2]);
      return { rows: [{ id: CLIENT }] };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  return { db, client, task, ledger };
}

test("OffersIQ requires dedicated configuration and a separate live switch", () => {
  assert.equal(offersIqConfigFromEnv({ ...ENV, CRS_OFFERSIQ_ALLOW_LIVE: "" }).configured, false);
  assert.equal(offersIqConfigFromEnv({ ...ENV, CRS_OFFERSIQ_API_PASSWORD: "" }).configured, false);
  assert.equal(offersIqConfigFromEnv({ ...ENV, ADAPTERS_DRY_RUN: "on" }).configured, false);
  const config = offersIqConfigFromEnv(ENV);
  assert.equal(config.configured, true);
  assert.equal(config.environment, "production");
  assert.equal(config.clientEnv.CRS_API_USERNAME, "synthetic-user");
  assert.equal(config.clientEnv.CRS_ALLOW_LIVE, "on");
});

test("the opaque identity key changes on name or phone, not a same-address reconfirmation", () => {
  const { client } = fakeDb();
  const first = offersIqIdentityKeyForClient(client);
  assert.match(first, /^[0-9a-f]{64}$/);
  client.custom_fields.setter_residential_address.confirmed_at = "2026-11-04T19:00:00.000Z";
  assert.equal(offersIqIdentityKeyForClient(client), first);
  client.first_name = "Patricia";
  const changedName = offersIqIdentityKeyForClient(client);
  assert.notEqual(changedName, first);
  client.phone = "+15557654321";
  assert.notEqual(offersIqIdentityKeyForClient(client), changedName);
  delete client.custom_fields.setter_residential_address;
  assert.equal(offersIqIdentityKeyForClient(client), null);
});

test("the assigned setter needs a confirmed address and explicit consent before any claim", async () => {
  const { db, client, ledger, task } = fakeDb();
  const noAddress = client.custom_fields.setter_residential_address;
  delete client.custom_fields.setter_residential_address;
  assert.equal((await getOffersIqStatus(db, ACTOR, { clientId: CLIENT }, { env: ENV })).body.status, "needs_address");
  assert.equal((await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT }, { env: ENV })).body.status, "needs_address");
  assert.equal(ledger.length, 0);
  client.custom_fields.setter_residential_address = noAddress;
  assert.equal((await getOffersIqStatus(db, ACTOR, { clientId: CLIENT }, { env: ENV })).body.status, "needs_consent");
  assert.equal((await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: { ...CONSENT, accepted: false } }, { env: ENV })).body.status, "needs_consent");
  assert.equal(ledger.length, 0);
  task.assignee_staff_id = OTHER;
  assert.equal((await getOffersIqStatus(db, ACTOR, { clientId: CLIENT }, { env: ENV })).status, 403);
  const stackedSetter = { ...ACTOR, role: "closer", roles: ["setter"] };
  assert.equal((await getOffersIqStatus(db, stackedSetter, { clientId: CLIENT }, { env: ENV })).status, 403);
  task.assignee_staff_id = STAFF;
  assert.equal((await getOffersIqStatus(db, stackedSetter, { clientId: CLIENT }, { env: ENV })).body.status,
    "needs_consent");
  assert.equal((await getOffersIqStatus(db, { ...ACTOR, role: "partner", roles: ["setter"] },
    { clientId: CLIENT }, { env: ENV })).status, 403);
  assert.equal((await getOffersIqStatus(db, { ...ACTOR, org_id: OTHER }, { clientId: CLIENT }, { env: ENV })).status, 404);
});

test("one evaluated lead yields one provider call, a safe shared summary, and replay", async () => {
  const { db, client, ledger } = fakeDb();
  const operationId = randomUUID();
  let calls = 0;
  const provider = { async evaluateOffersIq(input) {
    calls += 1;
    assert.equal(input.identity.firstName, "Pat");
    assert.equal(input.identity.address.line1, "123 Main St");
    assert.equal(input.identity.phone, "5551234567");
    assert.equal(input.consent.ipAddress, undefined);
    return { ok: true, status: 200, requestId: "55555555-5555-4555-8555-555555555555",
      body: { privateRawValue: "never stored" }, decision: {
        outcome: "matched", decisionStatus: "APPROVED", overallDecision: true,
        requestId: "55555555-5555-4555-8555-555555555555",
        ruleEvaluation: { ruleSetName: "Synthetic offer", totalConditions: 2,
          passedConditions: 2, failedConditions: 0, individualResults: [
            { attributeCode: "CRS_TEST", attributeName: "Synthetic score band",
              status: "PASSED", passed: true, privateRawValue: "never stored" }
          ] }, offersIQSummary: { creditScore: 721, totalAccountCount: 12,
            openMortgageDelinquency: false, revolvingDebtUtilization: 23.5,
            privateRawValue: "never stored", income: 100000, fullName: "never stored" }
      } };
  } };
  const opts = { env: ENV, client: provider, now: () => new Date("2026-11-04T18:01:00.000Z") };
  const first = await evaluateLeadOffersIq(db, ACTOR, { clientId: CLIENT, operationId, consent: CONSENT }, opts);
  assert.equal(first.body.status, "matched");
  assert.equal(first.body.replayed, false);
  assert.equal(client.custom_fields.unrelated.keep, true);
  assert.equal(client.custom_fields.offersiq.credit_score, 721);
  assert.deepEqual(client.custom_fields.offersiq.offers_iq_summary,
    { creditScore: 721, totalAccountCount: 12, revolvingDebtUtilization: 23.5,
      openMortgageDelinquency: false });
  client.custom_fields.offersiq.offers_iq_summary.fullName = "must not leak";
  client.custom_fields.offersiq.offers_iq_summary.income = 100000;
  client.custom_fields.offersiq.raw_response = { ssn: "must not leak" };
  assert.doesNotMatch(JSON.stringify(offersIqSummaryForClient(client)), /fullName|income|raw_response|must not leak/);
  assert.equal(ledger[0].requester_staff_id, STAFF);
  assert.equal(ledger[0].consent_terms_url, CONSENT.termsUrl);
  assert.equal(ledger[0].status, "matched");
  assert.doesNotMatch(JSON.stringify(ledger[0]), /privateRawValue|never stored/);
  assert.doesNotMatch(JSON.stringify(ledger[0]), /income|fullName/);
  const retry = await evaluateLeadOffersIq(db, ACTOR, { clientId: CLIENT, operationId, consent: CONSENT }, opts);
  const newClick = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT }, opts);
  assert.equal(retry.body.replayed, true);
  assert.equal(newClick.body.replayed, true);
  assert.equal(calls, 1);
  assert.equal((await getOffersIqStatus(db, ACTOR, { clientId: CLIENT }, { env: ENV })).body.status, "matched");
  client.phone = "+15557654321";
  assert.deepEqual({ stale: offersIqSummaryForClient(client).stale,
    outcome: offersIqSummaryForClient(client).outcome }, { stale: true, outcome: "needs_review" });
  const reusedOperation = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId, consent: CONSENT }, opts);
  assert.equal(reusedOperation.status, 409);
  assert.equal(calls, 1);
});

test("a sparse provider response stays sparse and never invents profile metrics", async () => {
  const { db, client } = fakeDb();
  const provider = { async evaluateOffersIq() {
    return { ok: true, status: 200, requestId: randomUUID(), decision: {
      outcome: "not_matched", decisionStatus: "DECLINED", offersIQSummary: {},
      ruleEvaluation: { totalConditions: 1, failedConditions: 1, individualResults: [
        { attributeName: "Credit Score", expectedValue: 700, actualValue: 640, status: "FAILED" }
      ] }
    } };
  } };
  const result = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT },
    { env: ENV, client: provider, now: () => new Date("2026-11-04T18:01:00.000Z") });
  assert.equal(result.body.status, "not_matched");
  assert.equal(client.custom_fields.offersiq.credit_score, undefined);
  assert.equal(client.custom_fields.offersiq.offers_iq_summary, undefined);
  assert.doesNotMatch(JSON.stringify(client.custom_fields.offersiq), /actualValue|expectedValue/);
});

test("an ambiguous provider failure is recorded once and cannot cause an automatic second call", async () => {
  const { db, ledger } = fakeDb();
  const operationId = randomUUID();
  let calls = 0;
  const opts = { env: ENV, client: { async evaluateOffersIq() { calls += 1; throw new Error("socket closed"); } },
    now: () => new Date("2026-11-04T18:01:00.000Z") };
  const first = await evaluateLeadOffersIq(db, ACTOR, { clientId: CLIENT, operationId, consent: CONSENT }, opts);
  const retry = await evaluateLeadOffersIq(db, ACTOR, { clientId: CLIENT, operationId, consent: CONSENT }, opts);
  assert.equal(first.body.status, "needs_review");
  assert.equal(retry.body.replayed, true);
  assert.equal(ledger[0].status, "needs_review");
  assert.equal(ledger[0].error_code, "provider_uncertain");
  assert.equal(calls, 1);
});

test("address correction waits for the first wire and an old result never replaces the new identity", async () => {
  const { db, client, ledger } = fakeDb();
  let enteredFirst;
  const firstEntered = new Promise(resolve => { enteredFirst = resolve; });
  let finishFirst;
  const firstWire = new Promise(resolve => { finishFirst = resolve; });
  let calls = 0;
  const reply = (score) => ({ ok: true, status: 200, requestId: randomUUID(), decision: {
    outcome: "matched", decisionStatus: "APPROVED", requestId: randomUUID(),
    offersIQSummary: { creditScore: score }
  } });
  const provider = { async evaluateOffersIq() {
    calls += 1;
    if (calls === 1) { enteredFirst(); return firstWire; }
    return reply(780);
  } };
  const opts = { env: ENV, client: provider, now: () => new Date("2026-11-04T18:01:00.000Z") };
  const first = evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT }, opts);
  await firstEntered;
  client.custom_fields.setter_residential_address = {
    ...client.custom_fields.setter_residential_address, line1: "200 Main St",
    confirmed_at: "2026-11-04T18:00:30.000Z"
  };
  assert.equal((await getOffersIqStatus(db, ACTOR, { clientId: CLIENT }, { env: ENV })).body.error,
    "offer_check_in_progress");
  const blockedSecond = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT }, opts);
  assert.equal(blockedSecond.status, 202);
  assert.equal(calls, 1);
  finishFirst(reply(610));
  const old = await first;
  assert.equal(old.body.result.stale, true);
  assert.equal(old.body.status, "needs_review");
  assert.equal(client.custom_fields.offersiq, undefined);
  assert.equal(ledger[0].status, "matched");
  const current = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT }, opts);
  assert.equal(current.body.status, "matched");
  assert.equal(current.body.result.credit_score, 780);
  assert.equal(client.custom_fields.offersiq.credit_score, 780);
  assert.equal(calls, 2);
  assert.equal(ledger.length, 2);
});

test("sandbox refuses ordinary leads before a provider call or ledger claim", async () => {
  const { db, ledger } = fakeDb();
  let calls = 0;
  const env = { ...ENV, CRS_OFFERSIQ_API_HOST: "api-sandbox.stitchcredit.com",
    CRS_OFFERSIQ_ALLOW_LIVE: "" };
  const result = await evaluateLeadOffersIq(db, ACTOR,
    { clientId: CLIENT, operationId: randomUUID(), consent: CONSENT },
    { env, client: { async evaluateOffersIq() { calls += 1; } } });
  assert.equal(result.body.status, "needs_review");
  assert.equal(result.body.error, "identity_not_allowed_on_sandbox");
  assert.equal(ledger.length, 0);
  assert.equal(calls, 0);
});
