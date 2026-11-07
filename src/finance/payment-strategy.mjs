// Payment strategy — the reads and the save behind GET/POST /api/money/strategy
// and the FinanceOS Strategy section (/app/money-strategy.html).
//
// FinanceOS wave 5, unit W4 (ops/workflows/finance-os-wave5-2026-10-06.md).
// Owner, 2026-10-06: "real-time feedback on payment strategies; calculations
// showing how to reduce payments and timelines to achieve goals."
//
// THE MATH IS NOT IN THIS FILE. It lives in public/app/money-strategy-math.js,
// ONE file the browser runs for the live slider and this file imports for the
// read and the save — so the page and the server can never disagree. See that
// file's header for the three methods, the two utilization targets and where
// each one is cited from.
//
// WHAT THIS FILE ADDS IS THE JOIN, NOT NEW RULES. Every input already has an
// owner, and this file calls it:
//
//   cards and loans, kinds, due dates   src/finance/money-overview.mjs — the
//                                       Overview tab's own numbers, word for word
//   APR                                 account_statement_cycles.apr (097: "a
//                                       hand-entered card has nowhere else to put
//                                       it"); a loan's Plaid interest rate from
//                                       the same row's raw (plaid-liabilities.mjs)
//   is this month's payment safe?       src/banking/cashflow.mjs project() and
//                                       paymentWindow() — two tracks, refuses on a
//                                       missing number — the same projector
//                                       /api/finance/cashflow uses
//   bills inside that month             src/banking/store.mjs + cashflow-seam.mjs
//   the floor (a buffer above $0)       src/banking/settings.mjs loadThresholds
//   money coming in (repeat paychecks,  src/banking/income.mjs loadIncome — the
//   deposits, merchant payouts)         sure monthly figure, per kind
//   financing (Clarity Pay / BNPL)      src/finance/clarity-payments.mjs, read only
//   paid / late, per payment            Plaid's last payment date on the cycle row
//                                       (the card reminders' own "payment on file" test)
//   bill cleanup                        src/banking/bill-cleanup.mjs
//
// CASH IS NEVER ADDED ACROSS KINDS (spec §4b). Business cash is checked against
// business debts, personal against personal. A kind whose cash cannot be read
// says why, in the projector's own words, and the page shows that refusal.
//
// ONLY THE FIRST MONTH IS CHECKED AGAINST CASH. Money coming in is not added to
// that check (no inflow is passed to the projector, which can only make it more
// careful), so a projection past one month would run every account to zero on
// paper. The page says this in words.
//
// MONEY COMING IN FEEDS A SUGGESTION, NOT THE CHECK (Finance OS CFO build, unit
// C). inputs.income carries each kind's sure monthly income and bills a month;
// the shared math (suggestExtra) works out the extra for debt and the slider
// amount it suggests. The client picks the amount; the cash check above still
// guards the save.
//
// NEVER PAST THE SAFE AMOUNT. A plan whose first month is more than a kind's
// cash can cover is refused at save, here, and again by the database
// (payment_strategy_plans.cash_check has no 'over' value, migration 463).

import {
  buildPlan,
  METHODS,
  GOAL_KINDS,
  TARGETS,
  METHOD_INFO,
  addMonths,
  parseDay
} from "../../public/app/money-strategy-math.js";
import { moneyOverview } from "./money-overview.mjs";
import { project, paymentWindow } from "../banking/cashflow.mjs";
import { toCashflowBills } from "../banking/cashflow-seam.mjs";
import { listRecurringBillsFor } from "../banking/store.mjs";
import { PRESENTABLE_LABELS } from "../banking/recurring.mjs";
import { loadThresholds } from "../banking/settings.mjs";
import { loadIncome, monthlyBillCents, INCOME_KINDS } from "../banking/income.mjs";
import { loadBillCleanup } from "../banking/bill-cleanup.mjs";
import { parseIsoDate, daysBetween } from "../banking/statement-cycles.mjs";
import { listClarityPayments } from "./clarity-payments.mjs";

export const MAX_MONTHLY_CENTS = 100_000_000; // $1,000,000 a month — a typo guard, not a policy

const KIND_WORD = { personal: "personal", business: "business", unknown: "not-sorted-yet" };

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function int(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/** "$1,234.56" — for refusal sentences only; the page formats its own. */
export function usd(cents) {
  if (!Number.isSafeInteger(cents)) return "—";
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const dollars = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const c = abs % 100;
  return `${neg ? "-" : ""}$${dollars}${c ? "." + String(c).padStart(2, "0") : ""}`;
}

/* ------------------------------------------------------------------ *
 * Debts — the overview's cards and loans, plus the APR
 * ------------------------------------------------------------------ */

/* The APR lives on the statement-cycle row as a FRACTION (0.2499 = 24.99%).
   A Plaid loan carries an interest RATE in percent units in raw instead
   (plaid-liabilities.mjs toLoanCycleInput: "apr stays null"). Both are read;
   the source is named so the page can say which one it used. */
const APR_SQL = `
  SELECT bank_account_id::text AS bank_account_id, apr,
         raw->>'interest_rate_percentage' AS loan_rate,
         raw->>'last_payment_date' AS last_payment_date,
         raw->>'next_payment_due_date' AS next_payment_due_date,
         raw->'plaid'->>'last_statement_issue_date' AS plaid_statement_date,
         last_statement_date::text AS last_statement_date,
         minimum_payment_cents, last_statement_balance_cents
    FROM account_statement_cycles
   WHERE client_id = $1 AND org_id = $2`;

/** { bank_account_id → { apr_pct, apr_source } } from cycle rows. Pure. */
export function aprMap(rows = []) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = text(r && r.bank_account_id);
    if (!id) continue;
    const frac = r.apr === null || r.apr === undefined || r.apr === "" ? null : Number(r.apr);
    if (frac !== null && Number.isFinite(frac) && frac >= 0 && frac <= 1) {
      out.set(id, { apr_pct: Math.round(frac * 100000) / 1000, apr_source: "statement" });
      continue;
    }
    const rate = r.loan_rate === null || r.loan_rate === undefined || r.loan_rate === "" ? null : Number(r.loan_rate);
    if (rate !== null && Number.isFinite(rate) && rate >= 0 && rate <= 100) {
      out.set(id, { apr_pct: Math.round(rate * 1000) / 1000, apr_source: "plaid_loan_rate" });
    }
  }
  return out;
}

function cardName(c) {
  return text(c.name) || (text(c.mask) ? `Card ····${c.mask}` : "Card");
}

function loanName(l) {
  return text(l.name) || (text(l.mask) ? `Loan ····${l.mask}` : "Loan");
}

/* ------------------------------------------------------------------ *
 * Paid / late, per payment (Finance OS wave 3, unit K)
 * ------------------------------------------------------------------ */

const day = (v) => {
  const s = text(v);
  return s && parseIsoDate(s.slice(0, 10)) ? s.slice(0, 10) : null;
};

/** { bank_account_id → the cycle row } from the same read as aprMap. Pure. */
export function cycleFacts(rows = []) {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = text(r && r.bank_account_id);
    if (id) out.set(id, r);
  }
  return out;
}

/**
 * paymentStatus(facts, today) → { status, ... } for this cycle's payment.
 *
 * THE SAME "PAYMENT ON FILE" TEST AS THE CARD REMINDERS
 * (src/pulse/beats/lib/card-due-plan.mjs planCardDue, src/finance/money-agent.mjs
 * cardLateItem): Plaid's last payment date on or after the last statement date
 * means this cycle's payment was made. So the Strategy screen, the reminder text
 * and the money helper never disagree about one card.
 *
 *   paid         a payment is on file since the last statement
 *   late         none since the statement, and the due date has passed
 *   due          none since the statement yet, and the due date is ahead
 *   nothing_due  the minimum or the statement balance is $0
 *   null         Plaid gave no payment date (or no statement date to compare
 *                it with) — said as unknown, never as paid and never as late
 *
 * facts: { dueOn, lastPaidOn, statementOn, minCents, statementBalanceCents }
 */
export function paymentStatus(facts = {}, today) {
  const dueOn = day(facts.dueOn);
  const lastPaidOn = day(facts.lastPaidOn);
  const statementOn = day(facts.statementOn);
  const base = { source: "plaid", due_on: dueOn, last_paid_on: lastPaidOn, days_late: 0 };
  if (!day(today)) return { ...base, status: null, reason: "bad_today" };
  if (facts.minCents === 0 || (Number.isSafeInteger(facts.statementBalanceCents) && facts.statementBalanceCents <= 0)) {
    return { ...base, status: "nothing_due", reason: null };
  }
  if (!lastPaidOn) return { ...base, status: null, reason: "no_payment_date" };
  if (statementOn && daysBetween(statementOn, lastPaidOn) >= 0) return { ...base, status: "paid", reason: null };
  if (!statementOn) return { ...base, status: null, reason: "no_statement_date" };
  if (dueOn && daysBetween(dueOn, today) > 0) {
    return { ...base, status: "late", days_late: daysBetween(dueOn, today), reason: null };
  }
  if (dueOn) return { ...base, status: "due", reason: null };
  return { ...base, status: null, reason: "no_due_date" };
}

function statusFor(id, facts, dueOn, today) {
  const f = facts.get(String(id));
  if (!f || !today) return null;
  return paymentStatus({
    dueOn: day(f.next_payment_due_date) || dueOn,
    lastPaidOn: f.last_payment_date,
    statementOn: day(f.plaid_statement_date) || day(f.last_statement_date),
    minCents: int(f.minimum_payment_cents),
    statementBalanceCents: int(f.last_statement_balance_cents)
  }, today);
}

/**
 * debtsFromOverview(overview, aprs, { facts, today }) → the math's debt list. Pure.
 * Every number is the overview's own; nothing here is a new reading. `facts`
 * (cycleFacts) and `today` add each payment's paid / late status; without them
 * a debt carries payment: null.
 */
export function debtsFromOverview(ov, aprs = new Map(), { facts = new Map(), today = null } = {}) {
  const debt = (ov && ov.debt) || {};
  const cards = (Array.isArray(debt.cards) ? debt.cards : []).map((c) => {
    const a = aprs.get(String(c.account_id)) || null;
    return {
      id: String(c.account_id),
      name: cardName(c),
      type: "card",
      kind: c.kind || "unknown",
      container_id: text(c.container_id),
      balance_cents: int(c.balance_cents),
      limit_cents: int(c.limit_cents),
      apr_pct: a ? a.apr_pct : null,
      apr_source: a ? a.apr_source : null,
      min_cents: int(c.min_due_cents),
      due_on: text(c.due_on),
      payment: statusFor(c.account_id, facts, text(c.due_on), today)
    };
  });
  const loans = (Array.isArray(debt.loans) ? debt.loans : []).map((l) => {
    const a = aprs.get(String(l.account_id)) || null;
    return {
      id: String(l.account_id),
      name: loanName(l),
      type: "loan",
      kind: l.kind || "unknown",
      container_id: text(l.container_id),
      balance_cents: int(l.balance_cents),
      limit_cents: null,
      apr_pct: a ? a.apr_pct : null,
      apr_source: a ? a.apr_source : null,
      min_cents: int(l.payment_cents),
      due_on: text(l.due_on),
      payment: statusFor(l.account_id, facts, text(l.due_on), today)
    };
  });
  return [...cards, ...loans];
}

/* ------------------------------------------------------------------ *
 * Financing — Clarity Pay and other payment plans (wave 3, unit K)
 * ------------------------------------------------------------------ */

/**
 * financingDebts(plans, { today }) → open payment plans as debts. Pure.
 *
 * plans are src/finance/clarity-payments.mjs listClarityPayments() rows (its
 * planView shape): money a client owes Fundhub or a subsidiary on a schedule,
 * including buy now, pay later plans. Read only — nothing here records a payment.
 *
 *   balance   what is left on the plan
 *   rate      0%: the schedule adds up to the plan amount (migration 443's
 *             deferred check), so nothing is charged on top. Named, not assumed.
 *   minimum   what is due inside the plan's first month, late parts included
 *   kind      "unknown": a plan does not say whether personal or business money
 *             pays it, and unknown is never folded into personal.
 *   payment   paid / late / due from the plan's own recorded payments
 *
 * WHOP FINANCING IS NOT HERE ON PURPOSE. A Whop checkout records only that a
 * Blueprint sale required ClarityPay financing (src/payments/whop-blueprint.mjs);
 * the buyer's monthly ClarityPay schedule is not stored anywhere in this
 * database. When staff record that schedule as a plan, it arrives through this
 * same read.
 */
export function financingDebts(plans = [], { today } = {}) {
  if (!parseDay(today)) return [];
  const end = minusOneDay(addMonths(today, 1));
  return (Array.isArray(plans) ? plans : [])
    .filter((p) => p && p.status === "open" && int(p.left_cents) !== null && p.left_cents > 0)
    .map((p) => {
      const items = Array.isArray(p.installments) ? p.installments : [];
      const dueNow = items.filter((i) => int(i.left_cents) > 0 && day(i.due_on) && day(i.due_on) <= end)
        .reduce((s, i) => s + i.left_cents, 0);
      const pastDue = items.filter((i) => day(i.due_on) && day(i.due_on) <= today);
      const lastDue = pastDue.length ? pastDue[pastDue.length - 1] : null;
      let payment;
      if (p.is_late) {
        const firstLate = items.find((i) => i.state === "late") || null;
        payment = { source: "recorded", status: "late", due_on: firstLate ? firstLate.due_on : null,
          last_paid_on: null, days_late: int(p.days_late) || 0, reason: null };
      } else if (lastDue && int(lastDue.left_cents) === 0) {
        payment = { source: "recorded", status: "paid", due_on: lastDue.due_on,
          last_paid_on: lastDue.paid_at ? String(lastDue.paid_at).slice(0, 10) : null, days_late: 0, reason: null };
      } else {
        payment = { source: "recorded", status: p.next ? "due" : null, due_on: p.next ? p.next.due_on : null,
          last_paid_on: null, days_late: 0, reason: p.next ? null : "no_schedule" };
      }
      return {
        id: `clarity:${p.id}`,
        name: text(p.name) || "Payment plan",
        type: "financing",
        kind: "unknown",
        container_id: null,
        owed_to: text(p.owed_to),
        balance_cents: int(p.left_cents),
        limit_cents: null,
        apr_pct: 0,
        apr_source: "schedule",
        min_cents: dueNow,
        due_on: p.next ? day(p.next.due_on) : null,
        payment
      };
    });
}

/* A read that failed is "not read", never "no plans". */
async function readFinancing(listPlans, db, { orgId, clientId, today }) {
  try {
    return { ok: true, plans: await listPlans(db, { orgId, clientId, today }) };
  } catch (e) {
    return { ok: false, plans: [], reason: e && e.code === "42P01" ? "not_set_up" : "read_failed" };
  }
}

/* ------------------------------------------------------------------ *
 * Cash — how much each kind can send to its own debts this month
 * ------------------------------------------------------------------ */

function daysInclusive(fromIso, toIso) {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

function minusOneDay(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`) - 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * cashByKind({ accounts, bills, debts, thresholds, today }) — one projection per
 * kind that has a debt with a balance, through src/banking/cashflow.mjs.
 *
 *   accounts    the overview's open accounts (id, type, kind, current_cents, name)
 *   bills       listRecurringBillsFor() rows (camelCase)
 *   debts       debtsFromOverview() output — every card and loan, known or not
 *   thresholds  loadThresholds() output
 *   today       'YYYY-MM-DD'
 *
 * The month is today through the day before the plan's first month ends
 * (Oct 6 → Nov 5). Each kind's opening cash is its own depository accounts
 * (current_balance_cents, the ledger figure /api/finance/cashflow also opens
 * from). Out: its bills on those accounts that fall inside the month, and the
 * minimum of any of its debts that is NOT in the plan (an unknown balance does
 * not make a minimum go away). The plan's own debts are not passed in — the
 * plan's payment replaces their minimums, so passing both would count them
 * twice. No money in is passed, so the answer can only be too careful.
 *
 * Returns { window, by_kind: { kind: summary }, projections: { kind: project() } }.
 * summary: { ok: true, safe_cents, ... } or { ok: false, code, message }.
 */
export function cashByKind({ accounts = [], bills = [], debts = [], thresholds = {}, today } = {}) {
  const end = minusOneDay(addMonths(today, 1));
  const horizonDays = daysInclusive(today, end);
  const kinds = [...new Set(debts.filter((d) => int(d.balance_cents) !== null && d.balance_cents > 0).map((d) => d.kind || "unknown"))];
  const byKind = {};
  const projections = {};

  for (const kind of kinds) {
    const cashAccounts = (Array.isArray(accounts) ? accounts : [])
      .filter((a) => a && a.type === "depository" && (a.kind || "unknown") === kind);
    const ids = new Set(cashAccounts.map((a) => String(a.id)));
    const balances = cashAccounts.map((a) => ({
      accountId: String(a.id),
      label: text(a.name) || (text(a.mask) ? `account ····${a.mask}` : "(unnamed account)"),
      balanceCents: int(a.current_cents)
    }));

    const detection = { bills: [], candidates: [] };
    for (const b of Array.isArray(bills) ? bills : []) {
      if (!b || !ids.has(String(b.bankAccountId))) continue;
      (PRESENTABLE_LABELS.includes(b.confidenceLabel) ? detection.bills : detection.candidates).push(b);
    }
    const seam = toCashflowBills(detection, { from: today, to: end });

    /* A debt left out of the plan (balance unknown) still has a minimum. */
    const cardLiabilities = debts
      .filter((d) => (d.kind || "unknown") === kind && int(d.balance_cents) === null)
      .map((d) => ({
        liabilityId: String(d.id),
        label: d.name,
        dueDate: d.due_on || null,
        minimumPaymentCents: int(d.min_cents)
      }));

    const projection = project({
      balances,
      recurringBills: seam.recurringBills,
      cardLiabilities,
      now: today,
      horizonDays,
      thresholds
    });
    projections[kind] = projection;

    if (!projection.ok) {
      byKind[kind] = {
        ok: false,
        code: projection.reason?.code || "PROJECTION_UNAVAILABLE",
        message: projection.reason?.code === "NO_BALANCES"
          ? `No ${KIND_WORD[kind]} bank account is on file, so ${KIND_WORD[kind]} payments cannot be checked against cash.`
          : projection.reason?.message || "The cash projection could not be made."
      };
      continue;
    }

    const w = paymentWindow({ projectedBalances: projection, dueDate: end, paymentAmountCents: 0, now: today, thresholds });
    if (!w.ok && w.reason?.code !== "WOULD_OVERDRAW") {
      byKind[kind] = { ok: false, code: w.reason?.code || "WINDOW_UNAVAILABLE", message: w.reason?.message || "The cash check could not be made." };
      continue;
    }
    /* The most that can land on ANY day of the month and keep every day after
       it at or above the floor. With no money in modelled every day gives the
       same answer; taking the lowest keeps it right if money in is added. */
    const lowest = w.candidates.reduce((m, c) => Math.min(m, c.lowestBalanceAfterPaymentCents), Infinity);
    const room = Number.isFinite(lowest) ? lowest - w.floorCents : null;
    const billsInMonth = projection.days.reduce((s, d) => s + d.committedOutflowCents + d.unconfirmedOutflowCents, 0);
    byKind[kind] = {
      ok: true,
      safe_cents: room === null ? null : Math.max(0, room),
      short_cents: room !== null && room < 0 ? -room : 0,
      opening_cents: projection.openingBalanceCents,
      bills_cents: billsInMonth,
      floor_cents: w.floorCents,
      floor_source: w.floorSource,
      accounts: projection.accounts.map((a) => ({ name: a.label, balance_cents: a.balanceCents })),
      bills: projection.days.flatMap((d) => d.components
        .filter((c) => c.direction === "out")
        .map((c) => ({ name: c.label, on: d.date, amount_cents: c.amountCents, kind: c.kind, certainty: c.certainty }))),
      bills_left_out: seam.skipped.length,
      threshold_gaps: (w.thresholdGaps || []).map((g) => g.name)
    };
  }

  return { window: { from: today, to: end }, by_kind: byKind, projections };
}

/* ------------------------------------------------------------------ *
 * Money coming in — what the extra-for-debt suggestion is built from
 * ------------------------------------------------------------------ */

/* Only what the page shows. Provider transaction ids and raw descriptors stay
   on the server. */
function incomeItem(it) {
  return {
    id: String(it.id),
    source: it.source,
    name: text(it.name),
    kind: it.kind || "unknown",
    cadence: it.cadence ?? null,
    typical_cents: int(it.typical_cents),
    monthly_cents: int(it.monthly_cents),
    sure_per_month: int(it.sure_per_month),
    next_on: text(it.next_expected_on),
    last_on: text(it.last_seen_on),
    times_seen: int(it.occurrence_count),
    account_name: text(it.account_name),
    account_mask: text(it.account_mask),
    container_name: text(it.container_name),
    payouts_per_month: int(it.payouts_per_month),
    months: Array.isArray(it.months) ? it.months.map((m) => ({ month: m.month, payouts_cents: int(m.payouts_cents) })) : null,
    reason: it.reason ?? null
  };
}

/**
 * incomeForPlan({ income, bills, accounts, thresholds }) → inputs.income. Pure.
 *
 *   income      src/banking/income.mjs loadIncome() / detectIncome() output
 *   bills       listRecurringBillsFor() rows (camelCase), the same rows the cash
 *               check uses
 *   accounts    the overview's open accounts ({ id, type, kind })
 *   thresholds  loadThresholds() output
 *
 * Per kind: the SURE monthly money coming in (income.mjs), and that kind's
 * bills a month — the bills the detector is sure of (medium/high), on that
 * kind's OPEN checking and savings, each at its average month rounded up
 * (income.mjs monthlyBillCents). A bill charged to a card is not cash out, the
 * same rule as the cash check. Unsure bills are counted, not added, and named.
 *
 * The floor is the org's minimum buffer. Unset, it is $0 with floor_source
 * "spec-zero" — src/banking/cashflow.mjs paymentWindow()'s own rule ("zero is
 * the task; a buffer above it is a policy"), so the suggestion and the cash
 * check never disagree about the cushion.
 */
export function incomeForPlan({ income, bills = [], accounts = [], thresholds = {} } = {}) {
  if (!income || income.ok !== true) {
    return { ok: false, reason: (income && income.reason) || "not_read" };
  }
  const buffer = thresholds && Number.isSafeInteger(thresholds.minBufferCents) ? thresholds.minBufferCents : null;
  const cashKind = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (a && a.type === "depository") cashKind.set(String(a.id), a.kind || "unknown");
  }
  const byKind = {};
  for (const k of INCOME_KINDS) {
    const mine = (Array.isArray(bills) ? bills : []).filter((b) => b && cashKind.get(String(b.bankAccountId)) === k);
    const sure = mine.filter((b) => PRESENTABLE_LABELS.includes(b.confidenceLabel));
    const months = sure.map((b) => monthlyBillCents(b.typicalAmountCents, b.cadence));
    const src = (income.by_kind && income.by_kind[k]) || {};
    byKind[k] = {
      monthly_cents: int(src.monthly_cents),
      counted: int(src.counted) ?? 0,
      not_counted: int(src.not_counted) ?? 0,
      /* A bill whose size or cadence cannot be read makes the month unknown,
         never smaller. */
      bills_cents: months.every((c) => c !== null) ? months.reduce((s, c) => s + c, 0) : null,
      bill_count: sure.length,
      unsure_bill_count: mine.length - sure.length
    };
  }
  return {
    ok: true,
    as_of: text(income.detected_as_of),
    floor_cents: buffer === null ? 0 : buffer,
    floor_source: buffer === null ? "spec-zero" : "buffer-supplied",
    by_kind: byKind,
    items: (Array.isArray(income.items) ? income.items : []).map(incomeItem),
    not_counted: (Array.isArray(income.not_counted) ? income.not_counted : []).map(incomeItem),
    months_judged: Array.isArray(income.months_judged) ? income.months_judged : [],
    merchant_unavailable: income.merchant_unavailable === true,
    capped: income.capped === true
  };
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

const SAVED_SQL = `
  SELECT id, method, monthly_cents, goal_kind, goal_by::text AS goal_by, as_of::text AS as_of,
         debt_free_on::text AS debt_free_on, cash_check, saved_by_kind, created_at,
         inputs, milestones, summary
    FROM payment_strategy_plans
   WHERE org_id = $1 AND client_id = $2 AND superseded_at IS NULL
   LIMIT 1`;

/** The client's active saved plan, or null. A missing table (migration 463 not
 *  applied yet) reads as "no plan", never as a broken page. */
export async function readSavedPlan(db, { orgId, clientId }) {
  try {
    const r = await db.query(SAVED_SQL, [orgId, clientId]);
    return r.rows[0] ? shapeSaved(r.rows[0]) : null;
  } catch (e) {
    if (e && e.code === "42P01") return null;
    throw e;
  }
}

export function shapeSaved(row) {
  if (!row) return null;
  const created = row.created_at instanceof Date ? row.created_at.toISOString() : text(row.created_at);
  return {
    id: String(row.id),
    method: row.method,
    monthly_cents: int(row.monthly_cents),
    goal: row.goal_kind ? { kind: row.goal_kind, by: row.goal_by } : null,
    as_of: row.as_of,
    debt_free_on: row.debt_free_on,
    cash_check: row.cash_check,
    saved_by_kind: row.saved_by_kind,
    saved_at: created,
    inputs: Array.isArray(row.inputs) ? row.inputs : [],
    milestones: Array.isArray(row.milestones) ? row.milestones : [],
    summary: row.summary && typeof row.summary === "object" ? row.summary : {}
  };
}

/**
 * strategyInputs(db, { orgId, clientId, env, asOf }) → { client, as_of, sandbox,
 * tip, inputs, projections } or null when the client is not in that org.
 */
export async function strategyInputs(db, { orgId, clientId, env = process.env, asOf = new Date(), deps = {} } = {}) {
  const overview = deps.moneyOverview || moneyOverview;
  const listBills = deps.listRecurringBillsFor || listRecurringBillsFor;
  const thresholdsOf = deps.loadThresholds || loadThresholds;
  const incomeOf = deps.loadIncome || loadIncome;
  const plansOf = deps.listClarityPayments || listClarityPayments;
  const cleanupOf = deps.loadBillCleanup || loadBillCleanup;
  const today = new Date(asOf).toISOString().slice(0, 10);

  const ov = await overview(db, { orgId, clientId, env, asOf });
  if (!ov) return null;
  const [aprRes, bills, thresholds, income, financing, cleanup] = await Promise.all([
    db.query(APR_SQL, [clientId, orgId]),
    listBills(db, { orgId, clientId, presentableOnly: false }),
    thresholdsOf(db, { orgId }),
    incomeOf(db, { orgId, clientId, asOf }),
    readFinancing(plansOf, db, { orgId, clientId, today }),
    cleanupOf(db, { orgId, clientId, asOf })
  ]);
  const debts = [
    ...debtsFromOverview(ov, aprMap(aprRes.rows), { facts: cycleFacts(aprRes.rows), today }),
    ...financingDebts(financing.plans, { today })
  ];
  const cash = cashByKind({ accounts: ov.accounts, bills, debts, thresholds, today });
  return {
    client: ov.client,
    as_of: today,
    sandbox: ov.sandbox === true,
    tip: ov.tip ?? null,
    inputs: {
      as_of: today,
      debts,
      cash: { window: cash.window, by_kind: cash.by_kind },
      income: incomeForPlan({ income, bills, accounts: ov.accounts, thresholds }),
      financing: financing.ok ? { ok: true, plans: financingDebts(financing.plans, { today }).length } : { ok: false, reason: financing.reason }
    },
    bill_cleanup: cleanupForPage(cleanup),
    projections: cash.projections,
    thresholds
  };
}

/** The bill-cleanup answer as the page reads it: the flags, or why there are none. */
export function cleanupForPage(c) {
  if (!c || c.ok !== true) return { ok: false, reason: (c && c.reason) || "not_read" };
  return {
    ok: true,
    as_of: c.as_of,
    window_days: c.window_days,
    checked_bills: c.checked_bills,
    flags: (Array.isArray(c.flags) ? c.flags : []).map((f) => ({
      key: f.key, kind: f.kind, name: f.name, money_kind: f.money_kind, cadence: f.cadence,
      account_name: f.account_name, account_mask: f.account_mask, on: f.on,
      from_cents: f.from_cents ?? null, to_cents: f.to_cents ?? null, change_cents: f.change_cents ?? null,
      amount_cents: f.amount_cents ?? null,
      charges: Array.isArray(f.charges) ? f.charges : []
    }))
  };
}

/** The plan without the month rows — what a read or a save sends back. The
 *  page builds the month rows itself from the same inputs. */
export function planSummary(plan) {
  if (!plan) return null;
  const { months, ...rest } = plan;
  return { ...rest, month_count: Array.isArray(months) ? months.length : 0 };
}

/** What the page starts from: the saved plan's settings, else the minimums
 *  rounded up to the dollar, highest rate first. */
export function defaultSettings(inputs, saved) {
  if (saved && METHODS.includes(saved.method) && int(saved.monthly_cents) > 0) {
    const out = { method: saved.method, monthly_cents: saved.monthly_cents, goal: saved.goal };
    /* Present only when on, so the three-key shape other readers pin holds. */
    if (saved.summary && saved.summary.financing_first === true) out.financing_first = true;
    return out;
  }
  const probe = buildPlan(inputs, { method: "avalanche", monthly_cents: 1 });
  const min = probe.minimums_cents || 0;
  return { method: "avalanche", monthly_cents: min > 0 ? Math.ceil(min / 100) * 100 : null, goal: null };
}

export async function strategyPayload(db, { orgId, clientId, env = process.env, asOf = new Date(), deps = {} } = {}) {
  const built = await strategyInputs(db, { orgId, clientId, env, asOf, deps });
  if (!built) return null;
  const saved = await (deps.readSavedPlan || readSavedPlan)(db, { orgId, clientId });
  const defaults = defaultSettings(built.inputs, saved);
  const plan = buildPlan(built.inputs, defaults);
  return {
    ok: true,
    client: built.client,
    as_of: built.as_of,
    sandbox: built.sandbox,
    tip: built.tip,
    inputs: built.inputs,
    targets: TARGETS,
    methods: METHOD_INFO,
    sources: {
      debts: "src/finance/money-overview.mjs (the Overview tab's cards and loans); APR from account_statement_cycles",
      cash: "src/banking/cashflow.mjs project() + paymentWindow(), first month only, no money in modelled",
      income: "src/banking/income.mjs (repeat deposits and merchant payouts, sure monthly figure per kind) − bills a month (recurring_bills, average month) − minimums − floor; public/app/money-strategy-math.js suggestExtra",
      financing: "src/finance/clarity-payments.mjs listClarityPayments (open plans, what is left, recorded payments); paid / late for cards and loans from Plaid's last payment date on account_statement_cycles",
      bill_cleanup: "src/banking/bill-cleanup.mjs over bank_transactions (repeat bills from src/banking/recurring.mjs)",
      targets: TARGETS.map((t) => t.source),
      methods: Object.fromEntries(Object.entries(METHOD_INFO).map(([k, v]) => [k, v.source]))
    },
    defaults,
    plan: planSummary(plan),
    saved: saved ? savedForPage(saved) : null,
    bill_cleanup: built.bill_cleanup
  };
}

export function savedForPage(saved) {
  return {
    id: saved.id,
    method: saved.method,
    monthly_cents: saved.monthly_cents,
    goal: saved.goal,
    as_of: saved.as_of,
    debt_free_on: saved.debt_free_on,
    cash_check: saved.cash_check,
    saved_by_kind: saved.saved_by_kind,
    saved_at: saved.saved_at,
    steps: saved.milestones.length,
    ...(saved.summary && saved.summary.financing_first === true ? { financing_first: true } : {})
  };
}

/* ------------------------------------------------------------------ *
 * The save
 * ------------------------------------------------------------------ */

/** A request body → { settings } or { error }. */
export function readSettings(body = {}) {
  const method = text(body.method);
  if (!method || !METHODS.includes(method)) {
    return { error: `method must be one of ${METHODS.join(", ")}` };
  }
  const monthly = int(body.monthly_cents);
  if (monthly === null || monthly <= 0) return { error: "monthly_cents must be a whole number of cents above zero" };
  if (monthly > MAX_MONTHLY_CENTS) return { error: "monthly_cents is too large" };
  let goal = null;
  const g = body.goal;
  if (g !== undefined && g !== null && g !== "") {
    if (typeof g !== "object" || !GOAL_KINDS.includes(g.kind)) {
      return { error: `goal.kind must be one of ${GOAL_KINDS.join(", ")}` };
    }
    if (!parseDay(g.by)) return { error: "goal.by must be a date (YYYY-MM-DD)" };
    goal = { kind: g.kind, by: g.by };
  }
  const fin = body.financing_first;
  if (fin !== undefined && fin !== null && typeof fin !== "boolean") return { error: "financing_first must be true or false" };
  const settings = { method, monthly_cents: monthly, goal };
  if (fin === true) settings.financing_first = true;
  return { settings };
}

const REFUSALS = {
  no_debts: () => "There are no cards or loans with a balance to plan for.",
  no_amount: () => "Pick how much you can put toward debt each month.",
  as_of_invalid: () => "The plan could not tell what day it is.",
  below_minimums: (r) => `That is less than the minimum payments (${usd(r.minimums_cents)} a month). Pick at least that much.`
};

function refusalWords(reason) {
  const f = reason && REFUSALS[reason.code];
  return f ? f(reason) : "The plan could not be made.";
}

const SAVE_SQL = `
  WITH old AS (
    UPDATE payment_strategy_plans SET superseded_at = now()
     WHERE org_id = $1 AND client_id = $2 AND superseded_at IS NULL
    RETURNING id
  )
  INSERT INTO payment_strategy_plans
    (org_id, client_id, method, monthly_cents, goal_kind, goal_by, as_of, debt_free_on,
     inputs, milestones, summary, cash_check, saved_by_kind, saved_by_id)
  SELECT $1, $2, $3, $4, $5, $6::date, $7::date, $8::date,
         $9::jsonb, $10::jsonb, $11::jsonb, $12, $13, $14
    FROM (SELECT count(*) AS superseded FROM old) o
  RETURNING id, method, monthly_cents, goal_kind, goal_by::text AS goal_by, as_of::text AS as_of,
            debt_free_on::text AS debt_free_on, cash_check, saved_by_kind, created_at,
            inputs, milestones, summary`;

/**
 * savePlan(db, { orgId, clientId, settings, savedByKind, savedById, env, asOf })
 *
 * Recomputes the plan HERE from fresh reads — never from the browser's numbers
 * — then asks cashflow.mjs again about each kind's first month, then stores it
 * as the client's one active plan (the old one is kept, marked superseded).
 *
 * → { ok: true, saved, plan } or { ok: false, status, error, message, ... }
 */
export async function savePlan(db, {
  orgId, clientId, settings, savedByKind, savedById = null, env = process.env, asOf = new Date(), deps = {}
} = {}) {
  const built = await strategyInputs(db, { orgId, clientId, env, asOf, deps });
  if (!built) return { ok: false, status: 404, error: "not_found" };
  const plan = buildPlan(built.inputs, settings);
  if (!plan.ok) {
    return { ok: false, status: 422, error: plan.reason.code, message: refusalWords(plan.reason), minimums_cents: plan.minimums_cents };
  }

  const over = plan.cash ? plan.cash.by_kind.find((r) => r.status === "over") : null;
  if (over) {
    const max = plan.cash.max_safe && plan.cash.max_safe.monthly_cents;
    return {
      ok: false,
      status: 409,
      error: "over_safe_amount",
      message: `This month that sends ${usd(over.planned_cents)} to ${KIND_WORD[over.kind]} debts, and ${KIND_WORD[over.kind]} cash can only cover ${usd(over.safe_cents)} without going below zero.` +
        (Number.isSafeInteger(max) ? ` The most you can save as a plan right now is ${usd(max)} a month.` : ""),
      max_safe_monthly_cents: Number.isSafeInteger(max) ? max : null
    };
  }

  /* Belt and braces: the planned month-1 total per kind, straight into
     paymentWindow(), so the projector itself says yes before anything is kept. */
  for (const row of plan.cash ? plan.cash.by_kind : []) {
    if (row.status !== "safe") continue;
    const projection = built.projections[row.kind];
    if (!projection || !projection.ok) continue;
    const w = paymentWindow({
      projectedBalances: projection,
      dueDate: built.inputs.cash.window.to,
      paymentAmountCents: row.planned_cents,
      now: built.as_of,
      thresholds: built.thresholds
    });
    if (!w.ok && w.reason?.code === "WOULD_OVERDRAW") {
      return { ok: false, status: 409, error: "over_safe_amount", message: w.reason.message, max_safe_monthly_cents: null };
    }
  }

  const summary = {
    debt_free_on: plan.debt_free ? plan.debt_free.on : null,
    debt_free_earliest: plan.debt_free ? plan.debt_free.earliest : null,
    interest_cents: plan.interest_cents,
    interest_saved_cents: plan.interest_saved_cents,
    months_saved: plan.months_saved,
    minimums_cents: plan.minimums_cents,
    crossings: plan.crossings,
    financing_first: plan.financing_first === true,
    cash: plan.cash ? {
      status: plan.cash.status,
      window: built.inputs.cash.window,
      by_kind: plan.cash.by_kind.map((r) => ({ kind: r.kind, status: r.status, planned_cents: r.planned_cents, safe_cents: r.safe_cents }))
    } : null,
    warnings: plan.warnings
  };
  const inputs = plan.debts.map((d) => ({
    id: d.id, name: d.name, type: d.type, kind: d.kind, container_id: d.container_id,
    balance_cents: d.balance_cents, limit_cents: d.limit_cents, apr_pct: d.apr_pct, min_cents: d.min_cents
  }));
  const cashCheck = plan.cash ? plan.cash.status : "unknown";

  try {
    const r = await db.query(SAVE_SQL, [
      orgId, clientId, plan.method, plan.monthly_cents,
      settings.goal ? settings.goal.kind : null,
      settings.goal ? settings.goal.by : null,
      built.as_of,
      plan.debt_free ? plan.debt_free.on : null,
      JSON.stringify(inputs),
      JSON.stringify(plan.milestones),
      JSON.stringify(summary),
      cashCheck,
      savedByKind,
      savedById
    ]);
    return { ok: true, saved: savedForPage(shapeSaved(r.rows[0])), plan: planSummary(plan) };
  } catch (e) {
    if (e && e.code === "23505") {
      return { ok: false, status: 409, error: "save_conflict", message: "Another save of this plan happened at the same moment. Try again." };
    }
    throw e;
  }
}
