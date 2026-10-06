// The Command Center's Settings tab (the gear) in a real browser, offline.
//
// e2e/static-server.mjs serves public/ and page.route() answers /api/**. Every
// answer is built from the U01 contract's own examples
// (src/marketing/api-contract.mjs exampleResponse): GET/POST marketing/settings,
// GET/POST marketing/funnels and GET marketing/health, shaped exactly as
// api/marketing/settings.mjs, funnels.mjs and health.mjs answer. No database,
// no live site, nothing sent anywhere. The numbers are the contract's made-up
// ones, not live numbers.
//
// Phone first: everything runs at 390x844 except the one 1280 layout check.
// It proves (plan unit U34, design §3.8, UI-STANDARDS):
//   - every dial in plain words; the video choices stay hidden;
//   - one filled button, Save, at the bottom right; text 11px or larger;
//     no sideways scroll; no inner scroll box;
//   - Save sends only what changed, with a fresh request_id and the
//     updated_at it read, and answers in words;
//   - the weekly switch is off; turning it on takes two taps and names the
//     caps; Save never sends `enabled`;
//   - a 409 shows both versions; Keep mine and Use the saved one;
//   - a month cap under what is spent warns before it saves;
//   - funnels: link a campaign (7-day spend beside it; null reads "unknown",
//     never $0), pick its ad set, save; a campaign on another funnel is
//     disabled with the reason;
//   - a bad box is named in words and nothing is sent; a part that fails to
//     load says so and the rest stays.
//
// EVIDENCE. Shots and their red-box marks go to MCC_PROOF_OUT (or the system
// temp directory), never a tracked path; _apply-marks.py burns the boxes in.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER, json, wireApi, withSession, trackErrors, assertPageAlive } from "./harness.mjs";
import { exampleResponse, assertRequestMatchesContract } from "../src/marketing/api-contract.mjs";

const OUT_DIR = process.env.MCC_PROOF_OUT;
const OUT = OUT_DIR ? path.resolve(OUT_DIR) : path.join(os.tmpdir(), "mcc-marketing-command-center");
const RAW = path.join(OUT, "shots", "_raw");
const MANIFEST = path.join(OUT, "shots", "shot-marks.json");
fs.mkdirSync(RAW, { recursive: true });

const PAGE = "/app/marketing-command-center.html#settings";
// 15:04:05 UTC is 8:04 AM in Arizona.
const NOW = "2026-10-12T15:04:05Z";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

/* SETTINGS is the settings object; GET answers wrap it as {settings}. */
const SETTINGS = () => exampleResponse("GET marketing/settings").settings;
const FUNNELS = () => exampleResponse("GET marketing/funnels");
const HEALTH = () => exampleResponse("GET marketing/health");

/* api — the three reads and the two writes. Each answer can be swapped per
   test; `posts` collects every POST body so a test can read what was sent.
   A list of answers is used in order, one per call (the last one repeats). */
function api({ settings = [[{ settings: SETTINGS() }, 200]], funnels = [[FUNNELS(), 200]], health = [[HEALTH(), 200]],
  settingsPost, funnelsPost, delay = 0, posts } = {}) {
  const pick = (list, i) => list[Math.min(i, list.length - 1)];
  let sp = 0;
  let fp = 0;
  let sg = 0;
  return {
    "/api/marketing/settings": async (route, { method }) => {
      if (method === "POST") {
        const sent = JSON.parse(route.request().postData() || "{}");
        posts.settings.push(sent);
        const ans = settingsPost ? pick(settingsPost, sp++) : null;
        if (ans) return json(route, typeof ans[0] === "function" ? ans[0](sent) : ans[0], ans[1]);
        const saved = { ...SETTINGS(), ...sent.patch, updated_at: "2026-10-12T15:05:00.000Z", updated_by: "00000000-0000-4000-8000-000000000002" };
        if (sent.patch && sent.patch.format_style) saved.format_style = { ...SETTINGS().format_style, ...sent.patch.format_style };
        return json(route, { settings: saved });
      }
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const [b, s] = pick(settings, sg++);
      return json(route, b, s);
    },
    "/api/marketing/funnels": async (route, { method }) => {
      if (method === "POST") {
        const sent = JSON.parse(route.request().postData() || "{}");
        posts.funnels.push(sent);
        const ans = funnelsPost ? pick(funnelsPost, fp++) : null;
        if (ans) return json(route, typeof ans[0] === "function" ? ans[0](sent) : ans[0], ans[1]);
        const base = FUNNELS().funnels.find((f) => f.key === sent.funnel.key);
        const { updated_at: _u, ...fields } = sent.funnel;
        return json(route, { funnel: { ...base, ...fields, updated_at: "2026-10-12T15:05:00.000Z" } });
      }
      const [b, s] = pick(funnels, 0);
      return json(route, b, s);
    },
    "/api/marketing/health": async (route) => {
      const [b, s] = pick(health, 0);
      return json(route, b, s);
    }
  };
}

async function open(page, opts = {}, { clock = true, width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height });
  const errors = trackErrors(page);
  if (clock) await page.clock.install({ time: new Date(NOW) });
  const posts = { settings: [], funnels: [] };
  await withSession(page, OWNER);
  await wireApi(page, OWNER, api({ ...opts, posts }));
  await page.goto(PAGE);
  return { errors, posts };
}

/* ── evidence (same helper as marketing-command-center.spec.mjs) ─────────── */

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}

async function shot(page, file, legend, marks, { height, anchor } = {}) {
  if (height) {
    await page.setViewportSize({ width: page.viewportSize().width, height });
    await page.waitForTimeout(150);
  }
  if (anchor) {
    await page.locator(anchor).first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      const bar = document.querySelector("header.topbar");
      window.scrollBy(0, -((bar ? bar.getBoundingClientRect().height : 64) + 8));
    });
    await page.waitForTimeout(150);
  } else if (marks.length) {
    await page.locator(marks[0].selector).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
  }
  const vp = page.viewportSize();
  const out = [];
  for (const [i, m] of marks.entries()) {
    const box = await page.locator(m.selector).first().boundingBox();
    expect(box, `mark ${i + 1} (${m.caption}) has no box — ${m.selector}`).not.toBeNull();
    expect(box.y >= 0 && box.y + box.height <= vp.height,
      `mark ${i + 1} (${m.caption}) is outside the ${vp.width}x${vp.height} frame`).toBe(true);
    out.push({ n: i + 1, caption: m.caption,
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } });
  }
  await page.screenshot({ path: path.join(RAW, file) });
  const manifest = readManifest();
  manifest[file] = { legend, marks: out };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

async function innerScrollBoxes(page) {
  return page.locator("#tab-settings").evaluate((root) => {
    const bad = [];
    root.querySelectorAll("*").forEach((el) => {
      if (el.closest("table")) return; // a table may scroll in its own box (UI-STANDARDS §11)
      const cs = getComputedStyle(el);
      const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (y || x) bad.push(el.id || el.className || el.tagName);
    });
    return bad;
  });
}

const save = (page) => page.locator("#setSave");

/* clearOfChat — the shell's round Chat button sits in the bottom-right
   corner of every staff page; Save must never be under it. */
async function clearOfChat(page) {
  const fab = page.locator("#fh-chat-fab");
  if (!(await fab.count())) return;
  const a = await fab.boundingBox();
  const b = await save(page).boundingBox();
  const overlap = a && b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, "Save is under the Chat button").toBeFalsy();
}

/* ── the states ───────────────────────────────────────────────────────────── */

test("loading at 390: skeletons in the real layout, no spinner over the page", async ({ page }) => {
  await open(page, { delay: 2500 }, { clock: false });
  await expect(page.locator("#tab-settings .skel").first()).toBeVisible();
  await expect(page.locator("#tab-settings h2", { hasText: "Write scripts every week" })).toBeVisible();
  await shot(page, "s00-loading-390.png", "Settings loading at 390: the real layout", [
    { selector: "#tab-settings .card", caption: "The switch card holds its place" }
  ]);
  await expect(page.locator("#setSwitch")).toBeVisible({ timeout: 6000 });
});

test("full at 390: every dial in plain words, the video choices hidden, one Save at the bottom right", async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator("#setSwitch")).toBeVisible();
  await assertPageAlive(page, errors);

  // 1. The weekly switch: off by default, in words.
  await expect(page.locator("#setSwitch .chip")).toHaveText("Off");
  await expect(page.locator("#setSwitchLine")).toHaveText("Off. No weekly scripts are written until you turn this on.");
  await expect(page.locator("#setSwitch")).toContainText("Buttons you tap still work when this is off.");
  await expect(page.locator("#setSwitch")).toContainText("These are the starting settings.");

  // 2. The schedule.
  await expect(page.locator('#setSchedule [data-live="schedule"]')).toHaveText("Every Monday at 7:00 AM Arizona time: 21 scripts.");
  await expect(page.locator("#set-day")).toHaveValue("1");
  await expect(page.locator("#set-time")).toHaveValue("07:00");
  await expect(page.locator('label[for="set-time"]')).toHaveText("Drop time (Arizona time)");
  await expect(page.locator("#set-per-day")).toHaveValue("3");
  await expect(page.locator("#set-days")).toHaveValue("7");
  await expect(page.locator('input[name="set-size-rule"][value="total"]')).toBeChecked();
  await expect(page.locator('[data-live="rule-total"]')).toHaveText("3 a day in total");
  await expect(page.locator('[data-live="rule-per_funnel"]')).toHaveText("3 a day for each running funnel");
  await expect(page.locator("#set-style-standard")).toHaveValue("bullets");
  await expect(page.locator("#set-style-sorting")).toHaveValue("words");
  await expect(page.locator("#set-expiry")).toHaveValue("14");

  // 3. Quiet hours and 4. the caps, with what is used this month.
  await expect(page.locator('[data-live="quiet"]')).toHaveText("No buzzes from 9:00 PM to 7:00 AM, Arizona time. They wait until 7:00 AM.");
  await expect(page.locator("#set-cap-batch")).toHaveValue("40");
  await expect(page.locator("#set-cap-month")).toHaveValue("300");
  await expect(page.locator("#setSpent")).toHaveText("Used this month: $12.48. Last batch: $9.70.");
  await expect(page.locator('[data-live="cap-warn"]')).toBeHidden();

  // 5. The winner rule.
  await expect(page.locator("#setWinner")).toContainText("Not set yet.");
  await expect(page.locator("#setWinner")).toContainText("Until you fill this in, the machine writes more new versions of the angles you spend the most on.");

  // 6. Funnels, with each campaign's 7-day spend: null reads "unknown", never $0.
  await expect(page.locator("#setFunnels fieldset.funnel")).toHaveCount(2);
  const road = page.locator('[data-funnel="roadmap_147"]');
  await expect(road.locator("h3")).toHaveText("Roadmap $147");
  await expect(page.locator("#fn-roadmap_147-name")).toHaveValue("Roadmap $147");
  await expect(page.locator("#fn-roadmap_147-url")).toHaveValue("https://apply.fundhub.ai/roadmap");
  await expect(page.locator("#fn-roadmap_147-lane")).toHaveValue("uwiq");
  await expect(page.locator("#fn-roadmap_147-cta")).toHaveValue("LEARN_MORE");
  await expect(page.locator("#fn-roadmap_147-weight")).toHaveValue("1");
  await expect(page.locator("#fn-book_call-mix-standard")).toHaveValue("2");
  await expect(page.locator("#fn-book_call-mix-sorting")).toHaveValue("1");
  await expect(road.locator(".camps li").nth(0)).toContainText("Roadmap ads (example)");
  await expect(road.locator(".camps li").nth(0)).toContainText("$412.00 spent in the last 7 days.");
  await expect(road.locator(".camps li").nth(1)).toContainText("Spend in the last 7 days: unknown.");
  const campaignWords = (await page.locator("#setFunnels .camps").allInnerTexts()).join(" ");
  expect(campaignWords).not.toContain("$0");
  await expect(road).toContainText("No Meta campaign is linked to this funnel, so its spend reads unknown and the batch split treats it as $0 spent.");
  await expect(page.locator("#fn-roadmap_147-adset")).toBeDisabled();
  await expect(road).toContainText("Link a Meta campaign first. Then pick its ad set here.");
  await expect(page.locator("#setFunnels")).toContainText("Meta numbers as of 12:01 AM.");

  // The video choices are not on the page (UI-STANDARDS §5: nothing reads them yet).
  const words = await page.locator("#tab-settings").innerText();
  expect(words).not.toMatch(/Submagic|Hormozi|caption|zoom|clean audio|animation|flip|mirror|settle/i);
  expect(words).not.toMatch(/FundHub|Claude Code|in chat/);

  // One filled button: Save, bottom right, resting until something changes.
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(save(page)).toHaveText("Save");
  await expect(save(page)).toBeDisabled();
  await expect(page.locator("#setSay")).toHaveText("No changes to save.");

  // Phone: no sideways scroll, no inner scroll box, 40px+ targets, text 11px+.
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
  expect(await innerScrollBoxes(page)).toEqual([]);
  const small = await page.locator("#tab-settings").evaluate((root) => [...root.querySelectorAll("button, select, input:not([type=checkbox]):not([type=radio])")]
    .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 40)
    .map((el) => el.id || el.textContent.trim()));
  expect(small).toEqual([]);
  const minFont = await page.locator("#tab-settings").evaluate((root) => {
    let min = 99;
    root.querySelectorAll("*").forEach((el) => {
      if (el.offsetParent !== null && el.textContent.trim()) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    });
    return min;
  });
  expect(minFont).toBeGreaterThanOrEqual(11);
  // §12.7: sizes from the brand's whitelist, computed.
  const size = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size("#setSwitch h2")).toBe("20px");
  expect(await size('label[for="set-time"]')).toBe("13px");
  expect(await size("#set-time")).toBe("16px");

  await shot(page, "s01-switch-390.png", "Settings at 390: the weekly switch", [
    { selector: "#setSwitch .chip", caption: "Off by default, in words" },
    { selector: "#setSwitchBtn", caption: "Turn on takes two taps" }
  ], { anchor: "#setSwitch" });
  await shot(page, "s02-schedule-390.png", "Settings at 390: the schedule", [
    { selector: '#setSchedule [data-live="schedule"]', caption: "The schedule in one line" },
    { selector: "#set-time", caption: "Drop time, Arizona" }
  ], { anchor: "#setSchedule" });
  await shot(page, "s03-caps-390.png", "Settings at 390: caps and what is used", [
    { selector: "#set-cap-month", caption: "Most one month can spend" },
    { selector: "#setSpent", caption: "Used this month, from the health read" }
  ], { anchor: "#setCaps" });
  await shot(page, "s04-funnel-390.png", "Settings at 390: a funnel's campaigns", [
    { selector: '[data-funnel="roadmap_147"] .camps li', caption: "7-day spend beside each campaign" },
    { selector: "#fn-roadmap_147-adset", caption: "Ad set picker waits for a campaign, with the reason" }
  ], { anchor: '[data-funnel="roadmap_147"] .camps' });
  // Save sits at the bottom right, pinned above the status strip, and clear
  // of the shell's round Chat button in the corner.
  const vp = page.viewportSize();
  const sb = await save(page).boundingBox();
  expect(sb.x + sb.width).toBeGreaterThan(vp.width - 100);
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height);
  await clearOfChat(page);
  await shot(page, "s05-save-390.png", "Settings at 390: Save, bottom right", [
    { selector: "#setSave", caption: "The one filled button: Save" },
    { selector: "#setSay", caption: "No changes to save, in words" }
  ]);
});

test("1280: the cards sit in an even grid, and Save is at the bottom right", async ({ page }) => {
  const { errors } = await open(page, {}, { width: 1280, height: 900 });
  await expect(page.locator("#setSwitch")).toBeVisible();
  await assertPageAlive(page, errors);
  const sched = await page.locator("#setSchedule").boundingBox();
  const caps = await page.locator("#setCaps").boundingBox();
  expect(Math.abs(sched.y - caps.y)).toBeLessThan(2);
  expect(Math.abs(sched.width - caps.width)).toBeLessThan(2);
  // The three short cards stack beside Schedule instead of stretching.
  const quiet = await page.locator("#setQuiet").boundingBox();
  expect(quiet.x).toBe(caps.x);
  expect(quiet.y).toBeGreaterThan(caps.y + caps.height);
  const sb = await save(page).boundingBox();
  const bar = await page.locator("#setSaveBar").boundingBox();
  expect(sb.x + sb.width).toBeGreaterThan(bar.x + bar.width - 100);
  await clearOfChat(page);
  await shot(page, "s06-settings-1280.png", "Settings at 1280", [
    { selector: "#setSwitch", caption: "The weekly switch, first" },
    { selector: '#setSchedule [data-live="schedule"]', caption: "Schedule, in one line" },
    { selector: "#setCaps", caption: "Model spend caps, with what is used" },
    { selector: "#setSave", caption: "Save, bottom right, clear of Chat" }
  ]);
});

/* ── saving ───────────────────────────────────────────────────────────────── */

test("Save sends only what changed, with a fresh request_id and the updated_at it read, and answers in words", async ({ page }) => {
  const { posts } = await open(page);
  await expect(page.locator("#set-time")).toHaveValue("07:00");
  await page.locator("#set-time").fill("06:30");
  await page.locator("#set-style-long").selectOption("bullets");
  await expect(page.locator("#setSay")).toHaveText("You have changes that are not saved.");
  await expect(page.locator('[data-live="schedule"]')).toHaveText("Every Monday at 6:30 AM Arizona time: 21 scripts.");
  await expect(save(page)).toBeEnabled();
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts.settings).toHaveLength(1);
  const sent = posts.settings[0];
  assertRequestMatchesContract("POST marketing/settings", sent);
  expect(sent.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(sent.updated_at).toBe("2026-10-12T15:00:00.000Z");
  expect(sent.patch).toEqual({ batch_time: "06:30", format_style: { long: "bullets" } });
  expect(posts.funnels).toHaveLength(0);
  await expect(save(page)).toBeDisabled();
  await expect(page.locator("#set-time")).toHaveValue("06:30");
  await shot(page, "s07-saved-390.png", "Saved, in words", [
    { selector: "#setSay", caption: "Saved 8:04 AM" }
  ]);

  // A second save reads the new updated_at and gets a new request_id.
  await page.locator("#set-per-day").fill("4");
  await expect(page.locator('[data-live="schedule"]')).toHaveText("Every Monday at 6:30 AM Arizona time: 28 scripts.");
  await expect(page.locator('[data-live="rule-total"]')).toHaveText("4 a day in total");
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts.settings).toHaveLength(2);
  expect(posts.settings[1].updated_at).toBe("2026-10-12T15:05:00.000Z");
  expect(posts.settings[1].request_id).not.toBe(sent.request_id);
  expect(posts.settings[1].patch).toEqual({ scripts_per_day: 4 });
  for (const p of posts.settings) expect(p.patch).not.toHaveProperty("enabled");
});

test("the weekly switch: off; turning it on takes two taps and names the caps; Not now sends nothing", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator("#setSwitchBtn").click();
  const ask = page.locator("#setSwitchAsk");
  await expect(ask).toContainText("Turn on weekly scripts?");
  await expect(ask).toContainText("Every Monday at 7:00 AM Arizona time the writer makes 21 scripts. It may spend up to $40 a batch and $300 a month on the writing model. It never spends ad money.");
  await shot(page, "s08-switch-confirm-390.png", "Turning weekly scripts on: the second tap names the caps", [
    { selector: "#setSwitchAsk p:nth-child(2)", caption: "The caps, in words" },
    { selector: '[data-act="switch-yes"]', caption: "Second tap: Yes, turn it on" }
  ], { anchor: "#setSwitch" });
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(ask).toHaveCount(0);
  expect(posts.settings).toHaveLength(0);

  await page.locator("#setSwitchBtn").click();
  await page.getByRole("button", { name: "Yes, turn it on" }).click();
  await expect(page.locator("#setSwitch .say")).toHaveText("Weekly scripts are on. Saved 8:04 AM.");
  await expect(page.locator("#setSwitch .chip")).toHaveText("On");
  expect(posts.settings).toHaveLength(1);
  expect(posts.settings[0].patch).toEqual({ enabled: true });
  expect(posts.settings[0].updated_at).toBe("2026-10-12T15:00:00.000Z");
  await expect(page.locator("#setSwitchBtn")).toHaveText("Turn off weekly scripts");

  // Turning it off names what happens too.
  await page.locator("#setSwitchBtn").click();
  await expect(page.locator("#setSwitchAsk")).toContainText("No new weekly batch starts. Nothing already written is lost.");
});

test("a 409 shows both versions; Keep mine saves over the newer one; Use the saved one drops mine", async ({ page }) => {
  const newer = { ...SETTINGS(), batch_time: "05:00", updated_at: "2026-10-12T15:02:00.000Z" };
  const stale = [{ error: "stale", message: "Someone saved this after you opened it.", current: newer }, 409];
  const { posts } = await open(page, { settingsPost: [stale] });
  await page.locator("#set-time").fill("06:30");
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Did not save. Someone saved Settings after you opened this page. Pick yours or the saved one above.");
  const row = page.locator("#setConflict tbody tr");
  await expect(row).toHaveCount(1);
  await expect(row.locator("th")).toHaveText("Drop time");
  await expect(row.locator("td").nth(0)).toHaveText("6:30 AM");
  await expect(row.locator("td").nth(1)).toHaveText("5:00 AM");
  // Save rests until Chris picks one: another tap would only meet the same 409.
  await expect(save(page)).toBeDisabled();
  await shot(page, "s09-conflict-390.png", "Someone saved first: both versions", [
    { selector: "#setConflict table", caption: "Yours and the saved one, side by side" },
    { selector: '[data-act="keep-mine"]', caption: "Keep mine" }
  ], { anchor: "#setConflict" });

  // Use the saved one: the box shows the saved time, nothing is sent.
  await page.getByRole("button", { name: "Use the saved one" }).click();
  await expect(page.locator("#set-time")).toHaveValue("05:00");
  await expect(page.locator("#setSay")).toHaveText("This page now shows the saved version. Nothing of yours was saved.");
  expect(posts.settings).toHaveLength(1);
});

test("Keep mine sends the same change again over the version that is saved now", async ({ page }) => {
  const newer = { ...SETTINGS(), batch_time: "05:00", updated_at: "2026-10-12T15:02:00.000Z" };
  const stale = [{ error: "stale", message: "Someone saved this after you opened it.", current: newer }, 409];
  const { posts } = await open(page, { settingsPost: [stale, [(sent) => ({ settings: { ...newer, ...sent.patch, updated_at: "2026-10-12T15:05:00.000Z" } }), 200]] });
  await page.locator("#set-time").fill("06:30");
  await save(page).click();
  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM. Your version is the saved one now.");
  expect(posts.settings).toHaveLength(2);
  expect(posts.settings[1].updated_at).toBe("2026-10-12T15:02:00.000Z");
  expect(posts.settings[1].patch).toEqual({ batch_time: "06:30" });
  expect(posts.settings[1].request_id).not.toBe(posts.settings[0].request_id);
  await expect(page.locator("#set-time")).toHaveValue("06:30");
});

test("a month cap under what is already spent warns before it saves", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator("#set-cap-month").fill("10");
  const warn = page.locator('[data-live="cap-warn"]');
  await expect(warn).toHaveText("This is below what is already spent this month ($12.48). Runs stop at once.");
  await save(page).click();
  expect(posts.settings).toHaveLength(0);
  await expect(page.locator("#setSay")).toHaveText("This is below what is already spent this month ($12.48). Runs stop at once. Tap Save anyway to keep it.");
  await expect(save(page)).toHaveText("Save anyway");
  await shot(page, "s10-cap-warning-390.png", "A month cap below what is spent warns first", [
    { selector: '[data-live="cap-warn"]', caption: "The warning, before anything saves" },
    { selector: "#setSave", caption: "Second tap: Save anyway" }
  ]);
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts.settings).toHaveLength(1);
  expect(posts.settings[0].patch).toEqual({ max_month_cost_usd: 10 });
});

test("a bad box is named in plain words and nothing is sent", async ({ page }) => {
  const { posts } = await open(page);
  await page.locator("#set-per-day").fill("0");
  await expect(page.locator('[data-live="schedule"]')).toHaveText("The schedule is not complete yet.");
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Did not save. Scripts a day must be a whole number, 1 or more.");
  await expect(page.locator("#set-per-day")).toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#set-per-day")).toHaveValue("0", { message: "the old value stays in the box" });
  expect(posts.settings).toHaveLength(0);
});

/* ── funnels ──────────────────────────────────────────────────────────────── */

test("funnels: link a campaign, pick its ad set, Save sends that funnel's change only", async ({ page }) => {
  const { posts } = await open(page);
  const road = page.locator('[data-funnel="roadmap_147"]');
  await road.locator('input[value="120210000000000001"]').check();
  await expect(page.locator("#fn-roadmap_147-adset")).toBeEnabled();
  await expect(road).not.toContainText("No Meta campaign is linked to this funnel");
  await page.locator("#fn-roadmap_147-adset").selectOption("120210000000000101");
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts.settings).toHaveLength(0);
  expect(posts.funnels).toHaveLength(1);
  const sent = posts.funnels[0];
  assertRequestMatchesContract("POST marketing/funnels", sent);
  expect(sent.request_id).toMatch(/^[0-9a-f-]{36}$/);
  expect(sent.funnel).toEqual({
    key: "roadmap_147",
    meta_campaign_ids: ["120210000000000001"],
    default_ad_set_external_id: "120210000000000101",
    updated_at: "2026-10-06T18:00:00.000Z"
  });
  // The other funnel now shows that campaign as taken, with the reason.
  const book = page.locator('[data-funnel="book_call"]');
  await expect(book.locator('input[value="120210000000000001"]')).toBeDisabled();
  await expect(book).toContainText("Linked to Roadmap $147.");
  await shot(page, "s11-funnel-linked-390.png", "A campaign linked, its ad set picked, saved", [
    { selector: '[data-funnel="roadmap_147"] .camps li', caption: "Roadmap ads, linked" },
    { selector: "#fn-roadmap_147-adset", caption: "The default ad set, from the linked campaign" }
  ], { height: 1200, anchor: "#fn-roadmap_147-block .camps" });
  await shot(page, "s11b-campaign-taken-390.png", "The same campaign on the other funnel", [
    { selector: '[data-funnel="book_call"] .camps li', caption: "Taken by Roadmap $147: disabled with the reason" }
  ], { anchor: '[data-funnel="book_call"] .camps' });
});

test("funnels: unticking a campaign clears its ad set; a funnel's other boxes save in words", async ({ page }) => {
  const mapped = FUNNELS();
  mapped.funnels[1] = exampleResponse("POST marketing/funnels").funnel;
  mapped.campaigns[0].funnel_key = "roadmap_147";
  const { posts } = await open(page, { funnels: [[mapped, 200]] });
  await expect(page.locator("#fn-roadmap_147-adset")).toHaveValue("120210000000000101");
  await page.locator('[data-funnel="roadmap_147"] input[value="120210000000000001"]').uncheck();
  await expect(page.locator("#fn-roadmap_147-adset")).toHaveValue("");
  await expect(page.locator("#fn-roadmap_147-adset")).toBeDisabled();
  await page.locator("#fn-book_call-weight").fill("2");
  await page.locator('[data-funnel="book_call"] [data-field="active"]').uncheck();
  await expect(page.locator('[data-funnel="book_call"] .funnel-hd .chip')).toHaveText("Not running");
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText("Saved 8:04 AM.");
  expect(posts.funnels.map((p) => p.funnel)).toEqual([
    { key: "book_call", weight: 2, active: false, updated_at: "2026-10-06T18:00:00.000Z" },
    { key: "roadmap_147", meta_campaign_ids: [], default_ad_set_external_id: null, updated_at: "2026-10-12T15:05:00.000Z" }
  ]);
});

test("funnels: a campaign already on another funnel is disabled with the reason", async ({ page }) => {
  const f = FUNNELS();
  f.funnels[0] = { ...f.funnels[0], meta_campaign_ids: ["120210000000000002"] };
  f.campaigns[1].funnel_key = "book_call";
  await open(page, { funnels: [[f, 200]] });
  const road = page.locator('[data-funnel="roadmap_147"]');
  await expect(road.locator('input[value="120210000000000002"]')).toBeDisabled();
  await expect(road.locator(".camps li").nth(1)).toContainText("Linked to Book a call.");
  await expect(page.locator('[data-funnel="book_call"] input[value="120210000000000002"]')).toBeChecked();
  await expect(page.locator('[data-funnel="book_call"] input[value="120210000000000002"]')).toBeEnabled();
});

test("funnels: a refused save says which funnel and why, in words; the rest still saves", async ({ page }) => {
  const refused = [{ error: "invalid", field: "funnel.meta_campaign_ids", message: "Campaign 1202 is already on book_call." }, 400];
  const { posts } = await open(page, { funnelsPost: [refused] });
  await page.locator("#set-days").fill("5");
  await page.locator('[data-funnel="roadmap_147"] input[value="120210000000000002"]').check();
  await save(page).click();
  await expect(page.locator("#setSay")).toHaveText(
    "Settings saved 8:04 AM. Roadmap $147 did not save. A campaign you picked is already linked to another funnel. Try again.");
  expect(posts.settings).toHaveLength(1);
  expect(posts.funnels).toHaveLength(1);
  // The unsaved tick stays, so Chris can fix it.
  await expect(page.locator('[data-funnel="roadmap_147"] input[value="120210000000000002"]')).toBeChecked();
  await expect(page.locator("#setSay")).not.toContainText(/400|invalid|book_call/);
});

/* ── a part that fails ────────────────────────────────────────────────────── */

test("a part that does not load says so in words; the rest of the tab stays", async ({ page }) => {
  const notLive = [{ error: "not_ready", message: "Marketing settings is built, but its database table is not live yet." }, 503];
  const { errors } = await open(page, { settings: [notLive], health: [[{ ok: false, error: "boom" }, 500]] });
  await expect(page.locator("#setProblem")).toContainText(
    "The settings did not load. This part is built but not live yet. It turns on with the next update. The rest of this page is current.");
  await expect(page.locator("#setFunnels fieldset.funnel")).toHaveCount(2);
  await assertPageAlive(page, errors);
  const text = await page.locator("#tab-settings").innerText();
  expect(text).not.toMatch(/\b(500|503)\b|not_ready|boom/);
  await shot(page, "s12-settings-not-live-390.png", "One part failed; the funnels still show", [
    { selector: "#setProblem p", caption: "What failed, in plain words" },
    { selector: '[data-act="reload"]', caption: "Try again" }
  ], { anchor: "#setProblem" });
});

test("the funnels fail, the settings stay; Try again reads them again", async ({ page }) => {
  const posts = { settings: [], funnels: [] };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  let calls = 0;
  const h = api({ posts });
  h["/api/marketing/funnels"] = async (route) => {
    calls += 1;
    if (calls === 1) return json(route, { ok: false, error: "boom" }, 500);
    return json(route, FUNNELS());
  };
  await wireApi(page, OWNER, h);
  await page.goto(PAGE);
  await expect(page.locator("#setFunnels")).toContainText("The funnels did not load. The server had a problem. The rest of this page is current.");
  await expect(page.locator("#setSwitch")).toBeVisible();
  await page.locator('#setFunnels [data-act="reload"]').click();
  await expect(page.locator("#setFunnels fieldset.funnel")).toHaveCount(2);
});
