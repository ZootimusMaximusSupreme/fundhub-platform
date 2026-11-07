// Finance OS → Banks with the client's own accounts applied (wave 4, unit TL):
// a bank they already use is tagged "Existing relationship" and comes first; a
// card they already hold says "You already have this" and the line moves to the
// next product; cards they hold every product of leave the order and show under
// "You already have". The read is the real sample bank plan run through the real
// applyHoldingsToBankPlan() (src/http/fixtures/money-banks-holdings.sample.mjs).
// Sample data only, every /api answered here, at 1440, 390 and 320.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { withSession, json, trackErrors } from './harness.mjs';
import { taggedBanks } from '../src/http/fixtures/money-banks-holdings.sample.mjs';

const evidence = 'ops/workflows/build-evidence/tl-tradelines-2026-11-07';

async function shot(page, target, file) {
  const vp = page.viewportSize();
  const tall = Math.ceil((await target.boundingBox()).height) + 240;
  await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, Math.min(tall, 4000)) });
  await target.evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -16); });
  const box = await target.boundingBox();
  await page.screenshot({ path: file, clip: { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: Math.min(box.width + 8, vp.width - Math.max(0, box.x - 4)), height: box.height + 8 } });
  await page.setViewportSize(vp);
}

for (const width of [1440, 390, 320]) {
  test(`Banks: existing relationships first, no card they already hold, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 900 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const plan = taggedBanks();
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { role: 'client', name: 'Sample Person' } });
      if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
      if (path === '/api/money/banks') return json(route, plan);
      if (route.request().method() !== 'GET') return json(route, { ok: false, error: 'sample_read_only' }, 409);
      return json(route, bundle.reads[path] || { ok: true, items: [] });
    });
    await page.goto('/app/financeos.html#banks');

    const banks = page.locator('#fos-banks article.bank');
    await expect(banks.first()).toHaveAttribute('data-bank', 'Chase');
    const chase = banks.first();
    await expect(chase.locator('.tag-rel')).toHaveText('Existing relationship');
    await expect(chase).toContainText('You already have an account here.');
    await expect(chase.locator('.have')).toHaveText('You already have this: Business Ink Cash');
    await expect(chase).toContainText('Next: Ink Unlimited');
    await expect(page.locator('#fos-banks article.bank[data-bank="Bank of America"] .tag-rel')).toHaveCount(0);

    const rows = page.locator('#fos-banks .stack-row');
    const chaseBiz = rows.filter({ hasText: 'Ink Unlimited' });
    await expect(chaseBiz).toHaveCount(1);
    await expect(chaseBiz.locator('.tag-rel')).toHaveText('Existing relationship');
    await expect(chaseBiz.locator('.have')).toHaveText('You already have this: Business Ink Cash');
    await expect(rows.filter({ hasText: 'Business Gold' })).toHaveCount(0);
    const have = page.locator('#fos-banks .have-card');
    await expect(have).toContainText('American Express');
    await expect(have).toContainText('Business Gold · Blue Business Cash · Blue Business Plus');
    /* Step numbers run 1..n with no gap where the Amex line left. */
    const steps = await page.locator('#fos-banks .stack-n').allTextContents();
    expect(steps.map(Number)).toEqual(steps.map((_, i) => i + 1));

    /* Every logo on the tab loads; nothing sideways; nothing hangs off its card. */
    const logos = page.locator('#fos-banks img.fh-bank-logo');
    for (let i = 0; i < await logos.count(); i++) {
      await logos.nth(i).scrollIntoViewIfNeeded();
      await expect.poll(() => logos.nth(i).evaluate((el) => el.complete && el.naturalWidth > 0)).toBe(true);
    }
    const fit = await page.evaluate(() => {
      const bad = [];
      for (const card of document.querySelectorAll('#fos-banks :is(article.bank,.stack-row,.have-card)')) {
        const box = card.getBoundingClientRect();
        for (const el of card.querySelectorAll('.tag-rel,.have,.have-word,.bank-name')) {
          const r = el.getBoundingClientRect();
          if (r.left < box.left - 0.5 || r.right > box.right + 0.5) bad.push(`${el.className} in ${card.className}`);
        }
      }
      return { pageFits: document.documentElement.scrollWidth <= innerWidth, bad };
    });
    expect(fit.pageFits).toBe(true);
    expect(fit.bad).toEqual([]);

    await shot(page, chase, `${evidence}/banks-existing-relationship-${width}.png`);
    /* Review evidence, marked: numbered red boxes and a legend (.ai/rules/audit-screenshot-markups.md). */
    await page.evaluate(() => {
      const marks = [
        ['#fos-banks article.bank[data-bank="Chase"] .tag-rel', '1. A bank you already use: tagged and ranked first'],
        ['#fos-banks article.bank[data-bank="Chase"] .have', '2. The card you hold is named; the next one is offered']
      ];
      document.querySelector(marks[0][0]).closest('article').scrollIntoView({ block: 'start' });
      window.scrollBy(0, -140);
      const layer = document.createElement('div');
      layer.id = 'tl-proof-marks';
      marks.forEach(([sel], i) => {
        const r = document.querySelector(sel).getBoundingClientRect();
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'absolute', left: r.left + scrollX - 4 + 'px', top: r.top + scrollY - 4 + 'px', width: r.width + 8 + 'px',
          height: r.height + 8 + 'px', border: '3px solid #d02525', borderRadius: '8px', pointerEvents: 'none', zIndex: 150 });
        const n = document.createElement('span');
        n.textContent = String(i + 1);
        Object.assign(n.style, { position: 'absolute', right: '-14px', top: '-14px', width: '26px', height: '26px', borderRadius: '13px',
          background: '#d02525', color: '#fff', font: '700 14px/26px Arial,sans-serif', textAlign: 'center' });
        box.appendChild(n);
        layer.appendChild(box);
      });
      const legend = document.createElement('div');
      Object.assign(legend.style, { position: 'fixed', left: '8px', top: '8px', maxWidth: 'min(440px, calc(100vw - 16px))', padding: '8px',
        background: '#fff', border: '2px solid #d02525', borderRadius: '8px', font: '600 13px/1.4 Arial,sans-serif', color: '#111', zIndex: 151 });
      legend.innerHTML = marks.map(([, words]) => `<div>${words}</div>`).join('');
      layer.appendChild(legend);
      document.body.appendChild(layer);
    });
    await page.screenshot({ path: `${evidence}/marked-banks-existing-relationship-${width}.png`, fullPage: false });
    await page.locator('#tl-proof-marks').evaluate((el) => el.remove());
    await shot(page, page.locator('#fos-banks section[aria-labelledby="bk-stack"]'), `${evidence}/banks-card-order-${width}.png`);
    expect(errors).toEqual([]);
  });
}
