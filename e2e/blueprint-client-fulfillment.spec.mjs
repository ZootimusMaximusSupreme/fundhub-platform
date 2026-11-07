import { test, expect } from '@playwright/test';
import { json } from './harness.mjs';
import { shapeDocument } from '../src/documents/retrieve.mjs';

const ORG = '10000000-0000-4000-8000-000000000001';
const CLIENT = '10000000-0000-4000-8000-000000000002';
const ACCOUNT = '10000000-0000-4000-8000-000000000003';
const ENGAGEMENT = '10000000-0000-4000-8000-000000000004';
const CASE = '10000000-0000-4000-8000-000000000005';
const LENDER = '10000000-0000-4000-8000-000000000006';
const DOCUMENT = '10000000-0000-4000-8000-000000000007';
const APPLICATION = '10000000-0000-4000-8000-000000000008';
const SIGNED_DOCUMENT = shapeDocument({id:DOCUMENT,current_version_id:null},{signing:{secret:'synthetic-browser-document-signer',ttlSeconds:120}}).download;

async function open(page, { completed = false, denied = false, failInquiries = false, documentDownload = SIGNED_DOCUMENT, documentStatus = 200, onDocument = null, lenderUrl = 'https://bank.example.invalid/apply', onLender = null } = {}) {
  const writes = [];
  const engagement = {id:ENGAGEMENT,orgId:ORG,clientId:CLIENT,status:completed ? 'completed' : 'active',executionOwner:'client',roundId:null};
  const funding = {ok:true,engagement,state:completed ? 'completed' : 'held',nextAction:'Wait for Experian removal verification before opening this bank.',lenders:[{id:LENDER,name:'Fixture Community Bank',productName:'Business card',available:false,reason:'Experian is waiting for verification.',nextEligibleAt:'2026-11-09T12:00:00Z'}],applications:[]};
  const inquiries = {ok:true,cases:[{id:CASE,bureau:'Experian',status:'In progress',packet:{complete:true,missing:[]},portalUrl:'https://www.experian.com/help/dispute-credit/',documentUploadUrl:'https://www.experian.com/consumer/upload/',nextCheckAt:'2026-11-09T12:00:00Z',call:{status:'not_requested'},inquiries:[{id:'inquiry',name:'Fixture Bank inquiry',state:'pending_verification'}],documents:[],actions:{canRecordSubmission:!completed,canLaunchCall:!completed,canCheckSavedEvidence:!completed}}]};
  const repair = {ok:true,program:null,authorization:{signed:true,packetComplete:true,missing:[]},stage:'ready',cases:[{bureau:'Experian',round:'R1',status:'ready',portalUrl:inquiries.cases[0].portalUrl,documentUploadUrl:inquiries.cases[0].documentUploadUrl,items:[],letters:[]}],actions:{canGenerate:true}};
  inquiries.cases[0].documents = [{id:DOCUMENT,title:'Open saved case letter'}];
  const services = {ok:true,engagement,allowance:{includedAvailable:!completed,nextIncludedAt:'2026-12-06T12:00:00Z',pendingRequestId:null},checkoutProviders:[{id:'commas',label:'Pay in full'},{id:'whop',label:'Financing through Whop'}],serviceTypes:[{key:'funding_round',label:'Funding takeover',priceCents:null,requiresQuote:true}],requests:[],capabilities:{requestHelp:!completed,requestReport:!completed,quote:false}};
  await page.addInitScript(() => localStorage.setItem('fh_token','full-blueprint-browser-fixture'));
  await page.context().route('https://bank.example.invalid/**',route => route.fulfill({contentType:'text/html',body:'<h1>Fixture bank application</h1>'}));
  await page.context().route('**/api/documents/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic signed case document</h1>'}));
  await page.route('**/api/**',async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === '/api/auth/session') return json(route,{ok:true,principal:'client',staff:{id:ACCOUNT,org_id:ORG,client_id:CLIENT,role:'client',name:'Fixture buyer'}});
    if (path === '/api/blueprint/plan') return json(route,{ok:false,error:'fixture_prep_not_loaded'},403);
    if (path === '/api/blueprint/funding' && method === 'GET') return denied ? json(route,{ok:false,error:'full_blueprint_required'},403) : json(route,structuredClone(funding));
    if (path === '/api/blueprint/inquiries' && method === 'GET') return failInquiries ? json(route,{ok:false,message:'Bureau evidence is temporarily unavailable.'},503) : json(route,structuredClone(inquiries));
    if (path === '/api/blueprint/services' && method === 'GET') return json(route,structuredClone(services));
    if (path === '/api/blueprint/repair' && method === 'GET') return json(route,structuredClone(repair));
    if (path === '/api/documents-upload') return json(route,{ok:true,documents:[{id:DOCUMENT}]});
    if (path === '/api/documents-download') {
      if (onDocument) await onDocument();
      return documentStatus === 200 ? json(route,{ok:true,document:{id:DOCUMENT,download:documentDownload}}) : json(route,{ok:false,message:'The saved document is not available.'},documentStatus);
    }
    if (path.startsWith('/api/documents/')) return route.fulfill({contentType:'text/html',body:'<h1>Synthetic signed case document</h1>'});
    if (method === 'POST' && path.startsWith('/api/blueprint/')) {
      const body = route.request().postDataJSON();
      writes.push({path,body});
      if (body.action === 'record_submission') {
        inquiries.cases[0].submissionReference = body.reference;
        return json(route,{ok:true});
      }
      if (body.action === 'launch_call') {
        expect(body.authorization).toBe(true);
        inquiries.cases[0].call.status = 'sent';
        inquiries.cases[0].actions.canLaunchCall = false;
        return json(route,{ok:true});
      }
      if (body.action === 'check_evidence') {
        inquiries.cases[0].inquiries[0].state = 'removed_verified';
        inquiries.cases[0].actions = {canRecordSubmission:false,canLaunchCall:false,canCheckSavedEvidence:true};
        funding.state = 'ready';
        funding.nextAction = 'Your saved file permits Fixture Community Bank.';
        funding.lenders[0].available = true;
        funding.lenders[0].reason = 'The required bureau result is verified.';
        return json(route,{ok:true});
      }
      if (body.action === 'open_lender') {
        expect(funding.state).toBe('ready');
        if (onLender) await onLender();
        funding.applications = [{id:APPLICATION,lenderName:'Fixture Community Bank',status:'Apply',reportedStatus:null}];
        return json(route,{ok:true,url:lenderUrl,applicationId:APPLICATION});
      }
      if (body.action === 'report_application') {
        funding.applications[0].reportedStatus = body.status;
        funding.state = 'awaiting_response';
        funding.lenders[0].available = false;
        return json(route,{ok:true});
      }
      if (body.action === 'request_help') {
        services.requests = [{id:'service',serviceKind:'funding_round',status:'requested',priceCents:null,note:body.note}];
        return json(route,{ok:true});
      }
      if (body.action === 'request_report') {
        services.allowance.includedAvailable = false;
        services.allowance.pendingRequestId = 'report';
        return json(route,{ok:true,requiresPayment:false});
      }
      if (body.action === 'checkout') {
        expect(body.authorization).toBe(true);
        expect(body.expectedPriceCents).toBe(2200000);
        expect(body.provider).toBe('whop');
        expect(body).not.toHaveProperty('idempotencyKey');
        services.requests[0].checkoutUrl = 'https://checkout.example.invalid/saved-order';
        return json(route,{ok:true});
      }
      return json(route,{ok:true});
    }
    return json(route,{ok:true,items:[],documents:[],scores:{},entitlements:[]});
  });
  await page.goto('/app/client-portal.html');
  const app = page.locator('#blueprint-fulfillment');
  if (!denied) await expect(app).toBeVisible();
  return {app,writes,funding,inquiries,services};
}

for (const width of [1440,390]) test(`owned bureau verification gates direct bank handoff at ${width}px`,async({page}) => {
  await page.setViewportSize({width,height:900});
  const {app,writes} = await open(page);
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  await expect(app.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await expect(app.getByRole('checkbox',{name:/removed|verified|completed/i})).toHaveCount(0);
  await app.getByRole('button',{name:'Check saved bureau evidence'}).click();
  await expect(app.getByText('Removal verified',{exact:false})).toBeVisible();
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  const popupPromise = page.waitForEvent('popup');
  await app.getByRole('button',{name:'Open bank application'}).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL('https://bank.example.invalid/apply');
  await popup.close();
  await app.getByText('Report a bank response',{exact:true}).click();
  await app.locator('input[name=reference]').fill('BANK-RECEIPT-42');
  await app.getByRole('button',{name:'Save bank response'}).click();
  await expect(app.getByText(/Your report: pending/)).toBeVisible();
  await expect(app.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
  expect(writes.every(w => !('client_id' in w.body) && !('org_id' in w.body))).toBe(true);
  expect(writes.some(w => /clear|verify_funded/.test(w.body.action))).toBe(false);
  const dimensions = await app.evaluate(el => ({scroll:el.scrollWidth,width:el.clientWidth}));
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width + 1);
});

for (const width of [1440,390]) test(`inquiry and repair expose separate dispute and supporting-upload destinations at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const {app,writes}=await open(page);
  for (const tab of ['Inquiry removal','Credit repair']) {
    await app.getByRole('button',{name:tab,exact:true}).click();
    await expect(app.getByRole('link',{name:'Open Experian portal ↗',exact:true})).toHaveAttribute('href','https://www.experian.com/help/dispute-credit/');
    await expect(app.getByRole('link',{name:'Upload documents for a pending Experian request ↗',exact:true})).toHaveAttribute('href','https://www.experian.com/consumer/upload/');
    await expect(app.getByText('Use the portal to start or manage a dispute. Document upload adds files to a request already open.')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(writes).toEqual([]);
});

test('submission receipts stay pending and bureau calls require explicit authorization',async({page}) => {
  const {app,writes} = await open(page);
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await app.getByText('Save my dispute submission',{exact:true}).click();
  await app.locator('input[name=reference]').fill('EX-PORTAL-42');
  await app.locator('input[name=receipt]').setInputFiles({name:'portal-receipt.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 fixture receipt')});
  await app.getByRole('button',{name:'Save submission receipt'}).click();
  await expect(app.getByText(/Waiting for verification/)).toBeVisible();
  await app.getByRole('button',{name:'Call bureau with my AI agent'}).click();
  expect(writes.filter(w => w.body.action === 'launch_call')).toHaveLength(0);
  await app.getByRole('checkbox',{name:/I authorize my AI agent/}).check();
  await app.getByRole('button',{name:'Call bureau with my AI agent'}).click();
  await expect(app.getByText('Call placed',{exact:true})).toBeVisible();
  expect(writes.filter(w => w.body.action === 'launch_call')).toHaveLength(1);
});

test('paid help requires accepting its exact quote and monthly request becomes pending',async({page}) => {
  const {app,services,writes} = await open(page);
  await app.getByRole('button',{name:'Reports and help',exact:true}).click();
  await app.getByRole('button',{name:'Request included report'}).click();
  await expect(app.getByText('A report request is already in progress.')).toBeVisible();
  await app.getByLabel('Tell the team which step needs help').fill('Please run the remaining funding steps.');
  const helpSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/blueprint/services' && response.request().method() === 'POST' && response.request().postDataJSON().action === 'request_help');
  await app.getByRole('button',{name:'Request help and pricing'}).click();
  expect((await helpSaved).ok()).toBe(true);
  await expect(app.getByText('Waiting for a quote',{exact:true})).toBeVisible();
  services.requests[0].status = 'quoted'; services.requests[0].priceCents = 2200000;
  await app.getByRole('button',{name:'Refresh',exact:true}).click();
  await app.getByRole('button',{name:'Review payment options'}).click();
  expect(writes.filter(w => w.body.action === 'checkout')).toHaveLength(0);
  await app.getByRole('combobox',{name:'Payment option',exact:true}).selectOption('whop');
  await app.getByRole('checkbox',{name:'I accept this service quote for $22,000.00.'}).check();
  await app.getByRole('button',{name:'Review payment options'}).click();
  await expect(app.getByRole('link',{name:'Review checkout ↗'})).toHaveAttribute('href','https://checkout.example.invalid/saved-order');
});

test('completed round is read-only and changing accounts clears the private workspace',async({page}) => {
  const {app} = await open(page,{completed:true});
  await expect(app.getByText('Your purchased funding round is complete',{exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  await expect(app.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
  await page.evaluate(() => {localStorage.setItem('fh_token','different-account');window.dispatchEvent(new Event('focus'));});
  await expect(app.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  await expect(app.getByText('Fixture Community Bank')).toHaveCount(0);
});

test('completed engagement does not offer new bureau submissions',async({page})=>{
  const {app,writes}=await open(page,{completed:true});
  for(const tab of ['Inquiry removal','Credit repair']) {
    await app.getByRole('button',{name:tab,exact:true}).click();
    await expect(app.getByRole('link',{name:/Open Experian portal|Upload documents for a pending Experian request/})).toHaveCount(0);
  }
  expect(writes).toEqual([]);
});

test('unowned full package stays hidden while a bureau read failure has a retry',async({page}) => {
  const {app} = await open(page,{denied:true});
  await expect(app).toBeHidden();
});

test('a failed bureau read shows its error without making banks available',async({page}) => {
  const {app} = await open(page,{failInquiries:true});
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await expect(app.getByRole('alert')).toContainText('Bureau evidence is temporarily unavailable.');
  await app.getByRole('button',{name:'Try again'}).click();
  await expect(app.getByRole('alert')).toContainText('Bureau evidence is temporarily unavailable.');
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  await expect(app.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
});

for (const width of [1440,390]) test(`blocked popups use the permitted bank handoff at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{window.open=()=>null;});
  const {app,writes}=await open(page);
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await app.getByRole('button',{name:'Check saved bureau evidence'}).click();
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  await app.getByRole('button',{name:'Open bank application'}).click();
  await expect(page).toHaveURL('https://bank.example.invalid/apply');
  expect(writes.filter(w=>w.body.action==='open_lender')).toHaveLength(1);
});

test('the canonical document object opens in an available popup',async({page})=>{
  const {app}=await open(page);
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  const popupPromise=page.waitForEvent('popup');
  await app.getByRole('button',{name:'Open saved case letter'}).click();
  const popup=await popupPromise;
  await expect(popup).toHaveURL(new URL(SIGNED_DOCUMENT.url,page.url()).href);
  await expect(popup.getByRole('heading')).toHaveText('Synthetic signed case document');
  await popup.close();
});

for (const width of [1440,390]) for(const shape of ['url','path']) test(`blocked document popup accepts canonical ${shape} at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{window.open=()=>null;});
  const {app}=await open(page,{documentDownload:shape==='url'?SIGNED_DOCUMENT:{path:SIGNED_DOCUMENT.path}});
  const expected=new URL(SIGNED_DOCUMENT.path,page.url()).href;
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await app.getByRole('button',{name:'Open saved case letter'}).click();
  await expect(page).toHaveURL(expected);
  await expect(page.getByRole('heading')).toHaveText('Synthetic signed case document');
});

test('blocked bank handoff still rejects an unsafe destination',async({page})=>{
  await page.addInitScript(()=>{window.open=()=>null;});
  const {app}=await open(page,{lenderUrl:'javascript:alert(1)'});
  const original=page.url();
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await app.getByRole('button',{name:'Check saved bureau evidence'}).click();
  await app.getByRole('button',{name:'Applications',exact:true}).click();
  await app.getByRole('button',{name:'Open bank application'}).click();
  await expect(app.getByRole('status').last()).toContainText('A valid destination was not returned.');
  expect(page.url()).toBe(original);
});

for(const outcome of ['denied','unsafe','account-change']) test(`blocked client document navigation stays closed for ${outcome}`,async({page})=>{
  await page.addInitScript(()=>{window.open=()=>null;});
  const options=outcome==='denied'?{documentStatus:403}:outcome==='unsafe'?{documentDownload:{url:'javascript:alert(1)'}}:{onDocument:()=>page.evaluate(()=>localStorage.setItem('fh_token','different-account'))};
  const {app}=await open(page,options);
  const original=page.url();
  await app.getByRole('button',{name:'Inquiry removal',exact:true}).click();
  await app.getByRole('button',{name:'Open saved case letter'}).click();
  if(outcome==='account-change')await expect(app.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
  else await expect(app.getByRole('status').last()).toContainText(outcome==='denied'?'The saved document is not available.':'A valid destination was not returned.');
  expect(page.url()).toBe(original);
});

async function openCsmDocument(page,{blocked=false,documentDownload=SIGNED_DOCUMENT,onDocument=null}={}) {
  await page.addInitScript(({blocked})=>{localStorage.setItem('fh_token','synthetic-csm-document-session');if(blocked)window.open=()=>null;},{blocked});
  await page.context().route('**/api/documents/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic signed bank document</h1>'}));
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname==='/api/auth/session')return json(route,{ok:true,principal:'staff',staff:{id:ACCOUNT,org_id:ORG,role:'csm',name:'Synthetic CSM',status:'active'}});
    if(url.pathname==='/api/blueprint/services')return url.searchParams.get('view')==='oversight'?json(route,{ok:true,clients:[{clientId:CLIENT,clientName:'Synthetic Buyer',status:'active',executionOwner:'client'}]}):json(route,{ok:true,serviceTypes:[],requests:[],capabilities:{quote:false},oversight:{openSteps:[]}});
    if(url.pathname==='/api/blueprint/funding')return json(route,{ok:true,applications:[{id:APPLICATION,lenderName:'Synthetic Bank',status:'Apply',evidenceDocuments:[{id:DOCUMENT,reference:'SYNTHETIC-BANK-DOCUMENT'}]}]});
    if(url.pathname==='/api/documents-download'){if(onDocument)await onDocument();return json(route,{ok:true,document:{id:DOCUMENT,download:documentDownload}});}
    if(url.pathname.startsWith('/api/documents/'))return route.fulfill({contentType:'text/html',body:'<h1>Synthetic signed bank document</h1>'});
    return json(route,{ok:true,items:[],rows:[],total:0,entitlements:[]});
  });
  await page.goto('/app/csm-queue.html');
  const app=page.locator('#blueprint-csm-services');
  await app.getByRole('button',{name:'Review client',exact:true}).click();
  await expect(app.getByRole('button',{name:'Open selected bank evidence'})).toBeVisible();
  return app;
}

for(const blocked of [false,true])test(`CSM canonical bank document opens with popup blocked=${blocked}`,async({page})=>{
  const app=await openCsmDocument(page,{blocked});
  const expected=new URL(SIGNED_DOCUMENT.url,page.url()).href;
  const popupPromise=blocked?null:page.waitForEvent('popup');
  await app.getByRole('button',{name:'Open selected bank evidence'}).click();
  const target=blocked?page:await popupPromise;
  await expect(target).toHaveURL(expected);
  await expect(target.getByRole('heading')).toHaveText('Synthetic signed bank document');
  if(!blocked)await target.close();
});

for(const outcome of ['unsafe','account-change'])test(`CSM blocked document stays closed for ${outcome}`,async({page})=>{
  const app=await openCsmDocument(page,{blocked:true,...(outcome==='unsafe'?{documentDownload:{url:'javascript:alert(1)'}}:{onDocument:()=>page.evaluate(()=>localStorage.setItem('fh_token','different-account'))})});
  const original=page.url();
  await app.getByRole('button',{name:'Open selected bank evidence'}).click();
  if(outcome==='account-change')await expect(app).toBeHidden();
  else await expect(app.getByRole('status').last()).toContainText('The document link could not be opened.');
  expect(page.url()).toBe(original);
});
