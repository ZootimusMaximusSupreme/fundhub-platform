// "Cancel it for me" on repeat bills (Finance OS wave 4, unit CANCEL). The
// Repeat bills card on the Strategy screen, standalone and inside FinanceOS,
// as a client and as a team member, at 1440, 390 and 320. Fictional Sample
// bills from src/http/fixtures/money-strategy-bill-cancel.sample.json; every
// /api call is answered here. Nothing is cancelled anywhere.
//
// Format check (wave 4 brief): no sideways page scroll, nothing in the card
// cut off or past its edge, every control at least 44 by 44, captions at least
// 13px. Screenshots: ops/workflows/build-evidence/finance-os-cancel-bills-2026-11-07/
// (a clean copy under _raw/, and a copy with the card boxed in red and numbered).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };

const plan = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy.sample.json', import.meta.url)));
const sample = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-strategy-bill-cancel.sample.json', import.meta.url)));
const EVIDENCE = 'ops/workflows/build-evidence/finance-os-cancel-bills-2026-11-07';
const STREAMING = 'b1000000-0000-4000-8000-000000000001';
const GYM = 'b1000000-0000-4000-8000-000000000002';
const CLEANUP = { ok: true, checked_bills: 6, window_days: 90, flags: [{
  key: 'price_jump:a:SAMPLE DESIGN SUITE:2026-10-14', kind: 'price_jump', name: 'Sample Design Suite',
  account_name: 'Sample Business Checking', account_mask: '7710', on: '2026-10-14', from_cents: 5499, to_cents: 5999,
  charges: [{ on: '2026-08-14', amount_cents: 5499 }, { on: '2026-09-14', amount_cents: 5499 }, { on: '2026-10-14', amount_cents: 5999 }] }] };
const clone = (v) => JSON.parse(JSON.stringify(v));

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

/* One fake server: GET answers the plan with the bills block; POST answers the
   two bill actions the way src/banking/bill-cancel.mjs would. */
async function server(page, { role = 'client', viewer = 'client', debts = true } = {}) {
  const s = { block: { ...clone(sample), viewer }, posts: [], billsDown: false };
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/auth/session') return json(route, { ok: true, principal: role === 'client' ? 'client' : 'staff', staff: { role } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/overview') return json(route, bundle.reads['/api/money/overview']);
    if (path !== '/api/money/strategy') return json(route, { ok: true, items: [] });
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      s.posts.push(body);
      const bill = s.block.bills.find((b) => b.id === body.bill_id);
      if (!bill) return json(route, { ok: false, error: 'bill_not_found', message: 'That bill is not on your file anymore. Reload the page.' }, 404);
      if (body.action === 'cancel_bill') bill.cancel = { state: 'requested', asked_on: '2026-11-07', cancelled_on: null, charged_again_on: null, can_ask: false };
      if (body.action === 'set_cancel_link') bill.link = { url: body.url, set_on: '2026-11-07' };
      return json(route, { ok: true, action: body.action, created: true, bill_cancel: clone(s.block) });
    }
    const base = clone(plan);
    if (!debts) base.inputs.debts = [];
    return json(route, { ...base, bill_cleanup: CLEANUP, bill_cancel: s.billsDown ? { ok: false, reason: 'read_failed' } : clone(s.block) });
  });
  return s;
}

/* The format check on the card, plus no sideways page scroll. */
async function formatCheck(page, card, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page scrolls sideways`).toBe(true);
  const out = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const bad = [];
    if (el.scrollWidth > el.clientWidth + 1) bad.push('card content wider than the card');
    for (const n of el.querySelectorAll('*')) {
      if (n.closest('[hidden]') || n.closest('details:not([open]) > :not(summary)')) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1) bad.push(`${n.tagName}.${n.className} sticks out (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)})`);
      if (n.matches('button, a, summary, input')) {
        if (r.height < 44 || r.width < 44) bad.push(`${n.tagName} "${(n.textContent || n.value || '').trim().slice(0, 30)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (n.matches('.caption, .bill-state, .warn-word') && parseFloat(getComputedStyle(n).fontSize) < 13) bad.push(`${n.className} text is ${getComputedStyle(n).fontSize}`);
    }
    /* Two rows' boxes never overlap. */
    const rows = [...el.querySelectorAll('.bill-row')].map((r) => r.getBoundingClientRect());
    for (let i = 1; i < rows.length; i++) if (rows[i].top < rows[i - 1].bottom - 1) bad.push(`row ${i} overlaps the row above`);
    return bad;
  });
  expect(out, `${label}: ${out.join('; ')}`).toEqual([]);
}

/* A clean copy, then the same picture with the card boxed in red, numbered,
   with a yellow arrow and a short caption (.ai/rules/audit-screenshot-markups.md). */
async function shots(page, name, selector, caption) {
  fs.mkdirSync(`${EVIDENCE}/_raw`, { recursive: true });
  /* From the top, so the fixed phone bar and side nav sit where a person sees
     them and not on top of the card in the stitched full-page picture. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${EVIDENCE}/_raw/${name}.png`, fullPage: true });
  await page.evaluate(({ selector, caption }) => {
    const el = document.querySelector(selector);
    const r = el.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.id = 'proof-mark';
    Object.assign(wrap.style, { position: 'absolute', left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px', border: '3px solid #d02525', borderRadius: '12px', pointerEvents: 'none', zIndex: 9999, boxSizing: 'border-box' });
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
}

for (const width of [1440, 390, 320]) {
  test(`Repeat bills, client, standalone Strategy page ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    const s = await server(page);
    await page.goto('/app/money-strategy.html');
    const card = page.locator('.bills-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Repeat bills' })).toBeVisible();
    await expect(card.locator('.bill-row')).toHaveCount(6);
    /* Below Things to check, above the debts table. */
    const order = await page.evaluate(() => ['.cleanup-card', '.bills-card', '.debts-card'].map((q) => document.querySelector(q).getBoundingClientRect().top));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    const row = (id) => card.locator(`[data-bill-row="${id}"]`);
    await expect(row(GYM)).toContainText('Requested');
    await expect(card).toContainText('Working');
    await expect(card).toContainText('Cancelled');
    await expect(card).toContainText('Charged again');
    await expect(card.getByRole('button', { name: 'Ask again to cancel Sample Music' })).toBeVisible();
    await expect(row(STREAMING).getByRole('link', { name: 'Cancel on their site' })).toHaveAttribute('href', 'https://example.com/account/cancel');
    await expect(card.locator('.bill-link-form')).toHaveCount(0);
    await formatCheck(page, card, `client ${width}`);
    await shots(page, `strategy-client-full-${width}`, '.bills-card', 'Repeat bills: Cancel it for me, with Requested / Working / Cancelled');

    /* Press it like a person. */
    const press = row(STREAMING).getByRole('button', { name: 'Cancel it for me: Sample Streaming' });
    await press.click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toEqual({ action: 'cancel_bill', bill_id: STREAMING });
    await expect(row(STREAMING).locator('.bill-state')).toHaveText('Requested');
    await expect(row(STREAMING).getByRole('button')).toHaveCount(0);
    await expect(row(STREAMING).getByRole('link', { name: 'Cancel on their site' })).toBeVisible();
    await formatCheck(page, card, `client after press ${width}`);
    await shots(page, `strategy-client-requested-${width}`, `[data-bill-row="${STREAMING}"]`, 'After the press: Requested');

    /* The read failed: the card says so; Try again brings it back. */
    s.billsDown = true;
    await page.goto('/app/money-strategy.html');
    await expect(card).toContainText('We could not load your repeat bills.');
    await expect(page.locator('.debts-card')).toBeVisible();
    await formatCheck(page, card, `error ${width}`);
    await shots(page, `strategy-client-error-${width}`, '.bills-card', 'Bills could not load: Try again');
    s.billsDown = false;
    await card.getByRole('button', { name: 'Try again' }).click();
    await expect(page.locator('.bills-card .bill-row')).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test(`Repeat bills with no cards or loans ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await server(page, { debts: false });
    await page.goto('/app/money-strategy.html');
    await expect(page.getByText('No cards or loans with a balance yet')).toBeVisible();
    const card = page.locator('.bills-card');
    await expect(card.locator('.bill-row')).toHaveCount(6);
    await formatCheck(page, card, `no debts ${width}`);
    await shots(page, `strategy-no-debts-${width}`, '.bills-card', 'No debts yet: the bills still show');
    await card.getByRole('button', { name: 'Cancel it for me: Sample Streaming' }).click();
    await expect(card.locator(`[data-bill-row="${STREAMING}"] .bill-state`)).toHaveText('Requested');
  });

  test(`Repeat bills inside FinanceOS, client and team ${width}`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'client'); });
    await server(page);
    await page.goto('/app/financeos.html#strategy');
    const card = page.locator('#fos-strategy .bills-card');
    await expect(card.locator('.bill-row')).toHaveCount(6);
    await formatCheck(page, card, `FinanceOS client ${width}`);
    await shots(page, `financeos-strategy-client-${width}`, '#fos-strategy .bills-card', 'FinanceOS Strategy: Repeat bills');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    /* A team member on the client's file saves the merchant's own cancel page. */
    await page.addInitScript(() => { localStorage.setItem('fh_role', 'owner'); });
    const s = await server(page, { role: 'owner', viewer: 'staff' });
    await page.goto('/app/financeos.html?client_id=safe-sample#strategy');
    await expect(card.locator('.bill-row')).toHaveCount(6);
    const gym = card.locator(`[data-bill-row="${GYM}"]`);
    await gym.locator('summary', { hasText: 'Their cancel link' }).click();
    await gym.getByLabel('Their cancel page').fill('https://example.com/gym/cancel');
    await formatCheck(page, card, `FinanceOS team, form open ${width}`);
    await shots(page, `financeos-strategy-team-link-${width}`, `#fos-strategy [data-bill-row="${GYM}"]`, 'Team only: save their cancel page');
    await gym.getByRole('button', { name: 'Save link' }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toEqual({ action: 'set_cancel_link', bill_id: GYM, url: 'https://example.com/gym/cancel', client_id: 'safe-sample' });
    await expect(gym.getByRole('link', { name: 'Cancel on their site' })).toHaveAttribute('href', 'https://example.com/gym/cancel');
    await formatCheck(page, card, `FinanceOS team, saved ${width}`);
    await shots(page, `financeos-strategy-team-saved-${width}`, `#fos-strategy [data-bill-row="${GYM}"]`, 'Saved: the client sees Cancel on their site');
    expect(errors).toEqual([]);
  });
}
