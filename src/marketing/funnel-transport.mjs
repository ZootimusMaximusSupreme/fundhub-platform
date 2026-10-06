// @ts-check
// Wake the funnel worker (build unit X4): ONE POST to OUR OWN deploy at
// /.netlify/functions/marketing-funnel-background with the owner's own session
// token and { job_id }. Same shape and the same reasons as wakeOfferWorker in
// src/marketing/offer-transport.mjs: the /api function is killed at 26 s, a
// background function runs 15 minutes, and the wake carries the session the
// worker checks exactly the way /api does, so no new secret exists.
//
// Nothing leaves fundhub.ai and no vendor is reached here. The model and
// ClickFunnels calls happen inside the worker, through src/agents/model.mjs and
// src/messaging/providers/clickfunnels-pages.mjs. This module is on
// ALLOWED_RAW_FETCH in src/lib/no-unfenced-transmit.test.mjs for that reason.
//
// Call it AFTER the transaction that saved the job commits. NEVER THROWS.

import { siteBase } from "./offer-transport.mjs";

export const FUNNEL_WORKER_PATH = "/.netlify/functions/marketing-funnel-background";

/**
 * @param {{ jobId: string, token: string|null, env?: Record<string, string|undefined>,
 *           fetchImpl?: Function, timeoutMs?: number }} opts
 * @returns {Promise<{ ok: boolean, status: number|null, reason: string|null }>}
 */
export async function wakeFunnelWorker({ jobId, token, env = process.env, fetchImpl, timeoutMs = 8000 }) {
  const base = siteBase(env);
  if (!base) return { ok: false, status: null, reason: "this site does not know its own address (URL is not set)" };
  if (!token) return { ok: false, status: null, reason: "there was no sign-in to start the worker with" };
  const doFetch = fetchImpl || ((url, init) => globalThis.fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await doFetch(`${base}${FUNNEL_WORKER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ job_id: jobId }),
      signal: controller.signal
    });
    const ok = res.status === 202 || (res.status >= 200 && res.status < 300);
    return { ok, status: res.status, reason: ok ? null : `the worker answered ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, reason: `the worker could not be reached (${String((err && err.message) || err).slice(0, 120)})` };
  } finally {
    clearTimeout(timer);
  }
}
