// Ad data gaps for the morning pulse. Report only. Never auto-fix.
//
// Four breaks the existing rows do not already decide:
//   ads-meta-sync-stale      hourly Meta pull is late (red after 3 h).
//                            machine.mjs meta-sync still owns the 36 h nightly save.
//   ads-spend-day-missing    a closed Arizona day in the hourly window has no
//                            spend row, an older spend row says that day was
//                            already in the pull, an ad is running, and ads spent
//                            money on a day before AND a day after the gap. With
//                            every ad paused Meta sends no row, so an empty day
//                            is normal and is a skip, not a FAIL. Ads switched
//                            back on this morning have no spend after the gap
//                            yet, so that is a skip too.
//   ads-number-unmapped      an ad that spent in the last 28 days has no
//                            fundhub_ad_number. Old paused test ads are not
//                            looked at, so they cannot keep the pulse red.
//   ads-running-no-metrics   a running ad (ad, ad set and campaign all ACTIVE)
//                            old enough to have synced has no ad_metrics_daily
//                            row. The dying-ad scan joins metrics, so it cannot
//                            see this ad.
//
// Reads go through ctx.scope (staff). ads, ad_sets, campaigns, ad_metrics_daily
// and ad_platform_connections are row-security tables: the plain app role reads
// them as empty.
//
// Not here: marketing clock (slice 03), dying-ad buzz, ClickFunnels, server
// events, Meet (machine.mjs). No budget change, no pause, no video upload.
// One tripwire: Recon (AG-07). No second watchdog. SELECT only.
//
// Nothing to judge (owner law 2026-10-09: a live thing is never "not checked").
// When the lane's own read says no ad is running, ads-spend-day-missing and
// ads-running-no-metrics return status "na" with na: { code: "no-running-ad", args }.
// `naVerify` re-reads with the same SQL, so the audit can prove the claim again.
// Every other quiet reason (sync never ran, sync late, no spend either side of a
// gap) stays "skip": "we cannot see it" is never a nothing-to-judge condition.

import { FRESH_HOURS } from "../machine.mjs";
import { AD_ACCOUNT_TZ, adAccountDay } from "../../lib/ad-account-day.mjs";

/** Same window as api/campaigns/sync.mjs HOURLY_WINDOW_DAYS. Today is still open. */
export const HOURLY_WINDOW_DAYS = 3;

/** 3x the hourly cron (30 * * * *). A run older than this is red. */
export const HOURLY_RED_HOURS = 3;

/** Same window as the nightly pass (INSIGHT_WINDOW_DAYS). Older spend is history. */
export const SPEND_WINDOW_DAYS = 28;

/** Meta can hold a new ad in review for a day. No delivery then is not a sync break. */
export const NEW_AD_GRACE_HOURS = 24;

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

/** "Nothing to judge today": status na plus the code the audit re-checks. */
function naRow(id, code, args, detail) {
  return { id, status: "na", detail, suggestedFix: null, na: { code, args } };
}

/** A count the read really sent: a finite number, or null. A missing answer is not zero. */
function count(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

/** `spent_days` is a comma list from the query. A real array is taken as is. */
function spentDaysOf(v) {
  const list = Array.isArray(v) ? v : String(v == null ? "" : v).split(",");
  return new Set(list.map((d) => String(d).trim().slice(0, 10)).filter(Boolean));
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

// An ad is running only when the ad, its ad set and its campaign are all ACTIVE.
// Pausing a campaign leaves its ads ACTIVE on the ad itself, and Meta sends no row.
const RUNNING_WHERE = `
         upper(coalesce(a.status, '')) = 'ACTIVE'
     AND upper(coalesce(s.status, '')) = 'ACTIVE'
     AND upper(coalesce(c.status, '')) = 'ACTIVE'`;

// $1 is the older closed day, $2 is yesterday, both Arizona dates. `running` counts
// ads that were already here when the older closed day began. `spent_days` lists the
// days from the day before $1 to the day after $2 (today) on which any ad spent money.
// ads.updated_at cannot tell when an ad was switched on: every sync stamps it.
export const SPEND_DAYS_SQL = `
  SELECT (SELECT max(synced_at) FROM ad_metrics_daily) AS last_saved,
         (SELECT min(date)::text FROM ad_metrics_daily) AS first_day,
         (SELECT count(*)::int FROM ad_metrics_daily WHERE date = $1::date) AS rows_0,
         (SELECT count(*)::int FROM ad_metrics_daily WHERE date = $2::date) AS rows_1,
         (SELECT string_agg(x.d, ',' ORDER BY x.d)
            FROM (
              SELECT date::text AS d
                FROM ad_metrics_daily
               WHERE date BETWEEN ($1::date - 1) AND ($2::date + 1)
               GROUP BY date
              HAVING sum(spend_cents) > 0
            ) x) AS spent_days,
         (SELECT count(*)::int
            FROM ads a
            JOIN ad_sets s ON s.id = a.ad_set_id
            JOIN campaigns c ON c.id = a.campaign_id
           WHERE ${RUNNING_WHERE}
             AND a.created_at < ($1::date)::timestamp AT TIME ZONE '${AD_ACCOUNT_TZ}') AS running`;

// $1 is the first Arizona day of the 28-day window. Only an ad that spent money in
// it counts. A zero-spend row, or an ad that stopped spending long ago, does not.
const SPENT_FROM = `
            FROM ads a
            JOIN ad_metrics_daily m ON m.ad_id = a.id
           WHERE m.spend_cents > 0
             AND m.date >= $1::date`;
const UNNUMBERED = `(a.fundhub_ad_number IS NULL OR btrim(a.fundhub_ad_number) = '')`;

export const UNMAPPED_SQL = `
  SELECT (SELECT count(DISTINCT a.id)::int ${SPENT_FROM}) AS with_spend,
         (SELECT count(DISTINCT a.id)::int ${SPENT_FROM}
             AND ${UNNUMBERED}) AS unmapped,
         (SELECT string_agg(n, ', ' ORDER BY n)
            FROM (
              SELECT DISTINCT left(a.name, 60) AS n ${SPENT_FROM}
                 AND ${UNNUMBERED}
               ORDER BY n
               LIMIT 3
            ) s) AS names`;

// $1 is the cutoff. Ads newer than that have not had time to deliver yet.
const RUNNING_FROM = `
            FROM ads a
            JOIN ad_sets s ON s.id = a.ad_set_id
            JOIN campaigns c ON c.id = a.campaign_id
           WHERE ${RUNNING_WHERE}
             AND a.created_at <= $1`;
const NO_METRICS = `AND NOT EXISTS (SELECT 1 FROM ad_metrics_daily m WHERE m.ad_id = a.id)`;

export const RUNNING_BARE_SQL = `
  SELECT (SELECT max(last_synced_at)
            FROM ad_platform_connections
           WHERE platform = 'meta'
             AND connection_state IN ('active', 'pending')
             AND encrypted_access_token IS NOT NULL
             AND external_ad_account_id IS NOT NULL
             AND external_ad_account_id NOT ILIKE 'pending:%') AS last_synced_at,
         (SELECT count(*)::int ${RUNNING_FROM}) AS running,
         (SELECT count(*)::int ${RUNNING_FROM}
             ${NO_METRICS}) AS bare,
         (SELECT string_agg(n, ', ' ORDER BY n)
            FROM (
              SELECT DISTINCT left(a.name, 60) AS n ${RUNNING_FROM}
                 ${NO_METRICS}
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
  "The ad, its ad set and its campaign are all ACTIVE, and Meta has sent no row for it. " +
  "Read ads.status, ad_sets.status and ad_metrics_daily, and the ad's delivery in Meta."
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
  const running = num(r.running);
  if (missing.length && !running) {
    // Meta sends a row only for an ad that delivered. With every ad paused an empty
    // day is the normal answer, not a sync that skipped it.
    const why = `No spend row for ${missing.join(" and ")}, and no ad is running, so Meta had nothing to send.`;
    // Only a count the read really sent is proof. A missing count stays a skip.
    if (count(r.running) === 0) {
      return naRow(id, "no-running-ad", { check: id, running: 0 }, `${why} Judged the day an ad runs.`);
    }
    return row(id, "skip", why);
  }
  if (missing.length) {
    // An ad that is ACTIVE now may have been paused through the empty day and switched
    // back on this morning. Only call it a sync gap when ads were spending on both
    // sides of it: the day before, and the day after (or today).
    const spent = spentDaysOf(r.spent_days);
    const span = [shiftDay(days[0], -1), ...days, shiftDay(days[days.length - 1], 1)];
    const at = missing.map((d) => span.indexOf(d));
    const before = span.slice(0, Math.min(...at)).some((d) => spent.has(d));
    const after = span.slice(Math.max(...at) + 1).some((d) => spent.has(d));
    if (!before || !after) {
      const gap = missing.join(" and ");
      const side = !before && !after ? "before or after it" : !before ? "before it" : "after it";
      return row(
        id,
        "skip",
        `No spend row for ${gap}. No ad spent money ${side}. That looks like ads switched off or on, not a missed sync.`
      );
    }
    const list = missing.join(" and ");
    const word = missing.length === 1 ? "That day should" : "Those days should";
    const ads = running === 1 ? "1 ad is running" : `${running} ads are running`;
    return row(
      id,
      "FAIL",
      `Spend rows are missing for ${list}. ${ads}, so ${word.toLowerCase()} have synced. Older spend starts ${first}.`,
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

export async function checkAdNumberUnmapped({ run, now }) {
  const id = "ads-number-unmapped";
  const since = shiftDay(adAccountDay(now), -SPEND_WINDOW_DAYS);
  const r = await one(run, UNMAPPED_SQL, [since]);
  const withSpend = num(r.with_spend);
  const unmapped = num(r.unmapped);
  if (!withSpend) {
    return row(id, "skip", `No ad spent money in the last ${SPEND_WINDOW_DAYS} days, so there is no number to map.`);
  }
  if (!unmapped) {
    const noun = withSpend === 1 ? "ad" : "ads";
    return row(
      id,
      "PASS",
      `Every ad that spent in the last ${SPEND_WINDOW_DAYS} days has a Fundhub ad number (${withSpend} ${noun}).`
    );
  }
  const names = nameList(r.names, unmapped > 3);
  const noun = unmapped === 1 ? "ad has" : "ads have";
  return row(
    id,
    "FAIL",
    `${unmapped} ${noun} spend in the last ${SPEND_WINDOW_DAYS} days and no Fundhub ad number${names ? `: ${names}` : ""}.`,
    NUMBER_FIX
  );
}

export async function checkRunningNoMetrics({ run, now }) {
  const id = "ads-running-no-metrics";
  const cutoff = new Date(now.getTime() - NEW_AD_GRACE_HOURS * HOUR_MS);
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
    const why = `No running ad is older than ${NEW_AD_GRACE_HOURS} h, so none needs a metrics row yet.`;
    if (count(r.running) === 0) {
      return naRow(id, "no-running-ad", { check: id, running: 0 }, `${why} Judged the day one is.`);
    }
    return row(id, "skip", why);
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

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the
 * same SQL the lane used (SPEND_DAYS_SQL, RUNNING_BARE_SQL) and answers true only
 * when the read really says zero ads are running. No read, no row, or a count that
 * is not a number is false. A read that throws is left to throw: the audit counts
 * a throw as false.
 * @param {{ check?: string }} args
 * @param {{ db?: any, scope?: Function, now?: Date|string|number }} ctx
 */
export const naVerify = Object.freeze({
  "no-running-ad": async (args, ctx = {}) => {
    const run = bind(ctx);
    if (!run) return false;
    const now = nowOf(ctx);
    const check = args && args.check;
    if (check === "ads-spend-day-missing") {
      const r = await one(run, SPEND_DAYS_SQL, closedDays(now));
      return count(r.running) === 0;
    }
    if (check === "ads-running-no-metrics") {
      const cutoff = new Date(now.getTime() - NEW_AD_GRACE_HOURS * HOUR_MS);
      const r = await one(run, RUNNING_BARE_SQL, [cutoff]);
      return count(r.running) === 0;
    }
    return false;
  }
});

const RUNNERS = [
  ["ads-meta-sync-stale", checkMetaSyncStale],
  ["ads-spend-day-missing", checkSpendDayMissing],
  ["ads-number-unmapped", checkAdNumberUnmapped],
  ["ads-running-no-metrics", checkRunningNoMetrics]
];

/**
 * @param {{ db?: { query: Function }, scope?: (fn: (tx: any) => Promise<any>) => Promise<any>, now?: Date|string|number }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip"|"na", detail: string, suggestedFix: string|null, na?: { code: string, args: object } }>>}
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
