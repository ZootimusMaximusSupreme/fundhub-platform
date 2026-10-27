// Finish-853 batch 20: the read modules the sales-floor panels are painted from, run over a stand-in
// database that carries the real column names (beliefAnalytics, listUnloggedCalls, listUnrecordedCalls),
// and salesFloor() for the compliance sentence. No browser. Fake people, fake numbers, nothing is saved
// anywhere real. The page half is in fin-b20-sales-floor.test.mjs.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { schemaColumns, portableSql } from "./fin-b20-sql-kit.mjs";
import { DISCIPLINE_SQL } from "./fin-b20-sql.mjs";
import { beliefAnalytics, salesFloor } from "../../../sales/metrics.mjs";
import { listUnloggedCalls, countUnlogged } from "../../../sales/call-outcomes.mjs";
import { listUnrecordedCalls, isUnrecorded, hasTape, countUnrecorded, GRACE_MS, LOOKBACK_DAYS } from "../../../sales/unrecorded.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T17:00:00.000Z");
const day = (n, minutes = 0) => new Date(NOW.getTime() - n * 86_400_000 - minutes * 60_000).toISOString();
let n = 0;
const id = (p) => `${p}-${String(++n).padStart(4, "0")}`;

// ---------------------------------------------------------------------------------------------
// A pg-shaped adapter over SQLite with the real column names.
function standIn(tables, clock = NOW) {
  const schema = schemaColumns();
  const sqlite = new DatabaseSync(":memory:");
  for (const t of tables) {
    sqlite.exec(`CREATE TABLE ${t} (${[...schema.get(t)].map((c) => `"${c}"`).join(", ")})`);
  }
  return {
    insert(table, row) {
      const cols = schema.get(table);
      const keys = Object.keys(row);
      for (const k of keys) assert.ok(cols.has(k), `${table} has no column ${k}`);
      sqlite.prepare(`INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`)
        .run(...keys.map((k) => (row[k] === true ? 1 : row[k] === false ? 0 : row[k])));
    },
    async query(sql, params = []) {
      const stmt = sqlite.prepare(portableSql(sql).replace(/'now'/g, "'" + clock.toISOString() + "'"));
      return { rows: stmt.all(...params).map((r) => ({ ...r })) };
    },
  };
}

// ---------------------------------------------------------------------------------------------
test("belief panel: this period against last period, a belief only counts at three or more to run hot", async () => {
  const db = standIn(["call_outcomes", "clients", "client_custom_fields"]);
  db.insert("clients", { id: "c1", org_id: ORG, channel_source: "organic" });
  db.insert("clients", { id: "c2", org_id: ORG });
  db.insert("clients", { id: "c9", org_id: OTHER });
  db.insert("client_custom_fields", { client_id: "c2", org_id: ORG, utm_campaign: "oct-ads", cf_setter_user_id: "setter-7" });
  const log = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "callback", logged_at: day(2),
    transaction_id: over.outcome === "deposit" ? id("tx") : null, cash_collected_cents: over.outcome === "deposit" ? 10000 : 0, ...over });
  for (let i = 0; i < 3; i += 1) log({ belief_failed: "trust" });                  // this period: 3
  log({ belief_failed: "trust", logged_at: day(40) });                             // last period: 1
  log({ belief_failed: "money", client_id: "c2", outcome: "deposit" });            // this period: 1, on a campaign, with a setter
  log({ belief_failed: "money", logged_at: day(40) });
  log({ belief_failed: "money", logged_at: day(40) });
  log({ belief_failed: null, outcome: "no_show" });                                // held? no: a no-show
  log({ belief_failed: "trust", org_id: OTHER, client_id: "c9" });                 // another company
  const start = new Date("2026-10-01T00:00:00.000Z");
  const end = new Date("2026-11-01T00:00:00.000Z");
  const out = await beliefAnalytics(db, { orgId: ORG, start, end });
  const by = Object.fromEntries(out.beliefs.map((b) => [b.belief, b]));
  assert.deepEqual([by.trust.this_count, by.trust.last_count], [3, 1]);
  assert.deepEqual([by.money.this_count, by.money.last_count], [1, 2]);
  assert.equal(by.pain.this_count, 0);
  assert.equal(out.beliefs[0].belief, "trust", "the belief with the most failures this period is first");
  assert.equal(out.beliefs.length, 7, "all seven beliefs are listed, even at zero");
  // lead source: utm_campaign first, then channel_source, then unknown; setter from the custom field
  const src = Object.fromEntries(out.sources.map((s) => [`${s.lead_source}|${s.setter_key}`, s]));
  assert.ok(src["oct-ads|setter-7"], "a client on a campaign with a setter is cut by both");
  assert.ok(src["organic|unknown"], "no campaign falls back to the channel source, no setter says unknown");
  assert.equal(src["oct-ads|setter-7"].deposits, 1);
  assert.equal(src["oct-ads|setter-7"].held, 1);
  assert.equal(src["oct-ads|setter-7"].close_rate, 1);
  assert.equal(src["organic|unknown"].held, 3, "three held calls this period; the no-show and the 40-day-old ones are not held calls of this period");
  assert.equal(src["organic|unknown"].deposits, 0);
  assert.equal(src["organic|unknown"].close_rate, 0);
  assert.equal(src["oct-ads|setter-7"].desire, 0);
  assert.deepEqual(out.period, { start: start.toISOString(), end: end.toISOString() });
  assert.ok(Date.parse(out.prior.end) <= Date.parse(out.period.start) + 1, "last period ends where this one starts");
});

test("lead-source panel: desire counts sort a source to the top and another company's calls never count", async () => {
  const db = standIn(["call_outcomes", "clients", "client_custom_fields"]);
  db.insert("clients", { id: "c1", org_id: ORG, channel_source: "organic" });
  db.insert("clients", { id: "c2", org_id: ORG });
  db.insert("clients", { id: "c9", org_id: OTHER });
  db.insert("client_custom_fields", { client_id: "c2", org_id: ORG, utm_source: "podcast" });
  const log = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "callback", logged_at: day(2),
    transaction_id: over.outcome === "deposit" ? id("tx") : null, cash_collected_cents: over.outcome === "deposit" ? 10000 : 0, ...over });
  log({ client_id: "c2", belief_failed: "desire" });
  log({ client_id: "c2", belief_failed: "desire" });
  log({ client_id: "c2", outcome: "deposit" });
  log({ outcome: "deposit" });
  log({ outcome: "deposit" });
  log({ outcome: "deposit" });
  log({ outcome: "callback" });
  log({ org_id: OTHER, client_id: "c9", belief_failed: "desire", outcome: "deposit" });
  const out = await beliefAnalytics(db, { orgId: ORG, start: new Date("2026-10-01T00:00:00.000Z"), end: new Date("2026-11-01T00:00:00.000Z") });
  assert.deepEqual(out.sources.map((s) => s.lead_source), ["podcast", "organic"], "most desire first");
  const podcast = out.sources[0];
  assert.deepEqual([podcast.held, podcast.deposits, podcast.desire], [3, 1, 2]);
  assert.equal(podcast.close_rate, 1 / 3);
  const organic = out.sources[1];
  assert.deepEqual([organic.held, organic.deposits, organic.desire], [4, 3, 0]);
  assert.equal(organic.close_rate, 3 / 4);
});

test("lead-source panel: a call is cut by campaign first, then source, then channel, then unknown (every step of the order is its own row)", async () => {
  const db = standIn(["call_outcomes", "clients", "client_custom_fields"]);
  const client = (cid, channel, fields) => {
    db.insert("clients", { id: cid, org_id: ORG, channel_source: channel });
    if (fields) db.insert("client_custom_fields", { client_id: cid, org_id: ORG, ...fields });
  };
  client("k-all", "channel-all", { utm_campaign: "campaign-all", utm_source: "source-all" });  // all three: the campaign wins
  client("k-source", "channel-source", { utm_source: "source-only" });                          // source and channel: the source wins
  client("k-channel", "channel-only", null);                                                    // channel alone
  client("k-campaign", "channel-camp", { utm_campaign: "campaign-only" });                      // campaign and channel: the campaign wins
  client("k-none", null, null);                                                                 // nothing at all
  const log = (cid) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: cid, staff_id: "s1", outcome: "callback", logged_at: day(2) });
  for (const cid of ["k-all", "k-source", "k-channel", "k-campaign", "k-none"]) log(cid);
  const out = await beliefAnalytics(db, { orgId: ORG, start: new Date("2026-10-01T00:00:00.000Z"), end: new Date("2026-11-01T00:00:00.000Z") });
  assert.deepEqual(out.sources.map((s) => s.lead_source).sort(),
    ["campaign-all", "campaign-only", "channel-only", "source-only", "unknown"].sort());
  assert.ok(out.sources.every((s) => s.held === 1));
});

// ---------------------------------------------------------------------------------------------
test("floor discipline: calls not logged are past-due closer booking tasks with no disposition", async () => {
  const db = standIn(["tasks", "call_outcomes", "clients"]);
  const t = (over) => db.insert("tasks", { id: id("t"), org_id: ORG, assignee_role: "closer", title: "Strategy session booked", body: id("BK"), due_at: day(1), done: false, ...over });
  t({ id: "t-a" }); t({ id: "t-b", title: "Strategy session rescheduled" });
  t({ id: "t-logged" });
  db.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: "t-logged", client_id: "c1", staff_id: "s1", outcome: "deposit" });
  t({ id: "t-future", due_at: "2099-01-01T00:00:00.000Z" });
  t({ id: "t-setter", assignee_role: "setter" });
  t({ id: "t-other", org_id: OTHER });
  t({ id: "t-title", title: "Chase the contract" });
  const rows = await listUnloggedCalls(db, { orgId: ORG, limit: 50 });
  assert.deepEqual(rows.map((r) => r.task_id).sort(), ["t-a", "t-b"]);
  assert.equal(await countUnlogged(db, { orgId: ORG }), 2);
});

test("floor discipline: calls not recorded are held calls with no recording and no words after twenty minutes", async () => {
  const db = standIn(["call_outcomes", "clients", "brain_drive_sync"]);
  const c = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "deposit", logged_at: day(0, 60), is_demo: false, ...over });
  c({ id: "u-old" });                                                         // an hour ago, no tape: unrecorded
  c({ id: "u-fresh", logged_at: day(0, 5) });                                 // five minutes ago: inside the grace window
  c({ id: "u-noshow", outcome: "no_show" });                                  // never held
  c({ id: "u-tape", recording_url: "https://drive.google.com/file/d/x/view" });
  c({ id: "u-demo", is_demo: true });
  c({ id: "u-old-day", logged_at: day(20) });                                 // outside the 14 day look-back
  c({ id: "u-other", org_id: OTHER });
  c({ id: "u-blank", recording_url: "   " });                                 // blank link is no link
  const rows = await listUnrecordedCalls(db, { orgId: ORG, now: NOW, limit: 20 });
  assert.deepEqual(rows.map((r) => r.id).sort(), ["u-blank", "u-old"]);
  // a call with a transcript and no recording address: see "the chip's number" test below (product finding 1)
  assert.equal(rows.every((r) => r.flag === "unrecorded"), true);
  assert.equal(GRACE_MS, 20 * 60 * 1000);
  assert.equal(isUnrecorded({ outcome: "deposit", logged_at: day(0, 19) }, { now: NOW }), false, "nineteen minutes is inside the grace window");
  assert.equal(isUnrecorded({ outcome: "deposit", logged_at: day(0, 21) }, { now: NOW }), true, "twenty-one minutes is not");
});

// ---------------------------------------------------------------------------------------------
// salesFloor(): the compliance sentence. A canned database: every statement answers empty except the
// recordings reads, so the sentence is judged from the recordings it is built from.
function floorDb({ files = [], outcomes = [], dailyTarget = null, monthlyTarget = null } = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM brain_files bf/.test(s) && /needs_transcription/.test(s)) return { rows: files };
      if (/o\.recording_url IS NOT NULL/.test(s) && /o\.transcript/.test(s)) return { rows: outcomes };
      if (/FROM staff_targets/.test(s) && /period = 'daily'/.test(s)) {
        return { rows: dailyTarget == null ? [] : [{ target_value: dailyTarget }] };
      }
      if (/FROM staff_targets/.test(s) && /period = 'monthly'/.test(s)) {
        return { rows: monthlyTarget == null ? [] : [{ target_value: monthlyTarget }] };
      }
      return { rows: [] };
    },
  };
}

test("sales floor read returns the saved daily team deposit target", async () => {
  const withTarget = await salesFloor(floorDb({ dailyTarget: "10" }), { orgId: ORG, now: NOW, env: {} });
  assert.equal(withTarget.today.target_deposits, 10);
  assert.equal(withTarget.today.target_reason, null);

  const withoutTarget = await salesFloor(floorDb(), { orgId: ORG, now: NOW, env: {} });
  assert.equal(withoutTarget.today.target_deposits, null);
  assert.equal(withoutTarget.today.target_reason, "No daily deposit target has been set for the sales team yet.");
});

test("compliance panel: the reason says words are on file, recordings wait for words, or there are none", async () => {
  const withWords = await salesFloor(floorDb({ outcomes: [{ id: "o1", recording_url: "https://drive.google.com/file/d/x/view", logged_at: day(0, 30), client_id: "c1", transcript: "words here", first_name: "A", last_name: "B" }] }), { orgId: ORG, now: NOW, env: {} });
  assert.equal(withWords.compliance.reason, "Call words are on file. Phrase flags are not scored yet.");
  assert.equal(withWords.compliance.available, false);
  assert.deepEqual(withWords.compliance.items, []);
  const noWords = await salesFloor(floorDb({ outcomes: [{ id: "o2", recording_url: "https://drive.google.com/file/d/y/view", logged_at: day(0, 30), client_id: "c1", transcript: null, first_name: "A", last_name: "B" }] }), { orgId: ORG, now: NOW, env: {} });
  assert.equal(noWords.compliance.reason, "Recordings are in Drive. Words fill in after Sync, or in the background for leftover files.");
  const none = await salesFloor(floorDb(), { orgId: ORG, now: NOW, env: {} });
  assert.match(none.compliance.reason, /^Google Drive is not connected yet\./);
  assert.equal(none.compliance.items.length, 0, "no flags exist, only a sentence");
});

// ---------------------------------------------------------------------------------------------
// "Has a tape" is the rule behind the panel's words "no recording and no transcript".
test("floor discipline: a recording address or a transcript, under either spelling of the address, is a tape; blank is not", () => {
  const held = { outcome: "deposit", logged_at: day(0, 60) };
  const unrecorded = (extra) => isUnrecorded({ ...held, ...extra }, { now: NOW });
  assert.equal(unrecorded({}), true, "nothing at all is unrecorded");
  assert.equal(unrecorded({ recording_url: "https://drive.google.com/file/d/x/view" }), false, "an address is a tape");
  assert.equal(unrecorded({ recordingUrl: "https://drive.google.com/file/d/x/view" }), false, "the camel-case spelling is a tape too");
  assert.equal(unrecorded({ transcript: "We agreed on the deposit." }), false, "words are a tape");
  assert.equal(unrecorded({ recording_url: "  ", transcript: "  " }), true, "blank is nothing");
  assert.equal(hasTape({ transcript: "words" }), true);
  assert.equal(hasTape({ recording_url: "" , transcript: "" }), false);
  assert.equal(unrecorded({ outcome: "No_Show" }), false, "a no-show is never unrecorded, in any case");
  assert.equal(LOOKBACK_DAYS, 14);
});

// ---------------------------------------------------------------------------------------------
// The live check reads the rows the chip is counted from. Run the REAL read and the REAL check text over
// the same stand-in rows: the check's sample is the chip's number, row for row.
test("floor discipline: the chip's number and the live check's rows are the same rows; a call with words but no address is listed (product finding 1)", async () => {
  const now = new Date();
  const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  const build = (withSync) => {
    const db = standIn(["call_outcomes", "clients", "brain_drive_sync", "tasks"], now);
    const c = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "deposit", logged_at: ago(120), is_demo: false, ...over });
    c({ id: "u-plain" });
    c({ id: "u-words", transcript: "We talked about the deposit and agreed on the plan." });
    c({ id: "u-blank-words", transcript: "   " });
    c({ id: "u-tape", recording_url: "https://drive.google.com/file/d/x/view", transcript: "words" });
    c({ id: "u-blank-url", recording_url: "  " });
    c({ id: "u-fresh", logged_at: ago(5) });
    c({ id: "u-noshow", outcome: "no_show", transcript: "words" });
    c({ id: "u-demo", is_demo: true });
    c({ id: "u-old", logged_at: ago(20 * 24 * 60) });
    c({ id: "u-other", org_id: OTHER });
    const t = (over) => db.insert("tasks", { id: id("t"), org_id: ORG, assignee_role: "closer", title: "Strategy session booked", body: id("BK"), due_at: ago(60), done: false, ...over });
    t({ id: "t-a" }); t({ id: "t-b", title: "Strategy session rescheduled" });
    t({ id: "t-logged" });
    db.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: "t-logged", client_id: "c1", staff_id: "s1", outcome: "deposit", recording_url: "https://drive.google.com/file/d/q/view", logged_at: ago(30) });
    t({ id: "t-future", due_at: ago(-600) });
    t({ id: "t-setter", assignee_role: "setter" });
    if (withSync) db.insert("brain_drive_sync", { org_id: ORG, last_sync_at: ago(2) });
    return db;
  };
  for (const withSync of [false, true]) {
    const db = build(withSync);
    const chip = await listUnrecordedCalls(db, { orgId: ORG, now, limit: 200 });
    const notLogged = await listUnloggedCalls(db, { orgId: ORG, limit: 200 });
    const check = (await db.query(DISCIPLINE_SQL, [ORG])).rows[0];
    assert.equal(Number(check.sample_count), chip.length + notLogged.length, `${withSync ? "with" : "without"} a Drive sync: the check judges the chip's rows and the unlogged tasks, no more and no fewer`);
    assert.equal(await countUnrecorded(db, { orgId: ORG, now }), chip.length);
    const ids = chip.map((r) => r.id).sort();
    if (withSync) {
      assert.deepEqual(ids, ["u-blank-url", "u-blank-words", "u-fresh", "u-plain", "u-words"], "a Drive sync after a call counts it inside the grace window");
    } else {
      assert.deepEqual(ids, ["u-blank-url", "u-blank-words", "u-plain", "u-words"]);
    }
    // PRODUCT FINDING 1, pinned in both directions on purpose. listUnrecordedCalls selects no transcript
    // column, so hasTape() never sees a transcript and the chip counts a call that has words. The live
    // check reads that as one wrong row. The day the read starts selecting o.transcript this assertion
    // fails: retire the transcript half of DISCIPLINE_SQL (fin-b20-sql.mjs) and this test in that change.
    assert.equal(ids.includes("u-words"), true, "finding 1: the chip counts a call that has a transcript and no address");
    assert.equal(Number(check.bad_count), 1, "the live check counts that one call as wrong (blank words are not words)");
  }
});
