// Batch 16 practice tests, shared pieces for the Today tab of the Marketing Command Center
// (public/app/marketing-cc-today.js inside marketing-command-center.html): the fake /api answers and the
// open-the-page helper that fin-b16-cc-today.test.mjs and fin-b16-cc-today-words.test.mjs both use.
// Tests only. Nothing here is imported by the live bundle and nothing here reads live data.

import { json, OWNER } from "./fin-b16-kit.mjs";

export const PAGE = "/app/marketing-command-center.html";
// 19:00 UTC is 12:00 PM in Arizona.
export const NOW = "2026-10-05T19:00:00Z";
export const HOUSE = "11111111-2222-4333-8444-555555555555";

export const CARD = (decided) => `**What this decided:** ${decided}\n\n**Three things to check:** Is this right? · Is the price right? · Is the guarantee right?\n\n**What I wasn't sure about:** nothing.\n\n**Say one of:** approve · tweak: \\<what to change\\> · redo`;

export const STAGES = [
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

export const ok = (key, over = {}) => ({ key, ok: true, label: key, missing: null, ...over });
export const NO_OFFER_COST = { measured: false, job_id: null, finished_at: null, seconds: null, input_tokens: null, output_tokens: null, models: [], cost_cents: null, under_one_cent: false, unpriced_models: [] };
export const NO_COPY_COST = { runs: 0, last_at: null, models: [], avg_input_tokens: null, avg_output_tokens: null, avg_cost_cents: null, under_one_cent: false, unpriced_models: [] };
export const LONG_COPY = Array.from({ length: 12 }, (_, i) => `Line ${i + 1}: your bank said no, and it was not about you.`).join("\n");

export function today(over = {}) {
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

export const VIDEOS = { ok: true, count: 2, limit: 50, offset: 0, hasMore: false, items: [
  { id: "v84", ad_id: "84", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T01:45:25Z", updated_at: "2026-09-24T07:55:11Z", approval_expires_at: "2026-09-27T05:45:21Z", status_means: "waiting on Chris" },
  { id: "v86", ad_id: "86", take_no: 1, status: "awaiting_approval", created_at: "2026-09-24T22:08:52Z", updated_at: "2026-09-24T23:39:26Z", approval_expires_at: "2026-09-27T23:39:25Z", status_means: "waiting on Chris" },
] };
export const NO_VIDEOS = { ok: true, count: 0, limit: 50, offset: 0, hasMore: false, items: [] };

/**
 * openToday(screens) -> an open(opts) function for one test file's shared browser.
 * opts: t (the /api/marketing/today answer), videos ([body, status]), offer ([body, status], the answer to
 * GET /api/marketing/offer/generate; omitted = a 404 with no offer on file), wait (a selector).
 */
export function todayOpener(screens) {
  return async function openToday({ t = today(), videos = [VIDEOS, 200], offer = null, viewport, wait = "#flywheelList li[data-stage]", now = NOW } = {}) {
    const log = { today: 0, videos: 0, offer: 0 };
    const handlers = {
      "/api/marketing/today": async (route) => { log.today += 1; return json(route, t); },
      "/api/ad-videos": async (route) => { log.videos += 1; return json(route, videos[0], videos[1]); },
    };
    if (offer) {
      handlers["/api/marketing/offer/generate"] = async (route) => { log.offer += 1; return json(route, offer[0], offer[1]); };
    }
    const before = async (page) => { await page.clock.install({ time: new Date(now) }); };
    const opened = await screens.open(PAGE, { session: OWNER, handlers, before, ...(viewport ? { viewport } : {}) });
    await opened.page.waitForSelector(wait);
    return { ...opened, log };
  };
}

export const stageRow = (page, key) => page.locator(`#flywheelList li[data-stage="${key}"]`);
export const chipOf = async (page, key) => (await stageRow(page, key).locator(".chip").first().innerText()).trim();
