import { OFFERSIQ_LEAD_SORT_CONFIG, OFFERSIQ_STARTER_RULES } from "./offersiq-lead-sort-config.mjs";

const FINISHED = new Set(["matched", "not_matched", "needs_review", "error"]);
const STATUSES = new Set(["PASSED", "FAILED", "UNVERIFIABLE"]);
const DECISIONS = new Set(["APPROVED", "DECLINED", "INSUFFICIENT_DATA", "ERROR"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const plain = value => !!value && typeof value === "object" && !Array.isArray(value);
const finite = value => typeof value === "number" && Number.isFinite(value);

function threshold(value) {
  return finite(value) || (Array.isArray(value) && value.length === 2
    && value.every(finite) && value[0] <= value[1]);
}

function signature(rule) {
  if (!plain(rule) || typeof rule.attributeCode !== "string" || !rule.attributeCode
      || typeof rule.attributeName !== "string" || !rule.attributeName
      || typeof rule.operator !== "string" || !threshold(rule.expectedValue)
      || (rule.negated !== undefined && rule.negated !== false)) return null;
  return JSON.stringify([rule.attributeCode, rule.attributeName, rule.operator, rule.expectedValue]);
}

function conditionKey(rule) {
  const key = signature(rule);
  if (!key || !STATUSES.has(rule.status) || typeof rule.passed !== "boolean"
      || rule.passed !== (rule.status === "PASSED")) return null;
  return `${key}:${rule.status}`;
}

function unpack(input) {
  const receipt = plain(input?.normalized_response) ? input.normalized_response : input;
  if (!plain(receipt)) return { error: "receipt missing" };
  if ((receipt.outcome !== undefined && !FINISHED.has(receipt.outcome))
      || (input?.status !== undefined && !FINISHED.has(input.status))) return { error: "check not finished" };
  for (const [canonical, raw, valid] of [
    ["decision_status", "decisionStatus", value => DECISIONS.has(value)],
    ["overall_decision", "overallDecision", value => typeof value === "boolean"]
  ]) {
    if ((receipt[canonical] !== undefined && !valid(receipt[canonical]))
        || (receipt[raw] !== undefined && !valid(receipt[raw]))
        || (receipt[canonical] !== undefined && receipt[raw] !== undefined && receipt[canonical] !== receipt[raw])) {
      return { error: "decision fields malformed or conflicting" };
    }
  }
  const rawEvaluation = receipt.ruleEvaluation;
  if (rawEvaluation !== undefined && !plain(rawEvaluation)) return { error: "rule evaluation malformed" };
  const evaluation = rawEvaluation || receipt;
  const ruleSetId = receipt.rule_set_id ?? receipt.ruleSetId ?? input?.rule_set_id;
  const numericId = typeof ruleSetId === "string" && /^\d+$/.test(ruleSetId) ? Number(ruleSetId) : ruleSetId;
  if (!Number.isSafeInteger(numericId) || numericId <= 0
      || (rawEvaluation?.ruleSetId !== undefined && Number(rawEvaluation.ruleSetId) !== numericId)
      || (receipt.ruleSetId !== undefined && Number(receipt.ruleSetId) !== numericId)
      || (input?.rule_set_id !== undefined && Number(input.rule_set_id) !== numericId)
      || (input?.ruleSetId !== undefined && Number(input.ruleSetId) !== numericId)
      || (receipt.environment !== undefined && input?.environment !== undefined
        && receipt.environment !== input.environment)) {
    return { error: "rule set missing or conflicting" };
  }
  return { receipt, evaluation, ruleSetId: numericId,
    environment: receipt.environment ?? input?.environment,
    flat: rawEvaluation ? evaluation.individualResults : receipt.individual_results,
    root: rawEvaluation ? evaluation.rootGroup : receipt.root_group,
    counts: rawEvaluation ? evaluation : receipt.condition_counts };
}

function trustworthyNoData(input, config) {
  const unpacked = unpack(input);
  if (unpacked.error) return false;
  const { receipt, flat, root, counts, ruleSetId, environment } = unpacked;
  if (!config?.ruleSetIds?.[environment]?.includes(ruleSetId)
      || receipt.stale === true || receipt.outcome === "error") return false;
  const decision = receipt.decision_status ?? receipt.decisionStatus;
  if (decision !== "INSUFFICIENT_DATA"
      || (receipt.decision_status !== undefined && receipt.decisionStatus !== undefined
        && receipt.decision_status !== receipt.decisionStatus)
      || (receipt.outcome !== undefined && receipt.outcome !== "needs_review")
      || (receipt.outcome !== undefined && receipt.reason !== "INSUFFICIENT_DATA")
      || (receipt.reason !== undefined && receipt.reason !== "INSUFFICIENT_DATA")) return false;
  for (const key of ["overall_decision", "overallDecision"]) {
    if (receipt[key] !== undefined && receipt[key] !== false) return false;
  }
  if (!hasProviderReceipt(receipt, input)) return false;
  // CRS returns no evaluated rules for a no-file result. Any nonempty list,
  // group, or positive count is partial evidence and must take the mismatch path.
  if ((flat !== undefined && (!Array.isArray(flat) || flat.length !== 0)) || root !== undefined
      || (counts !== undefined && !plain(counts))) return false;
  return ["totalConditions", "passedConditions", "failedConditions", "unverifiableConditions"]
    .every(key => counts?.[key] === undefined || counts[key] === 0);
}

function hasProviderReceipt(receipt, input) {
  const ids = [receipt.request_id, receipt.requestId, input?.provider_request_id].filter(value => value !== undefined);
  return ids.length > 0 && ids.every(value => typeof value === "string" && UUID.test(value) && value === ids[0]);
}

function groupedConditions(root, limit, depth = 0, seen = new Set()) {
  if (!plain(root) || depth > 8 || seen.has(root) || !["AND", "OR"].includes(root.operator)
      || (root.negated !== undefined && root.negated !== false)
      || (root.conditions !== undefined && !Array.isArray(root.conditions))
      || (root.groups !== undefined && !Array.isArray(root.groups))) return null;
  seen.add(root);
  const list = [...(root.conditions || [])];
  for (const child of root.groups || []) {
    const conditions = groupedConditions(child, limit, depth + 1, seen);
    if (!conditions) return null;
    list.push(...conditions);
    if (list.length > limit) return null;
  }
  return list.length <= limit ? list : null;
}

function readConditions(unpacked, limit = 512) {
  if (unpacked.error) return { error: unpacked.error };
  const { flat, root, counts } = unpacked;
  if (flat !== undefined && !Array.isArray(flat)) return { error: "condition list malformed" };
  const grouped = root === undefined ? undefined : groupedConditions(root, limit);
  if (grouped === null) return { error: "group list malformed" };
  const conditions = flat ?? grouped;
  if (!Array.isArray(conditions) || !conditions.length || conditions.length > limit) {
    return { error: "complete condition list missing" };
  }
  const keys = conditions.map(conditionKey);
  if (keys.some(key => key === null)) return { error: "condition malformed" };
  if (flat !== undefined && grouped !== undefined) {
    const groupKeys = grouped.map(conditionKey).sort();
    if (groupKeys.some(key => key === null) || JSON.stringify([...keys].sort()) !== JSON.stringify(groupKeys)) {
      return { error: "flat and grouped lists differ" };
    }
  }
  const actualCounts = {
    totalConditions: conditions.length,
    passedConditions: conditions.filter(rule => rule.status === "PASSED").length,
    failedConditions: conditions.filter(rule => rule.status === "FAILED").length,
    unverifiableConditions: conditions.filter(rule => rule.status === "UNVERIFIABLE").length
  };
  if (counts !== undefined && !plain(counts)) return { error: "condition counts malformed" };
  for (const [key, count] of Object.entries(actualCounts)) {
    if (counts?.[key] !== undefined && counts[key] !== count) return { error: "condition counts differ" };
  }
  return { conditions };
}

function matchesList(conditions, expected) {
  if (conditions.length !== expected.length) return false;
  const actual = conditions.map(signature).sort();
  const wanted = expected.map(signature).sort();
  return !actual.includes(null) && !wanted.includes(null)
    && new Set(actual).size === actual.length && JSON.stringify(actual) === JSON.stringify(wanted);
}

export function isOffersIqStarterReceipt(receipt) {
  const unpacked = unpack(receipt);
  if (unpacked.error || ![1677, 1232].includes(unpacked.ruleSetId)) return false;
  if (!hasProviderReceipt(unpacked.receipt, receipt) || unpacked.receipt.stale === true
      || (unpacked.receipt.outcome !== undefined && !["matched", "not_matched"].includes(unpacked.receipt.outcome))
      || unpacked.receipt.reason != null
      || ["INSUFFICIENT_DATA", "ERROR"].includes(unpacked.receipt.decision_status ?? unpacked.receipt.decisionStatus)) return false;
  if ((unpacked.environment === "production" && unpacked.ruleSetId !== 1677)
      || (unpacked.environment === "sandbox" && unpacked.ruleSetId !== 1232)
      || (unpacked.environment !== undefined && !["production", "sandbox"].includes(unpacked.environment))) return false;
  const read = readConditions(unpacked);
  return !read.error && matchesList(read.conditions, OFFERSIQ_STARTER_RULES);
}

const unknownFact = () => ({ status: "unknown", rangeId: null, range: null });

function configuredRules(config) {
  if (!plain(config) || typeof config.version !== "string" || !config.version
      || !Array.isArray(config.facts) || !Number.isSafeInteger(config.maximumQuestions)
      || config.maximumQuestions < 1 || config.maximumQuestions > 512
      || !plain(config.buckets) || !plain(config.points) || !Array.isArray(config.primeChecks)) {
    return { error: "config malformed" };
  }
  const limits = ["scoreMinimum", "blueprintFloor", "primeFloor", "superPrimeFloor", "scoreCeiling"]
    .map(key => config.buckets[key]);
  if (!limits.every(finite) || limits.some((value, index) => index > 0 && value < limits[index - 1])
      || !finite(config.points.minimum) || !finite(config.points.maximum)
      || config.points.minimum !== 0 || config.points.maximum !== 100 || config.points.unknown !== 0
      || !Array.isArray(config.points.blueprint) || !Array.isArray(config.points.prime)
      || !plain(config.points.superPrimeScore)) return { error: "config scoring malformed" };
  const expected = [];
  const keys = new Set();
  const codes = new Set();
  for (const fact of config.facts) {
    if (!plain(fact) || typeof fact.key !== "string" || !fact.key || keys.has(fact.key)) {
      return { error: "config facts malformed" };
    }
    keys.add(fact.key);
    if (fact.enabled === false) continue;
    if (typeof fact.attributeCode !== "string" || !fact.attributeCode
        || codes.has(fact.attributeCode) || !Array.isArray(fact.ranges) || !fact.ranges.length) {
      return { error: "config attribute codes pending or conflicting" };
    }
    codes.add(fact.attributeCode);
    const rangeIds = new Set();
    for (const range of fact.ranges) {
      const rule = { attributeCode: fact.attributeCode, attributeName: fact.attributeName,
        operator: range.operator, expectedValue: range.expectedValue, fact, range };
      if (!signature(rule) || typeof range.id !== "string" || !range.id || rangeIds.has(range.id)
          || !finite(range.min) || (range.max !== null && (!finite(range.max) || range.min > range.max))
          || !rangeAgreesWithThreshold(range)) {
        return { error: "config ranges malformed" };
      }
      rangeIds.add(range.id);
      expected.push(rule);
    }
  }
  if (!expected.length || expected.length > config.maximumQuestions) return { error: "config question limit exceeded" };
  return { expected };
}

function rangeAgreesWithThreshold(range) {
  const expected = range.expectedValue;
  if (range.operator === "EQUALS") return finite(expected) && range.min === expected && range.max === expected
    && !range.maxExclusive;
  if (range.operator === "BETWEEN") return Array.isArray(expected) && range.min === expected[0]
    && range.max === expected[1] && !range.maxExclusive;
  if (range.operator === "GREATER_THAN_OR_EQUALS") return finite(expected) && range.min === expected
    && range.max === null && !range.maxExclusive;
  return range.operator === "LESS_THAN" && finite(expected) && range.min === 0
    && range.max === expected && range.maxExclusive === true;
}

function rangePasses(range, check) {
  if (!range || !finite(check.value)) return false;
  if (check.operator === "EQUALS") return range.min === check.value && range.max === check.value;
  if (check.operator === "LESS_THAN") return range.max !== null
    && (range.max < check.value || (range.max === check.value && range.maxExclusive === true));
  if (check.operator === "LESS_THAN_OR_EQUALS") return range.max !== null && range.max <= check.value;
  if (check.operator === "GREATER_THAN_OR_EQUALS") return range.min >= check.value;
  if (check.operator === "GREATER_THAN") return range.min > check.value;
  return false;
}

/** Pure bucket rules over retained ranges, never reconstructed exact values. */
export function bucketOffersIqFacts(facts, config = OFFERSIQ_LEAD_SORT_CONFIG) {
  const score = facts?.creditScore;
  if (score?.status !== "known" || !score.range || !finite(score.range.min)
      || !finite(score.range.max)) return { bucket: "can_not_tell", reasons: ["score unknown", "confirm the address"] };
  const { scoreMinimum, blueprintFloor, primeFloor, superPrimeFloor, scoreCeiling } = config.buckets;
  if (score.range.max > scoreCeiling || score.range.min < scoreMinimum) {
    return { bucket: "can_not_tell", reasons: ["score range outside model"] };
  }
  if (score.range.max < blueprintFloor) return { bucket: "not_fit_yet", reasons: ["score below Blueprint range"] };
  if (score.range.min < blueprintFloor) return { bucket: "can_not_tell", reasons: ["score range crosses Blueprint floor"] };
  const failed = config.primeChecks.flatMap(check => {
    const fact = facts?.[check.fact];
    return fact?.status !== "known" ? [`${check.reason} unknown`]
      : rangePasses(fact.range, check) ? [] : [`${check.reason} outside Prime range`];
  });
  if (score.range.min >= superPrimeFloor && failed.length === 0) {
    return { bucket: "super_prime", reasons: ["score in Super Prime range", "Prime checks passed"] };
  }
  if (score.range.min >= primeFloor && failed.length === 0) {
    return { bucket: "prime", reasons: ["score in Prime range", "Prime checks passed"] };
  }
  return { bucket: "blueprint", reasons: ["score in Blueprint range", ...failed] };
}

function linePoints(line, facts, unknown) {
  if (line.mode === "best") return Math.max(unknown, ...line.lines.map(item => linePoints(item, facts, unknown)));
  const fact = facts?.[line.fact];
  if (fact?.status !== "known") return unknown;
  if (line.mode === "ranges") return finite(line.values?.[fact.rangeId]) ? line.values[fact.rangeId] : unknown;
  if (line.mode === "linear" && finite(fact.range?.min) && line.to > line.from) {
    return Math.min(line.maximum, Math.max(0, (fact.range.min - line.from) / (line.to - line.from) * line.maximum));
  }
  return unknown;
}

/** Unknown facts add no points; an unknown line never increases other weights. */
export function scoreOffersIqFacts(bucket, facts, config = OFFERSIQ_LEAD_SORT_CONFIG) {
  const points = config.points;
  let lines = bucket === "blueprint" ? points.blueprint : ["prime", "super_prime"].includes(bucket) ? points.prime : [];
  if (bucket === "super_prime") lines = lines.map(line => line.mode === "linear" && line.fact === "creditScore"
    ? points.superPrimeScore : line);
  const sum = lines.reduce((total, line) => total + linePoints(line, facts, points.unknown), 0);
  return Math.round(Math.max(points.minimum, Math.min(points.maximum, sum)));
}

/** Finished retained receipt -> internal bucket, points and traceable ranges. */
export function classifyOffersIqReceipt(receipt, config = OFFERSIQ_LEAD_SORT_CONFIG) {
  const facts = Object.fromEntries((Array.isArray(config?.facts) ? config.facts : [])
    .filter(plain).map(fact => [fact.key, unknownFact()]));
  const base = { bucket: "can_not_tell", points: 0, version: config?.version || "unknown",
    reasons: [], facts, ruleListStatus: "mismatch" };
  if (isOffersIqStarterReceipt(receipt)) {
    return { ...base, reasons: ["starter rule list"], ruleListStatus: "starter" };
  }
  if (trustworthyNoData(receipt, config)) {
    return { ...base, reasons: ["no credit file", "confirm the address"], ruleListStatus: "not_evaluated" };
  }
  const fail = detail => ({ ...base, facts: Object.fromEntries(Object.keys(facts).map(key => [key, unknownFact()])),
    reasons: ["rule list mismatch", detail] });
  const configured = configuredRules(config);
  if (configured.error) return fail(configured.error);
  const unpacked = unpack(receipt);
  const read = readConditions(unpacked, config.maximumQuestions);
  if (read.error) return fail(read.error);
  const allowedIds = unpacked.environment === undefined ? Object.values(config.ruleSetIds || {}).flat()
    : config.ruleSetIds?.[unpacked.environment] || [];
  if (!allowedIds.includes(unpacked.ruleSetId)) return fail("unexpected rule set");
  if (!matchesList(read.conditions, configured.expected)) return fail("conditions differ from configured list");
  if (!hasProviderReceipt(unpacked.receipt, receipt)) return fail("provider receipt missing or conflicting");
  const status = unpacked.receipt.decision_status ?? unpacked.receipt.decisionStatus;
  if ((unpacked.receipt.outcome === "needs_review" && status !== "INSUFFICIENT_DATA")
      || (unpacked.receipt.reason != null && unpacked.receipt.reason !== "INSUFFICIENT_DATA")) {
    return fail("receipt needs review");
  }
  const answers = new Map(read.conditions.map(rule => [signature(rule), rule]));
  for (const fact of config.facts.filter(item => item.enabled !== false)) {
    const rules = configured.expected.filter(rule => rule.fact === fact);
    const passed = rules.filter(rule => answers.get(signature(rule)).status === "PASSED");
    const unverifiable = rules.filter(rule => answers.get(signature(rule)).status === "UNVERIFIABLE");
    if (passed.length > 1 || (passed.length && unverifiable.length)) {
      return fail("ambiguous ranges for one fact");
    }
    if (passed.length === 1) {
      const range = passed[0].range;
      facts[fact.key] = { status: "known", rangeId: range.id,
        range: { min: range.min, max: range.max, label: range.label,
          ...(range.maxExclusive ? { maxExclusive: true } : {}) } };
    }
  }
  if (unpacked.receipt.stale || ["INSUFFICIENT_DATA", "ERROR"].includes(status)
      || unpacked.receipt.outcome === "error") {
    return { ...base, facts, ruleListStatus: "matched", reasons: [unpacked.receipt.stale
      ? "identity needs review" : "not enough data", "confirm the address"] };
  }
  const result = bucketOffersIqFacts(facts, config);
  return { ...base, ...result, facts, points: scoreOffersIqFacts(result.bucket, facts, config), ruleListStatus: "matched" };
}
