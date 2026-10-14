// Proves two single buttons in the one-page FinanceOS: Setup "Run soft pull" asks
// for the signed approval form and goes there, and Strategy "Save this plan"
// posts the chosen method and monthly amount.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const SETUP = { entry: "frame", tab: "setup", surface: "financeos.html#setup" };
const STRATEGY = { entry: "frame", tab: "strategy", surface: "financeos.html#strategy" };

const setupRead = () => ({
  ok: true, current_step: "soft_pull", setup_fee_cents: 29700, paid_at: "2026-10-01T17:00:00Z", containers: 1,
  steps: [{ key: "pay", done: true }, { key: "soft_pull", done: false }, { key: "accounts", done: false }, { key: "live", done: false }],
  soft_pull: { requested: false, price: { base_cents: 3900, business_addon_cents: 1500 } },
  open_checkout: null,
});

test("Run soft pull posts the request for the client and goes to the approval form", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Run soft pull' button/, async () => {
    const resource = moneyResource("setup", {
      read: setupRead,
      write: () => ({ status: 200, body: { ok: true, approve_url: "/app/soft-pull-approve.html?proof=1" } }),
    });
    const { page, errors } = await open(entryUrl(SETUP.entry, { ...SETUP, clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await page.waitForSelector('[data-act="soft-pull"]');
    await page.locator('[data-act="soft-pull"]').click();
    await waitFor(() => resource.log.posts.length === 1);
    assert.deepEqual(resource.log.posts[0], { action: "request_soft_pull", client_id: CLIENT_ID });
    await page.waitForURL(/\/app\/soft-pull-approve\.html\?proof=1$/);
    assert.deepEqual(errors, []);
    await page.close();
  }, SETUP.surface);
});

test("Save this plan posts the method and the monthly amount that are on screen", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Save this plan' button/, async () => {
    const answer = sampleAnswer("money-strategy.sample.json");
    const resource = moneyResource("strategy", {
      read: () => answer,
      write: () => ({ status: 200, body: { ok: true, saved: { steps: 4 } } }),
    });
    const { page } = await open(entryUrl(STRATEGY.entry, { ...STRATEGY, clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await page.waitForSelector('[data-act="save"]');
    await page.locator('[data-method="utilization"]').click();
    await page.locator("#s-amount").fill("1,000");
    await page.locator("#s-amount").dispatchEvent("input");
    await page.locator('[data-act="save"]').click();
    await waitFor(() => resource.log.posts.length === 1);
    assert.deepEqual(resource.log.posts[0], { action: "save_plan", method: "utilization", monthly_cents: 100000, client_id: CLIENT_ID });
    await page.waitForFunction(() => /Saved\./.test(document.body.innerText));
    await page.close();
  }, STRATEGY.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
