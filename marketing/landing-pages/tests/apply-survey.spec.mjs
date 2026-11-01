import { test, expect } from "@playwright/test";

const BUSINESS_OPTS = [
  "Yes, less than 6 months old",
  "Yes, 6-12 months",
  "Yes, 1-2 years",
  "Yes, 2-5 years",
  "Yes, 5+ years",
  "No, personal funding only",
];

async function fillContact(page) {
  await page.getByLabel("First Name").fill("Jane");
  await page.getByLabel("Last Name").fill("Doe");
  await page.getByLabel("Email").fill("jane@example.com");
  await page.getByLabel("Phone Number").fill("4805551234");
  await page.getByRole("button", { name: "Next" }).click();
}

/** Single-select steps auto-advance. Wait for the next heading, not a timer. */
async function pickSingle(page, label, nextHeading) {
  await page.getByRole("radio", { name: label, exact: true }).click();
  if (nextHeading) {
    await expect(page.getByRole("heading", { name: nextHeading, exact: true })).toBeVisible();
  }
}

function watchConsole(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR_|favicon/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function expectStep(page, heading, question, pct) {
  await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
  const count = page.locator("#count");
  await expect(count).toContainText(question);
  await expect(count).toContainText(pct);
}

/** Trunk after contact: target → use → money → score → business question. */
async function walkTrunk(page) {
  await expectStep(page, "Set Your Target Amount", "Question 2 of 9", "10%");
  await pickSingle(page, "Less than $50k", "Planned Use");
  await expectStep(page, "Planned Use", "Question 3 of 9", "20%");
  await pickSingle(page, "Growth (marketing, inventory, hiring)", "What Would This Money Change Right Now?");
  await expectStep(page, "What Would This Money Change Right Now?", "Question 4 of 9", "30%");
  await expect(page.getByRole("button", { name: "Next" })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /Peace of mind/ }).click();   // one tap moves on
  await expectStep(page, "Your Current Score", "Question 5 of 9", "40%");
  await pickSingle(page, "620-699", "Do You Have a Business?");
  await expectStep(page, "Do You Have a Business?", "Question 6 of 9", "50%");
}

async function finishToCalendar(page) {
  await expect(page.getByRole("heading", { name: "Available Capital", exact: true })).toBeVisible();
  await expect(page.locator("#count")).toContainText("Question 9 of 9");
  await expect(page.locator("#count")).toContainText("80%");
  await page.getByRole("radio", { name: "Less than $1k", exact: true }).click();
  await expect(page.getByRole("heading", { name: "You're qualified. Pick a time below." })).toBeVisible();
  const cal = page.locator("#cal");
  await expect(cal).toBeVisible();
  await expect(cal.getByRole("heading", { name: "Pick a time for your call" })).toBeVisible();
  await expect(cal.getByText("Free call")).toBeVisible();
  await expect(cal.getByText("Soft pull only, zero score impact")).toBeVisible();
  await expect(cal.getByText("Reschedule anytime")).toBeVisible();
}

async function openSurvey(page) {
  const errors = watchConsole(page);
  await page.goto("/apply-survey.html", { waitUntil: "domcontentloaded" });
  await fillContact(page);
  await walkTrunk(page);
  return errors;
}

test.describe("apply-survey smoke", () => {
  test("loads contact step", async ({ page }) => {
    await page.goto("/apply-survey.html", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Let's See What You Qualify For" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Let's Start With Your Info" })).toBeVisible();
    await expect(page.getByText("Secure application")).toBeVisible();
    await expect(page.locator("#count")).toContainText("Question 1 of");
    await expect(page.locator("#count")).toContainText("0%");
  });

  test("progress text updates after contact", async ({ page }) => {
    await page.goto("/apply-survey.html", { waitUntil: "domcontentloaded" });
    await fillContact(page);
    const count = page.locator("#count");
    await expect(count).toContainText("Question 2 of");
    await expect(count).toContainText("10%");
  });

  test("business step shows six branch options", async ({ page }) => {
    const errors = await openSurvey(page);
    for (const label of BUSINESS_OPTS) {
      await expect(page.getByRole("radio", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("radio")).toHaveCount(6);
    expect(errors).toEqual([]);
  });

  test("personal path: 9 steps then calendar, no business questions", async ({ page }) => {
    const errors = await openSurvey(page);
    await pickSingle(page, "No, personal funding only", "Annual Personal Income");
    await expect(page.getByRole("heading", { name: "Annual Business Revenue" })).toHaveCount(0);
    await expectStep(page, "Annual Personal Income", "Question 7 of 9", "60%");
    await pickSingle(page, "$50k-$99k", "Can You Verify Income?");
    await expectStep(page, "Can You Verify Income?", "Question 8 of 9", "70%");
    await pickSingle(page, "Yes, pay stubs", "Available Capital");
    await finishToCalendar(page);
    const payload = await page.evaluate(() => window.FH_SURVEY_PAYLOAD);
    expect(payload.funnel).toBe("apply-survey");
    expect(payload.answers.cf_svy_has_business).toBe("No, personal funding only");
    expect(payload.answers.cf_svy_annual_income_range).toBe("$50k-$99k");
    expect(payload.answers.cf_svy_income_verifiable).toBe("Yes, pay stubs");
    expect(payload.answers.cf_svy_available_capital).toBe("Less than $1k");
    expect(payload.answers.cf_svy_business_revenue).toBeUndefined();
    expect(payload.answers.cf_svy_revenue_verifiable).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("business path: 9 steps then calendar, no personal questions", async ({ page }) => {
    const errors = await openSurvey(page);
    await pickSingle(page, "Yes, 5+ years", "Annual Business Revenue");
    await expect(page.getByRole("heading", { name: "Annual Personal Income" })).toHaveCount(0);
    await expectStep(page, "Annual Business Revenue", "Question 7 of 9", "60%");
    await pickSingle(page, "Under $100k", "Can You Verify Revenue?");
    await expectStep(page, "Can You Verify Revenue?", "Question 8 of 9", "70%");
    await pickSingle(page, "Yes, bank statements", "Available Capital");
    await finishToCalendar(page);
    const payload = await page.evaluate(() => window.FH_SURVEY_PAYLOAD);
    expect(payload.funnel).toBe("apply-survey");
    expect(payload.answers.cf_svy_has_business).toBe("Yes, 5+ years");
    expect(payload.answers.cf_svy_business_revenue).toBe("Under $100k");
    expect(payload.answers.cf_svy_revenue_verifiable).toBe("Yes, bank statements");
    expect(payload.answers.cf_svy_available_capital).toBe("Less than $1k");
    expect(payload.answers.cf_svy_annual_income_range).toBeUndefined();
    expect(payload.answers.cf_svy_income_verifiable).toBeUndefined();
    expect(errors).toEqual([]);
  });

  test("SEND_STEP posts contact then a labeled survey answer", async ({ page }) => {
    const posts = [];
    await page.route("**/api/webhooks/clickfunnels", async (route) => {
      posts.push({
        body: route.request().postDataJSON(),
        ingest: route.request().headers()["x-fundhub-apply-survey-ingest"]
      });
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.addInitScript(() => {
      window.FH_APPLY_SURVEY_WEBHOOK_FORCE = true;
      window.FH_APPLY_SURVEY_INGEST = "playwright-ingest";
    });
    await page.goto("/apply-survey.html", { waitUntil: "domcontentloaded" });
    await fillContact(page);
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].ingest).toBe("playwright-ingest");
    expect(posts[0].body.funnel).toBe("apply-survey");
    expect(posts[0].body.source).toBe("apply-survey");
    expect(posts[0].body.step_key).toBe("contact");
    expect(posts[0].body.email).toBe("jane@example.com");
    expect(posts[0].body.name).toBe("Jane Doe");
    expect(posts[0].body.answers).toEqual({});
    expect(posts[0].body.attribution).toMatchObject({
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      landing_path: null,
      referrer_domain: null
    });
    await pickSingle(page, "Less than $50k", "Planned Use");
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].body.step_key).toBe("cf_svy_funding_target_amount");
    expect(posts[1].body.answers.cf_svy_funding_target_amount).toBe("Less than $50k");
  });
});
