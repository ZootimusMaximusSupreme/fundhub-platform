// Finish-853 batch 20: the sales-floor panels. Two halves.
//
//  1. The read modules the panels are painted from, run over a stand-in database that carries the real
//     column names (beliefAnalytics, listUnloggedCalls, listUnrecordedCalls) and, for the compliance
//     sentence, over salesFloor() with the recordings it is built from.
//  2. The real page script (public/app/sales-floor.js) in a real Chromium, answered by fake data, for the
//     header chips, the roster, the belief and source panels, the recording rows, the compliance panel
//     and the floor discipline panel.
//
// Fake people, fake numbers, no network, nothing is saved anywhere real.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { DatabaseSync } from "node:sqlite";

import { schemaColumns, portableSql } from "./fin-b20-sql-kit.mjs";
import { beliefAnalytics, salesFloor } from "../../../sales/metrics.mjs";
import { listUnloggedCalls, countUnlogged } from "../../../sales/call-outcomes.mjs";
import { listUnrecordedCalls, isUnrecorded, GRACE_MS } from "../../../sales/unrecorded.mjs";
import { openLab, makePage, callsTo, until } from "./fin-b20-browser-kit.mjs";

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

// ---------------------------------------------------------------------------------------------
// The page.
const FLOOR = {
  ok: true,
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" },
  hero: { cash_cents: 2500000, cash_display: "$25,000", target_cents: null, target_reason: "No monthly deposit target has been set for the sales team yet.", deposit_to_funded: 2 / 3, deposit_to_funded_n: { deposits: 3, funded: 2, rate: 2 / 3 } },
  funnel: { booked: 12, held: 8, show_rate: 8 / 12, deposits: 3, close_rate: 3 / 8, funded: 2, funded_of_deposits: 2 / 3, downsells: 1, downsell_cash_cents: 40000, downsell_cash_display: "$400" },
  today: { date: "2026-10-14", booked: 4, held: 3, deposits: 1, target_cents: null, target_reason: "No daily deposit target has been set for the sales team yet." },
  offer_stack: { available: true, items: [], totals: { units: 0, sold_cents: 0, collected_cents: 0 } },
  closers: [
    { staff_id: "s-1", name: "Chris Stanbridge", on_shift: true, shift_elapsed_ms: 3900000, calls: 6, close_rate: 0.5, funded_rate: 0.4, cash_cents: 1800000, cash_display: "$18,000", action: "Call the two deposits that have not funded.", deposits: 2, offer_stack: { available: true, items: [], totals: {} } },
    { staff_id: "s-2", name: "Casey Reed", on_shift: false, calls: 2, close_rate: 0.25, funded_rate: null, cash_cents: 700000, cash_display: "$7,000", action: null, deposits: 1, offer_stack: { available: true, items: [], totals: {} } },
    { staff_id: "s-3", name: "Dana Fox", on_shift: true, shift_elapsed_ms: 600000, calls: 1, close_rate: 0, funded_rate: 0, cash_cents: 0, cash_display: "$0", action: "Nothing assigned", deposits: 0, offer_stack: { available: true, items: [], totals: {} } },
  ],
  beliefs: {
    beliefs: [
      { belief: "trust", label: 'Trust · "how do I know"', this_count: 8, last_count: 3 },
      { belief: "money", label: 'Money · "can\'t afford it"', this_count: 4, last_count: 6 },
      { belief: "pain", label: 'Pain · "this still hurts"', this_count: 2, last_count: 0 },
    ],
    sources: [
      { lead_source: "oct-ads", setter_key: "setter-7", held: 9, deposits: 3, close_rate: 1 / 3, desire: 4 },
      { lead_source: "organic", setter_key: "unknown", held: 5, deposits: 1, close_rate: 0.2, desire: 1 },
    ],
    period: {}, prior: {},
  },
  recordings: { drive_ready: true, items: [], reason: "No Meet recordings in the last 7 days." },
  compliance: { available: false, reason: "Recordings are in Drive. Words fill in after Sync, or in the background for leftover files.", items: [] },
  cold_deals: [],
  discipline: { unlogged_calls: 3, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "Needs scheduled shift times" }, followups_overdue: null, followups_reason: "Follow-up overdue count needs a dedicated follow-up task type.", avg_log_lag_days: null, avg_log_lag_reason: "Average time-to-log needs booking end timestamps." },
};

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

async function openFloor(over = {}, pageOptions = {}) {
  const data = { ...FLOOR, ...over };
  const page = await makePage(lab, {
    ...pageOptions,
    api: (call) => (call.path === "/api/read/sales-floor" ? data : undefined),
  });
  await page.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".rost .rrow.pick").first().waitFor({ state: "attached", timeout: 20_000 }).catch(() => {});
  return page;
}

// The words in an element, each text node separated by a space, whatever the CSS does to the case.
const text = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});
const panel = (page, heading) => page.locator(".panel").filter({ has: page.locator("h3", { hasText: heading }) }).first();

test("header chips: the closers on shift are counted from the read and the name is the signed-in person's", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  assert.equal(await text(page, "header .hl .chip"), "2 closers on shift");
  await until(async () => (await text(page, "header .hr .chip")) === "Casey Proof", { message: "the signed-in name" });
  await page.close();

  const none = await openFloor({ closers: FLOOR.closers.map((c) => ({ ...c, on_shift: false })) });
  assert.equal(await text(none, "header .hl .chip"), "0 closers on shift");
  assert.equal(await none.locator("header .hl .chip").first().getAttribute("class"), "chip on");
  await none.close();

  const unnamed = await openFloor({}, { staff: { name: "" } });
  await until(async () => (await text(unnamed, "header .hr .chip")) === "—", { message: "a dash when the session has no name" });
  await unnamed.close();
});

test("roster: a click or Enter or Space picks that closer in the focus panel and moves to it, without a second read", { timeout: 60_000 }, async () => {
  const page = await openFloor({}, { height: 500 });
  assert.equal(await page.locator(".rost .rrow.pick").count(), 3);
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Chris Stanbridge On shift · 1h 5m");
  const reads = () => callsTo(page, "/api/read/sales-floor").length;
  assert.equal(reads(), 1);
  const focusTop = () => page.evaluate(() => document.getElementById("fh-closer-focus").getBoundingClientRect().top);
  const before = await focusTop();
  assert.ok(before > 500, `the focus panel starts below the first screen (${before}px)`);

  await page.locator(".rost .rrow.pick").nth(1).click();
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Casey Reed Off shift");
  assert.equal(await page.locator(".rost .rrow.pick").nth(1).getAttribute("class"), "rrow pick on");
  assert.equal(await page.locator(".rost .rrow.pick").nth(0).getAttribute("class"), "rrow pick");
  await until(async () => (await focusTop()) < 500, { message: "the page to move to the focus panel" });

  await page.locator(".rost .rrow.pick").nth(2).focus();
  await page.keyboard.press("Enter");
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Dana Fox On shift · 10m");
  await page.locator(".rost .rrow.pick").nth(0).focus();
  await page.keyboard.press("Space");
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Chris Stanbridge On shift · 1h 5m");
  await page.locator(".rost .rrow.pick").nth(1).focus();
  await page.keyboard.press("Tab");                                                   // another key does nothing
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Chris Stanbridge On shift · 1h 5m");
  assert.equal(reads(), 1, "picking a name makes no second request");

  // the focus panel's own arrows wrap around and the name buttons pick too
  await page.locator("#fh-closer-next").click();
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Casey Reed Off shift");
  await page.locator("#fh-closer-prev").click();
  await page.locator("#fh-closer-prev").click();
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Dana Fox On shift · 10m", "previous from the first wraps to the last");
  await page.locator('#fh-closer-focus .pickb[data-fh-closer="1"]').click();
  assert.equal(await text(page, "#fh-closer-focus .focusbody .picks .note"), "Closer 2 of 3");
  await page.close();
});

test("belief panel: this period against last, bars against the biggest, hot only when up and three or more", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  const p = panel(page, "belief failed");
  const rows = p.locator(".ob");
  assert.equal(await rows.count(), 3);
  assert.equal(await text(rows.nth(0), ".obt"), 'Trust · "how do I know" 8 · was 3');
  assert.equal(await text(rows.nth(1), ".obt"), 'Money · "can\'t afford it" 4 · was 6');
  assert.equal(await text(rows.nth(2), ".obt"), 'Pain · "this still hurts" 2 · was 0');
  const widths = await rows.locator(".obb i").evaluateAll((els) => els.map((e) => e.style.width));
  assert.deepEqual(widths, ["100%", "50%", "25%"]);
  const hot = await rows.locator(".obb").evaluateAll((els) => els.map((e) => e.classList.contains("hot")));
  assert.deepEqual(hot, [true, false, false], "trust is up and at least three; money is down; pain is up but under three");
  assert.match(await text(p, ".say"), /^This period vs last period\./);
  await page.close();

  const empty = await openFloor({ beliefs: { beliefs: [], sources: [], period: {}, prior: {} } });
  assert.equal(await panel(empty, "belief failed").locator("p.note", { hasText: "No belief_failed values logged yet" }).count(), 1);
  assert.equal(await panel(empty, "belief failed").locator(".ob").count(), 0);
  await empty.close();
});

test("lead-source panel: held, close and desire per source and setter, at most eight rows, an honest empty line", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  const p = panel(page, "coming from");
  const rows = p.locator(".rrow");
  assert.equal(await rows.count(), 2);
  assert.equal(await text(rows.nth(0), ".nm"), "oct-ads setter setter-7");
  const nums = await rows.nth(0).locator(".num").evaluateAll((els) => els.map((e) => e.textContent));
  assert.deepEqual(nums, ["9", "33%", "4"], "held, close rate, desire");
  assert.equal(await text(rows.nth(1), ".nm"), "organic setter unknown");
  assert.deepEqual(await rows.nth(1).locator(".num").evaluateAll((els) => els.map((e) => e.textContent)), ["5", "20%", "1"]);
  assert.equal(await text(p, ".rhead"), "Source Held Close Desire");
  await page.close();

  const many = Array.from({ length: 11 }, (_, i) => ({ lead_source: `src-${i}`, setter_key: "unknown", held: 11 - i, deposits: 0, close_rate: 0, desire: 0 }));
  const capped = await openFloor({ beliefs: { ...FLOOR.beliefs, sources: many } });
  assert.equal(await panel(capped, "coming from").locator(".rrow").count(), 8, "the panel shows eight at most");
  await capped.close();

  const none = await openFloor({ beliefs: { beliefs: [], sources: [], period: {}, prior: {} } });
  assert.match(await text(panel(none, "coming from"), "p.note"), /^No source cuts yet/);
  assert.equal(await none.locator("#fh-flag-mkt").count(), 0, "with no belief counts there is nothing to flag");
  await none.close();
});

test("recording rows: name, client, words state and a link that only opens on Google Drive or Docs over https", { timeout: 60_000 }, async () => {
  const today = new Date().toISOString();
  const items = [
    { id: "r1", name: "Meet call A", url: "https://drive.google.com/file/d/AAA/view", when: today, is_today: true, client_name: "Dana Whitfield", attached: true, has_words: true, excerpt: "Hello and welcome to the call." },
    { id: "r2", name: "Meet call B", url: "https://docs.google.com/document/d/BBB/edit", when: day(1), is_today: false, client_name: null, attached: false, has_words: false, excerpt: null },
    { id: "r3", name: "Off Drive", url: "https://example.test/recording.mp4", when: day(2), is_today: false, client_name: "Ray Ortiz", attached: true, has_words: false, excerpt: null },
    { id: "r4", name: "Plain http", url: "http://drive.google.com/file/d/CCC/view", when: day(2), is_today: false, client_name: "Ray Ortiz", attached: true, has_words: true, excerpt: null },
    { id: "r5", name: "Look alike", url: "https://drive.google.com.evil.test/x", when: day(2), is_today: false, client_name: null, attached: true, has_words: false, excerpt: null },
    { id: "r6", name: "Script", url: "javascript:alert(1)", when: day(2), is_today: false, client_name: null, attached: false, has_words: false, excerpt: null },
    { id: "r7", name: "No address", url: null, when: day(2), is_today: false, client_name: null, attached: false, has_words: false, excerpt: null },
  ];
  const page = await openFloor({ recordings: { drive_ready: true, items, reason: null } });
  const p = panel(page, "recordings");
  const rows = p.locator(".row");
  assert.equal(await rows.count(), 7);
  const line = async (i) => (await text(rows.nth(i), ".l"));
  assert.match(await line(0), /^Meet call A Dana Whitfield · Today · .* · Words ready Hello and welcome to the call\.$/);
  assert.match(await line(1), /^Meet call B Not matched yet · .* · Waiting for words$/);
  assert.match(await line(2), /^Off Drive Ray Ortiz · .* · Waiting for words$/);
  const links = async (i) => rows.nth(i).locator(".r a").count();
  assert.equal(await links(0), 1);
  assert.equal(await rows.nth(0).locator(".r a").getAttribute("href"), "https://drive.google.com/file/d/AAA/view");
  assert.equal(await rows.nth(0).locator(".r a").innerText(), "Open in Drive");
  assert.equal(await rows.nth(0).locator(".r a").getAttribute("rel"), "noopener");
  assert.equal(await links(1), 1);
  for (const i of [2, 3, 4, 5, 6]) {
    assert.equal(await links(i), 0, `row ${i + 1} must not link`);
    assert.equal(await text(rows.nth(i), ".r"), "No link");
  }
  assert.match(await text(p, "button#fh-drive-refresh"), /^Sync recordings from Drive$/);
  await page.close();

  const none = await openFloor({ recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet. Recordings stay in Meet Recordings until Drive is turned on." } });
  assert.match(await text(panel(none, "recordings"), "p.note"), /^Google Drive is not connected yet\./);
  await none.close();
});

test("compliance panel: shows only the reason sentence from the read, with a plain default", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  const p = panel(page, "Compliance");
  assert.equal(await text(p, "p.note"), "Recordings are in Drive. Words fill in after Sync, or in the background for leftover files.");
  assert.equal(await p.locator(".chip, .row, button").count(), 0, "no flags, no rows, no buttons: only the sentence");
  await page.close();

  const bare = await openFloor({ compliance: { available: false, items: [] } });
  assert.equal(await text(panel(bare, "Compliance"), "p.note"), "Call recording and transcription do not exist yet.");
  await bare.close();
});

test("floor discipline: not logged and not recorded as red chips when above zero, three honest dashes with their reasons", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  const p = panel(page, "Floor discipline");
  const rows = p.locator(".row");
  assert.equal(await rows.count(), 5);
  assert.equal(await text(rows.nth(0), ".l b"), "Calls not logged");
  assert.equal(await text(rows.nth(0), ".r"), "3");
  assert.equal(await rows.nth(0).locator(".chip").getAttribute("class"), "chip bad");
  assert.equal(await text(rows.nth(1), ".l b"), "Calls not recorded");
  assert.equal(await text(rows.nth(1), ".r"), "0");
  assert.equal(await rows.nth(1).locator(".chip").getAttribute("class"), "chip on");
  assert.equal(await text(rows.nth(2), ".l"), "Shifts started late Needs scheduled shift times");
  assert.equal(await text(rows.nth(2), ".r"), "—");
  assert.equal(await text(rows.nth(3), ".l"), "Follow-ups overdue Follow-up overdue count needs a dedicated follow-up task type.");
  assert.equal(await text(rows.nth(3), ".r"), "—");
  assert.equal(await text(rows.nth(4), ".l"), "Avg time to log after a call Average time-to-log needs booking end timestamps.");
  await page.close();

  const clean = await openFloor({ discipline: { ...FLOOR.discipline, unlogged_calls: 0, unrecorded_calls: 2 } });
  const q = panel(clean, "Floor discipline").locator(".row");
  assert.equal(await q.nth(0).locator(".chip").getAttribute("class"), "chip on");
  assert.equal(await text(q.nth(0), ".r"), "0");
  assert.equal(await q.nth(1).locator(".chip").getAttribute("class"), "chip bad");
  assert.equal(await text(q.nth(1), ".r"), "2");
  await clean.close();

  const unknown = await openFloor({ discipline: { unlogged_calls: null, unrecorded_calls: 0 } });
  assert.equal(await text(panel(unknown, "Floor discipline").locator(".row").nth(0), ".r"), "—", "an unknown count is a dash, never a zero");
  await unknown.close();
});
