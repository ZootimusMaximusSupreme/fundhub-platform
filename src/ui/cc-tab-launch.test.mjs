// The Command Center's Launch tab (public/app/cc-tab-launch.js), run in
// node:vm with no browser and no server — the same pattern as
// src/ui/marketing-command-center.test.mjs.
//
// The promises this tab makes, and the tests that hold it to them:
//   1. TURN ON IS ONE AD. It posts campaigns/write with action 'resume_ad' and
//      OUR ads.id, nothing else — never the campaign-level actions, never a
//      Meta id (design §5 rule 2, spec §2 item 6, plan U39 acceptance 3).
//   2. BUDGET BEFORE EVERY TURN ON. The question names the ad, the ad set and
//      its daily budget; while the budget is unknown the button is off and
//      says why, and nothing is sent (design §5 rule 4).
//   3. LOADS ARE PAUSED. Load to Meta and Load all approved post only to
//      marketing/meta/load; Load all asks first (design §5 rule 1).
//   4. NO FAKE NUMBERS. NULL prints "unknown", never $0 (CLAUDE.md §12).
//
// Fixtures come from the API contract (src/marketing/api-contract.mjs), so a
// change to the routes' shapes breaks this file, not the screen.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import {
  CONTRACT, exampleResponse, assertRequestMatchesContract
} from "../marketing/api-contract.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(HERE, "../../public/app/cc-tab-launch.js");
const SRC = fs.readFileSync(FILE, "utf8");

function load(extra = {}) {
  const ctx = createContext({ console, Promise, setTimeout, clearTimeout, Intl, Date, ...extra });
  runInContext(SRC, ctx);
  return ctx;
}

const L = load().FundhubCCLaunch;

const AD_ROW = "00000000-0000-4000-8000-000000000801";
const VIDEO_A = "00000000-0000-4000-8000-000000000701";
const VIDEO_B = "00000000-0000-4000-8000-000000000702";
const VIDEO_C = "00000000-0000-4000-8000-000000000703";
const META_AD = "120210000000000201";

/* GET marketing/meta/load-status as the contract shows it, with the loaded
   ad given a known daily budget (the key design §3.6 names). */
function statusWithBudget(cents = 10000) {
  const body = exampleResponse("GET marketing/meta/load-status");
  body.loads[0].ad_set = { ...body.loads[0].ad_set, name: "Roadmap broad", daily_budget_cents: cents };
  body.loads[0].angle = "Lenders read two files";
  body.loads[0].funnel_key = "roadmap_147";
  return body;
}

function approvedVideo(id, adId, extra = {}) {
  return { id, ad_id: adId, take_no: 1, video_kind: "ad", status: "approved", approved_at: "2026-10-13T20:01:00.000Z", ...extra };
}

/* A fake ctx: records every call, answers from a table, confirms on demand. */
function fakeCtx({ answers = {}, confirm = true } = {}) {
  const calls = [];
  const sheets = [];
  return {
    calls,
    sheets,
    api: async (method, p, body, opts) => {
      calls.push({ method, path: p, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)), opts });
      const a = answers[`${method} ${p.split("?")[0]}`];
      return typeof a === "function" ? a(body) : (a || { ok: true, status: 200, data: {} });
    },
    confirm: (sheet) => {
      sheets.push({ title: sheet.title, consequence: sheet.consequence, button: sheet.button });
      if (confirm === "promise") return Promise.resolve(true);
      if (confirm) sheet.onConfirm(); else sheet.onCancel();
      return undefined;
    },
    toast: () => {},
    go: () => {}
  };
}

function view(statusBody, approved = []) {
  return L.buildView({ loads: statusBody.loads, approved, asOf: statusBody.as_of });
}

describe("registration (docs/specs/command-center-tabs.md)", () => {
  test("queues the launch tab before the frame loads, with render, refresh and hide", () => {
    const ctx = load();
    assert.equal(ctx.FundhubCC._q.length, 1);
    const t = ctx.FundhubCC._q[0];
    assert.equal(t.id, "launch");
    assert.equal(t.label, "Launch");
    assert.equal(t.order, 6);
    for (const fn of ["render", "refresh", "hide"]) assert.equal(typeof t[fn], "function", fn);
  });

  test("uses the frame's real registerTab when the frame loaded first", () => {
    const got = [];
    const ctx = load({ FundhubCC: { registerTab: (t) => got.push(t) } });
    assert.equal(got.length, 1);
    assert.equal(got[0].id, "launch");
    assert.equal(ctx.FundhubCC._q, undefined);
  });
});

describe("the rows (GET marketing/meta/load-status + approved videos)", () => {
  test("every approved ad shows, loads first, then the ones never asked to load, by ad number", () => {
    const v = view(statusWithBudget(), [approvedVideo(VIDEO_A, "91"), approvedVideo(VIDEO_C, "90")]);
    assert.deepEqual([...v.rows.map((r) => r.label)], ["Ad 90", "Ad 91", "Ad 92"]);
    assert.equal(v.rows[0].state, "not_loaded", "never asked: from the approved list");
    assert.equal(v.rows[1].from, "load", "load-status wins over the approved list for the same video");
    assert.equal(v.headline, "3 approved, 1 loaded");
    assert.equal(v.on_line, "Loaded ads on now: 0");
  });

  test("a non-ad video (a testimonial) is never offered for Meta", () => {
    const v = view({ loads: [] }, [approvedVideo(VIDEO_C, "90", { video_kind: "testimonial" })]);
    assert.equal(v.rows.length, 0);
    assert.equal(v.empty, true);
  });

  test("plain reasons print as they come: the final video is not in storage yet", () => {
    const v = view(statusWithBudget());
    const refused = v.rows.find((r) => r.label === "Ad 92");
    assert.equal(refused.state_word, "Stopped");
    assert.deepEqual(refused.reasons, ["The final video is not in storage yet."]);
    assert.equal(refused.load_label, "Retry load");
    assert.equal(refused.turn_on.show, false, "Turn on only on a loaded ad");
  });

  test("a paused ad set and a paused campaign are flagged in words", () => {
    const v = view(statusWithBudget());
    const refused = v.rows.find((r) => r.label === "Ad 92");
    assert.ok(refused.flags.includes("Ad set is paused: nothing in it spends until the ad set is on."));
    assert.ok(refused.flags.includes("Campaign is paused: nothing in it spends until the campaign is on."));
  });

  test("a funnel with no ad set says to pick one in Settings", () => {
    const v = view({ loads: [{ ad_number: "93", ad_video_id: VIDEO_C, state: "refused", reasons: ["No default ad set for this funnel."], ad_set: null, campaign: null }] });
    assert.equal(v.rows[0].no_ad_set, true);
    assert.ok(v.rows[0].flags.some((f) => /Pick one in Settings/.test(f)));
  });

  test("the load step reads as words: step 2 of 4", () => {
    const v = view({ loads: [{ ad_number: "94", ad_video_id: VIDEO_C, state: "loading", step: "waiting for Meta", reasons: [], meta_video_id: "123" }] });
    assert.equal(v.rows[0].step_line, "Step 2 of 4: waiting for Meta to take the video.");
    assert.equal(v.rows[0].ids_line, "Meta ids: video 123");
    assert.equal(v.counts.in_flight, 1);
  });

  test("an ad that is on says On and has no Turn on button", () => {
    const body = statusWithBudget();
    body.loads[0].ad_status = "ACTIVE";
    const v = view(body);
    assert.equal(v.rows[0].state_word, "On");
    assert.equal(v.rows[0].turn_on.show, false);
    assert.equal(v.on_line, "Loaded ads on now: 1");
  });
});

describe("no fake numbers", () => {
  test("money: integer cents in, NULL and junk are unknown, never $0", () => {
    assert.equal(L.moneyWord(10000), "$100");
    assert.equal(L.moneyWord(123456), "$1,234.56");
    assert.equal(L.moneyWord(5), "$0.05");
    assert.equal(L.moneyWord(null), "unknown");
    assert.equal(L.moneyWord(undefined), "unknown");
    assert.equal(L.moneyWord(12.5), "unknown");
  });

  test("the budget is unknown when load-status does not send it, or sends 0", () => {
    const body = exampleResponse("GET marketing/meta/load-status");
    assert.equal(L.budgetOf(body.loads[0]), null, "the contract's answer has no daily budget today");
    assert.equal(L.budgetOf({ ad_set: { daily_budget_cents: 0 } }), null);
    assert.equal(L.budgetOf({ ad_set: { daily_budget_cents: 2500 } }), 2500);
    const v = view(body);
    assert.match(v.rows[0].ad_set_line, /daily budget unknown/);
    assert.doesNotMatch(L.viewHtml(v), /\$0 a day/);
  });
});

describe("Turn on — one ad, our ads.id, budget first", () => {
  test("posts ONLY campaigns/write {action:'resume_ad', ad_id:<ads.id>, request_id}", async () => {
    const v = view(statusWithBudget(10000));
    const row = v.rows[0];
    assert.equal(row.turn_on.show, true);
    assert.equal(row.turn_on.enabled, true);
    const ctx = fakeCtx({ answers: { "POST campaigns/write": { ok: true, status: 200, data: { ok: true, ad: { id: AD_ROW, status: "ACTIVE" } } } } });
    const out = await L.turnOn(row, ctx, { newId: () => "req-turn-on-0001" });

    assert.equal(out.ok, true);
    assert.equal(out.text, "Ad 91 is on.");
    assert.equal(ctx.calls.length, 1, "exactly one call");
    const call = ctx.calls[0];
    assert.equal(call.method, "POST");
    assert.equal(call.path, "campaigns/write");
    assert.deepEqual(call.body, { action: "resume_ad", ad_id: AD_ROW, request_id: "req-turn-on-0001" });
    assert.deepEqual(Object.keys(call.body).sort(), ["action", "ad_id", "request_id"]);
    assert.notEqual(call.body.ad_id, META_AD, "never the Meta id");
    assert.equal(call.body.campaign_id, undefined);
    assert.equal(call.body.partner_id, undefined);
    assertRequestMatchesContract("POST campaigns/write#resume_ad", call.body);
    assert.deepEqual(Object.keys(call.body).sort(), [...CONTRACT["POST campaigns/write#resume_ad"].requestKeys].sort());
  });

  test("the question names the ad, the ad set, the daily budget and the pauses above it", async () => {
    const body = statusWithBudget(10000);
    body.loads[0].ad_set.status = "PAUSED";
    const row = view(body).rows[0];
    const ctx = fakeCtx({ confirm: false });
    const out = await L.turnOn(row, ctx, { newId: () => "req-turn-on-0002" });
    assert.equal(out.cancelled, true);
    assert.equal(ctx.calls.length, 0, "a No sends nothing");
    assert.deepEqual(ctx.sheets, [{
      title: "Turn on Ad 91?",
      consequence: "It can spend up to $100 a day in Roadmap broad. The ad set is paused, so it will not spend until the ad set is on. Only this one ad turns on.",
      button: "Yes, turn on Ad 91"
    }]);
  });

  test("a promise answer from the frame's confirm counts as the second tap", async () => {
    const row = view(statusWithBudget(10000)).rows[0];
    const ctx = fakeCtx({ confirm: "promise", answers: { "POST campaigns/write": { ok: true, status: 200, data: { ok: true } } } });
    const out = await L.turnOn(row, ctx, { newId: () => "req-turn-on-0003" });
    assert.equal(out.ok, true);
    assert.equal(ctx.calls.length, 1);
  });

  test("budget unknown: the button is off with the reason, and nothing is asked or sent", async () => {
    const row = view(exampleResponse("GET marketing/meta/load-status")).rows[0];
    assert.equal(row.turn_on.show, true);
    assert.equal(row.turn_on.enabled, false);
    assert.equal(row.turn_on.reason, L.NO_BUDGET);
    const ctx = fakeCtx();
    const out = await L.turnOn(row, ctx);
    assert.equal(out.sent, false);
    assert.equal(ctx.sheets.length, 0);
    assert.equal(ctx.calls.length, 0);
  });

  test("a 403 says 'Only Chris can turn ads on.'", async () => {
    const row = view(statusWithBudget()).rows[0];
    const ctx = fakeCtx({ answers: { "POST campaigns/write": { ok: false, status: 403, data: { ok: false, error: "forbidden", message: "Only Chris can turn ads on." } } } });
    const out = await L.turnOn(row, ctx);
    assert.equal(out.ok, false);
    assert.equal(out.text, "Only Chris can turn ads on.");
  });

  test("Meta saying no prints the server's sentence; a crash or no answer never prints a code", () => {
    const row = { label: "Ad 91" };
    assert.equal(L.turnOnAnswer({ ok: false, status: 502, data: { message: "Meta said no: ad account disabled. The ad is still paused." } }, row).text,
      "Meta said no: ad account disabled. The ad is still paused.");
    assert.equal(L.turnOnAnswer({ ok: false, status: 500, data: { error: "TypeError: x is undefined" } }, row).text,
      "Turn on did not work. The ad is still paused. Try again.");
    assert.equal(L.turnOnAnswer({ ok: false, status: 0, data: null }, row).text,
      "No answer from the server. The ad is still paused. Try again.");
  });

  test("a row with no ads.id (or only a Meta id) sends nothing", async () => {
    assert.equal(L.turnOnBody({ ad_row_id: null }, "req-x-00000001"), null);
    assert.equal(L.turnOnBody({ ad_row_id: META_AD }, "req-x-00000001"), null);
    const body = statusWithBudget();
    body.loads[0].ad_row_id = null;
    const row = view(body).rows[0];
    assert.equal(row.turn_on.show, false);
    const ctx = fakeCtx();
    const out = await L.turnOn(row, ctx);
    assert.equal(out.sent, false);
    assert.equal(ctx.calls.length, 0);
  });

  test("the file never names a campaign-level action or a budget write", () => {
    assert.doesNotMatch(SRC, /["']resume["']/);
    assert.doesNotMatch(SRC, /["']pause["']/);
    assert.doesNotMatch(SRC, /update_budget/);
    assert.doesNotMatch(SRC, /campaign_id/);
    const actions = [...SRC.matchAll(/action:\s*["']([a-z_]+)["']/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(actions)], ["resume_ad"]);
  });
});

describe("Load to Meta and Load all approved — paused, $0", () => {
  test("Load to Meta posts {ad_video_id, request_id} to marketing/meta/load", async () => {
    const v = view({ loads: [] }, [approvedVideo(VIDEO_C, "90")]);
    const ctx = fakeCtx({ answers: { "POST marketing/meta/load": { ok: true, status: 202, data: { queued: true, jobs: [{ ad_number: "90", ad_video_id: VIDEO_C, job_id: "j" }] } } } });
    const out = await L.loadOne(v.rows[0], ctx, { newId: () => "req-load-000001" });
    assert.equal(out.ok, true);
    assert.equal(out.text, "Queued. It loads paused. This row updates by itself.");
    assert.equal(ctx.sheets.length, 0, "one ad loads on one tap");
    assert.deepEqual(ctx.calls.map((c) => [c.method, c.path, c.body]), [
      ["POST", "marketing/meta/load", { ad_video_id: VIDEO_C, request_id: "req-load-000001" }]
    ]);
    assertRequestMatchesContract("POST marketing/meta/load", ctx.calls[0].body);
  });

  test("Retry load sends the same body for a stopped row", async () => {
    const v = view(statusWithBudget());
    const refused = v.rows.find((r) => r.label === "Ad 92");
    const ctx = fakeCtx({ answers: { "POST marketing/meta/load": { ok: true, status: 202, data: { queued: true, jobs: [] } } } });
    await L.loadOne(refused, ctx, { newId: () => "req-load-000002" });
    assert.deepEqual(ctx.calls[0].body, { ad_video_id: VIDEO_B, request_id: "req-load-000002" });
  });

  test("Load all asks first, names the count and $0, then posts {all:true}", async () => {
    const v = view(statusWithBudget(), [approvedVideo(VIDEO_C, "90")]);
    assert.equal(v.load_all.count, 2, "the never-asked ad and the stopped one");
    const ctx = fakeCtx({ answers: { "POST marketing/meta/load": { ok: true, status: 202, data: exampleResponse("POST marketing/meta/load") } } });
    const out = await L.loadAll(v, ctx, { newId: () => "req-load-all-01" });
    assert.deepEqual(ctx.sheets, [{
      title: "Load 2 ads into Meta?",
      consequence: "2 ads load PAUSED into their funnel's ad set. Nothing spends until you turn one on. Costs $0.",
      button: "Load them"
    }]);
    assert.deepEqual(ctx.calls.map((c) => [c.method, c.path, c.body]), [
      ["POST", "marketing/meta/load", { all: true, request_id: "req-load-all-01" }]
    ]);
    assertRequestMatchesContract("POST marketing/meta/load", ctx.calls[0].body);
    assert.equal(out.text, "2 ads queued. They load paused.");
  });

  test("Load all: a No sends nothing; nothing to load is off with the reason", async () => {
    const v = view(statusWithBudget(), [approvedVideo(VIDEO_C, "90")]);
    const ctx = fakeCtx({ confirm: false });
    const out = await L.loadAll(v, ctx);
    assert.equal(out.cancelled, true);
    assert.equal(ctx.calls.length, 0);

    const empty = view({ loads: [] });
    assert.equal(empty.load_all.enabled, false);
    assert.equal(empty.load_all.reason, "Nothing to load yet. Approve a video on Videos first.");
    const ctx2 = fakeCtx();
    assert.equal((await L.loadAll(empty, ctx2)).sent, false);
    assert.equal(ctx2.calls.length + ctx2.sheets.length, 0);
  });

  test("a load error prints the server's plain sentence, never a code", () => {
    assert.equal(L.loadAnswer({ ok: false, status: 404, data: { error: "not_found", message: "No ad video with that id." } }, false).text,
      "No ad video with that id.");
    assert.equal(L.loadAnswer({ ok: false, status: 500, data: { error: "boom" } }, false).text, "The load did not start. Try again.");
  });
});

describe("reads", () => {
  test("fetchView reads load-status and the approved videos, nothing else", async () => {
    const ctx = fakeCtx({
      answers: {
        "GET marketing/meta/load-status": { ok: true, status: 200, data: statusWithBudget() },
        "GET ad-videos": { ok: true, status: 200, data: { ok: true, items: [approvedVideo(VIDEO_C, "90")], hasMore: false } }
      }
    });
    const v = await L.fetchView(ctx);
    assert.deepEqual(ctx.calls.map((c) => `${c.method} ${c.path}`), [
      "GET marketing/meta/load-status",
      "GET ad-videos?status=approved,delivered&limit=200"
    ]);
    assert.equal(v.rows.length, 3);
    assert.equal(v.loads_error, null);
  });

  test("one part failing keeps the other; words, never a status code", async () => {
    const ctx = fakeCtx({
      answers: {
        "GET marketing/meta/load-status": { ok: true, status: 200, data: statusWithBudget() },
        "GET ad-videos": { ok: false, status: 500, data: null }
      }
    });
    const v = await L.fetchView(ctx);
    assert.equal(v.rows.length, 2);
    assert.equal(v.approved_error, "The list of approved videos did not load. The rest of this page is current. Try again.");

    const ctx2 = fakeCtx({
      answers: {
        "GET marketing/meta/load-status": { ok: false, status: 503, data: { error: "not_ready", message: "Loading ads into Meta is built, but its database table is not live yet. It turns on with the next ship." } },
        "GET ad-videos": { ok: true, status: 200, data: { ok: true, items: [], hasMore: false } }
      }
    });
    const v2 = await L.fetchView(ctx2);
    assert.match(v2.loads_error, /not live yet/);
    assert.equal(v2.load_all.enabled, false);
    assert.doesNotMatch(L.viewHtml(v2), /\b(500|503|not_ready)\b/);
  });
});

describe("the page rules (UI-STANDARDS)", () => {
  test("one filled button per view", () => {
    const v = view(statusWithBudget(), [approvedVideo(VIDEO_C, "90")]);
    const html = L.viewHtml(v);
    assert.equal((html.match(/class="btn primary/g) || []).length, 1);
  });

  test("no px font sizes and no hand-rolled shadows in the tab's own CSS", () => {
    assert.doesNotMatch(SRC, /font-size\s*:/);
    assert.doesNotMatch(SRC, /box-shadow\s*:/);
    assert.doesNotMatch(SRC, /\bfont\s*:\s*\d/);
  });

  test("plain words: Fundhub spelling, no raw ids in sentences", () => {
    assert.doesNotMatch(SRC, /FundHub/);
    const html = L.viewHtml(view(statusWithBudget()));
    assert.match(html, /Ads load PAUSED/);
    assert.match(html, /campaign-manager\.html/);
    assert.doesNotMatch(html, /undefined|null|NaN/);
  });
});
