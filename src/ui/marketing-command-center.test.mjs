// The Marketing Command Center's own rules: what it reads, what it sends, and
// the words it shows. public/app/marketing-command-center.js puts every rule
// that turns data into words on window.FHMarketingCC, so this file runs the
// real script in node:vm (same pattern as src/training/ramp-quizzes.test.mjs)
// with no browser and no server.
//
// The fixtures are shaped like the two back ends this page reads:
//   GET  marketing/today           — M10, api/marketing/today.mjs
//   GET/POST marketing/offer/generate — M12, api/marketing/offer/generate.mjs
//
// The two promises this screen makes, and the tests that hold it to them:
//   1. NEVER FAKE A NUMBER. Null is "unknown", never $0 (CLAUDE.md §12).
//   2. EVERY ACTION ANSWERS BACK IN PLAIN WORDS. No raw status code reaches
//      the screen (UI-STANDARDS §6.3).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { OFFER_TYPES } from "../compliance/screen.mjs";
import { STAGES } from "../../scripts/flywheel/status.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const SRC = fs.readFileSync(path.join(APP, "marketing-command-center.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "marketing-command-center.html"), "utf8");

function load() {
  const ctx = createContext({ console });
  runInContext(SRC, ctx);
  return ctx.FHMarketingCC;
}

const NOW = Date.parse("2026-10-05T19:00:00Z");
const HOUSE = "11111111-2222-4333-8444-555555555555";

const STAGE_ROWS = [
  { n: 1, key: "avatar", label: "avatar", state: "READY", approved: true, status: "ready approved", why: "133 quotes", reasons: [] },
  { n: 2, key: "ad-research", label: "ad research", state: "READY", approved: false, status: "ready not reviewed", why: "8 ads", reasons: [] },
  { n: 3, key: "offer", label: "offer", state: "FAILED", approved: false, status: "FAILED", why: "did not report guarantees", reasons: ["did not report guarantees"] },
  { n: 4, key: "copy", label: "copy", state: "FAILED", approved: false, status: "FAILED", why: "did not report distinctReasons", reasons: ["did not report distinctReasons"] },
  { n: 5, key: "ad-strategy", label: "ad strategy", state: "BLOCKED", approved: false, status: "BLOCKED", why: "waiting on offer and copy", reasons: ["waiting on offer and copy"] },
  { n: 6, key: "spend", label: "spend", state: "MISSING", approved: false, status: "MISSING", why: "has not been run yet", reasons: ["has not been run yet"] }
];

function check(key, ok) { return { key, ok, label: key, missing: ok ? null : `${key} missing` }; }

/* GET marketing/today, as api/marketing/today.mjs answers it. */
function today(overrides = {}) {
  return {
    ok: true,
    as_of: "2026-10-05T19:00:00.000Z",
    today: "2026-10-05",
    timezone: "America/Phoenix",
    waiting: [],
    flywheel: { campaigns: [{ campaign: "partner", stages: STAGE_ROWS, advice: "2 stages need re-running. Do them in order: 3, then 4." }] },
    copy: {
      partner_id: HOUSE,
      pieces: [
        { id: "a1", copy_text: "Your bank said no. Here is why.", compliance_state: "passed", blocked_reasons: [], created_at: "2026-10-05T18:00:00Z" },
        { id: "a2", copy_text: "Guaranteed approval!", compliance_state: "blocked",
          blocked_reasons: [{ code: "guarantee", rule_set: "funding", message: "Funding ads may not promise approval." }],
          created_at: "2026-10-04T18:00:00Z" }
      ],
      jobs: [{ id: "j1", status: "failed", error: "no active provider configured for org x", created_at: "2026-09-17T10:00:00Z" }]
    },
    copy_ready: {
      ready: true, partner_id: HOUSE,
      checks: [check("marketing_switch", true), check("copy_provider", true), check("anthropic_key", true),
        { ...check("writing_budget", true), used: 1000, cap: 250000 }],
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
    ...overrides
  };
}

describe("reading GET marketing/today", () => {
  test("the numbers, the house account and the as-of time come from M10's keys", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    assert.equal(v.loaded, true);
    assert.equal(v.partnerId, HOUSE);
    assert.equal(v.spend7, 123456);
    assert.equal(v.spendPrev7, 100000);
    assert.equal(v.spend30, 500000);
    assert.equal(v.spendToday, 0);
    assert.equal(v.days30, 12);
    assert.equal(v.asOf, "2026-10-05T07:01:30Z", "as of = when the ad numbers were saved, not when the page asked");
    assert.equal(v.latestMetricsDate, "2026-10-04");
    assert.equal(v.copyReady.ready, true);
    assert.equal(v.copyReady.switchOn, true);
    assert.equal(v.copyReady.budget, true);
  });

  test("camelCase keys read the same as snake_case", () => {
    const cc = load();
    const camel = {
      ok: true,
      lastSync: { metricsSyncedAt: "2026-10-05T07:01:30Z", latestMetricsDate: "2026-10-04" },
      copyReady: { ready: true, partnerId: HOUSE, checks: [{ key: "marketing_switch", ok: true }] },
      spend: { windows: { last7Days: { spendCents: 123456, daysWithData: 7 }, prior7Days: { spendCents: 100000 }, last30Days: { spendCents: 500000 } } }
    };
    const a = cc.normalizeToday(today());
    const b = cc.normalizeToday(camel);
    for (const k of ["asOf", "partnerId", "spend7", "spendPrev7", "spend30", "latestMetricsDate"]) {
      assert.equal(a[k], b[k], `${k} differs between the two spellings`);
    }
  });

  test("only the five flywheel steps are kept, in order, from the partner campaign", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    assert.equal(v.campaign, "partner");
    assert.deepEqual([...v.stages.map((s) => s.key)], ["avatar", "ad-research", "offer", "copy", "ad-strategy"]);
    const checkerKeys = STAGES.filter((s) => s.n <= 5).map((s) => s.key);
    assert.deepEqual([...cc.FIVE], checkerKeys, "the five keys are the checker's own (scripts/flywheel/status.mjs)");
  });

  test("a failed read leaves every number unknown and the page not loaded", () => {
    const cc = load();
    const v = cc.normalizeToday(null);
    assert.equal(v.loaded, false);
    for (const k of ["spend7", "spendPrev7", "spend30", "spendToday", "partnerId", "asOf"]) assert.equal(v[k], null, k);
  });

  test("a 200 with none of the keys is loaded, and still invents nothing", () => {
    const cc = load();
    const v = cc.normalizeToday({ ok: true, count: 0, items: [] });
    assert.equal(v.loaded, true);
    assert.equal(v.spend7, null);
    assert.equal(v.pieces.length, 0);
    assert.equal(v.stages.length, 0);
    assert.equal(v.copyReady.switchOn, null);
  });
});

describe("never fake a number", () => {
  test("null money is 'unknown'; a real zero is $0", () => {
    const cc = load();
    assert.equal(cc.money(null), "unknown");
    assert.equal(cc.money(undefined), "unknown");
    assert.equal(cc.money(""), "unknown");
    assert.equal(cc.money(0), "$0");
    assert.equal(cc.money(123456), "$1,235");
    assert.equal(cc.money(4550), "$45.50");
  });

  test("the spend tiles print 'unknown', not $0, when a window has no saved days", () => {
    const cc = load();
    const t = today();
    for (const w of Object.values(t.spend.windows)) { w.spend_cents = null; w.ad_days = 0; w.days_with_data = 0; }
    const v = cc.normalizeToday(t);
    const seven = cc.renderSpendTile(v, 7, NOW);
    const thirty = cc.renderSpendTile(v, 30, NOW);
    assert.match(seven, /<span class="vl">unknown<\/span>/);
    assert.match(thirty, /<span class="vl">unknown<\/span>/);
    assert.match(thirty, /Today so far: unknown\./);
    assert.doesNotMatch(seven + thirty, /\$0/);
    assert.match(seven, /No number for the 7 days before\./);
  });

  test("the spend part not live yet: every spend number is unknown", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ spend: null, waiting: [{ part: "spend", reason: "The ad_metrics_daily table is not in the database yet." }] }));
    assert.equal(v.spend7, null);
    assert.match(cc.renderSpendTile(v, 7, NOW), /<span class="vl">unknown<\/span>/);
  });

  test("a window with some days missing says so", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    assert.match(cc.renderSpendTile(v, 30, NOW), /Numbers saved for 12 of 30 days\./);
    assert.doesNotMatch(cc.renderSpendTile(v, 7, NOW), /Numbers saved for/);
  });

  test("every spend number has a comparison, said in words", () => {
    const cc = load();
    assert.equal(cc.compare(123456, 100000, "7 days"), "Up 23% from $1,000 the 7 days before.");
    assert.equal(cc.compare(50000, 100000, "7 days"), "Down 50% from $1,000 the 7 days before.");
    assert.equal(cc.compare(100000, 100000, "7 days"), "About the same as the 7 days before ($1,000).");
    assert.equal(cc.compare(500, 0, "7 days"), "Up from $0 the 7 days before.");
    assert.equal(cc.compare(500000, null, "30 days"), "No number for the 30 days before.");
    assert.equal(cc.compare(null, 100000, "7 days"), "The 7 days before: $1,000.");
  });

  test("the 'as of' time is relative under a day, a date after, unknown when missing", () => {
    const cc = load();
    assert.equal(cc.when("2026-10-05T17:00:00Z", NOW).text, "2 hours ago");
    assert.equal(cc.when("2026-10-05T18:59:30Z", NOW).text, "just now");
    assert.match(cc.when("2026-10-01T07:01:00Z", NOW).text, /^(Sep 30|Oct 1), /);
    assert.equal(cc.when(null, NOW).text, "unknown");
    assert.equal(cc.when("not a date", NOW).text, "unknown");
    assert.ok(cc.when("2026-10-05T17:00:00Z", NOW).title.length > 0, "exact time goes in the tooltip");
    assert.equal(cc.dayWords("2026-10-04"), "Oct 4");
  });

  test("machine parts: unknown is never counted as ready", () => {
    const cc = load();
    const t = today();
    t.copy_ready.checks = [check("marketing_switch", true), check("anthropic_key", false)];
    const v = cc.normalizeToday(t);
    const parts = cc.deriveParts(v, NOW);
    assert.deepEqual([...parts.map((p) => p.label)], [
      "Ad numbers from Meta", "Marketing switch for the Fundhub house account", "Copy writer set up",
      "AI key for writing", "Writing budget this month", "Flywheel files"
    ]);
    assert.deepEqual([...parts.map((p) => p.ready)], [true, true, null, false, null, true]);
    const tile = cc.renderPartsTile(v, NOW);
    assert.match(tile, />3 of 6</);
    assert.match(tile, /Not ready: AI key for writing\./);
  });

  test("a Meta save older than two days is not ready, and says so", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ last_sync: { meta_synced_at: "2026-10-01T07:01:00Z", metrics_synced_at: "2026-10-01T07:01:00Z", latest_metrics_date: "2026-09-30" } }));
    const meta = cc.deriveParts(v, NOW)[0];
    assert.equal(meta.ready, false);
    assert.match(meta.note, /Numbers run through Sep 30\. It should save every day\./);
  });

  test("Meta never synced, and a missing house account, are both named", () => {
    const cc = load();
    const t = today({ last_sync: { meta_synced_at: null, metrics_synced_at: null, latest_metrics_date: null } });
    t.copy_ready = { ready: false, partner_id: null, checks: [check("house_partner", false)], missing: ["x"] };
    t.copy = { partner_id: null, pieces: [], jobs: [] };
    const parts = cc.deriveParts(cc.normalizeToday(t), NOW);
    assert.equal(parts[0].note, "Meta has never sent numbers for this company.");
    assert.ok(parts.some((p) => p.label === "Fundhub house account" && p.ready === false));
  });

  test("a part whose table has not shipped says it is not live yet", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ copy_ready: { ready: null, partner_id: HOUSE, checks: [], missing: [] },
      waiting: [{ part: "copy_ready", reason: "The partner_module_settings table is not in the database yet." }] }));
    const sw = cc.deriveParts(v, NOW)[1];
    assert.equal(sw.ready, null);
    assert.equal(sw.note, "This part is not live yet. It turns on with the next update.");
  });
});

describe("flywheel and what waits on Chris", () => {
  test("each checker state reads as plain words", () => {
    const cc = load();
    const v = cc.normalizeToday(today());
    assert.deepEqual([...v.stages.map((s) => cc.stageWord(s).word)],
      ["Done", "Needs your OK", "Needs a redo", "Needs a redo", "Waiting"]);
    assert.equal(cc.stageWord(v.stages[0]).why, "133 quotes.");
  });

  test("code names in a reason become words", () => {
    const cc = load();
    assert.equal(cc.plainReasons(["did not report distinctReasons"]), "Did not report distinct reasons.");
    assert.equal(cc.plainReasons(["did not report guarantees"]), "Did not report guarantees.");
    assert.equal(cc.plainReasons([]), "");
  });

  test("waiting on you is read off the flywheel rows only", () => {
    const cc = load();
    const v = cc.normalizeToday(today({ waiting: [{ part: "spend", reason: "No ad numbers are saved for the last 30 days." }] }));
    assert.deepEqual([...cc.deriveWaiting(v).map((w) => w.what)], [
      "Read and approve the ad research step",
      "Redo the offer step",
      "Redo the copy step"
    ], "M10's `waiting` names machine parts, not Chris's to-do list");
  });

  test("an empty day says nothing is waiting; no flywheel files says so", () => {
    const cc = load();
    const empty = cc.normalizeToday(today({ flywheel: { campaigns: [{ campaign: "partner", stages: [], advice: null }] } }));
    assert.match(cc.renderWaiting(empty), /Nothing is waiting on you right now\./);
    assert.match(cc.renderFlywheel(empty), /No flywheel steps are on file yet\./);
    const none = cc.normalizeToday(today({ flywheel: null }));
    assert.match(cc.renderFlywheel(none), /not on this server yet/);
  });

  test("the flywheel card shows the checker's advice line", () => {
    const cc = load();
    assert.match(cc.renderFlywheel(cc.normalizeToday(today())), /Do them in order: 3, then 4\./);
  });
});

describe("Write ad copy", () => {
  function fakeApi(answers) {
    const calls = [];
    const api = (p, init) => {
      calls.push({ path: p, init });
      const a = answers[p];
      const out = typeof a === "function" ? a(init) : a;
      return Promise.resolve(out || { status: 404, body: { ok: false, error: "not_found", path: p } });
    };
    return { api, calls };
  }
  const SAVED = { status: 200, body: { ok: true, created: true, job: { id: "job-9" }, provider_ready: true } };

  test("the request is the shape api/creative/generate.mjs accepts", () => {
    const cc = load();
    const body = cc.copyRequest(HOUSE, "  turned down by the bank  ", "funding", "k1");
    assert.equal(body.partner_id, HOUSE);
    assert.equal(body.asset_kind, "copy");
    assert.equal(body.idempotency_key, "k1");
    assert.equal(body.spec.assetKind, "copy", "the runner resolves the provider from spec.assetKind");
    assert.equal(body.spec.offerType, "funding", "the ad rules check reads spec.offerType off the job");
    assert.equal(body.spec.prompt, "turned down by the bank");
    for (const t of cc.OFFER_TYPES) assert.ok(OFFER_TYPES.has(t), `${t} is not a type the server accepts`);
    assert.equal(cc.OFFER_TYPES.length, OFFER_TYPES.size);
  });

  test("a fresh batch name every press, so a second press is a second ad", () => {
    const cc = load();
    const a = cc.newKey(NOW, 0.123456789);
    const b = cc.newKey(NOW + 1000, 0.987654321);
    assert.match(a, /^mcc-copy-\d{14}-\d{6}$/);
    assert.notEqual(a, b);
  });

  test("success: generate, then run, then show the words and the check result", async () => {
    const cc = load();
    const { api, calls } = fakeApi({
      "/api/creative/generate": SAVED,
      "/api/creative/run": { status: 200, body: { ok: true, ran: 1, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", copy_text: "Turned down? Here is why.", compliance_state: "passed" }] }
      ] } }
    });
    const out = await cc.writeAdCopy({ api, now: () => NOW, rand: () => 0.5 }, cc.normalizeToday(today()), "turned down by the bank", "funding");
    assert.deepEqual(calls.map((c) => c.path), ["/api/creative/generate", "/api/creative/run"]);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.body.partner_id, HOUSE, "the house id comes from copy_ready.partner_id");
    assert.equal(calls[1].init.body.partner_id, HOUSE);
    assert.equal(out.tone, "ok");
    assert.match(out.message, /Here is your new ad copy/);
    assert.equal(out.pieces.length, 1);
    assert.equal(out.pieces[0].text, "Turned down? Here is why.");
  });

  test("a stopped ad shows the rule's own reason", async () => {
    const cc = load();
    const { api } = fakeApi({
      "/api/creative/generate": SAVED,
      "/api/creative/run": { status: 200, body: { ok: true, jobs: [
        { job_id: "job-9", status: "succeeded", assets: [{ id: "c1", copy_text: "Guaranteed!", compliance_state: "blocked",
          blocked_reasons: [], screen: { reasons: [{ code: "g", message: "Funding ads may not promise approval." }] } }] }
      ] } }
    });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.match(out.message, /stopped it/);
    assert.match(cc.renderPieces(out.pieces, NOW), /Funding ads may not promise approval\./);
  });

  test("refused at generate: nothing is run and the reason is plain", async () => {
    const cc = load();
    const { api, calls } = fakeApi({ "/api/creative/generate": { status: 403, body: { ok: false, error: "suite_off" } } });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.equal(calls.length, 1, "run must not be called after a refusal");
    assert.equal(out.tone, "err");
    assert.equal(out.message, "Marketing is switched off for the Fundhub house account, so nothing was written.");
  });

  test("no copy writer switched on: saved, not run, and said plainly", async () => {
    const cc = load();
    const { api, calls } = fakeApi({
      "/api/creative/generate": { status: 200, body: { ok: true, created: true, job: { id: "j" }, provider_ready: false } }
    });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.equal(calls.length, 1);
    assert.match(out.message, /no copy writer is switched on/);
  });

  test("the job failed: the reason is translated, never the raw error", async () => {
    const cc = load();
    const { api } = fakeApi({
      "/api/creative/generate": SAVED,
      "/api/creative/run": { status: 200, body: { ok: true, jobs: [
        { job_id: "job-9", status: "failed", error: "ANTHROPIC_API_KEY is not set — the copy provider cannot run." }
      ] } }
    });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.equal(out.tone, "err");
    assert.equal(out.message, "It did not work, and nothing was made. The AI key is missing.");
    assert.doesNotMatch(out.message, /ANTHROPIC_API_KEY/);
  });

  test("the run timed out: it says the job is still writing", async () => {
    const cc = load();
    const { api } = fakeApi({ "/api/creative/generate": SAVED, "/api/creative/run": { status: 504, body: null } });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.equal(out.tone, "wait");
    assert.match(out.message, /still writing/);
  });

  test("our job not in this run: it is in line, not lost", async () => {
    const cc = load();
    const { api } = fakeApi({ "/api/creative/generate": SAVED, "/api/creative/run": { status: 200, body: { ok: true, ran: 0, jobs: [] } } });
    const out = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "funding");
    assert.equal(out.tone, "wait");
    assert.match(out.message, /waiting in line/);
  });

  test("stopped before anything is sent", async () => {
    const cc = load();
    const { api, calls } = fakeApi({});
    const blank = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "   ", "funding");
    assert.match(blank.message, /Write a few words/);
    const noHouseT = today();
    noHouseT.copy_ready = { ready: false, partner_id: null, checks: [check("house_partner", false)], missing: [] };
    noHouseT.copy = { partner_id: null, pieces: [], jobs: [] };
    const noHouse = await cc.writeAdCopy({ api }, cc.normalizeToday(noHouseT), "x", "funding");
    assert.equal(noHouse.message, "This cannot write yet: the Fundhub house account is missing.");
    const offT = today();
    offT.copy_ready.checks = [check("marketing_switch", false), check("copy_provider", false), check("anthropic_key", true)];
    const off = await cc.writeAdCopy({ api }, cc.normalizeToday(offT), "x", "funding");
    assert.equal(off.message, "This cannot write yet: marketing is switched off for the Fundhub house account and no copy writer is set up.");
    const badType = await cc.writeAdCopy({ api }, cc.normalizeToday(today()), "x", "mortgages");
    assert.match(badType.message, /Pick what we are selling/);
    const notLoaded = await cc.writeAdCopy({ api }, cc.normalizeToday(null), "x", "funding");
    assert.match(notLoaded.message, /have not loaded yet/);
    assert.equal(calls.length, 0, "nothing may be sent when the input is not usable");
  });

  test("unknown setup is not treated as 'no'", () => {
    const cc = load();
    assert.equal(cc.setupBlock({ switchOn: null, provider: null, anthropicKey: null }), null);
    const line = cc.setupLine(cc.normalizeToday(today({ copy_ready: { ready: null, partner_id: HOUSE, checks: [] } })));
    assert.equal(line.bad, false);
  });
});

describe("Write offer (M12)", () => {
  const OFFER_VIEW = {
    job_id: "o1", campaign: "partner", as_of: "2026-10-05", finished_at: "2026-10-05T18:30:00Z",
    offer: {
      oneSentence: "Know your number before you apply.", name: "Funding Roadmap", price: "$297",
      whyThisPrice: "", whatTheyGet: ["Your funding number", "A step-by-step plan"],
      guarantees: [{ name: "Roadmap guarantee", promise: "Money back if the plan is not clear." }],
      bonuses: ["Business Duplication Map"]
    },
    review_card: { whatThisDecided: "The price and the guarantee.", threeThingsToCheck: ["Price", "Guarantee", "Bonus"], notSureAbout: ["nothing"] }
  };

  test("before the offer writer ships, it says it is not ready", () => {
    const cc = load();
    const route404 = { status: 404, body: { ok: false, error: "not_found", path: "marketing/offer/generate" } };
    assert.equal(cc.summarizeOfferRead(route404).state, "notReady");
    assert.equal(cc.summarizeOfferStart(route404).message, "The offer writer is not ready yet. It turns on with the next update.");
    const tableNotLive = cc.summarizeOfferRead({ status: 200, body: { ok: true, ready: false, job: null, offer: null,
      message: "The offer writer is built, but its database table is not live yet. It turns on with the next ship." } });
    assert.equal(tableNotLive.state, "notReady");
    assert.match(tableNotLive.message, /not live yet/);
    const start503 = cc.summarizeOfferStart({ status: 503, body: { ok: false, error: "not_ready", message: "It turns on with the next ship." } });
    assert.equal(start503.notReady, true);
  });

  test("the newest saved offer reads into words, review card included", () => {
    const cc = load();
    const read = cc.summarizeOfferRead({ status: 200, body: { ok: true, ready: true, job: { id: "o1", status: "done" }, offer: OFFER_VIEW } });
    assert.equal(read.state, "ok");
    assert.equal(read.offer.name, "Funding Roadmap");
    assert.deepEqual([...read.offer.guarantees], ["Roadmap guarantee: Money back if the plan is not clear."]);
    assert.equal(read.offer.notSure.length, 0, "'nothing' is not shown as a worry");
    const html = cc.renderOfferLatest(read, NOW);
    for (const s of ["Funding Roadmap", "$297", "Know your number before you apply.", "A step-by-step plan", "Business Duplication Map", "The price and the guarantee."]) {
      assert.ok(html.includes(s), `offer card is missing "${s}"`);
    }
  });

  test("no offer yet says so", () => {
    const cc = load();
    const read = cc.summarizeOfferRead({ status: 200, body: { ok: true, ready: true, job: null, offer: null } });
    assert.match(cc.renderOfferLatest(read, NOW), /No offer has been written here yet\./);
  });

  test("pressing Write offer starts a run and the page follows it to the end", async () => {
    const cc = load();
    const calls = [];
    const api = (p, init) => {
      calls.push({ p, init });
      if (init && init.method === "POST") {
        return Promise.resolve({ status: 202, body: { ok: true, started: true, job: { id: "o2", status: "queued" },
          message: "Writing the offer. Six offers, four judges, one winner — this takes a few minutes." } });
      }
      return Promise.resolve({ status: 200, body: { ok: true, ready: true, job: { id: "o2", status: "done" }, offer: OFFER_VIEW } });
    };
    const start = await cc.startOffer({ api }, cc.normalizeToday(today()));
    assert.equal(calls[0].p, "/api/marketing/offer/generate");
    assert.deepEqual({ ...calls[0].init.body }, { campaign: "partner" });
    assert.equal(start.job.id, "o2");
    assert.match(start.message, /takes a few minutes/);
    const read = await cc.readOffer({ api }, "o2");
    assert.equal(calls[1].p, "/api/marketing/offer/generate?id=o2");
    const step = cc.offerPollStep(read);
    assert.equal(step.done, true);
    assert.equal(step.tone, "ok");
    assert.equal(step.offer.name, "Funding Roadmap");
  });

  test("a running offer keeps being asked about; a failed one stops with its reason", () => {
    const cc = load();
    const running = cc.offerPollStep(cc.summarizeOfferRead({ status: 200, body: { ok: true, ready: true, job: { id: "o2", status: "running" }, offer: null } }));
    assert.equal(running.done, false);
    const failed = cc.offerPollStep(cc.summarizeOfferRead({ status: 200, body: { ok: true, ready: true,
      job: { id: "o2", status: "failed", error: "The writer could not be started. Nothing was written." }, offer: null } }));
    assert.equal(failed.done, true);
    assert.equal(failed.tone, "err");
    assert.match(failed.message, /Nothing was written\./);
    assert.ok(cc.OFFER_POLL_MS * cc.OFFER_POLL_TRIES >= 15 * 60 * 1000, "the page waits at least as long as the 15-minute background run");
  });

  test("a refusal shows the offer writer's own plain sentence; signed out is worded here", () => {
    const cc = load();
    const noKey = cc.summarizeOfferStart({ status: 503, body: { ok: false, error: "no_model",
      message: "The writing robot is not set on this site (no Anthropic key), so nothing was started." } });
    assert.equal(noKey.tone, "err");
    assert.match(noKey.message, /nothing was started/);
    const out = cc.summarizeOfferStart({ status: 401, body: { ok: false, error: "unauthorized", message: "token expired" } });
    assert.equal(out.message, "You are signed out. Sign in and open this page again.");
  });
});

describe("plain words only", () => {
  test("no error sentence carries a raw status code or a server code word", () => {
    const cc = load();
    const cases = [
      { status: 0, transport: "net" }, { status: 401, body: { ok: false, error: "unauthorized" } },
      { status: 403, body: { ok: false, error: "forbidden" } }, { status: 404, body: { ok: false, error: "not_found" } },
      { status: 400, body: { ok: false, error: "partner_id_required" } }, { status: 500, body: { ok: false, error: "boom: relation x" } },
      { status: 502, body: null }, { status: 503, body: null }
    ];
    for (const what of ["today", "copy", "offer"]) {
      for (const res of cases) {
        const s = cc.plainError(res, what);
        assert.doesNotMatch(s, /\b(4\d\d|5\d\d)\b/, `"${s}" shows a status code`);
        assert.doesNotMatch(s, /_|boom|relation/, `"${s}" leaks a server word`);
        assert.match(s, /\.$/, `"${s}" is not a sentence`);
      }
    }
  });

  test("ad words from the server are escaped, never run as markup", () => {
    const cc = load();
    const html = cc.renderPieces([cc.normalizePiece({ copy_text: "<img src=x onerror=alert(1)>", compliance_state: "passed" })], NOW);
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /&lt;img/);
  });

  test("latest copy: empty says how to make the first one; tries show plain reasons", () => {
    const cc = load();
    const empty = cc.normalizeToday(today({ copy: { partner_id: HOUSE, pieces: [], jobs: [] } }));
    assert.match(cc.renderLatest(empty, NOW), /No ad copy yet\. Press Write ad copy to make the first one\./);
    const full = cc.renderLatest(cc.normalizeToday(today()), NOW);
    assert.match(full, /No copy writer is switched on for this account\./);
    assert.match(full, /Funding ads may not promise approval\./);
    assert.doesNotMatch(full, /no active provider configured/);
  });
});

describe("the page itself", () => {
  test("exactly one primary button, and it is Write ad copy (UI-STANDARDS §1)", () => {
    const primaries = HTML.match(/class="btn primary"/g) || [];
    assert.equal(primaries.length, 1);
    assert.match(HTML, /<button class="btn primary"[^>]*id="copyBtn"[\s\S]*?Write ad copy<\/span><\/button>/);
    assert.doesNotMatch(SRC, /btn primary/, "the script must not paint a second primary button");
  });

  test("it loads the shell and its own script, and carries the shared sidebar", () => {
    assert.match(HTML, /<script defer src="shell\.js"><\/script>/);
    assert.match(HTML, /<script defer src="marketing-command-center\.js"><\/script>/);
    assert.match(HTML, /<a class="navitem on" href="marketing-command-center\.html">/);
    assert.match(HTML, /class="logo inv"/);
  });

  test("the shell keeps it owner/admin only", () => {
    const shell = fs.readFileSync(path.join(APP, "shell.js"), "utf8");
    const owner = shell.match(/var OWNER_ADMIN_ONLY = \[([\s\S]*?)\];/);
    assert.ok(owner && owner[1].includes('"marketing-command-center.html"'),
      "marketing-command-center.html must be in OWNER_ADMIN_ONLY — marketing/today is owner/admin only");
  });

  test("the company name is spelled Fundhub", () => {
    assert.doesNotMatch(HTML + SRC, /FundHub|FUNDHUB|Fund Hub/);
  });
});
