// Bank login and merchant sync gaps. Fake database only. No Plaid call. No token exchange.
// What the SQL itself answers, on a real Postgres, is in gap-customer-records.pg.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BANK_TOLD_RE,
  CHECK_IDS,
  LOGIN_SQL,
  LOGIN_WINDOW_MS,
  MERCHANT_QUIET_MS,
  MERCHANT_SQL,
  SQL,
  gapChecks,
  judgeLogins,
  judgeMerchants,
  naVerify
} from "./gap-bank-links.mjs";
import { SENT_TODAY_STATUSES } from "../../messaging/outbox.mjs";
import { SWEEP_CRON } from "../../workflows/merchant-pull-sweeper.mjs";
import { cronIntervalMs } from "../heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-bank-links.mjs"), "utf8");
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const KEYS = ["detail", "id", "status", "suggestedFix"];

function dbFrom(answers) {
  return {
    seen: [],
    async query(sql, params) {
      this.seen.push({ sql, params });
      const hit = answers.find((a) => a.test.test(sql));
      if (!hit) throw new Error(`unmatched ${String(sql).replace(/\s+/g, " ").slice(0, 120)}`);
      if (hit.throw) throw new Error(hit.throw);
      return { rows: hit.rows };
    }
  };
}

const login = (over = {}) => ({
  test: /gap:bank-login-broken/,
  rows: [{ banks: 3, in_error: 0, broken: 0, followed_up: 0, clients: 0, oldest: null, last_code: null, ...over }]
});
const merchant = (over = {}) => ({
  test: /gap:merchant-sync/,
  rows: [{ live: 0, errored: 0, quiet: 0, late: 0, oldest: null, sample_error: null, ...over }]
});

function assertShape(row) {
  for (const k of ["id", "status", "detail", "suggestedFix"]) assert.ok(k in row, `${row.id} has no ${k}`);
  assert.ok(["PASS", "FAIL", "skip", "na"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Do not auto-fix/);
  }
  if (row.status !== "na") assert.deepEqual(Object.keys(row).sort(), KEYS);
}

test("the SQL is one read each, the token column is never named, and nothing writes", () => {
  assert.equal(SQL.length, 2);
  for (const sql of SQL) {
    assert.match(sql.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim(), /^(WITH|SELECT)\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    assert.doesNotMatch(sql, /encrypted_access_token|encrypted_api_key\b(?!\s+IS NOT NULL)/);
  }
  assert.doesNotMatch(SRC, /fetch\(|api\.plaid\.com|link-exchange|method:\s*["']POST/);
  assert.doesNotMatch(SRC, /node:fs|readFileSync/);
  assert.deepEqual([...CHECK_IDS], ["banks:login-broken", "banks:merchant-sync"]);
});

test("the login SQL judges the NEWEST login per bank, skips mock logins, and tests 'told' only for a late row", () => {
  assert.match(LOGIN_SQL, /DISTINCT ON \(org_id, client_id, bank_key\)/);
  assert.match(LOGIN_SQL, /ORDER BY org_id, client_id, bank_key, created_at DESC, id DESC/);
  assert.match(LOGIN_SQL, /plaid_institution_id/);
  assert.match(LOGIN_SQL, /NOT LIKE 'mock:%'/);
  assert.match(LOGIN_SQL, /link_state = 'error' AND n\.broke_at < \$2::timestamptz/);
  assert.match(LOGIN_SQL, /CASE WHEN n\.link_state = 'error' AND n\.broke_at < \$2::timestamptz THEN/);
  // told: a staff task OR a message that really left, both after the break.
  assert.match(LOGIN_SQL, /FROM tasks t/);
  assert.match(LOGIN_SQL, /FROM messages m/);
  assert.match(LOGIN_SQL, /m\.direction = 'outbound'/);
  assert.match(LOGIN_SQL, /t\.created_at >= n\.broke_at/);
  assert.match(LOGIN_SQL, /m\.created_at >= n\.broke_at/);
});

test("'told' counts only the three statuses the outbox calls sent", () => {
  const m = /m\.status IN \(([^)]*)\)/.exec(LOGIN_SQL);
  assert.ok(m, "the told test must name its message statuses");
  const named = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(named, [...SENT_TODAY_STATUSES].sort());
});

test("the windows are the ones written down: one day for a login, two for a merchant pull", () => {
  assert.equal(LOGIN_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.equal(MERCHANT_QUIET_MS, 2 * 24 * 60 * 60 * 1000);
  // The sweeper is daily. Two days is exactly one missed pass.
  assert.equal(cronIntervalMs(SWEEP_CRON), 24 * 60 * 60 * 1000);
  assert.ok(MERCHANT_QUIET_MS > cronIntervalMs(SWEEP_CRON));
  assert.ok(MERCHANT_QUIET_MS <= 2 * cronIntervalMs(SWEEP_CRON));
});

test("BANK_TOLD_RE matches words about the bank login and not ordinary mail", () => {
  const re = new RegExp(BANK_TOLD_RE, "i");
  for (const yes of [
    "Please reconnect your bank login",
    "Link your bank again",
    "Sign in to your bank to refresh",
    "Plaid needs you to log in again",
    "Call Maria: her bank connection is broken",
    "RE-LINK BANK"
  ]) assert.ok(re.test(yes), yes);
  for (const no of [
    "Your roadmap is ready",
    "Call about the card limit",
    "Welcome to Fundhub",
    "Your statement closes on the 5th",
    "Payment received, thank you"
  ]) assert.ok(!re.test(no), no);
});

test("no database: both rows are skips and say so", async () => {
  const rows = await gapChecks({});
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  for (const r of rows) {
    assertShape(r);
    assert.equal(r.status, "skip");
  }
});

test("PASS: banks read, none in error, a real live pull connection synced", async () => {
  const db = dbFrom([login({ banks: 3 }), merchant({ live: 2 })]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  rows.forEach(assertShape);
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /3 bank logins read \(newest per bank\); none is in error/);
  assert.equal(rows[1].status, "PASS");
  assert.match(rows[1].detail, /2 live merchant pull connections have synced inside 2 days/);
});

test("the reads carry the org, the one-day cut, the two-day cut and the told words", async () => {
  const db = dbFrom([login(), merchant({ live: 1 })]);
  await gapChecks({ db, now: NOW, orgId: ORG });
  const l = db.seen.find((q) => /gap:bank-login-broken/.test(q.sql));
  assert.equal(l.params[0], ORG);
  assert.equal(l.params[1], new Date(NOW.getTime() - LOGIN_WINDOW_MS).toISOString());
  assert.equal(l.params[2], BANK_TOLD_RE);
  const m = db.seen.find((q) => /gap:merchant-sync/.test(q.sql));
  assert.equal(m.params[0], ORG);
  assert.equal(m.params[1], new Date(NOW.getTime() - MERCHANT_QUIET_MS).toISOString());
});

test("FAIL: a login in error over a day with nobody told is red and names clients, age and code, never a token", async () => {
  const db = dbFrom([
    login({ banks: 4, in_error: 2, broken: 2, clients: 2, oldest: new Date(NOW.getTime() - 3 * 86400000).toISOString(), last_code: "ITEM_LOGIN_REQUIRED" }),
    merchant()
  ]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  const r = rows[0];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 bank logins are in error for over a day with no message to the client and no staff task/);
  assert.match(r.detail, /2 clients/);
  assert.match(r.detail, /oldest broke 3 days ago/);
  assert.match(r.detail, /ITEM_LOGIN_REQUIRED/);
  assert.match(r.suggestedFix, /Do not call Plaid/);
  assert.doesNotMatch(JSON.stringify(r), /access_token|encrypted/i);
});

test("PASS: a login in error inside the first day, or already followed up, is not red", async () => {
  const db = dbFrom([login({ banks: 2, in_error: 2, broken: 0, followed_up: 1 }), merchant()]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  assert.equal(rows[0].status, "PASS");
  assert.match(rows[0].detail, /2 are in error, but they are inside the first day or already followed up/);
});

test("the red clears once the client links the same bank again (the newest login is active)", () => {
  // The SQL turns the old error row into 'not the newest', so the aggregate has broken = 0.
  assert.equal(judgeLogins({ banks: 1, in_error: 0, broken: 0 }, NOW).status, "PASS");
  assert.equal(judgeLogins({ banks: 1, in_error: 1, broken: 1, clients: 1 }, NOW).status, "FAIL");
});

test("one broken login uses the singular", () => {
  const r = judgeLogins({ banks: 1, in_error: 1, broken: 1, clients: 1, oldest: null, last_code: null }, NOW);
  assert.match(r.detail, /^1 bank login is in error/);
  assert.match(r.detail, /\(1 client\)/);
  assert.match(r.detail, /that bank/);
});

test("merchant: a late pull connection is red and counts errors and quiet ones separately", async () => {
  const db = dbFrom([
    login(),
    merchant({
      live: 5, errored: 1, quiet: 2, late: 2,
      oldest: new Date(NOW.getTime() - 4 * 86400000).toISOString(),
      sample_error: "The key was refused (401)."
    })
  ]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  const r = rows[1];
  assertShape(r);
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /2 merchant pull connections are late: 1 with a sync error, 2 with no sync in 2 days \(of 5 live\)/);
  assert.match(r.detail, /oldest good read was 4 days ago/);
  assert.match(r.detail, /The key was refused \(401\)/);
});

test("merchant: a processor error that looks like a key is cut before it reaches the morning text", () => {
  const secret = ["sk", "live", "abcdefghijklmnopqrstuvwxyz0123456789"].join("_");
  const r = judgeMerchants({ live: 1, errored: 1, quiet: 0, late: 1, sample_error: `Bad key ${secret} refused` }, NOW);
  assert.equal(r.status, "FAIL");
  assert.doesNotMatch(r.detail, new RegExp(secret));
  assert.match(r.detail, /\[removed\]/);
});

test("merchant: no live pull connection is 'nothing to judge' with a code the lane can check again", async () => {
  const db = dbFrom([login(), merchant({ live: 0 })]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  const r = rows[1];
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "not-connected", args: { check: "banks:merchant-sync", what: "Merchant pull" } });
  assert.match(r.detail, /No client has a live merchant pull connection/);
});

test("naVerify: true only while there really is no live pull connection", async () => {
  const none = dbFrom([merchant({ live: 0 })]);
  assert.equal(await naVerify["not-connected"]({ check: "banks:merchant-sync" }, { db: none, now: NOW, orgId: ORG }), true);
  const some = dbFrom([merchant({ live: 1 })]);
  assert.equal(await naVerify["not-connected"]({ check: "banks:merchant-sync" }, { db: some, now: NOW, orgId: ORG }), false);
  // A claim about some other check, no database, or a read that throws is never "true".
  assert.equal(await naVerify["not-connected"]({ check: "social:video-stats-stale" }, { db: none }), false);
  assert.equal(await naVerify["not-connected"]({ check: "banks:merchant-sync" }, {}), false);
  assert.equal(await naVerify["not-connected"](null, { db: none }), false);
  const broken = dbFrom([{ test: /gap:merchant-sync/, throw: "connection reset" }]);
  assert.equal(await naVerify["not-connected"]({ check: "banks:merchant-sync" }, { db: broken }), false);
});

test("a read that fails is a skip with the reason, never a PASS", async () => {
  const db = dbFrom([
    { test: /gap:bank-login-broken/, throw: "connection terminated" },
    { test: /gap:merchant-sync/, throw: "relation does not exist" }
  ]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  for (const r of rows) {
    assertShape(r);
    assert.equal(r.status, "skip");
  }
  assert.match(rows[0].detail, /connection terminated/);
  assert.match(rows[1].detail, /relation does not exist/);
});

test("reads go through the staff scope when one is passed", async () => {
  const viaScope = dbFrom([login(), merchant({ live: 1 })]);
  const viaDb = dbFrom([login(), merchant({ live: 1 })]);
  const rows = await gapChecks({ db: viaDb, scope: (fn) => fn(viaScope), now: NOW, orgId: ORG });
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(viaScope.seen.length, 2);
  assert.equal(viaDb.seen.length, 0);
});
