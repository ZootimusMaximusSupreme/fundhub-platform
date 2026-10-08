// Ad data gaps for the morning pulse. Report only. Never auto-fix.
//
// Four breaks the existing rows do not already decide:
//   ads-meta-sync-stale      hourly Meta pull is late (red after 3 h).
//                            machine.mjs meta-sync still owns the 36 h nightly save.
//   ads-spend-day-missing    a closed Arizona day in the hourly window has no
//                            spend row, and an older spend row says that day
//                            was already in the pull.
//   ads-number-unmapped      an ad that has a spend row has no fundhub_ad_number.
//   ads-running-no-metrics   a running ad old enough to have synced has no
//                            ad_metrics_daily row. The dying-ad scan joins
//                            metrics, so it cannot see this ad.
//
// Not here: marketing clock (slice 03), dying-ad buzz, ClickFunnels, server
// events, Meet (machine.mjs). No budget change, no pause, no video upload.
// One tripwire: Recon (AG-07). No second watchdog. SELECT only.

import { FRESH_HOURS } from "../machine.mjs";
import { adAccountDay } from "../../lib/ad-account-day.mjs";

/** Same window as api/campaigns/sync.mjs HOURLY_WINDOW_DAYS. Today is still open. */
export const HOURLY_WINDOW_DAYS = 3;

/** 3x the hourly cron (30 * * * *). A run older than this is red. */
export const HOURLY_RED_HOURS = 3;

const HOUR_MS = 60 * 60 * 1000;

const BANS =
  "Recon (AG-07) already reports this on the morning pulse. Do not invent a second watchdog. " +
  "Do not change budgets. Do not pause campaigns. Do not upload video. Do not auto-fix from this pulse.";

function fix(lead) {
  return `${lead} ${BANS}`;
}

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
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

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** ISO day shifted by whole UTC days. `iso` is YYYY-MM-DD. */
export function shiftDay(iso, delta) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Hourly window in the ad account's zone, oldest first, including today. */
export function hourlyDays(now) {
  const today = adAccountDay(now);
  const days = [];
  for (let i = HOURLY_WINDOW_DAYS - 1; i >= 0; i -= 1) days.push(shiftDay(today, -i));
  return days;
}

/** Closed days in that window. Today can still be empty. */
export function closedDays(now) {
  return hourlyDays(now).slice(0, -1);
}

function nowOf(ctx) {
  const n = ctx && ctx.now != null ? new Date(ctx.now) : new Date();
  return Number.isFinite(n.getTime()) ? n : new Date();
}

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

async function one(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows && out.rows[0]) || {};
}

function nameList(names, more) {
  const list = Array.isArray(names)
    ? names.filter(Boolean).join(", ")
    : String(names || "").trim();
  if (!list) return "";
  return more ? `${list}, …` : list;
}

// Due Meta accounts: same filter as DUE_PARTNERS_SQL in
// src/workflows/meta-campaign-sync-sweeper.mjs. The token column is not selected.
export const SYNC_DUE_SQL = `
  SELECT max(last_synced_at) AS last_synced_at,
         count(*)::int AS due
    FROM ad_platform_connections
   WHERE platform = 'meta'
     AND connection_state IN ('active', 'pending')
     AND encrypted_access_token IS NOT NULL
     AND external_ad_account_id IS NOT NULL
     AND external_ad_account_id NOT ILIKE 'pending:%'`;

// $1 is the older closed day, $2 is yesterday, both Arizona dates.
export const SPEND_DAYS_SQL = `
  SELECT (SELECT max(synced_at) FROM ad_metrics_daily) AS last_saved,
         (SELECT min(date)::text FROM ad_metrics_daily) AS first_day,
         (SELECT count(*)::int FROM ad_metrics_daily WHERE date = $1::date) AS rows_0,
         (SELECT count(*)::int FROM ad_metrics_daily WHERE date = $2::date) AS rows_1`;

export const UNMAPPED_SQL = `
  SELECT (SELECT count(DISTINCT a.id)::int
            FROM ads a
            JOIN ad_metrics_daily m ON m.ad_id = a.id
           WHERE a.fundhub_ad_number IS NULL) AS unmapped,
         (SELECT count(DISTINCT a.id)::int
            FROM ads a
            JOIN ad_metrics_daily m ON m.ad_id = a.id) AS with_metrics,
         (SELECT string_agg(n, ', ' ORDER BY n)
            FROM (
              SELECT DISTINCT left(a.name, 60) AS n
                FROM ads a
                JOIN ad_metrics_daily m ON m.ad_id = a.id
               WHERE a.fundhub_ad_number IS NULL
               ORDER BY n
               LIMIT 3
            ) s) AS names`;

// $1 is the cutoff. Ads newer than that have not had an hourly pass yet.
export const RUNNING_BARE_SQL = `
  SELECT (SELECT max(last_synced_at)
            FROM ad_platform_connections
           WHERE platform = 'meta'
             AND connection_state IN ('active', 'pending')
             AND encrypted_access_token IS NOT NULL
             AND external_ad_account_id IS NOT NULL
             AND external_ad_account_id NOT ILIKE 'pending:%') AS last_synced_at,
         (SELECT count(*)::int
            FROM ads a
           WHERE upper(coalesce(a.status, '')) = 'ACTIVE'
             AND a.created_at <= $1) AS running,
         (SELECT count(*)::int
            FROM ads a
           WHERE upper(coalesce(a.status, '')) = 'ACTIVE'
             AND a.created_at <= $1
             AND NOT EXISTS (
               SELECT 1 FROM ad_metrics_daily m WHERE m.ad_id = a.id
             )) AS bare,
         (SELECT string_agg(n, ', ' ORDER BY n)
            FROM (
              SELECT DISTINCT left(a.name, 60) AS n
                FROM ads a
               WHERE upper(coalesce(a.status, '')) = 'ACTIVE'
                 AND a.created_at <= $1
                 AND NOT EXISTS (
                   SELECT 1 FROM ad_metrics_daily m WHERE m.ad_id = a.id
                 )
               ORDER BY n
               LIMIT 3
            ) s) AS names`;

const SYNC_FIX = fix(
  "Read ad_platform_connections.last_synced_at and meta-campaign-sync-hourly (minute 30). " +
  "The 36 h nightly check stays on the machine meta-sync row."
);

const SPEND_FIX = fix(
  "Read ad_metrics_daily for the missing Arizona day. The hourly pass covers 3 days and the nightly pass covers 28."
);

const NUMBER_FIX = fix(
  "Set fundhub_ad_number on that ad. Spend with no number cannot be tied to a lead."
);

const RUNNING_FIX = fix(
  "The Meta sync saved other rows and skipped this running ad. Read ads.status and ad_metrics_daily."
);

export async function checkMetaSyncStale({ run, now }) {
  const id = "ads-meta-sync-stale";
  const r = await one(run, SYNC_DUE_SQL);
  if (!num(r.due)) {
    return row(id, "skip", "No Meta account is due for a pull. The machine meta-sync row owns a missing connection.");
  }
  const last = toDate(r.last_synced_at);
  if (!last) {
    return row(id, "FAIL", "A Meta account is due, and the hourly sync has never stamped last_synced_at.", SYNC_FIX);
  }
  const age = hoursAgo(last, now);
  if (age > HOURLY_RED_HOURS) {
    return row(
      id,
      "FAIL",
      `Hourly Meta sync last ran ${stamp(last)} (${age} h ago). Red after ${HOURLY_RED_HOURS} h.`,
      SYNC_FIX
    );
  }
  return row(id, "PASS", `Hourly Meta sync last ran ${stamp(last)} (${age} h ago).`);
}

export async function checkSpendDayMissing({ run, now }) {
  const id = "ads-spend-day-missing";
  const days = closedDays(now);
  const r = await one(run, SPEND_DAYS_SQL, days);
  const last = toDate(r.last_saved);
  if (!last) {
    return row(id, "skip", "The Meta sync has never saved a spend row. The machine meta-sync row owns that.");
  }
  const age = hoursAgo(last, now);
  if (age > FRESH_HOURS) {
    return row(
      id,
      "skip",
      `Meta numbers last saved ${stamp(last)} (${age} h ago), past ${FRESH_HOURS} h. The machine meta-sync row owns that.`
    );
  }
  const first = r.first_day ? String(r.first_day).slice(0, 10) : null;
  if (!first) {
    return row(id, "skip", "The Meta sync has never saved a spend row. The machine meta-sync row owns that.");
  }
  const counts = [num(r.rows_0), num(r.rows_1)];
  const missing = [];
  for (let i = 0; i < days.length; i += 1) {
    if (counts[i] > 0) continue;
    if (first < days[i]) missing.push(days[i]);
  }
  if (missing.length) {
    const list = missing.join(" and ");
    const word = missing.length === 1 ? "That day should" : "Those days should";
    return row(
      id,
      "FAIL",
      `Spend rows are missing for ${list}. ${word} have synced. Older spend starts ${first}.`,
      SPEND_FIX
    );
  }
  const notDue = days.filter((d, i) => counts[i] === 0);
  if (notDue.length) {
    return row(
      id,
      "PASS",
      `No closed day is missing. Spend on file starts ${first}, so ${notDue.join(" and ")} were not due yet.`
    );
  }
  return row(id, "PASS", `Spend rows are on file for ${days.join(" and ")}.`);
}

export async function checkAdNumberUnmapped({ run }) {
  const id = "ads-number-unmapped";
  const r = await one(run, UNMAPPED_SQL);
  const withMetrics = num(r.with_metrics);
  const unmapped = num(r.unmapped);
  if (!withMetrics) {
    return row(id, "skip", "No ad has a spend row yet, so there is no number to map.");
  }
  if (!unmapped) {
    const noun = withMetrics === 1 ? "ad" : "ads";
    return row(id, "PASS", `Every ad with a spend row has a Fundhub ad number (${withMetrics} ${noun}).`);
  }
  const names = nameList(r.names, unmapped > 3);
  const noun = unmapped === 1 ? "ad has" : "ads have";
  return row(
    id,
    "FAIL",
    `${unmapped} ${noun} spend and no Fundhub ad number${names ? `: ${names}` : ""}.`,
    NUMBER_FIX
  );
}

export async function checkRunningNoMetrics({ run, now }) {
  const id = "ads-running-no-metrics";
  const cutoff = new Date(now.getTime() - HOURLY_RED_HOURS * HOUR_MS);
  const r = await one(run, RUNNING_BARE_SQL, [cutoff]);
  const last = toDate(r.last_synced_at);
  if (!last) {
    return row(id, "skip", "The hourly sync has never stamped last_synced_at. ads-meta-sync-stale owns that.");
  }
  const age = hoursAgo(last, now);
  if (age > FRESH_HOURS) {
    return row(
      id,
      "skip",
      `Meta last synced ${stamp(last)} (${age} h ago), past ${FRESH_HOURS} h. ads-meta-sync-stale owns that.`
    );
  }
  const running = num(r.running);
  const bare = num(r.bare);
  if (!running) {
    return row(id, "skip", "No running ad is old enough to need a metrics row.");
  }
  if (!bare) {
    const noun = running === 1 ? "ad has" : "ads have";
    return row(id, "PASS", `${running} running ${noun} a metrics row.`);
  }
  const names = nameList(r.names, bare > 3);
  const noun = bare === 1 ? "ad has" : "ads have";
  return row(
    id,
    "FAIL",
    `${bare} running ${noun} no metrics row${names ? `: ${names}` : ""}.`,
    RUNNING_FIX
  );
}

const RUNNERS = [
  ["ads-meta-sync-stale", checkMetaSyncStale],
  ["ads-spend-day-missing", checkSpendDayMissing],
  ["ads-number-unmapped", checkAdNumberUnmapped],
  ["ads-running-no-metrics", checkRunningNoMetrics]
];

/**
 * @param {{ db?: { query: Function }, scope?: (fn: (tx: any) => Promise<any>) => Promise<any>, now?: Date|string|number }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  const now = nowOf(ctx);
  if (!run) {
    return RUNNERS.map(([id]) => row(id, "skip", "no database in this run — ad rows not read"));
  }
  const out = [];
  for (const [id, fn] of RUNNERS) {
    try {
      out.push(await fn({ run, now }));
    } catch (err) {
      out.push(row(
        id,
        "FAIL",
        `could not read ad data: ${clip(err && err.message)}`,
        fix("Fix the pulse query.")
      ));
    }
  }
  return out;
}
