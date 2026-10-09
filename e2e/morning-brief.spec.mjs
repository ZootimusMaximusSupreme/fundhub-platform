// The daily brief page in a real browser, offline.
//
// e2e/static-server.mjs serves public/; the one API the page calls,
// GET /api/public/morning-brief, is answered here. No database, no session.
//
// Briefs used:
//   REAL  — the stored 2026-10-09 morning brief, passed through the route's own
//           safeBrief() (api/public/morning-brief.mjs), with the two big blobs
//           the page never draws (the 1008-check scorecard, the pulse write-ups)
//           trimmed. e2e/fixtures/morning-brief-2026-10-09.json.
//   BUSY  — made-up TEST numbers in the same shape, so every branch draws:
//           closers, money connected, offers with funnels, a dying ad. Not data.
//   EMPTY — {} : every section must say a plain sentence, never blank.
//   PART  — sections missing or in their "could not be read" form.
//   404   — the route's one answer for every failure.
//
// It proves, at 375x812 and 320x640: no sign-in wall and no redirect; every
// section heading draws; money prints as $1,234.56; a bad link shows ONE
// sentence and nothing else; the code is never written to storage, cookie or
// title; no sideways scroll; no console errors.
//
// Set BRIEF_SHOT_DIR=<dir> to save full-page screenshots there (not the repo).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "morning-brief-2026-10-09.json"), "utf8"));
const SHOTS = process.env.BRIEF_SHOT_DIR || "";
const K = "AbCdEfGhIjKlMnOpQrStUvWxYz012-_9"; // 32 characters, a stand-in code
const PAGE_URL = (q) => `/app/morning-brief.html?${q}`;
const GOOD = `date=2026-10-09&k=${K}`;

const SECTIONS = ["Systems", "Last 24 hours", "Team", "Money", "Ads and sales", "Dying ads", "Suggestions", "Today"];
const BAD = "This link is not valid or has expired.";
const LATER = "The report could not load right now. Try again in a minute.";

const BUSY = {
  ok: true, date: "2026-10-08", kind: "evening",
  brief: {
    kind: "evening",
    systems: {
      status: "ok", total: 420, green: 410, red: 1, not_checked: 9,
      line: "Systems, from this morning's check at 6:01 AM: 410 of 420 checks green. 1 red: calls:booked-no-join-link (day 3). 9 not checked.",
      reds: [{ id: "calls:booked-no-join-link", status: "red", day_count: 3, since: "2026-10-06",
        customer_sees: "A booked person gets no link to join the call.",
        proof: "2 bookings today have no join link.", fix: "Re-run the calendar link step for those 2 bookings." }]
    },
    team: {
      status: "ok", window: "today so far",
      company_8: { cash_cents: { value: 1234567, missing: false }, funded_count: { value: 2, missing: false }, funded_dollars_cents: { value: 15000000, missing: false } },
      closers: [
        { name: "Test Closer A", calls_held: 6, no_shows: 1, deposits: 2, downsells: 0, close_rate: 0.333, offers: [] },
        { name: "Test Closer B", calls_held: 1, no_shows: 0, deposits: 1, downsells: 0, close_rate: 1, offers: [] }
      ],
      csm_overdue: 3, unrecorded_calls: 1,
      waiting: ["Funding advisor files per person: no source yet. Nothing links a funding round to an advisor."]
    },
    money: {
      status: "ok", day: "2026-10-08", in_cents: 845000, out_cents: 120099, mtd_in_cents: 3100000, mtd_out_cents: 990001,
      by_account: [{ name: "Operating", mask: "1234", in_cents: 845000, out_cents: 120099 }],
      line: "Money posted today so far: $8,450.00 in, $1,200.99 out.",
      waiting: ["Ad money left on the credit line: no source yet."]
    },
    marketing: {
      status: "ok", window: "today so far", dashboard_line: "Marketing dashboard: not built yet.",
      all_offers: {
        totals: { spend_cents: 52000, leads: 14, booked: 11, showed: 8, no_shows: 3, sales: 3, cash_cents: 1234567,
          cost_per_booked: { status: "OK", cost_cents: 4727, n: 11 }, roas: 23.74 },
        not_split: [{ key: "spend_by_funnel", what: "Spend per funnel", value: null, reason: "x" },
          { key: "cash_no_person", what: "Cash with no person on it", value: 50000, unit: "cents", reason: "x" }]
      },
      offers: [{ key: "slo", name: "slo", totals: { spend_cents: 52000, leads: 14, booked: 11, showed: 8, sales: 3, cash_cents: 1184567 },
        funnels: [{ key: "watch", name: "watch", totals: { leads: 10, booked: 8, showed: 6, sales: 2, cash_cents: 800000 } }] }],
      dying_ads: [{ ad_name: "SLO Ad 7 — Test angle", offer_name: "slo", plays: 400, reached_25_rate: 0.12, spend_7d_cents: 31000 }],
      dying_line: "Dying ads: 1."
    },
    suggestions: [{ rule: "fix_broken_same_day", headline: "Fix the join link today.", write_up: null, rule_text: "Rule 2: broken things get fixed the same day." }],
    today: { status: "waiting", line: "Today: no source yet (MB4)." }
  }
};

const EMPTY = { ok: true, date: "2026-10-09", kind: "morning", brief: {} };
const PART = {
  ok: true, date: "2026-10-09", kind: "morning",
  brief: {
    systems: { status: "missing", total: 0, line: "Systems: the morning check did not run, so nothing was checked." },
    marketing: { status: "error", line: "Ads and sales: could not be read (timeout)." },
    money: { status: "not_connected", line: "Money: not connected yet." },
    team: { status: "ok", company_8: null, closers: null, closers_error: "Closer calls: could not be read (timeout).", csm_overdue: null, unrecorded_calls: 0 },
    suggestions: [],
    today: { status: "waiting", line: "Today: no source yet (MB4)." }
  }
};

async function open(page, { answer = REAL, query = GOOD } = {}) {
  const errors = [];
  const calls = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  // Anything the page might call besides the brief route is a failure.
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    calls.push(u.pathname + u.search);
    if (u.pathname !== "/api/public/morning-brief") return route.fulfill({ status: 599, body: "unexpected call" });
    const out = typeof answer === "function" ? answer(u) : answer;
    if (out === "abort") return route.abort("failed");
    if (out && typeof out.status === "number" && out.status !== 200) {
      const body = out.status === 404 ? { ok: false, error: "not_found" } : { ok: false, error: "unavailable" };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: JSON.stringify(out) });
  });
  await page.goto(PAGE_URL(query));
  return { errors, calls };
}

async function noSidewaysScroll(page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "page scrolls sideways").toBeLessThanOrEqual(0);
}

async function codeNotWritten(page) {
  const leak = await page.evaluate((k) => ({
    title: document.title.includes(k),
    local: JSON.stringify({ ...localStorage }).includes(k),
    session: JSON.stringify({ ...sessionStorage }).includes(k),
    cookie: document.cookie.includes(k)
  }), K);
  expect(leak).toEqual({ title: false, local: false, session: false, cookie: false });
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

for (const vp of [{ width: 375, height: 812 }, { width: 320, height: 640 }]) {
  test.describe(`daily brief at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, isMobile: true, hasTouch: true });

    test("the real 2026-10-09 morning brief draws, red checks first, no sign-in", async ({ page }) => {
      const { errors, calls } = await open(page);
      await expect(page.locator("h1")).toHaveText("Friday, October 9");
      await expect(page).toHaveURL(/\/app\/morning-brief\.html\?/); // no redirect to sign-in
      await expect(page.locator("h2")).toHaveText(SECTIONS);
      expect(await page.locator("html").getAttribute("data-brief-page")).toBe("1");
      // Systems: the three words and numbers, red first.
      const sys = page.locator("section", { has: page.locator("h2", { hasText: "Systems" }) });
      await expect(sys.locator(".tile").nth(0)).toContainText("Red14");
      await expect(sys.locator(".tile").nth(1)).toContainText("Green695");
      await expect(sys.locator(".tile").nth(2)).toContainText("Not checked299");
      await expect(sys).toContainText("Out of 1,008 checks.");
      await expect(sys.locator("li.red-item:visible")).toHaveCount(5);
      await expect(sys.locator("li.red-item").first()).toContainText("live-playwright:desks");
      await expect(sys.locator("li.red-item").first()).toContainText("Fix: Run node scripts/live-playwright-sweep.mjs");
      await shot(page, `real-morning-${vp.width}.png`);
      const more = sys.getByRole("button", { name: "Show all 14 red checks" });
      const box = await more.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      await more.click();
      await expect(sys.locator("li.red-item:visible")).toHaveCount(14);
      await noSidewaysScroll(page);
      await shot(page, `real-morning-all-reds-${vp.width}.png`);
      // Plain words for the empty parts of that day.
      await expect(page.locator("section", { has: page.locator("h2", { hasText: "Money" }) })).toContainText("Money: not connected yet.");
      await expect(page.locator("section", { has: page.locator("h2", { hasText: "Dying ads" }) })).toContainText("None flagged.");
      await expect(page.locator("section", { has: page.locator("h2", { hasText: "Last 24 hours" }) })).toContainText("Cash collected$0.00");
      await expect(page.locator("body")).not.toContainText("undefined");
      await expect(page.locator("body")).not.toContainText("null");
      await expect(page.locator("body")).not.toContainText("NaN");
      expect(calls).toEqual([`/api/public/morning-brief?date=2026-10-09&kind=morning&k=${K}`]);
      await codeNotWritten(page);
      expect(errors).toEqual([]);
    });

    test("a busy evening: money as $1,234.56, closers, offers, a dying ad", async ({ page }) => {
      const { errors } = await open(page, { answer: BUSY, query: `date=2026-10-08&kind=evening&k=${K}` });
      await expect(page.locator(".eyebrow")).toHaveText("Evening brief");
      await expect(page.locator("h1")).toHaveText("Thursday, October 8");
      await expect(page.locator("h2")).toHaveText(SECTIONS);
      await expect(page.locator("body")).toContainText("From this morning's check at 6:01 AM.");
      await expect(page.locator("body")).toContainText("Red · day 3");
      await expect(page.locator("body")).toContainText("What people see: A booked person gets no link to join the call.");
      await expect(page.locator("body")).toContainText("Cash collected$12,345.67");
      await expect(page.locator("body")).toContainText("Funded dollars$150,000.00");
      await expect(page.locator("body")).toContainText("3 sales from 7 calls.");
      await expect(page.locator("body")).toContainText("Test Closer A");
      await expect(page.locator("body")).toContainText("3 tasks are late for the success team.");
      await expect(page.locator("body")).toContainText("1 call was not recorded.");
      await expect(page.locator("body")).toContainText("Out$1,200.99");
      await expect(page.locator("body")).toContainText("Operating ··1234");
      await expect(page.locator("body")).toContainText("Cost per booked person$47.27");
      await expect(page.locator("body")).toContainText("$23.74 back for each $1");
      await expect(page.locator("body")).toContainText("Cash with no person on it: $500.00.");
      await expect(page.locator("body")).toContainText("48 of 400 plays got a quarter of the way in.");
      await expect(page.locator("body")).toContainText("Fix the join link today.");
      await expect(page.locator("body")).not.toContainText("undefined");
      await noSidewaysScroll(page);
      await codeNotWritten(page);
      await shot(page, `busy-evening-${vp.width}.png`);
      expect(errors).toEqual([]);
    });

    test("an empty brief: every section says a plain sentence", async ({ page }) => {
      const { errors } = await open(page, { answer: EMPTY });
      await expect(page.locator("h2")).toHaveText(SECTIONS);
      for (const want of [
        "Systems: could not be read.",
        "Cash collected: unknown.",
        "Team: could not be read.",
        "Money: could not be read.",
        "Ads and sales: could not be read.",
        "Dying ads: could not be read.",
        "None today.",
        "Nothing on today's list yet."
      ]) await expect(page.locator("body")).toContainText(want);
      await expect(page.locator("body")).not.toContainText("undefined");
      await noSidewaysScroll(page);
      await shot(page, `empty-${vp.width}.png`);
      expect(errors).toEqual([]);
    });

    test("a brief with missing and broken sections says so plainly", async ({ page }) => {
      const { errors } = await open(page, { answer: PART });
      await expect(page.locator("h2")).toHaveText(SECTIONS);
      for (const want of [
        "Systems: the morning check did not run, so nothing was checked.",
        "Cash collected: unknown.",
        "Closer calls: could not be read (timeout).",
        "Late success team tasks: unknown.",
        "0 calls were not recorded.",
        "Ads and sales: could not be read (timeout).",
        "Dying ads: could not be read."
      ]) await expect(page.locator("body")).toContainText(want);
      await expect(page.locator("body")).not.toContainText("undefined");
      await noSidewaysScroll(page);
      await shot(page, `partial-${vp.width}.png`);
      expect(errors).toEqual([]);
    });

    test("a 404 shows one sentence and nothing else", async ({ page }) => {
      const { errors } = await open(page, { answer: { status: 404 } });
      await expect(page.locator("#app")).toHaveText(BAD);
      await expect(page.locator("h1, h2, .tile")).toHaveCount(0);
      await codeNotWritten(page);
      await noSidewaysScroll(page);
      await shot(page, `not-valid-${vp.width}.png`);
      // The 404 is the browser's own resource line, not the page talking.
      expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
    });
  });
}

test("a link with no code, a bad date or a bad kind never calls the route", async ({ page }) => {
  for (const q of ["date=2026-10-09", `date=2026-13-40&k=${K}`, `date=2026-10-09&kind=noon&k=${K}`, `k=${K}`]) {
    const { calls } = await open(page, { query: q });
    await expect(page.locator("#app")).toHaveText(BAD);
    expect(calls, q).toEqual([]);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  }
});

test("a network failure says try again, never that a good link expired", async ({ page }) => {
  await open(page, { answer: "abort" });
  await expect(page.locator("#app")).toHaveText(LATER);
});

test("a 503 (the database blinked) says try again, never that a good link expired", async ({ page }) => {
  await open(page, { answer: { status: 503 } });
  await expect(page.locator("#app")).toHaveText(LATER);
  await expect(page.locator("h1, h2, .tile")).toHaveCount(0);
});

test("a long unbroken string never pushes the page sideways on a small phone", async ({ page }) => {
  const long = "https://apply.fundhub.ai/" + "roadmap-thank-you-".repeat(14);
  await page.setViewportSize({ width: 320, height: 640 });
  await open(page, { answer: { ok: true, date: "2026-10-09", kind: "morning", brief: { suggestions: [{ headline: long, write_up: long }], today: { line: long } } } });
  await expect(page.locator("body")).toContainText("roadmap-thank-you");
  await noSidewaysScroll(page);
});

test("an answer that is 200 but not a brief shows the same one sentence", async ({ page }) => {
  await open(page, { answer: { ok: false, error: "not_found" } });
  await expect(page.locator("#app")).toHaveText(BAD);
});
