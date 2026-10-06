// GET /api/money/credit — endpoint tests for both callers. Stubbed principal,
// db and builder; no network, no Postgres. The rules are tested in
// src/finance/credit-overview.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import handler from "../../api/money/credit.mjs";
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

const clientPrincipal = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffPrincipal = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });

/* requirePrincipal stand-in: honours the kinds list like the real one. */
const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

/* The clients table answers only for ids in `inOrg`. */
const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function spyBuild() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { ok: true, client: { id: args.clientId } }; };
  fn.calls = calls;
  return fn;
}

const NOW = () => new Date("2026-10-06T12:00:00Z");

describe("GET /api/money/credit — client session", () => {
  test("reads the session's own file", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res,
      { db: db(), requirePrincipal: gateAs(clientPrincipal()), creditOverview: build, now: NOW, env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls.length, 1);
    assert.equal(build.calls[0].clientId, MINE);
    assert.equal(build.calls[0].orgId, ORG);
  });

  test("cannot read another client via ?client_id — the URL is ignored", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db: db([MINE, OTHER]), requirePrincipal: gateAs(clientPrincipal()), creditOverview: build, now: NOW, env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].clientId, MINE);
    assert.notEqual(res.body.client.id, OTHER);
  });

  test("a login with no client file is refused", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db: db(), requirePrincipal: gateAs(clientPrincipal(null)), creditOverview: build, now: NOW });
    assert.equal(res.statusCode, 403);
    assert.equal(build.calls.length, 0);
  });

  test("the session's client gone from the org → 404", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, {
      db: db(), requirePrincipal: gateAs(clientPrincipal()), now: NOW, env: {},
      creditOverview: async () => null
    });
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/money/credit — staff", () => {
  test("FINANCE role with ?client_id in their org reads that file", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db: db([OTHER]), requirePrincipal: gateAs(staffPrincipal("sales_manager")), creditOverview: build, now: NOW, env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].clientId, OTHER);
    assert.equal(build.calls[0].orgId, ORG);
  });

  test("a role outside FINANCE is 403", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: MINE } }, res,
      { db: db(), requirePrincipal: gateAs(staffPrincipal("closer")), creditOverview: build, now: NOW });
    assert.equal(res.statusCode, 403);
    assert.equal(build.calls.length, 0);
  });

  test("no ?client_id is 400", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res,
      { db: db(), requirePrincipal: gateAs(staffPrincipal("owner")), creditOverview: spyBuild(), now: NOW });
    assert.equal(res.statusCode, 400);
  });

  test("a client in another org is 404, not 403", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db: db([MINE]), requirePrincipal: gateAs(staffPrincipal("owner")), creditOverview: build, now: NOW });
    assert.equal(res.statusCode, 404);
    assert.equal(build.calls.length, 0);
  });
});

describe("GET /api/money/credit — the door", () => {
  test("no session is 401; an affiliate is 403", async () => {
    let res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(null), creditOverview: spyBuild() });
    assert.equal(res.statusCode, 401);
    res = makeRes();
    await handler({ method: "GET", query: {} }, res,
      { db: db(), requirePrincipal: gateAs({ kind: "affiliate", orgId: ORG }), creditOverview: spyBuild() });
    assert.equal(res.statusCode, 403);
  });

  test("405 on POST", async () => {
    const res = makeRes();
    await handler({ method: "POST" }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()) });
    assert.equal(res.statusCode, 405);
  });

  test("routed, and watched by pulse", () => {
    assert.equal(ROUTES["money/credit"], handler);
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"money\/credit"/);
  });

  test("the page is a watched desk file and has no staff sidebar", () => {
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"money-credit\.html"/);
    const nav = readFileSync(new URL("./app-nav-matches-shell.test.mjs", import.meta.url), "utf8");
    assert.match(nav, /"money-credit\.html"/);
  });

  test("the builder gets org, client and a clock — nothing else", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res,
      { db: db(), requirePrincipal: gateAs(clientPrincipal()), creditOverview: build, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(build.calls[0]).sort(), ["asOf", "clientId", "orgId"]);
  });
});
