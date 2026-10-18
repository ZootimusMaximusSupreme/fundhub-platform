import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { withSession, json } from './harness.mjs';
const sample = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-overview.sandbox.json', import.meta.url)));
const tabs = ['overview','next','helper','transfers','plan','banks','strategy','fundability','declines','alerts','vault','accounts','credit','connections','payments','setup'];
for (const width of [1440,390,320]) {
  test(`FinanceOS frame and states at ${width}`, async ({ page }) => {
    await page.setViewportSize({width,height:900});
    await withSession(page, {staff:{role:'client'}});
    let state = 'full';
    let release;
    const loading = new Promise(resolve => { release = resolve; });
    await page.route('**/api/**', async route => {
      if (route.request().url().includes('/api/money/overview')) {
        if (state === 'loading') await loading;
        if (state === 'error') return json(route,{ok:false,error:'unavailable'},503);
        return json(route, state === 'empty' ? {...sample, accounts:[],containers:[]} : sample);
      }
      if (route.request().url().includes('/api/auth/session')) return json(route,{ok:true,principal:'client',client:{id:sample.client.id,name:'Test Client'}});
      return json(route,{ok:true});
    });
    await page.goto('/app/financeos.html#overview');
    await expect(page.locator('body')).toHaveAttribute('data-client-ios','');
    await expect(page.locator('#fos-overview')).toContainText('Personal Checking');
    await expect(page.locator('.fos-tabs [role="tab"]')).toHaveCount(16);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`ops/workflows/build-evidence/client-portal-ios-redo/page_financeos-${width}.png`,fullPage:true});
    for (const key of tabs) {
      await page.locator(`#tab-${key}`).click();
      await expect(page.locator(`#tab-${key}`)).toHaveAttribute('aria-selected','true');
      await expect(page.locator(`#fos-${key}`)).toBeVisible();
    }
    await page.locator('#tab-setup').press('Home');
    await expect(page.locator('#tab-overview')).toHaveAttribute('aria-selected','true');
    await page.locator('#tab-overview').press('End');
    await expect(page.locator('#tab-setup')).toHaveAttribute('aria-selected','true');
    for (const next of ['empty','error','loading']) {
      state = next;
      await page.goto('/app/financeos.html#overview');
      await page.reload();
      if(next === 'empty') await expect(page.locator('#fos-overview .empty')).toBeVisible();
      if(next === 'error') await expect(page.locator('#fos-overview .error')).toBeVisible();
      if(next === 'loading') { await expect(page.locator('#fos-overview .skel').first()).toBeVisible(); release(); }
    }
  });
}
