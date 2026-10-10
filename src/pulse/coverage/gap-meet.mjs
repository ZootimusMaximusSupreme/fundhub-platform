// Meet tape → transcript → closer context. Read only.
// Tripwire is existing Recon (AG-07) plus meet-transcript-sweeper.
// Do not add another watcher. Do not transcribe a file. Do not call a model.
//
// Already on the morning list, so not repeated here:
//   * machine row "meet-transcript-sweeper" (src/pulse/machine.mjs) goes red when a
//     Meet file in Company Brain still has no words 30 minutes after it was indexed,
//     and when Drive has not been scanned for 3 times the sweeper schedule.
//   * job row "job:meet-transcript-sweeper" (checkJobHeartbeats) goes red when the
//     sweeper is late OR when its last run ended in an error.
// This file reads the two things those rows cannot see:
//   1. a sales call that carries a recording link and still has no words;
//   2. words that exist for a client but do not reach fetchContext, the closer's
//      context read. Asked by running fetchContext itself, not by copying its query.
//
// The repo files are not on disk in the shipped function, so nothing here reads
// one. The wait comes from the sweeper's own schedule constant, imported.

import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import { SWEEP_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import { fetchContext as realFetchContext } from "../../agents/context.mjs";

export const MEET_JOB = "meet-transcript-sweeper";

export const CHECK_IDS = Object.freeze([
  "meet:recording-no-transcript",
  "meet:transcript-unreadable"
]);

/** Three times the sweeper schedule: the wait the job heartbeat already allows. */
export const TRANSCRIPT_WAIT_MS = STALE_MULTIPLE * (cronIntervalMs(SWEEP_CRON) || 10 * 60 * 1000);
export const LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
/** Clients asked per morning. fetchContext is about ten reads each. */
export const CLIENT_CAP = 15;

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not transcribe a new file. Do not call a model. Do not add another watcher.";

const RECORDING_FIX =
  `${RECON} Open the sales call that has a recording link and no words. ` +
  `The existing ${MEET_JOB} is the only job.`;

const UNREADABLE_FIX =
  `${RECON} Words exist for this client but the last 3 calls fetchContext loads carry none. ` +
  `Read call_outcomes.transcript for the client. The existing ${MEET_JOB} is the only job.`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 180);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function nonempty(v) {
  return String(v == null ? "" : v).trim() !== "";
}

function minutesOf(ms) {
  return Math.round(ms / 60000);
}

function meetNameSql(alias) {
  return `
    ${alias}.name !~* 'screen[- ]?record'
    AND (
      ${alias}.name ~* '(google[[:space:]]+)?meet(ing)?[[:space:]]+recording'
      OR ${alias}.name ~* '(^|[^[:alnum:]])google[[:space:]]+meet([^[:alnum:]]|$)'
      OR ${alias}.name ~* '(^|[^[:alnum:]])gmt[0-9]{8}([^[:alnum:]]|$)'
    )`;
}

function transcriptNameSql(alias) {
  return `
    (
      ${alias}.name ~* '(^|[^[:alnum:]])transcript([^[:alnum:]]|$)'
      OR ${alias}.name ~* 'gemini[[:space:]]+notes'
    )`;
}

/**
 * Logged sales calls with a recording link, no words on the call, and no words
 * in Company Brain for that link or that client's Meet file either. Demo calls
 * are left out. Calls older than 14 days age out. $2 is the end of the wait,
 * $3 is the start of the window.
 */
export const RECORDING_SQL = `
  /* gap:meet-recording-no-transcript */
  SELECT co.id::text AS key
    FROM call_outcomes co
    LEFT JOIN clients c ON c.id = co.client_id AND c.org_id = co.org_id
   WHERE co.org_id = $1::uuid
     AND COALESCE(co.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND co.recording_url IS NOT NULL
     AND btrim(co.recording_url) <> ''
     AND (co.transcript IS NULL OR btrim(co.transcript) = '')
     AND co.logged_at < $2::timestamptz
     AND co.logged_at >= $3::timestamptz
     AND NOT EXISTS (
       SELECT 1
         FROM brain_files bf
         JOIN brain_chunks bc ON bc.file_id = bf.id AND bc.org_id = bf.org_id
        WHERE bf.org_id = co.org_id
          AND btrim(bc.content) <> ''
          AND (
            bf.web_view_link = co.recording_url
            OR (
              bf.client_id = co.client_id
              AND ${meetNameSql("bf")}
            )
          )
     )
   ORDER BY co.logged_at DESC
   LIMIT 50
`;

/**
 * Clients with Meet words in the last 14 days: a transcript on a call, or a
 * Meet recording or transcript file with text in Company Brain that is past the
 * wait and has a call to hold it. $2 window start, $3 end of the wait, $4 cap.
 */
export const CANDIDATE_SQL = `
  /* gap:meet-transcript-unreadable */
  SELECT u.client_id::text AS client_id
    FROM (
      SELECT co.client_id, max(co.logged_at) AS at
        FROM call_outcomes co
       WHERE co.org_id = $1::uuid
         AND COALESCE(co.is_demo, false) = false
         AND co.client_id IS NOT NULL
         AND co.transcript IS NOT NULL
         AND btrim(co.transcript) <> ''
         AND co.logged_at >= $2::timestamptz
       GROUP BY co.client_id
      UNION ALL
      SELECT bf.client_id, max(COALESCE(bf.indexed_at, bf.created_at)) AS at
        FROM brain_files bf
       WHERE bf.org_id = $1::uuid
         AND bf.client_id IS NOT NULL
         AND (
           (${meetNameSql("bf")})
           OR ${transcriptNameSql("bf")}
         )
         AND COALESCE(bf.indexed_at, bf.created_at) >= $2::timestamptz
         AND COALESCE(bf.indexed_at, bf.created_at) < $3::timestamptz
         AND EXISTS (
           SELECT 1
             FROM brain_chunks bc
            WHERE bc.file_id = bf.id
              AND bc.org_id = bf.org_id
              AND btrim(bc.content) <> ''
         )
         AND EXISTS (
           SELECT 1
             FROM call_outcomes co2
            WHERE co2.org_id = bf.org_id
              AND co2.client_id = bf.client_id
              AND COALESCE(co2.is_demo, false) = false
         )
       GROUP BY bf.client_id
    ) u
    JOIN clients c ON c.id = u.client_id AND c.org_id = $1::uuid
   WHERE COALESCE(c.is_demo, false) = false
   GROUP BY u.client_id
   ORDER BY max(u.at) DESC
   LIMIT $4::int
`;

async function checkRecording({ db, orgId, now }) {
  const id = CHECK_IDS[0];
  if (!db) return row(id, "skip", "no database in this run — Meet recordings not read");
  if (!orgId) return row(id, "skip", "no company in this run — Meet recordings not read");
  const minutes = minutesOf(TRANSCRIPT_WAIT_MS);
  try {
    const result = await db.query(RECORDING_SQL, [
      orgId,
      new Date(now.getTime() - TRANSCRIPT_WAIT_MS).toISOString(),
      new Date(now.getTime() - LOOKBACK_MS).toISOString()
    ]);
    const n = Array.isArray(result?.rows) ? result.rows.length : 0;
    if (n === 0) {
      return row(id, "PASS", `no logged call has a recording link and still no words after the ${minutes}-minute wait`);
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "logged call")} with a recording link and no transcript after the ${minutes}-minute wait.`,
      RECORDING_FIX
    );
  } catch (err) {
    return row(id, "FAIL", `could not read Meet recordings: ${clip(err)}`, RECORDING_FIX);
  }
}

/** The closer reads the last 3 calls. Words count when one of them carries some. */
export function contextHasWords(context) {
  const calls = Array.isArray(context?.recent_calls) ? context.recent_calls : [];
  return calls.some((call) => nonempty(call && call.transcript));
}

async function checkUnreadable({ db, orgId, now, fetchContext }) {
  const id = CHECK_IDS[1];
  if (!db) return row(id, "skip", "no database in this run — Meet transcripts not read");
  if (!orgId) return row(id, "skip", "no company in this run — Meet transcripts not read");
  try {
    const found = await db.query(CANDIDATE_SQL, [
      orgId,
      new Date(now.getTime() - LOOKBACK_MS).toISOString(),
      new Date(now.getTime() - TRANSCRIPT_WAIT_MS).toISOString(),
      CLIENT_CAP
    ]);
    const clientIds = (Array.isArray(found?.rows) ? found.rows : [])
      .map((r) => (r && r.client_id ? String(r.client_id) : null))
      .filter(Boolean);
    if (clientIds.length === 0) {
      return row(id, "PASS", "no client has Meet words from the last 14 days to check against fetchContext");
    }
    let hidden = 0;
    const errors = [];
    for (const clientId of clientIds) {
      try {
        const context = await fetchContext(db, { orgId, clientId });
        if (!contextHasWords(context)) hidden += 1;
      } catch (err) {
        errors.push(clip(err));
      }
    }
    if (errors.length > 0) {
      return row(
        id,
        "FAIL",
        `fetchContext failed for ${plural(errors.length, "client")} with Meet words: ${errors[0]}`,
        UNREADABLE_FIX
      );
    }
    if (hidden > 0) {
      return row(
        id,
        "FAIL",
        `${plural(hidden, "client")} with Meet words where fetchContext shows no transcript in the last 3 calls.`,
        UNREADABLE_FIX
      );
    }
    return row(id, "PASS", `fetchContext shows the Meet words for all ${plural(clientIds.length, "client")} checked`);
  } catch (err) {
    return row(id, "FAIL", `could not read Meet transcripts: ${clip(err)}`, UNREADABLE_FIX);
  }
}

/**
 * Two read-only checks. ctx: { db, orgId, now, fetchContext? }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const c = ctx || {};
  const db = c.db && typeof c.db.query === "function" ? c.db : null;
  const orgId = c.orgId ? String(c.orgId) : null;
  const now = c.now instanceof Date ? c.now : new Date();
  const fetchContext = typeof c.fetchContext === "function" ? c.fetchContext : realFetchContext;
  return [
    await checkRecording({ db, orgId, now }),
    await checkUnreadable({ db, orgId, now, fetchContext })
  ];
}
