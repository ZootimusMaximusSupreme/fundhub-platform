// Batch 12 practice tests: the FinanceOS Plan and Strategy tabs, and the Money moves "Go back".
// Practice test means a real page in Chromium, fake /api answers, one click, and a judgement of the
// exact request and the words painted. Nothing here reads live data.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";
// The plan math the page runs is one shared file (the server runs the same one), so the test asks it for
// the answer to each choice and judges the words and numbers the page paints against that answer.
import * as MATH from "../../../../public/app/money-strategy-math.js";

const proof = proofRows(import.meta.url);
const FRAME = (tab) => ({ entry: "frame", tab, surface: `financeos.html#${tab}` });

// ───────────────────────────── Plan ─────────────────────────────

const planRead = () => sampleAnswer("money-plan.sample.json");

async function openPlanTab(page, { calendar = false } = {}) {
  const tab = page.locator("#tab-plan");
  await tab.waitFor({ state: "attached" });
  await tab.click();
  await page.waitForFunction(() => location.hash === "#plan"
    && document.querySelector("#tab-plan")?.getAttribute("aria-selected") === "true"
    && document.querySelector("#fos-plan")?.hidden === false);
  if (!calendar) return;
  const details = page.locator("#fos-plan details.plan-calendar");
  await details.waitFor({ state: "attached" });
  if (!(await details.evaluate((node) => node.open))) await details.locator(":scope > summary").click();
  await page.waitForSelector("#fos-plan .fh-plan .cal-grid");
}

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
  await openPlanTab(opened.page, { calendar: true });
  return { ...opened, ...resource.log };
}

/** The words a pin's panel should show, worked out here from the saved shape, not copied from the page. */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${MONTH_NAMES[m - 1]} ${d}, ${y}`;
};
const dollars = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SOURCE_WORDS = { dues: "Card and loan due dates", clarity: "Payments to Fundhub", waypoints: "Your checklist" };
const statusWord = (pin, today) => (pin.status === "done" ? "Done" : pin.status === "missed" ? "Missed" : pin.date < today ? "Not recorded" : "Planned");
const KIND_WORDS = { due: "Payment due", open_account: "Open an account", deposit: "Deposit", pay_down: "Pay down", apply: "Apply", checkpoint: "Checklist step", other: "Step" };

test("Plan: every pin opens its own panel, the panel closes with Close and Esc, Tab stays inside, and +N more goes to its day", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^A pin \(calendar chip or list row\) opens its detail panel/, async () => {
    const answer = planRead();
    const containers = new Map(answer.containers.map((c) => [c.id, c.name]));
    const { page, errors } = await openPlan(open);

    // Every pin, from the calendar chip and again from its list row, opens ITS panel: title, day,
    // amount, status, the bank, whose box it is for, and where it came from. A page that always
    // opens the first pin, or shows today's date, or one fixed source word, goes red here.
    const check = async (pin, how) => {
      const drawer = page.locator(".pl-drawer");
      await drawer.waitFor();
      const label = `${how} ${pin.id}`;
      assert.equal((await drawer.locator("h2").innerText()).trim(), pin.title, `${label}: its own title`);
      assert.equal((await drawer.locator(".pl-when").innerText()).trim(), longDate(pin.date), `${label}: its own day`);
      assert.equal((await drawer.locator(".pl-kind").textContent()).trim(), KIND_WORDS[pin.kind], `${label}: its kind`);
      const facts = Object.fromEntries(await drawer.locator("dl.facts > div").evaluateAll((rows) => rows.map((r) => [r.querySelector("dt").innerText.trim(), r.querySelector("dd").innerText.trim()])));
      assert.equal(facts.Amount, pin.amount_cents == null ? "Not known yet" : dollars(pin.amount_cents), `${label}: its own amount`);
      assert.equal(facts.Status, statusWord(pin, answer.today), `${label}: its own status`);
      assert.equal(facts.Bank, pin.bank || undefined, `${label}: its bank`);
      assert.equal(facts.For, containers.get(pin.container_id) || undefined, `${label}: whose box it is for`);
      assert.match(await drawer.locator("p.caption").last().innerText(), new RegExp(`^From: ${SOURCE_WORDS[pin.source]}`), `${label}: where it came from`);
      if (pin.detail) assert.ok((await drawer.locator(".pl-why").innerText()).includes(pin.detail), `${label}: why`);
      assert.match(await drawer.getAttribute("aria-modal"), /true/);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent.trim()), "Close", `${label}: focus moves to Close`);
    };
    for (const pin of answer.pins) {
      await openPlanTab(page, { calendar: true });
      await page.locator(`.cal-grid .pin[data-pin="${pin.id}"]`).click();
      await check(pin, "chip");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".pl-drawer"));
    }
    // The shipped calendar folds after a panel repaint, so prove exact Escape focus return from the
    // matching visible list row. Close gets the same exact check for every row below.
    const escapePin = answer.pins[0];
    await page.locator(`.plan-list .row[data-pin="${escapePin.id}"]`).click();
    await check(escapePin, "row");
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".pl-drawer"));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-pin")), escapePin.id, "Esc puts focus back on the row that opened it");
    for (const pin of [...answer.pins].reverse()) {
      await page.locator(`.plan-list .row[data-pin="${pin.id}"]`).click();
      await check(pin, "row");
      await page.locator('.pl-drawer [data-act="close"]').first().click();
      await page.waitForFunction(() => !document.querySelector(".pl-drawer"));
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-pin")), pin.id, "Close puts focus back on the row that opened it");
    }

    // Tab and Shift+Tab never leave an open panel.
    await page.locator(`.plan-list .row[data-pin="${answer.pins[1].id}"]`).click();
    await page.waitForSelector(".pl-drawer");
    const stays = () => page.evaluate(() => !!document.activeElement?.closest(".pl-drawer"));
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      assert.equal(await stays(), true, `Tab ${i + 1} stays inside the panel`);
    }
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Shift+Tab");
      assert.equal(await stays(), true, `Shift+Tab ${i + 1} stays inside the panel`);
    }
    // Clicking outside the panel (the scrim) closes it too.
    await page.locator(".pl-scrim").click({ position: { x: 5, y: 5 } });
    await page.waitForFunction(() => !document.querySelector(".pl-drawer"));

    // "+N more": a day that is NOT the first day on the list holds five pins. The cell shows the first
    // two, the button says exactly how many are left, and it jumps to THAT day's row in the list.
    const crowded = () => {
      const a = planRead();
      const base = a.pins.find((p) => p.date === "2026-10-15");
      a.pins = [...a.pins, ...[1, 2, 3, 4].map((n) => ({ ...base, id: `extra-${n}`, title: `Extra ${n}`, source: "dues", can_mark: [] }))];
      return a;
    };
    const day = "2026-10-15";
    const wantPins = crowded().pins.filter((p) => p.date === day);
    assert.equal(wantPins.length, 5);
    const more = await openPlan(open, { read: crowded });
    const cell = more.page.locator(`.cal-grid td:has(button.more[data-day="${day}"])`);
    await cell.waitFor();
    assert.equal(await more.page.locator("button.more").count(), 1, "only the crowded day has the button");
    assert.deepEqual(await cell.locator(".pin").evaluateAll((els) => els.map((e) => e.getAttribute("data-pin"))),
      wantPins.slice(0, 2).map((p) => p.id), "the cell shows the first two pins of the day");
    assert.equal((await cell.locator("button.more").innerText()).trim(), `+${wantPins.length - 2} more`, "the button counts the pins left out");
    // The list holds all five under that day's own row, and that row is not the first one.
    const rowsOfDay = await more.page.locator(`[data-day-row="${day}"] .rows .row`).evaluateAll((els) => els.map((e) => e.getAttribute("data-pin")));
    assert.deepEqual(rowsOfDay, wantPins.map((p) => p.id));
    assert.notEqual(await more.page.locator(".plan-list .day").first().getAttribute("data-day-row"), day, "the crowded day is not the first day on the list");
    await cell.locator("button.more").click();
    await more.page.waitForFunction((d) => document.activeElement?.matches(".day-h") && document.activeElement.closest(`[data-day-row="${d}"]`) !== null, day);
    assert.match(await more.page.evaluate(() => document.activeElement.textContent), /Thu, Oct 15/, "focus is on that day's heading");
    await more.page.close();
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Plan: the month buttons ask for the month before, the month after and today's month, across the year end", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Previous month \/ Next month \/ Today buttons/, async () => {
    const fake = planByMonth();
    const { page } = await open(entryUrl("frame", { ...FRAME("plan"), clientId: CLIENT_ID }), { session: STAFF, handlers: fake.handlers });
    await openPlanTab(page);
    await page.waitForSelector("#pl-month");
    const heading = () => page.locator("#pl-month").innerText();
    assert.match(await heading(), /October 2026/);
    assert.equal(await page.locator('.month-nav [data-month]:has-text("Today")').count(), 0, "no Today button on this month");
    // The button words say the neighbouring months.
    assert.match(await page.locator('button[aria-label^="Previous month"]').getAttribute("aria-label"), /September 2026/);
    assert.match(await page.locator('button[aria-label^="Next month"]').getAttribute("aria-label"), /November 2026/);
    const go = async (button, month, words) => {
      await page.locator(button).click();
      await page.waitForFunction((w) => (document.querySelector("#pl-month")?.innerText || "").includes(w), words);
      assert.equal(fake.log.months.at(-1), month, `the page asked for ${month}`);
      assert.equal((await heading()).trim(), words);
    };
    // Forward across the year end: Oct, Nov, Dec, then Jan of the NEXT year.
    await go('button[aria-label^="Next month"]', "2026-11", "November 2026");
    await go('button[aria-label^="Next month"]', "2026-12", "December 2026");
    await go('button[aria-label^="Next month"]', "2027-01", "January 2027");
    // The neighbours of January say December before it and February after it.
    assert.match(await page.locator('button[aria-label^="Previous month"]').getAttribute("aria-label"), /December 2026/);
    assert.match(await page.locator('button[aria-label^="Next month"]').getAttribute("aria-label"), /February 2027/);
    // Back across the year end: January goes to December of the year before.
    await go('button[aria-label^="Previous month"]', "2026-12", "December 2026");
    await go('button[aria-label^="Previous month"]', "2026-11", "November 2026");
    // Today comes back to the month that holds today, from any month, and then goes away.
    const today = page.locator('.month-nav [data-act="month"]:has-text("Today")');
    await today.waitFor();
    assert.equal(await today.getAttribute("data-month"), "2026-10");
    await go('.month-nav [data-act="month"]:has-text("Today")', "2026-10", "October 2026");
    assert.equal(await page.locator('.month-nav [data-month]:has-text("Today")').count(), 0, "no Today button once back on this month");
    // And backwards across January from the far side: Previous from October goes to September.
    await go('button[aria-label^="Previous month"]', "2026-09", "September 2026");
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
    await openPlanTab(a.page);
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
    await openPlanTab(b.page, { calendar: true });
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

const money2 = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const goalDay = (iso) => `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
/** Two animation frames: the page works a plan out on the next frame after a choice, so wait for it. */
const settle = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test("Strategy: the method buttons, the amount slider and box, the goal, every Use button and Show more months", { timeout: 150_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Method buttons \(highest rate first, card use first, smallest balance first\)/, async () => {
    const answer = sampleAnswer("money-strategy.sample.json");
    const resource = moneyResource("strategy", { read: () => answer });
    const { page, errors } = await open(entryUrl("frame", { ...FRAME("strategy"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await page.waitForSelector('[data-act="save"]');
    const defaults = answer.defaults;
    const settings = { method: defaults.method, monthly_cents: defaults.monthly_cents, goal: null };
    const plan0 = MATH.buildPlan(answer.inputs, settings);
    const results = () => page.locator('[data-slot="results"]');
    const box = page.locator("#s-amount");
    const goalNote = () => page.locator('[data-slot="goal-note"]').innerText();

    // Show more months: the table lists 24 and each press brings the next 24, to the last month of the plan.
    const months = plan0.months.length;
    const rows = () => page.locator(".months-card tbody tr").count();
    assert.ok(months > 48 && months < 72, "the sample plan runs between 48 and 72 months, so it needs two presses");
    assert.equal(await rows(), 24);
    await page.locator(".months-card summary").click();
    const more = page.locator('[data-act="more-months"]');
    assert.equal((await more.innerText()).trim(), `Show 24 more months`);
    await more.click();
    await page.waitForFunction(() => document.querySelectorAll(".months-card tbody tr").length > 24);
    assert.equal(await rows(), 48, "one press adds exactly 24 months");
    assert.equal((await more.innerText()).trim(), `Show ${months - 48} more months`);
    await more.click();
    await page.waitForFunction((n) => document.querySelectorAll(".months-card tbody tr").length === n, months);
    assert.equal(await rows(), months, "the second press brings the rest of the plan");
    assert.equal(await page.locator('[data-act="more-months"]').count(), 0, "no button once every month is listed");

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
    settings.method = "avalanche";

    // The slider and the box are one number: moving one moves the other.
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
    settings.monthly_cents = 200000;

    // The goal select shows its date box only when a goal is picked.
    const date = page.locator("#s-goal-by");
    assert.equal(await date.isHidden(), true, "no goal, no date box");
    await page.locator("#s-goal").selectOption("debt_free");
    assert.equal(await date.isVisible(), true);

    // A goal date a year out fits this month's cash. The sentence says the amount the math says it needs
    // (not the amount in the box), and the Use button carries that same amount.
    const farDate = "2027-12-31";
    await date.fill(farDate);
    await date.dispatchEvent("input");
    const far = MATH.buildPlan(answer.inputs, { ...settings, goal: { kind: "debt_free", by: farDate } }).goal;
    assert.equal(far.ok, true);
    assert.equal(far.fits_cash, true);
    assert.notEqual(far.monthly_cents, settings.monthly_cents, "the goal needs a different amount than the box holds");
    await page.waitForFunction((d) => (document.querySelector('[data-slot="goal-note"]')?.innerText || "").includes(d), goalDay(farDate));
    await settle(page);
    assert.equal(await goalNote().then((x) => x.replace(/\s+/g, " ").trim()),
      `To get there by ${goalDay(farDate)} you need ${money2(far.monthly_cents)} a month (highest rate first). Use ${money2(far.monthly_cents)}`);
    assert.equal(await page.locator('[data-slot="goal-note"] [data-act="use-amount"]').getAttribute("data-cents"), String(far.monthly_cents));

    // A goal date in a few weeks needs more than this month's cash can cover: the sentence says so.
    const nearDate = "2026-12-31";
    await date.fill(nearDate);
    await date.dispatchEvent("input");
    const near = MATH.buildPlan(answer.inputs, { ...settings, goal: { kind: "debt_free", by: nearDate } }).goal;
    assert.equal(near.fits_cash, false);
    await page.waitForFunction((d) => (document.querySelector('[data-slot="goal-note"]')?.innerText || "").includes(d), goalDay(nearDate));
    await settle(page);
    const nearText = (await goalNote()).replace(/\s+/g, " ").trim();
    assert.equal(nearText,
      `To get there by ${goalDay(nearDate)} you need ${money2(near.monthly_cents)} a month (highest rate first). More than this month's cash can cover. Use ${money2(near.monthly_cents)}`);
    assert.equal(await page.locator('[data-slot="goal-note"] [data-act="use-amount"]').getAttribute("data-cents"), String(near.monthly_cents));
    // The sentence does NOT carry the warning when the goal fits (checked above): the far date had none.

    // The goal's Use button puts that amount in the box, and then the page says the amount is set to it.
    await date.fill(farDate);
    await date.dispatchEvent("input");
    await page.waitForFunction((cents) => document.querySelector('[data-slot="goal-note"] [data-act="use-amount"]')?.getAttribute("data-cents") === String(cents), far.monthly_cents);
    await page.locator('[data-slot="goal-note"] [data-act="use-amount"]').click();
    await page.waitForFunction((v) => document.querySelector("#s-amount").value === v, money2(far.monthly_cents).slice(1));
    await settle(page);
    settings.monthly_cents = far.monthly_cents;
    await page.waitForFunction(() => /Your amount is set to this\./.test(document.querySelector('[data-slot="goal-note"]')?.innerText || ""));
    await page.locator("#s-goal").selectOption("");
    assert.equal(await date.isHidden(), true, "No goal hides the date box again");

    // More cash goes out than the cash on file can cover: the Cash tile says so and offers the most it can
    // cover. That Use button carries the math's own number, and pressing it brings the tile back to Safe.
    const OVER = 2_500_000;
    const over = MATH.buildPlan(answer.inputs, { ...settings, monthly_cents: OVER });
    assert.equal(over.cash.status, "over");
    const cap = over.cash.max_safe.monthly_cents;
    await box.fill("25,000");
    await box.dispatchEvent("input");
    await page.waitForFunction(() => /Too much/.test(document.querySelector('section[aria-labelledby="t-cash"]')?.innerText || ""));
    const capButton = page.locator('section[aria-labelledby="t-cash"] [data-act="use-amount"]');
    assert.equal((await capButton.innerText()).trim(), `Use ${money2(cap)}`);
    assert.equal(await capButton.getAttribute("data-cents"), String(cap));
    await capButton.click();
    await page.waitForFunction((v) => document.querySelector("#s-amount").value === v, money2(cap).slice(1));
    await page.waitForFunction(() => /Safe/.test(document.querySelector('section[aria-labelledby="t-cash"]')?.innerText || "")
      && !/Too much/.test(document.querySelector('section[aria-labelledby="t-cash"]')?.innerText || ""));
    assert.equal(await page.locator('section[aria-labelledby="t-cash"] [data-act="use-amount"]').count(), 0);
    settings.monthly_cents = cap;

    // A number under the minimums is refused in words, and the Use button puts the minimum in the box.
    await box.fill("1");
    await box.dispatchEvent("input");
    await page.waitForFunction(() => /less than the minimum payments/.test(document.querySelector('[data-slot="results"]')?.innerText || ""));
    const use = page.locator('[data-slot="results"] [data-act="use-amount"]');
    const minimum = Math.ceil(plan0.minimums_cents / 100) * 100;
    assert.match(await results().innerText(), new RegExp(`less than the minimum payments \\(${money2(plan0.minimums_cents).replace("$", "\\$")} a month\\)`));
    assert.equal(await use.getAttribute("data-cents"), String(minimum));
    assert.equal((await use.innerText()).trim(), `Use ${money2(minimum)}`);
    await use.click();
    await page.waitForFunction((v) => document.querySelector("#s-amount").value === v, money2(minimum).slice(1));
    await page.waitForFunction(() => !/less than the minimum/.test(document.querySelector('[data-slot="results"]')?.innerText || ""));
    assert.equal(await page.locator('[data-slot="results"] [data-act="use-amount"]').count(), 0, "the refusal and its button are gone");
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
