import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { makeRecipe, supports } from './data-recipes.mjs';
import { DATA_PROOF_CASES } from './proofs/data-proof-cases.mjs';

const MAP_ROOT = new URL(
  '../../../ops/workflows/coverage-every-surface-2026-10-10/',
  import.meta.url,
);
const SOURCE_FILES = ['pipelines.json', 'tables.json', 'banks-links.json'];
const MODES = new Set(['read-only', 'test', 'receipt', 'manual-red']);
const SENSITIVE_IMPACTS = new Set(['money', 'customerData', 'customerMessage']);

async function loadRows(sourceFile) {
  return JSON.parse(await readFile(new URL(sourceFile, MAP_ROOT), 'utf8'));
}

test('all data map rows compile into valid safe recipes', async () => {
  let rowCount = 0;

  for (const sourceFile of SOURCE_FILES) {
    const rows = await loadRows(sourceFile);
    for (const row of rows) {
      rowCount += 1;
      assert.equal(supports(sourceFile, row), true, `${sourceFile}: ${row.surface}`);

      const recipe = makeRecipe(sourceFile, row);
      assert.equal(recipe.family, 'data');
      assert.equal(recipe.sourceFile, sourceFile);
      assert.equal(recipe.surface, row.surface);
      assert.equal(recipe.safe, true);
      assert.equal(MODES.has(recipe.mode), true, `${sourceFile}: ${row.surface}`);
      assert.equal(typeof recipe.schedule, 'string');
      assert.notEqual(recipe.schedule.length, 0);
      assert.equal(typeof recipe.target, 'object');
      assert.equal(typeof recipe.expected, 'object');
    }
  }

  assert.equal(rowCount, 669);
});

test('money and customer rows below deep coverage stay red without a real result proof', async () => {
  for (const sourceFile of SOURCE_FILES) {
    const rows = await loadRows(sourceFile);
    const weakRows = rows.filter((row) => (
      SENSITIVE_IMPACTS.has(row.impact)
      && (row.coverage === 'ping' || row.coverage === 'none')
    ));

    assert.ok(weakRows.length > 0, `${sourceFile} should contain weak sensitive rows`);
    for (const row of weakRows) {
      const recipe = makeRecipe(sourceFile, row);
      if (recipe.proof) {
        assert.equal(recipe.mode, 'test', `${sourceFile}: ${row.surface}`);
        assert.equal(recipe.proof.depth, 'deep', `${sourceFile}: ${row.surface}`);
        assert.match(recipe.proof.evidence, /src\/pulse\/(?:coverage\/gap-|beats\/beat-)/);
        assert.match(recipe.proof.evidence, /\.test\.mjs\b/);
      } else {
        assert.equal(recipe.mode, 'manual-red', `${sourceFile}: ${row.surface}`);
      }
    }
  }
});

test('data proof is attached only where a focused executable check runs', async () => {
  let proved = 0;

  for (const sourceFile of SOURCE_FILES) {
    const rows = await loadRows(sourceFile);
    for (const row of rows) {
      const recipe = makeRecipe(sourceFile, row);
      if (recipe.proof) {
        proved += 1;
        assert.equal(['e2e', 'deep'].includes(recipe.proof.depth), true, row.surface);
        assert.match(recipe.proof.evidence, /\.test\.mjs\b/, row.surface);
        assert.ok(recipe.proof.asserts.length > 0, row.surface);
      }
    }
  }

  assert.equal(DATA_PROOF_CASES.length, 10);
  assert.equal(proved, 223);
});

test('representative source fields survive recipe compilation', async () => {
  for (const sourceFile of SOURCE_FILES) {
    const [row] = await loadRows(sourceFile);
    const recipe = makeRecipe(sourceFile, row);

    assert.equal(recipe.target.kind, row.kind);
    assert.equal(recipe.target.control, row.control);
    assert.deepEqual(recipe.target.calls, row.calls);
    assert.deepEqual(recipe.target.tables, row.tables);
    assert.equal(recipe.expected.coverage, row.coverage);
    assert.equal(recipe.expected.impact, row.impact);
    assert.equal(recipe.expected.evidence, row.evidence);

    if (sourceFile === 'tables.json') {
      assert.equal(recipe.target.created_in, row.created_in);
      assert.equal(recipe.target.writer_files, row.writer_files);
      assert.equal(recipe.target.reader_files, row.reader_files);
      assert.deepEqual(recipe.target.pulse_reader_files, row.pulse_reader_files);
    }
  }
});

test('receipt evidence uses receipt mode without weakening red rows', async () => {
  const rows = await loadRows('pipelines.json');
  const receiptRow = rows.find((row) => (
    /\breceipts?\b/i.test(row.evidence)
    && row.coverage !== 'none'
    && !(SENSITIVE_IMPACTS.has(row.impact) && row.coverage === 'ping')
  ));

  assert.ok(receiptRow);
  assert.equal(makeRecipe('pipelines.json', receiptRow).mode, 'receipt');
});

test('unsupported files and malformed rows are rejected', () => {
  const row = { surface: 'table:example' };
  assert.equal(supports('routes-0.json', row), false);
  assert.equal(supports('tables.json', null), false);
  assert.throws(() => makeRecipe('routes-0.json', row), /Unsupported data coverage row/);
});
