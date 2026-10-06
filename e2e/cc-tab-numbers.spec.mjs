// The Command Center's Numbers tab (Ads · Angles · Funnels) in a real browser.
//
// Until the frame (U34's cc-frame.js) lands, the tab loads in the stub frame
// from e2e/helpers/cc-numbers-stub.mjs, which the tab contract allows
// (docs/specs/command-center-tabs.md). The real tab script and the real brand
// stylesheet are served by e2e/static-server.mjs; every /api/** answer is built
// from the contract's own examples (src/marketing/api-contract.mjs), so the
// mocks cannot drift from what U31, U32 and U26 send. No login, no database,
// nothing sent anywhere.
//
// Proved at 390 x 844 (Chris's phone) and 1280 x 900: the four states, sorting,
// filters, the drawer with the hand-drawn watch curve, "Make more of this", the
// funnel step rates, the Link button, unknown for null, no sideways scroll,
// no text under 11px, and at most one filled button on any view.

import { test, expect } from "@playwright/test";
import { exampleResponse } from "../src/marketing/api-contract.mjs";
import { routeStub, STUB_PATH } from "./helpers/cc-numbers-stub.mjs";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const NOW = new Date("2026-10-06T15:00:00Z"); // Oct 6, 8 am in Arizona

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "laptop", width: 1280, height: 900 }
];

const reply = (status, body) => ({ __status: status, body });

function angles() {
  const a = exampleResponse("GET marketing/angles");
  a.rows[0].angle_key = "the_conveyor_belt";
  a.rows[0].name = "The Conveyor Belt";
  a.rows[1].angle_key = "inquiries_off";
  a.rows[1].name = "Inquiries off first";
  return a;
}

function defaults() {
  return {
    "GET marketing/ads": exampleResponse("GET marketing/ads"),
    "GET marketing/ad": exampleResponse("GET marketing/ad"),
    "GET marketing/angles": angles(),
    "GET marketing/funnels/stats": exampleResponse("GET marketing/funnels/stats"),
    "GET marketing/funnels": exampleResponse("GET marketing/funnels"),
    "POST marketing/ideas": exampleResponse("POST marketing/ideas")
  };
}

/* Answer /api/** from the map; record every call. A value may be a function
   (req, url, n) where n counts calls to that route, or reply(status, body). */
async function wire(page, over = {}) {
  const calls = [];
  const map = { ...defaults(), ...over };
  const seen = {};
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api\//, "")}`;
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    calls.push({ key, url, body });
    seen[key] = (seen[key] || 0) + 1;
    let h = map[key];
    if (typeof h === "function") h = await h(req, url, seen[key]);
    if (h === undefined) {
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "No such route." }) });
    }
    const status = h && h.__status ? h.__status : 200;
    const out = h && h.__status ? h.body : h;
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(out) });
  });
  return calls;
}

async function open(page, hash = "#numbers/ads", over = {}) {
  await page.clock.setFixedTime(NOW);
  await routeStub(page);
  const calls = await wire(page, over);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(STUB_PATH + hash);
  await expect(page.locator(".ccn")).toBeVisible();
  return { calls, errors };
}

/* Every element on the tab that paints its own text: its computed size. */
async function smallestText(page) {
  return page.evaluate(() => {
    let min = Infinity;
    const walk = document.createTreeWalker(document.querySelector(".ccn"), NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
      const n = walk.currentNode;
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      min = Math.min(min, parseFloat(cs.fontSize));
    }
    return min;
  });
}

async function noSidewaysScroll(page) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, "the page must not scroll sideways").toBeLessThanOrEqual(0);
}

async function filledButtons(page) {
  return page.locator(".ccn-btn.primary:visible").count();
}

for (const vp of VIEWPORTS) {
  test.describe(`Numbers tab at ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Ads: the table, the as-of line, still maturing, unmapped spend with a Link button", async ({ page }) => {
      const { calls, errors } = await open(page);
      await expect(page.getByRole("tab", { name: "Ads" })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("[data-test=as-of]")).toHaveText("Meta numbers pulled Oct 12, 12:01 AM Arizona time.");

      const rows = page.locator(".ccn-table tbody tr");
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toContainText("Ad 91");
      await expect(rows.nth(0)).toContainText("$412.00");
      await expect(rows.nth(0)).toContainText("Lenders read two files");
      await expect(rows.nth(1)).toContainText("Ad 92");
      await expect(page.locator(".ccn-table .ccn-mat")).toHaveCount(2);
      await expect(page.locator(".ccn-rangeline")).toContainText("Sep 7 to Oct 6 · 2 ads");

      const ads = calls.find((c) => c.key === "GET marketing/ads");
      expect(ads.url.searchParams.get("from")).toBe("2026-09-07");
      expect(ads.url.searchParams.get("to")).toBe("2026-10-06");

      const un = page.locator("[data-test=unmapped]");
      await expect(un).toContainText("Retargeting (example)");
      await expect(un).toContainText("$91.50");
      await un.getByRole("button", { name: "Link to a funnel" }).click();
      expect(await page.evaluate(() => window.__ccGo)).toEqual([["settings", "funnels"]]);

      await noSidewaysScroll(page);
      expect(await smallestText(page)).toBeGreaterThanOrEqual(11);
      expect(await filledButtons(page)).toBeLessThanOrEqual(1);
      expect(await page.locator("canvas").count()).toBe(0);
      expect(errors).toEqual([]);
    });

    test("Ads: tapping a header sorts; unknown stays last", async ({ page }) => {
      const ads = exampleResponse("GET marketing/ads");
      ads.rows.push({ ...ads.rows[1], ad_number: "84", title: "Old ad", spend_cents: null, leads: 4 });
      await open(page, "#numbers/ads", { "GET marketing/ads": ads });
      const first = () => page.locator(".ccn-table tbody tr").first();
      const last = () => page.locator(".ccn-table tbody tr").last();
      await expect(first()).toContainText("Ad 91");
      await expect(last()).toContainText("Ad 84");
      await expect(last()).toContainText("unknown");

      const spendHead = page.locator("th", { has: page.getByRole("button", { name: /^Spend/ }) });
      await expect(spendHead).toHaveAttribute("aria-sort", "descending");
      await page.getByRole("button", { name: /^Spend/ }).click();
      await expect(spendHead).toHaveAttribute("aria-sort", "ascending");
      await expect(first()).toContainText("Ad 92");
      await expect(last()).toContainText("Ad 84", { timeout: 1000 });

      await page.getByRole("button", { name: /^Leads/ }).click();
      await expect(first()).toContainText("Ad 91");
      await expect(page.locator(".ccn-table tbody tr").nth(1)).toContainText("Ad 84");
    });

    test("Ads: filters send the right question, and Clear filters brings every ad back", async ({ page }) => {
      const { calls } = await open(page, "#numbers/ads", {
        "GET marketing/ads": (req, url) => (url.searchParams.get("funnel")
          ? { rows: [], unmapped: [], as_of: "2026-10-12T07:01:50.000Z" }
          : exampleResponse("GET marketing/ads"))
      });
      await expect(page.locator(".ccn-table tbody tr")).toHaveCount(2);

      await page.getByLabel("Days").selectOption("7");
      await expect.poll(() => calls.filter((c) => c.key === "GET marketing/ads").at(-1).url.searchParams.get("from")).toBe("2026-09-30");

      await page.getByLabel("Funnel").selectOption({ label: "Roadmap $147" });
      await expect(page.locator("[data-test=ads-empty]")).toContainText("No ad numbers saved for Sep 30 to Oct 6.");
      await expect(page.locator("[data-test=ads-empty]")).toContainText("No ad matches these filters.");
      const last = calls.filter((c) => c.key === "GET marketing/ads").at(-1).url;
      expect(last.searchParams.get("funnel")).toBe("roadmap_147");

      await page.getByLabel("Format").selectOption({ label: "Sorting" });
      await expect.poll(() => calls.filter((c) => c.key === "GET marketing/ads").at(-1).url.searchParams.get("format")).toBe("sorting");

      await page.getByLabel("Days").selectOption("pick");
      await expect(page.getByLabel("First day")).toBeVisible();
      await expect(page.getByLabel("Last day")).toBeVisible();

      await page.locator("[data-test=ads-empty]").getByRole("button", { name: "Clear filters" }).click();
      await expect(page.locator(".ccn-table tbody tr")).toHaveCount(2);
      const cleared = calls.filter((c) => c.key === "GET marketing/ads").at(-1).url;
      expect(cleared.searchParams.get("funnel")).toBeNull();
      expect(cleared.searchParams.get("format")).toBeNull();
      expect(cleared.searchParams.get("from")).toBe("2026-09-07");
      await noSidewaysScroll(page);
    });

    test("Ads: null prints unknown, never $0 or 0%", async ({ page }) => {
      const ads = exampleResponse("GET marketing/ads");
      ads.rows = [{
        ...ads.rows[1], ad_number: "86", title: "No spend saved yet", spend_cents: null, impressions: null, ctr: null,
        hook_rate: null, hold_25: null, thruplay_rate: null, cpl_cents: null, cost_per_booked_cents: null, roas: null,
        cash_cents: null, reported_cash_cents: null, close_rate: null, leads: 2, maturing: false
      }];
      ads.unmapped = [];
      await open(page, "#numbers/ads", { "GET marketing/ads": ads });
      const row = page.locator(".ccn-table tbody tr").first();
      await expect(row).toContainText("Ad 86");
      expect(await row.locator("td.unk").count()).toBeGreaterThanOrEqual(12);
      await expect(row).not.toContainText("$0.00");
      await expect(row).not.toContainText(/(^|\s)0%/);
      await expect(page.locator("[data-test=unmapped]")).toHaveCount(0);
    });

    test("Drawer: the watch curve is drawn by hand, the diagnosis is in words, and it closes", async ({ page }) => {
      const { calls } = await open(page);
      await page.locator(".ccn-table tbody tr").first().getByRole("button", { name: "Ad 91" }).click();
      const drawer = page.locator("[data-test=drawer]");
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole("heading", { level: 2 })).toHaveText("Ad 91 · Lenders read two files");
      expect(calls.some((c) => c.key === "GET marketing/ad" && c.url.searchParams.get("n") === "91")).toBe(true);
      expect(new URL(page.url()).hash).toBe("#numbers/ads/91");

      const points = await drawer.locator("polyline.ccn-line").getAttribute("points");
      expect(points.trim().split(/\s+/)).toHaveLength(22);
      await expect(drawer).toContainText("At 2 seconds, 47% of plays were still watching (from the curve).");
      await expect(drawer.locator("#ccn-day")).toHaveValue("0");
      await expect(drawer.locator("[data-test=diagnosis]")).toContainText("The opening loses them.");
      await expect(drawer.locator("[data-test=diagnosis]")).toContainText("Change the words.");
      await expect(drawer.locator("[data-test=diagnosis]")).toContainText("Most plays stop before the quarter mark. Film a new first line, same body.");
      await expect(drawer).toContainText("SLO Ad 91 — Lenders read two files");
      await expect(drawer).toContainText("Paused");
      await expect(drawer).toContainText("still maturing");
      await expect(page.locator("canvas")).toHaveCount(0);

      const box = await drawer.boundingBox();
      if (vp.width <= 720) expect(Math.round(box.width)).toBe(vp.width);
      else expect(box.width).toBeLessThan(vp.width);
      expect(await smallestText(page)).toBeGreaterThanOrEqual(11);
      await noSidewaysScroll(page);

      await drawer.locator("[data-test=diagnosis] .eyebrow").click(); // focus leaves the Close button
      await page.keyboard.press("Escape");
      await expect(drawer).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("#numbers/ads");

      await page.locator(".ccn-table tbody tr").first().click();
      await expect(drawer).toBeVisible();
      await drawer.getByRole("button", { name: "Close" }).click();
      await expect(drawer).toHaveCount(0);
    });

    test("Drawer: a day with no curve, and an ad with no curve at all, say so", async ({ page }) => {
      const ad = exampleResponse("GET marketing/ad");
      ad.ad.curve = [{ date: "2026-10-10", video_play_curve: null }];
      ad.ad.watch = { alerts: [], diagnoses: [] };
      await open(page, "#numbers/ads/91", { "GET marketing/ad": ad });
      const drawer = page.locator("[data-test=drawer]");
      await expect(drawer.locator("[data-test=no-curve]")).toHaveText("Meta sent no curve for Oct 10.");
      await expect(drawer.locator("[data-test=diagnosis]")).toContainText("No watch-curve note yet.");
      await expect(drawer.locator("polyline")).toHaveCount(0);
    });

    test("Angles: the cards, and Make more of this saves an idea and says so", async ({ page }) => {
      const { calls } = await open(page, "#numbers/angles");
      await expect(page.getByRole("tab", { name: "Angles" })).toHaveAttribute("aria-selected", "true");
      const cards = page.locator("[data-test=angle]");
      await expect(cards).toHaveCount(2);
      await expect(cards.first()).toContainText("The Conveyor Belt");
      await expect(cards.first()).toContainText("$412.00");
      await expect(cards.first()).toContainText("$45.78"); // cost per lead: 41200 / 9
      await expect(cards.nth(1)).toContainText("Inquiries off first");
      await expect(cards.nth(1).locator(".ccn-kv-i", { hasText: "Cost per lead" })).toContainText("unknown");
      expect(await filledButtons(page)).toBe(0);

      await cards.first().getByRole("button", { name: "Make more of this" }).click();
      const box = cards.first().locator("textarea");
      await expect(box).toHaveValue("Make more ads on the angle \"The Conveyor Belt\". Same idea, new hooks.");
      expect(await filledButtons(page)).toBe(1);
      await noSidewaysScroll(page);
      await cards.first().getByRole("button", { name: "Save idea" }).click();

      await expect(cards.first().locator(".ccn-say.ok")).toHaveText("Saved to your ideas. The next batch of scripts starts with your ideas.");
      const post = calls.find((c) => c.key === "POST marketing/ideas");
      expect(post.body.request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(post.body).toMatchObject({
        raw_points: "Make more ads on the angle \"The Conveyor Belt\". Same idea, new hooks.",
        angle_key: "the_conveyor_belt",
        source: "chris"
      });
      expect(await page.evaluate(() => window.__ccToasts)).toEqual(["Idea saved for The Conveyor Belt."]);
      expect(await smallestText(page)).toBeGreaterThanOrEqual(11);
    });

    test("Angles: a failed save keeps the words and sends the same request_id again", async ({ page }) => {
      const { calls } = await open(page, "#numbers/angles", {
        "POST marketing/ideas": (req, url, n) => (n === 1 ? reply(503, { error: "db_unavailable" }) : exampleResponse("POST marketing/ideas"))
      });
      const card = page.locator("[data-test=angle]").first();
      await card.getByRole("button", { name: "Make more of this" }).click();
      await card.locator("textarea").fill("Show the conveyor belt with a real file.");
      await card.getByRole("button", { name: "Save idea" }).click();
      await expect(card.locator(".ccn-say.err")).toHaveText("Not saved. Something went wrong on our side. Your words are still here. Try again.");
      await expect(card.locator("textarea")).toHaveValue("Show the conveyor belt with a real file.");
      await card.getByRole("button", { name: "Save idea" }).click();
      await expect(card.locator(".ccn-say.ok")).toBeVisible();
      const posts = calls.filter((c) => c.key === "POST marketing/ideas");
      expect(posts).toHaveLength(2);
      expect(posts[1].body.request_id).toBe(posts[0].body.request_id);
      expect(posts[1].body.raw_points).toBe("Show the conveyor belt with a real file.");
    });

    test("Funnels: page views, click to page, page to lead, lead to call, call to sale, spend and ROAS", async ({ page }) => {
      await open(page, "#numbers/funnels");
      const road = page.locator("[data-test=funnel][data-funnel=roadmap_147]");
      await expect(road).toContainText("Roadmap $147");
      await expect(road).toContainText("Spend $412.00 · Cash $588.00 · Cash per $1 (ROAS) 1.43x");
      await expect(road.locator("[data-step=page_views]")).toContainText("1,210");
      await expect(road.locator("[data-step=page_views]")).toContainText("Click to page: 82%");
      await expect(road.locator("[data-step=leads]")).toContainText("Page to lead: 1.2%");
      await expect(road.locator("[data-step=booked]")).toContainText("Lead to call: 26.7%");
      await expect(road.locator("[data-step=sales]")).toContainText("Call to sale: 0%");
      const call = page.locator("[data-test=funnel][data-funnel=book_call]");
      await expect(call.locator("[data-step=booked]")).toContainText("Lead to call: 37.5%");
      await expect(call.locator("[data-step=sales]")).toContainText("Call to sale: 50%");

      const un = page.locator("[data-test=funnel-unmapped]");
      await expect(un).toContainText("$91.50");
      await un.getByRole("button", { name: "Link to a funnel" }).click();
      expect(await page.evaluate(() => window.__ccGo)).toEqual([["settings", "funnels"]]);
      await expect(page.locator("[data-test=as-of]")).toHaveText("Meta numbers pulled Oct 12, 12:01 AM Arizona time.");
      await noSidewaysScroll(page);
      expect(await smallestText(page)).toBeGreaterThanOrEqual(11);
      expect(await filledButtons(page)).toBe(0);
    });

    test("Funnels: unknown spend is unknown, not $0", async ({ page }) => {
      const fs = exampleResponse("GET marketing/funnels/stats");
      fs.rows[0].page_views = null;
      fs.rows[0].click_to_page = null;
      fs.rows[0].page_to_lead = null;
      fs.unmapped_spend_cents = null;
      await open(page, "#numbers/funnels", { "GET marketing/funnels/stats": fs });
      const road = page.locator("[data-test=funnel][data-funnel=roadmap_147]");
      await expect(road.locator("[data-step=page_views]")).toContainText("unknown");
      await expect(road.locator("[data-step=page_views]")).toContainText("Click to page: unknown");
      await expect(page.locator("[data-test=funnel-unmapped]")).toContainText("unknown");
    });
  });
}

test.describe("Numbers tab states at 390px", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Loading is a skeleton in the real layout, then the table", async ({ page }) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    await open(page, "#numbers/ads", {
      "GET marketing/ads": async () => { await gate; return exampleResponse("GET marketing/ads"); }
    });
    await expect(page.locator(".ccn-skel-table")).toBeVisible();
    await expect(page.locator("[data-test=as-of]")).toHaveText("Loading the latest Meta numbers…");
    release();
    await expect(page.locator(".ccn-table tbody tr")).toHaveCount(2);
  });

  test("One part fails in plain words; Try again brings it back", async ({ page }) => {
    await open(page, "#numbers/ads", {
      "GET marketing/ads": (req, url, n) => (n === 1 ? reply(500, { error: "internal_error" }) : exampleResponse("GET marketing/ads"))
    });
    const err = page.locator(".ccn-say.err");
    await expect(err).toContainText("The ad numbers did not load. The rest of this page is current. Try again.");
    await expect(err).not.toContainText("500");
    await err.getByRole("button", { name: "Try again" }).click();
    await expect(page.locator(".ccn-table tbody tr")).toHaveCount(2);
  });

  test("Empty: no ads in the window says so, with nothing made up", async ({ page }) => {
    await open(page, "#numbers/ads", { "GET marketing/ads": { rows: [], unmapped: [], as_of: null } });
    await expect(page.locator("[data-test=ads-empty]")).toContainText("No ad numbers saved for Sep 7 to Oct 6.");
    await expect(page.locator("[data-test=as-of]")).toHaveText("Meta numbers: never pulled yet.");
    await expect(page.locator(".ccn-table")).toHaveCount(0);
  });

  test("Empty angles and an empty funnel list each say what will show", async ({ page }) => {
    await open(page, "#numbers/angles", {
      "GET marketing/angles": { rows: [], as_of: null },
      "GET marketing/funnels/stats": { rows: [], unmapped_spend_cents: 0, as_of: null }
    });
    await expect(page.locator("[data-test=angles-empty]")).toContainText("No angle had spend or leads in the last 30 days.");
    await page.getByRole("tab", { name: "Funnels" }).click();
    await expect(page.locator("[data-test=funnels-empty]")).toContainText("No funnel is set up yet.");
    await expect(page.locator("[data-test=funnel-unmapped]")).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#numbers/funnels");
  });

  test("The view switch keeps its place in the URL and every view loads only its own numbers", async ({ page }) => {
    const { calls } = await open(page, "#numbers/funnels");
    await expect(page.locator("[data-test=funnel]")).toHaveCount(2);
    expect(calls.some((c) => c.key === "GET marketing/ads")).toBe(false);
    await page.getByRole("tab", { name: "Ads" }).click();
    await expect(page.locator(".ccn-table tbody tr")).toHaveCount(2);
    expect(new URL(page.url()).hash).toBe("#numbers/ads");
    for (const v of ["Ads", "Angles", "Funnels"]) {
      const b = await page.getByRole("tab", { name: v }).boundingBox();
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
  });
});
