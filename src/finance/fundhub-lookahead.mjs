// The Fundhub look-ahead: the Fundhub score now and at any month from 1 to 24,
// and the closer's dated roadmap. Back end of the "If they follow the plan"
// staff card (public/app/fundhub-plan-card.js) and the "Your Fundhub score"
// card on the client's Fundability section (public/app/money-fundability.js).
// Read by GET /api/money/fundability?view=lookahead|plan&months=N.
//
// Owner, Chris 2026-11-07: "on sales calls, take someone with a messed-up file:
// follow these steps, and we can see you will be eligible for money in nine
// months for this amount, because we know what UnderwriteIQ will see that file
// as nine months from now." And: "We're just using UnderwriteIQ... For now,
// it's an estimate."
//
// ONE BRAIN, UNTOUCHED. Every number comes out of UnderwriteIQ through the
// exports of src/finance/fundability.mjs, called as they are: readEngine,
// projectFile, personalChecks, tierOf, fundingEstimateCents, businessEntries,
// businessRead. Neither that file nor src/underwrite/** is changed by this one
// (owner-set 2026-11-07). A month-N point is that file's own projectFile copy
// of the client's file, re-run through the same engine.
//
// WHAT A POINT MAY CHANGE — exactly the fundability projection rules:
//   time          every account N months older; open accounts stay open
//   businesses    each company N months older
//   paydowns      the client's own paydown waypoints due by that date
//   if removed    a separate line: the dispute plan's target accounts come off,
//                 and only from the date the repair rounds end (REPAIR_ROUND_WINDOW)
// Nothing else. No new accounts, no score movement, no bank data: the engine
// cannot say, so the page lists them under "What this assumes".
//
// BUSINESSES. Each business gets UnderwriteIQ's own slice at month N (card
// funding × the age multiplier, 0.5 / 1 / 2), listed one by one. They are never
// added into one total, and personal is never added to business.
//
// UNKNOWN IS NULL, NEVER 0. Money is integer cents. READ ONLY. Every query
// carries org_id AND client_id.

import {
  readEngine, projectFile, personalChecks, tierOf, scoreOf, fundingEstimateCents,
  paydownPlan, disputeTargets, businessEntries, businessRead, addMonths, dayOf
} from "./fundability.mjs";
import { fundhubScore, fundingReachFrom } from "./fundhub-score.mjs";
import { triMerge, businessScoreFromPulls } from "../http/client-detail.mjs";
import { linesForEngine } from "../tradelines/index.mjs";
import { fundingOpportunityFromCreditRows } from "../blueprint/funding-opportunity.mjs";
import { readRelationships } from "./bank-strategy.mjs";

/** The quick picks on both cards. Month 9 is the sales-call month (owner-set 2026-11-07). */
export const LOOKAHEAD_MONTHS = Object.freeze([3, 6, 9, 12]);
/** The month the client card and the staff card open on. */
export const DEFAULT_LOOKAHEAD_MONTH = 9;
/** The "any month" picker runs from 1 to 24. */
export const MIN_LOOKAHEAD_MONTH = 1;
export const MAX_LOOKAHEAD_MONTH = 24;

/**
 * One dispute round, in calendar days. Owner-set 2026-11-07: draft, Chris tunes.
 *   mail_out_days      7   a First-Class letter takes 1 to 5 business days to
 *                          arrive (USPS), so 7 calendar days
 *   investigation_days 30  FCRA, 15 U.S.C. §1681i(a)(1)(A): the bureau has 30
 *                          days from getting the dispute to finish looking into
 *                          it. (§1681i(a)(1)(B) allows 45 when the consumer sends
 *                          more during the 30; not assumed here.)
 *   results_back_days  7   FCRA §1681i(a)(6)(A): the bureau sends the results
 *                          within 5 business days of finishing, so 7 calendar days
 * A round on file with a response due date ends that day plus results_back_days.
 * A round mailed with no due date ends mailed + all three. A round not mailed
 * yet ends today + all three ("if it is mailed today").
 */
export const REPAIR_ROUND_WINDOW = Object.freeze({ mail_out_days: 7, investigation_days: 30, results_back_days: 7 });
export const REPAIR_ROUND_DAYS = REPAIR_ROUND_WINDOW.mail_out_days +
  REPAIR_ROUND_WINDOW.investigation_days + REPAIR_ROUND_WINDOW.results_back_days;

/** dispute_cases statuses that are still a round in play (160_metro2_dispute_engine.sql). */
export const OPEN_CASE_STATUSES = Object.freeze(["open", "awaiting_response", "stalled"]);

/** What every point takes as given. Light words (owner-set 2026-11-07). */
export const LOOKAHEAD_ASSUMES = Object.freeze([
  "Your credit scores stay where they are today. UnderwriteIQ reads scores from a pull and does not guess new ones.",
  "Nothing new hits your file: no new accounts, no new negative items and no new hard inquiries.",
  "New accounts are not added. Only what is on file today, plus your own plan steps.",
  "Hard inquiries and late payments stay as they are. UnderwriteIQ has no age window for them.",
  "Bank history is not read. UnderwriteIQ does not look at deposits."
]);

const BUREAU_WORDS = Object.freeze({ EX: "Experian", EQ: "Equifax", TU: "TransUnion" });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── business evidence ────────────────────────────────────────────────────── */

/**
 * businessEvidence(entry, { crsRows, customFields }) → { report, reviewed, supported }
 *
 * Codex finding (binding, 2026-11-07): a business funding amount is shown only
 * when business evidence supports it. Two kinds count: a saved business credit
 * report on a real (non-sandbox) pull that matches this company
 * (businessScoreFromPulls, src/http/client-detail.mjs, the same match the Credit
 * tab uses), or its formation and EIN papers reviewed on the Blueprint plan.
 * UnderwriteIQ's figure stays in the read; `supported` says whether to show it.
 */
export function businessEvidence(entry, { crsRows = [], customFields = {} } = {}) {
  const report = !!(entry && entry.row && businessScoreFromPulls(crsRows, entry.row).found === true);
  const plans = safeObject(customFields && customFields.blueprint_business_plans);
  const list = plans && Array.isArray(plans.businesses) ? plans.businesses : [];
  const id = entry && entry.business_id != null ? String(entry.business_id) : null;
  const plan = id ? list.find((b) => b && b.businessId != null && String(b.businessId) === id) : null;
  const ev = (plan && plan.evidence) || {};
  const reviewed = !!(ev.formation && ev.formation.status === "reviewed" && ev.ein && ev.ein.status === "reviewed");
  return { report, reviewed, supported: report || reviewed };
}

/* ── small readers ─────────────────────────────────────────────────────────── */

function isNum(v) { return typeof v === "number" && Number.isFinite(v); }
function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function safeObject(v) {
  if (!v) return null;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return null; }
}
function count(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function money(c) { return isNum(c) ? `$${Math.round(c / 100).toLocaleString("en-US")}` : null; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/** "2027-08-07" → "Aug 7, 2027". */
export function niceDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : null;
}

/** "2026-11-07" + 44 → "2026-12-21". null in, null out. */
export function addDays(day, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(day || ""));
  if (!m || !Number.isInteger(n)) return null;
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
  return t.toISOString().slice(0, 10);
}

/**
 * parseLookaheadMonth(raw) → a whole month 1–24, null when nothing was asked,
 * or NaN when the ask is not a whole month in range (the caller answers 400).
 */
export function parseLookaheadMonth(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const s = String(Array.isArray(raw) ? raw[0] : raw).trim();
  if (!/^\d{1,2}$/.test(s)) return NaN;
  const n = Number(s);
  return n >= MIN_LOOKAHEAD_MONTH && n <= MAX_LOOKAHEAD_MONTH ? n : NaN;
}

/** The months to run: the quick picks plus the one asked for, in order, once each. */
export function lookaheadMonths(asked = null) {
  const set = new Set(LOOKAHEAD_MONTHS);
  if (Number.isInteger(asked) && asked >= MIN_LOOKAHEAD_MONTH && asked <= MAX_LOOKAHEAD_MONTH) set.add(asked);
  return [...set].sort((a, b) => a - b);
}

/* ── the repair timeline ──────────────────────────────────────────────────── */

/**
 * repairTimeline({ cases, today }) → { finish_on, round_days, window, rounds, text }.
 * `cases` are dispute_cases rows (+ mailed_at, the newest letter mailing). Only
 * rounds still in play count. With none on file the dispute plan has not been
 * mailed yet, so one round from today is counted ("if it is mailed today").
 * This is a date estimate, never a claim that anything will come off.
 */
export function repairTimeline({ cases = [], today } = {}) {
  const W = REPAIR_ROUND_WINDOW;
  const rounds = [];
  for (const c of Array.isArray(cases) ? cases : []) {
    if (!c || !OPEN_CASE_STATUSES.includes(String(c.status))) continue;
    const due = dayOf(c.response_due_at);
    const mailed = dayOf(c.mailed_at);
    let finish;
    let basis;
    if (due) { finish = addDays(due, W.results_back_days); basis = "response_due"; }
    else if (mailed) { finish = addDays(mailed, REPAIR_ROUND_DAYS); basis = "mailed"; }
    else { finish = addDays(today, REPAIR_ROUND_DAYS); basis = "not_mailed"; }
    // A round whose window has already run out is still open on file: its
    // answer is late, so it ends no earlier than today.
    if (finish < today) { finish = today; basis = "past_due"; }
    rounds.push({ bureau: BUREAU_WORDS[c.bureau] || text(c.bureau), round: text(c.round), status: text(c.status), basis, finish_on: finish });
  }
  if (rounds.length === 0) rounds.push({ bureau: null, round: null, status: null, basis: "not_mailed", finish_on: addDays(today, REPAIR_ROUND_DAYS) });
  const finishOn = rounds.map((r) => r.finish_on).sort().pop();
  const notMailed = rounds.every((r) => r.basis === "not_mailed");
  return {
    finish_on: finishOn,
    round_days: REPAIR_ROUND_DAYS,
    window: { ...W },
    rounds,
    text: `Repair rounds end about ${niceDay(finishOn)}, if all negative items are removed by then.` +
      (notMailed ? " That counts one round mailed today." : "")
  };
}

/* ── one point ────────────────────────────────────────────────────────────── */

/* projectFile's notes, in this card's words. The removal line is rewritten
   lighter (owner-set 2026-11-07); every other note is the projection's own. */
function noteText(n, ctx) {
  if (n.kind !== "if_removed") return n.text;
  const a = ctx.removal.accounts;
  return `If the ${plural(a, "disputed account comes", "disputed accounts come")} off, negative items go from ${ctx.negativesNow} to ${ctx.removal.after}.`;
}

function pointAt(base, ctx, months, scenario) {
  const date = addMonths(ctx.today, months);
  const removalApplied = scenario === "if_removed" && Boolean(ctx.repair) && date >= ctx.repair.finish_on;
  const proj = projectFile(base, { months, date, paydowns: ctx.paydowns, removal: removalApplied ? ctx.removal : null });
  const read = readEngine(proj.input);
  const checks = personalChecks(read);
  const tier = tierOf(read.uw, { scored: ctx.scored });
  const counted = scoreOf(checks, { scored: ctx.scored });
  const assumptions = proj.notes.map((n) => noteText(n, ctx));
  if (scenario === "if_removed" && !removalApplied) {
    assumptions.push(`Your repair rounds run until about ${niceDay(ctx.repair.finish_on)}, so nothing comes off by this date.`);
  }
  return {
    months,
    date,
    scenario,
    removal_applied: removalApplied,
    fundhub_score: fundhubScore({ checks, tier, scored: ctx.scored, funding: ctx.funding }),
    checks_passed: counted.score,
    checks_max: counted.score_max,
    tier,
    funding_estimate_cents: fundingEstimateCents(read.uw, tier),
    assumptions,
    businesses: ctx.entries.filter((e) => e.has_info).map((e) => {
      const age = e.age_months === null ? null : e.age_months + months;
      const b = businessRead({ uw: read.uw, tier, checks, scored: ctx.scored }, e, age);
      return {
        business_id: e.business_id, container_id: e.container_id, name: e.name,
        age_months: age, tier: b.tier, multiplier: b.multiplier,
        funding_estimate_cents: b.funding_estimate_cents,
        ...ctx.evidenceOf(e)
      };
    })
  };
}

/* ── the closer's roadmap ─────────────────────────────────────────────────── */

const TIER_WORDS = Object.freeze({ fundable: "Fundable", not_fundable: "not fundable yet" });

/**
 * closingLine({ todayTier, months, target, usesRemoval }) — the line the closer
 * leads with. Personal only: each business is listed on its own, never summed.
 * No probability words. Every figure is an UnderwriteIQ estimate.
 */
export function closingLine({ todayTier = null, months, target = null, usesRemoval = false } = {}) {
  const today = todayTier === "fundable" ? "Fundable today."
    : (todayTier === "not_fundable" ? "Not fundable today." : "UnderwriteIQ cannot tell yet today.");
  if (!target || !target.tier) {
    return `${today} UnderwriteIQ needs more of the file on record before it can look ahead.`;
  }
  const when = `in ${plural(months, "month", "months")}`;
  const cond = usesRemoval
    ? "If you follow this plan, the disputed items come off and nothing new hits your file"
    : "If you follow this plan and nothing new hits your file";
  let line = `${today} ${cond}, ${when} UnderwriteIQ estimates ${TIER_WORDS[target.tier]}`;
  const personal = money(target.funding_estimate_cents);
  if (personal) line += `, about ${personal} personal`;
  return `${line}.`;
}

/** The Blueprint ChexSystems step, when the client has a Blueprint plan. */
export function chexStep(customFields = {}) {
  const plans = safeObject(customFields && customFields.blueprint_business_plans);
  if (!plans || !Array.isArray(plans.stepProgress)) return null;
  const row = plans.stepProgress.find((s) => s && s.stepKey === "chexsystems" && !s.businessPlanId) ||
    plans.stepProgress.find((s) => s && s.stepKey === "chexsystems") || null;
  return {
    kind: "chexsystems",
    date: row ? dayOf(row.targetDate) : null,
    done: row ? row.status === "reported_complete" : false,
    text: "Check the ChexSystems report before opening bank accounts."
  };
}

/**
 * roadmapSteps({ today, repair, paydowns, chex, relationships, entries }) → one
 * dated path, in date order (undated steps last). Only the client's own plan:
 * repair rounds, paydown waypoints, the ChexSystems step, the bank accounts on
 * their tracker and each one's seasoning, and each business crossing
 * UnderwriteIQ's 12- and 24-month lines.
 */
export function roadmapSteps({ today, repair = null, paydowns = [], chex = null, relationships = [], entries = [] } = {}) {
  const steps = [];
  if (repair) steps.push({ kind: "repair", date: repair.finish_on, done: false, text: repair.text });
  for (const pd of Array.isArray(paydowns) ? paydowns : []) {
    steps.push({ kind: "paydown", date: pd.due_on, done: pd.state === "done",
      text: `Pay ${pd.creditor || "this card"} down to ${money(pd.target_cents)}.` });
  }
  if (chex) steps.push(chex);
  for (const r of Array.isArray(relationships) ? relationships : []) {
    if (!r || r.status === "skipped") continue;
    const bank = text(r.bank) || "the bank";
    const kind = r.account_kind === "business" ? "business" : "personal";
    if (r.status === "planned") {
      steps.push({ kind: "bank_account", date: r.planned_open_on || null, done: false, text: `Open the ${bank} ${kind} account.` });
      if (r.seasoning && r.planned_open_on) {
        steps.push({ kind: "seasoning", date: addDays(r.planned_open_on, r.seasoning.days), done: false,
          text: `The ${bank} account is seasoned (${r.seasoning.days} days).` });
      }
    } else if (r.status === "seasoning" && r.seasoned_on) {
      steps.push({ kind: "seasoning", date: r.seasoned_on, done: false, text: `The ${bank} account is seasoned (${r.seasoning.days} days).` });
    }
  }
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !e.has_info || !isNum(e.age_months)) continue;
    const name = e.name || "The business";
    for (const [line, mult] of [[12, 1], [24, 2]]) {
      if (e.age_months >= line) continue;
      steps.push({ kind: "business_age", date: addMonths(today, line - e.age_months), done: false,
        text: `${name} turns ${line} months. UnderwriteIQ's business figure moves to ${mult}× the card figure.` });
    }
  }
  return steps
    .map((s, i) => ({ ...s, _i: i }))
    .sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      if (a.date && !b.date) return -1;
      if (!a.date && b.date) return 1;
      return a._i - b._i;
    })
    .map(({ _i, ...s }) => s);
}

/* ── the whole payload ────────────────────────────────────────────────────── */

/**
 * buildLookahead — pure apart from the engine's clock. Rows in, contract out.
 * `months` is the month the card shows (1–24); the quick picks always run too.
 * `view` "plan" adds the closer's roadmap (staff only, gated by the endpoint).
 */
export function buildLookahead({
  client = {}, asOf = new Date(), crsRows = [], tradelineRows = [], liabilities = [],
  businessRows = [], containers = [], waypoints = [], disputeItems = [], disputeCases = [],
  relationships = null, months = DEFAULT_LOOKAHEAD_MONTH, view = "lookahead"
} = {}) {
  const cf = safeObject(client.custom_fields) || {};
  const newestFirst = [...crsRows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const bizOrdered = [...businessRows].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  const { tradelines: lines } = linesForEngine(tradelineRows, newestFirst);
  const base = { lines, liabilities, crsRows: newestFirst, customFields: cf, businesses: bizOrdered };
  const today = dayOf(asOf);
  const selected = Number.isInteger(months) && months >= MIN_LOOKAHEAD_MONTH && months <= MAX_LOOKAHEAD_MONTH
    ? months : DEFAULT_LOOKAHEAD_MONTH;

  const nowRead = readEngine(base);
  const scored = Array.isArray(nowRead.adapter.available) && nowRead.adapter.available.length > 0;
  const nowChecks = personalChecks(nowRead);
  const nowTier = tierOf(nowRead.uw, { scored });
  const opportunity = fundingOpportunityFromCreditRows({ crsRows: newestFirst });
  const funding = fundingReachFrom(opportunity);
  const nowCounted = scoreOf(nowChecks, { scored });

  const paydowns = paydownPlan(waypoints);
  const disputes = disputeTargets(disputeItems);
  const negativesNow = count(cf.crs_negative_items_count);
  const scenario = scored && disputes.accounts > 0 && negativesNow !== null && negativesNow > 0;
  const removal = scenario ? { accounts: disputes.accounts, after: Math.max(0, negativesNow - disputes.accounts) } : null;
  const repair = scenario ? repairTimeline({ cases: disputeCases, today }) : null;
  const entries = businessEntries({ businessRows: bizOrdered, containers, customFields: cf });

  const evidence = new Map(entries.map((e) => [e, businessEvidence(e, { crsRows: newestFirst, customFields: cf })]));
  const evidenceOf = (e) => {
    const ev = evidence.get(e) || { report: false, reviewed: false, supported: false };
    return { evidence: { report: ev.report, reviewed: ev.reviewed }, supported: ev.supported };
  };
  const ctx = { today, scored, funding, paydowns, removal, repair, negativesNow, entries, evidenceOf };
  const points = [];
  if (scored) {
    for (const m of lookaheadMonths(selected)) {
      points.push(pointAt(base, ctx, m, "plan"));
      if (scenario) points.push(pointAt(base, ctx, m, "if_removed"));
    }
  }

  const first = text(client.first_name);
  const last = text(client.last_name);
  const now = {
    fundhub_score: fundhubScore({ checks: nowChecks, tier: nowTier, scored, funding }),
    checks_passed: nowCounted.score,
    checks_max: nowCounted.score_max,
    tier: nowTier,
    funding_estimate_cents: fundingEstimateCents(nowRead.uw, nowTier),
    businesses: entries.filter((e) => e.has_info).map((e) => {
      const b = businessRead({ uw: nowRead.uw, tier: nowTier, checks: nowChecks, scored }, e, e.age_months);
      return { business_id: e.business_id, container_id: e.container_id, name: e.name, age_months: e.age_months,
        tier: b.tier, multiplier: b.multiplier, funding_estimate_cents: b.funding_estimate_cents, ...evidenceOf(e) };
    })
  };

  const out = {
    ok: true,
    view: view === "plan" ? "plan" : "lookahead",
    model: now.fundhub_score.model,
    client: { id: text(client.id), name: [first, last].filter(Boolean).join(" ") || null },
    as_of: new Date(asOf).toISOString(),
    has_pull: scored,
    sample: triMerge(newestFirst).sample === true,
    months: selected,
    quick_picks: [...LOOKAHEAD_MONTHS],
    max_months: MAX_LOOKAHEAD_MONTH,
    now,
    points,
    repair,
    plan: {
      paydowns: paydowns.map((pd) => ({ creditor: pd.creditor, target_cents: pd.target_cents, due_on: pd.due_on, state: pd.state })),
      dispute_accounts: disputes.accounts,
      if_removed: scenario
    },
    assumes: [...LOOKAHEAD_ASSUMES]
  };

  if (out.view === "plan") {
    const planAt = points.find((p) => p.months === selected && p.scenario === "plan") || null;
    const ifrAt = points.find((p) => p.months === selected && p.scenario === "if_removed") || null;
    const usesRemoval = Boolean(ifrAt && ifrAt.removal_applied);
    const target = usesRemoval ? ifrAt : planAt;
    out.roadmap = {
      months: selected,
      date: target ? target.date : addMonths(today, selected),
      scenario: target ? target.scenario : null,
      closing_line: closingLine({ todayTier: nowTier, months: selected, target, usesRemoval }),
      steps: roadmapSteps({ today, repair, paydowns, chex: chexStep(cf), relationships: relationships || [], entries }),
      bank_steps_read: Array.isArray(relationships),
      businesses: target ? target.businesses : []
    };
  }
  return out;
}

/* ── the read ─────────────────────────────────────────────────────────────── */

/* The same rows fundability.mjs reads, each scoped to client AND org. Demo
   rows are left out, as that read leaves them out. */
const CLIENT_SQL = `SELECT id, first_name, last_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`;
const CRS_SQL = `
  SELECT id, provider, is_demo, result, created_at
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
const CASE_SQL = `
  SELECT c.id, c.bureau, c.round, c.status, c.response_due_at, c.created_at,
         (SELECT max(l.mailed_at) FROM dispute_letters l
           WHERE l.case_id = c.id AND l.client_id = $1 AND l.org_id = $2) AS mailed_at
    FROM dispute_cases c
   WHERE c.client_id = $1 AND c.org_id = $2
   ORDER BY c.created_at ASC, c.id`;

/**
 * fundhubLookahead(db, { orgId, clientId, asOf, months, view }) → the contract,
 * or null when the client is not in that org (the caller answers 404). Read only.
 * The roadmap's bank steps come from the client's own bank tracker
 * (readRelationships, src/finance/bank-strategy.mjs, read only); if that read
 * fails the roadmap still loads and says so (`bank_steps_read: false`).
 */
export async function fundhubLookahead(db, {
  orgId, clientId, asOf = new Date(), months = DEFAULT_LOOKAHEAD_MONTH, view = "lookahead",
  readBankSteps = readRelationships
} = {}) {
  const clientRes = await db.query(CLIENT_SQL, [clientId, orgId]);
  const client = clientRes.rows[0];
  if (!client) return null;
  const args = [clientId, orgId];
  const [crs, lines, liabilities, businesses, containers, waypoints, disputes, cases] = await Promise.all([
    db.query(CRS_SQL, args),
    db.query(TRADELINE_SQL, args),
    db.query(LIABILITY_SQL, args),
    db.query(BUSINESS_SQL, args),
    db.query(CONTAINER_SQL, args),
    db.query(WAYPOINT_SQL, args),
    db.query(DISPUTE_SQL, args),
    db.query(CASE_SQL, args)
  ]);
  let relationships = null;
  if (view === "plan") {
    try {
      relationships = await readBankSteps(db, { orgId, clientId, today: dayOf(asOf) });
    } catch (e) {
      console.error("fundhub-lookahead: bank steps read failed", e && e.message ? e.message : e);
      relationships = null;
    }
  }
  return buildLookahead({
    client, asOf, months, view, relationships,
    crsRows: crs.rows, tradelineRows: lines.rows, liabilities: liabilities.rows,
    businessRows: businesses.rows, containers: containers.rows, waypoints: waypoints.rows,
    disputeItems: disputes.rows, disputeCases: cases.rows
  });
}

export default fundhubLookahead;
