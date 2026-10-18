import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {sampleVault} from '../src/http/fixtures/money-vault.sample.mjs';
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
test.use({hasTouch:true});
for(const width of [1440,390,320])test(`funding papers professional states/actions ${width}`,async({page})=>{
 fs.mkdirSync(evidence,{recursive:true});await page.setViewportSize({width,height:900});
 let state='full',role='client',uploads=0;let release;const held=new Promise(r=>release=r);
 await page.route('**/api/**',async route=>{
  const p=new URL(route.request().url()).pathname;const json=(d,status=200)=>route.fulfill({status,json:d});
  if(p==='/api/auth/session')return json({ok:true,principal:role});
  if(p==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
  if(p==='/api/documents-upload'){uploads++;return json({ok:false,error:'invalid_file'},400);}
  if(p==='/api/money/vault'){
   if(state==='loading')await held;
   if(state==='error')return json({ok:false},503);
   const v=sampleVault({variant:state,audience:role==='client'?'client':'staff'});
   for(const it of v.items)for(const d of it.documents)d.download={url:'/safe-fixture.pdf',expires_at:'2099-01-01T00:00:00Z'};
   return json(v);
  }
  return json({ok:true,items:[]});
 });
 for(const next of ['full','empty','error','loading']){
  state=next;await page.goto('/app/money-vault.html');await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
  if(next==='full'||next==='empty')await expect(page.locator('[data-item]').first()).toBeVisible();
  if(next==='error')await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
  if(next==='loading')await expect(page.locator('[aria-busy=true]').first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`${evidence}/page-money-vault-${width}-${next}.png`,fullPage:true});
 }
 release();state='full';await page.goto('/app/money-vault.html');await expect(page.locator('[data-item]').first()).toBeVisible();
 await expect(page.locator('.vt-view')).toHaveCount(9);
 const pick=page.locator('[data-act=pick]').first();await pick.focus();const chooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');await(await chooser).setFiles({name:'safe.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 safe fixture')});await expect.poll(()=>uploads).toBe(1);
 await expect(page.locator('.vt-flash.is-bad')).toBeVisible();
 state='error';await page.reload();await page.getByRole('button',{name:'Try again'}).tap();await expect(page.getByRole('button',{name:'Try again'})).toBeVisible();
 role='owner';state='full';await page.goto('/app/money-vault.html?client_id=safe-test');await expect(page.locator('[data-act=accept]').first()).toBeVisible();await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');
});
test('vault styling is contained when mounted in FinanceOS',async({page})=>{
 await page.goto('/app/money-vault.html');
 await page.setContent('<body data-client-ios><div id="outside"><h1>Outside heading</h1><div class="card">Outside card</div></div><section id="fos-vault"><div class="fh-vault"><div class="vt-head"><h1>Funding papers</h1></div><div class="card">Inside card</div></div></section></body>');
 await page.addStyleTag({path:'public/app/money-vault-ios.css'});
 expect(await page.locator('#outside .card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('0px');
 expect(await page.locator('#fos-vault .card').evaluate(el=>getComputedStyle(el).borderRadius)).toBe('20px');
});
