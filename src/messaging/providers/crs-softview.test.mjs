import test from "node:test";
import assert from "node:assert/strict";

import {
  redactCrsError,
  requestCrsSandbox
} from "./crs-softview.mjs";
import { SANDBOX_TEST_IDENTITIES } from "../../finance/crs-identities.mjs";
import { buildOffersIqRequest } from "../../finance/offersiq-contract.mjs";

const SANDBOX_URL = "https://api-sandbox.stitchcredit.com/api/users/login";

function response(body = { ok: true }, headers = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    headers: {
      forEach(callback) {
        for (const [key, value] of Object.entries(headers)) callback(value, key);
      }
    }
  };
}

test("CRS provider: the adapters fence blocks by default", async () => {
  let called = false;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const result = await requestCrsSandbox({
      url: SANDBOX_URL,
      body: "{}",
      env: {},
      fetchImpl: async () => {
        called = true;
        return response();
      }
    });
    assert.equal(result.blocked, true);
    assert.equal(called, false);
  } finally {
    console.warn = originalWarn;
  }
});

test("CRS provider: explicit fence-off uses only the injected transport", async () => {
  const calls = [];
  const result = await requestCrsSandbox({
    url: SANDBOX_URL,
    method: "POST",
    headers: { Accept: "application/json" },
    body: "{\"safe\":true}",
    env: { ADAPTERS_DRY_RUN: "0" },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({ token: "fake" }, { RequestID: "request-1" });
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.headers.requestid, "request-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, SANDBOX_URL);
  assert.equal(calls[0].init.body, "{\"safe\":true}");
});

test("CRS provider: production without CRS_ALLOW_LIVE never reaches transport", async () => {
  let called = false;
  const result = await requestCrsSandbox({
    url: "https://mware.crscreditapi.com/api/users/login",
    env: { ADAPTERS_DRY_RUN: "0" },
    fetchImpl: async () => {
      called = true;
      return response();
    }
  });
  assert.equal(result.blocked, true);
  assert.match(result.error, /CRS_ALLOW_LIVE/);
  assert.equal(called, false);
});

test("CRS provider: unknown and non-https hosts never reach transport", async () => {
  for (const url of [
    "https://example.invalid/api/users/login",
    "http://api-sandbox.stitchcredit.com/api/users/login"
  ]) {
    let called = false;
    const result = await requestCrsSandbox({
      url,
      env: { ADAPTERS_DRY_RUN: "0" },
      fetchImpl: async () => {
        called = true;
        return response();
      }
    });
    assert.equal(result.blocked, true);
    assert.match(result.error, /allowed CRS host required/);
    assert.equal(called, false);
  }
});

test("CRS provider: production + CRS_ALLOW_LIVE on reaches transport", async () => {
  const calls = [];
  const result = await requestCrsSandbox({
    url: "https://mware.crscreditapi.com/api/users/login",
    env: { ADAPTERS_DRY_RUN: "0", CRS_ALLOW_LIVE: "1" },
    fetchImpl: async (url) => {
      calls.push(url);
      return response({ token: "fake" });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
});

test("CRS provider: report routes accept only the exact bureau fixture", async () => {
  const url = "https://api-sandbox.stitchcredit.com/api/transunion/credit-report/standard/tu-prequal-fico9";
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return response({ creditFiles: [] });
  };

  const wrong = JSON.parse(JSON.stringify(SANDBOX_TEST_IDENTITIES.TU));
  wrong.addresses[0].postalCode = "00000";
  const refused = await requestCrsSandbox({
    url,
    body: JSON.stringify(wrong),
    env: { ADAPTERS_DRY_RUN: "0" },
    fetchImpl
  });
  assert.equal(refused.blocked, true);
  assert.equal(calls, 0);

  const allowed = await requestCrsSandbox({
    url,
    body: JSON.stringify(SANDBOX_TEST_IDENTITIES.TU),
    env: { ADAPTERS_DRY_RUN: "0" },
    fetchImpl
  });
  assert.equal(allowed.ok, true);
  assert.equal(calls, 1);
});

test("CRS provider: unlisted sandbox endpoints are refused", async () => {
  let called = false;
  const result = await requestCrsSandbox({
    url: "https://api-sandbox.stitchcredit.com/api/arbitrary",
    env: { ADAPTERS_DRY_RUN: "0" },
    fetchImpl: async () => {
      called = true;
      return response();
    }
  });
  assert.equal(result.blocked, true);
  assert.equal(result.error, "CRS request refused: endpoint not allowed");
  assert.equal(called, false);
});

test("CRS provider: allows the documented LNR Top Business endpoints", async () => {
  for (const path of [
    "/api/top-business-search/top-business-search",
    "/api/top-business-report/top-business-report",
    "/api/top-business-report/pdf/top-business-report"
  ]) {
    let called = false;
    const result = await requestCrsSandbox({
      url: "https://api-sandbox.stitchcredit.com" + path,
      env: { ADAPTERS_DRY_RUN: "0" },
      body: "{}",
      fetchImpl: async () => { called = true; return response({ ok: true }); }
    });
    assert.equal(result.ok, true, path);
    assert.equal(called, true, path);
  }
});

test("CRS provider: errors redact credentials and Social Security numbers", () => {
  const password = "unit-password-not-real";
  const safe = redactCrsError(
    `password=${password} Bearer fake-token 666-32-1120`,
    { secrets: [password] }
  );
  assert.doesNotMatch(safe, /unit-password|fake-token|666/);
  assert.match(safe, /redacted/);
});

test("CRS provider: OffersIQ permits only documented synthetic no-SSN evaluation", async () => {
  const fixture = buildOffersIqRequest({ ruleSetId: 752,
    identity: { fname: "YXHVVO", lname: "IMAEIF", streetName: "SYMFO", city: "HUNTSVILLE", state: "AL", zip: "35692" },
    consent: { accepted: true, termsUrl: "https://fundhub.ai/credit-consent" } });
  const calls = [];
  const url = "https://api-sandbox.stitchcredit.com/api/offersiq/evaluate";
  const fetchImpl = async (target, init) => {
    calls.push({ target, init });
    return response({ decisionStatus: "INSUFFICIENT_DATA", ruleSetId: "752" });
  };
  const good = await requestCrsSandbox({ url, body: JSON.stringify(fixture), env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl });
  assert.equal(good.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].target, url);
  assert.equal(JSON.stringify(fixture).includes("ssn"), false);

  for (const bad of [
    { ...fixture, consumerData: { ...fixture.consumerData, ssn: "000000000" } },
    { ...fixture, consumerData: { ...fixture.consumerData, fname: "Real" } },
    { ...fixture, userConsent: { ...fixture.userConsent, accepted: "true" } }
  ]) {
    const result = await requestCrsSandbox({ url, body: JSON.stringify(bad), env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl });
    assert.equal(result.blocked, true);
  }
  assert.equal(calls.length, 1);
});

test("CRS provider: OffersIQ re-evaluation requires a UUID path and no body", async () => {
  const id = "550e8400-e29b-41d4-a716-446655440000";
  const url = `https://api-sandbox.stitchcredit.com/api/offersiq/reevaluate/${id}`;
  let count = 0;
  const fetchImpl = async () => { count++; return response({ decisionStatus: "APPROVED" }); };
  const good = await requestCrsSandbox({ url, env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl });
  assert.equal(good.ok, true);
  for (const candidate of [
    { url, body: "{}" },
    { url: "https://api-sandbox.stitchcredit.com/api/offersiq/reevaluate/not-a-uuid" },
    { url: "https://api-sandbox.stitchcredit.com/api/offersiq/evaluate/extra" }
  ]) {
    const result = await requestCrsSandbox({ ...candidate, env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl });
    assert.equal(result.blocked, true);
  }
  assert.equal(count, 1);
});

test("CRS provider: OffersIQ production still needs live gate and refuses sandbox consumers", async () => {
  const fixture = buildOffersIqRequest({ ruleSetId: 752,
    identity: { fname: "YXHVVO", lname: "IMAEIF", streetName: "SYMFO", city: "HUNTSVILLE", state: "AL", zip: "35692" },
    consent: { accepted: true, termsUrl: "https://fundhub.ai/credit-consent" } });
  const url = "https://mware.crscreditapi.com/api/offersiq/evaluate";
  let calls = 0;
  const fetchImpl = async () => { calls++; return response({ decisionStatus: "APPROVED" }); };
  const noGate = await requestCrsSandbox({ url, body: JSON.stringify(fixture), env: { ADAPTERS_DRY_RUN: "0" }, fetchImpl });
  assert.equal(noGate.blocked, true);
  const noFixture = await requestCrsSandbox({ url, body: JSON.stringify(fixture),
    env: { ADAPTERS_DRY_RUN: "0", CRS_ALLOW_LIVE: "1" }, fetchImpl });
  assert.equal(noFixture.blocked, true);
  const withPhone = { ...fixture, consumerData: { ...fixture.consumerData, phone: "6025550123" } };
  const noFixtureWithPhone = await requestCrsSandbox({ url, body: JSON.stringify(withPhone),
    env: { ADAPTERS_DRY_RUN: "0", CRS_ALLOW_LIVE: "1" }, fetchImpl });
  assert.equal(noFixtureWithPhone.blocked, true);
  const freeformFixture = buildOffersIqRequest({ ruleSetId: 752,
    identity: { firstName: "PAMQLOH", lastName: "ADJNXZ", address: {
      line1: "791 GIGUZQTTQSA PNES", city: "BIRMINGHAM", state: "AL", zip: "35107"
    } }, consent: { accepted: true, termsUrl: "https://fundhub.ai/credit-consent" } });
  const noFreeformFixture = await requestCrsSandbox({ url, body: JSON.stringify(freeformFixture),
    env: { ADAPTERS_DRY_RUN: "0", CRS_ALLOW_LIVE: "1" }, fetchImpl });
  assert.equal(noFreeformFixture.blocked, true);
  assert.equal(calls, 0);
});
