// Daily pulse — 6:00 a.m. America/Phoenix audit. Audit only. No auto-fix.
//
// Cron TZ=America/Phoenix 0 6 * * * fires at 6:00 a.m. Arizona all year.
// The morning brief is step 2, after this check. It does not run the check again.
//
// This is Recon (AG-07)'s runtime. Do not invent a second tripwire.
// Do not stretch src/ops/pulse.mjs (money pulse) into this.

import { inngest } from "./client.mjs";
import { db as defaultDb } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import { PULSE_CRON, runDailyPulse } from "../pulse/daily-pulse.mjs";
import { MORNING_BRIEF_LIVE, runMorningBrief } from "../ops/morning-brief.mjs";

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
  staffScope = null,
  morningBrief = runMorningBrief,
  briefLive = MORNING_BRIEF_LIVE
} = {}) {
  // When the brief is live it replaces the old morning-check text. One text.
  const replacePulseText = !!(briefLive && db);
  const pulse = await step.run("run-pulse", () => runDailyPulse({
    db,
    env,
    dryRun,
    fetchImpl,
    boardDir,
    gateRelayDirs,
    sendSms,
    sendWhatsApp,
    staffScope,
    recordRun: !dryRun,
    sendPulseText: !replacePulseText
  }));
  if (db) {
    try {
      await step.run("morning-brief", () => morningBrief({
        db, env, pulse, kind: "morning", live: briefLive, staffScope
      }));
    } catch (err) {
      console.error("[daily-pulse] morning brief failed:", String((err && err.message) || err).slice(0, 200));
    }
  }
  return pulse;
}

/* asStaff: the marketing-machine rows read FORCE-row-security tables (ads,
   ad_metrics_daily, funnel_page_stats, …), which the plain app connection
   reads as empty. Read-only SELECTs; asStaff only sets who is asking. */
export const dailyPulse = inngest.createFunction(
  { id: "daily-pulse", name: "Daily pulse — audit only (6:00 a.m. Arizona)" },
  { cron: PULSE_CRON },
  ({ step }) => handle({ db: defaultDb, step, env: process.env, dryRun: false, staffScope: asStaff })
);

export default dailyPulse;
