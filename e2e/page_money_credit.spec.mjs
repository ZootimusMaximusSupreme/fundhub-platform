import { test, expect } from '@playwright/test';
import fs from 'node:fs';
test.use({hasTouch:true});
import bundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
import { buildCreditHistory } from '../src/finance/credit-history.mjs';
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
   // The native picker supports keyboard type-ahead; Overview is its unique O.
   await page.keyboard.press('o');
   await expect(page).toHaveURL(/\/app\/money\.html$/);
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

/* Credit over time (spec item 4, 2026-11-06). The fixture goes through the real
   back end, src/finance/credit-history.mjs, so the screen gets exactly what the
   read sends. One fictional sample person (stamped simulated, so every screen
   says Sample): four monthly pulls with September missing, an Equifax score
   missing on the August pull, and two saved businesses, one with no report. */
const historyEvidence='ops/workflows/build-evidence/finance-os-credit-history-2026-11-07';
function historyFixture(){
 /* The sample's one card, $8,000 limit. The newest pull matches the read's own
    tiles: 702 / 709 / 706 and $3,127 used (39.1%). */
 const card=(balance)=>({creditorName:'FIRST PLATYPUS BANK',accountType:'Revolving',creditLimit:8000,currentBalance:balance});
 const biz=(score,fsr)=>({data:{scoreInformation:{commercialScore:{score},fsrScore:{score:fsr}}}});
 const pull=(at,scores,balance,reports)=>({id:'sample-'+at,created_at:at,result:{environment:'simulated',simulated:true,scores,scoreModels:{},
  tradelines:[card(balance)],businessReports:reports}});
 const crsRows=[
  pull('2026-06-17T12:00:00.000Z',{ex:668,eq:675,tu:671},5200,[]),
  pull('2026-07-17T12:00:00.000Z',{ex:681,eq:690,tu:684},4600,[{name:'Portal Sample LLC',state:'AZ',report:biz(54,38)}]),
  pull('2026-08-17T12:00:00.000Z',{ex:690,eq:null,tu:695},3900,[{name:'Portal Sample LLC',state:'AZ',report:biz(58,41)}]),
  pull('2026-10-17T12:00:00.000Z',{ex:702,eq:709,tu:706},3127,[{name:'Portal Sample LLC',state:'AZ',report:biz(63,44)}])
 ];
 const businesses=[
  {id:'sample-biz-1',name:'Portal Sample LLC',entity_data:{state:'AZ'},created_at:'2026-01-05T00:00:00Z'},
  {id:'sample-biz-2',name:'Portal Sample Two LLC',entity_data:{state:'AZ'},created_at:'2026-06-01T00:00:00Z'}
 ];
 return {...structuredClone(sample),business:{name:'Portal Sample LLC',intelliscore:63,fsr:44},
  credit_history:buildCreditHistory({crsRows,businesses})};
}
async function chartFit(page){
 return page.evaluate(()=>{
  const box=document.querySelector('[data-hist-plot]'),svg=box&&box.querySelector('svg.chart:not(.chart-use)');
  const labels=[...document.querySelectorAll('[data-hist] svg.chart text tspan')].map(t=>parseFloat(getComputedStyle(t).fontSize));
  return {box:box?box.clientWidth:0,drawn:svg?Number(svg.getAttribute('viewBox').split(' ')[2]):0,
   lines:svg?svg.querySelectorAll('polyline').length:0,dots:svg?svg.querySelectorAll('circle.dot').length:0,
   smallest:labels.length?Math.min(...labels):0};
 });
}
/* Every control the card adds, measured: at least 44px tall (UI-STANDARDS
   sections 0, 5 and 11) and inside the card, so nothing scrolls sideways. */
async function controlsFit(page,scope){
 return page.locator(scope+' [data-hist]').evaluate(card=>{
  const c=card.getBoundingClientRect();
  return [...card.querySelectorAll('select,button,a,input,[role="tab"],summary')].map(el=>{
   const r=el.getBoundingClientRect();
   return {tag:el.tagName.toLowerCase(),name:el.getAttribute('aria-label')||(el.labels&&el.labels[0]?el.labels[0].textContent.trim():el.textContent.trim()),
    height:Math.round(r.height),inside:r.left>=c.left-1&&r.right<=c.right+1&&r.right<=innerWidth};
  });
 });
}
async function markHistory(page,file,caption){
 await page.locator('[data-hist]').evaluate((el,caption)=>{el.style.outline='2px solid #c52020';const c=document.createElement('p');c.id='hist-proof-caption';c.textContent=caption;c.style.cssText='color:#b11c1c;font:12px Arial;margin:8px 0';el.before(c);},caption);
 await page.locator('[data-hist]').screenshot({path:`${historyEvidence}/${file}`});
 await page.locator('#hist-proof-caption').evaluate(el=>el.remove());await page.locator('[data-hist]').evaluate(el=>el.style.removeProperty('outline'));
}
for(const width of [1440,390])test(`Credit over time: bureau lines, the business picker and a true-size chart at ${width}`,async({page})=>{
 fs.mkdirSync(historyEvidence,{recursive:true});
 await page.setViewportSize({width,height:900});
 const fixture=historyFixture();let writes=0;
 const errors=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(route.request().method()!=='GET'){writes++;return json({ok:false},403);}
  if(path==='/api/auth/session')return json({ok:true,principal:'client'});
  if(path==='/api/money/credit')return json(fixture);
  return json(bundle.reads[path]||{ok:true,items:[]});
 });
 await page.goto('/app/money-credit.html');
 const card=page.locator('[data-hist]');
 await expect(card).toContainText('Credit over time');
 await expect(card).toContainText('4 pulls · Jun 17, 2026 to Oct 17, 2026');
 await expect(card).toContainText('A break in a line means a month with no pull');
 await expect(card).toContainText('Cards used at each pull');
 await expect(card.locator('svg.chart-use title',{hasText:'Cards used 39.1% on Oct 17, 2026'})).toHaveCount(1);
 await expect(page.locator('#f-use').locator('..')).toContainText('39.1%');
 // Drawn at the card's real width, so the labels are real pixels on a phone.
 await expect.poll(async()=>{const f=await chartFit(page);return Math.abs(f.box-f.drawn);}).toBeLessThanOrEqual(2);
 let fit=await chartFit(page);
 expect(fit.smallest,'every chart label at the 13px caption floor').toBeGreaterThanOrEqual(13);
 // Experian and TransUnion: Jun–Aug joined, Oct alone after the missing September.
 // Equifax: Jun–Jul joined, broken by the August pull without it. 11 real points, no made-up ones.
 expect(fit.lines).toBe(3);
 expect(fit.dots).toBe(11);
 await expect(card.locator('svg.chart:not(.chart-use) title',{hasText:/^Equifax \d+ on Aug/})).toHaveCount(0);
 const pick=card.getByLabel('Show credit for');
 await expect(pick.locator('option')).toHaveText(['Personal','Portal Sample LLC','Portal Sample Two LLC']);
 await expect(pick).toHaveValue('personal');
 const controls=await controlsFit(page,'#credit-root');
 expect(controls.map(c=>c.tag),'the business picker is the one control the card adds').toEqual(['select']);
 for(const c of controls){
  expect(c.height,`${c.name} is at least 44px tall at ${width}px`).toBeGreaterThanOrEqual(44);
  expect(c.inside,`${c.name} fits inside the card at ${width}px`).toBe(true);
 }
 await markHistory(page,`credit-history-personal-${width}.png`,'Credit over time: one line per bureau; breaks where a month or a score is missing');
 await page.screenshot({path:`${historyEvidence}/credit-page-${width}.png`,fullPage:true});

 // A person focuses the picker (tap or Tab) before choosing; Playwright's selectOption alone does not.
 await pick.focus();
 await pick.selectOption({label:'Portal Sample LLC'});
 await expect(card.getByLabel('Show credit for')).toHaveValue('biz:0');
 await expect(card.getByLabel('Show credit for'),'the picker keeps focus after the card redraws').toBeFocused();
 await expect(card).toContainText('Intelliscore');
 await expect(card).toContainText('Financial stability (FSR)');
 await expect(card).toContainText('3 reports · Jul 17, 2026 to Oct 17, 2026');
 await expect.poll(async()=>{const f=await chartFit(page);return Math.abs(f.box-f.drawn);}).toBeLessThanOrEqual(2);
 fit=await chartFit(page);
 expect(fit.lines,'Jul–Aug joined on both scores; Oct after the missing September').toBe(2);
 expect(fit.dots).toBe(6);
 await expect(card.locator('svg.chart title',{hasText:/Experian|Equifax|TransUnion/})).toHaveCount(0);
 await markHistory(page,`credit-history-business-${width}.png`,'Business picker: this company\'s own Intelliscore and FSR lines');

 await card.getByLabel('Show credit for').selectOption({label:'Portal Sample Two LLC'});
 await expect(card).toContainText('No business credit report is saved for Portal Sample Two LLC yet.');
 await expect(card.locator('svg.chart')).toHaveCount(0);
 for(const c of await controlsFit(page,'#credit-root'))expect(c.height,`${c.name} stays 44px or taller`).toBeGreaterThanOrEqual(44);
 await card.getByLabel('Show credit for').selectOption({label:'Personal'});
 await expect(card).toContainText('One line for each bureau');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect(writes).toBe(0);
 expect(errors).toEqual([]);
});

test('Credit over time inside FinanceOS: drawn at true size and the picker works',async({page})=>{
 await page.setViewportSize({width:390,height:900});
 const fixture=historyFixture();let writes=0;
 await page.route('**/api/**',async route=>{
  const u=new URL(route.request().url());
  const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
  if(route.request().method()!=='GET'){writes++;return json({ok:false},403);}
  if(u.pathname==='/api/auth/session')return json({ok:true,principal:'staff',staff:{role:'owner'}});
  if(u.pathname==='/api/money/credit')return json(fixture);
  return json(bundle.reads[u.pathname]||{ok:true,items:[]});
 });
 await page.goto('/app/financeos.html?client_id=safe-sample#credit');
 const card=page.locator('#fos-credit [data-hist]');
 await expect(card).toContainText('Credit over time');
 await expect.poll(async()=>{const f=await chartFit(page);return f.box>0?Math.abs(f.box-f.drawn):999;}).toBeLessThanOrEqual(2);
 expect((await chartFit(page)).smallest).toBeGreaterThanOrEqual(13);
 // At 390px, inside FinanceOS: each control the card adds is 44px or taller and fits the card.
 const controls=await controlsFit(page,'#fos-credit');
 expect(controls.map(c=>c.tag)).toEqual(['select']);
 for(const c of controls){
  expect(c.height,`${c.name} is at least 44px tall at 390px`).toBeGreaterThanOrEqual(44);
  expect(c.inside,`${c.name} fits inside the card at 390px`).toBe(true);
 }
 await card.getByLabel('Show credit for').selectOption({label:'Portal Sample LLC'});
 await expect(card).toContainText('Intelliscore');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await markHistory(page,'credit-history-financeos-390.png','FinanceOS Credit tab: the same card, drawn at the phone\'s width');
 expect(writes).toBe(0);
});
