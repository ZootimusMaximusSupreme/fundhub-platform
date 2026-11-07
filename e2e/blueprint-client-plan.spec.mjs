import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { preparationGuidance, websitePrompt } from '../src/blueprint/preparation-guidance.mjs';
import { buildBlueprintClientPlan } from '../src/blueprint/client-plan.mjs';
import { readBlueprintLetterReadiness } from '../src/blueprint/letter-mailing.mjs';
const CLIENT='20000000-0000-4000-8000-000000000002';
const ORG='10000000-0000-4000-8000-000000000001';
const PLAN='40000000-0000-4000-8000-000000000004';
const SECOND_PLAN='60000000-0000-4000-8000-000000000006';
const DOCUMENT='50000000-0000-4000-8000-000000000005';
const EXISTING_BUSINESS='70000000-0000-4000-8000-000000000007';
const ENTITY='80000000-0000-4000-8000-000000000008';
const ORDER='d0000000-0000-4000-8000-00000000000d';
const RESPONSE_VERSION='e0000000-0000-4000-8000-00000000000e';
const ACCOUNT='90000000-0000-4000-8000-000000000009';
const OTHER_CLIENT='a0000000-0000-4000-8000-00000000000a';
const OTHER_ACCOUNT='b0000000-0000-4000-8000-00000000000b';
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
function initial(started=false){return{orgId:ORG,clientId:CLIENT,targetBusinessCount:3,setupStep:0,startedAt:started?'2026-11-02T12:00:00Z':null,hasExistingBusiness:null,homeState:started?'AZ':null,postalCode:started?'85004':null,availableCashCents:null,monthlyIncomeCents:null,cashBufferCents:null,oneTimePayoffCents:null,payoffPlan:null,availableEvidence:[],businesses:[],existingBusinesses:[],stepProgress:[],businessPreparation:{}};}
function record(){return{id:PLAN,name:'Cedar Grove LLC',activity:'Web design for local shops',formationState:'AZ',formationStatus:'planned',formationDate:null,ownershipSince:null,operatingSince:null,evidence:{formation:{status:'not_added'},ein:{status:'not_added'}},bankPreparation:{documentsReady:false,accountOpeningIssue:false,relationships:[]}};}
async function open(page,{started=false,business=false,denied=false,malformedPlan=false,failSave=false,failSaveOnce=false,failUpload=false,failAttachOnce=false,seed={},nativeProgress=null,bankPlan=null,mailing=null,responseRows=[],letterFiles=[],clientName='Pat',planAccess=null,portalSummary={},entitlementRows=[],authControl=null,requestGates={}}={}){
  const state={...initial(started),...structuredClone(seed)};if(business&&!state.businesses.length)state.businesses=[record()];
  const requests=[],downloads=[],uploadFields=[],mailRequests=[],bureauUploads=[],httpRequests=[];const downloadState={missing:false};
  const responseDocuments=structuredClone(responseRows),mailingData=structuredClone(mailing||{letters:[],orders:[],capabilities:{mailSupported:false,reason:'offline_provider_unavailable'}});
  let uploads=0,saveFailed=false,attachFailed=false,mailQuoteVersion=0;
  const savedProgress=nativeProgress||{waypoints:[{id:'w1',title:'Review the balances on your file',detail:'Compare each reported balance with your own records.',state:'not_started',owner:'client'}],nextStep:{waypointId:'w1',owner:'client'}};
  // Offline sources feed the actual aggregator, including cash reservations and
  // the real monthly payment calculator. No duplicate financial arithmetic here.
  async function payload(){
    const db={query:async sql=>{
      if(/FROM clients/.test(sql))return{rows:[{id:CLIENT,org_id:ORG,first_name:clientName,last_name:clientName?'Buyer':null,custom_fields:{}}]};
      if(/FROM crs_results/.test(sql))return{rows:[]};
      if(/FROM documents/.test(sql))return{rows:structuredClone(responseDocuments)};
      throw new Error('Unexpected browser-fixture query');
    }};
    return buildBlueprintClientPlan(db,{orgId:ORG,clientId:CLIENT,now:new Date('2026-11-02T20:00:00Z')},{
      readBusinessPlans:async()=>structuredClone(state),readClientProgress:async()=>structuredClone(savedProgress),
      bankStrategy:async()=>bankPlan?{ok:true,client:{id:CLIENT},...structuredClone(bankPlan)}:null,
      readBlueprintLetterReadiness:(db,scope)=>readBlueprintLetterReadiness(db,scope,{repo:{
        letters:async()=>structuredClone(letterFiles),orders:async()=>mailingData.orders.map(o=>({...o,state:o.status}))}}),
      preparationGuidance,websitePrompt,
      rankLocalCreditUnions:async()=>({status:'candidates_for_review',source:{name:'Offline official-directory fixture',asOf:'2026-06'},candidates:[]})
    });
  }
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    const request=route.request(),isJson=(request.headers()['content-type']||'').includes('application/json');
    const action=isJson&&method!=='GET'?request.postDataJSON()?.action:null;
    httpRequests.push({path,method,action,authorization:request.headers().authorization||null});
    const gate=requestGates[`${method} ${path}${action?':'+action:''}`]||requestGates[`${method} ${path}`];
    if(gate)await gate.wait();
    try{return await(async()=>{
    if(path==='/api/auth/session'){
      if(authControl?.signedOut)return json(route,{ok:false,error:'unauthorized'},401);
      if(authControl&&Object.hasOwn(authControl,'session'))return json(route,structuredClone(authControl.session));
      return json(route,{ok:true,principal:'client',staff:{id:authControl?.accountId||ACCOUNT,org_id:ORG,client_id:authControl?.clientId||CLIENT,role:'client',principal_kind:'client',name:'Pat Buyer',status:'active'}});
    }
    if(path==='/api/dashboard/client'&&authControl?.portalClientId)return json(route,{ok:true,client:{id:CLIENT,org_id:ORG,first_name:'Pat',last_name:'Buyer'},transactions:[],messages:[],tasks:[],crs_results:[],latest_booking:null});
    if(path==='/api/blueprint/plan'){if(planAccess?.wait)await planAccess.wait;return (planAccess?.denied??denied)?json(route,{ok:false,error:planAccess?.error||'blueprint_access_inactive'},planAccess?.status||403):json(route,malformedPlan?{ok:true,items:[]}:await payload());}
    if(path==='/api/blueprint/letter-mailing'){
      if(method==='GET')return json(route,{ok:true,...structuredClone(mailingData)});
      const body=route.request().postDataJSON();mailRequests.push(body);
      if(body.action==='quote')return json(route,{ok:true,orderId:ORDER,quoteVersion:++mailQuoteVersion,totalCents:9700,currency:'USD',
        items:mailingData.letters.filter(l=>body.documentIds.includes(l.documentId)),
        paymentOptions:[{id:'offline-card',label:'Saved card fixture',kind:'saved_card'},{id:'offline-checkout',label:'Secure checkout fixture',kind:'hosted_checkout'}],
        returnAddressSummary:{name:'Pat Buyer',line1:'1 Offline Fixture Way',city:'Phoenix',state:'AZ',postalCode:'85004'}});
      if(body.action==='confirm'){
        expect(body.authorization).toBe(true);expect(body.idempotencyKey).toBe(ORDER);
        const order={id:ORDER,status:'payment_pending',totalCents:9700,checkoutUrl:'https://offline-checkout.example/order/'+ORDER,envelopes:[]};
        mailingData.orders=[order];return json(route,{ok:true,order:structuredClone(order)});
      }
      if(body.action==='status')return json(route,{ok:true,order:structuredClone(mailingData.orders.find(o=>o.id===body.orderId))});
      throw new Error('Unexpected offline mailing action');
    }
    if(path==='/api/blueprint/business-plans'&&method==='POST'){
      const body=route.request().postDataJSON();requests.push(body);
      if(failSave||(failSaveOnce&&!saveFailed)){saveFailed=true;return json(route,{ok:false,message:'The saved plan is temporarily unavailable.'},500);}
      if(body.action==='save_settings'){
        const{action,started,...fields}=body;Object.assign(state,fields);if(started)state.startedAt='2026-11-02T12:00:00Z';
        if('hasExistingBusiness'in fields)state.setupStep=Math.max(state.setupStep||0,1);
        if('targetBusinessCount'in fields)state.setupStep=Math.max(state.setupStep||0,2);
        if(started)state.setupStep=3;
      }
      if(body.action==='save_business'){
        const existing=state.businesses.find(b=>b.id===body.business.id);
        if(existing){const banks={...existing.bankPreparation,...body.business.bankPreparation};Object.assign(existing,body.business);existing.bankPreparation=banks;}
        else state.businesses.push({...record(),...body.business});
      }
      if(body.action==='save_payoff_plan'){const{action,...plan}=body;state.payoffPlan=structuredClone(plan);}
      if(body.action==='save_step'){const{action,...step}=body;state.stepProgress=state.stepProgress.filter(p=>p.stepKey!==step.stepKey||(p.businessPlanId||null)!==(step.businessPlanId||null));state.stepProgress.push(step);}
      if(body.action==='attach_evidence'){
        if(failAttachOnce&&!attachFailed){attachFailed=true;return json(route,{ok:false,message:'The attachment service is temporarily unavailable.'},500);}
        state.businesses.find(b=>b.id===body.businessId).evidence[body.kind]={documentId:body.documentId,status:'evidence_received'};
        state.availableEvidence=state.availableEvidence.filter(d=>d.documentId!==body.documentId);
      }
      return json(route,{ok:true,...structuredClone(state)});
    }
    if(path==='/api/documents-upload'){
      expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');uploads++;
      const form=await new Request('http://offline-fixture.invalid',{method:'POST',headers:route.request().headers(),body:route.request().postDataBuffer()}).formData();
      uploadFields.push({kind:form.get('kind'),subtype:form.get('subtype'),entityId:form.get('entity_id'),filename:form.get('files')?.name});
      if(!failUpload&&form.get('kind')==='bureau_response'){
        bureauUploads.push({kind:form.get('kind'),subtype:form.get('subtype'),filenames:form.getAll('files').map(f=>f.name)});
        responseDocuments.push({id:DOCUMENT,current_version_id:RESPONSE_VERSION,title:form.get('files').name,generated_at:'2026-11-02T20:00:00Z',metadata:{}});
      }else if(!failUpload)state.availableEvidence.push({documentId:DOCUMENT,kind:form.get('subtype')==='ein_letter'?'ein':'formation',filename:form.get('files').name,receivedAt:'2026-11-02T20:00:00Z',entityId:form.get('entity_id')});
      return failUpload?json(route,{ok:false,message:'The file could not be stored.'},500):json(route,{ok:true,documents:[{id:DOCUMENT}]});
    }
    if(path==='/api/documents-download'){
      downloads.push({id:url.searchParams.get('id'),authorization:route.request().headers().authorization});
      return json(route,{ok:true,document:{id:url.searchParams.get('id'),download:downloadState.missing?null:'/api/documents/'+url.searchParams.get('id')+'?exp=2000000000&sig=offline-fixture-signature'}});
    }
    if(path==='/api/chat/portal-message'&&method==='POST'){requests.push({chat:route.request().postDataJSON()});return json(route,{ok:true,message:{id:'message-browser-contract'}});}
    if(path.includes('portal-summary'))return json(route,{ok:true,documents:[],scores:{},soft_pull_complete:false,dispute_consent:{allowed:false},stage:{key:'paid'},upcoming_call:null,...portalSummary});
    if(path.includes('read/entitlements'))return json(route,{ok:true,items:entitlementRows});
    return json(route,{ok:true,items:[],rows:[],documents:[],payments:[]});
    })();}finally{gate?.finish();}
  });
  // The portal welcome chat can open while a long form is in use. Close that
  // separate surface through its actual control; never force covered clicks.
  await page.addLocatorHandler(page.locator('#fh-chat-panel.open'),async()=>{await page.locator('#fh-chat-close').click();});
  if(authControl)await page.addInitScript(token=>{if(token===null)localStorage.removeItem('fh_token');else localStorage.setItem('fh_token',token);},authControl.token);
  else await page.addInitScript(()=>{if(!localStorage.getItem('fh_token'))localStorage.setItem('fh_token','offline-same-client');});
  await page.goto('/app/client-portal.html'+(authControl?.portalClientId?'?id='+encodeURIComponent(authControl.portalClientId):''));
  const app=page.locator('#blueprint-plan');if(!denied&&authControl?.token!==null&&authControl?.token!=='demo')await expect(app).toBeVisible();
  return{app,state,requests,downloads,downloadState,uploadFields,mailRequests,mailingData,responseDocuments,bureauUploads,httpRequests,wasUploaded:()=>uploads>0,uploadCount:()=>uploads};
}

test('paid buyer starts one question at a time and server state survives reload',async({page})=>{
  const{app,state,requests}=await open(page);await app.locator('.bj-next').getByRole('button',{name:'Start my plan',exact:true}).click();await expect(app.getByText('Do you already own a business?',{exact:true})).toBeVisible();
  await app.getByText('No, I’m preparing my first business',{exact:true}).click();await app.getByRole('button',{name:'Save and continue'}).click();await expect(app.getByText('How many businesses are we preparing?',{exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Save and continue'}).click();await app.locator('select[name=homeState]').selectOption('AZ');await app.locator('input[name=postalCode]').fill('85004');await app.getByRole('button',{name:'Build my plan',exact:true}).click();
  await expect(app.locator('.bj-next').getByText('Review the balances on your file',{exact:true})).toBeVisible();expect(state.startedAt).toBeTruthy();expect(requests.every(r=>!('client_id'in r)&&!('org_id'in r))).toBeTruthy();
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('fundhub-blueprint'))localStorage.removeItem(key);});await page.reload();await expect(app.locator('.bj-next').getByText('Review the balances on your file',{exact:true})).toBeVisible();
});
test('nonbuyer gets no paid plan controls',async({page})=>{const{app}=await open(page,{denied:true});await expect(app).toBeHidden();});

test('known inactive Blueprint access preserves the independent FinanceOS entry',async({page})=>{
  const{app}=await open(page,{denied:true});
  await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','inactive');
  await expect(page.locator('body')).not.toHaveAttribute('data-blueprint-plan');
  await expect(app).toBeHidden();
  await expect(page.locator('#money-link')).toBeVisible();
  await expect(page.locator('#money-link')).toHaveAttribute('href','/app/financeos.html');
});

for(const denial of [{status:401,error:'unauthorized'},{status:403,error:'forbidden'},{status:404,error:'client_not_found'}]){
  test(`Blueprint ${denial.status} ${denial.error} keeps FinanceOS access unavailable`,async({page})=>{
    const{app,httpRequests}=await open(page,{denied:true,planAccess:denial});
    await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','unavailable');
    await expect(app).toBeHidden();
    await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
    expect(httpRequests.some(r=>r.path==='/api/blueprint/plan')).toBe(true);
  });
}

test('pending Blueprint access hides FinanceOS until known inactive access resolves',async({page})=>{
  let release;const held=new Promise(resolve=>{release=resolve;});
  try{
    await open(page,{denied:true,planAccess:{wait:held}});
    await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','loading');
    await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
    release();
    await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','inactive');
    await expect(page.locator('#money-link')).toBeVisible();
  }finally{release();}
});

function staffAuth(role='owner',legacy=false){return{token:'offline-staff-principal',portalClientId:CLIENT,session:{ok:true,...(legacy?{}:{principal:'staff'}),staff:{id:ACCOUNT,org_id:ORG,role,name:'Offline Staff',status:'active'}}};}
// A signed-out session sends the page to /portal-login.html. On a slow runner
// that navigation can replace the document while this read is still running,
// which Playwright reports as a destroyed execution context. Only that one
// error is read again; every other error still fails, and the final state must
// still be unavailable or signed out.
function blueprintAccessState(page){
  return page.evaluate(()=>location.pathname==='/portal-login.html'?'signed_out':document.body.dataset.blueprintAccess)
    .catch(error=>{if(/Execution context was destroyed/.test(String(error?.message)))return 'navigating';throw error;});
}
for(const [role,legacy]of[['owner',false],['admin',false],['sales_manager',false],['closer',false],['owner',true]]){
  const staffHome={admin:'pipeline.html',sales_manager:'sales-floor.html',closer:'closer-dashboard.html'}[role];
  test(`known FinanceOS staff ${role}${legacy?' legacy projection':''} ${staffHome?'keeps its canonical staff redirect':'retains its independent entry'} without a Blueprint principal`,async({page})=>{
    const{app,httpRequests,requests}=await open(page,{denied:true,authControl:staffAuth(role,legacy)});
    if(staffHome){
      await expect.poll(()=>new URL(page.url()).pathname).toBe('/app/'+staffHome);
      await expect(app).toHaveCount(0);
    }else{
      await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','inactive');
      await expect(page.locator('body')).not.toHaveAttribute('data-blueprint-plan');
      await expect(app).toBeHidden();await expect(app).toBeEmpty();
      await expect(page.locator('#money-link')).toBeVisible();
      await expect(page.locator('#money-link')).toHaveAttribute('href','/app/financeos.html?client_id='+CLIENT);
    }
    expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);expect(requests).toHaveLength(0);
  });
}

for(const [label,session,staffHome]of[
  ['disallowed role',{ok:true,principal:'staff',staff:{id:ACCOUNT,org_id:ORG,role:'funding_advisor'}},'client-control-panel.html'],
  ['missing staff ID',{ok:true,principal:'staff',staff:{org_id:ORG,role:'owner'}}],
  ['missing staff org',{ok:true,principal:'staff',staff:{id:ACCOUNT,role:'owner'}}],
  ['unknown principal',{ok:true,principal:'unknown',staff:{id:ACCOUNT,org_id:ORG,role:'owner'}}],
  ['malformed client',{ok:true,principal:'client',staff:{id:ACCOUNT,org_id:ORG,role:'client'}}],
  ['null staff',{ok:true,principal:'staff',staff:null}],
  ['null session',null]
]){
  test(`untrusted staff session ${label} cannot reveal FinanceOS or initialize Blueprint`,async({page})=>{
    const{app,httpRequests}=await open(page,{denied:true,authControl:{...staffAuth(),session}});
    if(staffHome)await expect.poll(()=>new URL(page.url()).pathname).toBe('/app/'+staffHome);
    else await expect.poll(()=>blueprintAccessState(page)).toMatch(/^(unavailable|signed_out)$/);
    await expect(app).toBeHidden();
    await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-blueprint-plan','active');
    expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);
  });
}

test('denied staff session cannot reveal FinanceOS or initialize Blueprint',async({page})=>{
  const{app,httpRequests}=await open(page,{denied:true,authControl:{...staffAuth(),signedOut:true}});
  await expect.poll(()=>blueprintAccessState(page)).toMatch(/^(unavailable|signed_out)$/);
  await expect(app).toBeHidden();
  await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
  expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);
});

test('delayed staff session cannot reopen FinanceOS after the captured token changes',async({page})=>{
  const auth=staffAuth(),gate=requestBarrier();
  try{
    const{app,httpRequests}=await open(page,{denied:true,authControl:auth,requestGates:{'GET /api/auth/session':gate}});
    await gate.arrived;await changePrincipal(page,auth,'switch');
    await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','unavailable');
    await finishBarrier(page,gate);
    await expect(page.locator('body')).toHaveAttribute('data-blueprint-access','unavailable');
    await expect(app).toBeHidden();await expect(app).toBeEmpty();
    await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
    expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);
  }finally{gate.release();}
});
for(const paymentFlag of[false,true])test(`paid Blueprint includes the missing report without a diagnostic purchase (legacy paid flag ${paymentFlag})`,async({page})=>{
  const{app,requests}=await open(page,{portalSummary:{soft_pull_complete:paymentFlag}});
  const tile=page.locator('[data-tile="SOFT_PULL"]');
  await expect(page.locator('body')).toHaveAttribute('data-blueprint-plan','active');
  await expect(tile.locator('.lockrow')).toHaveText('Included with Blueprint');
  await expect(tile.locator('.tp')).toHaveText('Included with Blueprint — report not ready yet');
  await expect(tile.locator('.tacts [data-book]:visible,.tacts [data-unlock]:visible')).toHaveCount(0);
  await expect(page.locator('#unlock-note')).not.toContainText('$32');
  await expect(page.locator('#soft-pull-entry-link')).toHaveAttribute('href','#blueprint-plan');
  await page.locator('.client-ios-nav').getByRole('link',{name:'Documents',exact:true}).click();
  await expect(tile.getByRole('button',{name:'View report status',exact:true})).toBeVisible();
  await tile.getByRole('button',{name:'View report status',exact:true}).click();
  await expect(page.locator('body')).toHaveAttribute('data-portal-view','home');
  expect(new URL(page.url()).searchParams.has('view')).toBe(false);
  await expect(page.locator('.client-ios-nav').getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page');
  await expect(app.getByRole('heading',{name:preparationGuidance().find(x=>x.key==='credit_review').title,exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Save this step',exact:true})).toBeVisible();
  await expect(page.locator('#unlock-modal')).not.toHaveClass(/\bon\b/);
  expect(requests).toHaveLength(0);
});
test('roadmap ownership alone leaves the non-Blueprint diagnostic at its original price',async({page})=>{
  await open(page,{denied:true,entitlementRows:[{entitlement_code:'credit-optimization-roadmap',active:true}]});
  const tile=page.locator('[data-tile="SOFT_PULL"]');
  await expect(page.locator('#blueprint-plan')).toBeHidden();
  await expect(tile).toHaveClass(/\blocked\b/);await expect(tile.locator('.tp')).toHaveText('$32');
  await expect(tile.getByRole('button',{name:'Talk to an advisor',exact:true})).toBeVisible();
  await expect(page.locator('#soft-pull-entry-link')).toHaveAttribute('href','/app/soft-pull-approve.html?portal=1');
});
test('a delayed authenticated Blueprint plan repaints an already loaded diagnostic offer',async({page})=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  await open(page,{planAccess:{wait},entitlementRows:[{entitlement_code:'credit-optimization-roadmap',active:true}]});
  const tile=page.locator('[data-tile="SOFT_PULL"]');
  try{
    await expect(page.locator('[data-tile="UWIQ_DELIVERABLES"]')).not.toHaveClass(/\blocked\b/);
    await expect(tile.locator('.tp')).toHaveText('$32');
  }finally{release();}
  await expect(tile.locator('.lockrow')).toHaveText('Included with Blueprint');
  await expect(tile.locator('.tp')).toContainText('report not ready yet');
});
test('revoked paid-year access removes the included diagnostic display on the same page',async({page})=>{
  const access={denied:false};const{app}=await open(page,{started:true,planAccess:access,entitlementRows:[{entitlement_code:'credit-optimization-roadmap',active:true}]});
  const tile=page.locator('[data-tile="SOFT_PULL"]');
  await expect(tile.locator('.lockrow')).toHaveText('Included with Blueprint');
  await app.getByRole('button',{name:'Letters and responses',exact:true}).click();
  access.denied=true;await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();
  await expect(tile.locator('.tp')).toHaveText('$32');await expect(tile).toHaveClass(/\blocked\b/);
  await expect(tile.getByRole('button',{name:'Talk to an advisor',exact:true})).toBeVisible();
  await expect(page.locator('#unlock-note')).toContainText('$32');
  await expect(page.locator('#soft-pull-entry-link')).toHaveAttribute('href','/app/soft-pull-approve.html?portal=1');
});
test('an actual saved credit-analysis report still displays Done for the paid buyer',async({page})=>{
  await open(page,{portalSummary:{soft_pull_complete:true,documents:[{id:DOCUMENT,kind:'deliverable',subtype:'credit_analysis_report',title:'Credit Analysis Report',download:null}]}});
  const tile=page.locator('[data-tile="SOFT_PULL"]');
  await expect(tile.locator('.lockrow')).toHaveText('Done');
  await expect(tile.locator('.tp')).toHaveText('Your credit assessment result is on file');
  await expect(tile).not.toContainText('report not ready yet');
  await expect(tile.locator('.tacts [data-book]:visible')).toHaveCount(0);
});
test('incomplete successful API response cannot invent a saved buyer plan',async({page})=>{
  const{app}=await open(page,{malformedPlan:true});await expect(app).toContainText('Your Blueprint couldn’t load.');
  await expect(app.getByRole('button',{name:'Try again'})).toBeVisible();await expect(app).not.toContainText('Saved to your client file');
  await expect(page.locator('body')).toHaveAttribute('data-blueprint-plan','error');
  await expect(page.locator('a[href*="finance-os"]:visible,a[href*="financeos"]:visible,#money-link:visible')).toHaveCount(0);
});
test('business plan saves supported actual details and uses the same identity on retry',async({page})=>{
  const{app,state,requests}=await open(page,{started:true,failSaveOnce:true});await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Add a business plan',exact:true}).click();await app.locator('input[name=name]').fill('Maple Studio LLC');await app.locator('textarea[name=activity]').fill('Photography for local businesses');await app.getByRole('button',{name:'Save business plan',exact:true}).click();await expect(app.getByText('The saved plan is temporarily unavailable.',{exact:true})).toBeVisible();const firstId=requests.at(-1).business.id;await app.getByRole('button',{name:'Save business plan',exact:true}).click();await expect.poll(()=>requests.length).toBe(2);expect(requests.at(-1).business.id).toBe(firstId);
  await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();expect(state.businesses).toHaveLength(1);expect(requests.at(-1).business.formationStatus).toBe('planned');expect(requests.at(-1).business.evidence).toBeUndefined();await page.reload();await app.getByRole('button',{name:'Businesses',exact:true}).click();await expect(app.getByRole('heading',{name:'Maple Studio LLC',exact:true})).toBeVisible();
});
test('failed server save remains visibly failed without adding a business',async({page})=>{
  const{app,state}=await open(page,{started:true,failSave:true});await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Add a business plan',exact:true}).click();await app.locator('input[name=name]').fill('Maple Studio LLC');await app.locator('textarea[name=activity]').fill('Photography');await app.getByRole('button',{name:'Save business plan',exact:true}).click();await expect(app.getByText('The saved plan is temporarily unavailable.',{exact:true})).toBeVisible();expect(state.businesses).toHaveLength(0);await expect(app.locator('input[name=name]')).toHaveValue('Maple Studio LLC');
});
test('multipart upload contract attaches returned document ID and stays evidence-received',async({page})=>{
  const{app,requests,wasUploaded}=await open(page,{started:true,business:true});await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Open this business',exact:true}).click();const form=app.locator('form[data-kind=formation]');await form.locator('input[type=file]').setInputFiles({name:'formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture for browser contract')});await form.getByRole('button',{name:'Upload formation document',exact:true}).click();await expect(app.getByText('Evidence received',{exact:true})).toBeVisible();expect(wasUploaded()).toBe(true);expect(requests.at(-1)).toMatchObject({action:'attach_evidence',businessId:PLAN,kind:'formation',documentId:'50000000-0000-4000-8000-000000000005'});await expect(app.getByRole('button',{name:/simulate/i})).toHaveCount(0);
});
test('all seventeen requested lessons are usable, with business-specific website and filing context',async({page})=>{
  const{app}=await open(page,{started:true,business:true});await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();await expect(app.getByRole('button',{name:'Open step',exact:true})).toHaveCount(17);await app.locator('[data-key=business_website]').click();await app.locator('[data-bp-business]').selectOption(PLAN);await expect(app.locator('#bp-website-prompt')).toContainText('Cedar Grove LLC');await expect(app.locator('#bp-website-prompt')).toContainText('Web design for local shops');
});
test('saved step date creates a usable Google calendar event link',async({page})=>{
  const{app,state}=await open(page,{started:true});
  await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();
  await app.locator('[data-key=credit_review]').click();
  await app.locator('input[name=targetDate]').fill('2027-02-01');
  await app.locator('select[name=status]').selectOption('in_progress');
  await app.getByRole('button',{name:'Save this step',exact:true}).click();
  await expect(app.locator('[data-bp-status]')).toHaveText('Saved to your client file.');
  expect(state.stepProgress).toHaveLength(1);
  const timeline=app.getByRole('button',{name:'Timeline',exact:true});
  await timeline.click();
  await expect(timeline).toHaveAttribute('aria-current','page');
  const link=app.getByRole('link',{name:/Add to Google Calendar/});
  await expect(link).toHaveAttribute('href',/calendar\.google\.com\/calendar\/render/);
  expect(new URL(await link.getAttribute('href')).searchParams.get('dates')).toBe('20270201/20270202');
});
for(const width of[1440,390])test(`real buyer controls fit at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:1000});const{app}=await open(page,{started:true,business:true});
  for(const name of['Businesses','Step-by-step help','Letters and responses','Timeline','Get help','Today']){
    await app.getByRole('button',{name,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
  await expect(app.locator('.bj-finance')).toContainText('Your accounts, cash flow, credit, and financial plan in the same workspace.');
  await expect(app.locator('.bj-finance').getByRole('link',{name:'Open FinanceOS',exact:true})).toHaveAttribute('href','/app/financeos.html');
  await expect(app.locator('.bj-finance')).toContainText('Account connection needed');
});

async function openBusiness(app){
  await app.getByRole('button',{name:'Businesses',exact:true}).click();
  await app.getByRole('button',{name:'Open this business',exact:true}).first().click();
}

function observePdfDelivery(page,context,expectedBytes){
  const expectedUrl=new URL('/api/documents/'+DOCUMENT+'?exp=2000000000&sig=offline-fixture-signature',page.url()).href;
  const requests=[],downloads=[];
  const onRequest=request=>{if(request.url()===expectedUrl)requests.push(request);};
  const onPage=popup=>popup.on('download',download=>downloads.push(download));
  context.on('request',onRequest);context.on('page',onPage);
  return async(popup,testInfo)=>{
    try{
      await expect.poll(()=>requests.length).toBe(1);
      expect(requests[0].url()).toBe(expectedUrl);expect(requests[0].method()).toBe('GET');expect(requests[0].isNavigationRequest()).toBe(true);
      // Full Chromium may open its PDF viewer. Headless shell downloads the
      // same navigation and leaves the pre-opened window at about:blank.
      await expect.poll(()=>downloads.length>0||popup.url()===expectedUrl).toBe(true);
      let bytes,mode,contentProof;
      if(downloads.length){
        expect(downloads).toHaveLength(1);expect(downloads[0].url()).toBe(expectedUrl);
        expect(await downloads[0].failure()).toBeNull();bytes=await readFile(await downloads[0].path());mode='download';
        expect(bytes.equals(expectedBytes)).toBe(true);contentProof='download_bytes';
      }else{
        await expect(popup).toHaveURL(expectedUrl);const response=await requests[0].response();
        expect(response).not.toBeNull();expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('application/pdf');
        bytes=await response.body();mode='navigation';
        if(bytes.equals(expectedBytes))contentProof='response_bytes';
        else{
          // Chrome hands the original PDF stream to its native viewer and
          // exposes this handler document to DevTools instead of the bytes.
          const handler=bytes.toString();
          expect(handler).toMatch(/chrome-extension:\/\/[^/]+\/pdf_embedder\.css/);
          expect(handler).toMatch(/<template shadowrootmode="closed">/);
          expect(handler).toMatch(/<iframe[^>]+type="application\/pdf"[^>]+internalid="[^"]+"/);
          contentProof='native_pdf_handler';
        }
      }
      await testInfo.attach('verified-pdf-handoff',{body:JSON.stringify({mode,exactSignedUrl:true,navigationRequest:true,contentProof,observedByteLength:bytes.length}),contentType:'application/json'});
    }finally{context.off('request',onRequest);context.off('page',onPage);}
  };
}

test('saved document action obtains an authenticated signed URL from documents-download',async({page,context},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem('fh_token','offline-fixture-token'));
  const pdf=Buffer.from('%PDF-1.4\noffline browser fixture');
  await context.route('**/api/documents/'+DOCUMENT+'?*',route=>route.fulfill({status:200,contentType:'application/pdf',body:pdf}));
  const b=record();b.evidence.formation={documentId:DOCUMENT,status:'evidence_received'};
  const{app,downloads}=await open(page,{started:true,seed:{businesses:[b]}});
  await openBusiness(app);
  const delivery=observePdfDelivery(page,context,pdf),popupPromise=page.waitForEvent('popup');
  await app.getByRole('button',{name:'Open saved document',exact:true}).click();
  const popup=await popupPromise;
  await expect.poll(()=>downloads.length).toBe(1);
  expect(downloads[0]).toEqual({id:DOCUMENT,authorization:'Bearer offline-fixture-token'});
  await delivery(popup,testInfo);if(!popup.isClosed())await popup.close();
});

test('EIN upload waits for this business formation evidence without sending a file',async({page})=>{
  const{app,uploadCount}=await open(page,{started:true,business:true});await openBusiness(app);
  await expect(app.getByText('Add the formation document before uploading this business’s EIN letter.',{exact:true})).toBeVisible();
  await expect(app.locator('form[data-kind=ein]')).toHaveCount(0);expect(uploadCount()).toBe(0);
  const formation=app.locator('form[data-kind=formation]');
  await formation.locator('input[type=file]').setInputFiles({name:'formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noffline fixture')});
  await formation.getByRole('button',{name:'Upload formation document',exact:true}).click();
  await expect(app.locator('form[data-kind=ein]')).toBeVisible();expect(uploadCount()).toBe(1);
});

test('stored upload retries attachment after navigating back without another upload',async({page})=>{
  const{app,state,requests,uploadCount}=await open(page,{started:true,business:true,failAttachOnce:true});await openBusiness(app);
  let form=app.locator('form[data-kind=formation]');
  await form.locator('input[type=file]').setInputFiles({name:'formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noffline fixture')});
  await form.getByRole('button',{name:'Upload formation document',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('The file is stored, but it could not be attached');expect(uploadCount()).toBe(1);
  await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Open this business',exact:true}).click();
  form=app.locator('form[data-kind=formation]');
  await expect(form.locator('input[type=file]')).toHaveJSProperty('required',false);
  await expect(form.locator('input[type=file]')).toHaveJSProperty('value','');
  await form.getByRole('button',{name:'Retry attaching stored document',exact:true}).click();
  await expect(app.getByText('Evidence received',{exact:true})).toBeVisible();expect(uploadCount()).toBe(1);
  const attempts=requests.filter(r=>r.action==='attach_evidence');expect(attempts).toHaveLength(2);expect(attempts.map(r=>r.documentId)).toEqual([DOCUMENT,DOCUMENT]);expect(state.businesses[0].evidence.formation.documentId).toBe(DOCUMENT);
});

test('Do now skips ongoing and skipped native rows even when they are the current pointer',async({page})=>{
  const nativeProgress={nextStep:{waypointId:'ongoing',owner:'client'},waypoints:[
    {id:'ongoing',title:'Keep the ongoing credit rule',detail:'A rule to keep.',owner:'client',state:'not_started',closedBy:'ongoing',verifyKind:'no_new_credit'},
    {id:'skipped',title:'Previously skipped task',detail:'No longer needed.',owner:'client',state:'skipped'},
    {id:'actionable',title:'Upload the accepted formation record',detail:'Use the actual saved document for this business.',owner:'client',state:'in_progress'}
  ]};
  const{app}=await open(page,{started:true,nativeProgress});
  const next=app.locator('.bj-next');await expect(next).toContainText('Upload the accepted formation record');await expect(next).toContainText('Use the actual saved document');await expect(next).not.toContainText('Keep the ongoing credit rule');await expect(next).not.toContainText('Previously skipped task');
});

test('server setupStep resumes the first unanswered question after reload',async({page})=>{
  const{app,state,requests}=await open(page,{seed:{hasExistingBusiness:false,setupStep:1}});
  await app.getByRole('button',{name:'Continue setup',exact:true}).click();
  await expect(app.getByText('How many businesses are we preparing?',{exact:true})).toBeVisible();await expect(app.getByText('Do you already own a business?',{exact:true})).toHaveCount(0);
  await app.locator('input[name=count][value="4"]').check();await app.getByRole('button',{name:'Save and continue',exact:true}).click();await expect(app.getByText('Where are we building your plan?',{exact:true})).toBeVisible();expect(state.setupStep).toBe(2);
  await page.reload();await app.getByRole('button',{name:'Continue setup',exact:true}).click();await expect(app.getByText('Where are we building your plan?',{exact:true})).toBeVisible();expect(requests.filter(r=>'hasExistingBusiness'in r)).toHaveLength(0);
});

test('existing company selection and website save reference the real record without replacing it',async({page})=>{
  const existing={id:EXISTING_BUSINESS,name:'Existing Studio LLC',activity:'Architectural photography',formationState:'AZ',operatingState:'AZ',formationDate:'2025-01-10',ownershipSince:'2025-01-10',operatingSince:'2025-02-01',entityId:null};
  const{app,state,requests}=await open(page,{started:true,seed:{existingBusinesses:[existing]}});
  await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Add a business plan',exact:true}).click();
  await app.locator('select[name=businessId]').selectOption(EXISTING_BUSINESS);
  await expect(app.locator('input[name=name]')).toHaveValue(existing.name);await expect(app.locator('textarea[name=activity]')).toHaveValue(existing.activity);await expect(app.locator('input[name=formationDate]')).toHaveValue(existing.formationDate);
  await app.locator('select[name=formationStatus]').selectOption('reported_formed');await app.locator('select[name=operatingState]').selectOption('AZ');await app.locator('input[name=website]').fill('https://existing-studio.example');
  await app.getByRole('button',{name:'Save business plan',exact:true}).click();await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();
  expect(requests.at(-1).business).toMatchObject({businessId:EXISTING_BUSINESS,website:'https://existing-studio.example',operatingState:'AZ',formationStatus:'reported_formed',formationDate:'2025-01-10'});expect(state.existingBusinesses).toEqual([existing]);expect(state.businesses).toHaveLength(1);
  await page.reload();await openBusiness(app);await expect(app.locator('select[name=businessId]')).toHaveValue(EXISTING_BUSINESS);await expect(app.locator('input[name=website]')).toHaveValue('https://existing-studio.example');
});

test('bank readiness saves only the selected business and retains its relationship list',async({page})=>{
  const first=record(),second={...record(),id:SECOND_PLAN,name:'Second Prep LLC'};
  first.bankPreparation.relationships=[{id:DOCUMENT,bankName:'Fixture CU',accountType:'business_checking',status:'planned',depositPlanCents:25000}];
  const{app,state,requests}=await open(page,{started:true,seed:{businesses:[first,second]}});
  await openBusiness(app);await app.locator('[data-key=bank_opening][data-business="'+PLAN+'"]').click();
  let form=app.locator('form[data-bp-form=bank-readiness]');await form.locator('input[name=documentsReady]').check();await form.locator('input[name=accountOpeningIssue]').check();await form.getByRole('button',{name:'Save banking readiness',exact:true}).click();
  await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();expect(requests.at(-1).business).toEqual({id:PLAN,bankPreparation:{documentsReady:true,accountOpeningIssue:true}});expect(state.businesses[0].bankPreparation.relationships).toHaveLength(1);expect(state.businesses[1].bankPreparation.documentsReady).toBe(false);
  await app.locator('[data-bp-business]').selectOption(SECOND_PLAN);form=app.locator('form[data-bp-form=bank-readiness]');await expect(form.locator('input[name=documentsReady]')).not.toBeChecked();await expect(form.locator('input[name=accountOpeningIssue]')).not.toBeChecked();
  await page.reload();await openBusiness(app);await app.locator('[data-key=bank_opening][data-business="'+PLAN+'"]').click();await expect(app.locator('form[data-bp-form=bank-readiness] input[name=documentsReady]')).toBeChecked();
});

test('reported bank deposit and formation reviews share a calendar timeline without completing work',async({page})=>{
  const b=record();b.formationStatus='reported_formed';b.formationDate='2026-01-01';
  const{app,state,requests}=await open(page,{started:true,seed:{businesses:[b]}});
  await openBusiness(app);await app.locator('[data-key=bank_deposit][data-business="'+PLAN+'"]').click();
  const form=app.locator('form[data-bp-form=bank-relationship]');await form.locator('input[name=bankName]').fill('Fixture Neighborhood CU');await form.locator('select[name=status]').selectOption('reported_funded');await form.locator('input[name=openedOn]').fill('2026-10-01');await form.locator('input[name=depositPlan]').fill('500');await form.locator('input[name=depositReported]').fill('400');await form.locator('input[name=depositedOn]').fill('2026-10-02');await form.locator('input[name=seasoningDays]').fill('30');await form.locator('input[name=nextReviewOn]').fill('2027-02-01');await form.getByRole('button',{name:'Save bank relationship',exact:true}).click();
  await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();expect(requests.at(-1).business.bankPreparation.relationships[0]).toMatchObject({status:'reported_funded',depositPlanCents:50000,depositReportedCents:40000,openedOn:'2026-10-01',depositedOn:'2026-10-02',seasoningDays:30,nextReviewOn:'2027-02-01'});
  await app.getByRole('button',{name:'Timeline',exact:true}).click();
  const review=app.locator('article').filter({hasText:'Review Fixture Neighborhood CU relationship'});
  await expect(review).toContainText('Cedar Grove LLC');await expect(review).toContainText('Review your reported bank milestones');const calendar=review.getByRole('link',{name:/Add to Google Calendar/});expect(new URL(await calendar.getAttribute('href')).searchParams.get('dates')).toBe('20270201/20270202');
  await expect(app.getByRole('heading',{name:'Check Fixture Neighborhood CU seasoning plan',exact:true})).toBeVisible();for(const months of[3,6,12])await expect(app.getByRole('heading',{name:months+'-month business preparation review',exact:true})).toBeVisible();
  expect(state.businesses[0].evidence.formation.status).toBe('not_added');expect(state.businesses[0].bankPreparation.relationships[0].status).toBe('reported_funded');expect(state.stepProgress).toHaveLength(0);
});

async function openLesson(app,key){
  await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();
  await app.locator('[data-bp-action=lesson][data-key="'+key+'"]').click();
}
async function addDebt(app,{label,balance,apr,minimum}){
  const form=app.locator('form[data-bp-form=payoff-debt]');
  await form.locator('input[name=label]').fill(label);
  await form.locator('input[name=balance]').fill(balance);
  await form.getByLabel('APR, percent',{exact:true}).fill(apr??'');
  await form.locator('input[name=minimum]').fill(minimum??'');
  await form.getByRole('button',{name:'Save debt details',exact:true}).click();
  await expect(app.locator('.bp-item strong').filter({hasText:label})).toBeVisible();
  await expect(form.locator('input[name=label]')).toHaveValue('');
}
const payoffDebts=()=>[
  {id:'90000000-0000-4000-8000-000000000009',label:'Small balance',balanceCents:20000,aprBps:900,minimumPaymentCents:2000},
  {id:'a0000000-0000-4000-8000-00000000000a',label:'Higher interest',balanceCents:120000,aprBps:2700,minimumPaymentCents:3000}
];

test('saved payoff approach and debts resume with distinct snowball and highest-interest payment orders',async({page})=>{
  const{app,state,requests}=await open(page,{started:true});await openLesson(app,'budget');
  const settings=app.locator('form[data-bp-form=payoff-settings]');
  await settings.locator('input[name=monthlyBudget]').fill('150');
  await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();
  await expect(app).toContainText('Monthly payments planned: $0.00. Unused monthly budget: $150.00.');
  await expect.poll(()=>state.payoffPlan?.monthlyBudgetCents).toBe(15000);
  await addDebt(app,{label:'Small balance',balance:'200',apr:'9',minimum:'20'});
  await addDebt(app,{label:'Higher interest',balance:'1200',apr:'27',minimum:'30'});
  expect(state.payoffPlan).toMatchObject({strategy:'snowball',monthlyBudgetCents:15000});
  expect(state.payoffPlan.debts).toHaveLength(2);expect(state.payoffPlan.debts[1].aprBps).toBe(2700);
  const small=app.locator('.bp-item').filter({hasText:'Priority 1 · Small balance'});
  await expect(small).toContainText('Planned monthly payment: $120.00 ($100.00 above the minimum).');
  await page.reload();await openLesson(app,'budget');
  await expect(settings.locator('input[name=monthlyBudget]')).toHaveValue('150');
  await expect(app.getByText('Priority 1 · Small balance',{exact:true})).toBeVisible();
  await settings.locator('select[name=strategy]').selectOption('avalanche');
  await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();
  const higher=app.locator('.bp-item').filter({hasText:'Priority 1 · Higher interest'});
  await expect(higher).toContainText('Planned monthly payment: $130.00 ($100.00 above the minimum).');
  await expect(app.getByText('Priority 2 · Small balance',{exact:true})).toBeVisible();
  expect(requests.at(-1)).toMatchObject({action:'save_payoff_plan',strategy:'avalanche',monthlyBudgetCents:15000});
  await page.reload();await openLesson(app,'budget');await expect(settings.locator('select[name=strategy]')).toHaveValue('avalanche');
  await expect(app).toContainText('No payment is sent by saving this plan.');
});

test('monthly budget below known minimums shows its shortfall without speculative payment allocations',async({page})=>{
  const{app}=await open(page,{started:true,seed:{payoffPlan:{strategy:'snowball',monthlyBudgetCents:3000,debts:payoffDebts()}}});
  await openLesson(app,'budget');
  await expect(app).toContainText('Your monthly budget is short of known minimums by $20.00.');
  await expect(app.getByText(/Planned monthly payment:/)).toHaveCount(0);
  const settings=app.locator('form[data-bp-form=payoff-settings]');
  await settings.locator('input[name=monthlyBudget]').fill('50');await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();
  await expect(app).toContainText('Monthly payments planned: $50.00. Unused monthly budget: $0.00.');
  await expect(app.getByText(/Planned monthly payment:/)).toHaveCount(2);
});

test('highest-interest planning preserves an unknown APR and asks for review rather than inventing a rate or order',async({page})=>{
  const debts=payoffDebts();debts[0].aprBps=null;
  const{app,state}=await open(page,{started:true,seed:{payoffPlan:{strategy:'avalanche',monthlyBudgetCents:15000,debts}}});
  await openLesson(app,'budget');
  await expect(app).toContainText('Add the missing monthly budget, minimum payments and interest rates to calculate a payment plan.');
  await expect(app).toContainText('APR Unknown');await expect(app.getByText(/^Priority /)).toHaveCount(0);
  await expect(app.getByText(/Planned monthly payment:/)).toHaveCount(0);
  await app.locator('.bp-item').filter({hasText:'Small balance'}).getByRole('button',{name:'Edit debt',exact:true}).click();
  const debt=app.locator('form[data-bp-form=payoff-debt]');await expect(debt.getByLabel('APR, percent',{exact:true})).toHaveValue('');
  await debt.getByRole('button',{name:'Save debt details',exact:true}).click();
  await expect(debt.locator('input[name=label]')).toHaveValue('');
  expect(state.payoffPlan.debts.find(x=>x.label==='Small balance').aprBps).toBeNull();
  const settings=app.locator('form[data-bp-form=payoff-settings]');await settings.locator('select[name=strategy]').selectOption('snowball');await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();
  await expect(app.getByText('Priority 1 · Small balance',{exact:true})).toBeVisible();
  await expect(app.getByText(/Planned monthly payment:/)).toHaveCount(2);expect(state.payoffPlan.debts.find(x=>x.label==='Small balance').aprBps).toBeNull();
});

test('cash planning reserves bills and paydowns alongside deposits across businesses and flags overcommitment',async({page})=>{
  const first=record(),second={...record(),id:SECOND_PLAN,name:'Second Studio LLC'};
  first.bankPreparation.relationships=[{id:'91000000-0000-4000-8000-000000000001',bankName:'First CU',status:'planned',depositPlanCents:40000}];
  second.bankPreparation={...second.bankPreparation,relationships:[{id:'91000000-0000-4000-8000-000000000002',bankName:'Second CU',status:'planned',depositPlanCents:25000}]};
  const{app,state,requests}=await open(page,{started:true,seed:{businesses:[first,second]}});await openLesson(app,'budget');
  const budget=app.locator('form[data-bp-form=budget]');
  await expect(budget).toContainText('Add the unknown cash, buffer, paydown and deposit amounts');
  await budget.locator('input[name=cash]').fill('1000');await budget.locator('input[name=income]').fill('4000');
  await budget.locator('input[name=buffer]').fill('250');await budget.locator('input[name=payoffReserve]').fill('200');
  await budget.getByRole('button',{name:'Save cash and income',exact:true}).click();
  await expect(budget).toContainText('Saved bank deposit commitments: $650.00.');
  await expect(budget).toContainText('These plans exceed your reported cash by $100.00. Adjust the commitments before moving money.');
  expect(requests.at(-1)).toMatchObject({action:'save_settings',availableCashCents:100000,monthlyIncomeCents:400000,cashBufferCents:25000,oneTimePayoffCents:20000});
  expect(state.businesses.map(b=>b.bankPreparation.relationships[0].depositPlanCents)).toEqual([40000,25000]);
  await page.reload();await openLesson(app,'budget');await expect(budget.locator('input[name=buffer]')).toHaveValue('250');await expect(budget.locator('input[name=payoffReserve]')).toHaveValue('200');
  await budget.locator('input[name=cash]').fill('2000');await budget.getByRole('button',{name:'Save cash and income',exact:true}).click();
  await expect(budget).toContainText('Cash left after these commitments: $900.00.');
  await budget.locator('input[name=buffer]').fill('');await budget.getByRole('button',{name:'Save cash and income',exact:true}).click();
  await expect(budget).toContainText('Add the unknown cash, buffer, paydown and deposit amounts');expect(state.cashBufferCents).toBeNull();
  await expect(budget).not.toContainText('Cash left after these commitments:');
});

test('saved bank guidance prefills a separate reported plan without declaring an account opened or funded',async({page})=>{
  const bankPlan={recommended_banks:[{name:'Fixture Guidance CU',products:['Business checking'],minimum_deposit_cents:80000,seasoning_days:90,relationship_steps:[{text:'Confirm current membership and terms.'}]}]};
  const{app,state,requests}=await open(page,{started:true,business:true,bankPlan,seed:{availableCashCents:100000,cashBufferCents:10000,oneTimePayoffCents:20000}});
  await openBusiness(app);await app.locator('[data-key=bank_deposit][data-business="'+PLAN+'"]').click();
  await app.getByText('Existing lender relationship guidance',{exact:true}).click();
  await expect(app).toContainText('The saved deposit reference exceeds your remaining reported cash budget.');
  await app.getByRole('button',{name:'Plan this relationship',exact:true}).click();
  const form=app.locator('form[data-bp-form=bank-relationship]');
  await expect(form.locator('input[name=bankName]')).toHaveValue('Fixture Guidance CU');
  await expect(form.locator('input[name=depositPlan]')).toHaveValue('800');await expect(form.locator('input[name=seasoningDays]')).toHaveValue('90');
  await expect(form.locator('select[name=status]')).toHaveValue('planned');await expect(form.locator('input[name=openedOn]')).toHaveValue('');await expect(form.locator('input[name=depositReported]')).toHaveValue('');
  await form.getByRole('button',{name:'Save bank relationship',exact:true}).click();
  await expect.poll(()=>state.businesses[0].bankPreparation.relationships.length).toBe(1);
  expect(requests.at(-1).business).toMatchObject({id:PLAN,bankPreparation:{relationships:[{bankName:'Fixture Guidance CU',status:'planned',depositPlanCents:80000,seasoningDays:90,openedOn:null,depositReportedCents:null}]}});
  await expect(app).toContainText('The saved deposits, buffer and one-time paydowns exceed your cash by $100.00. Adjust the commitments before moving money.');expect(state.stepProgress).toHaveLength(0);
});

test('business evidence multipart includes the actual linked entity ID without customer-supplied review status',async({page})=>{
  const b={...record(),entityId:ENTITY,businessId:EXISTING_BUSINESS};
  const{app,uploadFields,requests}=await open(page,{started:true,seed:{businesses:[b]}});await openBusiness(app);
  const form=app.locator('form[data-bp-form=evidence][data-kind=formation]');
  await form.locator('input[type=file]').setInputFiles({name:'linked-formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noffline linked-entity fixture')});
  await form.getByRole('button',{name:'Upload formation document',exact:true}).click();
  await expect(app.getByText('Evidence received',{exact:true})).toBeVisible();
  expect(uploadFields).toEqual([{kind:'client_upload',subtype:'articles_of_organization',entityId:ENTITY,filename:'linked-formation.pdf'}]);
  expect(requests.at(-1)).toEqual({action:'attach_evidence',businessId:PLAN,kind:'formation',documentId:DOCUMENT});
});

test('stored upload is recoverable from server files after reload with no second multipart upload',async({page})=>{
  const b={...record(),entityId:ENTITY};
  const{app,state,requests,uploadCount}=await open(page,{started:true,seed:{businesses:[b],availableEvidence:[{documentId:'b0000000-0000-4000-8000-00000000000b',kind:'formation',filename:'Other business.pdf',receivedAt:'2026-11-01T20:00:00Z',entityId:'c0000000-0000-4000-8000-00000000000c'}]},failAttachOnce:true});
  await openBusiness(app);let form=app.locator('form[data-bp-form=evidence][data-kind=formation]');
  await form.locator('input[type=file]').setInputFiles({name:'stored-formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noffline recoverable fixture')});
  await form.getByRole('button',{name:'Upload formation document',exact:true}).click();
  await expect(form.getByRole('alert')).toContainText('The file is stored, but it could not be attached');expect(uploadCount()).toBe(1);
  expect(state.businesses[0].evidence.formation.status).toBe('not_added');
  await page.reload();await openBusiness(app);
  const recovery=app.locator('form[data-bp-form=saved-evidence][data-kind=formation]');
  await expect(recovery.locator('option',{hasText:'stored-formation.pdf'})).toHaveCount(1);
  await expect(recovery.locator('option',{hasText:'Other business.pdf'})).toHaveCount(0);
  await expect(app.getByRole('button',{name:'Retry attaching stored document',exact:true})).toHaveCount(0);
  await recovery.locator('select[name=documentId]').selectOption(DOCUMENT);await recovery.getByRole('button',{name:'Attach saved document',exact:true}).click();
  await expect(app.getByText('Evidence received',{exact:true})).toBeVisible();expect(uploadCount()).toBe(1);
  expect(requests.filter(r=>r.action==='attach_evidence').map(r=>r.documentId)).toEqual([DOCUMENT,DOCUMENT]);
  expect(state.businesses[0].evidence.formation).toEqual({documentId:DOCUMENT,status:'evidence_received'});
});

function savedLetters(mailSupported=true){return{letters:[
  {documentId:DOCUMENT,title:'Inquiry correction — EX',subtype:'funding_inquiry_removal',bureau:'EX',generatedAt:'2026-11-02T12:00:00Z',eligibleForMailing:true},
  {documentId:SECOND_PLAN,title:'Personal information correction — TU',subtype:'funding_personal_info',bureau:'TU',generatedAt:'2026-11-02T12:00:00Z',eligibleForMailing:true},
  {documentId:EXISTING_BUSINESS,title:'Earlier letter — EQ',subtype:'funding_personal_info',bureau:'EQ',generatedAt:'2026-10-01T12:00:00Z',eligibleForMailing:false,reason:'A current letter needs review.'}
],orders:[],capabilities:{mailSupported,reason:mailSupported?null:'offline_provider_unavailable'}};}
async function openLetters(app){
  await app.getByRole('button',{name:'Letters and responses',exact:true}).click();
  await expect(app.getByRole('heading',{name:'Your letters, mailing and responses',exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Download letter',exact:true})).toHaveCount(3);
}

test('letters are directly downloadable through authenticated signed links and self-mailing instructions are usable',async({page,context},testInfo)=>{
  await page.addInitScript(()=>localStorage.setItem('fh_token','offline-letter-token'));
  const pdf=Buffer.from('%PDF-1.4\noffline letter fixture');
  await context.route('**/api/documents/'+DOCUMENT+'?*',route=>route.fulfill({status:200,contentType:'application/pdf',body:pdf}));
  const{app,downloads,mailRequests}=await open(page,{started:true,mailing:savedLetters()});await openLetters(app);
  const delivery=observePdfDelivery(page,context,pdf),popupPromise=page.waitForEvent('popup');await app.getByRole('button',{name:'Download letter',exact:true}).first().click();const popup=await popupPromise;
  await delivery(popup,testInfo);
  expect(downloads).toEqual([{id:DOCUMENT,authorization:'Bearer offline-letter-token'}]);if(!popup.isClosed())await popup.close();
  await app.getByText('How to send the letters yourself',{exact:true}).click();
  await expect(app).toContainText('Sign and date where required');await expect(app).toContainText('Keep a copy of your packet.');
  await expect(app.getByRole('link',{name:'Upload mailing proof in View progress',exact:true})).toHaveAttribute('href','/progress.html#waypoints');
  await expect(app.getByRole('link',{name:'Review official dispute instructions',exact:true})).toHaveAttribute('href',/^https:\/\/www.consumerfinance.gov\//);
  expect(mailRequests).toHaveLength(0);
});

test('a $97 quote does not confirm payment and explicit authorization submits its exact order once',async({page})=>{
  const{app,mailRequests,mailingData,state}=await open(page,{started:true,mailing:savedLetters()});await openLetters(app);
  await expect(app.locator('[data-mail-letter]')).toHaveCount(2);
  await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();
  const form=app.locator('form[data-bp-form=mail-confirm]');await expect(form).toBeVisible();await expect(form).toContainText('Total $97.00 USD');
  await expect(form).toContainText('Inquiry correction — EX');await expect(form).toContainText('Personal information correction — TU');
  expect(mailRequests).toEqual([{action:'quote',documentIds:[DOCUMENT,SECOND_PLAN]}]);expect(mailingData.orders).toHaveLength(0);
  const authorization=form.locator('input[name=authorization]');await expect(authorization).not.toBeChecked();await expect(authorization).toHaveJSProperty('required',true);
  await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();expect(mailRequests).toHaveLength(1);expect(mailingData.orders).toHaveLength(0);
  await form.locator('select[name=paymentOptionId]').selectOption('offline-checkout');await authorization.check();
  await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();
  await expect(app.getByRole('link',{name:'Continue secure payment',exact:true})).toHaveAttribute('href','https://offline-checkout.example/order/'+ORDER);
  expect(mailRequests[1]).toEqual({action:'confirm',orderId:ORDER,quoteVersion:1,paymentOptionId:'offline-checkout',authorization:true,idempotencyKey:ORDER});
  await expect(app).toContainText('$97.00 · payment pending');await expect(app).toContainText('Payment, mailing acceptance and delivery are separate statuses.');
  mailingData.orders[0].status='mailed';mailingData.orders[0].envelopes=[{bureau:'EX',status:'accepted',trackingUrl:'https://offline-tracking.example/'+ORDER}];
  await app.getByRole('button',{name:'Check request status',exact:true}).click();await expect(app).toContainText('$97.00 · Submitted for mailing');
  expect(mailRequests.at(-1)).toEqual({action:'status',orderId:ORDER});
  await page.reload();await openLetters(app);await expect(app).toContainText('$97.00 · Submitted for mailing');
  expect(mailRequests.filter(r=>r.action==='confirm')).toHaveLength(1);expect(state.stepProgress).toHaveLength(0);
});

test('changing selected letters invalidates the displayed quote before any authorization can be sent',async({page})=>{
  const{app,mailRequests}=await open(page,{started:true,mailing:savedLetters()});await openLetters(app);
  await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();await expect(app.locator('form[data-bp-form=mail-confirm]')).toBeVisible();
  await app.locator('[data-mail-letter="'+SECOND_PLAN+'"]').uncheck();
  await expect(app.locator('form[data-bp-form=mail-confirm]')).toHaveCount(0);expect(mailRequests.filter(r=>r.action==='confirm')).toHaveLength(0);
  await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();
  const form=app.locator('form[data-bp-form=mail-confirm]');await expect(form).toBeVisible();await expect(form).toContainText('Inquiry correction — EX');await expect(form).not.toContainText('Personal information correction — TU');
  expect(mailRequests).toEqual([{action:'quote',documentIds:[DOCUMENT,SECOND_PLAN]},{action:'quote',documentIds:[DOCUMENT]}]);
  await form.locator('input[name=authorization]').check();await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();
  await expect(app).toContainText('$97.00 · payment pending');expect(mailRequests.at(-1)).toMatchObject({action:'confirm',quoteVersion:2,authorization:true});
});

test('unsupported mailing provider preserves downloads and the self-mailing path without presenting charge controls',async({page})=>{
  const mailing=savedLetters(false);mailing.orders=[{id:ORDER,status:'quoted',totalCents:9700,envelopes:[{bureau:'EX',status:'pending'}]}];
  const{app,mailRequests,downloadState}=await open(page,{started:true,mailing});await openLetters(app);
  await expect(app).toContainText('Mailing service needs setup before payment can be taken.');
  await expect(app.getByRole('button',{name:'Mail these letters for me · $97',exact:true})).toHaveCount(0);await expect(app.locator('form[data-bp-form=mail-confirm]')).toHaveCount(0);
  await app.getByText('How to send the letters yourself',{exact:true}).click();await expect(app.getByRole('link',{name:'Upload mailing proof in View progress',exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Download letter',exact:true})).toHaveCount(3);await expect(app.locator('form[data-bp-form=bureau-response]')).toBeVisible();expect(mailRequests).toHaveLength(0);
  await expect(app.getByRole('link',{name:'Continue secure payment',exact:true})).toHaveCount(0);await expect(app.getByRole('link',{name:'Track mailing',exact:true})).toHaveCount(0);await expect(app.locator('a[href$="/undefined"]')).toHaveCount(0);
  downloadState.missing=true;const popupPromise=page.waitForEvent('popup');await app.getByRole('button',{name:'Download letter',exact:true}).first().click();const popup=await popupPromise;
  await expect(app).toContainText('The saved document does not have an available download link.');await expect.poll(()=>popup.isClosed()).toBe(true);
});

test('uploaded bureau reply resumes pending and trusts only its exact current-version validator result without closing credit progress',async({page})=>{
  const{app,state,responseDocuments,bureauUploads,uploadCount}=await open(page,{started:true,mailing:savedLetters(false)});await openLetters(app);
  const form=app.locator('form[data-bp-form=bureau-response]');
  await form.locator('input[name=files]').setInputFiles([{name:'bureau-reply.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\noffline bureau reply fixture')},{name:'reply-page-two.png',mimeType:'image/png',buffer:Buffer.from('offline page fixture')}]);
  await form.getByRole('button',{name:'Upload response for validation',exact:true}).click();
  await expect(app.getByText('Received · validation pending',{exact:true})).toBeVisible();expect(uploadCount()).toBe(1);
  expect(bureauUploads).toEqual([{kind:'bureau_response',subtype:'other',filenames:['bureau-reply.pdf','reply-page-two.png']}]);
  await page.reload();await openLetters(app);await expect(app.getByText('Received · validation pending',{exact:true})).toBeVisible();
  const doc=responseDocuments[0];const validation=(status,extra={})=>({schema:1,validator:'bureau-response-reader',document_id:doc.id,version_id:doc.current_version_id,status,reason:'Offline saved validation result',reviewed_at:'2026-11-02T20:10:00Z',...extra});
  doc.metadata.bureau_response_validation=validation('request_more',{reason:'The response text needs a clearer page.'});
  await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await expect(app.getByText('A clearer or more complete file is needed',{exact:true})).toBeVisible();await expect(app).toContainText('The response text needs a clearer page.');
  doc.metadata.bureau_response_validation=validation('accepted');
  await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await expect(app.getByText('Document accepted for review of the next step',{exact:true})).toBeVisible();
  doc.current_version_id='f0000000-0000-4000-8000-00000000000f';
  await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await expect(app.getByText('Received · validation pending',{exact:true})).toBeVisible();await expect(app.getByText('Document accepted for review of the next step',{exact:true})).toHaveCount(0);await expect(app).not.toContainText('Offline saved validation result');
  doc.metadata.bureau_response_validation=validation('accepted',{validator:'untrusted-browser-flag'});
  await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await expect(app.getByText('Received · validation pending',{exact:true})).toBeVisible();
  doc.metadata.bureau_response_validation=validation('hold',{reason:'The response needs team review.'});
  await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await expect(app.getByText('Team review required',{exact:true})).toBeVisible();
  expect(state.stepProgress).toHaveLength(0);expect(uploadCount()).toBe(1);await expect(app).toContainText('An accepted document is separate from a verified credit-report change.');
  await app.getByRole('button',{name:'Today',exact:true}).click();await expect(app.locator('.bj-next').getByText('Review the balances on your file',{exact:true})).toBeVisible();
});

test('failed new debt save retains the same debt identity for a retry without creating a duplicate',async({page})=>{
  const{app,state,requests}=await open(page,{started:true,failSaveOnce:true,seed:{payoffPlan:{strategy:'snowball',monthlyBudgetCents:15000,debts:[]}}});await openLesson(app,'budget');
  const form=app.locator('form[data-bp-form=payoff-debt]');await form.locator('input[name=label]').fill('Retry debt');await form.locator('input[name=balance]').fill('200');await form.locator('input[name=minimum]').fill('20');
  await form.getByRole('button',{name:'Save debt details',exact:true}).click();await expect(app.getByText('The saved plan is temporarily unavailable.',{exact:true})).toBeVisible();
  const firstId=requests.at(-1).debts[0].id;expect(state.payoffPlan.debts).toHaveLength(0);await expect(form.locator('input[name=label]')).toHaveValue('Retry debt');
  await form.getByRole('button',{name:'Save debt details',exact:true}).click();await expect(app.getByText('Priority 1 · Retry debt',{exact:true})).toBeVisible();
  expect(requests.filter(r=>r.action==='save_payoff_plan').map(r=>r.debts[0].id)).toEqual([firstId,firstId]);expect(state.payoffPlan.debts).toHaveLength(1);
});


const nativeMailProgress=()=>({nextStep:{waypointId:'mail',owner:'client'},waypoints:[
  {id:'ongoing',key:'no_new_credit',title:'Keep current credit habits',owner:'client',state:'not_started',closedBy:'ongoing',verifyKind:'no_new_credit'},
  {id:'mail',key:'blueprint_dispute_mail_letters',title:'Print and mail your dispute letters',detail:'Print the letters.',owner:'client',state:'not_started'},
  {id:'receipt',key:'blueprint_dispute_mail_receipt',title:'Upload your mailing receipt',owner:'client',state:'not_started'}]});
const currentLetterFile=()=>({id:DOCUMENT,title:'Your saved inquiry letter',subtype:'funding_inquiry_removal',metadata:{bureau:'EX'},generated_at:'2026-11-02T12:00:00Z',version_id:RESPONSE_VERSION,version_storage_key:'offline-current-letter',version_checksum:'sha256:'+'a'.repeat(64),version_mime_type:'application/pdf',version_byte_size:120});
test('new buyer without current letter files gets honest useful preparation instead of an impossible mail step',async({page})=>{
  const nativeProgress=nativeMailProgress();const saved=structuredClone(nativeProgress);
  const{app,requests,mailRequests}=await open(page,{started:true,nativeProgress,clientName:null});
  await expect(app.getByRole('heading',{name:'Your next steps.',exact:true})).toBeVisible();
  const next=app.locator('.bj-next');await expect(next).toContainText('Your current letter pack is not ready yet');
  await expect(next).not.toContainText('Print and mail your dispute letters');await expect(next).not.toContainText('Upload your mailing receipt');
  await expect(next.getByRole('link',{name:'Open this step →'})).toHaveCount(0);
  await next.getByRole('button',{name:'Prepare businesses',exact:true}).click();await expect(app.getByRole('button',{name:'Add a business plan',exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Today',exact:true}).click();await app.locator('.bj-next').getByRole('button',{name:'Check my letters',exact:true}).click();
  await expect(app).toContainText('No current generated letters are available here yet');
  expect(requests).toHaveLength(0);expect(mailRequests).toHaveLength(0);expect(nativeProgress).toEqual(saved);
});
test('only current usable funding letters turn the native mail action into the actual letter workspace',async({page})=>{
  const file=currentLetterFile();const{app,mailRequests}=await open(page,{started:true,nativeProgress:nativeMailProgress(),letterFiles:[file],mailing:{letters:[{documentId:DOCUMENT,title:file.title,subtype:file.subtype,bureau:'EX',generatedAt:file.generated_at,eligibleForMailing:true}],orders:[],capabilities:{mailSupported:true}}});
  const next=app.locator('.bj-next');await expect(next).toContainText('Review and mail your current letters');await expect(next).not.toContainText('not ready yet');
  await next.getByRole('button',{name:'Open my letters',exact:true}).click();await expect(app.getByRole('button',{name:'Download letter',exact:true})).toBeVisible();
  await expect(app.getByRole('button',{name:'Mail these letters for me · $97',exact:true})).toBeVisible();expect(mailRequests).toHaveLength(0);
});
test('a saved mailing request opens status even when letter files are no longer available',async({page})=>{
  const{app,mailRequests}=await open(page,{started:true,nativeProgress:nativeMailProgress(),mailing:{letters:[],orders:[{id:ORDER,status:'mailed',totalCents:9700,envelopes:[]}],capabilities:{mailSupported:false}}});
  const next=app.locator('.bj-next');await expect(next).toContainText('Review your mailing request');await expect(next).not.toContainText('Print and mail');
  await next.getByRole('button',{name:'Open letters and mailing status',exact:true}).click();await expect(app).toContainText('$97.00 · Submitted for mailing');expect(mailRequests).toHaveLength(0);
});

function principalFixture(){return{token:'offline-principal-a',accountId:ACCOUNT,clientId:CLIENT,signedOut:false};}
function requestBarrier(){
  let arrive,release,finish;const arrived=new Promise(r=>{arrive=r;}),released=new Promise(r=>{release=r;}),finished=new Promise(r=>{finish=r;});
  return{arrived,release,finished,finish,wait:async()=>{arrive();await released;}};
}
async function changePrincipal(page,auth,mode){
  if(mode==='switch'){auth.clientId=OTHER_CLIENT;auth.accountId=OTHER_ACCOUNT;auth.token='offline-principal-b';}
  else{auth.signedOut=true;auth.token=null;}
  // A real second document changes storage, so the browser emits its own event.
  // The fixture-only static server has no API or customer account behind it.
  const sibling=await page.context().newPage();
  await sibling.goto('/__blueprint-principal-storage-fixture__');
  await sibling.evaluate(token=>token===null?localStorage.removeItem('fh_token'):localStorage.setItem('fh_token',token),auth.token);
  await sibling.close();
}
async function expectPrivateWorkspaceCleared(page,app){
  await expect(app).toBeHidden();await expect(app).toBeEmpty();
  await expect(page.locator('body')).not.toHaveAttribute('data-blueprint-plan','active');
  await expect(page.locator('body')).not.toContainText('AveryPrivate');
  await expect(app.locator('input,textarea,a[href],form')).toHaveCount(0);
}
async function finishBarrier(page,gate){gate.release();await gate.finished;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));}
const countPlanReads=log=>log.filter(r=>r.path==='/api/blueprint/plan'&&r.method==='GET').length;
const oldAccountOnly=log=>expect(log.filter(r=>r.path.startsWith('/api/blueprint/')||['/api/documents-upload','/api/documents-download'].includes(r.path)).every(r=>r.authorization==='Bearer offline-principal-a')).toBe(true);

for(const mode of['switch','logout']){
  test(`session principal ${mode}: delayed initial read cannot reveal the old buyer`,async({page})=>{
    const auth=principalFixture(),gate=requestBarrier();
    const{app,httpRequests}=await open(page,{authControl:auth,clientName:'AveryPrivate',requestGates:{'GET /api/blueprint/plan':gate}});
    await gate.arrived;await changePrincipal(page,auth,mode);await expectPrivateWorkspaceCleared(page,app);
    await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: delayed refresh scrubs existing private state and cannot restore it`,async({page},testInfo)=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates,mailing:savedLetters()});
    await expect(app).toContainText('AveryPrivate');await openLetters(app);
    const gate=requestBarrier();gates['GET /api/blueprint/plan']=gate;
    await app.getByRole('button',{name:'Refresh letters and reviews',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await expectPrivateWorkspaceCleared(page,app);
    await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);oldAccountOnly(httpRequests);
    await testInfo.attach(`session-${mode}-private-workspace-cleared`,{body:await page.screenshot(),contentType:'image/png'});
  });
  test(`session principal ${mode}: a pending save cannot continue with a new account token`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates});
    await openBusiness(app);await app.locator('input[name=name]').fill('AveryPrivate draft');
    const before=countPlanReads(httpRequests),gate=requestBarrier();gates['POST /api/blueprint/business-plans:save_business']=gate;
    await app.getByRole('button',{name:'Save business plan',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await expectPrivateWorkspaceCleared(page,app);
    await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);
    expect(countPlanReads(httpRequests)).toBe(before);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: save then delayed reread cannot publish the old private result`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates});
    await openBusiness(app);await app.locator('input[name=name]').fill('AveryPrivate saved result');
    const gate=requestBarrier();gates['GET /api/blueprint/plan']=gate;
    await app.getByRole('button',{name:'Save business plan',exact:true}).click();await gate.arrived;
    expect(httpRequests.some(r=>r.action==='save_business')).toBe(true);
    await changePrincipal(page,auth,mode);await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: stored upload cannot attach or reread under the changed session`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates});
    await openBusiness(app);const form=app.locator('form[data-kind=formation]');
    await form.locator('input[type=file]').setInputFiles({name:'AveryPrivate-formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nprincipal fixture')});
    const before=countPlanReads(httpRequests),gate=requestBarrier();gates['POST /api/documents-upload']=gate;
    await form.getByRole('button',{name:'Upload formation document',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);
    expect(httpRequests.filter(r=>r.action==='attach_evidence')).toHaveLength(0);expect(countPlanReads(httpRequests)).toBe(before);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: bureau upload cannot start another read or display the old reply`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates,mailing:savedLetters(false)});
    await openLetters(app);const form=app.locator('form[data-bp-form=bureau-response]');
    await form.locator('input[name=files]').setInputFiles({name:'AveryPrivate-response.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nprincipal reply fixture')});
    const before=countPlanReads(httpRequests),gate=requestBarrier();gates['POST /api/documents-upload']=gate;
    await form.getByRole('button',{name:'Upload response for validation',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);
    expect(countPlanReads(httpRequests)).toBe(before);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: late mailing quote cannot expose return address or payment controls`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates,mailing:savedLetters()});
    await openLetters(app);const gate=requestBarrier();gates['POST /api/blueprint/letter-mailing:quote']=gate;
    await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);
    await expect(page.locator('body')).not.toContainText('1 Offline Fixture Way');expect(httpRequests.filter(r=>r.action==='confirm')).toHaveLength(0);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: late authorized confirmation cannot reveal a checkout for the old buyer`,async({page})=>{
    const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates,mailing:savedLetters()});
    await openLetters(app);await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();
    const form=app.locator('form[data-bp-form=mail-confirm]');await form.locator('input[name=authorization]').check();
    const gate=requestBarrier();gates['POST /api/blueprint/letter-mailing:confirm']=gate;
    await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();await gate.arrived;
    await changePrincipal(page,auth,mode);await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);
    await expect(page.locator('a[href*="offline-checkout.example"]')).toHaveCount(0);
    expect(httpRequests.filter(r=>r.action==='confirm')).toHaveLength(1);oldAccountOnly(httpRequests);
  });
  test(`session principal ${mode}: delayed private document cannot navigate its pending blank window`,async({page,context})=>{
    const auth=principalFixture(),gates={},navigations=[];await context.route('**/api/documents/'+DOCUMENT+'?*',route=>{navigations.push(route.request().url());return route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\nprivate navigation fixture')});});
    const b=record();b.evidence.formation={documentId:DOCUMENT,status:'evidence_received'};
    const{app,httpRequests}=await open(page,{started:true,clientName:'AveryPrivate',authControl:auth,requestGates:gates,seed:{businesses:[b]}});await openBusiness(app);
    const gate=requestBarrier();gates['GET /api/documents-download']=gate;const popupPromise=page.waitForEvent('popup');
    await app.getByRole('button',{name:'Open saved document',exact:true}).click();const popup=await popupPromise;await gate.arrived;expect(popup.url()).toBe('about:blank');
    await changePrincipal(page,auth,mode);await expect.poll(()=>popup.isClosed()).toBe(true);
    await finishBarrier(page,gate);await expectPrivateWorkspaceCleared(page,app);expect(navigations).toHaveLength(0);oldAccountOnly(httpRequests);
  });
}

test('session principal stable account: delayed read and save continuation retain the original identity',async({page})=>{
  const auth=principalFixture(),gate=requestBarrier(),gates={'GET /api/blueprint/plan':gate};
  const{app,httpRequests}=await open(page,{started:true,business:true,authControl:auth,requestGates:gates,clientName:'AveryPrivate'});
  await gate.arrived;await finishBarrier(page,gate);delete gates['GET /api/blueprint/plan'];
  await expect(app).toContainText('AveryPrivate');await openBusiness(app);await app.locator('input[name=name]').fill('Stable account business');
  const saveGate=requestBarrier();gates['POST /api/blueprint/business-plans:save_business']=saveGate;
  await app.getByRole('button',{name:'Save business plan',exact:true}).click();await saveGate.arrived;await finishBarrier(page,saveGate);
  await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();await expect(app.locator('input[name=name]')).toHaveValue('Stable account business');
  expect(countPlanReads(httpRequests)).toBe(2);oldAccountOnly(httpRequests);
});
test('session principal stable account: upload attachment and reread retain the original identity',async({page})=>{
  const auth=principalFixture(),gates={};const{app,httpRequests,uploadCount}=await open(page,{started:true,business:true,authControl:auth,requestGates:gates});await openBusiness(app);
  const form=app.locator('form[data-kind=formation]');await form.locator('input[type=file]').setInputFiles({name:'stable-formation.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nstable principal fixture')});
  const gate=requestBarrier();gates['POST /api/documents-upload']=gate;await form.getByRole('button',{name:'Upload formation document',exact:true}).click();await gate.arrived;await finishBarrier(page,gate);
  await expect(app.getByText('Evidence received',{exact:true})).toBeVisible();expect(uploadCount()).toBe(1);expect(httpRequests.filter(r=>r.action==='attach_evidence')).toHaveLength(1);expect(countPlanReads(httpRequests)).toBe(2);oldAccountOnly(httpRequests);
});
test('session principal stable account: quote and authorized payment result stay usable without duplicate confirmation',async({page})=>{
  const auth=principalFixture(),gates={};const{app,httpRequests}=await open(page,{started:true,authControl:auth,requestGates:gates,mailing:savedLetters()});await openLetters(app);
  const gate=requestBarrier();gates['POST /api/blueprint/letter-mailing:quote']=gate;await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();await gate.arrived;await finishBarrier(page,gate);
  const form=app.locator('form[data-bp-form=mail-confirm]');await expect(form).toBeVisible();await form.locator('input[name=authorization]').check();
  await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();await expect(app.getByRole('link',{name:'Continue secure payment',exact:true})).toHaveAttribute('href','https://offline-checkout.example/order/'+ORDER);
  expect(httpRequests.filter(r=>r.action==='confirm')).toHaveLength(1);oldAccountOnly(httpRequests);
});
test('session principal stable account: delayed signed document opens only its authenticated saved URL',async({page,context},testInfo)=>{
  const auth=principalFixture(),gates={},pdf=Buffer.from('%PDF-1.4\nstable document fixture');await context.route('**/api/documents/'+DOCUMENT+'?*',route=>route.fulfill({status:200,contentType:'application/pdf',body:pdf}));
  const b=record();b.evidence.formation={documentId:DOCUMENT,status:'evidence_received'};const{app,httpRequests}=await open(page,{started:true,authControl:auth,requestGates:gates,seed:{businesses:[b]}});await openBusiness(app);
  const gate=requestBarrier();gates['GET /api/documents-download']=gate;const delivery=observePdfDelivery(page,context,pdf),popupPromise=page.waitForEvent('popup');await app.getByRole('button',{name:'Open saved document',exact:true}).click();const popup=await popupPromise;await gate.arrived;
  expect(popup.url()).toBe('about:blank');await finishBarrier(page,gate);await delivery(popup,testInfo);oldAccountOnly(httpRequests);if(!popup.isClosed())await popup.close();
});

async function setHttpOnlySession(context,baseURL,value){
  await context.addCookies([{name:'fundhub_session',value,url:baseURL,httpOnly:true,sameSite:'Lax'}]);
}
test('session principal cookie-only switch: no captured bearer means no private buyer state or save under cookie B',async({page,context,baseURL})=>{
  await setHttpOnlySession(context,baseURL,'offline-cookie-a');
  const auth={...principalFixture(),token:null};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth});
  await expectPrivateWorkspaceCleared(page,app);expect(await page.evaluate(()=>document.cookie.includes('fundhub_session'))).toBe(false);
  await expect(page.locator('a[href="/portal-login.html"]:visible')).toHaveCount(1);
  auth.clientId=OTHER_CLIENT;auth.accountId=OTHER_ACCOUNT;await setHttpOnlySession(context,baseURL,'offline-cookie-b');
  await page.bringToFront();await expectPrivateWorkspaceCleared(page,app);
  await expect(page.getByRole('button',{name:'Save business plan',exact:true})).toHaveCount(0);
  expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);
  expect(httpRequests.filter(r=>r.path==='/api/blueprint/business-plans'&&r.method==='POST')).toHaveLength(0);
});
test('session principal cookie-only logout: absent bearer never opens a private workspace or continues a request',async({page,context,baseURL})=>{
  await setHttpOnlySession(context,baseURL,'offline-cookie-a');
  const auth={...principalFixture(),token:null};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth});
  await expectPrivateWorkspaceCleared(page,app);auth.signedOut=true;await context.clearCookies();await page.bringToFront();
  await expectPrivateWorkspaceCleared(page,app);await expect(page.locator('a[href="/portal-login.html"]:visible')).toHaveCount(1);
  expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/')||r.path==='/api/documents-upload'||r.path==='/api/documents-download')).toHaveLength(0);
  await page.getByRole('link',{name:'Sign in to your portal',exact:true}).click();
  await expect(page).toHaveURL(new URL('/portal-login.html',baseURL).href);await expect(page.locator('#email')).toBeVisible();
});
test('session principal demo token cannot authorize a private cookie-backed Blueprint workspace',async({page,context,baseURL})=>{
  await setHttpOnlySession(context,baseURL,'offline-cookie-a');
  const auth={...principalFixture(),token:'demo'};const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth});
  await expectPrivateWorkspaceCleared(page,app);await expect(page.locator('a[href="/portal-login.html"]:visible')).toHaveCount(1);
  expect(httpRequests.filter(r=>r.path.startsWith('/api/blueprint/'))).toHaveLength(0);
});
test('session principal captured bearer stays bound to its actual projection when an opaque cookie changes',async({page,context,baseURL})=>{
  await setHttpOnlySession(context,baseURL,'offline-cookie-a');
  const auth=principalFixture();const{app,httpRequests}=await open(page,{started:true,business:true,clientName:'AveryPrivate',authControl:auth});
  await expect(app).toContainText('AveryPrivate');expect(await page.evaluate(()=>document.cookie.includes('fundhub_session'))).toBe(false);
  // A real explicit bearer continues to resolve A even when a different
  // HttpOnly cookie is present; it must never silently become cookie B.
  await setHttpOnlySession(context,baseURL,'offline-cookie-b');await openBusiness(app);
  await app.locator('input[name=name]').fill('Bearer-bound business');await app.getByRole('button',{name:'Save business plan',exact:true}).click();
  await expect(app.getByText('Saved to your client file.',{exact:true})).toBeVisible();await expect(app.locator('input[name=name]')).toHaveValue('Bearer-bound business');
  expect(httpRequests.filter(r=>r.action==='save_business')).toHaveLength(1);expect(countPlanReads(httpRequests)).toBe(2);oldAccountOnly(httpRequests);
});
