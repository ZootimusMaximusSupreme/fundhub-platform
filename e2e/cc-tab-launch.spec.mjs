// The Command Center's Launch tab in a real browser, offline.
//
// The tab file (public/app/cc-tab-launch.js) is loaded by the stub frame in
// e2e/helpers/cc-launch-stub.mjs, the way docs/specs/command-center-tabs.md
// allows until the frame (U34) lands. page.route() answers /api/** with the
// API contract's own examples (src/marketing/api-contract.mjs). Nothing here
// reaches Meta: campaigns/write and marketing/meta/load are answered by the
// mock, and every body the page sends is recorded and checked.
//
// Proves, at 390x844 and 1280x900: the count top-left, one filled button,
// every approved ad with its state and reasons, the paused flags, Load to Meta
// and Load all (with its confirm) posting only to marketing/meta/load, Turn on
// posting ONLY {action:'resume_ad', ad_id:<our ads.id>, request_id}, Turn on
// off with its reason while the budget is unknown, a 403 in words, the four
// states, 44px buttons, text 11px or larger, and no sideways scroll.

import { test, expect } from "@playwright/test";
import { exampleResponse } from "../src/marketing/api-contract.mjs";
import { STUB_PATH, stubHtml } from "./helpers/cc-launch-stub.mjs";

const AD_ROW = "00000000-0000-4000-8000-000000000801";
const VIDEO_C = "00000000-0000-4000-8000-000000000703";
const VIDEO_D = "00000000-0000-4000-8000-000000000704";
const AD_ROW_D = "00000000-0000-4000-8000-000000000804";
const META_AD = "120210000000000201";

/* load-status: the contract's two rows (Ad 91 loaded, Ad 92 stopped), Ad 91
   given its ad set's name and daily budget, plus Ad 94 loaded with no budget. */
function loadStatus() {
  const body = exampleResponse("GET marketing/meta/load-status");
  body.loads[0].ad_set = { ...body.loads[0].ad_set, name: "Roadmap broad", status: "PAUSED", daily_budget_cents: 10000 };
  body.loads[0].angle = "Lenders read two files";
  body.loads[0].funnel_key = "roadmap_147";
  body.loads.push({
    ad_number: "94", ad_video_id: VIDEO_D, state: "loaded", reasons: [],
    meta_video_id: "1234567890123499", meta_creative_id: "120210000000000399", meta_ad_external_id: "120210000000000299",
    ad_row_id: AD_ROW_D, ad_status: "PAUSED",
    ad_set: { external_id: "120210000000000103", status: "ACTIVE", name: "Book a call broad" },
    campaign: { external_id: "120210000000000003", status: "ACTIVE" },
    angle: "Inquiries off first", funnel_key: "book_call", step: "loaded"
  });
  return body;
}

const APPROVED = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{ id: VIDEO_C, ad_id: "90", take_no: 2, video_kind: "ad", status: "approved", approved_at: "2026-10-13T20:01:00.000Z" }]
};

/* Answers /api/** and records every request. */
async function open(page, { status = loadStatus(), approved = APPROVED, statusCode = 200, turnOn = null, statusGate = null, statusAnswer = null } = {}) {
  const sent = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`**${STUB_PATH}`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: stubHtml("launch") }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    sent.push({ method: req.method(), path: p, query: url.search, body });
    const reply = (code, data) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() === "GET" && p === "marketing/meta/load-status") {
      if (statusGate) await statusGate;
      if (statusAnswer) { const [code, data] = statusAnswer(); return reply(code, data); }
      return reply(statusCode, typeof status === "function" ? status() : status);
    }
    if (req.method() === "GET" && p === "ad-videos") return approved ? reply(200, approved) : reply(500, { ok: false, error: "internal" });
    if (req.method() === "POST" && p === "marketing/meta/load") {
      return reply(202, body && body.all
        ? exampleResponse("POST marketing/meta/load")
        : { queued: true, jobs: [{ ad_number: "90", ad_video_id: body && body.ad_video_id, job_id: "00000000-0000-4000-8000-000000000903" }] });
    }
    if (req.method() === "POST" && p === "campaigns/write") {
      const t = turnOn || { code: 200, data: { ok: true, ad: { id: AD_ROW, status: "ACTIVE" } } };
      return reply(t.code, t.data);
    }
    return reply(404, { error: "not_found" });
  });
  await page.goto(STUB_PATH);
  return { sent, errors };
}

const posts = (sent) => sent.filter((s) => s.method === "POST");

async function layoutChecks(page) {
  // No sideways page scroll.
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(over, "sideways scroll").toBeLessThanOrEqual(0);
  // Every button at least 44px tall.
  const short = await page.$$eval("[data-tab=launch] button", (els) =>
    els.filter((b) => b.offsetParent !== null && b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim()));
  expect(short, "buttons under 44px").toEqual([]);
  // Text 11px or larger.
  const tiny = await page.$$eval("[data-tab=launch] *", (els) =>
    els.filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()))
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 11).map((e) => e.textContent.trim().slice(0, 40)));
  expect(tiny, "text under 11px").toEqual([]);
  // One filled button.
  await expect(page.locator("[data-tab=launch] .btn.primary")).toHaveCount(1);
}

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`full at ${size.width}px: count top-left, one filled button, every ad with its state`, async ({ page }) => {
    await page.setViewportSize(size);
    const { sent, errors } = await open(page);
    const tab = page.locator("[data-tab=launch]");
    await expect(page.locator("#cclHeadline")).toHaveText("4 approved, 2 loaded");
    await expect(tab).toContainText("Loaded ads on now: 0");
    await expect(page.locator("#cclLoadAll")).toHaveText(/Load all approved into Meta, paused/);
    await expect(tab).toContainText("Ads load PAUSED");

    const row90 = page.locator('[data-row="' + VIDEO_C + '"]');
    await expect(row90).toContainText("Not loaded yet");
    await expect(row90.getByRole("button", { name: "Load to Meta" })).toBeVisible();

    const row92 = tab.locator(".ccl-row", { hasText: "Ad 92" });
    await expect(row92).toContainText("The final video is not in storage yet.");
    await expect(row92).toContainText("Ad set is paused: nothing in it spends until the ad set is on.");
    await expect(row92).toContainText("Campaign is paused: nothing in it spends until the campaign is on.");
    await expect(row92.getByRole("button", { name: "Retry load" })).toBeVisible();
    await expect(row92.getByRole("button", { name: "Turn on" })).toHaveCount(0);

    const row91 = tab.locator(".ccl-row", { hasText: "Ad 91" });
    await expect(row91).toContainText("Loaded, paused");
    await expect(row91).toContainText("up to $100 a day");
    await expect(row91.getByRole("button", { name: "Turn on" })).toBeEnabled();

    const row94 = tab.locator(".ccl-row", { hasText: "Ad 94" });
    await expect(row94).toContainText("daily budget unknown");
    await expect(row94.getByRole("button", { name: "Turn on" })).toBeDisabled();
    await expect(row94).toContainText("Turn on is off: we cannot see this ad set's daily budget yet.");

    await expect(tab.getByRole("link", { name: /Open Campaigns/ })).toHaveAttribute("href", "campaign-manager.html");
    await layoutChecks(page);
    expect(posts(sent)).toEqual([]);
    expect(sent.filter((s) => s.path === "ad-videos").map((s) => s.query)).toEqual(["?status=approved,delivered&limit=200"]);
    expect(errors).toEqual([]);
  });
}

test("Turn on at 390px: two taps, the budget first, then ONLY resume_ad with our ads.id", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let on = false;
  const { sent, errors } = await open(page, {
    status: () => { const b = loadStatus(); if (on) b.loads[0].ad_status = "ACTIVE"; return b; }
  });
  const row91 = page.locator(".ccl-row", { hasText: "Ad 91" });
  await row91.getByRole("button", { name: "Turn on" }).click();

  const sheet = page.getByRole("dialog", { name: "Turn on Ad 91?" });
  await expect(sheet).toContainText("It can spend up to $100 a day in Roadmap broad.");
  await expect(sheet).toContainText("The ad set is paused, so it will not spend until the ad set is on.");
  expect(posts(sent), "nothing sent before the second tap").toEqual([]);

  on = true;
  await sheet.getByRole("button", { name: "Yes, turn on Ad 91" }).click();
  await expect(row91).toContainText("Ad 91 is on.");
  await expect(row91).toContainText("On");

  const p = posts(sent);
  expect(p.length).toBe(1);
  expect(p[0].path).toBe("campaigns/write");
  expect(Object.keys(p[0].body).sort()).toEqual(["action", "ad_id", "request_id"]);
  expect(p[0].body.action).toBe("resume_ad");
  expect(p[0].body.ad_id).toBe(AD_ROW);
  expect(p[0].body.ad_id).not.toBe(META_AD);
  expect(p[0].body.request_id).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  expect(errors).toEqual([]);
});

test("Turn on: Cancel sends nothing; a 403 says Only Chris can turn ads on.", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sent } = await open(page, {
    turnOn: { code: 403, data: { ok: false, error: "forbidden", message: "Only Chris can turn ads on." } }
  });
  const row91 = page.locator(".ccl-row", { hasText: "Ad 91" });
  await row91.getByRole("button", { name: "Turn on" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts(sent)).toEqual([]);

  await row91.getByRole("button", { name: "Turn on" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, turn on Ad 91" }).click();
  await expect(row91).toContainText("Only Chris can turn ads on.");
  await expect(row91).toContainText("Loaded, paused");
  expect(posts(sent).map((s) => s.body.action)).toEqual(["resume_ad"]);
});

test("Turn on stays off with the reason when the budget is unknown: nothing is asked or sent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sent } = await open(page);
  const row94 = page.locator(".ccl-row", { hasText: "Ad 94" });
  await row94.getByRole("button", { name: "Turn on" }).click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posts(sent)).toEqual([]);
});

test("Load to Meta posts one video; Load all asks first, then posts {all:true}; both are paused loads", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { sent } = await open(page);
  const row90 = page.locator('[data-row="' + VIDEO_C + '"]');
  await row90.getByRole("button", { name: "Load to Meta" }).click();
  await expect(row90).toContainText("Queued. It loads paused.");
  let p = posts(sent);
  expect(p.length).toBe(1);
  expect(p[0].path).toBe("marketing/meta/load");
  expect(Object.keys(p[0].body).sort()).toEqual(["ad_video_id", "request_id"]);
  expect(p[0].body.ad_video_id).toBe(VIDEO_C);

  await page.locator("#cclLoadAll").click();
  const sheet = page.getByRole("dialog", { name: "Load 2 ads into Meta?" });
  await expect(sheet).toContainText("2 ads load PAUSED into their funnel's ad set. Nothing spends until you turn one on. Costs $0.");
  expect(posts(sent).length, "nothing before the second tap").toBe(1);
  await sheet.getByRole("button", { name: "Load them" }).click();
  await expect(page.locator("[data-tab=launch]")).toContainText("2 ads queued. They load paused.");
  p = posts(sent);
  expect(p.length).toBe(2);
  expect(p[1].path).toBe("marketing/meta/load");
  expect(p[1].body.all).toBe(true);
  expect(Object.keys(p[1].body).sort()).toEqual(["all", "request_id"]);
  expect(p.every((s) => s.path === "marketing/meta/load")).toBe(true);
});

test("loading: skeletons in the real layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let release;
  const gate = new Promise((r) => { release = r; });
  await open(page, { statusGate: gate });
  await expect(page.locator("[data-tab=launch][aria-busy=true] .skel").first()).toBeVisible();
  release();
  await expect(page.locator("#cclHeadline")).toHaveText("4 approved, 2 loaded");
});

test("empty: says what will show and where to go", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { status: { loads: [], as_of: null }, approved: { ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: [] } });
  const tab = page.locator("[data-tab=launch]");
  await expect(tab).toContainText("No approved videos to load. Approve one on Videos first.");
  await expect(page.locator("#cclLoadAll")).toBeDisabled();
  await expect(tab).toContainText("Nothing to load yet. Approve a video on Videos first.");
  await expect(tab).toContainText("Meta has not synced yet");
  await tab.getByRole("button", { name: "Open Videos" }).click();
  expect(await page.evaluate(() => window.__stub.gone)).toEqual(["videos"]);
  await layoutChecks(page);
});

test("error: a sentence and Try again, never a code", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let fail = true;
  await open(page, { statusAnswer: () => (fail ? [500, { error: "internal" }] : [200, loadStatus()]) });
  const tab = page.locator("[data-tab=launch]");
  await expect(tab).toContainText("The Meta loads did not load. Try again.");
  await expect(tab).not.toContainText("500");
  await expect(tab).not.toContainText("internal");
  await expect(page.locator("#cclLoadAll")).toBeDisabled();
  await layoutChecks(page);
  fail = false;
  await tab.getByRole("button", { name: "Try again" }).first().click();
  await expect(page.locator("#cclHeadline")).toHaveText("4 approved, 2 loaded");
});

test("one part fails: the approved list error is its own banner, the rest still shows", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { approved: null });
  const tab = page.locator("[data-tab=launch]");
  await expect(page.locator("#cclHeadline")).toHaveText("3 approved, 2 loaded");
  await expect(tab).toContainText("The list of approved videos did not load. The rest of this page is current. Try again.");
});
