import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSecurityScanReport, auditFindings, updateFindingLedger, loadFindingHistory, securityScanGate, SECURITY_OWNER } from './security-scan-report.mjs';

const FIRST = '2026-11-03T11:13:24.978Z';
const NEXT = '2026-11-06T17:33:38.388Z';
const RUN = 'https://example.test/run';
const emptyLedger = () => ({ version: 1, updatedAt: FIRST, findings: [] });
const audit = (id = 'GHSA-test-1111-2222', range = '<4.6.6') => ({ vulnerabilities: {
  example: { severity: 'high', isDirect: true, range, via: [
    { source: 123, url: `https://github.com/advisories/${id}`, range, severity: 'high' },
  ] },
} });
const initialLedger = () => updateFindingLedger(emptyLedger(), auditFindings(audit().vulnerabilities),
  { scannedAt: FIRST, runUrl: RUN, complete: true });
const reportOptions = () => ({ ledger: emptyLedger(), scannedAt: NEXT, restoredFrom: 'test receipt' });

test('a completed high-vulnerability scan stays red and records an accountable finding', () => {
  const report = buildSecurityScanReport(audit(), { ...reportOptions(), auditStatus: 1, runUrl: RUN });
  assert.equal(report.complete, true);
  assert.equal(report.failed, true);
  assert.equal(report.issueNeeded, true);
  assert.equal(report.counts.high, 1);
  assert.match(report.markdown, /Scanned at: \d{4}-\d{2}-\d{2}T/);
  assert.match(report.markdown, /repository dependencies only/);
  assert.equal(report.tracking.complete, true);
  assert.equal(report.ledger.findings[0].owner, SECURITY_OWNER);
  assert.equal(report.ledger.findings[0].dueAt, '2026-12-06T17:33:38.388Z');
  assert.match(report.ledger.findings[0].id, /GHSA-test-1111-2222/);
});

test('a clean complete inventory resolves findings without discarding their history', () => {
  const report = buildSecurityScanReport({ vulnerabilities: {} }, { ...reportOptions(), ledger: initialLedger() });
  assert.equal(report.complete, true);
  assert.equal(report.failed, false);
  assert.equal(report.issueNeeded, false);
  assert.equal(report.ledger.findings[0].status, 'resolved');
  assert.equal(report.ledger.findings[0].firstObservedAt, FIRST);
  assert.equal(report.ledger.findings[0].resolvedAt, NEXT);
});

test('network or parser errors never masquerade as a clean inventory', () => {
  for (const input of [{ error: { summary: 'registry unavailable' } }, {}, { vulnerabilities: {} }]) {
    const report = buildSecurityScanReport(input, { ...reportOptions(), ledger: initialLedger(), auditStatus: 1 });
    assert.equal(report.complete, false);
    assert.equal(report.failed, true);
    assert.equal(report.issueNeeded, true);
    assert.equal(report.ledger.findings[0].status, 'open', 'a failed scan cannot resolve a known finding');
  }
  assert.equal(buildSecurityScanReport(audit(), { ...reportOptions(), auditStatus: 2 }).complete, false);
});

test('new advisories get separate records while range changes and reopenings preserve first-seen and due dates', () => {
  const original = initialLedger();
  original.findings[0].owner = 'Named security delegate';
  const changed = updateFindingLedger(original, auditFindings(audit(undefined, '<4.6.7').vulnerabilities),
    { scannedAt: NEXT, runUrl: RUN, complete: true });
  assert.equal(changed.findings[0].firstObservedAt, FIRST);
  assert.equal(changed.findings[0].dueAt, original.findings[0].dueAt);
  assert.equal(changed.findings[0].owner, 'Named security delegate');
  assert.deepEqual(changed.findings[0].observedRanges.map((entry) => entry.advisory), ['<4.6.6', '<4.6.7']);
  const newAdvisory = updateFindingLedger(changed, auditFindings(audit('GHSA-new1-3333-4444').vulnerabilities),
    { scannedAt: NEXT, runUrl: RUN, complete: true });
  assert.equal(newAdvisory.findings.length, 2);
  assert.equal(newAdvisory.findings.find((entry) => entry.advisoryId.includes('test')).status, 'resolved');
  assert.equal(newAdvisory.findings.find((entry) => entry.advisoryId.includes('new1')).firstObservedAt, NEXT);
  const reopened = updateFindingLedger(newAdvisory, auditFindings(audit().vulnerabilities),
    { scannedAt: NEXT, runUrl: RUN, complete: true });
  assert.equal(reopened.findings.find((entry) => entry.advisoryId.includes('test')).dueAt, original.findings[0].dueAt);
});

test('a transitive finding records its root advisory and both affected ranges', () => {
  const input = audit();
  input.vulnerabilities.parent = { severity: 'high', isDirect: true, range: '>=3', via: ['example'] };
  const findings = auditFindings(input.vulnerabilities);
  const parent = findings.find((entry) => entry.package === 'parent');
  assert.equal(parent.advisoryId, 'GHSA-test-1111-2222');
  assert.equal(parent.advisoryRange, '<4.6.6');
  assert.equal(parent.packageRange, '>=3');
  assert.throws(() => auditFindings({ broken: { severity: 'high', range: '*', via: ['absent'] } }), /No advisory identity/);
});

test('history restoration preserves known dates and rejects missing or corrupt receipts', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'security-history-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => loadFindingHistory(root, emptyLedger()), /No prior scan artifacts/);
  const prior = path.join(root, '100');
  mkdirSync(prior);
  writeFileSync(path.join(prior, 'security-scan.json'), JSON.stringify({ scannedAt: NEXT, complete: true, runUrl: RUN, tracking: { complete: true } }));
  writeFileSync(path.join(prior, 'security-audit-raw.json'), JSON.stringify(audit()));
  writeFileSync(path.join(prior, 'security-findings.json'), JSON.stringify(initialLedger()));
  const restored = loadFindingHistory(root, emptyLedger());
  assert.equal(restored.ledger.findings[0].firstObservedAt, FIRST);
  assert.equal(restored.ledger.findings[0].dueAt, initialLedger().findings[0].dueAt);
  const failed = path.join(root, '200');
  mkdirSync(failed);
  writeFileSync(path.join(failed, 'security-scan.json'), JSON.stringify({ scannedAt: NEXT, complete: true, runUrl: RUN, tracking: { complete: false } }));
  writeFileSync(path.join(failed, 'security-audit-raw.json'), JSON.stringify(audit()));
  writeFileSync(path.join(failed, 'security-findings.json'), JSON.stringify({ ...emptyLedger(), updatedAt: NEXT }));
  assert.equal(loadFindingHistory(root, emptyLedger()).ledger.findings[0].firstObservedAt, FIRST,
    'a failed restore must not poison the next run with a new baseline');
  const reset = initialLedger();
  reset.updatedAt = NEXT;
  reset.findings[0].firstObservedAt = NEXT;
  reset.findings[0].lastObservedAt = NEXT;
  writeFileSync(path.join(prior, 'security-findings.json'), JSON.stringify(reset));
  assert.throws(() => loadFindingHistory(root, initialLedger()), /lost or reset known first-observed/);
  writeFileSync(path.join(prior, 'security-findings.json'), '{not valid JSON');
  assert.throws(() => loadFindingHistory(root, emptyLedger()), /JSON/);
  rmSync(path.join(prior, 'security-findings.json'));
  writeFileSync(path.join(prior, 'security-scan.json'), JSON.stringify({ scannedAt: NEXT, tracking: { complete: true } }));
  assert.throws(() => loadFindingHistory(root, emptyLedger()), /missing its finding ledger/);
});

test('the actual CLI retains audit and ledger artifacts and separately rejects tracking or upload failure', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'security-cli-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const history = path.join(root, 'history');
  const prior = path.join(history, '100');
  mkdirSync(prior, { recursive: true });
  writeFileSync(path.join(prior, 'security-scan.json'), JSON.stringify({ scannedAt: FIRST, complete: true, runUrl: RUN, tracking: { complete: true } }));
  writeFileSync(path.join(prior, 'security-audit-raw.json'), JSON.stringify({ vulnerabilities: {} }));
  writeFileSync(path.join(prior, 'security-findings.json'), readFileSync(new URL('./security-scan-findings.json', import.meta.url), 'utf8'));
  const raw = path.join(root, 'raw.json');
  const json = path.join(root, 'report.json');
  const markdown = path.join(root, 'report.txt');
  const ledger = path.join(root, 'ledger.json');
  writeFileSync(raw, JSON.stringify({ vulnerabilities: {} }));
  const cli = fileURLToPath(new URL('./security-scan-report.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [cli, raw, json, markdown, '0', ledger, history], {
    encoding: 'utf8', env: { ...process.env, TRACKING_RESTORE_OUTCOME: 'success' },
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.tracking.complete, true);
  assert.equal(JSON.parse(readFileSync(ledger, 'utf8')).version, 1);
  assert.equal(readFileSync(raw, 'utf8'), '{"vulnerabilities":{}}', 'raw evidence is preserved');
  assert.equal(securityScanGate(report, ['success', 'success', 'success']), 0);
  for (const outcomes of [['failure', 'success', 'success'], ['success', 'failure', 'success'], ['success', 'success', 'failure']]) {
    assert.equal(spawnSync(process.execPath, [cli, '--gate', json, ...outcomes]).status, 1);
  }
  assert.equal(securityScanGate({ ...report, failed: true }, ['success', 'success', 'success']), 1);
  assert.equal(securityScanGate({ complete: true, tracking: { complete: true } }, ['success', 'success', 'success']), 1,
    'missing severity proof must not be interpreted as no vulnerabilities');
  assert.equal(securityScanGate({ ...report, counts: { critical: 0, high: 1 } }, ['success', 'success', 'success']), 1,
    'a contradictory finding receipt must stay red');
  assert.equal(spawnSync(process.execPath, [cli, '--gate', path.join(root, 'missing.json'), 'success', 'success', 'success']).status, 1);
});

test('a clean inventory cannot hide missing tracking proof', () => {
  const report = buildSecurityScanReport({ vulnerabilities: {} }, { ...reportOptions(), trackingError: 'prior archive unavailable' });
  assert.equal(report.complete, true);
  assert.equal(report.tracking.complete, false);
  assert.equal(report.failed, true);
  assert.equal(securityScanGate(report, ['success', 'success', 'success']), 1);
});

test('scheduled scan works without GitHub Issues and always evaluates the final gate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/security-scan.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /gh issue|issues: write/);
  assert.match(workflow, /Restore finding history[\s\S]*gh run download/);
  assert.match(workflow, /name: Keep findings, incomplete scans, and tracking failures red\n\s+if: always\(\)/);
  assert.match(workflow, /--gate.*steps\.history\.outcome.*steps\.report\.outcome.*steps\.receipts\.outcome/);
  assert.match(workflow, /cancel-in-progress: false/);
});
