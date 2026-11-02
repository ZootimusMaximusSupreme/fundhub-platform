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
    role: "owner", roles: ["owner", "setter", "closer"], status: "active"
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

test("green dot follows current online presence without treating login access as online", async ({ page }) => {
  let jordanOnline = true;
  let caseyOnline = false;
  const casey = {
    id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai",
    role: "closer", status: "active"
  };
  await wireApi(page, {
    session: OWNER,
    handlers: {
      "/api/read/staff": () => ({
        ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
        items: [
          { ...STAFF_ROW, online_now: jordanOnline },
          { ...casey, online_now: caseyOnline }
        ]
      })
    }
  });
  await gotoScreen(page, "staff-teams.html");
  const jordanRow = page.locator("#rosterBody tr", { hasText: "Jordan Blake" });
  const caseyRow = page.locator("#rosterBody tr", { hasText: "Casey Reed" });
  await expect(jordanRow.locator('.online-dot[aria-label="Online now"]')).toBeVisible();
  await expect(caseyRow.locator(".online-dot")).toHaveCount(0);
  await expect(caseyRow).toContainText("Active");

  jordanOnline = false;
  caseyOnline = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(jordanRow.locator(".online-dot")).toHaveCount(0);
  await expect(caseyRow.locator('.online-dot[aria-label="Online now"]')).toBeVisible();
});


test("owner saves explicit additional jobs and sees only the saved role stack", async ({ page }) => {
  let saved;
  const teammate = { ...STAFF_ROW, role: "closer", roles: ["closer"], phone: "", start_date: null };
  await wireApi(page, { session: OWNER, handlers: {
    "/api/read/staff": () => ({ ok: true, count: 1, items: [teammate] }),
    "/api/auth/staff-role": route => {
      saved = JSON.parse(route.request().postData());
      return { ok: true, staff: { ...teammate, roles: ["closer", ...saved.roles] } };
    }
  } });
  await gotoScreen(page, "staff-teams.html");
  const row = page.locator("#rosterBody tr", { hasText: "Jordan Blake" });
  await row.click();
  await expect(page.locator('[name="additional_role"][value="owner"]')).toHaveCount(0);
  await expect(page.locator('[name="additional_role"][value="admin"]')).toHaveCount(0);
  await page.locator('[name="additional_role"][value="setter"]').check();
  await page.locator("#edSave").click();
  await expect(page.locator("#editor")).not.toHaveClass(/open/);
  expect(saved).toEqual({ staff_id: teammate.id, role: "closer", roles: ["setter"] });
  await expect(row).toContainText("Closer · Setter");
  await row.click();
  await expect(page.locator('[name="additional_role"][value="setter"]')).toBeChecked();
});


test("editing contact details preserves a saved duty this limited role editor cannot offer", async ({ page }) => {
  const teammate={ ...STAFF_ROW, role:"closer", roles:["closer","existing_custom_duty"] };
  let roleWrites=0;
  await wireApi(page,{session:OWNER,handlers:{
    "/api/read/staff":()=>({ok:true,count:1,items:[teammate]}),
    "/api/auth/staff-update":route=>({ok:true,staff:{...teammate,...JSON.parse(route.request().postData())}}),
    "/api/auth/staff-role":()=>{roleWrites++;return{ok:false,error:"unexpected_role_write"};}
  }});
  await gotoScreen(page,"staff-teams.html");
  await page.locator("#rosterBody tr",{hasText:"Jordan Blake"}).click();
  await page.locator("#ed_first").fill("Jordan Updated");
  await page.locator("#edSave").click();
  await expect(page.locator("#editor")).not.toHaveClass(/open/);
  await expect(page.locator("#rosterBody")).toContainText("Jordan Updated Blake");
  await expect(page.locator("#rosterBody")).toContainText("existing_custom_duty");
  expect(roleWrites).toBe(0);
});
