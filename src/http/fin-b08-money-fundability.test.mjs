// finish-853 batch 08: GET /api/money/fundability. The real handler runs the real fundability
// read (src/finance/fundability.mjs) over stand-in tables that answer by the client and company
// each statement names. Row's words: the UnderwriteIQ fundability score now, 3/6/12 months ahead,
// per business; never runs a pull. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/fundability.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";
import { addMonths } from "../finance/fundability.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CID = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const OTHER_CLIENT = "c9000000-0000-4000-8000-000000000009";
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);

// The sample client's file (029964c5): three seasoned cards and a car loan, 771 / 778 / 766, 6% use, no negatives.
const PULL = (over = {}) => ({
  id: "p1", client_id: CID, org_id: ORG, created_at: "2026-09-30T04:30:03.759Z",
  result: { scores: { ex: 771, eq: 778, tu: 766 }, scoreModels: {}, environment: "simulated", simulated: true }, ...over,
});
const LINE = (o) => ({
  id: o.id, client_id: CID, org_id: ORG, lender: o.lender, kind: o.kind || "revolving", credit_limit_cents: o.limit,
  balance_cents: o.balance, opened_on: o.opened, closed_at: null, last4: null, apr: null, raw: { accountStatusType: "Open" },
});
const LINES = () => [
  LINE({ id: "t1", lender: "CHASE CARD SERVICES", limit: "2000000", balance: "120000", opened: ago(88) }),
  LINE({ id: "t2", lender: "AMEX", limit: "1500000", balance: "85000", opened: ago(64) }),
  LINE({ id: "t3", lender: "CAPITAL ONE", limit: "1000000", balance: "70000", opened: ago(43) }),
  LINE({ id: "t4", lender: "TOYOTA MOTOR CREDIT", kind: "installment", limit: "3400000", balance: "1120000", opened: ago(40) }),
];
const CURRENT = () => ["t1", "t2", "t3", "t4"].map((id) => ({ client_id: CID, org_id: ORG, tradeline_id: id, payment_status: "current", as_of: "2026-09-30" }));
const CF = { crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1, crs_negative_items_count: 0, crs_late_payments_count: 0 };

/** Every table the read touches; a row is kept only while the statement names its client AND company. */
function fileTables(over = {}) {
  const t = {
    clients: [{ id: CID, org_id: ORG, first_name: "Sim", last_name: "Eleven-Blueprint", custom_fields: CF }, { id: OTHER_CLIENT, org_id: OTHER_ORG, first_name: "Other", last_name: "Person", custom_fields: {} }],
    crs_results: [PULL()], tradelines: LINES(), card_liabilities: CURRENT(),
    businesses: [], entities: [], client_waypoints: [], dispute_items: [], ...over,
  };
  const calls = [];
  const db = {
    calls,
    query: async (sql, params = []) => {
      const problem = bindProblem(sql, params);
      if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
      const text = String(sql).replace(/\s+/g, " ").trim();
      calls.push({ sql: text, params });
      const table = /\bFROM\s+(clients|crs_results|tradelines|card_liabilities|businesses|entities|client_waypoints|dispute_items)\b/i.exec(text);
      if (!table) throw new Error(`unexpected SQL: ${text.slice(0, 80)}`);
      return { rows: rowsWhere(t[table[1].toLowerCase()], text, params).map((r) => ({ ...r })) };
    },
  };
  return { db, tables: t };
}

async function call({ query = {}, principal, files = fileTables() } = {}) {
  const res = makeRes();
  await handler({ method: "GET", query }, res, { db: files.db, requirePrincipal: gateAs(principal), now: () => new Date() });
  return { res, files };
}
const staff = (role = "closer", orgId = ORG) => staffPrincipal(role, orgId);

describe("GET /api/money/fundability", () => {
  test("the sample client reads 5 of 6 now, $212,000 of personal funding, and three plan points at +3, +6 and +12 months", async () => {
    const { res } = await call({ query: { client_id: CID }, principal: staff() });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.id, CID);
    assert.equal(res.body.has_pull, true);
    assert.equal(res.body.now.score, 5);
    assert.equal(res.body.now.score_max, 6);
    assert.equal(res.body.now.funding_estimate_cents, 21200000);
    const failing = res.body.now.factors.filter((f) => f.passed === false).map((f) => f.key);
    assert.deepEqual(failing, ["no_inquiries"], "the only check the file fails is hard inquiries");
    assert.deepEqual(res.body.projections.filter((p) => p.scenario === "plan").map((p) => p.months), [3, 6, 12]);
    assert.equal(res.body.projections[0].date, addMonths(TODAY, 3));
    assert.ok(res.body.cannot_project.length > 0, "the page says what it cannot project");
  });

  test("a client reads their own file only: a client_id in the address is never read", async () => {
    const { res } = await call({ query: { client_id: OTHER_CLIENT }, principal: clientPrincipal(CID, ORG) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.id, CID);
    assert.equal(res.body.now.score, 5);
  });

  test("it only reads: every statement is a SELECT, and no pull is ordered", async () => {
    const real = globalThis.fetch;
    let asked = 0;
    globalThis.fetch = async () => { asked += 1; throw new Error("network refused in this test"); };
    try {
      const { files, res } = await call({ query: { client_id: CID }, principal: staff() });
      assert.equal(res.statusCode, 200);
      assert.equal(asked, 0, "nothing left the building");
      assert.ok(files.db.calls.length >= 8);
      for (const c of files.db.calls) assert.match(c.sql, /^SELECT /);
    } finally { globalThis.fetch = real; }
  });

  test("another company's pull, cards and businesses for the same client id are not counted", async () => {
    const files = fileTables({
      crs_results: [PULL(), PULL({ id: "p-other", org_id: OTHER_ORG, created_at: "2026-10-12T00:00:00Z", result: { scores: { ex: 500, eq: 500, tu: 500 }, scoreModels: {}, environment: "simulated", simulated: true } })],
      tradelines: [...LINES(), { ...LINE({ id: "t9", lender: "FOREIGN CARD", limit: "1000000", balance: "999000", opened: ago(30) }), org_id: OTHER_ORG }],
      businesses: [{ id: "b9", client_id: CID, org_id: OTHER_ORG, name: "Foreign LLC", age_months: 60, entity_data: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    assert.equal(res.body.now.score, 5);
    assert.equal(res.body.now.funding_estimate_cents, 21200000);
    assert.deepEqual(res.body.businesses, []);
  });

  test("a client of another company is 404 and no file table is read", async () => {
    const files = fileTables();
    const { res } = await call({ query: { client_id: OTHER_CLIENT }, principal: staff("owner", ORG), files });
    assert.equal(res.statusCode, 404);
    assert.equal(files.db.calls.filter((c) => /FROM (crs_results|tradelines|card_liabilities)/.test(c.sql)).length, 0);
  });

  test("a low-score file reads not fundable with no figure on it: the engine's own gate, never a second opinion", async () => {
    const low = PULL({ result: { scores: { ex: 640, eq: 655, tu: 648 }, scoreModels: {}, environment: "simulated", simulated: true } });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files: fileTables({ crs_results: [low] }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.now.tier, "not_fundable");
    assert.equal(res.body.now.funding_estimate_cents, null);
    const open = await call({ query: { client_id: CID }, principal: staff() });
    assert.equal(open.res.body.now.tier, "fundable");
  });

  test("with no pull on file the score and the money are empty, never 0", async () => {
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files: fileTables({ crs_results: [], tradelines: [], card_liabilities: [] }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.has_pull, false);
    assert.equal(res.body.now.score, null);
    assert.equal(res.body.now.funding_estimate_cents, null);
    assert.deepEqual(res.body.projections, []);
  });

  test("each business is read on its own, with its own projections, and nothing adds them up", async () => {
    const files = fileTables({
      businesses: [
        { id: "b1", client_id: CID, org_id: ORG, name: "Alpha LLC", age_months: 30, entity_data: { name: "Alpha LLC", naics: "541511" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
        { id: "b2", client_id: CID, org_id: ORG, name: "Beta LLC", age_months: 6, entity_data: { name: "Beta LLC", naics: "541511" }, created_at: "2026-02-01T00:00:00Z", updated_at: "2026-02-01T00:00:00Z" },
      ],
    });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    assert.equal(res.body.businesses.length, 2);
    const [alpha, beta] = res.body.businesses;
    assert.equal(alpha.name, "Alpha LLC");
    assert.equal(beta.name, "Beta LLC");
    assert.equal(alpha.projections.filter((p) => p.scenario === "plan").length, 3);
    assert.notEqual(alpha.now.funding_estimate_cents, beta.now.funding_estimate_cents, "a 30 month business and a 6 month one differ");
    assert.equal(res.body.now.funding_estimate_cents, 21200000, "the personal figure stays personal");
  });

  test("only owner, admin, sales manager and closer may read a client's file; the rest are refused before any read", async () => {
    const letIn = [];
    for (const role of ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
      const files = fileTables();
      const { res } = await call({ query: { client_id: CID }, principal: staff(role), files });
      if (res.statusCode === 403) assert.equal(files.db.calls.length, 0, `${role}: nothing read`);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "owner", "sales_manager"]);
  });

  test("a staff call with no client id is 400 and a bad one is 400", async () => {
    assert.equal((await call({ query: {}, principal: staff() })).res.statusCode, 400);
    assert.equal((await call({ query: { client_id: "nope" }, principal: staff() })).res.statusCode, 400);
  });
});
