/* THE BOARD ANSWERS "WHAT IS WAITING ON ME" — in a real browser.
 *
 * src/http/pipeline-screen.test.mjs proves the RULE: which bucket a card lands
 * in, that it lands in exactly one, and that unknown stays unknown. It reads
 * the file. It cannot tell you whether any of it reaches the screen.
 *
 * This clicks it. NO BACKEND — page.route() answers /api/** (see
 * e2e/harness.mjs), which is the only practical way to put the board in the
 * states worth checking: a rail with nothing waiting, a rail that failed to
 * answer, and a rail carrying forty cards rather than three (UI-STANDARDS §6
 * — "designed against realistic volume").
 */

import { test, expect } from "@playwright/test";
import { openScreen, OWNER, CLIENT_ID } from "./harness.mjs";

const DAY = 86400000;

/** A board card. Everything defaults to "nothing is waiting" so each test only
 *  states the one fact it is about. */
function card(over) {
  return {
    id: "card-1", client_id: CLIENT_ID, name: "Dana Whitfield",
    owner: null, entered_at: new Date(Date.now() - 2 * DAY).toISOString(),
    outcome_tier: null, funded: false, amount: 3000,
    sms_needs_reply: false, email_needs_reply: false,
    approval_amount_missing: false,
    ...over
  };
}

function board(stages) {
  return { "/api/dashboard/pipeline": { ok: true, pipeline: "sales", stages, total: 0 } };
}

const stage = (key, name, cards) => ({
  key, name, sort_order: 0, count: cards.length,
  amount: cards.reduce((a, c) => a + (c.amount || 0), 0), cards
});

test.describe("pipeline — the headline answers what is waiting on us", () => {

  test("the number counts the cards a person here has to move", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [
        card({ id: "a", name: "Ann Awaiting", sms_needs_reply: true }),
        card({ id: "b", name: "Ben Quiet" })
      ]),
      stage("round_submitted", "Round Submitted", [
        card({ id: "c", name: "Cal Bank" })
      ]),
      stage("action_required", "Action Required", [
        card({ id: "d", name: "Dee Client" })
      ])
    ]));

    await expect(page.locator("#hlUsN")).toHaveText("1", { timeout: 10_000 });
    await expect(page.locator("#hlBank b")).toHaveText("1");
    await expect(page.locator("#hlClient b")).toHaveText("1");
    await expect(page.locator("#hlNone b")).toHaveText("1");
    // The four buckets and the card count are one arithmetic statement. If they
    // ever disagree the screen contradicts itself on its own first line.
    await expect(page.locator("#sumCount")).toHaveText("4");
  });

  test("a card waiting on us AND sitting with a bank is counted once, not twice", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("round_submitted", "Round Submitted", [
        card({ id: "a", name: "Both At Once", sms_needs_reply: true })
      ])
    ]));
    await expect(page.locator("#hlUsN")).toHaveText("1", { timeout: 10_000 });
    await expect(page.locator("#hlBank b")).toHaveText("0");
    await expect(page.locator("#sumCount")).toHaveText("1");
  });

  test("the next action names one card, and clicking it goes to that card", async ({ page }) => {
    const old = new Date(Date.now() - 9 * DAY).toISOString();
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [
        card({ id: "newer", name: "Newer Person", sms_needs_reply: true }),
        card({ id: "older", name: "Older Person", sms_needs_reply: true, entered_at: old })
      ])
    ]));

    const link = page.locator("#hlNextLink");
    await expect(link).toContainText("Older Person", { timeout: 10_000 });
    await expect(link).toContainText("9d in stage");
    await expect(link).toContainText("New Lead");                  // the stage it is stuck in

    await link.click();
    await expect(page.locator("#fh-card-older")).toHaveClass(/fh-spot/);
  });

  test("the card it sends you to is RINGED — the class is not the point, the paint is", async ({ page }) => {
    /* This test exists because the class assertion above passed green for a
       highlight that painted nothing. The rule shipped as
       `box-shadow:0 0 0 3px var(--spectrum)`, and --spectrum is a gradient, so
       the whole declaration was invalid and fell back to `none` — which also
       threw away the resting shadow the brand file gives every card. The card
       you had just been sent to was the flattest one on the board.

       So: measure what the browser actually computed, and measure it against a
       neighbour, because "looks like every other card" is the failure. */
    const old = new Date(Date.now() - 9 * DAY).toISOString();
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [
        card({ id: "newer", name: "Newer Person", sms_needs_reply: true }),
        card({ id: "older", name: "Older Person", sms_needs_reply: true, entered_at: old })
      ])
    ]));

    const spot = page.locator("#fh-card-older");
    const plain = page.locator("#fh-card-newer");
    await expect(page.locator("#hlNextLink")).toContainText("Older Person", { timeout: 10_000 });

    const before = await plain.evaluate((el) => getComputedStyle(el).boxShadow);
    await page.locator("#hlNextLink").click();
    await expect(spot).toHaveClass(/fh-spot/);

    const ringed = await spot.evaluate((el) => getComputedStyle(el).boxShadow);

    // It paints at all. A value the browser cannot parse computes to "none".
    expect(ringed).not.toBe("none");
    // It is a 3px ring, not just the shadow every card already has.
    expect(ringed).toContain("0px 0px 0px 3px");
    // It differs from an untouched card beside it, which is the whole job.
    expect(ringed).not.toBe(before);
    // The resting shadow is kept, not replaced — the card must not go flat.
    expect(ringed.startsWith(before)).toBe(true);

    // The pointer landing on the card must not wipe the ring: .card:hover is
    // declared later at the same specificity and wins the tie unless the spot
    // rule names :hover too.
    await spot.hover();
    expect(await spot.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(ringed);
  });

  test("a filter that hides the card stops the jump being a control at all", async ({ page }) => {
    /* .card.filtered is display:none, and display:none leaves the node in the
       DOM. So getElementById still found it, the handler's `if (!el) return`
       never fired, scrollIntoView on a box-less element scrolled nowhere, and
       the ring was painted on a card nobody could see: an underlined link that
       did nothing whatever when pressed. Measured here with the board's OWN
       counter, because two controls in the same row silently killing each
       other is the worst version of it. */
    const old = new Date(Date.now() - 9 * DAY).toISOString();
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [
        card({ id: "older", name: "Older Person", sms_needs_reply: true, entered_at: old })
      ]),
      stage("round_submitted", "Round Submitted", [card({ id: "bank", name: "With Bank" })])
    ]));

    const link = page.locator("#hlNextLink");
    const target = page.locator("#fh-card-older");
    await expect(link).toContainText("Older Person", { timeout: 10_000 });

    // "on a bank" — the longest wait is not a bank card, so it leaves the board.
    await page.locator("#hlBank").click();
    await expect(target).toHaveClass(/filtered/);
    await expect(link).toBeHidden();
    // The fact is still true, so it survives as plain text. Only the control goes.
    await expect(page.locator("#hlNextNote"))
      .toContainText("This filter hides the longest wait: Older Person");

    // Clear the filter: the control comes back, and it still does its job.
    await page.locator("#hlBank").click();
    await expect(link).toBeVisible();
    await expect(page.locator("#hlNextNote")).toBeHidden();
    await link.click();
    await expect(target).toHaveClass(/fh-spot/);
  });

  test("nothing waiting says so in words — never a bare zero with no meaning", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("round_submitted", "Round Submitted", [card({ id: "a" })])
    ]));
    await expect(page.locator("#hlUsN")).toHaveText("0", { timeout: 10_000 });
    await expect(page.locator("#hlNextNote"))
      .toHaveText("Nothing on this rail is waiting on someone here.");
    await expect(page.locator("#hlNextLink")).toBeHidden();
  });

  test("an empty rail is a real zero and says the rail is empty", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, board([stage("new_lead", "New Lead", [])]));
    await expect(page.locator("#hlUsN")).toHaveText("0", { timeout: 10_000 });
    await expect(page.locator("#hlNextNote")).toHaveText("No cards on this rail.");
  });

  test("A READ THAT FAILED IS A DASH, NEVER A ZERO", async ({ page }) => {
    /* The whole point of the batch. A 0 here would tell a funding advisor that
       nothing needs them, which is the one thing an unanswered read can never
       prove. */
    await openScreen(page, "/app/pipeline.html", OWNER, {
      "/api/dashboard/pipeline": (route) => route.fulfill({
        status: 503, contentType: "application/json",
        body: JSON.stringify({ ok: false, db: "down", error: "unreachable" })
      })
    });
    await expect(page.locator("#hlUsN")).toHaveText("—", { timeout: 10_000 });
    await expect(page.locator("#hlBank b")).toHaveText("—");
    await expect(page.locator("#hlClient b")).toHaveText("—");
    await expect(page.locator("#hlNone b")).toHaveText("—");
    await expect(page.locator("#hlNextNote")).toContainText("unknown");
  });

  test("the number is the leftmost thing on the page, above every control", async ({ page }) => {
    // UI-STANDARDS §1. Measured, not asserted from the markup: the metric's
    // left edge must not be to the right of the filter bar's first control,
    // and it must sit above it.
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [card({ id: "a", sms_needs_reply: true })])
    ]));
    await expect(page.locator("#hlUsN")).toHaveText("1", { timeout: 10_000 });
    const metric = await page.locator("#hlUsN").boundingBox();
    const firstControl = await page.locator(".filterbar .lens-switch").boundingBox();
    expect(metric.x).toBeLessThanOrEqual(firstControl.x + 1);
    expect(metric.y).toBeLessThan(firstControl.y);
  });
});

test.describe("pipeline — Waiting on, as a filter", () => {

  const FOUR = board([
    stage("new_lead", "New Lead", [
      card({ id: "us-msg", name: "Us Message", sms_needs_reply: true }),
      card({ id: "us-amt", name: "Us Amount", approval_amount_missing: true }),
      card({ id: "nothing", name: "No Signal" })
    ]),
    stage("round_submitted", "Round Submitted", [card({ id: "bank", name: "With Bank" })]),
    stage("action_required", "Action Required", [card({ id: "client", name: "With Client" })])
  ]);

  const shown = (page) => page.locator(".card:not(.filtered)");

  test("clicking a counter filters the board to it", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, FOUR);
    await expect(shown(page)).toHaveCount(5, { timeout: 10_000 });

    await page.locator("#hlBank").click();
    await expect(shown(page)).toHaveCount(1);
    await expect(shown(page)).toContainText("With Bank");

    // Pressing the same one again clears it.
    await page.locator("#hlBank").click();
    await expect(shown(page)).toHaveCount(5);
  });

  test("the counter and the select are one filter, not two", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, FOUR);
    await expect(shown(page)).toHaveCount(5, { timeout: 10_000 });

    await page.locator("#hlUs").click();
    await expect(shown(page)).toHaveCount(2);
    // The select moved with it, and the active filter surfaced as a chip.
    await expect(page.locator("#fWait")).toHaveValue("us");
    await expect(page.locator("#filterChips")).toContainText("Waiting on");
    await expect(page.locator("#filterN")).toHaveText("1");
  });

  test("'us — an approval amount' narrows to the approvals with no dollars", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, FOUR);
    await expect(shown(page)).toHaveCount(5, { timeout: 10_000 });
    await page.locator("#filterBtn").click();     // the selects live behind one control
    await page.locator("#fWait").selectOption("us_amount");
    await expect(shown(page)).toHaveCount(1);
    await expect(shown(page)).toContainText("Us Amount");
  });

  test("Clear all releases the Waiting on filter with everything else", async ({ page }) => {
    await openScreen(page, "/app/pipeline.html", OWNER, FOUR);
    await expect(shown(page)).toHaveCount(5, { timeout: 10_000 });
    await page.locator("#hlClient").click();
    await expect(shown(page)).toHaveCount(1);
    await page.locator("#filterBtn").click();
    await page.locator("#filterClear").click();
    await expect(shown(page)).toHaveCount(5);
    await expect(page.locator("#hlClient")).not.toHaveClass(/\bon\b/);
  });
});

test.describe("pipeline — forty cards, not three", () => {

  test("the headline still reads at realistic volume and the counts add up", async ({ page }) => {
    /* UI-STANDARDS §6: the FULL state is designed against real volume. Forty
       cards across four stages, a third of them waiting on somebody here. */
    const many = (n, key, name, over) => stage(key, name, Array.from({ length: n }, (_, i) =>
      card({ id: `${key}-${i}`, name: `Client ${key} ${i}`,
             entered_at: new Date(Date.now() - (i + 1) * DAY).toISOString(), ...over })));

    await openScreen(page, "/app/pipeline.html", OWNER, board([
      many(14, "new_lead", "New Lead", { sms_needs_reply: true }),
      many(11, "round_submitted", "Round Submitted", {}),
      many(9, "action_required", "Action Required", {}),
      many(6, "booked", "Booked", {})
    ]));

    await expect(page.locator("#hlUsN")).toHaveText("14", { timeout: 10_000 });
    await expect(page.locator("#hlBank b")).toHaveText("11");
    await expect(page.locator("#hlClient b")).toHaveText("9");
    await expect(page.locator("#hlNone b")).toHaveText("6");
    await expect(page.locator("#sumCount")).toHaveText("40");

    // The oldest card waiting on us is the 14th New Lead, 14 days in.
    await expect(page.locator("#hlNextLink")).toContainText("Client new_lead 13");
    await expect(page.locator("#hlNextLink")).toContainText("14d in stage");

    // And the page still does not scroll sideways (§11).
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("on a phone the number keeps the top of the screen and nothing runs off the edge", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await openScreen(page, "/app/pipeline.html", OWNER, board([
      stage("new_lead", "New Lead", [card({ id: "a", sms_needs_reply: true })])
    ]));
    await expect(page.locator("#hlUsN")).toHaveText("1", { timeout: 10_000 });

    // Phone breakdown is progressively disclosed; its filters remain keyboard reachable.
    await expect(page.locator("#hlBank")).toBeHidden();
    await page.locator("#waitingDetails > summary").focus();
    await page.keyboard.press("Enter");
    const metric = await page.locator("#hlUsN").boundingBox();
    const counters = await page.locator("#hlBank").boundingBox();
    expect(metric.y).toBeLessThan(counters.y);              // headline first, counters under it
    expect(counters.x + counters.width).toBeLessThanOrEqual(390);   // nothing past the edge

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
