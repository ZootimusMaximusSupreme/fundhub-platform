// The client fulfillment cycle (unit CYCLE): the pieces added inside the
// existing Blueprint views, driven through the real page with every /api/**
// answered here from the real server modules (no backend, no database).
// Screens are checked and saved at 1440, 390 and 320 wide.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { buildBlueprintClientPlan } from '../src/blueprint/client-plan.mjs';
import { preparationGuidance, websitePrompt } from '../src/blueprint/preparation-guidance.mjs';
import { readBlueprintCycle, fullReportRows, letterCycle, applicationGuide, inquiryCall } from '../src/blueprint/fulfillment-cycle.mjs';
import { bureauDialPlan } from '../src/inquiry-ops/bureau-dial-plan.mjs';

const ORG = '10000000-0000-4000-8000-000000000001';
const CLIENT = '20000000-0000-4000-8000-000000000002';
const ACCOUNT = '30000000-0000-4000-8000-000000000003';
const ENGAGEMENT = '40000000-0000-4000-8000-000000000004';
const REPORT = '50000000-0000-4000-8000-000000000005';
const LETTER = '60000000-0000-4000-8000-000000000006';
const LETTER_V = '61000000-0000-4000-8000-000000000006';
const REPAIR_LETTER = '70000000-0000-4000-8000-000000000007';
const REPAIR_V = '71000000-0000-4000-8000-000000000007';
const CASE = '80000000-0000-4000-8000-000000000008';
const LENDER = '90000000-0000-4000-8000-000000000009';
const EVIDENCE = process.env.CYCLE_EVIDENCE_DIR || 'ops/workflows/build-evidence/cycle';
const WIDTHS = [[1440, 900], [390, 844], [320, 740]];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/* journeyPath draws "Funding you qualify for" (with the look-ahead slot); lookahead(url)
   answers GET /api/money/fundability?view=lookahead ({ status, body } for an error). */
async function open(page, { offer = 'preparation', fundable = false, failApprove = false, journeyPath = null, lookahead = null } = {}) {
  const writes = [];
  const approvals = new Map();
  let ready = { status: 'none', round: 0, task_id: null };
  const scope = { orgId: ORG, clientId: CLIENT, now: new Date('2026-11-07T18:00:00Z') };
  const plans = { orgId: ORG, clientId: CLIENT, version: 1, targetBusinessCount: 1, setupStep: 3, startedAt: '2026-10-01T12:00:00Z',
    hasExistingBusiness: false, homeState: 'AZ', postalCode: '85004', availableCashCents: 600000, monthlyIncomeCents: 750000,
    cashBufferCents: 200000, oneTimePayoffCents: null, payoffPlan: null, businesses: [], existingBusinesses: [], stepProgress: [] };
  const progress = { waypoints: [{ id: 'w1', key: 'card_paydown_1', title: 'Pay Card A down to $400', detail: 'Any payment helps.', state: 'not_started', owner: 'client' }],
    nextStep: { waypointId: 'w1', owner: 'client' }, scores: { personal: [], business: [] } };
  const reports = fullReportRows([
    { document_id: REPORT, version: 1, generated_at: '2026-10-06T12:00:00Z' },
    { document_id: REPORT, version: 2, generated_at: '2026-11-06T12:00:00Z' }]);
  async function plan() {
    const db = { query: async sql => {
      if (/FROM clients/.test(sql)) return { rows: [{ id: CLIENT, org_id: ORG, first_name: 'Alex', last_name: 'Sample', custom_fields: {} }] };
      if (/FROM crs_results/.test(sql)) return { rows: [] };
      if (/FROM documents/.test(sql)) return { rows: [] };
      throw new Error('Unexpected browser-fixture query');
    } };
    return buildBlueprintClientPlan(db, scope, {
      readBusinessPlans: async () => structuredClone(plans), readClientProgress: async () => structuredClone(progress),
      bankStrategy: async () => null, preparationGuidance, websitePrompt,
      rankLocalCreditUnions: async () => ({ status: 'candidates_for_review', source: { name: 'Offline fixture', asOf: '2026-06' }, candidates: [] }),
      readBlueprintPath: async () => (journeyPath ? structuredClone(journeyPath) : null),
      readCycle: (database, s) => readBlueprintCycle(database, s, {
        path: { fundability: { tier: fundable ? 'fundable' : 'not_fundable_yet' } },
        readAccess: async () => (offer === 'implementation' ? { status: 'active' } : null),
        readReports: async () => reports })
    });
  }
  const letterRow = () => ({ documentId: LETTER, title: 'Experian inquiry letter', subtype: 'funding_inquiry_removal', bureau: 'EX',
    generatedAt: '2026-11-06T12:00:00Z', eligibleForMailing: true, reason: null,
    ...letterCycle({ bureau: 'EX', versionId: LETTER_V, approvals }) });
  const engagement = { id: ENGAGEMENT, orgId: ORG, clientId: CLIENT, status: 'active', executionOwner: 'client', roundId: null };
  const funding = () => ({ ok: true, engagement, state: 'ready', nextAction: 'Open your next eligible lender on your own device.',
    lenders: [{ id: LENDER, name: 'Fixture Community Bank', productName: 'Business card', businessId: null, available: true, reason: null }],
    applications: [], submissionsClosed: false, canFinishSubmissions: false,
    guide: applicationGuide({ income: { ok: true, detected_as_of: '2026-11-06', by_kind: { personal: { monthly_cents: 750000 }, business: { monthly_cents: null } } },
      plan: { monthlyIncomeCents: 750000 }, businessCount: 1 }) });
  const caseItems = [{ id: 'i1', name: 'Fixture Card Bank', state: 'open' }, { id: 'i2', name: 'Fixture Auto Lender', state: 'open' }];
  const inquiries = () => ({ ok: true, cases: [{ id: CASE, bureau: 'EX', status: 'In progress', executionOwner: 'client',
    packet: { complete: true, missing: [], uploads: [] }, portalUrl: null, documentUploadUrl: null, call: { status: 'idle', canLaunch: false },
    inquiries: caseItems, documents: [], actions: { canRecordSubmission: true, canLaunchCall: false, canCheckSavedEvidence: false },
    selfCall: inquiryCall({ bureau: 'EX', inquiries: caseItems, name: 'Alex Sample', dial: bureauDialPlan({ env: {} }) }) }] });
  const repair = () => ({ ok: true, program: null, authorization: { signed: true, packetComplete: true, missing: [], uploads: [] },
    stage: 'Round 1 letters are ready.', currentRound: 'R1', executionOwner: 'client', actions: { canGenerate: false },
    cases: [{ id: 'case-r1', bureau: 'EQ', round: 'R1', status: 'open', items: [{ id: 'r1', creditor: 'Fixture Collections', status: 'open' }],
      letters: [{ id: 'l1', documentId: REPAIR_LETTER, bureau: 'EQ', round: 'R1', target: 'bureau', status: 'generated', canRecordSubmission: true, submission: null,
        ...letterCycle({ bureau: 'EQ', versionId: REPAIR_V, approvals }) }] }] });

  await page.addInitScript(() => localStorage.setItem('fh_token', 'cycle-browser-fixture'));
  await page.context().route('https://apply.fundhub.ai/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fixture booking page</h1>' }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    if (path === '/api/auth/session') return json(route, { ok: true, principal: 'client', staff: { id: ACCOUNT, org_id: ORG, client_id: CLIENT, role: 'client', principal_kind: 'client', name: 'Alex Sample', status: 'active' } });
    if (path === '/api/blueprint/plan') return json(route, await plan());
    if (path === '/api/blueprint/funding' && method === 'GET') return offer === 'implementation' ? json(route, funding()) : json(route, { ok: false, error: 'full_blueprint_required' }, 403);
    if (path === '/api/blueprint/inquiries' && method === 'GET') return json(route, inquiries());
    if (path === '/api/blueprint/repair' && method === 'GET') return json(route, repair());
    if (path === '/api/blueprint/services' && method === 'GET') return json(route, { ok: true, engagement, allowance: { includedAvailable: false }, serviceTypes: [], requests: [], capabilities: {} });
    if (path === '/api/blueprint/letter-mailing' && method === 'GET') return json(route, { ok: true, letters: [letterRow()], orders: [], capabilities: { mailSupported: true, hostedCheckoutSupported: true }, priceCents: 9700, maxLetters: 6 });
    if (path === '/api/blueprint/letter-mailing' && method === 'POST') {
      const body = route.request().postDataJSON();
      writes.push({ path, body });
      const version = body.documentId === LETTER ? LETTER_V : REPAIR_V;
      const prior = approvals.get(version);
      if (failApprove) return json(route, { ok: false, error: 'letter_unavailable', message: 'That letter is not on your file.' }, 404);
      if (body.action === 'check_address' && !prior) return json(route, { ok: false, error: 'approve_first', message: 'Approve the letter first.' }, 409);
      approvals.set(version, body.action === 'approve_letter' ? (prior || { approved_at: '2026-11-07T18:00:00Z', address_checked_at: null })
        : { ...prior, address_checked_at: prior.address_checked_at || '2026-11-07T18:05:00Z' });
      return json(route, { ok: true, documentId: body.documentId, step: body.action, ...letterCycle({ bureau: body.documentId === LETTER ? 'EX' : 'EQ', versionId: version, approvals }) });
    }
    if (path === '/api/money/fundability' && lookahead && url.searchParams.get('view') === 'lookahead') {
      const answer = lookahead(url);
      return answer?.status ? json(route, answer.body, answer.status) : json(route, answer);
    }
    if (path === '/api/money/ready-to-fund') {
      if (method === 'POST') { writes.push({ path, body: route.request().postDataJSON() }); ready = { status: 'requested', round: 1, task_id: 'task-1' }; }
      return json(route, { ok: true, ...ready, offers: { blueprint: { owned: true } } });
    }
    if (path === '/api/documents-download') {
      writes.push({ path, query: Object.fromEntries(url.searchParams) });
      return json(route, { ok: true, document: { id: url.searchParams.get('id'), download: { url: '/api/documents/' + url.searchParams.get('id') + '?exp=2000000000&sig=fixture' } } });
    }
    if (path.startsWith('/api/documents/')) return route.fulfill({ contentType: 'text/html', body: '<h1>Fixture document</h1>' });
    if (path.includes('portal-summary')) return json(route, { ok: true, documents: [], scores: {}, soft_pull_complete: true, dispute_consent: { allowed: false }, stage: { key: 'paid' }, upcoming_call: null });
    return json(route, { ok: true, items: [], rows: [], documents: [], payments: [] });
  });
  await page.goto('/app/client-portal.html');
  return { writes };
}

async function checkFormat(page, selector, name) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  for (const [width, height] of WIDTHS) {
    await page.setViewportSize({ width, height });
    // The portal's own chat panel can open over the page on a phone; close it first.
    const chat = page.locator('#fh-chat-close');
    if (await chat.isVisible().catch(() => false)) await chat.click();
    const target = page.locator(selector).first();
    await target.scrollIntoViewIfNeeded();
    await expect(target).toBeVisible();
    const layout = await page.evaluate(sel => {
      const el = document.querySelector(sel);
      const box = el.getBoundingClientRect();
      // A checkbox's target is its label (the host's own pattern), so the label is measured.
      const small = [...el.querySelectorAll('button,a[href],input,select')].filter(c => c.offsetParent)
        .map(c => ['checkbox', 'radio'].includes(c.type) && c.closest('label') ? c.closest('label') : c)
        .map(c => ({ text: (c.textContent || c.getAttribute('aria-label') || '').trim().slice(0, 40), w: c.getBoundingClientRect().width, h: c.getBoundingClientRect().height }))
        .filter(c => c.w < 44 || c.h < 44);
      const clipped = [...el.querySelectorAll('*')].filter(c => c.offsetParent && c.scrollWidth > c.clientWidth + 1 && getComputedStyle(c).overflowX !== 'visible').length;
      return { pageWide: document.documentElement.scrollWidth, view: innerWidth, left: box.left, right: box.right, small, clipped };
    }, selector);
    expect(layout.pageWide, `${name} at ${width}: no sideways scroll`).toBeLessThanOrEqual(width);
    expect(layout.left, `${name} at ${width}: starts on the page`).toBeGreaterThanOrEqual(0);
    expect(layout.right, `${name} at ${width}: ends on the page`).toBeLessThanOrEqual(width);
    expect(layout.small, `${name} at ${width}: every control is 44 by 44`).toEqual([]);
    expect(layout.clipped, `${name} at ${width}: nothing clipped inside`).toBe(0);
    // The phone's fixed bottom bar floats over whatever scrolls under it. It is
    // hidden only while the picture is taken, so the picture shows the piece itself.
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('body *')) {
        const s = getComputedStyle(el);
        if (s.position === 'fixed' && el.getBoundingClientRect().bottom >= innerHeight - 2 && el.getBoundingClientRect().top > innerHeight / 2) el.setAttribute('data-cycle-shot-hide', '');
      }
      const style = document.createElement('style');
      style.id = 'cycle-shot';
      style.textContent = '[data-cycle-shot-hide]{visibility:hidden!important}';
      document.head.append(style);
    });
    // A tall piece in the page's own scroll box is shot whole: same width, taller window.
    const tall = Math.ceil(await target.evaluate(el => el.getBoundingClientRect().height));
    if (tall + 160 > height) await page.setViewportSize({ width, height: tall + 160 });
    await target.evaluate(el => el.scrollIntoView({ block: 'start' }));
    await target.screenshot({ path: `${EVIDENCE}/${name}-${width}.png` });
    await page.setViewportSize({ width, height });
    await page.evaluate(() => {
      document.getElementById('cycle-shot')?.remove();
      for (const el of document.querySelectorAll('[data-cycle-shot-hide]')) el.removeAttribute('data-cycle-shot-hide');
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test('every soft pull: the full credit report for each pull opens from the home screen', async ({ page }) => {
  const { writes } = await open(page);
  const card = page.locator('#blueprint-plan .bj-credit');
  await expect(card.getByText('Full credit reports')).toBeVisible();
  await expect(card.getByRole('button', { name: /Open the full credit report from Nov 6, 2026/ })).toBeVisible();
  await expect(card.getByRole('button', { name: /Open the full credit report from Oct 6, 2026/ })).toBeVisible();
  await expect(card.getByText('Newest')).toBeVisible();
  const popup = page.waitForEvent('popup');
  await card.getByRole('button', { name: /Oct 6, 2026/ }).click();
  await (await popup).waitForLoadState();
  expect(writes.find(w => w.path === '/api/documents-download')?.query).toEqual({ id: REPORT, version: '1' });
  await checkFormat(page, '#blueprint-plan .bj-credit', 'full-reports');
});

test('letters: approve, print, check the exact bureau address', async ({ page }) => {
  const { writes } = await open(page);
  await page.locator('#blueprint-plan [data-bp-action="view"][data-view="letters"]').click();
  const steps = page.locator('#blueprint-plan .bc-letter').first();
  await expect(steps).toContainText('P.O. Box 4500');
  await expect(steps).toContainText('Allen, TX 75013');
  await expect(steps.getByRole('button', { name: 'The address is right' })).toHaveCount(0);
  await checkFormat(page, '#blueprint-plan .bp-item', 'letter-before');
  await steps.getByRole('button', { name: 'Approve letter' }).click();
  await expect(page.locator('#blueprint-plan .bc-letter').first()).toContainText('✓ Approved');
  await page.locator('#blueprint-plan .bc-letter').first().getByRole('button', { name: 'The address is right' }).click();
  await expect(page.locator('#blueprint-plan .bc-letter').first()).toContainText('✓ Address checked');
  expect(writes.filter(w => w.path === '/api/blueprint/letter-mailing').map(w => w.body.action)).toEqual(['approve_letter', 'check_address']);
  const popup = page.waitForEvent('popup');
  await page.locator('#blueprint-plan .bc-letter').first().getByRole('button', { name: 'Open and print' }).click();
  await (await popup).waitForLoadState();
  await expect(page.getByText('Mail these letters for me · $97')).toBeVisible();
  await checkFormat(page, '#blueprint-plan .bp-item', 'letter-approved');
});

test('a refused approval says why, where the client is looking, and stays unapproved', async ({ page }) => {
  await open(page, { failApprove: true });
  await page.locator('#blueprint-plan [data-bp-action="view"][data-view="letters"]').click();
  const steps = page.locator('#blueprint-plan .bc-letter').first();
  await steps.getByRole('button', { name: 'Approve letter' }).click();
  await expect(steps.locator('.bc-status')).toHaveText('That letter is not on your file.');
  await expect(steps).not.toContainText('✓ Approved');
  await expect(steps.getByRole('button', { name: 'Approve letter' })).toBeEnabled();
});

test('fundable preparation buyer stops at Book a call with your CSM, and the CSM gets the task', async ({ page }) => {
  const { writes } = await open(page, { fundable: true });
  const next = page.locator('#blueprint-plan .bj-next');
  await expect(next).toContainText('You are fundable. Book a call with your CSM.');
  await expect(next).toContainText('UnderwriteIQ says your file is fundable.');
  await checkFormat(page, '#blueprint-plan .bj-next', 'csm-stop');
  const popup = page.waitForEvent('popup');
  await next.getByRole('button', { name: 'Book a call' }).click();
  await popup;
  await expect(next).toContainText('Your CSM will reach out.');
  expect(writes.filter(w => w.path === '/api/money/ready-to-fund')).toHaveLength(1);
});

test('not fundable yet, or a full implementation buyer: no stop', async ({ page }) => {
  await open(page, { fundable: false });
  await expect(page.locator('#blueprint-plan .bj-next')).toContainText('Pay Card A down to $400');
  await expect(page.getByRole('button', { name: 'Book a call' })).toHaveCount(0);
});

test('full implementation: application guide, call steps and repair letter steps', async ({ page }) => {
  await open(page, { offer: 'implementation', fundable: true });
  const host = page.locator('#blueprint-fulfillment');
  await expect(host.getByText('Your next bank is ready')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Book a call' })).toHaveCount(0);
  await host.locator('[data-bf-action="view"][data-view="funding"]').first().click();
  const guide = host.locator('.bc-guide');
  await expect(guide).toContainText('Your application guide');
  // Deposits are not income (Codex CX18): the first step is the client's own check, never "exact numbers".
  await expect(guide.locator('.bc-confirm')).toHaveText('Confirm your real income before you apply.');
  await expect(guide).not.toContainText(/exact/i);
  await expect(guide).toContainText('Personal income');
  await expect(guide).toContainText('$90,000 a year');
  await expect(guide).toContainText('From your plan');
  await expect(guide).toContainText('From your bank deposits');
  await expect(guide.locator('[data-estimate="true"]')).toHaveCount(1);
  await expect(guide.locator('[data-estimate="true"]')).toContainText('Household income');
  await expect(guide.locator('[data-estimate="true"] small')).toContainText(/^Estimate · \$7,500 a month · From your bank deposits$/);
  await expect(guide.locator('[data-estimate="false"]').filter({ hasText: 'Personal income' })).not.toContainText('Estimate');
  await expect(guide).toContainText('Business income');
  await expect(guide).toContainText('Not on file');
  await checkFormat(page, '#blueprint-fulfillment .bc-guide', 'application-guide');
  await host.locator('[data-bf-action="view"][data-view="inquiries"]').first().click();
  const call = host.locator('.bc-call');
  await expect(call).toContainText('Call Experian');
  await expect(call.getByRole('link', { name: '(855) 414-6048' })).toHaveAttribute('href', 'tel:+18554146048');
  await expect(call).toContainText('Please check: Fixture Card Bank, Fixture Auto Lender.');
  await expect(call).not.toContainText(/fraud/i);
  await checkFormat(page, '#blueprint-fulfillment .bf-item', 'inquiry-call');
  await host.locator('[data-bf-action="view"][data-view="repair"]').first().click();
  const letter = host.locator('.bc-letter');
  await expect(letter).toContainText('P.O. Box 740256');
  await expect(letter).toContainText('Atlanta, GA 30374-0256');
  await checkFormat(page, '#blueprint-fulfillment .bf-item', 'repair-letter');
  await letter.getByRole('button', { name: 'Approve letter' }).click();
  await expect(host.locator('.bc-letter')).toContainText('✓ Approved');
});

/* Codex CX30: the look-ahead inside "Funding you qualify for" (unit S) kept its first
   read forever, so Refresh left an old estimate on the card. Refresh reads it again. */
const AHEAD_PATH = { steps: [], milestones: [], counts: { done: 0, total: 0 },
  funding: { todayCents: 9360000, projectedCents: 10400000 }, cards: {}, fundability: { tier: 'not_fundable', text: '4 of 6' },
  cash: null, businesses: null, chexsystems: {} };
const aheadRead = cents => ({ ok: true, view: 'lookahead', has_pull: true, months: 9, now: { fundhub_score: { score: 62 } },
  points: [3, 6, 9, 12].map(m => ({ months: m, scenario: 'plan', tier: m >= 9 ? 'fundable' : 'not_fundable',
    funding_estimate_cents: m >= 9 ? cents : null, fundhub_score: { score: 60 + m } })) });

test('Refresh reads the look-ahead again, so the old estimate never stays on the card', async ({ page }) => {
  let answer = aheadRead(11100000);
  const asked = [];
  await open(page, { offer: 'implementation', journeyPath: AHEAD_PATH, lookahead: url => { asked.push(url.search); return answer; } });
  const host = page.locator('#blueprint-fulfillment');
  const card = host.locator('[data-bj-ahead]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('In 9 months on your plan · estimate');
  await expect(card).toContainText('$111,000');
  const first = asked.length;

  // The engine now says something new. After Refresh the card shows it, and only it.
  answer = aheadRead(12500000);
  await host.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(card, 'the old estimate survived Refresh').toContainText('$125,000');
  await expect(card).not.toContainText('$111,000');
  expect(asked.length, 'Refresh asked the engine again').toBeGreaterThan(first);

  // A Refresh whose read fails hides the card; the last number does not come back.
  answer = { status: 503, body: { ok: false, error: 'engine_unavailable', message: 'The estimate is not available right now.' } };
  const failed = page.waitForResponse(r => r.url().includes('view=lookahead') && r.status() === 503);
  await host.getByRole('button', { name: 'Refresh', exact: true }).click();
  await failed;
  await expect(card).toBeHidden();
  await expect(page.locator('[data-bj-ahead]:visible')).toHaveCount(0);
  await expect(host).not.toContainText('$125,000');
});
