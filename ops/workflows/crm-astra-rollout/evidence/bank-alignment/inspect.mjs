import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, webkit, devices, expect } from '/private/tmp/fundhub-bank-outreach.0jXudA/node_modules/@playwright/test/index.mjs';
import { openScreen, OWNER, json } from '/private/tmp/fundhub-bank-outreach.0jXudA/e2e/harness.mjs';

const bankRoot = '/private/tmp/fundhub-bank-outreach.0jXudA';
const output = path.dirname(new URL(import.meta.url).pathname);
const queueRecordsOnly = process.argv.includes('--queue-records-only');
fs.mkdirSync(path.join(output, 'shots/_raw'), { recursive: true });
const source = fs.readFileSync(path.join(bankRoot, 'e2e/bank-outreach.spec.mjs'), 'utf8');
const fixture = new Function('openScreen', 'OWNER', 'json', 'path',
  source.slice(source.indexOf('const REP ='), source.indexOf('async function geometry')) + '\nreturn fixture;'
)(openScreen, OWNER, json, path);
const server = spawn(process.execPath, [path.join(bankRoot, 'e2e/static-server.mjs')], {
  cwd: bankRoot, env: { ...process.env, E2E_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
});
const origin = await new Promise((resolve, reject) => {
  server.stdout.on('data', chunk => { const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
  server.stderr.on('data', chunk => reject(new Error(String(chunk))));
  server.on('exit', code => reject(new Error('Static server exited: ' + code)));
});
const rows = queueRecordsOnly
  ? JSON.parse(fs.readFileSync(path.join(output, 'results.json'), 'utf8')).filter(row => row.state !== 'queue-record')
  : [];
const browsers = { chromium: await chromium.launch(), webkit: await webkit.launch() };
const profiles = [
  { name: 'desktop1440', engine: 'chromium', options: { viewport: { width: 1440, height: 900 } } },
  { name: 'phone390', engine: 'chromium', options: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  { name: 'promax440', engine: 'webkit', options: devices['iPhone 17 Pro Max'] },
  { name: 'landscape838', engine: 'webkit', options: devices['iPhone 17 Pro Max landscape'] },
  { name: 'intermediate768', engine: 'chromium', options: { viewport: { width: 768, height: 1024 } } },
  { name: 'intermediate1024', engine: 'chromium', options: { viewport: { width: 1024, height: 768 } } },
];

async function measure(page, scope = 'body') {
  return page.locator(scope).evaluate(root => {
    const visible = el => {
      if (el.closest('[hidden], [aria-hidden="true"]')) return false;
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor.tagName === 'DETAILS' && !ancestor.open
          && !ancestor.querySelector(':scope > summary')?.contains(el)) return false;
      }
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) !== 0 && r.width > 1 && r.height > 1;
    };
    const info = el => {
      const s = getComputedStyle(el), r = el.getBoundingClientRect();
      return { tag: el.tagName, id: el.id, classes: typeof el.className === 'string' ? el.className : '',
        text: (el.innerText || el.getAttribute('aria-label') || el.name || '').trim().slice(0, 90),
        font: parseFloat(s.fontSize), x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const controls = [...root.querySelectorAll('button,a[href],input,textarea,select,summary')]
      .filter(visible).filter(el => el.type !== 'hidden' && el.type !== 'file').map(info);
    const texts = [...root.querySelectorAll('*')].filter(visible).filter(el =>
      [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())).map(info);
    return {
      viewport: { width: innerWidth, height: innerHeight }, pageWidth: document.documentElement.scrollWidth,
      astra: document.body.classList.contains('fh-astra'), bodyFont: getComputedStyle(document.body).fontSize,
      controls, smallTargets: controls.filter(c => c.width < 43.99 || c.height < 43.99),
      smallText: texts.filter(t => t.font < 13),
      smallInputs: controls.filter(c => /INPUT|SELECT|TEXTAREA/.test(c.tag) && c.font < 16),
      fonts: [...new Set(texts.map(t => t.font))].sort((a, b) => a - b),
      nav: [...document.querySelectorAll('#side .navitem')].filter(visible).map(el => el.textContent.trim()),
      primary: [...root.querySelectorAll('.primary')].filter(visible).map(info),
      firstQueueCells: [...document.querySelectorAll('#queue-rows tr:first-child td')].map(el => ({
        text: el.innerText.trim(), classes: el.className, hidden: el.hidden,
        display: getComputedStyle(el).display,
      })),
    };
  });
}
async function shot(page, name, marks) {
  await page.screenshot({ path: path.join(output, 'shots/_raw', name + '.png'), scale: 'css' });
  await page.evaluate(marks => {
    const host = document.querySelector('dialog[open]') || document.body;
    const wrap = document.createElement('div'); wrap.id = 'bank-audit-overlay';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', innerWidth); svg.setAttribute('height', innerHeight);
    const legend = [];
    marks.forEach((mark, i) => {
      const el = document.querySelector(mark.selector); if (!el) return;
      const r = el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) return;
      const add = (tag, attrs, value) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (value) n.textContent = value; svg.append(n); };
      const cx = Math.max(14, Math.min(innerWidth - 14, r.left + 14)), cy = Math.max(14, Math.min(innerHeight - 120, r.top + 14));
      add('rect', { x: r.left, y: r.top, width: r.width, height: r.height, fill: 'none', stroke: '#D62222', 'stroke-width': 2 });
      add('line', { x1: cx + 44, y1: cy + 28, x2: cx + 10, y2: cy + 5, stroke: '#F2C500', 'stroke-width': 4 });
      add('path', { d: `M${cx + 10},${cy + 5}l13,1l-6,10z`, fill: '#F2C500' });
      add('circle', { cx, cy, r: 12, fill: 'white', stroke: '#D62222', 'stroke-width': 2 });
      add('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', fill: '#A71616', 'font-size': 13, 'font-family': 'Arial', 'font-weight': 'bold' }, String(i + 1));
      legend.push(`${i + 1}. ${mark.text}`);
    });
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;bottom:8px;left:8px;right:8px;background:#fff;border:2px solid #D62222;padding:8px;color:#8c1010;font:13px/1.35 Arial';
    box.textContent = 'BANK ALIGNMENT · LOCAL FIXTURE · ' + legend.join(' | ');
    wrap.append(svg, box); host.append(wrap);
  }, marks);
  await page.screenshot({ path: path.join(output, 'shots', name + '-MARKED.png'), scale: 'css' });
  await page.locator('#bank-audit-overlay').evaluate(el => el.remove());
}
async function record(page, role, profile, state, scope, marks) {
  const name = `${role}-${profile.name}-${state}`;
  const metrics = await measure(page, scope);
  rows.push({ name, role, engine: profile.engine, state, ...metrics });
  const measuredMarks = await Promise.all(marks.map(async mark => {
    const target = await page.locator(mark.selector).first().evaluate(el => ({
      height: el.getBoundingClientRect().height, font: getComputedStyle(el).fontSize,
    })).catch(() => ({ height: 'not present', font: 'not present' }));
    return { ...mark, text: mark.text.replace('{pageWidth}', metrics.pageWidth)
      .replace('{viewportWidth}', metrics.viewport.width).replace('{height}', target.height).replace('{font}', target.font)
      .replace('{assignedVisibility}', metrics.firstQueueCells.find(cell => cell.classes === 'manager-column')?.display === 'none'
        ? 'hidden in this intermediate-width table' : 'visible in this record') };
  }));
  await shot(page, name, measuredMarks);
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
}
try {
  for (const profile of profiles) for (const manager of [false, true]) {
    if (queueRecordsOnly && !manager) continue;
    const role = manager ? 'manager' : 'rep';
    const context = await browsers[profile.engine].newContext({ ...profile.options, baseURL: origin });
    const page = await context.newPage();
    const env = await fixture(page, { manager });
    await page.locator('#work-next').waitFor({ state: 'visible' }); await page.evaluate(() => document.fonts.ready);
    if (queueRecordsOnly) {
      await page.locator('#queue-view').click();
      await page.locator('#queue-rows tr').first().scrollIntoViewIfNeeded();
      await record(page, role, profile, 'queue-record', '#outreach-main', [
        { selector: '#queue-rows tr', text: 'NOTE: assigned rep is {assignedVisibility}; drawer assignment remains available.' },
      ]);
      await context.close();
      continue;
    }
    await record(page, role, profile, 'overview', 'body', [
      { selector: '#work-hero', text: 'KEEP: role-specific job and next bank action.' },
      { selector: '#fh-shell-chip-show', text: 'MEASURE: shared account target against 44px.' },
    ]);
    await page.locator('#fh-shell-chip-show').click();
    const technical = page.locator('.fh-account-technical summary');
    if (await technical.count()) await technical.click();
    await record(page, role, profile, 'account-open', 'body', [
      { selector: '.fh-account-menu', text: 'Page width {pageWidth}px / viewport {viewportWidth}px; target minimum 44px.' },
      { selector: '.fh-account-technical', text: 'FIX: 11–12px technical captions; require at least 13px.' },
    ]);
    await page.locator('#fh-shell-chip-show').click();
    if (manager) await page.locator('#queue-view').click();
    await page.locator('#queue-filters').scrollIntoViewIfNeeded();
    await record(page, role, profile, 'queue', '#outreach-main', [
      { selector: '#search', text: 'FIX: input text must be 16px, not inherited caption size.' },
      { selector: '#state', text: 'Native select {height}px high / {font} text; require 44px / 16px.' },
      { selector: '#queue-rows tr', text: 'KEEP: real records and phone stacking.' },
    ]);
    if (manager) {
      await page.locator('#queue-rows tr').first().scrollIntoViewIfNeeded();
      await record(page, role, profile, 'queue-record', '#outreach-main', [
        { selector: '#queue-rows tr', text: 'NOTE: assigned rep is {assignedVisibility}; drawer assignment remains available.' },
      ]);
    }
    await page.locator('#work-next').click();
    await page.locator('#drawer-content').waitFor({ state: 'visible' });
    await record(page, role, profile, 'touch-drawer', '#bank-drawer', [
      { selector: '[data-action="log_touch"] [name="channel"]', text: 'Native select {height}px high / {font} text; require 44px / 16px.' },
      { selector: '[data-action="log_touch"] [name="outcome"]', text: 'FIX: editable text must be 16px.' },
    ]);
    await page.locator('[data-action="log_touch"] [name="outcome"]').fill('Local alignment fixture note');
    await page.locator('[data-action="log_touch"] [name="next_action"]').fill('Confirm application path');
    await page.getByRole('button', { name: 'Save touch and next action' }).click();
    await expect.poll(() => env.posts.at(-1)?.action).toBe('log_touch');
    await page.locator('[data-section="products"]').click();
    await page.getByRole('button', { name: 'Edit facts', exact: true }).click();
    await record(page, role, profile, 'product-form', '#bank-drawer', [
      { selector: '#product-editor input', text: 'FIX: product input text must be 16px.' },
      { selector: '#product-editor .primary', text: '44px primary meets minimum; prefer 48px.' },
    ]);
    await page.locator('#product-editor .primary').scrollIntoViewIfNeeded();
    await record(page, role, profile, 'product-footer', '#bank-drawer', [
      { selector: '#product-editor .primary', text: 'KEEP reachable save; 44px meets minimum, prefer 48px.' },
    ]);
    await page.locator('[data-section="relationship"]').click();
    await record(page, role, profile, 'relationship', '#bank-drawer', [
      { selector: '[data-action="set_status"]', text: 'KEEP: relationship and next action remain together.' },
    ]);
    if (manager) {
      await page.locator('[name="staff_id"]').selectOption('rep-2');
      await page.getByRole('button', { name: 'Save assignment', exact: true }).click();
      await expect.poll(() => env.posts.at(-1)?.action).toBe('assign');
    } else await expect(page.locator('[data-action="assign"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    rows.push({ name: `${role}-${profile.name}-controls`, posts: env.posts.map(p => p.action), fixtureOnly: true });
    await context.close();
    console.log(role, profile.name, 'captured');
  }
  if (!queueRecordsOnly) for (const profile of [profiles[0], profiles[1]]) for (const manager of [false, true]) for (const state of ['loading', 'empty', 'error']) {
    const role = manager ? 'manager' : 'rep';
    const context = await browsers[profile.engine].newContext({ ...profile.options, baseURL: origin });
    const page = await context.newPage();
    const env = await fixture(page, { manager, state });
    if (manager && state === 'empty') await page.locator('#queue-view').click();
    await page.locator('#queue-state').scrollIntoViewIfNeeded();
    await record(page, role, profile, state, '#outreach-main', [
      { selector: '#queue-state', text: 'KEEP: state is explicit; recovery is role-specific.' },
    ]);
    if (state === 'empty') {
      await page.locator('#empty-action').click();
      if (manager) await expect(page.locator('#import-dialog')).toBeVisible();
    }
    if (state === 'error') {
      const count = env.reads.length; await page.locator('#queue-retry').click();
      await expect.poll(() => env.reads.length).toBeGreaterThan(count);
    }
    env.release(); await context.close();
  }
} finally {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(rows, null, 2) + '\n');
  await Promise.all(Object.values(browsers).map(b => b.close()));
  server.kill();
}
console.log('Recorded', rows.length, 'local fixture observations. No live requests or app edits.');
