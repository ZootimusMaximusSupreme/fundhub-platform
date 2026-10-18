import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const sample = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-overview.sandbox.json', import.meta.url)));
for (const width of [1440,390,320]) {
  test(`Money client overview preserves states and safe controls at ${width}`, async ({page}) => {
    await page.setViewportSize({width,height:900});
    let state='full', role='client', links=0;
    let release;
    const held=new Promise(r=>{release=r;});
    await page.route('**/api/**',async route=>{
      const path=new URL(route.request().url()).pathname;
      const json=(data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(data)});
      if(path==='/api/auth/session')return json({ok:true,principal:role});
      if(path==='/api/read/affiliate-portal')return json({ok:true,enrolled:false});
      if(path==='/api/banking/link-token'){links++;return json({ok:false,error:'not_configured'},503);}
      if(path==='/api/money/overview'){
        if(state==='loading')await held;
        if(state==='error')return json({ok:false,error:'unavailable'},503);
        return json(state==='empty'?{...sample,accounts:[],containers:[]}:sample);
      }
      return json({ok:false},404);
    });
    await page.goto('/app/money.html');
    await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
    await expect(page.locator('#money-root')).toContainText('Personal Checking');
    await expect(page.locator('.mnav a')).toHaveCount(6);
    await expect(page.locator('.client-ios-links a[aria-current=page]')).toContainText('FinanceOS');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_money-${width}.png`,fullPage:true});
    const connect=page.getByRole('button',{name:'Connect a bank'});
    await connect.focus();await page.keyboard.press('Enter');
    await expect(page.locator('.act-msg')).toContainText('not set up yet');
    expect(links).toBe(1);
    for(const next of ['empty','error','loading']){
      state=next;await page.goto('/app/money.html');
      if(next==='empty')await expect(page.locator('.empty')).toBeVisible();
      if(next==='error'){
        await expect(page.locator('.error')).toBeVisible();
        state='full';await page.getByRole('button',{name:'Try again'}).click();
        await expect(page.locator('#money-root')).toContainText('Personal Checking');
      }
      if(next==='loading'){await expect(page.locator('[aria-busy=true]')).toBeVisible();release();}
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    }
    role='staff';state='full';
    await page.goto('/app/money.html?client_id=safe-ui-fixture');
    await expect(page.locator('#money-root')).toContainText('Personal Checking');
    await expect(page.locator('body')).not.toHaveAttribute('data-client-ios');
    await expect(page.locator('#money-back')).toHaveAttribute('href','finance-os.html?client_id=safe-ui-fixture');
    await expect(page.locator('.mnav a').first()).toHaveAttribute('href','/app/financeos.html?client_id=safe-ui-fixture#overview');
  });
}
