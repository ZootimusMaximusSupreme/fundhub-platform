// Plan source: card and loan payment due dates (kind "due").
//
// One pin per payment due date inside the window, for every OPEN card and loan
// (bank_accounts, account_type 'credit' or 'loan'). The rows come from the same
// three reads the Overview makes (ACCOUNT_SQL, CYCLE_SQL and LIABILITY_SQL in
// src/finance/money-overview.mjs), so the plan and the Overview never disagree
// about which accounts exist. Closed accounts are left out, as they are there.
//
// WHERE A DATE COMES FROM, best first:
//   1. The exact date a provider reported: card_liabilities.payment_due_date,
//      else the statement-cycle row's raw.next_payment_due_date (Plaid's
//      liabilities read). It is a fact, so it is shown in its month whether or
//      not it has passed.
//   2. The other months: the account's payment_due_day, with the one month-end
//      rule (src/banking/statement-cycles.mjs — the 31st falls on the last day
//      of a short month). money-overview.mjs falls back to the same due day for
//      a card's due_on. These pins say they were worked out from the due day.
//      A worked-out date within EXACT_WINS_DAYS of the reported one is the same
//      payment, so the reported date replaces it (a due date a bank moved off a
//      weekend is still one payment, not two).
//   No reported date and no due day → no pin. A date is never guessed.
//
// AMOUNTS (integer cents; null = not known):
//   * card on its reported date: the minimum due on the current statement.
//   * card on a worked-out date: null — that statement does not exist yet.
//   * loan: the monthly payment on its cycle row, every month. A loan's payment
//     is the same each month (src/banking/card-due-reminders.mjs, loans).
//
// STATUS IS ALWAYS "planned". Nothing in these rows says whether a payment was
// made or missed, and this file never claims either — the same promise the card
// reminders make ("We never claim the card was paid, either way"). The screen
// words a planned date that has passed as "not recorded".
//
// LEFT OUT, ON PURPOSE: a card whose current statement says nothing is due
// (minimum 0, or a statement balance of 0 or less) gets no pin on that date; a
// loan whose known balance is 0 or less is paid off and gets no pins at all.

import { ACCOUNT_SQL, CYCLE_SQL, LIABILITY_SQL } from "../money-overview.mjs";
import {
  parseIsoDate, formatIsoDate, clampDayToMonth, daysBetween
} from "../../banking/statement-cycles.mjs";
import { cardLabel, loanLabel } from "../../banking/card-due-reminders.mjs";

export const name = "dues";

/** A worked-out date this close to the reported one is the same payment. */
export const EXACT_WINS_DAYS = 10;

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v));

/* pg hands back bigint as a string. Anything not a finite number is unknown. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* 'YYYY-MM-DD' (or the date part of a longer ISO string) → that date, else null. */
function isoDay(v) {
  const s = text(v);
  if (s === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m && parseIsoDate(m[1]) ? m[1] : null;
}

function dueDayOf(cycle) {
  const n = cycle ? Number(cycle.payment_due_day) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 31 ? n : null;
}

/** "1st", "2nd", "3rd", "11th", "22nd", "31st". */
export function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th"}`;
}

/** Every 'YYYY-MM' the window touches, oldest first. */
export function monthsBetween(from, to) {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  if (!a || !b) return [];
  const out = [];
  for (let y = a.year, m = a.month, guard = 0; (y < b.year || (y === b.year && m <= b.month)) && guard < 600; guard++) {
    out.push({ year: y, month: m });
    m += 1;
    if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

/**
 * buildDuePins — stored rows → pins. Pure: no database, no clock.
 *
 * @param {object} input
 * @param {Array} input.accounts     ACCOUNT_SQL rows
 * @param {Array} input.cycles       CYCLE_SQL rows (the jsonb `row`, unwrapped)
 * @param {Array} input.liabilities  LIABILITY_SQL rows, newest first
 * @param {string} input.from        'YYYY-MM-DD', inclusive
 * @param {string} input.to          'YYYY-MM-DD', inclusive
 */
export function buildDuePins({ accounts = [], cycles = [], liabilities = [], from, to } = {}) {
  if (!parseIsoDate(from) || !parseIsoDate(to)) return [];

  const cycleBy = new Map();
  for (const c of Array.isArray(cycles) ? cycles : []) {
    if (c && c.bank_account_id) cycleBy.set(String(c.bank_account_id), c);
  }
  const liabBy = new Map();
  for (const l of Array.isArray(liabilities) ? liabilities : []) {
    const k = l && l.bank_account_id ? String(l.bank_account_id) : null;
    if (k && !liabBy.has(k)) liabBy.set(k, l); // newest first on the way in
  }

  const out = [];
  const open = (Array.isArray(accounts) ? accounts : []).filter((a) =>
    a && a.id && !a.closed_at && (a.account_type === "credit" || a.account_type === "loan"));

  for (const a of open) {
    const id = String(a.id);
    const isLoan = a.account_type === "loan";
    const cycle = cycleBy.get(id) ?? null;
    const liab = isLoan ? null : liabBy.get(id) ?? null;
    const raw = cycle?.raw && typeof cycle.raw === "object" ? cycle.raw : {};

    if (isLoan) {
      const balance = cents(a.current_balance_cents);
      if (balance !== null && balance <= 0) continue; // paid off
    }

    const reported = isoDay(liab?.payment_due_date) ?? isoDay(raw.next_payment_due_date);
    const dueDay = dueDayOf(cycle);
    if (!reported && !dueDay) continue;

    const label = isLoan ? loanLabel(a) : cardLabel(a);
    const monthly = cents(cycle?.minimum_payment_cents);
    const cardMin = cents(liab?.minimum_payment_cents) ?? monthly;
    const statement = cents(liab?.last_statement_balance_cents) ?? cents(cycle?.last_statement_balance_cents);
    const nothingDue = !isLoan && (cardMin === 0 || (statement !== null && statement <= 0));

    const dates = [];
    if (reported && !nothingDue) dates.push({ date: reported, basis: "reported" });
    if (dueDay) {
      for (const { year, month } of monthsBetween(from, to)) {
        const date = formatIsoDate({ year, month, day: clampDayToMonth(year, month, dueDay) });
        if (reported && Math.abs(daysBetween(reported, date)) <= EXACT_WINS_DAYS) continue;
        dates.push({ date, basis: "due_day" });
      }
    }

    for (const { date, basis } of dates) {
      if (date < from || date > to) continue;
      const amount = isLoan ? monthly : basis === "reported" ? cardMin : null;
      let detail;
      if (basis === "reported") {
        detail = isLoan ? "The due date your lender reported." : "The due date on your latest statement.";
      } else {
        detail = `Worked out from the due day on file (the ${ordinal(dueDay)}).` +
          (isLoan ? "" : " The amount shows once that statement is out.");
      }
      out.push({
        id: `due:${id}:${date}`,
        date,
        kind: "due",
        title: `Pay ${label}`,
        detail,
        amount_cents: amount,
        bank: text(a.institution_name),
        container_id: a.entity_id ? String(a.entity_id) : null,
        status: "planned",
        source: name,
        can_mark: []
      });
    }
  }
  return out;
}

export async function pins(db, { orgId, clientId, from, to } = {}) {
  const [accounts, cycles, liabilities] = await Promise.all([
    db.query(ACCOUNT_SQL, [clientId, orgId]),
    db.query(CYCLE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId])
  ]);
  return buildDuePins({
    accounts: accounts.rows || [],
    cycles: (cycles.rows || []).map((r) => r.row ?? r),
    liabilities: (liabilities.rows || []).map((r) => r.row ?? r),
    from,
    to
  });
}
