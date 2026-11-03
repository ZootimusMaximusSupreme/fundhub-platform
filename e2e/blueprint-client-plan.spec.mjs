import { test, expect } from '@playwright/test';
import { preparationGuidance, websitePrompt } from '../src/blueprint/preparation-guidance.mjs';
const CLIENT='20000000-0000-4000-8000-000000000002';
const ORG='10000000-0000-4000-8000-000000000001';
const PLAN='40000000-0000-4000-8000-000000000004';
const SECOND_PLAN='60000000-0000-4000-8000-000000000006';
const DOCUMENT='50000000-0000-4000-8000-000000000005';
const EXISTING_BUSINESS='70000000-0000-4000-8000-000000000007';
const json=(route,body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
function initial(started=false){return{orgId:ORG,clientId:CLIENT,targetBusinessCount:3,setupStep:0,startedAt:started?'2026-11-02T12:00:00Z':null,hasExistingBusiness:null,homeState:started?'AZ':null,postalCode:started?'85004':null,availableCashCents:null,monthlyIncomeCents:null,businesses:[],existingBusinesses:[],stepProgress:[],businessPreparation:{}};}
function record(){return{id:PLAN,name:'Cedar Grove LLC',activity:'Web design for local shops',formationState:'AZ',formationStatus:'planned',formationDate:null,ownershipSince:null,operatingSince:null,evidence:{formation:{status:'not_added'},ein:{status:'not_added'}},bankPreparation:{documentsReady:false,accountOpeningIssue:false,relationships:[]}};}
async function open(page,{started=false,business=false,denied=false,failSave=false,failSaveOnce=false,failUpload=false,failAttachOnce=false,seed={},nativeProgress=null}={}){
  const state={...initial(started),...structuredClone(seed)};if(business&&!state.businesses.length)state.businesses=[record()];
  const requests=[],downloads=[];let uploads=0,saveFailed=false,attachFailed=false;
  const savedProgress=nativeProgress||{waypoints:[{id:'w1',title:'Review the balances on your file',detail:'Compare each reported balance with your own records.',state:'not_started',owner:'client'}],nextStep:{waypointId:'w1',owner:'client'}};
  function payload(){return{ok:true,client:{id:CLIENT,name:'Pat Buyer'},businessPlans:structuredClone(state),progress:structuredClone(savedProgress),lessons:preparationGuidance({homeState:state.homeState,postalCode:state.postalCode}),businessLessons:state.businesses.map(b=>({planId:b.id,lessons:preparationGuidance({business:b})})),websitePrompts:state.businesses.map(b=>({planId:b.id,prompt:websitePrompt(b)})),localBanks:{source:{name:'Official directory',asOf:'2026-06'},candidates:[]},bankPlan:null};}
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
    if(path==='/api/auth/session')return json(route,{ok:true,principal:'client',staff:{id:CLIENT,client_id:CLIENT,role:'client',name:'Pat Buyer',status:'active'}});
    if(path==='/api/blueprint/plan')return denied?json(route,{ok:false,error:'blueprint_access_inactive'},403):json(route,payload());
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
      if(body.action==='save_step'){const{action,...step}=body;state.stepProgress=state.stepProgress.filter(p=>p.stepKey!==step.stepKey||(p.businessPlanId||null)!==(step.businessPlanId||null));state.stepProgress.push(step);}
      if(body.action==='attach_evidence'){
        if(failAttachOnce&&!attachFailed){attachFailed=true;return json(route,{ok:false,message:'The attachment service is temporarily unavailable.'},500);}
        state.businesses.find(b=>b.id===body.businessId).evidence[body.kind]={documentId:body.documentId,status:'evidence_received'};
      }
      return json(route,{ok:true,...structuredClone(state)});
    }
    if(path==='/api/documents-upload'){
      expect(route.request().headers()['content-type']).toContain('multipart/form-data; boundary=');uploads++;
      return failUpload?json(route,{ok:false,message:'The file could not be stored.'},500):json(route,{ok:true,documents:[{id:DOCUMENT}]});
    }
    if(path==='/api/documents-download'){
      downloads.push({id:url.searchParams.get('id'),authorization:route.request().headers().authorization});
      return json(route,{ok:true,document:{id:DOCUMENT,download:'/api/documents/'+DOCUMENT+'?exp=2000000000&sig=offline-fixture-signature'}});
    }
    if(path==='/api/chat/portal-message'&&method==='POST'){requests.push({chat:route.request().postDataJSON()});return json(route,{ok:true,message:{id:'message-browser-contract'}});}
    if(path.includes('portal-summary'))return json(route,{ok:true,documents:[],scores:{},soft_pull_complete:false,dispute_consent:{allowed:false},stage:{key:'paid'},upcoming_call:null});
    if(path.includes('read/entitlements'))return json(route,{ok:true,items:[]});
    return json(route,{ok:true,items:[],rows:[],documents:[],payments:[]});
  });
  await page.goto('/app/client-portal.html');
  const app=page.locator('#blueprint-plan');if(!denied)await expect(app).toBeVisible();
  return{app,state,requests,downloads,wasUploaded:()=>uploads>0,uploadCount:()=>uploads};
}

test('paid buyer starts one question at a time and server state survives reload',async({page})=>{
  const{app,state,requests}=await open(page);await app.getByRole('button',{name:'Start my plan',exact:true}).click();await expect(app.getByText('Do you already own a business?',{exact:true})).toBeVisible();
  await app.getByText('No, I’m preparing my first business',{exact:true}).click();await app.getByRole('button',{name:'Save and continue'}).click();await expect(app.getByText('How many businesses are we preparing?',{exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Save and continue'}).click();await app.locator('select[name=homeState]').selectOption('AZ');await app.locator('input[name=postalCode]').fill('85004');await app.getByRole('button',{name:'Build my plan',exact:true}).click();
  await expect(app.getByText('Review the balances on your file',{exact:true})).toBeVisible();expect(state.startedAt).toBeTruthy();expect(requests.every(r=>!('client_id'in r)&&!('org_id'in r))).toBeTruthy();
  await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('fundhub-blueprint'))localStorage.removeItem(key);});await page.reload();await expect(app.getByText('Review the balances on your file',{exact:true})).toBeVisible();
});
test('nonbuyer gets no paid plan controls',async({page})=>{const{app}=await open(page,{denied:true});await expect(app).toBeHidden();});
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
  const{app,state}=await open(page,{started:true});await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();await app.locator('[data-key=credit_review]').click();await app.locator('input[name=targetDate]').fill('2027-02-01');await app.locator('select[name=status]').selectOption('in_progress');await app.getByRole('button',{name:'Save this step',exact:true}).click();expect(state.stepProgress).toHaveLength(1);await app.getByRole('button',{name:'Timeline',exact:true}).click();const link=app.getByRole('link',{name:/Add to Google Calendar/});await expect(link).toHaveAttribute('href',/calendar\.google\.com\/calendar\/render/);expect(new URL(await link.getAttribute('href')).searchParams.get('dates')).toBe('20270201/20270202');
});
for(const width of[1440,390])test(`real buyer controls fit at ${width}px`,async({page})=>{await page.setViewportSize({width,height:1000});const{app}=await open(page,{started:true,business:true});for(const name of['Businesses','Step-by-step help','Timeline','Get help','Today']){await app.getByRole('button',{name,exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);}await expect(app).toContainText('FinanceOS is not live yet.');});

async function openBusiness(app){
  await app.getByRole('button',{name:'Businesses',exact:true}).click();
  await app.getByRole('button',{name:'Open this business',exact:true}).first().click();
}

test('saved document action obtains an authenticated signed URL from documents-download',async({page,context})=>{
  await page.addInitScript(()=>localStorage.setItem('fh_token','offline-fixture-token'));
  await context.route('**/api/documents/'+DOCUMENT+'?*',route=>route.fulfill({status:200,contentType:'application/pdf',body:Buffer.from('%PDF-1.4\noffline browser fixture')}));
  const b=record();b.evidence.formation={documentId:DOCUMENT,status:'evidence_received'};
  const{app,downloads}=await open(page,{started:true,seed:{businesses:[b]}});
  await openBusiness(app);
  const popupPromise=page.waitForEvent('popup');
  await app.getByRole('button',{name:'Open saved document',exact:true}).click();
  const popup=await popupPromise;
  await expect.poll(()=>downloads.length).toBe(1);
  expect(downloads[0]).toEqual({id:DOCUMENT,authorization:'Bearer offline-fixture-token'});
  await expect(popup).toHaveURL(new RegExp('/api/documents/'+DOCUMENT+'\\?exp=2000000000&sig=offline-fixture-signature'));
  await popup.close();
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
  const next=app.locator('.bp-next');await expect(next).toContainText('Upload the accepted formation record');await expect(next).toContainText('Use the actual saved document');await expect(next).not.toContainText('Keep the ongoing credit rule');await expect(next).not.toContainText('Previously skipped task');
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
