import { test, expect } from '@playwright/test';
import {tmpdir} from 'node:os';
import { CLIENT_ID, CLOSER, openScreen, json } from './harness.mjs';
import { offersForClient } from '../src/config/offers.mjs';

// Browser-only fixtures: no real client, provider, session or outbound writes.
const PRIVATE = 'PRIVATE_HANDOFF_do_not_project';
const NOTE = 'PRIVATE_COACH_NOTE_do_not_project';
const NAME = 'Private Identity Fixture';
const deck = {
  ok: true, survey: { name: NAME, target: '$50,000', use: 'Equipment' },
  setter_handoff: { complete_at: '2026-11-02T16:00:00Z', problem: PRIVATE, handoff_text: PRIVATE },
  businesses: [], income_estimates: {}, offers: offersForClient(),
  engine: { available: true, tier: 'FULL_FUNDING', fico: {}, reasons: [], total: 50000 },
  soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: 'complete', crs_result_id: 'fixture', sample: false }
};
const privateSelectors = '.cockpit, [data-fh-shared-context], [data-fh-setter-handoff], [data-act="client-only"]';

async function watchEveryPaint(page) {
  await page.addInitScript(({ selectors, secrets }) => {
    window.__audienceLeaks = [];
    new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches(selectors) || node.querySelector(selectors)) window.__audienceLeaks.push('private DOM');
        for (const secret of secrets) if (node.textContent.includes(secret)) window.__audienceLeaks.push(secret);
      }
    }).observe(document, { childList: true, subtree: true });
  }, { selectors: privateSelectors, secrets: [PRIVATE, NOTE, NAME] });
}

for (const width of [390, 1440]) {
  test(`audience launch ${width}px never paints private data and fills its own tab`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await watchEveryPaint(page);
    let contexts = 0;
    await openScreen(page, `/app/present.html?contact=${CLIENT_ID}&audience=1`, CLOSER, {
      '/api/read/closer-deck': async route => { await new Promise(resolve => setTimeout(resolve, 150)); return json(route, deck); },
      '/api/read/agent-context': route => { contexts++; return json(route, { ok: true, context: { as_prompt_block: NOTE } }); }
    });
    await expect(page.locator('.client.solo')).toBeVisible();
    await expect(page.locator(privateSelectors)).toHaveCount(0);
    await expect(page.locator('.topbar')).toContainText('Fundhub');
    await expect(page.locator('[data-act="back"]')).toBeDisabled();
    await page.getByRole('button', { name: 'Next screen', exact: true }).click();
    await page.getByRole('button', { name: 'Next screen', exact: true }).click();
    await expect(page.locator('.client .slide-hd')).toContainText('S-03');
    await expect(page.locator('body')).not.toContainText(PRIVATE);
    await expect(page.locator('body')).not.toContainText(NOTE);
    expect(contexts).toBe(0);
    expect(await page.evaluate(() => window.__audienceLeaks)).toEqual([]);
    const bounds = await page.locator('.client').boundingBox();
    expect(bounds.width).toBeGreaterThan(width - 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    // A stale/injected old toggle cannot unlock the private renderer.
    await page.evaluate(() => {
      const button = document.createElement('button'); button.dataset.act = 'client-only';
      document.body.append(button); button.click(); button.remove();
    });
    await expect(page.locator('.cockpit')).toHaveCount(0);
    await expect(page.locator('[data-act="client-only"]')).toHaveCount(0);
    const next = await page.getByRole('button', { name: 'Next screen', exact: true }).boundingBox();
    expect(next.height).toBeGreaterThanOrEqual(44);
    await page.evaluate(() => {
      const marker = document.createElement('aside'); marker.setAttribute('data-evidence-only', '1');
      marker.style.cssText = 'position:fixed;z-index:99999;bottom:12px;left:12px;max-width:310px;padding:12px;background:#fff;border:3px solid red;border-radius:16px;font:14px sans-serif;color:#111';
      marker.textContent = '① ↑ Audience view: private cockpit, handoff and notes never render. Navigation fills this separate tab.';
      const arrow = document.createElement('b'); arrow.textContent = '↑';
      arrow.style.cssText = 'position:fixed;right:40px;top:54px;color:#e5b900;font:48px sans-serif;text-shadow:0 1px #111';
      const circle = document.createElement('b'); circle.textContent = '1';
      circle.style.cssText = 'position:fixed;right:5px;top:1px;width:120px;height:53px;border:3px solid red;border-radius:50%;color:red;text-align:left;font:16px sans-serif';
      marker.append(arrow, circle); document.body.append(marker);
    });
    await page.screenshot({ path: `${tmpdir()}/fundhub-present-audience-${width}-MARKED.png` });
  });
}

test('normal private Present retains cockpit, handoff, shared notes and controls', async ({ page }) => {
  await openScreen(page, `/app/present.html?contact=${CLIENT_ID}`, CLOSER, {
    '/api/read/closer-deck': deck,
    '/api/read/agent-context': { ok: true, context: { as_prompt_block: NOTE } }
  });
  await expect(page.locator('.cockpit')).toBeVisible();
  await expect(page.locator('[data-fh-setter-handoff]')).toContainText(PRIVATE);
  await expect(page.locator('[data-fh-shared-context]')).toContainText(NOTE);
  await expect(page.getByRole('button', { name: 'Client screen only', exact: true })).toBeVisible();
  await page.locator('[data-act="phase:09"]').click();
  await expect(page.locator('[data-act="pay"]')).toBeVisible();
  await page.getByRole('button', { name: 'Other actions', exact: true }).click();
  await expect(page.locator('[data-act="contract"]')).toBeVisible();
});

test('audience launch without a selected client refuses before any client read', async ({ page }) => {
  let reads = 0;
  await openScreen(page, '/app/present.html?audience=1', CLOSER, {
    '/api/read/closer-deck': route => { reads++; return json(route, deck); },
    '/api/read/agent-context': route => { reads++; return json(route, { ok: true, context: {} }); }
  });
  await expect(page.getByRole('alert')).toContainText('Pick a client first');
  await expect(page.locator('.client, .cockpit')).toHaveCount(0);
  expect(reads).toBe(0);
});

test('audience respects the existing unauthorized deck refusal', async ({ page }) => {
  await openScreen(page, `/app/present.html?contact=${CLIENT_ID}&audience=1`, CLOSER, {
    '/api/read/closer-deck': route => json(route, { ok: false, error: 'forbidden' }, 403)
  });
  await expect(page.getByRole('alert')).toContainText('cannot open the client deck');
  await expect(page.locator('.client, .cockpit')).toHaveCount(0);
});

test('CRM Present directly opens selected-client audience in a separate isolated tab', async ({ page, context }) => {
  await context.route('**/api/**', route => {
    const url = route.request().url();
    if (url.includes('/api/read/closer-deck')) return json(route, deck);
    if (url.includes('/api/auth/session')) return json(route, CLOSER);
    return json(route, { ok: true, items: [] });
  });
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    '/api/read/closer-now': { ok: true, current: null, next: null },
    '/api/read/closer-call': { ok: true, client: { id: CLIENT_ID, name: NAME }, kpis: {}, staff: {} },
    '/api/read/agent-context': { ok: true, context: { as_prompt_block: NOTE } }
  });
  const dashboard = page.url();
  const popupReady = context.waitForEvent('page');
  await page.locator('#fh-present').click();
  const audience = await popupReady;
  await audience.waitForLoadState('domcontentloaded');
  await expect(audience).toHaveURL(new RegExp(`/app/present.html\\?contact=${CLIENT_ID}&audience=1$`));
  await expect(audience.locator('.client.solo')).toBeVisible();
  await expect(audience.locator(privateSelectors)).toHaveCount(0);
  expect(await audience.evaluate(() => window.opener)).toBeNull();
  expect(await audience.evaluate(() => document.referrer)).toBe('');
  expect(page.url()).toBe(dashboard);
  await expect(page.locator('#fh-present')).toBeVisible();
});
