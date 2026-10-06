// @ts-check
// Wake the marketing worker after a save.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 2 ("every save writes
// its outbox row in the same transaction as the database change, then wakes
// the worker") and Step 4 (the worker is a 15-minute background function,
// netlify/functions/marketing-worker-background.mjs, built in U22).
//
// ONE raw POST to OUR OWN deploy: `${URL or DEPLOY_URL}/.netlify/functions/
// marketing-worker-background`, with the header x-fundhub-worker set to
// MARKETING_WORKER_SECRET. Nothing leaves fundhub.ai and no vendor is reached;
// the vendor calls (GitHub, Meta, Anthropic) happen inside the worker, through
// src/messaging/providers/* and the fence. That is why this file is on
// ALLOWED_RAW_FETCH in src/lib/no-unfenced-transmit.test.mjs, the same way
// netlify/functions/ad-video-sweeper.mjs is.
//
// Call it AFTER the caller's transaction commits, never inside it: a wake is a
// network call, and no transaction is held across one (spec §4 trap 3).
//
// No secret (unset, empty or masked) → a no-op that says so. The clock wakes
// the worker anyway, so a missed wake only means the save waits for the next
// tick. NEVER THROWS.

export const WORKER_PATH = "/.netlify/functions/marketing-worker-background";
export const WAKE_TIMEOUT_MS = 8000;

/** The shared secret, or null when it is missing or masked. */
export function workerSecret(env = process.env) {
  const s = String(env?.MARKETING_WORKER_SECRET ?? "").trim();
  return s && !s.includes("*") ? s : null;
}

/** This deploy's own address, without a trailing slash. */
export function siteBase(env = process.env) {
  return String(env?.URL || env?.DEPLOY_URL || "").trim().replace(/\/+$/, "");
}

/**
 * @param {object} [env]  process.env by default.
 * @param {{fetchImpl?:Function, timeoutMs?:number}} [opts]
 * @returns {Promise<{ok:boolean, started:boolean, status:number|null, skipped?:string, reason:string|null}>}
 *   A background function answers 202 the moment Netlify accepts it; that is
 *   all this waits for.
 */
export async function wakeWorker(env = process.env, { fetchImpl, timeoutMs = WAKE_TIMEOUT_MS } = {}) {
  const secret = workerSecret(env);
  if (!secret) {
    return { ok: true, started: false, status: null, skipped: "no_secret", reason: "MARKETING_WORKER_SECRET is not set" };
  }
  const base = siteBase(env);
  if (!base) {
    return { ok: false, started: false, status: null, skipped: "no_url", reason: "this site does not know its own address (URL is not set)" };
  }
  const doFetch = fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || WAKE_TIMEOUT_MS));
  try {
    const res = await doFetch(`${base}${WORKER_PATH}`, {
      method: "POST",
      headers: { "x-fundhub-worker": secret },
      signal: controller.signal
    });
    const started = res.status === 202 || (res.status >= 200 && res.status < 300);
    return { ok: started, started, status: res.status, reason: started ? null : `the worker answered ${res.status}` };
  } catch (err) {
    return {
      ok: false, started: false, status: null,
      reason: `the worker could not be reached (${String((err && err.message) || err).slice(0, 120)})`
    };
  } finally {
    clearTimeout(timer);
  }
}

export default wakeWorker;
