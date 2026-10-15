// Batch 04, practice test for "Turn on / off notifications" on the client portal.
//
// Turning notifications OFF writes nothing a query could tell from "never
// pressed": revokeSubscription only sets revoked_at. So there is no saved result
// to read, and a revoke that does nothing, or that turns off somebody else's
// phone, would pass a check of the saved rows. The store's own functions are
// RUN here against a small stand-in for the one table they touch.
//
// The stand-in reads the actual SQL text each function sends (a WHERE of AND-ed
// column tests, a SET list, an INSERT column list) and applies it to rows held in
// memory. It refuses any statement shape it does not understand, so a rewritten
// query fails loudly rather than being waved through. It has the table's one
// unique rule: a device may be live once per company (uq_client_push_subscriptions_live).

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  PushStoreError, decryptField, endpointHash, listLiveSubscriptions, listSubscriptionsForClient,
  revokeSubscription, saveSubscription
} from "../../../push/store.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT_A = "aaaaaaaa-1111-4111-8111-111111111111";
const CLIENT_B = "bbbbbbbb-1111-4111-8111-111111111111";
const ACCOUNT_A = "aaaaaaaa-2222-4222-8222-222222222222";
const ACCOUNT_B = "bbbbbbbb-2222-4222-8222-222222222222";

// A key built at run time: 32 bytes, base64, the way PUSH_SUB_ENC_KEY holds it.
const ENV = { PUSH_SUB_ENC_KEY: Buffer.alloc(32, 7).toString("base64") };

function subscription(name) {
  return {
    endpoint: `https://push.example.test/send/${name}`,
    keys: {
      p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 9)]).toString("base64url"),
      auth: Buffer.alloc(16, 5).toString("base64url")
    }
  };
}

// ── the stand-in table ──────────────────────────────────────────────────────

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function whereTests(text, params) {
  return text.split(/\s+AND\s+/i).map((term) => {
    let m = /^(\w+) = \$(\d+)$/.exec(term);
    if (m) return (row) => row[m[1]] != null && String(row[m[1]]) === String(params[Number(m[2]) - 1]);
    m = /^(\w+) IS NULL$/.exec(term);
    if (m) return (row) => row[m[1]] == null;
    throw new Error(`push stand-in: cannot read this test in a WHERE: ${term}`);
  });
}

function fakePushDb() {
  const rows = [];
  const statements = [];
  const live = (r) => r.revoked_at == null && r.expired_at == null;
  return {
    rows,
    statements,
    async query(sql, params = []) {
      const text = String(sql).replace(/\s+/g, " ").trim();
      statements.push(text);

      let m = /^SELECT (.+?) FROM client_push_subscriptions WHERE (.+?)(?: ORDER BY created_at ASC)?(?: LIMIT (\d+))?$/i.exec(text);
      if (m) {
        const tests = whereTests(m[2], params);
        let hit = rows.filter((r) => tests.every((t) => t(r)));
        if (/ORDER BY created_at ASC/i.test(text)) hit = hit.sort((a, b) => a.created_at - b.created_at);
        if (m[3]) hit = hit.slice(0, Number(m[3]));
        return { rows: hit.map((r) => ({ ...r })), rowCount: hit.length };
      }

      m = /^UPDATE client_push_subscriptions SET (.+?) WHERE (.+)$/i.exec(text);
      if (m) {
        const tests = whereTests(m[2], params);
        const hit = rows.filter((r) => tests.every((t) => t(r)));
        for (const row of hit) {
          for (const assignment of splitTop(m[1])) {
            const a = /^(\w+) = (.+)$/.exec(assignment);
            if (!a) throw new Error(`push stand-in: cannot read this SET: ${assignment}`);
            const [, column, value] = a;
            let v;
            let c;
            if (value === "now()") v = new Date();
            else if (/^\$\d+$/.test(value)) v = params[Number(value.slice(1)) - 1];
            else if ((c = /^COALESCE\(\$(\d+), (\w+)\)$/.exec(value))) v = params[Number(c[1]) - 1] ?? row[c[2]];
            else if ((c = /^COALESCE\((\w+), now\(\)\)$/.exec(value))) v = row[c[1]] ?? new Date();
            else if (/^\d+$/.test(value)) v = Number(value);
            else if ((c = /^(\w+) \+ 1$/.exec(value))) v = Number(row[c[1]]) + 1;
            else throw new Error(`push stand-in: cannot read this SET value: ${value}`);
            row[column] = v;
          }
        }
        return { rows: [], rowCount: hit.length };
      }

      m = /^INSERT INTO client_push_subscriptions \((.+?)\) VALUES \((.+?)\)$/i.exec(text);
      if (m) {
        const columns = m[1].split(",").map((c) => c.trim());
        const values = m[2].split(",").map((v) => v.trim());
        const row = { revoked_at: null, expired_at: null, failure_count: 0, last_success_at: null, created_at: new Date(), updated_at: new Date() };
        columns.forEach((column, i) => {
          const v = /^\$(\d+)$/.exec(values[i]);
          if (!v) throw new Error(`push stand-in: cannot read this INSERT value: ${values[i]}`);
          row[column] = params[Number(v[1]) - 1];
        });
        for (const [column, value] of Object.entries({ id: 1, org_id: 1, client_id: 1, endpoint_hash: 1, encrypted_endpoint: 1, encrypted_p256dh: 1, encrypted_auth: 1 })) {
          if (value && (row[column] == null || row[column] === "")) throw new Error(`push stand-in: ${column} is NOT NULL`);
        }
        if (rows.some((r) => live(r) && r.org_id === row.org_id && r.endpoint_hash === row.endpoint_hash)) {
          throw new Error("push stand-in: duplicate key value violates unique constraint uq_client_push_subscriptions_live");
        }
        rows.push(row);
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`push stand-in: cannot read this statement: ${text.slice(0, 120)}`);
    }
  };
}

const save = (db, { client = CLIENT_A, account = ACCOUNT_A, name = "phone-a", label = "iphone" } = {}) =>
  saveSubscription(db, { orgId: ORG, clientId: client, accountId: account, subscription: subscription(name), deviceLabel: label, env: ENV });

const liveRows = (db, client) => db.rows.filter((r) => r.client_id === client && r.revoked_at == null && r.expired_at == null);

// ── turning on ──────────────────────────────────────────────────────────────

test("turning notifications on saves one device for that client, sealed and tied to the login", async () => {
  const db = fakePushDb();
  const out = await save(db);
  assert.equal(out.created, true);
  assert.equal(db.rows.length, 1);
  const row = db.rows[0];
  assert.equal(row.org_id, ORG);
  assert.equal(row.client_id, CLIENT_A);
  assert.equal(row.account_id, ACCOUNT_A, "the sign-in that switched it on is recorded");
  assert.equal(row.device_label, "iphone");
  assert.equal(row.id, out.id);
  assert.equal(row.endpoint_hash, endpointHash(subscription("phone-a").endpoint));
  // sealed: v1:<iv>:<tag>:<cipher>, and none of the three secrets is in it in the clear
  for (const column of ["encrypted_endpoint", "encrypted_p256dh", "encrypted_auth"]) {
    assert.match(row[column], /^v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]+={0,2}$/, column);
  }
  const sub = subscription("phone-a");
  const seen = JSON.stringify(row);
  assert.equal(seen.includes("push.example.test"), false);
  assert.equal(seen.includes(sub.keys.p256dh), false);
  assert.equal(seen.includes(sub.keys.auth), false);
  // and it opens again only for the row it was written for
  assert.equal(decryptField(row.encrypted_endpoint, { rowId: row.id, env: ENV }), sub.endpoint);
  assert.equal(decryptField(row.encrypted_auth, { rowId: row.id, env: ENV }), sub.keys.auth);
  assert.throws(() => decryptField(row.encrypted_endpoint, { rowId: CLIENT_B, env: ENV }), /failed to decrypt/);
});

test("the same device saved again is refreshed in place, not duplicated", async () => {
  const db = fakePushDb();
  const first = await save(db);
  const sealedBefore = db.rows[0].encrypted_endpoint;
  db.rows[0].failure_count = 4;
  const second = await save(db);
  assert.equal(second.created, false);
  assert.equal(second.id, first.id);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].failure_count, 0, "a re-register clears the failure count");
  assert.notEqual(db.rows[0].encrypted_endpoint, sealedBefore, "a fresh seal is written");
});

test("a device that is signed in as somebody else moves to them and the first client's row is turned off", async () => {
  const db = fakePushDb();
  await save(db, { client: CLIENT_A, account: ACCOUNT_A, name: "shared-tablet" });
  await save(db, { client: CLIENT_B, account: ACCOUNT_B, name: "shared-tablet" });
  assert.equal(db.rows.length, 2);
  assert.notEqual(db.rows.find((r) => r.client_id === CLIENT_A).revoked_at, null, "the first client's row is turned off");
  assert.equal(liveRows(db, CLIENT_A).length, 0);
  assert.equal(liveRows(db, CLIENT_B).length, 1);
  assert.equal(liveRows(db, CLIENT_B)[0].account_id, ACCOUNT_B);
});

test("nothing is stored when the key is not set, and nothing when the subscription is not usable", async () => {
  const db = fakePushDb();
  await assert.rejects(() => saveSubscription(db, { orgId: ORG, clientId: CLIENT_A, accountId: ACCOUNT_A, subscription: subscription("x"), env: {} }),
    (err) => err instanceof PushStoreError && err.status === 503);
  await assert.rejects(() => saveSubscription(db, {
    orgId: ORG, clientId: CLIENT_A, accountId: ACCOUNT_A, env: ENV,
    subscription: { endpoint: "http://push.example.test/insecure", keys: subscription("x").keys }
  }), (err) => err instanceof PushStoreError && err.status === 400);
  await assert.rejects(() => saveSubscription(db, {
    orgId: ORG, clientId: CLIENT_A, accountId: ACCOUNT_A, env: ENV,
    subscription: { endpoint: subscription("x").endpoint, keys: { p256dh: "AAAA", auth: subscription("x").keys.auth } }
  }), (err) => err instanceof PushStoreError && err.status === 400);
  assert.equal(db.rows.length, 0);
});

// ── turning off ─────────────────────────────────────────────────────────────

async function threeDevices() {
  const db = fakePushDb();
  await save(db, { client: CLIENT_A, account: ACCOUNT_A, name: "a-phone" });
  await save(db, { client: CLIENT_A, account: ACCOUNT_A, name: "a-laptop", label: "desktop" });
  await save(db, { client: CLIENT_B, account: ACCOUNT_B, name: "b-phone" });
  return db;
}

test("turning off a device turns off exactly that device and the screen count drops by one", async () => {
  const db = await threeDevices();
  const retired = await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("a-phone").endpoint });
  assert.equal(retired, 1);
  const phone = db.rows.find((r) => r.endpoint_hash === endpointHash(subscription("a-phone").endpoint));
  const laptop = db.rows.find((r) => r.endpoint_hash === endpointHash(subscription("a-laptop").endpoint));
  assert.notEqual(phone.revoked_at, null, "the device that was switched off is off");
  assert.equal(laptop.revoked_at, null, "the client's other device stays on");
  assert.equal(liveRows(db, CLIENT_B).length, 1, "another client's device stays on");
  const shown = await listSubscriptionsForClient(db, { orgId: ORG, clientId: CLIENT_A });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].device_label, "desktop");
  assert.equal("encrypted_endpoint" in shown[0], false, "the screen read carries no key material");
});

test("a switched-off device is no longer reachable by the send path, and the live one still opens", async () => {
  const db = await threeDevices();
  await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("a-phone").endpoint });
  const reachable = await listLiveSubscriptions(db, { orgId: ORG, clientId: CLIENT_A, env: ENV });
  assert.equal(reachable.length, 1);
  assert.equal(reachable[0].endpoint, subscription("a-laptop").endpoint);
  assert.equal(reachable[0].keys.auth, subscription("a-laptop").keys.auth);
});

test("turning off a device that belongs to somebody else turns nothing off", async () => {
  const db = await threeDevices();
  const retired = await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("b-phone").endpoint });
  assert.equal(retired, 0);
  assert.equal(liveRows(db, CLIENT_B).length, 1);
  assert.equal(liveRows(db, CLIENT_A).length, 2);
});

test("turning off twice is fine: the second says zero and the first time is kept", async () => {
  const db = await threeDevices();
  await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("a-phone").endpoint });
  const row = db.rows.find((r) => r.endpoint_hash === endpointHash(subscription("a-phone").endpoint));
  const firstTime = row.revoked_at;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const again = await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("a-phone").endpoint });
  assert.equal(again, 0);
  assert.equal(row.revoked_at, firstTime);
});

test("turn everything off turns off every live device of that client and nobody else's", async () => {
  const db = await threeDevices();
  const retired = await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, all: true });
  assert.equal(retired, 2);
  assert.equal(liveRows(db, CLIENT_A).length, 0);
  assert.equal(liveRows(db, CLIENT_B).length, 1);
});

test("a device can be turned on again after it was turned off", async () => {
  const db = await threeDevices();
  await revokeSubscription(db, { orgId: ORG, clientId: CLIENT_A, endpoint: subscription("a-phone").endpoint });
  const again = await save(db, { client: CLIENT_A, account: ACCOUNT_A, name: "a-phone" });
  assert.equal(again.created, true);
  assert.equal(liveRows(db, CLIENT_A).length, 2);
});
