import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { CLIENT_ID, json } from "./harness.mjs";

test.use({
  // Show the existing notification card without spending a browser permission
  // prompt or registering a device during this UI-only check.
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
});

const evidence = path.join(process.cwd(), "ops/workflows/build-evidence/marketing-push-preference");
const session = { ok: true, staff: { id: CLIENT_ID, name: "Dana Whitfield",
  email: "dana@example.com", role: "client", org_id: "org-1", status: "active" } };

test("marketing choice: loading, off, error, on and working toggle at desktop and phone", async ({ page }) => {
  test.setTimeout(120_000);
  await mkdir(evidence, { recursive: true });
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    localStorage.setItem("fh_role", "client");
    localStorage.removeItem("fh_demo");
  });

  let mode = "empty";
  let saved = false;
  let failSave = false;
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/auth/session")) return json(route, session);
    if (url.includes("/api/push/preferences")) {
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        expect(Object.keys(body)).toEqual(["marketing_push_enabled"]);
        if (failSave) return json(route, { ok: false, message: "We could not save your choice." }, 503);
        writes.push(body.marketing_push_enabled);
        saved = body.marketing_push_enabled;
        return json(route, { ok: true, marketing_push_enabled: saved });
      }
      if (mode === "loading") await new Promise((resolve) => setTimeout(resolve, 1600));
      if (mode === "error") return json(route, { ok: false, message: "We could not check your marketing updates." }, 503);
      return json(route, { ok: true, marketing_push_enabled: mode === "full" ? true : saved });
    }
    if (url.includes("/api/read/portal-summary")) return json(route, {
      ok: true, prequal_amount: null, prequal_display: null, soft_pull_complete: false,
      scores: {}, documents: []
    });
    if (url.includes("entitlement")) return json(route, { ok: true, items: [] });
    return json(route, { ok: true, items: [] });
  });

  async function markedShot(width, state) {
    await page.locator("#push-marketing").scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      const box = document.getElementById("push-marketing").getBoundingClientRect();
      const mark = document.createElement("div");
      mark.id = "marketing-review-mark";
      mark.style.cssText = `position:fixed;z-index:99999;pointer-events:none;left:${box.left - 4}px;top:${box.top - 4}px;width:${box.width + 8}px;height:${box.height + 8}px;border:3px solid #D00000;border-radius:10px`;
      const label = document.createElement("span");
      label.textContent = "New: marketing push choice";
      label.style.cssText = "position:absolute;top:-26px;left:0;background:#D00000;color:white;padding:2px 8px;font:600 13px Arial";
      mark.append(label);
      document.body.append(mark);
    });
    await page.screenshot({ path: path.join(evidence, `${width}-${state}.png`) });
    await page.evaluate(() => document.getElementById("marketing-review-mark")?.remove());
  }

  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const state of ["loading", "empty", "error", "full"]) {
      mode = state;
      saved = false;
      await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
      const card = page.locator("#push-marketing");
      await expect(card).toBeVisible();
      if (state === "loading") {
        await expect(page.locator("#push-marketing-loading")).toBeVisible();
        await expect(page.locator("#push-marketing-btn")).toBeHidden();
      } else if (state === "empty") {
        await expect(card).toContainText("Marketing updates are off");
        await expect(page.locator("#push-marketing-btn")).toHaveText("Turn marketing updates on");
      } else if (state === "error") {
        await expect(card).toContainText("could not check your marketing updates");
        await expect(page.locator("#push-marketing-btn")).toHaveText("Try again");
      } else {
        await expect(card).toContainText("Marketing updates are on");
        await expect(page.locator("#push-marketing-btn")).toHaveText("Turn marketing updates off");
      }
      await markedShot(width, state);
      if (state === "loading") {
        await expect(page.locator("#push-marketing-btn")).toHaveText("Turn marketing updates on");
      } else if (state === "empty") {
        await page.locator("#push-marketing-btn").click();
        await expect(card).toContainText("Marketing updates are on");
        await page.locator("#push-marketing-btn").click();
        await expect(card).toContainText("Marketing updates are off");
      } else if (state === "error") {
        mode = "empty";
        await page.locator("#push-marketing-btn").click();
        await expect(card).toContainText("Marketing updates are off");
      }
    }
  }
  expect(writes).toEqual([true, false, true, false]);

  // A failed save must keep the choice off and make the same tap retryable.
  mode = "empty";
  saved = false;
  failSave = true;
  await page.goto(`/app/client-portal.html?id=${CLIENT_ID}`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#push-marketing-btn")).toHaveText("Turn marketing updates on");
  await page.locator("#push-marketing-btn").click();
  await expect(page.locator("#push-marketing-copy")).toContainText("could not save your choice");
  await expect(page.locator("#push-marketing-btn")).toHaveText("Try again");
  failSave = false;
  await page.locator("#push-marketing-btn").click();
  await expect(page.locator("#push-marketing-copy")).toContainText("Marketing updates are on");
  expect(writes.at(-1)).toBe(true);
});
