// The Blueprint dashboard inside the slides (visual C), clicked in a real
// browser. The harness page (e2e/fixtures/present-blueprint-demo-harness.html)
// stands in for the client half of present.html; the static server hands over
// the brand css and the visual's own file from public/. No backend: the
// harness is served by page.route() from the fixtures folder, and the ctx is
// put on the window before the page loads.
//
// Run: E2E_PORT=4941 npx playwright test e2e/present-blueprint-demo.spec.mjs
//
// It checks the slide at 1440 and 390 wide, taps the whole journey, opens a
// reminder, and saves screenshots to
// ops/workflows/build-evidence/slides-refresh-2026-10-29/blueprint-demo/.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL, SAMPLE, NONE, BANNED } from "./fixtures/present-blueprint-demo-ctx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = fs.readFileSync(path.join(HERE, "fixtures", "present-blueprint-demo-harness.html"), "utf8");
const OUT = path.resolve(HERE, "..", "ops/workflows/build-evidence/slides-refresh-2026-10-29/blueprint-demo");
fs.mkdirSync(OUT, { recursive: true });

const FIXTURES = { full: FULL, sample: SAMPLE, none: NONE };
const ROOT = '[data-fhv="blueprint-demo"]';

test.describe.configure({ timeout: 60_000 });

async function open(page, fx, { width, height }) {
  await page.setViewportSize({ width, height });
  await page.addInitScript((f) => { window.FHV_FIXTURES = f; }, FIXTURES);
  await page.route("**/e2e-harness/present-blueprint-demo.html**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HARNESS }));
  await page.goto(`/e2e-harness/present-blueprint-demo.html?fx=${fx}`);
  await page.waitForSelector(ROOT);
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false });
const next = (page) => page.locator('[data-bd-act="next"]').click();
const rootText = (page) => page.locator(ROOT).innerText();

/* No sideways scroll: the page and the visual's own root are no wider than the window. */
async function expectNoSidewaysScroll(page, width) {
  const widths = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    return { doc: document.documentElement.scrollWidth, root: root.scrollWidth, rootBox: root.getBoundingClientRect().width };
  }, ROOT);
  expect(widths.doc).toBeLessThanOrEqual(width);
  expect(widths.root).toBeLessThanOrEqual(Math.ceil(widths.rootBox) + 1);
}

/* Every visible button is a real tap target: 44px tall, 44px wide. */
async function expectTapTargets(page) {
  const sizes = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel + " button"))
    .filter((b) => b.offsetParent !== null)
    .map((b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, label: (b.textContent || "").trim().slice(0, 30) }; }), ROOT);
  expect(sizes.length).toBeGreaterThan(3);
  for (const s of sizes) {
    expect(s.h, `${s.label} height`).toBeGreaterThanOrEqual(44);
    expect(s.w, `${s.label} width`).toBeGreaterThanOrEqual(44);
  }
}

/* The type floors: body text 16px, captions and eyebrows 13px. */
async function expectTypeFloors(page) {
  const sizes = await page.evaluate((sel) => {
    const px = (el) => parseFloat(getComputedStyle(el).fontSize);
    const q = (s) => Array.from(document.querySelectorAll(sel + " " + s)).filter((el) => el.offsetParent !== null);
    return {
      body: q(".fhv-blueprint-demo-body, .fhv-blueprint-demo-wptitle, .fhv-blueprint-demo-railbtn, .fhv-blueprint-demo-nextbtn, .fhv-blueprint-demo-creditor").map(px),
      caption: q(".fhv-blueprint-demo-caption, .fhv-blueprint-demo-eyebrow, .fhv-blueprint-demo-badge, .fhv-blueprint-demo-when").map(px)
    };
  }, ROOT);
  expect(sizes.body.length).toBeGreaterThan(0);
  for (const s of sizes.body) expect(s).toBeGreaterThanOrEqual(16);
  for (const s of sizes.caption) expect(s).toBeGreaterThanOrEqual(13);
}

test("1440: the full file walks the journey, screen by screen", async ({ page }) => {
  await open(page, "full", { width: 1440, height: 900 });
  const root = page.locator(ROOT);

  await expect(root).toContainText("Your plan, step by step. A preview built from today’s pull.");
  await expect(root).toContainText("$64,000");
  await expect(root).toContainText("Step 1 of 9: Print and mail your dispute letters");
  await expect(root).toContainText("Do not open new credit while we work on your file.");
  await expect(root).not.toContainText("Sample");
  await expectTapTargets(page);
  await expectTypeFloors(page);
  await shot(page, "full-1440-01-home");

  // The style is on the page exactly once, even after the deck re-renders.
  await page.evaluate(() => window.FHV_RENDER());
  expect(await page.locator("style#fhv-blueprint-demo-style").count()).toBe(1);

  // Progress: the checklist in due order.
  await page.locator('[data-bd-act="panel:progress"]').click();
  await expect(root).toContainText("Your checklist");
  await expect(root).toContainText("Pay Capital One Quicksilver down to $1,600");
  await expect(root).toContainText("Upload bureau responses when they arrive");
  await shot(page, "full-1440-02-progress");

  // A task opens the phone with the four reminders.
  await page.locator('[data-bd-act="task:card0"]').click();
  await expect(root).toContainText("The reminders you get");
  await expect(root).toContainText("Day 30 · text");
  await expect(root).toContainText("Day 32 · email");
  await expect(root).toContainText("Day 35 · text");
  await expect(root).toContainText("Day 39 · the Fundhub team");
  await expect(root).not.toContainText("CSM");
  await shot(page, "full-1440-03-reminder-phone");
  await page.locator('[data-bd-act="close"]').click();

  // Money, Credit: the cards and the items before anything is done.
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("$9,100");
  await expect(root).toContainText("57% used");
  await expect(root).toContainText("On your file");
  await shot(page, "full-1440-04-money-credit-before");

  // Walk: letters, proof, both cards.
  await next(page);
  await expect(root).toContainText("Disputed");
  await next(page);
  await next(page);
  await next(page);
  await expect(root).toContainText("10% used");
  await expect(root).toContainText("At target");
  // The bar dropped to the target: the fill is at the 10% mark.
  const fillWidth = await page.evaluate(() => {
    const bar = document.querySelector(".fhv-blueprint-demo-bar");
    const fill = bar.querySelector(".fhv-blueprint-demo-fill");
    return fill.getBoundingClientRect().width / bar.getBoundingClientRect().width;
  });
  expect(fillWidth).toBeLessThan(0.2);
  await shot(page, "full-1440-05-money-credit-cards-at-target");

  // The amount climbed through the paydown lever, and it says projects to.
  await page.locator('[data-bd-act="panel:home"]').click();
  await expect(root).toContainText("$88,000");
  await expect(root).toContainText("Projects to");
  await expect(root).toContainText("Step 5 of 9: Set up your business");
  await shot(page, "full-1440-06-home-after-paydown");

  // Business, then the bureaus answer.
  await next(page);
  await next(page);
  await expect(root).toContainText("$121,000");
  await page.locator('[data-bd-act="panel:money"]').click();
  await page.locator('[data-bd-act="tab:credit"]').click();
  await expect(root).toContainText("Bureau answered");
  await expect(root).toContainText("If it comes off");
  await shot(page, "full-1440-07-money-credit-bureau-answered");

  await page.locator('[data-bd-act="tab:fundability"]').click();
  await expect(root).toContainText("5");
  await expect(root).toContainText("of 6");
  await expect(root).toContainText("Today 2 of 6. Projects to 5 of 6");
  await shot(page, "full-1440-08-money-fundability");

  await page.locator('[data-bd-act="tab:strategy"]').click();
  await expect(root).toContainText("You said you have $6,000 on hand");
  await shot(page, "full-1440-09-money-strategy");

  await page.locator('[data-bd-act="tab:banks"]').click();
  await expect(root).toContainText("Personal file");
  await expect(root).toContainText("The lender list");
  await shot(page, "full-1440-10-money-banks");

  // Business 1, Business 2, the next sequence, then the last screen.
  await next(page);
  await next(page);
  await next(page);
  await page.locator('[data-bd-act="panel:home"]').click();
  await expect(root).toContainText("Your next 12 months");
  await expect(root).toContainText("You said this changes: “I stop turning down loads I cannot haul.”");
  await expect(root).toContainText("If you add a company · projects to $44,000 in year 1");
  await expect(root).toContainText("Next funding sequence");
  await expect(page.locator('[data-bd-act="restart"]')).toHaveText("Start over");
  await shot(page, "full-1440-11-next-12-months");

  // No banned word on the last screen either.
  const t = await rootText(page);
  for (const word of BANNED) {
    const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
    expect(t, `"${word}" appeared`).not.toMatch(re);
  }

  // Start over.
  await page.locator('[data-bd-act="restart"]').click();
  await expect(root).toContainText("Step 1 of 9");
  await expect(root).toContainText("$64,000");
});

test("390: one column, no sideways scroll, real tap targets", async ({ page }) => {
  await open(page, "full", { width: 390, height: 844 });
  const root = page.locator(ROOT);
  await expect(root).toContainText("$64,000");
  await expectNoSidewaysScroll(page, 390);
  await expectTapTargets(page);
  await expectTypeFloors(page);
  // The rail stacks above the panel on a phone.
  const stacked = await page.evaluate(() => {
    const rail = document.querySelector(".fhv-blueprint-demo-rail").getBoundingClientRect();
    const panel = document.querySelector(".fhv-blueprint-demo-panel").getBoundingClientRect();
    return rail.bottom <= panel.top + 1;
  });
  expect(stacked).toBe(true);
  await shot(page, "full-390-01-home");

  await page.locator('[data-bd-act="panel:progress"]').click();
  await expectNoSidewaysScroll(page, 390);
  await shot(page, "full-390-02-progress");

  await page.locator('[data-bd-act="task:mail"]').click();
  await expect(root).toContainText("Day 14 · text");
  await expectNoSidewaysScroll(page, 390);
  await shot(page, "full-390-03-reminder-phone");
  await page.locator('[data-bd-act="close"]').click();

  await page.locator('[data-bd-act="panel:money"]').click();
  await expectNoSidewaysScroll(page, 390);
  await expectTapTargets(page);
  await shot(page, "full-390-04-money-credit");

  for (let i = 0; i < 9; i++) await next(page);
  await page.locator('[data-bd-act="panel:home"]').click();
  await expect(root).toContainText("Your next 12 months");
  await expectNoSidewaysScroll(page, 390);
  await shot(page, "full-390-05-next-12-months");
});

test("the sample is tagged and uses the roadmap sample's amounts", async ({ page }) => {
  await open(page, "sample", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  await expect(root.locator(".fhv-blueprint-demo-tag")).toHaveText("Sample");
  await expect(root).toContainText("$199,350");
  await expect(root).toContainText("Projects to $221,500");
  await shot(page, "sample-1440-01-home");
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("American Express Blue Business Cash");
  await expect(root).toContainText("$4,800");
  await expect(root).toContainText("No negative items on this pull.");
  await shot(page, "sample-1440-02-money-credit");
});

test("no pull yet: the plan shows with no amount anywhere", async ({ page }) => {
  await open(page, "none", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  await expect(root).toContainText("No pull yet.");
  await expect(root).toContainText("Fills in from today’s pull.");
  expect(await rootText(page)).not.toContain("$");
  await shot(page, "none-1440-01-home");
  await page.locator('[data-bd-act="panel:progress"]').click();
  await expect(root).toContainText("Pay each card down to 10% of its limit");
  expect(await rootText(page)).not.toContain("$");
  await shot(page, "none-1440-02-progress");
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("Your cards fill in from today’s pull.");
  expect(await rootText(page)).not.toContain("$");
  await page.locator('[data-bd-act="tab:fundability"]').click();
  expect(await rootText(page)).not.toContain("$");
  await shot(page, "none-1440-03-money");
});
