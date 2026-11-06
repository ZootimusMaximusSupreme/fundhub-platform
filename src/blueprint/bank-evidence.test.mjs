import test from "node:test";
import assert from "node:assert/strict";
import { mailgunAuthenticatedSender,matchBankMail,matchPostedFunds } from "./bank-evidence.mjs";
import handler from "../../api/blueprint/funding.mjs";

const ref="FH-61428";
const app={reference:ref,application_url:"https://apply.examplebank.com/cards",lender_name:"Example Bank"};
const mail={classification:"APPROVED",subject:"Example Bank "+ref,body_preview:"Your card is active. Available credit is $8,000.",
  raw:{source:"mailgun",authenticatedBankDomain:"examplebank.com"}};

test("signed provider receipt requires aligned envelope, signer and From domains",()=>{
  const headers=[["X-Mailgun-Dkim-Check-Result","Pass"],["X-Mailgun-Spf","Pass"],["DKIM-Signature","v=1; d=examplebank.com; s=mail"]];
  const body={sender:"mail@examplebank.com",from:"Bank <mail@examplebank.com>","message-headers":JSON.stringify(headers)};
  assert.equal(mailgunAuthenticatedSender(body),"examplebank.com");
  for (const value of [undefined,"{}","{",JSON.stringify([...headers,headers[0]]),JSON.stringify([headers[0],headers[2]])])
    assert.equal(mailgunAuthenticatedSender({...body,"message-headers":value}),null);
  assert.equal(mailgunAuthenticatedSender({...body,from:"Bank <attacker@elsewhere.test>"}),null);
});

test("bank approval, issuance and posted funding each require their own evidence",()=>{
  assert.deepEqual(matchBankMail(mail,app),{decision:"funded",approvedAmount:null,fundedAmount:8000});
  assert.deepEqual(matchBankMail({...mail,body_preview:"You have been approved for $12,000."},app),{decision:"approved",approvedAmount:12000});
  assert.equal(matchBankMail({...mail,body_preview:"You may be eligible for available credit of $8,000"},app),null);
  assert.equal(matchBankMail({...mail,raw:{source:"mailgun",authenticatedBankDomain:"phisher.test"}},app),null);
  assert.equal(matchBankMail({...mail,subject:"FH-614280"},app),null);
  assert.deepEqual(matchBankMail({...mail,classification:"DENIED",body_preview:"Your application was declined."},app),{decision:"declined"});
  const transaction={provider:"plaid",environment:"production",plaid_item_id:"item",posted_on:"2026-11-05",is_pending:false,
    amount_cents:240000,provider_transaction_id:"p",merchant_name:"Example Bank loan disbursement "+ref,raw:{}};
  assert.deepEqual(matchPostedFunds(transaction,app),{decision:"funded",fundedAmount:2400});
  for (const patch of [{is_pending:true},{environment:"sandbox"},{amount_cents:-240000},{merchant_name:"Example Bank "+ref},
    {merchant_name:"Different Bank loan disbursement "+ref}]) assert.equal(matchPostedFunds({...transaction,...patch},app),null);
});

test("customer and staff commands use separate session scopes",async ()=>{
  const id="eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const res=()=>({setHeader(){},status(s){this.code=s;return this;},json(b){this.body=b;return this;}});
  let invoked=false;
  let out=res();
  await handler({method:"POST",body:{action:"report_application",verified:true}},out,{
    requireBlueprintFulfillmentScope:async()=>({orgId:id,clientId:id}),reportBlueprintApplication:()=>{invoked=true;}});
  assert.equal(out.code,400);assert.equal(invoked,false);
  out=res();
  await handler({method:"GET",query:{clientId:id}},out,{requirePrincipal:async()=>({kind:"client",orgId:id,clientId:id})});
  assert.equal(out.code,403);
  const deps={requirePrincipal:async()=>({kind:"staff",staff:{id,org_id:id,role:"csm"}}),requireClientInOrg:async()=>true,
    getBlueprintFulfillmentAccess:async()=>({id,status:"active",executionOwner:"client"}),reviewOwnedBankDocument:async()=>({ok:true})};
  const body={action:"review_bank_evidence",clientId:id,applicationId:id,evidenceDocumentId:id,decision:"funded",fundedAmount:1200,note:"Bank issuance confirmed."};
  out=res();await handler({method:"POST",body},out,deps);assert.equal(out.code,200);
  out=res();await handler({method:"POST",body:{...body,fundedAmount:0}},out,deps);assert.equal(out.code,400);
});
