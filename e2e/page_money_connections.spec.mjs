import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('src/http/fixtures/money-connections.sample.json','utf8'));
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
for(const width of [1440,390,320]) for(const state of ['full','loading','empty','error']){
 test(`connections ${state} ${width}`,async({page})=>{
  await page.setViewportSize({width,height:950});
  await page.route('**/api/**',async route=>{
   const path=new URL(route.request().url()).pathname;
   let data={ok:true};let status=200;
   if(path==='/api/auth/session')data={ok:true,principal:'client'};
   else if(path==='/api/read/affiliate-portal')data={ok:true,enrolled:false};
   else if(path==='/api/money/connections'){
    if(state==='loading'){await new Promise(r=>setTimeout(r,1500));}
    if(state==='error'){status=503;data={ok:false,error:'unavailable'};}
    else data=state==='empty'?{ok:true,connections:[],containers:[],summary:{totals:[],containers:[]}}:fixture;
   }
   await route.fulfill({status,json:data});
  });
  await page.goto('/app/money-connections.html');
  await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  if(state==='loading') await expect(page.locator('[aria-busy=true]')).toBeVisible();
  else if(state==='error')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
  else if(state==='empty')await expect(page.getByRole('link',{name:'Add a business'})).toBeVisible();
  else await expect(page.getByRole('heading',{name:'Month over month'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${evidence}/page_money_connections-${state}-${width}.png`,fullPage:true});
 });
}
test('connections safe actions, retry, keyboard and staff exclusion',async({page,browser})=>{
 let reads=0;const writes=[];
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/session')return route.fulfill({json:{ok:true,principal:'client'}});
  if(path==='/api/read/affiliate-portal')return route.fulfill({json:{ok:true,enrolled:false}});
  if(route.request().method()==='POST'){writes.push(route.request().postDataJSON());return route.fulfill({status:400,json:{ok:false,error:'test_denial'}});}
  reads++;return route.fulfill({status:reads===1?503:200,json:reads===1?{ok:false}:fixture});
 });
 await page.goto('/app/money-connections.html');
 await page.getByRole('button',{name:'Try again'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('heading',{name:'Month over month'})).toBeVisible();
 await page.locator('[data-provider="commas"] summary').click();
 await page.locator('[data-provider="commas"] [data-ent]').selectOption(fixture.containers[0].id);
 await page.getByRole('button',{name:'Connect Commas',exact:true}).click();
 await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'create',provider:'commas'});
 await page.locator('[data-secret]').first().fill('safe-test-secret');
 await page.getByRole('button',{name:'Save secret'}).first().click();
 await expect.poll(()=>writes.length).toBe(2);expect(writes[1].action).toBe('secret');
 await expect(page.locator('[data-secret]').first()).toHaveValue('');
 await page.getByRole('button',{name:'Turn off',exact:false}).first().focus();
 await expect(page.locator(':focus')).toHaveAttribute('data-act','disable');
 const staff=await browser.newPage();await staff.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/auth/session'?{ok:true,principal:'staff'}:fixture}));
 await staff.goto('/app/money-connections.html?client_id=safe-context');
 await expect(staff.locator('body')).toHaveAttribute('data-client-ready','');
 await expect(staff.locator('body')).not.toHaveAttribute('data-client-ios','');
 await expect(staff.locator('.mnav a').first()).toHaveAttribute('href',/client_id=safe-context/);await staff.close();
 const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});const phone=await touch.newPage();
 await phone.route('**/api/**',r=>r.fulfill({json:new URL(r.request().url()).pathname==='/api/auth/session'?{ok:true,principal:'client'}:fixture}));
 await phone.goto('/app/money-connections.html');await expect(phone.getByRole('combobox',{name:'Money section'})).toHaveValue('/app/money-connections.html');await phone.getByRole('link',{name:'Open Money workspace'}).tap();await expect(phone).toHaveURL(/financeos.html#connections/);await touch.close();
});
test('connections pull credentials, sync, copy and disable are safe intercepted actions',async({page})=>{
 const data=structuredClone(fixture);data.connections[2].mode='pull';data.connections[2].has_api_key=true;data.connections[2].api_key_hint='TEST';const actions=[];
 await page.addInitScript(()=>Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedText=text;}}}));
 await page.route('**/api/**',async r=>{
  const p=new URL(r.request().url()).pathname;
  if(p==='/api/auth/session')return r.fulfill({json:{ok:true,principal:'client'}});
  if(r.request().method()==='POST'){actions.push(r.request().postDataJSON());return r.fulfill({status:400,json:{ok:false,error:'safe_denial'}});}
  return r.fulfill({json:p==='/api/money/connections'?data:{ok:true,enrolled:false}});
 });
 await page.goto('/app/money-connections.html');await page.locator('[data-apikey]').fill('test-only-key');await page.getByRole('button',{name:'Save key',exact:true}).click();
 await expect.poll(()=>actions.length).toBe(1);expect(actions[0].action).toBe('api_key');await expect(page.locator('[data-apikey]')).toHaveValue('');
 await page.getByRole('button',{name:'Sync now',exact:true}).click();await expect.poll(()=>actions.length).toBe(2);expect(actions[1].action).toBe('sync');
 await page.getByRole('button',{name:'Copy address',exact:true}).first().click();await expect.poll(()=>page.evaluate(()=>window.copiedText)).toContain('/api/');
 page.once('dialog',d=>d.dismiss());await page.locator('[data-act=disable]').first().click();expect(actions.length).toBe(2);
 page.once('dialog',d=>d.accept());await page.locator('[data-act=disable]').first().click();await expect.poll(()=>actions.length).toBe(3);expect(actions[2].action).toBe('disable');
});
