// Apply-survey rebuild: the browser SEND_STEP shape in
// marketing/landing-pages/apply-survey.html, and the door it posts to
// (/api/webhooks/clickfunnels → handleWebhook). Fake db only — no live writes.
//
// node --test src/http/apply-survey-webhook.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleWebhook } from "./router.mjs";
import webhookHandler from "../../api/webhooks/[provider].mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { clearHandlers } from "../events/registry.mjs";
import { _resetRegistered } from "../register-all.mjs";
import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const HTML = fs.readFileSync(path.join(ROOT, "marketing/landing-pages/apply-survey.html"), "utf8");
const WATCH = fs.readFileSync(path.join(ROOT, "public/funnel/watch-proof.js"), "utf8");

const INGEST = "apply_survey_route_test";

function arrayLiteral(src, name) {
  const start = src.indexOf(`var ${name} = [`);
  assert.ok(start > -1, `${name} is missing`);
  const body = src.slice(start + `var ${name} = `.length, src.indexOf("];", start) + 1);
  return new Function(`return ${body};`)();
}

function fakeDb() {
  const store = [];
  let n = 0;
  return {
    store,
    query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-apply-survey" }] };
      if (/INSERT INTO events/.test(sql)) {
        store.push({ name: params[1], payload: params[5] });
        return { rows: [{ id: `evt-${++n}` }] };
      }
      return { rows: [] };
    }
  };
}

function reset() {
  _resetOrgCache();
  clearHandlers();
  _resetRegistered();
}

function post(raw, { header = INGEST, envSecret = INGEST } = {}) {
  reset();
  const db = fakeDb();
  const headers = header ? { "x-fundhub-apply-survey-ingest": header } : {};
  const env = {};
  if (envSecret) env.CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET = envSecret;
  return handleWebhook({
    db,
    provider: "clickfunnels",
    rawBody: JSON.stringify(raw),
    headers,
    url: "https://fundhub.ai/api/webhooks/clickfunnels",
    env
  }).then((out) => ({ out, db }));
}

const CONTACT = {
  source: "apply-survey",
  funnel: "apply-survey",
  step_key: "contact",
  email: "e2e+apply-survey@example.com",
  name: "Jane Doe",
  phone: "(480) 555-1234",
  answers: {},
  a1: "aff-lane",
  a2: null,
  attribution: {
    utm_source: "meta",
    utm_medium: "paid",
    utm_campaign: "slo",
    utm_content: "43",
    utm_term: null,
    landing_path: "/apply",
    referrer_domain: "facebook.com"
  }
};

const SURVEY = {
  ...CONTACT,
  step_key: "cf_svy_available_capital",
  answers: {
    cf_svy_funding_target_amount: "$200k - $400k",
    cf_svy_planned_use: "Growth (marketing, inventory, hiring)",
    cf_svy_money_change_now: ["Peace of mind (stop stressing about cash)"],
    cf_svy_self_reported_fico: "650-699",
    cf_svy_has_business: "No, personal funding only",
    cf_svy_annual_income_range: "$50k-$99k",
    cf_svy_income_verifiable: "Yes, pay stubs",
    cf_svy_available_capital: "Less than $1k"
  }
};

test("apply-survey.html questions match the CF map, labels not option ids, Other off", () => {
  const questions = arrayLiteral(HTML, "Q");
  assert.equal(questions.length, CF_SURVEY_QUESTIONS.length);
  for (let i = 0; i < questions.length; i++) {
    const got = questions[i];
    const want = CF_SURVEY_QUESTIONS[i];
    assert.equal(got.key, want.payloadKey, want.payloadKey);
    assert.equal(got.title, want.title, want.title);
    assert.equal(got.type, want.type, want.title);
    if (want.options) assert.deepEqual(got.opts, want.options, want.title);
    assert.equal(got.other, undefined, `${want.title} still has Other`);
    for (const label of got.opts || []) {
      assert.equal(/^\d+$/.test(label), false, `option id leaked: ${label}`);
    }
  }
  const biz = questions.find((q) => q.key === "cf_svy_has_business");
  assert.equal(biz.opts.length, 6);
  assert.equal(biz.opts[5], "No, personal funding only");
  assert.equal(questions.some((q) => q.branch === "personal"), true);
  assert.equal(questions.some((q) => q.branch === "biz"), true);
});

test("apply-survey.html SEND_STEP posts the handoff shape to /api/webhooks/clickfunnels", () => {
  assert.match(HTML, /function stepPayload\(stepKey\)/);
  assert.match(HTML, /source: 'apply-survey'/);
  assert.match(HTML, /funnel: 'apply-survey'/);
  assert.match(HTML, /step_key: stepKey/);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "landing_path", "referrer_domain"]) {
    assert.ok(HTML.includes(key), key);
  }
  assert.match(HTML, /\/api\/webhooks\/clickfunnels/);
  assert.match(HTML, /X-Fundhub-Apply-Survey-Ingest/);
  assert.match(HTML, /fetch\(WEBHOOK_URL/);
  assert.equal(HTML.includes("CLICKFUNNELS_API_KEY"), false, "ClickFunnels key stays on the server");
  assert.equal(HTML.includes("contacts/upsert"), false, "the page does not call ClickFunnels itself");
  assert.equal(HTML.includes("window.FH_APPLY_SURVEY_INGEST="), false, "ingest secret is injected at push, not stored in the fragment");
  assert.match(HTML, /data-src="https:\/\/apply\.fundhub\.ai\/funding-book-call"/);
  assert.equal(HTML.includes("Preview calendar"), false);
  /* Phase 4 (docs/tracking/meta-events.md): the shared tracker is the only Meta sender.
     Lead comes from survey_answer last:true, Schedule from the framed calendar's
     booking_confirmed. The page itself calls fbq for nothing (no double counting). */
  assert.equal(HTML.includes("fbq("), false, "no hand-written Meta call on the page");
  assert.doesNotMatch(HTML, /fhTrack\('(Lead|Schedule)'/);
  assert.doesNotMatch(HTML, /['"](Lead|Schedule)['"]/);
  assert.equal(HTML.includes("fh_booking_v1"), false, "the old Schedule listener is gone");
  assert.match(HTML, /if \(at === list\.length - 1\) p\.last = true;\n\s*fht\('survey_answer', p\);/);
});

test("apply-survey approval strip is the same 16 watch-proof cards", () => {
  const survey = arrayLiteral(HTML, "WINS");
  const watch = arrayLiteral(WATCH, "WINS");
  assert.equal(survey.length, 16);
  assert.equal(watch.length, 16);
  for (let i = 0; i < 16; i++) {
    assert.equal(survey[i].img, watch[i].src, watch[i].id);
    assert.equal(survey[i].alt, watch[i].alt, watch[i].id);
    const dollars = Number(String(watch[i].amount).replace(/[$,]/g, ""));
    assert.equal(survey[i].amount, dollars, watch[i].id);
  }
});

test("POST /api/webhooks/clickfunnels: contact step is entry.captured with attribution", async () => {
  const { out, db } = await post(CONTACT);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body.emitted.map((e) => e.name), ["entry.captured"]);
  const entry = db.store.find((r) => r.name === "entry.captured");
  assert.equal(entry.payload.email, "e2e+apply-survey@example.com");
  assert.equal(entry.payload.funnel, "apply-survey");
  assert.equal(entry.payload.a1, "aff-lane");
  assert.equal(entry.payload.attribution.utm_source, "meta");
  assert.equal(entry.payload.attribution.utm_content, "43");
  assert.equal(entry.payload.attribution.landing_path, "/apply");
  assert.equal(entry.payload.attribution.referrer_domain, "facebook.com");
});

test("POST /api/webhooks/clickfunnels: cf_svy_* labels emit survey.submitted", async () => {
  const { out, db } = await post(SURVEY);
  assert.equal(out.status, 200);
  // SURVEY carries the last answer, so it also finishes the survey (2026-10-31).
  assert.deepEqual(out.body.emitted.map((e) => e.name), ["entry.captured", "survey.submitted", "survey.completed"]);
  const completed = db.store.find((r) => r.name === "survey.completed");
  assert.equal(completed.payload.answers.cf_svy_available_capital, "Less than $1k");
  const survey = db.store.find((r) => r.name === "survey.submitted");
  assert.equal(survey.payload.answers.cf_svy_has_business, "No, personal funding only");
  assert.equal(survey.payload.answers.cf_svy_available_capital, "Less than $1k");
  assert.deepEqual(survey.payload.answers.cf_svy_money_change_now, [
    "Peace of mind (stop stressing about cash)"
  ]);
  assert.equal(survey.payload.attribution.utm_campaign, "slo");
  assert.equal(survey.payload.a1, "aff-lane");
  for (const value of Object.values(survey.payload.answers)) {
    const list = Array.isArray(value) ? value : [value];
    for (const label of list) assert.equal(/^\d+$/.test(String(label)), false);
  }
});

test("POST /api/webhooks/clickfunnels: apply-survey without the ingest secret is 401", async () => {
  const missing = await post(SURVEY, { header: null, envSecret: INGEST });
  assert.equal(missing.out.status, 401);
  assert.equal(missing.db.store.length, 0);
  const wrong = await post(SURVEY, { header: "nope", envSecret: INGEST });
  assert.equal(wrong.out.status, 401);
  assert.equal(wrong.db.store.length, 0);
});

function fakeRes() {
  const headers = {};
  return {
    headers,
    statusCode: 200,
    setHeader(k, v) { headers[k] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    end() { this.ended = true; },
    json(body) { this.body = body; }
  };
}

test("apply survey browser preflight is allowed only from apply.fundhub.ai", async () => {
  const ok = fakeRes();
  await webhookHandler({
    method: "OPTIONS",
    query: { provider: "clickfunnels" },
    headers: { origin: "https://apply.fundhub.ai" }
  }, ok);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.headers["Access-Control-Allow-Origin"], "https://apply.fundhub.ai");
  assert.match(ok.headers["Access-Control-Allow-Headers"], /X-Fundhub-Apply-Survey-Ingest/);

  const other = fakeRes();
  await webhookHandler({
    method: "OPTIONS",
    query: { provider: "clickfunnels" },
    headers: { origin: "https://example.com" }
  }, other);
  assert.equal(other.statusCode, 405);
  assert.equal(other.headers["Access-Control-Allow-Origin"], undefined);
});
