// The outside watch. Every 5 minutes, on the Netlify clock, ask one question: are the two 5-minute alarms
// (pulse-instant-watch and message-dispatch-sweeper) still ticking? If the workflow engine stalls, Netlify's
// clock does not, so this is the one watcher that is not inside the thing it watches.
//
// WHY. On 2026-10-09 the engine stopped for 46 minutes (2:05 to 2:51 p.m. Arizona) and nothing live said so.
// The hourly beat `engine-alive` catches it within the hour; this runs the SAME beat every 5 minutes so the
// text goes out about 20 minutes into a stall, not up to an hour after.
//
// NO NEW TEXT PATH. It is the hourly runner (src/pulse/runner.mjs) limited to one beat: the same read-only
// box, the same incident record (one open incident, one text, one "fixed" text), the same damping and the
// same texting hours (6 a.m. to 10 p.m. Arizona; a stall found at night is held for the first text of the
// morning). Nothing here saves a customer record, sends to a customer, or emits an event.
//
// THE SCHEDULE IS IN netlify.toml ([functions."pulse-outside-watch"] schedule). SWEEP_CRON must say the same;
// src/pulse/pulse-outside-watch.test.mjs checks it. Default export only (the 4 KB env trap), and it answers 200
// even when the run fails: a non-2xx from a scheduled function makes Netlify run it again, and the next tick
// is the retry (src/http/scheduled-functions-return.test.mjs).
//
// With no DATABASE_URL or no site address it does nothing at all (the no-env child run in that test).

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { runPulse, publicSummary, missingEnv } from "../../src/pulse/runner.mjs";
import { redact } from "../../src/lib/outbound-fetch.mjs";
import { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt, makeLateRejectionHandler, jsonSummary } from "../../src/pulse/scheduled-shell.mjs";

export { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt };

/** Every 5 minutes. Same as netlify.toml. */
export const SWEEP_CRON = "*/5 * * * *";

/** The one beat this clock runs. */
export const BEATS = Object.freeze(["engine-alive"]);

/** A cut beat may reject late; log it without ending this scheduled run. */
export const onLateRejection = makeLateRejectionHandler("pulse-outside-watch");
process.on("unhandledRejection", onLateRejection);

export default async function pulseOutsideWatch() {
  const startedAt = Date.now();
  let result;
  try {
    result = await runPulse({ env: process.env, only: [...BEATS] });
  } catch (err) {
    result = { ok: false, error: redact(String((err && err.message) || err)).slice(0, 200), ran: 0, failed: 0 };
  }
  /* No database address or no site address: the run did nothing, and so does this. No receipt, no connection.
     The line in the log says why; the morning pulse sees the missing receipts (red after 15 minutes). */
  const missing = missingEnv(process.env);
  if (missing.length) console.error(`[pulse-outside-watch] did nothing: missing env ${missing.join(", ")}`);
  else {
    const receipt = await saveReceipt(() => noteScheduledRun(db, "pulse-outside-watch", result), startedAt);
    if (receipt.timedOut) console.error(`[pulse-outside-watch] the receipt took more than ${RECEIPT_MAX_MS} ms and was left behind`);
  }
  const summary = publicSummary(result);
  console.log(`[pulse-outside-watch] ${JSON.stringify(summary)}`);
  return jsonSummary(summary);
}
