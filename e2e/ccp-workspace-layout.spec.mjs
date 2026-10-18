import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, json, OWNER, CLOSER, CLIENT_ID, CLIENT_ROW } from './harness.mjs';

const evidence = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18');
const full = {
  ok: true, client: { ...CLIENT_ROW, custom_fields: { analyzer_prequal_amount: 65000 } },
  transactions: [], messages: [], tasks: [], crs_results: [],
  next_action: { key: 'apply_for_funding', label: 'Apply for Funding', why: 'This file is ready for lender applications.' },
  active_blockers: [], next_action_degraded: false,
  funding_round: { number: 2, status: 'Ready', finalized: false, approved_amount: '25000', started_at: '2026-10-12T12:00:00Z' }
};
const handlers = {
  '/api/dashboard/client?': full,
  '/api/read/lender-matches': { ok: true, match_count: 2, summary: { lender_count: 2 }, matches: [
    { id: 'bank-one', name: 'Mesa Community Bank', bureaus_pulled: 'EX', application_url: 'https://bank.example/mesa' },
    { id: 'bank-two', name: 'Papago Savings', bureaus_pulled: 'EQ', application_url: 'https://bank.example/papago' }
  ] },
  '/api/applications': { ok: true, applications: [], decisions: [] },
  '/api/consent/capture': { ok: true, status: { valid: true }, identity: { on_file: true }, approval_link: null }
};
async function open(page, hash = '', extra = {}, session = OWNER) {
  return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}${hash}`, session, { ...handlers, ...extra });
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
}

for (const width of [1440, 390, 320]) {
  test(`workspace fits ${width}px and keeps every section usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await open(page);
    await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
    await expect(page.locator('#ccp-next-action')).toHaveText('Apply for Funding');
    await expect(page.locator('#ccp-task-open')).toBeVisible();
    await expect(page.locator('.workspace-view:visible')).toHaveCount(1);
    await noOverflow(page);
    const primary = await page.locator('#ccp-task-open').boundingBox();
    expect(primary.height).toBeGreaterThanOrEqual(44);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `ccp-after-${width}-overview.png`), fullPage: true });
    for (const name of ['Funding', 'Credit & inquiries', 'Records', 'Access', 'Overview']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.locator('.workspace-view:visible')).toHaveCount(1);
      await noOverflow(page);
    }
    await page.getByRole('tab', { name: 'Credit & inquiries', exact: true }).click();
    await expect(page.locator('#ccp-pull-tu')).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `ccp-after-${width}-credit.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('shared account and related tools menus retain their native toggle behavior', async ({ page }) => {
  await open(page);
  await page.locator('#fh-shell-chip-show').click();
  await expect(page.locator('#fh-shell-out')).toBeVisible();
  await page.locator('#fh-shell-chip-show').click();
  await expect(page.locator('#fh-shell-out')).toBeHidden();
  await page.locator('#more-menu > summary').click();
  await expect(page.locator('#ccp-link-messaging')).toBeVisible();
  await page.locator('#more-menu > summary').click();
  await expect(page.locator('#ccp-link-messaging')).toBeHidden();
});

test('tab keys, browser history and client context agree', async ({ page }) => {
  await open(page);
  const overview = page.getByRole('tab', { name: 'Overview', exact: true });
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Funding', exact: true })).toBeFocused();
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await expect(page).toHaveURL(/client_id=.*#ccp-view-funding$/);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Access', exact: true })).toBeFocused();
  await page.goBack();
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await page.getByRole('tab', { name: 'Funding', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
});

test('existing field and decline anchors reveal the section and folded group', async ({ page }) => {
  await open(page, '#notes');
  await expect(page.locator('#ccp-view-records')).toBeVisible();
  await expect(page.locator('#notes')).toBeVisible();
  await expect(page.locator('[aria-controls="details-body"]')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { location.hash = 'bp-declines'; });
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await expect(page.locator('#bp-declines')).toBeVisible();
  await expect(page.locator('[aria-controls="bp-body"]')).toHaveAttribute('aria-expanded', 'true');
});

test('a file action can reveal its field after the user changes section', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('ccp:reveal', { detail: document.getElementById('ccp-round-funded') })));
  await expect(page.locator('#ccp-view-overview')).toBeVisible();
});

test('staff without access permissions get no Access tab or controls', async ({ page }) => {
  await open(page, '#ccp-view-access', {}, CLOSER);
  await expect(page.getByRole('tab', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(page.locator('#ccp-view-overview')).toBeVisible();
  await expect(page.locator('#ccp-rep-wrap')).toBeHidden();
  await expect(page.locator('#ccp-portal-link-wrap')).toBeHidden();
});

test('records retain typed notes across sections and upload the selected client document', async ({ page }) => {
  const writes = [], uploads = [];
  await open(page, '#notes', {
    '/api/client-notes': route => {
      writes.push(route.request().postDataJSON());
      return json(route, { ok: true, client: { id: CLIENT_ID, staff_notes: 'Call Friday.' } });
    },
    '/api/documents-upload': route => {
      uploads.push(route.request().postData());
      return json(route, { ok: true, documents: [{ download: { url: '/fixture-document.pdf' } }] });
    }
  });
  await page.locator('#notes').fill('Call Friday.');
  await page.getByRole('tab', { name: 'Funding', exact: true }).click();
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  await expect(page.locator('#notes')).toHaveValue('Call Friday.');
  await page.locator('#notes-save').click();
  await expect(page.locator('#notes-status')).toContainText('Saved to this client file.');
  expect(writes).toEqual([{ client_id: CLIENT_ID, notes: 'Call Friday.' }]);
  await page.locator('[aria-controls="upload-body"]').click();
  await page.locator('#staff-file-input').setInputFiles({ name: 'identity.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
  await expect(page.locator('#staff-upload-status')).toHaveText('1 file sent');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain(CLIENT_ID);
  await expect(page.locator('#staff-filelist a')).toHaveAttribute('href', '/fixture-document.pdf');
});

test('a failed file read can be retried from the page', async ({ page }) => {
  let reads = 0;
  await open(page, '', { '/api/dashboard/client?': route => {
    reads += 1;
    return reads === 1 ? json(route, { ok: false, error: 'boom' }, 500) : json(route, full);
  } });
  await page.locator('#ccp-file-retry').click();
  await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
  await expect(page.locator('#ccp-file-retry')).toBeHidden();
  await expect(page.locator('#ccp-task-open')).toBeVisible();
});

for (const state of ['empty', 'error', 'loading']) {
  test(`${state} stays honest and fits a 320px phone`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const extra = state === 'error' ? { '/api/dashboard/client?': route => json(route, { ok: false, error: 'boom' }, 500) }
      : state === 'loading' ? { '/api/dashboard/client?': async route => { await held; return json(route, full); } } : {};
    if (state === 'empty') await openScreen(page, '/app/client-control-panel.html', OWNER, handlers);
    else await open(page, '', extra);
    if (state === 'empty') await expect(page.locator('#ccp-name')).toHaveText('No client open');
    if (state === 'error') {
      await expect(page.locator('#ccp-name')).toHaveText('Could not load this file');
      await expect(page.locator('#ccp-file-retry')).toBeVisible();
    }
    if (state === 'loading') await expect(page.locator('#ccp-next-action .skel')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: path.join(evidence, `ccp-after-320-${state}.png`), fullPage: true });
    release();
  });
}
