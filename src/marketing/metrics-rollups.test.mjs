// Database-free tests for src/marketing/metrics-rollups.mjs (plan unit U32).
//
// The folds are pure, so every exact number the routes print is proved here
// against hand-built rows. What a fake cannot prove — that the SQL is valid
// Postgres, the columns exist, row security lets asStaff() see the rows, and the
// index plans — is proved in src/http/marketing-angles.pg.test.mjs,
// marketing-funnels-stats.pg.test.mjs and marketing-today.pg.test.mjs (CI).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  sumCash, lastDays, landingPage, resolveLabels, foldSpendByFunnel, funnelSpendRows,
  spendByFunnelView, angleRows, funnelStatRows, flowPageViews, numbersFor, stepRows,
  parseAngleNames, loadAngleNames, readScriptLabels, readAdSpend, readStuckJobs,
  readScriptsWaiting, FUNNEL_EVENT_NAMES, UNMAPPED_NAME, ROLLUP_DAYS
} from "./metrics-rollups.mjs";

const FUNNELS = [
  { key: "book_call", name: "Book a call", landing_url: "https://apply.fundhub.ai/watch", active: true },
  { key: "roadmap_147", name: "Roadmap", landing_url: "https://apply.fundhub.ai/roadmap", active: true },
  { key: "old_funnel", name: "Old", landing_url: "https://apply.fundhub.ai/order", active: false }
];

/* Five ads rows:
     a90   number 90, script says roadmap_147 + angle speed; its campaign says book_call
     a84   number 84, no script; campaign c1 → book_call; spine angle the_guarantee
     a84b  number 84 again, campaign c2 → roadmap_147 (so 84's LEADS are ambiguous)
     aU    no number, campaign c3 (not mapped); spine angle speed
     aX    no number, campaign c3, no angle */
const ADS = [
  { ad_row_id: "a90", ad_number: "90", spine_angle_key: null, campaign_external_id: "c1", campaign_funnel_key: "book_call" },
  { ad_row_id: "a84", ad_number: "84", spine_angle_key: "the_guarantee", campaign_external_id: "c1", campaign_funnel_key: "book_call" },
  { ad_row_id: "a84b", ad_number: "84", spine_angle_key: "the_guarantee", campaign_external_id: "c2", campaign_funnel_key: "roadmap_147" },
  { ad_row_id: "aU", ad_number: null, spine_angle_key: "speed", campaign_external_id: "c3", campaign_funnel_key: null },
  { ad_row_id: "aX", ad_number: null, spine_angle_key: null, campaign_external_id: "c3", campaign_funnel_key: null }
];
const SCRIPTS = [
  { ad_number: "90", funnel_key: "roadmap_147", angle_key: "speed" },
  { ad_number: "91", funnel_key: "book_call", angle_key: "the_sorting_hat" }   // a number with no ads row yet
];
const SPEND = [
  { ad_row_id: "a90", spend_cents: "10000", link_clicks: "40", ad_days: 2, link_click_days: 1 },
  { ad_row_id: "a84", spend_cents: "2000", link_clicks: "6", ad_days: 1, link_click_days: 1 },
  { ad_row_id: "a84b", spend_cents: "500", link_clicks: null, ad_days: 1, link_click_days: 0 },
  { ad_row_id: "aU", spend_cents: "7000", link_clicks: "14", ad_days: 1, link_click_days: 1 },
  { ad_row_id: "aX", spend_cents: "300", link_clicks: null, ad_days: 1, link_click_days: 0 }
];
/* Lead results per number, the way readAdNumbers hands them back. */
const LEADS = [
  { ad_number: "84", leads: 2, booked: 1, showed: 1, sales: 0, cash_cents: null, cash_unknown: 1 },
  { ad_number: "90", leads: 3, booked: 2, showed: 1, sales: 1, cash_cents: 114400, cash_unknown: 0 },
  { ad_number: "91", leads: 1, booked: 0, showed: 0, sales: 0, cash_cents: 0, cash_unknown: 0 },
  { ad_number: "95", leads: 0, booked: 0, showed: 0, sales: 0, cash_cents: 0, cash_unknown: 0 }
];
const NAMES = new Map([["speed", "Speed"], ["the_sorting_hat", "The Sorting Hat"]]);

describe("small helpers", () => {
  test("sumCash: null only when payments exist and none reported an amount", () => {
    assert.equal(sumCash([]), 0);
    assert.equal(sumCash([{ cash_cents: 0 }, { cash_cents: "14700" }]), 14700);
    assert.equal(sumCash([{ cash_cents: null }]), null);
    assert.equal(sumCash([{ cash_cents: null }, { cash_cents: 0 }]), null, "no known money, one unknown payment");
    assert.equal(sumCash([{ cash_cents: null }, { cash_cents: 500 }]), 500, "known money is kept; the unknown adds nothing");
  });

  test("lastDays: whole Arizona days, today included", () => {
    // 2026-10-06 05:30 UTC is 2026-10-05 22:30 in Arizona.
    assert.deepEqual(lastDays(ROLLUP_DAYS, new Date("2026-10-06T05:30:00Z")), { from: "2026-09-06", to: "2026-10-05" });
    assert.deepEqual(lastDays(7, new Date("2026-10-06T05:30:00Z")), { from: "2026-09-29", to: "2026-10-05" });
  });

  test("landingPage: the tracker's page form, fundhub.ai only", () => {
    assert.equal(landingPage("https://apply.fundhub.ai/watch"), "/watch");
    assert.equal(landingPage("https://apply.fundhub.ai/Roadmap/?utm_source=fb"), "/roadmap");
    assert.equal(landingPage("https://fundhub.ai/"), "/home");
    assert.equal(landingPage("https://apply.fundhub.ai/"), null);
    assert.equal(landingPage("https://example.com/watch"), null);
    assert.equal(landingPage("not a url"), null);
    assert.equal(landingPage(null), null);
  });

  test("FUNNEL_EVENT_NAMES: the tracker's own row names", () => {
    assert.ok(FUNNEL_EVENT_NAMES.includes("funnel.page"));
    assert.ok(FUNNEL_EVENT_NAMES.includes("funnel.click"));
    assert.ok(FUNNEL_EVENT_NAMES.includes("funnel.payment_result"));
    assert.ok(FUNNEL_EVENT_NAMES.every((n) => n.startsWith("funnel.")));
  });

  test("numbersFor: Today's money block from readTotals, ROAS = cash ÷ spend", () => {
    assert.deepEqual(
      numbersFor({ spend_cents: "61500", leads: 23, booked: 7, showed: 5, sales: 1, roadmaps: 4,
                   cash_cents: "158800", reported_cash_cents: "100000", impressions: 9 }),
      { spend_cents: 61500, leads: 23, booked: 7, showed: 5, sales: 1, roadmaps: 4,
        cash_cents: 158800, reported_cash_cents: 100000, roas: 2.5821 });
    const none = numbersFor({ spend_cents: null, leads: 0, booked: 0, showed: 0, sales: 0, roadmaps: 0,
                              cash_cents: 0, reported_cash_cents: 0 });
    assert.equal(none.spend_cents, null, "no ad-days: unknown, never 0");
    assert.equal(none.roas, null);
  });
});

describe("labels: which funnel, which angle", () => {
  const { byAd, byNumber } = resolveLabels(ADS, SCRIPTS);

  test("an ads row: the number's script first, else its own campaign's funnel and spine angle", () => {
    assert.deepEqual(byAd.get("a90"), { ad_number: "90", funnel_key: "roadmap_147", angle_key: "speed" });
    assert.deepEqual(byAd.get("a84"), { ad_number: "84", funnel_key: "book_call", angle_key: "the_guarantee" });
    assert.deepEqual(byAd.get("a84b"), { ad_number: "84", funnel_key: "roadmap_147", angle_key: "the_guarantee" });
    assert.deepEqual(byAd.get("aU"), { ad_number: null, funnel_key: null, angle_key: "speed" });
  });

  test("a number: the script first, else what all its ads rows agree on, never a guess between two", () => {
    assert.deepEqual(byNumber.get("90"), { funnel_key: "roadmap_147", angle_key: "speed" });
    assert.deepEqual(byNumber.get("84"), { funnel_key: null, angle_key: "the_guarantee" },
      "84's ads sit on two funnels' campaigns: its leads are not placed");
    assert.deepEqual(byNumber.get("91"), { funnel_key: "book_call", angle_key: "the_sorting_hat" },
      "a script with no ads row still names its funnel");
    assert.equal(byNumber.has("95"), false);
  });

  test("a script with no funnel_key falls back to the campaign", () => {
    const l = resolveLabels([ADS[1]], [{ ad_number: "84", funnel_key: null, angle_key: "speed" }]);
    assert.deepEqual(l.byAd.get("a84"), { ad_number: "84", funnel_key: "book_call", angle_key: "speed" });
  });
});

describe("spend by funnel", () => {
  const { byAd } = resolveLabels(ADS, SCRIPTS);

  test("each ads row's spend lands on its funnel; the rest is unmapped", () => {
    const f = foldSpendByFunnel({ byAd, spend: SPEND });
    assert.deepEqual(f.byFunnel.get("roadmap_147"), { spend_cents: 10500, link_clicks: 40, ad_days: 3 });
    assert.deepEqual(f.byFunnel.get("book_call"), { spend_cents: 2000, link_clicks: 6, ad_days: 1 });
    assert.deepEqual(f.unmapped, { spend_cents: 7300, link_clicks: 14, ad_days: 2 });
    assert.equal(f.total_ad_days, 6);
  });

  test("rows: active funnels plus placed ones, biggest spend first; an inactive funnel with nothing placed is left out", () => {
    const r = funnelSpendRows({ byAd, spend: SPEND, funnels: FUNNELS });
    assert.deepEqual(r.rows.map((x) => [x.funnel_key, x.name, x.spend_cents]),
      [["roadmap_147", "Roadmap", 10500], ["book_call", "Book a call", 2000]]);
    assert.equal(r.unmapped.spend_cents, 7300);
  });

  test("Today's view: an Unmapped row only when some saved spend belongs to no funnel", () => {
    const view = spendByFunnelView(funnelSpendRows({ byAd, spend: SPEND, funnels: FUNNELS }));
    assert.deepEqual(view.at(-1), { funnel_key: null, name: UNMAPPED_NAME, spend_cents: 7300 });
    const placed = spendByFunnelView(funnelSpendRows({ byAd, spend: SPEND.slice(0, 3), funnels: FUNNELS }));
    assert.equal(placed.some((x) => x.funnel_key === null), false);
  });

  test("no saved ad-day at all: every funnel and unmapped are unknown (null), never 0", () => {
    const r = funnelSpendRows({ byAd, spend: [], funnels: FUNNELS });
    assert.deepEqual(r.rows.map((x) => x.spend_cents), [null, null]);
    assert.equal(r.unmapped.spend_cents, null);
    assert.deepEqual(spendByFunnelView(r), [
      { funnel_key: "book_call", name: "Book a call", spend_cents: null },
      { funnel_key: "roadmap_147", name: "Roadmap", spend_cents: null }
    ]);
  });

  test("a funnel with nothing placed is unknown while some spend is unmapped, and a known 0 when all spend is placed", () => {
    const onlyRoadmap = SPEND.filter((s) => s.ad_row_id === "a90");
    const allPlaced = funnelSpendRows({ byAd, spend: onlyRoadmap, funnels: FUNNELS });
    assert.equal(allPlaced.rows.find((x) => x.funnel_key === "book_call").spend_cents, 0);
    assert.equal(allPlaced.unmapped.spend_cents, 0);
    const someUnmapped = funnelSpendRows({ byAd, spend: [SPEND[0], SPEND[4]], funnels: FUNNELS });
    assert.equal(someUnmapped.rows.find((x) => x.funnel_key === "book_call").spend_cents, null);
  });

  test("Chris's live start: both funnels with no campaigns mapped → all spend unmapped, said honestly", () => {
    const bare = resolveLabels(ADS.map((a) => ({ ...a, campaign_funnel_key: null })), []);
    const r = funnelSpendRows({ byAd: bare.byAd, spend: SPEND, funnels: FUNNELS });
    assert.deepEqual(r.rows.map((x) => x.spend_cents), [null, null]);
    assert.equal(r.unmapped.spend_cents, 19800);
  });

  test("a funnel key a script names that is not a funnel row shows under its key", () => {
    const l = resolveLabels([ADS[0]], [{ ad_number: "90", funnel_key: "slo_old", angle_key: null }]);
    const r = funnelSpendRows({ byAd: l.byAd, spend: [SPEND[0]], funnels: FUNNELS });
    assert.deepEqual(r.rows[0], { key: "slo_old", funnel_key: "slo_old", name: "slo_old", spend_cents: 10000, link_clicks: 40, ad_days: 2 });
  });
});

describe("by angle", () => {
  const labels = resolveLabels(ADS, SCRIPTS);
  const rows = angleRows({ ...labels, spend: SPEND, leads: LEADS, angleNames: NAMES });
  const by = Object.fromEntries(rows.map((r) => [r.angle_key, r]));

  test("one row per angle with spend or leads; names from angles.json, else the key", () => {
    assert.deepEqual(rows.map((r) => r.angle_key), ["speed", "the_guarantee", "the_sorting_hat"]);
    assert.equal(by.speed.name, "Speed");
    assert.equal(by.the_guarantee.name, "the_guarantee", "not in the names file: the key");
  });

  test("speed: ad 90 (script) plus a numberless ads row (spine); leads from 90 only", () => {
    assert.deepEqual(by.speed, {
      angle_key: "speed", name: "Speed", spend_cents: 17000, ads: 2,
      leads: 3, booked: 2, sales: 1, cash_cents: 114400, roas: 6.7294
    });
  });

  test("the_guarantee: ad 84's two ads rows are one ad; its only payment had no amount → cash unknown", () => {
    assert.deepEqual(by.the_guarantee, {
      angle_key: "the_guarantee", name: "the_guarantee", spend_cents: 2500, ads: 1,
      leads: 2, booked: 1, sales: 0, cash_cents: null, roas: null
    });
  });

  test("a number with leads and no spend: spend unknown (null), ROAS unknown", () => {
    assert.deepEqual(by.the_sorting_hat, {
      angle_key: "the_sorting_hat", name: "The Sorting Hat", spend_cents: null, ads: 1,
      leads: 1, booked: 0, sales: 0, cash_cents: 0, roas: null
    });
  });

  test("spend with no angle and leads with no number are in no row", () => {
    const total = rows.reduce((t, r) => t + (r.spend_cents ?? 0), 0);
    assert.equal(total, 19500, "aX's $3.00 has no angle");
  });
});

describe("funnel stats", () => {
  const labels = resolveLabels(ADS, SCRIPTS);
  const steps = stepRows([
    { page: "/watch", name: "funnel.page", events: 30 },
    { page: "/watch", name: "funnel.click", events: 12 },
    { page: "/roadmap", name: "funnel.page", events: 50 },
    { page: "/roadmap-book", name: "funnel.page", events: 8 },
    { page: "/roadmap", name: "funnel.video", events: 5 }
  ]);
  const out = funnelStatRows({ ...labels, spend: SPEND, leads: LEADS, funnels: FUNNELS, steps });
  const by = Object.fromEntries(out.rows.map((r) => [r.funnel_key, r]));

  test("roadmap_147: spend, landing page views, both step rates, and ad 90's results", () => {
    assert.deepEqual(by.roadmap_147, {
      funnel_key: "roadmap_147", name: "Roadmap", spend_cents: 10500, page_views: 50,
      click_to_page: 1.25, page_to_lead: 0.06, leads: 3, booked: 2, showed: 1, sales: 1,
      cash_cents: 114400, roas: 10.8952
    });
  });

  test("book_call: ad 84's leads are ambiguous (two funnels) and stay out; 91's lead is placed by its script", () => {
    assert.deepEqual(by.book_call, {
      funnel_key: "book_call", name: "Book a call", spend_cents: 2000, page_views: 30,
      click_to_page: 5, page_to_lead: 0.0333, leads: 1, booked: 0, showed: 0, sales: 0,
      cash_cents: 0, roas: 0
    });
  });

  test("unmapped spend; rows sorted by spend", () => {
    assert.equal(out.unmapped_spend_cents, 7300);
    assert.deepEqual(out.rows.map((r) => r.funnel_key), ["roadmap_147", "book_call"]);
  });

  test("a landing page the tracker does not run on reads page views unknown, and so do its rates", () => {
    const f = [{ key: "book_call", name: "Book a call", landing_url: "https://example.com/x", active: true }];
    const r = funnelStatRows({ ...labels, spend: SPEND, leads: LEADS, funnels: f, steps }).rows
      .find((x) => x.funnel_key === "book_call");
    assert.equal(r.page_views, null);
    assert.equal(r.click_to_page, null);
    assert.equal(r.page_to_lead, null);
  });

  test("a tracked landing page with no visits is a real 0; the rate over it is null", () => {
    const r = funnelStatRows({ ...labels, spend: SPEND, leads: LEADS, funnels: FUNNELS, steps: [] }).rows
      .find((x) => x.funnel_key === "roadmap_147");
    assert.equal(r.page_views, 0);
    assert.equal(r.click_to_page, 0);
    assert.equal(r.page_to_lead, null);
  });

  test("flowPageViews: each funnel's landing page once; null when none is tracked", () => {
    assert.equal(flowPageViews(FUNNELS, steps), 30 + 50 + 0, "/order is the inactive funnel's landing page, 0 visits");
    assert.equal(flowPageViews([{ key: "x", landing_url: "https://example.com/" }], steps), null);
    assert.equal(flowPageViews([], steps), null);
  });

  test("stepRows: page views, clicks and every other event, by page in funnel order", () => {
    assert.deepEqual(steps.map((s) => [s.page, s.funnel, s.step]),
      [["/roadmap", "roadmap", 1], ["/roadmap-book", "roadmap", 2], ["/watch", "watch", 1]]);
    assert.deepEqual(steps[0], { page: "/roadmap", funnel: "roadmap", step: 1, page_views: 50, clicks: 0, events: { video: 5 } });
    assert.equal(steps[2].clicks, 12);
  });
});

describe("angle names", () => {
  test("parseAngleNames: {key, name} only; a broken file gives no names, never a crash", () => {
    assert.deepEqual([...parseAngleNames('[{"key":"a","name":"A"},{"key":"b"},null]')], [["a", "A"]]);
    assert.equal(parseAngleNames("[{").size, 0);
    assert.equal(parseAngleNames('{"key":"a"}').size, 0);
  });

  test("loadAngleNames reads the repo's marketing/ads/angles.json", () => {
    const names = loadAngleNames();
    assert.equal(names.get("the_conveyor_belt"), "The Conveyor Belt");
    assert.ok(names.size >= 20);
    assert.equal(loadAngleNames(["/nowhere-at-all"]).size, 0);
  });
});

describe("the SQL readers (fake tx: the call shape, not the SQL)", () => {
  const recorder = (rows = []) => {
    const calls = [];
    return { calls, tx: { query: async (sql, params) => { calls.push({ sql, params }); return { rows }; } } };
  };

  test("every reader refuses to run without the asStaff() transaction", async () => {
    await assert.rejects(() => readAdSpend(null, { orgId: "o", from: "2026-09-01", to: "2026-09-30" }), /asStaff/);
    await assert.rejects(() => readScriptsWaiting(undefined, { orgId: "o" }), /asStaff/);
  });

  test("readAdSpend refuses a backwards or malformed window", async () => {
    const { tx } = recorder();
    await assert.rejects(() => readAdSpend(tx, { orgId: "o", from: "2026-09-30", to: "2026-09-01" }), /from and to/);
    await assert.rejects(() => readAdSpend(tx, { orgId: "o", from: "Sep 1", to: "2026-09-01" }), /from and to/);
  });

  test("readScriptLabels asks nothing when there is no number, and sends each number once", async () => {
    const empty = recorder();
    assert.deepEqual(await readScriptLabels(empty.tx, { orgId: "o", adNumbers: [null, ""] }), []);
    assert.equal(empty.calls.length, 0);
    const r = recorder([{ ad_number: "90", funnel_key: "roadmap_147", angle_key: null }]);
    const rows = await readScriptLabels(r.tx, { orgId: "o", adNumbers: ["90", "90", "84"] });
    assert.deepEqual(r.calls[0].params, ["o", ["90", "84"]]);
    assert.deepEqual(rows, [{ ad_number: "90", funnel_key: "roadmap_147", angle_key: null }]);
  });

  test("readStuckJobs never lists 'offer' jobs and hands back ISO times", async () => {
    const at = new Date("2026-10-05T12:40:00Z");
    const r = recorder([{ id: "j1", kind: "write_slot", error: "Stopped.", since: at }]);
    const rows = await readStuckJobs(r.tx, { orgId: "o" });
    assert.match(r.calls[0].sql, /kind <> 'offer'/);
    assert.match(r.calls[0].sql, /status = 'failed'/);
    assert.deepEqual(r.calls[0].params, ["o", 20]);
    assert.deepEqual(rows, [{ id: "j1", kind: "write_slot", error: "Stopped.", since: at.toISOString() }]);
  });

  test("readScriptsWaiting passes the clock in, so a batch released later is not counted yet", async () => {
    const r = recorder([{ ready: "3", flagged: "1" }]);
    const now = new Date("2026-10-05T14:00:00Z");
    assert.deepEqual(await readScriptsWaiting(r.tx, { orgId: "o", now }), { ready: 3, flagged: 1 });
    assert.deepEqual(r.calls[0].params, ["o", now.toISOString()]);
    assert.match(r.calls[0].sql, /b\.release_at <= \$2::timestamptz/);
  });
});
