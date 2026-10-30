import assert from "node:assert/strict";
import { test } from "node:test";
import nativeActivity from "../../api/native/client-activity.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { accountSession, req, staffSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER = "c2000000-0000-4000-8000-000000000002";
const INSTALLATION = "ec3e5ae7-c131-4a84-bc35-c5ef8b3f7f1d";
const signedIn = () => accountSession({ kind: "client", clientId: CLIENT });
const body = { platform: "ios", event_type: "native_authenticated_open", installation_id: INSTALLATION, client_id: OTHER };

test("native first-open requires client session and writes only the resolved client", async () => {
  const { res, fake } = await callShared(nativeActivity, req("POST", { body }), [
    ...signedIn(),
    [/INSERT INTO native_client_app_opens/, [{ first_authenticated_at: "2026-10-30T00:00:00Z" }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.native_authenticated, true);
  const [write] = fake.find(/INSERT INTO native_client_app_opens/);
  assert.equal(write.params[0], ORG_ID);
  assert.equal(write.params[1], CLIENT);
  assert.equal(write.params[3], INSTALLATION);
  assert.ok(!write.params.includes(OTHER));
  assert.match(write.sql, /ON CONFLICT.*uq_native_client_app_opens_client_device/s);
  assert.match(write.sql, /last_authenticated_at = now\(\)/);
  assert.match(write.sql, /RETURNING first_authenticated_at/);
});

test("staff sessions cannot register a native client app open", async () => {
  const { res, fake } = await callShared(nativeActivity, req("POST", { body }), [staffSession()]);
  assert.equal(res.statusCode, 403);
  assert.equal(fake.find(/native_client_app_opens/).length, 0);
});

test("invalid native reports and marketing clicks never create first-open proof", async () => {
  for (const input of [
    { platform: "ios", event_type: "download_link_clicked", installation_id: INSTALLATION },
    { platform: "web", event_type: "native_authenticated_open", installation_id: INSTALLATION },
    { platform: "ios", event_type: "native_authenticated_open", installation_id: "not-a-uuid" }
  ]) {
    const { res, fake } = await callShared(nativeActivity, req("POST", { body: input }), signedIn());
    assert.equal(res.statusCode, 400);
    assert.equal(fake.find(/native_client_app_opens/).length, 0);
  }
});

test("native receipt endpoint is POST only", async () => {
  const { res, fake } = await callShared(nativeActivity, req("GET", { query: { client_id: CLIENT } }), signedIn());
  assert.equal(res.statusCode, 405);
  assert.equal(fake.find(/native_client_app_opens/).length, 0);
});
