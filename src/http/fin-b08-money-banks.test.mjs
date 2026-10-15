// finish-853 batch 08: GET /api/money/banks. The real handler runs the real bank strategy read
// (src/finance/bank-strategy.mjs, the real matcher behind it) over stand-in tables that answer by
// the company and client each statement names. The row's words: banks to open by location, card
// stacking order, next funding sequence, bank relationship tracker. Practice test, fake data,
// no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/banks.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN = "c9000000-0000-4000-8000-000000000009";
const NOW = new Date("2026-10-14T12:00:00Z");
const lender = (id, name, over = {}) => ({
  id, org_id: ORG, lender_table: "InBranchBizCC", name, product_name: null, eligible_states: "AZ", bureaus_pulled: "EX",
  priority_tier: 1, active: true, is_demo: false, minimum_deposit: "500", requires_account_opening: "yes", relationship_required: "yes", ...over,
});

function bankFile(over = {}) {
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", custom_fields: { home_state: "AZ" } },
      { id: FOREIGN, org_id: OTHER_ORG, first_name: "Other", last_name: "Person", custom_fields: {} },
    ],
    lenders: [
      lender("l1", "Desert Bank"),
      lender("l2", "Florida Bank", { eligible_states: "FL" }),
      lender("l3", "National Bank", { eligible_states: "All States", bureaus_pulled: "EQ", minimum_deposit: null, lender_table: "PersonalCC", priority_tier: 2 }),
      // A card with nothing in the book about opening an account first: it stacks, but it is not a bank to open.
      lender("l4", "Plain Card Bank", { lender_table: "PersonalCC", eligible_states: "All States", bureaus_pulled: "TU", priority_tier: 3,
        minimum_deposit: null, requires_account_opening: null, relationship_required: null }),
      lender("l9", "Other Company Bank", { org_id: OTHER_ORG }),
    ],
    businesses: [{ id: "b1", org_id: ORG, client_id: CLIENT, name: "Acme LLC", age_months: 30, entity_data: { state: "AZ" }, created_at: "2026-01-01T00:00:00Z" }],
    blueprint_bank_relationship_todos: [
      { id: "r1", org_id: ORG, client_id: CLIENT, bank_key: "desert bank", bank_name: "Desert Bank", account_kind: "business", state: "open", lender_id: "l1",
        created_at: "2026-10-01T00:00:00Z", planned_open_on: "2026-10-20", planned_deposit_cents: 50000 },
      { id: "r9", org_id: OTHER_ORG, client_id: FOREIGN, bank_key: "foreign bank", bank_name: "Foreign Bank", account_kind: "business", state: "open",
        created_at: "2026-10-01T00:00:00Z" },
    ],
    bank_relationship_deposits: [
      { id: "d1", org_id: ORG, client_id: CLIENT, relationship_id: "r1", amount_cents: 20000, deposited_on: "2026-10-02", note: null, created_at: "2026-10-02T00:00:00Z" },
    ],
    ...over,
  };
  const db = tablesDb({
    tables,
    rules: [
      [/FROM lenders\s+WHERE org_id = \$1::uuid AND id = ANY\(\$2::uuid\[\]\)/i, (s, p) => rowsWhere(tables.lenders, s, p).filter((r) => p[1].includes(r.id))],
      [/FROM lenders\s+WHERE org_id = \$1::uuid AND COALESCE\(is_demo, false\) = false\s+AND \(id = ANY/i,
        (s, p) => rowsWhere(tables.lenders, s, p).filter((r) => p[1].includes(r.id) || p[2].includes(String(r.name).toLowerCase()))],
    ],
  });
  return db;
}

async function call({ query = { client_id: CLIENT }, method = "GET", body, principal, db = bankFile() } = {}) {
  const res = makeRes();
  await handler({ method, query, body }, res, { db, requirePrincipal: gateAs(principal), now: () => NOW });
  return { res, db };
}
const staff = (role = "closer", orgId = ORG) => staffPrincipal(role, orgId);

describe("GET /api/money/banks", () => {
  test("banks to open are the book's relationship banks that serve the client's state, each with its steps and minimum deposit", async () => {
    const { res } = await call({ principal: staff() });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.name, "Dana Whitfield");
    assert.deepEqual(res.body.location.states, ["AZ"]);
    const banks = Object.fromEntries(res.body.recommended_banks.map((b) => [b.name, b]));
    assert.deepEqual(Object.keys(banks).sort(), ["Desert Bank", "National Bank"], "Florida Bank, a card with no account rule and another company's bank are not offered");
    assert.equal(banks["Desert Bank"].lane, "home");
    assert.equal(banks["Desert Bank"].minimum_deposit_cents, 50000);
    assert.deepEqual(banks["Desert Bank"].relationship_steps.map((s) => s.step), ["open_account", "deposit"]);
    assert.equal(banks["Desert Bank"].relationship_steps[1].amount_cents, 50000);
    assert.equal(banks["National Bank"].lane, "national");
    assert.equal(banks["National Bank"].minimum_deposit_cents, null, "an unknown minimum stays unknown, not 0");
    assert.equal(JSON.stringify(res.body).includes("Other Company Bank"), false);
  });

  test("card stacking puts personal cards before business cards, in book tier order, numbered from 1", async () => {
    const { res } = await call({ principal: staff() });
    const items = res.body.card_stacking.items;
    assert.deepEqual(items.map((i) => [i.order, i.issuer, i.kind]), [[1, "National Bank", "personal"], [2, "Plain Card Bank", "personal"], [3, "Desert Bank", "business"]]);
    assert.equal(res.body.card_stacking.spacing.days_between, null, "no rule names a number of days, so none is invented");
    assert.equal(res.body.card_stacking.engine.can_card_stack, null, "with no pull the engine cannot say");
    assert.equal(res.body.card_stacking.held.for_no_business.count, 0);
  });

  test("with no business on file the business cards are held back and the screen is told why", async () => {
    const { res } = await call({ principal: staff(), db: bankFile({ businesses: [] }) });
    assert.deepEqual(res.body.card_stacking.items.map((i) => i.issuer), ["National Bank", "Plain Card Bank"]);
    assert.equal(res.body.card_stacking.held.for_no_business.business_on_file, false);
    // Both business-table banks in this company's book (Desert and Florida) are held, whatever their state.
    assert.equal(res.body.card_stacking.held.for_no_business.count, 2);
    assert.match(res.body.card_stacking.held.for_no_business.message, /2 business cards are held back because there is no business on file/);
  });

  test("the relationship tracker lists this client's rows with their deposits, and nobody else's", async () => {
    const { res } = await call({ principal: staff() });
    assert.deepEqual(res.body.relationships.map((r) => r.id), ["r1"]);
    const [rel] = res.body.relationships;
    assert.equal(rel.bank, "Desert Bank");
    assert.equal(rel.status, "planned");
    assert.equal(rel.planned_open_on, "2026-10-20");
    assert.equal(rel.deposit_plan_cents, 50000);
    assert.deepEqual(rel.deposits.map((d) => d.amount_cents), [20000]);
    assert.equal(rel.deposits_total_cents, 20000);
  });

  test("the next funding sequence names what is still open and does not invent a date or an amount", async () => {
    const { res } = await call({ principal: staff() });
    const next = res.body.next_sequence;
    assert.equal(next.date, null);
    assert.equal(next.estimated_amount_cents, null, "no credit pull, no figure");
    assert.equal(next.ready, false);
    assert.ok(next.readiness_gaps.some((g) => g.id === "no_credit_file"));
    assert.ok(next.readiness_gaps.some((g) => g.id === "open:r1"), "the planned account is a gap");
    assert.deepEqual(res.body.next_round, next, "the old name carries the same object");
    assert.ok(res.body.not_set.some((n) => n.key === "next_round_date"));
  });

  test("it only reads: every statement is a SELECT", async () => {
    const { db } = await call({ principal: staff() });
    assert.ok(db.calls.length > 8);
    for (const c of db.calls) assert.match(c.sql.trim(), /^(SELECT|WITH)\b/i, c.sql.slice(0, 60));
  });

  test("a client reads their own file, a client_id in the address is ignored, and a client cannot POST", async () => {
    const own = await call({ query: { client_id: FOREIGN }, principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(own.res.statusCode, 200);
    assert.equal(own.res.body.client.id, CLIENT);
    const post = await call({ method: "POST", body: { action: "plan_bank", bank: "Desert Bank" }, principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(post.res.statusCode, 403);
  });

  test("staff of another company get 404 for this client and no file table is read", async () => {
    const db = bankFile();
    const { res } = await call({ principal: staff("owner", OTHER_ORG), db });
    assert.equal(res.statusCode, 404);
    assert.equal(db.calls.filter((c) => /FROM (lenders|blueprint_bank_relationship_todos)/.test(c.sql)).length, 0);
  });

  test("only owner, admin, sales manager and closer may read; the rest are refused before any read", async () => {
    const letIn = [];
    for (const role of ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
      const db = bankFile();
      const { res } = await call({ principal: staff(role), db });
      if (res.statusCode === 403) assert.equal(db.calls.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "owner", "sales_manager"]);
  });
});
