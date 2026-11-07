// Finance OS Alerts — the alerts bundle under the Alerts section (unit AL,
// Finance OS CFO build, 2026-11-07). The real Finance OS page in a real browser,
// with the two mount lines root will add to financeos.html put in on the way
// (the page is served through page.route so this checks exactly those lines).
// Every /api answer is fake and fictional: the `bundle` is built by the server's
// own builder over one "Sample" client (src/finance/file-alerts/bundle-sample.mjs).
// No database, no network, no live data, nothing saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { json, withSession, trackErrors } from "./harness.mjs";
import { sampleBundle } from "../src/finance/file-alerts/bundle-sample.mjs";

const ALERTS = JSON.parse(fs.readFileSync(new URL("../src/finance/file-alerts/file-alerts.fixture.json", import.meta.url), "utf8"));
const BUNDLE = await sampleBundle();
const evidence = "ops/workflows/build-evidence/finance-os-alerts-bundle-2026-11-07";

/* The mount lines root applies to public/app/financeos.html. Until they are in the
   file, the page is served with them added; once they are, it is served as is. */
const MOUNT = {
  css: ['<link rel="stylesheet" href="money-alerts.css">', '<link rel="stylesheet" href="money-alerts.css">\n<link rel="stylesheet" href="money-alerts-bundle.css">'],
  js: ['<script defer src="money-alerts.js"></script>', '<script defer src="money-alerts.js"></script>\n<script defer src="money-alerts-bundle.js"></script>']
};
async function withMountLines(page) {
  await page.route("**/app/financeos.html*", async (route) => {
    const res = await route.fetch();
    let html = await res.text();
    if (!html.includes("money-alerts-bundle.js")) {
      for (const [from, to] of [MOUNT.css, MOUNT.js]) {
        if (!html.includes(from)) throw new Error(`financeos.html no longer has ${from}`);
        html = html.replace(from, to);
      }
    }
    await route.fulfill({ response: res, body: html, headers: { ...res.headers(), "content-type": "text/html; charset=utf-8" } });
  });
}

async function open(page, state = "full") {
  const posts = [];
  const held = [];
  let mode = state;
  await withSession(page, { staff: { role: "client" } });
  await withMountLines(page);
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/money/alerts")) {
      if (route.request().method() === "POST") {
        posts.push(route.request().postDataJSON());
        return json(route, { ok: true, action: "set_bundle_alert", saved: {} });
      }
      if (!url.includes("part=bundle")) return json(route, ALERTS);
      if (mode === "loading") { held.push(route); return; }
      if (mode === "error") return json(route, { ok: false, error: "server_error" }, 500);
      const bundle = JSON.parse(JSON.stringify(BUNDLE));
      if (mode === "empty") {
        bundle.card_rule.cards = [];
        bundle.business_credit = [];
        bundle.pay_by.cards = [];
        bundle.intro = [];
        bundle.weekly.preview = null;
        bundle.weekly.preview_reason = "nothing_to_say";
      }
      return json(route, { ...ALERTS, bundle });
    }
    if (url.includes("/api/money/overview")) return json(route, { ok: true, client: { name: "Sample Client" }, sandbox: false });
    if (url.includes("/api/auth/session")) return json(route, { ok: true, principal: "client" });
    return json(route, { ok: true });
  });
  await page.goto("/app/financeos.html#alerts");
  return { posts, held, setMode: (m) => { mode = m; } };
}

async function noSidewaysScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
}

/* Every visible control in the bundle is at least 44 by 44. */
async function smallControls(page) {
  return page.evaluate(() => [...document.querySelectorAll(".fh-bundle button, .fh-bundle a, .fh-bundle [role=switch]")]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { t: (el.textContent || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((r) => r.w < 44 || r.h < 44));
}

for (const width of [1440, 390, 320]) {
  test(`alerts bundle — full, switches and phone fit at ${width}`, async ({ page }) => {
    const errors = trackErrors(page);
    await page.setViewportSize({ width, height: 1000 });
    const { posts } = await open(page, "full");
    const box = page.locator("#fos-alerts .fh-bundle");
    await expect(box.locator("#fb-card-rule")).toBeVisible({ timeout: 10_000 });
    for (const id of ["#fb-intro", "#fb-business", "#fb-weekly"]) await expect(box.locator(id)).toBeVisible();

    // "Pay by" and the over-10% rule are shown once on the whole Alerts tab: as the board's
    // Smart alert (the fixture's Personal Visa), never again in this box.
    await expect(box.locator("#fb-pay-by")).toHaveCount(0);
    await expect(page.locator("#fos-alerts #fa-smart")).toContainText("Pay $520.40 to get under 10%. Due Oct 25.");
    await expect(page.locator("#fos-alerts").getByText(/^Pay by /)).toHaveCount(1);
    await expect(box.getByText(/Pay by|Pay about \$1,600/)).toHaveCount(0);
    await expect(box.locator("#fb-card-rule")).not.toContainText("Sample Card");
    await expect(box.getByText("60 days left")).toBeVisible();
    await expect(box.getByText(/Intelliscore 55 \(was 42\)/)).toBeVisible();
    await expect(box.locator(".fb-preview")).toContainText("Fundhub weekly: Money came in 1 time");

    const switches = box.getByRole("switch");
    await expect(switches).toHaveCount(3);
    const weekly = box.getByRole("switch", { name: /Send me the Monday money text/ });
    await expect(weekly).toHaveAttribute("aria-checked", "true");
    await weekly.click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "set_bundle_alert", kind: "weekly_money", enabled: false });
    await expect(box.getByRole("switch", { name: /Send me the Monday money text/ })).toHaveAttribute("aria-checked", "false");
    await expect(box.getByText("The Monday text is off.", { exact: true })).toBeVisible();
    // The save has answered (the switch ignores a second press while one is out): the
    // live line says so.
    await expect(box.locator(".fb-live")).toHaveText("Send me the Monday money text: off.");

    // Keyboard: Space on a focused switch flips it back.
    await box.getByRole("switch", { name: /Send me the Monday money text/ }).focus();
    await page.keyboard.press("Space");
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({ action: "set_bundle_alert", kind: "weekly_money", enabled: true });

    expect(await smallControls(page)).toEqual([]);
    await noSidewaysScroll(page);
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/alerts-bundle-full-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("alerts bundle — empty, error with Try again, and loading", async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 390, height: 900 });
  fs.mkdirSync(evidence, { recursive: true });

  const empty = await open(page, "empty");
  const box = page.locator("#fos-alerts .fh-bundle");
  await expect(box.getByRole("heading", { name: "Nothing to watch yet" })).toBeVisible({ timeout: 10_000 });
  await expect(box.getByRole("link", { name: "Add an account" })).toHaveAttribute("href", "/app/financeos.html#accounts");
  await expect(box.getByText(/Nothing to say yet/)).toBeVisible();
  expect(await smallControls(page)).toEqual([]);
  await page.screenshot({ path: `${evidence}/alerts-bundle-empty-390.png`, fullPage: true });

  empty.setMode("error");
  await page.reload();
  await expect(box.getByRole("button", { name: "Try again" })).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${evidence}/alerts-bundle-error-390.png`, fullPage: true });
  empty.setMode("full");
  await box.getByRole("button", { name: "Try again" }).click();
  await expect(box.locator("#fb-card-rule")).toBeVisible();

  empty.setMode("loading");
  await page.reload();
  await expect(page.locator('#fos-alerts .fh-bundle [aria-busy="true"]')).toBeVisible({ timeout: 10_000 });
  await page.screenshot({ path: `${evidence}/alerts-bundle-loading-390.png`, fullPage: true });
  await noSidewaysScroll(page);
  expect(errors).toEqual([]);
});

test("alerts bundle — an older read with no bundle paints nothing and breaks nothing", async ({ page }) => {
  const errors = trackErrors(page);
  await withSession(page, { staff: { role: "client" } });
  await withMountLines(page);
  await page.route("**/api/**", (route) => {
    const url = route.request().url();
    if (url.includes("/api/money/alerts")) return json(route, ALERTS);
    if (url.includes("/api/money/overview")) return json(route, { ok: true, client: { name: "Sample Client" } });
    return json(route, { ok: true });
  });
  await page.goto("/app/financeos.html#alerts");
  await expect(page.locator("#fos-alerts .fos-extra")).toBeAttached({ timeout: 10_000 });
  // The older alerts section still paints; the bundle's box stays empty.
  await expect(page.locator("#fos-alerts .fh-alerts").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#fos-alerts .fh-bundle")).toHaveCount(0);
  expect(errors).toEqual([]);
});
