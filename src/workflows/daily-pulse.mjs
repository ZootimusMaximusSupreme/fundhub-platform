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
import { DEFAULT_BASE_URL, PULSE_CRON, defaultOrgId, runDailyPulse } from "../pulse/daily-pulse.mjs";
import { GAP_LANES, runCoverageSlices, runGapLane } from "../pulse/coverage/run-slices.mjs";
import { MORNING_BRIEF_LIVE, runMorningBrief } from "../ops/morning-brief.mjs";

export { PULSE_CRON };

function stepSkip(id, detail) {
  return {
    id,
    checkId: "step",
    sliceId: id,
    kind: "coverage",
    group: "backend",
    status: "skip",
    detail: String(detail || "").replace(/\s+/g, " ").trim().slice(0, 300),
    suggestedFix: null,
    customerSees: null,
    schedule: null
  };
}

/**
 * The slice rows and every gap lane, each in its own step.
 *
 * Netlify cuts /api/inngest at 26 seconds per request, and each step is one
 * request. Measured 2026-10-08 on live data (read-only): the pulse without
 * coverage took about 6 s; slices plus the 37 gap lanes took about 55 s. One
 * step for all of it would be cut, and the 6 a.m. text would never go out.
 * The slowest lane (finance-os) took about 12 s on its own.
 *
 * A step that throws, or keeps failing, becomes one skip row. It never stops
 * the pulse.
 */
export async function runCoverageSteps({ step, db, env = process.env, fetchImpl, staffScope = null, lanes = GAP_LANES } = {}) {
  const rows = [];
  let orgId = null;
  try {
    orgId = await step.run("coverage-org", () => defaultOrgId(db));
  } catch (err) {
    rows.push(stepSkip("coverage-org", `Default org not read: ${(err && err.message) || err}`));
  }
  try {
    rows.push(...await step.run("coverage-slices", () => runCoverageSlices({
      db,
      scope: staffScope,
      now: new Date(),
      gaps: false
    })));
  } catch (err) {
    rows.push(stepSkip("coverage-slices", `Slice pass did not finish: ${(err && err.message) || err}`));
  }
  for (const lane of lanes) {
    try {
      rows.push(...await step.run(`coverage-${lane}`, () => runGapLane(lane, {
        db,
        scope: staffScope,
        now: new Date(),
        orgId,
        fetchImpl: fetchImpl || globalThis.fetch,
        baseUrl: DEFAULT_BASE_URL,
        env
      })));
    } catch (err) {
      rows.push(stepSkip(`${lane}:step`, `${lane} did not finish: ${(err && err.message) || err}`));
    }
  }
  return rows;
}

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
  briefLive = MORNING_BRIEF_LIVE,
  coverage = runCoverageSteps
} = {}) {
  // When the brief is live it replaces the old morning-check text. One text.
  const replacePulseText = !!(briefLive && db);
  // With no database the pulse runs its own coverage pass (dry runs, tests).
  const coverageRows = db
    ? await coverage({ step, db, env, fetchImpl, staffScope })
    : null;
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
    sendPulseText: !replacePulseText,
    coverageRows
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
