// Recurring-bill detection — what does this client actually pay out, every
// month, whether or not they remember it.
//
// *** EVERY FUNCTION IN THIS FILE IS PURE. ***
// No database handle, no fetch, no provider, no clock, no randomness, no
// mutation of its inputs. Rows in, answer out. The same rows and the same `now`
// produce the same answer on any machine on any day, forever — which is the
// only reason any of this can be tested or audited at all.
//
// It does not import anything from the Plaid-link, card-liability or
// projection threads. It takes account ids and transaction rows as PARAMETERS.
//
//
// ===========================================================================
// 1. THE SIGN CONVENTION. STATED ONCE, HERE, AND ENFORCED BELOW.
// ===========================================================================
//
//   *** NEGATIVE amount_cents = MONEY LEFT THE ACCOUNT (outflow / a bill).
//   *** POSITIVE amount_cents = MONEY ENTERED THE ACCOUNT (inflow / income).
//
// db/migrations/085_bank_transactions.sql section 1 is the authority and says
// the same thing; db/migrations/086_recurring_bills.sql enforces it in the
// database with `CHECK (typical_amount_cents < 0)`.
//
// *** PLAID'S LEGACY /transactions/get CONVENTION IS THE OPPOSITE *** — it
// reports a purchase as a POSITIVE number. Ingest must negate at that boundary.
// This module does NOT try to be clever about it. It does not take absolute
// values and it does not guess which way round a batch is: a positive row is
// an inflow, full stop, and it is EXCLUDED from bill detection with the named
// reason `inflow_not_an_outflow`.
//
// That refusal is the enforcement. Getting the sign backwards is the most
// expensive available mistake here because it does not fail — it silently
// inverts every downstream cash-flow number and turns a client's salary into
// their largest monthly bill. If a whole batch arrives un-negated, this module
// returns zero bills and an `excluded` list that says `inflow_not_an_outflow`
// for every row, which is a loud, specific, immediately diagnosable answer.
// Taking abs() would instead have produced a confident, plausible, completely
// wrong set of bills. That is the difference this rule buys.
//
//
// ===========================================================================
// 2. CONFIDENCE IS THE PRODUCT. THE BILL IS JUST WHAT IT IS ATTACHED TO.
// ===========================================================================
//
// A recurring bill is an INFERENCE, not a fact anybody reported. Nobody told us
// the client pays $54.99 every month; we noticed some similar charges and
// guessed. So the guess has to arrive carrying how good it is, and the API is
// shaped so that a low-confidence guess CANNOT be mistaken for a bill:
//
//   result.bills      — medium/high confidence. Safe to show a person as a bill.
//   result.candidates — low confidence. *** THESE ARE NOT BILLS. *** They are
//                       returned so nothing is silently dropped, and they are in
//                       a separate array so that showing one requires asking for
//                       it by name. A caller cannot iterate `bills` and
//                       accidentally render a guess.
//   result.rejected   — groups with no usable cadence at all, each with a reason.
//   result.excluded   — individual rows that could not be used, each with a
//                       reason and its provider id.
//
// *** TWO OCCURRENCES ARE NOT A PATTERN. *** Two charges thirty days apart are
// also just two charges that happened to be thirty days apart. There is no
// third point to confirm anything, so there is no cadence — there is one
// interval, and one interval is a line through two points, which always fits.
// A two-occurrence detection is therefore CAPPED at the 'low' label whatever
// the arithmetic looks like (see capLabelForEvidence), so it can never appear
// in `bills`, and it never gets a next expected date.
//
//
// ===========================================================================
// 3. A DATE WE DO NOT BELIEVE IS WORSE THAN NO DATE.
// ===========================================================================
//
// When the detector is not confident, `nextExpectedDate` is null AND
// `nextExpectedUnknownReason` is a stable snake_case string saying why. Never a
// plausible date. CLAUDE.md: "Never invent. If information is missing, that
// absence is the finding."
//
// 086 makes this structural rather than a convention: exactly one of
// next_expected_on / next_expected_unknown_reason is non-null, by CHECK. A row
// physically cannot say "I don't know" without saying why, and cannot carry a
// date it does not believe.
//
// The reasons, all of them:
//   two_occurrences_is_a_guess_not_a_cadence
//   confidence_too_low_to_predict_a_date
//   no_occurrence_in_recent_periods_bill_may_have_ended
//
//
// ===========================================================================
// 4. `now` IS A PARAMETER. THERE IS NO CLOCK IN THIS FILE.
// ===========================================================================
//
// grep this file for Date.now, new Date() with no argument, or performance.now
// and you will find none. `now` is REQUIRED and detectRecurringBills throws
// without it rather than defaulting — a default clock is the same bug as a
// hidden one, arriving quietly.
//
// It is load-bearing, not decoration. It decides two things:
//   - ROLL-FORWARD: if last-seen + one period is already in the past, the
//     prediction rolls forward; if it has to roll more than MAX_ROLL_FORWARD
//     periods to get past `now`, the bill has probably ENDED and the answer is
//     null-with-a-reason instead of a date.
//   - STALENESS: a bill whose last charge is more than STALE_PERIODS periods
//     old loses confidence, because the strongest evidence that somebody still
//     pays a bill is that they paid it recently.
//
// A function whose answer depends on when it ran cannot be tested or audited.
// Every test in recurring.test.mjs pins `now` and asserts an exact date.
//
//
// ===========================================================================
// 5. WHAT IS DELIBERATELY EXCLUDED FROM DETECTION, AND WHY.
// ===========================================================================
//
//   PENDING ROWS (`pending_transaction`). A pending authorisation can change
//   amount, change date, or vanish when the merchant releases the hold. If it
//   later posts, the same purchase would appear twice and manufacture a cadence
//   out of one charge — the double-count failure AUDIT-FINDINGS records for the
//   Commas webhook, arrived at from the other direction.
//
//   DUPLICATE PROVIDER IDS (`duplicate_provider_transaction_id`). The database
//   has uq_bank_transactions_account_provider, but this module takes ROWS, not
//   a table, and a caller can hand it the same transaction twice — from two
//   overlapping sync windows, or a naive concatenation. Deduping here means the
//   detector's honesty does not depend on where the caller got the rows.
//   067's rule: you can only dedupe what you can identify. Rows with no
//   provider id are excluded rather than assumed distinct.
//
//   ROWS WITH NO USABLE DATE (`no_posted_date`). posted_on is the settlement
//   date and it is the ONLY date this module uses. authorized_on is NOT
//   silently substituted: the two differ by one to three days routinely, and a
//   cadence computed off a mixture of them wobbles by exactly that much, which
//   is enough to turn a clean monthly bill into an irregular one.
//
//   ROWS WITH NO MERCHANT NAME (`no_merchant_name`). The merchant is the
//   grouping key. With no name there is nothing to group by, and inventing a
//   bucket for them would group a client's unrelated charges into a fictional
//   recurring bill.
//
// Nothing is dropped silently. Every excluded row appears in `result.excluded`
// with its index, its provider id and a reason.
//
//
// ===========================================================================
// 6. is_business IS NOT INFERRED. EVER.
// ===========================================================================
//
// Nothing in a transaction says whether a charge is business or personal. The
// provider does not know. A merchant name does not say. A category like
// "Utilities" is true of both. It is a property of the ACCOUNT or of a human's
// judgement, and this module does not own the account model.
//
// So `isBusiness` is three-valued and defaults to null = UNKNOWN, never false.
// It is set only from the OPTIONAL `accountIsBusiness` map the caller passes —
// an account-level fact the caller already holds. With no entry for an account,
// the answer is null and `isBusinessUnknownReason` says why. Guessing it from a
// keyword list would be inventing a finance fact about a client's taxes inside
// a regulated consumer-finance product.
//
//
// ===========================================================================
// 7. MONEY IS INTEGER CENTS AND THIS FILE DOES NO FLOAT ARITHMETIC ON IT.
// ===========================================================================
//
// Amounts arrive as integers, are compared as integers, and the only averaging
// that happens (the median of an even-sized set) goes through
// roundHalfUp() from src/commissions/money.mjs. A row whose amount is not an
// integer is EXCLUDED (`amount_not_integer_cents`) rather than coerced —
// coercing would silently accept dollars where cents were meant and understate
// every bill by a factor of a hundred.
//
// Floats appear in exactly one place: the day-length of a cadence
// (30.4375 days for a month), used to CLASSIFY intervals. No money touches it,
// and the predicted DATE is computed with calendar-month arithmetic, not by
// adding 30.4375 days to anything.
//
//
// ===========================================================================
// 8. KNOWN LIMITATIONS. REPORTED, NOT HIDDEN.
// ===========================================================================
//
// These are gaps, not bugs — the module behaves as described, and what it does
// not do is written down here rather than discovered later. Also recorded on
// the shared board at ops/workflows/finance-os-banking.md under "## W7".
//
//   ONE MERCHANT KEY YIELDS AT MOST ONE CADENCE. Grouping is by
//   (account, merchant_key), so a merchant that genuinely bills monthly AND
//   annually under a BYTE-IDENTICAL descriptor is reported as a single bill,
//   and the weaker of the two patterns is absorbed as fit error and missed
//   periods. In practice providers send distinguishable descriptors for a
//   monthly plan and an annual renewal, and those detect as two bills — which
//   is why 086 keys on cadence as well as merchant. Splitting one descriptor
//   into two cadences needs real data to justify the extra failure mode
//   (a split invents a bill that does not exist), so it is not guessed at here.
//
//   QUARTERLY, SEMI-ANNUAL AND FOUR-WEEKLY ARE NOT IN THE VOCABULARY. A
//   quarterly charge produces ~91-day gaps, which monthly explains as
//   monthly-with-two-missed. That reads as a real monthly bill with a poor
//   payment record and scores lower than it should. Adding cadences is cheap;
//   adding them without data on how often they occur means widening the
//   tolerance bands and merging real distinctions, so it waits for evidence.
//
//   AMOUNT IS NOT USED TO SPLIT A GROUP. Two unrelated charges at the same
//   merchant — a $12 subscription and a $400 one-off — sit in one group, and
//   the one-off shows up as amount spread and costs confidence. It does not
//   fabricate a bill; it makes a real one look worse, which is the safe
//   direction to be wrong in.

import { roundHalfUp } from "../commissions/money.mjs";

/* ========================================================================== *
 * The sign convention, as a value a caller can assert against.
 * ========================================================================== */

/**
 * The one true sign rule for this thread. Exported so a test — and a future
 * ingest module — can assert against it instead of restating it and drifting.
 */
export const SIGN_CONVENTION = Object.freeze({
  outflow: "negative",
  inflow: "positive",
  description:
    "NEGATIVE amount_cents = money left the account (outflow, a bill). " +
    "POSITIVE = money entered the account (inflow). Plaid's legacy convention " +
    "is the opposite; ingest must negate at the boundary."
});

/** Is this amount an outflow under the convention above? Integer cents. */
export function isOutflow(amountCents) {
  return Number.isInteger(amountCents) && amountCents < 0;
}

/** Is this amount an inflow under the convention above? Integer cents. */
export function isInflow(amountCents) {
  return Number.isInteger(amountCents) && amountCents > 0;
}

/* ========================================================================== *
 * Cadences
 * ========================================================================== */

/**
 * The four cadences this detector will name, and nothing else.
 *
 * Matches the CHECK in 086_recurring_bills.sql verbatim:
 *   CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'annual'))
 * Duplicated here so a bad cadence is impossible to construct rather than
 * coming back as a raw SQLSTATE 23514 naming a constraint — the same thing
 * RESPONSE_CHANNELS does in src/mail/responses.mjs.
 *
 * `days` CLASSIFIES an observed interval. It is never used to compute a
 * predicted date — see advance() for why.
 *
 * `toleranceDays` is how far a single interval may sit from the ideal and still
 * count as that cadence. They are not arbitrary:
 *   weekly   ±2  — a bill due Saturday posts Monday.
 *   biweekly ±3  — same, doubled, and wide enough for a payroll-aligned charge.
 *   monthly  ±4  — covers the real 28..31 day months plus a weekend slip.
 *   annual   ±20 — a renewal date that moves by a couple of weeks is still
 *                  annual, and nothing else in this list is within 20 days of
 *                  365, so the width costs no precision.
 */
export const CADENCES = Object.freeze({
  weekly: Object.freeze({ name: "weekly", days: 7, toleranceDays: 2, months: 0, stepDays: 7 }),
  biweekly: Object.freeze({ name: "biweekly", days: 14, toleranceDays: 3, months: 0, stepDays: 14 }),
  monthly: Object.freeze({ name: "monthly", days: 30.4375, toleranceDays: 4, months: 1, stepDays: 0 }),
  annual: Object.freeze({ name: "annual", days: 365.25, toleranceDays: 20, months: 12, stepDays: 0 })
});

/** Evaluation order is fixed so the answer is deterministic on ties. */
const CADENCE_ORDER = Object.freeze(["weekly", "biweekly", "monthly", "annual"]);

export const CADENCE_NAMES = Object.freeze([...CADENCE_ORDER]);

/* ========================================================================== *
 * Policy constants — every threshold in one place, each with its reason.
 * ========================================================================== */

/** Below this, there is no interval at all and nothing to detect. */
const MIN_OCCURRENCES = 2;

/**
 * Below this, a cadence is a guess about a guess. Two points always fit a line;
 * three is the first number at which the fit could have failed and didn't.
 * A group with fewer than this NEVER gets a predicted date and never leaves the
 * 'low' band.
 */
const MIN_OCCURRENCES_FOR_A_DATE = 3;

/** A cadence must explain at least this share of the observed intervals. */
const MIN_FIT_RATIO = 0.6;

/**
 * How many periods a prediction may roll past `now` before we conclude the bill
 * stopped rather than that we are early. Two is deliberate: one missed period
 * is a late payment, three is a cancelled subscription, and two is where the
 * honest answer flips from "due soon" to "we do not know".
 */
const MAX_ROLL_FORWARD = 2;

/** Last charge older than this many periods costs confidence. */
const STALE_PERIODS = 2;

/** Confidence bands. The number is what is stored; the label is what is read. */
const LABEL_THRESHOLDS = Object.freeze([
  { label: "high", min: 75 },
  { label: "medium", min: 55 },
  { label: "low", min: 30 },
  { label: "none", min: 0 }
]);

/** Labels safe to present to a person as a bill. */
export const PRESENTABLE_LABELS = Object.freeze(["medium", "high"]);

/**
 * Nothing inferred from a transaction history is certain, so the score can
 * never reach 100. A ceiling below the top of the range is a standing reminder
 * of that in every row the detector writes.
 *
 * DEFENCE IN DEPTH, AND HONEST ABOUT IT: the highest base is 88 and every other
 * term is a penalty, so today NO INPUT CAN REACH THIS CLAMP. It is here so that
 * raising a base score later cannot quietly produce a "100% certain" bill.
 * Because no fixture can exercise it, it is asserted directly in
 * recurring.test.mjs instead — a guard with no test is a guard that gets
 * deleted, which is the failure mode AUDIT-FINDINGS closes on.
 */
export const MAX_CONFIDENCE = 95;

/** Stable reason strings. A caller branches on these; they are not prose. */
export const REASONS = Object.freeze({
  TWO_OCCURRENCES: "two_occurrences_is_a_guess_not_a_cadence",
  LOW_CONFIDENCE: "confidence_too_low_to_predict_a_date",
  STOPPED: "no_occurrence_in_recent_periods_bill_may_have_ended",
  NO_ACCOUNT_BUSINESS_FLAG: "no_account_level_business_flag_supplied",
  SINGLE_OCCURRENCE: "single_occurrence_is_not_recurring",
  NO_CADENCE: "no_repeating_cadence_found"
});

/** Stable reasons a single input row was not usable. */
export const EXCLUSION_REASONS = Object.freeze({
  NOT_AN_OBJECT: "not_an_object",
  NO_ACCOUNT: "missing_bank_account_id",
  NO_PROVIDER_ID: "missing_provider_transaction_id",
  DUPLICATE: "duplicate_provider_transaction_id",
  PENDING: "pending_transaction",
  NOT_INTEGER_CENTS: "amount_not_integer_cents",
  ZERO: "zero_amount",
  INFLOW: "inflow_not_an_outflow",
  NO_DATE: "no_posted_date",
  BAD_DATE: "unparseable_posted_date",
  NO_MERCHANT: "no_merchant_name"
});

/* ========================================================================== *
 * Calendar arithmetic
 *
 * A bill lands on a DAY, not at an instant, so everything here works in whole
 * calendar days. Nothing in this section constructs a Date from the system
 * clock.
 * ========================================================================== */

const MS_PER_DAY = 86_400_000;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Anything date-shaped -> { y, m, d }, or null.
 *
 * Accepts:
 *   - 'YYYY-MM-DD' and any string starting with it (an ISO timestamp's date
 *     part is taken literally, which for a 'Z' timestamp is its UTC date).
 *   - a Date, read through its LOCAL calendar parts, because that is how
 *     node-postgres decodes a `date` column: pg-types builds
 *     `new Date(year, month - 1, day)` — local midnight. Reading UTC parts off
 *     that would shift the day backwards west of Greenwich and silently move
 *     every bill by one day. recurring.pg.test.mjs proves the round-trip
 *     against a real `date` column rather than trusting this comment.
 *
 * Rejects a syntactically valid but impossible date (2026-02-30), because a
 * date nobody could have been billed on is a parse failure, not a date.
 */
export function parseDay(value) {
  if (value === null || value === undefined) return null;

  let y;
  let m;
  let d;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    y = value.getFullYear();
    m = value.getMonth() + 1;
    d = value.getDate();
  } else if (typeof value === "string") {
    const match = DAY_RE.exec(value.trim());
    if (!match) return null;
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    return null;
  }

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (y < 1900 || y > 2200) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

/** { y, m, d } -> 'YYYY-MM-DD'. The wire and storage form. */
export function formatDay(day) {
  return `${String(day.y).padStart(4, "0")}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`;
}

/** { y, m, d } -> whole days since the epoch. Ordering and differencing only.
 *  Exported for src/banking/income.mjs, which reads deposits on the same calendar. */
export function dayNumber(day) {
  return Math.round(Date.UTC(day.y, day.m - 1, day.d) / MS_PER_DAY);
}

/** Whole days since the epoch -> { y, m, d }. */
export function fromDayNumber(n) {
  const dt = new Date(n * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** Whole days from `a` to `b`. Negative if b precedes a. */
export function daysBetween(a, b) {
  return dayNumber(b) - dayNumber(a);
}

/**
 * Move a day forward by `k` periods of `cadence`.
 *
 * MONTHLY AND ANNUAL USE CALENDAR ARITHMETIC, NOT 30.4375 DAYS. A bill due on
 * the 15th is due on the 15th; adding an average month-length would drift it a
 * day every few months and the prediction would slowly stop matching the bill.
 *
 * `anchorDom` is the day-of-month the bill is actually billed on — the LARGEST
 * day-of-month observed, not the last one. This matters at month ends: a bill
 * due on the 31st posts on the 28th in February, and anchoring on that last
 * occurrence would pin the bill to the 28th forever afterwards. Anchoring on
 * the largest observed day recovers the 31st, clamped down only for months that
 * are genuinely shorter.
 */
export function advance(day, cadence, k, anchorDom) {
  if (cadence.months === 0) {
    return fromDayNumber(dayNumber(day) + cadence.stepDays * k);
  }
  const total = (day.y * 12 + (day.m - 1)) + cadence.months * k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const dom = Math.min(anchorDom ?? day.d, daysInMonth(y, m));
  return { y, m, d: dom };
}

/* ========================================================================== *
 * Merchant normalisation
 * ========================================================================== */

/**
 * Noise tokens that appear in provider descriptors and identify nothing about
 * the merchant. Removed as WHOLE WORDS only, so "POSTMATES" survives "POS".
 */
const NOISE_TOKENS = new Set([
  "POS", "PURCHASE", "PAYMENT", "PMT", "DEBIT", "CREDIT", "CARD", "VISA",
  "MASTERCARD", "ACH", "EFT", "TRANSFER", "XFER", "RECURRING", "AUTOPAY",
  "AUTO", "PAY", "ONLINE", "WEB", "ID", "REF", "TRANSACTION", "TXN",
  "WITHDRAWAL", "CHECKCARD", "PPD", "DES", "INDN"
]);

/**
 * A raw provider descriptor -> the stable grouping key for a merchant.
 *
 * WHY THIS EXISTS AT ALL. Providers append store numbers, terminal ids, dates
 * and reference numbers that change on every single charge:
 *
 *   "SQ *BLUE BOTTLE 4471 OAKLAND CA"  -> BLUE BOTTLE OAKLAND CA
 *   "SQ *BLUE BOTTLE 8813 OAKLAND CA"  -> BLUE BOTTLE OAKLAND CA
 *   "ACH DEBIT PG&E 0603 REF#99182"    -> PG E
 *
 * Grouping on the raw string would put every charge in its own group and the
 * detector would find nothing, ever. That failure is silent and looks exactly
 * like "this client has no recurring bills", which is why the normaliser is
 * pure, exported and unit-tested rather than being three inline .replace()
 * calls at a call site.
 *
 * WHY IT IS CONSERVATIVE. Over-normalising MERGES distinct merchants, and a
 * merged group produces a confident bill for something nobody pays. Under-
 * normalising splits one merchant, which produces no bill — a visible absence.
 * A miss is recoverable; a fabrication is not. So this strips only what is
 * demonstrably an identifier and leaves everything else alone.
 *
 * Returns "" for anything with no usable name; the caller excludes those.
 */
export function normaliseMerchant(raw) {
  if (typeof raw !== "string") return "";

  let s = raw.toUpperCase();

  // Card-network and aggregator prefixes: "SQ *", "TST*", "PAYPAL *", "SP ".
  s = s.replace(/\b(SQ|TST|SP|PY|PAYPAL|IC|WL|EB|CKE)\s*\*/g, " ");
  s = s.replace(/\*/g, " ");

  // Anything that is not a letter, a digit or a space is a separator.
  s = s.replace(/[^A-Z0-9 ]+/g, " ");

  const kept = [];
  for (const token of s.split(/\s+/)) {
    if (!token) continue;
    // Pure digits are store / terminal / reference numbers. Never a merchant.
    if (/^\d+$/.test(token)) continue;
    // Masked card fragments: XXXX1234, X1234, ****5678 (already de-starred).
    if (/^X+\d*$/.test(token)) continue;
    // Mixed alphanumeric ids of any length are references, not names.
    if (/^(?=.*\d)(?=.*[A-Z])[A-Z0-9]+$/.test(token) && token.length >= 5) continue;
    if (NOISE_TOKENS.has(token)) continue;
    kept.push(token);
  }

  // If stripping removed everything, the raw string was entirely identifiers.
  // Fall back to the letters-only form rather than returning nothing, so a
  // merchant named only with a noise word ("TRANSFER") still groups.
  if (kept.length === 0) {
    const lettersOnly = s.replace(/[^A-Z ]+/g, " ").split(/\s+/).filter(Boolean);
    return lettersOnly.join(" ").trim();
  }
  return kept.join(" ").trim();
}

/* ========================================================================== *
 * Row reading
 * ========================================================================== */

/** snake_case (what pg returns) or camelCase (what a JS caller writes). */
function pick(row, ...names) {
  for (const n of names) {
    if (row[n] !== undefined) return row[n];
  }
  return undefined;
}

/**
 * One input row -> a usable occurrence, or an exclusion with a reason.
 * Never throws on bad input: a caller handing this module rubbish gets a named
 * exclusion, not a stack trace, because the rubbish is the finding.
 */
function readRow(row, index) {
  const bad = (reason, providerTransactionId = null) => ({
    ok: false,
    excluded: { index, reason, providerTransactionId }
  });

  if (row === null || typeof row !== "object" || Array.isArray(row)) {
    return bad(EXCLUSION_REASONS.NOT_AN_OBJECT);
  }

  const providerRaw = pick(row, "provider_transaction_id", "providerTransactionId");
  const providerTransactionId =
    typeof providerRaw === "string" && providerRaw.trim() !== "" ? providerRaw.trim() : null;
  if (!providerTransactionId) return bad(EXCLUSION_REASONS.NO_PROVIDER_ID);

  const accountRaw = pick(row, "bank_account_id", "bankAccountId");
  const bankAccountId =
    typeof accountRaw === "string" && accountRaw.trim() !== "" ? accountRaw.trim() : null;
  if (!bankAccountId) return bad(EXCLUSION_REASONS.NO_ACCOUNT, providerTransactionId);

  const pending = pick(row, "is_pending", "isPending");
  if (pending === true) return bad(EXCLUSION_REASONS.PENDING, providerTransactionId);

  const amountRaw = pick(row, "amount_cents", "amountCents");
  // pg returns bigint as a string. A numeric string of an integer is fine; a
  // decimal one is not, because it means somebody stored dollars in a cents
  // column and coercing it would understate the bill a hundredfold.
  const amountCents =
    typeof amountRaw === "string" && /^-?\d+$/.test(amountRaw.trim())
      ? Number(amountRaw.trim())
      : amountRaw;
  if (!Number.isInteger(amountCents)) {
    return bad(EXCLUSION_REASONS.NOT_INTEGER_CENTS, providerTransactionId);
  }
  if (amountCents === 0) return bad(EXCLUSION_REASONS.ZERO, providerTransactionId);
  if (amountCents > 0) return bad(EXCLUSION_REASONS.INFLOW, providerTransactionId);

  const postedRaw = pick(row, "posted_on", "postedOn");
  if (postedRaw === null || postedRaw === undefined || postedRaw === "") {
    return bad(EXCLUSION_REASONS.NO_DATE, providerTransactionId);
  }
  const postedOn = parseDay(postedRaw);
  if (!postedOn) return bad(EXCLUSION_REASONS.BAD_DATE, providerTransactionId);

  const merchantRaw = pick(row, "merchant_name", "merchantName");
  const merchantKey = normaliseMerchant(merchantRaw);
  if (!merchantKey) return bad(EXCLUSION_REASONS.NO_MERCHANT, providerTransactionId);

  const idRaw = pick(row, "id", "transaction_id", "transactionId");

  return {
    ok: true,
    occurrence: {
      index,
      id: typeof idRaw === "string" && idRaw !== "" ? idRaw : null,
      bankAccountId,
      clientId: pick(row, "client_id", "clientId") ?? null,
      providerTransactionId,
      amountCents,
      postedOn,
      merchantKey,
      merchantDisplay: typeof merchantRaw === "string" ? merchantRaw : null
    }
  };
}

/* ========================================================================== *
 * Statistics — integer cents only.
 * ========================================================================== */

/**
 * Median of integer cents, as an integer.
 *
 * MEDIAN AND NOT MEAN. One $300 annual renewal inside a $12 monthly
 * subscription would drag a mean to a number the client has never been charged.
 * The median is always a charge that either happened or sits between two that
 * did.
 *
 * The even-sized case is the only averaging in this module and it goes through
 * roundHalfUp() from src/commissions/money.mjs so it rounds the same way every
 * other money path in this repo rounds.
 */
export function medianCents(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[mid];
  return roundHalfUp((sorted[mid - 1] + sorted[mid]) / 2);
}

/* ========================================================================== *
 * Cadence fitting
 * ========================================================================== */

/**
 * How well does one cadence explain a series of observed dates?
 *
 * *** THE ERROR IS MEASURED AGAINST THE CALENDAR, NOT AGAINST AN AVERAGE
 * *** MONTH. This is the difference between a working detector and a useless
 * one. A bill charged on the 15th of every month produces gaps of 31, 28, 31,
 * 30 days. Measured against the 30.4375-day average month, that perfectly
 * regular bill looks like it wobbles by up to 2.4 days every single month, and
 * it would be penalised for the calendar's irregularity rather than its own.
 * So the predicted date is built with advance() — real month arithmetic — and
 * the error is the distance from that. A bill on the 15th scores exactly zero
 * error, which is the truth.
 *
 * Each observed gap may span k whole periods, so a SKIPPED MONTH (31, 59, 31)
 * is read as monthly-with-one-missed-payment rather than as no cadence at all.
 * The tolerance widens with k because each unobserved period adds its own drift.
 *
 * `missedPeriods` counts the periods where a charge should have been and was
 * not. It is the primary tie-break, and it is what stops a monthly series being
 * reported as biweekly-with-every-other-one-missing: both "fit", but monthly
 * explains the same data with fewer events nobody ever saw.
 */
export function fitCadence(days, cadence, anchorDom) {
  let fits = 0;
  let missedPeriods = 0;
  let totalError = 0;
  let spannedPeriods = 0;
  const intervals = days.length - 1;

  for (let i = 1; i < days.length; i += 1) {
    const prev = days[i - 1];
    const actual = days[i];
    const gap = daysBetween(prev, actual);
    const k = Math.max(1, Math.round(gap / cadence.days));
    const predicted = advance(prev, cadence, k, anchorDom);
    const error = Math.abs(dayNumber(actual) - dayNumber(predicted));
    const tolerance = cadence.toleranceDays * k;
    spannedPeriods += k;
    if (error <= tolerance) {
      fits += 1;
      missedPeriods += k - 1;
      totalError += error;
    }
  }

  return {
    cadence,
    fitRatio: intervals === 0 ? 0 : fits / intervals,
    fits,
    missedPeriods,
    spannedPeriods,
    avgErrorDays: fits === 0 ? Infinity : totalError / fits
  };
}

/**
 * Pick the cadence that best explains the dates, or null.
 *
 * Ranking, in order:
 *   1. It must explain at least MIN_FIT_RATIO of the intervals. A cadence that
 *      only accounts for half the charges is not this bill's cadence.
 *   2. Fewest MISSED periods. Occam: prefer the explanation that requires the
 *      fewest events we never saw.
 *   3. Best fit ratio, then smallest average error, then the fixed
 *      CADENCE_ORDER, so the answer is deterministic on an exact tie.
 */
function chooseCadence(days, anchorDom) {
  const candidates = CADENCE_ORDER
    .map((name) => fitCadence(days, CADENCES[name], anchorDom))
    .filter((f) => f.fitRatio >= MIN_FIT_RATIO);

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.missedPeriods !== b.missedPeriods) return a.missedPeriods - b.missedPeriods;
    if (a.fitRatio !== b.fitRatio) return b.fitRatio - a.fitRatio;
    if (a.avgErrorDays !== b.avgErrorDays) return a.avgErrorDays - b.avgErrorDays;
    return CADENCE_ORDER.indexOf(a.cadence.name) - CADENCE_ORDER.indexOf(b.cadence.name);
  });

  return candidates[0];
}

/* ========================================================================== *
 * Confidence
 * ========================================================================== */

export function labelFor(pct) {
  for (const band of LABEL_THRESHOLDS) {
    if (pct >= band.min) return band.label;
  }
  return "none";
}

const LABEL_RANK = Object.freeze({ none: 0, low: 1, medium: 2, high: 3 });

/**
 * *** THE RULE THAT MAKES TWO OCCURRENCES A GUESS. ***
 *
 * Whatever the arithmetic says, a detection with fewer than three occurrences
 * is capped at 'low' and therefore can never reach `result.bills`. Two points
 * define exactly one interval and any line through them fits perfectly; the
 * "perfect fit" is an artefact of having no third point to contradict it.
 *
 * DEFENCE IN DEPTH, AND HONEST ABOUT IT: the two-occurrence base score is 42
 * and every other term is a penalty, so today no input can score its way past
 * 'medium' and this cap never fires. It exists so that changing the base table
 * later cannot silently promote a two-point guess into a bill. Exported and
 * asserted directly in recurring.test.mjs, because a guard that no fixture can
 * reach is a guard no test protects — which is exactly how the defects in
 * AUDIT-FINDINGS survived for months.
 */
export function capLabelForEvidence(label, occurrenceCount) {
  if (occurrenceCount < MIN_OCCURRENCES_FOR_A_DATE && LABEL_RANK[label] > LABEL_RANK.low) {
    return "low";
  }
  return label;
}

/**
 * Score a detection 0..MAX_CONFIDENCE. Integer, deterministic, no floats stored.
 *
 * Every term is a penalty against an evidence-count baseline, and each one has
 * a reason:
 *
 *   base            More occurrences is more evidence. Three is the first count
 *                   at which a cadence could have been contradicted and was not,
 *                   so it is the first that reaches 'medium'. Two tops out well
 *                   inside 'low' before any penalty applies at all.
 *   missedPeriods   Every gap where a charge should have been and was not is
 *                   evidence against the pattern. Capped so a long, mostly-good
 *                   history is not destroyed by an old lapse.
 *   fit             How far the intervals sit from the ideal, as a share of the
 *                   cadence's own tolerance.
 *   unexplained     Intervals the chosen cadence could not account for at all.
 *   amount spread   A "bill" whose amount doubles is not obviously one bill.
 *                   Banded rather than continuous: a utility bill legitimately
 *                   varies by a third season to season, and penalising that
 *                   linearly would bury every utility in the 'low' band.
 *   staleness       The strongest evidence somebody still pays a bill is that
 *                   they paid it recently. This is the only `now`-dependent
 *                   term, and it is why `now` is a required parameter.
 */
export function scoreConfidence({ occurrenceCount, fit, relSpreadPct, periodsSinceLast }) {
  // Two occurrences start at 42 — comfortably inside 'low' (>= 30) and
  // comfortably below 'medium' (>= 55), with room for a penalty or two before
  // it drops out of 'low' altogether. Starting it AT the 'low' floor would have
  // made a single rounding penalty tip a real, clean pair into 'none', where it
  // would be reported as "no cadence found" rather than as the low-confidence
  // guess it actually is. The band a detection lands in should say how good the
  // evidence is, not how close a threshold happened to be.
  const base =
    occurrenceCount >= 6 ? 88
      : occurrenceCount === 5 ? 80
        : occurrenceCount === 4 ? 70
          : occurrenceCount === 3 ? 55
            : 42;

  const missedPenalty = Math.min(30, fit.missedPeriods * 8);

  const fitPenalty = Math.min(
    15,
    Math.round(15 * (fit.avgErrorDays / fit.cadence.toleranceDays))
  );

  const unexplainedPenalty = Math.round(20 * (1 - fit.fitRatio));

  const spreadPenalty =
    relSpreadPct <= 2 ? 0
      : relSpreadPct <= 10 ? 5
        : relSpreadPct <= 25 ? 12
          : 25;

  const stalePenalty = periodsSinceLast > STALE_PERIODS ? 25 : 0;

  const raw = base - missedPenalty - fitPenalty - unexplainedPenalty - spreadPenalty - stalePenalty;
  return Math.max(0, Math.min(MAX_CONFIDENCE, Math.round(raw)));
}

/* ========================================================================== *
 * Detection
 * ========================================================================== */

/**
 * Detect recurring outflows in a set of transaction rows.
 *
 * PURE. No database, no network, no clock. `rows` is not mutated.
 *
 * @param {Array<object>} rows
 *        bank_transactions-shaped rows, snake_case or camelCase. They may come
 *        from anywhere; this module never fetches them.
 * @param {object} options
 * @param {Date|string} options.now
 *        REQUIRED. The instant the answer is "as of". Throws if absent — a
 *        defaulted clock is the same bug as a hidden one.
 * @param {Object<string, boolean>} [options.accountIsBusiness]
 *        Optional account-level fact: { [bankAccountId]: true|false }. The ONLY
 *        source of isBusiness. Absent -> null, with a reason. Never inferred.
 * @param {string[]} [options.accountIds]
 *        Optional allow-list. Rows for other accounts are excluded by
 *        `missing_bank_account_id`-style filtering before anything else, so a
 *        caller can pass one client's whole history and detect per account.
 *
 * @returns {{
 *   detectedAsOf: string,
 *   bills: object[],
 *   candidates: object[],
 *   rejected: object[],
 *   excluded: object[]
 * }}
 *   `bills` are medium/high confidence and safe to present as bills.
 *   `candidates` are low confidence and *** MUST NOT *** be presented as bills.
 */
export function detectRecurringBills(rows, options = {}) {
  const { now, accountIsBusiness = null, accountIds = null } = options;

  if (now === undefined || now === null) {
    throw new TypeError(
      "detectRecurringBills: `now` is required. This evaluator has no clock — " +
      "an answer that depends on when it ran cannot be tested or audited."
    );
  }
  const today = parseDay(now);
  if (!today) throw new TypeError(`detectRecurringBills: unparseable \`now\`: ${String(now)}`);

  const detectedAsOf = now instanceof Date ? now.toISOString() : `${formatDay(today)}T00:00:00.000Z`;

  if (!Array.isArray(rows)) {
    throw new TypeError("detectRecurringBills: `rows` must be an array");
  }

  const allowed = Array.isArray(accountIds) && accountIds.length > 0 ? new Set(accountIds) : null;

  /* -- Read every row, dropping nothing silently ------------------------- */

  const excluded = [];
  const seenProviderIds = new Set();
  const groups = new Map();

  for (let i = 0; i < rows.length; i += 1) {
    const read = readRow(rows[i], i);
    if (!read.ok) {
      excluded.push(read.excluded);
      continue;
    }
    const occ = read.occurrence;

    if (allowed && !allowed.has(occ.bankAccountId)) continue;

    // Dedupe on the same key the database uses: (account, provider id).
    const dedupeKey = `${occ.bankAccountId} ${occ.providerTransactionId}`;
    if (seenProviderIds.has(dedupeKey)) {
      excluded.push({
        index: occ.index,
        reason: EXCLUSION_REASONS.DUPLICATE,
        providerTransactionId: occ.providerTransactionId
      });
      continue;
    }
    seenProviderIds.add(dedupeKey);

    const groupKey = `${occ.bankAccountId} ${occ.merchantKey}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey).push(occ);
  }

  /* -- Turn each merchant group into an answer --------------------------- */

  const bills = [];
  const candidates = [];
  const rejected = [];

  for (const occurrences of groups.values()) {
    const result = detectOneGroup(occurrences, { today, detectedAsOf, accountIsBusiness });
    if (result.kind === "rejected") rejected.push(result.value);
    else if (result.kind === "candidate") candidates.push(result.value);
    else bills.push(result.value);
  }

  const byMerchant = (a, b) =>
    a.bankAccountId < b.bankAccountId ? -1
      : a.bankAccountId > b.bankAccountId ? 1
        : a.merchantKey < b.merchantKey ? -1
          : a.merchantKey > b.merchantKey ? 1 : 0;

  bills.sort(byMerchant);
  candidates.sort(byMerchant);
  rejected.sort(byMerchant);

  return { detectedAsOf, bills, candidates, rejected, excluded };
}

/**
 * One (account, merchant) group -> a bill, a candidate or a rejection.
 *
 * SAME-DAY CHARGES COLLAPSE TO ONE OCCURRENCE. Two charges at the same merchant
 * on the same day are either one bill double-posted or two separate purchases,
 * and NOTHING IN THE DATA SAYS WHICH. So the module does not guess: a day
 * contributes exactly one occurrence — a cadence is about WHEN, and a merchant
 * that charged twice on Tuesday still only billed on Tuesday — and that day's
 * representative amount is the median of its charges. Every collapsed
 * transaction stays in `evidenceTransactionIds`, and `sameDayCollapsedDays`
 * reports that it happened so the caller can see it rather than discover it.
 */
function detectOneGroup(occurrences, { today, detectedAsOf, accountIsBusiness }) {
  const first = occurrences[0];
  const identity = {
    bankAccountId: first.bankAccountId,
    clientId: first.clientId ?? null,
    merchantKey: first.merchantKey,
    merchantDisplay: first.merchantDisplay
  };

  // Collapse by day.
  const byDay = new Map();
  for (const occ of occurrences) {
    const key = formatDay(occ.postedOn);
    if (!byDay.has(key)) byDay.set(key, { day: occ.postedOn, amounts: [], ids: [], providerIds: [] });
    const bucket = byDay.get(key);
    bucket.amounts.push(occ.amountCents);
    if (occ.id) bucket.ids.push(occ.id);
    bucket.providerIds.push(occ.providerTransactionId);
  }

  const days = [...byDay.values()].sort((a, b) => dayNumber(a.day) - dayNumber(b.day));
  const sameDayCollapsedDays = days.filter((d) => d.amounts.length > 1).length;

  const evidenceTransactionIds = days.flatMap((d) => d.ids);
  const evidenceProviderIds = days.flatMap((d) => d.providerIds);
  const occurrenceCount = days.length;

  if (occurrenceCount < MIN_OCCURRENCES) {
    return {
      kind: "rejected",
      value: {
        ...identity,
        occurrenceCount,
        reason: REASONS.SINGLE_OCCURRENCE,
        evidenceTransactionIds,
        evidenceProviderIds
      }
    };
  }

  const dayList = days.map((d) => d.day);
  const gapsDays = [];
  for (let i = 1; i < dayList.length; i += 1) {
    gapsDays.push(daysBetween(dayList[i - 1], dayList[i]));
  }

  // The day-of-month the bill is really billed on. Computed before fitting
  // because the fit itself needs it — see advance() for why the LARGEST
  // observed day-of-month is the right anchor and the last one is not.
  const anchorDom = Math.max(...dayList.map((d) => d.d));

  const fit = chooseCadence(dayList, anchorDom);
  if (!fit) {
    return {
      kind: "rejected",
      value: {
        ...identity,
        occurrenceCount,
        reason: REASONS.NO_CADENCE,
        observedGapsDays: gapsDays,
        evidenceTransactionIds,
        evidenceProviderIds
      }
    };
  }

  /* -- Amount ------------------------------------------------------------ */

  const dayAmounts = days.map((d) => medianCents(d.amounts));
  const typicalAmountCents = medianCents(dayAmounts);
  const magnitudes = dayAmounts.map((a) => Math.abs(a));
  const minAbs = Math.min(...magnitudes);
  const maxAbs = Math.max(...magnitudes);
  const medianAbs = Math.abs(typicalAmountCents);
  const relSpreadPct = medianAbs === 0 ? 0 : Math.round((100 * (maxAbs - minAbs)) / medianAbs);

  /* -- Confidence -------------------------------------------------------- */

  const firstSeen = days[0].day;
  const lastSeen = days[days.length - 1].day;
  const periodsSinceLast = daysBetween(lastSeen, today) / fit.cadence.days;

  const confidencePct = scoreConfidence({ occurrenceCount, fit, relSpreadPct, periodsSinceLast });
  const confidenceLabel = capLabelForEvidence(labelFor(confidencePct), occurrenceCount);

  /* -- The next date, or an honest refusal to name one -------------------- */

  let nextExpectedDate = null;
  let nextExpectedUnknownReason = null;

  if (occurrenceCount < MIN_OCCURRENCES_FOR_A_DATE) {
    nextExpectedUnknownReason = REASONS.TWO_OCCURRENCES;
  } else if (LABEL_RANK[confidenceLabel] < LABEL_RANK.medium) {
    nextExpectedUnknownReason = REASONS.LOW_CONFIDENCE;
  } else {
    let candidate = advance(lastSeen, fit.cadence, 1, anchorDom);
    let rolls = 0;
    while (dayNumber(candidate) <= dayNumber(today) && rolls < MAX_ROLL_FORWARD) {
      candidate = advance(candidate, fit.cadence, 1, anchorDom);
      rolls += 1;
    }
    if (dayNumber(candidate) <= dayNumber(today)) {
      nextExpectedUnknownReason = REASONS.STOPPED;
    } else {
      nextExpectedDate = formatDay(candidate);
    }
  }

  /* -- is_business: only ever from a fact the caller supplied ------------- */

  let isBusiness = null;
  let isBusinessUnknownReason = REASONS.NO_ACCOUNT_BUSINESS_FLAG;
  if (accountIsBusiness && typeof accountIsBusiness === "object") {
    const flag = accountIsBusiness[identity.bankAccountId];
    if (flag === true || flag === false) {
      isBusiness = flag;
      isBusinessUnknownReason = null;
    }
  }

  const value = {
    ...identity,
    cadence: fit.cadence.name,
    typicalAmountCents,
    amountMinCents: -maxAbs,
    amountMaxCents: -minAbs,
    amountSpreadPct: relSpreadPct,
    occurrenceCount,
    sameDayCollapsedDays,
    firstSeenOn: formatDay(firstSeen),
    lastSeenOn: formatDay(lastSeen),

    // THE DAY OF THE MONTH THE BILL ACTUALLY LANDS ON, for month-based
    // cadences; null for weekly and biweekly, where it means nothing.
    //
    // This is the anchor advance() uses, published because it CANNOT BE
    // RECOVERED FROM `nextExpectedDate`. A bill charged on the 31st whose next
    // predicted date falls in a 30-day month has that date clamped to the 30th,
    // and anything downstream that carries the prediction forward from the
    // clamped value pins the bill to the 30th permanently. The seam to the
    // cash-flow projector hit exactly that and needs the real number.
    anchorDayOfMonth: fit.cadence.months === 0 ? null : anchorDom,

    nextExpectedDate,
    nextExpectedUnknownReason,
    confidencePct,
    confidenceLabel,
    isBusiness,
    isBusinessUnknownReason,
    missedPeriods: fit.missedPeriods,
    fitRatio: fit.fitRatio,
    avgIntervalErrorDays: Number.isFinite(fit.avgErrorDays)
      ? Math.round(fit.avgErrorDays * 100) / 100
      : null,
    observedGapsDays: gapsDays,
    evidenceTransactionIds,
    evidenceProviderIds,
    detectedAsOf
  };

  if (confidenceLabel === "none") {
    return {
      kind: "rejected",
      value: { ...value, reason: REASONS.NO_CADENCE }
    };
  }

  return { kind: PRESENTABLE_LABELS.includes(confidenceLabel) ? "bill" : "candidate", value };
}

/* ========================================================================== *
 * Shaping for storage
 * ========================================================================== */

/**
 * A detected bill -> the exact column names db/migrations/086_recurring_bills.sql
 * expects. PURE: it builds an object, it does not write one.
 *
 * It exists so the mapping from the detector's vocabulary to the table's lives
 * in ONE tested place. AUDIT-FINDINGS' most expensive single finding is
 * 031_invoices.sql renaming three columns with no code following, discovered
 * only against real Postgres — a mapping that is written inline at each call
 * site is a mapping that drifts one call site at a time.
 *
 * `orgId` is a parameter and is never taken from a transaction row: tenancy is
 * the caller's to assert, the same way src/mail/responses.mjs takes org from the
 * record rather than from the caller's payload.
 */
export function toBillRow(bill, { orgId }) {
  if (!orgId) throw new TypeError("toBillRow: orgId is required");
  if (!isOutflow(bill.typicalAmountCents)) {
    throw new RangeError(
      `toBillRow: a bill must be an outflow (negative cents); got ${bill.typicalAmountCents}. ` +
      "Check the sign convention at the ingest boundary."
    );
  }
  return {
    org_id: orgId,
    bank_account_id: bill.bankAccountId,
    client_id: bill.clientId ?? null,
    merchant_key: bill.merchantKey,
    merchant_display: bill.merchantDisplay ?? null,
    cadence: bill.cadence,
    typical_amount_cents: bill.typicalAmountCents,
    anchor_day_of_month: bill.anchorDayOfMonth ?? null,
    next_expected_on: bill.nextExpectedDate,
    next_expected_unknown_reason: bill.nextExpectedUnknownReason,
    /* THE TRUE BILLING DAY, WHICH next_expected_on MAY HAVE CLAMPED. A bill due
       on the 31st predicts the 30th whenever the next month is short, and
       cashflow-seam.mjs's expectedOccurrences() anchors its whole series on
       whatever day-of-month it is given. Before migration 090 this value was
       computed here, dropped on the way into the table, and re-derived downstream
       from the clamped date — which pinned a month-end bill to the 30th forever.
       The detector is the only thing that knows the real anchor; this carries it.
       NULL for weekly and biweekly, which have no day-of-month at all. */
    anchor_day_of_month: bill.anchorDayOfMonth ?? null,
    confidence_pct: bill.confidencePct,
    confidence_label: bill.confidenceLabel,
    is_business: bill.isBusiness,
    occurrence_count: bill.occurrenceCount,
    first_seen_on: bill.firstSeenOn,
    last_seen_on: bill.lastSeenOn,
    detected_as_of: bill.detectedAsOf
  };
}

/**
 * A STORED recurring_bills row -> the shape every consumer of a bill expects.
 *
 * THE EXACT INVERSE OF toBillRow(), AND IT LIVES HERE FOR THE SAME REASON.
 * The store returns raw database rows in snake_case; src/banking/cashflow-seam.mjs
 * reads camelCase, and one field is not merely re-cased but RENAMED — the column
 * is `next_expected_on`, the reader wants `nextExpectedDate`. `cadence` was the
 * only name that matched on both sides.
 *
 * Nothing threw. Feeding a stored row straight to the projector returned "no
 * confident date" for every bill, rendered every id as
 * `undefined:undefined:monthly`, and produced NaN for every confidence — so the
 * screen would show a client with NO BILLS AT ALL, which reads as "you are fine"
 * rather than "we could not read your bills". No test crossed the line between
 * the store and the seam, which is why it never fired.
 *
 * bigint columns arrive from node-postgres as STRINGS. typical_amount_cents is
 * coerced to a number here, once, rather than left for each caller's arithmetic
 * to coerce by accident.
 *
 * `date` columns arrive as Date OBJECTS, decoded to LOCAL midnight, and they are
 * put back to the `YYYY-MM-DD` strings the detector emits — here, once. A Date
 * left in place is not the inverse of what was written: it compares unequal to
 * the string that went in, it serialises into a JSON response as
 * "2026-07-15T00:00:00.000Z", and east of Greenwich it serialises as THE DAY
 * BEFORE, because local midnight is the previous day in UTC. parseDay/formatDay
 * read the local parts, which is the only reading that recovers the stored day.
 */
export function fromBillRow(row) {
  if (!row) return null;
  const cents = row.typical_amount_cents;
  const day = (value) => {
    const parsed = parseDay(value);
    return parsed ? formatDay(parsed) : null;
  };
  const instant = (value) => {
    if (value === null || value === undefined) return null;
    if (!(value instanceof Date)) return String(value);
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  };
  return {
    id: row.id ?? null,
    orgId: row.org_id ?? null,
    bankAccountId: row.bank_account_id ?? null,
    clientId: row.client_id ?? null,
    merchantKey: row.merchant_key ?? null,
    merchantDisplay: row.merchant_display ?? null,
    cadence: row.cadence ?? null,
    typicalAmountCents: cents === null || cents === undefined ? null : Number(cents),
    // The renamed field. See the docblock.
    nextExpectedDate: day(row.next_expected_on),
    nextExpectedUnknownReason: row.next_expected_unknown_reason ?? null,
    // NULL is correct for a row written before 091 and for weekly/biweekly
    // cadences. The seam falls back to the day in nextExpectedDate.
    anchorDayOfMonth: row.anchor_day_of_month ?? null,
    confidencePct: row.confidence_pct ?? null,
    confidenceLabel: row.confidence_label ?? null,
    isBusiness: row.is_business ?? null,
    occurrenceCount: row.occurrence_count ?? null,
    firstSeenOn: day(row.first_seen_on),
    lastSeenOn: day(row.last_seen_on),
    detectedAsOf: instant(row.detected_as_of)
  };
}
