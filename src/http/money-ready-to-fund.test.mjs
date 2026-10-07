// /api/money/ready-to-fund — the gate for both callers, the status read with
// the offers, and the press. Stubbed principal, db and logic.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/ready-to-fund.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "org-1";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "5aff0000-0000-4000-8000-000000000001", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

const OFFERS = {
  blueprint: { owned: false, name: "Capital Blueprint", sell: { how: "call", url: "https://apply.fundhub.ai/schedule/phonecall" } },
  financeos: { entitled: true, setup_url: null }
};

function spies({ status = { status: "none", round: 0, task_id: null } } = {}) {
  const calls = {};
  return {
    calls,
    deps: {
      readyToFundStatus: async (_db, args) => { (calls.status ||= []).push(args); return status; },
      requestReadyToFund: async (_db, args) => { (calls.request ||= []).push(args); return { created: true, status: "requested", round: 1, task_id: "t1" }; },
      productOffers: async (_db, args) => { (calls.offers ||= []).push(args); return OFFERS; }
    }
  };
}
const NOW = () => new Date("2026-10-07T12:00:00Z");

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, ...s.deps });
  return { res, calls: s.calls };
}

describe("/api/money/ready-to-fund", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/ready-to-fund"], "function");
  });

  test("GET: a client's own status, with which doors they own", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "none");
    assert.deepEqual(res.body.offers, OFFERS);
    assert.equal(calls.status[0].clientId, MINE, "the session, never the query");
    assert.equal(calls.offers[0].clientId, MINE);
    assert.equal(calls.request, undefined, "a read never presses");
  });

  test("POST: the press, on the session's own file, as the client", async () => {
    const { res, calls } = await call({ method: "POST", body: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.status, "requested");
    const r = calls.request[0];
    assert.equal(r.clientId, MINE);
    assert.equal(r.actor, "client");
    assert.equal(r.todayIso, "2026-10-07");
  });

  test("staff FINANCE may press for a client in their org; others are refused", async () => {
    const ok = await call({ method: "POST", body: { client_id: MINE } }, staffP("owner"));
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.calls.request[0].actor, "staff");
    const other = await call({ method: "POST", body: { client_id: OTHER } }, staffP("owner"));
    assert.equal(other.res.statusCode, 404);
    const noId = await call({ method: "GET", query: {} }, staffP("admin"));
    assert.equal(noId.res.statusCode, 400);
    for (const role of ["closer", "csm", "setter"]) {
      const { res, calls } = await call({ method: "POST", body: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.request, undefined, role);
    }
  });

  test("a login with no client file is 403; no login is 401; a client the read cannot find is 404", async () => {
    assert.equal((await call({ method: "GET", query: {} }, clientP(null))).res.statusCode, 403);
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    const missing = await call({ method: "GET", query: {} }, clientP(), { s: spies({ status: null }) });
    assert.equal(missing.res.statusCode, 404);
  });

  test("DELETE is 405", async () => {
    const { res } = await call({ method: "DELETE", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
  });
});
