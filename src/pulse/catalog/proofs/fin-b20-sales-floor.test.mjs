// Finish-853 batch 20: the sales-floor page. The real public/app/sales-floor.js runs in a real Chromium,
// answered by fake data: the header chips, the roster, the belief and lead-source panels, the recording
// rows, the compliance panel and the floor discipline panel. Fake people, fake numbers, no network,
// nothing is saved anywhere real. The read modules behind the panels are in
// fin-b20-sales-floor-reads.test.mjs.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until } from "./fin-b20-browser-kit.mjs";

const NOW = new Date("2026-10-14T17:00:00.000Z");
const day = (n, minutes = 0) => new Date(NOW.getTime() - n * 86_400_000 - minutes * 60_000).toISOString();

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

test("floor shift chip is counted from the read and the shared account names the signed-in person", { timeout: 60_000 }, async () => {
  const page = await openFloor();
  assert.equal(await text(page, "header .hl .chip"), "2 closers on shift");
  await page.locator("#fh-shell-chip-show").click();
  assert.equal(await text(page, ".fh-account-person strong"), "Casey Proof", "the shared account retains the signed-in identity");
  assert.equal(await page.locator("header .hr .chip").count(), 0, "there is no duplicate page account");
  await page.close();

  const none = await openFloor({ closers: FLOOR.closers.map((c) => ({ ...c, on_shift: false })) });
  assert.equal(await text(none, "header .hl .chip"), "0 closers on shift");
  assert.equal(await none.locator("header .hl .chip").first().getAttribute("class"), "chip on");
  await none.close();

  const unnamed = await openFloor({}, { staff: { name: "" } });
  await unnamed.locator("#fh-shell-chip-show").click();
  assert.equal(await text(unnamed, ".fh-account-person strong"), "Your account", "an unnamed session gets the shared account fallback");
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
  assert.equal(await panel(empty, "belief failed").locator("p.note", { hasText: "No objections logged this month" }).count(), 1);
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
  assert.match(await text(panel(none, "coming from"), "p.note"), /^No source activity yet/);
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
