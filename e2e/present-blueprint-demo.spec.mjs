// The Blueprint dashboard inside the slides (visual C), clicked in a real
// browser. The harness page (e2e/fixtures/present-blueprint-demo-harness.html)
// stands in for the client half of present.html; the static server hands over
// the brand css and the visual's own file from public/. No backend: the
// harness is served by page.route() from the fixtures folder, and the ctx is
// put on the window before the page loads.
//
// Run: E2E_PORT=4962 npx playwright test e2e/present-blueprint-demo.spec.mjs
//
// It checks the slide at 1440 and 390 wide, taps the whole journey, opens a
// reminder, and saves screenshots to
// ops/workflows/build-evidence/slides-refresh-2026-10-29/design-pass/blueprint-demo/.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FULL, SAMPLE, REPAIR, HOLD, NONE, BANNED, THRESHOLD_LABEL } from "./fixtures/present-blueprint-demo-ctx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = fs.readFileSync(path.join(HERE, "fixtures", "present-blueprint-demo-harness.html"), "utf8");
const OUT = path.resolve(HERE, "..", "ops/workflows/build-evidence/slides-refresh-2026-10-29/design-pass/blueprint-demo");
fs.mkdirSync(OUT, { recursive: true });

const FIXTURES = { full: FULL, sample: SAMPLE, repair: REPAIR, hold: HOLD, none: NONE };
/* The visible words with the engine's "$5,000+ limit" check threshold taken out,
   so a "no dollar figure" check reads only client amounts. */
const amounts = (t) => t.split(THRESHOLD_LABEL).join("");
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

/* Numbers count up after a tap; a count that is still moving carries data-bd-busy.
   Every check and every screenshot waits for the last frame. */
const settled = (page) => page.waitForFunction(() => !document.querySelector("[data-bd-busy]"));
const shot = async (page, name) => { await settled(page); await page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: false }); };
const next = (page) => page.locator('[data-bd-act="build"]').click();
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
  await expect(root.locator(".fhv-blueprint-demo-hero")).toContainText("Today");
  await expect(root).toContainText("Step 1 of 9: Pay Capital One Quicksilver down to $1,600");
  expect(await root.locator('[data-bd-act^="goto:"]').count()).toBe(5);
  await expect(root).toContainText("Do not open new credit while we work on your file.");
  // The hero amount is set in the deck's sans, not the mono face.
  const heroFont = await page.evaluate(() => getComputedStyle(document.querySelector(".fhv-blueprint-demo-big")).fontFamily);
  expect(heroFont).not.toMatch(/JetBrains Mono|monospace/);
  await expect(root).not.toContainText("Sample");
  await expectTapTargets(page);
  await expectTypeFloors(page);
  await shot(page, "full-1440-01-home");

  // The style is on the page exactly once, even after the deck re-renders.
  await page.evaluate(() => window.FHV_RENDER());
  expect(await page.locator("style#fhv-blueprint-demo-style").count()).toBe(1);

  // Progress: the full checklist in the owner's paydown-first order.
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

  // Build one: both cards are paid down first. The items remain on the file.
  await next(page);
  await expect(root).toContainText("On your file");
  await settled(page);
  // Every card's words, bar and badge agree: both cards sit at their targets.
  await expect(root).toContainText("$1,600 of $16,000");
  await expect(root).toContainText("$900 of $9,000");
  await expect(root).not.toContainText("$9,100");
  await expect(root).not.toContainText("$3,300");
  await expect(root).not.toContainText("57% used");
  await expect(root).not.toContainText("37% used");
  expect(await root.locator(".fhv-blueprint-demo-badge-ok", { hasText: "At target" }).count()).toBe(2);
  expect(await root.locator(".fhv-blueprint-demo-badge-warn", { hasText: "Pay down" }).count()).toBe(0);
  // The bars dropped to the target mark (the fill width transitions, so poll).
  await expect.poll(async () => page.evaluate(() => Array.from(document.querySelectorAll(".fhv-blueprint-demo-bar")).map((bar) =>
    bar.querySelector(".fhv-blueprint-demo-fill").getBoundingClientRect().width / bar.getBoundingClientRect().width)), { timeout: 4000 })
    .toEqual([expect.closeTo(0.1, 1), expect.closeTo(0.1, 1)]);
  await shot(page, "full-1440-05-money-credit-cards-at-target");

  // The amount climbed to the paydown lever's figure, with plain words for what changed.
  await page.locator('[data-bd-act="panel:home"]').click();
  await settled(page);
  const hero = root.locator(".fhv-blueprint-demo-hero");
  await expect(hero).toContainText("$88,000");
  await expect(hero).toContainText("After the cards are paid down.");
  await expect(hero).toContainText("Fully optimized: projects to $121,000.");
  await expect(hero).not.toContainText("Today");
  expect(((await hero.innerText()).match(/projects to/gi) || []).length).toBe(1);
  await expect(root).toContainText("Step 3 of 9: Print and mail your dispute letters");
  await shot(page, "full-1440-06-home-after-paydown");

  // Build two: the dispute steps and bureau answer show the clean lever's figure.
  await next(page);
  await settled(page);
  await expect(hero).toContainText("$121,000");
  await expect(hero).toContainText("If the disputed items come off.");
  await expect(hero).not.toContainText("Today");
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

  // Builds three through five: Business 1, Business 2, the next sequence.
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

  for (let i = 0; i < 5; i++) await next(page);
  await page.locator('[data-bd-act="panel:home"]').click();
  await expect(root).toContainText("Your next 12 months");
  await expectNoSidewaysScroll(page, 390);
  await shot(page, "full-390-05-next-12-months");
});

test("the sample is tagged and uses the engine's amounts for the deck's sample file", async ({ page }) => {
  await open(page, "sample", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  await expect(root.locator(".fhv-blueprint-demo-tag")).toHaveText("Sample");
  await expect(root).toContainText("$24,749");
  await expect(root).toContainText("Fully optimized: projects to $55,000.");
  await shot(page, "sample-1440-01-home");
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("First Platypus Bank Visa");
  await expect(root).toContainText("$3,142 of $8,000");
  await expect(root).toContainText("Toyota Motor Credit");
  await shot(page, "sample-1440-02-money-credit");
  // No fundability count on a real file: the six checks carry the tab.
  await page.locator('[data-bd-act="tab:fundability"]').click();
  await expect(root).toContainText("Six checks. Every step works on one.");
  await expect(root).toContainText("0 of 1 card at target.");
  await expect(root).not.toContainText("of 6");
  await shot(page, "sample-1440-03-money-fundability-no-count");
});

test("a repair-only file shows $0 today and climbs when the bureaus answer", async ({ page }) => {
  await open(page, "repair", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  const hero = root.locator(".fhv-blueprint-demo-hero");
  await expect(hero).toContainText("$0");
  await expect(hero).toContainText("Today");
  await expect(hero).toContainText("Fully optimized: projects to $41,000.");
  await shot(page, "repair-1440-01-home");
  for (let i = 0; i < 2; i++) await next(page); // paydown, then dispute steps and bureau answers
  await settled(page);
  await expect(hero).toContainText("$41,000");
  await expect(hero).toContainText("If the disputed items come off.");
  await expect(hero).not.toContainText("Today");
  await shot(page, "repair-1440-02-home-after-bureaus");
});

test("when the engine holds the money, no qualify amount shows and the cards still work", async ({ page }) => {
  await open(page, "hold", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  await expect(root).toContainText("UnderwriteIQ has not printed an amount for this pull.");
  expect(await root.locator(".fhv-blueprint-demo-hero").count()).toBe(0);
  await shot(page, "hold-1440-01-home");
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("$5,100 of $12,000");
  await expect(root).toContainText("LVNV Funding");
  await shot(page, "hold-1440-02-money-credit");
  for (let i = 0; i < 5; i++) await next(page);
  await page.locator('[data-bd-act="panel:home"]').click();
  await expect(root).toContainText("Your next 12 months");
  expect(await root.locator(".fhv-blueprint-demo-hero").count()).toBe(0);
  expect(amounts(await rootText(page))).not.toMatch(/projects to \$/);
  await shot(page, "hold-1440-03-next-12-months");
});

test("no pull yet: the plan shows with no amount anywhere", async ({ page }) => {
  await open(page, "none", { width: 1440, height: 900 });
  const root = page.locator(ROOT);
  await expect(root).toContainText("No pull yet.");
  await expect(root).toContainText("Fills in from today’s pull.");
  expect(amounts(await rootText(page))).not.toContain("$");
  await shot(page, "none-1440-01-home");
  await page.locator('[data-bd-act="panel:progress"]').click();
  await expect(root).toContainText("Pay each card down to 10% of its limit");
  expect(amounts(await rootText(page))).not.toContain("$");
  await shot(page, "none-1440-02-progress");
  await page.locator('[data-bd-act="panel:money"]').click();
  await expect(root).toContainText("Your cards fill in from today’s pull.");
  expect(amounts(await rootText(page))).not.toContain("$");
  await page.locator('[data-bd-act="tab:fundability"]').click();
  await expect(root).toContainText("Six checks. Every step works on one.");
  expect(amounts(await rootText(page))).not.toContain("$");
  await shot(page, "none-1440-03-money");
});
