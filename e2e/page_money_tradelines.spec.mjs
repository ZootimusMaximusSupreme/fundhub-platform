// Finance OS → Accounts → "What you have" (wave 4, unit TL): every account on
// the reports, in Plaid or added by the client, Personal and per business, with
// where each came from and the banks they already use. An account is added in
// the Accounts section's one "Add an account" form, by "Just record it" (patch 6),
// and What you have reloads.
// The real page in a real browser, clicked like a person, at 1440, 390 and 320.
// Every /api answer is fake: the inventory is the server's own tradelineView()
// output over sample rows (src/http/fixtures/money-tradelines.sample.json).
// No database, no network, no live data.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { withSession, json, trackErrors } from './harness.mjs';

const evidence = 'ops/workflows/build-evidence/tl-tradelines-2026-11-07';
const FIXTURE = JSON.parse(fs.readFileSync('src/http/fixtures/money-tradelines.sample.json', 'utf8'));
const copy = () => JSON.parse(JSON.stringify(FIXTURE));

/* What the server answers after the save: the same view with the new row. */
function afterSave(body) {
  const d = copy();
  const g = d.groups.find((x) => x.key === body.belongs_to) || d.groups[0];
  g.items.push({
    id: 'entry:new', name: body.product || body.creditor, bank: 'Bank of America', bank_key: 'bank_of_america', in_book: false,
    creditor: body.creditor, type: 'card', type_words: 'Credit card', limit_cents: 600000, opened: body.opened || null,
    status: 'open', authorized_user: false, sources: ['you'], source_words: ['Added by you'], bureaus: [],
    existing_relationship: false, logo: '/assets/lenders/bank-of-america.png', logo_source: 'bank_book'
  });
  return { ok: true, action: 'add_tradeline', entry_id: 'entry-new', ...d };
}

/* inventory: 'full' | 'empty' | 'fail-then-full' */
async function open(page, { inventory = 'full', posts = [] } = {}) {
  let failed = false;
  /* After a save the server's view carries the new row; What you have reloads it. */
  let saved = null;
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { role: 'client', name: 'Alex Sample' } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/accounts' && req.method() === 'GET' && url.searchParams.get('view') === 'tradelines') {
      if (inventory === 'fail-then-full' && !failed) { failed = true; return json(route, { ok: false, error: 'server_error' }, 500); }
      if (inventory === 'empty') {
        return json(route, { ...copy(), groups: [{ key: 'personal', kind: 'personal', name: 'Personal', items: [], closed: 0 }], relationships: [] });
      }
      return json(route, saved ? JSON.parse(JSON.stringify(saved)) : copy());
    }
    if (path === '/api/money/accounts' && req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      if (body.action === 'add_tradeline') { saved = afterSave(body); return json(route, saved, 201); }
      return json(route, { ok: false, error: 'sample_read_only' }, 409);
    }
    if (req.method() !== 'GET') return json(route, { ok: false, error: 'sample_read_only' }, 409);
    return json(route, bundle.reads[path] || { ok: true, items: [] });
  });
  await page.goto('/app/financeos.html#accounts');
}

/* Nothing sideways, nothing clipped, nothing hanging off the card or the page. */
async function checkFit(page) {
  const out = await page.evaluate(() => {
    const card = document.querySelector('.fh-tl');
    const box = card.getBoundingClientRect();
    const bad = [];
    for (const el of card.querySelectorAll('*')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)}`);
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') bad.push(`scrolls: ${el.tagName}.${el.className}`);
    }
    return { pageFits: document.documentElement.scrollWidth <= innerWidth, cardRight: box.right, width: innerWidth, bad };
  });
  expect(out.pageFits, 'no sideways page scroll').toBe(true);
  expect(out.cardRight).toBeLessThanOrEqual(out.width);
  expect(out.bad, 'every part sits inside the card').toEqual([]);
}

/* Every visible control in the card is at least 44 by 44. */
async function checkTargets(page) {
  const small = await page.evaluate(() => [...document.querySelectorAll('.fh-tl :is(button,input,select,a[href])')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => { const r = el.getBoundingClientRect(); return { n: el.name || el.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.w < 44 || x.h < 44));
  expect(small, 'controls under 44x44').toEqual([]);
}

/* The Accounts section's one add form: nothing outside its card, no sideways
   scroll, and every visible control at least 44 by 44 (a radio by its label). */
async function checkForm(page) {
  const out = await page.evaluate(() => {
    const card = document.querySelector('#add-account');
    const box = card.getBoundingClientRect();
    const bad = [];
    for (const el of card.querySelectorAll('*')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)}`);
    }
    const small = [...card.querySelectorAll('summary,button,input,select,a[href]')]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => (el.matches('input[type=radio],input[type=checkbox]') && el.closest('label')) || el)
      .map((el) => { const r = el.getBoundingClientRect(); return { n: el.name || el.textContent.trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; })
      .filter((x) => x.w < 44 || x.h < 44);
    return { pageFits: document.documentElement.scrollWidth <= innerWidth, bad, small };
  });
  expect(out.pageFits, 'no sideways page scroll').toBe(true);
  expect(out.bad, 'every part of the add form sits inside its card').toEqual([]);
  expect(out.small, 'add form controls under 44x44').toEqual([]);
}

/* A picture of one part, whole, with the phone's fixed bottom bar kept clear
   of it: the window is made tall enough for the part, then put back. */
async function partShot(page, target, file) {
  const vp = page.viewportSize();
  const tall = Math.ceil((await target.boundingBox()).height) + 240;
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, Math.min(tall, 4000)) });
  await target.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16); });
  const box = await target.boundingBox();
  await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(box.width + 8, vp.width - Math.max(0, box.x - 4)), height: box.height + 8 } });
  await page.setViewportSize(vp);
}

/* On a phone the bottom bar is fixed. Scrolled to the end, the last thing in
   the card sits above it, never under it. */
async function clearOfBottomBar(page, selector) {
  const out = await page.evaluate((sel) => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const all = document.querySelectorAll(sel);
    const last = all[all.length - 1].getBoundingClientRect();
    /* On a wide screen the same nav is the left sidebar; only a bar along the
       bottom can cover the card's end. */
    const nav = document.querySelector('.client-ios-nav');
    const r = nav ? nav.getBoundingClientRect() : null;
    const navTop = r && getComputedStyle(nav).position === 'fixed' && r.top > innerHeight / 2 ? r.top : innerHeight;
    return { bottom: last.bottom, navTop };
  }, selector);
  expect(out.bottom, `${selector} ends above the bottom bar`).toBeLessThanOrEqual(out.navTop);
}

/* Review evidence, marked: a numbered red box on each named part and a legend
   (.ai/rules/audit-screenshot-markups.md). The marks are removed after. */
async function markedShot(page, file, marks) {
  await page.evaluate((marks) => {
    const first = document.querySelector(marks[0].selector);
    first.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -150);
    const layer = document.createElement('div');
    layer.id = 'tl-proof-marks';
    marks.forEach((m, i) => {
      const r = document.querySelector(m.selector).getBoundingClientRect();
      const box = document.createElement('div');
      Object.assign(box.style, { position: 'absolute', left: r.left + scrollX - 4 + 'px', top: r.top + scrollY - 4 + 'px', width: r.width + 8 + 'px',
        height: r.height + 8 + 'px', border: '3px solid #d02525', borderRadius: '8px', pointerEvents: 'none', zIndex: 150 });
      const n = document.createElement('span');
      n.textContent = String(i + 1);
      Object.assign(n.style, { position: 'absolute', right: '-14px', top: '-14px', width: '26px', height: '26px', borderRadius: '13px', background: '#d02525',
        color: '#fff', font: '700 14px/26px Arial,sans-serif', textAlign: 'center' });
      box.appendChild(n);
      layer.appendChild(box);
    });
    const legend = document.createElement('ol');
    Object.assign(legend.style, { position: 'fixed', left: '8px', top: '8px', maxWidth: 'min(420px, calc(100vw - 16px))', margin: 0, padding: '8px 8px 8px 28px',
      background: '#fff', border: '2px solid #d02525', borderRadius: '8px', font: '600 13px/1.4 Arial,sans-serif', color: '#111', zIndex: 151 });
    /* The page resets list numbers, so each line carries its own. */
    legend.style.paddingLeft = '8px';
    marks.forEach((m, i) => { const li = document.createElement('li'); li.textContent = `${i + 1}. ${m.caption}`; legend.appendChild(li); });
    layer.appendChild(legend);
    document.body.appendChild(layer);
  }, marks);
  await page.screenshot({ path: file, fullPage: false });
  await page.locator('#tl-proof-marks').evaluate((el) => el.remove());
}

async function checkLogos(page) {
  const logos = page.locator('.fh-tl img.fh-bank-logo');
  const n = await logos.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const img = logos.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0), { message: 'logo loads' }).toBe(true);
  }
}

for (const width of [1440, 390, 320]) {
  test(`What you have: grouped, sourced, and Add an account, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const posts = [];
    await open(page, { posts });

    const card = page.locator('.fh-tl');
    await expect(card.locator('h2')).toHaveText('What you have');
    await expect(card.locator('.tl-group h3')).toHaveText(['Personal', 'Sample Studio LLC', 'Sample Rentals LLC', 'Not sorted yet']);
    /* Banks you use: each one an existing relationship. */
    await expect(card.locator('.tl-bank .tl-name')).toHaveText(['American Express', 'Chase', 'Navy Federal Credit Union', 'Truist']);
    await expect(card.locator('.tl-bank .tl-chip.is-rel')).toHaveCount(4);
    /* The Chase card from the report and Plaid is one row with both chips. */
    const freedom = card.locator('.tl-row', { hasText: 'Chase Freedom Unlimited' });
    await expect(freedom).toHaveCount(1);
    await expect(freedom.locator('.tl-chip')).toHaveText(['Report', 'Plaid']);
    await expect(freedom.locator('.tl-cap')).toHaveText('Credit card · Chase · Limit $8,000 · Opened Apr 2019');
    await expect(card.locator('.tl-row', { hasText: 'Ink Unlimited' }).locator('.tl-chip')).toHaveText(['Added by you']);
    await expect(card.locator('.tl-row', { hasText: 'Capital One' }).locator('img')).toHaveCount(0);
    await checkLogos(page);
    await checkFit(page);
    await checkTargets(page);
    await clearOfBottomBar(page, '.fh-tl .tl-row');
    await partShot(page, card, `${evidence}/accounts-what-you-have-${width}.png`);
    await markedShot(page, `${evidence}/marked-accounts-what-you-have-${width}.png`, [
      { selector: '.fh-tl .tl-banks', caption: 'Banks you use: each one an Existing relationship' },
      { selector: '.fh-tl .tl-group[data-group="personal"] .tl-row', caption: 'One card from the report and Plaid: one row, two chips' }
    ]);

    /* What you have has no add button of its own: there is one add form. */
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(page.locator('#fos-accounts form[data-form="add_account"]')).toHaveCount(1);

    /* Add an account, like a person: the Accounts section's Add account opens the one form. */
    const accounts = page.locator('#fos-accounts');
    const opener = accounts.getByRole('button', { name: 'Add account', exact: true });
    await opener.click();
    const form = page.locator('#add-account');
    await expect(form).toHaveAttribute('open', '');
    await expect(form.locator('summary')).toHaveText('Add an account');
    const track = form.getByRole('radio', { name: 'Track the balance' });
    const record = form.getByRole('radio', { name: 'Just record it' });
    await expect(track).toBeChecked();
    await expect(page.locator('#na-name')).toBeVisible();
    await expect(page.locator('#na-creditor')).toBeHidden();
    await checkForm(page);
    await partShot(page, form, `${evidence}/accounts-add-track-${width}.png`);
    await record.check();
    await expect(form.locator('#na-mode-help')).toHaveText('It shows in What you have. No balance.');
    await expect(page.locator('#na-name')).toBeHidden();
    await expect(page.locator('#na-creditor')).toBeVisible();
    /* Leaving the bank or lender empty says so and sends nothing. */
    await form.getByRole('button', { name: 'Save account' }).click();
    await expect(form.locator('.act-msg')).toHaveText('Type the bank or lender, like Chase.');
    await expect(page.locator('#na-creditor')).toBeFocused();
    expect(posts).toEqual([]);
    await page.locator('#na-record_type').selectOption('checking');
    await expect(page.locator('#na-record_limit')).toBeHidden();
    await page.locator('#na-record_type').selectOption('credit_card');
    await expect(page.locator('#na-record_limit')).toBeVisible();
    await page.locator('#na-creditor').fill('Bank of America');
    await page.locator('#na-product').fill('Customized Cash');
    await page.locator('#na-record_limit').fill('6,000');
    await page.locator('#na-opened').fill('2024-02');
    /* The choices are What you have's own: each business, and a saved one with no box yet. */
    await expect(page.locator('#na-belongs_to option')).toHaveText(['Personal', 'Sample Studio LLC', 'Sample Rentals LLC']);
    await page.locator('#na-belongs_to').selectOption({ label: 'Sample Studio LLC' });
    await checkForm(page);
    await clearOfBottomBar(page, '#add-account .form-act .btn-primary');
    await partShot(page, form, `${evidence}/accounts-add-an-account-${width}.png`);
    await markedShot(page, `${evidence}/marked-accounts-add-an-account-${width}.png`, [
      { selector: '#add-account [data-mode="choice"]', caption: 'One add form: Track the balance or Just record it' },
      { selector: '#add-account .f[data-mode="record"]', caption: 'Just record it: bank or lender, then the card' },
      { selector: '#add-account .form-act .btn-primary', caption: 'One Save for both ways' }
    ]);
    await form.getByRole('button', { name: 'Save account' }).click();
    await expect(page.locator('#head-msg')).toHaveText('Saved. It shows in What you have.');
    expect(posts).toEqual([{ action: 'add_tradeline', creditor: 'Bank of America', product: 'Customized Cash', type: 'credit_card',
      limit: '6,000', opened: '2024-02', belongs_to: posts[0].belongs_to }]);
    expect(posts[0].belongs_to).toMatch(/^entity:/);
    await expect(page.locator('#add-account')).not.toHaveAttribute('open', '');
    /* What you have reloads after the save and shows the new row. */
    const added = card.locator('.tl-group', { hasText: 'Sample Studio LLC' }).locator('.tl-row', { hasText: 'Customized Cash' });
    await expect(added).toBeVisible();
    await expect(added.locator('.tl-chip')).toHaveText(['Added by you']);
    await checkFit(page);
    await partShot(page, card, `${evidence}/accounts-saved-${width}.png`);
    expect(posts.length).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('What you have: a read that does not know this view shows nothing, not a wrong "No accounts yet"', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await withSession(page, { staff: { role: 'client' } });
  const errors = trackErrors(page);
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { role: 'client', name: 'Alex Sample' } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    /* Like the sample demo today: the Accounts answer, whatever the view. */
    return json(route, bundle.reads[path] || { ok: true, items: [] });
  });
  await page.goto('/app/financeos.html#accounts');
  await expect(page.locator('#fos-accounts .fos-sec')).toContainText('Accounts');
  await expect.poll(() => page.evaluate(() => window.FHTradelines && document.querySelector('#fos-accounts .fos-extra') !== null)).toBe(true);
  await expect(page.locator('.fh-tl')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('What you have: empty, error, then a working retry (390)', async ({ page }) => {
  test.setTimeout(120_000);
  fs.mkdirSync(evidence, { recursive: true });
  await page.setViewportSize({ width: 390, height: 900 });
  await withSession(page, { staff: { role: 'client' } });
  const errors = trackErrors(page);
  await open(page, { inventory: 'fail-then-full' });
  const card = page.locator('.fh-tl');
  await expect(card).toContainText('We could not load your accounts.');
  await partShot(page, card, `${evidence}/accounts-error-390.png`);
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.locator('.tl-group h3').first()).toHaveText('Personal');
  expect(errors.filter((e) => !/500/.test(e))).toEqual([]);

  const page2 = await page.context().newPage();
  await page2.setViewportSize({ width: 390, height: 900 });
  await open(page2, { inventory: 'empty' });
  const empty = page2.locator('.fh-tl');
  await expect(empty).toContainText('No accounts yet');
  await expect(empty).toContainText('Add one, or connect a bank.');
  await partShot(page2, empty, `${evidence}/accounts-empty-390.png`);
});
