// The hourly pulse, shift C. A quarter hour after shift B (netlify/functions/pulse-hourly-b.mjs), the third share of
// the beats.
//
// WHY A THIRD FUNCTION (ops/workflows/hourly-beats-capacity-2026-10-14.md, fix 4). One run gives the beats three
// read boxes for 13 s inside a 22 s budget, and Netlify cuts the function at about 30 s. Two shifts were not enough
// once 37 beats (and 6 more waiting) landed, so there are three. Which beat runs where is ONE literal list,
// src/pulse/beats/shifts.mjs; every beat is in exactly one shift, so each beat still runs once an hour.
//
// NO NEW TEXT PATH. It is the hourly runner (src/pulse/runner.mjs) limited to this shift's beats: the same three
// READ ONLY boxes, GET and HEAD only, the same incident record (one open incident per beat, one text, one "fixed"
// text), the same damping and the same texting hours (6 a.m. to 10 p.m. Arizona; a break found at night is held for
// the first text of the morning). Nothing here saves a customer record, sends to a customer, or emits an event.
//
// THE SCHEDULE IS IN netlify.toml ([functions."pulse-hourly-c"] schedule). SWEEP_CRON must say the same, and so
// must this shift's cron in shifts.mjs; src/pulse/pulse-hourly-c.test.mjs checks both. Minute 52: 15 minutes after
// shift B and 15 before shift A, and not a multiple of 5, so it never starts on the same minute as the 5-minute jobs.
//
// DEFAULT EXPORT ONLY (the 4 KB env trap), and it answers 200 even when the run fails: a non-2xx from a scheduled
// function makes Netlify run it again, and the next hour is the retry (src/http/scheduled-functions-return.test.mjs).
//
// With no DATABASE_URL or no site address it does nothing at all (the no-env child run in that test).
//
// A late rejection from a cut beat is logged (redacted) and never ends the process (critic issue 2).

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { runPulse, publicSummary, missingEnv } from "../../src/pulse/runner.mjs";
import { shiftBeats } from "../../src/pulse/beats/shifts.mjs";
import { redact } from "../../src/lib/outbound-fetch.mjs";
import { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt, makeLateRejectionHandler, jsonSummary } from "../../src/pulse/scheduled-shell.mjs";

export { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt };

/** Hourly at minute 52, UTC. Same as netlify.toml and as this shift's cron in src/pulse/beats/shifts.mjs. */
export const SWEEP_CRON = "52 * * * *";

/** The beats this function runs: shift C of src/pulse/beats/shifts.mjs. */
export const BEATS = shiftBeats("pulse-hourly-c");

/** A cut beat may reject late; log it without ending this scheduled run. */
export const onLateRejection = makeLateRejectionHandler("pulse-hourly-c");
process.on("unhandledRejection", onLateRejection);

export default async function pulseHourlyC() {
  const startedAt = Date.now();
  let result;
  try {
    result = await runPulse({ env: process.env, only: [...BEATS] });
  } catch (err) {
    result = { ok: false, error: redact(String((err && err.message) || err)).slice(0, 200), ran: 0, failed: 0 };
  }
  /* No database address or no site address: the run did nothing, and so does this. No receipt, no connection.
     The line in the log says why; the morning pulse sees the missing receipts (red after 3 hours). */
  const missing = missingEnv(process.env);
  if (missing.length) console.error(`[pulse-hourly-c] did nothing: missing env ${missing.join(", ")}`);
  else {
    const receipt = await saveReceipt(() => noteScheduledRun(db, "pulse-hourly-c", result), startedAt);
    if (receipt.timedOut) console.error(`[pulse-hourly-c] the receipt took more than ${RECEIPT_MAX_MS} ms and was left behind`);
  }
  const summary = publicSummary(result);
  console.log(`[pulse-hourly-c] ${JSON.stringify(summary)}`);
  return jsonSummary(summary);
}
