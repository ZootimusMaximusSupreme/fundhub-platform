import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CF_SURVEY_QUESTIONS,
  PERSONAL_FUNDING_OPTION,
  homepageSurveyQuestions,
  visibleQuestions,
  answersByPayloadKey,
  surveyFicoBand,
  surveyIsComplete,
  SURVEY_FINAL_KEY
} from "./cf-question-map.mjs";

test("CF order has contact first; homepage has contact last", () => {
  assert.equal(CF_SURVEY_QUESTIONS[0].id, "contact");
  const home = homepageSurveyQuestions();
  assert.equal(home[home.length - 1].id, "contact");
  assert.notEqual(home[0].id, "contact");
});

test("payload keys are cf_svy_* from OWNER checklist", () => {
  const byId = Object.fromEntries(
    CF_SURVEY_QUESTIONS.filter((q) => q.type !== "contact").map((q) => [q.id, q.payloadKey])
  );
  assert.equal(byId.funding_target_amount, "cf_svy_funding_target_amount");
  assert.equal(byId.current_score, "cf_svy_self_reported_fico");
  assert.equal(byId.annual_personal_income, "cf_svy_annual_income_range");
  assert.equal(byId.verify_income, "cf_svy_income_verifiable");
  assert.equal(byId.available_capital, "cf_svy_available_capital");
  assert.equal(byId.has_negatives, undefined);
});

test("business path shows revenue steps, not personal income", () => {
  const steps = visibleQuestions({ has_business: "Yes, 1-2 years" });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_business_revenue"));
  assert.ok(ids.includes("verify_revenue"));
  assert.ok(!ids.includes("annual_personal_income"));
  assert.ok(!ids.includes("verify_income"));
});

test("personal path shows income steps, not business revenue", () => {
  const steps = visibleQuestions({ has_business: PERSONAL_FUNDING_OPTION });
  const ids = steps.map((s) => s.id);
  assert.ok(ids.includes("annual_personal_income"));
  assert.ok(ids.includes("verify_income"));
  assert.ok(!ids.includes("annual_business_revenue"));
});

test("answersByPayloadKey emits cf_svy_* keys", () => {
  const keyed = answersByPayloadKey({
    funding_target_amount: "Less than $50k",
    current_score: "750+",
  });
  assert.equal(keyed.cf_svy_funding_target_amount, "Less than $50k");
  assert.equal(keyed.cf_svy_self_reported_fico, "750+");
  assert.equal(keyed.cf_svy_has_negatives, undefined);
});

test("surveyFicoBand prefers the label and never paints a CF option id", () => {
  assert.equal(surveyFicoBand({
    cf_svy_self_reported_fico: 207907,
    cf_svy_self_reported_fico_label: "650-699"
  }), "650-699");
  assert.equal(surveyFicoBand({ cf_svy_self_reported_fico: "700-749" }), "700-749");
  assert.equal(surveyFicoBand({ cf_svy_self_reported_fico: "207907" }), null);
  assert.equal(surveyFicoBand({}), null);
});

test("surveyIsComplete: only the last answer (available capital) finishes the survey", () => {
  assert.equal(SURVEY_FINAL_KEY, "cf_svy_available_capital");
  assert.equal(surveyIsComplete({ cf_svy_available_capital: "$5k - $25k" }), true);
  assert.equal(surveyIsComplete({ cf_svy_available_capital: ["$5k - $25k"] }), true);
  assert.equal(surveyIsComplete({ cf_svy_funding_target_amount: "$50k - $100k" }), false);
  assert.equal(surveyIsComplete({ cf_svy_available_capital: "   " }), false);
  assert.equal(surveyIsComplete({ cf_svy_available_capital: [] }), false);
  assert.equal(surveyIsComplete(null), false);
  assert.equal(surveyIsComplete([]), false);
});
