// The cases both "File protection alerts" screens share (/app/money-alerts.html
// and the Alerts tab of /app/financeos.html). The two pages run the same
// money-alerts.js, so the same controls must send the same exact write; each
// spec supplies its own way of opening the page and a selector scope, and this
// table is the only copy of what they must send.
//
// NOT a spec (Playwright only runs *.spec.mjs). NO BACKEND: the caller's
// page.route() answers /api/**; nothing is saved.
export const AMEX = "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e";
export const VISA = "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17";
export const SECOND_HAND_ENTERED = "0e5a2b44-7c1d-4d6e-9f3a-5b8c1d2e3f40";

const KINDS = [
  ["Pay before the statement closes", "payment_timing"],
  ["Promo rate ending", "promo_end"],
  ["Cash cushion", "cash_reserve"],
  ["New credit", "new_credit"],
];

// [card, id, the date typed, the rate typed, the rate that must be sent]
const PROMOS = [
  ["Change promo on a card that has one", AMEX, "2026-12-20", "2.5", 2.5],
  ["Add a promo to a card with none", VISA, "2026-11-30", "0", 0],
];

// [card, id, its place in the card list, the day picked, the day that must be sent]
const DAYS = [
  ["Business Amex", AMEX, 0, "22", 22],
  ["Personal Visa", VISA, 1, "7", 7],
];

export function defineMoneyAlertCases({ test, expect, open, scope = "" }) {
  const at = (selector) => `${scope}${selector}`;

  test.describe("each switch sends its own kind and the flipped value", () => {
    for (const [name, kind] of KINDS) {
      test(`switch: ${name} (${kind}) turns off, then back on`, async ({ page }) => {
        const { writes } = await open(page);
        const sw = page.locator(at(`[data-act="toggle"][data-kind="${kind}"]`));
        await expect(sw).toHaveAttribute("aria-checked", "true");
        await sw.click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toEqual({ action: "set_alert", kind, enabled: false });
        await expect(sw).toHaveAttribute("aria-checked", "false");
        await sw.click();
        await expect.poll(() => writes.length).toBe(2);
        expect(writes[1]).toEqual({ action: "set_alert", kind, enabled: true });
        await expect(sw).toHaveAttribute("aria-checked", "true");
      });
    }
  });

  test.describe("promo", () => {
    for (const [name, id, date, rate, apr] of PROMOS) {
      test(`${name}: the card, the end date and the rate typed are sent`, async ({ page }) => {
        const { writes } = await open(page);
        await page.locator(at(`[data-act="edit-promo"][data-id="${id}"]`)).click();
        await page.locator(at('input[type="date"]')).first().fill(date);
        await page.locator(at('.edit input[inputmode="decimal"]')).first().fill(rate);
        await page.locator(at(`[data-act="save-promo"][data-id="${id}"]`)).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toEqual({ action: "set_promo", account_id: id, ends_on: date, apr_pct: apr });
      });
    }

    test("Cancel sends nothing and closes the form", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at(`[data-act="edit-promo"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="save-promo"][data-id="${AMEX}"]`))).toBeVisible();
      await page.locator(at(`[data-act="cancel-promo"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="save-promo"][data-id="${AMEX}"]`))).toHaveCount(0);
      expect(writes).toEqual([]);
    });

    test("Remove this promo asks first: Keep it sends nothing, Yes remove it sends a null end date", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at(`[data-act="edit-promo"][data-id="${AMEX}"]`)).click();
      await page.locator(at(`[data-act="ask-remove"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="remove-promo"][data-id="${AMEX}"]`))).toBeVisible();
      // Nothing is sent by asking.
      expect(writes).toEqual([]);
      await page.locator(at(`[data-act="keep-promo"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="remove-promo"][data-id="${AMEX}"]`))).toHaveCount(0);
      expect(writes).toEqual([]);
      await page.locator(at(`[data-act="ask-remove"][data-id="${AMEX}"]`)).click();
      await page.locator(at(`[data-act="remove-promo"][data-id="${AMEX}"]`)).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({ action: "set_promo", account_id: AMEX, ends_on: null });
    });
  });

  test.describe("statement close day", () => {
    // Both cards are typed in by hand and have a day, so each shows "Change day".
    const withDays = (d) => {
      for (const card of d.cards) card.close_day_source = "manual";
      d.cards[1].statement_close_day = 12;
      return d;
    };

    for (const [name, id, , day, sent] of DAYS) {
      test(`Save day on ${name} sends that card's id and the day picked`, async ({ page }) => {
        const { writes } = await open(page, withDays);
        await page.locator(at(`[data-act="edit-day"][data-id="${id}"]`)).click();
        await page.locator(at(`select[data-de="${id}"]`)).selectOption(day);
        await page.locator(at(`[data-act="save-day"][data-id="${id}"]`)).click();
        await expect.poll(() => writes.length).toBe(1);
        expect(writes[0]).toEqual({ action: "set_statement_close_day", account_id: id, day: sent });
      });
    }

    test("Cancel on the change-day form sends nothing and closes the form", async ({ page }) => {
      const { writes } = await open(page, withDays);
      await page.locator(at(`[data-act="edit-day"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="save-day"][data-id="${AMEX}"]`))).toBeVisible();
      await page.locator(at(`[data-act="cancel-day"][data-id="${AMEX}"]`)).click();
      await expect(page.locator(at(`[data-act="save-day"][data-id="${AMEX}"]`))).toHaveCount(0);
      expect(writes).toEqual([]);
    });

    const twoNeedingADay = (d) => {
      d.cards.push({
        ...JSON.parse(JSON.stringify(d.cards[1])),
        account_id: SECOND_HAND_ENTERED, name: "Personal Mastercard", mask: "9090",
      });
      return d;
    };

    test("Save days sends one write per card that was given a day, each with its own day", async ({ page }) => {
      const { writes } = await open(page, twoNeedingADay);
      await page.locator(at(`select[data-cd="${VISA}"]`)).selectOption("9");
      await page.locator(at(`select[data-cd="${SECOND_HAND_ENTERED}"]`)).selectOption("28");
      await page.locator(at('[data-act="save-days"]')).click();
      await expect.poll(() => writes.length).toBe(2);
      const byCard = Object.fromEntries(writes.map((w) => [w.account_id, w]));
      expect(byCard[VISA]).toEqual({ action: "set_statement_close_day", account_id: VISA, day: 9 });
      expect(byCard[SECOND_HAND_ENTERED]).toEqual({ action: "set_statement_close_day", account_id: SECOND_HAND_ENTERED, day: 28 });
    });

    test("Save days leaves a card with no day picked alone, and sends nothing when none is picked", async ({ page }) => {
      const { writes } = await open(page, twoNeedingADay);
      await page.locator(at('[data-act="save-days"]')).click();
      await expect(page.getByText("Pick a day from the list first.").first()).toBeVisible();
      expect(writes).toEqual([]);
      await page.locator(at(`select[data-cd="${SECOND_HAND_ENTERED}"]`)).selectOption("3");
      await page.locator(at('[data-act="save-days"]')).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_statement_close_day", account_id: SECOND_HAND_ENTERED, day: 3 });
    });
  });
}
