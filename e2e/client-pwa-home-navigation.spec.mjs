// Installed client PWA navigation stays on client/auth routes, never marketing.
// Static Playwright server and simulated standalone mode only; no live sessions.
import { test, expect } from "@playwright/test";

const entries = [
  { path: "/portal-login.html", brand: ".portal-brand", back: ".portal-back" },
  { path: "/login.html?next=%2Fapp%2Fclient-portal.html", brand: ".login-brand", back: ".login-back" },
  { path: "/login.html", brand: ".login-brand", back: ".login-back" },
  { path: "/login.html?next=%2Fapp%2Ffinanceos.html", brand: ".login-brand", back: ".login-back" }
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
      await expect(page.locator("#pw")).toBeVisible();
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

test("generic standalone login without explicit client marker still blocks homepage", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  await page.goto("/login.html");
  await expect(page.locator("body")).not.toHaveAttribute("data-client-public", "");
  await expect(page.locator(".login-brand")).not.toHaveAttribute("href", /.+/);
  await expect(page.locator(".login-back")).toBeHidden();
});

for (const hasToken of [false, true]) {
  test("installed PWA reset token present=" + hasToken + " returns to client sign-in", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    });
    await page.goto("/reset-password.html" + (hasToken ? "?token=synthetic-test-only" : ""));
    await expect(page.locator('.card a[href="/login.html?next=%2Fapp%2Fclient-portal.html"]')).toHaveCount(2);
    await expect(page.locator("#f"))[hasToken ? "toBeVisible" : "toBeHidden"]();
    if (!hasToken) await expect(page.locator("#noToken")).toBeVisible();
    await page.getByRole("link", { name: /Back to sign in/ }).click();
    await expect(page).toHaveURL((url) =>
      url.pathname === "/login.html" && url.searchParams.get("next") === "/app/client-portal.html"
    );
    await expect(page.locator(".login-brand")).not.toHaveAttribute("href", /.+/);
  });
}

test("installed PWA reset success uses client link, without a real provider call", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  await page.route("**/api/auth/reset", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ ok: true })
  }));
  await page.goto("/reset-password.html?token=synthetic-test-only");
  await page.locator("#pw1").fill("synthetic-strong-123");
  await page.locator("#pw2").fill("synthetic-strong-123");
  await page.locator("#go").click();
  await expect(page.locator("#okMsg")).toBeVisible();
  await expect(page.locator("#okMsg a")).toHaveAttribute("href", "/login.html?next=%2Fapp%2Fclient-portal.html");
});

test("installed PWA invalid reset token preserves safe return path and error", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
  });
  await page.route("**/api/auth/reset", (route) => route.fulfill({
    status: 400, contentType: "application/json",
    body: JSON.stringify({ ok: false, detail: "That link is invalid or has expired." })
  }));
  await page.goto("/reset-password.html?token=synthetic-expired");
  await page.locator("#pw1").fill("synthetic-strong-123");
  await page.locator("#pw2").fill("synthetic-strong-123");
  await page.locator("#go").click();
  await expect(page.locator("#err")).toContainText("invalid or has expired");
  await expect(page.getByRole("link", { name: /Back to sign in/ }))
    .toHaveAttribute("href", "/login.html?next=%2Fapp%2Fclient-portal.html");
});

test("ordinary browser reset retains generic staff login links", async ({ page }) => {
  await page.goto("/reset-password.html?token=synthetic-test-only");
  await expect(page.locator('.card a[href="/login.html"]')).toHaveCount(2);
  await expect(page.locator("#f")).toBeVisible();
});

test("reset page detects display-mode standalone without navigator.standalone", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    const original = window.matchMedia.bind(window);
    window.matchMedia = function (query) {
      if (query === "(display-mode: standalone)") return { matches: true };
      return original(query);
    };
  });
  await page.goto("/reset-password.html");
  await expect(page.getByRole("link", { name: /Back to sign in/ }))
    .toHaveAttribute("href", "/login.html?next=%2Fapp%2Fclient-portal.html");
});
