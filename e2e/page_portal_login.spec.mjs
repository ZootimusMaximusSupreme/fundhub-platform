import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const evidence = 'ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18';
const reply = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
for (const width of [1440, 390, 320]) {
  test(`page_portal_login ${width}: empty, loading, error, sent, keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    let finish;
    const requests = [];
    await page.route('**/api/auth/magic-link', route => {
      requests.push(route.request().postDataJSON());
      return new Promise(resolve => { finish = async body => { await reply(route, body); resolve(); }; });
    });
    await page.goto('/portal-login.html');
    await expect(page.locator('body')).toHaveAttribute('data-client-ios', /.*/);
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('#ok-box')).toBeHidden();
    await expect(page.locator('#busy')).toBeHidden();
    const password = page.getByRole('link', { name: 'Sign in with password' });
    await expect(password).toHaveAttribute('href', '/login.html?next=%2Fapp%2Fclient-portal.html');
    await expect(password).toBeVisible();
    expect((await password.boundingBox()).y + (await password.boundingBox()).height).toBeLessThan(844);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-empty.png`, fullPage: true });
    await password.evaluate(el => { el.style.outline = '2px solid #c42332'; el.style.outlineOffset = '4px'; });
    await page.evaluate(() => { const caption = document.createElement('div'); caption.id = 'review-caption'; caption.textContent = 'Review: password sign-in restored'; caption.style.cssText = 'position:fixed;bottom:12px;left:12px;background:#fff;color:#a31624;border:1px solid #c42332;padding:8px;font:12px sans-serif;z-index:9999'; document.body.append(caption); });
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-marked.png`, fullPage: true });
    await password.evaluate(el => { el.style.outline = ''; el.style.outlineOffset = ''; });
    await page.evaluate(() => document.getElementById('review-caption').remove());
    await page.getByLabel('Email address').fill('safe-fixture@example.test');
    await page.locator('#email').press('Tab');
    await expect(page.locator('#go')).toBeFocused();
    await page.locator('#go').press('Enter');
    await expect(page.locator('#go')).toHaveText('Sending…');
    await expect(page.locator('#go')).toBeDisabled();
    await expect.poll(() => requests.length).toBe(1);
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-loading.png`, fullPage: true });
    await finish({ ok: false, message: 'Please try again.' });
    await expect(page.getByRole('alert')).toHaveText('Please try again.');
    await expect(page.locator('#go')).toBeEnabled();
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-error.png`, fullPage: true });
    await page.locator('#go').click();
    await expect.poll(() => requests.length).toBe(2);
    await finish({ ok: true });
    await expect(page.locator('#ok-box')).toContainText('If that email address has a Fundhub portal');
    await expect(page.locator('#f')).toBeHidden();
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-sent.png`, fullPage: true });
    expect(requests).toEqual([{ email: 'safe-fixture@example.test' }, { email: 'safe-fixture@example.test' }]);
  });
}
test('page_portal_login token stripped before verify; failed exchange stays private', async ({ page }) => {
  let addressDuringVerify;
  await page.route('**/api/auth/magic-link-verify', async route => {
    addressDuringVerify = page.url();
    expect(route.request().postDataJSON()).toEqual({ token: 'safe-fixture-token' });
    await reply(route, { ok: false, message: 'This link has expired.' });
  });
  await page.goto('/portal-login.html?t=safe-fixture-token');
  await expect(page.getByRole('alert')).toHaveText('This link has expired.');
  expect(addressDuringVerify).not.toContain('safe-fixture-token');
  await expect(page.locator('#email')).toHaveValue('');
  await expect(page.locator('#f')).toBeVisible();
});
test('page_portal_login verified account replaces stale identity and clears offline demo', async ({ page }) => {
  await page.goto('/portal-login.html');
  await page.evaluate(() => {
    localStorage.setItem('fh_account', JSON.stringify({ clientId: 'someone-else' }));
    localStorage.setItem('fh_role', 'owner');
    localStorage.setItem('fh_demo', '1');
    localStorage.setItem('fh_demo_staff', '1');
  });
  await page.route('**/api/auth/magic-link-verify', route => reply(route, {
    ok: true, token: 'fixture-session', account: { clientId: 'own-fixture', kind: 'client' }, next: '/portal-login.html?fixture=done'
  }));
  await page.goto('/portal-login.html?t=safe-fixture-token');
  await page.waitForURL('**/portal-login.html?fixture=done');
  expect(await page.evaluate(() => ({ token: localStorage.getItem('fh_token'), account: JSON.parse(localStorage.getItem('fh_account')), role: localStorage.getItem('fh_role'), demo: localStorage.getItem('fh_demo'), staff: localStorage.getItem('fh_demo_staff') }))).toEqual({ token: 'fixture-session', account: { clientId: 'own-fixture', kind: 'client' }, role: 'client', demo: null, staff: null });
});
