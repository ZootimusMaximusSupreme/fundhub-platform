import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const EMPTY_STAGES = {
  ok: true, pipeline: "sales", total: 0,
  stages: [
    { key: "new_lead", name: "New Lead", sort_order: 0, count: 0, amount: 0, cards: [] },
    { key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: [] }
  ]
};
const LIVE_STAGES = {
  ok: true, pipeline: "sales", total: 1,
  stages: [
    { key: "new_lead", name: "New Lead", sort_order: 0, count: 1, amount: 3000,
      cards: [{ id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
        owner: "Jordan Blake", entered_at: "2026-08-01T10:00:00Z",
        outcome_tier: null, funded: false, amount: 3000 }] },
    { key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, cards: [] }
  ]
};

test.describe("pipeline honest load", () => {
  test("shows real cards when the API has them", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, { "/api/dashboard/pipeline": LIVE_STAGES });
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await expect(page.locator('.card[data-client-id]')).toContainText("Dana Whitfield");
    await expect(page.locator("#boardStatus")).toBeHidden();
  });

  test("empty pipeline says so — never paints names that disappear", async ({ page }) => {
    await page.addInitScript(() => {
      window.__fhPipeNames = [];
      const mo = new MutationObserver(() => {
        document.querySelectorAll(".board .c-name").forEach((el) => {
          const t = (el.textContent || "").trim();
          if (t && window.__fhPipeNames.indexOf(t) < 0) window.__fhPipeNames.push(t);
        });
      });
      document.addEventListener("DOMContentLoaded", () => {
        mo.observe(document.body, { childList: true, subtree: true });
      });
    });
    await openScreen(page, "/app/pipeline.html", OWNER, { "/api/dashboard/pipeline": EMPTY_STAGES });
    await expect(page.locator(".board .col")).toHaveCount(2);
    await expect(page.locator('.card[data-client-id]')).toHaveCount(0);
    await expect(page.locator("body")).toContainText(/no cards/i);
    const seen = await page.evaluate(() => window.__fhPipeNames || []);
    for (const n of ["Kayla Whitmore", "Dana Whitlock", "Tomás Reyes", "Yvonne Adeyemi"]) {
      expect(seen, "sample name must never render: " + n).not.toContain(n);
    }
  });

  test("failed fetch names the failure — not a blank board", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": async (route) =>
        json(route, { ok: false, error: "internal_error", message: "Something broke." }, 500)
    });
    await expect(page.locator("#boardStatus")).toBeVisible();
    await expect(page.locator("#boardStatus")).toContainText(/could not load|failed|Sales/i);
    await expect(page.locator("#boardStatus")).toContainText("Refresh to try again.");
    await expect(page.locator("body")).not.toContainText("internal_error");
    await expect(page.locator('.card[data-client-id]')).toHaveCount(0);
  });

  test("content that appears stays — no mid-session disappearance of cards", async ({ page }) => {
    let resolveLater;
    const delayed = new Promise((r) => { resolveLater = r; });
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": async (route) => {
        await delayed;
        return json(route, LIVE_STAGES);
      }
    });
    await expect(page.locator("#boardStatus")).toBeVisible();
    await expect(page.locator(".board .c-name")).toHaveCount(0);
    resolveLater();
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1, { timeout: 5000 });
    await page.waitForTimeout(600);
    await expect(page.locator('.card[data-client-id]')).toHaveCount(1);
    await expect(page.locator('.card[data-client-id]')).toContainText("Dana Whitfield");
  });
});
