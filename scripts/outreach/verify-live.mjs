// Manual production READ proof. No fixtures, credential repair, business writes or screenshots.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SITE = 'https://fundhub.ai';
export const STAFF_EMAIL = 'chris@fundhub.ai';
const BANK = '/app/bank-outreach.html';
const ASTRA = ['/app/fundhub-astra.css', '/app/fundhub-astra-staff.css'];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MANAGERS = ['owner', 'admin', 'sales_manager'];
class ProofError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function requireProof(value, code) { if (!value) throw new ProofError(code); }
export const hash = value => createHash('sha256').update(value).digest('hex');

export function parseArgs(args) {
  requireProof(args.length === 2 && args[0] === '--expected-sha' && /^[a-f0-9]{40}$/.test(args[1]), 'INVALID_EXPECTED_SHA');
  return { expectedSha: args[1] };
}
export function requirePassword(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const marker = candidate.startsWith('[') && candidate.endsWith(']') ? candidate.slice(1, -1) : candidate;
  requireProof(candidate.length > 0 && !/^(?:[*•●]+|x{4,}|\.{4,})$/iu.test(marker) &&
    !/^(?:redacted(?:[_ -]secret)?|masked(?:[_ -]password)?|hidden|placeholder|changeme|your[_ -]?password)$/i.test(marker), 'PASSWORD_UNAVAILABLE');
  return value;
}
export function safeUrl(value, base = SITE) {
  let url;
  try { url = new URL(value, base); } catch { throw new ProofError('UNSAFE_URL'); }
  requireProof(url.origin === SITE && !url.username && !url.password && !/%|\\/.test(url.pathname), 'UNSAFE_URL');
  return url;
}

// The manifest comes only from checked source. CSS dependencies are hashed too.
export function assetManifest(read) {
  const html = read(BANK).toString();
  const classes = html.match(/<body\b[^>]*class=["']([^"']*)/i)?.[1].split(/\s+/) || [];
  requireProof(['bank-outreach-page', 'fh-astra', 'fh-astra-staff', 'fh-astra--bank-outreach'].every(x => classes.includes(x)), 'ASTRA_SOURCE_MISSING');
  const styles = [...html.matchAll(/<link\b[^>]*>/gi)].filter(x => /rel=["']stylesheet["']/i.test(x[0]))
    .map(x => safeUrl(x[0].match(/href=["']([^"']+)/i)?.[1], SITE + BANK).pathname);
  const foundation = styles.indexOf(ASTRA[0]);
  requireProof(foundation > styles.indexOf('/app/bank-outreach.css') && styles.includes('/app/bank-outreach.css') &&
    ['/app/workspace-ui.css', '/app/fundhub-brand.css', '/app/crm-sidebar.css'].every(path => styles.includes(path) && styles.indexOf(path) < foundation) &&
    foundation === styles.length - 2 && styles.indexOf(ASTRA[1]) === styles.length - 1, 'ASTRA_STYLE_ORDER');
  const assets = new Map();
  const queue = [BANK, '/login.html', '/app/chat-widget.js'];
  while (queue.length) {
    const path = queue.shift();
    if (assets.has(path)) continue;
    let bytes;
    try { bytes = read(path); } catch { throw new ProofError('SOURCE_ASSET_MISSING'); }
    assets.set(path, hash(bytes));
    const text = bytes.toString();
    const refs = path.endsWith('.html') ? [...text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)].map(x => x[1])
      : path.endsWith('.css') ? [...text.matchAll(/(?:url\(\s*["']?([^\s"')]+)|@import\s+["']([^"']+))/gi)].map(x => x[1] || x[2]) : [];
    for (const ref of refs) {
      if (/^(?:data:|#|https?:\/\/)/i.test(ref)) {
        if (!ref.startsWith(SITE + '/')) continue; // External fonts are blocked, never fetched.
      }
      queue.push(safeUrl(ref, SITE + path).pathname);
    }
  }
  requireProof(ASTRA.every(x => assets.has(x)) && assets.has('/app/bank-outreach.js') && assets.has('/app/shell.js'), 'REQUIRED_ASSET_MISSING');
  return assets;
}

const READ_APIS = new Set(['/api/auth/login', '/api/auth/session', '/api/health', '/api/org-brand', '/api/staff/avatar', '/api/read/bank-outreach']);
export function requestDecision({ url, method, body, resourceType }, state, assets, password) {
  let parsed;
  try { parsed = safeUrl(url); } catch { return ['GET', 'HEAD'].includes(method) ? 'BLOCK_EXTERNAL' : 'BLOCK_EXTERNAL_WRITE'; }
  if (method === 'POST' && parsed.pathname === '/api/auth/login' && !parsed.search && !parsed.hash && state.loginOpen && state.loginAttempts === 0) {
    let data;
    try { data = JSON.parse(body); } catch { return 'BLOCK_WRITE'; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'BLOCK_WRITE';
    if (Object.keys(data).sort().join(',') !== 'email,password' || data.email !== STAFF_EMAIL || data.password !== password) return 'BLOCK_WRITE';
    return 'LOGIN';
  }
  if (!['GET', 'HEAD'].includes(method)) return 'BLOCK_WRITE';
  if (resourceType === 'document' && ![BANK, '/login.html'].includes(parsed.pathname)) return 'BLOCK_READ';
  if (assets.has(parsed.pathname) || READ_APIS.has(parsed.pathname)) return 'READ';
  return 'BLOCK_READ';
}

// Browser continuation checks only the first URL: a redirect could otherwise forward
// the login password to an unchecked destination. Fetch exactly the checked hop;
// forward only its real non-redirect response, with no body/header substitutions.
export async function forwardCheckedRoute(route, state) {
  const deny = async code => {
    state.routeGuardFailures = (state.routeGuardFailures || 0) + 1;
    state.firstRouteFailure ||= code;
    try { await route.abort('blockedbyclient'); } catch { /* Already red; never expose a request/error call log. */ }
    return false;
  };
  let response;
  try { response = await route.fetch({ maxRedirects: 0, maxRetries: 0, timeout: 15000 }); }
  catch { return deny('REQUEST_FETCH_FAILED'); }
  if (response.status() >= 300 && response.status() < 400) return deny('REQUEST_REDIRECT_BLOCKED');
  try { await route.fulfill({ response }); }
  catch { return deny('REQUEST_FORWARD_FAILED'); }
  return true;
}

export function queueCounts(data) {
  requireProof(data?.ok === true && data.canManage === true && data.program?.key === 'bank_relationships' && Array.isArray(data.items) &&
    Number.isSafeInteger(data.total) && data.total >= data.items.length && data.items.length <= 25, 'QUEUE_CONTRACT');
  requireSummary(data.summary);
  return { total: data.total, pageRows: data.items.length, verifiedProductsWeek: data.summary.verified_products_week, verifiedPartners: data.summary.verified_partners };
}
function requireSummary(summary) {
  requireProof(summary && ['verified_products_week', 'verified_products_previous_week', 'verified_partners', 'due_now', 'missing_next_action', 'total']
    .every(x => Number.isSafeInteger(summary[x]) && summary[x] >= 0), 'SUMMARY_CONTRACT');
}
export function teamCounts(data) {
  requireProof(data?.ok === true && data.canManage === true && data.program?.key === 'bank_relationships' && Array.isArray(data.byRep) && Array.isArray(data.byState), 'TEAM_CONTRACT');
  requireSummary(data.summary);
  requireProof([...data.byRep, ...data.byState].every(row => ['total', 'verified_partners', 'due_now'].every(x => Number.isSafeInteger(row[x]) && row[x] >= 0)), 'TEAM_COUNT_CONTRACT');
  return { repGroups: data.byRep.length, stateGroups: data.byState.length, verifiedProductsWeek: data.summary.verified_products_week };
}
export function anonymousDenied(status, data) {
  return status === 401 && data?.ok === false && data.error === 'unauthorized';
}
export function requireGeometry(g, phone) {
  requireProof(g.overflow === false && g.controlCount > 0 && g.editableCount > 0 && g.primaryCount > 0 &&
    g.outsideViewport === 0 && g.minimumTargetHeight >= (phone ? 44 : 32) && g.minimumTargetWidth >= (phone ? 44 : 24) &&
    (!phone || (g.bodyFont >= 16 && g.minimumEditableFont >= 16 && g.minimumPrimaryHeight >= 48)), 'GEOMETRY_CONTRACT');
  return g;
}

// This function returns numbers/booleans only, never text, input values, ids or screenshots.
async function geometry(page) {
  return page.evaluate(() => {
    const visible = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const dialog = document.querySelector('#import-dialog[open]');
    const scope = dialog || document.querySelector('#outreach-main');
    const controls = [...scope.querySelectorAll('button,input:not([type=hidden]),select,textarea,a[href]')].filter(visible);
    const editable = controls.filter(e => e.matches('input,select,textarea'));
    const primary = controls.filter(e => e.matches('.primary'));
    const rects = controls.map(e => e.getBoundingClientRect());
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1, controlCount: controls.length, editableCount: editable.length,
      primaryCount: primary.length, bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
      minimumEditableFont: Math.min(...editable.map(e => parseFloat(getComputedStyle(e).fontSize))),
      minimumTargetHeight: Math.min(...rects.map(r => r.height)), minimumTargetWidth: Math.min(...rects.map(r => r.width)),
      minimumPrimaryHeight: Math.min(...primary.map(e => e.getBoundingClientRect().height)),
      outsideViewport: rects.filter(r => r.left < -1 || r.right > innerWidth + 1).length };
  });
}

export async function runLive({ expectedSha, password, root = ROOT, receipt }) {
  requirePassword(password);
  requireProof(process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REF === 'refs/heads/main', 'MANUAL_MAIN_CI_ONLY');
  requireProof(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() === expectedSha, 'CHECKOUT_SHA_MISMATCH');
  const assets = assetManifest(path => readFileSync(resolve(root, 'public' + path)));
  receipt.stages.source = true;
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const state = { loginOpen: false, loginAttempts: 0, blockedWrites: 0, blockedReads: 0, blockedExternal: 0, pageErrors: 0, assetErrors: 0, routeGuardFailures: 0, firstRouteFailure: null };
  const forwarding = new Set();
  const forward = route => {
    const task = forwardCheckedRoute(route, state);
    forwarding.add(task);
    void task.finally(() => forwarding.delete(task));
    return task;
  };
  let context;
  try {
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    requireProof((await context.cookies()).length === 0, 'CONTEXT_NOT_FRESH');
    await context.route('**/*', async route => {
      const request = route.request();
      const decision = requestDecision({ url: request.url(), method: request.method(), body: request.postData(), resourceType: request.resourceType() }, state, assets, password);
      if (decision === 'LOGIN') { state.loginAttempts++; return forward(route); }
      if (decision === 'READ') return forward(route);
      if (decision === 'BLOCK_WRITE' || decision === 'BLOCK_EXTERNAL_WRITE') state.blockedWrites++;
      else if (decision === 'BLOCK_READ') state.blockedReads++;
      else state.blockedExternal++;
      if (decision === 'BLOCK_EXTERNAL_WRITE') state.blockedExternal++;
      return route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', socket => { state.blockedExternal++; socket.close(); });
    // APIRequestContext bypasses browser routing: this helper can ONLY issue fixed-origin GETs.
    const get = async path => {
      const url = safeUrl(path);
      requireProof(assets.has(url.pathname) || READ_APIS.has(url.pathname), 'UNSAFE_READ');
      return context.request.get(url.href, { maxRedirects: 0, timeout: 30000, headers: { 'cache-control': 'no-cache' } });
    };
    receipt.assets = [];
    for (const [path, expected] of assets) {
      const response = await get(path + '?release=' + expectedSha);
      const actual = hash(await response.body());
      receipt.assets.push({ path, status: response.status(), sha256: actual, matches: actual === expected });
      requireProof(response.status() === 200 && actual === expected, 'PUBLISHED_ASSET_MISMATCH');
      await response.dispose();
    }
    receipt.stages.publishedBytes = true;
    const anonymous = await get('/api/read/bank-outreach');
    const denial = await anonymous.json().catch(() => null);
    receipt.anonymous = { status: anonymous.status(), requiresSignIn: anonymousDenied(anonymous.status(), denial) };
    requireProof(receipt.anonymous.requiresSignIn, 'ANONYMOUS_AUTH_DENIAL_NOT_PROVED');
    await anonymous.dispose();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', () => { state.pageErrors++; });
    const loadedAssets = new Set(), pending = new Set();
    let queueData, teamData, sessionData;
    page.on('response', response => {
      const task = (async () => {
        const url = safeUrl(response.url());
        if (assets.has(url.pathname)) {
          if (response.status() !== 200 || hash(await response.body()) !== assets.get(url.pathname)) state.assetErrors++;
          else loadedAssets.add(url.pathname);
        }
        if (response.request().method() !== 'GET') return;
        if (url.pathname === '/api/auth/session' && response.status() === 200) sessionData = await response.json();
        if (url.pathname === '/api/read/bank-outreach' && response.status() === 200) {
          const data = await response.json();
          if (url.searchParams.get('view') === 'team') teamData = data;
          else if (!url.searchParams.has('id')) queueData = data;
        }
      })().catch(() => { state.assetErrors++; });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    });
    receipt.stage = 'normal_login';
    await page.goto(SITE + '/login.html?next=%2Fapp%2Fbank-outreach.html', { waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill(STAFF_EMAIL);
    await page.locator('#pw').fill(password);
    state.loginOpen = true;
    const loginResponse = page.waitForResponse(r => r.url() === SITE + '/api/auth/login' && r.request().method() === 'POST', { timeout: 30000 }).catch(() => null);
    await page.locator('#go').click(); // Exactly one ordinary login. No retry/reset fallback.
    const login = await loginResponse;
    state.loginOpen = false;
    receipt.login = { attempts: state.loginAttempts, status: login?.status() || 0 };
    requireProof(state.loginAttempts === 1 && login?.status() === 200, 'NORMAL_LOGIN_FAILED');
    await page.waitForURL(SITE + BANK, { timeout: 30000 });
    await page.locator('#team-content .team-grid').waitFor();
    await page.locator('html.fh-page-access-confirmed').waitFor();
    await Promise.all([...pending]);
    requireProof(sessionData?.ok === true && sessionData.principal === 'staff' && sessionData.staff?.email?.toLowerCase() === STAFF_EMAIL &&
      MANAGERS.includes(sessionData.staff.role) && sessionData.staff.status === 'active' && !sessionData.demo, 'EXISTING_MANAGER_SESSION_NOT_PROVED');
    receipt.stages.normalManagerSession = true;
    receipt.queue = { httpStatus: 200, ...queueCounts(queueData) };
    receipt.team = { httpStatus: 200, ...teamCounts(teamData) };
    receipt.stage = 'real_manager_render';
    requireProof(await page.locator('#team-section').isVisible() && await page.locator('#team-view').getAttribute('aria-pressed') === 'true' &&
      await page.locator('#hero-label').innerText() === 'Verified lender products this week' &&
      await page.locator('#hero-value').innerText() === String(teamData.summary.verified_products_week) &&
      await page.locator('#import-open').isVisible() && await page.locator('#view-switch').isVisible(), 'MANAGER_ROLE_FIRST_RENDER');
    const teamMatches = await page.evaluate(({ byRep, byState }) => {
      const groups = [...document.querySelectorAll('#team-content .team-grid > div')];
      return groups.length === 2 && [byRep, byState].every((rows, index) => {
        const rendered = [...groups[index].querySelectorAll('dl > div')];
        return rendered.length === rows.length && rows.every((row, n) => rendered[n].querySelector('dt').textContent === (index ? row.state : row.name) &&
          rendered[n].querySelector('dd').textContent === `${row.verified_partners} partners${row.total} banks · ${row.due_now} due`);
      });
    }, { byRep: teamData.byRep, byState: teamData.byState });
    requireProof(teamMatches, 'TEAM_RENDER_MISMATCH');
    await page.locator('#queue-view').click();
    const queueMatches = await page.evaluate(({ items, total }) => {
      const rows = [...document.querySelectorAll('#queue-rows tr[data-account]')];
      return document.querySelector('#queue-count').textContent === `${total} bank${total === 1 ? '' : 's'}` && rows.length === items.length &&
        items.every((item, n) => rows[n].dataset.account === item.id && rows[n].querySelector('td strong').textContent === item.name) &&
        (items.length > 0 ? !document.querySelector('#queue-table').hidden : document.querySelector('#queue-state h3')?.textContent === 'No banks in this view');
    }, { items: queueData.items, total: queueData.total });
    requireProof(queueMatches, 'QUEUE_RENDER_MISMATCH');
    receipt.stages.realQueueAndTeamRender = true;
    receipt.geometry = [];
    for (const width of [1440, 390, 440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.locator('#search').waitFor();
      const queue = await geometry(page);
      // An empty queue has no visible primary button; the Import dialog proves that control.
      requireProof(!queue.overflow && queue.outsideViewport === 0 && queue.controlCount > 0 && queue.editableCount > 0 &&
        queue.minimumTargetHeight >= (width < 600 ? 44 : 32) && queue.minimumTargetWidth >= (width < 600 ? 44 : 24) &&
        (width >= 600 || (queue.bodyFont >= 16 && queue.minimumEditableFont >= 16)), 'QUEUE_GEOMETRY_CONTRACT');
      await page.locator('#import-open').click();
      await page.locator('#import-dialog[open]').waitFor();
      const importer = requireGeometry(await geometry(page), width < 600);
      await page.locator('#import-close').click();
      await page.locator('#fh-shell-chip-show').click();
      const menu = await page.locator('#fh-shell-chip .fh-account-menu').evaluate(el => {
        const r = el.getBoundingClientRect();
        const targets = [...el.querySelectorAll('button,summary'), document.querySelector('#fh-shell-chip-show')]
          .map(e => e.getBoundingClientRect()).filter(rect => rect.width > 0 && rect.height > 0);
        return { width: r.width, left: r.left, right: r.right, viewport: innerWidth, targetCount: targets.length,
          minimumTargetHeight: Math.min(...targets.map(rect => rect.height)), minimumTargetWidth: Math.min(...targets.map(rect => rect.width)) };
      });
      requireProof(menu.width > 0 && menu.left >= -1 && menu.right <= menu.viewport + 1 && menu.targetCount >= 3 &&
        (width >= 600 || (menu.minimumTargetHeight >= 44 && menu.minimumTargetWidth >= 44)), 'ACCOUNT_MENU_GEOMETRY');
      await page.locator('#fh-shell-chip-show').click();
      receipt.geometry.push({ viewportWidth: width, queue, importer, accountMenu: menu });
    }
    await Promise.all([...pending]);
    await Promise.all([...forwarding]);
    requireProof([BANK, '/app/bank-outreach.css', '/app/bank-outreach.js', '/app/shell.js', ...ASTRA].every(path => loadedAssets.has(path)), 'BROWSER_LOADED_ASSETS_NOT_PROVED');
    receipt.browser = { pageErrors: state.pageErrors, loadedAssetErrors: state.assetErrors, loadedCheckedAssets: loadedAssets.size };
    requireProof(state.routeGuardFailures === 0 && state.blockedWrites === 0 && state.blockedReads === 0 && state.pageErrors === 0 && state.assetErrors === 0 && state.loginAttempts === 1, 'REQUEST_OR_BROWSER_GUARD_FAILED');
    receipt.stages.browserLoadedCheckedAssets = true;
    receipt.stages.phoneAndDesktopGeometry = true;
    receipt.requests = { loginAttempts: state.loginAttempts, blockedBusinessWrites: state.blockedWrites, blockedUnapprovedReads: state.blockedReads, blockedThirdPartyRequests: state.blockedExternal };
    receipt.ok = true;
  } finally {
    if (context) await context.close().catch(() => {});
    await Promise.all([...forwarding]);
    await browser.close().catch(() => {});
    receipt.guard = { failures: state.routeGuardFailures, firstFailure: state.firstRouteFailure };
    receipt.requests = { loginAttempts: state.loginAttempts, blockedBusinessWrites: state.blockedWrites, blockedUnapprovedReads: state.blockedReads, blockedThirdPartyRequests: state.blockedExternal };
    if (state.routeGuardFailures > 0) { receipt.ok = false; throw new ProofError(state.firstRouteFailure); }
  }
}

async function main() {
  const receipt = { ok: false, stage: 'preflight', stages: {}, site: SITE, checkedAt: new Date().toISOString(),
    scope: { ordinaryLoginAndSessionBookkeeping: true, businessMutationsAllowed: false, savedBankerToLenderJourney: 'NOT_EXERCISED',
      populatedDrawer: 'NOT_EXERCISED', repIsolation: 'NOT_EXERCISED_OWNER_SESSION', fixtureData: false, screenshots: false } };
  try {
    const args = parseArgs(process.argv.slice(2));
    requireProof(process.env.RUNNER_TEMP && isAbsolute(process.env.RUNNER_TEMP), 'RUNNER_TEMP_REQUIRED');
    receipt.expectedReleaseSha = args.expectedSha;
    await runLive({ ...args, password: process.env.STAFF_E2E_PASSWORD, receipt });
    receipt.stage = 'complete';
  } catch (error) {
    // Never emit Playwright call logs, URLs, bodies, profile information or credentials.
    receipt.failure = receipt.guard?.firstFailure || (error instanceof ProofError ? error.code : 'LIVE_PROOF_ERROR');
    process.exitCode = 1;
  }
  const outputRoot = process.env.RUNNER_TEMP;
  if (outputRoot && isAbsolute(outputRoot)) {
    try { writeFileSync(resolve(outputRoot, 'bank-outreach-live-proof.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 }); }
    catch { receipt.ok = false; receipt.failure = 'RECEIPT_WRITE_FAILED'; process.exitCode = 1; }
  } else { receipt.ok = false; receipt.failure = 'RUNNER_TEMP_REQUIRED'; process.exitCode = 1; }
  console.log(JSON.stringify(receipt));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
