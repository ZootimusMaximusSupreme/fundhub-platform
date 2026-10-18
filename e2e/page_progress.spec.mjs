import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const evidence = 'ops/workflows/build-evidence/client-portal-ios-redo';
const session = { ok: true, principal: 'client', staff: { id: 'test-client', role: 'client', kind: 'client', name: 'Sample Client', email: 'client@example.test' } };
const empty = { ok: true, stage: null, scores: { personal: [], business: [] }, movement: {}, waypoints: [], nextStep: null, paidServices: [], deliverables: [], ownedNotReady: [], timeline: [], referral: {} };
const full = { ...empty,
  stage: { key: 'in_transit', roundCurrent: 2, roundCap: 6, waitingOn: 'bureaus' },
  scores: { personal: ['experian','equifax','transunion'].map((bureau, i) => ({ bureau, score: 680 + i * 12, pulledAt: '2026-10-17' })), business: [] },
  movement: { middleScoreNow: 692, middleScoreBaseline: 651, itemsRemoved: 2, itemsDisputed: 7, series: [] },
  nextStep: { waypointId: 'step1', owner: 'client' },
  waypoints: [{ id: 'step1', title: 'Review your funding plan', owner: 'client', state: 'not_started', closedBy: 'client', order: 1 }, { id: 'step2', title: 'Send your mailing receipt', owner: 'client', state: 'not_started', verifyKind: 'dispute_mail_receipt', order: 2 }],
  deliverables: [{ documentId: 'safe-document', title: 'Your funding plan', generatedAt: '2026-10-17' }],
  ownedNotReady: [{ name: 'Funding snapshot' }],
  timeline: [{ at: '2026-10-17T12:00:00Z', text: 'Your plan is ready to review' }]
};
async function setup(page, state = full, status = 200, referralFails = false) {
  await page.addInitScript(() => localStorage.setItem('fh_token', 'safe-mock-token'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body = session; let code = 200;
    if (path === '/api/read/client-progress') { body = state; code = status; }
    else if (path === '/api/waypoint-tick') body = { ok: true, waypoint: { state: 'done', completedAt: '2026-10-18' } };
    else if (path === '/api/documents-download') body = { ok: true, document: { download: { url: 'https://example.test/safe-document' } } };
    else if (path === '/api/affiliates/refer') { body = referralFails ? { ok: false } : { ok: true, code: 'SAFE-TEST', shareUrl: 'https://example.test/refer/SAFE-TEST' }; code = referralFails ? 500 : 200; }
    else if (path === '/api/documents-upload') body = { ok: true };
    await route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/progress.html');
  await expect(page.locator('#progressLoading')).toBeHidden();
}
for (const width of [1440, 390, 320]) {
  test(`progress full ${width}px retains controls and no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await setup(page);
    await expect(page.locator('body')).toHaveAttribute('data-client-ios', /.+|^$/);
    await expect(page.locator('#cStage')).toContainText('2 / 6 rounds');
    await expect(page.locator('#cDocs')).toContainText('Funding snapshot');
    await expect(page.getByRole('button', { name: 'Upload your mailing proof' })).toBeVisible();
    await page.locator('input[data-proof-file]').setInputFiles({ name: 'safe-test-receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 safe mock receipt') });
    await expect(page.locator('[data-proof-msg]')).toContainText('Got it');
    await expect(page.locator('.tickbtn')).toHaveAttribute('aria-checked', 'false');
    await page.locator('.tickbtn').focus();
    await page.keyboard.press('Space');
    await expect(page.locator('.tickbtn')).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'Refer a friend', exact: true }).click();
    await expect(page.locator('#refUrl')).toHaveValue('https://example.test/refer/SAFE-TEST');
    await expect(page.getByRole('link', { name: 'Open your referral dashboard' })).toHaveAttribute('href', '/app/affiliate.html');
    await page.getByRole('link', { name: 'Open your referral dashboard' }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('link', { name: 'Open your referral dashboard' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    fs.mkdirSync(evidence, { recursive: true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${evidence}/page_progress-${width}-fold.png` });
    await page.screenshot({ path: `${evidence}/page_progress-${width}.png`, fullPage: true });
  });
}
test('progress empty and failure states stay honest', async ({ page }) => {
  await setup(page, empty);
  await expect(page.locator('#cStage')).toContainText('do not have a stage');
  await expect(page.locator('#cDocs')).toContainText('once they are ready');
  await page.screenshot({ path: `${evidence}/page_progress-empty.png` });
  await setup(page, { ok: false }, 500);
  await expect(page.getByRole('alert')).toContainText('could not load');
  await expect(page.locator('#main')).toBeHidden();
  await page.screenshot({ path: `${evidence}/page_progress-error.png` });
});
test('failed referral retains retry and never claims enrollment', async ({ page }) => {
  await setup(page, full, 200, true);
  await page.getByRole('button', { name: 'Refer a friend', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('That did not work');
  await expect(page.locator('#refUrl')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open your referral dashboard' })).toHaveCount(0);
});
test('progress keeps a loading layout while its real read waits', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(session) }));
  await page.route('**/api/read/client-progress', async route => { await new Promise(resolve => setTimeout(resolve, 1200)); await route.fulfill({ contentType: 'application/json', body: JSON.stringify(empty) }); });
  await page.goto('/progress.html', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#progressLoading')).toBeVisible();
  await page.screenshot({ path: `${evidence}/page_progress-loading.png` });
  await expect(page.locator('#progressLoading')).toBeHidden();
});
