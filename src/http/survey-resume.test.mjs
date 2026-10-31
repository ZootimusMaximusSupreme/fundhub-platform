// GET /api/public/survey-resume — the door behind the resume link.
// Handler tests with a fake database; the SQL itself is read against Postgres in
// survey-resume.pg.test.mjs. The route map entry is held by routes.test.mjs and by the
// first test here.
import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { readSurveyResume } from "../../api/public/survey-resume.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { surveyResumeToken } from "../survey/resume-link.mjs";

const ORG = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OTHER_ORG = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CLIENT = "c3b1a9d2-5f4e-4c1a-8b7d-2e6f9a0b1c3d";
const GONE = "11111111-2222-4333-8444-555555555555";
const SECRET = "unit-test-resume-secret-0123456789abcdef0123456789";
const NOW = Date.parse("2026-10-31T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const PAGE = "https://apply.fundhub.ai";

const token = (over = {}) =>
  surveyResumeToken({ clientId: CLIENT, now: () => NOW, secret: SECRET, ...over });

/* A database that holds clients and answers the one read the door makes. Every call is
   kept so a test can say what was asked, and that nothing but a SELECT was. */
function fakeDb(clients, { fail = false } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (fail) throw new Error("connect ECONNREFUSED 10.1.2.3:5432 postgres://u:secret@db.internal/x");
      assert.match(sql, /FROM clients\s+WHERE id = \$1\s+LIMIT 1/);
      const [id] = params;
      const row = clients.find((c) => c.id === id);
      return { rows: row ? [row] : [] };
    }
  };
}

const pat = (custom_fields = {}, over = {}) => ({
  id: CLIENT, org_id: ORG, first_name: "Pat", last_name: "Lee", email: "pat@example.com", phone: "+15551234567",
  custom_fields, ...over
});

function makeRes() {
  return {
    statusCode: 200, headers: {}, body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(obj) { this.body = obj; return this; }
  };
}

async function get(query, { db = fakeDb([pat()]), origin = PAGE, method = "GET" } = {}) {
  const res = makeRes();
  await handler(
    { method, headers: origin ? { origin } : {}, query },
    res,
    { db, secret: SECRET, now: () => NOW }
  );
  return res;
}
const getToken = (t, opts) => get({ r: t }, opts);

test("the door is routed", () => {
  assert.equal(ROUTES["public/survey-resume"], handler);
});

test("someone who only filled in the contact screen starts at the first question", async () => {
  const res = await getToken(token());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    ok: true,
    contact: { first_name: "Pat", last_name: "Lee", email: "pat@example.com", phone: "+15551234567" },
    answers: {},
    next_key: "cf_svy_funding_target_amount"
  });
});

test("the saved answers come back as words, and next_key is the first one not answered", async () => {
  const db = fakeDb([pat({
    cf_svy_funding_target_amount: "$50k - $100k",
    cf_svy_planned_use: "Growth (marketing, inventory, hiring)"
  })]);
  const res = await getToken(token(), { db });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.answers, {
    cf_svy_funding_target_amount: "$50k - $100k",
    cf_svy_planned_use: "Growth (marketing, inventory, hiring)"
  });
  assert.equal(res.body.next_key, "cf_svy_money_change_now");
});

test("the multi question comes back as a list, whichever way it was saved", async () => {
  const forms = [
    { cf_svy_money_change_now: ["Stability (cover bills / buffer slow weeks)"] },
    { cf_svy_money_change_now: '["Stability (cover bills / buffer slow weeks)"]' },
    { cf_svy_money_change_now: "Stability (cover bills / buffer slow weeks)" },
    { cf_svy_money_change_now: "207883", cf_svy_money_change_now_labels: '["Stability (cover bills / buffer slow weeks)"]' },
    { cf_svy_money_change_now_labels: '["[\\"Stability (cover bills / buffer slow weeks)\\"]"]' }
  ];
  for (const form of forms) {
    const res = await getToken(token(), { db: fakeDb([pat(form)]) });
    assert.deepEqual(res.body.answers.cf_svy_money_change_now, ["Stability (cover bills / buffer slow weeks)"], JSON.stringify(form));
  }
});

test("a ClickFunnels option id is never an answer: the words win, and an id alone is asked again", async () => {
  const withWords = pat({
    cf_svy_funding_target_amount: "207883",
    cf_svy_funding_target_amount_label: "$100k - $200k"
  });
  let res = await getToken(token(), { db: fakeDb([withWords]) });
  assert.equal(res.body.answers.cf_svy_funding_target_amount, "$100k - $200k");
  assert.equal(res.body.next_key, "cf_svy_planned_use");

  const idOnly = pat({ cf_svy_funding_target_amount: "207883", cf_svy_planned_use: 207891 });
  res = await getToken(token(), { db: fakeDb([idOnly]) });
  assert.deepEqual(res.body.answers, {}, "ids are not answers");
  assert.equal(res.body.next_key, "cf_svy_funding_target_amount", "the first empty question is asked again");
  assert.ok(!JSON.stringify(res.body).includes("2078"), "no id anywhere in the body");
});

test("the business answer picks the next questions, and an answer that picks neither is asked again", async () => {
  const base = {
    cf_svy_funding_target_amount: "Less than $50k",
    cf_svy_planned_use: "Not sure yet",
    cf_svy_money_change_now: ["Fresh start (new business / startup launch)"],
    cf_svy_self_reported_fico: "700-749"
  };
  const next = async (extra) => (await getToken(token(), { db: fakeDb([pat({ ...base, ...extra })]) })).body.next_key;

  assert.equal(await next({}), "cf_svy_has_business");
  assert.equal(await next({ cf_svy_has_business: "Yes, 1-2 years" }), "cf_svy_business_revenue");
  assert.equal(await next({ cf_svy_has_business: "Yes, 1-2 years", cf_svy_business_revenue: "$1M+" }), "cf_svy_revenue_verifiable");
  assert.equal(await next({
    cf_svy_has_business: "Yes, 1-2 years", cf_svy_business_revenue: "$1M+", cf_svy_revenue_verifiable: "Yes, both"
  }), "cf_svy_available_capital");

  assert.equal(await next({ cf_svy_has_business: "No, personal funding only" }), "cf_svy_annual_income_range");
  assert.equal(await next({ cf_svy_has_business: "No, personal funding only", cf_svy_annual_income_range: "$100k-$199k" }), "cf_svy_income_verifiable");

  // Not one of the two ways to answer: the page cannot know which pair to show, so it asks again.
  const odd = (await getToken(token(), { db: fakeDb([pat({ ...base, cf_svy_has_business: "Maybe" })]) })).body;
  assert.equal(odd.next_key, "cf_svy_has_business");
  assert.ok(!("cf_svy_has_business" in odd.answers));
});

test("a finished survey has no next question, on either path", async () => {
  const business = pat({
    cf_svy_funding_target_amount: "$400k+", cf_svy_planned_use: "Equipment or buildout",
    cf_svy_money_change_now: ["Grow faster (more customers / more reach)"], cf_svy_self_reported_fico: "750+",
    cf_svy_has_business: "Yes, 5+ years", cf_svy_business_revenue: "$1M+", cf_svy_revenue_verifiable: "Yes, both",
    cf_svy_available_capital: "$100k+"
  });
  const personal = pat({
    cf_svy_funding_target_amount: "$50k - $100k", cf_svy_planned_use: "Debt consolidation",
    cf_svy_money_change_now: ["Peace of mind (stop stressing about cash)"], cf_svy_self_reported_fico: "580-649",
    cf_svy_has_business: "No, personal funding only", cf_svy_annual_income_range: "$50k-$99k",
    cf_svy_income_verifiable: "Yes, pay stubs", cf_svy_available_capital: "$5k - $25k"
  });
  for (const row of [business, personal]) {
    const res = await getToken(token(), { db: fakeDb([row]) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.next_key, null);
    assert.equal(Object.keys(res.body.answers).length, 8);
  }
});

test("only the four contact fields and the survey answers leave the door", async () => {
  const db = fakeDb([pat({
    cf_svy_planned_use: "Not sure yet",
    setter_handoff: { problem: "private note" }, setter_survey_edits: { cf_svy_self_reported_fico: "700-749" },
    utm_source: "facebook", lifecycle_status: "New Lead", employee_next_action: "Call", ssn_last4: "1234"
  }, { email: null, phone: null, last_name: null })]);
  const res = await getToken(token(), { db });
  assert.deepEqual(Object.keys(res.body).sort(), ["answers", "contact", "next_key", "ok"]);
  assert.deepEqual(res.body.contact, { first_name: "Pat", last_name: "", email: "", phone: "" });
  assert.deepEqual(res.body.answers, { cf_svy_planned_use: "Not sure yet" });
  assert.ok(!JSON.stringify(res.body).includes("private note"));
  assert.ok(!JSON.stringify(res.body).includes("1234"));
});

test("no token at all is a 400, so the morning ping counts the door as up", async () => {
  for (const query of [{}, { r: "" }, { r: "   " }, { other: "x" }, undefined]) {
    const db = fakeDb([pat()]);
    const res = await get(query, { db });
    assert.equal(res.statusCode, 400, JSON.stringify(query));
    assert.deepEqual(res.body, { ok: false, error: "token_required" });
    assert.equal(db.calls.length, 0, "nothing is read for a request with no token");
  }
  // No origin, as the pulse's ping has none: still a 400, and no cross-site header.
  const bare = await get({}, { origin: null });
  assert.equal(bare.statusCode, 400);
  assert.equal(bare.headers["access-control-allow-origin"], undefined);
});

test("a bad, tampered, expired or unknown token is the same 404 with nothing in it", async () => {
  const good = token();
  const tampered = good.slice(0, 40) + (good[40] === "A" ? "B" : "A") + good.slice(41);
  const bad = {
    "not a token": "hello",
    tampered,
    truncated: good.slice(0, -2),
    expired: token({ now: () => NOW - 31 * DAY }),
    "signed with another key": token({ secret: "another-key-another-key-another-key-0123456789" }),
    "a client that is gone": token({ clientId: GONE })
  };
  for (const [what, t] of Object.entries(bad)) {
    const res = await getToken(t);
    assert.equal(res.statusCode, 404, what);
    assert.deepEqual(res.body, { ok: false }, `${what}: no error, no detail`);
  }
});

test("a token that does not verify never reaches the database", async () => {
  const good = token();
  for (const t of ["hello", good.slice(0, -2), token({ now: () => NOW - 31 * DAY }), token({ secret: "another-key-another-key-another-key-0123456789" })]) {
    const db = fakeDb([pat()]);
    const res = await getToken(t, { db });
    assert.equal(res.statusCode, 404);
    assert.equal(db.calls.length, 0, "nothing is read until the signature is good");
  }
});

test("the token names the client: each client's link opens that client and nobody else", async () => {
  const db = fakeDb([
    pat({ cf_svy_planned_use: "Not sure yet" }),
    pat({ cf_svy_planned_use: "Payroll or rent" }, { id: GONE, org_id: OTHER_ORG, first_name: "Olive", email: "olive@example.com" })
  ]);
  const mine = await getToken(token(), { db });
  assert.equal(mine.body.contact.email, "pat@example.com");
  assert.equal(mine.body.answers.cf_svy_planned_use, "Not sure yet");
  assert.deepEqual(db.calls.at(-1).params, [CLIENT], "the read is by the id in the token, and by nothing else");
  // The other company's person has their own link, and it opens their file in their company.
  const hers = await getToken(token({ clientId: GONE }), { db });
  assert.equal(hers.body.contact.first_name, "Olive");
  assert.equal(hers.body.answers.cf_svy_planned_use, "Payroll or rent");
  // Splicing the other client's id into my link breaks the signature and never reaches the database.
  const calls = db.calls.length;
  const spliced = Buffer.from(GONE.replace(/-/g, ""), "hex").toString("base64url") + token().slice(22);
  assert.equal((await getToken(spliced, { db })).statusCode, 404);
  assert.equal(db.calls.length, calls);
});

test("it only ever reads", async () => {
  const db = fakeDb([pat({ cf_svy_planned_use: "Not sure yet" })]);
  await getToken(token(), { db });
  await getToken("junk", { db });
  await get({}, { db });
  assert.ok(db.calls.length >= 1);
  for (const c of db.calls) assert.match(c.sql.trim(), /^SELECT\b/i);
  assert.ok(!db.calls.some((c) => /\b(INSERT|UPDATE|DELETE)\b/i.test(c.sql)));
});

test("cross-site: the answer is allowed for apply.fundhub.ai and never for a stranger", async () => {
  const ok = await getToken(token());
  assert.equal(ok.headers["access-control-allow-origin"], PAGE);
  assert.equal(ok.headers["cache-control"], "no-store");

  const stranger = await getToken(token(), { origin: "https://evil.example" });
  assert.equal(stranger.headers["access-control-allow-origin"], undefined, "never a wildcard, never echoed");
  assert.notEqual(ok.headers["access-control-allow-origin"], "*");

  const preflight = await get({}, { method: "OPTIONS" });
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.headers["access-control-allow-origin"], PAGE);
  assert.match(preflight.headers["access-control-allow-methods"], /GET/);
  assert.match(preflight.headers.allow, /GET/);
});

test("only GET is allowed", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const res = await getToken(token(), { method });
    assert.equal(res.statusCode, 405, method);
    assert.deepEqual(res.body, { ok: false, error: "method_not_allowed" });
  }
});

test("a database failure is a 500 that says nothing about the database", async () => {
  const quiet = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a.join(" "));
  try {
    const res = await getToken(token(), { db: fakeDb([pat()], { fail: true }) });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.body, { ok: false, error: "unavailable" });
    assert.ok(!JSON.stringify(res.body).includes("secret"));
  } finally { console.error = quiet; }
  assert.ok(logged.some((l) => /survey-resume: read failed/.test(l)));
  assert.ok(!logged.join("\n").includes("u:secret"), "the log is scrubbed too");
});

// readSurveyResume is the same read without HTTP, for the pulse to call in-process.
test("readSurveyResume returns the door's answer as an object, or null for any bad link", async () => {
  const db = fakeDb([pat({ cf_svy_planned_use: "Not sure yet" })]);
  const opts = { now: () => NOW, secret: SECRET };
  const found = await readSurveyResume(db, token(), opts);
  assert.deepEqual(found, {
    ok: true,
    contact: { first_name: "Pat", last_name: "Lee", email: "pat@example.com", phone: "+15551234567" },
    answers: { cf_svy_planned_use: "Not sure yet" },
    next_key: "cf_svy_funding_target_amount"
  });
  const viaDoor = await getToken(token(), { db });
  assert.deepEqual(viaDoor.body, found, "the door answers with exactly this object");

  for (const bad of ["", "nope", token({ clientId: GONE }), token({ now: () => NOW - 31 * DAY }), null, undefined]) {
    assert.equal(await readSurveyResume(db, bad, opts), null, String(bad).slice(0, 12));
  }
});

test("readSurveyResume lets a database failure through, so a caller can tell 'bad link' from 'cannot look'", async () => {
  await assert.rejects(
    readSurveyResume(fakeDb([pat()], { fail: true }), token(), { now: () => NOW, secret: SECRET }),
    /ECONNREFUSED/
  );
});

test("readSurveyResume reads the signing key from the environment when none is passed", async () => {
  const env = { UNSUBSCRIBE_TOKEN_SECRET: SECRET };
  const found = await readSurveyResume(fakeDb([pat()]), token(), { now: () => NOW, env });
  assert.equal(found.ok, true);
  assert.equal(await readSurveyResume(fakeDb([pat()]), token(), { now: () => NOW, env: {} }), null,
    "no key to check against: the link cannot be proved, so it is not served");
});
