// File protection alerts (/app/money-alerts.html) — every control that changes
// what a client is texted about must send the exact write the server expects.
//
// The four switches, the promo form, removing a promo, one card's statement
// close day and the batch "Save days" each go through POST /api/money/alerts.
// The cases are shared with the FinanceOS Alerts tab (s2-money-alerts-cases.mjs),
// which runs the same page code. This one opens the stand-alone page.
// NO BACKEND: page.route() answers /api/**; nothing is saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { openScreen, json } from "./harness.mjs";
import { defineMoneyAlertCases } from "./s2-money-alerts-cases.mjs";

const FIXTURE = JSON.parse(fs.readFileSync(
  new URL("../src/finance/file-alerts/file-alerts.fixture.json", import.meta.url), "utf8"));
const CLIENT_SESSION = { ok: true, staff: { id: "client-1", name: "Dana Whitfield", email: "dana@example.test", role: "client", org_id: "org-1", status: "active" } };

async function open(page, mutate = (d) => d) {
  const writes = [];
  const data = mutate(JSON.parse(JSON.stringify(FIXTURE)));
  await openScreen(page, "/app/money-alerts.html", CLIENT_SESSION, {
    "/api/money/alerts": async (route, { method }) => {
      if (method === "POST") {
        writes.push(route.request().postDataJSON());
        return json(route, { ok: true, saved: true });
      }
      return json(route, data);
    },
  });
  await expect(page.locator(".fh-alerts h1")).toHaveText("File protection alerts", { timeout: 10_000 });
  await expect(page.locator('[data-act="toggle"]').first()).toBeVisible();
  return { writes };
}

test.describe("money alerts page", () => {
  defineMoneyAlertCases({ test, expect, open });
});
