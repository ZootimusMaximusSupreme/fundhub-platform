// Booked calls: the two checks a customer feels, the SQL and the verdict. Read only. Report only.
//
//   calls:booked-no-outcome    a booked call ended and nobody logged what happened
//   calls:booked-no-join-link  a booked customer has no way to join the call (and the feed that would give one)
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This code used to live in src/pulse/coverage/gap-calls.mjs. It moved
// here, unchanged except for where its four small identity tests come from (lib/calls-identity.mjs, copies
// pinned to their app sources by a test), so the morning lane (gap-calls.mjs imports it back) and the hourly
// beat call-bookings run the same SQL and the same verdicts. The small helpers the lane's other checks share
// (check, sinceIso, rowsOf, clip, LOOKBACK_MS, RECON) moved here with them and the lane imports them back.
//
// SELECT only. Never places a call. Never auto-fixes. The caller hands in the reader ({ query }): the morning
// lane its pool, the beat its read box.

import {
  classifyVisitor, emailLooksLikeProveSim, isInterviewBooking, isTestEmail
} from "./calls-identity.mjs";

export const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
export const OUTCOME_GRACE_MS = 30 * 60 * 1000;

export const RECON =
  "Recon (AG-07) on the daily pulse is the only tripwire. Do not build a second watchdog. Do not auto-fix from this pulse.";

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function sinceIso(now) {
  return new Date(now.getTime() - LOOKBACK_MS).toISOString();
}

export function rowsOf(res) {
  return Array.isArray(res?.rows) ? res.rows : [];
}

export function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 160);
}

/** booked-no-outcome's one read. $1 org, $2 window start, $3 the outcome wait cut. */
export const BOOKED_NO_OUTCOME_SQL = `/* gap-calls:booked-no-outcome */
       SELECT b.id
         FROM bookings b
         LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
        WHERE b.org_id = $1::uuid
          AND lower(COALESCE(b.status, '')) IN ('booked', 'rescheduled')
          AND COALESCE(c.is_demo, false) = false
          AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
          AND COALESCE(b.ends_at, b.starts_at) IS NOT NULL
          AND COALESCE(b.ends_at, b.starts_at) >= $2::timestamptz
          AND COALESCE(b.ends_at, b.starts_at) <= $3::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM call_outcomes o
             WHERE o.org_id = b.org_id
               AND COALESCE(o.is_demo, false) = false
               AND (
                 (b.provider_uid IS NOT NULL AND o.booking_ref = b.provider_uid)
                 OR o.booking_ref = b.id::text
                 OR (
                   b.client_id IS NOT NULL
                   AND o.client_id = b.client_id
                   AND o.logged_at >= COALESCE(b.starts_at, b.ends_at) - interval '2 hours'
                 )
               )
          )
        LIMIT 50`;

/* A booked call that ended, was not marked a no-show or cancelled, and has no
   call_outcomes row. The old test also demanded clients.custom_fields.call_outcome
   be empty. The booking handler sets that field to "booked" on every booking, so
   that test never matched a real booking and this check could not fail.
   An outcome counts when it names the booking, or when the same client has one
   logged from two hours before the call began. */
export async function bookedNoOutcome({ db, orgId, now }) {
  const id = "calls:booked-no-outcome";
  if (!db || !orgId) return check(id, "skip", "no database in this run — booked calls not read");
  try {
    const res = await db.query(
      BOOKED_NO_OUTCOME_SQL,
      [orgId, sinceIso(now), new Date(now.getTime() - OUTCOME_GRACE_MS).toISOString()]
    );
    const n = rowsOf(res).length;
    if (n === 0) return check(id, "PASS", "no booked call is past its time with no outcome");
    const word = n === 1 ? "call" : "calls";
    return check(
      id,
      "FAIL",
      `${n} booked ${word} ended with no outcome`,
      `Log the outcome on the calendar or the closer desk. ${RECON}`
    );
  } catch (err) {
    return check(id, "FAIL", `booked-call read failed: ${clip(err)}`, RECON);
  }
}

/* ------------------------------------------------------------------------
   calls:booked-no-join-link — does a booked customer have a way to join?

   WHERE THE LINK COMES FROM (2026-10-20): ClickFunnels is the booking page and
   puts each call on the host's Google Calendar, where Google adds a Meet link.
   ClickFunnels' webhook carries no link (the adapter sets meetingUrl: null), so
   AI-SET-04 reads the host calendar about two minutes after a booking
   (src/bookings/meet-link.mjs) and keeps the Meet link on the bookings row and
   the closer's call task (step "keep-meet-link"). The 15-minute text reads it
   from there. Before 2026-10-20 nothing kept a link, so every older booking has
   none; the feed question below turns green on the first new booking that does.

   ONE BOOKING, TWO IDS. The calendar form post makes the booking.created event
   under the form message id; the appointment webhook then re-keys the bookings
   row to the call's own id and emits nothing. So a bookings row is matched to a
   call by id OR by the same email at the same start time. Matching by id alone
   missed every kept link.

   staff.meeting_url is NOT read here and is not a red. It is a standing room
   that only hiring interviews read (src/hiring/booking.mjs). Nothing sends a
   sales-call customer to it and no screen sets it, so an empty one does not
   stop a customer joining a call.

   Two questions, one row:
   A. A real booked call still ahead (or begun in the last 2 hours) with no
      link on the event, the bookings row or the task. A call first seen in
      the last 10 minutes is not judged yet: the link is read 2 minutes after
      the booking, and the booking-webhook check waits the same 10 minutes.
   B. The feed itself. Of the newest real bookings, does ANY carry a link? If
      none of the newest 5 do (and there are at least 3), no future booking
      will have one either. This is what turns red BEFORE a customer is hit.
      The newest 5 are judged at ANY age. There is no look-back window: if the
      bookings go quiet, nothing about the product has changed, so the red must
      not fade by itself. The red says how old the newest booking is.

   Real means: not a demo event, a readable email, not a test address (the
   company domain, example domains, e2e / sim / test words, the fhtest tag, or
   any +tag in the address), not an interview. Cancelled and moved-away calls
   are left out. One call that ClickFunnels reported under two ids (same email,
   same start) is counted once.
   ------------------------------------------------------------------------ */
export const JOIN_ID = "calls:booked-no-join-link";
const DAY_MS = 24 * 60 * 60 * 1000;
const JOIN_AHEAD_MS = 45 * DAY_MS;
const JOIN_STARTED_GRACE_MS = 2 * 60 * 60 * 1000;
/** A call booked this recently has not had its link read yet (AI-SET-04 waits 2 minutes). */
const JOIN_FRESH_MS = 10 * 60 * 1000;
const JOIN_FEED_SAMPLE = 5;
const JOIN_FEED_MIN = 3;
const JOIN_EVENT_LIMIT = 1500;
const LINK_RE = /^https?:\/\/\S+$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

function isLink(v) {
  return typeof v === "string" && LINK_RE.test(v.trim());
}

function payloadOf(raw) {
  if (raw && typeof raw === "object") return raw;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return p && typeof p === "object" ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}

/* A tester, not a customer. A real customer who types a +tag is left out too:
   a missed red on one rare person costs less than a red every time Chris tests. */
function isTesterAddress(email) {
  const mail = String(email || "").trim().toLowerCase();
  if (!mail) return false;
  if (classifyVisitor({ email: mail }).actor === "agent") return true;
  if (emailLooksLikeProveSim(mail) || isTestEmail(mail)) return true;
  return mail.split("@")[0].includes("+");
}

function maskEmail(mail) {
  const m = String(mail || "");
  const at = m.lastIndexOf("@");
  return at > 0 ? `${m[0]}***${m.slice(at)}` : "a customer";
}

/* "today", "1 day ago", "48 days ago" — so a stale red says how stale it is. */
function ageOf(when, now) {
  const days = Math.max(0, Math.floor((now.getTime() - when.getTime()) / DAY_MS));
  return days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`;
}

function startOf(payload) {
  const t = payload.startTime;
  if (typeof t !== "string" || !ISO_RE.test(t.trim())) return null;
  const d = new Date(t.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

/* Events -> calls. Pure, so the tests can drive it without a database.
   Returns every real call with its uids, start, whether the feed event itself
   carried a link, and whether it was cancelled or moved away. */
export function joinCalls(events) {
  const evs = [];
  for (const r of Array.isArray(events) ? events : []) {
    const at = new Date(r?.created_at);
    if (Number.isNaN(at.getTime())) continue;
    const p = payloadOf(r.payload);
    const uid = String(p.bookingUid ?? "").trim();
    evs.push({
      name: String(r.name || ""),
      at,
      uid: uid || `event:${r.id}`,
      hasUid: uid !== "",
      email: String(p.email ?? "").trim().toLowerCase(),
      start: startOf(p),
      moveFrom: String(p.rescheduleUid ?? "").trim(),
      link: isLink(p.meetingUrl) || isLink(p.meeting_url) || isLink(p.meeting_location),
      interview: isInterviewBooking(p)
    });
  }
  evs.sort((a, b) => a.at - b.at);

  const byUid = new Map();
  for (const e of evs) {
    if (!byUid.has(e.uid)) byUid.set(e.uid, []);
    byUid.get(e.uid).push(e);
  }
  // A cancel that carries a call id belongs to that call. Only a cancel that
  // names no call we hold is matched by email (and start, when it has one).
  const cancels = evs.filter(
    (e) =>
      e.name === "booking.cancelled" &&
      !(byUid.get(e.uid) || []).some((x) => x.name !== "booking.cancelled")
  );

  const calls = new Map();
  for (const [uid, list] of byUid) {
    const live = list.filter((e) => e.name !== "booking.cancelled");
    if (live.length === 0) continue; // only a cancel: nothing was booked here
    const latest = list[list.length - 1];
    const lastLive = live[live.length - 1];
    const start = [...live].reverse().find((e) => e.start)?.start || null;
    const email = lastLive.email;
    if (!email || isTesterAddress(email) || live.some((e) => e.interview)) continue;
    const cancelled =
      latest.name === "booking.cancelled" ||
      cancels.some(
        (c) =>
          c.at > lastLive.at &&
          c.email === email &&
          (!c.start || !start || c.start.getTime() === start.getTime())
      );
    const movedAway = evs.some((e) => e.moveFrom === uid && e.at > lastLive.at);
    const key = start ? `${email}|${start.getTime()}` : `uid:${uid}`;
    const prev = calls.get(key);
    const call = prev || {
      key, email, start, uids: [], feedLink: false, cancelled: true, movedAway: true,
      created: false, firstSeen: live[0].at
    };
    if (list[0].hasUid) call.uids.push(uid);
    call.feedLink = call.feedLink || live.some((e) => e.link);
    call.cancelled = call.cancelled && cancelled;
    call.movedAway = call.movedAway && movedAway;
    call.created = call.created || live.some((e) => e.name === "booking.created");
    if (live[0].at < call.firstSeen) call.firstSeen = live[0].at;
    calls.set(key, call);
  }
  return [...calls.values()];
}

/** booked-no-join-link read (events). */
export const JOIN_EVENTS_SQL = `/* gap-calls:no-join-link:events */
       SELECT e.id::text AS id, e.name, e.created_at, e.payload
         FROM events e
        WHERE e.org_id = $1::uuid
          AND COALESCE(e.is_demo, false) = false
          AND e.name IN ('booking.created', 'booking.rescheduled', 'booking.cancelled')
          AND e.created_at <= $2::timestamptz
        ORDER BY e.created_at DESC
        LIMIT ${JOIN_EVENT_LIMIT}`;

/** booked-no-join-link read (bookings). */
export const JOIN_BOOKINGS_SQL = `/* gap-calls:no-join-link:bookings */
           SELECT b.provider_uid AS uid,
                  lower(btrim(b.attendee_email)) || '|' ||
                    (extract(epoch FROM b.starts_at) * 1000)::bigint::text AS call_key,
                  b.meeting_url
             FROM bookings b
            WHERE b.org_id = $1::uuid
              AND (b.provider_uid = ANY($2::text[])
                   OR (b.starts_at IS NOT NULL AND b.attendee_email IS NOT NULL
                       AND lower(btrim(b.attendee_email)) || '|' ||
                           (extract(epoch FROM b.starts_at) * 1000)::bigint::text = ANY($3::text[])))
              AND btrim(COALESCE(b.meeting_url, '')) <> ''`;

/** booked-no-join-link read (tasks). */
export const JOIN_TASKS_SQL = `/* gap-calls:no-join-link:tasks */
           SELECT t.body AS uid, t.meeting_url
             FROM tasks t
            WHERE t.org_id = $1::uuid
              AND t.body = ANY($2::text[])
              AND btrim(COALESCE(t.meeting_url, '')) <> ''`;

export async function bookedNoJoinLink({ db, orgId, now }) {
  const id = JOIN_ID;
  if (!db || !orgId) return check(id, "skip", "no database in this run — booked calls not read");
  let calls;
  try {
    const res = await db.query(
      JOIN_EVENTS_SQL,
      [orgId, now.toISOString()]
    );
    calls = joinCalls(rowsOf(res));
  } catch (err) {
    return check(id, "skip", `booked-call events not read (${clip(err)}), so join links are unchecked`);
  }

  const lo = now.getTime() - JOIN_STARTED_GRACE_MS;
  const hi = now.getTime() + JOIN_AHEAD_MS;
  const ahead = calls
    .filter((c) => !c.cancelled && !c.movedAway && c.start && c.start.getTime() >= lo && c.start.getTime() <= hi)
    .sort((a, b) => a.start - b.start);
  const sample = calls
    .filter((c) => c.created)
    .sort((a, b) => b.firstSeen - a.firstSeen)
    .slice(0, JOIN_FEED_SAMPLE);

  // A link can also be on the bookings row or on the closer's task for that uid.
  // A bookings row is also matched by the call's email and start (see ONE
  // BOOKING, TWO IDS above): the row carries the call id, the event the form id.
  const judged = [...ahead, ...sample];
  const uids = [...new Set(judged.flatMap((c) => c.uids))];
  const keys = [...new Set(judged.filter((c) => c.start).map((c) => c.key))];
  const saved = new Set();
  const savedKeys = new Set();
  if (uids.length > 0 || keys.length > 0) {
    try {
      const [b, t] = [
        await db.query(
          JOIN_BOOKINGS_SQL,
          [orgId, uids, keys]
        ),
        await db.query(
          JOIN_TASKS_SQL,
          [orgId, uids]
        )
      ];
      for (const r of [...rowsOf(b), ...rowsOf(t)]) {
        if (!isLink(r?.meeting_url)) continue;
        if (r.uid != null) saved.add(String(r.uid));
        if (r.call_key != null) savedKeys.add(String(r.call_key));
      }
    } catch (err) {
      return check(id, "skip", `booking and task links not read (${clip(err)}), so join links are unchecked`);
    }
  }
  const hasLink = (c) => c.feedLink || c.uids.some((u) => saved.has(u)) || (c.start && savedKeys.has(c.key));

  // A call first seen in the last 10 minutes has not had its link read yet.
  const fresh = (c) => c.firstSeen.getTime() > now.getTime() - JOIN_FRESH_MS;
  const missing = ahead.filter((c) => !fresh(c) && !hasLink(c));
  const withLink = sample.filter(hasLink).length;
  const feedDead = sample.length >= JOIN_FEED_MIN && withLink === 0;

  const why = [];
  if (missing.length > 0) {
    const first = missing[0];
    why.push(
      `${missing.length} booked ${missing.length === 1 ? "call" : "calls"} still ahead ` +
        `${missing.length === 1 ? "has" : "have"} no join link anywhere in our data ` +
        `(next: ${maskEmail(first.email)} on ${first.start.toISOString().slice(0, 16).replace("T", " ")} UTC)`
    );
  }
  if (feedDead) {
    why.push(
      `0 of the newest ${sample.length} real bookings carried a join link, so a new booking will not have one either ` +
        `(the newest real booking was made ${ageOf(sample[0].firstSeen, now)})`
    );
  }
  if (why.length > 0) {
    return check(
      id,
      "FAIL",
      `${why.join("; ")}. The 15-minute text sends the portal sign-in page where the link should be.`,
      `The link comes from the host's Google Calendar event (ClickFunnels puts a Meet link there). ` +
        `Open the AI-SET-04 run for that booking and read its "keep-meet-link" step: the reason names the miss ` +
        `(no_calendar_scope means the Google token needs calendar read; no_matching_event means the call is not ` +
        `on the host calendar the token reads). ${RECON}`
    );
  }
  const feedNote =
    sample.length >= JOIN_FEED_MIN
      ? `${withLink} of the newest ${sample.length} real bookings carry a link`
      : `fewer than ${JOIN_FEED_MIN} real bookings so far, so the feed is not judged yet`;
  const judgedAhead = ahead.filter((c) => !fresh(c)).length;
  const freshAhead = ahead.length - judgedAhead;
  const aheadNote = judgedAhead === 0
    ? "no real booked call is ahead"
    : `all ${judgedAhead} booked ${judgedAhead === 1 ? "call" : "calls"} ahead have a join link`;
  const freshNote = freshAhead > 0
    ? `; ${freshAhead} booked in the last 10 minutes, link not read yet`
    : "";
  return check(id, "PASS", `${aheadNote}${freshNote}; ${feedNote}`);
}
