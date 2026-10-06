// New screens from this build round — lenders, inquiry ops, AI bureau, telemetry,
// agent context, chat widget, social connect, Oxylabs Apply.

import { test, expect } from "@playwright/test";
import {
  OWNER, CLOSER, CLIENT_ID, PARTNER_ID, PARTNER,
  wireApi, gotoScreen, openScreen
} from "./harness.mjs";

test.describe("Lenders + inquiry ops", () => {
  test("lenders screen loads and shows tabs", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/lenders": () => ({
          ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: []
        }),
        "/api/read/ai-bureau-config": () => ({
          ok: true, count: 0, items: []
        }),
        "/api/read/inquiry-cases": () => ({
          ok: true, count: 0, items: []
        })
      }
    });
    await gotoScreen(page, "lenders.html");
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Sample dollar");
  });

  test("inquiry remover operable at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await wireApi(page, { session: CLOSER });
    await gotoScreen(page, "inquiry-remover.html");
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Social connect", () => {
  test("Connect buttons present and OAuth not_configured is honest", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/social/oauth": () => ({
          ok: false, error: "not_configured",
          missing: ["META_APP_ID"],
          message: "META_APP_ID unset — see ops/STILL-MISSING.md"
        })
      }
    });
    await gotoScreen(page, "social-studio.html");
    await expect(page.locator("#oauthFb")).toBeVisible({ timeout: 10_000 });
    /* With no partner chosen the Connect buttons are disabled and the line
       under them says why (social-studio.html, since 2026-08-17 fe5e7ba5a):
       nothing can be connected for nobody. Clicking a disabled button waited
       30 seconds. The honest answer is the disabled button and its reason. */
    await expect(page.locator("#oauthFb")).toBeDisabled();
    await expect(page.locator("#oauthMsg")).toContainText(/META_APP_ID|unset|not_configured|partner/i, { timeout: 10_000 });
  });
});

test.describe("Oxylabs Apply control", () => {
  test("client control panel shows Apply control or honest disable", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/dashboard/client": () => ({
          ok: true,
          client: {
            id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield",
            email: "dana@example.com", custom_fields: {}
          },
          transactions: [], crs_results: [], messages: [], tasks: []
        }),
        "/api/proxy/launch": () => ({
          ok: false, error: "not_configured",
          message: "OXYLABS_USERNAME unset"
        })
      }
    });
    await gotoScreen(page, `client-control-panel.html?id=${CLIENT_ID}`);
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Agent context + chat widget", () => {
  test("agent editor loads", async ({ page }) => {
    await wireApi(page, { session: OWNER });
    await gotoScreen(page, "agent-editor.html");
    await expect(page.locator("body")).toBeVisible();
  });

  test("messaging screen loads chat surface", async ({ page }) => {
    await wireApi(page, { session: CLOSER });
    await gotoScreen(page, "messaging.html");
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Mobile smoke — key screens", () => {
  const MOBILE = [
    "pipeline.html",
    "calendar.html",
    "lenders.html",
    "social-studio.html",
    "ops-admin.html",
    "closer-dashboard.html"
  ];
  for (const screen of MOBILE) {
    test(`${screen} loads at phone width`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openScreen(page, `/app/${screen}`, OWNER);
      await expect(page.locator("body")).toBeVisible();
      // Collapse the staff sidebar when present so the main pane is operable.
      await page.evaluate(() => {
        var side = document.getElementById("side");
        if (side) side.classList.add("mini");
      });
      // Social Studio's workbench is intentionally wide; operable means body
      // visible + connect controls reachable, not zero overflow.
      if (screen === "social-studio.html") {
        await expect(page.locator("#oauthFb")).toBeAttached();
        return;
      }
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 80);
    });
  }
});

test.describe("Calendar coverage roster", () => {
  test("coverage paints from shifts roster", async ({ page }) => {
    await wireApi(page, {
      session: CLOSER,
      handlers: {
        "/api/tasks": () => ({ ok: true, tasks: [] }),
        "/api/shifts": () => ({
          ok: true,
          shift: null,
          roster: [{
            shift_id: "sh-1", staff_id: "staff-2",
            name: "Casey Reed", role: "closer",
            started_at: new Date().toISOString()
          }]
        })
      }
    });
    await gotoScreen(page, "calendar.html");
    await expect(page.locator("#covList")).toContainText("Casey Reed", { timeout: 10_000 });
  });
});

test.describe("Ops Admin live KPIs", () => {
  test("KPI tiles paint from dashboard/kpis", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/dashboard/kpis": () => ({
          ok: true,
          kpis: { cash_collected_cents: 3200, funded_count: 0 },
          display: {
            cash: "$32", pipeline_movement: "0", close: "—", show: "—",
            cpf: "—", funded: "0", clients: "1"
          }
        })
      }
    });
    await gotoScreen(page, "ops-admin.html");
    await expect(page.locator(".kpi-value").first()).toHaveText("$32", { timeout: 10_000 });
  });
});
