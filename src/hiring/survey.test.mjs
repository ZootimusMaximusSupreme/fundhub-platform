// Hiring funnel survey — pure tests. No database, so these run on every build.
//
// The ones that matter most:
//   - an answer that is not one of the owner's options never gets through
//   - a key that is not one of the owner's questions never gets through
//   - the review rules hold the calendar back for exactly the two cases Chris
//     named, and for nobody else
//   - the page's copy of the questions matches this module, word for word
//   - the old careers form is untouched: it still cannot send answers

import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FUNNEL_ROLES, QUESTIONS, REVIEW_RULES, SURVEY_VERSION, REFERENCE,
  questionsFor, parseSurveyAnswers, parseReference, routeFor, loomUrl, pageSurvey
} from "./survey.mjs";
import { isProtected } from "./grading.mjs";
import { parseApplyBody } from "./apply-public.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.join(HERE, "../../public/join/apply/index.html");

/* A complete, good answer set for a seat: the first option of every question,
   except the two that would trip a review rule. */
function goodAnswers(roleKey) {
  const out = {};
  for (const q of questionsFor(roleKey)) out[q.key] = q.opts[0];
  if (roleKey === "closer") out.closer_top_ticket = "$5,000 to $10,000";
  return out;
}

function funnelBody(roleKey, extra = {}) {
  return {
    funnel: "join",
    role: roleKey,
    name: "Dana Reyes",
    email: "dana@example.test",
    phone: "(602) 555-0142",
    linkedin: "linkedin.com/in/danareyes",
    loom: "https://www.loom.com/share/abc123",
    answers: goodAnswers(roleKey),
    reference: goodReference(roleKey),
    ...extra
  };
}

function goodReference(roleKey) {
  return { name: "Sam Ortiz", phone: "(480) 555-0199", company: "Acme Lending",
    relationship: REFERENCE[roleKey].relationships[0] };
}

describe("hiring survey — the reference", () => {
  test("sales seats ask for a sales manager or business owner; the COO asks for a founder or investor", () => {
    for (const r of ["setter", "closer", "csm"]) {
      assert.ok(REFERENCE[r].relationships.includes("Sales manager I reported to"), r);
    }
    assert.ok(REFERENCE.coo.relationships.includes("Founder I worked with"));
    assert.ok(REFERENCE.coo.relationships.includes("Investor in a company I ran"));
  });

  test("a complete reference parses, phone as 10 digits", () => {
    assert.deepStrictEqual(parseReference("closer", goodReference("closer"), "6025550142"), {
      ok: true,
      reference: { name: "Sam Ortiz", phone: "4805550199", company: "Acme Lending",
        relationship: "Sales manager I reported to" }
    });
  });

  test("every part is required", () => {
    for (const k of ["name", "company", "relationship"]) {
      const ref = { ...goodReference("setter") };
      delete ref[k];
      assert.equal(parseReference("setter", ref).error, "reference_required", k);
    }
    assert.equal(parseReference("setter", { ...goodReference("setter"), phone: "" }).error,
      "reference_phone_invalid");
    assert.equal(parseReference("setter", undefined).error, "reference_required");
  });

  test("the applicant's own number is refused", () => {
    assert.equal(parseReference("csm", goodReference("csm"), "480-555-0199").error, "reference_same_as_you");
  });

  test("another seat's relationship, an extra key, or a link is refused", () => {
    assert.equal(parseReference("coo", goodReference("closer")).error, "reference_required");
    assert.equal(parseReference("closer", { ...goodReference("closer"), email: "x@y.test" }).error,
      "reference_required");
    assert.equal(parseReference("closer", { ...goodReference("closer"), name: "http://spam.test" }).error,
      "reference_required");
  });

  test("the public door requires the reference and stores it on the answers", () => {
    assert.equal(parseApplyBody(funnelBody("closer", { reference: undefined })).error, "reference_required");
    const out = parseApplyBody(funnelBody("coo"));
    assert.equal(out.ok, true);
    assert.equal(out.answers.reference.relationship, "Founder I worked with");
    assert.equal(out.answers.reference.phone, "4805550199");
  });
});

describe("hiring survey — the questions", () => {
  test("every seat the funnel hires for has questions, and the four seats are the owner's", () => {
    assert.deepStrictEqual([...FUNNEL_ROLES], ["setter", "closer", "csm", "coo"]);
    for (const r of FUNNEL_ROLES) assert.ok(questionsFor(r).length >= 4, `${r} has questions`);
  });

  test("each seat gets exactly three questions of its own (owner-set 2026-10-13)", () => {
    for (const r of FUNNEL_ROLES) {
      const own = QUESTIONS.filter((q) => q.roles.length === 1 && q.roles[0] === r);
      assert.equal(own.length, 3, `${r} has three seat questions`);
    }
  });

  test("no question key looks like a protected characteristic", () => {
    for (const q of QUESTIONS) {
      assert.equal(isProtected(q.key), false, `${q.key} must not trip the protected deny-list`);
    }
  });

  test("every question has at least two options and no repeats", () => {
    for (const q of QUESTIONS) {
      assert.ok(q.opts.length >= 2, `${q.key} has options`);
      assert.equal(new Set(q.opts).size, q.opts.length, `${q.key} has no repeated option`);
    }
  });
});

describe("hiring survey — parsing answers", () => {
  test("a complete answer set for each seat parses, word for word", () => {
    for (const r of FUNNEL_ROLES) {
      const out = parseSurveyAnswers(r, goodAnswers(r));
      assert.equal(out.ok, true, `${r} parses`);
      assert.deepStrictEqual(out.answers, goodAnswers(r));
    }
  });

  test("a missing answer is refused", () => {
    const a = goodAnswers("closer");
    delete a.closer_cash_last_month;
    assert.deepStrictEqual(parseSurveyAnswers("closer", a), { ok: false, error: "survey_incomplete" });
  });

  test("an answer that is not one of the options is refused, not coerced", () => {
    const a = goodAnswers("setter");
    a.setter_dials = "about 300";
    assert.deepStrictEqual(parseSurveyAnswers("setter", a), { ok: false, error: "survey_incomplete" });
  });

  test("another seat's question is refused", () => {
    const a = { ...goodAnswers("setter"), closer_top_ticket: "$10,000+" };
    assert.deepStrictEqual(parseSurveyAnswers("setter", a), { ok: false, error: "survey_answer_unknown" });
  });

  test("an extra key is refused — including one that names a protected characteristic", () => {
    const a = { ...goodAnswers("csm"), age: "34" };
    assert.deepStrictEqual(parseSurveyAnswers("csm", a), { ok: false, error: "survey_answer_unknown" });
  });

  test("a seat the funnel does not hire for is refused", () => {
    assert.equal(parseSurveyAnswers("sales_coordinator", {}).ok, false);
  });

  test("an answer set that is not an object is refused", () => {
    for (const bad of [null, "x", ["a"], 7]) {
      assert.equal(parseSurveyAnswers("closer", bad).ok, false);
    }
  });
});

describe("hiring survey — who sees the calendar", () => {
  test("good answers go straight to the calendar, for every seat", () => {
    for (const r of FUNNEL_ROLES) {
      assert.deepStrictEqual(routeFor(r, goodAnswers(r)), { next: "book", flags: [] }, r);
    }
  });

  test("part-time only holds the calendar back, for every seat", () => {
    for (const r of FUNNEL_ROLES) {
      const out = routeFor(r, { ...goodAnswers(r), hours: "Part-time only" });
      assert.deepStrictEqual(out, { next: "review", flags: ["part_time_only"] }, r);
    }
  });

  test("a closer who has never closed over $3,000 is held back", () => {
    const out = routeFor("closer", { ...goodAnswers("closer"), closer_top_ticket: "Under $3,000" });
    assert.deepStrictEqual(out, { next: "review", flags: ["closer_under_3000"] });
  });

  test("$3,000 and up books, so the line sits where the owner put it", () => {
    for (const t of ["$3,000 to $5,000", "$5,000 to $10,000", "$10,000+"]) {
      assert.equal(routeFor("closer", { ...goodAnswers("closer"), closer_top_ticket: t }).next, "book", t);
    }
  });

  test("both rules can fire at once, and both are recorded", () => {
    const out = routeFor("closer", {
      ...goodAnswers("closer"), hours: "Part-time only", closer_top_ticket: "Under $3,000"
    });
    assert.deepStrictEqual(out.flags, ["part_time_only", "closer_under_3000"]);
  });

  test("there are exactly the two rules the owner named", () => {
    assert.deepStrictEqual(REVIEW_RULES.map((r) => r.id), ["part_time_only", "closer_under_3000"]);
  });
});

describe("hiring survey — Loom link", () => {
  test("a Loom share link is kept, as https", () => {
    assert.equal(loomUrl("loom.com/share/abc"), "https://loom.com/share/abc");
    assert.equal(loomUrl("http://www.loom.com/share/abc"), "https://www.loom.com/share/abc");
  });
  test("blank is blank, and anything that is not a Loom link is refused", () => {
    assert.equal(loomUrl(""), "");
    assert.equal(loomUrl(null), "");
    for (const bad of ["https://youtube.com/watch?v=1", "https://loom.com.evil.test/x",
      "javascript:alert(1)", "https://loom.com/", "x".repeat(400)]) {
      assert.equal(loomUrl(bad), null, bad);
    }
  });
});

describe("hiring survey — the public door", () => {
  test("a funnel application parses with answers, Loom, route and version", () => {
    const out = parseApplyBody(funnelBody("closer"));
    assert.equal(out.ok, true);
    assert.equal(out.funnel, "join");
    assert.equal(out.loomUrl, "https://www.loom.com/share/abc123");
    assert.equal(out.linkedinProfileUrl, "https://linkedin.com/in/danareyes");
    assert.deepStrictEqual(out.route, { next: "book", flags: [] });
    assert.equal(out.answers.survey_version, SURVEY_VERSION);
    assert.deepStrictEqual(out.answers.review_flags, []);
    assert.equal(out.answers.closer_top_ticket, "$5,000 to $10,000");
  });

  test("the funnel requires LinkedIn, a phone number and a Loom", () => {
    assert.equal(parseApplyBody(funnelBody("setter", { linkedin: "" })).error, "linkedin_required");
    assert.equal(parseApplyBody(funnelBody("setter", { phone: "" })).error, "phone_required");
    assert.equal(parseApplyBody(funnelBody("setter", { loom: "" })).error, "loom_required");
    assert.equal(parseApplyBody(funnelBody("setter", { loom: "https://vimeo.com/1" })).error, "loom_url_invalid");
  });

  test("the funnel refuses an incomplete survey", () => {
    const body = funnelBody("csm");
    delete body.answers.csm_credit_finance;
    assert.equal(parseApplyBody(body).error, "survey_incomplete");
  });

  test("a held-back route is carried on the stored answers", () => {
    const body = funnelBody("closer");
    body.answers.closer_top_ticket = "Under $3,000";
    const out = parseApplyBody(body);
    assert.equal(out.ok, true, "held back is still a saved application, never a refusal");
    assert.equal(out.route.next, "review");
    assert.deepStrictEqual(out.answers.review_flags, ["closer_under_3000"]);
  });

  test("the old careers form still cannot send answers", () => {
    const out = parseApplyBody({ role: "closer", name: "Dana Reyes", email: "dana@example.test",
      answers: { years_in_role: "5+ years" } });
    assert.deepStrictEqual(out, { ok: false, error: "unsupported_field" });
  });

  test("an unknown funnel name is refused", () => {
    assert.equal(parseApplyBody({ ...funnelBody("closer"), funnel: "other" }).error, "unsupported_field");
  });

  test("the old careers form still parses as before, with LinkedIn optional", () => {
    const out = parseApplyBody({ role: "closer", name: "Dana Reyes", email: "dana@example.test" });
    assert.equal(out.ok, true);
    assert.equal(out.funnel, undefined);
    assert.equal(out.answers, undefined);
  });
});

describe("hiring survey — the page's copy", () => {
  test("public/join/apply/index.html carries pageSurvey() word for word", () => {
    const html = fs.readFileSync(PAGE, "utf8");
    const m = html.match(/<script type="application\/json" id="fh-join-survey">([\s\S]*?)<\/script>/);
    assert.ok(m, "the page has script#fh-join-survey");
    assert.deepStrictEqual(JSON.parse(m[1]), pageSurvey(),
      "the page and src/hiring/survey.mjs drifted — regenerate the page block from pageSurvey()");
  });

  test("the page posts to the public apply door and marks itself as the funnel", () => {
    const html = fs.readFileSync(PAGE, "utf8");
    assert.match(html, /"\/api\/hiring\/apply"/);
    assert.match(html, /funnel:\s*"join"/);
  });
});
