import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createMailingRepository,readLetterMailing,quoteLetterMailing,confirmLetterMailing,reconcileLetterMailing,fulfilLetterMailing,sweepLetterMailings,MAILING_AUTHORIZATION,LetterMailingError} from './letter-mailing.mjs';
const ORG='11111111-1111-4111-8111-111111111111',CLIENT='22222222-2222-4222-8222-222222222222',ACCOUNT='33333333-3333-4333-8333-333333333333';
const scope={orgId:ORG,clientId:CLIENT,accountId:ACCOUNT,now:new Date('2026-11-03T01:00:00Z')};
const from={name:'Fixture Person',line1:'1 Fixture St',line2:null,city:'Phoenix',state:'AZ',postalCode:'85004'};
function fixture(){
  const files=new Map(),orders=new Map(),calls={charge:0,hosted:0,mail:0,begin:0,lookup:0};
  const letters=['EX','EQ','TU'].flatMap(bureau=>['funding_inquiry_removal','funding_personal_info'].map(subtype=>{
    const id=randomUUID(),pdf=Buffer.from(`%PDF-1.7\n${bureau} ${subtype}`),key=`fixture-${id}`;files.set(key,pdf);
    return {id,title:`Fixture ${bureau} ${subtype}`,subtype,metadata:{bureau},generated_at:scope.now,version_id:randomUUID(),version_storage_key:key,
      version_checksum:`sha256:${createHash('sha256').update(pdf).digest('hex')}`,version_mime_type:'application/pdf',version_byte_size:pdf.length};}));
  const client={id:CLIENT,org_id:ORG,email:'fixture@example.test'};
  const repo={
    current:async(s,f)=>letters.some(r=>r.id===f.documentId&&r.version_id===f.versionId&&r.version_checksum===f.checksum&&r.subtype===f.subtype&&r.metadata.bureau===f.bureau&&!r.expires_at),
    client:async s=>s.clientId===CLIENT&&s.orgId===ORG?client:null,letters:async()=>letters,orders:async()=>[...orders.values()],verifiedCustomer:async()=>({provider:'commas',source:'verified_provider_receipt',orgId:ORG,clientId:CLIENT,accountId:ACCOUNT,customerId:'123',email:client.email}),
    get:async(s,id)=>{const o=orders.get(id);return o?.client_id===s.clientId&&o.org_id===s.orgId?o:null;},
    quote:async(s,snapshot,quote_version)=>{const old=[...orders.values()].find(o=>!['mailed','cancelled'].includes(o.state));
      if(old&&old.quote_version===quote_version)return old;
      if(old){if(old.state!=='quoted'||old.payment_state!=='none')throw new LetterMailingError('mailing_order_in_flight','Finish prior order.');old.state='cancelled';}
      const id=randomUUID(),o={id,org_id:s.orgId,client_id:s.clientId,snapshot,quote_version,price_total_cents:9700,ledger_status:'quoted',state:'quoted',payment_state:'none',created_at:s.now,
        envelopes:snapshot.files.map(f=>({id:randomUUID(),state:'ready',bureau:f.bureau,snapshot:f}))};orders.set(id,o);return o;},
    begin:async(s,id,b)=>{const o=orders.get(id);if(o.payment_state!=='none'||o.state!=='quoted')return false;calls.begin++;
      Object.assign(o,{payment_state:b.option.kind==='saved_card'?'charging':'creating_checkout',state:'payment_pending',authorized_at:s.now,authorization_text:MAILING_AUTHORIZATION,attempt_started_at:s.now});return true;},
    startHosted:async(s,id)=>{orders.get(id).payment_state='creating_checkout';return true;},
    saveHosted:async(s,id,r)=>Object.assign(orders.get(id),{state:'awaiting_payment',payment_state:'awaiting_payment',checkout_url:r.checkoutUrl,checkout_session_id:r.sessionId,checkout_product_id:r.productId}),
    paid:async(s,id,r)=>Object.assign(orders.get(id),{state:'mail_pending',payment_state:'paid',provider_payment_ref:r.providerRef,ledger_status:'paid',ledger_payment_ref:r.providerRef,ledger_amount_paid_cents:9700}),
    hold:async(s,id,reason)=>Object.assign(orders.get(id),{state:'needs_review',reason}),
    claim:async(s,id,eid)=>{const e=orders.get(id).envelopes.find(e=>e.id===eid);if(e.state!=='ready'||orders.get(id).state==='needs_review')return null;Object.assign(e,{state:'sending',claim_token:randomUUID(),claimed_at:s.now});return e;},
    accepted:async(s,id,e,providerId)=>Object.assign(e,{state:'accepted',provider_id:providerId}),
    envelopeHold:async(s,id,e)=>{e.state='needs_review';Object.assign(orders.get(id),{state:'needs_review',reason:'mail_outcome_unknown'});},
    complete:async(s,id)=>{const o=orders.get(id);if(o.envelopes.every(e=>e.state==='accepted'))o.state='mailed';},
    checked:async()=>{},
    heldCount:async()=>[...orders.values()].filter(o=>o.state==='needs_review').length,
    pending:async()=>[...orders.values()].filter(o=>!['quoted','mailed','needs_review','cancelled'].includes(o.state)).map(o=>({id:o.id,org_id:o.org_id,client_id:o.client_id}))
  };
  const card={customerId:'123',methodId:'saved_private_token',label:'Visa ending 4242'};
  const providers={capabilities:()=>({savedCardSupported:true,hostedCheckoutSupported:true,mailSupported:true}),savedCards:async()=>{calls.lookup++;return [card];},
    charge:async()=>{calls.charge++;return {ok:true,paid:true,providerRef:'charge_fixture',amountCents:9700};},
    hosted:async()=>{calls.hosted++;return {ok:true,checkoutUrl:'https://www.fanbasis.com/fixture/s/123',sessionId:'session_fixture',productId:'product_fixture'};},
    readHosted:async()=>({status:'pending'}),sendEnvelope:async()=>{calls.mail++;return {ok:true,providerId:`letter_fixture${calls.mail}`};}};
  const deps={repo,providers,loadFrom:async()=>from,loadPdf:async f=>files.get(f.storageKey),active:async()=>true};
  const quote=(ids=letters.slice(0,2).map(l=>l.id))=>quoteLetterMailing({},scope,{documentIds:ids},deps);
  const confirm=(q,kind='saved_card',extra={})=>confirmLetterMailing({},scope,{orderId:q.orderId,quoteVersion:q.quoteVersion,
    paymentOptionId:q.paymentOptions.find(p=>p.kind===kind)?.id,authorization:true,idempotencyKey:'fixture_confirm_key_123',...extra},deps);
  return {orders,files,letters,repo,providers,deps,calls,quote,confirm,card,client};
}
test('quote freezes actual selected files/address at $97, masks provider data and does no charge/mail',async()=>{
  const f=fixture(),q=await f.quote();assert.equal(q.totalCents,9700);assert.equal(q.currency,'USD');assert.equal(q.items.length,2);assert.deepEqual(q.returnAddressSummary,from);
  assert.equal(q.status,'quoted');assert.equal(f.calls.charge+f.calls.hosted+f.calls.mail,0);assert.doesNotMatch(JSON.stringify(q),/saved_private_token|customerId|storageKey/);
  assert.equal((await f.quote()).id,q.id,'same selection returns one saved quote');
});
test('owned downloads/orders remain readable with no payment or mailing provider',async()=>{
  const f=fixture();f.providers.capabilities=()=>({savedCardSupported:false,hostedCheckoutSupported:false,mailSupported:false,reason:'mail_provider_unavailable'});
  const r=await readLetterMailing({},scope,f.deps);assert.equal(r.letters.length,6);assert.equal(r.orders.length,0);assert.equal(r.capabilities.mailSupported,false);
  await assert.rejects(f.quote(),{code:'mailing_unavailable'});assert.equal(f.orders.size,0);
});
test('reject foreign/duplicate/oversize/unsupported/non-PDF selections before order or money',async()=>{
  for(const make of [f=>[randomUUID()],f=>[f.letters[0].id,f.letters[0].id],f=>Array(7).fill(randomUUID())]){const f=fixture();await assert.rejects(f.quote(make(f)));assert.equal(f.orders.size,0);}
  const f=fixture();f.letters[0].subtype='analysis_pdf';await assert.rejects(f.quote(),{code:'letter_not_available'});
  await assert.rejects(quoteLetterMailing({}, {...scope,clientId:randomUUID()},{documentIds:[f.letters[1].id]},f.deps),{code:'client_not_found'});
});
test('missing actual return address or changed PDF bytes cannot create a paid request',async()=>{
  const f=fixture();f.deps.loadFrom=async()=>({...from,line1:null});await assert.rejects(f.quote(),{code:'return_address_required'});
  f.deps.loadFrom=async()=>from;f.deps.loadPdf=async()=>Buffer.from('%PDF-different');await assert.rejects(f.quote(),{code:'letter_content_unavailable'});assert.equal(f.orders.size,0);
});
test('no trustworthy same-account customer binding means hosted only; card lookup is not inferred',async()=>{
  const f=fixture();f.repo.verifiedCustomer=async()=>null;const q=await f.quote();assert.deepEqual(q.paymentOptions.map(p=>p.kind),['hosted_checkout']);assert.equal(f.calls.lookup,0);
});
test('confirmation requires exact quote, explicit $97 authorization and an opaque listed option',async()=>{
  const f=fixture(),q=await f.quote();
  for(const extra of [{authorization:false},{quoteVersion:'changed'},{paymentOptionId:'saved_private_token'},{idempotencyKey:''}])await assert.rejects(f.confirm(q,'saved_card',extra));
  assert.equal(f.calls.charge+f.calls.hosted+f.calls.mail,0);
});
test('changing selection replaces only an unattempted quote; stale confirmation never charges',async()=>{
  const f=fixture(),old=await f.quote(),fresh=await f.quote([f.letters[2].id]);assert.notEqual(old.id,fresh.id);assert.equal(f.orders.get(old.id).state,'cancelled');
  await assert.rejects(f.confirm(old),{code:'quote_changed'});assert.equal(f.calls.charge,0);
  const both=await Promise.all([f.quote([f.letters[3].id]),f.quote([f.letters[4].id])]);
  assert.equal([...f.orders.values()].filter(o=>o.state==='quoted').length,1);await assert.rejects(f.confirm(both[0]),{code:'quote_changed'});assert.equal(f.calls.charge,0);
});
test('simultaneous and repeated confirms authorize/charge once; attempted selection cannot be replaced',async()=>{
  const f=fixture(),q=await f.quote();const out=await Promise.all([f.confirm(q),f.confirm(q),f.confirm(q)]);assert.equal(f.calls.charge,1);assert.equal(f.calls.begin,1);assert.equal(f.calls.mail,0);
  assert.ok(out.some(r=>r.status==='mail_pending'));await f.confirm(q);assert.equal(f.calls.charge,1);
  await assert.rejects(f.quote([f.letters[3].id]),{code:'mailing_order_in_flight'});
});
test('changed address/content and no-longer-owned saved method refuse before charging',async()=>{
  for(const change of [f=>{f.deps.loadFrom=async()=>({...from,line1:'2 Changed St'});},f=>{f.deps.loadPdf=async()=>Buffer.from('%PDF-new');},f=>{f.providers.savedCards=async()=>[];}]){
    const f=fixture(),q=await f.quote();change(f);await assert.rejects(f.confirm(q));assert.equal(f.calls.charge,0);assert.equal(f.calls.hosted,0);
  }
});
test('definite rebilling refusal falls back to one real hosted checkout',async()=>{
  const f=fixture(),q=await f.quote();f.providers.charge=async()=>{f.calls.charge++;return {ok:false,definitiveRefusal:true};};
  const r=await f.confirm(q);assert.equal(r.status,'awaiting_payment');assert.ok(r.checkoutUrl);assert.equal(f.calls.hosted,1);assert.equal(f.calls.charge,1);await f.confirm(q);assert.equal(f.calls.hosted,1);
});
test('unknown charge outcome remains held even beyond provider idempotency expiry; no alternate charge',async()=>{
  const f=fixture(),q=await f.quote();f.providers.charge=async()=>{f.calls.charge++;throw new Error('fixture network failure');};
  assert.equal((await f.confirm(q)).status,'needs_review');await f.confirm(q);
  await reconcileLetterMailing({}, {...scope,now:new Date(scope.now.getTime()+86400000)},q.id,f.deps);
  assert.equal(f.calls.charge,1);assert.equal(f.calls.hosted,0);assert.equal(f.calls.mail,0);
});
test('hosted payment is never mailing proof; exact accepted receipt releases separately claimed envelopes',async()=>{
  const f=fixture(),q=await f.quote();assert.equal((await f.confirm(q,'hosted_checkout')).status,'awaiting_payment');assert.equal(f.calls.mail,0);
  assert.equal((await reconcileLetterMailing({},scope,q.id,f.deps)).status,'awaiting_payment');
  f.providers.readHosted=async()=>({status:'paid',providerRef:'hosted_paid_fixture',amountCents:9700});
  assert.equal((await reconcileLetterMailing({},scope,q.id,f.deps)).status,'mail_pending');assert.equal(f.calls.mail,0);
  const r=await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(r.status,'mailed');assert.equal(f.calls.mail,2);await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(f.calls.mail,2);
});
test('receipt mismatch never releases mailing',async()=>{const f=fixture(),q=await f.quote();await f.confirm(q,'hosted_checkout');f.providers.readHosted=async()=>({status:'mismatch'});
  assert.equal((await reconcileLetterMailing({},scope,q.id,f.deps)).status,'needs_review');await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(f.calls.mail,0);});
test('mail timeout keeps envelope claim and order held; no blind duplicate send',async()=>{
  const f=fixture(),q=await f.quote();await f.confirm(q);f.providers.sendEnvelope=async()=>{f.calls.mail++;throw new Error('fixture timeout');};
  const r=await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(r.status,'needs_review');assert.equal(r.envelopes.filter(e=>e.status==='needs_review').length,1);
  await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(f.calls.mail,1);
});
test('active paid year is rechecked before mail; missing provider receipt is not acceptance',async()=>{
  const f=fixture(),q=await f.quote();await f.confirm(q);f.deps.active=async()=>false;assert.equal((await fulfilLetterMailing({},scope,q.id,f.deps)).status,'needs_review');assert.equal(f.calls.mail,0);
  const g=fixture(),p=await g.quote();await g.confirm(p);g.providers.sendEnvelope=async()=>({ok:true});assert.equal((await fulfilLetterMailing({},scope,p.id,g.deps)).status,'needs_review');
});
test('a worker handles at most two envelopes per order and recovers paid orders after the browser closes',async()=>{
  const f=fixture(),q=await f.quote(f.letters.map(l=>l.id));await f.confirm(q,'hosted_checkout');f.providers.readHosted=async()=>({status:'paid',providerRef:'closed_browser_receipt',amountCents:9700});
  const a=await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(a.examined,1);assert.equal(f.calls.mail,2);assert.equal(a.mailed,0);
  await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(f.calls.mail,4);const b=await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(f.calls.mail,6);assert.equal(b.mailed,1);assert.equal(f.calls.charge,0);
});


test('regeneration, expiry, subtype or bureau changes after quote refuse payment before any charge',async()=>{
  for(const change of [r=>{r.version_id=randomUUID();},r=>{r.expires_at=new Date(0);},r=>{r.subtype='credit_analysis_report';},r=>{r.metadata={bureau:'TU'};}]){
    const f=fixture(),q=await f.quote();change(f.letters[0]);await assert.rejects(f.confirm(q),{code:'letter_changed'});assert.equal(f.calls.charge,0);assert.equal(f.calls.mail,0);
  }
});
test('regeneration after payment holds the batch and does not mail old frozen bytes',async()=>{
  const f=fixture(),q=await f.quote();await f.confirm(q);f.letters[0].version_id=randomUUID();const r=await fulfilLetterMailing({},scope,q.id,f.deps);
  assert.equal(r.status,'needs_review');assert.equal(r.reason,'letter_version_changed');assert.equal(f.calls.mail,0);
});
test('cancelled/failed/refunded ledger or wrong receipt/amount can never release a paid mailing',async()=>{
  for(const patch of [{ledger_status:'cancelled'},{ledger_status:'failed'},{ledger_status:'refunded'},{ledger_amount_paid_cents:9600},{ledger_payment_ref:'unrelated'}]){
    const f=fixture(),q=await f.quote();await f.confirm(q);Object.assign(f.orders.get(q.id),patch);assert.equal((await fulfilLetterMailing({},scope,q.id,f.deps)).status,'needs_review');assert.equal(f.calls.mail,0);
  }
});


test('reassigned email, prior third-party payer and same-email foreign org never select another customer card',async()=>{
  for(const patch of [{email:'previous-payer@example.test'},{accountId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{orgId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},{clientId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]){
    const f=fixture();f.repo.verifiedCustomer=async()=>({provider:'commas',source:'verified_provider_receipt',orgId:ORG,clientId:CLIENT,accountId:ACCOUNT,customerId:'111',email:f.client.email,...patch});
    const q=await f.quote();assert.deepEqual(q.paymentOptions.map(p=>p.kind),['hosted_checkout']);assert.equal(f.calls.lookup,0);assert.equal(f.calls.charge,0);
  }
});
test('changing account/customer binding after quote refuses an otherwise matching-email stored method',async()=>{
  const f=fixture(),q=await f.quote();f.repo.verifiedCustomer=async()=>({provider:'commas',source:'verified_provider_receipt',orgId:ORG,clientId:CLIENT,accountId:ACCOUNT,customerId:'222',email:f.client.email});
  await assert.rejects(f.confirm(q),{code:'saved_card_unavailable'});assert.equal(f.calls.charge,0);
});


test('production repository has no trustworthy legacy customer binding and reports hosted-only capability',async()=>{
  const repo=createMailingRepository({query:async()=>{throw new Error('no invented identity lookup');}});assert.equal(await repo.verifiedCustomer(scope),null);
  const f=fixture();f.repo.verifiedCustomer=async()=>null;const r=await readLetterMailing({},scope,f.deps);assert.equal(r.capabilities.savedCardSupported,false);
});
test('unavailable receipt reads stay observable red without inventing a paid outcome',async()=>{
  const f=fixture(),q=await f.quote();await f.confirm(q,'hosted_checkout');f.providers.readHosted=async()=>({status:'unavailable'});
  const r=await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(r.ok,false);assert.equal(r.failed,1);assert.equal(f.calls.mail,0);assert.equal(f.orders.get(q.id).state,'awaiting_payment');
});


test('a later refunded/mismatched hosted receipt holds remaining envelopes before another worker send',async()=>{
  const f=fixture(),q=await f.quote(f.letters.map(l=>l.id));await f.confirm(q,'hosted_checkout');f.providers.readHosted=async()=>({status:'paid',providerRef:'fixture_receipt',amountCents:9700});
  await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(f.calls.mail,2);
  f.providers.readHosted=async()=>({status:'mismatch'});await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(f.calls.mail,2);assert.equal(f.orders.get(q.id).state,'needs_review');
});


test('a held order keeps recovery red on later ticks without blocking other pending work',async()=>{
  const f=fixture(),q=await f.quote();f.providers.charge=async()=>({ok:false});await f.confirm(q);
  const r=await sweepLetterMailings({}, {...f.deps,now:scope.now});assert.equal(r.examined,0);assert.equal(r.needsReview,1);assert.equal(r.ok,false);assert.equal(f.calls.hosted+f.calls.mail,0);
});


test('duplicate identical content for one bureau is refused before checkout, even with different document IDs',async()=>{
  const f=fixture();f.letters[1].version_checksum=f.letters[0].version_checksum;f.letters[1].version_byte_size=f.letters[0].version_byte_size;
  await assert.rejects(f.quote(),{code:'duplicate_letter_content'});assert.equal(f.calls.charge+f.calls.hosted,0);assert.equal(f.orders.size,0);
});
