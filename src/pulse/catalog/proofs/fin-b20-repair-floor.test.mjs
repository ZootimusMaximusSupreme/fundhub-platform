// Finish-853 batch 20, repair cycle 1: the sales-floor page, held where the first cycle left a gap.
// The real public/app/sales-floor.js runs in a real Chromium, answered by fake data. Three things:
//
//   1. The discipline panel is fed what the REAL read sends (salesFloor() over a canned database), not a
//      shape a test invented, so the words the page prints for the shifts, follow-up and log-lag lines are
//      the words a person sees on the live screen.
//   2. The recording rows: only Drive and Docs open, they open in a new tab, the excerpt is shown as
//      words, the time is Arizona time.
//   3. The roster: a click, Enter and Space each move the page to the focus panel, and the panel's own
//      arrows do not. Judged by position AND by the call, never by the page scrolling for another reason.
//
// Fake people, fake numbers, no network, nothing is saved anywhere real.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until } from "./fin-b20-browser-kit.mjs";
import { salesFloor } from "../../../sales/metrics.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-14T17:00:00.000Z");

// A canned database. Every statement answers empty except the three the discipline panel is built from.
function floorDb({ tasks = [], unrecorded = [] } = {}) {
  return {
    async query(sql) {
      const s = String(sql);
      // The KPI now counts every overdue task with a separate aggregate read;
      // the table still receives its capped task rows. Both derive from the
      // same synthetic fixture without touching a database.
      if (/SELECT\s+count\(\*\)::int\s+AS\s+n/i.test(s) && /FROM tasks t/.test(s)) {
        return { rows: [{ n: tasks.length }] };
      }
      if (/FROM tasks t/.test(s) && /assignee_role = 'closer'/.test(s)) return { rows: tasks };
      // Count queries return one aggregate row; the detail query returns the
      // capped list. Keep both sourced from the same fake call outcomes.
      if (/SELECT\s+count\(\*\)::int\s+AS\s+total/i.test(s) && /FROM call_outcomes o/.test(s)) {
        return { rows: [{ total: unrecorded.length }] };
      }
      if (/\(o\.recording_url IS NULL OR btrim\(o\.recording_url\) = ''\)/.test(s)) return { rows: unrecorded };
      return { rows: [] };
    },
  };
}

// What the browser receives: the read's own object after a trip through JSON.
async function realFloor(canned) {
  const data = await salesFloor(floorDb(canned), { orgId: ORG, now: NOW, env: {} });
  return JSON.parse(JSON.stringify({ ok: true, ...data }));
}

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

async function openFloor(data, pageOptions = {}) {
  const page = await makePage(lab, {
    ...pageOptions,
    api: (call) => (call.path === "/api/read/sales-floor" ? data : undefined),
  });
  if (pageOptions.spy) await page.addInitScript(pageOptions.spy);
  await page.goto(`${lab.origin}/app/sales-floor.html`, { waitUntil: "domcontentloaded" });
  await page.locator(".panel h3", { hasText: "Floor discipline" }).waitFor({ state: "attached", timeout: 20_000 });
  await until(async () => (await page.locator(".panel").filter({ has: page.locator("h3", { hasText: "Floor discipline" }) }).locator(".row").count()) > 0,
    { message: "the discipline rows" });
  return page;
}

const text = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});
const panel = (page, heading) => page.locator(".panel").filter({ has: page.locator("h3", { hasText: heading }) }).first();

// ---------------------------------------------------------------------------------------------
// 1. Floor discipline, from the real read
test("floor discipline: what the real read sends is what the page prints, dashes with their reasons included", { timeout: 90_000 }, async () => {
  const unlogged = [1, 2].map((n) => ({ task_id: `t-${n}`, client_id: `c-${n}`, title: "Strategy session booked", booking_ref: `BK-${n}`, due_at: "2026-10-14T15:00:00.000Z", client_name: "Dana Whitfield" }));
  const unrecorded = [{ id: "o-1", client_id: "c-1", staff_id: "s-1", outcome: "deposit", recording_url: null, logged_at: "2026-10-14T14:00:00.000Z", client_name: "Dana Whitfield" }];
  const data = await realFloor({ tasks: unlogged, unrecorded });
  // The real read's own shape for the three lines that print a dash: no number, an empty detail list.
  assert.equal(data.discipline.unlogged_calls, 2);
  assert.equal(data.discipline.unrecorded_calls, 1);
  assert.equal(data.unrecorded.count, data.discipline.unrecorded_calls, "detail and discipline use one uncapped total");
  assert.equal(data.discipline.shifts_started_late, null);
  assert.deepEqual(data.discipline.shifts_detail, []);
  assert.equal(data.discipline.followups_overdue, null);
  assert.match(data.discipline.followups_reason, /follow-up/i);
  assert.match(data.discipline.avg_log_lag_reason, /time-to-log/i);

  const page = await openFloor(data);
  const rows = panel(page, "Floor discipline").locator(".row");
  assert.equal(await rows.count(), 5);
  assert.equal(await text(rows.nth(0), ".l"), "Calls not logged Past-due closer tasks without a disposition");
  assert.equal(await text(rows.nth(0), ".r"), "2");
  assert.equal(await rows.nth(0).locator(".chip").getAttribute("class"), "chip bad");
  assert.equal(await text(rows.nth(1), ".l"), "Calls not recorded Logged sales calls with no recording and no transcript");
  assert.equal(await text(rows.nth(1), ".r"), "1");
  assert.equal(await rows.nth(1).locator(".chip").getAttribute("class"), "chip bad");
  assert.equal(await text(rows.nth(2), ".l"), "Shifts started late Scheduled shift times are not available.", "the page's own sentence, since the read sends no number and no reason here");
  assert.equal(await text(rows.nth(2), ".r"), "—");
  assert.equal(await text(rows.nth(3), ".l"), `Follow-ups overdue ${data.discipline.followups_reason}`);
  assert.equal(await text(rows.nth(3), ".r"), "—");
  assert.equal(await text(rows.nth(4), ".l"), `Avg time to log after a call ${data.discipline.avg_log_lag_reason}`);
  assert.equal(await text(rows.nth(4), ".r"), "—");
  await page.close();

  const clean = await openFloor(await realFloor());
  const q = panel(clean, "Floor discipline").locator(".row");
  assert.equal(await text(q.nth(0), ".r"), "0");
  assert.equal(await q.nth(0).locator(".chip").getAttribute("class"), "chip on");
  assert.equal(await text(q.nth(1), ".r"), "0");
  assert.equal(await q.nth(1).locator(".chip").getAttribute("class"), "chip on");
  await clean.close();
});

// ---------------------------------------------------------------------------------------------
// 2. Recording rows
test("recording rows: only Drive and Docs open, in a new tab; another Google host, a lookalike and a script do not", { timeout: 90_000 }, async () => {
  const mk = (n, name, url, extra = {}) => ({ id: `r${n}`, name, url, when: "2026-10-13T17:30:00.000Z", is_today: false, client_name: "Ray Ortiz", attached: true, has_words: true, excerpt: null, ...extra });
  const items = [
    mk(1, "Drive file", "https://drive.google.com/file/d/AAA/view"),
    mk(2, "Docs file", "https://docs.google.com/document/d/BBB/edit"),
    mk(3, "Sites page", "https://sites.google.com/view/a-user-page"),
    mk(4, "Script app", "https://script.google.com/macros/s/xyz/exec"),
    mk(5, "Mail", "https://mail.google.com/mail/u/0/#inbox"),
    mk(6, "Lookalike subdomain", "https://evil.google.com/file/d/x/view"),
    mk(7, "Bare google", "https://google.com/file/d/x/view"),
    mk(8, "Plain http", "http://drive.google.com/file/d/CCC/view"),
    mk(9, "Script scheme", "javascript:alert(1)"),
  ];
  const data = await realFloor();
  const page = await openFloor({ ...data, recordings: { drive_ready: true, items, reason: null } });
  const rows = panel(page, "recordings").locator(".row");
  assert.equal(await rows.count(), items.length);
  const open = [];
  for (let i = 0; i < items.length; i += 1) {
    const links = rows.nth(i).locator(".r a");
    if ((await links.count()) === 1) {
      open.push(items[i].name);
      assert.equal(await links.getAttribute("target"), "_blank", `${items[i].name} opens in a new tab`);
      assert.equal(await links.getAttribute("rel"), "noopener");
      assert.equal(await links.innerText(), "Open in Drive");
    } else {
      assert.equal(await text(rows.nth(i), ".r"), "No link", `${items[i].name} has no link`);
    }
  }
  assert.deepEqual(open, ["Drive file", "Docs file"], "exactly drive.google.com and docs.google.com over https open");
  await page.close();
});

test("recording rows: the excerpt is shown as words, never as markup, and the time is Arizona time", { timeout: 90_000 }, async () => {
  const hostile = '<img src=x onerror="window.__proof_ran = 1"><b>loud</b> & "quoted"';
  const items = [
    { id: "r1", name: "Today file", url: "https://drive.google.com/file/d/A/view", when: "2026-10-14T17:30:00.000Z", is_today: true, client_name: "Dana Whitfield", attached: true, has_words: true, excerpt: hostile },
    { id: "r2", name: "Earlier file", url: "https://drive.google.com/file/d/B/view", when: "2026-10-12T04:05:00.000Z", is_today: false, client_name: "Dana Whitfield", attached: true, has_words: false, excerpt: null },
    { id: "r3", name: "Undated today", url: null, when: null, is_today: true, client_name: null, attached: false, has_words: false, excerpt: null },
    { id: "r4", name: "Undated", url: null, when: null, is_today: false, client_name: null, attached: false, has_words: false, excerpt: null },
    { id: "r5", name: "Garbled date", url: null, when: "not a date", is_today: false, client_name: null, attached: false, has_words: false, excerpt: null },
    { id: "r6", name: "Attached no name", url: null, when: null, is_today: false, client_name: null, attached: true, has_words: true, excerpt: null },
  ];
  const data = await realFloor();
  const page = await openFloor({ ...data, recordings: { drive_ready: true, items, reason: null } });
  const rows = panel(page, "recordings").locator(".row");
  const line = (i) => text(rows.nth(i), ".l");
  // 17:30 UTC is 10:30 in Arizona (no daylight saving); 04:05 UTC on the 12th is 9:05 PM the 11th
  assert.match(await line(0), /^Today file Dana Whitfield · Today · 10:30\s?AM · Words ready /);
  assert.match(await line(1), /^Earlier file Dana Whitfield · 9:05\s?PM · Waiting for words$/);
  assert.match(await line(2), /^Undated today Not matched yet · Today · Waiting for words$/);
  assert.match(await line(3), /^Undated Not matched yet · This week · Waiting for words$/);
  assert.match(await line(4), /^Garbled date Not matched yet · This week · Waiting for words$/);
  assert.match(await line(5), /^Attached no name Client · This week · Words ready$/, "a file tied to a client with no name on file says Client, not Not matched yet");
  assert.equal(await rows.nth(0).locator(".l img, .l b > b").count(), 0, "no element came out of the excerpt");
  assert.equal(await rows.nth(0).locator(".l > em").nth(1).innerText(), hostile, "the excerpt reads as the words it was sent");
  assert.equal(await page.evaluate(() => window.__proof_ran === undefined), true, "nothing in the excerpt ran");
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// 3. The roster
const SCROLL_SPY = () => {
  window.__scrolls = [];
  window.__keys = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function scrollIntoView(arg) {
    window.__scrolls.push({ id: this.id, arg: JSON.stringify(arg) });
    return original.apply(this, arguments);
  };
  document.addEventListener("keydown", (e) => window.__keys.push([e.key, e.defaultPrevented]));
};

const CLOSERS = [
  { staff_id: "s-1", name: "Chris Stanbridge", on_shift: true, shift_elapsed_ms: 3900000, calls: 6, close_rate: 0.5, funded_rate: 0.4, cash_cents: 1800000, cash_display: "$18,000", action: "Call the two deposits that have not funded.", deposits: 2, offer_stack: { available: true, items: [], totals: {} } },
  { staff_id: "s-2", name: "Casey Reed", on_shift: false, calls: 2, close_rate: 0.25, funded_rate: null, cash_cents: 700000, cash_display: "$7,000", action: null, deposits: 1, offer_stack: { available: true, items: [], totals: {} } },
  { staff_id: "s-3", name: "Dana Fox", on_shift: true, shift_elapsed_ms: 600000, calls: 1, close_rate: 0, funded_rate: 0, cash_cents: 0, cash_display: "$0", action: "Nothing assigned", deposits: 0, offer_stack: { available: true, items: [], totals: {} } },
];

test("roster: a click, Enter and Space each move the page to the focus panel by the page's own call; the panel's own controls never do", { timeout: 120_000 }, async () => {
  const data = { ...(await realFloor()), closers: CLOSERS };
  const page = await openFloor(data, { height: 500, spy: SCROLL_SPY });
  await page.locator(".rost .rrow.pick").first().waitFor({ state: "attached" });
  const focusTop = () => page.evaluate(() => document.getElementById("fh-closer-focus").getBoundingClientRect().top);
  const scrolls = () => page.evaluate(() => window.__scrolls.filter((s) => s.id === "fh-closer-focus"));
  // A smooth scroll runs for a moment. Wait until the page has stopped before moving it back, so one
  // step's animation can never be mistaken for the next step's.
  const settled = async () => {
    let last = -1;
    let still = 0;
    await until(async () => {
      const y = await page.evaluate(() => window.scrollY);
      still = y === last ? still + 1 : 0;
      last = y;
      return still >= 3;
    }, { every: 100, message: "the page to stop moving" });
  };
  const toTop = async () => {
    await settled();
    await page.evaluate(() => window.scrollTo(0, 0));
    await until(async () => (await focusTop()) > 500, { message: "the page back at the top" });
  };
  assert.ok((await focusTop()) > 500, "the focus panel starts below the first screen");

  // a click, without the browser's own scroll-into-view helping (the click is the page's own event)
  await page.evaluate(() => document.querySelectorAll(".rost .rrow.pick")[1].click());
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Casey Reed Off shift");
  assert.deepEqual(await scrolls(), [{ id: "fh-closer-focus", arg: JSON.stringify({ behavior: "smooth", block: "start" }) }]);
  await until(async () => (await focusTop()) < 120, { message: "the page to arrive at the focus panel" });

  // Enter, with the row focused without moving the page
  await toTop();
  await page.evaluate(() => document.querySelectorAll(".rost .rrow.pick")[2].focus({ preventScroll: true }));
  assert.ok((await focusTop()) > 500, "focusing the row did not move the page");
  await page.keyboard.press("Enter");
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Dana Fox On shift · 10m");
  assert.equal((await scrolls()).length, 2, "Enter made the move");
  await until(async () => (await focusTop()) < 120, { message: "the page to arrive after Enter" });

  // Space, same
  await toTop();
  await page.evaluate(() => document.querySelectorAll(".rost .rrow.pick")[0].focus({ preventScroll: true }));
  await page.keyboard.press("Space");
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Chris Stanbridge On shift · 1h 5m");
  assert.equal((await scrolls()).length, 3, "Space made the move");
  await until(async () => (await focusTop()) < 120, { message: "the page to arrive after Space" });

  // The keys the row handles are taken from the page (no page scroll of its own on Space); another key is not
  const keys = await page.evaluate(() => window.__keys);
  assert.deepEqual(keys.filter(([k]) => k === "Enter" || k === " ").map(([, prevented]) => prevented), [true, true], "Enter and Space are handled, not left to scroll the page");
  await toTop();
  await page.evaluate(() => document.querySelectorAll(".rost .rrow.pick")[1].focus({ preventScroll: true }));
  await page.keyboard.press("a");
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Chris Stanbridge On shift · 1h 5m", "another key picks nobody");
  assert.equal((await scrolls()).length, 3);
  assert.equal((await page.evaluate(() => window.__keys.filter(([k]) => k === "a"))).every(([, prevented]) => prevented === false), true);

  // the panel's own arrows and name buttons change the closer and never move the page
  await toTop();
  const before = await page.evaluate(() => window.scrollY);
  await page.evaluate(() => document.getElementById("fh-closer-next").click());
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Casey Reed Off shift");
  await page.evaluate(() => document.querySelector('#fh-closer-focus .pickb[data-fh-closer="2"]').click());
  assert.equal(await text(page, "#fh-closer-focus .pickwho"), "Dana Fox On shift · 10m");
  assert.equal((await scrolls()).length, 3, "no call for the panel's own controls");
  assert.equal(await page.evaluate(() => window.scrollY), before, "the page stays where it was");
  assert.equal(callsTo(page, "/api/read/sales-floor").length, 1, "picking a name makes no second request");
  await page.close();
});
