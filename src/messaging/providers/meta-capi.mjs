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
// routes here. The public funnel tracker is the only caller.
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
import { cleanIp, isHashed, outboundFbp, sha256 } from "../../meta/user-data.mjs";
import { CONVERSION_SOURCE, isMetaUuid, META_EVENT_NAMES, PUBLIC_META_PAGES } from "../../meta/map.mjs";

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

const USER_DATA_HASHED = ["em", "ph"];
const PUBLIC_SOURCES = PUBLIC_META_PAGES.map(page => "https://apply.fundhub.ai" + page);

function cleanUserData(raw = {}) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  const ip = cleanIp(raw.client_ip_address);
  if (ip) out.client_ip_address = ip;
  if (typeof raw.client_user_agent === "string" && raw.client_user_agent.trim()) {
    out.client_user_agent = raw.client_user_agent.trim().slice(0, 512);
  }
  const fbp = outboundFbp(raw.fbp);
  if (fbp) out.fbp = fbp;
  for (const key of USER_DATA_HASHED) {
    const supplied = Array.isArray(raw[key]) ? raw[key] : [raw[key]];
    const hashes = supplied.filter(isHashed);
    if (hashes.length) out[key] = hashes.slice(0, 5);
  }
  return out;
}

/** Reject old trackers or direct calls which do not match the reviewed wire contract. */
export function sanitizeEvent(ev, { now = Date.now() } = {}) {
  if (!ev || !META_EVENT_NAMES.includes(ev.event_name)) return null;
  const name = ev.event_name;
  const source = ev.event_source_url;
  const id = ev.event_id;
  if (typeof id !== "string" || (name === "ViewContent"
      ? !id.endsWith(".vc") || !isMetaUuid(id.slice(0, -3))
      : !isMetaUuid(id))) return null;
  if (ev.action_source !== undefined && ev.action_source !== "website") return null;
  if (name === "Lead" || name === "Schedule") {
    if (source !== CONVERSION_SOURCE) return null;
  } else if (!PUBLIC_SOURCES.includes(source)) return null;
  const out = {
    event_name: name, event_id: id,
    event_time: Number.isInteger(ev.event_time) && ev.event_time > 0 ? ev.event_time : Math.floor(now / 1000),
    action_source: "website", event_source_url: source, user_data: cleanUserData(ev.user_data)
  };
  // This UUID comes from the linked survey receipt. Browser cookies, session
  // names and arbitrary external_id values are never exported as customer IDs.
  if ((name === "Lead" || name === "Schedule") && isMetaUuid(ev.matchedClientId)) {
    out.user_data.external_id = [sha256(ev.matchedClientId.toLowerCase())];
  }
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
