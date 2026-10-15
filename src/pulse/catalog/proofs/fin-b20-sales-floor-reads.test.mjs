// Finish-853 batch 20: the read modules the sales-floor panels are painted from, run over a stand-in
// database that carries the real column names (beliefAnalytics, listUnloggedCalls, listUnrecordedCalls),
// and salesFloor() for the compliance sentence. No browser. Fake people, fake numbers, nothing is saved
// anywhere real. The page half is in fin-b20-sales-floor.test.mjs.

import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { schemaColumns, portableSql } from "./fin-b20-sql-kit.mjs";
import { beliefAnalytics, salesFloor } from "../../../sales/metrics.mjs";
import { listUnloggedCalls, countUnlogged } from "../../../sales/call-outcomes.mjs";
import { listUnrecordedCalls, isUnrecorded, GRACE_MS } from "../../../sales/unrecorded.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T17:00:00.000Z");
const day = (n, minutes = 0) => new Date(NOW.getTime() - n * 86_400_000 - minutes * 60_000).toISOString();
let n = 0;
const id = (p) => `${p}-${String(++n).padStart(4, "0")}`;

// ---------------------------------------------------------------------------------------------
// A pg-shaped adapter over SQLite with the real column names.
function standIn(tables) {
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
      const stmt = sqlite.prepare(portableSql(sql));
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
  const log = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "callback", logged_at: day(2), ...over });
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
  const log = (over) => db.insert("call_outcomes", { id: id("o"), org_id: ORG, client_id: "c1", staff_id: "s1", outcome: "callback", logged_at: day(2), ...over });
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

// ---------------------------------------------------------------------------------------------
test("floor discipline: calls not logged are past-due closer booking tasks with no disposition", async () => {
  const db = standIn(["tasks", "call_outcomes", "clients"]);
  const t = (over) => db.insert("tasks", { id: id("t"), org_id: ORG, assignee_role: "closer", title: "Strategy session booked", body: id("BK"), due_at: day(1), done: false, ...over });
  t({ id: "t-a" }); t({ id: "t-b", title: "Strategy session rescheduled" });
  t({ id: "t-logged" });
  db.insert("call_outcomes", { id: id("o"), org_id: ORG, task_id: "t-logged", client_id: "c1", staff_id: "s1", outcome: "deposit" });
  t({ id: "t-future", due_at: new Date(NOW.getTime() + 86_400_000).toISOString() });
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
  // not asserted: a call with a transcript and no recording address (see the manifest, product finding)
  assert.equal(rows.every((r) => r.flag === "unrecorded"), true);
  assert.equal(GRACE_MS, 20 * 60 * 1000);
  assert.equal(isUnrecorded({ outcome: "deposit", logged_at: day(0, 19) }, { now: NOW }), false, "nineteen minutes is inside the grace window");
  assert.equal(isUnrecorded({ outcome: "deposit", logged_at: day(0, 21) }, { now: NOW }), true, "twenty-one minutes is not");
});

// ---------------------------------------------------------------------------------------------
// salesFloor(): the compliance sentence. A canned database: every statement answers empty except the
// recordings reads, so the sentence is judged from the recordings it is built from.
function floorDb({ files = [], outcomes = [] } = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      if (/FROM brain_files bf/.test(s) && /needs_transcription/.test(s)) return { rows: files };
      if (/o\.recording_url IS NOT NULL/.test(s) && /o\.transcript/.test(s)) return { rows: outcomes };
      return { rows: [] };
    },
  };
}

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

