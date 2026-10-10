// The hourly pulse. Every hour the system tests itself on purpose and texts Chris if a step does not come back.
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
import { redact } from "../../src/lib/outbound-fetch.mjs";

/** Hourly at minute 7, UTC. Same as netlify.toml. */
export const SWEEP_CRON = "7 * * * *";

/** What the process does with a promise nobody caught: say so (redacted) and carry on. Never throws. */
export function onLateRejection(reason) {
  try {
    const text = redact(String((reason && reason.message) || reason || "unknown")).replace(/\s+/g, " ").slice(0, 160);
    console.error(`[pulse-hourly] late rejection ignored: ${text}`);
  } catch { /* logging must never throw */ }
}
process.on("unhandledRejection", onLateRejection);

const json = (body) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" }
});

/** Netlify cuts a scheduled function at 30 s and then runs it again. The receipt must never be the reason. */
export const RECEIPT_DEADLINE_MS = 27_000;
export const RECEIPT_MAX_MS = 2_000;

/**
 * Save the receipt with a time cap: about 2 s, and never past 27 s from entry. A hung database must not hold the
 * function past 30 s (that makes Netlify run it again, and a retry after a lost record would text twice).
 * `write` is a function that returns the receipt promise. Never throws; resolves { saved, timedOut, ms }.
 */
export async function saveReceipt(write, startedAt, now = Date.now) {
  const room = Math.max(300, Math.min(RECEIPT_MAX_MS, RECEIPT_DEADLINE_MS - (now() - startedAt)));
  const t = now();
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), room); });
  try {
    const r = await Promise.race([Promise.resolve().then(write).then(() => "saved", () => "failed"), timeout]);
    return { saved: r === "saved", timedOut: r === "timeout", ms: now() - t };
  } finally {
    clearTimeout(timer);
  }
}

export default async function pulseHourly() {
  const startedAt = Date.now();
  let result;
  try {
    result = await runPulse({ env: process.env });
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
  return json(summary);
}
