// Ad and sales numbers for the morning and evening brief, PER OFFER and PER
// FUNNEL (owner-set 2026-10-05, MB6).
//
// WHERE THE GROUPING COMES FROM — read from the repo, never invented:
//   * OFFER = the ad's script label, ad_scripts.offer_key, carried to the ad by
//     v_ad_label_spine (db/migrations/377_marketing_label_spine.sql). Spend joins
//     on ad_metrics_daily.ad_id = ad_row_id. A person joins on their first-touch
//     ad number, client_ad_attribution.ad_id = fundhub_ad_number (the bridge that
//     view's header names). This is the first rule of the marketing machine's
//     lead → offer tag (docs/specs/marketing-machine-2026-10-04.md §11.1). The
//     other two rules (campaign mapping, landing page → offer) have no table on
//     main yet, so they are not guessed here.
//   * FUNNEL = the person's first landing page, client_ad_attribution.landing_path,
//     looked up in src/funnel/pages.mjs (watch / roadmap / homepage).
//   * NULL stays unknown: no label → "No offer label", no landing page →
//     "No landing page", a page not on the map → "Other page". An ad number that
//     two ads with DIFFERENT labels share is not guessed: it is "No offer label".
//
// SHAPE (what the stored report and the MB5 page read):
//   { offers: [{ key, name, totals, funnels: [{ key, name, totals }] }],
//     all_offers: { totals, not_split: [{ key, what, value, reason }] } }
// A number that cannot be split by offer or funnel is shown ONCE, in
// all_offers.not_split, with a one-line reason. Never spread across offers.
//
// Read only. Money is integer cents. Every number is a plain SQL read.

import { funnelFor } from "../funnel/pages.mjs";
import { costPerBooked } from "./meta-marketing.mjs";
import { readDyingAds, pageChangeCandidates } from "./suggestions.mjs";
import { asStaff } from "../partners/rls.mjs";

// Sentinel keys start with "_": ad_scripts.offer_key must match
// ^[a-z][a-z0-9_]{1,48}$ (377), so no real offer can collide with them.
export const NO_OFFER = "_no_offer_label";
export const NO_PAGE = "_no_landing_page";
export const OTHER_PAGE = "_other_page";

// The same "money came in" rule as the company cash number
// (src/dashboard/kpis.mjs, computeKpis), so the offer split adds up to it.
export const CASH_STATUSES = Object.freeze(["paid", "succeeded", "complete", "completed"]);

export const OFFER_NOTES = Object.freeze([
  "Offer comes from each ad's script label (ad_scripts.offer_key). Ads and people with no label show as \"No offer label\".",
  "Funnel comes from the person's first landing page (src/funnel/pages.mjs)."
]);

export const NOT_SPLIT_REASONS = Object.freeze({
  spend_by_funnel: "Spend belongs to an ad, and an ad has no funnel, so spend, cost per booked person and return on ad spend are split by offer only.",
  cash_no_person: "These payments have no person on them, so they have no offer or funnel.",
  booked_no_person: "These bookings have no person on them, so they have no offer or funnel."
});

const NAMES = { [NO_OFFER]: "No offer label", [NO_PAGE]: "No landing page", [OTHER_PAGE]: "Other page" };
export function displayName(key) {
  return NAMES[key] || key;
}

export function offerOf(offerKey) {
  const k = offerKey == null ? "" : String(offerKey).trim();
  return k || NO_OFFER;
}

export function funnelOf(landingPath) {
  if (landingPath == null || String(landingPath).trim() === "") return NO_PAGE;
  const path = String(landingPath).split(/[?#]/)[0];
  const hit = funnelFor(path);
  return hit ? hit.funnel : OTHER_PAGE;
}

const METRICS = ["leads", "booked", "showed", "no_shows", "sales", "cash_cents"];
const blank = () => ({ leads: 0, booked: 0, showed: 0, no_shows: 0, sales: 0, cash_cents: 0 });
const METRIC_FIELD = { lead: "leads", booked: "booked", showed: "showed", no_show: "no_shows", sale: "sales", cash: "cash_cents" };

function roas(cashCents, spendCents) {
  if (spendCents == null || spendCents <= 0) return null;
  return Math.round((cashCents / spendCents) * 100) / 100;
}
function closeRate(sales, showed) {
  return showed ? Math.round((sales / showed) * 1000) / 1000 : null;
}
function byName(a, b) {
  return String(a.name).localeCompare(String(b.name));
}

/**
 * Pure. spendRows: [{ offer_key, spend_cents, rows }]
 * activityRows: [{ offer_key, landing_path, metric, n, cents }]
 *   metric: lead | booked | showed | no_show | sale | cash | cash_no_person | booked_no_person
 * → { offers, all_offers }. Offers by spend, then cash; funnels by new people.
 */
export function groupByOfferFunnel(spendRows = [], activityRows = []) {
  const offers = new Map();
  const get = (key) => {
    if (!offers.has(key)) offers.set(key, { key, spend_cents: null, ...blank(), funnels: new Map() });
    return offers.get(key);
  };
  for (const r of spendRows) {
    if (!Number(r.rows || 0)) continue;
    const o = get(offerOf(r.offer_key));
    o.spend_cents = (o.spend_cents || 0) + Number(r.spend_cents || 0);
  }
  const unlinked = { cash_no_person: 0, booked_no_person: 0 };
  for (const r of activityRows) {
    if (r.metric in unlinked) {
      unlinked[r.metric] += r.metric === "cash_no_person" ? Number(r.cents || 0) : Number(r.n || 0);
      continue;
    }
    const field = METRIC_FIELD[r.metric];
    if (!field) continue;
    const o = get(offerOf(r.offer_key));
    const fk = funnelOf(r.landing_path);
    if (!o.funnels.has(fk)) o.funnels.set(fk, { key: fk, ...blank() });
    const f = o.funnels.get(fk);
    const v = field === "cash_cents" ? Number(r.cents || 0) : Number(r.n || 0);
    o[field] += v;
    f[field] += v;
  }

  const totals = { spend_cents: null, ...blank() };
  const list = [...offers.values()].map((o) => {
    if (o.spend_cents != null) totals.spend_cents = (totals.spend_cents || 0) + o.spend_cents;
    for (const m of METRICS) totals[m] += o[m];
    const funnels = [...o.funnels.values()].map((f) => ({
      key: f.key,
      name: displayName(f.key),
      totals: { ...Object.fromEntries(METRICS.map((m) => [m, f[m]])), close_rate: closeRate(f.sales, f.showed) }
    }));
    funnels.sort((a, b) => b.totals.leads - a.totals.leads || b.totals.booked - a.totals.booked || byName(a, b));
    return {
      key: o.key,
      name: displayName(o.key),
      totals: {
        spend_cents: o.spend_cents,
        ...Object.fromEntries(METRICS.map((m) => [m, o[m]])),
        close_rate: closeRate(o.sales, o.showed),
        cost_per_booked: costPerBooked({ spendCents: o.spend_cents, bookedN: o.booked }),
        roas: roas(o.cash_cents, o.spend_cents)
      },
      funnels
    };
  });
  list.sort((a, b) => (b.totals.spend_cents || 0) - (a.totals.spend_cents || 0) ||
    b.totals.cash_cents - a.totals.cash_cents || byName(a, b));

  // All offers: the split numbers added up, plus the numbers that cannot be
  // split, each once, with its reason. The company totals include them.
  const not_split = [{ key: "spend_by_funnel", what: "Spend per funnel", value: null, reason: NOT_SPLIT_REASONS.spend_by_funnel }];
  if (unlinked.cash_no_person) {
    not_split.push({ key: "cash_no_person", what: "Cash with no person on it", value: unlinked.cash_no_person, unit: "cents", reason: NOT_SPLIT_REASONS.cash_no_person });
  }
  if (unlinked.booked_no_person) {
    not_split.push({ key: "booked_no_person", what: "Bookings with no person on them", value: unlinked.booked_no_person, unit: "count", reason: NOT_SPLIT_REASONS.booked_no_person });
  }
  totals.cash_cents += unlinked.cash_no_person;
  totals.booked += unlinked.booked_no_person;
  totals.close_rate = closeRate(totals.sales, totals.showed);
  totals.cost_per_booked = costPerBooked({ spendCents: totals.spend_cents, bookedN: totals.booked });
  totals.roas = roas(totals.cash_cents, totals.spend_cents);
  return { offers: list, all_offers: { totals, not_split } };
}

/* First touch wins: client_ad_attribution is one row per client (its primary
   key), so the join below cannot double a person. An ad number shared by ads
   with different labels is left unlabelled rather than guessed. */
const ATTR_CTE = `
  attr AS (
    SELECT caa.client_id, caa.landing_path,
           (SELECT CASE WHEN count(DISTINCT v.offer_key) = 1 THEN min(v.offer_key) END
              FROM v_ad_label_spine v
             WHERE v.org_id = caa.org_id AND v.fundhub_ad_number = caa.ad_id
               AND v.offer_key IS NOT NULL) AS offer_key
      FROM client_ad_attribution caa
     WHERE caa.org_id = $1
  )`;

export async function readSpendByOffer(tx, { orgId, day }) {
  const r = await tx.query(
    `SELECT v.offer_key, COUNT(*)::int AS rows, COALESCE(SUM(m.spend_cents), 0)::bigint AS spend_cents
       FROM ad_metrics_daily m
       LEFT JOIN v_ad_label_spine v ON v.ad_row_id = m.ad_id
      WHERE m.org_id = $1 AND m.date = $2::date
      GROUP BY v.offer_key`,
    [orgId, day]
  );
  return r.rows;
}

/* What happened in [from, to): new people, bookings made, calls held and
   no-shows, sales, cash — each tagged with the person's offer and funnel.
   Leads, booked, showed and no-shows count PEOPLE; sales count sales rows;
   cash is transactions.amount_paid (DOLLARS, numeric) turned into cents. */
export async function readActivityByOffer(tx, { orgId, from, to }) {
  const r = await tx.query(
    `WITH ${ATTR_CTE},
     ev AS (
       SELECT 'lead' AS metric, c.id AS client_id, 0::bigint AS cents
         FROM clients c
        WHERE c.org_id = $1 AND COALESCE(c.is_demo, false) = false
          AND c.created_at >= $2::timestamptz AND c.created_at < $3::timestamptz
       UNION ALL
       SELECT CASE WHEN b.client_id IS NULL THEN 'booked_no_person' ELSE 'booked' END, b.client_id, 0
         FROM bookings b
        WHERE b.org_id = $1
          AND b.created_at >= $2::timestamptz AND b.created_at < $3::timestamptz
       UNION ALL
       SELECT CASE WHEN o.outcome = 'no_show' THEN 'no_show' ELSE 'showed' END, o.client_id, 0
         FROM call_outcomes o
        WHERE o.org_id = $1 AND COALESCE(o.is_demo, false) = false
          AND o.logged_at >= $2::timestamptz AND o.logged_at < $3::timestamptz
       UNION ALL
       SELECT 'sale', s.client_id, 0
         FROM sales s
        WHERE s.org_id = $1 AND s.status = 'active' AND COALESCE(s.is_demo, false) = false
          AND s.sold_at >= $2::timestamptz AND s.sold_at < $3::timestamptz
       UNION ALL
       SELECT CASE WHEN t.client_id IS NULL THEN 'cash_no_person' ELSE 'cash' END, t.client_id,
              round(t.amount_paid * 100)::bigint
         FROM transactions t
        WHERE t.org_id = $1 AND t.status = ANY($4::text[])
          AND COALESCE(t.is_demo, false) = false AND t.amount_paid IS NOT NULL
          AND t.created_at >= $2::timestamptz AND t.created_at < $3::timestamptz
     )
     SELECT a.offer_key, a.landing_path, ev.metric,
            CASE WHEN ev.metric IN ('sale', 'booked_no_person') THEN count(*)
                 ELSE count(DISTINCT ev.client_id) END::int AS n,
            COALESCE(sum(ev.cents), 0)::bigint AS cents
       FROM ev
       LEFT JOIN attr a ON a.client_id = ev.client_id
      GROUP BY a.offer_key, a.landing_path, ev.metric`,
    [orgId, from, to, CASH_STATUSES]
  );
  return r.rows;
}

/* Per closer, per offer and funnel: calls held, no-shows, deposits (the sale
   as src/sales/metrics.mjs counts it), close rate = deposits ÷ held. */
export async function readClosersByOffer(tx, { orgId, from, to }) {
  const r = await tx.query(
    `WITH ${ATTR_CTE}
     SELECT o.staff_id, s.name, a.offer_key, a.landing_path,
            count(*) FILTER (WHERE o.outcome <> 'no_show')::int AS calls_held,
            count(*) FILTER (WHERE o.outcome = 'no_show')::int AS no_shows,
            count(*) FILTER (WHERE o.outcome = 'deposit')::int AS deposits,
            count(*) FILTER (WHERE o.outcome = 'downsell')::int AS downsells
       FROM call_outcomes o
       JOIN staff s ON s.id = o.staff_id AND s.org_id = o.org_id
       LEFT JOIN attr a ON a.client_id = o.client_id
      WHERE o.org_id = $1
        AND COALESCE(o.is_demo, false) = false
        AND o.logged_at >= $2::timestamptz
        AND o.logged_at < $3::timestamptz
      GROUP BY o.staff_id, s.name, a.offer_key, a.landing_path`,
    [orgId, from, to]
  );
  return r.rows;
}

const CALL_KEYS = ["calls_held", "no_shows", "deposits", "downsells"];
const callBlank = () => ({ calls_held: 0, no_shows: 0, deposits: 0, downsells: 0 });
const callRate = (x) => (x.calls_held ? Math.round((x.deposits / x.calls_held) * 1000) / 1000 : null);
const callTotals = (x) => ({ ...Object.fromEntries(CALL_KEYS.map((k) => [k, x[k]])), close_rate: callRate(x) });

/** Pure. Rows from readClosersByOffer → one entry per closer, each with offers → funnels. */
export function groupClosers(rows = []) {
  const people = new Map();
  for (const r of rows) {
    if (!people.has(r.staff_id)) people.set(r.staff_id, { staff_id: r.staff_id, name: r.name, ...callBlank(), offers: new Map() });
    const p = people.get(r.staff_id);
    const ok = offerOf(r.offer_key);
    const fk = funnelOf(r.landing_path);
    if (!p.offers.has(ok)) p.offers.set(ok, { key: ok, ...callBlank(), funnels: new Map() });
    const o = p.offers.get(ok);
    if (!o.funnels.has(fk)) o.funnels.set(fk, { key: fk, ...callBlank() });
    const f = o.funnels.get(fk);
    for (const k of CALL_KEYS) {
      const v = Number(r[k] || 0);
      p[k] += v; o[k] += v; f[k] += v;
    }
  }
  return [...people.values()]
    .map((p) => ({
      staff_id: p.staff_id,
      name: p.name,
      ...callTotals(p),
      offers: [...p.offers.values()]
        .map((o) => ({
          key: o.key,
          name: displayName(o.key),
          totals: callTotals(o),
          funnels: [...o.funnels.values()].map((f) => ({ key: f.key, name: displayName(f.key), totals: callTotals(f) })).sort(byName)
        }))
        .sort(byName)
    }))
    .sort(byName);
}

/** Dying ads (the watch-curve rule MB4 uses), each with its offer. */
export async function readDyingByOffer(tx, { orgId, date }) {
  const dying = pageChangeCandidates(await readDyingAds(tx, { orgId, date }));
  if (!dying.length) return [];
  const ids = dying.map((d) => d.numbers.ad_id);
  const r = await tx.query(
    `SELECT ad_row_id, offer_key FROM v_ad_label_spine WHERE ad_row_id = ANY($1::uuid[])`,
    [ids]
  );
  const offerById = new Map(r.rows.map((x) => [String(x.ad_row_id), x.offer_key]));
  return dying.map((d) => {
    const key = offerOf(offerById.get(String(d.numbers.ad_id)));
    return {
      ad_id: d.numbers.ad_id,
      ad_name: d.numbers.ad_name,
      offer: key,
      offer_name: displayName(key),
      plays: d.numbers.plays,
      reached_25_rate: d.numbers.reached_25_rate,
      spend_7d_cents: d.numbers.spend_7d_cents
    };
  });
}

/**
 * Everything the brief needs per offer and funnel, in one staff-scoped
 * transaction (ads, ad_metrics_daily and ad_scripts carry partner row-level
 * security and read EMPTY without a staff scope).
 */
export async function loadOfferNumbers(db, { orgId, day, from, to, briefDate, staffScope = asStaff }) {
  return staffScope(async (tx) => {
    const spend = await readSpendByOffer(tx, { orgId, day });
    const activity = await readActivityByOffer(tx, { orgId, from, to });
    const closers = await readClosersByOffer(tx, { orgId, from, to });
    const dying = await readDyingByOffer(tx, { orgId, date: briefDate });
    return { spend, activity, closers, dying };
  });
}

export default { groupByOfferFunnel, groupClosers, loadOfferNumbers, offerOf, funnelOf, displayName, OFFER_NOTES };
