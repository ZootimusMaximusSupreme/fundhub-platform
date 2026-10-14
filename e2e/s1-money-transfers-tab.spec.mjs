// Slice 1 (money screens): the same transfer buttons, pressed on the FinanceOS
// Transfers tab (financeos.html#transfers). The standalone page has its own spec
// (money-transfers-clicks); this one proves the tab the client actually uses
// sends the exact same requests. Every /api/** call is answered by the page.

import { test, expect } from "@playwright/test";
import { wireApi, withSession } from "./harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";

function data(over = {}) {
  return {
    ok: true,
    client: { id: CLIENT, name: "Dana Whitfield" },
    mode: { enabled: true, environment: "sandbox" },
    today: "2026-10-10",
    limits: { daily_cents: 1000000, per_transfer_cents: 500000, left_today_cents: 800000 },
    accounts: [
      { id: "chk1", label: "Business Checking ••2202", available_balance_cents: 500000 },
      { id: "sav1", label: "Savings ••7781", available_balance_cents: 1200000 },
      { id: "mm1", label: "Money Market ••4410", available_balance_cents: 900000 }
    ],
    waiting: [
      {
        id: "p1", amount_cents: 200000, title: "Deposit to build banking history", why: "Lenders like to see savings.",
        proposed_by: "agent", to: { id: "sav1", label: "Savings ••7781" }, date: "2026-10-12",
        can_approve: true, suggested_from_account_id: "chk1"
      },
      {
        id: "p2", amount_cents: 50000, title: "Chase Ink payment", proposed_by: "rules",
        to: { id: "card1", label: "Chase Ink ••0042" }, date: "2026-10-11", can_approve: false, blocked: "card_payment"
      }
    ],
    history: [
      {
        id: "p3", amount_cents: 30000, title: "Monthly savings", to_kind: "bank_account", created_at: "2026-10-08T15:00:00Z",
        transfer: {
          status: "submitted", debit_status: "posted", credit_status: null, date: "2026-10-08",
          from_label: "Business Checking ••2202", to_label: "Savings ••7781", can_cancel: true,
          approved_by: "client", approved_at: "2026-10-08T15:00:00Z", events: []
        }
      }
    ],
    ...over
  };
}

async function open(page, { query = "", role = "client", postAnswer, after } = {}) {
  const posts = [];
  let gets = 0;
  await withSession(page, { staff: { role } });
  await wireApi(page, {
    handlers: {
      "/api/money/overview": { ok: true, client: { name: "Dana Whitfield" }, sandbox: false },
      "/api/money/transfers": async (route, { method }) => {
        if (method === "POST") {
          const body = route.request().postDataJSON();
          posts.push(body);
          return postAnswer ? postAnswer(body) : { ok: true };
        }
        gets += 1;
        return gets > 1 && after ? after : data();
      }
    }
  });
  await page.goto(`/app/financeos.html${query}#transfers`);
  await expect(page.locator(".wt").first()).toBeVisible();
  return { posts };
}

function answerDialogs(page, accept) {
  const seen = [];
  page.on("dialog", async (d) => { seen.push(d.message()); if (accept) await d.accept(); else await d.dismiss(); });
  return seen;
}

const card = (page, id) => page.locator(`.wt[data-id="${id}"]`);

test.describe("FinanceOS Transfers tab: the client's yes", () => {
  test("Review this move shows the exact sentence, then Yes, move $2,000.00 sends the approval for exactly that move", async ({ page }) => {
    const approved = data({ waiting: [], history: [] });
    const { posts } = await open(page, { postAnswer: () => ({ ok: true, transfer: { status: "approved", scheduled_for: "2026-10-12" } }), after: approved });
    const c = card(page, "p1");
    await expect(c.locator('button[type="submit"]')).toBeHidden();
    await c.locator('select[name="from_account_id"]').selectOption("mm1");
    await c.locator('[data-act="review"]').click();
    await expect(c.locator('[data-role="sentence"]')).toHaveText("Move $2,000.00 from Money Market ••4410 to Savings ••7781 on Oct 12, 2026?");
    await expect(c.locator('select[name="from_account_id"]')).toBeDisabled();
    await expect(c.locator('button[type="submit"]')).toHaveText("Yes, move $2,000.00");
    await c.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "approve", proposal_id: "p1", amount_cents: 200000,
      from_account_id: "mm1", to_account_id: "sav1", scheduled_for: "2026-10-12"
    });
  });

  test("Not now asks first: No sends nothing, Yes cancels that move only; Stop this move cancels the history move", async ({ page }) => {
    const { posts } = await open(page);
    let dialogs = answerDialogs(page, false);
    await card(page, "p1").locator('.wt-not [data-act="cancel"]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    await page.waitForTimeout(300);
    expect(posts).toEqual([]);
    page.removeAllListeners("dialog");
    dialogs = answerDialogs(page, true);
    await card(page, "p1").locator('.wt-not [data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "cancel", proposal_id: "p1" });
    await page.locator('tr[data-id="p3"] [data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({ action: "cancel", proposal_id: "p3" });
  });
});

test.describe("FinanceOS Transfers tab: staff on a client's file", () => {
  test("staff never get a yes button; Take it off the list names the client file", async ({ page }) => {
    const { posts } = await open(page, { query: `?client_id=${CLIENT}`, role: "funding_advisor" });
    await expect(page.locator('[data-act="review"]')).toHaveCount(0);
    const dialogs = answerDialogs(page, true);
    await card(page, "p1").locator('[data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(dialogs[0]).toBe("Take the $2,000.00 move off this client's list? Nothing will move.");
    expect(posts[0]).toEqual({ action: "cancel", proposal_id: "p1", client_id: CLIENT });
  });

  test("Set up this move sends the move in cents for that client, and a bad amount sends nothing", async ({ page }) => {
    const { posts } = await open(page, { query: `?client_id=${CLIENT}`, role: "funding_advisor" });
    const form = page.locator('form[data-form="propose"]');
    await form.locator('input[name="amount"]').fill("abc");
    await form.locator('input[name="title"]').fill("Pay the setup fee");
    await form.locator('button[type="submit"]').click();
    await expect(page.locator(".staff .act-msg")).toHaveText("Type the amount like 2000.00");
    expect(posts).toEqual([]);
    await form.locator('select[name="to"]').selectOption("fundhub");
    await form.locator('input[name="amount"]').fill("$1,500.50");
    await form.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "propose", to_kind: "fundhub", to_account_id: null, suggested_from_account_id: "chk1",
      amount_cents: 150050, due_on: "2026-10-10", title: "Pay the setup fee", client_id: CLIENT
    });
  });
});
