import test from "node:test";
import assert from "node:assert/strict";
import { requestCrsProperty } from "./crs-property.mjs";
import { buildPropertyRequest, propertyRequestFingerprint } from "../../finance/crs-property-contract.mjs";
const body = buildPropertyRequest({ firstName: "Synthetic", lastName: "Fixture", ssn: "666123456", birthDate: "1990-01-02" });
const env = { CRS_PROPERTY_SANDBOX_IDENTITY_SHA256: propertyRequestFingerprint(body), ADAPTERS_DRY_RUN: "off", CRS_PROPERTY_ALLOW_LIVE: "on" };
test("property provider confines exact sandbox fixture and production host independently", async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => { calls++; assert.equal(url, "https://api-sandbox.stitchcredit.com/api/pp/foreclosure/data");
    assert.equal(init.method, "POST"); return { ok: true, status: 200, text: async () => "{}", headers: { forEach() {} } }; };
  assert.equal((await requestCrsProperty({ host: "api-sandbox.stitchcredit.com", body, token: "synthetic-token", env, fetchImpl })).ok, true);
  assert.equal(calls, 1);
  for (const args of [{ host: "evil.example" }, { host: "mware.crscreditapi.com" },
    { host: "api-sandbox.stitchcredit.com", body: buildPropertyRequest({ firstName: "Different", lastName: "Person", ssn: "666123457", birthDate: "1990-01-02" }) },
    { host: "api-sandbox.stitchcredit.com", env: { ...env, CRS_PROPERTY_SANDBOX_IDENTITY_SHA256: "" } },
    { host: "api-sandbox.stitchcredit.com", env: { ...env, ADAPTERS_DRY_RUN: "on" } }]) {
    assert.equal((await requestCrsProperty({ body, token: "synthetic-token", env, fetchImpl, ...args })).blocked, true);
  }
  assert.equal(calls, 1);
});
test("production property request needs separate live flag and rejects fixture", async () => {
  let calls = 0;
  const realBody = buildPropertyRequest({ firstName: "Synthetic", lastName: "Other", ssn: "123456789", birthDate: "1990-01-02" });
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, text: async () => "{}", headers: { forEach() {} } }; };
  assert.equal((await requestCrsProperty({ host: "mware.crscreditapi.com", body: realBody, token: "synthetic-token", env: { ...env, CRS_PROPERTY_ALLOW_LIVE: "off" }, fetchImpl })).blocked, true);
  assert.equal(calls, 0);
  assert.equal((await requestCrsProperty({ host: "mware.crscreditapi.com", body: realBody, token: "synthetic-token", env, fetchImpl })).ok, true);
  assert.equal(calls, 1);
});
