import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import {runTierEngineFromCrsResult} from '../finance/crs-tier.mjs';
import {buildFundingOpportunity} from '../blueprint/funding-opportunity.mjs';
import crsEngine from '../finance/vendor/crs-engine.cjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(root+'public/app/blueprint-demo.js','utf8');
const seed=JSON.parse(readFileSync(root+'public/app/blueprint-demo-data.json','utf8'));
const KEY='fh_blueprint_portal_demo_v2';
function open({search='?demo=1&blueprint=full',pathname='/app/client-portal.html',store=new Map([['fh_token','existing-real-session'],['unrelated','preserve-me']])}={}){
  let calls=0,writes=0;const listeners=new Map(),documentListeners=new Map();const events=[],nodes=[];
  const localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>{writes++;store.set(key,String(value));},removeItem:key=>store.delete(key)};
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type),opener:null};
  const document={readyState:'loading',addEventListener:(name,fn)=>documentListeners.set(name,fn),dispatchEvent:event=>events.push(event.type),body:{replaceChildren:()=>{}},createElement:tag=>{const node={tag,textContent:'',children:[],listeners:new Map(),append(...children){this.children.push(...children);},setAttribute(){},addEventListener(name,fn){this.listeners.set(name,fn);}};nodes.push(node);return node;}};
  const context=vm.createContext({window,document,localStorage,location:{origin:'https://fundhub.ai',pathname,search},URL,URLSearchParams,FormData,Response,Event,crypto:webcrypto,fetch:()=>{calls++;throw Error('A demo made a forbidden request');}});
  vm.runInContext(source,context);
  return{api:window.FHBlueprintDemo,store,context,listeners,events,nodes,renderPreview:()=>documentListeners.get('DOMContentLoaded')?.(),writes:()=>writes,networkCalls:()=>calls};
}
const post=(api,path,body)=>api.request(path,{method:'POST',body:JSON.stringify(body)});
const normal=value=>JSON.parse(JSON.stringify(value));
async function sampleQuote(env,kind='inquiry_removal'){
  const requested=await post(env.api,'/api/blueprint/services',{action:'request_help',serviceKind:kind,note:'Please review this sample scope.'});
  if(requested.request.status==='requested')env.api.advance();
  return (await env.api.request('/api/blueprint/services')).requests.find(r=>r.id===requested.request.id);
}

test('the adapter requires the full explicit route and never creates a session',()=>{
  for(const opts of [{search:'?demo=1'},{search:'?blueprint=full'},{pathname:'/app/financeos.html',search:'?demo=1'}])assert.equal(open(opts).api,undefined);
  const prep=open({search:'?demo=1&blueprint=full&offer=preparation'});assert.equal(prep.api.offer,'preparation');assert.equal(new URL(prep.api.previewUrl('document')).searchParams.get('offer'),'preparation');
  const env=open();assert.ok(Object.isFrozen(env.api));assert.equal(env.store.get('fh_token'),'existing-real-session');assert.equal(env.store.get('unrelated'),'preserve-me');assert.equal(env.networkCalls(),0);
});

test('fictional package and banks have the full $30,000 scope without reading private sources',async()=>{
  const env=open();env.api.setScenario('optimize');const funding=await env.api.request('/api/blueprint/funding');
  assert.equal(funding.engagement.priceCents,3000000);assert.equal(funding.engagement.productKey,'blueprint-self-funding');
  assert.equal(funding.lenders[0].name,'Sample Community Bank');assert.equal(funding.applications[0].lenderName,'Sample Neighborhood Bank');
  assert.equal(env.networkCalls(),0);assert.equal(env.store.get('fh_token'),'existing-real-session');
});

test('unknown transports, actions, foreign documents and changed sessions fail closed',async()=>{
  const env=open();
  await assert.rejects(env.api.request('/api/money/unknown-provider-action'),{code:'demo_route_unavailable'});
  await assert.rejects(env.api.request('/api/money/__proto__'),{code:'demo_route_unavailable'});
  await assert.rejects(env.api.request('https://other.example/api/blueprint/plan'));
  await assert.rejects(env.api.request('/api/blueprint/funding',{method:'DELETE'}));
  await assert.rejects(post(env.api,'/api/blueprint/funding',{action:'verify_funded'}));
  await assert.rejects(env.api.request('/api/documents-download?id=not-a-sample-document'),{code:'demo_document_missing'});
  env.store.set('fh_token','changed-session');assert.equal(env.api.isCurrent(),false);
  await assert.rejects(env.api.request('/api/blueprint/plan'),{code:'demo_session_changed'});assert.equal(env.networkCalls(),0);
});

test('canonical lesson and debt calculation respond to saved local inputs and survive reload',async()=>{
  const env=open();await post(env.api,'/api/blueprint/business-plans',{action:'save_payoff_plan',strategy:'avalanche',monthlyBudgetCents:20000,debts:[{id:'d1',label:'Sample small balance',balanceCents:40000,aprBps:1200,minimumPaymentCents:1000},{id:'d2',label:'Sample high APR',balanceCents:100000,aprBps:2999,minimumPaymentCents:2000}]});
  const plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.lessons.length,17);assert.equal(plan.payoffCalculation.priority[0],'d2');assert.equal(plan.payoffCalculation.allocatedCents,20000);assert.equal(plan.payoffCalculation.debts.find(d=>d.id==='d2').allocationCents,19000);
  assert.ok(plan.lessons.flatMap(l=>l.links).every(l=>new URL(l.url).origin==='https://fundhub.ai'&&new URL(l.url).searchParams.get('preview')==='document'));
  const next=open({store:env.store});assert.equal((await next.api.request('/api/blueprint/plan')).payoffCalculation.allocatedCents,20000);assert.equal(next.networkCalls(),0);
});

test('cash reserves preserve zero and unknown and detect overcommitment',async()=>{
  const env=open();await post(env.api,'/api/blueprint/business-plans',{action:'save_settings',availableCashCents:0,cashBufferCents:0,oneTimePayoffCents:100});
  let plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.cashPlan.status,'overcommitted');assert.equal(plan.cashPlan.remainingCashCents,-100);
  await post(env.api,'/api/blueprint/business-plans',{action:'save_settings',cashBufferCents:null});
  plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.cashPlan.status,'review_needed');assert.equal(plan.cashPlan.remainingCashCents,null);
});

test('upload retains metadata only and never upgrades reported evidence to verification',async()=>{
  const env=open();const form=new FormData();form.append('kind','bureau_response');form.append('subtype','other');form.append('files',new Blob(['PRIVATE FILE CONTENT MUST NOT BE SAVED']), 'sample-response.pdf');
  const reply=await env.api.request('/api/documents-upload',{method:'POST',body:form});assert.ok(reply.documents[0].id.startsWith('sample-document-'));
  const proof=new FormData();proof.append('kind','client_upload');proof.append('subtype','dispute_mail_receipt');proof.append('file',new Blob(['PRIVATE PROGRESS RECEIPT CONTENT']), 'sample-mailing-proof.pdf');assert.equal((await env.api.request('/api/documents-upload',{method:'POST',body:proof})).documents.length,1);
  const stored=env.store.get(KEY);assert.ok(!stored.includes('PRIVATE PROGRESS RECEIPT CONTENT'));assert.ok(!stored.includes('PRIVATE FILE CONTENT'));const plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.letterResponses[0].validationStatus,'pending');assert.equal(env.networkCalls(),0);
});

test('sample inquiry submissions, authorized calls and staged evidence stay distinct',async()=>{
  const env=open();env.api.setScenario('optimize');const form=new FormData();form.append('kind','inquiry_doc');form.append('files',new Blob(['demo']), 'sample-receipt.pdf');const uploaded=await env.api.request('/api/documents-upload',{method:'POST',body:form});
  await post(env.api,'/api/blueprint/inquiries',{action:'record_submission',caseId:seed.ids.case,reference:'SAMPLE-42',receiptDocumentId:uploaded.documents[0].id});
  await assert.rejects(post(env.api,'/api/blueprint/inquiries',{action:'launch_call',caseId:seed.ids.case}));
  await post(env.api,'/api/blueprint/inquiries',{action:'launch_call',caseId:seed.ids.case,authorization:true});
  await post(env.api,'/api/blueprint/inquiries',{action:'check_evidence',caseId:seed.ids.case});
  let cases=(await env.api.request('/api/blueprint/inquiries')).cases;assert.equal(cases[0].submissionReference,'SAMPLE-42');assert.equal(cases[0].call.status,'simulated — no call placed');assert.equal(cases[0].inquiries[0].state,'pending_verification');
  env.api.advance();cases=(await env.api.request('/api/blueprint/inquiries')).cases;assert.equal(cases[0].inquiries[0].state,'removed_verified');assert.equal(env.api.scenario,'ready');assert.equal(env.networkCalls(),0);
});

test('fictional lender preview and user report do not establish actual approval or funding',async()=>{
  const env=open();await assert.rejects(post(env.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender}));
  env.api.setScenario('ready');await post(env.api,'/api/blueprint/business-plans',{action:'save_business',business:{id:seed.ids.business,name:'Sample Renamed Studio LLC'}});assert.equal((await env.api.request('/api/blueprint/funding')).lenders[0].businessName,'Sample Renamed Studio LLC');const result=await post(env.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender});const url=new URL(result.url);assert.equal(url.origin,'https://fundhub.ai');assert.equal(url.searchParams.get('preview'),'bank');
  await post(env.api,'/api/blueprint/funding',{action:'report_application',applicationId:result.applicationId,status:'approved',approvedAmount:12000});
  const app=(await env.api.request('/api/blueprint/funding')).applications.find(a=>a.id===result.applicationId);assert.equal(app.businessId,seed.ids.business);assert.equal(app.businessName,'Sample Renamed Studio LLC');const preview=open({store:env.store,search:new URL(result.url).search});preview.renderPreview();assert.match(preview.nodes.map(n=>n.textContent).join(' '),/Sample Renamed Studio LLC/);assert.equal(app.outcomeVerified,false);assert.equal(app.approvedAmount,undefined);assert.equal(app.reportedApprovalAmount,12000);assert.equal(env.networkCalls(),0);
});

test('sample services retain exact quote authorization and use a local payment preview',async()=>{
  const env=open();const requested=await post(env.api,'/api/blueprint/services',{action:'request_help',serviceKind:'inquiry_removal'});const before=env.writes();await assert.rejects(post(env.api,'/api/blueprint/services',{action:'checkout',requestId:requested.request.id,authorization:true,expectedPriceCents:null,provider:'whop'}));assert.equal(env.writes(),before);const unquoted=open({store:env.store,search:new URL(env.api.previewUrl('payment',requested.request.id)).search});unquoted.renderPreview();unquoted.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();assert.equal(unquoted.writes(),0);
  const quote=await sampleQuote(env);await assert.rejects(post(env.api,'/api/blueprint/services',{action:'checkout',requestId:quote.id,authorization:true,expectedPriceCents:1,provider:'whop'}));
  const reply=await post(env.api,'/api/blueprint/services',{action:'checkout',requestId:quote.id,authorization:true,expectedPriceCents:quote.priceCents,provider:'whop'});
  const url=new URL(reply.request.checkoutUrl);assert.equal(url.searchParams.get('preview'),'payment');assert.equal(url.origin,'https://fundhub.ai');assert.equal(reply.request.status,'awaiting_payment');assert.equal(reply.request.acceptedQuoteVersion,quote.quoteVersion);assert.equal(reply.request.acceptedPriceCents,quote.priceCents);const paid=open({store:env.store,search:url.search});paid.renderPreview();paid.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();env.listeners.get('storage')({key:KEY});const paidWrites=env.writes();await assert.rejects(post(env.api,'/api/blueprint/services',{action:'checkout',requestId:quote.id,authorization:true,expectedPriceCents:quote.priceCents,provider:'whop'}));assert.equal(env.writes(),paidWrites);assert.equal(env.networkCalls(),0);
});

test('own-namespace storage refreshes sample state without adopting other local keys',async()=>{
  const env=open();const external=open({store:env.store});external.api.setScenario('ready');
  env.listeners.get('storage')({key:'fh_token'});assert.equal(env.api.scenario,'start');
  env.listeners.get('storage')({key:KEY});assert.equal(env.api.scenario,'ready');assert.ok(env.events.includes('fh:blueprint-demo-change'));
  env.store.set(KEY,JSON.stringify({schema:1,ids:{client:seed.ids.client},scenario:'ready'}));env.listeners.get('storage')({key:KEY});assert.equal((await env.api.request('/api/blueprint/funding')).engagement.id,seed.ids.engagement);
});

test('completed sample history refuses active funding/report/repair mutations and reset touches only its namespace',async()=>{
  const env=open();env.api.setScenario('completed');
  for(const [path,body]of[['funding',{action:'open_lender',lenderId:seed.ids.lender}],['repair',{action:'generate'}],['services',{action:'request_report'}]])await assert.rejects(post(env.api,'/api/blueprint/'+path,body));
  env.api.reset();assert.equal(env.api.scenario,'start');assert.equal(env.store.get('fh_token'),'existing-real-session');assert.equal(env.store.get('unrelated'),'preserve-me');assert.equal((await env.api.request('/api/blueprint/plan')).businessPlans.businesses.length,0);assert.equal(env.networkCalls(),0);
});

test('direct or stale bank/payment previews cannot mutate completed history or unknown/unaccepted orders',async()=>{
  const owner=open();owner.api.setScenario('ready');const quote=await sampleQuote(owner);const accepted=await post(owner.api,'/api/blueprint/services',{action:'checkout',requestId:quote.id,authorization:true,expectedPriceCents:quote.priceCents,provider:'whop'});const stalePaymentUrl=accepted.request.checkoutUrl;owner.api.advance();
  assert.equal((await owner.api.request('/api/blueprint/services')).requests[0].status,'cancelled');
  for(const[kind,item,label]of[['bank','unknown-application','Submit sample application'],['bank','sample-previous-application','Submit sample application'],['payment',quote.id,'Record sample payment']]){
    const preview=open({store:owner.store,search:`?demo=1&blueprint=full&preview=${kind}&item=${item}`});const before=owner.store.get(KEY);preview.renderPreview();preview.nodes.find(n=>n.textContent===label).listeners.get('click')();
    assert.equal(owner.store.get(KEY),before);assert.equal(preview.writes(),0);assert.equal(preview.networkCalls(),0);assert.ok(preview.nodes.some(n=>/complete.*read-only/.test(n.textContent)));
  }
  const stale=open({store:owner.store,search:new URL(stalePaymentUrl).search});const completedBefore=owner.store.get(KEY);stale.renderPreview();stale.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();assert.equal(owner.store.get(KEY),completedBefore);assert.equal(stale.writes(),0);assert.equal(stale.networkCalls(),0);
  owner.api.reset();
  for(const[kind,item,label]of[['bank','unknown-application','Submit sample application'],['payment',quote.id,'Record sample payment']]){
    const preview=open({store:owner.store,search:`?demo=1&blueprint=full&preview=${kind}&item=${item}`});const before=owner.store.get(KEY);preview.renderPreview();preview.nodes.find(n=>n.textContent===label).listeners.get('click')();assert.equal(owner.store.get(KEY),before);assert.equal(preview.writes(),0);assert.equal(preview.networkCalls(),0);
  }
});

test('eligible local previews mutate once and stale/replayed preview actions cannot repeat a saved effect',async()=>{
  const owner=open();owner.api.setScenario('ready');const bank=await post(owner.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender});
  const preview=open({store:owner.store,search:new URL(bank.url).search});preview.renderPreview();const submit=preview.nodes.find(n=>n.textContent==='Submit sample application');submit.listeners.get('click')();assert.equal(preview.writes(),1);submit.listeners.get('click')();assert.equal(preview.writes(),1);
  const service=await sampleQuote(owner);const quote=await post(owner.api,'/api/blueprint/services',{action:'checkout',requestId:service.id,authorization:true,expectedPriceCents:service.priceCents,provider:'whop'});
  const payment=open({store:owner.store,search:new URL(quote.request.checkoutUrl).search});payment.renderPreview();const record=payment.nodes.find(n=>n.textContent==='Record sample payment');record.listeners.get('click')();assert.equal(payment.writes(),1);record.listeners.get('click')();assert.equal(payment.writes(),1);assert.equal(payment.networkCalls(),0);
});

test('generated fictional seed and embedded pure helpers reproduce from current canonical source',()=>{
  assert.equal(seed.plan.lessons.length,17);assert.equal(seed.funding.engagement.priceCents,3000000);
  for(const TZ of ['UTC','America/Phoenix'])execFileSync(process.execPath,['scripts/demo/build-blueprint-dashboard-data.mjs','--check'],{cwd:root,stdio:'pipe',env:{...process.env,TZ}});
  assert.equal(normal(seed.plan.payoffCalculation).allocatedCents,70000);
});

test('first visit and offer switches expose real package scopes and preserve only sample onboarding',async()=>{
  const env=open();let plan=await env.api.request('/api/blueprint/plan');
  assert.equal(env.api.offer,'implementation');assert.equal(env.api.scenario,'start');assert.equal(plan.businessPlans.startedAt,null);assert.equal(plan.businessPlans.businesses.length,0);
  env.api.setOffer('preparation');assert.equal(env.api.offer,'preparation');
  for(const path of ['funding','inquiries','repair','services'])await assert.rejects(env.api.request('/api/blueprint/'+path),{code:'full_blueprint_required',status:403});
  let ent=await env.api.request('/api/read/entitlements');assert.ok(ent.items.some(e=>e.entitlement_code==='credit-optimization-roadmap'));assert.ok(!ent.items.some(e=>e.entitlement_code==='blueprint-client-fulfillment'));
  const summary=await env.api.request('/api/read/portal-summary'),contract=await env.api.request('/api/read/portal-contracts');assert.equal(summary.payments[0].amount,10000);assert.equal(contract.items[0].amount_cents,1000000);assert.equal(contract.items[0].template_key,'CAPITAL-BLUEPRINT-AGREEMENT');
  const reloaded=open({store:env.store});assert.equal(reloaded.api.offer,'preparation');assert.equal((await reloaded.api.request('/api/blueprint/plan')).businessPlans.businesses.length,0);
  reloaded.api.setOffer('implementation');ent=await reloaded.api.request('/api/read/entitlements');assert.ok(ent.items.some(e=>e.entitlement_code==='blueprint-client-fulfillment'));assert.equal((await reloaded.api.request('/api/read/portal-summary')).payments[0].amount,30000);assert.equal(env.store.get('fh_token'),'existing-real-session');
});

test('native Response transport stays local on the real portal and progress paths and fails unknown routes',async()=>{
  const env=open({pathname:'/progress.html'});const response=await env.api.fetchResponse('/api/read/client-progress');assert.ok(response instanceof Response);assert.equal(response.status,200);const data=await response.json();assert.ok(Array.isArray(data.waypoints));assert.ok(data.stage);assert.ok(data.scores);
  const unknown=await env.api.fetchResponse('/api/money/bank-private');assert.equal(unknown.status,404);assert.equal((await unknown.json()).error,'demo_route_unavailable');assert.equal(env.networkCalls(),0);
  env.api.setOffer('preparation');const denied=await env.api.fetchResponse('/api/blueprint/funding');assert.equal(denied.status,403);assert.equal((await denied.json()).error,'full_blueprint_required');
});

test('onboarding, new business and credit-proof gates remain separate from funding readiness',async()=>{
  const env=open();env.api.setOffer('preparation');
  await post(env.api,'/api/blueprint/business-plans',{action:'save_settings',hasExistingBusiness:false});await post(env.api,'/api/blueprint/business-plans',{action:'save_settings',targetBusinessCount:3});await post(env.api,'/api/blueprint/business-plans',{action:'save_settings',homeState:'AZ',postalCode:'85004',started:true});
  let plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.businessPlans.setupStep,3);assert.ok(plan.businessPlans.startedAt);assert.equal(plan.businessPlans.businesses.length,0);
  await post(env.api,'/api/blueprint/business-plans',{action:'save_business',business:{id:'d0000000-0000-4000-8000-000000000001',name:'Sample First LLC',activity:'Sample cleaning services',formationState:'AZ',formationStatus:'planned'}});
  plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.businessPlans.businesses.length,1);assert.equal(plan.businessPlans.businesses[0].name,'Sample First LLC');assert.equal(open({store:env.store}).api.offer,'preparation');
  env.api.setScenario('optimize');const progress=await env.api.request('/api/read/client-progress');const paydown=progress.waypoints.find(w=>w.verifyKind==='paydown'),llc=progress.waypoints.find(w=>w.key==='form_llc');assert.ok(paydown);assert.ok(llc);
  await assert.rejects(post(env.api,'/api/waypoint-tick',{waypoint_id:paydown.id,done:true}),{code:'waypoint_proof_required'});await post(env.api,'/api/waypoint-tick',{waypoint_id:llc.id,done:true});assert.equal((await env.api.request('/api/read/client-progress')).waypoints.find(w=>w.id===llc.id).state,'done');await assert.rejects(env.api.request('/api/blueprint/funding'),{code:'full_blueprint_required'});
});

test('Secretary of State and EIN previews show their actual guide, steps and proof',()=>{
  const owner=open();owner.api.setScenario('optimize');
  for(const key of ['formation','ein']){
    const preview=open({store:owner.store,search:'?demo=1&blueprint=full&preview=document&item='+encodeURIComponent('lesson:'+key+':0:'+seed.ids.business)});preview.renderPreview();const text=preview.nodes.map(n=>n.textContent).join('\n');
    assert.match(text,key==='formation'?/single-member LLC/:/EIN confirmation/);assert.match(text,/Proof to save:/);assert.match(text,/Official reference:/);assert.match(text,key==='formation'?/Arizona|azcc/i:/irs\.gov/);assert.equal(preview.networkCalls(),0);
  }
});

test('CSM guidance uses the canonical conversation and ready-to-fund request is idempotent without granting an engine',async()=>{
  const env=open();env.api.setOffer('preparation');const before=(await env.api.request('/api/chat/portal-message')).messages.length;
  await post(env.api,'/api/chat/portal-message',{body:'Please help me review whether an aged business fits my actual facts.',channel:'sms',topic:'aged_business'});
  const first=await post(env.api,'/api/money/ready-to-fund',{}),second=await post(env.api,'/api/money/ready-to-fund',{});assert.equal(first.status,'requested');assert.equal(second.task_id,first.task_id);assert.equal((await env.api.request('/api/chat/portal-message')).messages.length,before+2);await assert.rejects(env.api.request('/api/blueprint/funding'),{code:'full_blueprint_required'});assert.equal(env.networkCalls(),0);
});

test('the exact $97 mailing quote binds document versions and payment/acceptance remain separate',async()=>{
  const env=open();env.api.setScenario('optimize');const list=await env.api.request('/api/blueprint/letter-mailing');assert.equal(list.capabilities.mailSupported,true);assert.equal(list.capabilities.hostedCheckoutSupported,true);assert.equal(list.capabilities.savedCardSupported,false);assert.equal(list.priceCents,9700);assert.equal(list.maxLetters,6);const old=JSON.parse(env.store.get(KEY));delete old.letters.capabilities;delete old.letters.priceCents;delete old.letters.maxLetters;const persisted=new Map(env.store);persisted.set(KEY,JSON.stringify(old));const restored=open({store:persisted});assert.equal((await restored.api.request('/api/blueprint/letter-mailing')).capabilities.mailSupported,true);assert.equal(restored.networkCalls(),0);const first=await post(env.api,'/api/blueprint/letter-mailing',{action:'quote',documentIds:[list.letters[0].documentId]});
  const quote=await post(env.api,'/api/blueprint/letter-mailing',{action:'quote',documentIds:list.letters.map(d=>d.documentId)});assert.notEqual(first.quoteVersion,quote.quoteVersion);
  await assert.rejects(post(env.api,'/api/blueprint/letter-mailing',{action:'confirm',orderId:first.orderId,quoteVersion:first.quoteVersion,paymentOptionId:'sample-hosted',authorization:true}));
  await assert.rejects(post(env.api,'/api/blueprint/letter-mailing',{action:'confirm',orderId:quote.orderId,quoteVersion:quote.quoteVersion,paymentOptionId:'sample-hosted',authorization:false}));
  const payload={action:'confirm',orderId:quote.orderId,quoteVersion:quote.quoteVersion,paymentOptionId:'sample-hosted',authorization:true};const confirmed=await post(env.api,'/api/blueprint/letter-mailing',payload);await post(env.api,'/api/blueprint/letter-mailing',payload);
  assert.equal(confirmed.order.totalCents,9700);assert.equal(confirmed.order.quoteVersion,quote.quoteVersion);assert.deepEqual(normal(confirmed.order.items.map(i=>i.documentId)),normal(list.letters.map(i=>i.documentId)));assert.ok(confirmed.order.items.every(i=>i.currentVersionId==='sample-v1'));
  const payment=open({store:env.store,search:new URL(confirmed.order.checkoutUrl).search});payment.renderPreview();payment.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();env.listeners.get('storage')({key:KEY});let saved=await env.api.request('/api/blueprint/letter-mailing');assert.equal(saved.orders.filter(o=>o.id===confirmed.order.id).length,1);assert.equal(saved.orders.find(o=>o.id===first.orderId).status,'cancelled');const paid=saved.orders.find(o=>o.id===confirmed.order.id);assert.equal(paid.status,'mail_pending');assert.equal(paid.paymentState,'paid');assert.equal(paid.envelopes.length,0);
  env.api.advance();saved=await env.api.request('/api/blueprint/letter-mailing');const mailed=saved.orders.find(o=>o.id===confirmed.order.id);assert.equal(mailed.status,'mailed');assert.ok(mailed.envelopes.every(e=>e.status==='accepted'&&e.trackingUrl===null));assert.equal(env.networkCalls(),0);
});

test('funding help waits for a scoped quote and exact local payment before same-round team ownership',async()=>{
  const env=open();env.api.setScenario('ready');const before=await env.api.request('/api/blueprint/funding');
  const requested=await post(env.api,'/api/blueprint/services',{action:'request_help',serviceKind:'funding_round',targetId:before.engagement.roundId,note:'Please quote the same purchased round.'});assert.equal(requested.request.status,'requested');assert.equal(requested.request.priceCents,null);
  await assert.rejects(post(env.api,'/api/blueprint/services',{action:'checkout',requestId:requested.request.id,authorization:true,expectedPriceCents:1,provider:'whop'}));env.api.advance();const quote=(await env.api.request('/api/blueprint/services')).requests.find(r=>r.id===requested.request.id);assert.equal(quote.status,'quoted');
  const checkout=await post(env.api,'/api/blueprint/services',{action:'checkout',requestId:quote.id,authorization:true,expectedPriceCents:quote.priceCents,provider:'whop'});const payment=open({store:env.store,search:new URL(checkout.request.checkoutUrl).search});payment.renderPreview();payment.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();env.listeners.get('storage')({key:KEY});
  const after=await env.api.request('/api/blueprint/funding');assert.equal(after.engagement.id,before.engagement.id);assert.equal(after.engagement.roundId,before.engagement.roundId);assert.equal(after.engagement.executionOwner,'fundhub');assert.equal(after.state,'managed');assert.equal((await env.api.request('/api/blueprint/inquiries')).cases[0].executionOwner,'client');assert.equal((await env.api.request('/api/blueprint/services')).requests.find(r=>r.id===quote.id).amountPaidCents,quote.priceCents);assert.equal(env.networkCalls(),0);
});


test('Blueprint and actual FinanceOS reads share one current full CRS result and never multiply a personal guarantee',async()=>{
  const env=open({pathname:'/app/financeos.html'});assert.ok(env.api);env.api.setScenario('optimize');
  const plan=await env.api.request('/api/blueprint/plan'),progress=await env.api.request('/api/read/client-progress'),money=await env.api.request('/api/money/fundability'),credit=await env.api.request('/api/money/credit');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.opportunity)),JSON.parse(JSON.stringify(money.opportunity)));assert.deepEqual(JSON.parse(JSON.stringify(progress.opportunity)),JSON.parse(JSON.stringify(money.opportunity)));
  const scored=runTierEngineFromCrsResult(seed.creditSnapshots.initial.raw,{submittedName:'Alex Sample',submittedAddress:'100 Example Street, Phoenix, AZ, 85004'},{runEngine:options=>crsEngine.runCRSEngine({...options,referenceDate:new Date(seed.creditSnapshots.initial.source.asOf)})});
  const actual=buildFundingOpportunity({analysis:scored,source:seed.creditSnapshots.initial.source,businessPlans:plan.businessPlans});
  assert.equal(plan.opportunity.personal.currentCents,actual.personal.currentCents);assert.equal(plan.opportunity.personal.projectedCents,actual.personal.projectedCents);
  assert.equal(plan.opportunity.basis,'current_crs_engine');assert.equal(plan.creditContext.reportId,credit.report_id);assert.equal(plan.creditContext.asOf,credit.as_of);
  for(const row of progress.scores.personal){assert.equal(row.score,credit.personal[row.bureau].score);assert.equal(row.pulledAt,credit.personal[row.bureau].pulled_at);}
  assert.equal(plan.opportunity.combined.currentCents,null);assert.equal(plan.opportunity.businesses.length,3);assert.ok(plan.opportunity.businesses.every(b=>b.currentCents===null&&b.blockers.includes('matched_business_credit_report_required')));
  const simple=progress.waypoints.find(w=>w.closedBy==='client');await post(env.api,'/api/waypoint-tick',{waypoint_id:simple.id,done:true});
  assert.equal((await env.api.request('/api/blueprint/plan')).opportunity.personal.currentCents,plan.opportunity.personal.currentCents);
  env.api.setScenario('ready');const updated=await env.api.request('/api/blueprint/plan'),updatedCredit=await env.api.request('/api/money/credit');
  assert.notEqual(updated.creditContext.reportId,plan.creditContext.reportId);assert.notEqual(updated.creditContext.asOf,plan.creditContext.asOf);assert.notEqual(updatedCredit.personal.experian.score,credit.personal.experian.score);assert.notEqual(updated.opportunity.personal.currentCents,plan.opportunity.personal.currentCents);
  assert.ok(updated.opportunity.businesses.every(b=>b.currentCents===null));assert.equal(env.networkCalls(),0);
});

test('FinanceOS canonical core/empty reads and full sample report remain fictional with no bank/provider writes',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('optimize');
  const overview=await env.api.request('/api/money/overview');assert.equal(overview.client.id,seed.ids.client);assert.equal(overview.accounts[0].institution,'Sample Community Bank');assert.ok(overview.accounts.every(a=>a.provider==='manual'));
  for(const section of ['overview','credit','fundability','plan','tasks','accounts','alerts','banks','connections','payments','setup','strategy','transfers','trends','vault','declines','helper']){const res=await env.api.fetchResponse('/api/money/'+section);assert.equal(res.status,200,section);assert.equal((await res.json()).sample,true,section);}
  const setup=await env.api.request('/api/money/setup');assert.equal(setup.paid,false);assert.equal(setup.entitled,true);assert.equal(setup.containers,4);assert.equal(setup.steps.length,4);assert.equal(setup.steps.find(s=>s.key==='pay').done,true);assert.equal(setup.steps.find(s=>s.key==='soft_pull').done,true);assert.equal(setup.setup_fee_cents,null);assert.equal((await env.api.request('/api/money/ready-to-fund')).offers.financeos.entitled,true);
  const declines=await env.api.request('/api/blueprint/declines');assert.equal(declines.view.client.id,seed.ids.client);assert.equal(declines.view.applications[0].bank,'Sample Neighborhood Bank');await assert.rejects(post(env.api,'/api/blueprint/declines',{action:'outcome',outcome:'approved_on_recon'}),{status:409});
  const plan=await env.api.request('/api/money/plan?month=2026-12');assert.equal(plan.days.length,31);assert.equal(plan.viewer,'client');assert.ok(plan.pins.every(p=>p.can_mark.length===0));
  await assert.rejects(env.api.request('/api/dashboard/client'),{status:403});
  for(const route of ['/api/banking/link-token','/api/banking/link-exchange','/api/money/transfers','/api/money/plan']){const response=await env.api.fetchResponse(route,{method:'POST',body:JSON.stringify({action:'execute'})});assert.ok(response.status>=400);}
  const preview=open({search:'?demo=1&blueprint=full&preview=document&item='+seed.ids.report,store:env.store});preview.renderPreview();const text=preview.nodes.map(n=>n.textContent).join(' ');assert.match(text,/Full sample credit report/);assert.match(text,/sample-crs-report-initial/);assert.match(text,/Experian.*662/);assert.match(text,/Equifax.*668/);assert.match(text,/TransUnion.*665/);assert.match(text,/Sample Card A/);assert.match(text,/2,400/);assert.match(text,/Sample Community Bank on 2026-09-06/);assert.match(text,/Business credit report status/);assert.ok(!text.includes('WILLIE'));assert.ok(!text.includes('BARBARA'));assert.equal(env.networkCalls(),0);assert.equal(preview.networkCalls(),0);
});
