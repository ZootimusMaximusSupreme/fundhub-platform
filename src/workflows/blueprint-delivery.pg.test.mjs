// Only a local named scratch/test database is allowed. Every fixture is a
// transaction-local shadow of the migrated tables; nothing calls a provider.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { dueClients } from "./finance-os-pull-sweeper.mjs";
import { financeOsEntitlement } from "../finance/finance-os-entitlement.mjs";
import { assignCsmForBlueprintPurchase, pickCsmStaffId } from "../blueprint/assign-csm.mjs";
import { fulfilQueuedSystemPulls } from "../finance/finance-os-pull-fulfil.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local scratch database configured */ }
const options = { skip: safe ? false : "no local test/scratch database; live databases refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

async function fixture(tables, run) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of tables) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    return await run(db);
  } finally { await db.query("ROLLBACK"); db.release(); }
}

test("a real annual subscription permits another refresh at day30/day60 and stops at its end", options, async () => {
  await fixture(["subscriptions", "soft_pull_requests"], async (db) => {
    const org = randomUUID();
    const client = randomUUID();
    const sub = (await db.query(`INSERT INTO subscriptions
      (org_id, client_id, tier, status, current_period_start, current_period_end, effective_from)
      VALUES ($1,$2,'finance-os','active','2026-01-01','2027-01-01','2026-01-01') RETURNING id`, [org, client])).rows[0].id;
    const request = (at) => db.query(`INSERT INTO soft_pull_requests
      (org_id, client_id, subscription_id, requested_by_kind, reason, status, requested_at, resolved_at, crs_result_id)
      VALUES ($1,$2,$3,'system','Included monthly refresh','fulfilled',$4,$4,$5)`, [org, client, sub, at, randomUUID()]);
    const due = async (at) => (await dueClients(db, new Date(at))).some((row) => row.subscription_id === sub);
    assert.equal(await due("2025-12-31"), false);
    assert.equal(await due("2026-01-01"), true);
    await request("2026-01-01T00:00:00Z");
    assert.equal(await due("2026-01-30T23:59:59.999Z"), false);
    assert.equal(await due("2026-01-31T00:00:00Z"), true);
    await request("2026-01-31T00:00:00Z");
    assert.equal(await due("2026-03-01T23:59:59.999Z"), false);
    assert.equal(await due("2026-03-02T00:00:00Z"), true);
    assert.equal(await due("2027-01-01T00:00:00Z"), false);
    assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: client, asOf: new Date("2026-12-31") })).entitled, true);
    assert.equal((await financeOsEntitlement(db, { orgId: org, clientId: client, asOf: new Date("2027-01-01") })).entitled, false);
    await db.query("UPDATE subscriptions SET status = 'past_due' WHERE id = $1", [sub]);
    assert.equal(await due("2026-03-02"), false);
  });
});

test("real staff eligibility excludes demo, disabled and suspended rows and missing staff stays observable", options, async () => {
  await fixture(["staff", "clients", "tasks"], async (db) => {
    const org = randomUUID();
    const otherOrg = randomUUID();
    const client = (await db.query(`INSERT INTO clients (org_id, first_name, email)
      VALUES ($1,'Blueprint',$2) RETURNING id`, [org, `e2e+aff-delivery-${randomUUID()}@example.com`])).rows[0].id;
    const staff = async (name, status, active, demo, scopedOrg = org) => (await db.query(`INSERT INTO staff
      (org_id, name, role, status, active, is_demo) VALUES ($1,$2,'csm',$3,$4,$5) RETURNING id`,
    [scopedOrg, name, status, active, demo])).rows[0].id;
    const demo = await staff("Demo", "active", true, true);
    await staff("Disabled", "active", false, false);
    await staff("Suspended", "suspended", true, false);
    await staff("Other company", "active", true, false, otherOrg);
    const real = await staff("Real advisor", "active", true, false);
    assert.equal(await pickCsmStaffId(db, { orgId: org }), real);
    const input = { orgId: org, clientId: client, productCode: "consulting-package" };
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).staffId, real);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "already_assigned");
    await db.query("UPDATE clients SET assigned_csm_staff_id = $2 WHERE id = $1", [client, demo]);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "assignment_unavailable");
    assert.equal((await db.query("SELECT assigned_csm_staff_id FROM clients WHERE id=$1", [client])).rows[0].assigned_csm_staff_id, demo);
    await db.query("UPDATE clients SET assigned_csm_staff_id = NULL WHERE id=$1", [client]);
    await db.query("UPDATE staff SET active = false WHERE id=$1", [real]);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "no_active_csm");
    await db.query("UPDATE tasks SET done=true WHERE client_id=$1", [client]);
    await assignCsmForBlueprintPurchase(db, input);
    const tasks = (await db.query("SELECT * FROM tasks WHERE org_id=$1 AND client_id=$2", [org, client])).rows;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assignee_role, "owner");
    assert.equal(tasks[0].done, false);
  });
});

test("a saved successful pull with failed delivery creates owner work and is not pulled again", options, async () => {
  await fixture(["soft_pull_requests", "tasks"], async (db) => {
    const org = randomUUID();
    const client = randomUUID();
    const credit = randomUUID();
    const request = (await db.query(`INSERT INTO soft_pull_requests
      (org_id, client_id, requested_by_kind, reason, status)
      VALUES ($1,$2,'system','Included monthly refresh','queued') RETURNING id`, [org, client])).rows[0].id;
    let calls = 0;
    const input = {
      runPull: async () => {
        calls += 1;
        await db.query(`UPDATE soft_pull_requests SET status='fulfilled', resolved_at=now(), crs_result_id=$2 WHERE id=$1`, [request, credit]);
        return { ok: true, crsResultId: credit };
      },
      aftercare: async () => ({ ok: false, failures: [{ phase: "letterPack", error: "storage unavailable" }] })
    };
    const out = await fulfilQueuedSystemPulls(db, input);
    assert.equal(out.ok, false);
    assert.equal(out.fulfilled, 1);
    const tasks = (await db.query("SELECT * FROM tasks WHERE org_id=$1 AND client_id=$2", [org, client])).rows;
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].assignee_role, "owner");
    assert.match(tasks[0].detail, new RegExp(credit));
    await fulfilQueuedSystemPulls(db, input);
    assert.equal(calls, 1, "delivery recovery must reuse the saved credit result");
  });
});
