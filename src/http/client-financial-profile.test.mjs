import test from "node:test";
import assert from "node:assert/strict";
import { clientFinancialProfile } from "./client-financial-profile.mjs";
import { incomeEstimates } from "./client-detail.mjs";

const client = { first_name: "Dana", last_name: "Whitfield", phone: "+15551234567", custom_fields: {} };
const row = (bureau, value, when, extra = {}) => ({ created_at: when,
  result: { environment: "production", scores: { [bureau.toLowerCase()]: value },
    scoreModels: { [bureau.toLowerCase()]: "FICO 9" }, ...extra } });

test("the profile retains separate newest stored bureau observations without a new order", () => {
  const profile = clientFinancialProfile({ client, crsResults: [
    row("EQ", 751, "2026-11-03T12:00:00Z"), row("TU", 801, "2026-11-04T12:00:00Z"),
    row("TU", 620, "2026-10-01T12:00:00Z") ] });
  assert.deepEqual(profile.creditScores.map(s => [s.bureau, s.score, s.asOf]),
    [["TU", 801, "2026-11-04T12:00:00.000Z"], ["EQ", 751, "2026-11-03T12:00:00.000Z"]]);
  assert.equal(profile.fitModels.length, 4);
  assert.equal(profile.fitModels.every(model => model.draft && !model.lenderApproval), true);
});

test("TU income code is never multiplied into annual dollars or a credit score", () => {
  const profile = clientFinancialProfile({ client, crsResults: [row("TU", 735,
    "2026-11-04T12:00:00Z", { bureaus: { TU: { scores: [
      { modelName: "CreditVision Income Estimator", scoreValue: "47 B" } ] } } })] });
  assert.equal(profile.incomeModels[0].rawCode, "47 B");
  assert.equal(profile.incomeModels[0].annual, null);
  assert.equal(profile.incomeModels[0].status, "mapping_required");
  assert.equal(profile.verifiedIncome, null);
  assert.equal(profile.creditScores[0].score, 735);
});

test("reported bands remain reported, while missing asset/property/verification facts stay unknown", () => {
  const profile = clientFinancialProfile({ client: { ...client, custom_fields: {
    cf_svy_annual_income_range: "$100k-$199k", cf_svy_income_verifiable: "Yes, pay stubs",
    cf_svy_available_capital: "$0", ssn: "should-not-return", pii: { token: "hidden" } } } });
  assert.equal(profile.reportedIncome.range, "$100k-$199k");
  assert.equal(profile.reportedCapital.range, "$0");
  assert.equal(profile.verifiedIncome, null);
  assert.equal(profile.property, null);
  assert.doesNotMatch(JSON.stringify(profile), /should-not-return|hidden|ssn|pii/);
});

test("sandbox and sample reports never supply real-lead facts or meet fit floors", () => {
  const profile = clientFinancialProfile({ client, crsResults: [
    row("TU", 850, "2026-11-04T12:00:00Z", { environment: "sandbox" }),
    { ...row("EQ", 840, "2026-11-03T12:00:00Z"), is_demo: true } ] });
  assert.deepEqual(profile.creditScores, []);
  assert.equal(profile.fitModels.every(model => model.outcome === "needs_data"), true);
});

test("Postgres Date timestamps preserve real score and income-model provenance", () => {
  const when = new Date("2026-11-04T12:00:00Z");
  const crsResults = [row("EX", 740, when, { bureaus: { EX: { scores: [
    { modelName: "Income Insight", scoreValue: "97" }
  ] } } })];
  const profile = clientFinancialProfile({ client, crsResults,
    incomeEstimates: incomeEstimates(crsResults) });
  assert.equal(profile.creditScores[0].asOf, when.toISOString());
  assert.deepEqual(profile.incomeModels, [{ bureau: "EX", annual: 97000,
    rawCode: "97", model: "Income Insight", verified: false,
    status: "model_estimate", asOf: when.toISOString() }]);
});

test("a demo or simulated income estimate cannot borrow a real report's timestamp", () => {
  for (const dates of [["2026-11-04T12:00:00Z", "2026-11-04T12:00:00Z"],
    [new Date("2026-11-04T12:00:00Z"), new Date("2026-11-04T12:00:00Z")],
    [null, null]]) {
    for (const sample of [{ is_demo: true }, { simulated: true }]) {
      const demo = row("EX", 840, dates[0], { bureaus: { EX: { scores: [
        { modelName: "Income Insight", scoreValue: 200 }
      ] } } });
      if (sample.is_demo) demo.is_demo = true;
      else demo.result.simulated = true;
      const crsResults = [demo, row("TU", 650, dates[1])];
      const profile = clientFinancialProfile({ client, crsResults,
        incomeEstimates: incomeEstimates(crsResults) });
      assert.deepEqual(profile.incomeModels, []);
    }
  }
});

test("income provenance matches the source bureau, model and raw value independently", () => {
  const when = "2026-11-04T12:00:00Z";
  const crsResults = [row("EQ", 750, when, { bureaus: { EQ: { scores: [
    { modelName: "IncomeView", scoreValue: 97 }
  ] } } })];
  for (const estimate of [
    { experian: { annual: 97000, raw: 97, model: "IncomeView" } },
    { equifax: { annual: 97000, raw: 97, model: "Income Insight" } },
    { equifax: { annual: 200000, raw: 200, model: "IncomeView" } }
  ]) {
    const profile = clientFinancialProfile({ client, crsResults,
      incomeEstimates: { ...estimate, asOf: when } });
    assert.deepEqual(profile.incomeModels, []);
  }
});
