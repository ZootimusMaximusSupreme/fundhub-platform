// GET /api/money/fundability carries `paths` — "Your funding paths" (Finance
// OS wave 4, unit FUND). Stubbed principal, db, builder and paths reader; no
// network, no Postgres. The paths rules are tested in
// src/finance/funding-paths.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/fundability.mjs";

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
const clientP = () => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId: MINE });
const staffP = (role = "admin") => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });
const gateAs = (p) => async (_req, res, kinds) => {
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};
const db = { query: async (sql, params) => (/FROM clients/.test(sql) ? { rows: [MINE, OTHER].includes(params[0]) ? [{ "?column?": 1 }] : [] } : { rows: [] }) };
const PAYLOAD = { ok: true, client: { id: MINE }, has_pull: true, now: { score: 5, score_max: 6, tier: "fundable", funding_estimate_cents: 21200000 } };
const NOW = () => new Date("2026-11-07T12:00:00Z");

function spies(over = {}) {
  const calls = { build: [], paths: [] };
  return {
    calls,
    deps: {
      fundability: async (_db, args) => { calls.build.push(args); return over.payload === undefined ? { ...PAYLOAD } : over.payload; },
      fundingPaths: over.fundingPaths || (async (_db, args) => { calls.paths.push(args); return { ok: true, viewer: args.viewer, self: { ok: true } }; })
    }
  };
}
async function call(req, principal, s = spies()) {
  const res = makeRes();
  await handler(req, res, { db, requirePrincipal: gateAs(principal), now: NOW, ...s.deps });
  return { res, calls: s.calls };
}

describe("GET /api/money/fundability — paths", () => {
  test("a client's read carries paths built from the SAME payload, as the client", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: OTHER } }, clientP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.build.length, 1, "UnderwriteIQ runs once");
    assert.equal(calls.paths.length, 1);
    const args = calls.paths[0];
    assert.equal(args.clientId, MINE);
    assert.equal(args.orgId, ORG);
    assert.equal(args.viewer, "client");
    assert.equal(args.asOf.toISOString(), "2026-11-07T12:00:00.000Z");
    assert.equal(args.fundability.now.funding_estimate_cents, 21200000, "the paths read gets the fundability payload, not a second run");
    assert.deepEqual(res.body.paths, { ok: true, viewer: "client", self: { ok: true } });
    assert.equal(res.body.now.score, 5, "the fundability answer is unchanged");
  });

  test("staff read the client they named, as staff", async () => {
    const { res, calls } = await call({ method: "GET", query: { client_id: MINE } }, staffP());
    assert.equal(res.statusCode, 200);
    assert.equal(calls.paths[0].viewer, "staff");
    assert.equal(calls.paths[0].clientId, MINE);
  });

  test("a paths read that throws leaves the fundability answer standing", async () => {
    const s = spies({ fundingPaths: async () => { throw new Error("down"); } });
    const { res } = await call({ method: "GET", query: {} }, clientP(), s);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.paths, { ok: false });
    assert.equal(res.body.now.tier, "fundable");
  });

  test("a client not in this org: 404, and no paths read", async () => {
    const s = spies({ payload: null });
    const { res, calls } = await call({ method: "GET", query: {} }, clientP(), s);
    assert.equal(res.statusCode, 404);
    assert.equal(calls.paths.length, 0);
  });
});
