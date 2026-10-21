// The cron clock. Every 5 minutes: start each scheduled job that is due. It does no job work itself.
//
// Owner, 2026-10-20: "stop burning ingests". Every cron used to run on Inngest and the free plan
// ran out. Now this clock starts them (src/cron/clock.mjs) and each one runs in
// cron-worker-background.mjs, a background function with 15 minutes. Same job ids and schedules;
// the list is CLOCK_JOBS in src/pulse/heartbeats.mjs. Board: ops/workflows/inngest-diet-2026-10-20.md.
//
// THE SCHEDULE IS IN netlify.toml ([functions."cron-clock"] schedule), not a schedule() wrapper
// (that would be a new npm dependency). SWEEP_CRON must say the same; src/cron/clock.test.mjs
// checks it.
//
// DEFAULT EXPORT ONLY (the 4 KB env trap: a named `handler` export makes Netlify treat the file as
// an old Lambda-style function). It returns a 200 Response even when the tick fails: a non-2xx from
// a scheduled function makes Netlify run it again, and the next tick is the retry
// (src/http/scheduled-functions-return.test.mjs).

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { tick } from "../../src/cron/clock.mjs";

/** Every 5 minutes, UTC. Same as netlify.toml. */
export const SWEEP_CRON = "*/5 * * * *";

const json = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" }
});

export default async function cronClock() {
  const result = await tick({ db, env: process.env });
  if (!result.ok) console.error(`[cron-clock] ${result.slot}: ${result.error || JSON.stringify(result.failed)}`);
  else console.log(`[cron-clock] ${result.slot}: started ${result.started} of ${result.due}`);
  await noteScheduledRun(db, "cron-clock", result);
  return json(result);
}
