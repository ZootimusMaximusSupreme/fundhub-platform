import {test,expect} from '@playwright/test';
import bundle from '../src/demo/client-portal-sample-bundle.json' with {type:'json'};
import fs from 'node:fs';
const pages=['client-portal','financeos','money','money-accounts','money-alerts','money-banks','money-connections','money-credit','money-declines','money-fundability','money-helper','money-next','money-payments','money-plan','money-setup','money-strategy','money-transfers','money-vault'];
for(const width of [1440,390,320])test(`isolated canonical samples render across client data pages at ${width}`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.addInitScript(()=>{localStorage.setItem('fh_token','safe-sample-token');localStorage.setItem('fh_role','client');});
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data=path==='/api/auth/session'?{ok:true,principal:'client',portal_sample_available:true,portal_sample:true,staff:{id:'safe-account',client_id:'safe-client',role:'client',name:'Portal Sample',email:'client@fundhub.ai',status:'active'}}:
      path==='/api/read/affiliate-portal'?{ok:true,enrolled:false,referrals:[]}:
      bundle.reads[path]?{...bundle.reads[path],portal_sample:true,sample_notice:bundle.notice}:{ok:true,items:[]};
    return route.fulfill({json:data});
  });
  for(const name of pages){
    await page.goto('/app/'+name+'.html');
    await expect(page.locator('.client-ios-sample')).toContainText('Sample view');
    await expect(page.getByRole('button',{name:'View real account'})).toBeVisible();
    await page.waitForTimeout(80);
    if(name==='client-portal'&&width!==320){fs.mkdirSync('ops/workflows/build-evidence/client-portal-ios-redo',{recursive:true});await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/sample-home-${width}.png`,fullPage:true});}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow').toBe(true);
  }
  await page.goto('/progress.html');await expect(page.locator('.client-ios-sample')).toContainText('Sample view');
});
test('sample view switch preserves original account access and persists navigation',async({page})=>{
  await page.route('**/api/**',route=>{const path=new URL(route.request().url()).pathname;const real=(route.request().headers().cookie||'').includes('fh_portal_data=real');return route.fulfill({json:path==='/api/auth/session'?{ok:true,principal:'client',portal_sample_available:true,portal_sample:!real,staff:{role:'client'}}:path==='/api/read/affiliate-portal'?{ok:true,enrolled:false}:bundle.reads[path]||{ok:true,items:[]}});});
  await page.goto('/app/money-payments.html');await page.getByRole('button',{name:'View real account'}).click();await expect(page.locator('.client-ios-sample')).toContainText('Your real account');await page.goto('/app/money-credit.html');await expect(page.getByRole('button',{name:'View samples'})).toBeVisible();
});
