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
const sampleFile=name=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n'+FILE_BODY+'\n%%EOF')});

async function open(page,context,{existing=false}={}){
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
  await expect(full(page)).toBeVisible();
  await expect(full(page).locator('.bf-tabs')).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo?.active===true)).toBe(true);
  return seen;
}
async function tab(page,name){await full(page).getByRole('button',{name,exact:true}).click();}
async function preparation(page){await tab(page,'Preparation steps');await expect(prep(page)).toBeVisible();return prep(page);}
async function stage(page,value){
  await banner(page).locator('[data-blueprint-demo-control="scenario"]').selectOption(value);
  await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo.scenario)).toBe(value);
  await expect(full(page).locator('.bf-tabs')).toBeVisible();
}
async function read(page,path){return page.evaluate(path=>window.FHBlueprintDemo.request(path),path);}
async function preview(page,context,trigger,kind){
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
  await popup.close();
}
async function noOverflow(page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
}
async function openBudget(page){
  const app=await preparation(page);
  await app.getByRole('button',{name:'Step-by-step help',exact:true}).click();
  await app.locator('[data-bp-action="lesson"][data-key="budget"]').click();
  return app.locator('form[data-bp-form="payoff-settings"]');
}

test.afterEach(async({page},info)=>{
  const seen=trackers.get(page);if(!seen)return;
  expect(seen.api,'Demo must never contact any real API, even with an existing session').toEqual([]);
  expect(seen.external,'Demo must never open a bank, Plaid, payment or other external service').toEqual([]);
  expect(seen.errors,'Actual renderer must have no uncaught errors').toEqual([]);
  if(!page.isClosed()){
    expect(await page.evaluate(()=>window.fetch===window.__blueprintOriginalFetch),'Demo must preserve native fetch').toBe(true);
    await expect(page.locator('body')).not.toContainText(CANARY);
  }
  await info.attach('blueprint-demo-isolation',{body:Buffer.from(JSON.stringify({url:page.url(),api:seen.api,external:seen.external,errors:seen.errors,live:!!LIVE},null,2)),contentType:'application/json'});
});

for(const width of [1440,390])test.describe(`Full Blueprint demo ${width}px`,()=>{
  test.use({viewport:{width,height:1000}});
  test.describe.configure({timeout:60000});

  test('DEMO01 real full-offer renderer and sample next step are visible',async({page,context})=>{
    await open(page,context);
    await expect(banner(page)).toContainText('$30,000');
    await expect(banner(page)).toContainText(/full implementation/i);
    await expect(banner(page)).toContainText(/sample|fictional/i);
    await expect(full(page).getByRole('heading',{name:'My funding workspace',exact:true})).toBeVisible();
    await expect(full(page).locator('.bf-next')).toBeVisible();
    await expect(prep(page)).toBeHidden();
    for(const id of ['unlock-modal','book-modal']){
      const modal=page.locator('#'+id);
      await expect(modal,'Legacy payment/booking dialog must be absent from the full-demo interaction surface').toBeHidden();
      expect(await modal.evaluate(element=>{element.querySelector('button,[tabindex],input,a[href]')?.focus();return element.contains(document.activeElement);}), 'Hidden legacy controls must never accept focus').toBe(false);
    }
    expect((await read(page,'/api/blueprint/funding')).engagement.status).toBe('active');
    await expect(full(page).locator('nav[aria-label="Funding workspace"] button')).toHaveCount(6);
    await noOverflow(page);
  });

  test('DEMO02 all actual full-workspace tabs and preparation navigation work',async({page,context})=>{
    await open(page,context);
    const screens=[['Credit repair','Your credit repair work'],['Inquiry removal','Your bureau work'],['Applications','Your permitted banks'],['Reports and help','Your credit report']];
    for(const[name,text]of screens){await tab(page,name);await expect(full(page)).toContainText(text);await noOverflow(page);}
    const app=await preparation(page);
    for(const name of ['Businesses','Step-by-step help','Timeline','Get help']){
      await app.getByRole('button',{name,exact:true}).click();
      await expect(app.locator('button[aria-current="page"]')).toHaveText(name);
      await noOverflow(page);
    }
    await tab(page,'Today');await expect(full(page).locator('.bf-next')).toBeVisible();
  });

  test('DEMO03 inquiry receipt and authorized AI request remain simulated',async({page,context})=>{
    await open(page,context);await tab(page,'Inquiry removal');
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
    await open(page,context);await tab(page,'Credit repair');
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
    await open(page,context);await tab(page,'Reports and help');
    await full(page).getByRole('button',{name:'Request included report',exact:true}).click();
    await expect(full(page)).toContainText('A report request is already in progress.');
    const form=full(page).locator('form[data-bf-form="service"]');
    await form.locator('textarea[name="note"]').fill('DEMO: help me review this application step.');
    await form.getByRole('button',{name:'Request help and pricing',exact:true}).click();
    await expect.poll(async()=>JSON.stringify(await read(page,'/api/blueprint/services'))).toContain('DEMO: help me review this application step.');
    const checkout=full(page).locator('form[data-bf-form="checkout"]').first();
    await expect(checkout).toBeVisible();
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    await expect(checkout).toBeVisible();
    await checkout.locator('input[name="authorization"]').check();
    await checkout.getByRole('button',{name:'Review payment options',exact:true}).click();
    const link=full(page).getByRole('link',{name:'Review checkout ↗',exact:true}).first();
    await expect(link).toHaveAttribute('href',/[?&]preview=payment(?:&|$)/);
    await preview(page,context,()=>link.click(),'payment');
    await expect(full(page)).toContainText('Payment received');
  });

  test('DEMO06 separate businesses and payoff edits survive refresh',async({page,context})=>{
    await open(page,context);const app=await preparation(page);
    await app.getByRole('button',{name:'Businesses',exact:true}).click();
    await expect(app.getByRole('button',{name:'Open this business',exact:true})).toHaveCount(3);
    await app.getByRole('button',{name:'Open this business',exact:true}).first().click();
    await app.locator('input[name="name"]').fill('DEMO Cedar Studio updated');
    await app.getByRole('button',{name:'Save business plan',exact:true}).click();
    await page.reload();await preparation(page);await app.getByRole('button',{name:'Businesses',exact:true}).click();
    await expect(app.getByRole('heading',{name:'DEMO Cedar Studio updated',exact:true})).toBeVisible();
    const settings=await openBudget(page);
    await settings.locator('input[name="monthlyBudget"]').fill('400');
    await settings.locator('select[name="strategy"]').selectOption('avalanche');
    await settings.getByRole('button',{name:'Save payoff approach',exact:true}).click();
    await page.reload();const saved=await openBudget(page);
    await expect(saved.locator('input[name="monthlyBudget"]')).toHaveValue('400');
    await expect(saved.locator('select[name="strategy"]')).toHaveValue('avalanche');
  });

  test('DEMO07 preparation letters and uploaded replies use sample metadata only',async({page,context})=>{
    await open(page,context);const app=await preparation(page);
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
    await open(page,context);await stage(page,'start');const app=await preparation(page);
    await app.getByRole('button',{name:'Start my plan',exact:true}).click();
    await expect(app.getByText('Do you already own a business?',{exact:true})).toBeVisible();
    await app.getByText('No, I’m preparing my first business',{exact:true}).click();
    await app.getByRole('button',{name:'Save and continue',exact:true}).click();
    await app.getByRole('button',{name:'Save and continue',exact:true}).click();
    await app.locator('select[name="homeState"]').selectOption('AZ');
    await app.locator('input[name="postalCode"]').fill('85004');
    await app.getByRole('button',{name:'Build my plan',exact:true}).click();
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
    await banner(page).locator('[data-blueprint-demo-control="reset"]').click();
    await expect(full(page)).toBeVisible();
    await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo?.scenario)).toBe('optimize');
    expect(await page.evaluate(()=>localStorage.getItem('unrelated-existing-data'))).toBe('keep-this-value');
  });

  test('DEMO10 existing real session, bank canary and unsupported action stay isolated',async({page,context})=>{
    await open(page,context,{existing:true});
    const original=await page.evaluate(()=>({token:localStorage.getItem('fh_token'),role:localStorage.getItem('fh_role'),account:localStorage.getItem('fh_account'),demo:localStorage.getItem('fh_demo')}));
    expect(original.token).toBe(TOKEN);
    await tab(page,'Applications');await stage(page,'ready');await tab(page,'Applications');
    await preview(page,context,()=>full(page).getByRole('button',{name:'Open bank application',exact:true}).first().click(),'bank');
    const rejected=await page.evaluate(async()=>{
      const before=JSON.stringify(localStorage),cases=[];
      for(const[path,options]of [['https://external.invalid/bank',{}],['/api/money/accounts',{}],['/api/blueprint/funding',{method:'POST',body:JSON.stringify({action:'verify_funded'})}]]){
        try{await window.FHBlueprintDemo.request(path,options);cases.push(false);}catch{cases.push(true);}
      }
      return{cases,unchanged:before===JSON.stringify(localStorage),frozen:Object.isFrozen(window.FHBlueprintDemo)};
    });
    expect(rejected).toEqual({cases:[true,true,true],unchanged:true,frozen:true});
    await banner(page).locator('[data-blueprint-demo-control="reset"]').click();
    await expect(full(page)).toBeVisible();
    expect(await page.evaluate(()=>({token:localStorage.getItem('fh_token'),role:localStorage.getItem('fh_role'),account:localStorage.getItem('fh_account'),demo:localStorage.getItem('fh_demo')}))).toEqual(original);
    expect((await context.cookies()).find(c=>c.name==='fh_session')?.value).toBe(COOKIE);
    await page.evaluate(()=>{localStorage.setItem('fh_token','synthetic-different-account');window.dispatchEvent(new Event('focus'));});
    await expect.poll(()=>page.evaluate(()=>window.FHBlueprintDemo.isCurrent())).toBe(false);
    await expect(full(page).locator('.bf-tabs')).toHaveCount(0);
    await expect(prep(page).locator('.bp-tabs')).toHaveCount(0);
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
