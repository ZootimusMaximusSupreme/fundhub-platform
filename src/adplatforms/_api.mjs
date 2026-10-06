// Shared HTTP for the ad platform adapters.
//
// THE PLATFORM'S OWN MESSAGE SURVIVES. Every error carries `platformMessage`
// holding what the platform actually said, extracted from whichever envelope it
// used. That string goes into last_error and onto the dashboard, because a policy
// rejection reworded by us is a policy rejection the partner cannot act on — and
// "campaign creation failed" is exactly that rewording.
//
// THE TOKEN NEVER SURVIVES. It is scrubbed from every message before it can reach
// last_error, which the read APIs project.

import { createHash } from "node:crypto";

/* ── BACKING OFF ─────────────────────────────────────────────────────────────
   Meta throttles per business and per ad account. Two signals, both from
   Meta's own rate-limit pages (Graph API "Rate Limits" and Marketing API
   "Rate Limiting", read 2026-10-05):

     1. THE USAGE HEADER. Every BUC-limited answer carries
        x-business-use-case-usage: {"<business id>": [{type, call_count,
        total_cputime, total_time, estimated_time_to_regain_access}]}.
        The three counts are percentages of the hour's allowance;
        estimated_time_to_regain_access is in MINUTES. Past 75% we slow down
        before the next call to the same connection, harder the closer it is to
        100. A non-zero regain time means Meta is already refusing us, so we
        wait that long.

     2. THE THROTTLE CODES. 4 (app), 17 (user / ad account), 32 (Page),
        613 (calls to this API) and 80004 (calls to this ad account). Meta
        refuses these BEFORE doing anything, so asking again after a pause is
        safe even for a POST. Plus 429 and TikTok's 40100, as before.

   WHAT IS NOT RETRIED HERE. A 5xx or a dropped connection on a POST may have
   created the object before it failed, so a second POST could make a second
   ad. Those stay `retryable` for the caller (which saves each Meta id as soon
   as Meta returns it) and are never repeated inside this function. A GET is
   repeated, because reading twice changes nothing.

   BOUNDED. At most MAX_RETRIES repeats, and no single pause longer than
   MAX_WAIT_MS — the sync runs inside a 26-second function. When Meta asks for a
   longer pause than that, nothing is sent: the error carries `retryAfterMs` and
   the caller's job queue comes back later. */
export const META_THROTTLE_CODES = Object.freeze([4, 17, 32, 613, 80004]);
export const USAGE_BACKOFF_PERCENT = 75;
export const MAX_RETRIES = 2;
export const BASE_BACKOFF_MS = 2000;
export const MAX_WAIT_MS = 10000;

/* Per connection, the moment the next call may go out. Keyed by the platform
   host and a hash of the token — never the token itself. Lives as long as the
   function instance, which is exactly the span one worker run makes calls in. */
const COOLDOWN = new Map();

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cooldownKey(url, token) {
  let host = "";
  try { host = new URL(url).host; } catch { host = String(url).slice(0, 64); }
  const tokenHash = createHash("sha256").update(String(token ?? "")).digest("hex").slice(0, 16);
  return `${host}#${tokenHash}`;
}

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === "function") return headers.get(name);
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === wanted) return v;
  return null;
}

/* readBusinessUseCaseUsage(headers) → { percent, regainMinutes }

   percent        — the highest of call_count, total_cputime and total_time
                    across every business and type in the header, or null when
                    there is no readable header (TikTok, older fakes).
   regainMinutes  — the longest estimated_time_to_regain_access, or null. */
export function readBusinessUseCaseUsage(headers) {
  const raw = headerValue(headers, "x-business-use-case-usage");
  if (!raw) return { percent: null, regainMinutes: null };
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { return { percent: null, regainMinutes: null }; }
  let percent = null;
  let regainMinutes = null;
  for (const entries of Object.values(parsed || {})) {
    for (const e of Array.isArray(entries) ? entries : [entries]) {
      if (!e || typeof e !== "object") continue;
      for (const k of ["call_count", "total_cputime", "total_time"]) {
        const n = Number(e[k]);
        if (Number.isFinite(n)) percent = percent === null ? n : Math.max(percent, n);
      }
      const r = Number(e.estimated_time_to_regain_access);
      if (Number.isFinite(r)) regainMinutes = regainMinutes === null ? r : Math.max(regainMinutes, r);
    }
  }
  return { percent, regainMinutes };
}

/* usagePauseMs(usage) → how long to wait before the NEXT call, from the header.
   0 at or under 75%. Over it, a ramp from BASE_BACKOFF_MS at 75% to
   MAX_WAIT_MS at 100%. A regain time from Meta wins when it is longer. */
export function usagePauseMs({ percent, regainMinutes } = {}, { base = BASE_BACKOFF_MS, maxWait = MAX_WAIT_MS } = {}) {
  let ms = 0;
  if (percent !== null && percent !== undefined && percent > USAGE_BACKOFF_PERCENT) {
    const over = Math.min(1, (percent - USAGE_BACKOFF_PERCENT) / (100 - USAGE_BACKOFF_PERCENT));
    ms = Math.round(base + over * (maxWait - base));
  }
  if (regainMinutes && regainMinutes > 0) ms = Math.max(ms, regainMinutes * 60_000);
  return ms;
}

/* retryPauseMs(attempt, usage) → the pause before repeat number `attempt`
   (0-based): BASE, 2×BASE, … , never shorter than what the header asks for. */
export function retryPauseMs(attempt, usage = {}, { base = BASE_BACKOFF_MS, maxWait = MAX_WAIT_MS } = {}) {
  return Math.max(base * 2 ** attempt, usagePauseMs(usage, { base, maxWait }));
}

/* isThrottle — Meta (or TikTok) said "slow down" about THIS call: a 429, a
   throttle code, or a regain time in the header. A usage percent alone does not
   count: a real rejection (code 100, Invalid parameter) that happens to arrive
   while the header reads 100% would only come back the same, and repeating it
   spends calls on an account that is already at its limit. The percent still
   slows the NEXT call down (usagePauseMs). */
export function isThrottle({ status, code, usage = {} } = {}) {
  return status === 429 ||
    META_THROTTLE_CODES.includes(Number(code)) ||
    Number(code) === 40100 ||
    (usage.regainMinutes ?? 0) > 0;
}

/* Test hook: forget every remembered pause. */
export function resetBackoff() { COOLDOWN.clear(); }

function slowDownError(waitMs) {
  const minutes = Math.max(1, Math.ceil(waitMs / 60_000));
  const e = new Error(`platform asked us to slow down; nothing sent, try again in about ${minutes} minute(s)`);
  e.platformMessage = `Meta asked us to slow down. Nothing was sent. Try again in about ${minutes} minute(s).`;
  e.retryable = true;
  e.retryAfterMs = waitMs;
  e.throttled = true;
  return e;
}

/* callPlatform → parsed body, or throws an Error carrying:
     platformMessage — the platform's own words
     platformCode    — its error code, when it gives one
     retryable       — rate limits and 5xx
     retryAfterMs    — set when the platform asked for a pause longer than we
                       will hold a function open for
     status          — the HTTP status

   ctx (all optional): fetch, sleep(ms), now() → ms, maxRetries, baseBackoffMs,
   maxWaitMs, cooldown (a Map, for tests). */
export async function callPlatform({ url, token, body, ctx = {}, method = "POST" }) {
  const doFetch = ctx.fetch || globalThis.fetch;
  if (typeof doFetch !== "function") throw new Error("no fetch available");
  const sleep = typeof ctx.sleep === "function" ? ctx.sleep : defaultSleep;
  const now = typeof ctx.now === "function" ? ctx.now : Date.now;
  const maxRetries = Number.isInteger(ctx.maxRetries) ? ctx.maxRetries : MAX_RETRIES;
  const base = Number.isFinite(ctx.baseBackoffMs) ? ctx.baseBackoffMs : BASE_BACKOFF_MS;
  const maxWait = Number.isFinite(ctx.maxWaitMs) ? ctx.maxWaitMs : MAX_WAIT_MS;
  const cooldown = ctx.cooldown instanceof Map ? ctx.cooldown : COOLDOWN;
  const key = cooldownKey(url, token);
  const isRead = String(method).toUpperCase() === "GET";

  for (let attempt = 0; ; attempt++) {
    // ---- 0. A pause the last answer asked for -----------------------------
    const until = cooldown.get(key) || 0;
    const wait = until - now();
    if (wait > 0) {
      if (wait > maxWait) throw slowDownError(wait);
      await sleep(wait);
    }

    try {
      return await callOnce({ url, token, body, method, doFetch, cooldown, key, now, base, maxWait });
    } catch (e) {
      const repeatable = e.throttled || (isRead && e.retryable);
      if (!repeatable || attempt >= maxRetries) throw e;
      const pause = retryPauseMs(attempt, e.usage || {}, { base, maxWait });
      if (pause > maxWait) { e.retryAfterMs = pause; throw e; }
      await sleep(pause);
    }
  }
}

async function callOnce({ url, token, body, method, doFetch, cooldown, key, now, base, maxWait }) {
  let res;
  try {
    res = await doFetch(url, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    const e = new Error(`platform unreachable: ${scrub(String(err?.message || err), token)}`);
    e.platformMessage = "The platform could not be reached.";
    e.retryable = true;
    throw e;
  }

  // Remember how hard we are leaning on Meta, success or not, so the NEXT call
  // to this connection waits before it goes out.
  const usage = readBusinessUseCaseUsage(res.headers);
  const pause = usagePauseMs(usage, { base, maxWait });
  if (pause > 0) cooldown.set(key, now() + pause);

  const text = await res.text().catch(() => "");
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : {}; } catch { /* keep the raw text */ }

  if (!res.ok) {
    const { message, code, subcode } = extractError(parsed, text);
    const e = new Error(scrub(`platform ${res.status}: ${message}`, token));
    // The verbatim message, for last_error and the dashboard.
    e.platformMessage = scrub(message, token);
    e.platformCode = code ?? null;
    e.platformSubcode = subcode ?? null;
    e.status = res.status;
    e.usage = usage;
    // Throttles (see META_THROTTLE_CODES) and 5xx. 4xx otherwise is a real
    // rejection and retrying it just repeats the same failure.
    e.throttled = isThrottle({ status: res.status, code, usage });
    e.retryable = e.throttled || res.status >= 500;
    throw e;
  }

  // TikTok returns 200 with a non-zero `code` on failure — an HTTP-status-only
  // check would read a policy rejection as a success.
  if (parsed && typeof parsed.code === "number" && parsed.code !== 0) {
    const e = new Error(scrub(`platform error ${parsed.code}: ${parsed.message}`, token));
    e.platformMessage = scrub(parsed.message || "unknown platform error", token);
    e.platformCode = parsed.code;
    e.retryable = parsed.code === 40100;
    throw e;
  }

  return parsed ?? {};
}

/* extractError — pull the human-readable message out of whichever envelope the
   platform used. Falls back to the raw body rather than to a generic string:
   an unrecognised shape is still more useful to a partner than "request failed". */
export function extractError(parsed, rawText) {
  if (parsed?.error) {
    return {
      message: parsed.error.error_user_msg || parsed.error.message || JSON.stringify(parsed.error),
      code: parsed.error.code,
      subcode: parsed.error.error_subcode
    };
  }
  if (parsed?.message) return { message: parsed.message, code: parsed.code };
  return { message: String(rawText || "unknown platform error").slice(0, 1000) };
}

export function scrub(text, token) {
  let out = String(text ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out
    .replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, "Bearer [redacted]")
    .replace(/access_token=[^&\s"']+/gi, "access_token=[redacted]");
}
