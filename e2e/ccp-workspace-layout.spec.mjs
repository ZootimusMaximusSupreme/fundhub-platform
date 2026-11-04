import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, json, OWNER, CLOSER, CLIENT_ID, CLIENT_ROW } from './harness.mjs';

const evidence = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18');
const full = {
  ok: true, client: { ...CLIENT_ROW, custom_fields: { analyzer_prequal_amount: 65000 } },
  transactions: [], messages: [], tasks: [], crs_results: [],
  next_action: { key: 'apply_for_funding', label: 'Apply for Funding', why: 'This file is ready for lender applications.' },
  active_blockers: [], next_action_degraded: false,
  funding_round: { number: 2, status: 'Ready', finalized: false, approved_amount: '25000', started_at: '2026-10-12T12:00:00Z' }
};
const handlers = {
  '/api/dashboard/client?': full,
  '/api/read/lender-matches': { ok: true, match_count: 2, summary: { lender_count: 2 }, matches: [
    { id: 'bank-one', name: 'Mesa Community Bank', bureaus_pulled: 'EX', application_url: 'https://bank.example/mesa' },
    { id: 'bank-two', name: 'Papago Savings', bureaus_pulled: 'EQ', application_url: 'https://bank.example/papago' }
  ] },
  '/api/applications': { ok: true, applications: [], decisions: [] },
  '/api/consent/capture': { ok: true, status: { valid: true }, identity: { on_file: true }, approval_link: null }
};
async function open(page, hash = '', extra = {}, session = OWNER) {
  return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}${hash}`, session, { ...handlers, ...extra });
}
async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);
}

test('the closer sees who owns a paid funding file', async ({ page }) => {
  const file = { ...full, client: { ...CLIENT_ROW, custom_fields: { product_path: 'Funding' } }, funding_advisor: { name: 'Jordan Advisor' } };
  await open(page, '#ccp-view-funding', { '/api/dashboard/client?': file }, CLOSER);
  await expect(page.locator('#ccp-funding-advisor')).toHaveText('Funding advisor: Jordan Advisor');
  await expect(page.locator('#ccp-funding-advisor')).toBeVisible();
});

test('a funding file without a named advisor says so', async ({ page }) => {
  const file = { ...full, client: { ...CLIENT_ROW, custom_fields: { product_path: 'Funding' } }, funding_advisor: null };
  await open(page, '#ccp-view-funding', { '/api/dashboard/client?': file }, CLOSER);
  await expect(page.locator('#ccp-funding-advisor')).toContainText('Not assigned yet');
  await expect(page.locator('#ccp-funding-advisor')).toBeVisible();
});

const financialProfile = {
  offerMatch: { outcome: 'matched', checked_at: '2026-11-04T10:00:00Z', stale: false },
  creditScores: [
    { bureau: 'TU', score: 782, model: 'FICO 9', source: 'CRS prequalification report', asOf: '2026-11-04T10:00:00Z' },
    { bureau: 'EQ', score: 761, model: 'FICO 9', source: 'CRS prequalification report', asOf: '2026-11-03T10:00:00Z' }
  ],
  incomeModels: [
    { bureau: 'TU', annual: null, rawCode: '47 B', model: 'CreditVision Income Estimator', verified: false, status: 'mapping_required', asOf: '2026-11-04T10:00:00Z' },
    { bureau: 'EQ', annual: 130000, rawCode: '130', model: 'Income View', verified: false, status: 'model_estimate', asOf: '2026-11-03T10:00:00Z' }
  ],
  reportedIncome: { range: '$100k–$150k', verificationStated: 'Yes, pay stubs', basis: 'client_stated' },
  reportedCapital: { range: '$10k–$25k', basis: 'client_stated' },
  verifiedIncome: null, property: null,
  fitModels: [
    { model: 'blueprint', name: 'Blueprint', version: 'draft-2026-11-04', draft: true, lenderApproval: false, scoreFloor: 620, outcome: 'score_floor_met', thresholdSource: 'owner_provisional', scoreChecks: [{ bureau: 'TU', score: 782, model: 'FICO 9', status: 'meets', asOf: '2026-11-04T10:00:00Z' }], supportingChecks: [{ criterion: 'paid_off_auto', status: 'missing' }], pendingCriteria: [] },
    { model: 'prime_funding', name: 'Prime Funding', version: 'draft-2026-11-04', draft: true, lenderApproval: false, scoreFloor: 750, outcome: 'score_floor_met', scoreChecks: [], supportingChecks: [], pendingCriteria: [] },
    { model: 'super_prime', name: 'Super Prime Funding', version: 'draft-2026-11-04', draft: true, lenderApproval: false, scoreFloor: 800, outcome: 'below_score_floor', scoreChecks: [], supportingChecks: [], pendingCriteria: [] },
    { model: 'real_estate', name: 'Real Estate', version: 'draft-2026-11-04', draft: true, lenderApproval: false, scoreFloor: null, outcome: 'needs_data', scoreChecks: [], supportingChecks: [], pendingCriteria: [], icpPaths: [
      { id: 'real_estate_entrant', name: 'Deal-Ready Profile', targetProfile: 'High income, strong financials, and good credit; property ownership optional', homeownershipRequired: false, scoreFloor: 700, outcome: 'score_floor_met', scoreChecks: [{ bureau: 'TU', score: 782, model: 'FICO 9', status: 'meets', asOf: '2026-11-04T10:00:00Z' }], supportingChecks: [{ criterion: 'income_evidence', status: 'missing' }] },
      { id: 'homeowner_capital', name: 'Renovation Funding Map', targetProfile: 'Property owner with strong income and a defined major project', homeownershipRequired: true, scoreFloor: null, outcome: 'needs_configuration', scoreChecks: [], supportingChecks: [{ criterion: 'project_or_combined_financing_target', status: 'missing', requestMarkers: [75000, 100000, 175000, 250000, 500000], facilityStackingDependsOnProgram: true }] }
    ] }
  ]
};
const assetProfile = {
  source: 'stored_bank_records', scope: 'recorded_rows_only',
  accounts: [
    { name: 'Main checking', mask: '1234', included_in_cash: true, entity_kind: 'personal', entity_kind_source: 'connection_metadata', currency_code: 'USD', current_balance_cents: 200000, available_balance_cents: 0, balance_as_of: '2026-11-01T10:00:00Z', provider: 'plaid' },
    { name: 'Savings', mask: '5678', included_in_cash: true, entity_kind: 'personal', entity_kind_source: 'connection_metadata', currency_code: 'USD', current_balance_cents: 100000, available_balance_cents: 0, balance_as_of: '2026-11-04T10:00:00Z', provider: 'plaid' },
    { name: 'Imported cash', mask: '9876', included_in_cash: true, entity_kind: 'personal', entity_kind_source: 'client_stated', currency_code: 'USD', current_balance_cents: 50000, available_balance_cents: 0, balance_as_of: null, provider: 'import' },
    { name: 'Business reserve', mask: '4321', included_in_cash: true, entity_kind: 'business', entity_kind_source: 'staff_reviewed', currency_code: 'USD', current_balance_cents: 400000, available_balance_cents: null, balance_as_of: '2026-11-02T10:00:00Z', provider: 'manual' }
  ],
  cash: [
    { entity_kind: 'personal', currencies: [{ currency_code: 'USD', current: { value_cents: 350000, basis: { status: 'recorded', providers: ['import', 'plaid'] }, as_of: null, date_range: { oldest: '2026-11-01T10:00:00Z', newest: '2026-11-04T10:00:00Z', unknown: 1 } }, available: { value_cents: 0, basis: { status: 'recorded', providers: ['import', 'plaid'] }, as_of: null, date_range: { oldest: '2026-11-01T10:00:00Z', newest: '2026-11-04T10:00:00Z', unknown: 1 } } }] },
    { entity_kind: 'business', currencies: [{ currency_code: 'USD', current: { value_cents: 400000, basis: { status: 'recorded', providers: ['manual'] }, as_of: '2026-11-02T10:00:00Z' }, available: { value_cents: null, basis: { status: 'unknown', providers: ['manual'] }, as_of: null } }] },
    { entity_kind: 'unknown', currencies: [{ currency_code: 'EUR', current: { value_cents: 150000, basis: { status: 'partial', providers: ['import'] }, as_of: null }, available: { value_cents: null, basis: { status: 'unknown', providers: ['import'] }, as_of: null } }] }
  ],
  holdings: [{ account_name: 'Brokerage', symbol: 'TEST', entity_kind: 'personal', currency_code: 'USD', current_value_cents: 900000, as_of: '2026-11-01T10:00:00Z', account_status: 'open', source: 'manual', provider: 'manual' }],
  truncated: { accounts: false, holdings: false }
};

test('lead enrichment shows four drafts, source-labeled model data, and saved assets without ordering', async ({ page }) => {
  const writes = [];
  let assetReads = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  const file = { ...full, financial_profile: financialProfile };
  const errors = await open(page, '', {
    '/api/dashboard/client?': file,
    '/api/banking/accounts?': () => { assetReads++; return { ok: true, asset_profile: assetProfile }; }
  });
  await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
  expect(assetReads).toBe(0);
  await page.getByRole('tab', { name: 'Credit & inquiries', exact: true }).click();
  await expect(page.locator('#ccp-enrichment-models .cp-sec')).toHaveCount(4);
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Blueprint · draft');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Prime Funding · draft');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Super Prime Funding · draft');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Real Estate · draft');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Deal-Ready Profile');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('Renovation Funding Map');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('No universal score floor');
  await expect(page.locator('#ccp-enrichment-models')).toContainText('$75k · $100k · $175k · $250k · $500k+');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('TU credit score');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('47 B');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('Annual amount unknown');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('$130,000');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('not verified income');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('$0.00');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Personal cash · USD');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Business cash · USD');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Unknown cash · EUR');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Investment holdings');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Account sources');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('recorded entry, not bank verified');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Nov 1, 2026 to Nov 4, 2026 · 1 balance date unknown');
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('manual');
  await page.getByRole('tab', { name: 'Funding', exact: true }).click();
  await page.getByRole('tab', { name: 'Credit & inquiries', exact: true }).click();
  expect(assetReads).toBe(1);
  expect(writes.filter(url => /offersiq|crs-pull|banking\/accounts/i.test(url))).toEqual([]);
  expect(errors).toEqual([]);
});

test('stale match, missing scores and failed assets remain unknown on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const empty = { ...financialProfile, offerMatch: { outcome: 'needs_review', stale: true, checked_at: null }, creditScores: [], incomeModels: [], fitModels: financialProfile.fitModels.map(model => ({ ...model, scoreChecks: [], outcome: 'needs_data' })) };
  const errors = await open(page, '#ccp-view-credit', {
    '/api/dashboard/client?': { ...full, financial_profile: empty },
    '/api/banking/accounts?': route => json(route, { ok: false, error: 'read_failed' }, 503)
  });
  await expect(page.locator('#ccp-enrichment-offer')).toContainText('stale identity');
  await expect(page.locator('#ccp-enrichment-facts')).toContainText('Bureau credit scores');
  await expect(page.locator('#ccp-enrichment-assets-state')).toContainText('unavailable');
  await expect(page.locator('#ccp-enrichment-models .cp-sec')).toHaveCount(4);
  await noOverflow(page);
  expect(errors).toEqual([]);
});

test('four draft profiles and recorded assets fit a 390px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const errors = await open(page, '#ccp-view-credit', {
    '/api/dashboard/client?': { ...full, financial_profile: financialProfile },
    '/api/banking/accounts?': { ok: true, asset_profile: assetProfile }
  });
  await expect(page.locator('#ccp-enrichment-models .cp-sec')).toHaveCount(4);
  await expect(page.locator('#ccp-enrichment-assets')).toContainText('Investment holdings');
  await noOverflow(page);
  expect(errors).toEqual([]);
});

for (const width of [1440, 390, 320]) {
  test(`workspace fits ${width}px and keeps every section usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await open(page);
    await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
    await expect(page.locator('#ccp-next-action')).toHaveText('Apply for Funding');
    await expect(page.locator('#ccp-task-open')).toBeVisible();
    await expect(page.locator('.workspace-view:visible')).toHaveCount(1);
    await noOverflow(page);
    const primary = await page.locator('#ccp-task-open').boundingBox();
    expect(primary.height).toBeGreaterThanOrEqual(44);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `ccp-after-${width}-overview.png`), fullPage: true });
    for (const name of ['Funding', 'Credit & inquiries', 'Records', 'Access', 'Overview']) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.locator('.workspace-view:visible')).toHaveCount(1);
      await noOverflow(page);
    }
    await page.getByRole('tab', { name: 'Credit & inquiries', exact: true }).click();
    await expect(page.locator('#ccp-pull-tu')).toBeVisible();
    await page.screenshot({ path: path.join(evidence, `ccp-after-${width}-credit.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('shared account and related tools menus retain their native toggle behavior', async ({ page }) => {
  await open(page);
  await page.locator('#fh-shell-chip-show').click();
  await expect(page.locator('#fh-shell-out')).toBeVisible();
  await page.locator('#fh-shell-chip-show').click();
  await expect(page.locator('#fh-shell-out')).toBeHidden();
  await page.locator('#more-menu > summary').click();
  await expect(page.locator('#ccp-link-messaging')).toBeVisible();
  await page.locator('#more-menu > summary').click();
  await expect(page.locator('#ccp-link-messaging')).toBeHidden();
});

test('tab keys, browser history and client context agree', async ({ page }) => {
  await open(page);
  const overview = page.getByRole('tab', { name: 'Overview', exact: true });
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Funding', exact: true })).toBeFocused();
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await expect(page).toHaveURL(/client_id=.*#ccp-view-funding$/);
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Access', exact: true })).toBeFocused();
  await page.goBack();
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await page.getByRole('tab', { name: 'Funding', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(overview).toBeFocused();
  await expect(overview).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
});

test('existing field and decline anchors reveal the section and folded group', async ({ page }) => {
  await open(page, '#notes');
  await expect(page.locator('#ccp-view-records')).toBeVisible();
  await expect(page.locator('#notes')).toBeVisible();
  await expect(page.locator('[aria-controls="details-body"]')).toHaveAttribute('aria-expanded', 'true');
  await page.evaluate(() => { location.hash = 'bp-declines'; });
  await expect(page.locator('#ccp-view-funding')).toBeVisible();
  await expect(page.locator('#bp-declines')).toBeVisible();
  await expect(page.locator('[aria-controls="bp-body"]')).toHaveAttribute('aria-expanded', 'true');
});

test('a file action can reveal its field after the user changes section', async ({ page }) => {
  await open(page);
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('ccp:reveal', { detail: document.getElementById('ccp-round-funded') })));
  await expect(page.locator('#ccp-view-overview')).toBeVisible();
});

test('staff without access permissions get no Access tab or controls', async ({ page }) => {
  await open(page, '#ccp-view-access', {}, CLOSER);
  await expect(page.getByRole('tab', { name: 'Access', exact: true })).toHaveCount(0);
  await expect(page.locator('#ccp-view-overview')).toBeVisible();
  await expect(page.locator('#ccp-rep-wrap')).toBeHidden();
  await expect(page.locator('#ccp-portal-link-wrap')).toBeHidden();
});

test('records retain typed notes across sections and upload the selected client document', async ({ page }) => {
  const writes = [], uploads = [];
  await open(page, '#notes', {
    '/api/client-notes': route => {
      writes.push(route.request().postDataJSON());
      return json(route, { ok: true, client: { id: CLIENT_ID, staff_notes: 'Call Friday.' } });
    },
    '/api/documents-upload': route => {
      uploads.push(route.request().postData());
      return json(route, { ok: true, documents: [{ download: { url: '/fixture-document.pdf' } }] });
    }
  });
  await page.locator('#notes').fill('Call Friday.');
  await page.getByRole('tab', { name: 'Funding', exact: true }).click();
  await page.getByRole('tab', { name: 'Records', exact: true }).click();
  await expect(page.locator('#notes')).toHaveValue('Call Friday.');
  await page.locator('#notes-save').click();
  await expect(page.locator('#notes-status')).toContainText('Saved to this client file.');
  expect(writes).toEqual([{ client_id: CLIENT_ID, notes: 'Call Friday.' }]);
  await page.locator('[aria-controls="upload-body"]').click();
  await page.locator('#staff-file-input').setInputFiles({ name: 'identity.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-fixture') });
  await expect(page.locator('#staff-upload-status')).toHaveText('1 file sent');
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain(CLIENT_ID);
  await expect(page.locator('#staff-filelist a')).toHaveAttribute('href', '/fixture-document.pdf');
});

test('a failed file read can be retried from the page', async ({ page }) => {
  let reads = 0;
  await open(page, '', { '/api/dashboard/client?': route => {
    reads += 1;
    return reads === 1 ? json(route, { ok: false, error: 'boom' }, 500) : json(route, full);
  } });
  await page.locator('#ccp-file-retry').click();
  await expect(page.locator('#ccp-name')).toHaveText('Dana Whitfield');
  await expect(page.locator('#ccp-file-retry')).toBeHidden();
  await expect(page.locator('#ccp-task-open')).toBeVisible();
});

for (const state of ['empty', 'error', 'loading']) {
  test(`${state} stays honest and fits a 320px phone`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    let release;
    const held = new Promise(resolve => { release = resolve; });
    const extra = state === 'error' ? { '/api/dashboard/client?': route => json(route, { ok: false, error: 'boom' }, 500) }
      : state === 'loading' ? { '/api/dashboard/client?': async route => { await held; return json(route, full); } } : {};
    if (state === 'empty') await openScreen(page, '/app/client-control-panel.html', OWNER, handlers);
    else await open(page, '', extra);
    if (state === 'empty') await expect(page.locator('#ccp-name')).toHaveText('No client open');
    if (state === 'error') {
      await expect(page.locator('#ccp-name')).toHaveText('Could not load this file');
      await expect(page.locator('#ccp-file-retry')).toBeVisible();
    }
    if (state === 'loading') await expect(page.locator('#ccp-next-action .skel')).toBeVisible();
    await noOverflow(page);
    await page.screenshot({ path: path.join(evidence, `ccp-after-320-${state}.png`), fullPage: true });
    release();
  });
}
