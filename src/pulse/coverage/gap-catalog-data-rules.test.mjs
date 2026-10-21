// client_custom_fields and repair_decision_log: what counts as a saved result.
//
// These tests read the REAL generated SQL for one table and judge one fake row with it,
// the same way Postgres would: a field is present when its text is not blank. The rule is
// not faked. Every judge here has a green case and a red case, so a rule that can only pass
// (or only fail) breaks the build.

import assert from 'node:assert/strict';
import test from 'node:test';

import { SQL_BATCHES, TABLE_RULES } from './gap-catalog-data.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';

function completeWhere(table) {
  const marker = `'${table}'::text AS table_name`;
  const batch = SQL_BATCHES.find((sql) => sql.includes(marker));
  assert.ok(batch, `${table} is in a batch`);
  const select = batch.split('\nUNION ALL\n').find((part) => part.includes(marker));
  const where = select.match(/FILTER \(WHERE (.*)\)::int AS complete_count/s);
  assert.ok(where, `${table} has a complete_count filter`);
  return where[1];
}

// Same test Postgres runs: NULLIF(BTRIM(COALESCE(to_jsonb(t)->>'field','')),'') IS NOT NULL.
function fieldText(row, field) {
  const value = row[field];
  if (value === undefined || value === null) return '';
  return (Array.isArray(value) || typeof value === 'object' ? JSON.stringify(value) : String(value)).trim();
}

function rowIsComplete(table, row) {
  const where = completeWhere(table);
  const fieldsIn = (text) => [...text.matchAll(/->>'([a-z0-9_]+)'/g)].map((m) => m[1]);
  // Top level is: A AND B AND ... [AND (X OR Y OR ...)]. The only parenthesis is the any-group.
  const open = where.indexOf(' AND (');
  const allPart = open === -1 ? where : where.slice(0, open);
  const anyPart = open === -1 ? '' : where.slice(open + ' AND ('.length, where.lastIndexOf(')'));
  const allFields = fieldsIn(allPart);
  const anyFields = fieldsIn(anyPart);
  assert.deepEqual(allFields, TABLE_RULES[table].all, `${table}: SQL all-fields match the rule`);
  assert.deepEqual(anyFields, TABLE_RULES[table].any || [], `${table}: SQL any-fields match the rule`);
  const allOk = allFields.every((field) => fieldText(row, field) !== '');
  const anyOk = anyFields.length === 0 || anyFields.some((field) => fieldText(row, field) !== '');
  return allOk && anyOk;
}

test('client_custom_fields: a lead row with survey answers is a complete result', () => {
  assert.equal(rowIsComplete('client_custom_fields', {
    org_id: ORG, client_id: 'c1', cf_svy_planned_use: 'Growth', cf_svy_money_change_now: ['Grow faster'],
  }), true);
  assert.equal(rowIsComplete('client_custom_fields', {
    org_id: ORG, client_id: 'c1', cf_svy_funding_target_amount: '$50k - $100k',
  }), true);
  assert.equal(rowIsComplete('client_custom_fields', {
    org_id: ORG, client_id: 'c1', cf_svy_money_change_now: ['Peace of mind'],
  }), true, 'the one array column counts');
});

test('client_custom_fields: a row with no survey answer, no client, or no company is still red', () => {
  assert.equal(rowIsComplete('client_custom_fields', { org_id: ORG, client_id: 'c1' }), false, 'empty shell');
  assert.equal(rowIsComplete('client_custom_fields', { org_id: ORG, client_id: 'c1', cf_svy_planned_use: '   ' }), false, 'blank answer');
  assert.equal(rowIsComplete('client_custom_fields', { org_id: ORG, cf_svy_planned_use: 'Growth' }), false, 'no client');
  assert.equal(rowIsComplete('client_custom_fields', { client_id: 'c1', cf_svy_planned_use: 'Growth' }), false, 'no company');
  assert.equal(
    rowIsComplete('client_custom_fields', { org_id: ORG, client_id: 'c1', ai_call_enabled: ['Yes'] }),
    false,
    'a call-agent checkbox alone is not a survey result',
  );
});

test('client_custom_fields: the answer list is exactly the list its only writer saves', async () => {
  const { CF_SVY_TYPED_COLUMNS } = await import('../../handlers/client-custom-fields.mjs');
  assert.deepEqual([...TABLE_RULES.client_custom_fields.any].sort(), [...CF_SVY_TYPED_COLUMNS].sort());
  assert.deepEqual(TABLE_RULES.client_custom_fields.all, ['org_id', 'client_id']);
});

test('repair_decision_log: a client-wide decision with no case is a complete result', () => {
  const stalled = { org_id: ORG, client_id: 'c1', case_id: null, decision: 'repair.stalled', payload: {} };
  assert.equal(rowIsComplete('repair_decision_log', stalled), true);
  assert.equal(rowIsComplete('repair_decision_log', { ...stalled, case_id: 'k1', decision: 'parse.confirmed' }), true);
});

test('repair_decision_log: a decision that names no client, no decision, or no company is still red', () => {
  const ok = { org_id: ORG, client_id: 'c1', case_id: 'k1', decision: 'parse.confirmed', payload: { a: 1 } };
  assert.equal(rowIsComplete('repair_decision_log', ok), true);
  assert.equal(rowIsComplete('repair_decision_log', { ...ok, client_id: null }), false, 'no client: the timeline can never show it');
  assert.equal(rowIsComplete('repair_decision_log', { ...ok, decision: '' }), false);
  assert.equal(rowIsComplete('repair_decision_log', { ...ok, org_id: null }), false);
  assert.equal(rowIsComplete('repair_decision_log', { ...ok, payload: null }), false);
  assert.deepEqual(TABLE_RULES.repair_decision_log, { all: ['org_id', 'client_id', 'decision', 'payload'] });
});
