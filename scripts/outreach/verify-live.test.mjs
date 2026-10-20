import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { anonymousDenied, assetManifest, forwardCheckedRoute, hash, parseArgs, queueCounts, requestDecision, requireGeometry, requirePassword, safeUrl, STAFF_EMAIL, teamCounts } from './verify-live.mjs';

const SHA = 'a'.repeat(40);
const BANK = '/app/bank-outreach.html';
const ASTRA = ['/app/fundhub-astra.css', '/app/fundhub-astra-staff.css'];
const PASSWORD = 'controlled-test-only-passphrase';
const assets = new Map([[BANK, SHA], ['/login.html', SHA], ['/app/bank-outreach.js', SHA]]);
const state = () => ({ loginOpen: false, loginAttempts: 0 });
const decision = (url, method = 'GET', overrides = {}, s = state()) => requestDecision({ url, method, ...overrides }, s, assets, PASSWORD);
const summary = { total: 0, verified_products_week: 0, verified_products_previous_week: 0, verified_partners: 0, due_now: 0, missing_next_action: 0 };
const base = { ok: true, canManage: true, program: { key: 'bank_relationships' }, summary };

test('arguments require exactly one lowercase full release SHA; no account, target or credential override', () => {
  assert.deepEqual(parseArgs(['--expected-sha', SHA]), { expectedSha: SHA });
  for (const args of [[], ['--expected-sha', 'a'.repeat(39)], ['--expected-sha', 'A'.repeat(40)], ['--expected-sha', SHA, '--base', 'https://evil.test'], ['--expected-sha', '$(touch hacked)'], ['--expected-sha', SHA + '\n']]) {
    assert.throws(() => parseArgs(args), /INVALID_EXPECTED_SHA/);
  }
});

test('empty and masked secrets fail before login, without echoing their value', () => {
  for (const value of [undefined, '', '   ', '********', '[REDACTED_SECRET]', 'MASKED_PASSWORD', '[HIDDEN]', 'your-password', 'xxxxxx', '....', '••••••', '●●●●', ' *•●* ', 'placeholder', 'changeme']) {
    assert.throws(() => requirePassword(value), error => error.message === 'PASSWORD_UNAVAILABLE');
  }
  assert.equal(requirePassword(PASSWORD), PASSWORD);
});

test('real password characters and embedded marker words are not mistaken for complete masks', () => {
  for (const value of ['controlled*Strong42!', 'controlled-hidden-Strong42!', 'controlled-placeholder-Strong42!', 'controlled-MASKED_PASSWORD42!', 'controlled-redacted42!', '  controlled*Strong42!  ']) {
    assert.equal(requirePassword(value), value); // Preserve exact credential bytes, including surrounding spaces.
  }
});

test('URL policy pins HTTPS apex host, forbids credentials, alternate ports and encoded paths', () => {
  assert.equal(safeUrl('/api/read/bank-outreach?view=team').origin, 'https://fundhub.ai');
  for (const url of ['http://fundhub.ai/app/a.js', 'https://fundhub.ai.evil.test/a', 'https://evil.test/', 'https://user:secret@fundhub.ai/a', 'https://fundhub.ai:8443/a', 'https://fundhub.ai/api/%61uth/login']) {
    assert.throws(() => safeUrl(url), /UNSAFE_URL/);
  }
});

test('only fixed reads are allowed; business writes, logout/reset, unknown GETs and navigation are denied', () => {
  for (const path of ['/api/auth/session', '/api/health', '/api/org-brand', '/api/read/bank-outreach?view=team', BANK]) assert.equal(decision('https://fundhub.ai' + path), 'READ');
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    assert.equal(decision('https://fundhub.ai/api/bank-outreach', method), 'BLOCK_WRITE');
    assert.equal(decision('https://tracker.test/pixel', method), 'BLOCK_EXTERNAL_WRITE');
  }
  for (const path of ['/api/auth/logout', '/api/auth/reset-password', '/api/read/staff', '/api/bank-outreach?action=import', '/api/unknown']) assert.equal(decision('https://fundhub.ai' + path), 'BLOCK_READ');
  assert.equal(decision('https://fonts.googleapis.com/a.css'), 'BLOCK_EXTERNAL');
  assert.equal(decision('https://fundhub.ai/api/health', 'GET', { resourceType: 'document' }), 'BLOCK_READ');
});

test('exactly one normal login POST is permitted only in the explicit login window', () => {
  const request = { body: JSON.stringify({ email: STAFF_EMAIL, password: PASSWORD }) };
  const s = state();
  assert.equal(decision('https://fundhub.ai/api/auth/login', 'POST', request, s), 'BLOCK_WRITE');
  s.loginOpen = true;
  assert.equal(decision('https://fundhub.ai/api/auth/login', 'POST', request, s), 'LOGIN');
  s.loginAttempts++;
  assert.equal(decision('https://fundhub.ai/api/auth/login', 'POST', request, s), 'BLOCK_WRITE');
  s.loginAttempts = 0;
  assert.equal(decision('https://fundhub.ai/api/auth/login?demo=true', 'POST', request, s), 'BLOCK_WRITE');
  for (const body of ['null', '[]', 'bad json', JSON.stringify({ email: 'other@fundhub.ai', password: PASSWORD }), JSON.stringify({ email: STAFF_EMAIL, password: 'wrong' }), JSON.stringify({ email: STAFF_EMAIL, password: PASSWORD, demo: true })]) {
    assert.equal(decision('https://fundhub.ai/api/auth/login', 'POST', { body }, s), 'BLOCK_WRITE');
  }
});

function routeDouble({ status = 200, fetchError = false, fulfillError = false, abortError = false } = {}) {
  const calls = { fetch: [], fulfill: [], abort: [] };
  const response = Object.freeze({ status: () => status, unmodifiedBody: 'controlled body', unmodifiedHeaders: { 'set-cookie': 'controlled-cookie' } });
  return { calls, response, route: {
    async fetch(options) { calls.fetch.push(options); if (fetchError) throw Error('PRIVATE_PASSWORD_IN_TRANSPORT_ERROR'); return response; },
    async fulfill(options) { calls.fulfill.push(options); if (fulfillError) throw Error('PRIVATE_RESPONSE_BODY_IN_CALL_LOG'); },
    async abort(reason) { calls.abort.push(reason); if (abortError) throw Error('PRIVATE_REQUEST_URL'); },
  } };
}

test('forwarding fetches only original hop with redirects/retries off and forwards exact actual response', async () => {
  for (const status of [200, 201, 204, 400, 401, 403, 404, 500]) {
    const { route, calls, response } = routeDouble({ status });
    const s = { routeGuardFailures: 0, firstRouteFailure: null };
    assert.equal(await forwardCheckedRoute(route, s), true);
    assert.deepEqual(calls.fetch, [{ maxRedirects: 0, maxRetries: 0, timeout: 15000 }]);
    assert.equal(calls.fulfill.length, 1);
    assert.deepEqual(Object.keys(calls.fulfill[0]), ['response']);
    assert.equal(calls.fulfill[0].response, response); // Identity: no asset, cookie, header or body replacement.
    assert.deepEqual(calls.abort, []);
    assert.deepEqual(s, { routeGuardFailures: 0, firstRouteFailure: null });
  }
});

test('every 3xx is aborted without fulfillment or redirect traversal, including password-preserving307/308', async () => {
  for (const status of [300, 301, 302, 303, 304, 305, 306, 307, 308, 399]) {
    const { route, calls } = routeDouble({ status });
    const s = { routeGuardFailures: 0, firstRouteFailure: null };
    assert.equal(await forwardCheckedRoute(route, s), false);
    assert.deepEqual(calls.fetch, [{ maxRedirects: 0, maxRetries: 0, timeout: 15000 }]);
    assert.deepEqual(calls.fulfill, []);
    assert.deepEqual(calls.abort, ['blockedbyclient']);
    assert.deepEqual(s, { routeGuardFailures: 1, firstRouteFailure: 'REQUEST_REDIRECT_BLOCKED' });
  }
});

test('forwarding network/fulfill/abort failures stay red, sanitized and never fall back to continue', async () => {
  for (const [options, code, fulfills] of [
    [{ fetchError: true }, 'REQUEST_FETCH_FAILED', 0],
    [{ fulfillError: true }, 'REQUEST_FORWARD_FAILED', 1],
    [{ status: 307, abortError: true }, 'REQUEST_REDIRECT_BLOCKED', 0],
  ]) {
    const { route, calls } = routeDouble(options);
    const s = { routeGuardFailures: 0, firstRouteFailure: null };
    assert.equal(await forwardCheckedRoute(route, s), false);
    assert.equal(calls.fetch.length, 1);
    assert.equal(calls.fulfill.length, fulfills);
    assert.deepEqual(calls.abort, ['blockedbyclient']);
    assert.deepEqual(s, { routeGuardFailures: 1, firstRouteFailure: code });
    assert(!JSON.stringify(s).includes('PRIVATE'));
    await forwardCheckedRoute(routeDouble({ fetchError: true }).route, s);
    assert.equal(s.routeGuardFailures, 2);
    assert.equal(s.firstRouteFailure, code); // Preserve first cause; no swallowed guard failure.
  }
});

function sourceFixture() {
  const styles = ['/app/fundhub-brand.css', '/app/crm-sidebar.css', '/app/workspace-ui.css', '/app/bank-outreach.css', ...ASTRA];
  const html = '<body class="bank-outreach-page fh-astra fh-astra-staff fh-astra--bank-outreach">' + styles.map(path => `<link rel="stylesheet" href="${path}">`).join('') + '<script src="bank-outreach.js"></script><script src="shell.js"></script>';
  const source = new Map([[BANK, html], ['/login.html', '<script src="/pw-toggle.js"></script>'], ['/app/chat-widget.js', '/* shared */'], ['/pw-toggle.js', '/* password toggle */'], ['/app/bank-outreach.js', '/* bank */'], ['/app/shell.js', '/* shell */'], ...styles.map(path => [path, '/* checked CSS */'])]);
  source.set('/app/fundhub-astra.css', 'a{background:url(/assets/fonts/a.woff2)}');
  source.set('/assets/fonts/a.woff2', 'controlled-font-bytes');
  return source;
}

test('manifest hashes exact Bank/Astra/shared/dependent bytes and fails absent release alignment', () => {
  const source = sourceFixture();
  const read = path => { assert(source.has(path), 'missing controlled source'); return Buffer.from(source.get(path)); };
  const result = assetManifest(read);
  for (const path of [BANK, ...ASTRA, '/app/shell.js', '/app/bank-outreach.js', '/assets/fonts/a.woff2']) assert.equal(result.get(path), hash(read(path)));
  assert.notEqual(result.get('/app/bank-outreach.js'), hash('stale live bytes'));
  source.set(BANK, source.get(BANK).replace('fh-astra--bank-outreach', 'not-opted-in'));
  assert.throws(() => assetManifest(read), /ASTRA_SOURCE_MISSING/);
});

test('manifest rejects wrong foundation order, missing assets and unsafe same-origin references', () => {
  for (const mutate of [
    source => source.set(BANK, source.get(BANK).replace('href="/app/fundhub-astra.css"', 'href="/app/fundhub-astra-staff.css"')),
    source => source.set(BANK, source.get(BANK).replace('<link rel="stylesheet" href="/app/workspace-ui.css">', '')),
    source => source.set(BANK, source.get(BANK) + '<link rel="stylesheet" href="/app/bank-outreach.css">'),
    source => source.delete('/app/fundhub-astra-staff.css'),
    source => source.set(BANK, source.get(BANK) + '<script src="/app/%2e%2e/secret"></script>'),
  ]) {
    const source = sourceFixture(); mutate(source);
    assert.throws(() => assetManifest(path => { if (!source.has(path)) throw Error('missing'); return Buffer.from(source.get(path)); }));
  }
});

test('real queue/team contracts report counts only, do not fabricate empty data or accept a rep view', () => {
  const queue = { ...base, items: [], total: 0 };
  assert.deepEqual(queueCounts(queue), { total: 0, pageRows: 0, verifiedProductsWeek: 0, verifiedPartners: 0 });
  const team = { ...base, byRep: [{ name: 'PRIVATE STAFF', total: 0, due_now: 0, verified_partners: 0 }], byState: [] };
  assert.deepEqual(teamCounts(team), { repGroups: 1, stateGroups: 0, verifiedProductsWeek: 0 });
  assert(!JSON.stringify(teamCounts(team)).includes('PRIVATE'));
  for (const bad of [{ ...queue, canManage: false }, { ...queue, total: -1 }, { ...queue, items: Array(26).fill({}) }, { ...queue, summary: { ...summary, due_now: '0' } }]) assert.throws(() => queueCounts(bad));
  assert.throws(() => teamCounts({ ...team, byState: [{ total: 0, due_now: -1, verified_partners: 0 }] }));
});

test('anonymous proof requires the real auth denial, not an HTML firewall or unavailable database', () => {
  assert.equal(anonymousDenied(401, { ok: false, error: 'unauthorized' }), true);
  for (const [status, body] of [[403, '<html>Forbidden</html>'], [401, null], [401, { ok: false, error: 'auth_unavailable' }], [503, { ok: false, error: 'unauthorized' }], [200, { ok: true, items: [] }]]) {
    assert.equal(anonymousDenied(status, body), false);
  }
});

test('phone geometry requires body/input16, targets44, primary48 and no sideways overflow; desktop15 remains valid', () => {
  const g = { overflow: false, outsideViewport: 0, controlCount: 6, editableCount: 3, primaryCount: 1, bodyFont: 16, minimumEditableFont: 16, minimumTargetHeight: 44, minimumTargetWidth: 44, minimumPrimaryHeight: 48 };
  assert.equal(requireGeometry(g, true), g);
  assert.doesNotThrow(() => requireGeometry({ ...g, bodyFont: 15, minimumEditableFont: 15 }, false));
  for (const patch of [{ overflow: true }, { outsideViewport: 1 }, { editableCount: 0 }, { primaryCount: 0 }, { bodyFont: 15 }, { minimumEditableFont: 15 }, { minimumTargetHeight: 43 }, { minimumTargetWidth: 43 }, { minimumPrimaryHeight: 47 }]) assert.throws(() => requireGeometry({ ...g, ...patch }, true));
});

test('source keeps one normal click, fresh browser, no business submission, injection, secret repair or live-record artifacts', () => {
  const source = readFileSync(new URL('./verify-live.mjs', import.meta.url), 'utf8');
  assert.equal((source.match(/page\.locator\('#go'\)\.click\(/g) || []).length, 1);
  assert(source.includes("context.cookies()).length === 0"));
  assert(source.includes("serviceWorkers: 'block'"));
  assert(source.includes("context.route('**/*'"));
  assert(source.includes("context.routeWebSocket('**/*'"));
  assert(source.includes("savedBankerToLenderJourney: 'NOT_EXERCISED'"));
  assert(source.includes("repIsolation: 'NOT_EXERCISED_OWNER_SESSION'"));
  assert.doesNotMatch(source, /route\.continue\(/);
  assert(source.includes('state.routeGuardFailures === 0'));
  assert(source.includes('receipt.guard?.firstFailure ||'));
  assert(source.includes('await Promise.all([...forwarding])'));
  assert(source.includes('receipt.ok = false; throw new ProofError(state.firstRouteFailure)'));
  for (const pattern of [/\.screenshot\(/, /\.storageState\(/, /\.addCookies\(/, /\.setExtraHTTPHeaders\(/, /\.tracing\./, /recordHar\s*:/, /recordVideo\s*:/, /localStorage\.setItem/, /process\.env\.[A-Z_]+\s*=(?!=)/, /request\.(post|put|patch|delete)\(/, /\.submit\(/, /console\.(?:log|error)\([^)]*(?:password|error\.message|error\.stack)/]) assert.doesNotMatch(source, pattern);
  assert.equal((source.match(/\.fill\(/g) || []).length, 2);
});

test('manual workflow pins main/macOS/Node22/exact SHA and exposes existing secret only to the guarded proof', () => {
  const workflow = readFileSync(fileURLToPath(new URL('../../.github/workflows/bank-outreach-live-proof.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /runs-on: macos-latest/);
  assert.match(workflow, /node-version: '22'/);
  assert.match(workflow, /\^\[a-f0-9\]\{40\}\$/);
  assert.match(workflow, /ref: \$\{\{ steps\.release\.outputs\.sha \}\}/);
  assert.match(workflow, /merge-base','--is-ancestor',sha,'origin\/main'/);
  assert.equal((workflow.match(/secrets\.STAFF_E2E_PASSWORD/g) || []).length, 1);
  assert.doesNotMatch(workflow, /STAFF_INITIAL_PASSWORD|DATABASE_URL|DEMO_LOGINS_ENABLED|netlify|ship\.mjs/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/bank-outreach-live-proof\.json/);
  assert.deepEqual(workflow.split('\n').filter(line => line.includes('inputs.expected_release_sha')), ['          EXPECTED_RELEASE_SHA: ${{ inputs.expected_release_sha }}']);
});
