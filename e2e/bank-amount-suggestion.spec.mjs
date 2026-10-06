// Playwright — the bank's own figure, offered beside the Approved $ box.
//
// WHAT WAS BROKEN. The bank states the approved amount in the email it sends
// the client. That email reaches Fundhub, and the classifier reads a dollar
// figure out of it — then throws the figure away and keeps only "this is an
// approval". So a funding advisor read the same email and retyped the same
// number by hand, and when they forgot, the approval carried no amount at all.
// Fundhub bills a percent of approvals that HAVE an amount, so a forgotten box
// is a bill that never goes out (docs/finance/CLOSEOUT-FEE-BASIS.md).
//
// WHAT THESE PROVE, in a real browser, clicking real buttons:
//   1. the figure from the bank's email is offered beside the box
//   2. one click puts it IN the box — and saves nothing on its own
//   3. several figures are ALL offered, and the screen says outright that it
//      cannot tell which one is the approval
//   4. no figure means no suggestion, and never a zero
//   5. a denial offers nothing
//   6. each row's button fills that row's own box, not the last row's
//
// (2) and (3) are the ones that matter. A misread email that quietly booked
// the wrong number would be worse than a blank box, because a blank box is
// visibly waiting and a wrong number looks finished.
//
// NO BACKEND — /api/** is answered by page.route() via harness.mjs.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, CLIENT_ID } from "./harness.mjs";

const LENDER_A = "bbbbbbbb-1111-4111-8111-111111111111";
const LENDER_B = "cccccccc-1111-4111-8111-111111111111";

const TWO_LENDERS = {
  ok: true,
  match_count: 2,
  summary: { lender_count: 2 },
  matches: [
    { id: LENDER_A, name: "Mesa Community Bank", bureaus_pulled: "EX", application_url: "https://bank.example/a" },
    { id: LENDER_B, name: "Sonoran Credit Union", bureaus_pulled: "TU", application_url: "https://bank.example/b" }
  ]
};

/* One bank_inbox row exactly as GET /api/read/bank-inbox returns it. */
function inbox(rows) {
  return {
    "/api/read/bank-inbox": {
      ok: true, count: rows.length, limit: 50, offset: 0, hasMore: false, items: rows
    }
  };
}

function bankRow(overrides) {
  return {
    id: "inbox-1",
    client_id: CLIENT_ID,
    classification: "APPROVED",
    subject: "Your application decision",
    body_preview: "Congratulations! Your credit limit is $5,000.",
    amount_candidates: ["5000.00"],
    amount_candidates_found: 1,
    received_at: "2026-08-29T12:00:00Z",
    ...overrides
  };
}

/* Remembers what was written, so a test can assert that clicking a suggestion
   wrote NOTHING. */
function applicationsBackend(writes) {
  return {
    "/api/applications": async (route, ctx) => {
      const method = ctx && ctx.method ? ctx.method : route.request().method();
      if (method === "GET") return json(route, { ok: true, decisions: [], applications: [] });
      if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
      writes.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, { ok: true, application: { id: "app-1" } });
    }
  };
}

test.describe("client control panel — the bank email's amount is offered, never assumed", () => {

  async function open(page, rows, writes = []) {
    return openScreen(page, `/app/client-control-panel.html?client_id=${CLIENT_ID}`, OWNER, {
      "/api/read/lender-matches": TWO_LENDERS,
      ...inbox(rows),
      ...applicationsBackend(writes)
    });
  }

  test("the figure the bank stated is offered beside the Approved $ box", async ({ page }) => {
    await open(page, [bankRow()]);
    const slot = page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`);
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await expect(slot.getByRole("button", { name: /Use \$5,000 from the bank email/i })).toBeVisible();
    await expect(page.locator("#fh-bank-amount-hint"))
      .toContainText(/says \$5,000/i, { timeout: 10_000 });
  });

  test("ONE CLICK PUTS IT IN THE BOX — and saves nothing", async ({ page }) => {
    const writes = [];
    await open(page, [bankRow()], writes);
    const slot = page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`);
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await slot.getByRole("button", { name: /\$5,000/ }).click();

    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`)).toHaveValue("5000.00");
    // THE WHOLE POINT: accepting a suggestion is not a save. A misread email
    // that quietly booked a number would be worse than an empty box.
    expect(writes.length).toBe(0);
  });

  /* "Bank yes" is the "Approved" button since the owner named the three answers
     Approved / Declined / Pending on 2026-09-06 (648af7b02). It still writes
     status "Approved". */
  test("the accepted figure is what Approved then sends", async ({ page }) => {
    const writes = [];
    await open(page, [bankRow()], writes);
    const slot = page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`);
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await slot.getByRole("button", { name: /\$5,000/ }).click();
    await page.getByRole("button", { name: "Approved", exact: true }).first().click();
    await expect.poll(() => writes.length, { timeout: 10_000 }).toBe(1);
    expect(writes[0].status).toBe("Approved");
    expect(writes[0].approved_amount).toBe("5000.00");
  });

  test("SEVERAL FIGURES: all are offered and the screen says it cannot tell", async ({ page }) => {
    await open(page, [bankRow({
      body_preview: "Credit limit $7,500. Annual fee $95. Minimum payment $35.",
      amount_candidates: ["7500.00", "95.00", "35.00"],
      amount_candidates_found: 3
    })]);
    const slot = page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`);
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await expect(slot.getByRole("button")).toHaveCount(3);
    await expect(slot.getByRole("button", { name: /\$7,500/ })).toBeVisible();
    await expect(slot.getByRole("button", { name: /\$95\b/ })).toBeVisible();
    await expect(slot.getByRole("button", { name: /\$35\b/ })).toBeVisible();
    await expect(page.locator("#fh-bank-amount-hint"))
      .toContainText(/lists 3 dollar amounts and we cannot tell which one is the approval/i);
  });

  test("more figures than we carry: the TRUE count is what the screen reports", async ({ page }) => {
    await open(page, [bankRow({
      amount_candidates: ["1.00", "2.00", "3.00", "4.00", "5.00", "6.00"],
      amount_candidates_found: 9
    })]);
    await expect(page.locator("#fh-bank-amount-hint"))
      .toContainText(/lists 9 dollar amounts/i, { timeout: 10_000 });
  });

  test("NO FIGURE IN THE EMAIL: nothing is offered, and no zero appears", async ({ page }) => {
    await open(page, [bankRow({
      body_preview: "Congratulations, your application was approved.",
      amount_candidates: [],
      amount_candidates_found: 0
    })]);
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#fh-bank-amount-hint")).toBeHidden();
    await expect(page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`)).toBeHidden();
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`)).toHaveValue("");
  });

  test("A DENIAL OFFERS NOTHING", async ({ page }) => {
    await open(page, [bankRow({
      classification: "DENIED",
      subject: "Your application outcome",
      body_preview: "Unfortunately, you were not approved for the requested $10,000.",
      amount_candidates: null,
      amount_candidates_found: null
    })]);
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#fh-bank-amount-hint")).toBeHidden();
    await expect(page.locator(`[data-amount-suggest-lender-id="${LENDER_A}"]`)).toBeHidden();
  });

  test("an empty bank inbox changes nothing about the screen", async ({ page }) => {
    await open(page, []);
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`))
      .toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#fh-bank-amount-hint")).toBeHidden();
  });

  test("EACH ROW'S BUTTON FILLS ITS OWN BOX", async ({ page }) => {
    // The screen is written in `var`. A handler closing over a loop variable
    // would make every button on every row fill the LAST lender's box.
    await open(page, [bankRow()]);
    const slotB = page.locator(`[data-amount-suggest-lender-id="${LENDER_B}"]`);
    await expect(slotB).toBeVisible({ timeout: 10_000 });
    await slotB.getByRole("button", { name: /\$5,000/ }).click();
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_B}"]`)).toHaveValue("5000.00");
    await expect(page.locator(`input[data-amount-lender-id="${LENDER_A}"]`)).toHaveValue("");
  });
});
