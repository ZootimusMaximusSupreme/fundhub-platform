import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('src/finance/file-alerts/file-alerts.fixture.json'));
const dir='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
for(const width of [1440,390,320])test(`alerts client states and keyboard ${width}`,async({browser})=>{
 const context=await browser.newContext({hasTouch:true});const page=await context.newPage();
 await page.setViewportSize({width,height:1000});let state='full';const posts=[];
 await page.route('**/api/**',async route=>{
  const u=route.request().url();let body={ok:true},status=200;
  if(u.includes('auth/session'))body={ok:true,principal:'client'};
  else if(u.includes('affiliate-portal'))body={ok:true,enrolled:false};
  else if(u.includes('/money/alerts')){
   if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());body={ok:true};}
   else if(state==='loading')return;
   else if(state==='error'){status=500;body={ok:false};}
   else body=state==='empty'?{...fixture,cards:[],alerts:[],reserve:{personal:{state:'unknown'},business:{state:'unknown'}}}:fixture;
  }
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 for(state of ['full','empty','error','loading']){
  await page.goto('/app/money-alerts.html');await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  if(state==='full'){
   await expect(page.getByRole('switch')).toHaveCount(4);
   const sw=page.getByRole('switch').first();await sw.focus();await page.keyboard.press('Space');await expect.poll(()=>posts.length).toBeGreaterThan(0);expect(posts[0]).toEqual({action:'set_alert',kind:'payment_timing',enabled:false});
   await page.getByRole('button',{name:/Change promo for|Add a promo for/}).first().tap();await expect(page.locator('input[type=date]')).toBeVisible();await page.getByRole('button',{name:'Cancel',exact:true}).tap();
   await sw.tap();await expect.poll(()=>posts.length).toBe(2);expect(posts[1]).toEqual({action:'set_alert',kind:'payment_timing',enabled:true});
  }else if(state==='empty')await expect(page.getByRole('heading',{name:'Nothing to watch yet'})).toBeVisible();
  else if(state==='error')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
  else await expect(page.locator('[aria-busy=true]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${dir}/page_money_alerts-${state}-${width}.png`,fullPage:true});
 }
 await context.close();
});
test('alerts staff keeps client context and prior presentation',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('auth/session')?{ok:true,principal:'staff'}:fixture)}));
 await page.goto('/app/money-alerts.html?client_id=safe-fixture');await expect(page.getByRole('switch')).toHaveCount(4);
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');await expect(page.locator('#money-nav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-fixture#overview');
});
