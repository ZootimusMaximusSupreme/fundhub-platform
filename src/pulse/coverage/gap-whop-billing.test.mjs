import test from 'node:test';
import assert from 'node:assert/strict';
import { CHECK_IDS, WHOP_INBOX_SQL, WHOP_ACCESS_SQL, gapChecks } from './gap-whop-billing.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';
test('Whop deep checks are scoped reads with exact receipt-to-transaction-to-entitlement joins', () => {
  assert.deepEqual(CHECK_IDS, ['payments:whop-inbox-waiting', 'payments:whop-paid-no-access']);
  for (const sql of [WHOP_INBOX_SQL, WHOP_ACCESS_SQL]) {
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/);
    assert.match(sql, /org_id = \$1/);
  }
  assert.match(WHOP_ACCESS_SQL, /t\.provider_ref = l\.whop_payment_id/);
  assert.match(WHOP_ACCESS_SQL, /e\.source_transaction_id = t\.id/);
  assert.match(WHOP_ACCESS_SQL, /e\.entitlement_code = pe\.entitlement_code/);
});
test('Whop deep checks fail loudly on missed payments and unreadable/malformed data', async () => {
  const db = { query: async () => ({ rows: [{ n: 2 }] }) };
  const failed = await gapChecks({ db, orgId: ORG, now: new Date('2026-10-20T17:00:00Z') });
  assert.ok(failed.every((row) => row.status === 'FAIL' && row.suggestedFix));
  for (const db of [{ query: async () => { throw new Error('database read failed'); } }, { query: async () => ({ rows: [] }) }]) {
    assert.ok((await gapChecks({ db, orgId: ORG })).every((row) => row.status === 'FAIL'));
  }
});
test('Whop deep checks never turn a missing database into a pass; zero counts are explicit', async () => {
  assert.ok((await gapChecks({})).every((row) => row.status === 'skip'));
  const reads = [];
  const result = await gapChecks({ db: { query: async (sql, params) => {
    reads.push({ sql, params }); return { rows: [{ n: 0 }] };
  } }, orgId: ORG, now: new Date('2026-10-20T17:00:00Z') });
  assert.ok(result.every((row) => row.status === 'PASS' && row.detail.startsWith('0 ')));
  assert.deepEqual(reads[0].params, [ORG, '2026-10-20T16:55:00.000Z', '2026-10-20T16:45:00.000Z']);
});
