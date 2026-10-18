import { test, expect } from '@playwright/test';
import { openScreen, OWNER, json } from './harness.mjs';

const KEYS = ['client', 'setter', 'closer', 'advisor', 'affiliate', 'partner'];
function fixture() {
  return { ok: true, journeys: Object.fromEntries(KEYS.map((key, index) => [key, {
    name: key[0].toUpperCase() + key.slice(1),
    start: 'A review is requested', end: 'Review complete',
    desc: 'Review the next step and test the journey before applying changes.',
    nodes: [{
      id: 'n' + (100 + index * 10), type: 'condition', title: 'Has the client replied?',
      cfg: { field: 'replied', op: 'is true' }, touches: [],
      branches: [
        { label: 'Replied', nodes: [{ id: 'n' + (101 + index * 10), type: 'wait', title: 'Wait before the review', cfg: { amount: '1', unit: 'days' }, touches: [] }] },
        { label: 'No reply', nodes: [{ id: 'n' + (102 + index * 10), type: 'sms', title: 'Send a reminder', cfg: { body: 'Hi {{first_name}}, please reply. Reply STOP to opt out.', delay: 'instant' }, touches: [] }] }
      ]
    }]
  }])) };
}
function handlers(writes = [], status = 200) {
  return {
    '/api/journeys/ask': async route => json(route, { ok: true, text: JSON.stringify({
      summary: 'Added review wait', ops: [{ op: 'insert', after: 'n100', path: [], node: { type: 'wait', title: 'Review wait', cfg: { amount: '2', unit: 'hours' } } }]
    }) }),
    '/api/journeys/run': async route => { writes.push({ path: '/run', method: route.request().method() }); await json(route, { ok: false, error: 'forbidden' }, 403); },
    '/api/journeys': async (route, { method }) => {
      if (method === 'GET') return json(route, fixture());
      writes.push({ method, body: JSON.parse(route.request().postData() || '{}') });
      return json(route, status === 200 ? { ok: true } : { ok: false, error: 'write_refused' }, status);
    }
  };
}
for (const width of [1440, 390, 320]) {
  test('journey controls, branches and inspector at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const writes = [];
    await openScreen(page, '/app/journeys.html', OWNER, handlers(writes));
    await expect(page.locator('#canvas h1')).toHaveText('Client');
    await expect(page.locator('#jlist [role=tab]')).toHaveCount(6);
    await expect(page.locator('#canvas .node')).toHaveCount(3);
    await expect(page.getByRole('group', { name: 'No reply', exact: true })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#canvas .node').first().click();
    await expect(page.locator('#pbody .ptitle')).toHaveText('Has the client replied?');
    await expect(page.getByLabel('Step name', { exact: true })).toHaveValue('Has the client replied?');
    const box = await page.locator('#pbody .pa').first().boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(40);
    if (width <= 920) {
      await expect(page.locator('.jr-back-to-flow')).toBeInViewport();
      await page.locator('.jr-back-to-flow').click();
      await expect(page.locator('#canvas .node').first()).toBeFocused();
    }
    await page.locator('#jlist .jrow').first().focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#canvas h1')).toHaveText('Setter');
    await expect(page.locator('#jlist .jrow').nth(1)).toBeFocused();
    expect(writes).toEqual([]);
  });
}

test('editing, undo and rejected apply retain actual unsaved state', async ({ page }) => {
  const writes = [];
  await openScreen(page, '/app/journeys.html', OWNER, handlers(writes, 503));
  await page.locator('#canvas .node').first().click();
  await page.getByLabel('Step name', { exact: true }).fill('Review response');
  await expect(page.locator('#dirty')).toContainText('unsaved');
  await page.locator('#undo').click();
  await expect(page.locator('#canvas .node').first()).toContainText('Has the client replied?');
  await page.locator('#canvas .node').first().click();
  await page.getByLabel('Step name', { exact: true }).fill('Review again');
  await page.locator('#apply').click();
  await expect(page.locator('.toast')).toContainText('Could not save');
  await expect(page.locator('#dirty')).toContainText('unsaved');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: 'PUT', body: { key: 'client' } });
});

test('AI proposal stays pending until kept; mocked apply preserves schema', async ({ page }) => {
  const writes = [];
  await openScreen(page, '/app/journeys.html', OWNER, handlers(writes));
  await page.getByLabel('Describe a journey change').fill('Add a review wait');
  await page.locator('#asksend').click();
  await expect(page.locator('#accept')).toBeVisible();
  expect(writes).toEqual([]);
  await page.locator('#reject').click();
  await expect(page.locator('#canvas .node')).toHaveCount(3);
  await page.getByLabel('Describe a journey change').fill('Add a review wait');
  await page.locator('#asksend').click();
  await page.locator('#accept').click();
  await page.locator('#apply').click();
  await expect(page.locator('.toast')).toContainText('Applied');
  expect(writes).toHaveLength(1);
  expect(writes[0].body.nodes.some(node => node.title === 'Review wait')).toBe(true);
});

test('simulation and run refusal do not claim sent messages or a successful run', async ({ page }) => {
  const writes = [];
  await openScreen(page, '/app/journeys.html', OWNER, handlers(writes));
  await page.locator('[data-tab=sim]').click();
  await expect(page.locator('.testbanner')).toContainText('nothing is sent');
  await page.locator('#simstart').click();
  await expect(page.locator('#simstop')).toBeVisible();
  await page.locator('#simstop').click();
  expect(writes).toEqual([]);
  await page.locator('#runreal').click();
  await expect(page.locator('.toast')).toContainText('Not allowed');
  await expect(page.locator('#runout')).toHaveCount(0);
  expect(writes).toEqual([{ path: '/run', method: 'POST' }]);
});

// Pin the existing fallback honestly: the loader keeps seed examples. These
// are continuity checks, not proof that loading/empty/error states are designed.
for (const state of ['loading', 'empty', 'error']) {
  test('existing ' + state + ' seed fallback stays navigable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 960 });
    await openScreen(page, '/app/journeys.html', OWNER, {
      '/api/journeys': async route => {
        if (state === 'loading') return; // route stays pending until the context closes
        return json(route, state === 'empty' ? { ok: true, journeys: {} } : { ok: false, error: 'unavailable' }, state === 'error' ? 503 : 200);
      }
    });
    await expect(page.locator('#jlist .jrow')).toHaveCount(6);
    await expect(page.locator('#canvas h1')).toHaveText('Client');
    await expect(page.locator('#canvas .node').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
