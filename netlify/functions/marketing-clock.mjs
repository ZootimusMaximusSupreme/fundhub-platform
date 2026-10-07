// The marketing machine's clock. Every 15 minutes: look for waiting work, wake the worker.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 and §4 traps 5-6. Plan unit
// U22. A SCHEDULED function is killed at 30 seconds, so this only reads the database,
// writes the 'clock' heartbeat and wakes the 15-minute background worker
// (marketing-worker-background.mjs). The logic is src/marketing/clock.mjs; this file is
// the shell.
//
// THE SCHEDULE IS IN netlify.toml ([functions."marketing-clock"] schedule), not a
// schedule() wrapper (that would be a new npm dependency). SWEEP_CRON must say the same;
// src/marketing/clock.test.mjs checks it.
//
// DEFAULT EXPORT ONLY. A named `handler` export makes Netlify treat the file as an old
// Lambda-style function, and those fail to deploy once the site's variables pass 4 KB.
// It returns a 200 Response even when the tick fails: a non-2xx from a scheduled
// function makes Netlify run it again, and the next tick is the retry
// (src/http/scheduled-functions-return.test.mjs).

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { tick } from "../../src/marketing/clock.mjs";

/** Every 15 minutes, UTC. Same as netlify.toml and CLOCK_CRON in src/marketing/clock.mjs. */
export const SWEEP_CRON = "*/15 * * * *";

const json = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { "content-type": "application/json" }
});

export default async function marketingClock() {
  try {
    const result = await tick({ db, env: process.env });
    await noteScheduledRun(db, "marketing-clock", result);
    return json(result);
  } catch (err) {
    const error = String((err && err.message) || err).replace(/\s+/g, " ").slice(0, 300);
    console.error(`[marketing-clock] tick failed: ${error}`);
    await noteScheduledRun(db, "marketing-clock", { ok: false, error });
    return json({ ok: false, error });
  }
}
