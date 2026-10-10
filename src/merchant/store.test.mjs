// Merchant store, secrets and webhook receiver — against the in-memory tables.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { memoryDb } from "./memory-db.mjs";
import {
  createConnection, setWebhookSecret, disableConnection, listConnections, findActiveByApiKey,
  recordEvents, merchantSummary, buildSummary, monthKeys, publicConnection, MerchantError
} from "./store.mjs";
import { newApiKey, hashApiKey, encryptWebhookSecret, decryptWebhookSecret } from "./secrets.mjs";
import { handleMerchantWebhook, parseMerchantProvider } from "./webhooks.mjs";
import { readFileSync } from "node:fs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const OTHER_CLIENT = "00000000-0000-4000-8000-000000000002";
const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
const OTHER_BIZ = "00000000-0000-4000-8000-0000000000b2";
const ENV = { MERCHANT_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64") };

function seed() {
  return memoryDb({
    clients: [{ id: CLIENT, org_id: ORG }, { id: OTHER_CLIENT, org_id: ORG }],
    entities: [
      { id: BIZ, org_id: ORG, client_id: CLIENT, kind: "business", name: "Fundhub LLC" },
      { id: OTHER_BIZ, org_id: ORG, client_id: OTHER_CLIENT, kind: "business", name: "Someone Else LLC" }
    ]
  });
}

describe("secrets", () => {
  test("api key: fhm_ prefix, only the sha256 is kept", () => {
    const k = newApiKey();
    assert.match(k, /^fhm_[A-Za-z0-9_-]{43}$/);
    assert.match(hashApiKey(k), /^[0-9a-f]{64}$/);
    assert.notEqual(newApiKey(), k);
  });

  test("webhook secret round-trips, and a ciphertext moved to another row fails", () => {
    const enc = encryptWebhookSecret("ws_abc", { connectionId: "c1", env: ENV });
    assert.ok(!enc.includes("ws_abc"));
    assert.equal(decryptWebhookSecret(enc, { connectionId: "c1", env: ENV }), "ws_abc");
    assert.throws(() => decryptWebhookSecret(enc, { connectionId: "c2", env: ENV }), /authentication failed/);
  });

  test("no key set → refuses to store, names the variable, never a fallback", () => {
    assert.throws(() => encryptWebhookSecret("x", { connectionId: "c1", env: {} }), /MERCHANT_SECRET_ENC_KEY is not set/);
  });
});

describe("connections", () => {
  test("open API: key returned once, only its hash stored, live at once", async () => {
    const db = seed();
    const { row, apiKey } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "api" });
    assert.equal(row.status, "active");
    const stored = db.state.connections[0];
    assert.equal(stored.api_key_hash, hashApiKey(apiKey));
    assert.ok(!JSON.stringify(db.state.connections).includes(apiKey));
    assert.equal((await findActiveByApiKey(db, apiKey)).id, row.id);
    assert.equal(await findActiveByApiKey(db, apiKey + "x"), null);
    assert.equal(await findActiveByApiKey(db, "not-a-key"), null);
    const pub = publicConnection(row, { baseUrl: "https://fundhub.ai" });
    assert.equal(pub.api_key_hint, apiKey.slice(-4));
    assert.ok(!("api_key_hash" in pub) && !("encrypted_webhook_secret" in pub));
  });

  test("another client's container is refused", async () => {
    const db = seed();
    await assert.rejects(createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: OTHER_BIZ, provider: "api" }),
      (e) => e instanceof MerchantError && e.status === 404);
  });

  test("Whop: waiting until the secret is pasted, then active; webhook URL carries the id", async () => {
    const db = seed();
    const { row, apiKey } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "whop" });
    assert.equal(apiKey, null);
    assert.equal(row.status, "waiting");
    assert.equal(publicConnection(row, { baseUrl: "https://fundhub.ai/" }).webhook_url,
      `https://fundhub.ai/api/webhooks/merchant-whop/${row.id}`);
    await setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, secret: "ws_" + "a".repeat(64), env: ENV });
    assert.equal(db.state.connections[0].status, "active");
    assert.ok(!db.state.connections[0].encrypted_webhook_secret.includes("ws_"));
    await assert.rejects(setWebhookSecret(db, { orgId: ORG, clientId: OTHER_CLIENT, connectionId: row.id, secret: "ws_xxxxxxxx", env: ENV }),
      (e) => e.status === 404);
  });

  test("disable stops the key; history stays", async () => {
    const db = seed();
    const { row, apiKey } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "api" });
    await recordEvents(db, row, [{ provider_event_id: "a", kind: "sale", amount_cents: 100, currency: "usd", occurred_at: "2026-10-01T00:00:00Z" }]);
    await disableConnection(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id });
    assert.equal(await findActiveByApiKey(db, apiKey), null);
    assert.equal(db.state.events.length, 1);
    assert.equal((await listConnections(db, { orgId: ORG, clientId: CLIENT }))[0].status, "disabled");
  });
});

describe("events + summary", () => {
  test("the same provider event id twice is stored once", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "api" });
    const e = { provider_event_id: "x1", kind: "sale", amount_cents: 500, currency: "usd", occurred_at: "2026-10-01T00:00:00Z" };
    assert.deepEqual(await recordEvents(db, row, [e]).then((r) => [r.inserted, r.duplicates]), [1, 0]);
    assert.deepEqual(await recordEvents(db, row, [e]).then((r) => [r.inserted, r.duplicates]), [0, 1]);
    assert.ok(db.state.connections[0].last_event_at);
  });

  test("month over month per container: net = sales − refunds − fees; payouts reported apart", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "api" });
    await recordEvents(db, row, [
      { provider_event_id: "s1", kind: "sale", amount_cents: 100000, currency: "usd", occurred_at: "2026-09-10T00:00:00Z" },
      { provider_event_id: "s2", kind: "sale", amount_cents: 50000, currency: "usd", occurred_at: "2026-10-02T00:00:00Z" },
      { provider_event_id: "r1", kind: "refund", amount_cents: -10000, currency: "usd", occurred_at: "2026-10-03T00:00:00Z" },
      { provider_event_id: "f1", kind: "fee", amount_cents: -1500, currency: "usd", occurred_at: "2026-10-03T00:00:00Z" },
      { provider_event_id: "p1", kind: "payout", amount_cents: -80000, currency: "usd", occurred_at: "2026-10-04T00:00:00Z" },
      { provider_event_id: "e1", kind: "sale", amount_cents: 9999, currency: "eur", occurred_at: "2026-10-04T00:00:00Z" },
      { provider_event_id: "old", kind: "sale", amount_cents: 1, currency: "usd", occurred_at: "2025-01-01T00:00:00Z" }
    ]);
    const s = await merchantSummary(db, { orgId: ORG, clientId: CLIENT, asOf: new Date("2026-10-06T12:00:00Z") });
    assert.deepEqual(s.months, ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    assert.equal(s.containers.length, 1);
    assert.equal(s.containers[0].name, "Fundhub LLC");
    const oct = s.containers[0].months[5];
    assert.deepEqual(oct, { month: "2026-10", sales_cents: 50000, refunds_cents: 10000, fees_cents: 1500, payouts_cents: 80000, net_cents: 38500, sale_count: 1 });
    assert.equal(s.containers[0].months[4].sales_cents, 100000);
    assert.deepEqual(s.totals[5], oct);
    assert.equal(s.other_currency_events, 1);
    assert.equal(s.currency, "usd");
  });

  test("no connection → no containers listed, totals are zeros (the page shows dashes)", () => {
    const s = buildSummary({ rows: [], connections: [], asOf: new Date("2026-10-06T00:00:00Z") });
    assert.deepEqual(s.containers, []);
    assert.equal(s.totals.length, 6);
    assert.equal(s.last_event_at, null);
  });

  test("monthKeys crosses a year cleanly", () => {
    assert.deepEqual(monthKeys(new Date("2026-02-15T00:00:00Z"), 3), ["2025-12", "2026-01", "2026-02"]);
  });
});

describe("webhook receiver — merchant-whop/<id>, merchant-commas/<id>", () => {
  const whopSecret = "ws_" + "b".repeat(64);
  const NOW = Date.parse("2026-10-06T12:00:00Z");
  function whopHeaders(body, secret = whopSecret, id = "msg_1") {
    const ts = String(Math.floor(NOW / 1000));
    const sig = crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(`${id}.${ts}.${body}`).digest("base64");
    return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
  }

  test("parseMerchantProvider reads the path the router hands over", () => {
    assert.deepEqual(parseMerchantProvider("merchant-whop/abc"), { provider: "whop", connectionId: "abc" });
    assert.deepEqual(parseMerchantProvider("merchant-commas/abc"), { provider: "commas", connectionId: "abc" });
    assert.equal(parseMerchantProvider("commas"), null);
    assert.equal(parseMerchantProvider("merchant-stripe/abc"), null);
  });

  test("a signed Whop payment lands as a sale + fee, once", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "whop" });
    await setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, secret: whopSecret, env: ENV });
    const body = JSON.stringify({ id: "msg_1", type: "payment.succeeded", timestamp: "2026-10-06T11:59:00Z",
      data: { id: "pay_1", currency: "usd", total: { amount: "49.00", currency: "usd", decimals: 2 },
        amount_after_fees: { amount: "47.04", currency: "usd", decimals: 2 }, paid_at: "2026-10-06T11:58:00Z" } });
    const out = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    assert.equal(out.status, 200);
    assert.equal(out.body.inserted, 2);
    const again = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    assert.equal(again.body.duplicates, 2);
    assert.deepEqual(db.state.events.map((e) => [e.kind, e.amount_cents]), [["sale", 4900], ["fee", -196]]);
  });

  test("every refusal is the same 401: bad signature, unknown id, waiting, disabled, wrong provider", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "whop" });
    const body = JSON.stringify({ type: "payment.succeeded", data: { id: "pay_x" } });
    const waiting = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    await setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, secret: whopSecret, env: ENV });
    const badSig = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body, "ws_wrongwrong"), env: ENV, now: NOW });
    const unknown = await handleMerchantWebhook({ db, provider: "whop", connectionId: crypto.randomUUID(), rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    const wrongProvider = await handleMerchantWebhook({ db, provider: "commas", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    const notUuid = await handleMerchantWebhook({ db, provider: "whop", connectionId: "constructor", rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    await disableConnection(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id });
    const disabled = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    for (const r of [waiting, badSig, unknown, wrongProvider, notUuid, disabled]) {
      assert.deepEqual(r, { status: 401, body: { ok: false, error: "bad_signature" } });
    }
    assert.equal(db.state.events.length, 0);
  });

  test("a signed client Commas payment lands as a sale; Fundhub's own commas adapter is not called", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "commas" });
    await setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, secret: "client-commas-signing", env: ENV });
    const body = JSON.stringify({ id: "evt_1", type: "payment.succeeded", data: { payment_id: "p_77", amount: 1500, created_at: "2026-10-05T00:00:00Z" } });
    const sig = crypto.createHmac("sha256", "client-commas-signing").update(body).digest("hex");
    const out = await handleMerchantWebhook({ db, provider: "commas", connectionId: row.id, rawBody: body, headers: { "x-webhook-signature": sig }, env: ENV });
    assert.equal(out.status, 200);
    assert.deepEqual(db.state.events.map((e) => [e.provider_event_id, e.amount_cents]), [["sale:p_77", 150000]]);
    assert.ok(!db.state.log.some((l) => /commas_inbox/.test(l.sql)), "never writes Fundhub's own Commas inbox");
  });

  test("verified but not money → 200 ignored, so the processor stops retrying", async () => {
    const db = seed();
    const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "whop" });
    await setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, secret: whopSecret, env: ENV });
    const body = JSON.stringify({ type: "membership.activated", data: { id: "mem_1", created_at: "2026-10-01T00:00:00Z" } });
    const out = await handleMerchantWebhook({ db, provider: "whop", connectionId: row.id, rawBody: body, headers: whopHeaders(body), env: ENV, now: NOW });
    assert.equal(out.status, 200);
    assert.ok(out.body.ignored);
  });
});

describe("migration 442", () => {
  const sql = readFileSync(new URL("../../db/migrations/442_merchant_connections.sql", import.meta.url), "utf8");
  test("guards live in the database", () => {
    assert.match(sql, /UNIQUE \(connection_id, provider_event_id\)/);
    assert.match(sql, /merchant_connections_entity_guard/);
    assert.match(sql, /kind <> 'sale' OR amount_cents >= 0/);
    assert.match(sql, /\(provider = 'api'\) = \(api_key_hash IS NOT NULL\)/);
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /CREATE POLICY merchant_events_app_all/);
    assert.ok(!/\bapi_key\s+text/.test(sql), "no plaintext key column");
  });
});
