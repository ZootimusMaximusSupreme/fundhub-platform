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

test("a lead alert opens the exact contact and its call link", async ({ page }) => {
  const another = { ...queue.items[0], client_id: "bbbbbbbb-2222-4222-8222-222222222222",
    client_name: "Pat Rivera", phone: "+15550987654" };
  await openScreen(page, `/app/setter-dashboard.html?client_id=${another.client_id}`, SETTER, {
    "/api/read/setter-dashboard": { ...queue, count: 2, items: [queue.items[0], another] }
  });
  await expect(page.locator("#setter-detail h2")).toHaveText("Pat Rivera");
  await expect(page.locator("#setter-detail a[href='tel:+15550987654']")).toBeVisible();
});

test("an exact lead link loads a permitted lead beyond the first 50 queue rows", async ({ page }) => {
  const older = { ...queue.items[0], client_id: "bbbbbbbb-2222-4222-8222-222222222222",
    client_name: "Older Lead", phone: "+15550987654" };
  const firstFifty = Array.from({ length: 50 }, (_, index) => ({ ...queue.items[0],
    client_id: "00000000-0000-4000-8000-" + String(index + 1).padStart(12, "0"),
    client_name: "Recent Lead " + (index + 1) }));
  let exactRead = false;
  await openScreen(page, "/app/setter-dashboard.html?client_id=" + older.client_id, SETTER, {
    "/api/read/setter-dashboard": (route, { url }) => {
      if (new URL(url).searchParams.get("client_id") === older.client_id) {
        exactRead = true;
        return { ...queue, count: 1, items: [older] };
      }
      return { ...queue, count: 50, items: firstFifty };
    }
  });
  await expect(page.locator("#setter-detail h2")).toHaveText("Older Lead");
  await expect(page.locator("#setter-detail a[href='tel:+15550987654']")).toBeVisible();
  expect(exactRead).toBe(true);
});

test("A's old assignment cannot reopen a lead after its latest task moves to B", async ({ page }) => {
  const clientId = "bbbbbbbb-2222-4222-8222-222222222222";
  let exactRead = false;
  await openScreen(page, "/app/setter-dashboard.html?client_id=" + clientId, SETTER, {
    "/api/read/setter-dashboard": (route, { url }) => {
      if (new URL(url).searchParams.get("client_id") === clientId) {
        exactRead = true;
        return { ...queue, count: 0, items: [] };
      }
      return queue;
    }
  });
  await expect(page.locator("#setter-detail")).toContainText("This lead is not in your call queue");
  await expect(page.locator("#setter-detail")).not.toContainText("Transferred Lead");
  expect(exactRead).toBe(true);
});

test("B's newer assignment opens the exact lead and saves its handoff", async ({ page }) => {
  const clientId = "bbbbbbbb-2222-4222-8222-222222222222";
  const setterB = { ...SETTER, staff: { ...SETTER.staff, id: "staff-setter-b", name: "B Setter" } };
  const transferred = { ...queue.items[0], client_id: clientId, client_name: "Transferred Lead",
    setter_staff_id: setterB.staff.id, setter_handoff: {} };
  let exactRead = false;
  const writes = [];
  await openScreen(page, "/app/setter-dashboard.html?client_id=" + clientId, setterB, {
    "/api/read/setter-dashboard": (route, { url }) => {
      if (new URL(url).searchParams.get("client_id") === clientId) {
        exactRead = true;
        return { ...queue, count: 1, items: [transferred] };
      }
      return queue;
    },
    "/api/setter-dashboard": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, item: transferred }) });
    }
  });
  await expect(page.locator("#setter-detail h2")).toHaveText("Transferred Lead");
  await page.getByRole("button", { name: "Save setter details" }).click();
  await expect(page.locator("#setter-details-status")).toHaveText("Setter details saved.");
  expect(exactRead).toBe(true);
  expect(writes.some(body => body.client_id === clientId && body.action === "save")).toBe(true);
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

test("setter saves business and personal call details without editing submitted answers", async ({ page }) => {
  const item = structuredClone(queue.items[0]);
  item.survey = [
    { key: "cf_svy_has_business", question: "Do You Have a Business?", answer: "Yes, 1-2 years",
      answer_values: ["Yes, 1-2 years"], type: "single", options: ["Yes, 1-2 years", "No, personal funding only"] },
    { key: "cf_svy_business_revenue", question: "Annual Business Revenue", answer: "$100k - $249k",
      answer_values: ["$100k - $249k"], type: "single", options: ["$100k - $249k"] }
  ];
  let savedHandoff = { ...item.setter_handoff, triage_problem: "Needs cash for inventory", triage_goal: "Open a second shop" };
  const writes = [];
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": () => ({ ...queue, items: [{ ...item, setter_handoff: savedHandoff }] }),
    "/api/setter-dashboard": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      expect(body.action).toBe("save");
      savedHandoff = { ...savedHandoff, ...body.handoff };
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, item: { ...item, setter_handoff: savedHandoff } }) });
    }
  });

  await page.getByRole("combobox", { name: "Funding paths discussed" }).selectOption("both");
  await page.getByRole("combobox", { name: "Employment" }).selectOption("w2");
  await page.getByRole("textbox", { name: "Employer or type of work (optional)" }).fill("Warehouse manager");
  await page.getByRole("combobox", { name: "Annual personal income" }).selectOption("$100k-$199k");
  await page.getByRole("combobox", { name: "Can they verify income?" }).selectOption("Yes, pay stubs");
  await page.getByRole("button", { name: "Save setter details" }).click();
  await expect(page.locator("#setter-details-status")).toHaveText("Setter details saved.");
  expect(writes.some(body => body.handoff.triage_personal_or_business === "both" &&
    body.handoff.employment_status === "w2" && body.handoff.annual_personal_income === "$100k-$199k" &&
    body.handoff.income_verification === "Yes, pay stubs")).toBe(true);
  expect(writes.every(body => body.handoff.triage_problem === "Needs cash for inventory" &&
    body.handoff.triage_goal === "Open a second shop")).toBe(true);
  expect(writes.every(body => body.survey_edits === undefined)).toBe(true);

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Funding paths discussed" })).toHaveValue("both");
  await expect(page.getByRole("combobox", { name: "Employment" })).toHaveValue("w2");
  await expect(page.getByRole("textbox", { name: "Employer or type of work (optional)" })).toHaveValue("Warehouse manager");
  await expect(page.getByRole("combobox", { name: "Annual personal income" })).toHaveValue("$100k-$199k");
  await expect(page.getByRole("combobox", { name: "Can they verify income?" })).toHaveValue("Yes, pay stubs");
  await expect(page.getByRole("combobox", { name: "Do You Have a Business?" })).toHaveValue("Yes, 1-2 years");
  await expect(page.getByRole("combobox", { name: "Annual Business Revenue" })).toHaveValue("$100k - $249k");
});

test("opt-in setter can complete a booked handoff with both funding paths", async ({ page }) => {
  const item = structuredClone(queue.items[0]);
  item.lead_type = "opt_in";
  item.setter_handoff.lead_type = "opt_in";
  item.setter_handoff.triage_problem = "Cash flow";
  item.setter_handoff.triage_goal = "Expand the shop";
  delete item.setter_handoff.complete_at;
  let completed = false;
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": { ...queue, items: [item] },
    "/api/setter-dashboard": async (route) => {
      const body = route.request().postDataJSON();
      expect(body.action).toBe("complete");
      expect(body.handoff.triage_personal_or_business).toBe("both");
      completed = true;
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, item: { ...item, setter_handoff: { ...body.handoff, complete_at: "2026-10-30T18:00:00Z" } } }) });
    }
  });
  await page.getByRole("combobox", { name: "Funding paths discussed" }).selectOption("both");
  await page.getByRole("button", { name: "Mark handoff complete" }).click();
  await expect(page.locator("#setter-status")).toHaveText("Handoff complete and saved on the client.");
  expect(completed).toBe(true);
});

test("each lead's booking links open that lead's own calendar", async ({ page }) => {
  const Q = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";
  const U = "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u";
  const optIn = structuredClone(queue.items[0]);
  optIn.client_id = "bbbbbbbb-2222-4222-8222-222222222222";
  optIn.lead_type = "opt_in"; optIn.booked_at = null; optIn.booking_time = null;
  optIn.booking_url = U;
  delete optIn.setter_handoff.complete_at;
  const booked = { ...structuredClone(queue.items[0]), client_id: "cccccccc-3333-4333-8333-333333333333", booking_url: Q };
  const noScore = { ...structuredClone(queue.items[0]), client_id: "dddddddd-4444-4444-8444-444444444444", booking_url: null };
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": { ...queue, count: 3, items: [optIn, booked, noScore] }
  });

  await page.locator(`#setter-queue [data-client-id="${optIn.client_id}"]`).click();
  await expect(page.getByRole("link", { name: /Open booking calendar/ })).toHaveAttribute("href", U);
  await page.locator(`#setter-queue [data-client-id="${booked.client_id}"]`).click();
  await expect(page.getByRole("link", { name: "Move call time" })).toHaveAttribute("href", Q);
  await page.locator(`#setter-queue [data-client-id="${noScore.client_id}"]`).click();
  await expect(page.getByRole("link", { name: "Move call time" })).toHaveAttribute("href", queue.booking_url);
});

test("correcting a lead's score on the call moves both booking links to the other calendar", async ({ page }) => {
  const Q = "https://apply.fundhub.ai/funding-book-call?fh_tier=q";
  const U = "https://apply.fundhub.ai/funding-book-call--02424?fh_tier=u";
  const item = { ...structuredClone(queue.items[0]), booking_url: U, survey: [
    { key: "cf_svy_self_reported_fico", question: "Your Current Score", answer: "620-699", answer_values: ["620-699"],
      type: "single", options: ["500-619", "620-699", "700-759", "760-850", "Not sure"] }
  ] };
  await openScreen(page, "/app/setter-dashboard.html", SETTER, {
    "/api/read/setter-dashboard": { ...queue, items: [item] },
    "/api/setter-dashboard": async (route) => {
      const body = route.request().postDataJSON();
      expect(body.survey_edits).toEqual({ cf_svy_self_reported_fico: "700-759" });
      await route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ ok: true, survey_edits: body.survey_edits, booking_url: Q }) });
    }
  });
  const move = page.getByRole("link", { name: "Move call time" });
  await expect(move).toHaveAttribute("href", U);
  await page.getByRole("combobox", { name: "Your Current Score" }).selectOption("700-759");
  await page.getByRole("button", { name: "Save survey answers" }).click();
  await expect(page.locator("#setter-survey-status")).toHaveText("Survey answers saved.");
  await expect(move).toHaveAttribute("href", Q);
});
