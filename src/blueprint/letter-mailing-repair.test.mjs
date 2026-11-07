// Unit MAIL: the same $97 batch mailing, extended to repair-round dispute
// letters, and the mail tracker. In-memory repository and fake providers:
// nothing here charges a card or mails a letter.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {readLetterMailing,quoteLetterMailing,confirmLetterMailing,fulfilLetterMailing,readBlueprintLetterReadiness,
  createMailingRepository,trackLetterMailings,letterTrackFacts,mailTracker,mailStatus,publicMailingOrder,MAILING_AUTHORIZATION,
  MAILING_PRICE_CENTS,MAILING_REPLY_DAYS,REPAIR_LETTER_SUBTYPE,LetterMailingError} from './letter-mailing.mjs';

const ORG='11111111-1111-4111-8111-111111111111',CLIENT='22222222-2222-4222-8222-222222222222',ACCOUNT='33333333-3333-4333-8333-333333333333';
const scope={orgId:ORG,clientId:CLIENT,accountId:ACCOUNT,now:new Date('2026-11-07T18:00:00Z')};
const from={name:'Fixture Person',line1:'1 Fixture St',line2:null,city:'Phoenix',state:'AZ',postalCode:'85004'};
const sha=b=>`sha256:${createHash('sha256').update(b).digest('hex')}`;
const html=(bureau,round)=>Buffer.from(`<!doctype html><html><head><meta charset="utf-8"><title>Dispute letter — ${bureau} ${round}</title></head><body><pre>Fixture ${bureau} dispute words.</pre></body></html>`);

function fixture({target='bureau'}={}){
  const files=new Map(),orders=new Map(),calls={charge:0,hosted:0,mail:[],claims:0,released:[],events:[],reads:0,tracked:[]};
  const letterRows=new Map();
  const repairDoc=(bureau,round='R1',extra={})=>{const id=randomUUID(),letterId=randomUUID(),body=html(bureau,round),key=`fixture-${id}`;files.set(key,body);
    letterRows.set(letterId,{id:letterId,bureau,round,target:extra.target||target,status:'generated',open:true});
    return {id,title:`Dispute letter — ${bureau} ${round}`,subtype:REPAIR_LETTER_SUBTYPE,metadata:{bureau,round,target:extra.target||target,letterId},generated_at:scope.now,
      version_id:randomUUID(),version_storage_key:key,version_checksum:sha(body),version_mime_type:'text/html',version_byte_size:body.length,...extra.row};};
  const fundingDoc=bureau=>{const id=randomUUID(),pdf=Buffer.from(`%PDF-1.7\n${bureau} funding`),key=`fixture-${id}`;files.set(key,pdf);
    return {id,title:`Fixture ${bureau} inquiry letter`,subtype:'funding_inquiry_removal',metadata:{bureau},generated_at:scope.now,version_id:randomUUID(),
      version_storage_key:key,version_checksum:sha(pdf),version_mime_type:'application/pdf',version_byte_size:pdf.length};};
  const docs=[repairDoc('EX'),repairDoc('EQ'),repairDoc('TU'),fundingDoc('EX')];
  const open=d=>d.subtype!==REPAIR_LETTER_SUBTYPE||(letterRows.get(d.metadata.letterId)?.open===true&&d.metadata.target==='bureau');
  const repo={
    client:async s=>s.clientId===CLIENT&&s.orgId===ORG?{id:CLIENT,org_id:ORG,email:'fixture@example.test'}:null,
    letters:async()=>docs.map(d=>({...d,letter_open:d.subtype===REPAIR_LETTER_SUBTYPE?open(d):null})),
    orders:async()=>[...orders.values()],verifiedCustomer:async()=>null,
    current:async(s,f)=>docs.some(r=>r.id===f.documentId&&r.version_id===f.versionId&&r.version_checksum===f.checksum&&r.subtype===f.subtype&&r.metadata.bureau===f.bureau
      &&r.version_mime_type===(f.subtype===REPAIR_LETTER_SUBTYPE?'text/html':'application/pdf')),
    repairOpen:async(s,f)=>letterRows.get(f.letterId)?.open===true,
    get:async(s,id)=>orders.get(id)||null,
    quote:async(s,snapshot,quote_version)=>{const old=[...orders.values()].find(o=>!['mailed','cancelled'].includes(o.state));if(old&&old.quote_version===quote_version)return old;
      if(old)old.state='cancelled';
      const id=randomUUID(),o={id,org_id:s.orgId,client_id:s.clientId,snapshot,quote_version,price_total_cents:9700,ledger_status:'quoted',state:'quoted',payment_state:'none',created_at:s.now,
        envelopes:snapshot.files.map(f=>({id:randomUUID(),state:'ready',bureau:f.bureau,document_id:f.documentId,snapshot:f,dispute_letter_id:f.subtype===REPAIR_LETTER_SUBTYPE?f.letterId:null}))};
      orders.set(id,o);return o;},
    begin:async(s,id,b)=>{const o=orders.get(id);if(o.payment_state!=='none')return false;Object.assign(o,{payment_state:'creating_checkout',state:'payment_pending',authorized_at:s.now,authorization_text:MAILING_AUTHORIZATION,attempt_started_at:s.now});return true;},
    saveHosted:async(s,id,r)=>Object.assign(orders.get(id),{state:'awaiting_payment',payment_state:'awaiting_payment',checkout_url:r.checkoutUrl}),
    hold:async(s,id,reason)=>Object.assign(orders.get(id),{state:'needs_review',reason}),
    claim:async(s,id,eid)=>{const e=orders.get(id).envelopes.find(x=>x.id===eid);if(e.state!=='ready')return null;
      if(e.dispute_letter_id){const l=letterRows.get(e.dispute_letter_id);if(!l?.open)throw new LetterMailingError('repair_letter_already_handled','already sent');
        calls.claims++;l.open=false;l.status='sending';}
      Object.assign(e,{state:'sending',claim_token:randomUUID(),claimed_at:s.now});return e.dispute_letter_id?{...e,letterClaim:{priorStatus:'generated',token:'t'}}:e;},
    releaseRepairLetter:async(s,e)=>{calls.released.push(e.dispute_letter_id);Object.assign(letterRows.get(e.dispute_letter_id),{open:true,status:'generated'});},
    accepted:async(s,id,e,providerId)=>{const env=orders.get(id).envelopes.find(x=>x.id===e.id);Object.assign(env,{state:'accepted',provider_id:providerId,accepted_at:s.now});
      /* CX28: the mail house taking it is not mailed; the letter keeps its claim and gains the id. */
      if(env.dispute_letter_id)Object.assign(letterRows.get(env.dispute_letter_id),{postgrid:providerId});},
    envelopeHold:async(s,id,e)=>{orders.get(id).envelopes.find(x=>x.id===e.id).state='needs_review';Object.assign(orders.get(id),{state:'needs_review',reason:'mail_outcome_unknown'});},
    complete:async(s,id)=>{const o=orders.get(id);if(o.envelopes.every(e=>e.state==='accepted'))o.state='mailed';},
    checked:async()=>{}
  };
  const providers={capabilities:()=>({hostedCheckoutSupported:true,mailSupported:true}),savedCards:async()=>[],
    hosted:async()=>{calls.hosted++;return {ok:true,checkoutUrl:'https://www.fanbasis.com/fixture/s/1',sessionId:'session_fixture',productId:'product_fixture'};},
    readHosted:async()=>({status:'pending'}),charge:async()=>{calls.charge++;return {ok:false};},
    sendEnvelope:async args=>{calls.mail.push(args);return {ok:true,providerId:`letter_fixture${calls.mail.length}`};}};
  const deps={repo,providers,loadFrom:async()=>from,loadPdf:async f=>files.get(f.storageKey),active:async()=>true,
    readLetterApprovals:async()=>new Map(),onRepairEvent:async(_db,event)=>{calls.events.push(event);return {ok:true};}};
  const quote=ids=>quoteLetterMailing({},scope,{documentIds:ids},deps);
  const confirm=q=>confirmLetterMailing({},scope,{orderId:q.orderId,quoteVersion:q.quoteVersion,paymentOptionId:'hosted_checkout',authorization:true,idempotencyKey:'fixture_confirm_key_123'},deps);
  const pay=q=>Object.assign(orders.get(q.id),{state:'mail_pending',payment_state:'paid',provider_payment_ref:'paid_fixture',ledger_status:'paid',ledger_payment_ref:'paid_fixture',ledger_amount_paid_cents:9700});
  return {docs,files,orders,letterRows,repo,providers,deps,calls,quote,confirm,pay,repairDoc};
}

test('the letters read lists repair bureau letters open for the $97 mailing, with their round, beside the funding letters',async()=>{
  const f=fixture();f.docs.push(f.repairDoc('EX','R1',{target:'furnisher'}));
  const r=await readLetterMailing({},scope,f.deps);
  const repair=r.letters.filter(l=>l.kind==='repair');
  assert.equal(repair.length,3,'the furnisher letter is not a $97 bureau mailing');
  assert.ok(repair.every(l=>l.eligibleForMailing&&l.round==='R1'&&/^[0-9a-f-]{36}$/.test(l.letterId)));
  assert.deepEqual(r.letters.filter(l=>l.kind==='funding').map(l=>l.subtype),['funding_inquiry_removal']);
  assert.equal(r.priceCents,MAILING_PRICE_CENTS);
  f.letterRows.get(f.docs[0].metadata.letterId).open=false;
  assert.equal((await readLetterMailing({},scope,f.deps)).letters.filter(l=>l.kind==='repair').length,2,'a letter sent another way leaves the $97 list');
  assert.equal((await readBlueprintLetterReadiness({},scope,{repo:f.repo})).usableLetterCount,3);
});

test('one $97 quote can hold a round of repair letters and a funding letter; it freezes each repair letter id and charges nothing',async()=>{
  const f=fixture(),q=await f.quote(f.docs.map(d=>d.id));
  assert.equal(q.totalCents,9700);assert.equal(q.items.length,4);
  assert.deepEqual(q.items.filter(i=>i.kind==='repair').map(i=>i.round),['R1','R1','R1']);
  const files=f.orders.get(q.id).snapshot.files;
  for(const d of f.docs.slice(0,3)){const file=files.find(x=>x.documentId===d.id);assert.equal(file.letterId,d.metadata.letterId);assert.equal(file.target,'bureau');assert.equal(file.mimeType,'text/html');}
  assert.equal(files.find(x=>x.documentId===f.docs[3].id).letterId,undefined,'a funding letter snapshot is unchanged');
  assert.equal(f.calls.charge+f.calls.hosted+f.calls.mail.length,0);
});

test('a repair letter that is closed, not a bureau letter, the wrong file type or changed bytes never gets a quote',async()=>{
  for(const change of [f=>{f.letterRows.get(f.docs[0].metadata.letterId).open=false;},f=>{f.docs[0].metadata.target='furnisher';},
    f=>{f.docs[0].version_mime_type='application/pdf';},f=>{f.docs[0].version_byte_size=600*1024;}]){
    const f=fixture();change(f);await assert.rejects(f.quote([f.docs[0].id]),{code:'letter_not_available'});assert.equal(f.orders.size,0);
  }
  const f=fixture();f.files.set(f.docs[0].version_storage_key,Buffer.from('<!doctype html><p>different words</p>'));
  await assert.rejects(f.quote([f.docs[0].id]),{code:'letter_content_unavailable'});
  const g=fixture();g.files.set(g.docs[0].version_storage_key,Buffer.from('%PDF-1.7 not html'));
  g.docs[0].version_checksum=sha(g.files.get(g.docs[0].version_storage_key));g.docs[0].version_byte_size=g.files.get(g.docs[0].version_storage_key).length;
  await assert.rejects(g.quote([g.docs[0].id]),{code:'letter_content_unavailable'},'a repair file must be the saved HTML letter');
});

test('a repair letter taken another way between the list and the quote, or before payment, refuses with no charge',async()=>{
  const f=fixture();f.repo.repairOpen=async()=>false;
  await assert.rejects(f.quote([f.docs[0].id]),{code:'repair_letter_already_handled'});assert.equal(f.orders.size,0);
  const g=fixture(),q=await g.quote([g.docs[0].id,g.docs[1].id]);g.letterRows.get(g.docs[1].metadata.letterId).open=false;
  await assert.rejects(g.confirm(q),{code:'repair_letter_already_handled',message:/Nothing was charged/});
  assert.equal(g.calls.hosted+g.calls.charge,0);assert.equal(g.orders.get(q.id).payment_state,'none');
});

test('paid repair letters go to the mail house as their saved HTML through the same provider call, and stay "sending" there',async()=>{
  const f=fixture(),q=await f.quote([f.docs[0].id,f.docs[1].id,f.docs[3].id]);
  assert.equal((await f.confirm(q)).status,'awaiting_payment');assert.equal(f.calls.hosted,1);assert.equal(f.calls.mail.length,0,'payment alone mails nothing');
  f.pay(q);
  const first=await fulfilLetterMailing({},scope,q.id,{...f.deps,maxEnvelopes:2});
  assert.equal(first.status,'mail_pending');assert.equal(f.calls.mail.length,2);
  const done=await fulfilLetterMailing({},scope,q.id,f.deps);
  assert.equal(done.status,'mailed');assert.equal(f.calls.mail.length,3);
  const sent=f.calls.mail.map(m=>({kind:m.envelope.snapshot.subtype,html:typeof m.html,pdf:Buffer.isBuffer(m.pdf)}));
  assert.deepEqual(sent.filter(s=>s.kind===REPAIR_LETTER_SUBTYPE),[{kind:REPAIR_LETTER_SUBTYPE,html:'string',pdf:false},{kind:REPAIR_LETTER_SUBTYPE,html:'string',pdf:false}]);
  assert.deepEqual(sent.filter(s=>s.kind!==REPAIR_LETTER_SUBTYPE),[{kind:'funding_inquiry_removal',html:'undefined',pdf:true}]);
  const repairMail=f.calls.mail.find(m=>m.envelope.snapshot.subtype===REPAIR_LETTER_SUBTYPE);
  assert.equal(repairMail.html,f.files.get(repairMail.envelope.snapshot.storageKey).toString('utf8'),'the exact words the client opened');
  // CX28: the mail house has it, but nothing is mailed until it reports the handoff to the post office.
  assert.equal(f.letterRows.get(f.docs[0].metadata.letterId).status,'sending','the repair file does not say sent');
  assert.equal(f.calls.events.length,0,'no letters-sent email at acceptance');
  const envelope=done.envelopes.find(e=>e.documentId===f.docs[0].id);
  assert.equal(envelope.letterId,f.docs[0].metadata.letterId);
  assert.equal(envelope.mailStatus,'sending');assert.deepEqual(envelope.tracker.mail,{state:'sending',at:null});
  assert.equal(envelope.tracker.replyDueAt,null,'CX27: no reply date the moment the mail house takes it');
  assert.equal(envelope.tracker.delivery.state,'todo');
  await fulfilLetterMailing({},scope,q.id,f.deps);assert.equal(f.calls.mail.length,3,'a reload never resends');
  assert.equal(f.calls.charge,0);
});

test('a repair letter mailed or self-submitted after payment holds the batch: no envelope, no second letter',async()=>{
  const f=fixture(),q=await f.quote([f.docs[0].id]);await f.confirm(q);f.pay(q);
  f.letterRows.get(f.docs[0].metadata.letterId).open=false;
  const r=await fulfilLetterMailing({},scope,q.id,f.deps);
  assert.equal(r.status,'needs_review');assert.equal(r.reason,'repair_letter_already_handled');assert.equal(f.calls.mail.length,0);
});

test('nothing left the process: the repair letter goes back to its file; an unknown outcome keeps the claim for a person',async()=>{
  const f=fixture(),q=await f.quote([f.docs[0].id]);await f.confirm(q);f.pay(q);
  f.providers.sendEnvelope=async()=>({ok:false,preTransmission:true});
  assert.equal((await fulfilLetterMailing({},scope,q.id,f.deps)).status,'needs_review');
  assert.deepEqual(f.calls.released,[f.docs[0].metadata.letterId]);assert.equal(f.letterRows.get(f.docs[0].metadata.letterId).status,'generated');
  const g=fixture(),p=await g.quote([g.docs[0].id]);await g.confirm(p);g.pay(p);
  g.providers.sendEnvelope=async()=>{throw new Error('fixture timeout');};
  assert.equal((await fulfilLetterMailing({},scope,p.id,g.deps)).status,'needs_review');
  assert.deepEqual(g.calls.released,[],'it may be in the post: never given back blind');
  assert.equal(g.letterRows.get(g.docs[0].metadata.letterId).status,'sending');
});

test('a failed repair-file announcement never undoes or hides a recorded handoff',async()=>{
  const repo={trackable:async()=>[{id:'e1',order_id:'o1',org_id:ORG,client_id:CLIENT,provider_id:'letter_1',accepted_at:'2026-11-07T18:00:00Z'}],
    track:async()=>({mailedNow:true,orderId:'o1',bureau:'EX',providerId:'letter_1',disputeLetterId:'44444444-4444-4444-8444-444444444444'})};
  const providers={readLetter:async()=>({ok:true,letter:{status:'processed_for_delivery',updatedAt:'2026-11-09T09:00:00Z'}})};
  const warn=console.warn;console.warn=()=>{};
  let r;try{r=await trackLetterMailings({}, {repo,providers,now:new Date('2026-11-10T12:00:00Z'),onRepairEvent:async()=>{throw new Error('fixture event bus down');}});}
  finally{console.warn=warn;}
  assert.deepEqual(r,{ok:true,examined:1,updated:1,failed:0,mailed:1});
});

test('the mail house words map to tracker facts; unknown words stay null and dates never move past now or before acceptance',()=>{
  const now=new Date('2026-11-12T12:00:00Z'),acceptedAt='2026-11-07T18:00:00Z';
  // CX28: accepted or printing is not mailed; mailed is PostGrid's processed_for_delivery, with that date.
  for(const status of ['ready','printing'])assert.deepEqual(letterTrackFacts({status,updatedAt:'2026-11-08T10:00:00Z'},{now,acceptedAt}),
    {providerStatus:status,imbStatus:null,mailedAt:null,expectedDeliveryAt:null,returnedAt:null});
  assert.equal(letterTrackFacts({status:'printing',imbStatus:'entered_mail_stream',imbDate:'2026-11-09'},{now,acceptedAt}).mailedAt,null,
    'only PostGrid\'s own handoff status says mailed');
  assert.deepEqual(letterTrackFacts({status:'processed_for_delivery',updatedAt:'2026-11-09T09:00:00Z'},{now,acceptedAt}),
    {providerStatus:'processed_for_delivery',imbStatus:null,mailedAt:'2026-11-09T09:00:00.000Z',expectedDeliveryAt:null,returnedAt:null});
  assert.deepEqual(letterTrackFacts({status:'completed',imbStatus:'out_for_delivery',imbDate:'2026-11-11T00:00:00Z',updatedAt:'2026-11-12T08:00:00Z'},{now,acceptedAt}),
    {providerStatus:'completed',imbStatus:'out_for_delivery',mailedAt:'2026-11-11T00:00:00.000Z',expectedDeliveryAt:'2026-11-12T08:00:00.000Z',returnedAt:null});
  // CX26: the post office's last scan is not a delivery date, and nothing ever reports "delivered".
  const scanOnly=letterTrackFacts({status:'processed_for_delivery',imbStatus:'out_for_delivery',imbDate:'2026-11-11',updatedAt:'2026-11-09T09:00:00Z'},{now,acceptedAt});
  assert.equal(scanOnly.expectedDeliveryAt,null,'out for delivery alone sets no delivery date');
  for(const facts of [scanOnly,letterTrackFacts({status:'completed',updatedAt:'2026-11-12T08:00:00Z'},{now,acceptedAt})])
    assert.equal(Object.keys(facts).some(k=>/delivered/i.test(k)),false,'no fact is ever named delivered');
  assert.deepEqual(letterTrackFacts({status:'processed_for_delivery',imbStatus:'returned_to_sender',imbDate:'2026-11-10T00:00:00Z',updatedAt:'2026-11-09T00:00:00Z'},{now,acceptedAt}).returnedAt,'2026-11-10T00:00:00.000Z');
  assert.equal(letterTrackFacts({status:'processed_for_delivery',imbStatus:'entered_mail_stream',imbDate:'2026-11-10',updatedAt:'2026-11-11T00:00:00Z'},{now,acceptedAt}).mailedAt,
    '2026-11-10T12:00:00.000Z','a date-only scan day stays that day in every US time zone');
  const odd=letterTrackFacts({status:'lost_in_space',imbStatus:'teleported',updatedAt:'2030-01-01T00:00:00Z'},{now,acceptedAt});
  assert.equal(odd.providerStatus,null);assert.equal(odd.imbStatus,null);assert.equal(odd.expectedDeliveryAt,null);
  assert.equal(letterTrackFacts({status:'completed',updatedAt:'2030-01-01T00:00:00Z'},{now,acceptedAt}).expectedDeliveryAt,now.toISOString(),'never a future date');
  assert.equal(letterTrackFacts({status:'completed',updatedAt:'2026-01-01T00:00:00Z'},{now,acceptedAt}).expectedDeliveryAt,'2026-11-07T18:00:00.000Z','never before the mail house took it');
});

test('the client tracker reads only saved facts: sending or mailed, expected delivery, reply due, and a stopped or returned letter',()=>{
  assert.equal(mailTracker({state:'ready'}),null,'nothing to track before the mail house takes it');
  const base={state:'accepted'};
  // CX28: accepted, or still printing, is "sending"; never mailed before the handoff is reported.
  for(const status of [null,'ready','printing']){
    const sending=mailTracker({...base,provider_status:status});
    assert.deepEqual([sending.mail,sending.delivery.state,sending.replyDueAt],[{state:'sending',at:null},'todo',null]);
    assert.equal(mailStatus({...base,provider_status:status}),'sending');
  }
  const out=mailTracker({...base,provider_status:'processed_for_delivery',imb_status:'out_for_delivery',mailed_at:'2026-11-09T09:00:00Z'});
  assert.deepEqual([out.mail,out.delivery.state,out.replyDueAt],[{state:'done',at:'2026-11-09T09:00:00.000Z'},'now',null],
    'mailed on the handoff date; CX27: out for delivery has no reply date yet');
  assert.equal(mailStatus({...base,provider_status:'processed_for_delivery',mailed_at:'2026-11-09T09:00:00Z'}),'mailed');
  assert.equal(mailStatus({state:'sending'}),'sending','our call to the mail house is out');
  for(const e of [{state:'ready'},{state:'needs_review'},{...base,provider_status:'cancelled'}])assert.equal(mailStatus(e),null,`${e.state} ${e.provider_status||''} is not with the mail house`);
  // CX26: PostGrid's "completed" is an expected delivery date, never a delivered step.
  const expected=mailTracker({...base,provider_status:'completed',imb_status:'out_for_delivery',expected_delivery_at:'2026-11-12T08:00:00Z',reply_due_at:'2026-12-12T08:00:00Z'});
  assert.deepEqual(expected.delivery,{state:'expected',at:'2026-11-12T08:00:00.000Z'});
  assert.equal(expected.replyDueAt,'2026-12-12T08:00:00.000Z','CX27: reply due counts from the expected delivery date');
  assert.equal(JSON.stringify(expected).includes('delivered'),false,'the tracker never says delivered');
  assert.equal(mailTracker({...base,provider_status:'completed',reply_due_at:'2026-12-12T08:00:00Z'}).replyDueAt,null,'no reply date without an expected delivery date');
  assert.equal(mailTracker({...base,provider_status:'cancelled'}).problem,'cancelled');
  assert.equal(mailTracker({...base,imb_status:'returned_to_sender',returned_at:'2026-11-10T00:00:00Z'}).problem,'returned');
  assert.equal(mailTracker({...base}).problem,null);
  const order=publicMailingOrder({id:'o',state:'mailed',price_total_cents:9700,quote_version:'v',snapshot:{files:[],from,paymentOptions:[]},
    envelopes:[{bureau:'EX',state:'accepted',document_id:'d',dispute_letter_id:'l',provider_id:'letter_1',provider_status:'completed',mailed_at:'2026-11-09T09:00:00Z',
      expected_delivery_at:'2026-11-12T08:00:00Z',reply_due_at:'2026-12-12T08:00:00Z'},
      {bureau:'EQ',state:'accepted',document_id:'d2',dispute_letter_id:'l2',provider_id:'letter_2',provider_status:'printing'}]});
  assert.deepEqual(order.envelopes[0].documentId+order.envelopes[0].letterId,'dl');assert.equal(order.envelopes[0].tracker.replyDueAt,'2026-12-12T08:00:00.000Z');
  assert.deepEqual(order.envelopes.map(e=>e.mailStatus),['mailed','sending'],'the order word "mailed" never stands in for a letter that is still sending');
});

test('the tracker sweep reads at most three letters, saves what they prove, and never sends or charges',async()=>{
  const rows=Array.from({length:5},(_,i)=>({id:`e${i}`,order_id:'o',org_id:ORG,client_id:CLIENT,provider_id:`letter_${i}`,accepted_at:'2026-11-07T18:00:00Z'}));
  const saved=[],asked=[];
  const kept=(e,facts)=>({mailedNow:false,orderId:e.order_id,bureau:'EX',providerId:e.provider_id,disputeLetterId:null,facts});
  const repo={trackable:async limit=>rows.slice(0,limit),track:async(e,facts)=>{saved.push({id:e.id,facts});return kept(e,facts);}};
  const forbidden=()=>{throw new Error('the tracker must never send or charge');};
  const providers={readLetter:async id=>{asked.push(id);return id==='letter_1'?{ok:false}:{ok:true,letter:{status:'processed_for_delivery',updatedAt:'2026-11-09T09:00:00Z'}};},
    sendEnvelope:forbidden,charge:forbidden,hosted:forbidden};
  const r=await trackLetterMailings({}, {repo,providers,limit:99,now:new Date('2026-11-12T12:00:00Z')});
  assert.deepEqual(asked,['letter_0','letter_1','letter_2']);assert.deepEqual(r,{ok:false,examined:3,updated:2,failed:1,mailed:0});
  assert.equal(saved.find(s=>s.id==='e1').facts,null,'a failed read saves no fact, only the read time');
  assert.equal(saved.find(s=>s.id==='e0').facts.mailedAt,'2026-11-09T09:00:00.000Z');
  saved.length=0;repo.track=async(e,facts)=>{if(e.id==='e0')throw new Error('fixture write refused');saved.push({id:e.id,facts});return kept(e,facts);};
  const again=await trackLetterMailings({}, {repo,providers,now:new Date('2026-11-12T12:00:00Z')});
  assert.deepEqual(again,{ok:false,examined:3,updated:1,failed:2,mailed:0},'one envelope that cannot be saved does not stop the others');
  assert.deepEqual(saved.map(s=>s.id),['e1','e2']);
});

test('CX28: the letters-sent email goes out when PostGrid reports the handoff, once per batch, and never for a letter still sending',async()=>{
  const L1='44444444-4444-4444-8444-444444444444',L2='55555555-5555-4555-8555-555555555555';
  const rows=[{id:'e1',order_id:'o1',org_id:ORG,client_id:CLIENT,provider_id:'letter_1'},{id:'e2',order_id:'o1',org_id:ORG,client_id:CLIENT,provider_id:'letter_2'},
    {id:'e3',order_id:'o2',org_id:ORG,client_id:CLIENT,provider_id:'letter_3'}];
  const result={e1:{mailedNow:true,disputeLetterId:L1,bureau:'EX'},e2:{mailedNow:true,disputeLetterId:L2,bureau:'EQ'},e3:{mailedNow:false,disputeLetterId:randomUUID(),bureau:'TU'}};
  const events=[];
  const repo={trackable:async()=>rows,track:async e=>({...result[e.id],orderId:e.order_id,providerId:e.provider_id})};
  const providers={readLetter:async()=>({ok:true,letter:{status:'processed_for_delivery',updatedAt:'2026-11-09T09:00:00Z'}})};
  const r=await trackLetterMailings({}, {repo,providers,now:new Date('2026-11-10T12:00:00Z'),onRepairEvent:async(_db,event)=>{events.push(event);}});
  assert.equal(r.mailed,2);assert.equal(events.length,1,'one email for the batch handed off together');
  assert.equal(events[0].name,'repair.letters.sent');assert.equal(events[0].payload.orderId,'o1');
  assert.deepEqual(events[0].payload.results.map(x=>x.letterId),[L1,L2]);
  assert.equal(events[0].payload.idempotencyKey,`repair.letters.sent:blueprint-mail:o1:${[L1,L2].sort().join('+')}`);
  events.length=0;result.e1.mailedNow=result.e2.mailedNow=false;
  await trackLetterMailings({}, {repo,providers,now:new Date('2026-11-10T12:00:00Z'),onRepairEvent:async(_db,event)=>{events.push(event);}});
  assert.equal(events.length,0,'still sending, or already announced: no email');
  result.e1={mailedNow:true,disputeLetterId:null,bureau:'EX'};
  await trackLetterMailings({}, {repo,providers,now:new Date('2026-11-10T12:00:00Z'),onRepairEvent:async(_db,event)=>{events.push(event);}});
  assert.equal(events.length,0,'a funding letter has no repair file to move');
});

test('the real repository claims a repair letter with the staff send rules inside one transaction, and records its mailing',async()=>{
  const queries=[];const envelope={id:'e1',order_id:'o1',org_id:ORG,client_id:CLIENT,state:'sending',bureau:'EX',claim_token:'c1',dispute_letter_id:'44444444-4444-4444-8444-444444444444'};
  const db={query:async(sql,params)=>{queries.push({sql,params});
    if(/UPDATE blueprint_letter_mailing_envelopes e SET state='sending'/.test(sql))return {rows:[envelope]};
    if(/UPDATE dispute_letters l SET status='sending'/.test(sql))return {rows:[{prior_status:'generated',claim_token:'2026-11-07 18:00:00+00'}]};
    if(/SET state='accepted'/.test(sql))return {rows:[{id:'e1'}]};
    if(/UPDATE dispute_letters SET status='sent'/.test(sql))return {rows:[{case_id:'55555555-5555-4555-8555-555555555555',round:'R1'}]};
    return {rows:[]};}};
  const repo=createMailingRepository(db);
  const claimed=await repo.claim(scope,'o1','e1');
  assert.deepEqual(claimed.letterClaim,{priorStatus:'generated',token:'2026-11-07 18:00:00+00'});
  const take=queries.find(q=>/UPDATE dispute_letters l SET status='sending'/.test(q.sql));
  for(const rule of ["l.status IN ('generated','ready')","l.send_claimed_at IS NULL","l.mailed_at IS NULL","l.target='bureau'",
    'blueprint_repair_submissions',"cs.service_kind='repair_full'","kind = 'dispute_authorization'","BLUEPRINT-SELF-FUNDING-AGREEMENT"])assert.ok(take.sql.includes(rule),rule);
  assert.deepEqual(take.params.slice(0,4),[ORG,CLIENT,envelope.dispute_letter_id,'EX']);
  const beforeAcceptance=queries.length;
  await repo.accepted(scope,'o1',claimed,'letter_abc123');
  const acceptance=queries.slice(beforeAcceptance);
  const idOnly=acceptance.find(q=>/UPDATE dispute_letters SET postgrid_letter_id=COALESCE\(\$4::text,postgrid_letter_id\)/.test(q.sql));
  assert.ok(idOnly,'the repair letter gains the mail house\'s id');assert.equal(idOnly.params[3],'letter_abc123');assert.match(idOnly.sql,/status='sending'$/m);
  // CX28: taking the letter is not mailing it: nothing sent, mailed, or waiting on the bureau yet.
  assert.equal(acceptance.some(q=>/status='sent'|mailed_at|dispute_items|dispute_cases/.test(q.sql)),false,'no mailed record at acceptance');
  // CX27: taking the letter starts no reply clock, on the envelope or on the case.
  assert.equal(acceptance.some(q=>/reply_due_at|response_due_at/.test(q.sql)),false,'no reply date at acceptance');
  await repo.releaseRepairLetter(scope,claimed);
  const give=queries.at(-1);assert.match(give.sql,/status='sending' AND mailed_at IS NULL AND send_claimed_at=\$5::timestamptz/);
  db.query=async(sql,params)=>{queries.push({sql,params});return /UPDATE blueprint_letter_mailing_envelopes e SET state='sending'/.test(sql)?{rows:[envelope]}:{rows:[]};};
  await assert.rejects(repo.claim(scope,'o1','e1'),{code:'repair_letter_already_handled'},'a letter taken another way is never mailed');
  const funding={...envelope,dispute_letter_id:null};db.query=async(sql,params)=>{queries.push({sql,params});return /SET state='sending'/.test(sql)?{rows:[funding]}:{rows:[{id:'e1'}]};};
  const before=queries.length;await repo.claim(scope,'o1','e1');await repo.accepted(scope,'o1',funding,'letter_x');
  assert.equal(queries.slice(before).some(q=>/dispute_letters|dispute_cases/.test(q.sql)),false,'a funding letter touches no repair file');
});

test('CX27 and CX28: the repair file says mailed at the reported handoff, and the reply clock starts at the expected delivery date',async()=>{
  const L='44444444-4444-4444-8444-444444444444',mailedOn=new Date('2026-11-09T16:00:00Z');
  const queries=[];let wasMailed=null;
  let returned={id:'e1',order_id:'o1',bureau:'EX',provider_id:'letter_abc123',dispute_letter_id:L,mailed_at:null,reply_due_at:null};
  const db={query:async(sql,params)=>{queries.push({sql,params});
    if(/FOR UPDATE/.test(sql))return {rows:[{mailed_at:wasMailed}]};
    if(/UPDATE blueprint_letter_mailing_envelopes SET/.test(sql))return {rows:[returned]};
    if(/UPDATE dispute_letters SET status='sent'/.test(sql))return {rows:[{case_id:'55555555-5555-4555-8555-555555555555',round:'R1'}]};
    return {rows:[]};}};
  const repo=createMailingRepository(db),e={id:'e1',order_id:'o1',org_id:ORG,client_id:CLIENT},now=new Date('2026-11-13T12:00:00Z');
  // Still printing: saved, not mailed, nothing on the repair file.
  assert.deepEqual(await repo.track(e,{providerStatus:'printing'},now),{mailedNow:false,orderId:'o1',bureau:'EX',providerId:'letter_abc123',disputeLetterId:L});
  const first=queries.find(q=>/UPDATE blueprint_letter_mailing_envelopes SET/.test(q.sql));
  assert.match(first.sql,/mailed_at=COALESCE\(mailed_at,\$7\)/);
  assert.match(first.sql,/expected_delivery_at=COALESCE\(expected_delivery_at,\$8\)/);
  assert.match(first.sql,/reply_due_at=COALESCE\(reply_due_at,COALESCE\(expected_delivery_at,\$8\)\+\(\$11::int\*interval '1 day'\)\)/);
  assert.equal(first.params[6],null);assert.equal(first.params[7],null);assert.equal(first.params[10],MAILING_REPLY_DAYS);
  assert.equal(queries.some(q=>/dispute_letters|dispute_items|dispute_cases/.test(q.sql)),false,'sending: the repair file is untouched');
  // CX28: PostGrid reports the handoff: mailed now, on that date, and the repair file says so.
  returned={...returned,mailed_at:mailedOn};queries.length=0;
  assert.equal((await repo.track(e,{providerStatus:'processed_for_delivery',mailedAt:mailedOn.toISOString()},now)).mailedNow,true);
  const sent=queries.find(q=>/UPDATE dispute_letters SET status='sent',mailed_at=COALESCE\(mailed_at,\$4\)/.test(q.sql));
  assert.ok(sent,'the repair letter is sent at the handoff');assert.match(sent.sql,/status='sending' AND postgrid_letter_id=\$5/);
  assert.deepEqual(sent.params,[L,ORG,CLIENT,mailedOn,'letter_abc123']);
  assert.ok(queries.some(q=>/UPDATE dispute_items SET status='sent'/.test(q.sql)&&q.params[3]==='R1'));
  assert.ok(queries.some(q=>/UPDATE dispute_cases SET status=CASE/.test(q.sql)),'the case waits on the bureau from the handoff');
  assert.equal(queries.some(q=>/response_due_at/.test(q.sql)),false,'CX27: mailed is not delivered; no reply clock yet');
  // Already mailed: a later read never re-sends the repair file.
  wasMailed=mailedOn;queries.length=0;
  assert.equal((await repo.track(e,{providerStatus:'processed_for_delivery',imbStatus:'out_for_delivery'},now)).mailedNow,false);
  assert.equal(queries.some(q=>/dispute_letters SET status='sent'/.test(q.sql)),false);
  // CX27: the expected delivery date lands: the reply clock starts, on the envelope and the empty case clock.
  returned={...returned,reply_due_at:new Date('2026-12-12T16:00:00Z')};queries.length=0;
  await repo.track(e,{providerStatus:'completed',expectedDeliveryAt:'2026-11-12T16:00:00.000Z'},now);
  assert.equal(queries.find(q=>/UPDATE blueprint_letter_mailing_envelopes SET/.test(q.sql)).params[7],'2026-11-12T16:00:00.000Z');
  const clock=queries.find(q=>/UPDATE dispute_cases c SET response_due_at=\$4/.test(q.sql));
  assert.ok(clock,'the repair case gets the same reply date');assert.match(clock.sql,/c\.response_due_at IS NULL/);
  assert.deepEqual(clock.params,[L,ORG,CLIENT,returned.reply_due_at]);
  returned={...returned,dispute_letter_id:null};wasMailed=null;queries.length=0;
  await repo.track(e,{providerStatus:'completed',mailedAt:mailedOn.toISOString(),expectedDeliveryAt:'2026-11-12T16:00:00.000Z'},now);
  assert.equal(queries.some(q=>/dispute_letters|dispute_cases/.test(q.sql)),false,'a funding letter has no repair file');
  db.query=async(sql,params)=>{queries.push({sql,params});return {rows:[]};};
  assert.equal(await repo.track(e,{providerStatus:'printing'},now),null,'an envelope that is not accepted saves nothing');
});

test('migration 591 keeps every 546 guard and adds only the repair letter, the tracker and the no-clear rule',()=>{
  const read=name=>readFileSync(new URL(`../../db/migrations/${name}`,import.meta.url),'utf8');
  const sql=read('591_blueprint_repair_letter_mailing.sql'),old=read('546_blueprint_letter_mailing.sql');
  for(const message of ['mailing order must match its exact scoped paid-service request','mailing authorization must belong to its client account',
    'mailing quote and content are immutable','mailing authorization is immutable','mailing envelope must match its exact owned document version',
    'mailing envelope content is immutable','mailing send claim may not be cleared or replaced','accepted mailing is irreversible']){
    assert.ok(old.includes(message),message);assert.ok(sql.includes(message),`591 keeps: ${message}`);
  }
  assert.match(sql,/subtype IN \('funding_inquiry_removal','funding_personal_info'\) AND v\.mime_type='application\/pdf'\s+AND NEW\.dispute_letter_id IS NULL/);
  assert.match(sql,/subtype='metro2_dispute_letter_pack' AND v\.mime_type='text\/html'\s+AND d\.metadata->>'target'='bureau'/);
  assert.match(sql,/d\.metadata->>'letterId'=NEW\.dispute_letter_id::text/);
  assert.match(sql,/l\.bureau=NEW\.bureau AND l\.target='bureau'/);
  assert.match(sql,/NEW\.snapshot,NEW\.dispute_letter_id\)\s+IS DISTINCT FROM/,'the repair letter id is frozen content');
  assert.match(sql,/mailing tracker dates are set once/);
  assert.match(sql,/CHECK \(state = 'accepted' OR \(provider_status IS NULL/,'only an accepted envelope carries tracker facts');
  // CX26: PostGrid's completed date is stored as an expected delivery date; there is no delivered column.
  assert.match(sql,/ADD COLUMN IF NOT EXISTS expected_delivery_at timestamptz/);
  assert.match(sql,/OLD\.expected_delivery_at IS NOT NULL AND NEW\.expected_delivery_at IS DISTINCT FROM OLD\.expected_delivery_at/);
  assert.doesNotMatch(sql,/delivered_at/);
  // CX27: the database refuses a reply date before the expected delivery date is known.
  assert.match(sql,/CHECK \(reply_due_at IS NULL OR \(expected_delivery_at IS NOT NULL AND reply_due_at > expected_delivery_at\)\)/);
  // CX28: the database refuses a mailed date before PostGrid reports the handoff; there is no printed step.
  assert.match(sql,/CHECK \(mailed_at IS NULL OR provider_status IN \('processed_for_delivery','completed'\)\)/);
  assert.doesNotMatch(sql,/printed_at/);
  assert.match(sql,/BEFORE UPDATE OF send_claim_cleared_at ON public\.dispute_letters/);
  assert.match(sql,/e\.state IN \('sending','accepted'\)\) THEN/,'a held envelope stays releasable by a person');
  assert.doesNotMatch(sql,/\b(DELETE|TRUNCATE|DROP TABLE|DROP COLUMN)\b/i);
});
