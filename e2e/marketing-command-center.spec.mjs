// The Marketing Command Center in a real browser, offline.
//
// e2e/static-server.mjs serves public/ and page.route() answers /api/** the
// way the back ends answer: GET marketing/today as M10's api/marketing/today.mjs
// builds it, GET/POST marketing/offer/generate as M12's handler does, and the
// existing creative/generate + creative/run. No staff login on the live site,
// no database, nothing sent anywhere.
//
// It proves the four states (loading, empty, error, full), the one button
// (Write ad copy) end to end, the Offer card following a run to the end, the
// owner-only gate, and one column with no sideways scroll at 390px.
//
// EVIDENCE. Each scenario that matters to Chris screenshots the viewport and
// records the live bounding box of the element under discussion into
// shot-marks.json. A copy of ops/workflows/w4b-proof-2026-09-03/_apply-marks.py
// burns those into numbered red boxes with a legend (CLAUDE.md §8); evidence
// folders are gitignored, so that copy lives beside the shots in
// ops/workflows/perfect-machine-2026-10-05-evidence/m11/. Output goes to
// M11_PROOF_OUT, or the system temp directory — never into a tracked path.

import { test, expect } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OWNER, CLOSER, json, wireApi, withSession, trackErrors, assertPageAlive } from "./harness.mjs";

const OUT = process.env.M11_PROOF_OUT
  ? path.resolve(process.env.M11_PROOF_OUT)
  : path.join(os.tmpdir(), "m11-marketing-command-center");
const RAW = path.join(OUT, "shots", "_raw");
const MANIFEST = path.join(OUT, "shots", "shot-marks.json");
fs.mkdirSync(RAW, { recursive: true });

const PAGE = "/app/marketing-command-center.html";
const NOW = "2026-10-05T19:00:00Z";
const HOUSE = "11111111-2222-4333-8444-555555555555";

test.use({ timezoneId: "America/Phoenix", locale: "en-US" });

const STAGES = [
  { n: 1, key: "avatar", label: "avatar", state: "READY", approved: true, status: "ready approved", why: "133 quotes", reasons: [] },
  { n: 2, key: "ad-research", label: "ad research", state: "READY", approved: false, status: "ready not reviewed", why: "8 ads", reasons: [] },
  { n: 3, key: "offer", label: "offer", state: "FAILED", approved: false, status: "FAILED", why: "did not report guarantees", reasons: ["did not report guarantees"] },
  { n: 4, key: "copy", label: "copy", state: "FAILED", approved: false, status: "FAILED", why: "did not report distinctReasons", reasons: ["did not report distinctReasons"] },
  { n: 5, key: "ad-strategy", label: "ad strategy", state: "BLOCKED", approved: false, status: "BLOCKED", why: "waiting on offer and copy", reasons: ["waiting on offer and copy"] },
  { n: 6, key: "spend", label: "spend", state: "MISSING", approved: false, status: "MISSING", why: "has not been run yet", reasons: ["has not been run yet"] }
];

const ok = (key) => ({ key, ok: true, label: key, missing: null });

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
          created_at: "2026-10-04T18:00:00Z" }
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
      windows: {
        today: { from: "2026-10-05", to: "2026-10-05", days: 1, spend_cents: 0, ad_days: 7, days_with_data: 1 },
        last_7_days: { from: "2026-09-29", to: "2026-10-05", days: 7, spend_cents: 123456, ad_days: 40, days_with_data: 7 },
        prior_7_days: { from: "2026-09-22", to: "2026-09-28", days: 7, spend_cents: 100000, ad_days: 40, days_with_data: 7 },
        last_30_days: { from: "2026-09-06", to: "2026-10-05", days: 30, spend_cents: 500000, ad_days: 46, days_with_data: 12 }
      }
    },
    last_sync: { meta_synced_at: "2026-10-05T07:01:00Z", metrics_synced_at: "2026-10-05T07:01:30Z", latest_metrics_date: "2026-10-04" },
    ...over
  };
}

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

/* api — today + offer + copy answers. `t` and `offer` can be swapped per test. */
function handlers({ t = today(), todayStatus = 200, offerGet, offerPost, generate, run, delayToday = 0 } = {}) {
  return {
    "/api/marketing/today": async (route) => {
      if (delayToday) await new Promise((r) => setTimeout(r, delayToday));
      await json(route, t, todayStatus);
    },
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
    await page.locator(anchor).first().evaluate((el) => { el.scrollIntoView({ block: "start" }); window.scrollBy(0, -64); });
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

/* ── the states ───────────────────────────────────────────────────────────── */

test("loading: skeletons in the real layout, the button waits", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, handlers({ delayToday: 2500 }), OWNER, { clock: false });
  await expect(page.locator("#tileSpend7 .skel").first()).toBeVisible();
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await shot(page, "00-loading.png", "Loading: real layout, no spinner", [
    { selector: "#tileSpend7", caption: "Spend tile holds its place" },
    { selector: "#copySetup", caption: "Button waits while it checks" }
  ]);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,235", { timeout: 6000 });
});

test("full: spend top-left with a comparison, one primary button, every card filled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page, handlers({
    offerGet: () => [{ ok: true, ready: true, job: { id: "o1", status: "done" }, offer: OFFER_VIEW }, 200]
  }));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,235");
  await assertPageAlive(page, errors);

  await expect(page.locator("#tileSpend7 .cmp")).toHaveText("Up 23% from $1,000 the 7 days before.");
  await expect(page.locator("#tileSpend7 .note")).toContainText("Meta numbers as of 11 hours ago");
  await expect(page.locator("#tileSpend30 .vl")).toHaveText("$5,000");
  await expect(page.locator("#tileSpend30 .cmp")).toContainText("Numbers saved for 12 of 30 days.");
  await expect(page.locator("#tileSpend30 .note")).toHaveText("Today so far: $0.");
  await expect(page.locator("#tileParts .vl")).toHaveText("6 of 6");
  await expect(page.locator("#copySetup")).toHaveText("Ready. It writes one ad and checks it against the ad rules.");
  await expect(page.locator("#copyBtn")).toBeEnabled();
  await expect(page.locator("#waitingList li")).toHaveCount(3);
  await expect(page.locator("#waitingList")).toContainText("Redo the offer step");
  await expect(page.locator("#flywheelList li")).toHaveCount(5);
  await expect(page.locator('#flywheelList [data-stage="copy"]')).toContainText("Did not report distinct reasons.");
  await expect(page.locator("#offerLatest")).toContainText("Funding Roadmap");
  await expect(page.locator("#latestList")).toContainText("Funding ads may not promise approval.");
  await expect(page.locator("#latestList")).toContainText("No copy writer is switched on for this account.");

  // UI-STANDARDS §1: exactly one filled button on the screen.
  await expect(page.locator(".btn.primary:visible")).toHaveCount(1);
  // §1 fold: the one job is doable without scrolling on a 900px-tall window.
  const btn = await page.locator("#copyBtn").boundingBox();
  expect(btn.y + btn.height).toBeLessThanOrEqual(900);
  // §1 top-left: the spend tile is the first thing in the content column.
  const spend = await page.locator("#tileSpend7").boundingBox();
  const parts = await page.locator("#tileParts").boundingBox();
  expect(spend.x).toBeLessThan(parts.x);

  // §12.7 — assert the COMPUTED sizes, not the classes.
  const size = (sel) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).fontSize);
  expect(await size("#tileSpend7 .vl")).toBe("32px");
  expect(await size("#cardCopy h2")).toBe("20px");
  expect(await size("#tileSpend7 .caption")).toBe("13px");
  expect(await size("#copyAngle")).toBe("16px");
  // §12.2 — the card wears the brand's resting shadow, written nowhere on this screen.
  const shadow = await page.locator("#cardCopy").evaluate((el) => getComputedStyle(el).boxShadow);
  expect(shadow).toContain("rgba(10, 10, 10, 0.06)");

  await shot(page, "01-today-desktop.png", "Today, owner, 1440x900", [
    { selector: "#tileSpend7", caption: "Top-left: spend 7 days vs the 7 before" },
    { selector: "#tileParts", caption: "Machine parts ready: 6 of 6" },
    { selector: "#copyBtn", caption: "The one filled button: Write ad copy" },
    { selector: "#cardWaiting", caption: "Waiting on you: read off the flywheel" }
  ]);

  await shot(page, "02-flywheel-offer-latest.png", "Offer and Flywheel", [
    { selector: '#flywheelList [data-stage="offer"]', caption: "Step 3: Needs a redo, and why" },
    { selector: "#offerLatest .offer-body", caption: "Latest offer from the offer writer" },
    { selector: "#offerBtn", caption: "Write offer (outline, not a second primary)" }
  ], { height: 1300, anchor: "#cardOffer" });
});

test("Write ad copy: generate, then run, then the words and the rules result", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
  expect(seen[1].body).toMatchObject({ partner_id: HOUSE, max_jobs: 3 });

  await shot(page, "03-write-ad-copy.png", "Write ad copy, pressed", [
    { selector: "#copyAngle", caption: "What the ad is about (typed)" },
    { selector: "#copySay", caption: "Answer in plain words" },
    { selector: "#copyResult .piece", caption: "New ad copy and its rules result" }
  ]);
});

test("Write ad copy: a refusal is a sentence and nothing runs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await expect(page.locator("#offerLatest")).toContainText("Money back if the plan is not clear.");

  await shot(page, "04-write-offer.png", "Write offer, pressed", [
    { selector: "#offerBtn", caption: "Write offer" },
    { selector: "#offerLatest .offer-body", caption: "The new offer, read back when done" },
    { selector: "#offerSay", caption: "Done. Here is the new offer." }
  ], { height: 1300, anchor: "#cardOffer" });
});

test("not shipped yet: both new endpoints answer 404 and the page says so, inventing nothing", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await open(page, handlers({ t: { ok: false, error: "not_found", path: "marketing/today" }, todayStatus: 404 }));
  await expect(page.locator("#mccBanner")).toHaveText("The marketing numbers are not ready yet. This page fills in after the next update.");
  await assertPageAlive(page, errors);
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("unknown");
  await expect(page.locator("#tileSpend30 .vl")).toHaveText("unknown");
  await expect(page.locator("#tileParts .vl")).toHaveText("unknown");
  await expect(page.locator("#copyBtn")).toBeDisabled();
  await expect(page.locator("#offerLatest")).toHaveText("The offer writer is not ready yet. It turns on with the next update.");
  const text = await page.locator("#mcc-root").innerText();
  expect(text).not.toMatch(/\$0|\$\d/);
  await expect(page.locator("#offerBtn")).toBeDisabled();
  await expect(page.locator("#tileSpend7 .note")).toContainText("No Meta numbers on file yet.");

  await shot(page, "05-not-ready-yet.png", "Before ship: not live yet", [
    { selector: "#mccBanner", caption: "What failed, in plain words" },
    { selector: "#tileSpend7 .vl", caption: "Unknown stays 'unknown', never $0" },
    { selector: "#copySetup", caption: "Write ad copy waits and says why" },
    { selector: "#offerLatest", caption: "Write offer: not ready yet" }
  ], { height: 1300 });
});

test("empty: nothing yet, said plainly", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, handlers({
    t: today({ copy: { partner_id: HOUSE, pieces: [], jobs: [] },
      flywheel: { campaigns: [{ campaign: "partner", stages: [], advice: null }] } }),
    offerGet: () => [{ ok: true, ready: true, job: null, offer: null }, 200]
  }));
  await expect(page.locator("#waitingList")).toHaveText("Nothing is waiting on you right now.");
  await expect(page.locator("#flywheelList")).toHaveText("No flywheel steps are on file yet.");
  await expect(page.locator("#latestList")).toHaveText("No ad copy yet. Press Write ad copy to make the first one.");
  await expect(page.locator("#offerLatest")).toHaveText("No offer has been written here yet.");
  await shot(page, "06-empty.png", "Empty: nothing yet", [
    { selector: "#waitingList", caption: "Nothing waiting" },
    { selector: "#latestList", caption: "No ad copy yet, and how to make one" }
  ], { height: 1300 });
});

test("signed out: a sentence, not a code", async ({ page }) => {
  await open(page, handlers({ t: { ok: false, error: "unauthorized" }, todayStatus: 401 }));
  await expect(page.locator("#mccBanner")).toHaveText("You are signed out. Sign in and open this page again.");
});

test("phone, 390px: one column, no sideways scroll, the button full width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, handlers({
    offerGet: () => [{ ok: true, ready: true, job: null, offer: null }, 200]
  }));
  await expect(page.locator("#tileSpend7 .vl")).toHaveText("$1,235");
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(wide).toBeLessThanOrEqual(390);
  const a = await page.locator("#tileSpend7").boundingBox();
  const b = await page.locator("#tileSpend30").boundingBox();
  expect(b.y).toBeGreaterThanOrEqual(a.y + a.height);
  const btn = await page.locator("#copyBtn").boundingBox();
  expect(btn.height).toBeGreaterThanOrEqual(44);
  const minFont = await page.locator("#mcc-root").evaluate((root) => {
    let min = 99;
    root.querySelectorAll("*").forEach((el) => {
      if (el.offsetParent !== null && el.textContent.trim()) min = Math.min(min, parseFloat(getComputedStyle(el).fontSize));
    });
    return min;
  });
  expect(minFont).toBeGreaterThanOrEqual(11);
  await shot(page, "07-phone-390.png", "Phone 390px", [
    { selector: "#tileSpend7", caption: "One column: spend first" }
  ]);
  await page.locator("#copyBtn").scrollIntoViewIfNeeded();
  await shot(page, "08-phone-390-write.png", "Phone 390px: the button", [
    { selector: "#copyBtn", caption: "Write ad copy, full width" }
  ]);
});

test("owner and admin only: a closer is sent to their own home", async ({ page }) => {
  await open(page, handlers(), CLOSER);
  await expect(page).not.toHaveURL(/marketing-command-center/, { timeout: 8000 });
});

test("the Command Center row is first in the Marketing group of the sidebar", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, handlers({ offerGet: () => [{ ok: true, ready: true, job: null, offer: null }, 200] }));
  const rows = page.locator('[data-fh-section="marketing"] .navitem');
  await expect(rows.first()).toHaveAttribute("href", "marketing-command-center.html");
  await expect(rows.first()).toHaveText(/Command Center/);
});
