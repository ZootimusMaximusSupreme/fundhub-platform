import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
import { withSession, json, trackErrors } from './harness.mjs';

const tabs = ['overview','accounts','payments','transfers','alerts','next','credit','fundability','strategy','banks','declines','helper','plan','vault','connections','setup'];
const evidence = 'ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
const endpoint = key => key === 'next' ? '/api/money/tasks' : key === 'declines' ? '/api/blueprint/declines' : '/api/money/' + key;
function empty(path, sample) {
  const d = structuredClone(sample);
  if (path.endsWith('/overview')) return {...d,accounts:[],containers:[]};
  if (path.endsWith('/accounts')) return {...d,containers:[],unassigned:{accounts:[],cards:[],loans:[]}};
  if (path.endsWith('/tasks')) return {...d,tasks:[]};
  if (path.endsWith('/helper')) return {...d,turns:[]};
  if (path.endsWith('/transfers')) return {...d,waiting:[],history:[],accounts:[]};
  if (path.endsWith('/plan')) return {...d,pins:[]};
  if (path.endsWith('/banks')) return {...d,recommended_banks:[],relationships:[],location:null};
  if (path.endsWith('/strategy')) return {...d,inputs:{...d.inputs,debts:[]}};
  if (path.endsWith('/credit') || path.endsWith('/fundability')) return {ok:true,has_pull:false};
  if (path.endsWith('/declines')) return {ok:true,view:{eligible:true,can_paste:true,applications:[],declines:[]}};
  if (path.endsWith('/alerts')) return {...d,cards:[],alerts:[],reserve:{personal:{state:'unknown'},business:{state:'unknown'}}};
  if (path.endsWith('/vault')) return {...d,scopes:[],items:[],unfiled:[],summary:{required:0,accepted:0,waived:0,uploaded:0,missing:0,expired:0,rejected:0}};
  if (path.endsWith('/connections')) return {...d,connections:[],containers:[],summary:{totals:[],containers:[]}};
  if (path.endsWith('/payments')) return {...d,plans:[],upcoming:[]};
  return {...d,setup_fee_cents:null};
}
async function noPageOverflow(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),label).toBe(true);
}
async function openSections(page, width) {
  if (width <= 760 && await page.locator('#fos-nav-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#fos-nav-toggle').click();
}
async function markedShot(page, name, selector, caption) {
  await page.evaluate(({selector,caption}) => {
    const el=document.querySelector(selector),r=el.getBoundingClientRect();
    const box=document.createElement('div');box.id='proof-mark';
    Object.assign(box.style,{position:'absolute',left:r.left+scrollX+'px',top:r.top+scrollY+'px',width:r.width+'px',height:r.height+'px',border:'2px solid #d02525',pointerEvents:'none',zIndex:150});
    const text=document.createElement('span');text.textContent=caption;
    Object.assign(text.style,{position:'absolute',left:'0',top:'-20px',padding:'2px 5px',color:'#b11c1c',background:'#fff',font:'11px Arial,sans-serif',whiteSpace:'nowrap'});
    box.appendChild(text);document.body.appendChild(box);
  },{selector,caption});
  await page.screenshot({path:`${evidence}/${name}.png`,fullPage:false});
  await page.locator('#proof-mark').evaluate(el=>el.remove());
}
for (const width of [1440,390,320]) {
  test(`FinanceOS grouped navigation, modules and states at ${width}`, async ({ page }) => {
    test.setTimeout(150_000);
    fs.mkdirSync(evidence,{recursive:true});
    await page.setViewportSize({width,height:1000});
    await withSession(page, {staff:{role:'client'}});
    const errors=trackErrors(page), writes=[], reads=[];
    let state='full';
    await page.route('**/api/**', async route => {
      const path=new URL(route.request().url()).pathname;
      if (route.request().method() !== 'GET') { writes.push(path);return json(route,{ok:false,error:'sample_read_only'},409); }
      reads.push(path);
      if (path==='/api/auth/session') return json(route,{ok:true,principal:'client',portal_sample_available:true,portal_sample:true,staff:{role:'client',name:'Portal Sample'}});
      if (path==='/api/read/affiliate-portal') return json(route,{ok:true,enrolled:false});
      const data = bundle.reads[path] || (path==='/api/blueprint/declines' ? {ok:true,view:{eligible:true,can_paste:true,applications:[],declines:[]}} : {ok:true,items:[]});
      if (state==='loading' && (path.startsWith('/api/money/') || path==='/api/blueprint/declines')) return;
      if (state==='error' && (path.startsWith('/api/money/') || path==='/api/blueprint/declines')) return json(route,{ok:false,error:'unavailable'},503);
      return json(route,state==='empty' ? empty(path,data) : {...data,portal_sample:true,sample_notice:bundle.notice});
    });
    await page.goto('/app/financeos.html#overview');
    await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
    await expect(page.locator('#fos-overview')).toContainText('Personal Checking');
    await expect(page.locator('.fos-tabs [role="tab"]')).toHaveCount(16);
    await expect(page.locator('.fos-nav-label')).toHaveText(['Daily money','Credit & funding','Tools & documents']);
    await expect(page.locator('.fos-intro')).toHaveCount(0);
    await expect(page.locator('.mbar .logo')).toHaveCount(0);
    await noPageOverflow(page,'overview');
    // Useful account work begins near the top, without a hero pushing it down.
    expect(await page.locator('#fos-overview .head').evaluate(el=>el.getBoundingClientRect().top)).toBeLessThan(width>760?260:320);
    await markedShot(page,`page-financeos-frame-${width}`,'#fos-overview .head','Compact frame; account work starts here');
    await openSections(page,width);
    await markedShot(page,`page-financeos-navigation-${width}`,'.fos-tabs','All 16 sections, grouped by task');
    for (const key of tabs) {
      await openSections(page,width);
      await page.locator(`#tab-${key}`).click();
      const panel=page.locator(`#fos-${key}`);
      await expect(page.locator(`#tab-${key}`)).toHaveAttribute('aria-selected','true');
      await expect(panel).toBeVisible();
      await expect(panel.getByRole('heading').first()).toBeVisible();
      await expect(panel.locator('[aria-busy=true]')).toHaveCount(0);
      await expect(panel.locator('.fos-soon')).toHaveCount(0);
      await expect(panel.locator('[role="alert"]')).toHaveCount(0);
      await noPageOverflow(page,key);
      expect(reads).toContain(endpoint(key));
      if (width<=760) await expect(page.locator('#fos-nav-toggle')).toHaveAttribute('aria-expanded','false');
    }
    await openSections(page,width);
    await page.locator('#tab-setup').press('Home');
    await expect(page.locator('#tab-overview')).toHaveAttribute('aria-selected','true');
    await page.locator('#tab-overview').press('ArrowDown');
    await expect(page.locator('#tab-accounts')).toBeFocused();
    await expect(page.locator('#tab-accounts')).toHaveAttribute('aria-selected','true');
    await page.locator('#tab-accounts').press('ArrowRight');
    await expect(page.locator('#tab-payments')).toHaveAttribute('aria-selected','true');
    await page.locator('#tab-payments').press('End');
    await expect(page.locator('#tab-setup')).toHaveAttribute('aria-selected','true');
    if(width<=760){
      await page.locator('#tab-setup').press('Escape');
      await expect(page.locator('#fos-nav-toggle')).toBeFocused();
      await expect(page.locator('#fos-nav-toggle')).toHaveAttribute('aria-expanded','false');
    }
    for(const next of ['empty','error','loading']) {
      state=next;
      for(const key of tabs){
        await page.goto(`/app/financeos.html?frame-proof=${next}-${key}#${key}`);
        const panel=page.locator(`#fos-${key}`);
        await expect(panel).toBeVisible();
        await expect(panel.getByRole('heading').first()).toBeVisible();
        await expect(panel.locator('.fos-soon')).toHaveCount(0);
        if(next==='error') await expect(panel.locator('[role="alert"]').first()).toBeVisible();
        else if(next==='loading') await expect(panel.locator('[aria-busy=true]').first()).toBeVisible();
        else {
          await expect(panel.locator('[aria-busy=true]')).toHaveCount(0);
          await expect(panel.locator('[role="alert"]')).toHaveCount(0);
        }
        await noPageOverflow(page,`${next} ${key}`);
        if(key==='overview')await markedShot(page,`page-financeos-${next}-${width}`,`#fos-${key}`,`${next}: section feedback stays in place`);
      }
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('FinanceOS preserves staff context, lazy mounts and in-section compatibility links',async({page})=>{
  const reads=[];
  await page.route('**/api/**',async route=>{
    const u=new URL(route.request().url());reads.push(u.pathname+u.search);
    if(u.pathname==='/api/auth/session')return json(route,{ok:true,principal:'staff',staff:{role:'owner'}});
    return json(route,bundle.reads[u.pathname]||{ok:true,items:[]});
  });
  await page.goto('/app/financeos.html?client_id=safe-sample#credit');
  await expect(page.locator('#fos-credit')).toContainText('702');
  expect(reads).toContain('/api/money/credit?client_id=safe-sample');
  expect(reads.filter(p=>p.startsWith('/api/money/accounts'))).toHaveLength(0);
  await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-sample');
  await page.locator('#tab-accounts').click();
  await expect(page.locator('#fos-accounts')).toContainText('Personal Checking');
  expect(reads).toContain('/api/money/accounts?client_id=safe-sample');
  await page.locator('#tab-credit').click();
  expect(reads.filter(p=>p.startsWith('/api/money/credit'))).toHaveLength(1);
  await page.evaluate(()=>{const a=document.createElement('a');a.href='money-payments.html';a.textContent='Compatibility route proof';document.querySelector('#fos-credit').append(a);});
  await page.getByRole('link',{name:'Compatibility route proof'}).click();
  await expect(page).toHaveURL(/client_id=safe-sample#payments$/);
  await expect(page.locator('#tab-payments')).toHaveAttribute('aria-selected','true');
});
