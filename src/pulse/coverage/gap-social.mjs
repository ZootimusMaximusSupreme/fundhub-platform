// YouTube and social stats for the morning pulse. Read only. Report only.
//
// Slice coverage already lists read/video-stats and the Social Studio page.
// This file does not repeat that list. It looks for three breaks:
// a YouTube connection with last_error set, a video stats sync older than
// 3 times its daily snapshot, and a Social Studio read that answers 500.
//
// The sync writes one snapshot per day. There is no sweeper.
// Red after 3 days, same 3x rule as job heartbeats.
// Recon (AG-07) is the one tripwire. Do not call YouTube. Do not refresh OAuth.

/** One day. The sync stores one stat_date per run. */
export const VIDEO_STATS_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Red after 3 times the daily snapshot. Same multiple as job heartbeats. */
export const VIDEO_STATS_STALE_MS = 3 * VIDEO_STATS_INTERVAL_MS;

/** A pending or revoked row is not on the daily snapshot. */
export const WATCHED_STATES = Object.freeze(["active", "error", "expired"]);

export const SOCIAL_STUDIO_GETS = Object.freeze([
  "/api/social/posts",
  "/api/social/channels",
  "/api/social/settings"
]);

export const CHECK_IDS = Object.freeze([
  "social:youtube-last-error",
  "social:video-stats-stale",
  "social:studio-read"
]);

export const YOUTUBE_ERROR_SQL = `
  /* gap:youtube-last-error */
  SELECT count(*)::int AS n,
         string_agg(left(btrim(last_error), 160), ' / ') AS errors
    FROM analytics_connections
   WHERE org_id = $1::uuid
     AND platform = 'youtube'
     AND last_error IS NOT NULL
     AND btrim(last_error) <> ''
`;

export const VIDEO_STATS_SQL = `
  /* gap:video-stats-stale */
  SELECT count(*)::int AS watched,
         max(last_synced_at) AS last_synced_at
    FROM analytics_connections
   WHERE org_id = $1::uuid
     AND platform = 'youtube'
     AND connection_state = ANY($2::text[])
`;

const RECON =
  "Recon (AG-07) is the one tripwire. Do not call YouTube. Do not refresh OAuth. Do not auto-fix from this pulse.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ago(ms) {
  const abs = Math.abs(ms);
  if (abs < 2 * 60 * 60 * 1000) return `${Math.max(1, Math.round(abs / 60000))} min`;
  if (abs < 2 * 24 * 60 * 60 * 1000) return `${Math.round(abs / (60 * 60 * 1000))} h`;
  return `${Math.round(abs / (24 * 60 * 60 * 1000))} days`;
}

function originOf(baseUrl) {
  const raw = String(baseUrl || "https://fundhub.ai").trim() || "https://fundhub.ai";
  return raw.replace(/\/+$/, "");
}

function apiAlive(status) {
  return (
    (status >= 200 && status < 300) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  return { status: Number(res && res.status) };
}

async function checkYoutubeLastError({ db, orgId }) {
  const id = "social:youtube-last-error";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — YouTube connection not read");
  }
  try {
    const { rows } = await db.query(YOUTUBE_ERROR_SQL, [orgId]);
    const hit = rows && rows[0] ? rows[0] : {};
    const n = Number(hit.n);
    if (!Number.isFinite(n)) {
      return row(
        id,
        "FAIL",
        "YouTube last_error count was not a number",
        `${RECON} Read analytics_connections.last_error for platform youtube.`
      );
    }
    if (n === 0) {
      return row(id, "PASS", "YouTube connection has no last_error");
    }
    const errors = String(hit.errors || "set").slice(0, 160);
    const noun = n === 1 ? "connection" : "connections";
    return row(
      id,
      "FAIL",
      `YouTube ${noun} last_error is set: ${errors}`,
      `${RECON} Read analytics_connections.last_error for platform youtube.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read YouTube last_error: ${clip(err)}`,
      `${RECON} Read analytics_connections.last_error for platform youtube.`
    );
  }
}

async function checkVideoStatsStale({ db, orgId, now }) {
  const id = "social:video-stats-stale";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — video stats sync not read");
  }
  try {
    const { rows } = await db.query(VIDEO_STATS_SQL, [orgId, [...WATCHED_STATES]]);
    const hit = rows && rows[0] ? rows[0] : {};
    const watched = Number(hit.watched);
    if (!Number.isFinite(watched)) {
      return row(
        id,
        "FAIL",
        "video stats sync count was not a number",
        `${RECON} Read analytics_connections.last_synced_at for platform youtube.`
      );
    }
    if (watched === 0) {
      return row(
        id,
        "skip",
        "no YouTube connection in active, error, or expired — video stats sync is not on a schedule"
      );
    }
    const last = toDate(hit.last_synced_at);
    const dueBy = now.getTime() - VIDEO_STATS_STALE_MS;
    if (!last || last.getTime() < dueBy) {
      const when = last
        ? `last ran ${last.toISOString()} (${ago(now.getTime() - last.getTime())} ago)`
        : "has never run";
      return row(
        id,
        "FAIL",
        `video stats sync ${when}, past the daily schedule (red after 3 days)`,
        `${RECON} Read analytics_connections.last_synced_at for platform youtube. The snapshot is daily.`
      );
    }
    return row(
      id,
      "PASS",
      `video stats sync last ran ${last.toISOString()} (${ago(now.getTime() - last.getTime())} ago); red after 3 days`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read video stats sync: ${clip(err)}`,
      `${RECON} Read analytics_connections.last_synced_at for platform youtube.`
    );
  }
}

async function checkStudioRead({ fetchImpl, baseUrl }) {
  const id = "social:studio-read";
  if (!fetchImpl) {
    return row(id, "skip", "no fetch — Social Studio read API not checked");
  }
  const origin = originOf(baseUrl);
  const bad = [];
  try {
    for (const path of SOCIAL_STUDIO_GETS) {
      const { status } = await readGet(fetchImpl, `${origin}${path}`);
      if (!apiAlive(status)) bad.push(`${path} ${status}`);
    }
  } catch (err) {
    return row(
      id,
      "FAIL",
      `Social Studio read API unreachable: ${clip(err)}`,
      `${RECON} Restore GET /api/social/posts, /api/social/channels, and /api/social/settings.`
    );
  }
  if (bad.length === 0) {
    return row(id, "PASS", "Social Studio read API answered (GET only)");
  }
  const fiveHundred = bad.some((line) => /\s5\d\d$/.test(line));
  return row(
    id,
    "FAIL",
    fiveHundred
      ? `social studio read API 500: ${bad.join("; ")}`
      : `Social Studio read API down: ${bad.join("; ")}`,
    `${RECON} Restore GET /api/social/posts, /api/social/channels, and /api/social/settings.`
  );
}

/**
 * Three read-only checks. ctx: { db, orgId, now, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fetchImpl = ctx.fetchImpl || null;
  const baseUrl = ctx.baseUrl;
  return [
    await checkYoutubeLastError({ db, orgId }),
    await checkVideoStatsStale({ db, orgId, now }),
    await checkStudioRead({ fetchImpl, baseUrl })
  ];
}
