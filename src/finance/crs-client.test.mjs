import test from "node:test";
import assert from "node:assert/strict";

import {
  CRS_PRODUCTS,
  createCrsClient,
  crsConfigFromEnv
} from "./crs-client.mjs";
import {
  BUREAUS,
  CRS_PRODUCTION_HOST,
  CRS_SANDBOX_HOST,
  SANDBOX_TEST_IDENTITIES
} from "./crs-identities.mjs";

const USERNAME = "unit-user-not-real";
const PASSWORD = "unit-password-not-real";
const LIVE_ENV = Object.freeze({
  CRS_API_USERNAME: USERNAME,
  CRS_API_PASSWORD: PASSWORD,
  CRS_API_HOST: CRS_SANDBOX_HOST,
  ADAPTERS_DRY_RUN: "0"
});

function response(status, body, headers = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      forEach(callback) {
        for (const [key, value] of Object.entries(headers)) callback(value, key);
      }
    }
  };
}

function report(bureau) {
  return { bureau, creditFiles: [], tradelines: [], scores: [] };
}

test("CRS client: missing configuration fails before transport", async () => {
  let called = false;
  const config = crsConfigFromEnv({});
  assert.deepEqual(config.missing, [
    "CRS_API_USERNAME",
    "CRS_API_PASSWORD",
    "CRS_API_HOST"
  ]);

  const client = createCrsClient({
    env: {},
    fetchImpl: async () => {
      called = true;
      return response(200, {});
    }
  });
  await assert.rejects(client.login(), (error) => error.code === "not_configured");
  assert.equal(called, false);
});

const OFFERSIQ_ID = "550e8400-e29b-41d4-a716-446655440000";
const OFFERSIQ_IDENTITY = Object.freeze({
  fname: "YXHVVO", lname: "IMAEIF", streetName: "SYMFO", city: "HUNTSVILLE", state: "AL", zip: "35692"
});
const OFFERSIQ_CONSENT = Object.freeze({ accepted: true, termsUrl: "https://fundhub.ai/credit-consent" });

test("CRS client: OffersIQ uses existing login and sends only the documented minimal fields", async () => {
  const calls = [];
  const client = createCrsClient({ env: LIVE_ENV, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/users/login")) return response(200, { token: "unit-offersiq-token", expires: 3600000 });
    return response(200, { ruleSetId: "752", decisionStatus: "APPROVED", overallDecision: true }, { RequestID: OFFERSIQ_ID });
  } });
  const result = await client.evaluateOffersIq({ ruleSetId: 752,
    identity: { ...OFFERSIQ_IDENTITY, ssn: "not-sent", dob: "not-sent" }, consent: OFFERSIQ_CONSENT });
  assert.equal(result.ok, true);
  assert.equal(result.decision.outcome, "matched");
  assert.equal(result.requestId, OFFERSIQ_ID);
  assert.deepEqual(calls.map(c => new URL(c.url).pathname), ["/api/users/login", "/api/offersiq/evaluate"]);
  assert.equal(calls[1].init.headers.Authorization, "Bearer unit-offersiq-token");
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    ruleSetId: 752, consumerData: OFFERSIQ_IDENTITY, userConsent: OFFERSIQ_CONSENT
  });
});

test("CRS client: OffersIQ refuses wrong sandbox identity and consent before login", async () => {
  let calls = 0;
  const client = createCrsClient({ env: LIVE_ENV, fetchImpl: async () => { calls++; return response(200, {}); } });
  await assert.rejects(client.evaluateOffersIq({ ruleSetId: 752,
    identity: { ...OFFERSIQ_IDENTITY, fname: "Real" }, consent: OFFERSIQ_CONSENT }),
  e => e.code === "identity_not_allowed_on_sandbox");
  await assert.rejects(client.evaluateOffersIq({ ruleSetId: 752,
    identity: OFFERSIQ_IDENTITY, consent: { ...OFFERSIQ_CONSENT, accepted: false } }),
  e => e.code === "consent_required");
  assert.equal(calls, 0);
});

test("CRS client: production refuses a sandbox fixture with optional phone before login", async () => {
  let calls = 0;
  const client = createCrsClient({
    env: { ...LIVE_ENV, CRS_API_HOST: CRS_PRODUCTION_HOST, CRS_ALLOW_LIVE: "1" },
    fetchImpl: async () => { calls++; return response(200, {}); }
  });
  await assert.rejects(client.evaluateOffersIq({ ruleSetId: 752,
    identity: { ...OFFERSIQ_IDENTITY, phone: "6025550123" }, consent: OFFERSIQ_CONSENT }),
  e => e.code === "test_identity_on_production");
  await assert.rejects(client.evaluateOffersIq({ ruleSetId: 752,
    identity: { firstName: "PAMQLOH", lastName: "ADJNXZ", address: {
      line1: "791 GIGUZQTTQSA PNES", city: "BIRMINGHAM", state: "AL", zip: "35107"
    } }, consent: OFFERSIQ_CONSENT }),
  e => e.code === "test_identity_on_production");
  assert.equal(calls, 0);
});

test("CRS client: OffersIQ does not retry a 503 and reports no-hit as review", async () => {
  let evaluations = 0;
  const client = createCrsClient({ env: LIVE_ENV, fetchImpl: async url => {
    if (url.endsWith("/users/login")) return response(200, { token: "unit-token", expires: 3600000 });
    evaluations++;
    return response(503, { codes: ["CRS100"], messages: ["Unavailable"] }, { RequestID: OFFERSIQ_ID });
  } });
  const failed = await client.evaluateOffersIq({ ruleSetId: 752, identity: OFFERSIQ_IDENTITY, consent: OFFERSIQ_CONSENT });
  assert.equal(failed.ok, false);
  assert.equal(failed.status, 503);
  assert.equal(evaluations, 1);

  const noHit = createCrsClient({ env: LIVE_ENV, fetchImpl: async url =>
    url.endsWith("/users/login") ? response(200, { token: "unit-token", expires: 3600000 }) :
      response(200, { ruleSetId: "752", decisionStatus: "INSUFFICIENT_DATA", overallDecision: false }, { RequestID: OFFERSIQ_ID })
  });
  const reviewed = await noHit.evaluateOffersIq({ ruleSetId: 752, identity: OFFERSIQ_IDENTITY, consent: OFFERSIQ_CONSENT });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.decision.outcome, "needs_review");
});

test("CRS client: OffersIQ token lifetime caps millisecond expiry; re-evaluation sends no body", async () => {
  let now = 0;
  let logins = 0;
  const calls = [];
  const client = createCrsClient({ env: LIVE_ENV, now: () => now, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/users/login")) {
      logins++;
      return response(200, { token: `unit-token-${logins}`, expires: 3600000 });
    }
    return response(200, { ruleSetId: "752", decisionStatus: "DECLINED", overallDecision: false }, { RequestID: OFFERSIQ_ID });
  } });
  const first = await client.reevaluateOffersIq({ requestId: OFFERSIQ_ID });
  assert.equal(first.decision.outcome, "not_matched");
  assert.equal(logins, 1);
  assert.equal(calls[1].init.body, undefined);
  now = 3_600_001;
  await client.reevaluateOffersIq({ requestId: OFFERSIQ_ID });
  assert.equal(logins, 2);
  await assert.rejects(client.reevaluateOffersIq({ requestId: "bad" }), e => e.code === "request_id_invalid");
});

test("CRS client: production host without CRS_ALLOW_LIVE is refused before login", async () => {
  let called = false;
  const client = createCrsClient({
    env: { ...LIVE_ENV, CRS_API_HOST: CRS_PRODUCTION_HOST },
    fetchImpl: async () => {
      called = true;
      return response(200, {});
    }
  });
  await assert.rejects(client.login(), (error) => error.code === "production_host_refused");
  assert.equal(called, false);
});

test("CRS client: unknown hosts are refused before login", async () => {
  let called = false;
  const client = createCrsClient({
    env: { ...LIVE_ENV, CRS_API_HOST: "unknown.example" },
    fetchImpl: async () => {
      called = true;
      return response(200, {});
    }
  });
  await assert.rejects(client.login(), (error) => error.code === "unknown_host");
  assert.equal(called, false);
});

test("CRS client: production host + CRS_ALLOW_LIVE on reaches login", async () => {
  const calls = [];
  const client = createCrsClient({
    env: {
      ...LIVE_ENV,
      CRS_API_HOST: CRS_PRODUCTION_HOST,
      CRS_ALLOW_LIVE: "1"
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response(200, {
        token: "unit-bearer-prod",
        refreshToken: "unit-refresh-prod",
        expires: 3600
      });
    }
  });
  assert.equal(await client.getToken(), "unit-bearer-prod");
  assert.equal(calls[0].url, `https://${CRS_PRODUCTION_HOST}/api/users/login`);
});

test("CRS client: a wrong sandbox identity is refused before login", async () => {
  let called = false;
  const identity = JSON.parse(JSON.stringify(SANDBOX_TEST_IDENTITIES.TU));
  identity.firstName = "WRONG";
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async () => {
      called = true;
      return response(200, {});
    }
  });

  await assert.rejects(
    client.orderPrequal({ bureau: "TU", identity }),
    (error) => error.code === "identity_not_allowed_on_sandbox"
  );
  assert.equal(called, false);
});

test("CRS client: login, Bearer reuse, all order/retrieve paths and RequestID", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/api/users/login")) {
      return response(200, {
        token: "unit-bearer-one",
        refreshToken: "unit-refresh-one",
        expires: 3600
      });
    }
    const bureau = BUREAUS.find((code) => url.includes(CRS_PRODUCTS[code].order));
    return response(200, report(bureau), { RequestID: `request-${bureau}` });
  };
  const client = createCrsClient({ env: LIVE_ENV, fetchImpl, now: () => 0 });

  const ordered = [];
  for (const bureau of BUREAUS) {
    ordered.push(await client.orderPrequal({
      bureau,
      identity: SANDBOX_TEST_IDENTITIES[bureau]
    }));
  }
  for (const bureau of BUREAUS) {
    await client.retrievePrequal({
      bureau,
      requestId: `retrieve ${bureau}/1`,
      identity: SANDBOX_TEST_IDENTITIES[bureau]
    });
  }

  assert.equal(calls.filter((call) => call.url.endsWith("/api/users/login")).length, 1);
  const login = calls[0];
  assert.equal(login.url, `https://${CRS_SANDBOX_HOST}/api/users/login`);
  assert.deepEqual(JSON.parse(login.init.body), {
    username: USERNAME,
    password: PASSWORD
  });
  assert.equal(login.init.headers.Authorization, undefined);

  for (const bureau of BUREAUS) {
    const orderUrl = `https://${CRS_SANDBOX_HOST}/api${CRS_PRODUCTS[bureau].order}`;
    const order = calls.find((call) => call.url === orderUrl);
    assert.ok(order, `missing ${bureau} order`);
    assert.deepEqual(JSON.parse(order.init.body), SANDBOX_TEST_IDENTITIES[bureau]);
    assert.equal(order.init.headers.Authorization, "Bearer unit-bearer-one");
    assert.equal(
      ordered.find((result) => result.bureau === bureau).requestId,
      `request-${bureau}`
    );

    const retrievePath = CRS_PRODUCTS[bureau].retrieve(`retrieve ${bureau}/1`);
    const retrieve = calls.find((call) =>
      call.url === `https://${CRS_SANDBOX_HOST}/api${retrievePath}`);
    assert.ok(retrieve, `missing ${bureau} retrieve`);
    assert.equal(retrieve.init.headers.Authorization, "Bearer unit-bearer-one");
    assert.deepEqual(JSON.parse(retrieve.init.body), SANDBOX_TEST_IDENTITIES[bureau]);
  }
});

test("CRS client: an expired token refreshes and the new Bearer is reused", async () => {
  let now = 0;
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/users/login")) {
      return response(200, {
        token: "unit-bearer-old",
        refreshToken: "unit-refresh",
        expires: 120
      });
    }
    if (url.endsWith("/users/refresh-token")) {
      return response(200, {
        token: "unit-bearer-new",
        refreshToken: "unit-refresh-new",
        expires: 120
      });
    }
    return response(200, report("TU"));
  };
  const client = createCrsClient({ env: LIVE_ENV, fetchImpl, now: () => now });

  assert.equal(await client.getToken(), "unit-bearer-old");
  now = 61_000;
  assert.equal(await client.getToken(), "unit-bearer-new");
  assert.equal(await client.getToken(), "unit-bearer-new");

  assert.deepEqual(JSON.parse(calls[1].init.body), { refreshToken: "unit-refresh" });
  assert.equal(calls.filter((call) => call.url.endsWith("/users/login")).length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith("/users/refresh-token")).length, 1);
});

test("CRS client: malformed login and order responses fail safely", async () => {
  const badLogin = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async () => response(200, "not-json")
  });
  await assert.rejects(badLogin.login(), (error) =>
    error.code === "login_failed" && !error.message.includes(PASSWORD));

  let count = 0;
  const badOrder = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async () => {
      count++;
      if (count === 1) {
        return response(200, {
          token: "unit-bearer",
          refreshToken: "unit-refresh",
          expires: 3600
        });
      }
      return response(200, "not-json");
    }
  });
  const result = await badOrder.orderPrequal({
    bureau: "TU",
    identity: SANDBOX_TEST_IDENTITIES.TU
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /neither a report nor a RequestID/);
});

test("CRS client: non-2xx errors redact password, token and SSN", async () => {
  let count = 0;
  const token = "unit-bearer-sensitive";
  const ssn = SANDBOX_TEST_IDENTITIES.EQ.ssn;
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async () => {
      count++;
      if (count === 1) {
        return response(200, {
          token,
          refreshToken: "unit-refresh-sensitive",
          expires: 3600
        });
      }
      return response(422, {
        messages: [`password=${PASSWORD} Bearer ${token} SSN ${ssn}`],
        codes: ["BAD_REQUEST"]
      });
    }
  });
  const result = await client.orderPrequal({
    bureau: "EQ",
    identity: SANDBOX_TEST_IDENTITIES.EQ
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 422);
  assert.doesNotMatch(result.error, /unit-password|unit-bearer-sensitive|666154480/);
  assert.match(result.error, /redacted/);
});

test("CRS client: a company search with no match does not order a report", async () => {
  const urls = [];
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.endsWith("/api/users/login")) {
        return response(200, { token: "unit-bearer-biz", refreshToken: "r", expires: 3600 });
      }
      if (url.endsWith("/ccc/exp/search")) return response(200, { results: [] });
      return response(500, { messages: ["should not order"] });
    }
  });
  const out = await client.orderBusinessReport({ name: "Acme LLC", state: "ca" });
  assert.equal(out.ok, false);
  assert.equal(out.error, "no business match");
  assert.equal(urls.some((url) => url.endsWith("/ccc/exp/report")), false);
});

test("CRS client: a company match orders that business report", async () => {
  const bodies = [];
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/users/login")) {
        return response(200, { token: "unit-bearer-biz", refreshToken: "r", expires: 3600 });
      }
      bodies.push({ url, body: JSON.parse(init.body) });
      if (url.endsWith("/ccc/exp/search")) return response(200, { results: [{ bin: "BIN9" }] });
      if (url.endsWith("/ccc/exp/report")) {
        return response(200, { data: { businessHeader: { bin: "BIN9" } } });
      }
      return response(404, {});
    }
  });
  const out = await client.orderBusinessReport({ name: "Acme LLC", state: "CA" });
  assert.equal(out.ok, true);
  assert.equal(out.bin, "BIN9");
  assert.equal(out.report.data.businessHeader.bin, "BIN9");
  assert.deepEqual(bodies[0].body, { name: "Acme LLC", state: "CA" });
  assert.deepEqual(bodies[1].body, { bin: "BIN9" });
});

test("CRS client: LNR search returns explicit selectable business matches", async () => {
  const bodies = [];
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/users/login")) return response(200, { token: "unit-lnr", refreshToken: "r", expires: 3600 });
      bodies.push({ url, body: JSON.parse(init.body) });
      return response(200, { results: [{ seleId: 10, orgId: 11, ultId: 12, companyName: "Acme LLC", city: "Phoenix", state: "az" }] });
    }
  });
  const out = await client.searchTopBusiness({ companyName: "Acme LLC", city: "Phoenix", state: "az" });
  assert.equal(out.ok, true);
  assert.deepEqual(out.matches, [{ seleID: 10, orgID: 11, ultID: 12, companyName: "Acme LLC", streetAddress: "", city: "Phoenix", state: "AZ", zipCode: "" }]);
  assert.match(bodies[0].url, /top-business-search\/top-business-search$/);
  assert.deepEqual(bodies[0].body, { companyName: "Acme LLC", streetAddress: "", city: "Phoenix", state: "AZ", zipCode: "" });
});

test("CRS client: LNR report uses only the selected business ids", async () => {
  let reportBody = null;
  const client = createCrsClient({
    env: LIVE_ENV,
    fetchImpl: async (url, init) => {
      if (url.endsWith("/api/users/login")) return response(200, { token: "unit-lnr", refreshToken: "r", expires: 3600 });
      reportBody = JSON.parse(init.body);
      return response(200, { comprehensive: true });
    }
  });
  const out = await client.pullTopBusinessReport({ seleID: 10, orgID: 11, ultID: 12 });
  assert.equal(out.ok, true);
  assert.deepEqual(out.report, { comprehensive: true });
  assert.deepEqual(reportBody, { seleID: 10, orgID: 11, ultID: 12 });
});
