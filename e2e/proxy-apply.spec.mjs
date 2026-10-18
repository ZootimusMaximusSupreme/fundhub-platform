// Playwright — Apply control + no-extension fallback for Oxylabs proxy door.

import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLIENT_ID } from "./harness.mjs";

const LENDER_ID = "bbbbbbbb-1111-4111-8111-111111111111";

const LENDERS_PAYLOAD = {
  ok: true,
  lenders: [{
    id: LENDER_ID,
    name: "Mesa Community Bank",
    lender_table: "OnlineBizCC",
    bureaus_pulled: "EX",
    stated_requirements: null,
    priority_tier: 1,
    active: true,
    eligible_states: "AZ",
    application_url: "https://bank.example/apply/mesa",
    last_updated_by: null,
    last_updated_date: null
  }],
  meta: { count: 1, empty: false }
};

const LAUNCH_OK = {
  ok: true,
  session_id: "cccccccc-1111-4111-8111-111111111111",
  session: {
    id: "cccccccc-1111-4111-8111-111111111111",
    status: "active",
    client_id: CLIENT_ID,
    lender_id: LENDER_ID,
    application_id: null,
    started_at: "2026-08-04T12:00:00Z"
  },
  connection: {
    host: "pr.oxylabs.io",
    port: 7777,
    username: "customer-test-cc-US-city-mesa-sessid-abc123-sesstime-30",
    password: "proxy-pass",
    sessid: "abc123",
    sesstime: 30
  },
  verification: {
    exit_ip: "203.0.113.44",
    city: "Mesa",
    region: "Arizona",
    targeting_level: "city",
    requested_city: "mesa",
    requested_state: "us_arizona"
  },
  application_url: "https://bank.example/apply/mesa",
  lender: { id: LENDER_ID, name: "Mesa Community Bank", product_name: null },
  routing_active: false,
  extension_required: true,
  notice: "Exit IP verified server-side."
};

test("lenders.html client-scoped Apply shows no-extension fallback with verified exit", async ({ page }) => {
  await openScreen(page, `/app/lenders.html?client_id=${CLIENT_ID}`, OWNER, {
    "/api/read/lenders": LENDERS_PAYLOAD,
    "/api/read/lender-matches": {
      ok: true,
      client_id: CLIENT_ID,
      match_count: 1,
      summary: { match_count: 1, lender_count: 1 },
      matches: [{
        id: LENDER_ID,
        name: "Mesa Community Bank",
        lender_table: "OnlineBizCC",
        bureaus_pulled: "EX",
        stated_requirements: null,
        priority_tier: 1,
        active: true,
        eligible_states: "AZ",
        application_url: "https://bank.example/apply/mesa"
      }]
    },
    "/api/read/lender-observations": { ok: true, observations: [], meta: { count: 0 } },
    "/api/proxy/launch": async (route) => {
      expect(route.request().method()).toBe("POST");
      const body = route.request().postDataJSON();
      expect(body.client_id).toBe(CLIENT_ID);
      expect(body.lender_id).toBe(LENDER_ID);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(LAUNCH_OK)
      });
    }
  });

  await expect(page.locator("#applyClientBanner")).toContainText("Client-scoped Apply");
  // The page-level yellow bar is gone by design; the warning now lives in the
  // Apply modal asserted below, which is where it can still stop somebody.
  await expect(page.locator("#fh-proxy-ext-hint")).toHaveCount(0);
  const applyBtn = page.getByRole("button", { name: /^Apply$/ });
  await expect(applyBtn).toBeVisible();
  await applyBtn.click();

  const modal = page.locator("#fh-proxy-apply-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Chrome extension not detected");
  await expect(modal).toContainText("NOT active");
  await expect(modal).toContainText("will not open the safe way");
  await expect(modal).toContainText("Do not open the bank link");
  await expect(modal).toContainText("203.0.113.44");
  await expect(modal).toContainText("Mesa");
  await expect(modal).toContainText("pr.oxylabs.io");
  await expect(modal).toContainText("customer-test-cc-US-city-mesa-sessid-abc123");
  await expect(modal).toContainText("Verified exit");
  await expect(modal.getByRole("button", { name: /Open application URL/i })).toHaveCount(0);
  await expect(modal.getByRole("button", { name: /End session/i })).toBeVisible();
});

test("client-control-panel funding Apply list wires Apply control", async ({ page }) => {
  await openScreen(page, `/app/client-control-panel.html?id=${CLIENT_ID}#ccp-view-funding`, OWNER, {
    "/api/dashboard/client": {
      ok: true,
      client: {
        id: CLIENT_ID,
        first_name: "Dana",
        last_name: "Whitfield",
        email: "dana@example.com",
        phone: "+1 555 0100",
        custom_fields: { business_city: "Mesa", business_state: "AZ" }
      },
      tasks: []
    },
    "/api/read/lender-matches": {
      ok: true,
      client_id: CLIENT_ID,
      match_count: 1,
      summary: { match_count: 1, lender_count: 1 },
      matches: [{
        id: LENDER_ID,
        name: "Mesa Community Bank",
        bureaus_pulled: "EX",
        application_url: "https://bank.example/apply/mesa",
        priority_tier: 1
      }],
      skipped: []
    },
    "/api/proxy/launch": LAUNCH_OK
  });

  await expect(page.locator("#fh-funding-apply")).toBeVisible();
  // The page-level yellow bar is gone by design; the warning now lives in the
  // Apply modal asserted below, which is where it can still stop somebody.
  await expect(page.locator("#fh-proxy-ext-hint")).toHaveCount(0);
  await expect(page.locator("#fh-funding-apply-status")).toContainText("fit");
  await page.locator("#fh-funding-apply-list").getByRole("button", { name: /^Apply$/ }).click();
  const modal = page.locator("#fh-proxy-apply-modal");
  await expect(modal).toBeVisible();
  await expect(modal).toContainText("Chrome extension not detected");
  await expect(modal).toContainText("will not open the safe way");
  await expect(modal).toContainText("203.0.113.44");
  await expect(modal.getByRole("button", { name: /Open application URL/i })).toHaveCount(0);
});
