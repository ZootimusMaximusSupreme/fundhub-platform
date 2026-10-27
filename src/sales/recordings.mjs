// Meet recordings live in Google Drive. This module lists them for the sales
// manager and stamps the Drive link onto the matching call / interview row.
// Files stay in Drive — we only store the link.

import { driveConfigFromEnv } from "../company-brain/config.mjs";

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 7;
const CALL_TIME_WINDOW_MINUTES = 15;

function tokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** True when the Drive filename contains both first and last name. */
export function filenameMentionsPerson(fileName, first, last) {
  const hay = new Set(tokens(fileName));
  const firstParts = tokens(first);
  const lastParts = tokens(last);
  if (!firstParts.length || !lastParts.length) return false;
  return firstParts.every((t) => hay.has(t)) && lastParts.every((t) => hay.has(t));
}

function clientDisplayName(row) {
  const name = [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

function isToday(iso, now) {
  if (!iso) return false;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return false;
  return (
    t.getUTCFullYear() === now.getUTCFullYear()
    && t.getUTCMonth() === now.getUTCMonth()
    && t.getUTCDate() === now.getUTCDate()
  );
}

/** Read the scheduled Meet time from Google's timestamped file name. */
export function recordingCallTime(fileName) {
  const match = String(fileName || "").match(
    /(?:^|[^0-9])(\d{4})[-/](\d{2})[-/](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?\s*(?:GMT|UTC)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?/i
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, seconds = "00", sign, offsetHour, offsetMinute = "00"] = match;
  if (
    Number(month) < 1 || Number(month) > 12
    || Number(day) < 1 || Number(day) > 31
    || Number(hour) > 23 || Number(minute) > 59 || Number(seconds) > 59
    || Number(offsetHour) > 23 || Number(offsetMinute) > 59
  ) return null;
  const offset = `${sign}${String(offsetHour).padStart(2, "0")}:${offsetMinute}`;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:${seconds}${offset}`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function stampRecordingUrl(db, {
  orgId,
  clientId,
  url,
  callTime = null,
  callOnly = false
} = {}) {
  const link = String(url || "").trim();
  if (!orgId || !clientId || !link) return { stamped: 0 };
  const exactTime = callTime ? new Date(callTime) : null;
  const matchIso = exactTime && !Number.isNaN(exactTime.getTime())
    ? exactTime.toISOString()
    : null;
  const call = matchIso
    ? await db.query(
      `UPDATE call_outcomes SET recording_url = $3
        WHERE id = (
          SELECT o.id
            FROM call_outcomes o
            LEFT JOIN tasks t
              ON t.id = o.task_id AND t.org_id = o.org_id
            LEFT JOIN bookings b
              ON b.org_id = o.org_id
             AND (b.provider_uid = o.booking_ref OR b.id::text = o.booking_ref)
           WHERE o.org_id = $1 AND o.client_id = $2
             AND (o.recording_url IS NULL OR btrim(o.recording_url) = '')
             AND COALESCE(b.starts_at, t.due_at)
                   BETWEEN $4::timestamptz - interval '${CALL_TIME_WINDOW_MINUTES} minutes'
                       AND $4::timestamptz + interval '${CALL_TIME_WINDOW_MINUTES} minutes'
           ORDER BY ABS(EXTRACT(EPOCH FROM (
                      COALESCE(b.starts_at, t.due_at) - $4::timestamptz
                    ))) ASC,
                    o.logged_at DESC NULLS LAST
           LIMIT 1
        )
        RETURNING id`,
      [orgId, clientId, link, matchIso]
    )
    : { rows: [] };
  const insight = callOnly ? { rows: [] } : await db.query(
    `UPDATE customer_insights SET recording_url = $3
      WHERE id = (
        SELECT id FROM customer_insights
         WHERE org_id = $1 AND client_id = $2 AND recording_url IS NULL
         ORDER BY occurred_at DESC NULLS LAST
         LIMIT 1
      )
      RETURNING id`,
    [orgId, clientId, link]
  );
  return {
    stamped: (call.rows?.length || 0) + (insight.rows?.length || 0)
  };
}

export async function stampCallTranscript(db, {
  orgId,
  clientId,
  url = null,
  transcript
} = {}) {
  const words = String(transcript || "").trim();
  if (!orgId || !clientId || !words) return { stamped: 0 };
  const link = String(url || "").trim();
  const byUrl = link
    ? await db.query(
      `UPDATE call_outcomes SET transcript = $3
        WHERE id = (
          SELECT id FROM call_outcomes
           WHERE org_id = $1 AND client_id = $2
             AND recording_url = $4
             AND (transcript IS NULL OR btrim(transcript) = '')
           ORDER BY logged_at DESC NULLS LAST
           LIMIT 1
        )
        RETURNING id`,
      [orgId, clientId, words, link]
    )
    : { rows: [] };
  if (byUrl.rows?.length) return { stamped: 1 };
  return { stamped: 0 };
}

async function recentCallClients(db, { orgId, sinceIso }) {
  const res = await db.query(
    `SELECT DISTINCT c.id, c.first_name, c.last_name
       FROM clients c
      WHERE c.org_id = $1
        AND (
          EXISTS (
            SELECT 1 FROM call_outcomes o
             WHERE o.org_id = $1 AND o.client_id = c.id AND o.logged_at >= $2
          )
          OR EXISTS (
            SELECT 1 FROM events e
             WHERE e.org_id = $1 AND e.client_id = c.id
               AND e.name = 'booking.created' AND e.created_at >= $2
          )
          OR EXISTS (
            SELECT 1 FROM customer_insights i
             WHERE i.org_id = $1 AND i.client_id = c.id AND i.occurred_at >= $2
          )
        )`,
    [orgId, sinceIso]
  );
  return res.rows || [];
}

export function uniqueNameMatch(clients, fileName) {
  const hits = (clients || []).filter((c) =>
    filenameMentionsPerson(fileName, c.first_name, c.last_name)
  );
  if (hits.length !== 1) return null;
  return hits[0];
}

export async function attachDriveRecording(db, {
  orgId,
  clientId = null,
  fileName = "",
  url = null,
  sinceIso = null
} = {}) {
  const link = String(url || "").trim();
  if (!orgId || !link) return { attached: false, reason: "no_url" };

  let id = clientId || null;
  if (!id && fileName) {
    const since = sinceIso || new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString();
    const clients = await recentCallClients(db, { orgId, sinceIso: since });
    const hit = uniqueNameMatch(clients, fileName);
    id = hit?.id || null;
  }
  if (!id) return { attached: false, reason: "unattached", clientId: null };

  await stampRecordingUrl(db, {
    orgId,
    clientId: id,
    url: link,
    callTime: recordingCallTime(fileName)
  });
  return { attached: true, reason: null, clientId: id };
}

export async function listRecentRecordings(db, {
  orgId,
  now = new Date(),
  env = process.env,
  lookbackDays = LOOKBACK_DAYS
} = {}) {
  const config = driveConfigFromEnv(env);
  const since = new Date(now.getTime() - lookbackDays * DAY_MS);
  const sinceIso = since.toISOString();

  const stateRes = await db.query(
    `SELECT last_sync_at, last_error FROM brain_drive_sync WHERE org_id = $1`,
    [orgId]
  );
  const state = stateRes.rows?.[0] || null;

  const filesRes = await db.query(
    `SELECT bf.id, bf.name, bf.web_view_link, bf.client_id, bf.unattached,
            bf.indexed_at, bf.created_at, bf.mime_type, bf.needs_transcription,
            c.first_name, c.last_name
       FROM brain_files bf
       LEFT JOIN clients c ON c.id = bf.client_id AND c.org_id = bf.org_id
      WHERE bf.org_id = $1
        AND COALESCE(bf.indexed_at, bf.created_at) >= $2
        AND (
          bf.needs_transcription = true
          OR bf.mime_type LIKE 'video/%'
          OR bf.mime_type LIKE 'audio/%'
          OR bf.name ILIKE '%recording%'
        )
      ORDER BY COALESCE(bf.indexed_at, bf.created_at) DESC
      LIMIT 40`,
    [orgId, sinceIso]
  );

  const outcomeRes = await db.query(
    `SELECT o.id, o.recording_url, o.logged_at, o.client_id, o.transcript,
            c.first_name, c.last_name
       FROM call_outcomes o
       LEFT JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
      WHERE o.org_id = $1
        AND o.recording_url IS NOT NULL
        AND o.logged_at >= $2
      ORDER BY o.logged_at DESC
      LIMIT 40`,
    [orgId, sinceIso]
  );

  const clients = await recentCallClients(db, { orgId, sinceIso });
  const files = filesRes.rows || [];

  for (const row of files) {
    if (!row.web_view_link) continue;
    const alreadyLinked = !!row.client_id;
    const hit = alreadyLinked ? { id: row.client_id } : uniqueNameMatch(clients, row.name);
    if (!hit) continue;
    if (!alreadyLinked) {
      await db.query(
        `UPDATE brain_files
            SET client_id = $2, unattached = false, updated_at = now()
          WHERE id = $1 AND org_id = $3 AND client_id IS NULL`,
        [row.id, hit.id, orgId]
      );
    }
    await stampRecordingUrl(db, {
      orgId,
      clientId: hit.id,
      url: row.web_view_link,
      callTime: recordingCallTime(row.name),
      callOnly: alreadyLinked
    });
    row.client_id = hit.id;
    row.first_name = hit.first_name;
    row.last_name = hit.last_name;
    row.unattached = false;
  }

  const items = [];
  const seenUrl = new Set();
  const wordsByUrl = new Map();
  for (const row of outcomeRes.rows || []) {
    const t = String(row.transcript || "").trim();
    if (!t) continue;
    if (row.recording_url) wordsByUrl.set(row.recording_url, t);
  }

  function excerptFor(url, flaggedWords) {
    const raw = (url && wordsByUrl.get(url)) || "";
    const has = flaggedWords || !!raw;
    return {
      has_words: has,
      excerpt: raw ? raw.slice(0, 240) : null
    };
  }

  for (const row of files) {
    const url = row.web_view_link || null;
    if (url) seenUrl.add(url);
    const when = row.indexed_at || row.created_at;
    const words = excerptFor(url, row.needs_transcription === false);
    items.push({
      id: row.id,
      name: row.name || "Recording",
      url,
      when,
      is_today: isToday(when, now),
      client_id: row.client_id || null,
      client_name: clientDisplayName(row),
      attached: !!row.client_id,
      has_words: words.has_words,
      excerpt: words.excerpt
    });
  }

  for (const row of outcomeRes.rows || []) {
    const url = row.recording_url;
    if (!url || seenUrl.has(url)) continue;
    seenUrl.add(url);
    const raw = String(row.transcript || "").trim();
    items.push({
      id: `call-${row.id}`,
      name: clientDisplayName(row) ? `${clientDisplayName(row)} call` : "Sales call",
      url,
      when: row.logged_at,
      is_today: isToday(row.logged_at, now),
      client_id: row.client_id || null,
      client_name: clientDisplayName(row),
      attached: true,
      has_words: !!raw,
      excerpt: raw ? raw.slice(0, 240) : null
    });
  }

  items.sort((a, b) => new Date(b.when || 0) - new Date(a.when || 0));

  let reason = null;
  if (!config.ready) {
    reason = "Google Drive is not connected yet. Recordings stay in Meet Recordings until Drive is turned on.";
  } else if (!state?.last_sync_at && items.length === 0) {
    reason = "Drive is connected but has not been scanned yet. Hit Refresh from Drive.";
  } else if (items.length === 0) {
    reason = "No Meet recordings in the last 7 days.";
  }

  return {
    drive_ready: config.ready,
    missing: config.ready ? [] : config.missing,
    last_sync_at: state?.last_sync_at || null,
    last_error: state?.last_error || null,
    reason,
    items
  };
}
