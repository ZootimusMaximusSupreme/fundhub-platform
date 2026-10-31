import { test } from "node:test";
import assert from "node:assert/strict";
import { nextSurveyKey, savedSurveyAnswers, surveyProgressWords } from "./resume-state.mjs";

const MONEY = "Stability (cover bills / buffer slow weeks)";

test("an empty or missing record has no answers and starts at the first question", () => {
  for (const cf of [undefined, null, {}, [], "text", 7]) {
    assert.deepEqual(savedSurveyAnswers(cf), {});
  }
  assert.equal(nextSurveyKey({}), "cf_svy_funding_target_amount");
  assert.equal(nextSurveyKey(), "cf_svy_funding_target_amount");
});

test("the words win over the id, in the order the setter's summary reads them: _label, _labels, then the key", () => {
  assert.deepEqual(savedSurveyAnswers({
    cf_svy_planned_use: "207891", cf_svy_planned_use_label: "Payroll or rent"
  }), { cf_svy_planned_use: "Payroll or rent" });
  assert.deepEqual(savedSurveyAnswers({
    cf_svy_planned_use: "207891", cf_svy_planned_use_labels: '["Payroll or rent"]'
  }), { cf_svy_planned_use: "Payroll or rent" });
  assert.deepEqual(savedSurveyAnswers({ cf_svy_planned_use: "Payroll or rent" }), { cf_svy_planned_use: "Payroll or rent" });
  // A blank or id-only _label falls through to the next place that has words.
  assert.deepEqual(savedSurveyAnswers({
    cf_svy_planned_use_label: "", cf_svy_planned_use_labels: "98765", cf_svy_planned_use: "Payroll or rent"
  }), { cf_svy_planned_use: "Payroll or rent" });
});

test("an id is never an answer: a string, a number, or a list of them", () => {
  assert.deepEqual(savedSurveyAnswers({
    cf_svy_funding_target_amount: "207883", cf_svy_planned_use: 207891, cf_svy_money_change_now: ["207900", 207901]
  }), {});
  // Short numbers are not option ids.
  assert.deepEqual(savedSurveyAnswers({ cf_svy_planned_use: "1234" }), { cf_svy_planned_use: "1234" });
});

test("the multi question is always a list; a single question is always one string", () => {
  assert.deepEqual(savedSurveyAnswers({ cf_svy_money_change_now: MONEY }), { cf_svy_money_change_now: [MONEY] });
  assert.deepEqual(savedSurveyAnswers({ cf_svy_money_change_now: [MONEY, "Fresh start (new business / startup launch)"] }), {
    cf_svy_money_change_now: [MONEY, "Fresh start (new business / startup launch)"]
  });
  // A single question saved as a list gives its first word, which is a real option the page can show.
  assert.deepEqual(savedSurveyAnswers({ cf_svy_planned_use: ["Payroll or rent", "Not sure yet"] }), { cf_svy_planned_use: "Payroll or rent" });
});

test("a list inside a string inside a list reads back as the words, and a bracketed plain answer stays plain", () => {
  assert.deepEqual(savedSurveyAnswers({ cf_svy_money_change_now_labels: `["[\\"${MONEY}\\"]"]` }), { cf_svy_money_change_now: [MONEY] });
  assert.deepEqual(savedSurveyAnswers({ cf_svy_planned_use: "[not a list" }), { cf_svy_planned_use: "[not a list" });
});

test("nothing odd gets through: objects, blanks, huge strings and long lists", () => {
  assert.deepEqual(savedSurveyAnswers({ cf_svy_planned_use: { a: 1 }, cf_svy_funding_target_amount: "   " }), {});
  const long = savedSurveyAnswers({ cf_svy_planned_use: "x".repeat(5000) });
  assert.equal(long.cf_svy_planned_use.length, 200);
  const many = savedSurveyAnswers({ cf_svy_money_change_now: Array.from({ length: 40 }, (_, i) => `word ${i}`) });
  assert.equal(many.cf_svy_money_change_now.length, 10);
  assert.deepEqual(savedSurveyAnswers({ utm_source: "facebook", setter_handoff: { problem: "x" }, cf_svy_unknown: "x" }), {});
});

test("the business question picks the pair that comes next, on both paths", () => {
  const upToScore = {
    cf_svy_funding_target_amount: "Less than $50k", cf_svy_planned_use: "Not sure yet",
    cf_svy_money_change_now: [MONEY], cf_svy_self_reported_fico: "Not sure"
  };
  assert.equal(nextSurveyKey(upToScore), "cf_svy_has_business");
  assert.equal(nextSurveyKey({ ...upToScore, cf_svy_has_business: "Yes, 5+ years" }), "cf_svy_business_revenue");
  assert.equal(nextSurveyKey({ ...upToScore, cf_svy_has_business: "No, personal funding only" }), "cf_svy_annual_income_range");
  // The business pair is not asked of someone on the personal path, and the other way round.
  const personal = { ...upToScore, cf_svy_has_business: "No, personal funding only", cf_svy_annual_income_range: "$50k-$99k", cf_svy_income_verifiable: "Not right now" };
  assert.equal(nextSurveyKey(personal), "cf_svy_available_capital");
  const business = { ...upToScore, cf_svy_has_business: "Yes, 1-2 years", cf_svy_business_revenue: "$1M+", cf_svy_revenue_verifiable: "Not right now" };
  assert.equal(nextSurveyKey(business), "cf_svy_available_capital");
  assert.equal(nextSurveyKey({ ...business, cf_svy_available_capital: "$100k+" }), null);
});

test("every question before next_key has an answer, so a page that fills them in and jumps never skips an empty one", () => {
  // An answer missing in the middle is where the person is sent back to, not skipped.
  const hole = { cf_svy_funding_target_amount: "$400k+", cf_svy_money_change_now: [MONEY], cf_svy_available_capital: "$100k+" };
  assert.equal(nextSurveyKey(hole), "cf_svy_planned_use");
});

test("a business answer that picks neither path is not an answer", () => {
  const answers = savedSurveyAnswers({ cf_svy_has_business: "Maybe", cf_svy_planned_use: "Not sure yet" });
  assert.deepEqual(answers, { cf_svy_planned_use: "Not sure yet" });
  // A bare "Yes" still picks the business pair, the way visibleQuestions reads it.
  assert.deepEqual(savedSurveyAnswers({ cf_svy_has_business: "Yes" }), { cf_svy_has_business: "Yes" });
});

// ── where they stopped, in words ─────────────────────────────────────────────────────────────────
// The phrases are the owner's, one per question. They are written out here a second time, on purpose:
// a typo in the module would otherwise be copied straight into the test.

const SAY = {
  cf_svy_funding_target_amount: "the first question",
  cf_svy_planned_use: "the question about what the money is for",
  cf_svy_money_change_now: "the question about what the money would change",
  cf_svy_self_reported_fico: "the credit score question",
  cf_svy_has_business: "the question about your business",
  cf_svy_business_revenue: "the revenue question",
  cf_svy_revenue_verifiable: "the question about showing your revenue",
  cf_svy_annual_income_range: "the income question",
  cf_svy_income_verifiable: "the question about showing your income",
  cf_svy_available_capital: "the last question"
};

// Answers in the order a person gives them. Each row is one saved answer.
const COMMON = [
  ["cf_svy_funding_target_amount", "$50k - $100k"],
  ["cf_svy_planned_use", "Not sure yet"],
  ["cf_svy_money_change_now", [MONEY]],
  ["cf_svy_self_reported_fico", "Not sure"]
];
const BUSINESS = [
  ...COMMON,
  ["cf_svy_has_business", "Yes, 1-2 years"],
  ["cf_svy_business_revenue", "$1M+"],
  ["cf_svy_revenue_verifiable", "Yes, both"],
  ["cf_svy_available_capital", "$100k+"]
];
const PERSONAL = [
  ...COMMON,
  ["cf_svy_has_business", "No, personal funding only"],
  ["cf_svy_annual_income_range", "$50k-$99k"],
  ["cf_svy_income_verifiable", "Yes, pay stubs"],
  ["cf_svy_available_capital", "$100k+"]
];
const firstN = (path, n) => Object.fromEntries(path.slice(0, n));

test("progress words: every question on the business path, from nothing answered to the last tap", () => {
  const want = [
    // [answered so far, stopped at, taps left]
    [0, "cf_svy_funding_target_amount", "8 more taps"],
    [1, "cf_svy_planned_use", "7 more taps"],
    [2, "cf_svy_money_change_now", "6 more taps"],
    [3, "cf_svy_self_reported_fico", "5 more taps"],
    [4, "cf_svy_has_business", "4 more taps"],
    [5, "cf_svy_business_revenue", "3 more taps"],
    [6, "cf_svy_revenue_verifiable", "2 more taps"],
    [7, "cf_svy_available_capital", "1 more tap"]
  ];
  for (const [n, key, taps] of want) {
    const got = surveyProgressWords(firstN(BUSINESS, n));
    assert.equal(got.stoppedAt, SAY[key], `${n} answered: stopped at ${key}`);
    assert.equal(got.tapsLeft, taps, `${n} answered`);
    assert.equal(got.left, 8 - n);
  }
});

test("progress words: every question on the personal path", () => {
  const want = [
    [5, "cf_svy_annual_income_range", "3 more taps"],
    [6, "cf_svy_income_verifiable", "2 more taps"],
    [7, "cf_svy_available_capital", "1 more tap"]
  ];
  for (const [n, key, taps] of want) {
    const got = surveyProgressWords(firstN(PERSONAL, n));
    assert.equal(got.stoppedAt, SAY[key]);
    assert.equal(got.tapsLeft, taps);
    assert.equal(got.left, 8 - n);
  }
  // Before the business question is answered the two follow-ups are not on the path yet, but they are still to come.
  assert.equal(surveyProgressWords(firstN(PERSONAL, 4)).tapsLeft, "4 more taps");
});

test("progress words: nothing answered is the first question and all eight taps", () => {
  for (const nothing of [undefined, null, {}, { cf_svy_funding_target_amount: "207883" }]) {
    assert.deepEqual(surveyProgressWords(nothing), { stoppedAt: "the first question", tapsLeft: "8 more taps", left: 8 });
  }
});

test("progress words: one tap is '1 more tap', never '1 more taps', and two or more are plural", () => {
  assert.equal(surveyProgressWords(firstN(BUSINESS, 7)).tapsLeft, "1 more tap");
  assert.equal(surveyProgressWords(firstN(BUSINESS, 6)).tapsLeft, "2 more taps");
  for (let n = 0; n < 7; n++) assert.match(surveyProgressWords(firstN(BUSINESS, n)).tapsLeft, /^\d+ more taps$/);
});

test("progress words: nothing left is 'the last question' with no taps, never '0 more taps'", () => {
  for (const path of [BUSINESS, PERSONAL]) {
    const done = surveyProgressWords(firstN(path, 8));
    assert.equal(done.stoppedAt, "the last question");
    assert.equal(done.tapsLeft, null);
    assert.equal(done.left, 0);
  }
});

test("progress words: all ten phrases are reachable, and each is the owner's", () => {
  const seen = new Set();
  for (const path of [BUSINESS, PERSONAL]) {
    for (let n = 0; n < 8; n++) seen.add(surveyProgressWords(firstN(path, n)).stoppedAt);
  }
  seen.add(surveyProgressWords(firstN(BUSINESS, 8)).stoppedAt);
  assert.deepEqual([...seen].sort(), [...new Set(Object.values(SAY))].sort());
  assert.equal(new Set(Object.values(SAY)).size, 10);
});

test("progress words: an empty question in the middle is where they stopped, and every empty one is counted", () => {
  const hole = { cf_svy_funding_target_amount: "$400k+", cf_svy_money_change_now: [MONEY], cf_svy_available_capital: "$100k+" };
  const got = surveyProgressWords(hole);
  assert.equal(got.stoppedAt, SAY.cf_svy_planned_use);
  // planned use, the score, the business question and its two follow-ups.
  assert.equal(got.tapsLeft, "5 more taps");
});

test("progress words: an answer that is only an option id, or a business answer that picks no path, is still to do", () => {
  const ids = { ...firstN(BUSINESS, 3), cf_svy_self_reported_fico: "207907" };
  assert.equal(surveyProgressWords(ids).stoppedAt, SAY.cf_svy_self_reported_fico);
  const odd = { ...firstN(BUSINESS, 4), cf_svy_has_business: "Maybe" };
  const got = surveyProgressWords(odd);
  assert.equal(got.stoppedAt, SAY.cf_svy_has_business);
  assert.equal(got.tapsLeft, "4 more taps");
});

test("progress words: the words match what the door sends as next_key", () => {
  for (const path of [BUSINESS, PERSONAL]) {
    for (let n = 0; n <= 8; n++) {
      const fields = firstN(path, n);
      const next = nextSurveyKey(savedSurveyAnswers(fields));
      assert.equal(surveyProgressWords(fields).stoppedAt, next ? SAY[next] : "the last question");
    }
  }
});
