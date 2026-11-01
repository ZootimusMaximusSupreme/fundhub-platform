// Unit tests for the pure alert evaluators. NO DATABASE — that is the point.
//
// The tests are weighted towards the unknown paths on purpose. A wrong
// utilization number gets noticed because somebody argues with it; an unknown
// that quietly became a zero never gets noticed at all, because 0% used looks
// like good news. AUDIT-FINDINGS.md records tests in this repo that asserted the
// defect and passed happily for months, so several assertions below deliberately
// check the OVER-broad direction too: not just "this fires when it should" but
// "this does not fire when it should not", and not just "unknown is not false"
// but "unknown is not true either".

import { test } from "node:test";
import assert from "node:assert/strict";
import { calcFunding } from "../calculators/deal-funding.mjs";
import { PASSING_FICO_BANDS } from "../config/survey-qualification.mjs";
import {
  DEFAULT_UTILIZATION_THRESHOLD,
  SCORE_BANDS,
  SCORE_MIN,
  SCORE_MAX,
  UPGRADE_REASONS,
  thresholdFromBps,
  readLine,
  evaluateUtilization,
  evaluateScore,
  suggestCardUpgrade,
  monthlyReport
} from "./evaluate.mjs";

/* A `tradelines` row (054) as the db hands it back: integer cents, bigints as
   strings, snake_case. */
const row = (o = {}) => ({
  id: o.id ?? "t1",
  lender: o.lender ?? "Chase",
  kind: o.kind ?? "revolving",
  credit_limit_cents: o.limit === undefined ? 1_000_000 : o.limit, // $10,000
  balance_cents: o.balance === undefined ? 200_000 : o.balance, // $2,000
  apr: o.apr === undefined ? 0.2499 : o.apr,
  closed_at: o.closed_at ?? null
});

/* ══════════════════ threshold plumbing ══════════════════ */

test("the default threshold is the one calcFunding actually applies — drift guard", () => {
  // If somebody changes deal-funding's default and not this module's, alerts
  // start firing on a different line from the guardrail on the closer's screen.
  // This asserts against calcFunding's real behaviour, not against a copy of its
  // source, so it fails on drift rather than on a stale comment.
  const r = calcFunding({
    cards: [{ lender: "X", creditLimit: 10000, currentBalance: 0, apr: 0.2 }],
    requestedAmount: 3001
  });
  assert.equal(r.guardrail.threshold, DEFAULT_UTILIZATION_THRESHOLD);
});

test("thresholdFromBps: 3000 -> 0.30, and NULL stays NULL", () => {
  assert.equal(thresholdFromBps(3000), 0.3);
  assert.equal(thresholdFromBps(0), 0);
  assert.equal(thresholdFromBps("3000"), 0.3, "pg hands integers back as numbers or strings");
  // The whole reason 079 ships every rule unset.
  assert.equal(thresholdFromBps(null), null);
  assert.equal(thresholdFromBps(undefined), null);
  assert.equal(thresholdFromBps(""), null);
  // Over-broad direction: an unset threshold must NOT quietly become the default.
  assert.notEqual(thresholdFromBps(null), DEFAULT_UTILIZATION_THRESHOLD);
  // Outside the column's own CHECK, or not an integer -> unusable, not clamped.
  assert.equal(thresholdFromBps(-1), null);
  assert.equal(thresholdFromBps(100_001), null);
  assert.equal(thresholdFromBps(30.5), null);
});

test("an explicitly null threshold yields unknown, NOT the default", () => {
  const r = evaluateUtilization(row({ limit: 1_000_000, balance: 900_000 }), { threshold: null });
  assert.equal(r.known, false);
  assert.equal(r.reason, "unknown_threshold");
  // 90% would be over any sane line. It must still not say so.
  assert.equal(r.over, null);
  assert.notEqual(r.over, true);
  assert.equal(r.utilization, null);
});

test("an omitted threshold DOES get the default — the two cases are different", () => {
  const r = evaluateUtilization(row({ limit: 1_000_000, balance: 900_000 }));
  assert.equal(r.known, true);
  assert.equal(r.threshold, DEFAULT_UTILIZATION_THRESHOLD);
  assert.equal(r.over, true);
});

/* ══════════════════ evaluateUtilization — single line ══════════════════ */

test("utilization is balance over limit", () => {
  const r = evaluateUtilization(row({ limit: 1_000_000, balance: 200_000 }));
  assert.equal(r.known, true);
  assert.equal(r.utilization, 0.2);
  assert.equal(r.utilizationPct, 20);
  assert.equal(r.headroomCents, 800_000);
  assert.equal(r.over, false);
});

test("NULL LIMIT means unknown — not zero, not 100%, not over", () => {
  const r = evaluateUtilization(row({ limit: null, balance: 200_000 }));
  assert.equal(r.known, false);
  assert.equal(r.reason, "unknown_limit");
  assert.equal(r.utilization, null);
  assert.equal(r.utilizationPct, null);
  assert.equal(r.headroomCents, null);
  // Both directions. Unknown is not "fine" and it is not "over".
  assert.equal(r.over, null);
  assert.notEqual(r.over, false);
  assert.notEqual(r.over, true);
  // The balance we DO know survives; it is not blanked out with the rest.
  assert.equal(r.balanceCents, 200_000);
});

test("NULL BALANCE means unknown — not a zero balance", () => {
  const r = evaluateUtilization(row({ limit: 1_000_000, balance: null }));
  assert.equal(r.known, false);
  assert.equal(r.reason, "unknown_balance");
  assert.equal(r.utilization, null);
  assert.equal(r.over, null);
  // Over-broad guard: a zero-balance card reads 0% and false. An unknown one
  // must not produce that same clean-looking answer.
  assert.notEqual(r.utilization, 0);
  assert.notEqual(r.over, false);
  assert.equal(r.limitCents, 1_000_000);
});

test("both NULL means unknown, and the limit is named first", () => {
  const r = evaluateUtilization(row({ limit: null, balance: null }));
  assert.equal(r.known, false);
  assert.equal(r.reason, "unknown_limit");
  assert.equal(r.over, null);
});

test("a ZERO limit is a division by zero, not 0% utilization", () => {
  const r = evaluateUtilization(row({ limit: 0, balance: 50_000 }));
  assert.equal(r.known, false);
  assert.equal(r.reason, "zero_limit");
  assert.equal(r.utilization, null);
  assert.equal(r.over, null);
  assert.notEqual(r.utilization, 0);
});

test("a zero BALANCE is a real zero — 0% used, known", () => {
  const r = evaluateUtilization(row({ limit: 1_000_000, balance: 0 }));
  assert.equal(r.known, true);
  assert.equal(r.reason, null);
  assert.equal(r.utilization, 0);
  assert.equal(r.over, false);
  assert.equal(r.headroomCents, 1_000_000);
});

test("negative cents are refused as unreadable, not absolute-valued", () => {
  const r = evaluateUtilization(row({ limit: -1_000_000, balance: 200_000 }));
  assert.equal(r.known, false);
  assert.equal(r.reason, "unknown_limit");
});

test("garbage input is unknown, never a number", () => {
  for (const bad of [null, undefined, "", 42, "not a card", {}]) {
    const r = evaluateUtilization(bad);
    assert.equal(r.known, false, `expected unknown for ${JSON.stringify(bad)}`);
    assert.equal(r.over, null);
    assert.equal(r.utilization, null);
  }
});

test("exactly AT the threshold does not fire — strictly above, like calcFunding", () => {
  // 3000/10000 is 0.29999999999999998889 as a double. Naive division makes this
  // test's outcome depend on floating-point noise.
  const at = evaluateUtilization(row({ limit: 1_000_000, balance: 300_000 }));
  assert.equal(at.utilization, 0.3);
  assert.equal(at.over, false, "exactly 30.00% is not over a 30% line");

  const oneCentOver = evaluateUtilization(row({ limit: 1_000_000, balance: 300_001 }));
  assert.equal(oneCentOver.over, true, "one cent past the line is over it");

  const oneCentUnder = evaluateUtilization(row({ limit: 1_000_000, balance: 299_999 }));
  assert.equal(oneCentUnder.over, false);
});

test("the boundary holds on limits where the fraction is not representable", () => {
  // $333.33 of a $1,111.10 limit — 30% to the cent, on a number that has no exact
  // binary form.
  const at = evaluateUtilization({ credit_limit_cents: 111_110, balance_cents: 33_333 });
  assert.equal(at.over, false);
  assert.equal(evaluateUtilization({ credit_limit_cents: 111_110, balance_cents: 33_334 }).over, true);
});

test("an over-limit card reports over 100% and zero headroom, never negative", () => {
  const r = evaluateUtilization(row({ limit: 500_000, balance: 800_000 }));
  assert.equal(r.utilization, 1.6);
  assert.equal(r.over, true);
  assert.equal(r.headroomCents, 0);
});

test("utilization keeps 4dp — it is not rounded to whole percents", () => {
  // 3567/10000 = 35.67%. calcFunding rounds this quantity to 2dp (0.36); a value
  // a threshold is compared against cannot afford that.
  const r = evaluateUtilization({ credit_limit_cents: 1_000_000, balance_cents: 356_700 });
  assert.equal(r.utilization, 0.3567);
  assert.equal(r.utilizationPct, 35.67);
});

test("reads a calcFunding card shape too, in dollars", () => {
  const r = evaluateUtilization({ lender: "Amex", creditLimit: 10000, currentBalance: 2000, apr: 0.19 });
  assert.equal(r.known, true);
  assert.equal(r.limitCents, 1_000_000);
  assert.equal(r.balanceCents, 200_000);
  assert.equal(r.utilization, 0.2);
});

test("cents keys win over dollar keys when a caller passes both", () => {
  const r = readLine({ credit_limit_cents: 1_000_000, creditLimit: 99999, balance_cents: 1, currentBalance: 500 });
  assert.equal(r.limitCents, 1_000_000);
  assert.equal(r.balanceCents, 1);
});

/* ══════════════════ evaluateUtilization — aggregate ══════════════════ */

test("aggregate sums balances and limits across lines", () => {
  const r = evaluateUtilization([
    row({ id: "a", limit: 1_000_000, balance: 100_000 }),
    row({ id: "b", limit: 1_000_000, balance: 100_000 })
  ]);
  assert.equal(r.known, true);
  assert.equal(r.partial, false);
  assert.equal(r.limitCents, 2_000_000);
  assert.equal(r.balanceCents, 200_000);
  assert.equal(r.utilization, 0.1);
  assert.equal(r.over, false);
  assert.equal(r.lines.known, 2);
  assert.equal(r.lines.unknown, 0);
});

test("ONE unknown line makes the aggregate answer unknown, in BOTH directions", () => {
  // The known part is 90% used — far over the line. It still must not say "over",
  // because the unknown card could be a $100k limit sitting at zero.
  const r = evaluateUtilization([
    row({ id: "a", limit: 1_000_000, balance: 900_000 }),
    row({ id: "b", limit: null, balance: null })
  ]);
  assert.equal(r.known, true, "we know something — that is not the same as knowing the answer");
  assert.equal(r.partial, true);
  assert.equal(r.reason, "partial_data");
  assert.equal(r.over, null, "partial data cannot answer the aggregate question");
  assert.notEqual(r.over, true);
  assert.notEqual(r.over, false);
  assert.equal(r.utilization, null, "there is no whole-portfolio utilization to report");
  // The measurable part is still available, under a name that cannot be mistaken
  // for the whole portfolio.
  assert.equal(r.knownPortion.utilization, 0.9);
  assert.equal(r.knownPortion.over, true);
  assert.equal(r.lines.unknown, 1);
  assert.equal(r.lines.known, 1);
});

test("a partial aggregate that looks healthy is also unknown — the flattering direction", () => {
  // Known part is 1% used. An unknown maxed card would change the answer, so a
  // reassuring reading is refused exactly as firmly as an alarming one.
  const r = evaluateUtilization([
    row({ id: "a", limit: 1_000_000, balance: 10_000 }),
    row({ id: "b", limit: 1_000_000, balance: null })
  ]);
  assert.equal(r.over, null);
  assert.notEqual(r.over, false);
  assert.equal(r.knownPortion.over, false);
});

test("every line unknown -> no_known_lines, nothing computed", () => {
  const r = evaluateUtilization([row({ limit: null }), row({ limit: null })]);
  assert.equal(r.known, false);
  assert.equal(r.reason, "no_known_lines");
  assert.equal(r.over, null);
  assert.equal(r.utilization, null);
  assert.equal(r.knownPortion, null);
});

test("an empty list is unknown, not 0% used", () => {
  const r = evaluateUtilization([]);
  assert.equal(r.known, false);
  assert.equal(r.reason, "no_known_lines");
  assert.equal(r.utilization, null);
  assert.notEqual(r.utilization, 0);
  assert.equal(r.over, null);
});

test("closed and installment lines are excluded from the aggregate — and counted", () => {
  const r = evaluateUtilization([
    row({ id: "open", limit: 1_000_000, balance: 100_000 }),
    row({ id: "shut", limit: 1_000_000, balance: 900_000, closed_at: "2026-01-01T00:00:00Z" }),
    row({ id: "auto", limit: 1_000_000, balance: 900_000, kind: "installment" })
  ]);
  assert.equal(r.utilization, 0.1, "only the open revolving line counts");
  assert.equal(r.lines.total, 3);
  assert.equal(r.lines.counted, 1);
  assert.equal(r.lines.excludedClosed, 1);
  assert.equal(r.lines.excludedInstallment, 1);
  // Exclusions are not the same as unknowns and must not inflate the partial flag.
  assert.equal(r.partial, false);
  assert.equal(r.lines.unknown, 0);
});

test("a line of credit counts toward utilization; only installment is dropped", () => {
  const r = evaluateUtilization([row({ id: "loc", kind: "loc", limit: 1_000_000, balance: 400_000 })]);
  assert.equal(r.lines.counted, 1);
  assert.equal(r.over, true);
});

/* ══════════════════ evaluateScore ══════════════════ */

test("the bands come from the survey's own option set, not from here", () => {
  assert.deepEqual(
    SCORE_BANDS.map((b) => b.label),
    ["500-619", "620-699", "700-759", "760-850"],
    "band labels are parsed from FICO_BANDS in src/config/survey-qualification.mjs"
  );
  assert.deepEqual(SCORE_BANDS[0], { label: "500-619", min: 500, max: 619 });
  assert.deepEqual(SCORE_BANDS[3], { label: "760-850", min: 760, max: 850 }, "the top band ends at the top of the scale");
});

test("a score lands in its band", () => {
  // The owner's edges (2026-10-31): exactly 620 and exactly 700 start a band.
  assert.equal(evaluateScore(500).band, "500-619");
  assert.equal(evaluateScore(619).band, "500-619");
  assert.equal(evaluateScore(620).band, "620-699");
  assert.equal(evaluateScore(699).band, "620-699");
  assert.equal(evaluateScore(700).band, "700-759");
  assert.equal(evaluateScore(759).band, "700-759");
  assert.equal(evaluateScore(760).band, "760-850");
  assert.equal(evaluateScore(850).band, "760-850");
});

test("the funding-call gate is the survey's rule, not a second copy of it", () => {
  for (const b of SCORE_BANDS) {
    const probe = b.max === null ? b.min : b.min;
    assert.equal(
      evaluateScore(probe).meetsFundingCallGate,
      PASSING_FICO_BANDS.includes(b.label),
      `band ${b.label}`
    );
  }
  assert.equal(evaluateScore(699).meetsFundingCallGate, false);
  assert.equal(evaluateScore(700).meetsFundingCallGate, true);
});

test("a NULL score is unknown — the gate answer is null, not a fail", () => {
  for (const bad of [null, undefined, "", "abc", NaN]) {
    const r = evaluateScore(bad);
    assert.equal(r.known, false, `expected unknown for ${JSON.stringify(bad)}`);
    assert.equal(r.band, null);
    assert.equal(r.bandIndex, null);
    assert.equal(r.score, null);
    // Both directions: an unknown score neither passes nor fails the gate.
    assert.equal(r.meetsFundingCallGate, null);
    assert.notEqual(r.meetsFundingCallGate, false);
    assert.notEqual(r.meetsFundingCallGate, true);
  }
});

test("a score outside 300..850 is refused, not banded", () => {
  for (const bad of [299, 851, 1200, 0, -50]) {
    const r = evaluateScore(bad);
    assert.equal(r.known, false, `expected out_of_range for ${bad}`);
    assert.equal(r.reason, "out_of_range");
    assert.equal(r.band, null);
    assert.equal(r.meetsFundingCallGate, null);
  }
  assert.equal(evaluateScore(SCORE_MIN).known, true, "300 is inside the scale");
  assert.equal(evaluateScore(SCORE_MAX).known, true, "850 is inside the scale");
});

test("a real score below every named band is KNOWN, and definitively fails the gate", () => {
  const r = evaluateScore(450);
  assert.equal(r.known, true, "450 is a real score — the survey just has no label for it");
  assert.equal(r.reason, "below_lowest_named_band");
  assert.equal(r.band, null);
  assert.equal(r.belowLowestNamedBand, true);
  // This is the one place a null band still gives a definite gate answer, and it
  // must not be confused with the unknown case above.
  assert.equal(r.meetsFundingCallGate, false);
  assert.notEqual(r.meetsFundingCallGate, null);
});

test("a non-integer score is refused rather than rounded", () => {
  const r = evaluateScore(712.4);
  assert.equal(r.known, false);
  assert.equal(r.reason, "non_integer_score");
  assert.equal(r.band, null);
});

test("a numeric string from pg reads as a score", () => {
  assert.equal(evaluateScore("712").band, "700-759");
});

test("no adjective is returned for a score — that is a compliance decision", () => {
  const r = evaluateScore(800);
  const text = JSON.stringify(r).toLowerCase();
  for (const word of ["excellent", "good", "fair", "poor", "bad", "great"]) {
    assert.ok(!text.includes(word), `evaluateScore must not judge a score ("${word}" leaked out)`);
  }
});

/* ══════════════════ suggestCardUpgrade ══════════════════ */

const codes = (r) => r.reasons.map((x) => x.code);

test("no case at all -> suggest false, with everything known", () => {
  const r = suggestCardUpgrade([
    row({ id: "a", limit: 1_000_000, balance: 50_000, apr: 0.19 }),
    row({ id: "b", limit: 1_000_000, balance: 50_000, apr: 0.19 })
  ]);
  assert.equal(r.suggest, false);
  assert.deepEqual(r.reasons, []);
});

test("aggregate over the line is a case", () => {
  const r = suggestCardUpgrade([row({ id: "a", limit: 1_000_000, balance: 500_000, apr: 0.19 })]);
  assert.equal(r.suggest, true);
  assert.deepEqual(codes(r), [UPGRADE_REASONS.AGGREGATE_UTILIZATION_OVER_THRESHOLD]);
  assert.equal(r.reasons[0].evidence.utilization, 0.5);
});

test("one card over while the total is not is a DIFFERENT case", () => {
  const r = suggestCardUpgrade([
    row({ id: "hot", limit: 100_000, balance: 90_000, apr: 0.19 }),
    row({ id: "cold", limit: 2_000_000, balance: 0, apr: 0.19 })
  ]);
  // 90k of 2.1m aggregate is ~4% — the total is fine, the distribution is not.
  assert.equal(r.utilization.over, false);
  assert.equal(r.suggest, true);
  assert.deepEqual(codes(r), [UPGRADE_REASONS.PER_CARD_UTILIZATION_OVER_THRESHOLD]);
  assert.equal(r.reasons[0].evidence.cards[0].id, "hot");
});

test("the two utilization cases never both fire", () => {
  const r = suggestCardUpgrade([
    row({ id: "a", limit: 1_000_000, balance: 900_000, apr: 0.19 }),
    row({ id: "b", limit: 1_000_000, balance: 900_000, apr: 0.19 })
  ]);
  assert.equal(codes(r).filter((c) => c.includes("UTILIZATION")).length, 1);
  assert.deepEqual(codes(r), [UPGRADE_REASONS.AGGREGATE_UTILIZATION_OVER_THRESHOLD]);
});

test("a balance on a dearer card than the client's own cheapest is a case, priced in integer cents", () => {
  const r = suggestCardUpgrade([
    { id: "cheap", lender: "Amex", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.1 },
    { id: "dear", lender: "Store", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 100_000, apr: 0.25 }
  ]);
  assert.equal(r.suggest, true);
  assert.deepEqual(codes(r), [UPGRADE_REASONS.HIGH_APR_BALANCE]);
  assert.equal(r.bestApr, 0.1);
  // $1,000 at 15 points of rate difference = $150.00 = 15000 cents, exactly.
  assert.equal(r.estimatedAnnualSavingCents, 15_000);
  assert.ok(Number.isInteger(r.estimatedAnnualSavingCents), "money is integer cents");
});

test("the saving figure does not drift into fractional cents", () => {
  // 33333 cents at a 0.0333 rate gap = 1109.98890 cents. Must round to a whole
  // cent, not carry a float tail — the defect src/affiliates/economics.mjs has.
  const r = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 9_000_000, balance_cents: 0, apr: 0.1 },
    { id: "dear", kind: "revolving", credit_limit_cents: 9_000_000, balance_cents: 33_333, apr: 0.1333 }
  ]);
  assert.equal(r.estimatedAnnualSavingCents, 1110);
  assert.ok(Number.isInteger(r.estimatedAnnualSavingCents));
});

test("a dearer card with NO balance is not a saving — nothing to move", () => {
  const r = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 100_000, apr: 0.1 },
    { id: "dear", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.25 }
  ]);
  assert.equal(r.suggest, false);
  assert.deepEqual(codes(r), []);
  assert.equal(r.estimatedAnnualSavingCents, null);
});

test("a dearer card with an UNKNOWN balance is not priced as if it were zero", () => {
  const r = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.1 },
    { id: "dear", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: null, apr: 0.25 }
  ]);
  assert.equal(r.estimatedAnnualSavingCents, null, "an unknown balance produces no saving figure");
  // And with a card unread, "no case" cannot be asserted either.
  assert.equal(r.suggest, null);
  assert.notEqual(r.suggest, false);
});

test("one priced card alone has nothing to compare against", () => {
  const r = suggestCardUpgrade([{ id: "only", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 100_000, apr: 0.29 }]);
  assert.equal(r.bestApr, null, "cheapest-of-one is not a finding");
  assert.ok(!codes(r).includes(UPGRADE_REASONS.HIGH_APR_BALANCE));
});

/* ══════════════════ APR units — the 100x saving figure ══════════════════

   These pin the defect readLine's `apr` reading used to have: a bare
   Number(rawApr) with no unit normalisation. Every APR store in this repo is a
   decimal FRACTION (db/migrations CHECKs `apr` into 0..1 on both card tables),
   but a caller handing readLine a bureau or vendor payload can just as easily
   state 24.99 as 0.2499. Unconverted, that value stayed a hundred times too
   large through the whole HIGH_APR_BALANCE calculation, and the output of that
   calculation is a dollar figure in a sentence about somebody's credit.

   The tests below are deliberately paired: the same client, the same balances,
   the same rates, written once in fractions and once in percent units. If the
   two ever disagree, the normalisation is gone again. Asserting the correct
   figure alone would not catch it — a single-shape test passed happily while the
   defect was live, which is the failure mode this file's header warns about. */

test("percent-unit and fraction APRs produce the SAME saving — not a 100x one", () => {
  // $6,400 sitting on a 25% card while the client's own cheapest open card is
  // 10%. Fifteen points of difference on $6,400 is $960.00 a year = 96000 cents.
  const asFractions = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.1 },
    { id: "dear", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 640_000, apr: 0.25 }
  ]);
  const asPercents = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 10 },
    { id: "dear", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 640_000, apr: 25 }
  ]);

  assert.equal(asFractions.estimatedAnnualSavingCents, 96_000, "$960.00 a year");
  assert.equal(
    asPercents.estimatedAnnualSavingCents,
    96_000,
    "24.99-style percent units must be read as a rate, not multiplied raw"
  );
  // The number the defect actually produced. Named explicitly so a regression
  // reads as "$96,000 is back" rather than as an anonymous number mismatch.
  assert.notEqual(asPercents.estimatedAnnualSavingCents, 9_600_000, "$96,000 — the 100x figure");

  // Not just the money: the rate reported alongside it must be a fraction too,
  // because `bestApr` is written into an alert's `detail` and read back by
  // whatever renders it.
  assert.equal(asPercents.bestApr, 0.1);
  assert.deepEqual(codes(asPercents), codes(asFractions));
  assert.equal(asPercents.suggest, asFractions.suggest);
});

test("readLine normalises APR units the one way this repo normalises them", () => {
  // Same answers readApr() gives in src/tradelines/index.mjs, because readLine
  // now calls it rather than carrying a second opinion.
  assert.equal(readLine({ apr: 24.99 }).apr, 0.2499, "percent units convert");
  assert.equal(readLine({ apr: 0.2499 }).apr, 0.2499, "a fraction is left alone");
  assert.equal(readLine({ apr: "24.99%" }).apr, 0.2499, "a payload string with a percent sign");
  assert.equal(readLine({ apr: 1 }).apr, 1, "1 reads as 100%, the top of the accepted band");
  // A real 0% intro rate is a fact, not a gap. It must survive as 0, and it must
  // not be confused with the null cases below.
  assert.equal(readLine({ apr: 0 }).apr, 0);
  assert.notEqual(readLine({ apr: 0 }).apr, null);
});

test("an APR outside 0..100% is unknown, not clamped — and makes no dollar claim", () => {
  // 150 is 150% after conversion. readApr refuses it rather than clamping,
  // because a clamped rate is a wrong number wearing a plausible face and this
  // rule sorts on price.
  assert.equal(readLine({ apr: 150 }).apr, null);
  assert.equal(readLine({ apr: -5 }).apr, null, "negative is refused, not absolute-valued");

  const r = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.1 },
    { id: "junk", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 640_000, apr: 150 }
  ]);
  assert.equal(r.estimatedAnnualSavingCents, null, "no readable rate gap, so no saving figure");
  assert.ok(!codes(r).includes(UPGRADE_REASONS.HIGH_APR_BALANCE));
  assert.equal(r.bestApr, null, "one priced card is not a comparison");
  assert.equal(r.unknowns.linesMissingApr, 1, "the unreadable rate is counted, not hidden");
});

test("a missing APR stays null — it never becomes a 0% claim about a card", () => {
  // 0% is not "unknown". It is a specific statement about somebody's card, and
  // it would also be the cheapest rate on file, making it the baseline every
  // saving figure is measured against. Both wrong, in the same direction.
  for (const missing of [null, undefined, ""]) {
    const line = readLine({ id: "x", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 100_000, apr: missing });
    assert.equal(line.apr, null, `apr: ${JSON.stringify(missing)} must read as unknown`);
    assert.notEqual(line.apr, 0);
  }

  const r = suggestCardUpgrade([
    { id: "cheap", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 0, apr: 0.1 },
    { id: "silent", kind: "revolving", credit_limit_cents: 5_000_000, balance_cents: 640_000, apr: null }
  ]);
  assert.equal(r.estimatedAnnualSavingCents, null);
  assert.equal(r.unknowns.linesMissingApr, 1);
  // Over-broad direction: the unknown card must not have been priced at 0% and
  // then reported as the client's cheapest.
  assert.notEqual(r.bestApr, 0);
});

test("low headroom fires only against a target the caller stated", () => {
  const lines = [row({ id: "a", limit: 1_000_000, balance: 0, apr: 0.19 })];
  assert.ok(!codes(suggestCardUpgrade(lines)).includes(UPGRADE_REASONS.LOW_HEADROOM), "no target, no invented target");

  const short = suggestCardUpgrade(lines, { targetAmountCents: 2_500_000 });
  assert.deepEqual(codes(short), [UPGRADE_REASONS.LOW_HEADROOM]);
  assert.equal(short.reasons[0].evidence.shortfallCents, 1_500_000);

  const enough = suggestCardUpgrade(lines, { targetAmountCents: 500_000 });
  assert.ok(!codes(enough).includes(UPGRADE_REASONS.LOW_HEADROOM));
});

test("unknown lines make a NO undecidable, but never soften a YES", () => {
  // Nothing fires, one card unreadable -> cannot tell.
  const cannotTell = suggestCardUpgrade([
    row({ id: "a", limit: 1_000_000, balance: 10_000, apr: 0.19 }),
    row({ id: "b", limit: null, balance: null, apr: 0.19 })
  ]);
  assert.equal(cannotTell.suggest, null);
  assert.notEqual(cannotTell.suggest, false);
  assert.deepEqual(cannotTell.reasons, []);
  assert.equal(cannotTell.unknowns.lines, 1);

  // A card that is definitely over the line -> yes, despite the unreadable one.
  const stillYes = suggestCardUpgrade([
    row({ id: "a", limit: 1_000_000, balance: 900_000, apr: 0.19 }),
    row({ id: "b", limit: null, balance: null, apr: 0.19 })
  ]);
  assert.equal(stillYes.suggest, true);
  assert.deepEqual(codes(stillYes), [UPGRADE_REASONS.PER_CARD_UTILIZATION_OVER_THRESHOLD]);
});

test("no open revolving lines -> cannot tell, not 'no case'", () => {
  for (const input of [[], [row({ kind: "installment" })], [row({ closed_at: "2026-01-01T00:00:00Z" })], {}]) {
    const r = suggestCardUpgrade(input);
    assert.equal(r.suggest, null, `expected null for ${JSON.stringify(input)}`);
    assert.notEqual(r.suggest, false);
  }
});

test("an unset threshold blocks every case, including a 90%-used card", () => {
  const r = suggestCardUpgrade([row({ id: "a", limit: 1_000_000, balance: 900_000, apr: 0.19 })], { threshold: null });
  assert.equal(r.suggest, null);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.unknowns.reason, "unknown_threshold");
});

test("accepts { tradelines: [...] } as well as a bare array", () => {
  const lines = [row({ id: "a", limit: 1_000_000, balance: 500_000, apr: 0.19 })];
  assert.deepEqual(codes(suggestCardUpgrade({ tradelines: lines })), codes(suggestCardUpgrade(lines)));
});

/* ══════════════════ monthlyReport ══════════════════ */

const REPORT_CLIENTS = [
  { clientId: "c-over", score: 640, tradelines: [row({ limit: 1_000_000, balance: 800_000, apr: 0.25 })] },
  { clientId: "c-fine", score: 760, tradelines: [row({ limit: 1_000_000, balance: 100_000, apr: 0.19 })] },
  { clientId: "c-unknown", score: null, tradelines: [row({ limit: null, balance: null })] }
];

const REPORT_ALERTS = [
  { kind: "utilization_threshold", severity: "warning", state: "open", raised_at: "2026-06-10T12:00:00Z" },
  { kind: "utilization_threshold", severity: "warning", state: "resolved", raised_at: "2026-06-20T12:00:00Z" },
  { kind: "upsell_opportunity", severity: "info", state: "open", raised_at: "2026-05-01T12:00:00Z" },
  { kind: "score_band", severity: "info", state: "open", raised_at: null }
];

test("the report counts what it was given, and nothing else", () => {
  const r = monthlyReport({
    period: { start: "2026-06-01T00:00:00Z", end: "2026-06-30T23:59:59Z" },
    clients: REPORT_CLIENTS,
    alerts: REPORT_ALERTS
  });
  assert.equal(r.totals.clients, 3);
  assert.equal(r.totals.utilization.overThreshold, 1);
  assert.equal(r.totals.utilization.atOrUnderThreshold, 1);
  assert.equal(r.totals.utilization.unknown, 1);
  assert.equal(r.totals.scores.known, 2);
  assert.equal(r.totals.scores.unknown, 1);
  assert.equal(r.totals.scores.meetsFundingCallGate, 1);
  assert.equal(r.totals.scores.byBand["620-699"], 1);
  assert.equal(r.totals.scores.byBand["760-850"], 1);
  assert.equal(r.totals.scores.byBand["(unknown)"], 1);
});

test("the utilization buckets reconcile to the client count", () => {
  const t = monthlyReport({ clients: REPORT_CLIENTS }).totals;
  assert.equal(
    t.utilization.overThreshold + t.utilization.atOrUnderThreshold + t.utilization.unknown,
    t.clients,
    "an unknown that does not show up in its own bucket has been counted as something else"
  );
});

test("undetermined upsell clients are their own count, never folded into 'no'", () => {
  const t = monthlyReport({ clients: REPORT_CLIENTS }).totals;
  assert.equal(t.upsell.candidates + t.upsell.notCandidates + t.upsell.undetermined, t.clients);
  assert.equal(t.upsell.undetermined, 1);
  assert.ok(t.upsell.notCandidates < t.clients);
});

test("the period filters alerts, and undated ones are reported rather than swallowed", () => {
  const r = monthlyReport({
    period: { start: "2026-06-01T00:00:00Z", end: "2026-06-30T23:59:59Z" },
    alerts: REPORT_ALERTS
  });
  assert.equal(r.periodApplied, true);
  assert.equal(r.totals.alerts.total, 4);
  assert.equal(r.totals.alerts.counted, 2, "May's alert is out of period");
  assert.equal(r.totals.alerts.undated, 1, "the alert with no raised_at is neither in nor out");
  assert.deepEqual(r.totals.alerts.byState, { open: 1, resolved: 1 });
  assert.deepEqual(r.totals.alerts.byKind, { utilization_threshold: 2 });
});

test("no period means no date filter, said out loud", () => {
  const r = monthlyReport({ alerts: REPORT_ALERTS });
  assert.equal(r.periodApplied, false);
  assert.equal(r.period, null);
  assert.equal(r.totals.alerts.counted, 4, "nothing is filtered when no period was given");
});

test("an empty report is empty, not zeroed opinions", () => {
  const r = monthlyReport();
  assert.equal(r.totals.clients, 0);
  assert.equal(r.totals.alerts.total, 0);
  assert.equal(r.totals.upsell.estimatedAnnualSavingCents, null, "no clients means no saving figure, not $0.00");
});

test("the report holds no clock — same input, same output", () => {
  const input = { period: { start: "2026-06-01T00:00:00Z", end: "2026-06-30T23:59:59Z" }, clients: REPORT_CLIENTS, alerts: REPORT_ALERTS };
  assert.deepEqual(monthlyReport(input), monthlyReport(input));
  assert.deepEqual(monthlyReport(structuredClone(input)), monthlyReport(structuredClone(input)));
});

test("the report does not mutate what it was handed", () => {
  const input = { period: null, clients: REPORT_CLIENTS, alerts: REPORT_ALERTS };
  const before = structuredClone(input);
  monthlyReport(input);
  assert.deepEqual(input, before);
});

test("an unset threshold makes every client undetermined, not compliant", () => {
  const t = monthlyReport({ clients: REPORT_CLIENTS, threshold: null }).totals;
  assert.equal(t.utilization.unknown, 3);
  assert.equal(t.utilization.overThreshold, 0);
  assert.equal(t.utilization.atOrUnderThreshold, 0, "an unmeasured client is not a passing client");
  assert.equal(t.upsell.undetermined, 3);
});
