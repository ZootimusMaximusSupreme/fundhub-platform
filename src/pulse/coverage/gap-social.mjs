// YouTube and social stats for the morning pulse. Read only. Report only.
//
// Slice coverage already lists read/video-stats and the Social Studio page.
// The registry already pings /api/social/posts, /channels and /settings.
// This file does not repeat those pings. It looks for three breaks:
// a YouTube connection that is broken, a video stats sync that has gone
// quiet, and a Social Studio read that would answer 500.
//
// Recon (AG-07) is the one tripwire. Do not call YouTube. Do not refresh OAuth.
//
// Review notes (Claude, 2026-10-08):
//   * analytics_connections, social_channels, partner_module_settings and
//     marketing_content_queue are staff-only under row security. The first draft
//     read them on the plain database role, which sees ZERO rows there. A broken
//     YouTube connection would still have read PASS. Every read now goes through
//     ctx.scope (the staff scope); ctx.db is only the fallback when no scope is
//     passed (tests, a laptop).
//   * The Social Studio probe sent GET to three API routes and called a 401
//     "up". The registry already does exactly that every morning, and a 401 never
//     reaches the read. It now runs the same SELECTs the screen runs, on the
//     staff scope. A missing column or table makes them throw, and that throw is
//     the 500 the screen would show.
//   * The sync is not on a clock. api/analytics/youtube-sync.mjs only runs when
//     someone presses "Sync now" on Creative Factory. It writes one snapshot per
//     day it is run. Red after 3 days still means "the trend line has a hole".
//   * A connection that has never synced was judged against "never ran". It is now
//     judged against the day it was connected, so a fresh connection is not red.
//   * A connection left in state error or expired with no last_error text was
//     missed. It now counts.
//   * Nothing to judge (owner law 2026-10-09: a live thing is never "not checked").
//     social:video-stats-stale returns status "na" with na: { code: "not-connected",
//     args } when the read really shows no active YouTube connection. `naVerify`
//     re-reads with VIDEO_STATS_SQL, so the audit can prove the claim again.

/** One day. The sync stores one stat_date per run. */
export const VIDEO_STATS_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Red after 3 times the daily snapshot. Same multiple as job heartbeats. */
export const VIDEO_STATS_STALE_MS = 3 * VIDEO_STATS_INTERVAL_MS;

/**
 * Only an active connection is judged for a quiet sync. An error or expired
 * connection is already red on social:youtube-last-error. A pending or revoked
 * one is not on the snapshot at all.
 */
export const WATCHED_STATES = Object.freeze(["active"]);

/** A connection in one of these states is broken even if last_error is empty. */
export const BROKEN_STATES = Object.freeze(["error", "expired"]);

export const CHECK_IDS = Object.freeze([
  "social:youtube-last-error",
  "social:video-stats-stale",
  "social:studio-read"
]);

export const YOUTUBE_ERROR_SQL = `
  /* gap:youtube-last-error */
  SELECT count(*)::int AS n,
         string_agg(
           left(COALESCE(NULLIF(btrim(last_error), ''), 'state ' || connection_state), 160),
           ' / '
         ) AS errors
    FROM analytics_connections
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
     AND platform = 'youtube'
     AND (
       (last_error IS NOT NULL AND btrim(last_error) <> '')
       OR connection_state = ANY($2::text[])
     )
`;

export const VIDEO_STATS_SQL = `
  /* gap:video-stats-stale */
  SELECT count(*)::int AS watched,
         max(last_synced_at) AS last_synced_at,
         max(created_at) AS connected_at
    FROM analytics_connections
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
     AND platform = 'youtube'
     AND connection_state = ANY($2::text[])
`;

/** The same SELECT list api/social/posts.mjs runs on GET. One row is enough. */
export const STUDIO_POSTS_SQL = `
  /* gap:studio-posts */
  SELECT id, caption, offer_type, scheduled_for, status, social_post_id,
         blocked_reasons, created_at, updated_at
    FROM marketing_content_queue
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
   ORDER BY created_at DESC
   LIMIT 1
`;

export const STUDIO_PARTNER_SQL = `
  /* gap:studio-partner */
  SELECT id::text AS id
    FROM partners
   WHERE ($1::uuid IS NULL OR org_id = $1::uuid)
   ORDER BY created_at ASC
   LIMIT 1
`;

const RECON =
  "Recon (AG-07) is the one tripwire. Do not call YouTube. Do not refresh OAuth. Do not auto-fix from this pulse.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** "Nothing to judge today": status na plus the code the audit re-checks. */
function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

function clip(err, n = 160) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, n);
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

/** The staff scope when the pulse passes one, else the plain handle (tests, a laptop). */
function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

async function one(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows && out.rows[0]) || {};
}

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the
 * same SQL (VIDEO_STATS_SQL) and the same watched states the lane used, and answers
 * true only when the read really counts zero active YouTube connections. No read,
 * or a count that is not a number, is false. A read that throws is left to throw:
 * the audit counts a throw as false.
 * @param {{ check?: string, orgId?: string }} args
 * @param {{ db?: any, scope?: Function, orgId?: string }} ctx
 */
export const naVerify = Object.freeze({
  "not-connected": async (args, ctx = {}) => {
    if (!args || args.check !== "social:video-stats-stale") return false;
    const run = bind(ctx);
    if (!run) return false;
    const orgId = args.orgId || ctx.orgId || null;
    const hit = await one(run, VIDEO_STATS_SQL, [orgId, [...WATCHED_STATES]]);
    if (hit.watched == null || hit.watched === "") return false;
    const watched = Number(hit.watched);
    return Number.isFinite(watched) && watched === 0;
  }
});

async function checkYoutubeLastError({ run, orgId }) {
  const id = "social:youtube-last-error";
  if (!run) return row(id, "skip", "no database in this run — YouTube connection not read");
  const fix = `${RECON} Read analytics_connections.last_error for platform youtube.`;
  try {
    const hit = await one(run, YOUTUBE_ERROR_SQL, [orgId, [...BROKEN_STATES]]);
    const n = Number(hit.n);
    if (!Number.isFinite(n)) {
      return row(id, "FAIL", "YouTube last_error count was not a number", fix);
    }
    if (n === 0) {
      return row(id, "PASS", "YouTube connection has no last_error and is not in error or expired");
    }
    const errors = String(hit.errors || "set").slice(0, 160);
    const noun = n === 1 ? "connection" : "connections";
    return row(id, "FAIL", `YouTube ${noun} is broken: ${errors}`, fix);
  } catch (err) {
    return row(id, "FAIL", `could not read YouTube last_error: ${clip(err)}`, fix);
  }
}

async function checkVideoStatsStale({ run, orgId, now }) {
  const id = "social:video-stats-stale";
  if (!run) return row(id, "skip", "no database in this run — video stats sync not read");
  const fix =
    `${RECON} Read analytics_connections.last_synced_at for platform youtube. ` +
    "Nothing runs this sync on a clock; it moves when someone presses Sync now on Creative Factory.";
  try {
    const hit = await one(run, VIDEO_STATS_SQL, [orgId, [...WATCHED_STATES]]);
    const watched = Number(hit.watched);
    if (!Number.isFinite(watched)) {
      return row(id, "FAIL", "video stats sync count was not a number", fix);
    }
    if (watched === 0) {
      const why = "no active YouTube connection, so there is no video stats sync to be late.";
      // Only a count the read really sent is proof. A null count stays a skip.
      if (hit.watched == null || hit.watched === "") return row(id, "skip", why);
      const args = { check: id };
      if (orgId) args.orgId = String(orgId);
      return naRow(id, "not-connected", args, `${why} Judged the day one is connected.`);
    }
    const last = toDate(hit.last_synced_at);
    const connected = toDate(hit.connected_at);
    const since = last || connected;
    if (!since) {
      return row(id, "FAIL", "video stats sync has no sync time and no connect time", fix);
    }
    const age = now.getTime() - since.getTime();
    if (age > VIDEO_STATS_STALE_MS) {
      const when = last
        ? `last ran ${last.toISOString()} (${ago(age)} ago)`
        : `has never run since it was connected ${ago(age)} ago`;
      return row(id, "FAIL", `video stats sync ${when}, past the daily snapshot (red after 3 days)`, fix);
    }
    const when = last
      ? `last ran ${last.toISOString()} (${ago(age)} ago)`
      : `was connected ${ago(age)} ago and has not run yet`;
    return row(id, "PASS", `video stats sync ${when}; red after 3 days`);
  } catch (err) {
    return row(id, "FAIL", `could not read video stats sync: ${clip(err)}`, fix);
  }
}

/** The two Social Studio readers that api/social exports. Literal imports so the server bundle packs them. */
async function loadReaders(ctx) {
  if (ctx && ctx.socialReaders) return ctx.socialReaders;
  const [channels, settings] = await Promise.all([
    import("../../../api/social/channels.mjs"),
    import("../../../api/social/settings.mjs")
  ]);
  return { fetchChannelRows: channels.fetchRows, readSettings: settings.readSettings };
}

async function checkStudioRead({ run, orgId, readers }) {
  const id = "social:studio-read";
  if (!run) return row(id, "skip", "no database in this run — Social Studio reads not run");
  const fix =
    `${RECON} Fix the failing read named above: posts is marketing_content_queue, ` +
    "channels is social_channels, settings is partner_module_settings.";
  const bad = [];
  const steps = [
    ["posts", () => run((tx) => tx.query(STUDIO_POSTS_SQL, [orgId]))],
    ["channels", () => run((tx) => readers.fetchChannelRows(tx, { limit: 1, offset: 0, query: {} }))]
  ];
  for (const [name, go] of steps) {
    try {
      await go();
    } catch (err) {
      bad.push(`${name}: ${clip(err, 100)}`);
    }
  }
  let settingsRan = false;
  try {
    const partner = await one(run, STUDIO_PARTNER_SQL, [orgId]);
    if (partner.id) {
      await run((tx) => readers.readSettings(tx, partner.id, orgId));
      settingsRan = true;
    }
  } catch (err) {
    bad.push(`settings: ${clip(err, 100)}`);
  }
  if (bad.length === 0) {
    return row(
      id,
      "PASS",
      settingsRan
        ? "Social Studio reads ran on the staff scope (posts, channels, settings); none would answer 500"
        : "Social Studio reads ran on the staff scope (posts, channels); none would answer 500. The settings read was not run: no partner is on file."
    );
  }
  return row(id, "FAIL", `Social Studio read would answer 500 — ${bad.join("; ")}`, fix);
}

/**
 * Three read-only checks. ctx: { scope, db, orgId, now, socialReaders }.
 * scope is the staff scope the pulse passes. Each row is
 * { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  let readers = null;
  let readersError = null;
  if (run) {
    try {
      readers = await loadReaders(ctx);
    } catch (err) {
      readersError = err;
    }
  }
  return [
    await checkYoutubeLastError({ run, orgId }),
    await checkVideoStatsStale({ run, orgId, now }),
    readersError
      ? row(
          "social:studio-read",
          "FAIL",
          `Social Studio read code would not load: ${clip(readersError)}`,
          `${RECON} Restore api/social/channels.mjs and api/social/settings.mjs.`
        )
      : await checkStudioRead({ run, orgId, readers })
  ];
}
