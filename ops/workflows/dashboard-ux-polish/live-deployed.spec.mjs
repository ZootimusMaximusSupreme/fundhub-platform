import { test, expect } from "@playwright/test";
import fs from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { openScreen, OWNER } from "../../../e2e/harness.mjs";
import "../../../e2e/workspace-brand-polish.spec.mjs";

// Only static GETs leave this browser. Existing scenario handlers supply all
// synthetic API responses, including the forced Kanban read failure.
const unhandled = new WeakMap();
test.beforeEach(async ({ page }) => {
  const denied = [];
  unhandled.set(page, denied);
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://fundhub.ai") return route.abort();
    if (!["GET", "HEAD"].includes(request.method()) || url.pathname.startsWith("/api/")) {
      denied.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
});

test.afterEach(async ({ page }, info) => {
  expect(unhandled.get(page), "No unhandled API call or write may reach production").toEqual([]);
  if (info.status !== "passed") return;
  const target = page.locator("#ssSuiteMsg, #boardStatus, #fh-menu-btn, .side-top").filter({ visible: true }).first();
  if (!await target.count()) return;
  await target.evaluate((element, caption) => {
    const r = element.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const mark = document.createElement("div");
    mark.style.cssText = `position:absolute;left:${Math.max(0,r.left-2)}px;top:${Math.max(0,r.top-2)}px;width:${r.width+4}px;height:${r.height+4}px;border:2px solid #c52b2b;box-sizing:border-box`;
    const label = document.createElement("div");
    label.textContent = `LIVE ASSETS · ${caption} · Synthetic API data; no customer actions`;
    label.style.cssText = "position:absolute;bottom:8px;left:8px;right:8px;background:white;color:#111;border:2px solid #c52b2b;padding:8px;font:12px/1.4 system-ui";
    layer.append(mark,label);
    document.body.append(layer);
  }, info.title);
  await info.attach("marked-live-proof", { body: await page.screenshot(), contentType: "image/png" });
});

test("Social Studio shows the shorter help on desktop and phone", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openScreen(page, "/app/social-studio.html", OWNER);
    await expect(page.locator("#ssSuiteMsg")).toHaveText("Brand-matched drafts. Review them below before sending.");
    const connection = await page.locator("#oauthConnectBox").innerText();
    expect(connection.trim().split(/\s+/).length).toBeLessThan(35);
    await expect(page.locator("#vWhat")).toHaveText("Write a post to preview its copy check.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.unroute("**/api/**");
  }
});

test("all seven changed published assets match the release source", async ({ request }, info) => {
  const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const paths = ["shell.js", "crm-sidebar.css", "social-studio.html", "cc-tab-ideas.js", "marketing-cc-settings.js", "marketing-cc-scripts.js", "pipeline.html"];
  const hash = data => crypto.createHash("sha256").update(data).digest("hex");
  const results = [];
  for (const file of paths) {
    const response = await request.get(`/app/${file}?release=${source}`, { headers: { "cache-control": "no-cache" } });
    expect(response.ok(), file).toBe(true);
    const expected = hash(fs.readFileSync(`public/app/${file}`));
    const actual = hash(await response.body());
    results.push({ path: `/app/${file}`, expected, actual, matches: expected === actual });
  }
  await info.attach("asset-byte-receipt", { body: JSON.stringify({ source, checkedAt: new Date().toISOString(), site: "https://fundhub.ai", readOnly: true, results }, null, 2), contentType: "application/json" });
  expect(results.filter(row => !row.matches), "Published assets must match this release").toEqual([]);
});
