// FinanceOS "Alerts" tab (financeos.html#alerts) — the promo form, removing a
// promo, a card's statement close day and the batch "Save days" send the exact
// write. Each of the four on/off switches is pressed here too.
// NO BACKEND: page.route() answers /api/**; nothing is saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { json, withSession } from "./harness.mjs";

const FIXTURE = JSON.parse(fs.readFileSync(
  new URL("../src/finance/file-alerts/file-alerts.fixture.json", import.meta.url), "utf8"));
const AMEX = "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e";
const VISA = "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17";
const SECOND = "0e5a2b44-7c1d-4d6e-9f3a-5b8c1d2e3f40";

async function open(page, mutate = (d) => d) {
  const writes = [];
  const data = mutate(JSON.parse(JSON.stringify(FIXTURE)));
  await withSession(page, { staff: { role: "client" } });
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (url.includes("/api/money/alerts")) {
      if (route.request().method() === "POST") {
        writes.push(route.request().postDataJSON());
        return json(route, { ok: true, saved: true });
      }
      return json(route, data);
    }
    if (url.includes("/api/money/overview")) return json(route, { ok: true, client: { name: "Dana Whitfield" }, sandbox: false });
    return json(route, { ok: true });
  });
  await page.goto("/app/financeos.html#alerts");
  await expect(page.locator('#fos-alerts [data-act="toggle"]').first()).toBeVisible({ timeout: 10_000 });
  return { writes };
}

test.describe("FinanceOS alerts tab", () => {
  for (const kind of ["payment_timing", "promo_end", "cash_reserve", "new_credit"]) {
    test(`switch ${kind} turns off, then back on, sending its own kind`, async ({ page }) => {
      const { writes } = await open(page);
      const sw = page.locator(`#fos-alerts [data-act="toggle"][data-kind="${kind}"]`);
      await sw.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_alert", kind, enabled: false });
      await sw.click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual({ action: "set_alert", kind, enabled: true });
    });
  }

  test("Save promo sends the card, the end date and the rate typed", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`#fos-alerts [data-act="edit-promo"][data-id="${AMEX}"]`).click();
    await page.locator("#fos-alerts input[type=date]").first().fill("2026-12-20");
    await page.locator('#fos-alerts .edit input[inputmode="decimal"]').first().fill("1.9");
    await page.locator(`#fos-alerts [data-act="save-promo"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "set_promo", account_id: AMEX, ends_on: "2026-12-20", apr_pct: 1.9 });
  });

  test("Remove this promo asks first; Keep it sends nothing; Yes sends a null end date", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`#fos-alerts [data-act="edit-promo"][data-id="${AMEX}"]`).click();
    await page.locator(`#fos-alerts [data-act="ask-remove"][data-id="${AMEX}"]`).click();
    await page.locator(`#fos-alerts [data-act="keep-promo"][data-id="${AMEX}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await page.locator(`#fos-alerts [data-act="ask-remove"][data-id="${AMEX}"]`).click();
    await page.locator(`#fos-alerts [data-act="remove-promo"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ action: "set_promo", account_id: AMEX, ends_on: null });
  });

  test("Change day then Save day sends that card and the day; Cancel sends nothing", async ({ page }) => {
    const { writes } = await open(page, (d) => { d.cards[0].close_day_source = "manual"; return d; });
    await page.locator(`#fos-alerts [data-act="edit-day"][data-id="${AMEX}"]`).click();
    await page.locator(`#fos-alerts [data-act="cancel-day"][data-id="${AMEX}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await page.locator(`#fos-alerts [data-act="edit-day"][data-id="${AMEX}"]`).click();
    await page.locator(`#fos-alerts select[data-de="${AMEX}"]`).selectOption("22");
    await page.locator(`#fos-alerts [data-act="save-day"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "set_statement_close_day", account_id: AMEX, day: 22 });
  });

  test("Save days sends each hand-entered card with its own day", async ({ page }) => {
    const { writes } = await open(page, (d) => {
      d.cards.push({ ...JSON.parse(JSON.stringify(d.cards[1])), account_id: SECOND, name: "Personal Mastercard", mask: "9090" });
      return d;
    });
    await page.locator(`#fos-alerts select[data-cd="${VISA}"]`).selectOption("9");
    await page.locator(`#fos-alerts select[data-cd="${SECOND}"]`).selectOption("28");
    await page.locator('#fos-alerts [data-act="save-days"]').click();
    await expect.poll(() => writes.length).toBe(2);
    const byCard = Object.fromEntries(writes.map((w) => [w.account_id, w]));
    expect(byCard[VISA]).toEqual({ action: "set_statement_close_day", account_id: VISA, day: 9 });
    expect(byCard[SECOND]).toEqual({ action: "set_statement_close_day", account_id: SECOND, day: 28 });
  });
});
