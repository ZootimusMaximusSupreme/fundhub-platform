// Batch 12 practice tests: the FinanceOS frame itself (financeos.html) and the Try again buttons of
// the tabs a failed read leaves behind. Practice test means a real page in Chromium, fake /api
// answers, one click, and a judgement of the exact request and the words painted.
//
// Each Try again case does the same four things, so a button that does nothing, asks the wrong
// path, or leaves the error up goes red:
//   1. the first read answers 500, and the page shows its error with the button;
//   2. the button is pressed;
//   3. the page asks the SAME path again (exactly one more read);
//   4. the real answer paints and the error and the button are gone.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, sampleAnswer, waitFor } from "./s4-money-harness.mjs";
import { proofRows } from "./fin-b12-kit.mjs";

const proof = proofRows(import.meta.url);
const FRAME = (tab) => ({ entry: "frame", tab, surface: `financeos.html#${tab}` });

/** A fake path that fails once with a server error, then answers `answer()`. */
function failsOnce(path, answer) {
  const log = { reads: 0, queries: [] };
  const handler = async (route, { url }) => {
    log.reads += 1;
    log.queries.push(new URL(url).search);
    if (log.reads === 1) return json(route, { ok: false, error: "server_error" }, 500);
    return json(route, typeof answer === "function" ? answer() : answer);
  };
  return { log, handlers: { [path]: handler } };
}

/**
 * Open a tab whose read fails once, check the error and its button, press it, and return the page
 * after the second read has been asked for. `painted` is a function run in the page that is true
 * once the real answer is on screen.
 */
async function retryCase(open, { tab, path, answer, retry, painted, session = STAFF, extra = {} }) {
  const fake = failsOnce(path, answer);
  const { page, errors } = await open(entryUrl("frame", { ...FRAME(tab), clientId: session === CLIENT ? "" : CLIENT_ID }), {
    session, handlers: { ...fake.handlers, ...extra },
  });
  await page.waitForSelector(retry);
  assert.equal(fake.log.reads, 1, "one read before the button is pressed");
  assert.equal(await page.locator(retry).count(), 1, "exactly one Try again button");
  await page.locator(retry).click();
  await waitFor(() => fake.log.reads === 2);
  await page.waitForFunction(painted);
  assert.equal(await page.locator(retry).count(), 0, "the button is gone once the read works");
  assert.equal(fake.log.reads, 2, "the button asked once, not in a loop");
  assert.equal(fake.log.queries[1], fake.log.queries[0], "it asks for the same file again");
  assert.deepEqual(errors, []);
  return { page, fake };
}

test("the back link goes to the client's portal for a client and to Finance OS for staff", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Back link/, async () => {
    const overview = () => sampleAnswer("money-overview.sandbox.json");
    const client = await open("/app/financeos.html", { session: CLIENT, handlers: { "/api/money/overview": (route) => json(route, overview()) } });
    await client.page.waitForSelector("#money-back");
    assert.equal((await client.page.locator("#money-back").innerText()).trim(), "Back to my portal");
    assert.equal(await client.page.locator("#money-back").getAttribute("href"), "client-portal.html");
    await client.page.close();

    const staff = await open(`/app/financeos.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/overview": (route) => json(route, overview()) } });
    await staff.page.waitForSelector("#money-back");
    assert.equal((await staff.page.locator("#money-back").innerText()).trim(), "Back to Finance OS");
    assert.equal(await staff.page.locator("#money-back").getAttribute("href"), `finance-os.html?client_id=${CLIENT_ID}`);
    await staff.page.locator("#money-back").click();
    await staff.page.waitForURL((url) => url.pathname === "/app/finance-os.html" && url.searchParams.get("client_id") === CLIENT_ID);
    await staff.page.close();
  });
});

test("the tab bar has 16 tabs, arrow keys and Home and End move along it, and #hash opens a tab", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Tab bar: 16 tabs/, async () => {
    const WORDS = ["Overview", "Next steps", "Money helper", "Money moves", "Plan", "Banks", "Strategy", "Fundability",
      "Applications", "Alerts", "Funding papers", "Accounts", "Credit", "Connections", "Payments", "Setup"];
    const KEYS = ["overview", "next", "helper", "transfers", "plan", "banks", "strategy", "fundability",
      "declines", "alerts", "vault", "accounts", "credit", "connections", "payments", "setup"];
    const { page } = await open(`/app/financeos.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: {} });
    await page.waitForSelector(".fos-tabs [role=tab]");
    const tabs = page.locator(".fos-tabs [role=tab]");
    assert.equal(await tabs.count(), 16);
    assert.deepEqual((await tabs.allInnerTexts()).map((s) => s.trim()), WORDS);
    const selected = () => page.evaluate(() => [...document.querySelectorAll(".fos-tabs [role=tab]")]
      .filter((a) => a.getAttribute("aria-selected") === "true").map((a) => a.id.replace(/^tab-/, "")));
    const panels = () => page.evaluate(() => [...document.querySelectorAll('[role=tabpanel]')].filter((p) => !p.hidden).map((p) => p.id));
    assert.deepEqual(await selected(), ["overview"], "no hash opens Overview");
    // A #hash opens its own tab, and only that tab's panel shows.
    await page.evaluate(() => { location.hash = "credit"; });
    await page.waitForFunction(() => document.querySelector("#tab-credit")?.getAttribute("aria-selected") === "true");
    assert.deepEqual(await selected(), ["credit"]);
    assert.deepEqual(await panels(), ["fos-credit"]);
    // An unknown hash falls back to Overview.
    await page.evaluate(() => { location.hash = "nonsense"; });
    await page.waitForFunction(() => document.querySelector("#tab-overview")?.getAttribute("aria-selected") === "true");
    // The tab ids run in the same order as the words, so the bar and the keys below agree.
    const ids = await page.evaluate(() => [...document.querySelectorAll(".fos-tabs [role=tab]")].map((a) => a.id.replace(/^tab-/, "")));
    assert.deepEqual(ids, KEYS, "the sixteen tab ids run in the order of the words");
    const hrefs = await page.evaluate(() => [...document.querySelectorAll(".fos-tabs [role=tab]")].map((a) => a.getAttribute("href")));
    assert.deepEqual(hrefs, KEYS.map((k) => `#${k}`), "each tab link points at its own hash");

    // Press every tab link with the mouse: it opens its own tab and only its own panel.
    for (const key of KEYS) {
      await page.locator(`#tab-${key}`).click();
      await page.waitForFunction((k) => location.hash === `#${k}` && document.querySelector(`#tab-${k}`)?.getAttribute("aria-selected") === "true", key);
      assert.deepEqual(await selected(), [key], `clicking ${key} selects only ${key}`);
      assert.deepEqual(await panels(), [`fos-${key}`], `clicking ${key} shows only its panel`);
    }

    // The arrow keys walk the WHOLE bar, one tab at a time, in the order of the words, and wrap at both ends.
    const focused = () => page.evaluate(() => document.activeElement.id);
    const opened = (k) => page.waitForFunction((key) => location.hash === `#${key}`
      && document.querySelector(`#tab-${key}`)?.getAttribute("aria-selected") === "true", k);
    await page.locator("#tab-overview").click();
    await page.locator("#tab-overview").focus();
    for (let i = 0; i < KEYS.length; i += 1) {
      const next = KEYS[(i + 1) % KEYS.length];
      await page.keyboard.press("ArrowRight");
      await opened(next);
      assert.equal(await focused(), `tab-${next}`, `ArrowRight from ${KEYS[i]} lands on ${next}`);
      assert.deepEqual(await selected(), [next]);
    }
    // Back at Overview after a full lap. Now the other way: Left from the first tab wraps to the last.
    assert.deepEqual(await selected(), ["overview"]);
    for (let i = 0; i < KEYS.length; i += 1) {
      const from = KEYS[(KEYS.length - i) % KEYS.length];
      const prev = KEYS[(KEYS.length - i - 1) % KEYS.length];
      await page.keyboard.press("ArrowLeft");
      await opened(prev);
      assert.equal(await focused(), `tab-${prev}`, `ArrowLeft from ${from} lands on ${prev}`);
      assert.deepEqual(await selected(), [prev]);
    }
    assert.deepEqual(await selected(), ["overview"]);
    // End goes to the last tab and Home goes back to the first.
    await page.keyboard.press("End");
    await opened("setup");
    assert.equal(await focused(), "tab-setup");
    await page.keyboard.press("Home");
    await opened("overview");
    assert.equal(await focused(), "tab-overview");
    // Every one of the 16 hashes lands on its own tab.
    for (const key of KEYS) {
      await page.evaluate((k) => { location.hash = k; }, key);
      await page.waitForFunction((k) => document.querySelector(`#tab-${k}`)?.getAttribute("aria-selected") === "true", key);
      assert.deepEqual(await panels(), [`fos-${key}`]);
    }
    await page.close();
  });
});

test("Overview: Try again asks for the file again and paints it", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Try again button \(overview failed to load\)/, async () => {
    const { page } = await retryCase(open, {
      tab: "overview", path: "/api/money/overview", retry: '[data-act="retry"]',
      answer: () => sampleAnswer("money-overview.sandbox.json"),
      painted: () => !!document.querySelector(".head .caption") && /Test data/.test(document.body.innerText),
    });
    await page.close();
  });
});

test("Setup: Try again asks for the setup again and paints the steps", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Try again button$/, async () => {
    const setup = () => ({
      ok: true, current_step: "soft_pull", setup_fee_cents: 29700, paid_at: "2026-10-01T17:00:00Z", containers: 1,
      steps: [{ key: "pay", done: true }, { key: "soft_pull", done: false }, { key: "accounts", done: false }, { key: "live", done: false }],
      soft_pull: { requested: false, price: { base_cents: 3900, business_addon_cents: 1500 } }, open_checkout: null,
    });
    const { page } = await retryCase(open, {
      tab: "setup", path: "/api/money/setup", retry: '[data-act="retry"]', answer: setup,
      painted: () => !!document.querySelector('[data-act="soft-pull"]'),
    });
    await page.close();
  });
});

test("Credit: Try again repaints the scores, and the soft-pull link opens the Setup tab", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Try again; link to Setup/, async () => {
    const { page } = await retryCase(open, {
      tab: "credit", path: "/api/money/credit", retry: '[data-act="retry"]',
      answer: () => sampleAnswer("money-credit.sample.json"),
      painted: () => /as of/.test(document.querySelector(".head .caption")?.innerText || ""),
    });
    await page.close();

    // No pull on file: the empty page offers a link to Setup, and the frame opens that tab.
    const empty = () => ({ ...sampleAnswer("money-credit.sample.json"), has_pull: false, business: {}, history: [] });
    const resource = { "/api/money/credit": (route) => json(route, empty()),
      "/api/money/setup": (route) => json(route, { ok: true, current_step: "soft_pull", steps: [{ key: "soft_pull", done: false }], soft_pull: { requested: false, price: {} }, open_checkout: null }) };
    const view = await open(entryUrl("frame", { ...FRAME("credit"), clientId: CLIENT_ID }), { session: STAFF, handlers: resource });
    const link = view.page.locator('a.btn-primary:has-text("Set up a soft pull")');
    await link.waitFor();
    assert.equal(await link.getAttribute("href"), `/app/money-setup.html?client_id=${CLIENT_ID}`);
    await link.click();
    await view.page.waitForFunction(() => location.hash === "#setup");
    await view.page.waitForFunction(() => document.querySelector("#tab-setup")?.getAttribute("aria-selected") === "true");
    assert.equal(await view.page.evaluate(() => location.pathname), "/app/financeos.html", "the link switched tabs without leaving the page");
    await view.page.close();
  });
});

/**
 * A fundability answer whose columns all differ, so a detail panel that shows the wrong column,
 * the wrong date or another column's score, tier or estimate cannot read the same by luck.
 */
function fundabilityColumns() {
  const answer = sampleAnswer("money-fundability.sample.json");
  const plan = [
    { months: 3, date: "2027-01-07", score: 4, tier: "not_fundable", funding_estimate_cents: 9000000, assumptions: ["3 months go by. You pay down two cards."] },
    { months: 6, date: "2027-04-07", score: 5, tier: "fundable", funding_estimate_cents: 15500000, assumptions: ["6 months go by. You pay down two cards.", "One dispute is removed."] },
    { months: 9, date: "2027-07-07", score: 5, tier: "fundable", funding_estimate_cents: 18250000, assumptions: ["9 months go by. Your open accounts stay open."] },
    { months: 12, date: "2027-10-07", score: 6, tier: "fundable", funding_estimate_cents: 30100000, assumptions: ["12 months go by. Every item is cleared."] },
  ].map((p) => ({ ...p, scenario: "plan", score_max: 6, unknown: 0, checks: {}, sentences: [] }));
  const removed = [
    { months: 6, date: "2027-04-07", score: 6, tier: "fundable", funding_estimate_cents: 26000000, assumptions: ["If the inquiries are removed."] },
    { months: 12, date: "2027-10-07", score: 6, tier: "fundable", funding_estimate_cents: 41000000, assumptions: ["If every inquiry is removed."] },
  ].map((p) => ({ ...p, scenario: "if_removed", score_max: 6, unknown: 0, checks: {}, sentences: [] }));
  answer.projections = [...plan, ...removed];
  answer.plan = { ...(answer.plan || {}), if_removed: true };
  return { answer, plan, removed };
}

const usd = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const MONTH_WORDS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (iso) => `${MONTH_WORDS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
const TIER_TEXT = { fundable: "Fundable", not_fundable: "Not fundable yet" };

test("Fundability: Try again repaints, and every chart column shows its own month, score, tier, estimate and assumptions", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Chart columns \(hover or focus shows a month\) and Try again/, async () => {
    const { answer, plan, removed } = fundabilityColumns();
    const first = await retryCase(open, {
      tab: "fundability", path: "/api/money/fundability", retry: '[data-act="retry"]',
      answer: () => answer,
      painted: () => document.querySelectorAll(".fd-col").length > 1,
    });
    const { page, fake } = first;
    // Try again asks for the same client's file: the second read carries the client, like the first.
    assert.match(fake.log.queries[1], new RegExp(`client_id=${CLIENT_ID}`), "Try again keeps the client");

    const cols = page.locator(".fd-col");
    assert.equal(await cols.count(), 1 + plan.length, "one column for today and one for each later month");
    const selectedColumns = () => page.evaluate(() => [...document.querySelectorAll(".fd-col")]
      .map((c, i) => (c.getAttribute("aria-pressed") === "true" ? i : null)).filter((i) => i !== null));
    const detail = () => page.locator(".fd-detail").innerText();
    const stripSpaces = (text) => text.replace(/\s+/g, " ").trim();

    // Today: no date, the file as it is, no "If removed" line.
    await cols.nth(0).hover();
    await page.waitForFunction(() => document.querySelectorAll(".fd-col")[0].getAttribute("aria-pressed") === "true");
    const today = stripSpaces(await detail());
    assert.equal(today, `Today Your plan 5 of 6 · Fundable · Estimate ${usd(answer.now.funding_estimate_cents)} Your file as it is today. No guesses.`);
    assert.deepEqual(await selectedColumns(), [0]);

    // Every later column, by hover: its own date and months, its own score, tier, estimate and assumptions.
    for (let i = 0; i < plan.length; i += 1) {
      const p = plan[i];
      await cols.nth(i + 1).hover();
      await page.waitForFunction((n) => document.querySelectorAll(".fd-col")[n].getAttribute("aria-pressed") === "true", i + 1);
      assert.deepEqual(await selectedColumns(), [i + 1], "only the pointed-at column is selected");
      const r = removed.find((q) => q.months === p.months);
      const expected = `${dayWords(p.date)} · in ${p.months} months `
        + `Your plan ${p.score} of 6 · ${TIER_TEXT[p.tier]} · Estimate ${usd(p.funding_estimate_cents)} ${p.assumptions.join(" ")}`
        + (r ? ` If removed ${r.score} of 6 · ${TIER_TEXT[r.tier]} · Estimate ${usd(r.funding_estimate_cents)} ${r.assumptions.join(" ")}` : "");
      assert.equal(stripSpaces(await detail()), expected, `column ${i + 1} (${p.months} months) shows its own numbers`);
    }

    // Focus does the same as hover, on a middle column.
    await cols.nth(2).focus();
    await page.waitForFunction(() => document.querySelectorAll(".fd-col")[2].getAttribute("aria-pressed") === "true");
    assert.deepEqual(await selectedColumns(), [2]);
    assert.ok(stripSpaces(await detail()).startsWith(`${dayWords(plan[1].date)} · in 6 months Your plan 5 of 6 · Fundable · Estimate ${usd(plan[1].funding_estimate_cents)}`));
    // The accessible name of a column says the same month and score, and the if-removed score where there is one.
    assert.equal(await cols.nth(3).getAttribute("aria-label"), `${dayWords(plan[2].date)}, in 9 months — your plan 5 of 6, Fundable`);
    assert.equal(await cols.nth(2).getAttribute("aria-label"), `${dayWords(plan[1].date)}, in 6 months — your plan 5 of 6, Fundable — if removed 6 of 6`);
    await page.close();
  });
});

test("Money helper: Try again repaints the thread, and Check again asks once more when a turn looks stuck", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^'Check again' button \(when a turn looks stuck\) and Try again/, async () => {
    const answered = sampleAnswer("money-helper.sample.json");
    const first = await retryCase(open, {
      tab: "helper", path: "/api/money/helper", retry: '[data-act="retry"]', answer: () => answered,
      painted: () => /Money helper|helper/i.test(document.body.innerText) && !!document.querySelector(".thread, .msgs, #mh-input"),
    });
    await first.page.close();

    // A turn that never finishes. The page asks again every 3 seconds (on the held clock), and gives
    // up after exactly 100 asks: it says "Still thinking" and offers Check again. Pressing it starts the
    // count over, so a turn that is still not finished goes back to thinking and the asking resumes.
    const waiting = { ...answered, turns: [{ ...answered.turns[0], id: "turn-wait", status: "queued", reply: null, answered_at: null, actions: [], brain: null }], pending: 1 };
    const state = { reads: 0, finished: false, queries: [] };
    const handlers = {
      "/api/money/helper": async (route, { url }) => {
        state.reads += 1;
        state.queries.push(new URL(url).search);
        return json(route, state.finished ? answered : waiting);
      },
    };
    const { page } = await open(entryUrl("frame", { ...FRAME("helper"), clientId: CLIENT_ID }), { session: STAFF, handlers, clock: true });
    await page.waitForFunction(() => /Thinking…/.test(document.body.innerText));
    await waitFor(() => state.reads === 1);
    const pause = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
    const checkAgain = () => page.locator('[data-act="refresh"]').count();
    // Not before 3 seconds: 2.9 seconds on the clock asks for nothing.
    await pause(100);
    await page.clock.fastForward(2_900);
    await pause(150);
    assert.equal(state.reads, 1, "no second ask before the 3 seconds are up");
    assert.equal(await checkAgain(), 0, "no Check again while the helper is only just thinking");
    // Then one ask per 3 seconds, and the button waits for the 100th ask and no earlier.
    await page.clock.fastForward(200);
    await waitFor(() => state.reads === 2);
    for (let poll = 1; poll <= 100; poll += 1) {
      if (poll > 1) {
        const before = state.reads;
        for (let attempt = 0; attempt < 40 && state.reads === before; attempt += 1) {
          await page.clock.fastForward(3_000);
          await pause();
        }
        assert.equal(state.reads, before + 1, `ask ${poll} was made`);
      }
      assert.equal(state.reads, poll + 1, `after ${poll} asks the page has read ${poll + 1} times`);
      if (poll < 100) {
        await pause(15);
        assert.equal(await checkAgain(), 0, `no Check again after only ${poll} asks`);
      }
    }
    await page.waitForSelector('[data-act="refresh"]');
    assert.equal(state.reads, 101, "the first read and 100 asks, then it stops asking");
    assert.match(await page.locator(".stuck").innerText(), /Still thinking\. Check again/);
    // It really has stopped: more time on the clock asks for nothing.
    await page.clock.fastForward(30_000);
    await pause(150);
    assert.equal(state.reads, 101, "stuck means it asks no more by itself");

    // Check again while the turn is STILL not finished: one more read, the page goes back to thinking,
    // the button is gone, and the asking starts again from nothing.
    await page.locator('[data-act="refresh"]').click();
    await waitFor(() => state.reads === 102);
    await page.waitForFunction(() => document.querySelectorAll('[data-act="refresh"]').length === 0 && /Thinking…/.test(document.body.innerText));
    for (let attempt = 0; attempt < 40 && state.reads === 102; attempt += 1) {
      await page.clock.fastForward(3_000);
      await pause();
    }
    assert.equal(state.reads, 103, "after Check again the page asks again by itself");
    assert.equal(await checkAgain(), 0, "and it is not stuck again after one ask");
    assert.ok(state.queries.every((q) => q === `?client_id=${CLIENT_ID}`), "every ask is for the same client");

    // The turn finishes: the next ask brings the answer and the thinking words and the button are gone.
    state.finished = true;
    for (let attempt = 0; attempt < 40 && state.reads === 103; attempt += 1) {
      await page.clock.fastForward(3_000);
      await pause();
    }
    await page.waitForFunction(() => !/Thinking…/.test(document.body.innerText) && document.querySelectorAll('[data-act="refresh"]').length === 0);
    assert.ok((await page.locator("body").innerText()).includes(answered.turns[0].reply.slice(0, 40)), "the finished answer is on screen");
    await page.close();
  });
});

test("Next steps: the three links go where they say", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Links: 'Open your checklist', 'Check your accounts', 'Book a call'/, async () => {
    const sample = sampleAnswer("money-next.sample.json");
    const withLink = { ...sample.tasks, tasks: [{ ...sample.tasks.tasks[0], id: "check:1", title: "Finish your checklist", can_do: "self", link: "/app/money-credit.html", assignment: null, moves_money: false }] };
    const run = async (tasks, ready) => {
      const handlers = { "/api/money/tasks": (route) => json(route, tasks), "/api/money/ready-to-fund": (route) => json(route, ready),
        "/api/money/credit": (route) => json(route, sampleAnswer("money-credit.sample.json")),
        "/api/money/accounts": (route) => json(route, { ok: true, client_id: CLIENT_ID, containers: [], unassigned: { accounts: [], cards: [], loans: [], bills: [] }, billing: {} }) };
      return open(entryUrl("frame", { ...FRAME("next"), clientId: CLIENT_ID }), { session: STAFF, handlers });
    };
    // Open your checklist: a step the client does themselves, with the page it opens.
    const a = await run(withLink, sample.ready);
    const checklist = a.page.locator('a:has-text("Open your checklist")');
    await checklist.waitFor();
    assert.equal(await checklist.getAttribute("href"), `/app/money-credit.html?client_id=${CLIENT_ID}`);
    await checklist.click();
    await a.page.waitForFunction(() => location.hash === "#credit");
    await a.page.close();
    // Check your accounts: nothing to do right now, and the link opens the Accounts tab.
    const b = await run({ ...sample.tasks, tasks: [] }, sample.ready);
    const accounts = b.page.locator('a:has-text("Check your accounts")');
    await accounts.waitFor();
    assert.equal(await accounts.getAttribute("href"), `/app/financeos.html?client_id=${CLIENT_ID}#accounts`);
    await accounts.click();
    await b.page.waitForFunction(() => location.hash === "#accounts");
    assert.equal(await b.page.evaluate(() => location.pathname), "/app/financeos.html");
    await b.page.close();
    // Book a call: the Capital Blueprint card opens the selling call in a new tab, with no opener.
    const c = await run({ ...sample.tasks, tasks: [] }, sample.ready);
    const book = c.page.locator('a:has-text("Book a call")');
    await book.waitFor();
    assert.equal(await book.getAttribute("href"), sample.ready.offers.blueprint.sell.url);
    assert.equal(await book.getAttribute("target"), "_blank");
    assert.match(await book.getAttribute("rel"), /noopener/);
    await c.page.close();
  });
});

test("Next steps: each Try again asks for the same client's file, and the ready-to-fund one leaves the steps alone", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Try again buttons \(tasks, ready-to-fund\)/, async () => {
    const sample = sampleAnswer("money-next.sample.json");
    const WANT = `?client_id=${CLIENT_ID}`;
    const start = async (mode) => {
      const counts = { tasks: 0, ready: 0, taskQueries: [], readyQueries: [] };
      const handlers = {
        "/api/money/tasks": async (route, { url }) => {
          counts.tasks += 1;
          counts.taskQueries.push(new URL(url).search);
          return mode.tasks === "fail" ? json(route, { ok: false, error: "server_error" }, 500) : json(route, sample.tasks);
        },
        "/api/money/ready-to-fund": async (route, { url }) => {
          counts.ready += 1;
          counts.readyQueries.push(new URL(url).search);
          return mode.ready === "fail" ? json(route, { ok: false, error: "server_error" }, 500) : json(route, sample.ready);
        },
      };
      const { page } = await open(entryUrl("frame", { ...FRAME("next"), clientId: CLIENT_ID }), { session: STAFF, handlers });
      return { page, counts };
    };

    // The steps could not load: their Try again reads the page's two parts again (the steps and the
    // ready-to-fund card, as the page does on every load) for the same client, and brings the real list.
    const mode = { tasks: "fail", ready: "ok" };
    const a = await start(mode);
    await a.page.waitForSelector('[data-act="retry"]');
    await waitFor(() => a.counts.tasks === 1 && a.counts.ready === 1);
    assert.equal(await a.page.locator('[data-act="ready-retry"]').count(), 0, "the side part loaded, so it has no button");
    mode.tasks = "ok";
    await a.page.locator('[data-act="retry"]').click();
    await waitFor(() => a.counts.tasks === 2);
    await a.page.waitForFunction(() => /Pay \$/.test(document.body.innerText) && document.querySelectorAll('[data-act="retry"]').length === 0);
    assert.deepEqual(a.counts.taskQueries, [WANT, WANT], "the steps are asked for the same client both times");
    assert.ok(a.counts.readyQueries.length >= 2 && a.counts.readyQueries.every((q) => q === WANT), "the ready part is asked for the same client too");
    await a.page.close();

    // The ready-to-fund part could not load: its own Try again reads that part again, for the same
    // client, and NOT the steps, and the steps stay on the page.
    const modeB = { tasks: "ok", ready: "fail" };
    const b = await start(modeB);
    await b.page.waitForSelector('[data-act="ready-retry"]');
    await waitFor(() => b.counts.tasks === 1 && b.counts.ready === 1);
    assert.equal(await b.page.locator('[data-act="retry"]').count(), 0, "the steps loaded, so they have no button");
    assert.match(await b.page.locator("body").innerText(), /Pay \$/, "the steps are on the page");
    modeB.ready = "ok";
    await b.page.locator('[data-act="ready-retry"]').click();
    await waitFor(() => b.counts.ready === 2);
    await b.page.waitForFunction(() => document.querySelectorAll('[data-act="ready-retry"]').length === 0
      && !!document.querySelector('[data-act="ready"]'));
    assert.equal(b.counts.tasks, 1, "pressing the ready-to-fund button did not re-ask for the steps");
    assert.deepEqual(b.counts.readyQueries, [WANT, WANT], "the ready part is asked for the same client both times");
    assert.match(await b.page.locator("body").innerText(), /Pay \$/, "the steps are still on the page");
    await b.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
