// The long half of the cron clock: runs ONE scheduled job, then writes its receipt.
//
// cron-clock.mjs (a scheduled function, killed at 30 seconds) starts this once per due job. A
// background function gets 15 minutes, so a job here is no longer cut at Inngest's 26-second
// request. Netlify answers the clock 202 at once and this keeps running.
//
// THIS IS AN OPEN URL, so it checks the clock's signature (src/cron/clock.mjs verifyStart): an
// HMAC of "job|slot" with CRON_WORKER_SECRET, for a fresh slot. Anything else gets 401 and runs
// nothing.
//
// The job is the same Inngest function object it always was (src/workflows/scheduled.mjs); it is
// run with src/cron/run-job.mjs, which writes job_heartbeats with runner 'netlify' under the job's
// own id. Handlers and repair handlers are put on the event bus first, as the HTTP router does
// before /api/inngest runs a job: a job that emits an event must reach the local handlers.

/* Keep fontkit in THIS function's zip — the same line api.mjs and commas-inbox-sweeper.mjs carry.
   register-all reaches vendor/underwriteiq-full/api/lite/letter-generator.js, which require()s
   @pdf-lib/fontkit at load. Without this line the bundler leaves it out and every run dies at
   load ("Cannot find module '@pdf-lib/fontkit'", live 2026-09-17). */
import "@pdf-lib/fontkit";
import { db } from "../../src/db.mjs";
import { AUTH_HEADER, verifyStart } from "../../src/cron/clock.mjs";
import { runScheduledJob } from "../../src/cron/run-job.mjs";
import { scheduled } from "../../src/workflows/scheduled.mjs";
import { ensureRegistered } from "../../src/register-all.mjs";
import { registerRepairHandlers } from "../../src/repair/register.mjs";

export function makeHandler({
  database = db,
  env = process.env,
  jobs = scheduled,
  run = runScheduledJob,
  register = () => { ensureRegistered(); registerRepairHandlers(); },
  now = () => new Date()
} = {}) {
  return async function cronWorker(req) {
    let body = {};
    try { body = await req.json(); } catch { body = {}; }
    const job = body && typeof body.job === "string" ? body.job : "";
    const slot = body && typeof body.slot === "string" ? body.slot : "";
    const signature = req?.headers?.get ? req.headers.get(AUTH_HEADER) : null;
    const check = verifyStart({ secret: env.CRON_WORKER_SECRET || "", signature, job, slot, now: now() });
    if (!check.ok) {
      console.error(`[cron-worker] refused a start: ${check.why}`);
      return new Response("unauthorized", { status: 401 });
    }
    const fn = jobs.find((f) => f?.opts?.id === job);
    if (!fn) {
      console.error(`[cron-worker] no scheduled job named "${job}"`);
      return new Response("unknown job", { status: 404 });
    }
    register();
    const result = await run({ fn, db: database, slot });
    return new Response(JSON.stringify(result), { status: 202, headers: { "content-type": "application/json" } });
  };
}

export default makeHandler();
