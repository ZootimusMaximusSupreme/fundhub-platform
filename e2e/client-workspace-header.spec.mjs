import {test,expect} from '@playwright/test';
import {CLIENT_ID,json} from './harness.mjs';
async function fixture(page){
 await page.addInitScript(()=>{localStorage.setItem('fh_token','safe-client-header');localStorage.setItem('fh_role','client');});
 await page.route('**/api/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/api/auth/session')return json(route,{ok:true,principal:'client',had_call:true,staff:{id:'safe-account',client_id:CLIENT_ID,role:'client',name:'Safe Client',had_call:true}});
  if(path==='/api/read/affiliate-portal')return json(route,{ok:true,enrolled:true,affiliate:{id:'own-affiliate',name:'Safe Client',code:'OWN',shareUrl:'https://example.test/own',offerLinks:[]},rates:{},referrals:[],payouts:[],gates:null});
  if(path==='/api/read/portal-summary')return json(route,{ok:true,scores:{},documents:[]});
  return json(route,{ok:true,items:[],db:'up'});
 });
}
for(const width of [1440,390,320])test(`one client header and accessible account/chat at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:844});await fixture(page);
 for(const target of ['client-portal','money','financeos','money-payments','affiliate']){
  await page.goto('/app/'+target+'.html?id='+CLIENT_ID);
  const header=page.locator('.client-ios-header');await expect(header).toBeVisible();
  const box=await header.boundingBox();expect(box.height).toBe(width>760?64:60);
  const account=header.locator('.client-ios-account');await expect(account).not.toHaveAttribute('open','');
  await account.locator('summary').focus();await page.keyboard.press('Enter');
  await expect(account.locator('.client-ios-signout')).toBeVisible();
  await expect(account.locator('.client-ios-account-name')).toHaveText('Safe Client');
  const panel=await account.locator('.client-ios-account-panel').boundingBox();expect(panel.x).toBeGreaterThanOrEqual(0);expect(panel.x+panel.width).toBeLessThanOrEqual(width);
  await page.keyboard.press('Escape');await expect(account).not.toHaveAttribute('open','');await expect(account.locator('summary')).toBeFocused();
  const chat=page.locator('#fh-chat-fab');await expect(chat).toBeVisible();
  const chatBox=await chat.boundingBox();expect(chatBox.y).toBeGreaterThanOrEqual(box.y);expect(chatBox.y+chatBox.height).toBeLessThanOrEqual(box.y+box.height);
  await chat.click();await expect(page.locator('#fh-chat-panel')).toBeVisible();
  const dialog=await page.locator('#fh-chat-panel').boundingBox();expect(dialog.y).toBeGreaterThanOrEqual(box.y+box.height);expect(dialog.x).toBeGreaterThanOrEqual(0);expect(dialog.x+dialog.width).toBeLessThanOrEqual(width);
  await page.locator('#fh-chat-close').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 }
});
