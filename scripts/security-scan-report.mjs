import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];

export function buildSecurityScanReport(audit, { auditStatus = 0, runUrl = '' } = {}) {
  const valid = audit && typeof audit === 'object' && !Array.isArray(audit);
  const vulnerabilities = valid && audit.vulnerabilities && typeof audit.vulnerabilities === 'object'
    ? audit.vulnerabilities : null;
  const error = !valid || !vulnerabilities || audit.error
    ? String(audit?.error?.summary || audit?.error?.message || 'npm audit returned no usable vulnerability inventory')
    : null;
  const packages = error ? [] : Object.entries(vulnerabilities).map(([name, finding]) => ({
    name,
    severity: SEVERITIES.includes(finding?.severity) ? finding.severity : 'unknown',
    direct: Boolean(finding?.isDirect),
  }));
  packages.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, packages.filter((entry) => entry.severity === severity).length]));
  const failed = Boolean(error || counts.critical || counts.high || packages.some((entry) => entry.severity === 'unknown'));
  const issueNeeded = Boolean(error || packages.length);
  const lines = [
    '# Fundhub dependency scan',
    '',
    `Run: ${runUrl || 'local'}`,
    `Result: ${error ? 'scan incomplete' : failed ? 'high or critical findings' : packages.length ? 'findings to review' : 'no findings'}`,
    `Package findings: critical ${counts.critical}, high ${counts.high}, moderate ${counts.moderate}, low ${counts.low}, info ${counts.info}.`,
    `npm audit exit status: ${auditStatus}.`,
  ];
  if (error) lines.push(`Scan error: ${error.slice(0, 500)}`);
  if (packages.length) {
    lines.push('', '| Package | Severity | Direct |', '| --- | --- | --- |');
    for (const entry of packages.slice(0, 50)) {
      lines.push(`| ${entry.name.replaceAll('|', '\\|')} | ${entry.severity} | ${entry.direct ? 'yes' : 'no'} |`);
    }
    if (packages.length > 50) lines.push(`...and ${packages.length - 50} more packages in the run artifact.`);
  }
  lines.push('', 'Owner: Fundhub engineering. Review findings, set repair dates, and rerun after fixes. This scan covers repository dependencies only; it does not scan laptops or every production asset.');
  return {
    scannedAt: new Date().toISOString(),
    source: 'npm audit --omit=dev',
    complete: !error,
    failed,
    issueNeeded,
    counts,
    packages,
    error,
    runUrl,
    markdown: lines.join('\n') + '\n',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [inputPath, jsonPath, markdownPath, statusValue = '0'] = process.argv.slice(2);
  if (!inputPath || !jsonPath || !markdownPath) throw new Error('Usage: node security-scan-report.mjs INPUT OUTPUT_JSON OUTPUT_MD [AUDIT_EXIT_STATUS]');
  let audit;
  try { audit = JSON.parse(readFileSync(inputPath, 'utf8')); }
  catch { audit = { error: { summary: 'npm audit output was not valid JSON' } }; }
  const report = buildSecurityScanReport(audit, {
    auditStatus: Number(statusValue),
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
  });
  writeFileSync(jsonPath, JSON.stringify({ ...report, markdown: undefined }, null, 2) + '\n');
  writeFileSync(markdownPath, report.markdown);
  process.stdout.write(`Dependency scan: ${report.complete ? 'complete' : 'incomplete'}; critical ${report.counts.critical}, high ${report.counts.high}, moderate ${report.counts.moderate}.\n`);
}
