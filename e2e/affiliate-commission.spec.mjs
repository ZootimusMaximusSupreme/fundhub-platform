// The Commission column on the affiliate screen, in a real browser.
//
// NO BACKEND — page.route() answers /api/**, same as every other spec here.
//
// WHY A BROWSER TEST AS WELL AS src/http/affiliate-screen.test.mjs. That file
// drives the commission helpers directly and proves they are right. It cannot
// prove the table is wired to them: an id that does not match, or a cell built
// from the wrong variable, passes every one of those assertions and still puts
// the wrong number on the screen. This loads the page, hands it rows, and reads
// what a person would actually see.
//
// The rows are pushed into the page's own LEADS array because nothing fetches
// that array yet — no read endpoint fills this table. When one is built, this
// spec should mock it instead.

import { test, expect } from "@playwright/test";
import { openScreen } from "./harness.mjs";

/* Statuses are the four affiliate_referrals.status can hold (Referred,
   Converted, Paid, Void — 033_affiliates.sql). The screen's filter offers only
   those since 2026-09-05 (c743eead3); this file still used the six invented
   ones (Funded, Deposit paid, Assessment paid…), so the filter test waited 30
   seconds for a "Funded" option that no longer exists. */
const ROWS = [
  // A funding deposit of $3,000. The ledger's 20% Tier 1 rule makes this
  // $600.00. The deleted browser-side 12% would have shown $360.00.
  { d: "2026-08-24", biz: "Northwind Freight", st: "Paid", prod: "Consulting Services Deposit",
    basis: 3000, pay: "Paid", commission_due: "600.00" },
  // Converted with no rate in force. commission_due is NULL and must stay
  // unknown on screen.
  { d: "2026-08-25", biz: "Cedar Lane Bakery", st: "Converted", prod: "Credit Optimization Bundle",
    basis: 2000, pay: "Accrued", commission_due: null },
  { d: "2026-08-26", biz: "Halstead Tools", st: "Converted", prod: "Business Financial Assessment",
    basis: 32, pay: "Accrued", commission_due: "6.40" }
];

async function loadRows(page, rows) {
  await page.evaluate((r) => {
    // LEADS is a top-level `var` in the page's own script, so it is a global.
    window.LEADS = r;
    window.renderLeads();
  }, rows);
}

test("the Commission column shows the ledger's figure, and a dash when there is none", async ({ page }) => {
  await openScreen(page, "/app/affiliate.html");
  await loadRows(page, ROWS);

  const cells = page.locator("#leadBody tr td:nth-child(6)");
  await expect(cells).toHaveCount(3);
  await expect(cells.nth(0)).toHaveText("$600.00");
  await expect(cells.nth(2)).toHaveText("$6.40");

  // The whole point: a referral with no rate set reads as unknown, never $0.
  await expect(cells.nth(1)).toHaveText("—");
  await expect(cells.nth(1)).not.toHaveText("$0.00");
});

test("12% of the basis appears nowhere on the screen", async ({ page }) => {
  await openScreen(page, "/app/affiliate.html");
  await loadRows(page, ROWS);
  const body = await page.locator("#leadBody").innerText();
  expect(body).toContain("$600.00");
  expect(body).not.toContain("$360.00"); // 12% of 3,000 — the bug
  expect(body).not.toContain("$3.84");   // 12% of 32 — the bug
});

test("the total adds the known rows and says what it left out", async ({ page }) => {
  await openScreen(page, "/app/affiliate.html");
  await loadRows(page, ROWS);
  await expect(page.locator("#leadTotal")).toHaveText("$606.40");
  await expect(page.locator("#leadTotalLabel"))
    .toHaveText("Total shown · 1 row with no rate set is not counted");
});

test("with no rows at all the total is a dash, not $0", async ({ page }) => {
  await openScreen(page, "/app/affiliate.html");
  await expect(page.locator("#leadBody")).toContainText("No referrals on file");
  await expect(page.locator("#leadTotal")).toHaveText("—");
});

test("filtering still leaves every commission read from its own row", async ({ page }) => {
  await openScreen(page, "/app/affiliate.html");
  await loadRows(page, ROWS);
  await page.locator("#stFilter").selectOption("Paid");
  const cells = page.locator("#leadBody tr td:nth-child(6)");
  await expect(cells).toHaveCount(1);
  await expect(cells.nth(0)).toHaveText("$600.00");
  await expect(page.locator("#leadTotal")).toHaveText("$600.00");
  await expect(page.locator("#leadTotalLabel")).toHaveText("Total shown");
});
