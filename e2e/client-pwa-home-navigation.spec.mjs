// Installed client PWA navigation stays on client/auth routes, never marketing.
// Static Playwright server and simulated standalone mode only; no live sessions.
import { test, expect } from "@playwright/test";

const entries = [
  { path: "/portal-login.html", brand: ".portal-brand", back: ".portal-back" },
  { path: "/login.html?next=%2Fapp%2Fclient-portal.html", brand: ".login-brand", back: ".login-back" }
];

for (const entry of entries) {
  test(`installed PWA does not offer marketing home from ${entry.path}`, async ({ page }) => {
    // Chromium's installed iPhone PWA equivalent, without installing anything.
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    });
    await page.goto(entry.path);
    await expect(page.locator(entry.brand)).not.toHaveAttribute("href", /.+/);
    await expect(page.locator(entry.back)).toBeHidden();
    await expect(page.locator('main a[href="/"]:visible, main a[href="/index.html"]:visible')).toHaveCount(0);
    await expect(page.locator("#email")).toBeVisible();
    if (entry.path.startsWith("/portal-login")) {
      await expect(page.getByRole("link", { name: /Sign in with password/ }))
        .toHaveAttribute("href", "/login.html?next=%2Fapp%2Fclient-portal.html");
    } else {
      await expect(page.getByRole("link", { name: /Client sign-in with an email link/ }))
        .toHaveAttribute("href", "/portal-login.html");
      await expect(page.getByLabel("Password")).toBeVisible();
    }
  });

  test(`ordinary browser retains marketing link from ${entry.path}`, async ({ page }) => {
    await page.goto(entry.path);
    await expect(page.locator(entry.brand)).toHaveAttribute("href", "/");
    await expect(page.locator(entry.back)).toBeVisible();
    await expect(page.locator(entry.back).locator("a")).toHaveAttribute("href", "/");
  });
}

test("installed PWA detected by display-mode even without navigator.standalone", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    const original = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (query === "(display-mode: standalone)") return {
        media: query, matches: true,
        addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {},
        dispatchEvent() { return true; }
      };
      return original(query);
    };
  });
  await page.goto("/portal-login.html");
  await expect(page.locator(".portal-brand")).not.toHaveAttribute("href", /.+/);
  await expect(page.locator(".portal-back")).toBeHidden();
});

test("generic staff login keeps homepage navigation, even in standalone browser mode", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  await page.goto("/login.html");
  await expect(page.locator("body")).not.toHaveAttribute("data-client-public", "");
  await expect(page.locator(".login-brand")).toHaveAttribute("href", "/");
  await expect(page.locator(".login-back")).toBeVisible();
});
