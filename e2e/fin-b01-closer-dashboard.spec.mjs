// Closer dashboard: the Draw amount input and the pay link panel, pressed for real
// against fake answers (finish-the-853, batch 01).
//
//   - Deal calculator: Draw amount input -> what the calculator is asked, and the
//     drawn amount that comes back is what the page paints and hands to deal-math.
//   - Send pay link (opens the panel), the offer / downsell-upsell selects, and the
//     panel's own Send pay link button -> the one POST /api/closer-deck write.
//
// NO BACKEND: page.route() answers /api/**. Nothing is sent to a client.
import { test, expect } from "@playwright/test";
import { openScreen, json, CLOSER, CLIENT_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const DUE = "2026-09-01T17:00:00.000Z";

function cockpit(over = {}) {
  return {
    ok: true,
    staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
    kpis: {
      cash_today_cents: { cents: 0, display: "$0", deposits: 0 },
      cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0,
      close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a",
    },
    client: {
      id: CLIENT_ID, name: "Dana Whitfield", business_name: "Whitfield Freight",
      age_months: 26, tags: [], funded: false, pipeline: { stage_key: "closing", stage_name: "Closing" },
    },
    credit: { available: false, reason: "No crs_results row for this client yet" },
    underwrite: {
      matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty", lite_banner_funding: null,
      totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 },
    },
    deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_source: "default", success_fee_note: "House default." },
    precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
    current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
    next_call: null,
    up_next: [{ task_id: "task-1", client_id: CLIENT_ID, due_at: DUE, title: "Closing call", name: "Dana Whitfield" }],
    offers: [
      { key: "FUNDING_DFY", name: "Funding done for you", priceDisplay: "$5,000" },
      { key: "SOFT_PULL", name: "Diagnostic soft pull", priceDisplay: "$32" },
      { key: "REPAIR_TRIAL", name: "Repair trial", priceDisplay: "$197" },
      { key: "UWIQ_DELIVERABLES", name: "Capital Blueprint", priceDisplay: "$5,000" },
    ],
    gone_quiet: { unlogged: [], quiet_deposits: [] },
    dispositions: {
      outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
      beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"],
    },
    ...over,
  };
}

const URL_WITH_CLIENT = `/app/closer-dashboard.html?client_id=${CLIENT_ID}`;

test("an off-shift closer can clock in from the call before replying", async ({ page }) => {
  let onShift = false;
  const actions = [];
  await openScreen(page, URL_WITH_CLIENT, CLOSER, readHandlers({
    "/api/read/closer-call": () => cockpit({
      staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: onShift, reason: "Off shift" } },
    }),
    "/api/shifts": (route, { method }) => {
      if (method !== "POST") return json(route, { ok: true, shift: null });
      const action = JSON.parse(route.request().postData() || "{}").action;
      actions.push(action);
      onShift = action === "clock_in";
      return json(route, { ok: true, shift: { id: "shift-1" } });
    },
  }));
  await expect(page.locator("[data-fh-call-head] .chip")).toContainText("Off shift");
  await page.locator("#fh-shift-toggle").click();
  await expect(page.locator("[data-fh-call-head] .chip")).toContainText("On shift");
  await expect(page.locator("#fh-shift-toggle")).toHaveText("Clock out");
  expect(actions).toEqual(["clock_in"]);
});

test("sample credit labels funding bands and lender matches as sample", async ({ page }) => {
  await openScreen(page, URL_WITH_CLIENT, CLOSER, readHandlers({
    "/api/read/closer-call": cockpit({
      credit: { available: true, sample: true, scores: { EX: 771 } },
      underwrite: { matched_lenders: 20, lite_banner_funding: 110000,
        totals: { total_personal_funding: 212000, total_combined_funding: 410000 } },
    }),
  }));
  await expect(page.locator(".funding-estimate .source-label")).toHaveText("Sample UnderwriteIQ estimate");
  await expect(page.locator(".bands .band .bn").first()).toContainText("Sample estimate");
  await expect(page.locator(".lever")).toContainText("Sample file · 20 lenders");
});

function readHandlers(over = {}) {
  return {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/closer-call": cockpit(),
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/agent-context": { ok: true, context: {} },
    ...over,
  };
}

function tradelines(drawn) {
  return {
    ok: true, client_id: CLIENT_ID,
    data: [{ id: "t1", lender: "Chase Ink", account_type: "revolving", credit_limit: 20000, current_balance: 5000 }],
    funding: {
      totalAvailableCredit: 15000,
      allocation: {
        requestedAmount: drawn, totalDrawn: drawn, shortfall: 0,
        draws: [{ lender: "Chase Ink", apr: 18.99, creditLimit: 20000, currentBalance: 5000, availableHeadroom: 15000, draw: drawn }],
      },
      guardrail: { aggregateUtilization: 0.4, threshold: 0.3, hardStop: false, message: null },
      payMethodComparison: { horizons: [] },
    },
  };
}

/* ── the Draw amount input ─────────────────────────────────────────────── */

async function openCalculator(page, { hold } = {}) {
  const trade = [];
  const math = [];
  await openScreen(page, URL_WITH_CLIENT, CLOSER, readHandlers({
    "/api/read/tradelines": async (route, { url }) => {
      const u = new URL(url);
      trade.push(Object.fromEntries(u.searchParams));
      // `hold` maps a requested amount to a promise: that answer waits until the test lets it go.
      const wait = hold && hold[u.searchParams.get("requested_amount")];
      if (wait) await wait;
      return json(route, tradelines(Number(u.searchParams.get("requested_amount") || 10000) || 10000));
    },
    "/api/read/deal-math": (route, { url }) => {
      const p = Object.fromEntries(new URL(url).searchParams);
      math.push(p);
      const drawn = Number(p.drawn);
      return json(route, { ok: true, drawn, fees: Number(p.deposit) + drawn * Number(p.fee) / 100, debts: Number(p.debts), net: drawn, monthly: drawn * Number(p.min) / 100 });
    },
  }));
  await page.locator("#paymentCalculator > summary").click();
  await expect(page.locator("#oCredit")).toHaveText("$15,000");
  return { trade, math };
}

test.describe("closer dashboard: the Draw amount input", () => {
  test("a typed draw is asked of the calculator, and the drawn amount that comes back is painted and sent on to deal-math", async ({ page }) => {
    const { trade, math } = await openCalculator(page);
    await expect(page.locator("#oDrawn")).toHaveText("10,000");
    await page.locator("#iDraw").fill("12500");
    await expect.poll(() => trade[trade.length - 1].requested_amount).toBe("12500");
    expect(trade[trade.length - 1].client_id).toBe(CLIENT_ID);
    await expect(page.locator("#oDrawn")).toHaveText("12,500");
    await expect.poll(() => math[math.length - 1].drawn).toBe("12500");
    await expect(page.locator("#oFunded")).toHaveText("$12,500");
  });

  test("a second draw replaces the first: the page paints the last answer", async ({ page }) => {
    const { trade } = await openCalculator(page);
    await page.locator("#iDraw").fill("12500");
    await expect(page.locator("#oDrawn")).toHaveText("12,500");
    await page.locator("#iDraw").fill("4000");
    await expect.poll(() => trade[trade.length - 1].requested_amount).toBe("4000");
    await expect(page.locator("#oDrawn")).toHaveText("4,000");
    await expect(page.locator("#oFunded")).toHaveText("$4,000");
  });

  test("the draw is sent whole: 12500 is not cut to a thousand or turned into the slider max", async ({ page }) => {
    const { trade } = await openCalculator(page);
    await page.locator("#iDraw").fill("7350");
    await expect.poll(() => trade[trade.length - 1].requested_amount).toBe("7350");
    // The threshold is its own question and is not touched by a draw.
    expect(trade[trade.length - 1].utilization_threshold).toBe(trade[0].utilization_threshold);
  });
});

test.describe("closer dashboard: the Draw amount input, repair cycle 1", () => {
  test("a slow older answer never replaces the newest draw: 12,500 answers last and 4,000 is still what is painted", async ({ page }) => {
    let release;
    const slow = new Promise((resolve) => { release = resolve; });
    const { trade, math } = await openCalculator(page, { hold: { "12500": slow } });
    await page.locator("#iDraw").fill("12500");
    await expect.poll(() => trade.some((t) => t.requested_amount === "12500")).toBe(true);
    await page.locator("#iDraw").fill("4000");
    await expect(page.locator("#oDrawn")).toHaveText("4,000");
    await expect(page.locator("#oFunded")).toHaveText("$4,000");
    // Now the older answer lands, long after the newer one.
    release();
    await page.waitForTimeout(500);
    await expect(page.locator("#oDrawn")).toHaveText("4,000");
    await expect(page.locator("#oFunded")).toHaveText("$4,000");
    expect(math[math.length - 1].drawn).toBe("4000");
  });

  test("a draw that is not a multiple of the slider step is sent whole: 7350 stays 7350, never 7500", async ({ page }) => {
    const { trade } = await openCalculator(page);
    await page.locator("#iDraw").fill("7350");
    await expect.poll(() => trade.some((t) => t.requested_amount === "7350")).toBe(true);
    expect(trade.some((t) => t.requested_amount === "7500")).toBe(false);
    await expect(page.locator("#oDrawn")).toHaveText("7,350");
  });
});

/* ── the pay link panel ────────────────────────────────────────────────── */

async function openCall(page, { cockpitOver, deck } = {}) {
  const posted = [];
  await openScreen(page, URL_WITH_CLIENT, CLOSER, readHandlers({
    "/api/read/closer-call": cockpit(cockpitOver),
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
    "/api/read/deal-math": { ok: true },
    "/api/closer-deck": async (route) => {
      posted.push(JSON.parse(route.request().postData() || "{}"));
      if (deck) return deck(route, posted.length);
      return json(route, { ok: true, action: "send_pay_link", link: { checkout_url: "https://pay.example/1" } });
    },
  }));
  return { posted };
}

test.describe("closer dashboard: the pay link panel", () => {
  test("Send pay link opens the panel with this call's offers, and pressing it again closes it", async ({ page }) => {
    await openCall(page);
    const open = page.locator("#fh-pay-link");
    await expect(open).toBeVisible();
    await expect(page.locator("#fh-pay-panel")).toBeHidden();
    await open.click();
    await expect(page.locator("#fh-pay-panel")).toBeVisible();
    await expect(page.locator("#fh-pay-offer option")).toHaveText([
      "Funding done for you · $5,000", "Diagnostic soft pull · $32", "Repair trial · $197",
    ]);
    await expect(page.locator("#fh-pay-msg")).toContainText("Pick the offer, then send");
    await open.click();
    await expect(page.locator("#fh-pay-panel")).toBeHidden();
  });

  test("with no booked call there is no Send pay link button at all", async ({ page }) => {
    await openScreen(page, "/app/closer-dashboard.html", CLOSER, readHandlers({
      "/api/read/closer-now": { ok: true, current: null, next: null },
      "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
    }));
    await expect(page.locator("#ccp-who-name")).toHaveText("No call right now");
    await expect(page.locator("#fh-pay-link")).toHaveCount(0);
    await expect(page.locator("#fh-pay-panel")).toHaveCount(0);
  });

  test("a first soft pull asks for no downsell or upsell, and sends with no motion", async ({ page }) => {
    const { posted } = await openCall(page);
    await page.locator("#fh-pay-link").click();
    await expect(page.locator("#fh-pay-motion-field")).toBeHidden();
    await page.locator("#fh-pay-offer").selectOption("SOFT_PULL");
    await expect(page.locator("#fh-pay-motion-field")).toBeHidden();
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toContainText("Sent");
    expect(posted).toEqual([{ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "SOFT_PULL", sale_motion: null }]);
  });

  test("an alternate offer needs downsell or upsell: with none chosen nothing is sent, with one chosen it goes in the write", async ({ page }) => {
    const { posted } = await openCall(page);
    await page.locator("#fh-pay-link").click();
    await page.locator("#fh-pay-offer").selectOption("UWIQ_DELIVERABLES");
    await expect(page.locator("#fh-pay-motion-field")).toBeVisible();
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toContainText("Choose downsell or upsell");
    expect(posted).toEqual([]);
    await page.locator("#fh-pay-motion").selectOption("upsell");
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toContainText("Sent");
    expect(posted).toEqual([{ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "UWIQ_DELIVERABLES", sale_motion: "upsell" }]);
  });

  test("a motion chosen for an alternate offer is dropped when a primary offer is picked again", async ({ page }) => {
    const { posted } = await openCall(page);
    await page.locator("#fh-pay-link").click();
    await page.locator("#fh-pay-offer").selectOption("UWIQ_DELIVERABLES");
    await page.locator("#fh-pay-motion").selectOption("downsell");
    await page.locator("#fh-pay-offer").selectOption("FUNDING_DFY");
    await expect(page.locator("#fh-pay-motion-field")).toBeHidden();
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toContainText("Sent");
    expect(posted[0].offer_key).toBe("FUNDING_DFY");
    expect(posted[0].sale_motion).toBe(null);
  });

  test("Send pay link in the panel is one write, answered in words, and starts watching for the payment", async ({ page }) => {
    const { posted } = await openCall(page);
    await page.locator("#fh-pay-link").click();
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toHaveText("Sent. Stay on the call until it posts.");
    await expect(page.locator("#fh-money-note")).toContainText("Watching for the payment");
    await expect(page.locator("#fh-pay-go")).toBeEnabled();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toEqual({ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "FUNDING_DFY", sale_motion: null });
  });

  test("a refusal from the server is shown in its own words and nothing starts watching", async ({ page }) => {
    await openCall(page, {
      deck: (route) => json(route, { ok: false, error: "checkout_missing", message: "That offer has no checkout set up." }, 409),
    });
    await page.locator("#fh-pay-link").click();
    await page.locator("#fh-pay-go").click();
    await expect(page.locator("#fh-pay-msg")).toContainText("That offer has no checkout set up.");
    await expect(page.locator("#fh-money-note")).toBeHidden();
    await expect(page.locator("#fh-pay-go")).toBeEnabled();
  });

  test("with no offers on the call the select says so and Send is off", async ({ page }) => {
    const { posted } = await openCall(page, { cockpitOver: { offers: [] } });
    await page.locator("#fh-pay-link").click();
    await expect(page.locator("#fh-pay-offer option")).toHaveText(["No offers in the catalog"]);
    await expect(page.locator("#fh-pay-go")).toBeDisabled();
    expect(posted).toEqual([]);
  });

  test("a second press while it is sending sends nothing: one write, the button off, then one Sent", async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    const { posted } = await openCall(page, {
      deck: async (route) => {
        await held;
        return json(route, { ok: true, action: "send_pay_link", link: { checkout_url: "https://pay.example/1" } });
      },
    });
    await page.locator("#fh-pay-link").click();
    await page.locator("#fh-pay-go").click();
    await expect.poll(() => posted.length).toBe(1);
    await expect(page.locator("#fh-pay-go")).toBeDisabled();
    await expect(page.locator("#fh-pay-msg")).toHaveText("Sending…");
    // A second real press on the button while it is off: the browser does not deliver it.
    await page.locator("#fh-pay-go").click({ force: true });
    await page.waitForTimeout(250);
    expect(posted).toHaveLength(1);
    release();
    await expect(page.locator("#fh-pay-msg")).toHaveText("Sent. Stay on the call until it posts.");
    await expect(page.locator("#fh-pay-go")).toBeEnabled();
    expect(posted).toHaveLength(1);
  });
});
