// Compact the real Playwright receipts without copying base64 screenshots.
// Usage: node <this-file> /absolute/path/to/receipt.json [...]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const output = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(output, '../../../..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const range = values => values.length ? [Math.min(...values), Math.max(...values)] : null;
const files = process.argv.slice(2);
if (!files.length || files.some(file => !path.isAbsolute(file))) throw new Error('Pass absolute Playwright JSON receipt paths');
const receipts = files.map(file => {
  const bytes = fs.readFileSync(file), report = JSON.parse(bytes), cases = [], groups = new Map();
  function walk(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs || []) for (const test of spec.tests) {
        for (const result of test.results) {
          cases.push({
            project: test.projectName, title: spec.title, status: result.status,
            errors: (result.errors || []).map(error => String(error.message).replace(/\u001b\[[0-9;]*m/g, '').slice(0, 600)),
          });
          for (const attachment of result.attachments || []) {
            if (!attachment.name.endsWith('-measurements') || !attachment.body) continue;
            const data = JSON.parse(Buffer.from(attachment.body, 'base64').toString('utf8'));
            const key = test.projectName + ':' + data.viewport.width + 'x' + data.viewport.height;
            if (!groups.has(key)) groups.set(key, { measurements: [], body: [], controls: [], inputs: [], selects: [], primary: [], overflows: [], violations: [] });
            const group = groups.get(key);
            group.measurements.push(attachment.name); group.body.push(data.bodyFont);
            group.controls.push(...data.controls);
            group.inputs.push(...data.controls.filter(control => /^(INPUT|SELECT|TEXTAREA)$/.test(control.tag)));
            group.selects.push(...data.controls.filter(control => control.tag === 'SELECT'));
            group.primary.push(...data.primary);
            if (data.pageWidth > data.viewport.width + 1) group.overflows.push({ state: attachment.name, pageWidth: data.pageWidth });
            group.violations.push(...data.smallTargets, ...data.smallInputs, ...data.smallText);
          }
        }
      }
      walk(suite.suites || []);
    }
  }
  walk(report.suites);
  return {
    raw: { path: file, bytes: bytes.length, sha256: sha256(bytes) }, stats: report.stats,
    failures: cases.filter(test => test.status !== 'passed'),
    profiles: Object.fromEntries([...groups].map(([key, group]) => [key, {
      measuredStates: [...new Set(group.measurements)], observations: group.measurements.length,
      bodyFontRange: range(group.body), inputFontRange: range(group.inputs.map(c => c.font)),
      targetHeightRange: range(group.controls.map(c => c.height)), selectHeightRange: range(group.selects.map(c => c.height)),
      primaryHeightRange: range(group.primary.map(c => c.height)), overflows: group.overflows, violations: group.violations,
    }])),
  };
});
const sourceFiles = [
  'public/app/bank-outreach.html', 'public/app/bank-outreach.css', 'public/app/bank-outreach.js',
  'public/app/fundhub-astra.css', 'public/app/fundhub-astra-staff.css',
  'public/app/shell.js', 'public/app/crm-sidebar.css', 'public/app/workspace-ui.css',
  'public/app/fundhub-brand.css', 'public/app/fundhub-font.css', 'public/app/fundhub-font.js',
  'e2e/bank-outreach.spec.mjs', 'e2e/bank-outreach-fixture.mjs', 'e2e/bank-outreach-webkit.proof.mjs',
  'playwright.bank-outreach-webkit.config.mjs',
];
const compact = {
  scope: 'Local fictional API fixtures. Real Chromium/WebKit rendering and controls; no production, authentication-isolation, physical-phone or foldable-device claim.',
  generatedAt: new Date().toISOString(),
  runtime: {
    node: process.version, platform: process.platform, architecture: process.arch, osRelease: os.release(),
    playwright: createRequire(import.meta.url)('@playwright/test/package.json').version,
  },
  generatedFromHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sourceScope: 'Hashes pin the final passed source, not earlier failed attempts. The alignment record identifies the tested integration base and any later non-runtime-only merge.',
  sourceSha256: Object.fromEntries(sourceFiles.map(file => [file, sha256(fs.readFileSync(path.join(repo, file)))])),
  receipts,
};
fs.writeFileSync(path.join(output, 'astra-browser-proof.json'), JSON.stringify(compact, null, 2) + '\n');
console.log(JSON.stringify(receipts.map(receipt => ({ raw: receipt.raw.path, ...receipt.stats })), null, 2));
