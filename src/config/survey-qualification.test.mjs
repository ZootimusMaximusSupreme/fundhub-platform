import { test } from "node:test";
import assert from "node:assert";
import {
  classifySurvey, currentQualification, ficoGatePasses, negativesGatePasses, creditTierFor,
  PASS, DOWNSELL, MANUAL_REVIEW, FICO_BANDS, PASSING_FICO_BANDS, LEGACY_FICO_BANDS, LEGACY_PASSING_FICO_BANDS
} from "./survey-qualification.mjs";
import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";

// --- the score answers (owner-set 2026-10-31) ---------------------------------

test("the score answers are the owner's five, in order, and the survey offers exactly these", () => {
  assert.deepEqual(FICO_BANDS, ["500-619", "620-699", "700-759", "760-850", "Not sure"]);
  assert.deepEqual(PASSING_FICO_BANDS, ["700-759", "760-850"]);
  assert.deepEqual(CF_SURVEY_QUESTIONS.find((q) => q.id === "current_score").options, FICO_BANDS);
});

test("answers saved before 2026-10-31 read the same as they always did", () => {
  for (const band of LEGACY_FICO_BANDS) {
    assert.equal(ficoGatePasses(band), LEGACY_PASSING_FICO_BANDS.includes(band), band);
  }
  assert.equal(ficoGatePasses("700-749"), true);
  assert.equal(ficoGatePasses("650-699"), false);
});

test("creditTierFor: 700 and up is qualified, everything else unqualified, no answer is null", () => {
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "700-759" }), "qualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "760-850" }), "qualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "750+" }), "qualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "620-699" }), "unqualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "500-619" }), "unqualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "Not sure" }), "unqualified");
  assert.equal(creditTierFor({}), null);
  assert.equal(creditTierFor(null), null);
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "123456" }), null, "a ClickFunnels option id is not an answer");
});

test("creditTierFor: the label wins over the raw value, and a setter's fix wins over both", () => {
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "88001", cf_svy_self_reported_fico_label: "760-850" }), "qualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "760-850", setter_survey_edits: { cf_svy_self_reported_fico: "620-699" } }), "unqualified");
  assert.equal(creditTierFor({ cf_svy_self_reported_fico: "500-619", setter_survey_edits: { cf_svy_self_reported_fico: "700-759" } }), "qualified");
});

// --- gate 1: FICO (doc 38, 146) ---------------------------------------------

test("ficoGatePasses: only 700-759 and 760-850 clear the gate", () => {
  for (const band of FICO_BANDS) {
    const expected = PASSING_FICO_BANDS.includes(band);
    assert.equal(ficoGatePasses(band), expected, `band ${band}`);
  }
});

test("ficoGatePasses: 'Not sure' is a real answer that FAILS, not an absent one", () => {
  assert.equal(ficoGatePasses("Not sure"), false);
});

test("ficoGatePasses: absent is null (defer), not false", () => {
  for (const v of [null, undefined, "", "   "]) assert.equal(ficoGatePasses(v), null);
});

test("ficoGatePasses: en-dash bands from the field modal normalize to the gate's hyphens", () => {
  assert.equal(ficoGatePasses("750+"), true);
  assert.equal(ficoGatePasses("700–749"), true, "en-dash 700–749");
  assert.equal(ficoGatePasses("650–699"), false, "en-dash 650–699");
});

// --- gate 2: negatives (doc 39, 147) ----------------------------------------

test("negativesGatePasses: No passes, Yes fails, case-insensitive", () => {
  assert.equal(negativesGatePasses("No"), true);
  assert.equal(negativesGatePasses("no"), true);
  assert.equal(negativesGatePasses("Yes"), false);
  assert.equal(negativesGatePasses("YES"), false);
});

test("negativesGatePasses: absent or unrecognized is null (defer), never a guess", () => {
  for (const v of [null, undefined, "", "maybe", "N/A", 42]) {
    assert.equal(negativesGatePasses(v), null, `value ${v}`);
  }
});

// --- the combined gate ------------------------------------------------------

test("classifySurvey: both gates pass -> PASS", () => {
  assert.equal(classifySurvey({ svy_self_reported_fico: "750+", svy_has_negatives: "No" }), PASS);
  assert.equal(classifySurvey({ svy_self_reported_fico: "700-749", svy_has_negatives: "No" }), PASS);
});

test("classifySurvey: failing either gate -> DOWNSELL", () => {
  assert.equal(classifySurvey({ svy_self_reported_fico: "650-699", svy_has_negatives: "No" }), DOWNSELL);
  assert.equal(classifySurvey({ svy_self_reported_fico: "750+", svy_has_negatives: "Yes" }), DOWNSELL);
  assert.equal(classifySurvey({ svy_self_reported_fico: "500-579", svy_has_negatives: "Yes" }), DOWNSELL);
});

// THE REGRESSION THIS MODULE EXISTS FOR (doc line 206 — cf_svy_has_negatives is pending
// from DirectROAS). A missing answer must route to a human, not silently pass or fail.
test("classifySurvey: negatives field ABSENT -> MANUAL_REVIEW, not PASS and not DOWNSELL", () => {
  const r = classifySurvey({ svy_self_reported_fico: "750+" });
  assert.equal(r, MANUAL_REVIEW);
  assert.notEqual(r, PASS, "must not fail open — would send unqualified people to a call");
  assert.notEqual(r, DOWNSELL, "must not fail closed — would send qualified people to the downsell");
});

test("classifySurvey: FICO absent -> MANUAL_REVIEW", () => {
  assert.equal(classifySurvey({ svy_has_negatives: "No" }), MANUAL_REVIEW);
});

test("classifySurvey: nothing answered at all -> MANUAL_REVIEW", () => {
  assert.equal(classifySurvey({}), MANUAL_REVIEW);
});

// A definite failure is not made uncertain by an unrelated missing field (doc 40:
// "FAIL either gate goes to the ... downsell").
test("classifySurvey: a definite FAIL wins over a missing sibling field", () => {
  assert.equal(classifySurvey({ svy_self_reported_fico: "500-579" }), DOWNSELL);
  assert.equal(classifySurvey({ svy_has_negatives: "Yes" }), DOWNSELL);
});

test("classifySurvey: accepts the cf_-prefixed field keys too", () => {
  assert.equal(classifySurvey({ cf_svy_self_reported_fico: "750+", cf_svy_has_negatives: "No" }), PASS);
});

// The day DirectROAS ships the key, real values arrive and the gate starts working with
// no code change — this test is that guarantee, written as a before/after pair.
test("classifySurvey: the same contact flips from MANUAL_REVIEW to PASS once the field lands", () => {
  const before = { svy_self_reported_fico: "750+" };
  assert.equal(classifySurvey(before), MANUAL_REVIEW);
  assert.equal(classifySurvey({ ...before, svy_has_negatives: "No" }), PASS);
});

// --- db-reading resolver ----------------------------------------------------

function pgFake(clients) {
  return { async query(sql, params) {
    assert.match(sql, /SELECT custom_fields FROM clients/);
    const c = clients.find((x) => x.id === params[0]);
    return { rows: c ? [{ custom_fields: c.custom_fields }] : [] };
  } };
}

test("currentQualification: reads the client's answers and classifies", async () => {
  const db = pgFake([
    { id: "cl-1", custom_fields: { svy_self_reported_fico: "750+", svy_has_negatives: "No" } },
    { id: "cl-2", custom_fields: { svy_self_reported_fico: "580-649", svy_has_negatives: "Yes" } },
    { id: "cl-3", custom_fields: { svy_self_reported_fico: "750+" } }
  ]);
  assert.equal(await currentQualification(db, "cl-1"), PASS);
  assert.equal(await currentQualification(db, "cl-2"), DOWNSELL);
  assert.equal(await currentQualification(db, "cl-3"), MANUAL_REVIEW);
  assert.equal(await currentQualification(db, "cl-missing"), null);
});

test("currentQualification: null clientId short-circuits without querying", async () => {
  const db = { query: () => { throw new Error("should not query"); } };
  assert.equal(await currentQualification(db, null), null);
});
