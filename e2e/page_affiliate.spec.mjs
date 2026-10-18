import { test, expect } from '@playwright/test';
import { openScreen, json } from './harness.mjs';
import fs from 'node:fs';
const client={ok:true,principal:"client",staff:{id:'safe-client',role:'client',kind:'client',name:'Client Preview',affiliate_id:'safe-affiliate',org_id:'org-1'}};
const full={ok:true,enrolled:true,affiliate:{id:"safe-affiliate",name:'Client Preview',code:'SAFE-PREVIEW',offerLinks:[{name:'Funding',url:'https://example.test/start?ref=SAFE-PREVIEW'}]},rates:{direct:{rules:[{}],percent:20}},gates:{license:{signed:true},tax:{onFile:true}},referrals:[{attributedAt:'2026-10-17',name:'Preview Business',status:'converted',product:'Consulting',basisAmount:3000,commissionDue:null}],payouts:[]};
const evidence='ops/workflows/build-evidence/client-portal-ios-redo';
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
