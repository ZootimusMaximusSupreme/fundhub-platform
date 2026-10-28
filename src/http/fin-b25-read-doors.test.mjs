// Finish-the-853 batch 25, practice tests for eight staff read doors: booked calls and leads by ad,
// Capital Blueprint combined prequal, the closer's live-call payload, which call a closer is on, the
// Galaxy presence feed, the CSM's day, and the finance "ask" answers. Each test runs the REAL api/
// handler (real sign-in and role gate, real library under it) over a stand-in database that answers
// by the SQL text the code sends. Fake data only. These reads write nothing, call no vendor and
// never run a language model.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

import adBooksHandler from "../../api/read/ad-books.mjs";
import combinedHandler from "../../api/read/blueprint-combined-approval.mjs";
import closerCallHandler from "../../api/read/closer-call.mjs";
import closerNowHandler from "../../api/read/closer-now.mjs";
import companyActivityHandler from "../../api/read/company-activity.mjs";
import csmQueueHandler from "../../api/read/csm-queue.mjs";
import financeAskHandler from "../../api/read/finance-ask.mjs";
import { offersForClient } from "../config/offers.mjs";
import { gateLenderMatch } from "../sales/cockpit.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertOnlySent, assertRoleGate, assertSent, assertSqlHas, call, dataCalls, sentStatement, sqlCalls,
} from "../testing/fin-b25-kit.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const PARTNER_CLIENT = "c1000000-0000-4000-8000-000000000002";
const OTHER_CLIENT = "c1000000-0000-4000-8000-0000000000aa";
const STAFF_ROLES = ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager", "csm"];
const noWrites = (result) => assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)), true, "a read writes nothing");

/* ── read/ad-books ─────────────────────────────────────────────────────────────────────────────────── */

const attributionRows = [
  { org_id: ORG_ID, lane: "funding600", ad_id: "16", variant: "sun", leads: 10, books: 4, first_lead_at: "2026-10-01T10:00:00.000Z", last_lead_at: "2026-10-10T10:00:00.000Z", first_book_at: "2026-10-02T10:00:00.000Z", last_book_at: "2026-10-09T10:00:00.000Z", payments: 1, paid_cents: "29700", payments_amount_unknown: 0 },
  { org_id: ORG_ID, lane: "uwiq", ad_id: "26", variant: "nosun", leads: 6, books: 1, first_lead_at: "2026-10-03T10:00:00.000Z", last_lead_at: "2026-10-08T10:00:00.000Z", first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
  { org_id: ORG_ID, lane: "uwiq", ad_id: "9999", variant: null, leads: 2, books: 0, first_lead_at: "2026-10-04T10:00:00.000Z", last_lead_at: "2026-10-04T10:00:00.000Z", first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
  { org_id: OTHER_ORG_ID, lane: "funding600", ad_id: "16", variant: "sun", leads: 500, books: 500, first_lead_at: "2026-10-01T10:00:00.000Z", last_lead_at: "2026-10-01T10:00:00.000Z", first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
];

const attributionRule = (calls) => [/FROM client_ad_attribution a/, (sql, params) => {
  calls.push({ sql, params });
  const scoped = /WHERE a\.org_id = \$1/.test(sql);
  return attributionRows.filter((r) => !scoped || r.org_id === params[0]).map(({ org_id: _org, ...rest }) => rest);
}];

test("GET read/ad-books groups booked calls and leads by lane, ad, variant or registry tag for this company only, with unknown ad ids reported apart", async () => {
  const calls = [];
  const lane = await call(adBooksHandler, { query: { group_by: "lane" }, rules: [attributionRule(calls)] });
  assert.equal(lane.status, 200);
  assert.equal(lane.body.group_by, "lane");
  assert.equal(lane.body.total_leads, 18, "another company's 500 leads are not counted");
  assert.equal(lane.body.total_books, 5);
  assert.deepEqual(lane.body.groups.map((g) => [g.key, g.leads, g.books]), [["funding600", 10, 4], ["uwiq", 8, 1]], "most booked first");
  assert.deepEqual(lane.body.groups[1].ad_ids, ["26", "9999"]);
  assert.equal(lane.body.groups[0].first_book_at, "2026-10-02T10:00:00.000Z");
  assert.equal(lane.body.groups[1].first_book_at, null, "no booked call in the group: unknown, not a made-up date");
  assert.deepEqual(calls[0].params, [ORG_ID, null, null]);
  assertSqlHas(calls[0].sql, { company: "WHERE a.org_id = $1", notCancelled: "bk.status IS DISTINCT FROM 'cancelled'", noDemo: "pl.is_demo = false", paidOnly: "pl.status = 'paid'" });

  const gate = await call(adBooksHandler, { query: { group_by: "gate" }, rules: [attributionRule([])] });
  assert.deepEqual(gate.body.groups.map((g) => [g.key, g.leads, g.books]), [["600", 10, 4], ["none", 8, 1]], "gate comes from the ad list file");
  assert.deepEqual(gate.body.unknown_ad_ids, ["9999"], "an ad id the registry does not list is said, not hidden");

  const offers = await call(adBooksHandler, { query: { group_by: "secondary_offer" }, rules: [attributionRule([])] });
  const byKey = Object.fromEntries(offers.body.groups.map((g) => [g.key, g]));
  assert.ok(byKey.funding_dfy && byKey.capital_blueprint, "an ad that is open to every offer counts once in each offer except none");
  assert.equal(byKey.none?.leads, 10, "an ad with no secondary offer counts under none");
  noWrites(lane);
  // The counts come back pre-made, so the statement that makes them is pinned as sent: distinct leads, books
  // and payments each counted per client BEFORE the group (never multiplied into each other), a cancelled
  // booking is not a booked call, a demo or unpaid payment is not a payment, this company, the lead's
  // capture window (from included, to excluded), grouped and ordered.
  assertOnlySent(lane, "ads.rollup");
});

test("GET read/ad-books folds rows into one group with the earliest first date and the latest last date, breaks ties by leads then by name, and takes the company from the session only", async () => {
  const row = (over) => ({
    org_id: ORG_ID, lane: "funding600", ad_id: "16", variant: null, leads: 1, books: 0,
    first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0, ...over,
  });
  const rows = [
    row({ lane: "alpha", ad_id: "30", leads: 3, books: 2, first_lead_at: "2026-10-05T10:00:00.000Z", last_lead_at: "2026-10-06T10:00:00.000Z", first_book_at: "2026-10-07T10:00:00.000Z", last_book_at: "2026-10-08T10:00:00.000Z" }),
    row({ lane: "alpha", ad_id: "31", leads: 4, books: 2, first_lead_at: "2026-10-02T10:00:00.000Z", last_lead_at: "2026-10-09T10:00:00.000Z", first_book_at: "2026-10-03T10:00:00.000Z", last_book_at: "2026-10-10T10:00:00.000Z" }),
    row({ lane: "alpha", ad_id: "32", leads: 1, books: 0, first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null }),
    row({ lane: "bravo", ad_id: "40", leads: 9, books: 4 }),
    row({ lane: "charlie", ad_id: "41", leads: 5, books: 4 }),
    row({ lane: "delta", ad_id: "42", leads: 5, books: 4 }),
    row({ lane: "echo", ad_id: "43", leads: 20, books: 0 }),
  ];
  const calls = [];
  const rule = [/FROM client_ad_attribution a/, (sql, params) => { calls.push({ sql, params }); return rows.map(({ org_id: _o, ...rest }) => rest); }];
  const result = await call(adBooksHandler, { query: { group_by: "lane", org_id: OTHER_ORG_ID, staff_id: "5a000000-0000-4000-8000-0000000000ff" }, rules: [rule] });
  assert.equal(result.status, 200);
  assert.deepEqual(calls[0].params, [ORG_ID, null, null], "a company in the query string is ignored");
  const [alpha] = result.body.groups.filter((g) => g.key === "alpha");
  assert.equal(alpha.first_lead_at, "2026-10-02T10:00:00.000Z", "earliest first lead of the rows folded");
  assert.equal(alpha.last_lead_at, "2026-10-09T10:00:00.000Z", "latest last lead");
  assert.equal(alpha.first_book_at, "2026-10-03T10:00:00.000Z", "earliest first booked call, skipping a row with none");
  assert.equal(alpha.last_book_at, "2026-10-10T10:00:00.000Z", "latest last booked call");
  assert.deepEqual([alpha.leads, alpha.books], [8, 4]);
  assert.deepEqual(result.body.groups.map((g) => g.key), ["bravo", "alpha", "charlie", "delta", "echo"],
    "most booked calls first; the same books: most leads first; the same: by name");
  assert.equal(result.body.total_leads, 47);
  assert.equal(result.body.total_books, 16);

  const noCompany = await call(adBooksHandler, { staff: { org_id: null }, rules: [rule] });
  assert.equal(noCompany.status, 403);
  assert.deepEqual(noCompany.body, { ok: false, error: "forbidden" });
  assert.equal(calls.length, 1, "no number is read for a sign-in with no company");
});

test("GET read/ad-books passes a date window through, refuses a bad group or date, and is for staff only", async () => {
  const calls = [];
  const windowed = await call(adBooksHandler, { query: { group_by: "ad_id", from: "2026-10-01", to: "2026-10-09" }, rules: [attributionRule(calls)] });
  assert.equal(windowed.status, 200);
  assert.equal(windowed.body.from, "2026-10-01T00:00:00.000Z");
  assert.equal(windowed.body.to, "2026-10-09T00:00:00.000Z");
  assert.deepEqual(calls[0].params, [ORG_ID, "2026-10-01T00:00:00.000Z", "2026-10-09T00:00:00.000Z"]);
  assertSqlHas(calls[0].sql, { fromInclusive: "a.captured_at >= $2::timestamptz", toExclusive: "a.captured_at < $3::timestamptz" });
  assert.deepEqual(windowed.body.groups.map((g) => g.key), ["16", "26", "9999"]);

  const badGroup = await call(adBooksHandler, { query: { group_by: "colour" }, rules: [] });
  assert.equal(badGroup.status, 400);
  const badDate = await call(adBooksHandler, { query: { from: "last tuesday" }, rules: [] });
  assert.equal(badDate.status, 400);
  const post = await call(adBooksHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
  await assertRoleGate(adBooksHandler, STAFF_ROLES, { rules: [attributionRule([])] });
});

/* ── read/blueprint-combined-approval ──────────────────────────────────────────────────────────────── */

function combinedWorld({ clients, links }) {
  return [
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, (sql, params) => rowsWhere(clients, sql, params).map(() => ({ "?column?": 1 }))],
    [/FROM credit_partner_links\s+WHERE org_id = \$1::uuid\s+AND primary_client_id = \$2::uuid/, (sql, params) => rowsWhere(links, sql, params)],
    [/FROM clients\s+WHERE org_id = \$1::uuid\s+AND id = ANY\(\$2::uuid\[\]\)/, (_sql, params) =>
      clients.filter((c) => c.org_id === params[0] && params[1].includes(c.id))],
  ];
}

test("GET read/blueprint-combined-approval answers each file's prequal and the combined sum, in dollars, for a client of this company", async () => {
  const clients = [
    { id: CLIENT_ID, org_id: ORG_ID, first_name: "Pat", last_name: "Primary", custom_fields: { analyzer_prequal_amount: 120000 } },
    { id: PARTNER_CLIENT, org_id: ORG_ID, first_name: "Sam", last_name: "Partner", custom_fields: { cf_reanalyzer_prequal_amount: "80000" } },
    { id: OTHER_CLIENT, org_id: OTHER_ORG_ID, first_name: "Not", last_name: "Ours", custom_fields: { analyzer_prequal_amount: 999999 } },
  ];
  const links = [
    { org_id: ORG_ID, primary_client_id: CLIENT_ID, partner_client_id: PARTNER_CLIENT, removed_at: null },
    { org_id: ORG_ID, primary_client_id: OTHER_CLIENT, partner_client_id: PARTNER_CLIENT, removed_at: null },
  ];
  const result = await call(combinedHandler, { query: { client_id: CLIENT_ID }, rules: combinedWorld({ clients, links }) });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    ok: true, primaryClientId: CLIENT_ID, partnerClientId: PARTNER_CLIENT,
    primaryPrequal: 120000, partnerPrequal: 80000, combinedPrequal: 200000,
    primaryPrequalDisplay: "$120,000", partnerPrequalDisplay: "$80,000", combinedPrequalDisplay: "$200,000",
    primary: { id: CLIENT_ID, name: "Pat Primary" }, partner: { id: PARTNER_CLIENT, name: "Sam Partner" },
  });
  const link = sqlCalls(result, /FROM credit_partner_links/)[0];
  assert.deepEqual(link.params, [ORG_ID, CLIENT_ID]);
  assertSqlHas(link.sql, { company: "WHERE org_id = $1::uuid", notRemoved: "AND removed_at IS NULL" });
  const people = sqlCalls(result, /FROM clients\s+WHERE org_id = \$1::uuid AND id = ANY/)[0];
  assertSqlHas(people.sql, { company: "WHERE org_id = $1::uuid" });
  assert.deepEqual(people.params, [ORG_ID, [CLIENT_ID, PARTNER_CLIENT]]);
  noWrites(result);
  assertOnlySent(result, "client.owned", "partner.link", "partner.clients");
});

test("GET read/blueprint-combined-approval reads each file's figure in one order (analyzer, then re-analyzer, then the funding estimate), skips a zero or unreadable one, and adds what is known when one file has none", async () => {
  const run = async (primary, partner) => {
    const clients = [{ id: CLIENT_ID, org_id: ORG_ID, first_name: "Pat", last_name: "Primary", custom_fields: primary }];
    const links = [];
    if (partner) {
      clients.push({ id: PARTNER_CLIENT, org_id: ORG_ID, first_name: "Sam", last_name: "Partner", custom_fields: partner });
      links.push({ org_id: ORG_ID, primary_client_id: CLIENT_ID, partner_client_id: PARTNER_CLIENT, removed_at: null });
    }
    return (await call(combinedHandler, { query: { client_id: CLIENT_ID }, rules: combinedWorld({ clients, links }) })).body;
  };
  const onlyEstimate = await run({ total_funding_estimate: 70000 });
  assert.equal(onlyEstimate.primaryPrequal, 70000, "the funding estimate counts when no analyzer figure is stored");
  const onlyRe = await run({ cf_reanalyzer_prequal_amount: 55000, total_funding_estimate: 70000 });
  assert.equal(onlyRe.primaryPrequal, 55000, "the re-analyzer figure comes before the estimate");
  const both = await run({ analyzer_prequal_amount: 90000, cf_reanalyzer_prequal_amount: 55000, total_funding_estimate: 70000 });
  assert.equal(both.primaryPrequal, 90000, "the analyzer figure comes first");

  const partnerUnknown = await run({ analyzer_prequal_amount: 120000 }, {});
  assert.deepEqual([partnerUnknown.primaryPrequal, partnerUnknown.partnerPrequal, partnerUnknown.combinedPrequal], [120000, null, 120000],
    "a partner with no figure adds nothing: the combined figure is what is known");
  assert.equal(partnerUnknown.combinedPrequalDisplay, "$120,000");
  const primaryUnknown = await run({}, { analyzer_prequal_amount: 80000 });
  assert.deepEqual([primaryUnknown.primaryPrequal, primaryUnknown.partnerPrequal, primaryUnknown.combinedPrequal], [null, 80000, 80000]);
  const bothUnknown = await run({}, {});
  assert.deepEqual([bothUnknown.primaryPrequal, bothUnknown.partnerPrequal, bothUnknown.combinedPrequal], [null, null, null], "neither file has a figure: unknown, not 0");

  const zero = await run({ analyzer_prequal_amount: 0 });
  assert.equal(zero.primaryPrequal, null, "a stored 0 is not a known $0");
  assert.equal(zero.primaryPrequalDisplay, null);
  const zeroThenNext = await run({ analyzer_prequal_amount: 0, total_funding_estimate: 70000 });
  assert.equal(zeroThenNext.primaryPrequal, null, "a 0 stops the order: it is not skipped to the next field");
  const text = await run({ analyzer_prequal_amount: "not a number" });
  assert.equal(text.primaryPrequal, null);
  const negative = await run({ analyzer_prequal_amount: -5 });
  assert.equal(negative.primaryPrequal, null);
  const asText = await run({ analyzer_prequal_amount: "45000.4" });
  assert.equal(asText.primaryPrequal, 45000, "a figure stored as text is read and rounded to whole dollars");
});

test("GET read/blueprint-combined-approval keeps unknown amounts null, shows one file when no partner is linked, hides another company's client, and refuses a bad id", async () => {
  const solo = await call(combinedHandler, {
    query: { client_id: CLIENT_ID },
    rules: combinedWorld({ clients: [{ id: CLIENT_ID, org_id: ORG_ID, first_name: "Pat", last_name: "Primary", custom_fields: { analyzer_prequal_amount: 45000, cf_reanalyzer_prequal_amount: 50000, total_funding_estimate: 99999 } }], links: [] }),
  });
  assert.equal(solo.body.combinedPrequal, 45000, "no partner: the combined number is the primary file's");
  assert.equal(solo.body.partnerClientId, null);
  assert.equal(solo.body.partner, null);
  assert.equal(solo.body.partnerPrequal, null);
  assert.equal(solo.body.partnerPrequalDisplay, null);

  const unknown = await call(combinedHandler, {
    query: { client_id: CLIENT_ID },
    rules: combinedWorld({ clients: [{ id: CLIENT_ID, org_id: ORG_ID, first_name: "Pat", last_name: "Primary", custom_fields: {} }], links: [] }),
  });
  assert.equal(unknown.body.primaryPrequal, null, "no figure stored is unknown, never 0");
  assert.equal(unknown.body.combinedPrequal, null);
  assert.equal(unknown.body.combinedPrequalDisplay, null);

  const other = await call(combinedHandler, {
    query: { client_id: OTHER_CLIENT },
    rules: combinedWorld({ clients: [{ id: OTHER_CLIENT, org_id: OTHER_ORG_ID, first_name: "Not", last_name: "Ours", custom_fields: { analyzer_prequal_amount: 1 } }], links: [] }),
  });
  assert.equal(other.status, 404);
  assert.deepEqual(other.body, { ok: false, error: "not_found" });
  assert.equal(sqlCalls(other, /FROM credit_partner_links/).length, 0, "nothing past the company check is read");

  const noId = await call(combinedHandler, { query: {}, rules: [] });
  assert.equal(noId.status, 400);
  const badId = await call(combinedHandler, { query: { client_id: "nope" }, rules: [] });
  assert.equal(badId.status, 400);
  await assertRoleGate(combinedHandler, STAFF_ROLES, { query: { client_id: CLIENT_ID }, rules: combinedWorld({ clients: [], links: [] }) });
});

/* ── read/closer-call (the Closer Dashboard payload) ───────────────────────────────────────────────── */

function cockpitWorld({
  withCredit = true, closeout = null, clientOrg = ORG_ID, kpi = { cash_cents: "1500000", deposits: 3, held: 6, no_shows: 1 }, shiftStarted = null,
  upNext = [], nextAfter = null, preapprovals = { totalPersonal: 62000, totalBusiness: 150000, totalCombined: 212000 },
  customFields = { slo_ref: "SLO-12", estimated_fico: 690 },
} = {}) {
  const client = {
    id: CLIENT_ID, org_id: clientOrg, first_name: "Alex", last_name: "Rivera", email: null, phone: null, channel_source: "meta",
    funded: false, funded_amount: null, outcome_tier: null, custom_fields: customFields, tags: ["vip"],
    business_name: "Rivera Plumbing", age_months: 30, utm_source: "fb", utm_campaign: "funding600", utm_medium: "paid", cf_setter_user_id: null,
  };
  const crs = withCredit
    ? [{ client_id: CLIENT_ID, org_id: ORG_ID, created_at: new Date("2026-10-10T10:00:00.000Z"), result: { ...(preapprovals ? { preapprovals } : {}), derogatories: 1 } }]
    : [];
  const statements = [];
  const rules = [
    [/FROM clients c\s+LEFT JOIN businesses b ON b\.client_id = c\.id/, (sql, params) => { statements.push({ name: "client", sql, params }); return rowsWhere([client], sql, params); }],
    [/FROM clients\s+WHERE org_id = \$1::uuid AND id = \$2::uuid/, (sql, params) => rowsWhere([client], sql, params).map(({ id, custom_fields }) => ({ id, custom_fields }))],
    [/^\s*SELECT id, started_at FROM shifts/, (sql, params) => { statements.push({ name: "shift", sql, params }); return [{ id: "sh-1", started_at: shiftStarted || new Date(Date.now() - 2 * 3600e3).toISOString() }]; }],
    [/AS deposits,\s+count\(\*\) FILTER \(WHERE outcome <> 'no_show'\)::int AS held/, (sql, params) => { statements.push({ name: "kpis", sql, params }); return [kpi]; }],
    [/AS cents,\s+count\(\*\) FILTER/, (sql, params) => { statements.push({ name: "today", sql, params }); return [{ cents: "250000", deposits: 1 }]; }],
    [/FROM crs_results\s+WHERE client_id = \$1 AND org_id = \$2/, (sql, params) => { statements.push({ name: "crs", sql, params }); return rowsWhere(crs, sql, params); }],
    [/FROM funding_rounds fr\s+LEFT JOIN funding_closeout fc/, (sql, params) => { statements.push({ name: "closeout", sql, params }); return closeout ? [closeout] : []; }],
    [/^\s*SELECT name FROM staff WHERE id = \$1 AND org_id = \$2/, (sql, params) => { statements.push({ name: "staff", sql, params }); return [{ name: "Olive Owner" }]; }],
    [/SELECT count\(\*\)::int AS n\s+FROM tasks t/, (sql, params) => { statements.push({ name: "unlogged_count", sql, params }); return [{ n: 0 }]; }],
    [/FROM tasks t\s+LEFT JOIN clients c ON c\.id = t\.client_id AND c\.org_id = t\.org_id\s+LEFT JOIN call_outcomes o ON o\.task_id = t\.id\s+WHERE t\.org_id = \$1\s+AND t\.assignee_role = 'closer'\s+AND \(t\.assignee_staff_id = \$2 OR t\.assignee_staff_id IS NULL\)\s+AND t\.due_at IS NOT NULL\s+AND o\.id IS NULL\s+AND \(/, (sql, params) => { statements.push({ name: "up_next", sql, params }); return upNext; }],
    [/FROM tasks nt/, (sql, params) => { statements.push({ name: "next_after", sql, params }); return nextAfter ? [nextAfter] : []; }],
  ];
  return { rules, statements };
}

test("GET read/closer-call answers the live-call payload for one client of this company: the stored funding number, the success fee from the closeout, the shift and the month's numbers", async () => {
  const world = cockpitWorld({ closeout: { id: "fr-1", fee_percent: "0.1200", total_fee: "18000", total_approved_amount: "150000", closeout_status: "open" } });
  const result = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  const b = result.body;
  assert.equal(b.ok, true);
  assert.equal(b.client.id, CLIENT_ID);
  assert.equal(b.client.name, "Alex Rivera");
  assert.equal(b.client.business_name, "Rivera Plumbing");
  assert.equal(b.client.utm_campaign, "funding600", "the ad line it came from rides on the payload");
  assert.equal(b.client.slo_ref, "SLO-12");
  assert.deepEqual([b.funding.personal, b.funding.business, b.funding.total, b.funding.source], [62000, 150000, 212000, "crs_preapprovals"], "one funding number: the stored pre-approval");
  assert.equal(b.underwrite.totals.total_combined_funding, 212000);
  assert.equal(b.underwrite.totals.source, "stored_preapprovals");
  assert.equal(b.credit.available, true);
  assert.equal(b.credit.derogatories, 1);
  assert.equal(b.underwrite.funding_round_id, "fr-1");
  assert.deepEqual(
    [b.deal.success_fee_percent, b.deal.success_fee_source, b.deal.closeout_total_fee, b.deal.closeout_status],
    [0.12, "closeout", 18000, "open"],
    "the fee is the round's own, not a house constant",
  );
  assert.equal(b.staff.id, STAFF_ID);
  assert.equal(b.staff.name, "Olive Owner");
  assert.equal(b.staff.shift.on_shift, true);
  assert.equal(b.kpis.cash_month_cents, 1500000);
  assert.equal(b.kpis.cash_month_display, "$15,000");
  assert.equal(b.kpis.cash_today_cents.cents, 250000);
  assert.equal(b.kpis.deposits, 3);
  assert.equal(b.kpis.calls_held, 6);
  assert.equal(b.kpis.no_shows, 1);
  assert.equal(b.kpis.close_rate, 0.5);
  assert.deepEqual(b.offers, JSON.parse(JSON.stringify(offersForClient())), "the offers the closer can mint a pay link for are the catalog's own");
  assert.ok(b.offers.length > 0);

  const [clientRead] = world.statements.filter((s) => s.name === "client");
  assert.deepEqual(clientRead.params, [CLIENT_ID, ORG_ID]);
  assertSqlHas(clientRead.sql, { company: "WHERE c.id = $1 AND c.org_id = $2" });
  const [kpi] = world.statements.filter((s) => s.name === "kpis");
  assert.deepEqual(kpi.params.slice(0, 2), [ORG_ID, STAFF_ID], "this closer's own month, in this company");
  const [shift] = world.statements.filter((s) => s.name === "shift");
  assert.deepEqual(shift.params, [ORG_ID, STAFF_ID]);
  const [crs] = world.statements.filter((s) => s.name === "crs");
  assert.deepEqual(crs.params, [CLIENT_ID, ORG_ID]);
  assertSqlHas(crs.sql, { newest: "ORDER BY created_at DESC LIMIT 1" });
  for (const entry of dataCalls(result)) {
    for (const value of entry.params || []) assert.notEqual(value, OTHER_ORG_ID, `no statement is bound to another company: ${entry.sql.slice(0, 60)}`);
  }
  noWrites(result);
  // The stand-in answers each read with canned rows, so every statement the cockpit sends is pinned as sent,
  // and none other may be: this closer's open shift (newest, still open), this closer's month in this company
  // (deposits only for 'deposit', held = not a no-show), the newest credit pull, the newest funding round with
  // its closeout joined to THAT round, the client with its business and ad line joined inside the company,
  // the tasks a call list is made of (still open, no outcome yet, this closer or nobody), the join link.
  assertOnlySent(result,
    "cockpit.client", "cockpit.shift", "cockpit.kpis", "cockpit.unlogged", "cockpit.unlogged_count", "cockpit.up_next", "cockpit.stage", "cockpit.crs",
    "cockpit.tradelines", "cockpit.liabilities", "cockpit.businesses", "cockpit.closeout", "cockpit.conversations", "cockpit.messages",
    "cockpit.applications", "cockpit.transactions", "cockpit.templates", "cockpit.quiet_deposits", "cockpit.staff_name", "cockpit.today",
    "match.client_fields", "match.businesses", "match.addresses", "match.crs5", "match.inquiries", "match.lenders",
    "match.removal_cases", "org.demo_mode");
});

test("GET read/closer-call takes the month and the day from the clock (the calendar month, UTC) and the company and closer from the session, never from the query string", async () => {
  mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-14T18:00:00.000Z") });
  try {
    const world = cockpitWorld();
    const hostileStaff = "5a000000-0000-4000-8000-0000000000ff";
    const result = await call(closerCallHandler, {
      query: { client_id: CLIENT_ID, org_id: OTHER_ORG_ID, staff_id: hostileStaff, staffId: hostileStaff, orgId: OTHER_ORG_ID }, rules: world.rules,
    });
    assert.equal(result.status, 200);
    const kpi = sentStatement(result, "cockpit.kpis");
    assert.deepEqual(kpi.params, [ORG_ID, STAFF_ID, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"], "this month: first of the month up to the first of the next");
    const today = sentStatement(result, "cockpit.today");
    assert.deepEqual(today.params, [ORG_ID, STAFF_ID, "2026-10-14T00:00:00.000Z"], "today starts at midnight of the day");
    for (const entry of dataCalls(result)) {
      for (const value of entry.params || []) {
        assert.notEqual(value, OTHER_ORG_ID);
        assert.notEqual(value, hostileStaff);
      }
    }
    assert.deepEqual(sentStatement(result, "cockpit.shift").params, [ORG_ID, STAFF_ID]);
    assert.deepEqual(sentStatement(result, "cockpit.staff_name").params, [STAFF_ID, ORG_ID]);
  } finally {
    mock.timers.reset();
  }
});

test("GET read/closer-call names the call this client is booked for and the one after it, and says nothing about a call that belongs to somebody else", async () => {
  const due = "2026-10-14T20:00:00.000Z";
  const later = "2026-10-14T22:00:00.000Z";
  const mine = { task_id: "t-mine", client_id: CLIENT_ID, due_at: due, meeting_url: "https://meet.example.test/mine", title: "Book a call", name: "Alex Rivera" };
  const theirs = { task_id: "t-theirs", client_id: OTHER_CLIENT, due_at: later, meeting_url: null, title: "Book a call", name: "Somebody Else" };
  const world = cockpitWorld({
    upNext: [mine, theirs],
    nextAfter: { task_id: "t-theirs", client_id: OTHER_CLIENT, due_at: later, title: "Book a call", name: "Somebody Else" },
  });
  const result = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.current_call, { due_at: due, task_id: "t-mine", title: "Book a call", meeting_url: "https://meet.example.test/mine" });
  assert.deepEqual(result.body.next_call, { due_at: later, task_id: "t-theirs", client_id: OTHER_CLIENT, name: "Somebody Else" });
  assert.deepEqual(result.body.up_next.map((t) => t.task_id), ["t-mine", "t-theirs"]);
  assert.equal(result.body.join_url, "https://meet.example.test/mine");
  assert.deepEqual(sentStatement(result, "cockpit.up_next").params, [ORG_ID, STAFF_ID, CLIENT_ID], "this client's own call first");
  assert.deepEqual(sentStatement(result, "cockpit.next_after").params, [ORG_ID, STAFF_ID, due], "the call after THIS one, for this closer");
  assert.equal(sentStatement(result, "cockpit.join_url"), null, "Join comes from the current task; there is no second latest-task query");

  const notBooked = cockpitWorld({ upNext: [theirs], nextAfter: { task_id: "x", client_id: OTHER_CLIENT, due_at: later, title: "x", name: "x" } });
  const other = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: notBooked.rules });
  assert.equal(other.body.current_call, null, "the head of the list is somebody else's call, so this client has none");
  assert.equal(other.body.next_call, null);
  assert.equal(sentStatement(other, "cockpit.next_after"), null, "no later call is asked for when there is no current one");
  assert.equal(other.body.join_url, null);
  const empty = cockpitWorld({});
  const none = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: empty.rules });
  assert.equal(none.body.current_call, null);
  assert.deepEqual(none.body.up_next, []);
});

test("GET read/closer-call makes the one funding number from what is stored: the pre-approval, else the stamped file, filling a missing total or part by plain arithmetic", async () => {
  const fund = async (opts) => (await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: cockpitWorld(opts).rules })).body.funding;

  const stamped = await fund({ withCredit: false, customFields: { analyzer_prequal_amount: 90000 } });
  assert.deepEqual([stamped.available, stamped.total, stamped.personal, stamped.business, stamped.source], [true, 90000, null, null, "client_custom_fields"]);
  const estimate = await fund({ withCredit: false, customFields: { total_funding_estimate: 64000 } });
  assert.deepEqual([estimate.total, estimate.source], [64000, "client_custom_fields"], "the funding estimate is the second place it looks");
  const bothStamped = await fund({ withCredit: false, customFields: { analyzer_prequal_amount: 90000, total_funding_estimate: 64000 } });
  assert.equal(bothStamped.total, 90000, "the analyzer figure comes first");

  const fromParts = await fund({ preapprovals: { totalPersonal: 40000, totalBusiness: 60000 } });
  assert.deepEqual([fromParts.personal, fromParts.business, fromParts.total, fromParts.source], [40000, 60000, 100000, "crs_preapprovals"], "the total is the parts added up");
  const noPersonal = await fund({ preapprovals: { totalBusiness: 60000, totalCombined: 100000 } });
  assert.deepEqual([noPersonal.personal, noPersonal.business, noPersonal.total], [40000, 60000, 100000], "the personal part is the total less the business part");
  const noBusiness = await fund({ preapprovals: { totalPersonal: 40000, totalCombined: 100000 } });
  assert.deepEqual([noBusiness.personal, noBusiness.business, noBusiness.total], [40000, 60000, 100000]);
  const storedWins = await fund({ preapprovals: { totalCombined: 100000 }, customFields: { analyzer_prequal_amount: 90000 } });
  assert.deepEqual([storedWins.total, storedWins.source], [100000, "crs_preapprovals"], "the stored pull's total beats the stamped figure");
  const stampedFillsTotal = await fund({ preapprovals: { totalPersonal: 40000 }, customFields: { analyzer_prequal_amount: 90000 } });
  assert.deepEqual([stampedFillsTotal.personal, stampedFillsTotal.business, stampedFillsTotal.total, stampedFillsTotal.source],
    [40000, 50000, 90000, "crs_preapprovals"], "a stamped total completes a pull that has only one part");
  const nothing = await fund({ withCredit: false });
  assert.deepEqual([nothing.available, nothing.total, nothing.source], [false, null, null]);
});

test("GET read/closer-call keeps the funding number honest: no credit pull means no lender list and no invented amount, and no closeout row means the house default fee, labelled as one", async () => {
  const world = cockpitWorld({ withCredit: false });
  const result = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  const b = result.body;
  assert.equal(b.credit.available, false);
  assert.equal(b.funding.available, false);
  assert.equal(b.funding.total, null, "nothing stored is unknown, never a confident $0");
  assert.match(b.funding.reason, /No funding estimate on this file yet/);
  assert.equal(b.underwrite.totals.source, "engine");
  assert.equal(b.underwrite.matched_lenders, null);
  assert.deepEqual(b.underwrite.lenders, []);
  assert.equal(b.underwrite.lenders_gated_on, "credit_pull");
  assert.deepEqual([b.deal.success_fee_percent, b.deal.success_fee_source], [0.1, "default"]);
  assert.equal(b.deal.closeout_total_fee, null);
  assert.equal(b.underwrite.funding_round_id, null);
});

test("GET read/closer-call reports no close rate when no call was held, and a shift left open for days as never clocked out, not as hours on shift", async () => {
  const stale = new Date(Date.now() - 3 * 24 * 3600e3).toISOString();
  const world = cockpitWorld({ kpi: { cash_cents: "0", deposits: 0, held: 0, no_shows: 2 }, shiftStarted: stale });
  const result = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.equal(result.body.kpis.close_rate, null, "nothing held is unknown, not 0%");
  assert.equal(result.body.kpis.no_shows, 2);
  assert.equal(result.body.kpis.cash_month_cents, 0);
  assert.equal(result.body.staff.shift.on_shift, false);
  assert.equal(result.body.staff.shift.never_closed, true);
  assert.match(result.body.staff.shift.reason, /never clocked out/);
});

test("the closer's lender count is held back until credit is pulled, and says what it was decided on, never claiming the file was weighed when it was not", () => {
  const withheld = gateLenderMatch({ credit: { available: false }, lenders: { match_count: 307, matches: [{ name: "x" }] } });
  assert.deepEqual([withheld.matched_lenders, withheld.lenders, withheld.lenders_gated_on], [null, [], "credit_pull"], "no credit file, no count and no list, not even 0");

  const none = gateLenderMatch({ credit: { available: true }, lenders: { match_count: 0, matches: [] } });
  assert.equal(none.matched_lenders, 0);
  assert.match(none.lenders_reason, /No lenders matched/);
  assert.match(none.lenders_basis, /The credit file was not read into this match/);

  const unstated = gateLenderMatch({ credit: { available: true }, lenders: { match_count: 3, matches: [1, 2, 3], summary: { credit: { available: true, lenders_with_stated_minimum: 0 } } } });
  assert.equal(unstated.matched_lenders, 3);
  assert.equal(unstated.lenders_reason, null);
  assert.match(unstated.lenders_basis, /No lender on the list records a minimum score, so the score ruled none of them out\./);

  const one = gateLenderMatch({ credit: { available: true }, lenders: { match_count: 2, matches: [1, 2], summary: { credit: { available: true, lenders_with_stated_minimum: 1, lenders_excluded_on_score: 1, lenders_with_unreadable_requirement: 0 } } } });
  assert.match(one.lenders_basis, /1 lender record a minimum score; 1 was ruled out on this file\.$/);
  const many = gateLenderMatch({ credit: { available: true }, lenders: { match_count: 5, matches: [1], summary: { credit: { available: true, lenders_with_stated_minimum: 4, lenders_excluded_on_score: 2, lenders_with_unreadable_requirement: 2 } } } });
  assert.match(many.lenders_basis, /4 lenders record a minimum score; 2 were ruled out on this file\. 2 more mention a score in wording we could not read, and were kept rather than dropped\.$/);
  const single = gateLenderMatch({ credit: { available: true }, lenders: { match_count: 5, matches: [1], summary: { credit: { available: true, lenders_with_stated_minimum: 4, lenders_excluded_on_score: 2, lenders_with_unreadable_requirement: 1 } } } });
  assert.match(single.lenders_basis, /1 more mentions a score/);
});

test("GET read/closer-call answers 404 for another company's client, 400 for a missing or bad client id, 403 with no company, and is for staff only", async () => {
  const other = cockpitWorld({ clientOrg: OTHER_ORG_ID });
  const result = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, rules: other.rules });
  assert.equal(result.status, 404);
  assert.deepEqual(result.body, { ok: false, error: "client_not_found" });
  assert.equal(other.statements.filter((s) => s.name === "crs").length, 0, "nothing about the client is read after the company check fails");

  const missing = await call(closerCallHandler, { query: {}, rules: [] });
  assert.equal(missing.status, 400);
  const bad = await call(closerCallHandler, { query: { client_id: "nope" }, rules: [] });
  assert.equal(bad.status, 400);
  const noCompany = await call(closerCallHandler, { query: { client_id: CLIENT_ID }, staff: { org_id: null }, rules: [] });
  assert.equal(noCompany.status, 403);
  const post = await call(closerCallHandler, { method: "POST", query: { client_id: CLIENT_ID }, rules: [] });
  assert.equal(post.status, 405);
  await assertRoleGate(closerCallHandler, STAFF_ROLES, { query: { client_id: CLIENT_ID }, rules: cockpitWorld().rules });
});

/* ── read/closer-now ───────────────────────────────────────────────────────────────────────────────── */

test("GET read/closer-now answers the call this closer is on and the one after, from open closer tasks that have no outcome yet, for this closer and this company", async () => {
  const seen = [];
  const rows = [
    { task_id: "t1", client_id: CLIENT_ID, due_at: "2026-10-14T16:00:00.000Z", meeting_url: "https://meet.example.test/a", title: "Book a call", name: "Alex Rivera" },
    { task_id: "t2", client_id: PARTNER_CLIENT, due_at: "2026-10-14T19:00:00.000Z", meeting_url: null, title: "Book a call", name: "Sam Partner" },
    { task_id: "t3", client_id: OTHER_CLIENT, due_at: "2026-10-14T21:00:00.000Z", meeting_url: null, title: "Book a call", name: "Third" },
  ];
  const result = await call(closerNowHandler, { rules: [[/FROM tasks t\s+LEFT JOIN clients c/, (sql, params) => { seen.push({ sql, params }); return rows.slice(0, 2); }]] });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.current.task_id, "t1");
  assert.equal(result.body.current.name, "Alex Rivera");
  assert.equal(result.body.next.task_id, "t2");
  assert.deepEqual(seen[0].params.slice(0, 2), [ORG_ID, STAFF_ID], "scoped to the signed-in closer in their company");
  assert.match(seen[0].params[2], /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Math.abs(Date.now() - Date.parse(seen[0].params[2])) < 60_000, "the day boundary is worked out from now, not from a fixed time");
  // The stand-in returns the same rows for any statement, so the whole statement is pinned as sent: the
  // day boundary, the open-call test (a call with no outcome logged), the company and the closer.
  assertOnlySent(result, "closer.now");
  assertSqlHas(seen[0].sql, {
    company: "WHERE t.org_id = $1",
    closerTasks: "AND t.assignee_role = 'closer'",
    mineOrUnassigned: "AND (t.assignee_staff_id = $2 OR t.assignee_staff_id IS NULL)",
    notLogged: "AND o.id IS NULL",
    soonestFirst: "ORDER BY t.due_at ASC LIMIT 2",
  });

  const hostile = await call(closerNowHandler, {
    query: { staff_id: "5a000000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG_ID }, rules: [[/FROM tasks t\s+LEFT JOIN clients c/, (_sql, params) => { seen.push({ params }); return []; }]],
  });
  assert.equal(hostile.status, 200);
  assert.deepEqual(seen.at(-1).params.slice(0, 2), [ORG_ID, STAFF_ID], "a closer or company in the query string is never used");
  const none = await call(closerNowHandler, { rules: [[/FROM tasks t/, []]] });
  assert.deepEqual(none.body, { ok: true, current: null, next: null });
  const one = await call(closerNowHandler, { rules: [[/FROM tasks t/, [rows[0]]]] });
  assert.equal(one.body.next, null);
  const noCompany = await call(closerNowHandler, { staff: { org_id: null }, rules: [] });
  assert.equal(noCompany.status, 403);
  const post = await call(closerNowHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
  await assertRoleGate(closerNowHandler, STAFF_ROLES, { rules: [[/FROM tasks t/, []]] });
});

/* ── read/company-activity (Galaxy) ────────────────────────────────────────────────────────────────── */

function galaxyWorld({ demoMode = false } = {}) {
  const staff = [
    { id: "s-closer", org_id: ORG_ID, name: "Casey Closer", role: "closer", is_demo: false, open_shift_id: "sh-1", shift_started_at: new Date(Date.now() - 90 * 60000).toISOString(), events_today: 5, events_15m: 1, calls_today: 3 },
    { id: "s-inq", org_id: ORG_ID, name: "Ira Inquiry", role: "inquiry_specialist", is_demo: false, open_shift_id: null, shift_started_at: null, events_today: 0, events_15m: 0, calls_today: 0 },
    { id: "s-demo", org_id: ORG_ID, name: "Demo Dan", role: "closer", is_demo: true, open_shift_id: null, shift_started_at: null, events_today: 0, events_15m: 0, calls_today: 0 },
    { id: "s-other", org_id: OTHER_ORG_ID, name: "Other Company", role: "closer", is_demo: false, open_shift_id: null, shift_started_at: null, events_today: 0, events_15m: 0, calls_today: 0 },
  ];
  const seen = { staff: null, agents: null, clients: null, money: null, org: null };
  const rules = [
    [/^\s*SELECT demo_mode_enabled FROM orgs WHERE id = \$1/, (_sql, params) => { seen.org = params; return [{ demo_mode_enabled: demoMode }]; }],
    [/FROM staff s\s+LEFT JOIN shifts sh/, (sql, params) => {
      seen.staff = { sql, params };
      const filtersDemo = /\(\$2::boolean OR COALESCE\(s\.is_demo, false\) = false\)\s+ORDER BY s\.role/.test(sql);
      return staff.filter((s) => s.org_id === params[0] && (!filtersDemo || params[1] || !s.is_demo));
    }],
    [/FROM staff_events e\s+WHERE e\.org_id = \$1 AND e\.staff_id = ANY/, []],
    [/FROM call_outcomes co\s+JOIN clients c ON c\.id = co\.client_id/, []],
    [/FROM agents a\s+WHERE a\.org_id = \$1/, (sql, params) => {
      seen.agents = { sql, params };
      return [{ code: "setter-1", name: "Setter Agent", agent_class: "cfa", channel: "sms_text", status: "live", runtime: "inngest", went_live_at: new Date(Date.now() - 3600e3).toISOString(), sort_order: 1, runs_today: 6, runs_15m: 2, blocked_15m: 1 }];
    }],
    [/^\s*SELECT trim\(both FROM concat_ws\(' ', first_name, last_name\)\) AS name, is_demo\s+FROM clients/, (sql, params) => {
      seen.clients = { sql, params };
      return [{ name: "Alex Rivera", is_demo: false }, { name: "Demo Client", is_demo: true }].filter((c) => demoMode || !c.is_demo);
    }],
    [/AS cash_cents,\s+\(SELECT COALESCE\(SUM\(funded_amount\)/, (sql, params) => {
      seen.money = { sql, params };
      return [{ cash_cents: "1234500", funded_today: "75000", deposits_today: 4 }];
    }],
  ];
  return { rules, seen };
}

test("GET read/company-activity answers who is on shift, the agents that are live, today's money and client names, for this company, leaving demo people out unless demo mode is on", async () => {
  const world = galaxyWorld();
  const result = await call(companyActivityHandler, { rules: world.rules });
  assert.equal(result.status, 200);
  const b = result.body;
  assert.equal(b.ok, true);
  assert.equal(b.demo_mode, false);
  assert.equal(b.simulated, false);
  assert.deepEqual(b.nodes.map((n) => n.id), ["staff:s-closer", "staff:s-inq", "agent:setter-1"], "this company's people and live agents; no demo person, no other company");
  const closer = b.nodes[0];
  assert.equal(closer.name, "Casey Closer");
  assert.equal(closer.state, "active");
  assert.equal(closer.out, 8, "events today plus calls today");
  assert.equal(closer.pace, 1, "against a target of 8 calls for a closer");
  assert.equal(closer.role, "Closer");
  assert.equal(closer.unit, "calls");
  assert.deepEqual(closer.stats[0], ["Events today", "5"]);
  assert.equal(b.nodes[1].state, "idle");
  assert.equal(b.nodes[1].act, "Idle — no open shift");
  assert.equal(b.nodes[2].kind, "agent");
  assert.equal(b.nodes[2].state, "blocked");
  assert.equal(b.nodes[2].out, 6, "agent output is today's saved run count");
  assert.equal(b.nodes[2].c, "cfa");
  assert.deepEqual(b.clients, ["Alex Rivera"]);
  assert.deepEqual(b.kpis.map((k) => [k.id, k.v]), [["cash", 12345], ["fund", 75000], ["move", 4]], "cash is cents turned into dollars");

  assert.deepEqual(world.seen.org, [ORG_ID]);
  assert.deepEqual(world.seen.staff.params, [ORG_ID, false]);
  assertSqlHas(world.seen.staff.sql, {
    company: "WHERE s.org_id = $1",
    people: "AND s.role NOT IN ('client', 'affiliate', 'partner')",
    demo: "AND ($2::boolean OR COALESCE(s.is_demo, false) = false)",
  });
  assert.deepEqual(world.seen.agents.params, [ORG_ID]);
  assertSqlHas(world.seen.agents.sql, {
    liveOnly: "a.status IN ('live', 'shadow')",
    notRetired: "a.retired_at IS NULL",
    output: "FROM agent_runs r WHERE r.org_id = a.org_id AND r.agent_code = a.code AND r.created_at >= date_trunc('day', now())",
    blocked: "FROM agent_shadow_log l",
    blockedReasons: "l.reason IN ('guardrail_halt', 'guardrail_block')",
  });
  assert.deepEqual(world.seen.money.params, [ORG_ID]);
  assertOnlySent(result, "org.demo_mode", "galaxy.staff", "galaxy.timeline", "galaxy.files", "galaxy.agents", "galaxy.clients", "galaxy.money");
  assertSqlHas(world.seen.money.sql, {
    cashNoDemo: "FROM call_outcomes WHERE org_id = $1 AND COALESCE(is_demo, false) = false AND logged_at >= date_trunc('day', now())) AS cash_cents",
    fundedNoDemo: "FROM clients WHERE org_id = $1 AND COALESCE(is_demo, false) = false AND funded IS TRUE",
    depositsNoDemo: "FROM call_outcomes WHERE org_id = $1 AND COALESCE(is_demo, false) = false AND logged_at >= date_trunc('day', now()) AND outcome = 'deposit'",
  });
  noWrites(result);
});

test("GET read/company-activity shows demo people only when this company's demo mode is on, marked DEMO, and never counts them in the money", async () => {
  const world = galaxyWorld({ demoMode: true });
  const result = await call(companyActivityHandler, { rules: world.rules });
  assert.equal(result.status, 200);
  assert.equal(result.body.demo_mode, true);
  assert.deepEqual(world.seen.staff.params, [ORG_ID, true]);
  assert.ok(result.body.nodes.some((n) => n.id === "staff:s-demo" && n.name === "DEMO · Demo Dan" && n.is_demo === true));
  assert.deepEqual(result.body.clients, ["Alex Rivera", "DEMO · Demo Client"]);
  assertSqlHas(world.seen.money.sql, { noDemoMoney: "WHERE org_id = $1 AND COALESCE(is_demo, false) = false" });
  const noCompany = await call(companyActivityHandler, { staff: { org_id: null }, rules: [] });
  assert.equal(noCompany.status, 403);
  const post = await call(companyActivityHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
  await assertRoleGate(companyActivityHandler, STAFF_ROLES, { rules: galaxyWorld().rules });
});

/* ── read/csm-queue ────────────────────────────────────────────────────────────────────────────────── */

test("GET read/csm-queue lists the CSM's open tasks with who owes what (cents, unknown stays null), what each client already owns, and pages with hasMore", async () => {
  const seen = [];
  const row = (n, over = {}) => ({
    org_id: ORG_ID, task_id: `t${n}`, title: `Call ${n}`, due_at: `2026-10-1${n}T16:00:00.000Z`, source_workflow: "welcome", meeting_url: null,
    assignee_staff_id: null, assigned_csm_staff_id: STAFF_ID, assigned_csm_name: "Cam CSM", client_id: `c${n}`, client_name: `Client ${n}`, client_code: `FH-00${n}`,
    balance_amount: null, open_invoices: null, worst_days_overdue: null, owned_codes: [], ...over,
  });
  const rows = [
    row(1, { balance_amount: "500.00", open_invoices: "2", worst_days_overdue: "31", owned_codes: ["roadmap"] }),
    row(2),
    row(3, { balance_amount: "0.05", open_invoices: 1, worst_days_overdue: 0 }),
    { ...row(9), org_id: OTHER_ORG_ID, task_id: "other", client_name: "Not ours" },
  ];
  const result = await call(csmQueueHandler, {
    query: { limit: "2" },
    rules: [[/WITH owed AS/, (sql, params) => {
      seen.push({ sql, params });
      const scoped = /WHERE t\.org_id = \$1/.test(sql);
      return rows.filter((r) => !scoped || r.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest);
    }]],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.limit, 2);
  assert.equal(result.body.hasMore, true, "one row more than asked for says there is a next page");
  assert.equal(result.body.count, 2);
  assert.deepEqual(result.body.items.map((i) => i.task_id), ["t1", "t2"]);
  const [first, second] = result.body.items;
  assert.equal(first.balance_due_cents, 50000, "dollars off the aging view become whole cents");
  assert.equal(first.balance_due, "500.00");
  assert.equal(first.open_invoices, 2);
  assert.equal(first.bill_days_overdue, 31);
  assert.deepEqual(first.owned_codes, ["roadmap"]);
  assert.equal(first.client_name, "Client 1");
  assert.equal(second.balance_due_cents, null, "no invoice is unknown, never 0");
  assert.equal(second.balance_due, null);
  assert.equal(second.bill_days_overdue, null);
  assert.equal(second.open_invoices, 0);
  assert.deepEqual(seen[0].params, [ORG_ID, 2, 0]);
  assertSqlHas(seen[0].sql, {
    company: "WHERE t.org_id = $1",
    agingCompany: "FROM v_invoice_aging WHERE org_id = $1",
    owesOnly: "AND open_balance > 0",
    entitlementsCompany: "FROM v_client_entitlements WHERE org_id = $1",
    activeOnly: "AND active",
    csmOnly: "AND t.assignee_role = 'csm'",
    openOnly: "AND t.done = false",
    soonest: "ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC",
    oneMore: "LIMIT $2 + 1 OFFSET $3",
  });

  assertOnlySent(result, "csm.queue");
  const hostile = await call(csmQueueHandler, {
    query: { org_id: OTHER_ORG_ID, limit: "2" }, rules: [[/WITH owed AS/, (_sql, params) => { seen.push({ params }); return []; }]],
  });
  assert.equal(hostile.status, 200);
  assert.deepEqual(seen.at(-1).params, [ORG_ID, 2, 0], "a company in the query string is ignored");
  const nextPage = await call(csmQueueHandler, { query: { limit: "50", offset: "50" }, rules: [[/WITH owed AS/, (_sql, params) => { seen.push({ params }); return []; }]] });
  assert.deepEqual(seen.at(-1).params, [ORG_ID, 50, 50]);
  assert.equal(nextPage.body.hasMore, false);
  noWrites(result);
});

test("GET read/csm-queue is for staff only, refuses a session with no company, POST is refused, and a database that is down answers 503 not a crash", async () => {
  await assertRoleGate(csmQueueHandler, STAFF_ROLES, { rules: [[/WITH owed AS/, []]] });
  const noCompany = await call(csmQueueHandler, { staff: { org_id: null }, rules: [] });
  assert.equal(noCompany.status, 403);
  const post = await call(csmQueueHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
  const down = await call(csmQueueHandler, { rules: [[/WITH owed AS/, Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })]] });
  assert.equal(down.status, 503);
});

/* ── read/finance-ask ──────────────────────────────────────────────────────────────────────────────── */

function financeWorld({ cash = [{ account_type: "checking", current_balance_cents: "800000", closed_at: null }], cards = [], clients = [{ id: CLIENT_ID, org_id: ORG_ID }] } = {}) {
  const seen = { bank: null, cards: null, invest: null, owns: null };
  const rules = [
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, (sql, params) => { seen.owns = { sql, params }; return rowsWhere(clients, sql, params).map(() => ({ "?column?": 1 })); }],
    [/FROM bank_accounts WHERE org_id = \$1/, (sql, params) => { seen.bank = { sql, params }; return cash; }],
    [/FROM tradelines WHERE org_id = \$1/, (sql, params) => { seen.cards = { sql, params }; return cards; }],
    [/FROM investment_holdings ih JOIN bank_accounts ba/, (sql, params) => { seen.invest = { sql, params }; return []; }],
  ];
  return { rules, seen };
}
const ask = (world, body, opts = {}) => call(financeAskHandler, { method: "POST", body, rules: world.rules, ...opts });

test("POST read/finance-ask answers can-I-afford from known cash, says the shortfall, and treats a cash total built from partial balances as a floor", async () => {
  const yes = await ask(financeWorld(), { question: "Can I afford $5,000?" });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.ok, true);
  assert.equal(yes.body.answer.thin_data, false);
  assert.match(yes.body.answer.text, /^Yes — known cash on hand is \$8000\.00, which covers \$5000\.00\./);
  assert.deepEqual(yes.body.answer.figures, [{ label: "cash_on_hand", value: "$8000.00" }, { label: "asked", value: "$5000.00" }]);
  assert.equal(yes.body.client_id, null);
  assert.match(yes.body.as_of, /^\d{4}-\d{2}-\d{2}$/);

  const partial = financeWorld({ cash: [
    { account_type: "checking", current_balance_cents: "300000", closed_at: null },
    { account_type: "savings", current_balance_cents: null, closed_at: null },
    { account_type: "checking", current_balance_cents: "999999", closed_at: "2026-01-01" },
    { account_type: "credit", current_balance_cents: "777777", closed_at: null },
  ] });
  const no = await ask(partial, { question: "afford 5000" });
  assert.match(no.body.answer.text, /^No — known cash on hand is \$3000\.00, short of the \$5000\.00 asked about by \$2000\.00\./);
  assert.match(no.body.answer.text, /That cash figure is a floor, not a total/);
  assert.equal(no.body.answer.thin_data, false);

  const exact = await ask(financeWorld({ cash: [{ account_type: "checking", current_balance_cents: "500000", closed_at: null }] }), { question: "can I afford $5,000" });
  assert.match(exact.body.answer.text, /^Yes — /, "cash equal to the amount covers it");

  const unknown = await ask(financeWorld({ cash: [{ account_type: "checking", current_balance_cents: null, closed_at: null }] }), { question: "can I afford $100" });
  assert.equal(unknown.body.answer.thin_data, true, "no known balance is said, not guessed");
  assert.match(unknown.body.answer.text, /Cash on hand is unknown/);
  const noAmount = await ask(financeWorld(), { question: "can I afford it" });
  assert.equal(noAmount.body.answer.thin_data, true);
  assert.match(noAmount.body.answer.text, /No dollar amount found/);
});

test("POST read/finance-ask ranks the card to pay down by utilization, refuses the funding-readiness question by name, and answers anything else as thin data", async () => {
  const cards = [
    { client_id: CLIENT_ID, lender: "Chase", credit_limit_cents: "1000000", current_balance_cents: "250000", closed_at: null },
    { client_id: CLIENT_ID, lender: "Amex", credit_limit_cents: "500000", current_balance_cents: "450000", closed_at: null },
    { client_id: CLIENT_ID, lender: "Old Card", credit_limit_cents: "100000", current_balance_cents: "100000", closed_at: "2025-01-01" },
    { client_id: CLIENT_ID, lender: "No Limit", credit_limit_cents: null, current_balance_cents: "50000", closed_at: null },
  ];
  const world = financeWorld({ cards });
  const result = await ask(world, { question: "Which card should I pay down first?" });
  assert.equal(result.status, 200);
  assert.match(result.body.answer.text, /^Amex — it is at 90\.0% utilization, the highest of the 2 card\(s\) in scope\./);
  assert.deepEqual(result.body.answer.figures, [{ label: "Amex", value: "90.0%" }, { label: "Chase", value: "25.0%" }]);

  const none = await ask(financeWorld({ cards: [] }), { question: "pay off which card" });
  assert.equal(none.body.answer.thin_data, true);
  assert.match(none.body.answer.text, /cannot be ranked/);

  const ready = await ask(financeWorld(), { question: "Am I ready for another funding round?" });
  assert.equal(ready.body.answer.thin_data, true);
  assert.match(ready.body.answer.text, /no funding-readiness rule yet/);
  assert.deepEqual(ready.body.answer.figures, []);
  const other = await ask(financeWorld(), { question: "What is the weather?" });
  assert.equal(other.body.answer.thin_data, true);
  assert.match(other.body.answer.text, /This can answer/);
});

test("POST read/finance-ask reads this company's numbers (or one client's when named), 404s a client of another company, and refuses bad input and non-staff", async () => {
  const company = financeWorld();
  await ask(company, { question: "afford $10" });
  assert.deepEqual(company.seen.bank.params, [ORG_ID]);
  assertSqlHas(company.seen.bank.sql, { company: "WHERE org_id = $1" });
  assert.deepEqual(company.seen.cards.params, [ORG_ID]);
  assertSqlHas(company.seen.cards.sql, { company: "WHERE org_id = $1", noLoans: "kind <> 'installment'" });
  assert.equal(company.seen.owns, null, "no client named, so no client check");

  const one = financeWorld();
  const named = await ask(one, { question: "afford $10", client_id: CLIENT_ID });
  assert.equal(named.status, 200);
  assert.equal(named.body.client_id, CLIENT_ID);
  assert.deepEqual(one.seen.owns.params, [CLIENT_ID, ORG_ID]);
  assert.deepEqual(one.seen.bank.params, [ORG_ID, CLIENT_ID]);
  assertSqlHas(one.seen.bank.sql, { client: "AND client_id = $2" });
  assert.deepEqual(one.seen.cards.params, [ORG_ID, CLIENT_ID]);
  assert.deepEqual(one.seen.invest.params, [ORG_ID, CLIENT_ID]);
  assertSqlHas(one.seen.invest.sql, { client: "AND ih.client_id = $2" });

  const foreign = financeWorld({ clients: [{ id: OTHER_CLIENT, org_id: OTHER_ORG_ID }] });
  const notMine = await ask(foreign, { question: "afford $10", client_id: OTHER_CLIENT });
  assert.equal(notMine.status, 404);
  assert.equal(notMine.body.error, "no_such_client");
  assert.equal(foreign.seen.bank, null, "no number is read for a client that is not this company's");

  const noQuestion = await ask(financeWorld(), { question: "  " });
  assert.equal(noQuestion.status, 400);
  const badClient = await ask(financeWorld(), { question: "afford $10", client_id: "nope" });
  assert.equal(badClient.status, 400);
  const get = await call(financeAskHandler, { method: "GET", rules: [] });
  assert.equal(get.status, 405);
  const noCompany = await ask(financeWorld(), { question: "afford $10" }, { staff: { org_id: null } });
  assert.equal(noCompany.status, 403);
  await assertRoleGate(financeAskHandler, STAFF_ROLES, { method: "POST", body: { question: "afford $10" }, rules: financeWorld().rules });
});
