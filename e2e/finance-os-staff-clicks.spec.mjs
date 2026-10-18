// Finance OS (staff desk) — the client picker and the paydown simulator, pressed.
//
// Split this cash tells a client how to spend cash across their cards and what
// that does to their pre-approval. It was "ping" only on the list, and no
// browser test pressed Find, Open this client, Close this client or Split.
// This presses them: the exact simulator request, a bad amount sending nothing,
// the paywall said in words, and Close forgetting the client so the next click
// does not reopen them.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const C1 = "c1000000-0000-4000-8000-000000000001";
const C2 = "c2000000-0000-4000-8000-000000000002";

const CLIENTS = { ok: true, clients: [
  { id: C1, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" },
  { id: C2, first_name: "Riley", last_name: "Stone", email: "riley@example.com" }
] };

const SIM = {
  ok: true, entitled: true, subscriptionId: "s1", hasPull: true,
  preapprovalBefore: 40000, preapprovalProjected: 61000, preapprovalAfterFull: 90000,
  cashOnHand: 5000.5, cashApplied: 5000.5, cashUnallocated: 0, totalPaydownNeeded: 12000,
  allocations: [{ account: "Chase Ink", payDollars: 3000.5, balanceBefore: 6000, targetBalance: 1500 },
    { account: "Amex Blue", payDollars: 2000, balanceBefore: 4000, targetBalance: 1000 }],
  pulledAt: "2026-10-01T12:00:00Z"
};

async function open(page, query, { simAnswer } = {}) {
  const sims = [];
  await openScreen(page, `/app/finance-os.html${query}`, OWNER, {
    "/api/dashboard/clients": CLIENTS,
    "/api/finance/paydown-simulator": async (route) => {
      sims.push(route.request().postDataJSON());
      const out = simAnswer ? simAnswer() : { status: 200, body: SIM };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  return { sims };
}

test.describe("finance OS: the client picker", () => {
  test("Find narrows the list; Open this client opens that client by id", async ({ page }) => {
    await open(page, `?client_id=${C1}`);
    await page.locator("#fosClientTools summary").click();
    await expect(page.locator("#fosClient option")).toHaveCount(3);
    await page.locator("#fosFind").fill("riley");
    await expect(page.locator("#fosPickMsg")).toHaveText("1 of 2 clients match");
    await page.locator("#fosClient").selectOption(C2);
    await expect(page.locator("#fosOpen")).toHaveText("Open this client");
    await page.locator("#fosOpen").click();
    await expect(page).toHaveURL(new RegExp(`finance-os\\.html\\?client_id=${C2}$`));
  });

  test("the open client reads Already open, and the button is off", async ({ page }) => {
    await open(page, `?client_id=${C1}`);
    await page.locator("#fosClientTools summary").click();
    await expect(page.locator("#fosClient")).toHaveValue(C1);
    await expect(page.locator("#fosOpen")).toHaveText("Already open");
    await expect(page.locator("#fosOpen")).toBeDisabled();
  });

  test("Close this client forgets the client and reloads with none", async ({ page }) => {
    await open(page, `?client_id=${C1}`);
    await page.locator("#fosClientTools summary").click();
    await page.evaluate((id) => localStorage.setItem("fh_client", id), C1);
    await page.locator("#fosClear").click();
    await expect(page).toHaveURL(/finance-os\.html$/);
    expect(await page.evaluate(() => localStorage.getItem("fh_client"))).toBe(null);
  });
});

test.describe("finance OS: Split this cash", () => {
  test("a typed amount is sent for this client, and the before and after come back on the screen", async ({ page }) => {
    const { sims } = await open(page, `?client_id=${C1}`);
    await page.locator("#fosSimCash").fill("$5,000.50");
    await page.locator("#fosSimGo").click();
    await expect.poll(() => sims.length).toBe(1);
    expect(sims[0]).toEqual({ client_id: C1, cash_on_hand: 5000.5 });
    await expect(page.locator("#fosSimOut")).toContainText("Pre-approval today");
    await expect(page.locator("#fosSimOut")).toContainText("$40,000");
    await expect(page.locator("#fosSimOut")).toContainText("$61,000");
    await expect(page.locator("#fosSimOut")).toContainText("Chase Ink");
    await expect(page.locator("#fosSimOut")).toContainText("This is an estimate, not a lender");
  });

  test("a bad amount is refused on the page and nothing is sent", async ({ page }) => {
    const { sims } = await open(page, `?client_id=${C1}`);
    for (const bad of ["abc", "-5", ""]) {
      await page.locator("#fosSimCash").fill(bad);
      await page.locator("#fosSimGo").click();
      await expect(page.locator("#fosSimMsg")).toHaveText("Type the cash as a plain number, like 5000 or 5,000.50.");
    }
    expect(sims).toEqual([]);
  });

  test("no Finance OS plan: the screen says so in words", async ({ page }) => {
    await open(page, `?client_id=${C1}`, {
      simAnswer: () => ({ status: 403, body: { ok: false, error: "not_entitled", entitled: false, reason: "no active finance-os subscription" } })
    });
    await page.locator("#fosSimCash").fill("2500");
    await page.locator("#fosSimGo").click();
    await expect(page.locator("#fosSimMsg")).toHaveText("This client does not have an active Finance OS subscription, so the simulator is not available for them.");
    await expect(page.locator("#fosSimGo")).toHaveText("Split this cash");
  });

  test("no credit report yet: says to pull first, with no made-up split", async ({ page }) => {
    await open(page, `?client_id=${C1}`, { simAnswer: () => ({ status: 200, body: { ok: true, entitled: true, hasPull: false } }) });
    await page.locator("#fosSimCash").fill("2500");
    await page.locator("#fosSimGo").click();
    await expect(page.locator("#fosSimOut")).toContainText("There is no credit report on file for this client yet");
    await expect(page.locator("#fosSimOut")).not.toContainText("$");
  });
});
