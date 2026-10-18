import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test.use({hasTouch:true});
import bundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
const sample=bundle.reads['/api/money/credit'];
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
for(const width of [1440,390,320])test(`Credit client states and controls at ${width}`,async({page})=>{
 fs.mkdirSync(evidence,{recursive:true});
 await page.setViewportSize({width,height:900});
 let state='full',role='client',writes=0,release;
 const held=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(path==='/api/auth/session')return json({ok:true,principal:role});
  if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
  if(path==='/api/money/credit'){
   if(route.request().method()!=='GET'){writes++;return json({ok:false},403);}
   if(state==='loading')await held;
   if(state==='error')return json({ok:false},503);
   return json(state==='empty'?{ok:true,has_pull:false}:sample);
  }
  return json(bundle.reads[path]||{ok:true,items:[]});
 });
 for(const next of ['full','empty','error','loading']){
  state=next;await page.goto('/app/money-credit.html');
  await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  await expect(page.getByRole('combobox',{name:'Money section'})).toHaveValue('/app/money-credit.html');
  await expect(page.getByRole('combobox',{name:'Money section'}).locator('option')).toHaveCount(16);
  if(next==='full'){
   await expect(page.locator('#s-experian')).toBeVisible();
   await expect(page.locator('.sample')).toContainText('Sample report');
   await expect(page.locator('#c-acct')).toBeVisible();
   await page.getByRole('combobox',{name:'Money section'}).focus();
   await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
   await expect(page).not.toHaveURL(/money-credit\.html$/);
   await page.goto('/app/money-credit.html');
   await expect(page.locator('#s-experian')).toBeVisible();
  }
  if(next==='empty')await expect(page.getByRole('link',{name:'Set up a soft pull'})).toHaveAttribute('href','/app/money-setup.html');
  if(next==='error')await expect(page.getByRole('alert')).toBeVisible();
  if(next==='loading')await expect(page.locator('[aria-busy=true]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.locator('#credit-root').evaluate((el)=>{el.style.outline='2px solid #c52020';el.setAttribute('data-proof-caption','Credit: truthful scores, facts and report details');const c=document.createElement('p');c.id='credit-proof-caption';c.textContent='Credit: truthful scores, facts and report details';c.style.cssText='color:#b11c1c;font:12px Arial;margin:8px 0';el.before(c);});
  await page.screenshot({path:`${evidence}/page-money-credit-${next}-${width}.png`,fullPage:true});
  await page.locator('#credit-root').evaluate(el=>el.style.removeProperty('outline'));await page.locator('#credit-proof-caption').evaluate(el=>el.remove());
  if(next==='empty'){await page.getByRole('link',{name:'Set up a soft pull'}).tap();await expect(page).toHaveURL(/money-setup\.html$/);}
  if(next==='error'){state='full';await page.getByRole('button',{name:'Try again'}).tap();await expect(page.locator('#s-experian')).toBeVisible();}
  if(next==='loading')release();
 }
 role='staff';state='full';await page.goto('/app/money-credit.html?client_id=safe-fixture');
 await expect(page.locator('#s-experian')).toBeVisible();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
 await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-fixture#overview');
 expect(writes).toBe(0);
});
