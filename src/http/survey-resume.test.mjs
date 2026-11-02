// GET /api/public/survey-resume — the door behind the resume link.
// CONTAINMENT (2026-10-31): the door is closed. Every token, good or bad, is the same
// 404 with nothing in it, and the database is never asked. /apply lets a new phone onto
// an existing lead's email, so a signed code can reach a stranger; it must open nothing.
// The answer-shaping logic the door used is still held by src/survey/resume-state.test.mjs.
// The email/phone collision itself is replayed in survey-resume-collision.test.mjs.
// The route map entry is held by routes.test.mjs and by the first test here.
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

const DATA_SHAPES = {
  "only the contact screen": {},
  "half answered": { cf_svy_funding_target_amount: "$50k - $100k", cf_svy_planned_use: "Growth (marketing, inventory, hiring)" },
  "finished": {
    cf_svy_funding_target_amount: "$400k+", cf_svy_planned_use: "Equipment or buildout",
    cf_svy_money_change_now: ["Grow faster (more customers / more reach)"], cf_svy_self_reported_fico: "750+",
    cf_svy_has_business: "Yes, 5+ years", cf_svy_business_revenue: "$1M+", cf_svy_revenue_verifiable: "Yes, both",
    cf_svy_available_capital: "$100k+"
  },
  "private fields too": { setter_handoff: { problem: "private note" }, ssn_last4: "1234", cf_svy_planned_use: "Not sure yet" }
};

test("containment: a good, freshly signed token is the same 404 with nothing in it, and nothing is read", async () => {
  for (const [what, fields] of Object.entries(DATA_SHAPES)) {
    const db = fakeDb([pat(fields)]);
    const res = await getToken(token(), { db });
    assert.equal(res.statusCode, 404, what);
    assert.deepEqual(res.body, { ok: false }, `${what}: no contact, no answers, no next question`);
    assert.equal(db.calls.length, 0, `${what}: the closed door never asks the database`);
    const body = JSON.stringify(res.body);
    for (const leak of ["pat@example.com", "5551234567", "Pat", "$", "cf_svy", "private note", "1234"]) {
      assert.ok(!body.includes(leak), `${what}: ${leak} must not leave the door`);
    }
  }
});

test("containment: a good token answers exactly like a forged one, so the door says nothing about who exists", async () => {
  const good = await getToken(token());
  const forged = await getToken("hello");
  const gone = await getToken(token({ clientId: GONE }));
  for (const res of [good, forged, gone]) {
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { ok: false });
  }
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

test("containment: no client's token opens anything, in any company", async () => {
  const db = fakeDb([
    pat({ cf_svy_planned_use: "Not sure yet" }),
    pat({ cf_svy_planned_use: "Payroll or rent" }, { id: GONE, org_id: OTHER_ORG, first_name: "Olive", email: "olive@example.com" })
  ]);
  for (const t of [token(), token({ clientId: GONE })]) {
    const res = await getToken(t, { db });
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { ok: false });
  }
  assert.equal(db.calls.length, 0);
});

test("it never reads or writes", async () => {
  const db = fakeDb([pat({ cf_svy_planned_use: "Not sure yet" })]);
  await getToken(token(), { db });
  await getToken("junk", { db });
  await get({}, { db });
  assert.equal(db.calls.length, 0);
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

test("a broken database cannot turn a good token into an answer or an error: still the plain 404", async () => {
  const db = fakeDb([pat()], { fail: true });
  const res = await getToken(token(), { db });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { ok: false });
  assert.equal(db.calls.length, 0);
});

// readSurveyResume is the same read without HTTP, for the pulse to call in-process.
test("readSurveyResume is null for every token, good or bad, and never asks the database", async () => {
  const db = fakeDb([pat({ cf_svy_planned_use: "Not sure yet" })], { fail: true });
  const opts = { now: () => NOW, secret: SECRET };
  for (const t of [token(), token({ clientId: GONE }), "", "nope", token({ now: () => NOW - 31 * DAY }), null, undefined]) {
    assert.equal(await readSurveyResume(db, t, opts), null, String(t).slice(0, 12));
  }
  assert.equal(await readSurveyResume(db, token(), { now: () => NOW, env: { UNSUBSCRIBE_TOKEN_SECRET: SECRET } }), null);
  assert.equal(db.calls.length, 0);
});
