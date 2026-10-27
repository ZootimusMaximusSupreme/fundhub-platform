// Offline checkout-return contract. Every API answer and buyer is fictional;
// this test never contacts a payment provider or creates customer records.
import { test, expect } from "@playwright/test";

const CLIENT = "70000000-0000-4000-8000-000000000001";
const OTHER = "70000000-0000-4000-8000-000000000002";
const PAGE = "/app/payment-success.html?client_id=" + CLIENT + "&ref=test-only-reference";
const unlock = (id, name, client = CLIENT) => ({
  client_id: client, entitlement_code: id, entitlement_name: name,
  active: true, source_transaction_id: "fictional-transaction"
});

test("checkout return cannot assert payment, and expired session stops rather than polling", async ({ page }) => {
  const requests = [];
  await page.route("**/api/read/entitlements?**", (route) => {
    requests.push({ url: route.request().url(), method: route.request().method() });
    return route.fulfill({ status: 401, contentType: "application/json", body: '{"ok":false}' });
  });
  const injected = "<img src=x onerror=alert(1)>";
  await page.goto(PAGE.replace("test-only-reference", encodeURIComponent(injected)));
  await expect(page.locator("#state")).toContainText("We cannot check your account from here");
  await expect(page.locator("#state")).toContainText("You are not signed in");
  await expect(page.locator("#state")).not.toContainText("Payment received");
  await expect(page.locator("#again")).toHaveCount(0);
  await expect(page.locator("#refline")).toHaveText("Payment reference: " + injected);
  await expect(page.locator("#refline img")).toHaveCount(0);
  await expect(page.locator("#back")).toHaveAttribute("href", "client-portal.html?client_id=" + CLIENT);
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe("GET");
  expect(new URL(requests[0].url).searchParams.get("client_id")).toBe(CLIENT);
});

test("account access can appear later, but access from another buyer must never appear", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-27T19:00:00Z") });
  let reads = 0;
  await page.route("**/api/read/entitlements?**", (route) => {
    reads += 1;
    const items = reads === 1
      ? [unlock("OLD", "Already on account")]
      : [unlock("OLD", "Already on account"), unlock("NEW", "Funding service opened"),
         unlock("OTHER", "Another buyer access", OTHER)];
    return route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, count: items.length, items, hasMore: false })
    });
  });
  await page.goto(PAGE);
  await expect.poll(() => reads).toBe(1);
  await expect(page.locator("#state")).not.toContainText("Just opened");
  await page.clock.runFor(3100);
  await expect.poll(() => reads).toBe(2);
  await expect(page.locator("#state")).toContainText("Just opened on your account");
  await expect(page.locator("#state")).toContainText("Funding service opened");
  await expect(page.locator("#state")).not.toContainText("Already on account");
  await expect(page.locator("#state")).not.toContainText("Another buyer access");
  await expect(page.locator("#state")).not.toContainText("Payment received");
});

test("a permanently pending read is aborted; six bounded attempts end in an honest retry", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-27T19:00:00Z") });
  await page.addInitScript(() => {
    window.__entitlementAttempts = 0;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options = {}) => {
      if (!String(url).startsWith("/api/read/entitlements")) return originalFetch(url, options);
      window.__entitlementAttempts += 1;
      // Deliberately never reply, including if there is no AbortSignal.
      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) return;
        if (signal.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    };
  });
  await page.goto(PAGE);
  const attempts = () => page.evaluate(() => window.__entitlementAttempts);
  await expect.poll(attempts).toBe(1);
  for (let i = 1; i <= 6; i += 1) {
    await page.clock.runFor(8100);
    if (i < 6) {
      await page.clock.runFor(3100);
      await expect.poll(attempts).toBe(i + 1);
    }
  }
  expect(await attempts()).toBe(6);
  await expect(page.locator("#state")).toContainText("We could not reach your account");
  await expect(page.locator("#state")).toContainText("cannot say whether your payment went through");
  await expect(page.locator("#again")).toBeEnabled();
  await page.locator("#again").click();
  await expect.poll(attempts).toBe(7);
  await expect(page.locator("#state")).toContainText("Checking your account");
});

test("six failed HTTP reads end in an honest error and manual retry on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date("2026-10-27T19:00:00Z") });
  let reads = 0;
  await page.route("**/api/read/entitlements?**", (route) => {
    reads += 1;
    return route.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false}' });
  });
  await page.goto(PAGE);
  await expect.poll(() => reads).toBe(1);
  await page.clock.runFor(5 * 3100);
  await expect.poll(() => reads).toBe(6);
  await expect(page.locator("#state")).toContainText("We could not reach your account");
  await expect(page.locator("#again")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
