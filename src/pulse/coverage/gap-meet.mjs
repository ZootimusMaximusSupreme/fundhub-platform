// Meet tape → transcript → closer context. Read only.
// Tripwire is existing Recon (AG-07) plus meet-transcript-sweeper.
// Do not add another watcher. Do not transcribe a file. Do not call an AI.
//
// A recording with no words is red only after the wait the sweeper already
// allows (3 times its schedule, same multiple as job heartbeats).
// Job lateness stays on checkJobHeartbeats. This file only reads a failed run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const MEET_JOB = "meet-transcript-sweeper";

export const CHECK_IDS = Object.freeze([
  "meet:recording-no-transcript",
  "meet:transcript-unreadable",
  "meet:transcriber-failed"
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Leave that agent on the morning pulse. " +
  "Do not auto-fix. Do not transcribe a new file. Do not call an AI. Do not add another watcher.";

const RECORDING_FIX =
  `${RECON} Read Meet files still waiting on words and sales calls that have a recording link and an empty transcript. ` +
  `The existing ${MEET_JOB} is the only job.`;

const UNREADABLE_FIX =
  `${RECON} Read call_outcomes.transcript against the calls fetchContext loads in src/agents/context.mjs. ` +
  `The existing ${MEET_JOB} is the only job.`;

const JOB_FIX =
  `${RECON} Read the last job_heartbeats row for ${MEET_JOB}. Do not re-run it from this pulse.`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").slice(0, 180);
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
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

/** Milliseconds the sweeper is allowed before a stored recording with no words is late. */
export function transcriptWaitMs(readText = defaultReadText) {
  const src = readText("src/workflows/meet-transcript-sweeper.mjs");
  const match = String(src || "").match(/export const SWEEP_CRON = "([^"]+)"/);
  const interval = match ? cronIntervalMs(match[1]) : null;
  if (!interval) return null;
  return STALE_MULTIPLE * interval;
}

/** How many newest calls fetchContext reads. Null when that query cannot be read. */
export function fetchContextCallLimit(readText = defaultReadText) {
  const src = readText("src/agents/context.mjs");
  const match = String(src || "").match(/FROM call_outcomes[\s\S]{0,400}?LIMIT\s+(\d+)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function recordingSql() {
  return `
  /* gap:meet-recording-no-transcript */
  WITH pending_files AS (
    SELECT COALESCE(NULLIF(btrim(bf.web_view_link), ''), 'file:' || bf.id::text) AS key
      FROM brain_files bf
     WHERE bf.org_id = $1::uuid
       AND bf.needs_transcription = true
       AND ${meetNameSql("bf")}
       AND COALESCE(bf.indexed_at, bf.created_at) < $2::timestamptz
       AND NOT EXISTS (
         SELECT 1
           FROM brain_chunks bc
          WHERE bc.file_id = bf.id
            AND bc.org_id = bf.org_id
            AND btrim(bc.content) <> ''
       )
       AND NOT EXISTS (
         SELECT 1
           FROM clients c
          WHERE c.id = bf.client_id
            AND c.org_id = bf.org_id
            AND c.is_demo = true
       )
  ),
  pending_calls AS (
    SELECT btrim(co.recording_url) AS key
      FROM call_outcomes co
     WHERE co.org_id = $1::uuid
       AND COALESCE(co.is_demo, false) = false
       AND co.recording_url IS NOT NULL
       AND btrim(co.recording_url) <> ''
       AND (co.transcript IS NULL OR btrim(co.transcript) = '')
       AND co.logged_at < $2::timestamptz
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
  )
  SELECT count(*)::int AS n
    FROM (
      SELECT key FROM pending_files
      UNION
      SELECT key FROM pending_calls
    ) tapes
`;
}

function unreadableSql() {
  return `
  /* gap:meet-transcript-unreadable */
  WITH recent AS (
    SELECT co.org_id,
           co.client_id,
           co.transcript,
           row_number() OVER (
             PARTITION BY co.org_id, co.client_id
             ORDER BY co.logged_at DESC, co.id DESC
           ) AS rn
      FROM call_outcomes co
     WHERE co.org_id = $1::uuid
       AND COALESCE(co.is_demo, false) = false
  ),
  windowed AS (
    SELECT org_id, client_id
      FROM recent
     WHERE rn <= $2::int
     GROUP BY org_id, client_id
    HAVING bool_or(transcript IS NOT NULL AND btrim(transcript) <> '')
  ),
  words_on_file AS (
    SELECT COALESCE(bf.client_id::text, 'file:' || bf.id::text) AS key
      FROM brain_files bf
     WHERE bf.org_id = $1::uuid
       AND (
         ${meetNameSql("bf")}
         OR (
           ${transcriptNameSql("bf")}
           AND bf.client_id IS NOT NULL
           AND EXISTS (
             SELECT 1
               FROM call_outcomes co
              WHERE co.org_id = bf.org_id
                AND co.client_id = bf.client_id
                AND COALESCE(co.is_demo, false) = false
                AND co.recording_url IS NOT NULL
                AND btrim(co.recording_url) <> ''
           )
         )
       )
       AND EXISTS (
         SELECT 1
           FROM brain_chunks bc
          WHERE bc.file_id = bf.id
            AND bc.org_id = bf.org_id
            AND btrim(bc.content) <> ''
       )
       AND (
         bf.client_id IS NULL
         OR NOT EXISTS (
           SELECT 1
             FROM windowed w
            WHERE w.org_id = bf.org_id
              AND w.client_id = bf.client_id
         )
       )
       AND NOT EXISTS (
         SELECT 1
           FROM clients c
          WHERE c.id = bf.client_id
            AND c.org_id = bf.org_id
            AND c.is_demo = true
       )
  ),
  words_hidden AS (
    SELECT co.client_id::text AS key
      FROM call_outcomes co
     WHERE co.org_id = $1::uuid
       AND COALESCE(co.is_demo, false) = false
       AND co.transcript IS NOT NULL
       AND btrim(co.transcript) <> ''
       AND NOT EXISTS (
         SELECT 1
           FROM windowed w
          WHERE w.org_id = co.org_id
            AND w.client_id = co.client_id
       )
  )
  SELECT count(*)::int AS n
    FROM (
      SELECT key FROM words_on_file
      UNION
      SELECT key FROM words_hidden
    ) missed
`;
}

const JOB_SQL = `
  /* gap:meet-transcriber-failed */
  SELECT outcome, left(error, 160) AS error, finished_at
    FROM job_heartbeats
   WHERE job = $1
   ORDER BY finished_at DESC
   LIMIT 1
`;

async function checkRecording({ db, orgId, now, readText }) {
  const id = "meet:recording-no-transcript";
  if (!db) return row(id, "skip", "no database in this run — Meet recordings not read");
  if (!orgId) return row(id, "skip", "no company in this run — Meet recordings not read");
  let waitMs;
  try {
    waitMs = transcriptWaitMs(readText);
  } catch (err) {
    return row(id, "FAIL", `could not read the sweeper wait: ${clip(err)}`, RECORDING_FIX);
  }
  if (!waitMs) {
    return row(
      id,
      "FAIL",
      "could not read the sweeper schedule, so the wait is unknown.",
      RECORDING_FIX
    );
  }
  const minutes = Math.round(waitMs / 60000);
  const cutoff = new Date(now.getTime() - waitMs).toISOString();
  try {
    const result = await db.query(recordingSql(), [orgId, cutoff]);
    const n = countOf(result);
    if (n === 0) {
      return row(id, "PASS", `no Meet recording is still without a transcript after the ${minutes}-minute wait`);
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "Meet recording")} stored with no transcript after the ${minutes}-minute wait.`,
      RECORDING_FIX
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read Meet recordings: ${clip(err)}`,
      RECORDING_FIX
    );
  }
}

async function checkUnreadable({ db, orgId, readText }) {
  const id = "meet:transcript-unreadable";
  if (!db) return row(id, "skip", "no database in this run — Meet transcripts not read");
  if (!orgId) return row(id, "skip", "no company in this run — Meet transcripts not read");
  let limit;
  try {
    limit = fetchContextCallLimit(readText);
  } catch (err) {
    return row(id, "FAIL", `could not read the fetchContext call limit: ${clip(err)}`, UNREADABLE_FIX);
  }
  if (!limit) {
    return row(
      id,
      "FAIL",
      "could not read how many calls fetchContext loads, so a stored transcript cannot be checked.",
      UNREADABLE_FIX
    );
  }
  try {
    const result = await db.query(unreadableSql(), [orgId, limit]);
    const n = countOf(result);
    if (n === 0) {
      return row(
        id,
        "PASS",
        `every stored Meet transcript is in the ${limit} calls fetchContext reads`
      );
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "Meet transcript")} stored where fetchContext cannot read ${n === 1 ? "it" : "them"}.`,
      UNREADABLE_FIX
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read Meet transcripts: ${clip(err)}`,
      UNREADABLE_FIX
    );
  }
}

function stamp(value) {
  if (!value) return "unknown time";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "unknown time";
  return d.toISOString();
}

async function checkTranscriber({ db }) {
  const id = "meet:transcriber-failed";
  if (!db) return row(id, "skip", "no database in this run — transcriber job not read");
  try {
    const result = await db.query(JOB_SQL, [MEET_JOB]);
    const hit = result?.rows?.[0];
    if (!hit) {
      return row(id, "skip", `no ${MEET_JOB} heartbeat yet — job failure not read`);
    }
    if (hit.outcome === "error") {
      const why = clip(hit.error || "no message");
      return row(
        id,
        "FAIL",
        `${MEET_JOB} last run failed at ${stamp(hit.finished_at)}: ${why}.`,
        JOB_FIX
      );
    }
    return row(id, "PASS", `${MEET_JOB} last run finished ok at ${stamp(hit.finished_at)}`);
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read the transcriber job: ${clip(err)}`,
      JOB_FIX
    );
  }
}

/**
 * Three read-only checks. ctx: { db, orgId, now, readText }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db && typeof ctx.db.query === "function" ? ctx.db : null;
  const orgId = ctx.orgId ? String(ctx.orgId) : null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  return [
    await checkRecording({ db, orgId, now, readText }),
    await checkUnreadable({ db, orgId, readText }),
    await checkTranscriber({ db })
  ];
}
