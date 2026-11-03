import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditCompany, auditCompanies, buildBusinessPreparation, shellLlcSuggestion,
  websiteSuggestion, linkedInSuggestion, SHELL_LLC_SUGGESTION_TEXT,
  SHELL_LLC_SUGGESTION_WHY, WEBSITE_SUGGESTION_TEXT, LINKEDIN_SUGGESTION_TEXT
} from "./company-audit.mjs";

test("a reference code remains recorded without claiming activity was verified", () => {
  const out = auditCompany({ name: "Northline Systems LLC", naics: "541611" });
  assert.equal(out.naicsSuggestion.change, false);
  assert.equal(out.naicsSuggestion.status, "approved");
  assert.equal(out.nameSuggestion.change, false);
  assert.match(out.naicsSuggestion.why, /actual activity/);
  assert.match(out.naicsSuggestion.why, /not an approval/);
});

test("a missing industry code requests the actual activity, not a substitute industry", () => {
  const out = auditCompany({ name: "Northline LLC", naics: "" }).naicsSuggestion;
  assert.equal(out.change, true);
  assert.equal(out.status, "missing");
  assert.deepEqual(out.pick, []);
  assert.match(out.why, /matches that activity/);
  assert.doesNotMatch(out.why, /Pick a code from the low-risk list/);
});

test("an existing code outside the reference list is retained for activity review", () => {
  const out = auditCompany({ name: "Northline LLC", naics: "484121" }).naicsSuggestion;
  assert.equal(out.change, false);
  assert.equal(out.status, "not_on_list");
  assert.equal(out.from, "484121");
  assert.deepEqual(out.pick, []);
  assert.match(out.why, /Keep it if it accurately describes/);
});

test("historical name flags lead to accurate identity review, not hiding the activity", () => {
  const out = auditCompany({ name: "Apex Crypto Holdings LLC", naics: "541611" });
  assert.equal(out.nameSuggestion.change, true);
  assert.ok(out.nameSuggestion.flags.includes("crypto"));
  assert.match(out.nameSuggestion.suggestion, /registered legal name/);
  assert.match(out.nameSuggestion.suggestion, /actual activity clear/);
  assert.doesNotMatch(out.nameSuggestion.suggestion, /Take crypto out|Use a neutral name/);
  assert.doesNotMatch(out.nameSuggestion.why, /automatic no|leads to denials/);
});

test("business preparation is three or four separate one-owner plans with real state checks", () => {
  const out = shellLlcSuggestion({ companyCount: 3 });
  assert.equal(out.status, "standing_rule");
  assert.equal(out.companyCount, 3);
  assert.equal(out.canTellShellsApart, false);
  assert.equal(out.suggestion, SHELL_LLC_SUGGESTION_TEXT);
  assert.equal(out.why, SHELL_LLC_SUGGESTION_WHY);
  assert.match(out.suggestion, /three or four separate single-member LLCs/);
  assert.match(out.suggestion, /Review the businesses you already have/);
  assert.match(out.suggestion, /formation and operating states/);
  assert.match(out.suggestion, /formation date, ownership history and operating history separate/);
  assert.match(out.suggestion, /Time alone does not establish readiness or approval/);
  assert.doesNotMatch(out.suggestion, /Arizona|\$90|no yearly fee|each quarter|at least two/);
});

test("no-company and existing-company callers retain all prior response keys", () => {
  for (const businesses of [[], [{ name: "One LLC", naics: "541611" }]]) {
    const out = auditCompanies(businesses);
    assert.equal(out.companies.length, businesses.length);
    assert.equal(out.shellSuggestion.companyCount, businesses.length);
    assert.equal(out.shellSuggestion.suggestion, SHELL_LLC_SUGGESTION_TEXT);
    assert.equal(out.websiteSuggestion.suggestion, WEBSITE_SUGGESTION_TEXT);
    assert.equal(out.linkedInSuggestion.suggestion, LINKEDIN_SUGGESTION_TEXT);
    assert.equal(out.businessPreparation.targetBusinessCount, 4);
  }
});

test("website instructions are actionable and still disclose no scan", () => {
  const out = websiteSuggestion();
  assert.match(out.suggestion, /actual services, legal name and contact details/);
  assert.match(out.suggestion, /Save the website link for review/);
  assert.match(out.why, /does not scan/);
  assert.match(out.why, /does not call a paid website API/);
  assert.match(linkedInSuggestion().suggestion, /LinkedIn as a business profile/);
});

test("separate planned businesses never become formed or add to canonical company counts", () => {
  const businesses = [{ id: "existing-1", name: "Trading LLC", entity_data: {
    formation_state: "AZ", state: "AZ", started: "2020-03-10", industry: "Wholesale"
  } }];
  const plans = [1, 2, 3, 4].map((i) => ({ id: `plan-${i}`, name: `Business ${i}`,
    activity: "Consulting", formationState: "TX", operatingState: "TX", formationStatus: "planned",
    formationDate: "2020-01-01" }));
  const original = JSON.stringify({ businesses, plans });
  const out = auditCompanies(businesses, { plans, targetBusinessCount: 4 });
  assert.equal(out.companies.length, 1);
  assert.equal(out.shellSuggestion.companyCount, 1);
  assert.equal(out.businessPreparation.existingBusinesses.length, 1);
  assert.equal(out.businessPreparation.plans.length, 4);
  assert.deepEqual(out.businessPreparation.plans.map((p) => p.planId), plans.map((p) => p.id));
  for (const plan of out.businessPreparation.plans) {
    assert.equal(plan.recordState, "planned");
    assert.equal(plan.businessId, null);
    assert.equal(plan.formationDate, null);
    assert.equal(plan.ownershipSince, null);
    assert.equal(plan.operatingSince, null);
    assert.equal(plan.nextActionKey, "formation");
    assert.ok(plan.steps.every((step) => step.verification === "not_verified"));
  }
  assert.equal(JSON.stringify({ businesses, plans }), original);
});

test("a reported formation keeps ownership and operating history independent", () => {
  const out = buildBusinessPreparation({ plans: [{ id: "plan-1", name: "Northline LLC",
    formationStatus: "reported_formed", formationState: "AZ", operatingState: "CA",
    formationDate: "2026-11-01", ownershipSince: "2026-11-02" }] }).plans[0];
  assert.equal(out.recordState, "reported_formed");
  assert.equal(out.formationDate, "2026-11-01");
  assert.equal(out.ownershipSince, "2026-11-02");
  assert.equal(out.operatingSince, null);
  assert.equal(out.formationState, "AZ");
  assert.equal(out.operatingState, "CA");
  assert.equal(out.steps.find((step) => step.key === "formation").state, "reported_complete");
  assert.equal(out.steps.find((step) => step.key === "formation").verification, "not_verified");
});

test("stored details never imply proof review and have precise required evidence", () => {
  const out = buildBusinessPreparation({ businesses: [{ id: "real-1", name: "Northline LLC", entity_data: {
    industry: "Consulting", formation_state: "az", state: "az", started: "2025-01-02",
    ein_last4: "1234", website: "https://example.test", created_at: "2020-01-01"
  } }] }).existingBusinesses[0];
  assert.equal(out.formationState, "AZ");
  assert.equal(out.operatingSince, null);
  assert.equal(out.ownershipSince, null);
  assert.equal(out.steps.find((s) => s.key === "ein").state, "details_recorded");
  assert.ok(out.steps.every((step) => step.verification === "not_verified"));
  assert.deepEqual(out.steps.find((s) => s.key === "formation").requiredEvidence,
    ["Accepted formation document", "Actual formation date"]);
  assert.doesNotMatch(JSON.stringify(out), /1234/);
});

test("three-business setting and source provenance are explicit, without auto-created plans", () => {
  const out = buildBusinessPreparation({ targetBusinessCount: 3, businesses: null, plans: null });
  assert.equal(out.targetBusinessCount, 3);
  assert.deepEqual(out.targetOptions, [3, 4]);
  assert.equal(out.reviewHorizonMonths, 12);
  assert.equal(out.formationMode, "single_member_llc");
  assert.deepEqual(out.existingBusinesses, []);
  assert.deepEqual(out.plans, []);
  assert.ok(out.sources.some((source) => source.includes("opening-llc")));
  assert.ok(out.sources.some((source) => source.includes("get-ein")));
  assert.equal(buildBusinessPreparation({ targetBusinessCount: 9 }).targetBusinessCount, 4);
});
