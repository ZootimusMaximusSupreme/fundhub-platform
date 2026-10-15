// finish-853 batch 08: POST /api/inquiry action=launch. The real handler, the real packet builder,
// the real SSN reveal and the real Bland provider run over a stand-in case, client, identity and
// access log, with a recording stand-in for the one outbound web call. The row's words: places a
// Bland phone call to a credit bureau's dispute line for one inquiry case. Practice test, fake data;
// nothing leaves the process, no database, no real key.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/inquiry.mjs";
import { encryptSsn } from "../pii/index.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CASE = "ca000000-0000-4000-8000-000000000001";
const FOREIGN_CASE = "ca000000-0000-4000-8000-000000000009";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const SSN = "123-45-6789";
const REP = "+16025550123";
const KEY = ["bland", "test", "key"].join("-");
const bland = (body = { status: "queued", call_id: "call-abc" }, status = 200) => ({
  ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body), headers: { forEach() {} },
});

function launchFile({ caseStatus = "Queued", bureaus = "EX", withSsn = true, env = {} } = {}) {
  const fullEnv = { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: KEY, FUNDHUB_REP_NUMBER: REP, PII_ENC_KEY: crypto.randomBytes(32).toString("base64"), ...env };
  const state = { cases: [
    { id: CASE, org_id: ORG_ID, client_id: CLIENT, selected_bureaus_raw: bureaus, case_status: caseStatus, call_fired_at: null, ai_call_status: null },
    { id: FOREIGN_CASE, org_id: OTHER_ORG_ID, client_id: "c9000000-0000-4000-8000-000000000009", selected_bureaus_raw: "EX", case_status: "Queued", call_fired_at: null, ai_call_status: null },
  ], accessLog: [], outbound: [], fetches: [] };
  const clients = [{ id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield", phone: "+16025550100" }];
  const identity = [{ client_id: CLIENT, org_id: ORG_ID, dob: "1985-02-03", addresses: [{ line1: "1 Main St", city: "Phoenix", state: "AZ", zip: "85001" }],
    ssn_enc: withSsn ? encryptSsn(SSN, { clientId: CLIENT, env: fullEnv }) : null }];
  const log = [{ id: "i1", org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: "CHASE BANK", created_at: "2026-01-05T00:00:00Z", inquiry_removal_case_id: CASE }];
  const fake = fakeDb([
    [/^\s*SELECT id, client_id, selected_bureaus_raw, case_status, call_fired_at\s+FROM inquiry_removal_cases/i, (s, p) => rowsWhere(state.cases, s, p)],
    [/^\s*SELECT id, first_name, last_name, phone\s+FROM clients/i, (s, p) => rowsWhere(clients, s, p)],
    [/^\s*SELECT dob, addresses\s+FROM pii_identity/i, (s, p) => rowsWhere(identity, s, p)],
    [/^\s*SELECT org_id, ssn_enc FROM pii_identity WHERE client_id = \$1/i, (_s, p) => identity.filter((r) => r.client_id === p[0])],
    [/^\s*INSERT INTO pii_access_log/i, (_s, p) => { state.accessLog.push({ org_id: p[0], client_id: p[1], accessed_by: p[2], field: p[3] }); return { rows: [], rowCount: 1 }; }],
    [/^\s*SELECT inquiry, created_at\s+FROM inquiry_log/i, (_s, p) => log.filter((r) => r.org_id === p[0] && r.client_id === p[1])],
    [/^\s*INSERT INTO outbound_calls/i, (_s, p) => { state.outbound.push({ call_id: p[0], client_id: p[1], org_id: p[2], kind: p[3] }); return { rows: [], rowCount: 1 }; }],
    [/^\s*UPDATE inquiry_removal_cases\s+SET call_fired_at/i, (s, p) => {
      const hit = rowsWhere(state.cases, s.slice(s.indexOf("WHERE")), p);
      for (const r of hit) Object.assign(r, { call_fired_at: r.call_fired_at || "now", ai_call_status: "calling" });
      return { rows: [], rowCount: hit.length };
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.state = state;
  fake.env = fullEnv;
  return fake;
}

async function call(body, fake, { who = [staffSession({ role: "inquiry_specialist" })], fetchResult = bland(), query = { action: "launch" } } = {}) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  const fetchImpl = async (url, init) => { fake.state.fetches.push({ url: String(url), init }); return fetchResult; };
  await runWithSharedDb(combined, () => handler(req("POST", { body, query }), res, { db: combined, env: fake.env, fetchImpl }));
  return { res, fake };
}

describe("POST /api/inquiry action=launch", () => {
  test("it places one call to the bureau's dispute line with the client's file and Fundhub's transfer line, and tells the desk who it is calling", async () => {
    const fake = launchFile();
    const { res } = await call({ id: CASE }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.placed, true);
    assert.equal(res.body.call_id, "call-abc");
    assert.equal(res.body.bureau, "EX");
    assert.equal(res.body.case_id, CASE);
    assert.equal(fake.state.fetches.length, 1, "exactly one call is placed");
    const { url, init } = fake.state.fetches[0];
    assert.match(url, /\/calls$/);
    assert.equal(init.headers.Authorization, KEY);
    const sent = JSON.parse(init.body);
    assert.equal(sent.transfer_phone_number, REP, "a live person at Fundhub is the transfer line");
    assert.notEqual(sent.phone_number, "+16025550100", "it dials the bureau, never the client");
    assert.notEqual(sent.phone_number, REP);
    assert.equal(sent.metadata.case_id, CASE);
    assert.equal(sent.metadata.org_id, ORG_ID);
    assert.equal(sent.metadata.placed_by, STAFF_ID);
    assert.match(JSON.stringify(sent.request_data), /123456789|123-45-6789/, "the bureau's agent is given the file");
    assert.equal(JSON.stringify(res.body).includes("123456789"), false, "the answer to the desk carries no SSN");
  });

  test("the SSN is revealed with a stated reason, access-logged for the signed-in staff member, and the case and the call are recorded", async () => {
    const fake = launchFile();
    await call({ id: CASE }, fake);
    assert.deepEqual(fake.state.accessLog.map((l) => [l.client_id, l.accessed_by, l.field]), [[CLIENT, STAFF_ID, "ssn (bureau_dispute_call)"]]);
    assert.deepEqual(fake.state.outbound, [{ call_id: "call-abc", client_id: CLIENT, org_id: ORG_ID, kind: "inquiry_bureau" }]);
    assert.equal(fake.state.cases[0].ai_call_status, "calling");
    assert.ok(fake.state.cases[0].call_fired_at);
    assert.equal(fake.state.cases[1].ai_call_status, null, "another company's case is untouched");
  });

  test("a case of another company is 404: nothing is revealed, nothing is dialled, nothing is recorded", async () => {
    const fake = launchFile();
    const { res } = await call({ id: FOREIGN_CASE }, fake);
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.placed, false);
    assert.equal(fake.state.fetches.length, 0);
    assert.equal(fake.state.accessLog.length, 0);
    assert.equal(fake.state.outbound.length, 0);
  });

  test("a closed case is refused with 409 and nothing is dialled", async () => {
    for (const status of ["Completed", "Canceled"]) {
      const fake = launchFile({ caseStatus: status });
      const { res } = await call({ id: CASE }, fake);
      assert.equal(res.statusCode, 409, status);
      assert.equal(res.body.error, "case_closed");
      assert.equal(fake.state.fetches.length, 0);
      assert.equal(fake.state.accessLog.length, 0);
    }
  });

  test("with no Fundhub transfer line, no stored SSN, or no phone key the call is refused in words and nothing is dialled or logged as placed", async () => {
    const noRep = launchFile({ env: { FUNDHUB_REP_NUMBER: "" } });
    const a = await call({ id: CASE }, noRep);
    assert.equal(a.res.statusCode, 503);
    assert.equal(a.res.body.error, "rep_number_required");
    assert.equal(noRep.state.fetches.length, 0);
    assert.equal(noRep.state.accessLog.length, 0, "the SSN is not touched before the transfer line is known");

    const noSsn = launchFile({ withSsn: false });
    const b = await call({ id: CASE }, noSsn);
    assert.equal(b.res.statusCode, 404);
    assert.equal(b.res.body.error, "ssn_required");
    assert.equal(noSsn.state.fetches.length, 0);

    const noKey = launchFile({ env: { BLAND_API_KEY: "" } });
    const c = await call({ id: CASE }, noKey);
    assert.equal(c.res.body.placed, false);
    assert.equal(c.res.body.error, "not_configured");
    assert.equal(noKey.state.fetches.length, 0);
    assert.equal(noKey.state.outbound.length, 0);
    assert.equal(noKey.state.cases[0].ai_call_status, null, "a call that was not placed does not mark the case as calling");
  });

  test("when the phone system refuses the call it is not recorded as placed", async () => {
    const fake = launchFile();
    const { res } = await call({ id: CASE }, fake, { fetchResult: bland({ error: "no" }, 500) });
    assert.equal(res.body.placed, false);
    assert.equal(fake.state.outbound.length, 0);
    assert.equal(fake.state.cases[0].ai_call_status, null);
  });

  test("with the outbound fence up nothing is dialled and the answer says so", async () => {
    const fake = launchFile({ env: { MESSAGING_DRY_RUN: "1" } });
    const { res } = await call({ id: CASE }, fake);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.placed, false);
    assert.equal(fake.state.fetches.length, 0);
    assert.equal(fake.state.outbound.length, 0);
  });

  test("only the inquiry specialist, an admin or the owner may place it; every other role is refused before any case is read", async () => {
    const letIn = [];
    for (const role of STAFF_ROLES) {
      const fake = launchFile();
      const { res } = await call({ id: CASE }, fake, { who: [staffSession({ role })] });
      if (res.statusCode === 403) {
        assert.equal(fake.calls.filter((c) => /inquiry_removal_cases/.test(c.sql)).length, 0, role);
        assert.equal(fake.state.fetches.length, 0, role);
      } else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "inquiry_specialist", "owner"]);
    const client = await call({ id: CASE }, launchFile(), { who: accountSession({ kind: "client", clientId: CLIENT }) });
    assert.equal(client.res.statusCode, 401);
  });

  test("a case id that is not a uuid is 400 and launch only answers POST", async () => {
    const fake = launchFile();
    const { res } = await call({ id: "nope" }, fake);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "case_id_required");
    const get = launchFile();
    const session = fakeDb([staffSession({ role: "inquiry_specialist" })]);
    const r = makeRes();
    const combined = { calls: get.calls, query: (sql, params) => (/FROM live JOIN staff/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : get.query(sql, params)), connect: () => get.connect() };
    await runWithSharedDb(combined, () => handler(req("GET", { query: { action: "launch" } }), r, { db: combined, env: get.env, fetchImpl: async () => { get.state.fetches.push("x"); return bland(); } }));
    assert.equal(r.statusCode, 405);
    assert.equal(get.state.fetches.length, 0);
  });
});
