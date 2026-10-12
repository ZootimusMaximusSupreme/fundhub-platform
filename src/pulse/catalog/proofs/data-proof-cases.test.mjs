import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { DATA_PROOF_CASES, dataProofFor } from './data-proof-cases.mjs';

const ROOT = new URL('../../../../', import.meta.url);
const MAP_ROOT = new URL(
  '../../../../ops/workflows/coverage-every-surface-2026-10-10/',
  import.meta.url,
);
const SOURCE_FILES = ['pipelines.json', 'tables.json', 'banks-links.json'];
const SENSITIVE_IMPACTS = new Set(['money', 'customerData', 'customerMessage']);

async function loadRows(sourceFile) {
  return JSON.parse(await readFile(new URL(sourceFile, MAP_ROOT), 'utf8'));
}

async function provedRows() {
  const out = [];
  for (const sourceFile of SOURCE_FILES) {
    const rows = await loadRows(sourceFile);
    for (const row of rows) {
      const proof = dataProofFor(sourceFile, row);
      if (proof) out.push({ sourceFile, row, proof });
    }
  }
  return out;
}

test('the 28 hand-written data cases still name one exact source row', async () => {
  assert.equal(DATA_PROOF_CASES.length, 28);
  const rowsByFile = new Map();

  for (const entry of DATA_PROOF_CASES) {
    if (!rowsByFile.has(entry.sourceFile)) {
      rowsByFile.set(entry.sourceFile, await loadRows(entry.sourceFile));
    }
    const matches = rowsByFile.get(entry.sourceFile).filter((row) => (
      row.surface === entry.surface && row.control === entry.control
    ));
    assert.equal(matches.length, 1, `${entry.sourceFile}: ${entry.surface}: ${entry.control}`);
    assert.deepEqual(dataProofFor(entry.sourceFile, matches[0]), entry.proof);
  }
});

test('every data proof names a real focused check at the required depth', async () => {
  const proved = await provedRows();
  assert.equal(proved.length, 307);

  for (const { sourceFile, row, proof } of proved) {
    assert.equal(['e2e', 'deep'].includes(proof.depth), true, `${sourceFile}: ${row.surface}`);
    assert.equal(proof.asserts.length > 0, true, `${sourceFile}: ${row.surface}`);
    assert.match(proof.evidence, /\.test\.mjs\b/, `${sourceFile}: ${row.surface}`);

    if (SENSITIVE_IMPACTS.has(row.impact)) {
      assert.equal(proof.depth, 'deep', `${sourceFile}: ${row.surface}`);
      assert.match(
        proof.evidence,
        /src\/pulse\/(?:coverage\/gap-[A-Za-z0-9_./-]+\.mjs\b|beats\/beat-[A-Za-z0-9_./-]+\.mjs\b|catalog\/proofs\/data-direct-results\.test\.mjs\b)/,
        `${sourceFile}: ${row.surface}`,
      );
    }

    const tests = proof.evidence.match(/\b[A-Za-z0-9_./-]+\.test\.mjs\b/g) || [];
    assert.ok(tests.length > 0, `${sourceFile}: ${row.surface}: proof has no test`);
    for (const file of tests) {
      assert.equal(existsSync(new URL(`../../../../${file}`, import.meta.url)), true, file);
    }
  }
});

test('every test named by a data proof runs once and passes', async () => {
  const proved = await provedRows();
  const files = [...new Set(proved.flatMap(({ proof }) => (
    proof.evidence.match(/\b[A-Za-z0-9_./-]+\.test\.mjs\b/g) || []
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
