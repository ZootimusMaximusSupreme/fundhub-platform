// Bank logos on the three money screens (owner rule 2026-11-07): each bank shows
// its own logo — Plaid's PNG, or the bank book's file — and a bank with no logo
// shows its name only. Sample data only; every /api call is answered here.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PLAID_LOGO = `data:image/png;base64,${PNG}`;
const SHOTS = process.env.BANK_LOGO_SHOTS || '';
const banksFixture = JSON.parse(fs.readFileSync('src/http/fixtures/money-banks.sample.json', 'utf8'));
const connectionsFixture = JSON.parse(fs.readFileSync('src/http/fixtures/money-connections.sample.json', 'utf8'));

const ME = 'aaaaaaaa-0000-0000-0000-000000000001';
const accountsView = {
  ok: true,
  client_id: '11111111-2222-3333-4444-555555555555',
  containers: [{
    id: ME, kind: 'personal', name: 'Alex Sample (personal)', archived_at: null, business: null,
    accounts: [
      { id: 'a1', source: 'bank_account', name: 'Total Checking', mask: '1101', type: 'depository', subtype: 'checking',
        container_id: ME, current_cents: 600000, provider: 'plaid', closed_at: null,
        institution: 'Chase', logo: PLAID_LOGO, logo_source: 'plaid' },
      { id: 'a2', source: 'bank_account', name: 'Way2Save Savings', mask: '2202', type: 'depository', subtype: 'savings',
        container_id: ME, current_cents: 150000, provider: 'plaid', closed_at: null,
        institution: 'Wells Fargo', logo: '/assets/lenders/wells-fargo.png', logo_source: 'bank_book' }
    ],
    cards: [{ id: 'c1', source: 'bank_account', name: 'Hometown Card', mask: '3303', type: 'credit', subtype: 'credit card',
      container_id: ME, current_cents: 40000, limit_cents: 500000, provider: 'manual', closed_at: null,
      institution: null, logo: null, logo_source: null }],
    loans: [], bills: []
  }],
  unassigned: { accounts: [], cards: [], loans: [], bills: [] },
  billing: { containers: 1, price_per_container_cents: null, monthly_cents: null }
};

function banksWithLogos() {
  const d = structuredClone(banksFixture);
  const book = { 'Bank of America': '/assets/lenders/bank-of-america.png', Chase: '/assets/lenders/chase.png', 'Wells Fargo': '/assets/lenders/wells-fargo.png' };
  for (const b of d.recommended_banks) Object.assign(b, book[b.name] ? { logo: book[b.name], logo_source: 'bank_book' } : { logo: null, logo_source: null });
  for (const s of d.card_stacking.items) {
    Object.assign(s, s.issuer === 'Chase' ? { logo: PLAID_LOGO, logo_source: 'plaid' }
      : s.issuer === 'American Express' ? { logo: '/assets/lenders/american-express.png', logo_source: 'bank_book' }
        : { logo: null, logo_source: null });
  }
  return d;
}

async function answer(page, path, body) {
  await page.route('**/api/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/api/auth/session') return route.fulfill({ json: { ok: true, principal: 'client' } });
    if (p === '/api/read/affiliate-portal') return route.fulfill({ json: { ok: true, enrolled: false } });
    if (p === path) return route.fulfill({ json: body });
    return route.fulfill({ status: 404, json: { ok: false } });
  });
}

/* Every logo on the page: loaded, 28x28, named for its bank, inside the screen. */
async function checkLogos(page, expectedAlts) {
  const logos = page.locator('img.fh-bank-logo');
  await expect(logos).toHaveCount(expectedAlts.length);
  for (let i = 0; i < expectedAlts.length; i++) {
    const img = logos.nth(i);
    await img.scrollIntoViewIfNeeded();
    await expect(img).toHaveAttribute('alt', expectedAlts[i]);
    await expect(img).toHaveAttribute('loading', 'lazy');
    await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    const box = await img.boundingBox();
    expect(Math.round(box.width)).toBe(28);
    expect(Math.round(box.height)).toBe(28);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const width of [1440, 390]) {
  test(`Accounts: each bank account shows its bank's logo at ${width}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await answer(page, '/api/money/accounts', accountsView);
    await page.goto('/app/money-accounts.html');
    await expect(page.locator('.acct[data-account="a1"]')).toContainText('Total Checking');
    await checkLogos(page, ['Chase logo', 'Wells Fargo logo']);
    /* No logo → the name alone, no empty box. */
    await expect(page.locator('.acct[data-account="c1"] img')).toHaveCount(0);
    await expect(page.locator('.acct[data-account="c1"]')).toContainText('Hometown Card');
    /* The logo sits beside the name on one line, not on top of it. */
    const logo = await page.locator('.acct[data-account="a1"] img.fh-bank-logo').boundingBox();
    const name = await page.locator('.acct[data-account="a1"] .acct-name').boundingBox();
    expect(logo.x + logo.width).toBeLessThanOrEqual(name.x + 1);
    expect(Math.abs((logo.y + logo.height / 2) - (name.y + name.height / 2))).toBeLessThan(14);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/accounts-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test(`Banks: each bank and card line shows its logo; a bank with none shows its name at ${width}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    const d = banksWithLogos();
    await answer(page, '/api/money/banks', d);
    await page.goto('/app/money-banks.html');
    await expect(page.locator('#banks-root')).toContainText('Chase');
    const alts = [
      ...d.recommended_banks.filter((b) => b.logo).map((b) => `${b.name} logo`),
      ...d.card_stacking.items.filter((s) => s.logo).map((s) => `${s.issuer} logo`)
    ];
    await checkLogos(page, alts);
    await expect(page.locator('article.bank[data-bank="US Bank"] img')).toHaveCount(0);
    await expect(page.locator('article.bank[data-bank="US Bank"] .bank-name')).toHaveText('US Bank');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/banks-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });

  test(`Connections: processors are not banks, so no logo is drawn and nothing breaks at ${width}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await answer(page, '/api/money/connections', connectionsFixture);
    await page.goto('/app/money-connections.html');
    await expect(page.getByRole('heading', { name: 'Month over month' })).toBeVisible();
    await expect(page.locator('img.fh-bank-logo')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/connections-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
