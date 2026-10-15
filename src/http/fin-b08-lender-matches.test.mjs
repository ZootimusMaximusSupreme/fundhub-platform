// finish-853 batch 08: GET /api/read/lender-matches. The real handler runs the real matcher
// (src/lenders/store.mjs and match.mjs) over stand-in tables that answer by the company and client
// each statement names. The row's words: lenders that fit a client by state, by recent inquiries
// and by bureau rotation; 0 when the lender table is empty; never invented names.
// Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/lender-matches.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem } from "../testing/s3-scoped-rows.mjs";
import { STAFF_ROLES } from "../pulse/catalog/proofs/s2-route-kit.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const lender = (id, name, over = {}) => ({
  id, org_id: ORG_ID, lender_table: "PersonalCC", name, product_name: null, eligible_states: "All States", bureaus_pulled: "EX",
  priority_tier: 1, active: true, is_demo: false, stated_requirements: null, ...over,
});

/** The tables the matcher reads. A row is kept only while the statement's own condition names it. */
function bookTables({ lenders = [], inquiries = [], businesses = [], custom_fields = { home_state: "AZ" }, demoMode = false, cases = [] } = {}) {
  const clients = [
    { id: CLIENT, org_id: ORG_ID, custom_fields },
    { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID, custom_fields: {} },
  ];
  const biz = businesses.map((b) => ({ org_id: ORG_ID, client_id: CLIENT, ...b }));
  const inq = inquiries.map((i) => ({ org_id: ORG_ID, client_id: CLIENT, created_at: "2026-10-10T00:00:00Z", ...i }));
  const fake = fakeDb([
    [/^\s*SELECT id, custom_fields\s+FROM clients/i, (s, p) => rowsWhere(clients, s, p)],
    [/^\s*SELECT entity_data\s+FROM businesses/i, (s, p) => rowsWhere(biz, s, p)],
    [/^\s*SELECT addresses\s+FROM pii_identity/i, []],
    [/^\s*SELECT result, outcome_tier, created_at\s+FROM crs_results/i, []],
    [/^\s*SELECT bureau, status, created_at\s+FROM inquiry_log/i, (s, p) => rowsWhere(inq, s, p)],
    [/^\s*SELECT demo_mode_enabled FROM orgs WHERE id = \$1/i, [{ demo_mode_enabled: demoMode }]],
    [/FROM lenders\s+WHERE/i, (s, p) => {
      let rows = rowsWhere(lenders, s, p);
      if (/COALESCE\(is_demo, false\) = false/.test(s)) rows = rows.filter((r) => !r.is_demo);
      return rows;
    }],
    [/FROM inquiry_removal_cases/i, (s, p) => rowsWhere(cases, s, p)],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  return fake;
}

async function call(query, tables, who = [staffSession({ role: "closer" })]) {
  const session = fakeDb(who);
  const fake = tables;
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text)
      ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("GET", { query }), res));
  return { res, fake };
}
const names = (res) => res.body.matches.map((m) => m.name);
const skipped = (res) => Object.fromEntries(res.body.skipped.map((s) => [s.name, s.reason]));

describe("GET /api/read/lender-matches", () => {
  test("lenders that cover the client's states match; one that names only another state is skipped with its reason", async () => {
    const tables = bookTables({
      lenders: [
        lender("a1", "National Bank"),
        lender("a2", "Arizona Credit Union", { eligible_states: "AZ" }),
        lender("a3", "Florida Savings", { eligible_states: "FL" }),
      ],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client_id, CLIENT);
    assert.deepEqual(names(res).sort(), ["Arizona Credit Union", "National Bank"]);
    assert.equal(res.body.match_count, 2);
    assert.equal(skipped(res)["Florida Savings"], "state_ineligible");
    assert.equal(res.body.matches.find((m) => m.name === "Arizona Credit Union").lane, "home");
    assert.equal(res.body.matches.find((m) => m.name === "National Bank").lane, "national");
  });

  test("a bureau the client has a recent inquiry on is protected: lenders that pull it are held back and named", async () => {
    const tables = bookTables({
      lenders: [lender("b1", "Experian Lender", { bureaus_pulled: "EX" }), lender("b2", "Transunion Lender", { bureaus_pulled: "TU" })],
      inquiries: [{ bureau: "TU", status: "open" }],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.deepEqual(names(res), ["Experian Lender"]);
    assert.equal(skipped(res)["Transunion Lender"], "inquiry_sensitive");
    assert.deepEqual(res.body.summary.held_for_bureau_protection.bureaus, ["TU"]);
    assert.equal(res.body.summary.held_for_bureau_protection.count, 1);
    assert.deepEqual(res.body.summary.sensitive_bureaus, ["TU"]);
  });

  test("another company's inquiries do not protect this client's bureaus", async () => {
    const tables = bookTables({
      lenders: [lender("b1", "Transunion Lender", { bureaus_pulled: "TU" })],
      inquiries: [{ bureau: "TU", status: "open", client_id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.deepEqual(names(res), ["Transunion Lender"]);
  });

  test("bureau rotation spreads the plan: at the same tier, the lender on the bureau already used comes later", async () => {
    const tables = bookTables({
      lenders: [
        lender("c1", "Alpha Bank", { bureaus_pulled: "EX" }),
        lender("c2", "Bravo Bank", { bureaus_pulled: "EX" }),
        lender("c3", "Charlie Bank", { bureaus_pulled: "EQ" }),
      ],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.deepEqual(names(res), ["Alpha Bank", "Charlie Bank", "Bravo Bank"]);
    assert.deepEqual(res.body.matches.map((m) => m.rotation_cost), [0, 0, 1]);
  });

  test("tier 1 comes before tier 2 whatever the bureaus", async () => {
    const tables = bookTables({
      lenders: [lender("d1", "Zed Bank", { priority_tier: 1, bureaus_pulled: "EX" }), lender("d2", "Able Bank", { priority_tier: 2, bureaus_pulled: "EQ" })],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.deepEqual(names(res), ["Zed Bank", "Able Bank"]);
  });

  test("an empty lender table answers 0 matches and invents no names", async () => {
    const { res } = await call({ client_id: CLIENT }, bookTables({ lenders: [] }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.match_count, 0);
    assert.deepEqual(res.body.matches, []);
    assert.deepEqual(res.body.skipped, []);
  });

  test("only this company's active, non-demo lenders are read; another company's book and demo rows never appear", async () => {
    const tables = bookTables({
      lenders: [
        lender("e1", "Real Bank"),
        lender("e2", "Other Company Bank", { org_id: OTHER_ORG_ID }),
        lender("e3", "Sample Demo Bank", { is_demo: true }),
        lender("e4", "Closed Bank", { active: false }),
      ],
    });
    const { res } = await call({ client_id: CLIENT }, tables);
    assert.deepEqual(names(res), ["Real Bank"]);
    const shown = JSON.stringify(res.body);
    assert.doesNotMatch(shown, /Other Company Bank|Sample Demo Bank|Closed Bank/);
    const demoOn = await call({ client_id: CLIENT }, bookTables({ lenders: [lender("e3", "Sample Demo Bank", { is_demo: true })], demoMode: true }));
    assert.equal(demoOn.res.body.match_count, 1, "with Demo Mode on, the demo row shows");
    assert.match(names(demoOn.res)[0], /Sample Demo Bank/);
    assert.equal(demoOn.res.body.matches[0].is_demo, true);
  });

  test("no business on file holds back business cards; personal cards still match", async () => {
    const lenders = [lender("f1", "Business Card Bank", { lender_table: "OnlineBizCC" }), lender("f2", "Personal Card Bank", { lender_table: "PersonalCC" })];
    const none = await call({ client_id: CLIENT }, bookTables({ lenders }));
    assert.deepEqual(names(none.res), ["Personal Card Bank"]);
    assert.equal(skipped(none.res)["Business Card Bank"], "no_business_on_file");
    const withBiz = await call({ client_id: CLIENT }, bookTables({ lenders, businesses: [{ entity_data: { name: "Acme LLC", state: "AZ" } }] }));
    assert.deepEqual(names(withBiz.res).sort(), ["Business Card Bank", "Personal Card Bank"]);
  });

  test("a client of another company is 404 and no lender is read; a bad id is 400", async () => {
    const tables = bookTables({ lenders: [lender("g1", "Real Bank")] });
    const foreign = await call({ client_id: FOREIGN_CLIENT }, tables);
    assert.equal(foreign.res.statusCode, 404);
    assert.equal(foreign.res.body.error, "client_not_found");
    assert.equal(tables.calls.filter((c) => /FROM lenders/.test(c.sql)).length, 0);
    const bad = await call({ client_id: "nope" }, bookTables());
    assert.equal(bad.res.statusCode, 400);
  });

  test("every staff role may read; a partner or client login is refused and nothing is read", async () => {
    for (const role of STAFF_ROLES) {
      const { res } = await call({ client_id: CLIENT }, bookTables({ lenders: [lender("h1", "Real Bank")] }), [staffSession({ role })]);
      assert.equal(res.statusCode, 200, role);
    }
    // A white-label partner has a staff row too ("partner" role); it is not part of the staff set.
    const partnerTables = bookTables({ lenders: [lender("h1", "Real Bank")] });
    const partner = await call({ client_id: CLIENT }, partnerTables, [staffSession({ role: "partner" })]);
    assert.equal(partner.res.statusCode, 403);
    assert.equal(partnerTables.calls.filter((c) => /FROM lenders|FROM clients/.test(c.sql)).length, 0);
    const tables = bookTables({ lenders: [lender("h1", "Real Bank")] });
    const client = await call({ client_id: CLIENT }, tables, accountSession({ kind: "client", clientId: CLIENT }));
    assert.equal(client.res.statusCode, 401);
    assert.equal(tables.calls.filter((c) => /FROM lenders|FROM clients/.test(c.sql)).length, 0);
  });
});
