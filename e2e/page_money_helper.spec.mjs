import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync('src/http/fixtures/money-helper.sample.json','utf8'));
const evidence='ops/workflows/build-evidence/client-portal-ios-redo';
for(const width of [1440,390,320]){
 test(`client helper states and message controls ${width}`,async({page})=>{
  await page.setViewportSize({width,height:1000});
  let state='full';let postError=false;const posts=[];
  await page.route('**/api/**',route=>{
   const url=route.request().url();let body={ok:true};let status=200;
   if(url.includes('/auth/session'))body={ok:true,principal:'client'};
   else if(url.includes('/affiliate-portal'))body={ok:true,enrolled:false};
   else if(url.includes('/money/helper')){
    if(route.request().method()==='POST'){posts.push(route.request().postDataJSON());if(postError){status=500;body={ok:false};}}
    else if(state==='loading')return;
    else if(state==='error'){status=500;body={ok:false};}
    else body=state==='empty'?{...sample,turns:[]}:sample;
   }
   return route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  });
  for(state of ['full','empty','error','loading']){
   await page.goto('/app/money-helper.html');
   await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
   if(state==='full'){
    await expect(page.locator('.from-helper')).toHaveCount(4);
    await expect(page.getByText('Needs your approval',{exact:true})).toBeVisible();
    await page.locator('#mh-input').fill('What should I do next?');
    await page.getByRole('button',{name:'Send',exact:true}).focus();await page.keyboard.press('Enter');
    await expect.poll(()=>posts.length).toBe(1);
    expect(posts[0]).toEqual({action:'send',message:'What should I do next?'});
    postError=true;await page.locator('#mh-input').fill('Keep my draft');await page.getByRole('button',{name:'Send',exact:true}).click();
    await expect(page.locator('.send-msg')).toContainText('did not send');await expect(page.locator('#mh-input')).toHaveValue('Keep my draft');postError=false;
   }else if(state==='empty'){
    await expect(page.locator('[data-act=suggest]')).toHaveCount(3);
    await page.locator('[data-act=suggest]').first().click();await expect.poll(()=>posts.length).toBe(3);
   }else if(state==='error')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
   else await expect(page.locator('[aria-busy=true]')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:`${evidence}/page_money_helper-${state}-${width}.png`,fullPage:true});
  }
 });
}
test('staff keeps legacy view and client-scoped links',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('auth/session')?{ok:true,principal:'staff'}:sample)}));
 await page.goto('/app/money-helper.html?client_id=safe-fixture');
 await expect(page.locator('.from-helper')).toHaveCount(4);
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
});
