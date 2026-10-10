// /api/money/plan — the gate for both callers, the window, and the staff mark.
// Stubbed principal, db and builder; no network, no Postgres. The read is
// tested in src/finance/money-plan.test.mjs, the sources next to them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import handler from "../../api/money/plan.mjs";
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
const staffP = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
/* The clients table answers only for ids in `inOrg`. */
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});
const NOW = () => new Date("2026-10-07T02:00:00Z");

function spies({ build = { ok: true, pins: [] }, mark = { ok: true, changed: true, pin: { id: "waypoint:1", status: "done" } } } = {}) {
  const calls = { build: [], mark: [] };
  return {
    calls,
    deps: {
      moneyPlan: async (_db, args) => { calls.build.push(args); return typeof build === "function" ? build(args) : build; },
      markPin: async (_db, args) => { calls.mark.push(args); return mark; }
    }
  };
}

async function call(req, principal, { inOrg, s = spies() } = {}) {
  const res = makeRes();
  await handler(req, res, { db: db(inOrg), requirePrincipal: gateAs(principal), now: NOW, env: {}, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/plan — client session", () => {
  test("reads the session's own file, this month by default (UTC)", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.build[0].clientId, MINE);
    assert.equal(calls.build[0].orgId, ORG);
    assert.equal(calls.build[0].viewer, "client");
    assert.equal(calls.build[0].today, "2026-10-07");
    assert.deepEqual(calls.build[0].window, { ok: true, month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
  });

  test("?client_id is never read for a client", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER, month: "2026-11" } }, clientP(), { inOrg: [MINE, OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.build[0].clientId, MINE);
    assert.equal(calls.build[0].window.month, "2026-11");
  });

  test("a login with no client file is refused before anything is read", async () => {
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(null));
    assert.equal(res.statusCode, 403);
    assert.equal(calls.build.length, 0);
  });

  test("the session's client gone from the org → 404", async () => {
    const { res } = await call({ method: "GET", query: {} }, clientP(), { s: spies({ build: null }) });
    assert.equal(res.statusCode, 404);
  });

  test("a bad month or window is 400 with words, and nothing is read", async () => {
    const bad = await call({ method: "GET", query: { month: "2026-13" } }, clientP());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.res.body.error, "invalid_month");
    assert.equal(bad.calls.build.length, 0);
    const long = await call({ method: "GET", query: { from: "2026-01-01", to: "2027-06-01" } }, clientP());
    assert.equal(long.res.statusCode, 400);
    assert.equal(long.res.body.error, "window_too_long");
  });
});

describe("GET /api/money/plan — staff", () => {
  test("FINANCE with ?client_id in their org reads that file as staff", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, staffP("sales_manager"), { inOrg: [OTHER] });
    assert.equal(res.statusCode, 200);
    assert.equal(calls.build[0].clientId, OTHER);
    assert.equal(calls.build[0].viewer, "staff");
  });

  test("outside FINANCE is 403; no client_id is 400; another org is 404", async () => {
    assert.equal((await call({ method: "GET", query: { client_id: MINE } }, staffP("setter"))).res.statusCode, 403);
    assert.equal((await call({ method: "GET", query: {} }, staffP("owner"))).res.statusCode, 400);
    const outside = await call({ method: "GET", query: { client_id: OTHER } }, staffP("admin"), { inOrg: [MINE] });
    assert.equal(outside.res.statusCode, 404);
    assert.equal(outside.calls.build.length, 0);
  });
});

describe("POST /api/money/plan — mark a pin", () => {
  const body = (over = {}) => ({ action: "mark", client_id: MINE, source: "waypoints", pin_id: "waypoint:1", status: "done", ...over });

  test("a client can never mark — even their own file", async () => {
    const { res, calls } = await call({ method: "POST", body: body() }, clientP());
    assert.equal(res.statusCode, 403);
    assert.equal(calls.mark.length, 0);
  });

  test("staff mark goes to markPin with the client from the body, checked against their org", async () => {
    const { res, calls } = await call({ method: "POST", body: body() }, staffP("owner"));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "mark", changed: true, pin: { id: "waypoint:1", status: "done" } });
    const a = calls.mark[0];
    assert.deepEqual([a.orgId, a.clientId, a.source, a.pinId, a.status, a.today], [ORG, MINE, "waypoints", "waypoint:1", "done", "2026-10-07"]);
    const outside = await call({ method: "POST", body: body({ client_id: OTHER }) }, staffP("owner"), { inOrg: [MINE] });
    assert.equal(outside.res.statusCode, 404);
    assert.equal(outside.calls.mark.length, 0);
  });

  test("a bad body is 400 and nothing is marked", async () => {
    for (const b of [body({ action: "delete" }), body({ source: "" }), body({ source: "../x" }), body({ pin_id: "" }), body({ status: "skipped" })]) {
      const { res, calls } = await call({ method: "POST", body: b }, staffP("admin"));
      assert.equal(res.statusCode, 400, JSON.stringify(b));
      assert.equal(calls.mark.length, 0);
    }
    const notJson = await call({ method: "POST", body: "{nope" }, staffP("admin"));
    assert.equal(notJson.res.statusCode, 400);
  });

  test("refusals: not found 404, unknown source 400, proof rules and read-only sources 409 with words", async () => {
    const nf = await call({ method: "POST", body: body() }, staffP("admin"), { s: spies({ mark: { ok: false, reason: "not_found" } }) });
    assert.equal(nf.res.statusCode, 404);
    const unknown = await call({ method: "POST", body: body({ source: "nope" }) }, staffP("admin"), { s: spies({ mark: { ok: false, reason: "unknown_source" } }) });
    assert.equal(unknown.res.statusCode, 400);
    const proof = await call({ method: "POST", body: body() }, staffP("admin"), {
      s: spies({ mark: { ok: false, reason: "closes_on_credit_report", message: "This step closes itself when your next credit report shows the new balance." } })
    });
    assert.equal(proof.res.statusCode, 409);
    assert.equal(proof.res.body.error, "closes_on_credit_report");
    assert.match(proof.res.body.message, /credit report/);
    const ro = await call({ method: "POST", body: body({ source: "dues" }) }, staffP("admin"), { s: spies({ mark: { ok: false, reason: "not_markable" } }) });
    assert.equal(ro.res.statusCode, 409);
    assert.equal(ro.res.body.message, "This date cannot be marked here.");
  });
});

describe("/api/money/plan — the door", () => {
  test("no session is 401; an affiliate is 403", async () => {
    assert.equal((await call({ method: "GET", query: {} }, null)).res.statusCode, 401);
    assert.equal((await call({ method: "GET", query: {} }, { kind: "affiliate", orgId: ORG })).res.statusCode, 403);
  });

  test("PUT is 405", async () => {
    const { res } = await call({ method: "PUT", query: {} }, clientP());
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });

  test("routed, and watched by pulse", () => {
    assert.equal(ROUTES["money/plan"], handler);
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"money\/plan"/);
    assert.match(reg, /"money-plan\.html"/);
  });
});
