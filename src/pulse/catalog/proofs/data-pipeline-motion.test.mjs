import assert from 'node:assert/strict';
import test from 'node:test';

import {
  checkPipelineMotion,
  REPAIR_STUCK_STAGES,
} from '../../pipeline-motion.mjs';

const ORG = '11111111-1111-4111-8111-111111111111';

test('repair pipeline proof reads every stuck stage and fails on a stuck result', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER)\b/i);
      if (/FROM cards c/.test(sql)) return { rows: [{ n: 1 }] };
      if (/FROM messages/.test(sql)) return { rows: [{ n: 0 }] };
      if (/FROM clients/.test(sql)) return { rows: [] };
      throw new Error(`unexpected proof query: ${sql}`);
    },
  };

  const rows = await checkPipelineMotion({ db, orgId: ORG });
  const repair = rows.find((row) => row.id === 'pipeline:repair');
  assert.equal(repair.status, 'FAIL');
  assert.match(repair.detail, /1 repair file/);

  const repairRead = calls.find((call) => /FROM cards c/.test(call.sql));
  assert.deepEqual(repairRead.params, [ORG, [
    'stalled',
    'letters_generated',
    'ready_to_send',
    'response_received',
  ]]);
  assert.deepEqual([...REPAIR_STUCK_STAGES], repairRead.params[1]);
});
