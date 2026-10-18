// Staff Finance OS only. Every API is intercepted; no customer data or money moves.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, OWNER, json } from './harness.mjs';

const ID = 'c1000000-0000-4000-8000-000000000001';
const client = { id: ID, first_name: 'Dana', last_name: 'Whitfield', email: 'dana@example.com' };
const basis = { lines: 3, counted: 3, unknown: 0 };
const grid = { ok: true, lines: 3, rows: [
  { key:'credit_limit',label:'Credit limit',display:'30000.00',basis },
  { key:'balance',label:'Balance',display:'7500.00',basis },
  { key:'available',label:'Available',display:'22500.00',basis },
  { key:'utilization',label:'Utilization',display:'25%',basis },
  { key:'avg_apr',label:'Average APR',display:'19.9%',basis },
  { key:'cheapest',label:'Cheapest money',display:'12.99% · Chase · 5000.00',basis },
  { key:'open_lines',label:'Open cards',display:'3',unit:'count' }
] };
const detail = { ok:true,client,transactions:[
  {product_name:'Funding assessment',created_at:'2026-10-01T00:00:00Z',amount_paid:'300.00',status:'succeeded'},
  {product_name:'Blueprint deposit',created_at:'2026-10-02T00:00:00Z',amount_paid:'1000.00',status:'refunded'}
],invoices:[{status:'open',due_at:'2026-10-20',created_at:'2026-10-01',amount_due:'1500.00',amount_paid:'500.00',balance_due:'1000.00'}] };
const banks = { ok:true,surface:{groups:[
  {key:'personal',accounts:[{id:'p',name:'Personal checking',mask:'1101',account_type:'depository',current_display:'4210.55'}]},
  {key:'business',accounts:[{id:'b',name:'Business operating',mask:'2202',account_type:'depository',current_display:'21406.00'},{id:'i',name:'Brokerage',mask:'9090',account_type:'investment',current_display:null}]},
  {key:'unknown',accounts:[{id:'u',name:'Unclassified savings',account_type:'depository',current_display:'88.10'}]}
]},details:{p:{hand_entered:true},b:{hand_entered:false},i:{hand_entered:false},u:{hand_entered:false}} };
const bills = {ok:true,bills:[{merchant_display:'Adobe',cadence:'monthly',typical_amount_display:'54.99',next_expected_on:'2026-11-01'},{merchant_display:'Hosting',cadence:'monthly',typical_amount_display:null,next_expected_unknown_reason:'not enough history yet'}]};
const suggestions = {ok:true,hasPull:true,costingYou:[{title:'Pay Chase Ink down to 30%',severity:'high',lines:['It costs about $40 a month in interest.']}],notAFactor:[{title:'Age of accounts',lines:['Age does not move the score this month.']}]};
const evidence = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/finance-os');

function handlers(state = 'full') {
  const answer = (data, empty) => async route => {
    if (state === 'error') return json(route,{ok:false,message:'Fixture unavailable'},503);
    return json(route,state === 'empty' ? empty : data);
  };
  return {
    '/api/dashboard/clients': {ok:true,clients:[client]},
    '/api/read/finance-os-suggestions': answer(suggestions,{ok:true,hasPull:false}),
    '/api/read/finance-os?': answer(grid,{ok:true,rows:[],lines:0}),
    '/api/dashboard/client?id=': answer(detail,{ok:true,client,transactions:[],invoices:[]}),
    '/api/finance/bank-accounts': answer(banks,{ok:true,surface:{groups:[]},details:{}}),
    '/api/finance/bills': answer(bills,{ok:true,bills:[]})
  };
}
async function capture(page, key, region='.fos-hero') {
  if (!process.env.FINANCE_OS_EVIDENCE) return;
  fs.mkdirSync(evidence,{recursive:true});
  const box = await page.locator(region).first().boundingBox();
  await page.mouse.move(0,0);
  await page.screenshot({path:path.join(evidence,key+'-raw.png'),fullPage:true,animations:'disabled'});
  const metrics = await page.evaluate(()=>{
    const side=document.getElementById('side'), heading=document.querySelector('.fos-page-heading h2');
    const invoice=document.querySelector('.fos-r.inv:not(.fos-table-head)');
    return {scrollY,scrollWidth:document.documentElement.scrollWidth,width:innerWidth,
      side:{rect:side.getBoundingClientRect().toJSON(),width:getComputedStyle(side).width,transform:getComputedStyle(side).transform},
      pageTitleSize:getComputedStyle(heading).fontSize,invoiceFilter:invoice?getComputedStyle(invoice).filter:null,
      documentHeight:document.documentElement.scrollHeight,
      simulatorTop:document.getElementById('fosSimForm')?.getBoundingClientRect().top};
  });
  fs.writeFileSync(path.join(evidence,key+'.json'),JSON.stringify({box,...metrics},null,2));
}
async function fits(page) {
  const width=page.viewportSize().width;
  // A mobile browser may expand innerWidth to fit overflow. Compare with the
  // actual device viewport so zoomed-out overflow cannot report a pass.
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
  const visible = page.locator('#fosWrap');
  expect(await visible.evaluate(el=>el.getBoundingClientRect().right)).toBeLessThanOrEqual(width+1);
}
for (const width of [1440,390,320]) {
  for (const state of ['full','empty','error','loading']) {
    test(width+'px '+state+': task hierarchy, honest state and no overflow',async ({page})=>{
      await page.setViewportSize({width,height:1000});
      await page.route('https://fonts.**',route=>route.abort());
      const h=handlers(state);
      let release;
      if (state === 'loading') {
        const gate = new Promise(resolve=>{release=resolve;});
        h['/api/read/finance-os?']=async route=>{await gate;return json(route,grid);};
      }
      await openScreen(page,'/app/finance-os.html?client_id='+ID,OWNER,h);
      await expect(page.locator('#fh-workspace-header')).toBeVisible();
      await expect(page.locator('#fh-workspace-scope-label')).toHaveText('Dana Whitfield');
      await expect(page.locator('#fosClientTools')).not.toHaveAttribute('open','');
      await fits(page);
      if (state === 'loading') {
        await expect(page.locator('#fosWrap')).toHaveAttribute('aria-busy','true');
        await expect(page.locator('#fosWrap')).toContainText('Reading this client’s file');
        await expect(page.locator('#fosWrap')).not.toContainText('$0');
        await capture(page,width+'-'+state);
        release();
        await expect(page.locator('#fosSimCash')).toBeVisible();
      } else {
        await expect(page.locator('#fosWrap')).toHaveAttribute('aria-busy','false');
        if (state === 'full') {
          await expect(page.locator('.fos-hero')).toContainText('$22,500.00');
          await expect(page.locator('.fos-summary-facts')).toContainText('$7,500.00');
          await expect(page.locator('.fos-summary-facts')).toContainText('25%');
          expect(await page.locator('.fos-summary-facts .fh-num').first().evaluate(el=>{
            const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;
          })).toBe(1);
          const y = await page.locator('#fosSimForm').evaluate(el=>el.getBoundingClientRect().top);
          expect(y).toBeLessThan(700);
          await expect(page.locator('#payments')).toContainText('$300.00');
          await expect(page.locator('#payments')).toContainText('refunded');
          expect(await page.locator('.fos-r.inv').last().evaluate(el=>getComputedStyle(el).filter)).toBe('none');
          await expect(page.locator('#banking')).toContainText('Some balances below were typed in by hand');
          await expect(page.locator('#banking .is-unknown,.fos-r .dash').first()).toBeAttached();
          await page.locator('.fos-jumps a[href="#payments"]').click();
          await expect(page.locator('#payments')).toBeInViewport();
          await page.evaluate(()=>window.scrollTo(0,0));
        } else if (state === 'empty') {
          await expect(page.locator('.fos-hero')).toContainText('There is no credit report on file');
          await expect(page.locator('.fos-hero')).not.toContainText('$0');
          await expect(page.locator('#banking')).toContainText('No bank account is on file');
          await expect(page.locator('#payments')).toContainText('Nothing has been invoiced');
        } else {
          await expect(page.locator('.fos-hero')).toContainText('database is not answering');
          await expect(page.locator('#credit')).toContainText('database is not answering');
          await expect(page.locator('#fosSimCash')).toBeVisible();
          await expect(page.locator('#banking')).toContainText('database is not answering');
          await expect(page.locator('#fh-data-banner')).toHaveCount(0);
        }
        await capture(page,width+'-'+state);
      }
      await fits(page);
    });
  }
}

test('no selection: choose a client with keyboard; no financial reads',async ({page})=>{
  const reads=[];
  await page.on('request',req=>{if (/\/api\/(read\/finance-os|finance\/(bank-accounts|bills))/.test(req.url()))reads.push(req.url());});
  await openScreen(page,'/app/finance-os.html',OWNER,handlers());
  await expect(page.locator('#fosClientTools')).toHaveAttribute('open','');
  await expect(page.locator('#fosSimForm')).toHaveCount(0);
  await expect(page.locator('#fh-workspace-scope-label')).toHaveText('No client selected');
  await page.locator('#fosFind').focus();
  await page.keyboard.type('Dana');
  await page.keyboard.press('Tab');
  await expect(page.locator('#fosClient')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(page.locator('#fosClient')).toHaveValue(ID);
  await expect(page.locator('#fosOpen')).toBeFocused();
  expect(reads).toEqual([]);
  await capture(page,'no-client','.fos-controlbar');
});

test('phone touch: client disclosure and local search do not change active scope',async ({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  const page=await context.newPage();
  await openScreen(page,'/app/finance-os.html?client_id='+ID,OWNER,handlers());
  await page.locator('#fosClientTools summary').tap();
  await expect(page.locator('#fosFind')).toBeVisible();
  await page.locator('#fosFind').fill('unmatched');
  await expect(page.locator('#fosPickMsg')).toHaveText('0 of 1 clients match');
  await expect(page.locator('#fosOpen')).toBeDisabled();
  await expect(page.locator('#fh-workspace-scope-label')).toHaveText('Dana Whitfield');
  await fits(page);
  await capture(page,'390-client-picker','.fos-controlbar');
  await context.close();
});

test('partial and unknown summary retain the financial qualifiers',async ({page})=>{
  const h=handlers();
  h['/api/read/finance-os?']={ok:true,lines:3,rows:[
    {key:'available',label:'Available',display:'12000.00',basis:{lines:3,counted:2,unknown:1,partial:true}},
    {key:'balance',label:'Balance',display:null,basis:{lines:3,counted:0,unknown:3,partial:true}},
    {key:'utilization',label:'Utilization',display:'30%',basis:{lines:3,counted:2,unknown:1,partial:true}}
  ]};
  await openScreen(page,'/app/finance-os.html?client_id='+ID,OWNER,h);
  await expect(page.locator('.fos-hero')).toContainText('$12,000.00+');
  await expect(page.locator('.fos-hero')).toContainText('Some cards did not report a limit');
  await expect(page.locator('.fos-summary-facts .is-unknown')).toHaveText('—');
  await expect(page.locator('.fos-summary-facts .is-partial')).toHaveCount(0);
  await expect(page.locator('.fos-summary-facts small')).toContainText('2 of 3 credit cards');
  await expect(page.locator('#credit .fh-row').last()).not.toContainText('real figure is higher');
});
