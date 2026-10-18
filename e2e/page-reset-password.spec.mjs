import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const evidence = 'ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/reset-password';
const password = 'safe-test-password-2026';
const token = 'safe-test-only';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function capture(page, width, state, selector = '.card') {
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await page.screenshot({ path: `${evidence}/after-${width}-${state}.png`, fullPage: true });
  fs.writeFileSync(`${evidence}/after-${width}-${state}.json`, JSON.stringify({
    width, state, box: await page.locator(selector).boundingBox(),
    caption: `${width}px · ${state.replaceAll('-', ' ')} · safe offline fixture`
  }));
}

test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  // All auth writes are intercepted. No credentials, sessions or live backend.
  await page.route('**/api/**', route => json(route, { ok: false }, 401));
});

for (const width of [1440, 390, 320]) {
  test(`reset password ${width}: validation, keyboard, loading, expired retry, success`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    const errors = [];
    const requests = [];
    page.on('pageerror', error => errors.push(error.message));
    let release;
    await page.route('**/api/auth/reset', route => {
      requests.push(route.request().postDataJSON());
      return new Promise(resolve => { release = async () => { await json(route, { ok: false, error: 'invalid_or_expired_token', detail: 'That link is invalid or has expired. Ask for a new one.' }, 400); resolve(); }; });
    });
    await page.goto(`/reset-password.html?token=${token}`);
    await expect(page.getByRole('heading', { name: 'Set a new password.' })).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toHaveAttribute('autocomplete', 'new-password');
    await expect(page.getByLabel('Confirm new password')).toHaveAttribute('minlength', '12');
    await expect(page.locator('#pw1')).toBeEmpty();
    await expect(page.locator('#pw2')).toBeEmpty();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await expect(page.getByRole('button', { name: 'Show password', exact: true })).toHaveCount(2);
    for (const button of await page.getByRole('button', { name: 'Show password', exact: true }).all()) {
      const box = await button.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.width).toBeGreaterThanOrEqual(44);
    }
    await capture(page, width, 'empty');

    await page.locator('#pw1').fill('short');
    await page.locator('#pw2').fill('short');
    await page.locator('#go').click();
    expect(requests).toHaveLength(0);
    expect(await page.locator('#pw1').evaluate(input => input.validity.tooShort)).toBeTruthy();
    await page.locator('#pw1').fill(password);
    await page.locator('#pw2').fill(password);
    await capture(page, width, 'filled');
    await page.locator('#pw2').fill('different-safe-password');
    await page.locator('#go').click();
    await expect(page.locator('#err')).toHaveText("Those two passwords don't match.");
    await expect(page.locator('#pw2')).toBeFocused();
    await expect(page.locator('#pw2')).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toHaveLength(0);
    await page.locator('#pw2').fill(password);

    await page.locator('.fh-pw-btn').first().click();
    await expect(page.locator('#pw1')).toHaveAttribute('type', 'text');
    await expect(page.locator('.fh-pw-btn').first()).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Tab');
    await expect(page.locator('.fh-pw-btn').first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#pw1')).toHaveAttribute('type', 'password');
    // A visible password is covered by the shared toggle's submit listener.
    await page.locator('.fh-pw-btn').last().click();
    await expect(page.locator('#pw2')).toHaveAttribute('type', 'text');
    await page.locator('#go').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#go')).toHaveText('Setting…');
    await expect(page.locator('#go')).toBeDisabled();
    await expect(page.locator('#f')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#pw2')).toHaveAttribute('type', 'password');
    expect(requests).toEqual([{ action: 'confirm', token, password }]);
    await capture(page, width, 'loading', '#f');
    await release();
    await expect(page.locator('#err')).toHaveText('That link is invalid or has expired. Ask for a new one.');
    await expect(page.locator('#err')).toBeFocused();
    await expect(page.locator('#go')).toBeEnabled();
    await expect(page.locator('#go')).toHaveText('Set password');
    await expect(page.locator('#f')).not.toHaveAttribute('aria-busy', 'true');
    await capture(page, width, 'expired', '#err');

    await page.route('**/api/auth/reset', route => json(route, { ok: true }));
    await page.locator('#go').click();
    await expect(page.locator('#f')).toBeHidden();
    await expect(page.locator('#okMsg')).toBeVisible();
    await expect(page.locator('#okMsg')).toBeFocused();
    await expect(page.locator('#okMsg')).toContainText('Every device signed in as this account has been signed out.');
    await expect(page.getByRole('heading', { name: 'Your password is set.' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in now' })).toHaveAttribute('href', '/login.html');
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login.html');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await capture(page, width, 'success', '#okMsg');
    expect(errors).toEqual([]);
  });

  test(`reset password ${width}: missing token makes no auth request`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    let requests = 0;
    await page.route('**/api/auth/reset', async route => { requests++; await json(route, { ok: false }); });
    await page.goto('/reset-password.html');
    await expect(page.locator('#f')).toBeHidden();
    await expect(page.locator('#noToken')).toContainText('This link is missing its token.');
    await expect(page.locator('#noToken')).toContainText('Invite links last 7 days. Reset links last 1 hour. Each link works once.');
    expect(requests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByRole('link', { name: 'Back to sign in' }).focus();
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeFocused();
    await capture(page, width, 'missing-token', '#noToken');
    await page.goto('/reset-password.html?token=');
    await expect(page.locator('#f')).toBeHidden();
    await expect(page.locator('#noToken')).toBeVisible();
    expect(requests).toBe(0);
  });
}

for (const [state, result, expected] of [
  ['network-error', 'abort', 'Could not reach the server. Try again.'],
  ['malformed-response', 'invalid', 'That link is invalid or has expired. Ask for a new one.'],
  ['server-detail', 'detail', '<script>Do not execute server detail</script>']
]) test(`reset password recoverable ${state}`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/auth/reset', route => result === 'abort' ? route.abort()
    : result === 'invalid' ? route.fulfill({ status: 500, contentType: 'text/plain', body: 'unavailable' })
      : json(route, { ok: false, detail: expected }, 400));
  await page.goto(`/reset-password.html?token=${token}`);
  await page.locator('#pw1').fill(password);
  await page.locator('#pw2').fill(password);
  await page.locator('#go').click();
  await expect(page.locator('#err')).toHaveText(expected);
  await expect(page.locator('#err script')).toHaveCount(0);
  await expect(page.locator('#go')).toBeEnabled();
  await expect(page.locator('#go')).toHaveText('Set password');
  await expect(page.locator('#f')).toBeVisible();
  await expect(page.locator('#okMsg')).toBeHidden();
  await capture(page, 390, state, '#err');
});

test.describe('small touch screen', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 568 } });
  test('reset password touch toggles and submit remain usable', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/auth/reset', async route => { requests++; await json(route, { ok: true }); });
    await page.goto(`/reset-password.html?token=${token}`);
    await page.locator('#pw1').fill(password);
    await page.locator('#pw2').fill(password);
    await page.locator('.fh-pw-btn').first().tap();
    await expect(page.locator('#pw1')).toHaveAttribute('type', 'text');
    await page.locator('.fh-pw-btn').first().tap();
    await expect(page.locator('#pw1')).toHaveAttribute('type', 'password');
    expect(requests).toBe(0);
    await page.locator('#go').tap();
    await expect(page.locator('#okMsg')).toBeVisible();
    expect(requests).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await capture(page, 320, 'touch-success', '#okMsg');
  });
});
