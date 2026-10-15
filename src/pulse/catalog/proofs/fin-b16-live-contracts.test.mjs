// Finish-853 batch 16: the live checks for the Marketing Command Center (quiet hours, schedule fields,
// Save the plan, plan rows, Build the avatar) and the inbox's "Send this one to" box, run over stand-in rows.
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
  quietHoursSql, scheduleSql, shootCreateSql, shootOrderSql, avatarSql, sendToSql,
  QUIET_BAD, DROP_BAD, STYLE_BAD, EXPIRY_BAD, SHOOT_CREATE_BAD, SHOOT_ORDER_BAD, AVATAR_BAD, SEND_TO_BAD,
} from "./fin-b16-display-contracts.mjs";
import { makeStandIn, portableSql, schemaColumns, tablesIn, NOW } from "./fin-b16-sql-kit.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const DAY = 86_400_000;
const at = (days, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3_600_000).toISOString();

let counter = 0;
const id = (prefix = "x") => `${prefix}-${(counter += 1)}`;

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

// ───────────────────────── a small harness ─────────────────────────

/** Run one check's SQL (optionally without a named condition) over a stand-in built by seed(). */
function counts(tables, seed, sql) {
  const standIn = makeStandIn(tables);
  try {
    seed(standIn);
    return standIn.run(sql, ORG);
  } finally {
    standIn.close();
  }
}

const seedRows = (rows) => (standIn) => { for (const [table, row] of rows) standIn.insert(table, row); };

/**
 * For one check: the clean rows are never bad; each named condition has rows that break only it, the
 * full text counts them bad and the text without that condition does not. `bads[name]` is a list of
 * cases; a case is a list of [table, row] added to the clean rows. A case may be { rows, clean } to
 * replace the clean rows (for a case that needs a different settings row).
 */
function conditionTest({ title, tables, sqlOf, names, clean, bads }) {
  test(`${title}: clean, other-company, demo and out-of-window rows are not counted`, () => {
    const got = counts(tables, seedRows(clean()), sqlOf());
    assert.equal(got.bad_count, 0);
    assert.ok(got.sample_count >= 1, "the clean rows are samples");
  });

  test(`${title}: every named condition is exercised by a row that breaks only it`, () => {
    assert.deepEqual([...Object.keys(bads)].sort(), [...names].sort(), "a case for every condition, and no case for a missing one");
  });

  for (const name of names) {
    test(`${title}: red on "${name}", and only that condition catches it`, () => {
      for (const one of bads[name]) {
        const base = Array.isArray(one) ? clean() : (one.clean ? one.clean() : clean());
        const added = Array.isArray(one) ? one : one.rows;
        const baseCount = counts(tables, seedRows(base), sqlOf());
        const withBad = counts(tables, seedRows([...base, ...added]), sqlOf());
        assert.ok(withBad.bad_count > baseCount.bad_count, `"${name}" must turn the check red`);
        assert.ok(withBad.sample_count > baseCount.sample_count, "the broken row is a sample");
        const withoutIt = counts(tables, seedRows([...base, ...added]), sqlOf({ without: [name] }));
        assert.equal(withoutIt.bad_count, baseCount.bad_count, `without "${name}" the same rows must not be caught`);
      }
    });
  }
}

// Phoenix is UTC-7 all year. phx(0, 22, 0) is today 22:00 in Arizona.
const phx = (dayOffset, hour, minute = 0) => {
  const d = new Date(Date.UTC(2026, 9, 14 + dayOffset, hour + 7, minute, 0));
  return d.toISOString();
};

const FORMATS = { standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets" };
function settings(over = {}) {
  return ["marketing_settings", {
    org_id: ORG, enabled: true, batch_weekday: 1, batch_time: "07:00:00", timezone: "America/Phoenix",
    scripts_per_day: 3, days_per_batch: 7, size_rule: "total", format_style: FORMATS, draft_expiry_days: 14,
    quiet_start: "21:00:00", quiet_end: "07:00:00", updated_at: at(-30), ...over,
  }];
}

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

// ───────────────────────── Save the plan, and the plan rows ─────────────────────────

const R1 = "10000000-0000-4000-8000-000000000001";
const R2 = "10000000-0000-4000-8000-000000000002";
const R3 = "10000000-0000-4000-8000-000000000003";
const R9 = "10000000-0000-4000-8000-000000000009";
function shoot(over = {}) {
  return ["marketing_shoots", { id: id("shoot"), org_id: ORG, shoot_date: "2026-10-15", root_script_ids: [R1, R2], status: "planned", created_at: at(-1), ...over }];
}
function planned(root, over = {}) {
  return ["ad_scripts", { id: id("ver"), org_id: ORG, partner_id: "p1", body: "words", root_script_id: root, status: "locked", film_order: 1, archived_at: null, ...over }];
}
const SHOOT_TABLES = ["marketing_shoots", "ad_scripts"];
const shootClean = () => [
  shoot(),                                                                  // the one open shoot
  planned(R1, { film_order: 1 }), planned(R2, { film_order: 2 }),
  planned(R1, { film_order: 1, archived_at: at(-2) }),                       // an older version
  shoot({ id: "s-done", status: "done", root_script_ids: [R3], finished_at: at(-8) }),
  planned(R3, { film_order: null }),                                         // a closed shoot is never judged on film order
  ["marketing_shoots", { id: id("shoot"), org_id: OTHER_ORG, root_script_ids: [], status: "planned" }],
];

conditionTest({
  title: "Save the plan",
  tables: SHOOT_TABLES,
  sqlOf: shootCreateSql,
  names: SHOOT_CREATE_BAD.map(([n]) => n),
  clean: shootClean,
  bads: {
    "a shoot plan names no script": [[shoot({ status: "done", root_script_ids: [], finished_at: at(-4) })]],
    "a second shoot is open for the same company": [[shoot({ root_script_ids: [R1] })]],
    "a shoot plan names a script that is not on file for this company": [
      [shoot({ status: "done", root_script_ids: [R9], finished_at: at(-4) })],
      // on file, but for another company
      [shoot({ status: "done", root_script_ids: [R9], finished_at: at(-4) }), ["ad_scripts", { id: id("ver"), org_id: OTHER_ORG, partner_id: "p1", body: "w", root_script_id: R9 }]],
    ],
  },
});

conditionTest({
  title: "plan rows",
  tables: SHOOT_TABLES,
  sqlOf: shootOrderSql,
  names: SHOOT_ORDER_BAD.map(([n]) => n),
  clean: shootClean,
  bads: {
    "a shoot plan names one script twice": [[shoot({ status: "done", root_script_ids: [R1, R2, R1], finished_at: at(-4) })]],
    "a shoot plan holds more scripts than a shoot may (100)": [[shoot({
      status: "done", finished_at: at(-4),
      root_script_ids: Array.from({ length: 101 }, (_, i) => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
    })]],
    "a script on an open shoot plan has no film order": [
      [shoot({ root_script_ids: [R9] }), planned(R9, { film_order: null })],
    ],
  },
});

test("plan rows: exactly 100 scripts is allowed, and a script version that was archived is not asked for a film order", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `30000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  const got = counts(SHOOT_TABLES, seedRows([shoot({ status: "done", root_script_ids: ids, finished_at: at(-4) }), planned(R1, { film_order: null, archived_at: at(-1) })]), shootOrderSql());
  assert.deepEqual(got, { sample_count: 1, bad_count: 0 });
  const open = counts(SHOOT_TABLES, seedRows([shoot({ root_script_ids: [R1] }), planned(R1, { film_order: null, archived_at: at(-1) }), planned(R1, { film_order: 1 })]), shootOrderSql());
  assert.deepEqual(open, { sample_count: 1, bad_count: 0 });
});

// ───────────────────────── Build the avatar ─────────────────────────

function job(over = {}) {
  return ["marketing_jobs", {
    id: id("job"), org_id: ORG, kind: "avatar", status: "done",
    payload: { campaign: "partner", step: "done", run_cap_usd: 20, progress: {} },
    result: { campaign: "partner", files: ["marketing/flywheel/partner/01-avatar.md"] }, created_at: at(-5), ...over,
  }];
}
function usage(jobId, cost, over = {}) {
  return ["marketing_model_usage", { id: id("use"), org_id: ORG, job_id: jobId, model: "claude-opus-5-5", cost_usd: cost, ...over }];
}
const AVATAR_TABLES = ["marketing_jobs", "marketing_model_usage"];
const avatarClean = () => [
  job({ id: "j-done" }), usage("j-done", 12.5), usage("j-done", 7.5),         // exactly at the stop amount
  job({ id: "j-running", status: "running", result: null, payload: { campaign: "partner", step: "quotes", run_cap_usd: 20 } }), usage("j-running", 1),
  job({ id: "j-stop", status: "failed", result: null, error: "The run stopped at $20.",
    payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: { stopped_at_cap: { cap: "run", sentence: "Stopped at the $20 run cap after step 3." } } } }),
  job({ id: "j-offer", kind: "offer", status: "done", payload: { campaign: "partner", run_cap_usd: 1 } }), usage("j-offer", 99),
  job({ id: "j-other", org_id: OTHER_ORG, payload: { campaign: "partner", step: "quotes", run_cap_usd: 1 } }),
  ["marketing_model_usage", { id: id("use"), org_id: OTHER_ORG, job_id: "j-done", model: "x", cost_usd: 500 }],
];

conditionTest({
  title: "Build the avatar",
  tables: AVATAR_TABLES,
  sqlOf: avatarSql,
  names: AVATAR_BAD.map(([n]) => n),
  clean: avatarClean,
  bads: {
    "a run spent more than the stop amount saved on it": [
      [job({ id: "j-over" }), usage("j-over", 15), usage("j-over", 5.01)],
    ],
    "a finished run is not on its last step": [
      [job({ payload: { campaign: "partner", step: "quotes", run_cap_usd: 20 } })],
    ],
    "a finished run lists no saved files": [
      [job({ result: { campaign: "partner", files: [] } })],
      [job({ result: { campaign: "partner" } })],
    ],
    "a run that stopped at the cap does not say why": [
      [job({ status: "failed", result: null, error: "stopped",
        payload: { campaign: "partner", step: "quotes", run_cap_usd: 20, progress: { stopped_at_cap: { cap: "run", sentence: "  " } } } })],
    ],
  },
});

test("Build the avatar: a run with no price on a call is never counted as free money, and no saved stop amount is not judged", () => {
  const rows = [job({ id: "j-np", payload: { campaign: "partner", step: "done" } }), usage("j-np", 400), job({ id: "j-null" }), usage("j-null", null), usage("j-null", 3)];
  assert.deepEqual(counts(AVATAR_TABLES, seedRows(rows), avatarSql()), { sample_count: 2, bad_count: 0 });
});

// ───────────────────────── Send this one to ─────────────────────────

const CLIENT = ["clients", { id: "c1", org_id: ORG, first_name: "Dana", email: "dana@example.com", phone: "+15550100001", updated_at: at(-20), is_demo: false }];
function message(over = {}) {
  return ["messages", {
    id: id("msg"), org_id: ORG, client_id: "c1", direction: "outbound", channel: "email", sender_kind: "staff",
    rendered_body: "Hello", to_address: "dana.other@example.com", created_at: at(-3), is_demo: false, ...over,
  }];
}
const SEND_TABLES = ["messages", "clients"];
const sendClean = () => [
  CLIENT,
  message(),                                                                  // a typed email, well shaped
  message({ channel: "sms", to_address: "+15550109999" }),                    // a typed number, well shaped
  message({ to_address: "dana@example.com" }),                                // the address on file: not a typed one
  message({ channel: "sms", to_address: "+15550100001" }),                    // the number on file
  message({ to_address: "not-an-email", created_at: at(-40) }),               // made before the record last changed
  message({ to_address: null }),                                              // no address at all
  message({ to_address: "bad", is_demo: true }),
  message({ to_address: "bad", direction: "inbound" }),
  message({ to_address: "bad", sender_kind: "system" }),
  message({ to_address: "bad", org_id: OTHER_ORG }),
  message({ to_address: "bad", created_at: at(-120) }),
];

conditionTest({
  title: "Send this one to",
  tables: SEND_TABLES,
  sqlOf: sendToSql,
  names: SEND_TO_BAD.map(([n]) => n),
  clean: sendClean,
  bads: {
    "a typed email destination is not an email address": [
      [message({ to_address: "dana@@example" })],
      [message({ to_address: "dana example.com" })],
    ],
    "a typed text destination is not a full international number": [
      [message({ channel: "sms", to_address: "555-0100" })],
      [message({ channel: "sms", to_address: "+0123456789" })],
      [message({ channel: "sms", to_address: "5550109999" })],
    ],
    "a typed destination was put on a channel nobody can address by hand": [
      [message({ channel: "voice", to_address: "+15550109999" })],
    ],
  },
});

// ───────────────────────── wiring ─────────────────────────

test("each live case names the lane and this test, and its control is on the contract of the same text", () => {
  for (const [i, c] of FIN_B16_LIVE_CASES.entries()) {
    assert.equal(c.depth, "deep");
    assert.match(c.evidence, /gap-catalog-display\.mjs/);
    assert.deepEqual([...c.tests], ["src/pulse/catalog/proofs/fin-b16-live-contracts.test.mjs"]);
    assert.equal(c.control, FIN_B16_RESULT_CONTRACTS[i].control);
    assert.equal(c.surface, FIN_B16_CHECKS[i].surface);
  }
});
