import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-plan.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Plan preserves client states and pin controls at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let state='full',role='client',writes=0,release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/auth/session')return json({ok:true,principal:role});
  if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
  if(path==='/api/money/plan'){
   if(route.request().method()!=='GET'){writes++;return json({ok:false},403);}
   if(state==='loading')await held;
   if(state==='error')return json({ok:false,error:'unavailable'},503);
   return json(state==='empty'?{...sample,pins:[]}:sample);
  }
  return json({ok:false},404);
 });
 await page.goto('/app/money-plan.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('.monthbar')).toContainText('October 2026');
 await expect(page.locator('.mnav a[aria-current=page]')).toHaveText('Plan');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money_plan-${width}.png`,fullPage:true});
 await page.locator('.row[data-pin]').first().focus();await page.keyboard.press('Enter');
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('button',{name:'Mark done'})).toHaveCount(0);
 await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
 await page.getByRole('button',{name:/Next month/}).click();
 await expect(page.locator('.monthbar')).toBeVisible();
 for(const next of ['empty','error','loading']){
  state=next;await page.goto('/app/money-plan.html');
  if(next==='empty')await expect(page.locator('.empty')).toBeVisible();
  if(next==='error'){await expect(page.locator('.error')).toBeVisible();state='full';await page.getByRole('button',{name:'Try again'}).click();await expect(page.locator('.monthbar')).toBeVisible();}
  if(next==='loading')await expect(page.locator('.skel').first()).toBeVisible();
  await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money_plan-${width}-${next}.png`,fullPage:true});
  if(next==='loading')release();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 }
 role='staff';state='full';await page.goto('/app/money-plan.html?client_id=safe-fixture');
 await expect(page.locator('.monthbar')).toBeVisible();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
 expect(writes).toBe(0);
});
