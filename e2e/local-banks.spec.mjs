// The local banks component (public/app/local-banks.js) in a real browser, at
// 1440, 390 and 320 wide: the four states, the plan for the next 6 months, the
// branches near you, 44px controls, nothing clipped and no sideways scroll.
//
// The component is mounted the way a page mounts it (a <div data-fh-local-banks>
// plus its stylesheet and script) inside a bare host page that loads the same
// shared Astra sheets as /app/financeos.html. The host page is served by this
// test only; it is not a file in public/. Every /api call is answered here from
// payloads the REAL back end builds (src/http/fixtures/local-banks.sample.mjs).
import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { samplePayloads } from "../src/http/fixtures/local-banks.sample.mjs";
import { withSession } from "./harness.mjs";

const BANKS_READ = JSON.parse(fs.readFileSync(new URL("../src/http/fixtures/money-banks.sample.json", import.meta.url), "utf8"));
/* The two lines root adds to public/app/financeos.html to mount the component. */
const MOUNT_CSS = '<link rel="stylesheet" href="/app/local-banks.css">';
const MOUNT_JS = '<script defer src="/app/local-banks.js"></script>';

const HOST = "/app/__local-banks-check.html";
const EVIDENCE = "ops/workflows/build-evidence/finance-os-local-banks-2026-11-07";
const P = await samplePayloads(new Date().toISOString().slice(0, 10));
fs.mkdirSync(EVIDENCE, { recursive: true });

const HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local banks check</title>
<link rel="stylesheet" href="/app/fundhub-font.css">
<link rel="stylesheet" href="/app/fundhub-brand.css">
<link rel="stylesheet" href="/app/money-workspace.css">
<link rel="stylesheet" href="/app/bank-logo.css">
<link rel="stylesheet" href="/app/fundhub-astra.css">
<link rel="stylesheet" href="/app/fundhub-astra-client.css">
<link rel="stylesheet" href="/app/local-banks.css">
<style>/* host page only: the real pages carry their own shell reset */*,*::before,*::after{box-sizing:border-box}body{margin:0}main{padding:16px}</style>
</head><body class="fh-astra"><main class="fh-astra-page"><div data-fh-local-banks></div></main>
<script defer src="/app/bank-logo.js"></script>
<script defer src="/app/local-banks.js"></script></body></html>`;

async function host(page, { state = "full" } = {}) {
  const seen = { gets: [] };
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  let current = state;
  await page.route(`**${HOST}*`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    /* A held answer can arrive after the page reloaded; that one is simply dropped. */
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) }).catch(() => {});
    if (url.pathname !== "/api/money/banks" || req.method() !== "GET") return json({ ok: false }, 404);
    seen.gets.push(url.search);
    if (current === "loading") await held;
    if (current === "error") return json({ ok: false, db: "down" }, 503);
    if (current === "needs") return json(P.needsAddress);
    if (current === "none") return json(P.noneNear);
    if (current === "unavailable") return json(P.unavailable);
    return json(P.full);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { seen, errors, release, set: (s) => { current = s; } };
}

async function noSidewaysScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Every visible button and link inside the component is at least 44 by 44. */
async function bigTargets(page) {
  const small = await page.evaluate(() => [...document.querySelectorAll(".fh-local-banks button, .fh-local-banks a")]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim(), w: r.width, h: r.height }; })
    .filter((r) => r.w < 44 || r.h < 44));
  expect(small).toEqual([]);
}

/** Nothing spills out of its panel, and no two parts of a row sit on top of each other. */
async function nothingClipped(page) {
  const bad = await page.evaluate(() => {
    const out = [];
    for (const panel of document.querySelectorAll(".fh-local-banks .lb-panel")) {
      const box = panel.getBoundingClientRect();
      if (panel.scrollWidth > panel.clientWidth + 1) out.push("panel scrolls sideways");
      for (const el of panel.querySelectorAll("b, .lb-cap, .lb-chip, .lb-btn, .lb-num, img, .lb-dist, dd")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.left < box.left - 1 || r.right > box.right + 1) out.push(`${el.className || el.tagName}: ${el.textContent.trim().slice(0, 30)} spills out`);
      }
      for (const row of panel.querySelectorAll(".lb-row")) {
        const parts = [...row.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width && r.height);
        for (let i = 0; i < parts.length; i += 1) {
          for (let j = i + 1; j < parts.length; j += 1) {
            const a = parts[i], b = parts[j];
            const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
            if (overlap) out.push(`row parts overlap: ${row.textContent.trim().slice(0, 40)}`);
          }
        }
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
}

async function shoot(page, name) {
  await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
}

for (const width of [1440, 390, 320]) {
  test(`Finance OS Banks tab: the local banks box mounts after the bank section at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await withSession(page, { staff: { role: "client" } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route("**/app/financeos.html*", async (route) => {
      const res = await route.fetch();
      const html = (await res.text())
        .replace('<link rel="stylesheet" href="/app/fundhub-astra.css">', `${MOUNT_CSS}\n<link rel="stylesheet" href="/app/fundhub-astra.css">`)
        .replace('<script defer src="financeos.js"></script>', `${MOUNT_JS}\n<script defer src="financeos.js"></script>`);
      await route.fulfill({ response: res, body: html, contentType: "text/html" });
    });
    const views = [];
    await page.route("**/api/**", (route) => {
      const url = new URL(route.request().url());
      const json = (d, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(d) }).catch(() => {});
      if (url.pathname === "/api/auth/session") return json({ ok: true, principal: "client", staff: { role: "client" } });
      if (url.pathname === "/api/money/overview") return json({ ok: true, client: { name: "Alex Sample" }, sandbox: false });
      if (url.pathname === "/api/money/banks") {
        views.push(url.searchParams.get("view") || "full");
        return json(url.searchParams.get("view") === "local_banks" ? P.full : BANKS_READ);
      }
      return json({ ok: true });
    });
    await page.goto("/app/financeos.html#banks");
    const panel = page.locator("#fos-banks");
    await expect(panel.locator(".fh-banks")).toContainText("Chase");
    const box = panel.locator(".fos-extra .fh-local-banks");
    await expect(box.getByRole("heading", { name: "Your bank plan" })).toBeVisible();
    await expect(box.locator(".lb-plan-row")).toHaveCount(P.full.deposit_plan.length);
    expect(views.sort()).toEqual(["full", "local_banks"]);
    await noSidewaysScroll(page);
    await bigTargets(page);
    await nothingClipped(page);
    expect(errors).toEqual([]);
    /* The whole tab as it opens, then the box itself inside the real page. A
       full-page shot after scrolling would draw the fixed side menu at the scroll
       spot, so the box is shot on its own. */
    await shoot(page, `financeos-banks-${width}`);
    await box.scrollIntoViewIfNeeded();
    await box.screenshot({ path: `${EVIDENCE}/financeos-banks-box-${width}.png` });
  });

  test(`local banks: the plan and the branches near you at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page);
    await page.goto(HOST);
    const root = page.locator(".fh-local-banks");
    await expect(root.getByRole("heading", { name: "Your bank plan" })).toBeVisible();
    await expect(root.getByRole("heading", { name: "Branches near you" })).toBeVisible();
    await expect(root.locator(".lb-plan-row")).toHaveCount(P.full.deposit_plan.length);
    await expect(root.locator(".lb-plan-row").first()).toContainText("Chase");
    await expect(root.locator(".lb-plan-row").first()).toContainText("$5,000");
    await expect(root.getByText("Next 6 months · up to 5 banks")).toBeVisible();
    await expect(root.locator(".lb-near-row")).toHaveCount(P.full.local_banks.nearby.length);
    await expect(root.getByText("Home 85004 · Cedar Grove LLC 85281")).toBeVisible();
    await expect(root.locator('img[alt="Chase logo"]').first()).toBeVisible();
    // Miles run between ZIP-area centers, so they say About and the ZIP (Codex CX19).
    await expect(root.locator(".lb-dist").filter({ hasText: " mi " })).toHaveCount(3);
    for (const d of await root.locator(".lb-dist").filter({ hasText: " mi " }).allTextContents()) expect(d).toMatch(/^About \d+(\.\d+)? mi from the Home ZIP$/);
    expect(h.seen.gets).toEqual(["?view=local_banks"]);
    await noSidewaysScroll(page);
    await bigTargets(page);
    await nothingClipped(page);
    expect(h.errors).toEqual([]);
    await shoot(page, `full-${width}`);
  });

  test(`local banks: no address, nothing near, and a failed read at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page, { state: "needs" });
    await page.goto(HOST);
    const root = page.locator(".fh-local-banks");
    await expect(root.getByText("Add your home or business ZIP to see banks near you.")).toBeVisible();
    const add = root.getByRole("link", { name: "Add an address" });
    await expect(add).toHaveAttribute("href", "/app/financeos.html#accounts");
    await noSidewaysScroll(page);
    await bigTargets(page);
    await nothingClipped(page);
    await shoot(page, `empty-${width}`);

    h.set("none");
    await page.reload();
    await expect(root.getByText("No banks found near your addresses.")).toBeVisible();
    await expect(root.locator(".lb-plan-row")).toHaveCount(P.noneNear.deposit_plan.length);
    await nothingClipped(page);
    await shoot(page, `none-near-${width}`);

    h.set("unavailable");
    await page.reload();
    await expect(root.getByRole("alert")).toContainText("This did not load.");
    await bigTargets(page);
    h.set("full");
    await root.getByRole("button", { name: "Try again" }).click();
    await expect(root.getByRole("heading", { name: "Branches near you" })).toBeVisible();
    expect(h.errors).toEqual([]);
  });

  test(`local banks: loading, then an error, then Try again at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page, { state: "loading" });
    await page.goto(HOST);
    const root = page.locator(".fh-local-banks");
    await expect(root.locator('[aria-busy="true"]')).toBeVisible();
    await noSidewaysScroll(page);
    await shoot(page, `loading-${width}`);
    h.set("error");
    h.release();
    await page.reload();
    await expect(root.getByRole("alert")).toContainText("Our records are busy right now.");
    await bigTargets(page);
    await nothingClipped(page);
    await shoot(page, `error-${width}`);
    h.set("full");
    await root.getByRole("button", { name: "Try again" }).click();
    await expect(root.getByRole("heading", { name: "Your bank plan" })).toBeVisible();
    await expect(root.locator(".lb-plan-row")).toHaveCount(P.full.deposit_plan.length);
    expect(h.errors).toEqual([]);
  });
}
