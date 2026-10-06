// @ts-check
// Buzzes: the texts to Chris's phone from the marketing machine. Table: marketing_buzzes
// (db/migrations/411_marketing_buzzes_usage_shoots.sql).
// Spec: docs/specs/marketing-machine-2026-10-04.md §2 item 4 and §6 Steps 3-4.
//
//   * Chris gets a buzz only when he has something to do: scripts are ready, videos are
//     ready, or something is stuck that only he can fix. Everything else lives in the
//     Command Center. (Which events buzz is the caller's call; this file only queues
//     and sends.)
//   * Buzzes wait through quiet hours (default 21:00-07:00 Arizona, from marketing_settings).
//   * At most one of each kind every 10 minutes.
//   * Each one is a PAID text to Chris's own number, so a buzz is marked sent only when
//     send() answers {ok:true, status:'sent'}. notify-fanout's send()
//     (src/ad-videos/notify-fanout.mjs) does not throw when both channels fail: it
//     answers {ok:false, status:'failed'}. Anything but a clean 'sent' counts an attempt,
//     keeps the reason in last_error, and is tried again on a later pass, never inside
//     quiet hours. After 5 attempts the row is given up (failed_at) and never tried again.
//
// THIS FILE TRANSMITS NOTHING. send() is always passed in by the caller (the worker
// passes notify-fanout's send; tests pass a fake), so no text can ever leave from a
// test, and outbound calls stay in src/messaging/providers/* (CLAUDE.md §12).

/** Arizona is UTC-7 all year (no daylight time). The settings default zone. */
export const BUZZ_TZ = "America/Phoenix";
export const DEFAULT_QUIET_START = "21:00";
export const DEFAULT_QUIET_END = "07:00";

/** At most one buzz of each kind (per company) in this many minutes. */
export const KIND_GAP_MINUTES = 10;

/** A buzz that did not go out is tried again this many minutes later (or when quiet hours end). */
export const RETRY_GAP_MINUTES = 5;

/** Attempts before a buzz is given up. */
export const MAX_SEND_ATTEMPTS = 5;

const MINUTE = 60 * 1000;

/**
 * @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db
 * @typedef {{ ok?: boolean, status?: string, error?: string | null } | null | undefined} SendResult
 */

/** 'HH:MM' or 'HH:MM:SS' (Postgres time) → minutes after midnight, or null when unreadable. */
export function clockMinutes(value) {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*$/.exec(String(value ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function asDate(now) {
  if (now == null) return new Date();
  const d = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(d.getTime())) throw new TypeError("now is not a time");
  return d;
}

function zoneOrDefault(tz) {
  const zone = String(tz || BUZZ_TZ);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return BUZZ_TZ;
  }
}

/* The wall clock in a zone. formatToParts and `% 24` because some ICU builds print
   midnight as "24" with a 24-hour clock (same reason as hourInZone in src/messaging/gate.mjs). */
function wallClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const get = (type) => Number((parts.find((p) => p.type === type) || { value: "NaN" }).value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** How far the zone's wall clock is from UTC at that moment, in ms (Arizona: -7 hours). */
function zoneOffsetMs(date, timeZone) {
  const w = wallClock(date, timeZone);
  const wallAsUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** A wall-clock time in a zone → the real moment. Two passes so a daylight-time zone lands right. */
function wallToDate(y, mo, d, h, mi, timeZone, near) {
  const wallAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const first = wallAsUtc - zoneOffsetMs(near, timeZone);
  return new Date(wallAsUtc - zoneOffsetMs(new Date(first), timeZone));
}

/**
 * nextSendTime(now, quietStart, quietEnd, tz) → the moment a buzz may go out (a Date).
 *
 * Outside quiet hours that is `now`. Inside them it is the end of quiet hours (07:00 by
 * default), today or tomorrow, in the zone. The window may wrap midnight (21:00-07:00).
 * A start equal to its end means no quiet hours at all. A missing or unreadable time falls
 * back to the spec default (21:00-07:00), never to "no quiet hours". Pure.
 */
export function nextSendTime(now, quietStart = DEFAULT_QUIET_START, quietEnd = DEFAULT_QUIET_END, tz = BUZZ_TZ) {
  const at = asDate(now);
  const zone = zoneOrDefault(tz);
  const start = clockMinutes(quietStart) ?? /** @type {number} */ (clockMinutes(DEFAULT_QUIET_START));
  const end = clockMinutes(quietEnd) ?? /** @type {number} */ (clockMinutes(DEFAULT_QUIET_END));
  if (start === end) return at;

  const w = wallClock(at, zone);
  const minuteOfDay = w.h * 60 + w.mi + w.s / 60;
  const wraps = start > end;
  const quiet = wraps
    ? (minuteOfDay >= start || minuteOfDay < end)
    : (minuteOfDay >= start && minuteOfDay < end);
  if (!quiet) return at;

  // Quiet: send when it ends. Late evening of a wrapping window ends tomorrow.
  const day = new Date(Date.UTC(w.y, w.mo - 1, w.d + (wraps && minuteOfDay >= start ? 1 : 0)));
  return wallToDate(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
    Math.floor(end / 60), end % 60, zone, at);
}

/** What send() is handed: the notify-fanout message shape. The text carries the title only. */
export function buzzMessage(row) {
  const text = String(row.body || "").trim();
  return { id: row.id, notification: { title: text, body: text } };
}

/**
 * queueBuzz(db, { orgId, kind, body, groupKey, quietStart, quietEnd, tz, now })
 *   → { buzz, created }
 *
 * One waiting buzz per (org, kind, group_key): when one already waits, its words are
 * refreshed to the newest and no second text is queued (created:false). The caller passes
 * quiet hours read from marketing_settings; send_after is held to the end of them.
 */
export async function queueBuzz(db, { orgId, kind, body, groupKey = "", quietStart, quietEnd, tz, now } = /** @type {any} */ ({})) {
  if (!orgId) throw new TypeError("queueBuzz: orgId is required");
  const k = String(kind || "").trim();
  const text = String(body || "").trim();
  if (!k) throw new TypeError("queueBuzz: kind is required");
  if (!text) throw new TypeError("queueBuzz: body is required — a buzz with no words tells Chris nothing");
  const sendAfter = nextSendTime(now, quietStart, quietEnd, tz);
  const r = await db.query(
    `INSERT INTO marketing_buzzes (org_id, kind, body, group_key, send_after)
     VALUES ($1, $2, $3, $4, $5::timestamptz)
     ON CONFLICT (org_id, kind, group_key) WHERE sent_at IS NULL AND failed_at IS NULL
     DO UPDATE SET body = EXCLUDED.body
     RETURNING *, (xmax = 0) AS created`,
    [orgId, k, text, String(groupKey ?? "").trim(), sendAfter.toISOString()]
  );
  const { created, ...buzz } = r.rows[0];
  return { buzz, created: created === true };
}

/**
 * sendDueBuzzes(db, { send, now, quietStart, quietEnd, tz, limit })
 *   → { sent, retrying, gave_up, skipped }
 *
 * Sends the buzzes that are due (send_after <= now, not sent, not given up), at most one of
 * each kind per company, and none of a kind sent in the last 10 minutes.
 *
 *   * send(message) is REQUIRED and injected. Nothing is sent without it.
 *   * Each row is taken with a short lease (attempts + 1, send_after pushed 5 minutes out)
 *     before send() runs, so two workers never text the same row. No transaction is held
 *     open across the text.
 *   * sent_at is set only when send() answers {ok:true, status:'sent'}.
 *   * Anything else (ok:false, another status, a throw): last_error keeps the reason and the
 *     row is tried again 5 minutes later, pushed past quiet hours (quietStart/quietEnd/tz,
 *     default 21:00-07:00 Arizona) so a retry never texts at night. The 5th failed attempt
 *     sets failed_at and the row is never tried again.
 */
export async function sendDueBuzzes(db, { send, now, quietStart, quietEnd, tz, limit = 20 } = /** @type {any} */ ({})) {
  if (typeof send !== "function") {
    throw new TypeError("sendDueBuzzes: pass send() — nothing is ever sent without one");
  }
  const at = asDate(now);
  const atIso = at.toISOString();
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
  const summary = { sent: 0, retrying: 0, gave_up: 0, skipped: 0 };

  const due = await db.query(
    `SELECT DISTINCT ON (b.org_id, b.kind) b.*
       FROM marketing_buzzes b
      WHERE b.sent_at IS NULL
        AND b.failed_at IS NULL
        AND b.send_after <= $1::timestamptz
        AND NOT EXISTS (
          SELECT 1 FROM marketing_buzzes s
           WHERE s.org_id = b.org_id
             AND s.kind = b.kind
             AND s.sent_at IS NOT NULL
             AND s.sent_at > $1::timestamptz - interval '${KIND_GAP_MINUTES} minutes'
        )
      ORDER BY b.org_id, b.kind, b.send_after, b.created_at
      LIMIT $2`,
    [atIso, n]
  );

  for (const row of due.rows) {
    // The lease. Lost it (another worker took this row first)? Skip it.
    const leased = await db.query(
      `UPDATE marketing_buzzes
          SET attempts = attempts + 1,
              send_after = $3::timestamptz + interval '${RETRY_GAP_MINUTES} minutes'
        WHERE id = $1 AND attempts = $2
          AND sent_at IS NULL AND failed_at IS NULL
        RETURNING attempts`,
      [row.id, row.attempts, atIso]
    );
    if (!leased.rows[0]) { summary.skipped += 1; continue; }

    /** @type {SendResult} */
    let res;
    let thrown = null;
    try { res = await send(buzzMessage(row)); }
    catch (err) { thrown = err; }

    if (!thrown && res && res.ok === true && res.status === "sent") {
      await db.query(
        `UPDATE marketing_buzzes SET sent_at = $2::timestamptz
          WHERE id = $1 AND sent_at IS NULL AND failed_at IS NULL`,
        [row.id, atIso]
      );
      summary.sent += 1;
      continue;
    }

    const reason = thrown
      ? `send threw: ${String((thrown && thrown.message) || thrown)}`
      : !res
        ? "send answered nothing"
        : String(res.error || `send did not say sent (ok: ${res.ok === true}, status: ${res.status ?? "none"})`);
    const retryAt = nextSendTime(new Date(at.getTime() + RETRY_GAP_MINUTES * MINUTE), quietStart, quietEnd, tz);
    const after = await db.query(
      `UPDATE marketing_buzzes
          SET last_error = $2,
              failed_at = CASE WHEN attempts >= ${MAX_SEND_ATTEMPTS} THEN $3::timestamptz ELSE NULL END,
              send_after = CASE WHEN attempts >= ${MAX_SEND_ATTEMPTS} THEN send_after ELSE $4::timestamptz END
        WHERE id = $1 AND sent_at IS NULL AND failed_at IS NULL
        RETURNING failed_at`,
      [row.id, reason.replace(/\s+/g, " ").trim().slice(0, 1000) || "send failed, no reason given", atIso, retryAt.toISOString()]
    );
    if (after.rows[0] && after.rows[0].failed_at) summary.gave_up += 1;
    else summary.retrying += 1;
  }
  return summary;
}
