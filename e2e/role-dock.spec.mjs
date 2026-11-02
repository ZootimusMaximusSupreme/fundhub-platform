import { test, expect } from "@playwright/test";
import { OWNER, wireApi, gotoScreen } from "./harness.mjs";
const feed = { ok: true, identity: { kind: "staff", roles: ["owner", "setter"] },
  generatedAt: "2026-11-02T17:00:00Z", sections: [
    { role: "owner", sopHref: "/app/company-brain.html?sop=operations", metrics: [], items: [
      { id: "a", title: "First urgent item", detail: "First detail", urgency: "urgent", href: "/app/tasks.html" },
      { id: "b", title: "Second item", detail: "Second detail", href: "https://outside.invalid/" }
    ] },
    { role: "setter", metrics: [{ label: "Booked calls", value: null, unavailableReason: "source_unavailable" }], items: [] }
  ] };
test("Dock stacks roles, keeps one detail open, and uses scoped workspace/SOP navigation", async ({ page }) => {
  await wireApi(page, { session: OWNER, handlers: { "/api/read/dock": () => feed } });
  await gotoScreen(page, "role-dock.html");
  await page.locator("#toggle").click();
  await expect(page.locator(".section")).toHaveCount(2);
  await expect(page.locator(".sop-link")).toHaveAttribute("href", /company-brain.*operations/);
  await expect(page.locator(".metric strong")).toHaveText("—");
  const toggles=page.locator(".item-toggle");
  await toggles.nth(0).click();
  await expect(page.locator(".item-detail").nth(0)).toBeVisible();
  await toggles.nth(1).click();
  await expect(page.locator(".item-detail").nth(0)).toBeHidden();
  await expect(page.locator(".item-detail").nth(1)).toBeVisible();
  await expect(page.locator('.item-detail a[href*="outside"]')).toHaveCount(0);
  await expect(page.locator("#badge")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(page.locator("body")).toHaveAttribute("data-expanded", "false");
  await expect(page.locator(".item-toggle[aria-expanded=true]")).toHaveCount(0);
});
test("Dock immediately erases the previous account when its token changes", async ({ page }) => {
  let signedOut = false;
  await wireApi(page, { session: OWNER, handlers: { "/api/read/dock": () => signedOut
    ? { status: 401, body: { ok: false } } : feed } });
  await gotoScreen(page, "role-dock.html");
  await expect(page.locator(".section")).toHaveCount(2);
  signedOut = true;
  // A different same-origin workspace triggers the real browser storage event.
  await page.route("**/api/read/dock", route => route.fulfill({ status: 401, contentType: "application/json", body: '{"ok":false}' }));
  await page.evaluate(() => { localStorage.removeItem("fh_token"); window.dispatchEvent(new StorageEvent("storage", { key: "fh_token" })); });
  await expect(page.locator(".section")).toHaveCount(0);
  await expect(page.locator("#badge")).toBeHidden();
  await expect(page.locator("#error")).toHaveAttribute("data-active", "true");
});
