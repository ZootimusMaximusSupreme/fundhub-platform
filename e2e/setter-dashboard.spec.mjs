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

test("setter can correct survey answers during a call and see saved edits after reload", async ({ page }) => {
  const item = structuredClone(queue.items[0]);
  item.survey = [
    { key: "cf_svy_funding_target_amount", question: "Set Your Target Amount", answer: "$50k - $100k",
      answer_values: ["$50k - $100k"], type: "single", options: ["$50k - $100k", "$100k - $200k"] },
    { key: "cf_svy_planned_use", question: "Planned Use", answer: "Not sure yet",
      answer_values: ["Not sure yet"], type: "single", options: ["Not sure yet", "Equipment or buildout"] },
    { key: "cf_svy_money_change_now", question: "What Would This Money Change Right Now?",
      answer: "Grow faster (more customers / more reach)", answer_values: ["Grow faster (more customers / more reach)"],
      type: "multi", options: ["Grow faster (more customers / more reach)", "Stability (cover bills / buffer slow weeks)"] }
  ];
  let surveyEdits = {};
  let saveAttempts = 0;
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": () => ({ ...queue, items: [{ ...item, survey_edits: surveyEdits }] }),
    "/api/setter-dashboard": async (route) => {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("save_survey");
      expect(body.client_id).toBe(item.client_id);
      saveAttempts += 1;
      if (saveAttempts === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
        return;
      }
      surveyEdits = body.survey_edits;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, survey_edits: surveyEdits }) });
    }
  });

  const amount = page.getByRole("combobox", { name: "Set Your Target Amount" });
  await expect(amount).toHaveValue("$50k - $100k");
  await expect(page.locator(".setter-survey textarea")).toHaveCount(0);
  const stability = page.getByRole("checkbox", { name: "Stability (cover bills / buffer slow weeks)" });
  await expect(page.getByRole("checkbox", { name: "Grow faster (more customers / more reach)" })).toBeChecked();
  await amount.selectOption("$100k - $200k");
  await stability.check();
  await page.getByRole("button", { name: "Save survey answers" }).click();
  await expect(page.locator("#setter-survey-status")).toHaveClass(/error/);
  await expect(amount).toHaveValue("$100k - $200k");
  await expect(stability).toBeChecked();
  await page.getByRole("button", { name: "Save survey answers" }).click();
  await expect(page.locator("#setter-survey-status")).toHaveText("Survey answers saved.");
  expect(surveyEdits).toEqual({ cf_svy_funding_target_amount: "$100k - $200k",
    cf_svy_money_change_now: "Grow faster (more customers / more reach), Stability (cover bills / buffer slow weeks)" });

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Set Your Target Amount" })).toHaveValue("$100k - $200k");
  await expect(page.locator(".setter-survey-field").first()).toContainText("Original answer: $50k - $100k");
  await expect(page.getByRole("combobox", { name: "Planned Use" })).toHaveValue("Not sure yet");
  await expect(page.getByRole("checkbox", { name: "Stability (cover bills / buffer slow weeks)" })).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
