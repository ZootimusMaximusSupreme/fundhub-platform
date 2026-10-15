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
    // Right, Left, End and Home walk the bar and move focus with it.
    await page.locator("#tab-overview").focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => location.hash === "#next");
    assert.equal(await page.evaluate(() => document.activeElement.id), "tab-next");
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => location.hash === "#overview");
    await page.keyboard.press("End");
    await page.waitForFunction(() => location.hash === "#setup");
    assert.equal(await page.evaluate(() => document.activeElement.id), "tab-setup");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => location.hash === "#overview", null, { timeout: 5000 });
    await page.keyboard.press("Home");
    await page.waitForFunction(() => location.hash === "#overview");
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

test("Fundability: Try again repaints, and a chart column shows its month on hover or focus", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Chart columns \(hover or focus shows a month\) and Try again/, async () => {
    const { page } = await retryCase(open, {
      tab: "fundability", path: "/api/money/fundability", retry: '[data-act="retry"]',
      answer: () => sampleAnswer("money-fundability.sample.json"),
      painted: () => document.querySelectorAll(".fd-col").length > 1,
    });
    const cols = page.locator(".fd-col");
    const n = await cols.count();
    assert.ok(n >= 3, "the chart has a column for today and for later months");
    const detail = () => page.locator(".fd-detail").innerText();
    // Hover the first column: Today. Hover the last: a month in the future. Focus a middle one.
    await cols.nth(0).hover();
    await page.waitForFunction(() => document.querySelectorAll(".fd-col")[0].getAttribute("aria-pressed") === "true");
    assert.match(await detail(), /^Today/);
    await cols.nth(n - 1).hover();
    await page.waitForFunction((last) => document.querySelectorAll(".fd-col")[last].getAttribute("aria-pressed") === "true", n - 1);
    const later = await detail();
    assert.match(later, /in \d+ months/);
    assert.equal(await cols.nth(0).getAttribute("aria-pressed"), "false", "only one column is selected at a time");
    await cols.nth(1).focus();
    await page.waitForFunction(() => document.querySelectorAll(".fd-col")[1].getAttribute("aria-pressed") === "true");
    assert.match(await detail(), /in \d+ months/);
    assert.notEqual(await detail(), later, "a different column shows a different month");
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

    // A turn that never finishes: the page polls every 3 seconds (on the held clock), gives up after
    // 100 polls, and offers Check again. Pressing it reads once more and picks up the finished answer.
    const waiting = { ...answered, turns: [{ ...answered.turns[0], id: "turn-wait", status: "queued", reply: null, answered_at: null, actions: [], brain: null }], pending: 1 };
    let reads = 0;
    let finished = false;
    const handlers = { "/api/money/helper": async (route) => { reads += 1; return json(route, finished ? answered : waiting); } };
    const { page } = await open(entryUrl("frame", { ...FRAME("helper"), clientId: CLIENT_ID }), { session: STAFF, handlers, clock: true });
    await page.waitForFunction(() => /Thinking…/.test(document.body.innerText));
    assert.equal(await page.locator('[data-act="refresh"]').count(), 0, "no Check again while the helper is only just thinking");
    for (let i = 0; i < 110 && (await page.locator('[data-act="refresh"]').count()) === 0; i += 1) {
      const before = reads;
      await page.clock.fastForward(3_100);
      await waitFor(() => reads > before || false, 10_000).catch(() => {});
    }
    await page.waitForSelector('[data-act="refresh"]');
    assert.match(await page.locator(".stuck").innerText(), /Still thinking\. Check again/);
    const at = reads;
    finished = true;
    await page.locator('[data-act="refresh"]').click();
    await waitFor(() => reads > at);
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

test("Next steps: each Try again asks only for its own part", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Try again buttons \(tasks, ready-to-fund\)/, async () => {
    const sample = sampleAnswer("money-next.sample.json");
    const start = async (mode) => {
      const counts = { tasks: 0, ready: 0 };
      const handlers = {
        "/api/money/tasks": async (route) => { counts.tasks += 1; return mode.tasks === "fail" ? json(route, { ok: false, error: "server_error" }, 500) : json(route, sample.tasks); },
        "/api/money/ready-to-fund": async (route) => { counts.ready += 1; return mode.ready === "fail" ? json(route, { ok: false, error: "server_error" }, 500) : json(route, sample.ready); },
      };
      const { page } = await open(entryUrl("frame", { ...FRAME("next"), clientId: CLIENT_ID }), { session: STAFF, handlers });
      return { page, counts };
    };

    // The steps could not load: their Try again reads the steps again and brings the real list.
    const mode = { tasks: "fail", ready: "ok" };
    const a = await start(mode);
    await a.page.waitForSelector('[data-act="retry"]');
    await waitFor(() => a.counts.tasks === 1 && a.counts.ready === 1);
    assert.equal(await a.page.locator('[data-act="ready-retry"]').count(), 0, "the side part loaded, so it has no button");
    mode.tasks = "ok";
    await a.page.locator('[data-act="retry"]').click();
    await waitFor(() => a.counts.tasks === 2);
    await a.page.waitForFunction(() => /Pay \$/.test(document.body.innerText) && document.querySelectorAll('[data-act="retry"]').length === 0);
    await a.page.close();

    // The ready-to-fund part could not load: its own Try again reads that part again, not the steps.
    const modeB = { tasks: "ok", ready: "fail" };
    const b = await start(modeB);
    await b.page.waitForSelector('[data-act="ready-retry"]');
    await waitFor(() => b.counts.tasks === 1 && b.counts.ready === 1);
    assert.equal(await b.page.locator('[data-act="retry"]').count(), 0, "the steps loaded, so they have no button");
    modeB.ready = "ok";
    const stepsBefore = b.counts.tasks;
    await b.page.locator('[data-act="ready-retry"]').click();
    await waitFor(() => b.counts.ready === 2);
    await b.page.waitForFunction(() => document.querySelectorAll('[data-act="ready-retry"]').length === 0
      && !!document.querySelector('[data-act="ready"]'));
    assert.equal(b.counts.tasks, stepsBefore, "pressing the ready-to-fund button did not re-ask for the steps");
    await b.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
