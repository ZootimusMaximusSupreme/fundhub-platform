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
