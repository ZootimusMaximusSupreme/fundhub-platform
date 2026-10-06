// @ts-check
// src/marketing/metrics-rollups.mjs — the marketing numbers rolled up by FUNNEL
// and by ANGLE, the funnel page steps, and the two "waiting on Chris" counts
// the Today tab shows (scripts waiting, stuck jobs).
//
// Spec: docs/specs/marketing-machine-2026-10-04.md §11.2 (angles, funnels/stats,
// "marketing/today uses these too") and §8.3 (Today). Plan unit U32. The number
// rules themselves are U20's (src/marketing/metrics.mjs, words in
// docs/marketing/metrics.md); nothing here re-decides what a lead, a booked
// call or cash is. This file only decides WHICH FUNNEL and WHICH ANGLE a number
// belongs to, and adds the per-number results up.
//
// WHO CALLS IT
//   api/marketing/angles.mjs         byAngle
//   api/marketing/funnels/stats.mjs  funnelStats
//   api/marketing/today.mjs          spendByFunnel, flowPageViews, funnelSteps,
//                                    readScriptsWaiting, readStuckJobs, numbersFor
// Every SQL reader takes the `tx` the caller opened with asStaff()
// (src/partners/rls.mjs): ads, campaigns, ad_scripts and ad_metrics_daily FORCE
// partner row security, and a bare query reads as "nothing", which looks like a
// fact and is a lie.
//
// WHICH FUNNEL (plan U32 contract, in this order):
//   1. the ad NUMBER's live script (ad_scripts.ad_id, archived_at NULL) names a
//      funnel_key → that funnel;
//   2. else the Meta campaign the ads row sits in is on a funnel's
//      meta_campaign_ids (Chris maps these in Settings) → that funnel;
//   3. else the spend is UNMAPPED and shows as its own bucket.
//   Spend is placed per ads row (each row's own campaign). Leads are placed per
//   NUMBER (client_ad_attribution carries the number, not the ads row): the
//   script's funnel, else the one funnel all of the number's ads rows map to.
//   A number whose ads sit on two different funnels' campaigns is ambiguous; its
//   leads stay unplaced rather than guessed.
//
// WHICH ANGLE: the number's live script's angle_key first, else the label the
// ads row inherits through v_ad_label_spine (ads → creative_assets → the
// creative's script, 377). Names come from marketing/ads/angles.json; an angle
// key that is not in that file shows its key as its name.
//
// NULL MEANS UNKNOWN, NEVER 0 (the U20 rules, carried through the sums):
//   - spend with no saved ad-day behind it is null. A funnel with no mapped
//     ad-day is null unless every saved ad-day in the window is placed on some
//     funnel, in which case it is a known 0.
//   - cash adds the per-number cash the U20 way: null only when payments exist
//     and none of them reported an amount.
//   - a ratio with an unknown side or a bottom of 0 is null (metrics.mjs).
//
// ARIZONA DAYS: windows are whole America/Phoenix days (src/lib/ad-account-day.mjs).
// Events are cut at Arizona midnight with constant timestamps, so the events
// index (org_id, name, created_at) does the work.
//
// Every query starts with a `-- m5:<name>` line. The pg tests EXPLAIN exactly
// these, and the database-free Today test recognises them by it.

import fs from "node:fs";
import path from "node:path";
import { adAccountDay, AD_ACCOUNT_TZ } from "../lib/ad-account-day.mjs";
import { addDays } from "../metro2/dates.mjs";
import { FUNNEL_PAGES, funnelFor, normalizePage } from "../funnel/pages.mjs";
import { TRACK_EVENTS, trackEventName } from "../funnel/track.mjs";
import { readAdNumbers, roas, clickToPage, pageToLead } from "./metrics.mjs";
import { listFunnels } from "./settings-store.mjs";
import { candidateRoots } from "./flywheel-status.mjs";
import { OFFER_KIND } from "./jobs.mjs";

/** Angles and funnels/stats read the last 30 Arizona days, today included. */
export const ROLLUP_DAYS = 30;
/** Today's "Unmapped" row in spend_by_funnel. */
export const UNMAPPED_NAME = "Unmapped";
/** At most this many stuck jobs come back on Today. */
export const STUCK_JOBS_LIMIT = 20;
/** Where the angle names live (bundled with every function, netlify.toml included_files). */
export const ANGLES_FILE = "marketing/ads/angles.json";
/** Every events row name the funnel tracker writes (src/funnel/track.mjs). */
export const FUNNEL_EVENT_NAMES = Object.freeze([
  ...new Set(Object.keys(TRACK_EVENTS).map((e) => trackEventName(e)))
]);

const TZ = AD_ACCOUNT_TZ; // a constant, never user input — safe in SQL text

/** A transaction from asStaff(): anything with a pg-style query().
    @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }} Tx */

/** @typedef {{ ad_row_id: string, ad_number: string | null, spine_angle_key: string | null,
               campaign_external_id: string | null, campaign_funnel_key: string | null }} AdLabelRow */
/** @typedef {{ ad_number: string, funnel_key: string | null, angle_key: string | null }} ScriptLabelRow */
/** @typedef {{ ad_row_id: string, spend_cents: number | null, link_clicks: number | null,
               ad_days: number, link_click_days: number }} AdSpendRow */
/** @typedef {{ ad_number: string | null, funnel_key: string | null, angle_key: string | null }} AdLabel */
/** @typedef {{ funnel_key: string | null, angle_key: string | null }} NumberLabel */
/** @typedef {{ byAd: Map<string, AdLabel>, byNumber: Map<string, NumberLabel> }} Labels */
/** @typedef {{ spend_cents: number | null, link_clicks: number | null, ad_days: number }} SpendSum */
/** @typedef {{ key: string, name?: string | null, landing_url?: string | null, active?: boolean }} FunnelRow */
/** @typedef {{ page: string, funnel: string | null, step: number | null, page_views: number,
               clicks: number, events: Record<string, number> }} StepRow */

// ═══════════════════════════════════════════════════════════════════════════
// 1. SMALL PURE HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/* pg hands back bigint and numeric as strings. A count stays a number; NULL
   stays null. */
/** @param {unknown} v @returns {number | null} */
const num = (v) => (v === null || v === undefined ? null : Number(v));

/** a + b where b may be unknown: unknown adds nothing, and unknown + unknown stays unknown.
    @param {number | null} a @param {unknown} b @returns {number | null} */
function addKnown(a, b) {
  const n = num(b);
  if (n === null || !Number.isFinite(n)) return a;
  return (a ?? 0) + n;
}

/** @param {any[]} rows @param {string} key @returns {number} */
const sumCount = (rows, key) => rows.reduce((t, r) => t + (Number(r[key]) || 0), 0);

/**
 * Cash over several ad numbers, by U20's rule: null only when payments exist and
 * NONE of them reported an amount. A number's cash_cents is null exactly then
 * (src/marketing/metrics.mjs LEAD_AGGREGATES); 0 means no payments.
 * @param {Array<{ cash_cents?: number | string | null }>} rows
 * @returns {number | null}
 */
export function sumCash(rows = []) {
  let total = 0;
  let anyMoney = false;
  let anyUnknown = false;
  for (const r of rows) {
    const c = num(r.cash_cents);
    if (c === null) { anyUnknown = true; continue; }
    total += c;
    if (c > 0) anyMoney = true;
  }
  return anyUnknown && !anyMoney ? null : total;
}

/** from / to: the last `days` Arizona days ending today, both included.
    @param {number} days @param {Date} [now] */
export function lastDays(days, now = new Date()) {
  const to = adAccountDay(now);
  return { from: addDays(to, -(days - 1)), to };
}

/**
 * The page a funnel's landing_url lands on, in the tracker's form ("/watch"),
 * or null when it is not a fundhub.ai page. fundhub.ai/ itself is "/home", the
 * name the browser tracker sends there (src/funnel/pages.mjs).
 * @param {unknown} url
 * @returns {string | null}
 */
export function landingPage(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== "fundhub.ai" && !host.endsWith(".fundhub.ai")) return null;
  let page = normalizePage(u.pathname);
  if (page === "" && (host === "fundhub.ai" || host === "www.fundhub.ai")) page = "/home";
  return page || null;
}

/** Biggest spend first; unknown spend after every known one; then by key.
    @param {{ spend_cents: number | null, key: string }} a
    @param {{ spend_cents: number | null, key: string }} b */
function bySpendThenKey(a, b) {
  if (a.spend_cents !== b.spend_cents) {
    if (a.spend_cents === null) return 1;
    if (b.spend_cents === null) return -1;
    return b.spend_cents - a.spend_cents;
  }
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LABELS: WHICH FUNNEL, WHICH ANGLE
// ═══════════════════════════════════════════════════════════════════════════

/** @param {Set<string> | undefined} set @returns {string | null} */
const onlyOne = (set) => (set && set.size === 1 ? [...set][0] : null);

/**
 * resolveLabels(adRows, scriptRows) → { byAd, byNumber }
 *
 *   byAd      ads.id → { ad_number, funnel_key, angle_key }   (for spend)
 *   byNumber  ad number → { funnel_key, angle_key }            (for leads)
 *
 * The number's live script wins. Without one, an ads row uses its own campaign's
 * funnel and its own spine angle; a number uses the funnel / angle all of its ads
 * rows agree on, else null (never a guess between two).
 *
 * @param {AdLabelRow[]} [adRows]
 * @param {ScriptLabelRow[]} [scriptRows]
 * @returns {Labels}
 */
export function resolveLabels(adRows = [], scriptRows = []) {
  /** @type {Map<string, NumberLabel>} */
  const script = new Map();
  for (const s of scriptRows) {
    if (!s || s.ad_number == null) continue;
    script.set(String(s.ad_number), { funnel_key: s.funnel_key ?? null, angle_key: s.angle_key ?? null });
  }

  /** @type {Map<string, AdLabel>} */
  const byAd = new Map();
  /** @type {Map<string, { funnels: Set<string>, angles: Set<string> }>} */
  const seen = new Map();
  for (const a of adRows) {
    const n = a.ad_number == null ? null : String(a.ad_number);
    const s = n ? script.get(n) : undefined;
    byAd.set(String(a.ad_row_id), {
      ad_number: n,
      funnel_key: s?.funnel_key ?? a.campaign_funnel_key ?? null,
      angle_key: s?.angle_key ?? a.spine_angle_key ?? null
    });
    if (n) {
      const p = seen.get(n) ?? { funnels: new Set(), angles: new Set() };
      if (a.campaign_funnel_key) p.funnels.add(a.campaign_funnel_key);
      if (a.spine_angle_key) p.angles.add(a.spine_angle_key);
      seen.set(n, p);
    }
  }

  /** @type {Map<string, NumberLabel>} */
  const byNumber = new Map();
  for (const n of new Set([...script.keys(), ...seen.keys()])) {
    const s = script.get(n);
    const p = seen.get(n);
    byNumber.set(n, {
      funnel_key: s?.funnel_key ?? onlyOne(p?.funnels),
      angle_key: s?.angle_key ?? onlyOne(p?.angles)
    });
  }
  return { byAd, byNumber };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE FOLDS (pure — every exact number in the tests comes through these)
// ═══════════════════════════════════════════════════════════════════════════

/** @returns {SpendSum} */
const emptySpend = () => ({ spend_cents: null, link_clicks: null, ad_days: 0 });

/**
 * foldSpendByFunnel({ byAd, spend }) → { byFunnel, unmapped, total_ad_days }
 * Each ads row's spend goes to its funnel, or to `unmapped`.
 * @param {{ byAd: Map<string, AdLabel>, spend?: AdSpendRow[] }} args
 */
export function foldSpendByFunnel({ byAd, spend = [] }) {
  /** @type {Map<string, SpendSum>} */
  const byFunnel = new Map();
  const unmapped = emptySpend();
  let totalAdDays = 0;
  for (const s of spend) {
    const days = Number(s.ad_days) || 0;
    if (days === 0) continue;
    totalAdDays += days;
    const key = byAd.get(String(s.ad_row_id))?.funnel_key ?? null;
    let target = unmapped;
    if (key) {
      target = byFunnel.get(key) ?? emptySpend();
      byFunnel.set(key, target);
    }
    target.spend_cents = addKnown(target.spend_cents, s.spend_cents);
    target.link_clicks = addKnown(target.link_clicks, s.link_clicks);
    target.ad_days += days;
  }
  return { byFunnel, unmapped, total_ad_days: totalAdDays };
}

/**
 * funnelSpendRows({ byAd, spend, funnels }) → { rows, unmapped }
 *
 * rows: one per active funnel, plus any other funnel key that has spend placed
 * on it. A funnel with no placed ad-day reads spend null — or a known 0 when
 * every saved ad-day in the window was placed somewhere else.
 * unmapped: the spend no funnel claims. spend_cents is null when the window has
 * no saved ad-day at all, else a known amount (0 when everything is placed).
 *
 * @param {{ byAd: Map<string, AdLabel>, spend?: AdSpendRow[], funnels?: FunnelRow[] }} args
 */
export function funnelSpendRows({ byAd, spend = [], funnels = [] }) {
  const { byFunnel, unmapped, total_ad_days } = foldSpendByFunnel({ byAd, spend });
  const allPlaced = total_ad_days > 0 && unmapped.ad_days === 0;
  const known = new Map(funnels.map((f) => [f.key, f]));
  const keys = new Set([
    ...funnels.filter((f) => f.active !== false).map((f) => f.key),
    ...byFunnel.keys()
  ]);
  const rows = [...keys].map((key) => {
    const s = byFunnel.get(key) ?? emptySpend();
    return {
      key,
      funnel_key: key,
      name: known.get(key)?.name ?? key,
      spend_cents: s.ad_days > 0 ? s.spend_cents : (allPlaced ? 0 : null),
      link_clicks: s.link_clicks,
      ad_days: s.ad_days
    };
  }).sort(bySpendThenKey);
  return {
    rows,
    unmapped: {
      spend_cents: total_ad_days === 0 ? null : (unmapped.ad_days > 0 ? unmapped.spend_cents : 0),
      link_clicks: unmapped.link_clicks,
      ad_days: unmapped.ad_days
    },
    total_ad_days
  };
}

/**
 * spendByFunnelView(rollup) → Today's spend_by_funnel list:
 * [{funnel_key, name, spend_cents}], plus one {funnel_key: null, name: "Unmapped"}
 * row when some saved spend belongs to no funnel.
 * @param {ReturnType<typeof funnelSpendRows>} rollup
 */
export function spendByFunnelView(rollup) {
  const out = rollup.rows.map((r) => ({ funnel_key: r.funnel_key, name: r.name, spend_cents: r.spend_cents }));
  if (rollup.unmapped.ad_days > 0) {
    out.push({ funnel_key: null, name: UNMAPPED_NAME, spend_cents: rollup.unmapped.spend_cents });
  }
  return out;
}

/**
 * angleRows({ byAd, byNumber, spend, leads, angleNames }) → the GET marketing/angles rows
 *
 *   {angle_key, name, spend_cents, ads, leads, booked, sales, cash_cents, roas}
 *
 * One row per angle that had spend or leads in the window. `ads` counts the
 * distinct ad numbers (an ads row with no number counts on its own). Spend and
 * ads rows with no angle, and leads whose number has no angle, are not in any row.
 *
 * @param {Labels & { spend?: AdSpendRow[], leads?: any[], angleNames?: Map<string, string> }} args
 */
export function angleRows({ byAd, byNumber, spend = [], leads = [], angleNames = new Map() }) {
  /** @type {Map<string, { spend_cents: number | null, ads: Set<string>, leadRows: any[] }>} */
  const acc = new Map();
  /** @param {string} key */
  const slot = (key) => {
    let a = acc.get(key);
    if (!a) { a = { spend_cents: null, ads: new Set(), leadRows: [] }; acc.set(key, a); }
    return a;
  };

  for (const s of spend) {
    if (!(Number(s.ad_days) > 0)) continue;
    const label = byAd.get(String(s.ad_row_id));
    if (!label || !label.angle_key) continue;
    const a = slot(label.angle_key);
    a.spend_cents = addKnown(a.spend_cents, s.spend_cents);
    a.ads.add(label.ad_number ?? `row:${s.ad_row_id}`);
  }
  for (const l of leads) {
    if (l.ad_number == null || !(Number(l.leads) > 0)) continue;
    const label = byNumber.get(String(l.ad_number));
    if (!label || !label.angle_key) continue;
    const a = slot(label.angle_key);
    a.leadRows.push(l);
    a.ads.add(String(l.ad_number));
  }

  return [...acc].map(([key, a]) => {
    const cash = a.leadRows.length ? sumCash(a.leadRows) : 0;
    return {
      key,
      angle_key: key,
      name: angleNames.get(key) ?? key,
      spend_cents: a.spend_cents,
      ads: a.ads.size,
      leads: sumCount(a.leadRows, "leads"),
      booked: sumCount(a.leadRows, "booked"),
      sales: sumCount(a.leadRows, "sales"),
      cash_cents: cash,
      roas: roas({ cash_cents: cash, spend_cents: a.spend_cents })
    };
  }).sort(bySpendThenKey).map(({ key, ...row }) => row);
}

/** @param {StepRow[]} steps @returns {Map<string, StepRow>} */
const stepsByPage = (steps = []) => new Map(steps.map((s) => [s.page, s]));

/**
 * The people who opened a funnel's landing page. null when the landing page is
 * not one the tracker runs on (we cannot know), else a count (0 is a real 0).
 * @param {unknown} landingUrl @param {Map<string, StepRow>} byPage
 * @returns {number | null}
 */
function landingViews(landingUrl, byPage) {
  const page = landingPage(landingUrl);
  if (!page || !FUNNEL_PAGES.has(page)) return null;
  return byPage.get(page)?.page_views ?? 0;
}

/**
 * flowPageViews(funnels, steps) → Today's flow.page_views: page views of every
 * funnel's landing page (each page once), or null when no funnel lands on a
 * tracked page.
 * @param {FunnelRow[]} [funnels] @param {StepRow[]} [steps]
 * @returns {number | null}
 */
export function flowPageViews(funnels = [], steps = []) {
  const byPage = stepsByPage(steps);
  const pages = new Set();
  for (const f of funnels) {
    const page = landingPage(f.landing_url);
    if (page && FUNNEL_PAGES.has(page)) pages.add(page);
  }
  if (pages.size === 0) return null;
  let total = 0;
  for (const p of pages) total += byPage.get(p)?.page_views ?? 0;
  return total;
}

/**
 * funnelStatRows({ byAd, byNumber, spend, leads, funnels, steps })
 *   → { rows, unmapped_spend_cents }   (GET marketing/funnels/stats)
 *
 *   rows: {funnel_key, name, spend_cents, page_views, click_to_page, page_to_lead,
 *          leads, booked, showed, sales, cash_cents, roas}
 *
 * page_views = people who opened the funnel's landing page (funnel.page from a
 * person). click_to_page = page views ÷ the funnel's ads' link clicks;
 * page_to_lead = the funnel's leads ÷ page views.
 *
 * @param {Labels & { spend?: AdSpendRow[], leads?: any[], funnels?: FunnelRow[], steps?: StepRow[] }} args
 */
export function funnelStatRows({ byAd, byNumber, spend = [], leads = [], funnels = [], steps = [] }) {
  const money = funnelSpendRows({ byAd, spend, funnels });
  /** @type {Map<string, any[]>} */
  const leadRows = new Map();
  for (const l of leads) {
    if (l.ad_number == null || !(Number(l.leads) > 0)) continue;
    const key = byNumber.get(String(l.ad_number))?.funnel_key ?? null;
    if (!key) continue;
    const list = leadRows.get(key) ?? [];
    list.push(l);
    leadRows.set(key, list);
  }

  const known = new Map(funnels.map((f) => [f.key, f]));
  const spendRows = new Map(money.rows.map((r) => [r.funnel_key, r]));
  const allPlaced = money.total_ad_days > 0 && money.unmapped.ad_days === 0;
  const byPage = stepsByPage(steps);
  const keys = new Set([...spendRows.keys(), ...leadRows.keys()]);

  const rows = [...keys].map((key) => {
    const s = spendRows.get(key);
    const l = leadRows.get(key) ?? [];
    const spendCents = s ? s.spend_cents : (allPlaced ? 0 : null);
    const linkClicks = s ? s.link_clicks : null;
    const pageViews = landingViews(known.get(key)?.landing_url, byPage);
    const leadCount = sumCount(l, "leads");
    const cash = l.length ? sumCash(l) : 0;
    return {
      key,
      funnel_key: key,
      name: known.get(key)?.name ?? key,
      spend_cents: spendCents,
      page_views: pageViews,
      click_to_page: clickToPage({ page_views: pageViews, link_clicks: linkClicks }),
      page_to_lead: pageToLead({ leads: leadCount, page_views: pageViews }),
      leads: leadCount,
      booked: sumCount(l, "booked"),
      showed: sumCount(l, "showed"),
      sales: sumCount(l, "sales"),
      cash_cents: cash,
      roas: roas({ cash_cents: cash, spend_cents: spendCents })
    };
  }).sort(bySpendThenKey).map(({ key, ...row }) => row);

  return { rows, unmapped_spend_cents: money.unmapped.spend_cents };
}

/**
 * numbersFor(totals) → one Today money block from readTotals():
 * {spend_cents, leads, booked, showed, sales, roadmaps, cash_cents, reported_cash_cents, roas}
 * @param {any} t
 */
export function numbersFor(t) {
  return {
    spend_cents: num(t.spend_cents),
    leads: num(t.leads) ?? 0,
    booked: num(t.booked) ?? 0,
    showed: num(t.showed) ?? 0,
    sales: num(t.sales) ?? 0,
    roadmaps: num(t.roadmaps) ?? 0,
    cash_cents: num(t.cash_cents),
    reported_cash_cents: num(t.reported_cash_cents),
    roas: roas({ cash_cents: t.cash_cents, spend_cents: t.spend_cents })
  };
}

/**
 * stepRows(rows) → one row per page, oldest funnel step first:
 * {page, funnel, step, page_views, clicks, events: {<event>: count}}
 * @param {Array<{ page: string | null, name: string, events: number | string }>} rows
 * @returns {StepRow[]}
 */
export function stepRows(rows = []) {
  /** @type {Map<string, StepRow>} */
  const byPage = new Map();
  for (const r of rows) {
    if (!r.page) continue;
    let p = byPage.get(r.page);
    if (!p) {
      const where = funnelFor(r.page);
      p = { page: r.page, funnel: where?.funnel ?? null, step: where?.step ?? null, page_views: 0, clicks: 0, events: {} };
      byPage.set(r.page, p);
    }
    const n = Number(r.events) || 0;
    const ev = String(r.name).replace(/^funnel\./, "");
    if (ev === "page") p.page_views += n;
    else if (ev === "click") p.clicks += n;
    else p.events[ev] = (p.events[ev] ?? 0) + n;
  }
  return [...byPage.values()].sort((a, b) =>
    String(a.funnel ?? "~").localeCompare(String(b.funnel ?? "~")) ||
    (a.step ?? 99) - (b.step ?? 99) ||
    a.page.localeCompare(b.page));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. ANGLE NAMES (marketing/ads/angles.json)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * parseAngleNames(text) → Map key → name. A file that is not a list of
 * {key, name} gives an empty map: names fall back to keys, never a crash.
 * @param {string} text
 * @returns {Map<string, string>}
 */
export function parseAngleNames(text) {
  /** @type {Map<string, string>} */
  const out = new Map();
  let list;
  try { list = JSON.parse(text); } catch { return out; }
  if (!Array.isArray(list)) return out;
  for (const a of list) {
    if (a && typeof a.key === "string" && typeof a.name === "string" && a.name.trim()) out.set(a.key, a.name);
  }
  return out;
}

/**
 * loadAngleNames() → Map key → name from the first copy of angles.json found
 * (the repo locally, the bundled copy on Netlify). Empty map when none is found.
 * @param {string[]} [roots]
 */
export function loadAngleNames(roots = candidateRoots()) {
  for (const root of roots) {
    let text;
    try { text = fs.readFileSync(path.join(root, ANGLES_FILE), "utf8"); } catch { continue; }
    return parseAngleNames(text);
  }
  return new Map();
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE SQL READERS (each one query, each in the caller's asStaff() tx)
// ═══════════════════════════════════════════════════════════════════════════

/** @param {any} tx @param {string} who @returns {asserts tx is Tx} */
function needTx(tx, who) {
  if (!tx || typeof tx.query !== "function") {
    throw new TypeError(`${who}: pass the tx from asStaff() — ads, campaigns, ad_scripts and ad_metrics_daily FORCE row-level security`);
  }
}

/** @param {unknown} orgId @param {string} who @returns {asserts orgId is string} */
function needOrg(orgId, who) {
  if (!orgId || typeof orgId !== "string") throw new TypeError(`${who}: orgId is required`);
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** @param {unknown} from @param {unknown} to @param {string} who */
function needRange(from, to, who) {
  if (typeof from !== "string" || typeof to !== "string" || !ISO_DAY.test(from) || !ISO_DAY.test(to) || from > to) {
    throw new TypeError(`${who}: from and to must be YYYY-MM-DD Arizona days, from not after to`);
  }
}

/**
 * readAdLabels(tx, { orgId }) → every ads row of the company with its number, the
 * angle its creative's script carries (v_ad_label_spine), its campaign's Meta id
 * and the funnel that campaign is mapped to.
 * @param {Tx} tx @param {{ orgId?: string }} [opts]
 * @returns {Promise<AdLabelRow[]>}
 */
export async function readAdLabels(tx, { orgId } = {}) {
  needTx(tx, "readAdLabels");
  needOrg(orgId, "readAdLabels");
  const r = await tx.query(
    `-- m5:ad_labels
SELECT v.ad_row_id,
       v.fundhub_ad_number AS ad_number,
       v.angle_key         AS spine_angle_key,
       c.external_id       AS campaign_external_id,
       f.key               AS campaign_funnel_key
  FROM v_ad_label_spine v
  JOIN ads a ON a.id = v.ad_row_id
  LEFT JOIN campaigns c ON c.id = a.campaign_id
  LEFT JOIN LATERAL (
         SELECT mf.key
           FROM marketing_funnels mf
          WHERE mf.org_id = a.org_id
            AND c.external_id IS NOT NULL
            AND c.external_id = ANY (mf.meta_campaign_ids)
          ORDER BY mf.active DESC, mf.key
          LIMIT 1
       ) f ON true
 WHERE v.org_id = $1
 ORDER BY v.ad_row_id`,
    [orgId]
  );
  return r.rows.map((row) => ({
    ad_row_id: String(row.ad_row_id),
    ad_number: row.ad_number ?? null,
    spine_angle_key: row.spine_angle_key ?? null,
    campaign_external_id: row.campaign_external_id ?? null,
    campaign_funnel_key: row.campaign_funnel_key ?? null
  }));
}

/**
 * readScriptLabels(tx, { orgId, adNumbers }) → the live script (archived_at NULL)
 * of each ad number, with the funnel and angle it names. One live script per
 * number per company (ad_scripts_live_ad_id_uq, 393).
 * @param {Tx} tx @param {{ orgId?: string, adNumbers?: Array<string | null | undefined> }} [opts]
 * @returns {Promise<ScriptLabelRow[]>}
 */
export async function readScriptLabels(tx, { orgId, adNumbers = [] } = {}) {
  needTx(tx, "readScriptLabels");
  needOrg(orgId, "readScriptLabels");
  const numbers = [...new Set(adNumbers.filter((n) => n != null && n !== "").map(String))];
  if (numbers.length === 0) return [];
  const r = await tx.query(
    `-- m5:script_labels
SELECT s.ad_id AS ad_number, s.funnel_key, s.angle_key
  FROM ad_scripts s
 WHERE s.org_id = $1
   AND s.ad_id IS NOT NULL
   AND s.archived_at IS NULL
   AND s.ad_id = ANY ($2::text[])`,
    [orgId, numbers]
  );
  return r.rows.map((row) => ({
    ad_number: String(row.ad_number),
    funnel_key: row.funnel_key ?? null,
    angle_key: row.angle_key ?? null
  }));
}

/**
 * readAdSpend(tx, { orgId, from, to }) → spend per ads row over Arizona days
 * from..to (Meta's spend day). Only rows with at least one saved ad-day.
 * Walks ads, then ad_metrics_daily by (ad_id, date) — the unique index.
 * @param {Tx} tx @param {{ orgId?: string, from?: string, to?: string }} [opts]
 * @returns {Promise<AdSpendRow[]>}
 */
export async function readAdSpend(tx, { orgId, from, to } = {}) {
  needTx(tx, "readAdSpend");
  needOrg(orgId, "readAdSpend");
  needRange(from, to, "readAdSpend");
  const r = await tx.query(
    `-- m5:ad_spend
SELECT a.id                         AS ad_row_id,
       sum(m.spend_cents)::bigint   AS spend_cents,
       sum(m.link_clicks)::bigint   AS link_clicks,
       count(*)::int                AS ad_days,
       count(m.link_clicks)::int    AS link_click_days
  FROM ads a
  JOIN ad_metrics_daily m ON m.ad_id = a.id
 WHERE a.org_id = $1
   AND m.org_id = $1
   AND m.date BETWEEN $2::date AND $3::date
 GROUP BY a.id
 ORDER BY a.id`,
    [orgId, from, to]
  );
  return r.rows.map((row) => ({
    ad_row_id: String(row.ad_row_id),
    spend_cents: num(row.spend_cents),
    link_clicks: num(row.link_clicks),
    ad_days: num(row.ad_days) ?? 0,
    link_click_days: num(row.link_click_days) ?? 0
  }));
}

/**
 * funnelSteps(tx, { orgId, from, to }) → one row per page:
 * {page, funnel, step, page_views, clicks, events: {<event>: count}}
 *
 * events rows named funnel.page / funnel.click / funnel.<event>
 * (src/funnel/track.mjs) from REAL PEOPLE (payload->>'actor' = 'person'), demo
 * rows out, by the event's Arizona day. funnel and step come from the page map
 * (src/funnel/pages.mjs); a page not on the map reads them null.
 * @param {Tx} tx @param {{ orgId?: string, from?: string, to?: string }} [opts]
 * @returns {Promise<StepRow[]>}
 */
export async function funnelSteps(tx, { orgId, from, to } = {}) {
  needTx(tx, "funnelSteps");
  needOrg(orgId, "funnelSteps");
  needRange(from, to, "funnelSteps");
  const r = await tx.query(
    `-- m5:funnel_steps
SELECT nullif(regexp_replace(lower(left(btrim(e.payload->>'page'), 60)), '/+$', ''), '') AS page,
       e.name,
       count(*)::int AS events
  FROM events e
 WHERE e.org_id = $1
   AND e.name = ANY ($4::text[])
   AND e.created_at >= ($2::date::timestamp AT TIME ZONE '${TZ}')
   AND e.created_at <  (($3::date + 1)::timestamp AT TIME ZONE '${TZ}')
   AND e.payload->>'actor' = 'person'
   AND e.is_demo IS NOT TRUE
 GROUP BY 1, 2`,
    [orgId, from, to, [...FUNNEL_EVENT_NAMES]]
  );
  return stepRows(r.rows);
}

/**
 * readScriptsWaiting(tx, { orgId, now }) → { ready, flagged }
 *
 * ready: drafts Chris can see and has not decided — status draft, live
 * (archived_at NULL), not an import, and either in no batch or in a batch that
 * is released with its release_at passed (spec §7.7; the same rule as
 * U25's VISIBLE_SQL). flagged: those of them the machine wrote that still failed
 * a check ("needs a look", spec §7.6): check_results.flagged = true, or any check
 * section with passed = false (U25's isFlagged).
 * @param {Tx} tx @param {{ orgId?: string, now?: Date | string }} [opts]
 */
export async function readScriptsWaiting(tx, { orgId, now = new Date() } = {}) {
  needTx(tx, "readScriptsWaiting");
  needOrg(orgId, "readScriptsWaiting");
  const stamp = new Date(now).toISOString();
  const r = await tx.query(
    `-- m5:scripts_waiting
SELECT count(*)::int AS ready,
       count(*) FILTER (
         WHERE s.source = 'machine'
           AND jsonb_typeof(s.check_results) = 'object'
           AND (s.check_results->'flagged' = 'true'::jsonb
                OR EXISTS (SELECT 1 FROM jsonb_each(s.check_results) c
                            WHERE jsonb_typeof(c.value) = 'object'
                              AND c.value->'passed' = 'false'::jsonb))
       )::int AS flagged
  FROM ad_scripts s
  LEFT JOIN marketing_batches b ON b.id = s.batch_id
 WHERE s.org_id = $1
   AND s.status = 'draft'
   AND s.archived_at IS NULL
   AND s.source <> 'import'
   AND (s.batch_id IS NULL OR (b.status = 'released' AND b.release_at <= $2::timestamptz))`,
    [orgId, stamp]
  );
  const row = r.rows[0] || {};
  return { ready: num(row.ready) ?? 0, flagged: num(row.flagged) ?? 0 };
}

/**
 * readStuckJobs(tx, { orgId, limit }) → [{id, kind, error, since}]
 *
 * Failed marketing_jobs of the company, newest failure first, each with its id
 * so the Retry button can post marketing/jobs/retry. error is the plain reason
 * the worker saved (409 refuses a failed row with no reason); since is when it
 * failed. 'offer' rows are left out: they run on the Write offer button's own
 * path and Retry refuses them (src/marketing/jobs.mjs).
 * @param {Tx} tx @param {{ orgId?: string, limit?: number }} [opts]
 */
export async function readStuckJobs(tx, { orgId, limit = STUCK_JOBS_LIMIT } = {}) {
  needTx(tx, "readStuckJobs");
  needOrg(orgId, "readStuckJobs");
  const n = Math.max(1, Math.min(100, Math.floor(Number(limit) || STUCK_JOBS_LIMIT)));
  const r = await tx.query(
    `-- m5:stuck_jobs
SELECT j.id, j.kind, j.error, coalesce(j.finished_at, j.updated_at) AS since
  FROM marketing_jobs j
 WHERE j.org_id = $1
   AND j.status = 'failed'
   AND j.kind <> '${OFFER_KIND}'
 ORDER BY coalesce(j.finished_at, j.updated_at) DESC, j.id
 LIMIT $2`,
    [orgId, n]
  );
  return r.rows.map((row) => ({
    id: String(row.id),
    kind: row.kind,
    error: row.error,
    since: row.since == null ? null : new Date(row.since).toISOString()
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. ONE CALL PER SCREEN PART
// ═══════════════════════════════════════════════════════════════════════════

/** @param {AdLabelRow[]} ads @param {any[]} [leads] */
const numbersOf = (ads, leads = []) => [
  ...ads.map((a) => a.ad_number),
  ...leads.map((l) => l.ad_number)
].filter((n) => n != null);

/**
 * spendByFunnel(tx, { orgId, from, to }) → funnelSpendRows(...) for the window.
 * Today's spend_by_funnel is spendByFunnelView() of this.
 * @param {Tx} tx @param {{ orgId?: string, from?: string, to?: string }} [opts]
 */
export async function spendByFunnel(tx, { orgId, from, to } = {}) {
  const ads = await readAdLabels(tx, { orgId });
  const spend = await readAdSpend(tx, { orgId, from, to });
  const scripts = await readScriptLabels(tx, { orgId, adNumbers: numbersOf(ads) });
  const funnels = await listFunnels(tx, orgId);
  const { byAd } = resolveLabels(ads, scripts);
  return { ...funnelSpendRows({ byAd, spend, funnels }), funnels };
}

/**
 * byAngle(tx, { orgId, from, to, now, angleNames }) → the GET marketing/angles rows.
 * Leads and their results come from U20's readAdNumbers (14-day rule, demo out).
 * @param {Tx} tx
 * @param {{ orgId?: string, from?: string, to?: string, now?: Date, angleNames?: Map<string, string> }} [opts]
 */
export async function byAngle(tx, { orgId, from, to, now = new Date(), angleNames = new Map() } = {}) {
  const ads = await readAdLabels(tx, { orgId });
  const spend = await readAdSpend(tx, { orgId, from, to });
  const leads = await readAdNumbers(tx, { orgId, from, to, now });
  const scripts = await readScriptLabels(tx, { orgId, adNumbers: numbersOf(ads, leads) });
  return angleRows({ ...resolveLabels(ads, scripts), spend, leads, angleNames });
}

/**
 * funnelStats(tx, { orgId, from, to, now }) → { rows, unmapped_spend_cents }
 * for GET marketing/funnels/stats.
 * @param {Tx} tx @param {{ orgId?: string, from?: string, to?: string, now?: Date }} [opts]
 */
export async function funnelStats(tx, { orgId, from, to, now = new Date() } = {}) {
  const ads = await readAdLabels(tx, { orgId });
  const spend = await readAdSpend(tx, { orgId, from, to });
  const leads = await readAdNumbers(tx, { orgId, from, to, now });
  const scripts = await readScriptLabels(tx, { orgId, adNumbers: numbersOf(ads, leads) });
  const funnels = await listFunnels(tx, orgId);
  const steps = await funnelSteps(tx, { orgId, from, to });
  return funnelStatRows({ ...resolveLabels(ads, scripts), spend, leads, funnels, steps });
}
