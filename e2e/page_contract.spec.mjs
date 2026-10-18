import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import fs from 'node:fs';
const url = '/contract.html?id=sample-contract&sig=sample-signature&exp=4102444800&signer=sample-signer';
const evidence = 'ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/contract';
const contract = { title: 'Your funding agreement', body: 'Funding agreement\n\nReview the terms provided by your advisor.\n\nThis sample document is used only by the browser test.', source_kind:'text', can_sign:true, verified:true, status:'sent', signer:{ name:'Sample Client',status:'sent'}, signature_statement:'I have read this document and agree to sign electronically.', fields:[] };
async function open(page, answer = {ok:true,contract}, status = 200) {
  const writes = [];
  await page.route('**/api/contracts/sign?**', async route => {
    expect(route.request().headers().authorization).toBeUndefined();
    const requestUrl = new URL(route.request().url());
    expect(requestUrl.searchParams.get('sig')).toBe('sample-signature');
    if(route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON());
      return route.fulfill({json:{ok:true,contract:{...contract,status:'signed',can_sign:false,signer:{...contract.signer,status:'signed',signer_name:'Sample Client',signed_at:'2026-10-18T00:00:00Z'}}}});
    }
    return route.fulfill({status,json:answer});
  });
  await page.goto(url);
  return writes;
}
test('text agreement, exact consent payload, download and responsive layout', async ({page}) => {
  const writes = await open(page);
  await expect(page.locator('#signPanel')).toBeVisible();
  await expect(page.locator('#go')).toBeDisabled();
  await page.locator('#name').fill('Sample Client');
  await expect(page.locator('#go')).toBeDisabled();
  await page.locator('#agree').check();
  await expect(page.locator('#go')).toBeEnabled();
  fs.mkdirSync(evidence,{recursive:true});
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({path:`${evidence}/page_contract-${width}.png`,fullPage:true});
  }
  await page.locator('#go').click();
  await expect(page.locator('#doneText')).toContainText('This document is signed');
  expect(writes).toEqual([{signer_name:'Sample Client',agreed:true,field_values:{}}]);
  await expect(page.locator('#bar')).toBeHidden();
  await expect(page.locator('#dlBtn')).toBeVisible();
  await page.locator('#dlBtn').click();
  await expect(page.locator('#dlBtn')).toContainText('Download failed');
});
test('signed link errors, waiting, verified refusal and read-only preserve guards', async ({page}) => {
  for(const [answer,status,text] of [
    [{ok:false},410,'expired'],[{ok:false},404,'not valid'],
    [{ok:false,error:'not_your_turn',message:'The advisor must sign first.'},409,'Not your turn yet'],
    [{ok:true,contract:{...contract,verified:false}},200,'does not match'],
    [{ok:true,contract:{...contract,can_sign:false}},200,'read only']
  ]) {
    await page.unrouteAll(); await open(page,answer,status);
    await expect(page.locator('body')).toContainText(text);
    await expect(page.locator('#signPanel')).toBeHidden();
    await expect(page.locator('#bar')).toBeHidden();
  }
  await page.goto('/contract.html');
  await expect(page.locator('#problem')).toContainText('incomplete');
});
test('PDF overlay keyboard checkbox, required field gate, signature and initials',async({page})=>{
  const pdf = await PDFDocument.create(); pdf.addPage([612,792]);
  const bytes=Buffer.from(await pdf.save()).toString('base64');
  const fields=[{id:'address',type:'text',label:'Address',required:true,x:.1,y:.2,w:.6,h:.05,page:0},{id:'confirm',type:'checkbox',label:'Confirm details',required:true,x:.1,y:.3,w:.05,h:.05,page:0},{id:'sig',type:'signature',label:'Signature',required:true,x:.1,y:.5,w:.5,h:.05,page:0},{id:'initials',type:'initials',label:'Initials',required:true,x:.1,y:.6,w:.2,h:.05,page:0}];
  await page.route('**/api/contracts/sign?**',route=>route.fulfill({json:new URL(route.request().url()).searchParams.has('file')?{ok:true,pdf_base64:bytes}:{ok:true,contract:{...contract,source_kind:'pdf',fields}}}));
  await page.goto(url);
  await expect(page.locator('.pagewrap canvas')).toBeVisible();
  await page.getByLabel('Address (required)').fill('123 Test Street');
  await page.getByRole('checkbox',{name:'Confirm details (required)'}).focus(); await page.keyboard.press('Space');
  await expect(page.getByRole('checkbox',{name:'Confirm details (required)'})).toHaveAttribute('aria-checked','true');
  await page.locator('#name').fill('Sample Client'); await page.locator('#agree').check();
  await expect(page.locator('#go')).toBeEnabled();
  await expect(page.locator('[data-fid="sig"]')).toContainText('Sample Client');
  await expect(page.locator('[data-fid="initials"]')).toContainText('SC');
});
test('loading, empty-link and error layouts remain usable at all review widths',async({page})=>{
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/contracts/sign?**',async route=>{await pending; await route.fulfill({status:410,json:{ok:false}});});
  await page.goto(url);
  fs.mkdirSync(evidence,{recursive:true});
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    await expect(page.locator('#documentLoading')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`${evidence}/page_contract-loading-${width}.png`,fullPage:true});
  }
  release();
  await expect(page.locator('#problemText')).toContainText('expired');
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`${evidence}/page_contract-error-${width}.png`,fullPage:true});
  }
  await page.goto('/contract.html');
  await expect(page.locator('#problemText')).toContainText('incomplete');
  await expect(page.locator('#documentLoading')).toBeHidden();
  for(const width of [1440,390,320]) {
    await page.setViewportSize({width,height:900});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
    await page.screenshot({path:`${evidence}/page_contract-empty-${width}.png`,fullPage:true});
  }
});

test('print keeps document and hides consent/action chrome; touch sign uses existing endpoint', async({browser})=>{
  const context=await browser.newContext({hasTouch:true});
  const page=await context.newPage();
  const writes=await open(page);
  await page.emulateMedia({media:'print'});
  await expect(page.locator('#body')).toBeVisible();
  await expect(page.locator('#signPanel')).toBeHidden();
  await expect(page.locator('#bar')).toBeHidden();
  await page.screenshot({path:`${evidence}/page_contract-print.png`,fullPage:true});
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:390,height:844});
  await page.locator('#name').fill('Sample Client');
  await page.locator('#agree').check();
  await page.locator('#barGo').tap();
  await expect(page.locator('#donePanel')).toBeVisible();
  expect(writes).toHaveLength(1);
  await context.close();
});
