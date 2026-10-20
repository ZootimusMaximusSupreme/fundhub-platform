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
//   none   Dan, Zed
// Owners, in the order the board meets them: Casey Reed (Zed), Jordan Blake (Alice), Casey Stone (Cara). Two of
// them share a first name and the order met is not the alphabet, so an owner list that is unsorted, or a match
// on the first letters only, shows.
const SALES = {
  ok: true, pipeline: "sales", total: 4,
  stages: [
    { key: "new_lead", name: "New Lead", sort_order: 0, count: 4, amount: 15500, cards: [
      card("zed", "Zed Zane", { owner: "Casey Reed", entered_at: ago(3 * DAY), amount: 1000 }),
      card("alice", "Alice Adams", { owner: "Jordan Blake", entered_at: ago(5 * DAY), amount: 4000, sms_needs_reply: true,
        phone: "+15551112222", email: "alice@example.com" }),
      card("finn", "Finn Fox", { entered_at: ago(30 * 60_000), amount: 9000, email_needs_reply: true }),
      card("dan", "Dan Dyer", { owner: "Jordan Blake", entered_at: ago(2 * HOUR), amount: 1500 }),
    ] },
    { key: "round_submitted", name: "Round Submitted", sort_order: 1, count: 3, amount: 12000, cards: [
      card("gus", "Gus Green", { entered_at: ago(1 * DAY), amount: 3000 }),
      card("bob", "Bob Baker", { owner: "Casey Reed", entered_at: ago(2 * DAY), amount: 9000 }),
      card("eve", "Eve East", { entered_at: ago(36 * HOUR), amount: null, approval_amount_missing: true }),
    ] },
    { key: "action_required", name: "Action Required", sort_order: 2, count: 1, amount: 2000, cards: [
      card("cara", "Cara Cole", { owner: "Casey Stone", entered_at: ago(10 * DAY), amount: 2000 }),
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

// What the person sees: a row counts only when the browser really draws it (it has a box and is not
// display:none). The page's own "filtered" class is NOT read, so a rule that stops hiding a filtered card
// cannot pass for a working filter.
const visibleNames = (page, selector, nameSelector) => page.$$eval(selector, (els, nameSel) => els
  .filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0;
  })
  .map((el) => el.querySelector(nameSel).textContent.trim())
  .sort(), nameSelector);
const shown = (page) => visibleNames(page, ".col-body > .card", ".c-name");
const columnOrder = (page, stage) => page.$$eval(`.col[data-stage-key="${stage}"] .col-body > .card`, (els) => els.map((e) => e.querySelector(".c-name").textContent.trim()));
// Opens the filter panel if it is shut. The Filter button toggles, so a second open must not close it.
const openFilters = async (page) => {
  if (await page.locator("#filterPanel").isHidden()) await page.locator("#filterBtn").click();
};
const pick = async (page, id, value) => { await page.locator(id).selectOption(value); };

test("the Waiting on filter keeps only the cards whose next move is that party, and each choice says what it keeps", { timeout: 120_000 }, async () => {
  await proof.check(/^Filter: Waiting on/, async () => {
    const { page, errors } = await openBoard();
    assert.deepEqual(await shown(page), ALL_NAMES, "Anyone shows every card");
    await openFilters(page);
    // The choice is picked by the words a person reads, then judged by the cards that stay. A label that
    // sits on the wrong value (A bank on the client's cards) cannot pass.
    const choices = [
      ["Us \u2014 someone here", "us", ["Alice Adams", "Eve East", "Finn Fox"]],
      ["Us \u2014 an approval amount", "us_amount", ["Eve East"]],
      ["A bank", "bank", ["Bob Baker", "Gus Green"]],
      ["The client", "client", ["Cara Cole"]],
      ["Nothing recorded", "none", ["Dan Dyer", "Zed Zane"]],
    ];
    assert.deepEqual(
      await page.$$eval("#fWait option", (os) => os.map((o) => [o.value, o.textContent.trim()])),
      [["", "Anyone"], ...choices.map(([label, value]) => [value, label])],
      "the six choices, each with its own words",
    );
    for (const [label, value, names] of choices) {
      await page.locator("#fWait").selectOption({ label });
      assert.equal(await page.locator("#fWait").inputValue(), value, `${label} is the ${value} choice`);
      assert.deepEqual(await shown(page), names, `Waiting on = ${label}`);
      assert.equal(await page.locator("#filterN").innerText(), "1", "the Filter control counts one active filter");
      assert.equal(await page.locator("#filterChips .fchip > span").first().innerText(),
        `Waiting on: ${label}`, "and its chip says the same words");
    }
    await page.locator("#fWait").selectOption({ label: "Anyone" });
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
    assert.equal(await bare.page.locator("#fOwner").isVisible(), false, "and neither is the select inside it");
    await bare.page.close();

    const { page, errors } = await openBoard();
    await openFilters(page);
    assert.equal(await page.locator("#fOwnerWrap").isVisible(), true, "a card has an owner: the select shows");
    assert.equal(await page.locator("#fOwnerWrap .sl-k").innerText(), "Owner:");
    const options = await page.$$eval("#fOwner option", (os) => os.map((o) => o.value));
    assert.deepEqual(options, ["", "Casey Reed", "Casey Stone", "Jordan Blake"],
      "Anyone, then each owner once, in alphabetical order (the board meets them as Reed, Blake, Stone)");
    await pick(page, "#fOwner", "Jordan Blake");
    assert.deepEqual(await shown(page), ["Alice Adams", "Dan Dyer"]);
    await pick(page, "#fOwner", "Casey Reed");
    assert.deepEqual(await shown(page), ["Bob Baker", "Zed Zane"], "Casey Reed's cards, not Casey Stone's");
    await pick(page, "#fOwner", "Casey Stone");
    assert.deepEqual(await shown(page), ["Cara Cole"], "a second owner with the same first name is told apart");
    await pick(page, "#fOwner", "");
    assert.deepEqual(await shown(page), ALL_NAMES);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the search box finds cards by name, phone, or email", { timeout: 120_000 }, async () => {
  await proof.check(/^Search box/, async () => {
    const { page, errors } = await openBoard();
    assert.equal(await page.locator("#q").getAttribute("placeholder"), "Search clients");
    assert.equal(await page.locator("#q").getAttribute("aria-label"), "Search clients by name");
    await page.locator("#q").fill("ali");
    assert.deepEqual(await shown(page), ["Alice Adams"]);
    await page.locator("#q").fill("  EVE ");
    assert.deepEqual(await shown(page), ["Eve East"], "case and outer spaces do not matter");
    await page.locator("#q").fill("adams");
    assert.deepEqual(await shown(page), ["Alice Adams"], "a surname finds the card, not only the first letters of the name");
    await page.locator("#q").fill("e e");
    assert.deepEqual(await shown(page), ["Eve East"], "words from the middle of a name are matched as typed");
    await page.locator("#q").fill("alice@example.com");
    assert.deepEqual(await shown(page), ["Alice Adams"], "an email finds its card");
    await page.locator("#q").fill("+15551112222");
    assert.deepEqual(await shown(page), ["Alice Adams"], "a phone finds its card");
    await page.locator("#q").fill("");
    assert.deepEqual(await shown(page), ALL_NAMES);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("each Sort choice works and Manual restores the read order", { timeout: 120_000 }, async () => {
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
    await pick(page, "#fSort", "");
    assert.deepEqual(await columnOrder(page, "new_lead"), first, "Manual gives back the order from the read");
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

    await pick(page, "#fSort", "name");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Alice Adams", "Dan Dyer", "Finn Fox", "Zed Zane"]);
    await page.locator("#filterChips .fchip", { hasText: "Sort:" }).locator(".x").click();
    assert.equal(await page.locator("#fSort").inputValue(), "", "the Sort select is cleared");
    assert.equal(await page.locator("#filterChips .fchip", { hasText: "Sort:" }).count(), 0, "and its chip is gone");
    assert.deepEqual(await columnOrder(page, "new_lead"), ["Zed Zane", "Alice Adams", "Finn Fox", "Dan Dyer"],
      "clearing the Sort chip restores Manual order");
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
  // The words as written (the page draws the eyebrow in capitals with CSS; the words themselves are what is judged).
  const words = (selector) => page.locator(selector).textContent().then((t) => t.replace(/\s+/g, " ").trim());

  await proof.check(/^Headline: Waiting on us/, async () => {
    const button = page.locator("#hlUs");
    assert.equal(await words("#hlUs .eyebrow"), "Waiting on us", "the big number is named by its words");
    assert.equal(await words("#hlUs"), "Waiting on us 3");
    assert.equal(await button.getAttribute("aria-pressed"), "false");
    await button.click();
    assert.equal(await page.locator("#fWait").inputValue(), "us", "the button writes the select");
    assert.equal(await button.getAttribute("aria-pressed"), "true");
    assert.deepEqual(await shown(page), ["Alice Adams", "Eve East", "Finn Fox"], "only the cards someone here must move");
    assert.equal(await page.locator("#filterChips .fchip > span").first().innerText(), "Waiting on: Us \u2014 someone here");
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
    // Each button is named by its words, and presses into the filter that keeps its own cards.
    assert.equal(await words("#hlBank"), "2 on a bank");
    assert.equal(await words("#hlClient"), "1 on the client");
    assert.equal(await words("#hlNone"), "2 nothing recorded");
    const expected = [
      ["#hlBank", "bank", ["Bob Baker", "Gus Green"], "Waiting on: A bank"],
      ["#hlClient", "client", ["Cara Cole"], "Waiting on: The client"],
      ["#hlNone", "none", ["Dan Dyer", "Zed Zane"], "Waiting on: Nothing recorded"],
    ];
    for (const [selector, value, names, chip] of expected) {
      const button = page.locator(selector);
      await button.click();
      assert.equal(await page.locator("#fWait").inputValue(), value, `${selector} writes the select`);
      assert.deepEqual(await shown(page), names, `${selector} shows its cards`);
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await page.locator("#filterChips .fchip > span").first().innerText(), chip,
        `${selector} says the same words as the select`);
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
    assert.equal((await link.innerText()).trim(), "Longest wait: Alice Adams \u2014 5d in stage, New Lead",
      "of the cards someone here must move, the one that waited longest (Alice, 5 days; Eve is 36 hours, Finn 30 minutes)");
    assert.equal(await link.getAttribute("href"), "#fh-card-card-alice");
    await link.click();
    await waitFor(() => page.locator("#fh-card-card-alice").evaluate((el) => el.classList.contains("fh-spot")), "the card to be ringed");
    // A filter that hides the card stops the jump being a control and says why.
    await openFilters(page);
    await pick(page, "#fWait", "client");
    assert.equal(await link.isHidden(), true, "the link is not drawn while its card is filtered out");
    assert.match(await page.locator("#hlNextNote").innerText(), /This filter hides the longest wait: Alice Adams/);
    await pick(page, "#fWait", "");
    assert.equal(await link.isVisible(), true, "and it comes back with the card");
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("the longest wait link scrolls the board to the card it names", { timeout: 120_000 }, async () => {
  // The column is taller than the screen and the card the link names sits at its very bottom, out of sight.
  // Only a real scroll can bring it into view, so a link that rings the card and does not scroll is red.
  const filler = Array.from({ length: 40 }, (_, i) => card(`fill${i}`, `Filler ${String(i).padStart(2, "0")}`, { entered_at: ago(HOUR) }));
  const tall = {
    ok: true, pipeline: "sales", total: 41,
    stages: [{
      key: "new_lead", name: "New Lead", sort_order: 0, count: 41, amount: 41000,
      cards: [...filler, card("far", "Far Away", { entered_at: ago(9 * DAY), sms_needs_reply: true })],
    }],
  };
  await proof.check(/^Headline: Longest wait link/, async () => {
    const { page, errors } = await openBoard({ boards: { sales: tall } });
    const body = page.locator('.col[data-stage-key="new_lead"] .col-body');
    const inView = () => page.evaluate(() => {
      const el = document.querySelector("#fh-card-card-far").getBoundingClientRect();
      const box = document.querySelector('.col[data-stage-key="new_lead"] .col-body').getBoundingClientRect();
      return el.top >= box.top - 1 && el.bottom <= box.bottom + 1;
    });
    assert.equal(await inView(), false, "before the click the card is below the fold of its column");
    assert.equal(await body.evaluate((el) => el.scrollTop), 0);
    assert.match((await page.locator("#hlNextLink").innerText()).trim(), /^Longest wait: Far Away /);
    await page.locator("#hlNextLink").click();
    await waitFor(inView, "the board to scroll the card into view");
    assert.ok(await body.evaluate((el) => el.scrollTop) > 0, "the column itself scrolled");
    assert.equal(await page.locator("#fh-card-card-far").evaluate((el) => el.classList.contains("fh-spot")), true, "and the card is ringed");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// The controls the lens puts away while it is up, and gives back as they were (public/app/pipeline.html,
// boardOnly): search, Filter, New Client, the filter chips, the headline with its summary, the filter panel and
// the Sales note. Each is read by what the browser draws, not by the page's own hidden flags.
const BOARD_ONLY = [
  [".search", "search"], ["#filterBtn", "the Filter button"], ["#fhNewClient", "New Client"], ["#filterChips", "the filter chips"],
  [".headline", "the headline"], [".board-summary", "the card summary"], ["#filterPanel", "the filter panel"], ["#railNote", "the Sales note"],
];
const drawnNow = (page) => page.evaluate((list) => Object.fromEntries(list.map(([selector]) => {
  const el = document.querySelector(selector);
  const style = el ? getComputedStyle(el) : null;
  return [selector, !!el && style.display !== "none" && style.visibility !== "hidden" && el.getClientRects().length > 0];
})), BOARD_ONLY);

test("the Board / Fulfillment switch swaps the view, reads the client list once, and gives the board back exactly as it was", { timeout: 120_000 }, async () => {
  const { page, errors } = await openBoard();
  const clientReads = () => page.apiCalls.filter((c) => c.path === "/api/dashboard/clients").map((c) => c.query);

  await proof.check(/^Lens switch: Board/, async () => {
    assert.equal(await page.locator("#lensBoard").getAttribute("aria-pressed"), "true");
    assert.equal((await page.locator("#lensBoard").innerText()).trim(), "Board");
    assert.equal((await page.locator("#lensFulfillment").innerText()).trim(), "Fulfillment");
    assert.deepEqual(clientReads(), [], "the client list is not read until Fulfillment is opened");

    // The board as it stands before the switch: the panel is shut, the Sales note and the headline are drawn.
    const before = await drawnNow(page);
    assert.equal(before["#filterPanel"], false, "the filter panel starts shut");
    for (const selector of [".search", "#filterBtn", "#fhNewClient", ".headline", ".board-summary", "#railNote"]) {
      assert.equal(before[selector], true, `${selector} is on the board before the switch`);
    }
    await page.locator("#lensFulfillment").click();
    assert.equal(await page.locator("#fhLens").isVisible(), true);
    assert.equal(await page.locator(".board-row").isHidden(), true, "the board is hidden");
    assert.equal(await page.locator("#lensFulfillment").getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("#lensBoard").getAttribute("aria-pressed"), "false");
    // Everything that only describes the board goes with it, the Sales note included.
    const during = await drawnNow(page);
    for (const [selector, label] of BOARD_ONLY) assert.equal(during[selector], false, `${label} is not drawn over the client list`);
    await waitFor(() => clientReads().length === 1, "the client list read");
    assert.deepEqual(clientReads(), [{ limit: "200", fulfillment: "1" }]);
    await page.waitForSelector(".fh-lens-row");
    assert.equal(await page.locator("#ltTotalClients").innerText(), "3");
    assert.equal(await page.locator(".fh-lens-row").count(), 3);

    await page.locator("#lensBoard").click();
    assert.equal(await page.locator(".board-row").isVisible(), true, "the board is back");
    assert.equal(await page.locator("#fhLens").isHidden(), true);
    assert.deepEqual(await drawnNow(page), before, "every control is exactly as it was: the shut panel did not spring open");

    // Opened this time: the filter panel and a filter chip are on the board, and they come back as they were.
    await openFilters(page);
    await pick(page, "#fWait", "bank");
    const set = await drawnNow(page);
    assert.equal(set["#filterPanel"], true);
    assert.equal(set["#filterChips"], true);
    await page.locator("#lensFulfillment").click();
    const away = await drawnNow(page);
    assert.equal(away["#filterPanel"], false, "the open panel goes while the lens is up");
    assert.equal(away["#filterChips"], false);
    await page.locator("#lensBoard").click();
    assert.deepEqual(await drawnNow(page), set, "the open panel and the chip come back, nothing re-applied or cleared");
    assert.equal(await page.locator("#fWait").inputValue(), "bank", "the filter itself was kept");
    assert.deepEqual(await shown(page), ["Bob Baker", "Gus Green"]);
    await pick(page, "#fWait", "");
    assert.equal(clientReads().length, 1, "opening it again does not read the list again");
  });

  await proof.check(/^Fulfillment lens: click a chip/, async () => {
    await page.locator("#lensFulfillment").click();
    const rows = () => visibleNames(page, ".fh-lens-row", ".lr-name");
    const chipOf = (clientId) => page.locator(`.fh-lens-row[data-client-id="${clientId}"] .fh-chip`);
    const lit = () => page.$$eval(".fh-lens-row .fh-chip.on", (els) => els.map((e) => e.closest(".fh-lens-row").dataset.clientId).sort());
    assert.deepEqual(await rows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.deepEqual(await lit(), [], "no chip is lit while nothing is filtered");
    assert.equal(await page.locator("#fhLensBar").isHidden(), true);
    assert.equal((await chipOf("c2").innerText()).trim(), "Send documents");
    await chipOf("c2").click();
    assert.deepEqual(await rows(), ["Mo Marsh"], "only the clients whose next action is Send documents");
    assert.deepEqual(await lit(), ["c2"], "the chip you pressed is lit");
    assert.equal(await page.locator("#fhLensBarText").innerText(), 'Showing only "Send documents" \u2014 1 of 3 clients.');
    // Click the same chip again: the filter clears.
    await chipOf("c2").click();
    assert.deepEqual(await rows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.deepEqual(await lit(), [], "and the chip goes out");
    assert.equal(await page.locator("#fhLensBar").isHidden(), true);
    // A chip two clients share shows both, lights both, and Show all clears it.
    await chipOf("c1").click();
    assert.deepEqual(await rows(), ["Lena Lopez", "Nia North"]);
    assert.deepEqual(await lit(), ["c1", "c3"], "every client with that action is lit");
    assert.equal(await page.locator("#fhLensBarText").innerText(), 'Showing only "Pull the report" \u2014 2 of 3 clients.');
    assert.equal((await page.locator("#fhLensClear").innerText()).trim(), "Show all");
    await page.locator("#fhLensClear").click();
    assert.deepEqual(await rows(), ["Lena Lopez", "Mo Marsh", "Nia North"]);
    assert.deepEqual(await lit(), []);
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
      // Current main keeps the rail code as machine state and gives people the exact rail name.
      assert.equal(await tab.getAttribute("data-rail"), code, `${label}: the tab owns the right rail code`);
      assert.equal((await tab.textContent()).trim(), label, `${label}: the tab says the rail's name`);
      assert.equal(await tab.getAttribute("title"), label, `${label}: the full name is also its title`);
      assert.deepEqual(
        await page.$$eval(".rail-tab", (els) => els.map((e) => e.dataset.rail)),
        RAILS.map(([, rail]) => rail),
        "the seven tabs, in rail order",
      );
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
    const details = page.locator(".pipeline-details");
    assert.equal((await details.locator("summary").innerText()).trim(), "Board details");
    await details.locator("summary").click();
    const note = page.locator("#railNote");
    assert.equal(await note.isVisible(), true);
    assert.equal(
      (await note.innerText()).trim(),
      "Payments do not change sales stages. After a deposit, move the card to Closed Won (deposit).",
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
