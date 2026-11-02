// Only a local named scratch/test database is allowed. Every fixture is a
// transaction-local shadow of the migrated tables; nothing calls a provider.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { dueClients, monthlyPullKey } from "./finance-os-pull-sweeper.mjs";
import { financeOsEntitlement } from "../finance/finance-os-entitlement.mjs";
import { assignCsmForBlueprintPurchase, pickCsmStaffId } from "../blueprint/assign-csm.mjs";
import { fulfilQueuedSystemPulls, MONTHLY_PROVIDER_EXCEPTION_SOURCE } from "../finance/finance-os-pull-fulfil.mjs";

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
    const base = { orgId: org, clientId: client, productCode: "consulting-package" };
    // Owner-set 2026-10-20: with the switch off (default) a real, active,
    // non-demo CSM row is still not auto-assigned and no owner task is raised.
    assert.equal((await assignCsmForBlueprintPurchase(db, base)).reason, "ai_csm");
    assert.equal((await db.query("SELECT assigned_csm_staff_id FROM clients WHERE id=$1", [client])).rows[0].assigned_csm_staff_id, null);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks WHERE client_id=$1", [client])).rows[0].n, 0);
    const input = { ...base, autoAssign: true };
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).staffId, real);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "already_assigned");
    await db.query("UPDATE clients SET assigned_csm_staff_id = $2 WHERE id = $1", [client, demo]);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "assignment_unavailable");
    assert.equal((await db.query("SELECT assigned_csm_staff_id FROM clients WHERE id=$1", [client])).rows[0].assigned_csm_staff_id, demo);
    await db.query("UPDATE tasks SET done=true WHERE client_id=$1", [client]);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "assignment_unavailable");
    await db.query("UPDATE clients SET assigned_csm_staff_id = NULL WHERE id=$1", [client]);
    await db.query("UPDATE staff SET active = false WHERE id=$1", [real]);
    assert.equal((await assignCsmForBlueprintPurchase(db, input)).reason, "ai_csm");
    const tasks = (await db.query("SELECT * FROM tasks WHERE org_id=$1 AND client_id=$2", [org, client])).rows;
    assert.equal(tasks.length, 1, "only the broken saved link raised owner work; no CSM is not a task");
    assert.equal(tasks[0].assignee_role, "owner");
    assert.equal(tasks[0].done, false, "a recurring broken link reopens its owner task");
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

test("Blueprint: a fulfilled rehearsal cannot consume a real monthly refresh, but genuine and unresolved requests still block", options, async () => {
  await fixture(["soft_pull_requests", "tasks", "entitlements"], async (db) => {
    // Keep the request/review columns, defaults and constraints schema-faithful.
    // All writes stay in these transaction-local shadows; no bureau is contacted.
    await db.query("SET LOCAL search_path TO pg_temp, public");
    // This case owns one paid subscription; unrelated Blueprint grants must not
    // add other due clients when the clock advances beyond the 30-day window.
    await db.query("CREATE TEMP TABLE subscriptions (id uuid,org_id uuid,client_id uuid,tier text,status text,effective_from timestamptz,effective_to timestamptz,current_period_start timestamptz,current_period_end timestamptz) ON COMMIT DROP");
    await db.query("CREATE TEMP TABLE crs_results (id uuid,org_id uuid,client_id uuid,provider text,result jsonb) ON COMMIT DROP");
    const org = randomUUID(), client = randomUUID(), sub = randomUUID(), sim = randomUUID(), genuine = randomUUID();
    await db.query("INSERT INTO subscriptions (id,org_id,client_id,tier,status,effective_from,current_period_start,current_period_end) VALUES ($1,$2,$3,'finance-os','active','2026-10-01','2026-10-01','2026-12-31')", [sub,org,client]);
    await db.query("INSERT INTO crs_results (id,org_id,client_id,provider,result) VALUES ($1,$2,$3,'crs_softview_simulated',$4::jsonb)", [sim,org,client,JSON.stringify({ simulated:true, environment:"sandbox" })]);
    const request = async (status, requestedAt, resultId = null, key = null) => (await db.query(`
      INSERT INTO soft_pull_requests
        (org_id,client_id,subscription_id,idempotency_key,requested_by_kind,reason,
         requested_at,status,resolved_at,crs_result_id)
      VALUES ($1,$2,$3,$4,'system','Included monthly refresh',$5,$6,$5,$7) RETURNING id`,
    [org,client,sub,key,requestedAt,status,resultId])).rows[0].id;
    await request("fulfilled", "2026-10-10", sim);
    const at = new Date("2026-10-12T00:00:00Z");
    assert.deepEqual(await dueClients(db,at), [], "rehearsal mode must not create repeated simulations every day");
    assert.deepEqual((await dueClients(db,at,{realPull:true})).map(r=>r.subscription_id),[sub], "real request due despite past simulated fulfillment");
    await db.query("INSERT INTO crs_results (id,org_id,client_id,provider,result) VALUES ($1,$2,$3,'crs_softview',$4::jsonb)",[genuine,org,client,JSON.stringify({ simulated:false, environment:"production" })]);
    await request("fulfilled", "2026-10-11", genuine);
    assert.deepEqual(await dueClients(db,at,{realPull:true}),[], "one actual fresh result prevents duplicate bureau requests");
    await db.query("DELETE FROM soft_pull_requests WHERE crs_result_id = $1",[genuine]);
    const failedKey = monthlyPullKey({ subscription_id: sub, current_period_start: "2026-10-01" },
      new Date("2026-10-11T00:00:00Z"), { realPull: true });
    const failed = await request("failed", "2026-10-11", null, failedKey);
    assert.deepEqual(await dueClients(db,at,{realPull:true}),[], "failed outcome demands recovery instead of silent redial");
    const later = new Date("2026-11-12T00:00:00Z");
    assert.deepEqual(await dueClients(db,later,{realPull:true}),[], "an unresolved real monthly failure still blocks after 30 days");
    const review = async ({ orgId = org, clientId = client, workflow = MONTHLY_PROVIDER_EXCEPTION_SOURCE,
      requestId = failed, done = true } = {}) => (await db.query(`INSERT INTO tasks
      (org_id,client_id,title,source_workflow,body,done,assignee_role)
      VALUES ($1,$2,'Reconcile monthly provider outcome',$3,$4,$5,'owner') RETURNING id`,
    [orgId,clientId,workflow,`finance-os-monthly-provider:${requestId}`,done])).rows[0].id;
    for (const [label, overrides] of [
      ["another tenant's", { orgId: randomUUID() }],
      ["another client's", { clientId: randomUUID() }],
      ["another workflow's", { workflow: "unrelated-provider-review" }],
      ["another request's", { requestId: randomUUID() }]
    ]) {
      const task = await review(overrides);
      assert.deepEqual(await dueClients(db,later,{realPull:true}),[], `${label} completed task cannot release this request`);
      // The real task dedupe key omits org_id; isolate each negative without weakening it.
      await db.query("DELETE FROM tasks WHERE id=$1", [task]);
    }
    const matching = await review({ done: false });
    assert.deepEqual(await dueClients(db,later,{realPull:true}),[], "the exact unfinished review still blocks redial");
    await db.query("UPDATE tasks SET done=true WHERE id=$1", [matching]);
    assert.deepEqual((await dueClients(db,later,{realPull:true})).map(r=>r.subscription_id),[sub],
      "only the completed same-org/client/workflow/request review releases the old failure");
    assert.deepEqual(await dueClients(db,at,{realPull:true}),[], "completed review does not waive the 30-day cadence");
    await db.query("DELETE FROM soft_pull_requests WHERE status='failed'");
    assert.deepEqual((await dueClients(db,at,{realPull:true})).map(r=>r.subscription_id),[sub]);
    assert.deepEqual(await dueClients(db,new Date("2027-01-01T00:00:00Z"),{realPull:true}),[], "expired included access cannot order next year's pull");
  });
});
