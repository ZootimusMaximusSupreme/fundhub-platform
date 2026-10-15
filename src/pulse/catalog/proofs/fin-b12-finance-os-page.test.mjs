// Batch 12 practice test: the Paydown simulator result block on finance-os.html.
// Practice test means a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact request the page sends and the words and numbers it paints. Nothing here reads live data.
//
// The fake server answer is the REAL simulator (src/blueprint/paydown-simulator.mjs) run over a fake
// client, so every number the page paints is one the product's own math produced.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT_ID, waitFor } from "./s4-money-harness.mjs";
import { simulatePaydownFromClientDict } from "../../../blueprint/paydown-simulator.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);

// A fake client: two open cards over their target, a pre-approval of $4,000 today and $12,000 once both are paid.
const FAKE_CLIENT = {
  preapproval_now: 4000,
  preapproval_after: 12000,
  revolving: [["Big Card", "Experian", 5000, 500, "90%", "$4,500"], ["Small Card", "Experian", 1200, 300, "80%", "$900"]],
};
const answerFor = (cash) => ({ ok: true, entitled: true, subscriptionId: "sub-1", ...simulatePaydownFromClientDict(FAKE_CLIENT, cash) });

/** finance-os.html for one client with every read the page makes answered with something plain. */
async function openFinanceOs(open, { simulator }) {
  const posts = [];
  const handlers = {
    "/api/dashboard/clients": (route) => json(route, { ok: true, clients: [{ id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" }] }),
    "/api/dashboard/client": (route) => json(route, { ok: true, client: { id: CLIENT_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com" }, transactions: [], crs_results: [], messages: [], tasks: [] }),
    "/api/read/finance-os": (route) => json(route, { ok: true, rows: [], lines: 0 }),
    "/api/finance/bank-accounts": (route) => json(route, { ok: true, accounts: [] }),
    "/api/finance/bills": (route) => json(route, { ok: true, bills: [] }),
    "/api/read/finance-os-suggestions": (route) => json(route, { ok: true, suggestions: [] }),
    "/api/finance/paydown-simulator": async (route) => {
      const body = bodyOf(route);
      posts.push(body);
      const out = await simulator(body);
      return json(route, out.body, out.status);
    },
  };
  const { page, errors } = await open(`/app/finance-os.html?client_id=${CLIENT_ID}`, { session: OWNER, handlers });
  await page.waitForSelector("#fosSimForm");
  return { page, errors, posts };
}

const resultText = (page) => page.locator("#fosSimOut").innerText();

test("Paydown simulator: the result block shows today's pre-approval, the estimate after, and each card's split", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Paydown simulator result block/, async () => {
    const { page, posts, errors } = await openFinanceOs(open, { simulator: (body) => ({ status: 200, body: answerFor(body.cash_on_hand) }) });

    // Before any press: the empty words, and no number.
    assert.match(await resultText(page), /Type how much cash this client can put toward their cards/);

    // $600 against two cards that need $800 together: partial. The page sends only the client and the typed cash.
    await page.locator("#fosSimCash").fill("$600");
    await page.locator("#fosSimGo").click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0], { client_id: CLIENT_ID, cash_on_hand: 600 }, "the typed cash is parsed to a plain number and sent with the client");
    await page.waitForFunction(() => document.querySelectorAll("#fosSimOut .fos-ba").length === 1);
    const server = answerFor(600);
    assert.equal(server.preapprovalProjected, 10000, "the real math: 4,000 + 8,000 x 600/800");
    const block = await resultText(page);
    // Pre-approval today and the estimate after, with the difference in words.
    const ba = await page.locator("#fosSimOut .fos-ba").innerText();
    assert.match(ba, /Pre-approval today\s+\$4,000\.00/);
    assert.match(ba, /Estimated after this cash\s+\$10,000\.00/);
    assert.match(ba, /\+\$6,000\.00 vs today/);
    // The rows: cash typed, cash used, cash left, what every card needs, and the full-paydown figure.
    assert.match(block, /Cash entered[\s\S]*\$600\.00/);
    assert.match(block, /Cash put on cards\s+2 cards[\s\S]*\$600\.00/);
    assert.match(block, /Cash left over[\s\S]*\$0\.00/);
    assert.match(block, /Paydown for every card to reach its target[\s\S]*\$800\.00/);
    assert.match(block, /Pre-approval once every card reaches its target[\s\S]*\$12,000\.00/);
    // The per-card split: each card, what it is paid, and balance now to target.
    const rows = await page.locator("#fosSimOut .alloc").allInnerTexts();
    const flat = rows.map((r) => r.replace(/\s+/g, " ").trim());
    assert.ok(flat.some((r) => /Big Card.*\$500\.00.*\$5,000\.00 → \$500\.00/.test(r)), `Big Card row in ${JSON.stringify(flat)}`);
    assert.ok(flat.some((r) => /Small Card.*\$100\.00.*\$1,200\.00 → \$300\.00/.test(r)), `Small Card row in ${JSON.stringify(flat)}`);
    assert.match(block, /not a lender’s answer/);

    // More cash than the cards need: the extra is left over and the estimate reaches the full figure.
    await page.locator("#fosSimCash").fill("3,000.50");
    await page.locator("#fosSimGo").click();
    await waitFor(() => posts.length === 2);
    assert.deepEqual(posts[1], { client_id: CLIENT_ID, cash_on_hand: 3000.5 });
    await page.waitForFunction(() => /Cash left over[\s\S]*\$2,200\.50/.test(document.querySelector("#fosSimOut")?.innerText || ""));
    assert.match(await page.locator("#fosSimOut .fos-ba").innerText(), /Estimated after this cash\s+\$12,000\.00/);
    assert.match(await resultText(page), /no card needs more to reach its target/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Paydown simulator: a bad number is refused before sending, and the server's refusals are said in words", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Paydown simulator result block/, async () => {
    const mode = { value: "ok" };
    const { page, posts } = await openFinanceOs(open, {
      simulator: () => {
        if (mode.value === "no-report") return { status: 200, body: { ok: true, entitled: true, hasPull: false } };
        if (mode.value === "not-entitled") return { status: 403, body: { ok: false, error: "not_entitled", entitled: false, reason: "no_subscription" } };
        return { status: 200, body: answerFor(0) };
      },
    });
    // Not a number: told in words, nothing sent.
    await page.locator("#fosSimCash").fill("abc");
    await page.locator("#fosSimGo").click();
    await page.waitForFunction(() => /Type the cash as a plain number/.test(document.querySelector("#fosSimMsg")?.innerText || ""));
    assert.deepEqual(posts, []);
    // No credit report on file.
    mode.value = "no-report";
    await page.locator("#fosSimCash").fill("500");
    await page.locator("#fosSimGo").click();
    await page.waitForFunction(() => /no credit report on file for this client yet/.test(document.querySelector("#fosSimOut")?.innerText || ""));
    assert.equal(await page.locator("#fosSimOut .fos-ba").count(), 0, "no before-and-after block without a report");
    // No Finance OS subscription.
    mode.value = "not-entitled";
    await page.locator("#fosSimGo").click();
    await page.waitForFunction(() => /does not have an active Finance OS subscription/.test(document.querySelector("#fosSimMsg")?.innerText || ""));
    assert.equal((await resultText(page)).trim(), "", "the old result is cleared when the answer is a refusal");
    // Zero cash: no card is paid and the page says so, rather than painting a made-up split.
    mode.value = "ok";
    await page.locator("#fosSimCash").fill("0");
    await page.locator("#fosSimGo").click();
    await page.waitForFunction(() => /No cash was entered, so no card is paid down\./.test(document.querySelector("#fosSimOut")?.innerText || ""));
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
