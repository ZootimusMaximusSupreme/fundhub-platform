import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Payment strategy preserves client controls and states ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let state='full',role='client',saved;
 let release;const held=new Promise(r=>{release=r;});
 await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/api/auth/session')return json({ok:true,principal:role,staff:{role}});
 if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
 if(path==='/api/money/strategy'){
 if(route.request().method()==='POST'){saved=route.request().postDataJSON();return json({ok:true});}
 if(state==='loading')await held;
 if(state==='error')return json({ok:false},503);
 return json(state==='empty'?{...sample,inputs:{...sample.inputs,debts:[]}}:sample);
 }return json({ok:false},404);
 });
 await page.goto('/app/money-strategy.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('#s-amount')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money_strategy-${width}.png`,fullPage:true});
 await page.locator('[data-method=snowball]').click();
 await expect(page.locator('[data-method=snowball]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#s-amount').fill('1500');await page.locator('#s-amount').blur();
 await page.locator('#s-range').focus();await page.keyboard.press('ArrowRight');
 await page.locator('#s-goal').selectOption({index:1});await expect(page.locator('#s-goal-by')).toBeVisible();
 await page.locator('#s-goal-by').fill('2030-10-18');
 await page.getByRole('button',{name:'Save this plan'}).focus();await page.keyboard.press('Enter');
 await expect.poll(()=>saved?.action).toBe('save_plan');expect(saved.method).toBe('snowball');
 for(const next of ['empty','error','loading']){
 state=next;await page.goto('/app/money-strategy.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 if(next==='empty')await expect(page.getByText('No cards or loans with a balance yet')).toBeVisible();
 if(next==='error'){await expect(page.locator('.error')).toBeVisible();state='full';await page.getByRole('button',{name:'Try again'}).click();await expect(page.locator('#s-amount')).toBeVisible();}
 if(next==='loading')await expect(page.locator('[aria-busy=true]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money_strategy-${next}-${width}.png`,fullPage:true});
 if(next==='loading')release();
 }
 role='staff';state='full';await page.goto('/app/money-strategy.html?client_id=safe-ui-fixture');
 await expect(page.locator('#s-amount')).toBeVisible();await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-ui-fixture');
 await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-ui-fixture#overview');
});
