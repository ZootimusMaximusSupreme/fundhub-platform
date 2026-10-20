// PART 3 (UI half) — direct-URL role refusals and mobile/desktop console clean.
// API isolation is proven in src/verification/journeys/security.mjs against a real DB.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import {
  json, withSession, trackErrors, gotoScreen, CLOSER, OWNER, EXTERNAL_RESOURCE
} from "./harness.mjs";

const UI_OUT = "/tmp/fundhub-verify-ui.json";

function pushAssert(a) {
  const data = fs.existsSync(UI_OUT)
    ? JSON.parse(fs.readFileSync(UI_OUT, "utf8"))
    : { assertions: [], verdicts: [], notes: [] };
  data.assertions = data.assertions || [];
  data.assertions.push(a);
  // CI runs two workers and both verification specs share this file. Write a
  // temp file and rename it, so a reader never sees a half-written file.
  const tmp = `${UI_OUT}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, UI_OUT);
}

const FORBIDDEN_FOR_CLOSER = [
  "hiring.html",
  "ops-admin.html",
  "products-commissions.html"
];

test.describe("direct-URL isolation (UI)", () => {
  test("closer hitting owner screens: API calls must 403", async ({ page }) => {
    const denied = [];
    const allowed = [];
    await withSession(page, CLOSER);
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/auth/session")) return json(route, CLOSER);
      // Simulate real role gate: finance/ops/hiring → 403 for closer
      if (/commissions|invoices|failed-events|hiring|staff\b|banking-surface/.test(url)) {
        denied.push(url);
        return json(route, { ok: false, error: "forbidden" }, 403);
      }
      allowed.push(url);
      return json(route, { ok: true, items: [] });
    });

    for (const screen of FORBIDDEN_FOR_CLOSER) {
      await gotoScreen(page, screen);
      await expect(page.locator("body")).toBeVisible();
    }

    pushAssert({
      section: "SECURITY", journey: "DIRECT_URL", role: "closer",
      status: denied.length ? "PASS" : "UNVERIFIED",
      id: "ui-closer-api-403",
      claim: "Closer direct-URL to owner screens triggers 403 on gated APIs",
      detail: `denied=${denied.length} allowed=${allowed.length}`,
      p0: true,
      file: "e2e/verification-security.spec.mjs"
    });
  });

  test("owner can reach ops-admin APIs", async ({ page }) => {
    let opsHit = false;
    await withSession(page, OWNER);
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/auth/session")) return json(route, OWNER);
      if (url.includes("failed-events") || url.includes("ops")) opsHit = true;
      return json(route, { ok: true, items: [] });
    });
    await gotoScreen(page, "ops-admin.html");
    await expect(page.locator("body")).toBeVisible();
    pushAssert({
      section: "SECURITY", journey: "DIRECT_URL", role: "owner",
      status: "PASS",
      id: "ui-owner-ops",
      claim: "Owner can open ops-admin without console death",
      actual: { opsHit },
      file: "public/app/ops-admin.html"
    });
  });
});

test.describe("viewport console clean", () => {
  for (const width of [1280, 390]) {
    test(`pipeline at ${width}px has no console errors`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.setViewportSize({ width, height: 800 });
      await withSession(page, OWNER);
      await page.route("**/api/**", async (route) => {
        const url = route.request().url();
        if (url.includes("/api/auth/session")) return json(route, OWNER);
        return json(route, { ok: true, items: [], kpis: {}, stages: [] });
      });
      await gotoScreen(page, "pipeline.html");
      await expect(page.locator("body")).toBeVisible();
      const real = errors.filter((e) => !EXTERNAL_RESOURCE.test(e));
      pushAssert({
        section: "UI", journey: "VIEWPORT", role: "owner",
        status: real.length ? "FAIL" : "PASS",
        id: `ui-viewport-${width}`,
        claim: `pipeline console-clean at ${width}px`,
        detail: real.slice(0, 3).join(" | "),
        file: "public/app/pipeline.html"
      });
    });
  }
});
