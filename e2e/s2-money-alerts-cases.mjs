// The cases both Alerts screens share (/app/money-alerts.html
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
export const GWS = "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e01";
export const QBO = "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e02";
/* The sample's business and the two things the client added (src/finance/file-alerts/sample-payload.mjs). */
export const SAMPLE_CO = "5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";
export const SAVINGS_ALERT = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
export const OFFICE_RENT = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e2";

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

  // Phone alerts (unit D, 2026-11-06). The fixture's two repeat bills are paid by
  // Sample Co LLC: Google Workspace has its phone alert on (Important), QuickBooks
  // Online does not. The settings card keeps the one switch and the list of kinds;
  // each payment and bill shows its own alert on the board (unit AL2).
  test.describe("phone alerts", () => {
    test("the settings card lists every kind; the board shows each payment's alert, Personal first, then the business", async ({ page }) => {
      await open(page);
      const card = page.locator(at("#fa-phone"));
      await expect(card.locator("h2")).toHaveText("Phone alerts");
      await expect(card.locator(".ph-kinds li")).toHaveText(["On Card payment due", "On Statement closes", "On Important bill",
        "On Loan payment due", "On Credit line payment due", "On Payment plan due", "On Alert you added", "On Bill you added"]);
      // Every payment, not only cards (D2, owner-set 2026-11-07): the plan is personal, the SBA loan is the business's.
      await expect(page.locator(at("#fa-pay .row-name"))).toContainText(["Payment plan with Fundhub LLC"]);
      await page.locator(at(`[data-act="scope"][data-scope="biz:${SAMPLE_CO}"]`)).click();
      await expect(page.locator(at("#fa-pay .row-name"))).toContainText(["Business Amex ending 4404", "SBA Loan"]);
      await expect(page.locator(at(`[data-act="toggle-bill"][data-id="${GWS}"]`))).toHaveAttribute("aria-checked", "true");
      await expect(page.locator(at(`[data-act="toggle-bill"][data-id="${QBO}"]`))).toHaveAttribute("aria-checked", "false");
    });

    test("the phone alert switch on a found bill sends that bill and the flipped value", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at(`[data-act="scope"][data-scope="biz:${SAMPLE_CO}"]`)).click();
      await page.locator(at(`[data-act="toggle-bill"][data-id="${QBO}"]`)).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_bill_important", bill_id: QBO, important: true });
      await page.locator(at(`[data-act="toggle-bill"][data-id="${GWS}"]`)).click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual({ action: "set_bill_important", bill_id: GWS, important: false });
    });

    test("the phone switch turns every phone alert off, then back on", async ({ page }) => {
      const { writes } = await open(page);
      const sw = page.locator(at('[data-act="toggle-phone"]'));
      await expect(sw).toHaveAttribute("aria-checked", "true");
      await sw.click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_phone_alerts", enabled: false });
      await expect(sw).toHaveAttribute("aria-checked", "false");
      await expect(page.locator(at(".ph-kinds li")).first()).toHaveText("Off Card payment due");
      await sw.click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual({ action: "set_phone_alerts", enabled: true });
    });
  });

  /* The organized board and the client's own alerts and bills (unit AL2, 2026-11-07). */
  test.describe("the board: Personal and each business", () => {
    test("the switcher shows one scope at a time, with its own payments, bills and smart alerts", async ({ page }) => {
      await open(page);
      const personal = page.locator(at('[data-act="scope"][data-scope="personal"]'));
      const biz = page.locator(at(`[data-act="scope"][data-scope="biz:${SAMPLE_CO}"]`));
      await expect(personal).toHaveAttribute("aria-pressed", "true");
      await expect(biz).toHaveText("Sample Co LLC");
      await expect(page.locator(at("#fa-pay"))).toContainText("Move money to savings");
      // The Visa has no close day, so its Pay by comes from its due date (the alerts bundle's rule, folded in).
      await expect(page.locator(at("#fa-smart .smart-item .badge"))).toHaveText(["Pay by Oct 23", "Cash low"]);
      await expect(page.locator(at("#fa-smart"))).toContainText("Pay $520.40 to get under 10%. Due Oct 25.");
      await biz.click();
      await expect(biz).toHaveAttribute("aria-pressed", "true");
      await expect(personal).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(at("#fa-pay"))).not.toContainText("Move money to savings");
      await expect(page.locator(at("#fa-smart .smart-item .badge"))).toHaveText(["Charged twice", "Pay by Oct 13", "Price went up", "Seasoned in 18 days"]);
      await expect(page.locator(at("#fa-smart"))).toContainText("Pay $2,900.00 to report under 10%. Closes Oct 15.");
      await expect(page.locator(at("#fa-bills .row-name"))).toContainText(["Google Workspace", "QuickBooks Online", "Office rent"]);
      await expect(page.locator(at("h2"), { hasText: "Coming up" })).toHaveCount(0);
    });

    test("Add alert sends add_custom with exactly what was typed, then closes the form", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at('[data-act="add"][data-kind="alert"]')).click();
      await page.locator(at("#fa-cf-name")).fill("  Pay the contractor ");
      await page.locator(at("#fa-cf-amount")).fill("$1,250.50");
      await page.locator(at("#fa-cf-cadence")).selectOption("once");
      await page.locator(at("#fa-cf-date")).fill("2026-10-20");
      await page.locator(at("#fa-cf-for")).selectOption(`biz:${SAMPLE_CO}`);
      await page.locator(at('[data-act="form-phone"]')).click();
      await expect(page.locator(at('[data-act="form-phone"]'))).toHaveAttribute("aria-checked", "false");
      await page.locator(at('[data-act="save-custom"]')).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "add_custom", kind: "alert", name: "Pay the contractor", amount_cents: 125050, cadence: "once",
        start_on: "2026-10-20", scope: "business", entity_id: SAMPLE_CO, phone_alert: false });
      await expect(page.locator(at('[data-form="custom"]'))).toHaveCount(0);
    });

    test("Add bill: a monthly bill on a day of the month, for Personal; Cancel sends nothing", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at('[data-act="add"][data-kind="bill"]')).click();
      await page.locator(at('[data-act="cancel-custom"]')).click();
      await expect(page.locator(at('[data-form="custom"]'))).toHaveCount(0);
      expect(writes).toEqual([]);
      await page.locator(at('[data-act="add"][data-kind="bill"]')).click();
      await page.locator(at("#fa-cf-name")).fill("Gym");
      await page.locator(at("#fa-cf-amount")).fill("45");
      await page.locator(at("#fa-cf-day")).selectOption("5");
      await page.locator(at("#fa-cf-name")).press("Enter");
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "add_custom", kind: "bill", name: "Gym", amount_cents: 4500, cadence: "monthly",
        day_of_month: 5, scope: "personal", phone_alert: true });
    });

    test("a bill with no amount, or a date that passed, is stopped before sending, and says which field", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at('[data-act="add"][data-kind="bill"]')).click();
      await page.locator(at("#fa-cf-name")).fill("Insurance");
      await page.locator(at('[data-act="save-custom"]')).click();
      await expect(page.locator(at("#fa-cf-msg"))).toHaveText("Type the amount like 45 or 45.99.");
      await expect(page.locator(at("#fa-cf-amount"))).toHaveAttribute("aria-invalid", "true");
      await expect(page.locator(at("#fa-cf-name"))).toHaveValue("Insurance", { timeout: 2_000 });
      await page.locator(at('[data-act="cancel-custom"]')).click();
      await page.locator(at('[data-act="add"][data-kind="alert"]')).click();
      await page.locator(at("#fa-cf-name")).fill("Old");
      await page.locator(at("#fa-cf-cadence")).selectOption("once");
      await page.locator(at("#fa-cf-date")).fill("2026-10-01");
      await page.locator(at('[data-act="save-custom"]')).click();
      await expect(page.locator(at("#fa-cf-msg"))).toHaveText("That day has passed. Pick today or a later day.");
      expect(writes).toEqual([]);
    });

    test("an added bill: its phone switch, Edit with its saved values, and Remove asks first", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at(`[data-act="scope"][data-scope="biz:${SAMPLE_CO}"]`)).click();
      await page.locator(at(`[data-act="toggle-custom"][data-id="${OFFICE_RENT}"]`)).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "set_custom_phone", id: OFFICE_RENT, enabled: false });
      await page.locator(at(`[data-act="edit-custom"][data-id="${OFFICE_RENT}"]`)).click();
      await expect(page.locator(at("#fa-cf-h"))).toHaveText("Edit bill");
      await expect(page.locator(at("#fa-cf-name"))).toHaveValue("Office rent");
      await expect(page.locator(at("#fa-cf-amount"))).toHaveValue("1200.00");
      await expect(page.locator(at("#fa-cf-day"))).toHaveValue("1");
      await expect(page.locator(at("#fa-cf-for"))).toHaveValue(`biz:${SAMPLE_CO}`);
      await page.locator(at('[data-act="ask-remove-custom"]')).click();
      await page.locator(at('[data-act="keep-custom"]')).click();
      expect(writes.length).toBe(1);
      await page.locator(at('[data-act="ask-remove-custom"]')).click();
      await page.locator(at('[data-act="remove-custom"]')).click();
      await expect.poll(() => writes.length).toBe(2);
      expect(writes[1]).toEqual({ action: "remove_custom", id: OFFICE_RENT });
    });

    test("Edit an added alert sends update_custom with its id and the change", async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(at(`[data-act="edit-custom"][data-id="${SAVINGS_ALERT}"]`)).click();
      await expect(page.locator(at("#fa-cf-day"))).toHaveValue("14");
      await page.locator(at("#fa-cf-day")).selectOption("16");
      await page.locator(at('[data-act="save-custom"]')).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toEqual({ action: "update_custom", id: SAVINGS_ALERT, kind: "alert", name: "Move money to savings", amount_cents: null,
        cadence: "monthly", day_of_month: 16, scope: "personal", phone_alert: true });
    });
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
