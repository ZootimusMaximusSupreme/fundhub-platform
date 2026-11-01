// Closer deck (present.html), part 9 Paperwork (S-23; it was "07 Close" before 2026-10-29): "Send pay link",
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
import { offersForClient } from "../src/config/offers.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const DECK = (tier = "REPAIR_ONLY") => ({
  ok: true,
  survey: { name: "Dana Whitfield" },
  businesses: [{ id: "biz-1", name: "Whitfield Freight LLC", age_months: 66, incorporated_date: "2021-03-01" }],
  income_estimates: {},
  engine: { available: true, tier, fico: { experian: 640, equifax: 632, transunion: 651 }, reasons: [], total: 0 },
  offers: offersForClient(),
  soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "crs-fixture", sample: false },
});

async function open(page, { tier, deck, invoices, outbound } = {}) {
  const calls = { deck: [], outbound: [], invoices: [], context: [] };
  await openScreen(page, `/app/present.html?contact=${CLIENT_ID}`, CLOSER, {
    "/api/read/closer-deck": DECK(tier),
    "/api/read/agent-context": async (route, { url }) => {
      calls.context.push(Object.fromEntries(new URL(url).searchParams));
      return json(route, { ok: true, context: { client: { id: CLIENT_ID }, as_prompt_block: "Saved fixture client context" } });
    },
    "/api/closer-deck": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.deck.push(body);
      return deck ? deck(route, calls.deck.length) : json(route, { ok: true, action: body.action });
    },
    "/api/read/invoices": async (route, { url }) => {
      const asked = Object.fromEntries(new URL(url).searchParams);
      calls.invoices.push(asked);
      const answer = invoices || { ok: true, items: [{ id: "inv-1", status: "open", amount_display: "$1,500.00" }] };
      // The server hands back no more than `limit` rows, newest first, like the real read does.
      const limit = Number(asked.limit);
      const items = Array.isArray(answer.items) && Number.isFinite(limit) && limit > 0 ? answer.items.slice(0, limit) : answer.items;
      return json(route, { ...answer, items });
    },
    "/api/messages-outbound": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      calls.outbound.push(body);
      return outbound ? outbound(route) : json(route, { ok: true });
    },
  });
  await page.waitForSelector('[data-act="phase:09"]');
  await page.locator('[data-act="phase:09"]').click();
  await page.waitForSelector('[data-act="pay"]');
  return calls;
}

const toast = (page) => page.locator(".toast");

test("client Present shows live assessment progress at phone width and waits for a real result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let pull = { consent_valid: false, diagnostic_paid: false, pull_status: null, crs_result_id: null, sample: false };
  await openScreen(page, `/app/present.html?contact=${CLIENT_ID}`, CLOSER, {
    "/api/read/closer-deck": (route) => json(route, { ...DECK("FULL_FUNDING"), soft_pull: pull }),
    "/api/read/agent-context": { ok: true, context: {} }
  });
  await page.locator('[data-act="phase:03"]').click();
  await page.locator('[data-act="next"]').click();
  await expect(page.locator(".client .h1")).toHaveText("Waiting for your authorization");
  await expect(page.locator(".client")).not.toContainText("scanning experian");
  await page.locator('[data-act="next"]').click();
  await expect(page.locator(".client .slide-hd")).toContainText("S-06");
  await page.locator('[data-act="phase:05"]').click();
  await expect(page.locator(".client .slide-hd")).toContainText("S-06");
  await expect(page.locator(".client")).not.toContainText("Recommended path");
  await page.locator('[data-act="phase:04"]').click();
  await expect(page.locator(".client .slide-hd")).toContainText("S-07");
  await page.locator('[data-act="next"]').click();
  await expect(page.locator(".client .slide-hd")).toContainText("S-06");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  pull = { consent_valid: true, diagnostic_paid: true, pull_status: "processing", crs_result_id: null, sample: false };
  await expect(page.locator(".client .h1")).toHaveText("Your report is being prepared", { timeout: 7000 });
  pull = { ...pull, pull_status: "complete", crs_result_id: "crs-test" };
  await expect(page.locator(".client .h1")).toHaveText("Your report is ready", { timeout: 7000 });
  await page.locator('[data-act="next"]').click();
  await expect(page.locator(".client .slide-hd")).toContainText("S-07");
});

test.describe("closer deck: Send pay link", () => {
  test("it sends this client with the offer the deck chose and no sale motion, once", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    const body = calls.deck[0];
    expect(body.action).toBe("send_pay_link");
    expect(body.client_id).toBe(CLIENT_ID);
    // The completed repair file leads with the Capital Blueprint (2026-10-29).
    expect(body.offer_key).toBe("UWIQ_DELIVERABLES");
    expect(body.sale_motion).toBe(null);
    await expect(toast(page)).toHaveText("Pay link sent.");
    expect(calls.context[0].client_id).toBe(CLIENT_ID);
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
    await page.locator('[data-act="phase:09"]').click();
    await page.waitForSelector("#fh-sale-motion");
    await page.locator("#fh-sale-motion").selectOption("upsell");
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].offer_key).toBe("UWIQ_DELIVERABLES");
    expect(calls.deck[0].sale_motion).toBe("upsell");
    expect(calls.deck[0].amount_cents).toBe(500000);
    expect(calls.deck[0].provider).toBe("commas");
  });

  test("a downsell or upsell chosen for an alternate offer is dropped when the deck goes back to a primary offer", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="desc:diy"]').click();
    await page.locator('[data-act="phase:09"]').click();
    await page.waitForSelector("#fh-sale-motion");
    await page.locator("#fh-sale-motion").selectOption("downsell");
    await page.locator('[data-act="desc:dfy"]').click();
    await page.locator('[data-act="phase:09"]').click();
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
    await expect(pay).toHaveText("Send pay link");
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

  test("it asks for the newest five, and finds the open invoice when it is the fourth in the list", async ({ page }) => {
    const calls = await openMore(page, {
      invoices: { ok: true, items: [
        { id: "inv-a", status: "void" },
        { id: "inv-b", status: "written_off" },
        { id: "inv-c", status: "void" },
        { id: "inv-open", status: "open" },
        { id: "inv-far", status: "open" },
      ] },
    });
    await page.locator('[data-act="invoice"]').click();
    await expect.poll(() => calls.outbound.length).toBe(1);
    expect(calls.invoices[0].limit).toBe("5");
    expect(calls.invoices[0].client_id).toBe(CLIENT_ID);
    expect(calls.outbound[0]).toEqual({ action: "email_invoice", invoice_id: "inv-open" });
  });

  test("an invoice that is sixth in the list is not reached: the read is bounded, so it says none", async ({ page }) => {
    const calls = await openMore(page, {
      invoices: { ok: true, items: [
        { id: "a", status: "void" }, { id: "b", status: "void" }, { id: "c", status: "void" },
        { id: "d", status: "void" }, { id: "e", status: "written_off" }, { id: "f-open", status: "open" },
      ] },
    });
    await page.locator('[data-act="invoice"]').click();
    await expect(toast(page)).toHaveText("No invoice on this file yet.");
    expect(calls.outbound).toEqual([]);
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
  test("a reload keeps this call's checkout link for the disposition", async ({ page }) => {
    const calls = await open(page, {
      tier: "FULL_FUNDING",
      deck: (route, n) => json(route, n === 1
        ? { ok: true, action: "send_pay_link", link: { id: "link-this-call" } }
        : { ok: true, action: "log_disposition" })
    });
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem(`fh_call_payment_link:${new URLSearchParams(location.search).get("contact")}`) || "null")?.id)).toBe("link-this-call");
    await page.reload();
    await page.locator('[data-act="phase:09"]').click();
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(2);
    expect(calls.deck[1].payment_link_id).toBe("link-this-call");
  });

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

  test("it writes the call's route, the temperature, the belief count and the cost of inaction as the closer set them", async ({ page }) => {
    const calls = await open(page, { tier: "FULL_FUNDING" });
    // Discovery: two beliefs the client said, and what the problem costs them each month.
    await page.locator('[data-act="phase:02"]').click();
    await page.waitForSelector('[data-act="check:Pain"]');
    await page.locator('[data-act="check:Pain"]').click();
    await page.locator('[data-act="check:Trust"]').click();
    await page.locator("#fh-cost").fill("$4,000 a month");
    // The ask: their number out of ten (S-18 is the second slide of that part).
    await page.locator('[data-act="phase:07"]').click();
    await page.keyboard.press("ArrowRight");
    await page.waitForSelector('[data-act="temp:9"]');
    await page.locator('[data-act="temp:9"]').click();
    await page.locator('[data-act="phase:09"]').click();
    await page.waitForSelector('[data-act="disp"]');
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0]).toEqual({
      action: "log_disposition",
      client_id: CLIENT_ID,
      offer_key: "FUNDING_DFY",
      sale_motion: null,
      edu: false,
      force_repair: false,
      tier: "FULL_FUNDING",
      route: "FULL_FUNDING",
      temperature: 9,
      beliefs_count: 2,
      cost_of_inaction: "$4,000 a month",
      repair_referral: false,
    });
  });

  test("with nothing set the write carries temperature 0, no beliefs and no cost, not made-up numbers", async ({ page }) => {
    const calls = await open(page, { tier: "FULL_FUNDING" });
    await page.locator('[data-act="disp"]').click();
    await expect.poll(() => calls.deck.length).toBe(1);
    expect(calls.deck[0].temperature).toBe(0);
    expect(calls.deck[0].beliefs_count).toBe(0);
    expect(calls.deck[0].cost_of_inaction).toBe(null);
    expect(calls.deck[0].route).toBe("FULL_FUNDING");
  });

  test("a downsell to the trial rung writes that offer, not the first one", async ({ page }) => {
    const calls = await open(page);
    await page.locator('[data-act="desc:trial"]').click();
    await page.locator('[data-act="phase:09"]').click();
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
