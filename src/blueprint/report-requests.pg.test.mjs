import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { isLocalScratchDatabaseUrl } from '../verification/scratch-guard.mjs';
import { grant } from '../entitlements/entitlements.mjs';
import { captureConsent } from '../consent/index.mjs';
import { runCrsPull } from '../finance/crs-pull.mjs';
import { claimSoftPull } from '../finance/soft-pulls.mjs';
import { requestBlueprintReport } from './client-services.mjs';
import { processBlueprintClientServices } from './report-requests.mjs';
import { authorizeBlueprintReportExecution } from './report-allowance.mjs';
import { financeOsEntitlement } from '../finance/finance-os-entitlement.mjs';

const url = process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
const enabled = isLocalScratchDatabaseUrl(url);
const env = { CRS_ALLOW_LIVE: '1', FINANCE_OS_SYSTEM_PULL_LIVE: '1' };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function fixture(t) {
  const db = new pg.Pool({ connectionString: url, ssl: false, max: 6 });
  assert.equal((await db.query('select current_user')).rows[0].current_user, 'fundhub_app');
  const orgId = (await db.query('SELECT id FROM orgs ORDER BY created_at LIMIT 1')).rows[0].id;
  const clientId = (await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Report regression',$2) RETURNING id", [orgId, `worker-${randomUUID()}@example.test`])).rows[0].id;
  const accountId = (await db.query("INSERT INTO accounts(org_id,kind,email,status,client_id,password_hash) VALUES($1,'client',$2,'active',$3,'fixture') RETURNING id", [orgId, `worker-account-${randomUUID()}@example.test`,clientId])).rows[0].id;
  const transactionId = (await db.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) SELECT $1,$2,name,30000,'succeeded' FROM products WHERE org_id=$1 AND code='blueprint-self-funding' RETURNING id", [orgId,clientId])).rows[0].id;
  await grant(db,{orgId,clientId,code:'blueprint-client-fulfillment',sourceTransactionId:transactionId});
  const engagement = (await db.query('SELECT id,status FROM blueprint_fulfillment_engagements WHERE source_transaction_id=$1',[transactionId])).rows[0];
  await captureConsent(db,{orgId,clientId,kind:'soft_pull_consent',consentText:'I authorize Fundhub to obtain my consumer credit report through a soft inquiry.',consentVersion:'soft-pull-v1',grantedBy:{kind:'client',id:accountId},captureMethod:'checkbox'});
  t.after(async () => {
    await db.query("UPDATE soft_pull_requests SET status='cancelled',resolved_at=now() WHERE client_id=$1 AND status IN ('queued','processing')",[clientId]);
    await db.query("UPDATE accounts SET status='suspended' WHERE client_id=$1",[clientId]);
    await db.end();
  });
  return {db,scope:{orgId,clientId,accountId,engagement,now:new Date()}};
}

test('overlapping report workers preserve the winner and save one provider result', {skip:!enabled,timeout:20000}, async t => {
  const {db,scope} = await fixture(t);
  const request = await requestBlueprintReport(db,scope,{idempotencyKey:'worker-race-'+scope.clientId});
  const entered = deferred();
  const release = deferred();
  const bothSelected = deferred();
  let selects = 0;
  let orders = 0;
  // Both workers read the actual queued row before either can claim it.
  const workerDb = {query:async (sql,params) => {
    const result = await db.query(sql,params);
    if (/SELECT r\.\* FROM soft_pull_requests r/.test(sql)) {
      selects++;
      if (selects === 2) bothSelected.resolve();
      await bothSelected.promise;
    }
    return result;
  }};
  const provider = {host:'api-sandbox.stitchcredit.com',config:{missing:[]},isConfigured:()=>true,
    async orderPrequal() {
      orders++; entered.resolve(); await release.promise;
      return {ok:true,requestId:'fixture-'+request.reportRequestId,report:{scores:[{score:720,modelName:'FICO9'}],tradelines:[],inquiries:[]}};
    }};
  const options = {env,runPull:(_db,input)=>runCrsPull(db,{...input,client:provider,bureaus:['TU']}),aftercare:async()=>({ok:true})};
  const first = processBlueprintClientServices(workerDb,options);
  const second = processBlueprintClientServices(workerDb,options);
  await entered.promise;
  const loser = await Promise.race([first,second]);
  assert.equal(loser.waiting,1);
  assert.equal(loser.errors.length,0);
  assert.equal((await db.query('SELECT status FROM soft_pull_requests WHERE id=$1',[request.reportRequestId])).rows[0].status,'processing');
  release.resolve();
  const results = await Promise.all([first,second]);
  assert.equal(results.reduce((sum,r)=>sum+r.fulfilled,0),1);
  assert.equal(orders,1);
  const saved = (await db.query('SELECT status,crs_result_id FROM soft_pull_requests WHERE id=$1',[request.reportRequestId])).rows[0];
  assert.equal(saved.status,'fulfilled'); assert.ok(saved.crs_result_id);
});

test('an uncertain report error preserves the active claim for receipt reconciliation', {skip:!enabled}, async t => {
  const {db,scope} = await fixture(t);
  const request = await requestBlueprintReport(db,scope,{idempotencyKey:'worker-uncertain-'+scope.clientId});
  const result = await processBlueprintClientServices(db,{env,runPull:async (_db,input)=>{
    assert.equal((await claimSoftPull(db,input)).claimed,true);
    throw new Error('Fixture storage timeout after provider acceptance');
  }});
  assert.equal(result.errors.length,1);
  assert.equal((await db.query('SELECT status FROM soft_pull_requests WHERE id=$1',[request.reportRequestId])).rows[0].status,'processing');
  const review = await db.query("SELECT id FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-report-delivery'",[scope.clientId]);
  assert.equal(review.rows.length,1);
});

test('a paid report cannot fall back to included access after payment reversal', async () => {
  const ledger = {blueprint_engagement_id:randomUUID(),blueprint_report_kind:'paid',org_id:randomUUID(),client_id:randomUUID(),blueprint_service_request_id:randomUUID()};
  const db = {query:async()=>({rows:[{status:'active',purchase_status:'succeeded',revoked_at:null,service_status:'refunded',payment_status:'refunded',payment_ref:'fixture-ref',price_total_cents:3200,amount_paid_cents:3200}]})};
  await assert.rejects(authorizeBlueprintReportExecution(db,ledger),{code:'blueprint_report_access_ended'});
  await authorizeBlueprintReportExecution(db,{...ledger,blueprint_report_kind:'included'});
});

test('included report access requires the original full-package grant to remain valid', {skip:!enabled}, async t => {
  const {db,scope} = await fixture(t);
  assert.equal((await financeOsEntitlement(db,scope)).entitled,true);
  await db.query("UPDATE entitlements SET revoked_at=now(),revoke_reason='fixture_receipt_reversed' WHERE org_id=$1 AND client_id=$2",[scope.orgId,scope.clientId]);
  assert.equal((await db.query('SELECT status FROM blueprint_fulfillment_engagements WHERE id=$1',[scope.engagement.id])).rows[0].status,'active');
  assert.equal((await financeOsEntitlement(db,scope)).entitled,false);
});
