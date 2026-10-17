import assert from "node:assert/strict";
import { test } from "node:test";

import preferences from "../../api/push/preferences.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { accountSession, req, staffSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER = "c2000000-0000-4000-8000-000000000002";
const signedIn = () => accountSession({ kind: "client", clientId: CLIENT });

test("marketing push defaults off and reads only the signed-in client", async () => {
  const { res, fake } = await callShared(preferences, req("GET", {
    query: { client_id: OTHER }
  }), [
    ...signedIn(),
    [/SELECT custom_fields -> 'marketing_push_enabled'/, [{ marketing_push_enabled: null }]]
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, marketing_push_enabled: false });
  const [read] = fake.find(/SELECT custom_fields -> 'marketing_push_enabled'/);
  assert.deepEqual(read.params, [ORG_ID, CLIENT]);
});

test("a saved JSON boolean true reads on; a string true remains off", async () => {
  for (const [stored, expected] of [[true, true], ["true", false]]) {
    const { res } = await callShared(preferences, req("GET"), [
      ...signedIn(),
      [/SELECT custom_fields -> 'marketing_push_enabled'/, [{ marketing_push_enabled: stored }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.marketing_push_enabled, expected);
  }
});

test("client may turn marketing push on or off for their own file only", async () => {
  for (const enabled of [true, false]) {
    const { res, fake } = await callShared(preferences, req("PUT", {
      body: { marketing_push_enabled: enabled, client_id: OTHER, org_id: OTHER }
    }), [
      ...signedIn(),
      [/UPDATE clients\s+SET custom_fields = jsonb_set/, [{ marketing_push_enabled: enabled }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, marketing_push_enabled: enabled });
    const [write] = fake.find(/UPDATE clients\s+SET custom_fields = jsonb_set/);
    assert.deepEqual(write.params, [ORG_ID, CLIENT, enabled]);
    assert.match(write.sql, /WHERE org_id = \$1 AND id = \$2/);
  }
});

test("marketing push requires a boolean and never writes a caller-chosen value", async () => {
  for (const bad of [undefined, "true", 1, null]) {
    const { res, fake } = await callShared(preferences, req("PUT", {
      body: { marketing_push_enabled: bad }
    }), signedIn());
    assert.equal(res.statusCode, 400);
    assert.equal(fake.find(/UPDATE clients/).length, 0);
  }
});

test("staff cannot read or change a client's marketing push choice", async () => {
  for (const method of ["GET", "PUT"]) {
    const { res, fake } = await callShared(preferences, req(method, {
      query: { client_id: CLIENT }, body: { client_id: CLIENT, marketing_push_enabled: true }
    }), [staffSession()]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/custom_fields/).length, 0);
  }
});

test("marketing push preference route allows GET and PUT only", async () => {
  const { res, fake } = await callShared(preferences, req("POST", {
    body: { marketing_push_enabled: true }
  }), []);
  assert.equal(res.statusCode, 405);
  assert.equal(fake.find(/custom_fields/).length, 0);
});
