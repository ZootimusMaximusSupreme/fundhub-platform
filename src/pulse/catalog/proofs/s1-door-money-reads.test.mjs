// Slice 1 (money routes): the finance roll-up, the affiliate portal read, and
// the queue that loads approved ad videos into Meta (PAUSED, never Meta itself).
// Real api/ handlers on a stand-in database.
import assert from "node:assert/strict";
import test from "node:test";

import affiliatePortal from "../../../../api/read/affiliate-portal.mjs";
import financeCommand from "../../../../api/read/finance-command.mjs";
import metaLoad from "../../../../api/marketing/meta/load.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const AFFILIATE_ID = "af000000-0000-4000-8000-000000000001";
const VIDEO_ID = "ad000000-0000-4000-8000-000000000001";

async function run(handler, request, rules, deps) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res, deps));
  return { res, fake };
}

// ── read/finance-command ──────────────────────────────────────────────────
const COMMAND_RULES = [
  [/FROM bank_accounts WHERE org_id/, [
    { id: "b1", client_id: CLIENT_ID, entity_id: null, account_type: "checking", current_balance_cents: "250000", closed_at: null },
    { id: "b2", client_id: CLIENT_ID, entity_id: null, account_type: "savings", current_balance_cents: "50000", closed_at: null },
    { id: "b3", client_id: CLIENT_ID, entity_id: null, account_type: "checking", current_balance_cents: "999999", closed_at: "2026-01-01" },
  ]],
  [/FROM tradelines WHERE org_id/, [
    { client_id: CLIENT_ID, entity_id: null, lender: "Chase", credit_limit_cents: "1000000", current_balance_cents: "200000", closed_at: null },
    { client_id: CLIENT_ID, entity_id: null, lender: "Amex", credit_limit_cents: "500000", current_balance_cents: "100000", closed_at: null },
  ]],
  [/FROM investment_holdings ih/, [{ current_value_cents: "75000" }]],
  [/FROM bank_transactions/, [{ day: "2026-10-12", inflow_cents: "120000", outflow_cents: "45000" }]],
  [/FROM ad_metrics_daily m/, [{ day: "2026-10-12", spend_cents: "30000" }]],
];

test("read/finance-command rolls up cash, credit available and owed, investments and spend; a closed account is left out", async () => {
  assert.equal(ROUTES["read/finance-command"], financeCommand);
  const { res, fake } = await run(financeCommand, req("GET", { query: { days: "7" } }), [staffSession({ role: "funding_advisor" }), ...COMMAND_RULES],
    { now: () => new Date("2026-10-13T12:00:00Z") });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const t = res.body.totals;
  assert.equal(t.cash_cents, 300000, "checking plus savings, the closed account is not counted");
  assert.equal(t.credit_available_cents, 1500000);
  assert.equal(t.credit_owed_cents, 300000);
  assert.equal(t.utilization_overall, 0.2);
  assert.equal(t.investment_cents, 75000);
  assert.equal(res.body.net_worth_today_cents, 300000 + 75000 - 300000);
  assert.equal(res.body.net_worth_trend_available, false);
  assert.deepEqual(res.body.window, { from: "2026-10-07", to: "2026-10-13", days: 7 });
  assert.equal(res.body.cashflow_series[0].net_cents, 75000);
  assert.equal(res.body.marketing_series[0].spend_cents, 30000);
  const combined = res.body.combined_series.find((r) => r.date === "2026-10-12");
  assert.equal(combined.outflow_cents, 75000, "cash out includes marketing spend on the business-wide view");
  assert.ok(fake.find(/FROM bank_accounts/).every((c) => c.params[0] === ORG_ID), "every read carries the session's company");
});

test("read/finance-command scoped to one client keeps spend separate, and refuses a client from another company", async () => {
  const owned = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ one: 1 }]];
  const scoped = await run(financeCommand, req("GET", { query: { client_id: CLIENT_ID } }),
    [staffSession(), owned, ...COMMAND_RULES], { now: () => new Date("2026-10-13T12:00:00Z") });
  assert.equal(scoped.res.statusCode, 200);
  assert.equal(scoped.res.body.combined_series, null);
  assert.match(scoped.res.body.combined_series_unavailable_reason, /cannot be attributed to one client/);
  assert.deepEqual(scoped.fake.find(/FROM bank_accounts/)[0].params, [ORG_ID, CLIENT_ID]);

  const other = await run(financeCommand, req("GET", { query: { client_id: CLIENT_ID } }),
    [staffSession(), [/SELECT 1 FROM clients/, []], ...COMMAND_RULES]);
  assert.equal(other.res.statusCode, 404);
  assert.equal(other.fake.find(/FROM bank_accounts/).length, 0);
});

// ── read/affiliate-portal ─────────────────────────────────────────────────
function affiliateAccount(affiliateId) {
  return [
    [/UPDATE account_sessions s/, [{
      id: "5e000000-0000-4000-8000-000000000002", account_id: "ac000000-0000-4000-8000-000000000001", org_id: ORG_ID,
      expires_at: new Date(Date.now() + 3600e3).toISOString(), active_client_id: null,
    }]],
    [/FROM accounts WHERE id = \$1/, [{
      id: "ac000000-0000-4000-8000-000000000001", org_id: ORG_ID, kind: "affiliate", email: "aff@example.test",
      name: "Aff", status: "active", client_id: null, affiliate_id: affiliateId, partner_id: null,
    }]],
  ];
}

const PORTAL_ROWS = [
  [/FROM affiliates\s+WHERE id = \$1 AND org_id = \$2/, [{
    id: AFFILIATE_ID, name: "Mike", tracking_id: "mike01", status: "active", tier_level: "tier1",
    partner_license_signed_at: null, tax_form_received_at: "2026-09-01T00:00:00Z", balance_due: "125.50",
  }]],
  [/FROM affiliate_commission_rules r/, [
    { tier: "direct", calc_method: "percent", percent: "20", name: "Direct", affiliate_id: null },
    { tier: "downline", calc_method: "percent", percent: "5", name: "Downline", affiliate_id: null },
  ]],
  [/FROM affiliate_referrals r\s+JOIN clients/, [{
    id: "ae000000-0000-4000-8000-000000000001", tier: "direct", status: "converted", first_name: "Sarah", last_name: "Lee",
    commission_due: "100.00", basis_amount: "500.00", product_name: "Repair",
  }]],
  [/FROM affiliate_payouts po/, [{ id: "b1", amount: "25.50", currency: "USD", status: "held", hold_reason: "license_unsigned", line_count: "2" }]],
];

test("read/affiliate-portal shows an affiliate their own referrals, rates, payouts and the license and tax gates", async () => {
  assert.equal(ROUTES["read/affiliate-portal"], affiliatePortal);
  const { res, fake } = await run(affiliatePortal, req("GET"), [...affiliateAccount(AFFILIATE_ID), ...PORTAL_ROWS], { env: {} });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.enrolled, true);
  assert.equal(res.body.affiliate.code, "mike01");
  assert.equal(res.body.affiliate.balanceDue, 125.5);
  assert.equal(res.body.rates.direct.percent, 20);
  assert.equal(res.body.rates.downline.percent, 5);
  assert.deepEqual(res.body.referrals.map((r) => [r.name, r.commissionDue, r.basisAmount]), [["Sarah Lee", 100, 500]]);
  assert.deepEqual(res.body.payouts.map((p) => [p.amount, p.status, p.holdReason, p.lineCount]), [[25.5, "held", "license_unsigned", 2]]);
  assert.equal(res.body.gates.license.signed, false, "unsigned license holds the payout");
  assert.equal(res.body.gates.tax.onFile, true);
  const [read] = fake.find(/FROM affiliate_referrals r\s+JOIN clients/);
  assert.deepEqual(read.params, [AFFILIATE_ID, ORG_ID], "pinned to their own affiliate row");
});

test("read/affiliate-portal ignores a named affiliate for an affiliate login, and lets staff name one", async () => {
  const OTHER = "af000000-0000-4000-8000-0000000000ff";
  const own = await run(affiliatePortal, req("GET", { query: { affiliate_id: OTHER } }),
    [...affiliateAccount(AFFILIATE_ID), ...PORTAL_ROWS], { env: {} });
  assert.equal(own.res.statusCode, 200);
  assert.ok(own.fake.find(/FROM affiliate_referrals r\s+JOIN clients/).every((c) => c.params[0] === AFFILIATE_ID));

  const staff = await run(affiliatePortal, req("GET", { query: { affiliate_id: OTHER } }),
    [staffSession({ role: "owner" }), ...PORTAL_ROWS], { env: {} });
  assert.equal(staff.res.statusCode, 200);
  assert.equal(staff.fake.find(/FROM affiliate_referrals r\s+JOIN clients/)[0].params[0], OTHER);

  const none = await run(affiliatePortal, req("GET"), [...affiliateAccount(null)], { env: {} });
  assert.equal(none.res.body.enrolled, false);
  assert.deepEqual(none.res.body.referrals, []);
});

// ── marketing/meta/load: queue only, never Meta ───────────────────────────
function loadRules({ found = true, inFlight = null } = {}) {
  return [
    staffSession({ role: "owner" }),
    [/pg_advisory_xact_lock/, [{}]],
    [/FROM marketing_requests WHERE request_id/, []],
    [/SELECT id, ad_id FROM ad_videos WHERE id = \$1 AND org_id = \$2/, found ? [{ id: VIDEO_ID, ad_id: "7" }] : []],
    [/SELECT id FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'meta_load'/, inFlight ? [{ id: inFlight }] : []],
    [/INSERT INTO marketing_jobs/, [{ id: "9b000000-0000-4000-8000-000000000001" }]],
    [/UPDATE marketing_jobs SET requested_by/, []],
    [/INSERT INTO marketing_requests/, []],
  ];
}

test("marketing/meta/load queues one load job for one approved video, answers 202, and wakes the worker after the commit", async () => {
  assert.equal(ROUTES["marketing/meta/load"], metaLoad);
  const wakes = [];
  const { res, fake } = await run(metaLoad, req("POST", { body: { request_id: "load-request-0001", ad_video_id: VIDEO_ID } }),
    loadRules(), { env: {}, wake: async () => { wakes.push("woke"); } });
  assert.equal(res.statusCode, 202, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    queued: true,
    jobs: [{ ad_number: "7", ad_video_id: VIDEO_ID, job_id: "9b000000-0000-4000-8000-000000000001" }],
  });
  const [job] = fake.find(/INSERT INTO marketing_jobs/);
  assert.equal(job.params[0], ORG_ID);
  assert.equal(job.params[1], "meta_load");
  assert.deepEqual(JSON.parse(job.params[2]), { ad_video_id: VIDEO_ID, requested_by: STAFF_ID });
  assert.equal(wakes.length, 1);
  assert.equal(fake.count("COMMIT") >= 1, true);
  assert.equal(fake.find(/INSERT INTO marketing_requests/).length, 1, "the answer is saved so a repeat press queues nothing");
});

test("marketing/meta/load refuses a missing choice, both choices, a video that is not ours, and a closer; nothing is queued", async () => {
  const refused = async (body, rules, status, role) => {
    const base = rules ?? loadRules();
    if (role) base[0] = staffSession({ role });
    const { res, fake } = await run(metaLoad, req("POST", { body }), base, { env: {}, wake: async () => {} });
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(fake.find(/INSERT INTO marketing_jobs/).length, 0);
    return res;
  };
  for (const body of [
    { request_id: "load-request-0002" },
    { request_id: "load-request-0003", ad_video_id: VIDEO_ID, all: true },
    { request_id: "load-request-0004", ad_video_id: "not-a-uuid" },
  ]) {
    assert.equal((await refused(body, null, 400)).body.field, "ad_video_id");
  }
  const missing = await refused({ request_id: "load-request-0005", ad_video_id: VIDEO_ID }, loadRules({ found: false }), 404);
  assert.equal(missing.body.error, "not_found");
  await refused({ request_id: "load-request-0006", ad_video_id: VIDEO_ID }, null, 403, "closer");
});
