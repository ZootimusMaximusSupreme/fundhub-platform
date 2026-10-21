// Affiliate payouts (495): the finance staff tab on products-commissions.html
// and the affiliate's payout-bank block on affiliate.html. Every request is
// faked; nothing leaves the browser and no Plaid window opens. Each test
// presses one control and checks the exact request it sends.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { CLOSER, freezeClock, json, openScreen, OWNER } from "./harness.mjs";

const EVIDENCE = "ops/workflows/build-evidence/affiliate-payout-plaid-2026-10-20";

const PENDING = "a1000000-0000-4000-8000-000000000001";
const HELD = "a1000000-0000-4000-8000-000000000002";
const PAID = "a1000000-0000-4000-8000-000000000003";
const WAITING = "a1000000-0000-4000-8000-000000000004";

const row = (over) => ({
  affiliate: { id: "af-1", name: "Rail Partner", code: "AFF-000101", test: false },
  periodStart: "2026-10-19T15:00:00Z", periodEnd: "2026-10-19T15:15:00Z", dueOn: "2026-10-20",
  overdue: false, amount: 120, currency: "USD", status: "pending", holdReason: null, voidReason: null,
  method: null, reference: null, approvedAt: null, approvedBy: null, paidAt: null, plaid: null,
  gates: { license: true, tax: true },
  bank: { environment: "sandbox", testData: true, institution: "First Platypus (Plaid sandbox — test data)", mask: "4471", subtype: "checking" },
  lines: 1,
  ...over
});

const VIEW = {
  ok: true,
  rail: { enabled: true, environment: "sandbox", live: false, reason: null, perTransferCents: 500000 },
  counts: { pending: 2, held: 1, processing: 0, overdue: 1 },
  payouts: [
    row({ id: PENDING, affiliate: { id: "af-1", name: "Test Partner", code: "AFF-1", test: true } }),
    row({ id: WAITING, overdue: true, dueOn: "2026-10-19", plaid: { environment: null, transferId: null, status: null, failure: "Plaid is on test money only. A real affiliate cannot be paid with test money.", syncedAt: null } }),
    row({ id: HELD, status: "held", holdReason: "no_bank_linked", bank: null, affiliate: { id: "af-2", name: "New Partner", code: "AFF-2", test: false } }),
    row({ id: PAID, status: "paid", method: "plaid_transfer", reference: "tr-5551", paidAt: "2026-10-18T12:00:00Z" })
  ]
};

async function openStaff(page, session = OWNER, view = VIEW) {
  const writes = [];
  await freezeClock(page, "2026-10-20T15:00:00Z");
  await openScreen(page, "/app/products-commissions.html", session, {
    "/api/read/affiliate-payouts": view,
    "/api/affiliates/payouts": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return json(route, { ok: true, action: body.action });
    }
  });
  return { writes };
}

async function mark(page, selector, caption, n) {
  await page.evaluate(({ selector, caption, n }) => {
    const el = document.querySelector(selector);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    Object.assign(box.style, { position: "absolute", left: `${r.left + scrollX - 4}px`, top: `${r.top + scrollY - 4}px`,
      width: `${r.width + 8}px`, height: `${r.height + 8}px`, border: "3px solid #d11", zIndex: 99999, pointerEvents: "none" });
    const tag = document.createElement("div");
    tag.textContent = String(n);
    Object.assign(tag.style, { position: "absolute", left: "-3px", top: "-26px", background: "#d11", color: "#fff", font: "bold 14px sans-serif", padding: "2px 7px" });
    box.appendChild(tag);
    document.body.appendChild(box);
    let legend = document.getElementById("review-legend");
    if (!legend) {
      legend = document.createElement("div");
      legend.id = "review-legend";
      Object.assign(legend.style, { position: "fixed", right: "12px", bottom: "12px", maxWidth: "420px", background: "#fff", border: "2px solid #d11", padding: "10px", font: "13px sans-serif", zIndex: 100000 });
      document.body.appendChild(legend);
    }
    const line = document.createElement("div");
    line.textContent = `${n}. ${caption}`;
    legend.appendChild(line);
  }, { selector, caption, n });
}

test.describe("Affiliate payouts tab (finance staff)", () => {
  test("shows the runs, the Plaid state, and Send now only where it can work", async ({ page }) => {
    await openStaff(page);
    const tab = page.locator("#affPayTab");
    await expect(tab).toBeVisible();
    await tab.click();
    await expect(page.locator("#apSummary")).toHaveText("2 ready · 1 held · 0 sending");
    await expect(page.locator("#apRail")).toContainText("only test affiliates are paid by themselves");
    const pending = page.locator(`tr[data-id="${PENDING}"]`);
    await expect(pending).toContainText("Ready to pay");
    await expect(pending.getByRole("button", { name: "Send now" })).toBeVisible();
    const held = page.locator(`tr[data-id="${HELD}"]`);
    await expect(held).toContainText("Held — affiliate has not linked a bank");
    await expect(held.getByRole("button", { name: "Send now" })).toHaveCount(0);
    await expect(held.getByRole("button", { name: "Release" })).toBeVisible();
    const waiting = page.locator(`tr[data-id="${WAITING}"]`);
    await expect(waiting).toContainText("past due");
    await expect(waiting).toContainText("Waiting: Plaid is on test money only");
    const paid = page.locator(`tr[data-id="${PAID}"]`);
    await expect(paid).toContainText("plaid_transfer · tr-5551");
    await expect(paid.locator("button")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    fs.mkdirSync(EVIDENCE, { recursive: true });
    await mark(page, "#apRail", "Plaid state in plain words: test money pays test affiliates only", 1);
    await mark(page, `tr[data-id="${WAITING}"]`, "Real affiliate waits, past due, with the reason (pulse goes red)", 2);
    await mark(page, `tr[data-id="${HELD}"]`, "Held on the affiliate: no bank linked yet; goes out by itself once linked", 3);
    await mark(page, `tr[data-id="${PAID}"]`, "Paid, with the Plaid transfer id as proof", 4);
    await page.screenshot({ path: `${EVIDENCE}/staff-payouts-tab-MARKED.png`, fullPage: true });
  });

  test("Mark paid sends the method, the reference and the date", async ({ page }) => {
    const { writes } = await openStaff(page);
    await page.locator("#affPayTab").click();
    await page.locator(`tr[data-id="${WAITING}"]`).getByRole("button", { name: "Mark paid…" }).click();
    await expect(page.locator("#apPaidDialog")).toBeVisible();
    await page.locator("#apPaidSave").click();
    await expect(page.locator("#apPaidErr")).toContainText("bank trace");
    expect(writes).toEqual([]);
    await page.locator("#apMethod").selectOption("check");
    await page.locator("#apRef").fill("CHK-1042");
    await page.locator("#apDate").fill("2026-10-20");
    await page.locator("#apPaidSave").click();
    await expect(page.locator("#apMsg")).toHaveText("Recorded as paid.");
    expect(writes).toEqual([{ action: "mark_paid", payout_id: WAITING, method: "check", reference: "CHK-1042", paid_at: "2026-10-20" }]);
  });

  test("Send now asks first; Cancel needs a reason; Release sends the run id", async ({ page }) => {
    const { writes } = await openStaff(page);
    await page.locator("#affPayTab").click();
    page.once("dialog", (d) => d.dismiss());
    await page.locator(`tr[data-id="${PENDING}"]`).getByRole("button", { name: "Send now" }).click();
    expect(writes).toEqual([]);
    page.once("dialog", (d) => d.accept());
    await page.locator(`tr[data-id="${PENDING}"]`).getByRole("button", { name: "Send now" }).click();
    await expect(page.locator("#apMsg")).toContainText("Sent to Plaid");
    page.once("dialog", (d) => d.accept("   "));
    await page.locator(`tr[data-id="${HELD}"]`).getByRole("button", { name: "Cancel…" }).click();
    await expect(page.locator("#apMsg")).toHaveText("Cancelling needs a reason.");
    await page.locator(`tr[data-id="${HELD}"]`).getByRole("button", { name: "Release" }).click();
    await expect(page.locator("#apMsg")).toContainText("Released");
    expect(writes).toEqual([{ action: "send", payout_id: PENDING }, { action: "release", payout_id: HELD }]);
  });

  test("the tab stays hidden for a closer", async ({ page }) => {
    await openStaff(page, CLOSER);
    await page.waitForLoadState("networkidle");
    // A closer is either sent off this page or sees it without the tab.
    await expect(page.locator("#affPayTab")).toBeHidden();
  });

  test("empty and failed reads say so", async ({ page }) => {
    await openStaff(page, OWNER, { ...VIEW, payouts: [], counts: { pending: 0, held: 0, processing: 0, overdue: 0 } });
    await page.locator("#affPayTab").click();
    await expect(page.locator("#apBody")).toContainText("No affiliate payouts yet");
    await page.route("**/api/read/affiliate-payouts**", (route) => json(route, { ok: false, error: "db_unavailable" }, 503));
    await page.locator("#apFilter").selectOption("held");
    await expect(page.locator("#apBody")).toContainText("db_unavailable");
  });
});

const client = { ok: true, principal: "client", staff: { id: "safe-client", role: "client", kind: "client", name: "Client Preview", affiliate_id: "safe-affiliate", org_id: "org-1" } };
const portal = (over = {}) => ({
  ok: true, enrolled: true,
  affiliate: { id: "safe-affiliate", name: "Client Preview", code: "SAFE-PREVIEW", offerLinks: [] },
  rates: { direct: { rules: [{}], percent: 20 } },
  gates: { license: { signed: true }, tax: { onFile: true } },
  referrals: [],
  payouts: [{ id: "p1", periodStart: "2026-10-19T15:00:00Z", periodEnd: "2026-10-19T15:15:00Z", amount: 120, currency: "USD", status: "held", holdReason: "no_bank_linked", method: null, paidAt: null, dueOn: "2026-10-20", reference: null, lineCount: 1 }],
  payoutBank: null,
  ...over
});

test.describe("Affiliate payout bank (affiliate.html)", () => {
  test("no bank: says so and Link your bank asks the server for a Plaid link", async ({ page }) => {
    const posts = [];
    await openScreen(page, "/app/affiliate.html", client, {
      "/api/read/affiliate-portal": portal(),
      "/api/affiliates/payout-account": async (route) => {
        posts.push(route.request().postDataJSON());
        return json(route, { ok: false, error: "not_configured", message: "Bank linking is not set up yet." }, 503);
      }
    });
    await page.locator("#switch-payouts").click();
    await expect(page.locator("#payBankText")).toContainText("paid as soon as your client's payment clears");
    await expect(page.locator("#payBody")).toContainText("link your bank below");
    await expect(page.locator("#payBody")).toContainText("Due");
    fs.mkdirSync(EVIDENCE, { recursive: true });
    await mark(page, "#payBankBox", "New: the affiliate links their own bank with Plaid", 1);
    await mark(page, "#payBody tr", "Held until the bank is linked; shows its due day", 2);
    await page.screenshot({ path: `${EVIDENCE}/affiliate-payout-bank-MARKED.png`, fullPage: true });
    await page.locator("#payBankLink").click();
    await expect(page.locator("#payBankMsg")).toHaveText("Bank linking is not set up yet.");
    await expect(page.locator("#payBankLink")).toBeEnabled();
    expect(posts).toEqual([{ action: "link_token" }]);
  });

  test("linked on Plaid test data: says no real payout can go there", async ({ page }) => {
    await openScreen(page, "/app/affiliate.html", client, {
      "/api/read/affiliate-portal": portal({ payoutBank: { id: "b1", environment: "sandbox", testData: true, institution: "First Platypus", name: "Checking", mask: "4471", subtype: "checking", status: "active" } })
    });
    await page.locator("#switch-payouts").click();
    await expect(page.locator("#payBankText")).toContainText("First Platypus ··4471 (checking)");
    await expect(page.locator("#payBankText")).toContainText("Plaid test data");
    await expect(page.locator("#payBankLink")).toHaveText("Change bank");
  });

  test("terms say paid when it clears, not Fridays", async ({ page }) => {
    await openScreen(page, "/app/affiliate.html", client, { "/api/read/affiliate-portal": portal() });
    await page.locator("#switch-terms").click();
    await expect(page.locator("#tab-terms")).toContainText("As soon as your client's payment clears");
    await expect(page.locator("#tab-terms")).not.toContainText("Fridays");
  });
});
