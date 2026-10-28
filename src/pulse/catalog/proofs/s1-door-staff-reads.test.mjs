// Slice 1 (money routes): the staff money reads and the commission-rate write.
// Each test runs the REAL api/ handler against a stand-in database and judges
// the exact business result the catalog row names. No live database, no vendor.
import assert from "node:assert/strict";
import test from "node:test";

import commissionRules from "../../../../api/commission-rules.mjs";
import kpis from "../../../../api/dashboard/kpis.mjs";
import fundingRounds from "../../../../api/read/funding-rounds.mjs";
import partners from "../../../../api/read/partners.mjs";
import salesFloor from "../../../../api/read/sales-floor.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, OTHER_ORG_ID, accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { STAFF_ROLES, clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

const RULE_ID = "2e000000-0000-4000-8000-000000000001";
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

async function run(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const FINANCE_ROLES = ["admin", "owner", "sales_manager"];

test("commission-rules GET lists only this company's effective-dated rules with tiers, and only owner, admin and sales manager get in", async () => {
  assert.equal(ROUTES["commission-rules"], commissionRules);
  const rule = {
    id: RULE_ID, org_id: ORG_ID, name: "Closer base", calc_method: "percent", percent: "10", effective_from: "2026-01-01",
    effective_to: null, tiers: [],
  };
  const otherCompany = { ...rule, id: "2e000000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG_ID, name: "Other company rule" };
  const rulesRead = [/FROM commission_rules r/, shelf([otherCompany, rule], [clause(/WHERE r\.org_id = \$1::uuid/, (row, [org]) => row.org_id === org)])];
  const { res, fake } = await run(commissionRules, req("GET"), [staffSession({ role: "sales_manager" }), rulesRead]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, count: 1, rules: [rule] }, "the other company's rule is not listed");
  assert.deepEqual(fake.find(/FROM commission_rules r/)[0].params, [ORG_ID]);

  const letIn = await rolesLetIn(async (role) => (await run(commissionRules, req("GET"), [staffSession({ role }), rulesRead])).res.statusCode);
  assert.deepEqual(letIn, FINANCE_ROLES);
});

function supersedeRules(old) {
  const lookup = shelf([old], [
    clause(/WHERE id = \$1::uuid/, (row, [id]) => row.id === id),
    clause(/AND org_id = \$2::uuid/, (row, [, org]) => row.org_id === org),
  ]);
  return [
    staffSession(),
    [/FOR UPDATE/, lookup],
    [/UPDATE commission_rules\s+SET effective_to/, [{ id: RULE_ID, effective_from: old.effective_from, effective_to: "2026-11-01T00:00:00.000Z" }]],
    [/INSERT INTO commission_rules/, (sql, params) => [{ id: "2e000000-0000-4000-8000-000000000002", percent: params[9], effective_from: params[16], notes: params[18] }]],
  ];
}

const OLD_RULE = {
  id: RULE_ID, org_id: ORG_ID, name: "Closer base", basis: "cash", stacking: "stack", calc_method: "percent",
  percent: "10", flat_amount: null, effective_from: "2026-01-01T00:00:00.000Z", effective_to: null, active: true, notes: "old",
};

test("commission-rules POST closes the old rate and opens the new one from the same instant, with the reason", async () => {
  const { res, fake } = await run(commissionRules, req("POST", {
    body: { rule_id: RULE_ID, effective_from: "2026-11-01", rate: 12, reason: "  Raised for Q4  " },
  }), supersedeRules(OLD_RULE));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.closed.effective_to, "2026-11-01T00:00:00.000Z");
  assert.equal(res.body.rule.percent, 12, "the new rule carries the new rate");
  assert.equal(res.body.rule.effective_from, "2026-11-01T00:00:00.000Z", "it opens exactly where the old one closed");
  assert.equal(res.body.rule.notes, "Raised for Q4", "the reason is trimmed and kept on the new row");
  const [close] = fake.find(/UPDATE commission_rules\s+SET effective_to/);
  assert.deepEqual(close.params, [RULE_ID, "2026-11-01T00:00:00.000Z"]);
  assert.equal(fake.count("BEGIN"), 1);
  assert.equal(fake.count("COMMIT"), 1);
  assert.equal(fake.count("ROLLBACK"), 0);
});

test("commission-rules POST refuses a missing reason, a tiered rule, an earlier date and a bad rate; nothing is written", async () => {
  const refused = async (body, rules, want) => {
    const { res, fake } = await run(commissionRules, req("POST", { body }), rules);
    assert.equal(res.statusCode, want.status, JSON.stringify(body));
    assert.equal(res.body.error, want.error);
    assert.equal(fake.find(/INSERT INTO commission_rules/).length, 0);
    assert.equal(fake.count("COMMIT"), 0);
  };
  const ok = { rule_id: RULE_ID, effective_from: "2026-11-01", rate: 12, reason: "why" };
  await refused({ ...ok, reason: " " }, [staffSession()], { status: 400, error: "reason_required" });
  await refused({ ...ok }, supersedeRules({ ...OLD_RULE, calc_method: "tiered" }), { status: 400, error: "tier_editor_not_ready" });
  await refused({ ...ok, effective_from: "2025-12-01" }, supersedeRules(OLD_RULE), { status: 400, error: "invalid_effective_from" });
  await refused({ ...ok, rate: -3 }, supersedeRules(OLD_RULE), { status: 400, error: "invalid_rate" });
  await refused({ ...ok }, supersedeRules({ ...OLD_RULE, effective_to: "2026-06-01" }), { status: 409, error: "rule_already_closed" });
});

test("commission-rules POST will not change another company's rule, and only owner, admin and sales manager may change a rate", async () => {
  const body = { rule_id: RULE_ID, effective_from: "2026-11-01", rate: 12, reason: "why" };
  const theirs = await run(commissionRules, req("POST", { body }), supersedeRules({ ...OLD_RULE, org_id: OTHER_ORG_ID }));
  assert.equal(theirs.res.statusCode, 404);
  assert.equal(theirs.res.body.error, "not_found");
  assert.equal(theirs.fake.find(/UPDATE commission_rules|INSERT INTO commission_rules/).length, 0);

  const letIn = await rolesLetIn(async (role) => {
    const rules = supersedeRules(OLD_RULE);
    rules[0] = staffSession({ role });
    return (await run(commissionRules, req("POST", { body }), rules)).res.statusCode;
  });
  assert.deepEqual(letIn, FINANCE_ROLES);
});

const KPI_RULES = [
  [/FROM transactions/, [{ dollars: "606.50" }]],
  [/FROM funding_rounds/, [{ n: 2, dollars: "150000" }]],
  [/name = 'booking\.created'/, [{ n: 10 }]],
  [/name = 'call\.completed'/, [{ n: 7 }]],
  [/name = 'decision\.rendered'/, [{ n: 4 }]],
  [/FROM sale_payments sp/, [{ n: 4 }]],
  [/FROM clients c/, [{ n: 5 }]],
  [/FROM ad_metrics_daily/, [{ cents: "200000" }]],
  [/FROM cards cd/, [{ n: 9 }]],
];

test("dashboard/kpis turns dollars into cents once and states cash, funded, rates and cost per funded", async () => {
  assert.equal(ROUTES["dashboard/kpis"], kpis);
  const { res, fake } = await run(kpis, req("GET", { query: { period: "30d" } }), [staffSession(), ...KPI_RULES]);
  assert.equal(res.statusCode, 200);
  const k = res.body.kpis;
  assert.equal(k.cash_collected_cents, 60650);
  assert.equal(k.funded_count, 2);
  assert.equal(k.funded_amount_cents, 15000000);
  assert.equal(k.show_rate, 0.7);
  assert.equal(k.close_rate, 0.4);
  assert.equal(k.cost_per_funded_cents, 100000, "$2,000 of spend over 2 funded clients");
  assert.deepEqual(res.body.display, {
    cash: "$606.50", funded: "2", funded_amount: "$150k", close: "40%", show: "70%",
    cpf: "$1,000", clients: "5", pipeline_movement: "9",
  });
  assert.deepEqual(fake.find(/FROM transactions/)[0].params, [ORG_ID, 30]);
});

test("dashboard/kpis says unknown, not zero, when spend or bookings are missing; a bad period is refused", async () => {
  const noSpend = KPI_RULES.map(([m, a]) => (String(m).includes("ad_metrics_daily") ? [m, [{ cents: null }]] : [m, a]));
  const none = await run(kpis, req("GET"), [staffSession(), ...noSpend.filter(([m]) => !String(m).includes("booking"))]);
  assert.equal(none.res.statusCode, 200);
  assert.equal(none.res.body.kpis.cost_per_funded_cents, null);
  assert.equal(none.res.body.kpis.cost_per_funded_reason, "ad_spend_unavailable");
  assert.equal(none.res.body.kpis.show_rate, null);
  assert.equal(none.res.body.display.cpf, "—");
  assert.equal(none.res.body.display.show, "—");

  const bad = await run(kpis, req("GET", { query: { period: "forever" } }), [staffSession()]);
  assert.equal(bad.res.statusCode, 400);
  assert.equal(bad.res.body.error, "invalid_period");
  assert.deepEqual(bad.res.body.allowed, ["today", "7d", "30d", "qtd"]);
});

test("read/sales-floor totals the month's cash, deposits, held calls and bookings for finance roles only", async () => {
  assert.equal(ROUTES["read/sales-floor"], salesFloor);
  const rules = [
    staffSession({ role: "sales_manager" }),
    [/SUM\(o\.cash_collected_cents\), 0\)::bigint AS cents\s+FROM call_outcomes o\s+JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id/, [{ cents: "2500000" }]],
    [/count\(\*\) FILTER \(WHERE o.outcome <> 'no_show'\)::int AS held/, [{ held: 8, deposits: 3, downsells: 1, downsell_cents: "40000" }]],
    [/e.name = 'booking\.created'/, [{ n: 12 }]],
    [/FROM staff_targets/, [{ target_value: "50000" }]],
  ];
  const { res, fake } = await run(salesFloor, req("GET"), rules);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.hero.cash_cents, 2500000);
  assert.equal(res.body.hero.cash_display, "$25,000");
  assert.equal(res.body.hero.target_cents, 5000000);
  assert.equal(res.body.funnel.booked, 12);
  assert.equal(res.body.funnel.held, 8);
  assert.equal(res.body.funnel.deposits, 3);
  assert.equal(res.body.funnel.downsells, 1);
  assert.equal(res.body.funnel.show_rate, 8 / 12);
  assert.equal(res.body.funnel.close_rate, 3 / 8);
  // Preserve proof of the new live-only boundary, not just the canned totals.
  assert.ok(fake.find(/FROM call_outcomes o/).every((q) =>
    /JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id/.test(q.sql)
    && /COALESCE\(o.is_demo, false\) = false/.test(q.sql)
    && /COALESCE\(c.is_demo, false\) = false/.test(q.sql)),
  "team totals exclude demo calls and clients by same-company join");
  assert.ok(fake.find(/FROM events e/).some((q) =>
    /COALESCE\(e.payload->>'simulated', 'false'\) <> 'true'/.test(q.sql)
    && /COALESCE\(c.is_demo, false\) = false/.test(q.sql)),
  "bookings exclude synthetic events and clients");
  assert.ok(fake.find(/FROM call_outcomes/).every((c) => c.params[0] === ORG_ID), "every read is the session's company");

  const closer = await run(salesFloor, req("GET"), [staffSession({ role: "closer" })]);
  assert.equal(closer.res.statusCode, 403);
  assert.equal(closer.fake.find(/FROM call_outcomes/).length, 0);

  const letIn = await rolesLetIn(async (role) => (await run(salesFloor, req("GET"), [staffSession({ role }), ...rules.slice(1)])).res.statusCode);
  assert.deepEqual(letIn, FINANCE_ROLES, "owner, admin and sales manager only");
});

test("read/funding-rounds lists submitted, approved and funded amounts for the session's company only, filtered by client and status", async () => {
  assert.equal(ROUTES["read/funding-rounds"], fundingRounds);
  const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
  const round = (id, over) => ({
    id, org_id: ORG_ID, client_id: CLIENT_ID, round_number: 2, status: "funded",
    product: "card_stacking", submitted_amount: "80000", approved_amount: "60000", funded_amount: "55000",
    hold_reason: null, conditions: null, created_at: "2026-10-01T00:00:00Z", ...over,
  });
  const mine = round("f0000000-0000-4000-8000-000000000001", {});
  const books = [
    mine,
    round("f0000000-0000-4000-8000-000000000002", { org_id: OTHER_ORG_ID }),
    round("f0000000-0000-4000-8000-000000000003", { client_id: OTHER_CLIENT }),
    round("f0000000-0000-4000-8000-000000000004", { status: "submitted", funded_amount: null }),
  ];
  const read = [/FROM funding_rounds/, shelf(books, [
    clause(/WHERE org_id = \$(\d+)::uuid/, (row, p, m) => row.org_id === p[m[1] - 1]),
    clause(/\(\$(\d+)::uuid IS NULL OR client_id = \$\d+\)/, (row, p, m) => p[m[1] - 1] == null || row.client_id === p[m[1] - 1]),
    clause(/\(\$(\d+)::text IS NULL OR status = \$\d+\)/, (row, p, m) => p[m[1] - 1] == null || row.status === p[m[1] - 1]),
  ])];
  const { res, fake } = await run(
    fundingRounds,
    req("GET", { query: { client_id: CLIENT_ID, status: "funded" } }),
    [staffSession({ role: "funding_advisor" }), read],
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1, "not the other company's round, not another client's, not another status");
  assert.equal(res.body.items[0].id, mine.id);
  assert.equal(res.body.items[0].funded_amount, "55000");
  assert.equal(res.body.items[0].approved_amount, "60000");
  assert.equal(res.body.items[0].submitted_amount, "80000");
  assert.deepEqual(fake.find(/FROM funding_rounds/)[0].params, [51, 0, CLIENT_ID, "funded", ORG_ID]);

  const everyone = await run(fundingRounds, req("GET"), [staffSession({ role: "funding_advisor" }), read]);
  assert.deepEqual(everyone.res.body.items.map((r) => r.id).sort(), books.filter((r) => r.org_id === ORG_ID).map((r) => r.id).sort());

  const anon = await run(fundingRounds, { method: "GET", query: {}, headers: {} }, []);
  assert.equal(anon.res.statusCode, 401);

  const letIn = await rolesLetIn(async (role) => (await run(fundingRounds, req("GET"), [staffSession({ role }), read])).res.statusCode);
  assert.deepEqual(letIn, [...STAFF_ROLES].sort(), "every staff role may read funding rounds");
});

test("read/partners shows each partner's accrued balance; staff see their company only, a partner sees only their own row", async () => {
  assert.equal(ROUTES["read/partners"], partners);
  const MINE = "9a000000-0000-4000-8000-000000000001";
  const THEIRS = "9a000000-0000-4000-8000-000000000002";
  const row = (id, org, name, balance) => ({
    partner_id: id, org_id: org, slug: name.toLowerCase(), name, status: "active", revenue_share_pct: "20",
    agreement_signed: true, balance_accrued: balance, total_paid: "400.00", open_accruals: 3,
  });
  const books = [
    row(MINE, ORG_ID, "Acme", "1250.00"),
    row(THEIRS, ORG_ID, "Beta", "90.00"),
    row("9a000000-0000-4000-8000-000000000009", OTHER_ORG_ID, "Zed", "5.00"),
  ];
  const read = [/FROM v_partner_balance v/, (sql, p) => shelf(books, [
    clause(/\(\$(\d+)::boolean OR v\.org_id = \$(\d+)::uuid\)/, (r, params, m) => params[m[1] - 1] === true || r.org_id === params[m[2] - 1]),
    clause(/v\.partner_id = \$(\d+)/, (r, params, m) => r.partner_id === params[m[1] - 1]),
  ])(sql, p).map((r) => ({ ...r, id: r.partner_id }))];

  const staff = await run(partners, req("GET"), [staffSession({ role: "admin" }), read]);
  assert.equal(staff.res.statusCode, 200);
  assert.deepEqual(staff.res.body.items.map((r) => r.name), ["Acme", "Beta"], "their company's partners, not another company's");
  assert.equal(staff.res.body.items[0].balance_accrued, "1250.00");
  assert.equal(staff.res.body.items[0].revenue_share_pct, "20");
  const [staffRead] = staff.fake.find(/FROM v_partner_balance v/);
  assert.equal(staffRead.params.at(-1), ORG_ID);
  assert.equal(staffRead.params.at(-2), false, "and are not treated as a partner");

  const own = await run(partners, req("GET"), [...accountSession({ kind: "partner", partnerId: MINE }), read]);
  assert.equal(own.res.statusCode, 200);
  assert.deepEqual(own.res.body.items.map((r) => r.name), ["Acme"], "a partner sees their own row and no other partner's");
  const [partnerRead] = own.fake.find(/FROM v_partner_balance v/);
  assert.ok(partnerRead.params.includes(MINE), "the partner's own id is bound into the read");

  const letIn = await rolesLetIn(async (role) => (await run(partners, req("GET"), [staffSession({ role }), read])).res.statusCode);
  assert.deepEqual(letIn, FINANCE_ROLES);
});
