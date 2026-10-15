// Batch 16 practice tests: the Today tab of the Marketing Command Center
// (public/app/marketing-cc-today.js inside marketing-command-center.html), in a real Chromium with fake
// /api answers. No live data, no spend, nothing sent.
//
//   the six flywheel steps       each step's words and chip, and the Read it / Hide it card toggle
//   the spend tiles              7 days against the 7 before, last 30 days, "Old numbers" when the pull is late
//   What is turned on            the tile and the health list (Meta numbers, house account, files, copy writer)
//   Waiting on you               the Mac queue, videos awaiting approval and the flywheel steps waiting
//   the text folds and links     Show more / Show less, See every ad in Campaigns, Open Creative Factory

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, sharedScreens, OWNER } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const PAGE = "/app/marketing-command-center.html";
// 19:00 UTC is 12:00 PM in Arizona.
const NOW = "2026-10-05T19:00:00Z";
const HOUSE = "11111111-2222-4333-8444-555555555555";

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
    counts: {}, review_card: null },
];

const ok = (key, over = {}) => ({ key, ok: true, label: key, missing: null, ...over });
const NO_OFFER_COST = { measured: false, job_id: null, finished_at: null, seconds: null, input_tokens: null, output_tokens: null, models: [], cost_cents: null, under_one_cent: false, unpriced_models: [] };
const NO_COPY_COST = { runs: 0, last_at: null, models: [], avg_input_tokens: null, avg_output_tokens: null, avg_cost_cents: null, under_one_cent: false, unpriced_models: [] };
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
          blocked_reasons: [{ code: "guarantee", rule_set: "funding", message: "Funding ads may not promise approval." }], created_at: "2026-10-04T18:00:00Z" },
        { id: "a1", copy_text: LONG_COPY, compliance_state: "passed", blocked_reasons: [], created_at: "2026-10-03T18:00:00Z" },
      ],
      jobs: [{ id: "j1", status: "failed", error: "no active provider configured for org x", created_at: "2026-09-17T10:00:00Z" }],
    },
    copy_ready: {
      ready: true, partner_id: HOUSE,
      checks: [ok("house_partner"), ok("marketing_switch"), ok("copy_provider"), ok("anthropic_key"), { ...ok("writing_budget"), used: 1000, cap: 250000 }],
      missing: [],
    },
    spend: {
      currency: "USD",
      through: "2026-10-04",
      windows: {
        today: { from: "2026-10-05", to: "2026-10-05", days: 1, spend_cents: null, ad_days: 0, days_with_data: 0 },
        last_7_days: { from: "2026-09-28", to: "2026-10-04", days: 7, spend_cents: 123456, ad_days: 40, days_with_data: 7 },
        prior_7_days: { from: "2026-09-21", to: "2026-09-27", days: 7, spend_cents: 100000, ad_days: 40, days_with_data: 7 },
        last_30_days: { from: "2026-09-05", to: "2026-10-04", days: 30, spend_cents: 500000, ad_days: 46, days_with_data: 12 },
        prior_30_days: { from: "2026-08-06", to: "2026-09-04", days: 30, spend_cents: 400000, ad_days: 30, days_with_data: 10 },
      },
    },
    last_sync: { meta_synced_at: "2026-10-05T07:01:00Z", metrics_synced_at: "2026-10-05T07:01:30Z", latest_metrics_date: "2026-10-04", clickfunnels_synced_at: "2026-10-04T22:10:00Z" },
    costs: { offer: NO_OFFER_COST, copy: NO_COPY_COST },
    ...over,
  };
}

const VIDEOS = { ok: true, count: 2, limit: 50, offset: 0, hasMore: false, items: [
  { id: "v84", ad_id: "84", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T01:45:25Z", updated_at: "2026-09-24T07:55:11Z", approval_expires_at: "2026-09-27T05:45:21Z", status_means: "waiting on Chris" },
  { id: "v86", ad_id: "86", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T22:08:52Z", updated_at: "2026-09-24T23:39:26Z", approval_expires_at: "2026-09-27T23:39:25Z", status_means: "waiting on Chris" },
] };
const NO_VIDEOS = { ok: true, count: 0, limit: 50, offset: 0, hasMore: false, items: [] };

async function openToday({ t = today(), videos = [VIDEOS, 200], viewport, wait = "#flywheelList li[data-stage]" } = {}) {
  const log = { today: 0, videos: 0 };
  const handlers = {
    "/api/marketing/today": async (route) => { log.today += 1; return json(route, t); },
    "/api/ad-videos": async (route) => { log.videos += 1; return json(route, videos[0], videos[1]); },
  };
  const before = async (page) => { await page.clock.install({ time: new Date(NOW) }); };
  const opened = await screens.open(PAGE, { session: OWNER, handlers, before, ...(viewport ? { viewport } : {}) });
  await opened.page.waitForSelector(wait);
  return { ...opened, log };
}

const stageRow = (page, key) => page.locator(`#flywheelList li[data-stage="${key}"]`);
const chipOf = async (page, key) => (await stageRow(page, key).locator(".chip").first().innerText()).trim();

// One test per step would load the page six times, so the page loads once and each step is its own claim.
test("each of the six flywheel steps says its state in the word table and opens or closes its review card", { timeout: 120_000 }, async () => {
  const { page, errors } = await openToday();
  const expect = {
    avatar: { name: "Who we sell to", step: "Step 1 of 6", chip: "Done, approved", tone: "on", card: "who the partner is" },
    "ad-research": { name: "What the market sells", step: "Step 2 of 6", chip: "Done", tone: "wip", card: "what the market already sells" },
    offer: { name: "The offer", step: "Step 3 of 6", chip: "Needs a redo", tone: "bad", card: "the partner offer and its price" },
    copy: { name: "Ad copy", step: "Step 4 of 6", chip: "Needs a redo", tone: "bad", card: "which three hooks go live first" },
    "ad-strategy": { name: "Which ad strategy", step: "Step 5 of 6", chip: "Waiting on steps 3 and 4", tone: "wip", card: "run the Forester" },
  };
  const rows = {
    avatar: /^Today flywheel step 1 \(avatar/, "ad-research": /^Today flywheel step 2 \(ad-research/, offer: /^Today flywheel step 3 \(offer/,
    copy: /^Today flywheel step 4 \(copy/, "ad-strategy": /^Today flywheel step 5 \(ad-strategy/, spend: /^Today flywheel step 6 \(spend/,
  };

  for (const key of Object.keys(expect)) {
    await proof.check(rows[key], async () => {
      const want = expect[key];
      const row = stageRow(page, key);
      assert.equal((await row.locator("b").first().innerText()).trim(), want.name);
      assert.equal((await row.locator(".step").innerText()).trim(), want.step);
      assert.equal((await chipOf(page, key)).toLowerCase(), want.chip.toLowerCase());
      assert.ok((await row.locator(".chip").first().getAttribute("class")).split(/\s+/).includes(want.tone), `${key}: chip tone ${want.tone}`);
      // The review card starts folded, opens on Read it (and says Hide it), and folds back.
      const toggle = row.locator("button[data-toggle]");
      assert.equal((await toggle.innerText()).trim(), "Read it");
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      const card = page.locator(`#${await toggle.getAttribute("data-toggle")}`);
      assert.equal(await card.isHidden(), true);
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Hide it");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await card.isVisible(), true);
      const words = await card.innerText();
      assert.ok(words.includes(want.card), `${key}: the card holds this step's own review words`);
      assert.match(words, /What this decided:/);
      assert.doesNotMatch(words, /Say one of:/, "a chat instruction is never shown");
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Read it");
      assert.equal(await card.isHidden(), true);
    });
  }

  await proof.check(rows.spend, async () => {
    const row = stageRow(page, "spend");
    assert.equal((await row.locator("b").first().innerText()).trim(), "Read the spend");
    assert.equal((await row.locator(".step").innerText()).trim(), "Step 6 of 6");
    assert.equal((await chipOf(page, "spend")).toLowerCase(), "not run yet");
    // A step with nothing to read has a button that does nothing, and says why.
    const read = row.locator("button", { hasText: "Read it" });
    assert.equal(await read.isDisabled(), true);
    assert.equal(await row.locator("button[data-toggle]").count(), 0);
    assert.match(await row.innerText(), /Nothing to read yet: this step has not been run\./);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("an open review card stays open when the page is read again", { timeout: 60_000 }, async () => {
  await proof.check(/^Today flywheel step 1 \(avatar/, async () => {
    const { page, log } = await openToday();
    const toggle = stageRow(page, "avatar").locator("button[data-toggle]");
    await toggle.click();
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    // The page reads again every five minutes; the open card must not fold under the reader.
    const before = log.today;
    await page.clock.fastForward(5 * 60 * 1000 + 1000);
    await page.waitForFunction(() => true);
    const end = Date.now() + 10_000;
    while (log.today === before && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
    assert.ok(log.today > before, "the page read again");
    await page.waitForTimeout(150);
    assert.equal(await stageRow(page, "avatar").locator("button[data-toggle]").getAttribute("aria-expanded"), "true");
    assert.equal(await stageRow(page, "avatar").locator(".review").isVisible(), true);
    await page.close();
  });
});

test("the spend tiles say 7 days and 30 days against the period before, and lead with Old numbers when the pull is late", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: spend tiles \(7 days vs the 7 before/, async () => {
    // Fresh pull: whole-day windows, the comparison in plain money, today's number "comes in tomorrow".
    const fresh = await openToday();
    const t7 = await fresh.page.locator("#tileSpend7").innerText();
    assert.match(t7, /Ad spend, all accounts, last 7 days/);
    assert.match(t7, /\$1,234\.56/);
    assert.match(t7, /Up from \$1,000 the 7 days before\./);
    assert.match(t7, /Sep 28 to Oct 4\./);
    assert.doesNotMatch(t7, /Old numbers/);
    const t30 = await fresh.page.locator("#tileSpend30").innerText();
    assert.match(t30, /Ad spend, all accounts, last 30 days/);
    assert.match(t30, /\$5,000/);
    assert.match(t30, /Up from \$4,000 the 30 days before\./);
    assert.match(t30, /Numbers saved for 12 of 30 days\./, "a window that is only part covered says so");
    assert.match(t30, /Today's numbers come in tomorrow morning\./);
    assert.equal(await fresh.page.locator("#mccAsOf").evaluate((n) => n.classList.contains("stale")), false);
    await fresh.page.close();

    // The pull is three days old: the first tile leads with Old numbers and the as-of line goes stale.
    const old = today({ last_sync: { meta_synced_at: "2026-10-02T07:01:00Z", metrics_synced_at: "2026-10-02T07:01:30Z", latest_metrics_date: "2026-10-01", clickfunnels_synced_at: "2026-10-04T22:10:00Z" } });
    const late = await openToday({ t: old });
    assert.match(await late.page.locator("#tileSpend7").innerText(), /Old numbers: last saved Oct 2/);
    assert.doesNotMatch(await late.page.locator("#tileSpend30").innerText(), /Old numbers/, "it leads the row once, on the first tile");
    assert.match(await late.page.locator("#tileSpend30").innerText(), /Today so far: unknown\./);
    assert.equal(await late.page.locator("#mccAsOf").evaluate((n) => n.classList.contains("stale")), true);
    assert.match(await late.page.locator("#mccAsOf").innerText(), /^Old numbers: last saved/);
    await late.page.close();

    // Ads stopped: a window with no saved spend is "no spend saved", never $0.
    const stopped = today();
    stopped.spend.windows.last_7_days = { ...stopped.spend.windows.last_7_days, spend_cents: null, ad_days: 0, days_with_data: 0 };
    const none = await openToday({ t: stopped });
    const nt7 = await none.page.locator("#tileSpend7").innerText();
    assert.match(nt7, /No ad spend saved for Sep 28 to Oct 4\./);
    assert.match(nt7, /\bunknown\b/);
    assert.doesNotMatch(nt7, /\$0\b/);
    await none.page.close();
  });
});

test("What is turned on counts only the parts that are ready, and names the ones that are not", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'What is turned on' tile and health list/, async () => {
    const healthy = await openToday();
    assert.equal((await healthy.page.locator("#tileParts .vl").innerText()).trim(), "6 of 6");
    assert.match(await healthy.page.locator("#tileParts .cmp").innerText(), /Every part is ready\./);
    const health = await healthy.page.locator("#healthList li.row").allInnerTexts();
    const row = (label) => health.find((r) => r.startsWith(label));
    for (const label of ["Ad numbers from Meta", "Marketing switch for the Fundhub house account", "Copy writer set up", "AI key for writing", "Writing budget this month", "Offer and market files"]) {
      assert.ok(row(label), `${label} is listed`);
      assert.match(row(label), /\bready\b/i, label);
      assert.doesNotMatch(row(label), /not ready/i, label);
    }
    assert.match(row("Offer and market files"), /Found on the server\./);
    await healthy.page.close();

    // Some parts down: the copy writer and the AI key, and the Meta pull is old.
    const sick = today({
      copy_ready: { ready: false, partner_id: HOUSE, checks: [ok("house_partner"), ok("marketing_switch"), { ...ok("copy_provider"), ok: false },
        { ...ok("anthropic_key"), ok: false }, { ...ok("writing_budget"), used: 1000, cap: 250000 }], missing: ["copy_provider", "anthropic_key"] },
      last_sync: { meta_synced_at: "2026-10-01T07:01:00Z", metrics_synced_at: "2026-10-01T07:01:30Z", latest_metrics_date: "2026-09-30" },
    });
    const bad = await openToday({ t: sick });
    assert.equal((await bad.page.locator("#tileParts .vl").innerText()).trim(), "3 of 6");
    const cmp = await bad.page.locator("#tileParts .cmp").innerText();
    assert.match(cmp, /^Not ready: /);
    for (const label of ["Ad numbers from Meta", "Copy writer set up", "AI key for writing"]) assert.ok(cmp.includes(label), `${label} is named`);
    const rows = await bad.page.locator("#healthList li.row").allInnerTexts();
    assert.match(rows.find((r) => r.startsWith("Copy writer set up")), /Not set up, so ad copy cannot be written\.[\s\S]*not ready/i);
    assert.match(rows.find((r) => r.startsWith("AI key for writing")), /Missing, so ad copy cannot be written\./);
    assert.match(rows.find((r) => r.startsWith("Ad numbers from Meta")), /It should save every day\./);
    await bad.page.close();

    // Offer and market files not on the server, and no house account: each says so, and neither counts as ready.
    const bare = today({ copy_ready: { ready: false, partner_id: null, checks: [{ ...ok("house_partner"), ok: false }, ok("marketing_switch")], missing: ["house_partner"] } });
    delete bare.flywheel;
    const gone = await openToday({ t: bare, wait: "#healthList li.row" });
    const gRows = await gone.page.locator("#healthList li.row").allInnerTexts();
    assert.match(gRows.find((r) => r.startsWith("Fundhub house account")), /Missing, so there is no account to write ad copy for\.[\s\S]*not ready/i);
    assert.match(gRows.find((r) => r.startsWith("Offer and market files")), /The offer and market files are not on this server yet\.[\s\S]*not ready/i);
    assert.match(gRows.find((r) => r.startsWith("Copy writer set up")), /unknown/i, "a part nobody answered for is unknown, not ready");
    assert.equal((await gone.page.locator("#tileParts .vl").innerText()).trim(), "2 of 7", "only the parts that answered yes are counted");
    assert.match(await gone.page.locator("#tileParts .cmp").innerText(), /^Not ready: Fundhub house account/);
    await gone.page.close();
  });
});

test("Waiting on you lists the Mac queue, the videos awaiting approval and the steps that need a person", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'Waiting on you' list/, async () => {
    const withMac = today({ mac_queue: { waiting: 2, running: 0, line: "2 AI jobs wait for your Mac." } });
    const full = await openToday({ t: withMac });
    await full.page.waitForFunction(() => document.querySelectorAll("#waitingList li[data-wait]").length >= 4);
    const kinds = await full.page.locator("#waitingList li[data-wait]").evaluateAll((els) => els.map((e) => e.getAttribute("data-wait")));
    assert.deepEqual(kinds, ["mac", "videos", "approve", "redo", "redo"], "Mac queue first, then videos, then the steps in order");
    const texts = await full.page.locator("#waitingList li[data-wait]").allInnerTexts();
    assert.match(texts[0], /Waiting for your Mac to run it[\s\S]*2 AI jobs wait for your Mac\./);
    assert.match(texts[1], /Approve or reject 2 videos[\s\S]*Ad 84 and Ad 86\.[\s\S]*Waiting since Sep 24\./);
    assert.match(texts[2], /Read and approve: What the market sells \(step 2 of 6\)/);
    assert.match(texts[3], /Redo the offer \(step 3 of 6\)/i);
    assert.match(texts[4], /Redo ad copy \(step 4 of 6\)/i);
    assert.equal((await full.page.locator("#waitingCount").innerText()).trim(), "5 to do");
    await full.page.close();

    // Nothing waiting: said as good news, and the count is empty.
    const clear = today({ flywheel: { campaigns: [{ campaign: "partner", stages: STAGES.map((s) => ({ ...s, state: "READY", approved: true, reasons: [] })), advice: "" }] } });
    const none = await openToday({ t: clear, videos: [NO_VIDEOS, 200] });
    assert.match(await none.page.locator("#waitingList").innerText(), /Nothing is waiting on you right now\./);
    assert.equal((await none.page.locator("#waitingCount").innerText()).trim(), "");
    await none.page.close();

    // The video list fails: the rest of the list stays, and the page says only the videos are missing.
    const part = await openToday({ videos: [{ ok: false, error: "boom" }, 500] });
    await part.page.waitForFunction(() => /The video list did not load/.test(document.querySelector("#waitingList")?.textContent || ""));
    assert.match(await part.page.locator("#waitingList").innerText(), /The video list did not load\. The rest of this page is current\./);
    assert.equal(await part.page.locator('#waitingList li[data-wait="videos"]').count(), 0);
    assert.ok(await part.page.locator('#waitingList li[data-wait="redo"]').count() >= 1, "the steps that need a person are still listed");
    await part.page.close();
  });
});

test("long ad copy folds behind Show more; the Campaigns and Creative Factory links go where they say", { timeout: 90_000 }, async () => {
  await proof.check(/^Today: 'Show more' \/ 'Read it' text folds/, async () => {
    // Three ways to be long: many short lines, one long line, and many long lines. A short piece never folds.
    const manyLines = Array.from({ length: 8 }, (_, i) => `Short line ${i + 1}.`).join("\n");
    const oneLong = "Your bank said no. ".repeat(24).trim();
    const fiveLines = Array.from({ length: 5 }, (_, i) => `Five line ${i + 1}.`).join("\n");
    const piece = (id, text, day) => ({ id, copy_text: text, compliance_state: "passed", blocked_reasons: [], created_at: `2026-10-0${day}T18:00:00Z` });
    const t = today();
    t.copy.pieces = [piece("p1", LONG_COPY, 4), piece("p2", manyLines, 3), piece("p3", oneLong, 2), piece("p4", fiveLines, 1)];
    const { page, errors } = await openToday({ t });

    async function foldCheck(startsWith, hiddenTail, tailWords) {
      const one = page.locator("#latestList .piece", { hasText: startsWith });
      const short = one.locator(".words").first();
      const toggle = one.locator("button[data-toggle]");
      assert.equal((await toggle.innerText()).trim(), "Show more", startsWith);
      assert.match(await short.innerText(), /…$/);
      assert.doesNotMatch(await short.innerText(), tailWords, "the folded version leaves the tail out");
      const full = page.locator(`#${await toggle.getAttribute("data-toggle")}`);
      assert.equal(await full.isHidden(), true);
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Show less");
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await full.isVisible(), true);
      assert.match(await full.innerText(), hiddenTail);
      assert.equal(await short.isHidden(), true, "the short version steps aside while the full words are open");
      await toggle.click();
      assert.equal((await toggle.innerText()).trim(), "Show more");
      assert.equal(await short.isVisible(), true);
      assert.equal(await full.isHidden(), true);
    }
    await foldCheck("Line 1:", /Line 12:/, /Line 12:/);
    await foldCheck("Short line 1.", /Short line 8\./, /Short line 8\./);
    await foldCheck("Your bank said no.", /(Your bank said no\. ){23}Your bank said no\./, /(Your bank said no\. ){20}/);
    // A short piece has no fold at all, and neither does five short lines.
    assert.equal(await page.locator("#latestList .piece", { hasText: "Five line 1." }).locator("button[data-toggle]").count(), 0);
    assert.match(await page.locator("#latestList .piece", { hasText: "Five line 1." }).innerText(), /Five line 5\./);

    // The two links.
    assert.equal(await page.locator('#tileSpend7 a:has-text("See every ad in Campaigns")').getAttribute("href"), "campaign-manager.html");
    assert.equal(await page.locator('#cardLatest a:has-text("Open Creative Factory")').getAttribute("href"), "creative-factory.html");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("a step with no review card has a Read it that does nothing, and says why", { timeout: 60_000 }, async () => {
  await proof.check(/^Today flywheel step 2 \(ad-research/, async () => {
    const stages = STAGES.map((s) => (s.key === "ad-research" ? { ...s, review_card: null } : s));
    const t = today({ flywheel: { campaigns: [{ campaign: "partner", stages, advice: "" }] } });
    const { page } = await openToday({ t });
    const row = stageRow(page, "ad-research");
    assert.equal((await chipOf(page, "ad-research")).toLowerCase(), "done", "the state is still said");
    assert.equal(await row.locator("button[data-toggle]").count(), 0);
    assert.equal(await row.locator("button", { hasText: "Read it" }).isDisabled(), true);
    assert.match(await row.innerText(), /Nothing to read yet: this step has no review card\./);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
