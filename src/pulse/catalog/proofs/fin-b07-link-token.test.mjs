// Practice test for the money.html "link-token (server)" row: the Plaid Link token door.
//
// It leaves no saved result (a token is minted and handed back), so the only honest proof is
// the door itself: the real handler, fake sessions, a small two-company clients table that
// answers the org check from the SQL it is given, and a stand-in for Plaid that records who it
// was asked to mint for. Nothing is sent to Plaid.
//
// The last two tests go one step further and run the REAL startLink (src/banking/plaid-link.mjs) with a
// stand-in for Plaid's own web address: they read the request that would have gone to Plaid and hold
// that the id Plaid is told is the client's own file (client_user_id), end to end from the door.
//
// What each case holds:
//   * a signed-in client is pinned to the file on its own session; a client_id in the body is
//     never read
//   * staff may ask only with a finance role, and only for a client of their own company
//   * an affiliate or partner login is refused
//   * a missing Plaid key answers 503 and names the missing keys, never a 200 with no token

import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/banking/link-token.mjs";
import { startLink as realStartLink } from "../../../banking/plaid-link.mjs";

const COMPANY = "0a000000-0000-4000-8000-000000000001";
const OTHER_COMPANY = "0b000000-0000-4000-8000-000000000002";
const MINE = "c1000000-0000-4000-8000-000000000001";
const SOMEONE_ELSES = "c2000000-0000-4000-8000-000000000002";
const FINANCE_ROLES = ["owner", "admin", "sales_manager", "closer"];
const NOT_FINANCE_ROLES = ["setter", "csm", "funding_advisor", "inquiry_specialist"];

const CLIENTS = [{ id: MINE, org_id: COMPANY }, { id: SOMEONE_ELSES, org_id: OTHER_COMPANY }];

/** A clients table that answers the org check by its two parameters, and refuses to answer without the org condition. */
function clientsDb() {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      assert.match(sql, /FROM clients WHERE id = \$1 AND org_id = \$2/, "the org check must carry the company condition");
      return { rows: CLIENTS.filter((c) => c.id === params[0] && c.org_id === params[1]).map(() => ({ "?column?": 1 })) };
    },
  };
}

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
  };
}

function minted() {
  const asked = [];
  const startLink = async ({ clientId }) => {
    asked.push(clientId);
    return { ok: true, linkToken: "link-sandbox-fake", expiration: "2026-10-15T00:00:00Z", environment: "sandbox" };
  };
  return { asked, startLink };
}

const staff = (role, org = COMPANY) => ({ id: "s1", role, org_id: org });
const post = (body) => ({ method: "POST", body, headers: {} });

async function run(request, { principal = null, authAs = null, startLink, db = clientsDb(), env = {} } = {}) {
  const res = makeRes();
  await handler(request, res, {
    db,
    resolvePrincipal: async () => principal,
    requireAuth: async () => authAs,
    startLink,
    env,
  });
  return { res, db };
}

test("only POST is answered", async () => {
  const { startLink, asked } = minted();
  const { res } = await run({ method: "GET", headers: {} }, { authAs: staff("owner"), startLink });
  assert.equal(res.statusCode, 405);
  assert.deepEqual(asked, []);
});

test("a signed-in client gets a token for its own file, and a client_id in the body is never read", async () => {
  const { startLink, asked } = minted();
  const principal = { kind: "client", clientId: MINE, orgId: COMPANY };
  const { res } = await run(post({ client_id: SOMEONE_ELSES }), { principal, startLink });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, link_token: "link-sandbox-fake", expiration: "2026-10-15T00:00:00Z", environment: "sandbox" });
  assert.deepEqual(asked, [MINE], "the token must be minted for the session's own client, never the body's");
});

test("a client whose own file is not in its company gets no token", async () => {
  const { startLink, asked } = minted();
  const principal = { kind: "client", clientId: SOMEONE_ELSES, orgId: COMPANY };
  const { res } = await run(post({}), { principal, startLink });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(asked, []);
});

test("a client login with no file attached is refused before any lookup", async () => {
  const { startLink, asked } = minted();
  const { res, db } = await run(post({}), { principal: { kind: "client", clientId: null, orgId: COMPANY }, startLink });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(asked, []);
  assert.deepEqual(db.calls, []);
});

test("staff with a finance role get a token for a client of their own company", async () => {
  for (const role of FINANCE_ROLES) {
    const { startLink, asked } = minted();
    const { res } = await run(post({ client_id: MINE }), { principal: { kind: "staff" }, authAs: staff(role), startLink });
    assert.equal(res.statusCode, 200, role);
    assert.deepEqual(asked, [MINE], role);
  }
});

test("staff without a finance role are refused and nothing is minted", async () => {
  for (const role of NOT_FINANCE_ROLES) {
    const { startLink, asked } = minted();
    const { res } = await run(post({ client_id: MINE }), { principal: { kind: "staff" }, authAs: staff(role), startLink });
    assert.equal(res.statusCode, 403, role);
    assert.deepEqual(asked, [], role);
  }
});

test("staff asking for another company's client are told there is no such client", async () => {
  const { startLink, asked } = minted();
  const { res } = await run(post({ client_id: SOMEONE_ELSES }), { principal: { kind: "staff" }, authAs: staff("owner"), startLink });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { ok: false, error: "not_found" });
  assert.deepEqual(asked, []);
});

test("staff with no client id, or one that is not a uuid, get a 400 and nothing is minted", async () => {
  for (const body of [{}, { client_id: "not-a-uuid" }]) {
    const { startLink, asked } = minted();
    const { res } = await run(post(body), { principal: { kind: "staff" }, authAs: staff("owner"), startLink });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(asked, []);
  }
});

test("an affiliate or partner login is refused", async () => {
  for (const kind of ["affiliate", "partner"]) {
    const { startLink, asked } = minted();
    const { res } = await run(post({ client_id: MINE }), { principal: { kind }, startLink });
    assert.equal(res.statusCode, 403, kind);
    assert.deepEqual(asked, [], kind);
  }
});

test("Plaid not configured answers 503 with the missing keys, and an upstream error answers 502", async () => {
  const notConfigured = async () => ({ ok: false, reason: "not_configured", missing: ["PLAID_SECRET"] });
  const upstream = async () => ({ ok: false, reason: "upstream_error", error: "plaid said no" });
  const principal = { kind: "client", clientId: MINE, orgId: COMPANY };
  const a = await run(post({}), { principal, startLink: notConfigured });
  assert.equal(a.res.statusCode, 503);
  assert.deepEqual(a.res.body.missing, ["PLAID_SECRET"]);
  assert.equal(a.res.body.link_token, undefined);
  const b = await run(post({}), { principal, startLink: upstream });
  assert.equal(b.res.statusCode, 502);
  assert.equal(b.res.body.link_token, undefined);
});

// ── The real startLink, with Plaid's web address answered by a stand-in ───────────────────────────────

// Test values built here, not typed as literals: a 32-byte key and stand-in credentials.
const plaidEnv = () => ({
  PLAID_CLIENT_ID: ["test", "client"].join("-"),
  PLAID_SECRET: ["test", "secret"].join("-"),
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0",
});

/** Replace the global fetch for one test so Plaid's address is answered here and nothing leaves the process. */
async function withPlaidStandIn(fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), body: JSON.parse(init.body || "{}") });
    return new Response(JSON.stringify({ link_token: "link-sandbox-from-plaid", expiration: "2026-10-15T01:00:00Z", request_id: "r1" }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = original;
  }
}

test("the real startLink tells Plaid the client's own id, and only asks Plaid once", async () => {
  await withPlaidStandIn(async (requests) => {
    const out = await realStartLink({ clientId: MINE, env: plaidEnv() });
    assert.equal(out.ok, true);
    assert.equal(out.linkToken, "link-sandbox-from-plaid");
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/link\/token\/create$/);
    assert.equal(requests[0].body.user.client_user_id, MINE, "Plaid must be told the client's own file id");
    assert.equal(requests[0].body.client_name, "Fundhub");
  });
});

test("through the door: a client's session id, not the body's, is what reaches Plaid", async () => {
  await withPlaidStandIn(async (requests) => {
    const { res } = await run(post({ client_id: SOMEONE_ELSES }), {
      principal: { kind: "client", clientId: MINE, orgId: COMPANY },
      startLink: realStartLink,
      env: plaidEnv(),
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.link_token, "link-sandbox-from-plaid");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].body.user.client_user_id, MINE);
  });
});

test("through the door: a staff member's chosen client is what reaches Plaid, and a refused staff member reaches nothing", async () => {
  await withPlaidStandIn(async (requests) => {
    const ok = await run(post({ client_id: MINE }), { principal: { kind: "staff" }, authAs: staff("owner"), startLink: realStartLink, env: plaidEnv() });
    assert.equal(ok.res.statusCode, 200);
    assert.equal(requests[0].body.user.client_user_id, MINE);
    const refused = await run(post({ client_id: MINE }), { principal: { kind: "staff" }, authAs: staff("setter"), startLink: realStartLink, env: plaidEnv() });
    assert.equal(refused.res.statusCode, 403);
    assert.equal(requests.length, 1, "a refused role asks Plaid for nothing");
  });
});
