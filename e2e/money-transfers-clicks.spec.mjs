// Transfers (FinanceOS money moves) — every button that moves or stops money.
//
// The render tests proved the markup. Nothing ever pressed a button: not
// "Review this move", not "Yes, move $X" (the client's approval of a real money
// move), not "Not now", "Stop this move", "Take it off the list" or the staff
// "Set up this move" form. This presses each one and checks the exact request
// that goes out, that No sends nothing, and that staff never get a yes button.

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

async function open(page, { query = "", role = "client", postAnswer, after, fixture } = {}) {
  const posts = [];
  let gets = 0;
  await withSession(page, { staff: { role } });
  await wireApi(page, {
    handlers: {
      "/api/money/transfers": async (route, { method }) => {
        if (method === "POST") {
          const body = route.request().postDataJSON();
          posts.push(body);
          const out = postAnswer ? postAnswer(body) : { ok: true };
          if (out && out.status) {
            await route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
            return;
          }
          return out;
        }
        gets += 1;
        return gets > 1 && after ? after : (fixture || data());
      }
    }
  });
  await page.goto(`/app/money-transfers.html${query}`);
  await expect(page.locator(".fh-transfers h1")).toHaveText("Transfers");
  await expect(page.locator(".wt").first()).toBeVisible();
  return { posts, gets: () => gets };
}

function answerDialogs(page, accept) {
  const seen = [];
  page.on("dialog", async (d) => { seen.push(d.message()); if (accept) await d.accept(); else await d.dismiss(); });
  return seen;
}

const card = (page, id) => page.locator(`.wt[data-id="${id}"]`);

test.describe("Transfers: the client's yes", () => {
  test("the Yes button is hidden until Review; Review shows the exact sentence and locks the From picker", async ({ page }) => {
    await open(page);
    const c = card(page, "p1");
    await expect(c.locator('button[type="submit"]')).toBeHidden();
    await expect(c.locator('select[name="from_account_id"] option')).toHaveCount(2);
    await c.locator('[data-act="review"]').click();
    await expect(c.locator('[data-role="sentence"]')).toHaveText("Move $2,000.00 from Business Checking ••2202 to Savings ••7781 on Oct 12, 2026?");
    await expect(c.locator('select[name="from_account_id"]')).toBeDisabled();
    await expect(c.locator('button[type="submit"]')).toHaveText("Yes, move $2,000.00");
    await expect(c.locator('[data-act="review"]')).toBeHidden();
  });

  test("From picker: with one account to send from it is fixed text, not a choice, and Yes sends that account", async ({ page }) => {
    const oneAccount = data({ accounts: [
      { id: "chk1", label: "Business Checking ••2202", available_balance_cents: 500000 },
      { id: "sav1", label: "Savings ••7781", available_balance_cents: 1200000 }
    ] });
    const { posts } = await open(page, {
      fixture: oneAccount,
      postAnswer: () => ({ ok: true, transfer: { status: "approved", scheduled_for: "2026-10-12" } })
    });
    const c = card(page, "p1");
    await expect(c.locator('select[name="from_account_id"]')).toHaveCount(0);
    await expect(c.locator(".tx-from")).toHaveText("From Business Checking ••2202 · $5,000.00 available");
    await expect(c.locator('input[type="hidden"][name="from_account_id"]')).toHaveValue("chk1");
    await c.locator('[data-act="review"]').click();
    await expect(c.locator('[data-role="sentence"]')).toHaveText("Move $2,000.00 from Business Checking ••2202 to Savings ••7781 on Oct 12, 2026?");
    await c.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0].from_account_id).toBe("chk1");
  });

  test("Stop this move is offered only while the move has not reached the bank", async ({ page }) => {
    const reached = {
      id: "p4", amount_cents: 45000, title: "Rent reserve", to_kind: "bank_account", created_at: "2026-10-05T15:00:00Z",
      transfer: {
        status: "settled", debit_status: "settled", credit_status: "settled", date: "2026-10-05",
        from_label: "Business Checking ••2202", to_label: "Savings ••7781", can_cancel: false,
        approved_by: "client", approved_at: "2026-10-05T15:00:00Z", events: []
      }
    };
    await open(page, { fixture: data({ history: [...data().history, reached] }) });
    await expect(page.locator('tr[data-id="p3"] [data-act="cancel"]')).toHaveText("Stop this move");
    await expect(page.locator('tr[data-id="p4"]')).toContainText("$450.00");
    await expect(page.locator('tr[data-id="p4"] [data-act="cancel"]')).toHaveCount(0);
    await expect(page.locator('tr[data-id="p4"]')).not.toContainText("Stop this move");
  });

  test("a client never sees the staff Set up this move form", async ({ page }) => {
    await open(page);
    await expect(page.locator('form[data-form="propose"]')).toHaveCount(0);
    await expect(page.locator(".staff")).toHaveCount(0);
  });

  test("Go back hides the sentence and unlocks the picker", async ({ page }) => {
    await open(page);
    const c = card(page, "p1");
    await c.locator('[data-act="review"]').click();
    await c.locator('[data-act="back"]').click();
    await expect(c.locator(".confirm")).toBeHidden();
    await expect(c.locator('select[name="from_account_id"]')).toBeEnabled();
  });

  test("Yes, move $2,000.00 sends the approval for exactly that move, from the account picked", async ({ page }) => {
    const approved = data({
      waiting: [],
      history: [{ id: "p1", amount_cents: 200000, title: "Deposit to build banking history", transfer: {
        status: "approved", date: "2026-10-12", from_label: "Money Market ••4410", to_label: "Savings ••7781", events: [] } }]
    });
    const { posts } = await open(page, {
      postAnswer: () => ({ ok: true, transfer: { status: "approved", scheduled_for: "2026-10-12" } }),
      after: approved
    });
    const c = card(page, "p1");
    await c.locator('select[name="from_account_id"]').selectOption("mm1");
    await c.locator('[data-act="review"]').click();
    await expect(c.locator('[data-role="sentence"]')).toContainText("from Money Market ••4410");
    await c.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      action: "approve", proposal_id: "p1", amount_cents: 200000,
      from_account_id: "mm1", to_account_id: "sav1", scheduled_for: "2026-10-12"
    });
    await expect(page.locator(".head .caption")).toHaveText("You said yes. It goes on Oct 12, 2026.");
  });

  test("a refused approval says why under the button and does not claim success", async ({ page }) => {
    const { posts } = await open(page, {
      postAnswer: () => ({ status: 409, body: { ok: false, error: "over_daily_limit", message: "That is more than is left to move today." } })
    });
    const c = card(page, "p1");
    await c.locator('[data-act="review"]').click();
    await c.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(1);
    await expect(c.locator(".act-msg")).toHaveText("That is more than is left to move today.");
    await expect(page.locator(".head .caption")).not.toContainText("You said yes");
    await expect(c.locator('button[type="submit"]')).toBeEnabled();
  });

  test("a card payment has no yes button; it says why, and Not now asks first", async ({ page }) => {
    const { posts } = await open(page);
    const c = card(page, "p2");
    await expect(c.locator(".wt-blocked")).toHaveText("FinanceOS can't send money to a card yet. Pay it in your card app.");
    await expect(c.locator('[data-act="review"]')).toHaveCount(0);
    const dialogs = answerDialogs(page, false);
    await c.locator('[data-act="cancel"]').click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toBe("Stop the $500.00 move? Nothing will move.");
    await page.waitForTimeout(300);
    expect(posts).toEqual([]);
  });

  test("Not now with Yes sends a cancel for that move only", async ({ page }) => {
    const { posts } = await open(page);
    answerDialogs(page, true);
    await card(page, "p1").locator('.wt-not [data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({ action: "cancel", proposal_id: "p1" });
  });

  test("Stop this move (history, before it reaches the bank) sends a cancel for that move", async ({ page }) => {
    const { posts } = await open(page);
    const dialogs = answerDialogs(page, true);
    await page.locator('tr[data-id="p3"] [data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(dialogs[0]).toBe("Stop the $300.00 move? Nothing will move.");
    expect(posts[0]).toEqual({ action: "cancel", proposal_id: "p3" });
  });
});

test.describe("Transfers: staff on a client's file", () => {
  test("staff never get a yes button; Take it off the list names the client file", async ({ page }) => {
    const { posts } = await open(page, { query: `?client_id=${CLIENT}`, role: "funding_advisor" });
    await expect(page.locator('[data-act="review"]')).toHaveCount(0);
    await expect(page.locator('button[type="submit"]', { hasText: "Yes, move" })).toHaveCount(0);
    const dialogs = answerDialogs(page, true);
    await card(page, "p1").locator('[data-act="cancel"]').click();
    await expect.poll(() => posts.length).toBe(1);
    expect(dialogs[0]).toBe("Take the $2,000.00 move off this client's list? Nothing will move.");
    expect(posts[0]).toEqual({ action: "cancel", proposal_id: "p1", client_id: CLIENT });
  });

  test("Set up this move sends the move in cents for that client, and a bad amount sends nothing", async ({ page }) => {
    const { posts } = await open(page, { query: `?client_id=${CLIENT}`, role: "funding_advisor" });
    const form = page.locator('form[data-form="propose"]');
    await expect(form.locator('select[name="from"]')).toHaveValue("chk1");
    await expect(form.locator('select[name="to"]')).toHaveValue("sav1");
    // Suggested from and Date are moved off what the form opens on, so a box the page ignores shows.
    await form.locator('select[name="from"]').selectOption("mm1");
    await form.locator('input[name="due_on"]').fill("2026-10-15");
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
      action: "propose", to_kind: "fundhub", to_account_id: null, suggested_from_account_id: "mm1",
      amount_cents: 150050, due_on: "2026-10-15", title: "Pay the setup fee", client_id: CLIENT
    });

    // A move to one of the client's own accounts names that account (To left on the account it opens on).
    await expect(form.locator('input[name="amount"]')).toHaveValue("");
    await form.locator('input[name="amount"]').fill("250");
    await form.locator('input[name="title"]').fill("Savings top-up");
    await form.locator('button[type="submit"]').click();
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1]).toEqual({
      action: "propose", to_kind: "bank_account", to_account_id: "sav1", suggested_from_account_id: "chk1",
      amount_cents: 25000, due_on: "2026-10-10", title: "Savings top-up", client_id: CLIENT
    });
  });

  test("with money moves off, the staff form is not offered at all", async ({ page }) => {
    await withSession(page, { staff: { role: "funding_advisor" } });
    await wireApi(page, { handlers: { "/api/money/transfers": data({ mode: { enabled: false, reason: "limits_not_set" } }) } });
    await page.goto(`/app/money-transfers.html?client_id=${CLIENT}`);
    await expect(page.locator(".tx-banner.off")).toContainText("Fundhub has not set the money move limits yet.");
    await expect(page.locator('form[data-form="propose"]')).toHaveCount(0);
  });
});
