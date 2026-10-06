// Report numbers that were wrong on screen, measured against production on
// 2026-10-05 (workflow M4, ops/workflows/perfect-machine-2026-10-05.md). Each
// test feeds the screen the real shape the API now answers with and checks the
// number a person reads.
import { test, expect } from "@playwright/test";
import { OWNER, CLIENT_ID, openScreen, wireApi, gotoScreen } from "./harness.mjs";

test.describe("reports read true", () => {
  test("pipeline: a column with no funding estimate reads a dash, never $0", async ({ page }) => {
    const unknownCard = (id) => ({ id, client_id: CLIENT_ID, name: "Lead " + id, owner: null,
      entered_at: "2026-10-04T10:00:00Z", outcome_tier: null, funded: false, amount: null });
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": {
        ok: true, pipeline: "sales", total: 10,
        stages: [
          { key: "new_lead", name: "New Lead", sort_order: 0, count: 8, amount: null, amount_known: 0,
            cards: [unknownCard("c1"), unknownCard("c2")] },
          { key: "survey_complete", name: "Survey Complete", sort_order: 1, count: 2, amount: null, amount_known: 0,
            cards: [unknownCard("c3")] },
          { key: "booked", name: "Booked", sort_order: 2, count: 0, amount: 0, amount_known: 0, cards: [] }
        ]
      }
    });
    const money = page.locator(".col-money");
    await expect(money.first()).toHaveText("— funding est.");
    await expect(money.nth(1)).toHaveText("— funding est.");
    await expect(money.nth(2)).toHaveText("$0 funding est.");
    await expect(page.locator("#sumMoney")).toHaveText("—");
  });

  test("ops & admin: ad spend reads in dollars, and the footer spells Fundhub", async ({ page }) => {
    await wireApi(page, {
      session: OWNER,
      handlers: {
        "/api/read/ops-pulse": {
          ok: true,
          briefs: { ceo: "What needs doing today?", owner: "What will be done." },
          hire: { recommend: false, existing_task_id: null, linkedin: { status: "not_configured" }, profile: { lines: [] } },
          pulse: { calendar: { packed: false }, gaps: { has_short: false, notes: [] },
                   ads: { status: "ok", spend_cents: 60653 } }
        }
      }
    });
    await gotoScreen(page, "ops-admin.html");
    await expect(page.locator("#ops-pulse-ads")).toHaveText("Ad spend this window: $606.53. Read only. Do not buy ads from here.");
    await expect(page.locator("footer.statusbar")).toContainText("Fundhub admin · v1");
    await expect(page.locator("footer.statusbar")).not.toContainText("FUNDHUB");
  });

  test("campaign manager: funnel page rows say they are running totals", async ({ page }) => {
    await openScreen(page, "/app/campaign-manager.html", OWNER, {
      "/api/read/funnel-pages": {
        ok: true,
        pages: [{ funnel_name: "Fundhub Funnel", page_name: "VSL", stat_date: "2026-10-04", views: 642, conversions: 0 }],
        connection: { state: "active", last_synced_at: "2026-10-04T22:10:00Z", last_error: null }
      }
    });
    const card = page.locator("#secFunnelPages");
    await expect(card.locator("thead")).toContainText("Pulled on");
    await expect(card.locator("thead")).not.toContainText(/\bDate\b/);
    await expect(card).toContainText("Each row is a running total, not one day.");
    await expect(card.locator("#funnelPagesRows")).toContainText("642");
  });
});
