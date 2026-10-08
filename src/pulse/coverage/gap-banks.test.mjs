// Bank-screen gaps. Fake database only. No Plaid call. No token exchange.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPTY_SQL,
  ERROR_SQL,
  HIDDEN_SQL,
  PLAID_SYNC_JOB_ID,
  RED_AFTER_MS,
  SQL,
  STALE_SQL,
  gapChecks
} from "./gap-banks.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-banks.mjs"), "utf8");
const NOW = new Date("2026-10-08T15:00:00.000Z");
const ORG = "11111111-1111-1111-1111-111111111111";
const KEYS = ["detail", "id", "status", "suggestedFix"];
const STATUSES = new Set(["PASS", "FAIL", "skip"]);

function assertShape(row) {
  assert.deepEqual(Object.keys(row).sort(), KEYS);
  assert.equal(typeof row.id, "string");
  assert.ok(row.id.length > 0);
  assert.ok(STATUSES.has(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok(row.suggestedFix === null || typeof row.suggestedFix === "string");
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\)/);
    assert.match(row.suggestedFix, /Do not call Plaid/);
    assert.match(row.suggestedFix, /Do not exchange tokens/);
    assert.match(row.suggestedFix, /Do not add another watcher/);
    assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
  }
}

function dbFrom(answers) {
  return {
    seen: [],
    async query(sql, params) {
      this.seen.push({ sql, params });
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
      const selectList = sql.split(/\bFROM\b/i)[0];
      assert.doesNotMatch(selectList, /encrypted_access_token/);
      const hit = answers.find((a) => a.test.test(sql));
      if (!hit) throw new Error(`unmatched ${sql.replace(/\s+/g, " ").slice(0, 140)}`);
      if (hit.throw) throw new Error(hit.throw);
      return { rows: hit.rows };
    }
  };
}

const clean = () => dbFrom([
  { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
  { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
  { test: /job_heartbeats/, rows: [{ active_links: 0, last_at: null, last_outcome: null, first_ever: null }] },
  { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
]);

test("SQL is a read, and the token column is not selected", () => {
  assert.equal(SQL.length, 4);
  for (const sql of SQL) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
    const selectList = sql.split(/\bFROM\b/i)[0];
    assert.doesNotMatch(selectList, /encrypted_access_token/);
  }
  assert.match(ERROR_SQL, /link_state = 'error'/);
  assert.match(HIDDEN_SQL, /closed_at IS NULL/);
  assert.match(HIDDEN_SQL, /IS DISTINCT FROM/);
  assert.match(STALE_SQL, /job_heartbeats/);
  assert.match(STALE_SQL, /link_state = 'active'/);
  assert.match(EMPTY_SQL, /NOT EXISTS/);
  assert.equal(PLAID_SYNC_JOB_ID, "plaid-transactions-sweeper");
  assert.equal(RED_AFTER_MS, 3 * 24 * 60 * 60 * 1000);
  assert.doesNotMatch(SRC, /link-exchange|item\/public_token|api\.plaid\.com|fetch\(/);
  assert.doesNotMatch(SRC, /slice-07-finance|slice-08-banks/);
});

test("no database skips all four checks", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 4);
  for (const row of rows) {
    assertShape(row);
    assert.equal(row.status, "skip");
    assert.equal(row.suggestedFix, null);
  }
  assert.deepEqual(rows.map((r) => r.id), [
    "banks-plaid-item-error",
    "banks-linked-not-on-screen",
    "banks-sync-stale",
    "banks-active-link-no-accounts"
  ]);
});

test("clean rows pass, and a quiet sync is a skip", async () => {
  const db = clean();
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  for (const row of rows) assertShape(row);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "skip");
  assert.match(rows[2].detail, /No live bank login/);
  assert.equal(rows[3].status, "PASS");
  for (const q of db.seen) assert.equal(q.params[0], ORG);
  const stale = db.seen.find((q) => /job_heartbeats/.test(q.sql));
  assert.equal(stale.params[1], "plaid-transactions-sweeper");
});

test("a bank login in error fails only that check", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 2, last_code: "ITEM_LOGIN_REQUIRED" }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: "2026-10-08T07:00:00.000Z", last_outcome: "ok", first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  for (const row of rows) assertShape(row);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 bank logins are in error/);
  assert.match(rows[0].detail, /ITEM_LOGIN_REQUIRED/);
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "PASS");
  assert.equal(rows[3].status, "PASS");
});

test("a linked open account the money screen would miss fails", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 1 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 0, last_at: null, last_outcome: null, first_ever: null }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /would not return/);
  assert.equal(rows[0].status, "PASS");
});

test("a stale bank sync fails when a live login exists", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: "2026-10-04T14:00:00.000Z", last_outcome: "ok", first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /4 days ago/);
  assert.match(rows[2].detail, /3 days/);
});

test("a sync exactly 3 days old still passes", async () => {
  const last = new Date(NOW.getTime() - RED_AFTER_MS);
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: last.toISOString(), last_outcome: "ok", first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[2].status, "PASS");
});

test("a fresh sync that failed still fails", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: "2026-10-08T07:00:00.000Z", last_outcome: "error", first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /last pass failed/);
});

test("no receipt yet skips; a receipt that never included the bank sync fails", async () => {
  const none = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: null, last_outcome: null, first_ever: null }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  assert.equal((await gapChecks({ db: none, now: NOW }))[2].status, "skip");

  const late = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: null, last_outcome: null, first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const row = (await gapChecks({ db: late, now: NOW }))[2];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /no receipt/);
});

test("a live login with zero accounts fails", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 1, last_at: "2026-10-08T07:00:00.000Z", last_outcome: "ok", first_ever: "2026-09-01T00:00:00.000Z" }] },
    { test: /NOT EXISTS/, rows: [{ items: 1, clients: 1 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[3].status, "FAIL");
  assert.match(rows[3].detail, /1 client has a live bank login and no account saved/);
  assert.equal(rows[2].status, "PASS");
});

test("a broken read fails that check and leaves the others", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, throw: "relation plaid_items does not exist" },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    { test: /job_heartbeats/, rows: [{ active_links: 0, last_at: null, last_outcome: null, first_ever: null }] },
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /plaid_items does not exist/);
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows[2].status, "skip");
  assert.equal(rows[3].status, "PASS");
});

test("scope is accepted the same way as db", async () => {
  const db = clean();
  const rows = await gapChecks({
    scope: (fn) => fn(db),
    now: NOW
  });
  assert.equal(rows[0].status, "PASS");
  assert.equal(db.seen.length, 4);
});
