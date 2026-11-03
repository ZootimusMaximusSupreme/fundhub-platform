import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildSecurityScanReport } from './security-scan-report.mjs';

test('high dependency finding requires an issue and fails the scan', () => {
  const report = buildSecurityScanReport({ vulnerabilities: {
    example: { severity: 'high', isDirect: true },
  } }, { auditStatus: 1, runUrl: 'https://example.test/run' });
  assert.equal(report.complete, true);
  assert.equal(report.failed, true);
  assert.equal(report.issueNeeded, true);
  assert.equal(report.counts.high, 1);
  assert.match(report.markdown, /Scanned at: \d{4}-\d{2}-\d{2}T/);
  assert.match(report.markdown, /repository dependencies only/);
});

test('clean inventory closes an old issue and passes', () => {
  const report = buildSecurityScanReport({ vulnerabilities: {} });
  assert.equal(report.complete, true);
  assert.equal(report.failed, false);
  assert.equal(report.issueNeeded, false);
});

test('network or parser errors never masquerade as a clean inventory', () => {
  for (const audit of [{ error: { summary: 'registry unavailable' } }, {}, { vulnerabilities: {} }]) {
    const report = buildSecurityScanReport(audit, { auditStatus: 1 });
    assert.equal(report.complete, false);
    assert.equal(report.failed, true);
    assert.equal(report.issueNeeded, true);
  }
});

test('scheduled scan preserves owner and due date in an existing issue body', () => {
  const workflow = readFileSync(new URL('../.github/workflows/security-scan.yml', import.meta.url), 'utf8');
  assert.match(workflow, /gh issue comment "\$existing" --body-file/);
  assert.doesNotMatch(workflow, /gh issue edit/);
});
