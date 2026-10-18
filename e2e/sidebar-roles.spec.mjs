// Playwright: sidebar item set per role + fixed geometry across navigation.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openScreen, OWNER, CLOSER } from "./harness.mjs";

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "app");
const SCREENS = new Set(fs.readdirSync(APP).filter((f) => f.endsWith(".html")));

const SALES_MANAGER = {
  ok: true,
  staff: {
    id: "staff-sm", name: "Sarah Whitfield", email: "sarah@fundhub.ai",
    role: "sales_manager", org_id: "org-1", status: "active"
  }
};

const FUNDING_ADVISOR = {
  ok: true,
  staff: {
    id: "staff-fa", name: "Alex Funding", email: "alex@fundhub.ai",
    role: "funding_advisor", org_id: "org-1", status: "active"
  }
};

const SETTER = {
  ok: true,
  staff: {
    id: "staff-set", name: "Sam Setter", email: "sam@fundhub.ai",
    role: "setter", org_id: "org-1", status: "active"
  }
};

const CLOSER_DESK = ["my-numbers.html"];
const SALES_FLOOR = ["sales-floor.html"];
/* The lender database. ROLE_SETS.LENDERS at the API (owner, admin,
   funding_advisor) and ADVISOR_ONLY in shell.js — owner decision 2026-08-17. */
const ADVISOR_ONLY = ["lenders.html"];
const OWNER_ADMIN_ONLY = ["contracts.html"];
const RETIRED = ["journeys.html", "hiring.html"];
const PORTAL_ONLY = ["client-portal.html", "affiliate.html"];

async function waitForGate(page) {
  await page.waitForFunction(() => {
    const chip = document.getElementById("fh-shell-chip");
    const gated = document.querySelector("[data-fh-gated]");
    const side = document.getElementById("side");
    return Boolean((chip || gated) && side);
  }, null, { timeout: 10000 });
  await page.waitForTimeout(200);
}

async function visibleNavHrefs(page) {
  await waitForGate(page);
  return page.evaluate(() => {
    const out = [];
    for (const a of document.querySelectorAll("a.navitem")) {
      const style = window.getComputedStyle(a);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (a.hasAttribute("data-fh-gated")) continue;
      const href = (a.getAttribute("data-fh-href") || a.getAttribute("href") || "")
        .replace(/^\.\//, "")
        .split("?")[0]
        .split("#")[0];
      if (href.endsWith(".html")) out.push(href);
    }
    return out;
  });
}

async function sideBox(page) {
  await waitForGate(page);
  return page.locator("aside.side#side").evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.round(r.width),
      position: cs.position
    };
  });
}

function expectIncludes(hrefs, required) {
  for (const h of required) expect(hrefs, `missing ${h}`).toContain(h);
}
function expectExcludes(hrefs, forbidden) {
  for (const h of forbidden) expect(hrefs, `should not show ${h}`).not.toContain(h);
}

test.describe("sidebar role visibility", () => {
  test("closer sees closer desk, not sales floor or owner-only rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", CLOSER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, CLOSER_DESK);
    expectIncludes(hrefs, ["pipeline.html", "closer-dashboard.html"]);
    expectExcludes(hrefs, [...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("sales_manager sees sales floor, not closer desk", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SALES_MANAGER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, SALES_FLOOR);
    expectExcludes(hrefs, [...CLOSER_DESK, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("owner sees the active desks and owner-only rows, not retired rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...ADVISOR_ONLY]);
    expectExcludes(hrefs, RETIRED);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("funding_advisor sees the lender database, not closer desk, sales floor, portals, or hiring", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", FUNDING_ADVISOR);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html", ...ADVISOR_ONLY]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("setter does not see closer desk, sales floor, or the lender database", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SETTER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html"]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });
});

test.describe("sidebar fixed geometry", () => {
  test("rail stays fixed and identical across page navigation", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    const a = await sideBox(page);
    expect(a.position).toBe("fixed");
    expect(a.left).toBe(0);
    expect(a.top).toBe(0);
    expect(a.width).toBeGreaterThanOrEqual(220);
    expect(a.width).toBeLessThanOrEqual(250);

    // Navigate via a real sidebar link — geometry must not jump.
    await page.locator('aside.side a.navitem[href="closer-dashboard.html"]').click();
    await page.waitForURL(/closer-dashboard\.html/);
    await waitForGate(page);
    const b = await sideBox(page);
    expect(b).toEqual(a);

    const insights = page.locator('aside.side [data-fh-section="insights"]');
    if (!(await insights.locator('a[href="sales-floor.html"]').isVisible())) {
      await insights.getByRole('button', { name: 'Insights' }).click();
    }
    await insights.locator('a[href="sales-floor.html"]').click();
    await page.waitForURL(/sales-floor\.html/);
    await waitForGate(page);
    const c = await sideBox(page);
    expect(c).toEqual(a);

    await page.goto("/app/my-numbers.html");
    await waitForGate(page);
    const d = await sideBox(page);
    expect(d.position).toBe("fixed");
    expect(d.left).toBe(0);
    expect(d.top).toBe(0);
    expect(d.width).toBe(a.width);
  });

  test("section order matches the simplified shell structure", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    await waitForGate(page);
    const heads = await page.locator("aside.side .navhead").allTextContents();
    const labels = heads.map((h) => h.replace(/[▾⌄]/g, "").trim());
    expect(labels).toEqual(["Your work", "Clients", "Insights", "Marketing", "Automation", "Manage"]);
  });
});
