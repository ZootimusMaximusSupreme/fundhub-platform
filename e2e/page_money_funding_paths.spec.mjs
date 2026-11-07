// "Your funding paths" on the Fundability tab (Finance OS wave 4, unit FUND):
// FinanceOS and the standalone page, as a client, as a Capital Blueprint owner
// (the $3,000 deposit waived, owner-set 2026-11-07) and as a team member, at
// 1440, 390 and 320. The fictional sample block
// src/http/fixtures/money-fundability-paths.sample.json rides on the
// Fundability sample read; every /api call is answered here. Nothing is sent.
//
// Format check (wave 4 brief): no sideways page scroll, nothing in the card cut
// off or past its edge, every control at least 44 by 44, captions at least
// 13px. Screenshots: ops/workflows/build-evidence/finance-os-fund-paths-2026-11-07/
// (a clean copy under _raw/, and a copy with the card boxed in red and numbered).
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };

const fund = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-fundability.sample.json', import.meta.url)));
const sample = JSON.parse(fs.readFileSync(new URL('../src/http/fixtures/money-fundability-paths.sample.json', import.meta.url)));
const EVIDENCE = 'ops/workflows/build-evidence/finance-os-fund-paths-2026-11-07';
const SHARE = 'https://fundhub.ai/start.html?ref=AFF-000123';
const clone = (v) => JSON.parse(JSON.stringify(v));

async function json(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function server(page, { role = 'client', viewer = 'client', pull = true, othersDown = false, blueprint = false } = {}) {
  const s = { paths: { ...clone(sample), viewer }, posts: [] };
  if (othersDown) s.paths.others = { ok: false };
  /* A Capital Blueprint owner, as src/finance/funding-paths.mjs builds one:
     the $3,000 deposit is waived (owner-set 2026-11-07), and no Blueprint
     line to sell them what they own. */
  if (blueprint) {
    Object.assign(s.paths.fundhub.done_for_you, { deposit_cents: 0, deposit_waived: true });
    Object.assign(s.paths.fundhub.financing, { blueprint_owned: true, book_url: null });
  }
  await page.route('**/api/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === '/api/auth/session') return json(route, { ok: true, principal: role === 'client' ? 'client' : 'staff', staff: { role } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/overview') return json(route, bundle.reads['/api/money/overview']);
    if (path === '/api/affiliates/refer' && req.method() === 'POST') {
      s.posts.push({ path, body: req.postDataJSON() });
      return json(route, { ok: true, enrolled: true, created: true, code: 'AFF-000123', shareUrl: SHARE });
    }
    if (path === '/api/money/ready-to-fund' && req.method() === 'POST') {
      s.posts.push({ path, body: req.postDataJSON() });
      return json(route, { ok: true, created: true, status: 'requested', round: 1, requested_at: '2026-11-07T18:00:00.000Z', done_at: null });
    }
    if (path === '/api/money/fundability') {
      const base = pull ? clone(fund) : { ok: true, client: fund.client, has_pull: false, now: { score: null, score_max: 6, tier: null }, projections: [], businesses: [] };
      if (!pull) s.paths.self = { ...s.paths.self, has_pull: false, today_cents: null, plan_cents: null, checks_passed: null };
      return json(route, { ...base, paths: clone(s.paths) });
    }
    return json(route, { ok: true, items: [] });
  });
  return s;
}

async function formatCheck(page, card, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: page scrolls sideways`).toBe(true);
  const out = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const bad = [];
    if (el.scrollWidth > el.clientWidth + 1) bad.push('card content wider than the card');
    for (const n of el.querySelectorAll('*')) {
      if (n.closest('[hidden]')) continue;
      const r = n.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.left < box.left - 1 || r.right > box.right + 1) bad.push(`${n.tagName}.${n.className} sticks out (${Math.round(r.left)}-${Math.round(r.right)} vs ${Math.round(box.left)}-${Math.round(box.right)})`);
      if (n.matches('button, a') && (r.height < 44 || r.width < 44)) bad.push(`${n.tagName} "${n.textContent.trim().slice(0, 30)}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (n.matches('.caption, .fp-pill') && parseFloat(getComputedStyle(n).fontSize) < 13) bad.push(`${n.className} text is ${getComputedStyle(n).fontSize}`);
    }
    /* The three paths never overlap each other. */
    const paths = [...el.querySelectorAll('.fp-path')].map((p) => p.getBoundingClientRect());
    for (let i = 0; i < paths.length; i++) for (let j = i + 1; j < paths.length; j++) {
      const a = paths[i], b = paths[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(`path ${i + 1} overlaps path ${j + 1}`);
    }
    return bad;
  });
  expect(out, `${label}: ${out.join('; ')}`).toEqual([]);
  /* Nothing on the page sits on top of a control: scroll each one to the
     middle of the screen and ask the browser what is under its centre. */
  const covered = await card.evaluate((el) => {
    const bad = [];
    for (const n of el.querySelectorAll('button, a')) {
      if (n.closest('[hidden]')) continue;
      n.scrollIntoView({ block: 'center' });
      const r = n.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === n || n.contains(hit))) bad.push(`"${n.textContent.trim().slice(0, 30)}" is covered by ${hit ? hit.tagName + '.' + hit.className : 'nothing'}`);
    }
    return bad;
  });
  expect(covered, `${label}: ${covered.join('; ')}`).toEqual([]);
}

async function shots(page, name, selector, caption) {
  fs.mkdirSync(`${EVIDENCE}/_raw`, { recursive: true });
  /* One tall window as high as the page, so the fixed phone bar and side nav
     sit where a person scrolled to the end sees them, never stitched on top of
     the card. The window goes back to its size afterwards. */
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
  await page.setViewportSize(vp);
}

for (const width of [1440, 390, 320]) {
  test(`Funding paths, client, FinanceOS Fundability ${width}`, async ({ page, context }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: 900 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'client'); });
    const s = await server(page);
    await page.goto('/app/financeos.html#fundability');
    const card = page.locator('#fos-fundability .fp-card');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Your funding paths' })).toBeVisible();
    await expect(card.locator('.fp-path')).toHaveCount(3);
    const self = card.locator('[data-fp-path="self"]');
    const others = card.locator('[data-fp-path="others"]');
    const fundhub = card.locator('[data-fp-path="fundhub"]');
    await expect(self).toContainText('Fund it yourself');
    await expect(self).toContainText('$212,000');
    await expect(self).toContainText('UnderwriteIQ estimate');
    await expect(self).toContainText('Next: File your LLC');
    await expect(others).toContainText('20%');
    /* Codex CX20: the percent names the sales it pays on and when. */
    await expect(others).toContainText('of the first of these that someone you send buys');
    await expect(others).toContainText('Done-for-you funding: what they pay, after they get funded');
    await expect(others).toContainText('Capital Blueprint: the price');
    await expect(others).not.toContainText('anyone');
    await expect(others).toContainText('Your own brand: $30,000 once');
    await expect(others).toContainText('7-day trial: $297');
    await expect(fundhub).toContainText('$3,000 to start · 10% of approved funding');
    await expect(fundhub).toContainText('Capital Blueprint: pay over time with ClarityPay');
    /* On purpose: right under the Fundhub score slot (the sales look-ahead),
       above the three tiles. */
    const order = await page.evaluate(() => {
      const slot = document.querySelector('#fos-fundability [data-fh-score-slot]');
      const paths = document.querySelector('#fos-fundability .fp-card');
      const tiles = document.querySelector('#fos-fundability .fd-thirds');
      return { underSlot: !!slot && slot.nextElementSibling === paths, pathsTop: paths.getBoundingClientRect().top, tilesTop: tiles.getBoundingClientRect().top };
    });
    expect(order.underSlot, 'the paths card is the next block after the score slot').toBe(true);
    expect(order.pathsTop).toBeLessThan(order.tilesTop);
    await formatCheck(page, card, `client ${width}`);
    await shots(page, `financeos-fundability-paths-${width}`, '#fos-fundability .fp-card', 'Your funding paths: yourself, other people, Fundhub');

    /* Get my link, like a person. */
    await others.getByRole('button', { name: 'Get my link' }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toEqual({ path: '/api/affiliates/refer', body: {} });
    await expect(others.locator('[data-fp-url]')).toHaveText(SHARE);
    await others.getByRole('button', { name: 'Copy link' }).click();
    await expect(others.getByRole('button', { name: 'Copied' }).or(others.getByText('Press and hold the link to copy it.'))).toBeVisible();
    await formatCheck(page, card, `client joined ${width}`);
    await shots(page, `financeos-fundability-paths-joined-${width}`, '#fos-fundability [data-fp-path="others"]', 'After Get my link: their own link');

    /* I'm ready to get funded. */
    await fundhub.getByRole('button', { name: "I'm ready to get funded" }).click();
    await expect.poll(() => s.posts.length).toBe(2);
    expect(s.posts[1]).toEqual({ path: '/api/money/ready-to-fund', body: {} });
    await expect(fundhub.locator('.fp-pill')).toHaveText('Sent to our team');
    await expect(fundhub.getByRole('button', { name: "I'm ready to get funded" })).toHaveCount(0);
    await formatCheck(page, card, `client ready ${width}`);
    await shots(page, `financeos-fundability-paths-ready-${width}`, '#fos-fundability [data-fp-path="fundhub"]', 'After the press: Sent to our team');
    expect(errors).toEqual([]);
  });

  test(`Funding paths, Blueprint owner, FinanceOS Fundability ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'client'); });
    await server(page, { blueprint: true });
    await page.goto('/app/financeos.html#fundability');
    const card = page.locator('#fos-fundability .fp-card');
    await expect(card.locator('.fp-path')).toHaveCount(3);
    const fundhub = card.locator('[data-fp-path="fundhub"]');
    await expect(fundhub).toContainText('$0 to start · 10% of approved funding');
    await expect(fundhub).toContainText('Your Blueprint waives the $3,000 deposit.');
    await expect(fundhub).not.toContainText('$3,000 to start');
    await expect(fundhub).not.toContainText('ClarityPay');
    await expect(fundhub.getByRole('button', { name: "I'm ready to get funded" })).toBeVisible();
    await expect(card.locator('[data-fp-path="others"]')).toContainText('Your own brand: $30,000 once');
    await formatCheck(page, card, `blueprint owner ${width}`);
    await shots(page, `financeos-fundability-paths-blueprint-owner-${width}`, '#fos-fundability .fp-card', 'Blueprint owner: $0 to start, the $3,000 deposit waived');
    expect(errors).toEqual([]);
  });

  test(`Funding paths before a soft pull, standalone page ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await server(page, { pull: false, othersDown: true });
    await page.goto('/app/money-fundability.html');
    const card = page.locator('.fp-card');
    await expect(page.getByText('No credit file yet')).toBeVisible();
    await expect(card).toBeVisible();
    await expect(card.locator('[data-fp-path="self"]')).toContainText('Starts with your soft pull.');
    await expect(card.locator('[data-fp-path="others"]')).toContainText('We could not load this right now.');
    /* One filled button on the page: Run your soft pull. The ready button is an outline here. */
    await expect(card.locator('.fp-btn-primary')).toHaveCount(0);
    await expect(card.getByRole('button', { name: "I'm ready to get funded" })).toHaveClass(/fp-btn-line/);
    await formatCheck(page, card, `no pull ${width}`);
    await shots(page, `standalone-fundability-paths-no-pull-${width}`, '.fp-card', 'Before a soft pull; one path could not load');
  });

  test(`Funding paths, team view ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => { localStorage.setItem('fh_token', 'e2e-token'); localStorage.setItem('fh_role', 'owner'); });
    const s = await server(page, { role: 'owner', viewer: 'staff' });
    await page.goto('/app/financeos.html?client_id=safe-sample#fundability');
    const card = page.locator('#fos-fundability .fp-card');
    await expect(card.locator('.fp-path')).toHaveCount(3);
    const others = card.locator('[data-fp-path="others"]');
    await expect(others).toContainText('Not joined yet');
    await expect(others.getByRole('button')).toHaveCount(0);
    await expect(card.locator('[data-fp-path="self"] a')).toHaveAttribute('href', '/app/financeos.html?client_id=safe-sample#next');
    await card.getByRole('button', { name: "I'm ready to get funded" }).click();
    await expect.poll(() => s.posts.length).toBe(1);
    expect(s.posts[0]).toEqual({ path: '/api/money/ready-to-fund', body: { client_id: 'safe-sample' } });
    await formatCheck(page, card, `team ${width}`);
    await shots(page, `financeos-fundability-paths-team-${width}`, '#fos-fundability .fp-card', 'Team view: no referral button for the client');
  });
}
