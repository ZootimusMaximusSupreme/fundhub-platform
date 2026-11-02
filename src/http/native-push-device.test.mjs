import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";

import nativeDevice from "../../api/push/native-device.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { accountSession, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER = "c2000000-0000-4000-8000-000000000002";
const INSTALLATION = "ec3e5ae7-c131-4a84-bc35-c5ef8b3f7f1d";
const SESSION = "5e000000-0000-4000-8000-000000000002";
const signedIn = () => accountSession({ kind: "client", clientId: CLIENT });

test("native push status checks only this client's active session and installation", async () => {
  const { res, fake } = await callShared(nativeDevice, req("GET", {
    query: { installation_id: INSTALLATION, client_id: OTHER }
  }), [
    ...signedIn(),
    [/SELECT count\(\*\)::int AS count FROM client_apns_devices/, [{ count: 1 }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.registered, true);
  const [read] = fake.find(/SELECT count\(\*\)::int AS count FROM client_apns_devices/);
  assert.deepEqual(read.params, [ORG_ID, CLIENT, INSTALLATION, SESSION]);
});

test("native push revocation ignores a caller-chosen client", async () => {
  const { res, fake } = await callShared(nativeDevice, req("DELETE", {
    body: { installation_id: INSTALLATION, client_id: OTHER }
  }), [
    ...signedIn(),
    [/UPDATE client_apns_devices SET revoked_at/, [{ id: "d1000000-0000-4000-8000-000000000001" }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.revoked, true);
  const [write] = fake.find(/UPDATE client_apns_devices SET revoked_at/);
  assert.deepEqual(write.params, [ORG_ID, CLIENT, INSTALLATION]);
});

test("staff status checks only the signed-in staff session and never a client device", async () => {
  const { res, fake } = await callShared(nativeDevice, req("GET", {
    query: { installation_id: INSTALLATION, staff_id: OTHER, client_id: CLIENT }
  }), [staffSession(), [/SELECT count\(\*\)::int AS count FROM staff_apns_devices/, [{ count: 1 }]]]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.registered, true);
  const [read] = fake.find(/SELECT count\(\*\)::int AS count FROM staff_apns_devices/);
  assert.deepEqual(read.params, [ORG_ID, STAFF_ID, INSTALLATION, "5e000000-0000-4000-8000-000000000001"]);
  assert.equal(fake.find(/client_apns_devices/).length, 0);
});

test("staff revocation ignores a caller-chosen staff or client ID", async () => {
  const { res, fake } = await callShared(nativeDevice, req("DELETE", {
    body: { installation_id: INSTALLATION, staff_id: OTHER, client_id: CLIENT }
  }), [staffSession(), [/UPDATE staff_apns_devices SET revoked_at/, [{ id: "d1000000-0000-4000-8000-000000000001" }]]]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.revoked, true);
  const [write] = fake.find(/UPDATE staff_apns_devices SET revoked_at/);
  assert.deepEqual(write.params, [ORG_ID, STAFF_ID, INSTALLATION]);
  assert.equal(fake.find(/client_apns_devices/).length, 0);
});

test("unknown staff jobs cannot register a work-alert device", async () => {
  const { res, fake } = await callShared(nativeDevice, req("POST", {
    body: { installation_id: INSTALLATION, token: "ab".repeat(32), environment: "development" }
  }), [staffSession({ role: "unknown_job" })]);
  assert.equal(res.statusCode, 403);
  assert.equal(fake.find(/apns_devices/).length, 0);
});


test("every supported primary role reads only its own work-alert device", async () => {
  for (const role of ["owner", "admin", "setter", "closer", "sales_manager",
    "funding_advisor", "inquiry_specialist", "csm", "outbound_rep"]) {
    const request = req("GET", { query: { installation_id: INSTALLATION, staff_id: OTHER } });
    request.url = "/api/push/native-device";
    const { res, fake } = await callShared(nativeDevice, request,
      [staffSession({ role }), [/SELECT count\(\*\)::int AS count FROM staff_apns_devices/, [{ count: 1 }]]]);
    assert.equal(res.statusCode, 200, role);
    const [read] = fake.find(/SELECT count\(\*\)::int AS count FROM staff_apns_devices/);
    assert.equal(read.params[1], STAFF_ID, role);
    assert.equal(fake.find(/client_apns_devices/).length, 0, role);
  }
});


const DEVICE_ROLES = ["owner", "admin", "sales_manager", "setter", "closer", "outbound_rep",
  "inquiry_specialist", "funding_advisor", "csm"];

test("all nine primary roles revoke only their own installation, ignoring forged owners", async () => {
  for (const role of DEVICE_ROLES) {
    const request = req("DELETE", { body: { installation_id: INSTALLATION, staff_id: OTHER,
      client_id: CLIENT, org_id: OTHER, session_id: OTHER } });
    request.url = "/api/push/native-device";
    const { res, fake } = await callShared(nativeDevice, request,
      [staffSession({ role }), [/UPDATE staff_apns_devices SET revoked_at/, []]]);
    assert.equal(res.statusCode, 200, role);
    assert.deepEqual(fake.find(/UPDATE staff_apns_devices SET revoked_at/)[0].params,
      [ORG_ID, STAFF_ID, INSTALLATION], role);
    assert.equal(fake.find(/client_apns_devices/).length, 0, role);
  }
});

test("all nine primary roles register to the bearer identity and encrypt the token", async () => {
  const privateKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
  const env = { PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64"),
    APNS_KEY_ID: "TESTKEY001", APNS_TEAM_ID: "TESTTEAM01",
    APNS_PRIVATE_KEY_BASE64: Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64") };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    for (const role of DEVICE_ROLES) {
      const token = "ab".repeat(32);
      const request = req("POST", { body: { installation_id: INSTALLATION, token,
        environment: "development", staff_id: OTHER, client_id: CLIENT, org_id: OTHER, session_id: OTHER } });
      request.url = "/api/push/native-device";
      const { res, fake } = await callShared(nativeDevice, request, [staffSession({ role })]);
      assert.equal(res.statusCode, 201, role);
      const [insert] = fake.find(/INSERT INTO staff_apns_devices/);
      assert.deepEqual(insert.params.slice(1, 5), [ORG_ID, STAFF_ID,
        "5e000000-0000-4000-8000-000000000001", INSTALLATION], role);
      assert.notEqual(insert.params[6], token, role);
      assert.equal(JSON.stringify(res.body).includes(token), false, role);
      assert.equal(fake.find(/INSERT INTO client_apns_devices/).length, 0, role);
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("unsupported or absent primary roles cannot borrow an assigned job for device access", async () => {
  for (const role of ["unknown_job", "", null]) for (const method of ["GET", "POST", "DELETE"]) {
    const request = req(method, { query: { installation_id: INSTALLATION },
      body: { installation_id: INSTALLATION, staff_id: OTHER, role: "owner", roles: ["owner"] } });
    request.url = "/api/push/native-device";
    const { res, fake } = await callShared(nativeDevice, request,
      [staffSession({ role, roles: ["setter"] })]);
    assert.equal(res.statusCode, 403, `${role}/${method}`);
    assert.equal(fake.find(/apns_devices/).length, 0);
  }
});
