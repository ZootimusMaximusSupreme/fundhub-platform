// The clock for the ad-video pipeline. It does no work itself.
//
// ═══════════════════════════════════════════════════════════════════════════
// ALL THIS DOES IS START THE BACKGROUND WORKER.
//
// Netlify kills a SCHEDULED function at 30 seconds. A pass of this pipeline
// moves a whole video file — the first real take was 120 MB — and cannot
// finish in 30 seconds any more than it could in the 26 it had on Inngest.
// Measured on production 2026-09-23, both ways, both times leaving a spend
// claim with no project behind it.
//
// A BACKGROUND function gets 15 minutes but cannot be put on a clock. So this
// holds the clock, fires one request at the worker, and returns. The worker
// answers 202 immediately and keeps running after this function is gone.
//
// Read netlify/functions/ad-video-worker-background.mjs for the real work.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";

/* Every five minutes, matching the SWEEP_CRON the workflow module documents.

   THE SCHEDULE IS DECLARED IN netlify.toml, NOT HERE — same reason as the other
   sweepers in this directory: the `schedule()` wrapper form would be a new npm
   dependency and CLAUDE.md §8 does not allow one for something a two-line
   config block already does. */
export const SWEEP_CRON = "*/5 * * * *";

export const WORKER_PATH = "/.netlify/functions/ad-video-worker-background";

export async function handler() {
  const base = process.env.URL || process.env.DEPLOY_URL || "";
  const secret = process.env.AD_VIDEO_WORKER_SECRET || "";

  if (!base || !secret) {
    /* Still a 200. A non-2xx from a scheduled function is a deploy-level alarm
       and a missing variable is not one — it is a thing to read in the log. */
    const why = !base ? "no site URL in the environment" : "AD_VIDEO_WORKER_SECRET is not set";
    console.error(`[ad-video-sweeper] did not start the worker: ${why}`);
    const missed = { ok: false, started: false, error: why };
    await noteScheduledRun(db, "ad-video-sweeper", missed);
    return new Response(JSON.stringify(missed), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }

  let started = false;
  let error = null;
  try {
    /* A background function answers 202 the moment it is accepted and keeps
       running for up to 15 minutes after this function has returned. So this
       await is short — it is waiting for the acceptance, not for the work. */
    const res = await fetch(`${base}${WORKER_PATH}`, {
      method: "POST",
      headers: { "x-fundhub-worker": secret }
    });
    started = res.status === 202 || res.ok;
    if (!started) error = `the worker answered ${res.status}`;
  } catch (err) {
    error = String((err && err.message) || err).slice(0, 300);
  }

  if (error) console.error(`[ad-video-sweeper] ${error}`);
  const result = { ok: !error, started, error };
  await noteScheduledRun(db, "ad-video-sweeper", result);
  return new Response(JSON.stringify(result), {
    status: 200, headers: { "content-type": "application/json" }
  });
}

export default handler;
