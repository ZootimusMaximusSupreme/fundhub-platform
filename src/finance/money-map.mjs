// Money Map — one client's whole money picture, assembled once, server-side.
//
// WHAT THIS ANSWERS. Six questions an owner otherwise needs six screens for:
//   1. when is every card payment due
//   2. what bills repeat, across every account
//   3. money in, money out, what is left, over a window
//   4. how hard is each card being leaned on, and the portfolio overall
//   5. what is coming that somebody should act on
//   6. how much could be drawn, and what would a draw cost
//
// WHY A MODULE AND NOT BROWSER JS. Same reason src/finance/os-grid.mjs gives:
// closer-dashboard.html reimplements a funding waterfall in an inline <script>
// against sample rows, and that second implementation is a second answer that
// goes stale. Everything here is computed once, unit-tested without a browser,
// and shipped to the page already formed. public/app/money-map.html renders; it
// decides nothing.
//
//
// THIS MODULE DECIDES ALMOST NOTHING EITHER — AND THAT IS THE POINT.
//
// Every rule below already had an owner, and this file calls that owner rather
// than restating it. Two copies of "a total with holes in it is a floor" would
// drift, and drift is the defect class this repository keeps finding.
//
//   sumKnown / basisOf              src/finance/os-grid.mjs
//   financeOsGrid                   src/finance/os-grid.mjs
//   bankingSurface                  src/finance/banking-surface.mjs
//   evaluateUtilization             src/alerts/evaluate.mjs
//   project                         src/banking/cashflow.mjs
//   toCashflowBills                 src/banking/cashflow-seam.mjs
//   calcFunding                     src/calculators/deal-funding.mjs
//   toCalculatorCards               src/tradelines/index.mjs
//   readDate                        src/liabilities/index.mjs
//   fromCents                       src/commissions/money.mjs
//   incomeInflows                   src/banking/income.mjs (money coming in)
//
// What this file adds is the JOIN, the ATTRIBUTION, and the ABSENCES.
//
//
// ATTRIBUTION IS A HARD REQUIREMENT, NOT A NICETY.
//
// Three separate engines in this repository have an opinion about utilization
// and they do not agree, on purpose:
//
//   * src/alerts/evaluate.mjs   compares in integers, rounds to 4dp, and returns
//                               `over: null` when ANY line is unknown, because an
//                               unknown line can move the aggregate either way.
//   * src/finance/os-grid.mjs   returns a display string and a basis, and marks
//                               a partial total as a floor.
//   * src/calculators/deal-funding.mjs rounds to 2dp and measures the DELTA a
//                               draw causes rather than the absolute level.
//
// A screen that printed "utilization" once, unlabelled, would be picking one of
// three answers at random. So every utilization reading in this payload carries
// an `engine` id and an `engine_label`, and the screen prints the label next to
// the number. Same for alerts, which come from two places that must not be
// confused: rows already stored in `cashflow_reminders`, and outflows the
// projection placed on days inside the window.
//
//
// NULL MEANS UNKNOWN AND MUST SURVIVE TO THE SCREEN.
//
// Every money figure is carried twice: `*_cents` (integer or null) and a
// `*_display` string produced by fromCents(). A null display renders as an em
// dash, never as "0.00". `fromCents` RETURNS A STRING — nothing in this file
// does arithmetic on its output, and the integer field beside it is what any
// caller should compute with.
//
//
// PURE. No I/O, no clock, no randomness. `asOf` is a parameter. Everything here
// is therefore testable without Postgres and without a browser, which is the
// only reason any of it can be trusted.

import { fromCents } from "../commissions/money.mjs";
import { sumKnown, basisOf, financeOsGrid } from "./os-grid.mjs";
import { bankingSurface } from "./banking-surface.mjs";
import { evaluateUtilization, DEFAULT_UTILIZATION_THRESHOLD } from "../alerts/evaluate.mjs";
import { toCalculatorCards } from "../tradelines/index.mjs";
import { calcFunding } from "../calculators/deal-funding.mjs";
import { project } from "../banking/cashflow.mjs";
import { toCashflowBills } from "../banking/cashflow-seam.mjs";
import { readDate } from "../liabilities/index.mjs";
import { incomeInflows } from "../banking/income.mjs";

/* Which engine said what. The screen prints these strings verbatim next to the
   numbers they produced. Module paths are IN the label deliberately: when two
   engines disagree, the next person needs to know which file to open, and
   "Alerts engine" alone does not tell them that. */
export const ENGINES = Object.freeze({
  alerts: "Alerts engine — src/alerts/evaluate.mjs",
  finance_os_grid: "Finance OS grid — src/finance/os-grid.mjs",
  funding: "Funding calculator — src/calculators/deal-funding.mjs",
  cashflow: "Cash-flow projection — src/banking/cashflow.mjs",
  reminders: "Stored reminders — cashflow_reminders (src/banking/reminders.mjs)",
  liabilities: "Card liabilities — card_liabilities table (migration 083)",
  recurring: "Recurring-bill detector — recurring_bills (src/banking/recurring.mjs)",
  banking_surface: "Banking surface — src/finance/banking-surface.mjs",
  income: "Repeat-income finder — src/banking/income.mjs"
});

const engine = (id) => ({ engine: id, engine_label: ENGINES[id] });

/* ------------------------------------------------------------------ *
 * Readers. Every one of these turns "absent" into null, never into 0.
 * ------------------------------------------------------------------ */

/* pg hands back bigint as a STRING and numeric as a string. Anything that is
   not a finite number after conversion is UNKNOWN, not zero. Same reader
   os-grid.mjs and banking-surface.mjs use, restated here rather than exported
   from one of them because it is four lines and importing a private helper
   across three modules is a worse coupling than three copies of a rounding. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/* cents -> a 2dp display string, or null. NULL NEVER RENDERS AS "0.00": an
   unknown figure printed as zero is a wrong answer wearing a plausible face. */
const money = (c) => (c === null ? null : fromCents(c));

/* A money field in both forms at once, so a caller never has to choose between
   "the number I can add up" and "the string I can print". */
const amount = (c) => ({ cents: c, display: money(c) });

const int = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/* Whole days since the epoch, from a 'YYYY-MM-DD' string. Ordering and
   differencing only — never rendered. Returns null for anything unparseable,
   because an unreadable due date is an unknown due date. */
function dayNumber(iso) {
  if (typeof iso !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/** 'YYYY-MM-DD' n days after another. Used only to name the end of the window. */
function addDays(iso, n) {
  const d = dayNumber(iso);
  if (d === null) return null;
  return new Date((d + n) * 86_400_000).toISOString().slice(0, 10);
}

/* A bureau account reference is an account number fragment on some files and a
   full one on others. 081 stores a mask and nothing else BY DESIGN; `tradelines`
   has no such rule, so this screen shows the last four and never the whole
   string. A read endpoint should not be the place a full account number first
   reaches a browser. */
function maskRef(ref) {
  const s = text(ref);
  if (s === null) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 4) return `••${digits.slice(-4)}`;
  return s.length <= 4 ? s : `••${s.slice(-4)}`;
}

/* DEPOSITORY ONLY, AND NULL IS NOT DEPOSITORY.
 *
 * A credit line's "available" balance is HEADROOM, not cash, and 081's own
 * column comment says a default of 'depository' "would quietly turn an
 * unclassified line of credit into cash on hand". So an account whose type the
 * bank never told us is excluded and COUNTED, not assumed. Exported so the test
 * asserts the predicate rather than a behaviour three layers downstream. */
export const DEPOSITORY = (a) => a?.account_type === "depository";

/**
 * billRowToDetected — a stored `recurring_bills` row → the camelCase shape
 * `src/banking/cashflow-seam.mjs` expects.
 *
 * WHY THIS EXISTS. `toBillRow()` in src/banking/recurring.mjs is the camel→snake
 * writer; nothing in the repository does the reverse, and `listRecurringBills()`
 * returns raw rows. Building the object inline at the call site would put the
 * field mapping in a place no test could reach.
 *
 * `anchorDayOfMonth` IS THE ONE FIELD THAT MATTERS MOST HERE. Migration 090 added
 * the column the detector's value had nowhere to go; before it, this mapper had
 * to leave the key absent and the seam fell back to the day-of-month of
 * `next_expected_on` — which for a bill charged on the 31st is itself a clamped
 * 30th, pinning that bill to the 30th forever.
 *
 * It is passed through as `null` when the column is null rather than omitted, and
 * the seam's `?? first.d` fallback then does exactly what it did before. That is
 * correct for the two cases where null is the right answer: a weekly or biweekly
 * bill has no day-of-month, and a row written before 090 has not been re-detected
 * yet. Neither is made worse; a monthly bill written since 090 is made right.
 */
export function billRowToDetected(row) {
  return {
    bankAccountId: text(row?.bank_account_id),
    clientId: text(row?.client_id),
    merchantKey: text(row?.merchant_key),
    merchantDisplay: text(row?.merchant_display),
    cadence: text(row?.cadence),
    typicalAmountCents: cents(row?.typical_amount_cents),
    nextExpectedDate: readDate(row?.next_expected_on),
    nextExpectedUnknownReason: text(row?.next_expected_unknown_reason),
    anchorDayOfMonth: int(row?.anchor_day_of_month),
    confidencePct: int(row?.confidence_pct),
    confidenceLabel: text(row?.confidence_label),
    isBusiness: row?.is_business === null || row?.is_business === undefined ? null : Boolean(row.is_business),
    occurrenceCount: int(row?.occurrence_count),
    firstSeenOn: readDate(row?.first_seen_on),
    lastSeenOn: readDate(row?.last_seen_on)
  };
}

/* ------------------------------------------------------------------ *
 * 1. Cards — when is every payment due
 * ------------------------------------------------------------------ */

function cardsSection(tradelines, liabilities, asOf) {
  const byTradeline = new Map();
  for (const l of liabilities) {
    const k = text(l?.tradeline_id);
    if (k !== null) byTradeline.set(k, l);
  }

  const today = dayNumber(asOf);

  const rows = tradelines.map((t) => {
    const l = byTradeline.get(text(t?.id)) ?? null;
    const due = l ? readDate(l.payment_due_date) : null;
    const dueDay = dayNumber(due);

    const limitCents = cents(t?.credit_limit_cents);
    const balanceCents = cents(t?.balance_cents);

    /* THE PER-CARD UTILIZATION IS THE ALERTS ENGINE'S, AND IT IS LABELLED AS
       SUCH. The row is handed over whole because readLine() already knows both
       the cents and the dollar shapes; re-deriving balance/limit here would be
       the second answer this module exists to avoid. */
    const util = evaluateUtilization(t);

    return {
      tradeline_id: text(t?.id),
      liability_id: l ? text(l.id) : null,
      lender: text(t?.lender),
      kind: text(t?.kind),
      ref_mask: maskRef(t?.account_ref),
      closed: Boolean(t?.closed_at),

      /* NO LIABILITY ROW IS A STATE THE SCREEN MUST SAY OUT LOUD. It means
         nobody has ingested a statement position for this card — which is not
         "nothing is due". */
      has_liability: Boolean(l),
      liability_as_of: l ? readDate(l.as_of) : null,
      liability_source: l ? text(l.source) : null,

      due_date: due,
      days_until_due: dueDay === null || today === null ? null : dueDay - today,
      overdue: dueDay === null || today === null ? null : dueDay < today,

      minimum_payment: amount(l ? cents(l.minimum_payment_cents) : null),
      statement_balance: amount(l ? cents(l.statement_balance_cents) : null),
      current_balance: amount(l ? cents(l.current_balance_cents) : null),
      past_due: amount(l ? cents(l.past_due_cents) : null),
      last_payment: amount(l ? cents(l.last_payment_cents) : null),
      last_payment_date: l ? readDate(l.last_payment_date) : null,
      statement_date: l ? readDate(l.statement_date) : null,
      payment_status: l ? text(l.payment_status) : null,

      /* From `tradelines`, not from the liability row. 083's header is explicit
         that it stores no limit and no utilization, and that the facility's
         limit is reached through `tradeline_id`. */
      credit_limit: amount(limitCents),
      line_balance: amount(balanceCents),

      utilization: {
        ...engine("alerts"),
        known: util.known,
        reason: util.reason,
        pct: util.utilizationPct,
        over: util.over,
        threshold: util.threshold,
        headroom: amount(util.headroomCents ?? null)
      }
    };
  });

  const withDue = rows.filter((r) => r.due_date !== null);
  const minimums = rows.map((r) => r.minimum_payment.cents);
  const minSum = sumKnown(minimums);

  return {
    ...engine("liabilities"),
    rows,
    cards: rows.length,
    with_due_date: withDue.length,
    without_due_date: rows.length - withDue.length,
    without_liability_row: rows.filter((r) => !r.has_liability).length,
    overdue: rows.filter((r) => r.overdue === true).length,

    /* A FLOOR, NOT A TOTAL, whenever a card did not report a minimum. The basis
       says how many were counted and the screen puts a "+" on it. A card whose
       minimum is unknown does NOT contribute zero. */
    minimum_payments_total: {
      ...amount(minSum.total),
      basis: basisOf(minSum, rows.length)
    }
  };
}

/* ------------------------------------------------------------------ *
 * 2. Bills — what repeats, across every account
 * ------------------------------------------------------------------ */

function billsSection(billRows, bankAccounts, projection) {
  const acctById = new Map(bankAccounts.map((a) => [text(a?.id), a]));

  /* The projection is the authority on what actually lands inside the window.
     Counting occurrences a second time here would be a second answer; instead
     the components the projection placed are indexed by the seam's own billId
     so each stored bill can say how many times it lands and for how much. */
  const placed = new Map();
  if (projection?.ok === true) {
    for (const day of projection.days ?? []) {
      for (const c of day.components) {
        if (c.direction !== "out" || c.kind !== "bill") continue;
        const cur = placed.get(c.sourceId) ?? { count: 0, cents: 0, dates: [] };
        cur.count += 1;
        cur.cents += c.amountCents;
        cur.dates.push(day.date);
        placed.set(c.sourceId, cur);
      }
    }
  }

  const rows = billRows.map((r) => {
    const b = billRowToDetected(r);
    const acct = acctById.get(b.bankAccountId) ?? null;
    const billId = `${b.bankAccountId}:${b.merchantKey}:${b.cadence}`;
    const hit = placed.get(billId) ?? null;

    /* 086's CHECK makes typical_amount_cents NEGATIVE — a bill is an outflow.
       The magnitude is what a person reads, and the sign is stated in words
       rather than shown as a minus somebody has to interpret. */
      const magnitude = b.typicalAmountCents === null ? null : Math.abs(b.typicalAmountCents);

    return {
      id: text(r?.id),
      bill_key: billId,
      merchant: b.merchantDisplay || b.merchantKey,
      merchant_key: b.merchantKey,
      cadence: b.cadence,
      direction: "out",
      typical_amount: amount(magnitude),
      next_expected_on: b.nextExpectedDate,
      /* EXACTLY ONE OF THESE IS SET — 086 enforces it. A null date carries the
         detector's own reason string and the screen prints the reason instead of
         a date, rather than leaving the cell blank. */
      next_expected_unknown_reason: b.nextExpectedUnknownReason,
      confidence_pct: b.confidencePct,
      confidence_label: b.confidenceLabel,
      occurrence_count: b.occurrenceCount,
      first_seen_on: b.firstSeenOn,
      last_seen_on: b.lastSeenOn,
      is_business: b.isBusiness,

      bank_account_id: b.bankAccountId,
      /* An account this client's `bank_accounts` rows do not cover. It happens:
         086 gives `bank_account_id` NO foreign key, on purpose. Saying so beats
         printing a bare uuid. */
      account_label: acct ? (text(acct.name) || text(acct.official_name)) : null,
      account_mask: acct ? text(acct.mask) : null,
      account_on_file: Boolean(acct),

      in_window: hit ? hit.count : 0,
      in_window_total: amount(hit ? hit.cents : null),
      in_window_dates: hit ? hit.dates : []
    };
  });

  const accounts = new Set(rows.map((r) => r.bank_account_id).filter((v) => v !== null));

  return {
    ...engine("recurring"),
    rows,
    bills: rows.length,
    accounts_covered: accounts.size,
    accounts_not_on_file: rows.filter((r) => !r.account_on_file).length,
    without_next_date: rows.filter((r) => r.next_expected_on === null).length
  };
}

/* ------------------------------------------------------------------ *
 * 3. Cash flow — in, out, what is left, over a window
 * ------------------------------------------------------------------ */

/* The census the screen prints when the projection pools more than one kind of
   money. It is NOT a combined balance — banking-surface.mjs refuses to produce
   one of those and that refusal is kept. It is a statement about whose accounts
   were in the arithmetic, which is exactly what makes the pooling honest. */
function entityCensus(accounts) {
  const c = { personal: 0, business: 0, unknown: 0 };
  for (const a of accounts) {
    const k = a.entity_kind;
    if (k === "personal" || k === "business") c[k] += 1;
    else c.unknown += 1;
  }
  return c;
}

function cashflowSection(projection, used, skipped, asOf, horizonDays) {
  const census = entityCensus(used);
  const kinds = Object.keys(census).filter((k) => census[k] > 0);

  const base = {
    ...engine("cashflow"),
    as_of: asOf,
    horizon_days: horizonDays,
    window: { from: asOf, to: addDays(asOf, horizonDays - 1) },
    accounts_used: used.map((a) => ({
      id: a.id,
      label: a.label,
      entity_kind: a.entity_kind,
      /* Carried per account, not just as a count, so a reader can see WHICH of
         the balances in this projection is not a real bank read. */
      provider: a.provider,
      balance: amount(a.balanceCents)
    })),
    accounts_skipped: skipped,
    entity_census: census,
    /* THE ONE SENTENCE THE SCREEN MUST PRINT WHEN THIS IS TRUE. Unknown money is
       never folded into personal; when both are in the pool, the pool is named
       as a pool and not as the client's cash. */
    mixes_entity_kinds: kinds.length > 1,
    ok: projection?.ok === true,
    reason: projection?.ok === true ? null : (projection?.reason ?? null)
  };

  if (projection?.ok !== true) {
    return {
      ...base,
      opening: amount(null),
      total_in: amount(null),
      total_out_committed: amount(null),
      total_out_unconfirmed: amount(null),
      net: amount(null),
      closing: amount(null),
      lowest: null,
      worst_case_lowest: null,
      days: [],
      blind_spots: projection?.blindSpots ?? [],
      excluded: projection?.excluded ?? [],
      unconfirmed: projection?.unconfirmed ?? [],
      threshold_gaps: projection?.thresholdGaps ?? []
    };
  }

  /* Summed from the projection's own per-day components, in integer cents.
     project() already did the day arithmetic; this only rolls the days up, so
     there is no second model of the month here. */
  let inCents = 0;
  let outCommitted = 0;
  let outUnconfirmed = 0;
  for (const d of projection.days) {
    inCents += d.inflowCents;
    outCommitted += d.committedOutflowCents;
    outUnconfirmed += d.unconfirmedOutflowCents;
  }

  const closing = projection.days.length
    ? projection.days[projection.days.length - 1].closingCents
    : projection.openingBalanceCents;

  return {
    ...base,
    opening: amount(projection.openingBalanceCents),
    total_in: amount(inCents),
    total_out_committed: amount(outCommitted),
    total_out_unconfirmed: amount(outUnconfirmed),
    net: amount(inCents - outCommitted),
    closing: amount(closing),
    lowest: {
      ...amount(projection.lowestClosingCents),
      date: projection.lowestClosingDate
    },
    worst_case_lowest: {
      ...amount(projection.lowestWorstCaseClosingCents),
      date: projection.lowestWorstCaseClosingDate
    },
    days: projection.days.map((d) => ({
      date: d.date,
      in: amount(d.inflowCents),
      out_committed: amount(d.committedOutflowCents),
      out_unconfirmed: amount(d.unconfirmedOutflowCents),
      closing: amount(d.closingCents),
      worst_case_closing: amount(d.worstCaseClosingCents),
      below_zero: d.belowZero,
      worst_case_below_zero: d.worstCaseBelowZero,
      moves: d.components.map((c) => ({
        direction: c.direction,
        kind: c.kind,
        label: c.label,
        certainty: c.certainty,
        amount: amount(c.amountCents)
      }))
    })),
    /* NAMED ABSENCES, CARRIED THROUGH RATHER THAN SWALLOWED. A blind spot is a
       card whose size or date is unknown; an exclusion is a movement dated
       outside the window; a threshold gap is a policy number nobody has set. All
       three change how much the bottom line is worth and all three are printed. */
    blind_spots: projection.blindSpots ?? [],
    excluded: projection.excluded ?? [],
    unconfirmed: projection.unconfirmed ?? [],
    threshold_gaps: projection.thresholdGaps ?? []
  };
}

/* ------------------------------------------------------------------ *
 * 4. Utilization — three engines, each named
 * ------------------------------------------------------------------ */

function utilizationSection(tradelines, grid, threshold, funding) {
  const agg = evaluateUtilization(tradelines, { threshold });
  const gridRow = (grid.rows ?? []).find((r) => r.key === "utilization") ?? null;

  const overall = [
    {
      ...engine("alerts"),
      pct: agg.utilizationPct,
      over: agg.over,
      threshold: agg.threshold,
      partial: agg.partial,
      reason: agg.reason,
      lines: agg.lines,
      /* The measurable slice, under a name that cannot be mistaken for the
         whole. evaluate.mjs returns `over: null` on partial data on purpose. */
      known_portion: agg.knownPortion
        ? { pct: agg.knownPortion.utilizationPct, over: agg.knownPortion.over }
        : null,
      note:
        agg.partial === true
          ? "Some cards did not report a limit or a balance. An unknown card can move the total either way, so there is no whole-portfolio answer — only the part that is measurable."
          : null
    },
    {
      ...engine("finance_os_grid"),
      display: gridRow ? gridRow.display : null,
      basis: gridRow ? gridRow.basis : null,
      note: gridRow && gridRow.basis?.partial
        ? "Counted only the lines that reported both numbers — this is a floor."
        : null
    }
  ];

  if (funding?.guardrail) {
    overall.push({
      ...engine("funding"),
      pct_before: funding.guardrail.aggregateUtilizationBefore === null
        ? null
        : funding.guardrail.aggregateUtilizationBefore * 100,
      pct_after: funding.guardrail.aggregateUtilization === null
        ? null
        : funding.guardrail.aggregateUtilization * 100,
      threshold: funding.guardrail.threshold,
      breaches: funding.guardrail.aggregateBreaches,
      hard_stop: funding.guardrail.hardStop,
      note: "Measures what the requested draw would DO to utilization, not where it stands today."
    });
  }

  /* Per card. The alerts engine names a line by its tradeline id; calcFunding's
     draws carry only a lender, because toCalculatorCards() does not thread the
     id into the draw. So a funding reading is matched to a card by lender, and
     ONLY when that lender is unique among the drawable cards. An ambiguous match
     is reported as ambiguous rather than attached to whichever card sorted
     first — attributing a number to the wrong card is worse than not attaching
     it. */
  const lenderCounts = new Map();
  for (const t of tradelines) {
    const k = text(t?.lender);
    if (k !== null) lenderCounts.set(k, (lenderCounts.get(k) ?? 0) + 1);
  }
  const fundingByLender = new Map();
  const ambiguous = [];
  for (const c of funding?.guardrail?.perCard ?? []) {
    const k = text(c.lender);
    if (k === null || lenderCounts.get(k) !== 1) {
      ambiguous.push({
        lender: k,
        reason:
          k === null
            ? "the funding calculator returned a card with no lender name, so it cannot be matched to a credit line"
            : "more than one credit line carries this lender name, so this reading cannot be attached to one card without guessing"
      });
      continue;
    }
    fundingByLender.set(k, c);
  }

  const perCard = tradelines.map((t) => {
    const one = evaluateUtilization(t, { threshold });
    const readings = [
      {
        ...engine("alerts"),
        pct: one.utilizationPct,
        over: one.over,
        known: one.known,
        reason: one.reason
      }
    ];
    const f = fundingByLender.get(text(t?.lender));
    if (f) {
      readings.push({
        ...engine("funding"),
        pct_before: f.utilizationBefore === null ? null : f.utilizationBefore * 100,
        pct_after: f.utilizationAfter === null ? null : f.utilizationAfter * 100,
        caused_breach: f.causedBreach,
        pre_existing_over: f.preExistingOver
      });
    }
    return {
      tradeline_id: text(t?.id),
      lender: text(t?.lender),
      readings
    };
  });

  return { overall, per_card: perCard, unmatched_funding_readings: ambiguous, threshold: agg.threshold };
}

/* ------------------------------------------------------------------ *
 * 5. Alerts — two sources, never merged into one anonymous list
 * ------------------------------------------------------------------ */

function alertsSection(reminderRows, projection, cards, utilization, asOf) {
  const rows = [];

  /* (a) Rows already stored. These were written by a run of recordReminders()
         through createReminder(); this endpoint reads them and CHANGES NOTHING —
         reading a reminder is not delivering it, and nothing here stamps a
         surfaced_at. */
  for (const r of reminderRows) {
    rows.push({
      ...engine("reminders"),
      id: text(r?.id),
      kind: text(r?.reminder_kind),
      subject_kind: text(r?.subject_kind),
      subject_label: text(r?.subject_label),
      body: text(r?.body),
      at: r?.surface_at ?? null,
      acknowledged: Boolean(r?.acknowledged_at)
    });
  }

  /* (b) What is coming inside the window, taken from the projection's own
         placed components. NOT re-derived from the due dates and the bill
         cadences — that would be a second calendar, and two calendars disagree
         the first time one of them is fixed. */
  if (projection?.ok === true) {
    for (const day of projection.days ?? []) {
      for (const c of day.components) {
        if (c.direction !== "out") continue;
        rows.push({
          ...engine("cashflow"),
          id: null,
          kind: c.kind === "card_minimum" ? "card_payment_due" : "bill_due",
          subject_kind: c.kind === "card_minimum" ? "card_liability" : "recurring_bill",
          subject_label: c.label,
          body:
            c.kind === "card_minimum"
              ? `Card minimum of ${fromCents(c.amountCents)} lands on ${day.date}.`
              : `Bill of ${fromCents(c.amountCents)} expected on ${day.date}` +
                (c.certainty === "confirmed" ? "." : " — the detector is not certain about this one."),
          at: day.date,
          amount: amount(c.amountCents),
          certainty: c.certainty,
          acknowledged: false
        });
      }
    }
  }

  /* (c) Cards already past their due date, with nothing in this window to say
         so — the projection deliberately refuses to place a movement dated
         before it starts, because "whether it was paid is not this module's
         call". That refusal is correct and it also means an overdue card would
         otherwise be invisible here. */
  for (const c of cards.rows) {
    if (c.overdue !== true) continue;
    rows.push({
      ...engine("liabilities"),
      id: null,
      kind: "payment_due_date_passed",
      subject_kind: "card_liability",
      subject_label: c.lender ?? "Unnamed card",
      body: `The payment due date on this card was ${c.due_date}, which has passed. Whether it was paid is not recorded anywhere this screen can read.`,
      at: c.due_date,
      acknowledged: false
    });
  }

  /* (d) The utilization verdict, from the alerts engine and labelled as such.
         Only when the engine actually decided — `over: null` means unknown, and
         an unknown is not an alert. */
  const alertsOverall = utilization.overall.find((u) => u.engine === "alerts");
  if (alertsOverall && alertsOverall.over === true) {
    rows.push({
      ...engine("alerts"),
      id: null,
      kind: "utilization_threshold",
      subject_kind: null,
      subject_label: "Whole portfolio",
      body: `Credit utilization is ${alertsOverall.pct}%, above the ${Math.round((alertsOverall.threshold ?? 0) * 100)}% line.`,
      at: asOf,
      acknowledged: false
    });
  }

  rows.sort((a, b) => String(a.at ?? "").localeCompare(String(b.at ?? "")));

  return {
    rows,
    count: rows.length,
    by_engine: rows.reduce((acc, r) => {
      acc[r.engine] = (acc[r.engine] ?? 0) + 1;
      return acc;
    }, {})
  };
}

/* ------------------------------------------------------------------ *
 * 6. Funding
 * ------------------------------------------------------------------ */

function fundingSection(tradelines, requestedAmount, threshold, grid) {
  const cards = toCalculatorCards(tradelines);
  const result = calcFunding({
    cards,
    requestedAmount: requestedAmount ?? undefined,
    utilizationThreshold: threshold ?? DEFAULT_UTILIZATION_THRESHOLD
  });

  /* THE CAVEAT THAT MATTERS AND WOULD OTHERWISE BE INVISIBLE.
     toCalculatorCards() maps an unknown balance to 0, so calcFunding reads a
     card with a known limit and an unknown balance as fully available. That
     OVERSTATES what can be drawn. It is counted here and printed on the screen
     next to the grid's conservative figure, which is null when either side is
     unknown. Not fixed here: changing toCalculatorCards() moves a number the
     closer dashboard already says out loud, and that is not this unit's call. */
  const drawable = tradelines.filter((t) => t && !t.closed_at && t.kind !== "installment");
  const unknownBalance = drawable.filter((t) => cents(t.balance_cents) === null).length;
  const unknownLimit = drawable.filter((t) => cents(t.credit_limit_cents) === null).length;

  const caveats = [];
  if (unknownBalance > 0) {
    caveats.push({
      code: "balance_unknown_read_as_zero",
      count: unknownBalance,
      note: `${unknownBalance} card(s) have no reported balance. The funding calculator reads an unknown balance as zero, so the headroom below is HIGHER than what can really be drawn.`
    });
  }
  if (unknownLimit > 0) {
    caveats.push({
      code: "limit_unknown_card_dropped",
      count: unknownLimit,
      note: `${unknownLimit} card(s) have no reported credit limit and were left out of the funding maths entirely.`
    });
  }

  const gridAvailable = (grid.rows ?? []).find((r) => r.key === "available") ?? null;

  return {
    ...engine("funding"),
    /* Named on the page. The brief called this "W5's UnderwriteIQ adapter";
       there is no such adapter in this repository. Saying which file produced
       the numbers is the only way a reader can check them. */
    requested_amount: requestedAmount ?? null,
    cards_considered: cards.length,
    cards_excluded_closed_or_installment: tradelines.length - drawable.length,
    total_available_credit: result.totalAvailableCredit,
    allocation: result.allocation,
    pay_method_comparison: result.payMethodComparison,
    guardrail: result.guardrail,
    caveats,
    conservative_available: gridAvailable
      ? {
          ...engine("finance_os_grid"),
          display: gridAvailable.display,
          basis: gridAvailable.basis
        }
      : null
  };
}

/* ------------------------------------------------------------------ *
 * The assembler
 * ------------------------------------------------------------------ */

/**
 * moneyMap — every already-fetched row for one client → the whole screen.
 *
 * @param {object}   input
 * @param {string}   input.asOf            'YYYY-MM-DD'. Required. There is no clock in here.
 * @param {number}   input.horizonDays     how many days forward, including asOf. Required.
 * @param {Array}    [input.tradelines]    `tradelines` rows (include closed — they are counted, not summed)
 * @param {Array}    [input.liabilities]   `card_liabilities` rows
 * @param {Array}    [input.bankAccounts]  `bank_accounts` rows
 * @param {Array}    [input.recurringBills] `recurring_bills` rows
 * @param {Array}    [input.reminders]     `cashflow_reminders` rows, already filtered to due+unacknowledged
 * @param {number|null} [input.utilizationThreshold] decimal fraction (0.30 = 30%). Omit for the
 *                                          alerts engine's default; pass null for
 *                                          "configured but unset", which yields UNKNOWN.
 * @param {number|null} [input.requestedAmount] dollars, for the funding waterfall. Omit for none.
 * @param {object}   [input.thresholds]   the org's `cashflow_settings`, as
 *                                        src/banking/settings.mjs loadThresholds()
 *                                        returns it. An ABSENT key means unset, and
 *                                        project() reports it as a gap rather than
 *                                        substituting a number nobody chose.
 * @param {object|null} [input.income]   src/banking/income.mjs loadIncome() output.
 *                                        Omit (or null) and money coming in is not
 *                                        modelled — the plain worst case, as before.
 *
 * @returns {object} the payload public/app/money-map.html renders.
 */
export function moneyMap({
  asOf,
  horizonDays,
  tradelines = [],
  liabilities = [],
  bankAccounts = [],
  recurringBills = [],
  reminders = [],
  utilizationThreshold,
  requestedAmount = null,
  thresholds = {},
  income = null
} = {}) {
  if (typeof asOf !== "string" || dayNumber(asOf) === null) {
    throw new TypeError(`moneyMap: asOf must be a 'YYYY-MM-DD' date, got ${JSON.stringify(asOf)}`);
  }
  if (!Number.isSafeInteger(horizonDays) || horizonDays < 1) {
    throw new TypeError(
      `moneyMap: horizonDays must be a whole number of days, at least 1, got ${JSON.stringify(horizonDays)}`
    );
  }

  const tl = (Array.isArray(tradelines) ? tradelines : []).filter((r) => r && typeof r === "object");
  const li = (Array.isArray(liabilities) ? liabilities : []).filter((r) => r && typeof r === "object");
  const ba = (Array.isArray(bankAccounts) ? bankAccounts : []).filter((r) => r && typeof r === "object");
  const rb = (Array.isArray(recurringBills) ? recurringBills : []).filter((r) => r && typeof r === "object");
  const rm = (Array.isArray(reminders) ? reminders : []).filter((r) => r && typeof r === "object");

  const windowTo = addDays(asOf, horizonDays - 1);

  /* Balances, grouped and never combined. bankingSurface() owns "unknown is not
     personal" and "there is no combined total across groups". This screen shows
     its groups exactly as it produces them. */
  const balances = bankingSurface(ba);

  /* The seven credit numbers, from the module that owns them. Closed lines are
     excluded by the grid's own DRAWABLE filter, so the full row set is handed
     over rather than a pre-filtered one. */
  const grid = financeOsGrid(tl);

  /* ---- what feeds the projection ---- */
  const openDepository = ba.filter((a) => DEPOSITORY(a) && !a.closed_at);
  const skipped = ba
    .filter((a) => !(DEPOSITORY(a) && !a.closed_at))
    .map((a) => ({
      id: text(a.id),
      label: text(a.name) || text(a.official_name) || "Unnamed account",
      account_type: text(a.account_type),
      reason: a.closed_at
        ? "the account is closed"
        : a.account_type === null || a.account_type === undefined
          ? "the bank never said what kind of account this is, and an unclassified account is not treated as cash"
          : `a '${a.account_type}' account is not cash — a credit line's available balance is headroom, not money in the bank`
    }));

  const usedAccounts = openDepository.map((a) => ({
    id: text(a.id),
    label: text(a.name) || text(a.official_name) || "Unnamed account",
    entity_kind: a.entity_kind === "personal" || a.entity_kind === "business" ? a.entity_kind : "unknown",
    /* WHERE THE FIGURE CAME FROM. 091 makes this NOT NULL with a CHECK, so a row
       cannot lose it. A pre-091 database has no column and every row reads as
       'manual', which is what those rows are. */
    provider: text(a.provider) || "manual",
    balanceCents: cents(a.current_balance_cents)
  }));

  /* NOT-REAL MONEY, COUNTED AND NAMED. The mock provider exists so the account
     writer could be built before Plaid is turned on, and its rows land in the
     same table a real read would. A made-up balance a screen cannot tell apart
     from a bank read is the worst thing that could be on this page, so the count
     travels with the payload and the screen prints a warning whenever it is
     above zero. */
  const mockAccounts = ba.filter((a) => text(a.provider) === "mock");

  /* Bills → dated occurrences, through the seam that owns the sign flip, the
     confidence rescale and the recurrence expansion. Candidates (low confidence)
     are left out by default and the seam reports them as skipped. */
  let seam = { recurringBills: [], skipped: [] };
  let seamError = null;
  try {
    seam = toCashflowBills({ bills: rb.map(billRowToDetected), candidates: [] }, {
      from: asOf,
      to: windowTo
    });
  } catch (e) {
    /* A stored row the seam refuses (an unknown cadence, an unparseable stored
       date) must not take the whole screen down — the cards, the balances and
       the utilization are all still readable. The refusal is reported. */
    seamError = { message: e.message };
  }

  /* Card minimums, for the projection. A card with a due date and no minimum is
     a BLIND SPOT inside project(), which is exactly the treatment it deserves —
     something is owed and its size is unknown. */
  const cardLiabilities = li.map((l) => ({
    liabilityId: text(l.id),
    label:
      text(tl.find((t) => text(t.id) === text(l.tradeline_id))?.lender) ||
      `Card ${maskRef(l.tradeline_id) ?? ""}`.trim(),
    dueDate: readDate(l.payment_due_date),
    minimumPaymentCents: cents(l.minimum_payment_cents),
    statementBalanceCents: cents(l.statement_balance_cents),
    statementClose: readDate(l.statement_date)
  }));

  /* MONEY COMING IN, WHEN IT IS KNOWN. Counted repeat deposits on the accounts
     this projection opens from, placed on their paydays inside the window.
     Only one the org's confidence floor calls sure is `confirmed`; project()
     counts an unconfirmed inflow in neither track, so a maybe-paycheck never
     makes the careful line hopeful. Merchant payouts have no payday and stay
     off the calendar. */
  const inflows = incomeInflows(income, {
    from: asOf,
    to: windowTo,
    confidenceFloor: thresholds && typeof thresholds === "object" ? thresholds.confidenceFloor : undefined,
    accountIds: usedAccounts.map((a) => a.id)
  });

  let projection = null;
  let projectionError = null;
  if (usedAccounts.length === 0) {
    projection = {
      ok: false,
      reason: {
        code: "NO_DEPOSITORY_ACCOUNTS",
        message:
          "There are no open depository (chequing / savings) accounts on file for this client, so there is no cash balance to project from. A credit line's available balance is headroom, not cash, and is deliberately not used here.",
        details: {}
      },
      blindSpots: [],
      excluded: [],
      unconfirmed: [],
      thresholdGaps: []
    };
  } else {
    try {
      projection = project({
        balances: usedAccounts.map((a) => ({
          accountId: a.id,
          label: a.label,
          balanceCents: a.balanceCents
        })),
        expectedInflows: inflows,
        recurringBills: seam.recurringBills,
        cardLiabilities,
        now: asOf,
        horizonDays,
        /* THE ORG'S CONFIGURED THRESHOLDS, NOT A NUMBER THIS FILE PICKED.
           An earlier version passed cashflow-seam's PRESENTABLE_CONFIDENCE_FLOOR
           (0.55) here, and that was wrong in a way migration 089 spells out at
           length: 0.55 answers "is this safe to SHOW a person as a bill", and
           project()'s confidenceFloor answers the stronger "is this certain
           enough to treat as MONEY THAT IS DEFINITELY LEAVING". Using the lower
           number put every `medium` bill in the committed track, overstating
           what is going out. The configured value (089 set it to 0.750, the
           detector's own `high` band) is the one that answers this question.

           An ABSENT confidenceFloor is passed through absent, NOT replaced:
           project() then reports it as a threshold gap, which is what an org
           that has decided nothing deserves to be told. */
        thresholds
      });
    } catch (e) {
      projectionError = { message: e.message };
      projection = {
        ok: false,
        reason: {
          code: "PROJECTION_REFUSED",
          message: `The cash-flow projection could not be built: ${e.message}`,
          details: {}
        },
        blindSpots: [],
        excluded: [],
        unconfirmed: [],
        thresholdGaps: []
      };
    }
  }

  const cards = cardsSection(tl, li, asOf);
  const bills = billsSection(rb, ba, projection);
  const cashflow = cashflowSection(projection, usedAccounts, skipped, asOf, horizonDays);
  const funding = fundingSection(tl, requestedAmount, utilizationThreshold, grid);
  const utilization = utilizationSection(tl, grid, utilizationThreshold, funding);
  const alerts = alertsSection(rm, projection, cards, utilization, asOf);

  /* WHAT MONEY COMING IN IS MODELLED, SAID OUT LOUD EITHER WAY.
     src/banking/income.mjs finds repeat deposits. When it was read and placed
     at least one payday in this window, the note says how many and which of
     them move the balance. When it was not — no income read was passed, the
     read failed, or nothing repeating was found — `expectedInflows` is empty,
     the projection's "money in" is 0 by construction, and every "what is left"
     figure is a WORST CASE. A screen that quietly showed 0 income as though it
     were a measurement would be lying, so the plain note stays for that case. */
  const confirmedInflows = inflows.filter((r) => r.confirmed).length;
  const notes = inflows.length
    ? [{
        code: "income_modelled",
        note:
          `Money coming IN counts ${inflows.length} repeat deposit(s) found in the bank history, on their paydays in this window. ` +
          `${confirmedInflows} of them are steady enough to move the balance; ` +
          `${inflows.length - confirmedInflows === 0 ? "none are" : `${inflows.length - confirmedInflows} are`} shown but not counted. ` +
          "Money that has not arrived on a steady schedule is still left out, so 'what is left' leans low, never high."
      }]
    : [{
        code: "no_income_modelled",
        note:
          income && income.ok === true
            ? "Money coming IN is not modelled. No repeat deposit was found in the bank history, so 'money in' is zero by construction and every 'what is left' figure is a worst case, not a forecast."
            : "Money coming IN is not modelled. Nothing in this system detects recurring income yet, so 'money in' is zero by construction and every 'what is left' figure is a worst case, not a forecast."
      }];
  if (seamError) {
    notes.push({
      code: "bill_expansion_refused",
      note: `At least one stored recurring bill could not be turned into dates: ${seamError.message}. Those bills are listed but are not in the cash-flow figures.`
    });
  }
  if (projectionError) {
    notes.push({
      code: "projection_refused",
      note: `The cash-flow projection was refused: ${projectionError.message}`
    });
  }
  if (seam.skipped?.length) {
    notes.push({
      code: "bills_not_projected",
      note: `${seam.skipped.length} bill(s) were not placed on the calendar — either the detector would not name a next date, or no occurrence falls inside this window.`,
      detail: seam.skipped
    });
  }

  /* WHAT IS EMPTY, STATED AS A FACT RATHER THAN LEFT TO AN EMPTY TABLE.
     A screen that draws nothing looks identical to a screen that failed. These
     flags are what let the page print a sentence instead of a blank. */
  const empty = {
    tradelines: tl.length === 0,
    liabilities: li.length === 0,
    bank_accounts: ba.length === 0,
    recurring_bills: rb.length === 0,
    reminders: rm.length === 0,
    everything: tl.length === 0 && li.length === 0 && ba.length === 0 && rb.length === 0 && rm.length === 0
  };

  return {
    source: "money-map",
    engines: ENGINES,
    as_of: asOf,
    horizon_days: horizonDays,
    window: { from: asOf, to: windowTo },
    counts: {
      tradelines: tl.length,
      liabilities: li.length,
      bank_accounts: ba.length,
      recurring_bills: rb.length,
      reminders: rm.length
    },
    empty,
    /* Printed at the top of the screen, above every figure it affects. */
    not_real: {
      accounts: mockAccounts.length,
      any: mockAccounts.length > 0,
      note:
        mockAccounts.length > 0
          ? `${mockAccounts.length} of this client's bank account(s) are NOT REAL. They came from the stand-in provider, not from a bank. Every cash figure on this screen includes them.`
          : null,
      labels: mockAccounts.map((a) => text(a.name) || text(a.official_name) || "Unnamed account")
    },
    cards,
    bills,
    cashflow,
    balances: { ...engine("banking_surface"), ...balances },
    utilization,
    alerts,
    funding,
    /* What the income finder found, kinds kept apart and never added. Null
       when no income read was passed. */
    income: income && income.ok === true
      ? {
          ...engine("income"),
          by_kind: income.by_kind,
          items: (income.items || []).map((it) => ({
            id: it.id, source: it.source, name: it.name, kind: it.kind, cadence: it.cadence ?? null,
            typical: amount(Number.isSafeInteger(it.typical_cents) ? it.typical_cents : null),
            monthly: amount(Number.isSafeInteger(it.monthly_cents) ? it.monthly_cents : null),
            next_expected_on: it.next_expected_on ?? null,
            on_the_calendar: inflows.some((r) => r.inflowId === it.id)
          })),
          not_counted: (income.not_counted || []).map((it) => ({ id: it.id, name: it.name, kind: it.kind, reason: it.reason })),
          placed: inflows.length,
          confirmed: confirmedInflows
        }
      : income && income.ok === false
        ? { ...engine("income"), unavailable: true, reason: income.reason ?? null }
        : null,
    notes
  };
}

export default moneyMap;
