// /api/finance/model — the deal model. What a client actually walks away with,
// and how a draw should be spread across their cards.
//
//   POST { approved_funding, fee_pct?, fee_dollar?, down_payment?, ... ,
//          client_id?, requested_amount?, utilization_threshold? }
//        → { ok, deal, funding }
//
// `deal`    is calcDeal()    from src/calculators/deal-math.mjs    — net cash, fee split, monthly obligation, the cliff
// `funding` is calcFunding() from src/calculators/deal-funding.mjs — headroom, the waterfall, pay-method comparison, the guardrail
//
// *** SCAFFOLD STUB — TRACK 6 OWNS THIS FILE. ***
// Auth, role gate, org scoping, method switch and error mapping are finished and
// are the contract. Track 6 replaces the `not_implemented` body.
//
// *** POST, NOT GET, AND IT COMPUTES RATHER THAN STORES. *** Both calculators
// are pure — no database, no clock, no randomness — so this endpoint writes
// nothing. It is a POST because the input is a whole deal shape rather than a
// handful of query parameters, and because a URL carrying a named client's
// approved funding amount would land in every access log it passed through.
//
// *** THE ARITHMETIC IS NOT DONE IN THE BROWSER. *** public/app/closer-dashboard
// .html already reimplements a funding waterfall in inline JavaScript against
// sample rows, and that is exactly the drift this endpoint avoids: a second
// implementation in a <script> block is a second answer that goes stale
// (src/finance/os-grid.mjs:3). deal-model.html renders what this returns and
// decides nothing.
//
// Funding Agreement section 2 credits the deposit once toward the success fee.
// calcDeal subtracts the paid deposit and remaining fee from lifetime cash;
// the deposit is never charged a second time on top of the total fee.
//
// *** THE GUARDRAIL MEASURES THE DELTA, NOT THE ABSOLUTE. *** calcFunding's hard
// stop fires when THIS DRAW pushes utilization across the threshold, not when
// the client is already over it. A client sitting at 38% on existing balances
// would fail an absolute 30% gate forever, at zero draw — that is a pre-existing
// condition, not a reason to block this deal. Render `hardStop` and
// `preExistingOver` as the different things they are.
//
// *** UNKNOWN MUST SURVIVE. *** Both calculators return null for anything that
// depends on a missing input — a card with no credit limit contributes no
// headroom, an unpriced line is never offered as the cheapest money. The screen
// renders null as an em dash. Never 0.00, and never a coalesced default.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { listTradelines } from "../../src/tradelines/store.mjs";
import { toCalculatorCards, toCents, fromCents } from "../../src/tradelines/index.mjs";
import { calcDeal } from "../../src/calculators/deal-math.mjs";
import {
  calcFunding,
  parseUtilizationThreshold,
  UTILIZATION_THRESHOLD_REFUSALS
} from "../../src/calculators/deal-funding.mjs";
/* DEFAULT_UTILIZATION_THRESHOLD lives in src/alerts/evaluate.mjs and it is the
   repo's ONE name for this constant: src/alerts/evaluate.test.mjs:53 asserts it
   equals the threshold calcFunding actually applies, so the two cannot drift.
   Importing it from there rather than writing `0.30` here keeps that single
   assertion covering this endpoint too. thresholdFromBps is the only place
   basis points become a fraction (evaluate.mjs:93) — 3000 → 0.30 — and it
   returns null rather than a default for anything unusable, which is what makes
   "the org has not configured one" distinguishable from "the org configured
   30%". */
import { DEFAULT_UTILIZATION_THRESHOLD, thresholdFromBps } from "../../src/alerts/evaluate.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/* ROLE_SETS.STAFF — closers and funding advisors model deals; that is the job.
   The inputs are numbers the caller supplies, and the only stored data this
   endpoint may touch is the named client's own cards, which api/read/tradelines
   .mjs already serves to this same set. deal-model.html is in the shared staff
   surface to match. */
const MODEL_ROLES = ROLE_SETS.STAFF;

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

export default async function handler(req, res) {
  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  // Second call, deliberately — requireAuth ignores a `roles` key.
  if (!requireRole(res, staff, MODEL_ROLES)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  try {
    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      // client_id is OPTIONAL: the model runs on numbers typed into the screen
      // with no client at all. When one IS named, their cards are read for the
      // waterfall — and that read is org-scoped like every other read here.
      if (body.client_id !== undefined && body.client_id !== null && body.client_id !== "") {
        if (!isUuid(body.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, body.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
      }

      const clientId = body.client_id === undefined || body.client_id === null || body.client_id === ""
        ? null
        : String(body.client_id).trim();

      /* ── 1. the numbers the caller typed ───────────────────────────────────
         EVERY ONE OF THESE IS DOLLARS ON THE WIRE AND DOLLARS IN THE
         CALCULATOR. Nothing on this endpoint is stored, so nothing here is
         converted to cents — but it is rounded TO the cent at this boundary and
         nowhere else, because a fee of 10% of $250,000.005 is a number nobody
         can pay and a screen that shows four decimal places of somebody's money
         reads as a fault. dollarsIn() is the only door those values come
         through; it refuses a negative, refuses a value larger than this
         calculator will model, and returns null for "not supplied" so that an
         unknown stays unknown all the way to the screen. */
      const approvedFunding = dollarsIn(body.approved_funding, "approved_funding");
      const feeDollar = dollarsIn(body.fee_dollar, "fee_dollar");
      const downPayment = dollarsIn(body.down_payment, "down_payment");
      const existingDebts = dollarsIn(body.existing_debts, "existing_debts");
      const requestedAmount = dollarsIn(body.requested_amount, "requested_amount");

      const feePct = fractionIn(body.fee_pct, "fee_pct");
      const pctOn0Intro = fractionIn(body.pct_on_0_intro, "pct_on_0_intro");
      const postIntroApr = fractionIn(body.post_intro_apr, "post_intro_apr");
      const minPaymentPct = fractionIn(body.min_payment_pct, "min_payment_pct");
      const amortApr = fractionIn(body.amort_apr, "amort_apr");
      const introMonths = monthsIn(body.intro_months, "intro_months");
      const amortTermMonths = monthsIn(body.amort_term_months, "amort_term_months");

      /* feeFromProceeds says WHERE the fee is paid from, not whether it is
         owed — see the header. Anything other than an explicit false leaves the
         calculator's own default in place. */
      const feeFromProceeds = body.fee_from_proceeds === undefined
        ? undefined
        : !(body.fee_from_proceeds === false || body.fee_from_proceeds === "false" || body.fee_from_proceeds === 0);

      /* ── 2. the guardrail line ─────────────────────────────────────────────
         Three sources, in this order, and the answer says which one was used.
         A screen that shows a hard stop without saying what line it was measured
         against is showing a verdict nobody can check. */
      const threshold = await resolveThreshold(orgId, body.utilization_threshold);
      if (threshold.refusal) {
        return res.status(400).json({
          ok: false,
          error: UTILIZATION_THRESHOLD_REFUSALS[threshold.refusal] || "utilization_threshold is not usable",
          reason: threshold.refusal
        });
      }

      /* ── 3. the client's cards ─────────────────────────────────────────────
         THE WATERFALL RUNS ON STORED TRADELINES OR IT DOES NOT RUN. There is no
         "type some cards in" path here on purpose: a waterfall over cards nobody
         recorded is a screenful of allocation figures about credit lines that
         may not exist, and it would be indistinguishable from the real thing.
         With no client named, or a client with nothing on file, `funding` is
         null and `reasons` says which — and the screen sends the reader to the
         card stack instead of drawing an empty table. */
      const reasons = [];
      let cardSummary = null;
      let funding = null;

      if (!clientId) {
        reasons.push("no_client_named");
      } else {
        // listTradelines refuses to run without an org id and filters on it in
        // SQL (src/tradelines/store.mjs:89). The org comes from the SESSION; the
        // ownership check above has already proved this client belongs to it.
        const rows = await listTradelines(db, { orgId, clientId, includeClosed: false });
        const summarised = summariseCards(rows);
        cardSummary = summarised.summary;
        if (!cardSummary.considered) {
          reasons.push(rows.length ? "no_drawable_cards_on_file" : "no_tradelines_on_file");
        } else {
          if (requestedAmount == null) {
            // Cards but no amount: calcFunding still reports the headroom and
            // nulls the allocation, which is the honest state for a screen the
            // closer has not typed an amount into yet.
            reasons.push("no_requested_amount");
          }
          funding = calcFunding({
            cards: summarised.calculatorCards,
            ...(requestedAmount == null ? {} : { requestedAmount }),
            utilizationThreshold: threshold.value
          });
        }
      }

      if (approvedFunding == null) reasons.push("no_approved_funding");

      /* ── 4. the deal itself ────────────────────────────────────────────────
         calcDeal is handed only the keys the caller actually supplied. Passing
         `undefined` would be harmless for a defaulted parameter and NOT harmless
         for one that is meant to stay unset, and building the object this way
         means the calculator's own defaults are the only defaults in play —
         there is no second set of them written down here to go stale. */
      const deal = calcDeal({
        approvedFunding: approvedFunding == null ? undefined : approvedFunding,
        ...(feePct == null ? {} : { feePct }),
        ...(feeDollar == null ? {} : { feeDollar }),
        ...(downPayment == null ? {} : { downPayment }),
        ...(feeFromProceeds === undefined ? {} : { feeFromProceeds }),
        ...(pctOn0Intro == null ? {} : { pctOn0Intro }),
        ...(introMonths == null ? {} : { introMonths }),
        ...(postIntroApr == null ? {} : { postIntroApr }),
        ...(minPaymentPct == null ? {} : { minPaymentPct }),
        ...(amortApr == null ? {} : { amortApr }),
        ...(amortTermMonths == null ? {} : { amortTermMonths })
      });

      return res.status(200).json({
        ok: true,
        /* SAY THE UNIT. Everything stored in this repository is integer cents;
           everything on this response is dollars. The two readings are a factor
           of a hundred apart and the only thing standing between them is that
           somebody read the right one. */
        units: "dollars",
        client_id: clientId,
        guardrail_threshold: {
          value: threshold.value,
          source: threshold.source,
          note: threshold.note
        },
        deal,
        net: netCashLines(deal, { approvedFunding, existingDebts }),
        funding,
        cards: cardSummary,
        reasons
      });
    }

    // GET is not offered on purpose — see the header.
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    /* A DATABASE THAT DID NOT ANSWER IS NOT OUR CODE THROWING, AND THE SCREEN
       MUST NOT BE TOLD IT WAS. Everything above this line has already claimed
       the faults it can name; what is left reaches netlify/functions/api.mjs as
       a bare 500 internal_error, which public/app/data.js words as "something
       went wrong on our side ... The database did not report a problem." That
       sentence is false during an outage and it is how the funding-capacity read
       reported a dead database as a bug in this file. 503 + db:"down" is the
       shape data.js already reads as "the database is not answering".
       See src/http/db-down.mjs — it stays narrow, so anything it cannot
       positively identify still falls through to the 500 it got before. */
    if (dbDown(res, e)) return;

    throw e;
  }
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(
    `SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`,
    [String(clientId).trim(), orgId]
  );
  return r.rows.length > 0;
}

/* ═══════════════════════════ reading the inputs ═══════════════════════════
 *
 * Every number the caller sends comes through one of the three functions below,
 * and each of them treats ABSENT and BAD as different answers: absent returns
 * null, which the calculators are built to carry through as an unknown, and bad
 * throws a TypeError, which the catch above turns into a 400 carrying the
 * sentence. Neither ever substitutes a value. A parser that quietly defaults a
 * fee percentage is a parser that invoices somebody the wrong amount and leaves
 * nothing behind saying it did.
 */

/* Anything above this is not a deal, it is a typo, and the intro schedule loop
   in calcDeal would happily spend the time computing it. A billion dollars is
   several orders of magnitude past the largest round this business has ever
   funded, so refusing above it costs nothing real. */
const MAX_MODELLED_DOLLARS = 1_000_000_000;

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
const round6 = (n) => (n == null ? null : Math.round(n * 1e6) / 1e6);

const absent = (raw) =>
  raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");

/* dollarsIn — a dollar amount typed by a person, or null.
 *
 * IT REUSES toCents/fromCents RATHER THAN PARSING MONEY A SECOND TIME.
 * src/tradelines/index.mjs:24 already owns "a money string a human or a vendor
 * wrote" — it strips the currency mark and the separators, refuses a negative,
 * and rounds to the cent — and that rounding is the reason it is used here even
 * though nothing on this endpoint is stored: a fee of 10% of $250,000.005 is a
 * number nobody can pay, and four decimal places of someone's money on a screen
 * reads as a fault. Round-tripping through cents is how this file honours the
 * repo's money rule without pretending to store anything.
 *
 * The typeof guard is NOT belt and braces. `toCents([])` is 0, because an empty
 * array stringifies to an empty string and `Number("")` is zero — so a JSON body
 * carrying `"existing_debts": []` would have become a $0 debt line rather than a
 * refusal. */
function dollarsIn(raw, field) {
  if (absent(raw)) return null;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new TypeError(`${field} must be an amount in dollars`);
  }
  const cents = toCents(raw);
  if (cents == null) throw new TypeError(`${field} must be an amount in dollars, and cannot be negative`);
  const dollars = fromCents(cents);
  if (dollars > MAX_MODELLED_DOLLARS) {
    throw new TypeError(`${field} is larger than this calculator will model`);
  }
  return dollars;
}

/* fractionIn — a rate or a share, as a fraction. 0.10 is ten percent.
 *
 * A VALUE ABOVE 1 IS REFUSED, NOT DIVIDED BY A HUNDRED. "10" in the fee box
 * means 10% to the person typing it and 1000% to this calculator: on a $250,000
 * round that is the difference between a $25,000 fee and a $2,500,000 one, and
 * the calculator would compute the second one without complaint and put it on a
 * screen next to the client's name. Guessing which was meant is not available —
 * 0.5 could honestly be either — so the refusal names the convention instead.
 * Same reasoning as readApr (src/tradelines/index.mjs:35), which refuses the
 * ambiguous band rather than clamping it. */
function fractionIn(raw, field) {
  if (absent(raw)) return null;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new TypeError(`${field} must be a fraction — 0.10 means 10%`);
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) throw new TypeError(`${field} must be a fraction — 0.10 means 10%`);
  if (n < 0) throw new TypeError(`${field} cannot be negative`);
  if (n > 1) throw new TypeError(`${field} is a fraction, not a percentage — 0.10 means 10%`);
  return round6(n);
}

/* monthsIn — a whole number of months. 600 is fifty years, which is past any
   term this product will ever write and short enough that the month-by-month
   loops in calcDeal stay instant. */
function monthsIn(raw, field) {
  if (absent(raw)) return null;
  if (typeof raw !== "number" && typeof raw !== "string") {
    throw new TypeError(`${field} must be a whole number of months`);
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n)) throw new TypeError(`${field} must be a whole number of months`);
  if (n < 0 || n > 600) throw new TypeError(`${field} must be between 0 and 600 months`);
  return n;
}

/* ═══════════════════════════ the guardrail line ═══════════════════════════
 *
 * resolveThreshold — which utilization line this run is measured against, and
 * WHERE THAT NUMBER CAME FROM. The source travels with the value all the way to
 * the screen: a hard stop shown without the line it was measured against is a
 * verdict nobody in the room can check, and the whole reason the request may
 * carry a threshold at all is so a closer can ask "what if we held 25%".
 *
 * Three sources, in order:
 *   request           — what the caller asked for, validated against the band in
 *                       parseUtilizationThreshold. Out of band is a 400, never a
 *                       clamp and never a silent fall back to the default: a
 *                       caller who asked for a different line and quietly got
 *                       the standard one was answered about a deal they did not
 *                       ask about.
 *   org_configuration — upsell_triggers.threshold_bps for the utilization rule
 *                       (migration 079), converted by the one function that
 *                       converts basis points. THE ROW IS READ FOR ITS
 *                       THRESHOLD, NOT FOR ITS `enabled` FLAG: `enabled` governs
 *                       whether the org raises ALERTS, and an org that wrote
 *                       down 25% with alerting still off has still told us where
 *                       its line is. It is org-scoped like every other read here.
 *   default           — calcFunding's own 0.30, the value the rest of this repo
 *                       already applies when nobody has said otherwise.
 *
 * A CONFIGURED VALUE GOES THROUGH THE SAME BAND. upsell_triggers CHECKs
 * threshold_bps between 0 and 100000 — up to 1000% — so configuration is a wide
 * enough door to walk a guardrail-disabling number through as well. It gets the
 * same refusal, except that a stored value cannot fail the request, so the run
 * falls back to the documented default and SAYS SO in `note`.
 */
async function resolveThreshold(orgId, requested) {
  if (!absent(requested)) {
    const parsed = parseUtilizationThreshold(requested);
    if (!parsed.ok) return { value: null, source: null, note: null, refusal: parsed.reason };
    return { value: parsed.value, source: "request", note: null, refusal: null };
  }

  let bps = null;
  try {
    const r = await db.query(
      `SELECT threshold_bps
         FROM upsell_triggers
        WHERE org_id = $1
          AND rule = 'utilization_over_threshold'
        LIMIT 1`,
      [orgId]
    );
    bps = r.rows.length ? r.rows[0].threshold_bps : null;
  } catch (e) {
    /* The configuration read failing must not take the whole model down, and it
       must not pass unmentioned either. The fallback is the STRICTER direction —
       0.30 is at or below every threshold an org is likely to have configured,
       so a run that falls back is more likely to hard-stop, not less. A
       guardrail that fails towards "clear" would be the one failure here worth
       being frightened of. */
    return {
      value: DEFAULT_UTILIZATION_THRESHOLD,
      source: "default",
      note: "this org's configured threshold could not be read, so the standard line was used",
      refusal: null
    };
  }

  const configured = thresholdFromBps(bps);
  if (configured == null) {
    // No row, or a row with the threshold unset — which is how 079 ships. Not an
    // error, and not a reason to invent one.
    return { value: DEFAULT_UTILIZATION_THRESHOLD, source: "default", note: null, refusal: null };
  }
  const parsed = parseUtilizationThreshold(configured);
  if (parsed.ok) {
    return { value: parsed.value, source: "org_configuration", note: null, refusal: null };
  }
  return {
    value: DEFAULT_UTILIZATION_THRESHOLD,
    source: "default",
    note: `this org's configured threshold (${String(bps)} basis points) is outside the range this ` +
          "calculator accepts, so the standard line was used",
    refusal: null
  };
}

/* ═══════════════════════════ the client's cards ═══════════════════════════
 *
 * summariseCards — the rows to hand the calculator, plus an honest account of
 * what it could not use. Both halves matter and only one of them is arithmetic.
 *
 * TWO KINDS OF HOLE, AND THE SCREEN HAS TO SAY WHICH:
 *
 *   * A CARD WITH NO CREDIT LIMIT contributes no headroom and is dropped by
 *     calcFunding's own filter (deal-funding.mjs:46). Total available credit is
 *     therefore a FLOOR whenever one exists, which is exactly what the "+"
 *     marker in finance-os.css means. Counting them here is what lets the screen
 *     mark the row without recomputing anything.
 *
 *   * A CARD WITH NO RECORDED BALANCE arrives at the calculator as a balance of
 *     ZERO — toCalculatorCards maps `fromCents(r.balance_cents) ?? 0`
 *     (src/tradelines/index.mjs:169), a known loss already written up in
 *     src/alerts/evaluate.mjs:120. That makes its utilization read 0% and the
 *     guardrail OPTIMISTIC about it: the one direction a safety gate must not be
 *     wrong in. The loss cannot be recovered downstream — by then a real zero
 *     and an unknown are the same number — so it is counted HERE, from the rows,
 *     and reported so the screen can say the verdict rests on a balance nobody
 *     has recorded. Fixing it belongs in toCalculatorCards, which several other
 *     callers depend on; it is named in the track report rather than changed
 *     underneath them.
 *
 * `current_balance` in the list is null for those cards, NOT the zero the
 * calculator saw, because this list is what a person reads.
 */
function summariseCards(rows = []) {
  const calculatorCards = toCalculatorCards(rows);
  const byId = new Map(rows.map((r) => [String(r.id), r]));

  let balanceUnknown = 0;
  let aprUnknown = 0;
  const list = calculatorCards.map((c) => {
    const row = byId.get(String(c.id)) || null;
    const balanceKnown = !!row && row.balance_cents != null;
    if (!balanceKnown) balanceUnknown += 1;
    if (c.apr == null) aprUnknown += 1;
    return {
      id: c.id,
      lender: c.lender,
      credit_limit: c.creditLimit,                          // null = nobody recorded one
      current_balance: balanceKnown ? c.currentBalance : null,
      balance_known: balanceKnown,
      apr: c.apr                                            // null = unpriced, drawn last
    };
  });

  const withLimit = calculatorCards.filter((c) => c.creditLimit != null).length;

  return {
    calculatorCards,
    summary: {
      source: "tradelines",
      // Closed lines are not read at all (includeClosed:false), so `on_file` is
      // the client's OPEN lines and the exclusion below is installment debt.
      on_file: rows.length,
      considered: withLimit,
      excluded_installment: rows.length - calculatorCards.length,
      excluded_no_credit_limit: calculatorCards.length - withLimit,
      balance_unknown: balanceUnknown,
      apr_unknown: aprUnknown,
      list
    }
  };
}

/* ═══════════════════════════ the explainable lines ═══════════════════════════
 *
 * netCashLines — the same four numbers calcDeal already returned, laid out as
 * the separate lines they are, plus the one line the calculator does not know
 * about.
 *
 * WHY THE LINES ARE SPLIT OUT AT ALL. "The client walks away with $222,000" is a
 * sentence somebody says out loud on a call, and the only defence against saying
 * a wrong one is being able to read the subtraction: this much came in, this
 * much was the fee, this much was the deposit. A single unexplained difference
 * is a number people either trust or ignore, and both are wrong.
 *
 * EXISTING DEBTS ARE NOT IN calcDeal AND THAT IS DELIBERATE. Nothing in this
 * repository stores, bills or schedules a debt payoff — sale_payments has
 * deposit, installment, success_fee and refund and no fifth kind
 * (db/migrations/011_sales.sql:82) — so a payoff is an assumption the operator
 * typed into a box on a screen, not a term of the deal. Putting it inside the
 * calculator would make it look like one, and every other caller of calcDeal
 * would inherit a parameter with nothing behind it. It is subtracted here, in
 * the open, labelled with where it came from, and it is null — not zero — when
 * nobody typed one, because "no payoff was entered" and "the payoff is nothing"
 * are different statements and the screen shows the first as an em dash. */
function netCashLines(deal, { approvedFunding, existingDebts }) {
  const cash = (deal && deal.cashPosition) || null;
  const fee = (cash && cash.fee) || null;
  const net = cash ? cash.netCashToClient : null;

  return {
    approved_funding: approvedFunding,
    success_fee: fee ? fee.total : null,
    fee_from_proceeds: fee ? fee.fromProceeds : null,
    fee_paid_out_of_pocket: fee ? fee.paidDown : null,
    deposit: cash ? cash.deposit : null,
    net_cash_to_client: net,
    existing_debts: existingDebts,
    existing_debts_source: existingDebts == null ? null : "entered_on_this_screen",
    net_cash_after_debts: net == null || existingDebts == null ? null : round2(net - existingDebts)
  };
}
