import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const block = readFileSync(new URL("../marketing/landing-pages/04h-book-survey-entry.html", import.meta.url), "utf8");
const calendar = `<!doctype html><html><head>${block}</head><body><main id="scheduler">Choose a call time</main></body></html>`;

async function openCalendar(page, { ticket, accepted } = {}) {
  await page.route("https://apply.fundhub.ai/funding-book-call", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: calendar }));
  await page.route("https://apply.fundhub.ai/apply", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Funding survey</h1>" }));
  await page.route("https://fundhub.ai/api/public/survey-resume?**", (route) =>
    route.fulfill({ status: accepted ? 200 : 404, contentType: "application/json",
      headers: { "access-control-allow-origin": "https://apply.fundhub.ai" },
      body: JSON.stringify({ ok: !!accepted }) }));
  const suffix = ticket ? `#fh_survey_ticket=${ticket}` : "";
  await page.goto(`https://apply.fundhub.ai/funding-book-call${suffix}`);
}

test("a saved completion ticket opens the calendar in a browser", async ({ page }) => {
  await openCalendar(page, { ticket: "signed-completion", accepted: true });
  await expect(page.locator("#scheduler")).toBeVisible();
  await expect(page).toHaveURL(/\/funding-book-call#fh_survey_ticket=/);
});

test("direct and rejected calendar visits go back to the survey", async ({ page }) => {
  await openCalendar(page);
  await expect(page).toHaveURL("https://apply.fundhub.ai/apply");
  await expect(page.getByRole("heading", { name: "Funding survey" })).toBeVisible();
  await openCalendar(page, { ticket: "bad-ticket", accepted: false });
  await expect(page).toHaveURL("https://apply.fundhub.ai/apply");
});
