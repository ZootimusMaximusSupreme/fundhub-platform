// Finish-853 batch 15 practice tests: Command Center controls no earlier spec pressed.
//
// A practice test is a real page in Chromium with fake /api answers. It presses the control and
// judges the exact request the page sends and the words the page paints. It reads no live data.
//
//   Scripts tab   the five filter chips and their counts; the Previous and Next buttons never save;
//                 the 409 banner's "Use theirs" and "Read the new version"; Try again on the Rules
//                 fold and the Every version fold (with the page's restart of a failed read muted,
//                 see the long note above those tests and finding 1 in the manifest)
//   Ideas tab     the "Go to step N" button after a spend read; "Hide the pages" and the three page
//                 preview buttons
//   Launch tab    "Open Settings" on an ad with no ad set; the 20 second load-state poll
//   Numbers tab   the ad drawer's Day select (two days, two curves); Open Settings on an empty
//                 funnel list
//
// Each test was broken on purpose in the page and went red (see ops/workflows/finish-853-2026-10-14/
// manifest-b15.md).

import { test, expect } from "@playwright/test";
import { exampleResponse } from "../src/marketing/api-contract.mjs";
import { openTabHarness } from "./helpers/cc-tab-harness.mjs";
import { mountIdeas, funnelDetail } from "./helpers/cc-tab-ideas-host.mjs";
import { STUB_PATH, stubHtml } from "./helpers/cc-launch-stub.mjs";
import { routeStub, STUB_PATH as NUMBERS_STUB_PATH } from "./helpers/cc-numbers-stub.mjs";

test.use({ timezoneId: "America/Phoenix", locale: "en-US", viewport: { width: 390, height: 844 } });

const NOW = "2026-10-12T16:00:00Z";
const R91 = "00000000-0000-4000-8000-000000000901";
const R92 = "00000000-0000-4000-8000-000000000902";
const RREJ = "00000000-0000-4000-8000-000000000903";
const RFILM = "00000000-0000-4000-8000-000000000904";

/* ── Scripts tab: the same fixtures the Scripts spec uses, kept small ─────────────────────── */

function drafts() {
  const [a, b] = exampleResponse("GET marketing/scripts").scripts;
  return [a, b];
}
function withStatus(n, root, status, extra = {}) {
  const s = exampleResponse("GET marketing/scripts").scripts[0];
  return { ...s, id: root, root_script_id: root, status, ad_id: String(n), title: `Script for Ad ${n}`, ...extra };
}

function scriptsApi(over = {}) {
  const db = {
    scripts: [
      ...drafts(),
      withStatus(91, R91, "locked", { locked_at: "2026-10-12T15:00:00.000Z" }),
      withStatus(92, R92, "locked", { locked_at: "2026-10-12T15:01:00.000Z" }),
      withStatus(95, RFILM, "filmed", { filmed_at: "2026-10-12T15:02:00.000Z" }),
      withStatus(84, RREJ, "rejected", { title: "Too close to Ad 84", rejected_reason: "Too close to Ad 84.", rejected_at: "2026-10-12T15:10:00.000Z" })
    ],
    batches: exampleResponse("GET marketing/batches"),
    ideas: exampleResponse("GET marketing/ideas").ideas,
    rules: exampleResponse("GET marketing/rules")
  };
  const routes = {
    "GET marketing/scripts": () => [200, { scripts: db.scripts, as_of: NOW }],
    "GET marketing/script": ({ query }) => {
      const ex = exampleResponse("GET marketing/script");
      return [200, { ...ex, script: { ...ex.script, id: query.id } }];
    },
    "GET marketing/batches": () => [200, db.batches],
    "GET marketing/settings": () => [200, exampleResponse("GET marketing/settings")],
    "GET marketing/funnels": () => [200, exampleResponse("GET marketing/funnels")],
    "GET marketing/ideas": () => [200, { ideas: db.ideas }],
    "GET marketing/rules": () => [200, db.rules],
    ...over
  };
  return { db, routes };
}

async function wire(page, { routes }) {
  const calls = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    const query = Object.fromEntries(url.searchParams);
    let body = null;
    try { body = req.postDataJSON(); } catch { body = null; }
    const key = `${req.method()} ${p}`;
    calls.push({ key, body, query });
    const fn = routes[key];
    if (!fn) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found", message: "Not mocked here." }) });
    const [status, json] = await fn({ body, query, calls });
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(json) });
  });
  return calls;
}

async function openScripts(page, api = scriptsApi()) {
  await page.clock.install({ time: new Date(NOW) });
  const calls = await wire(page, api);
  await openTabHarness(page, { tab: "scripts", param: "", flavor: "u34" });
  return calls;
}

const card = (page) => page.locator("article.ccs-card");
const posts = (calls) => calls.filter((c) => c.key.startsWith("POST"));

test("Scripts: the five filter chips carry their counts, and each one shows only its own scripts", async ({ page }) => {
  const calls = await openScripts(page);
  const chip = (name) => page.locator(".ccs-filters .ccs-filter", { hasText: name });
  await expect(chip("Drafts")).toHaveText("Drafts 2");
  await expect(chip("Approved")).toHaveText("Approved 2");
  await expect(chip("Filmed")).toHaveText("Filmed 1");
  await expect(chip("Rejected")).toHaveText("Rejected 1");
  await expect(chip("All")).toHaveText("All 6");
  await expect(chip("Drafts")).toHaveAttribute("aria-pressed", "true");
  await expect(card(page)).toContainText("Draft 1 of 2");

  await chip("Approved").click();
  await expect(chip("Approved")).toHaveAttribute("aria-pressed", "true");
  await expect(chip("Drafts")).toHaveAttribute("aria-pressed", "false");
  const main = page.locator("[data-tab=scripts], .ccs").first();
  await expect(main).toContainText("Script for Ad 91");
  await expect(main).toContainText("Script for Ad 92");
  await expect(main).not.toContainText("Script for Ad 95");
  await expect(main).not.toContainText("Too close to Ad 84");

  await chip("Filmed").click();
  await expect(chip("Filmed")).toHaveAttribute("aria-pressed", "true");
  await expect(main).toContainText("Script for Ad 95");
  await expect(main).not.toContainText("Script for Ad 91");

  await chip("Rejected").click();
  await expect(chip("Rejected")).toHaveAttribute("aria-pressed", "true");
  await expect(main).toContainText("Too close to Ad 84");
  await expect(main).not.toContainText("Script for Ad 95");

  await chip("All").click();
  await expect(chip("All")).toHaveAttribute("aria-pressed", "true");
  for (const t of ["Script for Ad 91", "Script for Ad 92", "Script for Ad 95", "Too close to Ad 84"]) {
    await expect(main).toContainText(t);
  }

  await chip("Drafts").click();
  await expect(card(page)).toContainText("Draft 1 of 2");
  expect(posts(calls), "a chip is a view, it never writes").toEqual([]);
});

test("Scripts: Previous and Next move between the drafts and never save", async ({ page }) => {
  const calls = await openScripts(page);
  await expect(card(page)).toContainText("Draft 1 of 2");
  const first = await card(page).innerText();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(card(page)).toContainText("Draft 2 of 2");
  expect(await card(page).innerText()).not.toBe(first);
  await page.getByRole("button", { name: "Previous" }).click();
  await expect(card(page)).toContainText("Draft 1 of 2");
  expect(await card(page).innerText()).toBe(first);
  expect(posts(calls), "moving between cards never saves").toEqual([]);
});

function staleEditApi() {
  const a = scriptsApi();
  const realLive = { id: "00000000-0000-4000-8000-000000000105", version: 2, body: "Someone else's words." };
  a.routes["POST marketing/scripts/edit"] = ({ body }) => {
    const s = a.db.scripts.find((x) => x.id === body.id) || a.db.scripts[0];
    const live = { ...s, ...realLive };
    a.db.scripts = a.db.scripts.map((x) => (x.root_script_id === s.root_script_id ? live : x));
    return [409, { error: "stale", message: "This script changed.", current: { version: 2, body: live.body, parts: live.parts } }];
  };
  return a;
}

test("Scripts: after a stale Edit, Use theirs drops my words, reads the live version, and saves nothing more", async ({ page }) => {
  const calls = await openScripts(page, staleEditApi());
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Hook (first line)").fill("Tap below and see your number today.");
  await page.getByRole("button", { name: "Save new version" }).click();

  const conflict = page.locator(".ccs-conflict");
  await expect(conflict).toContainText("This script changed since you opened it.");
  await expect(conflict).toContainText("Tap below and see your number today.");
  await expect(conflict).toContainText("Someone else's words.");
  const readsBefore = calls.filter((c) => c.key === "GET marketing/scripts").length;
  const editsBefore = calls.filter((c) => c.key === "POST marketing/scripts/edit").length;
  expect(editsBefore).toBe(1);

  await conflict.getByRole("button", { name: "Use theirs" }).click();
  await expect(page.locator(".ccs-conflict")).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.key === "GET marketing/scripts").length).toBeGreaterThan(readsBefore);
  // The card is the live version 2 now; my typed words are gone.
  await expect(card(page)).toHaveAttribute("aria-label", /version 2/);
  await expect(card(page)).not.toContainText("Tap below and see your number today.");
  expect(calls.filter((c) => c.key === "POST marketing/scripts/edit"), "Use theirs sends nothing").toHaveLength(editsBefore);
  expect(posts(calls)).toHaveLength(1);
});

test("Scripts: after a stale Approve, Read the new version closes the banner, reads again, and approves nothing more", async ({ page }) => {
  const a = scriptsApi();
  a.routes["POST marketing/scripts/approve"] = ({ body }) => {
    const s = a.db.scripts.find((x) => x.id === body.id) || a.db.scripts[0];
    const live = { ...s, version: 3, body: "A newer version." };
    a.db.scripts = a.db.scripts.map((x) => (x.root_script_id === s.root_script_id ? live : x));
    return [409, { error: "stale", message: "This script changed.", current: { version: 3, body: live.body, parts: live.parts } }];
  };
  const calls = await openScripts(page, a);
  await page.getByRole("button", { name: "Approve", exact: true }).first().click();
  const conflict = page.locator(".ccs-conflict");
  await expect(conflict).toContainText("This script changed since you opened it.");
  await expect(conflict.getByRole("button", { name: "Use mine" })).toHaveCount(0);
  await expect(conflict).toContainText("A newer version.");
  const readsBefore = calls.filter((c) => c.key === "GET marketing/scripts").length;
  await conflict.getByRole("button", { name: "Read the new version" }).click();
  await expect(page.locator(".ccs-conflict")).toHaveCount(0);
  await expect.poll(() => calls.filter((c) => c.key === "GET marketing/scripts").length).toBeGreaterThan(readsBefore);
  // The card now holds the version that was saved, not the one that was on screen.
  await expect(card(page)).toHaveAttribute("aria-label", /version 3/);
  expect(calls.filter((c) => c.key === "POST marketing/scripts/approve")).toHaveLength(1);
});

/* ── Scripts tab: Try again on the Rules fold and the Every version fold ──────────────────────
   The scripts list, the ideas list and the batch history are covered in marketing-cc-scripts.spec.mjs.

   The shipped page has a fault in these two folds (finding 1 in manifest-b15.md): when their read
   fails, onToggle starts the same read again on every repaint, so the failed read repeats without
   end and the Try again button is repainted faster than a person can press it. That restart and the
   button both call the same load function, so on the shipped page a test cannot tell the button
   from the restart.

   So the two button tests below mute exactly that restart and nothing else: a toggle that fires on
   a fold which is already showing its failed-read box is dropped before the page sees it (the
   toggle from opening the fold, and every toggle on a fold that is not failing, go through
   untouched). With that one trigger muted the press is the only thing that can read again. Each
   test also checks that nothing reads again by itself while the box is on screen, so a restart
   from some other place would turn it red. The third test measures the fault itself, on the
   shipped page with nothing muted, and is marked expected-to-fail: it goes red the day the page is
   fixed, and the marker, with the two mutes, can come off then. */

/** Drop the toggle that a repaint of an already failed fold fires (the page's restart trigger). */
async function muteRepaintRestarts(page) {
  await page.addInitScript(() => {
    window.addEventListener("toggle", (ev) => {
      const d = ev.target;
      if (d && d.tagName === "DETAILS" && d.querySelector(".ccs-err")) ev.stopImmediatePropagation();
    }, true);
  });
}

/** The scripts API with nothing writing, so the 5 second poll has nothing to read: only a press can read a part again. */
function quietScriptsApi() {
  const a = scriptsApi();
  a.db.batches = { ...a.db.batches, batches: a.db.batches.batches.map((b) => ({ ...b, status: "released" })) };
  return a;
}

/** A route that fails until `heal()` is called, counting every read of it. */
function failingRoute(a, key) {
  const real = a.routes[key];
  const state = { reads: 0, failing: true, heal() { state.failing = false; } };
  a.routes[key] = (request) => {
    state.reads += 1;
    return state.failing ? [500, { error: "internal_error" }] : real(request);
  };
  return state;
}

test("Scripts: Try again on a failed Rules fold reads the rules once more and paints them (the page's restart on repaint muted)", async ({ page }) => {
  await muteRepaintRestarts(page);
  const a = quietScriptsApi();
  const rules = failingRoute(a, "GET marketing/rules");
  await openScripts(page, a);
  expect(rules.reads, "the rules are not read until the fold is opened").toBe(0);

  await page.getByText("Rules", { exact: true }).click();
  const box = page.locator("[data-fold=rules] .ccs-err");
  await expect(box).toContainText("The rules did not load. Something broke on our side. Nothing changed. Try again.");
  await expect(page.locator("[data-fold=rules] .ccs-banned")).toHaveCount(0);
  const afterFirst = rules.reads;
  expect(afterFirst, "opening the fold reads the rules once").toBe(1);
  await page.waitForTimeout(700);
  expect(rules.reads, "nothing reads the rules again by itself while the failure is on screen").toBe(afterFirst);

  rules.heal();
  await box.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator("[data-fold=rules] .ccs-banned")).toContainText("game changer");
  await expect(page.locator("[data-fold=rules] .ccs-err")).toHaveCount(0);
  expect(rules.reads, "Try again reads the rules once more").toBe(afterFirst + 1);
});

test("Scripts: Try again on a failed Every version fold reads the versions once more and paints them (the page's restart on repaint muted)", async ({ page }) => {
  await muteRepaintRestarts(page);
  const a = quietScriptsApi();
  const versions = failingRoute(a, "GET marketing/script");
  await openScripts(page, a);
  expect(versions.reads, "the versions are not read until the fold is opened").toBe(0);

  await page.getByText("Every version and its checks").click();
  const box = page.locator("[data-load=versions] .ccs-err");
  await expect(box).toContainText("Something broke on our side. Nothing changed. Try again.");
  await expect(page.locator(".ccs-version")).toHaveCount(0);
  const afterFirst = versions.reads;
  expect(afterFirst, "opening the fold reads the versions once").toBe(1);
  await page.waitForTimeout(700);
  expect(versions.reads, "nothing reads the versions again by itself while the failure is on screen").toBe(afterFirst);

  versions.heal();
  await box.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(".ccs-version")).toHaveCount(2);
  await expect(page.locator(".ccs-version").first()).toContainText("Version 2 · draft · written by the machine");
  await expect(page.locator("[data-load=versions] .ccs-err")).toHaveCount(0);
  expect(versions.reads, "Try again reads the versions once more").toBe(afterFirst + 1);
});

test("FINDING: a failed Rules read waits for Try again and is not started again on every repaint", async ({ page }) => {
  // Expected to fail on the shipped page: with the Rules read answering 500, the fold asks again
  // after every repaint (dozens of reads a second). The moment the page leaves a failed read alone
  // this test passes, Playwright reports "expected to fail, but passed", and the marker comes off.
  test.fail();
  const a = quietScriptsApi();
  const rules = failingRoute(a, "GET marketing/rules");
  await openScripts(page, a);
  await page.getByText("Rules", { exact: true }).click();
  await expect(page.locator("[data-fold=rules] .ccs-err, [data-fold=rules] .ccs-skels").first()).toBeVisible();
  await page.waitForTimeout(1500);
  expect(rules.reads, "a failed read is read once, then left alone until Try again").toBeLessThanOrEqual(1);
});

/* ── Ideas tab: Go to step N ──────────────────────────────────────────────────────────────── */

test("Ideas: after a spend read, Go to step N jumps to that step's own run button and sends nothing", async ({ page }) => {
  const { posts: sent } = await mountIdeas(page, {
    "POST marketing/flywheel/spend-read": {
      ok: true,
      rows: [{ ad_number: "84", spend_cents: 49801, taps: 120, cpl_cents: null, purchases: 0 }],
      unmatched: [],
      conclusion: { text: "Clicks are fine, cost per lead is high: redo the offer.", points_to_stage: 3 }
    }
  });
  await page.locator("#cci-run-6").click();
  await expect(page.locator("#cci-stage-6")).toContainText("Clicks are fine, cost per lead is high: redo the offer.");
  const jump = page.locator("#cci-stage-6").getByRole("button", { name: "Go to step 3" });
  await expect(jump).toHaveCount(1);
  const before = sent.length;
  await jump.click();
  await expect.poll(() => page.evaluate(() => document.activeElement && document.activeElement.id)).toBe("cci-run-3");
  expect(sent.length, "Go to step is a jump, never a write").toBe(before);
});

test("Ideas: See the pages opens a sandboxed preview, the three page buttons switch it, Hide the pages closes it, and nothing is sent", async ({ page }) => {
  const FUNNEL = "00000000-0000-4000-8000-000000000603";
  const { posts: sent } = await mountIdeas(page, { "GET marketing/funnel": () => funnelDetail({ path: "/blueprint" }) });
  const row = page.locator(`[data-funnel="${FUNNEL}"]`);
  const frameBody = page.frameLocator(`[data-funnel="${FUNNEL}"] iframe.cci-frame`);
  await expect(row.locator("iframe.cci-frame")).toHaveCount(0);

  await row.getByRole("button", { name: "See the pages" }).click();
  await expect(row.locator("iframe.cci-frame")).toHaveCount(1);
  await expect(row.locator("iframe.cci-frame")).toHaveAttribute("sandbox", "");
  await expect(row.getByRole("button", { name: "Hide the pages" })).toHaveCount(1);
  await expect(row.getByRole("button", { name: "See the pages" })).toHaveCount(0);
  await expect(frameBody.getByRole("heading")).toHaveText("Know exactly what stands between you and funding");

  await row.getByRole("tab", { name: "Booking page" }).click();
  await expect(frameBody.getByRole("heading")).toHaveText("Pick the time that works for you");
  await expect(row.getByRole("tab", { name: "Booking page" })).toHaveAttribute("aria-selected", "true");
  await row.getByRole("tab", { name: "Thank-you page" }).click();
  await expect(frameBody.getByRole("heading")).toHaveText("Your call is on the calendar");
  await row.getByRole("tab", { name: "Landing page" }).click();
  await expect(frameBody.getByRole("heading")).toHaveText("Know exactly what stands between you and funding");

  await row.getByRole("button", { name: "Hide the pages" }).click();
  await expect(row.locator("iframe.cci-frame")).toHaveCount(0);
  await expect(row.getByRole("button", { name: "See the pages" })).toHaveCount(1);
  expect(sent, "a preview never writes").toEqual([]);
});

/* ── Numbers tab: the ad drawer's Day select ──────────────────────────────────────────────── */

test("Numbers: the ad drawer's Day select switches the watch curve to the day picked, and sends nothing", async ({ page }) => {
  const ad = exampleResponse("GET marketing/ad");
  const newer = [100, 64, 47, 39, 34, 31, 28, 26, 24, 22, 21, 20, 19, 18, 17, 15, 12, 10, 8, 6, 5, 4];
  const older = [100, 80, 71, 65, 60, 55, 51, 48, 45, 42, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18];
  ad.ad.curve = [{ date: "2026-10-10", video_play_curve: newer }, { date: "2026-10-09", video_play_curve: older }];
  const calls = [];
  await page.clock.setFixedTime(new Date("2026-10-06T15:00:00Z"));
  await routeStub(page);
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api\//, "")}`;
    calls.push(key);
    const map = {
      "GET marketing/ads": exampleResponse("GET marketing/ads"),
      "GET marketing/ad": ad
    };
    if (!map[key]) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map[key]) });
  });
  await page.goto(NUMBERS_STUB_PATH + "#numbers/ads/91");
  const drawer = page.locator("[data-test=drawer]");
  await expect(drawer).toBeVisible();
  const line = drawer.locator("polyline.ccn-line");
  const day = drawer.locator("#ccn-day");
  await expect(day.locator("option")).toHaveCount(2);
  await expect(day).toHaveValue("0");
  await expect(drawer).toContainText("At 2 seconds, 47% of plays were still watching (from the curve).");
  const newerPoints = await line.getAttribute("points");

  await day.selectOption("1");
  await expect(day).toHaveValue("1");
  await expect(drawer).toContainText("At 2 seconds, 71% of plays were still watching (from the curve).");
  expect(await line.getAttribute("points")).not.toBe(newerPoints);

  await day.selectOption("0");
  await expect(drawer).toContainText("At 2 seconds, 47% of plays were still watching (from the curve).");
  expect(await line.getAttribute("points")).toBe(newerPoints);
  expect(calls.filter((c) => c.startsWith("POST")), "picking a day writes nothing").toEqual([]);
});

test("Numbers: with no funnel set up the Funnels view says so and Open Settings goes to Settings > funnels", async ({ page }) => {
  const calls = [];
  await page.clock.setFixedTime(new Date("2026-10-06T15:00:00Z"));
  await routeStub(page);
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const key = `${req.method()} ${url.pathname.replace(/^\/api\//, "")}`;
    calls.push(key);
    const map = {
      "GET marketing/funnels/stats": { rows: [], unmapped_spend_cents: 0, as_of: null },
      "GET marketing/funnels": exampleResponse("GET marketing/funnels")
    };
    if (!map[key]) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map[key]) });
  });
  await page.goto(NUMBERS_STUB_PATH + "#numbers/funnels");
  const empty = page.locator("[data-test=funnels-empty]");
  await expect(empty).toContainText("No funnel is set up yet.");
  expect(await page.evaluate(() => window.__ccGo)).toEqual([]);
  await empty.getByRole("button", { name: "Open Settings" }).click();
  expect(await page.evaluate(() => window.__ccGo)).toEqual([["settings", "funnels"]]);
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
});

test("Numbers: a funnel whose spend, cash and ROAS are not saved prints unknown, never $0 or 0.00x", async ({ page }) => {
  const stats = exampleResponse("GET marketing/funnels/stats");
  stats.rows[0].spend_cents = null;
  stats.rows[0].cash_cents = null;
  stats.rows[0].roas = null;
  await page.clock.setFixedTime(new Date("2026-10-06T15:00:00Z"));
  await routeStub(page);
  await page.route("**/api/**", async (route) => {
    const key = `${route.request().method()} ${new URL(route.request().url()).pathname.replace(/^\/api\//, "")}`;
    const map = { "GET marketing/funnels/stats": stats, "GET marketing/funnels": exampleResponse("GET marketing/funnels") };
    if (!map[key]) return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(map[key]) });
  });
  await page.goto(NUMBERS_STUB_PATH + "#numbers/funnels");
  const unknown = page.locator(`[data-test=funnel][data-funnel=${stats.rows[0].funnel_key}]`);
  await expect(unknown).toContainText("Spend unknown · Cash unknown · Cash per $1 (ROAS) unknown");
  await expect(unknown).not.toContainText("$0");
  await expect(unknown).not.toContainText("0.00x");
  const other = page.locator(`[data-test=funnel][data-funnel=${stats.rows[1].funnel_key}]`);
  await expect(other).not.toContainText("unknown ·");
});

/* ── Launch tab: Open Settings and the 20 second poll ─────────────────────────────────────── */

const VIDEO_A = "00000000-0000-4000-8000-000000000701";
const VIDEO_B = "00000000-0000-4000-8000-000000000702";
const APPROVED = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: VIDEO_A, ad_id: "90", take_no: 1, video_kind: "ad", status: "approved", approved_at: "2026-10-13T20:01:00.000Z" },
    { id: VIDEO_B, ad_id: "91", take_no: 1, video_kind: "ad", status: "approved", approved_at: "2026-10-13T20:02:00.000Z" }
  ]
};

async function openLaunch(page, loads, { approved = APPROVED } = {}) {
  const sent = [];
  await page.clock.install({ time: new Date(NOW) });
  await page.route(`**${STUB_PATH}`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: stubHtml("launch") }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const p = url.pathname.replace(/^\/api\//, "");
    sent.push({ method: req.method(), path: p, query: url.search });
    const reply = (code, data) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(data) });
    if (req.method() === "GET" && p === "marketing/meta/load-status") return reply(200, { loads: typeof loads === "function" ? loads() : loads, as_of: "2026-10-12T15:00:00.000Z" });
    if (req.method() === "GET" && p === "ad-videos") return reply(200, approved);
    return reply(404, { error: "not_found" });
  });
  await page.goto(STUB_PATH);
  return { sent };
}

const reads = (sent, path) => sent.filter((s) => s.method === "GET" && s.path === path).length;

test("Launch: Open Settings on an ad with no ad set goes to Settings and sends nothing", async ({ page }) => {
  const { sent } = await openLaunch(page, [
    { ad_number: "90", ad_video_id: VIDEO_A, state: "refused", reasons: ["The funnel has no ad set."], ad_set: null, campaign: null, ad_row_id: null, ad_status: null }
  ]);
  const tab = page.locator("[data-tab=launch]");
  await expect(tab).toContainText("This ad's funnel has no ad set picked yet. Pick one in Settings.");
  const open = tab.getByRole("button", { name: "Open Settings" });
  await expect(open).toHaveCount(1);
  expect(await page.evaluate(() => window.__stub.gone)).toEqual([]);
  await open.click();
  expect(await page.evaluate(() => window.__stub.gone)).toEqual(["settings"]);
  expect(sent.filter((s) => s.method !== "GET")).toEqual([]);
});

test("Launch: while an ad is loading the state is read again every 20 seconds, with the approved list", async ({ page }) => {
  const { sent } = await openLaunch(page, [
    { ad_number: "90", ad_video_id: VIDEO_A, state: "loading", reasons: [], step: "uploading", ad_set: null, campaign: null }
  ]);
  const tab = page.locator("[data-tab=launch]");
  await expect(tab).toContainText("Ad 90");
  expect(reads(sent, "marketing/meta/load-status")).toBe(1);
  expect(reads(sent, "ad-videos")).toBe(1);

  await page.clock.runFor(19_000);
  expect(reads(sent, "marketing/meta/load-status"), "not before 20 seconds").toBe(1);

  await page.clock.runFor(1_000);
  await expect.poll(() => reads(sent, "marketing/meta/load-status")).toBe(2);
  expect(reads(sent, "ad-videos"), "the approved list is read with it").toBe(2);

  await page.clock.runFor(20_000);
  await expect.poll(() => reads(sent, "marketing/meta/load-status")).toBe(3);
  expect(sent.filter((s) => s.method !== "GET")).toEqual([]);
});

test("Launch: when nothing is loading the state is not polled at all", async ({ page }) => {
  const { sent } = await openLaunch(page, [
    {
      ad_number: "90", ad_video_id: VIDEO_A, state: "loaded", reasons: [], meta_video_id: "1", meta_creative_id: "2",
      meta_ad_external_id: "3", ad_row_id: "00000000-0000-4000-8000-000000000801", ad_status: "PAUSED",
      ad_set: { external_id: "120210000000000101", status: "ACTIVE", daily_budget_cents: 10000 }, campaign: { external_id: "1", status: "ACTIVE" }
    }
  ], { approved: { ...APPROVED, count: 1, items: [APPROVED.items[0]] } });
  await expect(page.locator("[data-tab=launch]")).toContainText("Ad 90");
  expect(reads(sent, "marketing/meta/load-status")).toBe(1);
  await page.clock.runFor(120_000);
  await page.waitForTimeout(600);
  expect(reads(sent, "marketing/meta/load-status"), "no timer runs while nothing is in flight").toBe(1);
  expect(reads(sent, "ad-videos")).toBe(1);
});
