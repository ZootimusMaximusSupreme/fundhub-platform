import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepWhopBillingInbox } from './whop-billing-inbox-drain.mjs';

function fakeDb({ rows = [], waiting = 0 } = {}) {
  let first = true;
  const updates = [];
  return { updates, async query(sql, params) {
    if (/WITH ready/.test(sql)) {
      if (!first) return { rows: [] };
      first = false; return { rows };
    }
    if (/count\(\*\) FILTER/.test(sql)) return { rows: [{ waiting, stale: 0, exhausted: 0 }] };
    if (/UPDATE whop_billing_inbox/.test(sql)) { updates.push({ sql, params }); return { rows: [] }; }
    throw new Error(`Unexpected SQL ${sql}`);
  } };
}

test('Whop pass registers handlers before processing and records a successful heartbeat', async () => {
  const seen = [];
  const db = fakeDb({ rows: [{ id: 'receipt', attempts: 1 }] });
  const result = await sweepWhopBillingInbox(db, {
    ensureRegistered: () => seen.push('register'),
    process: async () => { seen.push('process'); return { ok: true }; },
    reconcile: async () => { seen.push('reconcile'); return { ok: true, recovered: 0 }; },
    recordHeartbeat: async (_db, payload) => { seen.push(payload); return { recorded: true }; }
  });
  assert.deepEqual(seen.slice(0, 3), ['register', 'process', 'reconcile']);
  assert.equal(result.ok, true);
  assert.equal(result.claimed, 1);
  assert.equal(seen[3].job, 'whop-billing-inbox-drain');
  assert.equal(seen[3].outcome, 'ok');
});

test('Whop API downtime does not prevent an already stored signed payment from processing', async () => {
  let processed = 0;
  let beat;
  const db = fakeDb({ rows: [{ id: 'receipt', attempts: 1 }] });
  const result = await sweepWhopBillingInbox(db, {
    ensureRegistered: () => {}, process: async () => { processed += 1; return { ok: true }; },
    reconcile: async () => { throw new Error('Whop read API unavailable'); },
    recordHeartbeat: async (_db, payload) => { beat = payload; }
  });
  assert.equal(processed, 1);
  assert.equal(result.counts.done, 1);
  assert.equal(result.ok, false);
  assert.equal(beat.outcome, 'error');
  assert.match(beat.error, /read API unavailable/);
});

test('exhausted, stale or failed processing stays red and remains available for retry', async () => {
  const db = fakeDb({ rows: [{ id: 'receipt', attempts: 1 }], waiting: 1 });
  const result = await sweepWhopBillingInbox(db, {
    ensureRegistered: () => {}, process: async () => { throw new Error('identity mismatch'); },
    reconcile: async () => ({ ok: true, recovered: 0 }), recordHeartbeat: async () => {}
  });
  assert.equal(result.ok, false);
  assert.equal(result.counts.failed, 1);
  assert.match(db.updates[0].sql, /status = 'failed'/);
});
