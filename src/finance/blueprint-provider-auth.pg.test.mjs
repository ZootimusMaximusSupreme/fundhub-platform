// Only isolated local disposable Postgres, transaction-local temp tables.
// No bureau call, checkout, production record or real message.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { fulfilQueuedSystemPulls } from "./finance-os-pull-fulfil.mjs";

const url = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const uri = new URL(url);
  safe = ["127.0.0.1","localhost","::1","[::1]"].includes(uri.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(uri.pathname);
} catch { /* refuses all non-test databases */ }
const pool = safe ? new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("monthly real provider checks current consent and paid access on disposable PG", { skip: !safe }, async () => {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    await db.query("CREATE TEMP TABLE subscriptions (LIKE public.subscriptions INCLUDING ALL) ON COMMIT DROP");
    await db.query("CREATE TEMP TABLE client_consents (LIKE public.client_consents INCLUDING ALL) ON COMMIT DROP");
    await db.query("CREATE TEMP TABLE soft_pull_requests (id uuid, org_id uuid, client_id uuid, subscription_id uuid, idempotency_key text, status text, requested_by_kind text, requested_at timestamptz) ON COMMIT DROP");
    const org=randomUUID(),client=randomUUID(),sub=randomUUID(),consent=randomUUID(),staff=randomUUID(),request=randomUUID();
    await db.query(`INSERT INTO subscriptions (id,org_id,client_id,tier,status,effective_from,current_period_start,current_period_end)
      VALUES ($1,$2,$3,'finance-os','active',now()-interval '1 day',now()-interval '1 day',now()+interval '365 days')`,[sub,org,client]);
    await db.query(`INSERT INTO client_consents (id,org_id,client_id,kind,consent_text,granted_by_kind,granted_by_staff_id,capture_method,granted_at)
      VALUES ($1,$2,$3,'soft_pull_consent','Exact saved authorization','staff',$4,'checkbox',now()-interval '1 day')`,[consent,org,client,staff]);
    await db.query(`INSERT INTO soft_pull_requests (id,org_id,client_id,subscription_id,idempotency_key,status,requested_by_kind,requested_at)
      VALUES ($1,$2,$3,$4,$5,'queued','system',now())`,[request,org,client,sub,`finance-os-monthly:${sub}:0:real`]);
    const LIVE={FINANCE_OS_SYSTEM_PULL_LIVE:"1",CRS_ALLOW_LIVE:"1"};
    let called=0;
    const run=(env=LIVE)=>fulfilQueuedSystemPulls(db,{env,
      runPull:async (_db,p)=>{assert.equal(p.simulate,false);called++;return {ok:true,simulated:false,crsResultId:randomUUID()};},
      aftercare:async()=>({ok:true}),createTaskImpl:async()=>({id:"stub"})});
    await db.query("UPDATE client_consents SET revoked_at=now(),revoked_reason='withdrawn' WHERE id=$1",[consent]);
    assert.equal((await run()).authorizationHolds[0].reason,"consent_no_longer_valid");
    await db.query(`INSERT INTO client_consents (org_id,client_id,kind,consent_text,granted_by_kind,granted_by_staff_id,capture_method,granted_at,expires_at)
      VALUES ($1,$2,'soft_pull_consent','Current consent','staff',$3,'checkbox',now()-interval '1 minute',now()+interval '1 hour')`,[org,client,staff]);
    await db.query("UPDATE subscriptions SET current_period_end=now()-interval '1 second' WHERE id=$1",[sub]);
    assert.equal((await run()).authorizationHolds[0].reason,"paid_access_no_longer_valid");
    await db.query("UPDATE subscriptions SET current_period_end=now()+interval '365 days' WHERE id=$1",[sub]);
    await db.query("UPDATE soft_pull_requests SET idempotency_key=$2 WHERE id=$1",[request,`finance-os-monthly:${sub}:0`]);
    assert.equal((await run()).authorizationHolds[0].reason,"request_not_explicitly_real");
    await db.query("UPDATE soft_pull_requests SET idempotency_key=$2 WHERE id=$1",[request,`finance-os-monthly:${sub}:0:real`]);
    assert.equal((await run({})).authorizationHolds[0].reason,"live_flags_disabled_for_real_request");
    assert.equal(called,0);
    assert.equal((await run()).fulfilled,1);
    assert.equal(called,1);
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
