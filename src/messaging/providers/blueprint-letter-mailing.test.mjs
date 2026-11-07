import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createMailingProviders,moneyCents,safeCheckoutUrl} from './blueprint-letter-mailing.mjs';
const env={FANBASIS_CHECKOUT_API_KEY:'fixture_key',POSTGRID_API_KEY:'fixture_mail',ADAPTERS_DRY_RUN:'false',MESSAGING_DRY_RUN:'false'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const customer={id:123,email:'fixture@example.test'};
const method={id:'saved_fixture',type:'card',last4:'4242',metadata:{data:{card_type:'visa'}}};
const order={id:'order_fixture',org_id:'org_fixture',client_id:'client_fixture',checkout_product_id:'product_fixture',snapshot:{email:customer.email,from:{name:'Fixture Person',line1:'1 Fixture St',city:'Phoenix',state:'AZ',postalCode:'85004'}}};
const tx={id:'receipt_fixture',status:'succeeded',product:{id:'product_fixture'},customer,currency:'USD',amount:'97.00',metadata:{link_ref:order.id,org_id:order.org_id,client_id:order.client_id}};
test('money is exact cents and checkout URL cannot expose a foreign or credentialed host',()=>{
  assert.equal(moneyCents('97.00'),9700);for(const n of ['97.001','unknown','1e2',null])assert.equal(moneyCents(n),null);
  assert.ok(safeCheckoutUrl('https://www.fanbasis.com/fixture'));for(const u of ['https://evil.example/','javascript:alert(1)','https://user:pass@www.fanbasis.com/'])assert.equal(safeCheckoutUrl(u),null);
});
test('standard live fences/config refuse all writes without invoking the transport',async()=>{
  let calls=0;const p=createMailingProviders({env:{},fetchImpl:async()=>{calls++;throw new Error('must not call');}});
  assert.equal(p.capabilities().mailSupported,false);assert.equal((await p.charge({customerId:'123',methodId:'saved',orderId:'o',amountCents:9700})).preTransmission,true);
  assert.equal((await p.hosted({orderId:'o'})).preTransmission,true);assert.equal(calls,0);
});
test('saved methods require a preverified numeric customer ID; never search by matching email',async()=>{
  for(const variant of ['good','wrong_email','wrong_id']){
    const calls=[];const p=createMailingProviders({env,fetchImpl:async(url)=>{calls.push(url);return json({data:{customer:variant==='wrong_email'?{...customer,email:'other@example.test'}:variant==='wrong_id'?{...customer,id:999}:customer,payment_methods:[method]}});}});
    assert.deepEqual(await p.savedCards({email:customer.email}),[]);assert.equal(calls.length,0);
    const cards=await p.savedCards({customerId:'123',email:customer.email});assert.equal(cards.length,variant==='good'?1:0);
    assert.equal(calls.length,1);assert.ok(calls[0].includes('/customers/123/payment-methods'));assert.equal(p.capabilities().savedCardSupported,false);
  }
});
test('saved-card charge pins $97/known customer/method plus stable order idempotency and rejects unknown success',async()=>{
  const calls=[];const p=createMailingProviders({env,fetchImpl:async(url,init)=>{calls.push({url,init});return json({status:'success',data:{charge_id:'charge_fixture',amount:'97.00',status:'succeeded'}});}});
  const r=await p.charge({customerId:'123',methodId:'saved_fixture',orderId:'order_fixture',amountCents:9700});assert.equal(r.paid,true);
  assert.match(calls[0].url,/customers\/123\/charge$/);assert.equal(calls[0].init.headers['Idempotency-Key'],'blueprint-mail:order_fixture');
  assert.deepEqual(JSON.parse(calls[0].init.body),{payment_method_id:'saved_fixture',amount_cents:9700,description:'Document Mailing Service'});
  assert.equal((await p.charge({customerId:'123',methodId:'saved_fixture',orderId:'o',amountCents:10000})).ok,false);assert.equal(calls.length,1);
});
test('only definite provider rebilling refusal permits fallback; dropped/ambiguous responses cannot',async()=>{
  for(const [status,body,expected] of [[404,{message:'No authorized subscription found for customer'},true],[403,{message:'Manual rebilling not enabled'},true],
    [500,{message:'No authorized subscription found for customer'},false],[200,{status:'success',data:{status:'pending'}},false],[200,{status:'success',data:{charge_id:'c',amount:'98.00',status:'succeeded'}},false]]){
    const p=createMailingProviders({env,fetchImpl:async()=>json(body,status)});const r=await p.charge({customerId:'123',methodId:'saved_fixture',orderId:'o',amountCents:9700});
    assert.equal(r.definitiveRefusal,expected);assert.notEqual(r.paid,true);
  }
});
test('hosted checkout uses existing one-time checkout with exact order scope and no subscription',async()=>{
  let body;const p=createMailingProviders({env,fetchImpl:async(_url,init)=>{body=JSON.parse(init.body);return json({data:{payment_link:'https://www.fanbasis.com/fixture',id:'product_fixture'}});}});
  const r=await p.hosted({orderId:'o',orgId:'org',clientId:'client'});assert.equal(r.ok,true);assert.equal(body.amount_cents,9700);assert.equal(body.type,'onetime_non_reusable');
  assert.deepEqual(body.metadata,{link_ref:'o',org_id:'org',client_id:'client',service_kind:'letter_mailing'});assert.equal(body.subscription,undefined);
});
test('hosted read proves exact product/customer/amount/currency and refuses unrelated, partial and duplicate receipts',async()=>{
  for(const [change,expected] of [[{},'paid'],[{amount:'96.99'},'mismatch'],[{customer:{...customer,email:'foreign@example.test'}},'mismatch'],[{currency:'CAD'},'mismatch'],[{refunds:[{status:'succeeded'}]},'mismatch'],[{metadata:{link_ref:'foreign'}},'mismatch'],[{product:{id:'unrelated'}},'pending'],[{status:'pending'},'pending']]){
    const p=createMailingProviders({env,fetchImpl:async()=>json({data:{transactions:[{...tx,...change}]}})});assert.equal((await p.readHosted(order)).status,expected);
  }
  const p=createMailingProviders({env,fetchImpl:async()=>json({data:{transactions:[tx,tx]}})});assert.equal((await p.readHosted(order)).status,'mismatch');
});
test('PostGrid sends the actual PDF as multipart with canonical addresses and persistent envelope idempotency',async()=>{
  let captured;const p=createMailingProviders({env,fetchImpl:async(url,init)=>{captured={url,init};return json({id:'letter_fixture1'});}});
  const envelope={id:'envelope_fixture',snapshot:{to:{company_name:'Fixture Bureau',address_line1:'PO Box 1',address_city:'Fixture City',address_state:'TX',address_zip:'75000'}}};
  const pdf=Buffer.from('%PDF-1.7\nfixture');const r=await p.sendEnvelope({order,envelope,pdf});assert.equal(r.providerId,'letter_fixture1');
  const form=captured.init.body;assert.ok(form instanceof FormData);assert.equal(captured.init.headers['idempotency-key'],'blueprint-mail-envelope:envelope_fixture');
  assert.equal(form.get('from[firstName]'),'Fixture');assert.equal(form.get('to[companyName]'),'Fixture Bureau');assert.equal(form.get('to[addressLine1]'),'PO Box 1');
  assert.deepEqual(Buffer.from(await form.get('pdf').arrayBuffer()),pdf);assert.equal(form.get('mailingClass'),'usps_first_class');assert.equal(form.get('to[address_line1]'),null);
});
test('a repair letter mails as its saved HTML in the same PostGrid form; anything else is refused before transmission',async()=>{
  const calls=[];const p=createMailingProviders({env,fetchImpl:async(url,init)=>{calls.push({url,init});return json({id:'letter_fixture2'});}});
  const envelope={id:'envelope_repair',snapshot:{to:{company_name:'Experian',address_line1:'P.O. Box 4500',address_city:'Allen',address_state:'TX',address_zip:'75013'}}};
  const html='<!doctype html><html><body><pre>Fixture dispute words.</pre></body></html>';
  assert.equal((await p.sendEnvelope({order,envelope,html})).providerId,'letter_fixture2');
  const form=calls[0].init.body;assert.equal(form.get('html'),html);assert.equal(form.get('pdf'),null);
  assert.equal(form.get('addressPlacement'),'top_first_page');assert.equal(form.get('mailingClass'),'usps_first_class');
  assert.equal(calls[0].init.headers['idempotency-key'],'blueprint-mail-envelope:envelope_repair');assert.equal(form.get('to[addressLine1]'),'P.O. Box 4500');
  for(const bad of [{html:'Dear bureau, plain words'},{html:'<p>no document</p>'},{html:`<html>${'x'.repeat(600*1024)}</html>`},{},{html,pdf:Buffer.from('%PDF-1.7')}]){
    const r=await p.sendEnvelope({order,envelope,...bad});assert.equal(r.ok,false);assert.equal(r.preTransmission,true);
  }
  assert.equal(calls.length,1,'no refused letter reached the mail house');
});
test('the tracker read is one GET for one known PostGrid letter and returns only the tracker words',async()=>{
  const calls=[];const p=createMailingProviders({env,fetchImpl:async(url,init)=>{calls.push({url,init});
    return json({id:'letter_abc123',status:'processed_for_delivery',imbStatus:'entered_mail_stream',imbDate:'2026-11-10',updatedAt:'2026-11-09T09:00:00Z',to:{firstName:'Private'},url:'https://signed.example/preview.pdf'});}});
  const r=await p.readLetter('letter_abc123');
  assert.deepEqual(r,{ok:true,letter:{status:'processed_for_delivery',imbStatus:'entered_mail_stream',imbDate:'2026-11-10',updatedAt:'2026-11-09T09:00:00Z'}});
  assert.equal(calls[0].url,'https://api.postgrid.com/print-mail/v1/letters/letter_abc123');assert.equal(calls[0].init.method,'GET');
  assert.equal(calls[0].init.headers['x-api-key'],'fixture_mail');assert.equal(calls[0].init.body,undefined);
  for(const id of ['../cheques/1','letter_1?x=y','',null])assert.equal((await p.readLetter(id)).preTransmission,true);
  assert.equal(calls.length,1);
  const other=createMailingProviders({env,fetchImpl:async()=>json({id:'letter_other',status:'completed'})});assert.equal((await other.readLetter('letter_abc123')).ok,false,'another letter id is not this letter');
  let held=0;const fenced=createMailingProviders({env:{POSTGRID_API_KEY:'fixture_mail'},fetchImpl:async()=>{held++;return json({});}});
  assert.equal((await fenced.readLetter('letter_abc123')).preTransmission,true);assert.equal(held,0,'the messaging fence holds the read too');
});
