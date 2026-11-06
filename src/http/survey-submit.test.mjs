// /api/public/survey-submit — validation + classify path (no live Postgres).

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parseSurveySubmitBody,
  runSurveySubmit,
} from "../../api/public/survey-submit.mjs";
import { PASS, DOWNSELL, MANUAL_REVIEW } from "../config/survey-qualification.mjs";
import { validBookingTicket } from "../survey/booking-ticket.mjs";

const SECRET = "unit-test-booking-ticket-secret-0123456789abcdef";
const NOW = Date.parse("2026-11-05T08:00:00Z");
const FULL_PASS_ANSWERS = {
  cf_svy_funding_target_amount: "$50k - $100k",
  cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
  cf_svy_money_change_now: ["Grow faster (more customers / more reach)"],
  cf_svy_self_reported_fico: "700-759",
  cf_svy_has_negatives: "No",
  cf_svy_has_business: "Yes, 1-2 years",
  cf_svy_business_revenue: "$100k - $249k",
  cf_svy_revenue_verifiable: "Yes, bank statements",
  cf_svy_available_capital: "$5k - $9,999",
};

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

test("a partial PASS survey is saved but cannot open the top-level calendar", async () => {
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
  assert.equal(result.redirect, "https://apply.fundhub.ai/apply");
  assert.equal(result.survey_completed, false);
  assert.equal(result.public_contact_receipt, undefined);
  assert.deepEqual(
    names.map((n) => n.name),
    ["entry.captured", "survey.submitted"]
  );
  assert.equal(names[1].payload.answers.cf_svy_has_negatives, "No");
});

test("runSurveySubmit: a homepage survey with the last answer also emits survey.completed", async () => {
  const seen = [];
  const order = [];
  const receipt = "10000000-0072-4ace-8a77-100000000001";
  const emit = async (_db, name, payload, opts) => { seen.push({ name, payload, opts }); order.push(name); return { id: name === "survey.completed" ? receipt : name, deduped: false }; };
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: FULL_PASS_ANSWERS },
    { emit, ensureRegistered: () => {}, db: {}, secret: SECRET, now: NOW,
      orgId: "org-ada", resolveClient: async () => "client-ada",
      hasSavedCompleteSurvey: async () => { order.push("saved-answer-readback"); return true; } }
  );
  assert.equal(result.survey_completed, true);
  assert.equal(result.public_contact_receipt, receipt);
  assert.deepEqual(order, ["entry.captured", "survey.submitted", "saved-answer-readback", "survey.completed"]);
  assert.deepEqual(seen.map((e) => e.name), ["entry.captured", "survey.submitted", "survey.completed"]);
  assert.equal(seen[2].payload.answers.cf_svy_available_capital, "$5k - $9,999");
  assert.match(seen[2].opts.idempotencyKey, /:completed$/);
  assert.equal(seen[2].opts.clientId, "client-ada");
  assert.equal(result.qualification, PASS);
  const redirect = new URL(result.redirect);
  assert.equal(redirect.origin + redirect.pathname, "https://apply.fundhub.ai/funding-book-call");
  const ticket = new URLSearchParams(redirect.hash.slice(1)).get("fh_survey_ticket");
  assert.equal(validBookingTicket(ticket, { secret: SECRET, now: NOW }), true);
  assert.equal(result.redirect.includes("ada@example.com"), false, "the URL contains no contact data");
});

test("a full survey without a resolved client emits no false completion or ticket", async () => {
  const names = [];
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: FULL_PASS_ANSWERS },
    { emit: async (_db, name) => { names.push(name); return { id: "evt", deduped: false }; }, ensureRegistered: () => {},
      db: {}, secret: SECRET, now: NOW, resolveClient: async () => null }
  );
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
  assert.equal(result.redirect, "https://apply.fundhub.ai/apply");
});

test("an answer-write failure emits no false completion or ticket, preserving S-02", async () => {
  const names = [];
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: FULL_PASS_ANSWERS },
    { emit: async (_db, name) => { names.push(name); return { id: "evt", deduped: false }; }, ensureRegistered: () => {},
      db: {}, secret: SECRET, now: NOW, orgId: "org-ada",
      resolveClient: async () => "client-ada", hasSavedCompleteSurvey: async () => false }
  );
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
  assert.equal(result.redirect, "https://apply.fundhub.ai/apply");
});

test("the default ticket gate reads the saved client answers after event dispatch", async () => {
  const queries = [];
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: FULL_PASS_ANSWERS },
    { emit: async () => ({ id: "evt", deduped: false }), ensureRegistered: () => {},
      db: { async query(sql, params) {
        queries.push({ sql, params });
        return { rows: [{ custom_fields: FULL_PASS_ANSWERS }] };
      } }, secret: SECRET, now: NOW, orgId: "org-ada",
      resolveClient: async () => "client-ada" }
  );
  assert.deepEqual(queries.map((q) => q.params), [["client-ada"]]);
  assert.match(result.redirect, /#fh_survey_ticket=/);
});

test("an old complete survey cannot approve a new PASS post whose answers failed to save", async () => {
  const oldAnswers = { ...FULL_PASS_ANSWERS, cf_svy_planned_use: "Debt consolidation" };
  const names = [];
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: FULL_PASS_ANSWERS },
    { emit: async (_db, name) => { names.push(name); return { id: "evt", deduped: false }; }, ensureRegistered: () => {},
      db: { async query() { return { rows: [{ custom_fields: oldAnswers }] }; } },
      secret: SECRET, now: NOW, orgId: "org-ada", resolveClient: async () => "client-ada" }
  );
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
  assert.equal(result.redirect, "https://apply.fundhub.ai/apply");
});

test("a last answer without the earlier branch answers does not emit completion or get a ticket", async () => {
  const names = [];
  const result = await runSurveySubmit(
    { name: "Ada", email: "ada@example.com", phone: "555", source: "website:home",
      answers: { cf_svy_self_reported_fico: "700-759", cf_svy_has_negatives: "No",
        cf_svy_available_capital: "$5k - $9,999" } },
    { emit: async (_db, name) => { names.push(name); return { id: name, deduped: false }; },
      ensureRegistered: () => {}, db: {}, secret: SECRET, now: NOW }
  );
  assert.deepEqual(names, ["entry.captured", "survey.submitted"]);
  assert.equal(result.redirect, "https://apply.fundhub.ai/apply");
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
