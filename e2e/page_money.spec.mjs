import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
const sample=bundle.reads['/api/money/overview'];
const empty={...sample,accounts:[],containers:[],cash:{personal:{cents:null},business:{cents:null},unknown:{cents:null}},debt:{total_cents:null,cards:[],loans:[],by_kind:{},by_container:[]},upcoming:[],bills:[],cashflow:{has_transactions:false,months:[]}};
async function noOverflow(page){expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
async function reviewPayments(page,onClick){
  const ready=page.waitForURL(/\/app\/financeos\.html#payments$/,{waitUntil:'domcontentloaded'});
  const clicked=page.getByRole('link',{name:'Review payments'}).click().then(()=>{if(onClick)onClick();});
  await Promise.all([ready,clicked]);
}
async function markedShot(page,name,selector,caption){
  await page.evaluate(({selector,caption})=>{
    const r=document.querySelector(selector).getBoundingClientRect(),box=document.createElement('div');box.id='money-proof-mark';
    Object.assign(box.style,{position:'absolute',left:r.left+scrollX+'px',top:r.top+scrollY+'px',width:r.width+'px',height:r.height+'px',border:'2px solid #c52020',zIndex:150,pointerEvents:'none'});
    const label=document.createElement('span');label.textContent=caption;
    Object.assign(label.style,{position:'absolute',left:'0',top:'-20px',color:'#b11c1c',background:'#fff',font:'11px Arial,sans-serif',padding:'2px 4px',whiteSpace:'nowrap'});
    box.append(label);document.body.append(box);
  },{selector,caption});
  await page.screenshot({path:`${evidence}/${name}.png`,fullPage:true});
  await page.locator('#money-proof-mark').evaluate(el=>el.remove());
}
for(const width of [1440,390,320])test(`Money task summary and complete details at ${width}`,async({page})=>{
  fs.mkdirSync(evidence,{recursive:true});
  await page.setViewportSize({width,height:1000});
  let state='full',role='client';const writes=[],errors=[],consentRequests=[],linkBodies=[],passkeyCalls=[];
  await page.addInitScript(()=>localStorage.setItem('fh_token','money-page-fixture-session'));
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url()),p=u.pathname;
    const json=(d,status=200)=>route.fulfill({status,json:d});
    if(p==='/api/auth/passkey'){
      passkeyCalls.push(route.request().postDataJSON());
      return json({ok:true,enrolled:true,assured:true,recovery_required:false});
    }
    if(route.request().method()!=='GET'){
      writes.push(p);
      if(p==='/api/auth/plaid-mfa'){
        const body=route.request().postDataJSON();consentRequests.push(body);
        if(body.action==='consent_details')return json({ok:true,consent_text:'I authorize Fundhub to connect my bank account.',privacy_url:'/privacy/'});
        if(body.action==='authorize')return json({ok:true,grant_token:'money-page-consent-grant'});
        return json({ok:false,error:'unexpected_consent_action'},400);
      }
      if(p==='/api/banking/link-token'){
        linkBodies.push(route.request().postDataJSON());
        return json({ok:false,error:'not_configured'},503);
      }
      return json({ok:false,error:'offline_sample_read_only'},409);
    }
    if(p==='/api/auth/session')return json({ok:true,principal:role,portal_sample_available:true,portal_sample:true,staff:{role}});
    if(p==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
    if(p==='/api/money/overview'){
      if(state==='loading')return;
      if(state==='error')return json({ok:false,error:'unavailable'},503);
      return json(state==='empty'?empty:sample);
    }
    return json(bundle.reads[p]||{ok:true,items:[]});
  });
  await page.goto('/app/money.html');
  await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  await expect(page.locator('#money-root h1')).toHaveText('Overview');
  await expect(page.locator('.client-ios-links a[aria-current=page]')).toContainText('Money');
  await expect(page.getByRole('combobox',{name:'Money section'}).locator('option')).toHaveCount(16);
  await expect(page.getByRole('combobox',{name:'Money section'})).toHaveValue('/app/money.html');
  await expect(page.locator('#money-root .money-detail')).toHaveCount(5);
  await expect(page.locator('#money-root .money-detail[open]')).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Review payments'})).toHaveAttribute('href','/app/financeos.html#payments');
  await expect(page.locator('.tile-cash')).toContainText('$13,385.00');
  await expect(page.locator('.tile-cash')).toContainText('$19,780.00');
  await expect(page.locator('#t-debt').locator('..')).toContainText('$8,101.01');
  await expect(page.locator('#t-next').locator('..')).toContainText('Nov 10');
  await noOverflow(page);
  await markedShot(page,`page-money-overview-${width}`,'#money-root .money-next-due','Next due before supporting balances');
  for(const key of ['payments','accounts','debt','history','plan']){
    const d=page.locator(`#money-detail-${key}`);
    await d.locator(':scope>summary').focus();await page.keyboard.press('Enter');
    await expect(d).toHaveAttribute('open','');
    if(key==='accounts'){
      await expect(d.locator('.acct-name').filter({hasText:'Personal Checking'})).toBeVisible();
      await expect(d.locator('.acct')).toHaveCount(sample.accounts.length);
      for(const a of sample.accounts)await expect(d).toContainText('••'+a.mask);
    }
    if(key==='debt'){
      await expect(d.locator('table.cards tbody tr')).toHaveCount(sample.debt.cards.length);
      await expect(d.getByRole('columnheader',{name:'Past due',exact:true})).toBeAttached();
      await expect(d).toContainText('No loans on file.');
      await markedShot(page,`page-money-debt-${width}`,'#money-detail-debt','Every financial row stays available');
    }
    if(key==='history'){
      await expect(d.locator('.flow')).toHaveCount(2);
      await expect(d.getByRole('button',{name:'30 days',exact:true})).toBeVisible();
      await d.getByRole('button',{name:'90 days',exact:true}).click();
      await expect(d.getByRole('button',{name:'90 days',exact:true})).toHaveAttribute('aria-pressed','true');
      const numbers=d.locator('.tdata').first();
      await numbers.locator(':scope>summary').click();
      await expect(numbers.locator('table')).toBeVisible();
    }
    if(key==='plan')await expect(d).toContainText('2 containers');
    await noOverflow(page);
    await d.locator(':scope>summary').click();
  }
  await reviewPayments(page);
  await expect(page).toHaveURL(/\/app\/financeos\.html#payments$/);
  await expect(page.locator('#fos-payments')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#money-root .tiles')).toBeVisible();
  await page.getByRole('button',{name:'Connect a bank'}).click();
  const consentDialog=page.getByRole('dialog');
  await expect(consentDialog.getByRole('heading',{name:'Connect your bank'})).toBeVisible();
  await expect(consentDialog).toContainText('I authorize Fundhub to connect my bank account.');
  await expect(consentDialog.getByRole('link',{name:'Privacy Policy'})).toHaveAttribute('href','/privacy/');
  await expect(consentDialog.getByLabel('Authenticator code')).toHaveCount(0);
  expect(writes).toEqual(['/api/auth/plaid-mfa']);
  await consentDialog.getByRole('button',{name:'Agree and connect',exact:true}).click();
  expect(writes).toEqual(['/api/auth/plaid-mfa']);
  await consentDialog.locator('[name=consent]').check();
  await consentDialog.getByRole('button',{name:'Agree and connect',exact:true}).click();
  await expect(consentDialog).toHaveCount(0);
  await expect(page.locator('#money-root .act-msg')).toContainText('not set up yet');
  expect(consentRequests).toEqual([
    {action:'consent_details',target_kind:'client_bank'},
    {action:'authorize',target_kind:'client_bank',consent:true}
  ]);
  expect(passkeyCalls).toEqual([{action:'status',target_kind:'client_bank'}]);
  expect(linkBodies).toEqual([{client_id:sample.client.id,plaid_grant_token:'money-page-consent-grant'}]);
  expect(writes).toEqual(['/api/auth/plaid-mfa','/api/auth/plaid-mfa','/api/banking/link-token']);
  for(const next of ['empty','error','loading']){
    state=next;await page.goto(`/app/money.html?proof=${next}`);
    if(next==='empty'){
      await expect(page.locator('#money-root .empty')).toBeVisible();
      await expect(page.locator('#money-root [data-act=connect]')).toHaveCount(1);
      await expect(page.locator('#money-root .tiles')).toHaveCount(0);
    }
    if(next==='error'){
      await expect(page.locator('#money-root [role=alert]')).toBeVisible();
      await markedShot(page,`page-money-error-${width}`,'#money-root .error','Error stays readable with retry');
      state='full';await page.getByRole('button',{name:'Try again'}).click();
      await expect(page.locator('#money-root .tiles')).toBeVisible();
    }
    if(next==='loading')await expect(page.locator('#money-root [aria-busy=true]')).toBeVisible();
    await noOverflow(page);
  }
  role='staff';state='full';await page.goto('/app/money.html?client_id=safe-ui-fixture');
  await expect(page.locator('#money-root .tiles')).toBeVisible();
  await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
  await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-ui-fixture');
  await expect(page.getByRole('link',{name:'Review payments'})).toHaveAttribute('href','/app/financeos.html?client_id=safe-ui-fixture#payments');
  await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-ui-fixture#overview');
  expect(errors).toEqual([]);
});

test('client bank exchange is blocked when Plaid returns after passkey assurance expires',async({page})=>{
  const passkeyCalls=[],consentCalls=[],bankCalls=[];
  await page.addInitScript(()=>{
    localStorage.setItem('fh_token','money-page-fixture-session');
    window.Plaid={create:options=>({open(){window.finishMoneyLink=options.onSuccess;}})};
  });
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    const json=(body,status=200)=>route.fulfill({status,json:body});
    if(path==='/api/auth/passkey'){
      passkeyCalls.push(route.request().postDataJSON());
      return json({ok:true,enrolled:true,assured:passkeyCalls.length===1,recovery_required:false});
    }
    if(path==='/api/auth/plaid-mfa'){
      const body=route.request().postDataJSON();consentCalls.push(body);
      return body.action==='consent_details'
        ?json({ok:true,consent_text:'I authorize Fundhub to connect my bank account.',privacy_url:'/privacy/'})
        :json({ok:true,grant_token:'synthetic-client-grant'});
    }
    if(path==='/api/banking/link-token'){
      bankCalls.push(route.request().postDataJSON());
      return json({ok:true,link_token:'synthetic-link-token'});
    }
    if(route.request().method()!=='GET'){
      bankCalls.push({path,body:route.request().postDataJSON()});
      return json({ok:true});
    }
    return json(path==='/api/auth/session'
      ?{ok:true,principal:'client',portal_sample_available:true,portal_sample:true,staff:{role:'client'}}
      :path==='/api/read/affiliate-portal'?{ok:true,enrolled:false}
      :path==='/api/money/overview'?sample:bundle.reads[path]||{ok:true,items:[]});
  });
  await page.goto('/app/money.html');
  await page.getByRole('button',{name:'Connect a bank'}).click();
  const consent=page.getByRole('dialog');
  await expect(consent).toContainText('I authorize Fundhub to connect my bank account.');
  await consent.locator('[name=consent]').check();
  await consent.getByRole('button',{name:'Agree and connect',exact:true}).click();
  await page.waitForFunction(()=>typeof window.finishMoneyLink==='function');
  await page.evaluate(()=>window.finishMoneyLink('synthetic-public-token',{
    institution:{name:'Synthetic Bank'},accounts:[{id:'synthetic-account',name:'Checking',mask:'1234'}]
  }));
  await expect(page.locator('.fh-plaid-stepup h2')).toHaveText('Verify your bank connection');
  expect(passkeyCalls).toEqual([
    {action:'status',target_kind:'client_bank'},
    {action:'status',target_kind:'client_bank'}
  ]);
  expect(consentCalls.map(body=>body.action)).toEqual(['consent_details','authorize']);
  expect(bankCalls).toEqual([{client_id:sample.client.id,plaid_grant_token:'synthetic-client-grant'}]);
  await page.locator('.fh-plaid-stepup [data-cancel]').click();
  expect(bankCalls.some(call=>call.action==='exchange'||call.path==='/api/banking/link-exchange')).toBe(false);
});

test('Review payments waits for the real FinanceOS boot after a delayed script at 390',async({page})=>{
  await page.setViewportSize({width:390,height:900});
  await page.addInitScript(()=>localStorage.setItem('fh_token','money-page-fixture-session'));
  const writes=[],errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET'){
      writes.push(path);
      return route.fulfill({status:409,json:{ok:false,error:'offline_read_only'}});
    }
    return route.fulfill({json:path==='/api/auth/session'
      ?{ok:true,principal:'client',portal_sample_available:true,portal_sample:true,staff:{role:'client'}}
      :path==='/api/read/affiliate-portal'?{ok:true,enrolled:false}:bundle.reads[path]||{ok:true,items:[]}});
  });
  let markHeld;
  const held=new Promise(resolve=>{markHeld=resolve;});
  let releaseAsset;
  const assetGate=new Promise(resolve=>{releaseAsset=resolve;});
  await page.route('**/app/financeos.js',async route=>{
    markHeld();
    await assetGate;
    await route.continue();
  });
  await page.goto('/app/money.html');
  await expect(page.getByRole('link',{name:'Review payments'})).toBeVisible();
  let clickReturned=false,reviewReturned=false;
  const review=reviewPayments(page,()=>{clickReturned=true;}).then(()=>{reviewReturned=true;});
  try{
    await held;
    await expect.poll(()=>clickReturned).toBe(true);
    await new Promise(resolve=>setTimeout(resolve,5200));
    await expect(page).toHaveURL(/\/app\/financeos\.html#payments$/);
    const before=await page.evaluate(()=>({readyState:document.readyState,
      hidden:document.getElementById('fos-payments').hidden,
      selected:document.getElementById('tab-payments').getAttribute('aria-selected')}));
    expect(before).toEqual({readyState:'interactive',hidden:true,selected:'false'});
    expect(reviewReturned).toBe(false);
  }finally{releaseAsset();}
  await review;
  await expect(page).toHaveURL(/\/app\/financeos\.html#payments$/);
  await expect(page.locator('#fos-payments')).toBeVisible();
  await expect(page.locator('#fos-payments')).toContainText('Business Amex');
  await expect(page.locator('#tab-payments')).toHaveAttribute('aria-selected','true');
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

for(const width of [1440,390,320])for(const surface of ['money','financeos'])test(`Money priority and cash disclosure in ${surface} at ${width}`,async({page})=>{
  fs.mkdirSync(evidence,{recursive:true});
  await page.setViewportSize({width,height:900});
  const writes=[];
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(route.request().method()!=='GET'){writes.push(path);return route.fulfill({status:409,json:{ok:false,error:'offline_read_only'}});}
    return route.fulfill({json:path==='/api/auth/session'?{ok:true,principal:'client',portal_sample_available:true,portal_sample:true,staff:{role:'client'}}:
      path==='/api/read/affiliate-portal'?{ok:true,enrolled:false}:bundle.reads[path]||{ok:true,items:[]}});
  });
  await page.goto(`/app/${surface}.html`+(surface==='financeos'?'#overview':''));
  const root=page.locator(surface==='money'?'#money-root':'#fos-overview');
  await expect(root.locator('.money-next-due')).toContainText('Business Amex');
  await expect(root.locator('.money-next-due')).toContainText('Nov 10');
  await expect(root.locator('.money-next-due')).toContainText('$133.00 minimum');
  const placement=await root.evaluate(el=>{
    const next=el.querySelector('.money-next-due').getBoundingClientRect(),action=el.querySelector('.money-actions').getBoundingClientRect(),tiles=el.querySelector('.tiles').getBoundingClientRect();
    const nav=document.querySelector('.client-ios-nav').getBoundingClientRect();
    return {nextTop:next.top,nextBottom:next.bottom,actionBottom:action.bottom,tilesTop:tiles.top,visibleBottom:innerWidth<=760?nav.top:innerHeight};
  });
  expect(placement.nextTop).toBeGreaterThanOrEqual(placement.actionBottom-1);
  expect(placement.nextTop-placement.actionBottom).toBeLessThan(width<=760?30:48);
  expect(placement.nextBottom).toBeLessThan(placement.visibleBottom);
  expect(placement.nextBottom).toBeLessThan(placement.tilesTop);
  for(const kind of ['personal','business'])await expect(root.locator(`.tile-cash>.cash-line[data-kind=${kind}] .big`)).toBeVisible();
  const cash=root.locator('.money-cash-detail');
  await expect(cash).not.toHaveAttribute('open');
  await cash.locator(':scope>summary').focus();await page.keyboard.press('Enter');
  await expect(cash).toHaveAttribute('open','');
  for(const fact of ['Personal: 1 account','Business: 1 account','Not sure yet: 0 accounts','no accounts waiting to be sorted','They are not added together'])await expect(cash).toContainText(fact);
  await expect(cash.locator('.money-cash-notes')).toBeVisible();
  await noOverflow(page);
  await cash.locator(':scope>summary').press('Enter');
  await expect(cash).not.toHaveAttribute('open');
  await page.evaluate(()=>scrollTo(0,0));
  await markedShot(page,`page-money-priority-${surface}-${width}`,`${surface==='money'?'#money-root':'#fos-overview'} .money-next-due`,'Next due directly follows the review action');
  expect(writes).toEqual([]);
});
