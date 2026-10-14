// FinanceOS "Alerts" tab (financeos.html#alerts) — the four on/off switches, the
// promo form, removing a promo, a card's statement close day and the batch
// "Save days" send the exact write. The cases are shared with the stand-alone
// page (s2-money-alerts-cases.mjs); this one opens the tab, so every selector is
// scoped to #fos-alerts.
// NO BACKEND: page.route() answers /api/**; nothing is saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { json, withSession } from "./harness.mjs";
import { defineMoneyAlertCases } from "./s2-money-alerts-cases.mjs";

const FIXTURE = JSON.parse(fs.readFileSync(
  new URL("../src/finance/file-alerts/file-alerts.fixture.json", import.meta.url), "utf8"));

async function open(page, mutate = (d) => d) {
  const writes = [];
  const data = mutate(JSON.parse(JSON.stringify(FIXTURE)));
  await withSession(page, { staff: { role: "client" } });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/money/alerts")) {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        return json(route, { ok: true, saved: true });
      }
      return json(route, data);
    }
    if (url.includes("/api/money/overview")) return json(route, { ok: true, client: { name: "Dana Whitfield" }, sandbox: false });
    return json(route, { ok: true });
  });
  await page.goto("/app/financeos.html#alerts");
  await expect(page.locator('#fos-alerts [data-act="toggle"]').first()).toBeVisible({ timeout: 10_000 });
  return { writes };
}

test.describe("FinanceOS alerts tab", () => {
  defineMoneyAlertCases({ test, expect, open, scope: "#fos-alerts " });
});
