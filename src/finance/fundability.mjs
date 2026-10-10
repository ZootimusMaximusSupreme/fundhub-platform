// Fundability — now, later, and per business. The back end of
// /app/money-fundability.html (FinanceOS wave 5, unit W3).
//
// Owner, 2026-10-06: "Fundability tracking: current overall fundability score,
// future fundability projections, multi-business fundability when you add more
// businesses." Board: ops/workflows/finance-os-wave5-2026-10-06.md.
//
// ONE BRAIN. Every number here comes out of UnderwriteIQ — the same four calls
// api/read/underwrite.mjs makes (toBureaus → computeUnderwrite →
// applyStackedBusinessFunding → buildSuggestions/buildReport). This file adds
// no rule about credit. It COUNTS the engine's own checks, it READS the engine's
// own money figure, and to look ahead it RE-RUNS THE SAME ENGINE on a copy of
// the file with only the changes listed below.
//
// ═══════════════════════════════════════════════════════════════════════════════
// THE FUNDABILITY SCORE — HOW IT IS COMPUTED, EXACTLY
//
// There was no fundability score in this repo (git grep -i fundab, 2026-10-06:
// marketing copy, email templates and the decline-autopsy buckets only). So this
// is not a new model. It is a COUNT of UnderwriteIQ's own checks, each read off
// one computeUnderwrite result (src/underwrite/vendor/underwriter.cjs):
//
//   key             passes when                                        engine line
//   score_700       metrics.score >= 700                                :313
//   utilization_30  optimization.needs_util_reduction === false         :288-289
//                   AND metrics.utilization_pct is known
//   no_negatives    metrics.negative_accounts === 0                     :316
//   anchor_card     optimization.needs_new_primary_revolving === false  :291-292
//   no_inquiries    optimization.needs_inquiry_cleanup === false        :294
//                   AND metrics.inquiries.total is known
//   file_depth      optimization.needs_file_buildout === false          :296
//
//   score     = how many of the six pass (0–6)
//   score_max = 6
//   unknown   = how many could not be read because an input was never entered.
//               An unknown NEVER counts as a pass.
//   score is null when no bureau carries a score — the engine has nothing to
//   read, so there is nothing to count.
//
// Every check weighs the same. No weights, no 0–100 scale, no curve: a weight
// would be a number nobody set. The first three checks are the engine's
// `fundable` gate taken apart; `tier` below is the gate itself.
//
// TIER = the engine's own `fundable` flag (underwriter.cjs:312-316), which is
// also step 1 of Chris's funding walk (docs/underwriteiq/perfect-file-syntax.md):
//   "fundable"      uw.fundable === true
//   "not_fundable"  a gate fails on a MEASURED number (score < 700, card use over
//                   30%, or one or more negative items)
//   null            the gate fails only because a number was never entered (the
//                   engine needs a measured zero negatives) — we cannot tell
// src/finance/fundability.test.mjs proves (tier === "fundable") === uw.fundable.
//
// FUNDING ESTIMATE = the LOWER of two numbers the engine itself prints:
//   a. per_bureau[primary_bureau].totalPersonalFunding — the bureau it rates the
//      client on: the best seasoned open card of $5,000+ × 5.5, plus a seasoned
//      loan with no lates × 3 (underwriter.cjs:196-206). One bureau's worth,
//      the same framing the stored pre-approval uses ($212,000 for the sample
//      client, both ways).
//   b. totals.total_personal_funding — the engine's own total.
// (b) alone is wrong here: fundhub hands every bureau the same client-wide
// accounts, so the total counts them once per bureau — $636,000 where the
// stored file says $212,000. Owner, 2026-09-06, walk finding 9: "Nobody gets
// 600K in funding." (src/sales/cockpit.mjs storedFunding). (a) alone would skip
// the engine's own one-bureau cut (underwriter.cjs:270-271): a pull with only
// one bureau scored gets a third. The lower of the two is never more than one
// bureau's worth and never more than the engine's own total.
//   NULL unless tier is "fundable". Chris's walk law: "Nothing else is worth
//   doing until the personal file is prime." A dollar figure next to a file the
//   engine calls not fundable would read as an offer.
//
// PER BUSINESS. The engine's business slice for ONE company is the primary
// card funding × the age multiplier (0.5 under 12 months, 1 under 24, 2 from 24;
// src/underwrite/business-funding.mjs, underwriter.cjs:277-286). Each company is
// read on its own and listed on its own. They are NEVER added up into one score
// or one dollar figure. Five checks per business, counted the same way:
//   personal_fundable  the personal tier is "fundable"           (walk law step 1)
//   anchor_card        the personal anchor_card check passes     (the slice is
//                      primary card funding × multiplier; no anchor, no slice)
//   age_24             the company is 24+ months old — the engine's top band
//   name_on_file       businesses.name / entity_data.name        (walk law step 3,
//                      companyHasName in src/underwrite/funding-sequence.mjs)
//   naics_on_file      entity_data.naics / naics_code            (walk law step 3,
//                      companyNaics, same file)
//
// ═══════════════════════════════════════════════════════════════════════════════
// LOOKING AHEAD — WHAT A PROJECTED POINT MAY CHANGE, AND NOTHING ELSE
//
// The engine reads the clock (src/underwrite/engine.mjs note 1): an account is
// "seasoned" at 24 months. So "the file N months from now" is the same file with
// every account-opened date moved N months back — the engine is not touched.
//
//   time        every account N months older; open accounts stay open
//               (always applied — listed as an assumption on every point)
//   businesses  each company's age_months + N (and the client's
//               business_age_months fallback + N)
//   paydowns    the client's OWN plan: each paydown waypoint
//               (client_waypoints, verify_kind 'paydown') whose due date falls on
//               or before the point brings that card's balance down to the
//               waypoint's own target_cents (10% of the limit,
//               PAYDOWN_TARGET_FRACTION in src/waypoints/definitions.mjs). No plan,
//               no paydown.
//   if removed  a SEPARATE line, drawn dashed, only when a dispute plan exists:
//               open derogatory dispute_items (DEROG-COLLECTION / -CHARGEOFF /
//               -LATE, src/metro2/diy/derogatory.mjs) against a known, non-zero
//               negative-items count. The count drops by the number of distinct
//               accounts those items target. It is a labelled scenario, never the
//               plan line, and it never claims a removal will happen.
//
// NOT PROJECTED — the engine cannot say, so this file does not guess:
//   scores (the engine reads them from a pull and never moves them), inquiry and
//   late-payment aging (no age window in the engine), banking history (the
//   engine reads no bank data), new accounts or companies, a new pull.
//   `cannot_project` on the response says so in words.
//
// UNKNOWN IS NULL, NEVER 0 (CLAUDE.md §12). Money is integer cents.
// READ ONLY. Every query carries org_id AND client_id.

import { triMerge, businessScoreFromPulls } from "../http/client-detail.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import { toBureaus, BUREAUS } from "../underwrite/adapter.mjs";
import { UPSTREAM, computeUnderwrite, buildSuggestions } from "../underwrite/engine.mjs";
import {
  applyStackedBusinessFunding, stackedBusinessFunding, businessAgeMultiplier, finiteAgeMonths
} from "../underwrite/business-funding.mjs";
import { buildReport, SUGGESTION_CATALOGUE } from "../underwrite/report.mjs";
import { companyHasName, companyNaics } from "../underwrite/funding-sequence.mjs";
import { evaluateUtilization } from "../alerts/evaluate.mjs";
import { usableSuggestions } from "./credit-overview.mjs";
import { slugify, accountPrint } from "../waypoints/definitions.mjs";
import { isDerogatoryRuleId } from "../metro2/diy/derogatory.mjs";
import { isoDay } from "../liabilities/card-stack.mjs";
import { toCents } from "../commissions/money.mjs";

/** How far ahead each projected point looks, in months. */
export const PROJECTION_MONTHS = Object.freeze([3, 6, 12]);

/** The engine's fundable score floor (underwriter.cjs:313). Restated only to
 *  read one check off metrics.score; the decision itself is uw.fundable. */
export const FUNDABLE_MIN_SCORE = 700;

/** The engine's top business band starts here (underwriter.cjs:281). */
export const TOP_BAND_MONTHS = 24;

/** The six personal checks. Order is the order they are shown. */
export const PERSONAL_CHECKS = Object.freeze([
  Object.freeze({ key: "score_700", label: "Credit score 700 or higher", target: "700 or higher" }),
  Object.freeze({ key: "utilization_30", label: "Cards used 30% or less", target: "30% or less" }),
  Object.freeze({ key: "no_negatives", label: "No negative items", target: "0" }),
  Object.freeze({ key: "anchor_card", label: "A card 2+ years old with a $5,000+ limit", target: "$5,000 or more" }),
  Object.freeze({ key: "no_inquiries", label: "No hard inquiries", target: "0" }),
  Object.freeze({ key: "file_depth", label: "3 or more accounts in good standing", target: "3 or more" })
]);

/** The five business checks. */
export const BUSINESS_CHECKS = Object.freeze([
  Object.freeze({ key: "personal_fundable", label: "Personal file is fundable", target: "Fundable" }),
  Object.freeze({ key: "anchor_card", label: "A personal card 2+ years old with a $5,000+ limit", target: "$5,000 or more" }),
  Object.freeze({ key: "age_24", label: "Business 24+ months old", target: "24 months or more" }),
  Object.freeze({ key: "name_on_file", label: "Business name on file", target: "On file" }),
  Object.freeze({ key: "naics_on_file", label: "Industry code (NAICS) on file", target: "On file" })
]);

const BUREAU_LABEL = Object.freeze({ experian: "Experian", equifax: "Equifax", transunion: "TransUnion" });

/** Which check an engine sentence speaks to — a label over the catalogue's own
 *  topic (src/underwrite/report.mjs), never a second reading of the numbers. */
const CHECK_OF_TOPIC = Object.freeze({
  utilization: "utilization_30",
  primary_revolving: "anchor_card",
  inquiries: "no_inquiries",
  negatives: "no_negatives",
  file_buildout: "file_depth"
});

/** dispute_items statuses still in play — the repo's own "openish" set
 *  (src/metro2/rounds/state.mjs caseStatusFromItems, src/repair/parse-loop.mjs). */
export const OPEN_DISPUTE_STATUSES = Object.freeze(["open", "sent", "verified", "escalated", "unaddressed"]);

/** Waypoint states that still count as the client's plan. */
const PLAN_STATES = new Set(["not_started", "in_progress", "done"]);

/** What the engine cannot look ahead on. Shown on the page, word for word. */
export const CANNOT_PROJECT = Object.freeze([
  "Credit scores. UnderwriteIQ reads your scores from a pull. It never guesses a new one, so every point uses today's scores.",
  "Hard inquiries and late payments. UnderwriteIQ counts them but has no age window, so they stay as they are.",
  "Banking history. UnderwriteIQ does not read bank deposits or how long you have banked somewhere.",
  "New accounts, new businesses, or a new pull. Only what is on file today, plus your own plan.",
  "Whether a dispute works. An \"if removed\" line shows what UnderwriteIQ would say. It is not a promise."
]);

/* ── small readers ─────────────────────────────────────────────────────────── */

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }

/* A whole, non-negative count, or null. Same refusals as the adapter's count(). */
function count(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "string" && v.trim().toLowerCase() === "null") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/* pg hands bigint back as a string. Integer cents, or null. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* Engine dollars → integer cents through money.mjs. toCents() maps null to 0,
   so unknown is caught first: unknown is null, never $0. */
function dollarsToCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return toCents(n);
}

function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}

/** A moment → "YYYY-MM-DD" in UTC, or null. */
export function dayOf(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = new Date(v);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : null;
}

/**
 * addMonths("2026-10-06", 3) → "2027-01-06". Negative months go back. The day is
 * kept, or pulled in to the month's last day (Jan 31 + 1 → Feb 28). null in,
 * null out — a date nobody stored is never made up.
 */
export function addMonths(day, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  if (!m || !Number.isInteger(months)) return null;
  const first = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + months, 1));
  const y = first.getUTCFullYear();
  const mo = first.getUTCMonth();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  const d = Math.min(Number(m[3]), last);
  return `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** The fields the adapter recorded as not entered (informational gaps skipped).
 *  Same rule as report.mjs's own missingFieldNames. */
function missingNames(missing = {}) {
  const names = new Set();
  for (const entries of Object.values(missing || {})) {
    for (const e of Array.isArray(entries) ? entries : []) {
      if (e?.informational) continue;
      if (e?.field) names.add(e.field);
    }
  }
  return names;
}

/* ── the engine, called exactly as api/read/underwrite.mjs calls it ─────────── */

/**
 * readEngine — the four UnderwriteIQ calls, in order. Pure apart from the clock
 * the vendored engine reads to age accounts.
 */
export function readEngine({ lines = [], liabilities = [], crsRows = [], customFields = {}, businesses = [] } = {}) {
  const adapter = toBureaus({
    tradelines: lines,
    liabilities,
    crsResults: crsRows,
    customFields: customFields || {},
    businesses
  });
  const uw = applyStackedBusinessFunding(
    computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
    adapter.businessAges
  );
  const suggestions = buildSuggestions(uw, {
    hasLLC: adapter.hasLLC,
    llcAgeMonths: adapter.llcAgeMonths ?? 0
  });
  const report = buildReport({
    underwrite: uw, suggestions, adapter, fundhubUtilization: evaluateUtilization(lines)
  });
  return { adapter, uw, report };
}

/* ── the score, the tier, the money — all read off one engine result ───────── */

function check(def, passed, value, unit, note = null) {
  return { key: def.key, label: def.label, target: def.target, passed, value, unit, note };
}

/**
 * personalChecks(read) → the six checks, each { key, label, target, passed
 * (true | false | null), value, unit, note }. See the header for each rule.
 */
export function personalChecks({ adapter, uw } = {}) {
  const m = uw?.metrics ?? {};
  const o = uw?.optimization ?? {};
  const p = uw?.personal ?? {};
  const primary = uw?.per_bureau?.[uw?.primary_bureau] ?? {};
  const names = missingNames(adapter?.missing);
  const noLines = names.has("tradelines");
  const openedGap = names.has("opened");
  const [S, U, N, A, I, F] = PERSONAL_CHECKS;

  // No bureau with a score: the engine read nothing, so every check is unknown.
  // (Its optimization flags still come back as booleans over empty input —
  // reading them here would turn "nobody pulled" into "fails".)
  if (!Array.isArray(adapter?.available) || adapter.available.length === 0) {
    return PERSONAL_CHECKS.map((def) => check(def, null, null, null));
  }

  const score = isNum(m.score) && m.score > 0 ? m.score : null;
  const util = isNum(m.utilization_pct) ? m.utilization_pct : null;
  const neg = isNum(m.negative_accounts) ? m.negative_accounts : null;
  const inq = isNum(m.inquiries?.total) ? m.inquiries.total : null;

  let anchor;
  if (noLines) anchor = null;
  else if (o.needs_new_primary_revolving === false) anchor = true;
  // Failing while some lines carry no open date: they cannot count as seasoned,
  // so the true answer may be a pass. Unknown, not a fail.
  else if (openedGap) anchor = null;
  else anchor = false;

  const bureau = BUREAU_LABEL[uw?.primary_bureau] || null;
  return [
    check(S, score === null ? null : score >= FUNDABLE_MIN_SCORE, score, "score",
      score !== null && bureau ? `UnderwriteIQ reads your ${bureau} score — the highest one on file.` : null),
    check(U, util === null ? null : o.needs_util_reduction === false,
      util === null ? null : Math.round(util * 10) / 10, "percent",
      adapter?.utilization?.partial ? "Some cards have no limit or balance on file, so this is a floor." : null),
    check(N, neg === null ? null : neg === 0, neg, "count"),
    check(A, anchor, dollarsToCents(p.highest_revolving_limit), "cents",
      openedGap ? "Some accounts have no open date on file, so they cannot count as 2+ years old."
        : (anchor === false && Number(p.highest_revolving_limit) === 0
          ? "No open card is 2+ years old yet, so UnderwriteIQ counts $0." : null)),
    check(I, inq === null ? null : o.needs_inquiry_cleanup === false, inq, "count"),
    check(F, noLines ? null : o.needs_file_buildout === false,
      noLines ? null : (isNum(primary.positiveTradelinesCount) ? primary.positiveTradelinesCount : null), "count")
  ];
}

/** { score, score_max, unknown } from a check list. */
export function scoreOf(checks = [], { scored = true } = {}) {
  const max = checks.length;
  if (!scored) return { score: null, score_max: max, unknown: max };
  return {
    score: checks.filter((c) => c.passed === true).length,
    score_max: max,
    unknown: checks.filter((c) => c.passed === null).length
  };
}

/** The engine's `fundable` gate as a word. See the header. */
export function tierOf(uw, { scored = true } = {}) {
  if (!scored || !uw) return null;
  if (uw.fundable === true) return "fundable";
  const m = uw.metrics ?? {};
  const measuredFail =
    (isNum(m.score) && m.score > 0 && m.score < FUNDABLE_MIN_SCORE) ||
    (isNum(m.utilization_pct) && m.utilization_pct > 30) ||
    (isNum(m.negative_accounts) && m.negative_accounts > 0);
  return measuredFail ? "not_fundable" : null;
}

/** The engine's money figure, in cents, only for a fundable file: the lower of
 *  the primary bureau's own figure and the engine's total (see the header). */
export function fundingEstimateCents(uw, tier) {
  if (tier !== "fundable") return null;
  const oneBureau = dollarsToCents(uw?.per_bureau?.[uw?.primary_bureau]?.totalPersonalFunding);
  const total = dollarsToCents(uw?.totals?.total_personal_funding);
  if (oneBureau === null) return total;
  if (total === null) return oneBureau;
  return Math.min(oneBureau, total);
}

/** The engine's sentences, client-safe (same filter as the Credit page), each
 *  tagged with the check it speaks to. LLC lines go to the business cards. */
export function personalSentences(report) {
  return usableSuggestions(report?.suggestions)
    .filter((s) => s.topic !== "llc")
    .map((s) => ({ text: s.text, topic: s.topic, check: CHECK_OF_TOPIC[s.topic] ?? null }));
}

/** Keys of everything the engine needed and did not get, for the personal read. */
export function personalMissing({ adapter } = {}) {
  if (!adapter || !Array.isArray(adapter.available) || adapter.available.length === 0) {
    return ["credit_pull"];
  }
  const out = [];
  for (const b of BUREAUS) {
    if ((adapter.missing?.[b] || []).some((e) => e.field === "score")) out.push(`${b}_score`);
  }
  const names = missingNames(adapter.missing);
  if (names.has("inquiries")) out.push("inquiries");
  if (adapter.utilization?.pct === null) out.push("utilization");
  if (names.has("negatives")) out.push("negative_items");
  if (names.has("late_payment_events")) out.push("late_payments");
  if (names.has("tradelines")) out.push("accounts");
  if (names.has("opened")) out.push("opened_dates");
  return out;
}

function checkMap(checks) {
  const out = {};
  for (const c of checks) out[c.key] = c.passed;
  return out;
}

/* ── the client's own plan ──────────────────────────────────────────────────── */

/**
 * paydownPlan(waypointRows) → [{ key, state, creditor, creditor_key, prints,
 * target_cents, due_on }]. Only paydown waypoints that are still the plan
 * (not skipped, not blocked) and carry a target. A paydown with no due date is
 * kept so the page can list it, and is never applied to a point — a step with
 * no date says nothing about when.
 */
export function paydownPlan(rows = []) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r) continue;
    const p = safeObject(r.params) || {};
    const isPaydown = r.verify_kind === "paydown" || p.definition_key === "paydown_revolving_account";
    if (!isPaydown || !PLAN_STATES.has(String(r.state))) continue;
    const target = cents(p.target_cents);
    if (target === null || target < 0) continue;
    const creditor = text(p.creditor);
    out.push({
      key: r.key,
      state: r.state,
      creditor,
      creditor_key: text(p.creditor_key) || slugify(creditor || ""),
      prints: Array.isArray(p.account_prints) ? p.account_prints.map(String) : [],
      target_cents: target,
      due_on: dayOf(r.due_at)
    });
  }
  return out;
}

/** Does this line belong to this paydown? Print first (open date + last four,
 *  what a bureau does not rewrite), creditor name second — the same order the
 *  waypoint seeder uses (src/waypoints/definitions.mjs). */
function paydownMatches(line, pd) {
  if (!line || line.closed_at || line.kind !== "revolving") return false;
  const print = accountPrint(isoDay(line.opened_on), line.last4);
  if (print && pd.prints.includes(print)) return true;
  return Boolean(pd.creditor_key) && slugify(line.lender || "") === pd.creditor_key;
}

/**
 * disputeTargets(itemRows) → { accounts, items }. Open derogatory dispute items
 * only, counted by distinct account (creditor + last four). An item naming
 * neither counts on its own. Nothing here says a removal will happen.
 */
export function disputeTargets(rows = []) {
  const keys = new Set();
  let items = 0;
  for (const it of Array.isArray(rows) ? rows : []) {
    if (!it || !isDerogatoryRuleId(it.rule_id)) continue;
    if (!OPEN_DISPUTE_STATUSES.includes(String(it.status))) continue;
    items += 1;
    const creditor = slugify(it.creditor || "");
    const last4 = String(it.account_last4 || "").replace(/\D/g, "").slice(-4);
    keys.add(creditor || last4 ? `${creditor}|${last4}` : `item:${it.id ?? items}`);
  }
  return { accounts: keys.size, items };
}

/* ── one projected copy of the file ─────────────────────────────────────────── */

function money(c) {
  return isNum(c) ? `$${Math.round(c / 100).toLocaleString("en-US")}` : null;
}

function niceDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  if (!m) return null;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** The plain sentence for "time passes", shared by the personal and business lines. */
function timeNote(months) {
  return { kind: "time", text: `${months} months go by. Your open accounts stay open.` };
}

/** The plain sentence for the dispute scenario. Says, every time, that it is not promised. */
function removalNote(accounts, before, after) {
  const one = accounts === 1;
  return {
    kind: "if_removed",
    text: `Your dispute plan targets ${accounts} negative ${one ? "account" : "accounts"}. ` +
      `If ${one ? "it comes" : "they come"} off, negative items go from ${before} to ${after}. ` +
      "That is not promised — a bureau can keep an item."
  };
}

/**
 * projectFile(base, { months, date, paydowns, removal }) → { input, notes } —
 * the rows the engine reads at that point, plus one { kind, text } note for
 * every change actually made (kind: time | paydown | business_age | if_removed).
 * Nothing outside the header's list is touched; `base` is never mutated.
 * `removal` is { accounts, after } for the dispute scenario, or null.
 */
export function projectFile(base, { months = 0, date = null, paydowns = [], removal = null } = {}) {
  const notes = [];
  const baseLines = base.lines || [];
  const lines = baseLines.map((l) => ({ ...l }));

  if (months > 0) notes.push(timeNote(months));

  // Paydowns, matched on the accounts as they are today.
  for (const pd of paydowns) {
    if (!pd.due_on || !date || pd.due_on > date) continue;
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      if (!paydownMatches(baseLines[i], pd)) continue;
      const bal = cents(lines[i].balance_cents);
      if (bal !== null && bal > pd.target_cents) {
        lines[i].balance_cents = pd.target_cents;
        changed = true;
      }
    }
    // Listed only when it moved a balance: a card already at its target is not
    // an assumption this point used.
    if (changed) {
      notes.push({
        kind: "paydown",
        text: `You pay ${pd.creditor || "this card"} down to ${money(pd.target_cents)} — ` +
          `a step in your plan, due ${niceDay(pd.due_on)}.`
      });
    }
  }

  // Time: every account-opened date moves back, so the engine reads it older.
  if (months > 0) {
    for (const l of lines) {
      const day = isoDay(l.opened_on);
      if (day) l.opened_on = addMonths(day, -months);
    }
  }

  const cf = { ...(base.customFields || {}) };
  const businesses = (base.businesses || []).map((b) => ({ ...b }));
  if (months > 0 && businesses.length > 0) {
    const fallback = count(cf.business_age_months);
    if (fallback !== null) cf.business_age_months = fallback + months;
    let older = fallback !== null;
    for (const b of businesses) {
      const age = finiteAgeMonths(b.age_months);
      if (age !== null) { b.age_months = age + months; older = true; }
    }
    if (older) notes.push({ kind: "business_age", text: `Each business on file is ${months} months older.` });
  }

  if (removal) {
    const before = count(cf.crs_negative_items_count);
    cf.crs_negative_items_count = removal.after;
    notes.push(removalNote(removal.accounts, before, removal.after));
  }

  return {
    input: { lines, liabilities: base.liabilities || [], crsRows: base.crsRows || [], customFields: cf, businesses },
    notes
  };
}

/** One point on the personal line: the engine re-run on the projected file. */
function personalPoint(read, scored) {
  const checks = personalChecks(read);
  const tier = tierOf(read.uw, { scored });
  return {
    checks,
    tier,
    ...scoreOf(checks, { scored }),
    funding_estimate_cents: fundingEstimateCents(read.uw, tier)
  };
}

/* ── businesses ─────────────────────────────────────────────────────────────── */

/**
 * businessEntries({ businessRows, containers, customFields }) → one entry per
 * company UnderwriteIQ counts (every `businesses` row — the engine stacks a
 * slice per saved company), tied to its FinanceOS container when the row came
 * from FinanceOS, then one entry per business container with no info saved yet.
 */
export function businessEntries({ businessRows = [], containers = [], customFields = {} } = {}) {
  const fallback = count(customFields?.business_age_months);
  const linked = new Set();
  const out = [];
  for (const row of Array.isArray(businessRows) ? businessRows : []) {
    if (!row) continue;
    const e = safeObject(row.entity_data) || {};
    const containerId = e.source === "finance_os" && e.entity_id ? String(e.entity_id) : null;
    if (containerId) linked.add(containerId);
    const container = containerId ? containers.find((c) => String(c.id) === containerId) : null;
    out.push({
      row,
      container_id: containerId,
      business_id: row.id ?? null,
      name: text(row.name) || text(e.name) || text(container?.name),
      source: text(e.source),
      has_info: true,
      // The same age the engine uses: the row's own, else the client fallback
      // (resolveBusinessAges in src/underwrite/business-funding.mjs).
      age_months: finiteAgeMonths(row.age_months) ?? fallback
    });
  }
  for (const c of Array.isArray(containers) ? containers : []) {
    if (!c || c.kind !== "business" || c.archived_at || linked.has(String(c.id))) continue;
    out.push({ row: null, container_id: String(c.id), business_id: null, name: text(c.name),
      source: null, has_info: false, age_months: null });
  }
  return out;
}

/** The engine's own LLC sentence for one company of this age (verbatim). */
function llcSentences(uw, age) {
  if (age === null) return [];
  return buildSuggestions(uw, { hasLLC: true, llcAgeMonths: age })
    .filter((t) => SUGGESTION_CATALOGUE[t]?.topic === "llc")
    .map((t) => ({ text: t, topic: "llc", check: null }));
}

/** One business, read against one personal engine result. */
export function businessRead({ uw, tier, checks, scored }, entry, age) {
  const [P, A, G, N, C] = BUSINESS_CHECKS;
  const personalAnchor = checks.find((c) => c.key === "anchor_card") || {};
  const anchor = personalAnchor.passed ?? null;
  const primary = uw?.per_bureau?.[uw?.primary_bureau] ?? {};
  const card = Number(primary.cardFunding) || 0;
  const slice = age === null ? null : stackedBusinessFunding(card, [age]);
  const naics = companyNaics(entry.row);
  const bchecks = [
    check(P, tier === "fundable" ? true : tier === "not_fundable" ? false : null, tier, "tier"),
    check(A, anchor, personalAnchor.value ?? null, personalAnchor.unit ?? null),
    check(G, age === null ? null : age >= TOP_BAND_MONTHS, age, "months",
      age === null ? null : `At this age UnderwriteIQ gives this business ${businessAgeMultiplier(age)}× your card figure.`),
    check(N, companyHasName(entry.row), entry.name, "text"),
    check(C, naics !== null, naics, "text",
      naics === null && entry.source === "finance_os"
        ? "FinanceOS has no place to save an industry code yet." : null)
  ];
  let btier = null;
  if (scored) {
    if (tier === "not_fundable" || anchor === false) btier = "not_fundable";
    else if (tier === "fundable" && isNum(slice) && slice > 0) btier = "fundable";
  }
  const missing = [];
  if (!scored) missing.push("credit_pull");
  if (age === null) missing.push("business_age");
  return {
    checks: bchecks,
    tier: btier,
    ...scoreOf(bchecks, { scored }),
    multiplier: age === null ? null : businessAgeMultiplier(age),
    funding_estimate_cents: btier === "fundable" ? dollarsToCents(slice) : null,
    missing,
    sentences: scored ? llcSentences(uw, age) : []
  };
}

/* ── the whole payload ──────────────────────────────────────────────────────── */

/**
 * buildFundability — pure apart from the engine's clock. Rows in, contract out.
 */
export function buildFundability({
  client = {}, asOf = new Date(), crsRows = [], tradelineRows = [], liabilities = [],
  businessRows = [], containers = [], waypoints = [], disputeItems = [],
  months = PROJECTION_MONTHS
} = {}) {
  const cf = safeObject(client.custom_fields) || {};
  const newestFirst = [...crsRows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const bizOrdered = [...businessRows].sort((a, b) =>
    new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const { tradelines: lines, source: lineSource } = linesForEngine(tradelineRows, newestFirst);
  const base = { lines, liabilities, crsRows: newestFirst, customFields: cf, businesses: bizOrdered };

  const today = dayOf(asOf);
  const nowRead = readEngine(base);
  const scored = Array.isArray(nowRead.adapter.available) && nowRead.adapter.available.length > 0;
  const nowPoint = personalPoint(nowRead, scored);

  const paydowns = paydownPlan(waypoints);
  const disputes = disputeTargets(disputeItems);
  const negativesNow = count(cf.crs_negative_items_count);
  // The dashed line exists only when there is something for it to say: a plan
  // that targets negative accounts, against a measured count above zero.
  const scenario = scored && disputes.accounts > 0 && negativesNow !== null && negativesNow > 0;
  const removal = scenario
    ? { accounts: disputes.accounts, after: Math.max(0, negativesNow - disputes.accounts) }
    : null;

  const entries = businessEntries({ businessRows: bizOrdered, containers, customFields: cf });
  const bizNow = entries.map((e) => (e.has_info ? businessRead({ ...nowPoint, uw: nowRead.uw, scored }, e, e.age_months) : null));

  const projections = [];
  const bizProjections = entries.map(() => []);
  const lineups = scored ? [["plan", null]] : [];
  if (scenario) lineups.push(["if_removed", removal]);

  for (const [kind, rem] of lineups) {
    for (const m of months) {
      const date = addMonths(today, m);
      const proj = projectFile(base, { months: m, date, paydowns, removal: rem });
      const read = readEngine(proj.input);
      const point = personalPoint(read, scored);
      projections.push({
        date, months: m, scenario: kind,
        score: point.score, score_max: point.score_max, unknown: point.unknown,
        tier: point.tier,
        funding_estimate_cents: point.funding_estimate_cents,
        assumptions: proj.notes.map((n) => n.text),
        checks: checkMap(point.checks),
        sentences: personalSentences(read.report)
      });
      entries.forEach((e, i) => {
        if (!e.has_info) return;
        const age = e.age_months === null ? null : e.age_months + m;
        const b = businessRead({ ...point, uw: read.uw, scored }, e, age);
        // The same notes, with this company's own age in place of "each business".
        const bAssume = [];
        for (const n of proj.notes) {
          if (n.kind === "business_age") {
            if (age !== null) bAssume.push(`${e.name || "This business"} is ${age} months old.`);
          } else {
            bAssume.push(n.text);
          }
        }
        bizProjections[i].push({
          date, months: m, scenario: kind,
          score: b.score, score_max: b.score_max, unknown: b.unknown,
          tier: b.tier,
          funding_estimate_cents: b.funding_estimate_cents,
          multiplier: b.multiplier,
          assumptions: bAssume,
          checks: checkMap(b.checks)
        });
      });
    }
  }

  const tri = triMerge(newestFirst);
  const first = text(client.first_name);
  const last = text(client.last_name);

  return {
    ok: true,
    client: { id: text(client.id), name: [first, last].filter(Boolean).join(" ") || null },
    as_of: new Date(asOf).toISOString(),
    has_pull: scored,
    // True when the scores came off a sample report, never a bureau.
    sample: tri.sample === true,
    engine: { name: "underwrite_iq_lite", upstream_commit: UPSTREAM.commit, accounts_from: lineSource },
    now: {
      score: nowPoint.score,
      score_max: nowPoint.score_max,
      unknown: nowPoint.unknown,
      tier: nowPoint.tier,
      funding_estimate_cents: nowPoint.funding_estimate_cents,
      factors: nowPoint.checks,
      missing: personalMissing(nowRead),
      sentences: scored ? personalSentences(nowRead.report) : []
    },
    projections,
    businesses: entries.map((e, i) => {
      const credit = e.row ? businessScoreFromPulls(newestFirst, e.row) : null;
      const b = bizNow[i];
      return {
        container_id: e.container_id,
        business_id: e.business_id,
        name: e.name,
        source: e.source,
        has_info: e.has_info,
        age_months: e.age_months,
        credit: credit && credit.found
          ? { intelliscore: credit.intelliscore, fsr: credit.fsr, sample: credit.sample === true }
          : null,
        now: b ? {
          score: b.score, score_max: b.score_max, unknown: b.unknown,
          tier: b.tier,
          funding_estimate_cents: b.funding_estimate_cents,
          multiplier: b.multiplier,
          factors: b.checks,
          missing: b.missing,
          sentences: b.sentences
        } : null,
        projections: bizProjections[i]
      };
    }),
    plan: {
      paydowns: paydowns.map((pd) => ({
        creditor: pd.creditor, target_cents: pd.target_cents, due_on: pd.due_on, state: pd.state
      })),
      dispute_accounts: disputes.accounts,
      if_removed: scenario
    },
    cannot_project: [...CANNOT_PROJECT]
  };
}

/* ── the read ───────────────────────────────────────────────────────────────── */

/* Demo rows are left out, as the Credit page and the portal leave them out. */
const CRS_SQL = `
  SELECT id, result, created_at
    FROM crs_results
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY created_at DESC`;
const TRADELINE_SQL = `
  SELECT * FROM tradelines
   WHERE client_id = $1 AND org_id = $2
     AND is_demo IS NOT TRUE
   ORDER BY apr ASC NULLS LAST, lender ASC`;
const LIABILITY_SQL = `
  SELECT * FROM card_liabilities
   WHERE client_id = $1 AND org_id = $2
   ORDER BY as_of DESC`;
const BUSINESS_SQL = `
  SELECT id, name, age_months, entity_data, created_at, updated_at
    FROM businesses
   WHERE client_id = $1 AND org_id = $2
   ORDER BY created_at ASC, id`;
const CONTAINER_SQL = `
  SELECT id, kind, name, archived_at, created_at
    FROM entities
   WHERE client_id = $1 AND org_id = $2 AND kind = 'business'
   ORDER BY created_at ASC, id`;
const WAYPOINT_SQL = `
  SELECT key, state, due_at, verify_kind, params
    FROM client_waypoints
   WHERE client_id = $1 AND org_id = $2
     AND (verify_kind = 'paydown' OR params->>'definition_key' = 'paydown_revolving_account')
   ORDER BY position ASC, key ASC`;
const DISPUTE_SQL = `
  SELECT id, rule_id, status, creditor, account_last4
    FROM dispute_items
   WHERE client_id = $1 AND org_id = $2`;

/**
 * fundability(db, { orgId, clientId, asOf }) → the contract, or null when the
 * client is not in that org (the caller answers 404). Read only.
 */
export async function fundability(db, { orgId, clientId, asOf = new Date() } = {}) {
  const clientRes = await db.query(
    `SELECT id, first_name, last_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const args = [clientId, orgId];
  const [crs, lines, liabilities, businesses, containers, waypoints, disputes] = await Promise.all([
    db.query(CRS_SQL, args),
    db.query(TRADELINE_SQL, args),
    db.query(LIABILITY_SQL, args),
    db.query(BUSINESS_SQL, args),
    db.query(CONTAINER_SQL, args),
    db.query(WAYPOINT_SQL, args),
    db.query(DISPUTE_SQL, args)
  ]);

  return buildFundability({
    client,
    asOf,
    crsRows: crs.rows,
    tradelineRows: lines.rows,
    liabilities: liabilities.rows,
    businessRows: businesses.rows,
    containers: containers.rows,
    waypoints: waypoints.rows,
    disputeItems: disputes.rows
  });
}

export default fundability;
