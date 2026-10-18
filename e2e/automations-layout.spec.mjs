import { test, expect } from "@playwright/test";
import { OWNER, wireApi, gotoScreen } from "./harness.mjs";

// Every API request is intercepted. These fixtures prove presentation and
// controls, never actual workflow execution or a production session.
const base = {
  category: "Client operations", events: ["client.created"], crons: [],
  last_triggered_at: null, emitters_verified_on: "2026-10-18",
  run_records_note: "Start signals do not prove that a job finished.",
  can_start_today: true,
  emitters: [{ event: "client.created", how: "A staff member creates a client", gate: "client_jobs", gate_set: true }]
};
const rows = [
  { ...base, id: "client-welcome", name: "Send a welcome after a new client is added", status: "trigger_seen", last_triggered_at: "2026-10-17T12:00:00Z" },
  { ...base, id: "client-review", name: "Review a newly created client", status: "trigger_never_seen" },
  { ...base, id: "unknown", name: "Unverified start signal", status: "emitter_unknown", emitters: [] },
  { ...base, id: "blocked", name: "Missing start signal", status: "no_emitter", can_start_today: false, blocked_reason: "No emitter is registered", emitters: [] },
  { ...base, id: "daily", name: "Daily registry check", category: "Operations", status: "scheduled", events: [], crons: ["0 9 * * *"], schedule_plain: "Every day at 9am", emitters: [] }
];

async function setup(page, handler) {
  const errors = [];
  const writes = [];
  page.on("pageerror", error => errors.push(String(error)));
  page.on("request", request => {
    if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) {
      writes.push(request.method() + " " + new URL(request.url()).pathname);
    }
  });
  await wireApi(page, { session: OWNER, handlers: { "/api/read/workflows": handler } });
  return { errors, writes };
}

async function fits(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const rect = await page.locator("#rail-select").boundingBox();
  expect(rect.width).toBeGreaterThan(40);
  expect(rect.height).toBeGreaterThanOrEqual(40);
}

for (const width of [1440, 390, 320]) {
  test.describe("Workflow registry at " + width, () => {
    test.use({ viewport: { width, height: 1000 } });

    test("all five statuses, keyboard details, rail filtering and safe refresh", async ({ page }) => {
      let calls = 0;
      const { errors, writes } = await setup(page, route => {
        calls++;
        expect(route.request().method()).toBe("GET");
        expect(new URL(route.request().url()).searchParams.get("limit")).toBe("200");
        expect(route.request().headers().authorization).toBe("Bearer e2e-token");
        return { ok: true, items: rows, hasMore: false };
      });
      await gotoScreen(page, "automations.html");
      await expect(page.locator("#wfMain")).toHaveAttribute("aria-busy", "false");
      await expect(page.locator("[data-sum=total]")).toHaveText("5");
      await expect(page.locator("[data-sum=blocked]")).toContainText("1");
      await expect(page.locator("[data-sum=live]")).toContainText("1");
      await expect(page.locator("#attnBar")).toContainText("cannot start");
      for (const label of ["SIGNAL SEEN", "NEVER STARTED", "NOT CHECKED", "NOTHING STARTS IT", "ON A TIMER"]) {
        await expect(page.locator("#wfMain .toggle").filter({ hasText: label })).toHaveCount(1);
      }
      const first = page.locator("tr[data-wf]").first();
      await first.focus();
      await page.keyboard.press("Enter");
      await expect(first).toHaveAttribute("aria-expanded", "true");
      const detail = first.locator("xpath=following-sibling::tr[1]");
      await expect(detail).toContainText("A staff member creates a client");
      await expect(detail).toContainText("Start signals do not prove");
      await detail.locator("summary").click();
      await expect(detail).toContainText("client-welcome");
      await first.focus();
      await page.keyboard.press("Space");
      await expect(first).toHaveAttribute("aria-expanded", "false");
      await expect(detail).toBeHidden();
      await page.locator("#rail-select").selectOption("Operations");
      await expect(page.locator(".rail-group:visible")).toHaveCount(1);
      await expect(page.locator(".rail-group:visible")).toContainText("runs on a timer");
      await page.locator("#rail-select").selectOption("All rails");
      await expect(page.locator(".rail-group:visible")).toHaveCount(2);
      await page.locator("#wfRefresh").click();
      await expect(page.locator("#wfRefresh")).toBeEnabled();
      expect(calls).toBe(2);
      await fits(page);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    });

    test("empty registry stays honest and offers a read-only retry", async ({ page }) => {
      const { writes } = await setup(page, () => ({ ok: true, items: [], hasMore: false }));
      await gotoScreen(page, "automations.html");
      await expect(page.locator("#wfMain")).toContainText("No workflows in the registry");
      await expect(page.locator("#attnBar")).toContainText("No workflows are available");
      await expect(page.locator("#attnBar")).not.toContainText("No job here has ever");
      await expect(page.locator("[data-sum=total]")).toHaveText("0");
      await expect(page.locator("#rail-select")).toBeDisabled();
      await expect(page.locator("#wfRefresh")).toBeEnabled();
      await fits(page);
      expect(writes).toEqual([]);
    });

    test("loading retains layout and prevents duplicate reads", async ({ page }) => {
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      await setup(page, async route => {
        await pending;
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items: rows, hasMore: false }) });
      });
      await gotoScreen(page, "automations.html");
      await expect(page.locator("#wfLoading")).toBeVisible();
      await expect(page.locator("#wfMain")).toHaveAttribute("aria-busy", "true");
      await expect(page.locator("#wfRefresh")).toBeDisabled();
      await expect(page.locator("#rail-select")).toBeDisabled();
      await fits(page);
      release();
      await expect(page.locator("#wfMain")).toHaveAttribute("aria-busy", "false");
    });

    test("server errors clear stale counts and refresh recovers", async ({ page }) => {
      let calls = 0;
      const { writes } = await setup(page, route => {
        calls++;
        if (calls === 2) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Registry unavailable" }) });
        return { ok: true, items: rows, hasMore: true };
      });
      await gotoScreen(page, "automations.html");
      await expect(page.locator("#wfFooterCount")).toContainText("more on the next page");
      await page.locator("#wfRefresh").click();
      await expect(page.locator("#wfMain")).toContainText("Workflows could not be loaded");
      await expect(page.locator("#wfMain")).toContainText("Use Refresh to try again");
      await expect(page.locator("[data-sum=total]")).toHaveText("—");
      await expect(page.locator("#rail-select")).toBeDisabled();
      await page.locator("#wfRefresh").click();
      await expect(page.locator("[data-sum=total]")).toHaveText("5");
      await expect(page.locator("#rail-select")).toBeEnabled();
      await fits(page);
      expect(writes).toEqual([]);
    });
  });
}

test("unauthorized registry never displays workflow data", async ({ page }) => {
  await setup(page, route => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "unauthorized" })
  }));
  await gotoScreen(page, "automations.html");
  await expect(page.locator("#wfMain")).toContainText("sign back in");
  await expect(page.locator("tr[data-wf]")).toHaveCount(0);
  await expect(page.locator("[data-sum=total]")).toHaveText("—");
});
