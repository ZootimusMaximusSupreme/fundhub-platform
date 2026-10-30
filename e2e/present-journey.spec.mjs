// Visual D, the credit optimization journey, in a real browser, offline.
//
// public/app/present-journey.js is mounted by e2e/fixtures/present-journey-harness.html,
// a test-only stand-in for the client half of the closer slides, served here
// through page.route() with the fixture ctx (e2e/fixtures/present-journey-ctx.json)
// injected as window.__FHV_FIXTURES. Nothing is fetched from an API, saved or sent.
//
// It proves, at 1440 and at 390: the ladder marks today and the projection
// with the engine's amounts; six round buttons, Round 1 open with the client's
// own items; a tap opens another round and shows who the letter goes to and
// what it asks; the state survives a re-render; the no-data, sample and
// bad-data states; one column with no sideways scroll on the phone; 44px taps,
// 16px body and 13px captions; the count-up lands on the amount and skips
// itself under reduced motion. Screenshots land in
// ops/workflows/build-evidence/slides-refresh-2026-10-29/journey/.
//
// Run: E2E_PORT=4951 npx playwright test e2e/present-journey.spec.mjs

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = fs.readFileSync(path.join(HERE, "fixtures", "present-journey-harness.html"), "utf8");
const FIXTURES = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "present-journey-ctx.json"), "utf8"));
const EVIDENCE = path.resolve(HERE, "../ops/workflows/build-evidence/slides-refresh-2026-10-29/journey");

async function open(page, state, { client } = {}) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((fx) => { window.__FHV_FIXTURES = fx; }, FIXTURES);
  await page.route("**/e2e-host/present-journey.html**", (r) => r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HOST }));
  const q = new URLSearchParams({ state });
  if (client) q.set("client", client);
  await page.goto("/e2e-host/present-journey.html?" + q.toString());
  await expect(page.locator('[data-fhv="journey"]')).toBeVisible();
  return errors;
}

async function shot(page, name) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE, `${name}.png`) });
}

async function noSideways(page) {
  const [sw, iw, slideSw, slideCw] = await page.evaluate(() => {
    const s = document.getElementById("slide-body");
    return [document.documentElement.scrollWidth, window.innerWidth, s.scrollWidth, s.clientWidth];
  });
  expect(sw, "no sideways page scroll").toBeLessThanOrEqual(iw);
  expect(slideSw, "no sideways scroll inside the slide").toBeLessThanOrEqual(slideCw);
}

const fontPx = (page, sel) => page.locator(sel).first().evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const w = size.width;
  test.describe(`journey at ${w}px`, () => {
    test.use({ viewport: size, locale: "en-US" });

    test("full: the ladder, six rounds, taps through, and the state survives a re-render", async ({ page }) => {
      const errors = await open(page, "full");
      const now = page.locator(".fhv-journey-mark.is-now .fhv-journey-amt");
      const after = page.locator(".fhv-journey-mark.is-after .fhv-journey-amt");
      await expect(page.locator(".fhv-journey-mark.is-now .fhv-journey-cap")).toHaveText("You are here");
      await expect(page.locator(".fhv-journey-mark.is-after .fhv-journey-cap")).toHaveText("Projects to");
      await expect(now).toHaveText("$0", { timeout: 3000 });
      await expect(after).toHaveText("$8,250", { timeout: 3000 });
      await expect(page.locator(".fhv-journey-rung.is-now .fhv-journey-lvl")).toHaveText("Repair only");
      await expect(page.locator(".fhv-journey-rung.is-after .fhv-journey-lvl")).toHaveText("Funding plus repair");
      await expect(page.locator("svg.fhv-journey-link")).toBeAttached();
      await expect(page.locator(".fhv-journey-tag")).toHaveCount(0);

      const btns = page.locator("button[data-fhv-round]");
      await expect(btns).toHaveCount(6);
      await expect(btns.nth(0)).toHaveAttribute("aria-expanded", "true");
      await expect(btns.nth(0)).toHaveAccessibleName(/Round 1\s+Metro 2 dispute/);
      for (const c of ["MIDLAND CREDIT MGMT", "PORTFOLIO RECOVERY", "SYNCHRONY BANK", "ALLY FINANCIAL"]) await expect(page.getByText(c)).toBeVisible();
      await expect(page.locator(".fhv-journey-said")).toContainText("You said:");
      await expect(page.locator('[data-fhv-body="R1"] .fhv-journey-timing')).toHaveText("The bureaus answer in 30 to 45 days.");
      await expect(page.locator('[data-fhv-body="R2"]')).toBeHidden();

      for (let i = 0; i < 6; i++) {
        const box = await btns.nth(i).boundingBox();
        expect(box.height, `round ${i + 1} tap height`).toBeGreaterThanOrEqual(44);
        expect(box.width, `round ${i + 1} tap width`).toBeGreaterThanOrEqual(44);
      }
      expect(await fontPx(page, ".fhv-journey-cred")).toBeGreaterThanOrEqual(16);
      expect(await fontPx(page, ".fhv-journey-detail dd")).toBeGreaterThanOrEqual(16);
      expect(await fontPx(page, ".fhv-journey-lvl")).toBeGreaterThanOrEqual(16);
      expect(await fontPx(page, ".fhv-journey-rtitle")).toBeGreaterThanOrEqual(16);
      expect(await fontPx(page, ".fhv-journey-cap")).toBeGreaterThanOrEqual(13);
      expect(await fontPx(page, ".fhv-journey-timing")).toBeGreaterThanOrEqual(13);
      expect(await fontPx(page, ".fhv-journey-bur")).toBeGreaterThanOrEqual(13);
      expect(await fontPx(page, ".fhv-journey-amt")).toBeGreaterThanOrEqual(18);
      await noSideways(page);
      await shot(page, `${w}-full-round-1`);

      await btns.nth(1).click();
      await expect(btns.nth(1)).toHaveAttribute("aria-expanded", "true");
      await expect(btns.nth(0)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator('[data-fhv-body="R1"]')).toBeHidden();
      await expect(page.locator('[data-fhv-body="R2"] .fhv-journey-note')).toHaveText("Anything still on the file goes to the next round.");
      await expect(page.getByText("Show the method it used to verify.")).toBeVisible();
      await noSideways(page);
      await shot(page, `${w}-full-round-2`);

      await btns.nth(3).click();
      await expect(page.getByText("The CFPB, the federal regulator. You sign it.")).toBeVisible();
      await shot(page, `${w}-full-round-4`);

      await btns.nth(5).click();
      await expect(btns.nth(5)).toHaveAttribute("aria-expanded", "true");
      await page.locator("#rerender").click();
      const again = page.locator("button[data-fhv-round]");
      await expect(again).toHaveCount(6);
      await expect(again.nth(5)).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("Delete what it still cannot verify.")).toBeVisible();
      await expect(page.locator(".fhv-journey-mark.is-after .fhv-journey-amt")).toHaveText("$8,250");
      await shot(page, `${w}-full-round-6-after-rerender`);

      await again.nth(5).click();
      await expect(again.nth(5)).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator(".fhv-journey-rbody:not([hidden])")).toHaveCount(0);
      await shot(page, `${w}-full-all-closed`);
      expect(errors).toEqual([]);
    });

    test("no data yet: no amount, no marker, the path still describes the process", async ({ page }) => {
      const errors = await open(page, "null");
      const text = await page.locator('[data-fhv="journey"]').innerText();
      expect(text).not.toContain("$");
      expect(text).not.toContain("You are here");
      expect(text).not.toContain("Projects to");
      await expect(page.locator(".fhv-journey-ladder-note")).toContainText("No pull on this file yet.");
      await expect(page.locator("button[data-fhv-round]")).toHaveCount(6);
      await expect(page.locator('[data-fhv-body="R1"] .fhv-journey-note')).toHaveText("Your items from today’s pull show here.");
      await noSideways(page);
      await shot(page, `${w}-no-data`);
      expect(errors).toEqual([]);
    });

    test("engine hold: the items still list, with no level marker and no amount", async ({ page }) => {
      const errors = await open(page, "hold");
      const text = await page.locator('[data-fhv="journey"]').innerText();
      expect(text).not.toContain("$");
      expect(text).not.toContain("You are here");
      expect(text).not.toContain("Projects to");
      await expect(page.locator(".fhv-journey-rung.is-now, .fhv-journey-rung.is-after, svg.fhv-journey-link")).toHaveCount(0);
      await expect(page.locator(".fhv-journey-ladder-note")).toHaveText("No level or amount on this file yet. The rounds below still run.");
      for (const c of ["MIDLAND CREDIT MGMT", "PORTFOLIO RECOVERY", "SYNCHRONY BANK", "ALLY FINANCIAL"]) await expect(page.getByText(c)).toBeVisible();
      await expect(page.locator("button[data-fhv-round]")).toHaveCount(6);
      await noSideways(page);
      await shot(page, `${w}-engine-hold`);
      expect(errors).toEqual([]);
    });

    test("sample: the Sample tag and the sample person's amounts", async ({ page }) => {
      const errors = await open(page, "sample");
      await expect(page.locator(".fhv-journey-tag")).toHaveText("Sample");
      await expect(page.locator(".fhv-journey-mark.is-now .fhv-journey-amt")).toHaveText("$18,000", { timeout: 3000 });
      await expect(page.locator(".fhv-journey-mark.is-after .fhv-journey-amt")).toHaveText("$60,000", { timeout: 3000 });
      await expect(page.locator(".fhv-journey-rung.is-after .fhv-journey-lvl")).toHaveText("Full funding");
      await expect(page.getByText("TOYOTA MOTOR CREDIT")).toBeVisible();
      await expect(page.locator(".fhv-journey-said")).toHaveCount(0);
      await noSideways(page);
      await shot(page, `${w}-sample`);
      expect(errors).toEqual([]);
    });

    test("bad data: the plain fallback, never a blank slide", async ({ page }) => {
      const errors = await open(page, "bad");
      await expect(page.locator(".fhv-journey-fallback")).toBeVisible();
      const text = await page.locator('[data-fhv="journey"]').innerText();
      expect(text).toContain("Round 1: Metro 2 dispute");
      expect(text).toContain("Round 6: Final notice, again");
      expect(text).not.toContain("$");
      await shot(page, `${w}-bad-data`);
      expect(errors).toEqual([]);
    });
  });
}

test.describe("motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "en-US" });

  test("the amounts count up and land on the engine's amount", async ({ page }) => {
    await open(page, "full", { client: "motion-count" });
    await expect(page.locator(".fhv-journey-mark.is-after .fhv-journey-amt")).toHaveText("$8,250", { timeout: 3000 });
    await expect(page.locator(".fhv-journey-mark.is-now .fhv-journey-amt")).toHaveText("$0");
  });

  test("with reduced motion the amounts just appear", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await open(page, "full", { client: "motion-reduce" });
    expect(await page.locator(".fhv-journey-mark.is-after .fhv-journey-amt").textContent()).toBe("$8,250");
    expect(await page.locator(".fhv-journey-mark.is-now .fhv-journey-amt").textContent()).toBe("$0");
  });
});
