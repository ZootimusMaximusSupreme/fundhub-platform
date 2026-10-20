import { expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openScreen, OWNER, json } from './harness.mjs';

// Shared fictional data for Chromium and WebKit. Never reaches a live API.
const REP = { ok: true, staff: { ...OWNER.staff, id: 'rep-1', role: 'outbound_rep', name: 'Casey Reed' } };
const account = i => ({ id: 'bank-' + i, name: ['Mesa Community Bank', 'Coastal Business Credit Union', 'Pacific Commercial Bank'][i % 3] + (i > 2 ? ' ' + (i + 1) : ''), source: 'fdic', external_id: String(1000 + i), state: ['AZ', 'SC', 'FL', 'CA'][i % 4], city: 'Phoenix', website: 'https://bank.example', assigned_staff_id: 'rep-1', assigned_staff_name: 'Casey Reed', status: 'researching', partner_activity: 'active', next_action: 'Confirm business line requirements with banker', next_due_at: '2026-01-01T15:00:00Z' });
const summary = { verified_products_week: 7, verified_products_previous_week: 4, verified_partners: 12, missing_next_action: 0, due_now: 18, total: 27 };
const contacts = [{ id: 'contact-1', name: 'Avery Lane', title: 'Business banker', email: 'avery@bank.example', phone: '+16025550101', linkedin_url: 'https://www.linkedin.com/in/avery-fixture' }];
export const facts = { minimum_score: 'unknown', minimum_time_in_business_years: 2, minimum_revenue_threshold: 250000, bureaus_pulled: ['EX', 'EQ'], inquiry_tolerance: 'Up to 3 in 6 months', stated_income: false, eligible_states: ['AZ', 'CA'], application_url: 'https://bank.example/apply', paper_application_url: 'unknown' };
const product = { id: 'product-1', product_name: 'Business working capital line', lender_table: 'BizLOC_Documented', facts, evidence: 'Avery Lane · banker email · October 19, 2026', verified_at: null };

export async function fixture(page, { manager = false, state = 'full', failWrite = false, published = false, draft = false, filteredEmpty = false, filteredInactive = false } = {}) {
  const posts = [], reads = [], faults = { detail: false, team: false }, data = { account: account(0), contacts: structuredClone(contacts), products: [{ ...structuredClone(product), verified_at: published ? '2026-10-19T15:00:00Z' : null }] };
  if (draft) data.products[0].draft = { ...structuredClone(product), product_name: 'Proposed business line', facts: { ...facts, minimum_score: 680 } };
  let release; const pending = new Promise(resolve => { release = resolve; });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, route => route.abort());
  const base = { ok: true, canManage: manager, program: { states: ['AZ', 'SC', 'FL', 'CA'] }, summary: state === 'empty' ? Object.fromEntries(Object.keys(summary).map(key => [key, 0])) : summary, reps: [{ id: 'rep-1', name: 'Casey Reed' }, { id: 'rep-2', name: 'Morgan Ellis' }] };
  await openScreen(page, '/app/bank-outreach.html', manager ? OWNER : REP, {
    '/api/read/bank-outreach': async (route, { url }) => {
      const query = Object.fromEntries(new URL(url).searchParams); reads.push(query);
      if (query.id) return faults.detail ? { ok: false, message: 'Banker details could not load.' } : { ...base, ...data };
      if (query.view === 'team' && faults.team) return { ok: false, message: 'Team results could not load.' };
      if (query.view === 'team') return { ...base, byRep: state === 'empty' ? [] : [{ staff_id: 'rep-1', name: 'Casey Reed', total: 14, verified_partners: 7, due_now: 8 }, { staff_id: 'rep-2', name: 'Morgan Ellis', total: 13, verified_partners: 5, due_now: 10 }], byState: state === 'empty' ? [] : ['AZ', 'SC', 'FL', 'CA'].map(state => ({ state, total: 7, verified_partners: 3, due_now: 4 })) };
      if (state === 'loading') await pending;
      if (state === 'error') return { ok: false, message: 'The bank list is temporarily unavailable.' };
      if (filteredEmpty && (query.q || query.state || query.status)) return { ...base, total: 0, items: [] };
      if (filteredInactive && ['paused', 'closed'].includes(query.status)) { data.account = { ...account(0), status: query.status }; return { ...base, total: 1, items: [data.account] }; }
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
  return { posts, reads, faults, data, release };
}

export async function astraMeasurements(page, scope = 'body') {
  return page.locator(scope).evaluate((root, scope) => {
    const visible = el => {
      if (el.closest('[hidden],[aria-hidden="true"],dialog:not([open])')) return false;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS' && !ancestor.open &&
            !ancestor.querySelector(':scope > summary')?.contains(el)) return false;
      }
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility === 'visible' &&
        Number(style.opacity) !== 0 && box.width > 1 && box.height > 1;
    };
    const info = el => {
      const style = getComputedStyle(el), box = el.getBoundingClientRect();
      return {
        tag: el.tagName, id: el.id, name: el.getAttribute('name'),
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 100),
        font: parseFloat(style.fontSize), width: box.width, height: box.height,
      };
    };
    const controls = [...root.querySelectorAll('button,a[href],input:not([type="hidden"]),select,textarea,summary')]
      .filter(visible).map(info);
    const text = [...root.querySelectorAll('*')].filter(visible).filter(el =>
      [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())).map(info);
    return {
      scope, viewport: { width: innerWidth, height: innerHeight },
      pageWidth: document.documentElement.scrollWidth,
      bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      controls, smallTargets: controls.filter(c => c.width < 43.99 || c.height < 43.99),
      smallInputs: controls.filter(c => /^(INPUT|SELECT|TEXTAREA)$/.test(c.tag) && c.font < 16),
      smallText: text.filter(t => t.font < 13),
      primary: [...root.querySelectorAll('.button.primary')].filter(visible).map(info),
    };
  }, scope);
}

export async function expectAstraControls(page, testInfo, state, scope = 'body') {
  const measured = await astraMeasurements(page, scope);
  await testInfo.attach(state + '-measurements', {
    body: JSON.stringify(measured, null, 2), contentType: 'application/json',
  });
  expect(measured.pageWidth, state + ': no sideways page overflow').toBeLessThanOrEqual(measured.viewport.width + 1);
  expect(measured.bodyFont, state + ': body text').toBe(16);
  expect(measured.smallTargets, state + ': rendered targets below 44px').toEqual([]);
  expect(measured.smallInputs, state + ': editable text below 16px').toEqual([]);
  expect(measured.smallText, state + ': captions below 13px').toEqual([]);
  for (const primary of measured.primary) expect(primary.height, state + ': primary ' + primary.text).toBeGreaterThanOrEqual(48);
  return measured;
}

export async function captureAstra(page, testInfo, name, selector) {
  if (!process.env.BANK_OUTREACH_CAPTURE) return;
  const output = path.resolve('ops/workflows/build-evidence/bank-outreach/astra');
  fs.mkdirSync(output, { recursive: true });
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.evaluate(({ selector, name }) => {
    const target = document.querySelector(selector), box = target.getBoundingClientRect();
    const host = document.querySelector('dialog[open]') || document.body;
    const overlay = document.createElement('div'); overlay.id = 'bank-astra-evidence';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const ring = document.createElement('div');
    ring.style.cssText = `position:absolute;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;border:2px solid #d32323`;
    const caption = document.createElement('div');
    const edge = box.bottom > innerHeight - 112 && box.top > 112 ? 'top' : 'bottom';
    caption.style.cssText = `position:absolute;${edge}:8px;left:8px;right:8px;background:#fff;border:2px solid #d32323;padding:8px;color:#a11313;font:13px/1.4 system-ui`;
    caption.textContent = name + ' · Safe local fixture, not live bank facts. Red box marks the measured controls.';
    overlay.append(ring, caption); host.append(overlay);
  }, { selector, name });
  const filename = `${testInfo.project.name}-${name}.png`;
  try {
    const screenshot = await page.screenshot({ path: path.join(output, filename), scale: 'css' });
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
  } finally { await page.locator('#bank-astra-evidence').evaluate(el => el.remove()); }
}

export async function inspectExpandedShell(page, testInfo, prefix) {
  await page.locator('#fh-shell-chip-show').click();
  await page.locator('.fh-account-technical > summary').click();
  await expect(page.locator('.fh-account-technical')).toHaveAttribute('open', '');
  await expectAstraControls(page, testInfo, prefix + '-account-open');
  const signOut = page.locator('#fh-shell-out');
  await signOut.scrollIntoViewIfNeeded();
  await expect(signOut).toBeInViewport();
  await signOut.click({ trial: true }); // Prove reachability without signing out.
  await captureAstra(page, testInfo, prefix + '-account-open', '.fh-account-menu');
  await page.locator('#fh-shell-chip-show').click();
  // The nested disclosure remains open inside a closed parent. It is not visible.
  await expectAstraControls(page, testInfo, prefix + '-account-closed');
  await page.locator('#fh-workspace-scope > summary').click();
  await expect(page.locator('#fh-workspace-scope')).toHaveAttribute('open', '');
  await expectAstraControls(page, testInfo, prefix + '-context-open');
  await captureAstra(page, testInfo, prefix + '-context-open', '.fh-context-panel');
  await page.locator('#fh-workspace-scope > summary').click();
}
