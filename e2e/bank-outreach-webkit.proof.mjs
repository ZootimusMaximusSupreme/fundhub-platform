import { test, expect } from '@playwright/test';
import { fixture, expectAstraControls, inspectExpandedShell, captureAstra } from './bank-outreach-fixture.mjs';

// Explicit Mac/WebKit proof collection. Never part of the default Chromium glob.
// All APIs use the same local fictional fixture as the original 37 Bank cases.
test.beforeEach(async ({ browserName }) => { expect(browserName).toBe('webkit'); });

async function contract(page) {
  await expect(page.locator('body')).toHaveClass(/fh-astra fh-astra-staff fh-astra--bank-outreach/);
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(links =>
    links.map(link => new URL(link.href).pathname));
  expect(styles.slice(-3)).toEqual(['/app/bank-outreach.css', '/app/fundhub-astra.css', '/app/fundhub-astra-staff.css']);
  await page.evaluate(() => document.fonts.ready);
}

for (const manager of [false, true]) {
  const role = manager ? 'manager' : 'rep';
  test(`${role}: native fields, expanded menus and saved controls meet the phone contract`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const env = await fixture(page, { manager });
    await contract(page);
    await expect(page.locator('#hero-value')).toHaveText(manager ? '7' : 'Mesa Community Bank');
    await expect(page.locator('#work-next')).toHaveText(manager ? 'Review next bank ↗' : 'Work next banker ↗');
    await expectAstraControls(page, testInfo, role + '-overview');
    await captureAstra(page, testInfo, role + '-overview', '#work-hero');
    await inspectExpandedShell(page, testInfo, role);
    if (manager) await page.locator('#queue-view').click();
    else {
      await expect(page.locator('#import-open')).toBeHidden();
      await expect(page.locator('#view-switch')).toBeHidden();
      await expect(page.locator('#fh-shell-search-btn,#fh-chat-fab')).toHaveCount(0);
    }
    await expect(page.locator('#queue-rows tr')).toHaveCount(25);
    await expectAstraControls(page, testInfo, role + '-queue', '#outreach-main');
    await captureAstra(page, testInfo, role + '-queue', '#queue-filters');
    await page.locator('#state').selectOption('AZ');
    await page.locator('#status').selectOption('engaged');
    await expect.poll(() => env.reads.at(-1)).toMatchObject({ state: 'AZ', status: 'engaged' });
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: '', state: '', status: '' });
    await page.locator('#work-next').click();
    await expect(page.locator('#drawer-content')).toBeVisible();
    await expectAstraControls(page, testInfo, role + '-touch', '#bank-drawer');
    await captureAstra(page, testInfo, role + '-touch-fields', '[data-action="log_touch"] [name="channel"]');
    await page.locator('[data-action="log_touch"] [name="channel"]').selectOption('call');
    await page.locator('[name="contact_id"]').selectOption('contact-1');
    await page.locator('[name="outcome"]').fill('Fictional banker confirmed next call');
    await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Get application path');
    const touchSave = page.getByRole('button', { name: 'Save touch and next action', exact: true });
    await touchSave.scrollIntoViewIfNeeded(); await expect(touchSave).toBeInViewport();
    await touchSave.click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'log_touch', channel: 'call', contact_id: 'contact-1', next_action: 'Get application path' });
    await page.locator('[data-section="contacts"]').click();
    await page.getByRole('button', { name: 'Edit banker', exact: true }).click();
    await expectAstraControls(page, testInfo, role + '-banker', '#bank-drawer');
    await page.locator('#contact-editor [name="title"]').fill('Senior fixture banker');
    await page.getByRole('button', { name: 'Save banker', exact: true }).click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'save_contact', title: 'Senior fixture banker' });
    await page.locator('[data-section="products"]').click();
    if (!manager) await expect(page.locator('[data-verify]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
    await expectAstraControls(page, testInfo, role + '-product', '#bank-drawer');
    await captureAstra(page, testInfo, role + '-product-fields', '#product-editor [name="product_name"]');
    await page.locator('[name="stated_income"]').selectOption('false');
    const productSave = page.getByRole('button', { name: 'Save product facts', exact: true });
    await productSave.scrollIntoViewIfNeeded(); await expect(productSave).toBeInViewport();
    await captureAstra(page, testInfo, role + '-product-footer', '#product-editor .form-actions');
    await productSave.click();
    await expect.poll(() => env.posts.at(-1)?.action).toBe('save_product');
    await page.locator('[data-section="relationship"]').click();
    await expectAstraControls(page, testInfo, role + '-relationship', '#bank-drawer');
    await page.locator('[data-action="set_status"] [name="status"]').selectOption('engaged');
    await page.locator('[name="partner_activity"]').selectOption('quiet');
    await page.getByRole('button', { name: 'Save relationship', exact: true }).click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'set_status', status: 'engaged', partner_activity: 'quiet' });
    if (manager) {
      await page.locator('[name="staff_id"]').selectOption('rep-2');
      await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
      await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'assign', staff_id: 'rep-2' });
    } else await expect(page.locator('[name="staff_id"]')).toHaveCount(0);
    await page.locator('#drawer-close').click();
    await expect(page.locator('#work-next')).toBeFocused();
    await captureAstra(page, testInfo, role + '-drawer-close-focus-restored', '#work-next');
    const rowOpen = page.locator('.open-bank').first();
    const originalRowOpen = await rowOpen.elementHandle();
    await rowOpen.click();
    await expect(page.locator('#drawer-content')).toBeVisible();
    await page.locator('[name="outcome"]').fill('Fictional row-open touch');
    await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Call after queue repaint');
    await page.getByRole('button', { name: 'Save touch and next action', exact: true }).click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'log_touch', next_action: 'Call after queue repaint' });
    await expect.poll(() => originalRowOpen.evaluate(el => el.isConnected)).toBe(false);
    await expect(page.locator('#queue-panel')).toHaveAttribute('aria-busy', 'false');
    await page.locator('#drawer-close').click();
    await expect(rowOpen).toBeFocused();
    await captureAstra(page, testInfo, role + '-row-save-close-focus-restored', '.open-bank');
    // A refresh can hide the old row before replacing it. Close must choose a visible target.
    let releaseQueue;
    const pendingQueue = new Promise(resolve => { releaseQueue = resolve; });
    const holdQueue = async route => {
      const query = new URL(route.request().url()).searchParams;
      if (!query.has('id') && !query.has('view')) await pendingQueue;
      await route.fallback();
    };
    await page.route('**/api/read/bank-outreach?**', holdQueue);
    try {
      const pendingRowOpen = await rowOpen.elementHandle();
      await rowOpen.click();
      await expect(page.locator('#drawer-content')).toBeVisible();
      await page.locator('[name="outcome"]').fill('Fictional delayed-queue touch');
      await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Call when refresh completes');
      await page.getByRole('button', { name: 'Save touch and next action', exact: true }).click();
      await expect(page.locator('#queue-panel')).toHaveAttribute('aria-busy', 'true');
      await expect(page.locator('#queue-table')).toBeHidden();
      expect(await pendingRowOpen.evaluate(el => el.isConnected)).toBe(true);
      await page.locator('#drawer-close').click();
      await expect(page.locator('#work-next')).toBeFocused();
      await captureAstra(page, testInfo, role + '-pending-refresh-close-focus-restored', '#work-next');
    } finally {
      releaseQueue();
      await page.unroute('**/api/read/bank-outreach?**', holdQueue);
    }
    await expect(page.locator('#queue-panel')).toHaveAttribute('aria-busy', 'false');
    if (manager) {
      await page.locator('#import-open').click();
      await expectAstraControls(page, testInfo, role + '-import', '#import-dialog');
      await page.locator('#import-form [name="source"]').selectOption('ncua');
      await page.locator('#import-file').setInputFiles({
        name: 'official-fixture.csv', mimeType: 'text/csv',
        buffer: Buffer.from('CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ'),
      });
      const importSave = page.locator('#import-form [type="submit"]');
      await importSave.scrollIntoViewIfNeeded(); await expect(importSave).toBeInViewport();
      await captureAstra(page, testInfo, role + '-import-footer', '#import-form .form-actions');
      await importSave.click();
      await expect(page.locator('#import-message')).toContainText('Imported 3 banks');
      await page.locator('#import-close').click();
      await expect(page.locator('#import-open')).toBeFocused();
    }
  });

  for (const state of ['loading', 'empty', 'error']) {
    test(`${role} ${state}: readable truthful state and reachable recovery`, async ({ page }, testInfo) => {
      const env = await fixture(page, { manager, state });
      try {
        await contract(page);
        if (manager && state === 'empty') await page.locator('#queue-view').click();
        if (state === 'loading') await expect(page.locator('#queue-state .skeleton')).toHaveCount(3);
        if (state === 'empty') await expect(page.locator('#empty-action')).toHaveText(manager ? 'Import banks' : 'Clear filters');
        if (state === 'error') await expect(page.locator('#queue-state')).toContainText('temporarily unavailable');
        await expectAstraControls(page, testInfo, role + '-' + state);
        await captureAstra(page, testInfo, role + '-' + state, '#queue-state');
        if (state === 'empty') {
          const originalEmptyAction = await page.locator('#empty-action').elementHandle();
          await page.locator('#empty-action').click();
          if (manager) {
            await expect(page.locator('#import-dialog')).toBeVisible();
            await expectAstraControls(page, testInfo, role + '-empty-import', '#import-dialog');
            await page.locator('#import-form [name="csv"]').fill('CERT,NAME,STALP\n123,Fixture Bank,AZ');
            await page.locator('#import-form [type="submit"]').click();
            await expect(page.locator('#import-message')).toContainText('Imported 3 banks');
            await expect.poll(() => originalEmptyAction.evaluate(el => el.isConnected)).toBe(false);
            await expect(page.locator('#queue-panel')).toHaveAttribute('aria-busy', 'false');
            await page.locator('#import-close').click();
            await expect(page.locator('#import-open')).toBeFocused();
            await captureAstra(page, testInfo, role + '-empty-import-close-focus-restored', '#import-open');
          } else await expect(page.locator('#search')).toHaveValue('');
        }
        if (state === 'error') {
          const priorReads = env.reads.length;
          await page.locator('#queue-retry').click();
          await expect.poll(() => env.reads.length).toBeGreaterThan(priorReads);
        }
        if (manager && state === 'empty') {
          expect(env.posts).toHaveLength(1);
          expect(env.posts[0]).toMatchObject({ action: 'import', csv: 'CERT,NAME,STALP\n123,Fixture Bank,AZ' });
        } else expect(env.posts).toEqual([]);
      } finally { env.release(); }
    });
  }
}

test('failed phone save retains exact typed inputs and a reachable retry', async ({ page }, testInfo) => {
  const env = await fixture(page, { failWrite: true });
  await page.locator('#work-next').click();
  await page.locator('[name="outcome"]').fill('Keep this failed-save fixture note');
  await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Call tomorrow');
  await page.getByRole('button', { name: 'Save touch and next action', exact: true }).click();
  await expect(page.locator('#drawer-message')).toContainText('Save failed');
  await expect(page.locator('[name="outcome"]')).toHaveValue('Keep this failed-save fixture note');
  await expect(page.locator('[data-action="log_touch"] [name="next_action"]')).toHaveValue('Call tomorrow');
  await expectAstraControls(page, testInfo, 'failed-save', '#bank-drawer');
  await captureAstra(page, testInfo, 'failed-save', '#drawer-message');
  const retry = page.getByRole('button', { name: 'Save touch and next action', exact: true });
  await retry.scrollIntoViewIfNeeded(); await expect(retry).toBeInViewport();
  await retry.click();
  expect(env.posts).toHaveLength(2);
  expect(env.posts[1]).toEqual(env.posts[0]);
});
