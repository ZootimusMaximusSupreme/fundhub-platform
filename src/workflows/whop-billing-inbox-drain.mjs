import { inngest } from './client.mjs';
import { db } from '../db.mjs';
import { ensureRegistered } from '../register-all.mjs';
import { processWhopBillingInboxRow } from '../adapters/whop-billing.mjs';
import { drainWhopBillingInbox, readWhopBillingHealth } from '../payments/whop-billing-inbox.mjs';
import { reconcileWhopBilling } from '../payments/whop-billing-reconcile.mjs';
import { recordHeartbeat } from '../pulse/heartbeats.mjs';

export const SWEEP_CRON = '* * * * *';
export const SOURCE_WORKFLOW = 'whop-billing-inbox-drain';

export async function sweepWhopBillingInbox(db, options = {}) {
  const startedAt = new Date();
  let result;
  try {
    (options.ensureRegistered || ensureRegistered)();
    const process = options.process || ((row, handleDb) => processWhopBillingInboxRow(row, handleDb, options));
    // Drain signed receipts even if Whop's read API is down.
    const drained = await drainWhopBillingInbox(db, { process, limit: options.limit, maxBatches: options.maxBatches });
    let reconciliation;
    try { reconciliation = await (options.reconcile || reconcileWhopBilling)(db, options); }
    catch (err) { reconciliation = { ok: false, error: String(err?.message || err).slice(0, 200) }; }
    const recovered = reconciliation.recovered > 0
      ? await drainWhopBillingInbox(db, { process, limit: options.limit, maxBatches: options.maxBatches })
      : { claimed: 0, counts: { done: 0, ignored: 0, failed: 0 } };
    const health = await readWhopBillingHealth(db);
    result = { ok: drained.counts.failed === 0 && recovered.counts.failed === 0
      && reconciliation.ok && health.ok,
    claimed: drained.claimed + recovered.claimed, counts: {
      done: drained.counts.done + recovered.counts.done,
      ignored: drained.counts.ignored + recovered.counts.ignored,
      failed: drained.counts.failed + recovered.counts.failed }, reconciliation, health };
  } catch (err) {
    result = { ok: false, claimed: 0, error: String(err?.message || err).slice(0, 250) };
  }
  await (options.recordHeartbeat || recordHeartbeat)(db, { job: options.job || SOURCE_WORKFLOW,
    runner: options.runner || 'inngest', startedAt, outcome: result.ok ? 'ok' : 'error',
    itemCount: result.claimed || 0,
    error: result.ok ? null : result.error || result.reconciliation?.error || 'Whop receipts need attention' });
  return result;
}

export async function handle({ db: handleDb = db, step } = {}) {
  if (step?.run) return step.run('whop-billing-inbox', () => sweepWhopBillingInbox(handleDb));
  return sweepWhopBillingInbox(handleDb);
}

export const whopBillingInboxDrain = inngest.createFunction(
  { id: 'whop-billing-inbox-drain', name: 'Whop Blueprint payment recovery' },
  { cron: SWEEP_CRON }, handle);
export default sweepWhopBillingInbox;
