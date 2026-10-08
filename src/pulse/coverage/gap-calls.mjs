// Calls, bookings, and recordings — morning gap report.
// SELECT and one GET only. Never places a call. Never auto-fixes.
// Recon (AG-07) on the daily pulse is the only tripwire. No second watchdog.
// Held calls with no tape use src/sales/unrecorded.mjs. Do not copy that query.

import { listUnrecordedCalls } from "../../sales/unrecorded.mjs";
import {
  inQuietHours,
  isProveSimRecipient,
  QUIET_END_HOUR,
  QUIET_HOURS_TZ
} from "../../messaging/gate.mjs";

export const CHECK_IDS = Object.freeze([
  "calls:booked-no-outcome",
  "calls:held-no-recording",
  "calls:calendar",
  "calls:booking-webhook",
  "calls:ai-dial-no-failure"
]);

const CALENDAR_PATH = "/app/calendar.html";
const DEFAULT_BASE = "https://fundhub.ai";
const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const OUTCOME_GRACE_MS = 30 * 60 * 1000;
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

function setterShouldDial(row) {
  if (!truthy(row.agent_found)) return true;
  return row.agent_status === "live"
    && row.agent_runtime === "bland"
    && truthy(row.has_prompt);
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
          AND COALESCE(c.custom_fields->>'call_outcome', '') = ''
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
    return check(id, "FAIL", `booked-call read failed: ${String(err?.message || err).slice(0, 160)}`, RECON);
  }
}

async function heldNoRecording({ db, orgId, now }) {
  const id = "calls:held-no-recording";
  if (!db || !orgId) return check(id, "skip", "no database in this run — held calls not read");
  try {
    const rows = await listUnrecordedCalls(db, { orgId, now });
    const n = rows.length;
    if (n === 0) return check(id, "PASS", "no held sales call is missing a tape");
    const word = n === 1 ? "call" : "calls";
    return check(
      id,
      "FAIL",
      `${n} held ${word} logged with no tape`,
      "Use the existing unrecorded-call list. Do not add a second recording check. Open My Numbers or Sales Floor and hit Record on the next Meet. Do not auto-record. Do not text each miss. " + RECON
    );
  } catch (err) {
    return check(id, "FAIL", `held-call read failed: ${String(err?.message || err).slice(0, 160)}`, RECON);
  }
}

async function calendarPage({ fetchImpl, baseUrl }) {
  const id = "calls:calendar";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch in this run — calendar page not opened");
  }
  const origin = String(baseUrl || DEFAULT_BASE).replace(/\/+$/, "");
  const url = `${origin}${CALENDAR_PATH}`;
  try {
    const res = await fetchImpl(url, { method: "GET", headers: { accept: "text/html" } });
    const text = typeof res?.text === "function" ? await res.text() : "";
    const status = Number(res?.status);
    const alive = status >= 200 && status < 300 && /<title>[^<]*Calendar/i.test(String(text));
    if (alive) return check(id, "PASS", `calendar page answered ${status}`);
    return check(
      id,
      "FAIL",
      `calendar page dead (${Number.isFinite(status) ? status : "no status"})`,
      `Open ${CALENDAR_PATH}. The calendar page did not load. ${RECON}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `calendar page unreachable: ${String(err?.message || err).slice(0, 160)}`,
      `Restore ${CALENDAR_PATH}. ${RECON}`
    );
  }
}

async function bookingWebhook({ db, orgId, now }) {
  const id = "calls:booking-webhook";
  if (!db || !orgId) return check(id, "skip", "no database in this run — booking webhooks not read");
  try {
    const res = await db.query(
      `/* gap-calls:booking-webhook */
       SELECT uid
         FROM (
           SELECT btrim(e.payload->>'bookingUid') AS uid
             FROM events e
            WHERE e.org_id = $1::uuid
              AND COALESCE(e.is_demo, false) = false
              AND e.name IN ('booking.created', 'booking.rescheduled', 'booking.cancelled')
              AND e.created_at >= $2::timestamptz
              AND btrim(COALESCE(e.payload->>'bookingUid', '')) <> ''
              AND NOT EXISTS (
                SELECT 1 FROM bookings b
                 WHERE b.org_id = e.org_id
                   AND b.provider_uid = btrim(e.payload->>'bookingUid')
              )
           UNION
           SELECT substring(c.raw_body from '"bookingUid"[[:space:]]*:[[:space:]]*"([^"]+)"') AS uid
             FROM webhook_captures c
            WHERE c.provider = 'clickfunnels'
              AND (c.org_id IS NULL OR c.org_id = $1::uuid)
              AND c.created_at >= $2::timestamptz
              AND c.raw_body LIKE '%bookingUid%'
              AND NOT EXISTS (
                SELECT 1 FROM bookings b
                 WHERE b.org_id = $1::uuid
                   AND b.provider_uid = substring(c.raw_body from '"bookingUid"[[:space:]]*:[[:space:]]*"([^"]+)"')
              )
         ) misses
        WHERE uid IS NOT NULL AND btrim(uid) <> ''
        GROUP BY uid
        LIMIT 50`,
      [orgId, sinceIso(now)]
    );
    const n = rowsOf(res).length;
    if (n === 0) return check(id, "PASS", "booking webhooks have a bookings row");
    const word = n === 1 ? "webhook" : "webhooks";
    return check(
      id,
      "FAIL",
      `${n} booking ${word} accepted with no bookings row`,
      `The booking webhook was accepted but the bookings row was not saved. Check the booking handler. ${RECON}`
    );
  } catch (err) {
    return check(id, "FAIL", `booking-webhook read failed: ${String(err?.message || err).slice(0, 160)}`, RECON);
  }
}

async function aiDialNoFailure({ db, orgId, now }) {
  const id = "calls:ai-dial-no-failure";
  if (!db || !orgId) return check(id, "skip", "no database in this run — AI calls not read");
  try {
    const res = await db.query(
      `/* gap-calls:ai-dial */
       SELECT e.id AS event_id,
              e.client_id,
              e.created_at,
              c.phone,
              c.email,
              (a.code IS NOT NULL) AS agent_found,
              a.status AS agent_status,
              a.runtime AS agent_runtime,
              (a.prompt IS NOT NULL AND btrim(a.prompt) <> '') AS has_prompt,
              EXISTS (
                SELECT 1 FROM outbound_calls o
                 WHERE o.org_id = e.org_id
                   AND o.client_id = e.client_id
                   AND o.kind = '${JOSH_KIND}'
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
         LEFT JOIN agents a ON a.org_id = e.org_id AND a.code = '${JOSH_CODE}'
        WHERE e.org_id = $1::uuid
          AND COALESCE(e.is_demo, false) = false
          AND e.name = 'booking.created'
          AND e.created_at >= $2::timestamptz
          AND COALESCE(c.is_demo, false) = false
          AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
          AND btrim(COALESCE(c.phone, '')) <> ''
        LIMIT 50`,
      [orgId, sinceIso(now)]
    );
    const missed = rowsOf(res).filter((row) => setterShouldDial(row) && dialIsLate(row, now) && !truthy(row.dialed) && !truthy(row.has_failure));
    const n = missed.length;
    if (n === 0) return check(id, "PASS", "no AI call is late without a dial or a failure row");
    const word = n === 1 ? "call" : "calls";
    return check(
      id,
      "FAIL",
      `${n} AI ${word} should have dialed and left no failure row`,
      `Check AI-SET-01 (Josh, ${JOSH_CODE}). Do not place a call from this pulse. ${RECON}`
    );
  } catch (err) {
    return check(id, "FAIL", `AI-call read failed: ${String(err?.message || err).slice(0, 160)}`, `Do not place a call from this pulse. ${RECON}`);
  }
}

export async function gapChecks(ctx) {
  const c = ctx || {};
  const now = c.now instanceof Date ? c.now : new Date();
  const db = c.db || null;
  const orgId = c.orgId || null;
  return [
    await bookedNoOutcome({ db, orgId, now }),
    await heldNoRecording({ db, orgId, now }),
    await calendarPage({ fetchImpl: c.fetchImpl, baseUrl: c.baseUrl }),
    await bookingWebhook({ db, orgId, now }),
    await aiDialNoFailure({ db, orgId, now })
  ];
}
