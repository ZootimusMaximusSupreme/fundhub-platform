// Read-only presentation of the current CRS engine's funding estimates.
// No new multiplier, score prediction, eligibility rule, or provider action.
import { runTierEngineFromCrsResult } from "../finance/crs-tier.mjs";
const SAFE_OUTCOMES = new Set(["PREMIUM_STACK", "FULL_FUNDING", "FUNDING_PLUS_REPAIR"]);
const UTILIZATION = new Set(["UTIL_CARD_OVER_10", "UTIL_OVERALL_HIGH"]);
const REPAIR = new Set(["CHARGEOFF_ITEM", "COLLECTION_ITEM", "LATE_PAYMENT_ITEM", "MEDICAL_COLLECTION"]);
const INQUIRIES = new Set(["INQUIRY_STORM", "INQUIRY_HIGH"]);
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const rows = value => Array.isArray(value) ? value : [];
const cents = value => typeof value === "number" && Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null;
const delta = (before, after) => before === null || after === null ? null : after - before;

function safeBlock(analysis, block) {
  return SAFE_OUTCOMES.has(analysis?.outcome) && block?.customerSafe === true &&
    block.suppressedByOutcome === false;
}

function personalCents(analysis, block) {
  if (!analysis?.consumerSignals || !safeBlock(analysis, block)) return null;
  const card = cents(block.personalCard?.final);
  const loan = cents(block.personalLoan?.final);
  const total = cents(block.totalPersonal);
  return card !== null && loan !== null && total === card + loan ? total : null;
}

function capacity(currentCents, projectedCents, blockers = []) {
  return { currentCents, projectedCents, liftCents: delta(currentCents, projectedCents),
    status: currentCents === null ? "unknown" : "modeled", blockers };
}

function businessEntries(plans) {
  const actual = rows(plans?.existingBusinesses);
  const linked = new Set();
  const entries = rows(plans?.businesses).map(plan => {
    const businessId = text(plan?.businessId);
    if (businessId) linked.add(businessId);
    return { plan, actual: actual.find(b => text(b?.id) === businessId) || null,
      planId: text(plan?.id), businessId, name: text(plan?.name) };
  });
  for (const business of actual) {
    const businessId = text(business?.id);
    if (!businessId || linked.has(businessId)) continue;
    entries.push({ plan: null, actual: business, planId: null, businessId, name: text(business?.name) });
  }
  for (const entry of entries) entry.ambiguous = !!entry.businessId &&
    entries.filter(other => other.businessId === entry.businessId).length !== 1;
  return entries;
}

function businessCapacity(entry, analysis, reportBusinessId) {
  const blockers = [];
  if (entry.ambiguous) blockers.push("business_report_association_ambiguous");
  if (!entry.actual) blockers.push("formed_business_not_on_file");
  if (!entry.actual?.formationDate && entry.plan?.evidence?.formation?.status !== "reviewed") {
    blockers.push("formation_evidence_required");
  }
  if (entry.plan?.evidence?.ein?.status !== "reviewed") blockers.push("ein_evidence_required");
  if (analysis?.businessSignals?.available === true &&
      !(typeof analysis.businessSignals.profile?.ageMonths === "number" &&
        Number.isFinite(analysis.businessSignals.profile.ageMonths) && analysis.businessSignals.profile.ageMonths >= 0)) {
    blockers.push("business_age_required");
  }
  if (!reportBusinessId || entry.businessId !== reportBusinessId || analysis?.businessSignals?.available !== true) {
    blockers.push("matched_business_credit_report_required");
  }
  const before = analysis?.preapprovals;
  const after = analysis?.projectedPreapproval;
  const read = block => blockers.length || !safeBlock(analysis, block) ? null : cents(block.business?.final);
  const out = capacity(read(before), read(after), blockers);
  if (out.currentCents === null && blockers.length === 0) out.blockers.push("current_engine_does_not_expose_safe_capacity");
  if (blockers.length === 0 && analysis?.businessSignals?.hardBlock?.blocked === true) {
    out.status = "blocked";
    out.blockers.push(...rows(analysis.businessSignals.hardBlock.reasons));
  }
  return { planId: entry.planId, businessId: entry.businessId, name: entry.name, ...out };
}

function utilizationOnlyProjection(before, after) {
  if (!before || !after) return false;
  return ["personalCard", "personalLoan"].every(key =>
    cents(before[key]?.base) !== null && before[key]?.base === after[key]?.base &&
    typeof before[key]?.modifiers?.utilization === "number" &&
    typeof after[key]?.modifiers?.utilization === "number" &&
    before[key]?.modifiers?.outcome === after[key]?.modifiers?.outcome &&
    before[key]?.modifiers?.thinFile === after[key]?.modifiers?.thinFile);
}

/**
 * `analysis` is the current full CRS engine result from a genuine scoped row.
 * `businessReportBusinessId` must be a trusted saved report association, never
 * a company name match or a browser parameter. With no association all company
 * amounts remain unknown. Raw credit data is never returned.
 */
export function buildFundingOpportunity({ analysis = null, source = {}, businessPlans = {},
  businessReportBusinessId = null } = {}) {
  const before = analysis?.preapprovals;
  const after = analysis?.projectedPreapproval;
  const current = personalCents(analysis, before);
  const projected = personalCents(analysis, after);
  const findings = rows(analysis?.findings ?? analysis?.optimization_findings);
  const codes = new Set(findings.map(f => f?.code));
  const has = set => [...codes].some(code => set.has(code));
  const blockers = current === null ? [analysis ? "current_engine_does_not_expose_safe_capacity" : "genuine_credit_report_required"] : [];
  const personal = capacity(current, projected, blockers);
  const businesses = businessEntries(businessPlans).map(entry =>
    businessCapacity(entry, analysis, text(businessReportBusinessId)));

  // The current engine estimates one company. There is no portfolio model that
  // proves multiple PG-based slices are independent, so never multiply or sum
  // that one slice across planned companies.
  let combined = capacity(null, null, []);
  if (businesses.length === 0) combined = { ...personal, blockers: [...personal.blockers] };
  else if (businesses.length === 1 && businesses[0].currentCents !== null && current !== null) {
    const total = cents(before?.totalCombined);
    const future = cents(after?.totalCombined);
    const nowMatches = total === current + businesses[0].currentCents;
    const futureMatches = projected !== null && businesses[0].projectedCents !== null &&
      future === projected + businesses[0].projectedCents;
    combined = capacity(nowMatches ? total : null, futureMatches ? future : null,
      nowMatches ? [] : ["engine_combined_total_unavailable"]);
  } else {
    combined.blockers.push("business_capacity_incomplete");
    if (businesses.length > 1) {
      combined.status = "overlap_review_required";
      combined.blockers.push("shared_personal_guarantee_overlap_not_modeled");
    }
  }

  const unknownStep = (key, reason) => ({ key, currentCents: null, projectedCents: null,
    liftCents: null, status: "not_modeled", reason });
  const steps = [];
  if (has(UTILIZATION)) {
    const supported = utilizationOnlyProjection(before, after) && current !== null && projected !== null;
    steps.push({ key: "utilization", currentCents: supported ? current : null,
      projectedCents: supported ? projected : null, liftCents: supported ? projected - current : null,
      status: supported ? "modeled_scenario" : "not_modeled",
      reason: "The existing engine's scenario assumes all card balances reach its utilization target. This is one joint scenario, not a lift per card." });
  }
  if (has(REPAIR)) steps.push(unknownStep("credit_repair", "A new genuine report and engine decision are needed after any verified change; the engine does not model a separate dollar lift for each letter or removal."));
  if (has(INQUIRIES)) steps.push(unknownStep("inquiry_cleanup", "The current estimator does not provide a separate dollar lift for inquiry cleanup."));
  for (const key of ["formation", "ein", "bank_preparation", "business_credit"]) {
    steps.push(unknownStep(key, "This is a preparation or evidence requirement. The existing engine does not assign a standalone dollar lift to completing it."));
  }

  return { currency: "USD", basis: "current_crs_engine", source: {
    reportId: text(source.reportId), asOf: text(source.asOf) }, personal, businesses, combined, steps,
    limitations: [
      "Modeled capacity is not an approval, issued credit, or usable funding.",
      "Step estimates describe shared scenarios and must not be added together.",
      "One personal estimate is counted once. Multiple business estimates require a model that resolves shared personal-guarantee overlap.",
      "Missing business facts, reviewed evidence, or a matching business report leave capacity unknown."
    ] };
}

/** Existing scoped reads can share the exact genuine-source/full-engine path. */
export function fundingOpportunityFromCreditRows({ crsRows = [], businessPlans = {},
  businessReportBusinessId = null, runEngine = runTierEngineFromCrsResult } = {}) {
  const genuine = rows(crsRows).filter(row => {
    const result = row?.result;
    return result && typeof result === "object" && row.is_demo !== true &&
      row.provider !== "crs_softview_simulated" && result.provider !== "crs_softview_simulated" &&
      !["true", "1"].includes(String(result.simulated).toLowerCase()) &&
      !["sandbox", "simulated"].includes(String(result.environment || "").toLowerCase());
  }).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const row = genuine[0];
  let analysis = null;
  if (row) {
    try { analysis = row.result.consumerSignals ? row.result : runEngine(row.result); }
    catch { /* Missing or unreadable engine data remains unknown. */ }
  }
  const rawDate = row?.created_at;
  const date = rawDate && new Date(rawDate);
  return buildFundingOpportunity({ analysis, businessPlans, businessReportBusinessId,
    source: { reportId: text(row?.id), asOf: date && Number.isFinite(date.getTime()) ? date.toISOString() : null } });
}
