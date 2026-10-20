import {test,expect} from '@playwright/test';
test.use({hasTouch:true});
const fresh={ok:true,client:{name:'Safe UI fixture'},setup_fee_cents:49700,price_per_container_cents:null,containers:0,soft_pull:{requested:false,price:{base_cents:3200}},steps:['pay','soft_pull','accounts','live'].map(key=>({key,done:false})),current_step:'pay'};
for(const width of [1440,390,320])test(`Setup client controls and states at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.route('https://**',r=>r.abort());
 let state='full',role='client',writes=[];
 let release;const held=new Promise(r=>{release=r;});
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  const reply=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/auth/session')return reply({ok:true,principal:role});
  if(path==='/api/read/affiliate-portal')return reply({ok:true,enrolled:false});
  if(path==='/api/money/setup'){
   if(req.method()==='POST'){writes.push(req.postDataJSON());return reply({ok:false,error:'not_configured'},503);}
   if(state==='loading')await held;
   if(state==='error')return reply({ok:false},503);
   if(state==='empty')return reply({...fresh,setup_fee_cents:null});
   if(state==='done')return reply({...fresh,entitled:true,containers:2,steps:fresh.steps.map(s=>({...s,done:true}))});
   return reply(fresh);
  }
  return reply({ok:false},404);
 });
 await page.goto('/app/money-setup.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('.steps .step')).toHaveCount(4);
 await expect(page.getByRole('combobox',{name:'Money section'})).toHaveValue('/app/money-setup.html');
 await expect(page.locator('.mnav option')).toHaveCount(16);
 await page.getByLabel('Account',{exact:true}).click();
 await expect(page.locator('a[href="/app/financeos.html#setup"]')).toBeVisible();
 await page.getByLabel('Account',{exact:true}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/page-money-setup-${width}-full.png`,fullPage:true});
 await page.getByRole('button',{name:'Pay $497.00 setup'}).focus();await page.keyboard.press('Enter');
 await expect(page.locator('.act-msg').first()).toContainText('Nothing was charged');
 expect(writes).toEqual([{action:'start_checkout'}]);
 await page.getByRole('button',{name:'Run soft pull'}).tap();
 await expect.poll(()=>writes[1]).toEqual({action:'request_soft_pull'});
 for(const next of ['empty','done','error','loading']){
  state=next;await page.goto('/app/money-setup.html');
  if(next==='empty'){await expect(page.locator('#setup-root')).toContainText('Price not set yet');await expect(page.locator('[data-act=checkout]')).toHaveCount(0);}
  if(next==='done'){await expect(page.locator('.step.done')).toHaveCount(4);await expect(page.getByRole('link',{name:'Open Money',exact:true})).toBeVisible();}
  if(next==='error')await expect(page.getByRole('alert')).toBeVisible();
  if(next==='loading'){await expect(page.locator('[aria-busy=true]')).toBeVisible();}
  await page.screenshot({path:`ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/page-money-setup-${width}-${next}.png`,fullPage:true});
  if(next==='loading')release();
  if(next==='error'){state='full';await page.getByRole('button',{name:'Try again'}).tap();await expect(page.locator('.step')).toHaveCount(4);}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 role='staff';state='full';await page.goto('/app/money-setup.html?client_id=safe-fixture');
 await expect(page.locator('.step')).toHaveCount(4);
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
 await expect(page.locator('.mnav a').last()).toHaveAttribute('href','/app/financeos.html?client_id=safe-fixture#setup');
});
