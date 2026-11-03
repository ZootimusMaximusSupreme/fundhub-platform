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


const COMPANY_OWNER = { ...OWNER, staff: { ...OWNER.staff,
  id: "00000000-0000-4000-8000-000000000091", org_id: "00000000-0000-4000-8000-000000000092" } };
const COMPANY_EMPTY_API = {
  "/api/owner/company-bank": { ok: true, configured: false, items: [], accounts: [], transactions: [] },
  "/api/owner/company-cash": { ok: true, summary: { month: "2026-11-01", bank_posted_cents: null,
    bank_available_cents: null, available_cents: null, known_remaining_cents: null,
    crs_reserve_cents: null, crs_fulfilled_pull_count: 0, crs_unpriced_pull_count: 0,
    ad_approved_unpaid_cents: 0, tech_due_cents: 0, meta_spend_cents: null,
    processor_receipts_cents: null, missing: ["business_bank_balance", "crs_invoice", "ad_review", "tech_review"] },
    account: null, obligations: [], recurring_candidates: [] }
};

test("company cash is reached through the owner account menu and has a real way back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, "/app/calendar.html", COMPANY_OWNER, COMPANY_EMPTY_API);
  await page.locator("#fh-shell-chip-show").click();
  const company = page.getByRole("link", { name: "Company cash", exact: true });
  await expect(company).toBeVisible();
  const menuBox = await company.boundingBox();
  expect(menuBox.height).toBeGreaterThanOrEqual(44);
  expect(await company.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await company.click();
  await expect(page).toHaveURL(/\/app\/company-cash\.html$/);
  await expect(page.locator("#fh-workspace-header")).toHaveAttribute("data-fh-scope", "company-cash");
  await expect(page.locator("#fh-workspace-scope")).toHaveCount(0);
  const back = page.getByRole("link", { name: "Team & payouts", exact: true });
  await expect(back).toBeVisible();
  expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
  expect(await back.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
  await back.click();
  await expect(page).toHaveURL(/\/app\/staff-teams\.html/);
});

for (const role of ["admin", "closer", "sales_manager", "setter"]) {
  test(`${role} cannot see or open the company cash workspace`, async ({ page }) => {
    const session = { ...COMPANY_OWNER, staff: { ...COMPANY_OWNER.staff, role } };
    await openScreen(page, "/app/calendar.html", session);
    await page.locator("#fh-shell-chip-show").click();
    await expect(page.getByRole("link", { name: "Company cash", exact: true })).toHaveCount(0);
    await page.goto("/app/company-cash.html");
    await expect(page).not.toHaveURL(/\/app\/company-cash\.html$/);
  });
}
