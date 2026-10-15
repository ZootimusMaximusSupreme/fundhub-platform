// Finish-853 batch 02: opening the sales floor, practice test.
//
// Row (desks-f.json, sales-floor.html): "Page open: the whole floor (hero, funnel, roster, offer
// stack, beliefs, sources, recordings, cold deals, discipline). The read also attaches loose Drive
// recordings to calls and clients (a write on a GET)".
//
// Two halves, both with fake data:
//   A. the page, in Chromium, is handed ONE fake read and every panel is checked against it. The
//      panels S1's spec already holds (funnel, roster, offer stack, cold deals) are held here too,
//      so one test says "the whole floor"; beliefs, sources and recordings are new.
//   B. the write on the GET. src/sales/recordings.mjs listRecentRecordings is run against a stand-in
//      database that carries the REAL column names (fin-b02-sql-kit.mjs): a loose Drive file whose
//      name holds exactly one recent client's first and last name is attached to that client and
//      its link is stamped on that client's latest call; anything else is left alone.
//
// NOT here, on purpose: the hero's target bar. public/app/sales-floor.js sets it to 0% every time
// and the server has no daily target; that is the separate row "Hero: 'Today' deposits ... target
// bar", left not attachable.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { makeStandIn } from "./fin-b02-sql-kit.mjs";
import { listRecentRecordings } from "../../../sales/recordings.mjs";

/* ── A. the page ─────────────────────────────────────────────────────────── */

const DRIVE_OK = "https://drive.google.com/file/d/abc123/view";
const DOCS_OK = "https://docs.google.com/document/d/xyz789/edit";

function sources(n) {
  const rows = [
    { lead_source: "meta-ads", setter_key: "setter-a", held: 6, close_rate: 0.5, desire: 7 },
    { lead_source: null, setter_key: null, held: 2, close_rate: null, desire: 0 },
  ];
  for (let i = 0; rows.length < n; i += 1) rows.push({ lead_source: `source-${i}`, setter_key: `s${i}`, held: 1, close_rate: 0.1, desire: 1 });
  return rows;
}

const FLOOR = {
  ok: true,
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" },
  hero: {
    cash_cents: 2500000, cash_display: "$25,000", target_cents: null,
    target_reason: "No monthly deposit target has been set for the sales team yet.",
    deposit_to_funded: 2 / 3, deposit_to_funded_n: { deposits: 3, funded: 2, rate: 2 / 3 },
  },
  funnel: {
    booked: 12, held: 8, show_rate: 8 / 12, deposits: 3, close_rate: 3 / 8,
    funded: 2, funded_of_deposits: 2 / 3, downsells: 1, downsell_cash_cents: 40000, downsell_cash_display: "$400",
  },
  today: { date: "2026-10-13", booked: 4, held: 3, deposits: 1, target_cents: null, target_reason: "No daily deposit target has been set for the sales team yet." },
  offer_stack: {
    available: true,
    items: [
      { code: "REPAIR_DFY", name: "Repair, done-for-you", units: 2, sold_cents: 200000, collected_cents: 150000 },
      { code: "FUNDING_DFY", name: "Funding, done-for-you", units: 1, sold_cents: 300000, collected_cents: 300000 },
    ],
    totals: { units: 3, sold_cents: 500000, collected_cents: 450000 },
  },
  offer_stack_unattributed: { available: true, reason: "", items: [], totals: { units: 0, sold_cents: 0, collected_cents: 0 } },
  closers: [
    { staff_id: "s-chris", name: "Chris Stanbridge", on_shift: true, shift_elapsed_ms: 3900000, calls: 6, close_rate: 0.5, funded_rate: 0.4, cash_cents: 1800000, cash_display: "$18,000", action: "Call the two deposits that have not funded.", deposits: 2, offer_stack: { available: true, items: [], totals: { units: 0, sold_cents: 0, collected_cents: 0 } } },
    { staff_id: "s-casey", name: "Casey Reed", on_shift: false, calls: 2, close_rate: 0.25, funded_rate: null, cash_cents: 700000, cash_display: "$7,000", action: null, deposits: 1, offer_stack: { available: true, items: [], totals: { units: 0, sold_cents: 0, collected_cents: 0 } } },
  ],
  beliefs: {
    beliefs: [
      { belief: "price", label: "Price is too high", this_count: 5, last_count: 2 },
      { belief: "spouse", label: "Needs to ask a spouse", this_count: 2, last_count: 4 },
      { belief: "trust", label: "Does not trust it", this_count: 3, last_count: 3 },
      { belief: "timing", label: "Wants to wait", this_count: 2, last_count: 1 },
    ],
    sources: sources(9),
    period: {}, prior: {},
  },
  compliance: { available: false, reason: "Call recording flags are not scored yet.", items: [] },
  cold_deals: [
    { name: "Dana Whitfield", detail: "Deposit taken Oct 2, not funded", quiet_days: 11 },
    { name: "Ray Ortiz", detail: "Deposit taken Oct 4, not funded", quiet_days: 9 },
  ],
  recordings: {
    drive_ready: true,
    items: [
      { id: "f1", name: "Dana Whitfield - Meet Recording", url: DRIVE_OK, when: "2026-10-14T17:30:00Z", is_today: true, client_id: "c1", client_name: "Dana Whitfield", attached: true, has_words: true, excerpt: "I want the three card plan" },
      { id: "f2", name: "Untitled recording", url: DOCS_OK, when: "2026-10-12T16:00:00Z", is_today: false, client_id: null, client_name: null, attached: false, has_words: false, excerpt: null },
      { id: "f3", name: "Odd link recording", url: "http://not-drive.example/file", when: null, is_today: false, client_id: null, client_name: null, attached: false, has_words: false, excerpt: null },
      { id: "f4", name: "Plain http recording", url: "http://drive.google.com/file/d/plain/view", when: null, is_today: false, client_id: null, client_name: null, attached: false, has_words: false, excerpt: null },
    ],
    reason: null,
  },
  discipline: { unlogged_calls: 1, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "Needs scheduled shift times" }, followups_overdue: null, followups_reason: "n/a", avg_log_lag_days: null, avg_log_lag_reason: "n/a" },
};

async function until(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await done()) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

test("Page open: one read fills hero, funnel, roster, offer stack, beliefs, sources, recordings, cold deals and discipline", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  let reads = 0;
  const { page, errors } = await open("/app/sales-floor.html", {
    handlers: { "/api/read/sales-floor": (route) => { reads += 1; return json(route, FLOOR); } },
    viewport: { width: 1400, height: 1600 },
  });
  await until(async () => (await page.locator(".funnel .f .vl").first().innerText()) === "12");

  // hero numbers (the target bar is a different row)
  assert.equal(await page.locator(".hero .big").nth(0).innerText(), "1");
  assert.match(await page.locator(".hero .sub").nth(0).innerText(), /Booked 4 · Held 3/);
  assert.equal(await page.locator(".hero .big").nth(1).innerText(), "67%");
  assert.equal(await page.locator(".hero .sub").nth(1).innerText(), "2 of 3 deposits funded");

  // funnel
  const funnel = await page.locator(".funnel .f").evaluateAll((els) => els.map((el) => [el.querySelector(".lb").textContent, el.querySelector(".vl").textContent]));
  assert.deepEqual(funnel.slice(0, 5), [["Booked", "12"], ["Held", "8"], ["Deposits", "3"], ["Funded", "2"], ["Downsells", "1"]]);

  // roster
  assert.equal(await page.locator(".rost .rrow.pick").count(), 2);
  const roster = await page.locator(".rost .rrow.pick").first().innerText();
  assert.match(roster, /Chris Stanbridge/);
  assert.match(roster, /\$18,000/);

  // offer stack
  assert.ok(await page.locator("#fh-offer-stack .ostack").first().isVisible());

  // beliefs: this period vs last, the hot flag only where it grew and reached 3, bars against the biggest
  const belief = page.locator(".panel", { has: page.getByRole("heading", { name: "Which belief failed" }) });
  const obs = await belief.locator(".ob").evaluateAll((els) => els.map((el) => ({
    text: el.querySelector(".obt").textContent.replace(/\s+/g, " ").trim(),
    hot: el.querySelector(".obb").classList.contains("hot"),
    width: el.querySelector(".obb i").style.width,
  })));
  assert.deepEqual(obs, [
    { text: "Price is too high5 · was 2", hot: true, width: "100%" },
    { text: "Needs to ask a spouse2 · was 4", hot: false, width: "40%" },
    { text: "Does not trust it3 · was 3", hot: false, width: "60%" },
    { text: "Wants to wait2 · was 1", hot: false, width: "40%" },
  ]);

  // sources: the first 8 only, an unknown source and setter are said as unknown and a dash
  const src = page.locator(".panel", { has: page.getByRole("heading", { name: "Where it is coming from" }) });
  assert.equal(await src.locator(".rrow").count(), 8, "nine sources come in, eight are drawn");
  const first = await src.locator(".rrow").nth(0).innerText();
  assert.match(first, /meta-ads/);
  assert.match(first, /setter setter-a/);
  const cells = await src.locator(".rrow").nth(0).locator(".num").allInnerTexts();
  assert.deepEqual(cells, ["6", "50%", "7"]);
  const second = await src.locator(".rrow").nth(1).innerText();
  assert.match(second, /unknown/);
  assert.match(second, /setter —/);
  assert.equal(await src.locator("#fh-flag-mkt").innerText(), "Flag Price is too high");

  // recordings: who it is matched to, when, whether words are ready, and only Drive links are links
  const rec = page.locator(".panel", { has: page.getByRole("heading", { name: "Today's recordings" }) });
  const rows = await rec.locator(".row").evaluateAll((els) => els.map((el) => ({
    text: el.querySelector(".l").textContent.replace(/\s+/g, " ").trim(),
    href: el.querySelector("a") ? el.querySelector("a").getAttribute("href") : null,
    link: el.querySelector(".r").textContent.trim(),
  })));
  assert.equal(rows.length, 4);
  assert.match(rows[0].text, /Dana Whitfield - Meet Recording/);
  assert.match(rows[0].text, /Dana Whitfield · Today · 10:30\sAM · Words ready/);
  assert.match(rows[0].text, /I want the three card plan/);
  assert.deepEqual([rows[0].href, rows[0].link], [DRIVE_OK, "Open in Drive"]);
  assert.match(rows[1].text, /Not matched yet · .*Waiting for words/);
  assert.deepEqual([rows[1].href, rows[1].link], [DOCS_OK, "Open in Drive"]);
  assert.match(rows[2].text, /Not matched yet · This week · Waiting for words/);
  assert.deepEqual([rows[2].href, rows[2].link], [null, "No link"], "a link that is not Drive is never drawn as a link");
  assert.deepEqual([rows[3].href, rows[3].link], [null, "No link"], "a Drive link that is not https is never drawn as a link");
  assert.ok(await page.locator("#fh-drive-refresh").isVisible());

  // cold deals
  const cold = page.locator(".panel", { has: page.getByRole("heading", { name: "Deals going cold" }) });
  assert.equal(await cold.locator(".row").count(), 2);
  assert.match(await cold.locator(".row").nth(0).innerText(), /Dana Whitfield[\s\S]*11d/);

  // discipline
  const discipline = page.locator(".panel", { has: page.getByRole("heading", { name: "Floor discipline" }) });
  assert.match(await discipline.innerText(), /Calls not logged/);
  assert.equal(await discipline.locator(".chip.bad").innerText(), "1");

  assert.equal(reads, 1, "the whole floor is filled from ONE read");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Page open: an empty month says so in words on every panel and never invents a row", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  const empty = {
    ...FLOOR,
    beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
    recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet." },
    cold_deals: [],
  };
  const { page, errors } = await open("/app/sales-floor.html", {
    handlers: { "/api/read/sales-floor": (route) => json(route, empty) },
    viewport: { width: 1400, height: 1600 },
  });
  await until(async () => (await page.locator(".funnel .f .vl").first().innerText()) === "12");
  const text = (h) => page.locator(".panel", { has: page.getByRole("heading", { name: h }) }).innerText();
  assert.match(await text("Which belief failed"), /No belief_failed values logged yet/);
  assert.match(await text("Where it is coming from"), /No source cuts yet/);
  assert.match(await text("Today's recordings"), /Google Drive is not connected yet\./);
  assert.match(await text("Deals going cold"), /No cold deposits \(7\+ days quiet, not funded\)\./);
  assert.equal(await page.locator("#fh-flag-mkt").count(), 0, "no flag button with no belief to flag");
  assert.deepEqual(errors, []);
  await page.close();
});

/* ── B. the write on the GET ─────────────────────────────────────────────── */

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-14T18:00:00.000Z");
const iso = (daysAgo) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
const L = (n) => `https://drive.google.com/file/d/file-${n}/view`;

function seed(s) {
  // Company A: two recent-call clients with distinct names, and a pair that share one name.
  s.insert("clients", { id: "dana", org_id: ORG, first_name: "Dana", last_name: "Whitfield" });
  s.insert("clients", { id: "lee", org_id: ORG, first_name: "Lee", last_name: "Carter" });
  s.insert("clients", { id: "jordan-1", org_id: ORG, first_name: "Jordan", last_name: "Blake" });
  s.insert("clients", { id: "jordan-2", org_id: ORG, first_name: "Jordan", last_name: "Blake" });
  s.insert("call_outcomes", { id: "call-dana-old", org_id: ORG, client_id: "dana", logged_at: iso(5), recording_url: null });
  s.insert("call_outcomes", { id: "call-dana", org_id: ORG, client_id: "dana", logged_at: iso(2), recording_url: null });
  s.insert("call_outcomes", { id: "call-lee", org_id: ORG, client_id: "lee", logged_at: iso(1), recording_url: L("already") });
  s.insert("call_outcomes", { id: "call-lee-old", org_id: ORG, client_id: "lee", logged_at: iso(3), recording_url: null });
  s.insert("call_outcomes", { id: "call-j1", org_id: ORG, client_id: "jordan-1", logged_at: iso(1), recording_url: null });
  s.insert("call_outcomes", { id: "call-j2", org_id: ORG, client_id: "jordan-2", logged_at: iso(1), recording_url: null });
  const file = (id, name, extra = {}) => s.insert("brain_files", {
    id, org_id: ORG, name, web_view_link: L(id), client_id: null, unattached: true,
    mime_type: "video/mp4", needs_transcription: true, created_at: iso(1), indexed_at: iso(1), ...extra,
  });
  file("f-dana", "Dana Whitfield - Meet Recording.mp4");
  file("f-jordan", "Jordan Blake - Meet Recording.mp4");
  file("f-nobody", "team standup recording.mp4");
  file("f-lee", "Lee Carter - Meet Recording.mp4", { client_id: "dana", unattached: false });
  file("f-lee-new", "Lee Carter - Second Meet Recording.mp4");
  // Company B has a client and a file with the same name as Dana: company A's read never touches them.
  s.insert("clients", { id: "dana-b", org_id: OTHER, first_name: "Dana", last_name: "Whitfield" });
  s.insert("call_outcomes", { id: "call-dana-b", org_id: OTHER, client_id: "dana-b", logged_at: iso(1), recording_url: null });
  // The same file id in company B (ids are unique in the real table; this holds the update to its company).
  s.insert("brain_files", {
    id: "f-dana", org_id: OTHER, name: "Quarterly review recording.mp4", web_view_link: L("f-dana-b"), client_id: null,
    unattached: true, mime_type: "video/mp4", needs_transcription: true, created_at: iso(1), indexed_at: iso(1),
  });
  // A call in company A that points at company B's Dana. It must not make A's "Dana Whitfield" ambiguous.
  s.insert("call_outcomes", { id: "call-cross", org_id: ORG, client_id: "dana-b", logged_at: iso(1), recording_url: "https://drive.google.com/file/d/cross/view" });
  s.insert("brain_files", {
    id: "f-b", org_id: OTHER, name: "Dana Whitfield - Meet Recording.mp4", web_view_link: L("f-b"), client_id: null,
    unattached: true, mime_type: "video/mp4", needs_transcription: true, created_at: iso(1), indexed_at: iso(1),
  });
}

function standIn() {
  const s = makeStandIn(["clients", "call_outcomes", "customer_insights", "events", "brain_files", "brain_drive_sync"]);
  seed(s);
  return s;
}
const byId = (rows, id) => rows.find((r) => r.id === id);

test("the read attaches a loose recording to the one client its name matches, and stamps the link on that client's latest call", async () => {
  const s = standIn();
  try {
    const out = await listRecentRecordings(s.asPg(), { orgId: ORG, now: NOW, env: {} });
    const files = s.all("brain_files");
    const calls = s.all("call_outcomes");

    const mine = files.filter((f) => f.id === "f-dana" && f.org_id === ORG);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].client_id, "dana");
    assert.equal(Number(mine[0].unattached), 0);
    // company B's file with the same id is not touched by company A's read
    assert.equal(files.find((f) => f.id === "f-dana" && f.org_id === OTHER).client_id, null);
    // the newest call without a recording gets the link; the older one does not
    assert.equal(byId(calls, "call-dana").recording_url, L("f-dana"));
    assert.equal(byId(calls, "call-dana-old").recording_url, null);

    // a client's latest call that already has a recording keeps it; the older call without one gets the link
    const lee = s.all("brain_files").find((f) => f.id === "f-lee-new");
    assert.equal(lee.client_id, "lee");
    assert.equal(byId(calls, "call-lee").recording_url, L("already"));
    assert.equal(byId(calls, "call-lee-old").recording_url, L("f-lee-new"));

    const item = out.items.find((it) => it.id === "f-dana");
    assert.equal(item.attached, true);
    assert.equal(item.client_name, "Dana Whitfield");
    assert.equal(item.url, L("f-dana"));
  } finally { s.close(); }
});

test("the read leaves alone a name two clients share, a file nobody is named in, and a file already attached", async () => {
  const s = standIn();
  try {
    const out = await listRecentRecordings(s.asPg(), { orgId: ORG, now: NOW, env: {} });
    const files = s.all("brain_files");
    const calls = s.all("call_outcomes");
    for (const id of ["f-jordan", "f-nobody"]) {
      assert.equal(byId(files, id).client_id, null, id);
      assert.equal(Number(byId(files, id).unattached), 1, id);
      assert.equal(out.items.find((it) => it.id === id).attached, false, id);
    }
    assert.equal(byId(calls, "call-j1").recording_url, null);
    assert.equal(byId(calls, "call-j2").recording_url, null);
    // already attached to Dana: neither moved to Lee by name nor re-stamped
    assert.equal(byId(files, "f-lee").client_id, "dana");
    assert.equal(byId(calls, "call-lee").recording_url, L("already"), "a call that already has a recording keeps it");
  } finally { s.close(); }
});

test("the read never touches another company's files, clients or calls", async () => {
  const s = standIn();
  try {
    await listRecentRecordings(s.asPg(), { orgId: ORG, now: NOW, env: {} });
    assert.equal(byId(s.all("brain_files"), "f-b").client_id, null);
    assert.equal(Number(byId(s.all("brain_files"), "f-b").unattached), 1);
    assert.equal(byId(s.all("call_outcomes"), "call-dana-b").recording_url, null);
  } finally { s.close(); }
  // And the other company's own read attaches only its own, leaving company A's loose file loose.
  const b = standIn();
  try {
    await listRecentRecordings(b.asPg(), { orgId: OTHER, now: NOW, env: {} });
    assert.equal(byId(b.all("brain_files"), "f-b").client_id, "dana-b");
    assert.equal(byId(b.all("call_outcomes"), "call-dana-b").recording_url, L("f-b"));
    assert.equal(byId(b.all("brain_files"), "f-dana").client_id, null, "company A's file is not reached by company B");
    assert.equal(byId(b.all("call_outcomes"), "call-dana").recording_url, null);
  } finally { b.close(); }
});

test("a second read changes nothing more", async () => {
  const s = standIn();
  try {
    await listRecentRecordings(s.asPg(), { orgId: ORG, now: NOW, env: {} });
    const first = JSON.stringify([s.all("brain_files"), s.all("call_outcomes")]);
    await listRecentRecordings(s.asPg(), { orgId: ORG, now: NOW, env: {} });
    assert.equal(JSON.stringify([s.all("brain_files"), s.all("call_outcomes")]), first);
  } finally { s.close(); }
});
