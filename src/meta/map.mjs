// Our funnel events → Meta events.
//
// Contract: the "Map (database event → Meta)" table in the "Phase 4 contract"
// section of docs/tracking/meta-events.md. META_MAP below is that table, row for
// row and in the same order; src/meta/map.test.mjs reads the table out of the
// doc and fails if the two drift.
//
// Only the events in the table go to Meta. Every other track event maps to
// nothing.
//
// event_id (dedupe with the browser pixel): the browser sends `meta_event_id`
// with each post that stands for a Meta event, and the server uses exactly
// that id, so Meta counts the browser copy and the server copy once.
//
// NO meta_event_id, NO META SEND. The browser attaches the id only after its
// once-rules (public/funnel/fh-events.js): InitiateCheckout once per session,
// Purchase once per order_ref, ReachedBuyBox once per page load, PageView /
// ViewContent per page load. A row without one is a repeat (a second success,
// a second buy-box view) or an older page, and sending it under a made-up id
// would count it twice.
//
// PURCHASE HAS ONE SERVER COPY, AND IT IS NOT THIS ONE (2026-10-05). The
// browser fires Purchase "purchase.<order_ref>" on checkout:success, and the
// payment webhook (src/handlers/meta-purchase.mjs) sends the server copy under
// the same id when the money clears. Meta promises to drop a server event that
// matches a browser event (same event_name + event_id, within 48 hours); it
// does NOT promise to drop a second SERVER event with the same id ("Handling
// Duplicate Pixel and Conversions API Events", developers.facebook.com). So the
// track row's payment_result never sends its own server Purchase: with the
// pixel blocked (Safari, in-app browsers) that second copy could count a sale
// twice. The Purchase row stays in META_MAP (serverCopy: false) because the
// table is also the browser's map.
//
// ViewContent is the one row with its own id: "<PageView id>.vc". Purchase is
// "purchase.<order_ref>". Meta dedupes on event name + id, so the two events
// of one row (Lead and SurveyStep on the survey's final submit) share the
// row's id, exactly as the browser sends them.
//
// The match rules are the same ones fh-events.js uses, so the browser copy and
// the server copy fire on the same rows.

import { fromCents } from "../commissions/money.mjs";
import { SLO_PRICE_CENTS } from "../slo/offer.mjs";

/** The roadmap price as Meta wants it: a number of dollars ($147), from integer cents. */
export const SLO_VALUE = Number(fromCents(SLO_PRICE_CENTS));
export const CURRENCY = "USD";

/** page_view on these pages also sends ViewContent. */
export const VIEW_CONTENT_PAGES = Object.freeze(["/roadmap", "/watch", "/apply", "/home"]);

/** The buy box's section names (#fh-cf-form wraps #fhw; the tracker reports one of them). */
export const BUY_BOX_SECTIONS = Object.freeze(["fh-cf-form", "fhw"]);

/** Video marks that go to Meta. */
export const VIDEO_MARKS = Object.freeze([25, 50, 75, 100]);

const has = (v) => v !== undefined && v !== null && v !== "";
/** custom_data with the empty keys left out; undefined when nothing is left. */
function data(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (has(v)) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}
const props = (row) => (row?.props && typeof row.props === "object" ? row.props : {});

/**
 * The contract table. One rule per row:
 *   event      — our track event (first word of the doc's "Our event" cell)
 *   meta       — the Meta event name
 *   custom     — true for a custom event (fbq trackCustom in the browser)
 *   match      — does this saved row fire it
 *   customData — the row's custom_data
 *   idSuffix   — appended to the base id (ViewContent only)
 *   idPrefix   — the base id must start with this, or nothing is sent
 *                (Purchase: "purchase.<order_ref>")
 *   serverCopy — false: the browser fires it from this row, but the server
 *                never sends a copy from the track row (Purchase: the payment
 *                webhook's copy is the one server copy)
 * "When" rules that need memory (first time per session, once per order, once
 * per page load) are the browser's: it sends meta_event_id only when they pass.
 */
export const META_MAP = Object.freeze([
  {
    event: "page_view", meta: "PageView", custom: false,
    match: () => true,
    customData: () => undefined,
  },
  {
    event: "page_view", meta: "ViewContent", custom: false, idSuffix: ".vc",
    match: (row) => VIEW_CONTENT_PAGES.includes(row.page),
    customData: (row) => data({ content_name: row.page }),
  },
  {
    // The buy box is on /roadmap; "continue" is its step-1 button (step 1, or
    // no step from an older page). Same rule as public/funnel/fh-events.js.
    event: "continue", meta: "Lead", custom: false,
    match: (row) => row.page === "/roadmap" && (props(row).step === undefined || props(row).step === 1),
    customData: () => data({ content_name: "roadmap_buybox" }),
  },
  {
    // "The last question" is the page's own once-only last: true on the final
    // submit (/apply, /home). A resend after a failed submit carries no last,
    // so it is never a second Lead. Same rule as fh-events.js.
    event: "survey_answer", meta: "Lead", custom: false,
    match: (row) => props(row).last === true,
    customData: (row) => data({ content_name: props(row).survey }),
  },
  {
    // First time per session: the browser's rule (sessionStorage), carried by
    // meta_event_id.
    event: "buybox_tab", meta: "InitiateCheckout", custom: false,
    match: (row) => props(row).tab === 2,
    customData: () => data({ value: SLO_VALUE, currency: CURRENCY }),
  },
  {
    // Browser only from this row: once per order, "purchase.<order_ref>". The
    // payment webhook sends the one server copy under that same id (see the
    // top of this file), so a server copy from here would be a second one.
    event: "payment_result", meta: "Purchase", custom: false, idPrefix: "purchase.", serverCopy: false,
    match: (row) => props(row).result === "success",
    customData: () => data({ value: SLO_VALUE, currency: CURRENCY }),
  },
  {
    event: "booking_confirmed", meta: "Schedule", custom: false,
    match: () => true,
    customData: (row) => data({ content_name: props(row).calendar }),
  },
  {
    event: "survey_answer", meta: "SurveyStep", custom: true,
    match: () => true,
    customData: (row) => data({ survey: props(row).survey, step: props(row).step_num }),
  },
  {
    event: "survey_route", meta: "SurveyRouted", custom: true,
    match: () => true,
    customData: (row) => data({ offer: props(row).offer }),
  },
  {
    event: "video", meta: "VideoProgress", custom: true,
    match: (row) => props(row).action === "progress" && VIDEO_MARKS.includes(props(row).pct),
    customData: (row) => data({ video: props(row).video, pct: props(row).pct }),
  },
  {
    event: "section_view", meta: "ReachedBuyBox", custom: true,
    match: (row) => BUY_BOX_SECTIONS.includes(props(row).section),
    customData: () => undefined,
  },
  {
    event: "softpull_submit", meta: "SoftPullSubmitted", custom: true,
    match: () => true,
    customData: (row) => data({ businesses: props(row).businesses }),
  },
]);

/** Every Meta event name the server can send. */
export const META_EVENT_NAMES = Object.freeze([...new Set(META_MAP.map((r) => r.meta))]);

/** Our track events that can reach Meta at all. */
export const MAPPED_TRACK_EVENTS = Object.freeze([...new Set(META_MAP.map((r) => r.event))]);

// "<fh_sid>.<seq>", "pv.<fh_sid>.<random>", "purchase.<order ref>".
const EVENT_ID = /^[A-Za-z0-9_.:-]{1,160}$/;

/** The browser's meta_event_id when it is a usable id, else null. */
export function cleanMetaEventId(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return EVENT_ID.test(s) ? s : null;
}

/** The base event id for a saved row: the browser's meta_event_id, or null. */
export function baseEventId(row) {
  return cleanMetaEventId(row?.meta_event_id);
}

/**
 * The server events one saved track row fires, in table order:
 * [{ event_name, event_id, custom_data? }]. Empty when the row maps to nothing
 * or carries no meta_event_id. A browser-only row (serverCopy: false —
 * Purchase) is left out: its server copy comes from the payment webhook.
 */
export function metaEventsFor(row) {
  if (!row || typeof row !== "object" || !MAPPED_TRACK_EVENTS.includes(row.event)) return [];
  const base = baseEventId(row);
  if (!base) return [];
  const out = [];
  for (const rule of META_MAP) {
    if (rule.serverCopy === false) continue;
    if (rule.event !== row.event || !rule.match(row)) continue;
    if (rule.idPrefix && !base.startsWith(rule.idPrefix)) continue;
    const ev = { event_name: rule.meta, event_id: base + (rule.idSuffix || "") };
    const cd = rule.customData(row);
    if (cd) ev.custom_data = cd;
    out.push(ev);
  }
  return out;
}

/** The page's public address, for event_source_url when the browser sent none. */
export function pageUrl(page) {
  if (page === "/home") return "https://fundhub.ai/";
  return `https://apply.fundhub.ai${page || "/"}`;
}
