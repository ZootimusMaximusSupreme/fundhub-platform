// POST /api/finance/paydown-simulator — the real handler, run with no Postgres.
//
// The simulator tells a client how to split cash across cards and what that
// does to their pre-approval. The maths were tested; the door was not: not the
// company check on the client, not the FinanceOS paywall, not the "no credit
// file yet" answer. This runs the door with the maths stubbed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/finance/paydown-simulator.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { fakeDb, makeRes, req, staffSession, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const SUB = "50000000-0000-4000-8000-000000000001";

const inOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, (_s, p) => (p[0] === CLIENT && p[1] === ORG_ID ? [{ "?column?": 1 }] : [])];
const entitled = [/FROM subscriptions/, [{ id: SUB }]];
const notEntitled = [/FROM subscriptions/, []];

async function call(request, rules, sim) {
  const fake = fakeDb(rules);
  const res = makeRes();
  const seen = [];
  await handler(request, res, {
    db: fake,
    loadPaydownSimulation: async (_db, args) => { seen.push(args); return sim; }
  });
  return { res, fake, seen };
}

const SIM_OK = {
  ok: true, preapprovalBefore: 40000, preapprovalProjected: 61000,
  allocations: [{ card: "Chase Ink", pay_cents: 120000 }]
};

describe("POST /api/finance/paydown-simulator", () => {
  test("is routed", () => {
    assert.equal(ROUTES["finance/paydown-simulator"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()], SIM_OK);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401, the simulator never runs", async () => {
    const { res, seen } = await call(req("POST", { body: { client_id: CLIENT, cash_on_hand: 5000 } }), [], SIM_OK);
    assert.equal(res.statusCode, 401);
    assert.equal(seen.length, 0);
  });

  test("a bad client id: 400", async () => {
    const { res, seen } = await call(req("POST", { body: { client_id: "nope" } }), [staffSession()], SIM_OK);
    assert.equal(res.statusCode, 400);
    assert.equal(seen.length, 0);
  });

  test("a client from another company reads as not found", async () => {
    const other = "c9000000-0000-4000-8000-000000000009";
    const { res, seen } = await call(
      req("POST", { body: { client_id: other, cash_on_hand: 5000 } }),
      [staffSession(), inOrg, entitled], SIM_OK
    );
    assert.equal(res.statusCode, 404);
    assert.equal(seen.length, 0);
  });

  test("no FinanceOS plan: 403 not_entitled, the simulator never runs", async () => {
    const { res, seen } = await call(
      req("POST", { body: { client_id: CLIENT, cash_on_hand: 5000 } }),
      [staffSession({ role: "csm" }), inOrg, notEntitled], SIM_OK
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "not_entitled");
    assert.equal(seen.length, 0);
  });

  test("entitled: the split and the projected pre-approval come back, for this client and this cash", async () => {
    const { res, seen } = await call(
      req("POST", { body: { client_id: CLIENT, cash_on_hand: 5000 } }),
      [staffSession({ role: "funding_advisor" }), inOrg, entitled], SIM_OK
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.entitled, true);
    assert.equal(res.body.subscriptionId, SUB);
    assert.equal(res.body.preapprovalBefore, 40000);
    assert.equal(res.body.preapprovalProjected, 61000);
    assert.deepEqual(res.body.allocations, [{ card: "Chase Ink", pay_cents: 120000 }]);
    assert.deepEqual(seen, [{ orgId: ORG_ID, clientId: CLIENT, cashOnHand: 5000 }]);
  });

  test("no credit file yet: 200 with hasPull false (the screen says pull first)", async () => {
    const { res } = await call(
      req("POST", { body: { client_id: CLIENT, cashOnHand: 100 } }),
      [staffSession(), inOrg, entitled], { ok: false, error: "no_credit_file" }
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, entitled: true, hasPull: false, subscriptionId: SUB });
  });

  test("a bad cash amount from the maths is a 400, not a 200", async () => {
    const { res } = await call(
      req("POST", { body: { client_id: CLIENT, cash_on_hand: -5 } }),
      [staffSession(), inOrg, entitled], { ok: false, error: "cash_on_hand must be positive" }
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.ok, false);
  });
});
