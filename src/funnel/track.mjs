// kind "track" on POST /api/public/slo-interest — one funnel event, saved to
// our own events table.
//
// Contract: docs/tracking/tracking-spec.md. Read it before changing anything
// here; the shared browser tracker and every page hook follow the same file.
//
// What this saves: an events row named funnel.<event> carrying the page, the
// funnel and step worked out from the page (src/funnel/pages.mjs), the session,
// the per-session counter seq, the event, its allow-listed props, the UTMs, and
// whether a person or an agent sent it (src/slo/visitor.mjs).
//
// What this never saves: a typed value of any kind. The browser sends a form
// field's NAME only. A prop whose key names a sensitive field, or whose value
// looks like one (a long run of digits, a date, an email), is dropped here
// even if the browser sent it.
//
// It does not fan out to Inngest or create a client. It sends nothing itself:
// a saved row from a real person that maps to a Meta event (src/meta/map.mjs)
// is handed to src/meta/track-send.mjs, which sends the server copy through
// the Conversions API (src/messaging/providers/meta-capi.mjs) only when
// META_CAPI_ENABLED is "1". Contract: the "Phase 4 contract" section of
// docs/tracking/meta-events.md.
//
// A page that is not on the fixed map (src/funnel/pages.mjs) may still be
// saved when it is a page of a funnel the dashboard built (build unit X4): the
// browser sends funnel_tag (window.FH_FUNNEL on that page), and the page is
// looked up in marketing_funnel_pages by that tag and that address. Found: the
// row's funnel is the tag, its step is the page's position, and funnel_tag and
// funnel_id ride on the row; the page's events_seen count goes up by one. Not
// found (or the table is not live yet): page_invalid, exactly as before.
//
// Four top-level fields come with that (same contract): meta_event_id (the id
// the browser pixel used, so Meta counts the two copies once), fbc and fbp
// (Meta's click id and browser id cookies), and url (the page address; a query
// value that names or looks like a sensitive field is dropped before it is
// stored or sent). Each is stored on the row only when present and valid.

import { db as defaultDb } from "../db.mjs";
import { defaultOrgId, emit } from "../events/bus.mjs";
import { pickAttribution } from "../ads/attribution-keys.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";
import { funnelFor, normalizePage } from "./pages.mjs";
import { cleanMetaEventId } from "../meta/map.mjs";
import { cleanFbc, cleanFbp } from "../meta/user-data.mjs";
import { startMetaSend } from "../meta/track-send.mjs";

// Same session rule as api/public/slo-interest.mjs (sessionStorage.fh_sid).
const SESSION = /^[A-Za-z0-9_-]{8,80}$/;
export const MAX_SEQ = 100000;
export const MAX_TRACK_PER_SESSION = 500;
const MAX_SECONDS = 24 * 60 * 60;

// ── props allow-list ─────────────────────────────────────────────────────────
//
// One entry per event in the spec's Events table, and the props that event may
// carry. Anything not listed is dropped. Strings are slugged or clipped;
// numbers are clamped into the range given.

const slug = (max) => ({ type: "slug", max });
const text = (max) => ({ type: "text", max });
const path = (max) => ({ type: "path", max });
const int = (min, max) => ({ type: "number", min, max, int: true });
const dec = (min, max) => ({ type: "number", min, max, int: false });
const oneOf = (...values) => ({ type: "enum", values });
const pattern = (re) => ({ type: "pattern", re });
const bool = () => ({ type: "bool" });

const SECONDS = int(0, MAX_SECONDS);
const PERCENT = int(0, 100);
const FORM = slug(40);
const FIELD = slug(64);
const CALENDAR = { calendar: slug(64) };
// Which /roadmap buy box sent the event (2 = phone on step 3 and the
// "Step 1 of 3" line, owner-set 2026-10-02). Only the buy box sends it; the
// survey pages that share field_focus / field_complete / validation_error
// never do. Whole number 1..99.
const BBV = int(1, 99);

// The six sample previews under the /roadmap order summary. Exactly these;
// anything else is refused (see PREVIEW_EVENTS below).
export const PREVIEW_DELIVERABLES = Object.freeze([
  "how_much_you_qualify_for",
  "credit_analysis_report",
  "credit_optimization_roadmap",
  "dispute_letter_pack",
  "bank_lender_match_list",
  "business_duplication_map",
]);
const DELIVERABLE = oneOf(...PREVIEW_DELIVERABLES);

// The $297 order a payment_result belongs to (the browser's Meta Purchase id is
// "purchase.<order_ref>"; docs/tracking/meta-events.md, Phase 4 contract).
const ORDER_REF = /^[A-Za-z0-9_-]{1,64}$/;
/* Our own order refs are "slo_" + hex. About one in ten carries nine or more
   digits in a row (or a run that reads as a date), which looksSensitiveValue
   would take for a card or a birth date and drop. That exact shape is a ref we
   minted, never a typed value, so it skips the value check. */
const OWN_ORDER_REF = /^slo_[a-f0-9]+$/;

export const TRACK_EVENTS = Object.freeze({
  page_view: { title: text(120) },
  time_on_page: { seconds: SECONDS },
  exit: { seconds: SECONDS, max_scroll: PERCENT },
  click: {
    element_id: slug(64),
    label: slug(64),
    href_path: path(200),
    y_px: int(0, 200000),
    y_pct: PERCENT,
    section: slug(64),
    nth: int(0, 10000),
  },
  video: {
    video: slug(64),
    action: oneOf("play", "pause", "unmute", "mute", "progress"),
    pct: PERCENT,
    current_s: dec(0, MAX_SECONDS),
    duration_s: dec(0, MAX_SECONDS),
  },
  scroll: { depth: PERCENT },
  section_view: { section: slug(64) },
  carousel: { carousel: slug(64), action: oneOf("next", "prev", "play"), index: int(0, 1000) },
  faq_open: { question: slug(80) },
  survey_answer: { survey: slug(40), step_num: int(0, 100), question_id: slug(64), last: bool() },
  survey_route: { survey: slug(40), offer: slug(40) },
  buybox_tab: { tab: int(1, 3), bbv: BBV },
  field_focus: { form: FORM, field: FIELD, bbv: BBV },
  field_complete: { form: FORM, field: FIELD, bbv: BBV },
  continue: { step: int(0, 20), bbv: BBV },
  validation_error: { form: FORM, field: FIELD, code: slug(40), bbv: BBV },
  payment_attempt: { amount_cents: int(0, 10_000_000), bbv: BBV },
  payment_result: { result: oneOf("success", "fail"), code: slug(40), bbv: BBV, order_ref: pattern(ORDER_REF) },
  softpull_submit: { businesses: int(0, 50), bbv: BBV },
  calendar_view: CALENDAR,
  time_selected: CALENDAR,
  booking_confirmed: CALENDAR,
  preview_opened: { deliverable: DELIVERABLE, bbv: BBV },
  preview_closed: { deliverable: DELIVERABLE, open_ms: int(0, 600_000), bbv: BBV },
});

/** Events that mean nothing without a valid deliverable: refused, not saved empty. */
export const PREVIEW_EVENTS = Object.freeze(["preview_opened", "preview_closed"]);

// ── sensitive values ─────────────────────────────────────────────────────────
//
// A prop KEY made of any of these words names a field value we never keep
// (checked word by word on "_"), so it is dropped even if a later edit puts it
// on the allow-list above. A `field` prop whose VALUE is "ssn" is fine: that is
// the field's name, which is exactly what the browser is meant to send.

const SENSITIVE_KEY_WORDS = new Set([
  "ssn", "social", "dob", "birth", "birthday", "birthdate",
  "card", "cardnumber", "ccn", "cc", "cvv", "cvc", "expiry", "expiration",
  "account", "routing", "password", "passcode", "pin", "secret", "token",
  "tin", "ein", "taxid", "email", "phone", "mobile",
  "address", "street", "zip", "postal",
  "name", "firstname", "lastname", "fullname",
  "value", "answer", "text", "typed", "input",
]);

export function isSensitiveKey(key) {
  return String(key).toLowerCase().split(/[_\W]+/).some((w) => SENSITIVE_KEY_WORDS.has(w));
}

const DATE_SEPARATED = /\b\d{1,2}[-/.]\d{1,2}[-/.](19|20)\d{2}\b|\b(19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b/;
const DATE_COMPACT = /(^|\D)((19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])|(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(19|20)\d{2})(\D|$)/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/**
 * True when a raw prop value looks like a field value we never keep:
 * nine or more digits once spaces, dashes, dots, slashes, brackets and "+" are
 * taken out (Social Security number, card, phone, account number), a date
 * (date of birth), or an email address. A plain number is checked by size:
 * nine or more whole digits.
 */
export function looksSensitiveValue(v) {
  if (typeof v === "number") return Number.isFinite(v) && Math.abs(Math.trunc(v)) >= 100_000_000;
  if (typeof v !== "string") return false;
  if (/\d{9,}/.test(v.replace(/[\s().\/+-]/g, ""))) return true;
  if (DATE_SEPARATED.test(v) || DATE_COMPACT.test(v)) return true;
  return EMAIL_LIKE.test(v);
}

// ── clean one value ──────────────────────────────────────────────────────────

function cleanSlug(v, max) {
  return String(v).trim().toLowerCase()
    .replace(/[^a-z0-9_:.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

function cleanText(v, max) {
  return String(v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/** The path of a link, never its query or anchor. A full URL keeps only its path. */
function cleanPath(v, max) {
  let s = String(v).trim();
  if (/^https?:\/\//i.test(s)) {
    try { s = new URL(s).pathname; } catch { return ""; }
  }
  s = s.split(/[?#]/)[0];
  if (!s.startsWith("/")) return "";
  return s.toLowerCase().replace(/[^a-z0-9/_.~-]+/g, "-").slice(0, max);
}

function cleanNumber(v, { min, max, int: whole }) {
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\s*-?\d{1,12}(\.\d{1,6})?\s*$/.test(v)) n = Number(v);
  else return undefined;
  if (!Number.isFinite(n)) return undefined;
  n = Math.min(max, Math.max(min, n));
  return whole ? Math.round(n) : Math.round(n * 100) / 100;
}

function cleanValue(v, spec) {
  if (spec.type === "number") return cleanNumber(v, spec);
  if (spec.type === "bool") return v === true || v === "true" ? true : v === false || v === "false" ? false : undefined;
  if (spec.type === "pattern") return typeof v === "string" && spec.re.test(v.trim()) ? v.trim() : undefined;
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  if (spec.type === "enum") {
    const s = String(v).trim().toLowerCase();
    return spec.values.includes(s) ? s : undefined;
  }
  const out = spec.type === "slug" ? cleanSlug(v, spec.max)
    : spec.type === "path" ? cleanPath(v, spec.max)
    : cleanText(v, spec.max);
  return out || undefined;
}

/**
 * The props one event may keep: allow-listed keys only, no sensitive key, no
 * sensitive-looking value, every value cleaned. Always a plain object.
 */
export function cleanProps(event, raw) {
  const allowed = Object.hasOwn(TRACK_EVENTS, event) ? TRACK_EVENTS[event] : null;
  const out = {};
  if (!allowed || !raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, spec] of Object.entries(allowed)) {
    if (!Object.hasOwn(raw, key) || isSensitiveKey(key)) continue;
    const v = raw[key];
    // A link keeps only its path, so only the path is checked: a query string
    // carrying a long ad id must not cost the whole prop.
    const kept = spec.type === "path" && typeof v === "string" ? v.split(/[?#]/)[0] : v;
    const ownRef = key === "order_ref" && typeof v === "string" && OWN_ORDER_REF.test(v.trim());
    if (!ownRef && looksSensitiveValue(kept)) continue;
    const clean = cleanValue(v, spec);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

// ── the page address (meta-events.md, Phase 4 contract) ─────────────────────

const MAX_URL = 1000;

/**
 * The page address the event came from, for Meta's event_source_url. A
 * fundhub.ai page only (http or https); no anchor; a query parameter whose
 * key names a sensitive field, or whose value looks like one (an email, a
 * phone, a long digit run, a date), is dropped. null when nothing usable.
 */
export function cleanPageUrl(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4 * MAX_URL) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase();
  if (host !== "fundhub.ai" && !host.endsWith(".fundhub.ai")) return null;
  u.hash = "";
  u.username = "";
  u.password = "";
  for (const [key, value] of [...u.searchParams.entries()]) {
    if (isSensitiveKey(key) || looksSensitiveValue(value) || looksSensitiveValue(key)) u.searchParams.delete(key);
  }
  const out = u.toString();
  return out.length <= MAX_URL ? out : `${u.origin}${u.pathname}`.slice(0, MAX_URL);
}

// ── names and keys ───────────────────────────────────────────────────────────

/** page_view and click keep their old row names so today's counts still work. */
export function trackEventName(event) {
  if (event === "page_view") return "funnel.page";
  if (event === "click") return "funnel.click";
  return `funnel.${event}`;
}

/**
 * page_view: once per session per page (the old kind "page" key, so the two
 * dedupe against each other). Everything else: once per session per seq, so a
 * retried send is saved once and a second real press is saved again.
 */
export function trackIdempotencyKey(event, sessionId, seq, page) {
  return event === "page_view"
    ? `funnel-page:${sessionId}:${page}`
    : `funnel-track:${sessionId}:${seq}`;
}

const escapeLike = (s) => String(s).replace(/[\\%_]/g, "\\$&");

/* The cap count. The literal `LIKE 'funnel-track:%'` line is not redundant:
   it is what lets Postgres use the partial index idx_events_funnel_track
   (db/migrations/404_funnel_track_index.sql), whose WHERE is the same text.
   Postgres cannot work out that one LIKE pattern implies another. The inner
   LIMIT stops the count at the cap, so the work per event is bounded. */
export const TRACK_CAP_SQL =
  `SELECT count(*)::int AS n FROM (
     SELECT 1 FROM events
      WHERE org_id = $1
        AND idempotency_key LIKE 'funnel-track:%'
        AND idempotency_key LIKE $2
        AND created_at > now() - interval '1 day'
      LIMIT ${MAX_TRACK_PER_SESSION}
   ) capped`;

function parseSeq(v) {
  let n;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && /^\d{1,6}$/.test(v.trim())) n = Number(v.trim());
  else return null;
  return Number.isInteger(n) && n >= 0 && n <= MAX_SEQ ? n : null;
}

const clip = (v, max) => String(v ?? "").trim().slice(0, max);

/** A funnel tag as the builder writes it (migration 425), or null. */
const FUNNEL_TAG = /^fnl-[a-z0-9]+(-[a-z0-9]+)*$/;
export function cleanFunnelTag(raw) {
  const s = typeof raw === "string" ? raw.trim() : "";
  return s.length <= 64 && FUNNEL_TAG.test(s) ? s : null;
}

/**
 * The built-funnel page behind a tag and an address, or null. Never throws: a
 * missing table (the migration not live yet) or a failed read is "not found".
 */
export async function findFunnelPage(db, orgId, tag, page) {
  try {
    const r = await db.query(
      `SELECT p.id, p.path, p.position, f.tag, f.id AS funnel_id
         FROM marketing_funnel_pages p
         JOIN marketing_funnels f ON f.id = p.funnel_id
        WHERE p.org_id = $1 AND f.tag = $2 AND p.path = $3
        LIMIT 1`,
      [orgId, tag, page]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

/**
 * One funnel event → { ok, actor, saved } or { ok:false, error }.
 *
 * saved false means nothing new was written: the same session already sent
 * this seq (or this page_view), or the session is over the daily cap. Both
 * still answer ok, so the browser never retries them.
 *
 * deps: db, emit, orgId, defaultOrgId, userAgent — same as recordInterest in
 * api/public/slo-interest.mjs.
 */
export async function recordTrack(body, deps = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "invalid_json" };

  const sessionId = clip(body.session_id, 80);
  if (!SESSION.test(sessionId)) return { ok: false, error: "session_invalid" };

  const event = clip(body.event, 40);
  if (!Object.hasOwn(TRACK_EVENTS, event)) return { ok: false, error: "event_invalid" };

  const seq = parseSeq(body.seq);
  if (seq === null) return { ok: false, error: "seq_invalid" };

  let where = funnelFor(body.page);
  let built = null;
  let db = null;
  let orgId = null;
  if (!where) {
    const tag = cleanFunnelTag(body.funnel_tag);
    const page = normalizePage(body.page);
    if (!tag || !/^\/[a-z0-9]+(-[a-z0-9]+)*$/.test(page)) return { ok: false, error: "page_invalid" };
    db = deps.db || defaultDb;
    orgId = deps.orgId || (await (deps.defaultOrgId || defaultOrgId)(db));
    built = await (deps.findFunnelPage || findFunnelPage)(db, orgId, tag, page);
    if (!built) return { ok: false, error: "page_invalid" };
    where = { page: built.path, funnel: built.tag, step: Number(built.position) };
  }

  const props = cleanProps(event, body.props);
  if (PREVIEW_EVENTS.includes(event) && !props.deliverable) return { ok: false, error: "deliverable_invalid" };
  // A close with no usable time still counts as a close, at zero.
  if (event === "preview_closed" && props.open_ms === undefined) props.open_ms = 0;

  const who = classifyVisitor({
    email: "",
    userAgent: deps.userAgent,
    webdriver: body.webdriver === true || body.webdriver === "true"
  });

  const payload = {
    page: where.page,
    funnel: where.funnel,
    step: where.step,
    session_id: sessionId,
    seq,
    event,
    props,
    attribution: pickAttribution(body),
    landing_path: clip(body.landing_path, 200) || null,
    actor: who.actor,
    actor_reason: who.reason
  };
  if (built) {
    payload.funnel_tag = built.tag;
    payload.funnel_id = built.funnel_id;
  }

  // Meta dedupe id, click and browser ids, page address: kept only when valid.
  const metaEventId = cleanMetaEventId(body.meta_event_id);
  if (metaEventId) payload.meta_event_id = metaEventId;
  const fbc = cleanFbc(body.fbc);
  if (fbc) payload.fbc = fbc;
  const fbp = cleanFbp(body.fbp);
  if (fbp) payload.fbp = fbp;
  const url = cleanPageUrl(body.url);
  if (url) payload.url = url;

  if (!db) db = deps.db || defaultDb;
  if (!orgId) orgId = deps.orgId || (await (deps.defaultOrgId || defaultOrgId)(db));

  // page_view is once per session per page, so it is bounded by the page list
  // and never counted against the cap: an over-cap session still records the
  // step it reached.
  if (event !== "page_view") {
    const used = await db.query(TRACK_CAP_SQL, [orgId, `funnel-track:${escapeLike(sessionId)}:%`]);
    if ((used.rows[0]?.n ?? 0) >= MAX_TRACK_PER_SESSION) {
      return { ok: true, actor: who.actor, saved: false };
    }
  }

  const sent = await (deps.emit || emit)(db, trackEventName(event), payload, {
    orgId,
    allowNonCanonical: true,
    skipInngest: true,
    idempotencyKey: trackIdempotencyKey(event, sessionId, seq, where.page)
  });
  const saved = sent?.deduped !== true;

  // A built funnel's page: one more event seen (GET marketing/funnels shows it).
  if (saved && built) {
    try {
      await db.query(
        `UPDATE marketing_funnel_pages SET events_seen = events_seen + 1, last_event_at = now() WHERE id = $1`,
        [built.id]
      );
    } catch { /* the count is a convenience; the event row is the record */ }
  }

  // The Meta server copy: saved rows from real people only, never awaited here
  // (the door waits a capped time after it answers; see deps.onMetaSend).
  if (saved) startMetaSend({ db, orgId, rowId: sent?.id || null, payload, actor: who.actor, deps });

  return { ok: true, actor: who.actor, saved };
}
