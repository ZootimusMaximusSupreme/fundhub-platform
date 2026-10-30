// Staff & Teams — clock and consent stats show em dash when data is null.

import { test, expect } from "@playwright/test";
import { OWNER, STAFF_ROW, wireApi, gotoScreen } from "./harness.mjs";

test.describe("Staff & Teams empty stats", () => {

  test("ON SHIFT and CONSENT stats show em dash from live roster", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#kShift")).toHaveText("—", { timeout: 10_000 });
    await expect(page.locator("#kConsent")).toHaveText("—");
    await expect(page.locator("#onShiftTxt")).toContainText("— on shift");
  });

  test("roster table renders staff from API", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#rosterBody")).toContainText("Jordan Blake", { timeout: 10_000 });
  });

  test("consent and clock columns show em dash badges", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await expect(page.locator("#rosterBody .badge.b-gray").first()).toHaveText("—");
  });

  test("permission matrix tab switches", async ({ page }) => {
    await wireApi(page, { session: OWNER });
    await gotoScreen(page, "staff-teams.html");
    await page.locator('.tab[data-tab="perms"]').click();
    await expect(page.locator("#tab-perms")).toBeVisible();
    await expect(page.locator("#permCount")).toBeVisible();
  });

  test("telemetry tab is present", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/staff": () => ({
          ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
          items: [STAFF_ROW]
        })
      }
    });
    await gotoScreen(page, "staff-teams.html");
    await page.locator('.tab[data-tab="telemetry"]').click();
    await expect(page.locator("#tab-telemetry")).toBeVisible();
    await expect(page.locator("#teleEmpty")).toBeVisible();
  });
});

test("owner can remove a teammate while Chris keeps owner, setter and closer access", async ({ page }) => {
  const chris = {
    id: "chris-id", name: "Chris Stanbridge", email: "chris@fundhub.ai",
    role: "owner", status: "active"
  };
  const teammate = {
    id: "staff-9", name: "Admin E2E", email: "e2e+admin@fundhub.ai",
    role: "admin", status: "active"
  };
  let people = [chris, teammate];
  let removedId = null;
  await wireApi(page, {
    session: { ok: true, principal: "staff", staff: { ...chris, org_id: "org-1" } },
    handlers: {
      "/api/read/staff": () => ({ ok: true, count: people.length, items: people, limit: 200, offset: 0, hasMore: false }),
      "/api/auth/suspend": (route) => {
        const body = JSON.parse(route.request().postData() || "{}");
        if (body.action === "remove") {
          removedId = body.staff_id;
          people = people.filter((person) => person.id !== removedId);
        }
        return { ok: true, staff: { id: removedId, status: "suspended" } };
      }
    }
  });
  await gotoScreen(page, "staff-teams.html");
  await expect(page.locator("#rosterBody")).toContainText("Admin E2E");
  await page.locator("#rosterBody tr", { hasText: "Chris Stanbridge" }).click();
  await expect(page.locator("#rosterBody tr", { hasText: "Chris Stanbridge" })).toContainText("Owner · Setter · Closer");
  await expect(page.locator("#edRemove")).toBeHidden();
  await page.locator("#edCancel").click();
  await page.locator("#rosterBody tr", { hasText: "Admin E2E" }).click();
  await expect(page.locator("#edRemove")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#edRemove").click();
  await expect(page.locator("#rosterBody")).not.toContainText("Admin E2E");
  expect(removedId).toBe("staff-9");
});
