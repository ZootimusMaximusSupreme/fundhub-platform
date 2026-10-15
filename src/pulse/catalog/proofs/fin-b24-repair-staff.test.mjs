// Batch 24, repair cycle 1: dashboard/kpis, lender-observations and inquiry.
//
// An independent checker found these stayed green when the product broke:
//   * dashboard/kpis: the stand-in answered fixed rows whatever the SQL said and
//     the old test pinned only the first condition of each read. Cash for the
//     wrong window, spend for the wrong window, demo and test clients counted as
//     new clients, the pipeline movement over every pipeline and every age, a
//     distinct count turned into a row count, and amount_paid swapped for amount
//     all stayed green. So did a company taken from the address.
//   * lender-observations: a review always saved "confirmed" whatever word was
//     sent, the notes were never saved, and the links to the application, round
//     and lender row, and the "what the lender is known to pull" lookup, were not
//     judged.
//   * inquiry: the SELECT column lists were not judged (the stand-in returned the
//     whole fake row), and the GET-only rule on the call row was not tried. Its
//     word "open" is held (see the manifest): the door lists every status.
//
// The real api/ handlers. Statements that decide a number are pinned in full (a
// pin judges what the statement says; it does not run it, there is no Postgres
// here). This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import test from "node:test";

import dashboardKpis from "../../../../api/dashboard/kpis.mjs";
import inquiryHandler from "../../../../api/inquiry.mjs";
import lenderObservations from "../../../../api/lender-observations.mjs";
import { andNotDemo, andNotTestAddress } from "../../../demo/exclude-demo.mjs";
import { AD_TODAY_SQL } from "../../../lib/ad-account-day.mjs";
import { OBSERVATION_REVIEW_STATUSES } from "../../../lenders/tables.mjs";
import { tableRules } from "../../../testing/s3-scoped-rows.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { clause, shelf } from "./s1-proof-kit.mjs";
import { assertSqlHas, flat } from "./fin-b24-repair-kit.mjs";

const HOSTILE = { org_id: OTHER_ORG_ID };
const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";

/* ── dashboard/kpis ──────────────────────────────────────────────────────── */

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

const WINDOW = "now() - ($2::int || ' days')::interval";
const EVENT = (name) => `SELECT count(DISTINCT client_id)::int AS n FROM events WHERE org_id = $1 AND name = '${name}' AND created_at >= ${WINDOW} AND client_id IS NOT NULL`;
const STATEMENTS = [
  [/FROM transactions/, "cash collected: paid money, in dollars, over the window",
    `SELECT COALESCE(SUM(amount_paid), 0) AS dollars FROM transactions WHERE org_id = $1 AND status IN ('paid','succeeded','complete','completed') AND created_at >= ${WINDOW}`],
  [/FROM funding_rounds/, "funded: distinct clients and the funded amount, rounds that landed in the window",
    `SELECT count(DISTINCT client_id)::int AS n, COALESCE(SUM(funded_amount), 0) AS dollars FROM funding_rounds WHERE org_id = $1 AND status = 'funded' AND updated_at >= ${WINDOW}`],
  [/name = 'booking\.created'/, "booked: distinct clients with a booking in the window", EVENT("booking.created")],
  [/name = 'call\.completed'/, "showed: distinct clients with a held call in the window", EVENT("call.completed")],
  [/name = 'decision\.rendered'/, "closed: distinct clients with a decision in the window", EVENT("decision.rendered")],
  [/FROM clients c/, "new clients: real people only (no demo, no test addresses), created in the window",
    `SELECT count(*)::int AS n FROM clients c WHERE c.org_id = $1 AND c.created_at >= ${WINDOW} ${andNotDemo("c")} ${andNotTestAddress("c")}`],
  [/FROM ad_metrics_daily/, "ad spend: cents saved for the window's days ending today in Arizona",
    `SELECT COALESCE(SUM(spend_cents), 0)::bigint AS cents FROM ad_metrics_daily WHERE org_id = $1 AND date >= (${AD_TODAY_SQL} - ($2::int - 1))`],
  [/FROM cards cd/, "pipeline movement: sales-pipeline cards that entered in the window",
    `SELECT count(*)::int AS n FROM cards cd JOIN pipelines p ON p.id = cd.pipeline_id WHERE cd.org_id = $1 AND p.key = 'sales' AND cd.entered_at >= ${WINDOW}`],
];

test("dashboard/kpis reads each number with the statement its words name, for the sign-in's company and the window asked, whatever the address says", async () => {
  const done = await hit(dashboardKpis, { role: "sales_manager", query: { period: "30d", ...HOSTILE }, rules: KPI_RULES });
  assert.equal(done.status, 200);
  assert.equal(done.body.kpis.days, 30);
  assert.equal(done.body.kpis.cash_collected_cents, 60650);
  for (const [pattern, what, expected] of STATEMENTS) {
    const [call] = sqlCalls(done, pattern);
    assert.ok(call, `${what}: the statement was run`);
    assert.equal(flat(call.sql), flat(expected), `${what}: the statement is as reviewed`);
    assert.deepEqual(call.params, [ORG_ID, 30], `${what}: the sign-in's company and the window asked`);
  }
  // The same statements for the other windows, so a window is never the statement's own number.
  const week = await hit(dashboardKpis, { query: { period: "7d", ...HOSTILE }, rules: KPI_RULES });
  for (const [pattern] of STATEMENTS) assert.deepEqual(sqlCalls(week, pattern)[0].params, [ORG_ID, 7]);
  assertSqlHas(sqlCalls(done, /FROM transactions/)[0].sql, [["COALESCE(SUM(amount_paid), 0) AS dollars", "dollars paid, not the amount owed"]], "cash");
});

/* ── lender-observations ─────────────────────────────────────────────────── */

const OBS_ID = "0b500000-0000-4000-8000-000000000001";
const LENDER = "1e000000-0000-4000-8000-000000000001";
const APPLICATION = "a1000000-0000-4000-8000-000000000001";
const ROUND = "f1000000-0000-4000-8000-000000000001";

const observationRows = () => [
  { id: OBS_ID, org_id: ORG_ID, lender_name: "Chase", observed_bureau: "EQ", review_status: "pending", notes: null, created_by: null },
  { id: OBS_ID, org_id: OTHER_ORG_ID, lender_name: "Their bank", observed_bureau: "TU", review_status: "pending", notes: null, created_by: null },
];

test("lender-observations review saves the word it was sent, whichever allowed word that is, and the note", async () => {
  assert.ok(OBSERVATION_REVIEW_STATUSES.length >= 3);
  for (const word of OBSERVATION_REVIEW_STATUSES) {
    const rows = observationRows();
    const rules = tableRules("lender_bureau_observations", rows, {
      set: (row, p, sql) => {
        row.review_status = p[2];
        if (/notes = \$4/.test(sql)) row.notes = p[3];
      },
    });
    const done = await hit(lenderObservations, {
      method: "POST", role: "funding_advisor", query: HOSTILE,
      body: { action: "review", id: OBS_ID, review_status: word, notes: `reviewed as ${word}`, ...HOSTILE }, rules,
    });
    assert.equal(done.status, 200, word);
    assert.equal(done.body.observation.review_status, word, `${word} is saved as ${word}`);
    assert.equal(rows[0].review_status, word, word);
    assert.equal(rows[0].notes, `reviewed as ${word}`, `${word}: the note is saved`);
    assert.equal(rows[1].review_status, "pending", "another company's observation is untouched");
    assert.equal(sqlCalls(done, /UPDATE lender_bureau_observations/)[0].params[0], ORG_ID, "the company is the sign-in's");
  }

  // No note sent: the note already on file is left alone.
  const rows = observationRows();
  rows[0].notes = "an earlier note";
  const quiet = await hit(lenderObservations, {
    method: "POST", body: { action: "review", id: OBS_ID, review_status: "dismissed" },
    rules: tableRules("lender_bureau_observations", rows, { set: (row, p, sql) => { row.review_status = p[2]; if (/notes = \$4/.test(sql)) row.notes = p[3]; } }),
  });
  assert.equal(quiet.status, 200);
  assert.equal(rows[0].notes, "an earlier note");
  assert.equal(rows[0].review_status, "dismissed");
});

test("lender-observations log saves the links it was given (application, round, lender table and row), and fills the lender's name, table and known bureaus from the lender row when they are not sent", async () => {
  const insert = [/INSERT INTO lender_bureau_observations/, (_sql, p) => [{
    id: OBS_ID, org_id: p[0], application_id: p[1], client_id: p[2], funding_round_id: p[3], lender_name: p[4], lender_table: p[5],
    lender_row_id: p[6], expected_bureaus_raw: p[7], observed_bureau: p[8], mismatch_flag: p[10], review_status: p[11],
  }]];
  const linked = await hit(lenderObservations, {
    method: "POST", role: "admin", query: HOSTILE,
    body: {
      action: "log", observed_bureau: "Equifax", expected_bureaus_raw: "Experian", lender_name: "Chase",
      application_id: APPLICATION, client_id: CLIENT_ID, funding_round_id: ROUND, lender_table: "OnlineBizCC", lender_row_id: LENDER, ...HOSTILE,
    },
    rules: [insert],
  });
  assert.equal(linked.status, 200);
  const [call] = sqlCalls(linked, /INSERT INTO lender_bureau_observations/);
  assert.deepEqual(
    [call.params[0], call.params[1], call.params[2], call.params[3], call.params[4], call.params[5], call.params[6]],
    [ORG_ID, APPLICATION, CLIENT_ID, ROUND, "Chase", "OnlineBizCC", LENDER],
    "company from the sign-in; application, client, round, lender name, lender table and lender row as sent",
  );
  assert.equal(call.params[10], true);

  // Nothing about the lender sent but its row: the row says who it is and which bureaus it pulls.
  const lenders = [/FROM lenders WHERE org_id = \$1::uuid AND id = \$2::uuid/, (sql, p) => shelf([
    { id: LENDER, org_id: ORG_ID, name: "Chase", lender_table: "OnlineBizCC", bureaus_pulled: "Experian, TransUnion" },
    { id: LENDER, org_id: OTHER_ORG_ID, name: "Their bank", lender_table: "BizLOC_Stated", bureaus_pulled: "Equifax" },
  ], [clause(/WHERE org_id = \$1::uuid AND id = \$2::uuid/, (row, params) => row.org_id === params[0] && row.id === params[1])])(sql, p)];
  const filled = await hit(lenderObservations, {
    method: "POST", body: { action: "log", observed_bureau: "Equifax", lender_row_id: LENDER }, rules: [lenders, insert],
  });
  assert.equal(filled.status, 200);
  const [row] = sqlCalls(filled, /INSERT INTO lender_bureau_observations/);
  assert.deepEqual(sqlCalls(filled, /FROM lenders/)[0].params, [ORG_ID, LENDER]);
  assert.deepEqual([row.params[4], row.params[5], row.params[6], row.params[7]], ["Chase", "OnlineBizCC", LENDER, "Experian, TransUnion"], "the lender's own name, table and known bureaus");
  assert.equal(row.params[10], true, "Equifax is not among the bureaus that lender is known to pull");

  const match = await hit(lenderObservations, {
    method: "POST", body: { action: "log", observed_bureau: "Experian", lender_row_id: LENDER }, rules: [lenders, insert],
  });
  assert.equal(sqlCalls(match, /INSERT INTO lender_bureau_observations/)[0].params[10], false, "Experian is one of them");
});

/* ── inquiry ─────────────────────────────────────────────────────────────── */

/* The statement's own SELECT list decides which columns reach the desk: the
   stand-in answers only those, from rows that carry more. */
function selected(sql, row) {
  const list = /SELECT\s+([\s\S]+?)\s+FROM\b/i.exec(sql)[1].split(",").map((c) => c.trim());
  return Object.fromEntries(list.map((c) => [c, row[c]]));
}
const CASE = (over = {}) => ({
  id: "1c000000-0000-4000-8000-00000000000a", case_id: "IR-1", client_id: CLIENT_ID, case_status: "In Progress", selected_bureaus_raw: "EQ",
  call_fired_at: null, ai_call_status: null, open_inquiry_count: 3, created_at: "2026-10-12T10:00:00.000Z", org_id: ORG_ID,
  internal_notes: "never on the desk", ssn_last4: "1234", ...over,
});

test("inquiry lists each case with the columns the Specialist desk reads (status and open count among them), and nothing else of the row", async () => {
  const cases = [CASE(), CASE({ id: "1c000000-0000-4000-8000-00000000000b", case_id: "IR-2", case_status: "Completed", open_inquiry_count: 0 }), CASE({ id: "x", case_id: "IR-X", org_id: OTHER_ORG_ID })];
  const rules = [[/FROM inquiry_removal_cases/, (sql, p) => shelf(cases, [
    clause(/WHERE org_id = \$1::uuid/, (row, params) => row.org_id === params[0]),
    clause(/AND case_status::text = \$2/, (row, params) => row.case_status === params[1]),
  ])(sql, p).map((row) => selected(sql, row))]];
  const out = await hit(inquiryHandler, { role: "inquiry_specialist", query: { action: "cases", ...HOSTILE }, rules });
  assert.equal(out.status, 200);
  assert.equal(out.body.ok, true);
  assert.deepEqual(out.body.cases.map((c) => [c.case_id, c.case_status, c.open_inquiry_count]), [["IR-1", "In Progress", 3], ["IR-2", "Completed", 0]]);
  assert.deepEqual(Object.keys(out.body.cases[0]).sort(), [
    "ai_call_status", "call_fired_at", "case_id", "case_status", "client_id", "created_at", "id", "open_inquiry_count", "selected_bureaus_raw",
  ]);
  assert.equal(JSON.stringify(out.body).includes("never on the desk"), false);
  assert.deepEqual(sqlCalls(out, /FROM inquiry_removal_cases/)[0].params, [ORG_ID]);
  assert.match(flat(sqlCalls(out, /FROM inquiry_removal_cases/)[0].sql), /ORDER BY created_at DESC LIMIT 100$/);

  // HELD ROW (route:inquiry, "open ... cases"): the door lists every status, a finished case included.
  // The day it narrows to open work this goes red and the row is bound to its words.
  const completed = await hit(inquiryHandler, { query: { action: "cases" }, rules });
  assert.ok(completed.body.cases.some((c) => c.case_status === "Completed"), "a Completed case is on the list today");
  const canceled = await hit(inquiryHandler, {
    query: { action: "cases" },
    rules: [[/FROM inquiry_removal_cases/, (sql, p) => [CASE({ case_status: "Canceled" })].map((row) => selected(sql, row))]],
  });
  assert.equal(canceled.body.cases[0].case_status, "Canceled");
});

test("inquiry reads one call row of this company with exactly its named columns, and only for a GET", async () => {
  const calls = [
    { call_id: "call-1", client_id: CLIENT_ID, org_id: ORG_ID, kind: "bureau", created_at: "2026-10-13T11:00:00.000Z", transcript: "never on the desk", recording_url: "https://example.test/r" },
    { call_id: "call-1", client_id: CLIENT_ID, org_id: OTHER_ORG_ID, kind: "bureau", created_at: "2026-10-13T11:00:00.000Z", transcript: "another company's" },
  ];
  const rules = [[/FROM outbound_calls/, (sql, p) => shelf(calls, [
    clause(/WHERE call_id = \$1 AND org_id = \$2::uuid/, (row, params) => row.call_id === params[0] && row.org_id === params[1]),
  ])(sql, p).map((row) => selected(sql, row))]];
  const found = await hit(inquiryHandler, { query: { action: "status", call_id: "call-1", ...HOSTILE }, rules });
  assert.equal(found.status, 200);
  assert.deepEqual(found.body, { ok: true, call: { call_id: "call-1", client_id: CLIENT_ID, org_id: ORG_ID, kind: "bureau", created_at: "2026-10-13T11:00:00.000Z" } });
  assert.deepEqual(sqlCalls(found, /FROM outbound_calls/)[0].params, ["call-1", ORG_ID]);

  const post = await hit(inquiryHandler, { method: "POST", query: { action: "status", call_id: "call-1" }, rules });
  assert.equal(post.status, 405);
  assert.equal(sqlCalls(post, /FROM outbound_calls/).length, 0, "a call row is read by GET only");
});
