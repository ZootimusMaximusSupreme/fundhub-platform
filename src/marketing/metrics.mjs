// @ts-check
// src/marketing/metrics.mjs — the marketing numbers, one definition each.
//
// Spec: docs/specs/marketing-machine-2026-10-04.md §11.1. The plain-words table
// and the measured gaps live in docs/marketing/metrics.md. Change a rule here and
// there in the same commit, or the page and the book disagree.
//
// TWO HALVES.
//   1. Pure ratio helpers (ctr, hookRate, hold25, thruplayRate, cpl,
//      costPerBooked, roas, closeRate, clickToPage, pageToLead) and the 14-day
//      maturing rule. No clock, no database. Unknown in, null out — never 0.
//   2. SQL readers (readAdNumbers, readTotals, readDaily, readFunnelEvents) and
//      roadmapPaidPredicates. Every one takes a `tx` the caller opened with
//      asStaff() (src/partners/rls.mjs). ads and ad_metrics_daily FORCE partner
//      row-level security: a bare pool query sees zero rows and reads as "no
//      spend", which is a lie that looks like a fact.
//
// THE RULES (spec §11.1, owner-approved):
//   - Spend and impressions count by SPEND DATE: ad_metrics_daily.date, which
//     is Meta's own day in the ad account's zone (America/Phoenix,
//     src/lib/ad-account-day.mjs). Never CURRENT_DATE.
//   - Everything else counts by LEAD DATE: the Arizona day of
//     client_ad_attribution.captured_at. A lead's results (booked, showed,
//     sales, roadmaps, cash, reported cash) count only if they happen before the
//     lead is 14 days old. A lead younger than 14 days is "still maturing".
//   - First touch wins. client_ad_attribution holds one row per client (its key
//     is client_id) and the writer never overwrites a tag (286), so every
//     result belongs to exactly one ad number.
//   - TWO KINDS OF ad_id (spec §4 trap 10). ad_metrics_daily.ad_id is ads.id, a
//     uuid. client_ad_attribution.ad_id is OUR ad number, as text. The bridge
//     is ads.fundhub_ad_number.
//   - Counted per ad NUMBER. One number may span several ads rows (U14, 416).
//     Spend is summed per number and leads are counted per number in SEPARATE
//     subqueries, then joined on the number, so two ads rows sharing a number
//     never multiply a lead.
//   - Demo rows never count: clients, call_outcomes, sales, transactions,
//     payment_links and events all carry is_demo (094, 148, 153).
//
// MONEY is integer cents. transactions.amount_paid is numeric dollars; it is
// turned into cents in SQL with round(x * 100), which rounds half away from
// zero, the same rule as roundHalfUp in src/commissions/money.mjs.

import { AD_ACCOUNT_TZ, adAccountDay } from "../lib/ad-account-day.mjs";
import { addDays, daysBetween, isIsoDate } from "../metro2/dates.mjs";
import { funnelFor } from "../funnel/pages.mjs";

// ═══════════════════════════════════════════════════════════════════════════
// 1. PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/** A lead's results count for this many days. Newer leads are "still maturing". */
export const MATURE_DAYS = 14;
const MS_PER_DAY = 86_400_000;

/** A count or an amount as pg hands it back (bigint and numeric arrive as
    strings), or null / undefined when it is not known.
    @typedef {number | string | null | undefined} Num */

/** The fields the ratio helpers read. Every reader row carries the ones it has.
    @typedef {{ link_clicks?: Num, impressions?: Num, two_sec?: Num, p25?: Num,
                plays?: Num, thruplay?: Num, spend_cents?: Num, leads?: Num,
                booked?: Num, cash_cents?: Num, sales?: Num, showed?: Num,
                page_views?: Num }} MetricRow */

/** @typedef {(row?: MetricRow) => number | null} Ratio */

/** A transaction from asStaff(): anything with a pg-style query().
    @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Tx */

/* A count or an amount, or null when it is not known. A string from pg (bigint
   and numeric arrive as strings) is read as a number. Anything that is not a
   finite, non-negative number is unknown. */
/** @param {unknown} v @returns {number | null} */
function known(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/* A plain fraction (0.032 means 3.2%), rounded to four places so a screen never
   prints 0.30000000000000004 — the same rounding src/ops/meta-marketing.mjs
   watchRate uses. null when either side is unknown or the bottom is 0. */
/** @param {Num} top @param {Num} bottom @returns {number | null} */
function fraction(top, bottom) {
  const t = known(top);
  const b = known(bottom);
  if (t === null || b === null || b === 0) return null;
  return Math.round((t / b) * 10_000) / 10_000;
}

/* Whole cents per unit, rounded half up. null when either side is unknown or
   the bottom is 0: "no leads" has no cost per lead, it is not $0. */
/** @param {Num} cents @param {Num} count @returns {number | null} */
function centsPer(cents, count) {
  const c = known(cents);
  const n = known(count);
  if (c === null || n === null || n === 0) return null;
  return Math.round(c / n);
}

/** CTR: link clicks ÷ impressions. Not `clicks`, which counts every click.
    @type {Ratio} */
export const ctr = ({ link_clicks, impressions } = {}) => fraction(link_clicks, impressions);

/** Hook rate: 2-second continuous plays ÷ impressions.
    @type {Ratio} */
export const hookRate = ({ two_sec, impressions } = {}) => fraction(two_sec, impressions);

/** 25% hold: plays that reached 25% ÷ plays. NOT ad-spine's hold_rate (p75 ÷ 2 s).
    @type {Ratio} */
export const hold25 = ({ p25, plays } = {}) => fraction(p25, plays);

/** Thruplay rate: ThruPlays (15 s, or the whole of a shorter video) ÷ plays.
    @type {Ratio} */
export const thruplayRate = ({ thruplay, plays } = {}) => fraction(thruplay, plays);

/** Cost per lead, in cents: spend ÷ leads.
    @type {Ratio} */
export const cpl = ({ spend_cents, leads } = {}) => centsPer(spend_cents, leads);

/** Cost per booked call, in cents: spend ÷ booked leads. No small-sample rule here;
    src/ops/meta-marketing.mjs costPerBooked adds MIN_N_RATE for the insight cards.
    @type {Ratio} */
export const costPerBooked = ({ spend_cents, booked } = {}) => centsPer(spend_cents, booked);

/** ROAS: cash ÷ spend (2.5 means $2.50 back for every $1).
    @type {Ratio} */
export const roas = ({ cash_cents, spend_cents } = {}) => fraction(cash_cents, spend_cents);

/** Close rate: sales ÷ showed.
    @type {Ratio} */
export const closeRate = ({ sales, showed } = {}) => fraction(sales, showed);

/** Click → page: page views ÷ link clicks (of the people who tapped, how many saw the page).
    @type {Ratio} */
export const clickToPage = ({ page_views, link_clicks } = {}) => fraction(page_views, link_clicks);

/** Page → lead: leads ÷ page views.
    @type {Ratio} */
export const pageToLead = ({ leads, page_views } = {}) => fraction(leads, page_views);

/** Every ratio for one row, keyed the way the screens print them.
    @param {MetricRow} [row] */
export function ratiosFor(row = {}) {
  return {
    ctr: ctr(row),
    hook_rate: hookRate(row),
    hold_25: hold25(row),
    thruplay_rate: thruplayRate(row),
    cpl_cents: cpl(row),
    cost_per_booked_cents: costPerBooked(row),
    roas: roas(row),
    close_rate: closeRate(row),
    click_to_page: clickToPage(row),
    page_to_lead: pageToLead(row)
  };
}

/** @param {unknown} v @returns {number | null} */
function asTime(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" || typeof v === "number") {
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** When a lead's results stop counting: captured_at + 14 days. null for a bad time.
    @param {Date | string | number | null | undefined} leadAt @returns {Date | null} */
export function settlesAt(leadAt) {
  const t = asTime(leadAt);
  return t === null ? null : new Date(t + MATURE_DAYS * MS_PER_DAY);
}

/** true while a lead is younger than 14 days. At exactly 14 days it has settled.
    A lead with no readable time is unknown (null), never called settled.
    @param {Date | string | number | null | undefined} leadAt
    @param {Date | string | number} [now]
    @returns {boolean | null} */
export function isMaturing(leadAt, now = new Date()) {
  const settles = settlesAt(leadAt);
  const n = asTime(now);
  if (settles === null || n === null) return null;
  return n < settles.getTime();
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. THE $147 ROADMAP RULE, LIFTED FROM readSloPaid
// ═══════════════════════════════════════════════════════════════════════════
//
// api/read/portal-summary.mjs readSloPaid (:409-428) is the rule for "she paid
// for the roadmap". It cannot be reused as it stands: it is bound to the
// module-level live `db` and wrapped in safeRead, which turns ANY error into
// `false` — on a fixture pool, or on a missing table, it would quietly say
// "not paid". So it is not exported and not called. Its two predicates are
// lifted here, word for word, and src/marketing/metrics-drift.test.mjs fails
// the moment either copy changes without the other.
//
// Only the conditions are lifted. The binding (org_id = $1 AND client_id = $2
// there, the lead's own org and client here) is the caller's.
//
// The strings are SQL as Postgres receives it: 'slo\_%' is a literal
// underscore after "slo" (LIKE's default escape is the backslash).

export const ROADMAP_BY_ORDER = Object.freeze({
  table: "payment_links",
  as: "by_order",
  conditions: Object.freeze([
    "link_ref LIKE 'slo\\_%'",
    "status = 'paid'",
    "is_demo IS NOT TRUE"
  ])
});

export const ROADMAP_BY_FUNNEL = Object.freeze({
  table: "transactions",
  as: "by_funnel",
  conditions: Object.freeze([
    "status = 'succeeded'",
    "is_demo IS NOT TRUE",
    "raw_payload->>'source' = 'slo'"
  ])
});

/** @param {readonly string[]} conditions */
const andAll = (conditions) => conditions.join("\n           AND ");

/**
 * roadmapPaidPredicates(tx, { orgId, clientId }) → { by_order, by_funnel, paid }
 *
 * readSloPaid's question, asked on the caller's transaction. Unlike readSloPaid
 * it does NOT swallow errors: a read that fails throws, so a broken table is
 * never reported as "she did not pay".
 *
 * @param {Tx} tx
 * @param {{ orgId?: string, clientId?: string }} [opts]
 */
export async function roadmapPaidPredicates(tx, { orgId, clientId } = {}) {
  if (!tx || typeof tx.query !== "function") throw new TypeError("roadmapPaidPredicates: a tx is required");
  if (!orgId || !clientId) throw new TypeError("roadmapPaidPredicates: orgId and clientId are required");
  const r = await tx.query(
    `SELECT
       EXISTS (SELECT 1 FROM ${ROADMAP_BY_ORDER.table}
                WHERE org_id = $1 AND client_id = $2
                  AND ${andAll(ROADMAP_BY_ORDER.conditions)}) AS ${ROADMAP_BY_ORDER.as},
       EXISTS (SELECT 1 FROM ${ROADMAP_BY_FUNNEL.table}
                WHERE org_id = $1 AND client_id = $2
                  AND ${andAll(ROADMAP_BY_FUNNEL.conditions)}) AS ${ROADMAP_BY_FUNNEL.as}`,
    [orgId, clientId]
  );
  const row = r.rows[0] || {};
  const byOrder = row.by_order === true;
  const byFunnel = row.by_funnel === true;
  return { by_order: byOrder, by_funnel: byFunnel, paid: byOrder || byFunnel };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE SQL READERS
// ═══════════════════════════════════════════════════════════════════════════

const TZ = AD_ACCOUNT_TZ; // a constant, never user input — safe to place in SQL text
const AD_NUMBER = /^[0-9]{1,9}$/;
const MAX_DAYS = 400;

/** @param {any} tx @param {string} who @returns {asserts tx is Tx} */
function needTx(tx, who) {
  if (!tx || typeof tx.query !== "function") {
    throw new TypeError(`${who}: pass the tx from asStaff() — ads and ad_metrics_daily FORCE row-level security`);
  }
}

/** @param {unknown} orgId @param {string} who @returns {asserts orgId is string} */
function needOrg(orgId, who) {
  if (!orgId || typeof orgId !== "string") throw new TypeError(`${who}: orgId is required`);
}

/* from / to are Arizona calendar days, YYYY-MM-DD, both included. */
/** @param {any} from @param {any} to @param {string} who @returns {{ from: string, to: string }} */
function needRange(from, to, who) {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    throw new TypeError(`${who}: from and to must be YYYY-MM-DD Arizona days (got ${JSON.stringify(from)}, ${JSON.stringify(to)})`);
  }
  if (daysBetween(from, to) < 0) throw new RangeError(`${who}: from ${from} is after to ${to}`);
  return { from: from.trim(), to: to.trim() };
}

/** @param {unknown} now @returns {string} */
function nowIso(now) {
  const t = asTime(now ?? new Date());
  if (t === null) throw new TypeError("now is not a readable time");
  return new Date(t).toISOString();
}

/** @param {unknown} adNumbers @param {string} who @returns {string[] | null} */
function cleanNumbers(adNumbers, who) {
  if (adNumbers == null) return null;
  if (!Array.isArray(adNumbers)) throw new TypeError(`${who}: adNumbers must be an array`);
  const out = adNumbers.map((n) => String(n).trim());
  for (const n of out) {
    if (!AD_NUMBER.test(n)) throw new TypeError(`${who}: "${n}" is not an ad number (1-9 digits)`);
  }
  return [...new Set(out)];
}

/* pg hands back bigint and numeric as strings. A count stays a number; NULL
   stays null — never coerced to 0. */
/** @param {unknown} v @returns {number | null} */
const num = (v) => (v === null || v === undefined ? null : Number(v));

/*
 * THE LEAD CTEs. One definition of "a lead and what it did", shared by
 * readAdNumbers, readTotals and readDaily so the three can never disagree.
 *
 * Parameters it uses: $1 org, $2 from day, $3 to day, $4 now. `extraWhere` is
 * appended to lead_rows' WHERE (readAdNumbers adds the ad-number filter there).
 *
 *   booked   a bookings row with status booked / rescheduled / noshow /
 *            completed, matched by client_id — or, for a booking that names no
 *            client, by attendee email = the client's email (trimmed, any case).
 *            A cancelled booking is not a booked call. Time: created_at.
 *   showed   a call_outcomes row whose outcome is not 'no_show' (spec §4 trap
 *            25: switch to W7's ShowedCall when it lands). Time: logged_at.
 *   sold     a sales row with status 'active'. Time: sold_at.
 *   roadmap  readSloPaid's two predicates, lifted above. Time: the order's
 *            paid_at (else its last update), or the transaction's created_at.
 *   cash     transactions 'succeeded' for that client, in cents. Time:
 *            created_at. A row with no amount is counted in cash_unknown and
 *            adds nothing; it is never read as $0.
 *   reported cash  SUM(call_outcomes.cash_collected_cents) — what closers type
 *            in, the number My Numbers shows (src/sales/metrics.mjs:53-69).
 *
 * Each result counts only when it happened before captured_at + 14 days. There
 * is no lower bound on purpose: a booking or payment written a moment before
 * the tag row (same request) is still that lead's result.
 */
function leadCtes(extraWhere = "") {
  const d = (col) => `(${col} AT TIME ZONE '${TZ}')::date`;
  return `
lead_rows AS (
  SELECT a.client_id,
         a.org_id,
         a.ad_id AS ad_number,
         a.captured_at,
         ${d("a.captured_at")} AS lead_day,
         a.captured_at + interval '${MATURE_DAYS} days' AS settles_at,
         nullif(lower(btrim(c.email)), '') AS email
    FROM client_ad_attribution a
    JOIN clients c ON c.id = a.client_id AND c.org_id = a.org_id
   WHERE a.org_id = $1
     AND c.is_demo IS NOT TRUE
     AND ${d("a.captured_at")} BETWEEN $2::date AND $3::date
     ${extraWhere}
),
per_lead AS (
  SELECT l.client_id,
         l.ad_number,
         l.lead_day,
         (l.settles_at > $4::timestamptz) AS maturing,
         EXISTS (
           SELECT 1 FROM bookings bk
            WHERE bk.org_id = l.org_id
              AND bk.status IN ('booked', 'rescheduled', 'noshow', 'completed')
              AND (bk.client_id = l.client_id
                   OR (bk.client_id IS NULL AND l.email IS NOT NULL
                       AND lower(btrim(bk.attendee_email)) = l.email))
              AND bk.created_at < l.settles_at
         ) AS booked,
         EXISTS (
           SELECT 1 FROM call_outcomes co
            WHERE co.org_id = l.org_id AND co.client_id = l.client_id
              AND co.outcome <> 'no_show'
              AND co.is_demo IS NOT TRUE
              AND co.logged_at < l.settles_at
         ) AS showed,
         EXISTS (
           SELECT 1 FROM sales s
            WHERE s.org_id = l.org_id AND s.client_id = l.client_id
              AND s.status = 'active'
              AND s.is_demo IS NOT TRUE
              AND s.sold_at < l.settles_at
         ) AS sold,
         (EXISTS (
            SELECT 1 FROM ${ROADMAP_BY_ORDER.table}
             WHERE org_id = l.org_id AND client_id = l.client_id
               AND ${andAll(ROADMAP_BY_ORDER.conditions)}
               AND coalesce(paid_at, updated_at) < l.settles_at
          ) OR EXISTS (
            SELECT 1 FROM ${ROADMAP_BY_FUNNEL.table}
             WHERE org_id = l.org_id AND client_id = l.client_id
               AND ${andAll(ROADMAP_BY_FUNNEL.conditions)}
               AND created_at < l.settles_at
          )) AS roadmap,
         cash.cents AS cash_cents,
         coalesce(cash.n, 0) AS cash_rows,
         coalesce(cash.unknown, 0) AS cash_unknown,
         coalesce(rep.cents, 0) AS reported_cash_cents
    FROM lead_rows l
    LEFT JOIN LATERAL (
           SELECT sum(round(t.amount_paid * 100))::bigint AS cents,
                  count(*) AS n,
                  count(*) FILTER (WHERE t.amount_paid IS NULL) AS unknown
             FROM transactions t
            WHERE t.org_id = l.org_id AND t.client_id = l.client_id
              AND t.status = 'succeeded'
              AND t.is_demo IS NOT TRUE
              AND t.created_at < l.settles_at
         ) cash ON true
    LEFT JOIN LATERAL (
           SELECT sum(co.cash_collected_cents)::bigint AS cents
             FROM call_outcomes co
            WHERE co.org_id = l.org_id AND co.client_id = l.client_id
              AND co.is_demo IS NOT TRUE
              AND co.logged_at < l.settles_at
         ) rep ON true
)`;
}

/* The lead roll-up columns for a GROUP BY over per_lead. Cash is the sum of the
   amounts that were reported; NULL only when there were succeeded payments and
   NONE of them reported an amount. No payments at all is a real $0. */
const LEAD_AGGREGATES = `
         count(*)::int AS leads,
         count(*) FILTER (WHERE booked)::int AS booked,
         count(*) FILTER (WHERE showed)::int AS showed,
         count(*) FILTER (WHERE sold)::int AS sales,
         count(*) FILTER (WHERE roadmap)::int AS roadmaps,
         CASE WHEN sum(cash_rows) > 0 AND sum(cash_rows) = sum(cash_unknown) THEN NULL
              ELSE coalesce(sum(cash_cents), 0) END::bigint AS cash_cents,
         sum(cash_unknown)::int AS cash_unknown,
         sum(reported_cash_cents)::bigint AS reported_cash_cents,
         count(*) FILTER (WHERE maturing)::int AS maturing_leads`;

/* Spend columns for a GROUP BY over ad_metrics_daily m. SUM skips NULL, so a
   column Meta never reported in the window stays NULL (unknown), not 0. The
   day counts say how many ad-days each video / link number was reported on. */
const SPEND_AGGREGATES = `
         sum(m.spend_cents)::bigint AS spend_cents,
         sum(m.impressions)::bigint AS impressions,
         sum(m.link_clicks)::bigint AS link_clicks,
         sum(m.video_plays)::bigint AS plays,
         sum(m.video_p25_watched)::bigint AS p25,
         sum(m.video_thruplay_watched)::bigint AS thruplay,
         sum(m.video_continuous_2s_watched)::bigint AS two_sec,
         count(*)::int AS ad_days,
         count(m.link_clicks)::int AS link_click_days,
         count(m.video_plays)::int AS play_days,
         count(m.video_continuous_2s_watched)::int AS two_sec_days`;

/** @param {Record<string, any>} r */
function spendShape(r) {
  return {
    spend_cents: num(r.spend_cents),
    impressions: num(r.impressions),
    link_clicks: num(r.link_clicks),
    plays: num(r.plays),
    p25: num(r.p25),
    thruplay: num(r.thruplay),
    two_sec: num(r.two_sec),
    ad_days: num(r.ad_days) ?? 0,
    reported_days: {
      link_clicks: num(r.link_click_days) ?? 0,
      plays: num(r.play_days) ?? 0,
      two_sec: num(r.two_sec_days) ?? 0
    }
  };
}

/** @param {Record<string, any>} r */
function leadShape(r) {
  const maturingLeads = num(r.maturing_leads) ?? 0;
  return {
    leads: num(r.leads) ?? 0,
    booked: num(r.booked) ?? 0,
    showed: num(r.showed) ?? 0,
    sales: num(r.sales) ?? 0,
    roadmaps: num(r.roadmaps) ?? 0,
    cash_cents: r.leads == null ? 0 : num(r.cash_cents),
    cash_unknown: num(r.cash_unknown) ?? 0,
    reported_cash_cents: num(r.reported_cash_cents) ?? 0,
    maturing: maturingLeads > 0,
    maturing_leads: maturingLeads
  };
}

/**
 * readAdNumbers(tx, { orgId, from, to, adNumbers?, now? }) → rows, one per ad NUMBER
 *
 *   { ad_number, ads,
 *     spend_cents, impressions, link_clicks, plays, p25, thruplay, two_sec,
 *     ad_days, reported_days: { link_clicks, plays, two_sec },
 *     leads, booked, showed, sales, roadmaps,
 *     cash_cents, cash_unknown, reported_cash_cents,
 *     maturing, maturing_leads }
 *
 * from / to: Arizona days, both included. Spend by spend date, leads by lead
 * date. A number with spend and no leads reads 0 leads; a number with leads
 * and no spend in the window reads spend NULL (not reported), never $0.
 * Spend from ads that carry no number is not here — readTotals reports it as
 * unmapped. Ordered by number.
 *
 * @param {Tx} tx
 * @param {{ orgId?: string, from?: string, to?: string,
 *          adNumbers?: Array<string | number> | null, now?: Date | string }} [opts]
 */
export async function readAdNumbers(tx, { orgId, from, to, adNumbers = null, now = new Date() } = {}) {
  const who = "readAdNumbers";
  needTx(tx, who);
  needOrg(orgId, who);
  const range = needRange(from, to, who);
  const numbers = cleanNumbers(adNumbers, who);
  if (numbers && numbers.length === 0) return [];

  const r = await tx.query(
    `WITH ${leadCtes(`AND a.ad_id IS NOT NULL
     AND ($5::text[] IS NULL OR a.ad_id = ANY($5::text[]))`)},
lead_by_number AS (
  SELECT ad_number, ${LEAD_AGGREGATES}
    FROM per_lead
   GROUP BY ad_number
),
spend_by_number AS (
  SELECT a.fundhub_ad_number AS ad_number,
         count(DISTINCT a.id)::int AS ads,
         ${SPEND_AGGREGATES}
    FROM ad_metrics_daily m
    JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
   WHERE m.org_id = $1
     AND m.date BETWEEN $2::date AND $3::date
     AND a.fundhub_ad_number IS NOT NULL
     AND ($5::text[] IS NULL OR a.fundhub_ad_number = ANY($5::text[]))
   GROUP BY a.fundhub_ad_number
)
SELECT coalesce(s.ad_number, l.ad_number) AS ad_number,
       coalesce(s.ads, 0) AS ads,
       s.spend_cents, s.impressions, s.link_clicks, s.plays, s.p25, s.thruplay, s.two_sec,
       s.ad_days, s.link_click_days, s.play_days, s.two_sec_days,
       l.leads, l.booked, l.showed, l.sales, l.roadmaps,
       l.cash_cents, l.cash_unknown, l.reported_cash_cents, l.maturing_leads
  FROM spend_by_number s
  FULL JOIN lead_by_number l ON l.ad_number = s.ad_number
 ORDER BY coalesce(s.ad_number, l.ad_number)::bigint`,
    [orgId, range.from, range.to, nowIso(now), numbers]
  );

  return r.rows.map((row) => ({
    ad_number: row.ad_number,
    ads: num(row.ads) ?? 0,
    ...spendShape(row),
    ...leadShape(row)
  }));
}

/**
 * readTotals(tx, { orgId, from, to, now? }) → one object for the whole company
 *
 * The same fields as one readAdNumbers row, over EVERY lead in the window (with
 * or without an ad number) and EVERY ad-day, plus what could not be tied to a
 * number:
 *   unmapped: { spend_cents, ad_days, ads, leads }
 *     spend from ads rows with no fundhub_ad_number (the screen's Link button),
 *     and leads whose tags named no ad we can match.
 *
 * @param {Tx} tx
 * @param {{ orgId?: string, from?: string, to?: string, now?: Date | string }} [opts]
 */
export async function readTotals(tx, { orgId, from, to, now = new Date() } = {}) {
  const who = "readTotals";
  needTx(tx, who);
  needOrg(orgId, who);
  const range = needRange(from, to, who);

  const r = await tx.query(
    `WITH ${leadCtes()},
lead_total AS (
  SELECT ${LEAD_AGGREGATES},
         count(*) FILTER (WHERE ad_number IS NULL)::int AS unmapped_leads
    FROM per_lead
),
spend_total AS (
  SELECT ${SPEND_AGGREGATES},
         sum(m.spend_cents) FILTER (WHERE a.fundhub_ad_number IS NULL)::bigint AS unmapped_spend_cents,
         count(*) FILTER (WHERE a.fundhub_ad_number IS NULL)::int AS unmapped_ad_days,
         count(DISTINCT a.id) FILTER (WHERE a.fundhub_ad_number IS NULL)::int AS unmapped_ads
    FROM ad_metrics_daily m
    JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
   WHERE m.org_id = $1
     AND m.date BETWEEN $2::date AND $3::date
)
SELECT * FROM spend_total, lead_total`,
    [orgId, range.from, range.to, nowIso(now)]
  );

  const row = r.rows[0] || {};
  return {
    from: range.from,
    to: range.to,
    ...spendShape(row),
    ...leadShape(row),
    unmapped: {
      spend_cents: num(row.unmapped_spend_cents),
      ad_days: num(row.unmapped_ad_days) ?? 0,
      ads: num(row.unmapped_ads) ?? 0,
      leads: num(row.unmapped_leads) ?? 0
    }
  };
}

/**
 * readDaily(tx, { orgId, days, now? }) → one row per Arizona day, oldest first,
 * ending today (Arizona). Every day in the window is present.
 *
 *   { day, spend_cents, impressions, link_clicks, ad_days,
 *     leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents,
 *     maturing_leads }
 *
 * spend_cents is NULL on a day with no saved ad-days (not synced is not $0).
 * Leads and their results sit on the lead's own day.
 *
 * @param {Tx} tx
 * @param {{ orgId?: string, days?: number, now?: Date | string }} [opts]
 */
export async function readDaily(tx, { orgId, days, now = new Date() } = {}) {
  const who = "readDaily";
  needTx(tx, who);
  needOrg(orgId, who);
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > MAX_DAYS) {
    throw new RangeError(`${who}: days must be a whole number from 1 to ${MAX_DAYS}`);
  }
  const stamp = nowIso(now);
  const to = adAccountDay(new Date(stamp));
  const from = addDays(to, -(n - 1));

  const r = await tx.query(
    `WITH ${leadCtes()},
lead_by_day AS (
  SELECT lead_day, ${LEAD_AGGREGATES}
    FROM per_lead
   GROUP BY lead_day
),
spend_by_day AS (
  SELECT m.date AS day,
         sum(m.spend_cents)::bigint AS spend_cents,
         sum(m.impressions)::bigint AS impressions,
         sum(m.link_clicks)::bigint AS link_clicks,
         count(*)::int AS ad_days
    FROM ad_metrics_daily m
   WHERE m.org_id = $1
     AND m.date BETWEEN $2::date AND $3::date
   GROUP BY m.date
)
SELECT to_char(g.day, 'YYYY-MM-DD') AS day,
       s.spend_cents, s.impressions, s.link_clicks, coalesce(s.ad_days, 0) AS ad_days,
       l.leads, l.booked, l.showed, l.sales, l.roadmaps,
       l.cash_cents, l.cash_unknown, l.reported_cash_cents, l.maturing_leads
  FROM generate_series($2::date, $3::date, interval '1 day') AS g(day)
  LEFT JOIN spend_by_day s ON s.day = g.day::date
  LEFT JOIN lead_by_day l ON l.lead_day = g.day::date
 ORDER BY g.day`,
    [orgId, from, to, stamp]
  );

  return r.rows.map((row) => {
    const lead = leadShape(row);
    return {
      day: row.day,
      spend_cents: num(row.spend_cents),
      impressions: num(row.impressions),
      link_clicks: num(row.link_clicks),
      ad_days: num(row.ad_days) ?? 0,
      leads: lead.leads,
      booked: lead.booked,
      showed: lead.showed,
      sales: lead.sales,
      roadmaps: lead.roadmaps,
      cash_cents: lead.cash_cents,
      cash_unknown: lead.cash_unknown,
      reported_cash_cents: lead.reported_cash_cents,
      maturing_leads: lead.maturing_leads
    };
  });
}

/**
 * readFunnelEvents(tx, { orgId, from, to }) → rows
 *
 *   { name, event, page, funnel, step, ad_number, events, sessions }
 *
 * events rows named funnel.page, funnel.click and funnel.<event>
 * (src/funnel/track.mjs:281-283) from REAL PEOPLE only
 * (payload->>'actor' = 'person'), by the event's own Arizona day, demo rows
 * out. Grouped by event name, page and ad number.
 *
 * funnel and step come from the page through src/funnel/pages.mjs, the same
 * map the tracker writes with — rows saved before 2026-10-02 carry a page but
 * no funnel or step. A page that is not on the map reads funnel/step null.
 *
 * ad_number is worked out from the visit's own tags the way 407 does for a
 * lead: the leading digits of utm_content first, else the Meta match
 * (fundhub_meta_ad_number: ad set id in utm_term + exact ad name in
 * utm_content). NULL when the tags name no ad we can match.
 *
 * @param {Tx} tx
 * @param {{ orgId?: string, from?: string, to?: string }} [opts]
 */
export async function readFunnelEvents(tx, { orgId, from, to } = {}) {
  const who = "readFunnelEvents";
  needTx(tx, who);
  needOrg(orgId, who);
  const range = needRange(from, to, who);

  const r = await tx.query(
    `WITH ev AS (
  SELECT e.name,
         -- normalizePage (src/funnel/pages.mjs) in SQL: trim, 60 characters,
         -- lower case, no trailing slash.
         nullif(regexp_replace(lower(left(btrim(e.payload->>'page'), 60)), '/+$', ''), '') AS page,
         e.payload->>'session_id' AS session_id,
         nullif(btrim(e.payload->'attribution'->>'utm_content'), '') AS utm_content,
         nullif(btrim(e.payload->'attribution'->>'utm_term'), '') AS utm_term
    FROM events e
   WHERE e.org_id = $1
     AND e.name LIKE 'funnel.%'
     AND e.payload->>'actor' = 'person'
     AND e.is_demo IS NOT TRUE
     AND (e.created_at AT TIME ZONE '${TZ}')::date BETWEEN $2::date AND $3::date
),
tags AS (
  SELECT DISTINCT utm_content, utm_term FROM ev
),
resolved AS (
  SELECT utm_content, utm_term,
         coalesce(fundhub_ad_id(utm_content),
                  fundhub_meta_ad_number($1::uuid, utm_term, utm_content)) AS ad_number
    FROM tags
)
SELECT ev.name, ev.page, r.ad_number,
       count(*)::int AS events,
       count(DISTINCT ev.session_id)::int AS sessions
  FROM ev
  LEFT JOIN resolved r
         ON r.utm_content IS NOT DISTINCT FROM ev.utm_content
        AND r.utm_term IS NOT DISTINCT FROM ev.utm_term
 GROUP BY ev.name, ev.page, r.ad_number
 ORDER BY ev.name, ev.page, r.ad_number NULLS LAST`,
    [orgId, range.from, range.to]
  );

  return r.rows.map((row) => {
    const where = row.page ? funnelFor(row.page) : null;
    return {
      name: row.name,
      event: String(row.name).replace(/^funnel\./, ""),
      page: row.page ?? null,
      funnel: where?.funnel ?? null,
      step: where?.step ?? null,
      ad_number: row.ad_number ?? null,
      events: num(row.events) ?? 0,
      sessions: num(row.sessions) ?? 0
    };
  });
}
