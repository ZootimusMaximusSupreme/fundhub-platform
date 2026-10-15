// Command Center frame: the two sheets a tab gets before a paid tap (finish-the-853, batch 01,
// repair cycle 1). This is the part of the "cost sheet and two-tap confirm sheet drawn before every
// paid tap" row that is the frame's own: what the cost sheet prints when the cost IS known, that its
// Yes waits for the cost, and that every way out other than Yes is a No.
//
// The real frame (public/app/marketing-command-center.js) runs against a probe tab written the way
// a tab unit writes one (e2e/helpers/cc-frame-probe.mjs). Fake answers; nothing is spent.
import { test, expect } from "@playwright/test";
import { OWNER, json, wireApi, withSession } from "./harness.mjs";
import { withProbe } from "./helpers/cc-frame-probe.mjs";

test.describe.configure({ timeout: 60_000 });
test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const PAGE = "/app/marketing-command-center.html";

const COSTS = {
  ok: true,
  kinds: { script: { last_cost_usd: 0.42, last_minutes: 4.4, measured_at: "2026-10-04T18:00:00Z" } },
  month: { used_usd: 12.48, cap_usd: 300 },
};

async function openProbe(page, { costs = (route) => json(route, COSTS), posted = [] } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, {
    "/api/marketing/costs": costs,
    "/api/marketing/today": (route) => json(route, { ok: false, error: "not_found" }, 404),
    "/api/marketing/probe": async (route, { method }) => {
      if (method === "POST") {
        posted.push(route.request().postDataJSON());
        return json(route, { ok: true });
      }
      return json(route, { ok: true, word: "Read through ctx.api.", spend_cents: 123456, as_of: "2026-10-05T19:00:00Z" });
    },
  });
  await withProbe(page);
  await page.goto(`${PAGE}#probe/ads`);
  await expect(page.locator("#prWord")).toHaveText("Read through ctx.api.");
  return { posted };
}

const answers = (page) => page.evaluate(() => window.__probe.answers);
const confirmed = (page) => page.evaluate(() => window.__probe.confirmed);
const sheet = (page) => page.locator(".cc-sheet");

test.describe("frame: the cost sheet", () => {
  test("when the cost is known the sheet prints it, and the month's spend, in words", async ({ page }) => {
    await openProbe(page);
    await page.locator("#prCost").click();
    await expect(sheet(page).locator("[data-sheet-cost]")).toHaveText("About $0.42 and about 4 minutes (last run).");
    await expect(sheet(page).locator("[data-sheet-month]")).toHaveText("Model spend this month: $12.48 of $300.00.");
    await expect(sheet(page).locator('[data-sheet="yes"]')).toBeEnabled();
  });

  test("a kind with no measured run says unknown, never a made-up number", async ({ page }) => {
    await openProbe(page, { costs: (route) => json(route, { ok: true, kinds: { other: { last_cost_usd: 1, last_minutes: 1 } }, month: { used_usd: null, cap_usd: 300 } }) });
    await page.locator("#prCost").click();
    await expect(sheet(page).locator("[data-sheet-cost]")).toHaveText("Cost: unknown, not measured yet.");
    await expect(sheet(page).locator("[data-sheet-month]")).toHaveText("Model spend this month: unknown.");
  });

  test("Yes is off, and the sheet says it is checking the cost, until the cost has come back", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await openProbe(page, { costs: async (route) => { await held; return json(route, COSTS); } });
    await page.locator("#prCost").click();
    await expect(sheet(page).locator("[data-sheet-cost]")).toHaveText("Checking the cost…");
    await expect(sheet(page).locator('[data-sheet="yes"]')).toBeDisabled();
    // A press on a Yes that is off does nothing: no run, no answer.
    await sheet(page).locator('[data-sheet="yes"]').click({ force: true });
    await page.waitForTimeout(200);
    await expect(sheet(page)).toHaveCount(1);
    expect(await confirmed(page)).toBe(0);
    expect(await answers(page)).toEqual([]);
    release();
    await expect(sheet(page).locator("[data-sheet-cost]")).toHaveText("About $0.42 and about 4 minutes (last run).");
    await expect(sheet(page).locator('[data-sheet="yes"]')).toBeEnabled();
    await sheet(page).locator('[data-sheet="yes"]').click();
    await expect(sheet(page)).toHaveCount(0);
    expect(await confirmed(page)).toBe(1);
    expect(await answers(page)).toEqual([["cost", true]]);
  });

  test("a tap outside the sheet is a No: nothing runs and the answer is false", async ({ page }) => {
    await openProbe(page);
    await page.locator("#prCost").click();
    await expect(sheet(page).locator('[data-sheet="yes"]')).toBeEnabled();
    await sheet(page).click({ position: { x: 3, y: 3 } });
    await expect(sheet(page)).toHaveCount(0);
    expect(await confirmed(page)).toBe(0);
    expect(await answers(page)).toEqual([["cost", false]]);
  });

  test("Cancel is a No, Escape is a No, and only Yes runs the work, once", async ({ page }) => {
    await openProbe(page);
    await page.locator("#prCost").click();
    await sheet(page).locator('[data-sheet="no"]').click();
    await page.locator("#prCost").click();
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    expect(await confirmed(page)).toBe(0);
    expect(await answers(page)).toEqual([["cost", false], ["cost", false]]);
    await page.locator("#prCost").click();
    await expect(sheet(page).locator('[data-sheet="yes"]')).toBeEnabled();
    await sheet(page).locator('[data-sheet="yes"]').click();
    expect(await confirmed(page)).toBe(1);
    expect(await answers(page)).toEqual([["cost", false], ["cost", false], ["cost", true]]);
  });

  test("leaving the tab while the sheet is open is a No", async ({ page }) => {
    await openProbe(page);
    await page.locator("#prCost").click();
    await expect(sheet(page)).toHaveCount(1);
    await page.evaluate(() => { location.hash = "#today"; });
    await expect(sheet(page)).toHaveCount(0);
    expect(await confirmed(page)).toBe(0);
    expect(await answers(page)).toEqual([["cost", false]]);
  });

  test("while the sheet is open the page behind it cannot be pressed", async ({ page }) => {
    await openProbe(page);
    await page.locator("#prCost").click();
    await expect(sheet(page)).toHaveCount(1);
    await expect(page.locator(".app > .main")).toHaveAttribute("inert", "");
    // A second paid tap on the page behind the sheet cannot open another sheet.
    await page.locator("#prTurn").click({ force: true, trial: false }).catch(() => {});
    await expect(sheet(page)).toHaveCount(1);
    await expect(sheet(page).locator("h2")).toHaveText("Write 3 scripts?");
  });
});

test.describe("frame: the two-tap confirm", () => {
  test("it names the consequence, and a tap outside it is a No that sends nothing", async ({ page }) => {
    const { posted } = await openProbe(page);
    await page.locator("#prTurn").click();
    await expect(page.locator('.cc-sheet [role="alertdialog"] .cc-sheet-body')).toHaveText("Ad 84 starts spending $40.00 a day.");
    await sheet(page).click({ position: { x: 3, y: 3 } });
    await expect(sheet(page)).toHaveCount(0);
    expect(await answers(page)).toEqual([["confirm", false]]);
    expect(posted).toEqual([]);
  });

  test("Cancel sends nothing, and Yes sends exactly one write", async ({ page }) => {
    const { posted } = await openProbe(page);
    await page.locator("#prTurn").click();
    await sheet(page).locator('[data-sheet="no"]').click();
    expect(posted).toEqual([]);
    await page.locator("#prTurn").click();
    await sheet(page).locator('[data-sheet="yes"]').click();
    await expect.poll(() => posted.length).toBe(1);
    await page.waitForTimeout(200);
    expect(posted).toHaveLength(1);
    expect(await answers(page)).toEqual([["confirm", false], ["confirm", true]]);
  });
});
