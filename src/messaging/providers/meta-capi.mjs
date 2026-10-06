// Meta Conversions API — the one server sender for Meta events.
//
// Contract: the "Phase 4 contract" section of docs/tracking/meta-events.md
// ("One sender"). CLAUDE.md §12: outbound transmission lives in
// src/messaging/providers/* and nowhere else, so every request to Meta is in
// this file, and it goes through the chokepoint (src/lib/outbound-fetch.mjs).
//
// THE FENCE IS `ADAPTERS`. A Conversions API call writes a record at a vendor
// (an event on our pixel). It reaches no person. With ADAPTERS_DRY_RUN unset
// or not an off value, every call comes back `blocked` and nothing leaves.
//
// TWO SWITCHES, BOTH REQUIRED: META_CAPI_ENABLED must be exactly "1" (the kill
// switch, set at ship), and the ADAPTERS fence must be down.
//
// NOT IN THE MESSAGE QUEUE. Not registered in providers/index.mjs; no channel
// routes here. Callers: src/meta/track-send.mjs (funnel track events) and,
// later, the payment webhook's server-only Purchase.
//
// NEVER THROWS. Returns { ok, sent, error?, skipped?, blocked? }. `error` is
// Meta's own text (redacted, clipped) when Meta refused.
//
// Never sent: raw email or phone (em / ph / external_id must already be SHA-256
// hex or they are dropped here), card numbers, Social Security number, date of
// birth, survey answers about income or credit, soft-pull field values. Only
// the user_data and custom_data keys listed below leave this file.

import { postJsonTo, ADAPTERS, redact } from "../../lib/outbound-fetch.mjs";
import { getMetaCapiToken } from "../../meta/token.mjs";
import { isHashed } from "../../meta/user-data.mjs";

export const PROVIDER = "meta-capi";
/* Declared so src/lib/no-unfenced-transmit.test.mjs checks that this file goes
   through the fenced HTTP helper. */
export const TRANSMITS = true;

export const DEFAULT_PIXEL_ID = "2403674420141513";
/* v26.0 since 2026-10-05 (marketing machine M0 step 5). The request shape —
   POST /{pixel}/events with data[], access_token and test_event_code at the
   root, and every event and user_data key this file sends — was checked that
   day against Meta's Conversions API parameter pages and the v22 to v26
   changelogs; nothing was removed or renamed. */
export const DEFAULT_API_VERSION = "v26.0";
export const MAX_BATCH = 1000;
export const TIMEOUT_MS = 3000;
const MAX_ERROR = 300;

/** The kill switch: sends only when META_CAPI_ENABLED is exactly "1". */
export function metaCapiEnabled(env = process.env) {
  return env?.META_CAPI_ENABLED === "1";
}

/** https://graph.facebook.com/<META_API_VERSION || v26.0>/<META_PIXEL_ID || 2403674420141513>/events */
export function metaEventsUrl(env = process.env) {
  const v = String(env?.META_API_VERSION ?? "").trim();
  const p = String(env?.META_PIXEL_ID ?? "").trim();
  const version = /^v\d{1,3}\.\d{1,3}$/.test(v) ? v : DEFAULT_API_VERSION;
  const pixel = /^\d{5,25}$/.test(p) ? p : DEFAULT_PIXEL_ID;
  return `https://graph.facebook.com/${version}/${pixel}/events`;
}

// ── what may leave ───────────────────────────────────────────────────────────

const USER_DATA_TEXT = Object.freeze(["client_ip_address", "client_user_agent", "fbc", "fbp"]);
const USER_DATA_HASHED = Object.freeze(["em", "ph", "external_id"]);
const CUSTOM_DATA = Object.freeze({
  value: "number",
  currency: "currency",
  content_name: "text",
  survey: "text",
  step: "number",
  offer: "text",
  video: "text",
  pct: "number",
  businesses: "number",
});

function cleanUserData(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of USER_DATA_TEXT) {
    if (typeof raw[k] === "string" && raw[k].trim()) out[k] = raw[k].trim().slice(0, 512);
  }
  for (const k of USER_DATA_HASHED) {
    const list = (Array.isArray(raw[k]) ? raw[k] : [raw[k]]).filter(isHashed);
    if (list.length) out[k] = list.slice(0, 5);
  }
  return out;
}

function cleanCustomData(raw) {
  if (!raw || typeof raw !== "object") return undefined;
  const out = {};
  for (const [k, type] of Object.entries(CUSTOM_DATA)) {
    const v = raw[k];
    if (type === "number" && typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (type === "currency" && typeof v === "string" && /^[A-Z]{3}$/.test(v)) out[k] = v;
    else if (type === "text" && typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 120);
  }
  return Object.keys(out).length ? out : undefined;
}

/* "website" for anything a browser started (the default). "system_generated"
   for a server-only event with no web session behind it — a Purchase the
   payment webhook sends with no user agent and no page (src/handlers/
   meta-purchase.mjs). Neither requires event_source_url or client_user_agent
   here: each is sent only when the caller has one. */
const ACTION_SOURCES = new Set(["website", "system_generated"]);

const EVENT_NAME = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

/** One event, reduced to what Meta may receive, or null when it is unusable. */
export function sanitizeEvent(ev, { now = Date.now() } = {}) {
  if (!ev || typeof ev !== "object") return null;
  if (!EVENT_NAME.test(String(ev.event_name || ""))) return null;
  if (!EVENT_ID.test(String(ev.event_id || ""))) return null;
  const t = Number.isInteger(ev.event_time) && ev.event_time > 0 ? ev.event_time : Math.floor(now / 1000);
  const out = {
    event_name: ev.event_name,
    event_time: t,
    event_id: ev.event_id,
    action_source: ACTION_SOURCES.has(ev.action_source) ? ev.action_source : "website",
    user_data: cleanUserData(ev.user_data),
  };
  if (typeof ev.event_source_url === "string" && /^https?:\/\//i.test(ev.event_source_url)) {
    out.event_source_url = ev.event_source_url.slice(0, 1000);
  }
  const cd = cleanCustomData(ev.custom_data);
  if (cd) out.custom_data = cd;
  return out;
}

function metaError(res) {
  const m = res?.body?.error;
  const text = m && typeof m === "object" && m.message
    ? `${res.status} ${m.message}${m.error_user_msg ? ` — ${m.error_user_msg}` : ""}`
    : (res?.error || `HTTP ${res?.status ?? 0}`);
  return redact(String(text)).slice(0, MAX_ERROR);
}

/**
 * Send server events to Meta.
 *
 * @param {object[]} events  { event_name, event_time, event_id, event_source_url,
 *                            user_data, custom_data? } — user_data em / ph /
 *                            external_id already SHA-256 hex.
 * @param {object} [opts]    env (defaults to process.env), db (for the stored
 *                            token read), fetchImpl (tests), scope (tests).
 * @returns {Promise<{ok:boolean, sent:number, error?:string, skipped?:string, blocked?:boolean}>}
 */
export async function sendMetaEvents(events, { env = process.env, db, fetchImpl, scope, now = Date.now() } = {}) {
  try {
    if (!metaCapiEnabled(env)) return { ok: true, sent: 0, skipped: "disabled" };

    const data = (Array.isArray(events) ? events : [])
      .map((ev) => sanitizeEvent(ev, { now }))
      .filter(Boolean);
    if (!data.length) return { ok: true, sent: 0, skipped: "no_events" };

    const tok = await getMetaCapiToken({ env, db, scope });
    if (!tok?.token) {
      console.warn(`meta-capi: skipped — ${tok?.reason || "no Meta token"}`);
      return { ok: false, sent: 0, skipped: "no_token", error: tok?.reason || "no Meta token" };
    }

    const url = metaEventsUrl(env);
    const testCode = String(env?.META_TEST_EVENT_CODE ?? "").trim();
    let sent = 0;
    for (let i = 0; i < data.length; i += MAX_BATCH) {
      const chunk = data.slice(i, i + MAX_BATCH);
      const body = { data: chunk, access_token: tok.token };
      if (testCode) body.test_event_code = testCode;
      const res = await postJsonTo(url, {
        body: JSON.stringify(body),
        fence: ADAPTERS,
        env,
        fetchImpl,
        timeoutMs: TIMEOUT_MS,
        what: "meta conversions api"
      });
      if (!res.ok) {
        const out = { ok: false, sent, error: metaError(res) };
        if (res.blocked) out.blocked = true;
        return out;
      }
      const got = res.body?.events_received;
      sent += Number.isInteger(got) ? got : chunk.length;
    }
    return { ok: true, sent };
  } catch (err) {
    return { ok: false, sent: 0, error: redact(String(err?.message || err)).slice(0, MAX_ERROR) };
  }
}

export default { PROVIDER, TRANSMITS, sendMetaEvents, metaCapiEnabled, metaEventsUrl, sanitizeEvent };
