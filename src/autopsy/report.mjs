// Decline Autopsy — the report the buyer sees. Six panels, and the two doors.
//
// COMPLIANCE REVIEW REQUIRED. Spec: docs/specs/W3-decline-autopsy.md §9, §10.
//
// THREE RULES THIS FILE ENFORCES IN CODE, NOT IN COPY:
//
// 1. NO EARNINGS CLAIM. FundHub has ZERO measured paid closes. So this report
//    describes TERMS ("50% of the fee") and never OUTCOMES ("you will make
//    $30,000"). Every money figure carries `estimate: true` and an `assumption`
//    naming what produced it. Nothing here is ever aggregated into a public
//    claim, and none of it appears on a public page.
//
// 2. NO CREDIT-OUTCOME CLAIM. Not one sentence says a dispute, a repair or a
//    pull will produce a score, a deletion or an approval.
//
// 3. NULL IS NOT ZERO. A row with no capacity estimate is COUNTED, shown as a
//    dash, and EXCLUDED FROM EVERY TOTAL — with the excluded count printed
//    beside the totals it was excluded from. src/commissions/money.mjs's rule,
//    carried all the way to the screen.
//
// Pure. No clock beyond the `now` you pass it, no I/O, no database.

import { fromCents, applySplit, percentOf } from "../commissions/money.mjs";
import { BUCKETS, BUCKET_KEYS, BUCKET_LABELS, REPORT_DISCLOSURE } from "./fields.mjs";
import { PARTNER_SHARE_PCT, SUCCESS_FEE_PCT } from "./score.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";

/** The partner door's price line, from the catalogue (src/config/offers.mjs
 *  PARTNER_ENTRY, $30,000 owner-set 2026-11-07). An unusable price names no
 *  figure rather than a guessed one. */
export function partnerEntryTerm(entryPriceCents = OFFERS.PARTNER_ENTRY.priceCents) {
  const price = Number.isSafeInteger(entryPriceCents) && entryPriceCents > 0 ? formatCents(entryPriceCents) : null;
  return price
    ? `${price} one time. No monthly fee on the base program.`
    : "One entry fee, one time. No monthly fee on the base program.";
}

/** The product code this offer bills under. Named here so the test that proves
 *  it accrues NO partner and NO affiliate commission has something to assert
 *  against. It is deliberately absent from FUNDING_PRODUCT_CODES and
 *  REPAIR_PRODUCT_CODES in src/affiliates/economics.mjs — the Decline Autopsy
 *  is an e-product and e-products stay 100% FundHub (W0-decisions.md). Do not
 *  add it there. */
export const AUTOPSY_PRODUCT_CODE = "decline-autopsy";

/** A money figure, in the one shape every panel uses. `cents` stays the integer
 *  of record; `display` is the fixed 2dp STRING fromCents returns. A null
 *  amount renders as an em dash and says why — never as $0.00. */
export function money(cents, { assumption = null } = {}) {
  if (cents === null || cents === undefined) {
    return { cents: null, display: "—", known: false, estimate: true, assumption };
  }
  return { cents, display: fromCents(cents), known: true, estimate: true, assumption };
}

const isKnown = (r) => r.estimated_capacity_cents !== null && r.estimated_capacity_cents !== undefined;

/**
 * buildAutopsyReport({ rows, buyerName, reviewedAt }) — the whole document.
 *
 * `rows` are scored rows from src/autopsy/score.mjs.
 */
export function buildAutopsyReport({
  rows = [],
  buyerName = null,
  reviewedAt = new Date(),
  retention = "Your upload is kept in full. We do not delete it on a clock — use the delete button below whenever you want it gone.",
  entryPriceCents = OFFERS.PARTNER_ENTRY.priceCents
} = {}) {
  const list = Array.isArray(rows) ? rows : [];

  /* ---- Panel 1: the count. Four numbers, and the fourth is as prominent as
     the other three. ---------------------------------------------------- */
  const counts = {};
  for (const key of BUCKET_KEYS) counts[key] = 0;
  for (const r of list) {
    if (Object.prototype.hasOwnProperty.call(counts, r.bucket)) counts[r.bucket] += 1;
  }

  const excluded = list.filter((r) => !isKnown(r));
  const scored = list.filter(isKnown);

  /* ---- Panel 2: the money, row by row, keyed by the broker's OWN label. --- */
  const rowLines = list.map((r) => ({
    row_label: r.row_label,
    bucket: r.bucket,
    bucket_label: BUCKET_LABELS[r.bucket] || r.bucket,
    fico_band: r.fico_band,
    state: r.state ?? null,
    declined_by: r.declined_by ?? null,
    decline_reason: r.decline_reason ?? null,
    lender_match_count: r.lender_match_count ?? null,
    estimated_capacity: money(r.estimated_capacity_cents ?? null, {
      assumption: isKnown(r) ? "Estimate from the numbers you gave us." : "Not enough information — excluded from every total."
    }),
    estimated_fee: money(r.estimated_fee_cents ?? null, {
      assumption: `Estimate. ${SUCCESS_FEE_PCT}% of the estimated funding.`
    }),
    estimated_partner_share: money(r.estimated_partner_share_cents ?? null, {
      assumption: `Estimate. ${PARTNER_SHARE_PCT}% of the estimated fee — the partner term, not a projection of what you would earn.`
    }),
    assumptions: Array.isArray(r.assumptions) ? r.assumptions : []
  }));

  /* ---- Panel 3: why each one failed, grouped, so the pattern is visible. -- */
  const reasonGroups = new Map();
  for (const r of list) {
    const key = r.decline_reason || "not_given";
    const g = reasonGroups.get(key) || { reason: key, count: 0, row_labels: [] };
    g.count += 1;
    g.row_labels.push(r.row_label);
    reasonGroups.set(key, g);
  }
  const declineReasons = [...reasonGroups.values()].sort((a, b) => b.count - a.count);

  /* ---- Panel 4: lender eligibility as COUNTS, never a list. That list is the
     asset and it does not leave with anybody. ---------------------------- */
  const withMatches = list.filter((r) => Number.isInteger(r.lender_match_count));
  const lenderEligibility = {
    rows_checked: withMatches.length,
    rows_with_at_least_one_match: withMatches.filter((r) => r.lender_match_count > 0).length,
    best_match_count: withMatches.reduce((m, r) => Math.max(m, r.lender_match_count), 0),
    note: "Counts only. We do not publish which lenders those are."
  };

  /* ---- Panel 5: what it was worth. Arithmetic, shown as arithmetic. ------- */
  const totalCapacityCents = scored.reduce((s, r) => s + r.estimated_capacity_cents, 0);
  const totalFeeCents = percentOf(totalCapacityCents, SUCCESS_FEE_PCT);
  const partnerHalfCents = totalFeeCents > 0 ? applySplit(totalFeeCents, PARTNER_SHARE_PCT) : 0;

  const fundableNowCents = list
    .filter((r) => r.bucket === BUCKETS.FUNDABLE_NOW && isKnown(r))
    .reduce((s, r) => s + r.estimated_capacity_cents, 0);

  const worth = {
    rows_reviewed: list.length,
    rows_counted_in_totals: scored.length,
    rows_excluded: excluded.length,
    excluded_note:
      excluded.length === 0
        ? "No rows were excluded."
        : `${excluded.length} row${excluded.length === 1 ? "" : "s"} excluded — not enough information. ${excluded.length === 1 ? "It is" : "They are"} in no total on this page.`,
    excluded_row_labels: excluded.map((r) => r.row_label),
    steps: [
      {
        label: "Estimated funding across the rows we could model",
        value: money(totalCapacityCents, { assumption: "Sum of the per-row estimates above. Rows marked 'not enough information' are not in it." })
      },
      {
        label: `Success fee at ${SUCCESS_FEE_PCT}% of that`,
        value: money(totalFeeCents, { assumption: `percentOf(${totalCapacityCents}, ${SUCCESS_FEE_PCT}) — integer cents.` })
      },
      {
        label: `A partner's half of that fee (${PARTNER_SHARE_PCT}%)`,
        value: money(partnerHalfCents, { assumption: `applySplit(${totalFeeCents}, ${PARTNER_SHARE_PCT}) — the term, not a forecast.` })
      },
      {
        label: "Of which sits in rows we would fund today",
        value: money(fundableNowCents, { assumption: "The 'fundable now' rows only." })
      }
    ],
    plain_english:
      "These are estimates built from the numbers you sent. They are not a prediction of what you will be paid, and nobody has been funded off this page."
  };

  /* ---- Panel 6: the two doors. TERMS ONLY. ------------------------------- */
  const doors = [
    {
      key: "partner",
      title: "Become a partner and keep half",
      terms: [
        partnerEntryTerm(entryPriceCents),
        "50% of funding and repair, front end and back end — including half the 10% success fee.",
        "Financeable through our own rails as a training product.",
        "Ten funded clients a month keeps the partnership open. That is the only filter.",
        "Courses and digital products are not part of the split."
      ],
      apply: { endpoint: "/api/public/partner-apply", track: "white_label" }
    },
    {
      key: "affiliate",
      title: "Send us the deals and get paid as an affiliate",
      terms: [
        "No entry fee.",
        "20% on funding deposit collected or repair enrolment fee, on the deals you send.",
        "A second tier pays 5% on your downline.",
        "You introduce the person; they consent to us directly."
      ],
      apply: { endpoint: "/api/public/partner-apply", track: "affiliate" }
    }
  ];

  return {
    ok: true,
    header: {
      title: `Decline Autopsy — ${list.length} file${list.length === 1 ? "" : "s"} reviewed`,
      buyer_name: buyerName || null,
      reviewed_at: new Date(reviewedAt).toISOString()
    },
    /* The disclosure sits at the TOP. Spec §9.1. */
    disclosure: [...REPORT_DISCLOSURE, retention],
    counts: {
      fundable_now: counts[BUCKETS.FUNDABLE_NOW],
      fundable_after_repair: counts[BUCKETS.FUNDABLE_AFTER_REPAIR],
      not_fundable: counts[BUCKETS.NOT_FUNDABLE],
      not_enough_information: counts[BUCKETS.NOT_ENOUGH_INFORMATION],
      labels: BUCKET_LABELS
    },
    rows: rowLines,
    decline_reasons: declineReasons,
    lender_eligibility: lenderEligibility,
    worth,
    doors,
    /* Stated on the face of the report, per spec §8.2 and §9.4. */
    footer: {
      no_credit_pull: "We did not look at anyone's credit. Nothing on this page came from a credit bureau.",
      no_contact: "We will not contact any of the people on your list. We hold no way to.",
      product_code: AUTOPSY_PRODUCT_CODE,
      commission_note: "This $27 report is a digital product. No partner or affiliate commission is paid on it."
    }
  };
}

export default buildAutopsyReport;
