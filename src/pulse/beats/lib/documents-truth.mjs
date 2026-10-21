// documents:stuck-processing — is a document stuck on its way in or out? Report only. Read only.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). This check, its two counts and its words used to live in
// src/pulse/coverage/gap-documents.mjs. They moved here, unchanged except for the read path, so the morning
// lane (gap-documents.mjs imports them back) and the hourly beat (beat-repair-trip.mjs) judge stuck documents
// with the same code. The lane's helpers moved with it and the lane imports them, so its other three checks
// read the same way they always did. The lane's `ctx` argument is named `input` here only because the beat
// pin refuses the words ctx.db in a beat file or helper (a beat has no database handle); the object is the same.
//
// The three windows come from the lane's own clocks (STALE_MULTIPLE times the vault chase cron and the
// doc-check retry sweeper cron, src/pulse/heartbeats.mjs). A beat may not import those, so STUCK_WINDOWS
// holds the same numbers and documents-truth.test.mjs fails the moment they drift from the lane's.
//
// Read-only. SELECT only. Never uploads a file. Never sends mail. Recon (AG-07) is the one tripwire. Do not
// add a second watchdog. Pure: no imports, no I/O of its own; the caller hands in the reader.

export const ID_STUCK = "documents:stuck-processing";

/** failed_events.handler_name for a document the reader has not finished. */
export const READER_HANDLER = "doc-check";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_MS = 60 * 1000;

/** The lane's three windows, as numbers (3 vault-chase days, 3 retry-sweeper runs, 3 daily back-offs). */
export const STUCK_WINDOWS = Object.freeze({
  vaultRedMs: 3 * DAY_MS,
  readerRedMs: 3 * 20 * MIN_MS,
  readerUnreadMs: 3 * DAY_MS
});

export const RECON =
  "Recon (AG-07) reports this on the morning pulse. Do not build a second watchdog. Do not upload a file from this check. Do not email a client.";

export function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

export function fix(lead) {
  return `${lead} ${RECON}`;
}

export function clip(s, n = 180) {
  return String((s && s.message) || s || "").replace(/\s+/g, " ").trim().slice(0, n);
}

export function windowLabel(ms) {
  if (ms % DAY_MS === 0) {
    const days = ms / DAY_MS;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  const minutes = Math.round(ms / MIN_MS);
  return `${minutes} minutes`;
}

export function countOf(result, key = "n") {
  const n = Number(result && result.rows && result.rows[0] && result.rows[0][key]);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

export function hasDb(input) {
  return !!(input && input.db && typeof input.db.query === "function" && input.orgId);
}

export function nowOf(input) {
  const n = input && input.now;
  if (n instanceof Date && Number.isFinite(n.getTime())) return n;
  return new Date();
}

export async function selectOnly(db, sql, params) {
  const stripped = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  if (!/^select\b/i.test(stripped)) {
    throw new Error("documents gap checks are read-only");
  }
  return db.query(sql, params);
}

export const STUCK_DELIVERY_SQL = `
SELECT count(*) FILTER (WHERE delivery_status = 'pending' AND updated_at < $2::timestamptz)::int AS pending,
       count(*) FILTER (WHERE delivery_status IN ('failed', 'bounced'))::int AS failed
  FROM documents
 WHERE org_id = $1::uuid
   AND is_demo IS NOT TRUE
   AND delivery_status IN ('pending', 'failed', 'bounced')`;

export const STUCK_READER_SQL = `
SELECT count(*) FILTER (WHERE coalesce(next_attempt_at, last_seen_at) < $3::timestamptz)::int AS overdue,
       count(*) FILTER (WHERE first_seen_at < $4::timestamptz)::int AS unread
  FROM failed_events
 WHERE org_id = $1::uuid
   AND handler_name = $2::text
   AND status = 'pending'`;

export const STUCK_FIX =
  "Read documents stuck at delivery_status pending, failed or bounced, and failed_events for handler doc-check. The retry sweeper already owns the read; if it keeps failing, look at why the reader cannot answer.";

export async function checkStuckProcessing(input, windows = STUCK_WINDOWS) {
  const { vaultRedMs: VAULT_RED_MS, readerRedMs: READER_RED_MS, readerUnreadMs: READER_UNREAD_MS } = windows;
  if (!hasDb(input)) {
    return check(ID_STUCK, "skip", "no database in this run — stuck document rows not read");
  }
  const now = nowOf(input);
  const deliveryCutoff = new Date(now.getTime() - VAULT_RED_MS);
  const readerCutoff = new Date(now.getTime() - READER_RED_MS);
  const unreadCutoff = new Date(now.getTime() - READER_UNREAD_MS);
  const [delivery, reader] = await Promise.all([
    selectOnly(input.db, STUCK_DELIVERY_SQL, [input.orgId, deliveryCutoff.toISOString()]),
    selectOnly(input.db, STUCK_READER_SQL, [
      input.orgId,
      READER_HANDLER,
      readerCutoff.toISOString(),
      unreadCutoff.toISOString()
    ])
  ]);
  const pending = countOf(delivery, "pending");
  const failed = countOf(delivery, "failed");
  const overdue = countOf(reader, "overdue");
  const unread = countOf(reader, "unread");
  const pendingLabel = windowLabel(VAULT_RED_MS);
  const readLabel = windowLabel(READER_RED_MS);
  const unreadLabel = windowLabel(READER_UNREAD_MS);
  if (pending === 0 && failed === 0 && overdue === 0 && unread === 0) {
    return check(
      ID_STUCK,
      "PASS",
      `no document row stuck pending past ${pendingLabel} or failed to deliver, and no doc-check read overdue past ${readLabel} or unread past ${unreadLabel}`
    );
  }
  const parts = [];
  if (pending > 0) {
    parts.push(`${pending} document row${pending === 1 ? "" : "s"} stuck pending past ${pendingLabel}`);
  }
  if (failed > 0) {
    parts.push(`${failed} document row${failed === 1 ? "" : "s"} failed or bounced on delivery`);
  }
  if (overdue > 0) {
    parts.push(`${overdue} document read${overdue === 1 ? "" : "s"} still processing past ${readLabel}`);
  }
  if (unread > 0) {
    parts.push(`${unread} document${unread === 1 ? "" : "s"} still unread after ${unreadLabel} of retries`);
  }
  return check(
    ID_STUCK,
    "FAIL",
    parts.join("; "),
    fix(STUCK_FIX)
  );
}
checkStuckProcessing.checkId = ID_STUCK;

/** What the morning lane says when a read throws (gap-documents.mjs gapChecks). Same words hourly. */
export function readFailedRow(id, err) {
  return check(id, "FAIL", `read failed: ${clip(err)}`, fix("Read the document gap query. Do not write from this check."));
}

/**
 * The hourly read. Same check, same windows, through io.read. Two rules on top, both about the read:
 *   - a count that comes back with no row is unread, so the check is a skip, never a green zero;
 *   - a read that throws gets the lane's own words (readFailedRow).
 * @param {{ read: Function, orgId: string, now: Date }} io
 */
export async function readStuckProcessing(io) {
  let empty = false;
  const db = {
    query: async (sql, params) => {
      const out = await io.read(sql, params);
      if (!out || !Array.isArray(out.rows) || out.rows.length === 0) empty = true;
      return out;
    }
  };
  try {
    const result = await checkStuckProcessing({ db, orgId: io.orgId, now: io.now });
    if (empty) return check(ID_STUCK, "skip", "a stuck document count came back with no row, so it was not judged");
    return result;
  } catch (err) {
    return readFailedRow(ID_STUCK, err);
  }
}
