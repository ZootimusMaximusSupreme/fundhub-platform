// Read-only live-static Lighthouse audit. No production API request is allowed.
// Tool dependencies remain in an explicitly configured, already-installed root.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createFixture } from '../dashboard-ux-polish/astra-comparison/fixtures.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.join(HERE, 'evidence/performance');
const arg = key => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const TOOL_ROOT = arg('lighthouse-tool-root') || process.env.LIGHTHOUSE_TOOL_ROOT;
const CHROME = arg('chrome-path') || process.env.CHROME_PATH;
if (!TOOL_ROOT || !path.isAbsolute(TOOL_ROOT)) throw new Error('STOP: provide an absolute existing LIGHTHOUSE_TOOL_ROOT or --lighthouse-tool-root=; this runner installs nothing');
if (!CHROME || !path.isAbsolute(CHROME)) throw new Error('STOP: provide an absolute existing CHROME_PATH or --chrome-path=; this runner installs no browser');
await fs.access(CHROME);
const dependency = createRequire(path.join(TOOL_ROOT, 'package.json'));
const lighthousePackage = JSON.parse(await fs.readFile(path.join(TOOL_ROOT, 'node_modules/lighthouse/package.json'), 'utf8'));
if (lighthousePackage.version !== '13.5.0') throw new Error('STOP: this proof configuration requires the reviewed installed Lighthouse 13.5.0');
const { default: lighthouse } = await import(pathToFileURL(dependency.resolve('lighthouse')).href);
const { throttling } = await import(pathToFileURL(dependency.resolve('lighthouse/core/config/constants.js')).href);
const { launch } = await import(pathToFileURL(dependency.resolve('chrome-launcher')).href);
const { default: puppeteer } = await import(pathToFileURL(dependency.resolve('puppeteer-core')).href);
const selftest = process.argv.includes('--selftest');
const fixturePreflight = process.argv.includes('--fixture-preflight');
const release = arg('release-confirmed');
const sample = JSON.parse(await fs.readFile(path.join(ROOT, 'src/demo/client-portal-sample-bundle.json'), 'utf8'));
const CLIENT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const staff = createFixture().staff;
const owner = { ok: true, principal: 'staff', staff: staff[0] };
const client = { ok: true, principal: 'client', staff: { id: CLIENT_ID, client_id: CLIENT_ID, role: 'client', name: 'Fictional Performance Client', email: 'performance@example.test', affiliate_id: 'fixture-affiliate', org_id: 'fixture-org', status: 'active' } };
const cards = Array.from({ length: 27 }, (_, i) => ({ id: `fixture-card-${i}`, client_id: `${CLIENT_ID.slice(0, -2)}${String(i).padStart(2, '0')}`, name: `Fictional Business ${i + 1}`, owner: 'Alex Morgan', entered_at: '2026-10-18T10:00:00Z', outcome_tier: null, funded: false, amount: 3000 }));
const affiliate = { ok: true, enrolled: true, affiliate: { id: 'fixture-affiliate', name: 'Fictional Performance Client', code: 'PERF-FIXTURE-ONLY', offerLinks: [{ name: 'Funding', url: 'https://example.test/start?ref=PERF-FIXTURE-ONLY' }] }, rates: { direct: { rules: [{}], percent: 20 } }, gates: { license: { signed: true }, tax: { onFile: true } }, referrals: cards.map((c, i) => ({ name: c.name, attributedAt: '2026-10-17', status: i % 2 ? 'converted' : 'attributed', product: 'Consulting', basisAmount: 3000, commissionDue: null })), payouts: [] };
const common = {
  ...sample.reads,
  '/api/read/affiliate-portal': { ok: true, enrolled: false },
  '/api/read/staff': { ok: true, items: staff, hiddenCount: 0 },
  '/api/shifts': { ok: true, shift: null, roster: [] },
  '/api/health': { ok: true, db: 'fixture-only' },
  '/api/tasks': { ok: true, tasks: [] },
  '/api/content/welcome-video': { ok: true, video: null },
  '/api/push/preferences': { ok: true, enabled: false, preferences: {} },
  '/api/org-brand': { ok: true, brand: null },
  '/api/read/portal-contracts': { ok: true, items: [] },
  '/api/read/affiliates': { ok: true, items: [] },
  '/api/consent/capture': { ok: true, capture: { version: '2.1', sections: [] } },
  '/api/chat/portal-message': { ok: true, messages: [], items: [] },
  '/api/dashboard/kpis': { ok: true, kpis: { cash_collected_cents: 810000, funded_count: 3, new_clients: 27 }, display: { cash: '$8,100', funded: '3', close: '—', show: '—', cpf: '—', clients: '27', pipeline_movement: '—' } },
  '/api/dashboard/clients': { ok: true, clients: cards.map(c => ({ id: c.client_id, first_name: 'Fictional', last_name: c.name, custom_fields: {} })) },
};
const pages = [
  { key: 'portal-login', url: '/portal-login.html', selector: '#f #email', min: 1, session: null, handlers: {}, entry: true },
  { key: 'portal', url: `/app/client-portal.html?id=${CLIENT_ID}`, selector: '.cp-next-action', min: 1, text: 'Credit pull received', session: client, handlers: {} },
  { key: 'money', url: '/app/money.html', selector: '#money-root .tiles', min: 1, text: '$13,385.00', session: client, handlers: {} },
  { key: 'affiliate', url: '/app/affiliate.html', selector: '#leadBody tr', min: 25, text: 'PERF-FIXTURE-ONLY', session: client, handlers: { '/api/read/affiliate-portal': affiliate } },
  { key: 'teams', url: '/app/staff-teams.html', selector: '#rosterBody tr[data-id]', min: 25, text: 'Alex Morgan', session: owner, handlers: {} },
  { key: 'pipeline', url: '/app/pipeline.html', selector: '.card[data-client-id]', min: 27, text: 'Fictional Business', session: owner, handlers: { '/api/dashboard/pipeline': { ok: true, pipeline: 'sales', total: 27, stages: [{ key: 'new_lead', name: 'New Lead', sort_order: 0, count: 18, amount: 54000, cards: cards.slice(0, 18) }, { key: 'booked', name: 'Booked', sort_order: 2, count: 9, amount: 27000, cards: cards.slice(18) }] } } },
];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = (file, data) => fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
const settings = {
  logLevel: 'error', output: ['json', 'html'], onlyCategories: ['performance'],
  formFactor: 'mobile', screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false },
  throttlingMethod: 'devtools', throttling: { ...throttling.mobileSlow4G, cpuSlowdownMultiplier: 4 },
  disableFullPageScreenshot: true, enableErrorReporting: false,
};

async function installGuard(page, target, origin, dir) {
  const log = { apiFixtures: [], denied: [], allowedStatic: [], embeddedResources: [], errors: [], sources: [] };
  const pending = new Set();
  let captureStopped = false;
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on('request', request => {
    const task = (async () => {
      const url = new URL(request.url());
      const method = request.method();
      if (method === 'GET' && ['image', 'font', 'other'].includes(request.resourceType())
          && (/^data:(?:image\/|font\/)/.test(url.href) || url.href === 'data:,')) {
        log.embeddedResources.push({ type: request.resourceType(), sha256: sha(url.href), urlLength: url.href.length, network: false });
        return request.continue();
      }
      const api = /^(?:\/api(?:\/|$)|\/\.netlify\/functions\/)/.test(url.pathname);
      if (url.origin === origin && api && ['GET', 'HEAD'].includes(method)) {
        const data = url.pathname === '/api/auth/session'
          ? (target.session || { ok: false, error: 'fixture_signed_out' })
          : ({ ...common, ...target.handlers })[url.pathname];
        log.apiFixtures.push({ path: url.pathname, method, known: !!data });
        return request.respond({ status: data ? 200 : 503, contentType: 'application/json',
          headers: { 'cache-control': 'no-store', 'x-astra-perf-fixture': 'fictional-local-response' },
          body: JSON.stringify(data || { ok: false, error: 'unmapped_performance_fixture' }) });
      }
      const staticPath = /\.(?:html|css|js|mjs|json|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|otf|ico)$/i.test(url.pathname);
      if (url.origin !== origin || api || !['GET', 'HEAD'].includes(method) || !staticPath
          || ['websocket', 'eventsource'].includes(request.resourceType())) {
        log.denied.push({ url: url.href, method, type: request.resourceType() });
        return request.abort('blockedbyclient');
      }
      // Fake authentication never leaves the browser, even on permitted assets.
      const headers = { ...request.headers() };
      for (const key of Object.keys(headers)) if (/authorization|cookie|token|api.key/i.test(key)) delete headers[key];
      log.allowedStatic.push({ url: url.href, method, type: request.resourceType() });
      return request.continue({ headers });
    })().catch(error => { log.errors.push(String(error)); });
    pending.add(task); task.finally(() => pending.delete(task));
  });
  page.on('response', response => {
    if (captureStopped) return;
    const u = new URL(response.url());
    if (u.origin !== origin || u.pathname.startsWith('/api/') || !log.allowedStatic.some(r => r.url === u.href)) return;
    const task = (async () => {
      const bytes = await response.buffer();
      const hash = sha(bytes);
      const ext = path.extname(u.pathname).slice(1) || 'bin';
      await fs.writeFile(path.join(dir, 'sources', `${hash}.${ext}`), bytes);
      const headers = response.headers();
      let localHash = null;
      if (!selftest) {
        try { localHash = sha(await fs.readFile(path.join(ROOT, 'public', u.pathname))); } catch {}
      }
      log.sources.push({ url: u.href, status: response.status(), sha256: hash, decodedBytes: bytes.length,
        contentType: headers['content-type'], cacheControl: headers['cache-control'], localHash,
        matchesLocal: localHash === null ? null : localHash === hash, file: `sources/${hash}.${ext}` });
    })().catch(error => log.errors.push(`Source capture: ${u.pathname}: ${error.message}`));
    pending.add(task); task.finally(() => pending.delete(task));
  });
  page.on('pageerror', error => log.errors.push(error.message));
  await page.evaluateOnNewDocument(({ target }) => {
    // Defense in depth for network paths that do not use this page's HTTP interception.
    for (const name of ['Worker', 'SharedWorker', 'WebSocket', 'WebTransport']) {
      if (name in window) Object.defineProperty(window, name, { configurable: true, value: function () { throw new Error('Performance audit blocks background network constructors'); } });
    }
    if (navigator.serviceWorker) {
      try { navigator.serviceWorker.register = () => Promise.reject(new Error('Performance audit blocks service workers')); } catch {}
    }
    window.open = () => null;
    if (target.session) {
      localStorage.setItem('fh_token', 'fictional-performance-token-no-authority');
      localStorage.setItem('fh_role', target.session.staff.role);
      localStorage.removeItem('fh_demo');
    }
    const check = () => {
      if (window.__astraPerfReady) return;
      const count = document.querySelectorAll(target.selector).length;
      const text = document.body?.innerText || '';
      if (count >= target.min && (!target.text || text.includes(target.text))) {
        window.__astraPerfReady = { at: performance.now(), count, path: location.pathname, width: innerWidth, height: innerHeight, fullFixture: true };
        performance.mark('astra-fixture-full');
      }
    };
    new MutationObserver(check).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', check);
  }, { target: { ...target, handlers: undefined } });
  return { log, flush: async ({ auditedStaticUrls } = {}) => {
    if (!captureStopped) {
      // Lighthouse uses its own CDP session. Its source-code re-requests can
      // leave Puppeteer's network-idle counter open after the audited load.
      // Audit mode therefore proves source coverage against Lighthouse's
      // actual network records; local fixture setup still waits for idle.
      if (!auditedStaticUrls) {
        try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 10000 }); }
        catch (error) { log.errors.push(`Source capture did not settle: ${error.message}`); }
      }
      while (pending.size) await Promise.allSettled([...pending]);
      if (auditedStaticUrls) {
        const captured = new Set(log.sources.map(source => source.url));
        for (const url of auditedStaticUrls) if (!captured.has(url)) log.errors.push(`Audited static bytes were not captured: ${url}`);
      }
      captureStopped = true;
    }
    while (pending.size) await Promise.allSettled([...pending]);
  } };
}

function summarize(lhr, source, dom) {
  const value = id => lhr.audits[id]?.numericValue ?? null;
  const resources = lhr.audits['resource-summary']?.details?.items || [];
  const network = lhr.audits['network-requests']?.details?.items || [];
  const blocking = lhr.audits['render-blocking-insight']?.details?.items || [];
  const staticUrls = new Set(source.map(row => row.url));
  const staticRequests = network.filter(row => staticUrls.has(row.url));
  const budgetBytes = type => resources.find(row => row.resourceType === type)?.transferSize ?? null;
  const findNode = value => {
    if (!value || typeof value !== 'object') return null;
    if (value.type === 'node') return value;
    for (const child of Object.values(value)) {
      const node = Array.isArray(child) ? child.map(findNode).find(Boolean) : findNode(child);
      if (node) return node;
    }
    return null;
  };
  const insights = Object.fromEntries(Object.entries(lhr.audits).filter(([key]) => /lcp|render-block|server-response|document-latency|long-tasks|third-party/.test(key)));
  return {
    performanceScore: lhr.categories.performance.score * 100,
    lcpMs: value('largest-contentful-paint'), tbtProxyMs: value('total-blocking-time'),
    cls: value('cumulative-layout-shift'), speedIndexMs: value('speed-index'),
    ttfbMs: dom.navigationTTFBMs, lighthouseServerResponseMs: value('server-response-time'),
    jsBytes: budgetBytes('script'), pageBytes: budgetBytes('total'),
    liveStaticTransferBytes: staticRequests.reduce((sum, row) => sum + (row.transferSize || 0), 0),
    lcpElement: findNode(lhr.audits['lcp-breakdown-insight']?.details) || { status: 'UNMEASURED: Lighthouse did not provide an LCP node' },
    top5RenderBlockingResources: blocking.slice().sort((a, b) => b.wastedMs - a.wastedMs).slice(0, 5),
    headRenderBlockingRequestCount: blocking.filter(row => [...dom.headStylesheets, ...dom.headBlockingScripts].includes(row.url)).length,
    thirdPartyScripts: network.filter(row => row.resourceType === 'Script' && new URL(row.url).origin !== new URL(lhr.finalDisplayedUrl || lhr.finalUrl).origin).map(row => ({ url: row.url, transferSize: row.transferSize })),
    resourceBreakdown: resources, insights, dom,
    top5LongTasks: (lhr.audits['long-tasks']?.details?.items || []).slice().sort((a, b) => b.duration - a.duration).slice(0, 5),
    top5RequestDurations: network.map(r => ({ url: r.url, transferSize: r.transferSize, durationMs: r.networkEndTime - r.networkRequestTime })).sort((a, b) => b.durationMs - a.durationMs).slice(0, 5),
    // Network duration is not main-thread blocking time. Keep these separate.
    sources: source, warnings: lhr.runWarnings, fieldINP: 'NOT MEASURED',
  };
}

async function runTarget(browser, target, origin, dir) {
  await fs.mkdir(path.join(dir, 'sources'), { recursive: true });
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
  const guard = await installGuard(page, target, origin, dir);
  const started = new Date().toISOString();
  try {
    const result = await lighthouse(origin + target.url, settings, undefined, page);
    if (!result) throw new Error('No Lighthouse result');
    const lhr = result.lhr;
    await fs.writeFile(path.join(dir, 'lighthouse.json'), result.report[0]);
    await fs.writeFile(path.join(dir, 'lighthouse.html'), result.report[1]);
    const dom = await page.evaluate(() => ({
      path: location.pathname, title: document.title, astra: document.body.classList.contains('fh-astra'),
      ready: window.__astraPerfReady || null, inlineStyleCount: document.querySelectorAll('[style]').length,
      headBlockingScripts: [...document.head.querySelectorAll('script[src]')].filter(el => !el.async && !el.defer && el.type !== 'module').map(el => el.src),
      headStylesheets: [...document.head.querySelectorAll('link[rel=stylesheet]')].map(el => el.href),
      navigationTTFBMs: performance.getEntriesByType('navigation')[0]?.responseStart ?? null,
      width: innerWidth,
    }));
    const auditedNetwork = lhr.audits['network-requests']?.details?.items || [];
    const allowed = new Set(guard.log.allowedStatic.map(row => row.url));
    const auditedStaticUrls = [...new Set(auditedNetwork.filter(row => allowed.has(row.url) && row.statusCode >= 200 && row.statusCode < 400).map(row => row.url))];
    if (!auditedStaticUrls.length) guard.log.errors.push('No audited static network evidence');
    for (const row of auditedNetwork.filter(row => row.statusCode >= 200 && row.statusCode < 400 && /^https?:/.test(row.url))) {
      const url = new URL(row.url);
      const fixture = url.origin === origin && url.pathname.startsWith('/api/') && guard.log.apiFixtures.some(api => api.path === url.pathname && api.known);
      if (!allowed.has(row.url) && !fixture) guard.log.errors.push(`Successful audited request escaped the allowlist: ${row.url}`);
    }
    await guard.flush({ auditedStaticUrls });
    await json(path.join(dir, 'guard.json'), guard.log);
    const summary = { key: target.key, started, liveStatic: !selftest, fictionalAPI: true, release: release || null,
      settings, ...summarize(lhr, guard.log.sources, dom) };
    await json(path.join(dir, 'summary.json'), summary);
    const finalPath = new URL(lhr.finalDisplayedUrl || lhr.finalUrl).pathname;
    if (finalPath !== new URL(target.url, origin).pathname || !dom.ready || dom.ready.width !== 390 || (!selftest && !dom.astra)) throw new Error('Wrong page, incomplete fixture, wrong viewport, or missing Astra opt-in; no performance pass');
    if (lhr.runtimeError) throw new Error(`Lighthouse runtime error: ${lhr.runtimeError.message}`);
    if (guard.log.errors.length) throw new Error(`Page/guard errors: ${guard.log.errors.join('; ')}`);
    if (guard.log.sources.some(s => s.matchesLocal === false)) throw new Error('Deployed source mismatch; no performance pass');
    if (guard.log.apiFixtures.some(r => !r.known)) throw new Error('Unmapped fixture API: inspect guard.json before interpreting performance');
    const screen = lhr.audits['final-screenshot']?.details?.data;
    if (screen) await fs.writeFile(path.join(dir, 'audited-final.jpg'), Buffer.from(screen.split(',')[1], 'base64'));
    return summary;
  } catch (error) {
    await guard.flush();
    await json(path.join(dir, 'guard.json'), guard.log);
    await json(path.join(dir, 'failure.json'), { error: error.message, started, liveStatic: !selftest, noPassClaimed: true });
    throw error;
  } finally { await context.close(); }
}

await fs.mkdir(OUT, { recursive: true });
let chrome, browser, server;
try {
  let origin = 'https://fundhub.ai';
  const reached = [];
  if (selftest || fixturePreflight) {
    server = http.createServer(async (req, res) => {
      reached.push({ method: req.method, path: req.url });
      if (fixturePreflight) {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        if (pathname.startsWith('/api/') || req.method !== 'GET') { res.writeHead(500).end('Unexpected API/write network escape'); return; }
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
        try { const bytes = await fs.readFile(path.join(ROOT, 'public', pathname)); res.writeHead(200, { 'content-type': types[path.extname(pathname)] || 'application/octet-stream' }).end(bytes); }
        catch { res.writeHead(404).end('Local fixture preparation asset not found'); }
        return;
      }
      if (req.url !== '/canary.html') { res.writeHead(500).end('Unexpected network escape'); return; }
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>Guard preflight only</title><h1>Local guard preflight</h1><main id="ready"></main><script>fetch("/api/canary").then(r=>r.json()).then(d=>document.querySelector("#ready").textContent=d.label);fetch("/api/forbidden",{method:"POST"}).catch(()=>{});fetch("https://example.invalid/forbidden.css").catch(()=>{});</script>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
  } else {
    if (!/^[a-f0-9]{40}$/.test(release || '')) throw new Error('STOP: requires root-confirmed exact live release SHA via --release-confirmed=');
    const receipt = JSON.parse(await fs.readFile(path.join(ROOT, 'ops/workflows/crm-astra-rollout/evidence/live-responsive/asset-bytes.json'), 'utf8'));
    if (receipt.source !== release || !receipt.assets?.length || receipt.assets.some(asset => !asset.matches)) throw new Error('STOP: matching successful root live-byte receipt is required');
  }
  chrome = await launch({ chromePath: CHROME, chromeFlags: ['--headless', '--disable-background-networking', '--disable-sync', '--no-first-run', '--window-size=390,844', '--disable-features=Prerender2,SpeculationRulesPrefetch'] });
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}`, defaultViewport: null });
  if (fixturePreflight) {
    const checks = [];
    for (const target of pages) {
      const dir = path.join(OUT, 'local-fixture-preflight', target.key);
      await fs.mkdir(path.join(dir, 'sources'), { recursive: true });
      const context = await browser.createBrowserContext(), page = await context.newPage();
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
      const guard = await installGuard(page, target, origin, dir);
      let failure = null, ready = null;
      try {
        await page.goto(origin + target.url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__astraPerfReady, { timeout: 15000 });
        ready = await page.evaluate(() => ({ ...window.__astraPerfReady, astra: document.body.classList.contains('fh-astra') }));
      } catch (error) { failure = error.message; ready = await page.evaluate(target => ({ count: document.querySelectorAll(target.selector).length, path: location.pathname, bodyText: document.body.innerText.slice(0, 1200), expectedTextPresent: !target.text || document.body.innerText.includes(target.text) }), target); }
      await guard.flush();
      await json(path.join(dir, 'guard.json'), guard.log);
      checks.push({ key: target.key, localOnly: true, noLiveMeasurement: true, ready, failure, unmapped: guard.log.apiFixtures.filter(r => !r.known), errors: guard.log.errors, denied: guard.log.denied });
      await context.close();
      console.log(target.key, ready ? 'fixture rendered' : failure);
    }
    const escapes = reached.filter(r => r.path.startsWith('/api/') || r.method !== 'GET');
    await json(path.join(OUT, 'local-fixture-preflight', 'checks.json'), { checks, networkEscapes: escapes, noPerformanceClaimed: true });
    if (escapes.length || checks.some(c => c.failure || c.unmapped.length || c.errors.length || !c.ready?.astra)) process.exitCode = 1;
  } else if (selftest) {
    const target = { key: 'preflight-only', url: '/canary.html', selector: '#ready', min: 1, text: 'FICTIONAL CANARY', session: null, handlers: { '/api/canary': { label: 'FICTIONAL CANARY' } } };
    const result = await runTarget(browser, target, origin, path.join(OUT, 'preflight-only'));
    const escaped = reached.some(r => r.path !== '/canary.html' || r.method !== 'GET');
    await json(path.join(OUT, 'preflight-only', 'safety-receipt.json'), { passed: !escaped, localOnly: true, noLiveMeasurement: true, serverRequests: reached, ready: result.dom.ready, lighthouseVersion: '13.5.0', sameProvidedPage: true });
    if (escaped) throw new Error('Interception failed: unexpected request reached local canary server');
    console.log('PASS: same-page Lighthouse guard retained interception; no API/write/external request reached the server. Local canary only.');
  } else {
    const all = [];
    for (const target of pages) for (let run = 1; run <= 3; run++) {
      console.log(`Measuring ${target.key} ${run}/3 from actual production static assets`);
      const result = await runTarget(browser, target, origin, path.join(OUT, release, target.key, `run-${run}`));
      all.push({ ...result, run });
      await json(path.join(OUT, release, 'runs.json'), all);
    }
    const median = values => values.slice().sort((a, b) => a - b)[1];
    const medians = pages.map(target => {
      const runs = all.filter(row => row.key === target.key);
      const metrics = Object.fromEntries(['performanceScore', 'lcpMs', 'tbtProxyMs', 'cls', 'speedIndexMs', 'ttfbMs', 'jsBytes', 'pageBytes', 'liveStaticTransferBytes'].map(key => [key, runs.every(row => Number.isFinite(row[key])) ? median(runs.map(row => row[key])) : null]));
      const budgets = target.entry ? { lcpMs: 1500, cls: 0.1, ttfbMs: 400, jsBytes: 200000, pageBytes: 1000000 } : { lcpMs: 2500, cls: 0.1, ttfbMs: 600, jsBytes: 500000, pageBytes: 2000000 };
      const budgetResults = Object.fromEntries(Object.entries(budgets).map(([metric, budget]) => [metric, { measured: metrics[metric], budget, result: !Number.isFinite(metrics[metric]) ? 'UNMEASURED' : metrics[metric] < budget ? 'PASS_WITHIN_GUARDED_SCOPE' : 'FAIL' }]));
      return { page: target.key, scope: 'Live first-party static assets with fictional API and blocked external requests; not full production or backend performance',
        metrics, budgets, budgetResults, fieldINP: 'UNPROVED — TBT is only a lab proxy and does not pass INP',
        estimatedRenderBlockingLcpSavingsMs: median(runs.map(row => row.insights['render-blocking-insight']?.metricSavings?.LCP || 0)) };
    });
    await json(path.join(OUT, release, 'medians.json'), medians);
    const findings = medians.flatMap(row => Object.entries(row.budgetResults).filter(([, result]) => result.result !== 'PASS_WITHIN_GUARDED_SCOPE').map(([metric, result]) => ({
      page: row.page, metric, ...result, severity: result.result === 'UNMEASURED' ? 'EVIDENCE GAP' : row.page !== 'portal-login' && result.measured >= result.budget * 2 ? 'HIGH' : 'MEDIUM',
      cause: 'Inspect this page’s saved Lighthouse insights and source manifest; no cause inferred solely from the budget miss',
      estimatedSecondsSaved: null, evidence: `${row.page}/run-{1,2,3}/lighthouse.html`,
    })));
    for (const row of medians) {
      const runs = all.filter(run => run.key === row.page);
      if (runs.some(run => run.dom.headBlockingScripts.length || run.top5RenderBlockingResources.length)) findings.push({
        page: row.page, metric: 'render-blocking head resources', severity: 'HIGH',
        measured: runs.map(run => run.headRenderBlockingRequestCount), budget: 'No render-blocking JS; measure render-blocking resources',
        estimatedSecondsSaved: row.estimatedRenderBlockingLcpSavingsMs / 1000,
        evidence: `${row.page}/run-{1,2,3}/summary.json`, cause: 'Exact resource URLs and Lighthouse savings are saved per run',
      });
      if (runs.some(run => run.dom.inlineStyleCount)) findings.push({ page: row.page, metric: 'inline style attributes', severity: 'LOW',
        measured: runs.map(run => run.dom.inlineStyleCount), budget: 0, estimatedSecondsSaved: null,
        evidence: `${row.page}/run-{1,2,3}/summary.json`, cause: 'PERF-STANDARDS cacheability rule; no timing cost invented' });
    }
    findings.sort((a, b) => (b.estimatedSecondsSaved ?? -1) - (a.estimatedSecondsSaved ?? -1));
    await json(path.join(OUT, release, 'findings.json'), findings);
    if (findings.some(row => row.severity !== 'LOW')) process.exitCode = 1;
    console.log(JSON.stringify(medians, null, 2));
  }
} finally {
  if (browser) browser.disconnect();
  if (chrome) await chrome.kill();
  if (server) await new Promise(resolve => server.close(resolve));
}
