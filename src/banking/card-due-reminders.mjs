// Card due reminders — the pure half. Decides, for one card's statement cycle,
// whether a payment reminder is owed today and what it says. No database, no
// clock, no send. src/workflows/finance-os-card-due-reminders.mjs does the rest.
//
// IT NEVER MOVES MONEY. It reads a due date and writes a sentence.
//
// THE WINDOW. A card is reminded when its payment is due in 0 to 3 days and no
// payment is on file since the last statement. ONE REMINDER PER CARD PER DUE
// DATE: the reminder row and the queued text are both keyed on the card and the
// due date, so the first daily pass inside the window writes it and every later
// pass finds it already there. A card first seen on its due day (a late link, a
// late sync) still gets its one reminder, worded "due today".
//
// THE DUE DATE IS PLAID'S. `raw.next_payment_due_date` is the exact date Plaid
// gave on the last read (src/banking/plaid-liabilities.mjs). It is not
// re-derived from the day of month: that would roll a passed date forward to
// next month and announce a due date nobody reported.
//
// "NO PAYMENT ON FILE" IS NARROW ON PURPOSE. Plaid's last_payment_date on or
// after the last statement date means a payment was made this cycle, and no
// reminder is sent. Anything less certain (no payment date, no statement date)
// still reminds — a reminder the client did not need costs one text; a missed
// one can cost a late fee. We never claim the card was paid, either way.

import { fromCents } from "../commissions/money.mjs";
import { daysBetween, parseIsoDate, formatIsoDate } from "./statement-cycles.mjs";

export const REMIND_DAYS_BEFORE = 3;
export const TEMPLATE_KEY = "SMS-FINANCE-OS-CARD-DUE";
/** 16:00 UTC is 9am in Arizona — the time of day the reminder row says it is for. */
const SURFACE_HOUR_UTC = 16;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-21" → "Oct 21". */
export function shortDate(iso) {
  const d = parseIsoDate(iso);
  return d ? `${MONTHS[d.month - 1]} ${d.day}` : null;
}

/** 135000 → "$1,350.00". Integer-safe: no float division. */
export function dollars(centsValue) {
  const s = fromCents(centsValue);
  const neg = s.startsWith("-");
  const [whole, frac] = (neg ? s.slice(1) : s).split(".");
  return `${neg ? "-" : ""}$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac}`;
}

function addDays(iso, n) {
  const d = parseIsoDate(iso);
  if (!d) return null;
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + n));
  return formatIsoDate({ year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() });
}

/** What the card is called in a text. The card's own name; its last four when
 *  it has no name. Never a guessed lender. */
export function cardLabel(row) {
  const name = typeof row?.name === "string" ? row.name.trim() : "";
  if (name) return name;
  if (row?.mask) return `card ending ${row.mask}`;
  return "credit card";
}

const toInt = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/**
 * planCardDue(row, { today }) → { remind, reason, ... }
 *
 * `row` is one account_statement_cycles row joined to its bank_accounts name and
 * mask (columns: bank_account_id, minimum_payment_cents,
 * last_statement_balance_cents, last_statement_date, raw, name, mask).
 * `today` is an ISO date — the caller's clock.
 */
export function planCardDue(row, { today } = {}) {
  const skip = (reason, extra = {}) => ({ remind: false, reason, ...extra });
  if (!parseIsoDate(today)) return skip("bad_today");

  const raw = row?.raw && typeof row.raw === "object" ? row.raw : {};
  const dueOn = parseIsoDate(raw.next_payment_due_date) ? raw.next_payment_due_date : null;
  if (!dueOn) return skip("no_due_date");

  const daysAway = daysBetween(today, dueOn);
  if (daysAway < 0) return skip("due_date_passed", { dueOn, daysAway });
  if (daysAway > REMIND_DAYS_BEFORE) return skip("not_yet", { dueOn, daysAway });

  const minCents = toInt(row.minimum_payment_cents);
  const stmtCents = toInt(row.last_statement_balance_cents);
  if (minCents === 0) return skip("nothing_due", { dueOn, daysAway });
  if (stmtCents !== null && stmtCents <= 0) return skip("nothing_due", { dueOn, daysAway });

  /* Plaid's own string first: node-postgres turns a `date` column into a local
     midnight Date, which can read a day early on a machine east of UTC. */
  const plaidStmt = raw.plaid && parseIsoDate(raw.plaid.last_statement_issue_date)
    ? raw.plaid.last_statement_issue_date : null;
  const stmtDate = plaidStmt || (row.last_statement_date instanceof Date
    ? row.last_statement_date.toISOString().slice(0, 10)
    : (typeof row.last_statement_date === "string" ? row.last_statement_date.slice(0, 10) : null));
  const paidOn = parseIsoDate(raw.last_payment_date) ? raw.last_payment_date : null;
  if (paidOn && stmtDate && daysBetween(stmtDate, paidOn) >= 0) {
    return skip("payment_recorded", { dueOn, daysAway });
  }

  const label = cardLabel(row);
  const dueText = shortDate(dueOn);
  const card = {
    name: label,
    amount_phrase: minCents !== null ? ` of ${dollars(minCents)}` : "",
    due_phrase: daysAway === 0 ? `today, ${dueText}` : dueText
  };
  return {
    remind: true,
    reason: null,
    dueOn,
    daysAway,
    amountCents: minCents,
    label,
    card,
    /* The sentence the reminder row stores — the SMS body minus the opt-out
       line, which the template adds. */
    body: `Fundhub reminder: your ${card.name} payment${card.amount_phrase} is due ${card.due_phrase}.`,
    /* FIXED PER DUE DATE, not per run. cashflow_reminders dedupes on
       (subject, kind, surface_at), so a fixed instant is what makes the second,
       third and fourth daily pass collapse into the first row. */
    surfaceAt: `${addDays(dueOn, -REMIND_DAYS_BEFORE)}T${String(SURFACE_HOUR_UTC).padStart(2, "0")}:00:00.000Z`,
    /* sendTemplated's provider_ref is `workflow:<template>:<eventId>`, unique
       per org — the second guard on one text per card per due date. */
    eventId: `card-due:${row.bank_account_id}:${dueOn}`
  };
}

export default { planCardDue, cardLabel, shortDate, dollars, TEMPLATE_KEY, REMIND_DAYS_BEFORE };
