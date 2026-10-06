// Bookings — the read/write layer for `bookings` (db/migrations/225_bookings.sql).
//
// ALL SQL FOR BOOKINGS LIVES HERE. api/bookings.mjs is an HTTP shell — auth,
// method, shape, status codes — exactly as api/shifts.mjs is to
// src/shifts/store.mjs. That split is the house pattern and it is what lets the
// booking handlers in src/handlers/comms.mjs and the calendar endpoint share
// one definition of what a booking row is instead of two that drift.
//
//
// *** THE SOURCE LABEL IS DATA, NOT A CONSTANT. ***
//
// Nothing in this file writes 'calcom'. The origin of a booking is whatever the
// provider event said it was, and T7-05 is the record of what happens when code
// decides that for itself: every booking this system has ever taken was stamped
// 'calcom' by a hardcoded string, while the live measurement on 2026-08-18 says
// 27 of 31 came from ClickFunnels and none from Cal.com.
//
// The consequence for lookups is the important half. A booking must be findable
// by its provider id WITHOUT knowing which label was written when it was first
// stored, because the reschedule and cancel paths are the ones that break
// otherwise: they look for the row they created, miss it, and create a second
// booking. findByProviderUid() and setStatusByProviderUid() therefore do NOT
// filter on `source` — and neither does upsertBooking() any more: the unique
// index in migration 225 is keyed on (org_id, provider_uid) alone. `source` is
// a column this file writes and reads, never part of the identity of a row.
//
//
// *** A BOOKING WITH NO PROVIDER ID IS IDENTIFIED BY ITS EVENT. ***
//
// A provider is allowed to send no booking id, and two such bookings must stay
// two rows — "unknown id" is not "the same id as every other unknown". But the
// SAME uid-less booking arriving twice (a redelivered webhook, or a pass of
// src/events/bus.mjs replay(), which re-dispatches every stored event) must not
// become two rows either, and before this it did: unbounded, one more copy per
// replay, with nothing to stop it. The event's own id is the natural key —
// stable across any number of replays, different for two genuinely different
// bookings — so callers pass `eventId` and it is stored at raw->>'__event_id',
// the same place db/migrations/225_bookings.sql already records it.
//
//
// *** starts_at / ends_at NULL MEANS UNKNOWN AND MUST SURVIVE. ***
//
// No function here substitutes now(), the event time, or epoch for a missing
// start time (CLAUDE.md §12, "NULL means unknown and must survive"). A booking
// with no start time is a booking whose time we were not told; a calendar
// showing it at midnight would be a meeting nobody scheduled.
//
//
// EVERY QUERY IS SCOPED BY org_id. This is a multi-tenant product; a booking
// carries an attendee's name, email and phone-adjacent detail, and a read that
// forgot its org filter hands one company's leads to another. The functions
// that take an org REFUSE to run without one rather than dropping the clause —
// a missing filter must fail closed, not widen the query.

/**
 * BookingError — a domain failure carrying the HTTP status it should surface
 * as. Same shape as ShiftError (src/shifts/store.mjs) so an endpoint's catch
 * block maps `.status` straight onto the response.
 */
export class BookingError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "BookingError";
    this.status = status;
  }
}

/**
 * UNKNOWN_SOURCE — what `source` gets when a payload named no origin.
 *
 * `bookings.source` is NOT NULL, so something has to be written. This token is
 * that something, and the whole point of it is that it is NOT 'calcom'. It says
 * "the provider did not tell us", which is a fact; 'calcom' would have been a
 * guess, and guessing is what T7-05 is. db/migrations/225_bookings.sql uses the
 * same literal in its backfill — keep the two in step.
 */
export const UNKNOWN_SOURCE = "unknown";

/** The statuses this system writes. `status` is free text in the schema; this
 *  is the vocabulary, in one place, so a writer and a reader cannot drift on a
 *  spelling. No CHECK constraint backs it — a provider inventing a new state
 *  should land in the table, not be rejected at the door. */
export const BOOKING_STATUS = Object.freeze({
  BOOKED: "booked",
  RESCHEDULED: "rescheduled",
  CANCELLED: "cancelled",
  NOSHOW: "noshow",
  COMPLETED: "completed"
});

const COLUMNS = `id, org_id, client_id, source, provider_uid, starts_at, ends_at,
                 status, meeting_url, attendee_email, attendee_name,
                 event_type_slug, raw, created_at, updated_at`;

function requireOrg(orgId, fn) {
  if (!orgId) throw new BookingError(`${fn}: orgId is required`);
  return orgId;
}

/* Empty string is not a value. A provider that sends "" for the meeting URL has
   told us nothing, and storing "" would make `meeting_url IS NOT NULL` lie. */
const blankToNull = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * normalizeProviderUid(v) → the trimmed booking id, or null.
 *
 * *** THE ONE PLACE A BOOKING ID IS TIDIED. IMPORT IT, DO NOT RE-IMPLEMENT IT. ***
 *
 * This file trimmed the uid before storing it while src/handlers/comms.mjs bound
 * the provider's raw string into its `tasks` queries, so " AbC-1 " and "AbC-1"
 * were one booking and TWO tasks — the closer got a duplicate follow-up for a
 * call that had not moved. Two layers each deciding for themselves what counts
 * as the same id is the whole bug; there is now one answer and both use it.
 *
 * Whitespace only. Case is left alone deliberately: provider ids are
 * case-sensitive, and folding case would merge two ids a provider considers
 * different, which is a worse failure than the one being fixed.
 */
export const normalizeProviderUid = (v) => blankToNull(v);

/* A timestamp we were not given stays null. A timestamp we were given but
   cannot parse is a fault, not an absence — it throws rather than quietly
   becoming null, because a silently dropped meeting time is the failure mode
   this whole module exists to stop. */
function toTimestamp(v, field) {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new BookingError(`${field}: invalid date`);
    return v.toISOString();
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BookingError(`${field}: could not be read as a time (${String(v).slice(0, 40)})`);
  return d.toISOString();
}

/**
 * upsertBooking(db, spec) → the bookings row, or null.
 *
 * Required: orgId. Everything else is optional, because a provider is allowed
 * to be sparse and a half-known booking is still worth storing.
 *
 * *** WHICH ROW THIS UPDATES INSTEAD OF ADDING. ***
 *
 * There are two identities, and the spec picks one:
 *
 *   a provider_uid  → ON CONFLICT (org_id, provider_uid). NOT source: the same
 *                     appointment reported later under a different label, or
 *                     under no label at all, is the same appointment. Keying on
 *                     the label put one call on the calendar twice.
 *   no uid, but an  → ON CONFLICT (org_id, (raw->>'__event_id')). A replay or a
 *   eventId           redelivered webhook carries the same event id, so it
 *                     updates; two different uid-less bookings arrive on two
 *                     different events, so they stay two rows.
 *   neither         → a plain INSERT. Nothing identifies this row, so nothing
 *                     may claim it is a repeat of another. A duplicate we can
 *                     see beats a distinct booking silently swallowed.
 *
 * Both indexes are partial and both live in migration 225.
 *
 * *** WHAT THE UPDATE BRANCH KEEPS, AND WHY. ***
 *
 * Scalar fields are COALESCE(EXCLUDED.x, bookings.x): a later event that omits
 * a field does not erase what an earlier one told us. starts_at and ends_at are
 * the exception — a reschedule's whole content IS the new time, so a non-null
 * incoming time wins. A reschedule that carries no time still cannot blank the
 * old one.
 *
 * THE ORIGINAL BOOKED TIME IS NOT DESTROYED. src/handlers/comms.mjs's task
 * update overwrites due_at in place, so the time a call was first booked for is
 * gone the moment it moves. Here, when starts_at actually changes, the previous
 * (starts_at, ends_at, status) is appended to raw->'__history' with the moment
 * it was superseded. It lives inside `raw` rather than in a new column because
 * the column list for this table was specified and adding to it is not this
 * change's call to make; jsonb is exactly the right shape for "everything the
 * provider said, plus what we knew before".
 *
 * Returns null rather than throwing when the database gives back no row. A
 * booking write must never be the thing that breaks a handler whose real work
 * (the tasks row) already succeeded, and any stand-in database — the fake in
 * src/handlers/comms.test.mjs, a stub in some future test — answers SQL it does
 * not recognise with an empty result set.
 */
export async function upsertBooking(db, {
  orgId,
  clientId = null,
  source = null,
  providerUid = null,
  startsAt = null,
  endsAt = null,
  status = null,
  meetingUrl = null,
  attendeeEmail = null,
  attendeeName = null,
  eventTypeSlug = null,
  eventId = null,
  raw = null
} = {}) {
  requireOrg(orgId, "upsertBooking");

  const uid = normalizeProviderUid(providerUid);
  const evId = blankToNull(eventId);

  /* The event id rides inside `raw` rather than in a column of its own, because
     that is where db/migrations/225_bookings.sql's backfill already puts it and
     bookings_event_id_uq indexes it. One fact, one place. Only a plain object
     can carry it; anything else is stored as the provider sent it. */
  const rawOut = evId && raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...raw, __event_id: evId }
    : evId && raw == null
      ? { __event_id: evId }
      : raw;

  const params = [
    orgId,
    clientId || null,
    blankToNull(source) || UNKNOWN_SOURCE,
    uid,
    toTimestamp(startsAt, "upsertBooking: startsAt"),
    toTimestamp(endsAt, "upsertBooking: endsAt"),
    blankToNull(status),
    blankToNull(meetingUrl),
    blankToNull(attendeeEmail),
    blankToNull(attendeeName),
    blankToNull(eventTypeSlug),
    rawOut == null ? null : JSON.stringify(rawOut)
  ];

  /* No identity at all → a plain INSERT with no conflict clause. See the
     doc-comment above: an unidentifiable booking is stored, never merged. */
  const onConflict = uid
    ? `ON CONFLICT (org_id, provider_uid) WHERE provider_uid IS NOT NULL`
    : evId
      ? `ON CONFLICT (org_id, (raw->>'__event_id'))
         WHERE provider_uid IS NULL AND raw->>'__event_id' IS NOT NULL`
      : null;

  const res = await db.query(
    `INSERT INTO bookings
       (org_id, client_id, source, provider_uid, starts_at, ends_at, status,
        meeting_url, attendee_email, attendee_name, event_type_slug, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ${onConflict == null ? "" : `${onConflict}
     DO UPDATE SET
       client_id       = COALESCE(EXCLUDED.client_id,       bookings.client_id),
       starts_at       = COALESCE(EXCLUDED.starts_at,       bookings.starts_at),
       ends_at         = COALESCE(EXCLUDED.ends_at,         bookings.ends_at),
       status          = COALESCE(EXCLUDED.status,          bookings.status),
       meeting_url     = COALESCE(EXCLUDED.meeting_url,     bookings.meeting_url),
       attendee_email  = COALESCE(EXCLUDED.attendee_email,  bookings.attendee_email),
       attendee_name   = COALESCE(EXCLUDED.attendee_name,   bookings.attendee_name),
       event_type_slug = COALESCE(EXCLUDED.event_type_slug, bookings.event_type_slug),
       raw = COALESCE(bookings.raw, '{}'::jsonb)
             || COALESCE(EXCLUDED.raw, '{}'::jsonb)
             || jsonb_build_object(
                  '__history',
                  COALESCE(bookings.raw->'__history', '[]'::jsonb)
                  || CASE
                       WHEN EXCLUDED.starts_at IS NOT NULL
                        AND bookings.starts_at IS NOT NULL
                        AND EXCLUDED.starts_at IS DISTINCT FROM bookings.starts_at
                       THEN jsonb_build_array(jsonb_build_object(
                              'starts_at',     bookings.starts_at,
                              'ends_at',       bookings.ends_at,
                              'status',        bookings.status,
                              'superseded_at', now()))
                       ELSE '[]'::jsonb
                     END),
       updated_at = now()`}
     RETURNING ${COLUMNS}`,
    params
  );
  return (res && res.rows && res.rows[0]) || null;
}

/**
 * findByProviderUid(db, { orgId, providerUid }) → row | null.
 *
 * NO `source` FILTER, ON PURPOSE. See the header: the label a booking was first
 * stored under is not something a later webhook is obliged to repeat, and
 * filtering on it is the exact mistake that made every reschedule miss.
 */
export async function findByProviderUid(db, { orgId, providerUid } = {}) {
  requireOrg(orgId, "findByProviderUid");
  const uid = normalizeProviderUid(providerUid);
  if (!uid) return null;
  const res = await db.query(
    `SELECT ${COLUMNS} FROM bookings
      WHERE org_id = $1 AND provider_uid = $2
      ORDER BY created_at ASC
      LIMIT 1`,
    [orgId, uid]
  );
  return (res && res.rows && res.rows[0]) || null;
}

/**
 * setStatusByProviderUid(db, { orgId, providerUid, status }) → rows updated.
 *
 * The cancel / no-show path. Matches across sources for the reason above, and
 * returns the affected rows so a caller can tell "marked it cancelled" from
 * "there was no such booking" — the second is a real outcome here. Until
 * 2026-10-05 src/adapters/clickfunnels.mjs derived the booking uid from the
 * webhook's message id rather than the call's own id, so a cancellation arrived
 * carrying a uid no creation ever used. It now uses the call's id, and re-keys a
 * call saved the old way before its move or cancel is handled; a miss is still
 * possible for a provider that sends no stable id.
 */
export async function setStatusByProviderUid(db, { orgId, providerUid, status } = {}) {
  requireOrg(orgId, "setStatusByProviderUid");
  const uid = normalizeProviderUid(providerUid);
  const st = blankToNull(status);
  if (!uid) throw new BookingError("setStatusByProviderUid: providerUid is required");
  if (!st) throw new BookingError("setStatusByProviderUid: status is required");
  const res = await db.query(
    `UPDATE bookings
        SET status = $3, updated_at = now()
      WHERE org_id = $1 AND provider_uid = $2
      RETURNING ${COLUMNS}`,
    [orgId, uid, st]
  );
  return (res && res.rows) || [];
}

/**
 * What a saved booking says about one call time, asked by the jobs that wait
 * for that time (the 15-minute text, the no-show check). See bookingStateAt.
 */
export const SLOT_STATE = Object.freeze({
  ON: "on",               // a live booking still sits at this time
  MOVED: "moved",         // the booking that was at this time moved to another
  CANCELLED: "cancelled", // the booking at this time was cancelled
  NOSHOW: "noshow",       // the booking at this time is already marked no-show
  UNKNOWN: "unknown"      // no saved booking speaks to this time
});

/**
 * bookingStateAt(db, { orgId, clientId, bookingUid, startTime }) → SLOT_STATE.
 *
 * *** A JOB THAT SLEPT UNTIL A CALL TIME ASKS THIS BEFORE IT ACTS. ***
 *
 * The 15-minute text and the no-show check are started when a call is booked
 * and then sleep for hours or days. A move or a cancel in between used to be
 * invisible to them: the moved call still got "starts in 15 minutes" at the old
 * time, and a cancelled or moved call was marked a no-show at the old end time.
 *
 * The answer comes from the saved booking rows, not from the job's own copy of
 * the event. It looks at this customer's bookings (or the one with this
 * provider id) in this company only:
 *   - one still live at this exact time         → ON
 *   - only cancelled / no-show rows at this time → CANCELLED / NOSHOW
 *   - none at this time, but one whose saved history (raw->'__history', which
 *     upsertBooking appends on every move) holds this time → MOVED
 *   - nothing either way                         → UNKNOWN
 *
 * UNKNOWN means "act as before". A missing row, an unreadable time or a failed
 * read never stops a reminder on its own; only a saved fact does.
 */
export async function bookingStateAt(db, { orgId, clientId = null, bookingUid = null, startTime } = {}) {
  const uid = normalizeProviderUid(bookingUid);
  if (!orgId || (!clientId && !uid)) return SLOT_STATE.UNKNOWN;
  let at;
  try {
    at = toTimestamp(startTime, "bookingStateAt: startTime");
  } catch {
    return SLOT_STATE.UNKNOWN;
  }
  if (!at) return SLOT_STATE.UNKNOWN;

  let rows;
  try {
    const res = await db.query(
      `SELECT b.status,
              (b.starts_at = $3::timestamptz) AS at_this_time,
              EXISTS (
                SELECT 1
                  FROM jsonb_array_elements(
                         CASE WHEN jsonb_typeof(b.raw->'__history') = 'array'
                              THEN b.raw->'__history' ELSE '[]'::jsonb END) AS h(item)
                 WHERE h.item->>'starts_at' IS NOT NULL
                   AND (h.item->>'starts_at')::timestamptz = $3::timestamptz
              ) AS was_at_this_time
         FROM bookings b
        WHERE b.org_id = $1
          AND (b.client_id = $2 OR ($4::text IS NOT NULL AND b.provider_uid = $4::text))`,
      [orgId, clientId || null, at, uid]
    );
    rows = (res && res.rows) || [];
  } catch (err) {
    console.warn(`[bookings] bookingStateAt read failed (acting as unknown): ${String(err?.message || err)}`);
    return SLOT_STATE.UNKNOWN;
  }

  const atRows = rows.filter((r) => r && r.at_this_time === true);
  const statusOf = (r) => String(r.status || "").trim().toLowerCase();
  if (atRows.some((r) => statusOf(r) !== BOOKING_STATUS.CANCELLED && statusOf(r) !== BOOKING_STATUS.NOSHOW)) {
    return SLOT_STATE.ON;
  }
  if (atRows.some((r) => statusOf(r) === BOOKING_STATUS.CANCELLED)) return SLOT_STATE.CANCELLED;
  if (atRows.length) return SLOT_STATE.NOSHOW;
  if (rows.some((r) => r && r.was_at_this_time === true)) return SLOT_STATE.MOVED;
  return SLOT_STATE.UNKNOWN;
}

/**
 * listBookings(db, { orgId, from, to, clientId, status, limit }) → rows.
 *
 * What the calendar asks for. `from`/`to` bound starts_at.
 *
 * *** A BOOKING WITH NO START TIME IS NOT IN A DATE RANGE, AND IS NOT DROPPED
 * FROM AN UNBOUNDED LIST. *** When neither bound is given, rows with a NULL
 * starts_at come back too — they are real bookings whose time we were not told,
 * and a list that silently omitted them would report fewer bookings than exist.
 * When a range IS given they fall outside it, because "unknown" is not "in
 * August". The ordering puts them last (NULLS LAST) rather than first, so an
 * unknown time never leads a calendar.
 */
export async function listBookings(db, {
  orgId, from = null, to = null, clientId = null, status = null, limit = 200
} = {}) {
  requireOrg(orgId, "listBookings");

  const params = [orgId];
  const where = ["b.org_id = $1"];

  const fromTs = toTimestamp(from, "listBookings: from");
  if (fromTs) { params.push(fromTs); where.push(`b.starts_at >= $${params.length}`); }
  const toTs = toTimestamp(to, "listBookings: to");
  if (toTs) { params.push(toTs); where.push(`b.starts_at <= $${params.length}`); }
  if (clientId) { params.push(clientId); where.push(`b.client_id = $${params.length}`); }
  const st = blankToNull(status);
  if (st) { params.push(st); where.push(`b.status = $${params.length}`); }

  // Clamped rather than trusted: `?limit=9999999` is a request for the whole
  // table, and a page size is not the caller's to decide without a ceiling.
  const n = Number(limit);
  const capped = Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 200;
  params.push(capped);

  const res = await db.query(
    `SELECT b.id, b.org_id, b.client_id, b.source, b.provider_uid,
            b.starts_at, b.ends_at, b.status, b.meeting_url,
            b.attendee_email, b.attendee_name, b.event_type_slug,
            b.created_at, b.updated_at,
            c.first_name, c.last_name,
            COALESCE(NULLIF(trim(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')), ''),
                     b.attendee_name, c.email, b.attendee_email) AS display_name
       FROM bookings b
       -- The join carries org_id as well as id: a client row is only ever this
       -- company's, even if a stray client_id ever pointed elsewhere.
       LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.starts_at ASC NULLS LAST, b.created_at ASC
      LIMIT $${params.length}`,
    params
  );
  return (res && res.rows) || [];
}

/**
 * getBooking(db, { orgId, id }) → row | null. Org-scoped, so a booking id
 * guessed or copied from another company answers "not found" rather than
 * handing over an attendee's name and email.
 */
export async function getBooking(db, { orgId, id } = {}) {
  requireOrg(orgId, "getBooking");
  if (!id) throw new BookingError("getBooking: id is required");
  const res = await db.query(
    `SELECT ${COLUMNS} FROM bookings WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  return (res && res.rows && res.rows[0]) || null;
}
