// ClickFunnels webhook adapter — lead capture, survey submission, appointments.
//
// ClickFunnels is the funnel front-end. This adapter translates opt-in / form
// submissions into canonical bus events so downstream handlers (the CRM contact
// creation, the spreadsheet, email journey triggers) react without coupling to CF.
//
// ┌────────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM payload paths against a real ClickFunnels webhook.               │
// │ CF Classic and CF 2.0 differ. Classic: contact at top-level or data.contact │
// │ with snake_case fields. 2.0: contact nested under data.contact with         │
// │ camelCase + snake_case variants. Survey answers: CF Classic stores them in  │
// │ contact.survey_answers or data.survey_answers. CF 2.0 may use               │
// │ data.formData, data.answers, or contact.custom_fields. Paths below are      │
// │ best-effort from CF docs + community payloads — adjust normalizeClickFunnelsEvent(). │
// └────────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit, defaultOrgId } from "../events/bus.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { handleSloPaidWebhook } from "../slo/purchase.mjs";
import { upsertContact } from "../analytics/clickfunnels.mjs";
import { pickMetaClickIds, storeClientMetaClickIds } from "../ads/meta-match.mjs";

// --- 1. Signature verification (fail-closed) --------------------------------
// ClickFunnels 2.0 (official): HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
// Headers: X-Webhook-ClickFunnels-Signature + X-Webhook-ClickFunnels-Timestamp
// (see https://developers.myclickfunnels.com/docs/signature-verification).
// Timestamp must be within 600s. Optional "sha256=" prefix on the signature.
// Legacy fallback (no timestamp): HMAC of raw body only — kept for internal
// probes / older tests. Live CF V2 always sends the timestamp header.
export function verifyClickFunnelsSignature(rawBody, header, secret, timestamp) {
  if (!secret) return false;
  const provided = String(header || "").trim();
  if (!provided) return false;
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;

  const ts = String(timestamp ?? "").trim();
  let expected;
  if (ts) {
    const tsInt = Number(ts);
    if (!Number.isFinite(tsInt)) return false;
    const skew = Math.abs(Math.floor(Date.now() / 1000) - tsInt);
    if (skew > 600) return false;
    expected = crypto.createHmac("sha256", secret).update(`${ts}.${rawBody || ""}`).digest("hex");
  } else {
    expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return undefined;
  const want = String(name).toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

// Appointment webhook types (ClickFunnels booking calendar).
const APPOINTMENT_CREATED = "appointments/scheduled_event.created";
const APPOINTMENT_RESCHEDULED = "appointments/scheduled_event.rescheduled";
const APPOINTMENT_CANCELED = "appointments/scheduled_event.canceled";

function isAppointmentType(type) {
  return (
    type === APPOINTMENT_CREATED ||
    type === APPOINTMENT_RESCHEDULED ||
    type === APPOINTMENT_CANCELED
  );
}

/* ClickFunnels sends every single/multi-select answer TWICE: the answer-option
   row id on `cf_svy_<key>`, and the words the person actually picked on
   `cf_svy_<key>_label` (single) or `cf_svy_<key>_labels` (multi, a JSON array,
   sometimes already encoded as a string). Copying the id through verbatim is
   what put "207883" on a client-facing slide and on the sales deck (F11) and
   left internal screens reading a bare number (F8) — every screen then had to
   grow its own id-suppressing guard, and each one that forgot leaked the id.
   Resolve it once, here, where the payload still has both halves. */
function isCfOptionId(v) {
  if (typeof v === "number") return v >= 10000;
  return typeof v === "string" && /^\d{5,}$/.test(v.trim());
}

/** The words CF sent for `key`, from its _label / _labels sibling. */
function cfLabelsFor(obj, key) {
  const single = obj[`${key}_label`];
  if (single != null && single !== "") return String(single);
  const many = obj[`${key}_labels`];
  if (many == null || many === "") return null;
  if (Array.isArray(many)) {
    const words = many.filter((x) => x != null && x !== "").map(String);
    return words.length ? words : null;
  }
  try {
    const parsed = JSON.parse(String(many));
    if (Array.isArray(parsed)) {
      const words = parsed.filter((x) => x != null && x !== "").map(String);
      return words.length ? words : null;
    }
  } catch {
    /* not JSON — CF sent a plain string */
  }
  return String(many);
}

/* ClickFunnels custom attributes are text. The apply-survey upsert stores a
   multi-select as a JSON list of labels on the key itself. Turn that list
   back into an array here. Leave `_label` / `_labels` alone — native CF
   already sends those as a JSON string, and the deck reads that string. */
function reviveJsonList(key, v) {
  const name = String(key);
  if (name.endsWith("_label") || name.endsWith("_labels")) return v;
  if (typeof v !== "string") return v;
  const s = v.trim();
  if (!s.startsWith("[")) return v;
  try {
    const parsed = JSON.parse(s);
    if (!Array.isArray(parsed)) return v;
    const words = parsed.filter((x) => x != null && String(x).trim() !== "").map((x) => String(x));
    return words.length ? words : v;
  } catch {
    return v;
  }
}

/** Pull only FundHub survey keys from a CF attributes/fields object. */
function pickSurveyAnswers(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!String(k).startsWith("cf_svy_")) continue;
    if (v == null || v === "") continue;
    out[k] = reviveJsonList(k, v);
  }
  for (const k of Object.keys(out)) {
    if (k.endsWith("_label") || k.endsWith("_labels")) continue;
    const v = out[k];
    const isIdList = Array.isArray(v) && v.length > 0 && v.every(isCfOptionId);
    if (!isIdList && !isCfOptionId(v)) continue;
    const words = cfLabelsFor(out, k);
    /* No label came with the id. Keep the id rather than dropping the answer —
       "they answered, we cannot read it" is a finding; silence is not. */
    if (words == null) continue;
    out[k] = Array.isArray(v)
      ? (Array.isArray(words) ? words : [words])
      : (Array.isArray(words) ? words.join(", ") : words);
  }
  return Object.keys(out).length ? out : null;
}

function decodeUtm(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  if (!s) return null;
  try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch { return s; }
}

function landingPathOf(url) {
  if (!url) return null;
  try {
    const u = new URL(String(url));
    return u.pathname || null;
  } catch {
    const s = String(url);
    const cut = s.split("?")[0];
    const i = cut.indexOf("/", cut.indexOf("//") + 2);
    return i >= 0 ? cut.slice(i) : null;
  }
}

/* Facebook / UTM attribution. The click id (fbclid) is NOT part of this
   object — it never becomes a UTM column. It is read separately, into
   metaClickIds (fbc / fbp), and kept on the client for Meta's Conversions API
   (docs/tracking/meta-events.md, Phase 4, "Stop dropping fbclid").

   THREE PLACES, IN ORDER OF TRUST, FIELD BY FIELD:
     1. an explicit `attribution` object on the payload (what the application
        form's hidden fields post — marketing/landing-pages/06-utm-hidden-fields.html)
     2. the same keys as hidden fields on the contact (custom_attributes /
        custom_fields), which is where ClickFunnels puts a form's hidden inputs
     3. CF's own visits.first_visit, the pre-existing source
   The hidden fields win because they carry the UTMs of the ad URL the person
   actually arrived on; first_visit can be an older visit from a different ad. */
function firstObject(...cands) {
  for (const c of cands) if (c && typeof c === "object" && !Array.isArray(c)) return c;
  return null;
}
function pickVisitAttribution(d, b, contact) {
  const visit =
    (d && d.visits && d.visits.first_visit) ||
    (b && b.visits && b.visits.first_visit) ||
    (contact && contact.visits && contact.visits.first_visit) ||
    {};
  const explicit = firstObject(b && b.attribution, d && d.attribution, contact && contact.attribution) || {};
  const hidden = firstObject(
    contact && contact.custom_attributes, d && d.custom_attributes,
    contact && contact.custom_fields, d && d.custom_fields
  ) || {};
  const pick = (k) => decodeUtm(explicit[k]) ?? decodeUtm(hidden[k]) ?? decodeUtm(visit[k]);
  const landing =
    explicit.landing_path || landingPathOf(explicit.landing_page) ||
    hidden.landing_path || landingPathOf(hidden.landing_page) ||
    landingPathOf(visit.landing_page || visit.url);
  const out = {
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_content: pick("utm_content"),
    utm_term: pick("utm_term"),
    landing_path: landing || null,
    referrer_domain: explicit.referrer_domain || hidden.referrer_domain || visit.referring_domain || null
  };
  return Object.values(out).some(Boolean) ? out : null;
}

/* Affiliate codes are opaque tracking ids (AFF-000001, vanity slugs). Cap
   matches api/public/affiliate-click.mjs MAX_CODE. First non-empty wins. */
function pickAffiliateCode(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    const s = String(c).trim();
    if (s) return s.slice(0, 64);
  }
  return null;
}

/* Visit landing URLs sometimes still carry ?a1= / ?ref= when the form field
   never mapped. Prefer the named param; for a1 also accept ref and code. */
function affiliateCodeFromUrl(rawUrl, which = "a1") {
  if (!rawUrl) return null;
  try {
    const u = new URL(String(rawUrl), "https://apply.fundhub.ai");
    if (which === "a2") return pickAffiliateCode(u.searchParams.get("a2"));
    return pickAffiliateCode(
      u.searchParams.get("a1"),
      u.searchParams.get("ref"),
      u.searchParams.get("code")
    );
  } catch {
    return null;
  }
}

// --- 2. Normalize the webhook body into a flat event ------------------------
// Reads defensively from CF Classic + 2.0 shapes. Returns null when no usable
// data is found (caller treats as no-op).
export function normalizeClickFunnelsEvent(body) {
  const b = body || {};

  // CF 2.0 wraps everything under `data`; Classic may have a top-level contact.
  const d = (b.data && typeof b.data === "object" ? b.data : null) || b;
  // form_submission.created nests contact + booking under data.data.
  const nested =
    d.data && typeof d.data === "object" && !Array.isArray(d.data) ? d.data : null;
  const schedule =
    (nested && nested.appointments_schedule_request && typeof nested.appointments_schedule_request === "object"
      ? nested.appointments_schedule_request
      : null) ||
    (d.appointments_schedule_request && typeof d.appointments_schedule_request === "object"
      ? d.appointments_schedule_request
      : null);

  // Event type / hook type (needed before contact pick — appointments use
  // data.primary_contact, not data.contact).
  const type = String(
    b.type ||
    b.event ||
    b.event_type ||
    b.hook ||
    d.type ||
    d.event ||
    d.event_type ||
    ""
  ).toLowerCase();

  // Contact block: appointments → data.primary_contact; form_submission →
  // data.data.contact; otherwise CF Classic / 2.0 contact shapes (contact.* or
  // the contact row itself as `data` with email_address).
  const primary =
    d.primary_contact && typeof d.primary_contact === "object" ? d.primary_contact : null;
  const nestedContact =
    nested && nested.contact && typeof nested.contact === "object" ? nested.contact : null;
  const contact =
    (isAppointmentType(type) && primary) ||
    (d.contact && typeof d.contact === "object" ? d.contact : null) ||
    nestedContact ||
    (b.contact && typeof b.contact === "object" ? b.contact : null) ||
    primary ||
    schedule ||
    d ||
    b;

  // Email — most critical field.
  const email = String(
    contact.email ||
    contact.email_address ||
    schedule?.email ||
    nestedContact?.email ||
    d.email ||
    d.email_address ||
    b.email ||
    ""
  ).trim().toLowerCase();

  // Name: prefer full_name, fall back to first+last concat.
  const firstName = contact.first_name || contact.firstName || d.first_name || b.first_name || "";
  const lastName = contact.last_name || contact.lastName || d.last_name || b.last_name || "";
  const name = String(
    contact.full_name ||
    contact.fullName ||
    contact.name ||
    schedule?.name ||
    d.full_name ||
    b.full_name ||
    (firstName || lastName ? `${firstName} ${lastName}`.trim() : "")
  ).trim();

  // Phone: several CF field names in use.
  const phone = String(
    contact.phone ||
    contact.phone_number ||
    contact.phoneNumber ||
    schedule?.phone_number ||
    schedule?.phone ||
    d.phone ||
    d.phone_number ||
    b.phone ||
    ""
  ).trim();

  // Funnel name / page name for tracing. Appointments: event_type.name.
  const eventTypeName =
    (d.event_type && typeof d.event_type === "object" && d.event_type.name) ||
    (b.event_type && typeof b.event_type === "object" && b.event_type.name) ||
    "";
  const funnelObj = b.funnel || d.funnel || (d.page && d.page.funnel) || null;
  const funnel = String(
    b.funnel_name ||
    (typeof b.funnel === "string" ? b.funnel : "") ||
    (funnelObj && typeof funnelObj === "object" ? funnelObj.name : "") ||
    d.funnel_name ||
    (typeof d.funnel === "string" ? d.funnel : "") ||
    b.page_name ||
    d.page_name ||
    (d.page && d.page.name) ||
    eventTypeName ||
    ""
  ).trim();

  // Stable ID for idempotency: prefer CF's own event/contact/submission id.
  const id =
    b.id ||
    b.event_id ||
    b.submission_id ||
    d.id ||
    d.submission_id ||
    (contact.id ? String(contact.id) : null) ||
    null;

  // Survey answers: CF Classic → contact.survey_answers or data.survey_answers.
  // CF 2.0 → data.formData / answers / fields, or Contact Attributes on
  // custom_attributes / custom_fields (only cf_svy_* keys count).
  // Skip for appointments — formData-style keys must not turn a booking into a survey.
  const rawAnswers = isAppointmentType(type)
    ? null
    : contact.survey_answers ||
      d.survey_answers ||
      d.formData ||
      d.form_data ||
      d.answers ||
      d.fields ||
      null;
  const fromAttrs =
    pickSurveyAnswers(contact.custom_attributes) ||
    pickSurveyAnswers(d.custom_attributes) ||
    pickSurveyAnswers(contact.custom_fields) ||
    pickSurveyAnswers(d.custom_fields);
  const answers = pickSurveyAnswers(rawAnswers) || fromAttrs || (rawAnswers && typeof rawAnswers === "object" ? rawAnswers : null);

  // Referral attribution params (a1=tier1 affiliate, a2=tier2 affiliate).
  // Share links land as ?a1= / ?ref= / ?code=. public/funnel/fh-attribution.js
  // stamps them as hidden form fields; CF may put them on custom_attributes,
  // formData, or the visit landing URL. af-02 gates on these — a null here is
  // why live entry.captured rows carried a1:null (measured 2026-09-25: 687/687).
  const formBag =
    (answers && typeof answers === "object" && !Array.isArray(answers) ? answers : null) ||
    (rawAnswers && typeof rawAnswers === "object" && !Array.isArray(rawAnswers) ? rawAnswers : null) ||
    {};
  const visitForRef =
    (d && d.visits && d.visits.first_visit) ||
    (b && b.visits && b.visits.first_visit) ||
    (contact && contact.visits && contact.visits.first_visit) ||
    {};
  const a1 = pickAffiliateCode(
    b.a1, d.a1, contact.a1,
    contact.custom_fields?.a1, contact.custom_attributes?.a1,
    contact.custom_fields?.ref, contact.custom_attributes?.ref,
    contact.custom_fields?.code, contact.custom_attributes?.code,
    formBag.a1, formBag.ref, formBag.code,
    d.formData?.a1, d.form_data?.a1, d.formData?.ref, d.form_data?.ref,
    affiliateCodeFromUrl(visitForRef.landing_page || visitForRef.url)
  );
  const a2 = pickAffiliateCode(
    b.a2, d.a2, contact.a2,
    contact.custom_fields?.a2, contact.custom_attributes?.a2,
    formBag.a2, d.formData?.a2, d.form_data?.a2,
    affiliateCodeFromUrl(visitForRef.landing_page || visitForRef.url, "a2")
  );

  const attribution = pickVisitAttribution(d, b, contact);

  /* Meta click ids for a later server-only Purchase (src/handlers/meta-purchase.mjs).
     fbc / fbp as sent (explicit attribution, hidden fields, form bag, top level);
     no fbc but an fbclid — sent, or on the first visit's landing URL — builds
     fbc "fb.1.<ms>.<fbclid>" at the visit's time. Stored on the client in
     handleClickFunnelsWebhook, first touch only. */
  const visitSeenMs = Date.parse(String(visitForRef.created_at || visitForRef.createdAt || ""));
  const metaClickIds = pickMetaClickIds(
    [
      b.attribution, d.attribution, contact.attribution,
      contact.custom_attributes, d.custom_attributes, contact.custom_fields, d.custom_fields,
      formBag, d.formData, d.form_data, b, d
    ],
    {
      fbclidUrl: visitForRef.landing_page || visitForRef.url || null,
      seenAtMs: Number.isFinite(visitSeenMs) ? visitSeenMs : Date.now()
    }
  );

  // Appointment slot fields the booking handlers already read.
  const startTime = d.start_on || d.startTime || schedule?.start_on || b.start_on || null;
  const endTime = d.end_on || d.endTime || schedule?.end_on || b.end_on || null;
  const tzid = d.tzid || schedule?.tzid || b.tzid || null;
  /* THE CALL'S OWN ID, NOT THE MESSAGE'S.
     A real ClickFunnels appointment webhook has no top-level `id`. Its envelope
     carries `event_id` (a new UUID on every delivery) and `subject_id`, and
     `data` IS the scheduled event, so `data.id` is the call. Measured
     2026-10-05 on the 5 appointment webhooks ClickFunnels still lists for this
     workspace: data.id equals subject_id on every one. The old chain fell
     through to `event_id`, so each create, move and cancel of ONE call arrived
     under a different booking id: a move made a second booking, a cancel
     closed nothing. `id` above stays the message id — it is the repeat-delivery
     key on the event bus, and two moves of one call are two real messages.
     A payload with no call id at all keeps the old answer. */
  const callIdRaw = isAppointmentType(type)
    ? (d.id ?? b.subject_id ?? d.public_id ?? null)
    : null;
  const callId = callIdRaw != null && String(callIdRaw).trim() !== "" ? String(callIdRaw).trim() : null;
  const bookingUid = callId || (id ? String(id) : null);

  return {
    id: id ? String(id) : null,
    type,
    email,
    name,
    phone,
    funnel,
    answers,
    a1,
    a2,
    attribution,
    metaClickIds,
    callId,
    bookingUid,
    startTime,
    endTime,
    tzid,
    meetingUrl: null,
    rescheduleUid: null
  };
}

function isFormSubmissionType(type) {
  return String(type || "").includes("form_submission");
}

/** Custom /apply survey (browser) — flat handoff payload, not a CF-signed webhook. */
export function isApplySurveyIngestBody(body) {
  if (!body || typeof body !== "object") return false;
  return body.source === "apply-survey" || body.funnel === "apply-survey";
}

function verifyApplySurveyIngestHeader(headers, secret) {
  if (!secret) return false;
  const provided = String(headerValue(headers, "x-fundhub-apply-survey-ingest") || "").trim();
  if (!provided) return false;
  try {
    const a = Buffer.from(provided);
    const b = Buffer.from(String(secret));
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Map handoff §3 shape → CF 2.0 contact row the normalizer already reads. */
export function wrapApplySurveyIngestBody(body) {
  if (!isApplySurveyIngestBody(body)) return body;
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const first_name = parts[0] || "";
  const last_name = parts.slice(1).join(" ");
  const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
  const attr = body.attribution && typeof body.attribution === "object" ? body.attribution : {};
  const custom_attributes = { ...answers };
  for (const k of [
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_content",
    "utm_term",
    "landing_path",
    "referrer_domain"
  ]) {
    if (attr[k] != null && attr[k] !== "") custom_attributes[k] = attr[k];
  }
  if (body.a1) custom_attributes.a1 = body.a1;
  if (body.a2) custom_attributes.a2 = body.a2;
  /* Meta click ids ride along for metaClickIds. Never pushed to ClickFunnels:
     APPLY_SURVEY_CF_ATTR below does not let them through. */
  for (const k of ["fbc", "fbp", "fbclid"]) {
    const v = body[k] ?? attr[k];
    if (typeof v === "string" && v.trim()) custom_attributes[k] = v.trim();
  }
  const step = String(body.step_key || body.step || "step").slice(0, 80);
  const id = body.id || `apply-survey:${email || "unknown"}:${step}`;
  return {
    event_type: "contact.updated",
    id,
    funnel_name: "apply-survey",
    data: {
      email_address: email,
      first_name,
      last_name,
      phone_number: String(body.phone || "").trim(),
      custom_attributes
    }
  };
}

/* Keys the apply survey is allowed to write onto the ClickFunnels contact.
   Same set the native form stamps: survey answers plus the hidden ad fields. */
const APPLY_SURVEY_CF_ATTR = /^(cf_svy_[a-z0-9_]+|utm_[a-z0-9_]+|a1|a2|landing_path|referrer_domain)$/;

function applySurveyAttrString(v) {
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x == null ? "" : String(x).trim())).filter(Boolean);
    return parts.length ? JSON.stringify(parts) : null;
  }
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s || null;
}

/**
 * Contact body for POST /workspaces/{id}/contacts/upsert.
 * ClickFunnels matches on email. Custom attributes are text, so a multi-select
 * is a JSON list of the same labels the Fundhub webhook already stores as an array.
 * Returns null when this is not an apply-survey handoff, or there is no email.
 */
export function applySurveyCfContact(body) {
  if (!isApplySurveyIngestBody(body)) return null;
  const d = wrapApplySurveyIngestBody(body).data || {};
  const email = String(d.email_address || "").trim();
  if (!email) return null;
  const contact = { email_address: email };
  if (d.first_name) contact.first_name = d.first_name;
  if (d.last_name) contact.last_name = d.last_name;
  if (d.phone_number) contact.phone_number = d.phone_number;
  const custom = {};
  for (const [k, v] of Object.entries(d.custom_attributes || {})) {
    if (!APPLY_SURVEY_CF_ATTR.test(k)) continue;
    const s = applySurveyAttrString(v);
    if (s) custom[k] = s;
  }
  if (Object.keys(custom).length) contact.custom_attributes = custom;
  return contact;
}

/**
 * Copy one apply-survey step onto the ClickFunnels contact.
 * No API key or no email → skip. A ClickFunnels error is swallowed so the
 * Fundhub webhook still returns 200. The browser post is unchanged.
 */
export async function syncApplySurveyClickfunnelsContact(body, { env = process.env, fetchImpl } = {}) {
  const contact = applySurveyCfContact(body);
  const apiKey = String(env?.CLICKFUNNELS_API_KEY || "").trim();
  const subdomain = String(env?.CLICKFUNNELS_SUBDOMAIN || "").trim();
  if (!contact || !apiKey || !subdomain) return { ok: false, skipped: true };
  const ctx = {};
  if (typeof fetchImpl === "function") ctx.fetch = fetchImpl;
  const workspaceId = String(env?.CLICKFUNNELS_WORKSPACE_ID || "").trim();
  if (workspaceId) ctx.workspaceId = workspaceId;
  try {
    const res = await upsertContact({ api_key: apiKey, subdomain }, contact, ctx);
    return { ok: true, id: res?.id ?? null };
  } catch (err) {
    console.error("apply-survey: clickfunnels contact —", err?.message || err);
    return { ok: false, error: "clickfunnels_refused" };
  }
}

/* --- 2b. Ingest-time client attachment and repeat-post suppression ----------
 *
 * WHY THIS EXISTS. Measured 2026-09-03: every one of the 82 `survey.submitted`,
 * 95 `entry.captured` and 6 `booking.created` rows in `events` carried
 * client_id = NULL, because this adapter emitted without one and the column is
 * only ever filled by the caller. Every query in the codebase shaped
 * `FROM events WHERE client_id = $1` was therefore blind to the whole funnel.
 * The visible cost was 51 "you never booked" texts to clients who HAD booked
 * (the no-book chase's exit check reads exactly that shape), but the blindness
 * was general, not specific to that one workflow.
 *
 * resolveClient() is the repository's one authority on "which client is this",
 * and it is idempotent.
 *
 * WHAT THIS CHANGES, EXACTLY — corrected 2026-09-04 after review, because the
 * first version of this note said more than was true. For `entry.captured` and
 * `survey.submitted` it really is the same work a moment earlier: the local
 * handlers onEntryCaptured and onSurveySubmitted already call resolveClient
 * inside this same webhook (src/handlers/client-lifecycle.mjs register()).
 *
 * For the three booking events it is NOT. Nothing is registered on
 * booking.created, booking.rescheduled or booking.cancelled, so a ClickFunnels
 * delivery that carries only an appointment now calls resolveClient where
 * nothing used to. On a customer we have never seen that writes a new `clients`
 * row, and — only when GHL_API_KEY is set and the dry-run fence is down — syncs
 * that contact to the CRM. Both are the ordinary behaviour of resolveClient on
 * every other funnel event; what is new is that a booking-only webhook reaches
 * it. No new outbound call is written here; the existing ADAPTERS fence still
 * governs the CRM one.
 *
 * It never blocks the webhook. A resolver failure means the event is written
 * exactly as it is written today — with a null client — rather than the whole
 * delivery 500ing and ClickFunnels retrying it.
 */
async function resolveIngestClientId(db, orgId, evt) {
  if (!orgId || !evt || !evt.email) return null;
  try {
    return await resolveClient(db, {
      orgId,
      payload: {
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        source: "clickfunnels"
      }
    });
  } catch (err) {
    console.warn(
      `[clickfunnels] could not attach a client at ingest (event kept, client_id null): ` +
      `${String(err?.message || err)}`
    );
    return null;
  }
}

/* ClickFunnels posts one webhook PER SURVEY SCREEN, plus retries — 82 events
 * for 5 real surveys on 2026-09-03. Each carries a different CF submission id,
 * so the `clickfunnels:<id>:<name>` idempotency key is distinct every time and
 * the bus rightly stores all of them.
 *
 * They are not, however, sixteen surveys, and the durable workflows that
 * trigger off them are what turn one survey into sixteen text-message runs.
 * So a repeat post is still WRITTEN — its later screens carry answers the first
 * post did not have, and `onSurveySubmitted` merges each one onto the client;
 * dropping them would lose the survey and with it the "Survey Complete" stage —
 * but it does NOT start a second durable run.
 *
 * The window is deliberately long. A person filling one survey spreads their
 * posts over minutes; a person who genuinely starts again the same afternoon
 * does not need a second chase.
 */
export const FUNNEL_REPEAT_WINDOW_MINUTES = 6 * 60;

/* booking.created is left out on purpose: it already has slot-level dedupe
   below (findBookingBySlot), and a second booking is a real second appointment
   that its workflows must see. */
const REPEAT_SUPPRESSED_EVENTS = new Set(["survey.submitted", "entry.captured"]);

async function isRepeatFunnelPost(db, { orgId, name, email, funnel }) {
  if (!orgId || !email) return false;
  try {
    const { rows } = await db.query(
      `SELECT 1
         FROM events
        WHERE org_id = $1
          AND name = $2
          AND lower(payload->>'email') = $3
          AND COALESCE(payload->>'funnel', '') = $4
          AND created_at > now() - make_interval(mins => $5)
        LIMIT 1`,
      [orgId, name, String(email).toLowerCase(), String(funnel || ""), FUNNEL_REPEAT_WINDOW_MINUTES]
    );
    return rows.length > 0;
  } catch (err) {
    /* Never let the look-back decide the delivery. If it cannot be answered the
       event behaves exactly as it does today. */
    console.warn(`[clickfunnels] repeat-post check failed (treating as first): ${String(err?.message || err)}`);
    return false;
  }
}

/** Same calendar slot from the form post and the later appointment webhook. */
async function findBookingBySlot(db, orgId, email, startTime) {
  if (!orgId || !email || !startTime) return null;
  const { rows } = await db.query(
    `SELECT id, client_id, provider_uid
       FROM bookings
      WHERE org_id = $1
        AND lower(attendee_email) = $2
        AND starts_at IS NOT DISTINCT FROM $3::timestamptz
      LIMIT 1`,
    [orgId, String(email).toLowerCase(), startTime]
  );
  return rows[0] || null;
}

async function promoteBookingUid(db, { orgId, existing, nextUid, meetingUrl }) {
  if (!existing || !nextUid || existing.provider_uid === nextUid) return;
  await db.query(
    `UPDATE bookings
        SET provider_uid = $1,
            meeting_url = COALESCE($2, meeting_url)
      WHERE org_id = $3 AND id = $4`,
    [nextUid, meetingUrl || null, orgId, existing.id]
  );
  if (existing.client_id && existing.provider_uid) {
    await db.query(
      `UPDATE tasks SET body = $1 WHERE client_id = $2 AND body = $3`,
      [nextUid, existing.client_id, existing.provider_uid]
    );
  }
}

/* A CALL BOOKED BEFORE THE CALL-ID FIX IS SAVED UNDER A MESSAGE ID.
   Its move or cancel now arrives under the call's own id, which no saved row
   carries, so the handlers would make a second booking (move) or close nothing
   (cancel). Before the event is emitted, re-key that one earlier row to the
   call id — the same re-key the slot match above does for a form post.

   Narrow on purpose, and only ever when NO row holds the call id yet:
     cancel      → a live ClickFunnels booking for this email at EXACTLY the
                   call's time (a cancel carries the call's own time);
     reschedule  → the ONE live upcoming ClickFunnels booking for this email (a
                   move carries the NEW time, so the old time cannot be matched).
   Zero or two-plus candidates → nothing is touched, and the handlers behave as
   they always have. Never blocks the webhook. */
async function adoptEarlierBooking(db, { orgId, evt, cancel }) {
  if (!orgId || !evt || !evt.email || !evt.callId) return null;
  try {
    const held = await db.query(
      `SELECT id FROM bookings WHERE org_id = $1 AND provider_uid = $2 LIMIT 1`,
      [orgId, evt.callId]
    );
    if (held.rows && held.rows.length) return null;
    const slot = cancel ? evt.startTime || null : null;
    if (cancel && !slot) return null;
    const { rows } = await db.query(
      `SELECT id, client_id, provider_uid
         FROM bookings
        WHERE org_id = $1
          AND lower(attendee_email) = $2
          AND source = 'clickfunnels'
          AND COALESCE(status, 'booked') IN ('booked', 'rescheduled')
          AND starts_at >= now() - interval '1 day'
          AND ($3::timestamptz IS NULL OR starts_at = $3::timestamptz)
        ORDER BY starts_at ASC
        LIMIT 2`,
      [orgId, String(evt.email).toLowerCase(), slot]
    );
    if (!rows || rows.length !== 1) return null;
    await promoteBookingUid(db, { orgId, existing: rows[0], nextUid: evt.callId, meetingUrl: null });
    return rows[0].id;
  } catch (err) {
    console.warn(`[clickfunnels] earlier booking not re-keyed to call ${evt.callId}: ${String(err?.message || err).slice(0, 160)}`);
    return null;
  }
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Appointments → booking.* only (never entry.captured).
// Calendar form posts (form_submission with a start time) → booking.created.
//   The thank-you page can paint before appointments/scheduled_event.created.
// Other opt-in / form submissions → entry.captured (+ survey.submitted when answers).
// Returns [] when there is no email (nothing to emit).
export function mapToCanonical(evt) {
  if (!evt || !evt.email) return [];

  const type = String(evt.type || "").toLowerCase();
  if (type === APPOINTMENT_CREATED) return [{ name: "booking.created" }];
  if (type === APPOINTMENT_RESCHEDULED) return [{ name: "booking.rescheduled" }];
  if (type === APPOINTMENT_CANCELED) return [{ name: "booking.cancelled" }];
  if (isFormSubmissionType(type) && evt.startTime) return [{ name: "booking.created" }];

  const out = [];
  out.push({ name: "entry.captured" });
  if (evt.answers !== null && evt.answers !== undefined) {
    out.push({ name: "survey.submitted" });
  }
  return out;
}

// --- Adapter entrypoint -----------------------------------------------------
// handleClickFunnelsWebhook({ db, rawBody, signatureHeader, secret, headers })
//   → { ok, status, emitted: [{name, id, deduped}], reason? }
// Verifies signature (fail-closed), parses JSON, maps to canonical events, and
// emits each via the bus. Idempotency key: `clickfunnels:<eventId>:<canonicalName>`.
export async function handleClickFunnelsWebhook({
  db,
  rawBody,
  signatureHeader,
  secret,
  headers,
  env = process.env,
  fetchImpl
}) {
  let body;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false, status: 400, reason: "invalid_json", emitted: [] };
  }

  const ingestSecret = env.CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET;
  const applyIngest =
    isApplySurveyIngestBody(body) && verifyApplySurveyIngestHeader(headers, ingestSecret);
  let applySurveyFlat = null;

  if (!applyIngest) {
    const sig =
      signatureHeader ||
      headerValue(headers, "x-webhook-clickfunnels-signature") ||
      headerValue(headers, "x-clickfunnels-signature");
    const timestamp =
      headerValue(headers, "x-webhook-clickfunnels-timestamp") ||
      headerValue(headers, "x-clickfunnels-timestamp");
    if (!verifyClickFunnelsSignature(rawBody, sig, secret, timestamp)) {
      return { ok: false, status: 401, reason: "bad_signature", emitted: [] };
    }
  } else {
    applySurveyFlat = body;
    body = wrapApplySurveyIngestBody(body);
  }

  // CF_CAPTURE_MODE — raw payload capture for adapter correction (CF Classic vs
  // 2.0 field-path drift, see the header note above). Fires after signature
  // verify + JSON parse succeed, so only real deliveries are captured. A capture
  // failure must never block the normal processing path below — try/catch and
  // move on.
  if (process.env.CF_CAPTURE_MODE === "1") {
    try {
      await db.query(
        `INSERT INTO webhook_captures (provider, headers, raw_body, parsed)
         VALUES ($1,$2,$3,$4)`,
        ["clickfunnels", JSON.stringify({ "x-cf-signature": signatureHeader || null }), rawBody, JSON.stringify(body)]
      );
    } catch (err) {
      console.warn(`[clickfunnels] webhook capture failed (non-fatal): ${String(err?.message || err)}`);
    }
  }

  // SLO paid path: resolve from owner map + fundhub_client_id. Never email/price.
  const purchase = await handleSloPaidWebhook(db, body);

  const evt = normalizeClickFunnelsEvent(body);

  if (!evt.email) {
    const reason = purchase.reason && purchase.reason !== "not_paid_event"
      ? purchase.reason
      : "no_email";
    return { ok: true, status: 200, reason, emitted: [], purchase };
  }

  const canonical = mapToCanonical(evt);
  if (canonical.length === 0) {
    return { ok: true, status: 200, reason: "no_canonical_events", emitted: [] };
  }

  /* Resolved ONCE for the whole delivery, before the first emit, so every event
     this webhook produces names the same client. */
  const ingestOrgId = await defaultOrgId(db);
  const ingestClientId = await resolveIngestClientId(db, ingestOrgId, evt);

  /* Keep fbc / fbp on the client (blanks only — first touch). Never blocks the
     delivery: a failure here costs one Meta match key, not a lead. */
  if (ingestClientId && (evt.metaClickIds?.fbc || evt.metaClickIds?.fbp)) {
    try {
      await storeClientMetaClickIds(db, {
        orgId: ingestOrgId,
        clientId: ingestClientId,
        fbc: evt.metaClickIds.fbc,
        fbp: evt.metaClickIds.fbp
      });
    } catch (err) {
      console.warn(`[clickfunnels] meta click ids not stored: ${String(err?.message || err).slice(0, 160)}`);
    }
  }

  const emitted = [];
  for (const c of canonical) {
    let payload;
    if (c.name === "survey.submitted") {
      payload = {
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        funnel: evt.funnel,
        source: "clickfunnels",
        answers: evt.answers,
        a1: evt.a1,
        a2: evt.a2,
        attribution: evt.attribution || null
      };
    } else if (
      c.name === "booking.created" ||
      c.name === "booking.rescheduled" ||
      c.name === "booking.cancelled"
    ) {
      // Same booking payload shape the handlers already read.
      payload = {
        bookingUid: evt.bookingUid,
        startTime: evt.startTime,
        endTime: evt.endTime,
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        meetingUrl: evt.meetingUrl,
        rescheduleUid: evt.rescheduleUid,
        source: "clickfunnels"
      };
    } else {
      payload = {
        email: evt.email,
        name: evt.name,
        phone: evt.phone,
        funnel: evt.funnel,
        source: "clickfunnels",
        a1: evt.a1,
        a2: evt.a2,
        attribution: evt.attribution || null
      };
    }

    const idKey = evt.id ? `clickfunnels:${evt.id}:${c.name}` : undefined;

    if (c.name === "booking.created") {
      const existing = await findBookingBySlot(db, ingestOrgId, evt.email, evt.startTime);
      if (existing) {
        await promoteBookingUid(db, {
          orgId: ingestOrgId,
          existing,
          nextUid: payload.bookingUid,
          meetingUrl: payload.meetingUrl
        });
        emitted.push({ name: c.name, id: existing.id, deduped: true, repeat: true, startedRun: false });
        continue;
      }
    }

    if (c.name === "booking.rescheduled" || c.name === "booking.cancelled") {
      await adoptEarlierBooking(db, {
        orgId: ingestOrgId,
        evt,
        cancel: c.name === "booking.cancelled"
      });
    }

    /* A repeat post of a survey already in flight: still stored, still merged
       onto the client by the local handlers, but no second durable run. */
    const repeat = REPEAT_SUPPRESSED_EVENTS.has(c.name)
      ? await isRepeatFunnelPost(db, {
        orgId: ingestOrgId,
        name: c.name,
        email: evt.email,
        funnel: evt.funnel
      })
      : false;

    const res = await emit(db, c.name, payload, {
      idempotencyKey: idKey,
      orgId: ingestOrgId,
      clientId: ingestClientId,
      skipInngest: repeat
    });
    emitted.push({
      name: c.name,
      id: res.id,
      deduped: res.deduped,
      clientId: ingestClientId,
      repeat,
      // The one fact this lane exists to control: did this delivery start a
      // durable workflow run (a text-message cadence), or only record data?
      startedRun: !repeat && !res.deduped
    });
  }
  let clickfunnelsContact = null;
  if (applySurveyFlat) {
    clickfunnelsContact = await syncApplySurveyClickfunnelsContact(applySurveyFlat, { env, fetchImpl });
  }
  return { ok: true, status: 200, emitted, purchase, clickfunnelsContact };
}
