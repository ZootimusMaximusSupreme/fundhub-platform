import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_ID, CLOSER, openScreen, json } from "./harness.mjs";
import { offersForClient } from "../src/config/offers.mjs";
import { formatPromptBlock } from "../src/agents/context.mjs";

// Fixture responses only. No real sessions, customers, sends or provider calls.
const evidence = path.resolve("ops/workflows/build-evidence/blueprint-price-context-2026-10-20");
const context = {
  client: { first_name: "Fixture", last_name: "Blueprint" },
  blueprint: { access_active: true, payment: { status: "succeeded", amount_cents: 750000 },
    contract: { status: "signed", package_fee: "$7,500" }, human_advisor: { name: "Fixture Advisor" } },
  checklist: { open_step: { title: "Upload mailing proof", state: "in_progress", verify_kind: "dispute_mail_receipt" }, open_count: 1 },
  recent_messages: [
    { channel: "sms", status: "queued", direction: "outbound", sender_kind: "agent", sender_agent_code: "COACH", body: "Please upload your mailing proof" },
    { channel: "voice", status: "completed", direction: "outbound", body: "Bland call: client saved the receipt" }
  ],
  recent_calls: [{ outcome: "callback", transcript: "I saved the receipt", notes: "Review upload next", logged_at: "2026-10-20" }],
  open_tasks: [{ title: "Advisor review of mailing proof" }]
};
context.as_prompt_block = formatPromptBlock(context);
const offers = offersForClient();
const deck = { ok: true, survey: { name: "Fixture Blueprint" }, offers, businesses: [],
  engine: { available: false, tier: "REPAIR_ONLY", fico: {}, reasons: [], plan: [] } };

function handlers(writes) {
  return {
    "/api/read/closer-deck": deck,
    "/api/read/agent-context": { ok: true, context },
    "/api/read/closer-call": { ok: true, staff: CLOSER.staff,
      client: { id: CLIENT_ID, name: "Fixture Blueprint", tags: [] },
      credit: {}, deal: {}, precall: {}, offers, up_next: [] },
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/contracts": { ok: true, items: [{ id: "fixture-template", template_key: "CAPITAL-BLUEPRINT-AGREEMENT", name: "Capital Blueprint Agreement", active: true }] },
    "/api/read/tradelines": { ok: true, data: [] },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/contracts": (route) => {
      const body = route.request().postDataJSON();
      writes.push({ url: "/api/contracts", body });
      return json(route, body.action === "create_draft"
        ? { ok: true, contract: { id: "fixture-contract" } }
        : { ok: true, links: [{ url: "/contract/sign?fixture=1" }] });
    },
    "/api/closer-deck": (route) => {
      writes.push({ url: "/api/closer-deck", body: route.request().postDataJSON() });
      return json(route, { ok: true, link: { id: "fixture-link", amount_cents: 750000 } });
    }
  };
}

async function marked(page, locator, filename, caption) {
  await locator.scrollIntoViewIfNeeded();
  await locator.evaluate((element) => { element.style.outline = "3px solid red"; element.setAttribute("data-evidence-mark", "1"); });
  await page.evaluate((text) => {
    const label = document.createElement("div");
    label.id = "evidence-caption";
    label.textContent = text;
    label.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px;background:white;color:#b00000;border:2px solid red;font:12px sans-serif;z-index:2147483647";
    document.body.appendChild(label);
  }, caption);
  fs.mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, filename), fullPage: true });
  await page.evaluate(() => {
    document.getElementById("evidence-caption")?.remove();
    document.querySelectorAll("[data-evidence-mark]").forEach((element) => { element.style.outline = ""; element.removeAttribute("data-evidence-mark"); });
  });
}

for (const width of [1440, 390]) {
  test(`Present ${width}: chosen price/provider reaches agreement and pay link; shared file is visible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes = [];
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await openScreen(page, `/app/present.html?contact=${CLIENT_ID}`, CLOSER, handlers(writes));
    await page.locator('[data-act="phase:06"]').click();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.locator('[data-act="stack-close"]').click();
    const amount = page.locator("#fh-blueprint-amount");
    await expect(amount).toHaveValue("5000");
    await expect(amount).toHaveAttribute("min", "5000");
    await expect(amount).toHaveAttribute("max", "10000");
    expect((await amount.boundingBox()).height).toBeGreaterThanOrEqual(40);
    expect((await page.locator("#fh-blueprint-provider").boundingBox()).height).toBeGreaterThanOrEqual(40);
    await amount.fill("7500");
    await page.locator("#fh-blueprint-provider").selectOption("whop");
    await page.locator("#fh-sale-motion").selectOption("upsell");
    expect(await page.evaluate(() => typeof window.FHContractSend)).toBe("object");
    await page.locator('[data-act="contract"]').click();
    await page.locator('[data-act="more"]').click();
    await expect.poll(() => {
      if (errors.length) throw new Error(errors.join("\n"));
      return writes.filter((w) => w.url === "/api/contracts").length;
    }).toBe(2);
    await page.locator('[data-act="pay"]').click();
    await expect.poll(() => writes.filter((w) => w.url === "/api/closer-deck").length).toBe(1);
    for (const write of writes) expect(write.body.amount_cents).toBe(750000);
    expect(writes.find((w) => w.url === "/api/closer-deck").body.provider).toBe("whop");
    expect(writes[0].body.action).toBe("create_draft");
    expect(writes[1].body.action).toBe("send");
    await expect(page.locator('[data-act="pay"]')).toHaveText("Sent — hold on");
    await expect(page.locator('[data-act="pay"]')).toHaveText("Send pay link", { timeout: 7000 });
    expect(errors).toEqual([]);
    await marked(page, amount.locator(".."), `present-price-${width}-MARKED.png`, "DRAFT FIXTURE: exact $7,500 selected for agreement and Whop pay link; no live send.");
    const shared = page.locator("[data-fh-shared-context]");
    await shared.locator("summary").click();
    await expect(shared).toContainText("Human advisor: Fixture Advisor");
    await expect(shared).toContainText("Bland call: client saved the receipt");
    await expect(shared).toContainText("sms · queued");
    await expect(shared.locator("p").filter({ hasText: "Upload mailing proof" })).toBeVisible();
    const lastTask = shared.locator("p").filter({ hasText: "Advisor review of mailing proof" });
    await lastTask.scrollIntoViewIfNeeded();
    await expect(lastTask).toBeInViewport();
    await shared.locator("[data-fh-context-lines]").evaluate((element) => { element.scrollTop = 0; });
    await marked(page, shared, `present-context-${width}-MARKED.png`, "DRAFT FIXTURE: shared saved progress, real advisor field, queued SMS and completed call words.");
  });

  test(`Closer Dashboard ${width}: same shared progress and conversation are visible`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, handlers([]));
    const shared = page.locator("[data-fh-shared-context]");
    await shared.locator("summary").click();
    for (const text of ["Human advisor: Fixture Advisor", "signed · $7,500", "Upload mailing proof", "sms · queued", "Bland call: client saved the receipt", "I saved the receipt"]) {
      await expect(shared).toContainText(text);
    }
    await expect(shared.locator("[data-fh-context-lines]")).toBeVisible();
    const lines = await shared.locator("[data-fh-context-lines] p").allTextContents();
    expect(lines.join("\n")).toBe(context.as_prompt_block);
    const lastTask = shared.locator("p").filter({ hasText: "Advisor review of mailing proof" });
    await lastTask.scrollIntoViewIfNeeded();
    await expect(lastTask).toBeInViewport();
    await shared.locator("[data-fh-context-lines]").evaluate((element) => { element.scrollTop = 0; });
    await marked(page, shared, `closer-context-${width}-MARKED.png`, "DRAFT FIXTURE: Closer Dashboard reads the same saved AI coach and human advisor file as Present.");
  });
}
