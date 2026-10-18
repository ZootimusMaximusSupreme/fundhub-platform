import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('src/http/fixtures/money-next.sample.json','utf8'));
const evidence='ops/workflows/build-evidence/client-portal-ios-redo';
for(const width of [1440,390,320])test(`next steps client states and actions ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});let state='full';let taskFailed=true;const posts=[];
 await page.route('**/api/**',async r=>{
  const url=r.request().url(),post=r.request().method()==='POST';let body={ok:true},status=200;
  if(url.includes('auth/session'))body={ok:true,principal:'client'};
  else if(url.includes('affiliate-portal'))body={ok:true,enrolled:false};
  else if(url.includes('/money/')){
   if(!post&&state==='loading')return;
   if(!post&&state==='error'){status=500;body={ok:false};}
   else if(url.includes('/tasks')){
    if(post){posts.push(r.request().postDataJSON());if(taskFailed){status=500;body={ok:false,message:'Please try again.'};taskFailed=false;}else body={ok:true,task:{...fixture.tasks.tasks[0],assignment:{open:true,status:'needs_approval',amount_cents:50000}}};}
    else body=state==='empty'?{...fixture.tasks,tasks:[]}:fixture.tasks;
   }else if(post){posts.push(r.request().postDataJSON());body={...fixture.ready,status:'requested',requested_at:'2026-10-18'};}
   else body=fixture.ready;
  }
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
 });
 for(state of ['full','empty','error','loading']){
  await page.goto('/app/money-next.html');await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  if(state==='full'){
   const task=page.getByRole('button',{name:'Do task'}).first();await task.focus();await page.keyboard.press('Enter');await expect(page.getByText('Please try again.')).toBeVisible();
   await task.click();await expect(page.getByText(/Nothing moves until you say yes to this exact amount/)).toBeVisible();expect(posts.at(-1)).toEqual({action:'do_task',task_id:fixture.tasks.tasks[0].id});
   await page.getByRole('button',{name:"I'm ready to get funded"}).click();await expect(page.getByText('Sent to our team',{exact:true})).toBeVisible();expect(posts.at(-1)).toEqual({});
   await expect(page.getByRole('link',{name:'Book a call'})).toHaveAttribute('href',fixture.ready.offers.blueprint.sell.url);
  }else if(state==='empty')await expect(page.getByRole('link',{name:'Check your accounts'})).toBeVisible();
  else if(state==='error'){await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();state='full';await page.getByRole('button',{name:'Try again'}).click();await expect(page.getByText('Pay $500.00 to Fundhub LLC',{exact:true})).toBeVisible();state='error';}
  else await expect(page.locator('[aria-busy=true]')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${evidence}/page_money_next-${state}-${width}.png`,fullPage:true});
 }
});
test('next steps staff preserves client context and legacy styles',async({page})=>{
 await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(r.request().url().includes('auth/session')?{ok:true,principal:'staff'}:r.request().url().includes('/tasks')?fixture.tasks:fixture.ready)}));
 await page.goto('/app/money-next.html?client_id=safe-fixture');await expect(page.getByText('Pay $500.00 to Fundhub LLC',{exact:true})).toBeVisible();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-fixture');
 await expect(page.locator('#money-nav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-fixture#overview');
});
