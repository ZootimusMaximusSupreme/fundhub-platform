import { test, expect } from '@playwright/test';
import { openScreen, json } from './harness.mjs';
import fs from 'node:fs';
const client={ok:true,principal:"client",staff:{id:'safe-client',role:'client',kind:'client',name:'Client Preview',affiliate_id:'safe-affiliate',org_id:'org-1'}};
const full={ok:true,enrolled:true,affiliate:{id:"safe-affiliate",name:'Client Preview',code:'SAFE-PREVIEW',offerLinks:[{name:'Funding',url:'https://example.test/start?ref=SAFE-PREVIEW'}]},rates:{direct:{rules:[{}],percent:20}},gates:{license:{signed:true},tax:{onFile:true}},referrals:[{attributedAt:'2026-10-17',name:'Preview Business',status:'converted',product:'Consulting',basisAmount:3000,commissionDue:null}],payouts:[]};
const evidence='ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
for(const width of [1440,390,320])test(`affiliate client full state at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:1000});
 await openScreen(page,'/app/affiliate.html',client,{'/api/read/affiliate-portal':full});
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 await expect(page.locator('.client-ios-nav')).toBeVisible();
 await expect(page.locator('#side')).toBeHidden();
 await expect(page.locator('#affiliateLoadStatus')).toContainText('up to date');
 await expect(page.locator('#leadBody')).toContainText('Preview Business');
 await expect(page.locator('#leadBody tr td').nth(5)).toHaveText('—');
 await expect(page.locator('#affCode')).toHaveText('SAFE-PREVIEW');
 await page.locator('#switch-leads').focus();await page.keyboard.press('ArrowRight');
 await expect(page.locator('#switch-payouts')).toHaveAttribute('aria-selected','true');
 await page.locator('#switch-terms').click();await expect(page.locator('#tab-terms')).toBeVisible();
 await page.locator('#switch-leads').click();await page.locator('#q').fill('does not exist');await expect(page.locator('#leadBody')).toContainText('No referrals match');await page.locator('#q').fill('');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#q').blur();await page.evaluate(()=>scrollTo(0,0));
 fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:`${evidence}/page_affiliate-${width}.png`,fullPage:true});await page.screenshot({path:`${evidence}/page_affiliate-${width}-fold.png`});
 await page.evaluate(()=>{const box=document.querySelector('.linkbox');box.style.outline='2px solid #c92929';const caption=document.createElement('div');caption.id='review-mark';caption.textContent='Review: offer-specific link, clear copy action and account terms';Object.assign(caption.style,{position:'fixed',bottom:'90px',left:'16px',right:'16px',background:'#fff',border:'2px solid #c92929',padding:'10px',font:'12px sans-serif',zIndex:'99999'});document.body.append(caption);});
 await page.screenshot({path:`${evidence}/page_affiliate-${width}-review.png`});
});
test('affiliate loading, failed read, retry and unenrolled state stay honest',async({page})=>{
 let release; const wait=new Promise(r=>release=r);
 await openScreen(page,'/app/affiliate.html',client,{'/api/read/affiliate-portal':async route=>{await wait;await json(route,{ok:false},503);}});
 await expect(page.locator('#affiliateLoadStatus')).toContainText('Loading');release();
 await expect(page.locator('#affiliateLoadStatus')).toContainText('could not load');
 await expect(page.locator('#affiliateRetry')).toBeVisible();
 await page.route('**/api/read/affiliate-portal',route=>json(route,{ok:true,enrolled:false}));
 await page.locator('#affiliateRetry').click();await expect(page.locator('#affiliateLoadStatus')).toContainText('not enrolled');
 await expect(page.locator('#leadBody')).toContainText('No referrals on file');
});
test('affiliate controls preserve gated downloads, approved answers and referral links',async({page})=>{
 await openScreen(page,'/app/affiliate.html',client,{
 '/api/read/affiliate-portal':full,
 '/api/read/company-brain-affiliate':{ok:true,answer:{text:'Approved partner answer'},sources:[{n:1,fileName:'Partner guide',webViewLink:'https://example.test/guide'}]},
 '/api/gifts/message-blaster':route=>json(route,{ok:false,error:'not_eligible'},403)
 });
 await expect(page.locator('#offerLinks input')).toHaveValue('https://example.test/start?ref=SAFE-PREVIEW');
 await page.locator('#copyCode').click();await page.locator('#offerLinks button').click();
 await page.locator('#brainQ').fill('What are the partner terms?');await page.locator('#brainBtn').click();
 await expect(page.locator('#brainAnswer')).toHaveText('Approved partner answer');await expect(page.locator('#brainSources a')).toHaveAttribute('href','https://example.test/guide');
 await page.locator('#blasterBtn').click();await expect(page.locator('#blasterStatus')).toContainText('not_eligible');await expect(page.locator('#blasterBtn')).toBeEnabled();
 await page.locator('#stFilter').selectOption('Converted');await expect(page.locator('#leadBody')).toContainText('Preview Business');
 await page.locator('#stFilter').selectOption('Paid');await expect(page.locator('#leadBody')).toContainText('No referrals match');
});

test('late empty staff rollup cannot erase own affiliate code',async({page})=>{
 let release;const hold=new Promise(r=>release=r);
 await openScreen(page,'/app/affiliate.html',client,{
 '/api/read/affiliate-portal':full,
 '/api/read/affiliates':async route=>{await hold;await json(route,{ok:true,items:[]});}
 });
 await expect(page.locator('#affCode')).toHaveText('SAFE-PREVIEW');
 release();
 await page.waitForResponse(response=>response.url().includes('/api/read/affiliates'));
 await expect(page.locator('#affCode')).toHaveText('SAFE-PREVIEW');
 await expect(page.locator('#affiliateLoadStatus')).toContainText('up to date');
});

for(const width of [1440,390,320])for(const state of ['empty','loading','error','unjoined'])test(`affiliate ${state} readable at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:900});
 let release;const hold=new Promise(r=>release=r);
 const data=state==='unjoined'?{ok:true,enrolled:false}:{...full,referrals:[],payouts:[]};
 await openScreen(page,'/app/affiliate.html',client,{'/api/read/affiliate-portal':async route=>{
 if(state==='loading')await hold;
 await json(route,state==='error'?{...full,ok:true}:data,state==='error'?503:200);
 }});
 await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
 if(state==='loading')await expect(page.locator('#affiliateLoadStatus')).toContainText('Loading');
 if(state==='error'){await expect(page.locator('#affiliateLoadStatus')).toContainText('could not load');await expect(page.locator('#affCode')).toHaveText('No code yet');}
 if(state==='empty')await expect(page.locator('#leadBody')).toContainText('No referrals on file');
 if(state==='unjoined'){await expect(page.locator('#affiliateLoadStatus')).toContainText('not enrolled');await expect(page.getByRole('link',{name:'Affiliate Dashboard',exact:true})).toBeHidden();}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:`${evidence}/page_affiliate-${state}-${width}.png`,fullPage:true});release();
});
test('own payout history, hold gates and clipboard keyboard feedback remain usable',async({page})=>{
 await page.addInitScript(()=>{window.safeCopied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.safeCopied.push(value);}}});});
 const data={...full,payouts:[{paidAt:'2026-10-16',periodStart:'2026-10-01',periodEnd:'2026-10-15',lineCount:2,method:'ACH',amount:'240.50',status:'held',holdReason:'License pending'}],gates:{license:{signed:false,documentRef:'Partner license'},tax:{onFile:false}}};
 await openScreen(page,'/app/affiliate.html',client,{'/api/read/affiliate-portal':data});
 await expect(page.locator('#licenseBanner')).toBeVisible();await expect(page.locator('#taxBanner')).toBeVisible();
 await page.locator('#offerLinks button').focus();await page.keyboard.press('Enter');await expect(page.locator('#offerLinks button')).toHaveText('Copied ✓');
 await page.locator('#copyCode').focus();await page.keyboard.press('Enter');await expect(page.locator('#copyCode')).toHaveText('Copied ✓');
 expect(await page.evaluate(()=>window.safeCopied)).toEqual(['https://example.test/start?ref=SAFE-PREVIEW','SAFE-PREVIEW']);
 await page.locator('#switch-payouts').click();await expect(page.locator('#payBody')).toContainText('$240.50');await expect(page.locator('#payBody')).toContainText('Held');await expect(page.locator('#payBody')).toContainText('License pending');
 await expect(page.getByRole('region',{name:'Payout details, scroll horizontally for all columns'})).toHaveAttribute('tabindex','0');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
 await page.locator('#copyCode').click();await expect(page.locator('#affiliateLoadStatus')).toContainText('Copy was blocked');await expect(page.locator('#copyCode')).not.toHaveText('Copied ✓');
});
for(const role of ['owner','affiliate','partner'])test(`affiliate preserves ${role} principal frame`,async({page})=>{
 const session={ok:true,principal:role==='owner'?'staff':role,staff:{id:'safe-'+role,role,name:'Safe '+role,affiliate_id:'safe-affiliate',org_id:'org-1'}};
 await openScreen(page,'/app/affiliate.html',session,{'/api/read/affiliate-portal':full});
 await expect(page.locator('body')).not.toHaveAttribute('data-client-ios','');await expect(page.locator('.client-ios-nav')).toHaveCount(0);await expect(page.locator('#side')).toBeVisible();
 if(role==='partner'){await expect(page).toHaveURL(/partner-galaxy\.html$/);await expect(page.locator('#affCode')).toHaveCount(0);}else await expect(page.locator('#affCode')).toHaveText('SAFE-PREVIEW');
});
