import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync('src/http/fixtures/money-payments.sample.json','utf8'));
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
fs.mkdirSync(evidence,{recursive:true});
for(const width of [1440,390,320]){
 test(`client payments all states at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  let state='full';const posts=[];
  await page.route('**/api/**',route=>{
   const url=route.request().url();let body={ok:true};let status=200;
   if(url.includes('/auth/session'))body={ok:true,principal:'client'};
   else if(url.includes('/affiliate-portal'))body={ok:true,enrolled:false};
   else if(url.includes('/money/payments')){
    if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());body={ok:true};}
    else if(state==='loading')return;
    else if(state==='error'){status=500;body={ok:false};}
    else body=state==='empty'?{...sample,plans:[]}:sample;
   }
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(state of ['full','empty','error','loading']){
   await page.goto('/app/money-payments.html');
   await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
   if(state==='full'){
    await expect(page.locator('.fh-payments .plan').first()).toBeVisible();
    await expect(page.locator('.fh-payments .staff')).toHaveCount(0);
    await page.getByRole('button',{name:'Talk to a person'}).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.act-msg')).toContainText('reach out soon');
    expect(posts.at(-1)).toEqual({action:'ask_for_person'});
   }else if(state==='empty')await expect(page.getByRole('button',{name:'Talk to a person'})).toBeVisible();
   else if(state==='error')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
   else await expect(page.locator('[aria-busy=true]')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`${evidence}/page-money-payments-${state}-${width}.png`,fullPage:true});
   if(state==='full'){
    await page.evaluate(()=>{
     const area=document.querySelector('.fh-payments .tiles');
     area.style.outline='2px solid #c92828';area.style.outlineOffset='3px';
     const caption=document.createElement('p');caption.id='review-marker';caption.style.cssText='color:#b51e1e;font:600 12px sans-serif;margin:0 0 12px';caption.textContent='Review: balance, next due and overdue amount use one clear, neutral summary.';area.before(caption);
    });
    await page.screenshot({path:`${evidence}/page-money-payments-full-${width}-marked.png`,fullPage:true});
   }
  }
 });
}
test('staff retains legacy presentation',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('auth/session')?{ok:true,principal:'staff'}:sample)}));
 await page.goto('/app/money-payments.html?client_id=safe-fixture');
 await expect(page.locator('.fh-payments .staff').first()).toBeVisible();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');
});
test('payments module keeps professional hierarchy inside FinanceOS mount',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('/auth/session')?{ok:true,principal:'client'}:sample)}));
 await page.goto('/app/money-payments.html');
 await expect(page.locator('.fh-payments .plan').first()).toBeVisible();
 await page.evaluate(data=>{
  const host=document.createElement('section');host.id='fos-payments';document.querySelector('main').replaceChildren(host);
  window.FinanceOS.sections.payments.mount(host,{apiGet:()=>Promise.resolve({status:200,body:data})});
 },sample);
 await expect(page.locator('#fos-payments .plan')).toHaveCount(sample.plans.length);
 expect(await page.locator('#fos-payments .plan').first().evaluate(el=>getComputedStyle(el).borderRadius)).toBe('18px');
 await expect(page.locator('#fos-payments [data-act="person"]')).toBeVisible();
});
