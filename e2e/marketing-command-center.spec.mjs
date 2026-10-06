// The Marketing Command Center in a real browser, offline.
//
// e2e/static-server.mjs serves public/ and page.route() answers /api/** the
// way the back ends answer: GET marketing/today as api/marketing/today.mjs
// builds it (the slice 0 shape, docs/specs/marketing-today-contract.md),
// GET ad-videos as api/ad-videos.mjs, GET/POST marketing/offer/generate as
// M12's handler does, and the existing creative/generate + creative/run. No
// staff login on the live site, no database, nothing sent anywhere. Every
// answer below is a MOCK shaped like the real one; the numbers in it are test
// numbers, not live numbers.
//
// It proves the four states (loading, empty, error, full) at 390x844 and at
// 1280, the one button (Write ad copy) end to end with max_jobs: 1, the Offer
// card following a run to the end, and slice 0 of
// docs/specs/command-center-design-2026-10-05.md: cost lines, "Ad spend, all
// accounts", the as-of words and the "Old numbers" lead, "Today's numbers come
// in tomorrow morning", the footer clock and the 5-minute / focus reload, the
// word table, Read it, the videos waiting row, Show more instead of inner
// scroll boxes, the chip on the row's first line at 390px, and .span-4
// stacking at 960px.
//
// THE FRAME (U34). Today is now one tab module (public/app/marketing-cc-today.js)
// inside the frame (marketing-command-center.js). Every Today test above runs
// unchanged against it. The frame tests at the bottom prove the strip shows
// only tabs that exist, Settings behind the gear top-right, hash routing
// (#today, #settings, an unknown #ideas falls back to Today), Back, the
// remembered tab, and the strip at 390px.
//
// EVIDENCE. Each scenario that matters to Chris screenshots the viewport and
// records the live bounding box of the element under discussion into
// shot-marks.json. _apply-marks.py (a copy of
// ops/workflows/w4b-proof-2026-09-03/_apply-marks.py) burns those into numbered
// red boxes with a legend (CLAUDE.md §8). Evidence folders are gitignored.
// Output goes to MCC_PROOF_OUT (or the older M11_PROOF_OUT), or the system temp
// directory — never into a tracked path.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER, CLOSER, json, wireApi, withSession, trackErrors, assertPageAlive } from "./harness.mjs";
import { exampleResponse } from "../src/marketing/api-contract.mjs";

const OUT_DIR = process.env.MCC_PROOF_OUT || process.env.M11_PROOF_OUT;
const OUT = OUT_DIR ? path.resolve(OUT_DIR) : path.join(os.tmpdir(), "mcc-marketing-command-center");
const RAW = path.join(OUT, "shots", "_raw");
const MANIFEST = path.join(OUT, "shots", "shot-marks.json");
fs.mkdirSync(RAW, { recursive: true });

const PAGE = "/app/marketing-command-center.html";
// 19:00 UTC is 12:00 PM in Arizona.
const NOW = "2026-10-05T19:00:00Z";
const HOUSE = "11111111-2222-4333-8444-555555555555";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const CARD = (decided) => `**What this decided:** ${decided}\n\n**Three things to check:** Is this right? · Is the price right? · Is the guarantee right?\n\n**What I wasn't sure about:** nothing.\n\n**Say one of:** approve · tweak: \\<what to change\\> · redo`;

const STAGES = [
  { n: 1, key: "avatar", label: "avatar", state: "READY", approved: true, status: "ready approved", why: "133 quotes", reasons: [],
    counts: { quotes: 133, languageEntries: 203 }, review_card: CARD("who the partner is, in their own words.") },
  { n: 2, key: "ad-research", label: "ad research", state: "READY", approved: false, status: "ready not reviewed", why: "8 ads", reasons: [],
    counts: { rowsFound: 361, rowsVerified: 8, rowsWithFirstSeen: 144, competitorsFound: 160 }, review_card: CARD("what the market already sells.") },
  { n: 3, key: "offer", label: "offer", state: "FAILED", approved: false, status: "FAILED", why: "did not report guarantees", reasons: ["did not report guarantees"],
    counts: { priceSet: 1, bonuses: 3, valueEquationScores: 4 }, review_card: CARD("the partner offer and its price.") },
  { n: 4, key: "copy", label: "copy", state: "FAILED", approved: false, status: "FAILED", why: "did not report distinctReasons", reasons: ["did not report distinctReasons"],
    counts: { hooks: 31 }, review_card: CARD("which three hooks go live first.") },
  { n: 5, key: "ad-strategy", label: "ad strategy", state: "BLOCKED", approved: false, status: "BLOCKED", why: "waiting on offer and copy", reasons: ["waiting on offer and copy"],
    counts: { strategyNamed: 1 }, review_card: CARD("run the Forester.") },
  { n: 6, key: "spend", label: "spend", state: "MISSING", approved: false, status: "MISSING", why: "has not been run yet", reasons: ["has not been run yet"],
    counts: {}, review_card: null }
];

const ok = (key) => ({ key, ok: true, label: key, missing: null });
const NO_OFFER_COST = { measured: false, job_id: null, finished_at: null, seconds: null, input_tokens: null, output_tokens: null,
  models: [], cost_cents: null, under_one_cent: false, unpriced_models: [] };
const NO_COPY_COST = { runs: 0, last_at: null, models: [], avg_input_tokens: null, avg_output_tokens: null,
  avg_cost_cents: null, under_one_cent: false, unpriced_models: [] };
/* The shape of the offer contract's one measured run (4 min 29 s, 67 cents). */
const OFFER_MEASURED = { measured: true, job_id: "o0", finished_at: "2026-10-05T18:04:29Z", seconds: 269,
  input_tokens: 24551, output_tokens: 28640, models: ["claude-opus-5-5"], cost_cents: 67, under_one_cent: false, unpriced_models: [] };

const LONG_COPY = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: your bank said no, and it was not about you.`).join("\n");

function today(over = {}) {
  return {
    ok: true,
    as_of: NOW,
    today: "2026-10-05",
    timezone: "America/Phoenix",
    waiting: [],
    flywheel: { campaigns: [{ campaign: "partner", stages: STAGES, advice: "2 stages need re-running. Do them in order: 3, then 4." }] },
    copy: {
      partner_id: HOUSE,
      pieces: [
        { id: "a2", copy_text: "Guaranteed approval in 24 hours!", compliance_state: "blocked",
          blocked_reasons: [{ code: "guarantee", rule_set: "funding", message: "Funding ads may not promise approval." }],
          created_at: "2026-10-04T18:00:00Z" },
        { id: "a1", copy_text: LONG_COPY, compliance_state: "passed", blocked_reasons: [], created_at: "2026-10-03T18:00:00Z" }
      ],
      jobs: [{ id: "j1", status: "failed", error: "no active provider configured for org x", created_at: "2026-09-17T10:00:00Z" }]
    },
    copy_ready: {
      ready: true, partner_id: HOUSE,
      checks: [ok("marketing_switch"), ok("copy_provider"), ok("anthropic_key"), { ...ok("writing_budget"), used: 1000, cap: 250000 }],
      missing: []
    },
    spend: {
      currency: "USD",
      through: "2026-10-04",
      windows: {
        today: { from: "2026-10-05", to: "2026-10-05", days: 1, spend_cents: null, ad_days: 0, days_with_data: 0 },
        last_7_days: { from: "2026-09-28", to: "2026-10-04", days: 7, spend_cents: 123456, ad_days: 40, days_with_data: 7 },
        prior_7_days: { from: "2026-09-21", to: "2026-09-27", days: 7, spend_cents: 100000, ad_days: 40, days_with_data: 7 },
        last_30_days: { from: "2026-09-05", to: "2026-10-04", days: 30, spend_cents: 500000, ad_days: 46, days_with_data: 12 },
        prior_30_days: { from: "2026-08-06", to: "2026-09-04", days: 30, spend_cents: 400000, ad_days: 30, days_with_data: 10 }
      }
    },
    last_sync: { meta_synced_at: "2026-10-05T07:01:00Z", metrics_synced_at: "2026-10-05T07:01:30Z", latest_metrics_date: "2026-10-04",
      clickfunnels_synced_at: "2026-10-04T22:10:00Z" },
    costs: { offer: OFFER_MEASURED, copy: NO_COPY_COST },
    ...over
  };
}

/* The two videos that have waited since Sep 24 (their text links ran out Sep 27). */
const VIDEOS = { ok: true, count: 2, limit: 50, offset: 0, hasMore: false, items: [
  { id: "v84", ad_id: "84", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T01:45:25Z",
    updated_at: "2026-09-24T07:55:11Z", approval_expires_at: "2026-09-27T05:45:21Z", status_means: "waiting on Chris" },
  { id: "v86", ad_id: "86", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T22:08:52Z",
    updated_at: "2026-09-24T23:39:26Z", approval_expires_at: "2026-09-27T23:39:25Z", status_means: "waiting on Chris" }
] };
const NO_VIDEOS = { ok: true, count: 0, limit: 50, offset: 0, hasMore: false, items: [] };

const OFFER_VIEW = {
  job_id: "o2", campaign: "partner", as_of: "2026-10-05", finished_at: "2026-10-05T19:00:10Z",
  offer: {
    oneSentence: "Know your funding number before you apply anywhere.",
    name: "Funding Roadmap", price: "$297",
    whatTheyGet: ["Your funding number today", "The steps to raise it"],
    guarantees: [{ name: "Clear plan", promise: "Money back if the plan is not clear." }],
    bonuses: ["Business Duplication Map"]
  },
  review_card: { whatThisDecided: "The price and the guarantee.", threeThingsToCheck: ["Price", "Guarantee", "Bonus"], notSureAbout: ["nothing"] }
};

/* api — today + videos + offer + copy answers. Each can be swapped per test.
   `todayAnswers` is a list used in order, one per GET (the last one repeats),
   so a reload can answer differently from the first load. */
function handlers({ t = today(), todayStatus = 200, todayAnswers, videos = [VIDEOS, 200], offerGet, offerPost, generate, run,
  delayToday = 0, counter } = {}) {
  let n = 0;
  return {
    "/api/marketing/today": async (route) => {
      const i = n++;
      if (counter) counter.today = n;
      if (delayToday) await new Promise((r) => setTimeout(r, delayToday));
      if (todayAnswers) {
        const a = todayAnswers[Math.min(i, todayAnswers.length - 1)];
        if (a === "abort") return route.abort("internetdisconnected");
        // A read that never answers (a phone that slept mid-load).
        if (a === "hang") return new Promise(() => {});
        return json(route, a[0], a[1]);
      }
      await json(route, t, todayStatus);
    },
    "/api/ad-videos": async (route) => json(route, videos[0], videos[1]),
    "/api/marketing/offer/generate": async (route, { url, method }) => {
      if (method === "POST") {
        const [body, status] = offerPost || [{ ok: false, error: "not_found", path: "marketing/offer/generate" }, 404];
        return json(route, body, status);
      }
      const [body, status] = offerGet ? offerGet(url) : [{ ok: false, error: "not_found", path: "marketing/offer/generate" }, 404];
      return json(route, body, status);
    },
    "/api/creative/generate": async (route) => {
      const [body, status] = generate || [{ ok: true, created: true, job: { id: "job-9" }, provider_ready: true }, 200];
      return json(route, body, status);
    },
    "/api/creative/run": async (route) => {
      const [body, status] = run || [{ ok: true, ran: 1, succeeded: 1, failed: 0, requeued: 0, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", compliance_state: "passed",
          copy_text: "Your bank said no? It was not about you.\nIt was about one line on your file.\nSee your funding number before you apply again." }] }
      ] }, 200];
      return json(route, body, status);
    }
  };
}

async function open(page, h, session = OWNER, { clock = true } = {}) {
  const errors = trackErrors(page);
  if (clock) await page.clock.install({ time: new Date(NOW) });
  await withSession(page, session);
  await wireApi(page, session, h);
  await page.goto(PAGE);
  return errors;
}

/* ── evidence ─────────────────────────────────────────────────────────────── */

function readManifest() {
  try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return {}; }
}

async function shot(page, file, legend, marks, { height, anchor } = {}) {
  // A shot whose marks span more than one screen is taken in a taller window,
  // never with a box pointing off the picture.
  if (height) {
    await page.setViewportSize({ width: page.viewportSize().width, height });
    await page.waitForTimeout(150);
  }
  // Scroll the anchor (or the first mark) into view, then measure everything
  // in the viewport. The topbar is sticky, so leave room under it.
  if (anchor) {
    // The sticky topbar wraps to two rows on a phone, so leave its real
    // height (plus 8px) above the anchor, not a guess.
    await page.locator(anchor).first().evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      const bar = document.querySelector("header.topbar");
      window.scrollBy(0, -((bar ? bar.getBoundingClientRect().height : 64) + 8));
    });
    await page.waitForTimeout(150);
  } else if (marks.length) {
    await page.locator(marks[0].selector).first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(150);
  }
  const vp = page.viewportSize();
  const out = [];
  for (const [i, m] of marks.entries()) {
    const box = await page.locator(m.selector).first().boundingBox();
    expect(box, `mark ${i + 1} (${m.caption}) has no box — ${m.selector}`).not.toBeNull();
    expect(box.y >= 0 && box.y + box.height <= vp.height,
      `mark ${i + 1} (${m.caption}) is outside the ${vp.width}x${vp.height} frame`).toBe(true);
    out.push({ n: i + 1, caption: m.caption,
      box: { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } });
  }
  await page.screenshot({ path: path.join(RAW, file) });
  const manifest = readManifest();
  manifest[file] = { legend, marks: out };
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
}

/* No inner scroll box anywhere on the page (design §3.0): every element that
   could scroll its own content either does not, or has nothing to scroll. */
async function innerScrollBoxes(page) {
  return page.locator("#mcc-root").evaluate((root) => {
    const bad = [];
    root.querySelectorAll("*").forEach((el) => {
      const cs = getComputedStyle(el);
      const y = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
      const x = /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
      if (y || x) bad.push(el.id || el.className || el.tagName);
    });
    return bad;
  });
}

/* ── the states ───────────────────────────────────────────────────────────── */

test("loading: skeletons in the real layout, the button waits", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, handlers({ delayToday: 2500 }), OWNER, { clock: false });
  await expect(page.locator("#tileSpend7 .skel").first()).toBeVisible();
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#copyCost")).toHaveText("Checking what a run costs…");
  await shot(page, "00-loading.png", "Loading at 1280: real layout, no spinner", [
    { selector: "#tileSpend7", caption: "Spend tile holds its place" },
    { selector: "#copySetup", caption: "Button waits while it checks" }
  ]);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56", { timeout: 6000 });
});

test("loading at 390: skeletons, one column", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers({ delayToday: 2500 }), OWNER, { clock: false });
  await expect(page.locator("#tileSpend7 .skel").first()).toBeVisible();
  const a = await page.locator("#tileSpend7").boundingBox();
  const b = await page.locator("#tileSpend30").boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  await shot(page, "18-loading-390.png", "Loading at 390: skeletons, one column", [
    { selector: "#tileSpend7", caption: "Spend tile skeleton" },
    { selector: "#tileSpend30", caption: "Stacked under it" }
  ]);
});

test("full at 1280: spend with whole days, as-of words, cost lines, every card filled", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await open(page, handlers({
    offerGet: () => [{ ok: true, ready: true, job: { id: "o1", status: "done" }, offer: OFFER_VIEW }, 200]
  }));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await assertPageAlive(page, errors);

  // "Ad spend, all accounts", whole days, and both comparisons.
  await expect(page.locator("#tileSpend7 .caption")).toHaveText("Ad spend, all accounts, last 7 days");
  await expect(page.locator("#tileSpend7 .cmp")).toHaveText("Up from $1,000 the 7 days before.");
  await expect(page.locator("#tileSpend7 .note")).toContainText("Sep 28 to Oct 4.");
  await expect(page.locator("#tileSpend30 .vl")).toHaveText("$5,000");
  await expect(page.locator("#tileSpend30 .cmp")).toContainText("Up from $4,000 the 30 days before.");
  await expect(page.locator("#tileSpend30 .cmp")).toContainText("Numbers saved for 12 of 30 days.");
  await expect(page.locator("#tileSpend30 .note")).toHaveText(
    "Sep 5 to Oct 4. Today's numbers come in tomorrow morning. The Meta pull runs at midnight, Arizona time.");
  await expect(page.locator("#mccAsOf")).toHaveText(
    "Numbers through Oct 4, saved 12:01 AM (11 hours ago). ClickFunnels last pulled Oct 4, 3:10 PM.");
  // UI-STANDARDS §7: each time in the sentence has its own exact-time tooltip.
  await expect(page.locator("#mccAsOf span[title]")).toHaveCount(2);
  await expect(page.locator("#mccAsOf span[title]").nth(0)).toHaveAttribute("title", "Oct 5, 2026, 12:01 AM");
  await expect(page.locator("#mccAsOf span[title]").nth(1)).toHaveAttribute("title", "Oct 4, 2026, 3:10 PM");
  await expect(page.locator("#tileParts .caption")).toHaveText("What is turned on");
  await expect(page.locator("#tileParts .vl")).toHaveText("6 of 6");

  // Cost lines: a measured offer run; no copy run measured yet.
  await expect(page.locator("#offerCost")).toHaveText(
    "About 5 minutes and about $0.67 (last run: 4 min 29 s). One run at a time.");
  await expect(page.locator("#copyCost")).toHaveText(
    "Time: unknown, not measured yet. Cost: unknown, not measured yet. " +
    "Writing budget this month: 1,000 of 250,000 tokens used. A token is a small piece of a word.");
  await expect(page.locator("#offerHonest")).toContainText("checked two different ways right now");

  await expect(page.locator("#copySetup")).toHaveText("Ready. It writes one ad and checks it against the ad rules.");
  await expect(page.locator("#copyBtn")).toBeEnabled();
  await expect(page.locator("#waitingCount")).toHaveText("4 to do");
  await expect(page.locator("#waitingList li").first()).toContainText("Approve or reject 2 videos");
  await expect(page.locator("#waitingList")).toContainText("Redo the offer (step 3 of 6)");
  await expect(page.locator("#flywheelList li")).toHaveCount(6);
  await expect(page.locator('#flywheelList [data-stage="copy"]')).toContainText("It did not count its different reasons. Redo the step.");
  await expect(page.locator("#flywheelList")).toContainText("2 steps need a redo. Do them in order: 3, then 4.");
  await expect(page.locator('#flywheelList [data-stage="avatar"]')).toContainText("Done. 133 customer quotes collected.");
  await expect(page.locator("#offerLatest")).toContainText("Funding Roadmap");
  await expect(page.locator("#latestList")).toContainText("Funding ads may not promise approval.");
  await expect(page.locator("#latestList")).toContainText("No copy writer is switched on for this account.");
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:00 PM");
  await expect(page.locator("#mccStamp")).toHaveAttribute("title", "Oct 5, 2026, 12:00 PM");

  // UI-STANDARDS §1: exactly one filled button on the screen.
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  // §1 fold: the one job is doable without scrolling on a 900px-tall window.
  const btn = await page.locator("#copyBtn").boundingBox();
  expect(btn.y + btn.height).toBeLessThanOrEqual(900);
  // Three tiles side by side above 960px, spend top-left.
  const s7 = await page.locator("#tileSpend7").boundingBox();
  const s30 = await page.locator("#tileSpend30").boundingBox();
  const parts = await page.locator("#tileParts").boundingBox();
  expect(s7.x).toBeLessThan(s30.x);
  expect(s30.x).toBeLessThan(parts.x);
  expect(Math.abs(s7.y - parts.y)).toBeLessThan(2);
  // No inner scroll box anywhere.
  expect(await innerScrollBoxes(page)).toEqual([]);

  // §12.7 — assert the COMPUTED sizes, not the classes.
  const size = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size("#tileSpend7 .vl")).toBe("32px");
  expect(await size("#cardCopy h2")).toBe("20px");
  expect(await size("#tileSpend7 .caption")).toBe("13px");
  expect(await size("#copyAngle")).toBe("16px");
  expect(await size("#offerCost")).toBe("13px");
  // §12.2 — the card wears the brand's resting shadow, written nowhere on this screen.
  const shadow = await page.locator("#cardCopy").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("rgba(10, 10, 10, 0.06)");

  await shot(page, "01-today-1280.png", "Today at 1280 (mocked answers)", [
    { selector: "#tileSpend7", caption: "Ad spend, all accounts: 7 whole days vs the 7 before" },
    { selector: "#tileSpend30 .note", caption: "Today's numbers come in tomorrow morning" },
    { selector: "#mccAsOf", caption: "Numbers through Oct 4, saved 12:01 AM; ClickFunnels time" },
    { selector: "#copyCost", caption: "Write ad copy: time and cost, unknown until measured" },
    { selector: '#waitingList li[data-wait="videos"]', caption: "2 videos waiting since Sep 24" }
    // The tab strip (U34) sits above the tiles, so the cost line under the
    // button now ends just past 900px; the shot is taken 1000px tall. The
    // fold check above (the button itself inside 900px) is unchanged.
  ], { height: 1000 });

  await shot(page, "02-offer-and-market-1280.png", "Offer card and Offer and market at 1280", [
    { selector: "#offerCost", caption: "Write offer cost from the last measured run" },
    { selector: "#offerHonest", caption: "Honest sentence: two different checks" },
    { selector: '#flywheelList [data-stage="avatar"]', caption: "Who we sell to: Done, approved, with its count" },
    { selector: '#flywheelList [data-stage="offer"]', caption: "The offer, step 3 of 6: Needs a redo, and why" }
  ], { height: 1500, anchor: "#cardOffer" });
});

test("Read it unfolds the stage's review card on the page; Show more opens long words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, handlers({
    offerGet: () => [{ ok: true, ready: true, job: { id: "o1", status: "done" }, offer: OFFER_VIEW }, 200]
  }));
  const row = page.locator('#flywheelList [data-stage="offer"]');
  const read = row.getByRole("button", { name: "Read it" });
  await expect(row.locator(".review")).toBeHidden();
  await read.click();
  await expect(row.locator(".review")).toBeVisible();
  await expect(row.locator(".review")).toContainText("What this decided: the partner offer and its price.");
  await expect(row.locator(".review")).toContainText("Approve or tweak: Not on this page yet: it ships in slice 5.");
  await expect(row.getByRole("button", { name: "Hide it" })).toHaveAttribute("aria-expanded", "true");
  // Step 6 has nothing to read: the button is off and says why.
  const spend = page.locator('#flywheelList [data-stage="spend"]');
  await expect(spend.getByRole("button", { name: "Read it" })).toBeDisabled();
  await expect(spend).toContainText("Nothing to read yet: this step has not been run.");

  await shot(page, "03-read-it-1280.png", "Read it, opened (1280)", [
    { selector: '#flywheelList [data-stage="offer"] .review', caption: "The offer's review card, on the page" },
    { selector: '#flywheelList [data-stage="offer"] button[data-toggle]', caption: "Hide it closes it again" }
  ], { anchor: '#flywheelList [data-stage="offer"]' });

  // The offer: the review card and name first, the rest behind Show more.
  await expect(page.locator("#offerMore")).toBeHidden();
  await page.locator('#offerLatest button[data-toggle="offerMore"]').click();
  await expect(page.locator("#offerMore")).toBeVisible();
  await expect(page.locator("#offerMore")).toContainText("Money back if the plan is not clear.");

  // A long ad copy piece: its head, then the rest behind Show more.
  await expect(page.locator("#latest-1-short")).toContainText("Line 6:");
  await expect(page.locator("#latest-1")).toBeHidden();
  await page.locator('#latestList button[data-toggle="latest-1"]').click();
  await expect(page.locator("#latest-1")).toContainText("Line 12:");
  await expect(page.locator("#latest-1-short")).toBeHidden();
  expect(await innerScrollBoxes(page)).toEqual([]);
});

test("Write ad copy: generate, then run with max_jobs 1, then the words and the rules result", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const seen = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/creative/")) seen.push({ url: r.url(), body: r.postDataJSON() });
  });
  await open(page, handlers());
  await expect(page.locator("#copyBtn")).toBeEnabled();

  // Blank is stopped before anything is sent.
  await page.locator("#copyBtn").click();
  await expect(page.locator("#copySay")).toHaveText("Write a few words about what this ad is about first.");
  expect(seen).toHaveLength(0);

  await page.locator("#copyAngle").fill("Business owners the bank turned down");
  await page.locator("#copyOffer").selectOption("funding");
  await page.locator("#copyBtn").click();
  await expect(page.locator("#copySay")).toHaveText("Done. Here is your new ad copy. It passed the ad rules check.");
  await expect(page.locator("#copyResult")).toContainText("It was about one line on your file.");
  await expect(page.locator("#copyResult")).toContainText("Passed the ad rules");

  expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/api/creative/generate", "/api/creative/run"]);
  expect(seen[0].body.partner_id).toBe(HOUSE);
  expect(seen[0].body.asset_kind).toBe("copy");
  expect(seen[0].body.spec).toMatchObject({ assetKind: "copy", offerType: "funding", prompt: "Business owners the bank turned down" });
  expect(seen[0].body.idempotency_key).toMatch(/^mcc-copy-\d{14}-\d{6}$/);
  expect(seen[1].body).toEqual({ partner_id: HOUSE, max_jobs: 1 });

  await shot(page, "04-write-ad-copy.png", "Write ad copy, pressed (max_jobs 1)", [
    { selector: "#copyAngle", caption: "What the ad is about (typed)" },
    { selector: "#copySay", caption: "Answer in plain words" },
    { selector: "#copyResult .piece", caption: "New ad copy and its rules result" }
  ], { height: 1200, anchor: "#cardCopy" });
});

test("Write ad copy: a refusal is a sentence and nothing runs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const runs = [];
  page.on("request", (r) => { if (r.url().includes("/api/creative/run")) runs.push(r.url()); });
  await open(page, handlers({ generate: [{ ok: false, error: "suite_off" }, 403] }));
  await page.locator("#copyAngle").fill("x");
  await page.locator("#copyBtn").click();
  await expect(page.locator("#copySay")).toHaveText("Marketing is switched off for the Fundhub house account, so nothing was written.");
  expect(runs).toHaveLength(0);
  await expect(page.locator("#copyBtn")).toBeEnabled();
});

test("Write offer: starts a run and follows it until the offer is on the card", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  let done = false;
  const posts = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/marketing/offer/generate") && r.method() === "POST") posts.push(r.postDataJSON());
  });
  await open(page, handlers({
    offerPost: [{ ok: true, started: true, already_running: false, job: { id: "o2", status: "queued", created_at: NOW },
      poll: "/api/marketing/offer/generate?id=o2",
      message: "Writing the offer. Six offers, four judges, one winner — this takes a few minutes." }, 202],
    offerGet: (url) => {
      if (!url.includes("id=o2")) return [{ ok: true, ready: true, job: null, offer: null }, 200];
      return done
        ? [{ ok: true, ready: true, job: { id: "o2", status: "done", finished_at: "2026-10-05T19:00:10Z" }, offer: OFFER_VIEW }, 200]
        : [{ ok: true, ready: true, job: { id: "o2", status: "running", created_at: NOW }, offer: null }, 200];
    }
  }));
  await expect(page.locator("#offerLatest")).toHaveText("No offer has been written here yet.");
  await expect(page.locator("#offerHonest")).toBeHidden();
  await page.locator("#offerBtn").click();
  await expect(page.locator("#offerSay")).toContainText("this takes a few minutes");
  expect(posts).toEqual([{ campaign: "partner" }]);

  await page.clock.runFor(10_000);           // first look: still running
  await expect(page.locator("#offerLatest")).toHaveText("No offer has been written here yet.");
  done = true;
  await page.clock.runFor(10_000);           // second look: done
  await expect(page.locator("#offerSay")).toHaveText("Done. Here is the new offer.");
  await expect(page.locator("#offerLatest")).toContainText("Funding Roadmap");
  await expect(page.locator("#offerLatest")).toContainText("$297");
  await expect(page.locator("#offerHonest")).toBeVisible();
  await page.locator('#offerLatest button[data-toggle="offerMore"]').click();
  await expect(page.locator("#offerLatest")).toContainText("Money back if the plan is not clear.");

  await shot(page, "05-write-offer.png", "Write offer, pressed", [
    { selector: "#offerBtn", caption: "Write offer" },
    { selector: "#offerLatest .offer-body", caption: "The new offer: review card, name, rest behind Show more" },
    { selector: "#offerSay", caption: "Done. Here is the new offer." }
  ], { height: 1400, anchor: "#cardOffer" });
});

test("error: marketing/today not shipped answers 404 and the page says so, inventing nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await open(page, handlers({ t: { ok: false, error: "not_found", path: "marketing/today" }, todayStatus: 404 }));
  await expect(page.locator("#mccBanner")).toHaveText("The marketing numbers are not ready yet. This page fills in after the next update.");
  await assertPageAlive(page, errors);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("unknown");
  await expect(page.locator("#tileSpend30 .vl")).toHaveText("unknown");
  await expect(page.locator("#tileParts .vl")).toHaveText("unknown");
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#offerLatest")).toHaveText("The offer writer is not ready yet. It turns on with the next update.");
  await expect(page.locator("#offerCost")).toHaveText("Time and cost: unknown. The marketing numbers did not load.");
  await expect(page.locator("#copyCost")).toHaveText("Time and cost: unknown. The marketing numbers did not load.");
  await expect(page.locator("#mccAsOf")).toBeHidden();
  await expect(page.locator("#mccStamp")).toHaveText("Not loaded");
  const text = await page.locator("#mcc-root").innerText();
  expect(text).not.toMatch(/\$0|\$\d/);
  await expect(page.locator("#offerBtn")).toBeDisabled();

  await shot(page, "06-error-not-ready.png", "Error: marketing numbers not ready", [
    { selector: "#mccBanner", caption: "What failed, in plain words" },
    { selector: "#tileSpend7 .vl", caption: "Unknown stays 'unknown', never $0" },
    { selector: "#copyCost", caption: "Cost line: unknown, and why" },
    { selector: "#offerLatest", caption: "Write offer: not ready yet" }
  ], { height: 1300 });
});

test("error per part: the video list fails, the rest of the page stays", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers({ videos: [{ ok: false, error: "boom" }, 500] }));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await expect(page.locator("#waitingList")).toContainText("The video list did not load. The rest of this page is current.");
  await expect(page.locator("#waitingList")).toContainText("Redo the offer (step 3 of 6)");
  await expect(page.locator("#mccBanner")).toBeHidden();
  await shot(page, "07-error-videos-390.png", "Error at 390: one part failed", [
    { selector: '#waitingList li[data-wait="redo"]', caption: "The flywheel rows still show" },
    { selector: "#waitingList .caption.muted", caption: "Only the video list failed, in words" }
  ], { height: 1300, anchor: "#cardWaiting" });
});

test("empty: nothing yet, said plainly", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers({
    t: today({ copy: { partner_id: HOUSE, pieces: [], jobs: [] },
      flywheel: { campaigns: [{ campaign: "partner", stages: [], advice: null }] },
      costs: { offer: NO_OFFER_COST, copy: NO_COPY_COST } }),
    videos: [NO_VIDEOS, 200],
    offerGet: () => [{ ok: true, ready: true, job: null, offer: null }, 200]
  }));
  await expect(page.locator("#waitingList")).toHaveText("Nothing is waiting on you right now.");
  await expect(page.locator("#waitingCount")).toHaveText("");
  await expect(page.locator("#flywheelList")).toHaveText("No steps are on file yet.");
  await expect(page.locator("#latestList")).toHaveText("No ad copy yet. Press Write ad copy to make the first one.");
  await expect(page.locator("#offerLatest")).toHaveText("No offer has been written here yet.");
  await expect(page.locator("#offerCost")).toHaveText("Time and cost: unknown, not measured yet. One run at a time.");
  await shot(page, "19-empty-390.png", "Empty at 390: nothing yet", [
    { selector: "#waitingList", caption: "Nothing waiting" }
  ], { anchor: "#cardWaiting" });
  await shot(page, "19b-empty-390-offer.png", "Empty at 390: the offer", [
    { selector: "#offerCost", caption: "No run measured: unknown, never a made-up cost" },
    { selector: "#offerLatest", caption: "No offer written yet" }
  ], { anchor: "#cardOffer" });
});

test("old numbers: a pull older than two days leads with 'Old numbers'", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers({ t: today({
    spend: { ...today().spend, through: "2026-09-30" },
    last_sync: { meta_synced_at: "2026-10-01T07:01:00Z", metrics_synced_at: "2026-10-01T07:01:30Z", latest_metrics_date: "2026-09-30",
      clickfunnels_synced_at: "2026-10-01T22:10:00Z" }
  }) }));
  await expect(page.locator("#tileSpend7 .lead")).toHaveText("Old numbers: last saved Oct 1.");
  await expect(page.locator("#tileSpend7 .lead span")).toHaveAttribute("title", "Oct 1, 2026, 12:01 AM");
  await expect(page.locator("#mccAsOf")).toHaveText(
    "Old numbers: last saved Oct 1, 12:01 AM. Numbers through Sep 30. ClickFunnels last pulled Oct 1, 3:10 PM.");
  await expect(page.locator("#tileSpend30 .note")).toContainText("Today so far: unknown.");
  await shot(page, "16-old-numbers-390.png", "Old numbers at 390", [
    { selector: "#tileSpend7 .lead", caption: "The row leads with Old numbers" },
    { selector: "#tileSpend30 .note", caption: "Today: unknown, because the pull is late" }
  ]);
});

test("ads stopped: the 7 days keep moving, the empty week says so, the week before keeps its money", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // As api/marketing/today.mjs answers on Oct 12 when the last ad ran Oct 4:
  // the midnight pull covered Oct 11, so the windows end there. The money is
  // the live Sep 28 to Oct 4 sum, read on 2026-10-05 after the U21 backfill.
  await page.clock.install({ time: new Date("2026-10-12T19:00:00Z") });
  await open(page, handlers({ t: today({
    today: "2026-10-12",
    spend: { currency: "USD", through: "2026-10-11", windows: {
      today: { from: "2026-10-12", to: "2026-10-12", days: 1, spend_cents: null, ad_days: 0, days_with_data: 0 },
      last_7_days: { from: "2026-10-05", to: "2026-10-11", days: 7, spend_cents: null, ad_days: 0, days_with_data: 0 },
      prior_7_days: { from: "2026-09-28", to: "2026-10-04", days: 7, spend_cents: 70727, ad_days: 28, days_with_data: 7 },
      last_30_days: { from: "2026-09-12", to: "2026-10-11", days: 30, spend_cents: 91549, ad_days: 36, days_with_data: 9 },
      prior_30_days: { from: "2026-08-13", to: "2026-09-11", days: 30, spend_cents: 62807, ad_days: 28, days_with_data: 11 }
    } },
    last_sync: { meta_synced_at: "2026-10-12T07:01:00Z", metrics_synced_at: "2026-10-12T07:01:30Z", latest_metrics_date: "2026-10-04",
      clickfunnels_synced_at: "2026-10-11T22:10:00Z" }
  }), videos: [NO_VIDEOS, 200] }), OWNER, { clock: false });
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("unknown");
  await expect(page.locator("#tileSpend7 .cmp")).toHaveText("The 7 days before: $707.27.");
  await expect(page.locator("#tileSpend7 .note")).toContainText("No ad spend saved for Oct 5 to Oct 11.");
  await expect(page.locator("#tileSpend7 .lead")).toHaveCount(0);
  await expect(page.locator("#tileSpend30 .vl")).toHaveText("$915.49");
  await expect(page.locator("#tileSpend30 .cmp")).toContainText("Up from $628.07 the 30 days before.");
  await expect(page.locator("#mccAsOf")).toContainText("Numbers through Oct 11, saved 12:01 AM");
  await expect(page.locator("#healthList")).toContainText("Numbers run through Oct 11. The last day with ad spend was Oct 4.");
  await shot(page, "21-ads-stopped-390.png", "Ads stopped at 390: the 7 days keep moving", [
    { selector: "#tileSpend7 .note", caption: "No ad spend saved for Oct 5 to Oct 11" },
    { selector: "#tileSpend7 .cmp", caption: "The 7 days before: $707.27" },
    { selector: "#tileSpend30 .cmp", caption: "30 days: plain money, no percent" }
  ]);
});

test("the footer clock, the 5-minute reload, the reload on focus, and a failed reload that keeps the numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const counter = { today: 0 };
  const second = today({ spend: { ...today().spend, windows: { ...today().spend.windows,
    last_7_days: { ...today().spend.windows.last_7_days, spend_cents: 130000 } } } });
  await open(page, handlers({ counter, todayAnswers: [[today(), 200], [second, 200], [{ ok: false, error: "boom" }, 500], "abort"] }));
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:00 PM");
  expect(counter.today).toBe(1);

  // Every 5 minutes.
  await page.clock.runFor(5 * 60 * 1000);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,300");
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:05 PM");
  expect(counter.today).toBe(2);

  // Coming back to the tab, more than 30 seconds later: read again. This
  // answer fails, so the numbers stay and the banner says how old they are.
  await page.clock.runFor(31_000);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.locator("#mccBanner")).toHaveText(
    "The marketing numbers did not refresh. This page shows the last load from 12:05 PM.");
  expect(counter.today).toBe(3);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,300");

  // Focus again within 30 seconds: no second read.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(200);
  expect(counter.today).toBe(3);

  // No connection at all on the next 5-minute read.
  await page.clock.runFor(5 * 60 * 1000);
  await expect(page.locator("#mccBanner")).toHaveText("No connection. This page shows the last load from 12:05 PM.");
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,300");
  await shot(page, "17-failed-reload-1280.png", "A failed reload keeps the last numbers", [
    { selector: "#mccBanner", caption: "No connection: the last load's time" },
    { selector: "#tileSpend7 .vl", caption: "The last good number stays" }
  ]);
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:05 PM");
  await page.locator("#mccStamp").scrollIntoViewIfNeeded();
  await shot(page, "17b-footer-clock-1280.png", "The footer clock", [
    { selector: "#mccStamp", caption: "Loaded 12:05 PM, the exact time in its tooltip" }
  ]);
});

test("a read that never answers is given up on after 20 seconds, and the next 5-minute reload still runs", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const counter = { today: 0 };
  const third = today({ spend: { ...today().spend, windows: { ...today().spend.windows,
    last_7_days: { ...today().spend.windows.last_7_days, spend_cents: 130000 } } } });
  await open(page, handlers({ counter, todayAnswers: [[today(), 200], "hang", [third, 200]] }));
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:00 PM");

  // 12:05: the read hangs. Nothing on the page changes yet.
  await page.clock.runFor(5 * 60 * 1000);
  expect(counter.today).toBe(2);
  await expect(page.locator("#mccBanner")).toBeHidden();

  // 12:05:20: the page gives up on it, keeps the numbers, and says so.
  await page.clock.runFor(20_000);
  await expect(page.locator("#mccBanner")).toHaveText(
    "The server took too long to answer. This page shows the last load from 12:00 PM.");
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await shot(page, "22-hung-read-1280.png", "A read that never answers is given up on", [
    { selector: "#mccBanner", caption: "Gave up after 20 seconds; the last load's time" },
    { selector: "#tileSpend7 .vl", caption: "The last good number stays" }
  ]);

  // 12:10: the next tick is not blocked by the hung read.
  await page.clock.runFor(5 * 60 * 1000 - 20_000);
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:10 PM");
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,300");
  await expect(page.locator("#mccBanner")).toBeHidden();
  expect(counter.today).toBe(3);
});

test("a repaint keeps an open review card open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, handlers());
  const row = page.locator('#flywheelList [data-stage="avatar"]');
  await row.getByRole("button", { name: "Read it" }).click();
  await expect(row.locator(".review")).toBeVisible();
  await page.clock.runFor(5 * 60 * 1000);
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:05 PM");
  await expect(row.locator(".review")).toBeVisible();
});

test("nothing sends Chris to chat: a row with no button names the slice that adds it", async ({ page }) => {
  // Owner law 2026-10-05 (design §3.9) and safety rule 9: no "Copy the chat
  // command", no "runs in chat", never a dead button.
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, handlers());
  const redo = page.locator('#waitingList li[data-wait="redo"]').first();
  await expect(redo).toContainText("Saving the offer file: Not on this page yet: it ships in slice 1.");
  const approve = page.locator('#waitingList li[data-wait="approve"]').first();
  await expect(approve).toContainText("Approving: Not on this page yet: it ships in slice 5.");
  await expect(page.locator('#flywheelList [data-stage="avatar"]')).toContainText("Not on this page yet: it ships in slice 5a. Cost not measured.");
  await expect(page.locator('#flywheelList [data-stage="ad-research"]')).toContainText("Not on this page yet: it ships in slice 10. Cost not measured.");
  await expect(page.locator("#mcc-root button", { hasText: /chat/i })).toHaveCount(0);
  const words = await page.locator("#mcc-root").innerText();
  expect(words).not.toMatch(/in chat|chat command|Claude Code/i);
  await shot(page, "23-no-chat-rows-1280.png", "Rows with no button say which slice adds it", [
    { selector: '#waitingList li[data-wait="approve"]', caption: "Approving: not on this page yet, slice 5" },
    { selector: '#waitingList li[data-wait="redo"]', caption: "Saving the offer file: slice 1" }
  ], { anchor: "#waitingList" });
});

test("signed out: a sentence, not a code", async ({ page }) => {
  await open(page, handlers({ t: { ok: false, error: "unauthorized" }, todayStatus: 401 }));
  await expect(page.locator("#mccBanner")).toHaveText("You are signed out. Sign in and open this page again.");
});

test("phone, 390x844: one column, no sideways scroll, no inner scroll box, chips on the first line", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page, handlers({
    offerGet: () => [{ ok: true, ready: true, job: { id: "o1", status: "done" }, offer: OFFER_VIEW }, 200]
  }));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await assertPageAlive(page, errors);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
  const a = await page.locator("#tileSpend7").boundingBox();
  const b = await page.locator("#tileSpend30").boundingBox();
  const c = await page.locator("#tileParts").boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(c.y).toBeGreaterThanOrEqual(b.y + b.height);
  const btn = await page.locator("#copyBtn").boundingBox();
  expect(btn.height).toBeGreaterThanOrEqual(44);
  expect(await innerScrollBoxes(page)).toEqual([]);

  // Every stage row: the state chip sits on the row's first line, beside the name.
  const rows = page.locator("#flywheelList li.row");
  await expect(rows).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    const main = await rows.nth(i).locator(".row-main").boundingBox();
    const chipBox = await rows.nth(i).locator(":scope > .chip").boundingBox();
    expect(Math.abs(chipBox.y - main.y), `row ${i + 1}: chip is not on the first line`).toBeLessThanOrEqual(6);
    expect(chipBox.x).toBeGreaterThan(main.x);
  }
  // Every tap target on the page is at least 40px; Read it and Show more are 44.
  const small = await page.locator("#mcc-root").evaluate((root) => [...root.querySelectorAll("button")]
    .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 40)
    .map((el) => el.textContent.trim()));
  expect(small).toEqual([]);
  const readIt = await page.locator('#flywheelList [data-stage="avatar"] button[data-toggle]').boundingBox();
  expect(readIt.height).toBeGreaterThanOrEqual(44);
  const minFont = await page.locator("#mcc-root").evaluate((root) => {
    let min = 99;
    root.querySelectorAll("*").forEach((el) => {
      if (el.offsetParent !== null && el.textContent.trim()) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    });
    return min;
  });
  expect(minFont).toBeGreaterThanOrEqual(11);

  await shot(page, "08-phone-390-top.png", "Phone 390: the top", [
    { selector: "#tileSpend7", caption: "One column: spend first, all accounts" },
    { selector: "#tileSpend30", caption: "30 days stacked under it" }
  ]);
  await shot(page, "09-phone-390-asof.png", "Phone 390: as-of and the third tile", [
    { selector: "#tileParts", caption: "What is turned on" },
    { selector: "#mccAsOf", caption: "Numbers through Oct 4, saved 12:01 AM" }
  ], { anchor: "#tileParts" });
  await shot(page, "10-phone-390-write.png", "Phone 390: the button and its cost", [
    { selector: "#copyBtn", caption: "Write ad copy, full width" },
    { selector: "#copyCost", caption: "Its time and cost line: unknown, not measured yet" }
  ], { anchor: "#copyOffer" });
  await expect(page.locator('#waitingList li[data-wait="videos"] span[title]').first()).toHaveAttribute("title", "Sep 24, 2026, 12:55 AM");
  await shot(page, "11-phone-390-waiting.png", "Phone 390: Waiting on you", [
    { selector: '#waitingList li[data-wait="videos"]', caption: "2 videos waiting since Sep 24; links ran out Sep 27" },
    { selector: '#waitingList li[data-wait="approve"]', caption: "Read and approve: copy the approve command" }
  ], { anchor: "#cardWaiting" });
  await shot(page, "12-phone-390-offer.png", "Phone 390: the Offer card", [
    { selector: "#offerStatus", caption: "The offer, step 3 of 6: chip on the first line" },
    { selector: "#offerCost", caption: "Last measured run: time and dollars" }
  ], { anchor: "#cardOffer" });
  await shot(page, "13-phone-390-stage-rows.png", "Phone 390: Offer and market rows", [
    { selector: '#flywheelList [data-stage="avatar"] > .chip', caption: "Chip on the row's first line" },
    { selector: '#flywheelList [data-stage="avatar"] button[data-toggle]', caption: "Read it on every row" },
    { selector: '#flywheelList [data-stage="ad-research"] > .chip', caption: "Done: waits for your approval" }
  ], { anchor: "#cardFlywheel" });

  // Read it and Show more on the phone, opened.
  await page.locator('#flywheelList [data-stage="avatar"] button[data-toggle]').click();
  await shot(page, "14-phone-390-read-it.png", "Phone 390: Read it, opened", [
    { selector: '#flywheelList [data-stage="avatar"] .review', caption: "The review card, in place, no scroll box" }
  ], { anchor: '#flywheelList [data-stage="avatar"]' });
  await page.locator('#latestList button[data-toggle="latest-1"]').scrollIntoViewIfNeeded();
  await shot(page, "15-phone-390-show-more.png", "Phone 390: long ad copy folds", [
    { selector: "#latest-1-short", caption: "The head of a long piece" },
    { selector: '#latestList button[data-toggle="latest-1"]', caption: "Show more, instead of a scroll box" }
  ], { anchor: "#latest-1-short" });
  expect(await innerScrollBoxes(page)).toEqual([]);
});

test("960px: the three tiles stack one per row", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await open(page, handlers());
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  const a = await page.locator("#tileSpend7").boundingBox();
  const b = await page.locator("#tileSpend30").boundingBox();
  const c = await page.locator("#tileParts").boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  expect(c.y).toBeGreaterThanOrEqual(b.y + b.height);
  expect(Math.abs(a.width - b.width)).toBeLessThan(2);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(960);
  await shot(page, "20-tiles-stack-960.png", "960px: tiles stack", [
    { selector: "#tileSpend7", caption: "Tile 1, full width" },
    { selector: "#tileSpend30", caption: "Tile 2, under it" }
  ], { height: 1100 });
});

test("owner and admin only: a closer is sent to their own home", async ({ page }) => {
  await open(page, handlers(), CLOSER);
  await expect(page).not.toHaveURL(/marketing-command-center/, { timeout: 8000 });
});

test("the Command Center row is first in the Marketing group of the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page, handlers({ offerGet: () => [{ ok: true, ready: true, job: null, offer: null }, 200] }));
  const rows = page.locator('[data-fh-section="marketing"] .navitem');
  await expect(rows.first()).toHaveAttribute("href", "marketing-command-center.html");
  await expect(rows.first()).toHaveText(/Command Center/);
});

/* ── the frame (U34): the tab strip, the gear, the address ────────────────── */

/* Settings answers for the frame tests, from the U01 contract's own examples
   (src/marketing/api-contract.mjs). marketing-cc-settings.spec.mjs covers the
   Settings tab itself. */
function withSettings(h) {
  return {
    ...h,
    "/api/marketing/settings": async (route) => json(route, exampleResponse("GET marketing/settings")),
    "/api/marketing/funnels": async (route) => json(route, exampleResponse("GET marketing/funnels")),
    "/api/marketing/health": async (route) => json(route, exampleResponse("GET marketing/health"))
  };
}

test("the frame: the strip shows only tabs that exist (Today); Settings sits behind the gear, top-right", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = await open(page, withSettings(handlers()));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await assertPageAlive(page, errors);
  // One tab on the strip: Today, marked as the one shown, in words and a line.
  await expect(page.locator("#mccTabs .tab")).toHaveCount(1);
  await expect(page.locator("#mccTabs .tab")).toHaveText("Today");
  await expect(page.locator("#mccTabs .tab")).toHaveAttribute("aria-current", "page");
  const line = await page.locator("#mccTabs .tab.on").evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(line).toBe("2px");
  // No tab without a module: nothing else is on the strip, and nothing says "soon".
  await expect(page.locator("#mccTabs")).not.toContainText(/Ideas|Scripts|Shoot|Videos|Launch|Numbers|soon/i);
  // The gear: top-right, with its word.
  const gear = page.locator("#mccGear .gear");
  await expect(gear).toHaveText(/Settings/);
  const g = await gear.boundingBox();
  const s = await page.locator("#mccTabs").boundingBox();
  expect(g.x).toBeGreaterThan(s.x + s.width - 1);
  expect(g.height).toBeGreaterThanOrEqual(44);
  expect((await page.locator("#mccTabs .tab").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await expect(page).toHaveURL(/#today$/);
  await expect(page).toHaveTitle(/Command Center · Today$/);
  await shot(page, "24-frame-strip-1280.png", "The frame: Today on the strip, Settings behind the gear", [
    { selector: "#mccTabs .tab.on", caption: "Today: the only tab with a back end yet" },
    { selector: "#mccGear .gear", caption: "Settings behind the gear, top-right" }
  ]);
});

test("the frame: the gear opens Settings, Today comes back as it was, and Back works", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const counter = { today: 0 };
  await open(page, withSettings(handlers({ counter })));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await expect(page.locator("#mccStamp")).toBeVisible();

  await page.locator("#mccGear .gear").click();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("#tab-settings")).toBeVisible();
  await expect(page.locator("#tab-today")).toBeHidden();
  await expect(page.locator("#mccGear .gear")).toHaveAttribute("aria-current", "page");
  await expect(page.locator("#mccTabs .tab")).not.toHaveAttribute("aria-current", "page");
  // Today's "Loaded" clock belongs to Today; it hides on Settings.
  await expect(page.locator("#mccStamp")).toBeHidden();
  await expect(page.locator("#setSwitch")).toContainText("Write scripts every week");
  // Exactly one filled button on the Settings view too: Save.
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Save");

  await page.locator("#mccTabs .tab", { hasText: "Today" }).click();
  await expect(page).toHaveURL(/#today$/);
  await expect(page.locator("#tab-today")).toBeVisible();
  await expect(page.locator("#tab-settings")).toBeHidden();
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await expect(page.locator("#mccStamp")).toHaveText("Loaded 12:00 PM");
  expect(counter.today, "switching tabs does not read Today again").toBe(1);
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  await expect(page.locator(".btn.primary:visible")).toHaveText("Write ad copy");

  await page.goBack();
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("#tab-settings")).toBeVisible();
});

test("the frame: a link to a tab with no module (#ideas) lands on Today and the address says so", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const errors = trackErrors(page);
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, withSettings(handlers()));
  await page.goto(PAGE + "#ideas");
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  await expect(page).toHaveURL(/#today$/);
  await expect(page.locator("#mccTabs .tab")).toHaveCount(1);
  await assertPageAlive(page, errors);
});

test("the frame: a buzz link straight to #settings opens Settings, and the last tab is remembered", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const counter = { today: 0 };
  const errors = trackErrors(page);
  await page.clock.install({ time: new Date(NOW) });
  await withSession(page, OWNER);
  await wireApi(page, OWNER, withSettings(handlers({ counter })));
  await page.goto(PAGE + "#settings");
  await expect(page.locator("#setSwitch")).toBeVisible();
  await expect(page.locator("#tab-today")).toHaveCount(0);
  expect(counter.today, "Today is drawn only when it is opened").toBe(0);
  // Open the page again with no tab in the link: the last tab comes back.
  await page.goto(PAGE);
  await expect(page).toHaveURL(/#settings$/);
  await expect(page.locator("#setSwitch")).toBeVisible();
  await assertPageAlive(page, errors);
});

test("the frame at 390: the gear on its own row, top-right; the strip under it; no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, withSettings(handlers()));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,234.56");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
  const g = await page.locator("#mccGear .gear").boundingBox();
  const s = await page.locator("#mccTabs").boundingBox();
  expect(g.y + g.height).toBeLessThanOrEqual(s.y + 1);
  expect(g.x + g.width).toBeGreaterThan(390 - 16 - 4);
  expect(await innerScrollBoxes(page)).toEqual([]);
  await shot(page, "25-frame-strip-390.png", "The frame at 390", [
    { selector: "#mccGear .gear", caption: "Settings, top-right, 44px tall" },
    { selector: "#mccTabs .tab.on", caption: "Today, the tab shown" }
  ]);
});
