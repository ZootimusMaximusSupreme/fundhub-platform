import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateLeadFitModels, LEAD_FIT_MODELS, LEAD_FIT_MODEL_VERSION } from "./lead-fit-models.mjs";

function score(value, overrides = {}) {
  return { bureau: "TU", score: value, model: "FICO 9", source: "crs_prequal",
    asOf: "2026-11-04T18:00:00Z", ...overrides };
}

function byId(input) {
  return Object.fromEntries(evaluateLeadFitModels(input).map(card => [card.model, card]));
}

test("four adaptable draft cards exist; Real Estate has no universal score floor", () => {
  const cards = evaluateLeadFitModels();
  assert.deepEqual(LEAD_FIT_MODELS.map(model => model.scoreFloor), [620, 750, 800, null]);
  assert.deepEqual(cards.map(card => card.outcome),
    ["needs_data", "needs_data", "needs_data", "needs_data"]);
  assert.equal(cards.length, 4);
  for (const card of cards) {
    assert.equal(card.version, LEAD_FIT_MODEL_VERSION);
    assert.equal(card.draft, true);
    assert.equal(card.lenderApproval, false);
    assert.equal(card.scoreChecks.length, 0);
    assert.equal(card.pendingCriteria.length, 4);
    assert.equal(card.policyStatus, "draft_pending_lender_policy");
    assert.equal(card.pendingCriteria.find(item => item.criterion === "liquid_assets").observedValue, null);
    assert.equal("calendar" in card, false);
  }
  assert.equal(cards[3].scoreFloor, null);
  assert.equal(cards[3].scoreFloorStatus, "no_universal_floor");
  assert.equal(cards[3].thresholdSource, "no_universal_real_estate_floor");
  assert.deepEqual(cards[3].supportingChecks, []);
  assert.deepEqual(cards[3].icpPaths.map(path => path.id),
    ["real_estate_entrant", "homeowner_capital"]);
  assert.equal(cards[3].icpPaths[0].scoreFloor, 700);
  assert.equal(cards[3].icpPaths[1].scoreFloor, null);
  assert.equal(cards[3].icpPaths[1].supportingChecks.every(check => check.status === "missing"), true);
  assert.deepEqual(cards.slice(0, 3).map(card => card.scoreFloorStatus),
    ["provisional", "provisional", "provisional"]);
});

test("score floors use exact 619/620, 749/750 and 799/800 boundaries", () => {
  const expected = new Map([
    [619, ["below_score_floor", "below_score_floor", "below_score_floor"]],
    [620, ["score_floor_met", "below_score_floor", "below_score_floor"]],
    [749, ["score_floor_met", "below_score_floor", "below_score_floor"]],
    [750, ["score_floor_met", "score_floor_met", "below_score_floor"]],
    [799, ["score_floor_met", "score_floor_met", "below_score_floor"]],
    [800, ["score_floor_met", "score_floor_met", "score_floor_met"]]
  ]);
  for (const [value, outcomes] of expected) {
    const cards = evaluateLeadFitModels({ creditScores: [score(value)] });
    assert.deepEqual(cards.slice(0, 3).map(card => card.outcome), outcomes, `score ${value}`);
    assert.equal(cards[3].outcome, "needs_data");
    assert.deepEqual(cards[3].scoreChecks, []);
  }
});

test("scores remain separate by bureau and model, with no blended or invented FICO", () => {
  const cards = byId({ creditScores: [
    score(619, { bureau: "TU", model: "FICO 9" }),
    score(801, { bureau: "EQ", model: null, source: "equifax_soft_report" }),
    score(748, { bureau: "EX", model: "VantageScore 4.0" })
  ] });
  assert.equal(cards.blueprint.outcome, "score_floor_met");
  assert.equal(cards.prime_funding.outcome, "score_floor_met");
  assert.equal(cards.super_prime.outcome, "score_floor_met");
  assert.deepEqual(cards.super_prime.scoreChecks.map(check => [check.bureau, check.score, check.status]),
    [["TU", 619, "below"], ["EQ", 801, "meets"], ["EX", 748, "below"]]);
  assert.equal(cards.super_prime.scoreChecks[1].model, null);
  assert.equal("blendedScore" in cards.super_prime, false);
});

test("samples, sandbox sources, income models and unscorable values cannot meet a floor", () => {
  const cards = byId({ creditScores: [
    score(820, { sample: true }),
    score(810, { source: "crs_sandbox" }),
    score(810, { model: "Income Insight" }),
    score(97),
    score(Number.NaN),
    score(820, { bureau: "unknown" }),
    score(750, { source: "" })
  ] });
  assert.equal(cards.blueprint.outcome, "needs_data");
  assert.deepEqual(cards.prime_funding.scoreChecks, []);
  assert.equal(cards.super_prime.outcome, "needs_data");
  assert.equal(cards.real_estate.outcome, "needs_data");
});

test("Real Estate entrant alone has a proposed 699/700 focus, without an ownership prerequisite", () => {
  const below = byId({ creditScores: [score(699)] }).real_estate;
  const at = byId({ creditScores: [score(700)], property: {
    isHomeowner: false
  } }).real_estate;
  const entrantBelow = below.icpPaths[0];
  const entrantAt = at.icpPaths[0];
  assert.equal(below.outcome, "needs_data");
  assert.equal(at.outcome, "needs_data");
  assert.equal(entrantBelow.outcome, "below_score_floor");
  assert.equal(entrantAt.outcome, "score_floor_met");
  assert.equal(entrantAt.scoreChecks[0].floor, 700);
  assert.equal(entrantAt.scoreFloorStatus, "proposed_entrant_focus_only");
  assert.equal(entrantAt.homeownershipRequired, false);
  assert.equal(entrantAt.supportingChecks[0].status, "missing");
  assert.equal(entrantAt.supportingChecks[1].status, "criteria_not_configured");
  assert.equal(entrantAt.supportingChecks.some(check => check.criterion === "homeowner"), false);
  assert.equal(at.lenderApproval, false);
});

test("homeowner path has no 700 gate, and project or combined target stays open above 500k", () => {
  const at = byId({ creditScores: [score(620)], property: {
    isHomeowner: true, householdAnnualIncome: 200000, projectBudget: 75000,
    hasContractorEstimate: true
  } }).real_estate;
  const homeowner = at.icpPaths[1];
  assert.equal(at.scoreFloor, null);
  assert.equal(homeowner.outcome, "needs_configuration");
  assert.equal(homeowner.scoreFloor, null);
  assert.deepEqual(homeowner.scoreChecks, []);
  assert.deepEqual(homeowner.supportingChecks.map(check => check.status),
    ["ideal", "ideal", "ideal", "ideal"]);
  assert.equal(homeowner.supportingChecks[1].documentationVerified, null);
  assert.deepEqual(homeowner.supportingChecks[2].requestMarkers,
    [75000, 100000, 175000, 250000, 500000]);
  assert.equal(homeowner.supportingChecks[2].facilityStackingDependsOnProgram, true);
  assert.equal(at.lenderApproval, false);
  const highEnd = byId({ property: { isHomeowner: true, householdAnnualIncome: 350000,
    projectBudget: 500000, hasContractorEstimate: true } }).real_estate.icpPaths[1];
  assert.deepEqual(highEnd.supportingChecks.map(check => check.status),
    ["ideal", "ideal", "ideal", "ideal"]);
  const combined = byId({ property: { isHomeowner: true, householdAnnualIncome: 350001,
    combinedFinancingTarget: 625000, hasContractorEstimate: true } }).real_estate.icpPaths[1];
  assert.equal(combined.supportingChecks[2].status, "ideal");
  assert.deepEqual(combined.supportingChecks[2].observedValue,
    { projectBudget: null, combinedFinancingTarget: 625000 });
  const outside = byId({ property: { isHomeowner: false, householdAnnualIncome: 199999,
    projectBudget: 74999, hasContractorEstimate: false } }).real_estate.icpPaths[1];
  assert.deepEqual(outside.supportingChecks.map(check => check.status),
    ["out_of_band", "out_of_band", "out_of_band", "out_of_band"]);
  assert.equal(outside.supportingChecks.every(check => check.disqualifying === false), true);
  assert.equal(outside.outcome, "needs_configuration");
  const partial = byId({ property: { projectBudget: 100000 } }).real_estate.icpPaths[1];
  assert.deepEqual(partial.supportingChecks.map(check => check.status),
    ["missing", "missing", "ideal", "missing"]);
  const noOwnershipInference = byId({ creditScores: [score(780)], mortgageTradelineCount: 2,
    property: { projectBudget: 100000 } }).real_estate.icpPaths[1];
  assert.equal(noOwnershipInference.supportingChecks[0].status, "missing");
});

test("tentative Blueprint bankruptcy and paid-auto checks keep zero distinct from missing", () => {
  const unknown = byId({ creditScores: [score(620)], openAutoCount: 3 }).blueprint;
  assert.deepEqual(unknown.supportingChecks.map(item => item.status), ["missing", "missing"]);
  assert.equal(unknown.outcome, "score_floor_met");
  const zero = byId({ bankruptcyCount: 0, paidOffAutoCount: 0 }).blueprint;
  assert.deepEqual(zero.supportingChecks.map(item => [item.status, item.observedValue]),
    [["meets", 0], ["fails", 0]]);
  const meets = byId({ bankruptcyCount: 0, paidOffAutoCount: 1 }).blueprint;
  assert.deepEqual(meets.supportingChecks.map(item => item.status), ["meets", "meets"]);
  assert.equal(meets.supportingChecks.every(item => item.tentative), true);
  const fails = byId({ bankruptcyCount: 1, paidOffAutoCount: 1 }).blueprint;
  assert.equal(fails.supportingChecks[0].status, "fails");
  assert.deepEqual(byId({ bankruptcyCount: 0, paidOffAutoCount: 1 }).prime_funding.supportingChecks, []);
});

test("income, liquid assets and property stay visible but have no invented threshold", () => {
  const all = byId({ reportedAnnualIncome: 0, verifiedAnnualIncome: 150000,
    liquidAssets: 0, property: { type: "residential" } });
  for (const card of Object.values(all)) {
    assert.deepEqual(card.pendingCriteria.map(item => item.status),
      ["threshold_not_configured", "threshold_not_configured",
        "threshold_not_configured", "criteria_not_configured"]);
    assert.deepEqual(card.pendingCriteria.slice(0, 3).map(item => item.observedValue),
      [0, 150000, 0]);
    assert.equal(card.pendingCriteria[3].evidenceProvided, true);
    assert.equal(card.lenderApproval, false);
  }
  assert.equal(byId({ reportedAnnualIncome: null }).blueprint.pendingCriteria[0].observedValue, null);
});
