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
import { runUpdate, orderAndLimit } from "../testing/fin-b08-tables.mjs";
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

function launchFile({ caseStatus = "Queued", bureaus = "EX", withSsn = true, env = {}, inquiries = null } = {}) {
  const fullEnv = { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: KEY, FUNDHUB_REP_NUMBER: REP, PII_ENC_KEY: crypto.randomBytes(32).toString("base64"), ...env };
  const state = { cases: [
    { id: CASE, org_id: ORG_ID, client_id: CLIENT, selected_bureaus_raw: bureaus, case_status: caseStatus, call_fired_at: null, ai_call_status: null },
    { id: FOREIGN_CASE, org_id: OTHER_ORG_ID, client_id: "c9000000-0000-4000-8000-000000000009", selected_bureaus_raw: "EX", case_status: "Queued", call_fired_at: null, ai_call_status: null },
  ], accessLog: [], outbound: [], fetches: [] };
  const clients = [{ id: CLIENT, org_id: ORG_ID, first_name: "Dana", last_name: "Whitfield", phone: "+16025550100" }];
  const identity = [{ client_id: CLIENT, org_id: ORG_ID, dob: "1985-02-03", addresses: [{ line1: "1 Main St", city: "Phoenix", state: "AZ", zip: "85001" }],
    ssn_enc: withSsn ? encryptSsn(SSN, { clientId: CLIENT, env: fullEnv }) : null }];
  const log = inquiries || [{ id: "i1", org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: "CHASE BANK", created_at: "2026-01-05T00:00:00Z", inquiry_removal_case_id: CASE }];
  const fake = fakeDb([
    [/^\s*SELECT id, client_id, selected_bureaus_raw, case_status, call_fired_at\s+FROM inquiry_removal_cases/i, (s, p) => rowsWhere(state.cases, s, p)],
    [/^\s*SELECT id, first_name, last_name, phone\s+FROM clients/i, (s, p) => rowsWhere(clients, s, p)],
    [/^\s*SELECT dob, addresses\s+FROM pii_identity/i, (s, p) => rowsWhere(identity, s, p)],
    [/^\s*SELECT org_id, ssn_enc FROM pii_identity WHERE client_id = \$1/i, (_s, p) => identity.filter((r) => r.client_id === p[0])],
    [/^\s*INSERT INTO pii_access_log/i, (_s, p) => { state.accessLog.push({ org_id: p[0], client_id: p[1], accessed_by: p[2], field: p[3] }); return { rows: [], rowCount: 1 }; }],
    [/^\s*SELECT inquiry, created_at\s+FROM inquiry_log/i, (s, p) => {
      // This company's, this client's, and the group the statement itself names: the case, or the bureau.
      const text = s.replace(/\s+/g, " ");
      if (!/WHERE org_id = \$1::uuid AND client_id = \$2::uuid AND \( inquiry_removal_case_id = \$3::uuid OR upper\(coalesce\(bureau,''\)\) = \$4 \)/.test(text)) {
        throw new Error(`the launch stand-in cannot read the inquiry list conditions: ${text.slice(0, 200)}`);
      }
      const mine = rowsWhere(log, "WHERE org_id = $1::uuid AND client_id = $2::uuid", p)
        .filter((r) => r.inquiry_removal_case_id === p[2] || String(r.bureau || "").toUpperCase() === p[3]);
      // ORDER BY and LIMIT are the statement's own.
      return orderAndLimit(mine, s, p).map((r) => ({ inquiry: r.inquiry, created_at: r.created_at }));
    }],
    [/^\s*INSERT INTO outbound_calls/i, (_s, p) => { state.outbound.push({ call_id: p[0], client_id: p[1], org_id: p[2], kind: p[3] }); return { rows: [], rowCount: 1 }; }],
    [/^\s*UPDATE inquiry_removal_cases\s+SET call_fired_at/i, (s, p) => {
      const { hit } = runUpdate(state.cases, s, p);
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

  test("each bureau's case dials that bureau's own dispute line and gives the agent that bureau's script", async () => {
    // The numbers are written out here, not read from the product: they are the three public dispute lines.
    const lines = {
      EX: { number: "+18554146048", name: "Experian", others: ["Equifax", "TransUnion"] },
      EQ: { number: "+18665495097", name: "Equifax", others: ["Experian", "TransUnion"] },
      TU: { number: "+18009168800", name: "TransUnion", others: ["Experian", "Equifax"] },
    };
    for (const k of ["EXPERIAN_DISPUTE_NUMBER", "EQUIFAX_DISPUTE_NUMBER", "TRANSUNION_DISPUTE_NUMBER"]) delete process.env[k];
    for (const [code, want] of Object.entries(lines)) {
      const fake = launchFile({ bureaus: code });
      const { res } = await call({ id: CASE }, fake);
      assert.equal(res.statusCode, 200, code);
      assert.equal(res.body.bureau, code);
      const sent = JSON.parse(fake.state.fetches[0].init.body);
      assert.equal(sent.phone_number, want.number, `${code} case dials ${want.name}`);
      assert.match(sent.task, new RegExp(want.name), `${code}: the script is ${want.name}'s`);
      for (const other of want.others) assert.doesNotMatch(sent.task, new RegExp(`calling ${other}`, "i"), `${code}: not ${other}'s script`);
      assert.equal(sent.metadata.bureau, code);
    }
  });

  test("a case that lists several bureaus dials the first one", async () => {
    delete process.env.EQUIFAX_DISPUTE_NUMBER;
    delete process.env.TRANSUNION_DISPUTE_NUMBER;
    const fake = launchFile({ bureaus: "eq, tu" });
    const { res } = await call({ id: CASE }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.bureau, "EQ");
    assert.equal(JSON.parse(fake.state.fetches[0].init.body).phone_number, "+18665495097");
    const unsupported = launchFile({ bureaus: "XX" });
    const bad = await call({ id: CASE }, unsupported);
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "bad_bureau");
    assert.equal(unsupported.state.fetches.length, 0);
    assert.equal(unsupported.state.accessLog.length, 0, "the SSN is not touched for a bureau we cannot call");
  });

  test("the agent is given the inquiries to remove, oldest first: this case's and this bureau's of this client, never another client's", async () => {
    delete process.env.EXPERIAN_DISPUTE_NUMBER;
    const row = (id, over) => ({ id, org_id: ORG_ID, client_id: CLIENT, bureau: "EX", inquiry: id, created_at: "2026-02-01T00:00:00Z", inquiry_removal_case_id: null, ...over });
    const inquiries = [
      row("ZETA CARD", { created_at: "2026-03-01T00:00:00Z", inquiry_removal_case_id: CASE }),
      row("ALPHA BANK", { created_at: "2026-01-05T00:00:00Z", inquiry_removal_case_id: CASE }),
      row("MID LENDER", { created_at: "2026-02-10T00:00:00Z", bureau: "EX" }),                 // same bureau, another case: still this bureau's
      row("OTHER BUREAU", { created_at: "2026-02-11T00:00:00Z", bureau: "EQ" }),               // not this bureau, not this case
      row("OTHER CLIENT", { created_at: "2026-02-12T00:00:00Z", client_id: "c8000000-0000-4000-8000-000000000008", inquiry_removal_case_id: CASE }),
      row("OTHER COMPANY", { created_at: "2026-02-13T00:00:00Z", org_id: OTHER_ORG_ID, inquiry_removal_case_id: CASE }),
    ];
    const fake = launchFile({ inquiries });
    const { res } = await call({ id: CASE }, fake);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const sent = JSON.parse(fake.state.fetches[0].init.body);
    assert.equal(sent.request_data.inquiry_list, "- ALPHA BANK (2026-01-05)\n- MID LENDER (2026-02-10)\n- ZETA CARD (2026-03-01)");
    const sql = fake.calls.find((c) => /FROM inquiry_log/.test(c.sql)).sql.replace(/\s+/g, " ");
    assert.match(sql, /ORDER BY created_at ASC LIMIT 40/);
  });

  test("a client with no inquiries on file is still called: the agent is told to dispute every unauthorized one on that bureau's report", async () => {
    const fake = launchFile({ inquiries: [] });
    const { res } = await call({ id: CASE }, fake);
    assert.equal(res.statusCode, 200);
    const sent = JSON.parse(fake.state.fetches[0].init.body);
    assert.match(sent.request_data.inquiry_list, /dispute all unauthorized inquiries on my Experian report/);
  });

  test("once placed, the case is marked calling with the time of the call, and the recorded time is kept if it is called again", async () => {
    const fake = launchFile();
    await call({ id: CASE }, fake);
    const row = fake.state.cases[0];
    assert.equal(row.ai_call_status, "calling");
    assert.ok(row.call_fired_at, "the time the call went out is saved");
    assert.ok(row.updated_at);
    const first = row.call_fired_at;
    await call({ id: CASE }, fake);
    assert.equal(row.call_fired_at, first, "the first time stays the first time");
    assert.equal(fake.state.fetches.length, 2);
  });
});
