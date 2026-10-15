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
import { addMonths, projectFile } from "../finance/fundability.mjs";

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

  // ── looking ahead: what the plan line and the "if removed" line say ──────────────────────────────

  const CARD = (id, lender, limit, balance, opened) => LINE({ id, lender, limit, balance, opened });
  const CURRENT_OF = (ids) => ids.map((id) => ({ client_id: CID, org_id: ORG, tradeline_id: id, payment_status: "current", as_of: "2026-09-30" }));
  const cleanFile = (over = {}, cf = {}) => fileTables({
    ...over,
    clients: [{ id: CID, org_id: ORG, first_name: "Sim", last_name: "Young",
      custom_fields: { crs_inquiries_ex: 0, crs_inquiries_eq: 0, crs_inquiries_tu: 0, crs_negative_items_count: 0, crs_late_payments_count: 0, ...cf } }],
  });
  const plan = (res) => res.body.projections.filter((p) => p.scenario === "plan");

  test("time makes accounts older: a card passes the two-year check only once it is two years old, and the money appears with it", async () => {
    // Three cards, 14 months old, light use. The best card is $10,000, so a seasoned file is worth $10,000 x 5.5.
    const files = cleanFile({
      tradelines: [CARD("a1", "CHASE", "1000000", "100000", ago(14)), CARD("a2", "AMEX", "800000", "100000", ago(14)), CARD("a3", "CAPITAL ONE", "600000", "50000", ago(14))],
      card_liabilities: CURRENT_OF(["a1", "a2", "a3"]),
    }, { business_age_months: 18 });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.now.tier, "fundable");
    assert.equal(res.body.now.funding_estimate_cents, 0, "fundable, but no card is old enough to count: a real zero");
    assert.equal(res.body.now.factors.find((f) => f.key === "anchor_card").passed, false);
    const points = plan(res);
    assert.deepEqual(points.map((p) => p.months), [3, 6, 12]);
    assert.deepEqual(points.map((p) => p.checks.anchor_card), [false, false, true], "14 months now, 26 at +12");
    assert.deepEqual(points.map((p) => p.funding_estimate_cents), [0, 0, 5500000]);
    assert.deepEqual(points.map((p) => p.score), [5, 5, 6]);
    assert.deepEqual(points.map((p) => p.date), [addMonths(TODAY, 3), addMonths(TODAY, 6), addMonths(TODAY, 12)]);
    assert.ok(points.every((p) => p.assumptions.some((t) => /months go by/.test(t))), "every point names the time assumption");
    assert.ok(points.every((p) => p.tier === "fundable"));
    // Scores and inquiries are not guessed: they are today's at every point.
    assert.ok(points.every((p) => p.checks.score_700 === true && p.checks.no_inquiries === true));
  });

  test("a business grows older too: its age band, its multiplier and its figure follow the months, never backwards", async () => {
    const files = cleanFile({
      tradelines: [CARD("a1", "CHASE", "1000000", "100000", ago(14)), CARD("a2", "AMEX", "800000", "100000", ago(14)), CARD("a3", "CAPITAL ONE", "600000", "50000", ago(14))],
      card_liabilities: CURRENT_OF(["a1", "a2", "a3"]),
      businesses: [{ id: "b1", client_id: CID, org_id: ORG, name: "Alpha LLC", age_months: 18, entity_data: { name: "Alpha LLC", naics: "541511" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    }, { business_age_months: 18 });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    const [alpha] = res.body.businesses;
    assert.equal(alpha.age_months, 18);
    assert.equal(alpha.now.multiplier, 1, "under 24 months");
    assert.deepEqual(alpha.projections.map((p) => p.multiplier), [1, 2, 2], "21, 24 and 30 months old");
    assert.deepEqual(alpha.projections.map((p) => p.checks.age_24), [false, true, true]);
    assert.deepEqual(alpha.projections.map((p) => p.funding_estimate_cents), [null, null, 11000000], "the card figure x 2 once a card counts");
    assert.deepEqual(alpha.projections.map((p) => p.assumptions.find((t) => /months old/.test(t))),
      ["Alpha LLC is 21 months old.", "Alpha LLC is 24 months old.", "Alpha LLC is 30 months old."]);
    assert.equal(alpha.now.funding_estimate_cents, null);
    // Its five checks are counted on their own: the personal file's gate, the personal anchor card, its age, its name, its industry code.
    assert.deepEqual(alpha.now.factors.map((f) => [f.key, f.passed]), [
      ["personal_fundable", true], ["anchor_card", false], ["age_24", false], ["name_on_file", true], ["naics_on_file", true],
    ]);
    assert.equal(alpha.now.score, 3);
    assert.deepEqual(alpha.projections.map((p) => p.score), [3, 4, 5]);
    assert.deepEqual(alpha.projections.map((p) => p.checks.anchor_card), [false, false, true], "no personal anchor card, no business slice");
    assert.deepEqual(alpha.projections.map((p) => p.checks.personal_fundable), [true, true, true]);
    assert.deepEqual(alpha.projections.map((p) => p.tier), ["not_fundable", "not_fundable", "fundable"]);
    // A business with no age of its own takes the client's own age on file, and ages from there.
    const fallbackFiles = cleanFile({
      tradelines: [CARD("a1", "CHASE", "1000000", "100000", ago(40)), CARD("a2", "AMEX", "800000", "100000", ago(40)), CARD("a3", "CAPITAL ONE", "600000", "50000", ago(40))],
      card_liabilities: CURRENT_OF(["a1", "a2", "a3"]),
      businesses: [{ id: "b2", client_id: CID, org_id: ORG, name: "Beta LLC", age_months: null, entity_data: { name: "Beta LLC", naics: "541511" }, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
    }, { business_age_months: 20 });
    const fb = await call({ query: { client_id: CID }, principal: staff(), files: fallbackFiles });
    const [beta] = fb.res.body.businesses;
    assert.equal(beta.age_months, 20, "the client's own figure on file");
    assert.deepEqual(beta.projections.map((p) => p.multiplier), [1, 2, 2], "23, 26 and 32 months");
  });

  test("a paydown in the client's own plan lowers that card's use only at the points on or after its due date", async () => {
    const due = addMonths(TODAY, 4);
    const waypoint = (key, creditor, target, state = "not_started", dueAt = `${due}T12:00:00Z`) => ({
      client_id: CID, org_id: ORG, key, state, due_at: dueAt, verify_kind: "paydown", position: 1,
      params: { definition_key: "paydown_revolving_account", creditor, creditor_key: creditor.toLowerCase().replace(/\W+/g, "_"), target_cents: target, account_prints: [] },
    });
    const files = cleanFile({
      tradelines: [CARD("a1", "CHASE", "1000000", "400000", ago(40)), CARD("a2", "AMEX", "800000", "400000", ago(40)), CARD("a3", "CAPITAL ONE", "600000", "300000", ago(40))],
      card_liabilities: CURRENT_OF(["a1", "a2", "a3"]),
      client_waypoints: [
        waypoint("paydown_chase", "CHASE", 100000),
        waypoint("paydown_amex", "AMEX", 80000),
        waypoint("paydown_capone", "CAPITAL ONE", 0, "skipped"),               // not the plan any more: never applied
        waypoint("paydown_nodate", "CAPITAL ONE", 0, "not_started", null),     // no date: listed, never applied
      ],
    });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.now.factors.find((f) => f.key === "utilization_30").passed, false);
    assert.equal(res.body.now.factors.find((f) => f.key === "utilization_30").value, 45.8);
    const points = plan(res);
    assert.deepEqual(points.map((p) => p.checks.utilization_30), [false, true, true], "the paydowns are due after +3 and before +6");
    assert.deepEqual(points.map((p) => p.tier), ["not_fundable", "fundable", "fundable"]);
    assert.deepEqual(points.map((p) => p.funding_estimate_cents), [null, 5500000, 5500000]);
    assert.equal(points[0].assumptions.filter((t) => /You pay/.test(t)).length, 0);
    assert.equal(points[1].assumptions.filter((t) => /You pay/.test(t)).length, 2, "Chase and Amex only");
    assert.ok(points[1].assumptions.some((t) => /You pay CHASE down to \$1,000/.test(t)));
    assert.ok(points[1].assumptions.some((t) => /You pay AMEX down to \$800/.test(t)));
    assert.equal(points[1].assumptions.some((t) => /CAPITAL ONE/.test(t)), false);
    assert.deepEqual(res.body.plan.paydowns.map((p) => [p.creditor, p.target_cents, p.state]).sort(),
      [["AMEX", 80000, "not_started"], ["CAPITAL ONE", 0, "not_started"], ["CHASE", 100000, "not_started"]]);
  });

  test("a dispute plan draws a separate if-removed line from the open derogatory items only, and says it is not promised", async () => {
    const item = (id, rule, status, creditor, last4) => ({ id, client_id: CID, org_id: ORG, rule_id: rule, status, creditor, account_last4: last4 });
    const files = cleanFile({
      tradelines: [CARD("a1", "CHASE", "1000000", "100000", ago(40)), CARD("a2", "AMEX", "800000", "100000", ago(40)), CARD("a3", "CAPITAL ONE", "600000", "50000", ago(40))],
      card_liabilities: CURRENT_OF(["a1", "a2", "a3"]),
      dispute_items: [
        item("d1", "DEROG-COLLECTION", "open", "Midland Credit", "1111"),
        item("d2", "DEROG-CHARGEOFF", "sent", "Portfolio Recovery", "2222"),
        item("d2b", "DEROG-CHARGEOFF", "sent", "Portfolio Recovery", "2222"),   // the same account again: one account
        item("d3", "DEROG-CHARGEOFF", "closed", "Old Debt", "3333"),            // finished: not in play
        item("d4", "MET2-ACCOUNT-STATUS", "open", "Metro Only", "4444"),        // a format check, not a derogatory claim
      ],
    }, { crs_negative_items_count: 2 });
    const { res } = await call({ query: { client_id: CID }, principal: staff(), files });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.plan, { paydowns: [], dispute_accounts: 2, if_removed: true });
    assert.equal(res.body.now.factors.find((f) => f.key === "no_negatives").passed, false);
    assert.equal(res.body.now.tier, "not_fundable");
    assert.deepEqual(plan(res).map((p) => p.checks.no_negatives), [false, false, false], "the plan line does not assume a removal");
    const removed = res.body.projections.filter((p) => p.scenario === "if_removed");
    assert.deepEqual(removed.map((p) => p.months), [3, 6, 12]);
    assert.deepEqual(removed.map((p) => p.checks.no_negatives), [true, true, true], "2 negatives, 2 accounts targeted, 0 left");
    assert.deepEqual(removed.map((p) => p.tier), ["fundable", "fundable", "fundable"]);
    assert.deepEqual(removed.map((p) => p.funding_estimate_cents), [5500000, 5500000, 5500000]);
    assert.ok(removed.every((p) => p.assumptions.some((t) => /targets 2 negative accounts.*go from 2 to 0.*not promised/.test(t))));
    assert.ok(plan(res).every((p) => !p.assumptions.some((t) => /dispute plan/.test(t))));

    // With no measured negatives count there is nothing for the line to say, and with none targeted there is no line.
    const unknown = cleanFile({ tradelines: files.tables.tradelines, card_liabilities: files.tables.card_liabilities, dispute_items: files.tables.dispute_items }, { crs_negative_items_count: null });
    const u = await call({ query: { client_id: CID }, principal: staff(), files: unknown });
    assert.equal(u.res.body.plan.if_removed, false);
    assert.equal(u.res.body.projections.some((p) => p.scenario === "if_removed"), false);
    const none = cleanFile({ tradelines: files.tables.tradelines, card_liabilities: files.tables.card_liabilities }, { crs_negative_items_count: 2 });
    const n = await call({ query: { client_id: CID }, principal: staff(), files: none });
    assert.equal(n.res.body.plan.if_removed, false);
    assert.equal(n.res.body.plan.dispute_accounts, 0);
  });

  test("the projected copy of the file moves every account and the business age forward by the months, and leaves the file it was given alone", () => {
    const base = {
      lines: [{ id: "x", opened_on: "2024-01-15", balance_cents: 100, credit_limit_cents: 1000, kind: "revolving" }],
      customFields: { business_age_months: 18, crs_negative_items_count: 1 },
      businesses: [{ id: "b", age_months: 10 }, { id: "c", age_months: null }],
    };
    const copy = JSON.parse(JSON.stringify(base));
    const { input, notes } = projectFile(base, { months: 6, date: addMonths(TODAY, 6) });
    assert.equal(input.lines[0].opened_on, "2023-07-15", "an account 6 months older opened 6 months earlier");
    assert.equal(input.customFields.business_age_months, 24, "the age on the client's file moves with the months");
    assert.deepEqual(input.businesses.map((b) => b.age_months), [16, null], "a business with no age stays unknown");
    assert.equal(input.customFields.crs_negative_items_count, 1, "nothing else is touched");
    assert.deepEqual(base, copy, "the base file is never changed");
    assert.deepEqual(notes.map((n) => n.kind), ["time", "business_age"]);
  });
});
