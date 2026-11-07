// Finance OS + Blueprint premium pass (unit PREM, 2026-11-07; board
// ops/workflows/finance-os-cfo-build-2026-11-06.txt). The real pages in a real
// browser, clicked like a person, at 1440, 390 and 320. Every /api answer is
// fake and fictional (one made-up sample person). The monthly report is drawn
// by the server's own renderer (src/finance/monthly-report.mjs) so the
// download is a real PDF. No database, no network, no live data.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { withSession, json, trackErrors } from './harness.mjs';
import { buildTrends, addDays } from '../src/finance/money-trends.mjs';
import { buildCreditHistory } from '../src/finance/credit-history.mjs';
import { buildMonthlyReport, renderMonthlyReportPdf } from '../src/finance/monthly-report.mjs';

const evidence = 'ops/workflows/build-evidence/prem';
const ASOF = '2026-11-06T15:00:00Z';
const TODAY = '2026-11-06';
const BOOK = 'https://apply.fundhub.ai/schedule/phonecall';
const CLIENT = 'aaaaaaaa-1111-4111-8111-111111111111';

const FUND = {
  ok: true, client: { id: CLIENT, name: 'Portal Sample' }, has_pull: true, sample: true,
  now: { score: 4, score_max: 6, unknown: 0, tier: 'not_fundable', funding_estimate_cents: null },
  opportunity: { personal: { currentCents: 9360000, projectedCents: 10400000, blockers: [] }, source: { asOf: '2026-11-06T12:00:00Z' } }
};
const READY = {
  ok: true, status: 'none', round: 0, task_id: null, process: 'blueprint-csm-prep',
  advisor: { name: 'Jordan Sample', role: 'csm' }, book_url: BOOK,
  offers: { blueprint: { owned: true, name: 'Capital Blueprint', sell: null }, financeos: { entitled: true, setup_url: null } }
};
/* One round, one letter of each kind (Codex CX22, CX23): Experian mailed by the
   client with the receipt uploaded, Equifax sent on the bureau's website,
   TransUnion still with the mail house (no receipt yet). */
const REPAIR = {
  ok: true, currentRound: 'R1', executionOwner: 'client', stage: 'Letters sent',
  cases: [
    { id: 'c-1', bureau: 'Experian', round: 'R1', status: 'awaiting_response', responseDueAt: '2026-12-06T00:00:00Z',
      letters: [{ id: 'l-1', status: 'sent', submission: { channel: 'mail', receiptDocumentId: 'd-1', reference: '9400 1000 0000', submittedAt: '2026-11-06T12:00:00Z' } }] },
    { id: 'c-2', bureau: 'Equifax', round: 'R1', status: 'awaiting_response', responseDueAt: '2026-12-07T00:00:00Z',
      letters: [{ id: 'l-2', status: 'sent', submission: { channel: 'portal', receiptDocumentId: 'd-2', reference: 'EQ-123456', submittedAt: '2026-11-07T12:00:00Z' } }] },
    { id: 'c-3', bureau: 'TransUnion', round: 'R1', status: 'open', responseDueAt: null,
      letters: [{ id: 'l-3', status: 'sending', submission: null }] }
  ],
  actions: { canGenerate: false }
};
const REPAIR_LINE = 'Round 1 · 1 mailed · 1 sent online · 1 sending · Reply due Dec 6';
const MAILING = { ok: true, letters: [], orders: [], capabilities: { mailSupported: true }, priceCents: 9700 };
const FUNDING = {
  ok: true, engagement: { id: 'e-1', roundNumber: 1, status: 'active', executionOwner: 'client' }, state: 'awaiting_response',
  applications: [{ id: 'a-1', status: 'Approved' }, { id: 'a-2', status: 'Pending' }, { id: 'a-3', status: 'Apply', reportedStatus: 'pending' }], lenders: []
};

/* 90 days of fictional daily balances for the sparklines. */
const DAYS = Array.from({ length: 90 }, (_, i) => addDays(TODAY, i - 89));
const rollups = DAYS.map((day, i) => ({
  day, cash_personal_cents: String(600000 + Math.round(Math.sin(i / 6) * 40000) + i * 500), cash_personal_floor: false,
  cash_business_cents: String(1250000 + i * 900), cash_business_floor: false, cash_unknown_cents: null, cash_unknown_floor: false,
  debt_total_cents: String(1225000 - i * 2900), debt_total_floor: false, debt_personal_cents: String(1225000 - i * 2900),
  debt_business_cents: null, debt_unknown_cents: null, cards_used_pct: String(25 - i * 0.2), estimated: false, source: 'snapshot'
}));
const TRENDS = buildTrends({ client: { id: CLIENT, first_name: 'Portal', last_name: 'Sample' }, asOf: ASOF, range: '90d', rollups, choices: [] });

/* Three sample pulls for the credit chart (stamped simulated, so the screen
   says Sample): scores cross from Fair into Good. Same shape as the credit
   spec's fixture (e2e/page_money_credit.spec.mjs). */
const crsRow = (id, at, s) => ({ id, created_at: at,
  result: { environment: 'simulated', simulated: true, scores: { ex: s[0], eq: s[1], tu: s[2] }, scoreModels: {}, tradelines: [], businessReports: [] } });
const CREDIT = {
  ...structuredClone(bundle.reads['/api/money/credit']),
  credit_history: buildCreditHistory({ crsRows: [
    crsRow('p1', '2026-09-06T12:00:00Z', [652, 660, 655]),
    crsRow('p2', '2026-10-06T12:00:00Z', [671, 676, 674]),
    crsRow('p3', '2026-11-06T12:00:00Z', [712, 718, 715])
  ], businesses: [] })
};

/* What the client may read. `blueprint: false` is a FinanceOS-only client. */
async function routeApi(page, { blueprint = true, fund = 'ok', seen = [] } = {}) {
  let fundCalls = 0;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    seen.push(path + url.search);
    if (route.request().method() !== 'GET') return json(route, { ok: false, error: 'sample_read_only' }, 409);
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { role: 'client', name: 'Portal Sample' } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/overview' && url.searchParams.get('report') === 'monthly') {
      const month = url.searchParams.get('month');
      const report = buildMonthlyReport({ month, asOf: new Date(ASOF), client: { name: 'Portal Sample' }, trends: TRENDS, fund: FUND });
      return route.fulfill({ status: 200, contentType: 'application/pdf', headers: { 'content-disposition': `attachment; filename="fundhub-report-${month}.pdf"` }, body: Buffer.from(await renderMonthlyReportPdf(report)) });
    }
    if (path === '/api/money/fundability') {
      fundCalls++;
      if (fund === 'fail-once' && fundCalls === 1) return json(route, { ok: false, error: 'server_error' }, 500);
      return json(route, FUND);
    }
    if (path === '/api/money/ready-to-fund') return json(route, READY);
    if (path === '/api/money/trends') return json(route, TRENDS);
    if (path === '/api/money/credit') return json(route, CREDIT);
    if (path.startsWith('/api/blueprint/')) {
      if (!blueprint) return json(route, { ok: false, error: 'full_blueprint_required' }, 403);
      if (path === '/api/blueprint/repair') return json(route, REPAIR);
      if (path === '/api/blueprint/letter-mailing') return json(route, MAILING);
      if (path === '/api/blueprint/funding') return json(route, FUNDING);
    }
    return json(route, bundle.reads[path] || { ok: true, items: [] });
  });
}

/* Every visible control in `scope` is a real 44x44 target, and nothing in it
   runs past its own card or the page. */
async function fits(page, scope) {
  return page.evaluate((scope) => {
    const out = { small: [], clipped: [], wide: document.documentElement.scrollWidth > innerWidth + 1 };
    for (const root of document.querySelectorAll(scope)) {
      for (const el of root.querySelectorAll('a,button,select,input')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.width < 44 || r.height < 44) out.small.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim() + ` ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      for (const el of root.querySelectorAll('.card,.fh-hero,.fh-more-grid,.fh-report')) {
        if (el.scrollWidth > el.clientWidth + 1) out.clipped.push(el.className);
        const r = el.getBoundingClientRect();
        if (r.right > innerWidth + 1 || r.left < -1) out.clipped.push('off-page: ' + el.className);
      }
    }
    return out;
  }, scope);
}

async function shot(page, name, selector) {
  fs.mkdirSync(evidence, { recursive: true });
  if (selector) {
    await page.evaluate((s) => { const n = document.querySelector(s); if (n) { n.scrollIntoView({ block: 'start' }); scrollBy(0, -90); } }, selector);
  }
  // Charts draw in over 0.9 s the first time they are on screen: shoot the finished picture.
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: false });
}

for (const width of [1440, 390, 320]) {
  test(`Overview: the funding hero, the advisor, repair, funding and the monthly report at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const seen = [];
    await routeApi(page, { seen });
    await page.goto('/app/financeos.html#overview');

    // The hero: UnderwriteIQ's figure, the plan line, and the ring with N of 6.
    const hero = page.locator('#fos-overview .fh-hero');
    await expect(hero.locator('.fh-hero-num')).toHaveText('$93,600', { timeout: 15_000 });
    await expect(hero).toContainText('With your plan: $104,000');
    await expect(hero).toContainText('Estimate · UnderwriteIQ · Nov 6');
    await expect(hero.locator('.fh-ring')).toHaveAttribute('aria-label', 'Fundability 4 of 6');
    await expect(hero.locator('.fh-hero-tier')).toHaveText('Not fundable yet');

    // The advisor: the CSM on the file and Book a call on the owner-set page.
    const adv = page.locator('#fos-overview .fh-advisor');
    await expect(adv).toContainText('Jordan Sample');
    await expect(adv.getByRole('link', { name: 'Book a call' })).toHaveAttribute('href', BOOK);
    await expect(adv.getByRole('link', { name: 'Book a call' })).toHaveAttribute('target', '_blank');

    // Repair and Funding: one line each, opening the views in the portal.
    const repair = page.locator('#fos-overview .fh-work-card[data-kind="repair"]');
    await expect(repair.locator('.fh-work-line')).toHaveText(REPAIR_LINE);
    await expect(repair.getByRole('link', { name: 'Open repair' })).toHaveAttribute('href', '/app/client-portal.html#repair');
    await expect(repair.getByRole('link', { name: 'Letters and mailing' })).toHaveAttribute('href', '/app/client-portal.html#letters');
    const funding = page.locator('#fos-overview .fh-work-card[data-kind="funding"]');
    await expect(funding.locator('.fh-work-line')).toHaveText('Round 1 · 3 applied · 1 approved');
    await expect(funding.getByRole('link', { name: 'Open applications' })).toHaveAttribute('href', '/app/client-portal.html#funding');
    await expect(page.locator('#fos-overview .fh-more-grid')).toHaveAttribute('data-n', '3');

    // The monthly report: this month and the 11 before it.
    const report = page.locator('#fos-overview .fh-report');
    await expect(report.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    expect(await report.locator('select option').count()).toBe(12);

    // Weekly sparklines in the tiles, drawn from the Trends read.
    await expect(page.locator('#fos-overview [data-fh-spark="cash.personal"] svg.fh-spark')).toHaveCount(1);
    await expect(page.locator('#fos-overview [data-fh-spark="debt.total"] svg.fh-spark')).toHaveCount(1);
    await expect(page.locator('#fos-overview [data-fh-spark="cash.business"] svg.fh-spark')).toHaveCount(1);

    // Format: every control 44x44, nothing clipped, nothing sideways.
    await page.waitForTimeout(1200);
    const f = await fits(page, '#fos-overview .fh-premium-slot');
    expect(f.small, 'controls under 44x44').toEqual([]);
    expect(f.clipped, 'cards that overflow or leave the page').toEqual([]);
    expect(f.wide, 'no sideways scroll').toBe(false);
    for (const sel of ['.fh-report select']) {
      expect(await page.locator('#fos-overview ' + sel).evaluate((n) => getComputedStyle(n).fontSize), sel).toBe('16px');
    }
    await shot(page, `prem-fos-hero-${width}`, '#fos-overview .head');
    await shot(page, `prem-fos-cards-${width}`, '#fos-overview [data-fh-premium-slot="more"]');

    // Only reads: nothing was written, and no error was thrown.
    expect(seen.filter((p) => p.startsWith('/api/blueprint/')).sort()).toEqual(['/api/blueprint/funding', '/api/blueprint/letter-mailing', '/api/blueprint/repair']);
    expect(errors).toEqual([]);
  });
}

test('Overview: the monthly report downloads as a PDF for the chosen month', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await withSession(page, { staff: { role: 'client' } });
  const seen = [];
  await routeApi(page, { seen });
  await page.goto('/app/financeos.html#overview');
  const report = page.locator('#fos-overview .fh-report');
  const select = report.locator('select');
  await expect(select).toBeVisible({ timeout: 15_000 });
  const second = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(second);
  const [download] = await Promise.all([page.waitForEvent('download'), report.getByRole('button', { name: 'Download PDF' }).click()]);
  expect(download.suggestedFilename()).toBe(`fundhub-report-${second}.pdf`);
  const file = await download.path();
  expect(fs.readFileSync(file).subarray(0, 5).toString()).toBe('%PDF-');
  expect(seen).toContain(`/api/money/overview?report=monthly&month=${second}`);
  await expect(report.locator('.fh-report-msg')).toHaveText('Your report is downloading.');
  await expect(report.getByRole('button', { name: 'Download PDF' })).toBeEnabled();
});

test('Overview: a failed estimate says so and Try again loads it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await withSession(page, { staff: { role: 'client' } });
  await routeApi(page, { fund: 'fail-once' });
  await page.goto('/app/financeos.html#overview');
  const hero = page.locator('#fos-overview .fh-hero');
  await expect(hero).toContainText('We could not load your estimate.', { timeout: 15_000 });
  await hero.getByRole('button', { name: 'Try again' }).click();
  await expect(hero.locator('.fh-hero-num')).toHaveText('$93,600');
});

test('Overview: a FinanceOS-only client gets no Repair or Funding card; staff get no Book a call and no Blueprint reads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await withSession(page, { staff: { role: 'client' } });
  await routeApi(page, { blueprint: false });
  await page.goto('/app/financeos.html#overview');
  await expect(page.locator('#fos-overview .fh-advisor')).toContainText('Jordan Sample', { timeout: 15_000 });
  await expect(page.locator('#fos-overview .fh-work-card')).toHaveCount(0);
  await expect(page.locator('#fos-overview .fh-more-grid')).toHaveAttribute('data-n', '1');

  const staff = await page.context().newPage();
  await staff.setViewportSize({ width: 1440, height: 1000 });
  await withSession(staff, { staff: { role: 'admin' } });
  const seen = [];
  await routeApi(staff, { seen });
  await staff.goto(`/app/financeos.html?client_id=${CLIENT}#overview`);
  await expect(staff.locator('#fos-overview .fh-advisor')).toContainText('Jordan Sample', { timeout: 15_000 });
  await expect(staff.locator('#fos-overview .fh-advisor').getByRole('link', { name: 'Book a call' })).toHaveCount(0);
  await expect(staff.locator('#fos-overview .fh-work-card')).toHaveCount(0);
  expect(seen.some((p) => p.startsWith('/api/blueprint/'))).toBe(false);
  expect(seen).toContain(`/api/money/fundability?client_id=${CLIENT}`);
});

test('Motion: the hero counts up to exactly the printed amount; reduced motion moves nothing', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
    const page = await ctx.newPage();
    await withSession(page, { staff: { role: 'client' } });
    await routeApi(page);
    // Record every number the hero shows, from its first paint.
    await page.addInitScript(() => {
      window.__heroSeen = [];
      new MutationObserver(() => {
        const n = document.querySelector('.fh-hero-num');
        if (n && window.__heroSeen[window.__heroSeen.length - 1] !== n.textContent) window.__heroSeen.push(n.textContent);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.goto('/app/financeos.html#overview');
    await expect(page.locator('.fh-hero-num')).toHaveText('$93,600', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => window.__heroSeen);
    const value = (t) => Number(String(t).replace(/[$,]/g, ''));
    expect(seen.at(-1)).toBe('$93,600');
    const ring = page.locator('.fh-hero .fh-ring-fill');
    if (reducedMotion === 'reduce') {
      expect(seen, 'reduced motion: the number is printed once').toEqual(['$93,600']);
      expect(await ring.evaluate((n) => getComputedStyle(n).animationName)).toBe('none');
    } else {
      expect(seen.length, 'it counted').toBeGreaterThan(2);
      expect(value(seen[0])).toBeLessThan(93600);
      for (let i = 1; i < seen.length; i++) expect(value(seen[i]), 'never down, never past').toBeGreaterThanOrEqual(value(seen[i - 1]));
      expect(Math.max(...seen.map(value))).toBe(93600);
      expect(await ring.evaluate((n) => getComputedStyle(n).animationName)).toBe('fh-ring');
      // Printed words that are not this number's own words never move.
      const odd = await page.evaluate(async () => {
        const box = document.createElement('p');
        box.innerHTML = '<span data-fh-count="9360000" data-fh-fmt="usd0">at least $1</span>';
        document.querySelector('.fh-hero').prepend(box);
        const span = box.firstChild, texts = new Set([span.textContent]);
        new MutationObserver(() => texts.add(span.textContent)).observe(span, { childList: true, characterData: true, subtree: true });
        window.FHPremium.animate(box);
        await new Promise((r) => setTimeout(r, 1200));
        box.remove();
        return [...texts];
      });
      expect(odd).toEqual(['at least $1']);
    }
    await ctx.close();
  }
});

for (const width of [1440, 390, 320]) {
  test(`Charts: smooth curves over the same points, bars for money in and out, score bands at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    await routeApi(page);
    await page.goto('/app/financeos.html#overview');
    const detail = page.locator('#money-detail-history');
    await detail.waitFor({ state: 'attached', timeout: 15_000 });
    if (!(await detail.evaluate((n) => n.open))) await detail.locator(':scope > summary').click();
    const cash = page.locator('figure[data-chart="cash"]');
    await expect(cash).toBeVisible();
    await expect.poll(() => cash.locator('svg.tsvg').getAttribute('data-fh-smooth')).toBe('1');

    // One curve per straight line, starting where the line starts; the straight one is unseen.
    const lines = await page.locator('svg.tsvg polyline.tline').evaluateAll((ps) => ps.map((p) => ({
      start: p.getAttribute('points').trim().split(/\s+/)[0].split(',').map(Number).map((v) => v.toFixed(1)).join(' '),
      curve: p.nextElementSibling && p.nextElementSibling.getAttribute('d'),
      cls: p.getAttribute('class'), nextCls: p.nextElementSibling && p.nextElementSibling.getAttribute('class'),
      opacity: getComputedStyle(p).strokeOpacity
    })));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.curve.startsWith('M' + l.start), 'the curve starts on the first real point').toBe(true);
      expect(l.nextCls).toBe(l.cls + ' fh-curve');
      expect(l.opacity).toBe('0');
    }
    // Soft fill only under a lone line (the demo's rule): Cards used, not the two cash lines.
    await expect(page.locator('figure[data-chart="used"] path.fh-area')).toHaveCount(1);
    await expect(cash.locator('path.fh-area')).toHaveCount(0);

    // Money in and out: the demo's bars, axis words readable.
    const flow = page.locator('.card.flow[data-kind="personal"]');
    await expect(flow.locator('svg.fh-bars-svg')).toHaveCount(1);
    expect(await flow.locator('.fh-bars-x span').first().evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(13);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll').toBe(true);
    await shot(page, `prem-fos-trends-${width}`, 'figure[data-chart="cash"]');
    await shot(page, `prem-fos-bars-${width}`, '#h-flow');

    // Credit: FICO's own bands behind the score lines, the newest score in the legend.
    await page.locator('#tab-credit').evaluate((a) => a.click());
    const hist = page.locator('#fos-credit [data-hist]');
    await expect(hist.locator('.fh-bands-key')).toContainText('Good 670–739', { timeout: 15_000 });
    await expect(hist.locator('.fh-bands-key')).toContainText('Fair 580–669');
    await expect(hist.locator('svg.chart rect.fh-band').first()).toBeAttached();
    await expect(hist.locator('.legend .fh-legend-val')).toHaveText(['712', '718', '715']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll on Credit').toBe(true);
    await shot(page, `prem-fos-credit-${width}`, '#fos-credit [data-hist]');
    expect(errors).toEqual([]);
  });
}

/* The Blueprint home and the progress page, on the sample workspace
   (implementation offer, "ready" stage). */
async function demoStage(page, url) {
  await page.goto(url);
  await page.waitForFunction(() => window.FHBlueprintDemo, null, { timeout: 15_000 });
  await page.evaluate(() => window.FHBlueprintDemo.setScenario('ready'));
  await page.reload();
}

for (const width of [1440, 390, 320]) {
  test(`Blueprint home: the advisor, Repair and Funding cards open the existing views, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = trackErrors(page);
    await demoStage(page, '/app/client-portal.html?demo=1&blueprint=full&offer=implementation');
    const row = page.locator('#blueprint-fulfillment .fh-bp-row');
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator('.fh-advisor')).toContainText('Your advisor');
    await expect(row.locator('.fh-work-card[data-kind="repair"] .fh-work-line')).toHaveText('Round 1 · 2 letters ready');
    await expect(row.locator('.fh-work-card[data-kind="funding"] .fh-work-line')).toHaveText('1 applied · 0 approved');
    const f = await fits(page, '#blueprint-fulfillment .fh-bp-row');
    expect(f.small, 'controls under 44x44').toEqual([]);
    expect(f.clipped).toEqual([]);
    expect(f.wide, 'no sideways scroll').toBe(false);
    await shot(page, `prem-bp-home-${width}`, '#blueprint-fulfillment .fh-bp-row');

    await row.getByRole('button', { name: 'Open repair' }).click();
    await expect(page.locator('#blueprint-fulfillment')).toContainText('Your credit repair work');
    await page.locator('#blueprint-fulfillment [data-bf-action="view"][data-view="today"]').first().click();
    await page.locator('#blueprint-fulfillment .fh-bp-row').getByRole('button', { name: 'Open applications' }).click();
    await expect(page.locator('#blueprint-fulfillment')).toContainText('Your permitted banks');
    expect(errors).toEqual([]);
  });
}

/* The Blueprint path panel ("Funding you qualify for", blueprint-journey.js
   pathPanel) needs the plan's `path`, which the sample workspace does not have
   yet. This harness draws it with the real journey renderer from a fictional
   plan, announces the plan the way blueprint-plan.js does, and lets
   money-premium.js find it like it does on the portal. */
test('Blueprint path: the funding amount counts up to the printed figure and the ring shows N of 6, at 1440 and 390', async ({ page }) => {
  test.setTimeout(90_000);
  const harness = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<link rel="stylesheet" href="/app/fundhub-brand.css"><link rel="stylesheet" href="/app/blueprint-journey.css"><link rel="stylesheet" href="/app/money-premium.css">' +
    '<style>body{margin:0;padding:16px;background:#F8F8F6;font-family:var(--sans)}</style></head>' +
    '<body data-client-page="client-portal"><section id="blueprint-plan"></section>' +
    '<script src="/app/blueprint-journey.js"></script><script src="/app/money-premium.js"></script></body></html>';
  await page.route('**/fh-premium-harness.html', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: harness }));
  await withSession(page, { staff: { role: 'client' } });
  await routeApi(page);
  const plan = {
    businessPlans: { startedAt: '2026-10-06T12:00:00Z', businesses: [] },
    progress: { waypoints: [], nextStep: null, scores: { personal: [], business: [] } },
    path: {
      steps: [], milestones: [], counts: { done: 0, total: 0, percent: 0 },
      funding: { todayCents: 9360000, projectedCents: 10400000, change: null, business: { unlocked: false, text: 'Unlocks after your first business is on file' } },
      cards: { todayPct: 25, targetPct: 10 },
      fundability: { score: 4, max: 6, tier: 'not_fundable_yet', text: 'Fundability 4 of 6 · Not fundable yet' }
    }
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/fh-premium-harness.html');
    await page.evaluate((p) => {
      document.dispatchEvent(new CustomEvent('fh:blueprint-plan-updated', { detail: p }));
      document.getElementById('blueprint-plan').innerHTML = window.FHBlueprintJourney.render({ data: p, next: { title: 'Your next step', detail: '' } });
    }, plan);
    const path = page.locator('.bj-path');
    await expect(path.locator('.fh-bp-ring .fh-ring')).toHaveAttribute('aria-label', 'Fundability 4 of 6');
    await expect(path.locator('.bj-pathfund [data-fh-count="9360000"]')).toHaveText('$93,600');
    await expect(path.locator('.bj-pathfund')).toContainText('$93,600 → $104,000');
    await expect(path.locator('.bj-chip')).toHaveText('Fundability 4 of 6 · Not fundable yet', { message: 'the words stay beside the ring' });
    await expect(page.locator('.fh-bp-row .fh-advisor')).toContainText('Jordan Sample');
    await expect(page.locator('.fh-bp-row .fh-work-card[data-kind="repair"] .fh-work-line')).toHaveText(REPAIR_LINE);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll').toBe(true);
    await shot(page, `prem-bp-path-${width}`, '.bj-path');
  }
  // A printed amount that is not the plan's own figure never counts.
  await page.evaluate((p) => {
    const other = JSON.parse(JSON.stringify(p));
    other.path.funding.todayCents = 5000000;
    document.dispatchEvent(new CustomEvent('fh:blueprint-plan-updated', { detail: p }));
    document.getElementById('blueprint-plan').innerHTML = window.FHBlueprintJourney.render({ data: other, next: { title: 'Your next step', detail: '' } });
  }, plan);
  await expect(page.locator('.bj-path .fh-bp-ring')).toHaveCount(1);
  await expect(page.locator('.bj-path [data-fh-count]')).toHaveCount(0);
});

test('Blueprint deep links: #funding and #repair open those views, from another page or in place', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await demoStage(page, '/app/client-portal.html?demo=1&blueprint=full&offer=implementation');
  // Arriving from another page, as FinanceOS and the progress page link here.
  await page.goto('/progress.html?demo=1&blueprint=full&offer=implementation');
  await page.goto('/app/client-portal.html?demo=1&blueprint=full&offer=implementation#funding');
  await expect(page.locator('#blueprint-fulfillment')).toContainText('Your permitted banks', { timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
  // Already on the portal: the hash changes in place.
  await page.evaluate(() => { location.hash = 'repair'; });
  await expect(page.locator('#blueprint-fulfillment')).toContainText('Your credit repair work', { timeout: 20_000 });
});

for (const width of [1440, 390, 320]) {
  test(`Progress page: Repair and Funding, one line each, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: 1000 });
    await demoStage(page, '/progress.html?demo=1&blueprint=full&offer=implementation');
    const work = page.locator('#cWork');
    await expect(work).toBeVisible({ timeout: 20_000 });
    await expect(work.locator('h2')).toHaveText('Repair and funding');
    await expect(work.locator('.fh-work-card[data-kind="repair"] .fh-work-line')).toHaveText('Round 1 · 2 letters ready');
    await expect(work.getByRole('link', { name: 'Open applications' })).toHaveAttribute('href', /client-portal\.html.*#funding$/);
    const f = await fits(page, '#cWork');
    expect(f.small).toEqual([]);
    expect(f.clipped).toEqual([]);
    expect(f.wide).toBe(false);
    await shot(page, `prem-progress-${width}`, '#cWork');
  });
}
