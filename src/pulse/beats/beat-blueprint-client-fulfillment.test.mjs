import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import * as beat from "./beat-blueprint-client-fulfillment.mjs";
import { validateBeat, pinBeatSource, checkBeatSelfTest, runBeat } from "./contract.mjs";
import { makeFakeCtx, ctxLog } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import { TRIPWIRES } from "../tripwires.mjs";
import { SHIFTS } from "./shifts.mjs";
import { CLOCK_JOBS } from "../heartbeats.mjs";
import { isLocalScratchDatabaseUrl } from "../../verification/scratch-guard.mjs";
import { fulfillPaidBlueprintHelp } from "../../blueprint/client-services.mjs";

const world = (step, rows) => ({read:beat.selfTest.pass().read.map(entry =>
  step && String(entry.match).includes(step) ? {...entry,rows} : entry)});
const go = fixture => runBeat(beat,makeFakeCtx(beat,fixture || world()));

test("full Blueprint beat satisfies the contract, read-only source pin and both self-tests", async () => {
  assert.deepEqual(validateBeat(beat,{file:"beat-blueprint-client-fulfillment.mjs"}),[]);
  assert.deepEqual(pinBeatSource(readFileSync(new URL("./beat-blueprint-client-fulfillment.mjs",import.meta.url),"utf8")),[]);
  assert.deepEqual(await checkBeatSelfTest(beat),[]);
  assert.deepEqual(beat.CHECK_IDS,beat.steps.map(step=>`blueprint-full:${step}`));
  assert.deepEqual(beat.CHECKS.map(([step])=>step),beat.steps);
  for (const sql of [beat.ORG_SQL,...beat.CHECKS.map(([,sql])=>sql)]) assert.doesNotThrow(()=>assertReadOnlySql(sql));
});

test("every new surface names real checks, and the beat runs once beside existing Blueprint coverage", () => {
  const checkIds=new Set(beat.CHECK_IDS);
  for (const surface of beat.covers) assert.ok(TRIPWIRES[surface].checks.some(id=>checkIds.has(id)),surface);
  const shifts=Object.entries(SHIFTS).filter(([,shift])=>shift.beats.includes(beat.id));
  assert.equal(shifts.length,1);
  assert.ok(shifts[0][1].beats.includes("blueprint-delivery"));
  assert.deepEqual(CLOCK_JOBS.find(([id])=>id==="blueprint-bank-evidence"),["blueprint-bank-evidence","17 * * * *"]);
});

test("empty/healthy scoped counts run all eight checks with no HTTP or provider calls", async () => {
  const ctx=makeFakeCtx(beat,world());
  const out=await runBeat(beat,ctx);
  assert.equal(out.ok,true,out.detail);
  assert.deepEqual(out.notRun,[]);
  const log=ctxLog(ctx);
  assert.equal(log.reads.length,9);
  assert.equal(log.http.length,0);
  for (const {params} of log.reads.slice(1)) assert.deepEqual(params,
    ["00000000-0000-4000-8000-000000000001",ctx.now.toISOString(),beat.TEST_CLIENT_EMAIL_RE]);
  assert.match(out.detail,/Normal client and bureau waiting is allowed/);
  assert.match(out.detail,/not provider-delivery proof/);
});

for (const step of beat.steps) {
  test(`${step}: positive count goes red at its exact step`,async()=>{
    const out=await go(world(`blueprint-full:${step}`,[{n:"2"}]));
    assert.equal(out.ok,false);
    assert.equal(out.step,step);
    assert.match(out.detail,/^2 /);
  });
  test(`${step}: failed reads and malformed counts never become green`,async()=>{
    for (const raw of [undefined,null,"",false,-1,0.5,{},"private-client@secret.com"]){
      const out=await go(world(`blueprint-full:${step}`,raw===undefined ? [] : [{n:raw}]));
      assert.equal(out.ok,false);
      assert.equal(out.step,step);
      assert.doesNotMatch(out.detail,/private-client|secret.com/);
    }
    const fixture=world();
    fixture.read=fixture.read.map(entry=>String(entry.match).includes(`blueprint-full:${step}`)
      ? {...entry,error:new Error("private storage unavailable")} : entry);
    const out=await go(fixture);
    assert.equal(out.ok,false);
    assert.equal(out.step,step);
    assert.doesNotMatch(out.detail,/private storage/);
  });
}

test("unknown or ambiguous company identity fails before reading client files",async()=>{
  for(const rows of [[],[{id:"wrong"}],[{id:null}],
    [{id:randomUUID()},{id:randomUUID()}]]){
    const ctx=makeFakeCtx(beat,world("FROM orgs",rows));
    const out=await runBeat(beat,ctx);
    assert.equal(out.ok,false);
    assert.equal(out.step,"paid-installation");
    assert.equal(ctxLog(ctx).reads.length,1);
  }
});

const ownerUrl=process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const scratch=isLocalScratchDatabaseUrl(ownerUrl);
test("real scratch PostgreSQL: every full Blueprint query has a healthy and broken result under fundhub_app",{skip:!scratch},async t=>{
  const db=new pg.Client({connectionString:ownerUrl,ssl:false});
  await db.connect();
  try{
    await db.query("BEGIN");
    const org=randomUUID(),client=randomUUID(),foreign=randomUUID(),account=randomUUID(),transaction=randomUUID();
    const now=new Date();
    await db.query("INSERT INTO orgs(id,slug,name) VALUES($1,$2,'Heartbeat synthetic fixture')",[org,`heartbeat-${org}`]);
    await db.query("INSERT INTO clients(id,org_id,first_name) VALUES($1,$2,'Synthetic heartbeat'),($3,$2,'Other synthetic')",[client,org,foreign]);
    await db.query("INSERT INTO accounts(id,org_id,client_id,kind,status,email,password_hash) VALUES($1,$2,$3,'client','active',$4,'not-a-login')",[account,org,client,`${account}@example.invalid`]);
    await db.query("INSERT INTO products(org_id,code,name) VALUES($1,'blueprint-self-funding','Heartbeat full')",[org]);
    await db.query("INSERT INTO entitlement_catalog(org_id,code,name,kind) VALUES($1,'blueprint-client-fulfillment','Full','service')",[org]);
    await db.query("INSERT INTO transactions(id,org_id,client_id,product_name,amount_paid,status,created_at) VALUES($1,$2,$3,'Heartbeat full',30000,'succeeded',now()-interval '1 hour')",[transaction,org,client]);
    const count=async sql=>{
      assertReadOnlySql(sql);
      await db.query("SET LOCAL ROLE fundhub_app");
      assert.equal((await db.query("SELECT current_user AS role")).rows[0].role,"fundhub_app");
      const n=(await db.query(sql,[org,now,beat.TEST_CLIENT_EMAIL_RE])).rows[0].n;
      await db.query("RESET ROLE");
      return n;
    };
    await t.test("paid-installation: overdue real purchase goes red, exact paid grant installs once",async()=>{
      assert.equal(await count(beat.PAID_INSTALLATION_SQL),1);
      await db.query("INSERT INTO entitlements(org_id,client_id,entitlement_code,source_transaction_id) VALUES($1,$2,'blueprint-client-fulfillment',$3)",[org,client,transaction]);
      assert.equal(await count(beat.PAID_INSTALLATION_SQL),0);
    });
    const engagement=(await db.query("SELECT id FROM blueprint_fulfillment_engagements WHERE source_transaction_id=$1",[transaction])).rows[0].id;
    const isolated=async(name,fn)=>t.test(name,async()=>{
      await db.query("SAVEPOINT fixture");
      try{await fn();}finally{await db.query("ROLLBACK TO SAVEPOINT fixture");}
    });
    await isolated("round-access: healthy active engagement, terminal round with open access is red",async()=>{
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0);
      const round=(await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status,product) VALUES($1,$2,1,'closed','blueprint_self_funding') RETURNING id",[org,client])).rows[0].id;
      await db.query("UPDATE blueprint_fulfillment_engagements SET funding_round_id=$2 WHERE id=$1",[engagement,round]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1);
      await db.query("UPDATE blueprint_fulfillment_engagements SET status='completed',completed_at=now() WHERE id=$1",[engagement]);
      await db.query("UPDATE entitlements SET revoked_at=now(),revoke_reason='purchased_round_completed' WHERE source_transaction_id=$1",[transaction]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0,"completed round with revoked purchase access is healthy");
    });
    for (const existingRound of [false,true]) await isolated(`round-access: paid managed takeover ${existingRound ? "preserves the existing" : "creates its"} round, completion and exact receipt stay scoped`,async()=>{
      if(existingRound){
        const round=(await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status,product) VALUES($1,$2,1,'started','blueprint_self_funding') RETURNING id",[org,client])).rows[0].id;
        await db.query("UPDATE blueprint_fulfillment_engagements SET funding_round_id=$2 WHERE id=$1",[engagement,round]);
      }
      const target=(await db.query("SELECT funding_round_id FROM blueprint_fulfillment_engagements WHERE id=$1",[engagement])).rows[0].funding_round_id;
      const request=(await db.query(`INSERT INTO paid_service_requests(org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,
        status,price_components,price_total_cents,amount_paid_cents,payment_ref,paid_at)
        VALUES($1,$2,'blueprint_help','client',$3,'paid',$4,100,100,$5,now()) RETURNING id`,
        [org,client,account,JSON.stringify([{code:"funding_round",quantity:1,unit_cents:100,amount_cents:100}]),`takeover-${randomUUID()}`])).rows[0].id;
      await db.query(`INSERT INTO blueprint_client_services(id,org_id,client_id,engagement_id,service_kind,scope_type,target_id,
        state,authorized_account_id,authorized_at) VALUES($1,$2,$3,$4,'funding_round',$5,$6,'awaiting_payment',$7,now())`,
        [request,org,client,engagement,target ? "funding_round" : "engagement",target || engagement,account]);
      await db.query("SET LOCAL ROLE fundhub_app");
      const result=await fulfillPaidBlueprintHelp({query:(...args)=>db.query(...args)},{requestId:request,orgId:org});
      await db.query("RESET ROLE");
      assert.equal(result.ok,true,"the real paid-help path must activate the takeover");
      const managed=(await db.query("SELECT funding_round_id,execution_owner FROM blueprint_fulfillment_engagements WHERE id=$1",[engagement])).rows[0];
      assert.equal(managed.execution_owner,"fundhub");
      if(target) assert.equal(managed.funding_round_id,target,"the paid takeover preserves the exact existing round");
      assert.equal((await db.query("SELECT product FROM funding_rounds WHERE id=$1",[managed.funding_round_id])).rows[0].product,"blueprint_managed_funding");
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0,"an authorized exact paid takeover is healthy while active");
      await db.query("UPDATE funding_rounds SET product='blueprint_self_funding' WHERE id=$1",[managed.funding_round_id]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1,"Fundhub execution cannot retain the self-operated product");
      await db.query("UPDATE funding_rounds SET product='blueprint_managed_funding' WHERE id=$1",[managed.funding_round_id]);
      await db.query("UPDATE blueprint_client_services SET authorized_at=NULL WHERE id=$1",[request]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1,"a managed product alone does not prove an authorized takeover");
      await db.query("UPDATE blueprint_client_services SET authorized_at=now() WHERE id=$1",[request]);
      await db.query("UPDATE paid_service_requests SET amount_paid_cents=99 WHERE id=$1",[request]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1,"underpayment cannot authorize managed execution");
      await db.query("UPDATE paid_service_requests SET amount_paid_cents=100 WHERE id=$1",[request]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0);
      await db.query("UPDATE funding_rounds SET status='closed' WHERE id=$1",[managed.funding_round_id]);
      assert.equal((await db.query("SELECT status FROM blueprint_fulfillment_engagements WHERE id=$1",[engagement])).rows[0].status,"completed");
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0,"a completed managed round with stopped purchase access is healthy");
      await db.query("UPDATE paid_service_requests SET status='refunded',resolved_at=now() WHERE id=$1",[request]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1,"completed managed readback still requires its exact paid takeover receipt");
      await db.query("UPDATE paid_service_requests SET status='staged',resolved_at=NULL WHERE id=$1",[request]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),0);
      await db.query("UPDATE blueprint_fulfillment_engagements SET execution_owner='client' WHERE id=$1",[engagement]);
      assert.equal(await count(beat.ROUND_ACCESS_SQL),1,"a client-operated engagement cannot claim a managed round");
    });
    const report=(await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result,created_at) VALUES($1,$2,'crs_softview',gen_random_uuid()::text,$3,now()-interval '1 day') RETURNING id",[org,client,{environment:"production",bureauStatus:{EX:"file_returned"},bureaus:{EX:{inquiries:[{creditorName:"Bank One",date:"2026-10-12"}]}}}])).rows[0].id;
    const caseId=(await db.query("INSERT INTO inquiry_removal_cases(org_id,client_id,case_id,selected_bureaus_raw,case_status) VALUES($1,$2,$3,'EX','Queued') RETURNING id",[org,client,`heartbeat-${randomUUID()}`])).rows[0].id;
    const inquiry=(await db.query("INSERT INTO inquiry_log(org_id,client_id,bureau,inquiry,inquiry_name,case_id,inquiry_removal_case_id,status,is_open) VALUES($1,$2,'EX','Bank One','Bank One',$3,$3,'New',true) RETURNING id",[org,client,caseId])).rows[0].id;
    await db.query("INSERT INTO blueprint_inquiry_evidence(org_id,client_id,case_id,requested_account_id,baseline_report_id,baseline_items) VALUES($1,$2,$3,$4,$5,$6)",[org,client,caseId,account,report,JSON.stringify([{inquiryId:inquiry,bureau:"EX",name:"Bank One",date:"2026-10-12",sourceFound:true}])]);
    await isolated("funding-evidence: no handoff is normal, a wrong-client application link is red",async()=>{
      assert.equal(await count(beat.FUNDING_EVIDENCE_SQL),0);
      const lender=(await db.query("INSERT INTO lenders(org_id,lender_table,name,application_url) VALUES($1,'PersonalCC','Synthetic bank','https://bank.example.invalid') RETURNING id",[org])).rows[0].id;
      const round=(await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status,product) VALUES($1,$2,1,'started','blueprint_self_funding') RETURNING id",[org,foreign])).rows[0].id;
      const app=(await db.query("INSERT INTO applications(org_id,client_id,funding_round_id,lender_id,status) VALUES($1,$2,$3,$4,'Apply') RETURNING id",[org,foreign,round,lender])).rows[0].id;
      await db.query("INSERT INTO blueprint_funding_handoffs(engagement_id,org_id,client_id,lender_id,application_id,source_credit_report_id) VALUES($1,$2,$3,$4,$5,$6)",[engagement,org,client,lender,app,report]);
      assert.equal(await count(beat.FUNDING_EVIDENCE_SQL),1);
    });
    await isolated("inquiry-evidence: normal bureau wait is green, another client's verified report is red",async()=>{
      assert.equal(await count(beat.INQUIRY_EVIDENCE_SQL),0);
      const wrong=(await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result) VALUES($1,$2,'crs_softview',gen_random_uuid()::text,$3) RETURNING id",[org,foreign,{environment:"production",bureauStatus:{EX:"file_returned"},bureaus:{EX:{inquiries:[]}}}])).rows[0].id;
      await db.query("UPDATE inquiry_log SET is_open=false,removal_verified_at=now(),removal_verified_report_id=$2 WHERE id=$1",[inquiry,wrong]);
      assert.equal(await count(beat.INQUIRY_EVIDENCE_SQL),1);
      const correct=(await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result) VALUES($1,$2,'crs_softview',gen_random_uuid()::text,$3) RETURNING id",[org,client,{environment:"production",bureauStatus:{EX:"file_returned"},bureaus:{EX:{inquiries:[]}}}])).rows[0].id;
      await db.query("UPDATE inquiry_log SET removal_verified_report_id=$2 WHERE id=$1",[inquiry,correct]);
      assert.equal(await count(beat.INQUIRY_EVIDENCE_SQL),0,"a genuine same-file newer complete bureau report can prove absence");
      const present=(await db.query("INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result) VALUES($1,$2,'crs_softview',gen_random_uuid()::text,$3) RETURNING id",[org,client,{environment:"production",bureauStatus:{EX:"file_returned"},bureaus:{EX:{inquiries:[{creditorName:"Bank One",date:"2026-10-12"}]}}}])).rows[0].id;
      await db.query("UPDATE inquiry_log SET removal_verified_report_id=$2 WHERE id=$1",[inquiry,present]);
      assert.equal(await count(beat.INQUIRY_EVIDENCE_SQL),1,"a full report that still contains the exact inquiry does not prove removal");
    });
    await isolated("inquiry-calls: normal idle and fresh claim are green, stale and unknown calls are red",async()=>{
      assert.equal(await count(beat.INQUIRY_CALLS_SQL),0);
      await db.query("UPDATE blueprint_inquiry_evidence SET call_state='claimed',call_requested_at=now() WHERE case_id=$1",[caseId]);
      assert.equal(await count(beat.INQUIRY_CALLS_SQL),0);
      await db.query("UPDATE blueprint_inquiry_evidence SET call_requested_at=now()-interval '16 minutes' WHERE case_id=$1",[caseId]);
      assert.equal(await count(beat.INQUIRY_CALLS_SQL),1);
      await db.query("UPDATE blueprint_inquiry_evidence SET call_state='unknown',call_requested_at=now() WHERE case_id=$1",[caseId]);
      assert.equal(await count(beat.INQUIRY_CALLS_SQL),1);
    });
    const document=async(subtype)=>{
      const d=(await db.query("INSERT INTO documents(org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type,checksum) VALUES($1,$2,$3,'client_upload',$4,'Synthetic receipt','fixture','application/pdf',$5) RETURNING id",[org,client,randomUUID(),subtype,`sha256:${"a".repeat(64)}`])).rows[0].id;
      const v=(await db.query("INSERT INTO document_versions(org_id,document_id,version,storage_key,mime_type,checksum) VALUES($1,$2,1,'fixture','application/pdf',$3) RETURNING id",[org,d,`sha256:${"a".repeat(64)}`])).rows[0].id;
      await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1",[d,v]);return d;
    };
    await isolated("repair-evidence: scoped submission is green, its letter's wrong bureau/case is red",async()=>{
      const receipt=await document("repair_submission_receipt");
      const repairCase=(await db.query("INSERT INTO dispute_cases(org_id,client_id,bureau,round) VALUES($1,$2,'EX','R1') RETURNING id",[org,client])).rows[0].id;
      const letter=(await db.query("INSERT INTO dispute_letters(org_id,client_id,case_id,bureau,round,body_text) VALUES($1,$2,$3,'EX','R1','Synthetic fixture') RETURNING id",[org,client,repairCase])).rows[0].id;
      await db.query("INSERT INTO blueprint_repair_submissions(org_id,client_id,letter_id,requested_account_id,receipt_document_id,submission_reference,channel) VALUES($1,$2,$3,$4,$5,'fixture-reference','mail')",[org,client,letter,account,receipt]);
      assert.equal(await count(beat.REPAIR_EVIDENCE_SQL),0);
      await db.query("UPDATE dispute_letters SET bureau='TU' WHERE id=$1",[letter]);
      assert.equal(await count(beat.REPAIR_EVIDENCE_SQL),1);
    });
    await isolated("report-delivery: fresh queue is green, processing beyond 15 minutes is red",async()=>{
      const r=(await db.query("INSERT INTO soft_pull_requests(org_id,client_id,requested_by_kind,requested_by_account_id,reason,idempotency_key) VALUES($1,$2,'client',$3,'Synthetic report proof',$4) RETURNING id",[org,client,account,`blueprint-included:${engagement}:${randomUUID()}`])).rows[0].id;
      assert.equal(await count(beat.REPORT_DELIVERY_SQL),0);
      await db.query("UPDATE soft_pull_requests SET updated_at=now()-interval '60 minutes' WHERE id=$1",[r]);
      assert.equal(await count(beat.REPORT_DELIVERY_SQL),0,"queue permits its first hourly worker turn");
      await db.query("UPDATE soft_pull_requests SET updated_at=now()-interval '76 minutes' WHERE id=$1",[r]);
      assert.equal(await count(beat.REPORT_DELIVERY_SQL),1,"missing the worker turn is a failure");
      await db.query("UPDATE soft_pull_requests SET status='processing',updated_at=now()-interval '16 minutes' WHERE id=$1",[r]);
      assert.equal(await count(beat.REPORT_DELIVERY_SQL),1);
    });
    await isolated("paid-help: only an overdue exact owned successful receipt without applied service trips",async()=>{
      for (const provider of ["whop", "commas"]) {
        await db.query("SAVEPOINT receipt_rail");
        const request=(await db.query(`INSERT INTO paid_service_requests(org_id,client_id,service_kind,requested_by_kind,requested_by_account_id,
          status,price_total_cents,checkout_expires_at,price_components) VALUES($1,$2,'credit_pull','client',$3,'awaiting_payment',3200,now()+interval '7 days',
          '[{"code":"credit_pull","quantity":1,"unit_cents":3200,"amount_cents":3200}]') RETURNING id`,[org,client,account])).rows[0].id;
        const payment="pay_"+randomUUID().replaceAll("-","");
        await db.query(`INSERT INTO blueprint_client_services(id,org_id,client_id,engagement_id,service_kind,scope_type,target_id,
          state,authorized_at,authorized_account_id,checkout_provider,accepted_price_cents,checkout_currency,whop_account_id,whop_product_id,
          whop_checkout_configuration_id,whop_plan_id,whop_payment_id)
          VALUES($1,$2,$3,$4,'credit_pull','client',$3,'awaiting_payment',now(),$5,$6,3200,'USD',$7,$8,$9,$10,$11)`,
          [request,org,client,engagement,account,provider,...(provider==="whop"?["biz_fixture","prod_fixture","ch_fixture","plan_fixture",payment]:[null,null,null,null,null])]);
        const paymentEvent={paidServiceRequestId:request,ref:request,source:provider,productCode:"blueprint-help-credit_pull",
          paymentId:payment,...(provider==="whop"?{amountCents:3200}:{amount:32})};
        const insert=async(name,payload,minutes,person=client)=>db.query(`INSERT INTO events(org_id,client_id,name,payload,created_at)
          VALUES ($1,$2,$3,$4,$5::timestamptz-$6::int*interval '1 minute')`,[org,person,name,payload,now,minutes]);
        await insert("payment.received",paymentEvent,16,foreign);
        await insert("payment.received",{...paymentEvent,paidServiceRequestId:randomUUID()},16);
        await insert("payment.received",{...paymentEvent,source:"other"},16);
        await insert("payment.received",{...paymentEvent,amount:31,amountCents:3100},16);
        await insert("payment.received",paymentEvent,14);
        assert.equal(await count(beat.PAID_HELP_SQL),0,"foreign, mismatched or still within the 15-minute application grace");
        await insert("payment.received",paymentEvent,16);
        assert.equal(await count(beat.PAID_HELP_SQL),1,"canonical settled receipt is not applied to the still-unpaid local request");
        await insert("payment.refunded",{source:provider,originalProviderRef:"pay_other"},2);
        assert.equal(await count(beat.PAID_HELP_SQL),1,"a different reversal must not clear this stuck payment");
        await insert(provider==="whop"?"payment.refunded":"payment.disputed",{source:provider,paymentId:payment},2);
        assert.equal(await count(beat.PAID_HELP_SQL),0,"the matching reversal releases this warning");
        await db.query("ROLLBACK TO SAVEPOINT receipt_rail");
        await db.query("RELEASE SAVEPOINT receipt_rail");
      }
    });
    await isolated("paid-help: normal requested work is green, a paid request without its handoff after 15 minutes is red",async()=>{
      const request=(await db.query("INSERT INTO paid_service_requests(org_id,client_id,service_kind,requested_by_kind,requested_by_account_id) VALUES($1,$2,'blueprint_help','client',$3) RETURNING id",[org,client,account])).rows[0].id;
      await db.query("INSERT INTO blueprint_client_services(id,org_id,client_id,engagement_id,service_kind,scope_type,target_id) VALUES($1,$2,$3,$4,'repair_full','client',$3)",[request,org,client,engagement]);
      assert.equal(await count(beat.PAID_HELP_SQL),0);
      await db.query("UPDATE paid_service_requests SET status='paid',payment_ref='fixture-paid',paid_at=now()-interval '16 minutes',amount_paid_cents=100,price_total_cents=100,price_components='[{\"code\":\"repair_full\",\"quantity\":1,\"unit_cents\":100,\"amount_cents\":100}]' WHERE id=$1",[request]);
      await db.query("UPDATE blueprint_client_services SET authorized_account_id=$2,authorized_at=now() WHERE id=$1",[request,account]);
      assert.equal(await count(beat.PAID_HELP_SQL),1);
      await db.query("UPDATE paid_service_requests SET paid_at=now() WHERE id=$1",[request]);
      assert.equal(await count(beat.PAID_HELP_SQL),0,"a newly paid request gets its handoff window");
      const task=(await db.query("INSERT INTO tasks(org_id,client_id,title,body,source_workflow,assignee_role) VALUES($1,$2,'Synthetic help','another-request','blueprint-paid-help','inquiry_specialist') RETURNING id",[org,client])).rows[0].id;
      await db.query("UPDATE blueprint_client_services SET state='in_progress',payment_ref='fixture-paid',fulfillment_task_id=$2 WHERE id=$1",[request,task]);
      assert.equal(await count(beat.PAID_HELP_SQL),1,"a task for another purchased work item is not this handoff");
      await db.query("UPDATE tasks SET body=$2 WHERE id=$1",[task,`blueprint-paid-help:${request}`]);
      assert.equal(await count(beat.PAID_HELP_SQL),0,"the exact scoped paid-work task satisfies handoff");
      const financed=(await db.query(`INSERT INTO paid_service_requests(org_id,client_id,service_kind,requested_by_kind,
        requested_by_account_id,status,price_total_cents,amount_paid_cents,paid_at,payment_ref,price_components)
        VALUES($1,$2,'blueprint_help','client',$3,'paid',100,100,now(),'pay_Heartbeat',
          '[{"code":"funding_round","quantity":1,"unit_cents":100,"amount_cents":100}]') RETURNING id`,[org,client,account])).rows[0].id;
      await db.query(`INSERT INTO blueprint_client_services(id,org_id,client_id,engagement_id,service_kind,scope_type,target_id,
        state,authorized_at,authorized_account_id,checkout_provider,accepted_price_cents,checkout_currency,
        whop_account_id,whop_product_id,whop_checkout_configuration_id,whop_plan_id,whop_payment_id)
        VALUES($1,$2,$3,$4,'funding_round','engagement',$4,'awaiting_payment',now(),$5,'whop',100,'USD',
          'biz_Heartbeat','prod_Heartbeat','ch_Heartbeat','plan_Heartbeat','pay_Heartbeat')`,[financed,org,client,engagement,account]);
      assert.equal(await count(beat.PAID_HELP_SQL),0,'the frozen accepted Whop order and exact settled receipt are healthy');
      await db.query("UPDATE paid_service_requests SET payment_ref='pay_Another' WHERE id=$1",[financed]);
      assert.equal(await count(beat.PAID_HELP_SQL),1,'a different payment reference cannot prove the financed service');
    });
  }finally{
    await db.query("ROLLBACK");await db.end();
  }
});
