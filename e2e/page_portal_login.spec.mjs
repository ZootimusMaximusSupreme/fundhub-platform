import { test, expect } from '@playwright/test';
import fs from 'node:fs';
const evidence = 'ops/workflows/build-evidence/client-portal-ios-redo';
const reply = (route, body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
for (const width of [1440, 390, 320]) {
  test(`page_portal_login ${width}: empty, loading, error, sent, keyboard`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/page_portal_login-${width}-empty.png`, fullPage: true });
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
