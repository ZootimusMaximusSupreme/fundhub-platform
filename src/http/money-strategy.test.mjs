// /api/money/strategy — the gate and the save for both callers. Stubbed
// principal, db, read and save; no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/strategy.mjs";
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
const STAFF_ID = "5aff0000-0000-4000-8000-000000000001";

const clientP = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: STAFF_ID, role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function spies({ saveResult } = {}) {
  const calls = {};
  return {
    calls,
    deps: {
      strategyPayload: async (_db, args) => { (calls.load ||= []).push(args); return { ok: true, client: { id: args.clientId }, inputs: { debts: [] } }; },
      savePlan: async (_db, args) => {
        (calls.save ||= []).push(args);
        return saveResult || { ok: true, saved: { id: "plan-1", steps: 9 }, plan: { ok: true } };
      }
    }
  };
}
const NOW = () => new Date("2026-10-07T12:00:00Z");

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/strategy", () => {
  test("is routed", () => {
    assert.equal(typeof ROUTES["money/strategy"], "function");
  });

  test("a client reads their own file; ?client_id is never read", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.load[0].clientId, MINE);
    assert.equal(calls.load[0].orgId, ORG);
    assert.equal(calls.load[0].asOf.toISOString(), "2026-10-07T12:00:00.000Z");
  });

  test("a login with no client file is refused", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.load, undefined);
  });

  test("staff FINANCE with a client in their org reads it; outside the org is 404; no client_id is 400", async () => {
    for (const role of ["owner", "admin", "sales_manager"]) {
      const ok = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(ok.res.statusCode, 200, role);
    }
    const outside = await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"));
    assert.equal(outside.res.statusCode, 404);
    const none = await call({ method: "GET", query: {} }, staffP("owner"));
    assert.equal(none.res.statusCode, 400);
  });

  test("a staff role outside FINANCE is refused", async () => {
    for (const role of ["setter", "funding_advisor", "setter", "csm"]) {
      const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP(role));
      assert.equal(res.statusCode, 403, role);
      assert.equal(calls.load, undefined);
    }
  });

  test("no session → 401; PUT → 405; a client not found → 404", async () => {
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    assert.equal((await call({ method: "PUT", query: {} }, clientP())).res.statusCode, 405);
    const s = spies();
    s.deps.strategyPayload = async () => null;
    assert.equal((await call({ method: "GET", query: {} }, clientP(), { s })).res.statusCode, 404);
  });
});

describe("POST /api/money/strategy save_plan", () => {
  const body = { action: "save_plan", method: "avalanche", monthly_cents: 150000 };

  test("a client saves their own plan — the session's file, never the body's", async () => {
    const { res, calls } = await call({ method: "POST", body: { ...body, client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.saved.steps, 9);
    assert.equal(calls.save[0].clientId, MINE);
    assert.equal(calls.save[0].savedByKind, "client");
    assert.equal(calls.save[0].savedById, null);
    assert.deepEqual(calls.save[0].settings, { method: "avalanche", monthly_cents: 150000, goal: null });
  });

  test("FINANCE staff save for a client in their org, and are named", async () => {
    const { res, calls } = await call({ method: "POST", body: { ...body, client_id: MINE, goal: { kind: "util10", by: "2027-06-30" } } }, staffP("admin"));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.save[0].savedByKind, "staff");
    assert.equal(calls.save[0].savedById, STAFF_ID);
    assert.deepEqual(calls.save[0].settings.goal, { kind: "util10", by: "2027-06-30" });
  });

  test("a closer cannot save; a client in another org is 404", async () => {
    assert.equal((await call({ method: "POST", body: { ...body, client_id: MINE } }, staffP("setter"))).res.statusCode, 403);
    assert.equal((await call({ method: "POST", body: { ...body, client_id: OTHER } }, staffP("owner"))).res.statusCode, 404);
  });

  test("bad settings, an unknown action and a body that is not JSON are 400 and save nothing", async () => {
    const bad = await call({ method: "POST", body: { ...body, monthly_cents: -5 } }, clientP());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_settings");
    assert.equal(bad.calls.save, undefined);
    assert.equal((await call({ method: "POST", body: { action: "delete_everything" } }, clientP())).res.statusCode, 400);
    assert.equal((await call({ method: "POST", body: "{nope" }, clientP())).res.statusCode, 400);
  });

  test("a refusal from the save keeps its status and its words (409 over the safe amount)", async () => {
    const s = spies({ saveResult: { ok: false, status: 409, error: "over_safe_amount", message: "Too much for this month's cash.", max_safe_monthly_cents: 130500 } });
    const { res } = await call({ method: "POST", body }, clientP(), { s });
    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, { ok: false, error: "over_safe_amount", message: "Too much for this month's cash.", max_safe_monthly_cents: 130500 });
  });

  test("a database that is down is a 503, not our bug", async () => {
    const s = spies();
    s.deps.savePlan = async () => { const e = new Error("connect ECONNREFUSED"); e.code = "ECONNREFUSED"; throw e; };
    const { res } = await call({ method: "POST", body }, clientP(), { s });
    assert.equal(res.statusCode, 503);
  });
});
