// The "Lender packet" card (Finance OS unit I3), clicked like a person on the
// funding-papers page and inside FinanceOS. Every /api/** call is answered here
// with the REAL vault engine's answer for the sample person plus the REAL packet
// list (src/finance/lender-packet.mjs); the download answers a small real PDF.
// No backend, no real file, no write. Checked at 1440, 390 and 320: the card,
// what is missing, the one tap that saves the PDF, the refusal words, the four
// states, 44px targets and no sideways scroll.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { sampleVault } from '../src/http/fixtures/money-vault.sample.mjs';
import { packetsFromVault } from '../src/finance/lender-packet.mjs';
import { withSession, trackErrors, assertPageAlive } from './harness.mjs';

const evidence = 'ops/workflows/build-evidence/fos-i3-lender-packet';
const SNAPSHOT = { id: 'dddd0000-0000-4000-8000-000000000001', subtype: 'funding_snapshot', title: 'Funding Snapshot' };
const ANALYSIS = { id: 'dddd0000-0000-4000-8000-000000000002', subtype: 'credit_analysis_report', title: 'Credit Analysis Report' };

function vaultFor(state) {
  if (state === 'error-packets') return { ...sampleVault({ variant: 'full' }), packets: null, packets_error: 'could_not_check' };
  const variant = state === 'complete' ? 'complete' : state === 'empty' ? 'empty' : 'full';
  const papers = state === 'complete' ? [SNAPSHOT, ANALYSIS] : state === 'empty' ? [] : [SNAPSHOT];
  const v = sampleVault({ variant });
  v.packets = JSON.parse(JSON.stringify(packetsFromVault(v, { fundhubPapers: papers })));
  return v;
}

async function pdfBytes() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return Buffer.from(await d.save());
}

async function wire(page, box) {
  const pdf = await pdfBytes();
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    if (route.request().method() !== 'GET') { box.writes.push(path); return json({ ok: false, error: 'read_only' }, 409); }
    if (path === '/api/auth/session') return json({ ok: true, principal: 'client' });
    if (path === '/api/read/affiliate-portal') return json({ ok: true, enrolled: false });
    if (path === '/api/money/vault') {
      const packet = url.searchParams.get('packet');
      if (packet !== null) {
        box.downloads.push(packet);
        if (box.download === 'nothing') return json({ ok: false, error: 'nothing_ready' }, 409);
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="lender-packet-${packet === 'personal' ? 'personal' : 'fundhub-llc'}-2026-10-07.pdf"`,
            'x-packet-files': '4',
            'x-packet-left-out': JSON.stringify(box.leftOut || [])
          },
          body: pdf
        });
      }
      if (box.state === 'loading') return; // held: the skeleton stays up
      if (box.state === 'error') return json({ ok: false, error: 'unavailable' }, 503);
      return json(vaultFor(box.state));
    }
    return json(bundle.reads[path] || { ok: true, items: [] });
  });
}

async function noSideways(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label).toBe(true);
}

async function bigTargets(page) {
  const small = await page.locator('.vt-packet button, .vt-packet a').evaluateAll((els) =>
    els.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.width < 44 || r.height < 44); })
      .map((el) => el.textContent.trim()));
  expect(small, 'every packet control is at least 44 by 44').toEqual([]);
}

async function markedShot(page, name, caption) {
  fs.mkdirSync(evidence, { recursive: true });
  await page.locator('.vt-packet').evaluate((el, caption) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement('div');
    box.id = 'proof-mark';
    Object.assign(box.style, { position: 'absolute', left: r.left + scrollX + 'px', top: r.top + scrollY + 'px', width: r.width + 'px', height: r.height + 'px', border: '2px solid #d02525', pointerEvents: 'none', zIndex: 150 });
    const dot = document.createElement('span');
    dot.textContent = '1';
    Object.assign(dot.style, { position: 'absolute', left: '-12px', top: '-12px', width: '24px', height: '24px', borderRadius: '50%', border: '2px solid #d02525', background: '#fff', color: '#d02525', font: 'bold 13px Arial', display: 'flex', alignItems: 'center', justifyContent: 'center' });
    const text = document.createElement('span');
    text.textContent = '1 — ' + caption;
    Object.assign(text.style, { position: 'absolute', left: '16px', top: '-22px', padding: '2px 6px', color: '#b11c1c', background: '#fff', border: '1px solid #f2c400', font: '12px Arial,sans-serif', whiteSpace: 'nowrap' });
    box.append(dot, text);
    document.body.appendChild(box);
    el.scrollIntoView({ block: 'center' });
  }, caption);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: false });
  await page.locator('#proof-mark').evaluate((el) => el.remove());
}

for (const width of [1440, 390, 320]) {
  test(`Lender packet on the funding-papers page at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const box = { state: 'full', writes: [], downloads: [], download: 'pdf', leftOut: [] };
    await wire(page, box);

    // FULL: one row per packet, what is missing, and an outline download button
    // (the client's next step is still an upload, so that is the filled one).
    await page.goto('/app/money-vault.html');
    const card = page.locator('.vt-packet');
    await expect(card).toBeVisible();
    await expect(card.getByRole('heading', { name: 'Lender packet' })).toBeVisible();
    await expect(card.locator('.vt-pk')).toHaveCount(2);
    await expect(card).toContainText('3 of 5 papers ready · 4 files in the PDF');
    await expect(card).toContainText('Credit summary — not on file yet');
    await expect(card).toContainText('Business bank statements, last 3 months — sent, we\'re checking it');
    await expect(card.locator('.vt-btn-primary')).toHaveCount(0);
    await expect(page.locator('.vt-btn-primary')).toHaveCount(1);
    await noSideways(page, 'full');
    await bigTargets(page);
    await markedShot(page, `packet-full-${width}`, 'Lender packet: ready papers, what is missing, one-tap PDF');

    // ONE TAP: the PDF saves to the device and the card says so.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('button', { name: /Download packet — Personal/ }).click()
    ]);
    expect(download.suggestedFilename()).toBe('lender-packet-personal-2026-10-07.pdf');
    await expect(card.locator('.vt-msg')).toContainText('Saved your lender packet.');
    expect(box.downloads).toEqual(['personal']);

    // A file that did not fit is named after the download.
    box.leftOut = [{ id: '0d0c0000-0000-4000-8000-000000000004', reason: 'too_big' }];
    await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('button', { name: /Download packet — Fundhub LLC/ }).click()
    ]);
    await expect(card.locator('.vt-msg')).toContainText('Not in it: fundhub-llc-jul.pdf (too big to add). Send that one on its own.');

    // A refusal is said in words, where the person is looking.
    box.download = 'nothing';
    await card.getByRole('button', { name: /Download packet — Personal/ }).click();
    await expect(card.locator('.vt-msg [role="alert"]')).toContainText('Nothing is ready to put in the packet yet.');
    await expect(card.getByRole('button', { name: /Download packet — Personal/ })).toBeEnabled();
    box.download = 'pdf';

    // COMPLETE: nothing else to do, so the packet is the one filled button.
    box.state = 'complete';
    await page.reload();
    await expect(card).toContainText('Every paper is ready.');
    await expect(card.locator('.vt-btn-primary')).toHaveCount(1);
    await expect(page.locator('.vt-btn-primary')).toHaveCount(1);
    await noSideways(page, 'complete');
    await bigTargets(page);
    await markedShot(page, `packet-complete-${width}`, 'Every paper ready: Download packet is the one filled button');

    // EMPTY: no file to put in, so no button — a plain sentence instead.
    box.state = 'empty';
    await page.reload();
    await expect(card).toContainText('Nothing is ready to put in it yet.');
    await expect(card.getByRole('button')).toHaveCount(0);
    await noSideways(page, 'empty');
    await markedShot(page, `packet-empty-${width}`, 'Nothing ready yet: no dead button');

    // PACKET CHECK FAILED: the vault still shows; the card says what happened.
    box.state = 'error-packets';
    await page.reload();
    await expect(card).toContainText('We could not check the lender packet just now.');
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(page.locator('.vt-groups')).toBeVisible();

    // VAULT ERROR and LOADING: the page's own states, no card.
    box.state = 'error';
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('We could not load your papers');
    await expect(page.locator('.vt-packet')).toHaveCount(0);
    box.state = 'loading';
    await page.reload();
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expect(page.locator('.vt-packet')).toHaveCount(0);

    expect(box.writes).toEqual([]);
    await assertPageAlive(page, errors);
  });
}

test('Lender packet inside FinanceOS (Funding papers tab) at 390', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 900 });
  await withSession(page, { staff: { role: 'client' } });
  const errors = trackErrors(page);
  const box = { state: 'full', writes: [], downloads: [], download: 'pdf', leftOut: [] };
  await wire(page, box);
  await page.goto('/app/financeos.html#vault');
  const card = page.locator('#fos-vault .vt-packet');
  await expect(card).toBeVisible();
  await expect(card.locator('.vt-pk')).toHaveCount(2);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card.getByRole('button', { name: /Download packet — Personal/ }).click()
  ]);
  expect(download.suggestedFilename()).toBe('lender-packet-personal-2026-10-07.pdf');
  await expect(card.locator('.vt-msg')).toContainText('Saved your lender packet.');
  await noSideways(page, 'financeos vault');
  await bigTargets(page);
  await markedShot(page, 'packet-financeos-390', 'FinanceOS Funding papers: the same packet card');
  expect(box.writes).toEqual([]);
  await assertPageAlive(page, errors);
});
