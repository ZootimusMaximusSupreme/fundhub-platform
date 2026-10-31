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

test("survey resume: the newest lead's own link opens their survey at their next question", async () => {
  const db = fakeDb();
  const [r] = await gapChecks(ctxOf(db));
  assert.equal(r.id, CHECK_ID);
  assert.deepEqual(CHECK_IDS, [CHECK_ID]);
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /FH-000901 opens their own survey at cf_svy_money_change_now/);
  assert.equal(r.suggestedFix, null);
  assert.doesNotMatch(r.detail, /dana|realmail/i, "the detail never names the person or their address");
  assert.deepEqual(db.calls[0].params, [ORG, "2026-10-24T18:00:00.000Z"], "seven days back");
});

test("survey resume: a finished survey's link opens at the end and still passes", async () => {
  const done = { ...HALF_DONE, cf_svy_money_change_now: ["Grow faster (more customers / more reach)"],
    cf_svy_self_reported_fico: "700-759", cf_svy_has_business: "No, personal funding only",
    cf_svy_annual_income_range: "$100k-$199k", cf_svy_income_verifiable: "Yes, both", cf_svy_available_capital: "$5k - $25k" };
  const [r] = await gapChecks(ctxOf(fakeDb({ lead: { id: CLIENT, client_code: "FH-000902", email: "a@realmail.com", custom_fields: done },
    doorRow: { first_name: "A", email: "a@realmail.com", custom_fields: done } })));
  assert.equal(r.status, "PASS", r.detail);
  assert.match(r.detail, /every question answered/);
});

test("survey resume: no signing key on the server is RED, because every link falls back to the top", async () => {
  const [r] = await gapChecks(ctxOf(fakeDb(), { env: {} }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no key to sign come-back links/);
  assert.match(r.suggestedFix, /UNSUBSCRIBE_TOKEN_SECRET/);
});

test("survey resume: a link that opens someone else, or the wrong question, is RED", async () => {
  let [r] = await gapChecks(ctxOf(fakeDb({ doorRow: { email: "someone@else.com", custom_fields: HALF_DONE } })));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /different person/);
  [r] = await gapChecks(ctxOf(fakeDb(), { }), { readSurveyResume: async () => ({ ok: true, contact: { email: "dana@realmail.com" }, next_key: "cf_svy_available_capital" }) });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /opens at cf_svy_available_capital, but the file says cf_svy_money_change_now/);
  [r] = await gapChecks(ctxOf(fakeDb()), { readSurveyResume: async () => null });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /turned its own fresh link away/);
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
