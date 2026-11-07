import {test,expect} from '@playwright/test';

// Actual deployed/local renderers and their own explicit demo adapter. No API
// mocks provide the workspace: an API attempt instead receives a bank canary
// and fails the zero-request assertion. No production request is forwarded.
const ROUTE='/app/client-portal.html?demo=1&blueprint=full';
const LIVE=process.env.BLUEPRINT_DEMO_BASE_URL || '';
const TOKEN='synthetic-existing-real-session-do-not-replace';
const COOKIE='synthetic-existing-session-cookie';
const CANARY='REAL_BANK_CANARY_DO_NOT_RENDER';
const FILE_BODY='NEVER_PERSIST_THIS_UPLOAD_BODY_20261106';
const trackers=new WeakMap();
test.use({serviceWorkers:'block'});
const url=path=>LIVE?new URL(path,LIVE).href:path;
const full=page=>page.locator('#blueprint-fulfillment');
const prep=page=>page.locator('#blueprint-plan');
const banner=page=>page.locator('#blueprint-demo-banner');
const journey=page=>page.locator('[data-blueprint-journey]:visible');
const sampleFile=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF')});

async function open(page,context,{existing=false,offer='implementation',scenario=null}={}){
  const seen={api:[],external:[],errors:[]};trackers.set(page,seen);
  context.on('request',request=>{
    const u=new URL(request.url());
    if(u.pathname.startsWith('/api/'))seen.api.push({path:u.pathname,method:request.method()});
  });
  await context.route('**/api/**',route=>route.fulfill({json:{ok:true,principal:'client',staff:{id:'real-account-canary',client_id:'real-client-canary',org_id:'real-org-canary',role:'client',name:CANARY},accounts:[{name:CANARY,balance:987654321}],items:[{name:CANARY}],error:'unexpected_real_api'}}));
  const base=new URL(url(ROUTE),test.info().project.use.baseURL||'http://127.0.0.1:43117');
  await context.route(/^https?:\/\//,async route=>{
    const u=new URL(route.request().url());
    if(u.origin!==base.origin){seen.external.push(u.origin+u.pathname);await route.abort();return;}
    await route.fallback();
  });
  page.on('pageerror',error=>seen.errors.push(error.message));
  context.on('page',other=>other.on('pageerror',error=>seen.errors.push(error.message)));
  await page.addInitScript(({existing,token})=>{
    window.__blueprintOriginalFetch=window.fetch;
    if(!sessionStorage.getItem('blueprint-test-initialized')){
      sessionStorage.setItem('blueprint-test-initialized','1');
      localStorage.setItem('unrelated-existing-data','keep-this-value');
      if(existing)localStorage.setItem('fh_token',token);
    }
  },{existing,token:TOKEN});
  if(existing)await context.addCookies([{name:'fh_session',value:COOKIE,url:base.origin,httpOnly:true,sameSite:'Lax'}]);
  await page.goto(url(ROUTE));
  await expect(banner(page)).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo?.active===true)).toBe(true);
  await expect(journey(page),'Exactly one current journey is visible').toHaveCount(1);
  await expect(journey(page)).toBeVisible();
  if(offer!=='implementation')await selectOffer(page,offer);
  if(scenario)await stage(page,scenario);
  return seen;
}
async function loadingTransition(context){
  const delayed=await context.newPage();
  let release;const held=new Promise(resolve=>{release=resolve;});
  await delayed.route('**/app/blueprint-demo.js',async route=>{await held;await route.continue();});
  try{
    // Delay only the actual adapter asset; never replace its contents or mock a workspace read.
    await delayed.goto(url(ROUTE),{waitUntil:'commit'});
    await delayed.locator('#blueprint-plan').waitFor({state:'attached'});
    await expect(delayed.getByRole('status',{name:'Loading your plan',exact:true}), 'Slow adapter load must show a visible loading state').toBeVisible();
    await expect(delayed.locator('#blueprint-plan .bp-skeleton').first()).toBeVisible();
    expect(await delayed.evaluate(()=>typeof window.FHBlueprintDemo)).toBe('undefined');
    await noOverflow(delayed);
    release();
    await delayed.waitForLoadState('domcontentloaded');
    await expect(banner(delayed)).toBeVisible();
    await expect(journey(delayed)).toBeVisible();
    await expect(delayed.getByRole('status',{name:'Loading your plan',exact:true})).toHaveCount(0);
  }finally{release();await delayed.close();}
}
async function tab(page,name){
  const control=full(page).getByRole('button',{name:name==='Today'?'Overview':name,exact:true});
  if(!await control.isVisible())await full(page).getByRole('button',{name:'Back to Blueprint overview',exact:true}).click();
  await control.click();
}
async function preparation(page){
  if(!await prep(page).isVisible())await tab(page,'Preparation steps');
  await expect(prep(page)).toBeVisible();return prep(page);
}
async function demoControl(page,key){
  const control=banner(page).locator('[data-blueprint-demo-control="'+key+'"]');
  if(!await control.isVisible()){
    const details=control.locator('xpath=ancestor::details[1]');
    await details.locator('summary').click();
  }
  return control;
}
async function selectOffer(page,value){
  if(await page.evaluate(()=>window.FHBlueprintDemo?.offer)===value)return;
  const control=await demoControl(page,'offer');
  await Promise.all([
    page.waitForURL(current=>current.searchParams.get('offer')===value,{waitUntil:'domcontentloaded'}),
    control.selectOption(value)
  ]);
  await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo?.offer)).toBe(value);
  await expect(journey(page)).toBeVisible();
}
async function stage(page,value){
  await (await demoControl(page,'scenario')).selectOption(value);
  await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo.scenario)).toBe(value);
  await expect(journey(page)).toBeVisible();
}
async function read(page,path){
  await page.waitForFunction(()=>window.FHBlueprintDemo?.active===true,null,{timeout:10000});
  return page.evaluate(path=>window.FHBlueprintDemo.request(path),path);
}
async function preview(page,context,trigger,kind,inspect=null){
  const pending=page.waitForEvent('popup');await trigger();const popup=await pending;
  await expect(popup).toHaveURL(new RegExp('[?&]preview='+kind+'(?:&|$)'));
  expect(new URL(popup.url()).origin).toBe(new URL(page.url()).origin);
  expect(new URL(popup.url()).pathname).toBe('/app/client-portal.html');
  await expect(popup.locator('body')).toContainText(/sample|demo/i);
  await expect(popup.locator('body')).not.toContainText(CANARY);
  expect(await popup.locator('input[type="password"]').count()).toBe(0);
  expect(await popup.locator('form[action^="https://"]').count()).toBe(0);
  if(kind==='bank'){
    await popup.getByRole('button',{name:'Submit sample application',exact:true}).click();
    await expect(popup.locator('[role="status"]')).toContainText('Nothing was sent to a bank.');
  }
  if(kind==='payment'){
    await popup.getByRole('button',{name:'Record sample payment',exact:true}).click();
    await expect(popup.locator('[role="status"]')).toContainText('No charge was made.');
  }
  if(inspect)await inspect(popup);
  await popup.close();
}
async function noOverflow(page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
async function finishOnboarding(page){
  const next=journey(page).locator('.bj-next button:visible,.bj-next a:visible');
  await expect(next,'A new buyer has one obvious next action').toHaveCount(1);await next.click();
  const app=prep(page);await expect(app).toBeVisible();
  if(await app.getByRole('button',{name:'Start my plan',exact:true}).isVisible())await app.getByRole('button',{name:'Start my plan',exact:true}).click();
  await expect(app.getByText('Do you already own a business?',{exact:true})).toBeVisible();
  await app.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(app.getByText('Do you already own a business?',{exact:true})).toBeVisible();
  await app.getByText('No, I’m preparing my first business',{exact:true}).click();
  await app.getByRole('button',{name:'Save and continue',exact:true}).click();
  await expect(app.getByText('How many businesses are we preparing?',{exact:true})).toBeVisible();
  await app.locator('input[name="count"][value="4"]').check();
  await app.getByRole('button',{name:'Save and continue',exact:true}).click();
  await app.locator('select[name="homeState"]').selectOption('AZ');await app.locator('input[name="postalCode"]').fill('85004');
  await app.getByRole('button',{name:'Build my plan',exact:true}).click();
  const saved=await read(page,'/api/blueprint/plan');expect(saved.businessPlans.startedAt).toBeTruthy();expect(saved.businessPlans.targetBusinessCount).toBe(4);
  expect(saved.businessPlans.businesses).toHaveLength(0);
  return app;
}
async function addBusiness(page,name){
  const app=await preparation(page);await app.getByRole('button',{name:'Businesses',exact:true}).click();
  await app.getByRole('button',{name:'Add a business plan',exact:true}).click();
  await app.locator('input[name="name"]').fill(name);await app.locator('textarea[name="activity"]').fill('Website design for local shops');
  await app.locator('select[name="formationState"]').selectOption('AZ');await app.locator('select[name="operatingState"]').selectOption('AZ');
  await app.getByRole('button',{name:'Save business plan',exact:true}).click();
  await expect(app.locator('input[name="name"]')).toHaveValue(name);
  const saved=await read(page,'/api/blueprint/plan');const business=saved.businessPlans.businesses.find(b=>b.name===name);expect(business?.id).toBeTruthy();
  return{app,business};
}
async function openBudget(page){
  const app=await preparation(page);
  await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();
  await app.locator('[data-bp-action="lesson"][data-key="budget"]').click();
  return app.locator('form[data-bp-form="payoff-settings"]');
}
async function financeTab(page,key){
  const control=page.locator('#tab-'+key);
  if(!await control.isVisible())await page.locator('#fos-nav-toggle').click();
  await control.click();await expect(control).toHaveAttribute('aria-selected','true');
  const panel=page.locator('#fos-'+key);await expect(panel).toBeVisible();
  await expect.poll(async()=>(await panel.innerText()).trim().length).toBeGreaterThan(20);
  await expect(panel).not.toContainText(/Loading[^\n]*(?:…|\.{3})/i);
  await expect(panel).not.toContainText(/: coming soon|could not load|couldn’t load|unable to load/i);
  return panel;
}

test.afterEach(async({page},info)=>{
  const seen=trackers.get(page);if(!seen)return;
  await info.attach('blueprint-demo-isolation',{body:Buffer.from(JSON.stringify({url:page.url(),api:seen.api,external:seen.external,errors:seen.errors,live:!!LIVE},null,2)),contentType:'application/json'});
  expect(seen.api,'Demo must never contact any real API, even with an existing session').toEqual([]);
  expect(seen.external,'Demo must never open a bank, Plaid, payment or other external service').toEqual([]);
  expect(seen.errors,'Actual renderer must have no uncaught errors').toEqual([]);
  if(!page.isClosed()){
    expect(await page.evaluate(()=>window.fetch===window.__blueprintOriginalFetch),'Demo must preserve native fetch').toBe(true);
    await expect(page.locator('body')).not.toContainText(CANARY);
  }
});

for(const width of [1440,390])test.describe(`Full Blueprint demo ${width}px`,()=>{
  test.use({viewport:{width,height:1000}});
  test.describe.configure({timeout:60000});

  test('DEMO01 real full-offer renderer and sample next step are visible',async({page,context})=>{
    await open(page,context);
    await expect(banner(page)).toContainText('$30,000');
    await expect(banner(page)).toContainText(/full implementation/i);
    await expect(banner(page)).toContainText(/sample|fictional/i);
    await expect(page.locator('.client-ios-header')).toBeVisible();
    await expect(page.locator('h1:visible')).toHaveCount(1);
    const next=journey(page).locator('.bj-next button:visible,.bj-next a:visible');
    await expect(next,'A new buyer must see one clear action, not competing workspace panels').toHaveCount(1);
    await expect(journey(page).locator('.bj-next')).toBeVisible();
    expect((await journey(page).locator('.bj-next').innerText()).trim().length).toBeGreaterThan(30);
    for(const id of ['unlock-modal','book-modal']){
      const modal=page.locator('#'+id);
      await expect(modal,'Legacy payment/booking dialog must be absent from the full-demo interaction surface').toBeHidden();
      expect(await modal.evaluate(element=>{element.querySelector('button,[tabindex],input,a[href]')?.focus();return element.contains(document.activeElement);}), 'Hidden legacy controls must never accept focus').toBe(false);
    }
    expect((await read(page,'/api/blueprint/funding')).engagement.status).toBe('active');
    expect(await page.locator('#blueprint-fulfillment .bf-tabs:visible,#blueprint-plan .bp-tabs:visible').count(),'Never show competing nested module navigation').toBeLessThanOrEqual(1);
    await noOverflow(page);
    await loadingTransition(context);
  });

  test('DEMO02 all actual full-workspace tabs and preparation navigation work',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});
    const screens=[['Credit repair','Your credit repair work'],['Inquiry removal','Your bureau work'],['Applications','Your permitted banks'],['Reports and help','Your credit report']];
    for(const[name,text]of screens){await tab(page,name);await expect(full(page)).toContainText(text);await noOverflow(page);}
    const app=await preparation(page);
    for(const name of ['Businesses','Step-by-step help','Timeline','Get help']){
      await app.getByRole('button',{name,exact:true}).click();
      await expect(app.locator('button[aria-current="page"]')).toHaveText(name);
      expect(await page.locator('#blueprint-fulfillment .bf-tabs:visible,#blueprint-plan .bp-tabs:visible').count()).toBeLessThanOrEqual(1);
      await noOverflow(page);
    }
    await tab(page,'Today');await expect(journey(page).locator('.bj-next')).toBeVisible();
  });

  test('DEMO03 inquiry receipt and authorized AI request remain simulated',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});await tab(page,'Inquiry removal');
    await full(page).getByText('Save my dispute submission',{exact:true}).first().click();
    const form=full(page).locator('form[data-bf-form="submission"]').first();
    await form.locator('input[name="reference"]').fill('DEMO-RECEIPT-144');
    await form.locator('input[name="receipt"]').setInputFiles(sampleFile('demo-inquiry-receipt.pdf'));
    await form.getByRole('button',{name:'Save submission receipt',exact:true}).click();
    await expect(full(page)).toContainText('DEMO-RECEIPT-144');
    await expect(full(page)).toContainText(/Waiting for verification/i);
    const call=full(page).locator('form[data-bf-form="bureau-call"]').first();
    await call.getByRole('button',{name:'Call bureau with my AI agent',exact:true}).click();
    const before=await read(page,'/api/blueprint/inquiries');
    expect(JSON.stringify(before)).not.toMatch(/demo_requested|simulated_queued/);
    await call.locator('input[name="authorization"]').check();
    await call.getByRole('button',{name:'Call bureau with my AI agent',exact:true}).click();
    await expect.poll(async()=>{const data=await read(page,'/api/blueprint/inquiries');return data.cases[0].call?.status;}).toMatch(/simulated.*no call placed/i);
    const storage=await page.evaluate(()=>JSON.stringify(localStorage));
    expect(storage).toContain('demo-inquiry-receipt.pdf');expect(storage).not.toContain(FILE_BODY);expect(storage).not.toContain(Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF').toString('base64'));
  });

  test('DEMO04 repair letters, local document preview and response upload work',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});await tab(page,'Credit repair');
    await full(page).getByRole('button',{name:'Prepare my current repair letters',exact:true}).click();
    await expect(full(page).getByRole('button',{name:'Open repair letter',exact:true}).first()).toBeVisible();
    await preview(page,context,()=>full(page).getByRole('button',{name:'Open repair letter',exact:true}).first().click(),'document');
    const form=full(page).locator('form[data-bf-form="repair-response"]');
    await form.locator('input[name="file"]').setInputFiles(sampleFile('demo-repair-response.pdf'));
    await form.getByRole('button',{name:'Upload response for review',exact:true}).click();
    await expect(full(page)).toContainText(/response.*saved|demo|simulat/i);
    const storage=await page.evaluate(()=>JSON.stringify(localStorage));
    expect(storage).toContain('demo-repair-response.pdf');expect(storage).not.toContain(FILE_BODY);expect(storage).not.toContain(Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF').toString('base64'));
  });

  test('DEMO05 included report, scoped help and accepted quote stay local',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});await tab(page,'Reports and help');
    await full(page).getByRole('button',{name:'Request included report',exact:true}).click();
    await expect(full(page)).toContainText('A report request is already in progress.');
    const form=full(page).locator('form[data-bf-form="service"]');
    await form.locator('select[name="serviceKind"]').selectOption('repair_full');
    await form.locator('textarea[name="note"]').fill('DEMO: help me review this application step.');
    await form.getByRole('button',{name:'Request help and pricing',exact:true}).click();
    await expect.poll(async()=>JSON.stringify(await read(page,'/api/blueprint/services'))).toContain('DEMO: help me review this application step.');
    const saved=(await read(page,'/api/blueprint/services')).requests.find(r=>r.serviceKind==='repair_full'&&r.note==='DEMO: help me review this application step.');
    const checkout=full(page).locator('form[data-bf-form="checkout"][data-id="'+saved.id+'"]');
    await expect(checkout).toBeVisible();
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    await expect(checkout).toBeVisible();
    await checkout.locator('input[name="authorization"]').check();
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    const link=full(page).locator('.bf-item').filter({hasText:'full repair program'}).getByRole('link',{name:'Review checkout ↗',exact:true});
    await expect(link).toHaveAttribute('href',/[?&]preview=payment(?:&|$)/);
    await preview(page,context,()=>link.click(),'payment');
    await expect(full(page)).toContainText('Payment received');
  });

  test('DEMO06 a fresh buyer adds separate businesses and payoff edits survive refresh',async({page,context})=>{
    await open(page,context);await finishOnboarding(page);
    const first=await addBusiness(page,'DEMO Cedar Studio');const second=await addBusiness(page,'DEMO Willow Studio');
    expect(first.business.id).not.toBe(second.business.id);
    await full(page).getByRole('button',{name:'Back to Blueprint overview',exact:true}).click();
    await expect(journey(page)).toBeVisible();
    await expect(journey(page)).toContainText('DEMO Cedar Studio');await expect(journey(page)).toContainText('DEMO Willow Studio');
    await expect(journey(page).locator('.bj-next').getByRole('button',{name:'Start my plan',exact:true})).toHaveCount(0);
    expect(Number(await journey(page).locator('.bj-readiness progress').getAttribute('value'))).toBeGreaterThan(0);
    await page.reload();const app=await preparation(page);await app.getByRole('button',{name:'Businesses',exact:true}).click();
    await expect(app.getByRole('heading',{name:'DEMO Cedar Studio',exact:true})).toBeVisible();await expect(app.getByRole('heading',{name:'DEMO Willow Studio',exact:true})).toBeVisible();
    expect((await read(page,'/api/blueprint/plan')).businessPlans.businesses).toHaveLength(2);
    const settings=await openBudget(page);await settings.locator('input[name="monthlyBudget"]').fill('400');await settings.locator('select[name="strategy"]').selectOption('avalanche');
    await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();await page.reload();const saved=await openBudget(page);
    await expect(saved.locator('input[name="monthlyBudget"]')).toHaveValue('400');await expect(saved.locator('select[name="strategy"]')).toHaveValue('avalanche');
  });

  test('DEMO07 preparation letters and uploaded replies use sample metadata only',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});const app=await preparation(page);
    await app.getByRole('button',{name:'Letters and responses',exact:true}).click();
    await expect(app.getByRole('button',{name:'Download letter',exact:true}).first()).toBeVisible();
    await preview(page,context,()=>app.getByRole('button',{name:'Download letter',exact:true}).first().click(),'document');
    const form=app.locator('form[data-bp-form="bureau-response"]');
    await form.locator('input[name="files"]').setInputFiles(sampleFile('demo-preparation-response.pdf'));
    await form.getByRole('button',{name:'Upload response for validation',exact:true}).click();
    await expect(app).toContainText('demo-preparation-response.pdf');
    await expect(app).toContainText(/pending|review/i);
    const storage=await page.evaluate(()=>JSON.stringify(localStorage));
    expect(storage).toContain('demo-preparation-response.pdf');expect(storage).not.toContain(FILE_BODY);expect(storage).not.toContain(Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF').toString('base64'));
  });

  test('DEMO08 fictional bank application and reported outcome never open real banking',async({page,context})=>{
    await open(page,context);await stage(page,'ready');await tab(page,'Applications');
    const data=await read(page,'/api/blueprint/funding');
    expect(data.lenders.length).toBeGreaterThan(0);
    expect(data.lenders.every(l=>/DEMO|sample|fictional/i.test(l.name))).toBe(true);
    await preview(page,context,()=>full(page).getByRole('button',{name:'Open bank application',exact:true}).first().click(),'bank');
    await expect(full(page)).toContainText('Recorded status: Sample submitted');
    const application=full(page).locator('.bf-item').filter({has:page.getByRole('heading',{name:data.lenders[0].name,exact:true})});
    await expect(application.getByText('Report a bank response',{exact:true})).toBeVisible();
    await application.getByText('Report a bank response',{exact:true}).click();
    const form=application.locator('form[data-bf-form="application"]');
    await form.locator('select[name="status"]').selectOption('approved');
    await form.locator('input[name="reference"]').fill('DEMO-BANK-REF-101');
    await form.locator('input[name="approvedAmount"]').fill('10000');
    await form.getByRole('button',{name:'Save bank response',exact:true}).click();
    await expect(full(page)).toContainText('Your report: approved');
    await expect(full(page)).toContainText('waiting for the saved evidence to be checked.');
    const saved=await read(page,'/api/blueprint/funding');
    expect(saved.applications.some(a=>a.lenderId===data.lenders[0].id&&a.reportedStatus==='approved'&&!a.outcomeVerified)).toBe(true);
    expect(saved.applications.every(a=>!a.fundedAmount)).toBe(true);
    await full(page).getByRole('button',{name:'I’m done applying for this round',exact:true}).click();
    await expect(full(page)).toContainText('New submissions are closed.');
  });

  test('DEMO09 initial setup, completed stage and reset remain demo-only',async({page,context})=>{
    await open(page,context);const app=await finishOnboarding(page);
    await expect(app.getByRole('button',{name:'Businesses',exact:true})).toBeVisible();
    await stage(page,'completed');await tab(page,'Today');
    await expect(full(page)).toContainText('Your purchased funding round is complete');
    await tab(page,'Applications');await expect(full(page).getByRole('button',{name:'Open bank application',exact:true})).toHaveCount(0);
    await expect(full(page).locator('form[data-bf-form="application"]')).toHaveCount(0);
    await tab(page,'Reports and help');await expect(full(page).getByRole('button',{name:'Request included report',exact:true})).toHaveCount(0);
    const completed=await read(page,'/api/blueprint/funding');
    expect(completed.applications.length).toBeGreaterThan(0);
    const staleUrl=await page.evaluate(id=>window.FHBlueprintDemo.previewUrl('bank',id),completed.applications[0].id);
    const stale=await context.newPage();await stale.goto(staleUrl);
    await expect(stale.locator('body')).toContainText(/sample|demo/i);
    const submit=stale.getByRole('button',{name:'Submit sample application',exact:true});
    if(await submit.isVisible()&&await submit.isEnabled()){
      await submit.click();
      await expect(stale.locator('[role="status"]')).toContainText(/complete|read.only|unavailable/i);
    }
    await stale.close();
    expect(await read(page,'/api/blueprint/funding'),'A stale bank preview must never rewrite the completed sample round').toEqual(completed);
    await (await demoControl(page,'reset')).click();
    await expect(journey(page)).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo?.scenario)).toBe('start');
    expect(await page.evaluate(()=>localStorage.getItem('unrelated-existing-data'))).toBe('keep-this-value');
  });

  test('DEMO10 existing real session, bank canary and unsupported action stay isolated',async({page,context})=>{
    await open(page,context,{existing:true,scenario:'optimize'});
    const original=await page.evaluate(()=>({token:localStorage.getItem('fh_token'),role:localStorage.getItem('fh_role'),account:localStorage.getItem('fh_account'),demo:localStorage.getItem('fh_demo')}));
    expect(original.token).toBe(TOKEN);
    await tab(page,'Applications');await stage(page,'ready');await tab(page,'Applications');
    await preview(page,context,()=>full(page).getByRole('button',{name:'Open bank application',exact:true}).first().click(),'bank');
    const rejected=await page.evaluate(async()=>{
      const before=JSON.stringify(localStorage),cases=[];
      for(const[path,options]of [['https://external.invalid/bank',{}],['/api/money/private-bank-canary',{}],['/api/blueprint/funding',{method:'POST',body:JSON.stringify({action:'verify_funded'})}]]){
        try{await window.FHBlueprintDemo.request(path,options);cases.push(false);}catch{cases.push(true);}
      }
      return{cases,unchanged:before===JSON.stringify(localStorage),frozen:Object.isFrozen(window.FHBlueprintDemo)};
    });
    expect(rejected).toEqual({cases:[true,true,true],unchanged:true,frozen:true});
    await (await demoControl(page,'reset')).click();
    await expect(journey(page)).toBeVisible();
    expect(await page.evaluate(()=>({token:localStorage.getItem('fh_token'),role:localStorage.getItem('fh_role'),account:localStorage.getItem('fh_account'),demo:localStorage.getItem('fh_demo')}))).toEqual(original);
    expect((await context.cookies()).find(c=>c.name==='fh_session')?.value).toBe(COOKIE);
    await page.evaluate(()=>{localStorage.setItem('fh_token','synthetic-different-account');window.dispatchEvent(new Event('focus'));});
    await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo.isCurrent())).toBe(false);
    await expect(full(page).locator('.bf-tabs')).toHaveCount(0);
    await expect(prep(page).locator('.bp-tabs')).toHaveCount(0);
  });

  test('DEMO11 both offers retain the actual Fundhub chrome and safe Home Progress Documents routes',async({page,context})=>{
    await open(page,context);
    for(const offer of ['preparation','implementation']){
      await selectOffer(page,offer);await stage(page,'optimize');
      await expect(page.locator('.client-ios-header')).toHaveCount(1);
      const nav=page.locator('.client-ios-nav[aria-label="Client portal"]');await expect(nav).toHaveCount(1);
      const logos=page.locator('.client-ios-brand-logo:visible,.client-ios-mobile-logo:visible');
      expect(await logos.count()).toBeGreaterThan(0);
      const logo=await logos.first().evaluate(el=>({image:getComputedStyle(el).backgroundImage,asset:getComputedStyle(el).getPropertyValue('--logo'),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
      expect(logo.width).toBeGreaterThan(0);expect(logo.height).toBeGreaterThan(0);
      expect(logo.asset).toContain('data:image/svg+xml;base64,');
      expect(logo.image).toContain(logo.asset.match(/base64,([^\s)"']+)/)[1].slice(0,64));
      await expect(page.locator('h1:visible'),'The product has one visible heading, not a separate demo dashboard').toHaveCount(1);
      for(const name of ['Home','Progress','Documents']){
        const href=await nav.getByRole('link',{name,exact:true}).getAttribute('href');const destination=new URL(href,page.url());
        expect(destination.origin).toBe(new URL(page.url()).origin);
        expect(destination.searchParams.get('demo')).toBe('1');expect(destination.searchParams.get('blueprint')).toBe('full');
        expect(destination.searchParams.has('client_id')).toBe(false);
      }
      await nav.getByRole('link',{name:'Progress',exact:true}).click();
      expect(new URL(page.url()).pathname).toBe('/progress.html');
      await expect(page.locator('#hTitle')).toContainText('Your progress');
      await expect(page.locator('#progressLoading')).toBeHidden();
      const progress=await read(page,'/api/read/client-progress');
      for(const panel of progress.scores.personal){await expect(page.locator('#cScores')).toContainText(new RegExp(panel.bureau,'i'));if(panel.score!=null)await expect(page.locator('#cScores')).toContainText(String(panel.score));}
      await noOverflow(page);
      await page.locator('.client-ios-nav').getByRole('link',{name:'Documents',exact:true}).click();
      expect(new URL(page.url()).searchParams.get('view')).toBe('documents');
      const letters=(await read(page,'/api/blueprint/letter-mailing')).letters;
      expect(letters.length).toBeGreaterThan(0);
      const owned=(await read(page,'/api/read/documents')).items.find(d=>d.id===letters[0].documentId);
      expect(owned,'The current letter must be the same owned document in Documents').toBeTruthy();
      const savedDocument=page.getByRole('link',{name:owned.title,exact:true});await expect(savedDocument).toBeVisible();
      expect(new URL(await savedDocument.getAttribute('href'),page.url()).searchParams.get('item')).toBe(letters[0].documentId);
      await expect(page.locator('.client-ios-nav').getByRole('link',{name:'Documents',exact:true})).toHaveAttribute('aria-current','page');
      await noOverflow(page);
      await page.locator('.client-ios-nav').getByRole('link',{name:'Home',exact:true}).click();
      await expect(journey(page)).toBeVisible();expect(await page.evaluate(()=>window.FHBlueprintDemo.offer)).toBe(offer);
    }
  });

  test('DEMO12 preparation scope offers CSM help without silently granting the implementation engine',async({page,context})=>{
    await open(page,context,{offer:'preparation',scenario:'optimize'});
    const plan=await read(page,'/api/blueprint/plan');
    expect(plan.offer).toMatchObject({productCode:'consulting-package',priceCents:1000000,minimumCents:500000,maximumCents:1000000,hasFundingEngine:false});
    await expect(banner(page)).toContainText('$10,000');
    await expect(journey(page)).toContainText(/funding engine.*not included|does not include.*funding engine/i);
    await expect(full(page)).toBeHidden();
    await expect(page.getByRole('button',{name:'Open bank application',exact:true})).toHaveCount(0);
    const denied=await page.evaluate(async()=>{
      const before=JSON.stringify(localStorage),out=[];
      for(const kind of ['funding','inquiries','repair','services']){
        try{await window.FHBlueprintDemo.request('/api/blueprint/'+kind);out.push(null);}
        catch(error){out.push({code:error.code,status:error.status});}
      }
      return{out,unchanged:before===JSON.stringify(localStorage)};
    });
    expect(denied).toEqual({out:Array.from({length:4},()=>({code:'full_blueprint_required',status:403})),unchanged:true});
    const before=(await read(page,'/api/chat/portal-message')).messages.length;
    const app=await preparation(page);
    for(const [label,prefill,question] of [
      ['Upgrade or request funding help',/upgrading.*implementation.*funding/i,'DEMO: Please explain implementation upgrade and CSM-managed funding scope.'],
      ['Aged business options',/aged business options/i,'DEMO: Please review whether an aged company fits my actual records and ownership history.'],
      ['Repair: per round or full',/DIY repair.*per round.*full credit repair/i,'DEMO: Please compare DIY, per-round and full repair pricing for my current file.']
    ]){
      if(!await journey(page).isVisible())await app.getByRole('button',{name:'Today',exact:true}).click();
      await journey(page).getByRole('button',{name:label,exact:true}).click();
      const form=app.locator('form[data-bp-form="help"]');
      await expect(form.locator('textarea[name="message"]')).toHaveValue(prefill);
      await form.locator('textarea[name="message"]').fill(question);
      await form.getByRole('button',{name:'Send to my Fundhub conversation',exact:true}).click();
      await expect(app).toContainText('Your message is saved in your Fundhub conversation.');
      await expect.poll(async()=>(await read(page,'/api/chat/portal-message')).messages.some(m=>(m.body||m.rendered_body)===question)).toBe(true);
    }
    expect((await read(page,'/api/chat/portal-message')).messages).toHaveLength(before+3);
    await page.reload();expect(await page.evaluate(()=>window.FHBlueprintDemo.offer)).toBe('preparation');
    await expect(full(page)).toBeHidden();
    expect((await read(page,'/api/read/entitlements')).items.some(e=>e.entitlement_code==='blueprint-client-fulfillment')).toBe(false);
    await selectOffer(page,'implementation');await stage(page,'optimize');
    const fullPlan=await read(page,'/api/blueprint/plan');
    expect(fullPlan.offer).toMatchObject({productCode:'blueprint-self-funding',priceCents:3000000,minimumCents:2000000,maximumCents:3000000,hasFundingEngine:true});
    await expect(journey(page)).toContainText(/includes.*funding engine/i);
    await tab(page,'Reports and help');
    const kinds=full(page).locator('select[name="serviceKind"]');
    await expect(kinds.locator('option[value="repair_round"]')).toContainText(/repair round/i);
    await expect(kinds.locator('option[value="repair_full"]')).toContainText(/full repair program/i);
    await expect(kinds.locator('option[value="funding_round"]')).toContainText(/funding round/i);
  });

  test('DEMO13 report facts and shared UnderwriteIQ capacity change only with a report, not a checked task',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});
    const before=await read(page,'/api/blueprint/plan');const progress=await read(page,'/api/read/client-progress');
    const money=await read(page,'/api/money/fundability');
    expect(before.creditContext.reportId).toBeTruthy();expect(before.creditContext.asOf).toBeTruthy();
    expect(before.opportunity.source).toEqual({reportId:before.creditContext.reportId,asOf:before.creditContext.asOf});
    expect(progress.opportunity).toEqual(before.opportunity);expect(money.opportunity).toEqual(before.opportunity);
    expect(before.opportunity.basis).toBe('current_crs_engine');
    for(const panel of progress.scores.personal){
      expect(panel.score).toBeGreaterThan(0);
      await expect(journey(page).locator('.bj-credit')).toContainText(new RegExp(panel.bureau,'i'));
      await expect(journey(page).locator('.bj-credit')).toContainText(String(panel.score));
      expect(panel.pulledAt).toBe(before.creditContext.asOf);
    }
    await expect(journey(page)).toContainText(new Date(before.creditContext.asOf).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}));
    const personal=before.opportunity.personal;
    expect(personal.currentCents).toBeGreaterThan(0);expect(personal.projectedCents).toBeGreaterThanOrEqual(personal.currentCents);
    await expect(journey(page)).toContainText((personal.currentCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}));
    expect(before.opportunity.businesses).toHaveLength(before.businessPlans.businesses.length);
    for(const business of before.opportunity.businesses){
      expect(business.currentCents).toBeNull();expect(business.liftCents).toBeNull();
      expect(business.blockers).toContain('matched_business_credit_report_required');
      await expect(journey(page)).toContainText(business.name);
    }
    expect(before.opportunity.combined.currentCents).toBeNull();
    expect(before.opportunity.combined.status).toBe('overlap_review_required');
    expect(before.opportunity.steps.filter(s=>['formation','ein','business_credit','bank_preparation'].includes(s.key)).every(s=>s.liftCents===null)).toBe(true);
    const readiness=journey(page).locator('.bj-readiness');
    await expect(readiness).toContainText(/checklist/i);await expect(journey(page)).toContainText(/not.*approval|not.*guarantee/i);
    await expect(journey(page).locator('.bj-fundability-state')).toHaveText('Preparing your credit file');
    const blockers=journey(page).getByRole('list',{name:'Remaining fundability checks',exact:true});
    await expect(blockers).toContainText('State filing proof needed');await expect(blockers).toContainText('EIN proof needed');
    await expect(blockers).toContainText('Matching business report needed');
    await preview(page,context,()=>journey(page).getByRole('button',{name:'Open full credit report',exact:true}).click(),'document',async popup=>{
      await expect(popup.locator('body')).toContainText(before.creditContext.reportId);
      for(const panel of progress.scores.personal)await expect(popup.locator('body')).toContainText(String(panel.score));
      await expect(popup.locator('body')).toContainText(/Full sample credit report/i);
    });
    const percent=await readiness.locator('progress').getAttribute('value');
    const clientStep=progress.waypoints.find(w=>w.key==='form_llc'&&w.closedBy==='client');expect(clientStep).toBeTruthy();
    await page.locator('.client-ios-nav').getByRole('link',{name:'Progress',exact:true}).click();
    const tick=page.locator('[data-wp="'+clientStep.id+'"] button[data-tick]');
    await expect(tick).toHaveAttribute('aria-checked','false');await tick.click();await expect(tick).toHaveAttribute('aria-checked','true');
    await page.locator('.client-ios-nav').getByRole('link',{name:'Home',exact:true}).click();await expect(journey(page)).toBeVisible();
    const ticked=await read(page,'/api/blueprint/plan');
    expect(ticked.progress.waypoints.find(w=>w.id===clientStep.id).state).toBe('done');
    expect(ticked.creditContext).toEqual(before.creditContext);expect(ticked.opportunity).toEqual(before.opportunity);
    expect(Number(await journey(page).locator('.bj-readiness progress').getAttribute('value'))).toBeGreaterThan(Number(percent));
    await expect(journey(page).locator('.bj-fundability-state')).toHaveText('Preparing your credit file');
    await expect(journey(page).getByRole('list',{name:'Remaining fundability checks',exact:true})).toContainText('Matching business report needed');
    await stage(page,'ready');
    const updated=await read(page,'/api/blueprint/plan');const later=await read(page,'/api/read/client-progress');
    expect(updated.creditContext.reportId).not.toBe(before.creditContext.reportId);
    expect(new Date(updated.creditContext.asOf).getTime()).toBeGreaterThan(new Date(before.creditContext.asOf).getTime());
    expect(updated.opportunity).toEqual((await read(page,'/api/money/fundability')).opportunity);
    expect(updated.opportunity.personal.currentCents).toBeGreaterThan(before.opportunity.personal.currentCents);
    expect(later.scores.personal.map(s=>s.score)).not.toEqual(progress.scores.personal.map(s=>s.score));
    for(const panel of later.scores.personal)await expect(journey(page).locator('.bj-credit')).toContainText(String(panel.score));
    await expect(journey(page).locator('.bj-fundability-state')).toHaveText('Permitted bank ready');
    await noOverflow(page);
  });

  test('DEMO14 selected current letters bind the one-time $97 quote, authorization and payment status',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});const app=await preparation(page);
    await app.getByRole('button',{name:'Letters and responses',exact:true}).click();
    const letters=(await read(page,'/api/blueprint/letter-mailing')).letters.filter(l=>l.eligibleForMailing);
    expect(letters.length).toBeGreaterThanOrEqual(2);
    for(const letter of letters)await app.locator('[data-mail-letter="'+letter.documentId+'"]').setChecked(letter.documentId===letters[0].documentId);
    await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();
    const form=app.locator('form[data-bp-form="mail-confirm"]');
    await expect(form).toContainText('Total $97.00 USD');
    await expect(form).toContainText(letters[0].title);await expect(form).not.toContainText(letters[1].title);
    const first=(await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.status==='quoted');
    expect(first?.quoteVersion).toBeTruthy();
    expect(first.items.map(x=>x.documentId)).toEqual([letters[0].documentId]);
    await app.locator('[data-mail-letter="'+letters[1].documentId+'"]').check();
    await expect(form,'Changing selection must invalidate the visible accepted quote').toHaveCount(0);
    await app.getByRole('button',{name:'Mail these letters for me · $97',exact:true}).click();
    await expect(form).toContainText(letters[1].title);
    const quote=(await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.status==='quoted');
    expect(quote.quoteVersion).not.toBe(first.quoteVersion);
    expect(quote.items.map(x=>x.documentId).sort()).toEqual([letters[0].documentId,letters[1].documentId].sort());
    expect(quote.totalCents).toBe(9700);expect(quote.currency).toBe('USD');
    const auth=form.locator('input[name="authorization"]');await expect(auth).not.toBeChecked();
    await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();
    expect((await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.id===quote.id).status).toBe('quoted');
    await auth.check();await form.getByRole('button',{name:'Confirm $97 and mail my letters',exact:true}).click();
    const pending=(await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.id===quote.id);
    expect(pending.status).toBe('payment_pending');expect(pending.quoteVersion).toBe(quote.quoteVersion);
    expect(pending.items.map(x=>x.documentId).sort()).toEqual(quote.items.map(x=>x.documentId).sort());
    const checkout=app.getByRole('link',{name:'Continue secure payment',exact:true});
    await expect(checkout).toHaveAttribute('href',/[?&]preview=payment(?:&|$)/);
    await checkout.click();await expect(page).toHaveURL(/[?&]preview=payment(?:&|$)/);
    await page.getByRole('button',{name:'Record sample payment',exact:true}).click();
    await expect(page.locator('[role="status"]')).toContainText('No charge was made.');
    await page.getByRole('link',{name:/Back to.*dashboard/i}).click();
    await expect(journey(page)).toBeVisible();
    const paid=(await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.id===quote.id);
    expect(paid.status).toBe('mail_pending');expect(paid.paymentState).toBe('paid');expect(paid.totalCents).toBe(9700);
    await (await demoControl(page,'advance')).click();
    const accepted=(await read(page,'/api/blueprint/letter-mailing')).orders.find(o=>o.id===quote.id);
    expect(accepted.status).toBe('mailed');expect(accepted.envelopes.length).toBeGreaterThan(0);
    expect(accepted.envelopes.every(e=>/accepted/i.test(e.status)&&!e.trackingUrl)).toBe(true);
    expect(accepted.envelopes.every(e=>!/delivered/i.test(e.status))).toBe(true);
    await page.reload();expect((await read(page,'/api/blueprint/letter-mailing')).orders.filter(o=>o.id===quote.id)).toHaveLength(1);
  });

  test('DEMO15 full funding takeover needs its exact quote and paid receipt and preserves its round',async({page,context})=>{
    await open(page,context,{scenario:'optimize'});await tab(page,'Reports and help');
    const before=await read(page,'/api/blueprint/funding');expect(before.engagement.executionOwner).toBe('client');
    const help=full(page).locator('form[data-bf-form="service"]');
    const options=await help.locator('select[name="serviceKind"] option').evaluateAll(nodes=>nodes.map(n=>n.value));
    expect(options).toEqual(expect.arrayContaining(['repair_round','repair_full','funding_round']));
    await help.locator('select[name="serviceKind"]').selectOption('funding_round');
    await help.locator('textarea[name="note"]').fill('DEMO: Have Fundhub operate this purchased funding round.');
    await help.getByRole('button',{name:'Request help and pricing',exact:true}).click();
    const request=(await read(page,'/api/blueprint/services')).requests.find(r=>r.serviceKind==='funding_round'&&r.note?.includes('DEMO: Have Fundhub'));
    expect(request.status).toBe('requested');expect(request.priceCents).toBeNull();
    expect((await read(page,'/api/blueprint/funding')).engagement.executionOwner).toBe('client');
    await (await demoControl(page,'advance')).click();await tab(page,'Reports and help');
    const quoted=(await read(page,'/api/blueprint/services')).requests.find(r=>r.id===request.id);
    expect(quoted.status).toBe('quoted');expect(quoted.priceCents).toBeGreaterThan(0);
    const checkout=full(page).locator('form[data-bf-form="checkout"][data-id="'+request.id+'"]');
    await expect(checkout).toContainText((quoted.priceCents/100).toLocaleString('en-US',{style:'currency',currency:'USD'}));
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    expect((await read(page,'/api/blueprint/funding')).engagement.executionOwner).toBe('client');
    await checkout.locator('input[name="authorization"]').check();
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    expect((await read(page,'/api/blueprint/funding')).engagement.executionOwner).toBe('client');
    const accepted=(await read(page,'/api/blueprint/services')).requests.find(r=>r.id===request.id);
    expect(accepted.status).toBe('awaiting_payment');expect(new URL(accepted.checkoutUrl).searchParams.get('item')).toBe(request.id);
    const payment=full(page).locator('a[href="'+accepted.checkoutUrl+'"]');
    await preview(page,context,()=>payment.click(),'payment');
    await expect.poll(async()=>(await read(page,'/api/blueprint/funding')).engagement.executionOwner).toBe('fundhub');
    const after=await read(page,'/api/blueprint/funding');expect(after.state).toBe('managed');
    expect(after.engagement.id).toBe(before.engagement.id);expect(after.engagement.roundId).toBe(before.engagement.roundId);
    expect(after.applications.map(a=>a.id)).toEqual(before.applications.map(a=>a.id));
    await tab(page,'Today');
    await expect(journey(page)).toContainText(/Fundhub team/i);
    await expect(journey(page).locator('.bj-fundability-state')).toHaveText('Fundhub is running this round');
  });


  test('DEMO16 preparation buyer gets useful state LLC and EIN guidance and distinct document evidence',async({page,context})=>{
    await open(page,context,{offer:'preparation'});await finishOnboarding(page);
    const{app,business}=await addBusiness(page,'DEMO First Business LLC');
    await expect(app).toContainText('Add the formation document before uploading this business’s EIN letter.');
    await expect(app.locator('form[data-bp-form="evidence"][data-kind="ein"]')).toHaveCount(0);
    const plan=await read(page,'/api/blueprint/plan');const lessons=plan.businessLessons.find(x=>x.planId===business.id).lessons;
    const formation=lessons.find(x=>x.key==='formation');
    await app.getByRole('button',{name:formation.title,exact:true}).click();
    await expect(app).toContainText(/single-member LLC/i);
    await preview(page,context,()=>app.getByRole('link',{name:formation.links[0].label+' ↗',exact:true}).click(),'document',async popup=>{
      await expect(popup.locator('body')).toContainText('azcc.gov/corporations');
      await expect(popup.locator('body')).toContainText(formation.title);
      await expect(popup.locator('body')).toContainText(/formation document|formation record/i);
    });
    await app.getByRole('button',{name:'Businesses',exact:true}).click();await app.getByRole('button',{name:'Open this business',exact:true}).click();
    const form=app.locator('form[data-bp-form="evidence"][data-kind="formation"]');
    await form.locator('input[name="file"]').setInputFiles(sampleFile('demo-state-formation.pdf'));
    await form.getByRole('button',{name:'Upload formation document',exact:true}).click();
    await expect(app).toContainText('Evidence received');
    const einForm=app.locator('form[data-bp-form="evidence"][data-kind="ein"]');await expect(einForm).toBeVisible();
    await einForm.locator('input[name="file"]').setInputFiles(sampleFile('demo-ein-confirmation.pdf'));
    await einForm.getByRole('button',{name:'Upload EIN confirmation',exact:true}).click();
    const saved=(await read(page,'/api/blueprint/plan')).businessPlans.businesses.find(b=>b.id===business.id);
    expect(saved.formationStatus).toBe('planned');expect(saved.evidence.formation.status).toBe('evidence_received');expect(saved.evidence.ein.status).toBe('evidence_received');
    const ein=lessons.find(x=>x.key==='ein');await app.getByRole('button',{name:ein.title,exact:true}).click();
    await preview(page,context,()=>app.getByRole('link',{name:ein.links[0].label+' ↗',exact:true}).click(),'document',async popup=>{
      await expect(popup.locator('body')).toContainText('irs.gov/businesses/small-businesses-self-employed/get-an-employer-identification-number');
      await expect(popup.locator('body')).toContainText(/confirmation|EIN/i);
    });
    const store=await page.evaluate(()=>JSON.stringify(localStorage));expect(store).not.toContain(FILE_BODY);
    expect(store).not.toContain(Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF').toString('base64'));
  });

  test('DEMO17 existing FinanceOS renders the same sample client report businesses and local CSM request',async({page,context})=>{
    test.setTimeout(90000);
    await open(page,context,{existing:true});
    for(const offer of ['preparation','implementation']){
      await selectOffer(page,offer);await stage(page,'optimize');
      const plan=await read(page,'/api/blueprint/plan');const progress=await read(page,'/api/read/client-progress');
      const destination=page.locator('a[href*="/app/financeos.html"]:visible').first();
      await expect(destination,'FinanceOS must be reachable from the actual portal').toBeVisible();
      const href=new URL(await destination.getAttribute('href'),page.url());
      expect(href.origin).toBe(new URL(page.url()).origin);expect(href.searchParams.get('demo')).toBe('1');expect(href.searchParams.get('blueprint')).toBe('full');
      await destination.click();expect(new URL(page.url()).pathname).toBe('/app/financeos.html');
      await expect(page.locator('#fos-client')).toHaveText('Alex Sample');
      const credit=await financeTab(page,'credit');const creditData=await read(page,'/api/money/credit');
      expect(creditData.report_id).toBe(plan.creditContext.reportId);expect(creditData.as_of).toBe(plan.creditContext.asOf);
      for(const panel of progress.scores.personal){
        expect(creditData.personal[panel.bureau].score).toBe(panel.score);
        await expect(credit).toContainText(new RegExp(panel.bureau,'i'));await expect(credit).toContainText(String(panel.score));
      }
      const capacity=await financeTab(page,'fundability');const data=await read(page,'/api/money/fundability');
      expect(data.opportunity).toEqual(plan.opportunity);
      await expect(capacity).toContainText((plan.opportunity.personal.currentCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}));
      for(const business of plan.businessPlans.businesses)await expect(capacity).toContainText(business.name);
      await expect(capacity).toContainText(/not an approval|not a bank.s yes/i);
      const accounts=await financeTab(page,'accounts');
      for(const business of plan.businessPlans.businesses)await expect(accounts).toContainText(business.name);
      const overview=await read(page,'/api/money/overview');
      expect(overview.client.id).toBe(plan.businessPlans.clientId);
      expect(overview.accounts.every(a=>a.sample===true&&/sample/i.test(a.name+' '+a.institution))).toBe(true);
      await financeTab(page,'overview');
      await page.locator('#fos-overview').getByRole('button',{name:'Connect a bank',exact:true}).click();
      await expect(page.locator('#fos-overview .act-msg')).toContainText(/sample|demo|no.*bank|not.*connect|unavailable/i);
      expect((await read(page,'/api/money/overview')).accounts).toEqual(overview.accounts);
      const next=await financeTab(page,'next');
      await next.getByRole('button',{name:'I’m ready to get funded',exact:true}).or(next.getByRole('button',{name:"I'm ready to get funded",exact:true})).click();
      await expect(next).toContainText('Sent to our team');
      const ready=await read(page,'/api/money/ready-to-fund');expect(ready.status).toBe('requested');expect(ready.task_id).toBeTruthy();
      await page.reload();await expect(page.locator('#fos-next')).toBeVisible();await expect(page.locator('#fos-next')).toContainText('Sent to our team');
      expect((await read(page,'/api/money/ready-to-fund')).task_id).toBe(ready.task_id);
      for(const key of ['payments','transfers','alerts','strategy','banks','declines','helper','plan','vault','connections','setup']){
        const section=await financeTab(page,key);await noOverflow(page);
        if(key==='setup'){
          await expect(section).not.toContainText('Price not set yet');
          await expect(section.getByRole('button',{name:/^Pay .*setup$/})).toHaveCount(0);
          await expect(section).toContainText(/setup fee.*included|one-time setup.*paid|included.*Blueprint|no setup fee/i);
        }
      }
      await page.locator('.client-ios-nav').getByRole('link',{name:'Home',exact:true}).click();await expect(journey(page)).toBeVisible();
      expect(await page.evaluate(()=>window.FHBlueprintDemo.offer)).toBe(offer);
      expect((await read(page,'/api/blueprint/plan')).opportunity).toEqual(plan.opportunity);
      if(offer==='preparation')await expect(full(page)).toBeHidden();
    }
  });

});

test('generic demo does not silently turn into a paid full Blueprint workspace',async({page,context})=>{
  // The pre-existing generic demo retains its normal shell reads. It is not
  // the explicit full demo, so the full route's zero-API rule does not apply.
  // Fence those unrelated reads locally; never use a real account for this regression.
  await context.route('**/api/**',route=>route.fulfill({json:new URL(route.request().url()).pathname==='/api/auth/session'
    ?{ok:true,staff:{id:'fixture-demo-owner',role:'owner',name:'DEMO Owner',status:'active'}}
    :{ok:true,items:[],documents:[],scores:{},entitlements:[]}}));
  await page.goto(url('/app/client-portal.html?demo=1'));
  expect(await page.evaluate(()=>window.FHBlueprintDemo?.active===true)).toBe(false);
  expect(await page.evaluate(()=>window.__fhBlueprintFullDemoRoute)).toBe(false);
  await expect(full(page)).toBeHidden();await expect(prep(page)).toBeHidden();
});

test('LOCAL real client route renders the shared journey from the real plan builder and retries a failed read',async({page,context})=>{
  // Separate local renderer/handler fixture, never counted as deployed demo,
  // database, customer, payment or provider proof. The real plan aggregator
  // receives in-memory fictional scoped rows; the browser uses normal APIs.
  const {readFile}=await import('node:fs/promises');
  const {buildBlueprintClientPlan}=await import('../src/blueprint/client-plan.mjs');
  const {preparationGuidance,websitePrompt}=await import('../src/blueprint/preparation-guidance.mjs');
  const seed=JSON.parse(await readFile(new URL('../public/app/blueprint-demo-data.json',import.meta.url),'utf8'));
  const snapshot=seed.creditSnapshots.initial,ids=seed.ids;
  const plans=structuredClone(seed.plan.businessPlans);plans.startedAt=seed.generatedAt;
  const progress=structuredClone(seed.plan.progress);progress.waypoints=structuredClone(seed.canonicalWaypoints);
  progress.nextStep={waypointId:progress.waypoints[0].id,owner:'client'};
  progress.scores={personal:[['experian','ex'],['equifax','eq'],['transunion','tu']].map(([bureau,key])=>({bureau,score:snapshot.analysis.consumerSignals.scores.perBureau[key],pulledAt:snapshot.source.asOf,reportDocumentId:ids.report})),business:[]};
  const client={id:ids.client,org_id:ids.org,first_name:'Alex',last_name:'Sample',custom_fields:{}};
  const db={query:async sql=>({rows:/FROM clients/.test(sql)?[client]:/FROM crs_results/.test(sql)?[{id:snapshot.source.reportId,org_id:ids.org,client_id:ids.client,provider:'crs_softview',created_at:snapshot.source.asOf,result:snapshot.analysis}]:[]})};
  const plan=await buildBlueprintClientPlan(db,{orgId:ids.org,clientId:ids.client,now:new Date(seed.generatedAt)},{
    readBusinessPlans:async()=>plans,readClientProgress:async()=>progress,preparationGuidance,websitePrompt,
    bankStrategy:async()=>({ok:true,client:{id:ids.client},recommended_banks:[]}),
    rankLocalCreditUnions:async()=>({status:'candidates_for_review',candidates:[],limitations:[]})
  });
  let reads=0;const requested=[];
  await context.route(/^https?:\/\//,route=>new URL(route.request().url()).origin===new URL(test.info().project.use.baseURL).origin?route.fallback():route.abort());
  await context.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;requested.push(path);
    if(path==='/api/blueprint/plan'){
      reads++;return route.fulfill({status:reads===1?503:200,json:reads===1?{ok:false,error:'fixture_read_failure',message:'Controlled saved-plan read failure.'}:plan});
    }
    if(['/api/blueprint/funding','/api/dashboard/client','/api/read/client-alias'].includes(path))return route.fulfill({status:403,json:{ok:false,error:'forbidden'}});
    const replies={
      '/api/auth/session':seed.session,
      '/api/read/client-progress':progress,
      '/api/read/portal-summary':{...seed.portalSummary,documents:[],payments:[],sample:false},
      '/api/read/portal-contracts':{ok:true,items:[]},
      '/api/read/entitlements':{ok:true,items:[]},
      '/api/read/documents':{ok:true,items:[]},
      '/api/read/client':{ok:true,client,transactions:[],messages:[],tasks:[],crs_results:[]},
      '/api/read/affiliate-portal':{ok:true,enrolled:false,affiliate:null},
      '/api/money/overview':{ok:true,client:{id:ids.client,name:'Alex Sample'},cash:{personal:{cents:0},business:{cents:null}}},
      '/api/money/ready-to-fund':{ok:true,status:'none',offers:{}},
      '/api/chat/portal-message':{ok:true,messages:[]},
      '/api/content/welcome-video':{ok:true,video:null},
      '/api/org-brand':{ok:true,brand:null}
    };
    return route.fulfill({status:Object.hasOwn(replies,path)?200:404,json:replies[path]||{ok:false,error:'fixture_unavailable'}});
  });
  await page.addInitScript(()=>{window.__realFixtureOriginalFetch=window.fetch;localStorage.setItem('fh_token','local-real-route-fixture-only');localStorage.setItem('fh_role','client');});
  await page.goto('/app/client-portal.html');
  await expect(prep(page).getByRole('heading',{name:'Your Blueprint couldn’t load.',exact:true})).toBeVisible();
  await expect(prep(page)).toContainText('Your saved progress has not been replaced.');
  await prep(page).getByRole('button',{name:'Try again',exact:true}).click();
  await expect(journey(page)).toHaveCount(1);await expect(journey(page)).toBeVisible();
  expect(reads).toBeGreaterThanOrEqual(2);expect(requested).toContain('/api/blueprint/plan');
  expect(await page.evaluate(()=>window.FHBlueprintDemo?.active===true)).toBe(false);
  expect(await page.evaluate(()=>window.fetch===window.__realFixtureOriginalFetch)).toBe(true);
  for(const panel of progress.scores.personal)await expect(journey(page).locator('.bj-credit')).toContainText(String(panel.score));
  await expect(journey(page).locator('.bj-capacity')).toContainText((plan.creditContext.opportunity.personal.currentCents/100).toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}));
  await expect(journey(page).locator('.bj-next a')).toHaveAttribute('href','/progress.html');
  await expect(page.locator('.client-ios-header')).toBeVisible();await noOverflow(page);
});
