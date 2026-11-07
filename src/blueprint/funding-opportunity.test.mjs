import { test } from "node:test";
import assert from "node:assert/strict";
import estimator from "../../vendor/underwriteiq-full/api/lite/crs/estimate-preapprovals.js";
import { buildFundingOpportunity, fundingOpportunityFromCreditRows } from "./funding-opportunity.mjs";
import { buildFundability } from "../finance/fundability.mjs";

const source = { reportId: "saved-report", asOf: "2026-11-06T12:00:00.000Z" };
function fixture({ outcome = "FULL_FUNDING", business = false } = {}) {
  const consumerSignals = { anchors: { revolving: { limit: 10000 }, installment: { amount: 10000 } },
    utilization: { band: "high" }, tradelines: { thinFile: false }, scores: { bureauConfidence: "high" } };
  const businessSignals = business ? { available: true, profile: { ageMonths: 30 },
    bizUtilization: { band: "excellent" }, hardBlock: { blocked: false, reasons: [] },
    bizNegativeItems: { hasNegatives: false }, ucc: { caution: false } } : { available: false };
  const preapprovals = estimator.estimatePreapprovals(consumerSignals, businessSignals, outcome);
  const projectedPreapproval = estimator.estimatePreapprovals({ ...consumerSignals,
    utilization: { band: "excellent" } }, businessSignals, outcome);
  return { outcome, consumerSignals, businessSignals, preapprovals, projectedPreapproval,
    findings: [{ code: "UTIL_OVERALL_HIGH" }, { code: "COLLECTION_ITEM" }, { code: "INQUIRY_HIGH" }] };
}
function plans(count = 1) {
  return { businesses: Array.from({ length: count }, (_, i) => ({ id: `plan-${i}`, businessId: `business-${i}`,
    name: `Business ${i}`, evidence: { formation: { status: "reviewed" }, ein: { status: "reviewed" } } })),
  existingBusinesses: Array.from({ length: count }, (_, i) => ({ id: `business-${i}`,
    name: `Business ${i}`, formationDate: "2024-01-01" })) };
}

test("personal amounts and one joint utilization lift are exact current full-engine outputs", () => {
  const analysis = fixture();
  const before = structuredClone(analysis);
  const out = buildFundingOpportunity({ analysis, source });
  assert.equal(out.personal.currentCents, analysis.preapprovals.totalPersonal * 100);
  assert.equal(out.personal.projectedCents, analysis.projectedPreapproval.totalPersonal * 100);
  assert.equal(out.personal.liftCents, out.personal.projectedCents - out.personal.currentCents);
  assert.deepEqual(out.combined, out.personal);
  assert.equal(out.steps.find(s => s.key === "utilization").liftCents, out.personal.liftCents);
  for (const step of out.steps.filter(s => s.key !== "utilization")) assert.equal(step.liftCents, null);
  assert.deepEqual(analysis, before);
  assert.doesNotMatch(JSON.stringify(out), /anchors|bureauConfidence|thinFile/);
});

test("repair-only, manual review and fraud holds never expose dollars or lift", () => {
  for (const outcome of ["REPAIR_ONLY", "MANUAL_REVIEW", "FRAUD_HOLD"]) {
    const out = buildFundingOpportunity({ analysis: fixture({ outcome }), source });
    assert.equal(out.personal.currentCents, null);
    assert.equal(out.personal.projectedCents, null);
    assert.equal(out.personal.liftCents, null);
    assert.ok(out.steps.every(step => step.liftCents === null));
  }
});

test("one business requires actual entity, reviewed formation/EIN, and a trusted matching report", () => {
  const analysis = fixture({ business: true });
  for (const businessReportBusinessId of [null, "another-business"]) {
    const out = buildFundingOpportunity({ analysis, source, businessPlans: plans(), businessReportBusinessId });
    assert.equal(out.businesses[0].currentCents, null);
    assert.equal(out.combined.currentCents, null);
  }
  const out = buildFundingOpportunity({ analysis, source, businessPlans: plans(), businessReportBusinessId: "business-0" });
  assert.equal(out.businesses[0].currentCents, analysis.preapprovals.business.final * 100);
  assert.equal(out.combined.currentCents, analysis.preapprovals.totalCombined * 100);
  assert.equal(out.combined.projectedCents, analysis.projectedPreapproval.totalCombined * 100);
  const unreviewed = plans();
  unreviewed.businesses[0].evidence.ein.status = "evidence_received";
  const unknown = buildFundingOpportunity({ analysis, source, businessPlans: unreviewed, businessReportBusinessId: "business-0" });
  assert.equal(unknown.businesses[0].currentCents, null);
  assert.ok(unknown.businesses[0].blockers.includes("ein_evidence_required"));
});

test("four businesses never repeat the report slice or add repeated personal-guarantee capacity", () => {
  const analysis = fixture({ business: true });
  const out = buildFundingOpportunity({ analysis, source, businessPlans: plans(4), businessReportBusinessId: "business-0" });
  assert.equal(out.businesses.length, 4);
  assert.equal(out.businesses.filter(b => b.currentCents !== null).length, 1);
  assert.equal(out.combined.currentCents, null);
  assert.equal(out.combined.projectedCents, null);
  assert.equal(out.combined.liftCents, null);
  assert.equal(out.combined.status, "overlap_review_required");
  const duplicate = plans(2);
  duplicate.businesses[1].businessId = "business-0";
  const ambiguous = buildFundingOpportunity({ analysis, source, businessPlans: duplicate, businessReportBusinessId: "business-0" });
  assert.ok(ambiguous.businesses.every(b => b.currentCents === null));
  assert.ok(ambiguous.businesses[0].blockers.includes("business_report_association_ambiguous"));
});

test("unknown formation, age, EIN and missing business report stay unknown rather than zero", () => {
  const analysis = fixture();
  const businessPlans = { businesses: [{ id: "planned", name: "Future LLC" }], existingBusinesses: [] };
  const out = buildFundingOpportunity({ analysis, source, businessPlans });
  assert.equal(out.businesses[0].currentCents, null);
  assert.ok(out.businesses[0].blockers.includes("formed_business_not_on_file"));
  assert.ok(out.businesses[0].blockers.includes("formation_evidence_required"));
  assert.ok(out.businesses[0].blockers.includes("ein_evidence_required"));
  const withoutAge = fixture({ business: true });
  withoutAge.businessSignals.profile.ageMonths = null;
  assert.equal(buildFundingOpportunity({ analysis: withoutAge, source, businessPlans: plans(),
    businessReportBusinessId: "business-0" }).businesses[0].currentCents, null);
});

test("invalid/inconsistent amounts and unknown projections do not become money", () => {
  for (const invalid of [null, "85000", NaN, Infinity, -1, 1e30]) {
    const analysis = fixture();
    analysis.preapprovals.totalPersonal = invalid;
    assert.equal(buildFundingOpportunity({ analysis, source }).personal.currentCents, null);
  }
  const analysis = fixture();
  analysis.projectedPreapproval = null;
  const out = buildFundingOpportunity({ analysis, source });
  assert.equal(out.personal.projectedCents, null);
  assert.equal(out.personal.liftCents, null);
});

test("shared row adapter ignores simulated/provider demo rows and fails closed on unreadable real data", () => {
  const good = { id: "real", provider: "crs_softview", created_at: source.asOf, result: fixture() };
  for (const demo of [{ is_demo: true }, { provider: "crs_softview_simulated" },
    { result: { ...fixture(), environment: "sandbox" } }, { result: { ...fixture(), simulated: true } }]) {
    const out = fundingOpportunityFromCreditRows({ crsRows: [good,
      { ...good, id: "demo", created_at: "2026-11-07T00:00:00Z", ...demo }] });
    assert.equal(out.source.reportId, "real");
  }
  const unknown = fundingOpportunityFromCreditRows({ crsRows: [{ ...good, result: {} }], runEngine() { throw Error("no report"); } });
  assert.equal(unknown.personal.currentCents, null);
  assert.equal(fundingOpportunityFromCreditRows().personal.currentCents, null);
});

test("FinanceOS additive opportunity uses the same source/full engine contract as Blueprint", () => {
  const row = { id: "real", provider: "crs_softview", created_at: source.asOf, result: fixture() };
  const expected = fundingOpportunityFromCreditRows({ crsRows: [row], businessPlans: plans(3) });
  const out = buildFundability({ client: { custom_fields: { blueprint_business_plans: plans(3) } },
    crsRows: [row], businessRows: plans(3).existingBusinesses.map(b => ({ ...b, entity_data: { incorporated_date: b.formationDate } })), months: [] });
  assert.deepEqual(out.opportunity, expected);
  assert.ok(out.now);
  assert.ok(Array.isArray(out.projections));
});
