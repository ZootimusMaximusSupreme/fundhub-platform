// Batch 18 practice tests: three more client money pages in a real Chromium with fake /api answers.
//
//   money-next.html       the "Check your accounts" link on an empty list, and both Try again buttons
//   money-payments.html   the empty "You do not owe Fundhub anything right now" state and the error state
//   money-setup.html      the loading and error states with Try again, and the Step 2 and Step 3 links

import { test } from "node:test";
import assert from "node:assert/strict";

import { flaky, json, proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";
import { CLIENT, CLIENT_ID, STAFF, moneyResource, sampleAnswer } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const FRAME = "/app/financeos.html";
const compact = (text) => String(text).replace(/\s+/g, " ").trim();
// A Try again button sits under a sentence that also says "Try again in a few minutes", so a match on the
// panel's words cannot tell a missing button from a present one. Read the button's own words.
const textOf = async (locator) => compact(await locator.innerText());

// ───────────────────────── money-next.html ─────────────────────────

const NEXT = sampleAnswer("money-next.sample.json");
const NEXT_EMPTY = { ...NEXT.tasks, tasks: [], more: 0 };

async function openNext({ tasks, ready = NEXT.ready, session = CLIENT, clientId = "" }) {
  const taskLog = moneyResource("tasks", { read: typeof tasks === "function" ? tasks : () => tasks });
  const readyLog = moneyResource("ready-to-fund", { read: typeof ready === "function" ? ready : () => ready });
  const url = `/app/money-next.html${clientId ? `?client_id=${clientId}` : ""}`;
  const opened = await screens.open(url, { session, handlers: { ...taskLog.handlers, ...readyLog.handlers } });
  return { ...opened, tasks: taskLog.log, ready: readyLog.log };
}

test("Next steps: an empty list says nothing is due and links to Accounts, with the client for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Check your accounts link \(empty state\)/, async () => {
    const own = await openNext({ tasks: NEXT_EMPTY });
    await own.page.waitForSelector(".empty-t");
    assert.match(await own.page.locator(".empty-t").innerText(), /Nothing to do right now\./);
    const link = own.page.getByRole("link", { name: "Check your accounts" });
    assert.equal(await link.getAttribute("href"), `${FRAME}#accounts`, "a client's link names nobody");
    await link.click();
    await own.page.waitForURL(/\/app\/financeos\.html#accounts$/);
    await own.page.close();

    const staff = await openNext({ tasks: NEXT_EMPTY, session: STAFF, clientId: CLIENT_ID });
    await staff.page.waitForSelector(".empty-t");
    assert.equal(await staff.page.getByRole("link", { name: "Check your accounts" }).getAttribute("href"), `${FRAME}?client_id=${CLIENT_ID}#accounts`);
    await staff.page.close();

    // with steps on the list there is no empty state and no such link
    const busy = await openNext({ tasks: NEXT.tasks });
    await busy.page.waitForSelector(".task-list");
    assert.equal(await busy.page.getByRole("link", { name: "Check your accounts" }).count(), 0);
    assert.equal(await busy.page.locator(".empty-t").count(), 0);
    assert.deepEqual(busy.errors, []);
    await busy.page.close();
  }, "public/app/money-next.html");
});

test("Next steps: each Try again reads again, the steps one reads both parts and the ready card one reads only its own", { timeout: 120_000 }, async () => {
  await proof.check(/^Try again buttons \(steps\) and \(ready card\)/, async () => {
    // steps read fails: error panel with Try again; pressing it reads steps AND the ready card again
    let tasksOk = false;
    const tasksRead = [];
    const readyRead = [];
    const handlers = {
      "/api/money/tasks": async (route, { url }) => {
        tasksRead.push(new URL(url).search);
        return tasksOk ? json(route, NEXT.tasks) : json(route, { ok: false, error: "query_failed" }, 500);
      },
      "/api/money/ready-to-fund": async (route, { url }) => {
        readyRead.push(new URL(url).search);
        return json(route, NEXT.ready);
      },
    };
    const { page, errors } = await screens.open("/app/money-next.html", { session: CLIENT, handlers });
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the steps' button says Try again");
    assert.match(await page.locator("#next-root").innerText(), /We could not load your next steps/);
    assert.equal(await page.locator(".ready").count(), 1, "the side card still shows when only the steps failed");
    assert.deepEqual([tasksRead.length, readyRead.length], [1, 1]);
    tasksOk = true;
    await page.locator('[data-act="retry"]').click();
    await page.waitForSelector(".task-list");
    assert.deepEqual([tasksRead.length, readyRead.length], [2, 2], "Try again on the steps reads steps and the ready card");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();

    // ready card read fails: its own Try again reads only the ready card
    let readyOk = false;
    const tasks2 = [];
    const ready2 = [];
    const second = await screens.open("/app/money-next.html", {
      session: CLIENT,
      handlers: {
        "/api/money/tasks": async (route, { url }) => { tasks2.push(new URL(url).search); return json(route, NEXT.tasks); },
        "/api/money/ready-to-fund": async (route, { url }) => {
          ready2.push(new URL(url).search);
          return readyOk ? json(route, NEXT.ready) : json(route, { ok: false, error: "query_failed" }, 500);
        },
      },
    });
    await second.page.waitForSelector('[data-act="ready-retry"]');
    assert.equal(await textOf(second.page.locator('[data-act="ready-retry"]')), "Try again", "the ready card's button says Try again");
    assert.match(await second.page.locator(".ready").innerText(), /We could not check your funding request just now\./);
    assert.equal(await second.page.locator(".task-list").count(), 1, "the steps are still painted");
    assert.deepEqual([tasks2.length, ready2.length], [1, 1]);
    readyOk = true;
    await second.page.locator('[data-act="ready-retry"]').click();
    await second.page.waitForSelector('[data-act="ready"]');
    assert.deepEqual([tasks2.length, ready2.length], [1, 2], "Try again on the ready card reads only the ready card");
    assert.equal(await second.page.locator('[data-act="ready-retry"]').count(), 0);
    assert.match(await second.page.locator(".ready").innerText(), /ready to get funded\?/i);
    await second.page.close();
  }, "public/app/money-next.html");
});

// ───────────────────────── money-payments.html ─────────────────────────

const PAYMENTS = sampleAnswer("money-payments.sample.json");

test("Payments: no plans says nothing is owed, a plan hides that sentence, and a failed read offers Try again", { timeout: 120_000 }, async () => {
  await proof.check(/^Empty state \('You do not owe Fundhub anything right now'\) and Error state with Try again/, async () => {
    const empty = await screens.open("/app/money-payments.html", { session: CLIENT, handlers: { "/api/money/payments": { ...PAYMENTS, plans: [] } } });
    await empty.page.waitForSelector("#b-owe");
    assert.match(await empty.page.locator(".card.empty").innerText(), /You do not owe Fundhub anything right now/);
    assert.equal(await empty.page.locator("article.plan").count(), 0);
    assert.equal(await empty.page.locator(".tiles").count(), 0, "no totals are painted for a client who owes nothing");
    assert.match(await empty.page.locator("#payments-root").innerText(), /coming up/i, "the rest of the page is still there");
    await empty.page.close();

    const owing = await screens.open("/app/money-payments.html", { session: CLIENT, handlers: { "/api/money/payments": PAYMENTS } });
    await owing.page.waitForSelector("article.plan");
    assert.equal(await owing.page.locator(".card.empty").count(), 0, "a client with a plan never sees the empty sentence");
    assert.equal(await owing.page.getByText("You do not owe Fundhub anything right now").count(), 0);
    await owing.page.close();

    const read = flaky(PAYMENTS);
    const { page, errors } = await screens.open(`/app/money-payments.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/payments": read.handler } });
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await textOf(page.locator("#payments-root section.error h2")), "We could not load your payments", "the error says what failed");
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the button says Try again");
    assert.match(await page.locator("#payments-root").innerText(), /Something went wrong on our side while loading your payments/);
    assert.equal(await page.locator("article.plan").count(), 0);
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2, "the second payments read");
    await page.waitForSelector("article.plan");
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`], "it asks for the same client again");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-payments.html");
});

// ───────────────────────── money-setup.html ─────────────────────────

const STEPS = (done) => ["pay", "soft_pull", "accounts", "live"].map((key) => ({ key, done: done.includes(key) }));
const setupRead = (over = {}) => ({
  ok: true, current_step: "soft_pull", setup_fee_cents: 29700, paid_at: "2026-10-01T17:00:00Z", containers: 0,
  steps: STEPS(["pay"]), soft_pull: { requested: false, last_pulled_at: null, price: { base_cents: 3900, business_addon_cents: 1500 } },
  open_checkout: null, price_per_container_cents: 4900, ...over,
});

test("Setup: while the read is out the page says it is loading, a failed read offers Try again that loads and paints the steps", { timeout: 90_000 }, async () => {
  await proof.check(/^Loading and error states with Try again/, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let mode = "hold";
    const reads = [];
    const handler = async (route, { url }) => {
      reads.push(new URL(url).search);
      if (mode === "hold") await gate;
      if (mode === "fail" || mode === "hold") return json(route, { ok: false, error: "query_failed" }, 500);
      return json(route, setupRead());
    };
    const { page, errors } = await screens.open("/app/money-setup.html", { session: CLIENT, handlers: { "/api/money/setup": handler } });
    await page.waitForSelector("#setup-root [aria-busy]");
    assert.match(await page.locator("#setup-root").innerText(), /Loading your setup/, "the page says it is loading while the read is out");
    assert.equal(await page.locator("#setup-root li.step").count(), 0, "no steps are drawn yet");
    release();
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await textOf(page.locator("#setup-root section.error h2")), "We could not load your setup", "the error says what failed");
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the button says Try again");
    assert.match(await page.locator("#setup-root").innerText(), /We could not load your setup/);
    assert.match(await page.locator("#setup-root").innerText(), /Something went wrong on our side while loading your setup/);
    assert.equal(await page.locator("#setup-root [aria-busy]").count(), 0, "the loading skeleton is gone");

    mode = "ok";
    await page.locator('[data-act="retry"]').click();
    await page.waitForSelector("#setup-root li.step");
    assert.equal(reads.length, 2, "Try again reads once more");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.equal(await page.locator("#setup-root li.step").count(), 4, "all four steps are painted");
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-setup.html");
});

test("Setup: Step 2 shows See my credit only once a pull is done, and not while it is waiting or not done", { timeout: 90_000 }, async () => {
  await proof.check(/^Step 2: See my credit link \(after a pull\)/, async () => {
    const stepTwo = async (read) => {
      const { page, errors } = await screens.open("/app/money-setup.html", { session: CLIENT, handlers: { "/api/money/setup": read } });
      await page.waitForSelector('li.step[data-step="soft_pull"]');
      const li = page.locator('li.step[data-step="soft_pull"]');
      const out = {
        state: compact(await li.locator(".state").innerText()),
        link: (await li.getByRole("link", { name: "See my credit" }).count())
          ? await li.getByRole("link", { name: "See my credit" }).getAttribute("href") : null,
        run: await li.locator('[data-act="soft-pull"]').count(),
      };
      assert.deepEqual(errors, []);
      await page.close();
      return out;
    };
    assert.deepEqual(
      await stepTwo(setupRead({ steps: STEPS(["pay", "soft_pull"]), soft_pull: { requested: true, last_pulled_at: "2026-10-05T17:00:00Z" } })),
      { state: "Done · last pulled Oct 5, 2026", link: "money-credit.html", run: 0 },
      "after a pull the step is done and links to the Credit page",
    );
    assert.deepEqual(
      await stepTwo(setupRead({ steps: STEPS(["pay"]), soft_pull: { requested: true, last_pulled_at: null } })),
      { state: "Waiting on results", link: null, run: 0 },
      "a pull in flight has no credit to see yet",
    );
    assert.deepEqual(
      await stepTwo(setupRead({ steps: STEPS(["pay"]), soft_pull: { requested: false, last_pulled_at: null, price: { base_cents: 3900 } } })),
      { state: "Not done yet", link: null, run: 1 },
      "before a pull there is the Run soft pull button and no credit link",
    );
    // the link really goes to the Credit page
    const { page } = await screens.open("/app/money-setup.html", {
      session: CLIENT, handlers: { "/api/money/setup": setupRead({ steps: STEPS(["pay", "soft_pull"]), soft_pull: { requested: true, last_pulled_at: "2026-10-05T17:00:00Z" } }) },
    });
    await page.waitForSelector('li.step[data-step="soft_pull"] a');
    await page.getByRole("link", { name: "See my credit" }).click();
    await page.waitForURL(/\/app\/money-credit\.html$/);
    await page.close();
  }, "public/app/money-setup.html");
});

test("Setup: Step 3 says Add businesses and accounts until there is one, then Add more with the count", { timeout: 90_000 }, async () => {
  await proof.check(/^Step 3: Add businesses and accounts \/ Add more link/, async () => {
    const stepThree = async (read, { query = "", session = CLIENT } = {}) => {
      const { page, errors } = await screens.open(`/app/money-setup.html${query}`, { session, handlers: { "/api/money/setup": read } });
      await page.waitForSelector('li.step[data-step="accounts"]');
      const li = page.locator('li.step[data-step="accounts"]');
      const link = li.locator("a");
      const out = { state: compact(await li.locator(".state").innerText()), words: compact(await link.innerText()), href: await link.getAttribute("href"), cls: await li.getAttribute("class") };
      assert.deepEqual(errors, []);
      await page.close();
      return out;
    };
    assert.deepEqual(await stepThree(setupRead({ containers: 0 })), {
      state: "Not done yet", words: "Add businesses and accounts", href: "money-accounts.html", cls: "step later",
    });
    assert.deepEqual(await stepThree(setupRead({ containers: 1, steps: STEPS(["pay", "soft_pull", "accounts"]) })), {
      state: "Done · 1 container", words: "Add more", href: "money-accounts.html", cls: "step done",
    });
    assert.deepEqual(await stepThree(setupRead({ containers: 3, steps: STEPS(["pay", "soft_pull", "accounts"]) })), {
      state: "Done · 3 containers", words: "Add more", href: "money-accounts.html", cls: "step done",
    });
    // the page the link goes to is the Accounts page, and it opens
    const { page } = await screens.open("/app/money-setup.html", { session: CLIENT, handlers: { "/api/money/setup": setupRead() } });
    await page.waitForSelector('li.step[data-step="accounts"] a');
    await page.locator('li.step[data-step="accounts"] a').click();
    await page.waitForURL(/\/app\/money-accounts\.html$/);
    await page.close();
  }, "public/app/money-setup.html");
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
