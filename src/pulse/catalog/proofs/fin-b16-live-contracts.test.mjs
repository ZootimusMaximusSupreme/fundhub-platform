// Finish-853 batch 16: the live checks for the Marketing Command Center settings (quiet hours, schedule fields),
// run over stand-in rows. Save the plan, the plan rows, Build the avatar and "Send this one to" are in
// fin-b16-live-contracts-2.test.mjs; this file also holds the checks that apply to all six contracts.
//
// The exact SQL text each contract carries is run (fin-b16-sql-kit.mjs, SQLite, real column names from
// db/migrations). For every named bad-result condition:
//   - a row that breaks ONLY that condition is counted bad,
//   - the same text with that one condition left out does not count it (so the condition is what caught it),
//   - clean rows, another company's rows, demo rows and rows outside the window are never counted.
// No database, no network.

import assert from "node:assert/strict";
import test from "node:test";

import {
  FIN_B16_CHECKS,
  FIN_B16_RESULT_CONTRACTS,
  FIN_B16_LIVE_CASES,
  FIN_B16_LIVE_ROWS,
  FIN_B16_LIVE_TESTS,
  quietHoursSql, scheduleSql,
  QUIET_BAD, DROP_BAD, STYLE_BAD, EXPIRY_BAD,
} from "./fin-b16-display-contracts.mjs";
import { portableSql, schemaColumns, tablesIn } from "./fin-b16-sql-kit.mjs";

import {
  ORG, OTHER_ORG, at, id, counts, seedRows, conditionTest, phx, settings,
} from "./fin-b16-live-harness.mjs";

// ───────────────────────── the contracts themselves ─────────────────────────

test("six live checks, one registry contract each, every one quiet when nothing is saved yet", () => {
  assert.equal(FIN_B16_CHECKS.length, 6);
  assert.equal(FIN_B16_RESULT_CONTRACTS.length, 6);
  assert.equal(FIN_B16_LIVE_ROWS.length, 6);
  assert.equal(FIN_B16_LIVE_CASES.length, 6);
  assert.equal(new Set(FIN_B16_RESULT_CONTRACTS.map((c) => c.control)).size, 6);
  assert.equal(new Set(FIN_B16_RESULT_CONTRACTS.map((c) => c.sql)).size, 6);
  for (const contract of FIN_B16_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.match(contract.sql, /^\/\* display-result:[a-z0-9-]+ \*\//);
    assert.match(contract.sql, /AS sample_count/);
    assert.match(contract.sql, /AS bad_count/);
    assert.match(contract.sql, /\$1::uuid/);
    assert.ok(!/\$2/.test(contract.sql), "takes the company and nothing else");
    assert.ok(!/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i.test(contract.sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/'[^']*'/g, "''")), "read only");
    assert.ok(contract.requirement.length > 60);
  }
});

test("every table a contract reads is a real table, and every column it names is a real column", () => {
  const schema = schemaColumns();
  for (const contract of FIN_B16_RESULT_CONTRACTS) {
    for (const table of tablesIn(contract.sql)) assert.ok(schema.has(table), `${table} is not in db/schema or db/migrations`);
  }
  // portableSql refuses a spelling the kit cannot run, so every contract must translate.
  for (const contract of FIN_B16_RESULT_CONTRACTS) portableSql(contract.sql);
});

// ───────────────────────── quiet hours ─────────────────────────

function buzz(over = {}) {
  return ["marketing_buzzes", { id: id("buzz"), org_id: ORG, kind: "scripts_ready", body: "Scripts: 21 of 21 ready.", created_at: phx(-3, 10), sent_at: phx(-3, 10, 5), ...over }];
}

const quietClean = () => [
  settings(),
  buzz(),                                                           // made and sent in the day
  buzz({ created_at: phx(-3, 22), sent_at: phx(-2, 7, 0) }),        // made at night, sent the second quiet hours ended
  buzz({ created_at: phx(-3, 22), sent_at: null }),                 // still waiting
  buzz({ created_at: phx(-3, 20, 59), sent_at: phx(-3, 21, 1) }),   // made just before quiet hours (a late worker), not judged
  ["marketing_buzzes", { id: id("buzz"), org_id: OTHER_ORG, kind: "x", body: "y", created_at: phx(-3, 22), sent_at: phx(-3, 22, 5) }],
  buzz({ created_at: at(-60), sent_at: at(-60, 0.1) }),              // made before the hours were last saved
];

conditionTest({
  title: "quiet hours",
  tables: ["marketing_buzzes", "marketing_settings"],
  sqlOf: quietHoursSql,
  names: QUIET_BAD.map(([n]) => n),
  clean: quietClean,
  bads: {
    "a buzz made inside quiet hours was texted before they ended": [
      [buzz({ created_at: phx(-3, 22), sent_at: phx(-3, 22, 30) })],
      [buzz({ created_at: phx(-3, 3), sent_at: phx(-3, 6, 59) })],
      [buzz({ created_at: phx(-3, 21, 0), sent_at: phx(-3, 21, 0) })],
    ],
  },
});

test("quiet hours: a window that does not wrap midnight is read the same way, and start equal to end means none", () => {
  const day = [settings({ quiet_start: "13:00:00", quiet_end: "15:00:00" })];
  const ok = counts(["marketing_buzzes", "marketing_settings"], seedRows([...day,
    buzz({ created_at: phx(-3, 14), sent_at: phx(-3, 15, 0) }), buzz({ created_at: phx(-3, 9), sent_at: phx(-3, 9, 1) })]), quietHoursSql());
  assert.deepEqual(ok, { sample_count: 2, bad_count: 0 });
  const bad = counts(["marketing_buzzes", "marketing_settings"], seedRows([...day,
    buzz({ created_at: phx(-3, 13, 10), sent_at: phx(-3, 14, 30) })]), quietHoursSql());
  assert.deepEqual(bad, { sample_count: 1, bad_count: 1 });
  const none = counts(["marketing_buzzes", "marketing_settings"], seedRows([settings({ quiet_start: "09:00:00", quiet_end: "09:00:00" }),
    buzz({ created_at: phx(-3, 9, 30), sent_at: phx(-3, 9, 31) })]), quietHoursSql());
  assert.deepEqual(none, { sample_count: 0, bad_count: 0 }, "no quiet hours at all, nothing to judge");
});

test("quiet hours: the saved zone decides the wall clock, not UTC", () => {
  // 22:30 in New York is 02:30 UTC. With the zone saved as New York the buzz is inside 21:00 to 07:00.
  const rows = (tz) => [settings({ timezone: tz }),
    buzz({ created_at: "2026-10-11T02:00:00.000Z", sent_at: "2026-10-11T02:30:00.000Z" })];
  assert.deepEqual(counts(["marketing_buzzes", "marketing_settings"], seedRows(rows("America/New_York")), quietHoursSql()), { sample_count: 1, bad_count: 1 });
  assert.deepEqual(counts(["marketing_buzzes", "marketing_settings"], seedRows(rows("America/Phoenix")), quietHoursSql()), { sample_count: 1, bad_count: 0 },
    "7:30 pm in Arizona is not quiet");
});

// ───────────────────────── schedule fields ─────────────────────────

const MONDAY_7AM = "2026-10-12T14:00:00.000Z"; // Monday 07:00 in Arizona
function batch(over = {}) {
  return ["marketing_batches", {
    id: id("batch"), org_id: ORG, kind: "weekly", week_key: "2026-W42", status: "released", release_at: MONDAY_7AM,
    released_at: MONDAY_7AM, total: 21, plan: { size_rule: "total", total: 21, overrides: null }, created_at: at(-3), ...over,
  }];
}
function script(over = {}) {
  return ["ad_scripts", {
    id: id("script"), org_id: ORG, partner_id: "p1", body: "words", source: "machine", status: "draft", script_format: "standard",
    style: "bullets", batch_id: null, archived_at: null, created_at: at(-3), ...over,
  }];
}
const FUNNEL = ["marketing_funnels", { id: id("funnel"), org_id: ORG, key: "roadmap_147", name: "Roadmap", active: true }];
const SCHEDULE_TABLES = ["marketing_batches", "marketing_settings", "ad_scripts", "marketing_funnels"];

const scheduleClean = () => [
  settings(), FUNNEL,
  batch(),                                                                  // right day, right time, 21 scripts
  batch({ id: "b-per", kind: "on_command", week_key: null, release_at: at(-20), released_at: at(-20) }), // write now: not a weekly drop
  batch({ id: "b-failed", status: "failed", release_at: "2026-10-13T20:00:00.000Z", plan: { size_rule: "total", total: 0, overrides: null } }),
  batch({ id: "b-old", release_at: "2026-08-03T14:00:00.000Z", plan: { size_rule: "per_funnel", total: 5, overrides: null } }), // before the last save
  batch({ id: "b-override", plan: { size_rule: "total", total: 40, overrides: { total: 40 } } }),               // a one-time override
  batch({ org_id: OTHER_ORG, release_at: "2026-10-13T20:00:00.000Z" }),                                         // another company
  script({ style: "bullets", script_format: "standard" }),
  script({ style: "words", script_format: "sorting" }),
  script({ source: "chris", style: "words", script_format: "standard" }),   // a person's own version
  script({ created_at: at(-60), style: "words", script_format: "standard" }), // written before the last save
  script({ script_format: "unknown_kind", style: "words" }),                 // a kind the saved styles do not name
  // expiry: a released batch from 30 days ago, one expired draft (right), one young draft (not due yet)
  ["marketing_batches", { id: "b-rel-old", org_id: ORG, kind: "on_command", status: "released", release_at: at(-30), released_at: at(-30), plan: null, total: 3, created_at: at(-31) }],
  ["marketing_batches", { id: "b-rel-new", org_id: ORG, kind: "on_command", status: "released", release_at: at(-10), released_at: at(-10), plan: null, total: 3, created_at: at(-11) }],
  script({ status: "expired", batch_id: "b-rel-old" }),
  script({ status: "draft", batch_id: "b-rel-new" }),
  script({ status: "draft", batch_id: "b-rel-old", archived_at: at(-5) }),   // an archived draft is not expired by the chore
  script({ status: "locked", batch_id: "b-rel-old" }),                       // approved scripts never expire
  script({ status: "draft", source: "chris", batch_id: "b-rel-old" }),       // a person's own draft never expires
];

conditionTest({
  title: "schedule fields",
  tables: SCHEDULE_TABLES,
  sqlOf: scheduleSql,
  names: [...DROP_BAD, ...STYLE_BAD, ...EXPIRY_BAD].map(([n]) => n),
  clean: scheduleClean,
  bads: {
    "the weekly drop is on a different weekday than the one saved": [
      [batch({ release_at: "2026-10-13T14:00:00.000Z", week_key: "2026-W42" })],
    ],
    "the weekly drop is at a different time than the one saved": [
      [batch({ release_at: "2026-10-12T15:00:00.000Z" })],
    ],
    "the weekly plan was made under a different count rule than the one saved": [
      // total is a whole number of days, so only the rule words differ
      [batch({ plan: { size_rule: "per_funnel", total: 21, overrides: null } })],
    ],
    "a plan under the total rule does not hold scripts a day times days in a batch": [
      [batch({ plan: { size_rule: "total", total: 20, overrides: null }, total: 20 })],
      [batch({ plan: { size_rule: "total", total: 42, overrides: null }, total: 42 })],
    ],
    "a plan under the per funnel rule is not a whole number of funnels' scripts a day times days": [
      { clean: () => [...scheduleClean().filter(([t]) => t !== "marketing_settings"), settings({ size_rule: "per_funnel" })]
          .filter(([t, r]) => !(t === "marketing_batches" && r.plan && r.plan.size_rule === "total")),
        rows: [batch({ plan: { size_rule: "per_funnel", total: 22, overrides: null }, total: 22 })] },
    ],
    "a machine-written script has a different style than the one saved for its kind": [
      [script({ script_format: "standard", style: "words" })],
      [script({ script_format: "sorting", style: "bullets" })],
    ],
    "a machine draft is still a draft after its batch's expiry days and the nightly grace": [
      [script({ status: "draft", batch_id: "b-rel-old" })],
    ],
  },
});

test("schedule fields: a weekly plan with a one-time override, or with no active funnel, is not judged on its count", () => {
  const withoutFunnel = scheduleClean().filter(([t]) => t !== "marketing_funnels");
  const tables = SCHEDULE_TABLES;
  const none = counts(tables, seedRows([...withoutFunnel, batch({ plan: { size_rule: "total", total: 0, overrides: null }, total: 0 })]), scheduleSql());
  assert.equal(none.bad_count, 0, "nothing could be planned, so no count is wrong");
  const over = counts(tables, seedRows([...scheduleClean(), batch({ plan: { size_rule: "total", total: 5, overrides: { total: 5 } }, total: 5 })]), scheduleSql());
  assert.equal(over.bad_count, 0, "a one-time total replaces the saved one");
});

test("schedule fields: the weekday and time are read in the saved zone, not in UTC", () => {
  // Monday 07:00 in New York is 11:00 UTC. With the zone saved as New York that is the right drop.
  const rows = (tz) => [settings({ timezone: tz }), FUNNEL, batch({ release_at: "2026-10-12T11:00:00.000Z" })];
  assert.deepEqual(counts(SCHEDULE_TABLES, seedRows(rows("America/New_York")), scheduleSql()), { sample_count: 1, bad_count: 0 });
  assert.equal(counts(SCHEDULE_TABLES, seedRows(rows("America/Phoenix")), scheduleSql()).bad_count, 1, "04:00 in Arizona is wrong");
});

// ───────────────────────── wiring ─────────────────────────

test("each live case names the lane and this test, and its control is on the contract of the same text", () => {
  for (const [i, c] of FIN_B16_LIVE_CASES.entries()) {
    assert.equal(c.depth, "deep");
    assert.match(c.evidence, /gap-catalog-display\.mjs/);
    assert.deepEqual([...c.tests], [...FIN_B16_LIVE_TESTS]);
    assert.equal(c.control, FIN_B16_RESULT_CONTRACTS[i].control);
    assert.equal(c.surface, FIN_B16_CHECKS[i].surface);
  }
});
