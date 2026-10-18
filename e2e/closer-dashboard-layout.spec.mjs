import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_ID, CLOSER, openScreen, freezeClock, json } from "./harness.mjs";

// One client, fixture-only API responses, no external write path.
const NOW = "2026-09-01T16:40:00.000Z";
const call = {
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3600000 } },
  client: { id: CLIENT_ID, name: "Dana Whitfield", business_name: "Whitfield Freight", age_months: 26,
    pipeline: { stage_key: "closing", stage_name: "Closing" } },
  credit: { available: true, pulled_at: NOW, scores: { experian: 701, equifax: 688, transunion: 712 },
    utilization: 34, inquiries_6mo: 2, derogatories: 0 },
  underwrite: { matched_lenders: 6, lenders: [], applications: [], lite_banner_funding: 42000,
    totals: { total_personal_funding: 61000, total_business_funding: 40000, total_combined_funding: 101000 } },
  deal: { latest_payment: { transaction_id: "tx-old", amount_cents: 50000, amount_display: "$500", product_name: "Deposit", created_at: "2026-05-02T15:00:00.000Z" },
    success_fee_percent: 0.15, success_fee_source: "closeout", success_fee_note: "From this round's closeout record." },
  precall: { conversation_count: 8, summary: "Dana wants working capital for a second truck and a larger freight contract.",
    wants: "$75,000", purpose: "Second truck", guessed_fico: 700, last_message_at: "2026-09-01T15:40:00.000Z", lead_source: "Funding campaign" },
  current_call: { due_at: "2026-09-01T17:00:00.000Z", task_id: "task-1", title: "Closing call" },
  next_call: { due_at: "2026-09-01T18:00:00.000Z", task_id: "task-2", client_id: "bbbb", name: "Sam Okafor" },
  up_next: [
    { task_id: "task-1", client_id: CLIENT_ID, due_at: "2026-09-01T17:00:00.000Z", name: "Dana Whitfield", title: "Closing call" },
    { task_id: "task-2", client_id: "bbbb", due_at: "2026-09-01T18:00:00.000Z", name: "Sam Okafor", title: "Closing call" }
  ],
  offers: [{ key: "FUNDING_DFY", name: "Funding done for you", priceDisplay: "$5,000" }],
  dispositions: { outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"], beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"] }
};
const evidence = path.resolve("ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/closer-dashboard");
const handlers = {
  "/api/read/closer-call": call,
  "/api/read/closer-now": { ok: true, current: null, next: null },
  "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
  "/api/read/lender-matches": { ok: true, match_count: 6, summary: { lender_count: 6 }, matches: [] },
  "/api/read/deal-math": { ok: true },
  "/api/read/agent-context": { ok: true, context: {} }
};
async function open(page, over = {}) {
  await freezeClock(page, NOW);
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, { ...handlers, ...over });
  await expect(page.locator("#ccp-who-name")).toHaveText("Dana Whitfield");
}

for (const width of [1440, 390, 320]) {
  test(`call identity, tools and real credit facts are available at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await open(page);
    const main = page.locator("main");
    await expect(page.locator("#closer-client-file")).toHaveAttribute("href", `client-control-panel.html?client_id=${CLIENT_ID}`);
    await expect(page.locator("#ccp-call-when")).toContainText("in 20m");
    await expect(page.locator(".panel").first()).toContainText("EX 701 · EQ 688 · TU 712");
    await expect(page.locator(".panel").nth(1)).toContainText("15%");
    await expect(page.locator(".band .bv")).toHaveText(["$42,000", "$61,000", "$101,000"]);
    const position = await page.locator(".panel").first().boundingBox();
    const funding = await page.locator(".funding-estimate").boundingBox();
    const callTools = await page.locator(".call-actions").boundingBox();
    expect(callTools.y + callTools.height, "funding follows the focused call tools").toBeLessThan(funding.y);
    expect(funding.y + funding.height, "funding stays before credit/deal detail at every width").toBeLessThanOrEqual(position.y);
    expect(position.y, "credit facts still start inside the initial phone fold").toBeLessThan(700);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect(await main.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const metrics = await page.evaluate(() => {
      const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        client: box("#ccp-who-name"), callTools: box(".call-actions"), fundingEstimate: box(".funding-estimate"),
        creditFacts: box(".panel"), dealFacts: box(".panel:nth-child(2)"),
        mainOverflow: document.querySelector("main").scrollWidth - document.querySelector("main").clientWidth,
        initialMainControls: Array.from(document.querySelectorAll("main button,main input,main a,main summary")).filter(el => {
          const r = el.getBoundingClientRect(); return el.checkVisibility() && r.top < innerHeight && r.bottom > 68 && r.width > 0 && r.height > 0;
        }).map(el => el.textContent.trim() || el.id)
      };
    });
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, `${width}-layout-metrics.json`), JSON.stringify(metrics, null, 2) + "\n");
    await expect(page.locator("#fh-join")).toBeDisabled();
    await expect(page.locator("#fh-pay-link")).toHaveClass(/\bk\b/);
    for (const id of ["fh-present", "fh-send-contract", "fh-pay-link"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(40);
    }
    if (width < 720) await expect(page.locator("#closer-disposition")).not.toHaveAttribute("open", "");
    await page.locator("#paymentCalculator > summary").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#paymentCalculator")).toHaveAttribute("open", "");
    await page.locator("#breakdown > summary").click();
    const expandedOverflow = await main.evaluate(el => ({ overflow: el.scrollWidth - el.clientWidth,
      outside: Array.from(el.querySelectorAll("*")).filter(node => node.getBoundingClientRect().right > el.getBoundingClientRect().right).map(node => node.tagName + "." + node.className + "#" + node.id) }));
    expect(expandedOverflow.overflow, JSON.stringify(expandedOverflow)).toBeLessThanOrEqual(1);
    await page.locator("#paymentCalculator > summary").click();
    await main.evaluate(el => { el.scrollTop = 0; });
    fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, `${width}-full-call.png`) });
  });
}

test("a phone can log an outcome from the disclosure with keyboard and save to the same client", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posted = [];
  await open(page, {
    "/api/call-outcomes": route => {
      posted.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, { ok: true, created: true, outcome: { outcome: "callback" } });
    }
  });
  await page.locator("#closer-disposition > summary").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".logbar")).toBeVisible();
  await page.locator('[data-outcome="callback"]').click();
  await page.locator('[data-belief="trust"]').click();
  for (const id of ["d1", "d2", "d3", "d4", "d5"]) await page.locator(`#${id}`).check();
  await page.locator("#fh-repair-referral").check();
  await page.locator("#fh-save-next").click();
  await expect.poll(() => posted.length).toBe(1);
  expect(posted[0].client_id).toBe(CLIENT_ID);
  expect(posted[0].outcome).toBe("callback");
  expect(posted[0].transaction_id).toBeUndefined();
  expect(posted[0].belief_failed).toBe("trust");
  expect(posted[0].repair_referral).toBe(true);
  expect(Object.values(posted[0].checklist)).toEqual([true, true, true, true, true]);
});

test("a long client and business name wrap without covering call tools", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await freezeClock(page, NOW);
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    ...handlers,
    "/api/read/closer-call": { ...call, client: { ...call.client, name: "Alexandria Montgomery-Williams", business_name: "Montgomery-Williams Interstate Transportation Services" } }
  });
  await expect(page.locator("#ccp-who-name")).toHaveText("Alexandria Montgomery-Williams");
  expect(await page.locator("main").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
  await expect(page.locator("#fh-pay-link")).toBeVisible();
});

test("an automatically opened booked call names the same client in the shared scope", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, "/app/closer-dashboard.html", CLOSER, {
    ...handlers,
    "/api/read/closer-now": { ok: true, current: { client_id: CLIENT_ID, task_id: "task-1" } }
  });
  await expect(page.locator("#ccp-who-name")).toHaveText("Dana Whitfield");
  await expect(page.locator("#fh-workspace-scope-label")).toHaveText("Dana Whitfield");
  await expect(page.locator("#fh-workspace-header")).toHaveAttribute("data-fh-scope", "selected-client");
  await expect(page.locator("#closer-client-file")).toHaveAttribute("href", `client-control-panel.html?client_id=${CLIENT_ID}`);
});

test("loading, no-call and failed-read states retain the call workspace at phone size", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freezeClock(page, NOW);
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    ...handlers,
    "/api/read/closer-call": async route => {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return json(route, call);
    }
  });
  fs.mkdirSync(evidence, { recursive: true });
  await expect(page.locator("#ccp-who-name")).toHaveText("Loading…");
  await expect(page.locator("#closer-client-file")).toBeHidden();
  await page.screenshot({ path: path.join(evidence, "390-loading.png") });
  await expect(page.locator("#ccp-who-name")).toHaveText("Dana Whitfield");

  await openScreen(page, "/app/closer-dashboard.html", CLOSER, handlers);
  await expect(page.locator("#ccp-who-name")).toHaveText("No call right now");
  await expect(page.locator("#fh-present")).toBeVisible();
  await expect(page.locator("#closer-disposition")).toBeHidden();
  await expect(page.locator("#closer-client-file")).toBeHidden();
  await page.screenshot({ path: path.join(evidence, "390-no-call.png") });

  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    ...handlers,
    "/api/read/closer-call": route => json(route, { ok: false, error: "database is not answering" }, 503)
  });
  await expect(page.locator("#ccp-who-name")).toHaveText("Could not load");
  await expect(page.locator("#fh-data-banner")).toContainText("We could not load this call");
  await expect(page.locator("#fh-pay-link")).toHaveCount(0);
  await expect(page.locator("#closer-client-file")).toBeHidden();
  await page.screenshot({ path: path.join(evidence, "390-error.png") });
});

test("phone calculator inputs retain the server answer and visible guardrails", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, {
    "/api/read/tradelines": (route, { url }) => {
      const draw = Number(new URL(url).searchParams.get("requested_amount")) || 10000;
      return json(route, { ok: true, client_id: CLIENT_ID,
        data: [{ id: "t1", lender: "Chase Ink", account_type: "revolving", credit_limit: 20000, current_balance: 5000 }],
        funding: { totalAvailableCredit: 15000,
          allocation: { requestedAmount: draw, totalDrawn: draw, shortfall: 0,
            draws: [{ lender: "Chase Ink", apr: 0.1899, creditLimit: 20000, currentBalance: 5000, availableHeadroom: 15000, draw }] },
          guardrail: { aggregateUtilization: 0.75, threshold: 0.3, hardStop: true }, payMethodComparison: { horizons: [] } }
      });
    },
    "/api/read/deal-math": (route, { url }) => {
      const p = new URL(url).searchParams;
      const drawn = Number(p.get("drawn"));
      const fees = Number(p.get("deposit")) + drawn * Number(p.get("fee")) / 100;
      return json(route, { ok: true, drawn, fees, debts: Number(p.get("debts")), net: drawn - fees - Number(p.get("debts")), monthly: drawn * Number(p.get("min")) / 100 });
    }
  });
  await page.locator("#paymentCalculator > summary").click();
  await page.locator("#iDraw").fill("12500");
  await page.locator("#iDeposit").fill("3000");
  await page.locator("#iFee").fill("12");
  await page.locator("#iDebts").fill("1000");
  await page.locator("#iMin").fill("4");
  await expect(page.locator("#oNet")).toHaveText("$7,000");
  await expect(page.locator("#oMonthly")).toHaveText("$500 / mo");
  await expect(page.locator("#guardTitle")).toContainText("Hard Stop");
  await expect(page.locator("#cliffTitle")).toContainText("not computed");
  await page.locator("#paymentCalculator").evaluate(el => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(evidence, "390-calculator-open.png") });
  await page.locator("#guardBox").evaluate(el => el.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: path.join(evidence, "390-calculator-results.png") });
  await page.locator("#breakdown > summary").click();
  expect(await page.locator("main").evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
});
