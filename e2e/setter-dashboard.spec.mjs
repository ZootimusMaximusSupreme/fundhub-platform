import { test, expect } from "@playwright/test";
import { openScreen } from "./harness.mjs";

const SETTER = {
  ok: true,
  staff: {
    id: "staff-setter", name: "Alex Setter", email: "alex@fundhub.ai",
    role: "setter", org_id: "org-1", status: "active"
  }
};

const queue = {
  ok: true,
  count: 1,
  numbers: {
    dials: 10, booked: 2, dial_to_book_rate: 0.2,
    showed: 3, no_shows: 1, show_rate: 0.75
  },
  booking_url: "https://apply.fundhub.ai/funding-book-call",
  intro_video_available: false,
  items: [{
    client_id: "aaaaaaaa-1111-4111-8111-111111111111",
    client_name: "Dana Whitfield", phone: "+15550100",
    lead_type: "booked", created_at: "2026-10-27T16:00:00.000Z",
    booked_at: "2026-10-27T16:05:00.000Z", booking_time: "2026-10-28T17:00:00.000Z",
    target_dial_by: "2026-10-27T16:06:00.000Z", needs_work: true,
    setter_staff_id: "staff-setter", closer_staff_id: "staff-closer",
    survey: [],
    setter_handoff: {
      dialed_at: "2026-10-27T16:06:00.000Z", call_attempts: 1,
      disposition: "reached", time_confirmed: true, frame_warmed: true,
      problem: "Needs working capital", goal: "Open a second location",
      computer_ready: true, app_on_phone: false,
      complete_at: "2026-10-27T16:15:00.000Z",
      handoff_text: "Dana needs working capital for a second location."
    }
  }]
};

test("setter sees self-scoped dial, book and show numbers plus honest two-message handoff", async ({ page }) => {
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": queue
  });

  await expect(page.locator("#setter-number-dials")).toHaveText("10");
  await expect(page.locator("#setter-number-booked")).toHaveText("2");
  await expect(page.locator("#setter-number-book-rate")).toHaveText("20%");
  await expect(page.locator("#setter-number-shows")).toHaveText("3");
  await expect(page.locator("#setter-number-show-rate")).toHaveText("75%");
  await expect(page.locator("#setter-detail")).toContainText("booking confirmation to the lead");
  await expect(page.locator("#setter-detail")).toContainText("full handoff to the closer");
  await expect(page.getByRole("button", { name: "Send lead confirmation + closer handoff" })).toBeEnabled();
});

test("setter score strip stays inside a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": queue
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expect(page.locator(".setter-numbers")).toBeVisible();
});
