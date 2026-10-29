// Comms + booking handlers — Master Rebuild Spec Phase 2 (reactions layer, batch 2).
//
// The journey-spine handlers live in client-lifecycle.mjs; these cover the
// communication + scheduling side events:
//   message.inbound (Twilio SMS, and Mailgun email from a client's own address)
//                                 -> messages row (inbound, channel off the payload)
//   call.completed  (Bland voice) -> messages row (channel=voice, outbound)
//   mail.response   (Mailgun)     -> bank_inbox row (classified bank email)
//   booking.created (ClickFunnels) -> tasks row (closer follow-up on the booking)
//
// Idempotent (Rule 9): messages dedupe on (org, provider_ref) via migration 004;
// bank_inbox + tasks self-dedupe with a guard SELECT keyed by the event id /
// booking uid, so replay() re-drives events without duplicating rows.
//
// resolveClient (create-if-missing by email) is reused from client-lifecycle for
// booking.created; the SMS/mail/voice handlers only LINK to an existing client
// (they must not mint a client from an inbound message — could be spam).
//
// THREADING. The two handlers that write `messages` also maintain the client's
// `conversations` row for that channel and fill in messages.conversation_id.
// Until now both were left NULL, so the conversations table, idx_messages_convo
// and fk_messages_convo all existed with nothing on either end. The writer lives
// in src/conversations/store.mjs; see threadMessage() below for why it swallows
// its own failures and where last_pulse_at comes from. Nothing here writes
// `sentiment` — no code in this repo computes Hot/Warm/Cold.

import { on } from "../events/registry.mjs";
import { db as platformDb, pool as platformPool } from "../db.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import { recordOptOut, recordOptIn } from "../lib/opt-out.mjs";
import { createTask } from "../lib/create-task.mjs";
import { createBlueprintCoachStopTask } from "../blueprint/coach-exception.mjs";
import { isInterviewBooking } from "../insights/meet.mjs";
import { addTags } from "../workflows/tags.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { advanceCardToStage } from "../workflows/cards.mjs";
import { threadMessage as threadStoredMessage } from "../conversations/store.mjs";
import { completedCallBody } from "../lib/outbound-calls.mjs";
// One phone-matching rule for the whole repo — see the note on the export.
import { phoneCandidates } from "../mail/suppression.mjs";
import { clientIdForRepPhone } from "../auth/authorized-rep.mjs";
// Bookings are stored as bookings now, not only as a to-do. See the booking
// section below and db/migrations/225_bookings.sql.
import {
  upsertBooking, findByProviderUid, setStatusByProviderUid, normalizeProviderUid,
  BOOKING_STATUS, UNKNOWN_SOURCE
} from "../bookings/store.mjs";
import { completeSloNurtureTasks, isSloPostPurchaseEnabled } from "../slo/purchase.mjs";

// TCPA standard opt-out and opt-in keyword sets (case-insensitive, trimmed).
const STOP_KEYWORDS  = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_KEYWORDS = new Set(["START", "UNSTOP"]);

/* EMAIL GETS A NARROWER SET, ON PURPOSE.
   The list above is the right one for a text message, where the whole channel
   is one conversation and a one-word reply can only be about it. Email is not
   that. A client who replies "CANCEL" to a booking confirmation means cancel
   the meeting, and "END" / "QUIT" are no clearer. Honouring those as an email
   opt-out would quietly cut somebody off from the updates about their own
   credit file — a worse outcome than missing one ambiguous word, which the
   unsubscribe link and the provider's own unsubscribe signal both still catch.
   What stays are the words that cannot mean anything else. */
const EMAIL_STOP_KEYWORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "REMOVE", "OPT OUT", "OPTOUT", "OPT-OUT"
]);

/* Which list applies to which channel. That email HAS one is the whole of
   T5-01: an emailed "STOP" used to fall straight past the opt-out branch and
   be filed as an ordinary message, so the next campaign mailed them again. */
const STOP_BY_CHANNEL  = { sms: STOP_KEYWORDS, email: EMAIL_STOP_KEYWORDS };
const START_BY_CHANNEL = { sms: START_KEYWORDS, email: START_KEYWORDS };

/* Digits-only, written to match the expression in idx_clients_phone_digits
   (066_mail_suppression_indexes.sql:107) EXACTLY, or the index is not used. */
const PHONE_DIGITS_SQL = `regexp_replace(phone, '[^0-9]', '', 'g')`;

// Non-creating lookup: match an existing client by email or phone. Returns id|null.
async function findClient(db, orgId, { email, phone } = {}) {
  if (!orgId) return null;
  const em = String(email || "").trim().toLowerCase();
  if (em) {
    const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2 LIMIT 1`, [orgId, em]);
    if (r.rows[0]) return r.rows[0].id;
  }
  const ph = String(phone || "").trim();
  if (ph) {
    /* EXACT TEXT FIRST, DIGITS SECOND. Twilio sends E.164 (+15551234567) and
       this column is free text — 30 of 32 live records are E.164 and two are
       not (measured against production 2026-08-18). An exact hit is
       unambiguous so it is tried first; the digits-only pass is what stops a
       client stored as "(555) 123-4567" resolving to nobody, which used to
       mean their STOP was filed as an unthreaded message with no opt-out. */
    const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`, [orgId, ph]);
    if (r.rows[0]) return r.rows[0].id;
    /* phoneCandidates emits both the 10-digit and the 11-digit form, because
       "+15551234567" and "(555) 123-4567" are one person and this repo stores
       whichever the source system happened to send. It refuses anything it
       cannot read as a NANP number rather than guessing at a country. */
    const candidates = phoneCandidates(ph);
    if (candidates.length) {
      const d = await db.query(
        `SELECT id FROM clients WHERE org_id=$1 AND ${PHONE_DIGITS_SQL} = ANY($2) LIMIT 1`,
        [orgId, candidates]
      );
      if (d.rows[0]) return d.rows[0].id;
    }
    const repFile = await clientIdForRepPhone(db, orgId, ph);
    if (repFile) return repFile;
  }
  return null;
}

/* THREADING — messages.conversation_id used to be left NULL by both writers
   below, so `conversations`, `idx_messages_convo` and fk_messages_convo all
   existed with nothing on either end of them. These two helpers close that.

   THE MESSAGE ROW IS THE SOURCE OF THE PULSE TIME. Neither the Twilio nor the
   Bland payload carries a timestamp — normalizeTwilioEvent yields
   {from,to,body,sid,...} and Bland's yields {callId,status,disposition,
   durationSec,transferred} — so last_pulse_at comes from the messages row's own
   created_at, returned by the INSERT. That is a real recorded fact rather than
   a new Date() invented at handler time, and on the dedupe path it stays the
   ORIGINAL message's time instead of drifting forward on every redelivery.

   FAILURE HERE MUST NOT LOSE THE MESSAGE. The messages row is the record of
   what a client actually said; the conversation row is an index over it. If the
   thread write fails, the message insert has already committed and must stay
   committed, so this logs and swallows rather than throwing back into dispatch()
   — a throw would dead-letter an event whose primary work succeeded, and a
   retry of it would then re-run the whole handler. */

// The already-stored row behind a provider_ref, for the ON CONFLICT DO NOTHING
// path where the INSERT returns no row because the message is a redelivery.
async function findMessageByRef(db, orgId, providerRef) {
  if (!providerRef) return null;
  const r = await db.query(
    `SELECT id, created_at FROM messages WHERE org_id=$1 AND provider_ref=$2 LIMIT 1`,
    [orgId, providerRef]
  );
  return r.rows[0] || null;
}

// Find the row this webhook wrote, then hand it to the shared threader.
// `channel` is passed in by the caller as the exact value it wrote to
// messages.channel — no parallel vocabulary is minted here.
//
// THE UPSERT-AND-LINK ITSELF MOVED to src/conversations/store.mjs, unchanged,
// because it lived here as a private function and so only these two webhook
// handlers ever threaded anything. Every workflow send left conversation_id
// NULL and the staff inbox — which lists `conversations` — could not find those
// clients by name. What is left here is the part that is genuinely this file's:
// a webhook may be a retry, so the row may already exist under its provider_ref.
async function threadMessage(db, { orgId, clientId, channel, inserted, providerRef }) {
  // conversations.client_id is NOT NULL, and these handlers deliberately do not
  // mint a client from an inbound message (it could be spam). An SMS from an
  // unrecognised number therefore has no thread to join; it stays a messages row
  // with conversation_id NULL, which is the honest state, not a bug.
  if (!clientId) return null;
  const message = inserted || (await findMessageByRef(db, orgId, providerRef).catch(() => null));
  if (!message) return null;
  return threadStoredMessage(db, {
    orgId,
    clientId,
    channel,
    messageId: message.id,
    createdAt: message.created_at || null,
    source: "comms"
  });
}

// message.inbound — a client contacting us. SMS from Twilio, or email from
// Mailgun when the From address matches a client record (see the note at the
// bottom of handleMailgunWebhook). Link to the client if known.
// Handles TCPA STOP/START keywords before logging the message row.
//
// CHANNEL-DRIVEN, NOT SMS-WITH-EXCEPTIONS. `channel` has been read off the
// payload since this handler was written; what follows now honours it in the
// two places that were still assuming a text:
//
//   the client lookup — `from` is a phone number on sms and an email address on
//     email, and asking `WHERE phone = 'someone@example.com'` matches nothing.
//     The adapter resolves the client itself and passes it as event.clientId, so
//     this is the fallback path rather than the usual one, but a fallback that
//     silently cannot succeed is worse than no fallback: it turns a resolvable
//     client into an unthreaded message with no error anywhere.
//
//   the subject — email has one and SMS does not. It is stored on the row
//     (111_messages_address) so the thread can show what the client's reply was
//     about, which for an email is frequently the only thing above the fold.
//
// THE STOP/START BRANCH NOW COVERS EMAIL TOO — changed 2026-08-18, T5-01.
//
// It used to be guarded on `channel === "sms"`, and the comment here argued
// that was correct because an email is not a TCPA text message and its words
// are not TCPA opt-out keywords. The first half of that is true and the second
// half does not follow. A person who replies to our email with nothing but the
// word STOP has told us to stop, whatever statute the word came from; CAN-SPAM
// requires we honour it, and on 2026-08-18 a live client did exactly that and
// we recorded nothing (message e9a17306, opt_outs still empty).
//
// The opt-out is written to channel='email', so it suppresses email and only
// email — src/lib/opt-out.mjs keys on (client_id, channel) and the send gate
// reads it per channel. A person who stops our email still gets their texts.
//
// Which words count is deliberately NOT the same list per channel; see
// EMAIL_STOP_KEYWORDS above for why "CANCEL" is an SMS opt-out and not an
// email one. Matching stays whole-body and exact after trim + uppercase, so a
// sentence that merely contains the word is a normal message, not an opt-out.
export async function onMessageInbound(event, db) {
  const p = event.payload || {};
  const channel = p.channel || "sms";
  const clientId = event.clientId || (await findClient(db, event.orgId,
    channel === "email" ? { email: p.from } : { phone: p.from }));
  const word = String(p.body || "").trim().toUpperCase();
  const providerRef = p.sid || null;
  const stopWords  = STOP_BY_CHANNEL[channel];
  const startWords = START_BY_CHANNEL[channel];
  if (clientId && stopWords) {
    if (stopWords.has(word)) {
      await recordOptOut(db, clientId, event.orgId, channel, "inbound_keyword");
      if (channel === "sms") {
        await createBlueprintCoachStopTask(db, {
          orgId: event.orgId,
          clientId,
          providerRef: p.sid || null,
          channel
        });
      }
    } else if (startWords && startWords.has(word)) {
      await recordOptIn(db, clientId, channel);
    }
  }
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status, subject)
     VALUES ($1,$2,'inbound',$3,$4,$5,$6,'received',$7)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id, created_at`,
    // NULL on SMS, which has no subject — not an empty string. The schema-wide
    // rule is that NULL means "there isn't one" and must survive.
    [event.orgId, clientId, channel, p.body || null, p.source || "twilio", providerRef,
     channel === "email" ? (p.subject || null) : null]
  );
  await threadMessage(db, {
    orgId: event.orgId,
    clientId,
    channel,
    inserted: (ins.rows || [])[0] || null,
    providerRef
  });
}

// call.completed — a finished Bland voice call. Logged as a voice message row.
// Closer dispositions emit the same event name with disposition: "closer" and
// no Bland callId — those are not voice rows.
export async function onCallCompleted(event, db) {
  const p = event.payload || {};
  if (p.disposition === "closer") return;
  const clientId = event.clientId || null;
  const providerRef = p.callId || null;
  const transcript = typeof p.transcript === "string" && p.transcript.trim() ? p.transcript.trim() : null;
  const body = completedCallBody(p);
  const ins = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body, provider, provider_ref, status)
     VALUES ($1,$2,'outbound','voice',$3,$4,$5,$6)
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO UPDATE
       SET rendered_body = CASE WHEN $7::text IS NOT NULL THEN EXCLUDED.rendered_body
                                ELSE COALESCE(messages.rendered_body, EXCLUDED.rendered_body) END
       WHERE messages.client_id IS NOT DISTINCT FROM EXCLUDED.client_id
     RETURNING id, created_at`,
    [event.orgId, clientId, body, p.source || "bland", providerRef, p.status || "completed", transcript]
  );
  await threadMessage(db, {
    orgId: event.orgId,
    clientId,
    // 'voice' is the literal this handler already writes to messages.channel.
    channel: "voice",
    inserted: (ins.rows || [])[0] || null,
    providerRef
  });
}

// mail.response — a classified bank email (Mailgun). Deduped by event id in raw.
export async function onMailResponse(event, db) {
  const p = event.payload || {};
  const clientId = event.clientId || (await findClient(db, event.orgId, { email: p.from }));
  const dup = await db.query(
    `SELECT 1 FROM bank_inbox WHERE org_id=$1 AND raw->>'__event_id'=$2 LIMIT 1`,
    [event.orgId, String(event.id)]
  );
  if (dup.rows[0]) return;
  const raw = { ...p, __event_id: event.id };
  /* THE PREVIEW IS THE PREVIEW, NOT THE SUBJECT AGAIN.

     This used to bind `p.subject` to BOTH the subject column and the
     body_preview column, so every row on the Bank Inbox card showed the same
     sentence twice and the actual text of the email was never stored anywhere.
     That is what destroyed the paragraph where the bank states how much it
     approved — see the note above DOLLAR_SCAN in src/adapters/mailgun.mjs.

     It also silently disabled the fallback the screen was written to use.
     public/app/client-control-panel.html paints
     `body_preview || classification || received_at`, and a body_preview that is
     always populated means the classification and the date can never show.

     NULL when there is no preview, never "". The adapter sends null for an
     email with no text at all, and an empty string here would defeat the
     fallback exactly the way the subject copy did. */
  const rawPreview = p.bodyPreview;
  const preview = (typeof rawPreview === "string" && rawPreview.trim() !== "") ? rawPreview : null;
  await db.query(
    `INSERT INTO bank_inbox (org_id, client_id, classification, subject, body_preview, raw)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [event.orgId, clientId, p.classification || null, p.subject || null, preview, JSON.stringify(raw)]
  );
}

/* ==========================================================================
   BOOKINGS
   ==========================================================================

   *** THESE FOUR HANDLERS USED TO CALL EVERY BOOKING A CAL.COM BOOKING. ***

   `sourceWorkflow: "calcom"` was a hardcoded string, and three of the four
   lookups below filtered on `source_workflow = 'calcom'` to find the row it
   wrote. Nothing checked whether that was true. It was not: the public booking
   page (apply.fundhub.ai/funding-book-call) is a ClickFunnels page driven by
   Cronofy, the literal "cal.com" appears nowhere in it, and CALCOM_WEBHOOK_SECRET
   has never been set — so the Cal.com adapter has never had a sender. Measured
   against the live database on 2026-08-18: of 31 booking.created events, the
   payload's own `source` is clickfunnels on 27, gauntlet-all on 2, gauntlet on
   1, sim on 1, and calcom on NONE, while all 16 booking tasks read 'calcom'.
   Every booking in the system was filed under a vendor that never sent one.

   THE SOURCE NOW COMES OFF THE PAYLOAD (bookingSource below). When the payload
   names no source, the fallback is UNKNOWN_SOURCE — "we were not told" — and
   never 'calcom'. Guessing a plausible vendor is what produced this bug.

   *** AND THAT IS WHY THE LOOKUPS NO LONGER FILTER ON THE SOURCE LABEL. ***

   This is the part that breaks things if it is rushed. The moment new rows
   start being written as 'clickfunnels' while the reschedule and cancel
   queries still hunt for 'calcom', those queries match nothing: a reschedule
   stops updating the booking it belongs to and creates a SECOND task instead,
   and a cancellation quietly closes nothing. The 16 existing rows are the same
   problem from the other side — migration 225 relabels them 'clickfunnels', so
   a query pinned to either single label misses half the table.

   A booking is therefore matched by the one thing that identifies it and does
   not change: the provider's booking id, in tasks.body. The label is not part
   of the key at all. The title guard (BOOKING_TASK_TITLE_LIKE) is what keeps
   that from being too wide — it restricts the match to this pipeline's own
   rows, so a task from some other workflow that happened to store the same
   string in `body` can never be mistaken for a booking. Title and guard come
   from one constant so they cannot drift apart. */

const BOOKING_TITLE_PREFIX = "Strategy session";
const TITLE_BOOKED = `${BOOKING_TITLE_PREFIX} booked`;
const TITLE_RESCHEDULED = `${BOOKING_TITLE_PREFIX} rescheduled`;
/* Bound as a parameter, never interpolated into the SQL text. */
const BOOKING_TASK_TITLE_LIKE = `${BOOKING_TITLE_PREFIX}%`;

/* The TRUE origin of a booking, off the event payload. Honest fallback only:
   an unnamed source is recorded as unknown, not as a vendor we invented. */
const bookingSource = (p) => {
  const s = String((p && p.source) || "").trim();
  return s || UNKNOWN_SOURCE;
};

/* THE BOOKING ID, TIDIED THE SAME WAY THE bookings TABLE TIDIES IT.

   These handlers used to bind the provider's raw string straight into the
   `tasks` queries below while src/bookings/store.mjs trimmed it, so a provider
   that sent " AbC-1 " once and "AbC-1" the next time produced ONE booking and
   TWO tasks: the dedup lookup missed, and the closer got a second follow-up for
   a call that had never moved. One normaliser, imported, used by both layers —
   never a second local copy, because a second copy is how they drifted. */
const bookingUid = (p) => normalizeProviderUid(p && p.bookingUid);

/* Store the booking as a booking (db/migrations/225_bookings.sql).

   The booking.created path calls this with strict=true BEFORE creating the
   closer task: a rejected provider identity or failed INSERT is NOT a booked
   sale call and must not create staff activity. Other historical event paths
   preserve their best-effort behavior and record failures for reconciliation. */
async function recordBooking(db, event, p, clientId, status, { strict = false } = {}) {
  if (!event.orgId) return null;
  try {
    return await upsertBooking(db, {
      orgId: event.orgId,
      clientId,
      source: bookingSource(p),
      providerUid: bookingUid(p),
      // NULL STAYS NULL. A booking whose provider sent no start time keeps an
      // unknown start; it is never backfilled with the event's own arrival
      // time, which would put a meeting on the calendar nobody scheduled.
      startsAt: p.startTime || null,
      endsAt: p.endTime || null,
      status,
      meetingUrl: p.meetingUrl || null,
      attendeeEmail: p.email || null,
      attendeeName: p.name || null,
      eventTypeSlug: p.eventTypeSlug || p.eventType || null,
      // THE EVENT ID IS WHAT MAKES A UID-LESS BOOKING SURVIVE A REPLAY.
      // A booking with no provider id is outside the uid index, so without this
      // every redelivered webhook — and every pass of src/events/bus.mjs
      // replay(), which re-dispatches every stored event — added another copy
      // of the same call, with no upper bound. The event id is the same for a
      // replay and different for a genuinely different booking, so it de-dupes
      // repeats without merging two calls we simply cannot tell apart.
      eventId: event.id || null,
      raw: p
    });
  } catch (err) {
    console.error(
      `[comms] bookings write failed for ${event.name} ` +
      `(uid=${bookingUid(p) || "none"}): ${err && err.message}`
    );
    if (strict) throw err;
    return null;
  }
}

/* The terminal states — cancelled and no-show. Matches by provider uid across
   sources for the same reason the tasks queries do. Swallows failures for the
   reason above.

   *** A CANCELLATION IS NOT A BOOKING. IT NEVER CREATES ONE. ***

   This used to fall through to upsertBooking() when nothing matched, on the
   reading that "a cancellation for a booking we never stored is still something
   that happened". It is — but what it is not is a second appointment, and that
   is what the insert produced. Until 2026-10-05 src/adapters/clickfunnels.mjs
   derived the booking uid from the ClickFunnels WEBHOOK EVENT id rather than the
   appointment id (it now uses the call's own id), so a cancellation for a call
   we DID store arrived carrying a uid no creation ever used. Matching nothing
   was therefore the normal case, not the edge case, and every one of those
   cancellations invented a row: the same
   call appeared on the calendar twice — 'booked' at the original time under one
   uid, 'cancelled' under another — and listBookings() returned both.

   So an unmatched terminal event is now recorded as exactly what it is: a
   miss, logged with the uid so it can be traced back to the adapter that
   mangled it. db/migrations/225_bookings.sql's backfill 2 already takes this
   position (it only ever UPDATEs), so the live handler and the backfill finally
   agree. Nothing is lost either way — the `events` row is append-only and holds
   the cancellation forever. */
async function closeBooking(db, event, p, status) {
  const uid = bookingUid(p);
  if (!event.orgId || !uid) return null;
  try {
    const updated = await setStatusByProviderUid(db, {
      orgId: event.orgId,
      providerUid: uid,
      status
    });
    if (updated.length) return updated;
    console.warn(
      `[comms] ${event.name} matched no booking (uid=${uid}); no booking row ` +
      `was created — the event stands as the record of it`
    );
    return null;
  } catch (err) {
    console.error(
      `[comms] bookings ${status} write failed (uid=${uid}): ${err && err.message}`
    );
    return null;
  }
}

// Only matching org + appointment identities contend. Use a TRANSACTION
// scoped advisory lock, never a session lock: production may use a transaction
// pooler, and session locks can leak between tenants or unrelated requests.
// The transaction holds the identity check, lead resolution, saved booking and
// closer-task handoff together, so a losing webhook cannot mint activity.
async function withBookingUidLock(db, orgId, uid, callback) {
  const source = db === platformDb ? platformPool()
    : (typeof db?.connect === "function" && db?.options ? db : null);
  if (!orgId || !uid || !source) return callback(db);
  const client = await source.connect();
  const key = `front-booking:${orgId}:${uid}`;
  let discard = true;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))", [key]);
    const result = await callback(client);
    await client.query("COMMIT"); // releases the lock on either PG connection type
    discard = false;
    return result;
  } catch (error) {
    // A confirmed ROLLBACK ends any transaction-scoped lock. If connection
    // state remains uncertain, discard it instead of returning it to the pool.
    try {
      await client.query("ROLLBACK");
      discard = false;
    } catch (rollbackError) {
      console.error("[comms] booking transaction rollback failed", rollbackError?.message);
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

// booking.created — a scheduled call. The saved booking must win provider
// identity arbitration BEFORE a closer task, tags, pipeline and confirmation
// fields are changed. Booking writes are no longer optional on this path.
export async function onBookingCreated(event, db) {
  const p = event.payload || {};
  if (isInterviewBooking(p)) return { skipped: "interview" };
  const uid = bookingUid(p);
  // UID-less provider forms still have a durable event ID. Serialize replay
  // under that identity, but never merge two unrelated UID-less events.
  const identity = uid ? `uid:${uid}` : event.id ? `event:${event.id}` : null;
  return withBookingUidLock(db, event.orgId, identity,
    (identityDb) => onBookingCreatedLocked(event, identityDb, p, uid));
}

async function onBookingCreatedLocked(event, db, p, uid) {

  // A provider UID is an appointment identity, not permission to create or
  // transfer a customer. Check the existing appointment BEFORE resolveClient
  // creates a lead, and fail closed if that check cannot run. The source event
  // remains in the event ledger for later reconciliation.
  if (uid) {
    if (!event.orgId) return { skipped: "booking_identity_unavailable" };
    let existing;
    try {
      existing = await findByProviderUid(db, { orgId: event.orgId, providerUid: uid });
    } catch (err) {
      console.warn(`[comms] booking identity lookup unavailable: ${String(err?.message || err).slice(0, 120)}`);
      return { skipped: "booking_identity_unavailable" };
    }
    if (existing) {
      const claimedClientId = event.clientId || p.clientId || null;
      const currentEmail = String(existing.attendee_email || "").trim().toLowerCase();
      const incomingEmail = String(p.email || "").trim().toLowerCase();
      if ((existing.client_id && claimedClientId &&
           String(existing.client_id) !== String(claimedClientId)) ||
          (currentEmail && incomingEmail && currentEmail !== incomingEmail)) {
        return { skipped: "booking_client_mismatch" };
      }
      // A linked appointment may only be changed by its explicit reschedule
      // or terminal event. Repeated booking.created must never rewind a
      // reschedule, undo a cancellation, or reset customer confirmation.
      if ([BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NOSHOW, BOOKING_STATUS.COMPLETED]
        .includes(existing.status)) {
        return { skipped: "terminal_booking_replay" };
      }
      if (!existing.client_id) return { skipped: "booking_identity_unverified" };
      return { skipped: "booking_already_recorded" };
    }
  }
  // resolveClient patches the explicit customer before looking them up. For
  // booking webhooks this ID must be owned by the event's organization first;
  // a foreign ID may not edit another tenant's contact or receive a call task.
  if (event.clientId) {
    if (!event.orgId) return { skipped: "booking_client_scope_mismatch" };
    const owner = await db.query(
      "SELECT id FROM clients WHERE org_id = $1 AND id = $2 LIMIT 1",
      [event.orgId, event.clientId]
    );
    if (!owner.rows[0]) return { skipped: "booking_client_scope_mismatch" };
  }
  const clientId = await resolveClient(db, event);
  if (!clientId) return;
  const accepted = await recordBooking(db, event, p, clientId, BOOKING_STATUS.BOOKED, { strict: true });
  if (!accepted || String(accepted.client_id) !== String(clientId) ||
      accepted.status !== BOOKING_STATUS.BOOKED) {
    // Includes a losing ON CONFLICT race (the atomic bookings guard returns
    // no row). A wrong-client or terminal appointment must not create tasks.
    return { skipped: "booking_not_accepted" };
  }
  // For bookings without a provider UID, the immutable bus event ID is the
  // task dedupe key, just as it already is for the bookings-row unique index.
  const taskKey = uid || event.id || null;
  const dup = await db.query(
    `SELECT 1 FROM tasks
      WHERE client_id=$1 AND body=$2 AND title LIKE $3 LIMIT 1`,
    [clientId, taskKey, BOOKING_TASK_TITLE_LIKE]
  );
  if (!(taskKey && dup.rows[0])) {
    await createTask(db, {
      orgId: event.orgId,
      clientId,
      title: TITLE_BOOKED,
      // The provider that actually took this booking, not a hardcoded vendor.
      sourceWorkflow: bookingSource(p),
      assigneeRole: "closer",
      dueAt: p.startTime || null,
      eventId: taskKey,
      meetingUrl: p.meetingUrl || null
    });
  }
  // Mirror s-04 sync so Pipeline shows "booked" without waiting on Inngest.
  // advance only — never demote a later sales stage.
  await addTags(db, clientId, ["call:booked"]);
  await mergeCustomFields(db, clientId, {
    call_outcome: "booked",
    ...(taskKey && dup.rows[0] ? {} : { call_confirmed: false })
  });
  if (event.orgId) {
    await advanceCardToStage(db, {
      orgId: event.orgId,
      clientId,
      pipelineKey: "sales",
      stageKey: "booked"
    });
  }
  if (isSloPostPurchaseEnabled()) {
    await completeSloNurtureTasks(db, { orgId: event.orgId, clientId });
  }
}

/* booking.rescheduled — move the existing booking task rather than adding a
   second one.

   NOTE, and it is the reason the bookings table earns its place: this UPDATE
   overwrites due_at and the title IN PLACE, so on the tasks row the time the
   call was ORIGINALLY booked for is destroyed the moment it moves. Nothing on
   that row can answer "when was this first set, and how many times has it
   slipped" — which is exactly the question a closer asks about a lead that
   keeps moving the meeting. The tasks row keeps behaving as it always has,
   because the calendar and the closer queue read it; the history is kept on
   the bookings row instead, where upsertBooking() appends the superseded
   (starts_at, ends_at, status) to raw->'__history' each time the time changes. */
// A provider UID identifies one customer's appointment inside one company.
// Validate it BEFORE resolveClient(), which can patch or mint a lead, and
// BEFORE altering the closer task, tags or call-confirmed state. The same
// identity lock as booking.created serializes cancellation/reschedule races.
// A UID that has not been saved yet may still be an out-of-order event.
async function bookingChangeIdentity(db, event, p) {
  if (!event.orgId) return { skipped: "booking_identity_unavailable" };
  // Explicit event client IDs are untrusted until their organization matches.
  if (event.clientId) {
    const owner = await db.query(
      "SELECT id FROM clients WHERE org_id = $1 AND id = $2 LIMIT 1",
      [event.orgId, event.clientId]
    );
    if (!owner.rows[0]) return { skipped: "booking_client_scope_mismatch" };
  }
  const uid = bookingUid(p);
  if (!uid) return null;
  let saved;
  try {
    saved = await findByProviderUid(db, { orgId: event.orgId, providerUid: uid });
  } catch (err) {
    console.warn("[comms] booking change identity lookup unavailable:", String(err?.message || err).slice(0, 120));
    return { skipped: "booking_identity_unavailable" };
  }
  if (!saved) return null;
  const claimedId = event.clientId || p.clientId || null;
  const incomingEmail = String(p.email || "").trim().toLowerCase();
  const savedEmail = String(saved.attendee_email || "").trim().toLowerCase();
  if ((saved.client_id && claimedId && String(saved.client_id) !== String(claimedId)) ||
      (savedEmail && incomingEmail && savedEmail !== incomingEmail)) {
    return { skipped: "booking_client_mismatch" };
  }
  if (!saved.client_id) return { skipped: "booking_identity_unverified" };
  return null;
}

function bookingChangeLock(db, event, p, handler) {
  const uid = bookingUid(p);
  const identity = uid ? `uid:${uid}` : event.id ? `event:${event.id}` : null;
  return withBookingUidLock(db, event.orgId, identity, handler);
}

export async function onBookingRescheduled(event, db) {
  const p = event.payload || {};
  return bookingChangeLock(db, event, p, async (tx) => {
    const gate = await bookingChangeIdentity(tx, event, p);
    if (gate) return gate;
    const clientId = await resolveClient(tx, event);
    if (!clientId) return;
    // Persist/validate appointment ownership before touching closer tasks.
    // A rejected UID conflict or failed booking write cannot invent a handoff.
    const accepted = await recordBooking(tx, event, p, clientId, BOOKING_STATUS.RESCHEDULED, { strict: true });
    if (!accepted || String(accepted.client_id) !== String(clientId)) {
      return { skipped: "booking_not_accepted" };
    }
    const uid = bookingUid(p);
    if (uid) {
      const upd = await tx.query(
        `UPDATE tasks
            SET due_at = COALESCE($3, due_at),
                -- A moved call cannot keep the previous slot's Meet URL.
                meeting_url = CASE
                  WHEN $3::timestamptz IS NOT NULL
                   AND due_at IS DISTINCT FROM $3::timestamptz
                  THEN $4::text
                  ELSE COALESCE($4::text, meeting_url)
                END,
                title = $6, done = false, updated_at = now()
          WHERE client_id = $1 AND body = $2 AND title LIKE $5
          RETURNING id`,
        [clientId, uid, p.startTime || null, p.meetingUrl || null, BOOKING_TASK_TITLE_LIKE, TITLE_RESCHEDULED]
      );
      if (upd.rows[0]) {
        await mergeCustomFields(tx, clientId, { call_outcome: "rescheduled", call_confirmed: false });
        return;
      }
    }
    await createTask(tx, {
      orgId: event.orgId, clientId, title: TITLE_RESCHEDULED,
      sourceWorkflow: bookingSource(p), assigneeRole: "closer",
      dueAt: p.startTime || null, eventId: uid, meetingUrl: p.meetingUrl || null
    });
    await mergeCustomFields(tx, clientId, { call_outcome: "rescheduled", call_confirmed: false });
  });
}

// Cancellation and no-show must never update another buyer's appointment or
// tag a phantom customer. Recheck identity under the same lock as creation.
async function onBookingTerminal(event, db, status) {
  const p = event.payload || {};
  return bookingChangeLock(db, event, p, async (tx) => {
    const gate = await bookingChangeIdentity(tx, event, p);
    if (gate) return gate;
    const clientId = await resolveClient(tx, event);
    if (!clientId) return;
    const uid = bookingUid(p);
    if (uid) {
      await tx.query(
        `UPDATE tasks SET done = true, updated_at = now()
          WHERE client_id = $1 AND body = $2 AND title LIKE $3 AND done = false`,
        [clientId, uid, BOOKING_TASK_TITLE_LIKE]
      );
    }
    await closeBooking(tx, event, p, status);
    await mergeCustomFields(tx, clientId, {
      call_outcome: status === BOOKING_STATUS.CANCELLED ? "cancelled" : "no_show"
    });
    await addTags(tx, clientId, [
      status === BOOKING_STATUS.CANCELLED ? "call:cancelled" : "call:no_show"
    ]);
  });
}

export async function onBookingCancelled(event, db) {
  return onBookingTerminal(event, db, BOOKING_STATUS.CANCELLED);
}

export async function onBookingNoshow(event, db) {
  return onBookingTerminal(event, db, BOOKING_STATUS.NOSHOW);
}

export function register() {
  on("message.inbound", onMessageInbound);
  on("call.completed", onCallCompleted);
  on("mail.response", onMailResponse);
  on("booking.created", onBookingCreated);
  on("booking.rescheduled", onBookingRescheduled);
  on("booking.cancelled", onBookingCancelled);
  on("booking.noshow", onBookingNoshow);
}
