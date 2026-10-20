// Reproduce with Lighthouse installed in an isolated temporary tool directory.
// No app dependency or live API is used; the local server refuses all writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../../..');
const root = path.join(repo, 'public');
const toolRoot = process.env.LIGHTHOUSE_TOOL_ROOT;
if (!toolRoot || !path.isAbsolute(toolRoot)) throw new Error('Set LIGHTHOUSE_TOOL_ROOT to the temporary Lighthouse install directory');
const toolRequire = createRequire(path.join(toolRoot, 'fixture-loader.cjs'));
const lighthouse = (await import(pathToFileURL(toolRequire.resolve('lighthouse')).href)).default;
const { launch } = await import(pathToFileURL(toolRequire.resolve('chrome-launcher')).href);
const puppeteer = (await import(pathToFileURL(toolRequire.resolve('puppeteer-core')).href)).default;
const config = (await import(pathToFileURL(path.join(repo, 'playwright.config.mjs')).href)).default;
const chromePath = process.env.PLAYWRIGHT_CHROMIUM || config.use.launchOptions?.executablePath;
const apiRequests = [];
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const account = i => ({ id: `fixture-bank-${i}`, name: ['Fixture Mesa Community Bank', 'Fixture Coastal Business Credit Union', 'Fixture Pacific Commercial Bank'][i % 3] + (i > 2 ? ` ${i + 1}` : ''), state: ['AZ', 'SC', 'FL', 'CA'][i % 4], city: 'Phoenix', status: 'researching', next_action: 'Confirm business line requirements with banker', next_due_at: '2026-01-01T15:00:00Z' });
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end('Fixture server is read-only'); return; }
  if (url.pathname.startsWith('/api/')) {
    apiRequests.push({ method: req.method, path: url.pathname });
    let data = { ok: true, count: 0, items: [] };
    if (url.pathname === '/api/auth/session') data = { ok: true, staff: { id: 'fixture-rep', name: 'Casey Reed (fixture)', email: 'fixture@example.test', role: 'outbound_rep', org_id: 'fixture-org', status: 'active' } };
    if (url.pathname === '/api/read/bank-outreach') data = { ok: true, canManage: false, program: { states: ['AZ', 'SC', 'FL', 'CA'] }, summary: { verified_products_week: 7, verified_products_previous_week: 4, verified_partners: 12, missing_next_action: 0, due_now: 18, total: 27 }, total: 27, reps: [], items: Array.from({ length: 25 }, (_, i) => account(i)) };
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    return;
  }
  if (url.pathname === '/fixture-init') { res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Local fixture initialization</title>'); return; }
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400).end(); return; }
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'content-security-policy': "connect-src 'self'; font-src 'self' data:; img-src 'self' data:; frame-src 'none'; form-action 'none'" }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});

let chrome, browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  chrome = await launch({ chromePath, chromeFlags: ['--headless', '--window-size=390,844', '--disable-background-networking', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost'] });
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
  const page = (await browser.pages())[0];
  await page.goto(origin + '/fixture-init');
  await page.evaluate(() => { localStorage.setItem('fh_token', 'fixture-only-token'); localStorage.setItem('fh_role', 'outbound_rep'); });
  const result = await lighthouse(origin + '/app/bank-outreach.html?evidence=local-fixture', {
    port: chrome.port, hostname: '127.0.0.1', logLevel: 'error', output: 'json',
    onlyCategories: ['performance'], formFactor: 'mobile',
    screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false },
    throttlingMethod: 'devtools',
    throttling: { requestLatencyMs: 150, downloadThroughputKbps: 1600, uploadThroughputKbps: 750, cpuSlowdownMultiplier: 4 },
    disableFullPageScreenshot: true, enableErrorReporting: false
  });
  const lhr = result.lhr;
  const auditedRequests = apiRequests.slice();
  if (!(lhr.finalDisplayedUrl || lhr.finalUrl).includes('/app/bank-outreach.html')) throw new Error('Lighthouse measured a different page');
  // Lighthouse closes its audit tab. This fresh-tab render check is separate;
  // its own measured screenshot and network log are retained in the raw report.
  const pageAfter = await browser.newPage();
  await pageAfter.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  await pageAfter.goto(origin + '/app/bank-outreach.html?evidence=local-fixture');
  await pageAfter.waitForFunction(() => document.querySelectorAll('#queue-rows tr').length === 25);
  const rendered = await pageAfter.evaluate(() => ({ title: document.querySelector('#hero-value')?.textContent, rows: document.querySelectorAll('#queue-rows tr').length, role: localStorage.getItem('fh_role'), width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  if (rendered.rows !== 25 || rendered.role !== 'outbound_rep' || !rendered.title.includes('Fixture')) throw new Error('Full fixture screen did not render');
  const screenshot = lhr.audits['final-screenshot']?.details?.data;
  if (screenshot) await fs.writeFile(path.join(toolRoot, 'audited-final-screen.jpg'), Buffer.from(screenshot.split(',')[1], 'base64'));
  const resources = lhr.audits['resource-summary'].details.items;
  const metrics = {
    lcpMs: lhr.audits['largest-contentful-paint'].numericValue,
    cls: lhr.audits['cumulative-layout-shift'].numericValue,
    totalBlockingTimeMs: lhr.audits['total-blocking-time'].numericValue,
    localTtfbMs: lhr.audits['server-response-time']?.numericValue ?? null,
    jsTransferBytes: resources.find(r => r.resourceType === 'script')?.transferSize ?? null,
    pageTransferBytes: resources.find(r => r.resourceType === 'total')?.transferSize ?? null
  };
  const rawReport = JSON.stringify(lhr, null, 2) + '\n';
  const rawPath = path.join(toolRoot, 'lighthouse-mobile-fixture.report.json');
  await fs.writeFile(rawPath, rawReport);
  const sourceFiles = ['public/app/bank-outreach.html', 'public/app/bank-outreach.css', 'public/app/bank-outreach.js'];
  const sourceSha256 = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await fs.readFile(path.join(repo, file))).digest('hex')])));
  const scriptRelativePath = path.relative(repo, fileURLToPath(import.meta.url));
  const report = {
    scope: 'Local static page with labeled synthetic bank/session API fixtures. No production server, records, email, calls or outreach were used. Navigation has no field INP; total blocking time is a lab diagnostic, not INP. Local TTFB does not prove production response time.',
    version: lhr.lighthouseVersion, measuredAt: lhr.fetchTime,
    runtime: { node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release(), chromium: lhr.environment.hostUserAgent },
    viewport: '390x844', network: 'DevTools 150ms request latency, 1600Kbps download, 750Kbps upload', cpu: '4x slowdown',
    postAuditRenderCheck: rendered, metrics, performanceScore: lhr.categories.performance.score,
    warnings: lhr.runWarnings, apiRequests: auditedRequests, sourceSha256,
    rawReport: { path: rawPath, bytes: Buffer.byteLength(rawReport), sha256: createHash('sha256').update(rawReport).digest('hex') },
    reproduction: { workingDirectory: 'repository root', commands: [`npm install --prefix ${toolRoot} --no-save --package-lock=false --ignore-scripts lighthouse@${lhr.lighthouseVersion}`, `LIGHTHOUSE_TOOL_ROOT=${toolRoot} node ${scriptRelativePath}`], notes: 'Use an isolated temporary directory for the tool install. Reuses the existing browser selected by playwright.config.mjs; PLAYWRIGHT_CHROMIUM can select another installed Chromium. The server binds only to localhost and never proxies API requests.' },
    budgets: { lcp: Number.isFinite(metrics.lcpMs) && metrics.lcpMs < 2500, cls: Number.isFinite(metrics.cls) && metrics.cls < 0.1, js: Number.isFinite(metrics.jsTransferBytes) && metrics.jsTransferBytes < 500000, page: Number.isFinite(metrics.pageTransferBytes) && metrics.pageTransferBytes < 2000000, fieldInp: 'Not measured', productionTtfb: 'Not measured' }
  };
  await fs.writeFile(path.join(out, 'lighthouse-mobile-fixture.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (Object.values(report.budgets).some(value => value === false)) process.exitCode = 1;
} finally {
  if (browser) browser.disconnect();
  if (chrome) await chrome.kill();
  await new Promise(resolve => server.close(resolve));
}
