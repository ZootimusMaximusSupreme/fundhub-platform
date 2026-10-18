import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test.use({hasTouch:true});
const sample=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-fundability.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Fundability client states and chart controls at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let state='full',role='client',writes=0,release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/auth/session')return json({ok:true,principal:role});
  if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
  if(path==='/api/money/fundability'){
   if(route.request().method()!=='GET'){writes++;return json({ok:false},403);}
   if(state==='loading')await held;
   if(state==='error')return json({ok:false},503);
   return json(state==='empty'?{ok:true,has_pull:false}:sample);
  }
  return json({ok:false},404);
 });
 await page.goto('/app/money-fundability.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('#fd-t-now')).toBeVisible();
 await expect(page.locator('.mnav a[aria-current=page]')).toHaveText('Fundability');
 const cols=page.locator('.fd-col');
 await cols.first().focus();await page.keyboard.press('Enter');
 await expect(cols.first()).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.fd-detail-head')).toHaveText('Today');
 await cols.last().tap({force:true});
 await expect(cols.last()).toHaveAttribute('aria-pressed','true');
 for(const next of ['full','empty','error','loading']){
  state=next;await page.goto('/app/money-fundability.html');
  await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  if(next==='full')await expect(page.locator('#fd-t-now')).toBeVisible();
  if(next==='empty'){await expect(page.locator('.fd-empty')).toBeVisible();await expect(page.getByRole('link',{name:'Run your soft pull'})).toHaveAttribute('href','/app/financeos.html#setup');}
  if(next==='error')await expect(page.getByRole('alert')).toBeVisible();
  if(next==='loading')await expect(page.locator('[aria-busy=true]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money_fundability-${next}-${width}.png`,fullPage:true});
  if(next==='error'){state='full';await page.getByRole('button',{name:'Try again'}).click();await expect(page.locator('#fd-t-now')).toBeVisible();}
  if(next==='loading')release();
 }
 role='staff';state='full';await page.goto('/app/money-fundability.html?client_id=safe-fixture');
 await expect(page.locator('#fd-t-now')).toBeVisible();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
 await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-fixture#overview');
 expect(writes).toBe(0);
});
