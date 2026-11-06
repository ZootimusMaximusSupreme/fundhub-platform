import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { grant } from "../entitlements/entitlements.mjs";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { getBlueprintFulfillmentAccess } from "./fulfillment-access.mjs";
import { requestBlueprintHelp,quoteBlueprintHelp,checkoutBlueprintHelp,readActiveBlueprintServices } from "./client-services.mjs";
import { onPaidServicePaymentReceived } from "../handlers/paid-service-payment.mjs";
import { reconcilePaidBlueprintHelpCompletion } from "./service-completion.mjs";

const url=process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
test("paid help only releases its customer when the exact inquiry case or repair round has independent terminal evidence",
  {skip:!isLocalScratchDatabaseUrl(url)}, async()=>{
  const pool=new pg.Pool({connectionString:url,max:1}),db=await pool.connect();
  try {
    await db.query("BEGIN");
    const orgId=(await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
    const clientId=(await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Scoped service',$2) RETURNING id",[orgId,"help+"+randomUUID()+"@example.test"])).rows[0].id;
    const accountId=(await db.query("INSERT INTO accounts(kind,client_id,org_id,email,status,password_hash) VALUES('client',$1,$2,$3,'active','synthetic') RETURNING id",[clientId,orgId,"acct+"+randomUUID()+"@example.test"])).rows[0].id;
    const staffId=(await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Scoped CSM','csm','active') RETURNING id",[orgId])).rows[0].id;
    const transactionId=(await db.query("INSERT INTO transactions(org_id,client_id,product_name,amount_paid,status) VALUES($1,$2,'blueprint-self-funding',30000,'succeeded') RETURNING id",[orgId,clientId])).rows[0].id;
    await grant(db,{orgId,clientId,code:"blueprint-client-fulfillment",sourceTransactionId:transactionId});
    const scope={orgId,clientId,accountId,engagement:await getBlueprintFulfillmentAccess(db,{orgId,clientId}),now:new Date()};
    async function buy(kind,targetId) {
      const help=await requestBlueprintHelp(db,scope,{serviceKind:kind,targetId,idempotencyKey:"synthetic_"+randomUUID()});
      if (!help.request.priceCents) await quoteBlueprintHelp(db,{...scope,staffId},{requestId:help.request.id,priceCents:99000});
      const link=await checkoutBlueprintHelp(db,scope,{requestId:help.request.id,authorization:true},{mint:async()=>({ok:true,checkoutUrl:"https://checkout.example.test"})});
      const amount=link.request.priceCents;
      const event={orgId,clientId,payload:{ref:help.request.id,amountCents:amount,paymentId:"help-"+help.request.id,currency:"USD"}};
      const payment=await onPaidServicePaymentReceived(event,db);
      assert.equal(payment.done,true);
      return help.request.id;
    }
    const reconcile = requestId=>reconcilePaidBlueprintHelpCompletion(db,{orgId,requestId});
    const receipt=async id=>(await db.query("SELECT status,produced_kind,produced_ref FROM paid_service_requests WHERE id=$1 AND org_id=$2",[id,orgId])).rows[0];
    const iq=(await db.query("INSERT INTO inquiry_removal_cases(org_id,client_id,case_id,selected_bureaus_raw) VALUES($1,$2,$3,'EX') RETURNING id",[orgId,clientId,"scope-"+randomUUID()])).rows[0].id;
    const item=(await db.query("INSERT INTO inquiry_log(org_id,client_id,case_id,inquiry_removal_case_id,bureau,status,is_open) VALUES($1,$2,$3,$3,'EX','Open',true) RETURNING id",[orgId,clientId,iq])).rows[0].id;
    const inquiry=await buy("inquiry_removal",iq);
    await db.query("UPDATE tasks SET done=true WHERE id=(SELECT fulfillment_task_id FROM blueprint_client_services WHERE id=$1)",[inquiry]);
    assert.equal((await reconcile(inquiry)).completed,0);
    await db.query("UPDATE inquiry_removal_cases SET case_status='Completed',completed_at=now() WHERE id=$1",[iq]);
    await db.query("UPDATE inquiry_log SET status='Cleared',is_open=false WHERE id=$1",[item]);
    assert.equal((await reconcile(inquiry)).completed,0);
    const cr=(await db.query("INSERT INTO crs_results(org_id,client_id,result,is_demo) VALUES($1,$2,$3,false) RETURNING id",[orgId,clientId,{scores:{ex:720}}])).rows[0].id;
    await db.query("UPDATE inquiry_log SET removal_verified_at=now(),removal_verified_report_id=$2 WHERE id=$1",[item,cr]);
    assert.equal((await reconcile(inquiry)).completed,1);
    assert.deepEqual(await receipt(inquiry),{status:"fulfilled",produced_kind:"inquiry_case",produced_ref:iq});
    const repairCase=(await db.query("INSERT INTO dispute_cases(org_id,client_id,bureau,round) VALUES($1,$2,'EX','R1') RETURNING id",[orgId,clientId])).rows[0].id;
    const repairItem=(await db.query("INSERT INTO dispute_items(org_id,client_id,case_id,rule_id,severity,round,status) VALUES($1,$2,$3,'synthetic','medium','R1','open') RETURNING id",[orgId,clientId,repairCase])).rows[0].id;
    const program=(await db.query("INSERT INTO repair_programs(org_id,client_id,program,rounds_cap,price_total,status) VALUES($1,$2,'full',6,1000,'active') RETURNING id",[orgId,clientId])).rows[0].id;
    const roundHelp=await buy("repair_round",repairCase);
    const fullHelp=await buy("repair_full",clientId);
    await db.query(`INSERT INTO dispute_letters(org_id,client_id,case_id,bureau,round,status,body_text,send_claimed_at,mailed_at,postgrid_letter_id)
       VALUES($1,$2,$3,'EX','R1','sent','Synthetic letter',now(),now(),$4)`,[orgId,clientId,repairCase,"synthetic-"+randomUUID()]);
    const doc=randomUUID(),version=randomUUID();
    const metadata={bureau_response_validation:{schema:1,validator:"bureau-response-reader",document_id:doc,version_id:version,status:"accepted",quality:"pass",
      document_type:"bureau_response",client_match:"match",authenticity:"clear",bureau:"EX",recipient_name:"Scoped service",reviewed_at:new Date().toISOString()}};
    await db.query(`INSERT INTO documents(id,org_id,client_id,document_key,kind,subtype,title,storage_key,mime_type,byte_size,metadata)
       VALUES($1,$2,$3,$4,'client_upload','bureau_response','Synthetic bureau reply','synthetic/reply.pdf','application/pdf',321,$5)`,[doc,orgId,clientId,doc,metadata]);
    await db.query("INSERT INTO document_versions(id,org_id,document_id,version,storage_key,mime_type,byte_size) VALUES($1,$2,$3,1,'synthetic/reply.pdf','application/pdf',321)",[version,orgId,doc]);
    await db.query("UPDATE documents SET current_version_id=$2 WHERE id=$1",[doc,version]);
    const parse={document_validation:{document_id:doc,version_id:version},source_item_rounds:[{id:repairItem,caseId:repairCase,round:"R2"}],
      outcomes:[{itemId:repairItem,outcome:"deleted"}]};
    const response=(await db.query("INSERT INTO dispute_responses(org_id,client_id,case_id,parse_json,confirmed,confirmed_at) VALUES($1,$2,$3,$4,true,now()) RETURNING id",[orgId,clientId,repairCase,parse])).rows[0].id;
    await db.query("UPDATE dispute_items SET status='deleted' WHERE id=$1",[repairItem]);
    assert.equal((await reconcile(roundHelp)).completed,0,"wrong round cannot hand the client back");
    parse.source_item_rounds[0].round="R1";
    await db.query("UPDATE dispute_responses SET parse_json=$2 WHERE id=$1",[response,parse]);
    await db.query("UPDATE dispute_items SET status='sent' WHERE id=$1",[repairItem]);
    assert.equal((await reconcile(roundHelp)).completed,0,"unresolved item keeps paid work open");
    await db.query("UPDATE dispute_items SET status='deleted' WHERE id=$1",[repairItem]);
    const finishedRound=await reconcile(roundHelp); assert.equal(finishedRound.completed,1,JSON.stringify(finishedRound));
    assert.deepEqual(await receipt(roundHelp),{status:"fulfilled",produced_kind:"dispute_response",produced_ref:response});
    const finishedFull=await reconcile(fullHelp); assert.equal(finishedFull.completed,1,JSON.stringify(finishedFull));
    assert.deepEqual(await receipt(fullHelp),{status:"fulfilled",produced_kind:"repair_program",produced_ref:program});
    assert.equal((await db.query("SELECT status FROM repair_programs WHERE id=$1",[program])).rows[0].status,"complete");
    const active=await readActiveBlueprintServices(db,{orgId,clientId,engagementId:scope.engagement.id});
    assert.equal(active.length,0);
    assert.equal((await reconcile(fullHelp)).checked,0,"replay never repeats completion");
  } finally {await db.query("ROLLBACK");db.release();await pool.end();}
});
