// Run one scheduled job the way Inngest ran it, without Inngest. Then write its receipt.
//
// The job is the same inngest.createFunction() object it always was (src/workflows/scheduled.mjs).
// Its handler is the closure Inngest called — the one that injects the database — read from the
// function object, so the body, the id and the inputs cannot drift from what ran before.
//
// `step` is a small stand-in for Inngest's: step.run(name, fn) runs fn now. Like Inngest, a step
// that throws is tried again on its own (STEP_ATTEMPTS in all) and the steps before it are not
// re-run; its result goes through JSON, as Inngest's memoized result does. No cron here sleeps,
// waits for an event or sends one through step (src/cron/run-job.test.mjs reads the sources), so
// those throw rather than pretend.
//
// The receipt is the same row the Inngest heartbeat add-on wrote (src/pulse/heartbeats.mjs
// heartbeatHooks), with runner 'netlify': error only when the job threw after its retries,
// item count from the job's own result.

import { recordHeartbeat, itemCountOf, SCHEDULED_EVENT } from "../pulse/heartbeats.mjs";

export const STEP_ATTEMPTS = 3;
const BACKOFF_MS = [1000, 3000];

const roundTrip = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

/* makeStep — the stand-in. `wait` is injected so tests do not sleep. */
export function makeStep({ attempts = STEP_ATTEMPTS, wait = (ms) => new Promise((r) => setTimeout(r, ms)), log = console } = {}) {
  const unsupported = (what) => async () => {
    throw new Error(`step.${what} is not supported on the Netlify clock; a cron here must not use it`);
  };
  return {
    async run(name, fn) {
      let lastErr;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          return roundTrip(await fn());
        } catch (err) {
          lastErr = err;
          if (attempt < attempts) {
            log.error?.(`[cron] step "${name}" failed (try ${attempt} of ${attempts}): ${String((err && err.message) || err).slice(0, 200)}`);
            await wait(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)]);
          }
        }
      }
      throw lastErr;
    },
    sleep: unsupported("sleep"),
    sleepUntil: unsupported("sleepUntil"),
    waitForEvent: unsupported("waitForEvent"),
    sendEvent: unsupported("sendEvent"),
    invoke: unsupported("invoke")
  };
}

/** The handler Inngest would have called for this function object. */
export function handlerOf(fn) {
  const handler = fn && fn["fn"];
  if (typeof handler !== "function") throw new Error(`no handler on scheduled job ${fn?.opts?.id || "(unknown)"}`);
  return handler;
}

/** The cron a scheduled function object is registered on. */
export function cronOf(fn) {
  const trigger = (fn?.opts?.triggers || []).find((t) => t && t.cron);
  return trigger ? trigger.cron : null;
}

/* runScheduledJob — run it, write the receipt. NEVER THROWS. Returns { job, ok, itemCount, error }. */
export async function runScheduledJob({ fn, db, slot = null, step = makeStep(), now = () => new Date(), log = console } = {}) {
  const job = fn?.opts?.id;
  const startedAt = now();
  let data;
  let error = null;
  try {
    const handler = handlerOf(fn);
    data = await handler({
      event: { name: SCHEDULED_EVENT, data: { cron: cronOf(fn), slot }, ts: startedAt.getTime() },
      step,
      runId: `netlify-${job}-${slot || startedAt.toISOString()}`,
      attempt: 0,
      logger: log
    });
  } catch (err) {
    error = String((err && err.message) || err).slice(0, 300);
  }
  const itemCount = itemCountOf(data);
  await recordHeartbeat(db, {
    job,
    runner: "netlify",
    startedAt,
    finishedAt: now(),
    outcome: error ? "error" : "ok",
    itemCount,
    error
  });
  if (error) log.error?.(`[cron] ${job} failed: ${error}`);
  else log.log?.(`[cron] ${job} ok${itemCount != null ? ` (${itemCount})` : ""}`);
  return { job, ok: !error, itemCount, error };
}
