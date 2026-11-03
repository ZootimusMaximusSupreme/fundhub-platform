import test from "node:test";
import assert from "node:assert/strict";
import { PREPARATION_STEP_KEYS, preparationGuidance, websitePrompt, formationDestination } from "./preparation-guidance.mjs";

test("the full requested curriculum is available with actionable source-backed fields", () => {
  const guides = preparationGuidance();
  assert.deepEqual(guides.map(g => g.key), [...PREPARATION_STEP_KEYS]);
  assert.equal(new Set(guides.map(g => g.key)).size, 17);
  for (const guide of guides) {
    assert.ok(guide.title && guide.why && guide.proof && guide.nextReview, guide.key);
    assert.equal(guide.steps.length, 3, guide.key);
    assert.ok(guide.sourceRefs.length, guide.key);
    for (const { url } of guide.links) assert.equal(new URL(url).protocol, "https:");
  }
});

test("unknown credit cannot silently become an instruction to remove or open an account", () => {
  const guides = preparationGuidance();
  for (const key of ["authorized_user", "secured_credit"]) {
    assert.equal(guides.find(g => g.key === key).applicability, "review_needed");
  }
  const reviewed = preparationGuidance({ creditContext: { authorizedUserReviewRequired: true, securedCreditReviewRequired: true } });
  assert.equal(reviewed.find(g => g.key === "authorized_user").applicability, "ready");
  assert.equal(reviewed.find(g => g.key === "secured_credit").applicability, "ready");
});

test("formation distinguishes an existing record from an unformed plan", () => {
  const planned = preparationGuidance({ homeState: "Arizona", business: { name: "Cedar LLC" } });
  const formed = preparationGuidance({ business: { name: "Cedar LLC", formationState: "AZ", formationStatus: "reported_formed" } });
  assert.equal(planned.find(g => g.key === "formation").title, "Form this single-member LLC");
  assert.match(formed.find(g => g.key === "formation").title, /Review/);
  assert.equal(planned.find(g => g.key === "ein").applicability, "review_needed");
  assert.equal(formed.find(g => g.key === "ein").applicability, "ready");
  assert.equal(formationDestination({ homeState: "AZ" }).url, "https://azcc.gov/corporations");
  assert.match(formationDestination({ homeState: "VT" }).label, /VT/);
  assert.equal(formationDestination({ homeState: "New York" }).url, "https://dos.ny.gov/forming-limited-liability-company-new-york");
  assert.equal(formationDestination({ business: { formationState: "CA" }, homeState: "AZ" }).url, "https://www.sos.ca.gov/business-programs/business-entities/forms/");
});

test("the website prompt reuses real business context and keeps missing facts as gaps", () => {
  const prompt = websitePrompt({ name: "Cedar LLC", activity: "Landscape maintenance", formationState: "AZ" });
  assert.match(prompt, /Cedar LLC/);
  assert.match(prompt, /Landscape maintenance/);
  assert.match(prompt, /Do not|Ask before/);
  assert.match(websitePrompt(), /\[business name\]/);
});

test("pending source programs remain honest review tasks and preserved requested topics", () => {
  const guides = preparationGuidance();
  const businessCredit = guides.find(g => g.key === "business_credit");
  const merchant = guides.find(g => g.key === "merchant_tools");
  assert.equal(businessCredit.optional, true);
  assert.equal(businessCredit.applicability, "review_needed");
  assert.match(businessCredit.steps.join(" "), /David.*still needed/);
  assert.match(merchant.steps.join(" "), /Whop, Commas or Clarity/);
  assert.match(guides.find(g => g.key === "business_listings").steps.join(" "), /Yellow Pages/);
  assert.match(guides.find(g => g.key === "calendar").steps.join(" "), /Google Calendar/);
});

test("fleet-provider discovery stays optional and cannot become an approval or reporting instruction", () => {
  // Even an established, formed business has not been approved for a fuel card.
  const guide = preparationGuidance({ business: { name: "Cedar LLC", activity: "Landscape maintenance", formationStatus: "reported_formed" } })
    .find(g => g.key === "business_credit");
  assert.equal(guide.optional, true);
  assert.equal(guide.applicability, "review_needed");
  assert.deepEqual(guide.links.map(({ url }) => new URL(url).hostname), ["www.wexinc.com", "www.exxonmobilfleetcards.com"]);
  const instructions = guide.steps.join(" ");
  assert.match(instructions, /If this business has real fuel expenses/);
  assert.match(instructions, /credit checks, personal guarantees/);
  assert.match(instructions, /whether the issuer reports this exact account/);
  assert.match(instructions, /Do not apply just to create activity/);
  assert.match(instructions, /David.*still needed/);
  assert.match(guide.proof, /not approval or proof of reporting/);
});

test("client reporting and elapsed time cannot become verified funding or formation", () => {
  const guides = preparationGuidance({ business: { formationDate: "2025-01-01" } });
  assert.match(guides.find(g => g.key === "formation").proof, /does not establish operating history or funding approval/);
  assert.match(guides.find(g => g.key === "bank_deposit").proof, /elapsed time is not verification/);
  assert.match(guides.find(g => g.key === "employment").steps.join(" "), /actual setup|real employer|actual payroll/);
});
