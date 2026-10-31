// /api/public/survey-submit — validation + classify path (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parseSurveySubmitBody,
  runSurveySubmit,
} from "../../api/public/survey-submit.mjs";
import { PASS, DOWNSELL, MANUAL_REVIEW } from "../config/survey-qualification.mjs";

function mockRes() {
  const out = { statusCode: 200, headers: {}, body: null };
  return {
    out,
    setHeader(k, v) {
      out.headers[k] = v;
    },
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(body) {
      out.body = body;
      return this;
    },
  };
}

test("parseSurveySubmitBody requires name and email; phone and SMS are optional", () => {
  assert.equal(parseSurveySubmitBody({}).ok, false);
  assert.equal(parseSurveySubmitBody({ name: "A", email: "bad", phone: "1" }).error, "name_email_required");
  const noPhone = parseSurveySubmitBody({
    name: "Ada Lovelace",
    email: "Ada@Example.COM",
    sms_consent: false,
  });
  assert.equal(noPhone.ok, true);
  assert.equal(noPhone.phone, "");
  assert.equal(noPhone.sms_consent, false);
  const ok = parseSurveySubmitBody({
    name: "Ada Lovelace",
    email: "Ada@Example.COM",
    phone: "555-0100",
    business: "Analytical Engines",
    answers: {
      cf_svy_self_reported_fico: "750+",
      cf_svy_funding_target_amount: "Less than $50k",
      ignore_me: "x",
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "ada@example.com");
  const e164 = parseSurveySubmitBody({
    name: "Ada Lovelace",
    email: "ada@example.com",
    phone: "6616054248",
  });
  assert.equal(e164.phone, "+16616054248");
  assert.deepEqual(ok.answers, {
    cf_svy_self_reported_fico: "750+",
    cf_svy_funding_target_amount: "Less than $50k",
  });
});

test("runSurveySubmit emits entry + survey and returns PASS redirect", async () => {
  const names = [];
  const fakeEmit = async (_db, name, payload) => {
    names.push({ name, payload });
    return { id: "evt", deduped: false };
  };
  const result = await runSurveySubmit(
    {
      name: "Ada",
      email: "ada@example.com",
      phone: "555",
      business: "AE",
      source: "website:home",
      sms_consent: true,
      // Legacy cf_svy_* still classifies; title-keyed answers alone do not (see audit).
      answers: {
        cf_svy_self_reported_fico: "750+",
        cf_svy_has_negatives: "No",
      },
    },
    { emit: fakeEmit, ensureRegistered: () => {}, db: {} }
  );
  assert.equal(result.ok, true);
  assert.equal(result.qualification, PASS);
  assert.match(result.redirect, /funding-book-call/);
  assert.deepEqual(
    names.map((n) => n.name),
    ["entry.captured", "survey.submitted"]
  );
  assert.equal(names[1].payload.answers.cf_svy_has_negatives, "No");
});

test("runSurveySubmit: a homepage survey with the last answer also emits survey.completed", async () => {
  const seen = [];
  const emit = async (_db, name, payload, opts) => { seen.push({ name, payload, opts }); return { id: name, deduped: false }; };
  await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: { cf_svy_self_reported_fico: "700-759", cf_svy_available_capital: "$5k - $25k" } },
    { emit, ensureRegistered: () => {}, db: {} }
  );
  assert.deepEqual(seen.map((e) => e.name), ["entry.captured", "survey.submitted", "survey.completed"]);
  assert.equal(seen[2].payload.answers.cf_svy_available_capital, "$5k - $25k");
  assert.match(seen[2].opts.idempotencyKey, /:completed$/);
});

test("runSurveySubmit score without negatives → MANUAL_REVIEW", async () => {
  const result = await runSurveySubmit(
    {
      name: "Bob",
      email: "bob@example.com",
      phone: "555",
      business: "",
      source: "website:home",
      sms_consent: false,
      answers: {
        cf_svy_self_reported_fico: "750+",
        cf_svy_has_business: "Yes, 1-2 years",
      },
    },
    { emit: async () => ({ id: "x", deduped: false }), ensureRegistered: () => {}, db: {} }
  );
  // Missing gate-2 answer (ClickFunnels or incomplete post) still MANUAL_REVIEW
  assert.equal(result.qualification, MANUAL_REVIEW);
});

test("parseSurveySubmitBody keeps homepage cf_svy_has_negatives", () => {
  const ok = parseSurveySubmitBody({
    name: "Ada Lovelace",
    email: "ada@example.com",
    answers: {
      cf_svy_self_reported_fico: "750+",
      cf_svy_has_negatives: "No",
      cf_svy_has_business: "Yes, 1-2 years",
    },
    answers_by_id: {
      current_score: "750+",
      has_negatives: "No",
      has_business: "Yes, 1-2 years",
    },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.answers.cf_svy_has_negatives, "No");
  assert.equal(ok.answers.cf_svy_self_reported_fico, "750+");
});

test("runSurveySubmit MANUAL_REVIEW when gate answers missing", async () => {
  const result = await runSurveySubmit(
    {
      name: "C",
      email: "c@example.com",
      phone: "555",
      business: "",
      source: "website:home",
      sms_consent: false,
      answers: { cf_svy_funding_target_amount: "$50k - $100k" },
    },
    { emit: async () => ({ id: "x", deduped: false }), ensureRegistered: () => {}, db: {} }
  );
  assert.equal(result.qualification, MANUAL_REVIEW);
});

test("handler rejects GET", async () => {
  const res = mockRes();
  await handler({ method: "GET" }, res);
  assert.equal(res.out.statusCode, 405);
});

test("handler rejects incomplete body", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { name: "Only" } }, res);
  assert.equal(res.out.statusCode, 400);
  assert.equal(res.out.body.error, "name_email_required");
});
