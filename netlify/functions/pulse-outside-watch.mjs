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

/** Every 5 minutes. Same as netlify.toml. */
export const SWEEP_CRON = "*/5 * * * *";

/** The one beat this clock runs. */
export const BEATS = Object.freeze(["engine-alive"]);

/** What the process does with a promise nobody caught: say so (redacted) and carry on. Never throws. */
export function onLateRejection(reason) {
  try {
    const text = redact(String((reason && reason.message) || reason || "unknown")).replace(/\s+/g, " ").slice(0, 160);
    console.error(`[pulse-outside-watch] late rejection ignored: ${text}`);
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
  return json(summary);
}
