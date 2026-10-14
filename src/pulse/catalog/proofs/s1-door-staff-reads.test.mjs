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
  ORG_ID, accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const RULE_ID = "2e000000-0000-4000-8000-000000000001";
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

async function run(handler, request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

test("commission-rules GET lists the company's effective-dated rules with tiers, finance roles only", async () => {
  assert.equal(ROUTES["commission-rules"], commissionRules);
  const rule = {
    id: RULE_ID, name: "Closer base", calc_method: "percent", percent: "10", effective_from: "2026-01-01",
    effective_to: null, tiers: [],
  };
  const { res, fake } = await run(commissionRules, req("GET"), [
    staffSession({ role: "sales_manager" }),
    [/FROM commission_rules r/, [rule]],
  ]);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, count: 1, rules: [rule] });
  assert.deepEqual(fake.find(/FROM commission_rules r/)[0].params, [ORG_ID]);

  const closer = await run(commissionRules, req("GET"), [staffSession({ role: "closer" })]);
  assert.equal(closer.res.statusCode, 403);
  assert.equal(closer.fake.find(/FROM commission_rules/).length, 0);
});

function supersedeRules(old) {
  return [
    staffSession(),
    [/FOR UPDATE/, [old]],
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

const KPI_RULES = [
  [/FROM transactions/, [{ dollars: "606.50" }]],
  [/FROM funding_rounds/, [{ n: 2, dollars: "150000" }]],
  [/name = 'booking\.created'/, [{ n: 10 }]],
  [/name = 'call\.completed'/, [{ n: 7 }]],
  [/name = 'decision\.rendered'/, [{ n: 4 }]],
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
    [/SUM\(cash_collected_cents\), 0\)::bigint AS cents\s+FROM call_outcomes/, [{ cents: "2500000" }]],
    [/count\(\*\) FILTER \(WHERE outcome <> 'no_show'\)::int AS held/, [{ held: 8, deposits: 3, downsells: 1, downsell_cents: "40000" }]],
    [/name = 'booking\.created'/, [{ n: 12 }]],
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
  assert.ok(fake.find(/FROM call_outcomes/).every((c) => c.params[0] === ORG_ID), "every read is the session's company");

  const closer = await run(salesFloor, req("GET"), [staffSession({ role: "closer" })]);
  assert.equal(closer.res.statusCode, 403);
  assert.equal(closer.fake.find(/FROM call_outcomes/).length, 0);
});

test("read/funding-rounds lists submitted, approved and funded amounts for the session's company, filtered by client and status", async () => {
  assert.equal(ROUTES["read/funding-rounds"], fundingRounds);
  const round = {
    id: "f0000000-0000-4000-8000-000000000001", client_id: CLIENT_ID, round_number: 2, status: "funded",
    product: "card_stacking", submitted_amount: "80000", approved_amount: "60000", funded_amount: "55000",
    hold_reason: null, conditions: null, created_at: "2026-10-01T00:00:00Z",
  };
  const { res, fake } = await run(
    fundingRounds,
    req("GET", { query: { client_id: CLIENT_ID, status: "funded" } }),
    [staffSession({ role: "funding_advisor" }), [/FROM funding_rounds/, [round]]],
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.items[0].funded_amount, "55000");
  assert.equal(res.body.items[0].approved_amount, "60000");
  assert.equal(res.body.items[0].submitted_amount, "80000");
  assert.deepEqual(fake.find(/FROM funding_rounds/)[0].params, [51, 0, CLIENT_ID, "funded", ORG_ID]);

  const anon = await run(fundingRounds, { method: "GET", query: {}, headers: {} }, []);
  assert.equal(anon.res.statusCode, 401);
});

test("read/partners shows each partner's accrued balance; staff see their company, a partner sees only their own row", async () => {
  assert.equal(ROUTES["read/partners"], partners);
  const row = { id: "9a000000-0000-4000-8000-000000000001", slug: "acme", name: "Acme", status: "active",
    revenue_share_pct: "20", agreement_signed: true, balance_accrued: "1250.00", total_paid: "400.00", open_accruals: 3 };

  const staff = await run(partners, req("GET"), [staffSession({ role: "admin" }), [/FROM v_partner_balance v/, [row]]]);
  assert.equal(staff.res.statusCode, 200);
  assert.equal(staff.res.body.items[0].balance_accrued, "1250.00");
  assert.equal(staff.res.body.items[0].revenue_share_pct, "20");
  const [staffRead] = staff.fake.find(/FROM v_partner_balance v/);
  assert.equal(staffRead.params.at(-1), ORG_ID, "staff are pinned to their own company");
  assert.equal(staffRead.params.at(-2), false, "and are not treated as a partner");

  const partnerId = "9a000000-0000-4000-8000-000000000001";
  const own = await run(partners, req("GET"), [
    ...accountSession({ kind: "partner", partnerId }),
    [/FROM v_partner_balance v/, [row]],
  ]);
  assert.equal(own.res.statusCode, 200);
  const [partnerRead] = own.fake.find(/FROM v_partner_balance v/);
  assert.ok(partnerRead.params.includes(partnerId), "the partner's own id is bound into the read");
  assert.equal(partnerRead.params.at(-1), null, "no company lookup replaces the partner's own scope");

  const closer = await run(partners, req("GET"), [staffSession({ role: "closer" })]);
  assert.equal(closer.res.statusCode, 403);
});
