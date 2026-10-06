// Today's U37 parts in a real browser, offline, phone first (390 x 844).
//
// Plan unit U37 (spec docs/specs/marketing-machine-2026-10-04.md §8.3 Today,
// §11.3, §7.5 step 7; design docs/specs/command-center-design-2026-10-05.md
// §3.1). e2e/static-server.mjs serves public/ and page.route() answers /api/**
// with the API contract's own examples (src/marketing/api-contract.mjs,
// docs/specs/marketing-machine-api.md): GET marketing/today (U32 keys),
// GET marketing/health (U22), GET marketing/batches/next (U23),
// GET marketing/batches, POST marketing/batches/write-now, POST marketing/ideas
// and POST marketing/jobs/retry (U26). No database, no login, nothing sent
// anywhere. Every number below is a MOCK, not a live number.
//
// The clock is page.clock, fixed at Monday Oct 12, 2026, 12:00 PM Arizona
// (19:00 UTC), the day the contract examples are written for.
//
// What it proves (U37 acceptance):
//   1. Next drop: the time in Arizona, the count and the split from
//      batches/next, and the planner's 3 angles, each with Use this angle,
//      which saves an idea and says so in plain words.
//   2. Write now: not drawn while write_now_ready is false (Write ad copy
//      stays the one filled button); when true it is the ONE filled button,
//      Write ad copy turns outline and still works, the cost sheet comes
//      first, and the tap posts {request_id, count}.
//   3. The machine: clock, worker, saves to GitHub ("the GitHub token is not
//      set" / "held by the dry-run flag"), last Meta pull, model spend
//      against the caps.
//   4. Money and leads: today / 7 / 30 days with hand-drawn sparklines (an
//      inline <svg>, no chart library), spend by funnel, the flow, as-of
//      words; null prints "unknown", never $0.
//   5. Waiting on you: scripts ready and stuck jobs with their reasons; ONE
//      Retry per stuck job that posts marketing/jobs/retry and answers in
//      plain words.
//   6. One part failing leaves the rest of the page painted.
//
// EVIDENCE. Shots and their marks go to MCC_TODAY_PROOF_OUT, or the system
// temp directory, never a tracked path (CLAUDE.md §8: every shot shown to
// Chris is marked up; _apply-marks.py burns the boxes in).

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER, json, wireApi, withSession, trackErrors, assertPageAlive } from "./harness.mjs";
import { exampleResponse, assertRequestMatchesContract } from "../src/marketing/api-contract.mjs";

const OUT = path.resolve(process.env.MCC_TODAY_PROOF_OUT || path.join(os.tmpdir(), "mcc-today-u37"));
const RAW = path.join(OUT, "shots", "_raw");
const MANIFEST = path.join(OUT, "shots", "shot-marks.json");
fs.mkdirSync(RAW, { recursive: true });

const PAGE = "/app/marketing-command-center.html#today";
// 19:00 UTC is 12:00 PM in Arizona, Monday Oct 12, 2026.
const NOW = "2026-10-12T19:00:00Z";
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,200}$/;

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

/* 30 Arizona days ending today, oldest first. Two days have no saved spend
   (null): the line breaks there, it never dips to $0. */
function daily() {
  const out = [];
  const end = Date.UTC(2026, 9, 12);
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end - i * 86400000).toISOString().slice(0, 10);
    const spend = i === 0 ? null : (i === 12 || i === 13 ? null : 4000 + ((i * 37) % 9) * 900);
    out.push({ date: d, spend_cents: spend, leads: (i * 7) % 5 });
  }
  return out;
}

function today(over = {}) {
  const t = exampleResponse("GET marketing/today");
  t.daily = daily();
  return { ...t, ...over };
}

const VIDEOS_NONE = { ok: true, count: 0, limit: 50, offset: 0, hasMore: false, items: [] };
const COSTS = { ok: true, as_of: NOW, kinds: { script: null }, month: { used_usd: 12.48, cap_usd: 300 }, run_caps: {}, limits: {}, submagic: null, avatar_line: "" };

function batches(ready) {
  const b = exampleResponse("GET marketing/batches");
  b.write_now_ready = ready;
  return b;
}

/* handlers — every /api answer this page reads. Each can be swapped per
   test. `seen` records the POST bodies. More specific paths come first:
   the harness matches the first needle the URL contains. */
function handlers({ t = today(), health = [exampleResponse("GET marketing/health"), 200], next = [exampleResponse("GET marketing/batches/next"), 200],
  batchList = [batches(false), 200], writeNow = [exampleResponse("POST marketing/batches/write-now"), 202],
  idea = [exampleResponse("POST marketing/ideas"), 200], retry = [exampleResponse("POST marketing/jobs/retry"), 200],
  seen = {}, counts = {} } = {}) {
  const answer = (v) => (typeof v === "function" ? v() : v);
  return {
    "/api/marketing/today": async (route) => json(route, t),
    "/api/ad-videos": async (route) => json(route, VIDEOS_NONE),
    "/api/marketing/offer/generate": async (route) => json(route, { ok: false, error: "not_found", path: "marketing/offer/generate" }, 404),
    "/api/marketing/costs": async (route) => json(route, COSTS),
    "/api/marketing/health": async (route) => {
      counts.health = (counts.health || 0) + 1;
      const [b, s] = answer(health);
      return json(route, b, s);
    },
    "/api/marketing/batches/next": async (route) => {
      counts.next = (counts.next || 0) + 1;
      const [b, s] = answer(next);
      return json(route, b, s);
    },
    "/api/marketing/batches/write-now": async (route) => {
      seen.writeNow = route.request().postDataJSON();
      const [b, s] = answer(writeNow);
      return json(route, b, s);
    },
    "/api/marketing/batches": async (route) => {
      counts.batches = (counts.batches || 0) + 1;
      const [b, s] = answer(batchList);
      return json(route, b, s);
    },
    "/api/marketing/ideas": async (route) => {
      seen.idea = route.request().postDataJSON();
      const [b, s] = answer(idea);
      return json(route, b, s);
    },
    "/api/marketing/jobs/retry": async (route) => {
      seen.retry = route.request().postDataJSON();
      const [b, s] = answer(retry);
      return json(route, b, s);
    }
  };
}

async function open(page, h, { width = 390, height = 844, parts = true } = {}) {
  const errors = trackErrors(page);
  await page.setViewportSize({ width, height });
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, h);
  await page.goto(PAGE);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$615");
  if (parts) {
    await expect(page.locator("#machineBody .health-line")).toBeVisible();
    await expect(page.locator("#nextBody .drop-when")).toBeVisible();
  }
  return errors;
}

/* ── evidence ── */

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}

async function shot(page, file, legend, marks, { anchor } = {}) {
  if (anchor) {
    await page.locator(anchor).first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      const bar = document.querySelector("header.topbar");
      window.scrollBy(0, -((bar ? bar.getBoundingClientRect().height : 64) + 8));
    });
  } else if (marks.length) {
    await page.locator(marks[0].selector).first().scrollIntoViewIfNeeded();
  }
  await page.waitForTimeout(100);
  const vp = page.viewportSize();
  const out = [];
  for (const [i, m] of marks.entries()) {
    const box = await page.locator(m.selector).first().boundingBox();
    expect(box, `mark ${i + 1} (${m.caption}) has no box: ${m.selector}`).not.toBeNull();
    expect(box.y >= 0 && box.y + box.height <= vp.height, `mark ${i + 1} (${m.caption}) is outside the ${vp.width}x${vp.height} frame`).toBe(true);
    out.push({ n: i + 1, caption: m.caption, box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } });
  }
  await page.screenshot({ path: path.join(RAW, file) });
  const manifest = readManifest();
  manifest[file] = { legend, marks: out };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

/* The phone rules every Today part keeps at 390: no sideways scroll, no
   inner scroll box, every button at least 40px tall (UI-STANDARDS §11) and
   every U37 control at least 44px (design §3.0), no text under 11px, no
   <canvas> (charts are hand-drawn SVG). */
async function phoneRules(page) {
  const r = await page.evaluate(() => {
    const root = document.getElementById("tab-today");
    const bad = { scrollers: [], small: [], tiny: [] };
    root.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      if ((/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) ||
          (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)) bad.scrollers.push(el.id || el.className || el.tagName);
      const box = el.getBoundingClientRect();
      if (box.width && box.height && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
          parseFloat(cs.fontSize) < 11) bad.tiny.push(el.tagName + ":" + el.textContent.trim().slice(0, 20));
    });
    const u37 = ["cardNext", "cardMachine", "cardNumbers", "cardWaiting"].map((id) => document.getElementById(id));
    root.querySelectorAll("button, select, a.btn").forEach((el) => {
      const box = el.getBoundingClientRect();
      const floor = u37.some((c) => c && c.contains(el)) ? 44 : 40;
      if (box.width && box.height < floor) bad.small.push((el.id || el.textContent.trim()).slice(0, 30) + " " + Math.round(box.height));
    });
    return { ...bad, wide: document.documentElement.scrollWidth, canvas: root.querySelectorAll("canvas").length };
  });
  expect(r.wide, "no sideways scroll at 390").toBeLessThanOrEqual(390);
  expect(r.scrollers, "no inner scroll boxes").toEqual([]);
  expect(r.small, "buttons are at least 40px tall, U37's at least 44px").toEqual([]);
  expect(r.tiny, "no text under 11px").toEqual([]);
  expect(r.canvas, "charts are hand-drawn: no canvas").toBe(0);
}

/* ── 1. the whole of Today at 390, Write now not ready ── */

test("390: next drop, the machine, money and leads, scripts and stuck work, and Write ad copy stays the one filled button", async ({ page }) => {
  const counts = {};
  const errors = await open(page, handlers({ counts }));
  await assertPageAlive(page, errors);

  // Next drop: the time in Arizona, the count, the split by name.
  await expect(page.locator("#nextBody .drop-when")).toHaveText("Monday, Oct 19 at 7:00 AM Arizona time");
  await expect(page.locator("#nextBody .drop-when")).toHaveAttribute("title", "Oct 19, 2026, 7:00 AM");
  await expect(page.locator("#nextBody .drop-count")).toHaveText("21 scripts · Roadmap $147: 17 · Book a call: 4");
  await expect(page.locator("#nextBody")).toContainText("Split by each funnel's ad spend over the last 7 days.");
  await expect(page.locator("#nextBody")).toContainText("The weekly drop is off, so nothing comes on its own. Turn it on in Settings.");
  await expect(page.locator("#nextBody")).toContainText("$91.50 of last week's ad spend is not tied to a funnel yet.");
  await expect(page.locator('#nextBody a[href="#settings"]')).toHaveText("Open Settings");
  await expect(page.locator("#nextBody .batch-line")).toHaveText("Newest batch: Write now (Oct 13): writing. 1 of 3 ready.");
  // The 3 angles, each with its numbers and one Use this angle.
  await expect(page.locator("#nextBody .sugg > li")).toHaveCount(3);
  await expect(page.locator('#nextBody [data-angle-row="two-files"]')).toContainText("Lenders read two files");
  await expect(page.locator('#nextBody [data-angle-row="two-files"]')).toContainText("$412 spent last week · 9 leads · $45.78 a lead.");
  await expect(page.locator('#nextBody [data-angle-row="rates-rising"]')).toContainText("No ads ran on it last week.");
  await expect(page.locator('#nextBody [data-act="use-angle"]')).toHaveCount(3);

  // Write now is not drawn: write_now_ready is false. Write ad copy is the one filled button.
  await expect(page.locator("#writeNowBtn")).toHaveCount(0);
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write ad copy");
  await expect(page.locator("#todayWork > .card").first()).toHaveId("cardCopy");

  // The machine.
  await expect(page.locator("#machineBody .health-line")).toContainText("The machine needs a look: the clock is late.");
  await expect(page.locator('#machineBody [data-health="clock"]')).toContainText("Late");
  await expect(page.locator('#machineBody [data-health="clock"]')).toContainText("Last tick 3 hours ago. It should tick every 15 minutes. The weekly drop is off.");
  await expect(page.locator('#machineBody [data-health="worker"]')).toContainText("1 job failed in the last 24 hours.");
  await expect(page.locator('#machineBody [data-health="outbox"]')).toContainText("Repo saves are held: the GitHub token is not set.");
  await expect(page.locator('#machineBody [data-health="outbox"]')).toContainText("2 saves waiting since 8:06 AM (3 hours ago).");
  await expect(page.locator('#machineBody [data-health="outbox"]')).toContainText("No save has reached GitHub yet.");
  await expect(page.locator('#machineBody [data-health="sync"]')).toContainText("Last pulled 12:01 AM (11 hours ago).");
  await expect(page.locator('#machineBody [data-health="model"]')).toContainText("This month: $12.48 of $300. Last batch: $9.70 of $40.");
  await expect(page.locator('#machineBody [data-health="model"] .meter')).toHaveAttribute("aria-label", "$12.48 of $300 used this month");
  await expect(page.locator("#machineBody")).toContainText("It never turns an ad on, pauses one, or changes a budget. You do that in Launch.");

  // Waiting on you: scripts first, then the stuck job with its reason and ONE Retry.
  await expect(page.locator("#waitingList > ol > li").first()).toContainText("Approve or fix 18 scripts");
  await expect(page.locator("#waitingList > ol > li").first()).toContainText("2 scripts need a look first.");
  await expect(page.locator('#waitingList [data-wait="scripts"] a[href="#scripts"]')).toHaveText("Open Scripts");
  const stuck = page.locator('#waitingList [data-wait="stuck"]');
  await expect(stuck).toHaveCount(1);
  await expect(stuck).toContainText("Stuck: writing one script");
  await expect(stuck).toContainText("The writer stopped: the model took longer than 5 minutes.");
  await expect(stuck).toContainText("Stuck since 5:40 AM (6 hours ago).");
  await expect(stuck.locator('[data-act="retry"]')).toHaveCount(1);
  await expect(page.locator("#waitingCount")).toHaveText("2 to do");

  // Money and leads: today / 7 / 30, every metric, null as words.
  const d7 = page.locator('#numbersBody [data-win="d7"]');
  await expect(d7.locator('[data-num="spend"] b')).toHaveText("$615");
  await expect(d7.locator('[data-num="spend"] .num-note')).toHaveText("Up from $482 the 7 days before.");
  await expect(d7.locator('[data-num="leads"] b')).toHaveText("23");
  await expect(d7.locator('[data-num="booked"] b')).toHaveText("7");
  await expect(d7.locator('[data-num="booked"] .num-note')).toHaveText("5 showed");
  await expect(d7.locator('[data-num="sales"] .num-note')).toHaveText("4 roadmaps bought");
  await expect(d7.locator('[data-num="cash"] b')).toHaveText("$1,588");
  await expect(d7.locator('[data-num="cash"] .num-note')).toHaveText("Closers typed $1,000");
  await expect(d7.locator('[data-num="roas"] b')).toHaveText("$2.58");
  const td = page.locator('#numbersBody [data-win="today"]');
  await expect(td.locator('[data-num="spend"] b')).toHaveText("Comes in tomorrow");
  await expect(td.locator('[data-num="cash"] .num-note')).toHaveCount(0);
  await expect(td.locator('[data-num="roas"] b')).toHaveText("unknown");
  await expect(page.locator('#numbersBody [data-win="d30"] [data-num="spend"] b')).toHaveText("$2,034");
  // Sparklines: drawn by hand; the two null days break the line into pieces.
  await expect(page.locator('#numbersBody [data-spark="spend"] svg.spark polyline')).toHaveCount(2);
  await expect(page.locator('#numbersBody [data-spark="leads"] svg.spark polyline')).toHaveCount(1);
  await expect(page.locator('#numbersBody [data-spark="spend"]')).toContainText("No spend saved on 3 of 30 days.");
  await expect(page.locator('#numbersBody [data-spark="spend"] .spark-ends')).toHaveText("Sep 13Oct 12");
  // Spend by funnel and the flow.
  const bars = page.locator('#numbersBody [data-part="by-funnel"] .bar-row');
  await expect(bars).toHaveCount(3);
  await expect(bars.nth(0)).toContainText("Roadmap $147$412");
  await expect(bars.nth(2)).toContainText("Not tied to a funnel$91.50");
  await expect(bars.nth(2).locator('a[href="#settings"]')).toHaveText("Tie it to a funnel in Settings");
  await expect(page.locator('#numbersBody [data-step="clicks"] b')).toHaveText("2,210");
  await expect(page.locator('#numbersBody [data-step="page"] b')).toHaveText("1,840");
  await expect(page.locator('#numbersBody [data-step="booked"] .num-note')).toHaveText("5 showed");
  await expect(page.locator("#numbersBody .asof")).toHaveText(
    "Numbers through Oct 11, saved 12:01 AM (11 hours ago). ClickFunnels last pulled Oct 11, 3:10 PM.");

  // The reads ran once each on open.
  expect(counts).toEqual({ health: 1, next: 1, batches: 1 });

  await phoneRules(page);
  await shot(page, "u37-01-next-drop-390.png", "Next drop at 390 (Write now not ready yet)", [
    { selector: "#nextBody .drop-when", caption: "When the next drop comes, Arizona time" },
    { selector: "#nextBody .drop-count", caption: "How many, split by last week's spend" },
    { selector: '#nextBody [data-angle-row="two-files"]', caption: "An angle to try, with its numbers and Use this angle" }
  ], { anchor: "#cardNext" });
  await shot(page, "u37-02-machine-390.png", "The machine at 390", [
    { selector: "#machineBody .health-line", caption: "One line: healthy, or the first thing that needs a look" },
    { selector: '#machineBody [data-health="clock"]', caption: "The clock: late, in words and a chip" }
  ], { anchor: "#cardMachine" });
  await shot(page, "u37-02b-saves-390.png", "Saves to GitHub and model spend at 390", [
    { selector: '#machineBody [data-health="outbox"]', caption: "Repo saves held: the GitHub token is not set" },
    { selector: '#machineBody [data-health="model"]', caption: "Model spend against the caps" }
  ], { anchor: '#machineBody [data-health="outbox"]' });
  await shot(page, "u37-03-waiting-390.png", "Waiting on you at 390: scripts and a stuck job", [
    { selector: '#waitingList [data-wait="scripts"]', caption: "Scripts ready, with Open Scripts" },
    { selector: '#waitingList [data-wait="stuck"] [data-act="retry"]', caption: "One Retry per stuck job" }
  ], { anchor: "#cardWaiting" });
  await shot(page, "u37-04-numbers-390.png", "Money and leads at 390: today, 7 and 30 days", [
    { selector: '#numbersBody [data-win="today"] [data-num="spend"]', caption: "Today's spend comes in tomorrow (never $0)" },
    { selector: '#numbersBody [data-win="today"] [data-num="roas"]', caption: "Unknown stays unknown" }
  ], { anchor: "#cardNumbers" });
  await shot(page, "u37-05-sparks-390.png", "Hand-drawn sparklines, spend by funnel, the flow (390)", [
    { selector: '#numbersBody [data-spark="spend"]', caption: "Spend each day: the gap is the 3 days with no number" },
    { selector: '#numbersBody [data-spark="leads"]', caption: "Leads each day, drawn by hand" }
  ], { anchor: "#numbersBody .sparks" });
  await shot(page, "u37-05b-funnels-flow-390.png", "Spend by funnel and the flow (390)", [
    { selector: '#numbersBody [data-part="by-funnel"] .bar-row.unmapped', caption: "Spend not tied to a funnel, with the way to fix it" },
    { selector: '#numbersBody [data-step="clicks"]', caption: "The flow starts at the ad tap" }
  ], { anchor: '#numbersBody [data-part="by-funnel"] .bar-row.unmapped' });
});

/* ── 2. Write now ready: the one filled button, cost sheet first ── */

test("390: when write_now_ready is true, Write now is the one filled button, the cost sheet comes first, and the tap posts {request_id, count}", async ({ page }) => {
  const seen = {};
  const counts = {};
  let batchAnswer = batches(true);
  const errors = await open(page, handlers({ seen, counts, batchList: () => [batchAnswer, 200] }));

  const wn = page.locator("#writeNowBtn");
  await expect(wn).toBeVisible();
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write now");
  // Write ad copy keeps working, as an outline button.
  await expect(page.locator("#copyBtn")).not.toHaveClass(/primary/);
  await expect(page.locator("#copyBtn")).toBeEnabled();
  // Next drop takes the top-left slot of the work grid.
  await expect(page.locator("#todayWork > .card").first()).toHaveId("cardNext");
  const box = await wn.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(48);
  expect(box.width).toBeGreaterThan(300);

  await shot(page, "u37-06-write-now-390.png", "Write now is the one filled button once it can run (390)", [
    { selector: "#writeNowCount", caption: "How many scripts (3 unless you pick)" },
    { selector: "#writeNowBtn", caption: "Write now: the one filled button" }
  ], { anchor: "#cardNext" });

  await page.locator("#writeNowCount").selectOption("5");
  await wn.click();
  const sheet = page.locator(".cc-sheet");
  await expect(sheet.locator("h2")).toHaveText("Write 5 scripts now?");
  await expect(sheet.locator("[data-sheet-cost]")).toHaveText("Cost: unknown, not measured yet.");
  await expect(sheet.locator("[data-sheet-month]")).toHaveText("Model spend this month: $12.48 of $300.00.");
  await expect(sheet).toContainText("The cost line is for one script. You asked for 5.");
  await expect(sheet).toContainText("It stops by itself at $40 a batch and $300 a month.");
  await expect(sheet).toContainText("It spends no ad money.");
  await expect(sheet.locator('[data-sheet="yes"]')).toHaveText("Write 5");
  expect(seen.writeNow, "nothing is sent before the yes").toBeUndefined();
  await shot(page, "u37-07-write-now-sheet-390.png", "The cost sheet before Write now (390)", [
    { selector: ".cc-sheet [data-sheet-cost]", caption: "Cost first: unknown until measured" },
    { selector: '.cc-sheet [data-sheet="yes"]', caption: "Write 5: only after this tap" }
  ]);

  // The batch list after the tap shows the new batch writing.
  batchAnswer = batches(true);
  batchAnswer.batches[0] = { ...batchAnswer.batches[0], id: "b-new", counts: { total: 5, ready: 0, flagged: 0, failed: 0 }, release_at: NOW };
  await sheet.locator('[data-sheet="yes"]').click();
  await expect(page.locator("#nextBody .say")).toHaveText("Writing 5 scripts now. They show up in Scripts when they are done. You can leave this page.");
  expect(seen.writeNow.count).toBe(5);
  expect(seen.writeNow.request_id).toMatch(REQUEST_ID_RE);
  assertRequestMatchesContract("POST marketing/batches/write-now", seen.writeNow);
  await expect(page.locator("#nextBody .batch-line")).toHaveText("Newest batch: Write now (Oct 12): writing. 0 of 5 ready.");

  // While it writes, the list is read again every 20 seconds.
  const before = counts.batches;
  batchAnswer = batches(true);
  batchAnswer.batches[0] = { ...batchAnswer.batches[0], id: "b-new", counts: { total: 5, ready: 2, flagged: 0, failed: 0 }, release_at: NOW };
  await page.clock.runFor(21000);
  await expect.poll(() => counts.batches).toBeGreaterThan(before);
  await expect(page.locator("#nextBody .batch-line")).toHaveText("Newest batch: Write now (Oct 12): writing. 2 of 5 ready.");
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await assertPageAlive(page, errors);
  await phoneRules(page);
});

test("Write now: Cancel on the cost sheet sends nothing; a cap answer says which cap and that nothing started", async ({ page }) => {
  const seen = {};
  await open(page, handlers({ seen, batchList: [batches(true), 200],
    writeNow: [{ ok: false, error: "cap_reached", message: "This month's model spend cap ($300) is reached." }, 400] }));
  await page.locator("#writeNowBtn").click();
  await page.locator('.cc-sheet [data-sheet="no"]').click();
  await expect(page.locator(".cc-sheet")).toHaveCount(0);
  expect(seen.writeNow).toBeUndefined();
  await page.locator("#writeNowBtn").click();
  await page.locator('.cc-sheet [data-sheet="yes"]').click();
  await expect(page.locator("#nextBody .say.err")).toHaveText("This month's model spend cap ($300) is reached. Nothing was started.");
  expect(seen.writeNow.count).toBe(3);
  await expect(page.locator("#writeNowBtn")).toBeEnabled();
});

/* ── 3. Use this angle ── */

test("Use this angle saves the suggestion as an idea, says so, and the plan is read again", async ({ page }) => {
  const seen = {};
  const counts = {};
  const nextAfter = exampleResponse("GET marketing/batches/next");
  nextAfter.next.suggestions = nextAfter.next.suggestions.filter((s) => s.angle_key !== "two-files");
  let nextAnswer = exampleResponse("GET marketing/batches/next");
  await open(page, handlers({ seen, counts, next: () => [nextAnswer, 200],
    idea: () => { nextAnswer = nextAfter; return [exampleResponse("POST marketing/ideas"), 200]; } }));
  await page.locator('#nextBody [data-angle-row="two-files"] [data-act="use-angle"]').click();
  await expect(page.locator("#nextBody .say.ok")).toHaveText(
    "Saved “Lenders read two files” as an idea at 12:00 PM. Ideas go first in the next batch.");
  expect(seen.idea).toEqual({
    request_id: seen.idea.request_id,
    raw_points: "Most spend and most leads last week.",
    source: "suggestion",
    angle_key: "two-files"
  });
  expect(seen.idea.request_id).toMatch(REQUEST_ID_RE);
  assertRequestMatchesContract("POST marketing/ideas", seen.idea);
  // The plan is read again; the planner leaves out an angle a waiting idea names.
  await expect.poll(() => counts.next).toBe(2);
  await expect(page.locator("#nextBody .sugg > li")).toHaveCount(2);
  await shot(page, "u37-08-use-angle-390.png", "Use this angle answers in plain words (390)", [
    { selector: "#nextBody .say.ok", caption: "Saved as an idea; ideas go first in the next batch" }
  ]);
});

test("Use this angle: a refusal is a sentence and the button comes back", async ({ page }) => {
  await open(page, handlers({ idea: [{ ok: false, error: "invalid", field: "raw_points", message: "Type or say the idea first. The box is empty." }, 400] }));
  const btn = page.locator('#nextBody [data-angle-row="inquiries-off"] [data-act="use-angle"]');
  await btn.click();
  await expect(page.locator("#nextBody .say.err")).toHaveText("That angle was not saved. Type or say the idea first. The box is empty.");
  await expect(page.locator('#nextBody [data-angle-row="inquiries-off"] [data-act="use-angle"]')).toBeEnabled();
});

/* ── 4. Retry a stuck job ── */

test("Retry posts marketing/jobs/retry for that job and the row says it is running again", async ({ page }) => {
  const seen = {};
  const counts = {};
  await open(page, handlers({ seen, counts }));
  const row = page.locator('#waitingList [data-wait="stuck"]');
  await row.locator('[data-act="retry"]').click();
  await expect(row.locator(".say")).toHaveText("Running again. Started 12:00 PM.");
  await expect(row.locator('[data-act="retry"]')).toHaveCount(0);
  expect(seen.retry).toEqual({ request_id: seen.retry.request_id, job_id: "00000000-0000-4000-8000-000000000501" });
  expect(seen.retry.request_id).toMatch(REQUEST_ID_RE);
  assertRequestMatchesContract("POST marketing/jobs/retry", seen.retry);
  // The health card is read again after a retry.
  await expect.poll(() => counts.health).toBe(2);
  await shot(page, "u37-09-retry-390.png", "Retry answers on the row (390)", [
    { selector: '#waitingList [data-wait="stuck"] .say', caption: "Running again, with the time" }
  ], { anchor: "#cardWaiting" });
});

test("Retry: the server's own sentence when it refuses, and Retry stays", async ({ page }) => {
  await open(page, handlers({ retry: [{ ok: false, error: "invalid", field: "job_id", message: "That step has not failed. It is waiting or running now." }, 400] }));
  const row = page.locator('#waitingList [data-wait="stuck"]');
  await row.locator('[data-act="retry"]').click();
  await expect(row.locator(".say.err")).toHaveText("That step has not failed. It is waiting or running now.");
  await expect(row.locator('[data-act="retry"]')).toBeEnabled();
});

/* ── 5. the machine's other words ── */

test("the machine: a dry-run hold, a last save and error, and a healthy line", async ({ page }) => {
  const h = exampleResponse("GET marketing/health");
  h.clock.last_tick_at = "2026-10-12T18:50:00Z";
  h.worker.failed_24h = [];
  h.outbox = { waiting: 0, oldest_waiting_at: null, last_commit_sha: "abcdef1234567", last_commit_at: "2026-10-12T17:00:00Z",
    last_error: "GitHub said 409 on marketing/ads/ideas/x.md", token_present: true, held_reason: "dry_run" };
  await open(page, handlers({ health: [h, 200] }));
  await expect(page.locator('#machineBody [data-health="outbox"]')).toContainText(
    "Repo saves are held by the dry-run flag, so nothing goes to GitHub yet. Nothing is waiting. Last save abcdef1, 2 hours ago. Last error: GitHub said 409 on marketing/ads/ideas/x.md.");
  await expect(page.locator("#machineBody .health-line")).toContainText("The machine needs a look: repo saves are held by the dry-run flag.");
  await expect(page.locator('#machineBody [data-health="clock"]')).toContainText("Running");
  await expect(page.locator('#machineBody [data-health="worker"]')).toContainText("Nothing failed in the last 24 hours.");
});

/* ── 6. unknown is unknown; a part that fails leaves the rest painted ── */

test("null numbers print unknown, never $0, and a missing M5 part says so in words", async ({ page }) => {
  const t = today();
  t.numbers.d7 = { spend_cents: null, leads: null, booked: null, showed: null, sales: null, roadmaps: null, cash_cents: null, reported_cash_cents: null, roas: null };
  t.spend_by_funnel = [{ funnel_key: "roadmap_147", name: "Roadmap $147", spend_cents: null }, { funnel_key: null, name: "Unmapped", spend_cents: 500 }];
  t.flow = { page_views: null, clicks: null, leads: 0, booked: 0, showed: 0, sales: 0 };
  t.daily = t.daily.map((d) => ({ ...d, spend_cents: null }));
  await open(page, handlers({ t }));
  const d7 = page.locator('#numbersBody [data-win="d7"]');
  for (const k of ["spend", "leads", "booked", "sales", "cash", "roas"]) {
    await expect(d7.locator(`[data-num="${k}"] b`)).toHaveText("unknown");
  }
  await expect(page.locator('#numbersBody [data-part="by-funnel"] .bar-row').first()).toContainText("Roadmap $147unknown");
  await expect(page.locator('#numbersBody [data-part="by-funnel"] .bar-row').first().locator(".bar")).toHaveCount(0);
  await expect(page.locator('#numbersBody [data-step="clicks"] b')).toHaveText("unknown");
  await expect(page.locator('#numbersBody [data-step="leads"] b')).toHaveText("0");
  await expect(page.locator('#numbersBody [data-spark="spend"] svg')).toHaveCount(0);
  await expect(page.locator('#numbersBody [data-spark="spend"]')).toContainText("No ad spend saved on any of these days.");
  expect(await d7.textContent()).not.toContain("$0");
});

test("a part that fails or is not on the server says so; the rest of Today stays painted", async ({ page }) => {
  const t = today({ numbers: null, waiting: [{ part: "numbers", reason: "The M5 numbers are not live yet." }] });
  const errors = await open(page, handlers({ t,
    health: [{ ok: false, error: "internal_error" }, 500],
    next: [{ ok: false, error: "not_ready", message: "x" }, 503],
    batchList: [{ ok: false, error: "internal_error" }, 500] }), { parts: false });
  await expect(page.locator("#machineBody")).toHaveText(
    "The machine's health did not load. The rest of this page is current. It tries again in 5 minutes.");
  await expect(page.locator("#nextBody")).toHaveText("The next drop is not on this server yet. It turns on with the next update.");
  await expect(page.locator("#numbersBody")).toHaveText("The M5 numbers are not live yet.");
  // No Write now when the batch list did not answer; Write ad copy is still the filled one.
  await expect(page.locator("#writeNowBtn")).toHaveCount(0);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write ad copy");
  // The rest is painted.
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$615");
  await expect(page.locator('#waitingList [data-wait="stuck"]')).toHaveCount(1);
  await assertPageAlive(page, errors);
});

/* ── 7. a wide screen: the one job above the fold ── */

test("1280: with Write now ready, it sits top-left of the work grid above the fold, and only it is filled", async ({ page }) => {
  await open(page, handlers({ batchList: [batches(true), 200] }), { width: 1280, height: 900 });
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write now");
  const wn = await page.locator("#writeNowBtn").boundingBox();
  expect(wn.y + wn.height).toBeLessThanOrEqual(900);
  const next = await page.locator("#cardNext").boundingBox();
  const waiting = await page.locator("#cardWaiting").boundingBox();
  expect(next.x).toBeLessThan(waiting.x);
  expect(Math.abs(next.y - waiting.y)).toBeLessThan(2);
  // Three number columns side by side above 960px.
  const a = await page.locator('#numbersBody [data-win="today"]').boundingBox();
  const b = await page.locator('#numbersBody [data-win="d30"]').boundingBox();
  expect(Math.abs(a.y - b.y)).toBeLessThan(2);
  // Write ad copy moved into Next drop's old slot, under the Offer cards, and works.
  const copy = await page.locator("#cardCopy").boundingBox();
  const offer = await page.locator("#cardOffer").boundingBox();
  expect(copy.y).toBeGreaterThan(offer.y);
  await expect(page.locator("#todayMore > .card").first()).toHaveId("cardCopy");
  await shot(page, "u37-10-write-now-1280.png", "1280: Write now top-left, above the fold", [
    { selector: "#writeNowBtn", caption: "The one filled button, above the fold" },
    { selector: "#cardWaiting .card-hd", caption: "Waiting on you stays beside it" }
  ], { anchor: "#todayWork" });
});

test("Write ad copy keeps working as an outline button while Write now is the filled one", async ({ page }) => {
  const seen = {};
  const h = handlers({ batchList: [batches(true), 200] });
  const creative = {
    "/api/creative/generate": async (route) => {
      seen.generate = route.request().postDataJSON();
      return json(route, { ok: true, created: true, job: { id: "job-9" }, provider_ready: true });
    },
    "/api/creative/run": async (route) => {
      seen.run = route.request().postDataJSON();
      return json(route, { ok: true, ran: 1, succeeded: 1, failed: 0, requeued: 0, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", compliance_state: "passed", copy_text: "Your bank said no? It was not about you." }] }
      ] });
    }
  };
  await open(page, { ...creative, ...h });
  const btn = page.locator("#copyBtn");
  await expect(btn).not.toHaveClass(/primary/);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write now");
  await page.locator("#copyAngle").fill("business owners the bank turned down");
  await btn.click();
  await expect(page.locator("#copySay")).toHaveText("Done. Here is your new ad copy. It passed the ad rules check.");
  expect(seen.generate.prompt).toBe("business owners the bank turned down");
  expect(seen.run.max_jobs).toBe(1);
  // After the run it is still the outline button, and still the only other way to write.
  await expect(btn).not.toHaveClass(/primary/);
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
});
