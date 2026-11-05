// Draft internal fit cards. These score floors describe Fundhub's current
// screening idea; they do not encode any lender's underwriting or approval.

export const LEAD_FIT_MODEL_VERSION = "draft-2026-11-04";

export const LEAD_FIT_MODELS = Object.freeze([
  Object.freeze({ id: "blueprint", name: "Blueprint", scoreFloor: 620,
    thresholdSource: "owner_provisional_2026_11_04" }),
  Object.freeze({ id: "prime_funding", name: "Prime Funding", scoreFloor: 750,
    thresholdSource: "owner_provisional_2026_11_04" }),
  Object.freeze({ id: "super_prime", name: "Super Prime", scoreFloor: 800,
    thresholdSource: "owner_provisional_2026_11_04" }),
  Object.freeze({ id: "real_estate", name: "Real Estate", scoreFloor: null,
    thresholdSource: "no_universal_real_estate_floor" })
]);

const BUREAUS = new Set(["TU", "EQ", "EX"]);

function nonnegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function creditScores(input) {
  if (!Array.isArray(input)) return [];
  return input.flatMap(entry => {
    if (!entry || typeof entry !== "object" || entry.sample === true
        || !BUREAUS.has(entry.bureau)
        || !Number.isInteger(entry.score) || entry.score < 250 || entry.score > 900
        || typeof entry.source !== "string" || !entry.source.trim()
        || /(?:^|[_\s-])(sample|sandbox|demo|simulated|simulation)(?:$|[_\s-])/i.test(entry.source)
        || /income|debt.to.income|\bdti\b/i.test(String(entry.model || ""))) return [];
    return [{
      bureau: entry.bureau,
      score: entry.score,
      // Unknown models remain unknown; no score is silently called FICO.
      model: typeof entry.model === "string" && entry.model.trim() ? entry.model.trim() : null,
      source: entry.source.trim(),
      asOf: typeof entry.asOf === "string" && Number.isFinite(Date.parse(entry.asOf))
        ? entry.asOf : null
    }];
  });
}

function supportingChecks(model, input) {
  if (model.id !== "blueprint") return [];
  const bankruptcies = count(input.bankruptcyCount);
  const paidAutos = count(input.paidOffAutoCount);
  return [
    {
      criterion: "no_reported_bankruptcy",
      tentative: true,
      status: bankruptcies === null ? "missing" : bankruptcies === 0 ? "meets" : "fails",
      observedValue: bankruptcies
    },
    {
      criterion: "at_least_one_paid_off_auto",
      tentative: true,
      status: paidAutos === null ? "missing" : paidAutos >= 1 ? "meets" : "fails",
      observedValue: paidAutos
    }
  ];
}

const REAL_ESTATE_REQUEST_MARKERS = Object.freeze([75000, 100000, 175000, 250000, 500000]);

function realEstateChecks(input) {
  const value = input.property;
  const property = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const homeowner = typeof property.isHomeowner === "boolean" ? property.isHomeowner : null;
  const householdIncome = nonnegativeNumber(property.householdAnnualIncome);
  const projectBudget = nonnegativeNumber(property.projectBudget);
  const combinedFinancingTarget = nonnegativeNumber(property.combinedFinancingTarget);
  const contractorEstimate = typeof property.hasContractorEstimate === "boolean"
    ? property.hasContractorEstimate : null;
  const check = (criterion, observedValue, ideal, target) => ({
    criterion,
    tentative: true,
    disqualifying: false,
    status: observedValue === null ? "missing" : ideal ? "ideal" : "out_of_band",
    observedValue,
    target
  });
  return [
    check("homeowner", homeowner, homeowner === true, "homeowner_target_not_requirement"),
    // This is an ideal marketing profile, never a minimum loan qualification.
    // A supplied amount alone does not prove that income is documented.
    { ...check("household_annual_income", householdIncome,
      householdIncome !== null && householdIncome >= 200000,
      "proposed_about_200k_to_350k_plus_not_minimum"),
    documentationVerified: null },
    { ...check("project_or_combined_financing_target",
      projectBudget === null && combinedFinancingTarget === null ? null
        : { projectBudget, combinedFinancingTarget },
      (projectBudget !== null && projectBudget >= 75000)
        || (combinedFinancingTarget !== null && combinedFinancingTarget >= 75000),
      "75000_and_up_open_ended"),
    requestMarkers: [...REAL_ESTATE_REQUEST_MARKERS],
    facilityStackingDependsOnProgram: true },
    check("contractor_estimate", contractorEstimate, contractorEstimate === true,
      "estimate_or_defined_scope_target")
  ];
}

function realEstateIcpPaths(input, scores) {
  const entrantChecks = scores.map(item => ({
    ...item,
    floor: 700,
    status: item.score >= 700 ? "meets" : "below"
  }));
  const verifiedIncome = nonnegativeNumber(input.verifiedAnnualIncome);
  const reportedIncome = nonnegativeNumber(input.reportedAnnualIncome);
  const entrantIncome = verifiedIncome ?? reportedIncome;
  const homeownerChecks = realEstateChecks(input);
  return [
    {
      id: "real_estate_entrant",
      name: "Deal-Ready Profile",
      targetProfile: "High income, strong financials, and good credit; property ownership optional",
      homeownershipRequired: false,
      scoreFloor: 700,
      scoreFloorStatus: "proposed_entrant_focus_only",
      thresholdSource: "inferred_from_real_estate_entrant_offer_draft",
      outcome: entrantChecks.length === 0 ? "needs_data"
        : entrantChecks.some(check => check.status === "meets") ? "score_floor_met"
          : "below_score_floor",
      scoreChecks: entrantChecks,
      supportingChecks: [
        { criterion: "income_evidence", tentative: true, disqualifying: false,
          status: entrantIncome === null ? "missing"
            : verifiedIncome !== null ? "verified_amount_present" : "reported_only",
          observedValue: entrantIncome, documentationVerified: verifiedIncome !== null,
          target: "high_income_no_numeric_minimum_configured" },
        { criterion: "financial_strength", tentative: true, disqualifying: false,
          status: "criteria_not_configured", observedValue: nonnegativeNumber(input.liquidAssets) }
      ]
    },
    {
      id: "homeowner_capital",
      name: "Renovation Funding Map",
      targetProfile: "Property owner with strong income and a defined major project",
      homeownershipRequired: true,
      scoreFloor: null,
      scoreFloorStatus: "no_universal_floor",
      thresholdSource: "real_estate_homeowner_offer_draft",
      outcome: "needs_configuration",
      scoreChecks: [],
      supportingChecks: homeownerChecks
    }
  ];
}

function pendingCriteria(input) {
  const property = input.property && typeof input.property === "object"
    && !Array.isArray(input.property) && Object.keys(input.property).length > 0;
  return [
    { criterion: "reported_annual_income", status: "threshold_not_configured",
      observedValue: nonnegativeNumber(input.reportedAnnualIncome) },
    { criterion: "verified_annual_income", status: "threshold_not_configured",
      observedValue: nonnegativeNumber(input.verifiedAnnualIncome) },
    { criterion: "liquid_assets", status: "threshold_not_configured",
      observedValue: nonnegativeNumber(input.liquidAssets) },
    { criterion: "property", status: "criteria_not_configured", evidenceProvided: !!property }
  ];
}

/** Evaluate four independent draft cards against explicit, per-bureau score evidence. */
export function evaluateLeadFitModels(input = {}) {
  const evidence = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const scores = creditScores(evidence.creditScores);
  return LEAD_FIT_MODELS.map(model => {
    const checks = model.scoreFloor === null ? [] : scores.map(item => ({
      ...item,
      floor: model.scoreFloor,
      status: item.score >= model.scoreFloor ? "meets" : "below"
    }));
    const outcome = model.scoreFloor === null ? "needs_data"
      : checks.length === 0 ? "needs_data"
        : checks.some(check => check.status === "meets") ? "score_floor_met"
          : "below_score_floor";
    return {
      model: model.id,
      name: model.name,
      version: LEAD_FIT_MODEL_VERSION,
      draft: true,
      lenderApproval: false,
      scoreFloor: model.scoreFloor,
      scoreFloorStatus: model.id === "real_estate" ? "no_universal_floor" : "provisional",
      thresholdSource: model.thresholdSource,
      policyStatus: "draft_pending_lender_policy",
      outcome,
      scoreChecks: checks,
      supportingChecks: supportingChecks(model, evidence),
      icpPaths: model.id === "real_estate" ? realEstateIcpPaths(evidence, scores) : [],
      pendingCriteria: pendingCriteria(evidence)
    };
  });
}
