// Shared, bounded shell behavior for the hourly pulse and the 5-minute outside watch.
// Business checks and schedules stay in their own files.
import { redact } from "../lib/outbound-fetch.mjs";

/** Leave enough of Netlify's 30-second window for the function to return. */
export const RECEIPT_DEADLINE_MS = 27_000;
export const RECEIPT_MAX_MS = 2_000;

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

export function makeLateRejectionHandler(job) {
  return (reason) => {
    try {
      const message = redact(String((reason && reason.message) || reason || "unknown")).replace(/\s+/g, " ").slice(0, 160);
      console.error(`[${job}] late rejection ignored: ${message}`);
    } catch { /* logging must never throw */ }
  };
}

export function jsonSummary(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
