// "Build the avatar" on the Today page's flywheel step-1 row, in a real browser, offline.
// Unit X1 (design docs/specs/command-center-design-2026-10-05.md §6 slice 5a, §3.2 row 1).
//
// e2e/static-server.mjs serves public/; page.route() answers /api/** the way the X1 back
// ends answer (GET marketing/flywheel, GET marketing/costs, POST marketing/flywheel/run,
// GET marketing/flywheel/job). Nothing is sent anywhere.
//
// Proves: the block sits under step 1 with the server's cost line; the tap opens the cost
// sheet first (cost before every tap, §5 rule 3); Start building sends campaign, stage 1,
// a request_id and the typed "What we sell"; the row answers in words and shows the
// running step; the button is disabled WITH its reason while a run goes; a stopped run
// offers Retry with the run's id; 390px: no sideways scroll, 44px taps.
// Screenshots go to the system temp folder only (evidence folders are not tracked).

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER, json, wireApi, withSession, trackErrors, assertPageAlive } from "./harness.mjs";
import { exampleResponse } from "../src/marketing/api-contract.mjs";

const OUT = path.join(os.tmpdir(), "x1-avatar-row");
fs.mkdirSync(OUT, { recursive: true });
const PAGE = "/app/marketing-command-center.html";
const NOW = "2026-10-06T19:00:00Z";
const HOUSE = "11111111-2222-4333-8444-555555555555";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const STAGES = [
  { n: 1, key: "avatar", label: "avatar", state: "READY", approved: true, status: "ready approved", why: "133 quotes", reasons: [] },
  { n: 2, key: "ad-research", label: "ad research", state: "READY", approved: false, status: "ready not reviewed", why: "8 ads", reasons: [] },
  { n: 3, key: "offer", label: "offer", state: "FAILED", approved: false, status: "FAILED", why: "did not report guarantees", reasons: ["did not report guarantees"] },
  { n: 4, key: "copy", label: "copy", state: "FAILED", approved: false, status: "FAILED", why: "did not report distinctReasons", reasons: ["did not report distinctReasons"] },
  { n: 5, key: "ad-strategy", label: "ad strategy", state: "BLOCKED", approved: false, status: "BLOCKED", why: "waiting on offer and copy", reasons: ["waiting on offer and copy"] },
  { n: 6, key: "spend", label: "spend", state: "MISSING", approved: false, status: "MISSING", why: "has not been run yet", reasons: ["has not been run yet"] }
];

const TODAY = {
  ok: true, as_of: NOW, today: "2026-10-06", timezone: "America/Phoenix", waiting: [],
  flywheel: { campaigns: [{ campaign: "partner", stages: STAGES, advice: null }] },
  copy: { partner_id: HOUSE, pieces: [], jobs: [] },
  copy_ready: { ready: true, partner_id: HOUSE, checks: [], missing: [] },
  spend: { currency: "USD", windows: {
    today: { from: "2026-10-06", to: "2026-10-06", days: 1, spend_cents: 0, ad_days: 0, days_with_data: 0 },
    last_7_days: { from: "2026-09-30", to: "2026-10-06", days: 7, spend_cents: 60653, ad_days: 30, days_with_data: 7 },
    prior_7_days: { from: "2026-09-23", to: "2026-09-29", days: 7, spend_cents: 30893, ad_days: 30, days_with_data: 7 },
    last_30_days: { from: "2026-09-07", to: "2026-10-06", days: 30, spend_cents: 91546, ad_days: 60, days_with_data: 20 }
  } },
  last_sync: { meta_synced_at: "2026-10-06T07:01:00Z", metrics_synced_at: "2026-10-06T07:01:30Z", latest_metrics_date: "2026-10-05" }
};

const COST_LINE = "Cost: unknown, not measured yet. This run stops by itself at $20 (the cap is in Settings). $12.50 of $300 used this month. Web searches cost 1 cent each (Anthropic: $10 per 1,000). This run makes at most 184 searches, so at most $1.84 of it is search.";

const fw = (run) => ({
  ok: true, campaign: "partner", campaign_words: "Partner offer",
  service_description_default: "The Fundhub $10,000 white-label partnership: brokers run a funding company under their own brand.",
  owner_notes_stage_1: "2026-08-31 | stage 1 | the avatar is assumed on purpose.",
  stages: [{ n: 1, key: "avatar", label_words: "Who we sell to", sentence: "Done. 133 quotes. Approved.", run }],
  advice: null
});

const RUNNING = {
  id: "aaaaaaaa-0000-4000-8000-000000000001", status: "queued", step: "foundation",
  sentence: "Running: step 1 of 10, writing down the business facts. $0 spent so far, 0 searches."
};

function handlers({ run = null, posts = [] } = {}) {
  let current = run;
  return {
    "/api/marketing/today": (route) => json(route, TODAY),
    "/api/marketing/offer/generate": (route) => json(route, { ok: true, ready: true, job: null, offer: null }),
    "/api/marketing/costs": (route) => json(route, { ok: true, kinds: { avatar: null }, avatar_line: COST_LINE }),
    "/api/marketing/flywheel/run": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      posts.push(body);
      current = { ...RUNNING, id: body.retry_job_id || RUNNING.id };
      return json(route, { ok: true, started: true, already_running: false, ...(body.retry_job_id ? { retried: true } : {}), job: current, poll: "/api/marketing/flywheel/job?id=" + current.id }, 202);
    },
    "/api/marketing/flywheel/job": (route) => json(route, { ok: true, job: { ...current, status: "running", sentence: "Running: step 3 of 10, searching the web for buyer quotes, round 1. 0 new quotes so far. $0.06 spent so far, 15 searches." } }),
    "/api/marketing/flywheel": (route) => json(route, fw(current))
  };
}

async function open(page, h) {
  const errors = trackErrors(page);
  await withSession(page, OWNER);
  await wireApi(page, OWNER, h);
  await page.goto(PAGE);
  return errors;
}

const ACT = 'li.row[data-stage="avatar"] [data-avatar-act]';

test("step 1's row: the cost line, the sheet before the tap, the run starts and answers in words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const posts = [];
  const errors = await open(page, handlers({ posts }));
  const act = page.locator(ACT);
  await expect(act).toBeVisible();
  await expect(act).toContainText("Cost: unknown, not measured yet. This run stops by itself at $20");
  await expect(act.getByRole("button", { name: "Build the avatar" })).toBeEnabled();
  await page.screenshot({ path: path.join(OUT, "01-row-1280.png") });

  await act.getByRole("button", { name: "Build the avatar" }).click();
  const sheet = page.locator("dialog.av-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText("Build the avatar for Partner offer?");
  await expect(sheet).toContainText("at most 184 searches");
  await expect(sheet).toContainText("the avatar is assumed on purpose");
  await expect(sheet.locator("#avService")).toHaveValue(/white-label partnership/);
  await page.screenshot({ path: path.join(OUT, "02-sheet-1280.png") });
  await sheet.locator("#avService").fill("Funding, done for you, for brokers.");
  await sheet.getByRole("button", { name: "Start building" }).click();

  await expect(page.locator(ACT)).toContainText("Started. It runs on the server in 10 steps");
  await expect(page.locator(ACT)).toContainText("Running: step 1 of 10");
  await expect(page.locator(ACT).getByRole("button", { name: "Build the avatar" })).toBeDisabled();
  await expect(page.locator(ACT)).toContainText("It is running now. This row shows each step as it goes.");
  expect(posts).toHaveLength(1);
  expect(posts[0].campaign).toBe("partner");
  expect(posts[0].stage).toBe(1);
  expect(posts[0].service_description).toBe("Funding, done for you, for brokers.");
  expect(posts[0].request_id).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  await assertPageAlive(page, errors);
  await page.screenshot({ path: path.join(OUT, "03-running-1280.png") });
});

test("Not now on the sheet sends nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const posts = [];
  await open(page, handlers({ posts }));
  await page.locator(ACT).getByRole("button", { name: "Build the avatar" }).click();
  await page.locator("dialog.av-sheet").getByRole("button", { name: "Not now" }).click();
  await expect(page.locator("dialog.av-sheet")).toHaveCount(0);
  expect(posts).toHaveLength(0);
});

test("a run stopped at the cap: its sentence, and Retry sends the run's id", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const posts = [];
  const stopped = { id: "bbbbbbbb-0000-4000-8000-000000000002", status: "failed", stopped_at_cap: { cap: "run" },
    sentence: "Stopped at the $20 run cap after step 6. What it found so far is saved. Raise the cap in Settings and tap Retry to finish." };
  await open(page, handlers({ run: stopped, posts }));
  await expect(page.locator(ACT)).toContainText("Stopped at the $20 run cap after step 6.");
  await page.locator(ACT).getByRole("button", { name: "Retry (keeps what it found)" }).click();
  await expect(page.locator(ACT)).toContainText("Running again from where it stopped.");
  expect(posts[0].retry_job_id).toBe(stopped.id);
});

test("phone, 390px: one column, no sideways scroll, 44px taps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers());
  const act = page.locator(ACT);
  await expect(act).toBeVisible();
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
  const btn = await act.getByRole("button", { name: "Build the avatar" }).boundingBox();
  expect(btn.height).toBeGreaterThanOrEqual(44);
  await act.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, "04-row-390.png") });
  await act.getByRole("button", { name: "Build the avatar" }).click();
  await expect(page.locator("dialog.av-sheet")).toBeVisible();
  const sheetWide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sheetWide).toBeLessThanOrEqual(390);
  await page.screenshot({ path: path.join(OUT, "05-sheet-390.png") });
});

// Wave 2b merge (U34's frame): Today is drawn by its tab script the first time it is
// shown. Opened straight on Settings, the row must still appear once Today is opened.
test("opened on Settings first: the row shows once Today is drawn", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = trackErrors(page);
  await withSession(page, OWNER);
  await wireApi(page, OWNER, {
    ...handlers(),
    "/api/marketing/settings": (route) => json(route, exampleResponse("GET marketing/settings")),
    "/api/marketing/funnels": (route) => json(route, exampleResponse("GET marketing/funnels")),
    "/api/marketing/health": (route) => json(route, exampleResponse("GET marketing/health"))
  });
  await page.goto(PAGE + "#settings");
  await expect(page.locator("#setSwitch")).toBeVisible();
  await expect(page.locator(ACT)).toHaveCount(0);
  await page.locator("#mccTabs .tab", { hasText: "Today" }).click();
  await expect(page).toHaveURL(/#today$/);
  await expect(page.locator(ACT)).toBeVisible();
  await expect(page.locator(ACT).getByRole("button", { name: "Build the avatar" })).toBeEnabled();
  await assertPageAlive(page, errors);
});
