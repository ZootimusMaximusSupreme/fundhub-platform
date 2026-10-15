// Batch 19 practice tests: the pipeline board's own controls on public/app/pipeline.html.
// A real page in Chromium, fake /api answers (no live data), one click or one change at a time, and a
// judgement of which cards stay on the board, what the headline says and what request the page makes.
// Rows come from fin-b19-rows.json.

import assert from "node:assert/strict";
import test from "node:test";

import { proofRows, sharedLab, waitFor } from "./fin-b19-kit.mjs";

const proof = proofRows(import.meta.url);
const lab = sharedLab();

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(Date.now() - ms).toISOString();

const card = (id, name, extra = {}) => ({
  id: `card-${id}`, client_id: id, name, owner: null, entered_at: ago(HOUR), outcome_tier: null,
  funded: false, amount: 1000, phone: "+15550100", email: `${id}@example.com`, ...extra,
});

// One board that has every kind of card the filters judge. Who the move is on, by the page's own rule:
//   us     Alice (a text nobody answered), Eve (an approval with no dollar amount), Finn (an unanswered email)
//   bank   Bob and Gus (sitting in Round Submitted)
//   client Cara (sitting in Action Required)
//   none   Dan
const SALES = {
  ok: true, pipeline: "sales", total: 4,
  stages: [
    { key: "new_lead", name: "New Lead", sort_order: 0, count: 4, amount: 15500, cards: [
      card("zed", "Zed Zane", { owner: "Casey Reed", entered_at: ago(3 * DAY), amount: 1000 }),
      card("alice", "Alice Adams", { owner: "Jordan Blake", entered_at: ago(5 * DAY), amount: 4000, sms_needs_reply: true }),
      card("finn", "Finn Fox", { entered_at: ago(30 * 60_000), amount: 9000, email_needs_reply: true }),
      card("dan", "Dan Dyer", { owner: "Jordan Blake", entered_at: ago(2 * HOUR), amount: 1500 }),
    ] },
    { key: "round_submitted", name: "Round Submitted", sort_order: 1, count: 3, amount: 12000, cards: [
      card("gus", "Gus Green", { entered_at: ago(1 * DAY), amount: 3000 }),
      card("bob", "Bob Baker", { owner: "Casey Reed", entered_at: ago(2 * DAY), amount: 9000 }),
      card("eve", "Eve East", { entered_at: ago(7 * DAY), amount: null, approval_amount_missing: true }),
    ] },
    { key: "action_required", name: "Action Required", sort_order: 2, count: 1, amount: 2000, cards: [
      card("cara", "Cara Cole", { entered_at: ago(10 * DAY), amount: 2000 }),
    ] },
  ],
};

const ALL_NAMES = ["Alice Adams", "Bob Baker", "Cara Cole", "Dan Dyer", "Eve East", "Finn Fox", "Gus Green", "Zed Zane"];

function railBoard(key, rail) {
  return {
    ok: true, pipeline: key, total: 1,
    stages: [
      { key: `${key}_first`, name: `${rail} first`, sort_order: 0, count: 1, amount: 700, cards: [card(`${key}-one`, `${rail} client`)] },
      { key: `${key}_second`, name: `${rail} second`, sort_order: 1, count: 0, amount: 0, cards: [] },
    ],
  };
}

const CLIENTS = {
  ok: true,
  rollups: { total_clients: 3, needs_pull: 1, action_needed: 1, ready: 1, total_prequal: 120000, total_approved: 50000 },
  clients: [
    { id: "c1", name: "Lena Lopez", next_action: { key: "pull_report", label: "Pull the report", why: "No pull on file." }, next_action_degraded: false },
    { id: "c2", name: "Mo Marsh", next_action: { key: "send_docs", label: "Send documents", why: "Documents are missing." }, next_action_degraded: false },
    { id: "c3", name: "Nia North", next_action: { key: "pull_report", label: "Pull the report", why: "No pull on file." }, next_action_degraded: false },
  ],
};

// A signed-in page on the pipeline with the given fake answers. Every request is kept on page.apiCalls.
async function openBoard({ role = "owner", boards = { sales: SALES }, clients = CLIENTS, fail = [] } = {}) {
  const reads = [];
  const page = await lab.page({
    role,
    width: 1500,
    height: 1000,
    api: (request, url) => {
      if (request.method() === "GET" && url.pathname === "/api/dashboard/pipeline") {
        const key = url.searchParams.get("key");
        reads.push(key);
        if (fail.includes(key)) return { status: 500, body: { ok: false, error: "boom" } };
        return boards[key] || { ok: true, pipeline: key, total: 0, stages: [] };
      }
      if (request.method() === "GET" && url.pathname === "/api/dashboard/clients") return clients;
      return undefined;
    },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".col-body > .card").length > 0, null, { timeout: 30_000 });
  return { page, reads, errors };
}

const shown = (page) => page.$$eval(".col-body > .card:not(.filtered)", (els) => els.map((e) => e.querySelector(".c-name").textContent.trim()).sort());
const columnOrder = (page, stage) => page.$$eval(`.col[data-stage-key="${stage}"] .col-body > .card`, (els) => els.map((e) => e.querySelector(".c-name").textContent.trim()));
// Opens the filter panel if it is shut. The Filter button toggles, so a second open must not close it.
const openFilters = async (page) => {
  if (await page.locator("#filterPanel").isHidden()) await page.locator("#filterBtn").click();
};
const pick = async (page, id, value) => { await page.locator(id).selectOption(value); };

test("the Waiting on filter keeps only the cards whose next move is that party", { timeout: 120_000 }, async () => {
  await proof.check(/^Filter: Waiting on/, async () => {
    const { page, errors } = await openBoard();
    assert.deepEqual(await shown(page), ALL_NAMES, "Anyone shows every card");
    await openFilters(page);
    const options = await page.$$eval("#fWait option", (os) => os.map((o) => [o.value, o.textContent.trim()]));
    assert.deepEqual(options.map(([v]) => v), ["", "us", "us_amount", "bank", "client", "none"]);
    const expected = {
      us: ["Alice Adams", "Eve East", "Finn Fox"],
      us_amount: ["Eve East"],
      bank: ["Bob Baker", "Gus Green"],
      client: ["Cara Cole"],
      none: ["Dan Dyer", "Zed Zane"],
    };
    for (const [value, names] of Object.entries(expected)) {
      await pick(page, "#fWait", value);
      assert.deepEqual(await shown(page), names, `Waiting on = ${value}`);
      assert.equal(await page.locator("#filterN").innerText(), "1", "the Filter control counts one active filter");
    }
    await pick(page, "#fWait", "");
    assert.deepEqual(await shown(page), ALL_NAMES, "back to Anyone shows every card again");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the Owner filter is hidden until a card has an owner, then keeps only that owner's cards", { timeout: 120_000 }, async () => {
  await proof.check(/^Filter: Owner/, async () => {
    const noOwners = {
      sales: { ...SALES, stages: SALES.stages.map((s) => ({ ...s, cards: s.cards.map((c) => ({ ...c, owner: null })) })) },
    };
    const bare = await openBoard({ boards: noOwners });
    await openFilters(bare.page);
    assert.equal(await bare.page.locator("#fOwnerWrap").isHidden(), true, "no card has an owner: the select is not drawn");
    await bare.page.close();

    const { page, errors } = await openBoard();
    await openFilters(page);
    assert.equal(await page.locator("#fOwnerWrap").isVisible(), true, "a card has an owner: the select shows");
    const options = await page.$$eval("#fOwner option", (os) => os.map((o) => o.value));
    assert.deepEqual(options, ["", "Casey Reed", "Jordan Blake"], "Anyone, then each owner once, in order");
    await pick(page, "#fOwner", "Jordan Blake");
    assert.deepEqual(await shown(page), ["Alice Adams", "Dan Dyer"]);
    await pick(page, "#fOwner", "Casey Reed");
    assert.deepEqual(await shown(page), ["Bob Baker", "Zed Zane"]);
    await pick(page, "#fOwner", "");
    assert.deepEqual(await shown(page), ALL_NAMES);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the search box keeps the cards whose name has the typed words, and nothing else", { timeout: 120_000 }, async () => {
  await proof.check(/^Search box/, async () => {
    const { page, errors } = await openBoard();
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "Search name, phone, or email");
    await page.locator("#q").fill("ali");
    assert.deepEqual(await shown(page), ["Alice Adams"]);
    await page.locator("#q").fill("  EVE ");
    assert.deepEqual(await shown(page), ["Eve East"], "case and outer spaces do not matter");
    // The placeholder promises phone and email. The filter reads the name text only, so a phone or an
    // email typed here matches nothing. This pins that behaviour: if the filter starts to read them, the
    // row's own words ("the filter compares the card's name text only") are no longer true.
    await page.locator("#q").fill("alice@example.com");
    assert.deepEqual(await shown(page), [], "an email typed here matches no card");
    await page.locator("#q").fill("+15550100");
    assert.deepEqual(await shown(page), [], "a phone typed here matches no card");
    await page.locator("#q").fill("");
    assert.deepEqual(await shown(page), ALL_NAMES);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("each Sort choice puts the cards of a column in its own order, and Manual does not give the first order back", { timeout: 120_000 }, async () => {
  await proof.check(/^Sort: Manual/, async () => {
    const { page, errors } = await openBoard();
    await openFilters(page);
    const options = await page.$$eval("#fSort option", (os) => os.map((o) => [o.value, o.textContent.trim()]));
    assert.deepEqual(options, [
      ["", "Manual"], ["name", "Name A–Z"], ["amt", "Amount, high first"], ["age", "Longest in stage"], ["needs", "Amount needed first"],
    ]);
    const first = ["Zed Zane", "Alice Adams", "Finn Fox", "Dan Dyer"];
    assert.deepEqual(await columnOrder(page, "new_lead"), first, "Manual: the order the read gave");
    await pick(page, "#fSort", "name");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Dan Dyer", "Finn Fox", "Zed Zane"], "name A to Z");
    await pick(page, "#fSort", "amt");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Finn Fox", "Alice Adams", "Dan Dyer", "Zed Zane"], "amount, high first");
    await pick(page, "#fSort", "age");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Zed Zane", "Dan Dyer", "Finn Fox"], "longest in stage first");
    await pick(page, "#fSort", "needs");
    assert.deepEqual(await columnOrder(page, "round_submitted"), ["Eve East", "Bob Baker", "Gus Green"], "the approval with no amount first, then the longest wait");
    await pick(page, "#fSort", "name");
    assert.deepEqual(await columnOrder(page, "round_submitted"), ["Bob Baker", "Eve East", "Gus Green"]);
    // PRODUCT FINDING, pinned so the day it is fixed this goes red and says to attach the row: picking Manual
    // after another choice leaves the cards in that other order. applySort() returns when the choice is empty.
    await pick(page, "#fSort", "");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Dan Dyer", "Finn Fox", "Zed Zane"],
      "Manual keeps the last sorted order (the first order is not given back). If this fails the product was fixed: attach the Sort row.");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("an active filter shows as a chip, and its x clears only that filter", { timeout: 120_000 }, async () => {
  await proof.check(/^The x on each active filter chip/, async () => {
    const { page, errors } = await openBoard();
    await openFilters(page);
    await pick(page, "#fWait", "us");
    await pick(page, "#fOwner", "Jordan Blake");
    await pick(page, "#fAge", "1440");
    const chips = () => page.$$eval("#filterChips .fchip", (els) => els.map((e) => e.firstElementChild.textContent.trim()));
    assert.deepEqual(await chips(), ["Waiting on: Us — someone here", "Owner: Jordan Blake", "Age: Over 1d in stage"]);
    assert.equal(await page.locator("#filterN").innerText(), "3");
    assert.deepEqual(await shown(page), ["Alice Adams"], "us AND Jordan Blake AND over a day");

    await page.locator("#filterChips .fchip", { hasText: "Owner:" }).locator(".x").click();
    assert.equal(await page.locator("#fOwner").inputValue(), "", "the Owner filter is cleared");
    assert.equal(await page.locator("#fWait").inputValue(), "us", "the other filters are kept");
    assert.equal(await page.locator("#fAge").inputValue(), "1440");
    assert.deepEqual(await chips(), ["Waiting on: Us — someone here", "Age: Over 1d in stage"]);
    assert.equal(await page.locator("#filterN").innerText(), "2");
    assert.deepEqual(await shown(page), ["Alice Adams", "Eve East"], "us AND over a day, any owner");

    await page.locator("#filterChips .fchip", { hasText: "Waiting on:" }).locator(".x").click();
    assert.equal(await page.locator("#fWait").inputValue(), "");
    assert.deepEqual(await chips(), ["Age: Over 1d in stage"]);
    assert.deepEqual(await shown(page), ["Alice Adams", "Bob Baker", "Cara Cole", "Eve East", "Gus Green", "Zed Zane"]);

    // PRODUCT FINDING, pinned so the day it is fixed this goes red and says to attach the row: the x on the
    // Sort chip clears the select and the chip, and leaves the cards in the sorted order.
    await pick(page, "#fSort", "name");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Dan Dyer", "Finn Fox", "Zed Zane"]);
    await page.locator("#filterChips .fchip", { hasText: "Sort:" }).locator(".x").click();
    assert.equal(await page.locator("#fSort").inputValue(), "", "the Sort select is cleared");
    assert.equal(await page.locator("#filterChips .fchip", { hasText: "Sort:" }).count(), 0, "and its chip is gone");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Dan Dyer", "Finn Fox", "Zed Zane"],
      "the order stays sorted. If this fails the product was fixed: attach the chip row.");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the headline counts agree with the filter and its buttons are the same filter", { timeout: 120_000 }, async () => {
  const { page, errors } = await openBoard();
  const numbers = () => page.evaluate(() => ({
    us: document.querySelector("#hlUsN").textContent,
    bank: document.querySelector("#hlBank b").textContent,
    client: document.querySelector("#hlClient b").textContent,
    none: document.querySelector("#hlNone b").textContent,
  }));
  assert.deepEqual(await numbers(), { us: "3", bank: "2", client: "1", none: "2" }, "3 + 2 + 1 + 2 is the 8 cards on the board");

  await proof.check(/^Headline: Waiting on us/, async () => {
    const button = page.locator("#hlUs");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    await button.click();
    assert.equal(await page.locator("#fWait").inputValue(), "us", "the button writes the select");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await shown(page), ["Alice Adams", "Eve East", "Finn Fox"], "only the cards someone here must move");
    assert.equal(await page.locator("#filterChips .fchip").first().innerText().then((t) => t.replace(/\s*✕$/, "")), "Waiting on: Us — someone here");
    await button.click();
    assert.equal(await page.locator("#fWait").inputValue(), "", "pressing it again clears the filter");
    assert.deepEqual(await shown(page), ALL_NAMES);
    // The amount choice is a narrower slice of "us": the headline button stays on for it.
    await openFilters(page);
    await pick(page, "#fWait", "us_amount");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    await pick(page, "#fWait", "");
  });

  await proof.check(/^Headline counters: on a bank/, async () => {
    const expected = [
      ["#hlBank", "bank", ["Bob Baker", "Gus Green"]],
      ["#hlClient", "client", ["Cara Cole"]],
      ["#hlNone", "none", ["Dan Dyer", "Zed Zane"]],
    ];
    for (const [selector, value, names] of expected) {
      const button = page.locator(selector);
      await button.click();
      assert.equal(await page.locator("#fWait").inputValue(), value, `${selector} writes the select`);
      assert.deepEqual(await shown(page), names, `${selector} shows its cards`);
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      await button.click();
      assert.equal(await page.locator("#fWait").inputValue(), "", `${selector} pressed again clears the filter`);
    }
    // The select is the same filter: choosing from it turns the matching counter on.
    await openFilters(page);
    await pick(page, "#fWait", "bank");
    assert.equal(await page.locator("#hlBank").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#hlClient").getAttribute("aria-pressed"), "false");
    await pick(page, "#fWait", "");
  });

  await proof.check(/^Headline: Longest wait link/, async () => {
    const link = page.locator("#hlNextLink");
    assert.equal(await link.isVisible(), true);
    assert.equal((await link.innerText()).trim(), "Longest wait: Eve East — 7d in stage, Round Submitted",
      "of the cards someone here must move, the one that waited longest (Eve, 7 days; Alice is 5)");
    assert.equal(await link.getAttribute("href"), "#fh-card-card-eve");
    await link.click();
    await waitFor(() => page.locator("#fh-card-card-eve").evaluate((el) => el.classList.contains("fh-spot")), "the card to be ringed");
    // A filter that hides the card stops the jump being a control and says why.
    await openFilters(page);
    await pick(page, "#fWait", "client");
    assert.equal(await link.isHidden(), true, "the link is not drawn while its card is filtered out");
    assert.match(await page.locator("#hlNextNote").innerText(), /This filter hides the longest wait: Eve East/);
    await pick(page, "#fWait", "");
    assert.equal(await link.isVisible(), true, "and it comes back with the card");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("the Board / Fulfillment switch swaps the view, reads the client list once, and gives the board back", { timeout: 120_000 }, async () => {
  const { page, errors } = await openBoard();
  const clientReads = () => page.apiCalls.filter((c) => c.path === "/api/dashboard/clients").map((c) => c.query);

  await proof.check(/^Lens switch: Board/, async () => {
    assert.equal(await page.locator("#lensBoard").getAttribute("aria-pressed"), "true");
    assert.deepEqual(clientReads(), [], "the client list is not read until Fulfillment is opened");
    await page.locator("#lensFulfillment").click();
    assert.equal(await page.locator("#fhLens").isVisible(), true);
    assert.equal(await page.locator(".board-row").isHidden(), true, "the board is hidden");
    assert.equal(await page.locator("#headline").isHidden(), true, "the board's headline goes with it");
    assert.equal(await page.locator("#lensFulfillment").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#lensBoard").getAttribute("aria-pressed"), "false");
    await waitFor(() => clientReads().length === 1, "the client list read");
    assert.deepEqual(clientReads(), [{ limit: "200", fulfillment: "1" }]);
    await page.waitForSelector(".fh-lens-row");
    assert.equal(await page.locator("#ltTotalClients").innerText(), "3");
    assert.equal(await page.locator(".fh-lens-row").count(), 3);
    await page.locator("#lensBoard").click();
    assert.equal(await page.locator(".board-row").isVisible(), true, "the board is back");
    assert.equal(await page.locator("#headline").isVisible(), true);
    assert.equal(await page.locator("#fhLens").isHidden(), true);
    await page.locator("#lensFulfillment").click();
    await page.locator("#lensBoard").click();
    assert.equal(clientReads().length, 1, "opening it again does not read the list again");
  });

  await proof.check(/^Fulfillment lens: click a chip/, async () => {
    await page.locator("#lensFulfillment").click();
    const visibleRows = () => page.$$eval(".fh-lens-row:not(.filtered) .lr-name", (els) => els.map((e) => e.textContent.trim()));
    assert.deepEqual(await visibleRows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.equal(await page.locator("#fhLensBar").isHidden(), true);
    await page.locator('.fh-lens-row[data-client-id="c2"] .fh-chip').click();
    assert.deepEqual(await visibleRows(), ["Mo Marsh"], "only the clients whose next action is Send documents");
    assert.equal(await page.locator("#fhLensBarText").innerText(), 'Showing only "Send documents" — 1 of 3 clients.');
    // Click the same chip again: the filter clears.
    await page.locator('.fh-lens-row[data-client-id="c2"] .fh-chip').click();
    assert.deepEqual(await visibleRows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.equal(await page.locator("#fhLensBar").isHidden(), true);
    // A chip two clients share shows both, and Show all clears it.
    await page.locator('.fh-lens-row[data-client-id="c1"] .fh-chip').click();
    assert.deepEqual(await visibleRows(), ["Lena Lopez", "Nia North"]);
    assert.equal(await page.locator("#fhLensBarText").innerText(), 'Showing only "Pull the report" — 2 of 3 clients.');
    await page.locator("#fhLensClear").click();
    assert.deepEqual(await visibleRows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.equal(await page.locator("#fhLensBar").isHidden(), true);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

const RAILS = [
  ["Rail tab R-01 Sales", "R-01", "sales", "Sales"],
  ["Rail tab R-02 Funding: Card Stacking", "R-02", "funding_card_stacking", "Funding: Card Stacking"],
  ["Rail tab R-04 Optimization (Repair) Rounds", "R-04", "optimization", "Optimization (Repair) Rounds"],
  ["Rail tab R-05 Inquiry Removal", "R-05", "inquiry_removal", "Inquiry Removal"],
  ["Rail tab R-06 AR / Collections", "R-06", "ar_collections", "AR / Collections"],
  ["Rail tab R-08 Affiliates + White Label", "R-08", "affiliates_white_label", "Affiliates + White Label"],
  ["Rail tab R-09 Hiring", "R-09", "hiring", "Hiring"],
];

test("each rail tab asks for its own pipeline once and paints that rail's own columns", { timeout: 180_000 }, async () => {
  const boards = { sales: SALES };
  for (const [, , key, rail] of RAILS.slice(1)) boards[key] = railBoard(key, rail);
  const { page, reads, errors } = await openBoard({ boards });
  await waitFor(() => reads.includes("sales"), "the first read");

  for (const [control, code, key, label] of RAILS) {
    await proof.check(control, async () => {
      const tab = page.locator(`.rail-tab[data-rail="${code}"]`);
      if (code !== "R-01") {
        const before = reads.filter((k) => k === key).length;
        await tab.click();
        await waitFor(() => reads.filter((k) => k === key).length === before + 1, `${label} board read`);
        assert.equal(reads.filter((k) => k === key).length, 1, `${label}: exactly one read of ${key}`);
        await page.waitForSelector(`.col[data-stage-key="${key}_first"]`);
        assert.deepEqual(
          await page.$$eval(".col .col-name", (els) => els.map((e) => e.textContent.trim())),
          [`${label} first`, `${label} second`],
          `${label}: its own columns, no other rail's`,
        );
        assert.deepEqual(await shown(page), [`${label} client`]);
      } else {
        assert.equal(reads.filter((k) => k === "sales").length, 1, "Sales is read once, on open");
        assert.deepEqual(await page.$$eval(".col .col-name", (els) => els.map((e) => e.textContent.trim())),
          ["New Lead", "Round Submitted", "Action Required"]);
      }
      assert.equal(await tab.getAttribute("class").then((c) => /\bactive\b/.test(c)), true, `${label} is the active tab`);
      assert.equal(await page.locator(".rail-tab.active").count(), 1, "one active tab");
      assert.equal(await page.locator("#railLabel").textContent(), label, "the footer names the rail");
    });
    if (code !== "R-01") {
      // Going back to Sales uses the saved board: one read of each rail only.
      await page.locator('.rail-tab[data-rail="R-01"]').click();
      await page.waitForSelector('.col[data-stage-key="new_lead"]');
    }
  }
  assert.equal(reads.filter((k) => k === "sales").length, 1, "coming back to Sales does not read it again");
  assert.deepEqual(errors, []);
  await page.close();
});

test("a rail whose read fails says so in words and keeps its tab active", { timeout: 60_000 }, async () => {
  const { page } = await openBoard({ boards: { sales: SALES }, fail: ["hiring"] });
  await page.locator('.rail-tab[data-rail="R-09"]').click();
  await page.waitForFunction(() => /could not load the board/i.test(document.querySelector("#boardStatus")?.textContent || ""));
  assert.equal(await page.locator('.rail-tab[data-rail="R-09"]').getAttribute("class").then((c) => /\bactive\b/.test(c)), true);
  assert.equal(await page.locator("#hlUsN").innerText(), "—", "a failed read is a dash, never a zero");
  await page.close();
});

test("the Sales rail says a payment does not move a card, and no other rail says it", { timeout: 120_000 }, async () => {
  await proof.check(/^Rail note on Sales/, async () => {
    const boards = { sales: SALES };
    for (const [, , key, rail] of RAILS.slice(1)) boards[key] = railBoard(key, rail);
    const { page, reads, errors } = await openBoard({ boards });
    const note = page.locator("#railNote");
    assert.equal(await note.isVisible(), true);
    assert.equal(
      (await note.innerText()).trim(),
      "A payment does not move a card. When a deposit is paid, somebody has to move the card to Closed Won (deposit) — drag it, or use MOVE on the card. Nothing moves it for you.",
    );
    for (const [, code, key] of RAILS.slice(1)) {
      await page.locator(`.rail-tab[data-rail="${code}"]`).click();
      await waitFor(() => reads.includes(key), `${key} read`);
      assert.equal(await note.isHidden(), true, `${key}: no note on this rail`);
    }
    await page.locator('.rail-tab[data-rail="R-01"]').click();
    await page.waitForSelector('.col[data-stage-key="new_lead"]');
    assert.equal(await note.isVisible(), true, "the note is back on Sales");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
