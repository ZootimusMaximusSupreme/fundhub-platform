import { test, expect } from '@playwright/test';
import path from 'node:path';

const ID = '11111111-1111-4111-8111-111111111111';
const CLIENT = 'aaaaaaaa-1111-4111-8111-111111111111';
const SESSION = { ok: true, staff: { id: 'staff-1', name: 'Alex Morgan', email: 'alex@example.test', role: 'closer', org_id: 'org-1', status: 'active' } };
const ROW = { id: ID, client_id: CLIENT, channel: 'sms', first_name: 'Dana', last_name: 'Whitfield', last_body: 'Can you confirm which documents you still need?', last_at: '2026-10-18T15:12:00Z', needs_reply: true };
const EMAIL = { ...ROW, id: '22222222-2222-4222-8222-222222222222', channel: 'email', last_body: 'Your checklist is attached to your client file.', needs_reply: false };
const ITEMS = [ROW, { ...ROW, id: '33333333-3333-4333-8333-333333333333', first_name: 'Alexandria', last_name: 'Montgomery-Washington', last_body: 'I have uploaded my latest statement. Thank you for your help.' }, { ...ROW, id: '44444444-4444-4444-8444-444444444444', first_name: 'Marcus', last_name: 'Bell', channel: 'email', last_body: 'Would tomorrow afternoon work for our call?' }];
const EMPTY = { ok: true, count: 0, limit: 200, hasMore: false, items: [] };
const THREAD = { ...EMPTY, count: 3, items: [
  { id: 'm3', direction: 'inbound', channel: 'sms', rendered_body: 'Can you confirm which documents you still need?', status: 'received', created_at: '2026-10-18T15:12:00Z' },
  { id: 'm2', direction: 'outbound', channel: 'sms', sender_name: 'Alex Morgan', rendered_body: 'Hi Dana. I am reviewing your file now. I will send you a short checklist.', status: 'delivered', created_at: '2026-10-18T15:10:00Z' },
  { id: 'm1', direction: 'inbound', channel: 'sms', rendered_body: 'Good morning, I have uploaded my latest bank statement.', status: 'received', created_at: '2026-10-18T15:08:00Z' }
] };
const evidence = path.resolve('ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/messaging');
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function wire(page, options = {}) {
  const sent = [];
  const reads = [];
  await page.addInitScript(() => { localStorage.setItem('fh_token', 'mock-layout-token'); localStorage.setItem('fh_role', 'closer'); localStorage.removeItem('fh_demo'); });
  // Every API is intercepted, including unexpected calls. No real send can escape.
  await page.route('**/api/**', async r => {
    const u = new URL(r.request().url());
    reads.push(u.pathname + u.search);
    if (r.request().method() !== 'GET') {
      if (u.pathname === '/api/messages') {
        sent.push(r.request().postDataJSON());
        if (options.sendGate) await options.sendGate;
        return json(r, options.sendResult || { ok: true, outcome: 'blocked', detail: ['opted_out'], message: { id: 'refused', status: 'blocked' } }, options.sendStatus || 200);
      }
      return json(r, { ok: false, message: 'Unexpected write refused by test.' }, 403);
    }
    if (u.pathname === '/api/auth/session') return json(r, SESSION);
    if (u.pathname === '/api/read/inbox') {
      if (options.listGate) await options.listGate;
      return json(r, options.inbox || { ...EMPTY, count: ITEMS.length, items: ITEMS }, options.inboxStatus || 200);
    }
    if (u.pathname === '/api/read/messages') {
      if (options.threadGate) await options.threadGate;
      return json(r, options.thread || THREAD, options.threadStatus || 200);
    }
    if (u.pathname === '/api/read/conversations') return json(r, { ...EMPTY, items: [ROW, EMAIL] });
    if (u.pathname === '/api/dashboard/client') return json(r, { ok: true, client: { id: CLIENT, first_name: 'Dana', last_name: 'Whitfield', email: 'dana@example.test', phone: '+15551234567' } });
    if (u.pathname === '/api/health') return json(r, { ok: true, db: 'up' });
    return json(r, EMPTY);
  });
  return { sent, reads };
}

async function marked(page, filename, selector, caption) {
  const box = await page.locator(selector).boundingBox();
  await page.evaluate(({ box, caption }) => {
    const mark = document.createElement('div'); mark.id = 'layout-review-mark';
    mark.style.cssText = `position:fixed;z-index:99999;pointer-events:none;box-sizing:border-box;border:2px solid #d92d20;left:${box.x + 2}px;top:${box.y + 2}px;width:${box.width - 4}px;height:${Math.min(box.height - 4, innerHeight - box.y - 4)}px;`;
    const label = document.createElement('div'); label.textContent = caption;
    label.style.cssText = 'position:absolute;bottom:5px;left:5px;max-width:calc(100% - 10px);padding:5px 8px;background:#d92d20;color:white;font:600 12px/1.4 system-ui;border-radius:4px;';
    mark.append(label); document.body.append(mark);
  }, { box, caption });
  await page.screenshot({ path: path.join(evidence, filename), fullPage: true });
  await page.locator('#layout-review-mark').evaluate(e => e.remove());
}

async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const main = await page.locator('main').boundingBox();
  const header = await page.locator('#fh-workspace-header').boundingBox();
  expect(main.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
}
async function onScreen(page, selector) {
  const b = await page.locator(selector).boundingBox();
  expect(b).not.toBeNull(); expect(b.x).toBeGreaterThanOrEqual(0); expect(b.y).toBeGreaterThanOrEqual(0);
  const v = page.viewportSize(); expect(b.x + b.width).toBeLessThanOrEqual(v.width + 1); expect(b.y + b.height).toBeLessThanOrEqual(v.height + 1);
}

for (const width of [1440, 390, 320]) {
  test(`inbox, conversation, context and keyboard at ${width}px`, async ({ page }) => {
    const errors = []; page.on('pageerror', e => errors.push(String(e)));
    await page.setViewportSize({ width, height: 1000 }); const { reads } = await wire(page); await page.goto('/app/messaging.html');
    await expect(page.locator('.convo')).toHaveCount(3); await noOverflow(page);
    // A clipped row can pass document-overflow checks. Its actual content must fit.
    for (const row of await page.locator('.convo').all()) {
      const b = await row.boundingBox(), avatar = await row.locator('.av').boundingBox(), content = await row.locator('.cv-body').boundingBox();
      expect(Math.abs(avatar.width - avatar.height)).toBeLessThan(1);
      expect(content.width).toBeGreaterThan(100); expect(content.x).toBeGreaterThan(avatar.x + avatar.width);
      expect(content.x + content.width).toBeLessThanOrEqual(b.x + b.width);
    }
    await expect(page.locator('#composeBody')).toBeDisabled();
    if (width < 861) await marked(page, `after-${width}-inbox.png`, '.convo-col', 'After: a readable inbox, full-size search and filters');
    const first = page.locator('.convo').first(); await first.focus(); await first.press('ArrowDown'); await expect(page.locator('.convo').nth(1)).toBeFocused(); await page.keyboard.press('ArrowUp'); await expect(first).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.locator('#thName')).toHaveText('Dana Whitfield'); await expect(page.locator('#thread .msg')).toHaveCount(3); await expect(page.locator('#composeTo')).toHaveValue('+15551234567');
    await expect(page.locator('#thread .msg').first()).toContainText('Good morning');
    await expect(page.locator('#thSub')).toContainText('SMS'); await expect(page.locator('#chText')).toHaveClass(/active/);
    await page.locator('#composeBody').fill('I can help with your checklist.');
    await onScreen(page, '#composeBody'); await onScreen(page, '#sendBtn'); await noOverflow(page);
    expect(await page.locator('#sendBtn').evaluate(e => e.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    await marked(page, `after-${width}-thread.png`, '.thread-col', 'After: person, channel, conversation and reply stay together');
    if (width < 861) {
      await expect(page.locator('.convo-col')).toBeHidden(); await page.locator('#openClientContext').click();
      await expect(page.locator('#clientContext')).toHaveAttribute('role', 'dialog'); await expect(page.locator('#contextTitle')).toBeFocused();
      await expect(page.locator('#ctxName')).toHaveText('Dana Whitfield'); await expect(page.locator('#ctxRows')).toContainText('dana@example.test');
      await expect(page.locator('#ctxLinks a')).toHaveAttribute('href', `client-control-panel.html?id=${CLIENT}`);
      // The original reference drawer stays hidden by the shared demo-chrome rule.
      await page.locator('#ctxLinks a').focus(); await page.keyboard.press('Tab'); await expect(page.locator('#closeClientContext')).toBeFocused();
      if (width === 390) await marked(page, 'after-390-context.png', '#clientContext', 'After: client facts and file link have their own phone pane');
      await page.keyboard.press('Escape'); await expect(page.locator('#openClientContext')).toBeFocused();
      await expect(page.locator('#composeBody')).toHaveValue('I can help with your checklist.');
      await page.locator('#backToInbox').click(); await expect(page.locator('.convo-col')).toBeVisible(); await expect(page.locator('.convo[aria-selected=true]')).toBeFocused();
      await expect(page.locator('.thread-col')).toBeHidden(); await page.keyboard.press('Enter');
      await expect(page.locator('#thName')).toBeFocused();
    } else {
      await expect(page.locator('#clientContext')).toBeVisible(); await expect(page.locator('#ctxRows')).toContainText('dana@example.test');
      expect((await page.locator('#thread').boundingBox()).width).toBeGreaterThan(500);
    }
    await page.locator('#chEmail').click(); await expect(page.locator('#thSub')).toContainText('EMAIL'); await expect(page.locator('#composeTo')).toHaveValue('dana@example.test'); await expect(page.locator('#quietNote')).toBeHidden();
    if (width < 861) await page.locator('#backToInbox').click();
    await page.locator('#q').fill('nobody matches'); await expect(page.locator('#convoList')).toContainText('Nothing matches what you typed');
    await expect.poll(() => reads.filter(u => u.startsWith('/api/read/inbox')).length).toBeGreaterThan(1);
    expect(reads.filter(u => u.startsWith('/api/read/inbox')).at(-1)).not.toContain('needs_reply=1');
    await noOverflow(page); expect(errors).toEqual([]);
  });

  test(`loading, empty and recoverable error states at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    let release; const options = { listGate: new Promise(r => { release = r; }) }; await wire(page, options); await page.goto('/app/messaging.html');
    await expect(page.locator('#convoList')).toHaveAttribute('aria-busy', 'true'); await expect(page.locator('.skeleton')).toHaveCount(4);
    await marked(page, `after-${width}-loading.png`, '.convo-col', 'After: loading is shown inside the inbox');
    release(); await expect(page.locator('.convo')).toHaveCount(3);
    options.thread = { ok: false, message: 'Conversation could not be read.' }; options.threadStatus = 500;
    await page.locator('.convo').first().click(); await expect(page.locator('#thread')).toContainText('We could not load this conversation');
    options.thread = THREAD; options.threadStatus = 200;
    await page.locator('#thread [data-retry=thread]').click(); await expect(page.locator('#thread .msg')).toHaveCount(3); await expect(page.locator('#fh-data-banner')).toBeHidden();
    if (width < 861) await page.locator('#backToInbox').click();
    options.inbox = { ok: false, message: 'Inbox could not be read.' }; options.inboxStatus = 500;
    await page.locator('#refreshInbox').click(); await expect(page.locator('#convoList')).toContainText('We could not load your conversations');
    await marked(page, `after-${width}-error.png`, '.convo-col', 'After: read failure has a clear retry action');
    options.inbox = EMPTY; options.inboxStatus = 200;
    await page.locator('#convoList [data-retry=inbox]').click(); await expect(page.locator('#convoList')).toContainText('Nothing is waiting on a reply'); await expect(page.locator('.convo')).toHaveCount(0); await expect(page.locator('#fh-data-banner')).toBeHidden();
    await marked(page, `after-${width}-empty.png`, '.convo-col', 'After: an answered inbox is distinct from a failed read');
    await page.locator('.ctab[data-filter=all]').click(); await expect(page.locator('#convoList')).toContainText('No conversations yet'); await noOverflow(page);
  });
}

test('sending and blocked response keep an accurate status and editable draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release; const options = { sendGate: new Promise(r => { release = r; }) }; const { sent } = await wire(page, options); await page.goto('/app/messaging.html'); await page.locator('.convo').first().click();
  await page.locator('#composeTo').fill('+15557654321'); await page.locator('#composeBody').fill('Please use this number for this reply.'); await page.locator('#sendBtn').click();
  await expect(page.locator('#sendBtn')).toBeDisabled(); await expect(page.locator('#sendStatus')).toHaveText('Sending…'); await expect(page.locator('#sendBtn')).toHaveText('Sending…');
  await page.locator('#composeBody').press('Enter'); expect(sent).toHaveLength(1); release();
  await expect(page.locator('#sendStatus')).toContainText('Not sent'); await expect(page.locator('#sendStatus')).toContainText('opted_out'); await expect(page.locator('#composeBody')).toHaveValue('Please use this number for this reply.');
  expect(sent[0]).toMatchObject({ body: 'Please use this number for this reply.', conversation_id: ID, to: '+15557654321' }); expect(sent[0].idempotency_key).toBeTruthy();
  await onScreen(page, '#sendStatus'); await marked(page, 'after-390-blocked.png', '.compose', 'After: refusal explains why, with the draft kept for editing');
});

test('malformed destination cannot be sent with the button or Enter', async ({ page }) => {
  const { sent } = await wire(page); await page.goto('/app/messaging.html'); await page.locator('.convo').first().click(); await page.locator('#composeBody').fill('A test reply.'); await page.locator('#composeTo').fill('5551234567'); await expect(page.locator('#sendBtn')).toBeDisabled(); await expect(page.locator('#composeToNote')).toContainText('country code'); await page.locator('#composeBody').press('Enter'); expect(sent).toHaveLength(0);
  await page.locator('#composeTo').fill(''); await expect(page.locator('#sendBtn')).toBeEnabled();
});

test('permission refusal is actionable and preserves the draft', async ({ page }) => {
  await wire(page, { sendStatus: 403 }); await page.goto('/app/messaging.html'); await page.locator('.convo').first().click(); await page.locator('#composeBody').fill('Still signed in?'); await page.locator('#sendBtn').click(); await expect(page.locator('#sendStatus')).toContainText('signed in and clocked in'); await expect(page.locator('#composeBody')).toHaveValue('Still signed in?');
});

test('client/channel and old conversation deep links still open the requested conversation', async ({ page }) => {
  const { reads } = await wire(page); await page.goto(`/app/messaging.html?client_id=${CLIENT}&channel=email`); await expect(page.locator('#thName')).toHaveText('Dana Whitfield'); await expect(page.locator('#thSub')).toContainText('EMAIL'); await expect(page.locator('#composeTo')).toHaveValue('dana@example.test');
  const old = '99999999-9999-4999-8999-999999999999'; await page.goto(`/app/messaging.html?conversation_id=${old}`); await expect(page.locator('#thread .msg')).toHaveCount(3); expect(reads.some(u => u.includes('conversation_id=' + old))).toBe(true);
});

test('medium desktop opens and closes client details without shrinking three columns', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 }); await wire(page); await page.goto('/app/messaging.html'); await page.locator('.convo').first().click(); await expect(page.locator('#clientContext')).toBeHidden(); await page.locator('#openClientContext').click(); await expect(page.locator('#clientContext')).toBeVisible(); await expect(page.locator('.thread-col')).toHaveJSProperty('inert', true); await page.locator('#closeClientContext').click(); await expect(page.locator('.thread-col')).toHaveJSProperty('inert', false); await expect(page.locator('#openClientContext')).toBeFocused(); await noOverflow(page);
});

test.describe('phone touch controls', () => {
  test.use({ hasTouch: true });
  test('a short phone can open a person, inspect details, return and type without overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 }); await wire(page); await page.goto('/app/messaging.html'); await page.locator('.convo').first().tap(); await expect(page.locator('#composeTo')).toHaveValue('+15551234567');
    await page.locator('#openClientContext').tap(); await expect(page.locator('#ctxName')).toHaveText('Dana Whitfield'); await page.locator('#closeClientContext').tap(); await page.locator('#composeBody').tap(); await page.locator('#composeBody').fill('Your checklist is next.');
    expect(await page.locator('#composeBody').evaluate(e => getComputedStyle(e).fontSize)).toBe('16px'); await onScreen(page, '#sendBtn');
    expect((await page.locator('#thread').boundingBox()).height).toBeGreaterThan(90);
    await page.locator('#backToInbox').tap(); await expect(page.locator('.convo-col')).toBeVisible(); await noOverflow(page);
  });
});
