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

  // ── a client with a credit pull, a staff date and accounts at several stages ─────────────────────

  function richFile({ staffDate = "2026-12-01", onFile = "45000", relationships = null, deposits = null, buyer = true, pullEstimate = "$30,000" } = {}) {
    const cf = { home_state: "AZ", crs_negative_items_count: 0, crs_late_payments_count: 0, crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 1 };
    if (staffDate) cf.blueprint_next_sequence_ready_date = staffDate;
    if (onFile) cf.total_funding_estimate = onFile;
    const rel = (id, bank, over) => ({ id, org_id: ORG, client_id: CLIENT, bank_key: bank.toLowerCase(), bank_name: bank, account_kind: "business", state: "open",
      lender_id: null, created_at: "2026-10-01T00:00:00Z", planned_open_on: null, planned_deposit_cents: null, opened_on: null, ...over });
    const tables = {
      clients: [{ id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", custom_fields: cf }],
      lenders: [
        lender("l1", "Desert Bank", { insider_tips: "Checking account + 30-day seasoning required.", minimum_deposit: "500" }),
        lender("l2", "Zion Bank", { insider_tips: "Open checking account 30 days prior when possible", minimum_deposit: "250" }),
        lender("l3", "Mesa Bank", { minimum_deposit: null }),
      ],
      businesses: [{ id: "b1", org_id: ORG, client_id: CLIENT, name: "Acme LLC", age_months: 30, entity_data: { state: "AZ", naics: "541511" }, created_at: "2026-01-01T00:00:00Z" }],
      crs_results: [{ id: "crs-1", client_id: CLIENT, org_id: ORG, created_at: "2026-10-05T12:00:00Z", result: {
        environment: "production", bureausPulled: ["EX", "EQ", "TU"], scores: { ex: 731, eq: 740, tu: 725 }, fundingEstimate: pullEstimate,
        inquiries: [{ source: "EX", date: "2026-09-14" }, { source: "EQ", date: "2026-09-15" }, { source: "TU", date: "2026-09-16" }] } }],
      tradelines: [
        { id: "t0", client_id: CLIENT, org_id: ORG, lender: "OLD", kind: "revolving", credit_limit_cents: 1500000, balance_cents: 150000, apr: "0.1899", opened_on: "2019-05-28", closed_at: null },
        { id: "t1", client_id: CLIENT, org_id: ORG, lender: "NEW", kind: "revolving", credit_limit_cents: 1000000, balance_cents: 100000, apr: "0.1899", opened_on: "2026-09-20", closed_at: null },
      ],
      funding_rounds: [{ id: "r1", client_id: CLIENT, org_id: ORG, round_number: 1, status: "funded", funded_amount: "50000.00", approved_amount: "50000.00",
        created_at: new Date("2026-09-10T00:00:00Z"), updated_at: new Date("2026-09-25T00:00:00Z") }],
      blueprint_bank_relationship_todos: relationships || [
        // Stored newest first on purpose: the tracker lists them oldest first.
        rel("r3", "Mesa Bank", { opened_on: "2026-09-01", created_at: "2026-10-03T00:00:00Z" }),
        rel("r2", "Zion Bank", { opened_on: "2026-08-01", created_at: "2026-10-02T00:00:00Z" }),
        rel("r1", "Desert Bank", { opened_on: "2026-10-01", planned_deposit_cents: 70000, lender_id: "l1", created_at: "2026-10-01T00:00:00Z" }),
      ],
      bank_relationship_deposits: deposits || [],
    };
    const db = tablesDb({
      tables,
      rules: [
        [/FROM transactions t/i, () => (buyer ? [{ x: 1 }] : [])],
        [/FROM lenders\s+WHERE org_id = \$1::uuid AND id = ANY\(\$2::uuid\[\]\)/i, (s, p) => rowsWhere(tables.lenders, s, p).filter((r) => p[1].includes(r.id))],
        [/FROM lenders\s+WHERE org_id = \$1::uuid AND COALESCE\(is_demo, false\) = false\s+AND \(id = ANY/i,
          (s, p) => rowsWhere(tables.lenders, s, p).filter((r) => p[1].includes(r.id) || p[2].includes(String(r.name).toLowerCase()))],
      ],
    });
    db.tables = tables;
    return db;
  }
  const rel = (res, id) => res.body.relationships.find((r) => r.id === id);

  test("each account is planned, seasoning, seasoned or open by the bank's own seasoning days, and says the day it will be seasoned", async () => {
    const { res } = await call({ principal: staff(), db: richFile() });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body).slice(0, 300));
    assert.deepEqual(res.body.relationships.map((r) => r.id), ["r1", "r2", "r3"], "oldest first");
    const desert = rel(res, "r1");
    assert.equal(desert.status, "seasoning", "opened 13 days ago, the bank wants 30");
    assert.equal(desert.days_open, 13);
    assert.equal(desert.seasoning.days, 30);
    assert.equal(desert.seasoned_on, "2026-10-31", "the open day plus the bank's own 30 days");
    assert.equal(desert.opened_on, "2026-10-01");
    const zion = rel(res, "r2");
    assert.equal(zion.status, "seasoned");
    assert.equal(zion.seasoned_on, "2026-08-31");
    assert.equal(zion.days_open, 74);
    const mesa = rel(res, "r3");
    assert.equal(mesa.status, "open", "the book names no seasoning period for this bank");
    assert.equal(mesa.seasoning, null);
    assert.equal(mesa.seasoned_on, null);
    assert.equal(mesa.status_text, "Open");
  });

  test("the deposit to make is staff's own number first, then the bank book's minimum, else nothing; and it says which", async () => {
    const { res } = await call({ principal: staff(), db: richFile() });
    const desert = rel(res, "r1");
    assert.equal(desert.deposit_plan_cents, 70000, "staff planned $700 and the book's minimum is $500");
    assert.equal(desert.planned_deposit_cents, 70000);
    assert.match(desert.deposit_plan_source.label, /staff/i);
    const zion = rel(res, "r2");
    assert.equal(zion.deposit_plan_cents, 25000, "no staff number: the book's $250");
    assert.doesNotMatch(zion.deposit_plan_source.label, /staff/i);
    assert.match(zion.deposit_plan_source.ref, /minimum_deposit/);
    const mesa = rel(res, "r3");
    assert.equal(mesa.deposit_plan_cents, null, "nobody named an amount: unknown stays unknown, not 0");
    assert.equal(mesa.deposit_plan_source, null);
  });

  test("two deposits on one day come back in the order they were recorded, and a deposit with no date or amount is left out", async () => {
    const dep = (id, over) => ({ id, org_id: ORG, client_id: CLIENT, relationship_id: "r1", amount_cents: 10000, deposited_on: "2026-10-02", note: id, created_at: "2026-10-02T09:00:00Z", ...over });
    const deposits = [
      dep("late", { created_at: "2026-10-02T17:00:00Z", amount_cents: 30000 }),
      dep("early", { created_at: "2026-10-02T08:00:00Z", amount_cents: 20000 }),
      dep("next-day", { deposited_on: "2026-10-03", amount_cents: 5000, created_at: "2026-10-03T08:00:00Z" }),
      dep("no-amount", { amount_cents: null }),
      dep("no-day", { deposited_on: null }),
      dep("other-client", { client_id: "c8000000-0000-4000-8000-000000000008" }),
    ];
    const { res } = await call({ principal: staff(), db: richFile({ deposits }) });
    const desert = rel(res, "r1");
    assert.deepEqual(desert.deposits.map((d) => d.id), ["early", "late", "next-day"]);
    assert.equal(desert.deposits_total_cents, 55000);
    assert.equal(rel(res, "r2").deposits_total_cents, null, "no deposits recorded is unknown, not $0");
  });

  test("the next funding sequence: a staff date wins, the amount is the file's own figure first and the pull's second, and ready needs a date and no open gap", async () => {
    const ready = await call({ principal: staff(), db: richFile() });
    const n = ready.res.body.next_sequence;
    assert.equal(n.date, "2026-12-01");
    assert.equal(n.effective_date, "2026-12-01");
    assert.equal(n.effective_source, "staff");
    assert.equal(n.suggested_date, "2027-03-21", "the file math's own answer rides beside the staff date");
    assert.equal(n.estimated_amount_cents, 4500000, "the figure on the client's file");
    assert.match(n.amount_source.ref, /total_funding_estimate/);
    assert.equal(n.can_set_date, true);
    assert.deepEqual(n.readiness_gaps, []);
    assert.equal(n.ready, true, "a date, a fundable file and nothing left to do");
    assert.deepEqual(ready.res.body.not_set.filter((x) => x.key === "next_round_date"), []);

    // The pull's figure is used when the file carries none.
    const fromPull = await call({ principal: staff(), db: richFile({ onFile: null }) });
    assert.equal(fromPull.res.body.next_sequence.estimated_amount_cents, 3000000);
    assert.match(fromPull.res.body.next_sequence.amount_source.ref, /fundingEstimate/);

    // No staff date: not ready, and the suggested date is what is offered as the effective one.
    const noDate = await call({ principal: staff(), db: richFile({ staffDate: null }) });
    assert.equal(noDate.res.body.next_sequence.date, null);
    assert.equal(noDate.res.body.next_sequence.ready, false, "ready needs a date");
    assert.equal(noDate.res.body.next_sequence.effective_date, "2027-03-21");
    assert.equal(noDate.res.body.next_sequence.effective_source, "suggested");
    assert.ok(noDate.res.body.not_set.some((x) => x.key === "next_round_date"));
  });

  test("an account not seasoned by the staff date is a gap that says how many days it will have; one seasoned in time is not; a planned one is always a gap", async () => {
    // Desert Bank is seasoned on 2026-10-31. A staff date of 2026-10-20 is too soon for it.
    const early = await call({ principal: staff(), db: richFile({ staffDate: "2026-10-20" }) });
    const n = early.res.body.next_sequence;
    assert.deepEqual(n.readiness_gaps.map((g) => g.id), ["season:r1"]);
    assert.match(n.readiness_gaps[0].text, /Desert Bank will have 19 of 30 days of seasoning on that day/);
    assert.equal(n.ready, false);
    // With no staff date the same gap counts from today.
    const none = await call({ principal: staff(), db: richFile({ staffDate: null }) });
    assert.deepEqual(none.res.body.next_sequence.readiness_gaps.map((g) => g.id), ["season:r1"]);
    assert.match(none.res.body.next_sequence.readiness_gaps[0].text, /needs 17 more days of seasoning/);
    // An account still only planned is a gap on any date, and a skipped one is not.
    const planned = await call({ principal: staff(), db: richFile({ relationships: [
      { id: "r8", org_id: ORG, client_id: CLIENT, bank_key: "plain bank", bank_name: "Plain Bank", account_kind: "business", state: "open", lender_id: null, created_at: "2026-10-01T00:00:00Z", planned_open_on: null, planned_deposit_cents: null, opened_on: null },
      { id: "r9", org_id: ORG, client_id: CLIENT, bank_key: "skipped bank", bank_name: "Skipped Bank", account_kind: "business", state: "skipped", lender_id: null, created_at: "2026-10-02T00:00:00Z", planned_open_on: null, planned_deposit_cents: null, opened_on: null },
    ] }) });
    assert.deepEqual(planned.res.body.next_sequence.readiness_gaps.map((g) => g.id), ["open:r8"]);
    assert.equal(planned.res.body.next_sequence.ready, false);
    assert.equal(rel(planned.res, "r9").status, "skipped");
    assert.equal(rel(planned.res, "r8").status, "planned");
    assert.equal(rel(planned.res, "r8").status_text, "Planned · date not set");
  });

  test("a client does not read the staff flags that staff do", async () => {
    const staffRead = await call({ principal: staff(), db: richFile() });
    const flags = staffRead.res.body.next_sequence.suggestion.flags;
    assert.equal(flags.length, 1, "the staff date is before the file math's date");
    assert.equal(flags[0].id, "staff_date_before_suggestion");
    const clientRead = await call({ principal: clientPrincipal(CLIENT, ORG), db: richFile() });
    assert.equal(clientRead.res.statusCode, 200);
    assert.deepEqual(clientRead.res.body.next_sequence.suggestion.flags, []);
    assert.deepEqual(clientRead.res.body.next_round.suggestion.flags, [], "the old name is the same object");
    assert.equal(clientRead.res.body.next_sequence.date, "2026-12-01", "the date itself is the client's to see");
  });
});
