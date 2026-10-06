// Daily pulse — 7:00 a.m. America/Denver audit. Audit only. No auto-fix.
//
// Cron TZ=America/Denver 0 7 * * * fires at 7:00 a.m. on Denver's own clock
// all year (Inngest's TZ= prefix), so the fall-back needs no flip.
//
// This is Recon (AG-07)'s runtime. Do not invent a second tripwire.
// Do not stretch src/ops/pulse.mjs (money pulse) into this.

import { inngest } from "./client.mjs";
import { db as defaultDb } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import { PULSE_CRON, runDailyPulse } from "../pulse/daily-pulse.mjs";

export { PULSE_CRON };

export async function handle({
  db,
  step,
  env = process.env,
  dryRun = false,
  fetchImpl,
  boardDir,
  gateRelayDirs,
  sendSms,
  sendWhatsApp,
  staffScope = null
} = {}) {
  return step.run("run-pulse", () => runDailyPulse({
    db,
    env,
    dryRun,
    fetchImpl,
    boardDir,
    gateRelayDirs,
    sendSms,
    sendWhatsApp,
    staffScope,
    recordRun: !dryRun
  }));
}

/* asStaff: the marketing-machine rows read FORCE-row-security tables (ads,
   ad_metrics_daily, funnel_page_stats, …), which the plain app connection
   reads as empty. Read-only SELECTs; asStaff only sets who is asking. */
export const dailyPulse = inngest.createFunction(
  { id: "daily-pulse", name: "Daily pulse — audit only (7:00 a.m. Denver)" },
  { cron: PULSE_CRON },
  ({ step }) => handle({ db: defaultDb, step, env: process.env, dryRun: false, staffScope: asStaff })
);

export default dailyPulse;
