// GET /api/money/trends — endpoint tests for both callers (FinanceOS wave 4,
// H6). Stubbed principal, db and builder; no network, no Postgres. The math is
// tested in src/finance/money-trends.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import handler from "../../api/money/trends.mjs";
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

const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

const db = (inOrg = [MINE]) => ({
  query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: inOrg.includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] })
});

function spyBuild() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { ok: true, client: { id: args.clientId }, range: args.range }; };
  fn.calls = calls;
  return fn;
}

const NOW = () => new Date("2026-10-06T12:00:00Z");

describe("GET /api/money/trends — client session", () => {
  test("reads the session's own file; range defaults to 90d", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()), moneyTrends: build, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].clientId, MINE);
    assert.equal(build.calls[0].orgId, ORG);
    assert.equal(build.calls[0].range, "90d");
  });

  test("cannot read another client via ?client_id — the URL is ignored", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER, range: "12m" } }, res,
      { db: db([MINE, OTHER]), requirePrincipal: gateAs(clientPrincipal()), moneyTrends: build, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].clientId, MINE);
    assert.equal(build.calls[0].range, "12m");
  });

  test("a login with no client file is refused", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal(null)), moneyTrends: build });
    assert.equal(res.statusCode, 403);
    assert.equal(build.calls.length, 0);
  });

  test("a range that is not 30d / 90d / 12m is 400 and reads nothing", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { range: "5y" } }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()), moneyTrends: build });
    assert.equal(res.statusCode, 400);
    assert.equal(build.calls.length, 0);
  });

  test("the client gone from the org → 404", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()), moneyTrends: async () => null });
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/money/trends — staff", () => {
  test("FINANCE role with ?client_id in their org reads that file", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER, range: "30d" } }, res,
      { db: db([OTHER]), requirePrincipal: gateAs(staffPrincipal("admin")), moneyTrends: build, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].clientId, OTHER);
    assert.equal(build.calls[0].range, "30d");
  });

  test("a role outside FINANCE is 403; no ?client_id is 400; another org is 404", async () => {
    let res = makeRes();
    await handler({ method: "GET", query: { client_id: MINE } }, res, { db: db(), requirePrincipal: gateAs(staffPrincipal("setter")), moneyTrends: spyBuild() });
    assert.equal(res.statusCode, 403);
    res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(staffPrincipal("owner")), moneyTrends: spyBuild() });
    assert.equal(res.statusCode, 400);
    res = makeRes();
    const build = spyBuild();
    await handler({ method: "GET", query: { client_id: OTHER } }, res, { db: db([MINE]), requirePrincipal: gateAs(staffPrincipal("owner")), moneyTrends: build });
    assert.equal(res.statusCode, 404);
    assert.equal(build.calls.length, 0);
  });
});

describe("GET /api/money/trends — any dates and one account (CFO build, unit A)", () => {
  const ACCT = "abcdef01-2345-4678-9abc-def012345678";
  const asClient = (query, build = spyBuild()) => {
    const res = makeRes();
    return handler({ method: "GET", query }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()), moneyTrends: build, now: NOW })
      .then(() => ({ res, build }));
  };

  test("from and to are passed on as a pair, with no preset", async () => {
    const { res, build } = await asClient({ from: "2025-01-01", to: "2025-06-30" });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].from, "2025-01-01");
    assert.equal(build.calls[0].to, "2025-06-30");
    assert.equal(build.calls[0].range, null);
    assert.equal(build.calls[0].clientId, MINE);
  });

  test("a preset still passes no dates", async () => {
    const { build } = await asClient({ range: "30d" });
    assert.equal(build.calls[0].range, "30d");
    assert.equal(build.calls[0].from, null);
    assert.equal(build.calls[0].to, null);
    assert.equal(build.calls[0].accountId, null);
  });

  test("bad dates are a 400 that says why, and nothing is read", async () => {
    const cases = [
      [{ from: "2025-02-30", to: "2025-03-01" }, /real dates/],
      [{ from: "2025-03-02", to: "2025-03-01" }, /on or before/],
      [{ from: "2023-01-01", to: "2025-06-30" }, /24 months/],
      [{ from: "2025-01-01" }, /both/],
      [{ range: "90d", from: "2025-01-01", to: "2025-02-01" }, /not both/]
    ];
    for (const [query, words] of cases) {
      const { res, build } = await asClient(query);
      assert.equal(res.statusCode, 400, JSON.stringify(query));
      assert.match(res.body.error, words);
      assert.equal(build.calls.length, 0, "nothing is read for a bad window");
    }
  });

  test("account: a uuid is passed on with the session's own client; anything else is 400", async () => {
    const { res, build } = await asClient({ account: ACCT, client_id: OTHER });
    assert.equal(res.statusCode, 200);
    assert.equal(build.calls[0].accountId, ACCT);
    assert.equal(build.calls[0].clientId, MINE, "an account never moves the read to another client");
    const bad = await asClient({ account: "1; DROP TABLE" });
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.build.calls.length, 0);
  });

  test("an account that is not this file's open account → 404, the same answer as another client", async () => {
    const { res } = await asClient({ account: ACCT }, async () => null);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { ok: false, error: "not_found" });
  });

  test("staff: the account is checked against the ?client_id file in their org", async () => {
    const build = spyBuild();
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER, account: ACCT, from: "2026-01-01", to: "2026-02-01" } }, res,
      { db: db([OTHER]), requirePrincipal: gateAs(staffPrincipal("owner")), moneyTrends: build, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.deepEqual([build.calls[0].clientId, build.calls[0].orgId, build.calls[0].accountId], [OTHER, ORG, ACCT]);
  });
});

describe("GET /api/money/trends — the door", () => {
  test("no session is 401; 405 on POST", async () => {
    let res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: db(), requirePrincipal: gateAs(null), moneyTrends: spyBuild() });
    assert.equal(res.statusCode, 401);
    res = makeRes();
    await handler({ method: "POST" }, res, { db: db(), requirePrincipal: gateAs(clientPrincipal()) });
    assert.equal(res.statusCode, 405);
  });

  test("routed, and watched by pulse", () => {
    assert.equal(ROUTES["money/trends"], handler);
    const reg = readFileSync(new URL("../pulse/registry.mjs", import.meta.url), "utf8");
    assert.match(reg, /"money\/trends"/);
  });
});
