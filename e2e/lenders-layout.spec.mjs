import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, OWNER, CLIENT_ID, json } from './harness.mjs';

const OUT = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/lenders');
const lender = (i = 0) => ({ id: 'lender-' + i, name: ['Mesa Community Bank', 'Desert First Credit Union', 'Mountain West Financial'][i % 3] + (i > 2 ? ' ' + (i + 1) : ''), lender_table: ['OnlineBizCC', 'PersonalCC', 'BizLOC_Documented'][i % 3], bureaus_pulled: ['EX', 'EQ', 'TU'][i % 3], stated_requirements: 'Two years in business; review revenue', priority_tier: i % 3 + 1, active: i % 4 !== 3, eligible_states: 'AZ, NV, UT', last_updated_by: 'Jordan Blake', last_updated_date: '2026-10-17', logo_path: null, application_url: i ? null : 'https://bank.example/apply' });
const book = Array.from({ length: 27 }, (_, i) => lender(i));
const observation = { id: 'observation-1', lender_name: 'Mesa Community Bank', lender_table: 'OnlineBizCC', expected_bureaus_raw: 'EX', observed_bureau: 'TU', observation_source: 'manual', client_id: CLIENT_ID, notes: 'Verified against the application receipt.' };
const bureau = { id: 'bureau-1', bureau_code: 'EX', bureau_name: 'Experian', service_number: '+18885550100', ivr_version: 'v2', menu_path: '1,3,2', expected_hold_minutes: 0, active: true };
async function safeExternal(page) { await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort()); }
async function geometry(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no page overflow').toBe(true);
  await expect(page.locator('#fh-workspace-header')).toHaveCount(1);
  await expect(page.locator('.directory-intro .logo')).toHaveCount(0);
}
async function expectTapHeight(locator) {
  await expect.poll(() => locator.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
}
async function capture(page, width, state, selector) {
  if (!process.env.LENDERS_CAPTURE) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.evaluate(({ selector, caption }) => {
    const bounds = document.querySelector(selector).getBoundingClientRect();
    const box = document.createElement('div'); box.dataset.evidence = 'box';
    Object.assign(box.style, { position: 'fixed', left: Math.max(2, bounds.x) + 'px', top: Math.max(2, bounds.y) + 'px', width: Math.min(innerWidth - bounds.x - 3, bounds.width) + 'px', height: Math.min(innerHeight - bounds.y - 46, bounds.height) + 'px', border: '2px solid #d32323', pointerEvents: 'none', zIndex: '999999', borderRadius: '8px' });
    const label = document.createElement('div'); label.dataset.evidence = 'caption'; label.textContent = caption;
    Object.assign(label.style, { position: 'fixed', left: '10px', right: '10px', bottom: '8px', padding: '7px 10px', background: '#fff', color: '#a11313', border: '1px solid #d32323', borderRadius: '6px', font: '11px/1.4 system-ui', zIndex: '999999' });
    document.body.append(box, label);
  }, { selector, caption: width + 'px · ' + state + ' · Safe fixture; red box marks the verified directory state.' });
  await page.screenshot({ path: path.join(OUT, width + '-' + state + '.png') });
  await page.locator('[data-evidence]').evaluateAll(elements => elements.forEach(el => el.remove()));
}
for (const width of [1440, 390, 320]) {
  for (const state of ['full', 'empty', 'loading', 'error']) {
    test(width + 'px ' + state + ': directory, controls, and honest state', async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await safeExternal(page);
      let release; const pending = new Promise(resolve => { release = resolve; });
      const answer = async route => {
        if (state === 'loading') await pending;
        return json(route, state === 'error' ? { ok: false, message: 'The lender directory is temporarily unavailable.' } : { ok: true, lenders: state === 'empty' ? [] : book });
      };
      try {
        await openScreen(page, '/app/lenders.html', OWNER, { '/api/read/lenders': answer, '/api/read/lender-observations': { ok: true, observations: [observation] } });
        await geometry(page);
        await expect(page.locator('#btnImportToggle')).toBeVisible();
        if (state === 'full') {
          await expect(page.locator('#lenderBody tr')).toHaveCount(27);
          await expect(page.locator('#listMeta')).toHaveText('27 lenders');
          await expect(page.locator('#lenderBody [data-f="eligible_states"]').first()).toHaveValue('AZ, NV, UT');
          const first = page.locator('#lenderBody tr').first();
          await expect(first.locator('[data-f="name"]')).toHaveValue('Mesa Community Bank');
          if (width < 600) {
            await expectTapHeight(first.locator('.save-btn'));
            await expect(page.locator('#moreFilters')).not.toHaveAttribute('open', '');
            await page.locator('#moreFilters summary').click();
            await expect(page.locator('#fState')).toBeVisible();
            await page.locator('#moreFilters summary').click();
          }
        } else if (state === 'empty') { await expect(page.locator('#lenderEmpty')).toBeVisible(); await expect(page.locator('#emptyBanner')).toBeVisible(); }
        else if (state === 'loading') { await expect(page.locator('#listState.loading')).toBeVisible(); await expect(page.locator('#lenderEmpty')).toBeHidden(); }
        else { await expect(page.locator('#listState.error')).toBeVisible(); await expect(page.locator('#btnListRetry')).toBeVisible(); await expect(page.locator('#lenderEmpty')).toBeHidden(); await expect(page.locator('#emptyBanner')).toBeHidden(); }
        if (state === 'error') await expect(page.locator('#toast')).toBeHidden();
        await capture(page, width, state, state === 'full' ? '.panel' : state === 'empty' ? '#lenderEmpty' : '#listState');
      } finally { release(); }
    });
  }
}

test('filters, save, import, add, export, bureau zero/null, and keyboard preserve exact contracts', async ({ page }) => {
  await safeExternal(page);
  const reads = [], posts = [], bureauPosts = [];
  const records = [lender()];
  await openScreen(page, '/app/lenders.html', OWNER, {
    '/api/read/lenders': (route, { url }) => { const query = Object.fromEntries(new URL(url).searchParams); reads.push(query); return query.format === 'csv' ? route.fulfill({ status: 200, contentType: 'text/csv', body: 'lender_table,name\nOnlineBizCC,Mesa Community Bank' }) : { ok: true, lenders: records }; },
    '/api/lenders': async route => { const body = JSON.parse(route.request().postData()); posts.push(body); return json(route, body.action === 'save' ? { ok: true, lender: { ...lender(), ...body.patch } } : body.action === 'import' ? { ok: true, imported: 1, updated: 2, errors: ['Check row 3'] } : { ok: true }); },
    '/api/read/lender-observations': { ok: true, observations: [] },
    '/api/read/ai-bureau-config': { ok: true, configs: [bureau] },
    '/api/ai-bureau-config': async route => { bureauPosts.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); }
  });
  await page.locator('#fQ').fill(' Mesa '); await page.locator('#fTable').selectOption('PersonalCC'); await page.locator('#fBureau').fill(' EQ '); await page.locator('#fTier').selectOption('2'); await page.locator('#fActive').selectOption('false'); await page.locator('#fState').fill(' NV ');
  await page.locator('#fQ').press('Enter');
  await expect.poll(() => reads.at(-1)).toEqual({ lender_table: 'PersonalCC', bureau: 'EQ', priority_tier: '2', active: 'false', state: 'NV', q: 'Mesa' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btnExport').click()]); expect(download.suggestedFilename()).toBe('lenders.csv'); expect(reads.at(-1)).toEqual({ lender_table: 'PersonalCC', bureau: 'EQ', priority_tier: '2', active: 'false', state: 'NV', q: 'Mesa', format: 'csv' });
  const row = page.locator('#lenderBody tr').first(); await row.locator('[data-f="stated_requirements"]').fill(''); await row.locator('[data-f="priority_tier"]').selectOption(''); await row.locator('[data-f="active"]').selectOption('false'); await row.locator('.save-btn').click();
  await expect.poll(() => posts[0]).toMatchObject({ action: 'save', id: 'lender-0', patch: { name: 'Mesa Community Bank', lender_table: 'OnlineBizCC', bureaus_pulled: 'EX', stated_requirements: null, eligible_states: 'AZ, NV, UT', priority_tier: null, active: false } });
  await page.locator('#btnImportToggle').focus(); await page.keyboard.press('Enter'); await expect(page.locator('#importCsv')).toBeFocused();
  await page.locator('#importCsv').fill('lender_table,name\nOnlineBizCC,Mesa'); await page.locator('#btnImportRun').click(); await expect(page.locator('#importResult')).toContainText('Imported 1, updated 2 · 1 issues');
  expect(posts[1]).toEqual({ action: 'import', csv: 'lender_table,name\nOnlineBizCC,Mesa' });
  await page.locator('#btnImportCancel').click(); await expect(page.locator('#btnImportToggle')).toBeFocused();
  page.once('dialog', dialog => dialog.accept('Real lender fixture')); await page.locator('#btnAdd').click(); await expect.poll(() => posts.at(-1)).toEqual({ action: 'create', lender_table: 'PersonalCC', name: 'Real lender fixture', active: true });
  await page.locator('[data-tab="bureau"]').click(); await expect(page.locator('#bureauBody tr')).toHaveCount(1);
  await expect(page.locator('#bureauBody [data-f="expected_hold_minutes"]')).toHaveValue('0'); await page.locator('.save-bureau').click(); await expect.poll(() => bureauPosts[0]?.patch.expected_hold_minutes).toBe(0);
  await page.locator('#btnAddBureau').click(); await page.locator('#bureauBody tr').last().locator('[data-f="bureau_code"]').fill('TU'); await page.locator('#bureauBody tr').last().locator('.save-bureau').click(); await expect.poll(() => bureauPosts[1]).toMatchObject({ action: 'upsert', bureau_code: 'TU', expected_hold_minutes: null, active: true });
});

test('client scope retains match query and safe proxy Apply without a direct bank link', async ({ page }) => {
  const queries = [];
  await page.addInitScript(() => { window.__applies = []; });
  await openScreen(page, '/app/lenders.html?client_id=' + CLIENT_ID, OWNER, { '/api/read/lender-matches': (_route, { url }) => { queries.push(Object.fromEntries(new URL(url).searchParams)); return { ok: true, matches: [lender(), lender(1)] }; }, '/api/read/lender-observations': { ok: true, observations: [] } });
  await page.evaluate(() => { window.FHProxyApply.applyToLender = payload => window.__applies.push(payload); });
  await expect(page.locator('[data-fh-apply]')).toHaveCount(1); await expect(page.locator('#applyClientBanner')).toContainText('If the add-on is off');
  await page.locator('[data-fh-apply]').click(); expect(await page.evaluate(() => window.__applies)).toEqual([{ clientId: CLIENT_ID, lenderId: 'lender-0', lenderName: 'Mesa Community Bank' }]);
  await page.locator('#fTable').selectOption('PersonalLOC'); await page.locator('#btnFilter').click(); await expect.poll(() => queries.at(-1)).toEqual({ client_id: CLIENT_ID, lender_table: 'PersonalLOC' });
  await expect(page.locator('a[href="https://bank.example/apply"]')).toHaveCount(0);
});

test('list/review/bureau errors offer retry and never claim successful emptiness', async ({ page }) => {
  let fail = true;
  await openScreen(page, '/app/lenders.html', OWNER, { '/api/read/lenders': () => fail ? { ok: false } : { ok: true, lenders: [lender()] }, '/api/read/lender-observations': () => fail ? { ok: false } : { ok: true, observations: [] }, '/api/read/ai-bureau-config': () => fail ? { ok: false } : { ok: true, configs: [] } });
  await expect(page.locator('#btnListRetry')).toBeVisible(); fail = false; await page.locator('#btnListRetry').click(); await expect(page.locator('#lenderBody tr')).toHaveCount(1);
  fail = true; await page.locator('[data-tab="review"]').click(); await expect(page.locator('#reviewState.error')).toBeVisible(); await expect(page.locator('#reviewEmpty')).toBeHidden(); fail = false; await page.locator('#btnReviewRetry').click(); await expect(page.locator('#reviewEmpty')).toBeVisible();
  fail = true; await page.locator('[data-tab="bureau"]').click(); await expect(page.locator('#bureauState.error')).toBeVisible(); await expect(page.locator('#bureauEmpty')).toBeHidden(); fail = false; await page.locator('#btnBureauRetry').click(); await expect(page.locator('#bureauEmpty')).toBeVisible();
});

for (const width of [1440, 390, 320]) {
  test(width + 'px mismatch and bureau records keep usable review and routing actions', async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await safeExternal(page);
    const reviews = [], saves = [];
    await openScreen(page, '/app/lenders.html', OWNER, { '/api/read/lenders': { ok: true, lenders: [lender()] }, '/api/read/lender-observations': { ok: true, observations: [observation] }, '/api/lender-observations': async route => { reviews.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); }, '/api/read/ai-bureau-config': { ok: true, configs: [bureau] }, '/api/ai-bureau-config': async route => { saves.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); } });
    await page.locator('[data-tab="review"]').click(); await expect(page.locator('#reviewBody tr')).toHaveCount(1); await geometry(page);
    await expect(page.locator('#reviewBody')).toContainText('Verified against the application receipt.');
    await capture(page, width, 'review', '#tab-review .panel');
    const dismiss = page.locator('#reviewBody [data-act="dismissed"]'); if (width < 600) await expectTapHeight(dismiss);
    await dismiss.click(); await expect.poll(() => reviews[0]).toEqual({ action: 'review', id: observation.id, review_status: 'dismissed' });
    await page.locator('[data-tab="bureau"]').click(); await expect(page.locator('#bureauBody tr')).toHaveCount(1); await geometry(page);
    await expect(page.locator('#bureauBody [data-f="expected_hold_minutes"]')).toHaveValue('0');
    await capture(page, width, 'bureau', '#tab-bureau .panel');
    await page.locator('#bureauBody [data-f="menu_path"]').fill('1,3,4'); await page.locator('#bureauBody .save-bureau').click(); await expect.poll(() => saves[0]).toEqual({ action: 'save', id: bureau.id, patch: { bureau_code: 'EX', bureau_name: 'Experian', service_number: '+18885550100', ivr_version: 'v2', menu_path: '1,3,4', expected_hold_minutes: 0, active: true } });
  });
}
