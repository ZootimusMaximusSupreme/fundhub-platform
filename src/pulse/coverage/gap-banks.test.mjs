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

/* One answer for the per-login stale read. Rows are what STALE_SQL returns. */
const stale = (active_links, stale_links = 0, oldest = null, last_code = null) =>
  ({ test: /stale_links/, rows: [{ active_links, stale_links, oldest, last_code }] });

const clean = () => dbFrom([
  { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
  { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
  stale(0),
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
  // The job receipt is already watched twice (job:plaid-transactions-sweeper and
  // the slice 08 sweeper row). This check reads each live login instead.
  assert.doesNotMatch(STALE_SQL, /job_heartbeats/);
  assert.match(STALE_SQL, /transactions_synced_at/);
  assert.match(STALE_SQL, /balance_as_of/);
  assert.match(STALE_SQL, /live\.last_read < \$2::timestamptz/);
  assert.match(STALE_SQL, /link_state = 'active'/);
  assert.match(STALE_SQL, /NOT LIKE 'mock:%'/);
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
  const staleQ = db.seen.find((q) => /stale_links/.test(q.sql));
  assert.equal(staleQ.params[1], new Date(NOW.getTime() - RED_AFTER_MS).toISOString());
});

test("a bank login in error fails only that check", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 2, last_code: "ITEM_LOGIN_REQUIRED" }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    stale(1, 0),
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
    stale(0),
    { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /would not return/);
  assert.equal(rows[0].status, "PASS");
});

const base = (staleAnswer) => dbFrom([
  { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
  { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
  staleAnswer,
  { test: /NOT EXISTS/, rows: [{ items: 0, clients: 0 }] }
]);

test("a live login that has not synced in 3 days fails, with its age", async () => {
  const db = base(stale(1, 1, "2026-10-04T14:00:00.000Z"));
  const rows = await gapChecks({ db, now: NOW });
  assertShape(rows[2]);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /^1 live bank login has not synced in 3 days/);
  assert.match(rows[2].detail, /4 days ago/);
  assert.match(rows[2].suggestedFix, /plaid-transactions-sweeper/);
  assert.match(rows[2].suggestedFix, /receipt can look fine/);
});

test("the stale cut is exactly 3 days, and a login at the cut still passes", async () => {
  // The cut is handed to the SQL as now minus 3 days, and the SQL compares with
  // a strict less-than, so a login read exactly 3 days ago is not stale.
  const db = base(stale(2, 0));
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[2].status, "PASS");
  assert.match(rows[2].detail, /2 live bank logins have synced inside 3 days/);
  const q = db.seen.find((x) => /stale_links/.test(x.sql));
  assert.equal(q.params[1], "2026-10-05T15:00:00.000Z");
  assert.match(q.sql, /live\.last_read < \$2::timestamptz/);
  assert.doesNotMatch(q.sql, /<= \$2::timestamptz/);
});

test("a login that keeps erroring and stopped syncing names the error code", async () => {
  const db = base(stale(3, 2, "2026-10-01T07:00:00.000Z", "RATE_LIMIT_EXCEEDED"));
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /^2 live bank logins have not synced in 3 days/);
  assert.match(rows[2].detail, /Last error code: RATE_LIMIT_EXCEEDED/);
  assert.match(rows[2].detail, /7 days ago/);
});

test("no live login skips, and a login never read since it was linked fails", async () => {
  const none = base(stale(0, 0));
  const skip = (await gapChecks({ db: none, now: NOW }))[2];
  assert.equal(skip.status, "skip");
  assert.match(skip.detail, /No live bank login/);

  // transactions_synced_at is empty, so the SQL falls back to created_at.
  const never = base(stale(1, 1, "2026-09-20T00:00:00.000Z"));
  const row = (await gapChecks({ db: never, now: NOW }))[2];
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /19 days ago/);
  assert.match(STALE_SQL, /COALESCE\(p\.transactions_synced_at, p\.created_at\)/);
});

test("the sync check no longer reads the job receipt that two other watchers already read", async () => {
  const db = clean();
  await gapChecks({ db, now: NOW });
  for (const q of db.seen) assert.doesNotMatch(q.sql, /job_heartbeats/);
  assert.doesNotMatch(SRC, /FROM\s+job_heartbeats/i);
});

test("a live login with zero accounts fails", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    stale(1, 0),
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
    stale(0),
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

// ---- Review — Claude, 2026-10-08 ------------------------------------------

test("a client whose only live login has every account closed fails, even though rows exist", async () => {
  // The old read only counted rows. A login with 4 closed accounts has rows, and
  // the money screen drops closed accounts, so that client sees no bank.
  assert.match(EMPTY_SQL, /a\.closed_at IS NULL/);
  assert.match(EMPTY_SQL, /a\.client_id = p\.client_id/);
  assert.match(EMPTY_SQL, /OR NOT EXISTS/);
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    stale(1, 0),
    { test: /NOT EXISTS/, rows: [{ items: 1, clients: 1 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assertShape(rows[3]);
  assert.equal(rows[3].status, "FAIL");
  assert.match(rows[3].detail, /1 client has a live bank login and no account saved/);
  assert.match(rows[3].detail, /Closed accounts are not shown/);
  assert.match(rows[3].suggestedFix, /every one closed/);
});

test("a re-linked client (older login all closed, newer login open) is not counted", () => {
  // Chris's own client looks like this in production: two older logins with
  // only closed accounts and one newer login with 4 open ones. The SQL asks
  // "does this CLIENT have an open account anywhere", not "does this login".
  const clientWide = EMPTY_SQL.split("OR NOT EXISTS")[1];
  assert.doesNotMatch(clientWide, /a\.plaid_item_id = p\.id/);
  assert.match(clientWide, /a\.client_id = p\.client_id\s+AND a\.org_id = p\.org_id\s+AND a\.closed_at IS NULL/);
});

test("the clean line for the empty-login check says open account", async () => {
  const rows = await gapChecks({ db: clean(), now: NOW });
  assert.equal(rows[3].status, "PASS");
  assert.match(rows[3].detail, /at least one open account/);
});

test("several empty logins across clients are counted in the FAIL line", async () => {
  const db = dbFrom([
    { test: /link_state = 'error'/, rows: [{ n: 0, last_code: null }] },
    { test: /IS DISTINCT FROM/, rows: [{ n: 0 }] },
    stale(0),
    { test: /NOT EXISTS/, rows: [{ items: 3, clients: 2 }] }
  ]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[3].status, "FAIL");
  assert.match(rows[3].detail, /^2 clients have a live bank login/);
  assert.match(rows[3].detail, /3 logins with no open account/);
});
