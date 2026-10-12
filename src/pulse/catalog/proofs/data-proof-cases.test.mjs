import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { DATA_PROOF_CASES, dataProofFor } from './data-proof-cases.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const MAP_ROOT = new URL(
  '../../../../ops/workflows/coverage-every-surface-2026-10-10/',
  import.meta.url,
);

async function loadRows(sourceFile) {
  return JSON.parse(await readFile(new URL(sourceFile, MAP_ROOT), 'utf8'));
}

test('every data proof names one exact source row and a real deep check', async () => {
  assert.equal(DATA_PROOF_CASES.length, 10);
  const rowsByFile = new Map();

  for (const entry of DATA_PROOF_CASES) {
    if (!rowsByFile.has(entry.sourceFile)) {
      rowsByFile.set(entry.sourceFile, await loadRows(entry.sourceFile));
    }
    const matches = rowsByFile.get(entry.sourceFile).filter((row) => (
      row.surface === entry.surface && row.control === entry.control
    ));
    assert.equal(matches.length, 1, `${entry.sourceFile}: ${entry.surface}: ${entry.control}`);
    assert.equal(entry.proof.depth, 'deep');
    assert.match(entry.proof.asserts, /fails? when|execute/i);
    assert.deepEqual(dataProofFor(entry.sourceFile, matches[0]), entry.proof);

    const tests = entry.proof.evidence.match(/\b[A-Za-z0-9_./-]+\.test\.mjs\b/g) || [];
    assert.ok(tests.length > 0, `${entry.surface}: proof has no test`);
    for (const file of tests) {
      assert.equal(existsSync(new URL(`../../../../${file}`, import.meta.url)), true, file);
    }
  }
});

test('every test named by a data proof runs and passes', () => {
  const files = [...new Set(DATA_PROOF_CASES.flatMap((entry) => (
    entry.proof.evidence.match(/\b[A-Za-z0-9_./-]+\.test\.mjs\b/g) || []
  )))].sort();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', ...files], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
});
