import {test,expect} from '@playwright/test';
import fs from 'node:fs';
const sample=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Payment strategy preserves client controls and states ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let state='full',role='client',saved,reject=false;
 let release;const held=new Promise(r=>{release=r;});
 await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/api/auth/session')return json({ok:true,principal:role,staff:{role}});
 if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
 if(path==='/api/money/strategy'){
 if(route.request().method()==='POST'){saved=route.request().postDataJSON();return reject?json({ok:false,message:'The safe amount changed. Review this plan before saving.'},409):json({ok:true,saved:{...saved,saved_at:'2026-10-18T12:00:00Z',steps:12}});}
 if(state==='loading')await held;
 if(state==='error')return json({ok:false},503);
 return json(state==='empty'?{...sample,inputs:{...sample.inputs,debts:[]}}:sample);
 }return json({ok:false},404);
 });
 await page.goto('/app/money-strategy.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('#s-amount')).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 /* QA13: the Money section picker shows its whole choice ("Payment strategy");
    under 380px the "Money workspace" link sits under it, still 44px tall. */
 const jump=page.getByRole('combobox',{name:'Money section',exact:true});
 expect(await jump.evaluate(s=>{const cs=getComputedStyle(s),c=document.createElement('canvas').getContext('2d');c.font=cs.font;
  return c.measureText(s.options[s.selectedIndex].text).width<=s.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);})).toBe(true);
 if(width<380){const s=await jump.boundingBox(),l=await page.getByRole('link',{name:'Open Money workspace'}).boundingBox();
  expect(l.y).toBeGreaterThanOrEqual(s.y+s.height-1);expect(l.height).toBeGreaterThanOrEqual(44);}
 await page.screenshot({path:`ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/page-money-strategy-${width}.png`,fullPage:true});
 await page.locator('[data-method=snowball]').click();
 await expect(page.locator('[data-method=snowball]')).toHaveAttribute('aria-pressed','true');
 await page.locator('#s-amount').fill('1500');await page.locator('#s-amount').blur();
 await page.locator('#s-range').focus();await page.keyboard.press('ArrowRight');
 await page.locator('#s-goal').selectOption({index:1});await expect(page.locator('#s-goal-by')).toBeVisible();
 await page.locator('#s-goal-by').fill('2030-10-18');
 await page.getByRole('button',{name:'Save this plan'}).focus();await page.keyboard.press('Enter');
 await expect.poll(()=>saved?.action).toBe('save_plan');expect(saved.method).toBe('snowball');
 await expect(page.locator('[data-slot=save-msg]')).toContainText('Saved.');
 reject=true;await page.getByRole('button',{name:'Save this plan'}).click();
 await expect(page.locator('[data-slot=save-msg]')).toContainText('safe amount changed');
 await expect(page.locator('[data-slot=save-msg]')).not.toContainText('Saved.');
 for(const title of ['Month by month','How the cash check works','How this is worked out']){const summary=page.locator('summary').filter({hasText:title});await summary.click();await expect(summary.locator('..')).toHaveAttribute('open','');}
 const more=page.locator('[data-act=more-months]');if(await more.count()){await more.click();}
 await page.locator('#s-amount').fill('1');await page.locator('#s-amount').blur();await expect(page.locator('[data-slot=results]')).toContainText('less than the minimum');
 await page.locator('[data-act=use-amount]').first().click();await expect(page.locator('.tiles')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Money section',exact:true})).toHaveValue('/app/money-strategy.html');
 expect(await page.getByRole('combobox',{name:'Money section',exact:true}).locator('option').count()).toBe(16);
 for(const next of ['empty','error','loading']){
 state=next;await page.goto('/app/money-strategy.html');
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 if(next==='empty')await expect(page.getByText('No cards or loans with a balance yet')).toBeVisible();
 if(next==='error'){await expect(page.locator('.error')).toBeVisible();state='full';await page.getByRole('button',{name:'Try again'}).click();await expect(page.locator('#s-amount')).toBeVisible();}
 if(next==='loading')await expect(page.locator('[aria-busy=true]').first()).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/page-money-strategy-${next}-${width}.png`,fullPage:true});
 if(next==='loading')release();
 }
 role='staff';state='full';await page.goto('/app/money-strategy.html?client_id=safe-ui-fixture');
 await expect(page.locator('#s-amount')).toBeVisible();await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
 await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-ui-fixture');
 await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-ui-fixture#overview');
});

/* Money coming in (Finance OS CFO build, unit C). Fictional Sample payers from
   src/http/fixtures/money-strategy-income.sample.json, joined to the strategy
   sample; the Sample Chase Ink is given a $50 minimum so an amount can be
   suggested. The block's full, empty and error states, the suggestion button
   clicked like a person, and no sideways scroll at each width. */
const income=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy-income.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Payment strategy money coming in block ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let state='full';
 const withIncome=(inc)=>({...sample,defaults:{...sample.defaults,monthly_cents:150000},
  inputs:{...sample.inputs,income:inc,debts:sample.inputs.debts.map(d=>d.name==='Sample Chase Ink'?{...d,min_cents:5000}:d)}});
 await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/api/auth/session')return json({ok:true,principal:'client',staff:{role:'client'}});
 if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
 if(path==='/api/money/strategy'){
 if(state==='empty')return json(withIncome({...income,items:[],not_counted:[]}));
 if(state==='error')return json(withIncome({ok:false,reason:'read_failed'}));
 return json(withIncome(income));
 }return json({ok:false},404);
 });
 await page.goto('/app/money-strategy.html');
 const card=page.locator('.income-card');
 await expect(card).toBeVisible();
 await expect(card.getByRole('heading',{name:'Money coming in'})).toBeVisible();
 await expect(card).toContainText('Personal · Estimated monthly income');
 await expect(card).toContainText('$4,200.00');
 await expect(card).toContainText('= $1,480.00 extra for personal debts.');
 await expect(card).toContainText('= $965.00 extra for business debts.');
 await expect(card).toContainText('Every two weeks');
 await expect(card).toContainText('Not counted');
 await expect(page.locator('[data-slot=amount-note]')).toContainText('Suggested from your money coming in: $3,547.00 a month.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 /* Every visible control at least 44px tall (UI-STANDARDS §5). */
 const use=card.getByRole('button',{name:'Use $3,547.00'});
 await expect(use).toBeVisible();
 expect((await use.boundingBox()).height).toBeGreaterThanOrEqual(44);
 /* On a phone the payer list stacks, so nothing in the card is cut off sideways either. */
 if(width<=760)expect(await card.locator('.scroll-x').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
 /* Its words are body or caption size, never smaller than 13px. */
 expect(await card.locator('.caption').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(13);
 await page.screenshot({path:`ops/workflows/build-evidence/finance-os-cfo-c-money-in-2026-11-07/money-in-full-${width}.png`,fullPage:true});
 await use.click();
 await expect(page.locator('#s-amount')).toHaveValue('3,547.00');
 await expect(page.locator('.income-card')).toContainText('Your amount is set to this.');
 /* The method changes which kind's debts take the extra, and so the suggestion. */
 await page.locator('[data-method=utilization]').click();
 await expect(page.locator('.income-card')).toContainText('$2,240.00');
 for(const next of ['empty','error']){
 state=next;await page.goto('/app/money-strategy.html');
 await expect(page.locator('.income-card')).toBeVisible();
 if(next==='empty'){await expect(page.locator('.income-card')).toContainText('No repeat money coming in found yet.');
  const connect=page.locator('.income-card').getByRole('link',{name:'Connect an account'});
  await expect(connect).toHaveAttribute('href','/app/financeos.html#accounts');
  expect((await connect.boundingBox()).height).toBeGreaterThanOrEqual(44);}
 if(next==='error'){await expect(page.locator('.income-card')).toContainText('We could not read your money coming in right now.');
  await expect(page.locator('.tiles')).toBeVisible();
  const retry=page.locator('.income-card').getByRole('button',{name:'Try again'});
  expect((await retry.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`ops/workflows/build-evidence/finance-os-cfo-c-money-in-2026-11-07/money-in-${next}-${width}.png`,fullPage:true});
  state='full';await retry.click();
  await expect(page.locator('.income-card')).toContainText('Personal · Estimated monthly income');}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 if(next!=='error')await page.screenshot({path:`ops/workflows/build-evidence/finance-os-cfo-c-money-in-2026-11-07/money-in-${next}-${width}.png`,fullPage:true});
 }
 /* The phone navigation is untouched: the client bottom bar and the Money sections select still show. */
 if(width<=760)await expect(page.locator('.client-ios-nav')).toBeVisible();
 await expect(page.getByRole('combobox',{name:'Money section',exact:true})).toHaveValue('/app/money-strategy.html');
 /* An older read with no income block shows no card and claims nothing. */
 await page.route('**/api/money/strategy',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(sample)}));
 await page.goto('/app/money-strategy.html');
 await expect(page.locator('#s-amount')).toBeVisible();
 await expect(page.locator('.income-card')).toHaveCount(0);
});

/* Financing and things to check (Finance OS wave 3, units K and F). Fictional
   Sample data from src/http/fixtures/money-strategy-financing.sample.json joined
   to the strategy sample: one Fundhub payment plan, a paid Visa, a late Amex,
   and two bill flags. The switch, the Review controls and the empty / error
   actions are each clicked like a person and measured at least 44px tall. */
const kf=JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy-financing.sample.json',import.meta.url)));
for(const width of [1440,390,320])test(`Payment strategy financing and things to check ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let cleanup=kf.bill_cleanup,saved;
 const body=()=>({...sample,defaults:{...sample.defaults,monthly_cents:200000},bill_cleanup:cleanup,
  inputs:{...sample.inputs,financing:{ok:true,plans:1},debts:[...sample.inputs.debts.map(d=>kf.payments[d.name]?{...d,payment:kf.payments[d.name]}:d),kf.plan_debt]}});
 await page.route('**/api/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
 if(path==='/api/auth/session')return json({ok:true,principal:'client',staff:{role:'client'}});
 if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
 if(path==='/api/money/strategy'){
  if(route.request().method()==='POST'){saved=route.request().postDataJSON();return json({ok:true,saved:{...saved,saved_at:'2026-10-07T12:00:00Z',steps:9}});}
  return json(body());
 }return json({ok:false},404);
 });
 const tall=async(loc)=>{await loc.scrollIntoViewIfNeeded();expect((await loc.boundingBox()).height).toBeGreaterThanOrEqual(44);};
 const noSideScroll=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto('/app/money-strategy.html');
 const debts=page.locator('.debts-card');
 await expect(debts).toContainText('Sample Fundhub payment plan');
 await expect(debts).toContainText('Payment plan');
 await expect(debts).toContainText('Paid Oct 1');
 await expect(debts).toContainText('Late 6 days');
 await expect(debts.locator('tbody tr').first()).toContainText('Personal Visa');
 /* QA02: the payoff order fits its card at every width — nothing past the
    card's edge, no sideways scroll inside it. On a phone each debt is a stack:
    the number, the name and its chips, then each amount under the name with
    its label at 13px or more. */
 const outside=await debts.evaluate(card=>{const box=card.getBoundingClientRect(),bad=[];const sx=card.querySelector('.scroll-x');
  if(sx.scrollWidth>sx.clientWidth+1)bad.push(`the table scrolls sideways ${sx.scrollWidth}>${sx.clientWidth}`);
  for(const n of card.querySelectorAll('tbody td, tbody .tag, tbody .pay-chip')){const r=n.getBoundingClientRect();
   if(r.left<box.left-1||r.right>box.right+1)bad.push(`"${n.textContent.trim()}" ${Math.round(r.left)}-${Math.round(r.right)} outside ${Math.round(box.left)}-${Math.round(box.right)}`);}
  return bad;});
 expect(outside,outside.join('; ')).toEqual([]);
 if(width<=760){
  const first=debts.locator('tbody tr').first(),owe=first.locator('td[data-label="Owe now"]');
  await expect(owe).toHaveText('$1,320.40');
  const nameBox=await first.locator('.debt-name').boundingBox(),oweBox=await owe.boundingBox();
  expect(oweBox.y).toBeGreaterThanOrEqual(nameBox.y+nameBox.height-1);
  expect(await owe.evaluate(e=>{const b=getComputedStyle(e,'::before');return [b.content,parseFloat(b.fontSize)>=13];})).toEqual(['"Owe now"',true]);
 }
 /* Pay financing first: a 44px switch, off, then on; the plan moves to the front. */
 const sw=page.getByRole('switch',{name:'Pay financing first'});
 await expect(sw).toHaveAttribute('aria-checked','false');
 await tall(sw);
 await sw.click();
 await expect(sw).toHaveAttribute('aria-checked','true');
 await expect(debts.locator('tbody tr').first()).toContainText('Sample Fundhub payment plan');
 await page.getByRole('button',{name:'Save this plan'}).click();
 await expect.poll(()=>saved?.financing_first).toBe(true);
 await expect(page.locator('[data-slot=save-msg]')).toContainText('Saved.');
 /* Things to check: the two flags, each with a 44px Review that opens. */
 const card=page.locator('.cleanup-card');
 await expect(card).toContainText('Charged twice');
 await expect(card).toContainText('SAMPLE CLOUD SUITE charged $14.40 two times on Oct 3, 2026.');
 await expect(card).toContainText('Price went up');
 const review=card.locator('summary').filter({hasText:'Review'}).first();
 await tall(review);
 await review.click();
 await expect(card.locator('details').first()).toHaveAttribute('open','');
 await expect(card).toContainText('Ask the company or your bank for a refund.');
 await noSideScroll();
 if(width<=760)await expect(page.locator('.client-ios-nav')).toBeVisible();
 await page.screenshot({path:`ops/workflows/build-evidence/finance-os-wave3-c-kf-2026-11-07/kf-full-${width}.png`,fullPage:true});
 /* Empty and error: one 44px action each, no sideways scroll. */
 cleanup={...kf.bill_cleanup,flags:[],checked_bills:0};
 await page.goto('/app/money-strategy.html');
 await expect(card).toContainText('No repeat bills found yet.');
 await tall(card.getByRole('link',{name:'Connect an account'}));
 await noSideScroll();
 cleanup={ok:false,reason:'read_failed'};
 await page.goto('/app/money-strategy.html');
 await expect(card).toContainText('We could not check your bills right now.');
 const retry=card.getByRole('button',{name:'Try again'});
 await tall(retry);await noSideScroll();
 await page.screenshot({path:`ops/workflows/build-evidence/finance-os-wave3-c-kf-2026-11-07/kf-error-${width}.png`,fullPage:true});
 cleanup=kf.bill_cleanup;await retry.click();
 await expect(card).toContainText('Charged twice');
});
