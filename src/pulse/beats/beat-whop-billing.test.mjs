import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as beat from './beat-whop-billing.mjs';
import { validateBeat, pinBeatSource, checkBeatSelfTest, runBeat } from './contract.mjs';
import { makeFakeCtx, ctxLog, FAKE_NOW } from './ctx.mjs';
import { cronIntervalMs, JOBS } from '../heartbeats.mjs';

/* The one clock on the Whop inbox since 2026-10-20 (the Inngest drain is retired). */
const SWEEPER = JOBS.find((j) => j.job === 'whop-billing-inbox-sweeper');

const world = (over = {}) => ({ ...beat.selfTest.pass(), ...over });
const go = (over = {}) => runBeat(beat, makeFakeCtx(beat, world(over)));
test('Whop hourly beat is read-only, valid and covers the payment clock', async () => {
  assert.deepEqual(validateBeat(beat, { file: 'beat-whop-billing.mjs' }), []);
  assert.deepEqual(pinBeatSource(readFileSync(new URL('./beat-whop-billing.mjs', import.meta.url), 'utf8')), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  assert.deepEqual(beat.covers, ['webhook:whop-billing']);
  assert.equal(SWEEPER.runner, 'netlify');
  assert.equal(beat.CLOCK_STALE_MS, 3 * cronIntervalMs(SWEEPER.cron));
  assert.match(beat.CLOCK_SQL, /job = 'whop-billing-inbox-sweeper'/);
});
test('Whop hourly beat runs every step and reports the limit of its proof', async () => {
  const ctx = makeFakeCtx(beat, world());
  const result = await runBeat(beat, ctx);
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.notRun, []);
  assert.equal(ctxLog(ctx).http.length, 0);
  assert.equal(ctxLog(ctx).reads.length, 3);
  assert.match(result.detail, /does not prove a real financed buyer/);
});
test('Whop missing settings fail without echoing values', async () => {
  const result = await go({ env: { ...world().env, WHOP_WEBHOOK_SECRET: '' } });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'configured');
  assert.match(result.detail, /WHOP_WEBHOOK_SECRET/);
  assert.ok(!result.detail.includes('selftest-key'));
});
test('Whop missing, stale and failed clocks are red', async () => {
  for (const row of [{ last_at: null, last_outcome: null },
    { last_at: new Date(FAKE_NOW.getTime() - 15 * 60000 - 1000), last_outcome: 'ok' },
    { last_at: FAKE_NOW, last_outcome: 'error' }]) {
    const result = await go({ read: [{ match: /FROM job_heartbeats/, rows: [row] }] });
    assert.equal(result.ok, false);
    assert.equal(result.step, 'clock-alive');
  }
});
test('Whop clock exactly 15 minutes old (3 x its 5-minute schedule) is still alive', async () => {
  const result = await go({ read: [{ match: /FROM job_heartbeats/, rows: [{ last_at: new Date(FAKE_NOW.getTime() - 15 * 60000), last_outcome: 'ok' }] }, ...world().read.slice(1)] });
  assert.equal(result.ok, true, result.detail);
});
test('Whop stuck receipts and missing grants fail their exact step; unreadable counts stay red', async () => {
  for (const [match, step] of [[/FROM whop_billing_inbox/, 'inbox-clear'], [/FROM payment_links/, 'paid-access']]) {
    const reads = world().read.map((item) => String(item.match) === String(match) ? { match, rows: [{ n: 1 }] } : item);
    const result = await go({ read: reads });
    assert.equal(result.ok, false);
    assert.equal(result.step, step);
  }
  const result = await go({ read: [world().read[0], { match: /FROM whop_billing_inbox/, rows: [] }] });
  assert.equal(result.ok, false);
  assert.equal(result.step, 'inbox-clear');
});
