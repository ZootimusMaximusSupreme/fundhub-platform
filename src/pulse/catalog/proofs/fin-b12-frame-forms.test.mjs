// Batch 12 practice tests: three more FinanceOS tab controls that leave no saved result.
//   Accounts: the "Add account" and "Add a business" buttons open their forms.
//   Alerts: "Show all" on a texts-sent list, the jump links, and Try again.
//   Connections: the Copy address and Copy key buttons.
// Practice test means a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact words painted. Nothing here reads live data.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FRAME = (tab) => ({ entry: "frame", tab, surface: `financeos.html#${tab}` });
const alertsFixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, "src/finance/file-alerts/file-alerts.fixture.json"), "utf8"));

// ───────────────────────────── Accounts ─────────────────────────────

test("Accounts: Add account and Add a business open their own forms and put the cursor in them", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Add account' and 'Add a business' buttons that open the forms/, async () => {
    const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
    const read = () => ({
      ok: true, client_id: CLIENT_ID,
      containers: [{ id: BIZ, kind: "business", name: "Fundhub LLC", archived_at: null, business: null, accounts: [], cards: [], loans: [], bills: [] }],
      unassigned: { accounts: [], cards: [], loans: [], bills: [] },
      billing: { containers: 1, price_per_container_cents: null, monthly_cents: null },
    });
    const resource = moneyResource("accounts", { read });
    const { page, errors } = await open(entryUrl("frame", { ...FRAME("accounts"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await page.waitForSelector('[data-act="open-add"]');
    const isOpen = (id) => page.evaluate((i) => document.getElementById(i)?.open === true, id);
    assert.equal(await isOpen("add-account"), false);
    assert.equal(await isOpen("add-business"), false);

    // Add account opens the by-hand account form and leaves the business form shut.
    await page.locator('[data-act="open-add"]').click();
    await page.waitForFunction(() => document.getElementById("add-account")?.open === true);
    assert.equal(await isOpen("add-business"), false, "the other form stays shut");
    assert.equal(await page.evaluate(() => document.activeElement?.closest("#add-account") !== null), true, "the cursor is in the account form");
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("name")), "name");
    assert.equal(await page.locator('#add-account button[type="submit"]').innerText(), "Save account");

    // Add a business opens the business form.
    await page.locator('[data-act="open-business"]').click();
    await page.waitForFunction(() => document.getElementById("add-business")?.open === true);
    assert.equal(await page.evaluate(() => document.activeElement?.closest("#add-business") !== null), true, "the cursor is in the business form");
    assert.match(await page.locator("#add-business summary").innerText(), /Add a business/);
    assert.deepEqual(resource.log.posts, [], "opening a form sends nothing");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── Alerts ─────────────────────────────

const alertsRead = () => alertsFixture();

test("Alerts: Show all lists the newest texts of ITS card only, the jump links land on their own card, and Try again keeps the client", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Show all' on the texts-sent list, jump links, Try again/, async () => {
    // Five texts of one kind (newest first, as the server sends them) and texts of two other kinds, so a
    // card that lists the wrong kind, or the oldest three, or the wrong order, cannot read the same.
    const fixture = () => {
      const d = alertsRead();
      const pay = d.alerts.find((a) => a.kind === "payment_timing");
      const cash = d.alerts.find((a) => a.kind === "cash_reserve");
      const promo = d.alerts.find((a) => a.kind === "promo_end");
      const fives = [0, 1, 2, 3, 4].map((i) => ({ ...pay, id: `pay-${i}`, body: `Pay text number ${i}`, sent_at: `2026-10-1${4 - i}T07:30:00.000Z` }));
      d.alerts = [fives[0], { ...cash, id: "cash-0", body: "Cash text number 0" }, fives[1], { ...promo, id: "promo-0", body: "Promo text number 0" }, fives[2], fives[3], fives[4]];
      // Both cash boxes are below the line, with different amounts, and a card still needs its statement day.
      d.reserve = {
        ...d.reserve,
        personal: { ...d.reserve.personal, state: "below", short_cents: 8557 },
        business: { ...d.reserve.business, state: "below", short_cents: 120000, reason: "below_need" },
      };
      return d;
    };
    const resource = moneyResource("alerts", { read: fixture });
    const { page, errors } = await open(entryUrl("frame", { ...FRAME("alerts"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    const card = page.locator("#fa-k-payment_timing");
    await card.waitFor();
    const more = card.locator('[data-act="more"]');
    const bodies = (kind) => page.locator(`#fa-k-${kind} .sent-item .sent-body`).evaluateAll((els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(await bodies("payment_timing"), ["Pay text number 0", "Pay text number 1", "Pay text number 2"], "the three newest of this kind show first, in order");
    assert.match(await more.innerText(), /^Show all 5 texts$/);
    assert.equal(await more.getAttribute("aria-expanded"), "false");
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll("#fa-k-payment_timing .sent-item").length === 5);
    assert.deepEqual(await bodies("payment_timing"), [0, 1, 2, 3, 4].map((i) => `Pay text number ${i}`), "Show all lists all five, newest first, and no text of another kind");
    assert.match(await more.innerText(), /^Show fewer$/);
    assert.equal(await more.getAttribute("aria-expanded"), "true");
    // The other cards keep their own texts and were not opened.
    assert.deepEqual(await bodies("cash_reserve"), ["Cash text number 0"]);
    assert.deepEqual(await bodies("promo_end"), ["Promo text number 0"]);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll("#fa-k-payment_timing .sent-item").length === 3);
    assert.deepEqual(await bodies("payment_timing"), ["Pay text number 0", "Pay text number 1", "Pay text number 2"], "Show fewer puts the same three back");
    assert.match(await more.innerText(), /^Show all 5 texts$/);

    // The jump links. The page lists what needs you; each "See it" must land on the cash box its own
    // sentence names, and "Add the day" on the day box of the card it names.
    const needs = page.locator(".need-list li");
    const items = await needs.evaluateAll((lis) => lis.map((li) => ({
      text: li.querySelector("span").innerText.trim(),
      label: li.querySelector("button")?.innerText.trim() || null,
      to: li.querySelector("button")?.getAttribute("data-to") || null,
    })));
    const byText = (re) => items.find((i) => re.test(i.text));
    const day = byText(/^Add the statement day for /);
    const personal = byText(/^Personal cash is \$85\.57 short/);
    const business = byText(/^Business cash is \$1,200\.00 short/);
    assert.ok(day && personal && business, `the three needs are listed: ${JSON.stringify(items.map((i) => i.text))}`);
    assert.equal(day.label, "Add the day");
    assert.equal(personal.label, "See it");
    assert.equal(business.label, "See it");
    assert.equal(personal.to, "fa-cash-personal", "the personal sentence jumps to the personal cash box");
    assert.equal(business.to, "fa-cash-business", "the business sentence jumps to the business cash box");
    assert.match(day.to, /^fa-cd-/);
    const press = async (li) => {
      await needs.filter({ hasText: li.text }).locator("button").click();
    };
    await press(personal);
    await page.waitForFunction(() => document.activeElement?.id === "fa-cash-personal");
    assert.match(await page.locator("#fa-cash-personal").innerText(), /Personal cash/i);
    await press(business);
    await page.waitForFunction(() => document.activeElement?.id === "fa-cash-business");
    assert.match(await page.locator("#fa-cash-business").innerText(), /Business cash/i);
    await press(day);
    await page.waitForFunction((id) => document.activeElement?.id === id, day.to);
    // The day box it lands on belongs to the card the sentence names.
    const who = day.text.replace(/^Add the statement day for /, "").replace(/\.$/, "");
    assert.ok((await page.locator(`#${day.to}`).evaluate((el) => el.closest("section, li, div.card, article")?.innerText || "")).includes(who.split(" ending ")[0]),
      "the day box is the named card's");
    assert.deepEqual(errors, []);
    await page.close();

    // Try again: the read fails once, the page says so, and the button reads the same alerts again,
    // for the same client, and the real cards come back.
    const log = { reads: 0, queries: [] };
    const handlers = {
      "/api/money/alerts": async (route, { url }) => {
        log.reads += 1;
        log.queries.push(new URL(url).search);
        return log.reads === 1 ? json(route, { ok: false, error: "server_error" }, 500) : json(route, alertsRead());
      },
    };
    const retry = await open(entryUrl("frame", { ...FRAME("alerts"), clientId: CLIENT_ID }), { session: STAFF, handlers });
    await retry.page.waitForSelector('[data-act="retry"]');
    assert.equal(log.reads, 1);
    await retry.page.locator('[data-act="retry"]').click();
    await waitFor(() => log.reads === 2);
    await retry.page.waitForFunction(() => document.querySelectorAll('[data-act="retry"]').length === 0 && !!document.querySelector('[id^="fa-k-"]'));
    assert.equal(log.reads, 2);
    assert.deepEqual(log.queries, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`], "Try again asks for the same client's file");
    await retry.page.close();
  });
});

// ───────────────────────────── Connections ─────────────────────────────

test("Connections: Copy address and Copy key put the exact text on the clipboard and say Copied", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Copy address \/ Copy key buttons/, async () => {
    const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";
    const HOOK = "https://fundhub.ai/api/webhooks/merchant-whop/2977d1c3-af5f-4f76-b2a2-b4adc9732486";
    const read = () => {
      const a = sampleAnswer("money-connections.sample.json");
      a.open_api_url = "https://fundhub.ai/api/merchant/events";
      return a;
    };
    const resource = moneyResource("connections", {
      read,
      write: (body) => (body.action === "create"
        ? { status: 201, body: { ok: true, connection: { id: "09ee1b4f-0581-45a1-9fca-a33ef9671881" }, api_key: "shown-once-key-value" } }
        : { status: 200, body: { ok: true } }),
    });
    const init = () => {
      window.__copied = [];
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text) => { window.__copied.push(String(text)); return Promise.resolve(); } } });
    };
    const { page, errors } = await open(entryUrl("frame", { ...FRAME("connections"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers, init });
    await page.waitForSelector('[data-act="copy"]');
    const copied = () => page.evaluate(() => window.__copied.slice());

    // Webhook address of a Whop connection.
    const webhook = page.locator(`.copyrow:has(code:text-is("${HOOK}")) [data-act="copy"]`);
    assert.equal(await webhook.innerText(), "Copy address");
    const webhookHandle = await webhook.elementHandle();
    await webhook.click();
    await page.waitForFunction(() => window.__copied.length === 1);
    assert.deepEqual(await copied(), [HOOK]);
    await page.waitForFunction((el) => el.textContent === "Copied", webhookHandle);
    await page.waitForFunction((el) => el.textContent === "Copy address", webhookHandle, { timeout: 5000 });

    // The open API address of the Open API connection.
    const open_ = page.locator('.copyrow:has(code:text-is("https://fundhub.ai/api/merchant/events")) [data-act="copy"]').first();
    await open_.click();
    await page.waitForFunction(() => window.__copied.length === 2);
    assert.equal((await copied())[1], "https://fundhub.ai/api/merchant/events");

    // Make a new Open API connection: the key is shown once, with Copy key and Copy address.
    await page.locator('[data-act="create"][data-provider="api"]').click();
    await waitFor(() => resource.log.posts.some((p) => p.action === "create" && p.provider === "api"));
    const key = page.locator('.once [data-act="copy"]:has-text("Copy key")');
    await key.waitFor();
    assert.match(await page.locator(".once").innerText(), /shown this one time/);
    const keyHandle = await key.elementHandle();
    await key.click();
    await page.waitForFunction(() => window.__copied.length === 3);
    assert.equal((await copied())[2], "shown-once-key-value");
    await page.waitForFunction((el) => el.textContent === "Copied", keyHandle);
    const addr = page.locator('.once [data-act="copy"]:has-text("Copy address")');
    await addr.click();
    await page.waitForFunction(() => window.__copied.length === 4);
    assert.equal((await copied())[3], "https://fundhub.ai/api/merchant/events");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
