// Batch 18 practice tests: the Pipeline board (public/app/pipeline.html) in a real Chromium with fake /api
// answers (no live data).
//
//   Filter button       opens and shuts the filter panel and counts the filters that are on
//   Filter: Age         Any / Over 1h / Over 1d / Over 3d in stage, decided by the card's own arrival time
//   Clear all           puts every filter back, empties the chips, and shows every card again
//   Card hover tooltip  the card's last-activity footer, shown on hover and gone on leave
//   Clock and LIVE pill the Arizona clock (only on a wide screen) and the LIVE pill
//   Drawer link         the "Open full file" link in a card's drawer goes to that client's control panel

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const SURFACE = "public/app/pipeline.html";
const MIN = 60_000;
const ago = (minutes) => new Date(Date.now() - minutes * MIN).toISOString();

const card = (id, name, over = {}) => ({
  id: `card-${id}`, client_id: `aaaaaaaa-1111-4111-8111-${String(id).padStart(12, "0")}`, name,
  owner: null, entered_at: ago(120), outcome_tier: null, funded: false, amount: 3000,
  sms_needs_reply: false, email_needs_reply: false, approval_amount_missing: false, ...over,
});
const stage = (key, name, cards) => ({ key, name, sort_order: 0, count: cards.length, amount: cards.reduce((s, c) => s + (c.amount || 0), 0), cards });

async function openBoard(cards, { viewport, clock = false, handlers = {} } = {}) {
  const board = { ok: true, pipeline: "sales", total: cards.length, stages: [stage("new_lead", "New Lead", cards)] };
  const opened = await screens.open("/app/pipeline.html", {
    session: OWNER, viewport, clock,
    handlers: { "/api/dashboard/pipeline?": board, ...handlers },
  });
  await opened.page.waitForSelector(".board .card");
  return opened;
}

const visibleNames = (page) => page.evaluate(() => [...document.querySelectorAll(".board .card")]
  .filter((c) => getComputedStyle(c).display !== "none" && !c.classList.contains("filtered"))
  .map((c) => c.querySelector(".c-name").textContent).sort());

// ───────────────────────── Filter button, Age and Clear all ─────────────────────────

const AGED = [
  card(1, "Just Moved", { entered_at: ago(30) }),
  card(2, "Two Hours", { entered_at: ago(120) }),
  card(3, "Two Days", { entered_at: ago(2 * 1440) }),
  card(4, "Five Days", { entered_at: ago(5 * 1440) }),
  card(5, "No Date", { entered_at: null }),
];

// Two cards whose words round UP across a choice: 23h 31m is shown as "24h in stage" (a day) and 2d 13h as
// "3d in stage", but neither has sat a full day / three days. The filter must go by the arrival time, not by
// the rounded words, so these are NOT over 1d and NOT over 3d. (23h 31m is the lowest age that still reads
// "24h", which keeps the card 29 minutes clear of reading "1d" while the suite runs.)
const ROUNDED_HOURS = card(6, "Almost A Day", { entered_at: ago(23 * 60 + 31) });
const ROUNDED_DAYS = card(7, "Almost Three Days", { entered_at: ago(2 * 1440 + 13 * 60) });

// Cards with an owner on them, so the Owner choice (hidden until a card has one) is on the board.
const OWNED = [
  card(1, "Jordan Fresh", { owner: "Jordan Blake", entered_at: ago(30) }),
  card(2, "Casey Old", { owner: "Casey Reed", entered_at: ago(5 * 1440) }),
  card(3, "Nobody Old", { entered_at: ago(5 * 1440) }),
];

test("Filter button: it opens and shuts the panel and counts the filters that are on", { timeout: 120_000 }, async () => {
  await proof.check(/^Filter button \(opens the panel; count of active filters\)/, async () => {
    const { page, errors } = await openBoard(AGED);
    const button = page.locator("#filterBtn");
    const panel = page.locator("#filterPanel");
    const count = page.locator("#filterN");
    assert.equal(await panel.isVisible(), false, "the panel starts shut");
    assert.equal(await button.getAttribute("aria-expanded"), "false");
    assert.equal(await count.isVisible(), false, "no count while nothing is filtered");

    await button.click();
    assert.equal(await panel.isVisible(), true);
    assert.equal(await button.getAttribute("aria-expanded"), "true");
    await button.click();
    assert.equal(await panel.isVisible(), false, "pressing it again shuts the panel");
    assert.equal(await button.getAttribute("aria-expanded"), "false");

    await button.click();
    await page.locator("#fAge").selectOption("1440");
    assert.equal((await count.innerText()).trim(), "1", "one filter on");
    await page.locator("#fWait").selectOption("none");
    assert.equal((await count.innerText()).trim(), "2", "two filters on");
    await page.locator("#fSort").selectOption("name");
    assert.equal((await count.innerText()).trim(), "3", "sort counts as a filter in the bar");
    // the count stays when the panel is shut: it is the only sign filters are on
    await button.click();
    assert.equal(await panel.isVisible(), false);
    assert.equal((await count.innerText()).trim(), "3");
    assert.equal(await count.isVisible(), true);
    assert.deepEqual(errors, []);
    await page.close();

    // The Owner choice is the fourth thing the count adds up. It shows only when a card on the board has an
    // owner, so this board does.
    const owned = await openBoard(OWNED);
    const ownedCount = owned.page.locator("#filterN");
    await owned.page.locator("#filterBtn").click();
    assert.equal(await owned.page.locator("#fOwnerWrap").isVisible(), true, "the Owner choice is there when a card has an owner");
    assert.deepEqual(await owned.page.locator("#fOwner option").evaluateAll((os) => os.map((o) => o.textContent)), ["Anyone", "Casey Reed", "Jordan Blake"]);
    await owned.page.locator("#fOwner").selectOption("Jordan Blake");
    assert.equal((await ownedCount.innerText()).trim(), "1", "the owner choice counts as a filter");
    assert.equal((await owned.page.locator("#filterChips .fchip").innerText()).replace(/\s+/g, " ").trim(), "Owner: Jordan Blake ×");
    assert.deepEqual(await visibleNames(owned.page), ["Jordan Fresh"], "only that owner's card is left");
    await owned.page.locator("#fAge").selectOption("60");
    await owned.page.locator("#fWait").selectOption("none");
    assert.equal((await ownedCount.innerText()).trim(), "3", "owner, age and waiting-on are three");
    await owned.page.locator("#fSort").selectOption("name");
    assert.equal((await ownedCount.innerText()).trim(), "4", "owner, age, waiting-on and sort are four");
    await owned.page.locator("#filterBtn").click();
    assert.equal((await ownedCount.innerText()).trim(), "4", "the count stays when the panel is shut");
    assert.deepEqual(owned.errors, []);
    await owned.page.close();
  }, SURFACE);
});

test("Filter: Age keeps a card only when it has sat in its stage longer than the choice, and a card with no date never counts", { timeout: 120_000 }, async () => {
  await proof.check(/^Filter: Age \(Any \/ Over 1h \/ Over 1d \/ Over 3d in stage\)/, async () => {
    const { page, errors } = await openBoard([...AGED, ROUNDED_HOURS, ROUNDED_DAYS]);
    await page.locator("#filterBtn").click();
    const options = await page.locator("#fAge option").evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
    assert.deepEqual(options, [["", "Any"], ["60", "Over 1h in stage"], ["1440", "Over 1d in stage"], ["4320", "Over 3d in stage"]]);

    // the words on the two near cards round up: the card says a day, the clock says not yet
    const said = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".board .card")]
      .map((c) => [c.querySelector(".c-name").textContent, c.querySelector(".c-age").textContent.trim()])));
    assert.equal(said["Almost A Day"], "24h in stage", "23h 31m is worded as a day");
    assert.equal(said["Almost Three Days"], "3d in stage", "2d 13h is worded as three days");

    const ALL = ["Almost A Day", "Almost Three Days", "Five Days", "Just Moved", "No Date", "Two Days", "Two Hours"];
    assert.deepEqual(await visibleNames(page), ALL, "Any shows every card");
    const cases = [
      ["60", ["Almost A Day", "Almost Three Days", "Five Days", "Two Days", "Two Hours"]],
      ["1440", ["Almost Three Days", "Five Days", "Two Days"]],
      ["4320", ["Five Days"]],
      ["", ALL],
    ];
    for (const [value, expected] of cases) {
      await page.locator("#fAge").selectOption(value);
      assert.deepEqual(await visibleNames(page), expected, `Age "${value || "Any"}"`);
    }
    // the choice shows as a chip with its words
    await page.locator("#fAge").selectOption("1440");
    assert.equal((await page.locator("#filterChips .fchip").innerText()).replace(/\s+/g, " ").trim(), "Age: Over 1d in stage ×");
    // and the chip's cross takes the filter off again
    await page.locator("#filterChips .fchip .x").click();
    assert.equal(await page.locator("#fAge").inputValue(), "");
    assert.deepEqual(await visibleNames(page), ALL);
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("Clear all: it puts every filter back, empties the chips and the count, and shows every card", { timeout: 120_000 }, async () => {
  await proof.check(/^Clear all \(button in the filter panel\)/, async () => {
    const cards = [
      card(1, "Old And Quiet", { entered_at: ago(5 * 1440) }),
      card(2, "Old And Waiting", { entered_at: ago(5 * 1440), sms_needs_reply: true, owner: "Jordan Blake" }),
      card(3, "New And Quiet", { entered_at: ago(30) }),
    ];
    const { page, errors } = await openBoard(cards);
    await page.locator("#filterBtn").click();
    await page.locator("#fAge").selectOption("4320");
    await page.locator("#fWait").selectOption("us");
    await page.locator("#fOwner").selectOption("Jordan Blake");
    await page.locator("#fSort").selectOption("name");
    assert.deepEqual(await visibleNames(page), ["Old And Waiting"], "age, waiting-on and owner together leave one card");
    assert.equal(await page.locator("#filterChips .fchip").count(), 4);
    assert.equal((await page.locator("#filterN").innerText()).trim(), "4");

    await page.locator("#filterClear").click();
    assert.deepEqual(await page.evaluate(() => ["fWait", "fOwner", "fAge", "fSort"].map((id) => document.getElementById(id).value)), ["", "", "", ""], "every select is back to its first choice, the owner one too");
    assert.equal(await page.locator("#filterChips .fchip").count(), 0, "no chips are left");
    assert.equal(await page.locator("#filterN").isVisible(), false, "the count is gone");
    assert.deepEqual(await visibleNames(page), ["New And Quiet", "Old And Quiet", "Old And Waiting"], "every card is shown again, the ones with no owner too");
    assert.equal(await page.locator("#filterPanel").isVisible(), true, "the panel stays open so the next filter is one choice away");
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

// ───────────────────────── Card hover tooltip ─────────────────────────

test("Card tooltip: hovering a card shows its last activity from the footer, and leaving hides it", { timeout: 120_000 }, async () => {
  await proof.check(/^Card: hover tooltip \(last activity from the card footer\)/, async () => {
    const cards = [
      card(1, "Owned Card", { owner: "Jordan Blake", outcome_tier: "Tier A" }),
      card(2, "Loose Card"),
      card(3, "Funded Card", { owner: "Casey Reed", funded: true }),
    ];
    const { page, errors } = await openBoard(cards);
    const tip = page.locator(".card-tip");
    const named = (name) => page.locator(".board .card", { hasText: name });
    assert.equal(await tip.isVisible(), false, "no tooltip at rest");

    await named("Owned Card").hover();
    await waitFor(async () => tip.isVisible(), "the tooltip", 4000);
    assert.deepEqual((await tip.innerText()).split("\n").map((l) => l.trim()).filter(Boolean), ["LAST ACTIVITY", "Jordan Blake owns this card", "Tier A"]);
    assert.equal(await tip.locator("b").innerText(), "Jordan Blake", "the owner's name is in bold");

    await named("Loose Card").hover();
    await waitFor(async () => /unassigned/.test(await tip.innerText()), "the unassigned tooltip", 4000);
    assert.doesNotMatch(await tip.innerText(), /owns this card/);
    assert.equal((await tip.locator(".tw").innerText()).trim(), "", "no second line when the card has no tier");

    await named("Funded Card").hover();
    await waitFor(async () => /funded/.test(await tip.locator(".tw").innerText().catch(() => "")), "the funded tooltip", 4000);
    assert.match(await tip.innerText(), /Casey Reed owns this card/);

    // the tooltip sits beside the card, not over its name
    const placed = await page.evaluate(() => {
      const t = document.querySelector(".card-tip").getBoundingClientRect();
      const c = [...document.querySelectorAll(".board .card")].find((el) => /Funded Card/.test(el.textContent)).getBoundingClientRect();
      return { overlapsTop: t.top < c.top && t.bottom > c.top && t.left < c.right && t.right > c.left };
    });
    assert.equal(placed.overlapsTop, false, "the tooltip does not sit on top of its card's name");

    await page.mouse.move(2, 2);
    await waitFor(async () => !(await tip.isVisible()), "the tooltip to go", 4000);
    await named("Owned Card").hover();
    await waitFor(async () => tip.isVisible(), "the tooltip again", 4000);
    await page.mouse.down();
    assert.equal(await tip.isVisible(), false, "pressing anywhere hides it");
    await page.mouse.up();
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

// ───────────────────────── Clock and LIVE pill ─────────────────────────

test("Clock and LIVE pill: the clock tells Arizona time on a wide screen, the LIVE pill is always there", { timeout: 120_000 }, async () => {
  await proof.check(/^Clock \(Arizona time\) and LIVE pill in the header/, async () => {
    const openTechnicalDetails = async (page) => {
      await page.locator("#fh-shell-chip-show").click();
      await page.locator("#fh-shell-account-diagnostics > summary").click();
      const clock = page.locator("#fh-workspace-clock");
      const source = page.locator("#fh-shell-src");
      await waitFor(() => clock.isVisible(), "the workspace account clock");
      await waitFor(async () => (await source.innerText()).trim() === "LIVE", "the live workspace status");
      return { clock, source };
    };

    // 2023-11-14 22:13:21 UTC is 3:13:21 PM in Arizona (MST all year). The machine is set to New York on purpose.
    const wide = await openBoard([card(1, "Anyone")], { viewport: { width: 1700, height: 900 }, clock: true });
    const cdp = await wide.page.context().newCDPSession(wide.page);
    await cdp.send("Emulation.setTimezoneOverride", { timezoneId: "America/New_York" });
    await wide.page.clock.runFor(1000);
    const wideAccount = await openTechnicalDetails(wide.page);
    assert.equal((await wideAccount.clock.innerText()).trim(), "Tue, Nov 14, 3:13:22 PM MST", "Arizona time, whatever the machine's clock says");
    await wide.page.clock.runFor(3000);
    assert.equal((await wideAccount.clock.innerText()).trim(), "Tue, Nov 14, 3:13:25 PM MST", "it ticks every second");
    assert.equal((await wideAccount.source.innerText()).trim(), "LIVE");
    assert.deepEqual(wide.errors, []);
    await wide.page.close();

    // Current-main keeps both facts in the account menu at every width, so the
    // workspace stays uncluttered while Arizona time and live status remain one tap away.
    const laptop = await openBoard([card(1, "Anyone")], { viewport: { width: 1280, height: 800 } });
    const laptopAccount = await openTechnicalDetails(laptop.page);
    assert.match((await laptopAccount.clock.innerText()).trim(), /^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2}:\d{2} (AM|PM) MST$/, "the laptop clock is Arizona time too");
    assert.equal((await laptopAccount.source.innerText()).trim(), "LIVE");
    await laptop.page.close();
    const phone = await openBoard([card(1, "Anyone")], { viewport: { width: 400, height: 800 } });
    const phoneAccount = await openTechnicalDetails(phone.page);
    assert.equal(await phoneAccount.clock.isVisible(), true, "the clock remains available from the phone account menu");
    assert.equal((await phoneAccount.source.innerText()).trim(), "LIVE");
    assert.equal(await phone.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, "nothing pushes the page sideways");
    await phone.page.close();
  }, SURFACE);
});

// ───────────────────────── Drawer: Open full file ─────────────────────────

test("Drawer: pressing a card opens its drawer, and Open full file goes to that client's control panel", { timeout: 120_000 }, async () => {
  await proof.check(/^Drawer: Open full file link \(client-control-panel\.html\?id=\)/, async () => {
    const cards = [card(1, "Dana Whitfield"), card(2, "Eli Park")];
    const seen = [];
    const client = async (route, { url }) => {
      const id = new URL(url).searchParams.get("id");
      seen.push(id);
      return json(route, { ok: true, client: { id, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+15550100", custom_fields: {} },
        transactions: [], crs_results: [], messages: [], tasks: [] });
    };
    const { page, errors } = await openBoard(cards, { handlers: { "/api/dashboard/client?": client } });
    const drawer = page.locator("#fhDrawer");
    assert.equal(await drawer.getAttribute("aria-hidden"), "true", "the drawer starts shut");
    await page.locator(".board .card", { hasText: "Dana Whitfield" }).locator(".c-name").click();
    await page.waitForSelector("#fhDrawer.open .fh-drawer-links a");
    assert.equal(await drawer.getAttribute("aria-hidden"), "false");
    const link = page.locator("#fhDrawer .fh-drawer-links a");
    assert.equal((await link.innerText()).trim(), "Open full file ↗");
    assert.equal(await link.getAttribute("href"), `client-control-panel.html?id=${cards[0].client_id}`);

    // the second card's drawer points at the second client, not the first
    await page.locator("#fhDrawerClose").click();
    await page.locator(".board .card", { hasText: "Eli Park" }).locator(".c-name").click();
    await waitFor(async () => (await page.locator("#fhDrawerName").innerText()).includes("Eli Park"), "the second drawer name", 4000);
    await waitFor(async () => (await link.getAttribute("href")) === `client-control-panel.html?id=${cards[1].client_id}`, "the second link", 4000);

    await link.click();
    await page.waitForURL((u) => u.pathname === "/app/client-control-panel.html" && u.searchParams.get("id") === cards[1].client_id);
    assert.deepEqual(errors, []);
    await page.close();
  }, SURFACE);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
