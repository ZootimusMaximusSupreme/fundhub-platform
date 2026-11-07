import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SEVERITIES = ['critical', 'high', 'moderate', 'low', 'info'];
export const SECURITY_OWNER = 'Chris Stanbridge (security owner)';
const inventory = (value) => value && typeof value === 'object' && !Array.isArray(value);
const instant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const dueDate = (firstSeenAt, severity) => new Date(Date.parse(firstSeenAt) + (severity === 'critical' ? 7 : 30) * 86_400_000).toISOString();

// Resolve transitive package names to the underlying advisory. A package name
// alone is not a finding ID: a new advisory must get its own history and date.
export function auditFindings(vulnerabilities) {
  const roots = (name, seen = new Set()) => {
    if (seen.has(name)) return [];
    const next = new Set([...seen, name]);
    return (vulnerabilities[name]?.via || []).flatMap((via) =>
      typeof via === 'string' ? roots(via, next) : [via]);
  };
  const findings = new Map();
  for (const [name, pkg] of Object.entries(vulnerabilities)) {
    const advisories = roots(name);
    if (!advisories.length) throw new Error(`No advisory identity available for ${name}`);
    for (const advisory of advisories) {
      const advisoryId = advisory?.url?.match(/\/advisories\/(GHSA-[a-z0-9-]+)(?:$|[?#])/i)?.[1]
        || (Number.isSafeInteger(advisory?.source) ? `npm:${advisory.source}` : null);
      if (!advisoryId || typeof advisory.range !== 'string' || !advisory.range ||
          typeof pkg.range !== 'string' || !pkg.range || !SEVERITIES.includes(advisory.severity)) {
        throw new Error(`Incomplete advisory identity, range or severity for ${name}`);
      }
      const id = `${name}|${advisoryId}`;
      findings.set(id, { id, package: name, advisoryId, advisoryUrl: advisory.url || null,
        advisoryRange: advisory.range, packageRange: pkg.range,
        severity: advisory.severity, direct: Boolean(pkg.isDirect) });
    }
  }
  return [...findings.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function validateLedger(ledger) {
  if (ledger?.version !== 1 || !instant(ledger.updatedAt) || !Array.isArray(ledger.findings)) {
    throw new Error('Finding history is not a usable version 1 ledger');
  }
  const ids = new Set();
  for (const finding of ledger.findings) {
    if (!finding.id || finding.id !== `${finding.package}|${finding.advisoryId}` || ids.has(finding.id) ||
        !instant(finding.firstObservedAt) || !instant(finding.lastObservedAt) || !instant(finding.dueAt) ||
        !finding.owner || !finding.firstObservedRun || !finding.advisoryRange || !finding.packageRange ||
        !SEVERITIES.includes(finding.severity) || !['open', 'resolved'].includes(finding.status)) {
      throw new Error('Finding history contains an invalid or duplicate record');
    }
    if (Date.parse(finding.firstObservedAt) > Date.parse(finding.lastObservedAt) ||
        Date.parse(finding.lastObservedAt) > Date.parse(ledger.updatedAt)) {
      throw new Error('Finding history contains inconsistent observation dates');
    }
    ids.add(finding.id);
  }
  return ledger;
}

export function updateFindingLedger(ledger, findings, { scannedAt, runUrl, complete }) {
  validateLedger(ledger);
  const records = new Map(ledger.findings.map((entry) => [entry.id, structuredClone(entry)]));
  const present = new Set();
  for (const finding of findings) {
    present.add(finding.id);
    const old = records.get(finding.id);
    const ranges = [...(old?.observedRanges || [])];
    if (!ranges.some((entry) => entry.advisory === finding.advisoryRange && entry.package === finding.packageRange)) {
      ranges.push({ advisory: finding.advisoryRange, package: finding.packageRange });
    }
    const firstObservedAt = old?.firstObservedAt || scannedAt;
    const target = dueDate(firstObservedAt, finding.severity);
    records.set(finding.id, { ...finding, owner: old?.owner || SECURITY_OWNER,
      firstObservedAt, firstObservedRun: old?.firstObservedRun || runUrl || 'local',
      earlierHistoryUnknown: old?.earlierHistoryUnknown ?? true,
      // A severity increase can shorten a deadline; daily scans never extend it.
      dueAt: old?.dueAt && Date.parse(old.dueAt) < Date.parse(target) ? old.dueAt : target,
      lastObservedAt: scannedAt, lastObservedRun: runUrl || 'local', status: 'open',
      resolvedAt: null, observedRanges: ranges });
  }
  if (complete) {
    for (const entry of records.values()) {
      if (!present.has(entry.id) && entry.status === 'open') {
        entry.status = 'resolved';
        entry.resolvedAt = scannedAt;
        entry.resolvedRun = runUrl || 'local';
      }
    }
  }
  return { ...ledger, updatedAt: scannedAt, findings: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}

// A missing/corrupt archive must never silently reset the first-seen dates.
// The checked-in seed is from an inspected real receipt, not a fresh baseline.
export function loadFindingHistory(historyPath, seed) {
  let ledger = validateLedger(structuredClone(seed));
  const observations = [];
  let foundLedger = false;
  let legacyReceipts = 0;
  for (const dir of readdirSync(historyPath, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const root = path.join(historyPath, dir.name);
    const ledgerPath = path.join(root, 'security-findings.json');
    const reportPath = path.join(root, 'security-scan.json');
    const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : null;
    if (existsSync(ledgerPath) && report?.tracking?.complete === true) {
      const prior = validateLedger(JSON.parse(readFileSync(ledgerPath, 'utf8')));
      for (const known of seed.findings) {
        const recorded = prior.findings.find((entry) => entry.id === known.id);
        if (!recorded || Date.parse(recorded.firstObservedAt) > Date.parse(known.firstObservedAt) ||
            Date.parse(recorded.dueAt) > Date.parse(known.dueAt)) {
          throw new Error('Finding ledger lost or reset known first-observed evidence');
        }
      }
      if (!foundLedger || Date.parse(prior.updatedAt) > Date.parse(ledger.updatedAt)) ledger = prior;
      foundLedger = true;
    } else if (report?.tracking?.complete === true) {
      throw new Error('A prior tracked scan is missing its finding ledger');
    }
    if (!report || !instant(report.scannedAt)) throw new Error('A prior scan receipt is missing or invalid');
    if (!report.tracking) legacyReceipts += 1;
    const auditPath = path.join(root, 'security-audit-raw.json');
    if (!existsSync(auditPath)) throw new Error('A prior scan is missing its raw audit receipt');
    observations.push({ report, audit: JSON.parse(readFileSync(auditPath, 'utf8')) });
  }
  if (!observations.length) throw new Error('No prior scan artifacts found; restore known history before initializing tracking');
  if (!foundLedger && !legacyReceipts) throw new Error('No trusted finding history remains; failed tracking receipts cannot initialize a new baseline');
  observations.sort((a, b) => Date.parse(a.report.scannedAt) - Date.parse(b.report.scannedAt));
  for (const { report, audit } of observations) {
    if (Date.parse(report.scannedAt) <= Date.parse(ledger.updatedAt)) continue;
    if (!report.complete) continue; // An incomplete inventory cannot close findings.
    if (!inventory(audit.vulnerabilities) || audit.error) throw new Error('Prior completed scan lacks a usable audit inventory');
    ledger = updateFindingLedger(ledger, auditFindings(audit.vulnerabilities), {
      scannedAt: report.scannedAt, runUrl: report.runUrl, complete: true });
  }
  return { ledger, restoredFrom: foundLedger ? 'artifact ledger' : 'inspected seed and legacy scan receipts' };
}

export function buildSecurityScanReport(audit, { auditStatus = 0, runUrl = '', scannedAt = new Date().toISOString(),
  ledger = null, trackingError = null, restoredFrom = 'not restored' } = {}) {
  if (!instant(scannedAt)) throw new Error('A valid scan time is required');
  const valid = inventory(audit);
  const vulnerabilities = valid && inventory(audit.vulnerabilities)
    ? audit.vulnerabilities : null;
  const error = !valid || !vulnerabilities || audit.error || ![0, 1].includes(auditStatus) || (auditStatus !== 0 && Object.keys(vulnerabilities).length === 0)
    ? String(audit?.error?.summary || audit?.error?.message || 'npm audit returned no usable vulnerability inventory')
    : null;
  const packages = error ? [] : Object.entries(vulnerabilities).map(([name, finding]) => ({
    name,
    severity: SEVERITIES.includes(finding?.severity) ? finding.severity : 'unknown',
    direct: Boolean(finding?.isDirect),
  }));
  packages.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.name.localeCompare(b.name));
  const counts = Object.fromEntries(SEVERITIES.map((severity) => [severity, packages.filter((entry) => entry.severity === severity).length]));
  let findingLedger = ledger;
  try {
    if (!ledger) throw new Error('Finding history was not restored');
    findingLedger = updateFindingLedger(ledger, error ? [] : auditFindings(vulnerabilities), { scannedAt, runUrl, complete: !error });
  } catch (err) { trackingError = trackingError || err.message; }
  const openFindings = findingLedger?.findings.filter((entry) => entry.status === 'open') || [];
  const overdue = openFindings.filter((entry) => Date.parse(entry.dueAt) < Date.parse(scannedAt));
  const severityFailed = Boolean(counts.critical || counts.high || packages.some((entry) => entry.severity === 'unknown'));
  const failed = Boolean(error || severityFailed || trackingError || overdue.length);
  const issueNeeded = Boolean(error || packages.length);
  const lines = [
    '# Fundhub dependency scan',
    '',
    `Scanned at: ${scannedAt}`,
    `Run: ${runUrl || 'local'}`,
    `Scan result: ${error ? 'incomplete' : packages.length ? 'vulnerabilities found' : 'no findings'}`,
    `Tracking: ${trackingError ? `INCOMPLETE — ${trackingError}` : `complete; restored from ${restoredFrom}`}.`,
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
  if (openFindings.length) {
    lines.push('', '| Finding ID | Advisory range | Package range | Owner | First observed | Due |', '| --- | --- | --- | --- | --- | --- |');
    for (const entry of openFindings) {
      const cell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
      lines.push(`| ${cell(entry.id)} | ${cell(entry.advisoryRange)} | ${cell(entry.packageRange)} | ${cell(entry.owner)} | ${entry.firstObservedAt} | ${entry.dueAt} |`);
    }
  }
  lines.push('', `Security owner: ${SECURITY_OWNER}. Deadlines run from first observed evidence, not each daily scan (critical: 7 days; other findings: 30 days).`,
    'First observed is the earliest retained evidence; earlier history may be unknown. Resolved findings remain in the ledger. A clean scan does not prove tracking succeeded.',
    'This scan covers repository dependencies only; it does not scan laptops or every production asset.');
  return {
    scannedAt,
    source: 'npm audit --omit=dev',
    complete: !error,
    failed,
    issueNeeded,
    counts,
    packages,
    error,
    runUrl,
    severityFailed,
    tracking: { complete: !trackingError, error: trackingError, restoredFrom, overdue: overdue.length },
    ledger: findingLedger,
    markdown: lines.join('\n') + '\n',
  };
}

export function securityScanGate(report, outcomes = []) {
  return Boolean(report?.complete === true && report.tracking?.complete === true &&
    report.failed === false && report.severityFailed === false &&
    report.counts?.critical === 0 && report.counts?.high === 0 &&
    outcomes.length === 3 && outcomes.every((outcome) => outcome === 'success')) ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--gate') {
    let report;
    try { report = JSON.parse(readFileSync(process.argv[3], 'utf8')); } catch { /* Missing proof stays red. */ }
    process.exitCode = securityScanGate(report, process.argv.slice(4));
    process.stdout.write(`Dependency gate: scan ${report?.complete ? 'complete' : 'INCOMPLETE'}; severity ${report?.severityFailed ? 'RED' : 'see receipt'}; tracking ${report?.tracking?.complete ? 'complete' : 'INCOMPLETE'}; pipeline ${process.argv.slice(4).join('/')}.\n`);
  } else {
  const [inputPath, jsonPath, markdownPath, statusValue = '0', ledgerPath, historyPath] = process.argv.slice(2);
  if (!inputPath || !jsonPath || !markdownPath || !ledgerPath || !historyPath) throw new Error('Usage: node security-scan-report.mjs INPUT OUTPUT_JSON OUTPUT_MD AUDIT_EXIT_STATUS OUTPUT_LEDGER HISTORY_DIR');
  let audit;
  try { audit = JSON.parse(readFileSync(inputPath, 'utf8')); }
  catch { audit = { error: { summary: 'npm audit output was not valid JSON' } }; }
  let restored = { ledger: null, restoredFrom: 'not restored' };
  let trackingError = process.env.TRACKING_RESTORE_OUTCOME === 'success' ? null : 'Finding history download did not succeed';
  try {
    const seed = JSON.parse(readFileSync(new URL('./security-scan-findings.json', import.meta.url), 'utf8'));
    restored = { ledger: seed, restoredFrom: 'checked-in evidence only' };
    restored = loadFindingHistory(historyPath, seed);
  } catch (err) { trackingError = trackingError || err.message; }
  const report = buildSecurityScanReport(audit, {
    auditStatus: Number(statusValue),
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '',
    ...restored, trackingError,
  });
  writeFileSync(jsonPath, JSON.stringify({ ...report, markdown: undefined, ledger: undefined }, null, 2) + '\n');
  writeFileSync(markdownPath, report.markdown);
  // Never publish a replacement ledger after a restore failure. Otherwise the
  // next run could trust that partial baseline and silently reset known dates.
  if (report.ledger && report.tracking.complete) writeFileSync(ledgerPath, JSON.stringify(report.ledger, null, 2) + '\n');
  process.stdout.write(`Dependency scan: ${report.complete ? 'complete' : 'incomplete'}; critical ${report.counts.critical}, high ${report.counts.high}, moderate ${report.counts.moderate}.\n`);
  }
}
