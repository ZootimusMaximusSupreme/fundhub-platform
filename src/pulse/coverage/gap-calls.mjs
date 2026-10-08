// Calls and bookings — morning gap report.
// SELECT and one GET only. Never places a call. Never auto-fixes.
// Recon (AG-07) on the daily pulse is the only tripwire. No second watchdog.
//
// Held calls with no tape are NOT checked here. The daily pulse already runs
// checkUnrecorded (id "unrecorded") over src/sales/unrecorded.mjs. A second row
// that asked the same question would be a second watchdog.
// A calendar page that does not answer 2xx is already red as reg:calendar.
// The calendar row below only asks whether the page that answered IS the calendar.

import { inQuietHours, isProveSimRecipient, QUIET_END_HOUR, QUIET_HOURS_TZ } from "../../messaging/gate.mjs";
import { isInterviewBooking } from "../../insights/meet.mjs";
import { fenceVerdict, MESSAGING_DRY_RUN } from "../../lib/dry-run.mjs";

export const CHECK_IDS = Object.freeze([
  "calls:booked-no-outcome",
  "calls:calendar",
  "calls:booking-webhook",
  "calls:ai-dial-no-failure"
]);

const CALENDAR_PATH = "/app/calendar.html";
const DEFAULT_BASE = "https://fundhub.ai";
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const OUTCOME_GRACE_MS = 30 * 60 * 1000;
const STORE_GRACE_MS = 10 * 60 * 1000;
const DIAL_GRACE_MS = 15 * 60 * 1000;
const JOSH_CODE = "AG-04";
const JOSH_KIND = "ai-set-01-josh-setter";

const RECON =
  "Recon (AG-07) on the daily pulse is the only tripwire. Do not build a second watchdog. Do not auto-fix from this pulse.";

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function truthy(v) {
  return v === true || v === "t" || v === "true" || v === 1;
}

function sinceIso(now) {
  return new Date(now.getTime() - LOOKBACK_MS).toISOString();
}

function rowsOf(res) {
  return Array.isArray(res?.rows) ? res.rows : [];
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 160);
}

/* Same wake instant as nextQuietHoursEnd on the outbound clock.
   Copied so this file does not load the sender. */
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - date.getTime();
}

function nextQuietOpen(from, timeZone = QUIET_HOURS_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit"
  }).formatToParts(from);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;
  const dayShift = hour < QUIET_END_HOUR ? 0 : 1;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day + dayShift, QUIET_END_HOUR, 0, 0);
  let ts = wall;
  for (let i = 0; i < 2; i += 1) ts = wall - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/* Josh (AG-04) dials only when his row is live, on the phone runtime, with a
   prompt. Same three tests as agentReadiness in the voice provider, copied so
   this file does not load the sender. */
export function joshReady(agent) {
  if (!agent) return { ok: false, why: "has no agent row" };
  if (agent.runtime !== "bland") return { ok: false, why: `runs on ${agent.runtime || "no runtime"}, not the phone system` };
  if (agent.status !== "live") return { ok: false, why: `is ${agent.status || "not live"}` };
  if (!truthy(agent.has_prompt)) return { ok: false, why: "has no script saved" };
  return { ok: true, why: null };
}

function dialIsLate(row, now) {
  const created = new Date(row.created_at);
  if (Number.isNaN(created.getTime())) return false;
  let due = created.getTime() + DIAL_GRACE_MS;
  if (!isProveSimRecipient({ email: row.email }) && inQuietHours(created)) {
    due = nextQuietOpen(created).getTime() + DIAL_GRACE_MS;
  }
  return now.getTime() >= due;
}

/* A booked call that ended, was not marked a no-show or cancelled, and has no
   call_outcomes row. The old test also demanded clients.custom_fields.call_outcome
   be empty. The booking handler sets that field to "booked" on every booking, so
   that test never matched a real booking and this check could not fail.
   An outcome counts when it names the booking, or when the same client has one
   logged from two hours before the call began. */
async function bookedNoOutcome({ db, orgId, now }) {
  const id = "calls:booked-no-outcome";
  if (!db || !orgId) return check(id, "skip", "no database in this run — booked calls not read");
  try {
    const res = await db.query(
      `/* gap-calls:booked-no-outcome */
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
        LIMIT 50`,
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

/* The plain "does /app/calendar.html answer 2xx" question is reg:calendar.
   This row only asks whether the page that answered is the calendar. */
async function calendarPage({ fetchImpl, baseUrl }) {
  const id = "calls:calendar";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — calendar page not opened");
  }
  const origin = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const url = `${origin}${CALENDAR_PATH}`;
  let status = NaN;
  let text = "";
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "text/html" } });
    status = Number(res?.status);
    text = typeof res?.text === "function" ? String(await res.text()) : "";
  } catch (err) {
    return check(id, "skip", `calendar page not opened (${clip(err)}); reg:calendar reports a page that is down`);
  }
  if (!(status >= 200 && status < 300)) {
    return check(
      id,
      "skip",
      `calendar page answered ${Number.isFinite(status) ? status : "no status"}; reg:calendar reports a page that is down`
    );
  }
  if (/<title>[^<]*Calendar/i.test(text)) return check(id, "PASS", `calendar page answered ${status} and is the calendar`);
  return check(
    id,
    "FAIL",
    `calendar page answered ${status} but it is not the calendar page`,
    `Open ${CALENDAR_PATH}. Something else is being served at that address. ${RECON}`
  );
}

/* A booking webhook was accepted and no bookings row holds it.
   A. A stored booking.created / booking.rescheduled event with no bookings row.
      A row counts when it carries the booking id, the event id, or the same
      email at the same start time (ClickFunnels re-keys a form-post booking to
      the call id, and a move or an interview skips on purpose).
   B. A ClickFunnels appointment capture (created or moved, with an email) that
      neither a booking event nor a bookings row can be traced to. A ClickFunnels
      body carries the call id at data.id. It never carries a key named bookingUid,
      so the old test of the raw body for that key could never match. */
async function bookingWebhook({ db, orgId, now }) {
  const id = "calls:booking-webhook";
  if (!db || !orgId) return check(id, "skip", "no database in this run — booking webhooks not read");
  try {
    const params = [orgId, sinceIso(now), new Date(now.getTime() - STORE_GRACE_MS).toISOString()];
    const events = await db.query(
      `/* gap-calls:booking-webhook:events */
       SELECT e.id::text AS key, e.payload
         FROM events e
        WHERE e.org_id = $1::uuid
          AND COALESCE(e.is_demo, false) = false
          AND e.name IN ('booking.created', 'booking.rescheduled')
          AND e.created_at >= $2::timestamptz
          AND e.created_at <= $3::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.org_id = e.org_id
               AND (
                 (btrim(COALESCE(e.payload->>'bookingUid', '')) <> ''
                    AND b.provider_uid = btrim(e.payload->>'bookingUid'))
                 OR b.raw->>'__event_id' = e.id::text
                 OR (
                   btrim(COALESCE(e.payload->>'email', '')) <> ''
                   AND lower(COALESCE(b.attendee_email, '')) = lower(btrim(e.payload->>'email'))
                   AND b.starts_at IS NOT DISTINCT FROM (
                     CASE WHEN e.payload->>'startTime' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                          THEN (e.payload->>'startTime')::timestamptz END
                   )
                 )
               )
          )
        ORDER BY e.created_at DESC
        LIMIT 200`,
      params
    );
    const eventMisses = rowsOf(events).filter((r) => !isInterviewBooking(r.payload || {}));
    const captures = await db.query(
      `/* gap-calls:booking-webhook:captures */
       SELECT c.id::text AS key
         FROM (
           SELECT w.id,
                  substring(w.raw_body from '"data"[[:space:]]*:[[:space:]]*[{][[:space:]]*"id"[[:space:]]*:[[:space:]]*"?([0-9A-Za-z_-]+)') AS call_id,
                  substring(w.raw_body from '^[[:space:]]*[{][[:space:]]*"id"[[:space:]]*:[[:space:]]*"?([0-9A-Za-z_-]+)') AS message_id
             FROM webhook_captures w
            WHERE w.provider = 'clickfunnels'
              AND (w.org_id IS NULL OR w.org_id = $1::uuid)
              AND w.created_at >= $2::timestamptz
              AND w.created_at <= $3::timestamptz
              AND w.raw_body ~ 'appointments/scheduled_event[.](created|rescheduled)'
              AND w.raw_body ~ '"email_address"[[:space:]]*:[[:space:]]*"[^"]+@'
         ) c
        WHERE c.call_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM events e
             WHERE e.org_id = $1::uuid
               AND e.name LIKE 'booking.%'
               AND e.payload->>'bookingUid' IN (c.call_id, COALESCE(c.message_id, c.call_id))
          )
          AND NOT EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.org_id = $1::uuid
               AND b.provider_uid IN (c.call_id, COALESCE(c.message_id, c.call_id))
          )
        LIMIT 50`,
      params
    );
    const n = eventMisses.length + rowsOf(captures).length;
    if (n === 0) return check(id, "PASS", "booking webhooks have a bookings row");
    const word = n === 1 ? "webhook" : "webhooks";
    return check(
      id,
      "FAIL",
      `${n} booking ${word} accepted with no bookings row`,
      `The booking webhook was accepted but the bookings row was not saved. Check the booking handler. ${RECON}`
    );
  } catch (err) {
    return check(id, "FAIL", `booking-webhook read failed: ${clip(err)}`, RECON);
  }
}

/* A new booking should make Josh (AG-04) dial. The voice provider never throws,
   so a dial that did not happen leaves no error anywhere: the proof of a dial is
   the outbound_calls row. Not a miss: Josh is not live, the outbound fence is up,
   the booking was cancelled, the client has no phone, or quiet hours. */
async function aiDialNoFailure({ db, orgId, now, env }) {
  const id = "calls:ai-dial-no-failure";
  if (!db || !orgId) return check(id, "skip", "no database in this run — AI calls not read");
  try {
    const agentRes = await db.query(
      `/* gap-calls:ai-dial-agent */
       SELECT a.status AS agent_status,
              a.runtime AS agent_runtime,
              (a.prompt IS NOT NULL AND btrim(a.prompt) <> '') AS has_prompt
         FROM agents a
        WHERE a.org_id = $1::uuid AND a.code = $2
        LIMIT 1`,
      [orgId, JOSH_CODE]
    );
    const agent = rowsOf(agentRes)[0] || null;
    // No AG-04 row means the workflow falls back to the vendor script and dials.
    if (agent) {
      const ready = joshReady({ status: agent.agent_status, runtime: agent.agent_runtime, has_prompt: agent.has_prompt });
      if (!ready.ok) {
        return check(id, "PASS", `Josh (${JOSH_CODE}) ${ready.why}, so no AI call is expected`);
      }
    }
    if (env && typeof env === "object" && !fenceVerdict(MESSAGING_DRY_RUN, env).allowed) {
      return check(id, "PASS", `${MESSAGING_DRY_RUN} holds outbound on this deployment, so no AI call is expected`);
    }
    const res = await db.query(
      `/* gap-calls:ai-dial */
       SELECT e.id AS event_id,
              e.client_id,
              e.created_at,
              c.email,
              EXISTS (
                SELECT 1 FROM outbound_calls o
                 WHERE o.org_id = e.org_id
                   AND o.client_id = e.client_id
                   AND o.kind = $3
                   AND o.created_at >= e.created_at
              ) AS dialed,
              EXISTS (
                SELECT 1 FROM failed_events f
                 WHERE f.org_id = e.org_id
                   AND f.first_seen_at >= e.created_at
                   AND (f.event_id = e.id OR f.client_id = e.client_id)
                   AND (
                     f.handler_name ILIKE '%ai-set-01%'
                     OR f.handler_name ILIKE '%josh-setter%'
                     OR f.handler_name = 'place-josh-call'
                   )
              ) AS has_failure
         FROM events e
         JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
        WHERE e.org_id = $1::uuid
          AND COALESCE(e.is_demo, false) = false
          AND e.name = 'booking.created'
          AND e.created_at >= $2::timestamptz
          AND COALESCE(c.is_demo, false) = false
          AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
          AND length(regexp_replace(
                COALESCE(NULLIF(btrim(c.phone), ''), e.payload->>'phone', ''), '[^0-9]', '', 'g'
              )) >= 10
          AND NOT EXISTS (
            SELECT 1 FROM events x
             WHERE x.org_id = e.org_id
               AND x.name = 'booking.cancelled'
               AND x.created_at >= e.created_at
               AND (
                 (btrim(COALESCE(e.payload->>'bookingUid', '')) <> ''
                    AND x.payload->>'bookingUid' = e.payload->>'bookingUid')
                 OR (btrim(COALESCE(e.payload->>'email', '')) <> ''
                    AND x.payload->>'email' = e.payload->>'email')
               )
          )
        ORDER BY e.created_at DESC
        LIMIT 200`,
      [orgId, sinceIso(now), JOSH_KIND]
    );
    const missed = rowsOf(res).filter((row) => dialIsLate(row, now) && !truthy(row.dialed) && !truthy(row.has_failure));
    const n = missed.length;
    if (n === 0) return check(id, "PASS", `no AI call is late without a dial or a failure row${agent ? "" : " (Josh runs from the vendor script)"}`);
    const word = n === 1 ? "call" : "calls";
    return check(
      id,
      "FAIL",
      `${n} AI ${word} should have dialed and left no dial row and no failure row`,
      `Check AI-SET-01 (Josh, ${JOSH_CODE}): his row, BLAND_API_KEY, and ${MESSAGING_DRY_RUN}. Do not place a call from this pulse. ${RECON}`
    );
  } catch (err) {
    return check(id, "FAIL", `AI-call read failed: ${clip(err)}`, `Do not place a call from this pulse. ${RECON}`);
  }
}

export async function gapChecks(ctx) {
  const c = ctx || {};
  const now = c.now instanceof Date ? c.now : new Date();
  const db = c.db && typeof c.db.query === "function" ? c.db : null;
  const orgId = c.orgId || null;
  const fetchImpl = typeof c.fetchImpl === "function" ? c.fetchImpl : (typeof c.fetch === "function" ? c.fetch : null);
  return [
    await bookedNoOutcome({ db, orgId, now }),
    await calendarPage({ fetchImpl, baseUrl: c.baseUrl }),
    await bookingWebhook({ db, orgId, now }),
    await aiDialNoFailure({ db, orgId, now, env: c.env })
  ];
}
