import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHECK_IDS,
  SQL_BATCHES,
  TABLE_NAMES,
  TABLE_RULES,
  gapChecks,
  judgeTableResult,
} from './gap-catalog-data.mjs';
import { GAP_FILES } from './modules.mjs';

const MAP_ROOT = new URL('../../../ops/workflows/coverage-every-surface-2026-10-10/', import.meta.url);
const ORG = '11111111-1111-4111-8111-111111111111';

async function mappedTables() {
  const rows = JSON.parse(await readFile(new URL('tables.json', MAP_ROOT), 'utf8'));
  return rows.filter((row) => (
    ['money', 'customerData', 'customerMessage'].includes(row.impact)
    && row.coverage === 'e2e'
  )).map((row) => row.tables[0]).sort();
}

function fakeDb(overrides = {}, failOn = null) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      if (failOn && sql.includes(`'${failOn}'`)) throw new Error(`read failed for ${failOn}`);
      const tables = [...sql.matchAll(/SELECT '([^']+)'::text AS table_name/g)].map((match) => match[1]);
      return {
        rows: tables.map((table) => ({
          table_name: table,
          row_count: 1,
          complete_count: 1,
          ...(overrides[table] || {}),
        })),
      };
    },
  };
}

test('the lane owns the exact 66 sensitive e2e table results', async () => {
  assert.equal(TABLE_NAMES.length, 66);
  assert.deepEqual([...TABLE_NAMES].sort(), await mappedTables());
  assert.equal(CHECK_IDS.length, 66);
  assert.equal(new Set(CHECK_IDS).size, 66);
  assert.ok(TABLE_NAMES.every((table) => TABLE_RULES[table].all.length > 0));
});

test('every query is one read and checks row data, not table shape', () => {
  const joined = SQL_BATCHES.join('\n');
  assert.equal(SQL_BATCHES.length, 6);
  for (const sql of SQL_BATCHES) {
    assert.match(sql.trim(), /^SELECT\b/i);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i);
    assert.match(sql, /to_jsonb\(t\)/);
    assert.match(sql, /complete_count/);
  }
  for (const table of TABLE_NAMES) {
    assert.match(joined, new RegExp(`FROM "${table}" t`));
    for (const field of [...TABLE_RULES[table].all, ...(TABLE_RULES[table].any || [])]) {
      assert.match(joined, new RegExp(`->>'${field}'`), `${table}.${field}`);
    }
  }
  assert.doesNotMatch(joined, /information_schema|pg_catalog/i);
});

test('fake saved results pass only when every row has its business result', async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, orgId: ORG });
  assert.equal(rows.length, 66);
  assert.ok(rows.every((row) => row.status === 'PASS'));
  assert.equal(db.calls.length, 6);
  assert.ok(db.calls.every((call) => call.params[0] === ORG));

  const bad = await gapChecks({
    db: fakeDb({ bank_transactions: { row_count: 4, complete_count: 2 } }),
    orgId: ORG,
  });
  const bank = bad.find((row) => row.id === 'catalog-data:bank_transactions');
  assert.equal(bank.status, 'FAIL');
  assert.match(bank.detail, /2 of 4 saved result rows/);
  assert.match(bank.suggestedFix, /Do not auto-fix\. Chris fixes reds\./);
});

test('an empty table is verified nothing to judge, never a fake pass', () => {
  const row = judgeTableResult('bank_transactions', { row_count: 0, complete_count: 0 });
  assert.equal(row.status, 'na');
  assert.deepEqual(row.na, { code: 'catalog-data-empty', args: { table: 'bank_transactions' } });
  assert.equal(row.suggestedFix, null);
});

test('a failed batch stays unchecked and the lane is on the shipped module list', async () => {
  assert.ok(GAP_FILES.some(([name]) => name === 'gap-catalog-data.mjs'));
  const rows = await gapChecks({ db: fakeDb({}, 'bank_transactions'), orgId: ORG });
  const failedBatch = rows.filter((row) => row.status === 'skip');
  assert.equal(failedBatch.length, 11);
  assert.ok(failedBatch.some((row) => row.id === 'catalog-data:bank_transactions'));
  assert.ok(rows.some((row) => row.status === 'PASS'));
});
