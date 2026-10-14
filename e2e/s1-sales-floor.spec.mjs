// Slice 1 (money screens): the sales manager floor. One read fills the whole
// page; this feeds it a month with known numbers and checks that every panel
// shows exactly those numbers: the funnel columns, the roster, the offer stack
// with the unattributed block, and the deals going cold. Nothing leaves the
// browser: /api/** is answered by the page.
import { test, expect } from "@playwright/test";
import { freezeClock, openScreen, OWNER } from "./harness.mjs";

const FLOOR = {
  ok: true,
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" },
  hero: {
    cash_cents: 2500000, cash_display: "$25,000", target_cents: null,
    target_reason: "No monthly deposit target has been set for the sales team yet.",
    deposit_to_funded: 2 / 3, deposit_to_funded_n: { deposits: 3, funded: 2, rate: 2 / 3 },
  },
  funnel: {
    booked: 12, held: 8, show_rate: 8 / 12, deposits: 3, close_rate: 3 / 8,
    funded: 2, funded_of_deposits: 2 / 3, downsells: 1, downsell_cash_cents: 40000, downsell_cash_display: "$400",
  },
  today: { date: "2026-10-13", booked: 4, held: 3, deposits: 1, target_cents: null, target_reason: "No daily deposit target has been set for the sales team yet." },
  offer_stack: {
    available: true,
    items: [
      { code: "REPAIR_DFY", name: "Repair, done-for-you", units: 2, sold_cents: 200000, collected_cents: 150000 },
      { code: "FUNDING_DFY", name: "Funding, done-for-you", units: 1, sold_cents: 300000, collected_cents: 300000 },
    ],
    totals: { units: 3, sold_cents: 500000, collected_cents: 450000 },
  },
  offer_stack_unattributed: {
    available: true,
    reason: "These sales have no call outcome tied to a closer.",
    items: [{ code: "SOFT_PULL", name: "Soft pull", units: 4, sold_cents: 12800, collected_cents: 12800 }],
    totals: { units: 4, sold_cents: 12800, collected_cents: 12800 },
  },
  closers: [
    { staff_id: "s-chris", name: "Chris Stanbridge", on_shift: true, shift_elapsed_ms: 3900000, calls: 6, close_rate: 0.5, funded_rate: 0.5, cash_cents: 1800000, cash_display: "$18,000", action: "Call the two deposits that have not funded.", deposits: 2, offer_stack: null },
    { staff_id: "s-casey", name: "Casey Reed", on_shift: false, calls: 2, close_rate: 0.25, funded_rate: null, cash_cents: 700000, cash_display: "$7,000", action: null, deposits: 1, offer_stack: null },
  ],
  beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
  compliance: { available: false, reason: "Call recording flags are not scored yet.", items: [] },
  cold_deals: [
    { name: "Dana Whitfield", detail: "Deposit taken Oct 2, not funded", quiet_days: 11 },
    { name: "Ray Ortiz", detail: "Deposit taken Oct 4, not funded", quiet_days: 9 },
  ],
  recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet." },
  discipline: { unlogged_calls: 1, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "Needs scheduled shift times" }, followups_overdue: null, followups_reason: "n/a", avg_log_lag_days: null, avg_log_lag_reason: "n/a" },
};

async function open(page) {
  let reads = 0;
  await freezeClock(page, "2026-10-13T18:00:00Z");
  await openScreen(page, "/app/sales-floor.html", OWNER, {
    "/api/read/sales-floor": (route) => { reads += 1; return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(FLOOR) }); },
  });
  await expect(page.locator(".funnel .f").first()).toBeVisible();
  return { reads: () => reads };
}

const column = (page, label) => page.locator(".funnel .f").filter({ has: page.locator(".lb", { hasText: new RegExp(`^${label}$`) }) }).first();

test.describe("Sales floor: the funnel columns this month", () => {
  const cases = [
    ["Booked", "12", ""],
    ["Held", "8", "67% show"],
    ["Deposits", "3", "38% of held"],
    ["Funded", "2", "67% of deposits"],
    ["Downsells", "1", "$400"],
  ];
  for (const [label, value, note] of cases) {
    test(`${label} shows ${value}${note ? ` and "${note}"` : ""}`, async ({ page }) => {
      await open(page);
      const col = column(page, label);
      await expect(col.locator(".vl")).toHaveText(value);
      if (note) await expect(col.locator(".cv")).toHaveText(note);
    });
  }

  test("the sentence under the funnel names the deposits that have not funded", async ({ page }) => {
    await open(page);
    await expect(page.locator(".sec .say").first()).toContainText("1 deposits haven't funded");
  });
});

test.describe("Sales floor: the roster, the offer stack and the cold deals", () => {
  test("Your closers: one row per closer with calls, close rate, funded rate, cash and the Do this line", async ({ page }) => {
    await open(page);
    const rows = page.locator(".rost .rrow.pick");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Chris Stanbridge");
    await expect(rows.nth(0)).toContainText("On shift · 1h 5m");
    await expect(rows.nth(0).locator(".c2")).toHaveText("6");
    await expect(rows.nth(0).locator(".c5")).toHaveText("$18,000");
    await expect(rows.nth(0).locator(".act")).toHaveText("Call the two deposits that have not funded.");
    await expect(rows.nth(1)).toContainText("Casey Reed");
    await expect(rows.nth(1)).toContainText("Off shift");
    await expect(rows.nth(1).locator(".c4")).toHaveText("—");
    await expect(rows.nth(1).locator(".act")).toHaveText("Nothing assigned");
  });

  test("the offer stack lists every offer's units, sold and collected, with the total and the unattributed block on its own", async ({ page }) => {
    await open(page);
    const stack = page.locator("#fh-offer-stack");
    const first = stack.locator(".ostack").first().locator(".rrow");
    await expect(first.nth(0)).toContainText("Repair, done-for-you");
    await expect(first.nth(0)).toContainText("$2,000");
    await expect(first.nth(0)).toContainText("$1,500");
    await expect(first.nth(1)).toContainText("Funding, done-for-you");
    await expect(first.nth(2)).toContainText("All offers");
    await expect(first.nth(2)).toContainText("$5,000");
    await expect(first.nth(2)).toContainText("$4,500");
    await expect(stack).toContainText("Sold, but not credited to any closer");
    await expect(stack).toContainText("These sales have no call outcome tied to a closer.");
    await expect(stack.locator(".ostack").nth(1)).toContainText("Soft pull");
    await expect(stack.locator(".ostack").nth(1)).toContainText("$128");
  });

  test("Deals going cold names each quiet deposit and how many days quiet", async ({ page }) => {
    await open(page);
    const panel = page.locator(".panel", { has: page.getByRole("heading", { name: "Deals going cold" }) });
    await expect(panel.locator(".row")).toHaveCount(2);
    await expect(panel.locator(".row").nth(0)).toContainText("Dana Whitfield");
    await expect(panel.locator(".row").nth(0)).toContainText("11d");
    await expect(panel.locator(".row").nth(1)).toContainText("Ray Ortiz");
    await expect(panel.locator(".row").nth(1)).toContainText("9d");
  });

  test("the whole floor paints from ONE read: hero, funnel, roster, stack, cold deals and discipline", async ({ page }) => {
    const { reads } = await open(page);
    await expect(page.locator("header .hl .chip")).toContainText("1 closers on shift");
    await expect(page.locator(".hero .big").nth(0)).toHaveText("1");
    await expect(page.locator(".hero .sub").nth(0)).toContainText("Booked 4 · Held 3");
    await expect(page.locator(".hero .big").nth(1)).toHaveText("67%");
    await expect(page.locator(".hero .sub").nth(1)).toHaveText("2 of 3 deposits funded");
    await expect(page.locator(".rost .rrow.pick")).toHaveCount(2);
    await expect(page.locator("#fh-offer-stack .ostack").first()).toBeVisible();
    const discipline = page.locator(".panel", { has: page.getByRole("heading", { name: "Floor discipline" }) });
    await expect(discipline).toContainText("Calls not logged");
    await expect(discipline.locator(".chip.bad")).toHaveText("1");
    expect(reads()).toBe(1);
  });
});
