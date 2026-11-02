import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOutreach, hasOutreachClaim } from './store.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const closer = { id: STAFF, org_id: ORG, role: 'closer', roles: ['closer', 'outbound_rep'] };

function dbFor({ actualRole = 'closer', assigned = false, missingAssignments = false } = {}) {
  const calls = [];
  const db = { async query(sql, args) {
    calls.push({ sql, args });
    if (sql.includes('FROM staff WHERE id=$1')) {
      return { rows: [{ id: STAFF, org_id: ORG, name: 'Rep', email: 'rep@example.test', role: actualRole }] };
    }
    if (sql.includes('FROM staff_role_assignments')) {
      assert.deepEqual(args, [ORG, STAFF]);
      assert.match(sql, /sr\.active = true/);
      assert.match(sql, /sr\.org_id = a\.org_id/);
      return { rows: assigned ? [{ '?column?': 1 }] : [] };
    }
    if (sql.includes('SELECT DISTINCT s.id,s.name')) {
      if (missingAssignments) throw Object.assign(new Error('missing table'), { code: '42P01' });
      return { rows: assigned ? [{ id: STAFF, name: 'Rep', role: 'outbound_rep' }] : [] };
    }
    if (sql.includes('FROM outreach_programs WHERE')) return { rows: [] };
    if (sql.includes('WITH scope AS')) return { rows: [{ total: 0, due_now: 0, replies_waiting: 0 }] };
    if (sql.includes('SELECT id,name,role FROM staff')) return { rows: [] };
    if (sql.includes('SELECT count(*)::int total FROM outreach_accounts')) return { rows: [{ total: 0 }] };
    if (sql.includes('SELECT a.*,s.name assigned_staff_name')) return { rows: [] };
    throw new Error(`unexpected read: ${sql.slice(0, 80)}`);
  } };
  return { db, calls };
}

test('bank outreach accepts an assigned secondary outbound rep and keeps manager access closed', async () => {
  const { db, calls } = dbFor({ assigned: true });
  assert.equal(hasOutreachClaim(closer), true);
  const result = await readOutreach(db, { staff: closer });
  assert.equal(result.ok, true);
  assert.equal(result.canManage, false);
  assert.equal(result.reps[0].role, 'outbound_rep');
  assert(calls.some(call => call.sql.includes('FROM staff_role_assignments')));
  await assert.rejects(readOutreach(db, { staff: closer, query: { view: 'team' } }), { statusCode: 403 });
});

test('bank outreach rejects a forged or removed secondary assignment', async () => {
  const { db } = dbFor({ assigned: false });
  await assert.rejects(readOutreach(db, { staff: closer }), { statusCode: 403 });
  await assert.rejects(readOutreach(db, { staff: { ...closer, roles: ['closer'] } }), { statusCode: 403 });
});

test('existing primary outreach roles still work when the assignment table is absent', async () => {
  const { db, calls } = dbFor({ actualRole: 'owner', missingAssignments: true });
  const result = await readOutreach(db, { staff: { ...closer, role: 'owner', roles: ['owner'] } });
  assert.equal(result.ok, true);
  assert.equal(result.canManage, true);
  assert(!calls.some(call => call.sql.includes('FROM staff_role_assignments')));
});
