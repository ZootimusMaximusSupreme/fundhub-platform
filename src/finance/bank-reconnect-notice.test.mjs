// "Your bank connection needs a quick reconnect" — the one text per error episode.
// Stubbed database (plaid-fake-db.mjs), a stand-in for sendTemplated and a stand-in
// Plaid; NOTHING HERE QUEUES A MESSAGE, REACHES THE NETWORK OR A DATABASE.
//
// What these tests guard:
//   * a client texted every morning for the same broken login;
//   * a client NOT texted when the login breaks a second time months later;
//   * a text about a bank that is only down, or that Plaid cannot repair;
//   * a text to someone who never bought FinanceOS or the Blueprint;
//   * a text marked as sent when it was refused (opted out, template not approved),
//     so the client is never told;
//   * the text going out BEFORE the Reconnect screen exists: it says "tap Reconnect",
//     so migration 474 seeds it NOT approved, and the real sendTemplated refuses it;
//   * the template and the sentence the code stores drifting apart.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  queueReconnectNotices, planReconnectNotice, isNoticeAudience, bankName, TEMPLATE_KEY, DEFAULT_LIMIT
} from "./bank-reconnect-notice.mjs";
import { finishRelink } from "../banking/plaid-relink.mjs";
import { refreshClientAccounts } from "../banking/plaid-refresh.mjs";
import { encryptPlaidToken } from "../banking/plaid.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "../banking/plaid-fake-db.mjs";
import { NOTIFY_CODES } from "../banking/plaid-item-errors.mjs";
import { renderTemplate } from "../lib/render-template.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { FINANCE_OS_TIER } from "./finance-os-entitlement.mjs";
import { PAID_TRANSACTION_STATUS } from "../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_ENV: "sandbox", ADAPTERS_DRY_RUN: "0",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64")
});
const ORG = "00000000-0000-0000-0000-0000000000aa";
const CLIENT = "00000000-0000-0000-0000-0000000000cc";
const CLIENT_2 = "00000000-0000-0000-0000-0000000000c2";
const ITEM_A = "00000000-0000-0000-0000-0000000000a1";
const ITEM_B = "00000000-0000-0000-0000-0000000000b1";
const ITEM_C = "00000000-0000-0000-0000-0000000000c1";
const TOKEN = "access-sandbox-secret-A";
const NOW = new Date("2026-10-07T07:00:00.000Z");
const STOP = " Reply STOP to opt out.";

const login = ({ id = ITEM_A, plaidItemId = "item-" + id.slice(-2), clientId = CLIENT, code = "ITEM_LOGIN_REQUIRED", at = "2026-10-07T06:59:50.000Z", ...over } = {}) => ({
  id, org_id: ORG, client_id: clientId, plaid_item_id: plaidItemId, institution_name: "First Platypus Bank",
  encrypted_access_token: encryptPlaidToken(TOKEN, { itemId: plaidItemId, env: ENV }),
  consent_granted_at: "2026-09-20T10:00:00.000Z", created_at: "2026-09-20T10:00:00.000Z",
  link_state: "error", last_error_code: code, last_error_at: at, ...over
});

/** sendTemplated stand-in. Records every call; dedupes on provider_ref the way the real
 *  one does, so a replay returns the same message id instead of a second row. */
function sender(answer = null) {
  const calls = [];
  const rows = new Map();
  const send = async (_conn, args) => {
    calls.push(args);
    if (answer) {
      const a = typeof answer === "function" ? answer(args) : answer;
      if (a) return a;
    }
    const ref = `workflow:${args.templateKey}:${args.eventId}`;
    if (!rows.has(ref)) rows.set(ref, `msg-${rows.size + 1}`);
    return { sent: true, messageId: rows.get(ref) };
  };
  return { send, calls, rows };
}

const everyone = async () => true;
const pass = (db, over = {}) => queueReconnectNotices(db, { now: NOW, isEntitled: everyone, ...over });

describe("what the text says", () => {
  test("the bank's own name, with the sandbox label off, and 'bank' when it is not known", () => {
    assert.equal(bankName("Chase"), "Chase");
    assert.equal(bankName("First Platypus Bank (Plaid sandbox — test data)"), "First Platypus Bank");
    assert.equal(bankName("Plaid bank (Plaid sandbox — test data)"), "Plaid bank");
    for (const v of [null, undefined, "", "   ", "(Plaid sandbox — test data)", 42]) assert.equal(bankName(v), "bank", String(v));
    assert.ok(bankName("A".repeat(200)).length <= 60, "one SMS, not three");
  });

  test("the sentence is the task's own: your <bank> connection needs a quick reconnect in FinanceOS", () => {
    const p = planReconnectNotice(login());
    assert.equal(p.send, true);
    assert.equal(p.body, "Fundhub alert: your First Platypus Bank connection needs a quick reconnect in FinanceOS. Open FinanceOS and tap Reconnect.");
    assert.deepEqual(p.context, { bank: { name: "First Platypus Bank" } });
    assert.doesNotMatch(p.body, /FundHub|Fund Hub|FUNDHUB/);
  });

  test("only the codes a reconnect fixes are texted — not a bank that is down, not a login Plaid cannot repair, not a code nobody mapped", () => {
    for (const code of ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "USER_SETUP_REQUIRED", "PASSWORD_RESET_REQUIRED", "ITEM_LOCKED"]) {
      assert.equal(planReconnectNotice(login({ code })).send, true, code);
    }
    for (const [code, reason] of [
      ["INSTITUTION_DOWN", "not_a_reconnect_code"], ["ACCOUNTS_LIMIT", "not_a_reconnect_code"],
      ["PRODUCT_NOT_READY", "not_a_reconnect_code"], ["ITEM_NOT_FOUND", "not_a_reconnect_code"],
      ["NO_ACCOUNTS", "not_a_reconnect_code"], ["SOME_NEW_CODE", "unknown_code"], [null, "unknown_code"]
    ]) {
      const p = planReconnectNotice(login({ code }));
      assert.equal(p.send, false, String(code));
      assert.equal(p.reason, reason, String(code));
    }
  });

  test("the eventId is the login plus the instant its error was recorded: stable for one episode, new for the next", () => {
    const a = planReconnectNotice(login({ at: "2026-10-07T06:59:50.000Z" }));
    assert.equal(planReconnectNotice(login({ at: "2026-10-07T06:59:50.000Z" })).eventId, a.eventId, "a retried pass lands on the same message");
    assert.equal(planReconnectNotice(login({ at: new Date("2026-10-07T06:59:50.000Z") })).eventId, a.eventId, "a Date and its ISO string agree");
    const later = planReconnectNotice(login({ at: "2026-12-01T06:59:50.000Z" }));
    assert.notEqual(later.eventId, a.eventId, "a second break is a second episode");
    assert.notEqual(planReconnectNotice(login({ id: ITEM_B })).eventId, a.eventId, "another login, another text");
    assert.match(a.eventId, new RegExp(`^reconnect:${ITEM_A}:\\d+$`));
    // No error time: the row's own updated_at stands in, then "na" — never a crash.
    assert.match(planReconnectNotice(login({ at: null, updated_at: "2026-10-07T06:00:00.000Z" })).eventId, /:\d+$/);
    assert.match(planReconnectNotice(login({ at: null })).eventId, /:na$/);
  });
});

describe("once per error episode", () => {
  test("a broken login is texted ONCE and the marker is set — the next morning's pass sends nothing", async () => {
    const db = fakeBankDb({ items: [login()] });
    const s = sender();
    const first = await pass(db, { send: s.send });
    assert.equal(first.checked, 1);
    assert.equal(first.queued, 1);
    assert.equal(s.calls.length, 1);
    assert.deepEqual(
      { orgId: s.calls[0].orgId, clientId: s.calls[0].clientId, channel: s.calls[0].channel, templateKey: s.calls[0].templateKey, context: s.calls[0].context },
      { orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: "SMS-FINANCE-OS-RECONNECT", context: { bank: { name: "First Platypus Bank" } } }
    );
    assert.equal(db.state.items[0].reconnect_notified_at, NOW.toISOString());

    for (let day = 0; day < 5; day += 1) {
      const again = await pass(db, { send: s.send });
      assert.equal(again.checked, 0, "a texted login is not even a candidate");
      assert.equal(again.queued, 0);
    }
    assert.equal(s.calls.length, 1, "texted again for the same broken login");
  });

  test("a client who FIXES it and later breaks it again is texted once more — a new episode", async () => {
    const db = fakeBankDb({ items: [login()] });
    const s = sender();
    await pass(db, { send: s.send });
    assert.equal(s.calls.length, 1);

    // The client reconnects: finishRelink reads the bank, and only that clears the marker.
    const fixed = await finishRelink(db, {
      orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, asOf: "2026-10-08T12:00:00.000Z", env: ENV,
      fetchImpl: stubPlaid({ [TOKEN]: [plaidAccount({ id: "p1" })] }).fetch
    });
    assert.equal(fixed.ok, true);
    assert.equal(db.state.items[0].reconnect_notified_at, null);
    assert.equal((await pass(db, { send: s.send })).checked, 0, "an active login is nobody's business");

    // Months later the bank asks for the login again. The daily refresh sees it first.
    let clock = new Date("2026-12-01T07:00:00.000Z");
    const dbLater = fakeBankDb({ items: [db.state.items[0]], now: () => clock });
    await refreshClientAccounts(dbLater, {
      orgId: ORG, clientId: CLIENT, env: ENV, asOf: clock.toISOString(),
      fetchImpl: stubPlaid({ [TOKEN]: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in" } }).fetch
    });
    assert.equal(dbLater.state.items[0].link_state, "error");

    const second = await pass(dbLater, { send: s.send, now: clock });
    assert.equal(second.queued, 1, "the second break was never told to the client");
    assert.equal(s.calls.length, 2);
    assert.notEqual(s.calls[0].eventId, s.calls[1].eventId, "the same eventId would have deduped into the first message");
    assert.equal(s.rows.size, 2, "two episodes, two messages");
  });

  test("a client who tries to fix it and FAILS is not texted again", async () => {
    const db = fakeBankDb({ items: [login()] });
    const s = sender();
    await pass(db, { send: s.send });
    assert.equal(s.calls.length, 1);

    const tried = await finishRelink(db, {
      orgId: ORG, clientId: CLIENT, itemRowId: ITEM_A, asOf: "2026-10-08T12:00:00.000Z", env: ENV,
      fetchImpl: stubPlaid({ [TOKEN]: { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in" } }).fetch
    });
    assert.equal(tried.ok, false);
    assert.equal(tried.reason, "still_needs_reconnect");
    assert.ok(db.state.items[0].reconnect_notified_at, "the failed try cleared the marker");

    const next = await pass(db, { send: s.send });
    assert.equal(next.checked, 0);
    assert.equal(s.calls.length, 1, "a failed try started a new episode");
  });

  test("a pass that dies between the text and the marker is picked up by the next one — and lands on the SAME message", async () => {
    const db = fakeBankDb({ items: [login()] });
    const s = sender();
    // The first pass queues the text, then the marker write fails.
    const failing = { state: db.state, calls: db.calls, query: (sql, p) => (/reconnect:stamp/.test(sql) ? Promise.reject(new Error("db blip")) : db.query(sql, p)) };
    const first = await pass(failing, { send: s.send });
    assert.equal(first.queued, 0);
    assert.equal(first.errored.length, 1);
    assert.equal(db.state.items[0].reconnect_notified_at, null);

    const second = await pass(db, { send: s.send });
    assert.equal(second.queued, 1);
    assert.equal(s.calls.length, 2);
    assert.equal(s.calls[0].eventId, s.calls[1].eventId, "the retry must carry the same key");
    assert.equal(s.rows.size, 1, "one message row, not two");
    assert.equal(db.state.items[0].reconnect_notified_at, NOW.toISOString());
  });
});

describe("who is texted", () => {
  test("a client who is not a FinanceOS subscriber or a Blueprint buyer is not texted, and nothing is marked", async () => {
    const db = fakeBankDb({ items: [login()] });
    const s = sender();
    const r = await pass(db, { send: s.send, isEntitled: async () => false });
    assert.equal(r.checked, 1);
    assert.equal(r.notEntitled, 1);
    assert.equal(r.queued, 0);
    assert.equal(s.calls.length, 0);
    assert.equal(db.state.items[0].reconnect_notified_at, null, "if they subscribe while the login is still broken, they are texted then");

    const later = await pass(db, { send: s.send });
    assert.equal(later.queued, 1);
  });

  test("entitlement is asked once per client per pass, and is the audience's, not the item's", async () => {
    const db = fakeBankDb({
      items: [
        login({ id: ITEM_A }), login({ id: ITEM_B }),
        login({ id: ITEM_C, clientId: CLIENT_2 })
      ]
    });
    const asked = [];
    const s = sender();
    const r = await pass(db, {
      send: s.send,
      isEntitled: async (_c, a) => { asked.push(a.clientId); return a.clientId === CLIENT; }
    });
    assert.deepEqual(asked.sort(), [CLIENT, CLIENT_2].sort(), "two clients, two questions — not three");
    assert.equal(r.queued, 2, "both of the entitled client's logins are texted");
    assert.equal(r.notEntitled, 1);
  });

  test("the audience is a finance-os subscriber OR a paid Blueprint buyer — the same two the file-protection alerts use", async () => {
    const answer = ({ subscription, blueprint }) => ({
      async query(sql) {
        if (/FROM subscriptions/.test(sql)) return { rows: subscription ? [{ id: "sub-1" }] : [] };
        if (/FROM transactions t/.test(sql)) return { rows: blueprint ? [{ "?column?": 1 }] : [] };
        throw new Error(`unexpected statement: ${sql.slice(0, 60)}`);
      }
    });
    const ask = (flags) => isNoticeAudience(answer(flags), { orgId: ORG, clientId: CLIENT, now: NOW });
    assert.equal(await ask({ subscription: true, blueprint: false }), true);
    assert.equal(await ask({ subscription: false, blueprint: true }), true);
    assert.equal(await ask({ subscription: false, blueprint: false }), false);
  });

  test("a login with no consent, a practice login or one with no credential is never a candidate", async () => {
    const db = fakeBankDb({
      items: [
        login({ id: ITEM_A, consent_granted_at: null }),
        login({ id: ITEM_B, plaidItemId: "mock:" + CLIENT }),
        login({ id: ITEM_C, encrypted_access_token: null })
      ]
    });
    const r = await pass(db, { send: sender().send });
    assert.equal(r.checked, 0);
  });

  test("a login that is not in 'error' is never a candidate", async () => {
    const db = fakeBankDb({ items: [login({ link_state: "active", last_error_code: null })] });
    assert.equal((await pass(db, { send: sender().send })).checked, 0);
  });

  test("the candidate QUERY keeps non-paying and opted-out clients out, so they cannot fill the batch and starve a paying client", async () => {
    const db = fakeBankDb({ items: [login()] });
    await pass(db, { send: sender().send });
    const cand = db.calls.find((q) => /reconnect:candidates/.test(q.sql));
    // Same predicates the lane (gap-bank-relink.mjs) uses; its test fails if the two drift.
    assert.match(cand.sql, /NOT EXISTS \(\s*SELECT 1 FROM opt_outs o\s+WHERE o\.client_id = i\.client_id AND o\.channel = 'sms' AND o\.opted_in_at IS NULL/);
    assert.match(cand.sql, /FROM subscriptions s[\s\S]*s\.tier = \$4::text AND s\.status = 'active'/);
    assert.match(cand.sql, /FROM transactions t[\s\S]*resolve_product_id\(t\.org_id, t\.product_name\)/);
    // The batch limit is still $2: "the batch is bounded" below reads params[1].
    assert.deepEqual(cand.params, [
      [...NOTIFY_CODES], DEFAULT_LIMIT, NOW.toISOString(), FINANCE_OS_TIER, BLUEPRINT_PRODUCT_CODE, PAID_TRANSACTION_STATUS
    ]);
    const used = [...cand.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    assert.equal(Math.max(...used), cand.params.length, "every parameter the query names is bound, and none is left over");
    assert.deepEqual([...new Set(used)].sort(), ["1", "2", "3", "4", "5", "6"].map(Number).sort());
  });

  test("logins whose code a reconnect cannot fix are not candidates — and cannot crowd the others out of a batch", async () => {
    const db = fakeBankDb({
      items: [
        login({ id: "00000000-0000-0000-0000-0000000000e1", code: "ITEM_NOT_FOUND", at: "2026-10-01T00:00:00.000Z" }),
        login({ id: "00000000-0000-0000-0000-0000000000e2", code: "INSTITUTION_DOWN", at: "2026-10-02T00:00:00.000Z" }),
        login({ id: ITEM_A })
      ]
    });
    const s = sender();
    const r = await pass(db, { send: s.send, limit: 1 });
    assert.equal(r.checked, 1);
    assert.equal(r.queued, 1, "the one fixable login got its text even with a batch of one");
    assert.equal(s.calls[0].eventId.startsWith(`reconnect:${ITEM_A}:`), true);
  });
});

describe("a text that could not be queued is not marked as sent", () => {
  for (const reason of ["opted_out", "template_pending", "draft_template"]) {
    test(`${reason}: nothing is marked, it is reported, and the next pass tries again`, async () => {
      const db = fakeBankDb({ items: [login()] });
      const refused = sender({ sent: false, reason });
      const first = await pass(db, { send: refused.send });
      assert.equal(first.queued, 0);
      assert.deepEqual(first.notQueued, [{ itemRowId: ITEM_A, reason }]);
      assert.equal(db.state.items[0].reconnect_notified_at, null, "marked sent, so the client was never told");

      const ok = sender();
      const second = await pass(db, { send: ok.send });
      assert.equal(second.queued, 1, "they opted back in / the template was approved while the login was still broken");
    });
  }

  test("a send that returns nothing at all is also a refusal", async () => {
    const db = fakeBankDb({ items: [login()] });
    const r = await pass(db, { send: async () => undefined });
    assert.equal(r.queued, 0);
    assert.equal(r.notQueued[0].reason, "not_sent");
    assert.equal(db.state.items[0].reconnect_notified_at, null);
  });
});

describe("one login never stops the next", () => {
  test("a send that throws is recorded, and the other logins are still texted", async () => {
    const db = fakeBankDb({
      items: [
        login({ id: ITEM_A, at: "2026-10-07T06:00:00.000Z" }),
        login({ id: ITEM_B, at: "2026-10-07T06:01:00.000Z", clientId: CLIENT_2 })
      ]
    });
    const s = sender((args) => {
      if (args.clientId === CLIENT) throw new Error("template store down");
      return null;
    });
    const r = await pass(db, { send: s.send });
    assert.equal(r.checked, 2);
    assert.equal(r.queued, 1);
    assert.deepEqual(r.errored.map((e) => [e.itemRowId, e.error]), [[ITEM_A, "template store down"]]);
    assert.equal(db.state.items.find((i) => i.id === ITEM_B).reconnect_notified_at, NOW.toISOString());
    assert.equal(db.state.items.find((i) => i.id === ITEM_A).reconnect_notified_at, null, "the failed one is retried tomorrow");
  });

  test("a code nobody mapped, if one ever reached a candidate, is skipped with its reason", async () => {
    // The query only returns notifiable codes; this is the second guard, in the planner.
    const db = {
      async query(sql) {
        if (/reconnect:candidates/.test(sql)) return { rows: [login({ code: "SOME_NEW_CODE" })] };
        throw new Error("nothing else should run");
      }
    };
    const r = await pass(db, { send: async () => assert.fail("must not text") });
    assert.deepEqual(r.skipped, [{ itemRowId: ITEM_A, reason: "unknown_code" }]);
    assert.equal(r.queued, 0);
  });

  test("the batch is bounded", async () => {
    assert.equal(DEFAULT_LIMIT, 200);
    const seen = [];
    const db = { async query(sql, params) { seen.push(params[1]); return { rows: [] }; } };
    await queueReconnectNotices(db, { now: NOW, isEntitled: everyone, send: sender().send });
    await queueReconnectNotices(db, { now: NOW, isEntitled: everyone, send: sender().send, limit: 99999 });
    await queueReconnectNotices(db, { now: NOW, isEntitled: everyone, send: sender().send, limit: -4 });
    await queueReconnectNotices(db, { now: NOW, isEntitled: everyone, send: sender().send, limit: 0 });
    await queueReconnectNotices(db, { now: NOW, isEntitled: everyone, send: sender().send, limit: "lots" });
    assert.deepEqual(seen, [200, 1000, 1, 200, 200], "no limit and nonsense mean the default; too big is capped; negative is at least one");
  });

  test("the candidate query never names the credential column", async () => {
    const db = fakeBankDb({ items: [login()] });
    await pass(db, { send: sender().send });
    for (const q of db.calls) assert.doesNotMatch(q.sql, /encrypted_access_token\s*(,|\n)/);
    const cand = db.calls.find((q) => /reconnect:candidates/.test(q.sql));
    assert.doesNotMatch(cand.sql.replace(/AND i\.encrypted_access_token IS NOT NULL/, ""), /encrypted_access_token/);
  });
});

/* ── migration 474 ───────────────────────────────────────────────────────────── */

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "db", "migrations");
const FILE = "474_bank_reconnect_notice.sql";
const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");
const CODE = SQL.replace(/--.*$/gm, "");

describe("migration 474 — the file", () => {
  test("it is number 474 and nothing else owns 474", () => {
    assert.deepEqual(readdirSync(MIGRATIONS).filter((f) => f.startsWith("474_")), [FILE]);
  });

  test("the manifest the health check compares against lists it", () => {
    assert.ok(EXPECTED_MIGRATIONS.includes(`migrations/${FILE}`), "run npm run migrations:manifest");
  });

  test("it is additive and re-runnable: one nullable column, no default, nothing dropped or rewritten", () => {
    assert.doesNotMatch(CODE, /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT)\b/i);
    assert.doesNotMatch(CODE, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(CODE, /\bTRUNCATE\b/i);
    assert.doesNotMatch(CODE, /\bUPDATE\s+\w+\s+SET\b/i, "no existing row is rewritten");
    assert.match(CODE, /ALTER TABLE plaid_items\s+ADD COLUMN IF NOT EXISTS reconnect_notified_at timestamptz;/);
    const col = /ADD COLUMN IF NOT EXISTS reconnect_notified_at ([^;]*);/.exec(CODE)[1];
    assert.doesNotMatch(col, /NOT NULL|DEFAULT/i, "NULL must mean 'not texted' for every row that already exists");
  });

  test("it touches no credential column and adds none", () => {
    assert.doesNotMatch(CODE, /encrypted_access_token|plaintext|access_token/i);
  });
});

describe("migration 474 — the text", () => {
  const seeded = /'(SMS-FINANCE-OS-RECONNECT)'[\s\S]*?\$c\$([\s\S]*?)\$c\$/.exec(SQL);

  test("the key seeded is the key the code sends", () => {
    assert.ok(seeded, "the template insert is there");
    assert.equal(seeded[1], TEMPLATE_KEY);
  });

  test("seeded as SMS and NOT approved — held until the Reconnect screen ships — and an edited copy is never overwritten", () => {
    assert.match(SQL, /INSERT INTO message_templates \(org_id, template_key, channel, subject, body, compliance_passed\)/);
    assert.match(SQL, /'sms',\s+NULL::text,/);
    // 433, 444 and 471 seed `true`. This one is `false` on purpose: the text tells the client
    // to tap Reconnect, and that button is not built. Flipping it is a new migration, in the
    // same change as the screen.
    assert.match(SQL, /\$c\$[\s\S]*\$c\$,\s+false\s+FROM orgs o\s+ON CONFLICT \(org_id, template_key\) DO NOTHING;/);
  });

  test("the template ends with the opt-out line, spells the company Fundhub, and is not a draft", () => {
    const body = seeded[2];
    assert.ok(body.endsWith(STOP.trim()));
    assert.doesNotMatch(body, /FundHub|Fund Hub|FUNDHUB/);
    assert.equal(isDraftTemplateRow({ body, subject: null }), false, "a draft template would be refused at send time");
  });

  test("RENDERED, it is exactly the sentence the planner stores plus the opt-out line — they cannot drift", () => {
    const body = seeded[2];
    for (const name of ["First Platypus Bank (Plaid sandbox — test data)", "Chase", null, "Wells Fargo Bank, N.A."]) {
      const plan = planReconnectNotice(login({ institution_name: name }));
      assert.equal(renderTemplate(body, plan.context), plan.body + STOP, String(name));
    }
  });

  test("it fits one text for an ordinary bank name", () => {
    const plan = planReconnectNotice(login({ institution_name: "Navy Federal Credit Union" }));
    assert.ok((plan.body + STOP).length <= 160, `${(plan.body + STOP).length} characters`);
  });

  test("the only tag is the one the job supplies", () => {
    assert.deepEqual([...seeded[2].matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]), ["bank.name"]);
  });
});

/* ── held until the Reconnect screen ships ───────────────────────────────────── */

describe("the text is HELD: it says 'tap Reconnect', and that button is not built yet", () => {
  // What the migration seeds, read from the file itself — so this proves 474 and the
  // real sendTemplated together, not a stand-in's idea of either.
  const SEED = /\$c\$([\s\S]*?)\$c\$,\s+(true|false)\s+FROM orgs o/.exec(SQL);
  const BODY = SEED[1];
  const APPROVED = SEED[2] === "true";

  /** A database that holds the one template row 474 seeds, answers the opt-out read
   *  with "not opted out", and RECORDS (and refuses) anything else. */
  function seededDb() {
    const other = [];
    return {
      other,
      async query(sql) {
        if (/FROM opt_outs/.test(sql)) return { rows: [] };
        if (/FROM message_templates/.test(sql)) {
          return { rows: [{ body: BODY, subject: null, compliance_passed: APPROVED }] };
        }
        other.push(String(sql).slice(0, 80));
        throw new Error(`nothing else should run while the text is held: ${String(sql).slice(0, 60)}`);
      }
    };
  }

  test("what 474 seeds, the real sendTemplated refuses: template_pending, and no message row is written", async () => {
    assert.equal(APPROVED, false, "474 must seed the text not approved until the Reconnect screen ships");
    const held = seededDb();
    const r = await sendTemplated(held, {
      orgId: ORG, clientId: CLIENT, channel: "sms", templateKey: TEMPLATE_KEY, eventId: "reconnect:x:1",
      context: { bank: { name: "Chase" } }
    });
    assert.deepEqual(r, { sent: false, reason: "template_pending" });
    assert.deepEqual(held.other, [], "a message, an event or any other write was attempted");
  });

  test("a whole daily pass: nothing queued, nothing written, nobody marked as told, every login still waiting", async () => {
    const db = fakeBankDb({
      items: [
        login({ id: ITEM_A }),
        login({ id: ITEM_B, clientId: CLIENT_2, at: "2026-10-06T06:00:00.000Z" })
      ]
    });
    const held = seededDb();
    const r = await pass(db, { send: (_conn, args) => sendTemplated(held, args) });

    assert.equal(r.checked, 2);
    assert.equal(r.queued, 0, "a text went out before the Reconnect screen exists");
    assert.deepEqual(r.notQueued.map((n) => n.reason), ["template_pending", "template_pending"]);
    assert.deepEqual(r.errored, []);
    assert.deepEqual(held.other, []);
    for (const it of db.state.items) {
      assert.equal(it.reconnect_notified_at, null, "marked as told, so the client would never be texted once it is turned on");
    }

    // Tomorrow it is the same, and the logins are still waiting: nothing is lost by the hold.
    const again = await pass(db, { send: (_conn, args) => sendTemplated(held, args) });
    assert.equal(again.checked, 2);
    assert.equal(again.queued, 0);
  });

  test("no later migration may approve the text unless the Reconnect screen is in public/ — the approval and the button ship together", () => {
    const approvers = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql") && f !== FILE)
      .filter((f) => readFileSync(join(MIGRATIONS, f), "utf8").includes(TEMPLATE_KEY));
    if (approvers.length === 0) return; // nothing approves it: it stays held, which is the point
    const APP = join(HERE, "..", "..", "public", "app");
    const callsRelink = readdirSync(APP)
      .filter((f) => /\.(js|html)$/.test(f))
      .some((f) => readFileSync(join(APP, f), "utf8").includes("/api/banking/relink"));
    assert.ok(
      callsRelink,
      `${approvers.join(", ")} names ${TEMPLATE_KEY}, but no page under public/app/ calls /api/banking/relink. ` +
      "The text says 'tap Reconnect'. Do not turn it on before that button exists."
    );
  });

  test("the day it is approved, every waiting login is texted once — the hold costs nobody their text", async () => {
    const db = fakeBankDb({ items: [login({ id: ITEM_A }), login({ id: ITEM_B, clientId: CLIENT_2 })] });
    const refused = sender({ sent: false, reason: "template_pending" });
    await pass(db, { send: refused.send });
    for (const it of db.state.items) assert.equal(it.reconnect_notified_at, null);

    const approved = sender();
    const r = await pass(db, { send: approved.send });
    assert.equal(r.queued, 2);
    assert.equal(approved.calls.length, 2);
    assert.equal((await pass(db, { send: approved.send })).queued, 0, "and only once");
  });
});
