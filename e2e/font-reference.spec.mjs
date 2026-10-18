import {test,expect} from '@playwright/test';
import fs from 'node:fs';
import {openScreen,OWNER,CLOSER,CLIENT_ID} from './harness.mjs';
const out='ops/workflows/build-evidence/crm-font-live';
const brand={slug:'fundhub',entity_name:'Fundhub',display_face:'Inter',mono_face:'JetBrains Mono',ink:'#0A0A0A',paper:'#FCFCFC',ramp:['#F2A69B','#F0BE94','#E9DDA4','#A8CBA9','#9EC2D5','#B8A5D4']};
const numbers={ok:true,staff_id:'staff-2',shift:{on_shift:false,reason:'No open shift'},pace:{cash_cents:0,cash_display:'$0',target_cents:null,target_reason:'No target recorded',rank:null,team_size:0},month:{deposits_closed:0,close_rate:null,show_rate:null,downsells:0,deposit_to_funded:null,deposit_to_funded_n:{deposits:0,funded:0,rate:null},avg_funded_cents:null,avg_funded_reason:'No funded records',calls_held:0,no_shows:0,unlogged:0,prior:{deposits:0,close_rate:null}},money:{paid_cents:0,pending_cents:0,at_risk_cents:null,at_risk_reason:'Not available',paid_display:'$0',pending_display:'$0'},call_quality:{available:false,reason:'No recorded calls'},compliance:{available:false,reason:'No record'},team:[],owed:[],streak:{available:false,reason:'Not stored'}};
for(const width of [1440,390,320])for(const screen of ['my-numbers','pipeline','client-portal'])test('rounded font '+screen+' at '+width,async({page,context})=>{
 await page.setViewportSize({width,height:900});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 const session=screen==='client-portal'?{ok:true,principal:'client',staff:{id:'safe-client',client_id:CLIENT_ID,role:'client',name:'Safe Client',status:'active',had_call:true}}:screen==='my-numbers'?CLOSER:OWNER;
 await openScreen(page,'/app/'+screen+'.html',session,{'/api/org-brand':{ok:true,brand},'/api/read/my-numbers':numbers,'/api/read/portal-summary':{ok:true,scores:{},documents:[]}});
 await expect(page.locator('html')).toHaveAttribute('data-fh-rounded-default','');
 await page.evaluate(()=>document.fonts.ready);
 const woff=await page.request.get('/assets/fonts/nunito-latin-variable.woff2');expect(woff.status()).toBe(200);
 expect((await woff.body()).byteLength).toBeLessThan(100000);
 const family=await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily);
 expect(family).toContain('Fundhub Rounded');
 await page.evaluate(()=>{
  const probe=document.createElement('div');probe.id='fh-font-reference-probe';
  probe.textContent='Your work,\nin focus.';
  probe.style.cssText='position:fixed;right:24px;top:90px;z-index:2147483645;padding:30px;width:440px;max-width:calc(100vw - 32px);background:#f8f8f6;color:#0c1012;font-size:58px;font-weight:600;line-height:1.16;letter-spacing:-2.5px;white-space:pre-line;border:1px solid #d4d8d4;border-radius:18px;box-sizing:border-box';
  document.body.appendChild(probe);
 });
 await page.locator('#fh-font-reference-probe').boundingBox();
 await page.evaluate(()=>document.fonts.ready);
 const cdp=await context.newCDPSession(page);await cdp.send('DOM.enable');await cdp.send('CSS.enable');
 const dom=await cdp.send('DOM.getDocument');const node=await cdp.send('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#fh-font-reference-probe'});
 let fonts=[];if(node.nodeId)fonts=(await cdp.send('CSS.getPlatformFontsForNode',{nodeId:node.nodeId})).fonts;
 expect(fonts.length).toBeGreaterThan(0);
 expect(fonts.some(f=>/Nunito|SF Pro Rounded|SFProRounded|SFNSRounded/.test(f.familyName))).toBe(true);
 if(width===1440&&screen==='my-numbers'){
  fs.mkdirSync(out,{recursive:true});
  await page.screenshot({path:out+'/rounded-reference-specimen.png',fullPage:false});
 }
 await page.locator('#fh-font-reference-probe').evaluate(e=>e.remove());
 fs.mkdirSync(out,{recursive:true});
 const overflow=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,items:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',rect:e.getBoundingClientRect().toJSON(),scroll:e.scrollWidth,client:e.clientWidth,position:getComputedStyle(e).position})).filter(e=>e.rect.width&&e.position!=='fixed'&&(e.rect.right>innerWidth+1||e.rect.left< -1)).slice(0,40)}));
 fs.writeFileSync(out+'/'+screen+'-'+width+'-overflow.json',JSON.stringify(overflow,null,2));
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 expect(errors).toEqual([]);
 fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(out+'/'+screen+'-'+width+'-fonts.json',JSON.stringify({family,fonts,width},null,2));
 await page.screenshot({path:out+'/'+screen+'-'+width+'-raw.png',fullPage:false});
 await page.evaluate(()=>{
  const h=document.querySelector('h1')||document.querySelector('button');if(!h)return;
  const b=h.getBoundingClientRect();const mark=document.createElement('div');mark.id='type-proof-mark';
  mark.style.cssText='position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #c02424;left:'+Math.max(0,b.x-4)+'px;top:'+Math.max(0,b.y-4)+'px;width:'+(b.width+8)+'px;height:'+(b.height+8)+'px';
  const caption=document.createElement('div');caption.id='type-proof-caption';caption.textContent='TYPE REVIEW · rounded face loaded · fictional test data';
  caption.style.cssText='position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#fff;color:#9f1515;border-top:2px solid #c02424;padding:8px 12px;font:12px system-ui';
  document.body.append(mark,caption);
 });
 await page.screenshot({path:out+'/'+screen+'-'+width+'-review.png',fullPage:false});
});
test('custom and partner brands keep their chosen type',async({page})=>{
 const custom={...brand,slug:'custom',entity_name:'Custom',display_face:'Montserrat'};
 await openScreen(page,'/app/my-numbers.html',CLOSER,{'/api/org-brand':{ok:true,brand:custom},'/api/read/my-numbers':numbers});
 await expect(page.locator('html')).not.toHaveAttribute('data-fh-rounded-default','');
 expect(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--sans'))).toContain('Montserrat');
});
