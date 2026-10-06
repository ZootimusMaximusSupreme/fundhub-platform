// @ts-check
// GET /api/marketing/ad?n=91 — one ad number, for the Ads view's drawer.
//
// Route key "marketing/ad" (netlify/functions/api.mjs ROUTES; the key is this
// file's path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §11.2
// (endpoint), §11.3 (the drawer with its watch curve). The answer's shape is
// fixed shape 8 in docs/specs/marketing-machine-api.md §6.7, checked by
// assertMatchesContract("GET marketing/ad", body) in the pg test.
//
//   GET ?n=<ad number>
//     → 200 {ad:{...the same row GET marketing/ads gives for this number over
//                the last 30 Arizona days,
//                meta_ads:[{id, external_id, name, status, ad_set_external_id}],
//                curve:[{date, video_play_curve, ad_id}],
//                watch:{alerts:[{ad_id, dies_before_25_alerted_on, updated_at}],
//                       diagnoses:[{date, diagnosis, fix_type, film_note,
//                                   next_take_improved, id, ad_id, created_at}]}},
//            as_of}
//       400 {error:'invalid', field:'n', message}   n missing or not 1-9 digits
//       404 {error:'not_found', message}            the company has never seen
//                                                   this number
//
// WHEN A NUMBER EXISTS. The company has a Meta ad carrying it (ads), a script
// carrying it (ad_scripts, any version), or a lead tagged with it
// (client_ad_attribution). Anything GET marketing/ads can list passes, so a
// row on the Ads view never opens a 404. A number with nothing in the last 30
// days still answers 200: spend unknown (null), counts 0 — the same values
// readAdNumbers gives a number with no ad-days and no leads.
//
// THE PARTS.
//   meta_ads   every ads row with this number (one number can run on several
//              Meta ads, U14/416), oldest first. Not limited to the 30 days.
//   curve      one entry per Meta ad per day in the 30 days that has a saved
//              ad-day: Meta's video_play_curve exactly as stored (394, a list of
//              percents 0-100 per second bucket — not a 0..1 rate), or null when
//              Meta sent no curve that day. ad_id says which Meta ad, because two
//              ads with one number each have their own curve; they are never
//              averaged into one. Oldest day first.
//   watch      ad_watch_curve_alerts (394: the day the "dies before 25%" buzz
//              last went out, per Meta ad) and ad_watch_curve_diagnoses (395:
//              opening / middle / ask, fix type, film note, whether the next
//              take improved — null until scored), newest day first, at most
//              DIAGNOSES_LIMIT. Not limited to the 30 days: an older diagnosis
//              is still the last word on what to film.
//
// READ ONLY. Nothing here writes a row, sends a text, or calls Meta or a model.
// ads, ad_sets, ad_metrics_daily, ad_scripts and the two watch tables FORCE
// partner row-level security, so every query runs in one asStaff() transaction.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING)
// (requireAuth ignores roles, CLAUDE.md §12), then a company on the session.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import {
  staffRead, sendKnownError, hasCompany, InvalidError, NotFoundError
} from "../../src/marketing/http.mjs";
import { readAdNumbers } from "../../src/marketing/metrics.mjs";
import { adAccountDay } from "../../src/lib/ad-account-day.mjs";
import { readLastSync } from "./today.mjs";
import { adRow, asOf, parseRange, readScriptLabels, NO_LABELS } from "./ads.mjs";

export const ROUTE = "marketing/ad";

/** The most diagnoses one answer carries, newest day first. */
export const DIAGNOSES_LIMIT = 100;

/* The same shape as ads.fundhub_ad_number and client_ad_attribution.ad_id
   checks (1-9 digits), and what readAdNumbers accepts. */
const AD_NUMBER_RE = /^[0-9]{1,9}$/;

/** @typedef {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} Tx */

/** @param {any} v @returns {string | null} */
const iso = (v) => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/**
 * The ad number from the query string. Throws the contract's 400 when it is
 * missing or is not 1-9 digits.
 * @param {unknown} v @returns {string}
 */
export function parseAdNumber(v) {
  const s = v === undefined || v === null ? "" : String(v).trim();
  if (!s) throw new InvalidError("n", "Say which ad: n is the ad number, like 91.");
  if (!AD_NUMBER_RE.test(s)) {
    throw new InvalidError("n", "n is the ad number: digits only, 1 to 9 of them, like 91.");
  }
  return s;
}

/**
 * The row readAdNumbers gives a number with no ad-days and no leads in the
 * window: spend and every Meta count unknown (null), lead counts 0, no cash.
 * readAdNumbers itself never returns such a row (it lists active numbers), so
 * the drawer of a quiet number is built from this.
 * @param {string} n
 */
export function quietRow(n) {
  return {
    ad_number: n,
    ads: 0,
    spend_cents: null, impressions: null, link_clicks: null, plays: null,
    p25: null, thruplay: null, two_sec: null,
    ad_days: 0,
    reported_days: { link_clicks: 0, plays: 0, two_sec: 0 },
    leads: 0, booked: 0, showed: 0, sales: 0, roadmaps: 0,
    cash_cents: 0, cash_unknown: 0, reported_cash_cents: 0,
    maturing: false, maturing_leads: 0
  };
}

/**
 * Every Meta ad carrying the number, oldest first.
 * @param {Tx} tx @param {{orgId: string, n: string}} opts
 */
export async function readMetaAds(tx, { orgId, n }) {
  const { rows } = await tx.query(
    `SELECT a.id, a.external_id, a.name, a.status, s.external_id AS ad_set_external_id
       FROM ads a
       JOIN ad_sets s ON s.id = a.ad_set_id AND s.org_id = a.org_id
      WHERE a.org_id = $1
        AND a.fundhub_ad_number = $2
      ORDER BY a.created_at, a.id`,
    [orgId, n]
  );
  return rows.map((r) => ({
    id: r.id,
    external_id: r.external_id ?? null,
    name: r.name,
    status: r.status ?? null,
    ad_set_external_id: r.ad_set_external_id ?? null
  }));
}

/**
 * true when a lead of this company was ever tagged with the number.
 * @param {Tx} tx @param {{orgId: string, n: string}} opts
 */
export async function hasTaggedLead(tx, { orgId, n }) {
  const { rows } = await tx.query(
    `SELECT EXISTS (
       SELECT 1 FROM client_ad_attribution WHERE org_id = $1 AND ad_id = $2
     ) AS found`,
    [orgId, n]
  );
  return rows[0]?.found === true;
}

/**
 * One entry per Meta ad per saved ad-day in the window, oldest day first.
 * @param {Tx} tx @param {{orgId: string, n: string, from: string, to: string}} opts
 */
export async function readCurve(tx, { orgId, n, from, to }) {
  const { rows } = await tx.query(
    `SELECT m.date::text AS date, m.ad_id, m.video_play_curve
       FROM ad_metrics_daily m
       JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
      WHERE m.org_id = $1
        AND a.fundhub_ad_number = $2
        AND m.date BETWEEN $3::date AND $4::date
      ORDER BY m.date, a.created_at, m.ad_id`,
    [orgId, n, from, to]
  );
  return rows.map((r) => ({
    date: r.date,
    video_play_curve: r.video_play_curve ?? null,
    ad_id: r.ad_id
  }));
}

/**
 * The watch-curve alerts and diagnoses of every Meta ad carrying the number.
 * @param {Tx} tx @param {{orgId: string, n: string}} opts
 */
export async function readWatch(tx, { orgId, n }) {
  const alerts = await tx.query(
    `SELECT w.ad_id, w.dies_before_25_alerted_on::text AS dies_before_25_alerted_on, w.updated_at
       FROM ad_watch_curve_alerts w
       JOIN ads a ON a.id = w.ad_id AND a.org_id = w.org_id
      WHERE w.org_id = $1
        AND a.fundhub_ad_number = $2
      ORDER BY w.dies_before_25_alerted_on DESC NULLS LAST, w.ad_id`,
    [orgId, n]
  );
  const diagnoses = await tx.query(
    `SELECT d.id, m.date::text AS date, m.ad_id, d.diagnosis, d.fix_type, d.film_note,
            d.next_take_improved, d.created_at
       FROM ad_watch_curve_diagnoses d
       JOIN ad_metrics_daily m ON m.id = d.ad_metrics_daily_id AND m.org_id = d.org_id
       JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
      WHERE d.org_id = $1
        AND a.fundhub_ad_number = $2
      ORDER BY m.date DESC, d.created_at DESC, d.id
      LIMIT ${DIAGNOSES_LIMIT}`,
    [orgId, n]
  );
  return {
    alerts: alerts.rows.map((r) => ({
      ad_id: r.ad_id,
      dies_before_25_alerted_on: r.dies_before_25_alerted_on ?? null,
      updated_at: iso(r.updated_at)
    })),
    diagnoses: diagnoses.rows.map((r) => ({
      date: r.date,
      diagnosis: r.diagnosis,
      fix_type: r.fix_type,
      film_note: r.film_note,
      next_take_improved: r.next_take_improved ?? null,
      id: r.id,
      ad_id: r.ad_id,
      created_at: iso(r.created_at)
    }))
  };
}

/**
 * readAdDetail(tx, {orgId, n, from, to, now}) → {ad, sync}, or {ad: null}
 * when the company has never seen the number.
 *
 * Everything GET marketing/ad reads, on one transaction from asStaff().
 * Exported so the pg test can run the very same reads under EXPLAIN.
 *
 * @param {Tx} tx
 * @param {{orgId: string, n: string, from: string, to: string, now: Date}} opts
 */
export async function readAdDetail(tx, { orgId, n, from, to, now }) {
  const metaAds = await readMetaAds(tx, { orgId, n });
  const labels = await readScriptLabels(tx, { orgId, adNumbers: [n] });
  const known = metaAds.length > 0 || labels.has(n) || await hasTaggedLead(tx, { orgId, n });
  if (!known) return { ad: null, sync: null };

  const read = await readAdNumbers(tx, { orgId, from, to, adNumbers: [n], now });
  const row = adRow(read[0] ?? quietRow(n), labels.get(n) ?? NO_LABELS);
  const curve = await readCurve(tx, { orgId, n, from, to });
  const watch = await readWatch(tx, { orgId, n });
  const sync = await readLastSync(tx, { orgId });
  return { ad: { ...row, meta_ads: metaAds, curve, watch }, sync };
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
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read one ad." });
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
    const n = parseAdNumber((req.query || {}).n);
    // The same 30 Arizona days GET marketing/ads uses when it gets no window.
    const { from, to } = parseRange({}, adAccountDay(now));

    const out = await staffRead(database, (tx) => readAdDetail(tx, { orgId, n, from, to, now }));
    if (!out.ad) throw new NotFoundError(`There is no ad number ${n} in this company.`);

    return res.status(200).json({ ad: out.ad, as_of: asOf(out.sync) });
  } catch (err) {
    if (sendKnownError(res, err)) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
