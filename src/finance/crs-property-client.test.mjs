import test from "node:test";
import assert from "node:assert/strict";
import { createCrsPropertyClient, propertyConfigFromEnv } from "./crs-property-client.mjs";
import { buildPropertyRequest, propertyRequestFingerprint } from "./crs-property-contract.mjs";
const identity = { firstName: "Synthetic", lastName: "Fixture", ssn: "666123456", birthDate: "1990-01-02" };
const env = { CRS_PROPERTY_API_HOST: "api-sandbox.stitchcredit.com", CRS_PROPERTY_API_USERNAME: "unit-user",
  CRS_PROPERTY_API_PASSWORD: "unit-password", CRS_PROPERTY_SANDBOX_IDENTITY_SHA256: propertyRequestFingerprint(buildPropertyRequest(identity)), ADAPTERS_DRY_RUN: "off" };
const response = (status, body, headers = {}) => ({ ok: status < 400, status, text: async () => JSON.stringify(body), headers: { forEach(fn) { for (const [k, v] of Object.entries(headers)) fn(v, k); } } });
test("property config never borrows ordinary CRS or OffersIQ credentials", () => {
  assert.equal(propertyConfigFromEnv({ CRS_API_HOST: "mware.crscreditapi.com", CRS_API_USERNAME: "existing", CRS_API_PASSWORD: "existing" }).configured, false);
  assert.equal(propertyConfigFromEnv(env).configured, true);
});
test("property client logs in once and never retries an uncertain order", async () => {
  const calls = [];
  const client = createCrsPropertyClient({ env, fetchImpl: async (url, init) => {
    calls.push(url);
    if (url.endsWith("/users/login")) return response(200, { token: "unit-token", expires: 3600 });
    assert.equal(init.headers.Authorization, "Bearer unit-token");
    throw new Error("synthetic timeout with 666123456 and unit-password");
  } });
  const result = await client.order({ identity });
  assert.equal(result.ok, false);
  assert.equal(result.uncertain, true);
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result), /666123456|unit-password/);
});
test("property rejects foreign sandbox identity before login", async () => {
  let calls = 0;
  const client = createCrsPropertyClient({ env, fetchImpl: async () => { calls++; } });
  await assert.rejects(client.order({ identity: { ...identity, lastName: "Other" } }), /property_identity_refused/);
  assert.equal(calls, 0);
});
test("a malformed or secret-shaped RequestID error header is discarded", async () => {
  for (const requestId of ["not-a-provider-uuid", "unit-password:666123456", "-".repeat(36)]) {
    const client = createCrsPropertyClient({ env, fetchImpl: async url => url.endsWith("/users/login")
      ? response(200, { token: "unit-token", expires: 3600 }) : response(503, {}, { requestid: requestId }) });
    const result = await client.order({ identity });
    assert.equal(result.requestId, null);
    assert.doesNotMatch(JSON.stringify(result), /unit-password|666123456|not-a-provider-uuid/);
  }
});
test("valid uppercase RequestID is canonical on both receipt and normalized report", async () => {
  const requestId = "ABCDEFAB-1234-4ABC-8ABC-ABCDEFABCDEF";
  const body = { ForeclosureInvestigationReport: { Input: { Name: { FirstName: identity.firstName, LastName: identity.lastName }, SSN: Number(identity.ssn) },
    Results: { Summary: { BorrowerRelatedAddressCount: 0, BorrowerOwnedPropertiesIdentified: 0, BorrowerRelatedForeclosureActivityEvents: 0 } } } };
  const client = createCrsPropertyClient({ env, fetchImpl: async url => url.endsWith("/users/login")
    ? response(200, { token: "unit-token", expires: 3600 }) : response(200, body, { RequestID: requestId }) });
  const result = await client.order({ identity });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, requestId.toLowerCase());
  assert.equal(result.report.providerRequestId, requestId.toLowerCase());
});
