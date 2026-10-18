// Recovery of the Contracts page fixture checks. No API request reaches a backend.
import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { openScreen, OWNER, CLOSER, json } from './harness.mjs';
const OUT='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/contracts';
const TEXT={id:'9e000000-0000-4000-8000-000000000001',template_key:'FUNDING-AGREEMENT',name:'Funding Agreement',kind:'contract',subtype:'funding_agreement',body:'Hello {{contact.first_name}}. Your funding agreement fee is {{field.fee}}.',manual_fields:[{key:'fee',label:'Service fee',required:true}],signature_statement:'I have read this document and I agree to it. Typing my name here is my signature.',active:true,source_kind:'text'};
const PDF={id:'9e000000-0000-4000-8000-000000000002',template_key:'LENDER-APPLICATION',name:'Lender application',kind:'contract',active:true,source_kind:'pdf',page_count:1,original_filename:'lender-application.pdf',fields:[],signer_roles:[]};
const ITEMS=[TEXT,PDF,...Array.from({length:25},(_,i)=>({...TEXT,id:'template-'+(i+3),template_key:'AGREEMENT-'+(i+3),name:i===1?'Business funding service agreement for multiple business entities and authorized representatives':'Client service agreement '+(i+3),active:i%4!==0}))];
let pdfBase64;
test.beforeAll(async()=>{const d=await PDFDocument.create();d.addPage([612,792]);pdfBase64=Buffer.from(await d.save()).toString('base64');});
async function setup(page,{items=ITEMS,state='full',session=OWNER,write}={}){
  const writes=[];let release;const hold=new Promise(r=>release=r);let attempts=0;
  await page.route('https://**',r=>r.abort());
  await openScreen(page,'/app/contracts.html',session,{
    '/api/read/contracts':async(route,{url})=>{
      if(url.includes('file=template')) return json(route,{ok:true,pdf_base64:pdfBase64});
      attempts++;
      if(state==='loading') await hold;
      if(state==='error'&&attempts===1) return json(route,{ok:false,error:'unavailable',message:'Template service unavailable.'},503);
      return json(route,{ok:true,count:items.length,items});
    },
    '/api/contracts':async route=>{const b=route.request().postDataJSON();writes.push(b);const out=write?write(b):{ok:true,message:'Saved.',template:{...(b.action==='upload_template'?PDF:TEXT),...b}};return json(route,out,out.ok?200:400);}
  });
  return {writes,release,attempts:()=>attempts};
}
async function geometry(page){
  const m=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth,header:document.getElementById('fh-workspace-header').getBoundingClientRect().right,controls:[...document.querySelectorAll('#contractsContent button,#contractsContent input:not([type=file]),#contractsContent select,#contractsContent textarea')].filter(x=>x.getClientRects().length).map(x=>{const target=x.type==='checkbox'?(x.closest('label')||x):x;return {id:x.id,width:target.getBoundingClientRect().width,height:target.getBoundingClientRect().height,right:target.getBoundingClientRect().right,left:target.getBoundingClientRect().left};})}));
  expect(m.scroll).toBeLessThanOrEqual(m.viewport+1);expect(m.body).toBeLessThanOrEqual(m.viewport+1);expect(m.header).toBeLessThanOrEqual(m.viewport+1);
  for(const c of m.controls){expect(c.right,JSON.stringify(c)).toBeLessThanOrEqual(m.viewport+1);expect(c.left,JSON.stringify(c)).toBeGreaterThanOrEqual(-1);expect(c.height,JSON.stringify(c)).toBeGreaterThanOrEqual(35);}
}
async function capture(page,selector,caption,name){
  await page.evaluate(({selector,caption})=>{const el=document.querySelector(selector);el.dataset.oldOutline=el.style.outline;el.style.outline='2px solid #ca3232';el.style.outlineOffset='2px';const c=document.createElement('div');c.id='contracts-evidence-caption';c.textContent=caption;c.style.cssText='position:fixed;bottom:10px;left:10px;right:10px;z-index:2147483647;padding:10px 12px;border:2px solid #ca3232;background:#fff;color:#981e1e;font:600 12px/1.5 system-ui;pointer-events:none';document.body.appendChild(c);},{selector,caption});
  await page.screenshot({path:OUT+'/'+name+'.png',fullPage:true});
  await page.evaluate(selector=>{const el=document.querySelector(selector);el.style.outline=el.dataset.oldOutline;el.style.outlineOffset='';document.getElementById('contracts-evidence-caption').remove();},selector);
}
for(const width of [1440,390,320]){
  test('contracts '+width+': full library, keyboard edit and cancel',async({page})=>{
    await page.setViewportSize({width,height:1000});const {writes}=await setup(page);
    await expect(page.locator('#tplList tr[data-tid]')).toHaveCount(27);await expect(page.locator('#libraryCount')).toHaveText('27 templates');await expect(page.locator('#editorEmpty')).toBeVisible();await expect(page.locator('#fh-workspace-header h1')).toHaveText('Contract templates');await expect(page.locator('.content h1')).toHaveCount(0);await expect(page.locator('#liveChip')).toBeHidden();
    await geometry(page);await capture(page,'.template-library','AFTER · '+width+'px — 27 fixture templates, readable names, clear actions and a separate editing workspace.','after-full-'+width);
    await page.locator('tr[data-tid="'+TEXT.id+'"] button').focus();await page.keyboard.press('Enter');await expect(page.locator('#tplEditor')).toBeVisible();await expect(page.locator('#editorEmpty')).toBeHidden();await expect(page.locator('#editorTitle')).toBeFocused();await expect(page.locator('#tKey')).toBeDisabled();await expect(page.locator('#tName')).toHaveValue(TEXT.name);await expect(page.locator('#tStatement')).toHaveValue(TEXT.signature_statement);await geometry(page);await capture(page,'.template-detail','AFTER · '+width+'px — wording, merge fields and signature statement remain editable; sent copies stay unchanged.','after-edit-'+width);
    await page.locator('#btnCancelTpl').click();await expect(page.locator('#editorEmpty')).toBeVisible();expect(writes).toEqual([]);await page.locator('#btnNewTpl').click();await expect(page.locator('#tKey')).toBeFocused();await expect(page.locator('#tKey')).toBeEnabled();await expect(page.locator('#tBody')).toHaveValue('');await geometry(page);
  });
  test('contracts '+width+': empty library remains honest and usable',async({page})=>{
    await page.setViewportSize({width,height:1000});const {writes}=await setup(page,{items:[]});await expect(page.locator('#tplList')).toContainText('No templates yet');await expect(page.locator('#libraryCount')).toHaveText('0 templates');await expect(page.locator('#tplList tr[data-tid]')).toHaveCount(0);await geometry(page);await capture(page,'.template-library','AFTER · '+width+'px — a successful empty read offers existing creation actions without sample records.','after-empty-'+width);await page.locator('#btnNewTpl').click();await expect(page.locator('#tplEditor')).toBeVisible();expect(writes).toEqual([]);
  });
  test('contracts '+width+': loading resolves to real rows',async({page})=>{
    await page.setViewportSize({width,height:1000});const ctx=await setup(page,{state:'loading'});await expect(page.locator('#libraryScroll')).toHaveAttribute('aria-busy','true');await expect(page.locator('#tplList')).toContainText('Loading your templates');await geometry(page);await capture(page,'.template-library','AFTER · '+width+'px — loading reserves the library layout without fabricated records or a false zero count.','after-loading-'+width);ctx.release();await expect(page.locator('#tplList tr[data-tid]')).toHaveCount(27);await expect(page.locator('#libraryScroll')).toHaveAttribute('aria-busy','false');
  });
  test('contracts '+width+': failed read and retry',async({page})=>{
    await page.setViewportSize({width,height:1000});const ctx=await setup(page,{state:'error'});await expect(page.locator('#tplList [role=alert]')).toContainText('Templates could not be loaded');await expect(page.locator('#libraryCount')).toHaveText('Library unavailable');await expect(page.locator('#tplList tr[data-tid]')).toHaveCount(0);await geometry(page);await capture(page,'.template-library','AFTER · '+width+'px — a failed read stays distinct from empty and provides a working retry.','after-error-'+width);await page.locator('#btnNewTpl').click();await expect(page.locator('#tplList [role=alert]')).toContainText('Templates could not be loaded');await page.locator('#btnRetryTemplates').click();await expect(page.locator('#tplList tr[data-tid]')).toHaveCount(27);expect(ctx.attempts()).toBe(2);
  });
  test('contracts '+width+': PDF fits, keyboard box editing keeps fractions',async({page})=>{
    await page.setViewportSize({width,height:1000});const {writes}=await setup(page,{items:[TEXT,PDF]});await page.locator('tr[data-tid="'+PDF.id+'"] button').click();const pg=page.locator('#pdfPages .pg');await expect(pg.locator('canvas')).toBeVisible();await geometry(page);expect(await pg.evaluate(el=>el.getBoundingClientRect().width<=el.parentElement.clientWidth)).toBe(true);
    await pg.focus();await page.keyboard.press('Enter');await expect(pg.locator('.box')).toHaveCount(1);await expect(pg.locator('.box')).toBeFocused();await page.keyboard.press('ArrowRight');await page.keyboard.press('Shift+ArrowDown');await page.locator('#bpType').selectOption('signature');await expect(page.locator('#bpSource')).toHaveValue('manual');await page.locator('#bpSource').selectOption('contact.full_name');await expect(page.locator('#bpType')).toHaveValue('text');await page.locator('#bpType').selectOption('signature');await expect(page.locator('#bpSource')).toHaveValue('manual');await page.locator('#btnSaveFields').click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'save_fields',id:PDF.id,signer_roles:[{index:0,label:'Client',fill_from_client:true}]});expect(writes[0].fields[0]).toMatchObject({type:'signature',source:'manual',x:0.355,y:0.45,w:0.3,h:0.045});await geometry(page);await capture(page,'.pdfwrap','AFTER · '+width+'px — PDF fits its workspace; keyboard editing saves page fractions with manual signatures.','after-pdf-'+width);
  });
}
test('contracts: a phone tap creates a field without a mouse',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});const page=await context.newPage();const {writes}=await setup(page,{items:[PDF]});await page.locator('tr[data-tid="'+PDF.id+'"] button').tap();const pg=page.locator('#pdfPages .pg');await expect(pg.locator('canvas')).toBeVisible();await pg.tap({position:{x:60,y:80}});await expect(pg.locator('.box')).toHaveCount(1);await page.locator('#bpLabel').fill('Full legal name');await page.locator('#btnSaveFields').tap();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].fields[0].label).toBe('Full legal name');await context.close();
});
test('contracts: upload accepts a real PDF and preserves exact upload payload',async({page})=>{
  const {writes}=await setup(page,{items:[PDF]});page.once('dialog',d=>d.accept('LENDER-APPLICATION'));await page.locator('#fileInput').setInputFiles({name:'lender-application.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBase64,'base64')});await expect.poll(()=>writes.length).toBe(1);expect(writes[0]).toMatchObject({action:'upload_template',template_key:'LENDER-APPLICATION',name:'lender-application',filename:'lender-application.pdf'});expect(writes[0].file).toBe('data:application/pdf;base64,'+pdfBase64);await expect(page.locator('#pdfEditor')).toBeVisible();
});
test('contracts: refused upload is visible while no text editor is open',async({page})=>{
  await setup(page,{write:()=>({ok:false,error:'invalid_pdf',message:'That PDF could not be read.'})});page.once('dialog',d=>d.accept('LENDER-APPLICATION'));await page.locator('#fileInput').setInputFiles({name:'lender-application.pdf',mimeType:'application/pdf',buffer:Buffer.from(pdfBase64,'base64')});await expect(page.locator('#tplMsg')).toBeVisible();await expect(page.locator('#tplMsg')).toContainText('That PDF could not be read.');await expect(page.locator('#tplMsg .badge')).toHaveText('problem');
});
test('contracts: closer access redirects before exposing authoring',async({page})=>{await setup(page,{session:CLOSER});await expect(page).not.toHaveURL(/contracts\.html/);await expect(page.locator('#tplCard')).toHaveCount(0);});
test('contracts: administrator retains template authoring access',async({page})=>{await setup(page,{session:{...OWNER,staff:{...OWNER.staff,role:'admin'}}});await expect(page.locator('#tplCard')).toBeVisible();await page.locator('#btnNewTpl').click();await expect(page.locator('#tKey')).toBeFocused();});
test('contracts: mouse moves and resizes an existing box before explicit save',async({page})=>{
  await page.setViewportSize({width:1440,height:1000});const box={id:'f1',page:0,x:0.2,y:0.2,w:0.25,h:0.05,type:'text',signer:0,source:'manual',label:'Name',required:true};const {writes}=await setup(page,{items:[{...PDF,fields:[box]}]});await page.locator('tr[data-tid="'+PDF.id+'"] button').click();const pg=page.locator('#pdfPages .pg');const field=pg.locator('.box');await expect(field).toBeVisible();await field.scrollIntoViewIfNeeded();let r=await field.boundingBox();await page.mouse.move(r.x+5,r.y+5);await page.mouse.down();await page.mouse.move(r.x+25,r.y+15,{steps:4});await page.mouse.up();r=await field.locator('.h').boundingBox();await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x+r.width/2+20,r.y+r.height/2+8,{steps:4});await page.mouse.up();expect(writes).toEqual([]);await page.locator('#btnSaveFields').click();await expect.poll(()=>writes.length).toBe(1);expect(writes[0].fields[0].x).toBeGreaterThan(box.x);expect(writes[0].fields[0].y).toBeGreaterThan(box.y);expect(writes[0].fields[0].w).toBeGreaterThan(box.w);expect(writes[0].fields[0].h).toBeGreaterThan(box.h);
});
