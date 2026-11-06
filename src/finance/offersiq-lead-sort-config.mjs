// Internal draft sorting only. No provider decision, routing or audience uses
// these values. A changed question, threshold or point value needs a new version.
// CRS codes/names below were observed in the saved 125-condition sandbox 1237
// receipt. Unsupported questions remain disabled; the active Fundhub selector still uses starter3 until the new backend is verified.

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const equal = (id, value, label = String(value)) =>
  ({ id, label, min: value, max: value, operator: "EQUALS", expectedValue: value });
const between = (id, min, max, label = `${min}-${max}`) =>
  ({ id, label, min, max, operator: "BETWEEN", expectedValue: [min, max] });
const atLeast = (id, min, label = `${min}+`) =>
  ({ id, label, min, max: null, operator: "GREATER_THAN_OR_EQUALS", expectedValue: min });
const under = (id, max, label = `under ${max}`) =>
  ({ id, label, min: 0, max, maxExclusive: true, operator: "LESS_THAN", expectedValue: max });
const smallCounts = () => [equal("zero", 0), equal("one", 1), equal("two", 2), atLeast("three_plus", 3)];
const fact = (key, attributeName, mustHave, ranges, attributeCode = null, extra = {}) =>
  ({ key, attributeName, attributeCode, mustHave, enabled: true, ranges, ...extra });

const scoreRanges = [between("under_620", 300, 619)];
for (let min = 620; min <= 845; min += 5) {
  scoreRanges.push(between(`score_${min}`, min, min === 845 ? 850 : min + 4));
}

export const OFFERSIQ_LEAD_SORT_CONFIG = freeze({
  version: "draft-2026-11-06-v2",
  ruleSetIds: { production: [1677, 1694], sandbox: [1232, 1237] },
  maximumQuestions: 512, // Total returned conditions, including screening guards.
  pending: [
    "Sandbox 1237 supplied all 18 enabled codes/names,125 conditions and four real implemented-client receipts; three paired starter-screening comparisons passed",
    "Production copy1694 is promoted; Fundhub runtime remains1677 until the compatible backend is deployed and activation readback is verified",
    "Percentage and monetary BETWEEN bands are inclusive draft whole-number bands; fractional gaps remain unknown",
    "Boolean bankruptcy and a no-car-loan question need a supported retained threshold before enabling"
  ],
  // These two conditions preserve the current provider screening gate. The
  // third gate (adverse items = 0) is already one of the ranking fact ranges.
  // Guards must be returned but never become an extra range or points input.
  screeningGuards: [
    { id: "legacy_score_minimum", factKey: "creditScore", attributeCode: "CRS_1440006",
      attributeName: "Credit Score", operator: "GREATER_THAN_OR_EQUALS", expectedValue: 660 },
    { id: "legacy_utilization_maximum", factKey: "revolvingDebtUtilization", attributeCode: "CRS_1440046",
      attributeName: "Revolving Debt Utilization", operator: "LESS_THAN", expectedValue: 50 }
  ],
  facts: [
    fact("creditScore", "Credit Score", true, scoreRanges, "CRS_1440006"),
    fact("totalAdverseItemCount", "Total Adverse Item Count", true, [
      equal("zero", 0), equal("one", 1), equal("two", 2), equal("three", 3), equal("four", 4),
      between("five_nine", 5, 9), atLeast("ten_plus", 10)
    ], "CRS_1440047"),
    fact("derogatoryAccountCount", "Derogatory Account Count", true, smallCounts(), "CRS_1440009"),
    fact("totalCollectionCount", "Total Collection Count", true, smallCounts(), "CRS_1440037"),
    fact("delinquencyPast12MonthCount", "Delinquency Past12 Month Count", true, smallCounts(), "CRS_1440007"),
    fact("delinquentAccountCount", "Delinquent Account Count", true, smallCounts(), "CRS_1440008"),
    fact("openRevolvingAccountCount", "Open Revolving Account Count", true, [
      ...[0, 1, 2, 3, 4, 5].map(value => equal(`count_${value}`, value)),
      between("six_nine", 6, 9), atLeast("ten_plus", 10)
    ], "CRS_1440028"),
    fact("revolvingDebtUtilization", "Revolving Debt Utilization", true, [
      between("zero_nine", 0, 9), between("ten_twenty_nine", 10, 29),
      between("thirty_forty_nine", 30, 49), between("fifty_seventy_four", 50, 74),
      atLeast("seventy_five_plus", 75)
    ], "CRS_1440046"),
    fact("openBankruptcyPast84Months", "Open Bankruptcy Past 84 Months", true, [], null, {
      enabled: false, dataType: "boolean", plannedQuestionCount: 1,
      pendingReason: "CRS documents EQUALS true/false; numeric-only receipt thresholds cannot retain this rule"
    }),
    fact("openInstallmentAccountCount", "Open Installment Account Count", false, smallCounts(), "CRS_1440025"),
    fact("autoUtilization", "Auto Utilization", false, [
      between("zero_twenty_four", 0, 24), between("twenty_five_forty_nine", 25, 49), atLeast("fifty_plus", 50)
    ], "CRS_1440002", {
      plannedQuestionCount: 4,
      pendingReason: "No documented numeric threshold identifies no car loan; missing auto data remains unknown"
    }),
    fact("onTimePaymentPercentage", "On Time Payment Percentage", false, [
      equal("all", 100, "100%"), between("ninety_eight_ninety_nine", 98, 99),
      between("ninety_five_ninety_seven", 95, 97), between("ninety_ninety_four", 90, 94),
      under("under_ninety", 90)
    ], "CRS_1440021"),
    fact("totalScheduledMonthlyPayment", "Total Scheduled Monthly Payment", false, [
      under("under_500", 500), between("five_hundred_999", 500, 999),
      between("one_thousand_1999", 1000, 1999), between("two_thousand_3999", 2000, 3999),
      atLeast("four_thousand_plus", 4000)
    ], "CRS_1440039"),
    fact("availableCredit", "Available Credit", false, [
      under("under_1000", 1000), between("one_thousand_4999", 1000, 4999),
      between("five_thousand_9999", 5000, 9999), between("ten_thousand_24999", 10000, 24999),
      between("twenty_five_thousand_49999", 25000, 49999), atLeast("fifty_thousand_plus", 50000)
    ], "CRS_1440003"),
    fact("inquiryCount", "Inquiry Count", false, [
      equal("zero", 0), equal("one", 1), equal("two", 2), equal("three", 3),
      between("four_five", 4, 5), atLeast("six_plus", 6)
    ], "CRS_1440014"),
    fact("totalAccountCount", "Total Account Count", false, [
      between("zero_two", 0, 2), between("three_five", 3, 5), between("six_ten", 6, 10),
      between("eleven_twenty", 11, 20), atLeast("twenty_one_plus", 21)
    ], "CRS_1440035"),
    fact("publicRecordBankruptcyCount", "Public Record Bankruptcy Count", false,
      [equal("zero", 0), atLeast("one_plus", 1)], "CRS_1440030"),
    fact("repossessionCount", "Repossession Count", false, [equal("zero", 0), atLeast("one_plus", 1)], "CRS_1440032"),
    fact("foreclosureCount", "Foreclosure Count", false, [equal("zero", 0), atLeast("one_plus", 1)], "CRS_1440012")
  ],
  buckets: { scoreMinimum: 300, blueprintFloor: 620, primeFloor: 750, superPrimeFloor: 800, scoreCeiling: 850 },
  primeChecks: [
    { fact: "delinquencyPast12MonthCount", operator: "EQUALS", value: 0, reason: "late months" },
    { fact: "totalCollectionCount", operator: "EQUALS", value: 0, reason: "collections" },
    { fact: "derogatoryAccountCount", operator: "EQUALS", value: 0, reason: "bad accounts" },
    { fact: "revolvingDebtUtilization", operator: "LESS_THAN", value: 30, reason: "card use" }
  ],
  // Values within a returned range are never reconstructed as exact credit
  // values. Linear score points use the lower edge; all other lines explicitly
  // assign draft points to a range. Unknown facts receive zero, with no rescaling.
  points: {
    minimum: 0, maximum: 100, unknown: 0,
    blueprint: [
      { mode: "linear", fact: "creditScore", from: 620, to: 749, maximum: 30 },
      { mode: "ranges", fact: "onTimePaymentPercentage", values: {
        all: 20, ninety_eight_ninety_nine: 15, ninety_five_ninety_seven: 10,
        ninety_ninety_four: 5, under_ninety: 0
      } },
      { mode: "best", lines: [
        { mode: "ranges", fact: "openInstallmentAccountCount", values: { zero: 0, one: 20, two: 20, three_plus: 20 } },
        { mode: "ranges", fact: "autoUtilization", values: { zero_twenty_four: 20, twenty_five_forty_nine: 10, fifty_plus: 0 } }
      ] },
      { mode: "ranges", fact: "totalAdverseItemCount", values: {
        zero: 15, one: 12, two: 9, three: 6, four: 3, five_nine: 1, ten_plus: 0
      } },
      { mode: "ranges", fact: "delinquencyPast12MonthCount", values: { zero: 10, one: 6, two: 3, three_plus: 0 } },
      { mode: "ranges", fact: "revolvingDebtUtilization", values: {
        zero_nine: 5, ten_twenty_nine: 4, thirty_forty_nine: 2, fifty_seventy_four: 1, seventy_five_plus: 0
      } }
    ],
    prime: [
      { mode: "linear", fact: "creditScore", from: 750, to: 799, maximum: 30 },
      { mode: "ranges", fact: "revolvingDebtUtilization", values: { zero_nine: 25, ten_twenty_nine: 15 } },
      { mode: "ranges", fact: "totalScheduledMonthlyPayment", values: {
        under_500: 15, five_hundred_999: 12, one_thousand_1999: 9, two_thousand_3999: 4, four_thousand_plus: 0
      } },
      { mode: "ranges", fact: "availableCredit", values: {
        under_1000: 0, one_thousand_4999: 3, five_thousand_9999: 6,
        ten_thousand_24999: 10, twenty_five_thousand_49999: 13, fifty_thousand_plus: 15
      } },
      { mode: "ranges", fact: "inquiryCount", values: { zero: 10, one: 8, two: 6, three: 4, four_five: 2, six_plus: 0 } },
      { mode: "ranges", fact: "openRevolvingAccountCount", values: {
        count_0: 0, count_1: 0, count_2: 0, count_3: 5, count_4: 5, count_5: 5, six_nine: 5, ten_plus: 0
      } }
    ],
    superPrimeScore: { mode: "linear", fact: "creditScore", from: 800, to: 850, maximum: 30 }
  }
});

// Only these observed starter signatures receive the heartbeat's temporary
// nothing-to-judge treatment. Three arbitrary conditions do not qualify.
export const OFFERSIQ_STARTER_RULES = freeze([
  { attributeCode: "CRS_1440006", attributeName: "Credit Score", operator: "GREATER_THAN_OR_EQUALS", expectedValue: 660 },
  { attributeCode: "CRS_1440047", attributeName: "Total Adverse Item Count", operator: "EQUALS", expectedValue: 0 },
  { attributeCode: "CRS_1440046", attributeName: "Revolving Debt Utilization", operator: "LESS_THAN", expectedValue: 50 }
]);

export const OFFERSIQ_LEAD_SORT_QUESTION_COUNT = OFFERSIQ_LEAD_SORT_CONFIG.facts
  .filter(item => item.enabled).reduce((count, item) => count + item.ranges.length, 0);

export const OFFERSIQ_LEAD_SORT_CONDITION_COUNT = OFFERSIQ_LEAD_SORT_QUESTION_COUNT
  + OFFERSIQ_LEAD_SORT_CONFIG.screeningGuards.length;
