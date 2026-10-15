// Closer deck (present.html), section 07 Close: "Send agreement + pay link",
// "Invoice this client" and "Log disposition and close" (finish-the-853, batch 01).
//
// Each is pressed in the real page against fake answers and judged on the exact
// write it sends, what it says when the server says no, and the double-press
// guard that stops a client getting two pay links.
//
// Not here: the "$ amount" e-book box and "Send e-book email". present.js has no
// e-book control at all and the server refuses the send_ebook action, so there is
// nothing on the page to press (see the manifest).
//
// NO BACKEND: page.route() answers /api/**. Nothing is mailed, texted or charged.
import { test, expect } from "@playwright/test";
import { openScreen, json, CLOSER, CLIENT_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const DECK = (tier = "REPAIR_ONLY") => ({
  ok: true,
  survey: { name: "Dana Whitfield" },
  businesses: [{ id: "biz-1", name: "Whitfield Freight LLC", age_months: 66, incorporated_date: "2021-03-01" }],
  income_estimates: {},
  engine: { available: true, tier, fico: { experian: 640, equifax: 632, transunion: 651 }, reasons: [], total: 0 },
  offers: [
    { key: "REPAIR_DFY", name: "Repair done for you", priceCents: 150000, priceDisplay: "$1,500", letters: false },
    { key: "FUNDING_DFY", name: "Funding done for you", priceCents: 500000, priceDisplay: "$5,000", letters: false },
    { key: "REPAIR_TRIAL", name: "Repair trial round", priceCents: 19700, priceDisplay: "$197", letters: false },
    { key: "UWIQ_DELIVERABLES", name: "Capital Blueprint", priceCents: 29700, priceDisplay: "$297", letters: false },
  ],
  soft_pull: null,
});

async function open(page, { tier, deck, invoices, outbound } = {}) {
  const calls = { deck: [], outbound: [], invoices: [] };
  await openScreen(page, `/app/present.html?contact=${CLIENT_ID}`, CLOSER, {
    "/api/read/closer-deck": DECK(tier),
    "/api/closer-deck": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.deck.push(body);
      return deck ? deck(route, calls.deck.length) : json(route, { ok: true, action: body.action });
    },
    "/api/read/invoices": async (route, { url }) => {
      calls.invoices.push(Object.fromEntries(new URL(url).searchParams));
      return json(route, invoices || { ok: true, items: [{ id: "inv-1", status: "open", amount_display: "$1,500.00" }] });
    },
    "/api/messages-outbound": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.outbound.push(body);
      return outbound ? outbound(route) : json(route, { ok: true });
    },
  });
  await page.waitForSelector('[data-act="phase:07"]');
  await page.locator('[data-act="phase:07"]').click();
  await page.waitForSelector('[data-act="pay"]');
  return calls;
}

const toast = (page) => page.locator(".toast");

test.describe("closer deck: Send agreement + pay link", () => {
  test("it sends this client with the offer the deck chose and no sale motion, once", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    const body = calls.deck[0];
    expect(body.action).toBe("send_pay_link");
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.offer_key).toBe("REPAIR_DFY");
    expect(body.sale_motion).toBe(null);
    await expect(toast(page)).toHaveText("Agreement and pay link sent.");
  });

  test("a funding deck sends the funding offer", async ({ page }) => {
    const calls = await open(page, { tier: "FULL_FUNDING" });
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].offer_key).toBe("FUNDING_DFY");
    expect(calls.deck[0].sale_motion).toBe(null);
  });

  test("an alternate offer carries the downsell or upsell the closer picked", async ({ page }) => {
    const calls = await open(page);
    // Descend to the Blueprint rung: an alternate offer, so a motion is asked for.
    await page.locator('[data-act="desc:diy"]').click();
    await page.locator('[data-act="phase:07"]').click();
    await page.waitForSelector("#fh-sale-motion");
    await page.locator("#fh-sale-motion").selectOption("upsell");
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].offer_key).toBe("UWIQ_DELIVERABLES");
    expect(calls.deck[0].sale_motion).toBe("upsell");
  });

  test("a downsell or upsell chosen for an alternate offer is dropped when the deck goes back to a primary offer", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="desc:diy"]').click();
    await page.locator('[data-act="phase:07"]').click();
    await page.waitForSelector("#fh-sale-motion");
    await page.locator("#fh-sale-motion").selectOption("downsell");
    await page.locator('[data-act="desc:dfy"]').click();
    await page.locator('[data-act="phase:07"]').click();
    await page.waitForSelector('[data-act="pay"]');
    await expect(page.locator("#fh-sale-motion")).toHaveCount(0);
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].offer_key).toBe("REPAIR_DFY");
    expect(calls.deck[0].sale_motion).toBe(null);
  });

  test("a second press while it is sending, or just after, sends nothing: one write, then Sent at and hold on", async ({ page }) => {
    const calls = await open(page);
    const pay = page.locator('[data-act="pay"]');
    await pay.click();
    await expect(pay).toHaveText("Sent — hold on");
    await expect(pay).toBeDisabled();
    await pay.click({ force: true });
    // A press that reaches the page's own handler anyway (a re-rendered button, a
    // script) is refused by the page too, not only by the disabled attribute.
    await pay.evaluate((el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(300);
    expect(calls.deck).toHaveLength(1);
    await expect(page.locator(".sent-at")).toContainText("Sent at");
  });

  test("a refusal shows the server's words, the button is pressable again, and nothing says it was sent", async ({ page }) => {
    const calls = await open(page, {
      deck: (route) => json(route, { ok: false, error: "no_checkout", message: "That offer has no checkout set up." }, 409),
    });
    const pay = page.locator('[data-act="pay"]');
    await pay.click();
    await expect.poll(() => calls.deck.length).toBe(1);
    await expect(toast(page)).toHaveText("That offer has no checkout set up.");
    await expect(pay).toHaveText("Send agreement + pay link");
    await expect(pay).toBeEnabled();
    await expect(page.locator(".sent-at")).toHaveCount(0);
  });
});

test.describe("closer deck: Invoice this client", () => {
  async function openMore(page, opts) {
    const calls = await open(page, opts);
    await page.locator('[data-act="more"]').click();
    await page.waitForSelector('[data-act="invoice"]');
    return calls;
  }

  test("it reads this client's invoices and emails the first open one, by its id", async ({ page }) => {
    const calls = await openMore(page, {
      invoices: { ok: true, items: [
        { id: "inv-void", status: "void" },
        { id: "inv-off", status: "written_off" },
        { id: "inv-open", status: "open" },
        { id: "inv-later", status: "open" },
      ] },
    });
    await page.locator('[data-act="invoice"]').click();
    await expect.poll(() => calls.outbound.length).toBe(1);
    expect(calls.invoices[0].client_id).toBe(CLIENT_ID);
    expect(calls.outbound[0]).toEqual({ action: "email_invoice", invoice_id: "inv-open" });
    await expect(toast(page)).toHaveText("Invoice emailed.");
  });

  test("with only void and written-off invoices it says none and emails nothing", async ({ page }) => {
    const calls = await openMore(page, {
      invoices: { ok: true, items: [{ id: "a", status: "void" }, { id: "b", status: "written_off" }] },
    });
    await page.locator('[data-act="invoice"]').click();
    await expect(toast(page)).toHaveText("No invoice on this file yet.");
    expect(calls.outbound).toEqual([]);
  });

  test("with no invoices at all it says none and emails nothing", async ({ page }) => {
    const calls = await openMore(page, { invoices: { ok: true, items: [] } });
    await page.locator('[data-act="invoice"]').click();
    await expect(toast(page)).toHaveText("No invoice on this file yet.");
    expect(calls.outbound).toEqual([]);
  });

  test("an email the server refuses says so and is never reported as sent", async ({ page }) => {
    const calls = await openMore(page, {
      outbound: (route) => json(route, { ok: false, error: "no_email", message: "This client has no email address on file." }, 400),
    });
    await page.locator('[data-act="invoice"]').click();
    await expect.poll(() => calls.outbound.length).toBe(1);
    await expect(toast(page)).toHaveText("This client has no email address on file.");
    await expect(page.locator(".sent-at")).toHaveCount(0);
  });
});

test.describe("closer deck: Log disposition and close", () => {
  test("it writes the disposition for this client with the offer the deck chose", async ({ page }) => {
    const calls = await open(page, { tier: "FULL_FUNDING" });
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    const body = calls.deck[0];
    expect(body.action).toBe("log_disposition");
    expect(body.client_id).toBe(CLIENT_ID);
    expect(body.offer_key).toBe("FUNDING_DFY");
    expect(body.repair_referral).toBe(false);
    await expect(toast(page)).toHaveText("Disposition written to contact record.");
  });

  test("a downsell to the trial rung writes that offer, not the first one", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="desc:trial"]').click();
    await page.locator('[data-act="phase:07"]').click();
    await page.waitForSelector('[data-act="disp"]');
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].action).toBe("log_disposition");
    expect(calls.deck[0].offer_key).toBe("REPAIR_TRIAL");
  });

  test("a refusal is said in the server's words and no write is claimed", async ({ page }) => {
    const calls = await open(page, {
      deck: (route) => json(route, { ok: false, error: "not_ready", message: "This call has no outcome to write yet." }, 409),
    });
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    await expect(toast(page)).toHaveText("This call has no outcome to write yet.");
    await expect(page.locator(".sent-at")).toHaveCount(0);
  });
});
