import { test } from "node:test";
import assert from "node:assert/strict";
import { OFFERSIQ_LEAD_SORT_CONFIG, OFFERSIQ_LEAD_SORT_QUESTION_COUNT, OFFERSIQ_LEAD_SORT_CONDITION_COUNT,
  OFFERSIQ_STARTER_RULES }
  from "./offersiq-lead-sort-config.mjs";
import { bucketOffersIqFacts, classifyOffersIqReceipt, isOffersIqStarterReceipt, scoreOffersIqFacts }
  from "./offersiq-lead-sort.mjs";

function readyConfig() {
  return structuredClone(OFFERSIQ_LEAD_SORT_CONFIG);
}

const GOOD = {
  creditScore: 800, totalAdverseItemCount: 0, derogatoryAccountCount: 0, totalCollectionCount: 0,
  delinquencyPast12MonthCount: 0, delinquentAccountCount: 0, openRevolvingAccountCount: 5,
  revolvingDebtUtilization: 5, openInstallmentAccountCount: 1, autoUtilization: 10,
  onTimePaymentPercentage: 100, totalScheduledMonthlyPayment: 200, availableCredit: 50000,
  inquiryCount: 0, totalAccountCount: 15, publicRecordBankruptcyCount: 0,
  repossessionCount: 0, foreclosureCount: 0
};

function satisfies(value, range) {
  if (value === null || value === undefined) return false;
  if (range.operator === "EQUALS") return value === range.expectedValue;
  if (range.operator === "BETWEEN") return value >= range.expectedValue[0] && value <= range.expectedValue[1];
  if (range.operator === "LESS_THAN") return value < range.expectedValue;
  return value >= range.expectedValue;
}

function receipt(values = {}, config = readyConfig()) {
  const input = { ...GOOD, ...values };
  const condition = (value, rule) => {
    const unknown = value === null || value === undefined;
    const passed = satisfies(value, rule);
    return { attributeCode: rule.attributeCode, attributeName: rule.attributeName,
      operator: rule.operator, expectedValue: structuredClone(rule.expectedValue), passed,
      status: unknown ? "UNVERIFIABLE" : passed ? "PASSED" : "FAILED" };
  };
  const individual_results = config.facts.filter(fact => fact.enabled).flatMap(fact => fact.ranges
    .map(range => condition(input[fact.key], { ...range, attributeCode: fact.attributeCode,
      attributeName: fact.attributeName })));
  individual_results.push(...config.screeningGuards.map(guard => condition(input[guard.factKey], guard)));
  return { outcome: "matched", environment: "production", rule_set_id: 1677,
    request_id: "20000000-0000-4000-8000-000000000001", decision_status: "APPROVED", individual_results };
}

function classify(values, config = readyConfig()) {
  return classifyOffersIqReceipt(receipt(values, config), config);
}

function starter(overrides = {}) {
  return { outcome: "not_matched", rule_set_id: 1677, environment: "production",
    request_id: "20000000-0000-4000-8000-000000000001",
    individual_results: OFFERSIQ_STARTER_RULES.map((rule, index) => ({ ...rule,
      status: index === 1 ? "FAILED" : "PASSED", passed: index !== 1 })), ...overrides };
}

test("observed configuration is versioned, frozen, numeric and fails closed if an enabled code is missing", () => {
  assert.equal(Object.isFrozen(OFFERSIQ_LEAD_SORT_CONFIG), true);
  assert.equal(Object.isFrozen(OFFERSIQ_LEAD_SORT_CONFIG.facts[0].ranges), true);
  assert.equal(OFFERSIQ_LEAD_SORT_QUESTION_COUNT, 123);
  assert.equal(OFFERSIQ_LEAD_SORT_CONDITION_COUNT, 125);
  assert.equal(OFFERSIQ_LEAD_SORT_CONFIG.screeningGuards.length, 2);
  const facts = OFFERSIQ_LEAD_SORT_CONFIG.facts;
  assert.equal(facts.filter(fact => fact.enabled && fact.mustHave).reduce((n, fact) => n + fact.ranges.length, 0), 83);
  assert.equal(facts.find(fact => fact.key === "creditScore").ranges.length, 47);
  assert.equal(facts.find(fact => fact.key === "openBankruptcyPast84Months").enabled, false);
  assert.equal(facts.find(fact => fact.key === "openBankruptcyPast84Months").attributeCode, null);
  assert.match(facts.find(fact => fact.key === "openBankruptcyPast84Months").pendingReason, /true\/false/);
  assert.match(facts.find(fact => fact.key === "autoUtilization").pendingReason, /No documented numeric threshold/);
  const enabled = facts.filter(fact => fact.enabled);
  assert.equal(enabled.length, 18);
  assert.equal(new Set(enabled.map(fact => fact.attributeCode)).size, 18);
  for (const fact of enabled) {
    assert.match(fact.attributeCode, /^CRS_\d{7}$/);
    for (const range of fact.ranges) {
      assert.ok(typeof range.expectedValue === "number" || (Array.isArray(range.expectedValue)
        && range.expectedValue.length === 2 && range.expectedValue.every(Number.isFinite)));
    }
  }
  assert.equal(classifyOffersIqReceipt(receipt()).ruleListStatus, "matched");
  const incomplete = readyConfig();
  incomplete.facts.find(fact => fact.key === "availableCredit").attributeCode = null;
  const result = classifyOffersIqReceipt(receipt(), incomplete);
  assert.equal(result.bucket, "can_not_tell");
  assert.equal(result.ruleListStatus, "mismatch");
  assert.match(result.reasons.join(" "), /config attribute codes pending/);
});

test("saved 125-condition sandbox 1237 is accepted only in sandbox while starter IDs remain recognized", () => {
  const source = receipt();
  source.environment = "sandbox";
  source.rule_set_id = 1237;
  assert.equal(classifyOffersIqReceipt(source).ruleListStatus, "matched");
  assert.equal(classifyOffersIqReceipt({ ...source, environment: "production" }).ruleListStatus, "mismatch");
  assert.equal(classifyOffersIqReceipt({ ...source, rule_set_id: 1238 }).ruleListStatus, "mismatch");
  assert.equal(classifyOffersIqReceipt(starter()).ruleListStatus, "starter");
  assert.equal(classifyOffersIqReceipt(starter({ rule_set_id: 1232, environment: "sandbox" })).ruleListStatus, "starter");
  assert.equal(isOffersIqStarterReceipt(starter({ rule_set_id: 1237, environment: "sandbox" })), false);
});

function screeningCondition(source, factKey, config) {
  const guard = config.screeningGuards.find(value => value.factKey === factKey);
  return source.individual_results.find(rule => rule.attributeCode === guard.attributeCode
    && rule.operator === guard.operator && rule.expectedValue === guard.expectedValue);
}

test("123 ranking bands plus two legacy guards form 125 unique conditions without adding fact ranges", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  assert.equal(source.individual_results.length, 125);
  const keys = source.individual_results.map(rule => JSON.stringify([
    rule.attributeCode, rule.attributeName, rule.operator, rule.expectedValue
  ]));
  assert.equal(new Set(keys).size, 125);
  assert.equal(source.individual_results.filter(rule => rule.attributeCode === "CRS_1440047"
    && rule.operator === "EQUALS" && rule.expectedValue === 0).length, 1, "adverse zero is reused once");
  const result = classifyOffersIqReceipt(source, config);
  assert.equal(result.ruleListStatus, "matched");
  assert.equal(result.bucket, "super_prime");
  assert.equal(result.facts.creditScore.rangeId, "score_800");
  assert.equal(result.facts.revolvingDebtUtilization.rangeId, "zero_nine");
  assert.deepEqual(Object.keys(result.facts), config.facts.map(fact => fact.key));
  for (const limit of [123, 124, 125]) {
    const capped = structuredClone(config);
    capped.maximumQuestions = limit;
    assert.equal(classifyOffersIqReceipt(source, capped).ruleListStatus, limit < 125 ? "mismatch" : "matched");
  }
});

test("missing, duplicated or mutated screening guards never pass the complete-list contract", () => {
  const config = readyConfig();
  const variants = [
    source => { source.individual_results = source.individual_results.slice(0, 123); },
    source => { source.individual_results.pop(); },
    source => { source.individual_results.push({ ...screeningCondition(source, "creditScore", config) }); },
    source => { screeningCondition(source, "creditScore", config).expectedValue = 655; },
    source => { screeningCondition(source, "creditScore", config).attributeName = "Other score"; },
    source => { screeningCondition(source, "creditScore", config).operator = "GREATER_THAN"; },
    source => { screeningCondition(source, "revolvingDebtUtilization", config).expectedValue = 49; },
    source => { screeningCondition(source, "revolvingDebtUtilization", config).expectedValue = "50"; },
    source => { source.individual_results[124] = { ...source.individual_results.find(rule =>
      rule.attributeCode === "CRS_1440047" && rule.expectedValue === 0) }; }
  ];
  for (const mutate of variants) {
    const source = receipt({}, config);
    mutate(source);
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(result.ruleListStatus, "mismatch");
    assert.equal(result.bucket, "can_not_tell");
    assert.equal(result.points, 0);
  }
  const source = receipt({}, config);
  for (const mutate of [
    value => { delete value.screeningGuards; },
    value => { value.screeningGuards = null; },
    value => { value.screeningGuards.pop(); },
    value => { value.screeningGuards.push({ ...value.screeningGuards[0] }); },
    value => { value.screeningGuards[1] = { ...value.screeningGuards[0] }; },
    value => { value.screeningGuards[0].id = "other_gate"; },
    value => { value.screeningGuards[0].factKey = "availableCredit"; },
    value => { value.screeningGuards[0].expectedValue = 655; },
    value => { value.screeningGuards[1].negated = true; }
  ]) {
    const changed = structuredClone(config);
    mutate(changed);
    assert.equal(classifyOffersIqReceipt(source, changed).ruleListStatus, "mismatch");
  }
  const changedGate = structuredClone(config);
  changedGate.screeningGuards[0].expectedValue = 655;
  const changedReceipt = receipt({}, changedGate);
  assert.equal(classifyOffersIqReceipt(changedReceipt, changedGate).ruleListStatus, "mismatch",
    "a matching config and receipt cannot silently redefine the existing 660 screening gate");
});

test("valid failed legacy guards do not veto independent ranking or fill fractional range gaps", () => {
  const config = readyConfig();
  const declined = receipt({ creditScore: 650 }, config);
  declined.outcome = "not_matched";
  declined.decision_status = "DECLINED";
  declined.overall_decision = false;
  assert.equal(screeningCondition(declined, "creditScore", config).status, "FAILED");
  const result = classifyOffersIqReceipt(declined, config);
  assert.equal(result.ruleListStatus, "matched");
  assert.equal(result.bucket, "blueprint");
  for (const utilization of [9.5, 29.5, 49.5, 74.5]) {
    const source = receipt({ revolvingDebtUtilization: utilization }, config);
    const guard = screeningCondition(source, "revolvingDebtUtilization", config);
    assert.equal(guard.passed, utilization < 50);
    const ranked = classifyOffersIqReceipt(source, config);
    assert.equal(ranked.ruleListStatus, "matched");
    assert.equal(ranked.facts.revolvingDebtUtilization.status, "unknown");
    assert.equal(ranked.bucket, "blueprint");
  }
});

test("screening guard results cannot contradict known ranges or missing attribute evidence", () => {
  const config = readyConfig();
  for (const [values, factKey, status] of [
    [{}, "creditScore", "FAILED"],
    [{ creditScore: 650 }, "creditScore", "PASSED"],
    [{}, "revolvingDebtUtilization", "FAILED"],
    [{ revolvingDebtUtilization: 80 }, "revolvingDebtUtilization", "PASSED"],
    [{}, "creditScore", "UNVERIFIABLE"],
    [{ creditScore: null }, "creditScore", "PASSED"]
  ]) {
    const source = receipt(values, config);
    Object.assign(screeningCondition(source, factKey, config), { status, passed: status === "PASSED" });
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(result.ruleListStatus, "mismatch");
    assert.equal(result.bucket, "can_not_tell");
  }
  assert.equal(classify({ creditScore: null }, config).ruleListStatus, "matched");
});

test("legacy AND gates plus OR of the other 122 bands preserve screening across every valid score", () => {
  const config = readyConfig();
  const bands = config.facts.filter(fact => fact.enabled).flatMap(fact => fact.ranges.map(range =>
    ({ ...range, factKey: fact.key })));
  const diagnostic = bands.filter(rule => !(rule.factKey === "totalAdverseItemCount"
    && rule.operator === "EQUALS" && rule.expectedValue === 0));
  assert.equal(diagnostic.length, 122);
  const scoreGuard = config.screeningGuards.find(guard => guard.factKey === "creditScore");
  const utilizationGuard = config.screeningGuards.find(guard => guard.factKey === "revolvingDebtUtilization");
  const boundaries = [null, -10, -0.01, 0, 8.999999, 9, 9.000001, 9.5, 9.999999, 10,
    10.000001, 28.999999, 29, 29.000001, 29.5, 29.999999, 30, 30.000001, 48.999999,
    49, 49.000001, 49.5, 49.999999, 50, 50.000001, 74, 74.5, 74.999999, 75, 100,
    100.000001, 150, 10000];
  let compared = 0;
  for (let score = 300; score <= 850; score++) {
    const scoreBands = diagnostic.filter(rule => rule.factKey === "creditScore");
    assert.equal(scoreBands.filter(rule => satisfies(score, rule)).length, 1);
    for (const adverse of [null, 0, 1, 2, 10, 100]) for (const utilization of boundaries) {
      for (const optionalResult of [true, false, null]) {
        const oldScreen = score >= 660 && adverse === 0 && utilization !== null && utilization < 50;
        const group1 = satisfies(score, scoreGuard) && adverse === 0 && satisfies(utilization, utilizationGuard);
        // All other diagnostic results may be false or UNVERIFIABLE. The
        // exhaustive score bands alone guarantee Group2 for a known score.
        const group2 = scoreBands.some(rule => satisfies(score, rule)) || optionalResult === true;
        assert.equal(group1 && group2, oldScreen);
        compared++;
      }
    }
  }
  assert.equal(compared, 327294);
  for (const score of [null, undefined]) for (const adverse of [null, 0, 1]) {
    for (const utilization of boundaries) for (const optionalResult of [true, false, null]) {
      const group1 = satisfies(score, scoreGuard) && adverse === 0 && satisfies(utilization, utilizationGuard);
      const group2 = optionalResult === true;
      assert.equal(group1 && group2, false, "a missing score cannot pass either screening graph");
    }
  }
  const group = (operator, conditions, groups = []) => {
    const leaf = [...conditions, ...groups.flatMap(child => child.leaf)];
    const members = [...conditions, ...groups];
    const passed = operator === "AND" ? members.every(member => member.passed) : members.some(member => member.passed);
    return { operator, passed, status: passed ? "PASSED" : "FAILED", conditions, groups,
      totalConditions: leaf.length, passedConditions: leaf.filter(rule => rule.passed).length,
      failedConditions: leaf.filter(rule => rule.status === "FAILED").length,
      unverifiableConditions: leaf.filter(rule => rule.status === "UNVERIFIABLE").length, leaf };
  };
  for (const values of [{}, { creditScore: 650 }, { revolvingDebtUtilization: 49.5 },
    { creditScore: null }, { availableCredit: null, autoUtilization: null, totalScheduledMonthlyPayment: null }]) {
    const source = receipt(values, config);
    const baseline = [screeningCondition(source, "creditScore", config),
      screeningCondition(source, "revolvingDebtUtilization", config), source.individual_results.find(rule =>
        rule.attributeCode === "CRS_1440047" && rule.operator === "EQUALS" && rule.expectedValue === 0)];
    const remaining = source.individual_results.filter(rule => !baseline.includes(rule));
    assert.equal(remaining.length, 122);
    const root = group("AND", [], [group("AND", baseline), group("OR", remaining)]);
    const stripLeaves = value => {
      const { leaf, ...result } = value;
      return { ...result, groups: result.groups.map(stripLeaves) };
    };
    source.root_group = stripLeaves(root);
    source.condition_counts = { totalConditions: 125, passedConditions: root.passedConditions,
      failedConditions: root.failedConditions, unverifiableConditions: root.unverifiableConditions };
    source.overall_decision = root.passed;
    source.decision_status = root.passed ? "APPROVED" : "DECLINED";
    source.outcome = root.passed ? "matched" : "not_matched";
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(root.passed, baseline.every(rule => rule.passed));
    assert.equal(result.ruleListStatus, "matched");
    assert.deepEqual(result, classify(values, config), "ranking is unchanged by the preserved screening outcome");
  }
});

test("exact observed starter rules keep nothing-to-judge treatment after catalogue confirmation", () => {
  const source = starter();
  assert.equal(isOffersIqStarterReceipt(source), true);
  const result = classifyOffersIqReceipt(source);
  assert.equal(result.ruleListStatus, "starter");
  assert.equal(result.bucket, "can_not_tell");
  assert.equal(result.points, 0);
  assert.deepEqual(result.reasons, ["starter rule list"]);
  assert.equal(isOffersIqStarterReceipt(starter({ rule_set_id: 1232, environment: "sandbox" })), true);
  source.individual_results.reverse();
  assert.equal(isOffersIqStarterReceipt(source), true);
});

test("a different three-rule list, set, threshold, code, name or status is never a starter exemption", () => {
  const variants = [
    source => { source.individual_results[0].expectedValue = 620; },
    source => { source.individual_results[1].attributeCode = "CRS_1440015"; },
    source => { source.individual_results[1].attributeName = "Delinquent Accounts"; },
    source => { source.individual_results[2].operator = "LESS_THAN_OR_EQUALS"; },
    source => { source.individual_results[2].passed = false; },
    source => { source.rule_set_id = 9999; },
    source => { source.environment = "sandbox"; },
    source => { source.request_id = null; },
    source => { source.outcome = "needs_review"; source.reason = "request_id_missing"; },
    source => { source.reason = "ruleset_mismatch"; },
    source => { source.stale = true; },
    source => { source.individual_results.pop(); }
  ];
  for (const mutate of variants) {
    const source = starter();
    mutate(source);
    assert.equal(isOffersIqStarterReceipt(source), false);
    assert.equal(classifyOffersIqReceipt(source).ruleListStatus, "mismatch");
  }
});

test("unknown score is Can't tell, and a known score leaves that bucket", () => {
  const unknown = classify({ creditScore: null });
  assert.equal(unknown.bucket, "can_not_tell");
  assert.equal(unknown.ruleListStatus, "matched");
  assert.equal(unknown.facts.creditScore.status, "unknown");
  assert.equal(unknown.points, 0);
  assert.ok(unknown.reasons.includes("confirm the address"));
  assert.equal(classify({ creditScore: 800 }).bucket, "super_prime");
});

test("Super Prime starts at 800; 799 stays Prime", () => {
  assert.equal(classify({ creditScore: 800 }).bucket, "super_prime");
  assert.equal(classify({ creditScore: 850 }).bucket, "super_prime");
  assert.equal(classify({ creditScore: 799 }).bucket, "prime");
});

test("Prime starts at 750; 749 stays Blueprint", () => {
  assert.equal(classify({ creditScore: 750 }).bucket, "prime");
  assert.equal(classify({ creditScore: 749 }).bucket, "blueprint");
});

test("Blueprint starts at 620; a lower score is Not a fit yet", () => {
  assert.equal(classify({ creditScore: 620 }).bucket, "blueprint");
  assert.equal(classify({ creditScore: 619 }).bucket, "not_fit_yet");
  assert.equal(classify({ creditScore: 300 }).bucket, "not_fit_yet");
});

test("a high-score Prime failure falls to Blueprint, and passing all checks leaves Blueprint", () => {
  assert.equal(classify({ creditScore: 825, totalCollectionCount: 1 }).bucket, "blueprint");
  assert.equal(classify({ creditScore: 825, totalCollectionCount: 0 }).bucket, "super_prime");
  assert.equal(classify({ creditScore: 765, derogatoryAccountCount: 1 }).bucket, "blueprint");
  assert.equal(classify({ creditScore: 765, derogatoryAccountCount: 0 }).bucket, "prime");
});

for (const [fact, passing, failing] of [
  ["delinquencyPast12MonthCount", 0, 1],
  ["totalCollectionCount", 0, 1],
  ["derogatoryAccountCount", 0, 1],
  ["revolvingDebtUtilization", 29, 30]
]) {
  test(`Prime check ${fact} has pass, fail and unknown proof for Prime and Super Prime`, () => {
    for (const [score, bucket] of [[750, "prime"], [800, "super_prime"]]) {
      assert.equal(classify({ creditScore: score, [fact]: passing }).bucket, bucket);
      assert.equal(classify({ creditScore: score, [fact]: failing }).bucket, "blueprint");
      const unknown = classify({ creditScore: score, [fact]: null });
      assert.equal(unknown.bucket, "blueprint");
      assert.equal(unknown.facts[fact].status, "unknown");
      assert.match(unknown.reasons.join(" "), /unknown/);
    }
  });
}

test("monthly debt payments add points and never remove Prime eligibility", () => {
  const low = classify({ totalScheduledMonthlyPayment: 200 });
  const high = classify({ totalScheduledMonthlyPayment: 5000 });
  assert.equal(low.bucket, "super_prime");
  assert.equal(high.bucket, "super_prime");
  assert.equal(low.points - high.points, 15);
});

test("all score bands return a range, never an invented exact score", () => {
  const source = classify({ creditScore: 768 });
  assert.deepEqual(source.facts.creditScore,
    { status: "known", rangeId: "score_765", range: { min: 765, max: 769, label: "765-769" } });
  assert.equal(Object.hasOwn(source.facts.creditScore, "value"), false);
  assert.equal(Object.hasOwn(source, "creditScore"), false);
  assert.equal(source.facts.openBankruptcyPast84Months.status, "unknown");
});

test("all configured score boundary cases choose the intended bucket", () => {
  for (const [value, bucket] of [[619, "not_fit_yet"], [620, "blueprint"], [624, "blueprint"],
    [625, "blueprint"], [749, "blueprint"], [750, "prime"], [799, "prime"], [800, "super_prime"],
    [844, "super_prime"], [845, "super_prime"], [850, "super_prime"]]) {
    const result = classify({ creditScore: value });
    assert.equal(result.bucket, bucket, String(value));
    assert.equal(result.ruleListStatus, "matched");
    assert.ok(value >= result.facts.creditScore.range.min && value <= result.facts.creditScore.range.max);
  }
});

test("whole-number draft range gaps stay unknown, and missing auto data never means no car loan", () => {
  const fractional = classify({ revolvingDebtUtilization: 9.5, autoUtilization: 24.5,
    totalScheduledMonthlyPayment: 999.5 });
  assert.equal(fractional.ruleListStatus, "matched");
  assert.equal(fractional.bucket, "blueprint");
  for (const key of ["revolvingDebtUtilization", "autoUtilization", "totalScheduledMonthlyPayment"]) {
    assert.equal(fractional.facts[key].status, "unknown");
  }
  assert.equal(classify({ autoUtilization: null }).facts.autoUtilization.status, "unknown");
});

test("overall APPROVED and DECLINED are ignored for ranking", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  const approved = classifyOffersIqReceipt(source, config);
  source.decision_status = "DECLINED";
  source.overall_decision = false;
  source.outcome = "not_matched";
  assert.deepEqual(classifyOffersIqReceipt(source, config), approved);
});

test("insufficient data, provider errors and stale identity cannot receive a positive bucket", () => {
  const config = readyConfig();
  for (const fields of [{ decision_status: "INSUFFICIENT_DATA" }, { decision_status: "ERROR" },
    { outcome: "error" }, { stale: true }]) {
    const result = classifyOffersIqReceipt({ ...receipt({}, config), ...fields }, config);
    assert.equal(result.ruleListStatus, "matched");
    assert.equal(result.bucket, "can_not_tell");
    assert.equal(result.points, 0);
    assert.ok(result.reasons.includes("confirm the address"));
  }
});

test("trustworthy no-file receipts without evaluated rules are Can't tell, not a rule mismatch", () => {
  const source = { outcome: "needs_review", reason: "INSUFFICIENT_DATA", decision_status: "INSUFFICIENT_DATA",
    environment: "sandbox", rule_set_id: 1232, request_id: "20000000-0000-4000-8000-000000000001" };
  const result = classifyOffersIqReceipt(source);
  assert.equal(result.bucket, "can_not_tell");
  assert.equal(result.points, 0);
  assert.equal(result.ruleListStatus, "not_evaluated");
  assert.deepEqual(result.reasons, ["no credit file", "confirm the address"]);
  assert.ok(Object.values(result.facts).every(fact => fact.status === "unknown"));
  assert.equal(classifyOffersIqReceipt({ ...source, individual_results: [], condition_counts: { totalConditions: 0 } })
    .ruleListStatus, "not_evaluated");
  const raw = { decisionStatus: "INSUFFICIENT_DATA", overallDecision: false, ruleSetId: 1232,
    environment: "sandbox", requestId: source.request_id };
  assert.equal(classifyOffersIqReceipt(raw).ruleListStatus, "not_evaluated");
  assert.equal(classifyOffersIqReceipt({ status: "needs_review", normalized_response: source }).ruleListStatus,
    "not_evaluated");
});

test("no-file exemption requires a valid receipt, matching set and no partial or conflicting rule evidence", () => {
  const source = { outcome: "needs_review", reason: "INSUFFICIENT_DATA", decision_status: "INSUFFICIENT_DATA",
    environment: "production", rule_set_id: 1677, request_id: "20000000-0000-4000-8000-000000000001" };
  for (const overrides of [{ request_id: undefined }, { request_id: "not a receipt" }, { rule_set_id: 1232 },
    { environment: undefined }, { reason: "identity_changed" }, { decision_status: "ERROR" }, { outcome: "matched" },
    { overall_decision: true }, { overall_decision: "false" }, { decisionStatus: "APPROVED" }, { stale: true },
    { individual_results: [starter().individual_results[0]] }, { individual_results: null },
    { root_group: { operator: "OR", conditions: [] } }, { condition_counts: { totalConditions: 123 } }]) {
    const result = classifyOffersIqReceipt({ ...source, ...overrides });
    assert.equal(result.ruleListStatus, "mismatch", JSON.stringify(overrides));
    assert.equal(result.bucket, "can_not_tell");
  }
});

test("a complete rule list cannot grant a bucket without a durable unambiguous provider receipt", () => {
  const config = readyConfig();
  for (const overrides of [{ request_id: null }, { request_id: undefined }, { request_id: "not a receipt" },
    { requestId: "20000000-0000-4000-8000-000000000002" },
    { outcome: "needs_review", reason: "request_id_missing", request_id: null },
    { outcome: "needs_review", reason: "decision_missing_or_conflicting" },
    { outcome: "needs_review" }, { reason: "provider_uncertain" }]) {
    const result = classifyOffersIqReceipt({ ...receipt({}, config), ...overrides }, config);
    assert.equal(result.bucket, "can_not_tell", JSON.stringify(overrides));
    assert.equal(result.ruleListStatus, "mismatch");
    assert.equal(result.points, 0);
  }
});

test("raw and canonical decision, request, rule-set and environment fields must agree", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  const valid = { ...source, decisionStatus: source.decision_status,
    overall_decision: true, overallDecision: true, requestId: source.request_id, ruleSetId: "1677" };
  assert.equal(classifyOffersIqReceipt(valid, config).bucket, "super_prime");
  for (const overrides of [
    { decisionStatus: "ERROR" }, { decisionStatus: "DECLINED" }, { decisionStatus: null },
    { decision_status: "UNKNOWN", decisionStatus: "UNKNOWN" },
    { overallDecision: false }, { overallDecision: "true" },
    { requestId: "20000000-0000-4000-8000-000000000002" }, { ruleSetId: 1232 }
  ]) {
    const result = classifyOffersIqReceipt({ ...valid, ...overrides }, config);
    assert.equal(result.ruleListStatus, "mismatch", JSON.stringify(overrides));
    assert.equal(result.bucket, "can_not_tell");
    assert.equal(result.points, 0);
  }
  for (const row of [
    { normalized_response: source, rule_set_id: 1232 },
    { normalized_response: source, ruleSetId: 1232 },
    { normalized_response: source, environment: "sandbox" },
    { normalized_response: source, provider_request_id: "20000000-0000-4000-8000-000000000002" }
  ]) assert.equal(classifyOffersIqReceipt(row, config).ruleListStatus, "mismatch");
  const conflictingStarter = { ...starter(), decision_status: "APPROVED", decisionStatus: "ERROR" };
  assert.equal(isOffersIqStarterReceipt(conflictingStarter), false);
  assert.equal(classifyOffersIqReceipt(conflictingStarter, config).ruleListStatus, "mismatch");
});

test("missing, extra, duplicated, changed or ambiguous conditions fail the entire list closed", () => {
  const config = readyConfig();
  const variants = [
    source => { source.individual_results.pop(); },
    source => { source.individual_results.push({ ...source.individual_results[0], attributeCode: "EXTRA" }); },
    source => { source.individual_results[1] = { ...source.individual_results[0] }; },
    source => { source.individual_results[0].expectedValue = [300, 620]; },
    source => { source.individual_results[0].operator = "LESS_THAN"; },
    source => { source.individual_results[0].attributeName = "Wrong name"; },
    source => { source.individual_results[0].attributeCode = "Wrong_code"; },
    source => { source.individual_results[0].passed = true; source.individual_results[0].status = "PASSED"; },
    source => { source.individual_results.find(rule => rule.attributeCode === "CRS_1440047" && !rule.passed)
      .status = "UNVERIFIABLE"; },
    source => { source.rule_set_id = 9999; },
    source => { source.environment = "unknown"; }
  ];
  for (const mutate of variants) {
    const source = receipt({}, config);
    mutate(source);
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(result.bucket, "can_not_tell");
    assert.equal(result.ruleListStatus, "mismatch");
    assert.equal(result.points, 0);
    assert.equal(result.reasons[0], "rule list mismatch");
    assert.ok(Object.values(result.facts).every(fact => fact.status === "unknown"));
  }
});

test("malformed rule fields and unsupported thresholds cannot be treated as yes answers", () => {
  const config = readyConfig();
  for (const fields of [{ expectedValue: "300-619" }, { expectedValue: true }, { expectedValue: [300] },
    { expectedValue: [300, 619, 700] }, { expectedValue: [619, 300] }, { expectedValue: [300, Infinity] },
    { expectedValue: NaN }, { expectedValue: { min: 300, max: 619 } }, { status: "UNKNOWN" },
    { status: "PASSED", passed: false }, { passed: "true" }, { negated: true }, { negated: 0 }]) {
    const source = receipt({}, config);
    Object.assign(source.individual_results[0], fields);
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(result.ruleListStatus, "mismatch", JSON.stringify(fields));
    assert.equal(result.bucket, "can_not_tell");
  }
});

test("absent, passed-only and truncated lists cannot rank a lead", () => {
  const config = readyConfig();
  for (const source of [null, {}, { ...receipt({}, config), individual_results: undefined },
    { ...receipt({}, config), individual_results: [] },
    { ...receipt({}, config), individual_results: receipt({}, config).individual_results.filter(rule => rule.passed) },
    { ...receipt({}, config), individual_results: receipt({}, config).individual_results.slice(0, 100) },
    { ...receipt({}, config), individual_results: "not a list" },
    { ...receipt({}, config), outcome: "in_flight" }]) {
    assert.equal(classifyOffersIqReceipt(source, config).ruleListStatus, "mismatch");
  }
});

test("raw, normalized, row-wrapped and grouped receipts agree, regardless of condition order", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  const expected = classifyOffersIqReceipt(source, config);
  const conditions = structuredClone(source.individual_results).reverse();
  const raw = { ruleSetId: 1677, requestId: source.request_id, decisionStatus: "DECLINED", overallDecision: false,
    ruleEvaluation: { ruleSetId: "1677", individualResults: conditions,
      rootGroup: { operator: "AND", groups: [{ operator: "OR", conditions }] } } };
  assert.deepEqual(classifyOffersIqReceipt(raw, config), expected);
  assert.deepEqual(classifyOffersIqReceipt({ ...source, individual_results: conditions }, config), expected);
  assert.deepEqual(classifyOffersIqReceipt({ status: "matched", normalized_response: source }, config), expected);
  const groupedOnly = { ...source, individual_results: undefined, root_group: { operator: "OR", conditions } };
  assert.deepEqual(classifyOffersIqReceipt(groupedOnly, config), expected);
  assert.equal(classifyOffersIqReceipt({ ...raw, ruleEvaluation: { ...raw.ruleEvaluation, ruleSetId: "1232" } }, config)
    .ruleListStatus, "mismatch");
});

test("group contradictions, negation and cycles fail closed", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  source.root_group = { operator: "OR", conditions: structuredClone(source.individual_results) };
  source.root_group.conditions[0].status = "PASSED";
  source.root_group.conditions[0].passed = true;
  assert.equal(classifyOffersIqReceipt(source, config).ruleListStatus, "mismatch");
  source.root_group = { operator: "OR", negated: true, conditions: source.individual_results };
  assert.equal(classifyOffersIqReceipt(source, config).ruleListStatus, "mismatch");
  source.root_group = { operator: "OR", conditions: [] };
  source.root_group.groups = [source.root_group];
  assert.equal(classifyOffersIqReceipt(source, config).ruleListStatus, "mismatch");
});

test("counts, when returned, must agree with the complete condition list", () => {
  const config = readyConfig();
  const source = receipt({}, config);
  source.condition_counts = { totalConditions: 125,
    passedConditions: source.individual_results.filter(rule => rule.passed).length,
    failedConditions: source.individual_results.filter(rule => rule.status === "FAILED").length,
    unverifiableConditions: 0 };
  assert.equal(classifyOffersIqReceipt(source, config).ruleListStatus, "matched");
  for (const field of Object.keys(source.condition_counts)) {
    const malformed = structuredClone(source);
    malformed.condition_counts[field] += 1;
    assert.equal(classifyOffersIqReceipt(malformed, config).ruleListStatus, "mismatch");
  }
});

test("Blueprint points reward each configured line without double-counting both loan proofs", () => {
  const config = readyConfig();
  const base = classify({ creditScore: 620 }, config);
  assert.equal(base.points, 70);
  assert.equal(classify({ creditScore: 745 }, config).points, 99);
  assert.equal(classify({ creditScore: 620, onTimePaymentPercentage: 89 }, config).points, base.points - 20);
  assert.equal(classify({ creditScore: 620, openInstallmentAccountCount: 0, autoUtilization: 80 }, config).points,
    base.points - 20);
  assert.equal(classify({ creditScore: 620, totalAdverseItemCount: 10 }, config).points, base.points - 15);
  assert.equal(classify({ creditScore: 620, delinquencyPast12MonthCount: 3 }, config).points, base.points - 10);
  assert.equal(classify({ creditScore: 620, revolvingDebtUtilization: 80 }, config).points, base.points - 5);
  assert.equal(classify({ creditScore: 620, openInstallmentAccountCount: null, autoUtilization: 10 }, config).points, base.points);
});

test("Prime points reward all six lines, and Super Prime uses its own score span", () => {
  const config = readyConfig();
  const base = classify({ creditScore: 750 }, config);
  assert.equal(base.points, 70);
  assert.equal(classify({ creditScore: 795 }, config).points, 98);
  assert.equal(classify({ creditScore: 800 }, config).points, 70);
  assert.equal(classify({ creditScore: 845 }, config).points, 97);
  assert.equal(classify({ creditScore: 750, revolvingDebtUtilization: 20 }, config).points, base.points - 10);
  assert.equal(classify({ creditScore: 750, totalScheduledMonthlyPayment: 5000 }, config).points, base.points - 15);
  assert.equal(classify({ creditScore: 750, availableCredit: 0 }, config).points, base.points - 15);
  assert.equal(classify({ creditScore: 750, inquiryCount: 6 }, config).points, base.points - 10);
  assert.equal(classify({ creditScore: 750, openRevolvingAccountCount: 2 }, config).points, base.points - 5);
  assert.equal(classify({ creditScore: 750, openRevolvingAccountCount: 9 }, config).points, base.points);
  assert.equal(classify({ creditScore: 750, openRevolvingAccountCount: 10 }, config).points, base.points - 5);
});

test("unknown points lines earn zero and do not rescale the remaining points", () => {
  const result = classify({ creditScore: 620, onTimePaymentPercentage: null,
    openInstallmentAccountCount: null, autoUtilization: null, totalAdverseItemCount: null,
    delinquencyPast12MonthCount: null, revolvingDebtUtilization: null });
  assert.equal(result.bucket, "blueprint");
  assert.equal(result.points, 0);
  const prime = classify({ creditScore: 750, totalScheduledMonthlyPayment: null,
    availableCredit: null, inquiryCount: null, openRevolvingAccountCount: null });
  assert.equal(prime.bucket, "prime");
  assert.equal(prime.points, 25);
});

test("question/range, bucket thresholds and points can change through versioned config alone", () => {
  const config = readyConfig();
  config.version = "test-next-version";
  config.buckets.superPrimeFloor = 805;
  config.points.prime.find(line => line.fact === "inquiryCount").values.zero = 1;
  const result = classify({ creditScore: 800 }, config);
  assert.equal(result.bucket, "prime");
  assert.equal(result.version, "test-next-version");
  assert.equal(result.points, 91);
  const score = config.facts.find(fact => fact.key === "creditScore");
  score.ranges = score.ranges.filter(range => range.min < 620 || range.min > 624);
  score.ranges.push({ id: "score_620_624_new", label: "620-624", min: 620, max: 624,
    operator: "BETWEEN", expectedValue: [620, 624] });
  assert.equal(classify({ creditScore: 620 }, config).facts.creditScore.rangeId, "score_620_624_new");
});

test("points stay within 0-100 after a draft weight change", () => {
  const config = readyConfig();
  config.version = "test-high-weight";
  config.points.prime.find(line => line.fact === "availableCredit").values.fifty_thousand_plus = 150;
  assert.equal(classify({}, config).points, 100);
  config.points.prime.find(line => line.fact === "availableCredit").values.fifty_thousand_plus = -150;
  assert.equal(classify({}, config).points, 0);
});

test("pure bucket and points helpers use the same retained facts as the receipt classifier", () => {
  const config = readyConfig();
  const result = classify({ creditScore: 770 }, config);
  assert.deepEqual(bucketOffersIqFacts(result.facts, config), { bucket: result.bucket, reasons: result.reasons });
  assert.equal(scoreOffersIqFacts(result.bucket, result.facts, config), result.points);
  assert.equal(scoreOffersIqFacts("not_fit_yet", result.facts, config), 0);
  const crossing = structuredClone(result.facts);
  crossing.creditScore.range = { min: 610, max: 630 };
  assert.equal(bucketOffersIqFacts(crossing, config).bucket, "can_not_tell");
  crossing.creditScore.range = { min: 200, max: 250 };
  assert.equal(bucketOffersIqFacts(crossing, config).bucket, "can_not_tell");
});

test("malformed config and mismatched range metadata fail closed instead of granting a bucket", () => {
  const variants = [
    config => { delete config.buckets; },
    config => { config.maximumQuestions = 100; },
    config => { config.facts[0].ranges[0].min = 800; config.facts[0].ranges[0].max = 850; },
    config => { config.facts[1].attributeCode = config.facts[0].attributeCode; },
    config => { config.facts[0].ranges[1].id = config.facts[0].ranges[0].id; }
  ];
  for (const mutate of variants) {
    const config = readyConfig();
    const source = receipt({}, config);
    mutate(config);
    const result = classifyOffersIqReceipt(source, config);
    assert.equal(result.ruleListStatus, "mismatch");
    assert.equal(result.bucket, "can_not_tell");
  }
});
