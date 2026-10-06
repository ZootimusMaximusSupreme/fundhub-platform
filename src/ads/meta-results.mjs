// src/ads/meta-results.mjs — Meta's purchases, cost per purchase, link clicks
// and landing page views off one insights row (columns added in 408).
//
// WHY THIS EXISTS. The daily sync (api/campaigns/sync.mjs) already asked Meta
// for `actions` on every ad-day and then threw the answer away, so 46 ad-days
// held $1,002.32 of spend and not one purchase, link click or landing page
// view (marketing/MACHINE-GAPS.md §7, measured 2026-10-05). This turns the
// answer into the four numbers, once, so the request and the parser cannot
// drift apart: MONEY_INSIGHT_REQUEST_FIELDS is what the sync asks Meta for.
//
// META'S OWN NAMES, NOT GUESSED. Every action name below is in Meta's Ads
// Action Stats reference (developers.facebook.com/docs/marketing-api/
// reference/ads-action-stats, read 2026-10-05), and `cost_per_action_type` is a
// field in Meta's own SDK (facebook_business/adobjects/adsinsights.py). Meta
// refuses the WHOLE insights request when one field name is unknown, so one
// invented name would take spend and clicks down with it.
//
// THE SHAPE META SENDS. `actions` and `cost_per_action_type` are LISTS of
// { action_type, value } with value as a STRING:
//   actions: [{ action_type: "link_click", value: "43" },
//             { action_type: "omni_purchase", value: "2" }, ...]
//   cost_per_action_type: [{ action_type: "omni_purchase", value: "136.17" }, ...]
//
// NULL MEANS META SENT NO LINE. Never 0. Ads Manager shows a dash there, and a
// dash is not a zero we measured (CLAUDE.md §12). Junk values (not a number,
// negative) are also NULL.

import { toCents, roundHalfUp } from "../commissions/money.mjs";

/* Purchases, in order of preference. omni_purchase is Meta's "Purchases"
   across every channel; offsite_conversion.fb_pixel_purchase is the website
   (pixel and server events) count. They count the SAME sales, so the first one
   Meta sent is used and they are NEVER added together. */
export const META_PURCHASE_ACTION_TYPES = Object.freeze([
  "omni_purchase",
  "offsite_conversion.fb_pixel_purchase"
]);
export const META_LINK_CLICK_ACTION = "link_click";
export const META_LANDING_PAGE_VIEW_ACTION = "landing_page_view";

/* LINK CLICKS COME FROM inline_link_clicks FIRST (2026-10-05, marketing
   machine M0 step 5). It is Meta's own "Link clicks" field on the insights
   row — one number, sent as a STRING ("43") — and a field in Meta's v26.0 SDK
   (facebook_business/adobjects/adsinsights.py, SDK 26.0.2, checked
   2026-10-05). When Meta sends it, it is the number. When Meta does not, the
   link_click line in `actions` is used, as before. Never added together: they
   count the same clicks. Stored in the one column 408 already added,
   ad_metrics_daily.link_clicks — there is no second column. */
export const META_INLINE_LINK_CLICKS_FIELD = "inline_link_clicks";

/* The insights fields these four numbers need. `actions` was already on the
   request; `cost_per_action_type` (purchases) and `inline_link_clicks` (link
   clicks) are the ones this adds. */
export const MONEY_INSIGHT_REQUEST_FIELDS = Object.freeze([
  "actions", "cost_per_action_type", META_INLINE_LINK_CLICKS_FIELD
]);

/* Our column names (408), in the order the sync writes them. */
export const META_RESULT_COLUMNS = Object.freeze([
  "purchases", "cost_per_purchase_cents", "link_clicks", "landing_page_views"
]);

function countOrNull(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function centsOrNull(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const c = toCents(raw);
    return c >= 0 ? c : null;
  } catch {
    return null;
  }
}

/* The entries of one action list for one action_type. A list that is not a
   list, or an entry that is not an object, is skipped rather than thrown on. */
function entriesFor(list, type) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => e && typeof e === "object" && e.action_type === type);
}

/* actionCount(actions, type) → the count Meta sent for that action, or null.
   With no breakdown there is one entry per type. If Meta ever sends more than
   one for the same type (a breakdown sends the parts and their total), the
   largest is the total — adding them would count people twice. */
export function actionCount(actions, type) {
  let best = null;
  for (const e of entriesFor(actions, type)) {
    const v = countOrNull(e.value);
    if (v !== null && (best === null || v > best)) best = v;
  }
  return best;
}

/* actionCostCents(costs, type) → Meta's cost per one of that action, in
   cents, or null. Same one-entry rule; with more than one, the first readable
   value is used (a per-part cost is not additive, and there is no "total"). */
export function actionCostCents(costs, type) {
  for (const e of entriesFor(costs, type)) {
    const c = centsOrNull(e.value);
    if (c !== null) return c;
  }
  return null;
}

/* linkClicks(row) → inline_link_clicks when Meta sent a readable one, else
   the link_click line in `actions`, else null. A real 0 Meta sent stays 0. */
export function linkClicks(row = {}) {
  const r = row && typeof row === "object" ? row : {};
  const inline = countOrNull(r[META_INLINE_LINK_CLICKS_FIELD]);
  if (inline !== null) return inline;
  return actionCount(r.actions, META_LINK_CLICK_ACTION);
}

/* The first purchase action Meta actually sent a line for. */
export function purchaseActionType(actions) {
  for (const type of META_PURCHASE_ACTION_TYPES) {
    if (actionCount(actions, type) !== null) return type;
  }
  return null;
}

/**
 * metaResultMetrics(row) → { purchases, cost_per_purchase_cents, link_clicks,
 * landing_page_views }. Every key is always present; each is a whole number or
 * null.
 *
 * Cost per purchase: Meta's own cost line for the same purchase action. When
 * Meta sent purchases (more than 0) and spend but no cost line, it is spend ÷
 * purchases in cents, rounded half up — arithmetic on Meta's two numbers, not
 * a guess. No purchases, or 0 purchases → null (there is no cost of nothing).
 */
export function metaResultMetrics(row = {}) {
  const r = row && typeof row === "object" ? row : {};
  const type = purchaseActionType(r.actions);
  const purchases = type ? actionCount(r.actions, type) : null;

  let costPerPurchase = null;
  if (purchases !== null && purchases > 0) {
    costPerPurchase = actionCostCents(r.cost_per_action_type, type);
    if (costPerPurchase === null) {
      const spend = centsOrNull(r.spend);
      if (spend !== null) costPerPurchase = roundHalfUp(spend / purchases);
    }
  }

  return {
    purchases,
    cost_per_purchase_cents: costPerPurchase,
    link_clicks: linkClicks(r),
    landing_page_views: actionCount(r.actions, META_LANDING_PAGE_VIEW_ACTION)
  };
}

export default metaResultMetrics;
