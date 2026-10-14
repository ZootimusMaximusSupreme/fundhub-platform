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
  ORG_ID, OTHER_ORG_ID, STAFF_ID, accountSession, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { STAFF_ROLES, clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

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
const FOREIGN_CLIENT = "c2000000-0000-4000-8000-000000000002";
const ONE_YEAR = { now: () => new Date("2026-10-13T12:00:00Z") };
const mineAccount = (id, over) => ({ id, org_id: ORG_ID, client_id: CLIENT_ID, entity_id: null, account_type: "checking", current_balance_cents: "250000", closed_at: null, ...over });
const mineCard = (lender, over) => ({ org_id: ORG_ID, client_id: CLIENT_ID, entity_id: null, lender, credit_limit_cents: "1000000", current_balance_cents: "200000", closed_at: null, ...over });
const BANKS = [
  mineAccount("b1", {}),
  mineAccount("b2", { account_type: "savings", current_balance_cents: "50000" }),
  mineAccount("b3", { current_balance_cents: "999999", closed_at: "2026-01-01" }),
  mineAccount("b4", { org_id: OTHER_ORG_ID, client_id: FOREIGN_CLIENT, current_balance_cents: "7000000" }),
  mineAccount("b5", { client_id: FOREIGN_CLIENT, current_balance_cents: "888000" }),
];
const CARDS = [
  mineCard("Chase", {}),
  mineCard("Amex", { credit_limit_cents: "500000", current_balance_cents: "100000" }),
  mineCard("Elsewhere", { org_id: OTHER_ORG_ID, client_id: FOREIGN_CLIENT, credit_limit_cents: "9000000" }),
  mineCard("Other client", { client_id: FOREIGN_CLIENT, credit_limit_cents: "4000000" }),
];
// Every one of the five reads is a stand-in table that keeps a row only while the
// SQL text carries that row's condition: this company (orgRe) and, when the SQL
// names one, this client (the $n after "client_id = " says which parameter).
const scoped = (rows, orgRe) => shelf(rows, [
  clause(orgRe, (row, [org]) => row.org_id === org),
  clause(/\bclient_id = \$(\d)/, (row, params, [, n]) => row.client_id === params[n - 1]),
]);
const mineRow = (over) => ({ org_id: ORG_ID, client_id: CLIENT_ID, ...over });
const theirsRow = (over) => mineRow({ org_id: OTHER_ORG_ID, client_id: FOREIGN_CLIENT, ...over });
const sibling = (over) => mineRow({ client_id: FOREIGN_CLIENT, ...over });
// Oldest day first, as the SQL's ORDER BY hands them over.
const HOLDINGS = [
  mineRow({ current_value_cents: "75000" }),
  sibling({ current_value_cents: "40000" }),
  theirsRow({ current_value_cents: "9000000" }),
];
const CASH_DAYS = [
  theirsRow({ day: "2026-10-10", inflow_cents: "9000000", outflow_cents: "100" }),
  sibling({ day: "2026-10-11", inflow_cents: "30000", outflow_cents: "10000" }),
  mineRow({ day: "2026-10-12", inflow_cents: "120000", outflow_cents: "45000" }),
];
// Ad spend has no client on it (header note in the handler): both are business rows.
const SPEND_DAYS = [
  { org_id: OTHER_ORG_ID, day: "2026-10-12", spend_cents: "8000000" },
  { org_id: ORG_ID, day: "2026-10-12", spend_cents: "30000" },
];
const COMMAND_RULES = [
  [/FROM bank_accounts WHERE org_id/, scoped(BANKS, /FROM bank_accounts WHERE org_id = \$1/)],
  [/FROM tradelines WHERE org_id/, scoped(CARDS, /FROM tradelines WHERE org_id = \$1/)],
  [/FROM investment_holdings ih/, scoped(HOLDINGS, /WHERE ih\.org_id = \$1/)],
  [/FROM bank_transactions/, scoped(CASH_DAYS, /WHERE org_id = \$1 AND posted_on/)],
  [/FROM ad_metrics_daily m/, scoped(SPEND_DAYS, /WHERE m\.org_id = \$1 AND m\.date/)],
];
const CLIENTS = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, shelf(
  [{ id: CLIENT_ID, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }],
  [
    clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
    clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
  ],
)];

test("read/finance-command rolls up this company's cash, credit available and owed, investments and spend; a closed account and another company's are left out", async () => {
  assert.equal(ROUTES["read/finance-command"], financeCommand);
  const { res, fake } = await run(financeCommand, req("GET", { query: { days: "7" } }), [staffSession({ role: "funding_advisor" }), CLIENTS, ...COMMAND_RULES], ONE_YEAR);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  const t = res.body.totals;
  assert.equal(t.cash_cents, 250000 + 50000 + 888000, "this company's open accounts; the closed one and the other company's are not counted");
  assert.equal(t.credit_available_cents, 1000000 + 500000 + 4000000);
  assert.equal(t.credit_owed_cents, 200000 + 100000 + 200000);
  assert.equal(t.investment_cents, 75000 + 40000, "both of this company's clients; the other company's holding is not counted");
  assert.deepEqual(res.body.window, { from: "2026-10-07", to: "2026-10-13", days: 7 });
  assert.deepEqual(res.body.cashflow_series.map((r) => [r.date, r.net_cents]), [["2026-10-11", 20000], ["2026-10-12", 75000]],
    "this company's days only: not the other company's 9,000,000 inflow");
  assert.deepEqual(res.body.marketing_series.map((r) => [r.date, r.spend_cents]), [["2026-10-12", 30000]],
    "this company's spend only: not the other company's 8,000,000");
  const combined = res.body.combined_series.find((r) => r.date === "2026-10-12");
  assert.equal(combined.outflow_cents, 75000, "cash out includes marketing spend on the business-wide view");
  const reads = fake.calls.filter((c) => /FROM (bank_accounts|tradelines|investment_holdings|bank_transactions|ad_metrics_daily)/.test(c.sql));
  assert.equal(reads.length, 5, "the five money reads");
  assert.ok(reads.every((c) => c.params[0] === ORG_ID), "every read carries the session's company");
});

test("read/finance-command scoped to one client keeps spend separate, and refuses another company's client", async () => {
  const mine = await run(financeCommand, req("GET", { query: { client_id: CLIENT_ID } }),
    [staffSession(), CLIENTS, ...COMMAND_RULES], ONE_YEAR);
  assert.equal(mine.res.statusCode, 200);
  assert.equal(mine.res.body.totals.cash_cents, 250000 + 50000, "only that client's open accounts");
  assert.equal(mine.res.body.totals.credit_available_cents, 1000000 + 500000);
  assert.equal(mine.res.body.totals.investment_cents, 75000, "only that client's holding: not the sibling client's, not the other company's");
  assert.deepEqual(mine.res.body.cashflow_series.map((r) => [r.date, r.net_cents]), [["2026-10-12", 75000]], "only that client's cash days");
  assert.deepEqual(mine.res.body.marketing_series.map((r) => [r.date, r.spend_cents]), [["2026-10-12", 30000]],
    "spend stays the business-wide figure under a client filter");
  assert.equal(mine.res.body.combined_series, null);
  assert.match(mine.res.body.combined_series_unavailable_reason, /cannot be attributed to one client/);
  assert.deepEqual(mine.fake.find(/FROM bank_accounts/)[0].params, [ORG_ID, CLIENT_ID]);
  assert.deepEqual(mine.fake.find(/FROM investment_holdings/)[0].params, [ORG_ID, CLIENT_ID]);

  const theirs = await run(financeCommand, req("GET", { query: { client_id: FOREIGN_CLIENT } }),
    [staffSession(), CLIENTS, ...COMMAND_RULES], ONE_YEAR);
  assert.equal(theirs.res.statusCode, 404);
  assert.equal(theirs.fake.find(/FROM bank_accounts/).length, 0);
});

test("read/finance-command lets every staff role read it and nobody who is not staff", async () => {
  const letIn = await rolesLetIn(async (role) => (await run(financeCommand, req("GET"),
    [staffSession({ role }), CLIENTS, ...COMMAND_RULES], ONE_YEAR)).res.statusCode);
  assert.deepEqual(letIn, [...STAFF_ROLES].sort());
  const client = await run(financeCommand, req("GET"), [...accountSession({ kind: "client", clientId: CLIENT_ID }), ...COMMAND_RULES], ONE_YEAR);
  assert.ok([401, 403].includes(client.res.statusCode), `a client login got ${client.res.statusCode}`);
  assert.equal(client.fake.find(/FROM bank_accounts/).length, 0);
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

const OTHER_AFFILIATE = "af000000-0000-4000-8000-0000000000ff";
const mineOrOthers = (rows) => shelf(rows, [
  clause(/WHERE (?:r|po)\.affiliate_id = \$1/, (row, [id]) => row.affiliate_id === id),
  clause(/AND (?:r|po)\.org_id = \$2/, (row, [, org]) => row.org_id === org),
]);
const AFFILIATES = shelf([
  { id: AFFILIATE_ID, org_id: ORG_ID, name: "Mike", tracking_id: "mike01", status: "active", tier_level: "tier1",
    partner_license_signed_at: null, tax_form_received_at: "2026-09-01T00:00:00Z", balance_due: "125.50" },
  { id: OTHER_AFFILIATE, org_id: ORG_ID, name: "Not Mike", tracking_id: "other99", status: "active", tier_level: "tier1",
    partner_license_signed_at: "2026-09-01T00:00:00Z", tax_form_received_at: null, balance_due: "9999.00" },
], [
  clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
  clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
]);
const referral = (id, affiliateId, first, over) => ({
  id, affiliate_id: affiliateId, org_id: ORG_ID, tier: "direct", status: "converted", first_name: first, last_name: "Lee",
  commission_due: "100.00", basis_amount: "500.00", product_name: "Repair", ...over,
});
const PORTAL_ROWS = [
  [/FROM affiliates\s+WHERE id = \$1 AND org_id = \$2/, AFFILIATES],
  // Each read also holds another company's row: for the same affiliate, so only
  // the company condition in the SQL keeps it out.
  [/FROM affiliate_commission_rules r/, shelf([
    { tier: "direct", calc_method: "percent", percent: "20", name: "Direct", affiliate_id: null, org_id: ORG_ID },
    { tier: "downline", calc_method: "percent", percent: "5", name: "Downline", affiliate_id: null, org_id: ORG_ID },
    { tier: "direct", calc_method: "percent", percent: "50", name: "Elsewhere direct", affiliate_id: null, org_id: OTHER_ORG_ID },
  ], [clause(/WHERE r\.org_id = \$1/, (row, [org]) => row.org_id === org)])],
  [/FROM affiliate_referrals r\s+JOIN clients/, mineOrOthers([
    referral("ae000000-0000-4000-8000-000000000001", AFFILIATE_ID, "Sarah", {}),
    referral("ae000000-0000-4000-8000-000000000002", OTHER_AFFILIATE, "Stranger", { commission_due: "777.00" }),
    referral("ae000000-0000-4000-8000-000000000003", AFFILIATE_ID, "Elsewhere", { org_id: OTHER_ORG_ID, commission_due: "555.00" }),
  ])],
  [/FROM affiliate_payouts po/, mineOrOthers([
    { id: "b1", affiliate_id: AFFILIATE_ID, org_id: ORG_ID, amount: "25.50", currency: "USD", status: "held", hold_reason: "license_unsigned", line_count: "2" },
    { id: "b2", affiliate_id: OTHER_AFFILIATE, org_id: ORG_ID, amount: "800.00", currency: "USD", status: "paid", hold_reason: null, line_count: "9" },
    { id: "b3", affiliate_id: AFFILIATE_ID, org_id: OTHER_ORG_ID, amount: "4000.00", currency: "USD", status: "paid", hold_reason: null, line_count: "7" },
  ])],
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
  assert.deepEqual(res.body.rates.direct.rules.map((r) => r.name), ["Direct"], "this company's rules only");
  assert.deepEqual(res.body.referrals.map((r) => [r.name, r.commissionDue, r.basisAmount]), [["Sarah Lee", 100, 500]]);
  assert.deepEqual(res.body.payouts.map((p) => [p.amount, p.status, p.holdReason, p.lineCount]), [[25.5, "held", "license_unsigned", 2]]);
  assert.equal(res.body.gates.license.signed, false, "unsigned license holds the payout");
  assert.equal(res.body.gates.tax.onFile, true);
  const [read] = fake.find(/FROM affiliate_referrals r\s+JOIN clients/);
  assert.deepEqual(read.params, [AFFILIATE_ID, ORG_ID], "pinned to their own affiliate row");
});

test("read/affiliate-portal ignores a named affiliate for an affiliate login, and lets staff name one", async () => {
  const own = await run(affiliatePortal, req("GET", { query: { affiliate_id: OTHER_AFFILIATE } }),
    [...affiliateAccount(AFFILIATE_ID), ...PORTAL_ROWS], { env: {} });
  assert.equal(own.res.statusCode, 200);
  assert.equal(own.res.body.affiliate.code, "mike01", "the named affiliate is ignored for an affiliate login");
  assert.deepEqual(own.res.body.referrals.map((r) => r.name), ["Sarah Lee"], "not the other affiliate's referral");
  assert.deepEqual(own.res.body.payouts.map((p) => p.amount), [25.5], "not the other affiliate's payout");

  const staff = await run(affiliatePortal, req("GET", { query: { affiliate_id: OTHER_AFFILIATE } }),
    [staffSession({ role: "owner" }), ...PORTAL_ROWS], { env: {} });
  assert.equal(staff.res.statusCode, 200);
  assert.equal(staff.res.body.affiliate.code, "other99");
  assert.deepEqual(staff.res.body.referrals.map((r) => r.name), ["Stranger Lee"]);

  const none = await run(affiliatePortal, req("GET"), [...affiliateAccount(null)], { env: {} });
  assert.equal(none.res.body.enrolled, false);
  assert.deepEqual(none.res.body.referrals, []);
});

// ── marketing/meta/load: queue only, never Meta ───────────────────────────
const FOREIGN_VIDEO = "ad000000-0000-4000-8000-0000000000ff";
const ONE_VIDEOS = [
  { id: VIDEO_ID, ad_id: "7", org_id: ORG_ID },
  { id: FOREIGN_VIDEO, ad_id: "8", org_id: OTHER_ORG_ID },
];

function loadRules({ inFlight = null } = {}) {
  return [
    staffSession({ role: "owner" }),
    [/pg_advisory_xact_lock/, [{}]],
    [/FROM marketing_requests WHERE request_id/, []],
    [/SELECT id, ad_id FROM ad_videos WHERE id = \$1 AND org_id = \$2/, shelf(ONE_VIDEOS, [
      clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
      clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
    ])],
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

test("marketing/meta/load refuses a missing choice, both choices, another company's video and every role but owner and admin; nothing is queued", async () => {
  const refused = async (body, status, role = "owner") => {
    const rules = loadRules();
    rules[0] = staffSession({ role });
    const { res, fake } = await run(metaLoad, req("POST", { body }), rules, { env: {}, wake: async () => {} });
    assert.equal(res.statusCode, status, JSON.stringify(body));
    assert.equal(fake.find(/INSERT INTO marketing_jobs/).length, 0);
    return res;
  };
  for (const body of [
    { request_id: "load-request-0002" },
    { request_id: "load-request-0003", ad_video_id: VIDEO_ID, all: true },
    { request_id: "load-request-0004", ad_video_id: "not-a-uuid" },
  ]) {
    assert.equal((await refused(body, 400)).body.field, "ad_video_id");
  }
  const theirs = await refused({ request_id: "load-request-0005", ad_video_id: FOREIGN_VIDEO }, 404);
  assert.equal(theirs.body.error, "not_found");

  const letIn = await rolesLetIn(async (role) => (await run(metaLoad,
    req("POST", { body: { request_id: `load-request-${role}`.padEnd(20, "0"), ad_video_id: VIDEO_ID } }),
    [staffSession({ role }), ...loadRules().slice(1)], { env: {}, wake: async () => {} })).res.statusCode);
  assert.deepEqual(letIn, ["admin", "owner"]);
});

// ── marketing/meta/load all:true: only approved, not-yet-loaded ads ────────
// A stand-in ad_videos table. It keeps a row only when the SQL it is asked
// carries that row's test (company, approved state, approved stamp, approver,
// not loaded, an ad). So a filter taken out of the handler's SQL lets the
// extra video through, and the queue below grows.
const approvedAd = (id, adId, over = {}) => ({
  id, ad_id: adId, org_id: ORG_ID, status: "approved", approved_at: "2026-10-12T09:00:00Z",
  approved_by: "Chris", loaded_at: null, video_kind: "ad", ...over,
});
const v = (n) => `ad000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const SHELF = [
  approvedAd(v(1), "9", { status: "delivered" }),
  approvedAd(v(2), "12"),
  approvedAd(v(3), "13", { status: "draft" }),
  approvedAd(v(4), "14", { approved_at: null }),
  approvedAd(v(5), "15", { approved_by: "   " }),
  approvedAd(v(6), "16", { loaded_at: "2026-10-11T09:00:00Z" }),
  approvedAd(v(7), "17", { video_kind: "vsl" }),
  approvedAd(v(8), "18", { org_id: OTHER_ORG_ID }),
];
const SHELF_TESTS = [
  [/org_id = \$1/, (row, [org]) => row.org_id === org],
  [/status = ANY\(\$2::text\[\]\)/, (row, [, states]) => states.includes(row.status)],
  [/approved_at IS NOT NULL/, (row) => row.approved_at != null],
  [/btrim\(coalesce\(approved_by, ''\)\) <> ''/, (row) => String(row.approved_by ?? "").trim() !== ""],
  [/loaded_at IS NULL/, (row) => row.loaded_at == null],
  [/video_kind = 'ad'/, (row) => row.video_kind === "ad"],
];

function allRules({ shelf = SHELF, inFlight = {} } = {}) {
  let made = 0;
  return [
    staffSession({ role: "owner" }),
    [/pg_advisory_xact_lock/, [{}]],
    [/FROM marketing_requests WHERE request_id/, []],
    [(sql) => /FROM ad_videos\s+WHERE org_id = \$1\s+AND status/.test(sql), (sql, params) => shelf
      .filter((row) => SHELF_TESTS.every(([re, keep]) => !re.test(sql) || keep(row, params)))
      .map(({ id, ad_id }) => ({ id, ad_id }))],
    [/SELECT id FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'meta_load'/,
      (sql, params) => (inFlight[params[1]] ? [{ id: inFlight[params[1]] }] : [])],
    [/INSERT INTO marketing_jobs/, () => [{ id: `9b000000-0000-4000-8000-0000000002${String(++made).padStart(2, "0")}` }]],
    [/UPDATE marketing_jobs SET requested_by/, []],
    [/INSERT INTO marketing_requests/, []],
  ];
}

test("marketing/meta/load all:true queues exactly the approved ads that are not loaded yet, and reuses a load already waiting", async () => {
  const wakes = [];
  const waiting = "9b000000-0000-4000-8000-000000000099";
  const { res, fake } = await run(metaLoad, req("POST", { body: { request_id: "load-request-0010", all: true } }),
    allRules({ inFlight: { [v(2)]: waiting } }), { env: {}, wake: async () => { wakes.push("woke"); } });
  assert.equal(res.statusCode, 202, JSON.stringify(res.body));
  assert.deepEqual(res.body, {
    queued: true,
    jobs: [
      { ad_number: "9", ad_video_id: v(1), job_id: "9b000000-0000-4000-8000-000000000201" },
      { ad_number: "12", ad_video_id: v(2), job_id: waiting },
    ],
  }, "approved and delivered ads only; not a draft, an unstamped, an unsigned, a loaded, a non-ad, or another company's video");
  const inserts = fake.find(/INSERT INTO marketing_jobs/);
  assert.deepEqual(inserts.map((c) => JSON.parse(c.params[2]).ad_video_id), [v(1)], "the load already waiting gets no second job");
  assert.ok(inserts.every((c) => c.params[0] === ORG_ID && c.params[1] === "meta_load"));
  const read = fake.find(/FROM ad_videos\s+WHERE org_id = \$1/)[0];
  assert.deepEqual(read.params, [ORG_ID, ["approved", "delivered"]]);
  assert.equal(wakes.length, 1);
});

test("marketing/meta/load all:true with nothing approved and unloaded answers 202 with no jobs and wakes nobody", async () => {
  const wakes = [];
  const none = SHELF.filter((row) => ![v(1), v(2)].includes(row.id));
  const { res, fake } = await run(metaLoad, req("POST", { body: { request_id: "load-request-0011", all: true } }),
    allRules({ shelf: none }), { env: {}, wake: async () => { wakes.push("woke"); } });
  assert.equal(res.statusCode, 202);
  assert.deepEqual(res.body, { queued: true, jobs: [] });
  assert.equal(fake.find(/INSERT INTO marketing_jobs/).length, 0);
  assert.equal(wakes.length, 0);
});
