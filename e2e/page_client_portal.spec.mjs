import { test, expect } from '@playwright/test';
import { CLIENT_ID, json } from './harness.mjs';
import fs from 'node:fs';
import sampleBundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
const out='ops/workflows/build-evidence/crm-portal-layout-professional';
async function open(page,{state='empty',enrolled=false,postStatus=201,summary,view}={}){
 await page.addInitScript(()=>{localStorage.setItem('fh_token','safe-mock-token');localStorage.setItem('fh_role','client');});
 let joined=enrolled;
 await page.route('**/api/**',async route=>{
 const u=route.request().url();
 if(u.includes('/api/auth/session'))return json(route,{ok:true,principal:'client',staff:{id:CLIENT_ID,client_id:CLIENT_ID,role:'client',name:'Portal Sample',email:'sample@example.test',status:'active'}});
 if(u.includes('/api/affiliates/refer')){if(postStatus<300)joined=true;return json(route,{ok:true,shareUrl:'https://fundhub.ai/start?ref=SAFE'},postStatus);}
 if(u.includes('/api/read/affiliate-portal'))return json(route,{ok:true,enrolled:joined,affiliate:joined?{id:'safe-aff',shareUrl:'https://fundhub.ai/start?ref=SAFE'}:null,referrals:[],rates:{},payouts:[]});
 if(u.includes('/api/read/portal-summary')){
 if(state==='loading') await new Promise(r=>setTimeout(r,1200));
 if(state==='error')return json(route,{ok:false},503);
 if(summary)return json(route,summary);
 return json(route,{ok:true,prequal_amount:null,prequal_display:null,soft_pull_complete:false,scores:state==='full'?{experian:720,equifax:715,transunion:725}: {},documents:state==='full'?[{id:'doc-safe',title:'Sample document',mime_type:'application/pdf',created_at:'2026-10-17T12:00:00Z'}]:[]});}
 return json(route,{ok:true,items:[]});
 });
 await page.goto(`/app/client-portal.html?id=${CLIENT_ID}${view ? "&view="+view+"#acct" : ""}`);
 await expect(page.locator('body')).toHaveAttribute('data-client-ios',/.*/);
 const accountMenu=page.locator('details').filter({has:page.locator('.client-ios-signout')});
 if(await accountMenu.count()) await accountMenu.locator('summary').click();
 await expect(page.locator('.client-ios-signout')).toBeVisible();
 if(await accountMenu.count()) await accountMenu.locator('summary').click();
}
for(const width of [1440,390,320])test(`client home at ${width}px preserves controls and width`,async({page})=>{
 await page.setViewportSize({width,height:1000});await open(page,{state:'full',enrolled:true});
 // Pre-call chat intentionally opens after 1.4s. Prove it can be dismissed
 // before clicking account tabs, especially at 320px where it covers them.
 await expect(page.locator('#fh-chat-panel.open')).toBeVisible();
 await page.locator('#fh-chat-close').click();
 await expect(page.locator('#fh-chat-panel')).toBeHidden();
 await expect(page.locator('#ref-dashboard')).toBeVisible();
 await expect(page.locator('#money-link')).toBeVisible();
 fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/page_client_portal-home-${width}.png`,fullPage:true});
 await expect(page.locator('.prog-card.precall-only #prog-link a')).toBeVisible();
 await expect(page.locator('.cp-progress-disclosure')).not.toHaveAttribute('open','');
 await page.locator('.cp-progress-disclosure summary').click();
 await expect(page.locator('#stepper-pre .step')).toHaveCount(8);
 for(const stage of await page.locator('#stepper-pre .lbl').all()) await expect(stage).toBeVisible();
 await page.locator('.cp-progress-disclosure summary').click();
 await page.locator('#acct').evaluate(e=>{e.open=true});
 await page.getByRole('tab',{name:'Documents',exact:true}).click();
 await expect(page.locator('#tp-docs')).toBeVisible();
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 expect(overflow).toBe(false);
 fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/page_client_portal-${width}.png`,fullPage:true});
});
for(const state of ['loading','empty','error'])test(`client home ${state} remains usable`,async({page})=>{await open(page,{state});await expect(page.locator('#money-link')).toBeVisible();await expect(page.locator('#prog-link a')).toBeVisible();fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/page_client_portal-${state}.png`,fullPage:true});});
test('HTTP refusal with success-shaped body does not expose affiliate dashboard',async({page})=>{await open(page,{postStatus:500});await page.locator('#ref-go').click();await expect(page.locator('#ref-err')).toBeVisible();await expect(page.locator('#ref-dashboard')).toBeHidden();});

test('staff does not inherit client Home heading or client styling',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('fh_token','safe-mock-token');localStorage.setItem('fh_role','owner');});
 await page.route('**/api/**',route=>route.request().url().includes('/api/auth/session')?json(route,{ok:true,principal:'staff',staff:{id:'safe-staff',role:'owner',name:'Safe Staff',status:'active'}}):json(route,{ok:true,items:[]}));
 await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
 await expect(page.locator('.cp-home-heading')).toBeHidden();
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios',/.*/);
});

test('canonical credit-pull summary controls hero current stage rather than legacy booking tick',async({page})=>{
 await open(page,{summary:sampleBundle.reads['/api/read/portal-summary']});
 await expect(page.locator('.cp-current-stage')).toHaveText('Current: Credit pull received');
 await expect(page.locator('#sb-pre-main')).toContainText('soft-pull assessment is in');
 await page.locator('.cp-progress-disclosure summary').click();
 await expect(page.locator('#stepper-pre .step')).toHaveCount(8);
 await expect(page.locator('.cp-current-stage')).not.toContainText('Booked');
});

for(const view of ['documents','agreements'])test(`shared navigation ${view} opens existing account tab`,async({page})=>{
 await open(page,{view});
 await expect(page.locator('#acct')).toHaveAttribute('open','');
 const tab=view==='documents'?'docs':'agree';
 await expect(page.locator(`#acct-tabs [data-tab="${tab}"]`)).toHaveAttribute('aria-selected','true');
 await expect(page.locator(`#tp-${tab}`)).toBeVisible();
});
for(const width of [1440,390,320])test(`professional canonical status and next action ${width}`,async({page})=>{
 const height=width===320?568:844;await page.setViewportSize({width,height});
 await open(page,{summary:sampleBundle.reads['/api/read/portal-summary']});
 await expect(page.locator('.cp-current-stage')).toHaveText('Current: Credit pull received');
 await expect(page.locator('.cp-next-action')).toBeVisible();
 const next=await page.locator('.cp-next-action').boundingBox();expect(next.y+next.height).toBeLessThan(height-(width<760?80:0));
 for(const title of await page.locator('.cp-file-title').all()) await expect(title).toBeHidden();
 await page.locator("main").evaluate(e=>e.scrollTo({top:0,behavior:"instant"}));
 fs.mkdirSync(out,{recursive:true});await page.screenshot({path:`${out}/page_client_portal-canonical-${width}.png`,fullPage:true});
 // The pre-call chat deliberately pops up after 1.4 seconds. A real user
 // must dismiss this dialog before activating the account CTA; Playwright
 // correctly rejects clicks through an open overlay. Exercise the visible
 // Close control rather than force-clicking through it or hiding the widget.
 await expect(page.locator("#fh-chat-panel.open")).toBeVisible();
 await page.locator("#fh-chat-close").click();
 await expect(page.locator("#fh-chat-panel")).toBeHidden();
 await page.locator("#cp-next-link").click();
 await expect(page.locator("#acct")).toHaveAttribute("open","");
});
