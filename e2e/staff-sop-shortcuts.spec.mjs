// Offline browser acceptance: employee SOP document shortcuts -> existing Company Brain.
// No production sessions, providers, credit pulls or outbound messages.
import { test, expect } from "@playwright/test";
import { wireApi, withSession, json, OWNER, CLOSER, PARTNER } from "./harness.mjs";

const SCREENS = {
  "setter-dashboard.html": "setter",
  "closer-dashboard.html": "closer",
  "sales-floor.html": "sales",
  "pipeline.html": "onboarding",
  "bank-outreach.html": "bank-outreach",
  "lenders.html": "lenders",
  "inquiry-remover.html": "credit-repair",
  "client-control-panel.html": "funding",
  "csm-queue.html": "client-success",
  "ops-admin.html": "operations",
  "finance-os.html": "finance",
  "messaging.html": "communications"
};
const STAFF = (role) => ({ ok: true, staff: {
  id: "staff-fixture", name: "Taylor Test", email: "test@fundhub.example",
  role, org_id: "org-fixture", status: "active"
}});
const selectors = {
  shortcut: "#fh-sop-shortcut",
  search: "#fh-shell-search-btn",
  docs: "#chat.docs-open #docs"
};

async function setup(page, session = OWNER, handlers = {}) {
  await withSession(page, session);
  await wireApi(page, session, {
    "/api/company-brain/threads": { ok: true, threads: [] },
    "/api/company-brain/upload": { ok: true, uploads: [], pendingCount: 0 },
    "/api/company-brain/reviews": { ok: true, reviews: [] },
    ...handlers
  });
}

test("all twelve working desks have one real SOP link in the staff header; existing refresh stays", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setup(page);
  for (const [screen, topic] of Object.entries(SCREENS)) {
    await page.goto("/app/" + screen);
    const link = page.locator(selectors.shortcut);
    await expect(link, screen + " has the staff SOP shortcut").toBeVisible();
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "company-brain.html?sop=" + topic);
    await expect(link).toHaveAttribute("aria-label", /scripts and SOPs/i);
    await expect(link).toHaveAttribute("data-fh-sop-topic", topic);
    await expect(page.locator("#fh-workspace-header")).toBeVisible();
  }
  await page.goto("/app/setter-dashboard.html");
  await expect(page.locator("#setter-refresh")).toBeVisible();
  await expect(page.locator(selectors.search)).toBeVisible();
  await page.goto("/app/csm-queue.html");
  await expect(page.locator("#qRefresh")).toBeVisible();
});

test("staff clicks document icon, gets contextual Company Brain files and explicit source-backed search, then Back returns to dashboard", async ({ page }) => {
  const asks = [];
  await setup(page, STAFF("setter"), {
    "/api/read/company-brain": async (route) => {
      asks.push(route.request().postDataJSON());
      await json(route, { ok: true, thread_id: "7b000000-0000-4000-8000-000000000001",
        answer: { text: "Approved instructions, according to the cited source." }, sources: [] });
    }
  });
  await page.goto("/app/setter-dashboard.html");
  await expect(page.locator(selectors.shortcut)).toBeVisible();
  await page.locator(selectors.shortcut).click();
  await expect(page).toHaveURL(/company-brain\.html\?sop=setter$/);
  await expect(page.locator(selectors.docs)).toBeVisible();
  await expect(page.locator("#fh-sop-title")).toHaveText("Setter scripts and onboarding");
  await expect(page.locator("#docList")).toContainText("No files added yet");
  expect(asks).toEqual([]); // navigation itself MUST NOT write a chat message.
  await page.getByRole("button", { name: "Find approved instructions" }).click();
  await expect.poll(() => asks.length).toBe(1);
  expect(asks[0].question).toMatch(/setter calling script.*logging dials/i);
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
  await expect(page.locator("#msgs")).toContainText("Approved instructions");
  await page.goBack();
  await expect(page).toHaveURL(/setter-dashboard\.html$/);
  await expect(page.locator(selectors.shortcut)).toBeVisible();
});

test("phone shortcut has a 44px target, opens docs, searches and returns without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const asks = [];
  await setup(page, CLOSER, {
    "/api/read/company-brain": async (route) => {
      asks.push(route.request().postDataJSON());
      await json(route, { ok: true, answer: { text: "See approved closer script." }, sources: [] });
    }
  });
  await page.goto("/app/closer-dashboard.html");
  const link = page.locator(selectors.shortcut);
  await expect(link).toBeVisible();
  const rect = await link.boundingBox();
  expect(rect && rect.width).toBeGreaterThanOrEqual(44);
  expect(rect && rect.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page).toHaveURL(/company-brain\.html\?sop=closer$/);
  await expect(page.locator(selectors.docs)).toBeVisible();
  await page.locator("#fh-sop-find").click();
  await expect.poll(() => asks.length).toBe(1);
  expect(asks[0].question).toMatch(/closer discovery and sales scripts/);
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
  await expect(page.locator("#msgs")).toContainText("approved closer script");
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.goBack();
  await expect(page).toHaveURL(/closer-dashboard\.html$/);
});

test("roles without Company Brain permissions and customer/partner portals never show staff SOP shortcuts", async ({ page }) => {
  await setup(page, STAFF("outbound_rep"));
  await page.goto("/app/bank-outreach.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
  // outbound_rep is NOT in ROLE_SETS.STAFF. Do not widen that gate just for a link.
  await setup(page, PARTNER);
  await page.goto("/app/partner-training.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
  await setup(page, STAFF("client"));
  await page.goto("/app/client-portal.html");
  await expect(page.locator(selectors.shortcut)).toHaveCount(0);
});

test("all deep-link topics are finite; bogus or injected SOP values render no instruction card", async ({ page }) => {
  await setup(page, OWNER);
  await page.goto("/app/company-brain.html?sop=%3Cscript%3E");
  await expect(page.locator("#fh-sop-context")).toBeHidden();
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
  await page.goto("/app/company-brain.html?sop=made-up");
  await expect(page.locator("#fh-sop-context")).toBeHidden();
  await expect(page.locator("#chat")).not.toHaveClass(/docs-open/);
});
