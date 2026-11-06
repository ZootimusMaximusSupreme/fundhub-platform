import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { lookupBlueprintServiceReceipt } from "./service-payment-identity.mjs";
import { onPaymentReceivedMoney, onSaleClosedMoney } from "../handlers/money-chain.mjs";

test("a service request identifies its own checkout before any standalone money or product grant",async()=>{
  const requestId=randomUUID(), orgId=randomUUID(), clientId=randomUUID();
  const row={id:requestId,org_id:orgId,client_id:clientId,price_total_cents:50000,
    service_kind:"funding_round",state:"awaiting_payment",authorized_at:new Date()};
  let queries=0;
  const db={query:async(sql,args)=>{
    queries++;
    assert.match(sql,/JOIN blueprint_client_services/);
    assert.deepEqual(args,[requestId,orgId]);
    return {rows:[row]};
  }};
  const base={orgId,clientId,payload:{ref:requestId,amountCents:50000,productName:"Consulting Services Package"}};
  const hit=await lookupBlueprintServiceReceipt(db,base);
  assert.equal(hit.productCode,"blueprint-help-funding_round"); assert.equal(hit.valid,true);
  assert.equal((await onPaymentReceivedMoney(base,db)).reason,"blueprint_service_payment");
  assert.equal((await onSaleClosedMoney(base,db)).reason,"blueprint_service_payment");
  assert.equal((await lookupBlueprintServiceReceipt(db,{...base,clientId:randomUUID()})).reason,"service_client_mismatch");
  assert.equal((await onPaymentReceivedMoney({...base,payload:{...base.payload,amountCents:45000}},db)).reason,"service_amount_mismatch");
  assert.equal(queries,5);
  assert.equal(await lookupBlueprintServiceReceipt(db,{orgId,clientId,payload:{ref:"pl_other"}}),null);
  assert.equal(queries,5);
});
