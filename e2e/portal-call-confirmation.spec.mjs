import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CLIENT_ID, json } from "./harness.mjs";

const BOOKING_ID = "b1000000-0000-4000-8000-000000000001";
const evidence = path.join(process.cwd(), "ops/workflows/build-evidence/client-call-confirmation");
const session = { ok: true, staff: { id: CLIENT_ID, name: "Dana Whitfield", email: "dana@example.com", role: "client", org_id: "org-1", status: "active" } };

test("client call card: loading, empty, error, booked, confirmed, and one working click at desktop and phone", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(evidence, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });

  let mode = "loading";
  let writes = 0;
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, session);
    if (url.includes("/api/read/portal-summary")) {
      if (mode === "loading") await new Promise((resolve) => setTimeout(resolve, 1800));
      if (mode === "error") return json(route, { ok: false, error: "read_failed" }, 503);
      const upcoming_call = mode === "empty" ? null : {
        id: BOOKING_ID,
        when: "2026-11-18T20:00:00.000Z",
        confirmed: mode === "confirmed"
      };
      return json(route, {
        ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
        scores: {}, documents: [], upcoming_call
      });
    }
    if (url.endsWith("/api/bookings") && route.request().method() === "POST") {
      writes += 1;
      expect(route.request().postDataJSON()).toEqual({ booking_id: BOOKING_ID });
      return json(route, { ok: true, confirmed: true });
    }
    if (url.includes("entitlement")) return json(route, { ok: true, items: [] });
    return json(route, { ok: true, items: [] });
  });

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const state of ["loading", "empty", "error", "unconfirmed", "confirmed"]) {
      mode = state;
      await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
      const card = page.locator("#call-confirm-card");
      if (state === "loading") {
        await expect(page.locator("#call-confirm-skeleton")).toBeVisible();
      } else if (state === "empty") {
        await expect(card).toBeHidden();
      } else if (state === "error") {
        await expect(card).toContainText("could not check your call");
      } else if (state === "confirmed") {
        await expect(card).toContainText("call is confirmed");
        await expect(page.locator("#call-confirm-btn")).toBeHidden();
      } else {
        await expect(card).toContainText("Please confirm you can make it");
        await expect(page.locator("#call-confirm-btn")).toBeVisible();
      }
      if (state === "unconfirmed") {
        await page.evaluate(() => {
          const box = document.getElementById("call-confirm-card").getBoundingClientRect();
          const mark = document.createElement("div");
          mark.id = "review-mark";
          mark.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${box.left - 4}px;top:${box.top - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;border:3px solid #D00000;border-radius:12px`;
          const label = document.createElement("span");
          label.textContent = "New: confirm your booked call";
          label.style.cssText = "position:absolute;top:-26px;left:0;background:#D00000;color:white;padding:2px 8px;font:600 13px Arial";
          mark.append(label);
          document.body.append(mark);
        });
      }
      await page.screenshot({ path: path.join(evidence, `${width}-${state}.png`) });
      if (state === "unconfirmed") {
        await page.evaluate(() => document.getElementById("review-mark")?.remove());
        await page.locator("#call-confirm-btn").click();
        await expect(card).toContainText("Your call is confirmed. We will see you then.");
        await expect(page.locator("#call-confirm-btn")).toBeHidden();
      }
    }
  }
  expect(writes).toBe(2);
});
