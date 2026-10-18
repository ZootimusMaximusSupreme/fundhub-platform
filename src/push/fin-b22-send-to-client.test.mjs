// Finish-853 batch 22 (flow lane): the client push sender, over fake data.
//
// This is a PRACTICE TEST of src/push/send.mjs, src/push/store.mjs and src/messaging/providers/web-push.mjs.
// It runs the real sender, the real store and the real provider. Three things are stood in:
//   * the database is an in-memory SQLite that holds the real client_push_subscriptions columns
//     (fin-b22-sql-kit.mjs), with the two column defaults the real table has put back by hand;
//   * the push service is a function that records each request and answers a status word;
//   * the browsers are fresh P-256 key pairs made here, so every body the sender posts is decrypted again
//     with the device's own key and read as the device would read it.
// The VAPID pair, the storage key and every device key are generated at run time. No real endpoint is called.
//
// The sibling test src/http/push-endpoints.pg.test.mjs runs the same sender against a real Postgres and
// skips with no DATABASE_URL, so it proves nothing on a laptop. This one always runs.
//
// The trigger-to-device case below starts with a gated SMS, lets the real
// dispatcher send it, and decrypts the companion push delivered by the real
// web sender. The Flow lane's live check reads the device's delivery record.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { sendToClient } from "./send.mjs";
import { dispatchOne, OUTCOME } from "../messaging/dispatch.mjs";
import { saveSubscription, revokeSubscription, endpointHash } from "./store.mjs";
import { b64u, generateVapidKeys, decryptPayload } from "./crypto.mjs";
import { APPROVED_BODIES } from "./payload.mjs";
import { makeStandIn, REPO_ROOT } from "../pulse/catalog/proofs/fin-b22-sql-kit.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CLIENT = "33333333-3333-4333-8333-333333333333";
const NEIGHBOR = "44444444-4444-4444-8444-444444444444";

const vapid = generateVapidKeys();
const ENV = Object.freeze({
  MESSAGING_DRY_RUN: "0",
  PUSH_SUB_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: "mailto:ops@fundhub-client.test.io",
});

/** A browser: a subscription the page would hand over, plus the private halves to read what arrives. */
function browser(tag) {
  const ua = crypto.createECDH("prime256v1");
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    endpoint: `https://push.fundhub-client.test.io/wpush/${tag}-${crypto.randomBytes(5).toString("hex")}`,
    keys: { p256dh: b64u(ua.getPublicKey()), auth: b64u(auth) },
    privateKey: b64u(ua.getPrivateKey()),
    authSecret: b64u(auth),
  };
}

/**
 * A fresh stand-in database with the table's own defaults (failure_count 0, created_at now()) put back,
 * plus the push service. `answers` maps an endpoint to a status (default 201).
 */
function world(answers = {}) {
  const kit = makeStandIn(["client_push_subscriptions"]);
  kit.db.function("now", () => new Date().toISOString());
  const handle = kit.handle();
  const db = {
    async query(sql, params = []) {
      const out = await handle.query(sql, params);
      if (/^\s*INSERT INTO client_push_subscriptions/i.test(sql)) {
        kit.db.exec(`UPDATE client_push_subscriptions
                        SET failure_count = COALESCE(failure_count, 0),
                            created_at = COALESCE(created_at, '${new Date().toISOString()}')`);
      }
      return out;
    },
  };
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const status = typeof answers === "function" ? answers(url) : (answers[url] ?? 201);
    return new Response("", { status });
  };
  const rows = (where = "1 = 1", params = []) => kit.all(`SELECT * FROM client_push_subscriptions WHERE ${where}`, params);
  const rowFor = (b) => rows("endpoint_hash = $1", [endpointHash(b.endpoint)])[0];
  async function register(b, { clientId = CLIENT, orgId = ORG, label = "iphone" } = {}) {
    return saveSubscription(db, { orgId, clientId, subscription: { endpoint: b.endpoint, keys: b.keys }, deviceLabel: label, env: ENV });
  }
  const send = (over = {}) => sendToClient(db, {
    orgId: ORG, clientId: CLIENT, notification: { kind: "check_in" }, env: ENV, fetchImpl, ...over,
  });
  return { kit, db, calls, rows, rowFor, register, send, fetchImpl, close: () => kit.close() };
}

const header = (call, name) => {
  const h = call.init.headers || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? h[key] : undefined;
};

/** What the device would show: the request body decrypted with that device's own keys. */
const shown = (call, b) => JSON.parse(decryptPayload(Buffer.from(call.init.body), { privateKey: b.privateKey, authSecret: b.authSecret }).toString("utf8"));

describe("one notification goes to every device a client has on file", () => {
  test("three devices are each sent to, each body is readable only by its own device, and each row is stamped", async () => {
    const w = world();
    const phone = browser("phone"), laptop = browser("laptop"), tablet = browser("tablet");
    for (const [b, label] of [[phone, "iphone"], [laptop, "desktop"], [tablet, "ipad"]]) await w.register(b, { label });

    const out = await w.send();
    assert.deepEqual({ attempted: out.attempted, sent: out.sent, expired: out.expired, failed: out.failed },
      { attempted: 3, sent: 3, expired: 0, failed: 0 });
    assert.equal(w.calls.length, 3, "one request per device");
    assert.deepEqual(new Set(w.calls.map((c) => c.url)), new Set([phone.endpoint, laptop.endpoint, tablet.endpoint]));

    for (const b of [phone, laptop, tablet]) {
      const call = w.calls.find((c) => c.url === b.endpoint);
      assert.equal(call.init.method, "POST");
      assert.equal(header(call, "Content-Encoding"), "aes128gcm", "the encoding is named in a header or the browser drops it");
      assert.equal(header(call, "TTL"), String(4 * 60 * 60), "held four hours for a phone that is off");
      assert.match(header(call, "Authorization"), /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/, "signed with our VAPID key");
      const note = shown(call, b);
      assert.equal(note.kind, "check_in");
      assert.equal(note.body, APPROVED_BODIES.check_in, "the approved sentence, nothing of the client's");
      // another device's key cannot read it
      const stranger = [phone, laptop, tablet].find((o) => o !== b);
      assert.throws(() => shown(call, stranger), "a body is encrypted for one device");
      // and the row says it was reached
      const row = w.rowFor(b);
      assert.ok(row.last_success_at, "last_success_at is stamped");
      assert.equal(row.failure_count, 0);
      assert.equal(row.expired_at, null);
    }
    w.close();
  });

  test("the answer names every device by row id and status, and carries no endpoint and no key", async () => {
    const w = world();
    const a = browser("a"), b = browser("b");
    await w.register(a); await w.register(b);
    const out = await w.send();
    assert.equal(out.results.length, 2);
    for (const r of out.results) {
      assert.equal(r.status, "sent");
      assert.equal(r.error, null);
      assert.ok(r.subscriptionId);
    }
    const text = JSON.stringify(out);
    for (const secret of [a.endpoint, b.endpoint, a.keys.p256dh, a.keys.auth, b.keys.p256dh, b.keys.auth, ENV.VAPID_PRIVATE_KEY]) {
      assert.equal(text.includes(secret), false, "no endpoint or key leaves the sender");
    }
    w.close();
  });

  test("a client with no device on file is an honest answer: nothing is sent and the reason is named", async () => {
    const w = world();
    const out = await w.send();
    assert.equal(out.attempted, 0);
    assert.equal(out.sent, 0);
    assert.equal(out.reason, "no_subscription_on_file");
    assert.equal(w.calls.length, 0);
    w.close();
  });

  test("only this client's live devices are sent to: another client, another company, a retired and a turned-off device are left alone", async () => {
    const w = world();
    const mine = browser("mine"), neighbor = browser("neighbor"), foreign = browser("foreign"), off = browser("off"), gone = browser("gone");
    await w.register(mine);
    await w.register(neighbor, { clientId: NEIGHBOR });
    await w.register(foreign, { orgId: OTHER_ORG });
    await w.register(off);
    await revokeSubscription(w.db, { orgId: ORG, clientId: CLIENT, endpoint: off.endpoint });
    await w.register(gone);
    w.kit.db.exec(`UPDATE client_push_subscriptions SET expired_at = '2026-10-01T00:00:00.000Z' WHERE endpoint_hash = '${endpointHash(gone.endpoint)}'`);

    const out = await w.send();
    assert.equal(out.attempted, 1);
    assert.deepEqual(w.calls.map((c) => c.url), [mine.endpoint]);
    w.close();
  });
});

describe("a push service that says a device is gone retires it, and the rest still go out", () => {
  test("410 retires the row in the same pass, keeps it as history, and a client who turned it off is a different fact", async () => {
    const w = world();
    const dead = browser("dead"), live = browser("live");
    await w.register(dead); await w.register(live);
    const w2 = world({ [dead.endpoint]: 410 });
    await w2.register(dead); await w2.register(live);

    const out = await w2.send();
    assert.deepEqual({ attempted: out.attempted, sent: out.sent, expired: out.expired, failed: out.failed },
      { attempted: 2, sent: 1, expired: 1, failed: 0 });
    const deadRow = w2.rowFor(dead);
    assert.ok(deadRow.expired_at, "expired_at is stamped");
    assert.equal(deadRow.revoked_at, null, "a dead phone is not the client asking us to stop");
    assert.ok(w2.rowFor(live).last_success_at, "the other device was still reached");
    assert.equal(out.results.find((r) => r.status === "expired").error.includes("gone"), true);

    // the next one never tries the dead device again
    w2.calls.length = 0;
    const again = await w2.send();
    assert.equal(again.attempted, 1);
    assert.deepEqual(w2.calls.map((c) => c.url), [live.endpoint]);
    w.close(); w2.close();
  });

  test("404 is just as gone as 410", async () => {
    const dead = browser("dead404");
    const w = world({ [dead.endpoint]: 404 });
    await w.register(dead);
    const out = await w.send();
    assert.equal(out.expired, 1);
    assert.equal(out.failed, 0);
    assert.ok(w.rowFor(dead).expired_at);
    w.close();
  });
});

describe("a push service having a bad hour keeps the device and counts it", () => {
  test("503 adds one failure, keeps the row live, and a later success clears the count", async () => {
    const b = browser("flaky");
    let status = 503;
    const w = world(() => status);
    await w.register(b);

    // reached once, so there is a last success to protect
    status = 201;
    await w.send();
    const stamped = w.rowFor(b).last_success_at;
    assert.ok(stamped);

    status = 503;
    for (let n = 1; n <= 3; n += 1) {
      const out = await w.send();
      assert.equal(out.failed, 1);
      assert.equal(out.expired, 0);
      assert.equal(w.rowFor(b).failure_count, n, "one more failure each time");
      assert.equal(w.rowFor(b).expired_at, null, "a temporary failure never retires a device");
      assert.equal(w.rowFor(b).last_success_at, stamped, "a failure does not erase the last success");
    }

    status = 201;
    const ok = await w.send();
    assert.equal(ok.sent, 1);
    assert.equal(w.rowFor(b).failure_count, 0, "a success clears the count");
    w.close();
  });

  test("a body the push service finds too large or malformed (400, 413) is not a retired device", async () => {
    for (const status of [400, 413]) {
      const b = browser(`bad${status}`);
      const w = world({ [b.endpoint]: status });
      await w.register(b);
      const out = await w.send();
      assert.equal(out.expired, 0, String(status));
      assert.equal(out.sent, 0);
      assert.equal(out.failed, 1);
      assert.equal(w.rowFor(b).expired_at, null);
      w.close();
    }
  });
});

describe("what may not leave", () => {
  test("a body with a dollar amount is refused before the network, and the device stays on file", async () => {
    const w = world();
    const b = browser("gate");
    await w.register(b);
    const out = await w.send({ notification: { kind: "payment_due", body: "Your $4,200 Amex payment is due Friday." } });
    assert.equal(w.calls.length, 0, "the push service was never called with banned words");
    assert.equal(out.sent, 0);
    assert.equal(out.failed, 1);
    assert.match(out.results[0].error, /locked screen/);
    assert.equal(w.rowFor(b).expired_at, null);
    w.close();
  });

  test("an unknown kind is refused before the network", async () => {
    const w = world();
    await w.register(browser("kind"));
    const out = await w.send({ notification: { kind: "wire_transfer" } });
    assert.equal(w.calls.length, 0);
    assert.equal(out.failed, 1);
    w.close();
  });

  test("a tap target on another site is refused before the network", async () => {
    const w = world();
    await w.register(browser("url"));
    const out = await w.send({ notification: { kind: "update", url: "https://evil.example/pay" } });
    assert.equal(w.calls.length, 0);
    assert.equal(out.failed, 1);
    w.close();
  });

  test("with no VAPID key on the server nothing is sent, no device is retired, and the variable is named, not its value", async () => {
    const w = world();
    const b = browser("novapid");
    await w.register(b);
    const { VAPID_PRIVATE_KEY, ...partial } = ENV;
    const out = await w.send({ env: partial });
    assert.equal(w.calls.length, 0);
    assert.equal(out.failed, 1);
    assert.equal(out.expired, 0);
    assert.match(out.results[0].error, /VAPID_PRIVATE_KEY/);
    assert.equal(JSON.stringify(out).includes(vapid.privateKey), false);
    assert.equal(w.rowFor(b).expired_at, null);
    w.close();
  });

  test("the fence holds the send when sending is not switched on, and holding it is not a dead device", async () => {
    const w = world();
    const b = browser("fence");
    await w.register(b);
    const out = await w.send({ env: { ...ENV, MESSAGING_DRY_RUN: "1" } });
    assert.equal(w.calls.length, 0, "nothing left the process");
    assert.equal(out.sent, 0);
    assert.equal(out.expired, 0);
    assert.equal(w.rowFor(b).expired_at, null);
    w.close();
  });
});

describe("storage", () => {
  test("the endpoint and both keys are ciphertext at rest, bound to their own row", async () => {
    const w = world();
    const b = browser("rest");
    await w.register(b);
    const row = w.rowFor(b);
    for (const [col, plain] of [["encrypted_endpoint", b.endpoint], ["encrypted_p256dh", b.keys.p256dh], ["encrypted_auth", b.keys.auth]]) {
      assert.match(row[col], /^v1:/, `${col} is versioned ciphertext`);
      assert.equal(String(row[col]).includes(plain), false, `${col} is not the plain value`);
    }
    w.close();
  });

  test("a row that will not decrypt is skipped and the client's other devices still go out", async () => {
    const w = world();
    const good = browser("good"), swapped = browser("swapped");
    await w.register(good); await w.register(swapped);
    // a ciphertext copied from another row fails the row-id binding
    const goodRow = w.rowFor(good);
    w.kit.db.exec(`UPDATE client_push_subscriptions SET encrypted_endpoint = '${goodRow.encrypted_endpoint}' WHERE endpoint_hash = '${endpointHash(swapped.endpoint)}'`);
    const warn = console.warn;
    console.warn = () => {};
    let out;
    try { out = await w.send(); } finally { console.warn = warn; }
    assert.equal(out.attempted, 1, "the bad row is skipped, not thrown");
    assert.deepEqual(w.calls.map((c) => c.url), [good.endpoint]);
    w.close();
  });
});

describe("a real gated message reaches a device", () => {
  test("successful booking SMS sends a private companion alert through the real web sender", async () => {
    const w = world();
    const phone = browser("booking-sms");
    await w.register(phone);
    const writes = [];
    const db = {
      async query(sql, params = []) {
        if (sql.includes("client_push_subscriptions")) return w.db.query(sql, params);
        if (sql.includes("client_authorized_reps")) return { rows: [] };
        if (sql.includes("FROM opt_outs")) return { rows: [] };
        if (sql.includes("FROM compliance_rules")) return { rows: [] };
        if (sql.includes("FROM message_templates")) return { rows: [{ subject: "" }] };
        if (sql.includes("FROM message_channel_routing")) return { rows: [{ provider: "twilio", enabled: true }] };
        if (sql.includes("SELECT id, to_address FROM messages")) return { rows: [] };
        if (sql.includes("SELECT custom_fields FROM clients")) return { rows: [{ custom_fields: {} }] };
        if (sql.includes("FROM tasks")) return { rows: [] };
        if (sql.includes("INSERT INTO tasks")) return { rows: [{ id: "task-1" }] };
        if (sql.includes("UPDATE messages")) { writes.push({ sql, params }); return { rows: [] }; }
        throw new Error(`unexpected dispatch query: ${sql}`);
      }
    };
    const sentSms = [];
    const message = {
      id: "55555555-5555-4555-8555-555555555555", org_id: ORG, client_id: CLIENT,
      channel: "sms", template_key: "SMS-S04-01-CONFIRM", to_address: "+15551234567",
      rendered_body: "Please confirm your Fundhub call in the client portal.",
      provider_ref: "test:booking-confirm", attempts: 1
    };
    const env = {
      ...ENV,
      TWILIO_SEND_ACCOUNT_SID: "ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      TWILIO_SEND_AUTH_TOKEN: "test-auth-token",
      TWILIO_SEND_FROM: "+15550001111",
      UNSUBSCRIBE_TOKEN_SECRET: "test-secret-0123456789abcdef0123456789abcdef"
    };
    const result = await dispatchOne(db, message, {
      env, now: () => new Date("2026-10-17T16:00:00Z"),
      fetchImpl: async (url, init) => {
        sentSms.push({ url, init });
        return { ok: true, status: 201, text: async () => JSON.stringify({ sid: "SMbooking" }) };
      },
      sendWeb: (pushDb, target) => sendToClient(pushDb, { ...target, fetchImpl: w.fetchImpl })
    });
    assert.equal(result.outcome, OUTCOME.SENT);
    assert.equal(sentSms.length, 1, "the SMS really went through the provider stub");
    assert.ok(writes.some(({ sql }) => /status = 'sent'/.test(sql)), "the SMS was recorded as sent first");
    assert.equal(w.calls.length, 1, "one encrypted push went to the registered device");
    assert.equal(shown(w.calls[0], phone).kind, "call_confirmation");
    assert.equal(w.rowFor(phone).failure_count, 0);
    assert.ok(w.rowFor(phone).last_success_at);
    w.close();
  });
});

// ── the caller guard ─────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "_next", ".claude", "docs", "ops", "marketing", "assets"]);
const CODE = /\.(?:mjs|js|ts|tsx|cjs)$/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (CODE.test(entry.name) && !/\.test\.mjs$/.test(entry.name)) out.push(full);
  }
  return out;
}

function importersOf(target) {
  const wanted = path.resolve(REPO_ROOT, target);
  const found = [];
  const spec = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;
  for (const dir of ["src", "api", "netlify", "scripts", "public"]) {
    const root = path.join(REPO_ROOT, dir);
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(spec)) {
        if (!m[1].startsWith(".")) continue;
        if (path.resolve(path.dirname(file), m[1]) === wanted) found.push(path.relative(REPO_ROOT, file));
      }
    }
  }
  return found.sort();
}

describe("who calls the sender", () => {
  test("the dispatcher and the hand-run script call sendToClient; only the sender calls the provider", () => {
    assert.deepEqual(importersOf("src/push/send.mjs"), ["scripts/push/send-test-push.mjs", "src/messaging/dispatch.mjs"],
      "A new sender caller needs its own trigger-to-device proof and a live-device rule update.");
    // api/push/key.mjs only reads the public VAPID key (vapidConfig); it never calls send().
    assert.deepEqual(importersOf("src/messaging/providers/web-push.mjs"),
      ["api/push/key.mjs", "scripts/push/send-test-push.mjs", "src/push/send.mjs"],
      "the web push provider has a new importer. It is the only place a notification leaves; name the new caller.");
  });

  test("the scanner sees a real importer (it is not passing by finding nothing)", () => {
    assert.ok(importersOf("src/push/store.mjs").includes("src/push/send.mjs"));
  });
});
