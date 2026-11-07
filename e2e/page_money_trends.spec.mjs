// Finance OS Trends — a line for each account, and any dates (CFO build, unit
// A, 2026-11-07; board ops/workflows/finance-os-cfo-build-2026-11-06.txt items
// 2 and 3). The real page in a real browser, clicked like a person: pick an
// account, type From and To, press the buttons. Every /api answer is fake and
// fictional ("Sample" accounts, one made-up person). The trends answers are
// built by the server's own builder (src/finance/money-trends.mjs), so the
// screen and the read are checked against one contract. No database, no
// network, no live data.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import bundle from '../src/demo/client-portal-sample-bundle.json' with { type: 'json' };
import { withSession, json, trackErrors } from './harness.mjs';
import { buildTrends, accountChoices, pickAccount, readWindow, addDays } from '../src/finance/money-trends.mjs';

const evidence = 'ops/workflows/build-evidence/finance-os-trends-accounts-2026-11-07';
const ASOF = '2026-11-06T15:00:00Z';
const TODAY = '2026-11-06';

const ENTS = [{ id: 'e-p', kind: 'personal', name: 'Sample Person' }, { id: 'e-b', kind: 'business', name: 'Sample LLC' }];
const ACCOUNTS = [
  { id: 'a-chk', name: 'Sample Checking', mask: '0001', account_type: 'depository', account_subtype: 'checking', entity_id: 'e-p', institution_name: 'Sample Bank' },
  { id: 'a-card', name: 'Sample Rewards Card', mask: '5678', account_type: 'credit', account_subtype: 'credit card', entity_id: 'e-p', institution_name: 'Sample Bank' },
  { id: 'a-biz', name: 'Sample Business Checking', mask: '4455', account_type: 'depository', account_subtype: 'checking', entity_id: 'e-b', institution_name: 'Sample Bank' }
];
const CHOICES = accountChoices({ accounts: ACCOUNTS, entities: ENTS, asOf: ASOF });

/* 120 days back from today. Nov 1-2 are missing (a gap). The card has no limit
   on Oct 30 (limit used is a break there). The first 20 days are estimated. */
const DAYS = Array.from({ length: 120 }, (_, i) => addDays(TODAY, i - 119));
const SKIP = new Set(['2026-11-01', '2026-11-02']);
const rollups = DAYS.filter((d) => !SKIP.has(d)).map((day, i) => ({
  day, cash_personal_cents: String(400000 + i * 900), cash_personal_floor: false,
  cash_business_cents: String(1800000 + i * 2500), cash_business_floor: false,
  cash_unknown_cents: null, cash_unknown_floor: false,
  debt_total_cents: String(520000 - i * 300), debt_total_floor: false,
  debt_personal_cents: String(320000 - i * 300), debt_business_cents: '200000', debt_unknown_cents: null,
  cards_used_pct: String(32 - i * 0.03), estimated: i < 20, source: i < 20 ? 'backfill' : 'snapshot'
}));
const accountRows = (id) => DAYS.filter((d) => !SKIP.has(d)).map((day, i) => {
  if (id === 'a-card') {
    return { day, current_balance_cents: String(320000 - i * 1000), credit_limit_cents: day === '2026-10-30' ? null : '1000000', estimated: false };
  }
  return { day, current_balance_cents: String((id === 'a-biz' ? 1800000 : 400000) + i * 1000), estimated: i < 20 };
});

/* The fake read: parse the query like the endpoint does, then build. */
function trendsAnswer(url) {
  const q = Object.fromEntries(new URL(url).searchParams);
  const win = readWindow({ range: q.range, from: q.from, to: q.to });
  if (!win.ok) return { status: 400, body: { ok: false, error: win.error } };
  const account = q.account ? pickAccount(CHOICES, q.account) : null;
  if (q.account && !account) return { status: 404, body: { ok: false, error: 'not_found' } };
  return {
    status: 200,
    body: buildTrends({
      client: { id: 'sample-1', first_name: 'Portal', last_name: 'Sample' }, asOf: ASOF,
      range: win.range, from: win.from, to: win.to, rollups, choices: CHOICES,
      account, accountRows: account ? accountRows(account.id) : []
    })
  };
}

/* The bank plan (GET /api/money/banks deposit_plan, unit E's contract), all
   fictional. Window: 90 days to Nov 6. Dec 15 and Jan 20 are ahead (drawn on
   the stretched axis), Oct 20 is inside the window, one has no date, one is
   more than six months out. */
const PLAN = [
  { lender_id: 'l-a', name: 'Sample Bank', logo: '/sample-logos/sample-bank.svg', kind: 'bank', open_by: '2026-12-15', deposit_cents: 500000, season_days: 60, reason: 'Sample reason: a small opening deposit.', status: 'planned' },
  { lender_id: 'l-b', name: 'Sample Credit Union', logo: null, kind: 'credit_union', open_by: '2027-01-20', deposit_cents: 250000, season_days: null, reason: 'Sample reason: members can open a business account.', status: 'planned' },
  { lender_id: 'l-c', name: 'Sample Trust', logo: null, kind: 'bank', open_by: '2026-10-20', deposit_cents: 300000, season_days: 90, reason: 'Sample reason: keeps money close to home.', status: 'deposited' },
  { lender_id: 'l-d', name: 'Sample Savings', logo: null, kind: 'bank', open_by: null, deposit_cents: 100000, season_days: null, reason: 'Sample reason: the date waits on your LLC.', status: 'planned' },
  { lender_id: 'l-e', name: 'Sample Far Bank', logo: null, kind: 'bank', open_by: '2027-09-01', deposit_cents: null, season_days: null, reason: '', status: 'planned' }
];
const SAMPLE_LOGO = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#F0F1ED"/></svg>';

/* banks: 'bundle' (the sample bundle's answer, no plan), 'plan', 'fail' (500) or 'hang' (never answers). */
async function openTrends(page, asked, { banks = 'bundle' } = {}) {
  const held = [];
  await page.route('**/sample-logos/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: SAMPLE_LOGO }));
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const path = new URL(url).pathname;
    if (route.request().method() !== 'GET') return json(route, { ok: false, error: 'sample_read_only' }, 409);
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', portal_sample_available: true, portal_sample: true, staff: { role: 'client', name: 'Portal Sample' } });
    if (path === '/api/read/affiliate-portal') return json(route, { ok: true, enrolled: false });
    if (path === '/api/money/trends') {
      asked.push(Object.fromEntries(new URL(url).searchParams));
      const a = trendsAnswer(url);
      return json(route, a.body, a.status);
    }
    if (path === '/api/money/banks' && banks !== 'bundle') {
      if (banks === 'fail') return json(route, { ok: false, error: 'server_error' }, 500);
      if (banks === 'hang') { held.push(route); return; }
      return json(route, { ...bundle.reads[path], deposit_plan: PLAN });
    }
    return json(route, bundle.reads[path] || { ok: true, items: [] });
  });
  page.once('close', () => held.forEach((r) => r.abort().catch(() => {})));
  await page.goto('/app/financeos.html#overview');
  const detail = page.locator('#money-detail-history');
  await detail.waitFor({ state: 'attached' });
  if (!(await detail.evaluate((n) => n.open))) await detail.locator(':scope > summary').click();
  await page.locator('figure[data-chart="cash"]').waitFor();
}

async function markedShot(page, name, selector, caption) {
  await page.evaluate(({ selector, caption }) => {
    const el = document.querySelector(selector), r = el.getBoundingClientRect();
    const box = document.createElement('div'); box.id = 'proof-mark';
    Object.assign(box.style, { position: 'absolute', left: r.left + scrollX - 4 + 'px', top: r.top + scrollY - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px', border: '3px solid #d02525', borderRadius: '6px', pointerEvents: 'none', zIndex: 150 });
    const text = document.createElement('span'); text.textContent = caption;
    Object.assign(text.style, { position: 'absolute', left: '0', top: '-24px', padding: '2px 6px', color: '#fff', background: '#d02525', font: '600 12px Arial,sans-serif', whiteSpace: 'nowrap', borderRadius: '4px' });
    box.appendChild(text); document.body.appendChild(box);
  }, { selector, caption });
  // Bring the marked part near the top, clear of the phone's bottom bar.
  await page.evaluate((selector) => { document.querySelector(selector).scrollIntoView({ block: 'start' }); scrollBy(0, -140); }, selector);
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: false });
  await page.locator('#proof-mark').evaluate((el) => el.remove());
}

const pressed = (page) => page.locator('.trange-btn[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-range')));

for (const width of [1440, 390, 320]) {
  test(`Trends: pick one account, any dates, and back, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    const asked = [];
    await openTrends(page, asked);

    // 1. All accounts, 90 days: the picker lists the open accounts by kind.
    expect(asked[0]).toEqual({ range: '90d' });
    const picker = page.locator('[data-trends-account]');
    await expect(picker).toBeVisible();
    expect(await picker.locator('option').allTextContents()).toEqual([
      'All accounts',
      'Sample Checking ••0001 · Checking',
      'Sample Rewards Card ••5678 · Card',
      'Sample Business Checking ••4455 · Checking'
    ]);
    expect(await picker.locator('optgroup').evaluateAll((g) => g.map((x) => x.label))).toEqual(['Personal', 'Business']);
    await expect(page.locator('[data-trends-from]')).toHaveValue(addDays(TODAY, -89));
    await expect(page.locator('[data-trends-to]')).toHaveValue(TODAY);

    // Every control is a real target and real text size, and nothing scrolls sideways.
    for (const sel of ['[data-trends-account]', '[data-trends-from]', '[data-trends-to]', '[data-trends-show]', '.trange-btn']) {
      const box = await page.locator(sel).first().boundingBox();
      expect(box.height, `${sel} is at least 44px tall`).toBeGreaterThanOrEqual(44);
    }
    for (const sel of ['[data-trends-account]', '[data-trends-from]', '[data-trends-to]']) {
      expect(await page.locator(sel).evaluate((n) => getComputedStyle(n).fontSize), `${sel} text`).toBe('16px');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll').toBe(true);
    if (width !== 320) await markedShot(page, `trends-tools-${width}`, '.trends .ttools', 'Account picker and From / To beside the range buttons');

    // 2. Pick the card: its own lines, owed with the limit, and limit used.
    await picker.selectOption('a-card');
    await expect(page.locator('figure[data-chart="acct-used"]')).toBeVisible();
    expect(asked.at(-1)).toEqual({ range: '90d', account: 'a-card' });
    await expect(page.locator('figure[data-chart="cash"]')).toHaveCount(0);
    await expect(page.locator('.tacct-name')).toHaveText('Sample Rewards Card ••5678');
    const owed = page.locator('figure[data-chart="acct-balance"]');
    await expect(owed.locator('.tlegend')).toContainText('Owed $2,030.00');
    await expect(owed.locator('.tlegend')).toContainText('Limit $10,000.00');
    const used = page.locator('figure[data-chart="acct-used"]');
    await expect(used.locator('.tlegend')).toContainText('Limit used 20.3%');
    // Nov 1-2 have no row and Oct 30 has no limit: no point is drawn for them, never 0%.
    const usedTitles = await used.locator('.thit title').allTextContents();
    expect(usedTitles.some((t) => /Nov (1|2), 2026/.test(t))).toBe(false);
    expect(usedTitles.some((t) => /Oct 30, 2026/.test(t))).toBe(false);
    expect(usedTitles.some((t) => /Oct 31, 2026: 20\.7%/.test(t))).toBe(true);
    // Two pieces of line (to Oct 29, from Nov 3); Oct 31 sits alone between two breaks, so it is a dot.
    expect(await used.locator('polyline.tline').count(), 'the line breaks at each gap and is never bridged').toBe(2);
    const lastPointOfFirstPiece = await used.locator('polyline.tline').first().getAttribute('points');
    expect(lastPointOfFirstPiece.trim().split(/\s+/).length, 'the first piece runs Aug 9 to Oct 29').toBe(82);
    await expect(picker).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll on one account').toBe(true);
    if (width !== 320) await markedShot(page, `trends-one-card-${width}`, '.trends .grid.two', 'One card: owed with its limit, and limit used');

    // 3. Dates the wrong way round: the page says so and asks for nothing.
    const before = asked.length;
    await page.locator('[data-trends-from]').fill('2026-10-20');
    await page.locator('[data-trends-to]').fill('2026-10-10');
    await page.locator('[data-trends-show]').click();
    await expect(page.locator('[data-trends-msg]')).toHaveText('From has to be on or before To.');
    expect(asked.length).toBe(before);

    // 4. Good dates: asked for exactly those days, for the same card; no preset pressed.
    await page.locator('[data-trends-to]').fill('2026-11-05');
    await page.locator('[data-trends-show]').click();
    await expect(page.locator('[data-trends-from]')).toHaveValue('2026-10-20');
    expect(asked.at(-1)).toEqual({ from: '2026-10-20', to: '2026-11-05', account: 'a-card' });
    expect(await pressed(page)).toEqual([]);
    await expect(page.locator('[data-trends-msg]')).toHaveText('');
    await expect(used.locator('.tx span').first()).toHaveText('Oct 20');
    await expect(used.locator('.tx span').last()).toHaveText('Nov 5');
    expect(await page.evaluate(() => sessionStorage.getItem('fos_trends_dates'))).toBe('2026-10-20|2026-11-05');

    // 5. Back to all accounts on the same dates.
    await picker.selectOption('');
    await expect(page.locator('figure[data-chart="cash"]')).toBeVisible();
    expect(asked.at(-1)).toEqual({ from: '2026-10-20', to: '2026-11-05' });
    await expect(page.locator('figure[data-chart="acct-balance"]')).toHaveCount(0);

    // 6. A range button clears the dates: 30 days, pressed, and remembered.
    await page.locator('.trange-btn[data-range="30d"]').click();
    await expect(page.locator('.trange-btn[data-range="30d"]')).toHaveAttribute('aria-pressed', 'true');
    expect(asked.at(-1)).toEqual({ range: '30d' });
    await expect(page.locator('[data-trends-from]')).toHaveValue(addDays(TODAY, -29));
    expect(await page.evaluate(() => [sessionStorage.getItem('fos_trends_range'), sessionStorage.getItem('fos_trends_dates')])).toEqual(['30d', null]);

    expect(errors).toEqual([]);
  });
}

test('Trends at 390px: every new control is at least 44px tall, nothing scrolls sideways, the phone bar is untouched', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await withSession(page, { staff: { role: 'client' } });
  const asked = [];
  await openTrends(page, asked);
  // Every one, not just the first: the three range buttons, the picker, both dates, the button.
  const controls = [
    ['30 days button', '.trange-btn[data-range="30d"]'], ['90 days button', '.trange-btn[data-range="90d"]'],
    ['12 months button', '.trange-btn[data-range="12m"]'], ['Account picker', '[data-trends-account]'],
    ['From date', '[data-trends-from]'], ['To date', '[data-trends-to]'], ['Show these dates', '[data-trends-show]']
  ];
  for (const [name, sel] of controls) {
    const el = page.locator(sel);
    await expect(el, name).toBeVisible();
    const box = await el.boundingBox();
    expect(box.height, `${name} is at least 44px tall at 390px`).toBeGreaterThanOrEqual(44);
    expect(box.x, `${name} starts on screen`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${name} ends on screen`).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll at 390px').toBe(true);
  // The client bottom bar is the page's own; this build adds nothing to it and hides nothing.
  await expect(page.locator('.client-ios-nav')).toBeVisible();
  // Same check with one card picked: the account charts fit too.
  await page.locator('[data-trends-account]').selectOption('a-card');
  await expect(page.locator('figure[data-chart="acct-used"]')).toBeVisible();
  for (const [name, sel] of controls) {
    expect((await page.locator(sel).boundingBox()).height, `${name} with one account picked`).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll with one account').toBe(true);
});

test('Trends: chosen dates survive a reload in the same tab; a 24-month-plus pick is refused on the page', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await withSession(page, { staff: { role: 'client' } });
  const asked = [];
  await openTrends(page, asked);
  await page.locator('[data-trends-from]').fill('2024-11-05');
  await page.locator('[data-trends-to]').fill('2026-11-06');
  await page.locator('[data-trends-show]').click();
  await expect(page.locator('[data-trends-msg]')).toHaveText('Pick 24 months or less between From and To.');
  expect(asked.length).toBe(1);
  await page.locator('[data-trends-from]').fill('2024-11-06');
  await page.locator('[data-trends-show]').click();
  await expect.poll(() => asked.length).toBe(2);
  expect(asked[1]).toEqual({ from: '2024-11-06', to: '2026-11-06' });
  // A two-year window labels its axis with the year.
  await expect(page.locator('figure[data-chart="cash"] .tx span').first()).toHaveText('Nov 2024');
  asked.length = 0;
  await page.reload();
  const detail = page.locator('#money-detail-history');
  await detail.waitFor({ state: 'attached' });
  if (!(await detail.evaluate((n) => n.open))) await detail.locator(':scope > summary').click();
  await page.locator('figure[data-chart="cash"]').waitFor();
  expect(asked[0]).toEqual({ from: '2024-11-06', to: '2026-11-06' });
  expect(await pressed(page)).toEqual([]);
});

/* ---- Bank waypoints on the Cash chart (2026-11-07) ---- */

for (const width of [1440, 390, 320]) {
  test(`Waypoints: bank markers on the Cash chart, hover, tap and keyboard, at ${width}`, async ({ page }) => {
    test.setTimeout(120_000);
    fs.mkdirSync(evidence, { recursive: true });
    await page.setViewportSize({ width, height: 1000 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    await openTrends(page, [], { banks: 'plan' });
    const cash = page.locator('figure[data-chart="cash"]');
    const marks = cash.locator('.twp');
    await expect(marks).toHaveCount(3);
    expect(await marks.evaluateAll((b) => b.map((x) => x.getAttribute('data-waypoint')))).toEqual(['l-c', 'l-a', 'l-b']);

    // The owner's sentence and the bank book's reason are the button's name.
    await expect(cash.locator('[data-waypoint="l-a"]')).toHaveAttribute('aria-label',
      'Open Sample Bank and deposit $5,000.00 by Dec 15, 2026. Sample reason: a small opening deposit. Status: Planned.');
    // A logo when there is one; the name in a chip when there is none.
    await expect(cash.locator('[data-waypoint="l-a"] img.twp-logo')).toHaveCount(1);
    await expect(cash.locator('[data-waypoint="l-b"] .twp-chip')).toHaveText('Sample Credit Union');
    await expect(cash.locator('[data-waypoint="l-b"] img')).toHaveCount(0);

    // Every marker is a real target, on screen, and none sits on another.
    const boxes = [];
    for (const id of ['l-a', 'l-b', 'l-c']) {
      const box = await cash.locator(`[data-waypoint="${id}"]`).boundingBox();
      expect(box.width, `${id} is at least 44px wide`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${id} is at least 44px tall`).toBeGreaterThanOrEqual(44);
      expect(box.x, `${id} starts on screen`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${id} ends on screen`).toBeLessThanOrEqual(width);
      boxes.push(box);
    }
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const p = boxes[i], q = boxes[j];
      const overlap = p.x < q.x + q.width && q.x < p.x + p.width && p.y < q.y + q.height && q.y < p.y + p.height;
      expect(overlap, 'two markers never sit on top of each other').toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll with markers').toBe(true);

    // The money lines stop at today: no line point to the right of the today line.
    const xs = await cash.locator('svg.tsvg').evaluate((svg) => {
      const today = Number(svg.querySelector('.ttoday').getAttribute('x1'));
      const pts = [...svg.querySelectorAll('polyline.tline')].flatMap((p) => p.getAttribute('points').trim().split(/\s+/).map((v) => Number(v.split(',')[0])));
      return { today, max: Math.max(...pts) };
    });
    expect(xs.today).toBeLessThan(600);
    expect(xs.max).toBeLessThanOrEqual(xs.today + 0.05);
    await expect(cash.locator('line.tguide')).toHaveCount(3);

    // The rows the strip cannot draw are listed in words, and not drawn.
    const notes = cash.locator('.tplan-notes');
    await expect(notes).toContainText('Date not set');
    await expect(notes).toContainText('Open Sample Savings and deposit $1,000.00.');
    await expect(notes).toContainText('Not on these dates');
    await expect(notes).toContainText('Open Sample Far Bank by Sep 1, 2027.');
    await expect(cash.locator('[data-waypoint="l-d"], [data-waypoint="l-e"]')).toHaveCount(0);

    // Hover on a desktop, a tap on a phone: the tip says it, inside the screen.
    const a = cash.locator('[data-waypoint="l-a"]');
    const tipA = cash.locator('[data-waypoint="l-a"] + .twp-tip');
    await expect(tipA).toBeHidden();
    if (width === 1440) await a.hover();
    else { await a.click(); await expect(a).toHaveAttribute('data-open', 'true'); }
    await expect(tipA).toBeVisible();
    await expect(tipA).toContainText('Open Sample Bank and deposit $5,000.00 by Dec 15, 2026.');
    await expect(tipA).toContainText('Sample reason: a small opening deposit.');
    await expect(tipA).toContainText('Status: Planned');
    const tb = await tipA.boundingBox();
    expect(tb.x).toBeGreaterThanOrEqual(0);
    expect(tb.x + tb.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'no sideways scroll with a tip open').toBe(true);
    // On a phone the tip stays open from the tap alone; take the pointer away so no hover tip joins it.
    if (width !== 1440) await page.mouse.move(0, 0);
    if (width !== 320) await markedShot(page, `waypoints-${width}`, 'figure[data-chart="cash"]', 'Bank waypoints on the Plan strip, one tip open');
    if (width !== 1440) { await a.click(); await expect(a).not.toHaveAttribute('data-open', 'true'); }
    await page.mouse.move(0, 0);
    await expect(tipA).toBeHidden();

    // Keyboard: Tab reaches the next marker and shows its words; Enter keeps
    // them open; Escape closes them.
    const b = cash.locator('[data-waypoint="l-b"]');
    const tipB = cash.locator('[data-waypoint="l-b"] + .twp-tip');
    await a.focus();
    await page.keyboard.press('Tab');
    await expect(b).toBeFocused();
    await expect(tipB).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(b).toHaveAttribute('data-open', 'true');
    await page.keyboard.press('Escape');
    await expect(b).not.toHaveAttribute('data-open', 'true');

    // The plan stays after a range change: 30 days starts Oct 8, so all three are still on it.
    await page.locator('.trange-btn[data-range="30d"]').click();
    await expect(page.locator('.trange-btn[data-range="30d"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('figure[data-chart="cash"] .twp')).toHaveCount(3);
    expect(errors).toEqual([]);
  });
}

for (const banks of ['fail', 'hang']) {
  test(`Waypoints: a banks read that ${banks === 'fail' ? 'fails' : 'never answers'} leaves the chart as it was`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await withSession(page, { staff: { role: 'client' } });
    const errors = trackErrors(page);
    await openTrends(page, [], { banks });
    const cash = page.locator('figure[data-chart="cash"]');
    await expect(cash.locator('svg.tsvg')).toBeVisible();
    await expect(cash.locator('.tlegend')).toContainText('Personal');
    await page.waitForTimeout(500);
    await expect(cash.locator('.twp, .tplan, line.tguide, line.ttoday')).toHaveCount(0);
    await expect(page.locator('[data-trends-retry]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}
