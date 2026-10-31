// The W3 slide visuals (public/app/present-visuals.js) in a real browser, offline.
//
// The harness e2e/fixtures/present-visuals-harness.html stands in for the deck's
// slide frame and is served on the static server's origin through page.route(),
// next to /app/fundhub-brand.css and /app/present-visuals.js. The fixtures are
// e2e/fixtures/present-visuals-fixtures.js (the engine's own amounts, see its
// header). No backend, no session, nothing saved, sent or charged.
//
// It proves: at 1440 the visuals draw the file's own amounts; a closer can
// tap through the levers, the companies and the path and the numbers follow; at
// 390 everything stacks in one column with no sideways scroll, 16px body text,
// 13px captions and 44px taps; the no-data, sample, bad-data, mismatch, repair
// and revenue states draw. Screenshots land in
// ops/workflows/build-evidence/slides-refresh-2026-10-29/design-pass/visuals/.
//
// Run: E2E_PORT=4961 npx playwright test e2e/present-visuals.spec.mjs

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = fs.readFileSync(path.join(HERE, "fixtures", "present-visuals-harness.html"), "utf8");
const FIXTURES = fs.readFileSync(path.join(HERE, "fixtures", "present-visuals-fixtures.js"), "utf8");
const OUT = path.resolve(HERE, "../ops/workflows/build-evidence/slides-refresh-2026-10-29/design-pass/visuals");
fs.mkdirSync(OUT, { recursive: true });

// This Mac is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 90_000 });

async function open(page, { state = "full", width = 1440, height = 900, only = "" } = {}) {
  await page.setViewportSize({ width, height });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/e2e-fixtures/present-visuals-harness.html*", (r) =>
    r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HARNESS }));
  await page.route("**/e2e-fixtures/present-visuals-fixtures.js", (r) =>
    r.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: FIXTURES }));
  await page.goto(`/e2e-fixtures/present-visuals-harness.html?state=${state}${only ? "&only=" + only : ""}`);
  await page.waitForSelector("[data-fhv]");
  return errors;
}

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png"), fullPage: true });
const settle = (page) => page.waitForTimeout(900); // the count-up and the bars take 700 ms

const path_ = (page) => page.locator('[data-fhv="path"]');
const levers = (page) => page.locator('[data-fhv="levers"]');
const findings = (page) => page.locator('[data-fhv="findings"]');
const companies = (page) => page.locator('[data-fhv="companies"]');

test.describe("present visuals, 1440 wide", () => {
  test("the visuals draw the file's own amounts and the setter's words", async ({ page }) => {
    const errors = await open(page);
    await expect(path_(page)).toContainText("Your file today");
    await expect(path_(page)).toContainText("Your goal");
    await expect(path_(page).locator(".fhv-path-chip.is-door")).toHaveCount(2);
    await expect(path_(page)).toContainText("Two banks turned me down this year and never said why.");
    await expect(path_(page).locator(".fhv-path-goalamt")).toHaveText("$100k - $200k");

    await expect(levers(page).locator(".fhv-levers-headcell").first()).toContainText("$96,524");
    /* The climb starts at today with nothing applied (owner-set 2026-10-29), and
       the whole gap is on the table from the first frame. */
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num")).toHaveText("$96,524");
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt")).toContainText("Nothing applied yet");
    await expect(levers(page).locator(".fhv-levers-gap")).toContainText("$78,101 left on the table");
    await expect(levers(page).locator(".fhv-levers-outlinelabel")).toHaveText("$174,625");
    await expect(levers(page).locator(".fhv-levers-step")).toHaveCount(2);
    await expect(levers(page).locator('.fhv-levers-step[aria-pressed="true"]')).toHaveCount(0);
    await expect(levers(page).getByRole("button", { name: "Reset to today" })).toBeDisabled();
    await expect(levers(page).locator(".fhv-levers-tier")).toContainText("Funding plus repair");
    await expect(levers(page).locator(".fhv-levers-tier")).toContainText("Full funding");
    await expect(levers(page).locator(".fhv-levers-goallabel")).toContainText("$100k - $200k");

    await expect(companies(page).locator(".fhv-companies-headcell .fhv-ui-num").first()).toHaveText("$96,524");
    await expect(companies(page).locator(".fhv-companies-seg")).toHaveCount(3);
    await expect(companies(page).locator(".fhv-companies-seg.is-personal")).toContainText("$24,749");
    await expect(companies(page).locator(".fhv-companies-marklabel")).toHaveText("Today $96,524");
    await expect(companies(page).locator(".fhv-companies-proof")).toContainText("Chris's own result. Not a promise.");

    await settle(page);
    /* The goal band sits across the bars, inside the chart. */
    const chart = await levers(page).locator(".fhv-levers-bars").boundingBox();
    const goal = await levers(page).locator(".fhv-levers-goal").boundingBox();
    expect(goal.y).toBeGreaterThanOrEqual(chart.y - 1);
    expect(goal.y + goal.height).toBeLessThanOrEqual(chart.y + chart.height + 1);
    /* Nothing applied: the optimized fill sits at today's height, well under the
       dashed outline it will climb to. */
    const fill = await levers(page).locator(".fhv-levers-bar.is-opt").boundingBox();
    const outline = await levers(page).locator(".fhv-levers-outline").boundingBox();
    expect(fill.y).toBeGreaterThan(outline.y + 10);
    const todayBar = await levers(page).locator(".fhv-levers-bar.is-today").boundingBox();
    expect(Math.abs(todayBar.height - fill.height)).toBeLessThan(3);

    await shot(page, "full-1440");
    expect(errors).toEqual([]);
  });

  test("taps: the levers climb, the companies stack and age, a station opens", async ({ page }) => {
    const errors = await open(page);
    const optNum = levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num");
    const gap = levers(page).locator(".fhv-levers-gap");
    const reset = levers(page).getByRole("button", { name: "Reset to today" });

    /* levers: the closer builds the climb one tap at a time, and left on the
       table is the whole gap at every step (owner-set 2026-10-29). */
    await expect(optNum).toHaveText("$96,524");
    await expect(reset).toBeDisabled();
    await levers(page).getByRole("button", { name: /Pay the cards down/ }).click();
    await expect(optNum).toHaveText("$104,775");
    await expect(gap).toContainText("$78,101 left on the table");
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt")).toContainText("After lever 1 of 2.");
    await expect(levers(page).locator(".fhv-levers-step").nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(levers(page).locator(".fhv-levers-step").nth(1)).toHaveAttribute("aria-pressed", "false");
    await expect(reset).toBeEnabled();
    await settle(page);
    const fill1 = await levers(page).locator(".fhv-levers-bar.is-opt").boundingBox();
    const outline = await levers(page).locator(".fhv-levers-outline").boundingBox();
    expect(fill1.height).toBeLessThan(outline.height - 10);
    await shot(page, "levers-step1-1440");
    await levers(page).getByRole("button", { name: /Clean the file/ }).click();
    await expect(optNum).toHaveText("$174,625");
    await expect(gap).toContainText("$78,101 left on the table");
    await settle(page);
    const fill2 = await levers(page).locator(".fhv-levers-bar.is-opt").boundingBox();
    expect(fill2.height).toBeGreaterThan(fill1.height);
    /* With every lever on, the fill reaches the dashed outline (measured again
       here: the tap scrolled the slide, so the earlier box's y is stale). */
    const outline2 = await levers(page).locator(".fhv-levers-outline").boundingBox();
    expect(Math.abs(fill2.y - outline2.y)).toBeLessThan(3);
    await shot(page, "levers-step2-1440");
    await reset.click();
    await expect(optNum).toHaveText("$96,524");
    await expect(levers(page)).toContainText("Nothing applied yet");
    await expect(gap).toContainText("$78,101 left on the table");
    await expect(reset).toBeDisabled();

    /* companies */
    await companies(page).getByRole("button", { name: /Add a company/ }).click();
    await companies(page).getByRole("button", { name: /Add a company/ }).click();
    await expect(companies(page).locator(".fhv-companies-seg.is-added")).toHaveCount(2);
    await expect(companies(page)).toContainText("If you add 2 companies");
    await expect(companies(page).locator(".fhv-companies-headcell.is-added .fhv-ui-num")).toHaveText("+$55,000");
    await expect(companies(page).locator(".fhv-companies-headcell .fhv-ui-num").first()).toHaveText("$96,524");
    await expect(companies(page).locator(".fhv-companies-marklabel")).toHaveText("Today $96,524");
    await companies(page).getByRole("button", { name: /After 2 years/ }).click();
    await expect(companies(page).locator(".fhv-companies-headcell.is-added .fhv-ui-num")).toHaveText("+$220,000");
    await expect(companies(page).locator(".fhv-companies-headcell .fhv-ui-num").first()).toHaveText("$96,524");
    await settle(page);
    /* The added layers are outlined, and the Today marker sits where today's total ends. */
    const bar = await companies(page).locator(".fhv-companies-bar").boundingBox();
    const marker = await companies(page).locator(".fhv-companies-markline").boundingBox();
    const lastReal = await companies(page).locator(".fhv-companies-seg.is-biz").last().boundingBox();
    expect(Math.abs(marker.x - (lastReal.x + lastReal.width))).toBeLessThan(8);
    expect(marker.x).toBeLessThan(bar.x + bar.width * 0.6);
    await shot(page, "companies-added-after2-1440");
    await companies(page).getByRole("button", { name: /Business 2/ }).click();
    await expect(companies(page).locator(".fhv-companies-detail")).toContainText("Bright Mesa Marketing LLC: $12,375 today.");
    await expect(companies(page).locator(".fhv-companies-detail")).toContainText("First year");

    /* path */
    await path_(page).getByRole("button", { name: /Your plan/ }).click();
    await expect(path_(page).locator(".fhv-path-detail")).toContainText("Your plan");
    await expect(path_(page).locator(".fhv-path-detail")).toContainText("A written plan built from your own report");
    await expect(path_(page).locator(".fhv-path-station.is-open")).toContainText("Your plan");
    await shot(page, "path-plan-1440");
    expect(errors).toEqual([]);
  });

  test("no data yet, sample and bad data all draw without an error", async ({ page }) => {
    let errors = await open(page, { state: "nodata" });
    await expect(levers(page)).toContainText("No credit pull on this file yet");
    await expect(companies(page)).toContainText("No credit pull on this file yet");
    await expect(levers(page).locator(".fhv-ui-num")).toHaveCount(0);
    await expect(companies(page).locator(".fhv-ui-num")).toHaveCount(0);
    await expect(path_(page).locator(".fhv-path-chip.is-door")).toHaveCount(0);
    await shot(page, "nodata-1440");
    expect(errors).toEqual([]);

    errors = await open(page, { state: "sample" });
    await expect(page.locator(".fhv-ui-tag")).toHaveCount(4);
    await expect(page.locator(".fhv-ui-tag").first()).toHaveText("Sample");
    await settle(page);
    await shot(page, "sample-1440");
    expect(errors).toEqual([]);

    errors = await open(page, { state: "bad" });
    await expect(page.locator("[data-fhv]")).toHaveCount(4);
    await shot(page, "bad-1440");
    expect(errors).toEqual([]);
  });

  test("mismatched info: three reports side by side, marked with a word, no amount", async ({ page }) => {
    const errors = await open(page, { state: "mismatch" });
    await findings(page).locator('[data-fhv-act="findings:open:5"]').click();
    await expect(findings(page).locator(".fhv-levers-report")).toHaveCount(3);
    await expect(findings(page).locator(".fhv-levers-cell.is-diff").first()).toContainText("differs");
    await expect(findings(page)).toContainText("Banks approve you for less when your info doesn't match on every report.");
    const matchText = await findings(page).locator(".fhv-levers-match").innerText();
    expect(matchText).not.toMatch(/\$\d/);
    await expect(levers(page).locator(".fhv-levers-headcell").first()).toContainText("$7,936");
    const reports = await findings(page).locator(".fhv-levers-report").all();
    const boxes = await Promise.all(reports.map((r) => r.boundingBox()));
    expect(boxes[0].x).toBeLessThan(boxes[1].x);
    expect(boxes[1].x).toBeLessThan(boxes[2].x);
    await settle(page);
    await shot(page, "mismatch-1440");
    expect(errors).toEqual([]);
  });

  test("a repair-only file and the revenue side door", async ({ page }) => {
    let errors = await open(page, { state: "repair" });
    await expect(levers(page)).toContainText("One lever");
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num")).toHaveText("$0");
    await expect(levers(page).locator(".fhv-levers-gap")).toContainText("$8,250 left on the table");
    await levers(page).getByRole("button", { name: /Clean the file/ }).click();
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num")).toHaveText("$8,250");
    await expect(levers(page).locator(".fhv-levers-tier")).toContainText("Repair only");
    await expect(path_(page).locator(".fhv-path-station.is-lit")).toContainText("Your plan");
    await expect(companies(page)).toContainText("we can set it up for you");
    await settle(page);
    await shot(page, "repair-1440");
    expect(errors).toEqual([]);

    errors = await open(page, { state: "revenue", only: "path" });
    await expect(path_(page).locator(".fhv-path-side")).toContainText("Revenue funding");
    /* The path starts at its first station; the side door opens on a tap. */
    await expect(path_(page).locator(".fhv-path-detail")).toContainText("Your file today");
    await path_(page).getByRole("button", { name: /Revenue funding/ }).click();
    await expect(path_(page).locator(".fhv-path-detail")).toContainText("bank statements");
    await shot(page, "revenue-path-1440");
    expect(errors).toEqual([]);
  });

  test("a thin file, and a file whose money the engine withheld", async ({ page }) => {
    let errors = await open(page, { state: "thin", only: "levers" });
    await expect(levers(page).locator(".fhv-levers-step")).toHaveCount(2);
    await expect(levers(page).locator(".fhv-levers-step").nth(1)).toContainText("Add accounts");
    await expect(levers(page)).not.toContainText("Clean the file");
    await expect(levers(page).locator(".fhv-levers-gap")).toContainText("$40,151 left on the table");
    await settle(page);
    await shot(page, "thin-levers-1440");
    expect(errors).toEqual([]);

    errors = await open(page, { state: "withheld" });
    await expect(levers(page).locator(".fhv-levers-headcell").first()).toContainText("$212,000");
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num")).toHaveCount(0);
    await expect(levers(page).locator(".fhv-levers-step")).toHaveCount(0);
    await expect(levers(page).locator(".fhv-levers-chip")).toHaveCount(0);
    await findings(page).locator('[data-fhv-act="findings:open:0"]').click();
    await expect(findings(page).locator(".fhv-levers-match")).toBeVisible();
    await companies(page).getByRole("button", { name: /Add a company/ }).click();
    await expect(companies(page)).toContainText("If you add 1 company");
    await expect(companies(page).locator(".fhv-companies-headcell.is-added .fhv-ui-num")).toHaveCount(0);
    await expect(companies(page).locator(".fhv-companies-years")).toHaveCount(0);
    await expect(companies(page).locator(".fhv-companies-headcell .fhv-ui-num").first()).toHaveText("$212,000");
    await settle(page);
    await shot(page, "withheld-1440");
    expect(errors).toEqual([]);
  });
});

test.describe("present visuals, 390 wide", () => {
  test("one column, no sideways scroll, readable type and 44px taps", async ({ page }) => {
    const errors = await open(page, { width: 390, height: 844 });
    await settle(page);

    const widths = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      roots: [...document.querySelectorAll("[data-fhv]")].map((el) => el.scrollWidth)
    }));
    expect(widths.doc).toBeLessThanOrEqual(390);
    expect(widths.body).toBeLessThanOrEqual(390);
    for (const w of widths.roots) expect(w).toBeLessThanOrEqual(390);

    /* Stacked: the stations sit under each other, the levers' steps under the chart. */
    const stations = await path_(page).locator(".fhv-path-station").all();
    const sBoxes = await Promise.all(stations.map((s) => s.boundingBox()));
    for (let i = 1; i < sBoxes.length; i++) expect(sBoxes[i].y).toBeGreaterThan(sBoxes[i - 1].y);
    const chart = await levers(page).locator(".fhv-levers-chart").boundingBox();
    const steps = await levers(page).locator(".fhv-levers-steps").boundingBox();
    expect(steps.y).toBeGreaterThanOrEqual(chart.y + chart.height - 1);

    /* Floors: body 16px, captions 13px, every visible button 44px each way. */
    const type = await page.evaluate(() => {
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      const min = (sel) => Math.min(...[...document.querySelectorAll(sel)].filter((el) => el.offsetParent !== null).map(px));
      return { body: min("[data-fhv] .fhv-ui-text"), cap: min("[data-fhv] .fhv-ui-cap, [data-fhv] .fhv-ui-eyebrow"), num: min("[data-fhv] .fhv-ui-num") };
    });
    expect(type.body).toBeGreaterThanOrEqual(16);
    expect(type.cap).toBeGreaterThanOrEqual(13);
    expect(type.num).toBeGreaterThanOrEqual(28);
    const buttons = await page.locator("[data-fhv] button").all();
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) {
      const box = await b.boundingBox();
      expect(box, "a button has a box").not.toBeNull();
      expect(box.height, "tap height").toBeGreaterThanOrEqual(44);
      expect(box.width, "tap width").toBeGreaterThanOrEqual(44);
      expect(box.x + box.width).toBeLessThanOrEqual(391);
    }

    await shot(page, "full-390");
    await path_(page).screenshot({ path: path.join(OUT, "path-390.png") });
    await levers(page).screenshot({ path: path.join(OUT, "levers-390.png") });
    await companies(page).screenshot({ path: path.join(OUT, "companies-390.png") });

    /* Taps still work on the phone. */
    await levers(page).getByRole("button", { name: /Pay the cards down/ }).click();
    await expect(levers(page).locator(".fhv-levers-headcell.is-opt .fhv-ui-num")).toHaveText("$104,775");
    await companies(page).getByRole("button", { name: /Add a company/ }).click();
    await expect(companies(page).locator(".fhv-companies-seg.is-added")).toHaveCount(1);
    await settle(page);
    const after = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(after).toBeLessThanOrEqual(390);
    await companies(page).screenshot({ path: path.join(OUT, "companies-added-390.png") });
    expect(errors).toEqual([]);
  });

  test("the mismatch reports stack on the phone", async ({ page }) => {
    const errors = await open(page, { state: "mismatch", only: "findings", width: 390, height: 844 });
    await findings(page).locator('[data-fhv-act="findings:open:5"]').click();
    const reports = await findings(page).locator(".fhv-levers-report").all();
    const boxes = await Promise.all(reports.map((r) => r.boundingBox()));
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height - 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await settle(page);
    await shot(page, "mismatch-390");
    expect(errors).toEqual([]);
  });
});
