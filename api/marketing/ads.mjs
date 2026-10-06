// @ts-check
// GET /api/marketing/ads — the Ads view of the Command Center: one row per ad
// NUMBER, with its spend, its watch numbers, and what its leads did.
//
// Route key "marketing/ads" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §11.2
// (endpoint), §11.1 (what each number means), §11.3 (the Ads view). The answer's
// shape is fixed shape 8 in docs/specs/marketing-machine-api.md §6.7, checked by
// assertMatchesContract("GET marketing/ads", body) in the pg test.
//
//   GET ?from&to&funnel&format&angle
//     → 200 {rows:[{ad_number, title, funnel_key, script_format, angle_key,
//                   spend_cents, impressions, ctr, hook_rate, hold_25,
//                   thruplay_rate, leads, booked, showed, sales, close_rate,
//                   roadmaps, cash_cents, reported_cash_cents, cpl_cents,
//                   cost_per_booked_cents, roas, maturing,
//                   ...the reader's raw counts, see EXTRA_ROW_KEYS}],
//            unmapped:[{campaign_external_id, name, spend_cents, campaign_id}],
//            as_of}
//       400 {error:'invalid', field:'from'|'to', message}
//
// EVERY NUMBER IS U20's. The counts come from readAdNumbers and the ratios from
// ratiosFor (src/marketing/metrics.mjs). Nothing here adds, divides or rounds a
// number of its own, so the Ads view, Today and the funnel view can never
// disagree about what "a lead" or "ROAS" means.
//
// THE WINDOW. from and to are Arizona days (the ad account's own day,
// src/lib/ad-account-day.mjs), both ends included. Left out: the last 30 days
// ending today in Arizona. Only from: from .. today. Only to: the 30 days
// ending on to.
//
// ONE ROW PER AD NUMBER. One number may run on several Meta ads (U14, 416); the
// reader sums their spend and counts each lead once per number. A number shows
// when it has spend or a lead in the window.
//
// THE LABELS (title, funnel_key, script_format, angle_key) come from the script
// that carries the number (ad_scripts.ad_id, U11 columns): the live version if
// there is one, else the newest version. A number with no script reads them
// null. funnel / format / angle filter on those labels, all three together;
// a value nobody uses returns no rows, never an error.
//
// UNMAPPED SPEND is spend from Meta ads that carry no number, one row per
// campaign, in the same window. The label filters do not narrow it: spend with
// no number has no script, so no label can be said to match or not match it.
// campaign_id rides along so the Link button can find the campaign.
//
// ORDER. Most spend first; a row whose spend is unknown goes last; ties by
// number. The screen can re-sort.
//
// as_of IS THE LAST META SYNC: the connection's last_synced_at, else the newest
// saved ad-day — readLastSync from api/marketing/today.mjs, the same rule
// GET marketing/funnels uses. null when Meta never synced.
//
// READ ONLY. Nothing here writes a row, sends a text, or calls Meta or a model.
// ads, campaigns, ad_metrics_daily and ad_scripts FORCE partner row-level
// security, so every query runs in one asStaff() transaction (staffRead).
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12), then a company on the session.
// The company is always the session's, never one from the query string.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendKnownError, hasCompany, InvalidError } from "../../src/marketing/http.mjs";
import { readAdNumbers, ratiosFor } from "../../src/marketing/metrics.mjs";
import { adAccountDay } from "../../src/lib/ad-account-day.mjs";
import { addDays, daysBetween, isIsoDate } from "../../src/metro2/dates.mjs";
import { readLastSync } from "./today.mjs";

export const ROUTE = "marketing/ads";

/** The window when the screen sends none: the last 30 Arizona days, today included. */
export const WINDOW_DAYS = 30;

/** The row keys the contract fixes (fixed shape 8), in its order. */
export const AD_ROW_KEYS = Object.freeze([
  "ad_number", "title", "funnel_key", "script_format", "angle_key",
  "spend_cents", "impressions", "ctr", "hook_rate", "hold_25", "thruplay_rate",
  "leads", "booked", "showed", "sales", "close_rate", "roadmaps",
  "cash_cents", "reported_cash_cents", "cpl_cents", "cost_per_booked_cents", "roas",
  "maturing"
]);

/* Raw counts from the same reader row, sent after the fixed keys (extra keys
   are allowed by the contract). They let the screen say WHY a rate is unknown:
   how many Meta ads carry the number, how many ad-days Meta reported link
   clicks, plays and 2-second plays on, how many leads are still maturing, and
   how many payments reported no amount. Nothing new is counted for them. */
export const EXTRA_ROW_KEYS = Object.freeze([
  "ads", "link_clicks", "plays", "ad_days", "reported_days", "maturing_leads", "cash_unknown"
]);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {unknown} v */
const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

/** @param {any} v @returns {string | null} */
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * One day from the query string, or null when it was left out. Throws the
 * contract's 400 when it is there and not a real YYYY-MM-DD day.
 * @param {unknown} v @param {"from" | "to"} field @returns {string | null}
 */
function dayParam(v, field) {
  if (blank(v)) return null;
  const s = typeof v === "string" ? v.trim() : "";
  if (!DAY_RE.test(s) || !isIsoDate(s)) {
    throw new InvalidError(field, `${field} must be a day written YYYY-MM-DD, like 2026-10-12.`);
  }
  return s;
}

/**
 * parseRange(query, today) → {from, to}, both Arizona days, both included.
 * @param {Record<string, unknown>} query
 * @param {string} today  YYYY-MM-DD, Arizona
 */
export function parseRange(query = {}, today) {
  const from = dayParam(query.from, "from");
  const to = dayParam(query.to, "to") ?? today;
  const start = from ?? addDays(to, -(WINDOW_DAYS - 1));
  if (daysBetween(start, to) < 0) {
    throw new InvalidError("from", `from (${start}) is after to (${to}). Pick a from day on or before the to day.`);
  }
  return { from: start, to };
}

/**
 * A label filter: the trimmed text, or null when it was left out.
 * @param {unknown} v @returns {string | null}
 */
export function filterParam(v) {
  if (blank(v)) return null;
  return String(v).trim();
}

/**
 * readScriptLabels(tx, {orgId, adNumbers?, funnel?, format?, angle?})
 *   → Map(ad_number → {title, funnel_key, script_format, angle_key})
 *
 * One script per number: the live version (archived_at IS NULL) if there is
 * one, else the newest version that carried the number. The filters test that
 * picked script's labels, so an old version's funnel never matches.
 *
 * @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} tx
 * @param {{orgId: string, adNumbers?: string[] | null, funnel?: string | null,
 *          format?: string | null, angle?: string | null}} opts
 */
export async function readScriptLabels(tx, { orgId, adNumbers = null, funnel = null, format = null, angle = null }) {
  const { rows } = await tx.query(
    `SELECT pick.ad_id AS ad_number, pick.title, pick.funnel_key, pick.script_format, pick.angle_key
       FROM (
         SELECT DISTINCT ON (s.ad_id)
                s.ad_id, s.title, s.funnel_key, s.script_format, s.angle_key
           FROM ad_scripts s
          WHERE s.org_id = $1
            AND s.ad_id IS NOT NULL
            AND ($2::text[] IS NULL OR s.ad_id = ANY($2::text[]))
          ORDER BY s.ad_id, (s.archived_at IS NULL) DESC, s.created_at DESC, s.id DESC
       ) pick
      WHERE ($3::text IS NULL OR pick.funnel_key = $3::text)
        AND ($4::text IS NULL OR pick.script_format = $4::text)
        AND ($5::text IS NULL OR pick.angle_key = $5::text)`,
    [orgId, adNumbers, funnel, format, angle]
  );
  return new Map(rows.map((r) => [String(r.ad_number), {
    title: r.title ?? null,
    funnel_key: r.funnel_key ?? null,
    script_format: r.script_format ?? null,
    angle_key: r.angle_key ?? null
  }]));
}

/**
 * readUnmappedSpend(tx, {orgId, from, to})
 *   → [{campaign_external_id, name, spend_cents, campaign_id}]
 *
 * Spend from ads rows with no fundhub_ad_number, per campaign, by spend date
 * (ad_metrics_daily.date, Meta's Arizona day). Most spend first.
 *
 * @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} tx
 * @param {{orgId: string, from: string, to: string}} opts
 */
export async function readUnmappedSpend(tx, { orgId, from, to }) {
  const { rows } = await tx.query(
    `SELECT c.id AS campaign_id, c.external_id, c.name,
            sum(m.spend_cents)::bigint AS spend_cents
       FROM ad_metrics_daily m
       JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
       JOIN campaigns c ON c.id = a.campaign_id AND c.org_id = a.org_id
      WHERE m.org_id = $1
        AND m.date BETWEEN $2::date AND $3::date
        AND a.fundhub_ad_number IS NULL
      GROUP BY c.id, c.external_id, c.name
      ORDER BY sum(m.spend_cents) DESC, c.name, c.id`,
    [orgId, from, to]
  );
  return rows.map((r) => ({
    campaign_external_id: r.external_id ?? null,
    name: r.name,
    // spend_cents is NOT NULL on ad_metrics_daily, so a group always has a sum.
    spend_cents: r.spend_cents == null ? null : Number(r.spend_cents),
    campaign_id: r.campaign_id
  }));
}

/** The labels of a number that has no script: unknown, so null. */
export const NO_LABELS = Object.freeze({ title: null, funnel_key: null, script_format: null, angle_key: null });

/**
 * adRow(readerRow, labels) → one answer row: the contract keys in order, then
 * the raw counts. Every value is the reader's or ratiosFor's, untouched.
 *
 * @param {Record<string, any>} r  one readAdNumbers row
 * @param {{title: string|null, funnel_key: string|null, script_format: string|null, angle_key: string|null}} [labels]
 */
export function adRow(r, labels = NO_LABELS) {
  const q = ratiosFor(r);
  return {
    ad_number: String(r.ad_number),
    title: labels.title,
    funnel_key: labels.funnel_key,
    script_format: labels.script_format,
    angle_key: labels.angle_key,
    spend_cents: r.spend_cents,
    impressions: r.impressions,
    ctr: q.ctr,
    hook_rate: q.hook_rate,
    hold_25: q.hold_25,
    thruplay_rate: q.thruplay_rate,
    leads: r.leads,
    booked: r.booked,
    showed: r.showed,
    sales: r.sales,
    close_rate: q.close_rate,
    roadmaps: r.roadmaps,
    cash_cents: r.cash_cents,
    reported_cash_cents: r.reported_cash_cents,
    cpl_cents: q.cpl_cents,
    cost_per_booked_cents: q.cost_per_booked_cents,
    roas: q.roas,
    maturing: r.maturing,
    ads: r.ads,
    link_clicks: r.link_clicks,
    plays: r.plays,
    ad_days: r.ad_days,
    reported_days: r.reported_days,
    maturing_leads: r.maturing_leads,
    cash_unknown: r.cash_unknown
  };
}

/* Most spend first, unknown spend last, then by number. */
/** @param {{spend_cents: number|null, ad_number: string}} a @param {{spend_cents: number|null, ad_number: string}} b */
function bySpend(a, b) {
  const sa = a.spend_cents;
  const sb = b.spend_cents;
  if (sa == null && sb != null) return 1;
  if (sb == null && sa != null) return -1;
  if (sa != null && sb != null && sa !== sb) return sb - sa;
  return Number(a.ad_number) - Number(b.ad_number);
}

/**
 * readAdsPage(tx, {orgId, from, to, funnel?, format?, angle?, now})
 *   → {rows, unmapped, sync}
 *
 * Everything GET marketing/ads reads, on one transaction from asStaff().
 * Exported so the pg test can run the very same reads under EXPLAIN.
 *
 * @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} tx
 * @param {{orgId: string, from: string, to: string, funnel?: string|null,
 *          format?: string|null, angle?: string|null, now: Date}} opts
 */
export async function readAdsPage(tx, { orgId, from, to, funnel = null, format = null, angle = null, now }) {
  const filtered = funnel !== null || format !== null || angle !== null;

  let rows = [];
  if (filtered) {
    // The numbers whose script carries every asked-for label, then only those.
    const labels = await readScriptLabels(tx, { orgId, funnel, format, angle });
    const numbers = [...labels.keys()];
    if (numbers.length) {
      const read = await readAdNumbers(tx, { orgId, from, to, adNumbers: numbers, now });
      rows = read.map((r) => adRow(r, labels.get(String(r.ad_number)) ?? NO_LABELS));
    }
  } else {
    const read = await readAdNumbers(tx, { orgId, from, to, now });
    const numbers = read.map((r) => String(r.ad_number));
    const labels = numbers.length ? await readScriptLabels(tx, { orgId, adNumbers: numbers }) : new Map();
    rows = read.map((r) => adRow(r, labels.get(String(r.ad_number)) ?? NO_LABELS));
  }
  rows.sort(bySpend);

  const unmapped = await readUnmappedSpend(tx, { orgId, from, to });
  const sync = await readLastSync(tx, { orgId });
  return { rows, unmapped, sync };
}

/**
 * as_of: the last Meta sync, the same rule as GET marketing/funnels.
 * @param {{meta_synced_at?: any, metrics_synced_at?: any} | null | undefined} sync
 */
export function asOf(sync) {
  return iso(sync?.meta_synced_at ?? sync?.metrics_synced_at ?? null);
}

/**
 * @param {any} req
 * @param {any} res
 * @param {{db?: any, requireAuth?: Function, now?: () => Date}} [deps]
 */
export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const now = deps.now ? deps.now() : new Date();

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the ads." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each
  // route's gate from the route's own source (src/marketing/http.mjs
  // gateMarketing does the same three steps).
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const query = req.query || {};
    const { from, to } = parseRange(query, adAccountDay(now));
    const funnel = filterParam(query.funnel);
    const format = filterParam(query.format);
    const angle = filterParam(query.angle);

    const out = await staffRead(database, (tx) =>
      readAdsPage(tx, { orgId, from, to, funnel, format, angle, now }));

    return res.status(200).json({
      rows: out.rows,
      unmapped: out.unmapped,
      as_of: asOf(out.sync)
    });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
