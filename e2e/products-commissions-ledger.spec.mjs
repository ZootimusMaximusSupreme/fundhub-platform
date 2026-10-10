// Products & Commissions — the pay buttons, pressed for real.
//
// Approve selected, Mark paid… and Change rate decide what staff are owed. The
// list said only the rule read was mocked; nothing pressed the buttons. This
// presses them and checks: only Accrued rows can be approved, only Approved
// rows can be marked paid, a payout id is required, Cancel sends nothing, and
// a rate change closes the old version with the date and reason typed.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const L1 = "1c000000-0000-4000-8000-000000000001";
const L2 = "1c000000-0000-4000-8000-000000000002";
const L3 = "1c000000-0000-4000-8000-000000000003";
const RULE = "77777777-7777-4777-8777-777777777771";

const LEDGER = {
  ok: true, count: 3, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: L1, status: "earned", staff_name: "Casey Reed", amount: "300.00", basis: "3000.00", split_percent: "10", product_name_at_earning: "Funding Bundle", earned_at: "2026-10-02T12:00:00Z" },
    { id: L2, status: "approved", staff_name: "Casey Reed", amount: "150.00", basis: "1500.00", split_percent: "10", product_name_at_earning: "Repair DFY", earned_at: "2026-09-28T12:00:00Z" },
    { id: L3, status: "paid", staff_name: "Casey Reed", amount: "90.00", basis: "900.00", split_percent: "10", product_name_at_earning: "Repair trial", earned_at: "2026-09-10T12:00:00Z", paid_at: "2026-09-30T12:00:00Z" }
  ]
};

const RULES = {
  ok: true, count: 1, rules: [{
    id: RULE, name: "Closer front-end", basis: "front_end", stacking: "base", product_id: null, product_name: null,
    role: "closer", staff_id: null, staff_name: null, calc_method: "percent", percent: "10.00", flat_amount: null,
    amount_basis: "deposit_collected", effective_from: "2026-08-20T00:00:00Z", effective_to: null, notes: "Owner-set", tiers: []
  }]
};

async function open(page, { writeAnswer } = {}) {
  const writes = [];
  const ruleWrites = [];
  let ledgerReads = 0;
  await openScreen(page, "/app/products-commissions.html", OWNER, {
    "/api/read/products": { ok: true, count: 0, items: [] },
    "/api/read/commissions": (route) => { ledgerReads += 1; return json(route, LEDGER); },
    "/api/commission-rules": async (route, { method }) => {
      if (method === "POST") {
        ruleWrites.push(route.request().postDataJSON());
        return json(route, { ok: true });
      }
      return json(route, RULES);
    },
    "/api/commissions": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      const out = writeAnswer ? writeAnswer(body) : { status: 200, body: { ok: true, updated: body.ledger_ids.length } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  return { writes, ruleWrites, ledgerReads: () => ledgerReads };
}

async function toLedger(page) {
  await page.locator("#ledgerLink").click();
  await expect(page.locator("#ledgerBody tr")).toHaveCount(3);
}

const pick = (page, id) => page.locator(`#ledgerBody .ledger-pick[data-id="${id}"]`);
const hint = (page) => page.locator("#ledgerActionHint");

test.describe("commission ledger: Approve selected and Mark paid", () => {
  test("a paid row has no box; select-all ticks only the rows that can still change", async ({ page }) => {
    await open(page);
    await toLedger(page);
    await expect(page.locator(`#ledgerBody tr[data-id="${L3}"] .ledger-pick`)).toHaveCount(0);
    await page.locator("#ledgerCheckAll").check();
    await expect(page.locator("#ledgerBody .ledger-pick:checked")).toHaveCount(2);
  });

  test("Approve selected with nothing ticked says so and sends nothing", async ({ page }) => {
    const { writes } = await open(page);
    await toLedger(page);
    await page.locator("#ledgerApprove").click();
    await expect(hint(page)).toHaveText("Select one or more Accrued rows first.");
    expect(writes).toEqual([]);
  });

  test("Approve selected sends only the Accrued rows, then re-reads the ledger", async ({ page }) => {
    const { writes, ledgerReads } = await open(page);
    await toLedger(page);
    const before = ledgerReads();
    await pick(page, L1).check();
    await pick(page, L2).check();
    await page.locator("#ledgerApprove").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "approve", ledger_ids: [L1] });
    await expect(hint(page)).toHaveText("Approved 1 row(s).");
    await expect.poll(() => ledgerReads()).toBeGreaterThan(before);
  });

  test("Mark paid sends only the Approved rows with the payout id typed", async ({ page }) => {
    const { writes } = await open(page);
    await toLedger(page);
    page.once("dialog", (d) => d.accept("  ACH-2026-1001 "));
    await page.locator("#ledgerCheckAll").check();
    await page.locator("#ledgerMarkPaid").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "mark_paid", ledger_ids: [L2], payout_ref: "ACH-2026-1001" });
    await expect(hint(page)).toHaveText("Marked paid 1 · ref ACH-2026-1001");
  });

  test("Mark paid: Cancel on the payout-id box sends nothing; an empty id is refused", async ({ page }) => {
    const { writes } = await open(page);
    await toLedger(page);
    await pick(page, L2).check();
    page.once("dialog", (d) => d.dismiss());
    await page.locator("#ledgerMarkPaid").click();
    await page.waitForTimeout(200);
    expect(writes).toEqual([]);
    page.once("dialog", (d) => d.accept("   "));
    await page.locator("#ledgerMarkPaid").click();
    await expect(hint(page)).toHaveText("Payout id is required to mark paid.");
    expect(writes).toEqual([]);
  });

  test("Mark paid with only Accrued rows ticked says so and sends nothing", async ({ page }) => {
    const { writes } = await open(page);
    await toLedger(page);
    await pick(page, L1).check();
    await page.locator("#ledgerMarkPaid").click();
    await expect(hint(page)).toHaveText("Select one or more Approved rows first.");
    expect(writes).toEqual([]);
  });

  test("a refused approve is said on the screen and is not counted as done", async ({ page }) => {
    const { writes } = await open(page, { writeAnswer: () => ({ status: 403, body: { ok: false, error: "forbidden" } }) });
    await toLedger(page);
    await pick(page, L1).check();
    await page.locator("#ledgerApprove").click();
    await expect.poll(() => writes.length).toBe(1);
    await expect(hint(page)).toContainText("not allowed");
    await expect(hint(page)).not.toContainText("Approved");
  });
});

test.describe("commission rules: Change rate", () => {
  async function openRule(page) {
    await page.getByRole("button", { name: "Commission rules", exact: true }).click();
    await page.locator(`.rule[data-r="${RULE}"] .rule-hd`).click();
    await page.locator(`[data-chg="${RULE}"]`).click();
    await expect(page.locator(`#el-${RULE}`)).toHaveClass(/on/);
  }

  test("Close v1 · open v2 sends the new rate, its start date and the reason for that rule version", async ({ page }) => {
    const { ruleWrites } = await open(page);
    await openRule(page);
    await page.locator(`#nr-${RULE}`).fill("12.5");
    await page.locator(`#nd-${RULE}`).fill("2026-11-01");
    await page.locator(`#nw-${RULE}`).fill("Owner raised closer pay");
    await page.locator(`[data-save="${RULE}"]`).click();
    await expect.poll(() => ruleWrites.length).toBe(1);
    expect(ruleWrites[0]).toEqual({ rule_id: RULE, effective_from: "2026-11-01", rate: 12.5, reason: "Owner raised closer pay" });
  });

  test("a start date that is not after the current version is refused before anything is sent", async ({ page }) => {
    const { ruleWrites } = await open(page);
    await openRule(page);
    await page.locator(`#nr-${RULE}`).fill("12");
    await page.locator(`#nd-${RULE}`).fill("2026-08-20");
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.locator(`[data-save="${RULE}"]`).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain("must start after the current version began (2026-08-20)");
    expect(ruleWrites).toEqual([]);
  });

  test("a blank or negative rate is refused; Cancel closes the line and sends nothing", async ({ page }) => {
    const { ruleWrites } = await open(page);
    await openRule(page);
    await page.locator(`#nr-${RULE}`).fill("-3");
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.locator(`[data-save="${RULE}"]`).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe("Enter a valid rate.");
    await page.locator(`[data-cancel="${RULE}"]`).click();
    await expect(page.locator(`#el-${RULE}`)).not.toHaveClass(/on/);
    expect(ruleWrites).toEqual([]);
  });
});
