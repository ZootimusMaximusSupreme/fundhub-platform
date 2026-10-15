// Batch 18 practice tests: five more client money pages in a real Chromium with fake /api answers.
//
//   money-declines.html   the Bank name box under "Another bank", the Your bank applications list, and the
//                         Your steps list with Fundhub's steps fold
//   money-helper.html     the stopped / not switched on banner
//   money-next.html       the "Check your accounts" link on an empty list, and both Try again buttons
//   money-payments.html   the empty "You do not owe Fundhub anything right now" state and the error state
//   money-setup.html      the loading and error states with Try again, and the Step 2 and Step 3 links

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, flaky, json, proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";
import { CLIENT, CLIENT_ID, STAFF, moneyResource, sampleAnswer } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const FRAME = "/app/financeos.html";
const compact = (text) => String(text).replace(/\s+/g, " ").trim();

// ───────────────────────── money-declines.html ─────────────────────────

const LETTER = "We reviewed your application and we are unable to approve it at this time because of recent inquiries.";
const DECLINES_URL = "/api/blueprint/declines";

function declinesView(over = {}) {
  return {
    can_paste: true,
    applications: [
      { id: "app-chase", bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Waiting on the bank", decline_words: null },
      { id: "app-amex", bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "We plan to apply again" },
    ],
    declines: [],
    ...over,
  };
}

async function openDeclines(view, { session = CLIENT, clientId = "" } = {}) {
  const resource = moneyResource(DECLINES_URL, {
    read: () => ({ ok: true, view }),
    write: () => ({ status: 200, body: { ok: true, decline: { id: "dec-new", bank: "Another" } } }),
  });
  const opened = await screens.open(`/app/money-declines.html${clientId ? `?client_id=${clientId}` : ""}`, { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-declines h1");
  return { ...opened, ...resource.log };
}

test("Declines: Another bank shows the Bank name box, a missing name is refused, and a typed name goes with the letter", { timeout: 90_000 }, async () => {
  await proof.check(/^Bank name text box \(shown for Another bank\)/, async () => {
    const { page, posts, errors } = await openDeclines(declinesView());
    const other = page.locator('[data-slot="other"]');
    const nameBox = page.locator('[data-field="bank-name"]');
    const bank = page.locator('[data-field="bank"]');
    const say = () => page.locator('[data-slot="result"]').innerText();
    assert.equal(await other.evaluate((el) => el.hidden), true, "the Bank name box starts hidden");

    await bank.selectOption("__other");
    assert.equal(await other.evaluate((el) => el.hidden), false, "Another bank shows it");
    await bank.selectOption("app-chase");
    assert.equal(await other.evaluate((el) => el.hidden), true, "a listed bank hides it again");
    await bank.selectOption("__other");

    // no name: refused, nothing sent, the cursor goes to the name box
    await page.locator('[data-field="text"]').fill(LETTER);
    await page.locator('[data-act="paste"]').click();
    assert.match(await say(), /Tell us which bank sent it\./);
    assert.deepEqual(posts, [], "no name, no request");
    assert.equal(await nameBox.evaluate((el) => document.activeElement === el), true, "the cursor goes to the Bank name box");

    // a name made only of spaces is no name
    await nameBox.fill("   ");
    await page.locator('[data-act="paste"]').click();
    assert.match(await say(), /Tell us which bank sent it\./);
    assert.deepEqual(posts, []);

    // a typed name goes with the letter, trimmed, and no application id
    await nameBox.fill("  Local Credit Union  ");
    await page.locator('[data-act="paste"]').click();
    await waitFor(() => posts.length === 1, "the paste request");
    assert.deepEqual(posts[0], { action: "paste", text: LETTER, bank: "Local Credit Union" });
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-declines.html");
});

test("Declines: Your bank applications lists each bank and product with the bank's word, or says there are none", { timeout: 90_000 }, async () => {
  await proof.check(/^Your bank applications list/, async () => {
    const view = declinesView({
      applications: [
        { id: "a1", bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Waiting on the bank", decline_words: null },
        { id: "a2", bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "We plan to apply again" },
        { id: "a3", bank: "Capital One", product: null, decline_id: null, status_words: "Ready to apply", decline_words: null },
        { id: "a4", bank: null, product: "Mystery card", decline_id: null, status_words: "Status not set", decline_words: null },
        { id: "a5", bank: null, product: null, decline_id: null, status_words: "Approved", decline_words: null },
      ],
    });
    const { page, errors } = await openDeclines(view);
    const rows = (await page.locator(".dc-apps li").allInnerTexts()).map(compact);
    assert.deepEqual(rows, [
      "Chase · Ink Business Waiting on the bank",
      "American Express · Blue Business We plan to apply again",
      "Capital One Ready to apply",
      "Mystery card Status not set",
      "A bank Approved",
    ], "each application shows its bank, product and status words; a decline's words win over the application's");
    assert.equal(await page.locator("#dc-paste option").filter({ hasText: "American Express" }).count(), 0, "a bank already declined is not offered in the paste picker");
    assert.deepEqual(errors, []);
    await page.close();

    // no applications: the empty sentence, whether or not there are declines
    const none = await openDeclines(declinesView({ applications: [] }));
    assert.match(await none.page.locator(".fh-declines").innerText(), /No bank applications on your file yet\./);
    assert.equal(await none.page.locator(".dc-apps").count(), 0);
    await none.page.close();
    const declineOnly = await openDeclines(declinesView({
      applications: [],
      declines: [{ id: "dec-9", bank: "Wells Fargo", product: null, declined_on: "2026-10-02", outcome: "open", status_words: "We are working on it",
        reasons: [], needs_person: false, your_steps: [], fundhub_steps: [], fundhub_done: 0, fundhub_total: 0, when: [] }],
    }));
    assert.match(await declineOnly.page.locator(".dc-block").last().innerText(), /No bank applications on your file yet\./);
    await declineOnly.page.close();
  }, "public/app/money-declines.html");
});

test("Declines: the Your steps list marks each step Done, Skipped or Not done yet, and Fundhub's steps fold counts them", { timeout: 90_000 }, async () => {
  await proof.check(/^Your steps list \+ Fundhub's steps expander/, async () => {
    const decline = {
      id: "dec-1", bank: "American Express", product: "Blue Business", declined_on: "2026-10-02", outcome: "open",
      status_words: "We are working on it", reasons: [], needs_person: false, when: [],
      your_steps: [
        { text: "Send the second page of the letter", status: "done" },
        { text: "Confirm your business phone", status: "open" },
        { text: "Skip the survey", status: "skipped" },
      ],
      fundhub_steps: [
        { text: "Call the bank", status: "done" },
        { text: "Ask for reconsideration", status: "open" },
        { text: "Write the second letter", status: "skipped" },
      ],
      fundhub_done: 2, fundhub_total: 3,
    };
    const bare = { ...decline, id: "dec-2", bank: "Wells Fargo", your_steps: [], fundhub_steps: [], fundhub_done: 0, fundhub_total: 0 };
    const { page, errors } = await openDeclines(declinesView({ declines: [decline, bare] }));
    const card = page.locator('article[data-decline="dec-1"]');
    const steps = (locator) => locator.locator("li").evaluateAll((items) => items.map((li) => ({
      cls: li.className, mark: li.querySelector(".dc-mark").textContent, text: li.querySelector(".dc-step-text").textContent,
      word: li.querySelector(".dc-word").textContent,
    })));

    assert.deepEqual(await steps(card.locator(".dc-steps").first()), [
      { cls: "dc-step is-done", mark: "✓", text: "Send the second page of the letter", word: "Done" },
      { cls: "dc-step is-open", mark: "○", text: "Confirm your business phone", word: "Not done yet" },
      { cls: "dc-step is-skip", mark: "–", text: "Skip the survey", word: "Skipped" },
    ]);
    assert.match(await card.locator(".eyebrow", { hasText: /your steps/i }).first().innerText(), /your steps/i);

    const fold = card.locator("details.dc-ours");
    assert.equal(compact(await fold.locator("summary").innerText()), "Fundhub's steps — 2 of 3 done", "the fold counts finished and skipped steps");
    assert.equal(await fold.evaluate((el) => el.open), false, "Fundhub's steps start folded");
    assert.equal(await fold.locator("li").first().isVisible(), false);
    await fold.locator("summary").click();
    assert.equal(await fold.evaluate((el) => el.open), true);
    assert.deepEqual((await steps(fold)).map((s) => [s.word, s.text]), [
      ["Done", "Call the bank"], ["Not done yet", "Ask for reconsideration"], ["Skipped", "Write the second letter"],
    ]);

    // a decline with no steps shows no empty list and no empty fold
    const empty = page.locator('article[data-decline="dec-2"]');
    assert.equal(await empty.locator(".dc-steps").count(), 0);
    assert.equal(await empty.locator("details.dc-ours").count(), 0);
    assert.equal(await empty.locator(".eyebrow", { hasText: /your steps/i }).count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-declines.html");
});

// ───────────────────────── money-helper.html ─────────────────────────

const HELPER = sampleAnswer("money-helper.sample.json");

async function openHelper(helper) {
  const answer = { ...HELPER, helper: { ...HELPER.helper, ...helper } };
  const opened = await screens.open("/app/money-helper.html", { session: CLIENT, handlers: { "/api/money/helper": answer } });
  await opened.page.waitForSelector("#helper-root .card.thread");
  return opened;
}

test("Helper: the banner says it stopped, or that it is not switched on, and the Send box goes away with it", { timeout: 90_000 }, async () => {
  await proof.check(/^Banner: helper stopped \/ not switched on/, async () => {
    const banner = async (helper) => {
      const { page, errors } = await openHelper(helper);
      assert.deepEqual(errors, []);
      const text = (await page.locator(".banner").count()) ? compact(await page.locator(".banner").innerText()) : null;
      const composer = await page.locator("form.composer").count();
      await page.close();
      return { text, composer };
    };
    assert.deepEqual(await banner({ on: true, halted: false, halt_reason: null }), { text: null, composer: 1 }, "a helper that is on and running shows no banner and the Send box");
    assert.deepEqual(await banner({ on: true, halted: true, halt_reason: "stop" }), {
      text: "The money helper stopped here. You asked it to stop, so it will not text you. A person from Fundhub will follow up.",
      composer: 0,
    }, "a stop the client asked for says so, and there is nothing to send into");
    assert.deepEqual(await banner({ on: true, halted: true, halt_reason: "legal" }), {
      text: "The money helper stopped here. A person from Fundhub will follow up.",
      composer: 0,
    }, "a stop for another reason does not claim the client asked for it");
    assert.deepEqual(await banner({ on: false, halted: false, halt_reason: null }), {
      text: "The money helper is not switched on. Your advisor can turn it on.",
      composer: 0,
    }, "a helper that is off says so");
    assert.deepEqual(await banner({ on: false, halted: true, halt_reason: "stop" }), {
      text: "The money helper stopped here. You asked it to stop, so it will not text you. A person from Fundhub will follow up.",
      composer: 0,
    }, "stopped wins over not switched on");
  }, "public/app/money-helper.html");
});

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
