// Money coming in — the paychecks, deposits and merchant payouts that repeat,
// and how much of them lands EVERY month for sure.
//
// Finance OS CFO build, unit C (ops/workflows/finance-os-cfo-build-2026-11-06.txt,
// spec item 6): "Finds repeat paychecks, deposits and merchant payouts. Feeds the
// payoff plan, so snowball knows how much extra can go to debt each month."
//
// THIS IS THE OTHER HALF OF src/banking/recurring.mjs. That file finds repeat
// money going OUT and refuses every positive row by name (`inflow_not_an_outflow`).
// This file finds repeat money coming IN and refuses every negative row by name
// (`outflow_not_an_inflow`). The sign rule is the same one, stated once in
// db/migrations/085_bank_transactions.sql section 1:
//
//   *** NEGATIVE amount_cents = MONEY LEFT THE ACCOUNT.
//   *** POSITIVE amount_cents = MONEY ENTERED THE ACCOUNT.
//
// Nothing here takes an absolute value of a bank row to decide which way it went.
//
// THE CALENDAR AND THE CONFIDENCE ARE recurring.mjs's, NOT A SECOND COPY.
// dayNumber, advance (calendar-month arithmetic), fitCadence (error measured
// against the calendar), scoreConfidence, labelFor and capLabelForEvidence are
// imported from there. A paycheck and a bill are judged by the same arithmetic,
// so "steady" means the same thing on both sides of the money.
//
//
// WHAT COUNTS, AND WHY EACH RULE IS THERE
//
//   * ONLY OPEN CHECKING AND SAVINGS. A positive row on a credit card is a card
//     payment or a refund, not income. A closed account is history.
//   * POSTED, NOT PENDING, NOT REMOVED. The same reasons recurring.mjs gives.
//   * GROUPED BY (ACCOUNT, PAYER). The payer is normaliseMerchant() of the bank's
//     own descriptor — "ACME CORP PAYROLL PPD ID: 4471" and "... ID: 8813" are one
//     payer. Two deposits from one payer on one day are ADDED (a paycheck split in
//     two is still one paycheck); the typical amount is the MEDIAN of the paydays,
//     so one bonus day does not move it.
//   * FOUR CADENCES: every week, every two weeks, twice a month, every month.
//     "Twice a month" (the 1st and 15th, or the 15th and the last day) is not in
//     recurring.mjs — 086's CHECK has no room for it — so it is fitted here as two
//     monthly series, one per payday, each judged by recurring.mjs's own monthly
//     fit. Every two weeks drifts through the month; twice a month does not; the
//     smaller calendar error picks between them.
//   * THREE TIMES BEFORE IT COUNTS. Two deposits are a line through two points
//     (recurring.mjs section 2) and are listed as "seen twice", never counted.
//     One deposit is a one-off and is never counted.
//   * A PAYCHECK THAT STOPPED DOES NOT COUNT. When two paydays in a row have
//     passed with no deposit, there is no next date, and no next date means not
//     counted.
//
// WHAT IS NOT INCOME, EVEN THOUGH IT IS POSITIVE
//
//   * MONEY MOVED BETWEEN THE CLIENT'S OWN ACCOUNTS. A deposit matched by a
//     withdrawal of the SAME number of cents from another of the client's own
//     accounts within 3 days is a transfer (`own_account_transfer`). Savings to
//     checking is not a raise.
//   * WHAT THE BANK ITSELF LABELS AS OWN-MONEY MOVES: an account transfer, a move
//     from savings or investments, or loan / cash-advance money
//     (`provider_says_own_money_move`). The category is the provider's own string,
//     stored verbatim by src/banking/plaid-transactions.mjs. Only those named
//     categories are refused; a payroll row stays a payroll row.
//   * A MERCHANT PAYOUT LANDING. When a processor connection (Commas, Whop, an
//     open-API processor, migration 442) is counted from the processor's own
//     payout records, the matching bank deposits — same cents, 0 to 5 days after
//     the payout — are refused (`merchant_payout_landing`) so the same money is
//     not counted twice. A connection that is NOT counted leaves its bank side
//     alone.
//
//
// "A MONTH FOR SURE" — THE NUMBER THIS FILE EXISTS TO PRODUCE
//
// A paycheck every two weeks pays 26 times a year, but most months get two and
// two months a year get three. A plan that counted 26/12 = 2.17 paychecks a month
// would spend money that, ten months out of twelve, never arrives. So the monthly
// figure here is the typical amount times the paydays EVERY month has:
//
//   every week 4 · every two weeks 2 · twice a month 2 · every month 1
//
// The extra payday in a long month is a bonus the client gets, not a number the
// plan spends. Merchant payouts are not on a payday schedule, so their monthly
// figure is the SLOWEST of the last three full months, and it is only counted
// when all three months had a payout.
//
//
// PERSONAL AND BUSINESS ARE NEVER ADDED TOGETHER. by_kind keeps personal,
// business and not-sorted-yet apart; there is no total across them anywhere in
// this file. A kind is the account's container kind (entities, migration 106)
// when it sits in one, else its stored entity_kind — the overview's own rule.
// Unknown is never folded into personal.
//
// UNKNOWN IS NULL, NEVER 0. A kind where nothing repeating was found has
// monthly_cents null and a reason. Not finding a paycheck is not proof of no pay.
//
// MONEY IS INTEGER CENTS. The only averaging is medianCents() from recurring.mjs,
// which rounds through roundHalfUp().
//
// detectIncome() is PURE: rows in, answer out, `now` is a parameter. loadIncome()
// is the one read, scoped on org_id and client_id on every statement, and it
// writes nothing.

import {
  CADENCES,
  PRESENTABLE_LABELS,
  REASONS,
  parseDay,
  formatDay,
  normaliseMerchant,
  medianCents,
  dayNumber,
  daysBetween,
  fromDayNumber,
  advance,
  fitCadence,
  scoreConfidence,
  labelFor,
  capLabelForEvidence
} from "./recurring.mjs";

/* ========================================================================== *
 * Vocabulary
 * ========================================================================== */

export const INCOME_KINDS = Object.freeze(["personal", "business", "unknown"]);

/** Twice a month, fitted as two monthly series (see fitSemimonthly). Its
 *  toleranceDays is the monthly one, because each half is judged as monthly. */
export const SEMIMONTHLY = Object.freeze({
  name: "semimonthly", days: 365.25 / 24, toleranceDays: 4, months: 0, stepDays: 0
});

/** Evaluation order, fixed so a tie always lands the same way. */
export const INCOME_CADENCE_NAMES = Object.freeze(["weekly", "biweekly", "semimonthly", "monthly"]);

/** Paydays every calendar month is sure to have. See the header. */
export const SURE_PER_MONTH = Object.freeze({ weekly: 4, biweekly: 2, semimonthly: 2, monthly: 1 });

/** How often a cadence lands in a year — used for BILLS only (monthlyBillCents). */
export const PER_YEAR = Object.freeze({ weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12, annual: 1 });

/** Merchant payouts: this many full calendar months, every one with a payout. */
export const MERCHANT_MONTHS = 3;

/** A merchant payout lands in the bank this many days after it leaves, at most. */
export const PAYOUT_LANDING_DAYS = 5;

/** How many missed paydays before a source is "stopped". See judgeGroup(). */
export const INCOME_ROLL_FORWARD = 1;

/** A deposit and a withdrawal of the same cents this close are one transfer. */
export const TRANSFER_MATCH_DAYS = 3;

/** How far back the read looks. Seven months gives a monthly payer six or seven
 *  paydays and a weekly one about thirty. */
export const WINDOW_DAYS = 210;

/** The read's row cap, so one busy account cannot ship an unbounded list. */
export const ROW_CAP = 6000;

/* The provider's own labels for money that is the client's own, moved. Plaid's
   personal_finance_category detailed names, plus the legacy "Internal Account
   Transfer". Deliberately narrow: legacy Plaid filed payroll under
   "Transfer > Payroll", so a bare /transfer/ would throw paychecks away. */
const OWN_MONEY_CATEGORY = /TRANSFER_IN_ACCOUNT_TRANSFER|TRANSFER_IN_SAVINGS|TRANSFER_IN_INVESTMENT_AND_RETIREMENT_FUNDS|TRANSFER_IN_CASH_ADVANCES_AND_LOANS|INTERNAL ACCOUNT TRANSFER/i;

/* The bank's own words for a paycheck. Only a label — it changes no number. */
const PAYCHECK_CATEGORY = /INCOME_WAGES|PAYROLL/i;
const PAYCHECK_PAYER = /\bPAYROLL\b|\bDIR(?:ECT)? DEP\b|\bSALARY\b/;

/** Stable reasons one row was not used. A caller branches on these. */
export const INCOME_EXCLUSIONS = Object.freeze({
  NOT_AN_OBJECT: "not_an_object",
  NO_ACCOUNT: "missing_bank_account_id",
  NO_PROVIDER_ID: "missing_provider_transaction_id",
  DUPLICATE: "duplicate_provider_transaction_id",
  PENDING: "pending_transaction",
  NOT_INTEGER_CENTS: "amount_not_integer_cents",
  ZERO: "zero_amount",
  OUTFLOW: "outflow_not_an_inflow",
  NO_DATE: "no_posted_date",
  BAD_DATE: "unparseable_posted_date",
  NO_PAYER: "no_payer_name",
  ACCOUNT_NOT_ON_FILE: "account_not_on_file",
  ACCOUNT_CLOSED: "account_closed",
  NOT_CASH: "not_a_checking_or_savings_account",
  OWN_TRANSFER: "own_account_transfer",
  PROVIDER_TRANSFER: "provider_says_own_money_move",
  PAYOUT_LANDING: "merchant_payout_landing"
});

/** Why a found source is listed but not counted. */
export const NOT_COUNTED = Object.freeze({
  ONE_OFF: "one_off_not_repeating",
  NO_CADENCE: "no_steady_schedule",
  SEEN_TWICE: "seen_twice_needs_a_third",
  NOT_STEADY: "not_steady_enough",
  STOPPED: "stopped_coming_in",
  CONNECTION_OFF: "connection_not_active",
  NEEDS_MONTHS: "needs_three_full_months_of_payouts"
});

/* ========================================================================== *
 * Small readers
 * ========================================================================== */

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function pick(row, ...names) {
  for (const n of names) if (row[n] !== undefined) return row[n];
  return undefined;
}

/* pg hands bigint back as a string. A decimal string is dollars in a cents
   column and is refused, never coerced — recurring.mjs's rule. */
function intCents(v) {
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return Number.isSafeInteger(v) ? v : null;
}

/* The overview's kind rule, restated in two lines rather than importing
   src/finance into src/banking. Anything but personal/business is unknown. */
function readKind(value) {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "personal" || v === "business" ? v : "unknown";
}

function lastFour(v) {
  const s = text(v);
  if (s === null) return null;
  return s.length <= 4 ? s : s.slice(-4);
}

function monthKey(day) {
  return `${String(day.y).padStart(4, "0")}-${String(day.m).padStart(2, "0")}`;
}

/** 'YYYY-MM' n months before another. */
function monthMinus(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/* ========================================================================== *
 * Accounts
 * ========================================================================== */

/**
 * One account map from whatever the caller holds: bank_accounts rows (with an
 * optional `container_kind` from the entities join) or the overview's views
 * ({ id, type, kind, name, mask }). Kind = container kind, else entity_kind.
 */
export function accountMap(accounts = []) {
  const out = new Map();
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || typeof a !== "object") continue;
    const id = text(a.id);
    if (!id) continue;
    const container = text(a.container_kind);
    out.set(id, {
      id,
      type: text(a.account_type) ?? text(a.type),
      closed: Boolean(a.closed_at),
      kind: container ? readKind(container) : readKind(a.kind ?? a.entity_kind),
      name: text(a.name) || text(a.official_name),
      mask: lastFour(a.mask)
    });
  }
  return out;
}

/* ========================================================================== *
 * Row reading — the mirror image of recurring.mjs readRow()
 * ========================================================================== */

function readInflowRow(row, index) {
  const bad = (reason, providerTransactionId = null) => ({ ok: false, excluded: { index, reason, providerTransactionId } });
  if (row === null || typeof row !== "object" || Array.isArray(row)) return bad(INCOME_EXCLUSIONS.NOT_AN_OBJECT);

  const providerTransactionId = text(pick(row, "provider_transaction_id", "providerTransactionId"));
  if (!providerTransactionId) return bad(INCOME_EXCLUSIONS.NO_PROVIDER_ID);
  const bankAccountId = text(pick(row, "bank_account_id", "bankAccountId"));
  if (!bankAccountId) return bad(INCOME_EXCLUSIONS.NO_ACCOUNT, providerTransactionId);
  if (pick(row, "is_pending", "isPending") === true) return bad(INCOME_EXCLUSIONS.PENDING, providerTransactionId);

  const amountCents = intCents(pick(row, "amount_cents", "amountCents"));
  if (amountCents === null) return bad(INCOME_EXCLUSIONS.NOT_INTEGER_CENTS, providerTransactionId);
  if (amountCents === 0) return bad(INCOME_EXCLUSIONS.ZERO, providerTransactionId);
  if (amountCents < 0) return bad(INCOME_EXCLUSIONS.OUTFLOW, providerTransactionId);

  const postedRaw = pick(row, "posted_on", "postedOn");
  if (postedRaw === null || postedRaw === undefined || postedRaw === "") return bad(INCOME_EXCLUSIONS.NO_DATE, providerTransactionId);
  const postedOn = parseDay(postedRaw);
  if (!postedOn) return bad(INCOME_EXCLUSIONS.BAD_DATE, providerTransactionId);

  const payerRaw = pick(row, "merchant_name", "merchantName");
  const payerKey = normaliseMerchant(payerRaw);
  if (!payerKey) return bad(INCOME_EXCLUSIONS.NO_PAYER, providerTransactionId);

  return {
    ok: true,
    occurrence: {
      index,
      id: text(pick(row, "id", "transaction_id", "transactionId")),
      bankAccountId,
      providerTransactionId,
      amountCents,
      postedOn,
      day: dayNumber(postedOn),
      payerKey,
      payerDisplay: typeof payerRaw === "string" ? payerRaw : null,
      category: text(pick(row, "category"))
    }
  };
}

/* The withdrawals a deposit might be the other half of. Only what matching
   needs; every other field of an outflow is ignored here. */
function readOutflow(row) {
  if (!row || typeof row !== "object") return null;
  if (pick(row, "is_pending", "isPending") === true) return null;
  const amountCents = intCents(pick(row, "amount_cents", "amountCents"));
  if (amountCents === null || amountCents >= 0) return null;
  const postedOn = parseDay(pick(row, "posted_on", "postedOn"));
  const bankAccountId = text(pick(row, "bank_account_id", "bankAccountId"));
  const providerTransactionId = text(pick(row, "provider_transaction_id", "providerTransactionId"));
  if (!postedOn || !bankAccountId || !providerTransactionId) return null;
  return { bankAccountId, providerTransactionId, cents: -amountCents, day: dayNumber(postedOn) };
}

/* ========================================================================== *
 * Cadence fitting
 * ========================================================================== */

/**
 * Twice a month, as two monthly series. The paydays alternate between two days
 * of the month, so the even-numbered and odd-numbered paydays are each a monthly
 * series with its own anchor, and each is judged by recurring.mjs fitCadence()
 * on the calendar. Every-two-weeks data split this way drifts by two days a
 * month and fails; true twice-a-month data scores zero error.
 */
export function fitSemimonthly(days) {
  const halves = [days.filter((_, i) => i % 2 === 0), days.filter((_, i) => i % 2 === 1)];
  if (halves.some((h) => h.length < 2)) return null;
  const anchors = halves.map((h) => Math.max(...h.map((d) => d.d)));
  /* The two paydays must be about half a month apart; two anchors on nearly
     the same day of the month are one monthly payer, not two paydays. */
  const gap = Math.abs(anchors[0] - anchors[1]);
  if (gap < 10 || gap > 20) return null;
  let fits = 0;
  let intervals = 0;
  let missed = 0;
  let errorSum = 0;
  let spanned = 0;
  for (let i = 0; i < 2; i += 1) {
    const f = fitCadence(halves[i], CADENCES.monthly, anchors[i]);
    const n = halves[i].length - 1;
    intervals += n;
    fits += f.fits;
    missed += f.missedPeriods;
    spanned += f.spannedPeriods;
    if (f.fits > 0) errorSum += f.avgErrorDays * f.fits;
  }
  return {
    cadence: SEMIMONTHLY,
    fitRatio: intervals === 0 ? 0 : fits / intervals,
    fits,
    missedPeriods: missed,
    spannedPeriods: spanned,
    avgErrorDays: fits === 0 ? Infinity : errorSum / fits,
    anchors: [...anchors].sort((a, b) => a - b)
  };
}

const MIN_FIT_RATIO = 0.6;

/* recurring.mjs chooseCadence()'s ranking: fewest missed periods, then the best
   fit ratio, then the smallest calendar error, then the fixed order. */
function chooseIncomeCadence(days) {
  const anchorDom = Math.max(...days.map((d) => d.d));
  const fits = [
    fitCadence(days, CADENCES.weekly, anchorDom),
    fitCadence(days, CADENCES.biweekly, anchorDom),
    fitSemimonthly(days),
    { ...fitCadence(days, CADENCES.monthly, anchorDom), anchors: [anchorDom] }
  ].filter((f) => f && f.fitRatio >= MIN_FIT_RATIO);
  if (fits.length === 0) return null;
  fits.sort((a, b) => {
    if (a.missedPeriods !== b.missedPeriods) return a.missedPeriods - b.missedPeriods;
    if (a.fitRatio !== b.fitRatio) return b.fitRatio - a.fitRatio;
    if (a.avgErrorDays !== b.avgErrorDays) return a.avgErrorDays - b.avgErrorDays;
    return INCOME_CADENCE_NAMES.indexOf(a.cadence.name) - INCOME_CADENCE_NAMES.indexOf(b.cadence.name);
  });
  return fits[0];
}

/**
 * The first payday strictly after `day`, for one cadence. Monthly and twice a
 * month use the calendar (an anchor of 31 is the 30th in a 30-day month and the
 * 31st again after it), never an average month length.
 */
export function nextPayday(day, cadence, anchors = []) {
  if (cadence === "weekly" || cadence === "biweekly") {
    return fromDayNumber(dayNumber(day) + CADENCES[cadence].stepDays);
  }
  if (cadence === "monthly") return advance(day, CADENCES.monthly, 1, anchors[0] ?? day.d);
  if (cadence === "semimonthly") {
    const after = dayNumber(day);
    for (let k = 0; k <= 2; k += 1) {
      const total = day.y * 12 + (day.m - 1) + k;
      const y = Math.floor(total / 12);
      const m = (total % 12) + 1;
      for (const a of [...anchors].sort((p, q) => p - q)) {
        const cand = { y, m, d: Math.min(a, daysInMonth(y, m)) };
        if (dayNumber(cand) > after) return cand;
      }
    }
  }
  return null;
}

/**
 * Every payday of one counted item from `from` to `to`, inclusive, as
 * 'YYYY-MM-DD'. Starts at its next expected date; nothing before `from`.
 */
export function incomeOccurrences(item, { from, to } = {}) {
  const start = parseDay(item && item.next_expected_on);
  const a = parseDay(from);
  const b = parseDay(to);
  if (!start || !a || !b || !SURE_PER_MONTH[item.cadence]) return [];
  const out = [];
  let d = start;
  for (let guard = 0; guard < 400 && d && dayNumber(d) <= dayNumber(b); guard += 1) {
    if (dayNumber(d) >= dayNumber(a)) out.push(formatDay(d));
    d = nextPayday(d, item.cadence, item.anchor_days || []);
  }
  return out;
}

/* ========================================================================== *
 * Money helpers
 * ========================================================================== */

/** The sure monthly figure for one paycheck: typical × paydays every month has. */
export function sureMonthlyCents(typicalCents, cadence) {
  const n = SURE_PER_MONTH[cadence];
  if (!Number.isSafeInteger(typicalCents) || typicalCents <= 0 || !n) return null;
  return typicalCents * n;
}

/**
 * A BILL's average month, rounded UP — the careful direction for money going
 * out. A weekly bill is 52 a year, so 52/12 a month; an annual one is a twelfth.
 * The sign of a stored bill (negative, 086) is ignored: this is its size.
 */
export function monthlyBillCents(typicalAmountCents, cadence) {
  const cents = intCents(typicalAmountCents);
  const perYear = PER_YEAR[cadence];
  if (cents === null || !perYear) return null;
  return Math.ceil((Math.abs(cents) * perYear) / 12);
}

/* ========================================================================== *
 * Merchant payouts
 * ========================================================================== */

/** The full calendar months merchant payouts are judged on, oldest first. */
export function merchantMonths(today) {
  const now = monthKey(today);
  const out = [];
  for (let i = MERCHANT_MONTHS; i >= 1; i -= 1) out.push(monthMinus(now, i));
  return out;
}

function merchantSources(rows, { today }) {
  const months = merchantMonths(today);
  const byConn = new Map();
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!r || typeof r !== "object") continue;
    const connectionId = text(r.connection_id);
    const eventId = text(r.provider_event_id);
    const cents = intCents(r.amount_cents);
    const day = parseDay(r.occurred_on);
    if (!connectionId || !eventId || cents === null || !day) continue;
    const key = `${connectionId} ${eventId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!byConn.has(connectionId)) {
      byConn.set(connectionId, {
        connectionId,
        provider: text(r.provider),
        status: text(r.status),
        kind: readKind(r.entity_kind),
        containerName: text(r.entity_name),
        events: []
      });
    }
    byConn.get(connectionId).events.push({ cents, day, eventId });
  }

  const out = [];
  for (const c of byConn.values()) {
    /* 442: a payout is negative when money left the processor for the bank and
       positive only when a payout was reversed. Money in = minus the sum. */
    const perMonth = months.map((m) => {
      const inMonth = c.events.filter((e) => monthKey(e.day) === m);
      return {
        month: m,
        payouts_cents: -inMonth.reduce((s, e) => s + e.cents, 0),
        payout_count: inMonth.filter((e) => e.cents < 0).length
      };
    });
    const out1 = c.events.filter((e) => e.cents < 0);
    const lastDay = out1.length ? out1.reduce((m, e) => (dayNumber(e.day) > dayNumber(m) ? e.day : m), out1[0].day) : null;
    const everyMonth = perMonth.every((m) => m.payouts_cents > 0);
    const active = c.status === "active";
    const counted = active && everyMonth;
    const count = perMonth.reduce((s, m) => s + m.payout_count, 0);
    out.push({
      id: `merchant:${c.connectionId}`,
      source: "merchant_payout",
      connection_id: c.connectionId,
      provider: c.provider,
      container_name: c.containerName,
      kind: c.kind,
      name: c.provider ? `${PROVIDER_WORDS[c.provider] || c.provider} payouts` : "Processor payouts",
      cadence: null,
      payouts_per_month: Math.round(count / MERCHANT_MONTHS),
      months: perMonth,
      typical_cents: null,
      monthly_cents: counted ? Math.min(...perMonth.map((m) => m.payouts_cents)) : null,
      last_seen_on: lastDay ? formatDay(lastDay) : null,
      next_expected_on: null,
      counted,
      reason: counted ? null : !active ? NOT_COUNTED.CONNECTION_OFF : NOT_COUNTED.NEEDS_MONTHS,
      events: out1
    });
  }
  out.sort((a, b) => String(a.connection_id).localeCompare(String(b.connection_id)));
  return out;
}

const PROVIDER_WORDS = Object.freeze({ commas: "Commas", whop: "Whop", api: "Processor" });

/* ========================================================================== *
 * Detection
 * ========================================================================== */

/**
 * detectIncome(rows, { now, accounts, merchantPayouts }) — PURE.
 *
 * @param {Array}  rows             bank_transactions rows for ONE client, every
 *                                  account, both signs (the withdrawals are what
 *                                  prove a deposit was the client's own money).
 * @param {object} opts
 * @param {string|Date} opts.now    REQUIRED. No clock in here.
 * @param {Array}  opts.accounts    accountMap() input: the client's accounts.
 * @param {Array}  [opts.merchantPayouts] merchant_events payout rows joined to
 *                                  their connection: { connection_id, provider,
 *                                  status, entity_kind, entity_name,
 *                                  provider_event_id, amount_cents, occurred_on }
 *
 * @returns {{ ok: true, detected_as_of, items, not_counted, by_kind, excluded,
 *             months_judged }}
 *   items        counted sources. by_kind sums ONLY these, per kind.
 *   not_counted  found but not counted, each with a reason. *** NOT INCOME. ***
 *   excluded     single rows not used, each with a reason and its provider id.
 */
export function detectIncome(rows, { now, accounts = [], merchantPayouts = [] } = {}) {
  if (now === undefined || now === null) {
    throw new TypeError("detectIncome: `now` is required. This finder has no clock.");
  }
  const today = parseDay(now instanceof Date ? now.toISOString() : now);
  if (!today) throw new TypeError(`detectIncome: unparseable \`now\`: ${String(now)}`);
  if (!Array.isArray(rows)) throw new TypeError("detectIncome: `rows` must be an array");

  const acct = accountMap(accounts);
  const excluded = [];
  const seen = new Set();
  const inflows = [];

  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i];
    const amount = r && typeof r === "object" ? intCents(pick(r, "amount_cents", "amountCents")) : null;
    if (amount !== null && amount < 0) continue; // a withdrawal: only used for matching below
    const read = readInflowRow(r, i);
    if (!read.ok) { excluded.push(read.excluded); continue; }
    const occ = read.occurrence;
    const key = `${occ.bankAccountId} ${occ.providerTransactionId}`;
    if (seen.has(key)) {
      excluded.push({ index: i, reason: INCOME_EXCLUSIONS.DUPLICATE, providerTransactionId: occ.providerTransactionId });
      continue;
    }
    seen.add(key);
    const a = acct.get(occ.bankAccountId);
    const why = !a ? INCOME_EXCLUSIONS.ACCOUNT_NOT_ON_FILE
      : a.closed ? INCOME_EXCLUSIONS.ACCOUNT_CLOSED
        : a.type !== "depository" ? INCOME_EXCLUSIONS.NOT_CASH
          : occ.category && OWN_MONEY_CATEGORY.test(occ.category) ? INCOME_EXCLUSIONS.PROVIDER_TRANSFER
            : null;
    if (why) { excluded.push({ index: i, reason: why, providerTransactionId: occ.providerTransactionId }); continue; }
    inflows.push(occ);
  }

  /* -- Own-account transfers: one withdrawal pairs with at most one deposit -- */
  const outflows = [];
  const outSeen = new Set();
  for (const r of rows) {
    const o = readOutflow(r);
    if (!o || !acct.has(o.bankAccountId)) continue;
    const k = `${o.bankAccountId} ${o.providerTransactionId}`;
    if (outSeen.has(k)) continue;
    outSeen.add(k);
    outflows.push(o);
  }
  const used = new Set();
  const byOrder = (a, b) => a.day - b.day || a.providerTransactionId.localeCompare(b.providerTransactionId);
  const keep = [];
  for (const inc of [...inflows].sort(byOrder)) {
    const match = outflows
      .filter((o) => !used.has(o) && o.cents === inc.amountCents && o.bankAccountId !== inc.bankAccountId &&
        Math.abs(o.day - inc.day) <= TRANSFER_MATCH_DAYS)
      .sort((a, b) => Math.abs(a.day - inc.day) - Math.abs(b.day - inc.day) || byOrder(a, b))[0];
    if (match) {
      used.add(match);
      excluded.push({ index: inc.index, reason: INCOME_EXCLUSIONS.OWN_TRANSFER, providerTransactionId: inc.providerTransactionId, matched_provider_transaction_id: match.providerTransactionId });
      continue;
    }
    keep.push(inc);
  }

  /* -- Merchant payouts first, so a counted processor's landings drop out -- */
  const merchant = merchantSources(merchantPayouts, { today });
  const landings = [];
  for (const m of merchant) if (m.counted) for (const e of m.events) landings.push({ cents: -e.cents, day: dayNumber(e.day), used: false });
  const bank = [];
  for (const inc of keep) {
    const hit = landings.find((l) => !l.used && l.cents === inc.amountCents && inc.day - l.day >= 0 && inc.day - l.day <= PAYOUT_LANDING_DAYS);
    if (hit) {
      hit.used = true;
      excluded.push({ index: inc.index, reason: INCOME_EXCLUSIONS.PAYOUT_LANDING, providerTransactionId: inc.providerTransactionId });
      continue;
    }
    bank.push(inc);
  }

  /* -- Group by (account, payer) and judge each group -------------------- */
  const groups = new Map();
  for (const occ of bank) {
    const k = `${occ.bankAccountId} ${occ.payerKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(occ);
  }
  const items = [];
  const notCounted = [];
  for (const occs of groups.values()) {
    const judged = judgeGroup(occs, { today, account: acct.get(occs[0].bankAccountId) });
    (judged.counted ? items : notCounted).push(judged);
  }
  for (const m of merchant) {
    const { events, ...shown } = m;
    (m.counted ? items : notCounted).push(shown);
  }

  const order = (a, b) => INCOME_KINDS.indexOf(a.kind) - INCOME_KINDS.indexOf(b.kind) ||
    (b.monthly_cents ?? -1) - (a.monthly_cents ?? -1) || String(a.id).localeCompare(String(b.id));
  items.sort(order);
  notCounted.sort(order);

  const byKind = {};
  for (const k of INCOME_KINDS) {
    const mine = items.filter((it) => it.kind === k);
    byKind[k] = {
      monthly_cents: mine.length ? mine.reduce((s, it) => s + it.monthly_cents, 0) : null,
      counted: mine.length,
      not_counted: notCounted.filter((it) => it.kind === k).length,
      reason: mine.length ? null : "nothing_found"
    };
  }

  return {
    ok: true,
    detected_as_of: formatDay(today),
    months_judged: merchantMonths(today),
    items,
    not_counted: notCounted,
    by_kind: byKind,
    excluded
  };
}

/**
 * One (account, payer) group → a counted item or a not-counted one. Same
 * evidence rules as recurring.mjs detectOneGroup(), with paydays added (not
 * medianed) inside a day.
 */
function judgeGroup(occs, { today, account }) {
  const first = occs[0];
  const byDay = new Map();
  for (const o of occs) {
    const k = formatDay(o.postedOn);
    if (!byDay.has(k)) byDay.set(k, { day: o.postedOn, cents: 0, providerIds: [], display: o.payerDisplay, category: o.category });
    const b = byDay.get(k);
    b.cents += o.amountCents;
    b.providerIds.push(o.providerTransactionId);
    if (o.category) b.category = o.category;
    b.display = o.payerDisplay || b.display;
  }
  const days = [...byDay.values()].sort((a, b) => dayNumber(a.day) - dayNumber(b.day));
  const last = days[days.length - 1];
  const isPaycheck = days.some((d) => d.category && PAYCHECK_CATEGORY.test(d.category)) || PAYCHECK_PAYER.test(first.payerKey);
  const base = {
    id: `${first.bankAccountId}:${first.payerKey}`,
    source: isPaycheck ? "paycheck" : "deposit",
    /* The cleaned payer name, not the raw descriptor: the raw one carries
       reference numbers ("PPD ID: 4471") that change every payday and mean
       nothing to the client. The raw one is kept beside it. */
    name: first.payerKey,
    descriptor: text(last.display),
    payer_key: first.payerKey,
    bank_account_id: first.bankAccountId,
    account_name: account ? account.name : null,
    account_mask: account ? account.mask : null,
    kind: account ? account.kind : "unknown",
    occurrence_count: days.length,
    first_seen_on: formatDay(days[0].day),
    last_seen_on: formatDay(last.day),
    evidence_provider_ids: days.flatMap((d) => d.providerIds)
  };

  if (days.length < 2) {
    return { ...base, cadence: null, typical_cents: days[0].cents, monthly_cents: null, next_expected_on: null, counted: false, reason: NOT_COUNTED.ONE_OFF };
  }
  const dayList = days.map((d) => d.day);
  const fit = chooseIncomeCadence(dayList);
  const typical = medianCents(days.map((d) => d.cents));
  if (!fit) {
    return { ...base, cadence: null, typical_cents: typical, monthly_cents: null, next_expected_on: null, counted: false, reason: NOT_COUNTED.NO_CADENCE };
  }

  const amounts = days.map((d) => d.cents);
  const minC = Math.min(...amounts);
  const maxC = Math.max(...amounts);
  const spread = typical === 0 ? 0 : Math.round((100 * (maxC - minC)) / typical);
  const periodsSinceLast = daysBetween(last.day, today) / fit.cadence.days;
  const pct = scoreConfidence({ occurrenceCount: days.length, fit, relSpreadPct: spread, periodsSinceLast });
  const label = capLabelForEvidence(labelFor(pct), days.length);
  const cadence = fit.cadence.name;
  const anchors = cadence === "weekly" || cadence === "biweekly" ? [] : fit.anchors;

  let next = null;
  let nextReason = null;
  if (days.length < 3) nextReason = REASONS.TWO_OCCURRENCES;
  else if (!PRESENTABLE_LABELS.includes(label)) nextReason = REASONS.LOW_CONFIDENCE;
  else {
    let cand = nextPayday(last.day, cadence, anchors);
    /* Roll forward past today at most ONE period. recurring.mjs allows two for
       a bill, because a bill that keeps charging is the careful assumption.
       For money coming in the careful assumption runs the other way: one
       missed payday is a late bank sync or a holiday, two is a job that ended,
       and a plan must not spend a paycheck that stopped. */
    for (let rolls = 0; cand && dayNumber(cand) <= dayNumber(today) && rolls < INCOME_ROLL_FORWARD; rolls += 1) {
      cand = nextPayday(cand, cadence, anchors);
    }
    if (!cand || dayNumber(cand) <= dayNumber(today)) nextReason = REASONS.STOPPED;
    else next = formatDay(cand);
  }

  const counted = next !== null;
  return {
    ...base,
    cadence,
    anchor_days: anchors,
    typical_cents: typical,
    amount_min_cents: minC,
    amount_max_cents: maxC,
    amount_spread_pct: spread,
    sure_per_month: SURE_PER_MONTH[cadence],
    monthly_cents: counted ? sureMonthlyCents(typical, cadence) : null,
    confidence_pct: pct,
    confidence_label: label,
    next_expected_on: next,
    next_expected_unknown_reason: nextReason,
    counted,
    reason: counted ? null
      : nextReason === REASONS.TWO_OCCURRENCES ? NOT_COUNTED.SEEN_TWICE
        : nextReason === REASONS.STOPPED ? NOT_COUNTED.STOPPED
          : NOT_COUNTED.NOT_STEADY
  };
}

/* ========================================================================== *
 * Into the cash-flow projector
 * ========================================================================== */

/**
 * incomeInflows(income, { from, to, confidenceFloor, accountIds }) → the
 * `expectedInflows` src/banking/cashflow.mjs project() takes.
 *
 * Only counted BANK items (merchant payouts have no payday to put on a
 * calendar). `confirmed` only when the org has set a confidence floor and the
 * item's confidence reaches it — project() counts an unconfirmed inflow in
 * neither track, which is its rule and is kept: a maybe-paycheck must not make
 * the careful track hopeful. `accountIds` limits it to the accounts the
 * projection opened from.
 */
export function incomeInflows(income, { from, to, confidenceFloor, accountIds = null } = {}) {
  if (!income || income.ok !== true) return [];
  const allow = accountIds ? new Set(accountIds.map(String)) : null;
  const floor = typeof confidenceFloor === "number" && Number.isFinite(confidenceFloor) ? confidenceFloor : null;
  const out = [];
  for (const it of Array.isArray(income.items) ? income.items : []) {
    if (it.source === "merchant_payout" || !it.cadence || !Number.isSafeInteger(it.typical_cents) || it.typical_cents <= 0) continue;
    if (allow && !allow.has(String(it.bank_account_id))) continue;
    const dates = incomeOccurrences(it, { from, to });
    if (!dates.length) continue;
    out.push({
      inflowId: it.id,
      label: it.name,
      confirmed: floor !== null && Number.isFinite(it.confidence_pct) && it.confidence_pct / 100 >= floor,
      occurrences: dates.map((date) => ({ date, amountCents: it.typical_cents }))
    });
  }
  return out;
}

/* ========================================================================== *
 * The read
 * ========================================================================== */

const ACCOUNTS_SQL = `
  SELECT a.id::text AS id, a.account_type, a.closed_at, a.entity_kind, a.name, a.official_name, a.mask,
         e.kind AS container_kind
    FROM bank_accounts a
    LEFT JOIN entities e ON e.id = a.entity_id AND e.org_id = a.org_id AND e.archived_at IS NULL
   WHERE a.client_id = $1 AND a.org_id = $2`;

/* Deposits in the window. Dates cast to text: node-postgres turns a `date` into
   local midnight, which moves a day east of UTC (money-overview.mjs). */
const INFLOWS_SQL = `
  SELECT t.id::text AS id, t.bank_account_id::text AS bank_account_id, t.provider_transaction_id,
         t.amount_cents, t.posted_on::text AS posted_on, t.merchant_name, t.category, t.is_pending
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
   WHERE t.org_id = $1 AND a.client_id = $2
     AND t.amount_cents > 0
     AND t.is_pending = false
     AND t.posted_on IS NOT NULL
     AND t.posted_on >= $3::date AND t.posted_on <= $4::date
     AND NOT (t.raw ? 'fundhub_removed_at')
   ORDER BY t.posted_on DESC, t.id ASC
   LIMIT $5`;

/* The withdrawals that could be the other half of a deposit: same cents, any of
   this client's accounts, the window widened by the match distance. */
const MATCH_OUT_SQL = `
  SELECT t.bank_account_id::text AS bank_account_id, t.provider_transaction_id,
         t.amount_cents, t.posted_on::text AS posted_on, t.is_pending
    FROM bank_transactions t
    JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id
   WHERE t.org_id = $1 AND a.client_id = $2
     AND t.amount_cents < 0
     AND -t.amount_cents = ANY($3::bigint[])
     AND t.is_pending = false
     AND t.posted_on IS NOT NULL
     AND t.posted_on >= $4::date AND t.posted_on <= $5::date
     AND NOT (t.raw ? 'fundhub_removed_at')
   LIMIT $6`;

const PAYOUTS_SQL = `
  SELECT c.id::text AS connection_id, c.provider, c.status, e.kind AS entity_kind, e.name AS entity_name,
         me.provider_event_id, me.amount_cents,
         to_char(me.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS occurred_on
    FROM merchant_events me
    JOIN merchant_connections c ON c.id = me.connection_id
    LEFT JOIN entities e ON e.id = c.entity_id AND e.org_id = c.org_id
   WHERE c.org_id = $1 AND c.client_id = $2
     AND me.kind = 'payout' AND me.currency = 'usd'
     AND me.occurred_at >= $3::date`;

function shiftDays(iso, n) {
  const d = parseDay(iso);
  return formatDay(fromDayNumber(dayNumber(d) + n));
}

/**
 * loadIncome(db, { orgId, clientId, asOf }) → detectIncome()'s answer, or
 * { ok: false, reason } when the bank read itself failed. Read-only. Every
 * statement is scoped on org_id and client_id.
 *
 * A missing merchant table (migration 442 not applied) or a failed merchant
 * read is NOT a failed income read: the bank side is still answered and
 * `merchant_unavailable: true` says the processor side was not read.
 */
export async function loadIncome(db, { orgId, clientId, asOf = new Date() } = {}) {
  if (!orgId || !clientId) throw new TypeError("loadIncome: orgId and clientId are required");
  const today = new Date(asOf).toISOString().slice(0, 10);
  const from = shiftDays(today, -WINDOW_DAYS);
  const firstMonth = `${merchantMonths(parseDay(today))[0]}-01`;
  try {
    const [accounts, inflows] = await Promise.all([
      db.query(ACCOUNTS_SQL, [clientId, orgId]),
      db.query(INFLOWS_SQL, [orgId, clientId, from, today, ROW_CAP + 1])
    ]);
    const capped = inflows.rows.length > ROW_CAP;
    const inRows = capped ? inflows.rows.slice(0, ROW_CAP) : inflows.rows;
    const amounts = [...new Set(inRows.map((r) => intCents(r.amount_cents)).filter((c) => c !== null && c > 0))];
    const outRows = amounts.length
      ? (await db.query(MATCH_OUT_SQL, [orgId, clientId, amounts, shiftDays(from, -TRANSFER_MATCH_DAYS), shiftDays(today, TRANSFER_MATCH_DAYS), ROW_CAP])).rows
      : [];
    let payouts = [];
    let merchantUnavailable = false;
    try {
      payouts = (await db.query(PAYOUTS_SQL, [orgId, clientId, firstMonth])).rows;
    } catch {
      merchantUnavailable = true;
    }
    const result = detectIncome([...inRows, ...outRows], { now: today, accounts: accounts.rows, merchantPayouts: payouts });
    return { ...result, window: { from, to: today }, capped, merchant_unavailable: merchantUnavailable };
  } catch (e) {
    return { ok: false, reason: "read_failed", message: e && e.message ? e.message : "The bank history could not be read." };
  }
}

export default detectIncome;
