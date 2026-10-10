// Evening brief — "Good evening, Chris." 9:00 p.m. Arizona.
//
// Owner-set 2026-10-05 (MB6, ops/workflows/morning-brief-2026-10-05.md):
// deals come in and ads move overnight, so Chris should know what is going on
// before bed and again when he wakes up. Same sections as the morning brief,
// built by the same code (src/ops/morning-brief.mjs, kind 'evening'), for
// "today so far" — since local midnight in Arizona.
//
// Systems comes from the check stored this morning. This job never runs the
// pulse (Recon AG-07) a second time.
//
// Same switch as the morning. MORNING_BRIEF_LIVE is false, so the row is
// saved and nothing is texted. The time is EVENING_BRIEF_CRON in
// src/ops/morning-brief.mjs (UTC).

import { inngest } from "./client.mjs";
import { db as defaultDb } from "../db.mjs";
import { EVENING_BRIEF_CRON, MORNING_BRIEF_LIVE, runMorningBrief } from "../ops/morning-brief.mjs";

export { EVENING_BRIEF_CRON };

export async function handle({
  db,
  step,
  env = process.env,
  live = MORNING_BRIEF_LIVE,
  brief = runMorningBrief
} = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  return step.run("evening-brief", () => brief({ db, env, kind: "evening", live }));
}

export const eveningBrief = inngest.createFunction(
  { id: "evening-brief", name: "Evening brief — Good evening, Chris (9:00 p.m. Arizona)" },
  { cron: EVENING_BRIEF_CRON },
  ({ step }) => handle({ db: defaultDb, step, env: process.env })
);

export default eveningBrief;
