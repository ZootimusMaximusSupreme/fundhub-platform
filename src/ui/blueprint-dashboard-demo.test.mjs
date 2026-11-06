import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root=fileURLToPath(new URL('../../',import.meta.url));
const source=readFileSync(root+'public/app/blueprint-demo.js','utf8');
const seed=JSON.parse(readFileSync(root+'public/app/blueprint-demo-data.json','utf8'));
const KEY='fh_blueprint_full_demo_v1';
function open({search='?demo=1&blueprint=full',pathname='/app/client-portal.html',store=new Map([['fh_token','existing-real-session'],['unrelated','preserve-me']])}={}){
  let calls=0,writes=0;const listeners=new Map(),documentListeners=new Map();const events=[],nodes=[];
  const localStorage={getItem:key=>store.has(key)?store.get(key):null,setItem:(key,value)=>{writes++;store.set(key,String(value));},removeItem:key=>store.delete(key)};
  const window={addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>events.push(event.type),opener:null};
  const document={readyState:'loading',addEventListener:(name,fn)=>documentListeners.set(name,fn),dispatchEvent:event=>events.push(event.type),body:{replaceChildren:()=>{}},createElement:tag=>{const node={tag,textContent:'',children:[],listeners:new Map(),append(...children){this.children.push(...children);},setAttribute(){},addEventListener(name,fn){this.listeners.set(name,fn);}};nodes.push(node);return node;}};
  const context=vm.createContext({window,document,localStorage,location:{origin:'https://fundhub.ai',pathname,search},URL,URLSearchParams,FormData,Event,crypto:webcrypto,fetch:()=>{calls++;throw Error('A demo made a forbidden request');}});
  vm.runInContext(source,context);
  return{api:window.FHBlueprintDemo,store,context,listeners,events,nodes,renderPreview:()=>documentListeners.get('DOMContentLoaded')?.(),writes:()=>writes,networkCalls:()=>calls};
}
const post=(api,path,body)=>api.request(path,{method:'POST',body:JSON.stringify(body)});
const normal=value=>JSON.parse(JSON.stringify(value));

test('the adapter requires the full explicit route and never creates a session',()=>{
  for(const opts of [{search:'?demo=1'},{search:'?blueprint=full'},{pathname:'/app/financeos.html'}])assert.equal(open(opts).api,undefined);
  const env=open();assert.ok(Object.isFrozen(env.api));assert.equal(env.store.get('fh_token'),'existing-real-session');assert.equal(env.store.get('unrelated'),'preserve-me');assert.equal(env.networkCalls(),0);
});

test('fictional package and banks have the full $30,000 scope without reading private sources',async()=>{
  const env=open();const funding=await env.api.request('/api/blueprint/funding');
  assert.equal(funding.engagement.priceCents,3000000);assert.equal(funding.engagement.productKey,'blueprint-self-funding');
  assert.equal(funding.lenders[0].name,'Sample Community Bank');assert.equal(funding.applications[0].lenderName,'Sample Neighborhood Bank');
  assert.equal(env.networkCalls(),0);assert.equal(env.store.get('fh_token'),'existing-real-session');
});

test('unknown transports, actions, foreign documents and changed sessions fail closed',async()=>{
  const env=open();
  await assert.rejects(env.api.request('/api/money/accounts'),{code:'demo_route_unavailable'});
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
  const stored=env.store.get(KEY);assert.ok(!stored.includes('PRIVATE FILE CONTENT'));const plan=await env.api.request('/api/blueprint/plan');assert.equal(plan.letterResponses[0].validationStatus,'pending');assert.equal(env.networkCalls(),0);
});

test('sample inquiry submissions, authorized calls and staged evidence stay distinct',async()=>{
  const env=open();const form=new FormData();form.append('kind','inquiry_doc');form.append('files',new Blob(['demo']), 'sample-receipt.pdf');const uploaded=await env.api.request('/api/documents-upload',{method:'POST',body:form});
  await post(env.api,'/api/blueprint/inquiries',{action:'record_submission',caseId:seed.ids.case,reference:'SAMPLE-42',receiptDocumentId:uploaded.documents[0].id});
  await assert.rejects(post(env.api,'/api/blueprint/inquiries',{action:'launch_call',caseId:seed.ids.case}));
  await post(env.api,'/api/blueprint/inquiries',{action:'launch_call',caseId:seed.ids.case,authorization:true});
  await post(env.api,'/api/blueprint/inquiries',{action:'check_evidence',caseId:seed.ids.case});
  let cases=(await env.api.request('/api/blueprint/inquiries')).cases;assert.equal(cases[0].submissionReference,'SAMPLE-42');assert.equal(cases[0].call.status,'simulated — no call placed');assert.equal(cases[0].inquiries[0].state,'pending_verification');
  env.api.advance();cases=(await env.api.request('/api/blueprint/inquiries')).cases;assert.equal(cases[0].inquiries[0].state,'removed_verified');assert.equal(env.api.scenario,'ready');assert.equal(env.networkCalls(),0);
});

test('fictional lender preview and user report do not establish actual approval or funding',async()=>{
  const env=open();await assert.rejects(post(env.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender}));
  env.api.setScenario('ready');const result=await post(env.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender});const url=new URL(result.url);assert.equal(url.origin,'https://fundhub.ai');assert.equal(url.searchParams.get('preview'),'bank');
  await post(env.api,'/api/blueprint/funding',{action:'report_application',applicationId:result.applicationId,status:'approved',approvedAmount:12000});
  const app=(await env.api.request('/api/blueprint/funding')).applications.find(a=>a.id===result.applicationId);assert.equal(app.outcomeVerified,false);assert.equal(app.approvedAmount,undefined);assert.equal(app.reportedApprovalAmount,12000);assert.equal(env.networkCalls(),0);
});

test('sample services retain exact quote authorization and use a local payment preview',async()=>{
  const env=open();await assert.rejects(post(env.api,'/api/blueprint/services',{action:'checkout',requestId:'sample-help-quote',authorization:true,expectedPriceCents:1,provider:'whop'}));
  const reply=await post(env.api,'/api/blueprint/services',{action:'checkout',requestId:'sample-help-quote',authorization:true,expectedPriceCents:50000,provider:'whop'});
  const url=new URL(reply.request.checkoutUrl);assert.equal(url.searchParams.get('preview'),'payment');assert.equal(url.origin,'https://fundhub.ai');assert.equal(reply.request.status,'awaiting_payment');assert.equal(env.networkCalls(),0);
});

test('own-namespace storage refreshes sample state without adopting other local keys',async()=>{
  const env=open();const external=open({store:env.store});external.api.setScenario('ready');
  env.listeners.get('storage')({key:'fh_token'});assert.equal(env.api.scenario,'optimize');
  env.listeners.get('storage')({key:KEY});assert.equal(env.api.scenario,'ready');assert.ok(env.events.includes('fh:blueprint-demo-change'));
  env.store.set(KEY,JSON.stringify({schema:1,ids:{client:seed.ids.client},scenario:'ready'}));env.listeners.get('storage')({key:KEY});assert.equal((await env.api.request('/api/blueprint/funding')).engagement.id,seed.ids.engagement);
});

test('completed sample history refuses active funding/report/repair mutations and reset touches only its namespace',async()=>{
  const env=open();env.api.setScenario('completed');
  for(const [path,body]of[['funding',{action:'open_lender',lenderId:seed.ids.lender}],['repair',{action:'generate'}],['services',{action:'request_report'}]])await assert.rejects(post(env.api,'/api/blueprint/'+path,body));
  env.api.reset();assert.equal(env.api.scenario,'optimize');assert.equal(env.store.get('fh_token'),'existing-real-session');assert.equal(env.store.get('unrelated'),'preserve-me');assert.equal((await env.api.request('/api/blueprint/plan')).businessPlans.businesses.length,3);assert.equal(env.networkCalls(),0);
});

test('direct or stale bank/payment previews cannot mutate completed history or unknown/unaccepted orders',async()=>{
  const owner=open();const accepted=await post(owner.api,'/api/blueprint/services',{action:'checkout',requestId:'sample-help-quote',authorization:true,expectedPriceCents:50000,provider:'whop'});const stalePaymentUrl=accepted.request.checkoutUrl;owner.api.setScenario('completed');
  assert.equal((await owner.api.request('/api/blueprint/services')).requests[0].status,'cancelled');
  for(const[kind,item,label]of[['bank','unknown-application','Submit sample application'],['bank','sample-previous-application','Submit sample application'],['payment','sample-help-quote','Record sample payment']]){
    const preview=open({store:owner.store,search:`?demo=1&blueprint=full&preview=${kind}&item=${item}`});const before=owner.store.get(KEY);preview.renderPreview();preview.nodes.find(n=>n.textContent===label).listeners.get('click')();
    assert.equal(owner.store.get(KEY),before);assert.equal(preview.writes(),0);assert.equal(preview.networkCalls(),0);assert.ok(preview.nodes.some(n=>/complete.*read-only/.test(n.textContent)));
  }
  const stale=open({store:owner.store,search:new URL(stalePaymentUrl).search});const completedBefore=owner.store.get(KEY);stale.renderPreview();stale.nodes.find(n=>n.textContent==='Record sample payment').listeners.get('click')();assert.equal(owner.store.get(KEY),completedBefore);assert.equal(stale.writes(),0);assert.equal(stale.networkCalls(),0);
  owner.api.reset();
  for(const[kind,item,label]of[['bank','unknown-application','Submit sample application'],['payment','sample-help-quote','Record sample payment']]){
    const preview=open({store:owner.store,search:`?demo=1&blueprint=full&preview=${kind}&item=${item}`});const before=owner.store.get(KEY);preview.renderPreview();preview.nodes.find(n=>n.textContent===label).listeners.get('click')();assert.equal(owner.store.get(KEY),before);assert.equal(preview.writes(),0);assert.equal(preview.networkCalls(),0);
  }
});

test('eligible local previews mutate once and stale/replayed preview actions cannot repeat a saved effect',async()=>{
  const owner=open();owner.api.setScenario('ready');const bank=await post(owner.api,'/api/blueprint/funding',{action:'open_lender',lenderId:seed.ids.lender});
  const preview=open({store:owner.store,search:new URL(bank.url).search});preview.renderPreview();const submit=preview.nodes.find(n=>n.textContent==='Submit sample application');submit.listeners.get('click')();assert.equal(preview.writes(),1);submit.listeners.get('click')();assert.equal(preview.writes(),1);
  const quote=await post(owner.api,'/api/blueprint/services',{action:'checkout',requestId:'sample-help-quote',authorization:true,expectedPriceCents:50000,provider:'whop'});
  const payment=open({store:owner.store,search:new URL(quote.request.checkoutUrl).search});payment.renderPreview();const record=payment.nodes.find(n=>n.textContent==='Record sample payment');record.listeners.get('click')();assert.equal(payment.writes(),1);record.listeners.get('click')();assert.equal(payment.writes(),1);assert.equal(payment.networkCalls(),0);
});

test('generated fictional seed and embedded pure helpers reproduce from current canonical source',()=>{
  assert.equal(seed.plan.lessons.length,17);assert.equal(seed.funding.engagement.priceCents,3000000);
  execFileSync(process.execPath,['scripts/demo/build-blueprint-dashboard-data.mjs','--check'],{cwd:root,stdio:'pipe'});
  assert.equal(normal(seed.plan.payoffCalculation).allocatedCents,70000);
});
