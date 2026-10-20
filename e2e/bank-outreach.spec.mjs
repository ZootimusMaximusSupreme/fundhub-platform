import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, OWNER, json } from './harness.mjs';

// Safe browser fixtures prove UI controls, not live bank facts or database writes.
const REP = { ok: true, staff: { ...OWNER.staff, id: 'rep-1', role: 'outbound_rep', name: 'Casey Reed' } };
const OUT = path.resolve('ops/workflows/build-evidence/bank-outreach');
const account = i => ({ id: 'bank-' + i, name: ['Mesa Community Bank', 'Coastal Business Credit Union', 'Pacific Commercial Bank'][i % 3] + (i > 2 ? ' ' + (i + 1) : ''), source: 'fdic', external_id: String(1000 + i), state: ['AZ', 'SC', 'FL', 'CA'][i % 4], city: 'Phoenix', website: 'https://bank.example', assigned_staff_id: 'rep-1', assigned_staff_name: 'Casey Reed', status: 'researching', partner_activity: 'active', next_action: 'Confirm business line requirements with banker', next_due_at: '2026-01-01T15:00:00Z' });
const summary = { verified_products_week: 7, verified_products_previous_week: 4, verified_partners: 12, missing_next_action: 0, due_now: 18, total: 27 };
const contacts = [{ id: 'contact-1', name: 'Avery Lane', title: 'Business banker', email: 'avery@bank.example', phone: '+16025550101', linkedin_url: 'https://www.linkedin.com/in/avery-fixture' }];
const facts = { minimum_score: 'unknown', minimum_time_in_business_years: 2, minimum_revenue_threshold: 250000, bureaus_pulled: ['EX', 'EQ'], inquiry_tolerance: 'Up to 3 in 6 months', stated_income: false, eligible_states: ['AZ', 'CA'], application_url: 'https://bank.example/apply', paper_application_url: 'unknown' };
const product = { id: 'product-1', product_name: 'Business working capital line', lender_table: 'BizLOC_Documented', facts, evidence: 'Avery Lane · banker email · October 19, 2026', verified_at: null };

async function fixture(page, { manager = false, state = 'full', failWrite = false, published = false, draft = false } = {}) {
  const posts = [], reads = [], data = { account: account(0), contacts: structuredClone(contacts), products: [{ ...structuredClone(product), verified_at: published ? '2026-10-19T15:00:00Z' : null }] };
  if (draft) data.products[0].draft = { ...structuredClone(product), product_name: 'Proposed business line', facts: { ...facts, minimum_score: 680 } };
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
  const base = { ok: true, canManage: manager, program: { states: ['AZ', 'SC', 'FL', 'CA'] }, summary, reps: [{ id: 'rep-1', name: 'Casey Reed' }, { id: 'rep-2', name: 'Morgan Ellis' }] };
  await openScreen(page, '/app/bank-outreach.html', manager ? OWNER : REP, {
    '/api/read/bank-outreach': async (route, { url }) => {
      const query = Object.fromEntries(new URL(url).searchParams); reads.push(query);
      if (query.id) return { ...base, ...data };
      if (query.view === 'team') return { ...base, byRep: [{ staff_id: 'rep-1', name: 'Casey Reed', total: 14, verified_partners: 7, due_now: 8 }, { staff_id: 'rep-2', name: 'Morgan Ellis', total: 13, verified_partners: 5, due_now: 10 }], byState: ['AZ', 'SC', 'FL', 'CA'].map(state => ({ state, total: 7, verified_partners: 3, due_now: 4 })) };
      if (state === 'loading') await pending;
      if (state === 'error') return { ok: false, message: 'The bank list is temporarily unavailable.' };
      return { ...base, total: state === 'empty' ? 0 : 27, items: state === 'empty' ? [] : Array.from({ length: Number(query.offset || 0) ? 2 : 25 }, (_, i) => account(i + Number(query.offset || 0))) };
    },
    '/api/bank-outreach': async route => {
      const body = JSON.parse(route.request().postData()); posts.push(body);
      if (failWrite) return json(route, { ok: false, message: 'Save failed. Your notes are still here.' }, 500);
      if (body.action === 'save_contact') { const contact = { ...body, id: body.id || 'contact-2' }; const index = data.contacts.findIndex(c => c.id === contact.id); if (index < 0) data.contacts.push(contact); else data.contacts[index] = contact; }
      if (body.action === 'log_touch') { data.account.next_action = body.next_action; }
      if (body.action === 'save_product') { data.products = [{ ...body, id: body.id || 'product-2', verified_at: null }]; }
      if (body.action === 'verify_product') data.products[0].verified_at = new Date().toISOString();
      if (body.action === 'set_status') Object.assign(data.account, { status: body.status, next_action: body.next_action, partner_activity: body.partner_activity });
      if (body.action === 'assign') data.account.assigned_staff_id = body.staff_id;
      return json(route, { ...base, imported: 3, existing: 2, skipped: 1 });
    }
  });
  return { posts, reads, data, release };
}
async function geometry(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('#fh-workspace-header')).toHaveCount(1);
  await expect(page.locator('html')).toHaveAttribute('data-fh-rounded-default', '');
}
async function capture(page, name, selector) {
  if (!process.env.BANK_OUTREACH_CAPTURE) return;
  fs.mkdirSync(OUT, { recursive: true });
  await page.locator(selector).scrollIntoViewIfNeeded();
  await page.addStyleTag({ content: '.outreach-evidence-box{outline:2px solid #d32323!important;outline-offset:-3px}.outreach-evidence-caption{position:fixed;left:8px;right:8px;bottom:8px;z-index:999999;background:#fff;color:#a11313;border:1px solid #d32323;padding:8px;font:12px/1.4 system-ui;pointer-events:none}' });
  await page.locator(selector).evaluate(el => el.classList.add('outreach-evidence-box'));
  await page.evaluate(text => { const el = document.createElement('div'); el.className = 'outreach-evidence-caption'; el.textContent = text + ' · Safe UI fixture. Red box marks the state or controls under review.'; (document.querySelector('dialog[open]') || document.body).append(el); }, name);
  await page.screenshot({ path: path.join(OUT, name + '.png') });
  await page.locator('.outreach-evidence-caption').evaluateAll(els => els.forEach(el => el.remove()));
  await page.locator(selector).evaluate(el => el.classList.remove('outreach-evidence-box'));
}

for (const width of [1440, 390, 320]) {
  for (const state of ['full', 'empty', 'loading', 'error']) {
    test(`${width}px rep ${state}: honest state, shared frame and phone fit`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      const env = await fixture(page, { state });
      try {
        await geometry(page);
        if (state === 'full') {
          await expect(page.locator('#queue-rows tr')).toHaveCount(25);
          await expect(page.locator('#hero-value')).toHaveText('Mesa Community Bank');
          await expect(page.locator('#verified-week')).toHaveText('7');
          await expect(page.locator('#verified-compare')).toHaveText('vs 4 last week');
          await expect(page.locator('#import-open')).toBeHidden(); await expect(page.locator('#view-switch')).toBeHidden();
          await expect(page.locator('#queue-scope')).toContainText('Assigned banks only');
          await expect(page.locator('#fh-search-trigger')).toHaveCount(0);
          const open = page.locator('.open-bank').first(); expect((await open.boundingBox()).height).toBeGreaterThanOrEqual(44);
        } else if (state === 'empty') await expect(page.locator('#empty-action')).toHaveText('Clear filters');
        else if (state === 'error') { await expect(page.locator('#queue-retry')).toBeVisible(); await expect(page.locator('#queue-state')).toContainText('temporarily unavailable'); await page.locator('#queue-retry').click(); }
        else await expect(page.locator('#queue-state .skeleton')).toHaveCount(3);
        await capture(page, `${width}-rep-${state}`, state === 'full' ? '#queue-panel' : '#queue-state');
        if (state === 'full') { await page.locator('#work-next').click(); await expect(page.locator('#bank-drawer')).toBeVisible(); await expect(page.locator('#bank-title')).toHaveText('Mesa Community Bank'); await geometry(page); await capture(page, `${width}-rep-drawer`, '#drawer-content'); await page.keyboard.press('Escape'); await expect(page.locator('#work-next')).toBeFocused(); }
      } finally { env.release(); }
    });
  }
  test(`${width}px manager: team results, assignment, import and drawer fit`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); const env = await fixture(page, { manager: true });
    await expect(page.locator('#team-section')).toBeVisible(); await expect(page.locator('#team-content')).toContainText('Casey Reed'); await geometry(page);
    await capture(page, `${width}-manager-full`, '#team-content');
    await page.locator('#queue-view').click(); await page.locator('.open-bank').first().click(); await page.locator('[data-section="relationship"]').click();
    await page.locator('[name="staff_id"]').selectOption('rep-2'); await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
    await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'assign', id: 'bank-0', staff_id: 'rep-2' });
    await page.locator('#drawer-close').click(); await page.locator('#import-open').click();
    await page.locator('#import-form [name="source"]').selectOption('ncua'); await page.locator('#import-form textarea').fill('CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ'); await page.locator('#import-form [type="submit"]').click();
    await expect(page.locator('#import-message')).toContainText('Imported 3 banks · 2 already saved · 1 outside launch states.');
    expect(env.posts.at(-1)).toEqual({ action: 'import', source: 'ncua', csv: 'CU_NUMBER,NAME,STATE\n123,Fixture Credit Union,AZ' });
    await capture(page, `${width}-manager-import`, '#import-dialog'); await page.locator('#import-close').click(); await expect(page.locator('#import-open')).toBeFocused();
  });
}

test('queue filters debounce, preserve contracts and paginate at 25', async ({ page }) => {
  const env = await fixture(page); await expect(page.locator('#queue-rows tr')).toHaveCount(25);
  await page.locator('#search').fill(' Mesa '); await expect.poll(() => env.reads.at(-1)?.q).toBe('Mesa');
  await page.locator('#state').selectOption('AZ'); await page.locator('#status').selectOption('engaged');
  await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: 'Mesa', state: 'AZ', status: 'engaged', offset: '0', limit: '25' });
  await page.locator('#next').click(); await expect(page.locator('#page-count')).toHaveText('26–27 of 27');
  await page.locator('#previous').click(); await expect(page.locator('#page-count')).toHaveText('1–25 of 27');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click(); await expect.poll(() => env.reads.at(-1)).toMatchObject({ q: '', state: '', status: '', offset: '0' });
});

test('rep touches, banker edits, typed product facts and relationship controls save exact values', async ({ page }) => {
  const env = await fixture(page); await page.locator('#work-next').click();
  await expect(page.locator('#bank-links a').first()).toHaveAttribute('href', /linkedin\.com\/search\/results\/people/);
  await page.locator('[data-action="log_touch"] [name="channel"]').selectOption('call'); await page.locator('[name="contact_id"]').selectOption('contact-1');
  await page.locator('[name="outcome"]').fill('Banker confirmed eligibility'); await page.locator('[name="note"]').fill('Real banker note <not markup>'); await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Get application path');
  await page.getByRole('button', { name: 'Save touch and next action' }).click();
  await expect.poll(() => env.posts[0]).toEqual({ action: 'log_touch', account_id: 'bank-0', channel: 'call', contact_id: 'contact-1', outcome: 'Banker confirmed eligibility', note: 'Real banker note <not markup>', next_action: 'Get application path', next_due_at: '' });
  await page.locator('[data-section="contacts"]').click(); await page.getByRole('button', { name: 'Edit banker', exact: true }).click(); await expect(page.locator('#contact-editor [name="name"]')).toBeFocused();
  await page.locator('#contact-editor [name="title"]').fill('Senior business banker'); await page.getByRole('button', { name: 'Save banker', exact: true }).click();
  await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'save_contact', id: 'contact-1', name: 'Avery Lane', title: 'Senior business banker' });
  await page.locator('#new-contact').click(); await page.locator('#contact-editor [name="name"]').fill('Morgan Lee'); await page.locator('#contact-editor [name="email"]').fill('morgan@bank.example'); await page.getByRole('button', { name: 'Save banker', exact: true }).click();
  await expect(page.locator('#contact-list')).toContainText('Morgan Lee');
  await page.locator('[data-section="products"]').click(); await expect(page.locator('#product-list')).toContainText('Unknown'); await expect(page.locator('[data-verify]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
  await page.locator('[name="minimum_score"]').fill('unknown'); await page.locator('[name="minimum_time_in_business_years"]').fill('0'); await page.locator('[name="stated_income"]').selectOption('false'); await page.locator('[name="eligible_states"]').fill('az, ca');
  await page.getByRole('button', { name: 'Save product facts', exact: true }).click();
  await expect.poll(() => env.posts.at(-1)?.facts).toEqual({ ...facts, minimum_time_in_business_years: 0 });
  await page.locator('#new-product').click(); await expect(page.locator('#product-editor [name="product_name"]')).toBeFocused();
  await page.locator('[data-section="history"]').click(); await expect(page.locator('#detail-history')).toContainText('No activity saved');
  await page.locator('[data-section="relationship"]').click(); await page.locator('[name="partner_activity"]').selectOption('quiet'); await page.locator('[data-action="set_status"] [name="status"]').selectOption('engaged'); await page.locator('[data-action="set_status"] [name="next_action"]').fill('Quarterly review'); await page.getByRole('button', { name: 'Save relationship' }).click();
  await expect.poll(() => env.posts.at(-1)).toMatchObject({ action: 'set_status', id: 'bank-0', status: 'engaged', partner_activity: 'quiet', next_action: 'Quarterly review', next_due_at: '' });
});

test('failed writes retain exact inputs and escaped banker data never runs markup', async ({ page }) => {
  const env = await fixture(page, { failWrite: true }); env.data.account.name = '<img src=x onerror="window.__unsafe=true">'; env.data.contacts[0].name = '<script>unsafe</script>';
  await page.locator('#work-next').click(); await expect(page.locator('#bank-title')).toHaveText(env.data.account.name); await expect(page.locator('#bank-title img')).toHaveCount(0);
  await page.locator('[name="outcome"]').fill('Retain me'); await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Call tomorrow'); await page.getByRole('button', { name: 'Save touch and next action' }).click();
  await expect(page.locator('#drawer-message')).toContainText('Save failed'); await expect(page.locator('[name="outcome"]')).toHaveValue('Retain me'); await expect(page.locator('[data-action="log_touch"] [name="next_action"]')).toHaveValue('Call tomorrow');
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
});

test('published facts are read-only for reps; manager amendment uses draft and verifies', async ({ page }) => {
  await fixture(page, { published: true }); await page.locator('#work-next').click(); await page.locator('[data-section="products"]').click(); await expect(page.locator('[data-edit-product]')).toHaveCount(0); await expect(page.locator('[data-verify]')).toHaveCount(0); await expect(page.locator('#product-list')).toContainText('Published facts are read-only');
  await page.locator('#drawer-close').click();
  const env = await fixture(page, { manager: true, published: true, draft: true }); await page.locator('#work-next').click(); await page.locator('[data-section="products"]').click(); await expect(page.locator('#product-list')).toContainText('Pending amendment'); await page.locator('[data-edit-product]').click(); await expect(page.locator('[name="minimum_score"]')).toHaveValue('680'); await expect(page.locator('[name="product_name"]')).toHaveValue('Proposed business line');
  await page.locator('[data-verify]').click(); await expect.poll(() => env.posts.at(-1)).toEqual({ action: 'verify_product', id: 'product-1' }); await expect(page.locator('#drawer-message')).toContainText('Verified product saved to Lenders');
});
