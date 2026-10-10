/* The Lending Climate lead magnet on the live Next.js dashboard (/climate/).
 *   npx playwright test -c playwright.live.config.mjs e2e/live-climate.spec.mjs
 *
 * Desktop and 390px phone. Reads the map, opens a state, checks national score.
 * The old static #usmap page is gone; this tracks the shipped /climate/ app.
 */

import { test, expect } from "@playwright/test";

const SIZES = [
  { label: "desktop", viewport: { width: 1440, height: 900 } },
  { label: "phone", viewport: { width: 390, height: 844 } }
];

for (const { label, viewport } of SIZES) {
  test.describe(`lending climate — ${label}`, () => {
    test.use({ viewport });

    test(`${label}: the map loads, national score reads, and a state opens`, async ({ page }) => {
      const consoleErrors = [];
      page.on("pageerror", (e) => consoleErrors.push(String(e.message)));
      page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });

      const resp = await page.goto("/climate/?utm_source=live-spec&utm_content=climate", {
        waitUntil: "domcontentloaded"
      });
      expect(resp.status()).toBe(200);
      await expect(page).toHaveTitle(/Lending Climate/i);

      await expect(page.locator("text=Loading lending climate")).toHaveCount(0, { timeout: 60_000 });

      const paths = page.locator(".usa-map path.state-path, #states path");
      await expect(paths.first()).toBeVisible({ timeout: 60_000 });
      const pathCount = await paths.count();
      expect(pathCount).toBeGreaterThanOrEqual(5);

      await expect(page.getByText("National Climate")).toBeVisible();
      const nationalScore = page.locator("section").filter({ hasText: "National Climate" }).locator(".big, div").filter({ hasText: /^\d+(\.\d+)?$/ }).first();
      await expect(nationalScore).toBeVisible({ timeout: 15_000 });

      await page.locator('.usa-map path[data-code="AZ"], #states path[data-code="AZ"]').first().click();
      await expect(page.getByText("Today's Score")).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("AZ", { exact: true }).first()).toBeVisible();

      const body = await page.locator("body").innerText();
      for (const re of [
        /pre-?approved/i,
        /guaranteed\s+funding/i,
        /no\s+denials/i,
        /we'?ll\s+get\s+you\s+funded/i
      ]) {
        expect(body, `banned claim matched ${re}`).not.toMatch(re);
      }

      expect(consoleErrors, consoleErrors.join(" | ")).toHaveLength(0);
    });
  });
}

test("lending climate: /lender-climate still lands on the page", async ({ page }) => {
  const resp = await page.goto("/lender-climate", { waitUntil: "domcontentloaded" });
  expect(resp.status()).toBe(200);
  expect(page.url()).toMatch(/\/climate\/$/);
});

test("lending climate: the match endpoint answers a GET, so the pulse can watch it", async ({ request }) => {
  const r = await request.get("/api/public/climate-match");
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.ok).toBe(true);
  expect(d.book_size).toBeGreaterThan(0);
});

test("lending climate: /api/climate answers for the dashboard", async ({ request }) => {
  const r = await request.get("/api/climate");
  expect(r.status()).toBe(200);
  const d = await r.json();
  expect(d.ok).toBe(true);
  expect(d.national?.score).toBeGreaterThan(0);
});
