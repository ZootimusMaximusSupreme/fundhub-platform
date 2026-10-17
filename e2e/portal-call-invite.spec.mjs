import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CLIENT_ID, json } from "./harness.mjs";

const BOOKING_ID = "b1000000-0000-4000-8000-000000000001";
const evidence = path.join(process.cwd(), "ops/workflows/build-evidence/call-invite-push");
const session = { ok: true, staff: {
  id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com",
  role: "client", org_id: "org-1", status: "active"
} };
const when = () => new Date(Date.now() + 5 * 60_000).toISOString();
const joined = (link = "https://meet.google.com/current-room") => ({
  id: BOOKING_ID, when: when(), confirmed: true,
  join: { url: link, host: new URL(link).host }
});

async function setup(page, getCall) {
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });
  let reads = 0;
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, session);
    if (url.includes("/api/read/portal-summary")) {
      reads += 1;
      const call = getCall(reads);
      if (call === "signed-out") return json(route, { ok: false, error: "unauthorized" }, 401);
      if (call === "error") return json(route, { ok: false, error: "read_failed" }, 503);
      const calls = call && Object.hasOwn(call, "current_call")
        ? call : { upcoming_call: call, current_call: null };
      return json(route, {
        ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
        scores: {}, documents: [], ...calls
      });
    }
    if (url.includes("entitlement")) return json(route, { ok: true, items: [] });
    return json(route, { ok: true, items: [] });
  });
  return () => reads;
}

async function markCallCard(page) {
  await page.evaluate(() => {
    const box = document.getElementById("call-confirm-card").getBoundingClientRect();
    const mark = document.createElement("div");
    mark.id = "call-review-mark";
    mark.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${box.left - 4}px;top:${box.top - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;border:3px solid #D00000;border-radius:12px`;
    const label = document.createElement("span");
    label.textContent = "New: Join Call checks the current link";
    label.style.cssText = "position:absolute;top:-26px;left:0;background:#D00000;color:white;padding:2px 8px;font:600 13px Arial";
    mark.append(label);
    document.body.append(mark);
  });
}

test("Join Call shows the host and opens a freshly checked room on desktop and phone", async ({ page }) => {
  await mkdir(evidence, { recursive: true });
  const reads = await setup(page, () => joined());
  await page.route("https://meet.google.com/**", async (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Current room" }));
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
    const card = page.locator("#call-confirm-card");
    await expect(card).toContainText("Opens meet.google.com");
    await expect(page.locator("#call-join-btn")).toBeVisible();
    await markCallCard(page);
    await page.screenshot({ path: path.join(evidence, `${width}-full.png`) });
    await page.evaluate(() => document.getElementById("call-review-mark")?.remove());
    const before = reads();
    await page.locator("#call-join-btn").click();
    await expect(page).toHaveURL("https://meet.google.com/current-room");
    expect(reads()).toBeGreaterThan(before, "the click must make a fresh signed-in read");
  }
});

test("an old notification never opens a cancelled or moved call", async ({ page }) => {
  const reads = await setup(page, (n) => n === 1 ? joined() : null);
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await expect(page.locator("#call-join-btn")).toBeVisible();
  await page.locator("#call-join-btn").click();
  await expect(page.locator("#call-confirm-card")).toContainText("changed or ended");
  await expect(page.locator("#call-join-btn")).toBeHidden();
  await expect(page).toHaveURL(/client-portal\.html/);
  expect(reads()).toBeGreaterThan(1);
});

test("a call already under way can be joined, not confirmed again", async ({ page }) => {
  const current = {
    id: BOOKING_ID, when: new Date(Date.now() - 5 * 60_000).toISOString(),
    confirmed: true, join: { url: "https://zoom.us/j/current-room", host: "zoom.us" }
  };
  await setup(page, () => ({ current_call: current, upcoming_call: null }));
  await page.route("https://zoom.us/**", async (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Current room" }));
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await expect(page.locator("#call-confirm-card")).toContainText("Your call started");
  await expect(page.locator("#call-confirm-btn")).toBeHidden();
  await expect(page.locator("#call-join-btn")).toBeVisible();
  await page.locator("#call-join-btn").click();
  await expect(page).toHaveURL("https://zoom.us/j/current-room");
});

test("a changed destination is shown before a second tap can open it", async ({ page }) => {
  await setup(page, (n) => n === 1 ? joined() : joined("https://zoom.us/j/current-room"));
  await page.route("https://zoom.us/**", async (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "Current room" }));
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await expect(page.locator("#call-join-btn")).toBeVisible();
  await page.locator("#call-join-btn").click();
  await expect(page.locator("#call-join-host")).toContainText("Call link changed. Opens zoom.us");
  await expect(page).toHaveURL(/client-portal\.html/);
  await page.locator("#call-join-btn").click();
  await expect(page).toHaveURL("https://zoom.us/j/current-room");
});

test("a signed-out fresh check reveals no call link", async ({ page }) => {
  await setup(page, (n) => n === 1 ? joined() : "signed-out");
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`);
  await expect(page.locator("#call-join-btn")).toBeVisible();
  await page.locator("#call-join-btn").click();
  await expect(page.locator("#call-join-host")).toContainText("Sign in again");
  await expect(page).toHaveURL(/client-portal\.html/);
});
