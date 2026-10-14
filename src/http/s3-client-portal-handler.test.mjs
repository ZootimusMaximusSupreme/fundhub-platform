// Slice S3 proofs: what a signed-in client, or a person holding a signed mail
// link, can do to their own file. The real api/ handlers run against a
// stand-in database; every statement is checked for the client it is bound to.
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import subscribeHandler from "../../api/push/subscribe.mjs";
import unsubscribeHandler from "../../api/push/unsubscribe.mjs";
import mailUnsubscribeHandler from "../../api/public/unsubscribe.mjs";
import tickHandler from "../../api/waypoint-tick.mjs";
import clickHandler from "../../api/public/affiliate-click.mjs";
import { signature } from "../messaging/unsubscribe.mjs";
import { _resetOrgCache } from "../auth/org.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules } from "../testing/s3-scoped-rows.mjs";
import { req, accountSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const clientLogin = () => accountSession({ kind: "client", clientId: CLIENT });

function withEnv(values) {
  const saved = {};
  for (const [k, v] of Object.entries(values)) { saved[k] = process.env[k]; process.env[k] = v; }
  return () => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
}

describe("web push on the client portal", () => {
  let restore;
  beforeEach(() => { restore = withEnv({ PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64") }); });
  afterEach(() => restore());

  const subscription = () => ({
    endpoint: "https://push.example.test/send/abc123",
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), crypto.randomBytes(64)]).toString("base64url"),
      auth: crypto.randomBytes(16).toString("base64url")
    }
  });
  const listRows = [[/FROM client_push_subscriptions\s+WHERE org_id = \$1 AND client_id = \$2/, [{ id: "d1", device_label: "iphone", created_at: "2026-10-01T00:00:00.000Z", last_success_at: null, failure_count: 0 }]]];

  test("GET says how many devices are on, with no key material in the answer", async () => {
    const { res, fake } = await callShared(subscribeHandler, req("GET"), [...clientLogin(), ...listRows]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, count: 1, devices: [{ id: "d1", device_label: "iphone", created_at: "2026-10-01T00:00:00.000Z", last_success_at: null, failure_count: 0 }] });
    assert.deepEqual(fake.find(/FROM client_push_subscriptions/)[0].params, [ORG_ID, CLIENT]);
  });

  test("POST registers a new device encrypted at rest and answers 201 with the new count", async () => {
    const sub = subscription();
    const { res, fake } = await callShared(subscribeHandler, req("POST", { body: { subscription: sub, device_label: "iPhone" } }), [
      ...clientLogin(), [/SELECT id, client_id FROM client_push_subscriptions/, []], ...listRows
    ]);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.created, true);
    assert.equal(res.body.count, 1);
    const [ins] = fake.find(/INSERT INTO client_push_subscriptions/);
    assert.equal(ins.params[1], ORG_ID);
    assert.equal(ins.params[2], CLIENT);
    assert.equal(ins.params[4], crypto.createHash("sha256").update(sub.endpoint).digest("hex"));
    for (const stored of ins.params.slice(5, 8)) {
      assert.match(stored, /^v1:/);
      assert.ok(!stored.includes(sub.endpoint) && !stored.includes(sub.keys.auth));
    }
    assert.equal(ins.params[8], "iphone");
  });

  test("the same device again refreshes its keys and answers 200, not a second row", async () => {
    const { res, fake } = await callShared(subscribeHandler, req("POST", { body: subscription() }), [
      ...clientLogin(), [/SELECT id, client_id FROM client_push_subscriptions/, [{ id: "d1", client_id: CLIENT }]], ...listRows
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, false);
    assert.equal(res.body.subscription_id, "d1");
    assert.equal(fake.find(/INSERT INTO client_push_subscriptions/).length, 0);
    assert.equal(fake.find(/UPDATE client_push_subscriptions\s+SET encrypted_endpoint/).length, 1);
  });

  test("a non-https endpoint is refused and nothing is stored", async () => {
    const bad = { ...subscription(), endpoint: "http://push.example.test/x" };
    const { res, fake } = await callShared(subscribeHandler, req("POST", { body: bad }), [...clientLogin()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_subscription");
    assert.equal(fake.find(/INSERT INTO client_push_subscriptions/).length, 0);
  });

  // Two devices of this client, and a device of another client in the same company
  // that carries the very same endpoint. The stand-in answers each statement by the
  // company, client and endpoint its SQL names, so a retire that lost its client
  // condition would switch the other client's phone off too.
  const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
  const PHONE = "https://push.example.test/send/abc123";
  const TABLET = "https://push.example.test/send/def456";
  const device = (over) => ({
    id: "d1", org_id: ORG_ID, client_id: CLIENT, endpoint_hash: sha(PHONE), device_label: "iphone",
    created_at: "2026-10-01T00:00:00.000Z", last_success_at: null, failure_count: 0, revoked_at: null, expired_at: null, ...over
  });
  const fleet = () => [
    device({ id: "d1" }),
    device({ id: "d2", endpoint_hash: sha(TABLET), device_label: "ipad" }),
    device({ id: "d3", client_id: OTHER_CLIENT })
  ];
  const retire = (row) => { row.revoked_at = "2026-10-13T12:00:00.000Z"; };
  const revokedIds = (rows) => rows.filter((r) => r.revoked_at).map((r) => r.id);
  const unsubscribe = (rows, body) => callShared(unsubscribeHandler, req("POST", { body }), [...clientLogin(), ...tableRules("client_push_subscriptions", rows, { set: retire })]);

  test("push unsubscribe retires one device by endpoint, only for this client, and reports what is left", async () => {
    const rows = fleet();
    const { res, fake } = await unsubscribe(rows, { endpoint: PHONE });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, retired: 1, count: 1 });
    assert.deepEqual(revokedIds(rows), ["d1"], "the tablet stays on and so does the other client's device with the same endpoint");
    const [upd] = fake.find(/UPDATE client_push_subscriptions\s+SET revoked_at/);
    assert.deepEqual(upd.params, [ORG_ID, CLIENT, sha(PHONE)]);
    assert.match(upd.sql, /SET revoked_at = now\(\)/);
    assert.match(upd.sql, /WHERE org_id = \$1 AND client_id = \$2 AND endpoint_hash = \$3/);
    assert.equal(fake.find(/DELETE FROM client_push_subscriptions/).length, 0, "retired, not deleted");
    const again = await unsubscribe(rows, { endpoint: PHONE });
    assert.deepEqual(again.res.body, { ok: true, retired: 0, count: 1 }, "an already-off device is a normal answer");
  });

  test("all:true retires every device of this client and no other client's; naming no device is a 400", async () => {
    const rows = fleet();
    const { res, fake } = await unsubscribe(rows, { all: true });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, retired: 2, count: 0 });
    const [upd] = fake.find(/UPDATE client_push_subscriptions/);
    assert.deepEqual(upd.params, [ORG_ID, CLIENT]);
    assert.match(upd.sql, /WHERE org_id = \$1 AND client_id = \$2\s+AND revoked_at IS NULL/);
    assert.deepEqual(revokedIds(rows), ["d1", "d2"]);
    assert.equal(rows[2].revoked_at, null, "another client's device is untouched");
    const none = await unsubscribe(fleet(), {});
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.fake.find(/UPDATE client_push_subscriptions/).length, 0);
  });

  test("another client's device cannot be switched off by naming its endpoint", async () => {
    const rows = [device({ id: "d3", client_id: OTHER_CLIENT, endpoint_hash: sha("https://push.example.test/send/zzz999") })];
    const { res } = await unsubscribe(rows, { endpoint: "https://push.example.test/send/zzz999" });
    assert.deepEqual(res.body, { ok: true, retired: 0, count: 0 });
    assert.equal(rows[0].revoked_at, null);
  });
});

describe("the unsubscribe link in every email", () => {
  let restore;
  const secret = crypto.randomBytes(24).toString("hex");
  beforeEach(() => { restore = withEnv({ UNSUBSCRIBE_TOKEN_SECRET: secret }); });
  afterEach(() => restore());

  function link(over = {}) {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const parts = { orgId: ORG_ID, clientId: CLIENT, channel: "email", expiresAt: exp, ...over };
    return { org: parts.orgId, client: parts.clientId, channel: parts.channel, exp: String(parts.expiresAt), sig: signature({ ...parts, secret }) };
  }

  test("GET reports state only and writes nothing", async () => {
    const { res, fake } = await callShared(mailUnsubscribeHandler, { method: "GET", query: link(), headers: {} }, [[/FROM opt_outs/, [{ "?column?": 1 }]]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, channel: "email", already_unsubscribed: true });
    assert.equal(fake.find(/INSERT INTO opt_outs/).length, 0);
  });

  test("POST records the opt-out for exactly the client and channel the signed link names", async () => {
    const { res, fake } = await callShared(mailUnsubscribeHandler, { method: "POST", query: link(), headers: {} }, []);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, channel: "email", unsubscribed: true });
    assert.deepEqual(fake.find(/INSERT INTO opt_outs/)[0].params, [CLIENT, ORG_ID, "email", "unsubscribe_link"]);
  });

  test("a link signed for one client cannot unsubscribe another, and an old link does nothing", async () => {
    const swapped = { ...link(), client: OTHER_CLIENT };
    const forged = await callShared(mailUnsubscribeHandler, { method: "POST", query: swapped, headers: {} }, []);
    assert.equal(forged.res.statusCode, 400);
    assert.equal(forged.res.body.error, "invalid_or_expired");
    assert.equal(forged.fake.find(/INSERT INTO opt_outs/).length, 0);
    const old = await callShared(mailUnsubscribeHandler, { method: "POST", query: link({ expiresAt: Math.floor(Date.now() / 1000) - 10 }), headers: {} }, []);
    assert.equal(old.res.statusCode, 400);
    assert.equal(old.fake.find(/INSERT INTO opt_outs/).length, 0);
  });
});

describe("POST /api/waypoint-tick", () => {
  const WAYPOINT = "a1000000-0000-4000-8000-0000000000aa";
  const OTHER_WAYPOINT = "a2000000-0000-4000-8000-0000000000bb";
  // Both clients carry the same catalog key, as every real file does, so a write
  // that lost its client condition would land on the wrong row.
  const step = (over = {}) => ({
    id: WAYPOINT, org_id: ORG_ID, client_id: CLIENT, key: "pay-down-card", state: "not_started", owner_kind: "client",
    verify_kind: null, completed_at: null, state_reason: null, ...over
  });
  const table = (over = {}) => [step(over), step({ id: OTHER_WAYPOINT, client_id: OTHER_CLIENT })];
  const set = (row, params, sql) => {
    if (/state = 'done'/.test(sql)) Object.assign(row, { state: "done", completed_at: "2026-10-13T12:00:00.000Z" });
    else Object.assign(row, { state: params[3], state_reason: params[4], completed_at: null });
  };
  const tick = (rows, body) => callShared(tickHandler, req("POST", { body }), [...clientLogin(), ...tableRules("client_waypoints", rows, { set })]);
  const stateOf = (rows, id) => rows.find((r) => r.id === id).state;

  test("ticking the client's own step closes it for this client only", async () => {
    const rows = table();
    const { res, fake } = await tick(rows, { waypoint_id: WAYPOINT, done: true });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, changed: true, waypoint: { id: WAYPOINT, state: "done", completedAt: "2026-10-13T12:00:00.000Z", closedBy: "client" } });
    const [look] = fake.find(/SELECT \* FROM client_waypoints/);
    assert.deepEqual(look.params, [WAYPOINT, ORG_ID, CLIENT]);
    assert.match(look.sql, /id = \$1::uuid AND org_id = \$2::uuid\s+AND client_id = \$3::uuid/, "the lookup names step, company and client");
    assert.deepEqual(fake.find(/UPDATE client_waypoints\s+SET state = 'done'/)[0].params.slice(0, 3), [ORG_ID, CLIENT, "pay-down-card"]);
    assert.equal(stateOf(rows, WAYPOINT), "done");
    assert.equal(stateOf(rows, OTHER_WAYPOINT), "not_started", "the other client's step with the same key is untouched");
  });

  test("unticking reopens it with the reason on the row, for this client only", async () => {
    const rows = [step({ state: "done", completed_at: "2026-10-12T00:00:00.000Z" }), step({ id: OTHER_WAYPOINT, client_id: OTHER_CLIENT, state: "done", completed_at: "2026-10-12T00:00:00.000Z" })];
    const { res, fake } = await tick(rows, { waypoint_id: WAYPOINT, done: false });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.changed, true);
    assert.equal(res.body.waypoint.state, "not_started");
    assert.equal(fake.find(/UPDATE client_waypoints\s+SET state = \$4/)[0].params[4], "unticked_by_client");
    assert.deepEqual(rows.map((r) => r.state), ["not_started", "done"]);
    assert.equal(rows[0].state_reason, "unticked_by_client");
  });

  test("a step that closes on the credit report, a step of ours, and the same step of another client are refused and unchanged", async () => {
    const machine = await tick(table({ verify_kind: "paydown" }), { waypoint_id: WAYPOINT, done: true });
    assert.equal(machine.res.statusCode, 409);
    assert.equal(machine.res.body.reason, "closes_on_credit_report");
    const ours = await tick(table({ owner_kind: "staff" }), { waypoint_id: WAYPOINT, done: true });
    assert.equal(ours.res.body.reason, "our_step");
    // The login is CLIENT; the step id is OTHER_CLIENT's. It is the same answer a step that does not exist gets.
    for (const done of [true, false]) {
      const rows = table();
      const notTheirs = await tick(rows, { waypoint_id: OTHER_WAYPOINT, done });
      assert.equal(notTheirs.res.statusCode, 404, `done:${done}`);
      assert.deepEqual(notTheirs.res.body, { ok: false, error: "not_found" });
      assert.deepEqual(rows.map((r) => r.state), ["not_started", "not_started"]);
      assert.equal(notTheirs.fake.find(/UPDATE client_waypoints/).length, 0, "no write was even tried");
    }
    for (const out of [machine, ours]) assert.equal(out.fake.find(/UPDATE client_waypoints/).length, 0);
  });

  test("done must be true or false", async () => {
    const { res } = await tick(table(), { waypoint_id: WAYPOINT, done: "yes" });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "done_required");
  });
});

describe("POST /api/public/affiliate-click", () => {
  beforeEach(() => _resetOrgCache());
  afterEach(() => _resetOrgCache());
  const orgRule = [/FROM orgs WHERE slug/, [{ id: ORG_ID }]];

  test("a real referral code records one visit against that affiliate", async () => {
    const { res, fake } = await callShared(clickHandler, { method: "POST", body: { ref: "fh1042", source: "ig-bio" }, headers: { "user-agent": "Mozilla/5.0" } }, [
      orgRule, [/FROM affiliates\s+WHERE org_id = \$1 AND upper\(tracking_id\)/, [{ id: "aff-1" }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, recorded: true });
    const [look] = fake.find(/FROM affiliates/);
    assert.deepEqual(look.params, [ORG_ID, "fh1042"]);
    const [ins] = fake.find(/INSERT INTO affiliate_link_clicks/);
    assert.deepEqual(ins.params.slice(0, 4), [ORG_ID, "aff-1", "fh1042", "ig-bio"]);
    assert.match(ins.params[4], /^[0-9a-f]{32}$/);
  });

  test("an unknown code answers the same and still counts the visit, with no affiliate", async () => {
    const { res, fake } = await callShared(clickHandler, { method: "POST", body: { code: "NOPE" }, headers: {} }, [orgRule]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, recorded: true });
    assert.equal(fake.find(/INSERT INTO affiliate_link_clicks/)[0].params[1], null);
  });

  test("no code is a 400 and records nothing", async () => {
    const { res, fake } = await callShared(clickHandler, { method: "POST", body: {}, headers: {} }, [orgRule]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "ref_required");
    assert.equal(fake.find(/INSERT INTO affiliate_link_clicks/).length, 0);
  });
});
