// Missing-record tripwire. Sales calls must be recorded.
// Does not start Meet. Does not auto-record. Flags a logged call that
// still has no Drive link and no transcript after a short wait.

export const GRACE_MS = 20 * 60 * 1000;
export const LOOKBACK_DAYS = 14;
export const FLAG = "unrecorded";

const NO_SHOW = "no_show";

function nonempty(v) {
  return String(v || "").trim() !== "";
}

export function hasTape(row = {}) {
  return nonempty(row.recording_url)
    || nonempty(row.recordingUrl)
    || nonempty(row.transcript);
}

export function isUnrecorded(row, {
  now = new Date(),
  graceMs = GRACE_MS,
  driveSyncedAt = null
} = {}) {
  if (!row) return false;
  if (String(row.outcome || "").toLowerCase() === NO_SHOW) return false;
  if (hasTape(row)) return false;
  const logged = new Date(row.logged_at || row.ended_at || 0);
  if (Number.isNaN(logged.getTime())) return false;
  if (now.getTime() >= logged.getTime() + graceMs) return true;
  if (driveSyncedAt) {
    const synced = new Date(driveSyncedAt);
    if (!Number.isNaN(synced.getTime()) && synced.getTime() > logged.getTime()) {
      return true;
    }
  }
  return false;
}

function clientDisplayName(row) {
  const name = String(row?.client_name || "").trim();
  if (name) return name;
  return [row?.first_name, row?.last_name].filter(Boolean).join(" ").trim() || "Client";
}

export function presentUnrecorded(row) {
  if (!row) return null;
  return {
    id: row.id,
    client_id: row.client_id || null,
    staff_id: row.staff_id || null,
    client_name: clientDisplayName(row),
    outcome: row.outcome || null,
    logged_at: row.logged_at || null,
    flag: FLAG,
    detail: "Logged sales call has no recording link and no transcript"
  };
}

async function lastDriveSyncAt(db, orgId) {
  try {
    const r = await db.query(
      `SELECT last_sync_at FROM brain_drive_sync WHERE org_id = $1`,
      [orgId]
    );
    return r.rows?.[0]?.last_sync_at || null;
  } catch {
    return null;
  }
}

/** Held sales calls with no tape after the grace window (or after Drive sync). */
export async function listUnrecordedCalls(db, {
  orgId,
  staffId = null,
  now = new Date(),
  graceMs = GRACE_MS,
  lookbackDays = LOOKBACK_DAYS,
  limit = 50
} = {}) {
  if (!orgId || !db) return [];
  const since = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  const params = [orgId, since.toISOString()];
  let staffClause = "";
  if (staffId) {
    params.push(staffId);
    staffClause = `AND o.staff_id = $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 50, 1), 200));

  const r = await db.query(
    `SELECT o.id, o.client_id, o.staff_id, o.outcome, o.recording_url,
            o.transcript, o.logged_at,
            COALESCE(NULLIF(trim(c.first_name || ' ' || c.last_name), ''), c.email, 'Client') AS client_name
       FROM call_outcomes o
       LEFT JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
      WHERE o.org_id = $1
        AND COALESCE(o.is_demo, false) = false
        AND o.outcome <> 'no_show'
        AND o.logged_at >= $2
        AND (o.recording_url IS NULL OR btrim(o.recording_url) = '')
        AND (o.transcript IS NULL OR btrim(o.transcript) = '')
        ${staffClause}
      ORDER BY o.logged_at ASC
      LIMIT $${params.length}`,
    params
  );

  const driveSyncedAt = await lastDriveSyncAt(db, orgId);
  return (r.rows || [])
    .filter((row) => isUnrecorded(row, { now, graceMs, driveSyncedAt }))
    .map(presentUnrecorded);
}

export async function countUnrecorded(db, opts = {}) {
  const rows = await listUnrecordedCalls(db, { ...opts, limit: 200 });
  return rows.length;
}
