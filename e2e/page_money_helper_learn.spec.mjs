// The money helper's lessons in a real browser (Finance OS wave 4, unit ED): the "Learn the
// basics" buttons, a lesson answer with its "From:" line and the chexsystems.com button, on the
// standalone helper page and the FinanceOS helper tab, at 1440, 390 and 320 wide, in all four
// states. Every API answer is a local fixture; nothing reaches a server.
// Run: E2E_PORT=43321 npx playwright test e2e/page_money_helper_learn.spec.mjs
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { topicGuidance, topicReply, LEARN_TOPICS } from '../src/finance/money-education.mjs';

const sample = JSON.parse(fs.readFileSync('src/http/fixtures/money-helper.sample.json', 'utf8'));
const evidence = 'ops/workflows/build-evidence/ED';
fs.mkdirSync(evidence, { recursive: true });

const lessonTurn = (id, question, brain, at) => ({
  id, kind: 'message', actor: 'client', input: question, task_id: null, status: 'answered',
  reply: topicReply(topicGuidance(question)), actions: [], brain, model: brain === 'ai' ? 'claude-code' : null,
  reason_words: brain === 'rules' ? "Answered by the rules helper: the AI helper's computer is off right now." : null,
  created_at: at, answered_at: at
});
const full = {
  ...sample,
  turns: [
    ...sample.turns,
    lessonTurn('00000009-aaaa-4bbb-8ccc-000000000009', 'What are inquiries and what is seasoning?', 'ai', '2026-10-07T16:54:00.000Z'),
    lessonTurn('00000010-aaaa-4bbb-8ccc-000000000010', 'What is ChexSystems?', 'rules', '2026-10-07T16:55:00.000Z')
  ]
};

/** Stub every API the two pages call. Returns the list of POST bodies. */
async function stub(page, getState) {
  const posts = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    const url = req.url();
    let body = { ok: true };
    let status = 200;
    if (url.includes('/auth/session')) body = { ok: true, principal: 'client' };
    else if (url.includes('/affiliate-portal')) body = { ok: true, enrolled: false };
    else if (url.includes('/money/helper')) {
      const state = getState();
      if (req.method() === 'POST') { posts.push(req.postDataJSON()); body = { ok: true, action: 'send', queued: false, turn: null }; }
      else if (state === 'loading') return undefined; // never answers: the skeleton stays
      else if (state === 'error') { status = 500; body = { ok: false }; }
      else body = state === 'empty' ? { ...full, turns: [] } : full;
    }
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return posts;
}

/** The format check: nothing wider than the screen, no control under 44 by 44, no clipped or
 *  overlapping lesson button, the lessons above the box to type in. */
async function formatCheck(page, scope) {
  return page.evaluate((sel) => {
    const out = { sideways: document.documentElement.scrollWidth > innerWidth, small: [], offScreen: [], clipped: [], overlaps: [], learnAboveBox: null };
    const root = document.querySelector(sel);
    if (!root) return { ...out, missing: true };
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    for (const el of root.querySelectorAll('button, a[href], textarea, input, select, summary')) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      const name = (el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40);
      if (r.width < 44 || r.height < 44) out.small.push(`${name} ${Math.round(r.width)}x${Math.round(r.height)}`);
      if (r.left < -0.5 || r.right > innerWidth + 0.5) out.offScreen.push(name);
    }
    const chips = [...root.querySelectorAll('[data-act="learn"]')].filter(visible);
    for (const c of chips) if (c.scrollWidth > c.clientWidth + 1 || c.scrollHeight > c.clientHeight + 1) out.clipped.push(c.textContent.trim());
    for (let i = 0; i < chips.length; i++) {
      for (let j = i + 1; j < chips.length; j++) {
        const a = chips[i].getBoundingClientRect(), b = chips[j].getBoundingClientRect();
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.overlaps.push(`${chips[i].textContent} / ${chips[j].textContent}`);
      }
    }
    const learn = root.querySelector('.learn');
    const box = root.querySelector('.composer');
    if (learn && box) out.learnAboveBox = learn.getBoundingClientRect().bottom <= box.getBoundingClientRect().top + 0.5;
    out.chips = chips.length;
    return out;
  }, scope);
}

/** Where the three new parts sit in a screenshot, for the marked evidence copies. `full`:
 *  page coordinates (a full-page shot); otherwise what is on the screen right now. */
const MARKS = [
  ['Learn the basics: seven lesson buttons', '.fh-helper .learn'],
  ['From: the doc the answer came from', '.fh-helper .from-helper .cite'],
  ['Official site button, fixed address', '.fh-helper .links .btn']
];
async function saveMarks(page, file, { full }) {
  const boxes = await page.evaluate(([list, isFull]) => list.map(([label, sel], i) => {
    const all = document.querySelectorAll(sel);
    const el = all[all.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const box = { n: i + 1, label, x: r.left + (isFull ? scrollX : 0), y: r.top + (isFull ? scrollY : 0), w: r.width, h: r.height };
    const thread = el.closest('.thread');
    const t = thread ? thread.getBoundingClientRect() : null;
    const inThread = !t || (r.top >= t.top - 1 && r.bottom <= t.bottom + 1);
    const onScreen = isFull || (r.top >= 0 && r.bottom <= innerHeight);
    return inThread && onScreen ? box : null;
  }).filter(Boolean), [MARKS, full]);
  fs.writeFileSync(file, JSON.stringify(boxes, null, 1));
}

function assertFormat(f, label, { lessons }) {
  expect(f.missing, `${label}: the helper painted`).toBeFalsy();
  expect(f.sideways, `${label}: no sideways scroll`).toBe(false);
  expect(f.small, `${label}: controls under 44x44`).toEqual([]);
  expect(f.offScreen, `${label}: controls off the screen`).toEqual([]);
  if (lessons) {
    expect(f.chips, `${label}: the seven lesson buttons`).toBe(7);
    expect(f.clipped, `${label}: clipped lesson buttons`).toEqual([]);
    expect(f.overlaps, `${label}: overlapping lesson buttons`).toEqual([]);
    expect(f.learnAboveBox, `${label}: the lessons sit above the box, not over it`).toBe(true);
  }
}

for (const width of [1440, 390, 320]) {
  test(`helper page: lessons, a lesson answer and all four states at ${width}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
    let state = 'full';
    const posts = await stub(page, () => state);
    for (state of ['full', 'empty', 'error', 'loading']) {
      await page.goto('/app/money-helper.html');
      await expect(page.locator('body')).toHaveAttribute('data-client-ios', '');
      if (state === 'full') {
        await expect(page.locator('.from-helper')).toHaveCount(full.turns.length);
        const cites = page.locator('.from-helper .cite');
        await expect(cites).toHaveText(['From: Applying On Your Own lesson.', 'From: Fundhub bank book.', 'From: Blueprint lessons.']);
        const link = page.getByRole('link', { name: 'Open chexsystems.com' });
        await expect(link).toBeVisible();
        await expect(link).toHaveAttribute('href', 'https://www.chexsystems.com');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(page.locator('.from-helper .cite').last()).toHaveCSS('font-size', '13px');
        const f = await formatCheck(page, '.fh-helper');
        assertFormat(f, `full ${width}`, { lessons: true });
        await page.getByRole('button', { name: 'Seasoning', exact: true }).click();
        await expect.poll(() => posts.length).toBe(1);
        expect(posts[0]).toEqual({ action: 'send', message: 'What is seasoning?' });
      } else if (state === 'empty') {
        await expect(page.locator('[data-act=suggest]')).toHaveCount(3);
        await expect(page.locator('[data-act=learn]')).toHaveText(LEARN_TOPICS.map((t) => t.title));
        assertFormat(await formatCheck(page, '.fh-helper'), `empty ${width}`, { lessons: true });
        await page.getByRole('button', { name: 'Gas cards', exact: true }).click();
        await expect.poll(() => posts.length).toBe(2);
        expect(posts[1]).toEqual({ action: 'send', message: 'Should I get a gas card?' });
      } else if (state === 'error') {
        await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
        await expect(page.locator('[data-act=learn]')).toHaveCount(0);
        assertFormat(await formatCheck(page, '.fh-helper'), `error ${width}`, { lessons: false });
      } else {
        await expect(page.locator('[aria-busy=true]').first()).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      }
      if (state === 'full') await saveMarks(page, `${evidence}/helper-full-${width}.marks.json`, { full: true });
      await page.screenshot({ path: `${evidence}/helper-${state}-${width}.png`, fullPage: true });
    }
    expect(errors).toEqual([]);
  });

  test(`FinanceOS helper tab: lessons and a lesson answer at ${width}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.setViewportSize({ width, height: width > 760 ? 900 : 844 });
    const posts = await stub(page, () => 'full');
    await page.goto('/app/financeos.html#helper');
    await expect(page.locator('#fos-helper .from-helper')).toHaveCount(full.turns.length);
    await expect(page.locator('#fos-helper .cite').last()).toHaveText('From: Blueprint lessons.');
    await expect(page.locator('#fos-helper .cite').last()).toHaveCSS('font-size', '13px');
    await expect(page.locator('#fos-helper').getByRole('link', { name: 'Open chexsystems.com' })).toBeVisible();
    assertFormat(await formatCheck(page, '#fos-helper .fh-helper'), `financeos ${width}`, { lessons: true });
    await saveMarks(page, `${evidence}/financeos-helper-full-${width}.marks.json`, { full: true });
    await page.screenshot({ path: `${evidence}/financeos-helper-full-${width}.png`, fullPage: true });
    await page.locator('#fos-helper').getByRole('button', { name: 'Card use', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: 'send', message: 'How should I use my cards?' });
    expect(errors).toEqual([]);
  });
}

/* A real phone screen, scrolled to the very bottom: the box to type in, Send and the lesson
   buttons must clear the fixed bottom bar (Home / Progress / Money / Documents). */
for (const [width, height] of [[390, 844], [320, 568]]) {
  for (const where of ['/app/money-helper.html', '/app/financeos.html#helper']) {
    test(`phone ${width}x${height}, scrolled to the bottom of ${where}: nothing sits under the bottom bar`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stub(page, () => 'full');
      await page.goto(where);
      await expect(page.locator('.fh-helper .composer')).toBeVisible();
      const shot = where.includes('financeos') ? 'financeos-helper' : 'helper';
      await saveMarks(page, `${evidence}/${shot}-phone-top-${width}x${height}.marks.json`, { full: false });
      await page.screenshot({ path: `${evidence}/${shot}-phone-top-${width}x${height}.png` });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(150);
      const r = await page.evaluate(() => {
        const bars = [...document.querySelectorAll('body *')].filter((el) => {
          const s = getComputedStyle(el);
          if (s.position !== 'fixed' || s.display === 'none' || s.visibility === 'hidden') return false;
          const b = el.getBoundingClientRect();
          return b.height > 0 && b.width > innerWidth * 0.8 && b.bottom >= innerHeight - 1 && b.top > innerHeight / 2;
        });
        const barTop = bars.length ? Math.min(...bars.map((el) => el.getBoundingClientRect().top)) : innerHeight;
        const under = [...document.querySelectorAll('.fh-helper .composer textarea, .fh-helper .composer .btn-primary, .fh-helper [data-act="learn"]')]
          .filter((el) => el.getBoundingClientRect().bottom > barTop + 0.5)
          .map((el) => (el.textContent || el.tagName).trim() || el.tagName);
        return { barTop, bars: bars.length, under, sideways: document.documentElement.scrollWidth > innerWidth };
      });
      expect(r.sideways).toBe(false);
      expect(r.bars, 'the client phone bottom bar is on the screen').toBeGreaterThanOrEqual(1);
      expect(r.under, `under the bottom bar (top ${r.barTop}, ${r.bars} bar)`).toEqual([]);
      await saveMarks(page, `${evidence}/${shot}-phone-bottom-${width}x${height}.marks.json`, { full: false });
      await page.screenshot({ path: `${evidence}/${shot}-phone-bottom-${width}x${height}.png` });
    });
  }
}

test('stopped or switched off: no lesson buttons', async ({ page }) => {
  let state = 'stopped';
  await page.route('**/api/**', (route) => {
    const url = route.request().url();
    let body = { ok: true };
    if (url.includes('/auth/session')) body = { ok: true, principal: 'client' };
    else if (url.includes('/affiliate-portal')) body = { ok: true, enrolled: false };
    else if (url.includes('/money/helper')) body = { ...full, helper: { ...full.helper, on: state !== 'off', halted: state === 'stopped', halt_reason: 'stop' } };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  for (state of ['stopped', 'off']) {
    await page.goto('/app/money-helper.html');
    await expect(page.locator('.banner')).toBeVisible();
    await expect(page.locator('[data-act=learn]')).toHaveCount(0);
  }
});
