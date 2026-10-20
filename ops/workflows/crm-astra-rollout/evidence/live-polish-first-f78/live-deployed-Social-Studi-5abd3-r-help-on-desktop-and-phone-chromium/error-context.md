# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: live-deployed.spec.mjs >> Social Studio shows the shorter help on desktop and phone
- Location: ops/workflows/dashboard-ux-polish/live-deployed.spec.mjs:46:1

# Error details

```
Error: expect(locator).toHaveText(expected) failed

Locator:  locator('#vWhat')
Expected: "Write a post to preview its copy check."
Received: "Write a post and choose what it is about to preview the check."
Timeout:  5000ms

Call log:
  - Expect "toHaveText" with timeout 5000ms
  - waiting for locator('#vWhat')
    14 × locator resolved to <div id="vWhat" class="vwhat">Write a post and choose what it is about to previ…</div>
       - unexpected value "Write a post and choose what it is about to preview the check."

```

```yaml
- text: Write a post and choose what it is about to preview the check.
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import fs from "node:fs";
  3  | import crypto from "node:crypto";
  4  | import { execFileSync } from "node:child_process";
  5  | import { openScreen, OWNER } from "../../../e2e/harness.mjs";
  6  | import "../../../e2e/workspace-brand-polish.spec.mjs";
  7  |
  8  | // Only static GETs leave this browser. Existing scenario handlers supply all
  9  | // synthetic API responses, including the forced Kanban read failure.
  10 | const unhandled = new WeakMap();
  11 | test.beforeEach(async ({ page }) => {
  12 |   const denied = [];
  13 |   unhandled.set(page, denied);
  14 |   await page.route("**/*", (route) => {
  15 |     const request = route.request();
  16 |     const url = new URL(request.url());
  17 |     if (url.origin !== "https://fundhub.ai") return route.abort();
  18 |     if (!["GET", "HEAD"].includes(request.method()) || url.pathname.startsWith("/api/")) {
  19 |       denied.push(`${request.method()} ${url.pathname}`);
  20 |       return route.abort();
  21 |     }
  22 |     return route.continue();
  23 |   });
  24 | });
  25 |
  26 | test.afterEach(async ({ page }, info) => {
  27 |   expect(unhandled.get(page), "No unhandled API call or write may reach production").toEqual([]);
  28 |   if (info.status !== "passed") return;
  29 |   const target = page.locator("#ssSuiteMsg, #boardStatus, #fh-menu-btn, .side-top").filter({ visible: true }).first();
  30 |   if (!await target.count()) return;
  31 |   await target.evaluate((element, caption) => {
  32 |     const r = element.getBoundingClientRect();
  33 |     const layer = document.createElement("div");
  34 |     layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  35 |     const mark = document.createElement("div");
  36 |     mark.style.cssText = `position:absolute;left:${Math.max(0,r.left-2)}px;top:${Math.max(0,r.top-2)}px;width:${r.width+4}px;height:${r.height+4}px;border:2px solid #c52b2b;box-sizing:border-box`;
  37 |     const label = document.createElement("div");
  38 |     label.textContent = `LIVE ASSETS · ${caption} · Synthetic API data; no customer actions`;
  39 |     label.style.cssText = "position:absolute;bottom:8px;left:8px;right:8px;background:white;color:#111;border:2px solid #c52b2b;padding:8px;font:12px/1.4 system-ui";
  40 |     layer.append(mark,label);
  41 |     document.body.append(layer);
  42 |   }, info.title);
  43 |   await info.attach("marked-live-proof", { body: await page.screenshot(), contentType: "image/png" });
  44 | });
  45 |
  46 | test("Social Studio shows the shorter help on desktop and phone", async ({ page }) => {
  47 |   for (const width of [1440, 390]) {
  48 |     await page.setViewportSize({ width, height: 900 });
  49 |     await openScreen(page, "/app/social-studio.html", OWNER);
  50 |     await expect(page.locator("#ssSuiteMsg")).toHaveText("Brand-matched drafts. Review them below before sending.");
  51 |     const connection = await page.locator("#oauthConnectBox").evaluate((element) =>
  52 |       Array.from(element.childNodes).filter((node) => node.nodeType === Node.TEXT_NODE || node.nodeName === "B")
  53 |         .map((node) => node.textContent).join(" ").replace(/\s+/g, " ").trim());
  54 |     expect(connection).toBe("Connect Facebook, Instagram or LinkedIn. Other networks are unavailable. Disabled buttons mean setup is needed. Sign-in keys stay private.");
> 55 |     await expect(page.locator("#vWhat")).toHaveText("Write a post to preview its copy check.");
     |                                          ^ Error: expect(locator).toHaveText(expected) failed
  56 |     expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  57 |     await page.unroute("**/api/**");
  58 |   }
  59 | });
  60 |
  61 | test("all seven changed published assets match the release source", async ({ request }, info) => {
  62 |   const source = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  63 |   const paths = ["shell.js", "crm-sidebar.css", "social-studio.html", "cc-tab-ideas.js", "marketing-cc-settings.js", "marketing-cc-scripts.js", "pipeline.html"];
  64 |   const hash = data => crypto.createHash("sha256").update(data).digest("hex");
  65 |   const results = [];
  66 |   for (const file of paths) {
  67 |     const response = await request.get(`/app/${file}?release=${source}`, { headers: { "cache-control": "no-cache" } });
  68 |     expect(response.ok(), file).toBe(true);
  69 |     const expected = hash(fs.readFileSync(`public/app/${file}`));
  70 |     const actual = hash(await response.body());
  71 |     results.push({ path: `/app/${file}`, expected, actual, matches: expected === actual });
  72 |   }
  73 |   await info.attach("asset-byte-receipt", { body: JSON.stringify({ source, checkedAt: new Date().toISOString(), site: "https://fundhub.ai", readOnly: true, results }, null, 2), contentType: "application/json" });
  74 |   expect(results.filter(row => !row.matches), "Published assets must match this release").toEqual([]);
  75 | });
  76 |
```
