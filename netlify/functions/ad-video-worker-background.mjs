// The long half of the ad-video pipeline: the part that moves whole video files.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHY THERE ARE TWO FUNCTIONS AND NOT ONE.
//
// Netlify gives a job a different amount of time depending on how it is
// started, and this pipeline needs the longest one:
//
//   * a SYNCHRONOUS function (that is what /api/inngest is) — killed at 26s
//   * a SCHEDULED function (a clock) ————————————————————— killed at 30s
//   * a BACKGROUND function (name ends -background) ——————— 15 minutes
//
// A pass downloads a whole filmed take out of Drive and pushes it to Submagic.
// The first real take was 120 MB. Measured on production 2026-09-23, twice: on
// Inngest it died inside 26 seconds, and moving it to a scheduled function did
// not help because 30 seconds is barely different. Both left a spend claim with
// no project behind it, and the next pass then refused to spend again — which
// is correct, because Submagic publishes no list endpoint and nothing can ask
// whether an upload landed.
//
// Only a background function has the time. A background function cannot be put
// on a clock, so ad-video-sweeper.mjs holds the clock and does nothing but
// start this one. That is Netlify's own documented way to schedule long work.
//
// THIS IS AN OPEN URL, so it checks a shared secret. Without that, anyone who
// guessed the path could make us spend Submagic minutes.
// ═══════════════════════════════════════════════════════════════════════════

import { db } from "../../src/db.mjs";
import { sweep, saveFinishedToDrive } from "../../src/workflows/ad-video-sweeper.mjs";

/* OUR OWN COPY OF EACH FINISHED CUT. This port was never supplied, so
   storage_final_key stayed NULL and the only copy was Submagic's link
   (board submagic-settings-lock-2026-09-23, "Left undone"). The copy goes to
   DRIVE_FINISHED_FOLDER_ID; with that unset, the row says so in save_note and
   the buzz still goes. */
export const saveFinished = saveFinishedToDrive;

/* ONE TAKE PER PASS. Not throughput — spend. A create costs one of 30 an hour
   and bills API minutes; an export costs one of 50. One take per pass means a
   bug that spends wrongly spends once and is visible on the next pass rather
   than draining the hour's allowance in a single invocation. Twelve passes an
   hour is still far more than Chris films. */
/* Chris 2026-09-24: the long videos have to land in Submagic in one pass,
   not one every five minutes. Still capped, so a bug cannot drain the hour. */
export const TAKES_PER_PASS = 10;

/** The header the scheduler proves itself with. */
export const AUTH_HEADER = "x-fundhub-worker";

export async function handler(req) {
  const expected = process.env.AD_VIDEO_WORKER_SECRET || "";
  const got = req?.headers?.get ? req.headers.get(AUTH_HEADER) : null;

  /* No secret configured is a CLOSED door, not an open one. A missing variable
     must never be the thing that makes a paid endpoint public. */
  if (!expected || got !== expected) {
    console.error("[ad-video-worker] refused: the shared secret did not match");
    return new Response("no", { status: 404 });
  }

  /* WHICH BUILD IS RUNNING. Two passes on 2026-09-24 behaved like code from
     before a deploy and nothing in the log could say which build they were.
     Netlify sets COMMIT_REF at build time; printing it makes a stale function
     visible in one line. */
  console.log(`[ad-video-worker] build ${String(process.env.COMMIT_REF || "unknown").slice(0, 8)} starting a pass`);
  const result = await sweep(db, { limit: TAKES_PER_PASS, saveFinished });

  if (!result.ok) {
    console.error(`[ad-video-worker] pass failed: ${result.error}`);
  } else if (result.detected || result.advanced) {
    console.log(`[ad-video-worker] found ${result.detected}, moved ${result.advanced}: ` +
      JSON.stringify(result.per || []));
  }

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

export default handler;
