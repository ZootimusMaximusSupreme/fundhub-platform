// Business gas cards under each business on the Accounts tab (Finance OS wave
// 4, unit GAS): FinanceOS and the standalone page, as a client and as a team
// member, at 1440, 390 and 320. The block is built by the real back end
// (src/finance/fuel-cards.mjs buildFuelCards) from the bank book's CHEVRON row;
// the business is a fictional sample. Every /api call is answered here.
//
// Format check (wave 4 brief): no sideways page scroll, nothing in the block
// cut off or past its edge, every control at least 44 by 44 and not covered,
// captions at least 13px, inputs 16px. Screenshots:
// ops/workflows/build-evidence/finance-os-gas-cards-2026-11-07/ (a clean copy
// under _raw/, and a copy with the block boxed in red and numbered).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { buildFuelCards } from '../src/finance/fuel-cards.mjs';

const EVIDENCE = 'ops/workflows/build-evidence/finance-os-gas-cards-2026-11-07';
const BIZ = 'aaaaaaaa-0000-0000-0000-000000000002';
const ME = 'aaaaaaaa-0000-0000-0000-000000000001';
const CARD = 'f1000000-0000-4000-8000-000000000001';
const CHEVRON = {
  id: CARD, lender_id: '87d7af03-247d-4f79-8f5c-f0e1c8adc144', name: 'CHEVRON', product_name: null,
  logo_path: '/assets/lenders/chevron.png',
  application_url: 'https://www.mycardapply.com/synindex/?ecdma-lc=12456&ecid=OTHE_25940&offertype=0',
  business_bureau_pulled: 'D&B/SBFE', eligible_states: null
};
const clone = (v) => JSON.parse(JSON.stringify(v));

function accountsView({ tracked = false, viewer = 'client', empty = false } = {}) {
  const cards = tracked ? [{ id: 'c-gas', source: 'bank_account', name: 'CHEVRON', mask: '4242', type: 'credit', subtype: 'credit card',
    container_id: BIZ, current_cents: null, limit_cents: 150000, provider: 'manual', closed_at: null, due_day: 15, min_due_cents: null }] : [];
  return {
    ok: true,
    client_id: '11111111-2222-3333-4444-555555555555',
    containers: [
      { id: BIZ, kind: 'business', name: 'Sample Fuel LLC', archived_at: null,
        business: { legal_name: 'Sample Fuel LLC', dba: null, ein_last4: null, entity_type: 'llc', formation_state: 'AZ', started: '2024-02',
          industry: 'Sample delivery', address_line1: null, city: 'Phoenix', state: 'AZ', postal_code: null, phone: null, website: null },
        accounts: [], cards, loans: [], bills: [] },
      { id: ME, kind: 'personal', name: 'Sample (personal)', archived_at: null, business: null, accounts: [], cards: [], loans: [], bills: [] }
    ],
    unassigned: { accounts: [], cards: [], loans: [], bills: [] },
    billing: { containers: 2, price_per_container_cents: null, monthly_cents: null },
    fuel_cards: buildFuelCards({
      cards: empty ? [] : [CHEVRON],
      tracked: tracked ? [{ fuel_card_id: CARD, bank_account_id: 'c-gas', entity_id: BIZ, account_name: 'CHEVRON', mask: '4242', payment_due_day: 15 }] : [],
      businesses: [{ container_id: BIZ, state: 'AZ' }],
      viewer
    })
  };
}

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function server(page, { role = 'client', viewer = 'client', empty = false } = {}) {
  const s = { tracked: false, posts: [] };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/auth/session') return json(route, { ok: true, principal: role === 'client' ? 'client' : 'staff', staff: { role } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/overview') return json(route, bundle.reads['/api/money/overview']);
    if (path === '/api/money/accounts') {
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        s.posts.push(body);
        s.tracked = true;
        return json(route, { ok: true, action: body.action, account_id: 'c-gas', ...accountsView({ tracked: true, viewer, empty }) }, 201);
      }
      return json(route, clone(accountsView({ tracked: s.tracked, viewer, empty })));
    }
    return json(route, { ok: true, items: [] });
  });
  return s;
}

async function formatCheck(page, box, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page scrolls sideways`).toBe(true);
  const out = await box.evaluate((el) => {
    const r0 = el.getBoundingClientRect();
    const bad = [];
    if (el.scrollWidth > el.clientWidth + 1) bad.push('block content wider than the block');
    for (const n of el.querySelectorAll('*')) {
      if (n.closest('[hidden]') || n.closest('details:not([open]) > :not(summary)')) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < r0.left - 1 || r.right > r0.right + 1) bad.push(`${n.tagName}.${n.className} sticks out`);
      if (n.matches('button, a, summary, input') && (r.height < 44 || r.width < 44)) bad.push(`${n.tagName} "${(n.textContent || n.name || '').trim().slice(0, 24)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (n.matches('.caption, .fc-pill, label') && parseFloat(getComputedStyle(n).fontSize) < 13) bad.push(`${n.className || n.tagName} text is ${getComputedStyle(n).fontSize}`);
      if (n.matches('input') && parseFloat(getComputedStyle(n).fontSize) < 16) bad.push(`input ${n.name} is ${getComputedStyle(n).fontSize}`);
    }
    return bad;
  });
  expect(out, `${label}: ${out.join('; ')}`).toEqual([]);
  const covered = await box.evaluate((el) => {
    const bad = [];
    for (const n of el.querySelectorAll('button, a, summary, input')) {
      if (n.closest('[hidden]') || n.closest('details:not([open]) > :not(summary)')) continue;
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === n || n.contains(hit) || hit.closest('label') === n.closest('label'))) bad.push(`"${(n.textContent || n.name || '').trim().slice(0, 24)}" is covered by ${hit ? hit.tagName + '.' + hit.className : 'nothing'}`);
    }
    return bad;
  });
  expect(covered, `${label}: ${covered.join('; ')}`).toEqual([]);
}

async function shots(page, name, selector, caption) {
  fs.mkdirSync(`${EVIDENCE}/_raw`, { recursive: true });
  /* One tall window as high as the page, so the fixed phone bar and side nav
     sit where a person scrolled to the end sees them. */
  const vp = page.viewportSize();
  await page.evaluate(() => window.scrollTo(0, 0));
  const tall = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, tall) });
  await page.screenshot({ path: `${EVIDENCE}/_raw/${name}.png`, fullPage: true });
  await page.evaluate(({ selector, caption }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.id = 'proof-mark';
    Object.assign(wrap.style, { position: 'absolute', left: r.left + scrollX - 6 + 'px', top: r.top + scrollY - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px', border: '3px solid #d02525', borderRadius: '12px', pointerEvents: 'none', zIndex: 9999, boxSizing: 'border-box' });
    const dot = document.createElement('span');
    dot.textContent = '1';
    Object.assign(dot.style, { position: 'absolute', left: '-14px', top: '-14px', width: '28px', height: '28px', borderRadius: '50%', background: '#d02525', color: '#fff', font: 'bold 15px Arial,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const arrow = document.createElement('span');
    Object.assign(arrow.style, { position: 'absolute', left: '18px', top: '-26px', width: '0', height: '0', borderLeft: '10px solid transparent', borderRight: '10px solid transparent', borderTop: '18px solid #f5c400' });
    const text = document.createElement('span');
    text.textContent = '1 · ' + caption;
    Object.assign(text.style, { position: 'absolute', left: '44px', top: '-30px', padding: '2px 6px', color: '#b11c1c', background: '#fff8c5', border: '1px solid #f5c400', font: '12px Arial,sans-serif', whiteSpace: 'nowrap', maxWidth: (r.width - 50) + 'px', overflow: 'hidden', textOverflow: 'ellipsis' });
    wrap.append(dot, arrow, text);
    document.body.appendChild(wrap);
  }, { selector, caption });
  await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
  await page.locator('#proof-mark').evaluate((el) => el.remove());
  await page.setViewportSize(vp);
}

for (const width of [1440, 390, 320]) {
  test(`Business gas cards, client, FinanceOS Accounts ${width}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'client'); });
    const s = await server(page);
    await page.goto('/app/financeos.html#accounts');
    const bizCard = page.locator(`#fos-accounts section.container[data-container="${BIZ}"]`);
    const block = bizCard.locator('.fc-block');
    await expect(block).toBeVisible();
    await expect(block.getByRole('heading', { name: 'Business gas cards' })).toBeVisible();
    await expect(block.locator('.fc-name')).toHaveText('CHEVRON');
    await expect(block.locator('img.fc-logo')).toHaveAttribute('src', '/assets/lenders/chevron.png');
    await expect(block.locator('.fc-risk')).toHaveText('Miss a payment and it hurts your business credit.');
    await expect(block.getByRole('link', { name: 'Apply' })).toHaveAttribute('href', CHEVRON.application_url);
    await expect(page.locator(`#fos-accounts section.container[data-container="${ME}"] .fc-block`)).toHaveCount(0);
    await formatCheck(page, block, `client ${width}`);
    await shots(page, `financeos-accounts-gas-cards-${width}`, `#fos-accounts section.container[data-container="${BIZ}"] .fc-block`, 'Business gas cards from the bank book, with the risk line');

    /* Track it, like a person. */
    await block.locator('summary', { hasText: 'Got it? Track it' }).click();
    await block.getByLabel('Due day').fill('15');
    await block.getByLabel('Limit').fill('1500');
    await block.getByLabel('Last 4').fill('4242');
    await formatCheck(page, block, `client form open ${width}`);
    await shots(page, `financeos-accounts-gas-cards-form-${width}`, `#fos-accounts section.container[data-container="${BIZ}"] .fc-block`, 'Got it? Track it: due day, limit, last 4');
    await block.getByRole('button', { name: 'Track it' }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toEqual({ action: 'track_fuel_card', fuel_card_id: CARD, container_id: BIZ, due_day: '15', limit: '1500', last4: '4242' });
    const after = page.locator(`#fos-accounts section.container[data-container="${BIZ}"] .fc-block`);
    await expect(after.locator('.fc-pill')).toHaveText('Tracking');
    await expect(after).toContainText('····4242 · Due the 15th');
    await expect(after.locator('.fc-risk')).toBeVisible();
    await expect(page.locator(`#fos-accounts section.container[data-container="${BIZ}"] .acct`)).toContainText('CHEVRON');
    await formatCheck(page, after, `client tracked ${width}`);
    await shots(page, `financeos-accounts-gas-cards-tracked-${width}`, `#fos-accounts section.container[data-container="${BIZ}"]`, 'Tracked with the business\'s other cards');
    expect(errors).toEqual([]);
  });

  test(`Business gas cards, standalone Accounts page ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await server(page);
    await page.goto('/app/money-accounts.html');
    const block = page.locator(`section.container[data-container="${BIZ}"] .fc-block`);
    await expect(block).toBeVisible();
    await formatCheck(page, block, `standalone ${width}`);
    await shots(page, `standalone-accounts-gas-cards-${width}`, `section.container[data-container="${BIZ}"] .fc-block`, 'Standalone Accounts: business gas cards');
  });

  test(`Business gas cards, team view with an empty list ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'owner'); });
    await server(page, { role: 'owner', viewer: 'staff', empty: true });
    await page.goto('/app/financeos.html?client_id=safe-sample#accounts');
    const block = page.locator(`#fos-accounts section.container[data-container="${BIZ}"] .fc-block`);
    await expect(block).toContainText('No gas cards on the bank book list yet.');
    await formatCheck(page, block, `team empty ${width}`);
    await shots(page, `financeos-accounts-gas-cards-team-empty-${width}`, `#fos-accounts section.container[data-container="${BIZ}"] .fc-block`, 'Team view: the list is empty');
  });
}
