// The send-path SQL, run against a REAL Postgres through the real read box.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL. A SKIPPED PG TEST IS NOT GREEN. ***
// It is READ ONLY by construction: every statement goes through openReadBox (one SELECT or WITH ... SELECT
// per call, inside BEGIN READ ONLY, rolled back at the end). It writes nothing and sends nothing. It checks
// SHAPE only (the columns exist and come back as numbers or dates), never the live values, so it passes on an
// empty scratch database and on production alike.
//
// WHY IT EXISTS. A fake that answers any SQL proves nothing about the SQL. Every query in send-path.mjs
// names tables and columns (messages.blocked_reason, message_channel_routing.enabled, job_heartbeats.outcome ...).
// A renamed column would make a fake-backed test stay green while the beat went red every hour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { openReadBox } from "../readbox.mjs";
import { makeBeatCtx } from "../ctx.mjs";
import { runBeat } from "../contract.mjs";
import * as L from "./send-path.mjs";
import * as textBeat from "../beat-text-path.mjs";
import * as emailBeat from "../beat-email-path.mjs";

const SKIP = process.env.DATABASE_URL ? false : "no DATABASE_URL (a skipped pg test is not green)";
const require = createRequire(import.meta.url);

function connect() {
  const pg = require("pg");
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(url);
  return (async () => {
    const c = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    c.on("error", () => {});
    await c.connect();
    return c;
  })();
}

const iso = (ms) => new Date(Date.now() - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/* ------------------------------------------------------------------------------------------------
   THE LOGIC TESTS. The shape test above proves the columns exist. These prove the queries COUNT
   RIGHT: each swaps the table in the query for a VALUES list of rows made up here, then runs the
   query text the beat really runs, through the read box. Nothing is written (a VALUES list is not a
   table) and no live row is read except orgs, to find the default company. Every row below is one
   edge: stuck, waiting, held, demo, test address, too young, wrong channel, wrong direction, wrong
   company. If a clause in the query is flipped, dropped or misspelled the count changes and a test
   fails (checked by 13 deliberate breaks, see the task report).
   ------------------------------------------------------------------------------------------------ */

const NOW_MS = Date.now();
const ago = (minutes) => new Date(NOW_MS - minutes * MIN).toISOString();
const ahead = (minutes) => new Date(NOW_MS + minutes * MIN).toISOString();
const OTHER_ORG = "99999999-9999-4999-8999-999999999999";
const FIXED_ORG = "11111111-1111-4111-8111-111111111111";
const DEFAULT_ORG_SUBQUERY = "(SELECT id FROM orgs WHERE is_default LIMIT 1)";

const q = (v, type) => (v === null || v === undefined ? `NULL::${type}` : `'${String(v).replace(/'/g, "''")}'::${type}`);
const MSG_TYPES = {
  org_id: "uuid", direction: "text", channel: "text", status: "text", last_error: "text", scheduled_at: "timestamptz",
  created_at: "timestamptz", last_attempt_at: "timestamptz", updated_at: "timestamptz", blocked_reason: "text",
  blocked_at: "timestamptz", is_demo: "boolean", to_address: "text", client_id: "uuid"
};

/* Swap a table in the query (its exact text, e.g. "messages m") for a VALUES list with the same alias. The table text
   must appear exactly once: a query that changes shape makes this fail loudly instead of testing nothing. */
function swapTable(sql, table, alias, types, rows) {
  const cols = Object.keys(types);
  const body = rows.map((r) => `(${cols.map((c) => q(r[c], types[c])).join(", ")})`).join(",\n  ");
  assert.equal(sql.split(table).length - 1, 1, `${JSON.stringify(table)} must appear exactly once in the query`);
  return sql.replace(table, `(VALUES\n  ${body}) AS ${alias}(${cols.join(", ")})`);
}

/* A message row with sane defaults: a healthy old sent text to a real-looking number, in the default company. */
function msg(org, over) {
  return {
    org_id: org, direction: "outbound", channel: "sms", status: "sent", last_error: null, scheduled_at: null,
    created_at: ago(300), last_attempt_at: null, updated_at: ago(300), blocked_reason: null, blocked_at: null,
    is_demo: false, to_address: "+15005550006", client_id: null, ...over
  };
}

async function withBox(fn) {
  const box = await openReadBox({ connect });
  let out;
  try {
    const one = await box.read("SELECT id FROM orgs WHERE is_default LIMIT 1", []);
    // A scratch database may have no default company: then the company lookup is pinned to a made-up id instead.
    const live = one.rows[0] ? one.rows[0].id : null;
    const org = live || FIXED_ORG;
    const scope = (sql) => (live ? sql : sql.split(DEFAULT_ORG_SUBQUERY).join(`'${FIXED_ORG}'::uuid`));
    out = await fn({ box, org, scope });
  } catch (err) {
    await box.close().catch(() => {});
    throw err; // the real error, not the close report
  }
  const rep = await box.close();
  assert.equal(rep.commitsSent, 0);
  assert.equal(rep.refused.length, 0);
  assert.equal(rep.errors, 0);
  assert.equal(rep.rolledBack, true);
  return out;
}

const near = (value, expectedIso, slackMs = 1500) => Math.abs(new Date(value).getTime() - new Date(expectedIso).getTime()) < slackMs;

test("QUEUE_SQL counts only what is really stuck: stuck queued, due scheduled, stuck sending", { skip: SKIP }, async () => {
  await withBox(async ({ box, org, scope }) => {
    const rows = [
      msg(org, { status: "queued", created_at: ago(40), last_error: "boom-1" }),                                           // 1 stuck (40 min)
      msg(org, { status: "queued", created_at: ago(120), scheduled_at: ago(20), last_error: "boom-2" }),                  // 2 stuck: scheduled time (20 min) wins over created
      msg(org, { status: "queued", created_at: ago(40), scheduled_at: ahead(30) }),                                         // future scheduled: waiting its turn
      msg(org, { status: "queued", created_at: ago(40), blocked_reason: "quiet_hours" }),                                   // held
      msg(org, { status: "queued", created_at: ago(40), is_demo: true }),                                                   // demo
      msg(org, { status: "queued", created_at: ago(40), to_address: "qa@example.com" }),                                    // test address
      msg(org, { status: "queued", created_at: ago(40), to_address: "+walk-12@x.test" }),                                   // test address (walk)
      msg(org, { status: "queued", created_at: ago(5) }),                                                                   // 5 minutes: not yet
      msg(org, { status: "queued", created_at: ago(15) }),                                                                  // 15 minutes exactly-ish: the cutoff is strictly older
      msg(org, { status: "sending", created_at: ago(60), last_attempt_at: ago(12) }),                                       // 3 stuck sending (12 min)
      msg(org, { status: "sending", created_at: ago(60), last_attempt_at: ago(5) }),                                        // sending 5 min: fine
      msg(org, { status: "sent", created_at: ago(240), last_attempt_at: ago(200) }),                                        // already sent
      msg(org, { status: "failed", created_at: ago(240), last_attempt_at: ago(200) }),                                      // failed is not in the line
      msg(org, { status: "queued", created_at: ago(40), channel: "email" }),                                                // other channel
      msg(org, { status: "queued", created_at: ago(40), direction: "inbound" }),                                            // other direction
      msg(OTHER_ORG, { status: "queued", created_at: ago(40) })                                                             // other company
    ];
    const sql = scope(swapTable(L.QUEUE_SQL, "messages m", "m", MSG_TYPES, rows));
    const res = await box.read(sql, ["sms", ago(15), ago(10), L.TEST_ADDRESS_RE]);
    const r = res.rows[0];
    assert.equal(r.queued_n, 2, "stuck queued: row 1 and row 2 only");
    assert.equal(r.sending_n, 1, "stuck sending: row 10 only");
    assert.ok(near(r.oldest_queued, ago(40)), "the oldest queued is row 1 (40 min), not row 2 (20 min)");
    assert.ok(near(r.oldest_sending, ago(12)));
    assert.equal(r.sample_error, "boom-1", "the sample error is the oldest stuck row's");
    // another channel sees its own row only
    const email = (await box.read(sql, ["email", ago(15), ago(10), L.TEST_ADDRESS_RE])).rows[0];
    assert.deepEqual([email.queued_n, email.sending_n], [1, 0]);
    // a healthy line is all zeros and nulls, one row
    const empty = (await box.read(scope(swapTable(L.QUEUE_SQL, "messages m", "m", MSG_TYPES, [msg(org, { status: "queued", created_at: ago(2) })])), ["sms", ago(15), ago(10), L.TEST_ADDRESS_RE])).rows;
    assert.equal(empty.length, 1);
    assert.deepEqual([empty[0].queued_n, empty[0].sending_n, empty[0].oldest_queued, empty[0].sample_error], [0, 0, null, null]);
  });
});

test("FAILURE_SQL counts failed, bounced, refused and sent inside the hour, and leaves out what is not our problem", { skip: SKIP }, async () => {
  await withBox(async ({ box, org, scope }) => {
    const inHour = { created_at: ago(300), last_attempt_at: ago(10) }; // created long ago: the window must read the attempt time, not created_at
    const rows = [
      // failed: 3 count
      msg(org, { ...inHour, status: "failed", last_error: "Twilio 30003", updated_at: ago(30) }),
      msg(org, { ...inHour, status: "failed", last_error: "newest-err", updated_at: ago(5) }),
      msg(org, { ...inHour, status: "failed", last_error: "Twilio 30005", updated_at: ago(40) }),
      // failed that must NOT count
      msg(org, { status: "failed", last_error: "old", created_at: ago(300), last_attempt_at: ago(120), updated_at: ago(2) }),   // outside the hour (newest updated: would win the sample if counted)
      msg(org, { ...inHour, status: "failed", last_error: "the client has no phone number to send to", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "test record from a journey run", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "test address: example.com", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "demo", is_demo: true, updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "to a test number", to_address: "x@example.com", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "email channel", channel: "email", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "failed", last_error: "inbound", direction: "inbound", updated_at: ago(1) }),
      msg(OTHER_ORG, { ...inHour, status: "failed", last_error: "other company", updated_at: ago(1) }),
      // sent / delivered: 4 count
      msg(org, { ...inHour, status: "sent" }), msg(org, { ...inHour, status: "sent" }), msg(org, { ...inHour, status: "sent" }),
      msg(org, { ...inHour, status: "delivered" }),
      msg(org, { status: "sent", created_at: ago(300), last_attempt_at: ago(120) }), // outside the hour
      // bounced: 2 count
      msg(org, { ...inHour, status: "bounced" }), msg(org, { ...inHour, status: "bounced" }),
      // blocked that DOES count: 3
      msg(org, { ...inHour, status: "blocked", blocked_reason: "gate_error", updated_at: ago(3) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: "opted_out,gate_error", updated_at: ago(20) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: null, last_error: "placeholder_copy", updated_at: ago(25) }),
      // blocked that is the person's own doing, or by design: NOT counted
      msg(org, { ...inHour, status: "blocked", blocked_reason: "opted_out", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: "recipient_unknown", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: "quiet_hours,opted_out", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: null, last_error: "retired_ghl_doc", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: null, last_error: "test address: example.com is reserved for testing", updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: "gate_error", is_demo: true, updated_at: ago(1) }),
      msg(org, { ...inHour, status: "blocked", blocked_reason: "gate_error", channel: "email", updated_at: ago(1) }),
      msg(OTHER_ORG, { ...inHour, status: "blocked", blocked_reason: "gate_error", updated_at: ago(1) }),
      // not in the list at all
      msg(org, { ...inHour, status: "queued" }), msg(org, { ...inHour, status: "sending" })
    ];
    const sql = scope(swapTable(L.FAILURE_SQL, "messages m", "m", MSG_TYPES, rows));
    const r = (await box.read(sql, ["sms", ago(60), L.TEST_ADDRESS_RE])).rows[0];
    assert.deepEqual(
      { failed: r.failed_n, bounced: r.bounced_n, blocked: r.blocked_n, ok: r.ok_n },
      { failed: 3, bounced: 2, blocked: 3, ok: 4 }
    );
    assert.equal(r.sample_error, "newest-err", "the newest counted failure is the sample (the newer excluded rows are not)");
    assert.equal(r.sample_block, "gate_error", "the newest counted refusal is the sample");
    // and the judge, fed the real counts, turns it red on the rule (3 failed vs 4 went through is NOT red; refusals 3 vs 4 is NOT red)
    assert.equal(L.judgeFailures({ row: r, path: L.TEXT_PATH }).problem, null);
    assert.match(L.judgeFailures({ row: { ...r, ok_n: 0 }, path: L.TEXT_PATH }).problem, /failed/);
  });
});

test("RECEIPT_SQL counts hand-offs and receipts inside the day, after the settle time, and leaves out test traffic", { skip: SKIP }, async () => {
  await withBox(async ({ box, org, scope }) => {
    const settled = { created_at: ago(300), last_attempt_at: ago(120) };
    const rows = [
      msg(org, { ...settled, status: "sent" }), msg(org, { ...settled, status: "sent" }), msg(org, { ...settled, status: "sent" }),
      msg(org, { status: "sent", created_at: ago(180), last_attempt_at: null }),                   // no attempt time: created_at is used (3 h)
      msg(org, { ...settled, status: "delivered" }), msg(org, { ...settled, status: "delivered" }),
      msg(org, { ...settled, status: "bounced" }),
      // must NOT count
      msg(org, { status: "sent", created_at: ago(300), last_attempt_at: ago(10) }),                 // too fresh to have a receipt
      msg(org, { status: "delivered", created_at: ago(2000), last_attempt_at: ago(30 * 60) }),     // older than 24 h
      msg(org, { ...settled, status: "failed" }),
      msg(org, { ...settled, status: "queued" }),
      msg(org, { ...settled, status: "sent", is_demo: true }),
      msg(org, { ...settled, status: "delivered", to_address: "t@example.org" }),
      msg(org, { ...settled, status: "sent", channel: "email" }),
      msg(org, { ...settled, status: "sent", direction: "inbound" }),
      msg(OTHER_ORG, { ...settled, status: "delivered" })
    ];
    const sql = scope(swapTable(L.RECEIPT_SQL, "messages m", "m", MSG_TYPES, rows));
    const r = (await box.read(sql, ["sms", ago(24 * 60), ago(30), L.TEST_ADDRESS_RE])).rows[0];
    assert.deepEqual({ handed: r.handed_n, receipts: r.receipts_n, waiting: r.waiting_n }, { handed: 7, receipts: 3, waiting: 4 });
    const j = L.judgeReceipts({ row: r, path: L.TEXT_PATH });
    assert.equal(j.amber, false, "3 receipts of 7: fine");
    const none = (await box.read(scope(swapTable(L.RECEIPT_SQL, "messages m", "m", MSG_TYPES, [...rows.filter((x) => x.status === "sent" || x.status === "queued"), msg(org, { ...settled, status: "sent" })])), ["sms", ago(24 * 60), ago(30), L.TEST_ADDRESS_RE])).rows[0];
    assert.deepEqual([none.handed_n, none.receipts_n], [5, 0]);
    assert.equal(L.judgeReceipts({ row: none, path: L.TEXT_PATH }).amber, true, "5+ hand-offs and no receipt is the amber note");
  });
});

test("HEARTBEAT_SQL returns the sweeper's newest runs first and nobody else's", { skip: SKIP }, async () => {
  await withBox(async ({ box }) => {
    const HB_TYPES = { job: "text", finished_at: "timestamptz", outcome: "text" };
    const rows = [
      { job: "message-dispatch-sweeper", finished_at: ago(32), outcome: "ok" },
      { job: "message-dispatch-sweeper", finished_at: ago(2), outcome: "ok" },          // newest
      { job: "other-job", finished_at: ago(1), outcome: "ok" },                          // newer, but not ours
      { job: "message-dispatch-sweeper", finished_at: ago(22), outcome: "error" },
      { job: "message-dispatch-sweeper", finished_at: ago(7), outcome: "error" },
      { job: "message-dispatch-sweeper", finished_at: ago(12), outcome: "ok" }
    ];
    const sql = swapTable(L.HEARTBEAT_SQL, "job_heartbeats h", "h", HB_TYPES, rows);
    const got = (await box.read(sql, [L.SWEEPER_JOB])).rows;
    assert.equal(got.length, 3, "the three newest");
    assert.deepEqual(got.map((r) => r.outcome), ["ok", "error", "ok"]);
    assert.ok(near(got[0].finished_at, ago(2)) && near(got[1].finished_at, ago(7)) && near(got[2].finished_at, ago(12)), "newest first");
    assert.equal((await box.read(sql, ["a-job-that-never-ran"])).rows.length, 0, "an unknown job has no rows");
    // the real table, an unknown job: nothing
    assert.equal((await box.read(L.HEARTBEAT_SQL, ["pulse-no-such-job"])).rows.length, 0);
    // and the judge on those rows: newest is 2 minutes old, so on time
    assert.equal(L.judgeHeartbeat({ rows: got, now: new Date(NOW_MS) }).problem, null);
  });
});

test("FENCE_SQL reads the default company's switch and the channel's own route", { skip: SKIP }, async () => {
  await withBox(async ({ box }) => {
    const DEFAULT = "22222222-2222-4222-8222-222222222222";
    const NOT_DEFAULT = "33333333-3333-4333-8333-333333333333";
    const build = ({ settings, routes }) => {
      let sql = swapTable(L.FENCE_SQL, "orgs o", "o", { id: "uuid", is_default: "boolean" }, [
        { id: NOT_DEFAULT, is_default: false }, { id: DEFAULT, is_default: true }
      ]);
      sql = swapTable(sql, "messaging_settings s", "s", { org_id: "uuid", outbound_enabled: "boolean" }, settings);
      return swapTable(sql, "message_channel_routing r", "r", { org_id: "uuid", channel: "text", enabled: "boolean", provider: "text" }, routes);
    };
    const settings = [{ org_id: NOT_DEFAULT, outbound_enabled: false }, { org_id: DEFAULT, outbound_enabled: true }];
    const routes = [
      { org_id: NOT_DEFAULT, channel: "sms", enabled: false, provider: "nope" },
      { org_id: DEFAULT, channel: "sms", enabled: true, provider: "twilio" },
      { org_id: DEFAULT, channel: "email", enabled: false, provider: "resend" }
    ];
    const sql = build({ settings, routes });
    const sms = (await box.read(sql, ["sms"])).rows[0];
    assert.deepEqual([sms.has_settings, sms.outbound_enabled, sms.has_route, sms.route_enabled, sms.provider], [true, true, true, true, "twilio"], "the default company, not the other one");
    const email = (await box.read(sql, ["email"])).rows[0];
    assert.deepEqual([email.has_route, email.route_enabled, email.provider], [true, false, "resend"]);
    const voice = (await box.read(sql, ["voice"])).rows[0];
    assert.deepEqual([voice.has_route, voice.route_enabled, voice.provider], [false, null, null], "a channel with no route row");
    assert.equal(voice.outbound_enabled, true);
    // no settings row for the default company: has_settings false
    const noSettings = (await box.read(build({ settings: [{ org_id: NOT_DEFAULT, outbound_enabled: true }], routes }), ["sms"])).rows[0];
    assert.deepEqual([noSettings.has_settings, noSettings.outbound_enabled], [false, null]);
    // switch off
    const off = (await box.read(build({ settings: [{ org_id: DEFAULT, outbound_enabled: false }], routes }), ["sms"])).rows[0];
    assert.deepEqual([off.has_settings, off.outbound_enabled], [true, false]);
    // and the judge on them
    assert.match(L.judgeFence({ row: voice, live: false, env: {}, path: L.TEXT_PATH }).problems.join(" "), /No route is saved/);
    assert.match(L.judgeFence({ row: off, live: false, env: {}, path: L.TEXT_PATH }).problems.join(" "), /OFF/);
    // the real tables with a channel nobody routes: has_route false
    const real = (await box.read(L.FENCE_SQL, ["pulse-no-such-channel"])).rows[0];
    if (real) assert.equal(real.has_route, false);
  });
});

test("TEMPLATE_SQL returns this company's templates for this channel and these keys only", { skip: SKIP }, async () => {
  await withBox(async ({ box, org, scope }) => {
    const T = { org_id: "uuid", channel: "text", template_key: "text", compliance_passed: "boolean", body: "text", subject: "text" };
    const t = (over) => ({ org_id: org, channel: "sms", template_key: "SMS-S00-WELCOME", compliance_passed: true, body: "hi", subject: null, ...over });
    const rows = [
      t({}),
      t({ template_key: "SMS-S04-01-CONFIRM", compliance_passed: false, body: "lorem ipsum" }),
      t({ org_id: OTHER_ORG, template_key: "SMS-DOC-01-REQUEST" }),         // other company
      t({ channel: "email", template_key: "SMS-DOC-01-REQUEST" }),          // other channel
      t({ template_key: "SMS-NOT-ON-THE-PATH" })                             // key not asked for
    ];
    const sql = scope(swapTable(L.TEMPLATE_SQL, "message_templates t", "t", T, rows));
    const got = (await box.read(sql, ["sms", [...L.TEXT_PATH.templates]])).rows;
    assert.deepEqual(got.map((r) => r.template_key).sort(), ["SMS-S00-WELCOME", "SMS-S04-01-CONFIRM"]);
    const v = L.judgeTemplates({ rows: got, path: L.TEXT_PATH });
    assert.equal(v.problems.length, 2, "SMS-S04-01-CONFIRM is unapproved with lorem ipsum, and SMS-DOC-01-REQUEST (other company) is missing");
    assert.match(v.problems.join(" "), /SMS-DOC-01-REQUEST is missing/);
  });
});

test("OPT_OUT_SQL counts the list and the active opt-outs", { skip: SKIP }, async () => {
  await withBox(async ({ box }) => {
    const O = { opted_out_at: "timestamptz", opted_in_at: "timestamptz" };
    const rows = [
      { opted_out_at: ago(100), opted_in_at: null },                // active
      { opted_out_at: ago(100), opted_in_at: ago(50) },             // opted back in
      { opted_out_at: null, opted_in_at: null },                    // never opted out
      { opted_out_at: ago(10), opted_in_at: null }                  // active
    ];
    const sql = swapTable(L.OPT_OUT_SQL, "opt_outs", "opt_outs", O, rows);
    const r = (await box.read(sql, [])).rows[0];
    assert.deepEqual([r.total, r.active_n], [4, 2]);
  });
});

test("send-path SQL runs on a real database: every query returns the columns the judges read", { skip: SKIP }, async () => {
  const box = await openReadBox({ connect });
  try {
    for (const path of [L.TEXT_PATH, L.EMAIL_PATH]) {
      const fence = await box.read(L.FENCE_SQL, [path.channel]);
      assert.ok(fence.rows.length <= 1);
      if (fence.rows[0]) for (const k of ["has_settings", "outbound_enabled", "has_route", "route_enabled", "provider"]) assert.ok(k in fence.rows[0], `fence.${k}`);

      const tpl = await box.read(L.TEMPLATE_SQL, [path.channel, [...path.templates]]);
      for (const r of tpl.rows) for (const k of ["template_key", "compliance_passed", "body", "subject"]) assert.ok(k in r, `templates.${k}`);

      const queue = await box.read(L.QUEUE_SQL, [path.channel, iso(15 * MIN), iso(10 * MIN), L.TEST_ADDRESS_RE]);
      assert.equal(queue.rows.length, 1);
      for (const k of ["queued_n", "oldest_queued", "sending_n", "oldest_sending", "sample_error"]) assert.ok(k in queue.rows[0], `queue.${k}`);
      assert.equal(typeof queue.rows[0].queued_n, "number");
      assert.equal(typeof queue.rows[0].sending_n, "number");

      const fail = await box.read(L.FAILURE_SQL, [path.channel, iso(HOUR), L.TEST_ADDRESS_RE]);
      assert.equal(fail.rows.length, 1);
      for (const k of ["failed_n", "bounced_n", "blocked_n", "ok_n", "sample_error", "sample_block"]) assert.ok(k in fail.rows[0], `failures.${k}`);
      assert.equal(typeof fail.rows[0].blocked_n, "number");
      assert.equal(typeof fail.rows[0].failed_n, "number");

      const rec = await box.read(L.RECEIPT_SQL, [path.channel, iso(24 * HOUR), iso(30 * MIN), L.TEST_ADDRESS_RE]);
      assert.equal(rec.rows.length, 1);
      for (const k of ["handed_n", "receipts_n", "waiting_n"]) assert.equal(typeof rec.rows[0][k], "number", `receipts.${k}`);
      assert.ok(rec.rows[0].receipts_n <= rec.rows[0].handed_n);
    }
    const hb = await box.read(L.HEARTBEAT_SQL, [L.SWEEPER_JOB]);
    assert.ok(hb.rows.length <= 3);
    for (const r of hb.rows) { assert.ok(r.finished_at instanceof Date); assert.ok(typeof r.outcome === "string"); }
    const opt = await box.read(L.OPT_OUT_SQL, []);
    assert.equal(opt.rows.length, 1);
    assert.equal(typeof opt.rows[0].total, "number");
    assert.ok(opt.rows[0].active_n <= opt.rows[0].total);
  } finally {
    const rep = await box.close();
    assert.equal(rep.commitsSent, 0, "the box never sends COMMIT");
    assert.equal(rep.rolledBack, true);
    assert.equal(rep.leaked, false);
  }
});

test("send-path SQL: the test-address filter takes test traffic out (a pattern that matches nothing keeps it in)", { skip: SKIP }, async () => {
  const box = await openReadBox({ connect });
  try {
    for (const path of [L.TEXT_PATH, L.EMAIL_PATH]) {
      const real = await box.read(L.RECEIPT_SQL, [path.channel, iso(400 * 24 * HOUR), iso(0), L.TEST_ADDRESS_RE]);
      const all = await box.read(L.RECEIPT_SQL, [path.channel, iso(400 * 24 * HOUR), iso(0), "^$never-matches^"]);
      assert.ok(real.rows[0].handed_n <= all.rows[0].handed_n, `${path.channel}: the filter can only remove rows`);
    }
  } finally {
    await box.close();
  }
});

test("send-path beats run end to end on a real database: no step fails because of the SQL, nothing is refused, nothing is written", { skip: SKIP }, async () => {
  const box = await openReadBox({ connect });
  try {
    for (const beat of [textBeat, emailBeat]) {
      const ctx = makeBeatCtx({ beat, runId: "pg-test", env: {}, read: box.read });
      const result = await runBeat(beat, ctx);
      // The live state decides green or red (a switch can be off, a template unapproved). What must NOT happen is a red
      // caused by the code itself: a bad column, a refused query, a thrown error.
      assert.doesNotMatch(result.detail, /could not read|threw|refused|harness error/, `${beat.id}: ${result.step}: ${result.detail}`);
      assert.ok(result.ok || beat.steps.includes(result.step), `${beat.id} went red at an undeclared step ${result.step}`);
    }
  } finally {
    const rep = await box.close();
    assert.equal(rep.refused.length, 0);
    assert.equal(rep.commitsSent, 0);
    assert.equal(rep.errors, 0, "no read errored");
  }
});
