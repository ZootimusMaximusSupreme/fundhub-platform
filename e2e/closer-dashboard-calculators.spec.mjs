// Closer dashboard — the deal calculator inputs, typed into for real.
//
// The draw, the guardrail %, the slider, and the deposit / fee / debts / minimum
// boxes decide what a closer tells a client they will net and owe each month.
// The maths are tested in Node; the list said no spec typed into the boxes.
// This types into each one and checks the question that goes to the server
// (the draw and the threshold as a fraction; the four deal-math numbers plus
// the drawn amount from the file), and that the server's answer is what shows.

import { test, expect } from "@playwright/test";
import { openScreen, json, CLOSER, CLIENT_ID } from "./harness.mjs";

function tradelines(drawn) {
  return {
    ok: true, client_id: CLIENT_ID,
    data: [{ id: "t1", lender: "Chase Ink", account_type: "revolving", credit_limit: 20000, current_balance: 5000 }],
    funding: {
      totalAvailableCredit: 15000,
      allocation: {
        requestedAmount: drawn, totalDrawn: drawn, shortfall: 0,
        draws: [{ lender: "Chase Ink", apr: 18.99, creditLimit: 20000, currentBalance: 5000, availableHeadroom: 15000, draw: drawn }]
      },
      guardrail: { aggregateUtilization: 0.75, threshold: 0.3, hardStop: true, message: null },
      payMethodComparison: { horizons: [] }
    }
  };
}

async function open(page, query = `?client_id=${CLIENT_ID}`) {
  const trade = [];
  const math = [];
  await openScreen(page, `/app/closer-dashboard.html${query}`, CLOSER, {
    "/api/read/tradelines": (route, { url }) => {
      const u = new URL(url);
      trade.push(Object.fromEntries(u.searchParams));
      return json(route, tradelines(Number(u.searchParams.get("requested_amount") || 10000) || 10000));
    },
    "/api/read/deal-math": (route, { url }) => {
      const p = Object.fromEntries(new URL(url).searchParams);
      math.push(p);
      const drawn = Number(p.drawn), fees = Number(p.deposit) + drawn * Number(p.fee) / 100;
      return json(route, { ok: true, drawn, fees, debts: Number(p.debts), net: drawn - fees - Number(p.debts), monthly: drawn * Number(p.min) / 100 });
    },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/closer-call": { ok: true },
    "/api/read/agent-context": { ok: true, context: {} }
  });
  // The calculators live in the folded "Payment Calculator" card.
  await page.locator("#paymentCalculator > summary").click();
  return { trade, math };
}

test.describe("closer dashboard: deal calculators", () => {
  test("typing a draw re-asks the calculator with that draw and the threshold as a fraction", async ({ page }) => {
    const { trade } = await open(page);
    await expect(page.locator("#oCredit")).toHaveText("$15,000");
    const before = trade.length;
    await page.locator("#iDraw").fill("12500");
    await expect.poll(() => trade.length).toBeGreaterThan(before);
    const last = trade[trade.length - 1];
    expect(last.client_id).toBe(CLIENT_ID);
    expect(last.requested_amount).toBe("12500");
    expect(last.utilization_threshold).toBe("0.3");
    await expect(page.locator("#guardTitle")).toHaveText("⛔ Pre-Approval Guardrail — Hard Stop");
  });

  test("changing the guardrail % sends the new threshold", async ({ page }) => {
    const { trade } = await open(page);
    await expect(page.locator("#oCredit")).toHaveText("$15,000");
    await page.locator("#iGuard").fill("25");
    await expect.poll(() => trade[trade.length - 1].utilization_threshold).toBe("0.25");
  });

  test("the slider moves the draw box with it, and asks again", async ({ page }) => {
    const { trade } = await open(page);
    await expect(page.locator("#oCredit")).toHaveText("$15,000");
    const range = page.locator("#iDrawRange");
    await range.evaluate((r) => { r.value = "4000"; r.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(page.locator("#iDraw")).toHaveValue("4000");
    await expect.poll(() => trade[trade.length - 1].requested_amount).toBe("4000");
  });

  test("deposit, fee, debts and minimum go to the deal-math door with the drawn amount, and its answer is shown", async ({ page }) => {
    const { math } = await open(page);
    await expect(page.locator("#oCredit")).toHaveText("$15,000");
    // Every box gets a number the page does not already hold (the boxes open
    // on deposit 0, fee 10, debts 0, minimum 3), and all four differ, so a box
    // the page ignores or crosses with another one cannot hide.
    await page.locator("#iDeposit").fill("3000");
    await page.locator("#iFee").fill("12");
    await page.locator("#iDebts").fill("1000");
    await page.locator("#iMin").fill("4");
    await expect.poll(() => {
      const p = math[math.length - 1];
      return p && `${p.deposit}|${p.fee}|${p.debts}|${p.min}|${p.drawn}`;
    }).toBe("3000|12|1000|4|10000");
    // net = drawn - (deposit + drawn x fee%) - debts; monthly = drawn x min%
    await expect(page.locator("#oNet")).toHaveText("$4,800");
    await expect(page.locator("#oMonthly")).toHaveText("$400 / mo");
  });

  test("with no client the calculators are not shown at all", async ({ page }) => {
    const { trade } = await open(page, "");
    await expect(page.locator("#calcGate")).toBeVisible();
    await expect(page.locator("#calcGrid")).toBeHidden();
    expect(trade).toEqual([]);
  });
});
