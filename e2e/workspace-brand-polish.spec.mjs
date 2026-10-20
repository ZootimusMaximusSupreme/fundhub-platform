import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { openScreen, OWNER } from "./harness.mjs";

const BLUE = ["#4866D7", "#5A7BE7", "#7697ED", "#8BB6EF", "#A5CDF0", "#B9ACDF"];
const PASTELS = ["242, 166, 155", "245, 206, 143", "242, 227, 155", "168, 216, 176", "169, 198, 232", "196, 179, 229"];
const FUNDHUB = {
  slug: "fundhub", entity_name: "Fundhub", ink: "#0D1113", paper: "#F8F8F6",
  ramp: BLUE, display_face: "Inter", mono_face: "JetBrains Mono", wordmark_url: null
};
const SHOTS = process.env.UX_POLISH_SHOTS === "1";
const evidence = path.resolve("ops/workflows/dashboard-ux-polish/evidence");

async function stripe(page) {
  return page.locator(".side-top").evaluate((el) => getComputedStyle(el, "::after").backgroundImage);
}

async function shot(page, file, selector, caption, corrected) {
  if (!SHOTS) return;
  fs.mkdirSync(evidence, { recursive: true });
  await page.evaluate(({ selector, caption, corrected }) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(`Review target missing: ${selector}`);
    const r = el.getBoundingClientRect();
    const color = corrected ? "#15803d" : "#c52b2b";
    const layer = document.createElement("div");
    layer.id = "ux-polish-review-marks";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    const mark = document.createElement("div");
    mark.style.cssText = `position:absolute;left:${Math.max(2, r.left - 2)}px;top:${Math.max(2, r.top - 2)}px;width:${r.width + 4}px;height:${r.height + 4}px;border:2px solid ${color};box-sizing:border-box;border-radius:6px`;
    const number = document.createElement("span");
    number.textContent = "1";
    number.style.cssText = `position:absolute;top:2px;right:2px;width:20px;height:20px;border-radius:50%;background:${color};color:white;text-align:center;font:700 12px/20px system-ui`;
    mark.appendChild(number);
    layer.appendChild(mark);
    const legend = document.createElement("div");
    legend.textContent = `${corrected ? "DRAFT FIX" : "BEFORE"} · 1. ${caption} · Fictional review data`;
    legend.style.cssText = `position:absolute;bottom:12px;left:12px;right:12px;padding:10px 12px;border:2px solid ${color};border-radius:6px;background:#fff;color:#111;font:12px/1.4 system-ui`;
    layer.appendChild(legend);
    document.body.appendChild(layer);
  }, { selector, caption, corrected });
  await page.screenshot({ path: path.join(evidence, file), fullPage: false });
  await page.locator("#ux-polish-review-marks").evaluate((el) => el.remove());
}

async function baseline(page, mobile) {
  if (!SHOTS) return;
  const sources = Object.fromEntries(["shell.js", "crm-sidebar.css"].map((file) => [file,
    execFileSync("git", ["show", `842ebfc6e:public/app/${file}`], { encoding: "utf8" })]));
  const matcher = /\/app\/(shell\.js|crm-sidebar\.css)(\?|$)/;
  await page.route(matcher, (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    return route.fulfill({ contentType: file.endsWith(".js") ? "text/javascript" : "text/css", body: sources[file] });
  });
  await openScreen(page, "/app/calendar.html", OWNER, { "/api/org-brand": { ok: true, brand: FUNDHUB } });
  await expect(page.locator("#fh-workspace-header")).toBeVisible();
  await shot(page, `${mobile ? "phone" : "desktop"}-before-MARKED.png`, mobile ? "#fh-menu-btn" : ".side-top",
    mobile ? "Replace the three-line menu with the Fundhub F mark." : "Use the brand pastel rainbow below the wordmark.", false);
  await page.unroute(matcher);
  await page.unroute("**/api/**");
}

test("Fundhub sidebar uses all six pastel stops despite the saved blue ramp", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await baseline(page, false);
  await openScreen(page, "/app/calendar.html", OWNER, { "/api/org-brand": { ok: true, brand: FUNDHUB } });
  await expect.poll(() => stripe(page)).toContain(PASTELS[0]);
  const gradient = await stripe(page);
  for (const rgb of PASTELS) expect(gradient).toContain(rgb);
  expect(await page.locator(".side .logo").evaluate((el) => getComputedStyle(el).backgroundImage)).not.toBe("none");
  const otherBrandSpectrum = await page.evaluate(() => document.documentElement.style.getPropertyValue("--spectrum"));
  expect(otherBrandSpectrum).toContain(BLUE[0]);
  await shot(page, "desktop-after-MARKED.png", ".side-top", "Fundhub wordmark with the six-stop pastel rainbow.", true);
});

test("the F mark beside Calendar opens the phone menu and preserves keyboard return", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await baseline(page, true);
  await openScreen(page, "/app/calendar.html", OWNER, { "/api/org-brand": { ok: true, brand: FUNDHUB } });
  const menu = page.getByRole("button", { name: "Open menu", exact: true });
  await expect(menu.locator(".fh-menu-mark")).toBeVisible();
  const image = await menu.locator(".fh-menu-mark").evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(image).toContain("/favicon.svg");
  await expect(page.locator("#fh-workspace-header h1")).toHaveText("Calendar");
  await shot(page, "phone-after-MARKED.png", "#fh-menu-btn", "The Fundhub F mark opens the same navigation menu.", true);
  await menu.click();
  await expect(page.locator("#side")).toHaveClass(/open/);
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(page.locator("#side")).not.toHaveClass(/open/);
  await expect(menu).toBeFocused();
  await menu.click();
  await page.locator("#side .navitem[href='pipeline.html']").click();
  await expect(page).toHaveURL(/pipeline\.html/);
  await expect(page.locator("#fh-workspace-header h1")).toHaveText("Pipeline");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("another company retains its own sidebar spectrum and approved menu logo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const custom = { ...FUNDHUB, slug: "other-company", entity_name: "Other Company", wordmark_url: "https://brand.example.test/wordmark.svg" };
  await page.route(custom.wordmark_url, (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40"><rect width="100" height="40" fill="#4866D7"/></svg>' }));
  await openScreen(page, "/app/calendar.html", OWNER, { "/api/org-brand": { ok: true, brand: custom } });
  await expect.poll(() => page.locator(".fh-menu-mark").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(custom.wordmark_url);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect.poll(() => stripe(page)).toContain("72, 102, 215");
  expect(await stripe(page)).not.toContain(PASTELS[0]);
  await page.evaluate(() => document.documentElement.style.setProperty("--spectrum", "linear-gradient(90deg,#123456,#654321)"));
  await expect.poll(() => stripe(page)).toContain("18, 52, 86");
});

test("the compact desktop rail still expands and the phone F control fits at 320px", async ({ page }) => {
  await openScreen(page, "/app/calendar.html", OWNER, { "/api/org-brand": { ok: true, brand: FUNDHUB } });
  await page.getByRole("button", { name: "Collapse sidebar", exact: true }).click();
  await expect(page.locator("#side")).toHaveClass(/mini/);
  await page.getByRole("button", { name: "Expand sidebar", exact: true }).click();
  await expect(page.locator("#side")).not.toHaveClass(/mini/);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator(".fh-menu-mark")).toBeVisible();
  const box = await page.locator("#fh-menu-btn").boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
});

test("a failed Kanban read gives one recovery step and keeps counts unknown", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/org-brand": { ok: true, brand: FUNDHUB },
      "/api/dashboard/pipeline": (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "nodb", message: "internal database detail" }) })
    });
    await expect(page.locator("#boardStatus")).toHaveText("Sales — could not load the board. Refresh to try again.");
    await expect(page.locator("#hlUsN")).toHaveText("—");
    await expect(page.locator("body")).not.toContainText("internal database detail");
    await expect(page.locator("body")).not.toContainText("nodb");
    await shot(page, `kanban-error-after-${width}-MARKED.png`, "#boardStatus", "A failed read gives a recovery step; counts stay unknown.", true);
    await page.unroute("**/api/**");
  }
});
