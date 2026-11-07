// "Pay now" / "I paid" on a card's due row (FinanceOS unit I6).
//
// Runs the real FinanceOS page (/app/financeos.html#overview) with every /api/**
// answered here: sample data only, no backend, no Plaid, no money. Checks the
// four states of the controls, the clicks a client makes (I paid → Mark as paid
// → Undo), the exact POST bodies, 44x44 targets and no sideways scroll at
// 1440 / 390 / 320. Run with E2E_PORT=43261.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { withSession, json, trackErrors } from './harness.mjs';

const evidence = 'ops/workflows/build-evidence/fos-i6-pay-now';
const CARD = 'sample-4';
const overview = structuredClone(bundle.reads['/api/money/overview']);
// The I6 contract: a card's upcoming row names its card.
overview.upcoming = overview.upcoming.map((u) => (u.type === 'card_due' ? { ...u, account_id: CARD } : u));
const DUE = overview.upcoming.find((u) => u.type === 'card_due').on;
const TODAY = '2026-11-07';

const entry = (claim = null) => ({
  account_id: CARD, name: 'Business Amex', mask: '4404', institution: 'Sample Bank', due_on: DUE, min_due_cents: 13300,
  past_due_cents: null, pay_url: 'https://www.americanexpress.com/', pay_site: 'americanexpress.com', can_check: true, claim, seen: null
});
const payNow = (claim) => ({ ok: true, as_of: `${TODAY}T12:00:00.000Z`, today: TODAY, cards: [entry(claim)] });

async function noOverflow(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label).toBe(true);
}
async function smallTargets(page) {
  return page.evaluate(() => [...document.querySelectorAll('.pay-now a, .pay-now button, .pay-now input:not([type=hidden])')]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim() || el.name, w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w < 44 || r.h < 44));
}
async function markedShot(page, name, selector, caption) {
  await page.evaluate(({ selector, caption }) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    const box = document.createElement('div'); box.id = 'proof-mark';
    Object.assign(box.style, { position: 'absolute', left: r.left + scrollX - 4 + 'px', top: r.top + scrollY - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px', border: '2px solid #d02525', pointerEvents: 'none', zIndex: 150 });
    const n = document.createElement('span'); n.textContent = '1';
    Object.assign(n.style, { position: 'absolute', left: '-14px', top: '-14px', width: '24px', height: '24px', borderRadius: '50%', border: '2px solid #d02525', background: '#fff', color: '#b11c1c', font: '700 13px/20px Arial,sans-serif', textAlign: 'center' });
    const t = document.createElement('span'); t.textContent = '1 · ' + caption;
    Object.assign(t.style, { position: 'absolute', left: '0', top: '-26px', padding: '2px 6px', color: '#111', background: '#ffe36e', font: '12px Arial,sans-serif', whiteSpace: 'nowrap' });
    box.append(n, t); document.body.append(box);
  }, { selector, caption });
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: false });
  await page.locator('#proof-mark').evaluate((el) => el.remove());
}

for (const width of [1440, 390, 320]) {
  test(`Pay now and I paid on the card due row at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    fs.mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const posts = [];
    let state = 'full';
    let claim = null;
    await page.route('**/api/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname;
      if (route.request().method() !== 'GET') {
        if (p !== '/api/money/payments') return json(route, { ok: false, error: 'sample_read_only' }, 409);
        const body = route.request().postDataJSON();
        posts.push(body);
        if (body.action === 'card_paid') {
          claim = { id: 'c1a10000-0000-4000-8000-000000000001', due_on: body.due_on, paid_on: body.paid_on, amount_cents: body.amount_cents ?? null, by: 'client', status: 'waiting', seen_on: null, seen_amount_cents: null };
          return json(route, { ok: true, action: 'card_paid', claim, pay_now: payNow(claim) });
        }
        if (body.action === 'card_paid_undo') { claim = null; return json(route, { ok: true, action: 'card_paid_undo', pay_now: payNow(null) }); }
        return json(route, { ok: false, error: 'unknown_action' }, 400);
      }
      if (p === '/api/auth/session') return json(route, { ok: true, principal: 'client', portal_sample_available: true, portal_sample: true, staff: { role: 'client', name: 'Portal Sample' } });
      if (p === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
      if (p === '/api/money/overview') return json(route, overview);
      if (p === '/api/money/payments' && u.searchParams.get('part') === 'pay_now') {
        if (state === 'loading') return; // never answers
        if (state === 'error') return json(route, { ok: false, error: 'unavailable' }, 503);
        if (state === 'empty') return json(route, { ok: true, pay_now: { ok: true, today: TODAY, cards: [] } });
        return json(route, { ok: true, pay_now: payNow(claim) });
      }
      return json(route, bundle.reads[p] || { ok: true, items: [] });
    });

    let visit = 0;
    const openRow = async () => {
      // A new query each time: the same URL with only a #hash would not reload.
      await page.goto(`/app/financeos.html?visit=${++visit}#overview`);
      await expect(page.locator('#fos-overview')).toContainText('Business Amex');
      await page.locator('#money-detail-payments > summary').click();
    };
    const slot = page.locator(`#fos-overview [data-pay-card="${CARD}"]`);

    // Loading: the row says it is checking, and nothing else is claimed.
    state = 'loading';
    await openRow();
    await expect(slot.locator('[aria-busy="true"]')).toContainText('Checking ways to pay this card');
    await page.screenshot({ path: `${evidence}/pay-now-loading-${width}.png` });

    // Error: plain words and Try again, which recovers.
    state = 'error';
    await openRow();
    await expect(slot).toContainText('We could not load the ways to pay this card');
    await page.screenshot({ path: `${evidence}/pay-now-error-${width}.png` });
    state = 'full';
    await slot.getByRole('button', { name: 'Try again' }).click();
    await expect(slot.getByRole('link', { name: /Pay now/ })).toBeVisible();

    // Empty: the server knows no such card → the box stays empty and hidden.
    state = 'empty';
    await openRow();
    await expect(slot).toBeEmpty();
    await expect(slot).toBeHidden();
    await page.screenshot({ path: `${evidence}/pay-now-empty-${width}.png` });

    // Full: Pay now is the card company's own site in a new tab; I paid opens the form.
    state = 'full';
    await openRow();
    const go = slot.getByRole('link', { name: /Pay now/ });
    await expect(go).toHaveAttribute('href', 'https://www.americanexpress.com/');
    await expect(go).toHaveAttribute('target', '_blank');
    await expect(go).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(slot).toContainText('Opens americanexpress.com. You sign in and pay there. Fundhub never moves your money.');
    expect(await smallTargets(page)).toEqual([]);
    await noOverflow(page, 'full');
    await markedShot(page, `pay-now-full-${width}-marked`, `#fos-overview [data-pay-card="${CARD}"]`, 'Pay now opens the card company; I paid saves it');

    await slot.getByRole('button', { name: /I paid/ }).click();
    const form = slot.locator('form[data-pay-form]');
    await expect(form).toBeVisible();
    await expect(form.locator('input[name="paid_on"]')).toBeFocused();
    await expect(form.locator('input[name="paid_on"]')).toHaveAttribute('max', TODAY);
    expect(await smallTargets(page)).toEqual([]);
    await noOverflow(page, 'form');
    // A bad amount is caught on the page, nothing is sent.
    await form.locator('input[name="amount"]').fill('35.555');
    await form.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(form.locator('.pay-now-err')).toHaveText('Type the amount like 35.00, or leave it blank.');
    expect(posts).toEqual([]);
    await markedShot(page, `pay-now-form-${width}-marked`, `#fos-overview [data-pay-card="${CARD}"] form`, 'Day you paid and an optional amount');
    // Cancel closes it and puts focus back on I paid.
    await form.getByRole('button', { name: 'Cancel' }).click();
    await expect(form).toHaveCount(0);
    await expect(slot.getByRole('button', { name: /I paid/ })).toBeFocused();

    await slot.getByRole('button', { name: /I paid/ }).click();
    await slot.locator('input[name="paid_on"]').fill('2026-11-06');
    await slot.locator('input[name="amount"]').fill('35');
    await slot.getByRole('button', { name: 'Mark as paid' }).click();
    await expect(slot.locator('.pay-now-status')).toHaveText('You marked $35.00 paid on Nov 6. We are waiting for your bank to show it.');
    expect(posts.at(-1)).toEqual({ action: 'card_paid', account_id: CARD, due_on: DUE, paid_on: '2026-11-06', amount_cents: 3500 });
    expect(await smallTargets(page)).toEqual([]);
    await markedShot(page, `pay-now-claimed-${width}-marked`, `#fos-overview [data-pay-card="${CARD}"] .pay-now-status`, 'Waiting for the bank to confirm, in words');

    // Undo puts I paid back.
    await slot.getByRole('button', { name: /Undo/ }).click();
    await expect(slot.getByRole('button', { name: /I paid/ })).toBeVisible();
    expect(posts.at(-1)).toEqual({ action: 'card_paid_undo', claim_id: 'c1a10000-0000-4000-8000-000000000001' });

    // Confirmed by the bank: said in words.
    claim = { id: 'c1a10000-0000-4000-8000-000000000002', due_on: DUE, paid_on: '2026-11-06', amount_cents: null, by: 'client', status: 'confirmed', seen_on: '2026-11-07', seen_amount_cents: 3500 };
    await openRow();
    await expect(slot.locator('.pay-now-status')).toHaveText('Your bank shows your payment on Nov 7 ($35.00).');
    await page.screenshot({ path: `${evidence}/pay-now-confirmed-${width}.png` });
    await noOverflow(page, 'confirmed');

    expect(errors).toEqual([]);
  });
}

test('staff see Mark paid and send the client id; a bill row gets no controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await withSession(page, { staff: { role: 'owner' } });
  const posts = [];
  const reads = [];
  const CID = 'aaaaaaaa-1111-4111-8111-111111111111';
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    if (route.request().method() !== 'GET') { posts.push(route.request().postDataJSON()); return json(route, { ok: true, pay_now: payNow({ id: 'k', due_on: DUE, paid_on: TODAY, amount_cents: null, by: 'staff', status: 'waiting' }) }); }
    reads.push(u.pathname + u.search);
    if (u.pathname === '/api/auth/session') return json(route, { ok: true, principal: 'staff', staff: { role: 'owner', name: 'Owner', org_id: 'org-1' } });
    if (u.pathname === '/api/money/overview') return json(route, { ...overview, upcoming: [...overview.upcoming, { type: 'bill', name: 'Rent', on: DUE, amount_cents: 100000 }] });
    if (u.pathname === '/api/money/payments') return json(route, { ok: true, pay_now: payNow(null) });
    return json(route, bundle.reads[u.pathname] || { ok: true, items: [] });
  });
  await page.goto(`/app/financeos.html?client_id=${CID}#overview`);
  await page.locator('#money-detail-payments > summary').click();
  await expect(page.locator('#fos-overview [data-pay-card]')).toHaveCount(1);
  expect(reads).toContain(`/api/money/payments?part=pay_now&client_id=${CID}`);
  const slot = page.locator('#fos-overview [data-pay-card]');
  await slot.getByRole('button', { name: /Mark paid/ }).click();
  await slot.getByRole('button', { name: 'Mark as paid' }).click();
  await expect(slot.locator('.pay-now-status')).toHaveText(`Marked paid on Nov ${Number(TODAY.slice(8))}. Waiting for the bank to show it.`);
  expect(posts.at(-1)).toMatchObject({ action: 'card_paid', account_id: CARD, due_on: DUE, paid_on: TODAY, client_id: CID });
});
