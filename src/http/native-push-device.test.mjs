import assert from "node:assert/strict";
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

test("non-sales staff cannot register a work-alert device", async () => {
  const { res, fake } = await callShared(nativeDevice, req("POST", {
    body: { installation_id: INSTALLATION, token: "ab".repeat(32), environment: "development" }
  }), [staffSession({ role: "csm" })]);
  assert.equal(res.statusCode, 403);
  assert.equal(fake.find(/apns_devices/).length, 0);
});
