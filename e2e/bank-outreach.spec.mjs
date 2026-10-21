import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, facts, expectAstraControls, inspectExpandedShell, captureAstra } from './bank-outreach-fixture.mjs';
import { STATE_CODES } from '../src/outreach/model.mjs';

// Safe browser fixtures prove UI controls, not live bank facts or database writes.
const OUT = path.resolve('ops/workflows/build-evidence/bank-outreach');
async function geometry(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('#fh-workspace-header')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-fh-rounded-default', '');
}
async function capture(page, name, selector) {
  if (!process.env.BANK_OUTREACH_CAPTURE) return;
  fs.mkdirSync(OUT, { recursive: true });
  if (name.endsWith('-overview') || name.includes('-drawer')) {
    await page.evaluate(() => { window.scrollTo(0, 0); const dialog = document.querySelector('dialog[open]'); if (dialog) dialog.scrollTop = 0; });
  } else await page.locator(selector).scrollIntoViewIfNeeded();
  await page.addStyleTag({ content: '.outreach-evidence-box{outline:2px solid #d32323!important;outline-offset:-3px}.outreach-evidence-caption{position:fixed;left:8px;right:8px;bottom:8px;z-index:999999;background:#fff;color:#a11313;border:1px solid #d32323;padding:8px;font:12px/1.4 system-ui;pointer-events:none}' });
  await page.locator(selector).evaluate(el => el.classList.add('outreach-evidence-box'));
  await page.evaluate(text => { const el = document.createElement('div'); el.className = 'outreach-evidence-caption'; el.textContent = text + ' · Safe UI fixture. Red box marks the state or controls under review.'; (document.querySelector('dialog[open]') || document.body).append(el); }, name);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  await page.locator('.outreach-evidence-caption').evaluateAll(els => els.forEach(el => el.remove()));
  await page.locator(selector).evaluate(el => el.classList.remove('outreach-evidence-box'));
}

for (const width of [1440, 390, 320]) {
  for (const state of ['full', 'empty', 'loading', 'error']) {
    test(`${width}px rep ${state}: honest state, shared frame and phone fit`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const env = await fixture(page, { state });
      try {
        await geometry(page);
        if (state === 'full') {
          await expect(page.locator('#queue-rows tr')).toHaveCount(25);
          await expect(page.locator('#hero-value')).toHaveText('Mesa Community Bank');
          await expect(page.locator('#verified-week')).toHaveText('7');
          await expect(page.locator('#verified-compare')).toHaveText('vs 4 last week');
          await expect(page.locator('#import-open')).toBeHidden(); await expect(page.locator('#view-switch')).toBeHidden();
          await expect(page.locator('#queue-scope')).toContainText('Assigned banks only');
          await expect(page.locator('#fh-shell-search-btn')).toHaveCount(0); await expect(page.locator('#fh-chat-fab')).toHaveCount(0); await expect(page.locator('.navitem:visible')).toHaveCount(1);
          const open = page.locator('.open-bank').first(); expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
        } else if (state === 'empty') await expect(page.locator('#empty-action')).toHaveText('Clear filters');
        else if (state === 'error') { await expect(page.locator('#queue-retry')).toBeVisible(); await expect(page.locator('#queue-state')).toContainText('temporarily unavailable'); await page.locator('#queue-retry').click(); }
        else await expect(page.locator('#queue-state .skeleton')).toHaveCount(3);
        await capture(page, `${width}-rep-${state}`, state === 'full' ? '#queue-panel' : '#queue-state');
        if (state === 'full') await capture(page, `${width}-rep-overview`, '.outreach-overview');
        if (state === 'full') {
          await page.locator('#work-next').click(); await expect(page.locator('#bank-drawer')).toBeVisible(); await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank'); await geometry(page); await capture(page, `${width}-rep-drawer`, '#drawer-content');
          for (const section of ['contacts', 'products', 'history', 'relationship']) { await page.locator(`[data-section="${section}"]`).click(); await capture(page, `${width}-rep-${section}-drawer`, '#drawer-content'); }
          await page.keyboard.press('Escape'); await expect(page.locator('#work-next')).toBeFocused();
        }
      } finally { env.release(); }
    });
  }
  test(`${width}px manager: team results, assignment, import and drawer fit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const env = await fixture(page, { manager: true });
    await expect(page.locator('#team-section')).toBeVisible(); await expect(page.locator('#team-content')).toContainText('Casey Reed'); await geometry(page);
    await capture(page, `${width}-manager-full`, '#team-content');
    await page.locator('#queue-view').click(); await page.locator('.open-bank').first().click();
    await page.locator('[data-section="products"]').click(); await capture(page, `${width}-manager-products-drawer`, '#drawer-content');
    await page.locator('[data-section="relationship"]').click(); await capture(page, `${width}-manager-relationship-drawer`, '#drawer-content');
    await page.locator('[name="staff_id"]').selectOption('rep-2'); await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'assign', id: 'bank-0', staff_id: 'rep-2' });
    await page.locator('#drawer-close').click(); await page.locator('#import-open').click();
    await page.locator('#import-form [name="source"]').selectOption('ncua'); await page.locator('#import-file').setInputFiles({ name: 'official-ncua-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from('CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ') }); await expect(page.locator('#import-form textarea')).toHaveValue('CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ'); await page.locator('#import-form [type="submit"]').click();
    await expect(page.locator('#import-message')).toContainText('Imported 3 banks · 2 already saved · 1 outside launch states.');
    expect(env.posts.at(-1)).toEqual({ action: 'import', source: 'ncua', csv: 'CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ' });
    await capture(page, `${width}-manager-import`, '#import-dialog'); await page.locator('#import-close').click(); await expect(page.locator('#import-open')).toBeFocused();
  });
  for (const state of ['loading', 'empty', 'error']) {
    test(`${width}px manager ${state}: honest state and retry or import`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 }); const env = await fixture(page, { manager: true, state });
      try {
        await geometry(page);
        if (state === 'empty') { await page.locator('#queue-view').click(); await expect(page.locator('#empty-action')).toHaveText('Import banks'); await expect(page.locator('#verified-week')).toHaveText('0'); await page.locator('#empty-action').click(); await expect(page.locator('#import-dialog')).toBeVisible(); await page.locator('#import-close').click(); }
        else if (state === 'loading') await expect(page.locator('#queue-state .skeleton')).toHaveCount(3);
        else await expect(page.locator('#queue-retry')).toBeVisible();
        await capture(page, `${width}-manager-${state}`, '#queue-state');
      } finally { env.release(); }
    });
  }
}

test('queue filters debounce, preserve contracts and paginate at 25', async ({ page }) => {
  const env = await fixture(page); await expect(page.locator('#queue-rows tr')).toHaveCount(25);
  await page.locator('#search').fill(' Mesa '); await expect.poll(() => env.reads.at(-1)?.q).toBe('Mesa');
  await page.locator('#state').selectOption('AZ'); await page.locator('#status').selectOption('engaged');
  await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: 'Mesa', state: 'AZ', status: 'engaged', offset: '0', limit: '25' });
  await page.locator('#next').click(); await expect(page.locator('#page-count')).toHaveText('26–27 of 27');
  await page.locator('#previous').click(); await expect(page.locator('#page-count')).toHaveText('1–25 of 27');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: '', state: '', status: '', offset: '0' });
});

test('rep touches, banker edits, typed product facts and relationship controls save exact values', async ({ page }) => {
  const env = await fixture(page); await page.locator('#work-next').click();
  await expect(page.locator('#bank-links a').first()).toHaveAttribute('href', /linkedin\.com\/search\/results\/people/);
  await page.locator('[data-action="log_touch"] [name="channel"]').selectOption('call'); await page.locator('[name="contact_id"]').selectOption('contact-1');
  await page.locator('[name="outcome"]').fill('Banker confirmed eligibility'); await page.locator('[name="note"]').fill('Real banker note <not markup>'); await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Get application path');
  await page.getByRole('button', { name: 'Save touch and next action' }).click();
  await expect.poll(() => env.posts[0]).toEqual({ action: 'log_touch', account_id: 'bank-0', channel: 'call', contact_id: 'contact-1', outcome: 'Banker confirmed eligibility', note: 'Real banker note <not markup>', next_action: 'Get application path', next_due_at: '' });
  await page.locator('[data-section="contacts"]').click(); await page.getByRole('button', { name: 'Edit banker', exact: true }).click(); await expect(page.locator('#contact-editor [name="name"]')).toBeFocused();
  await page.locator('#contact-editor [name="title"]').fill('Senior business banker'); await page.getByRole('button', { name: 'Save banker', exact: true }).click();
  await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'save_contact', id: 'contact-1', name: 'Avery Lane', title: 'Senior business banker' });
  await page.locator('#new-contact').click(); await page.locator('#contact-editor [name="name"]').fill('Morgan Lee'); await page.locator('#contact-editor [name="email"]').fill('morgan@bank.example'); await page.getByRole('button', { name: 'Save banker', exact: true }).click();
  await expect(page.locator('#contact-list')).toContainText('Morgan Lee');
  await page.locator('[data-section="products"]').click(); await expect(page.locator('#product-list')).toContainText('Unknown'); await expect(page.locator('[data-verify]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
  await page.locator('[name="minimum_score"]').fill('unknown'); await page.locator('[name="minimum_time_in_business_years"]').fill('0'); await page.locator('[name="stated_income"]').selectOption('false'); await page.locator('[name="eligible_states"]').fill('az, ca');
  await page.getByRole('button', { name: 'Save product facts', exact: true }).click();
  await expect.poll(() => env.posts.at(-1)?.facts).toEqual({ ...facts, minimum_time_in_business_years: 0 });
  await page.locator('#new-product').click(); await expect(page.locator('#product-editor [name="product_name"]')).toBeFocused();
  await page.locator('[data-section="history"]').click(); await expect(page.locator('#detail-history')).toContainText('No activity saved');
  await page.locator('[data-section="relationship"]').click(); await page.locator('[name="partner_activity"]').selectOption('quiet'); await page.locator('[data-action="set_status"] [name="status"]').selectOption('engaged'); await page.locator('[data-action="set_status"] [name="next_action"]').fill('Quarterly review'); await page.getByRole('button', { name: 'Save relationship' }).click();
  await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'set_status', id: 'bank-0', status: 'engaged', partner_activity: 'quiet', next_action: 'Quarterly review', next_due_at: '' });
});

test('failed writes retain exact inputs and escaped banker data never runs markup', async ({ page }) => {
  const env = await fixture(page, { failWrite: true }); env.data.account.name = '<img src=x onerror="window.__unsafe=true">'; env.data.contacts[0].name = '<script>unsafe</script>';
  await page.locator('#work-next').click(); await expect(page.locator('#bank-title')).toHaveText(env.data.account.name); await expect(page.locator('#bank-title img')).toHaveCount(0);
  await page.locator('[name="outcome"]').fill('Retain me'); await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Call tomorrow'); await page.getByRole('button', { name: 'Save touch and next action' }).click();
  await expect(page.locator('#drawer-message')).toContainText('Save failed'); await expect(page.locator('[name="outcome"]')).toHaveValue('Retain me'); await expect(page.locator('[data-action="log_touch"] [name="next_action"]')).toHaveValue('Call tomorrow');
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
});

test('published facts are read-only for reps; manager amendment uses draft and verifies', async ({ page }) => {
  await fixture(page, { published: true }); await page.locator('#work-next').click(); await page.locator('[data-section="products"]').click(); await expect(page.locator('[data-edit-product]')).toHaveCount(0); await expect(page.locator('[data-verify]')).toHaveCount(0); await expect(page.locator('#product-list')).toContainText('Published facts are read-only');
  await page.locator('#drawer-close').click();
  const env = await fixture(page, { manager: true, published: true, draft: true }); await page.locator('#work-next').click(); await page.locator('[data-section="products"]').click(); await expect(page.locator('#product-list')).toContainText('Pending amendment'); await page.locator('[data-edit-product]').click(); await expect(page.locator('[name="minimum_score"]')).toHaveValue('680'); await expect(page.locator('[name="product_name"]')).toHaveValue('Proposed business line');
  await page.locator('[data-verify]').click(); await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'verify_product', id: 'product-1' }); await expect(page.locator('#drawer-message')).toContainText('Verified product saved to Lenders');
});

test('team and drawer read failures expose working retries; manual bank links open safely', async ({ page }) => {
  const env = await fixture(page, { manager: true });
  env.faults.team = true; await page.locator('#queue-view').click(); await page.locator('#team-view').click(); await expect(page.locator('#team-retry')).toBeVisible();
  env.faults.team = false; await page.locator('#team-retry').click(); await expect(page.locator('#team-content')).toContainText('Casey Reed');
  env.faults.detail = true; await page.locator('#work-next').click(); await expect(page.locator('#detail-retry')).toBeVisible();
  env.faults.detail = false; await page.locator('#detail-retry').click(); await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank');
  for (const link of await page.locator('#bank-links a').all()) { const popupReady = page.waitForEvent('popup'); await link.click(); const popup = await popupReady; await popup.close(); }
  await page.locator('[data-section="contacts"]').click(); const popupReady = page.waitForEvent('popup'); await page.getByRole('link', { name: 'LinkedIn profile' }).click(); const popup = await popupReady; await popup.close();
});

test.describe('Arizona time remains fixed outside Arizona', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('display labels Arizona and saves chosen Arizona time as UTC', async ({ page }) => {
    const env = await fixture(page); await page.locator('#work-next').click();
    await expect(page.locator('#bank-next-due time')).toContainText('8:00 AM Arizona'); await expect(page.locator('#bank-next-due time')).toHaveAttribute('title', /Arizona$/);
    const form = page.locator('[data-action="log_touch"]'); await form.locator('[name="outcome"]').fill('Banker requested July check-in'); await form.locator('[name="next_action"]').fill('Call banker'); await form.getByLabel('Next action time in Arizona').fill('2026-07-01T09:30'); await form.locator('[type="submit"]').click();
    await expect.poll(() => env.posts.at(-1)?.next_due_at).toBe('2026-07-01T16:30:00.000Z');
  });
});

test('oversized CSV keeps the reviewed data and explains how to recover', async ({ page }) => {
  await fixture(page, { manager: true }); await page.locator('#import-open').click(); await page.locator('#import-form textarea').fill('CERT,NAME,STALP\n123,Kept Bank,AZ');
  await page.locator('#import-file').setInputFiles({ name: 'too-large.csv', mimeType: 'text/csv', buffer: Buffer.alloc(5000001) });
  await expect(page.locator('#import-message')).toContainText('under 5 MB'); await expect(page.locator('#import-form textarea')).toHaveValue('CERT,NAME,STALP\n123,Kept Bank,AZ');
});

test('unanswered product facts stay distinct from explicit unknown, zero and no', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const env = await fixture(page);
  env.data.products[0].facts = { ...facts, minimum_score: null, minimum_time_in_business_years: 0, minimum_revenue_threshold: '', bureaus_pulled: [] };
  await page.locator('#work-next').click(); await page.locator('[data-section="products"]').click();
  await capture(page, `390-${process.env.BANK_OUTREACH_EVIDENCE_PHASE || 'fixed'}-unanswered-facts-drawer`, '.record-facts');
  const fact = label => page.locator('.record-facts dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('+ dd');
  await expect(fact('Minimum score')).toHaveText('Unanswered');
  await expect(fact('Minimum revenue')).toHaveText('Unanswered');
  await expect(fact('Bureaus pulled')).toHaveText('Unanswered');
  await expect(fact('Paper application URL')).toHaveText('Unknown');
  await expect(fact('Minimum years in business')).toHaveText('0');
  await expect(fact('Stated income')).toHaveText('No');
  await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
  await expect(page.locator('[name="minimum_score"]')).toHaveValue('');
  await expect(page.locator('[name="paper_application_url"]')).toHaveValue('unknown');
  expect(env.posts).toEqual([]);
});

test('saved banker email and phone open manual contact targets without a Fundhub send', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const env = await fixture(page);
  env.data.contacts[0].email = 'avery+business@bank.example';
  env.data.contacts[0].phone = '+1 (602) 555-0101';
  env.data.contacts.push({ id: 'contact-2', name: 'No contact details', title: 'Research contact', email: '', phone: '', linkedin_url: '' });
  env.data.contacts.push({ id: 'contact-3', name: 'Branch desk', phone: '+1 602-555-0102 ext. 42' });
  env.data.contacts.push({ id: 'contact-4', name: 'Unconfirmed phone', phone: 'Ask for branch number' });
  env.data.contacts.push({ id: 'contact-5', name: 'Query characters', email: 'queries?subject=Injected&bcc=other@bank.example' });
  env.data.contacts.push({ id: 'contact-6', name: 'Control characters', email: 'desk@bank.example\r\nBcc: hidden@bank.example' });
  await page.locator('#work-next').click(); await page.locator('[data-section="contacts"]').click();
  await capture(page, `390-${process.env.BANK_OUTREACH_EVIDENCE_PHASE || 'fixed'}-manual-contact-drawer`, '#contact-list');
  const email = page.getByRole('link', { name: 'Email Avery Lane' }), phone = page.getByRole('link', { name: 'Call Avery Lane' });
  await expect(email).toHaveAttribute('href', 'mailto:avery%2Bbusiness@bank.example');
  await expect(phone).toHaveAttribute('href', 'tel:+16025550101');
  await expect(page.getByRole('link', { name: 'Call Branch desk' })).toHaveAttribute('href', 'tel:+16025550102;ext=42');
  await expect(page.getByRole('link', { name: 'Call Unconfirmed phone' })).toHaveCount(0);
  const queryEmail = page.getByRole('link', { name: 'Email Query characters' });
  await expect(queryEmail).toHaveAttribute('href', 'mailto:queries%3Fsubject%3DInjected%26bcc%3Dother@bank.example');
  expect(await queryEmail.evaluate(link => new URL(link.href).search)).toBe('');
  await expect(page.getByRole('link', { name: 'Email Control characters' })).toHaveCount(0);
  for (const link of [email, phone]) expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(40);
  await expect(page.locator('.saved-record').filter({ hasText: 'No contact details' }).getByRole('link')).toHaveCount(0);
  await page.evaluate(() => {
    window.__manualContactTargets = [];
    document.querySelector('#contact-list').addEventListener('click', event => {
      const anchor = event.target.closest('a[href^="mailto:"],a[href^="tel:"]');
      if (anchor) { event.preventDefault(); window.__manualContactTargets.push(anchor.getAttribute('href')); }
    });
  });
  await email.click(); await phone.click(); await page.getByRole('link', { name: 'Call Branch desk' }).click(); await queryEmail.click();
  expect(await page.evaluate(() => window.__manualContactTargets)).toEqual(['mailto:avery%2Bbusiness@bank.example', 'tel:+16025550101', 'tel:+16025550102;ext=42', 'mailto:queries%3Fsubject%3DInjected%26bcc%3Dother@bank.example']);
  expect(env.posts).toEqual([]);
});

for (const manager of [false, true]) {
  test(`${manager ? 'manager' : 'rep'} filtered empty queue clears filters instead of suggesting new imports`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    const env = await fixture(page, { manager, filteredEmpty: true });
    if (manager) await page.locator('#queue-view').click();
    await page.getByLabel('Search banks').fill('No matching bank');
    await expect(page.locator('#empty-action')).toBeVisible();
    await capture(page, `390-${process.env.BANK_OUTREACH_EVIDENCE_PHASE || 'fixed'}-${manager ? 'manager' : 'rep'}-filtered-empty`, '#queue-state');
    await expect(page.locator('#queue-state')).toContainText('No banks match your filters');
    await expect(page.locator('#empty-action')).toHaveText('Clear filters');
    await expect(page.locator('#queue-state')).not.toContainText('Import official bank lists');
    await page.locator('#empty-action').click();
    await expect(page.getByLabel('Search banks')).toHaveValue('');
    await expect(page.locator('#queue-rows tr')).toHaveCount(25);
    await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: '', state: '', status: '', offset: '0' });
    expect(env.posts).toEqual([]);
  });
}

test('inactive filtered banks stay visible without claiming there are no matching banks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  const env = await fixture(page, { filteredInactive: true });
  for (const status of ['paused', 'closed']) {
    await page.locator('#status').selectOption(status);
    await expect(page.locator('#queue-rows tr')).toHaveCount(1);
    await expect(page.locator('#queue-rows .status-tag')).toHaveText(status === 'paused' ? 'Paused' : 'Closed');
    await capture(page, `390-${process.env.BANK_OUTREACH_EVIDENCE_PHASE || 'fixed'}-${status}-overview`, '#work-hero');
    await expect(page.locator('#hero-value')).toHaveText('No active bank in this view');
    await expect(page.locator('#work-next')).toBeHidden();
    await page.locator('.open-bank').click();
    await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank');
    await expect.poll(() => env.reads.at(-1)).toMatchObject({ id: 'bank-0' });
    await page.locator('#drawer-close').click();
  }
  expect(env.posts).toEqual([]);
});

test('cold phone performance: Slow 4G and 4x CPU with fixture API', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: 'cellular4g' });
  await page.addInitScript(() => {
    window.__outreachPerf = { lcp: 0, cls: 0, interaction: 0, shifts: [] };
    new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__outreachPerf.lcp = entry.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) { window.__outreachPerf.cls += entry.value; window.__outreachPerf.shifts.push({ value: entry.value, at: entry.startTime, sources: entry.sources.map(s => ({ tag: s.node?.tagName, id: s.node?.id, class: String(s.node?.className || ''), from: s.previousRect.toJSON(), to: s.currentRect.toJSON() })) }); } }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => { for (const entry of list.getEntries()) if (entry.interactionId) window.__outreachPerf.interaction = Math.max(window.__outreachPerf.interaction, entry.duration); }).observe({ type: 'event', durationThreshold: 16, buffered: true });
  });
  await fixture(page); await expect(page.locator('#work-next')).toBeVisible(); await page.waitForTimeout(1000);
  await page.locator('#work-next').click(); await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank'); await page.waitForTimeout(300);
  const metrics = await page.evaluate(() => ({ ...window.__outreachPerf, ttfb: performance.getEntriesByType('navigation')[0].responseStart, htmlBytes: performance.getEntriesByType('navigation')[0].encodedBodySize, resources: performance.getEntriesByType('resource').map(r => ({ url: new URL(r.name).pathname, bytes: r.encodedBodySize })) }));
  metrics.jsBytes = metrics.resources.filter(r => r.url.endsWith('.js')).reduce((total, r) => total + r.bytes, 0);
  metrics.pageBytes = metrics.htmlBytes + metrics.resources.reduce((total, r) => total + r.bytes, 0);
  const report = { scope: 'Local cold static page, safe API fixtures; backend latency and production hosting not measured. Event Timing covers the measured drawer interaction, not field INP. Not Lighthouse.', viewport: '390x844', network: '150ms latency / 1.6Mbps down / 750Kbps up', cpu: '4x slowdown', measured_at: new Date().toISOString(), ...metrics };
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, 'mobile-performance.json'), JSON.stringify(report, null, 2) + '\n');
  expect(metrics.lcp, 'CRM LCP below 2.5s').toBeGreaterThan(0); expect(metrics.lcp).toBeLessThan(2500);
  expect(metrics.cls).toBeLessThan(0.1); expect(metrics.interaction).toBeLessThan(200); expect(metrics.jsBytes).toBeLessThan(500000); expect(metrics.pageBytes).toBeLessThan(2000000);
});

for (const viewport of [{ width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  for (const manager of [false, true]) {
    test(`Astra ${viewport.width}px ${manager ? 'manager' : 'rep'}: expanded menus and editors stay readable`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      const env = await fixture(page, { manager }), prefix = `${viewport.width}-${manager ? 'manager' : 'rep'}`;
      await expect(page.locator('#work-next')).toBeVisible();
      await expectAstraControls(page, testInfo, prefix + '-overview');
      await inspectExpandedShell(page, testInfo, prefix);
      if (manager) await page.locator('#queue-view').click();
      await expect(page.locator('#queue-rows tr')).toHaveCount(25);
      await expectAstraControls(page, testInfo, prefix + '-queue', '#outreach-main');
      await page.locator('#work-next').click();
      await expect(page.locator('#drawer-content')).toBeVisible();
      await expectAstraControls(page, testInfo, prefix + '-touch', '#bank-drawer');
      await page.locator('[data-section="products"]').click();
      await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
      await expectAstraControls(page, testInfo, prefix + '-product', '#bank-drawer');
      const save = page.getByRole('button', { name: 'Save product facts', exact: true });
      await save.scrollIntoViewIfNeeded(); await expect(save).toBeInViewport();
      await save.click({ trial: true });
      await captureAstra(page, testInfo, prefix + '-product-footer', '#product-editor .form-actions');
      await page.locator('#drawer-close').click();
      await expect(page.locator('#work-next')).toBeFocused();
      expect(env.posts).toEqual([]);
    });
  }
}

// ── Automation cards: found bankers, automatic emails, banker replies and the manager panel ──
// Fictional fixture rows only. These prove the screen sends the exact action and shows the
// saved result after the re-read; they are not live search, email or AI proof.
const AUTO_OUT = path.resolve('ops/workflows/build-evidence/bank-outreach-auto');
// Saves the raw picture and the real element boxes. ops/workflows/w4b-proof-2026-09-03/_apply-marks.py
// burns the numbered red boxes and legend from shot-marks.json. Off unless BANK_OUTREACH_AUTO_CAPTURE is set.
async function markShot(page, file, legend, marks, { height } = {}) {
  if (!process.env.BANK_OUTREACH_AUTO_CAPTURE) return;
  const raw = path.join(AUTO_OUT, '_raw'); fs.mkdirSync(raw, { recursive: true });
  const before = page.viewportSize();
  if (height) await page.setViewportSize({ width: before.width, height }); // A taller picture, same width.
  // First mark near the top, below the shared header (page) or the dialog padding (drawer).
  await marks[0][0].evaluate(el => { el.scrollIntoView({ block: 'start' }); const dialog = el.closest('dialog'); if (dialog) dialog.scrollBy(0, -24); else window.scrollBy(0, -160); });
  const ratio = await page.evaluate(() => devicePixelRatio), view = page.viewportSize(), boxes = [];
  for (const [index, [locator, caption]] of marks.entries()) {
    const box = await locator.boundingBox();
    expect(box && box.y >= 0 && box.y + box.height <= view.height, `mark ${index + 1} (${caption}) is inside the picture`).toBe(true);
    boxes.push({ n: index + 1, caption, box: { x: Math.round(box.x * ratio), y: Math.round(box.y * ratio), w: Math.round(box.width * ratio), h: Math.round(box.height * ratio) } });
  }
  await page.screenshot({ path: path.join(raw, file) });
  const manifestPath = path.join(AUTO_OUT, 'shot-marks.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
  manifest[file] = { legend, marks: boxes }; fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  if (height) await page.setViewportSize(before);
}
const lead = (page, id) => page.locator(`[data-lead="${id}"]`);
const contactCard = (page, id) => page.locator(`#contact-list [data-contact="${id}"]`);
const reply = (page, id) => page.locator(`[data-reply="${id}"]`);
const detailReads = env => env.reads.filter(r => r.id === 'bank-0').length;
async function openAutomationBank(page) {
  await page.context().route(/linkedin\.com/, route => route.abort()); // A LinkedIn click opens a tab; nothing loads.
  await page.locator('#work-next').click(); await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank');
}

for (const width of [1440, 390, 320]) {
  test.describe(`${width}px automation cards`, () => {
    test.use({ viewport: { width, height: 1000 }, deviceScaleFactor: width < 600 ? 2 : 1 });

    test(`${width}px rep: queue counts, found bankers and automatic email controls save exact bodies`, async ({ page }, testInfo) => {
      const env = await fixture(page, { automation: true });
      await geometry(page);
      const rows = page.locator('#queue-rows tr');
      await expect(rows).toHaveCount(25);
      await expect(rows.nth(0).locator('.row-chips .status-tag')).toHaveText(['2 found bankers', '2 replies']);
      await expect(rows.nth(1).locator('.row-chips')).toHaveCount(0);
      await expect(rows.nth(2).locator('.row-chips .status-tag')).toHaveText(['1 found banker']);
      await expect(rows.nth(4).locator('.row-chips .status-tag')).toHaveText(['1 reply']);
      await expect(page.locator('#leads-waiting')).toHaveText('7'); await expect(page.locator('#replies-waiting')).toHaveText('5');
      await expectAstraControls(page, testInfo, `${width}-auto-queue`, '#outreach-main');
      if (width < 600) {
        await markShot(page, `${width}-rep-queue-counts.png`, `${width} rep · queue counts (fictional fixture)`, [
          [page.locator('#leads-waiting').locator('xpath=..'), 'Found bankers to review, all banks'],
          [page.locator('#replies-waiting').locator('xpath=..'), 'Banker replies waiting, all banks'],
          [rows.nth(0).locator('.row-chips'), 'Chips on the bank that has them'],
          [rows.nth(0).locator('.open-bank'), 'Open the bank to review them']
        ], { height: 1300 });
      }
      await openAutomationBank(page);
      await expect(page.locator('[data-section="contacts"]')).toHaveText('Bankers · 2 found');
      await expect(page.locator('[data-section="replies"]')).toHaveText('Replies · 2');
      await page.locator('[data-section="contacts"]').click();
      await expect(page.locator('#detail-contacts')).toContainText('2 bankers from a LinkedIn search need review.');
      await expect(lead(page, 'lead-1')).toContainText('Taylor Brooks');
      await expect(lead(page, 'lead-1')).toContainText('Business banking officer · Mesa Community Bank');
      await expect(lead(page, 'lead-1')).toContainText('High confidence match');
      await expect(lead(page, 'lead-1')).toContainText('Helps local owners with business cards and lines of credit.');
      await expect(lead(page, 'lead-1').locator('.status-tag')).toHaveText('Needs review');
      await expect(lead(page, 'lead-2')).toContainText('Medium confidence match');
      for (const [id, status, snippet] of [['lead-3', 'Saved as banker', 'Business relationship manager at Mesa Community Bank.'], ['lead-4', 'Not a match', 'Teller at a Mesa Community Bank branch.']]) {
        await expect(lead(page, id).locator('.status-tag')).toHaveText(status);
        await expect(lead(page, id)).not.toContainText(snippet); // Reviewed rows stay short.
        await expect(lead(page, id).getByRole('link', { name: /on LinkedIn/ })).toHaveCount(1);
        await expect(lead(page, id).getByRole('button')).toHaveCount(0);
      }
      const linkedin = lead(page, 'lead-1').getByRole('link', { name: 'Open Taylor Brooks on LinkedIn' });
      await expect(linkedin).toHaveAttribute('href', 'https://www.linkedin.com/in/taylor-brooks-fixture');
      await expect(linkedin).toHaveAttribute('target', '_blank'); await expect(linkedin).toHaveAttribute('rel', /\bnoopener\b/);
      await expect(contactCard(page, 'contact-1')).toContainText('Email 1 of 3 sent');
      await expect(contactCard(page, 'contact-1')).toContainText('Email 2 due');
      await expect(contactCard(page, 'contact-2')).toContainText('Emails stopped: the banker replied.');
      await expect(contactCard(page, 'contact-2')).toContainText('Email 2 of 3 sent');
      await expect(contactCard(page, 'contact-4')).toContainText('Opted out of email');
      for (const id of ['contact-2', 'contact-3', 'contact-4']) await expect(contactCard(page, id).getByRole('button', { name: /Stop emails/ })).toHaveCount(0);
      await expectAstraControls(page, testInfo, `${width}-auto-bankers`, '#bank-drawer');
      await geometry(page);
      if (width >= 600) {
        await markShot(page, '1440-rep-found-bankers-and-emails.png', '1440 rep · found bankers, emails (fixture)', [
          [lead(page, 'lead-1').locator('.record-heading'), 'Found banker: name, title, bank, status'],
          [linkedin, 'Open on LinkedIn: a rep click, new tab'],
          [lead(page, 'lead-1').getByRole('button', { name: 'Save Taylor Brooks as a banker' }), 'Save as banker adds the person to your bankers'],
          [lead(page, 'lead-1').getByRole('button', { name: 'Taylor Brooks is not a match' }), 'Not a match sets the result aside'],
          [lead(page, 'lead-3').locator('.status-tag'), 'Reviewed rows: status, no buttons'],
          [contactCard(page, 'contact-1').locator('.email-state strong'), 'Email 1 of 3 sent, next one due'],
          [contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' }), 'Stop emails for this banker']
        ], { height: 1800 });
      } else {
        await markShot(page, `${width}-rep-found-bankers.png`, `${width} rep · found bankers (fixture)`, [
          [lead(page, 'lead-1').locator('.record-heading'), 'Found banker: name, title, bank, status'],
          [linkedin, 'Open on LinkedIn: a rep click'],
          [lead(page, 'lead-1').getByRole('button', { name: 'Save Taylor Brooks as a banker' }), 'Save as banker'],
          [lead(page, 'lead-1').getByRole('button', { name: 'Taylor Brooks is not a match' }), 'Not a match']
        ], { height: 1400 });
        await markShot(page, `${width}-rep-automatic-emails.png`, `${width} rep · automatic emails (fixture)`, [
          [contactCard(page, 'contact-1').locator('.email-state strong'), 'Email 1 of 3 sent, next one due'],
          [contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' }), 'Stop emails asks first']
        ], { height: 1400 });
      }
      // LinkedIn stays a rep click: it opens a new tab and saves nothing.
      const popupReady = page.waitForEvent('popup'); await linkedin.click(); await (await popupReady).close();
      expect(env.posts).toEqual([]);

      let reads = detailReads(env);
      await lead(page, 'lead-1').getByRole('button', { name: 'Save Taylor Brooks as a banker' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'accept_lead', account_id: 'bank-0', lead_id: 'lead-1' });
      await expect(page.locator('#drawer-message')).toHaveText('Banker saved. Connect with them on LinkedIn next.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(lead(page, 'lead-1').locator('.status-tag')).toHaveText('Saved as banker'); await expect(lead(page, 'lead-1').getByRole('button')).toHaveCount(0);
      await expect(page.locator('#contact-list')).toContainText('Taylor Brooks');
      await expect(page.locator('[data-section="contacts"]')).toHaveText('Bankers · 1 found');
      await expect(lead(page, 'lead-1').getByRole('link', { name: 'Open Taylor Brooks on LinkedIn' })).toBeFocused();

      reads = detailReads(env);
      await lead(page, 'lead-2').getByRole('button', { name: 'Dana Ruiz is not a match' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'dismiss_lead', account_id: 'bank-0', lead_id: 'lead-2' });
      await expect(page.locator('#drawer-message')).toHaveText('Marked not a match.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(lead(page, 'lead-2').locator('.status-tag')).toHaveText('Not a match'); await expect(lead(page, 'lead-2').getByRole('button')).toHaveCount(0);
      await expect(page.locator('[data-section="contacts"]')).toHaveText('Bankers');
      await expect(page.locator('#detail-contacts')).toContainText('Every found banker is reviewed.');

      // Stopping cannot be undone: it asks first, names the result, and "Cancel" sends nothing.
      const postsBefore = env.posts.length;
      let ask = null;
      page.once('dialog', dialog => { ask = { type: dialog.type(), message: dialog.message() }; return dialog.dismiss(); });
      await contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' }).click();
      await expect.poll(() => ask).toEqual({ type: 'confirm', message: 'Stop automatic emails to Avery Lane? The emails not sent yet will never go out. This cannot be undone.' });
      await expect(contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' })).toBeEnabled();
      expect(env.posts.length).toBe(postsBefore);
      reads = detailReads(env);
      page.once('dialog', dialog => dialog.accept());
      await contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'stop_emails', account_id: 'bank-0', contact_id: 'contact-1' });
      await expect(page.locator('#drawer-message')).toHaveText('Automatic emails stopped for this banker.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(contactCard(page, 'contact-1')).toContainText('Emails stopped by staff.');
      await expect(contactCard(page, 'contact-1').getByRole('button', { name: /Stop emails/ })).toHaveCount(0);
      await expect.poll(() => env.reads.filter(r => !r.id && !r.view).length).toBeGreaterThan(1); // The queue refreshed too.

      await page.locator('[data-section="history"]').click();
      const history = page.locator('#detail-history .saved-record');
      await expect(history.filter({ hasText: 'auto_email_step_1' }).locator('.caption').first()).toContainText('email · Fundhub automation');
      await expect(history.filter({ hasText: 'bankers_found' }).locator('.caption').first()).toContainText('linkedin · Fundhub automation');
      await expect(history.filter({ hasText: 'contact_saved' }).locator('.caption').first()).toContainText('linkedin · Casey Reed');
      await expect(page.locator('#detail-history')).not.toContainText('Team member');
      expect(env.posts).toHaveLength(3);
    });

    test(`${width}px rep: banker replies apply facts, set aside and mark done with exact bodies`, async ({ page }, testInfo) => {
      const env = await fixture(page, { automation: true });
      await openAutomationBank(page);
      await page.locator('[data-section="replies"]').click();
      await expect(page.locator('#reply-list [data-reply]')).toHaveCount(3);
      const jordan = reply(page, 'reply-1');
      await expect(jordan).toContainText('Re: Business clients for Mesa Community Bank');
      await expect(jordan).toContainText('From jordan.pike@bank.example');
      await expect(jordan.locator('.record-heading time')).toHaveAttribute('title', /Arizona$/);
      await expect(jordan.locator('.record-heading .status-tag')).toHaveText('Needs you');
      await expect(jordan).toContainText('Sent product facts · Read by AI in practice mode');
      await expect(jordan).toContainText('Banker shared business card rules and an application link.');
      const body = jordan.locator('.reply-body').first();
      await expect(body).toHaveText(/^Hi Casey,\nWe approve business cards from a 680 score with 2 years in business\.\nWe pull Experian only\./, { useInnerText: true });
      await expect(body).toContainText('<b>Not markup</b>'); await expect(body.locator('b')).toHaveCount(0);
      const fact = label => jordan.locator('.record-facts dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('+ dd');
      await expect(fact('Minimum score')).toHaveText('680'); await expect(fact('Minimum years in business')).toHaveText('2');
      await expect(fact('Bureaus pulled')).toHaveText('EX'); await expect(fact('Online application URL')).toHaveText('https://bank.example/business-card');
      await expect(jordan.locator('.record-facts dt')).toHaveCount(4);
      await expect(jordan.locator('.reply-draft')).toContainText('What Fundhub would send');
      await expect(jordan.locator('.reply-draft')).toContainText('Practice mode is on, so Fundhub sends nothing.');
      await expect(jordan.locator('.reply-draft .reply-body')).toHaveText(/^Thanks, Jordan\.\n1\. What minimum yearly revenue/, { useInnerText: true });
      await expect(jordan.getByLabel('Product name')).toBeVisible(); await expect(jordan.getByLabel('Product category')).toBeVisible();
      const stop = reply(page, 'reply-3');
      await expect(stop.locator('.record-heading .status-tag')).toHaveText('Done'); await expect(stop).toContainText('Asked to stop · Read by rules');
      await expect(stop.getByRole('button')).toHaveCount(0);
      await expectAstraControls(page, testInfo, `${width}-auto-replies`, '#bank-drawer');
      await geometry(page);
      if (width >= 600) {
        await markShot(page, '1440-rep-banker-reply.png', '1440 rep · banker reply (fictional fixture)', [
          [jordan.locator('.record-heading'), 'Reply: subject, sender, time, status'],
          [body, 'Banker message, escaped, line breaks kept'],
          [jordan.locator('.reply-facts'), 'Suggested facts from the reply'],
          [jordan.locator('.reply-draft'), 'What Fundhub would send, and why not'],
          [jordan.getByLabel('Product name'), 'Product name the banker left out'],
          [jordan.getByLabel('Product category'), 'Product category the banker left out'],
          [jordan.getByRole('button', { name: 'Apply facts' }), 'Apply facts makes a product draft'],
          [jordan.getByRole('button', { name: 'Set aside' }), 'Set aside the suggested facts'],
          [jordan.getByRole('button', { name: 'Mark done' }), 'Mark the reply done']
        ], { height: 1800 });
      } else {
        await markShot(page, `${width}-rep-banker-reply.png`, `${width} rep · banker reply (fixture)`, [
          [jordan.locator('.record-heading'), 'Reply: subject, sender, time, status'],
          [body, 'Banker message, escaped'],
          [jordan.locator('.reply-facts'), 'Suggested facts']
        ], { height: 1600 });
        await markShot(page, `${width}-rep-banker-reply-actions.png`, `${width} rep · reply actions (fixture)`, [
          [jordan.getByLabel('Product name'), 'Product name'],
          [jordan.getByLabel('Product category'), 'Product category'],
          [jordan.getByRole('button', { name: 'Apply facts' }), 'Apply facts'],
          [jordan.getByRole('button', { name: 'Set aside' }), 'Set aside'],
          [jordan.getByRole('button', { name: 'Mark done' }), 'Mark done']
        ], { height: 1400 });
      }

      let reads = detailReads(env);
      await jordan.getByLabel('Product name').fill('Business rewards card'); await jordan.getByLabel('Product category').selectOption('OnlineBizCC');
      await jordan.getByRole('button', { name: 'Apply facts' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'apply_reply_suggestion', account_id: 'bank-0', reply_id: 'reply-1', product_name: 'Business rewards card', lender_table: 'OnlineBizCC' });
      await expect(page.locator('#drawer-message')).toHaveText('Facts saved as a product draft. A manager verifies them before they reach Lenders.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(jordan.locator('.record-heading .status-tag')).toHaveText('Done');
      await expect(jordan).toContainText('Facts applied to a product draft.');
      await expect(jordan.getByRole('button')).toHaveCount(0); await expect(jordan.locator('form')).toHaveCount(0);
      await expect(page.locator('[data-section="replies"]')).toHaveText('Replies · 1');

      const morgan = reply(page, 'reply-2');
      await expect(morgan.locator('[name="product_name"],[name="lender_table"]')).toHaveCount(0); // The banker named the product.
      reads = detailReads(env);
      await morgan.getByRole('button', { name: 'Set aside' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'dismiss_reply_suggestion', account_id: 'bank-0', reply_id: 'reply-2' });
      await expect(page.locator('#drawer-message')).toHaveText('Suggested facts set aside.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(morgan).toContainText('Facts set aside.');
      await expect(morgan.getByRole('button', { name: 'Apply facts' })).toHaveCount(0);
      await expect(morgan.locator('.record-heading .status-tag')).toHaveText('Needs you');

      reads = detailReads(env);
      await morgan.getByRole('button', { name: 'Mark done' }).click();
      await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'mark_reply_handled', account_id: 'bank-0', reply_id: 'reply-2' });
      await expect(page.locator('#drawer-message')).toHaveText('Reply marked done.');
      expect(detailReads(env)).toBe(reads + 1);
      await expect(morgan.locator('.record-heading .status-tag')).toHaveText('Done'); await expect(morgan.getByRole('button')).toHaveCount(0);
      await expect(page.locator('[data-section="replies"]')).toHaveText('Replies');

      await page.locator('[data-section="products"]').click();
      await expect(page.locator('#product-list')).toContainText('Business rewards card');
      await expect(page.locator('#product-list')).toContainText('Needs verification');
      expect(env.posts).toHaveLength(3);
    });

    test(`${width}px manager: automation panel shows search, email and reply status`, async ({ page }, testInfo) => {
      const env = await fixture(page, { manager: true, automation: true });
      await expect(page.locator('#team-section')).toBeVisible();
      await page.locator('#automation-view').click();
      await expect(page.locator('#automation-view')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('#team-section')).toBeHidden(); await expect(page.locator('#queue-section')).toBeHidden();
      await expect.poll(() => env.reads.filter(r => r.view === 'automation').length).toBe(1);
      const group = id => page.locator(`#automation-content [aria-labelledby="${id}"]`);
      const value = (id, label) => group(id).locator('dt').filter({ hasText: new RegExp(`^${label}$`) }).locator('+ dd');
      await expect(group('automation-search').locator('h3')).toHaveText('Banker search On');
      await expect(value('automation-search', 'Searches today')).toHaveText('12 of 80');
      await expect(value('automation-search', 'Banks never searched')).toHaveText('9 of 27');
      await expect(group('automation-search').getByRole('link')).toHaveCount(0);
      // Settings saved but only 3 of 7 emails approved: it is not "On".
      await expect(group('automation-email').locator('h3')).toHaveText('Automatic emails Waiting on copy');
      await expect(value('automation-email', 'Email copy approved')).toHaveText('3 of 7');
      await expect(group('automation-email')).toContainText('Only approved emails go out. 3 of 7 are approved.');
      await expect(value('automation-email', 'Sent today')).toHaveText('1 of 40');
      await expect(value('automation-email', 'Bankers getting emails')).toContainText('1 active');
      await expect(value('automation-email', 'Bankers getting emails').locator('.caption')).toHaveText('4 started in all');
      await expect(value('automation-email', 'Send window')).toHaveText('Open now');
      await expect(value('automation-replies', 'Mode')).toHaveText('Practice');
      await expect(value('automation-replies', 'Waiting to be read')).toHaveText('0');
      await expect(value('automation-replies', 'Need a person')).toHaveText('2');
      await expect(group('automation-replies')).toContainText('It sends nothing.');
      await expect(page.locator('.automation-empty')).toHaveCount(0);
      await expect(page.locator('#replies-waiting')).toHaveText('5');
      await geometry(page);
      await expectAstraControls(page, testInfo, `${width}-auto-panel`, '#outreach-main');
      if (width >= 600) {
        await markShot(page, '1440-manager-automation.png', '1440 manager · automation (fixture)', [
          [page.locator('#automation-view'), 'Automation view: managers only'],
          [group('automation-search'), 'Banker search: on/off, today vs cap, never searched'],
          [group('automation-email'), 'Automatic emails: copy, sent today, window'],
          [group('automation-replies'), 'Reply reading: mode, waiting, needs a person']
        ], { height: 1300 });
      } else {
        await markShot(page, `${width}-manager-automation.png`, `${width} manager · automation (fixture)`, [
          [page.locator('#automation-view'), 'Automation view: managers only'],
          [group('automation-search'), 'Banker search'],
          [group('automation-email'), 'Automatic emails: waiting on copy'],
          [group('automation-replies'), 'Reply reading']
        ], { height: 2400 });
      }
      await page.locator('#queue-view').click();
      await expect(page.locator('#automation-section')).toBeHidden(); await expect(page.locator('#queue-rows tr')).toHaveCount(25);
      expect(env.posts).toEqual([]);
    });

    test(`${width}px rep never sees the automation control and never reads it`, async ({ page }) => {
      const env = await fixture(page, { automation: true });
      await expect(page.locator('#queue-rows tr')).toHaveCount(25);
      await expect(page.locator('#view-switch')).toBeHidden(); await expect(page.locator('#automation-view')).toBeHidden(); await expect(page.locator('#automation-section')).toBeHidden();
      await openAutomationBank(page); await page.locator('#drawer-close').click();
      await expect(page.locator('#automation-section')).toBeHidden();
      expect(env.reads.filter(r => r.view)).toEqual([]);
    });

    test(`${width}px manager automation panel: loading, failed read with retry, then full`, async ({ page }) => {
      const env = await fixture(page, { manager: true, automation: true });
      const open = env.hold('automation');
      await page.locator('#automation-view').click();
      await expect(page.locator('#automation-content .skeleton')).toHaveCount(2);
      await expect(page.locator('#automation-content')).toContainText('Loading automation status…');
      await expect(page.locator('#automation-content')).toHaveAttribute('aria-busy', 'true');
      await geometry(page);
      env.faults.automation = true; open();
      await expect(page.locator('#automation-content')).toContainText('Automation status could not load');
      await expect(page.locator('#automation-content')).toHaveAttribute('aria-busy', 'false');
      await geometry(page);
      env.faults.automation = false; await page.locator('#automation-retry').click();
      await expect(page.locator('#automation-content [aria-labelledby="automation-search"]')).toContainText('12 of 80');
      expect(env.reads.filter(r => r.view === 'automation')).toHaveLength(2);
    });
  });
}

test('the email status says On only when the settings are saved and all 7 emails are approved', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await fixture(page, { manager: true, automation: true, autoConfig: 'approved' });
  await page.locator('#automation-view').click();
  const email = page.locator('[aria-labelledby="automation-email"]');
  await expect(email.locator('h3')).toHaveText('Automatic emails On');
  await expect(email.locator('dt').filter({ hasText: /^Email copy approved$/ }).locator('+ dd')).toHaveText('7 of 7');
  await expect(email).not.toContainText('Only approved emails go out');
  await expect(email).not.toContainText('No email goes out');
  await geometry(page);
});

test('390px manager automation panel names missing settings in plain words and links the search sign-up', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await fixture(page, { manager: true, automation: true, autoConfig: 'unset' });
  await page.locator('#automation-view').click();
  const search = page.locator('[aria-labelledby="automation-search"]'), email = page.locator('[aria-labelledby="automation-email"]'), replies = page.locator('[aria-labelledby="automation-replies"]');
  await expect(search.locator('h3')).toHaveText('Banker search Off');
  await expect(search).toContainText('Search is off. It starts when the search key is saved.');
  const signup = search.getByRole('link', { name: 'Get a search key at serper.dev' });
  await expect(signup).toHaveAttribute('href', 'https://serper.dev/'); await expect(signup).toHaveAttribute('target', '_blank'); await expect(signup).toHaveAttribute('rel', /\bnoopener\b/);
  await expect(email.locator('h3')).toHaveText('Automatic emails Off');
  await expect(email).toContainText('Email is off until these settings are saved: From address and Mailing address for the email footer.');
  await expect(email).not.toContainText('BANK_OUTREACH');
  await expect(email).toContainText('No email goes out until the email copy is approved.');
  await expect(email.locator('dt').filter({ hasText: /^Send window$/ }).locator('+ dd')).toHaveText('Closed now');
  await expect(replies.locator('dt').filter({ hasText: /^Mode$/ }).locator('+ dd')).toHaveText('Rules only');
  await expect(replies).toContainText('A person reads every other reply.');
  await geometry(page);
});

test('manager automation panel empty state offers the import and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await fixture(page, { manager: true, automation: true, state: 'empty' });
  await page.locator('#automation-view').click();
  await expect(page.locator('.automation-empty')).toContainText('No banks to work yet.');
  await expect(page.locator('[aria-labelledby="automation-search"] dt').filter({ hasText: /^Banks never searched$/ }).locator('+ dd')).toHaveText('0 of 0');
  await page.locator('#automation-import').click(); await expect(page.locator('#import-dialog')).toBeVisible();
  await page.locator('#import-close').click(); await expect(page.locator('#automation-import')).toBeFocused();
  await geometry(page);
});

test('state filter offers every program state and the import note follows the program', async ({ page }) => {
  const env = await fixture(page, { manager: true });
  await page.locator('#queue-view').click(); await expect(page.locator('#queue-rows tr')).toHaveCount(25);
  expect(STATE_CODES).toHaveLength(56);
  await expect(page.locator('#state option')).toHaveCount(57);
  expect(await page.locator('#state option').evaluateAll(options => options.map(o => o.value))).toEqual(['', ...STATE_CODES]);
  await expect(page.locator('#state option').first()).toHaveText('All states');
  await page.locator('#state').selectOption('TX'); await expect.poll(() => env.reads.at(-1)).toMatchObject({ state: 'TX', offset: '0' });
  await expect(page.locator('#state')).toHaveValue('TX'); // The repaint after the read keeps the choice.
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect.poll(() => env.reads.at(-1)).toMatchObject({ state: '' });
  await page.locator('#import-open').click();
  await expect(page.locator('#import-dialog')).toContainText('Load FDIC banks or NCUA credit unions in all 56 states and territories in this program.');
  await expect(page.locator('#import-dialog')).not.toContainText('AZ, SC, FL and CA');
});

test('a four-state program lists its own states in the filter and the import note', async ({ page }) => {
  await fixture(page, { manager: true, states: ['AZ', 'SC', 'FL', 'CA'] });
  await page.locator('#queue-view').click(); await expect(page.locator('#queue-rows tr')).toHaveCount(25);
  expect(await page.locator('#state option').evaluateAll(options => options.map(o => o.value))).toEqual(['', 'AZ', 'SC', 'FL', 'CA']);
  await page.locator('#import-open').click();
  await expect(page.locator('#import-dialog')).toContainText('Load FDIC banks or NCUA credit unions in AZ, SC, FL and CA.');
});

test('apply facts sends no product fields when the banker named them; a conflict shows the saved state', async ({ page }) => {
  const env = await fixture(page, { automation: true });
  await openAutomationBank(page); await page.locator('[data-section="replies"]').click();
  await reply(page, 'reply-2').getByRole('button', { name: 'Apply facts' }).click();
  await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'apply_reply_suggestion', account_id: 'bank-0', reply_id: 'reply-2' });
  await expect(reply(page, 'reply-2')).toContainText('Facts applied to a product draft.');
  await page.locator('[data-section="products"]').click(); await expect(page.locator('#product-list')).toContainText('Business Platinum Card');
  await expect(page.locator('#product-list')).toContainText('Business card · online');

  env.faults.conflict = 'accept_lead';
  await page.locator('[data-section="contacts"]').click();
  const reads = detailReads(env);
  await lead(page, 'lead-1').getByRole('button', { name: 'Save Taylor Brooks as a banker' }).click();
  await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'accept_lead', account_id: 'bank-0', lead_id: 'lead-1' });
  await expect(page.locator('#drawer-message')).toHaveText('This found banker was already reviewed');
  await expect(page.locator('#drawer-message')).toHaveClass(/error/);
  expect(detailReads(env)).toBe(reads + 1);
  await expect(lead(page, 'lead-1').locator('.status-tag')).toHaveText('Saved as banker'); await expect(lead(page, 'lead-1').getByRole('button')).toHaveCount(0);

  env.faults.conflict = 'dismiss_reply_suggestion';
  await page.locator('[data-section="replies"]').click();
  await reply(page, 'reply-1').getByRole('button', { name: 'Set aside' }).click();
  await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'dismiss_reply_suggestion', account_id: 'bank-0', reply_id: 'reply-1' });
  await expect(page.locator('#drawer-message')).toHaveText('This reply has no facts waiting');
  await expect(reply(page, 'reply-1')).toContainText('Facts set aside.');
});

test('a failed apply or stop keeps the card, the typed product name and category', async ({ page }) => {
  const env = await fixture(page, { automation: true, failWrite: true });
  await openAutomationBank(page); await page.locator('[data-section="replies"]').click();
  const jordan = reply(page, 'reply-1');
  await jordan.getByLabel('Product name').fill('Business rewards card'); await jordan.getByLabel('Product category').selectOption('OnlineBizCC');
  const reads = detailReads(env);
  await jordan.getByRole('button', { name: 'Apply facts' }).click();
  await expect(page.locator('#drawer-message')).toContainText('Save failed');
  expect(env.posts).toEqual([{ action: 'apply_reply_suggestion', account_id: 'bank-0', reply_id: 'reply-1', product_name: 'Business rewards card', lender_table: 'OnlineBizCC' }]);
  expect(detailReads(env)).toBe(reads);
  await expect(jordan.getByLabel('Product name')).toHaveValue('Business rewards card'); await expect(jordan.getByLabel('Product category')).toHaveValue('OnlineBizCC');
  await expect(jordan.getByRole('button', { name: 'Apply facts' })).toBeEnabled();
  await page.locator('[data-section="contacts"]').click();
  page.once('dialog', dialog => dialog.accept());
  await contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' }).click();
  await expect(page.locator('#drawer-message')).toContainText('Save failed');
  await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'stop_emails', account_id: 'bank-0', contact_id: 'contact-1' });
  await expect(contactCard(page, 'contact-1')).toContainText('Email 1 of 3 sent');
  await expect(contactCard(page, 'contact-1').getByRole('button', { name: 'Stop emails to Avery Lane' })).toBeEnabled();
});
