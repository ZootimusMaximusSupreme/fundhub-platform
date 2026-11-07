import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import {runTierEngineFromCrsResult} from '../finance/crs-tier.mjs';
import {buildFundingOpportunity} from '../blueprint/funding-opportunity.mjs';
import crsEngine from '../finance/vendor/crs-engine.cjs';
import {applicationGuide,fullReportRows,GUIDE_RULE,inquiryCall,mailTo,readBlueprintCycle} from '../blueprint/fulfillment-cycle.mjs';
import {BUREAU_SCRIPTS,bureauDialPlan} from '../inquiry-ops/bureau-dial-plan.mjs';
import {detectIncome,TRANSFER_MATCH_DAYS,WINDOW_DAYS} from '../banking/income.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(root+'public/app/blueprint-demo.js','utf8');
const seed=JSON.parse(readFileSync(root+'public/app/blueprint-demo-data.json','utf8'));
const KEY='fh_blueprint_portal_demo_v2';
// The Strategy tab loads this shared browser math module itself; the vm has no
// module loader, so the page-level copy is handed in the same way a page would.
const strategyMath=await import('../../public/app/money-strategy-math.js');
function open({search='?demo=1&blueprint=full',pathname='/app/client-portal.html',store=new Map([['fh_token','existing-real-session'],['unrelated','preserve-me']])}={}){
  let calls=0,writes=0;const listeners=new Map(),documentListeners=new Map();const events=[],nodes=[];
  const localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>{writes++;store.set(key,String(value));},removeItem:key=>store.delete(key)};
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type),opener:null,FHStrategyMath:strategyMath};
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

test('"Your path" reads each stage\'s own pulls: none at start, one pull, then card use from the first pull to the newest',async()=>{
  const env=open({pathname:'/app/financeos.html'});assert.ok(env.api);
  const labels=path=>Object.fromEntries((path?.milestones||[]).map(m=>[m.id,m.impact]));
  const start=await env.api.request('/api/blueprint/plan');
  assert.equal(start.path.measured,null,'the start stage has no pull to measure');
  env.api.setScenario('optimize');const one=await env.api.request('/api/blueprint/plan');
  assert.equal(one.path.measured.samePull,true);assert.equal(one.path.measured.newestAsOf,seed.creditSnapshots.initial.source.asOf);
  assert.equal(labels(one.path)['UTIL_CARD_OVER_10:sample_card_a'],'Card use 30% · target 10%','Card A is $2,400 of $8,000 on the first pull');
  env.api.setScenario('ready');const two=await env.api.request('/api/blueprint/plan');
  assert.equal(two.path.measured.samePull,false);assert.equal(two.path.measured.firstAsOf,seed.creditSnapshots.initial.source.asOf);assert.equal(two.path.measured.newestAsOf,seed.creditSnapshots.updated.source.asOf);
  assert.equal(labels(two.path)['UTIL_CARD_OVER_10:sample_card_a'],'Card use 30% → 5%','Card A $2,400 → $400 of $8,000');
  assert.doesNotMatch(JSON.stringify(two.path),/\d\s*points?\b|"points"/i,'no points on the path');
  // The business step carries the checklist's own key, and the path's fundability
  // and business figure say exactly what the demo's own Fundability read says.
  const fund=await env.api.request('/api/money/fundability');
  const llc=two.path.steps.find(s=>s.key==='form_llc');
  assert.ok(llc,'the demo business step is the checklist step form_llc');
  const bizCents=fund.businesses[0]?.now?.funding_estimate_cents??null;
  assert.equal(llc.impact,bizCents===null?'Unlocks business funding':`UnderwriteIQ estimate: $${(bizCents/100).toLocaleString('en-US')} business funding`);
  assert.equal(two.path.fundability===null,typeof fund.now.score!=='number','no fundability chip unless the demo read has a score');
  assert.equal(env.networkCalls(),0);
});

/* Owner rule 2026-11-07 (every bank shows its own logo) and accountability QA04:
   the demo Banks read carries each bank's bank-book logo, the shape unit H's read returns. */
test('the demo Banks read gives every bank, stacking line and plan row its own bank-book logo',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('ready');
  const banks=await env.api.request('/api/money/banks');
  const all=[...banks.recommended_banks,...(banks.card_stacking?.items||[]),...banks.relationships];
  assert.ok(banks.recommended_banks.length>0&&banks.relationships.length>0);
  for(const b of all){
    assert.match(String(b.logo),/^\/assets\/lenders\/[a-z0-9][a-z0-9._-]*\.png$/,`${b.name||b.issuer||b.bank} has its logo`);
    assert.equal(b.logo_source,'bank_book');
  }
  assert.equal(banks.recommended_banks.find(b=>b.name==='Chase').logo,'/assets/lenders/chase.png');
  assert.equal(env.networkCalls(),0);
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

// ── FinanceOS sample money year (unit G) ────────────────────────────────────
const money=seed.money;
const moneyDayList=Array.from({length:money.days},(_,i)=>new Date(Date.parse(money.start+'T00:00:00Z')+i*864e5).toISOString().slice(0,10));
const reportCents=(snap,name)=>Math.round(Number(snap.raw.bureaus.EX.tradelines.find(l=>l.creditorName===name).currentBalanceAmount)*100);

test('the sample money generator gives the same year on every run, in whole cents, with no card below zero',()=>{
  const run=TZ=>execFileSync(process.execPath,['scripts/demo/build-blueprint-dashboard-data.mjs','--money-json'],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,TZ}}).toString();
  const first=run('UTC'),second=run('America/Phoenix');
  assert.equal(first,second,'Two runs must be byte-for-byte the same');
  assert.deepEqual(JSON.parse(first),money,'The committed sample year must be the generator output');
  assert.equal(money.seed,20261106);assert.equal(money.start,'2025-11-07');assert.equal(money.days,365);
  assert.equal(moneyDayList.at(-1),money.asOf.updated);
  for(const [key,series] of Object.entries(money.balances)){
    assert.equal(series.length,365,key);
    assert.ok(series.every(v=>Number.isSafeInteger(v)&&v>=0),key+' holds whole, non-negative cents');
  }
  for(const key of ['cardA','cardB'])assert.ok(money.balances[key].every(v=>v>=0),key+' is never a negative balance');
  for(const [day,account,amount] of money.transactions.rows){assert.ok(Number.isInteger(day)&&day>=0&&day<365);assert.ok(['chk','sav'].includes(account));assert.ok(Number.isSafeInteger(amount)&&amount!==0);}
  // Every checking and savings day moves by exactly that day's transactions.
  for(const key of ['chk','sav'])for(let i=1;i<365;i++){
    const moved=money.transactions.rows.filter(r=>r[0]===i&&r[1]===key).reduce((s,r)=>s+r[2],0);
    assert.equal(money.balances[key][i]-money.balances[key][i-1],moved,`${key} on ${moneyDayList[i]}`);
  }
});

test('the sample money year is pinned to the engine report and the saved Blueprint plan',()=>{
  const {initial,updated}=seed.creditSnapshots,plans=seed.plan.businessPlans,i1=moneyDayList.indexOf(money.asOf.initial),i2=moneyDayList.indexOf(money.asOf.updated);
  assert.equal(money.asOf.initial,'2026-10-06');assert.equal(money.asOf.updated,'2026-11-06');
  // The engine's own numbers on its two pulls.
  assert.deepEqual(initial.analysis.consumerSignals.scores.perBureau,{tu:665,ex:662,eq:668});
  assert.deepEqual(updated.analysis.consumerSignals.scores.perBureau,{tu:715,ex:712,eq:718});
  assert.equal(initial.analysis.consumerSignals.utilization.pct,25);assert.equal(updated.analysis.consumerSignals.utilization.pct,5);
  assert.equal(initial.analysis.consumerSignals.inquiries.total,3);assert.equal(updated.analysis.consumerSignals.inquiries.total,0);
  assert.equal(initial.opportunity.personal.currentCents,9360000);assert.equal(initial.opportunity.personal.projectedCents,10400000);assert.equal(updated.opportunity.personal.currentCents,10400000);
  // Card A $2,400 -> $400, Card B $850 -> $250: the report's lines, exactly.
  assert.equal(money.balances.cardA[i1],240000);assert.equal(money.balances.cardA[i2],40000);
  assert.equal(money.balances.cardB[i1],85000);assert.equal(money.balances.cardB[i2],25000);
  for(const [snap,i] of [[initial,i1],[updated,i2]]){
    assert.equal(money.balances.cardA[i],reportCents(snap,'Sample Card A'));assert.equal(money.balances.cardB[i],reportCents(snap,'Sample Card B'));
    assert.equal(money.balances.loan[i],reportCents(snap,'Sample Auto Loan'));
    const cards=money.accounts.filter(a=>a.type==='credit'),used=cards.reduce((s,a)=>s+money.balances[a.key][i],0)/cards.reduce((s,a)=>s+a.limit_cents,0)*100;
    assert.equal(used,snap.analysis.consumerSignals.utilization.pct,'Card use on the pull day is the engine\'s');
  }
  const acct=Object.fromEntries(money.accounts.map(a=>[a.key,a]));
  assert.deepEqual([acct.cardA.apr_bps,acct.cardA.min_cents,acct.cardA.limit_cents],[2199,7000,800000]);
  assert.deepEqual([acct.cardB.apr_bps,acct.cardB.min_cents,acct.cardB.limit_cents],[2699,3500,500000]);
  assert.equal(acct.loan.apr_bps,null,'The auto loan rate is not on file');assert.equal(acct.loan.payment_cents,25000);assert.equal(money.balances.loan[i1],900000);
  // Cash, money coming in and the buffer are the plan's.
  assert.equal(money.balances.chk[i2]+money.balances.sav[i2],plans.availableCashCents);assert.equal(plans.availableCashCents,600000);
  const avg=key=>{const end=Date.parse(money.asOf.updated+'T00:00:00Z'),start=end-90*864e5,hits=money.transactions.rows.filter(r=>r[3]===key&&Date.parse(moneyDayList[r[0]]+'T00:00:00Z')>start&&Date.parse(moneyDayList[r[0]]+'T00:00:00Z')<=end);return hits.reduce((s,r)=>s+r[2],0)/hits.length;};
  assert.ok(Math.abs(avg('payroll')*26/12+avg('stripe')*52/12-plans.monthlyIncomeCents)<=1,'Money coming in is the plan\'s $7,500 a month');
  assert.equal(money.cash_buffer_cents,200000);assert.equal(money.payouts.rows.length,52);
  // Bank book: deposits stay "not set" in the book; the $5,000 is the sample staff plan, with the book's own sentence.
  assert.deepEqual(money.banks.map(b=>b.recommended.name),['Chase','Bank of America']);
  for(const b of money.banks){assert.equal(b.recommended.minimum_deposit_cents,null);assert.equal(b.recommended.seasoning_days,30);assert.ok(existsSync(root+'public'+b.recommended.logo_path),b.recommended.logo_path);}
  assert.match(money.banks[0].deposit_quote,/season with \$5K\+ for 30\+ days/);assert.match(money.banks[1].deposit_quote,/Season with \$5K–\$10K for 30\+ days/);
  for(const rows of Object.values(money.bankPlan))for(const r of rows){assert.equal(r.deposit_plan_cents,500000);assert.equal(r.deposit_plan_source.label,'Set by staff');assert.equal(r.status,'planned');assert.match(r.logo_path,/^\/assets\/lenders\//);}
});

test('FinanceOS demo money reads follow the stage day and the real read shapes with no request',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('optimize');
  let overview=normal(await env.api.request('/api/money/overview'));
  assert.equal(overview.sandbox,false,'The overview never claims a Plaid sandbox');assert.equal(overview.as_of.slice(0,10),'2026-10-06');
  assert.deepEqual(overview.debt.cards.map(c=>c.balance_cents),[240000,85000]);assert.equal(overview.cash.business.cents,null);assert.equal(overview.cash.business.accounts,0);
  assert.ok(overview.accounts.every(a=>a.sample===true&&a.provider==='manual'&&a.institution==='Sample Community Bank'&&!('logo' in a)));
  const optimize=normal(await env.api.request('/api/money/trends?range=12m'));
  assert.equal(optimize.daily.days.length,365);assert.equal(optimize.daily.days.at(-1),'2026-10-06');
  assert.equal(optimize.daily.cash.personal.cents[0],null,'A day before the sample year is a gap, never $0');
  assert.equal(optimize.daily.cards_used_pct.at(-1),25);
  env.api.setScenario('ready');
  overview=normal(await env.api.request('/api/money/overview'));
  assert.deepEqual(overview.debt.cards.map(c=>c.balance_cents),[40000,25000]);assert.equal(overview.cash.personal.cents,600000);assert.equal(overview.debt.loans[0].payment_cents,25000);
  const trends=normal(await env.api.request('/api/money/trends?range=12m'));
  assert.deepEqual(Object.keys(trends.daily).sort(),['cards_used_pct','cash','days','debt','estimated']);
  assert.ok(trends.daily.cash.personal.cents.every(Number.isSafeInteger));assert.equal(trends.daily.cash.personal.cents.at(-1),600000);
  assert.ok(trends.daily.cash.business.cents.every(v=>v===null),'Business cash is unknown, never added to personal');
  assert.equal(trends.daily.cards_used_pct.at(-1),5);assert.equal(trends.monthly.months.length,12);assert.ok(trends.monthly.has_transactions);
  assert.equal(trends.sales,null);assert.equal(trends.credit.history.length,2);assert.deepEqual(trends.credit.history.map(p=>p.experian),[662,712]);
  assert.deepEqual(trends.accounts.map(a=>a.type),['checking','savings','card','card','loan']);
  for(const [range,days,months] of [['30d',30,2],['90d',90,3]]){const r=normal(await env.api.request('/api/money/trends?range='+range));assert.equal(r.daily.days.length,days);assert.equal(r.monthly.months.length,months);assert.equal(r.range,range);}
  const card=normal(await env.api.request('/api/money/trends?from=2026-10-01&to=2026-11-06&account=sample-card-a'));
  assert.equal(card.custom,true);assert.equal(card.range,null);assert.equal(card.account.id,'sample-card-a');assert.equal(card.account.used_pct.at(-1),5);assert.equal(card.account.balance_cents.at(-1),40000);assert.equal(card.account.limit_cents.at(-1),800000);
  for(const [query,words] of [['range=7d','range must be 30d, 90d or 12m'],['range=30d&from=2026-01-01&to=2026-02-01','send range, or from and to, not both'],['from=2026-01-01','from and to go together: send both'],['from=2026-02-30&to=2026-03-01','from and to must be real dates written YYYY-MM-DD'],['from=2026-03-01&to=2026-02-01','from must be on or before to'],['from=2023-01-01&to=2026-02-01','pick 24 months or less between from and to']])
    await assert.rejects(env.api.request('/api/money/trends?'+query),{status:400,message:words});
  await assert.rejects(env.api.request('/api/money/trends?range=90d&account=a0000000-0000-4000-8000-0000000000ff'),{status:404});
  const credit=normal(await env.api.request('/api/money/credit'));assert.deepEqual(credit.history.map(p=>p.transunion),[665,715]);
  const strategy=normal(await env.api.request('/api/money/strategy'));
  assert.deepEqual(strategy.inputs.debts.map(d=>[d.name,d.apr_pct,d.min_cents]),[['Sample Card A',21.99,7000],['Sample Card B',26.99,3500],['Sample Auto Loan',null,25000]]);
  assert.equal(strategy.inputs.cash.by_kind.personal.floor_cents,200000);assert.ok(strategy.plan.ok);assert.equal(strategy.methods.snowball.short,'Snowball');assert.equal(strategy.methods.avalanche.short,'Avalanche');
  const payments=normal(await env.api.request('/api/money/payments'));assert.equal(payments.owed.left_cents,0);assert.ok(payments.upcoming.some(u=>u.type==='card_due'&&u.name==='Sample Card A'&&u.amount_cents===7000));
  const banks=normal(await env.api.request('/api/money/banks'));assert.deepEqual(banks.recommended_banks.map(b=>[b.name,b.logo_path]),[['Chase','/assets/lenders/chase.png'],['Bank of America','/assets/lenders/bank-of-america.png']]);
  assert.equal(banks.relationships.length,2);assert.ok(banks.card_stacking.items.length>0);
  const plan=normal(await env.api.request('/api/money/plan?month=2026-11'));assert.ok(plan.pins.some(p=>p.source==='dues'&&p.title==='Pay Sample Card A'&&p.date==='2026-11-25'));
  for(const section of ['alerts','transfers','connections','accounts'])assert.equal((normal(await env.api.request('/api/money/'+section))).sample,true,section);
  assert.equal(env.networkCalls(),0);
});

test('FinanceOS demo money writes change only this demo\'s local state and unknown actions stay closed',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('ready');
  assert.equal((normal(await post(env.api,'/api/money/alerts',{action:'set_alert',kind:'payment_timing',enabled:false}))).saved.enabled,false);
  normal(await post(env.api,'/api/money/alerts',{action:'set_statement_close_day',account_id:'sample-card-b',day:20}));
  let alerts=normal(await env.api.request('/api/money/alerts'));
  assert.equal(alerts.settings.kinds.payment_timing.enabled,false);assert.equal(alerts.settings.saved,true);
  const cardB=alerts.cards.find(c=>c.account_id==='sample-card-b');assert.equal(cardB.statement_close_day,20);assert.equal(cardB.close_day_source,'manual');assert.equal(cardB.pay_before.next_close_on,'2026-11-20');
  const reloaded=open({pathname:'/app/financeos.html',store:env.store});alerts=normal(await reloaded.api.request('/api/money/alerts'));assert.equal(alerts.settings.kinds.payment_timing.enabled,false,'A saved switch survives reload');
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'set_alert',kind:'not_a_kind',enabled:true}),{status:400});
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'send_text'}),{status:409});
  const saved=normal(await post(env.api,'/api/money/strategy',{action:'save_plan',method:'snowball',monthly_cents:70000}));
  assert.equal(saved.saved.method,'snowball');assert.equal((normal(await env.api.request('/api/money/strategy'))).defaults.method,'snowball');
  await assert.rejects(post(env.api,'/api/money/strategy',{action:'save_plan',method:'random',monthly_cents:70000}),{status:400});
  await assert.rejects(post(env.api,'/api/money/strategy',{action:'pay_now'}),{status:409});
  for(const [route,body] of [['/api/money/banks',{action:'record_deposit'}],['/api/money/connections',{action:'create'}],['/api/money/payments',{action:'record_payment'}],['/api/money/helper',{action:'send',message:'hi'}],['/api/money/vault',{action:'add_item'}]])
    await assert.rejects(post(env.api,route,body),{code:'demo_route_unavailable'});
  env.api.reset();assert.equal((normal(await env.api.request('/api/money/alerts'))).settings.kinds.payment_timing.enabled,true,'Reset brings the sample back');
  assert.equal(env.networkCalls(),0);assert.equal(env.store.get('fh_token'),'existing-real-session');
});

// ── The client fulfillment cycle (unit CYCLE) ──────────────────────────────
const samplePulls=[seed.creditSnapshots.initial,seed.creditSnapshots.updated].map((snap,i)=>({document_id:seed.ids.report,version:i+1,generated_at:snap.source.asOf}));
/* The numbers written in the bureau call scripts, the way the generator reads them. */
function scriptDialPlan(){const saved=BUREAU_SCRIPTS.map(s=>[s.env,process.env[s.env]]);for(const [key] of saved)delete process.env[key];try{return bureauDialPlan({env:{}});}finally{for(const [key,value] of saved)if(value!==undefined)process.env[key]=value;}}

test('the plan carries the cycle: each pull\'s full report so far, the selected package, fundable at ready and completed, and a local booking page',async()=>{
  const env=open();let plan=await env.api.request('/api/blueprint/plan');
  const real=await readBlueprintCycle({},{orgId:seed.ids.org,clientId:seed.ids.client},{readReports:async()=>[]});
  assert.deepEqual(Object.keys(plan.cycle),Object.keys(real),'the same fields the real plan read sends');
  assert.deepEqual(normal(plan.cycle.fullReports),[],'no soft pull yet');assert.equal(plan.cycle.offer,'implementation');assert.equal(plan.cycle.fundable,null);
  const book=new URL(plan.cycle.bookCallUrl);assert.equal(book.origin,'https://fundhub.ai');assert.equal(book.searchParams.get('preview'),'document');assert.equal(book.searchParams.get('item'),'book-call');
  env.api.setScenario('optimize');plan=await env.api.request('/api/blueprint/plan');
  assert.deepEqual(normal(plan.cycle.fullReports),normal(fullReportRows(samplePulls.slice(0,1))),'the first pull only');assert.equal(plan.cycle.fundable,null);
  for(const stage of ['ready','completed']){
    env.api.setScenario(stage);plan=await env.api.request('/api/blueprint/plan');
    assert.deepEqual(normal(plan.cycle.fullReports),normal(fullReportRows(samplePulls)),stage);assert.equal(plan.cycle.fundable,true,stage);
  }
  assert.deepEqual(normal(plan.cycle.fullReports.map(r=>[r.version,r.pulledAt,r.newest])),[[2,seed.creditSnapshots.updated.source.asOf,true],[1,seed.creditSnapshots.initial.source.asOf,false]]);
  env.api.setOffer('preparation');env.api.setScenario('ready');plan=await env.api.request('/api/blueprint/plan');
  assert.equal(plan.cycle.offer,'preparation');assert.equal(plan.cycle.fundable,true);
  const booking=open({store:env.store,search:new URL(plan.cycle.bookCallUrl).search});booking.renderPreview();
  assert.match(booking.nodes.map(n=>n.textContent).join(' '),/Sample booking page/);
  assert.equal(env.networkCalls(),0);assert.equal(booking.networkCalls(),0);
});

test('each saved report version opens that pull\'s own report, and a version this stage does not have is not found',async()=>{
  const env=open();env.api.setScenario('optimize');
  const link=async version=>new URL((await env.api.request(`/api/documents-download?id=${seed.ids.report}&version=${version}`)).document.download.url);
  const shown=url=>{const preview=open({store:env.store,search:url.search});preview.renderPreview();assert.equal(preview.networkCalls(),0);return preview.nodes.map(n=>n.textContent).join(' ');};
  assert.match(shown(await link(1)),/sample-crs-report-initial[\s\S]*Experian · 662/);
  await assert.rejects(env.api.request(`/api/documents-download?id=${seed.ids.report}&version=2`),{code:'not_found',status:404});
  assert.match(shown(new URL(env.api.previewUrl('document',seed.ids.report+':2'))),/not on this sample file yet/);
  await assert.rejects(env.api.request(`/api/documents-download?id=${seed.ids.report}&version=0`),{code:'invalid_version',status:400});
  await assert.rejects(env.api.request(`/api/documents-download?id=${seed.ids.document}&version=1`),{code:'not_found',status:404});
  env.api.setScenario('ready');
  const first=shown(await link(1)),second=shown(await link(2));
  assert.match(first,/sample-crs-report-initial[\s\S]*Experian · 662/);assert.doesNotMatch(first,/sample-crs-report-updated/);
  assert.match(second,/sample-crs-report-updated[\s\S]*Experian · 712/);
  assert.equal(env.networkCalls(),0);
});

test('each sample letter carries its bureau\'s exact address; the address is checked only after the approval, and both are kept',async()=>{
  const env=open();env.api.setScenario('optimize');
  const letters=async(api=env.api)=>(await api.request('/api/blueprint/letter-mailing')).letters;
  const [first,second]=await letters();
  for(const letter of [first,second]){
    assert.deepEqual(normal(letter.to),normal(mailTo(letter.bureau)));assert.equal(letter.versionId,letter.currentVersionId);
    assert.deepEqual(normal(letter.approval),{approvedAt:null,addressCheckedAt:null},'no approval at first');
  }
  assert.deepEqual(normal([first.to.lines,second.to.lines]),[['Experian','P.O. Box 4500','Allen, TX 75013'],['TransUnion LLC Consumer Dispute Center','P.O. Box 2000','Chester, PA 19016']]);
  const step=(action,documentId)=>post(env.api,'/api/blueprint/letter-mailing',{action,documentId});
  const before=env.writes();
  await assert.rejects(step('check_address',first.documentId),{code:'approve_first',status:409});
  await assert.rejects(step('approve_letter',seed.ids.report),{code:'letter_unavailable',status:404});
  await assert.rejects(step('approve_letter','not-a-letter'),{code:'invalid_letter',status:400});
  assert.equal(env.writes(),before,'a refused step saves nothing');
  const approved=await step('approve_letter',first.documentId);
  assert.equal(approved.step,'approve');assert.equal(approved.documentId,first.documentId);assert.equal(approved.versionId,first.versionId);assert.deepEqual(normal(approved.to),normal(first.to));
  assert.ok(approved.approval.approvedAt);assert.equal(approved.approval.addressCheckedAt,null);
  assert.equal((await step('approve_letter',first.documentId)).approval.approvedAt,approved.approval.approvedAt,'a replay changes nothing');
  const checked=await step('check_address',first.documentId);
  assert.equal(checked.step,'address');assert.equal(checked.approval.approvedAt,approved.approval.approvedAt);assert.ok(checked.approval.addressCheckedAt);
  assert.deepEqual(normal((await letters())[1].approval),{approvedAt:null,addressCheckedAt:null},'the other letter keeps its own approval');
  const reloaded=open({store:env.store});assert.deepEqual(normal((await letters(reloaded.api))[0].approval),normal(checked.approval));
  const older=JSON.parse(env.store.get(KEY));older.schema=2;for(const letter of older.letters.letters){delete letter.to;delete letter.approval;}
  assert.equal(open({store:new Map([...env.store,[KEY,JSON.stringify(older)]])}).api.scenario,'start','an older saved sample without approvals starts fresh');
  assert.equal(env.networkCalls(),0);assert.equal(reloaded.networkCalls(),0);
});

test('the application guide shows while the client\'s own bank step is open: the plan income, the sample deposits, business unknown',async()=>{
  const env=open();env.api.setScenario('optimize');assert.equal((await env.api.request('/api/blueprint/funding')).guide,undefined);
  env.api.setScenario('ready');const funding=await env.api.request('/api/blueprint/funding');
  // Household is the real income finder on the sample's own deposits, read over loadIncome()'s window.
  const today=seed.money.asOf.updated,shift=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*864e5).toISOString().slice(0,10),from=shift(today,-WINDOW_DAYS);
  const account=Object.fromEntries(seed.money.accounts.map(a=>[a.key,a]));
  const rows=seed.money.transactions.rows.map(([i,key,cents,merchant],n)=>({provider_transaction_id:'t'+n,bank_account_id:account[key].id,amount_cents:cents,posted_on:moneyDayList[i],merchant_name:seed.money.merchants[merchant].name}))
    .filter(r=>r.amount_cents>0?r.posted_on>=from&&r.posted_on<=today:r.posted_on>=shift(from,-TRANSFER_MATCH_DAYS)&&r.posted_on<=shift(today,TRANSFER_MATCH_DAYS));
  const income=detectIncome(rows,{now:today,accounts:seed.money.accounts.map(a=>({id:a.id,type:a.type,kind:'personal'}))});
  assert.deepEqual(normal(funding.guide),normal(applicationGuide({income,plan:{monthlyIncomeCents:seed.plan.businessPlans.monthlyIncomeCents},businessCount:0})));
  const row=Object.fromEntries(funding.guide.rows.map(r=>[r.key,r]));
  assert.equal(funding.guide.rule,GUIDE_RULE);assert.equal(funding.guide.asOf,today);
  assert.deepEqual([row.personal.monthlyCents,row.personal.yearlyCents,row.personal.source],[750000,9000000,'plan'],'the plan\'s $7,500 a month, times 12 exactly');
  assert.equal(row.household.source,'bank');assert.ok(Number.isSafeInteger(row.household.monthlyCents));assert.equal(row.household.yearlyCents,row.household.monthlyCents*12);
  assert.ok(row.household.monthlyCents<seed.plan.businessPlans.monthlyIncomeCents,'the finder counts only the paydays every month has');
  assert.deepEqual([row.business.monthlyCents,row.business.yearlyCents,row.business.reason],[null,null,'not_on_file'],'no business account: unknown, never $0');
  const opened=await post(env.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender});
  await post(env.api,'/api/blueprint/funding',{action:'report_application',applicationId:opened.applicationId,status:'pending'});
  const waiting=await env.api.request('/api/blueprint/funding');assert.equal(waiting.state,'awaiting_response');assert.deepEqual(normal(waiting.guide),normal(funding.guide));
  env.api.setScenario('completed');assert.equal((await env.api.request('/api/blueprint/funding')).guide,undefined);
  assert.equal(env.networkCalls(),0);
});

test('the bureau call uses the number the Fundhub caller dials and goes away once the inquiries are verified removed',async()=>{
  const env=open();env.api.setScenario('optimize');
  let [c]=(await env.api.request('/api/blueprint/inquiries')).cases;
  assert.deepEqual(normal(c.selfCall),normal(inquiryCall({bureau:c.bureau,inquiries:c.inquiries,missing:[],name:'Alex Sample',dial:scriptDialPlan()})));
  assert.deepEqual([c.selfCall.name,c.selfCall.number,c.selfCall.display,c.selfCall.numberFrom],['Experian','+18554146048','(855) 414-6048','script']);
  assert.ok(c.selfCall.script.includes('Please check: Sample Community Bank inquiry.'));assert.doesNotMatch(JSON.stringify(c.selfCall),/fraud/i);
  await post(env.api,'/api/blueprint/inquiries',{action:'check_evidence',caseId:seed.ids.case});
  [c]=(await env.api.request('/api/blueprint/inquiries')).cases;assert.ok(c.selfCall,'still there while the removal waits for evidence');
  env.api.advance();[c]=(await env.api.request('/api/blueprint/inquiries')).cases;
  assert.equal(env.api.scenario,'ready');assert.equal(c.inquiries[0].state,'removed_verified');assert.equal(c.selfCall,null);
  assert.equal(env.networkCalls(),0);
});

// ── Banks near you (unit LOC) and the organized Alerts (unit AL2) ──────────────
const {samplePayloads:localBankSamples}=await import('../http/fixtures/local-banks.sample.mjs');
const {readCustomInput,customView}=await import('../finance/file-alerts/custom.mjs');
/* The real GET /api/money/alerts over this sample's rows (the generator's --alerts-json). */
const realAlerts=spec=>JSON.parse(execFileSync(process.execPath,['scripts/demo/build-blueprint-dashboard-data.mjs','--alerts-json',JSON.stringify(spec)],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,TZ:'UTC'},maxBuffer:64*1024*1024}).toString());
const liveCustom=env=>(JSON.parse(env.store.get(KEY)).moneyLocal?.custom||[]).filter(r=>!r.archived_at);
async function sameAsRealAlerts(env,day,why){
  const businesses=(await env.api.request('/api/blueprint/plan')).businessPlans.businesses.map(b=>({id:b.id,name:b.name}));
  const demo=normal(await env.api.request('/api/money/alerts')),real=realAlerts({day,businesses,custom:liveCustom(env)});
  assert.deepEqual(demo.board,real.board,why+': the board is the real one');
  assert.deepEqual(demo.custom,real.custom,why+': each added item is the real view');
  return demo;
}

test('the local banks view is the real local banks read for the stage day, and the plain Banks read is unchanged',async()=>{
  const env=open({pathname:'/app/financeos.html'});
  for(const [stage,key] of [['optimize','initial'],['ready','updated']]){
    env.api.setScenario(stage);
    const {sample,...view}=normal(await env.api.request('/api/money/banks?view=local_banks'));
    assert.equal(sample,true);
    assert.deepEqual(view,normal((await localBankSamples(seed.money.asOf[key])).full),stage);
    assert.equal(view.local_banks.window.from,seed.money.asOf[key]);
    assert.ok(view.local_banks.nearby.some(n=>n.name==='OneAZ'),'a brand keeps its own capitals');
    const plain=normal(await env.api.request('/api/money/banks'));
    assert.deepEqual(plain.recommended_banks.map(b=>b.name),['Chase','Bank of America']);assert.equal(plain.local_banks,undefined);
  }
  const res=await env.api.fetchResponse('/api/money/banks?view=local_banks');assert.equal(res.status,200);assert.equal((await res.json()).local_banks.status,'ready');
  assert.equal(env.networkCalls(),0);
});

test('the Alerts board is the real board: the sample\'s own payments, bills and smart alerts, and each business',async()=>{
  const env=open({pathname:'/app/financeos.html'});
  let alerts=normal(await env.api.request('/api/money/alerts'));
  assert.deepEqual(alerts.custom,[]);assert.deepEqual(alerts.board.scopes.map(s=>s.key),['personal'],'start: no business yet');
  assert.deepEqual(alerts.board,realAlerts({day:seed.money.asOf.initial}).board);
  env.api.setScenario('optimize');
  alerts=await sameAsRealAlerts(env,seed.money.asOf.initial,'optimize');
  assert.deepEqual(alerts.board.scopes.map(s=>s.name),['Personal','Cedar Grove LLC','Juniper Services LLC','Willow Studio LLC']);
  const personal=alerts.board.scopes[0];
  assert.deepEqual(personal.payments.map(p=>p.name),['Sample Auto Loan ending 5517','Sample Card B ending 7302','Sample Card A ending 1144']);
  assert.ok(personal.bills.some(b=>b.name==='Adobe Creative Cloud'&&b.amount_cents===5999),'the price on the next charge');
  assert.deepEqual(personal.smart.map(s=>s.kind).filter(k=>k!=='pay_by'),['charged_twice','price_up'],'the bill cleanup\'s own finds in the sample year');
  env.api.setScenario('ready');await sameAsRealAlerts(env,seed.money.asOf.updated,'ready');
  assert.equal(env.networkCalls(),0);
});

test('alerts and bills the client adds land on the board the way the real read puts them, and survive reload',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('optimize');
  const [cedar,juniper]=seed.plan.businessPlans.businesses;
  const add=body=>post(env.api,'/api/money/alerts',{action:'add_custom',...body});
  const savings=await add({kind:'alert',name:'Move money to savings',cadence:'monthly',day_of_month:14,scope:'personal'});
  assert.equal(savings.action,'add_custom');assert.match(savings.saved.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(normal(savings.saved),normal(customView(liveCustom(env).find(r=>r.id===savings.saved.id),{today:seed.money.asOf.initial})),'the answer is the real view of the saved row');
  const rent=await add({kind:'bill',name:'Office rent',amount_cents:120000,cadence:'monthly',day_of_month:1,scope:'business',entity_id:cedar.id,phone_alert:false});
  await add({kind:'alert',name:'Quarterly taxes',amount_cents:45000,cadence:'once',start_on:'2026-10-08',scope:'business'});
  await add({kind:'bill',name:'Payroll service',amount_cents:9900,cadence:'biweekly',start_on:'2026-09-25',scope:'business',entity_id:juniper.id.toUpperCase()});
  await add({kind:'bill',name:'Domain renewal',amount_cents:2000,cadence:'annual',start_on:'2025-10-20',scope:'personal'});
  let alerts=await sameAsRealAlerts(env,seed.money.asOf.initial,'four kinds of items');
  assert.ok(alerts.board.scopes.some(s=>s.key==='business'&&s.name==='Business'),'a business item with no company yet gets the loose pile');
  const changed=await post(env.api,'/api/money/alerts',{action:'update_custom',id:savings.saved.id,kind:'bill',name:'Move money to savings',amount_cents:50000,cadence:'monthly',day_of_month:2,scope:'business',entity_id:cedar.id});
  assert.equal(changed.saved.kind,'alert','a kind never changes');assert.equal(changed.saved.entity_id,cedar.id);assert.equal(changed.saved.next_on,'2026-11-02');
  const phone=await post(env.api,'/api/money/alerts',{action:'set_custom_phone',id:rent.saved.id,enabled:true});
  assert.deepEqual(normal(phone),{ok:true,action:'set_custom_phone',saved:{id:rent.saved.id,phone_alert:true},sample:true});
  const removed=await post(env.api,'/api/money/alerts',{action:'remove_custom',id:rent.saved.id.toUpperCase()});
  assert.deepEqual(normal(removed.saved),{id:rent.saved.id,removed:true});
  assert.ok(JSON.parse(env.store.get(KEY)).moneyLocal.custom.find(r=>r.id===rent.saved.id).archived_at,'removing sets archived_at; nothing is deleted');
  alerts=await sameAsRealAlerts(env,seed.money.asOf.initial,'after a change, a phone switch and a remove');
  assert.equal(alerts.custom.length,4);
  const reloaded=open({pathname:'/app/financeos.html',store:env.store});
  assert.deepEqual(normal(await reloaded.api.request('/api/money/alerts')).custom,alerts.custom,'saved items survive reload');
  /* No business on the file: a business item goes to the loose pile, as the real read puts it. */
  const fresh=open({pathname:'/app/financeos.html'});
  await post(fresh.api,'/api/money/alerts',{action:'add_custom',kind:'alert',name:'Check the mail',cadence:'monthly',day_of_month:9,scope:'business'});
  await sameAsRealAlerts(fresh,seed.money.asOf.initial,'start, with no business');
  env.api.reset();assert.deepEqual(normal(await env.api.request('/api/money/alerts')).custom,[],'reset brings the sample back');
  assert.equal(env.networkCalls(),0);assert.equal(reloaded.networkCalls(),0);assert.equal(fresh.networkCalls(),0);
});

test('the custom alert checks and words are the real ones, and a refused change saves nothing',async()=>{
  const env=open({pathname:'/app/financeos.html'});env.api.setScenario('optimize');
  const today=seed.money.asOf.initial,good={kind:'alert',name:'Pay the sitter',cadence:'monthly',day_of_month:5,scope:'personal'};
  const bad=[{...good,kind:'note'},{...good,name:''},{...good,name:'x'.repeat(81)},{...good,kind:'bill'},{...good,kind:'bill',amount_cents:0},{...good,amount_cents:12.5},
    {...good,amount_cents:100000000001},{...good,cadence:'weekly'},{...good,day_of_month:32},{...good,day_of_month:'3x'},{...good,cadence:'once',start_on:'2026-10-01'},
    {...good,cadence:'once',start_on:'2026-02-30'},{...good,cadence:'once',start_on:'2032-01-01'},{...good,kind:'bill',amount_cents:100,cadence:'weekly',start_on:'2015-01-01'},
    {...good,scope:'family'},{...good,entity_id:seed.plan.businessPlans.businesses[0].id},{...good,scope:'business',entity_id:'not-a-uuid'},{...good,phone_alert:'yes'}];
  const before=env.writes();
  for(const body of bad){
    let real=null;try{readCustomInput(body,{today});}catch(e){real=e;}
    assert.ok(real,JSON.stringify(body));
    await assert.rejects(post(env.api,'/api/money/alerts',{action:'add_custom',...body}),{status:real.status,code:'invalid_input',field:real.field,message:real.message},JSON.stringify(body));
  }
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'add_custom',...good,scope:'business',entity_id:'d0000000-0000-4000-8000-0000000000ff'}),{status:404,field:'entity_id',message:'no such business'});
  assert.equal(env.writes(),before,'a refused add saves nothing');
  const res=await env.api.fetchResponse('/api/money/alerts',{method:'POST',body:JSON.stringify({action:'add_custom',...good,name:' '})});
  assert.equal(res.status,400);assert.deepEqual(await res.json(),{ok:false,error:'invalid_input',field:'name',message:'name is required',sample:true});
  for(const action of ['update_custom','set_custom_phone','remove_custom'])
    await assert.rejects(post(env.api,'/api/money/alerts',{action,id:'not-a-uuid',enabled:true}),{status:400,field:'id',message:'id is required and must be a uuid'},action);
  const missing=webcrypto.randomUUID();
  for(const action of ['update_custom','set_custom_phone','remove_custom'])
    await assert.rejects(post(env.api,'/api/money/alerts',{...good,action,id:missing,enabled:true}),{status:404,field:'id',message:'no such alert or bill'},action);
  const saved=(await post(env.api,'/api/money/alerts',{action:'add_custom',...good})).saved;
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'set_custom_phone',id:saved.id,enabled:'off'}),{status:400,field:'enabled',message:'enabled must be true or false'});
  await post(env.api,'/api/money/alerts',{action:'remove_custom',id:saved.id});
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'remove_custom',id:saved.id}),{status:404,field:'id'},'a removed item is gone for every action');
  for(let i=1;i<=100;i++)await post(env.api,'/api/money/alerts',{action:'add_custom',...good,name:'Item '+i});
  await assert.rejects(post(env.api,'/api/money/alerts',{action:'add_custom',...good,name:'Item 101'}),{status:400,field:'kind',message:'you can keep up to 100 alerts and bills; remove one first'});
  assert.equal(normal(await env.api.request('/api/money/alerts')).custom.length,100);
  assert.equal(env.networkCalls(),0);
});

// ── What you have (unit TL) and the fundability ring (unit PREM) ──────────────
/* The real GET /api/money/accounts?view=tradelines over this sample's rows (the generator's --tradelines-json). */
const realTradelines=spec=>JSON.parse(execFileSync(process.execPath,['scripts/demo/build-blueprint-dashboard-data.mjs','--tradelines-json',JSON.stringify(spec)],{cwd:root,stdio:['ignore','pipe','pipe'],env:{...process.env,TZ:'UTC'},maxBuffer:64*1024*1024}).toString());

test('What you have is the real read over Alex Sample\'s own accounts and pulls, with each business the demo has',async()=>{
  const env=open({pathname:'/app/financeos.html'});
  const view=async()=>{const {ok,sample,...rest}=normal(await env.api.request('/api/money/accounts?view=tradelines'));assert.equal(ok,true);assert.equal(sample,true);return rest;};
  const businesses=async()=>(await env.api.request('/api/blueprint/plan')).businessPlans.businesses.map(b=>({id:b.id,name:b.name}));
  let v=await view();
  assert.deepEqual(v,realTradelines({pull:'none',businesses:[]}),'start: no pull, no business');
  assert.deepEqual(v.groups[0].items.map(i=>[i.name,i.source_words]),[['Sample Everyday Checking',['Added by you']],['Sample High-Yield Savings',['Added by you']],
    ['Sample Card A',['Added by you']],['Sample Card B',['Added by you']],['Sample Auto Loan',['Added by you']]],'no pull yet: the accounts Alex typed in');
  env.api.setScenario('optimize');v=await view();
  assert.deepEqual(v,realTradelines({pull:'initial',businesses:await businesses()}));
  assert.deepEqual(v.groups.map(g=>g.name),['Personal','Cedar Grove LLC','Willow Studio LLC','Juniper Services LLC']);
  assert.deepEqual(v.groups[0].items.map(i=>[i.name,i.source_words]),[['Sample Card A',['Report','Added by you']],['Sample Card B',['Report','Added by you']],
    ['Sample Auto Loan',['Report','Added by you']],['Sample Everyday Checking',['Added by you']],['Sample High-Yield Savings',['Added by you']]],
    'one person: each account once, the report line and the bank account joined');
  assert.deepEqual(v.add.belongs_to.map(o=>o.label),['Personal','Cedar Grove LLC','Willow Studio LLC','Juniper Services LLC']);
  assert.deepEqual(v.relationships,[],'no bank on Fundhub\'s list holds a sample account');
  env.api.setScenario('ready');
  assert.deepEqual(await view(),realTradelines({pull:'updated',businesses:await businesses()}));
  assert.equal(normal(await env.api.request('/api/money/accounts')).view,undefined,'the plain Accounts read is unchanged');
  assert.equal(env.networkCalls(),0);
});

test('the fundability ring is the real read\'s six checks on the stage\'s pulls, and the Blueprint path says the same',async()=>{
  const env=open({pathname:'/app/financeos.html'});
  let fund=normal(await env.api.request('/api/money/fundability'));
  assert.deepEqual([fund.now.score,fund.now.tier,fund.now.factors],[null,null,[]],'no pull yet: not measured');
  for(const [stage,key] of [['optimize','initial'],['ready','updated']]){
    env.api.setScenario(stage);fund=normal(await env.api.request('/api/money/fundability'));
    const f=seed.fundability[key];
    assert.deepEqual([fund.now.score,fund.now.score_max,fund.now.unknown,fund.now.tier],[f.score,f.score_max,f.unknown,f.tier],stage);
    assert.deepEqual(fund.now.factors,f.factors);
    assert.equal(fund.now.score,f.factors.filter(c=>c.passed===true).length,'the score is the count of checks the file passed');
    assert.equal(fund.now.unknown,f.factors.filter(c=>c.passed===null).length);
    assert.equal(fund.now.funding_estimate_cents,fund.opportunity.personal.currentCents,'the dollar figure is the engine\'s funding opportunity');
    const path=(await env.api.request('/api/blueprint/plan')).path;
    assert.deepEqual([path.fundability.score,path.fundability.max],[fund.now.score,fund.now.score_max],'the Blueprint path shows the same ring');
  }
  assert.deepEqual([seed.fundability.initial.score,seed.fundability.initial.tier,seed.fundability.updated.score,seed.fundability.updated.tier],[3,'not_fundable',5,'fundable']);
  assert.equal(env.networkCalls(),0);
});
