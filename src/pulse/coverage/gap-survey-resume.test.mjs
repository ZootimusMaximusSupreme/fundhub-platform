import { test } from "node:test";
import assert from "node:assert/strict";
import { CHECK_ID, CHECK_IDS, NEWEST_LEAD_SQL, gapChecks } from "./gap-survey-resume.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-31T18:00:00Z");
const ENV = { UNSUBSCRIBE_TOKEN_SECRET: "x".repeat(40) };
const HALF_DONE = { cf_svy_funding_target_amount: "$50k - $100k", cf_svy_planned_use: "Equipment or buildout" };

/* The lead read answers with one lead; the door's own read answers with that lead's row. */
function fakeDb({ lead = { id: CLIENT, client_code: "FH-000901", email: "dana@realmail.com", custom_fields: HALF_DONE },
  doorRow = { first_name: "Dana", last_name: "R", email: "dana@realmail.com", phone: "+15550001111", custom_fields: HALF_DONE },
  throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (throwOn && sql.includes(throwOn)) throw new Error("relation \"events\" does not exist");
      if (sql.includes("gap:survey-resume-lead")) return { rows: lead ? [lead] : [] };
      if (sql.includes("FROM clients")) return { rows: doorRow && params[0] === CLIENT ? [doorRow] : [] };
      throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
    }
  };
}
const ctxOf = (db, extra = {}) => ({ db, orgId: ORG, now: NOW, env: ENV, ...extra });

test("survey resume: the newest lead's email code opens the saved survey", async () => {
  const db = fakeDb();
  const [r] = await gapChecks(ctxOf(db));
  assert.equal(r.id, CHECK_ID);
  assert.deepEqual(CHECK_IDS, [CHECK_ID]);
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /v3 email link for FH-000901 opens the saved survey/);
  assert.equal(r.suggestedFix, null);
  assert.doesNotMatch(r.detail, /dana|realmail/i, "the detail never names the person or their address");
  assert.deepEqual(db.calls[0].params, [ORG, "2026-10-24T18:00:00.000Z"], "seven days back");
  assert.equal(db.calls.length, 2, "the door reads the newest lead and that lead's answers");
});

test("survey resume: a door that does not open the saved survey is red", async () => {
  let [r] = await gapChecks(ctxOf(fakeDb()), { readSurveyResume: async () => null });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /FH-000901 did not open the saved survey/);
  assert.match(r.suggestedFix, /v3 email link/);
  assert.doesNotMatch(r.detail, /dana|realmail/i);
  // A partial answer is also a failed resume.
  [r] = await gapChecks(ctxOf(fakeDb()), { readSurveyResume: async () => ({ ok: true }) });
  assert.equal(r.status, "FAIL");
});

test("survey resume: no signing key is a skip that says why, never a PASS", async () => {
  const [r] = await gapChecks(ctxOf(fakeDb(), { env: {} }));
  assert.equal(r.status, "skip");
  assert.match(r.detail, /no signing key/);
});

test("survey resume: no lead, no database or a failed read is a skip that says why, never a PASS", async () => {
  let [r] = await gapChecks(ctxOf(fakeDb({ lead: null })));
  assert.equal(r.status, "skip");
  assert.match(r.detail, /No real lead in the last 7 days/);
  [r] = await gapChecks({ orgId: ORG, now: NOW, env: ENV });
  assert.equal(r.status, "skip");
  [r] = await gapChecks(ctxOf(fakeDb({ throwOn: "gap:survey-resume-lead" })));
  assert.equal(r.status, "skip");
  assert.match(r.detail, /Could not read the newest lead/);
});

test("survey resume: the lead read is one SELECT that leaves out demo rows and test addresses", () => {
  assert.match(NEWEST_LEAD_SQL, /^\/\* gap:survey-resume-lead \*\//);
  assert.doesNotMatch(NEWEST_LEAD_SQL, /\b(insert|update|delete|drop|alter|truncate|grant|begin|commit|rollback)\b/i);
  assert.match(NEWEST_LEAD_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(NEWEST_LEAD_SQL, /example\.com/);
  assert.match(NEWEST_LEAD_SQL, /name = 'entry\.captured'/);
});
