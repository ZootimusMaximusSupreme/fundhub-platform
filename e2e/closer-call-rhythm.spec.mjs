// THE CALL SCREEN, IN A REAL BROWSER, IN ALL FOUR STATES.
//
// Everything the unit tests can prove about this screen they prove by reading
// files. These four assertions cannot be made that way, and each one is a bug
// that shipped:
//
//   * A dollar figure of $0 standing in for "nobody has pulled their credit."
//   * The closer's own name rendered above the name of the person on the call.
//   * The compliance checklist pushed below the fold on a 13" laptop.
//   * A 5-column table sliding the whole page sideways on a phone.
//
// No backend. page.route() answers every /api/** call, exactly as
// e2e/sales-dashboards.spec.mjs does, so these states are reachable on demand
// rather than whenever a real database happens to be in them.

import { test, expect } from "@playwright/test";
import { CLIENT_ID, CLOSER, openScreen, freezeClock } from "./harness.mjs";

const NOW = "2026-09-01T16:40:00.000Z";
const DUE = "2026-09-01T17:00:00.000Z";
const NEXT_DUE = "2026-09-01T18:00:00.000Z";

/** A cockpit payload with every knob this spec needs to turn. */
function cockpit(over = {}) {
  return {
    ok: true,
    staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
    kpis: {
      cash_today_cents: { cents: 0, display: "$0", deposits: 0 },
      cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0,
      close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a"
    },
    client: {
      id: CLIENT_ID, name: "Dana Whitfield", business_name: "Whitfield Freight",
      age_months: 26, tags: [], funded: false,
      pipeline: { stage_key: "closing", stage_name: "Closing" }
    },
    credit: { available: false, reason: "No crs_results row for this client yet" },
    underwrite: {
      matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty",
      lite_banner_funding: null,
      totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 }
    },
    deal: {
      latest_payment: null,
      success_fee_percent: 0.10,
      success_fee_source: "default",
      success_fee_note: "House default — no closeout on this round yet."
    },
    precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
    current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
    next_call: { due_at: NEXT_DUE, task_id: "task-2", client_id: "bbbb", name: "Sam Okafor" },
    up_next: [
      { task_id: "task-1", client_id: CLIENT_ID, due_at: DUE, title: "Closing call", name: "Dana Whitfield" },
      { task_id: "task-2", client_id: "bbbb", due_at: NEXT_DUE, title: "Closing call", name: "Sam Okafor" }
    ],
    offers: [
      { key: "FUNDING_DFY", name: "Funding done for you", priceDisplay: "$5,000" },
      { key: "SOFT_PULL", name: "Diagnostic soft pull", priceDisplay: "$32" }
    ],
    gone_quiet: { unlogged: [], quiet_deposits: [] },
    dispositions: {
      outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"],
      beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"]
    },
    ...over
  };
}

/** A pull IS on file and the engine found real money. */
function funded() {
  return cockpit({
    credit: {
      available: true, pulled_at: NOW,
      scores: { experian: 701, equifax: 688, transunion: 712 },
      utilization: 34, inquiries_6mo: 2, derogatories: 0
    },
    underwrite: {
      matched_lenders: 6, lenders: [], applications: [], lenders_reason: null,
      lite_banner_funding: 42000,
      totals: {
        total_personal_funding: 61000,
        total_business_funding: 40000,
        total_combined_funding: 101000
      }
    },
    deal: {
      latest_payment: {
        transaction_id: "tx-old", amount_cents: 50000, amount_display: "$500",
        product_name: "Deposit", created_at: "2026-05-02T15:00:00.000Z"
      },
      success_fee_percent: 0.15,
      success_fee_source: "closeout",
      success_fee_note: "From this round's closeout record."
    }
  });
}

function handlers(over = {}) {
  return {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/closer-call": cockpit(),
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT_ID },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/deal-math": { ok: true },
    "/api/read/agent-context": { ok: true, context: {} },
    ...over
  };
}

const url = `/app/closer-dashboard.html?client_id=${CLIENT_ID}`;

/* ── FULL ─────────────────────────────────────────────────────────────────── */

test("the person on the call is the first thing on the page, with the time beside them", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));

  const h1 = page.locator("#ccp-who-name");
  await expect(h1).toHaveText("Dana Whitfield");

  // ONE IDENTITY IN THE TOPBAR — which is not the same as one on the screen,
  // and this spec used to claim the second thing. Counted in the browser on
  // 2026-08-31 by walking every visible text node for the closer's name:
  //   • span#whoName < span.who-chip < .topbar-right   — HIDDEN
  //   • span < div#fh-shell-chip < .topbar-right       — visible
  //   • span.chip[data-fh-call-staff] < .call-toolbar  — visible
  // Two visible, not one. The bar is un-crowded and that is real; the pill in
  // the call toolbar below it is a THIRD painter of the same name and predates
  // this branch (public/app/closer-call.js on main, line 129). It is recorded
  // here rather than removed, so the count cannot quietly grow again.
  await expect(page.locator("#whoName")).toHaveText("Casey Reed");
  const shellChip = page.locator("#fh-shell-chip");
  const pageChip = page.locator(".who-chip");
  const visible = (await shellChip.count()) ? shellChip : pageChip;
  await expect(visible).toBeVisible();
  if (await shellChip.count()) {
    await expect(pageChip, "two identities in one bar is what crowded it").toBeHidden();
  }
  const named = await page.evaluate(() => {
    const out = [];
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!/Casey Reed/.test(n.textContent || "")) continue;
      const r = n.parentElement.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push(n.parentElement.className || n.parentElement.tagName);
    }
    return out;
  });
  expect(
    named.length,
    "the signed-in closer is painted in a new place. Known and allowed: the shell's account " +
    "chip in the topbar, and the pre-existing [data-fh-call-staff] pill in the call toolbar. " +
    `Found ${named.length}: ${named.join(" / ")}`
  ).toBe(2);
  const staffBox = await visible.boundingBox();
  const clientBox = await h1.boundingBox();
  expect(staffBox.y, "the signed-in name belongs in the topbar, above the content")
    .toBeLessThan(clientBox.y);
  expect(staffBox.x, "the signed-in name must be on the RIGHT, not top-left")
    .toBeGreaterThan(clientBox.x);

  // The screen's own name is not squeezed out of the topbar by the client's.
  await expect(page.locator(".topbar .sub")).toHaveText("Closer Dashboard");

  // Metric size, per UI-STANDARDS §12.7's whitelist.
  const size = await h1.evaluate((el) => getComputedStyle(el).fontSize);
  expect(size).toBe("32px");

  // The time of THIS call, and how long until it.
  const when = page.locator("#ccp-call-when");
  await expect(when).toBeVisible();
  await expect(when).toContainText("in 20m");
  await expect(when).toContainText("next");
});

test("real money paints as money, and the fee comes off the closeout", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));
  const bands = page.locator(".bands .band .bv");
  await expect(bands.nth(0)).toHaveText("$42,000");
  await expect(bands.nth(1)).toHaveText("$61,000");
  await expect(bands.nth(2)).toHaveText("$101,000");
  await expect(page.locator(".bands .band .bl").nth(2)).toHaveText("Personal + business stacked");
  // 15% on the file must reach the screen as 15%, and NOT be called a default.
  const deal = page.locator(".panel").nth(1);
  await expect(deal).toContainText("15%");
  await expect(deal).not.toContainText("15% · default");
});

/* ── THE OTHER HALF OF THE HEADLINE ───────────────────────────────────────
   "next 11:00 AM" was picked off up_next[], and up_next cannot answer that
   question: its ORDER BY forces the OPEN client's tasks to the front whatever
   the clock says, and LIMIT 5 then cuts the list. All three fixtures below are
   the array shapes a real Postgres returned on 2026-08-31 — see
   src/sales/cockpit-next-call.pg.test.mjs, which produced them by seeding rows
   and running the real query. The server now answers with its own one-row
   next_call and the screen prints that; these prove the screen prints THAT and
   not the array. ───────────────────────────────────────────────────────────── */

/** The clock string the screen renders: Arizona time, whatever zone the
    machine running the suite is in. Staff screens name America/Phoenix since
    ca61e23b5 (2026-10-05, walkthrough-4 defect 14). This helper still used the
    viewer's own zone, so it only matched on a Mac set to Arizona and failed in
    CI, which runs in UTC (first CI run that reached it: 2026-10-05). */
const clock = (page, iso) => page.evaluate(
  (s) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }), iso);

test("a call earlier in the day is never named as the one AFTER this call", async ({ page }) => {
  await freezeClock(page, NOW);
  const LATE = "2026-09-01T22:00:00.000Z";   // this client, hours from now
  const EARLY = "2026-09-01T18:00:00.000Z";  // somebody else, before that
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": cockpit({
      current_call: { due_at: LATE, task_id: "task-late", title: "Closing call" },
      // The server looked and there is genuinely nothing after this one.
      next_call: null,
      // …but the array puts the earlier call at [1], which is what got printed.
      up_next: [
        { task_id: "task-late", client_id: CLIENT_ID, due_at: LATE, name: "Dana Whitfield" },
        { task_id: "task-early", client_id: "bbbb", due_at: EARLY, name: "Sam Okafor" }
      ]
    })
  }));
  const when = page.locator("#ccp-call-when");
  await expect(when).toContainText(await clock(page, LATE));
  await expect(when, "a time BEFORE this call cannot be the call after it")
    .not.toContainText(await clock(page, EARLY));
  await expect(when).toContainText("nothing after this");
});

test("the closer's real next appointment is named, not this client's own later task", async ({ page }) => {
  await freezeClock(page, NOW);
  const OWN_LATER = "2026-09-01T23:00:00.000Z";
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": cockpit({
      current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
      next_call: { due_at: NEXT_DUE, task_id: "task-2", client_id: "bbbb", name: "Sam Okafor" },
      up_next: [
        { task_id: "task-1", client_id: CLIENT_ID, due_at: DUE, name: "Dana Whitfield" },
        { task_id: "task-own", client_id: CLIENT_ID, due_at: OWN_LATER, name: "Dana Whitfield" },
        { task_id: "task-2", client_id: "bbbb", due_at: NEXT_DUE, name: "Sam Okafor" }
      ]
    })
  }));
  const when = page.locator("#ccp-call-when");
  await expect(when).toContainText("next " + await clock(page, NEXT_DUE));
  await expect(
    when,
    "this client's own later task sorts ahead of everybody else's in up_next. Printing it " +
    "shows six hours of runway where there is one."
  ).not.toContainText(await clock(page, OWN_LATER));
});

test('a later call the array never carried does not become "nothing after this"', async ({ page }) => {
  await freezeClock(page, NOW);
  const LATE = "2026-09-01T22:00:00.000Z";
  const CUT = "2026-09-01T23:00:00.000Z";  // real, and past the LIMIT 5
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": cockpit({
      current_call: { due_at: LATE, task_id: "task-late", title: "Closing call" },
      next_call: { due_at: CUT, task_id: "task-cut", client_id: "cccc", name: "Rae Nolan" },
      // Five rows, every one of them before the open call: this is what the
      // query returns when the day is busy, and the real next call is not in it.
      up_next: [
        { task_id: "task-late", client_id: CLIENT_ID, due_at: LATE, name: "Dana Whitfield" },
        { task_id: "t-a", client_id: "b1", due_at: "2026-09-01T17:00:00.000Z", name: "One" },
        { task_id: "t-b", client_id: "b2", due_at: "2026-09-01T18:00:00.000Z", name: "Two" },
        { task_id: "t-c", client_id: "b3", due_at: "2026-09-01T19:00:00.000Z", name: "Three" },
        { task_id: "t-d", client_id: "b4", due_at: "2026-09-01T20:00:00.000Z", name: "Four" }
      ]
    })
  }));
  const when = page.locator("#ccp-call-when");
  await expect(when).toContainText("next " + await clock(page, CUT));
  await expect(when, "sorting the array would have said this, over a call that exists")
    .not.toContainText("nothing after this");
});

test("a call on another day says which day, not a bare clock time", async ({ page }) => {
  await freezeClock(page, NOW);
  const NEXT_WEEK = "2026-09-08T21:00:00.000Z";  // a different day in every time zone
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": cockpit({
      current_call: { due_at: NEXT_WEEK, task_id: "task-tue", title: "Closing call" },
      next_call: null,
      up_next: [{ task_id: "task-tue", client_id: CLIENT_ID, due_at: NEXT_WEEK, name: "Dana Whitfield" }]
    })
  }));
  const when = page.locator("#ccp-call-when");
  const dated = await page.evaluate(
    (s) => new Date(s).toLocaleDateString([], { month: "short", day: "numeric" }), NEXT_WEEK);
  await expect(
    when,
    "upcomingCalls keeps this client's tasks from the start of TODAY onward, not today only, " +
    "so a call booked next week rendered a flat clock time with nothing to say which day"
  ).toContainText(dated);
});

/* ── THE STATE THIS WHOLE BATCH EXISTS FOR ────────────────────────────────── */

test("no credit pull shows a dash and a plain reason, never $0", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers());
  const bands = page.locator(".bands .band");
  for (const i of [0, 1, 2]) {
    await expect(bands.nth(i).locator(".bv")).toHaveText("—");
    await expect(bands.nth(i).locator(".bn")).toHaveText("No credit pull on file yet");
  }
  // The engine really did hand over 0 for two of the three. It must not show.
  await expect(page.locator(".bands")).not.toContainText("$0");
  // And the closer is never shown a database table name.
  await expect(page.locator(".bands")).not.toContainText("crs_results");
});

test("a pull that computes to nothing says so in words, and is not the same as unknown", async ({ page }) => {
  await freezeClock(page, NOW);
  const nothing = cockpit({
    credit: { available: true, pulled_at: NOW, scores: {}, utilization: 96, inquiries_6mo: 11, derogatories: 4 }
  });
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": nothing }));
  const bands = page.locator(".bands .band");
  await expect(bands.nth(1).locator(".bv")).toHaveText("None yet");
  await expect(bands.nth(1).locator(".bn")).toContainText("finds nothing fundable");
  await expect(page.locator(".bands")).not.toContainText("$0");
  // Band 0 has no figure in the answer at all — a third, different sentence.
  await expect(bands.nth(0).locator(".bn")).toHaveText("Not in the UnderwriteIQ answer");
});

/* ── THE MONEY BUTTON, AND WHAT HAPPENS AFTER IT ──────────────────────────── */

test("the pay link is sent from this screen, through the deck's own write path", async ({ page }) => {
  await freezeClock(page, NOW);
  const posted = [];
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": funded(),
    "/api/closer-deck": (route) => {
      posted.push(JSON.parse(route.request().postData() || "{}"));
      return { ok: true, action: "send_pay_link", link: { checkout_url: "https://pay.example/1" } };
    }
  }));

  await page.locator("#fh-pay-link").click();
  await expect(page.locator("#fh-pay-panel")).toBeVisible();
  await page.locator("#fh-pay-go").click();
  await expect(page.locator("#fh-pay-msg")).toContainText("Sent");

  expect(posted.length).toBe(1);
  expect(posted[0].action).toBe("send_pay_link");
  expect(posted[0].client_id).toBe(CLIENT_ID);
  expect(posted[0].offer_key).toBe("FUNDING_DFY");
  // FUNDING_DFY is a primary offer, so the server wants no sale motion.
  expect(posted[0].sale_motion).toBe(null);

  // and the screen starts listening instead of going quiet
  await expect(page.locator("#fh-money-note")).toContainText("Watching for the payment");
});

test("Save · next call never tells the server which payment to use", async ({ page }) => {
  await freezeClock(page, NOW);
  const posted = [];
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": funded(),
    "/api/call-outcomes": (route) => {
      posted.push(JSON.parse(route.request().postData() || "{}"));
      return { ok: true, created: true, outcome: { outcome: "deposit" } };
    }
  }));
  await page.locator('[data-outcome="deposit"]').click();
  await page.locator("#fh-save-next").click();
  await page.waitForTimeout(300);

  expect(posted.length).toBe(1);
  // tx-old is four months old and is on the payload as "latest payment on file".
  // Posting it would have logged $500 against a $1,000 close.
  expect(posted[0].transaction_id, "the browser must not choose the payment").toBe(undefined);
  expect(posted[0].outcome).toBe("deposit");
  expect(posted[0].client_id).toBe(CLIENT_ID);
});

/* ── THE RAIL, THE FOLD, AND THE PHONE ────────────────────────────────────── */

test("the compliance checklist sits above Up next, not below it", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));
  const check = await page.locator("aside.rail h4", { hasText: "Before you close" }).boundingBox();
  const next = await page.locator("aside.rail h4", { hasText: "Up next" }).boundingBox();
  expect(check.y, "urgency below reference is backwards").toBeLessThan(next.y);
  // and the five disclosures clear a 900px laptop fold
  const last = await page.locator(".disc li").last().boundingBox();
  expect(last.y + last.height).toBeLessThan(900);
});

test("nothing slides sideways on a 390px phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));
  await page.locator("#paymentCalculator > summary").click();
  await page.locator("#breakdown > summary").click();
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page itself must never scroll sideways (UI-STANDARDS §11)").toBeLessThanOrEqual(1);
});

/* ── THE FRAME, AS THE BROWSER RESOLVES IT ────────────────────────────────── */

test("the two blocks that dropped their border really did drop the shadow too", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));
  const frame = await page.evaluate(() => [".calc-panel", ".big-tile"].map((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { sel, missing: true };
    const cs = getComputedStyle(el);
    return { sel, shadow: cs.boxShadow, border: cs.borderTopWidth };
  }));
  for (const f of frame) {
    expect(f.missing, `${f.sel} is not on the page`).toBeFalsy();
    expect(f.border, `${f.sel} is meant to be a plain block`).toBe("0px");
    expect(
      f.shadow,
      `${f.sel} keeps the app-wide resting shadow with no border — the floating grey smudge ` +
      "around nothing that UI-STANDARDS §12.4 forbids.\n\n" +
      "This is the trap that makes it invisible: fundhub-brand.css:130-137 is " +
      "`:is(.app,.app-shell) :is(...,.calc-panel,.big-tile,...)`, which is TWO classes. A rule " +
      "written as `.calc-panel{box-shadow:none}` is one class, loses on specificity, and paints " +
      "nothing whatsoever — while reading in the file exactly like a fix. src/ui/" +
      "screen-standard.test.mjs cannot catch that: it reads the CSS text and sees the " +
      "declaration. Only the browser knows whether it applied, which is why this assertion is " +
      "here and not there. Put `.app ` in front of the selector."
    ).toBe("none");
  }
});

/* ── LOADING AND ERROR ────────────────────────────────────────────────────── */

test("the loading state does not show the closer a developer instruction", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      return funded();
    }
  }));
  // caught mid-flight: the h1 still says Loading and the meta is plain English
  await expect(page.locator("body")).not.toContainText("?client_id=<uuid>");
  await expect(page.locator("body")).not.toContainText("&lt;uuid&gt;");
});

test("a failed read says it in the app's own words, not in a machine word", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({
    "/api/read/closer-call": (route) => route.fulfill({
      status: 503, contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "database is not answering" })
    })
  }));
  await expect(page.locator("#ccp-who-name")).toHaveText("Could not load");
  await expect(page.locator("body")).not.toContainText("Could not load cockpit (");
  await expect(page.locator("#fh-data-banner")).toContainText("We could not load this call");
  // nothing on the screen offers a control that cannot work
  await expect(page.locator("#fh-pay-link")).toHaveCount(0);
  await expect(page.locator("#fh-send-contract")).toHaveCount(0);
});

/* ── ONE PRIMARY ──────────────────────────────────────────────────────────── */

test("exactly one filled button, and never a disabled one", async ({ page }) => {
  await freezeClock(page, NOW);
  await openScreen(page, url, CLOSER, handlers({ "/api/read/closer-call": funded() }));
  const filled = page.locator(".call-actions button.k");
  await expect(filled).toHaveCount(1);
  // no meeting link on this appointment, so Join is not the primary
  await expect(page.locator("#fh-join")).toBeDisabled();
  await expect(page.locator("#fh-join")).not.toHaveClass(/\bk\b/);
  await expect(page.locator("#fh-pay-link")).toHaveClass(/\bk\b/);
});
