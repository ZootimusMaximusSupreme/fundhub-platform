// FinanceOS 12-month collision acceptance: scratch Postgres ONLY, rollback every fixture.
// No external providers, customers, subscriptions or live billing are changed.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { financeOsEntitlement } from "./finance-os-entitlement.mjs";
import { isBlueprintCoachClient } from "../blueprint/coach.mjs";
import { dueClients } from "../workflows/finance-os-pull-sweeper.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const u = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(u.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(u.pathname);
} catch { /* refuse unknown and production databases */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("paid Blueprint year survives the shorter FinanceOS monthly term, but not a refund or month 13",
  { skip: safe ? false : "requires a local test/scratch PostgreSQL database" }, async () => {
    const db = await pool.connect();
    await db.query("BEGIN");
    try {
      for (const table of ["subscriptions", "soft_pull_requests", "crs_results",
        "entitlements", "transactions", "products", "product_aliases"]) {
        await db.query("CREATE TEMP TABLE " + table + " (LIKE public." + table
          + " INCLUDING ALL) ON COMMIT DROP");
      }
      await db.query("SET LOCAL search_path TO pg_temp, public");
      const org = randomUUID(), client = randomUUID(), foreignOrg = randomUUID();
      await db.query(
        "INSERT INTO products (org_id,code,name,category) VALUES ($1,'consulting-package','Consulting Services Package','consulting')",
        [org]);
      const monthly = (await db.query(
        "INSERT INTO subscriptions (org_id,client_id,tier,status,current_period_start,current_period_end,effective_from) "
        + "VALUES ($1,$2,'finance-os','active','2026-10-01','2026-11-01','2026-10-01') RETURNING id",
        [org,client])).rows[0].id;
      const payment = (await db.query(
        "INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status,created_at) "
        + "VALUES ($1,$2,'Consulting Services Package',7500,'succeeded','2026-10-29T00:00:00Z') RETURNING id",
        [org,client])).rows[0].id;
      const grant = (await db.query(
        "INSERT INTO entitlements (org_id,client_id,entitlement_code,source_transaction_id,grant_reason,granted_at) "
        + "VALUES ($1,$2,'credit-optimization-roadmap',$3,'purchase:consulting-package','2026-10-29') RETURNING id",
        [org,client,payment])).rows[0].id;
      const access = iso => financeOsEntitlement(db, {
        orgId: org, clientId: client, asOf: new Date(iso)
      });
      const due = async iso => (await dueClients(db, new Date(iso)))
        .map(row => row.subscription_id);
      assert.equal((await access("2026-10-30T00:00:00Z")).subscriptionId, monthly);
      assert.equal((await access("2026-11-30T00:00:00Z")).subscriptionId, grant);
      assert.deepEqual(await due("2026-11-30T00:00:00Z"), [grant]);
      assert.equal((await access("2027-10-28T00:00:00Z")).entitled, true);
      assert.equal((await access("2027-10-29T00:00:00Z")).entitled, false);
      const coachAt = iso => isBlueprintCoachClient(db, {
        orgId: org, clientId: client, asOf: new Date(iso)
      });
      assert.equal(await coachAt("2026-10-30T00:00:00Z"), true);
      assert.equal(await coachAt("2027-10-28T00:00:00Z"), true);
      assert.equal(await coachAt("2027-10-29T00:00:00Z"), false);
      assert.equal(await isBlueprintCoachClient(db, { orgId: foreignOrg, clientId: client,
        asOf: new Date("2026-11-30T00:00:00Z") }), false);
      assert.deepEqual(await due("2027-10-29T00:00:00Z"), []);
      assert.equal((await financeOsEntitlement(db, {
        orgId: foreignOrg, clientId: client, asOf: new Date("2026-11-30")
      })).entitled, false, "foreign tenant cannot claim the client's purchase");
      await db.query("UPDATE entitlements SET revoked_at='2026-11-10' WHERE id=$1", [grant]);
      assert.equal(await coachAt("2026-11-30T00:00:00Z"), false);
      assert.equal((await access("2026-11-30T00:00:00Z")).entitled, false);
      assert.deepEqual(await due("2026-11-30T00:00:00Z"), []);
      const original = (await db.query(
        "SELECT current_period_end, status FROM subscriptions WHERE id=$1", [monthly])).rows[0];
      assert.equal(new Date(original.current_period_end).toISOString(),
        "2026-11-01T00:00:00.000Z");
      assert.equal(original.status, "active", "original billed monthly plan stays unchanged");
    } finally {
      await db.query("ROLLBACK");
      db.release();
    }
});


test("Blueprint genuine refresh ignores all known completed rehearsal formats; unresolved work never redials",
  { skip: safe ? false : "requires a local test/scratch PostgreSQL database" }, async () => {
    const conn = await pool.connect();
    await conn.query("BEGIN");
    try {
      for (const table of ["subscriptions", "soft_pull_requests", "crs_results",
        "entitlements", "transactions", "products", "product_aliases"]) {
        await conn.query("CREATE TEMP TABLE " + table + " (LIKE public." + table
          + " INCLUDING ALL) ON COMMIT DROP");
      }
      await conn.query("SET LOCAL search_path TO pg_temp, public");
      const org = randomUUID(), client = randomUUID(), foreignOrg = randomUUID();
      const subscriptionId = (await conn.query(
        "INSERT INTO subscriptions (org_id,client_id,tier,status,effective_from,current_period_start,current_period_end) "
          + "VALUES ($1,$2,'finance-os','active','2026-10-01','2026-10-01','2026-12-31') RETURNING id",
        [org, client])).rows[0].id;
      const at = new Date("2026-10-12T00:00:00Z");
      const due = async (realPull) => (await dueClients(conn, at, { realPull }))
        .map((row) => row.subscription_id);
      const clear = async () => {
        await conn.query("DELETE FROM soft_pull_requests");
        await conn.query("DELETE FROM crs_results");
      };
      const completed = async ({ provider = "crs_softview", result, resultOrg = org }) => {
        const credit = (await conn.query(
          "INSERT INTO crs_results (org_id,client_id,provider,provider_result_id,result) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id",
          [resultOrg, client, provider, randomUUID(), JSON.stringify(result)])).rows[0].id;
        await conn.query(
          "INSERT INTO soft_pull_requests (org_id,client_id,subscription_id,requested_by_kind,reason,status,requested_at,resolved_at,crs_result_id) "
            + "VALUES ($1,$2,$3,'system','Included refresh synthetic fixture','fulfilled','2026-10-10','2026-10-10',$4)",
          [org, client, subscriptionId, credit]);
      };
      assert.deepEqual(await due(true), [subscriptionId], "paid subscriber initially due");
      for (const sample of [
        { provider: "crs_softview_simulated", result: {} },
        { result: { simulated: true, environment: "production" } },
        { result: { simulated: "1", environment: "production" } },
        { result: { simulated: false, environment: "sandbox" } },
        { result: { simulated: false, environment: "simulated" } }
      ]) {
        await clear();
        await completed(sample);
        assert.deepEqual(await due(false), [], "rehearsal must not loop in simulated mode");
        assert.deepEqual(await due(true), [subscriptionId],
          "completed rehearsal cannot spend a real refresh: " + JSON.stringify(sample));
      }
      await clear();
      await completed({ result: { simulated: false, environment: "production" } });
      assert.deepEqual(await due(true), [], "real credit result blocks a second automatic pull");
      await clear();
      await completed({ result: { simulated: true }, resultOrg: foreignOrg });
      assert.deepEqual(await due(true), [], "foreign-org report cannot release a local request");
      for (const state of ["queued", "failed"]) {
        await clear();
        await conn.query(
          "INSERT INTO soft_pull_requests (org_id,client_id,subscription_id,requested_by_kind,reason,status,requested_at,resolved_at) "
            + "VALUES ($1,$2,$3,'system','Included refresh unresolved fixture',$4,'2026-10-10',$5)",
          [org, client, subscriptionId, state, state === "failed" ? "2026-10-10" : null]);
        assert.deepEqual(await due(true), [], state + " requires recovery, never automatic re-pull");
      }
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
    }
  });
