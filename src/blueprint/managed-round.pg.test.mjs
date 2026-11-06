import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { isLocalScratchDatabaseUrl } from "../verification/scratch-guard.mjs";
import { onPaymentReceived } from "../handlers/client-lifecycle.mjs";
import { emit } from "../events/bus.mjs";
import { requestBlueprintHelp,quoteBlueprintHelp,checkoutBlueprintHelp } from "./client-services.mjs";
import { onPaidServicePaymentReceived } from "../handlers/paid-service-payment.mjs";
import { onPaymentReceivedMoney,onRoundStartedMoney,closePurchasedBlueprintRound } from "../handlers/money-chain.mjs";
import { getBlueprintFulfillmentAccess } from "./fulfillment-access.mjs";
import { logBankDecision } from "../applications/status.mjs";

const url=process.env.APP_DATABASE_URL || process.env.DATABASE_URL;
for (const existing of [false,true]) test("paid staff takeover "+(existing ? "preserves the owner's existing round" : "starts and binds the purchased round"),{skip:!isLocalScratchDatabaseUrl(url)},async()=>{
  const pool=new pg.Pool({connectionString:url,max:1});
  const db=await pool.connect();
  try {
    await db.query("BEGIN");
    assert.equal((await db.query("SELECT current_user")).rows[0].current_user,"fundhub_app");
    const orgId=(await db.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0].id;
    const clientId=(await db.query("INSERT INTO clients(org_id,first_name,email) VALUES($1,'Takeover',$2) RETURNING id",[orgId,"takeover+"+randomUUID()+"@example.test"])).rows[0].id;
    const accountId=(await db.query("INSERT INTO accounts(org_id,client_id,kind,email,status,password_hash) VALUES($1,$2,'client',$3,'active','synthetic-fixture') RETURNING id",[orgId,clientId,"takeover+"+randomUUID()+"@example.test"])).rows[0].id;
    const staff=(await db.query("INSERT INTO staff(org_id,name,role,status) VALUES($1,'Synthetic CSM','csm','active') RETURNING *",[orgId])).rows[0];
    const full=(await db.query("SELECT id FROM products WHERE org_id=$1 AND code='blueprint-self-funding'",[orgId])).rows[0];
    const link=(await db.query(`INSERT INTO payment_links(org_id,client_id,product_id,purpose,description,amount_cents,link_ref,checkout_url,status)
      VALUES($1,$2,$3,'custom','Full Blueprint checkout',3000000,$4,'https://checkout.example.test/paid','paid') RETURNING id`,
      [orgId,clientId,full.id,"pl_fixture_"+randomUUID()])).rows[0];
    const pay={name:"payment.received",orgId,clientId,payload:{productName:"blueprint-self-funding",productId:full.id,paymentLinkId:link.id,product:"diy",
      amount:30000,amountCents:3000000,providerRef:"synthetic-"+randomUUID(),source:"commas"}};
    pay.id=(await emit(db,"payment.received",pay.payload,{orgId,clientId,skipInngest:true})).id;
    await onPaymentReceived(pay,db);
    const reaction=await onPaymentReceivedMoney(pay,db);
    assert.equal(reaction.done,true,JSON.stringify(reaction));
    const scope={orgId,clientId,accountId,now:new Date(),engagement:await getBlueprintFulfillmentAccess(db,{orgId,clientId})};
    let previous=null;
    if (existing) {
      previous=(await db.query("INSERT INTO funding_rounds(org_id,client_id,round_number,status,product) VALUES($1,$2,1,'started','blueprint_self_funding') RETURNING id",[orgId,clientId])).rows[0].id;
      await db.query("UPDATE blueprint_fulfillment_engagements SET funding_round_id=$2 WHERE id=$1",[scope.engagement.id,previous]);
      scope.engagement.roundId=previous;
    }
    // This other active funding deal is deliberately tempting to the generic
    // round→latest-sale resolver. A scoped takeover must never attach it.
    await db.query(`INSERT INTO sales(org_id,client_id,product_id,agreed_price,agreed_success_fee_percent)
      SELECT $1,$2,id,3000,10 FROM products WHERE org_id=$1 AND code='card-stacking-dfy'`,[orgId,clientId]);
    const help=await requestBlueprintHelp(db,scope,{serviceKind:"funding_round",idempotencyKey:"test_takeover_"+clientId});
    await quoteBlueprintHelp(db,{...scope,staffId:staff.id},{requestId:help.request.id,priceCents:120000});
    await checkoutBlueprintHelp(db,scope,{requestId:help.request.id,authorization:true},{mint:async()=>({ok:true,checkoutUrl:"https://pay.example.test/synthetic"})});
    const evt={orgId,clientId,payload:{ref:help.request.id,amountCents:120000,paymentId:"synthetic-"+help.request.id,currency:"USD"}};
    assert.equal((await getBlueprintFulfillmentAccess(db,scope)).executionOwner,"client");
    assert.equal((await onPaidServicePaymentReceived({...evt,payload:{...evt.payload,amountCents:200}},db)).done,false);
    assert.equal((await getBlueprintFulfillmentAccess(db,scope)).executionOwner,"client");
    assert.equal((await onPaidServicePaymentReceived(evt,db)).done,true);
    const after=await getBlueprintFulfillmentAccess(db,scope);
    assert.equal(after.executionOwner,"fundhub");
    assert.ok(after.roundId);
    if (previous) assert.equal(after.roundId,previous);
    const round=(await db.query("SELECT * FROM funding_rounds WHERE id=$1",[after.roundId])).rows[0];
    assert.equal(round.product,"blueprint_managed_funding");
    const start=await onRoundStartedMoney({id:randomUUID(),orgId,clientId,payload:{roundNumber:round.round_number}},db);
    assert.equal(start.fundingRoundId,round.id); assert.equal(start.saleId,null);
    await onPaidServicePaymentReceived(evt,db);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM funding_rounds WHERE org_id=$1 AND client_id=$2",[orgId,clientId])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM funding_round_sales WHERE funding_round_id=$1",[round.id])).rows[0].n,0);
    const lender=(await db.query("INSERT INTO lenders(org_id,lender_table,name,product_name,is_demo) VALUES($1,'PersonalCC',$2,'Synthetic product',true) RETURNING id",[orgId,"Team "+randomUUID()])).rows[0];
    await logBankDecision(db,{orgId,clientId,lenderId:lender.id,status:"Denied",staff});
    const ended=await closePurchasedBlueprintRound({orgId,clientId,payload:{stage:"closed",fundingRoundId:round.id,roundNumber:round.round_number}},db);
    assert.equal(ended.done,true);assert.equal((await getBlueprintFulfillmentAccess(db,scope)).status,"completed");
  } finally { await db.query("ROLLBACK");db.release();await pool.end(); }
});
