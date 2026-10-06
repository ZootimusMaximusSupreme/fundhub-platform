// Marketing-machine rows for the 7:00 a.m. pulse.
//
// Audit only. SELECT only. Never fixes, never sends, never calls Meta or
// ClickFunnels. Each row watches one job by what that job leaves behind in the
// database — a scheduled run on Netlify leaves nothing else we can read the
// next morning.
//
// Same posture as PULSE_REGISTRY in ./registry.mjs: a list of rows plus one
// runner. A new marketing job gets a row here in the same change
// (.cursor/rules/pulse-registry.mdc). machine.test.mjs fails if a row names a
// file that is gone.
//
// Row security: ads, ad_metrics_daily, ad_platform_connections,
// analytics_connections, funnel_page_stats and ad_watch_curve_alerts are all
// FORCE ROW LEVEL SECURITY. On the plain app connection they read EMPTY, which
// would turn every row here into a false alarm. The live pulse hands in
// asStaff (src/partners/rls.mjs) as `scope`.

import { diesBefore25Percent } from "../ops/watch-curve.mjs";
import { SWEEP_CRON as CF_SWEEP_CRON } from "../workflows/clickfunnels-analytics-sweeper.mjs";

/** A daily job that has not written in this long has missed a day. */
export const FRESH_HOURS = 36;
/** How far back the Meta server-events row looks. */
export const CAPI_WINDOW_HOURS = 24;
/** A write this many minutes after the night job's start is the night job's. */
export const NIGHT_SLOT_MINUTES = 90;

const HOUR_MS = 60 * 60 * 1000;

function row(id, status, detail, suggestedFix = null) {
  return { id, kind: "machine", status, detail, suggestedFix };
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function stamp(d) {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function hoursAgo(d, now) {
  return Math.round(((now.getTime() - d.getTime()) / HOUR_MS) * 10) / 10;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

/** "15 7 * * *" → 435 (minutes after 00:00 UTC). Anything else → null. */
export function dailyCronMinuteUtc(cron) {
  const m = /^\s*(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*\s*$/.exec(String(cron || ""));
  if (!m) return null;
  const minute = Number(m[1]);
  const hour = Number(m[2]);
  if (minute > 59 || hour > 23) return null;
  return hour * 60 + minute;
}

/** True when `d` falls in the [start, start + slot) window of a daily UTC cron. */
export function inNightSlot(d, startMinute, slotMinutes = NIGHT_SLOT_MINUTES) {
  if (!d || startMinute == null) return false;
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  const after = (minuteOfDay - startMinute + 1440) % 1440;
  return after < slotMinutes;
}

// ── (a) Meta daily ad sync ───────────────────────────────────────────────────

export const META_SYNC_SQL = `
  SELECT (SELECT max(synced_at) FROM ad_metrics_daily) AS last_saved,
         (SELECT max(date)::text FROM ad_metrics_daily) AS last_day,
         (SELECT count(*)::int FROM ad_platform_connections WHERE platform = 'meta') AS connections,
         (SELECT string_agg(left(last_error, 160), ' / ')
            FROM ad_platform_connections
           WHERE platform = 'meta' AND last_error IS NOT NULL) AS errors`;

export async function checkMetaSync({ scope, now = new Date() } = {}) {
  const id = "meta-sync";
  const r = await scope((tx) => tx.query(META_SYNC_SQL).then((x) => x.rows[0] || {}));
  const fix =
    "Read ad_platform_connections.last_error and the meta-campaign-sync-sweeper run (07:00 UTC). " +
    "Do not auto-fix from this pulse.";
  if (!Number(r.connections)) {
    return row(id, "FAIL", "no Meta ad account is connected, so the 07:00 UTC sync has nothing to pull", fix);
  }
  const last = toDate(r.last_saved);
  const err = r.errors ? ` Meta connection error: ${clip(r.errors)}.` : "";
  if (!last) {
    return row(id, "FAIL", `the Meta sync has never saved a day of ad numbers.${err}`, fix);
  }
  const age = hoursAgo(last, now);
  if (age > FRESH_HOURS) {
    return row(
      id,
      "FAIL",
      `Meta ad numbers last saved ${stamp(last)} (${age} h ago, limit ${FRESH_HOURS} h); newest day ${r.last_day || "none"}.${err}`,
      fix
    );
  }
  if (r.errors) {
    return row(
      id,
      "FAIL",
      `Meta ad numbers saved ${stamp(last)} (${age} h ago), but the last Meta call failed: ${clip(r.errors)}.`,
      fix
    );
  }
  return row(id, "PASS", `Meta ad numbers saved ${stamp(last)} (${age} h ago); newest day ${r.last_day || "none"}`);
}

// ── (b) ClickFunnels night job ───────────────────────────────────────────────

export const CF_NIGHT_SQL = `
  SELECT (SELECT count(*)::int FROM analytics_connections
           WHERE platform = 'clickfunnels' AND connection_state = 'active') AS active,
         (SELECT string_agg(left(last_error, 160), ' / ') FROM analytics_connections
           WHERE platform = 'clickfunnels' AND last_error IS NOT NULL) AS errors,
         (SELECT max(captured_at) FROM funnel_page_stats) AS last_saved,
         (SELECT max(stat_date)::text FROM funnel_page_stats) AS last_day,
         (SELECT array_agg(DISTINCT date_trunc('minute', captured_at))
            FROM funnel_page_stats WHERE captured_at > $1) AS recent`;

/* "The night job wrote" is judged on WHEN the write landed, not only how fresh
   it is: a sync somebody ran by hand writes the same table. Measured
   2026-10-05: the only two writes ever on file were 2026-09-22 09:20 and
   2026-10-04 22:10 UTC — neither one in the 07:15 slot — so a plain freshness
   check would have said PASS while the night job had not written at all. */
export async function checkClickfunnelsNightJob({ scope, now = new Date(), cron = CF_SWEEP_CRON } = {}) {
  const id = "clickfunnels-night-job";
  const since = new Date(now.getTime() - FRESH_HOURS * HOUR_MS);
  const r = await scope((tx) => tx.query(CF_NIGHT_SQL, [since]).then((x) => x.rows[0] || {}));
  const start = dailyCronMinuteUtc(cron);
  const slot = start == null
    ? "its scheduled time"
    : `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")} UTC`;
  const fix =
    `Fix clickfunnels-analytics-sweeper so its ${slot} pass writes funnel_page_stats ` +
    "(src/workflows/clickfunnels-analytics-sweeper.mjs). Do not auto-fix from this pulse.";
  const err = r.errors ? ` ClickFunnels connection error: ${clip(r.errors)}.` : "";
  if (!Number(r.active)) {
    return row(id, "FAIL", `no active ClickFunnels connection, so the night job has nothing to pull.${err}`, fix);
  }
  const recent = (Array.isArray(r.recent) ? r.recent : []).map(toDate).filter(Boolean).sort((a, b) => b - a);
  const nightly = start == null ? recent : recent.filter((d) => inNightSlot(d, start));
  if (nightly.length) {
    const d = nightly[0];
    return row(
      id,
      "PASS",
      `night job (${slot}) saved ClickFunnels page numbers ${stamp(d)} (${hoursAgo(d, now)} h ago); newest day ${r.last_day || "none"}`
    );
  }
  const last = toDate(r.last_saved);
  const lastWords = last
    ? `Last save on file: ${stamp(last)} (${hoursAgo(last, now)} h ago)` +
      (start != null && !inNightSlot(last, start) ? ", outside the night-job slot, so a hand-run sync" : "")
    : "No save on file at all";
  return row(
    id,
    "FAIL",
    `the night job (${slot}) has not saved ClickFunnels page numbers in ${FRESH_HOURS} h. ${lastWords}.${err}`,
    fix
  );
}

// ── (c) Meta server events (Conversions API) ─────────────────────────────────

const SENT_OK = `CASE WHEN payload->'meta'->>'sent' ~ '^[0-9]+$'
                     THEN (payload->'meta'->>'sent')::int > 0 ELSE false END`;

/* Only rows Meta should get: a real person's funnel event that the browser
   stamped with a Meta event id (src/meta/track-send.mjs). The reply lands on
   the same row as payload.meta = { sent, error?, skipped? }. */
export const CAPI_SQL = `
  SELECT count(*)::int AS eligible,
         count(*) FILTER (WHERE payload ? 'meta')::int AS answered,
         count(*) FILTER (WHERE ${SENT_OK})::int AS sent_ok,
         count(*) FILTER (WHERE payload->'meta' ? 'error')::int AS errors,
         count(*) FILTER (WHERE payload->'meta' ? 'skipped')::int AS skipped,
         max(created_at) FILTER (WHERE ${SENT_OK}) AS last_ok,
         (array_agg(payload->'meta'->>'error' ORDER BY created_at DESC)
            FILTER (WHERE payload->'meta' ? 'error'))[1] AS last_error
    FROM events
   WHERE created_at > $1
     AND name LIKE 'funnel.%'
     AND payload->>'actor' = 'person'
     AND payload ? 'meta_event_id'
     AND coalesce(is_demo, false) = false`;

export async function checkMetaServerEvents({ scope, now = new Date() } = {}) {
  const id = "meta-server-events";
  const since = new Date(now.getTime() - CAPI_WINDOW_HOURS * HOUR_MS);
  const r = await scope((tx) => tx.query(CAPI_SQL, [since]).then((x) => x.rows[0] || {}));
  const eligible = Number(r.eligible) || 0;
  const answered = Number(r.answered) || 0;
  const ok = Number(r.sent_ok) || 0;
  const errors = Number(r.errors) || 0;
  const skipped = Number(r.skipped) || 0;
  const unanswered = Math.max(0, eligible - answered);
  const fix =
    "Read payload.meta on the funnel events (src/meta/track-send.mjs) and META_CAPI_ENABLED. " +
    "Do not auto-fix from this pulse.";
  if (!eligible) {
    return row(
      id,
      "skip",
      `no real visitor event with a Meta id in the last ${CAPI_WINDOW_HOURS} h, so there was nothing to send`
    );
  }
  if (!ok && skipped === eligible) {
    return row(id, "skip", `all ${eligible} events in ${CAPI_WINDOW_HOURS} h were test or company sessions, which Meta never gets`);
  }
  const tail =
    (errors ? ` ${errors} came back as errors (last: ${clip(r.last_error, 120)}).` : "") +
    (unanswered ? ` ${unanswered} never got a reply saved.` : "");
  if (!ok || errors > ok) {
    return row(
      id,
      "FAIL",
      `Meta accepted ${ok} of ${eligible} server events from real visitors in ${CAPI_WINDOW_HOURS} h.${tail}`,
      fix
    );
  }
  const last = toDate(r.last_ok);
  return row(
    id,
    "PASS",
    `Meta accepted ${ok} of ${eligible} server events in ${CAPI_WINDOW_HOURS} h` +
      (last ? `, last ${stamp(last)}` : "") +
      (skipped ? `; ${skipped} test sessions skipped` : "") +
      `.${tail}`
  );
}

// ── (d) Dying-ad buzz (runs at the end of every Meta sync) ───────────────────

export const DYING_SCAN_SQL = `
  SELECT (SELECT max(synced_at) FROM ad_metrics_daily) AS last_sync,
         (SELECT count(*)::int FROM ad_watch_curve_alerts) AS buzzes_ever`;

export const RUNNING_ADS_SQL = `
  SELECT a.id, a.name, m.date::text AS metric_day,
         m.video_plays, m.video_p25_watched, m.clicks,
         al.dies_before_25_alerted_on::text AS alerted_on
    FROM ads a
    JOIN LATERAL (
      SELECT date, video_plays, video_p25_watched, clicks
        FROM ad_metrics_daily
       WHERE ad_id = a.id
         AND video_plays IS NOT NULL
         AND video_p25_watched IS NOT NULL
       ORDER BY date DESC
       LIMIT 1
    ) m ON true
    LEFT JOIN ad_watch_curve_alerts al ON al.ad_id = a.id
   WHERE upper(coalesce(a.status, '')) = 'ACTIVE'`;

/* The scan (src/ops/watch-curve.mjs notifyDyingBefore25) keeps no run log of
   its own: it is called at the end of api/campaigns/sync.mjs and leaves a row
   in ad_watch_curve_alerts only when a buzz went out. So "did it run" is read
   off the sync's last write, and "did it do its job" is read off the result:
   a running ad that dies before 25% and has no buzz dated on or after that
   sync was missed. */
export async function checkDyingAdScan({ scope, now = new Date() } = {}) {
  const id = "dying-ad-scan";
  const { head, ads } = await scope(async (tx) => ({
    head: (await tx.query(DYING_SCAN_SQL)).rows[0] || {},
    ads: (await tx.query(RUNNING_ADS_SQL)).rows
  }));
  const fixScan = "The scan runs at the end of each Meta sync — fix the meta-sync row first. Do not auto-fix from this pulse.";
  const last = toDate(head.last_sync);
  if (!last) {
    return row(id, "FAIL", "the Meta sync has never saved ad numbers, so the dying-ad scan has never had anything to read", fixScan);
  }
  const age = hoursAgo(last, now);
  if (age > FRESH_HOURS) {
    return row(
      id,
      "FAIL",
      `the dying-ad scan has not run since the Meta sync of ${stamp(last)} (${age} h ago, limit ${FRESH_HOURS} h)`,
      fixScan
    );
  }
  const syncDay = last.toISOString().slice(0, 10);
  const dying = ads.filter((a) => diesBefore25Percent({
    plays: a.video_plays,
    p25: a.video_p25_watched,
    clicks: a.clicks
  }).dying);
  const missed = dying.filter((a) => !a.alerted_on || String(a.alerted_on).slice(0, 10) < syncDay);
  const ever = Number(head.buzzes_ever) || 0;
  if (missed.length) {
    const names = missed.slice(0, 2).map((a) => clip(a.name, 60) || a.id).join(", ");
    return row(
      id,
      "FAIL",
      `${missed.length} running ad${missed.length === 1 ? "" : "s"} die before 25% with no buzz after the ${stamp(last)} sync: ${names}${missed.length > 2 ? ", …" : ""}. Buzzes ever recorded: ${ever}.`,
      "The dying-ad buzz is not reaching Chris's phone. Check notifyDyingBefore25's send path " +
        "(src/ops/watch-curve.mjs → src/ad-videos/notify-fanout.mjs). Do not auto-fix from this pulse."
    );
  }
  const scanned = ads.length
    ? `${ads.length} running ad${ads.length === 1 ? "" : "s"} with video numbers, ${dying.length} dying, none missed`
    : "no running ad with video numbers, so nothing to buzz";
  return row(id, "PASS", `scan ran with the Meta sync of ${stamp(last)} (${age} h ago): ${scanned}. Buzzes ever recorded: ${ever}.`);
}

// ── The registry and its runner ──────────────────────────────────────────────

export const MACHINE_CHECKS = [
  {
    id: "meta-sync",
    watches: "Meta ad numbers pull, daily 07:00 UTC",
    file: "src/workflows/meta-campaign-sync-sweeper.mjs",
    run: checkMetaSync
  },
  {
    id: "clickfunnels-night-job",
    watches: "ClickFunnels page numbers pull, nightly",
    file: "src/workflows/clickfunnels-analytics-sweeper.mjs",
    run: checkClickfunnelsNightJob
  },
  {
    id: "meta-server-events",
    watches: "Meta Conversions API sends from funnel pages",
    file: "src/meta/track-send.mjs",
    run: checkMetaServerEvents
  },
  {
    id: "dying-ad-scan",
    watches: "dying-before-25% buzz, end of each Meta sync",
    file: "src/ops/watch-curve.mjs",
    run: checkDyingAdScan
  }
];

/**
 * Run every machine row. `scope(fn)` runs fn(tx) with staff visibility; with
 * only `db`, rows run on it directly (a fake in tests, or an owner connection).
 * One broken row never takes the pulse down: its error becomes its FAIL.
 */
export async function checkMachine({ db = null, scope = null, now = new Date(), checks = MACHINE_CHECKS } = {}) {
  const run = scope || (db && typeof db.query === "function" ? (fn) => fn(db) : null);
  if (!run) {
    return checks.map((c) => row(c.id, "skip", "no database in this run — job not read"));
  }
  const out = [];
  for (const c of checks) {
    try {
      out.push(await c.run({ scope: run, now }));
    } catch (err) {
      out.push(row(
        c.id,
        "FAIL",
        `could not read the ${c.watches} record: ${clip((err && err.message) || err)}`,
        "Fix the pulse query, not the job. Do not auto-fix from this pulse."
      ));
    }
  }
  return out;
}
