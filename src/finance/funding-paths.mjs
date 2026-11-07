// "Your funding paths" — the three ways this client can get funded, each filled
// in from their own file. Finance OS wave 4, unit FUND
// (ops/workflows/finance-os-wave4-brief.txt):
//
//   1. Fund it yourself     the plan and the UnderwriteIQ estimate
//   2. Fund other people    the existing affiliate and white-label paths
//   3. Fundhub funds you    the existing done-for-you funding offer and
//                           ClarityPay financing
//
// "Reuse the existing offers and roles; never invent a price." Every number
// here is read from where it already lives:
//
//   the estimate      the Fundability read's own payload, passed in — the same
//                     choice money-fundability.js makes: the current CRS
//                     engine's modeled capacity when it answers for the
//                     personal file, else the lite engine's funding estimate
//                     and its last "on your plan" point. UnderwriteIQ itself
//                     (src/underwrite/**, src/finance/fundability.mjs) is only
//                     called, never changed, and is not re-run here.
//   the next step     the client's own open checklist step (client_waypoints,
//                     readOpenWaypoints in src/finance/money-tasks.mjs)
//   referral rate     affiliate_commission_rules — a percent only when every
//                     live rule for the tier agrees (the portal's own rule,
//                     api/read/affiliate-portal.mjs shapeTier), shown with the
//                     sale each rule pays on and what it is a percent of
//                     (Codex CX20); a rule that cannot be said leaves it off
//   referral link     accounts.affiliate_id on the client's own login, the row
//                     "Refer a friend" (api/affiliates/refer.mjs) writes;
//                     shareUrlFor (src/affiliates/share-link.mjs) builds the link
//   white-label       src/config/offers.mjs PARTNER_ENTRY and LIVE_TRIAL; the
//                     public partner funnel at /partner/
//   done for you      src/config/offers.mjs FUNDING_DFY (deposit + success fee).
//                     A Capital Blueprint owner's deposit is FUNDING_DFY
//                     blueprintOwnerDepositCents (owner-set 2026-11-07: the
//                     $3,000 is waived); who owns it is productOffers'
//                     blueprint.owned (isCapitalBlueprintBuyer), the same read
//                     the ClarityPay line uses
//   ready to fund     src/finance/ready-to-fund.mjs (the press opens the
//                     Blueprint closing prep call with a CSM)
//   ClarityPay        financing is offered on the Capital Blueprint only
//                     (offers.mjs UWIQ_DELIVERABLES financing: true; present.js
//                     "Financing is for the Capital Blueprint only"); the
//                     client's own payment plans with Fundhub come from
//                     src/finance/clarity-payments.mjs
//
// UNKNOWN IS NULL, NEVER 0. MONEY IS INTEGER CENTS. READ ONLY: nothing here
// writes, sends or moves money. org_id and client_id are bound on every client
// statement; the commission rules are the org's own. Each path is read on its
// own, so one failed read leaves the other two standing.

import { OFFERS } from "../config/offers.mjs";
import { FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES, BLUEPRINT_PRODUCT_CODES } from "../affiliates/economics.mjs";
import { readOpenWaypoints as defaultWaypoints } from "./money-tasks.mjs";
import { readyToFundStatus as defaultReady, productOffers as defaultProducts } from "./ready-to-fund.mjs";
import { listClarityPayments as defaultPlans } from "./clarity-payments.mjs";
import { shareUrlFor } from "../affiliates/share-link.mjs";

export const STEPS_URL = "/app/financeos.html#next";
export const PAYMENTS_URL = "/app/financeos.html#payments";
export const AFFILIATE_URL = "/app/affiliate.html";
export const PARTNER_URL = "/partner/";
export const CURRENT_ENGINE = "current_crs_engine";

const isInt = (v) => Number.isSafeInteger(v);
const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : []);

function dayOf(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/**
 * estimateOf(fundability) → { today_cents, plan_cents, plan_months, source }.
 * PURE. Mirrors money-fundability.js renderFull: when the current CRS engine
 * answers for the personal file (modeled, or says it cannot show a safe
 * figure), its numbers are the only ones shown — an unsafe figure stays null
 * and the lite engine is NOT used to fill the gap. Otherwise the lite engine's
 * funding estimate and its last "on your plan" point.
 */
export function estimateOf(fund) {
  const personal = fund && fund.opportunity && fund.opportunity.basis === CURRENT_ENGINE ? fund.opportunity.personal : null;
  const current = !!(personal && (personal.status === "modeled" ||
    list(personal.blockers).indexOf("current_engine_does_not_expose_safe_capacity") >= 0));
  if (current) {
    return {
      today_cents: isInt(personal.currentCents) ? personal.currentCents : null,
      plan_cents: isInt(personal.projectedCents) ? personal.projectedCents : null,
      plan_months: null,
      source: CURRENT_ENGINE
    };
  }
  const now = (fund && fund.now) || {};
  const plan = list(fund && fund.projections).filter((p) => p && p.scenario === "plan" && isInt(p.months))
    .sort((a, b) => a.months - b.months);
  const last = plan.length ? plan[plan.length - 1] : null;
  return {
    today_cents: isInt(now.funding_estimate_cents) ? now.funding_estimate_cents : null,
    plan_cents: last && isInt(last.funding_estimate_cents) ? last.funding_estimate_cents : null,
    plan_months: last && isInt(last.funding_estimate_cents) ? last.months : null,
    source: "underwrite_iq_lite"
  };
}

/** Path 1 — fund it yourself. PURE. */
export function selfPath(fund, nextStep = null) {
  const now = (fund && fund.now) || {};
  const est = estimateOf(fund);
  return {
    ok: true,
    has_pull: !!(fund && fund.has_pull),
    sample: !!(fund && fund.sample === true),
    tier: now.tier === "fundable" || now.tier === "not_fundable" ? now.tier : null,
    checks_passed: isInt(now.score) ? now.score : null,
    checks_of: isInt(now.score_max) ? now.score_max : null,
    today_cents: est.today_cents,
    plan_cents: est.plan_cents,
    plan_months: est.plan_months,
    source: est.source,
    next_step: nextStep && text(nextStep.title) ? { title: text(nextStep.title), due_on: dayOf(nextStep.due_at) } : null,
    steps_url: STEPS_URL
  };
}

/** One agreed percent for a tier, or null when the live rules disagree or none match. */
export function agreedPercent(rules, tier) {
  const rows = list(rules).filter((r) => r && r.tier === tier);
  if (!rows.length) return null;
  const pcts = rows.map((r) => (r.calc_method === "percent" && r.percent !== null && r.percent !== undefined && r.percent !== "" ? Number(r.percent) : null));
  if (pcts.some((p) => p === null || !Number.isFinite(p))) return null;
  return pcts.every((p) => p === pcts[0]) ? pcts[0] : null;
}

/* What a referral pays on, in client words (Codex CX20): the sale each live rule
   names (its product) and what its percent is of (its amount_basis). When a sale
   counts comes from the code that pays it (src/affiliates/economics.mjs
   qualifyingOutcome): done-for-you funding only once they are funded, the others
   when they pay. The roadmap is the paid $297 order on the `diagnostic` code, the
   only diagnostic sale that rule pays. */
const SALES = [
  { codes: FUNDING_PRODUCT_CODES, sale: "Done-for-you funding", when: "after they get funded" },
  { codes: REPAIR_PRODUCT_CODES, sale: "Credit repair", when: null },
  { codes: BLUEPRINT_PRODUCT_CODES, sale: "Capital Blueprint", when: null },
  { codes: ["diagnostic"], sale: "The roadmap", when: null }
];
const BASIS = {
  sale_price: "the price",
  deposit_collected: "the deposit",
  cash_collected: "what they pay",
  first_payment: "their first payment",
  partner_share_of_cash: "what they pay"
};

/**
 * paysOn(rules, tier) → [{ sale, of, when }] or null. PURE. One line per sale
 * the tier's live rules pay on, in the order above. null when there is no rule,
 * or when any rule names a sale or a basis this cannot put in words — then the
 * card leaves the percent off rather than say it applies to "anyone".
 */
export function paysOn(rules, tier) {
  const rows = list(rules).filter((r) => r && r.tier === tier);
  if (!rows.length) return null;
  const lines = [];
  for (const r of rows) {
    const code = text(r.product_code) ? text(r.product_code).toLowerCase() : null;
    const at = code ? SALES.findIndex((s) => s.codes.includes(code)) : -1;
    const of = BASIS[r.amount_basis] || null;
    if (at < 0 || !of) return null;
    if (!lines.some((l) => l.at === at && l.of === of)) lines.push({ at, sale: SALES[at].sale, of, when: SALES[at].when });
  }
  return lines.sort((a, b) => a.at - b.at).map(({ sale, of, when }) => ({ sale, of, when }));
}

/** true when the tier pays once per person (on the first of these sales they
 *  buy), false when it pays on every one, null when the live rules disagree or
 *  say neither. */
export function paysOnce(rules, tier) {
  const scopes = list(rules).filter((r) => r && r.tier === tier).map((r) => r.scope_rule);
  if (!scopes.length) return null;
  if (scopes.every((s) => s === "first_paid_product")) return true;
  if (scopes.every((s) => s === "every_sale")) return false;
  return null;
}

/** Path 2 — fund other people. PURE. */
export function othersPath({ affiliate = null, counts = null, rules = [], env = {} } = {}) {
  const code = affiliate ? text(affiliate.tracking_id) : null;
  const entry = OFFERS.PARTNER_ENTRY;
  const trial = OFFERS.LIVE_TRIAL;
  return {
    ok: true,
    affiliate: {
      enrolled: !!affiliate,
      share_url: code ? shareUrlFor(code, env) : null,
      sent: affiliate && counts && isInt(Number(counts.sent)) ? Number(counts.sent) : null,
      signed_up: affiliate && counts && isInt(Number(counts.signed_up)) ? Number(counts.signed_up) : null,
      direct_pct: agreedPercent(rules, "direct"),
      downline_pct: agreedPercent(rules, "downline"),
      pays_on: paysOn(rules, "direct"),
      pays_once: paysOnce(rules, "direct"),
      dashboard_url: AFFILIATE_URL
    },
    white_label: {
      name: entry.name,
      entry_cents: isInt(entry.priceCents) ? entry.priceCents : null,
      trial_name: trial.name,
      trial_cents: isInt(trial.priceCents) ? trial.priceCents : null,
      url: PARTNER_URL
    }
  };
}

/**
 * doneForYouDeposit(owned) → { deposit_cents, deposit_waived, standard_deposit_cents }.
 * PURE. Owner-set 2026-11-07: a client who owns the Capital Blueprint starts
 * done-for-you funding at FUNDING_DFY.blueprintOwnerDepositCents ($0: the
 * $3,000 deposit is waived); anyone else at FUNDING_DFY.priceCents. `owned` is
 * productOffers' blueprint.owned. When that read failed (null) the deposit is
 * unknown: null, never $0 and never $3,000.
 */
export function doneForYouDeposit(owned) {
  const dfy = OFFERS.FUNDING_DFY;
  const standard = isInt(dfy.priceCents) ? dfy.priceCents : null;
  if (owned === true) {
    const cents = isInt(dfy.blueprintOwnerDepositCents) ? dfy.blueprintOwnerDepositCents : null;
    return { deposit_cents: cents, deposit_waived: cents === null ? null : cents === 0, standard_deposit_cents: standard };
  }
  if (owned === false) return { deposit_cents: standard, deposit_waived: false, standard_deposit_cents: standard };
  return { deposit_cents: null, deposit_waived: null, standard_deposit_cents: standard };
}

/** Path 3 — Fundhub funds you. PURE. */
export function fundhubPath({ ready = null, products = null, plans = [] } = {}) {
  const dfy = OFFERS.FUNDING_DFY;
  const blueprint = OFFERS.UWIQ_DELIVERABLES;
  const open = list(plans).filter((p) => p && p.status === "open");
  const lefts = open.map((p) => p.left_cents);
  const owned = products && products.blueprint ? products.blueprint.owned === true : null;
  return {
    ok: true,
    done_for_you: {
      name: dfy.name,
      ...doneForYouDeposit(owned),
      success_fee_pct: isInt(dfy.successFeePercent) ? dfy.successFeePercent : null
    },
    ready: ready ? {
      status: ready.status,
      requested_at: ready.requested_at || null,
      done_at: ready.done_at || null
    } : null,
    financing: {
      provider: "ClarityPay",
      offer: blueprint.financing === true ? blueprint.name : null,
      blueprint_owned: owned,
      book_url: owned === false && products.blueprint.sell && text(products.blueprint.sell.url) ? products.blueprint.sell.url : null,
      plans_open: open.length,
      /* What is left on the client's own open plans with Fundhub; null when any
         one of them is unknown, never a partial sum. */
      left_cents: open.length && lefts.every(isInt) ? lefts.reduce((s, c) => s + c, 0) : null,
      payments_url: PAYMENTS_URL
    }
  };
}

/* ── the reads ───────────────────────────────────────────────────────────── */

/* The client's own affiliate row: the link "Refer a friend" writes on their
   login (accounts.affiliate_id). */
const AFFILIATE_SQL = `
  SELECT a.id::text AS id, a.tracking_id
    FROM accounts acc
    JOIN affiliates a ON a.id = acc.affiliate_id AND a.org_id = acc.org_id
   WHERE acc.org_id = $1 AND acc.client_id = $2 AND acc.affiliate_id IS NOT NULL
   ORDER BY acc.created_at ASC
   LIMIT 1`;

/* People they sent: the DIRECT tier only, not voided; signed up = converted or
   paid. The portal's Refer card counts the same way. */
const COUNTS_SQL = `
  SELECT count(*) FILTER (WHERE tier = 'direct' AND status <> 'void')::int AS sent,
         count(*) FILTER (WHERE tier = 'direct' AND status IN ('converted', 'paid'))::int AS signed_up
    FROM affiliate_referrals
   WHERE org_id = $1 AND affiliate_id = $2::uuid`;

/* The live rules: the org's own, plus any written for this affiliate. A client
   who has not joined yet sees the org's rate — what they would earn — and, for
   each rule, the sale it pays on and what the percent is of (Codex CX20). */
const RULES_SQL = `
  SELECT r.tier, r.calc_method, r.percent, r.amount_basis, r.scope_rule, p.code AS product_code
    FROM affiliate_commission_rules r
    LEFT JOIN products p ON p.id = r.product_id AND p.org_id = r.org_id
   WHERE r.org_id = $1
     AND r.active
     AND r.tier IN ('direct', 'downline')
     AND (r.affiliate_id IS NULL OR r.affiliate_id = $2::uuid)
     AND r.effective_from <= now()
     AND (r.effective_to IS NULL OR r.effective_to > now())`;

async function soft(run, fallback) {
  try { return await run(); } catch { return fallback; }
}

/**
 * fundingPaths(db, { orgId, clientId, fundability, asOf, viewer, env, deps })
 *   → { ok: true, viewer, self, others, fundhub }
 *
 * `fundability` is the Fundability read's own payload (already computed by the
 * caller); this file does not run UnderwriteIQ again. A path whose reads fail
 * is { ok: false } and the other two still answer.
 */
export async function fundingPaths(db, {
  orgId, clientId, fundability = null, asOf = new Date(), viewer = "client", env = process.env, deps = {}
} = {}) {
  if (!orgId || !clientId) throw new TypeError("fundingPaths: orgId and clientId are required");
  const today = new Date(asOf).toISOString().slice(0, 10);
  const waypoints = deps.readOpenWaypoints || defaultWaypoints;
  const readyRead = deps.readyToFundStatus || defaultReady;
  const productsRead = deps.productOffers || defaultProducts;
  const plansRead = deps.listClarityPayments || defaultPlans;

  const self = soft(async () => {
    const steps = await waypoints(db, { orgId, clientId });
    return selfPath(fundability, list(steps)[0] || null);
  }, { ok: false });

  const others = soft(async () => {
    const a = await db.query(AFFILIATE_SQL, [orgId, clientId]);
    const affiliate = (a.rows && a.rows[0]) || null;
    const [counts, rules] = await Promise.all([
      affiliate ? db.query(COUNTS_SQL, [orgId, affiliate.id]) : Promise.resolve({ rows: [] }),
      db.query(RULES_SQL, [orgId, affiliate ? affiliate.id : null])
    ]);
    return othersPath({ affiliate, counts: (counts.rows && counts.rows[0]) || null, rules: rules.rows || [], env });
  }, { ok: false });

  const fundhub = soft(async () => {
    const [ready, products, plans] = await Promise.all([
      soft(() => readyRead(db, { orgId, clientId }), null),
      soft(() => productsRead(db, { orgId, clientId, asOf }), null),
      soft(() => plansRead(db, { orgId, clientId, today }), [])
    ]);
    return fundhubPath({ ready, products, plans });
  }, { ok: false });

  const [s, o, f] = await Promise.all([self, others, fundhub]);
  return { ok: true, viewer: viewer === "staff" ? "staff" : "client", self: s, others: o, fundhub: f };
}

export default fundingPaths;
