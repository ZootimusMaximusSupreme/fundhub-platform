// CSM tracking — where each client is, who is falling behind, and the nudge.
//
// Owner call (Chris, 2026-11-07): "CSMs see where each client is (not the whole
// dashboard), get a falling-behind list, and nudge (help, or a paid consulting
// call)." Board: ops/workflows/finance-os-cfo-build-2026-11-06.txt, unit N.
//
// READ ONLY. Nothing in this file writes, sends or pulls. The nudge itself goes
// out through the staff reply path that already exists (POST /api/messages →
// src/messaging/compose.mjs → the dispatcher, with its gate, quiet hours and
// opt-outs). This file only writes the words a CSM can edit before they send.
//
// Every fact below comes from a stored row, never a guess:
//
//   current step      client_waypoints (330) — the first open step by position
//   days on the step  since that step was made, or the last step finished,
//                     whichever is later
//   step late         its own due_at (330: NULL is NOT overdue)
//   late payments     the bank's own flag (Plaid liabilities is_overdue, saved
//                     on account_statement_cycles.raw by plaid-liabilities.mjs)
//                     and Fundhub plan payments past due (clarity-payments.mjs:
//                     an unpaid installment whose due day has passed)
//   seasoning         blueprint_bank_relationship_todos.opened_on (461), the
//                     same tracker bank-strategy.mjs reads
//   can they apply    UnderwriteIQ only (src/finance/fundability.mjs): fundable,
//                     no hard inquiries — plus a bank account open 30+ days
//
// UNKNOWN IS NULL, NEVER 0. A client the bank never told us about has
// bank_late = null, not 0. A client with no Fundhub plan has plan_late = null.
//
// THE APPLY GATE IS L4's (board, owner calls part 3): locked unless UnderwriteIQ
// says fundable, inquiries are clean, and an account is seasoned 30+ days. The
// pass or fail of each check comes from gateChecks() in src/finance/apply-gate.mjs,
// the one place that rule lives. This file only adds the desk's short words.
//
// BANK LOGOS (owner rule 2026-11-07): each opened account on a client's
// seasoning list carries its bank's logo from the shared lookup
// (src/banking/institution-logos.mjs findLogos: Plaid first, then the bank book,
// else null and the name stands alone).

import { dueStep, stepFor, FINAL_STEP } from "../nudge/ladder.mjs";
import { gateChecks, SEASON_DAYS, BETTER_DAYS } from "../finance/apply-gate.mjs";
import { findLogos } from "../banking/institution-logos.mjs";

/** Who may see this view. The CSM desk roles — the same three the Blueprint
    full-package oversight uses (api/blueprint/services.mjs STAFF_ROLES). */
export const TRACKING_ROLES = new Set(["owner", "admin", "csm"]);

/** Owner-set 2026-11-07: an opened account is seasoned at 30 days (L4's SEASON_DAYS). */
export const SEASONED_DAYS = SEASON_DAYS;
/** Owner-set 2026-11-07: "the more seasoning, the better" — 60 and 90 are marked (L4's BETTER_DAYS). */
export const BETTER_SEASONING_DAYS = BETTER_DAYS;

/** A step counts as stuck after the same number of days the nudge ladder waits
    before it hands a stalled step to a person (src/nudge/ladder.mjs, step 4). */
export const STUCK_DAYS = stepFor(FINAL_STEP).daysOverdue;

/** How many candidate clients one read looks at. Bounded so one company with a
    huge list cannot hold the function open; the answer says when it stopped. */
export const MAX_CLIENTS = 500;
export const DEFAULT_PAGE = 25;
export const MAX_PAGE = 50;

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATES = new Set(["not_started", "in_progress", "blocked"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TrackingInputError extends Error {
  constructor(message) { super(message); this.code = "BAD_TRACKING_INPUT"; }
}

/* ── small helpers ─────────────────────────────────────────────────────────── */

function text(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function int(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function iso(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Arizona's calendar day. Arizona is UTC-7 all year (no daylight saving). */
export function arizonaDay(now = new Date()) {
  const at = now instanceof Date ? now : new Date(now);
  return new Date(at.getTime() - 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `now`, never below 0. null when the date is unknown. */
export function wholeDays(from, now = new Date()) {
  const start = iso(from);
  if (!start) return null;
  const end = now instanceof Date ? now : new Date(now);
  return Math.max(0, Math.floor((end.getTime() - new Date(start).getTime()) / DAY_MS));
}

/** Calendar days between two YYYY-MM-DD days (b - a). Same noon rule as bank-strategy.mjs. */
export function calendarDays(a, b) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(b || ""))) return null;
  return Math.round((new Date(`${b}T12:00:00.000Z`) - new Date(`${a}T12:00:00.000Z`)) / DAY_MS);
}

function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

/* ── the step ──────────────────────────────────────────────────────────────── */

/**
 * summarizeSteps(steps) → the same shape the list SQL returns, from one
 * client's full step list. Lets the detail view and the list share stepFacts().
 */
export function summarizeSteps(steps = []) {
  const rows = (Array.isArray(steps) ? steps : []).slice().sort((a, b) =>
    (int(a.position) ?? 0) - (int(b.position) ?? 0) || String(a.key || "").localeCompare(String(b.key || "")));
  const done = rows.filter((r) => r.state === "done" || r.state === "skipped");
  const lastDone = done.map((r) => iso(r.completed_at)).filter(Boolean).sort().at(-1) || null;
  const current = rows.find((r) => OPEN_STATES.has(r.state)) || null;
  return { total: rows.length, done: done.length, lastDoneAt: lastDone, current };
}

/**
 * stepFacts({ total, done, lastDoneAt, current }, now) → where the client is.
 *
 *   current.days_on_step  days since the step was made or the last step was
 *                         finished, whichever is later
 *   current.days_late     days past its own due date; null when it has none or
 *                         is not late (330: a NULL due date is never overdue)
 *   current.reminders     for a late step the CLIENT owns: "running" while the
 *                         nudge ladder is still texting, "done" once it has
 *                         handed the step to a person; null otherwise
 */
export function stepFacts({ total = 0, done = 0, lastDoneAt = null, current = null } = {}, now = new Date()) {
  const t = int(total) ?? 0;
  const d = int(done) ?? 0;
  if (!current) return { total: t, done: d, finished: t > 0 && d >= t, current: null };
  const created = iso(current.created_at);
  const last = iso(lastDoneAt);
  const since = [created, last].filter(Boolean).sort().at(-1) || null;
  const due = iso(current.due_at);
  const nowAt = now instanceof Date ? now : new Date(now);
  const late = due && new Date(due).getTime() < nowAt.getTime();
  const owner = current.owner_kind === "fundhub" ? "fundhub" : "client";
  let reminders = null;
  if (late && owner === "client") {
    const rung = dueStep(due, nowAt);
    reminders = rung && rung.step >= FINAL_STEP ? "done" : "running";
  }
  return {
    total: t,
    done: d,
    finished: false,
    current: {
      id: current.id ?? null,
      key: text(current.key),
      title: text(current.title) || "Untitled step",
      state: current.state,
      reason: text(current.state_reason),
      owner,
      due_at: due,
      since,
      days_on_step: since ? wholeDays(since, nowAt) : null,
      days_late: late ? wholeDays(due, nowAt) : null,
      reminders,
      paid_alternative: int(current.paid_alternative_price_cents) > 0
        ? { label: text(current.paid_alternative_label), price_cents: int(current.paid_alternative_price_cents) }
        : null
    }
  };
}

/* ── payments ──────────────────────────────────────────────────────────────── */

/**
 * paymentFacts({ bankLate, bankKnown, plansOpen, planLate }) → late payments.
 *
 *   bank_late  card or loan payments the bank itself marks overdue. null when
 *              the bank has told us nothing either way (no Plaid liabilities).
 *   plan_late  Fundhub plan payments past their due day and not fully paid.
 *              null when the client has no open Fundhub plan.
 */
export function paymentFacts({ bankLate = null, bankKnown = null, plansOpen = null, planLate = null } = {}) {
  const known = int(bankKnown) ?? 0;
  const bank = known > 0 ? (int(bankLate) ?? 0) : null;
  const plans = int(plansOpen) ?? 0;
  const plan = plans > 0 ? (int(planLate) ?? 0) : null;
  const total = bank === null && plan === null ? null : (bank ?? 0) + (plan ?? 0);
  return { bank_late: bank, plan_late: plan, total_late: total };
}

/* ── seasoning ─────────────────────────────────────────────────────────────── */

/**
 * seasoningFacts(accounts, today) → the seasoning clock per opened account.
 * accounts: [{ bank, opened_on: "YYYY-MM-DD" }]. Day 0 is the day it opened,
 * the same count bank-strategy.mjs uses (days_open).
 */
export function seasoningFacts(accounts = [], today = arizonaDay()) {
  const list = (Array.isArray(accounts) ? accounts : [])
    .map((a) => ({ bank: text(a.bank) || "Bank account", opened_on: text(a.opened_on), lender_id: UUID.test(String(a.lender_id || "")) ? a.lender_id : null }))
    .filter((a) => a.opened_on && /^\d{4}-\d{2}-\d{2}$/.test(a.opened_on))
    .map((a) => {
      const day = Math.max(0, calendarDays(a.opened_on, today) ?? 0);
      const seasoned = day >= SEASONED_DAYS;
      const better = [...BETTER_SEASONING_DAYS].reverse().find((n) => day >= n) || null;
      const next = [SEASONED_DAYS, ...BETTER_SEASONING_DAYS].find((n) => day < n) || null;
      return { bank: a.bank, opened_on: a.opened_on, lender_id: a.lender_id, day, of: SEASONED_DAYS, seasoned, better, next_mark: next };
    });
  const waiting = list.filter((a) => !a.seasoned).sort((a, b) => b.day - a.day);
  return {
    opened: list.length,
    seasoned: list.filter((a) => a.seasoned).length,
    closest: waiting[0] ? { bank: waiting[0].bank, day: waiting[0].day, of: SEASONED_DAYS } : null,
    accounts: list
  };
}

/* ── can they apply ────────────────────────────────────────────────────────── */

/** The engine's own facts off a fundability() payload, or null when there is none. */
export function fundabilityFacts(f) {
  if (!f || typeof f !== "object") return null;
  const now = f.now || {};
  const factors = Array.isArray(now.factors) ? now.factors : [];
  const inq = factors.find((c) => c && c.key === "no_inquiries") || null;
  return {
    has_pull: f.has_pull === true,
    sample: f.sample === true,
    score: int(now.score),
    score_max: int(now.score_max),
    tier: now.tier === "fundable" || now.tier === "not_fundable" ? now.tier : null,
    inquiries_clean: inq ? (inq.passed === true ? true : inq.passed === false ? false : null) : null,
    inquiries: inq ? int(inq.value) : null,
    failing: factors.filter((c) => c && c.passed === false).map((c) => text(c.label)).filter(Boolean)
  };
}

/* fundabilityFacts() output → the parts of a fundability read gateChecks() reads. */
function gateFundability(fund) {
  if (!fund) return null;
  const inq = fund.inquiries_clean === true || fund.inquiries_clean === false
    ? [{ key: "no_inquiries", passed: fund.inquiries_clean, value: fund.inquiries }] : [];
  return { has_pull: fund.has_pull === true, now: { tier: fund.tier, factors: inq } };
}

/* seasoningFacts() accounts → the clock fields gateChecks() reads. */
function gateClocks(s) {
  return (Array.isArray(s && s.accounts) ? s.accounts : []).map((a) => ({
    bank: a.bank, day: a.day, seasoned: a.seasoned === true, milestone: a.seasoned === true ? "seasoned" : "seasoning", seasoned_on: null
  }));
}

/**
 * applyGate({ fund, seasoning }) → { state, checks }.
 *   state "open"     every check passed
 *   state "locked"   at least one check failed
 *   state "unknown"  nothing failed, but something is not known yet
 * fund is fundabilityFacts() output, or null when UnderwriteIQ was not read.
 * Each check's pass or fail is L4's gateChecks() (src/finance/apply-gate.mjs).
 */
export function applyGate({ fund = null, seasoning = null } = {}) {
  const s = seasoning || { opened: 0, seasoned: 0, closest: null, accounts: [] };
  const gate = gateChecks({ fundability: gateFundability(fund), clocks: gateClocks(s) });
  const passed = (key) => {
    const c = gate.checks.find((x) => x.key === key);
    return c && (c.passed === true || c.passed === false) ? c.passed : null;
  };
  const fundable = passed("fundable");
  const fundWords = !fund ? "Not read yet"
    : !fund.has_pull ? "No credit report on file"
    : `${fund.score ?? "?"} of ${fund.score_max ?? 6} checks${fundable === true ? " · Fundable" : fundable === false ? " · Not fundable yet" : ""}`;
  const inq = passed("no_inquiries");
  const inqWords = inq === true ? "None on file"
    : inq === false ? (fund.inquiries !== null ? `${plural(fund.inquiries, "inquiry", "inquiries")} on file` : "Some on file")
    : "Not known yet";
  const seasoned = passed("seasoned");
  const seasonWords = seasoned ? plural(s.seasoned, "account is", "accounts are") + " seasoned"
    : s.closest ? `${s.closest.bank} is on day ${s.closest.day} of ${SEASONED_DAYS}`
    : "No bank account opened yet";
  const checks = [
    { key: "fundable", label: "Fundable in UnderwriteIQ", passed: fundable, words: fundWords },
    { key: "no_inquiries", label: "No hard inquiries", passed: inq, words: inqWords },
    { key: "seasoned_30", label: `A bank account open ${SEASONED_DAYS}+ days`, passed: seasoned, words: seasonWords }
  ];
  const state = checks.some((c) => c.passed === false) ? "locked" : gate.status === "open" ? "open" : "unknown";
  return { state, checks };
}

/** The list only runs UnderwriteIQ when it can change the answer: with no
    seasoned account the gate is locked whatever the engine says. */
export function gateNeedsEngine(seasoning) {
  return !!seasoning && seasoning.seasoned > 0;
}

/* ── falling behind ────────────────────────────────────────────────────────── */

/**
 * behindReasons(position) → [{ code, words }]. Empty means not falling behind.
 *
 *   step_blocked  the current step is blocked
 *   step_late     a step the client owns is STUCK_DAYS+ past due — the nudge
 *                 ladder has finished and handed it to a person
 *   step_stuck    a step the client owns, with no due date, has sat STUCK_DAYS+
 *   bank_late     the bank marks a card or loan payment overdue
 *   plan_late     a Fundhub plan payment is past due
 *
 * A step only our team can do is never the client falling behind.
 */
export function behindReasons({ steps = null, payments = null } = {}) {
  const out = [];
  const cur = steps && steps.current;
  if (cur && cur.state === "blocked") {
    out.push({ code: "step_blocked", words: cur.reason ? `Step is blocked: ${cur.reason}` : "Step is blocked" });
  }
  if (cur && cur.owner === "client") {
    if (cur.days_late !== null && cur.days_late >= STUCK_DAYS) {
      out.push({ code: "step_late", words: `Step is ${plural(cur.days_late, "day", "days")} late. The auto reminders are done.` });
    } else if (!cur.due_at && cur.days_on_step !== null && cur.days_on_step >= STUCK_DAYS) {
      out.push({ code: "step_stuck", words: `On the same step for ${plural(cur.days_on_step, "day", "days")}` });
    }
  }
  if (payments && payments.bank_late > 0) {
    out.push({ code: "bank_late", words: `${plural(payments.bank_late, "card or loan payment is", "card or loan payments are")} late` });
  }
  if (payments && payments.plan_late > 0) {
    out.push({ code: "plan_late", words: `${plural(payments.plan_late, "Fundhub plan payment is", "Fundhub plan payments are")} late` });
  }
  return out;
}

function urgency(row) {
  const c = row.steps && row.steps.current;
  return Math.max(c?.days_late ?? 0, c?.days_on_step ?? 0);
}

/** Falling behind first, most reasons first, longest stuck first, then by name. */
export function sortTracking(rows = []) {
  return rows.slice().sort((a, b) =>
    (b.behind.length > 0) - (a.behind.length > 0) ||
    b.behind.length - a.behind.length ||
    urgency(b) - urgency(a) ||
    String(a.client_name || a.client_code || "").localeCompare(String(b.client_name || b.client_code || "")) ||
    String(a.client_id).localeCompare(String(b.client_id)));
}

/* ── the nudge words ───────────────────────────────────────────────────────── */

/**
 * nudgeDrafts({ firstName, steps, payments }) → { help, call }.
 * Words only; the CSM edits and sends them. Signed as Chris (owner law
 * no-josh-chris-everywhere). No price is named for the call: no consulting-call
 * price is stored anywhere in this repo, so the client is told one comes next.
 */
export function nudgeDrafts({ firstName = null, steps = null, payments = null } = {}) {
  const name = text(firstName) || "there";
  const cur = steps && steps.current && steps.current.owner === "client" ? steps.current : null;
  const late = payments && payments.total_late > 0;
  const hi = `Hi ${name}, it's Chris at Fundhub.`;
  let help;
  let call;
  if (cur) {
    help = `${hi} Your next step is "${cur.title}". Reply here and we will help you finish it.`;
    call = `${hi} Want to finish "${cur.title}" together? We can set up a paid one-on-one consulting call. Reply CALL and we will send you times and the price.`;
  } else if (late) {
    help = `${hi} A payment on your file shows as late. Reply here and we will help you get it back on track.`;
    call = `${hi} Want help getting your payments back on track? We can set up a paid one-on-one consulting call. Reply CALL and we will send you times and the price.`;
  } else {
    help = `${hi} Checking in on your plan. Reply here if you want help with your next step.`;
    call = `${hi} Want to go over your plan together? We can set up a paid one-on-one consulting call. Reply CALL and we will send you times and the price.`;
  }
  return { help, call };
}

/* ── the list read ─────────────────────────────────────────────────────────── */

/* One statement, every clause scoped to the caller's company ($1). Candidates are
   clients on a plan: a checklist, an open Fundhub payment plan, or an opened
   bank account. Archived clients stay off staff work screens. */
export const TRACKING_LIST_SQL = `
  /* csm:tracking-list */
  WITH cand AS (
    SELECT client_id FROM client_waypoints WHERE org_id = $1
    UNION SELECT client_id FROM clarity_payments WHERE org_id = $1 AND status = 'open'
    UNION SELECT client_id FROM blueprint_bank_relationship_todos WHERE org_id = $1 AND opened_on IS NOT NULL
  ),
  steps AS (
    SELECT w.client_id,
           count(*)::int AS steps_total,
           count(*) FILTER (WHERE w.state IN ('done', 'skipped'))::int AS steps_done,
           max(w.completed_at) AS last_done_at
      FROM client_waypoints w
     WHERE w.org_id = $1
     GROUP BY w.client_id
  ),
  cur AS (
    SELECT DISTINCT ON (w.client_id)
           w.client_id, w.id AS step_id, w.key AS step_key, w.title AS step_title,
           w.state AS step_state, w.state_reason AS step_reason, w.owner_kind AS step_owner,
           w.due_at AS step_due_at, w.created_at AS step_created_at
      FROM client_waypoints w
     WHERE w.org_id = $1 AND w.state IN ('not_started', 'in_progress', 'blocked')
     ORDER BY w.client_id, w.position, w.key
  ),
  bank AS (
    SELECT sc.client_id,
           count(*) FILTER (WHERE sc.raw->>'is_overdue' = 'true')::int AS bank_late,
           count(*) FILTER (WHERE sc.raw->>'is_overdue' IN ('true', 'false'))::int AS bank_known
      FROM account_statement_cycles sc
      JOIN bank_accounts ba ON ba.id = sc.bank_account_id AND ba.org_id = sc.org_id AND ba.client_id = sc.client_id
     WHERE sc.org_id = $1 AND ba.closed_at IS NULL
     GROUP BY sc.client_id
  ),
  plans AS (
    SELECT p.client_id,
           count(DISTINCT p.id)::int AS plans_open,
           count(i.id) FILTER (WHERE i.paid_cents < i.amount_cents AND i.due_on < $3::date)::int AS plan_late
      FROM clarity_payments p
      LEFT JOIN clarity_payment_installments i ON i.clarity_payment_id = p.id AND i.org_id = p.org_id
     WHERE p.org_id = $1 AND p.status = 'open'
     GROUP BY p.client_id
  ),
  opened AS (
    SELECT r.client_id,
           json_agg(json_build_object('bank', COALESCE(NULLIF(btrim(r.bank_name), ''), r.bank_key),
                                      'opened_on', r.opened_on::text, 'lender_id', r.lender_id) ORDER BY r.opened_on, r.id) AS accounts
      FROM blueprint_bank_relationship_todos r
     WHERE r.org_id = $1 AND r.opened_on IS NOT NULL AND r.state <> 'skipped'
     GROUP BY r.client_id
  ),
  texts AS (
    SELECT m.client_id, max(m.created_at) AS last_team_text_at
      FROM messages m
     WHERE m.org_id = $1 AND m.direction = 'outbound' AND m.sender_kind = 'staff' AND m.client_id IS NOT NULL
     GROUP BY m.client_id
  )
  SELECT c.id AS client_id,
         NULLIF(btrim(c.first_name), '') AS first_name,
         NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS client_name,
         c.client_code,
         c.assigned_csm_staff_id,
         NULLIF(btrim(s.name), '') AS assigned_csm_name,
         st.steps_total, st.steps_done, st.last_done_at,
         cur.step_id, cur.step_key, cur.step_title, cur.step_state, cur.step_reason, cur.step_owner,
         cur.step_due_at, cur.step_created_at,
         bank.bank_late, bank.bank_known,
         plans.plans_open, plans.plan_late,
         opened.accounts AS opened_accounts,
         texts.last_team_text_at
    FROM cand
    JOIN clients c ON c.id = cand.client_id AND c.org_id = $1
    LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
    LEFT JOIN steps st ON st.client_id = c.id
    LEFT JOIN cur ON cur.client_id = c.id
    LEFT JOIN bank ON bank.client_id = c.id
    LEFT JOIN plans ON plans.client_id = c.id
    LEFT JOIN opened ON opened.client_id = c.id
    LEFT JOIN texts ON texts.client_id = c.id
   WHERE c.custom_fields->>'crm_archived_at' IS NULL
     AND ($2::uuid IS NULL OR c.assigned_csm_staff_id = $2::uuid)
   ORDER BY c.id
   LIMIT $4
`;

function accountsOf(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

/** One list row → where that client is. Pure. */
export function positionFromRow(row = {}, now = new Date()) {
  const steps = stepFacts({
    total: row.steps_total,
    done: row.steps_done,
    lastDoneAt: row.last_done_at,
    current: row.step_id ? {
      id: row.step_id, key: row.step_key, title: row.step_title, state: row.step_state,
      state_reason: row.step_reason, owner_kind: row.step_owner, due_at: row.step_due_at,
      created_at: row.step_created_at
    } : null
  }, now);
  const payments = paymentFacts({ bankLate: row.bank_late, bankKnown: row.bank_known, plansOpen: row.plans_open, planLate: row.plan_late });
  const seasoning = seasoningFacts(accountsOf(row.opened_accounts), arizonaDay(now));
  const out = {
    client_id: row.client_id,
    client_name: text(row.client_name),
    client_code: text(row.client_code),
    first_name: text(row.first_name),
    assigned_csm_staff_id: row.assigned_csm_staff_id || null,
    assigned_csm_name: text(row.assigned_csm_name),
    steps,
    payments,
    seasoning,
    last_team_text_at: iso(row.last_team_text_at)
  };
  out.behind = behindReasons(out);
  return out;
}

/** Query parameters for the list → a clean shape, or TrackingInputError. */
export function listParams(query = {}) {
  const show = query.show === undefined || query.show === "" ? "behind" : String(query.show);
  if (!["behind", "all"].includes(show)) throw new TrackingInputError("show must be behind or all");
  const mine = query.mine === "1" || query.mine === "true";
  const rawLimit = query.limit === undefined || query.limit === "" ? DEFAULT_PAGE : Number(query.limit);
  const rawOffset = query.offset === undefined || query.offset === "" ? 0 : Number(query.offset);
  if (!Number.isInteger(rawLimit) || rawLimit < 1) throw new TrackingInputError("limit must be a whole number above 0");
  if (!Number.isInteger(rawOffset) || rawOffset < 0) throw new TrackingInputError("offset must be a whole number, 0 or more");
  return { show, mine, limit: Math.min(rawLimit, MAX_PAGE), offset: Math.min(rawOffset, MAX_CLIENTS) };
}

async function gateFor(db, { orgId, clientId, seasoning, now, fundabilityFn }) {
  if (!gateNeedsEngine(seasoning)) return applyGate({ fund: null, seasoning });
  try {
    const f = await fundabilityFn(db, { orgId, clientId, asOf: now });
    return applyGate({ fund: fundabilityFacts(f), seasoning });
  } catch (e) {
    // One file the engine cannot read must not take the whole list down. The
    // row says the engine was not read; it never says "fundable".
    console.error(`[csm-tracking] fundability failed for ${clientId}: ${e && e.message}`);
    return applyGate({ fund: null, seasoning });
  }
}

/**
 * readTrackingList(db, { orgId, staffId, query, now, fundabilityFn }) → the page.
 * Read only. Every statement carries org_id.
 */
export async function readTrackingList(db, { orgId, staffId = null, query = {}, now = new Date(), fundabilityFn } = {}) {
  if (!UUID.test(String(orgId || ""))) throw new TrackingInputError("orgId is required");
  const p = listParams(query);
  const mineId = p.mine && UUID.test(String(staffId || "")) ? staffId : null;
  if (p.mine && !mineId) throw new TrackingInputError("mine needs a signed-in staff member");
  const { rows } = await db.query(TRACKING_LIST_SQL, [orgId, mineId, arizonaDay(now), MAX_CLIENTS + 1]);
  const truncated = rows.length > MAX_CLIENTS;
  const all = sortTracking(rows.slice(0, MAX_CLIENTS).map((r) => positionFromRow(r, now)));
  const behindCount = all.filter((r) => r.behind.length > 0).length;
  const shown = p.show === "behind" ? all.filter((r) => r.behind.length > 0) : all;
  const pageRows = shown.slice(p.offset, p.offset + p.limit);
  const engine = fundabilityFn || (await import("../finance/fundability.mjs")).fundability;
  for (const row of pageRows) {
    row.apply_gate = await gateFor(db, { orgId, clientId: row.client_id, seasoning: row.seasoning, now, fundabilityFn: engine });
  }
  return {
    ok: true,
    view: "tracking",
    show: p.show,
    mine: p.mine,
    as_of: new Date(now).toISOString(),
    total: all.length,
    behind_count: behindCount,
    truncated,
    count: pageRows.length,
    limit: p.limit,
    offset: p.offset,
    hasMore: p.offset + pageRows.length < shown.length,
    items: pageRows
  };
}

/* ── one client ────────────────────────────────────────────────────────────── */

export const CLIENT_SQL = `
  /* csm:tracking-client */
  SELECT c.id AS client_id,
         NULLIF(btrim(c.first_name), '') AS first_name,
         NULLIF(btrim(concat_ws(' ', c.first_name, c.last_name)), '') AS client_name,
         c.client_code, c.assigned_csm_staff_id, NULLIF(btrim(s.name), '') AS assigned_csm_name
    FROM clients c
    LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
   WHERE c.id = $1 AND c.org_id = $2
     AND c.custom_fields->>'crm_archived_at' IS NULL
`;
export const STEPS_SQL = `
  /* csm:tracking-steps */
  SELECT id, key, title, state, state_reason, owner_kind, due_at, created_at, completed_at, position,
         paid_alternative_price_cents, paid_alternative_label
    FROM client_waypoints
   WHERE org_id = $1 AND client_id = $2
   ORDER BY position, key
`;
export const BANK_LATE_SQL = `
  /* csm:tracking-bank-late */
  SELECT COALESCE(NULLIF(btrim(ba.official_name), ''), NULLIF(btrim(ba.name), ''), 'Account') AS name,
         ba.account_type, sc.raw->>'is_overdue' AS is_overdue
    FROM account_statement_cycles sc
    JOIN bank_accounts ba ON ba.id = sc.bank_account_id AND ba.org_id = sc.org_id AND ba.client_id = sc.client_id
   WHERE sc.org_id = $1 AND sc.client_id = $2 AND ba.closed_at IS NULL
   ORDER BY name
`;
export const LAST_TEXT_SQL = `
  /* csm:tracking-last-text */
  SELECT max(created_at) AS last_team_text_at
    FROM messages
   WHERE org_id = $1 AND client_id = $2 AND direction = 'outbound' AND sender_kind = 'staff'
`;

/**
 * readClientPosition(db, { orgId, clientId, now, ... }) → one client's position,
 * the apply gate with UnderwriteIQ read, and the two nudge drafts. null when the
 * client is not in this company (the caller answers 404). Read only.
 */
export async function readClientPosition(db, {
  orgId, clientId, now = new Date(), fundabilityFn, readRelationshipsFn, listPlansFn, logoFn
} = {}) {
  if (!UUID.test(String(orgId || "")) || !UUID.test(String(clientId || ""))) {
    throw new TrackingInputError("orgId and clientId are required");
  }
  const client = (await db.query(CLIENT_SQL, [clientId, orgId])).rows[0];
  if (!client) return null;
  const today = arizonaDay(now);
  const fundMod = fundabilityFn ? null : await import("../finance/fundability.mjs");
  const bankMod = readRelationshipsFn ? null : await import("../finance/bank-strategy.mjs");
  const planMod = listPlansFn ? null : await import("../finance/clarity-payments.mjs");
  const [steps, bankRows, lastText, relationships, plans, fund] = await Promise.all([
    db.query(STEPS_SQL, [orgId, clientId]),
    db.query(BANK_LATE_SQL, [orgId, clientId]),
    db.query(LAST_TEXT_SQL, [orgId, clientId]),
    (readRelationshipsFn || bankMod.readRelationships)(db, { orgId, clientId, today }),
    (listPlansFn || planMod.listClarityPayments)(db, { orgId, clientId, today }),
    (fundabilityFn || fundMod.fundability)(db, { orgId, clientId, asOf: now }).catch((e) => {
      console.error(`[csm-tracking] fundability failed for ${clientId}: ${e && e.message}`);
      return null;
    })
  ]);

  const stepRows = steps.rows;
  const summary = summarizeSteps(stepRows);
  const stepView = stepFacts(summary, now);
  const known = bankRows.rows.filter((r) => r.is_overdue === "true" || r.is_overdue === "false");
  const lateAccounts = known.filter((r) => r.is_overdue === "true").map((r) => ({ name: text(r.name), kind: r.account_type || null }));
  const openPlans = (Array.isArray(plans) ? plans : []).filter((pl) => pl && pl.status === "open");
  const latePlans = openPlans.filter((pl) => pl.is_late).map((pl) => ({
    name: pl.name || pl.label || "Fundhub plan",
    late_payments: (pl.installments || []).filter((i) => i.state === "late").length,
    days_late: int(pl.days_late),
    late_cents: int(pl.late_cents)
  }));
  const payments = paymentFacts({
    bankLate: lateAccounts.length, bankKnown: known.length,
    plansOpen: openPlans.length, planLate: latePlans.reduce((s, pl) => s + pl.late_payments, 0)
  });
  const opened = (Array.isArray(relationships) ? relationships : [])
    .filter((r) => r && r.opened_on && r.status !== "skipped")
    .map((r) => ({ bank: r.bank, opened_on: r.opened_on, lender_id: r.lender_id || null }));
  const seasoning = seasoningFacts(opened, today);
  /* Each bank's own logo: Plaid's, then the bank book's, else null (owner rule 2026-11-07). */
  if (seasoning.accounts.length) {
    const logos = await (logoFn || findLogos)(db, { orgId, banks: seasoning.accounts.map((a) => ({ lenderId: a.lender_id, name: a.bank })) });
    seasoning.accounts = seasoning.accounts.map((a, i) => ({ ...a, logo: (logos[i] && logos[i].logo) || null }));
  }
  const fundFacts = fundabilityFacts(fund);
  const position = {
    client_id: client.client_id,
    client_name: text(client.client_name),
    client_code: text(client.client_code),
    first_name: text(client.first_name),
    assigned_csm_staff_id: client.assigned_csm_staff_id || null,
    assigned_csm_name: text(client.assigned_csm_name),
    steps: stepView,
    payments,
    seasoning,
    last_team_text_at: iso(lastText.rows[0] && lastText.rows[0].last_team_text_at)
  };
  position.behind = behindReasons(position);
  position.apply_gate = applyGate({ fund: fundFacts, seasoning });
  return {
    ok: true,
    view: "tracking",
    as_of: new Date(now).toISOString(),
    client: {
      ...position,
      late_accounts: lateAccounts,
      late_plans: latePlans,
      fundability: fundFacts,
      next_steps: stepRows
        .filter((r) => OPEN_STATES.has(r.state))
        .slice(0, 3)
        .map((r) => ({ title: text(r.title), owner: r.owner_kind === "fundhub" ? "fundhub" : "client", state: r.state, due_at: iso(r.due_at) })),
      drafts: nudgeDrafts({ firstName: client.first_name, steps: stepView, payments })
    }
  };
}
