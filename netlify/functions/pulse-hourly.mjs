// The hourly pulse, shift A. Every hour the system tests itself on purpose and texts Chris if a step does not come back.
//
// SHIFTS (ops/workflows/hourly-beats-capacity-2026-10-14.md, fixes 3 and 4). The beats are split between this function
// (minute 7), netlify/functions/pulse-hourly-b.mjs (minute 37) and netlify/functions/pulse-hourly-c.mjs (minute 52),
// so each run fits its 13 s beat window and 22 s budget. Which beat runs where is ONE literal list,
// src/pulse/beats/shifts.mjs; every beat is in exactly one shift. This file runs only its own shift (`only`), through
// the same runner as shifts B and C.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md): the READ-ONLY half. Every beat reads data through one
// READ ONLY box and reads the web with GET and HEAD. Nothing here saves a customer record, sends to a customer,
// or emits an event. The logic is src/pulse/runner.mjs; this file is the shell.
//
// THE SCHEDULE IS IN netlify.toml ([functions."pulse-hourly"] schedule), not a schedule() wrapper (that would be a
// new npm dependency). SWEEP_CRON must say the same; src/pulse/pulse-hourly.test.mjs checks it. Minute 7, not
// minute 0: three Inngest jobs already fire at minute 0.
//
// DEFAULT EXPORT ONLY. A named `handler` export makes Netlify treat the file as an old Lambda-style function, and
// those fail to deploy once the site's variables pass 4 KB. It answers 200 even when the run fails: a non-2xx from a
// scheduled function makes Netlify run it again (twice), and the next hour is the retry
// (src/http/scheduled-functions-return.test.mjs).
//
// WITH NO DATABASE_URL OR NO SITE ADDRESS IT DOES NOTHING ELSE: no beat, no network, no database. That is the
// no-env child run in the scheduled-functions test, and it is what a misconfigured deploy looks like.
//
// A LATE REJECTION MUST NEVER KILL THE RUN (critic issue 2). A beat that was cut at its deadline can still have a
// promise in flight; on Node 22 a rejection nobody caught ends the process, and with it the text and the records.
// process.on("unhandledRejection") below logs a redacted message and carries on.
//
// No "pg" or "@pdf-lib/fontkit" import is needed: pg rides in through src/db.mjs (listed in external_node_modules in
// netlify.toml), and this graph never reaches the letter generator. `npm run pulse:prove -- --beats` loads this
// function from a built zip to prove it.

import { db } from "../../src/db.mjs";
import { noteScheduledRun } from "../../src/pulse/heartbeats.mjs";
import { runPulse, publicSummary, missingEnv } from "../../src/pulse/runner.mjs";
import { shiftBeats } from "../../src/pulse/beats/shifts.mjs";
import { redact } from "../../src/lib/outbound-fetch.mjs";
import { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt, makeLateRejectionHandler, jsonSummary } from "../../src/pulse/scheduled-shell.mjs";

export { RECEIPT_DEADLINE_MS, RECEIPT_MAX_MS, saveReceipt };

/** Hourly at minute 7, UTC. Same as netlify.toml and as this shift's cron in src/pulse/beats/shifts.mjs. */
export const SWEEP_CRON = "7 * * * *";

/** The beats this function runs: shift A of src/pulse/beats/shifts.mjs. */
export const BEATS = shiftBeats("pulse-hourly");

/** A cut beat may reject late; log it without ending this scheduled run. */
export const onLateRejection = makeLateRejectionHandler("pulse-hourly");
process.on("unhandledRejection", onLateRejection);

export default async function pulseHourly() {
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
  if (missing.length) console.error(`[pulse-hourly] did nothing: missing env ${missing.join(", ")}`);
  else {
    const receipt = await saveReceipt(() => noteScheduledRun(db, "pulse-hourly", result), startedAt);
    if (receipt.timedOut) console.error(`[pulse-hourly] the receipt took more than ${RECEIPT_MAX_MS} ms and was left behind`);
  }
  const summary = publicSummary(result);
  console.log(`[pulse-hourly] ${JSON.stringify(summary)}`);
  return jsonSummary(summary);
}
