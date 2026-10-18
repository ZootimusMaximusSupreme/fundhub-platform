import { test, expect } from '@playwright/test';
const ID='aaaaaaaa-1111-4111-8111-111111111111';
async function mock(page, server, token='client-session') {
  await page.addInitScript(t=>{if(!sessionStorage.getItem('safe-ui-session-seeded')){localStorage.setItem('fh_token',t);localStorage.setItem('fh_role','client');sessionStorage.setItem('safe-ui-session-seeded','1');}},token);
  await page.route('**/api/**', async route=>{
    const p=new URL(route.request().url()).pathname;
    const reply=(b,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(b)});
    if(p==='/api/auth/session')return reply({ok:true,principal:'client',had_call:true,staff:{id:'account',client_id:ID,role:'client',name:'Safe Test Client',affiliate_id:server.joined?'own-affiliate':null}});
    if(p==='/api/affiliates/refer'){
      server.posts++;
      if(server.fail)return reply({ok:true,shareUrl:'https://example.test/ref/own'},500);
      server.joined=true;return reply({ok:true,enrolled:true,code:'OWN',shareUrl:'https://example.test/ref/own'},201);
    }
    if(p==='/api/read/affiliate-portal')return reply({ok:true,enrolled:server.joined,affiliate:server.joined?{id:'own-affiliate',name:'Safe Test Client',code:'OWN',shareUrl:'https://example.test/ref/own',offerLinks:[]}:null,rates:{},referrals:[],payouts:[],gates:null});
    if(p==='/api/read/portal-summary')return reply({ok:true,scores:{},documents:[]});
    if(p==='/api/auth/logout'){server.logouts++;return reply({ok:!server.logoutFail},server.logoutFail?503:200);}
    return reply({ok:true,items:[],db:'up'});
  });
}
test('client referral reveals own dashboard after refresh and a new browser session',async({page,browser})=>{
  const server={joined:false,posts:0};await mock(page,server);
  await page.setViewportSize({width:390,height:844});
  await page.goto('/app/client-portal.html?id='+ID);
  const nav=page.locator('.client-ios-nav');
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link',{name:'Affiliate Dashboard'})).toBeHidden();
  await page.locator('#ref-go').click();
  await expect(nav.getByRole('link',{name:'Affiliate Dashboard'})).toBeVisible();
  expect(server.posts).toBe(1);
  await page.reload();
  await expect(nav.getByRole('link',{name:'Affiliate Dashboard'})).toBeVisible();
  const fab=page.locator('#fh-chat-fab');
  await expect(fab).toBeVisible();
  const box=await fab.boundingBox(), navBox=await nav.boundingBox();
  expect(box.y+box.height).toBeLessThan(navBox.y);
  await expect(page.locator('#fh-shell-chip')).toBeHidden();
  const fresh=await browser.newContext();const next=await fresh.newPage();await mock(next,server,'fresh-client-session');
  await next.goto('/app/client-portal.html?id='+ID);
  await next.locator('.client-ios-nav').getByRole('link',{name:'Affiliate Dashboard'}).click();
  await expect(next).toHaveURL(/affiliate\.html$/);
  await expect(next.locator('#affCode')).toHaveText('OWN');
  expect(server.posts).toBe(1);await fresh.close();
});
test('HTTP refusal cannot reveal the affiliate navigation or claim success',async({page})=>{
  const server={joined:false,posts:0,fail:true};await mock(page,server);
  await page.goto('/app/client-portal.html?id='+ID);await page.locator('#ref-go').click();
  await expect(page.locator('#ref-err')).toBeVisible();
  await expect(page.locator('.client-ios-nav').getByRole('link',{name:'Affiliate Dashboard'})).toBeHidden();
  await page.reload();
  await expect(page.locator('.client-ios-nav').getByRole('link',{name:'Affiliate Dashboard'})).toBeHidden();
  expect(server.posts).toBe(1);
});
test('shared sign out preserves retry on failure and clears account data on success',async({page})=>{
  const server={joined:false,posts:0,logouts:0,logoutFail:true};await mock(page,server);
  await page.goto('/app/money.html');
  await page.locator('.client-ios-signout').click();
  await expect(page.locator('.client-ios-session-error')).toContainText('could not confirm');
  expect(await page.evaluate(()=>localStorage.getItem('fh_token'))).toBe('client-session');
  server.logoutFail=false;await page.locator('.client-ios-signout').click();
  await expect(page).toHaveURL(/portal-login\.html$/);
  expect(await page.evaluate(()=>localStorage.getItem('fh_token'))).toBeNull();
  expect(server.logouts).toBe(2);
});
