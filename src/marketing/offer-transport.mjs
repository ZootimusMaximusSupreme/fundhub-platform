// The two calls the offer generator makes off this machine, and nothing else.
//
//   askAnthropic()     — one model call through the repo's own client,
//                        src/agents/model.mjs callModel(). Forced to Anthropic
//                        and bounded by a timer we own.
//   wakeOfferWorker()  — one POST to OUR OWN deploy, to start the 15-minute
//                        background function that does the writing.
//
// WHY ANTHROPIC IS FORCED. callModel() tries OpenAI first whenever an OpenAI key
// is set, and production's OpenAI account had no credit when measured
// 2026-09-18 (api/social/generate.mjs callWriter). It also swaps any non-gpt
// model name for gpt-4o-mini. So callModel is handed an environment holding the
// Anthropic key and nothing else — the same trick src/ad-videos/match.mjs uses.
// The stored keys are not touched (CLAUDE.md §11).
//
// WHY A BACKGROUND FUNCTION AT ALL. The rubric is three model calls in a row,
// six offers then four judges then a write-up, a few minutes of writing. The
// /api function is killed at 26 seconds (measured 2026-09-23, see
// netlify/functions/ad-video-worker-background.mjs). A background function gets
// 15 minutes. So the endpoint saves a queued job and wakes the worker; the
// worker writes and saves the result; the dashboard reads it back.
//
// WHY THERE IS NO NEW SECRET. The wake carries the owner's own session token,
// and the worker checks it exactly the way /api does (verifySession, then the
// owner/admin role). Calling the worker URL directly therefore buys nothing the
// endpoint does not already allow, and no new key has to be set anywhere.
//
// This module is on ALLOWED_RAW_FETCH in src/lib/no-unfenced-transmit.test.mjs:
// neither call can reach a client or change a vendor record.

import { callModel } from "../agents/model.mjs";

/** The model the offer is written with. The current Opus (claude-api skill, 2026-10). */
export const OFFER_MODEL = "claude-opus-5-5";

/** Where the background worker answers on our own deploy. */
export const WORKER_PATH = "/.netlify/functions/marketing-offer-background";

/** A masked key ("****abcd") is not a key (src/agents/model.mjs isMasked). */
export function anthropicKeyOf(env = process.env) {
  const key = env && env.ANTHROPIC_API_KEY;
  if (!key || String(key).includes("*")) return null;
  return String(key);
}

const defaultFetch = (url, init) => globalThis.fetch(url, init);

/**
 * askAnthropic({ system, user, maxTokens, timeoutMs }) →
 *   { text, error, status, mode, usage, model, stopReason, timedOut }
 *
 * Never throws. A timeout aborts the request itself (not just the wait), so a
 * slow answer cannot keep the worker alive past its own limit.
 */
export async function askAnthropic({
  system, user, maxTokens = 24000, timeoutMs = 270_000,
  env = process.env, model = OFFER_MODEL, fetchImpl = defaultFetch, call = callModel
} = {}) {
  const key = anthropicKeyOf(env);
  if (!key) {
    return { text: null, error: null, status: null, mode: "shadow", usage: { input_tokens: 0, output_tokens: 0 }, model, stopReason: null, timedOut: false };
  }
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, Math.max(1000, timeoutMs));
  try {
    const out = await call({
      system,
      user,
      env: { ANTHROPIC_API_KEY: key },
      model,
      maxTokens,
      fetchImpl: (url, init) => fetchImpl(url, { ...init, signal: controller.signal })
    });
    return {
      text: out.text || null,
      error: out.error || null,
      status: out.status ?? null,
      mode: out.mode,
      usage: out.usage || { input_tokens: 0, output_tokens: 0 },
      model: (out.request && out.request.model) || model,
      stopReason: (out.raw && out.raw.stop_reason) || null,
      timedOut
    };
  } finally {
    clearTimeout(timer);
  }
}

/** The site's own address, the same way ad-video-sweeper.mjs finds it. */
export function siteBase(env = process.env) {
  return String((env && (env.URL || env.DEPLOY_URL)) || "").replace(/\/+$/, "");
}

/**
 * wakeOfferWorker({ jobId, token }) → { ok, status, reason }
 * A background function answers 202 the moment Netlify accepts it and keeps
 * running on its own; that 202 is all this waits for. Never throws.
 */
export async function wakeOfferWorker({
  jobId, token, env = process.env, fetchImpl = defaultFetch, timeoutMs = 8000
} = {}) {
  const base = siteBase(env);
  if (!base) return { ok: false, status: null, reason: "this site does not know its own address (URL is not set)" };
  if (!token) return { ok: false, status: null, reason: "there was no sign-in to start the writer with" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetchImpl(`${base}${WORKER_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ job_id: jobId }),
      signal: controller.signal
    });
    const ok = res.status === 202 || (res.status >= 200 && res.status < 300);
    return { ok, status: res.status, reason: ok ? null : `the writer answered ${res.status}` };
  } catch (err) {
    return { ok: false, status: null, reason: `the writer could not be reached (${String(err && err.message || err).slice(0, 120)})` };
  } finally {
    clearTimeout(timer);
  }
}
