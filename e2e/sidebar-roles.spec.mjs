// Playwright: role-scoped website menu with no persistent left rail.
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

const OUTBOUND_REP = {
  ok: true,
  staff: {
    id: "staff-outbound", name: "Casey Outreach", email: "casey@fundhub.ai",
    role: "outbound_rep", org_id: "org-1", status: "active"
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
const OUTREACH = ["bank-outreach.html"];

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
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await expect(page.locator("#side")).toBeVisible();
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
      position: cs.position,
      visibility: cs.visibility,
      inert: el.inert,
      pagePadding: Math.round(parseFloat(getComputedStyle(document.querySelector(".app,.app-shell")).paddingLeft))
    };
  });
}

async function markedMenuShot(page, selector, file, caption) {
  if (process.env.WEBSITE_NAV_SHOTS !== "1") return;
  const folder = path.resolve(APP, "../../ops/workflows/portal-tab-jump-2026-11-04");
  await page.evaluate(({ selector, caption }) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    const mark = document.createElement("div");
    mark.id = "fh-nav-review-mark";
    mark.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
    const cx = r.left + Math.min(r.width / 2, 310);
    const cy = r.top + Math.min(r.height / 2, 240);
    const rx = Math.min(r.width / 2 + 5, 315);
    const ry = Math.min(r.height / 2 + 5, 245);
    mark.innerHTML = `<svg width="100%" height="100%"><defs><marker id="fh-arrow" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#ffd100"/></marker></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#df222b" stroke-width="4"/><circle cx="${cx + rx - 3}" cy="${cy - ry + 8}" r="16" fill="#df222b"/><text x="${cx + rx - 3}" y="${cy - ry + 14}" text-anchor="middle" fill="#fff" font-size="17" font-weight="bold">1</text><path d="M${Math.min(innerWidth - 20, cx + rx + 125)} ${cy}L${cx + rx - 6} ${cy}" stroke="#ffd100" stroke-width="6" marker-end="url(#fh-arrow)"/></svg><div style="position:absolute;left:16px;bottom:16px;padding:10px 14px;background:#fff;color:#111;border:2px solid #df222b;border-radius:8px;font:600 14px Arial,sans-serif">1. ${caption}</div>`;
    document.body.appendChild(mark);
  }, { selector, caption });
  await page.screenshot({ path: path.join(folder, file) });
  await page.locator("#fh-nav-review-mark").evaluate((el) => el.remove());
}

function expectIncludes(hrefs, required) {
  for (const h of required) expect(hrefs, `missing ${h}`).toContain(h);
}
function expectExcludes(hrefs, forbidden) {
  for (const h of forbidden) expect(hrefs, `should not show ${h}`).not.toContain(h);
}

test.describe("website menu role visibility", () => {
  test("closer sees closer desk, not sales floor or owner-only rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", CLOSER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, CLOSER_DESK);
    expectIncludes(hrefs, ["pipeline.html", "closer-dashboard.html"]);
    expectExcludes(hrefs, [...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY, ...OUTREACH]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("sales_manager sees sales floor, not closer desk", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SALES_MANAGER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, [...SALES_FLOOR, ...OUTREACH]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("owner sees the active desks and owner-only rows, not retired rows", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...ADVISOR_ONLY, ...OUTREACH]);
    expectExcludes(hrefs, RETIRED);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("funding_advisor sees the lender database, not closer desk, sales floor, portals, or hiring", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", FUNDING_ADVISOR);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html", ...ADVISOR_ONLY]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...OUTREACH]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });

  test("setter does not see closer desk, sales floor, or the lender database", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", SETTER);
    const hrefs = await visibleNavHrefs(page);
    expectIncludes(hrefs, ["pipeline.html"]);
    expectExcludes(hrefs, [...CLOSER_DESK, ...SALES_FLOOR, ...OWNER_ADMIN_ONLY, ...RETIRED, ...PORTAL_ONLY, ...ADVISOR_ONLY, ...OUTREACH]);
    for (const h of hrefs) expect(SCREENS.has(h), `broken nav link ${h}`).toBe(true);
  });
  test("outbound rep sees only the assigned-bank outreach workspace", async ({ page }) => {
    await openScreen(page, "/app/bank-outreach.html", OUTBOUND_REP);
    expect(await visibleNavHrefs(page)).toEqual(OUTREACH);
    await expect(page.locator("#fh-shell-search-btn")).toHaveCount(0);
    await expect(page.locator("#fh-chat-fab")).toHaveCount(0);
  });
});

test.describe("website menu without a sidebar", () => {
  test("every staff dashboard loads shared CSS before the shell", () => {
    const staffPages = [...SCREENS].filter((file) => {
      if (file.endsWith(".fragment.html")) return false;
      const html = fs.readFileSync(path.join(APP, file), "utf8").replace(/<!--[\s\S]*?-->/g, "");
      const hasSidebar = /<[^>]+\bid\s*=\s*["']side["']/i.test(html)
        || /<aside\b[^>]*\bclass\s*=\s*["'][^"']*\bside\b/i.test(html);
      return hasSidebar && /<script\b[^>]*\bsrc=["'][^"']*shell\.js["']/i.test(html);
    });
    expect(staffPages.length).toBeGreaterThan(30);
    for (const file of staffPages) {
      const html = fs.readFileSync(path.join(APP, file), "utf8");
      const head = html.replace(/<!--[\s\S]*?-->/g, "").split(/<\/head>/i)[0];
      const shell = head.search(/<script\b[^>]*\bsrc=["'][^"']*shell\.js["']/i);
      expect(shell, file).toBeGreaterThan(-1);
      const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
      for (const css of ["fundhub-brand.css", "crm-sidebar.css"]) {
        const link = links.find((tag) => /\brel\s*=\s*["']stylesheet["']/i.test(tag)
          && tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1]?.includes(css));
        expect(link, `${file} needs ${css} in the head`).toBeTruthy();
        expect(head.indexOf(link), `${file} must load ${css} before shell.js`).toBeLessThan(shell);
      }
    }
  });

  test("desktop menu reaches key desks and leaves every page full width", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    const a = await sideBox(page);
    expect(a.position).toBe("fixed");
    expect(a.visibility).toBe("hidden");
    expect(a.inert).toBe(true);
    expect(a.pagePadding).toBe(0);
    await markedMenuShot(page, "#fh-menu-btn", "website-rail-removed-MARKED.png", "Full-width workspace; routes open from the F menu.");

    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    await expect(page.locator("#side")).toBeVisible();
    await markedMenuShot(page, "#side", "website-menu-open-MARKED.png", "Role-gated routes open in a compact menu.");
    await page.locator('aside.side a.navitem[href="closer-dashboard.html"]').click();
    await page.waitForURL(/closer-dashboard\.html/);
    await waitForGate(page);
    const b = await sideBox(page);
    expect(b.visibility).toBe("hidden");
    expect(b.pagePadding).toBe(0);

    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const insights = page.locator('aside.side [data-fh-section="insights"]');
    if (!(await insights.locator('a[href="sales-floor.html"]').isVisible())) {
      await insights.getByRole('button', { name: 'Insights' }).click();
    }
    await insights.locator('a[href="sales-floor.html"]').click();
    await page.waitForURL(/sales-floor\.html/);
    await waitForGate(page);
    const c = await sideBox(page);
    expect(c.visibility).toBe("hidden");
    expect(c.pagePadding).toBe(0);

    await page.goto("/app/my-numbers.html");
    await waitForGate(page);
    const d = await sideBox(page);
    expect(d.visibility).toBe("hidden");
    expect(d.pagePadding).toBe(0);
  });

  test("menu stays hidden on each new page even when shared CSS is slow", async ({ page }) => {
    await page.addInitScript(() => {
      window.__sidebarFrames = [];
      function sample() {
        const side = document.querySelector("aside.side#side");
        const icon = document.querySelector('aside.side#side .navitem[href="pipeline.html"] .ico svg');
        if (icon && side) {
          const rect = icon.getBoundingClientRect();
          if (rect.width && rect.height) window.__sidebarFrames.push({
            width: rect.width,
            height: rect.height,
            visibility: getComputedStyle(side).visibility,
            pagePadding: parseFloat(getComputedStyle(document.querySelector(".app,.app-shell")).paddingLeft)
          });
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await openScreen(page, "/app/pipeline.html", OWNER);
    await waitForGate(page);
    const sharedCssRequests = [];
    await page.route(/\/app\/(?:crm-sidebar|fundhub-brand)\.css(?:\?.*)?$/, async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      sharedCssRequests.push(pathname);
      if (pathname.endsWith("crm-sidebar.css")) await new Promise((resolve) => setTimeout(resolve, 600));
      await route.continue();
    });

    for (const screen of ["setter-dashboard.html", "closer-dashboard.html", "calendar.html"]) {
      sharedCssRequests.length = 0;
      await page.getByRole("button", { name: "Open menu", exact: true }).click();
      await page.locator(`aside.side a.navitem[href="${screen}"]`).click();
      await page.waitForURL(new RegExp(screen.replace(".", "\\.")));
      await page.waitForTimeout(750);
      const frames = await page.evaluate(() => window.__sidebarFrames || []);
      expect(frames.length, `${screen} should record painted frames`).toBeGreaterThan(0);
      expect(Math.max(...frames.map((frame) => frame.width)), screen).toBeLessThanOrEqual(24);
      expect(Math.max(...frames.map((frame) => frame.height)), screen).toBeLessThanOrEqual(24);
      for (const frame of frames) {
        expect(frame.visibility, screen).toBe("hidden");
        expect(frame.pagePadding, screen).toBe(0);
      }
      expect(sharedCssRequests.filter((path) => path.endsWith("crm-sidebar.css")), screen).toHaveLength(1);
      expect(sharedCssRequests.filter((path) => path.endsWith("fundhub-brand.css")), screen).toHaveLength(1);
    }
  });

  test("section order matches the simplified shell structure", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER);
    await waitForGate(page);
    const heads = await page.locator("aside.side .navhead").allTextContents();
    const labels = heads.map((h) => h.replace(/[▾⌄]/g, "").trim());
    expect(labels).toEqual(["Relationships", "Your work", "Clients", "Insights", "Marketing", "Automation", "Manage"]);
  });
});
