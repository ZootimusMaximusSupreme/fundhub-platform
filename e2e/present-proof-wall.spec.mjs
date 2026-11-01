import { test, expect } from "@playwright/test";
import fs from "node:fs";

const OUT = "/private/tmp/closer-visual-review";
fs.mkdirSync(OUT, { recursive: true });

async function open(page, width) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
  await page.route("**/proof-wall-review", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app/fundhub-brand.css"></head><body style="margin:0;padding:16px;background:#faf9f6"><main id="proof" style="max-width:1100px;margin:auto"></main></body></html>'
  }));
  await page.goto("/proof-wall-review");
  await page.addScriptTag({ url: "/app/present-proof-wall.js" });
  await page.evaluate(() => {
    document.getElementById("proof").innerHTML = '<h1 style="font:700 32px/1.1 sans-serif">Real approvals from other Fundhub clients.</h1>' +
      window.FHDeckVisuals.proofWall({ clientId: "offline-proof-review", sample: false });
  });
  await expect(page.locator('[data-fhv="proof-wall"] .fhv-proof-wall-card')).toHaveCount(3);
}

for (const width of [1440, 390]) {
  test(`P-01 ${width}px opens a readable verified crop and returns to the wall`, async ({ page }) => {
    await open(page, width);
    const trigger = page.locator('[data-fhv-proof-act="show:2"]');
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Approval evidence from another Fundhub client" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Approved for $70,000");
    await expect(dialog).toContainText("Source: Business Revolving Line of Credit approval showing $70,000");
    const image = dialog.locator("img");
    await expect(image).toHaveAttribute("src", "/app/proof-wall/d-70k-loc.jpg");
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    if (width === 390) {
      const shot = dialog.locator(".fhv-proof-dialog-shot");
      expect(await shot.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await dialog.getByRole("button", { name: "Fit full image" }).click();
      expect(await shot.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await dialog.getByRole("button", { name: "Show readable size" }).click();
      expect(await shot.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    }
    await dialog.screenshot({ path: `${OUT}/P-01-open-${width}.png`, animations: "disabled" });
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await page.locator('[data-fhv-proof-act="show:0"]').click();
    await expect(page.getByRole("dialog")).toContainText("Approved for $6,500");
    await page.getByRole("button", { name: "Close and return" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}
