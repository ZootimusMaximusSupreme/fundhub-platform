// A broken bank login nobody told the client about. Fake database only.
// No Plaid call. No text. The SQL itself is proven on the live schema by a
// read-only probe (see ops/workflows/finish-left-2026-10-09-M1.md).

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  UNTOLD_AFTER_MS,
  UNTOLD_SQL,
  gapChecks,
  judgeUntold
} from "./gap-bank-relink.mjs";
import { GAP_FILES } from "./modules.mjs";
import { NOTIFY_CODES } from "../../banking/plaid-item-errors.mjs";
import { FINANCE_OS_TIER } from "../../finance/finance-os-entitlement.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../../waypoints/purchase.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-bank-relink.mjs"), "utf8");
const JOB = fs.readFileSync(path.join(HERE, "../../finance/bank-reconnect-notice.mjs"), "utf8");
const NOW = new Date("2026-10-10T15:00:00.000Z");
const ORG = "11111111-1111-1111-1111-111111111111";
const ID = "bank-relink-error-login-not-told";
const KEYS = ["detail", "id", "status", "suggestedFix"];

function assertShape(row) {
  assert.deepEqual(Object.keys(row).sort(), KEYS);
  assert.equal(row.id, ID);
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  if (row.status === "FAIL") assert.equal(typeof row.suggestedFix, "string");
  else assert.equal(row.suggestedFix, null);
}

function dbReturning(rows, { fail = null, code = null } = {}) {
  return {
    seen: [],
    async query(sql, params) {
      this.seen.push({ sql, params });
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|BEGIN|COMMIT|ROLLBACK|SET)\b\s/i);
      if (fail) throw Object.assign(new Error(fail), code ? { code } : {});
      return { rows };
    }
  };
}

test("one id, on the lane list, named by the route and the sweeper tripwires", () => {
  assert.deepEqual([...CHECK_IDS], [ID]);
  assert.ok(GAP_FILES.some(([name]) => name === "gap-bank-relink.mjs"), "gap-bank-relink.mjs is not on modules.mjs");
  assert.ok(TRIPWIRES["route:banking/relink"].checks.includes(ID));
  assert.ok(TRIPWIRES["job:plaid-transactions-sweeper"].checks.includes(ID));
  assert.equal(TRIPWIRES["route:banking/relink"].impact, "customer");
});

test("the SQL is one read, never selects the token, and asks for the job's own candidates", () => {
  assert.match(UNTOLD_SQL.trim(), /^\/\*[^*]*\*\/\s*SELECT\b/i);
  assert.doesNotMatch(UNTOLD_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  assert.doesNotMatch(UNTOLD_SQL.split(/\bFROM\b/i)[0], /encrypted_access_token/);
  // The same predicates the job's candidate query uses. If the job changes who it texts, this
  // lane must change with it, so each line has to exist in both files.
  for (const line of [
    "i.link_state = 'error'",
    "i.reconnect_notified_at IS NULL",
    "i.encrypted_access_token IS NOT NULL",
    "i.consent_granted_at IS NOT NULL",
    "i.plaid_item_id IS NOT NULL",
    "i.plaid_item_id NOT LIKE 'mock:%'",
    "i.last_error_code = ANY("
  ]) {
    assert.ok(UNTOLD_SQL.includes(line), `lane SQL lost: ${line}`);
    assert.ok(JOB.includes(line), `the job no longer has: ${line} (move this lane with it)`);
  }
  // Who the job refuses is not a missed text: no phone, or opted out of SMS.
  assert.match(UNTOLD_SQL, /btrim\(COALESCE\(c\.phone, ''\)\) <> ''/);
  assert.match(UNTOLD_SQL, /opt_outs o[\s\S]*o\.channel = 'sms' AND o\.opted_in_at IS NULL/);
  // The audience: an active finance-os subscription, or a paid Blueprint.
  assert.match(UNTOLD_SQL, /FROM subscriptions s[\s\S]*s\.tier = \$4::text AND s\.status = 'active'/);
  assert.match(UNTOLD_SQL, /FROM transactions t[\s\S]*resolve_product_id\(t\.org_id, t\.product_name\)/);
  assert.doesNotMatch(SRC, /fetch\(|api\.plaid\.com|sendTemplated|\bemit\(/);
});

test("the job's candidate query carries the SAME opt-out and audience block as this lane (only the parameter numbers differ)", () => {
  // The job keeps non-paying and opted-out clients out in SQL, so a pile of logins it will
  // never text cannot fill its batch of 200 and starve a paying client. If one file's block
  // changes and the other's does not, the lane and the job disagree about who is waiting.
  const norm = (s) => s.replace(/\s+/g, " ").replace(/\$\d+/g, () => "$n").trim();
  const block = UNTOLD_SQL.slice(UNTOLD_SQL.indexOf("AND NOT EXISTS ("));
  assert.ok(block.includes("opt_outs") && block.includes("FROM subscriptions") && block.includes("FROM transactions"),
    "the block under test is the opt-out and audience predicates");
  assert.ok(norm(JOB).includes(norm(block)), "the job's candidate query no longer has this lane's opt-out and audience block");
});

test("the red says the text is held on purpose until the Reconnect screen ships", async () => {
  const row = judgeUntold({ clients: 1, logins: 1, oldest: "2026-10-08T07:00:00.000Z", last_code: "ITEM_LOGIN_REQUIRED" }, NOW);
  assert.equal(row.status, "FAIL");
  assert.match(row.suggestedFix, /held on purpose/);
  assert.match(row.suggestedFix, /NOT approved/);
  assert.match(row.suggestedFix, /Reconnect screen/);
});

test("no database is a skip with a reason, never a pass", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 1);
  assertShape(rows[0]);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /not a pass/);
});

test("nobody waiting is a PASS, and the read is bound to the right values", async () => {
  const db = dbReturning([{ clients: 0, logins: 0, oldest: null, last_code: null }]);
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  assert.equal(rows.length, 1);
  assertShape(rows[0]);
  assert.equal(rows[0].status, "PASS");
  assert.equal(db.seen.length, 1);
  const p = db.seen[0].params;
  assert.equal(p[0], ORG);
  assert.deepEqual(p[1], [...NOTIFY_CODES]);
  assert.equal(p[2], new Date(NOW.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(UNTOLD_AFTER_MS, 2 * 24 * 60 * 60 * 1000);
  assert.equal(p[3], FINANCE_OS_TIER);
  assert.equal(p[4], NOW.toISOString());
  assert.equal(p[5], BLUEPRINT_PRODUCT_CODE);
  assert.equal(p[6], PAID_TRANSACTION_STATUS);
});

test("a paying client with a broken login and no text is a FAIL that says who and how long", async () => {
  const db = dbReturning([{
    clients: 2, logins: 3, oldest: "2026-10-05T07:00:00.000Z", last_code: "ITEM_LOGIN_REQUIRED"
  }]);
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows.length, 1);
  assertShape(rows[0]);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /2 paying clients have a bank login that broke more than 2 days ago/);
  assert.match(rows[0].detail, /\(3 bank logins\)/);
  assert.match(rows[0].detail, /oldest broke 5 days ago/);
  assert.match(rows[0].detail, /ITEM_LOGIN_REQUIRED/);
  assert.match(rows[0].suggestedFix, /SMS-FINANCE-OS-RECONNECT/);
  assert.match(rows[0].suggestedFix, /Do not text from this check/);
  assert.match(rows[0].suggestedFix, /Do not auto-fix/);
});

test("one client, one login says it in the singular", () => {
  const row = judgeUntold({ clients: 1, logins: 1, oldest: "2026-10-08T07:00:00.000Z", last_code: null }, NOW);
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^1 paying client has a bank login/);
  assert.doesNotMatch(row.detail, /bank logins\)/);
});

test("a read that fails, or answers no row, is a skip and never a pass", async () => {
  const broke = await gapChecks({ db: dbReturning([], { fail: 'column "reconnect_notified_at" does not exist' }), now: NOW });
  assertShape(broke[0]);
  assert.equal(broke[0].status, "skip");
  assert.match(broke[0].detail, /reconnect_notified_at/);
  assert.match(broke[0].detail, /not a pass/);

  const empty = await gapChecks({ db: dbReturning([]), now: NOW });
  assertShape(empty[0]);
  assert.equal(empty[0].status, "skip");
});

test("the column of migration 474 not being there yet is a skip that says so", async () => {
  const rows = await gapChecks({
    db: dbReturning([], { fail: 'column i.reconnect_notified_at does not exist', code: "42703" }),
    now: NOW
  });
  assertShape(rows[0]);
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /migration 474 is not applied/);
  assert.match(rows[0].detail, /not a pass/);
});

test("a scope function is used when the pulse hands one in", async () => {
  const seen = [];
  const scope = async (fn) => fn({
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ clients: 0, logins: 0, oldest: null, last_code: null }] };
    }
  });
  const rows = await gapChecks({ scope, now: NOW });
  assert.equal(rows[0].status, "PASS");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].params[0], null);
});
