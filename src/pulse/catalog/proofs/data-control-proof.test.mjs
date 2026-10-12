import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { dataControlProofFor } from './data-control-proof.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const MAP_ROOT = path.join(ROOT, 'ops/workflows/coverage-every-surface-2026-10-10');
const SOURCE_FILES = ['pipelines.json', 'tables.json', 'banks-links.json'];

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

const CONTROL_FILES = [
  ...filesUnder(path.join(ROOT, 'db')),
  ...filesUnder(path.join(ROOT, 'src')),
  ...filesUnder(path.join(ROOT, 'api')),
  ...filesUnder(path.join(ROOT, 'public/app')),
  path.join(ROOT, 'netlify.toml'),
].filter((file) => /\.(?:mjs|js|html|sql|toml|json|csv)$/.test(file) && fs.existsSync(file));

const CONTROL_TEXT = CONTROL_FILES.map((file) => fs.readFileSync(file, 'utf8')).join('\n');

function repoPaths(row) {
  const text = `${row.surface} ${row.evidence}`;
  return [...new Set(text.match(/\b(?:src|api|scripts|docs|public|netlify|marketing)\/[A-Za-z0-9_./-]+/g) || [])]
    .map((value) => value.replace(/[),;:]+$/, ''));
}

function namedTables(row) {
  return Array.isArray(row.tables) ? row.tables : [];
}

function tableExists(table) {
  const escaped = String(table).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(CONTROL_TEXT);
}

test('shared control proof reaches a real repo file, table, or pipeline key', () => {
  let proved = 0;

  for (const sourceFile of SOURCE_FILES) {
    const rows = JSON.parse(fs.readFileSync(path.join(MAP_ROOT, sourceFile), 'utf8'));
    for (const row of rows) {
      const proof = dataControlProofFor(sourceFile, row);
      if (!proof) continue;
      proved += 1;

      assert.equal(['staffOnly', 'none'].includes(row.impact), true);
      assert.equal(['e2e', 'deep'].includes(proof.depth), true);
      assert.equal(proof.asserts, row.control);

      const paths = repoPaths(row);
      const hasFile = paths.some((value) => fs.existsSync(path.join(ROOT, value)))
        || (String(row.surface).includes('netlify.toml') && fs.existsSync(path.join(ROOT, 'netlify.toml')));
      const hasTable = namedTables(row).some(tableExists);
      const stage = String(row.control).match(/^stage ([a-z0-9_]+)/i)?.[1];
      const hasStage = stage ? new RegExp(`\\b${stage}\\b`).test(CONTROL_TEXT) : false;

      assert.equal(
        hasFile || hasTable || hasStage,
        true,
        `${sourceFile}: ${row.surface}: ${row.control}`,
      );
    }
  }

  assert.equal(proved, 59);
});
