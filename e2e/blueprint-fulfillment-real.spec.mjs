import { test, expect } from '@playwright/test';
import { randomUUID, createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import pg from 'pg';
import { isLocalScratchDatabaseUrl } from '../src/verification/scratch-guard.mjs';
import { createAccountSession } from '../src/auth/account-session.mjs';
import { createSession } from '../src/auth/session.mjs';
import { onPaymentReceived } from '../src/handlers/client-lifecycle.mjs';
import { onPaymentReceivedMoney } from '../src/handlers/money-chain.mjs';
import { captureConsent } from '../src/consent/index.mjs';
import { emit } from '../src/events/bus.mjs';
import { onPaidServicePaymentReceived } from '../src/handlers/paid-service-payment.mjs';
import { FULL_BLUEPRINT_DISPUTE_CLAUSE } from '../src/repair/dispute-auth.mjs';

const ENABLED = process.env.BLUEPRINT_REAL_E2E === '1';
const APP = process.env.BLUEPRINT_REAL_APP_DATABASE_URL;
const OWNER = process.env.BLUEPRINT_REAL_OWNER_DATABASE_URL;
const PORT = Number(process.env.BLUEPRINT_REAL_PORT || 8910);
const BASE = 'http://127.0.0.1:' + PORT;
const PDF = Buffer.from('%PDF-1.4\n% synthetic local proof, no real customer information\n%%EOF');
const EVIDENCE = path.resolve('ops/workflows/blueprint-engine-install/real-browser-proof');
let appDb, ownerDb, server, serverLog = '';
const outcomes=[];

test.describe('Blueprint normal-router real app-role PostgreSQL buyer proof', () => {
  test.use({actionTimeout:10000});
  test.skip(!ENABLED, 'Opt in with BLUEPRINT_REAL_E2E=1 and explicit local app/owner DB URLs');
  test.beforeAll(async () => {
    expect(isLocalScratchDatabaseUrl(APP)).toBe(true);
    expect(isLocalScratchDatabaseUrl(OWNER)).toBe(true);
    const app = new URL(APP), owner = new URL(OWNER);
    expect(app.username).toBe('fundhub_app');
    expect([app.hostname,app.port,app.pathname]).toEqual([owner.hostname,owner.port,owner.pathname]);
    expect(app.search + app.hash + owner.search + owner.hash).toBe('');
    appDb = new pg.Pool({connectionString:APP,ssl:false,max:4});
    ownerDb = new pg.Pool({connectionString:OWNER,ssl:false,max:2});
    const role = (await appDb.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    expect(role).toEqual({name:'fundhub_app',rolsuper:false,rolbypassrls:false});
    server = spawn(process.execPath,['e2e/blueprint-real-server.mjs','--port',String(PORT)],{
      cwd:process.cwd(),env:{...process.env,DATABASE_URL:APP,ADAPTERS_DRY_RUN:'1',
        DOCUMENT_URL_SECRET:'synthetic-blueprint-proof-document-secret-20261106',DOCUMENT_STORE_PROVIDER:'memory',PII_ENC_KEY:randomBytes(32).toString('base64'),
        CORTANA_COMMAS_API_KEY:'local-blueprint-proof-transport',FANBASIS_CHECKOUT_API_BASE:'https://checkout-transport.example.invalid'},
      stdio:['ignore','pipe','pipe']});
    server.stdout.on('data',value => { serverLog += value; });
    server.stderr.on('data',value => { serverLog += value; });
    await expect.poll(()=>serverLog.includes('fundhub dev server → http://127.0.0.1:'+PORT+'/login.html'),
      {timeout:20000,message:'the proof must own its guarded local server'}).toBe(true);
    await expect.poll(async () => {
      try { return (await fetch(BASE + '/app/client-portal.html')).status; } catch { return 0; }
    },{timeout:20000,message:'normal Netlify-router server failed: ' + serverLog}).toBe(200);
    await fs.mkdir(EVIDENCE,{recursive:true});
  });
  test.afterEach(async ({},info)=>{
    outcomes.push({name:info.title,status:info.status,expectedStatus:info.expectedStatus,durationMs:info.duration});
  });
  test.afterAll(async () => {
    server?.kill('SIGTERM');
    await fs.mkdir(EVIDENCE,{recursive:true});
    await fs.writeFile(path.join(EVIDENCE,'server.log'),serverLog);
    await fs.writeFile(path.join(EVIDENCE,'result.json'),JSON.stringify({
      checkedAt:new Date().toISOString(),surface:'normal Netlify router over authenticated local HTTP',
      databaseRole:'fundhub_app',databaseTestsSkipped:0,liveProviderWrites:false,
      transports:{checkout:'fake server-side Commas transport',bankDestination:'fake browser destination',
        otherExternalFetches:'rejected',loading:'delay before continuing real request',error:'browser transport abort then real recovery'},
      outcomes
    },null,2)+'\n');
    await Promise.all([appDb?.end(),ownerDb?.end()]);
  });

  async function api(token, route, body, expected = 200) {
    const response = await fetch(BASE + route,{method:body ? 'POST' : 'GET',
      headers:{authorization:'Bearer ' + token,...(body ? {'content-type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {})});
    const result = await response.json();
    expect(response.status,JSON.stringify(result)).toBe(expected);
    return result;
  }

  async function fixture(label, {empty = false, noReport = false} = {}) {
    const orgId=randomUUID(), clientId=randomUUID(), accountId=randomUUID(), otherId=randomUUID(), otherAccount=randomUUID();
    const lenderId=randomUUID(), caseId=randomUUID(), inquiryId=randomUUID(), staffId=randomUUID();
    await ownerDb.query("INSERT INTO orgs(id,slug,name) VALUES($1,$2,'Synthetic local browser proof')",[orgId,'browser-'+orgId]);
    await ownerDb.query(`INSERT INTO clients(id,org_id,first_name,last_name,email,custom_fields)
      VALUES($1,$3,'Synthetic',$4,$5,$6),($2,$3,'Other','Synthetic',$7,'{}')`,
      [clientId,otherId,orgId,label,clientId+'@example.test',{home_state:'AZ',crs_negative_items_count:0},otherId+'@example.test']);
    await ownerDb.query(`INSERT INTO accounts(id,org_id,client_id,kind,status,email,password_hash,name)
      VALUES($1,$3,$4,'client','active',$5,'fixture-no-password','Synthetic buyer'),
      ($2,$3,$6,'client','active',$7,'fixture-no-password','Other buyer')`,
      [accountId,otherAccount,orgId,clientId,accountId+'@example.test',otherId,otherAccount+'@example.test']);
    await ownerDb.query("INSERT INTO staff(id,org_id,name,role,status,email) VALUES($1,$2,'Synthetic CSM','csm','active',$3)",[staffId,orgId,staffId+'@example.test']);
    const product=(await ownerDb.query("INSERT INTO products(org_id,code,name,category,default_price) VALUES($1,'blueprint-self-funding','Synthetic full Blueprint','consulting',30000) RETURNING id",[orgId])).rows[0];
    await ownerDb.query("INSERT INTO product_aliases(org_id,product_id,alias,source) VALUES($1,$2,'blueprint-self-funding','manual') ON CONFLICT DO NOTHING",[orgId,product.id]);
    await ownerDb.query(`INSERT INTO entitlement_catalog(org_id,code,name,kind) VALUES
      ($1,'blueprint-client-fulfillment','Full package','service'),($1,'credit-optimization-roadmap','Preparation','service')`,[orgId]);
    await ownerDb.query(`INSERT INTO product_entitlements(org_id,product_code,entitlement_code) VALUES
      ($1,'blueprint-self-funding','blueprint-client-fulfillment'),($1,'blueprint-self-funding','credit-optimization-roadmap')`,[orgId]);
    const sale=(await ownerDb.query('INSERT INTO sales(org_id,client_id,product_id,agreed_price) VALUES($1,$2,$3,30000) RETURNING id',[orgId,clientId,product.id])).rows[0];
    const event={id:randomUUID(),name:'payment.received',orgId,clientId,occurredAt:new Date().toISOString(),
      payload:{productName:'blueprint-self-funding',product:'blueprint_self_funding',productId:product.id,saleId:sale.id,
        amount:30000,currency:'USD',source:'whop',providerRef:'synthetic-payment-'+randomUUID(),paymentId:'synthetic-provider-'+randomUUID()}};
    event.id=(await emit(appDb,'payment.received',event.payload,{orgId,clientId,skipInngest:true})).id;
    await onPaymentReceived(event,appDb);
    const paid=await onPaymentReceivedMoney(event,appDb);
    expect(paid.done,JSON.stringify(paid)).toBe(true);
    await onPaymentReceived(event,appDb);
    expect((await onPaymentReceivedMoney(event,appDb)).done).toBe(true);
    expect((await appDb.query('SELECT count(*)::int n FROM transactions WHERE org_id=$1 AND client_id=$2',[orgId,clientId])).rows[0].n).toBe(1);
    expect((await appDb.query('SELECT count(*)::int n FROM sale_payments WHERE org_id=$1 AND sale_id=$2',[orgId,sale.id])).rows[0].n).toBe(1);
    const engagement=(await appDb.query('SELECT * FROM blueprint_fulfillment_engagements WHERE org_id=$1 AND client_id=$2',[orgId,clientId])).rows[0];
    expect(engagement?.execution_owner).toBe('client');
    await ownerDb.query(`INSERT INTO lenders(id,org_id,lender_table,name,application_url,eligible_states,bureaus_pulled,priority_tier,active,is_demo)
      VALUES($1,$2,'PersonalCC','Synthetic Community Bank','https://bank.example.invalid/apply','AZ','EX',1,true,false)`,[lenderId,orgId]);
    const report=items => ({source:'crs',environment:'production',scores:{ex:725,eq:725,tu:725},bureauStatus:{EX:'file_returned'},
      bureaus:{EX:{inquiries:items}},inquiries:items.map(item=>({...item,source:'EX'}))});
    const originalReport=noReport ? {rows:[]} : await ownerDb.query(`INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result,created_at)
      VALUES($1,$2,'crs_softview',$3,$4,now()-interval '1 hour') RETURNING id`,
      [orgId,clientId,'synthetic-report-'+randomUUID(),report([{creditorName:'Synthetic Inquiry Bank',date:'2026-10-12'}])]);
    if (!empty) {
      await ownerDb.query("INSERT INTO inquiry_removal_cases(id,org_id,client_id,case_id,selected_bureaus_raw,case_status) VALUES($1,$2,$3,$4,'EX','Queued')",[caseId,orgId,clientId,'synthetic-'+caseId]);
      await ownerDb.query("INSERT INTO inquiry_log(id,org_id,client_id,bureau,inquiry,inquiry_name,case_id,inquiry_removal_case_id,status,is_open) VALUES($1,$2,$3,'EX','Synthetic Inquiry Bank','Synthetic Inquiry Bank',$4,$4,'New',true)",[inquiryId,orgId,clientId,caseId]);
    }
    const token=(await createAccountSession(appDb,{accountId,orgId})).token;
    const otherToken=(await createAccountSession(appDb,{accountId:otherAccount,orgId})).token;
    const staffToken=(await createSession(appDb,{staffId,orgId,mfaVerified:true})).token;
    if (!noReport) await captureConsent(appDb,{orgId,clientId,kind:'soft_pull_consent',consentText:'I authorize a soft credit report for my synthetic local proof.',consentVersion:'proof-v1',captureMethod:'checkbox',grantedBy:{kind:'client',id:accountId}});
    await captureConsent(appDb,{orgId,clientId,kind:'dispute_authorization',consentText:FULL_BLUEPRINT_DISPUTE_CLAUSE,captureMethod:'typed',grantedName:'Synthetic Buyer',grantedBy:{kind:'client',accountId}});
    return {orgId,clientId,accountId,otherId,otherToken,staffId,staffToken,token,lenderId,caseId,inquiryId,engagement,report,fullName:'Synthetic '+label,originalReport:originalReport.rows[0]?.id || null};
  }

  async function upload(token, subtype) {
    const form = new FormData(); form.append('file',new Blob([PDF],{type:'application/pdf'}),subtype+'.pdf');
    form.append('kind',subtype==='inquiry_submission_receipt' ? 'inquiry_doc' : 'client_upload'); form.append('subtype',subtype);
    const response=await fetch(BASE+'/api/documents-upload',{method:'POST',headers:{authorization:'Bearer '+token},body:form});
    const body=await response.json(); expect(response.status,JSON.stringify(body)).toBe(200);
    const document=body.documents[0];
    expect((await appDb.query('SELECT current_version_id FROM documents WHERE id=$1',[document.id])).rows[0].current_version_id).toBeTruthy();
    return document.id;
  }

  async function marked(page, width, label, selector = '#blueprint-fulfillment') {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await page.evaluate(({selector,label}) => {
      const box=document.querySelector(selector)?.getBoundingClientRect();
      const mark=document.createElement('div'); mark.id='proof-mark';
      Object.assign(mark.style,{position:'fixed',left:'8px',top:'8px',zIndex:'2147483647',background:'#fff',padding:'8px',border:'2px solid #c00',color:'#111',font:'14px sans-serif',maxWidth:'310px'});
      const circle=document.createElement('span');circle.textContent='1';
      Object.assign(circle.style,{display:'inline-block',border:'3px solid #c00',borderRadius:'50%',width:'20px',height:'20px',textAlign:'center',marginRight:'6px',color:'#c00'});
      mark.append(circle,document.createTextNode(label)); document.body.append(mark);
      const arrow=document.createElement('div'); arrow.id='proof-arrow'; arrow.textContent='➜';
      Object.assign(arrow.style,{position:'fixed',left:Math.max(0,box.left-2)+'px',top:Math.max(50,box.top+25)+'px',zIndex:'2147483647',color:'#ffd400',font:'bold 48px sans-serif',textShadow:'1px 1px 2px #333'});document.body.append(arrow);
    },{selector,label});
    await page.screenshot({path:path.join(EVIDENCE,width+'-'+label.replace(/[^a-z0-9]+/gi,'-')+'.png'),fullPage:false});
    await page.evaluate(()=>{document.getElementById('proof-mark')?.remove();document.getElementById('proof-arrow')?.remove();});
  }

  async function signIn(page, token, route='/app/client-portal.html') {
    await page.addInitScript(token=>localStorage.setItem('fh_token',token),token);
    await page.context().route('https://bank.example.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Synthetic bank transport</h1>'}));
    await page.goto(BASE+route);
  }

  async function authorizeIncludedReport(page,f) {
    await page.getByRole('link',{name:'Set up my included report',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Authorize your included credit report'})).toBeVisible();
    await marked(page,page.viewportSize().width,'first-report-authorization','#app');
    const values={first_name:'Synthetic',last_name:'Buyer',ssn:'000-00-0000',dob:'1980-01-01',address_line1:'1 Test Street',city:'Phoenix',state:'AZ',postal_code:'85001'};
    for (const [id,value] of Object.entries(values)) await page.locator('#'+id).fill(value);
    await page.getByRole('button',{name:'I agree — submit soft-pull approval',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Your included report is in progress'})).toBeVisible();
    await marked(page,page.viewportSize().width,'first-report-queued','#app');
    await expect(page.getByRole('link',{name:/Pay .* assessment/})).toHaveCount(0);
    await page.getByRole('link',{name:'Return to my Blueprint',exact:true}).click();
    await page.locator('#blueprint-fulfillment').getByRole('button',{name:'Reports and help',exact:true}).click();
  }

  for (const width of [1440,390]) test(`new buyer authorizes the included first report without an assessment checkout at ${width}px`,async ({page})=>{
    await page.setViewportSize({width,height:1000});
    const f=await fixture('First report '+width,{empty:true,noReport:true});
    await signIn(page,f.token);
    const host=page.locator('#blueprint-fulfillment');
    await host.getByRole('button',{name:'Reports and help',exact:true}).click();
    await authorizeIncludedReport(page,f);
    await expect(host.getByText('A report request is already in progress.')).toBeVisible();
    await page.goto(BASE+'/app/soft-pull-approve.html?portal=1&blueprint=1');
    await expect(page.getByRole('heading',{name:'Your included report is in progress'})).toBeVisible();
    expect((await appDb.query('SELECT count(*)::int n FROM soft_pull_requests WHERE client_id=$1',[f.clientId])).rows[0].n).toBe(1);
    expect((await appDb.query('SELECT count(*)::int n FROM payment_links WHERE client_id=$1',[f.clientId])).rows[0].n).toBe(0);
    expect((await appDb.query('SELECT count(*)::int n FROM paid_service_requests WHERE client_id=$1',[f.clientId])).rows[0].n).toBe(0);
  });

  for (const width of [1440,390]) test(`actual purchase, uploads, bureau proof, bank handoff, CSM quote and completion at ${width}px`,async({page,browser})=>{
    test.setTimeout(120000);
    const f=await fixture('Buyer '+width);
    await upload(f.token,'id_document'); await upload(f.token,'proof_of_address');
    await signIn(page,f.token);
    const host=page.locator('#blueprint-fulfillment');
    await page.setViewportSize({width,height:1000});
    await expect(host).toBeVisible();
    const tabs=await host.locator('.bf-tabs button').evaluateAll(nodes=>nodes.map(node=>{
      const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};
    }));
    for(let first=0;first<tabs.length;first++) for(let second=first+1;second<tabs.length;second++) {
      const a=tabs[first], b=tabs[second];
      expect(Math.min(a.right,b.right)-Math.max(a.x,b.x)<=0.5 || Math.min(a.bottom,b.bottom)-Math.max(a.y,b.y)<=0.5,
        'workspace tabs '+first+' and '+second+' overlap at '+width+'px').toBe(true);
    }
    await host.getByRole('button',{name:'Applications',exact:true}).click();
    await expect(host.getByRole('heading',{name:'Your permitted banks',exact:true})).toBeVisible();
    await expect(host.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
    await api(f.token,'/api/blueprint/funding',{action:'open_lender',lenderId:f.lenderId,clientId:f.otherId},400);
    await api(f.token,'/api/blueprint/inquiries',{action:'clear',caseId:f.caseId},400);
    await api(f.otherToken,'/api/blueprint/funding',null,403);
    await api(f.token,'/api/blueprint/funding?clientId='+f.otherId,null,403);
    await host.getByRole('button',{name:'Inquiry removal',exact:true}).click();
    await expect(host.getByRole('link',{name:'Open Experian portal ↗',exact:true})).toHaveAttribute('href','https://www.experian.com/help/dispute-credit/');
    await expect(host.getByRole('link',{name:'Upload documents for a pending Experian request ↗',exact:true})).toHaveAttribute('href','https://www.experian.com/consumer/upload/');
    await expect(host.getByText('Synthetic Inquiry Bank · Open',{exact:true})).toBeVisible();
    await marked(page,width,'content-bureau-held');
    await host.getByText('Save my dispute submission',{exact:true}).click();
    await host.locator('input[name=reference]').fill('SYN-BUREAU-42');
    await host.locator('input[name=receipt]').setInputFiles({name:'synthetic-receipt.pdf',mimeType:'application/pdf',buffer:PDF});
    await host.getByRole('button',{name:'Save submission receipt'}).click();
    await expect(host.getByText(/Waiting for verification/)).toBeVisible();
    const receipt=(await appDb.query('SELECT receipt_document_id FROM blueprint_inquiry_evidence WHERE case_id=$1',[f.caseId])).rows[0];
    expect(receipt.receipt_document_id).toBeTruthy();
    expect((await appDb.query('SELECT is_open FROM inquiry_log WHERE id=$1',[f.inquiryId])).rows[0].is_open).toBe(true);
    await api(f.token,'/api/blueprint/inquiries',{action:'check_evidence',caseId:f.caseId});
    expect((await appDb.query('SELECT is_open FROM inquiry_log WHERE id=$1',[f.inquiryId])).rows[0].is_open).toBe(true);
    await api(f.token,'/api/blueprint/inquiries',{action:'launch_call',caseId:f.caseId,authorization:false},400);
    await ownerDb.query(`INSERT INTO crs_results(org_id,client_id,provider,provider_result_id,result,created_at)
      VALUES($1,$2,'crs_softview',$3,$4,now()+interval '1 second')`,[f.orgId,f.clientId,'synthetic-confirmed-'+randomUUID(),f.report([])]);
    await host.getByRole('button',{name:'Check saved bureau evidence'}).click();
    await expect(host.getByText('Removal verified',{exact:false})).toBeVisible();
    expect((await appDb.query('SELECT is_open,removal_verified_report_id FROM inquiry_log WHERE id=$1',[f.inquiryId])).rows[0].is_open).toBe(false);
    await ownerDb.query("UPDATE blueprint_fulfillment_engagements SET opens_at=now()+interval '1 day' WHERE id=$1",[f.engagement.id]);
    await host.getByRole('button',{name:'Refresh',exact:true}).click();
    await host.getByRole('button',{name:'Applications',exact:true}).click();
    await expect(host.getByRole('button',{name:'Open bank application'})).toHaveCount(0);
    await api(f.token,'/api/blueprint/funding',{action:'open_lender',lenderId:f.lenderId},409);
    await ownerDb.query("UPDATE blueprint_fulfillment_engagements SET opens_at=now()-interval '1 second' WHERE id=$1",[f.engagement.id]);
    await host.getByRole('button',{name:'Refresh',exact:true}).click();
    const popupPromise=page.waitForEvent('popup');
    await host.getByRole('button',{name:'Open bank application'}).click();
    const popup=await popupPromise;await expect(popup).toHaveURL('https://bank.example.invalid/apply');await popup.close();
    await host.getByText('Report a bank response',{exact:true}).click();
    await host.locator('input[name=reference]').fill('SYN-BANK-42');
    await host.locator('select[name=status]').selectOption('declined');
    await host.locator('input[name=evidence]').setInputFiles({name:'synthetic-bank-decision.pdf',mimeType:'application/pdf',buffer:PDF});
    await host.getByRole('button',{name:'Save bank response'}).click();
    await expect(host.getByText(/Your report: declined/)).toBeVisible();
    const application=(await appDb.query('SELECT a.id,a.status,r.evidence_document_id FROM applications a JOIN blueprint_funding_handoffs h ON h.application_id=a.id JOIN blueprint_application_reports r ON r.handoff_id=h.id WHERE a.client_id=$1',[f.clientId])).rows[0];
    expect(application.status).toBe('Applied');
    await marked(page,width,'content-client-report-unverified');
    await host.getByRole('button',{name:'Reports and help',exact:true}).click();
    await authorizeIncludedReport(page,f);
    await expect(host.getByText('A report request is already in progress.')).toBeVisible();
    expect((await appDb.query("SELECT count(*)::int n FROM soft_pull_requests WHERE client_id=$1 AND blueprint_report_kind='included'",[f.clientId])).rows[0].n).toBe(1);
    await host.getByLabel('What would you like help with?').selectOption('repair_full');
    await host.getByLabel('Tell the team which step needs help').fill('Please price a separate full repair service for this synthetic case.');
    await host.getByRole('button',{name:'Request help and pricing'}).click();
    await expect(host.getByText('Waiting for a quote',{exact:true})).toBeVisible();
    expect((await appDb.query("SELECT state FROM blueprint_client_services WHERE client_id=$1 AND service_kind='repair_full'",[f.clientId])).rows[0].state).toBe('requested');
    const staffContext=await browser.newContext({viewport:{width,height:1000}});
    const staffPage=await staffContext.newPage();await signIn(staffPage,f.staffToken,'/app/csm-queue.html');
    const csm=staffPage.locator('#blueprint-csm-services');await expect(csm).toBeVisible();
    await csm.getByRole('button',{name:'Review client',exact:true}).click();
    const quote=csm.locator('form[data-bcs-form=quote]');await expect(quote).toBeVisible();
    await quote.getByLabel('Quoted price in USD').fill('1000');await quote.getByRole('button',{name:'Save quote for client review'}).click();
    await expect(csm.getByText('quoted · $1,000.00',{exact:true})).toBeVisible();
    await marked(staffPage,width,'content-csm-quote','#blueprint-csm-services');
    await host.getByRole('button',{name:'Refresh',exact:true}).click();
    await host.getByRole('checkbox',{name:'I accept this service quote for $1,000.00.'}).check();
    await host.getByRole('button',{name:'Review payment options'}).click();
    await expect(host.getByRole('link',{name:'Review checkout ↗'})).toHaveAttribute('href',/^https:\/\/checkout.example.invalid\//);
    const saved=(await appDb.query("SELECT id,status,amount_paid_cents FROM paid_service_requests WHERE client_id=$1 AND status='awaiting_payment'",[f.clientId])).rows[0];
    expect(saved).toBeTruthy();expect(Number(saved.amount_paid_cents)).toBe(0);
    const paidHelp={orgId:f.orgId,clientId:f.clientId,payload:{ref:saved.id,amountCents:100000,currency:'USD',paymentId:'synthetic-help-'+randomUUID()}};
    expect((await onPaidServicePaymentReceived({...paidHelp,payload:{...paidHelp.payload,amountCents:99999}},appDb)).done).toBe(false);
    expect((await onPaidServicePaymentReceived(paidHelp,appDb)).done).toBe(true);
    expect((await onPaidServicePaymentReceived(paidHelp,appDb)).done).toBe(true);
    expect((await appDb.query("SELECT count(*)::int n FROM tasks WHERE client_id=$1 AND source_workflow='blueprint-paid-help'",[f.clientId])).rows[0].n).toBe(1);
    await host.getByRole('button',{name:'Applications',exact:true}).click();
    await host.getByRole('button',{name:/finished submitting|finish.*application|finish.*submission|done applying/i}).click();
    const bank=csm.locator('form[data-bcs-form=bank]');await bank.getByLabel('Outcome supported by the document').selectOption('declined');
    await bank.getByLabel('Evidence review note').fill('Matched the synthetic bank decision and exact application reference.');
    await bank.getByRole('button',{name:'Save reviewed bank outcome'}).click();
    await expect(csm.getByText('Bank evidence review saved against this application.')).toBeVisible();
    await host.getByRole('button',{name:'Refresh',exact:true}).click();
    await expect(host.getByText('Your purchased funding round is complete',{exact:false}).first()).toBeVisible();
    await marked(page,width,'content-completed-history');
    expect((await appDb.query('SELECT status FROM blueprint_fulfillment_engagements WHERE id=$1',[f.engagement.id])).rows[0].status).toBe('completed');
    await api(f.token,'/api/blueprint/funding',{action:'open_lender',lenderId:f.lenderId},409);
    await page.evaluate(token=>{localStorage.setItem('fh_token',token);window.dispatchEvent(new Event('focus'));},f.otherToken);
    await expect(host.getByRole('link',{name:'Sign in',exact:true})).toBeVisible();
    await expect(host.getByText('Synthetic Community Bank')).toHaveCount(0);
    await staffContext.close();
  });

  for (const width of [1440,390]) test(`actual empty and loading reads, transport error and recovery at ${width}px`,async({page})=>{
    const f=await fixture('States '+width,{empty:true});
    await page.setViewportSize({width,height:1000});
    let release; const held=new Promise(resolve=>{release=resolve;});
    const delay=async route=>{await held;await route.continue();};
    await page.route('**/api/blueprint/services',delay);
    await signIn(page,f.token);
    const host=page.locator('#blueprint-fulfillment');
    await expect(host).toBeVisible();
    await host.getByRole('button',{name:'Reports and help',exact:true}).click();
    await expect(host.getByText('Loading your report and help options…')).toBeVisible();
    await marked(page,width,'loading-real-read');
    release();
    await expect(host.getByRole('heading',{name:'Your service requests',exact:true})).toBeVisible();
    await page.unroute('**/api/blueprint/services',delay);
    await host.getByRole('button',{name:'Inquiry removal',exact:true}).click();
    await expect(host.getByText('Your file has no inquiry cases waiting for action.')).toBeVisible();
    await marked(page,width,'empty-no-case');
    const fail=route=>route.abort('failed');
    await page.route('**/api/blueprint/services',fail);
    await host.getByRole('button',{name:'Refresh',exact:true}).click();
    await host.getByRole('button',{name:'Reports and help',exact:true}).click();
    await expect(host.getByRole('alert')).toBeVisible();
    await marked(page,width,'error-transport-failure');
    await page.unroute('**/api/blueprint/services',fail);
    await host.getByRole('button',{name:'Try again',exact:true}).click();
    await expect(host.getByRole('heading',{name:'Your service requests',exact:true})).toBeVisible();
    await expect(host.getByRole('alert')).toHaveCount(0);
    await marked(page,width,'content-recovered-real-read');
  });
});
