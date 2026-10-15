// Batch 12 practice tests: the FinanceOS Plan and Strategy tabs, and the Money moves "Go back".
// Practice test means a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact request and the words painted. Nothing here reads live data.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);
const FRAME = (tab) => ({ entry: "frame", tab, surface: `financeos.html#${tab}` });

// ───────────────────────────── Plan ─────────────────────────────

const planRead = () => sampleAnswer("money-plan.sample.json");

/** The plan read for any month: the pins of the sample, moved into the asked month when it differs. */
function planByMonth() {
  const log = { months: [] };
  const handler = async (route, { url }) => {
    const month = new URL(url).searchParams.get("month");
    log.months.push(month);
    const answer = planRead();
    if (month && month !== answer.month) {
      const [y, m] = month.split("-").map(Number);
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
      answer.month = month;
      answer.from = `${month}-01`;
      answer.to = `${month}-${String(last).padStart(2, "0")}`;
      answer.days = Array.from({ length: last }, (_, i) => {
        const date = `${month}-${String(i + 1).padStart(2, "0")}`;
        return { date, weekday: ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1, is_today: date === answer.today };
      });
      answer.pins = [];
    }
    return json(route, answer);
  };
  return { log, handlers: { "/api/money/plan": handler } };
}

async function openPlan(open, { session = STAFF, read = planRead } = {}) {
  const resource = moneyResource("plan", { read });
  const opened = await open(entryUrl("frame", { ...FRAME("plan"), clientId: session === CLIENT ? "" : CLIENT_ID }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-plan .cal-grid");
  return { ...opened, ...resource.log };
}

test("Plan: a pin opens its panel, the panel closes with Close and Esc, and Tab stays inside", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^A pin \(calendar chip or list row\) opens its detail panel/, async () => {
    const answer = planRead();
    const pin = answer.pins[0];
    const { page, errors } = await openPlan(open);
    // A calendar chip opens the panel for that pin: title, day, amount, where it came from.
    await page.locator(`.cal-grid .pin[data-pin="${pin.id}"]`).click();
    await page.waitForSelector(".pl-drawer");
    const text = await page.locator(".pl-drawer").innerText();
    assert.ok(text.includes(pin.title), "the panel names the pin");
    assert.match(text, /\$1,050\.00/, "the panel shows the amount in dollars");
    assert.match(await page.locator(".pl-drawer").getAttribute("aria-modal"), /true/);
    assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "Close", "focus moves to Close");

    // Tab and Shift+Tab never leave the panel.
    const stays = () => page.evaluate(() => !!document.activeElement?.closest(".pl-drawer"));
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await stays(), true, `Tab ${i + 1} stays inside the panel`);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await stays(), true, `Shift+Tab ${i + 1} stays inside the panel`);
    }

    // Esc closes it and puts focus back on the chip that opened it.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".pl-drawer"));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-pin")), pin.id);

    // A list row opens the same panel; Close closes it.
    await page.locator(`.plan-list .row[data-pin="${pin.id}"]`).click();
    await page.waitForSelector(".pl-drawer");
    assert.ok((await page.locator(".pl-drawer").innerText()).includes(pin.title));
    await page.locator('.pl-drawer [data-act="close"]').first().click();
    await page.waitForFunction(() => !document.querySelector(".pl-drawer"));
    assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("row")), true);

    // "+N more": a day with more pins than fit shows the button, and it jumps to that day in the list.
    const crowded = () => {
      const a = planRead();
      const base = a.pins[0];
      a.pins = [...a.pins, ...[1, 2, 3, 4].map((n) => ({ ...base, id: `extra-${n}`, title: `Extra ${n}`, source: "dues", can_mark: [] }))];
      return a;
    };
    const more = await openPlan(open, { read: crowded });
    const button = more.page.locator('.cal-grid button.more[data-act="day"]').first();
    await button.waitFor();
    assert.match(await button.innerText(), /^\+\d+ more$/);
    const day = await button.getAttribute("data-day");
    await button.click();
    await more.page.waitForFunction((d) => document.activeElement?.closest(`[data-day-row="${d}"]`) !== null, day);
    await more.page.close();
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Plan: the month buttons ask for the month before, the month after and today's month", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Previous month \/ Next month \/ Today buttons/, async () => {
    const fake = planByMonth();
    const { page } = await open(entryUrl("frame", { ...FRAME("plan"), clientId: CLIENT_ID }), { session: STAFF, handlers: fake.handlers });
    await page.waitForSelector("#pl-month");
    assert.match(await page.locator("#pl-month").innerText(), /October 2026/);
    assert.equal(await page.locator('.month-nav [data-month]:has-text("Today")').count(), 0, "no Today button on this month");
    const heading = () => page.locator("#pl-month").innerText();
    await page.locator('button[aria-label^="Next month"]').click();
    await page.waitForFunction(() => /November 2026/.test(document.querySelector("#pl-month")?.innerText || ""));
    assert.equal(fake.log.months.at(-1), "2026-11");
    await page.locator('button[aria-label^="Next month"]').click();
    await page.waitForFunction(() => /December 2026/.test(document.querySelector("#pl-month")?.innerText || ""));
    assert.equal(fake.log.months.at(-1), "2026-12");
    await page.locator('button[aria-label^="Previous month"]').click();
    await page.waitForFunction(() => /November 2026/.test(document.querySelector("#pl-month")?.innerText || ""));
    assert.equal(fake.log.months.at(-1), "2026-11");
    // Today is back to the month that holds today.
    const today = page.locator('.month-nav [data-act="month"]:has-text("Today")');
    await today.waitFor();
    assert.equal(await today.getAttribute("data-month"), "2026-10");
    await today.click();
    await page.waitForFunction(() => /October 2026/.test(document.querySelector("#pl-month")?.innerText || ""));
    assert.equal(fake.log.months.at(-1), "2026-10");
    assert.match(await heading(), /October 2026/);
    await page.close();
  });
});

test("Plan: the empty state offers Add an account and a pin's source link opens Payments", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Link: 'Add an account' \(empty state\), 'See it on Payments'/, async () => {
    const payments = (route) => json(route, sampleAnswer("money-payments.sample.json"));
    const accounts = (route) => json(route, { ok: true, client_id: CLIENT_ID, containers: [], unassigned: { accounts: [], cards: [], loans: [], bills: [] }, billing: {} });
    // Empty month: the link goes to the Accounts tab.
    const empty = () => ({ ...planRead(), pins: [] });
    const a = await open(entryUrl("frame", { ...FRAME("plan"), clientId: CLIENT_ID }), {
      session: STAFF, handlers: { "/api/money/plan": (route) => json(route, empty()), "/api/money/accounts": accounts, "/api/money/payments": payments },
    });
    const add = a.page.locator('a:has-text("Add an account")');
    await add.waitFor();
    assert.equal(await add.getAttribute("href"), `money-accounts.html?client_id=${CLIENT_ID}`);
    await add.click();
    await a.page.waitForFunction(() => location.hash === "#accounts");
    await a.page.close();

    // A pin that came from Clarity shows "See it on Payments" in its panel, and the link opens that tab.
    const withClarity = () => {
      const answer = planRead();
      answer.pins[0] = { ...answer.pins[0], source: "clarity", can_mark: [] };
      return answer;
    };
    const b = await open(entryUrl("frame", { ...FRAME("plan"), clientId: CLIENT_ID }), {
      session: STAFF, handlers: { "/api/money/plan": (route) => json(route, withClarity()), "/api/money/accounts": accounts, "/api/money/payments": payments },
    });
    await b.page.waitForSelector(".cal-grid");
    await b.page.locator(`.cal-grid .pin[data-pin="${planRead().pins[0].id}"]`).click();
    const link = b.page.locator('.pl-drawer a:has-text("See it on Payments")');
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), `money-payments.html?client_id=${CLIENT_ID}`);
    await link.click();
    await b.page.waitForFunction(() => location.hash === "#payments");
    await b.page.close();
  });
});

// ───────────────────────────── Strategy ─────────────────────────────

test("Strategy: the method buttons, the amount slider and box, the goal, the Use buttons and Show more months", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Method buttons \(highest rate first, card use first, smallest balance first\)/, async () => {
    const answer = sampleAnswer("money-strategy.sample.json");
    const resource = moneyResource("strategy", { read: () => answer });
    const { page, errors } = await open(entryUrl("frame", { ...FRAME("strategy"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await page.waitForSelector('[data-act="save"]');

    // The three method buttons: one is pressed at a time, the note under them says what it does, and
    // the order the plan pays the debts in changes with the method.
    const pressed = () => page.evaluate(() => [...document.querySelectorAll("[data-method]")]
      .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.getAttribute("data-method")));
    const payOrder = () => page.evaluate(() => [...document.querySelectorAll(".debts-card tbody tr")]
      .map((r) => r.children[1].innerText.trim().replace(/\s+(Personal|Business)$/, "")));
    const labels = (await page.locator("[data-method]").allInnerTexts()).map((s) => s.trim());
    assert.deepEqual(labels, ["Highest rate first", "Card use first", "Smallest balance first"]);
    const ORDER = {
      utilization: ["Business Amex", "Sample Chase Ink", "Personal Visa", "SBA Loan"],
      snowball: ["Personal Visa", "Sample Chase Ink", "Business Amex", "SBA Loan"],
      avalanche: ["Personal Visa", "Business Amex", "Sample Chase Ink", "SBA Loan"],
    };
    for (const key of ["utilization", "snowball", "avalanche"]) {
      await page.locator(`[data-method="${key}"]`).click();
      assert.deepEqual(await pressed(), [key]);
      await page.waitForFunction((detail) => document.querySelector('[data-slot="method-note"]')?.innerText.trim() === detail,
        answer.methods[key].detail);
      await page.waitForFunction((first) => document.querySelector(".debts-card tbody tr")?.children[1].innerText.startsWith(first), ORDER[key][0]);
      assert.deepEqual(await payOrder(), ORDER[key], `${key}: the debts are paid in this order`);
    }

    // The slider and the box are one number: moving one moves the other.
    const box = page.locator("#s-amount");
    const range = page.locator("#s-range");
    await box.fill("1,500");
    await box.dispatchEvent("input");
    await page.waitForFunction(() => Number(document.querySelector("#s-range").value) === 150000);
    await range.evaluate((el) => { el.value = "200000"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.waitForFunction(() => document.querySelector("#s-amount").value === "2,000.00");
    // A box nobody can read goes back to the last good number when you leave it.
    await box.fill("abc");
    await box.dispatchEvent("change");
    await page.waitForFunction(() => document.querySelector("#s-amount").value === "2,000.00");

    // The goal select shows its date box only when a goal is picked, and a goal changes the answer.
    const date = page.locator("#s-goal-by");
    const goalNote = () => page.locator('[data-slot="goal-note"]').innerText();
    assert.equal(await date.isHidden(), true, "no goal, no date box");
    await page.locator("#s-goal").selectOption("debt_free");
    assert.equal(await date.isVisible(), true);
    await date.fill("2027-12-31");
    await date.dispatchEvent("input");
    await page.waitForFunction(() => /2027/.test(document.querySelector('[data-slot="goal-note"]')?.innerText || ""));
    assert.notEqual(await goalNote(), "", "a goal with a date gets a sentence");
    await page.locator("#s-goal").selectOption("");
    assert.equal(await date.isHidden(), true, "No goal hides the date box again");

    // A number under the minimums is refused in words, and the Use button puts the minimum in the box.
    await box.fill("1");
    await box.dispatchEvent("input");
    const use = page.locator('[data-act="use-amount"]');
    await use.waitFor();
    assert.match(await page.locator('[data-slot="results"]').innerText(), /less than the minimum payments \(\$1,225\.00 a month\)/);
    assert.equal(await use.getAttribute("data-cents"), "122500");
    await use.click();
    await page.waitForFunction(() => document.querySelector("#s-amount").value === "1,225.00");
    await page.waitForFunction(() => document.querySelectorAll('[data-act="use-amount"]').length === 0);
    assert.doesNotMatch(await page.locator('[data-slot="results"]').innerText(), /less than the minimum/);

    // Show more months: the month table lists 24 at a time and the button brings the next 24.
    const rows = () => page.locator(".months-card tbody tr").count();
    assert.equal(await rows(), 24);
    await page.locator(".months-card summary").click();
    const more = page.locator('[data-act="more-months"]');
    assert.match(await more.innerText(), /^Show \d+ more months$/);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll(".months-card tbody tr").length > 24);
    assert.ok((await rows()) > 24 && (await rows()) <= 48, "the next page of months was added");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────────── Money moves: Go back ─────────────────────────────

test("Money moves: Review this move opens the question and Go back cancels it without sending anything", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Go back \(cancels the review step\)/, async () => {
    // Two cases: one account to send from (fixed words and a hidden id) and a choice of accounts (a picker that is held while asked).
    const withChoice = () => {
      const a = sampleAnswer("money-transfers.sample.json");
      a.accounts = [...a.accounts, { ...a.accounts[0], id: "3d2b0b9a-1111-4222-8333-444455556666", label: "Savings ••3303" }];
      return a;
    };
    for (const [read, picker] of [[() => sampleAnswer("money-transfers.sample.json"), false], [withChoice, true]]) {
      const resource = moneyResource("transfers", { read });
      const { page } = await open(entryUrl("frame", { ...FRAME("transfers"), clientId: "" }), { session: CLIENT, handlers: resource.handlers });
      const form = page.locator('form[data-form="approve"]').first();
      await form.waitFor();
      const review = form.locator('[data-act="review"]');
      const confirm = form.locator(".confirm");
      const from = form.locator('select[name="from_account_id"]');
      assert.equal(await from.count(), picker ? 1 : 0);
      assert.equal(await confirm.isHidden(), true, "the question is not asked yet");
      await review.click();
      await confirm.waitFor({ state: "visible" });
      assert.match(await confirm.locator('[data-role="sentence"]').innerText(), /^Move \$2,000\.00 from .* to Business Checking .*2202 on /);
      assert.equal(await review.isHidden(), true, "the Review button steps aside");
      if (picker) assert.equal(await from.isDisabled(), true, "the From account is held while you are asked");
      // Go back: the question closes, the button comes back, the account can be changed, nothing was sent.
      await form.locator('[data-act="back"]').click();
      await confirm.waitFor({ state: "hidden" });
      assert.equal(await review.isVisible(), true);
      if (picker) assert.equal(await from.isDisabled(), false);
      assert.deepEqual(resource.log.posts, [], "Go back sends nothing");
      // Review again still works after a Go back, and going back again still sends nothing.
      await review.click();
      await confirm.waitFor({ state: "visible" });
      await form.locator('[data-act="back"]').click();
      await confirm.waitFor({ state: "hidden" });
      assert.deepEqual(resource.log.posts, []);
      await page.close();
    }
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
