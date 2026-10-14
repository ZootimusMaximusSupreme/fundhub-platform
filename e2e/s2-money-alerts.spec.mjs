// File protection alerts (/app/money-alerts.html) — every control that changes
// what a client is texted about must send the exact write the server expects.
//
// The four switches, the promo form, removing a promo, one card's statement
// close day and the batch "Save days" each go through POST /api/money/alerts.
// This presses each one in a real page and judges the exact body, so a switch
// that flips the wrong kind, or a day sent against the wrong card, turns red.
// NO BACKEND: page.route() answers /api/**; nothing is saved.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { openScreen, json } from "./harness.mjs";

const FIXTURE = JSON.parse(fs.readFileSync(
  new URL("../src/finance/file-alerts/file-alerts.fixture.json", import.meta.url), "utf8"));
const CLIENT_SESSION = { ok: true, staff: { id: "client-1", name: "Dana Whitfield", email: "dana@example.test", role: "client", org_id: "org-1", status: "active" } };
const AMEX = "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e";
const VISA = "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17";
const SECOND_HAND_ENTERED = "0e5a2b44-7c1d-4d6e-9f3a-5b8c1d2e3f40";

async function open(page, mutate = (d) => d) {
  const writes = [];
  const reads = [];
  const data = mutate(JSON.parse(JSON.stringify(FIXTURE)));
  await openScreen(page, "/app/money-alerts.html", CLIENT_SESSION, {
    "/api/money/alerts": async (route, { method }) => {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        writes.push(body);
        return json(route, { ok: true, saved: true });
      }
      reads.push(route.request().url());
      return json(route, data);
    },
  });
  await expect(page.locator(".fh-alerts h1")).toHaveText("File protection alerts", { timeout: 10_000 });
  await expect(page.locator('[data-act="toggle"]').first()).toBeVisible();
  return { writes, reads };
}

const KINDS = [
  ["Pay before the statement closes", "payment_timing"],
  ["Promo rate ending", "promo_end"],
  ["Cash cushion", "cash_reserve"],
  ["New credit", "new_credit"],
];

test.describe("money alerts: each switch sends its own kind and the flipped value", () => {
  for (const [name, kind] of KINDS) {
    test(`switch: ${name} (${kind}) turns off, then back on`, async ({ page }) => {
      const { writes } = await open(page);
      const sw = page.locator(`[data-act="toggle"][data-kind="${kind}"]`);
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await sw.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_alert", kind, enabled: false });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await sw.click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual({ action: "set_alert", kind, enabled: true });
    });
  }
});

test.describe("money alerts: promo", () => {
  test("Change promo: the new end date and rate are sent for that card only", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`[data-act="edit-promo"][data-id="${AMEX}"]`).click();
    const ends = page.locator(`input[type="date"]`).first();
    await ends.fill("2026-12-20");
    await page.locator(`.edit input[inputmode="decimal"]`).first().fill("2.5");
    await page.locator(`[data-act="save-promo"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "set_promo", account_id: AMEX, ends_on: "2026-12-20", apr_pct: 2.5 });
  });

  test("Add a promo to a card with none sends its own account id", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`[data-act="edit-promo"][data-id="${VISA}"]`).click();
    await page.locator(`input[type="date"]`).first().fill("2026-11-30");
    await page.locator(`.edit input[inputmode="decimal"]`).first().fill("0");
    await page.locator(`[data-act="save-promo"][data-id="${VISA}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "set_promo", account_id: VISA, ends_on: "2026-11-30", apr_pct: 0 });
  });

  test("Cancel sends nothing", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`[data-act="edit-promo"][data-id="${AMEX}"]`).click();
    await page.locator(`[data-act="cancel-promo"][data-id="${AMEX}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
  });

  test("Remove this promo asks first: Keep it sends nothing, Yes remove it sends a null end date", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator(`[data-act="edit-promo"][data-id="${AMEX}"]`).click();
    await page.locator(`[data-act="ask-remove"][data-id="${AMEX}"]`).click();
    await page.locator(`[data-act="keep-promo"][data-id="${AMEX}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await page.locator(`[data-act="ask-remove"][data-id="${AMEX}"]`).click();
    await page.locator(`[data-act="remove-promo"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ action: "set_promo", account_id: AMEX, ends_on: null });
  });
});

test.describe("money alerts: statement close day", () => {
  test("Save day on one card sends that card's id and the day picked", async ({ page }) => {
    const { writes } = await open(page, (d) => {
      d.cards[0].close_day_source = "manual";
      return d;
    });
    await page.locator(`[data-act="edit-day"][data-id="${AMEX}"]`).click();
    await page.locator(`select[data-de="${AMEX}"]`).selectOption("22");
    await page.locator(`[data-act="save-day"][data-id="${AMEX}"]`).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "set_statement_close_day", account_id: AMEX, day: 22 });
  });

  test("Cancel on the change-day form sends nothing", async ({ page }) => {
    const { writes } = await open(page, (d) => {
      d.cards[0].close_day_source = "manual";
      return d;
    });
    await page.locator(`[data-act="edit-day"][data-id="${AMEX}"]`).click();
    await page.locator(`[data-act="cancel-day"][data-id="${AMEX}"]`).click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
  });

  test("Save days sends one write per hand-entered card, each with its own day", async ({ page }) => {
    const { writes } = await open(page, (d) => {
      d.cards.push({
        ...JSON.parse(JSON.stringify(d.cards[1])),
        account_id: SECOND_HAND_ENTERED, name: "Personal Mastercard", mask: "9090",
      });
      return d;
    });
    await page.locator(`select[data-cd="${VISA}"]`).selectOption("9");
    await page.locator(`select[data-cd="${SECOND_HAND_ENTERED}"]`).selectOption("28");
    await page.locator('[data-act="save-days"]').click();
    await expect.poll(() => writes.length).toBe(2);
    const byCard = Object.fromEntries(writes.map((w) => [w.account_id, w]));
    expect(byCard[VISA]).toEqual({ action: "set_statement_close_day", account_id: VISA, day: 9 });
    expect(byCard[SECOND_HAND_ENTERED]).toEqual({ action: "set_statement_close_day", account_id: SECOND_HAND_ENTERED, day: 28 });
  });
});
