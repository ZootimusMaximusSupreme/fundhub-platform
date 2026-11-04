import test from "node:test";
import assert from "node:assert/strict";
import handler, { OFFERSIQ_TERMS_URL, OFFERSIQ_CONSENT_VERSION } from "../../api/setter-dashboard.mjs";

const ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const STAFF = "11111111-1111-4111-8111-111111111111";
const OPERATION = "bbbbbbbb-1111-4111-8111-111111111111";
function response() {
  return { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; },
    status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
function deps(extra = {}) {
  return { db: {}, requireAuth: async () => ({ id: STAFF, org_id: ORG, role: "setter" }), ...extra };
}
function input(extra = {}) {
  return { method: "POST", body: { action: "evaluate_offersiq", client_id: CLIENT,
    operation_id: OPERATION, consent_accepted: true, ...extra } };
}

test("OffersIQ status uses the existing setter role gate without requesting a report", async () => {
  const res = response(); let received;
  await handler(input({ action: "offersiq_status", operation_id: undefined }), res, deps({
    getOffersIqStatus: async (_db, staff, args) => {
      received = { staff, args }; return { status: 200, body: { ok: true, state: "needs_address" } };
    }, evaluateLeadOffersIq: async () => assert.fail("status must not evaluate")
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(received.staff.id, STAFF);
  assert.deepEqual(received.args, { clientId: CLIENT });
});

test("OffersIQ evaluation forwards only stored-client ID, operation and explicit canonical consent", async () => {
  const res = response(); let received;
  await handler(input({ identity: { ssn: "never-forward" }, ruleSetId: 999,
    consent: { accepted: true, termsUrl: "https://untrusted.example" } }), res, deps({
    evaluateLeadOffersIq: async (_db, _staff, args) => {
      received = args; return { status: 200, body: { ok: true, outcome: "matched" } };
    }
  }));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(received).sort(), ["clientId", "consent", "operationId"]);
  assert.equal(received.consent.accepted, true);
  assert.equal(received.consent.termsUrl, OFFERSIQ_TERMS_URL);
  assert.equal(received.consent.consentVersion, OFFERSIQ_CONSENT_VERSION);
  assert.ok(Number.isFinite(Date.parse(received.consent.consentTimestamp)));
});

test("SMS consent and truthy strings never become OffersIQ consent", async () => {
  for (const accepted of [undefined, false, "true", 1]) {
    let received; const res = response();
    await handler(input({ consent_accepted: accepted, sms_consent: true }), res, deps({
      evaluateLeadOffersIq: async (_db, _staff, args) => {
        received = args; return { status: 403, body: { ok: false, error: "needs_consent" } };
      }
    }));
    assert.equal(received.consent.accepted, false);
    assert.equal(res.statusCode, 403);
  }
});

test("evaluation requires a stable operation UUID before reaching the workflow", async () => {
  for (const operation_id of [undefined, "", "bad"]) {
    const res = response();
    await handler(input({ operation_id }), res, deps({ evaluateLeadOffersIq: () => assert.fail("not called") }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_operation_id");
  }
});

test("missing auth, wrong role, foreign org shape and invalid client cannot reach OffersIQ", async () => {
  const cases = [
    { principal: null, body: {} },
    { principal: { id: STAFF, org_id: ORG, role: "client" }, body: {} },
    { principal: { id: STAFF, org_id: "bad", role: "setter" }, body: {} },
    { principal: { id: STAFF, org_id: ORG, role: "setter" }, body: { client_id: "bad" } }
  ];
  for (const item of cases) {
    const res = response();
    await handler(input(item.body), res, deps({ requireAuth: async () => item.principal,
      evaluateLeadOffersIq: () => assert.fail("unauthorized workflow call") }));
    assert.equal(res.body?.ok === true, false);
  }
});

test("a not-configured or ambiguous result preserves its failure rather than becoming a match", async () => {
  for (const status of [409, 503]) {
    const body = { ok: false, outcome: "needs_review", error: "not_configured" };
    const res = response();
    await handler(input(), res, deps({ evaluateLeadOffersIq: async () => ({ status, body }) }));
    assert.equal(res.statusCode, status);
    assert.deepEqual(res.body, body);
  }
});
