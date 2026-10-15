// Practice test (real page, fake /api answers) for ten Campaign Manager controls in batch 10:
// the drawer's metric buttons, the spend rail, the fatigue rail and Window select, the fatigue row's
// Label button, the link box (Close, Creative select, Our ad number), Funnel pages Sync now, and Reload.
// The expected rows and numbers are worked out in this file from the fake data, not copied from the page.
// Every request a control sends is judged by its method and its sign-in header as well as its body: a
// control that sends PUT, or sends no Authorization header, is dead in production (405 or 401) whatever
// words it paints. It reads no live data. Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, json, OWNER, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const PID = "5c1d8e24-3b7a-4c5e-9a10-6f2b3d4e5a77";
const AD_A = "0a1b2c3d-1111-4a1a-8a1a-aaaaaaaaaaaa";
const AD_B = "0a1b2c3d-2222-4b2b-8b2b-bbbbbbbbbbbb";
const ASSET_1 = "c0ffee00-1111-4111-8111-111111111111";
const ASSET_2 = "c0ffee00-2222-4222-8222-222222222222";

const CAMPAIGN = {
  id: "camp-01", name: "Funding spring", platform: "meta", offer_type: "funding", approval_state: "live",
  strategy_key: null, budget_cents: 5000, spend_yesterday_cents: 1000, roas_7d: 1.5, ad_set_count: 1, ad_count: 2,
  has_disclosure_asset: false, status: "ACTIVE", special_ad_category: null, created_at: "2026-10-01T10:00:00Z",
  approved_at: null, synced_at: null, last_error: null,
};

// Daily series for the drawer: every metric has its own peak so a wrong button shows the wrong number.
const SERIES = [
  { date: "2026-10-01T00:00:00Z", spend_cents: 1000, impressions: 400, clicks: 30, conversions: 2, frequency: 1.2, ctr: 1.1, cpa_cents: 900, roas: 2.5 },
  { date: "2026-10-02T00:00:00Z", spend_cents: 2500, impressions: 900, clicks: 75, conversions: 5, frequency: 1.8, ctr: 1.7, cpa_cents: 700, roas: 3.5 },
  { date: "2026-10-03T00:00:00Z", spend_cents: 1800, impressions: 700, clicks: 55, conversions: 4, frequency: 1.5, ctr: 1.4, cpa_cents: 800, roas: 3.0 },
];
const METRICS = [
  ["spend_cents", "spend", "SUM", "bar", 2500],
  ["impressions", "impressions", "SUM", "bar", 900],
  ["clicks", "clicks", "SUM", "bar", 75],
  ["conversions", "conversions", "SUM", "bar", 5],
  ["frequency", "frequency", "AVG", "line", 1.8],
  ["ctr", "ctr", "AVG", "line", 1.7],
  ["cpa_cents", "cpa", "AVG", "line", 900],
  ["roas", "roas", "AVG", "line", 3.5],
];

// Daily limits: four rows. The page puts the scope names in order and then the closest to the limit first.
const CEILINGS = [
  { scope: "campaign", campaign_id: "camp-01", campaign_name: "Funding spring", platform: "meta", daily_limit_cents: 10000, spend_today_cents: 9000, breached_at: null, max_daily_increase_pct: 20 },
  { scope: "campaign", campaign_id: "camp-02", campaign_name: "Cards autumn", platform: "tiktok", daily_limit_cents: 10000, spend_today_cents: 12000, breached_at: "2026-10-12T09:00:00Z", max_daily_increase_pct: 20 },
  { scope: "partner", campaign_id: null, campaign_name: null, platform: null, daily_limit_cents: 50000, spend_today_cents: 5000, breached_at: null, max_daily_increase_pct: 10 },
  { scope: "platform", campaign_id: null, campaign_name: null, platform: "google", daily_limit_cents: 20000, spend_today_cents: 100, breached_at: null, max_daily_increase_pct: 15 },
];

// The limits that tell "breached" apart from "over its limit": the kill switch stamps breached_at, and
// spend can sit over a limit with nothing stamped, or have fallen back under one that was breached. They are
// listed OUT of scope order (platform, partner, then the two campaigns) so the page's own sort shows.
const CEILINGS_TRICKY = [
  { scope: "platform", campaign_id: null, campaign_name: null, platform: "google", daily_limit_cents: 20000, spend_today_cents: 100, breached_at: null, max_daily_increase_pct: 15 },
  { scope: "partner", campaign_id: null, campaign_name: null, platform: null, daily_limit_cents: 50000, spend_today_cents: 49000, breached_at: null, max_daily_increase_pct: 10 },
  // Over its limit, nothing stamped: NOT breached.
  { scope: "campaign", campaign_id: "camp-a", campaign_name: "Alpha over limit", platform: "meta", daily_limit_cents: 10000, spend_today_cents: 12000, breached_at: null, max_daily_increase_pct: 20 },
  // Stamped breached, back under its limit: breached.
  { scope: "campaign", campaign_id: "camp-b", campaign_name: "Beta breached", platform: "meta", daily_limit_cents: 10000, spend_today_cents: 3000, breached_at: "2026-10-12T09:00:00Z", max_daily_increase_pct: 20 },
];
const FAILED_READ = () => ({ status: 500, body: { ok: false, error: "query_failed" } });
const COULD_NOT_REACH = "We could not reach the data. Press Reload to try again.";

// Fatigue: five ads. Recommendation decides the rail. Names are unique so the rows can be told apart.
const FATIGUE_BASE = (id, name, recommendation) => ({
  ad_id: id, ad_name: name, campaign_name: "Funding spring", platform: "meta", spend_cents: 1200, impressions: 3000,
  frequency: 2.4, ctr: 1.2, roas: 1.8, last_date: "2026-10-10", rotated_at: null, hours_until_next_rotation: null, recommendation,
});
const FATIGUE = [
  FATIGUE_BASE(AD_A, "Hook one", "refresh"),
  FATIGUE_BASE(AD_B, "Hook two", "queue"),
  FATIGUE_BASE("0a1b2c3d-3333-4c3c-8c3c-cccccccccccc", "Hook three", "ok"),
  FATIGUE_BASE("0a1b2c3d-4444-4d4d-8d4d-dddddddddddd", "Hook four", "ok"),
  FATIGUE_BASE("0a1b2c3d-5555-4e5e-8e5e-eeeeeeeeeeee", "Hook five", "unconfigured"),
];

const CREATIVES = [
  { id: ASSET_1, kind: "static", format: "1080x1080", created_at: "2026-10-05T10:00:00Z", copy_text: "Funding in seven days" },
  { id: ASSET_2, kind: "video", format: "9x16", created_at: "2026-10-06T10:00:00Z", copy_text: null },
];

const FUNNEL_BEFORE = { ok: true, pages: [{ funnel_name: "Roadmap", page_name: "Sales page", stat_date: "2026-10-01", views: 10, conversions: 1 }],
  connection: { state: "active", last_synced_at: "2026-10-01T10:00:00Z", last_error: null } };
const FUNNEL_AFTER = { ok: true, pages: [{ funnel_name: "Roadmap", page_name: "Sales page", stat_date: "2026-10-14", views: 4321, conversions: 77 }],
  connection: { state: "active", last_synced_at: "2026-10-14T10:00:00Z", last_error: null } };

async function openManager({ session = OWNER, overrides = {}, query = `?partner_id=${PID}` } = {}) {
  const seen = { reads: {}, library: [], link: [], sync: [], urls: [], fatigue: [], requests: { sync: [], link: [], library: [] } };
  const bump = (key) => { seen.reads[key] = (seen.reads[key] || 0) + 1; };
  // What the page sent: the method and the sign-in header, beside the body judged elsewhere.
  const sent = (route, method) => ({ method, authorization: route.request().headers().authorization || null,
    contentType: route.request().headers()["content-type"] || null });
  let funnelAnswer = overrides.funnelPages || FUNNEL_BEFORE;
  const handlers = {
    "/api/campaigns/list": async (route) => { bump("list"); return json(route, { ok: true, count: 1, items: [overrides.campaign || CAMPAIGN] }); },
    "/api/campaigns/spend": async (route) => {
      bump("spend");
      // spendReply(n) answers the n-th read: { status, body }. Without it every read is the good answer.
      // spendHold holds the SECOND read (a Reload) until the test lets it go.
      if (overrides.spendHold && seen.reads.spend === 2) await overrides.spendHold;
      if (overrides.spendReply) {
        const reply = overrides.spendReply(seen.reads.spend);
        return json(route, reply.body, reply.status || 200);
      }
      return json(route, { ok: true, items: overrides.ceilings || CEILINGS });
    },
    "/api/campaigns/fatigue": async (route, { url }) => {
      bump("fatigue");
      seen.fatigue.push(new URL(url).searchParams);
      if (overrides.fatigueReply) {
        const reply = overrides.fatigueReply(seen.reads.fatigue);
        return json(route, reply.body, reply.status || 200);
      }
      return json(route, { ok: true, items: overrides.fatigue || FATIGUE });
    },
    "/api/campaigns/connections": async (route) => { bump("conn"); return json(route, { ok: true, items: [] }); },
    "/api/campaigns/action-log": async (route) => { bump("log"); return json(route, { ok: true, items: [] }); },
    "/api/campaigns/detail": { ok: true, ...(overrides.campaign || CAMPAIGN), targeting: {}, ad_sets: [], metrics_daily: SERIES, recent_actions: [] },
    "/api/campaigns/link-asset": async (route, { method }) => {
      seen.requests.link.push(sent(route, method));
      seen.link.push(bodyOf(route));
      return json(route, overrides.linkAnswer || { ok: true, ad: { asset_id: seen.link.at(-1).asset_id || null, fundhub_ad_number: seen.link.at(-1).fundhub_ad_number || null }, spine: null });
    },
    "/api/creative/library": async (route, { url, method }) => {
      seen.requests.library.push(sent(route, method));
      seen.library.push(new URL(url).searchParams);
      return json(route, overrides.library || { ok: true, items: CREATIVES });
    },
    "/api/read/ad-books": async (route) => { bump("books"); return json(route, { ok: true, total_leads: 0, total_books: 0, unknown_ad_ids: [], groups: [] }); },
    "/api/read/ad-spine": async (route) => { bump("spine"); return json(route, { ok: true, window: { from: "2026-09-01", to: "2026-10-01" }, limit: 200, hasMore: false, people_rows_in_window: 0, items: [] }); },
    "/api/read/funnel-pages": async (route) => { bump("funnel"); return json(route, funnelAnswer); },
    "/api/analytics/clickfunnels-sync": async (route, { method }) => {
      seen.requests.sync.push(sent(route, method));
      seen.sync.push(bodyOf(route));
      if (overrides.syncGate) await overrides.syncGate;
      const answer = overrides.syncAnswer || { ok: true, pages_synced: 1, stats_available: true };
      if (answer.ok) funnelAnswer = overrides.funnelAfter || FUNNEL_AFTER;
      return json(route, answer);
    },
  };
  const { page, errors } = await screens.open(`/app/campaign-manager.html${query}`, {
    session,
    handlers,
  });
  await page.waitForFunction(() => /\d of \d panels loaded/.test(document.querySelector("#footNote").textContent));
  await page.waitForFunction(() => !/Reading…/.test(document.querySelector("#fatFoot").textContent));
  return { page, errors, seen };
}

// The token every session in this harness carries (e2e/harness.mjs withSession), as the page sends it.
const SIGNED_IN = "Bearer e2e-token";
const text = (page, selector) => page.locator(selector).innerText();
const fatigueNames = (page) => page.$$eval("#fatRows tr td:first-child b", (els) => els.map((e) => e.textContent));
// One entry per limit row. A sentence row (a failed read, an empty filter) has one cell and is not a limit.
const spendScopes = (page) => page.$$eval("#spendRows tr", (rows) => rows.filter((r) => r.children.length > 1)
  .map((r) => r.children[0].querySelector("b")?.textContent + "|" + r.children[1].textContent));

test("Drawer metric buttons: each one marks itself on and draws that metric's own series", async () => {
  await proof.check(/^Drawer: metric buttons/, async () => {
    const { page, errors } = await openManager();
    await page.locator("#campRows tr.rowbtn").first().click();
    await page.waitForSelector("#dwMetrics button");
    await page.waitForFunction(() => document.querySelector("#dwChart"));

    // Eight buttons, in the page's order, each carrying its SUM or AVG label.
    const buttons = await page.$$eval("#dwMetrics button", (els) => els.map((e) => [e.dataset.m, e.firstChild.textContent, e.querySelector(".n").textContent]));
    assert.deepEqual(buttons, METRICS.map(([key, label, agg]) => [key, label, agg]));
    // The drawer opens on spend.
    assert.equal(await page.locator("#dwMetrics button.on").getAttribute("data-m"), "spend_cents");

    for (const [key, label, , kind, max] of METRICS) {
      await page.locator(`#dwMetrics button[data-m="${key}"]`).click();
      assert.deepEqual(await page.$$eval("#dwMetrics button.on", (els) => els.map((e) => e.dataset.m)), [key], `${key} is the only one on`);
      const aria = await page.locator("#dwChart svg").getAttribute("aria-label");
      assert.equal(aria, `${label} by day, 3 days, maximum ${max}`, `${key} chart`);
      // Counts are bars, rates are a line.
      assert.equal(await page.locator("#dwChart svg rect").count(), kind === "bar" ? 3 : 0, `${key} bars`);
      assert.equal(await page.locator("#dwChart svg polyline").count(), kind === "line" ? 1 : 0, `${key} line`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Spend rail filter: all, breached and ok each list their own limits, count them, and mark one on", async () => {
  await proof.check(/^Spend rail filter/, async () => {
    const { page, errors } = await openManager();
    const counts = await page.$$eval("#spendRail button", (els) => Object.fromEntries(els.map((e) => [e.dataset.v, e.querySelector(".n")?.textContent])));
    assert.deepEqual(counts, { all: "4", breached: "1", ok: "3" });
    assert.deepEqual(await page.$$eval("#spendRail button.on", (els) => els.map((e) => e.dataset.v)), ["all"]);

    // All: scope name order, then the closest to its limit first inside a scope.
    assert.deepEqual(await spendScopes(page), ["campaign|Cards autumn", "campaign|Funding spring", "partner|—", "platform|—"]);
    assert.equal(await text(page, "#spendFoot"), "4 of 4 daily limits in use · closest to the limit first");

    await page.locator('#spendRail button[data-v="breached"]').click();
    assert.deepEqual(await spendScopes(page), ["campaign|Cards autumn"]);
    assert.equal(await text(page, "#spendFoot"), "1 of 4 daily limits in use · closest to the limit first");
    assert.deepEqual(await page.$$eval("#spendRail button.on", (els) => els.map((e) => e.dataset.v)), ["breached"]);

    await page.locator('#spendRail button[data-v="ok"]').click();
    assert.deepEqual(await spendScopes(page), ["campaign|Funding spring", "partner|—", "platform|—"]);
    assert.equal(await text(page, "#spendFoot"), "3 of 4 daily limits in use · closest to the limit first");
    assert.deepEqual(await page.$$eval("#spendRail button.on", (els) => els.map((e) => e.dataset.v)), ["ok"]);

    await page.locator('#spendRail button[data-v="all"]').click();
    assert.equal((await spendScopes(page)).length, 4);
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Spend rail filter/, async () => {
    // "Breached" is what the kill switch stamped (breached_at), not "spend is at or over the limit": an
    // over-limit row with nothing stamped is OK, and a stamped row that fell back under its limit is breached.
    const { page, errors } = await openManager({ overrides: { ceilings: CEILINGS_TRICKY } });
    const counts = await page.$$eval("#spendRail button", (els) => Object.fromEntries(els.map((e) => [e.dataset.v, e.querySelector(".n")?.textContent])));
    assert.deepEqual(counts, { all: "4", breached: "1", ok: "3" });
    // The page's own order: scope names alphabetically, then the closest to its limit first inside a scope.
    assert.deepEqual(await spendScopes(page), ["campaign|Alpha over limit", "campaign|Beta breached", "partner|—", "platform|—"]);

    await page.locator('#spendRail button[data-v="breached"]').click();
    assert.deepEqual(await spendScopes(page), ["campaign|Beta breached"]);
    await page.locator('#spendRail button[data-v="ok"]').click();
    assert.deepEqual(await spendScopes(page), ["campaign|Alpha over limit", "partner|—", "platform|—"]);
    // The pressed state is told to assistive tech as well as painted.
    assert.deepEqual(await page.$$eval("#spendRail button", (els) => els.map((e) => [e.dataset.v, e.getAttribute("aria-pressed")])),
      [["all", "false"], ["breached", "false"], ["ok", "true"]]);
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Spend rail filter/, async () => {
    // A read that failed prints no numbers beside the filters (a 0 would read as an all-clear), says what
    // failed in the footer and the body, and puts no headline chip on the screen.
    const { page, errors } = await openManager({ overrides: { spendReply: FAILED_READ } });
    assert.equal(await page.locator("#spendRail button .n").count(), 0, "no counts before the read answered");
    assert.equal(await page.locator("#spendRail button").count(), 3, "the three filters are still there");
    assert.equal(await text(page, "#spendFoot"), COULD_NOT_REACH);
    assert.equal(await text(page, "#spendRows"), COULD_NOT_REACH);
    assert.equal(await page.locator("#ceilChip").isVisible(), false, "no headline status from a read that did not answer");
    // Picking a filter on a failed read still prints no number and still says why.
    await page.locator('#spendRail button[data-v="breached"]').click();
    assert.equal(await page.locator("#spendRail button .n").count(), 0);
    assert.equal(await text(page, "#spendFoot"), COULD_NOT_REACH);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Fatigue state rail: each state lists only its own ads, counts them, and says so when nothing matches", async () => {
  await proof.check(/^Fatigue state rail/, async () => {
    const { page, errors } = await openManager();
    const counts = await page.$$eval("#fatRail button", (els) => Object.fromEntries(els.map((e) => [e.dataset.v, e.querySelector(".n")?.textContent])));
    assert.deepEqual(counts, { all: "5", refresh: "1", queue: "1", ok: "2", unconfigured: "1" });
    assert.deepEqual(await fatigueNames(page), ["Hook one", "Hook two", "Hook three", "Hook four", "Hook five"]);

    const expected = { refresh: ["Hook one"], queue: ["Hook two"], ok: ["Hook three", "Hook four"], unconfigured: ["Hook five"] };
    for (const [state, names] of Object.entries(expected)) {
      await page.locator(`#fatRail button[data-v="${state}"]`).click();
      assert.deepEqual(await fatigueNames(page), names, state);
      assert.deepEqual(await page.$$eval("#fatRail button.on", (els) => els.map((e) => e.dataset.v)), [state]);
      assert.equal(await text(page, "#fatFoot"), `${names.length} of 5 ads with activity in the last 7 days · most heavily repeated first`);
    }
    await page.locator('#fatRail button[data-v="all"]').click();
    assert.equal((await fatigueNames(page)).length, 5);
    assert.deepEqual(errors, []);
    await page.close();

    // A state with no ads says so in words: the "unconfigured" empty sentence is its own.
    const empty = await openManager({ overrides: { fatigue: FATIGUE.filter((f) => f.recommendation !== "unconfigured") } });
    await empty.page.locator('#fatRail button[data-v="unconfigured"]').click();
    assert.match(await text(empty.page, "#fatRows"), /Nothing is unconfigured\. The rotation rules are on for this partner\./);
    await empty.page.locator('#fatRail button[data-v="refresh"]').click();
    await empty.page.locator('#fatRail button[data-v="ok"]').click();
    assert.equal((await fatigueNames(empty.page)).length, 2);
    await empty.page.close();
  });
  await proof.check(/^Fatigue state rail/, async () => {
    // A read that failed prints no number beside any state (a "0" beside Refresh would read as all clear) and
    // the footer says what failed instead of "0 of 0 ads". Each way a read can fail has its own sentence.
    const cases = [
      [{ status: 500, body: { ok: false, error: "query_failed" } }, COULD_NOT_REACH],
      [{ status: 401, body: { ok: false, error: "unauthorized" } }, "You are not signed in for this data, so nothing was read. Sign in and press Reload."],
      [{ status: 503, body: { ok: false, db: "down", message: "x" } }, "We could not reach the data. Press Reload to try again."],
    ];
    for (const [reply, words] of cases) {
      const { page, errors } = await openManager({ overrides: { fatigueReply: () => reply } });
      assert.equal(await page.locator("#fatRail button .n").count(), 0, `${reply.status}: no counts`);
      assert.equal(await page.locator("#fatRail button").count(), 5, `${reply.status}: the five states are still there`);
      assert.equal(await text(page, "#fatFoot"), words, String(reply.status));
      assert.equal(await text(page, "#fatRows"), words, `${reply.status}: the body says it too`);
      assert.doesNotMatch(await text(page, "#fatFoot"), /0 of 0/);
      assert.deepEqual(await fatigueNames(page), [], `${reply.status}: no ads are listed`);
      assert.deepEqual(errors, [], String(reply.status));
      await page.close();
    }
  });
});

test("Fatigue Window select: 7, 14 and 30 days each ask the server again with that window and say it in the footer", async () => {
  await proof.check(/^Fatigue Window select/, async () => {
    const { page, seen, errors } = await openManager();
    assert.deepEqual(await page.$$eval("#fDays option", (els) => els.map((e) => [e.value, e.textContent])), [["7", "7 days"], ["14", "14 days"], ["30", "30 days"]]);
    assert.equal(await page.locator("#fDays").inputValue(), "7");
    assert.equal(seen.fatigue.length, 1);
    assert.equal(seen.fatigue[0].get("days"), "7");
    assert.equal(seen.fatigue[0].get("state"), "all");
    assert.equal(seen.fatigue[0].get("partner_id"), PID);

    for (const days of ["14", "30", "7"]) {
      const before = seen.fatigue.length;
      await page.locator("#fDays").selectOption(days);
      await waitFor(() => seen.fatigue.length === before + 1, `a fatigue read for ${days} days`);
      assert.equal(seen.fatigue.at(-1).get("days"), days);
      assert.equal(seen.fatigue.at(-1).get("partner_id"), PID, "the partner stays on the new read");
      await waitFor(async () => (await text(page, "#fatFoot")).includes(`in the last ${days} days`), `footer for ${days} days`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Fatigue row Label button opens the link box on that ad, reads the creatives once, and clears the boxes", async () => {
  await proof.check(/^Fatigue row: Label button/, async () => {
    const { page, seen, errors } = await openManager();
    assert.equal(await page.locator("#linkBox").isVisible(), false, "the link box starts closed");
    assert.equal(seen.library.length, 0, "no creative read until a Label is pressed");

    const labels = await page.$$eval("#fatRows button[data-link-ad]", (els) => els.map((e) => [e.dataset.linkAd, e.dataset.linkName, e.textContent]));
    assert.deepEqual(labels.map(([id, name]) => [id, name]), FATIGUE.map((f) => [f.ad_id, f.ad_name]));
    assert.equal(labels[0][2], "Label…");

    await page.locator("#fatRows button[data-link-ad]").nth(1).click();
    await page.waitForSelector("#linkBox", { state: "visible" });
    assert.match(await text(page, "#linkWho"), /Setting the creative and our ad number for Hook two\./);
    await waitFor(() => seen.library.length === 1, "the creative read");
    assert.equal(seen.library[0].get("limit"), "100");
    assert.equal(seen.library[0].get("partner_id"), PID);
    await page.waitForFunction(() => document.querySelectorAll("#linkAsset option").length === 3);
    const options = await page.$$eval("#linkAsset option", (els) => els.map((e) => [e.value, e.textContent]));
    assert.deepEqual(options[0], ["", "— leave it as it is —"]);
    assert.deepEqual(options.slice(1).map(([value]) => value), [ASSET_1, ASSET_2]);
    assert.match(options[1][1], /^static · 1080x1080 · .* · Funding in seven days · c0ffee00$/);

    // Typed words are cleared when another ad's Label is pressed, and the creatives are not read again.
    await page.locator("#linkNumber").fill("77");
    await page.locator("#linkAsset").selectOption(ASSET_2);
    await page.locator("#fatRows button[data-link-ad]").nth(3).click();
    assert.match(await text(page, "#linkWho"), /for Hook four\./);
    assert.equal(await page.locator("#linkNumber").inputValue(), "");
    assert.equal(await page.locator("#linkAsset").inputValue(), "");
    assert.equal(seen.library.length, 1, "the creatives are read only the first time");
    assert.equal((await page.$$("#linkAsset option")).length, 3, "the creatives are not listed twice");
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Fatigue row: Label button/, async () => {
    // The rows are replaced every time the rail or the window changes, so a Label pressed on a row of a later
    // paint must still open the box on THAT ad. (The listener is on the table body, which stays.)
    const { page, seen, errors } = await openManager();
    await page.locator('#fatRail button[data-v="ok"]').click();
    assert.deepEqual(await fatigueNames(page), ["Hook three", "Hook four"]);
    await page.locator("#fatRows button[data-link-ad]").nth(1).click();
    await page.waitForSelector("#linkBox", { state: "visible" });
    assert.match(await text(page, "#linkWho"), /for Hook four\./);

    await page.locator('#fatRail button[data-v="all"]').click();
    const before = seen.fatigue.length;
    await page.locator("#fDays").selectOption("14");
    await waitFor(() => seen.fatigue.length === before + 1, "the read for the new window");
    await waitFor(async () => (await text(page, "#fatFoot")).includes("in the last 14 days"), "the new window painted");
    await page.locator("#fatRows button[data-link-ad]").first().click();
    assert.match(await text(page, "#linkWho"), /for Hook one\./);
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Fatigue row: Label button/, async () => {
    // The sentence from one ad's save does not stay under another ad: pressing Label clears it.
    const { page, seen, errors } = await openManager();
    await page.locator("#fatRows button[data-link-ad]").first().click();
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkSaveBtn").click();
    await waitFor(async () => /Saved\. Our number for this ad is 43\./.test(await text(page, "#linkMsg")), "the saved words");
    // A save re-reads every panel (the open read was the first, this is the second); wait until its rows are
    // in before pressing the next Label.
    await waitFor(() => seen.reads.fatigue === 2, "the read after the save");
    await waitFor(async () => /^5 of 5 ads/.test(await text(page, "#fatFoot")), "the fatigue panel back");
    await page.locator("#fatRows button[data-link-ad]").nth(1).click();
    assert.match(await text(page, "#linkWho"), /for Hook two\./);
    assert.equal(await text(page, "#linkMsg"), "", "the earlier ad's saved sentence is gone");
    assert.equal(await page.locator("#linkNumber").inputValue(), "");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Link box Close button hides the box and forgets the ad, so Save then sends nothing", async () => {
  await proof.check(/^Link box: Close button/, async () => {
    const { page, seen, errors } = await openManager();
    await page.locator("#fatRows button[data-link-ad]").first().click();
    await page.waitForSelector("#linkBox", { state: "visible" });
    await page.locator("#linkNumber").fill("43");
    await page.locator("#linkCloseBtn").click();
    assert.equal(await page.locator("#linkBox").isVisible(), false);

    // The box can be shown again by pressing Label, and it carries no leftover words.
    await page.locator("#fatRows button[data-link-ad]").nth(2).click();
    await page.waitForSelector("#linkBox", { state: "visible" });
    assert.equal(await page.locator("#linkNumber").inputValue(), "");
    await page.locator("#linkCloseBtn").click();

    // With the box shut the ad is forgotten: forcing Save through says to press Label first and sends nothing.
    await page.evaluate(() => document.getElementById("linkSaveBtn").click());
    assert.equal(await text(page, "#linkMsg"), "Nothing was sent. Press Label on one of the ads above first.");
    assert.deepEqual(seen.link, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Link box Creative select: the picked creative goes out as asset_id, and a box left alone sends no asset_id at all", async () => {
  await proof.check(/^Link box: Creative select/, async () => {
    const { page, seen, errors } = await openManager();
    await page.locator("#fatRows button[data-link-ad]").nth(1).click();
    await page.waitForFunction(() => document.querySelectorAll("#linkAsset option").length === 3);

    // Creative alone: the ad and the creative go, and no ad number key rides along.
    await page.locator("#linkAsset").selectOption(ASSET_2);
    await page.locator("#linkSaveBtn").click();
    await waitFor(() => seen.link.length === 1, "the first save");
    assert.deepEqual(seen.link[0], { ad_id: AD_B, partner_id: PID, asset_id: ASSET_2 });
    // The save is a POST that carries the sign-in header (the door answers 405 and 401 to anything else), and
    // the creatives were read with a GET that carries it too.
    assert.deepEqual(seen.requests.link[0], { method: "POST", authorization: SIGNED_IN, contentType: "application/json" });
    assert.deepEqual(seen.requests.library[0], { method: "GET", authorization: SIGNED_IN, contentType: null });
    await waitFor(async () => /Saved\./.test(await text(page, "#linkMsg")), "the saved words");
    assert.match(await text(page, "#linkMsg"), /A creative is linked to it\./);

    // The box left on "leave it as it is" and a number typed: no asset_id key goes out (blank would clear it).
    await page.locator("#fatRows button[data-link-ad]").first().click();
    await page.locator("#linkNumber").fill("12");
    await page.locator("#linkSaveBtn").click();
    await waitFor(() => seen.link.length === 2, "the second save");
    assert.equal(Object.hasOwn(seen.link[1], "asset_id"), false);
    assert.deepEqual(seen.link[1], { ad_id: AD_A, partner_id: PID, fundhub_ad_number: "12" });

    // Nothing picked and nothing typed: a sentence, and no request.
    await page.locator("#fatRows button[data-link-ad]").nth(2).click();
    await page.locator("#linkSaveBtn").click();
    assert.equal(await text(page, "#linkMsg"), "Nothing was sent. Pick a creative, type our ad number, or both.");
    assert.equal(seen.link.length, 2);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Link box Creative select says out loud when the creatives cannot be read, and when there are none", async () => {
  await proof.check(/^Link box: Creative select/, async () => {
    const failed = await openManager({ overrides: { library: { ok: false, error: "forbidden" } } });
    await failed.page.locator("#fatRows button[data-link-ad]").first().click();
    await waitFor(async () => /could not be read/.test(await text(failed.page, "#linkMsg")), "the failure sentence");
    assert.match(await text(failed.page, "#linkMsg"), /^The list of creatives could not be read, so only the ad number can be set here\. Your sign-in is not allowed to change this ad\.$/);
    assert.equal((await failed.page.$$("#linkAsset option")).length, 1);
    // The number still works on its own.
    await failed.page.locator("#linkNumber").fill("43");
    await failed.page.locator("#linkSaveBtn").click();
    await waitFor(() => failed.seen.link.length === 1, "a number-only save");
    assert.deepEqual(failed.seen.link[0], { ad_id: AD_A, partner_id: PID, fundhub_ad_number: "43" });
    await failed.page.close();

    const none = await openManager({ overrides: { library: { ok: true, items: [] } } });
    await none.page.locator("#fatRows button[data-link-ad]").first().click();
    await waitFor(async () => /no creatives on file/.test(await text(none.page, "#linkMsg")), "the none sentence");
    assert.match(await text(none.page, "#linkMsg"), /There are no creatives on file for this partner yet/);
    await none.page.close();
  });
});

test("Link box Our ad number input: typed digits go out as typed, nine is the limit, and the server's refusal is shown", async () => {
  await proof.check(/^Link box: Our ad number input/, async () => {
    const { page, seen, errors } = await openManager();
    await page.locator("#fatRows button[data-link-ad]").first().click();
    const input = page.locator("#linkNumber");
    assert.equal(await input.getAttribute("maxlength"), "9");
    assert.equal(await input.getAttribute("inputmode"), "numeric");

    // Spaces around the number are trimmed away. The number goes out as text, with the ad it was typed for.
    await input.fill("  43  ");
    await page.locator("#linkSaveBtn").click();
    await waitFor(() => seen.link.length === 1, "the first save");
    assert.deepEqual(seen.link[0], { ad_id: AD_A, partner_id: PID, fundhub_ad_number: "43" });
    assert.deepEqual(seen.requests.link[0], { method: "POST", authorization: SIGNED_IN, contentType: "application/json" });
    await waitFor(async () => /Saved\. Our number for this ad is 43\./.test(await text(page, "#linkMsg")), "the saved words");

    // A long Meta id cannot be typed past nine characters.
    await page.locator("#fatRows button[data-link-ad]").nth(1).click();
    await input.click();
    await page.keyboard.type("1234567890123");
    assert.equal(await input.inputValue(), "123456789");
    await page.close();

    // The server's own refusal sentence is shown, with its first letter raised.
    const refused = await openManager({ overrides: { linkAnswer: { ok: false, error: "invalid_ad_number", message: "our ad number is 1 to 9 digits - the leading digits of utm_content." } } });
    await refused.page.locator("#fatRows button[data-link-ad]").first().click();
    await refused.page.locator("#linkNumber").fill("abc");
    await refused.page.locator("#linkSaveBtn").click();
    await waitFor(async () => /Nothing was saved\./.test(await text(refused.page, "#linkMsg")), "the refusal");
    assert.equal(await text(refused.page, "#linkMsg"), "Nothing was saved. Our ad number is 1 to 9 digits - the leading digits of utm_content.");
    assert.deepEqual(refused.seen.link[0], { ad_id: AD_A, partner_id: PID, fundhub_ad_number: "abc" });
    assert.deepEqual(errors, []);
    await refused.page.close();
  });
});

test("Link box: a creative and an ad number picked together go out in one request, and both are saved", async () => {
  const { page, seen, errors } = await openManager();
  await page.locator("#fatRows button[data-link-ad]").nth(1).click();
  await page.waitForFunction(() => document.querySelectorAll("#linkAsset option").length === 3);
  await page.locator("#linkAsset").selectOption(ASSET_1);
  await page.locator("#linkNumber").fill("  77 ");
  await page.locator("#linkSaveBtn").click();
  await waitFor(() => seen.link.length === 1, "the save");
  await waitFor(async () => /Saved\./.test(await text(page, "#linkMsg")), "the saved words");
  const saved = await text(page, "#linkMsg");
  await proof.check(/^Link box: Creative select/, async () => {
    // The page's own sentence says "Pick a creative, type our ad number, or both": both must survive together.
    assert.deepEqual(seen.link[0], { ad_id: AD_B, partner_id: PID, asset_id: ASSET_1, fundhub_ad_number: "77" });
    assert.match(saved, /A creative is linked to it\./);
    assert.deepEqual(seen.requests.link[0], { method: "POST", authorization: SIGNED_IN, contentType: "application/json" });
  });
  await proof.check(/^Link box: Our ad number input/, async () => {
    assert.equal(seen.link[0].fundhub_ad_number, "77", "the typed number is not dropped when a creative is picked too");
    assert.match(saved, /Our number for this ad is 77\./);
    assert.deepEqual(seen.requests.link[0], { method: "POST", authorization: SIGNED_IN, contentType: "application/json" });
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("Funnel pages Sync now: posts an empty body once, holds the button while it runs, and reads the pages again", async () => {
  await proof.check(/^Funnel pages: Sync now button/, async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const { page, seen, errors } = await openManager({ overrides: { syncGate: gate } });
    assert.match(await text(page, "#funnelPagesRows"), /Sales page.*\n?.*10/s);
    const readsBefore = seen.reads.funnel;
    assert.equal(await page.locator("#funnelSyncBtn").isDisabled(), false);

    await page.locator("#funnelSyncBtn").click();
    await waitFor(() => seen.sync.length === 1, "the sync request");
    assert.deepEqual(seen.sync[0], {});
    // A POST with the sign-in header: the door answers 405 to any other method and 401 to no header, so a
    // button that sent a PUT, or no Authorization, would paint "Sync failed" for every staff member.
    assert.deepEqual(seen.requests.sync, [{ method: "POST", authorization: SIGNED_IN, contentType: "application/json" }]);
    assert.equal(await page.locator("#funnelSyncBtn").textContent(), "Syncing…");
    assert.equal(await page.locator("#funnelSyncBtn").isDisabled(), true, "no second press while it runs");
    assert.equal(seen.reads.funnel, readsBefore, "the pages are not read until the sync answers");
    release();

    await waitFor(async () => (await page.locator("#funnelSyncBtn").textContent()) === "Sync now", "the button back");
    assert.equal(await page.locator("#funnelSyncBtn").isDisabled(), false);
    await waitFor(() => seen.reads.funnel === readsBefore + 1, "the page read after the sync");
    await waitFor(async () => /4,?321/.test(await text(page, "#funnelPagesRows")), "the new numbers");
    assert.equal(seen.sync.length, 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Funnel pages: Sync now button/, async () => {
    // A refusal from ClickFunnels is shown in its own words and the old rows stay.
    const { page, seen, errors } = await openManager({ overrides: { syncAnswer: { ok: false, error: "sync_failed", message: "ClickFunnels said the token expired." } } });
    const readsBefore = seen.reads.funnel;
    await page.locator("#funnelSyncBtn").click();
    await waitFor(async () => /Sync failed\./.test(await text(page, "#funnelConnCap")), "the failure words");
    assert.match(await text(page, "#funnelConnCap"), /Sync failed\. ClickFunnels said the token expired\./);
    assert.equal(seen.reads.funnel, readsBefore, "a failed sync does not re-read as if it worked");
    assert.equal(await page.locator("#funnelSyncBtn").textContent(), "Sync now");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Reload button asks every panel again and paints what came back", async () => {
  await proof.check(/^Reload button/, async () => {
    let round = 0;
    const { page, seen, errors } = await openManager({ overrides: {
      get ceilings() { return round === 0 ? CEILINGS : CEILINGS.slice(0, 1); },
    } });
    const before = { ...seen.reads };
    for (const key of ["spend", "list", "fatigue", "conn", "log", "books", "spine", "funnel"]) {
      assert.equal(before[key], 1, `${key} was read once on open`);
    }
    assert.equal((await spendScopes(page)).length, 4);

    round = 1;
    await page.locator("#reloadBtn").click();
    await waitFor(() => seen.reads.spend === 2 && seen.reads.list === 2 && seen.reads.fatigue === 2
      && seen.reads.conn === 2 && seen.reads.log === 2, "all five panels read again");
    for (const key of ["books", "spine", "funnel"]) await waitFor(() => seen.reads[key] === 2, `${key} read again`);
    // The screen shows the new answer, not the old one.
    await waitFor(async () => (await spendScopes(page)).length === 1, "the new spend rows");
    assert.deepEqual(await spendScopes(page), ["campaign|Funding spring"]);
    assert.match(await text(page, "#footNote"), /5 of 5 panels loaded/);
    // One press is one more read of each panel: not two, however quickly they were asked.
    await page.waitForTimeout(300);
    for (const key of ["spend", "list", "fatigue", "conn", "log", "books", "spine", "funnel"]) {
      assert.equal(seen.reads[key], 2, `${key} was read exactly twice in all, once on open and once on Reload`);
    }
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Reload button/, async () => {
    // Press Reload to try again: the panels that failed first time come back, and nothing of the failure
    // is left behind (no sentence, no missing counts, no stale footer).
    const { page, seen, errors } = await openManager({ overrides: {
      spendReply: (n) => (n === 1 ? FAILED_READ() : { body: { ok: true, items: CEILINGS } }),
      fatigueReply: (n) => (n === 1 ? FAILED_READ() : { body: { ok: true, items: FATIGUE } }),
    } });
    assert.equal(await text(page, "#spendFoot"), COULD_NOT_REACH);
    assert.equal(await text(page, "#fatFoot"), COULD_NOT_REACH);
    assert.match(await text(page, "#footNote"), /3 of 5 panels loaded/);
    assert.equal(await page.locator("#spendRail button .n").count(), 0);
    assert.equal(await page.locator("#fatRail button .n").count(), 0);

    await page.locator("#reloadBtn").click();
    await waitFor(() => seen.reads.spend === 2 && seen.reads.fatigue === 2, "both failed panels read again");
    await waitFor(async () => /5 of 5 panels loaded/.test(await text(page, "#footNote")), "all five panels loaded");
    assert.equal((await spendScopes(page)).length, 4);
    assert.equal(await text(page, "#spendFoot"), "4 of 4 daily limits in use · closest to the limit first");
    assert.equal(await text(page, "#fatFoot"), "5 of 5 ads with activity in the last 7 days · most heavily repeated first");
    assert.doesNotMatch(await text(page, "#spendRows"), /could not reach/i);
    assert.doesNotMatch(await text(page, "#fatRows"), /could not reach/i);
    assert.equal(await page.locator("#spendRail button .n").count(), 3, "the counts are back");
    assert.equal(await page.locator("#fatRail button .n").count(), 5);
    assert.equal(await page.locator("#ceilChip").isVisible(), true, "the headline chip is back");
    assert.deepEqual(errors, []);
    await page.close();
  });
  await proof.check(/^Reload button/, async () => {
    // And the other way: a good screen whose read then fails is CLEARED and says why. Old rows never stay
    // up under a read that did not answer.
    const { page, seen, errors } = await openManager({ overrides: {
      spendReply: (n) => (n === 1 ? { body: { ok: true, items: CEILINGS } } : FAILED_READ()),
      fatigueReply: (n) => (n === 1 ? { body: { ok: true, items: FATIGUE } } : FAILED_READ()),
    } });
    assert.equal((await spendScopes(page)).length, 4);
    assert.equal((await fatigueNames(page)).length, 5);

    await page.locator("#reloadBtn").click();
    await waitFor(() => seen.reads.spend === 2 && seen.reads.fatigue === 2, "both panels read again");
    await waitFor(async () => (await text(page, "#spendFoot")) === COULD_NOT_REACH, "the spend failure sentence");
    assert.deepEqual(await spendScopes(page), [], "the old limits are gone");
    assert.equal(await text(page, "#fatFoot"), COULD_NOT_REACH);
    assert.deepEqual(await fatigueNames(page), [], "the old ads are gone");
    assert.equal(await page.locator("#spendRail button .n").count(), 0);
    assert.equal(await page.locator("#fatRail button .n").count(), 0);
    assert.match(await text(page, "#footNote"), /3 of 5 panels loaded/);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("Reload button: a panel that failed stops being called failed the moment its new read is out, and is not called good before it answers", async () => {
  await proof.check(/^Reload button/, async () => {
    let release;
    const hold = new Promise((resolve) => { release = resolve; });
    const { page, seen, errors } = await openManager({ overrides: {
      spendHold: hold,
      spendReply: (n) => (n === 1 ? FAILED_READ() : { body: { ok: true, items: CEILINGS } }),
    } });
    // The first read failed: the screen says which panel did not load, and why, in the panel's own words.
    assert.equal(await page.locator("#loadWarn").isVisible(), true);
    assert.match(await text(page, "#loadWarn"), /^Spend vs limits did not load\. We could not reach the data\. Press Reload to try again\.$/);

    await page.locator("#reloadBtn").click();
    await waitFor(() => seen.reads.spend === 2, "the second spend read, held");
    // The old failure is not repeated at a read that has not answered yet (a screen still reading says
    // nothing), and the rail still prints no counts: the new answer has not come back.
    await waitFor(async () => !(await page.locator("#loadWarn").isVisible()), "the failure line put away while reading");
    assert.equal(await page.locator("#spendRail button .n").count(), 0);
    assert.equal(await page.locator("#ceilChip").isVisible(), false, "no headline status from a read that has not answered");
    release();
    await waitFor(async () => (await text(page, "#spendFoot")).startsWith("4 of 4 daily limits"), "the answer");
    assert.equal(await page.locator("#loadWarn").isVisible(), false);
    assert.equal(await page.locator("#spendRail button .n").count(), 3);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
