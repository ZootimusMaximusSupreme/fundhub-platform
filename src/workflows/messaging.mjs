// sendTemplated — shared send helper for workflow functions (Section 7 messaging
// engine + Rule 9 idempotency).
//
// Never invents copy: if `templateKey` has no row in message_templates, or the row
// hasn't passed the compliance gate, the send is a safe no-op ({ sent: false,
// reason: "template_pending" }). Real N-series SMS content is confirmed missing in
// CRM itself (Chris's own tracking note) — this is how that gap surfaces instead of
// silently sending blank/placeholder messages.
//
// Idempotent via the existing messages_org_providerref_uniq index (migration 004):
// provider_ref is synthesized from the triggering event's id, so a replayed event
// can't double-send even though this isn't a real external provider callback.
//
// STAFF TELEMETRY IS A SEAM HERE, AND IT IS EMPTY ON PURPOSE.
// `staff_events` records "this person did this thing". Every one of this
// function's 39 call sites is an Inngest workflow reacting to a system event,
// and a workflow has no staff member — so there is nobody to attribute a
// `text_sent` row to and none is written. The `staffId` argument below is the
// place a staff-initiated send would pass one; there is no such send today (no
// api/messages.mjs, no send action on any endpoint), so it is never supplied
// and no row is ever produced. That is the correct outcome, not a gap to fill
// with an invented actor. See src/shifts/TELEMETRY-CALLSITES.md.
import { isOptedOut } from "../lib/opt-out.mjs";
import { renderTemplate, stripEmptyWhereRow } from "../lib/render-template.mjs";
import { signUnsubscribeUrl } from "../messaging/unsubscribe.mjs";
import { logStaffEvent } from "../shifts/telemetry.mjs";
import { resolveShiftId } from "../shifts/attribution.mjs";
import { emit } from "../events/bus.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";
import { threadMessage } from "../conversations/store.mjs";
import { UNSUBSCRIBE_TAG_RE, unsubscribeTagValue } from "../messaging/unsubscribe.mjs";
// The one E.164 converter in the repo. Reused, not re-written (CLAUDE.md §8).
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";
import { applyRepToContext } from "../auth/authorized-rep.mjs";
import { creditTierFor } from "../config/survey-qualification.mjs";

/* Which column on the client record is the destination for a channel.
   The destination is recorded in the terms of the CHANNEL, not of whichever
   provider happens to carry it — routing can change between queueing and
   sending, and a provider that addresses by something else (the CRM relay
   addresses a contact id) resolves it live at dispatch. See 111_messages_address
   and addressFor() in src/messaging/dispatch.mjs. */
const ADDRESS_BY_CHANNEL = { email: "email", sms: "phone", voice: "phone" };

const FUNDHUB_TZ = "America/Phoenix";

/* The two funding calendars (owner-set 2026-10-29/30). /apply frames the first for a
   700-and-up score answer (700-759 or 760-850; 700-749 or 750+ on answers saved before
   2026-10-31) and the second for every other answer, "Not sure" too.
   A text or email link opens in a tab that never saw /apply, so the link itself picks
   the calendar from the saved answer, and fh_tier tells the tracker which label the
   booking carries (QualifiedSchedule / UnqualifiedSchedule). One letter: never the
   score, never the word. No readable answer: no tier, today's link. */
export const TIER_BOOKING_LINKS = Object.freeze({
  qualified: "https://apply.fundhub.ai/funding-book-call?fh_tier=q",
  unqualified: "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u"
});

export function tierBookingLink(cf = {}) {
  // creditTierFor reads a setter's correction on the call (setter_survey_edits) first.
  const tier = creditTierFor(cf || {});
  return tier ? TIER_BOOKING_LINKS[tier] : null;
}

// Several ClickFunnels posts can start separate runs for one application. Use
// the first event in the trigger's six-hour survey window as the send key, so
// even runs that were already sleeping before the ingest fix share one message.
//
// `windowMs` widens that window for a sequence that runs longer than six hours.
// S-02 passes its whole sequence window: a visit at 6 p.m. and another at 1 a.m.
// are seven hours apart, and with the six-hour window each run got its own key,
// both slept to 9 a.m. and both sent (independent review of PR #346, 2026-10-31).
// One key means the second copy of each touch hits the same provider_ref and the
// database drops it, even when both runs wake at the same second.
export const MESSAGE_COHORT_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function messageCohortId(db, { eventId, orgId, clientId, name, windowMs = MESSAGE_COHORT_WINDOW_MS, after = null }) {
  const { rows } = await db.query(
    `WITH source AS (
       SELECT id, created_at, payload FROM events
        WHERE id = $1 AND org_id = $2 AND name = $4
     )
     SELECT e.id
       FROM events e, source s
      WHERE e.org_id = $2 AND e.name = $4
        AND e.created_at <= s.created_at
        AND e.created_at > s.created_at - ($5::double precision * interval '1 second')
        AND ($6::timestamptz IS NULL OR e.created_at > $6::timestamptz)
        AND (e.client_id = $3 OR (e.client_id IS NULL
          AND lower(COALESCE(e.payload->>'email', '')) = lower(COALESCE(s.payload->>'email', ''))
          AND COALESCE(s.payload->>'email', '') <> ''))
        AND (COALESCE(e.payload->>'funnel', '') = COALESCE(s.payload->>'funnel', '')
          OR COALESCE(e.payload->>'funnel', '') = ''
          OR COALESCE(s.payload->>'funnel', '') = '')
      ORDER BY e.created_at, e.id
      LIMIT 1`,
    [eventId, orgId, clientId, name, Math.max(0, Number(windowMs) || 0) / 1000, after]
  );
  if (!rows[0]?.id) throw new Error(`message cohort missing for ${name} event ${eventId}`);
  return rows[0].id;
}

function looksLikeIsoInstant(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

/* Confirm / reminder SMS used to print the raw ISO (`2026-08-23T02:49:58.390Z`).
   formatWhen in the inquiry-remover desk view has no timezone, so this helper
   is the one merge tags use. Zone: client tz → booking tz → America/Phoenix. */
export function formatAppointmentStart(iso, timeZone) {
  if (iso == null || iso === "") return iso;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const opts = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  };
  try {
    return d.toLocaleString("en-US", { ...opts, timeZone: timeZone || FUNDHUB_TZ });
  } catch {
    return d.toLocaleString("en-US", { ...opts, timeZone: FUNDHUB_TZ });
  }
}

function resolveAppointmentTimeZone(ctx = {}) {
  const contact = ctx.contact || {};
  const appointment = ctx.appointment || {};
  return (
    contact.timezone ||
    contact.time_zone ||
    contact.tz ||
    contact.tzid ||
    appointment.timezone ||
    appointment.tz ||
    appointment.tzid ||
    FUNDHUB_TZ
  );
}

// Merge-tag context for the ported the CRM copy, which merges `{{contact.*}}` — first name,
// business name, the pre-approval amount. Every call site in src/workflows passes no
// `context`, so without this those tags resolve to nothing (and before the renderer fix
// they rendered literally, braces and all, into live SMS and email).
//
// Sourced from the client record: the identity columns off `clients`, plus the
// custom_fields jsonb that holds the 252 ported the CRM fields — which is where
// analyzer_prequal_amount and the rest of `contact.*` actually live. Columns are spread
// last so a stale same-named custom field can't shadow real identity data.
async function clientContext(db, clientId) {
  if (!clientId) return {};
  const r = await db.query(
    `SELECT first_name, last_name, email, phone, custom_fields FROM clients WHERE id = $1 LIMIT 1`,
    [clientId]
  );
  const c = r.rows[0];
  if (!c) return {};
  const fullName = [c.first_name, c.last_name].filter(Boolean).join(" ") || null;
  const base = String(process.env.APP_BASE_URL || process.env.URL || "https://fundhub.ai").replace(/\/+$/, "");
  const portalLoginUrl = `${base}/portal-login.html?email=${encodeURIComponent(c.email || "")}`;
  /* THE PORTAL ITSELF, not the sign-in page (owner-set 2026-08-29: "just send it
     to the portal"). A client who is already signed in lands on their own file
     and never sees a sign-in form. A signed-out one is bounced by
     public/app/shell.js signInUrl() to /portal-login.html — and the ?email= here
     is what it carries across, so they arrive with their address pre-filled,
     exactly where portal_login_url used to put them. Losing that parameter
     silently downgrades the signed-out journey, which is why signInUrl() reads
     it rather than this URL being cleaned up. */
  const portalUrl = `${base}/app/client-portal.html?email=${encodeURIComponent(c.email || "")}`;
  const cf = c.custom_fields || {};
  const bookingLink =
    cf.calendar_booking_link ||
    cf.booking_link ||
    tierBookingLink(cf) ||
    process.env.SALES_MEET_BOOKING_URL ||
    "https://apply.fundhub.ai/funding-book-call";
  return {
    contact: {
      ...cf,
      first_name: c.first_name ?? null,
      last_name: c.last_name ?? null,
      name: fullName,
      full_name: fullName,
      email: c.email ?? null,
      phone: c.phone ?? null,
      calendar_booking_link: bookingLink,
      booking_link: bookingLink
    },
    custom_values: { booking_link: bookingLink, portal_link: portalLoginUrl },
    calendar: { booking_link: bookingLink },
    // Used by U-02 funding delivery CTA (and any later portal buttons).
    portal_login_url: portalLoginUrl,
    /* portal_url is the portal; portal_login_url is the sign-in page. Both are
       kept because they are genuinely different destinations, and the older tag
       is already in live copy (db/seed/009, db/migrations/253) — repointing it
       would silently move six other emails. */
    portal_url: portalUrl,
    CLIENT_PORTAL_URL: portalLoginUrl,
    custom_fields: cf,
    reschedule_link: bookingLink,
    // Personified sender for template closings ({{sender_name}}).
    sender_name: "Josh",
    sender: { name: "Josh" }
  };
}

export async function sendTemplated(db, { orgId, clientId, channel, templateKey, eventId, context = {}, staffId, shiftId }) {
  // TCPA / suppression guard: skip opted-out contacts before touching any template.
  if (clientId && channel === "sms") {
    const suppressed = await isOptedOut(db, clientId, "sms");
    if (suppressed) {
      console.warn(`[sendTemplated] suppressed: client ${clientId} opted out of sms`);
      return { sent: false, reason: "opted_out" };
    }
  }

  const tpl = await db.query(
    `SELECT body, subject, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [orgId, templateKey]
  );
  const row = tpl.rows[0];
  // Keep reason "template_pending" for missing OR unapproved — every workflow
  // test and call site already keys on that string. Draft is a separate refuse.
  if (!row) return { sent: false, reason: "template_pending" };

  // Hard DRAFT guard — before compliance_passed. Flipping compliance must not
  // ship placeholder [DRAFT] copy to a real client.
  if (isDraftTemplateRow(row)) {
    console.warn(
      `[sendTemplated] blocked DRAFT template ${templateKey} for org ${orgId} — ` +
      `replace the body in the template editor before sending`
    );
    return { sent: false, reason: "draft_template" };
  }
  if (!row.compliance_passed) return { sent: false, reason: "template_pending" };

  // Loaded only once a real template exists — a template_pending no-op costs no query.
  // An explicitly-passed `context` wins over the record, so a caller can still override.
  const base = await clientContext(db, clientId);
  await applyRepToContext(db, clientId, base);

  /* {{unsubscribe}} — the client's own signed unsubscribe link (N11). Only
     for an email to a known client whose template actually holds the tag, so
     no other message changes. If the link cannot be signed (no secret) the
     tag is left out, the renderer blanks it and logs it, same as before. */
  let unsubscribe = null;
  if (channel === "email" && orgId && clientId && UNSUBSCRIBE_TAG_RE.test(String(row.body ?? ""))) {
    try {
      unsubscribe = unsubscribeTagValue({ orgId, clientId, body: row.body });
    } catch (err) {
      console.warn(`[sendTemplated] {{unsubscribe}} left blank in ${templateKey}: ${String(err?.message || err)}`);
    }
  }

  const mergeContext = {
    ...base,
    ...(unsubscribe ? { unsubscribe } : {}),
    ...context,
    contact: { ...(base.contact || {}), ...(context.contact || {}) },
    appointment: { ...(base.appointment || {}), ...(context.appointment || {}) }
  };
  if (looksLikeIsoInstant(mergeContext.appointment.start_time)) {
    mergeContext.appointment = {
      ...mergeContext.appointment,
      start_time: formatAppointmentStart(
        mergeContext.appointment.start_time,
        resolveAppointmentTimeZone(mergeContext)
      )
    };
  }
  // {{unsubscribe}} in a template footer had nothing to resolve against and
  // rendered blank (N11). Fill it with the same signed link dispatch uses.
  if (channel === "email" && clientId && mergeContext.unsubscribe == null) {
    try {
      mergeContext.unsubscribe = signUnsubscribeUrl({
        orgId, clientId, channel: "email",
        baseUrl: String(process.env.APP_BASE_URL || process.env.URL || "https://fundhub.ai").replace(/\/+$/, "")
      }).url;
    } catch (err) {
      console.warn(`[sendTemplated] {{unsubscribe}} left blank — ${String(err?.message || err)}`);
    }
  }
  const rendered = stripEmptyWhereRow(renderTemplate(row.body, mergeContext));

  // THE SUBJECT IS RENDERED, NOT COPIED. It carries the same {{contact.*}} tags
  // the body does, and an unrendered subject line is the one part of a message
  // a client sees before they open it. Templates for SMS have no subject and the
  // column stays NULL. renderTemplate on null would produce the string "null",
  // so the guard is on the value rather than the channel.
  const subject = row.subject ? renderTemplate(row.subject, mergeContext) : null;

  // Where this is addressed, as of now. Recorded rather than resolved at send
  // time so a message that waits in the queue still goes where it was written
  // to go. This pins the ADDRESS ONLY — opt-out state is still read fresh by the
  // gate at the instant of sending, which is the whole point of the gate.
  const addressField = ADDRESS_BY_CHANNEL[channel];
  const rawAddress = base.contact?.[addressField] ?? null;
  /* A PHONE DESTINATION IS PINNED IN E.164, NOT AS THE SIGN-UP FORM TYPED IT.
     Twilio refuses anything else outright — "destination is not an E.164 phone
     number" — and on 2026-09-17 that is exactly how the welcome text, the
     booking confirmation and a pay link all failed for two clients whose record
     holds "(661) 605-4248". The funnel door now converts on the way in, but
     records created before it did still hold the raw shape, and this is the last
     point the address is frozen before a provider sees it.
     A number that CANNOT be converted is written exactly as it was typed, so it
     still reaches the provider and is still rejected loudly with the error on
     the row. Nothing is dropped and nothing is guessed at. */
  const toAddress = addressField === "phone"
    ? (normalizePhone(rawAddress) || rawAddress)
    : rawAddress;

  const providerRef = `workflow:${templateKey}:${eventId}`;
  // RETURNING id so a deduped replay can be told from a real queue. It changes
  // nothing about what is written — ON CONFLICT DO NOTHING returns no row — and
  // the return value below is deliberately unchanged, because every existing
  // caller reads `sent` and a replay has always reported sent:true.
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, to_address, subject)
     VALUES ($1,$2,'outbound',$3,$4,$5,'internal',$6,'queued',true,$7,$8)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    [orgId, clientId, channel, templateKey, rendered, providerRef, toAddress, subject]
  );

  /* message.queued — announced only when a row was really written.
     A replayed event conflicts into DO NOTHING and returns no row, so a replay
     emits nothing and the event log does not grow on every replay. That is the
     same condition the staff-telemetry seam below uses, for the same reason.

     Keyed on provider_ref so the event itself is idempotent too: if this line is
     ever reached twice for one message the second emit dedupes in the bus rather
     than filing a second event.

     Non-fatal. The message row is already committed by the time this runs, and a
     bus that is unavailable must not turn a queued message into a failed send. */
  if (ins?.rows?.[0]) {
    try {
      await emit(db, "message.queued", {
        message_id: ins.rows[0].id, channel, template_key: templateKey, provider_ref: providerRef
      }, { orgId, clientId: clientId || null, idempotencyKey: `message.queued:${providerRef}` });
    } catch (err) {
      console.warn(`[sendTemplated] message.queued not emitted: ${String(err?.message || err)}`);
    }
  }

  /* THE SEAM. Inert until a staff-initiated send exists — see the header.
     Three conditions, all necessary:
       staffId   — a workflow passes none, and an unattributed row is worse than
                   no row: `staff_events` means "this person did this".
       sms       — the kind is `text_sent`. An email is not a text, and there is
                   no kind for one; filing it here would make the count a lie.
       a new row — a replayed event that deduped into DO NOTHING queued nothing,
                   so counting it would inflate one person's numbers on retry.
     Nothing below can fail the send: logStaffEvent never throws, and the message
     row is already committed by the time this runs. */
  if (staffId && channel === "sms" && ins?.rows?.[0]) {
    await logStaffEvent(db, {
      orgId,
      staffId,
      shiftId: await resolveShiftId(db, { staffId, shiftId }),
      kind: "text_sent",
      detail: { client_id: clientId ?? null, template_key: templateKey, channel, message_id: ins.rows[0].id }
      // The rendered body is NOT copied in. It is client-facing copy about a
      // consumer's file; `detail` is an index over work, not a second outbox.
    });
  }

  let messageId = ins?.rows?.[0]?.id || null;
  let createdAt = ins?.rows?.[0]?.created_at || null;
  if (!messageId && providerRef) {
    const existing = await db.query(
      `SELECT id, created_at FROM messages WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
      [orgId, providerRef]
    );
    messageId = existing.rows[0]?.id || null;
    createdAt = existing.rows[0]?.created_at || null;
  }

  /* THE THREAD. Without this the message is written and the person is not on
     the Messaging screen: api/read/inbox.mjs lists `conversations`, and every
     one of this function's 39 call sites used to write conversation_id NULL. A
     client whose only messages were automatic — the welcome email, the welcome
     text — had no row in the staff inbox at all, so searching their name found
     nothing while the company had already texted them twice.

     It runs on a replay too, not only on a fresh insert. A replayed event
     deduped into DO NOTHING above, and the row it deduped against is exactly
     the row that may still be unthreaded; skipping it here would leave the
     first send's message off the thread forever. upsertConversation GREATESTs
     the pulse and linkMessage is a plain UPDATE, so running twice changes
     nothing the second time.

     Never throws — see the helper. A thread write that fails must not turn a
     queued message into a failed send. */
  await threadMessage(db, {
    orgId, clientId, channel, messageId, createdAt, source: "sendTemplated"
  });

  return { sent: true, messageId };
}
