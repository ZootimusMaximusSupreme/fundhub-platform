// GET /api/money/fundability?view=lookahead|plan&months=N — the Fundhub score
// look-ahead and the closer's plan. Stubbed principal and db; no network, no
// Postgres. The rules live in src/finance/fundhub-lookahead.test.mjs and
// src/finance/fundhub-score.test.mjs; this file proves the door, both ways:
//   - the plain read is unchanged (no view → the fundability builder, alone)
//   - view=plan is staff only, and closers AND CSMs get it
//   - view=lookahead keeps the plain read's gate: a client sees only their file
//   - months is a whole number 1–24, or 400
//   - the response carries no part of the score's formula
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler, { PLAN_VIEW_ROLES } from "../../api/money/fundability.mjs";
import { ROLE_SETS } from "./read-api.mjs";
import { buildLookahead } from "../finance/fundhub-lookahead.mjs";
import { addMonths } from "../finance/fundability.mjs";

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
const NOW = () => new Date();

/* A real look-ahead over the sample client's file, so the response is the
   real contract and not a stand-in shape. */
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
const LINE = (id, lender, limit, balance, opened, kind = "revolving") => ({
  id, lender, kind, credit_limit_cents: limit, balance_cents: balance, opened_on: opened, closed_at: null, last4: null, apr: null,
  raw: { accountStatusType: "Open" }
});
function realLookahead() {
  const calls = [];
  const fn = async (_db, args) => {
    calls.push(args);
    return buildLookahead({
      client: { id: args.clientId, first_name: "Sim", custom_fields: { crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1, crs_negative_items_count: 0, crs_late_payments_count: 0 } },
      asOf: args.asOf,
      crsRows: [{ id: "p1", created_at: "2026-09-30T04:30:03.759Z", result: { scores: { ex: 771, eq: 778, tu: 766 }, environment: "simulated", simulated: true } }],
      tradelineRows: [
        LINE("t1", "CHASE", "2000000", "120000", ago(88)), LINE("t2", "AMEX", "1500000", "85000", ago(64)),
        LINE("t3", "CAPITAL ONE", "1000000", "70000", ago(43)), LINE("t4", "TOYOTA", "3400000", "1120000", ago(40), "installment")
      ],
      liabilities: ["t1", "t2", "t3", "t4"].map((id) => ({ tradeline_id: id, payment_status: "current", as_of: "2026-09-30" })),
      months: args.months, view: args.view, relationships: args.view === "plan" ? [] : null
    });
  };
  fn.calls = calls;
  return fn;
}
function spyBuild() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { ok: true, client: { id: args.clientId } }; };
  fn.calls = calls;
  return fn;
}

async function call({ query = {}, principal, inOrg } = {}) {
  const res = makeRes();
  const lookahead = realLookahead();
  const fundability = spyBuild();
  await handler({ method: "GET", query }, res,
    { db: db(inOrg), requirePrincipal: gateAs(principal), lookahead, fundability, now: NOW });
  return { res, lookahead, fundability };
}

describe("GET /api/money/fundability — the look-ahead views", () => {
  test("no view: the plain fundability read, plus the client-safe score look-ahead for month 9", async () => {
    const { res, lookahead, fundability } = await call({ query: {}, principal: clientPrincipal() });
    assert.equal(res.statusCode, 200);
    assert.equal(fundability.calls.length, 1);
    assert.deepEqual(Object.keys(fundability.calls[0]).sort(), ["asOf", "clientId", "orgId"]);
    assert.equal(lookahead.calls.length, 1);
    assert.equal(lookahead.calls[0].view, "lookahead", "never the staff plan on the plain read");
    assert.equal(lookahead.calls[0].clientId, MINE);
    assert.equal(lookahead.calls[0].asOf, fundability.calls[0].asOf, "one clock for both");
    assert.equal(res.body.fundhub_lookahead.view, "lookahead");
    assert.equal(res.body.fundhub_lookahead.months, 9);
    assert.equal(res.body.fundhub_lookahead.roadmap, undefined);
  });

  test("the plain read still answers when the look-ahead fails; it just carries no score", async () => {
    const res = makeRes();
    const orig = console.error;
    console.error = () => {};
    try {
      await handler({ method: "GET", query: {} }, res, {
        db: db(), requirePrincipal: gateAs(clientPrincipal()), fundability: spyBuild(), now: NOW,
        lookahead: async () => { throw new Error("relation \"dispute_cases\" does not exist"); }
      });
    } finally { console.error = orig; }
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.fundhub_lookahead, null);
    assert.equal(res.body.client.id, MINE);
  });

  test("a client of another org: 404 from the plain read and no look-ahead is run", async () => {
    const res = makeRes();
    let looked = 0;
    await handler({ method: "GET", query: { client_id: OTHER } }, res, {
      db: db([MINE]), requirePrincipal: gateAs(staffPrincipal("closer")), now: NOW,
      fundability: async () => null, lookahead: async () => { looked++; return null; }
    });
    assert.equal(res.statusCode, 404);
    assert.equal(looked, 0);
  });

  test("a client gets their own look-ahead: the score now and month 9 by default", async () => {
    const { res, lookahead } = await call({ query: { view: "lookahead", client_id: OTHER }, principal: clientPrincipal() });
    assert.equal(res.statusCode, 200);
    assert.equal(lookahead.calls[0].clientId, MINE, "a client_id in the query is never read for a client");
    assert.equal(lookahead.calls[0].months, undefined);
    assert.equal(res.body.view, "lookahead");
    assert.equal(res.body.months, 9);
    assert.ok(res.body.points.some((p) => p.months === 9));
    assert.equal(res.body.roadmap, undefined, "the closer's roadmap is staff only");
  });

  test("a client asking for the plan view is 403 and nothing is read", async () => {
    const { res, lookahead, fundability } = await call({ query: { view: "plan" }, principal: clientPrincipal() });
    assert.equal(res.statusCode, 403);
    assert.equal(lookahead.calls.length + fundability.calls.length, 0);
  });

  test("closers and CSMs get the plan view; other staff do not", async () => {
    for (const role of ["closer", "csm", "owner", "admin", "sales_manager"]) {
      const { res, lookahead } = await call({ query: { view: "plan", client_id: MINE, months: "18" }, principal: staffPrincipal(role) });
      assert.equal(res.statusCode, 200, role);
      assert.equal(lookahead.calls[0].months, 18);
      assert.equal(lookahead.calls[0].view, "plan");
      assert.ok(res.body.roadmap.closing_line.startsWith("Fundable today."), role);
      assert.ok(res.body.points.some((p) => p.months === 18), role);
    }
    for (const role of ["setter", "funding_advisor", "inquiry_specialist"]) {
      const { res, lookahead } = await call({ query: { view: "plan", client_id: MINE }, principal: staffPrincipal(role) });
      assert.equal(res.statusCode, 403, role);
      assert.equal(lookahead.calls.length, 0, role);
    }
    // The CSM door is the plan view alone: the plain read and the look-ahead keep FinanceOS roles.
    for (const query of [{ client_id: MINE }, { view: "lookahead", client_id: MINE }]) {
      const { res } = await call({ query, principal: staffPrincipal("csm") });
      assert.equal(res.statusCode, 403, JSON.stringify(query));
    }
  });

  test("the plan view's roles are exactly the FinanceOS set plus csm", () => {
    assert.deepEqual([...PLAN_VIEW_ROLES].sort(), [...ROLE_SETS.FINANCE_OS, "csm"].sort());
  });

  test("staff need a client in their org", async () => {
    const missing = await call({ query: { view: "plan" }, principal: staffPrincipal("closer") });
    assert.equal(missing.res.statusCode, 400);
    const foreign = await call({ query: { view: "plan", client_id: OTHER }, principal: staffPrincipal("closer") });
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(foreign.lookahead.calls.length, 0);
  });

  test("months is a whole number from 1 to 24; a view is lookahead or plan", async () => {
    for (const months of ["0", "25", "9.5", "abc"]) {
      const { res, lookahead } = await call({ query: { view: "lookahead", months }, principal: clientPrincipal() });
      assert.equal(res.statusCode, 400, months);
      assert.match(res.body.error, /1 to 24/);
      assert.equal(lookahead.calls.length, 0);
    }
    const bad = await call({ query: { view: "everything" }, principal: clientPrincipal() });
    assert.equal(bad.res.statusCode, 400);
    const ok = await call({ query: { view: "lookahead", months: "1" }, principal: clientPrincipal() });
    assert.equal(ok.res.statusCode, 200);
    assert.deepEqual(ok.res.body.points.map((p) => p.months), [1, 3, 6, 9, 12]);
  });

  test("the response carries the score, the band and the reasons — never the formula", async () => {
    const { res } = await call({ query: { view: "plan", client_id: MINE }, principal: staffPrincipal("closer") });
    const json = JSON.stringify(res.body);
    assert.doesNotMatch(json, /weight|zero_at|full_at|close_at|FUNDHUB_SCORE_WEIGHTS/);
    const fh = res.body.now.fundhub_score;
    assert.deepEqual(Object.keys(fh).sort(), ["band", "band_label", "model", "reasons", "score"]);
    assert.equal(fh.model, "fh-score-v0");
    assert.ok(fh.reasons.length <= 3);
  });

  test("not GET is 405", async () => {
    const res = makeRes();
    await handler({ method: "POST", query: { view: "plan" } }, res, { db: db(), requirePrincipal: gateAs(staffPrincipal("closer")) });
    assert.equal(res.statusCode, 405);
  });
});
