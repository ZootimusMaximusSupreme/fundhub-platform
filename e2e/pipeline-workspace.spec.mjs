// Offline layout/accessibility proof. Every API request is intercepted by harness.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, json, OWNER, CLIENT_ID } from './harness.mjs';

const evidence = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18');
const card = (i, extra = {}) => ({ id: `layout-${i}`, client_id: CLIENT_ID,
  name: i ? `Sample Client ${i + 1}` : 'Sample Client With a Long Name',
  owner: 'Sample Advisor', entered_at: new Date(Date.now() - (i + 1) * 86400000).toISOString(),
  amount: 25000, phone: '5550100100', email: `sample${i}@example.test`, ...extra });
const stage = (key, name, cards) => ({ key, name, cards, count: cards.length,
  amount: cards.length * 25000 });
const BOARD = { ok: true, pipeline: 'sales', total: 40, stages: [
  stage('new_lead', 'New Lead', Array.from({ length: 14 }, (_, i) => card(i, { sms_needs_reply: true }))),
  stage('booked', 'Booked', Array.from({ length: 10 }, (_, i) => card(14 + i))),
  stage('round_submitted', 'Round Submitted', Array.from({ length: 10 }, (_, i) => card(24 + i))),
  stage('action_required', 'Action Required', Array.from({ length: 6 }, (_, i) => card(34 + i)))
] };

for (const width of [1440, 390, 320]) {
  test(`pipeline workspace fits ${width}px and exposes work immediately`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openScreen(page, '/app/pipeline.html', OWNER, { '/api/dashboard/pipeline': BOARD });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(40);
    await expect(page.locator('#hlUsN')).toHaveText('14');
    const metrics = await page.evaluate(() => {
      const card = document.querySelector('.card').getBoundingClientRect();
      const board = document.querySelector('.board-wrap').getBoundingClientRect();
      const toolbar = document.querySelector('.filterbar').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth - innerWidth,
        cardTop: card.y, cardBottom: card.bottom, boardTop: board.y, boardHeight: board.height,
        toolbarRight: toolbar.right, viewport: innerWidth };
    });
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.cardTop).toBeLessThan(width <= 640 ? 430 : 450);
    expect(metrics.boardHeight).toBeGreaterThan(250);
    expect(metrics.toolbarRight).toBeLessThanOrEqual(width);
    await expect(page.locator('.c-btn.route').first()).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `pipeline-after-${width}.png`), fullPage: true });
    fs.writeFileSync(path.join(evidence, `pipeline-metrics-${width}.json`), JSON.stringify(metrics, null, 2));
    await page.locator('#filterBtn').click();
    await expect(page.locator('#fWait')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.locator('#fWait').selectOption('bank');
    await expect(page.locator('.card:not(.filtered)')).toHaveCount(10);
    await page.getByRole('button', { name: 'Clear Waiting on', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.card:not(.filtered)')).toHaveCount(40);
    await page.locator('#filterBtn').click();
    await page.locator('#lensFulfillment').click();
    await expect(page.locator('#fhLens')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    if (width === 390) await page.screenshot({ path: path.join(evidence, 'pipeline-fulfillment-390.png'), fullPage: true });
  });
}

test('Fulfillment shows one Setter pill for repeated open tasks', async ({ page }) => {
  const blockers = [
    { kind: 'task', source: 'setter-entry', label: 'Setter: call new opt-in', id: 'setter-1' },
    { kind: 'task', source: 'setter-entry', label: 'Setter: call new opt-in', id: 'setter-2' },
    { kind: 'task', source: 'clickfunnels', label: 'Strategy session booked', id: 'booking-1' },
    { kind: 'task', source: 'clickfunnels', label: 'Strategy session booked', id: 'booking-2' }
  ];
  await openScreen(page, '/app/pipeline.html', OWNER, {
    '/api/dashboard/pipeline': BOARD,
    '/api/dashboard/clients': { ok: true, clients: [{ id: CLIENT_ID, name: 'Sample Client',
      active_blockers: blockers, next_action: { key: 'get_consent', label: 'Get Consent' } }] }
  });
  await page.locator('#lensFulfillment').click();
  const row = page.locator('#fhLens .fh-lens-row').first();
  await expect(row).toBeVisible();
  await expect(row.locator('.lr-blocker', { hasText: 'Setter: call new opt-in' })).toHaveCount(1);
  await expect(row.locator('.lr-blocker', { hasText: 'Strategy session booked' })).toHaveCount(2);
});

test('pipeline switches and same-board stage moves work with a keyboard', async ({ page }) => {
  const writes = [];
  const reads = [];
  await openScreen(page, '/app/pipeline.html', OWNER, {
    '/api/dashboard/pipeline': (route, { url }) => { reads.push(url); return json(route, BOARD); },
    '/api/pipeline-cards': (route) => { writes.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); }
  });
  const move = page.locator('.card .c-btn.route').first();
  await move.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#routeMenu')).toBeVisible();
  await expect(page.locator('#rmCurrentStages .rm-item').first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#rmCurrentStages .rm-item').nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#routeMenu')).toBeHidden();
  await expect(move).toBeFocused();
  expect(writes).toEqual([]);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ action: 'move', client_id: CLIENT_ID, pipeline_key: 'sales', stage_key: 'booked' });
  const funding = page.locator('.rail-tab[data-rail="R-02"]');
  await funding.focus();
  await page.keyboard.press('Space');
  await expect(funding).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => reads.some(url => url.includes('funding_card_stacking'))).toBe(true);
  expect(await funding.evaluate(el => el.tagName)).toBe('BUTTON');
});

test.describe('pipeline touch controls', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test('touch exposes Move and Archive, and a move can be made without dragging', async ({ page }) => {
    const writes = [];
    await openScreen(page, '/app/pipeline.html', OWNER, {
      '/api/dashboard/pipeline': BOARD,
      '/api/pipeline-cards': route => { writes.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); }
    });
    const move = page.locator('.card .c-btn.route').first();
    for (const control of [move, page.locator('.card .c-btn.del').first()]) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
      expect(box.width).toBeGreaterThanOrEqual(40);
    }
    await move.tap();
    await page.locator('#rmCurrentStages .rm-item[data-stage-key="booked"]').tap();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0].stage_key).toBe('booked');
  });
});

test('client drawer and New Client stay usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await openScreen(page, '/app/pipeline.html', OWNER, { '/api/dashboard/pipeline': BOARD });
  await expect(page.locator('#fhDrawer')).toHaveAttribute('inert', '');
  await page.locator('.card').first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#fhDrawer')).toHaveClass(/open/);
  await expect(page.locator('#fhDrawerClose')).toBeFocused();
  await expect.poll(() => page.locator('#fhDrawer').evaluate(el => el.getBoundingClientRect().width)).toBe(320);
  const drawer = await page.locator('#fhDrawer').boundingBox();
  expect(drawer.x).toBeGreaterThanOrEqual(0);
  expect(drawer.width).toBeLessThanOrEqual(320);
  expect(drawer.y).toBeLessThanOrEqual(72);
  expect(drawer.height).toBeGreaterThan(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(evidence, 'pipeline-drawer-320.png'), fullPage: true, animations: 'disabled' });
  await page.locator('#fhDrawerClose').click();
  await page.locator('#fhNewClient').click();
  await expect(page.locator('#fhNewModal')).toHaveClass(/open/);
  await page.locator('#fhNewName').fill('Sample Person');
  await page.locator('#fhNewGo').click();
  await expect(page.locator('#fhNewErr')).toContainText('Fill in');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(evidence, 'pipeline-new-client-320.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.locator('#fhNewModal')).not.toHaveClass(/open/);
  await expect(page.locator('#fhNewClient')).toBeFocused();
});

test.describe('pipeline touch drag handle', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } });
  test('a touch drag still saves while card surfaces can scroll', async ({ page }) => {
    const writes = [];
    await openScreen(page, '/app/pipeline.html', OWNER, {
      '/api/dashboard/pipeline': BOARD,
      '/api/pipeline-cards': route => { writes.push(JSON.parse(route.request().postData())); return json(route, { ok: true }); }
    });
    const handle = page.locator('.card .grip').first();
    await expect(handle).toBeVisible();
    const from = await handle.boundingBox();
    const to = await page.locator('.col[data-stage-key="booked"] .col-body').boundingBox();
    const session = await page.context().newCDPSession(page);
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const finish = { x: Math.min(382, to.x + 14), y: to.y + 40 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...start, id: 1 }] });
    for (let step = 1; step <= 8; step++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{
        x: start.x + (finish.x - start.x) * step / 8,
        y: start.y + (finish.y - start.y) * step / 8, id: 1
      }] });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ action: 'move', pipeline_key: 'sales', stage_key: 'booked' });
    await session.detach();
  });
});

for (const width of [1440, 390, 320]) {
  test(`zero-waiting summary stays compact and preserves details at ${width}px`, async ({ page }) => {
    const zero = { ok: true, pipeline: 'sales', total: 1, stages: [
      stage('new_lead', 'New Lead', [card(0)]), stage('booked', 'Booked', [])
    ] };
    await page.setViewportSize({ width, height: width > 640 ? 900 : 780 });
    await openScreen(page, '/app/pipeline.html', OWNER, { '/api/dashboard/pipeline': zero });
    await expect(page.locator('#hlUsN')).toHaveText('0');
    await expect(page.locator('#sumCountUnit')).toHaveText('card');
    const metrics = await page.evaluate(() => ({
      headlineHeight: document.querySelector('#headline').getBoundingClientRect().height,
      cardTop: document.querySelector('.card').getBoundingClientRect().top,
      overflow: document.documentElement.scrollWidth - innerWidth
    }));
    expect(metrics.overflow).toBe(0);
    expect(metrics.cardTop).toBeLessThan(420);
    await expect(page.locator('#railNote')).toBeHidden();
    await page.screenshot({ path: path.join(evidence, `pipeline-zero-after-${width}.png`), fullPage: true });
    fs.writeFileSync(path.join(evidence, `pipeline-zero-metrics-${width}.json`), JSON.stringify(metrics, null, 2));
    const details = page.locator('#waitingDetails > summary');
    if (width <= 640) {
      expect(metrics.headlineHeight).toBeLessThanOrEqual(60);
      await expect(page.locator('#hlBank')).toBeHidden();
      await details.focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('#hlNextNote')).toContainText('Nothing on this rail is waiting');
      const panel = await page.locator('#waitingDetails .hl-ref').boundingBox();
      expect(panel.width).toBeGreaterThanOrEqual(280);
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
    }
    await expect(page.locator('#hlBank b')).toHaveText('0');
    await expect(page.locator('#hlClient b')).toHaveText('0');
    await expect(page.locator('#hlNone b')).toHaveText('1');
    await expect(page.locator('#sumMoneyWrap')).toBeVisible();
    if (width === 390) await page.screenshot({ path: path.join(evidence, 'pipeline-zero-details-390.png'), fullPage: true });
    await page.locator('#hlNone').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#fWait')).toHaveValue('none');
    await expect(page.locator('#filterN')).toHaveText('1');
    if (width <= 640) {
      await page.keyboard.press('Escape');
      await expect(page.locator('#waitingDetails')).not.toHaveAttribute('open');
      await expect(details).toBeFocused();
    }
    await page.locator('#filterBtn').click();
    await page.locator('#fWait').selectOption('us');
    await expect(page.locator('.card:not(.filtered)')).toHaveCount(0);
    await page.locator('#filterClear').click();
    await expect(page.locator('.card:not(.filtered)')).toHaveCount(1);
    await page.locator('#filterBtn').click();
    await page.locator('.c-btn.route').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#rmCurrentStages .rm-item[data-stage-key="booked"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.locator('.pipeline-details > summary').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#railNote')).toContainText('Closed Won updates after the funding deposit is paid.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
