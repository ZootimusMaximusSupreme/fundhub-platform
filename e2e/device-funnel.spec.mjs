import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const appUrl = "https://apps.apple.com/us/app/fundhub-portal/id6823985032";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]";
const android = "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Mobile Safari/537.36 [FBAN/FB4A]";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132.0.0.0 Safari/537.36";
const card = new URL("../public/funnel/fundhub-prompter-download.js", import.meta.url).pathname;
const paths = new URL("../public/funnel/funding-paths.js", import.meta.url).pathname;

async function signals(page, ua, missingPolicy = false, config = { app_store_url: appUrl }) {
  await page.addInitScript((userAgent) => {
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: userAgent });
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "platform", { configurable: true, value: "" });
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, value: 0 });
  }, ua);
  await page.route("**/api/**", (route) => route.fulfill({ status: 401, json: { ok: false } }));
  await page.route("**/funnel/fundhub-prompter-download.json", (route) => route.fulfill({ json: config }));
  await page.route("**/funnel/device-destinations.js", async (route) => missingPolicy
    ? route.fulfill({ status: 404, body: "" })
    : route.fulfill({ contentType: "text/javascript", body: await readFile(new URL("../public/funnel/device-destinations.js", import.meta.url), "utf8") }));
}

for (const [name, ua, supported] of [["Facebook iPhone", iphone, true], ["Facebook Android", android, false], ["Windows", windows, false], ["unknown", "Private browser", false]]) {
  test(`thank-you on ${name}: both portal actions stay useful and only a supported iPhone has a store link`, async ({ page }) => {
    await signals(page, ua);
    await page.goto("/thank-you");
    await page.setContent('<!doctype html><html><head></head><body><div class="fh-root"><div class="hero">Your call is booked.</div><div id="fh-ty-app-slot"></div></div></body></html>');
    await page.addScriptTag({ path: card });
    const button = page.locator(".fh-prompter-download__button");
    await expect(button).toBeVisible();
    if (supported) {
      await expect(button).toHaveAttribute("href", appUrl);
      await expect(button).toHaveText(/Download for iPhone/);
    } else {
      await expect(button).toHaveAttribute("href", "https://fundhub.ai/portal-login.html");
      await expect(button).toHaveText(/Open web portal/);
      await expect(page.locator('a[href*="apple.com"]')).toHaveCount(0);
      await expect(page.locator("#fh-prompter-download")).not.toContainText("iPhone");
    }
    await page.addScriptTag({ path: paths });
    await expect(page.locator("#fhp-flow .st").first().getByRole("link")).toHaveAttribute("href", "https://fundhub.ai/devices.html");
    await expect(page.locator("#fhp-flow .st").first()).not.toContainText("iPhone");
  });

  test(`portal entry on ${name}: optional app action preserves the working web sign-in form`, async ({ page }) => {
    await signals(page, ua);
    await page.goto("/portal-login.html");
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in with password" })).toBeVisible();
    if (supported) await expect(page.locator("#download a")).toHaveAttribute("href", appUrl);
    else await expect(page.locator('a[href*="apple.com"]')).toHaveCount(0);
  });
}

for (const [name, missing, config] of [["missing policy", true, { app_store_url: appUrl }], ["missing listing", false, {}], ["untrusted listing", false, { app_store_url: "https://example.test/other" }]]) {
  test(`iPhone portal ${name}: browser sign-in remains and no Apple choice is revealed`, async ({ page }) => {
    await signals(page, iphone, missing, config);
    await page.goto("/portal-login.html");
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(page.locator("#download")).toBeHidden();
    await expect(page.locator('a[href*="apple.com"]')).toHaveCount(0);
  });
}
