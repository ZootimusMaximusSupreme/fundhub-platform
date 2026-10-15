// Finish-853 batch 10: the Client Control Panel's client picker, at the door it reads.
//
// The picker is filled by GET /api/dashboard/clients?limit=200 (FHData.clients(200)). What a person can pick
// is exactly what that door answers: the newest 200 clients of THEIR company, newest first, demo hidden
// unless the company turned demo mode on, each with the id, names and email the picker prints. The live check
// for the row (a SQL contract in fin-b10-display-contracts.mjs) re-derives that rule from the clients table;
// this test holds the DOOR to the same rule, so the two cannot drift apart without one of them going red.
//
// It is a practice test: the real handler, the real session gate and the real role gate run, and the database
// is a scripted stand-in (the technique src/http/dashboard-role-gate.test.mjs uses). The SQL is not executed
// here (there is no Postgres on this machine), so the rule is held as the statement the door SENDS and the
// parameters it binds, which is what a change to the order, the cut or the demo filter would alter.

import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { db } from "../../../db.mjs";
import handler from "../../../../api/dashboard/clients.mjs";

const TOKEN = "stand-in-session-token";
const ORG = "org-picker";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  return r;
};
const req = (query = {}, method = "GET") => ({ method, headers: { authorization: `Bearer ${TOKEN}` }, query });

// The rows the stand-in database returns, already in the order it was asked for. 250 of them, newest first.
const ROWS = Array.from({ length: 250 }, (_, i) => ({
  id: `client-${String(i + 1).padStart(3, "0")}`,
  first_name: `First${i + 1}`, last_name: `Last${i + 1}`, email: `c${i + 1}@acme.test`,
  outcome_tier: null, funded: false, funded_amount: null, is_demo: false,
  crs_paid: false, deposit_paid: false, sale_closed: false, total_funding_estimate: null,
  created_at: new Date(Date.UTC(2026, 9, 14) - i * 60000),
  tx_count: "0", tx_latest_product: null, tx_latest_amount: null, tx_latest_status: null,
  crs_count: "0", task_count: "0", last_msg_channel: null, last_msg_direction: null, last_msg_at: null,
}));

let realQuery;
let role = "owner";
let demoMode = false;
let listCalls = [];

async function stand(sql, params = []) {
  const text = String(sql);
  if (/FROM live JOIN staff/.test(text)) {
    return { rows: [{
      session_id: "session-1", expires_at: new Date(Date.now() + 3600_000),
      staff_id: "staff-1", org_id: ORG, role, email: "staff@example.test", name: "Stand In",
      status: "active", active_flag: null,
    }] };
  }
  if (/FROM orgs WHERE id/.test(text)) return { rows: [{ demo_mode_enabled: demoMode }] };
  if (/FROM clients c/.test(text) && /LEFT JOIN transactions/.test(text)) {
    listCalls.push({ text, params });
    // Honour the cut the way the statement states it: the limit is its second bound value.
    return { rows: ROWS.slice(0, Number(params[1])) };
  }
  return { rows: [] };
}

describe("the client picker's door", () => {
  before(() => { realQuery = db.query; db.query = stand; });
  after(() => { db.query = realQuery; });
  beforeEach(() => { role = "owner"; demoMode = false; listCalls = []; });

  test("the picker's request asks for the newest 200 clients of the signed-in company, newest first", async () => {
    const r = res();
    await handler(req({ limit: "200" }), r);
    assert.equal(r.code ?? 200, 200);
    assert.equal(listCalls.length, 1, "one read of the client list");
    const { text, params } = listCalls[0];
    // The company comes from the session, never from the address.
    assert.equal(params[0], ORG);
    assert.match(text, /WHERE\s+c\.org_id\s*=\s*\$1/);
    // The cut is 200, bound as the second value and applied by LIMIT $2.
    assert.equal(params[1], 200);
    assert.match(text, /LIMIT\s+\$2\s*$/);
    // Newest first: the rows are cut AFTER they are put in newest-first order, so the 200 are the newest.
    assert.match(text, /ORDER BY\s+c\.created_at\s+DESC\s+LIMIT\s+\$2/);
    assert.doesNotMatch(text, /ORDER BY\s+c\.created_at\s+ASC/);
    // Demo clients are left out unless the company turned demo mode on (the third bound value).
    assert.equal(params[2], false);
    assert.match(text, /\(\$3::boolean\s+OR\s+COALESCE\(c\.is_demo,\s*false\)\s*=\s*false\)/);
  });

  test("the answer is the rows in the order the database gave them, 200 of them, with what the picker prints", async () => {
    const r = res();
    await handler(req({ limit: "200" }), r);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.clients.length, 200);
    assert.equal(r.body.clients[0].id, "client-001");
    assert.equal(r.body.clients[199].id, "client-200");
    // Not re-sorted, not de-duplicated, nothing dropped.
    assert.deepEqual(r.body.clients.map((c) => c.id), ROWS.slice(0, 200).map((c) => c.id));
    for (const c of r.body.clients.slice(0, 3)) {
      assert.ok(c.id && c.first_name && c.last_name && c.email, "the id, both names and the email the picker prints");
    }
  });

  test("the cut follows the request: 200 is 200, nothing asked is 50, and no ask goes past 500", async () => {
    for (const [asked, bound] of [["200", 200], [undefined, 50], ["900", 500], ["500", 500], ["abc", 50], ["0", 1]]) {
      listCalls = [];
      const r = res();
      await handler(req(asked === undefined ? {} : { limit: asked }), r);
      assert.equal(listCalls[0].params[1], bound, `limit=${asked}`);
    }
  });

  test("a company that turned demo mode on asks for demo clients too, and says so in the third value", async () => {
    demoMode = true;
    const r = res();
    await handler(req({ limit: "200" }), r);
    assert.equal(listCalls[0].params[2], true);
  });

  test("a partner login gets nothing: the picker is staff only", async () => {
    role = "partner";
    const r = res();
    await handler(req({ limit: "200" }), r);
    assert.equal(r.code, 403);
    assert.equal(listCalls.length, 0, "the client book was never read");
  });

  test("only GET is answered", async () => {
    const r = res();
    await handler(req({ limit: "200" }, "POST"), r);
    assert.equal(r.code, 405);
    assert.equal(listCalls.length, 0);
  });
});
