import '@pdf-lib/fontkit';
import { db } from '../../src/db.mjs';
import { sweepWhopBillingInbox } from '../../src/workflows/whop-billing-inbox-drain.mjs';
import { noteScheduledRun } from '../../src/pulse/heartbeats.mjs';

// Every 5 minutes (owner 2026-10-20, ops/workflows/inngest-diet-2026-10-20.md). The Inngest
// whop-billing-inbox-drain that also drained this queue every minute is retired; this is the only clock.
export const SWEEP_CRON = '*/5 * * * *';
export async function handler() {
  const result = await sweepWhopBillingInbox(db, { runner: 'netlify', job: 'whop-billing-inbox-sweeper',
    recordHeartbeat: async () => ({ recorded: false, reason: 'fallback_records_its_own_run' }) });
  await noteScheduledRun(db, "whop-billing-inbox-sweeper", result);
  return Response.json(result);
}
export default handler;
