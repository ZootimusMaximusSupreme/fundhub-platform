// The full credit report (unit RPT, Chris 2026-11-07): the web page at 1440,
// 390 and 320 wide, every page of the saved PDF drawn by pdf.js, and the old
// Blueprint screens in plain words. Fixtures only: the vendor's own CRS test
// files and the FinanceOS sample file. No backend, no database, no pull.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mergeBureauReports } from '../src/finance/crs-map.mjs';
import { buildCrsFullReportPdf, renderCrsFullReportHtml } from '../src/finance/crs-full-report.mjs';
import { buildSampleCreditFile } from '../src/finance/sample-credit-file.mjs';
import { planMixedSandboxUser } from '../src/banking/plaid-sandbox-user.mjs';
import { buildBlueprintClientPlan } from '../src/blueprint/client-plan.mjs';
import { preparationGuidance, websitePrompt } from '../src/blueprint/preparation-guidance.mjs';
import { readBlueprintCycle, letterCycle, inquiryCall } from '../src/blueprint/fulfillment-cycle.mjs';
import { bureauDialPlan } from '../src/inquiry-ops/bureau-dial-plan.mjs';

const EVIDENCE = process.env.RPT_EVIDENCE_DIR || 'ops/workflows/build-evidence/RPT';
const WIDTHS = [[1440, 900], [390, 844], [320, 740]];
const PDFJS = 'node_modules/pdfjs-dist';
const load = rel => JSON.parse(fs.readFileSync(rel, 'utf8'));

/* The vendor's own test files: charge-offs, a bankruptcy, a medical account
   with no name, lates, 51 inquiries. */
function sandboxResult() {
  return mergeBureauReports({ reports: { EX: load('vendor/underwriteiq-crs/sandbox/exp.json'),
    EQ: load('vendor/underwriteiq-crs/sandbox/efx.json'), TU: load('vendor/underwriteiq-full/api/lite/crs/sandbox/tu.json') },
  environment: 'production', pulledAt: '2026-11-06T18:00:00Z' });
}
/* One person, one file: the FinanceOS sample (src/finance/sample-credit-file.mjs). */
function sampleResult() {
  const pulledAt = '2026-11-06T18:00:00.000Z';
  const v = planMixedSandboxUser({ today: new Date(pulledAt) }).facts.accounts.find(a => a.name === 'Personal Visa');
  return buildSampleCreditFile({ pulledAt, person: { first: 'Sample', last: 'Client' }, visa: { mask: v.mask,
    balanceCents: v.currentCents, limitCents: v.limitCents, aprPct: v.purchaseApr, minimumPaymentCents: v.minimumPaymentCents,
    highBalanceCents: v.maxEodCents, lastActivityOn: v.lastPostedOn } }).payload;
}
/* The same sample with Equifax frozen and TransUnion never asked. */
function partialResult() {
  const result = structuredClone(sampleResult());
  delete result.bureaus.EQ;
  delete result.bureaus.TU;
  result.bureauStatus = { EX: 'file_returned', EQ: 'frozen' };
  result.scores = { ...result.scores, eq: null, tu: null };
  return result;
}
const FILES = { sample: { result: sampleResult(), name: 'Sample Client' }, sandbox: { result: sandboxResult(), name: 'Sandbox Test File' },
  partial: { result: partialResult(), name: 'Sample Client' } };

async function layout(page) {
  return page.evaluate(() => {
    const visible = el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
    const small = [...document.querySelectorAll('a[href],button')].filter(visible)
      .map(el => ({ text: el.textContent.trim().slice(0, 30), w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height }))
      .filter(c => c.w < 44 || c.h < 44);
    const clipped = [...document.querySelectorAll('body *')].filter(el => visible(el) && el.scrollWidth > el.clientWidth + 1
      && !['visible', 'clip'].includes(getComputedStyle(el).overflowX)).map(el => el.className || el.tagName);
    // Nothing pokes out of the white sheet, and the sheet stays on the screen.
    const sheet = document.querySelector('.rpt-sheet').getBoundingClientRect();
    const offPage = [...document.querySelectorAll('.rpt-sheet *')].filter(visible).filter(el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.left < sheet.left - 0.5 || r.right > sheet.right + 0.5);
    }).map(el => el.className || el.tagName).slice(0, 5);
    if (sheet.left < 0 || sheet.right > innerWidth + 0.5) offPage.push('rpt-sheet');
    const tinyText = [...document.querySelectorAll('.rpt-sheet *')].filter(el => visible(el)
      && [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())
      && parseFloat(getComputedStyle(el).fontSize) < 13).map(el => el.className || el.tagName).slice(0, 5);
    return { wide: document.documentElement.scrollWidth, view: innerWidth, small, clipped, offPage, tinyText };
  });
}

for (const [key, file] of Object.entries(FILES)) {
  test(`the credit report page reads like a real report at 1440, 390 and 320 (${key})`, async ({ page }) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const html = renderCrsFullReportHtml(file.result, { clientName: file.name });
    await page.route('**/__rpt/report.html', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('/__rpt/report.html');
    await expect(page.getByRole('img', { name: 'Fundhub' })).toBeVisible();
    for (const label of ['Credit scores', 'Summary', 'Accounts', 'Inquiries', 'Public records', 'Personal info']) {
      await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    }
    await expect(page.locator('.rpt-meta')).toContainText(file.name);
    for (const [width, height] of WIDTHS) {
      await page.setViewportSize({ width, height });
      const found = await layout(page);
      expect(found.wide, `${key} at ${width}: no sideways scroll`).toBeLessThanOrEqual(width);
      expect(found.small, `${key} at ${width}: every control is 44 by 44`).toEqual([]);
      expect(found.clipped, `${key} at ${width}: nothing clipped`).toEqual([]);
      expect(found.offPage, `${key} at ${width}: nothing off the page`).toEqual([]);
      expect(found.tinyText, `${key} at ${width}: no text under 13px`).toEqual([]);
      await page.screenshot({ path: `${EVIDENCE}/report-${key}-${width}.png`, fullPage: true });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({ path: `${EVIDENCE}/report-${key}-${width}-top.png` });
      await page.locator('section[aria-labelledby="rpt-accounts"]').screenshot({ path: `${EVIDENCE}/report-${key}-${width}-accounts.png` });
    }
  });

  test(`every page of the saved PDF draws cleanly (${key})`, async ({ page }) => {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    const pdf = await buildCrsFullReportPdf(file.result, { clientName: file.name });
    fs.writeFileSync(`${EVIDENCE}/report-${key}.pdf`, pdf);
    await page.route('**/__rpt/**', route => {
      const name = new URL(route.request().url()).pathname.replace('/__rpt/', '');
      if (name === 'report.pdf') return route.fulfill({ contentType: 'application/pdf', body: pdf });
      if (name === 'view.html') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body style="margin:0;background:#9aa0a0">
        <div id="pages" style="display:grid;gap:12px;padding:12px;justify-content:start"></div>
        <script type="module">
          import * as pdfjs from '/__rpt/build/pdf.mjs';
          pdfjs.GlobalWorkerOptions.workerSrc = '/__rpt/build/pdf.worker.mjs';
          const data = await (await fetch('/__rpt/report.pdf')).arrayBuffer();
          const doc = await pdfjs.getDocument({ data, standardFontDataUrl: '/__rpt/standard_fonts/' }).promise;
          for (let n = 1; n <= doc.numPages; n++) {
            const p = await doc.getPage(n);
            const viewport = p.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width; canvas.height = viewport.height; canvas.dataset.page = String(n);
            canvas.style.cssText = 'background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.3)';
            document.getElementById('pages').append(canvas);
            await p.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          }
          window.__pages = doc.numPages;
        </script></body></html>` });
      const file = path.join(PDFJS, name);
      if (!/^(build\/pdf(\.worker)?\.mjs|standard_fonts\/[\w.-]+)$/.test(name) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ contentType: name.endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream', body: fs.readFileSync(file) });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 960, height: 1260 });
    await page.goto('/__rpt/view.html');
    await page.waitForFunction(() => window.__pages > 0, null, { timeout: 20_000 });
    const pages = await page.evaluate(() => window.__pages);
    expect(errors).toEqual([]);
    expect(pages).toBeGreaterThanOrEqual(2);
    for (let n = 1; n <= pages; n++) {
      await page.locator(`canvas[data-page="${n}"]`).screenshot({ path: `${EVIDENCE}/pdf-${key}-page-${n}.png` });
    }
  });
}

/* ── The old Blueprint screens, in plain words ── */
const ORG = '10000000-0000-4000-8000-000000000001';
const CLIENT = '20000000-0000-4000-8000-000000000002';
const ACCOUNT = '30000000-0000-4000-8000-000000000003';
const ENGAGEMENT = '40000000-0000-4000-8000-000000000004';
const REPAIR_LETTER = '70000000-0000-4000-8000-000000000007';
const REPAIR_V = '71000000-0000-4000-8000-000000000007';
const CASE = '80000000-0000-4000-8000-000000000008';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openWorkspace(page) {
  const scope = { orgId: ORG, clientId: CLIENT, now: new Date('2026-11-07T18:00:00Z') };
  const plans = { orgId: ORG, clientId: CLIENT, version: 1, targetBusinessCount: 1, setupStep: 3, startedAt: '2026-10-01T12:00:00Z',
    hasExistingBusiness: false, homeState: 'AZ', postalCode: '85004', availableCashCents: 600000, monthlyIncomeCents: 750000,
    cashBufferCents: 200000, oneTimePayoffCents: null, payoffPlan: null, businesses: [], existingBusinesses: [], stepProgress: [] };
  const progress = { waypoints: [{ id: 'w1', key: 'card_paydown_1', title: 'Pay Card A down to $400', detail: 'Any payment helps.', state: 'not_started', owner: 'client' }],
    nextStep: { waypointId: 'w1', owner: 'client' }, scores: { personal: [], business: [] } };
  const plan = () => buildBlueprintClientPlan({ query: async sql => {
    if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT, org_id: ORG, first_name: 'Alex', last_name: 'Sample', custom_fields: {} }] };
    if (/FROM crs_results|FROM documents/.test(sql)) return { rows: [] };
    throw new Error('Unexpected browser-fixture query');
  } }, scope, { readBusinessPlans: async () => structuredClone(plans), readClientProgress: async () => structuredClone(progress),
    bankStrategy: async () => null, preparationGuidance, websitePrompt, readBlueprintPath: async () => null,
    rankLocalCreditUnions: async () => ({ status: 'candidates_for_review', source: { name: 'Offline fixture', asOf: '2026-06' }, candidates: [] }),
    readCycle: (database, s) => readBlueprintCycle(database, s, { path: { fundability: { tier: 'fundable' } },
      readAccess: async () => ({ status: 'active' }), readReports: async () => [] }) });
  const engagement = { id: ENGAGEMENT, orgId: ORG, clientId: CLIENT, status: 'active', executionOwner: 'client', roundId: null };
  const funding = { ok: true, engagement, state: 'ready', nextAction: 'Open your next eligible lender on your own device.',
    lenders: [{ id: 'l-1', name: 'Fixture Community Bank', productName: 'Business card', businessId: null, available: true, reason: null },
      { id: 'l-2', name: 'Fixture Credit Union', productName: 'Personal card', businessId: null, available: false, reason: 'later_in_order' }],
    applications: [], submissionsClosed: false, canFinishSubmissions: false };
  const items = [{ id: 'i1', name: 'Fixture Card Bank', state: 'open' }];
  const inquiries = { ok: true, cases: [{ id: CASE, bureau: 'EX', status: 'In progress', executionOwner: 'client',
    packet: { complete: true, missing: [], uploads: [] }, portalUrl: 'https://www.experian.com/help/dispute-credit/', documentUploadUrl: null,
    call: { status: 'idle', canLaunch: false }, inquiries: items, documents: [],
    actions: { canRecordSubmission: false, canLaunchCall: false, canCheckSavedEvidence: false },
    selfCall: inquiryCall({ bureau: 'EX', inquiries: items, name: 'Alex Sample', dial: bureauDialPlan({ env: {} }) }) }] };
  const repair = { ok: true, program: null, authorization: { signed: true, packetComplete: true, missing: [], uploads: [] },
    stage: 'Round 1 letters are ready.', currentRound: 'R1', executionOwner: 'client', actions: { canGenerate: false },
    cases: [{ id: 'case-r1', bureau: 'EQ', round: 'R1', status: 'open', items: [{ id: 'r1', creditor: 'Fixture Collections', status: 'open' },
      { id: 'r2', creditor: 'Fixture Store Card', status: 'deleted' }],
      letters: [{ id: 'l1', documentId: REPAIR_LETTER, bureau: 'EQ', round: 'R1', target: 'bureau', status: 'generated', canRecordSubmission: false, submission: null,
        ...letterCycle({ bureau: 'EQ', versionId: REPAIR_V, approvals: new Map() }) }] }] };
  await page.addInitScript(() => localStorage.setItem('fh_token', 'rpt-browser-fixture'));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const p = url.pathname;
    const method = route.request().method();
    if (p === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { id: ACCOUNT, org_id: ORG, client_id: CLIENT, role: 'client', principal_kind: 'client', name: 'Alex Sample', status: 'active' } });
    if (p === '/api/blueprint/plan') return json(route, await plan());
    if (p === '/api/blueprint/funding' && method === 'GET') return json(route, funding);
    if (p === '/api/blueprint/inquiries' && method === 'GET') return json(route, inquiries);
    if (p === '/api/blueprint/repair' && method === 'GET') return json(route, repair);
    if (p === '/api/blueprint/services' && method === 'GET') return json(route, { ok: true, engagement, allowance: { includedAvailable: false }, serviceTypes: [], requests: [], capabilities: {} });
    if (p === '/api/blueprint/letter-mailing' && method === 'GET') return json(route, { ok: true, letters: [], orders: [], capabilities: { mailSupported: true, hostedCheckoutSupported: true }, priceCents: 9700, maxLetters: 6 });
    if (p === '/api/money/ready-to-fund') return json(route, { ok: true, status: 'none', round: 0, task_id: null, offers: { blueprint: { owned: true } } });
    if (p.includes('portal-summary')) return json(route, { ok: true, documents: [], scores: {}, soft_pull_complete: true, dispute_consent: { allowed: false }, stage: { key: 'paid' }, upcoming_call: null });
    if (method !== 'GET') return json(route, { ok: false, error: 'read_only_fixture' }, 405);
    return json(route, { ok: true, items: [], rows: [], documents: [], payments: [] });
  });
  await page.goto('/app/client-portal.html');
  const host = page.locator('#blueprint-fulfillment');
  await expect(host.getByText('Your next bank is ready')).toBeVisible();
  return host;
}

async function shoot(page, selector, name) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    const chat = page.locator('#fh-chat-close');
    if (await chat.isVisible().catch(() => false)) await chat.click();
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    const box = await target.evaluate(el => {
      const r = el.getBoundingClientRect();
      const clipped = [...el.querySelectorAll('*')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'visible').length;
      return { left: r.left, right: r.right, clipped, wide: document.documentElement.scrollWidth };
    });
    expect(box.wide, `${name} at ${width}: no sideways scroll`).toBeLessThanOrEqual(width);
    expect(box.left, `${name} at ${width}: starts on the page`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${name} at ${width}: ends on the page`).toBeLessThanOrEqual(width);
    expect(box.clipped, `${name} at ${width}: nothing clipped`).toBe(0);
    // The phone's fixed bottom bar floats over the page; hide it only for the picture.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && el.getBoundingClientRect().top > innerHeight / 2) el.setAttribute('data-rpt-hide', '');
      }
      const style = document.createElement('style');
      style.id = 'rpt-shot';
      style.textContent = '[data-rpt-hide]{visibility:hidden!important}';
      document.head.append(style);
    });
    const tall = Math.ceil(await target.evaluate(el => el.getBoundingClientRect().height));
    if (tall + 160 > height) await page.setViewportSize({ width, height: tall + 160 });
    await target.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await target.screenshot({ path: `${EVIDENCE}/${name}-${width}.png` });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      document.getElementById('rpt-shot')?.remove();
      for (const el of document.querySelectorAll('[data-rpt-hide]')) el.removeAttribute('data-rpt-hide');
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('old Blueprint screens: bureau names, call state, round, letter title and lender reason in plain words', async ({ page }) => {
  const host = await openWorkspace(page);
  await host.locator('[data-bf-action="view"][data-view="funding"]').first().click();
  const later = host.locator('.bf-item', { hasText: 'Fixture Credit Union' });
  await expect(later.getByText('Later', { exact: true })).toBeVisible();
  await expect(host).not.toContainText('later_in_order');
  await shoot(page, '#blueprint-fulfillment .bf-item:has-text("Fixture Credit Union")', 'screen-lender-later');

  await host.locator('[data-bf-action="view"][data-view="inquiries"]').first().click();
  const inquiryCase = host.locator('.bf-item').first();
  await expect(inquiryCase.getByRole('heading', { name: 'Experian · In progress', exact: true })).toBeVisible();
  await expect(inquiryCase.getByText('Not called yet', { exact: true })).toBeVisible();
  await expect(inquiryCase.getByRole('link', { name: 'Open Experian portal ↗', exact: true })).toBeVisible();
  await expect(host).not.toContainText('EX ·');
  await expect(host).not.toContainText('Bureau call');
  await expect(host).not.toContainText('idle');
  await shoot(page, '#blueprint-fulfillment .bf-item', 'screen-inquiry-case');

  await host.locator('[data-bf-action="view"][data-view="repair"]').first().click();
  const repairCase = host.locator('.bf-item').first();
  await expect(repairCase.getByRole('heading', { name: 'Equifax · Round 1 · Open', exact: true })).toBeVisible();
  await expect(repairCase.getByRole('heading', { name: 'Equifax letter, round 1', exact: true })).toBeVisible();
  await expect(repairCase.getByText('Ready', { exact: true })).toBeVisible();
  await expect(repairCase.getByText('Fixture Store Card · Removed', { exact: true })).toBeVisible();
  await expect(repairCase).not.toContainText('generated');
  await expect(repairCase).not.toContainText('EQ ·');
  await expect(repairCase.getByRole('heading', { name: 'bureau', exact: true })).toHaveCount(0);
  await shoot(page, '#blueprint-fulfillment .bf-item', 'screen-repair-letter');
});
