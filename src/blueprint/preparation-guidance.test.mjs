import test from "node:test";
import assert from "node:assert/strict";
import { PREPARATION_STEP_KEYS, preparationGuidance, websitePrompt, formationDestination } from "./preparation-guidance.mjs";

test("the full requested curriculum is available with actionable source-backed fields", () => {
  const guides = preparationGuidance();
  assert.deepEqual(guides.map(g => g.key), [...PREPARATION_STEP_KEYS]);
  assert.equal(new Set(guides.map(g => g.key)).size, 17);
  for (const guide of guides) {
    assert.ok(guide.title && guide.why && guide.proof && guide.nextReview, guide.key);
    assert.ok(guide.steps.length >= 3 && guide.steps.every(step => typeof step === "string" && step.trim()), guide.key);
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

test("optional programs remain honest review tasks and preserve requested topics", () => {
  const guides = preparationGuidance();
  const businessCredit = guides.find(g => g.key === "business_credit");
  const merchant = guides.find(g => g.key === "merchant_tools");
  assert.equal(businessCredit.optional, true);
  assert.equal(businessCredit.applicability, "review_needed");
  assert.match(businessCredit.steps.join(" "), /which optional tools fit your actual plan/);
  assert.doesNotMatch(JSON.stringify(businessCredit), /David|gas-card-material-pending/);
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
  assert.deepEqual(guide.links.map(({ url }) => new URL(url).hostname), ["www.wexinc.com", "www.exxonmobilfleetcards.com", "atob.com", "www.conocofleet.com", "www.fuelman.com"]);
  const instructions = guide.steps.join(" ");
  assert.match(instructions, /If this business has real fuel expenses/);
  assert.match(instructions, /credit checks, personal guarantees/);
  assert.match(instructions, /whether the issuer reports this exact account/);
  assert.match(instructions, /Do not apply just to create activity/);
  assert.match(instructions, /current reviewed program when suitable/);
  assert.match(instructions, /Choose only the accounts you need and can repay/);
  assert.match(instructions, /payment due and payment dates/);
  assert.doesNotMatch(instructions, /\$70|\$2K|\$2,000|all cards are non.?PG/i);
  assert.match(guide.proof, /not approval or proof of reporting/);
});

test("buyer guidance and generated website prompts exclude the owner-removed programs", () => {
  const removedPrograms = /\bnav\b|\bnet[\s-]*30s?\b|\bduns?\b|dun\s*(?:&|and)\s*bradstreet/i;
  for (const context of [{}, { homeState: "AZ", business: { name: "Cedar LLC", activity: "Landscape maintenance", formationStatus: "reported_formed" }, creditContext: { authorizedUserReviewRequired: true, securedCreditReviewRequired: true } }]) {
    assert.doesNotMatch(JSON.stringify(preparationGuidance(context)), removedPrograms);
    assert.doesNotMatch(websitePrompt(context.business), removedPrograms);
  }
});

test("client reporting and elapsed time cannot become verified funding or formation", () => {
  const guides = preparationGuidance({ business: { formationDate: "2025-01-01" } });
  assert.match(guides.find(g => g.key === "formation").proof, /does not establish operating history or funding approval/);
  assert.match(guides.find(g => g.key === "bank_deposit").proof, /elapsed time is not verification/);
  assert.match(guides.find(g => g.key === "employment").steps.join(" "), /actual setup|real employer|actual payroll/);
});

test("the payment lesson protects reserves and actual minimums without replacing the credit roadmap", () => {
  const guide = preparationGuidance().find(item => item.key === "budget");
  const steps = guide.steps.join(" ");
  assert.match(steps, /essential bills.*buffer.*bank-deposit reserve/);
  assert.match(steps, /Snowball.*smallest balance; avalanche.*highest APR/);
  assert.match(steps, /minimum payments on all listed debts before directing extra/);
  assert.match(steps, /UnderwriteIQ utilization.*may take priority/);
  assert.match(steps, /shortfall/);
  assert.match(guide.proof, /not a payment, payoff-date forecast or credit-score promise/);
  assert.ok(guide.links.some(({ url }) => url === "https://www.consumerfinance.gov/documents/5782/cfpb_ymyg-toolkit_reducing-debt-worksheet.pdf"));
});

test("the approved course selection adds practical checks without exposing internal sources or removed tools", () => {
  const guides = preparationGuidance({ business: { name: "Cedar LLC", activity: "Landscape maintenance" } });
  const profile = guides.find(guide => guide.key === "business_profile");
  const website = guides.find(guide => guide.key === "business_website");
  const banks = guides.find(guide => guide.key === "local_banking");
  const financials = guides.find(guide => guide.key === "employment");
  assert.match(profile.steps.join(" "), /formation\/EIN documents, bank records, website/);
  assert.match(profile.steps.join(" "), /separate document checklist.*three or four businesses/);
  assert.match(website.steps.join(" "), /logo or extra paid tool is optional/);
  assert.match(banks.steps.join(" "), /personal-credit checks\/bureaus, collateral or UCC/);
  assert.match(banks.steps.join(" "), /several separate businesses/);
  assert.match(financials.steps.join(" "), /profit-and-loss statement, balance sheet and merchant-processor statements when applicable/);
  assert.ok(guides.some(guide => guide.sourceRefs.some(source => source.startsWith("fundhub-ip:tradeline-secrets/"))));
  for (const guide of guides) for (const { url } of guide.links) assert.doesNotMatch(url, /drive\.google|docs\.google|bit\.ly/);
});
