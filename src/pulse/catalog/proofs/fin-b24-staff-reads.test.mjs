// Batch 24 (finish the 853), staff doors, part 1: the real api/ handler, a
// stand-in database that answers by the conditions the SQL text names, and
// nothing that leaves the building. Each test judges the exact result the
// catalog row names, who may ask, and which company the statement is bound to.
//
// This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test, { mock } from "node:test";

import adVideosHandler from "../../../../api/ad-videos.mjs";
import dashboardKpis from "../../../../api/dashboard/kpis.mjs";
import inquiryHandler from "../../../../api/inquiry.mjs";
import lenderObservations from "../../../../api/lender-observations.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { tableRules } from "../../../testing/s3-scoped-rows.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";

const OBS_ID = "0b500000-0000-4000-8000-000000000001";
const OTHER_OBS_ID = "0b500000-0000-4000-8000-0000000000ff";
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

/* ── lender-observations: log which bureau a lender pulled, or review one ── */

function observationRows() {
  return [
    { id: OBS_ID, org_id: ORG_ID, lender_name: "Chase", observed_bureau: "EQ", review_status: "pending", notes: null, created_by: null },
    // Another company's row with the SAME id: a lost company condition would change it.
    { id: OBS_ID, org_id: OTHER_ORG_ID, lender_name: "Their bank", observed_bureau: "TU", review_status: "pending", notes: null, created_by: null },
  ];
}

test("lender-observations log saves which bureau pulled, flags a mismatch against what the lender is known to pull, for this company", async () => {
  assert.equal(ROUTES["lender-observations"], lenderObservations);
  const insert = [/INSERT INTO lender_bureau_observations/, (_sql, p) => [{
    id: OBS_ID, org_id: p[0], client_id: p[2], lender_name: p[4], expected_bureaus_raw: p[7], observed_bureau: p[8],
    observation_source: p[9], mismatch_flag: p[10], review_status: p[11], notes: p[12], created_by: p[13],
  }]];

  // Chase is known to pull Experian and TransUnion. Equifax actually pulled: a mismatch.
  const mismatch = await hit(lenderObservations, {
    method: "POST", role: "funding_advisor",
    body: { action: "log", observed_bureau: "Equifax", expected_bureaus_raw: "Experian, TransUnion", lender_name: "Chase", client_id: CLIENT_ID, notes: " rep said so " , observation_source: "staff_report" },
    rules: [insert],
  });
  assert.equal(mismatch.status, 200);
  const [call] = sqlCalls(mismatch, /INSERT INTO lender_bureau_observations/);
  assert.equal(call.params[0], ORG_ID, "the row is saved for the session's company");
  assert.equal(call.params[2], CLIENT_ID);
  assert.equal(call.params[4], "Chase");
  assert.equal(call.params[7], "Experian, TransUnion");
  assert.equal(call.params[8], "Equifax");
  assert.equal(call.params[9], "staff_report");
  assert.equal(call.params[10], true, "Equifax is not one of the bureaus Chase is known to pull");
  assert.equal(call.params[11], "pending", "a new observation waits for a person to review it");
  assert.equal(mismatch.body.observation.mismatch_flag, true);
  assert.equal(mismatch.body.observation.org_id, ORG_ID);

  // The bureau that was expected pulled: no mismatch.
  const match = await hit(lenderObservations, {
    method: "POST", role: "admin",
    body: { observed_bureau: "TransUnion", expected_bureaus_raw: "Experian, TransUnion", lender_name: "Chase" },
    rules: [insert],
  });
  assert.equal(match.status, 200);
  assert.equal(sqlCalls(match, /INSERT INTO lender_bureau_observations/)[0].params[10], false);

  // An unknown source word is stored as manual, never as a made-up channel.
  const odd = await hit(lenderObservations, {
    method: "POST", body: { observed_bureau: "EX", expected_bureaus_raw: "EX", observation_source: "psychic" }, rules: [insert],
  });
  assert.equal(sqlCalls(odd, /INSERT INTO lender_bureau_observations/)[0].params[9], "manual");

  // Without the bureau that pulled there is nothing to log, and nothing is written.
  const blank = await hit(lenderObservations, { method: "POST", body: { action: "log", lender_name: "Chase" }, rules: [insert] });
  assert.equal(blank.status, 400);
  assert.equal(blank.body.error, "observed_bureau_required");
  assert.equal(sqlCalls(blank, /INSERT INTO lender_bureau_observations/).length, 0);
});

test("lender-observations review changes only this company's observation, with a word the table allows, and says not found for another company's", async () => {
  const rows = observationRows();
  const rules = tableRules("lender_bureau_observations", rows, {
    set: (row, p) => { row.review_status = p[2]; if (p.length > 3) row.notes = p[3]; },
  });
  const done = await hit(lenderObservations, {
    method: "POST", role: "funding_advisor",
    body: { action: "review", id: OBS_ID, review_status: "confirmed", notes: "bank confirmed by phone" }, rules,
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.observation.review_status, "confirmed");
  assert.equal(done.body.observation.lender_name, "Chase");
  assert.equal(rows[0].review_status, "confirmed");
  assert.equal(rows[1].review_status, "pending", "another company's observation with the same id is untouched");
  assert.match(sqlCalls(done, /UPDATE lender_bureau_observations/)[0].sql, /WHERE org_id = \$1::uuid AND id = \$2::uuid/);

  // Only another company's row exists: not found, and it stays as it was.
  const foreign = [{ ...observationRows()[1], id: OTHER_OBS_ID }];
  const missing = await hit(lenderObservations, {
    method: "POST", body: { action: "review", id: OTHER_OBS_ID, review_status: "dismissed" },
    rules: tableRules("lender_bureau_observations", foreign, { set: (row, p) => { row.review_status = p[2]; } }),
  });
  assert.equal(missing.status, 404);
  assert.equal(foreign[0].review_status, "pending");

  const badWord = await hit(lenderObservations, { method: "POST", body: { action: "review", id: OBS_ID, review_status: "approved" }, rules });
  assert.equal(badWord.status, 400);
  assert.equal(badWord.body.error, "invalid_review_status");
  const noId = await hit(lenderObservations, { method: "POST", body: { action: "review", id: "nope", review_status: "confirmed" }, rules });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.error, "id_required");
  const unknown = await hit(lenderObservations, { method: "POST", body: { action: "delete", id: OBS_ID }, rules });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, "unknown_action");
});

test("lender-observations lets in exactly owner, admin and funding advisor and refuses every other role before any data is read", async () => {
  await assertRoleGate(lenderObservations, ["owner", "admin", "funding_advisor"], {
    method: "POST", body: { action: "review", id: OBS_ID, review_status: "confirmed" },
  });
  const get = await hit(lenderObservations, { method: "GET" });
  assert.equal(get.status, 405);
});

/* ── inquiry: the Specialist desk's open cases and one outbound call row ─── */

const CASE_A = { id: "1c000000-0000-4000-8000-00000000000a", case_id: "IR-1", client_id: CLIENT_ID, case_status: "In Progress", selected_bureaus_raw: "EQ", call_fired_at: null, ai_call_status: null, open_inquiry_count: 3, created_at: "2026-10-12T10:00:00.000Z", org_id: ORG_ID };
const CASE_B = { ...CASE_A, id: "1c000000-0000-4000-8000-00000000000b", case_id: "IR-2", case_status: "Queued", created_at: "2026-10-13T10:00:00.000Z" };
const CASE_DONE = { ...CASE_A, id: "1c000000-0000-4000-8000-00000000000c", case_id: "IR-DONE", case_status: "Completed", created_at: "2026-10-14T10:00:00.000Z" };
const CASE_CANCELED = { ...CASE_A, id: "1c000000-0000-4000-8000-00000000000d", case_id: "IR-CANCELED", case_status: "Canceled", created_at: "2026-10-15T10:00:00.000Z" };
const CASE_X = { ...CASE_A, id: "1c000000-0000-4000-8000-0000000000ff", case_id: "IR-X", org_id: OTHER_ORG_ID };

function inquiryCaseRules() {
  return [[/FROM inquiry_removal_cases/, shelf([CASE_X, CASE_A, CASE_B, CASE_DONE, CASE_CANCELED], [
    clause(/WHERE org_id = \$1::uuid/, (row, p) => row.org_id === p[0]),
    clause(/AND case_status::text = \$2/, (row, p) => row.case_status === p[1]),
    clause(/AND case_status::text NOT IN \('Completed','Canceled'\)/, (row) => !["Completed", "Canceled"].includes(row.case_status)),
  ])]];
}

test("inquiry GET action=cases lists only this company's open cases newest first, can explicitly narrow to a closed status, and action=status reads one call row of this company", async () => {
  assert.equal(ROUTES.inquiry, inquiryHandler);
  const all = await hit(inquiryHandler, { role: "inquiry_specialist", query: { action: "cases" }, rules: inquiryCaseRules() });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.cases.map((c) => c.case_id).sort(), ["IR-1", "IR-2"], "another company's case never reaches the desk");
  const [list] = sqlCalls(all, /FROM inquiry_removal_cases/);
  assert.deepEqual(list.params, [ORG_ID]);
  assert.match(list.sql, /case_status::text NOT IN \('Completed','Canceled'\)/, "the default desk leaves completed and canceled cases out");
  assert.match(list.sql, /ORDER BY created_at DESC LIMIT 100/);

  const completed = await hit(inquiryHandler, { role: "admin", query: { action: "cases", status: "Completed" }, rules: inquiryCaseRules() });
  assert.deepEqual(completed.body.cases.map((c) => c.case_id), ["IR-DONE"]);
  assert.deepEqual(sqlCalls(completed, /FROM inquiry_removal_cases/)[0].params, [ORG_ID, "Completed"]);
  assert.doesNotMatch(sqlCalls(completed, /FROM inquiry_removal_cases/)[0].sql, /NOT IN/, "an explicit status can still retrieve closed history");

  const CALL = { call_id: "call-1", client_id: CLIENT_ID, org_id: ORG_ID, kind: "bureau", created_at: "2026-10-13T11:00:00.000Z" };
  const callRules = [[/FROM outbound_calls/, shelf([{ ...CALL, org_id: OTHER_ORG_ID }, CALL], [
    clause(/WHERE call_id = \$1 AND org_id = \$2::uuid/, (row, p) => row.call_id === p[0] && row.org_id === p[1]),
  ])]];
  const found = await hit(inquiryHandler, { query: { action: "status", call_id: "call-1" }, rules: callRules });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body.call, { call_id: "call-1", client_id: CLIENT_ID, org_id: ORG_ID, kind: "bureau", created_at: CALL.created_at });
  const gone = await hit(inquiryHandler, { query: { action: "status", call_id: "call-9" }, rules: callRules });
  assert.equal(gone.status, 404);
  const none = await hit(inquiryHandler, { query: { action: "status" }, rules: callRules });
  assert.equal(none.status, 400);
  assert.equal(none.body.error, "call_id_required");
  const wrongVerb = await hit(inquiryHandler, { method: "POST", query: { action: "cases" }, rules: inquiryCaseRules() });
  assert.equal(wrongVerb.status, 405);
  assert.equal(sqlCalls(wrongVerb, /FROM inquiry_removal_cases/).length, 0);
});

test("inquiry lets in the inquiry specialist, admin and owner only; every other role is refused before any case is read", async () => {
  await assertRoleGate(inquiryHandler, ["owner", "admin", "inquiry_specialist"], { query: { action: "cases" } });
});

/* ── ad-videos: filmed takes and where each one is stuck ─────────────────── */

const TAKE_1 = { id: "ad000000-0000-4000-8000-000000000001", org_id: ORG_ID, ad_id: "43", take_no: 1, status: "awaiting_approval", created_at: "2026-10-12T09:00:00.000Z" };
const TAKE_2 = { id: "ad000000-0000-4000-8000-000000000002", org_id: ORG_ID, ad_id: "43", take_no: 2, status: "editing", created_at: "2026-10-13T09:00:00.000Z" };
const TAKE_3 = { id: "ad000000-0000-4000-8000-000000000003", org_id: ORG_ID, ad_id: "7", take_no: 1, status: "rendered", created_at: "2026-10-11T09:00:00.000Z" };
const TAKE_X = { id: "ad000000-0000-4000-8000-0000000000ff", org_id: OTHER_ORG_ID, ad_id: "43", take_no: 1, status: "awaiting_approval", created_at: "2026-10-14T09:00:00.000Z" };

function takeRules() {
  const status = clause(/status = ANY\(\$2\)/, (row, p) => !p[1] || p[1].includes(row.status));
  const company = clause(/org_id = \$1/, (row, p) => row.org_id === p[0]);
  const ad = clause(/AND ad_id = \$2/, (row, p) => row.ad_id === p[1]);
  return [[/FROM ad_videos/, shelf([TAKE_X, TAKE_1, TAKE_2, TAKE_3], [company, status, ad])]];
}

test("ad-videos lists this company's takes with where each is stuck in plain words, can narrow by state or by ad, and never writes", async () => {
  assert.equal(ROUTES["ad-videos"], adVideosHandler);
  const all = await hit(adVideosHandler, { rules: takeRules() });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.items.map((t) => t.id).sort(), [TAKE_1.id, TAKE_2.id, TAKE_3.id].sort(), "the other company's take is not listed");
  const awaiting = all.body.items.find((t) => t.id === TAKE_1.id);
  assert.equal(awaiting.folder_name, "043", "the folder name is the padded number");
  assert.equal(awaiting.ad_id, "43", "the link number is not padded");
  assert.equal(typeof awaiting.status_means, "string");
  assert.ok(awaiting.status_means.length > 5, "the state is said in words");
  const [list] = sqlCalls(all, /FROM ad_videos/);
  assert.deepEqual(list.params, [ORG_ID, null, 51, 0]);
  assert.match(list.sql, /WHERE org_id = \$1\s+AND \(\$2::text\[\] IS NULL OR status = ANY\(\$2\)\)\s+ORDER BY created_at DESC/);

  const stuck = await hit(adVideosHandler, { query: { status: "editing,rendered" }, rules: takeRules() });
  assert.deepEqual(stuck.body.items.map((t) => t.status).sort(), ["editing", "rendered"]);
  assert.deepEqual(sqlCalls(stuck, /FROM ad_videos/)[0].params[1], ["editing", "rendered"]);

  const oneAd = await hit(adVideosHandler, { query: { ad_id: "43" }, rules: takeRules() });
  assert.deepEqual(oneAd.body.items.map((t) => t.take_no), [1, 2]);
  assert.deepEqual(sqlCalls(oneAd, /FROM ad_videos/)[0].params, [ORG_ID, "43"]);

  const padded = await hit(adVideosHandler, { query: { ad_id: "043" }, rules: takeRules() });
  assert.equal(padded.status, 400);
  assert.equal(padded.body.error, "bad_ad_id");
  const bogus = await hit(adVideosHandler, { query: { status: "banana" }, rules: takeRules() });
  assert.equal(bogus.status, 400);
  assert.equal(bogus.body.error, "unknown_state");
  assert.ok(Array.isArray(bogus.body.states) && bogus.body.states.includes("awaiting_approval"));

  // Reads only: approval is a different door.
  const post = await hit(adVideosHandler, { method: "POST", body: { id: TAKE_1.id, status: "approved" }, rules: takeRules() });
  assert.equal(post.status, 405);
  for (const out of [all, stuck, oneAd]) {
    assert.equal(out.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)).length, 0, "the list never writes");
  }
});

test("ad-videos lets in owner and admin only; the sales floor never sees unreleased creative", async () => {
  await assertRoleGate(adVideosHandler, ["owner", "admin"], {});
});

test("ad-videos refuses a login that names no company and reads nothing for it", async () => {
  const noCompany = await hit(adVideosHandler, { staff: { org_id: null }, rules: takeRules() });
  assert.equal(noCompany.status, 403);
  assert.equal(noCompany.body.error, "forbidden");
  assert.equal(sqlCalls(noCompany, /FROM ad_videos/).length, 0, "no take is read when there is no company to read for");
});

/* ── dashboard/kpis: company money and funnel numbers ─────────────────────── */

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

test("dashboard/kpis states cash in cents, funded count and amount, close and show rate, cost per funded, new clients and pipeline movement for this company's window", async () => {
  assert.equal(ROUTES["dashboard/kpis"], dashboardKpis);
  const done = await hit(dashboardKpis, { role: "sales_manager", query: { period: "30d" }, rules: KPI_RULES });
  assert.equal(done.status, 200);
  const k = done.body.kpis;
  assert.equal(k.days, 30);
  assert.equal(k.cash_collected_cents, 60650, "$606.50 of paid transactions, dollars turned into cents once");
  assert.equal(k.funded_count, 2);
  assert.equal(k.funded_amount_cents, 15000000);
  assert.equal(k.show_rate, 0.7, "7 held of 10 booked");
  assert.equal(k.close_rate, 0.4, "4 decisions of 10 booked");
  assert.equal(k.cost_per_funded_cents, 100000, "$2,000 of ad spend over 2 funded clients");
  assert.equal(k.new_clients, 5);
  assert.equal(k.pipeline_movement, 9);
  assert.deepEqual(done.body.display, {
    cash: "$606.50", funded: "2", funded_amount: "$150k", close: "40%", show: "70%", cpf: "$1,000", clients: "5", pipeline_movement: "9",
  });
  // Every read is this company's, for exactly the window asked.
  for (const [pattern, shape] of [
    [/FROM transactions/, /WHERE org_id = \$1\s+AND status IN \('paid','succeeded','complete','completed'\)/],
    [/FROM funding_rounds/, /WHERE org_id = \$1\s+AND status = 'funded'/],
    [/name = 'booking\.created'/, /WHERE org_id = \$1\s+AND name = 'booking\.created'/],
    [/name = 'call\.completed'/, /WHERE org_id = \$1\s+AND name = 'call\.completed'/],
    [/name = 'decision\.rendered'/, /WHERE org_id = \$1\s+AND name = 'decision\.rendered'/],
    [/FROM clients c/, /WHERE c\.org_id = \$1/],
    [/FROM ad_metrics_daily/, /WHERE org_id = \$1/],
    [/FROM cards cd/, /WHERE cd\.org_id = \$1/],
  ]) {
    const [call] = sqlCalls(done, pattern);
    assert.deepEqual(call.params, [ORG_ID, 30], String(pattern));
    assert.match(call.sql, shape, String(pattern));
  }
  const [funded] = sqlCalls(done, /FROM funding_rounds/);
  assert.match(funded.sql, /updated_at >= now\(\) - \(\$2::int \|\| ' days'\)::interval/);

  // Other windows are the right number of days, and an unknown window is refused.
  for (const [period, days] of [["today", 1], ["7d", 7]]) {
    const out = await hit(dashboardKpis, { query: { period }, rules: KPI_RULES });
    assert.equal(out.body.kpis.days, days, period);
    assert.deepEqual(sqlCalls(out, /FROM transactions/)[0].params, [ORG_ID, days]);
  }
  const bad = await hit(dashboardKpis, { query: { period: "forever" }, rules: KPI_RULES });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_period");
  assert.deepEqual(bad.body.allowed, ["today", "7d", "30d", "qtd"]);
  assert.equal(sqlCalls(bad, /FROM transactions/).length, 0);
});

test("dashboard/kpis says unknown, never zero, when ad spend or bookings are missing, and refuses the shared dashboard key because it names no company", async () => {
  const noSpend = KPI_RULES.map(([m, a]) => (String(m).includes("ad_metrics_daily") ? [m, [{ cents: null }]] : [m, a]));
  const noBookings = noSpend.map(([m, a]) => (String(m).includes("booking") ? [m, [{ n: 0 }]] : [m, a]));
  const quiet = await hit(dashboardKpis, { rules: noBookings });
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.kpis.cost_per_funded_cents, null);
  assert.equal(quiet.body.kpis.cost_per_funded_reason, "ad_spend_unavailable");
  assert.equal(quiet.body.kpis.show_rate, null);
  assert.equal(quiet.body.kpis.close_rate, null);
  assert.equal(quiet.body.display.cpf, "—");
  assert.equal(quiet.body.display.show, "—");

  const noFunded = KPI_RULES.map(([m, a]) => (String(m).includes("funding_rounds") ? [m, [{ n: 0, dollars: "0" }]] : [m, a]));
  const none = await hit(dashboardKpis, { rules: noFunded });
  assert.equal(none.body.kpis.cost_per_funded_cents, null);
  assert.equal(none.body.kpis.cost_per_funded_reason, "no_funded_clients_in_window");

  // The shared dashboard key is a credential with no company: it is let past the
  // sign-in gate and then refused with a 403, and nothing is read.
  const secretName = ["DASHBOARD", "SECRET"].join("_");
  const saved = process.env[secretName];
  const shared = ["not", "a", "real", "dashboard", "value"].join("-");
  process.env[secretName] = shared;
  try {
    const refused = await hit(dashboardKpis, {
      anonymous: true, headers: { "x-dashboard-key": shared }, rules: KPI_RULES,
    });
    assert.equal(refused.status, 403);
    assert.equal(refused.body.error, "forbidden");
    assert.equal(sqlCalls(refused, /FROM transactions|FROM funding_rounds|FROM clients/).length, 0);
    const wrong = await hit(dashboardKpis, { anonymous: true, headers: { "x-dashboard-key": "something-else" }, rules: KPI_RULES });
    assert.equal(wrong.status, 401);
  } finally {
    if (saved === undefined) delete process.env[secretName]; else process.env[secretName] = saved;
  }
  const post = await hit(dashboardKpis, { method: "POST", rules: KPI_RULES });
  assert.equal(post.status, 405);
});

test("dashboard/kpis reads the quarter-to-date window as the days since the quarter's first day, counting today, on the first day, mid-quarter and on the last day", async () => {
  // The clock is not handed to the door, so time itself is held still for each case.
  // Quarters begin on 1 January, 1 April, 1 July and 1 October (UTC).
  const cases = [
    ["2026-01-01T00:00:00.000Z", 1, "the first day of a quarter is one day"],
    ["2026-03-31T23:00:00.000Z", 90, "31 + 28 + 31 days of the first quarter"],
    ["2026-07-01T12:00:00.000Z", 1, "the third quarter begins on 1 July"],
    ["2026-10-14T19:00:00.000Z", 14, "1 to 14 October"],
    ["2026-12-31T12:00:00.000Z", 92, "the whole fourth quarter, 31 + 30 + 31 days"],
  ];
  for (const [now, days, why] of cases) {
    mock.timers.enable({ apis: ["Date"], now: new Date(now) });
    try {
      const out = await hit(dashboardKpis, { query: { period: "qtd" }, rules: KPI_RULES });
      assert.equal(out.status, 200, now);
      assert.equal(out.body.kpis.days, days, `${now}: ${why}`);
      assert.deepEqual(sqlCalls(out, /FROM transactions/)[0].params, [ORG_ID, days], `${now}: every read is bound to the same window`);
      assert.deepEqual(sqlCalls(out, /FROM funding_rounds/)[0].params, [ORG_ID, days], now);
    } finally {
      mock.timers.reset();
    }
  }
});
