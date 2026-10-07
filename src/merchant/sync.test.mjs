// syncConnection + the daily merchant pull sweeper, against the in-memory 442/457
// stand-in and a stand-in provider. No network, no real key.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { memoryDb } from "./memory-db.mjs";
import { createConnection, setProcessorApiKey, getOwnConnection, setWebhookSecret, publicConnection } from "./store.mjs";
import { syncConnection, LOOKBACK_DAYS } from "./sync.mjs";
import { MerchantPullError } from "./providers/http.mjs";
import { decryptProcessorApiKey, decryptWebhookSecret } from "./secrets.mjs";
import { sweep } from "../workflows/merchant-pull-sweeper.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
const ENV = { MERCHANT_SECRET_ENC_KEY: crypto.randomBytes(32).toString("base64"), ADAPTERS_DRY_RUN: "0" };
const KEY = "apik_test_key_1234567890abcd";
const NOW = new Date("2026-10-06T12:00:00Z");

function seed() {
  return memoryDb({
    clients: [{ id: CLIENT, org_id: ORG }],
    entities: [{ id: BIZ, org_id: ORG, client_id: CLIENT, kind: "business", name: "Fundhub LLC" }]
  });
}
async function pullConnection(db, provider = "whop") {
  const { row } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider, mode: "pull" });
  await setProcessorApiKey(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id, apiKey: KEY, env: ENV });
  return getOwnConnection(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id });
}
const sale = (id, cents = 1000) => ({ provider_event_id: id, kind: "sale", amount_cents: cents, currency: "usd", occurred_at: "2026-10-01T00:00:00.000Z", description: "x", raw: null });

/* A provider with `pages` pages of events; records what it was asked. */
function fakeProvider(pages) {
  const seen = [];
  return {
    seen,
    listEvents: async ({ apiKey, since, cursor }) => {
      seen.push({ apiKey, since, cursor });
      const i = cursor ? Number(cursor) : 0;
      return { events: pages[i] || [], nextCursor: i + 1 < pages.length ? String(i + 1) : null, ignored: 0 };
    }
  };
}

describe("pull connection credentials", () => {
  test("the key is stored encrypted, bound to the row and the api-key purpose, and never shown", async () => {
    const db = seed();
    const row = await pullConnection(db);
    const stored = db.state.connections[0];
    assert.equal(stored.status, "active");
    assert.equal(stored.mode, "pull");
    assert.ok(stored.encrypted_api_key && !stored.encrypted_api_key.includes(KEY));
    assert.equal(decryptProcessorApiKey(stored.encrypted_api_key, { connectionId: stored.id, env: ENV }), KEY);
    // The same ciphertext does not open as a webhook secret (different additional data).
    assert.throws(() => decryptWebhookSecret(stored.encrypted_api_key, { connectionId: stored.id, env: ENV }));
    const shown = publicConnection(row, { baseUrl: "https://fundhub.ai" });
    assert.equal(JSON.stringify(shown).includes(KEY), false);
    assert.equal(JSON.stringify(shown).includes(stored.encrypted_api_key), false);
    assert.equal(shown.mode, "pull");
    assert.equal(shown.has_api_key, true);
    assert.equal(shown.api_key_hint, KEY.slice(-4));
    assert.equal(shown.webhook_url, null);
    assert.equal(shown.has_secret, null);
  });

  test("a pull connection refuses a webhook secret; a push connection refuses an API key; the open API cannot pull", async () => {
    const db = seed();
    const pull = await pullConnection(db);
    await assert.rejects(setWebhookSecret(db, { orgId: ORG, clientId: CLIENT, connectionId: pull.id, secret: "ws_123456789", env: ENV }), (e) => e.code === "no_secret_for_pull");
    const { row: push } = await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "commas" });
    await assert.rejects(setProcessorApiKey(db, { orgId: ORG, clientId: CLIENT, connectionId: push.id, apiKey: KEY, env: ENV }), (e) => e.code === "not_pull");
    await assert.rejects(createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "api", mode: "pull" }), (e) => e.code === "bad_mode");
    await assert.rejects(setProcessorApiKey(db, { orgId: ORG, clientId: CLIENT, connectionId: pull.id, apiKey: "short", env: ENV }), (e) => e.code === "bad_api_key");
  });
});

describe("syncConnection", () => {
  test("first pull asks for everything, writes every page, then finishes; a re-pull writes nothing new", async () => {
    const db = seed();
    const row = await pullConnection(db);
    const p = fakeProvider([[sale("a"), sale("b")], [sale("c")]]);
    const r = await syncConnection(db, row, { env: ENV, now: NOW, provider: p });
    assert.deepEqual({ ok: r.ok, done: r.done, pages: r.pages, inserted: r.inserted }, { ok: true, done: true, pages: 2, inserted: 3 });
    assert.equal(p.seen[0].apiKey, KEY);
    assert.equal(p.seen[0].since, null, "a new connection pulls its whole history");
    const after = db.state.connections[0];
    assert.equal(after.sync_cursor, null);
    assert.equal(after.synced_through.toISOString(), NOW.toISOString());
    assert.ok(after.last_synced_at);
    assert.equal(db.state.events.length, 3);

    const again = await syncConnection(db, await getOwnConnection(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id }),
      { env: ENV, now: new Date("2026-10-07T12:00:00Z"), provider: p });
    assert.equal(again.inserted, 0);
    assert.equal(again.duplicates, 3);
    assert.equal(db.state.events.length, 3, "idempotent on the provider's ids");
    const lookback = new Date(NOW.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();
    assert.equal(p.seen[2].since, lookback, "the next pull reaches back LOOKBACK_DAYS before the last complete pull");
  });

  test("the page budget stops a pull partway; the next pull resumes from the saved cursor", async () => {
    const db = seed();
    const row = await pullConnection(db);
    const p = fakeProvider([[sale("a")], [sale("b")], [sale("c")]]);
    const r1 = await syncConnection(db, row, { env: ENV, now: NOW, provider: p, maxPages: 2 });
    assert.equal(r1.done, false);
    assert.equal(db.state.connections[0].sync_cursor, "2");
    assert.equal(db.state.connections[0].synced_through, null, "not complete, so not synced through");
    assert.equal(publicConnection(db.state.connections[0]).sync_partway, true);
    const r2 = await syncConnection(db, await getOwnConnection(db, { orgId: ORG, clientId: CLIENT, connectionId: row.id }), { env: ENV, now: NOW, provider: p });
    assert.equal(r2.done, true);
    assert.equal(p.seen[2].cursor, "2");
    assert.deepEqual(db.state.events.map((e) => e.provider_event_id).sort(), ["a", "b", "c"]);
  });

  test("a processor failure is recorded on the row in plain words, keeps the cursor, and does not throw", async () => {
    const db = seed();
    const row = await pullConnection(db);
    let n = 0;
    const p = {
      listEvents: async () => {
        n++;
        if (n === 1) return { events: [sale("a")], nextCursor: "1" };
        throw new MerchantPullError("auth_failed", "The processor did not accept this API key.", 401);
      }
    };
    const r = await syncConnection(db, row, { env: ENV, now: NOW, provider: p });
    assert.equal(r.ok, false);
    assert.equal(r.code, "auth_failed");
    const c = db.state.connections[0];
    assert.equal(c.last_sync_error, "The processor did not accept this API key.");
    assert.equal(c.sync_cursor, "1", "the page that landed is kept; the next pull resumes after it");
    assert.equal(db.state.events.length, 1);
    assert.equal(publicConnection(c).last_sync_error, "The processor did not accept this API key.");
  });

  test("a missing encryption key is reported, not thrown; a push or keyless row is refused before any call", async () => {
    const db = seed();
    const row = await pullConnection(db);
    const p = fakeProvider([[sale("a")]]);
    const r = await syncConnection(db, row, { env: { ADAPTERS_DRY_RUN: "0" }, now: NOW, provider: p });
    assert.equal(r.code, "not_configured");
    assert.equal(p.seen.length, 0);
    assert.equal((await syncConnection(db, { ...row, mode: "push" }, { env: ENV, provider: p })).code, "not_pull");
    assert.equal((await syncConnection(db, { ...row, encrypted_api_key: null }, { env: ENV, provider: p })).code, "no_key");
    assert.equal(p.seen.length, 0);
  });

  test("a database fault throws (the sweeper turns it into a tally line)", async () => {
    const db = seed();
    const row = await pullConnection(db);
    const boom = { query: async (sql, params) => (/INSERT INTO merchant_events/.test(sql) ? Promise.reject(new Error("db down")) : db.query(sql, params)) };
    await assert.rejects(syncConnection(boom, row, { env: ENV, now: NOW, provider: fakeProvider([[sale("a")]]) }), /db down/);
  });
});

describe("merchant-pull-sweeper", () => {
  test("reads every live pull connection in chunks until done; skips push and keyless rows", async () => {
    const db = seed();
    const a = await pullConnection(db, "whop");
    const b = await pullConnection(db, "commas");
    await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "whop" }); // push — never pulled
    await createConnection(db, { orgId: ORG, clientId: CLIENT, entityId: BIZ, provider: "commas", mode: "pull" }); // no key yet

    const calls = [];
    const sync = async (conn, row, opts) => {
      calls.push({ id: row.id, maxPages: opts.maxPages });
      // a: done in one chunk. b: needs two chunks.
      const done = row.id === a.id || calls.filter((c) => c.id === b.id).length >= 2;
      return { ok: true, done, inserted: 1 };
    };
    const steps = [];
    const step = { run: async (name, fn) => { steps.push(name); return fn(); } };
    const tally = await sweep(db, { now: NOW, env: ENV, sync, step });
    assert.equal(tally.checked, 2);
    assert.equal(tally.synced, 2);
    assert.equal(tally.inserted, 3);
    assert.deepEqual(tally.failed, []);
    assert.deepEqual(steps, ["list-connections", `pull-${a.id}-0`, `pull-${b.id}-0`, `pull-${b.id}-1`]);
    assert.ok(calls.every((c) => c.maxPages === 5));
  });

  test("one connection failing does not stop the next", async () => {
    const db = seed();
    const a = await pullConnection(db, "whop");
    const b = await pullConnection(db, "commas");
    const sync = async (conn, row) => {
      if (row.id === a.id) throw new Error("socket hang up");
      return { ok: true, done: true, inserted: 2 };
    };
    const tally = await sweep(db, { now: NOW, env: ENV, sync });
    assert.equal(tally.synced, 1);
    assert.equal(tally.failed.length, 1);
    assert.equal(tally.failed[0].connectionId, a.id);
    assert.equal(tally.failed[0].code, "errored");
    assert.ok(b.id);
  });

  test("the real syncConnection end to end through a stand-in fetch (Whop shapes)", async () => {
    const db = seed();
    await pullConnection(db, "whop");
    const money = (amount) => ({ amount, currency: "usd", decimals: 2, display_decimals: 2 });
    const page = (data) => ({ data, page_info: { end_cursor: null, start_cursor: null, has_next_page: false, has_previous_page: false } });
    const fetchImpl = async (url) => {
      const u = new URL(url);
      const body = u.pathname === "/api/v1/payments"
        ? page([{ id: "pay_1", status: "paid", currency: "usd", total: money("50.00"), amount_after_fees: money("47.00"), paid_at: "2026-10-05T10:00:00Z", created_at: "2026-10-05T10:00:00Z" }])
        : u.pathname === "/api/v1/accounts/me" ? { id: "biz_1" } : page([]);
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const tally = await sweep(db, { now: NOW, env: ENV, fetchImpl });
    assert.equal(tally.synced, 1);
    assert.deepEqual(db.state.events.map((e) => [e.provider_event_id, e.kind, e.amount_cents]).sort(),
      [["pay_1", "sale", 5000], ["pay_1:fee", "fee", -300]]);
  });
});
