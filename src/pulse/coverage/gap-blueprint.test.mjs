import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { CHECK_IDS, REAL_ADVISOR_SQL, MONTHLY_DELIVERY_SQL, gapChecks } from "./gap-blueprint.mjs";
import { CSM_ASSIGNMENT_EXCEPTION_SOURCE } from "../../blueprint/assign-csm.mjs";
import { MONTHLY_DELIVERY_EXCEPTION_SOURCE } from "../../finance/finance-os-pull-fulfil.mjs";
import { OFFERS } from "../../config/offers.mjs";
import { PAID_TRANSACTION_STATUS } from "../../entitlements/entitlements.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-20T12:00:00Z");
function dbFor(counts = [0, 0]) {
  const calls = [];
  return { calls, async query(sql, params) {
    calls.push({ sql, params });
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i);
    const value = counts[calls.length - 1];
    if (value instanceof Error) throw value;
    return { rows: value === undefined ? [] : [{ n: value }] };
  } };
}

test("Blueprint checks report both missing real advisors and failed saved-result delivery red", async () => {
  const db = dbFor([2, 1]);
  const out = await gapChecks({ db, orgId: ORG, now: NOW });
  assert.deepEqual(out.map((r) => r.id), CHECK_IDS);
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "FAIL"]);
  assert.match(out[0].detail, /^2 active paid Blueprint/);
  assert.match(out[0].suggestedFix, new RegExp(CSM_ASSIGNMENT_EXCEPTION_SOURCE));
  assert.match(out[1].suggestedFix, /saved credit result/);
  assert.match(out[1].suggestedFix, /Do not request another paid credit pull/);
  assert.equal(db.calls[1].params[1], MONTHLY_DELIVERY_EXCEPTION_SOURCE);
  assert.equal(db.calls[0].params[3], OFFERS.UWIQ_DELIVERABLES.productCode);
  assert.equal(db.calls[0].params[4], PAID_TRANSACTION_STATUS);
  assert.equal(db.calls[0].params[1], NOW.toISOString());
  assert.ok(db.calls.every((call) => call.params[0] === ORG));
});

test("healthy or empty counts pass, but a missing scoped reader skips without queries", async () => {
  assert.deepEqual((await gapChecks({ db: dbFor(), orgId: ORG, now: NOW })).map((r) => r.status), ["PASS", "PASS"]);
  const db = dbFor();
  assert.deepEqual((await gapChecks({ db, now: NOW })).map((r) => r.status), ["skip", "skip"]);
  assert.equal(db.calls.length, 0);
  assert.deepEqual((await gapChecks({ orgId: ORG })).map((r) => r.status), ["skip", "skip"]);
});

test("the existing staff read scope wins over the unscoped pool", async () => {
  const db = dbFor([1, 0]);
  let scopeCalls = 0;
  const out = await gapChecks({ orgId: ORG, now: NOW,
    db: { query() { throw new Error("unscoped pool must not be used"); } },
    scope: async (fn) => { scopeCalls += 1; return fn(db); }
  });
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "PASS"]);
  assert.equal(scopeCalls, 2);
});

test("failed or malformed reads stay red independently and never expose database error values", async () => {
  for (const invalid of [undefined, null, "", false, true, [], {}, -1, 0.5, "not a number", new Error("secret@example.com customer data")]) {
    const out = await gapChecks({ db: dbFor([invalid, 0]), orgId: ORG, now: NOW });
    assert.deepEqual(out.map((r) => r.status), ["FAIL", "PASS"]);
    assert.doesNotMatch(JSON.stringify(out), /secret@example.com|customer data/);
  }
  const out = await gapChecks({ db: dbFor(), orgId: ORG, now: "invalid" });
  assert.deepEqual(out.map((r) => r.status), ["FAIL", "FAIL"]);
});

test("SQL uses actual same-org staff eligibility and paid-period bounds, never task existence as assignment proof", () => {
  assert.match(REAL_ADVISOR_SQL, /t\.org_id = c\.org_id AND t\.client_id = c\.id/);
  assert.match(REAL_ADVISOR_SQL, /s\.org_id = c\.org_id AND s\.client_id = c\.id/);
  assert.match(REAL_ADVISOR_SQL, /s\.org_id = c\.org_id AND s\.id = c\.assigned_csm_staff_id/);
  for (const predicate of ["s.status = 'active'", "s.active = true", "s.is_demo = false", "s.current_period_start <=", "s.current_period_end >"]) {
    assert.ok(REAL_ADVISOR_SQL.includes(predicate), predicate);
  }
  assert.doesNotMatch(REAL_ADVISOR_SQL, /\benabled\b|FROM tasks/);
  assert.match(MONTHLY_DELIVERY_SQL, /c\.org_id = t\.org_id AND c\.id = t\.client_id/);
  assert.match(MONTHLY_DELIVERY_SQL, /t\.done = false/);
  assert.doesNotMatch(MONTHLY_DELIVERY_SQL, /subscriptions|current_period_end/);
  const source = readFileSync(new URL("./gap-blueprint.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b|\bfetch\s*\(|createTask\(|requestSoftPull\(/);
  assert.match(REAL_ADVISOR_SQL, /SELECT count\(\*\)::int AS n/);
  assert.match(MONTHLY_DELIVERY_SQL, /SELECT count\(\*\)::int AS n/);
});

// Actual migrated-table SQL proof is restricted to a local named scratch DB.
const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local scratch database */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("actual SQL catches demo/disabled/cross-org advisors and unresolved delivery, excluding unrelated clients", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of ["clients", "staff", "transactions", "products", "product_aliases", "subscriptions", "tasks"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const org = randomUUID();
    const client = (await db.query(`INSERT INTO clients (org_id, first_name, email)
      VALUES ($1,'Blueprint','buyer@realcompany.com') RETURNING id`, [org])).rows[0].id;
    await db.query(`INSERT INTO products (org_id, code, name)
      VALUES ($1,$2,'Capital Blueprint')`, [org, OFFERS.UWIQ_DELIVERABLES.productCode]);
    await db.query(`INSERT INTO transactions (org_id,client_id,product_name,status)
      VALUES ($1,$2,'Capital Blueprint',$3)`, [org, client, PAID_TRANSACTION_STATUS]);
    await db.query(`INSERT INTO subscriptions (org_id,client_id,tier,status,current_period_start,current_period_end,effective_from)
      VALUES ($1,$2,'finance-os','active','2026-01-01','2027-01-01','2026-01-01')`, [org, client]);
    const advisor = (await db.query(`INSERT INTO staff (org_id,name,role,status,active,is_demo)
      VALUES ($1,'Real advisor','csm','active',true,false) RETURNING id`, [org])).rows[0].id;
    const run = () => gapChecks({ db, orgId: org, now: NOW });
    assert.equal((await run())[0].status, "FAIL");
    await db.query("UPDATE clients SET assigned_csm_staff_id=$2 WHERE id=$1", [client, advisor]);
    assert.equal((await run())[0].status, "PASS");
    for (const change of ["is_demo=true", "active=false", "status='suspended'"]) {
      await db.query(`UPDATE staff SET ${change} WHERE id=$1`, [advisor]);
      assert.equal((await run())[0].status, "FAIL", change);
      await db.query("UPDATE staff SET is_demo=false,active=true,status='active' WHERE id=$1", [advisor]);
    }
    await db.query("UPDATE staff SET org_id=$2 WHERE id=$1", [advisor, randomUUID()]);
    assert.equal((await run())[0].status, "FAIL", "other-org assignment is not real support");
    await db.query("UPDATE transactions SET status='pending' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "unpaid client is outside the paid population");
    await db.query("UPDATE transactions SET status=$2 WHERE client_id=$1", [client, PAID_TRANSACTION_STATUS]);
    await db.query("UPDATE subscriptions SET status='past_due' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "inactive paid access is excluded");
    await db.query("UPDATE subscriptions SET status='active' WHERE client_id=$1", [client]);
    await db.query("UPDATE clients SET is_demo=true WHERE id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "demo buyer excluded");
    await db.query("UPDATE clients SET is_demo=false WHERE id=$1", [client]);
    assert.equal((await gapChecks({ db, orgId: randomUUID(), now: NOW }))[0].status, "PASS");
    await db.query("UPDATE subscriptions SET current_period_end='2026-10-20T12:00:00Z' WHERE client_id=$1", [client]);
    assert.equal((await run())[0].status, "PASS", "paid-year end is exclusive");
    await db.query(`INSERT INTO tasks (org_id,client_id,title,source_workflow,assignee_role,done)
      VALUES ($1,$2,'Finish delivery',$3,'owner',false)`, [org, client, MONTHLY_DELIVERY_EXCEPTION_SOURCE]);
    assert.equal((await run())[1].status, "FAIL", "delivery remains open after year end");
    assert.equal((await gapChecks({ db, orgId: randomUUID(), now: NOW }))[1].status, "PASS", "other-org delivery is excluded");
    await db.query("UPDATE tasks SET is_demo=true WHERE client_id=$1", [client]);
    assert.equal((await run())[1].status, "PASS", "demo task is excluded");
    await db.query("UPDATE tasks SET is_demo=false WHERE client_id=$1", [client]);
    await db.query("UPDATE tasks SET done=true WHERE client_id=$1", [client]);
    assert.equal((await run())[1].status, "PASS");
  } finally { await db.query("ROLLBACK"); db.release(); }
});
