// /api/money/connections, /api/merchant/events and the merchant webhook door —
// endpoint tests. Stubbed principal; the 442 tables are the in-memory stand-in
// (src/merchant/memory-db.mjs) because the migration is not live yet.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import connections from "../../api/money/connections.mjs";
import merchantEvents from "../../api/merchant/events.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { handleWebhook } from "./router.mjs";
import { memoryDb } from "../merchant/memory-db.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const MINE = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const OTHER = "99999999-8888-4777-8666-555555555555";
const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
const ENV = { MERCHANT_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64"), APP_BASE_URL: "https://fundhub.ai" };
const NOW = () => new Date("2026-10-06T12:00:00Z");

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}
const clientP = (clientId = MINE) => ({ kind: "client", accountId: crypto.randomUUID(), orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: crypto.randomUUID(), role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
function seed() {
  return memoryDb({
    clients: [{ id: MINE, org_id: ORG }],
    entities: [{ id: BIZ, org_id: ORG, client_id: MINE, kind: "business", name: "Fundhub LLC" }]
  });
}
async function call(db, principal, req) {
  const res = makeRes();
  await connections({ method: "GET", query: {}, ...req }, res, { db, requirePrincipal: gateAs(principal), now: NOW, env: ENV });
  return res;
}

describe("routes", () => {
  test("both endpoints are routed", () => {
    assert.equal(ROUTES["money/connections"], connections);
    assert.equal(ROUTES["merchant/events"], merchantEvents);
  });
});

describe("/api/money/connections — gate", () => {
  test("no session → 401; a partner → 403", async () => {
    assert.equal((await call(seed(), null, {})).statusCode, 401);
    assert.equal((await call(seed(), { kind: "partner", orgId: ORG }, {})).statusCode, 403);
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const res = await call(seed(), clientP(), { query: { client_id: OTHER } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, MINE);
    assert.deepEqual(res.body.containers.map((c) => c.name), ["Fundhub LLC"]);
    assert.equal(res.body.open_api_url, "https://fundhub.ai/api/merchant/events");
  });

  test("staff: FINANCE only, client_id required, other org is 404", async () => {
    assert.equal((await call(seed(), staffP("closer"), { query: { client_id: MINE } })).statusCode, 403);
    assert.equal((await call(seed(), staffP("owner"), { query: {} })).statusCode, 400);
    assert.equal((await call(seed(), staffP("owner"), { query: { client_id: OTHER } })).statusCode, 404);
    assert.equal((await call(seed(), staffP("owner"), { query: { client_id: MINE } })).statusCode, 200);
  });

  test("405 on anything but GET/POST", async () => {
    assert.equal((await call(seed(), clientP(), { method: "DELETE" })).statusCode, 405);
  });
});

describe("create → events → summary, end to end through the handlers", () => {
  test("open API: key once, events in, idempotent, summary back", async () => {
    const db = seed();
    const made = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "api", entity_id: BIZ } });
    assert.equal(made.statusCode, 201);
    assert.equal(made.headers["cache-control"], "no-store");
    const key = made.body.api_key;
    assert.match(key, /^fhm_/);

    const list = await call(db, clientP(), {});
    assert.ok(!JSON.stringify(list.body).includes(key), "the key is never read back");
    assert.equal(list.body.connections[0].api_key_hint, key.slice(-4));

    const post = async (body, auth = `Bearer ${key}`) => {
      const res = makeRes();
      await merchantEvents({ method: "POST", headers: { authorization: auth }, body }, res, { db });
      return res;
    };
    const events = [
      { id: "s1", kind: "sale", amount_cents: 120000, occurred_at: "2026-09-12T15:00:00Z" },
      { id: "s2", kind: "sale", amount_cents: 49700, occurred_at: "2026-10-02T15:00:00Z" },
      { id: "r1", kind: "refund", amount_cents: 9700, occurred_at: "2026-10-03T15:00:00Z" },
      { id: "p1", kind: "payout", amount_cents: 100000, occurred_at: "2026-10-04T15:00:00Z" }
    ];
    const first = await post({ events });
    assert.equal(first.statusCode, 200);
    assert.deepEqual([first.body.inserted, first.body.duplicates, first.body.rejected], [4, 0, 0]);
    const again = await post(JSON.stringify({ events }));
    assert.deepEqual([again.body.inserted, again.body.duplicates], [0, 4]);

    const mixed = await post({ events: [{ id: "s3", kind: "sale", amount_cents: 100, occurred_at: "2026-10-05T00:00:00Z" }, { id: "bad" }] });
    assert.equal(mixed.statusCode, 200);
    assert.deepEqual([mixed.body.inserted, mixed.body.rejected], [1, 1]);

    assert.equal((await post({ events })).statusCode, 200);
    assert.equal((await post({ events }, "")).statusCode, 401);
    assert.equal((await post({ events }, "Bearer fhm_wrongwrongwrongwrong")).statusCode, 401);
    assert.equal((await post("{not json")).statusCode, 400);
    const get = makeRes();
    await merchantEvents({ method: "GET", headers: {} }, get, { db });
    assert.equal(get.statusCode, 405);

    const sum = (await call(db, clientP(), {})).body.summary;
    const oct = sum.containers[0].months.at(-1);
    assert.deepEqual([oct.sales_cents, oct.refunds_cents, oct.payouts_cents, oct.net_cents, oct.sale_count], [49800, 9700, 100000, 40100, 2]);
    assert.equal(sum.containers[0].months.at(-2).sales_cents, 120000);

    const off = await call(db, clientP(), { method: "POST", body: { action: "disable", connection_id: made.body.connection.id } });
    assert.equal(off.body.connection.status, "disabled");
    assert.equal((await post({ events })).statusCode, 401);
  });

  test("Whop: webhook URL + secret, then a signed delivery through /api/webhooks/merchant-whop/<id>", async () => {
    const db = seed();
    const made = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "whop", entity_id: BIZ } });
    assert.equal(made.statusCode, 201);
    assert.equal(made.body.api_key, undefined);
    const id = made.body.connection.id;
    assert.equal(made.body.connection.webhook_url, `https://fundhub.ai/api/webhooks/merchant-whop/${id}`);
    assert.equal(made.body.connection.status, "waiting");

    const secret = "ws_" + "c".repeat(64);
    const saved = await call(db, clientP(), { method: "POST", body: { action: "secret", connection_id: id, secret } });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.connection.status, "active");
    assert.equal(saved.body.connection.has_secret, true);
    assert.ok(!JSON.stringify(saved.body).includes(secret));

    const body = JSON.stringify({ id: "msg_9", type: "payment.succeeded", timestamp: new Date().toISOString(),
      data: { id: "pay_9", currency: "usd", total: { amount: "250.00", currency: "usd", decimals: 2 }, paid_at: new Date().toISOString() } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`msg_9.${ts}.${body}`).digest("base64");
    const out = await handleWebhook({ db, provider: `merchant-whop/${id}`, rawBody: body,
      headers: { "webhook-id": "msg_9", "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }, env: ENV });
    assert.equal(out.status, 200);
    assert.equal(out.body.inserted, 1);
    assert.ok(!db.state.log.some((l) => /webhook_captures/.test(l.sql)), "a client's merchant payload is not copied into webhook_captures");

    const bad = await handleWebhook({ db, provider: `merchant-whop/${id}`, rawBody: body,
      headers: { "webhook-id": "msg_9", "webhook-timestamp": ts, "webhook-signature": "v1,AAAA" }, env: ENV });
    assert.equal(bad.status, 401);
  });

  test("bad input answers in words, never a 500", async () => {
    const db = seed();
    const r1 = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "stripe", entity_id: BIZ } });
    assert.equal(r1.statusCode, 400);
    const r2 = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "api" } });
    assert.equal(r2.statusCode, 400);
    const r3 = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "api", entity_id: OTHER } });
    assert.equal(r3.statusCode, 404);
    const r4 = await call(db, clientP(), { method: "POST", body: { action: "explode" } });
    assert.equal(r4.statusCode, 400);
    const made = await call(db, clientP(), { method: "POST", body: { action: "create", provider: "commas", entity_id: BIZ } });
    const noKey = makeRes();
    await connections({ method: "POST", query: {}, body: { action: "secret", connection_id: made.body.connection.id, secret: "abcdefghij" } }, noKey,
      { db, requirePrincipal: gateAs(clientP()), now: NOW, env: {} });
    assert.equal(noKey.statusCode, 503);
    assert.equal(noKey.body.error, "not_configured");
  });
});

describe("pull mode — paste your API key, Sync now (migration 457)", () => {
  const PULL_ENV = { ...ENV, ADAPTERS_DRY_RUN: "0" };
  const COMMAS_KEY = "commas_live_key_abcdefghijklmnop";
  /* Commas List Transactions, shaped from commasdocs.com. */
  const txn = (id, amount, fee) => ({
    id, transaction_date: "2026-10-02T14:55:09.000000Z",
    fan: { id: "5yWjR", name: "Jane Doe", email: "jane@example.com" },
    product: { id: "NLxj6", title: "Pro Monthly Membership", price: String(amount) },
    refunds: [], fee_amount: fee, net_amount: amount - fee, amount
  });
  function commasFetch(pages, { status = 200 } = {}) {
    const calls = [];
    const fn = async (url, init) => {
      const u = new URL(url);
      calls.push({ u, init });
      const page = Number(u.searchParams.get("page") || 1);
      const body = status === 200
        ? { status: "success", data: { transactions: pages[page - 1] || [], pagination: { current_page: page, has_more: page < pages.length } } }
        : { status: "error", message: "Invalid API key or unauthorized user context" };
      return new Response(JSON.stringify(body), { status });
    };
    fn.calls = calls;
    return fn;
  }
  async function post(db, body, fetchImpl, principal = clientP()) {
    const res = makeRes();
    await connections({ method: "POST", query: {}, body }, res, { db, requirePrincipal: gateAs(principal), now: NOW, env: PULL_ENV, fetchImpl });
    return res;
  }

  test("create pull → paste key (pulls right away) → Sync now → the key is never read back", async () => {
    const db = seed();
    const made = await post(db, { action: "create", provider: "commas", entity_id: BIZ, mode: "pull" });
    assert.equal(made.statusCode, 201);
    const c0 = made.body.connection;
    assert.deepEqual([c0.mode, c0.status, c0.webhook_url, c0.has_api_key, c0.last_synced_at], ["pull", "waiting", null, false, null]);

    const f = commasFetch([[txn(1, 29.99, 1.2), txn(2, 100, 3.5)]]);
    const keyed = await post(db, { action: "api_key", connection_id: c0.id, api_key: COMMAS_KEY }, f);
    assert.equal(keyed.statusCode, 200);
    assert.equal(keyed.headers["cache-control"], "no-store");
    assert.deepEqual([keyed.body.sync.ok, keyed.body.sync.done, keyed.body.sync.inserted], [true, true, 4]);
    assert.equal(keyed.body.connection.status, "active");
    assert.equal(keyed.body.connection.has_api_key, true);
    assert.equal(keyed.body.connection.api_key_hint, COMMAS_KEY.slice(-4));
    assert.ok(keyed.body.connection.last_synced_at);
    assert.equal(f.calls[0].init.headers["x-api-key"], COMMAS_KEY);
    assert.equal(JSON.stringify(keyed.body).includes(COMMAS_KEY), false);

    const again = await post(db, { action: "sync", connection_id: c0.id }, commasFetch([[txn(1, 29.99, 1.2), txn(2, 100, 3.5), txn(3, 10, 0.5)]]));
    assert.equal(again.statusCode, 200);
    assert.deepEqual([again.body.sync.inserted, again.body.sync.duplicates], [2, 4]);

    const list = await call(db, clientP(), {});
    assert.equal(JSON.stringify(list.body).includes(COMMAS_KEY), false, "GET never carries the key");
    assert.equal(list.body.connections[0].event_count, 6);
    const oct = list.body.summary.totals.at(-1);
    assert.deepEqual([oct.sales_cents, oct.fees_cents, oct.sale_count], [13999, 520, 3]);
  });

  test("a rejected key comes back as a plain-words sync error and stays on the connection", async () => {
    const db = seed();
    const made = await post(db, { action: "create", provider: "commas", entity_id: BIZ, mode: "pull" });
    const r = await post(db, { action: "api_key", connection_id: made.body.connection.id, api_key: COMMAS_KEY }, commasFetch([], { status: 401 }));
    assert.equal(r.statusCode, 200);
    assert.equal(r.body.sync.ok, false);
    assert.equal(r.body.sync.code, "auth_failed");
    assert.match(r.body.connection.last_sync_error, /did not accept this API key/);
    assert.equal(r.body.sync.error.includes(COMMAS_KEY), false);
  });

  test("refusals: open API cannot pull; push takes no key; sync on push is 400; staff need FINANCE", async () => {
    const db = seed();
    const api = await post(db, { action: "create", provider: "api", entity_id: BIZ, mode: "pull" });
    assert.equal(api.statusCode, 400);
    assert.equal(api.body.error, "bad_mode");
    assert.equal((await post(db, { action: "create", provider: "whop", entity_id: BIZ, mode: "sideways" })).body.error, "bad_mode");
    const push = await post(db, { action: "create", provider: "whop", entity_id: BIZ });
    assert.equal(push.body.connection.mode, "push");
    const k = await post(db, { action: "api_key", connection_id: push.body.connection.id, api_key: COMMAS_KEY });
    assert.equal(k.statusCode, 400);
    assert.equal(k.body.error, "not_pull");
    const s = await post(db, { action: "sync", connection_id: push.body.connection.id });
    assert.equal(s.statusCode, 400);
    assert.equal((await post(db, { action: "sync", connection_id: "nope" })).statusCode, 400);
    assert.equal((await post(db, { action: "sync", connection_id: OTHER })).statusCode, 404);
    assert.equal((await post(db, { action: "sync", connection_id: push.body.connection.id, client_id: MINE }, undefined, staffP("closer"))).statusCode, 403);
  });

  test("a turned-off pull connection will not sync", async () => {
    const db = seed();
    const made = await post(db, { action: "create", provider: "whop", entity_id: BIZ, mode: "pull" });
    await post(db, { action: "disable", connection_id: made.body.connection.id });
    const r = await post(db, { action: "sync", connection_id: made.body.connection.id });
    assert.equal(r.statusCode, 409);
  });
});
