// The Meta loader (src/marketing/meta-load.mjs), driven by a fake Meta and a
// fake store. No network, no database. The real guardedWrite and the real
// compliance screen run on a fake staff handle, so the screen-then-log-then-call
// order is the real one.
//
// What this proves (build plan U28 acceptance):
//   - the happy path runs screen → uploadVideo (meta_video_id saved at once) →
//     a status check re-queued every 10 s, up to 20 minutes → thumbnail →
//     createCreative with url_tags from buildUrlTags → read-back all OPT_OUT →
//     claim → createAd PAUSED → our rows + loaded_at;
//   - a crash after any step resumes from the saved ids, and asks Meta for
//     nothing it already has;
//   - no code path sends ACTIVE or calls resume, updateBudget, createCampaign
//     or createAdSet (the fake records every call; the source is grepped too);
//   - every refusal is a plain sentence, and nothing reaches Meta first;
//   - the same run against the REAL src/adplatforms/meta.mjs with a fake fetch
//     sends PAUSED, the UTMs in url_tags and never ACTIVE.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.env.AD_TOKEN_ENC_KEY) {
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
}

const {
  runLoad, run, planLoad, finalVideoUrl, isR2FinalKey, adName, metaCopyOf, copyText,
  deriveLoadState, stepOf, envValue, REASONS, POLL_EVERY_MS, WAIT_LIMIT_MS, META_LOAD_KIND
} = await import("./meta-load.mjs");
const { guardedWrite } = await import("../adplatforms/index.mjs");
const { screenAndRecord, clearRuleCache } = await import("../compliance/screen.mjs");
const realMeta = await import("../adplatforms/meta.mjs");
const { encryptToken } = await import("../adplatforms/tokens.mjs");
const { creativeFeaturesOptOut } = await import("../adplatforms/meta-creative-features.mjs");
const { JOB_KINDS } = await import("./job-kinds.mjs");

/* ── fixtures (made up; none is a live id) ──────────────────────────────── */

const ORG = "aaaaaaaa-0000-4000-8000-000000000001";
const HOUSE = "aaaaaaaa-0000-4000-8000-0000000000a1";
const DIRECT = "aaaaaaaa-0000-4000-8000-0000000000d1";
const VID = "aaaaaaaa-0000-4000-8000-000000000701";
const SCRIPT = "aaaaaaaa-0000-4000-8000-000000000301";
const ADSET = "aaaaaaaa-0000-4000-8000-000000000401";
const CAMP = "aaaaaaaa-0000-4000-8000-000000000501";
const CONN = "aaaaaaaa-0000-4000-8000-000000000601";
const JOB = "aaaaaaaa-0000-4000-8000-000000000901";
const STAFF = "aaaaaaaa-0000-4000-8000-000000000b01";
const FINAL_KEY = `partners/${HOUSE}/ad-video/final/91-r0.mp4`;

const ENV = Object.freeze({
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET_AD_VIDEO: "fundhub-ad-video",
  R2_ACCESS_KEY_ID: "fedcba9876543210fedcba9876543210",
  R2_SECRET_ACCESS_KEY: "test-secret-not-a-real-key",
  META_PAGE_ID: "100000000000001",
  META_INSTAGRAM_USER_ID: "178400000000001"
});

const COPY = {
  primary_text: "Your credit file decides what the bank says. See it first.",
  headline: "See your roadmap",
  description: "Takes 10 minutes",
  cta_type: "LEARN_MORE"
};

function baseContext(over = {}) {
  return {
    video: {
      id: VID, org_id: ORG, partner_id: HOUSE, ad_id: "91", take_no: 1,
      status: "approved", approved_at: "2026-10-05T18:00:00.000Z", approved_by: STAFF,
      video_kind: "ad", storage_final_key: FINAL_KEY, script_id: SCRIPT,
      meta_video_id: null, meta_creative_id: null, meta_ad_external_id: null,
      ad_row_id: null, loaded_at: null, load_error: null,
      ...(over.video || {})
    },
    script: over.script === null ? null : {
      id: SCRIPT, partner_id: HOUSE, title: "Haynes, the call that was never a roadmap",
      angle_key: "haynes_call", funnel_key: "roadmap_147", meta_copy: COPY, ad_id: "91",
      ...(over.script || {})
    },
    funnel: over.funnel === null ? null : {
      key: "roadmap_147", name: "Roadmap", landing_url: "https://apply.fundhub.ai/roadmap",
      offer_key: "slo_roadmap", lane: "uwiq", cta_type: "LEARN_MORE",
      default_ad_set_external_id: "120210000000000101",
      ...(over.funnel || {})
    },
    adSet: over.adSet === null ? null : {
      id: ADSET, external_id: "120210000000000101", name: "Roadmap broad", status: "ACTIVE",
      campaign_id: CAMP, connection_id: CONN, partner_id: DIRECT,
      ...(over.adSet || {})
    },
    campaign: over.campaign === null ? null : {
      id: CAMP, external_id: "120210000000000001", name: "Roadmap", status: "ACTIVE",
      offer_type: "funding", special_ad_category: "CREDIT", partner_id: DIRECT,
      ...(over.campaign || {})
    },
    connection: over.connection === null ? null : {
      id: CONN, org_id: ORG, partner_id: DIRECT, platform: "meta", connection_state: "active",
      external_ad_account_id: "act_555000111", encrypted_access_token: "v1:fake",
      ...(over.connection || {})
    }
  };
}

/* ── a clock, a fake store, a fake staff handle ─────────────────────────── */

function makeWorld(over = {}) {
  const clock = { t: Date.parse("2026-10-06T09:00:00.000Z") };
  const events = [];
  const ctx = baseContext(over);
  const state = {
    ...ctx,
    otherRunning: false,
    categoryRows: [{ special_ad_category: "CREDIT" }],
    actionLog: [],
    screenings: [],
    assets: [],
    ads: [],
    crash: {},
    requeues: [],
    fails: []
  };

  const crashIf = (point) => {
    if (state.crash[point] > 0) {
      state.crash[point]--;
      throw new Error(`crash at ${point}`);
    }
  };

  // The handle guardedWrite and the screen get: answers the few statements
  // they make and refuses anything else, so a surprise query fails the test.
  const handle = {
    async query(sql, params = []) {
      if (/FROM ad_platform_category_map/.test(sql)) { events.push("db:screen"); return { rows: state.categoryRows }; }
      if (/FROM compliance_rules/.test(sql)) return { rows: [] };
      if (/INSERT INTO compliance_screenings/.test(sql)) {
        state.screenings.push({ state: params[6], reasons: JSON.parse(params[7]) });
        events.push("db:screening");
        return { rows: [] };
      }
      if (/INSERT INTO action_log/.test(sql)) {
        const id = `log-${state.actionLog.length + 1}`;
        state.actionLog.push({ id, target_type: params[5], after: JSON.parse(params[11]), executed_at: null, error: null });
        events.push(`db:log:${JSON.parse(params[11]).step}`);
        return { rows: [{ id }] };
      }
      if (/UPDATE action_log SET executed_at = now\(\), execute_error/.test(sql)) {
        const row = state.actionLog.find((r) => r.id === params[0]);
        row.executed_at = clock.t; row.error = params[1];
        return { rows: [] };
      }
      if (/UPDATE action_log SET executed_at = now\(\)/.test(sql)) {
        const row = state.actionLog.find((r) => r.id === params[0]);
        row.executed_at = clock.t;
        return { rows: [] };
      }
      throw new Error(`fake handle: unexpected SQL ${sql.slice(0, 80)}`);
    }
  };

  const store = {
    staffHandle: () => handle,
    async loadContext() {
      crashIf("loadContext");
      const up = state.actionLog
        .filter((r) => r.after.step === "upload_video" && r.executed_at && !r.error)
        .map((r) => r.executed_at);
      return {
        video: state.video ? { ...state.video } : null,
        script: state.script, funnel: state.funnel, adSet: state.adSet,
        campaign: state.campaign, connection: state.connection,
        otherRunning: state.otherRunning,
        uploadStartedAt: up.length ? new Date(Math.max(...up)).toISOString() : null
      };
    },
    async saveIds({ ids }) {
      crashIf("saveIds");
      Object.assign(state.video, ids);
      events.push(`db:save:${Object.keys(ids).join(",")}`);
    },
    async clearLoadError() { state.video.load_error = null; },
    async recordStop({ loadError, clear = {} }) {
      state.video.load_error = loadError;
      if (clear.video) { state.video.meta_video_id = null; state.video.meta_creative_id = null; }
      if (clear.creative) state.video.meta_creative_id = null;
      events.push("db:stop");
    },
    async claim() {
      crashIf("claim");
      const v = state.video;
      if (v.meta_ad_external_id) return { adRowId: v.ad_row_id, metaAdExternalId: v.meta_ad_external_id, stale: false, busy: false };
      if (v.ad_row_id) return { adRowId: v.ad_row_id, metaAdExternalId: null, stale: true, busy: state.otherRunning };
      v.ad_row_id = crypto.randomUUID();
      events.push("db:claim");
      return { adRowId: v.ad_row_id, metaAdExternalId: null, stale: false, busy: false };
    },
    async finishLoad({ video, script, adSet, name, adNumber }) {
      crashIf("finishLoad");
      const asset = {
        id: crypto.randomUUID(), partner_id: state.video.partner_id, kind: "video", format: "9x16",
        storage_key: state.video.storage_final_key, ai_generated: false, script_id: script.id
      };
      state.assets.push(asset);
      const same = asset.partner_id === adSet.partner_id;
      let ad = state.ads.find((a) => a.external_id === video.meta_ad_external_id);
      if (!ad) {
        ad = {
          id: video.ad_row_id, partner_id: adSet.partner_id, ad_set_id: adSet.id, campaign_id: adSet.campaign_id,
          asset_id: same ? asset.id : null, external_id: video.meta_ad_external_id, name,
          status: "PAUSED", fundhub_ad_number: adNumber, fundhub_ad_number_source: "loader"
        };
        state.ads.push(ad);
      }
      Object.assign(state.video, { ad_row_id: ad.id, meta_ad_external_id: video.meta_ad_external_id, loaded_at: clock.t, load_error: null });
      events.push("db:finish");
      return { adRowId: ad.id, assetId: asset.id, assetLinked: same };
    }
  };

  const jobs = {
    async requeue(id, runAfter) { state.requeues.push({ id, runAfter: runAfter.getTime() }); events.push("job:requeue"); },
    async fail(id, reason) { state.fails.push({ id, reason }); events.push("job:fail"); }
  };

  return { clock, events, state, store, jobs, handle };
}

/* A fake Meta. Every call is recorded by name. The five forbidden functions
   exist so a call to one is recorded (and refused) instead of silently
   missing; the test asserts none is ever called. */
const FORBIDDEN = ["resume", "updateBudget", "createCampaign", "createAdSet", "pause"];

function fakeMeta(world, over = {}) {
  const calls = [];
  const statuses = over.statuses || ["ready"];
  let statusCall = 0;
  const impl = {
    async uploadVideo(conn, args) { return { video_id: "vid-1" }; },
    async getVideoStatus() { const s = statuses[Math.min(statusCall, statuses.length - 1)]; statusCall++; return s; },
    async getVideoThumbnails() { return [{ uri: "https://scontent.example/thumb-2.jpg", is_preferred: true }, { uri: "https://scontent.example/thumb-1.jpg", is_preferred: false }]; },
    preferredThumbnail: realMeta.preferredThumbnail,
    async createCreative() { return { creative_id: "cr-1" }; },
    async readCreativeFeatures() { return { all_opt_out: true, opt_in: [], unconfirmed: [], missing_spec: false, reason: null }; },
    async getAdSetGuardInfo() {
      return { effective_status: "ACTIVE", is_dynamic_creative: false, ad_count: 3, campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" } };
    },
    async createAd(conn, ad) { return { id: "ad-1" }; },
    ...over.impl
  };
  for (const f of FORBIDDEN) impl[f] = async () => { throw new Error(`${f} must never be called by the loader`); };

  const meta = {};
  for (const [name, fn] of Object.entries(impl)) {
    meta[name] = (...args) => {
      if (name !== "preferredThumbnail") {
        calls.push({ name, args });
        world.events.push(`meta:${name}`);
      }
      return fn(...args);
    };
  }
  return { meta, calls };
}

function depsFor(world, meta, over = {}) {
  return {
    store: world.store,
    meta,
    guardedWrite,
    screen: screenAndRecord,
    jobs: world.jobs,
    env: ENV,
    now: () => world.clock.t,
    metaCtx: {},
    ...over
  };
}

const JOB_ROW = Object.freeze({ id: JOB, org_id: ORG, kind: META_LOAD_KIND, payload: { ad_video_id: VID, requested_by: STAFF }, created_at: "2026-10-06T08:59:00.000Z" });
const names = (calls) => calls.map((c) => c.name);

function assertNothingForbidden(calls) {
  for (const c of calls) assert.ok(!FORBIDDEN.includes(c.name), `the loader called ${c.name}`);
  for (const c of calls.filter((x) => x.name === "createAd")) {
    assert.equal(Object.prototype.hasOwnProperty.call(c.args[1], "status"), false, "createAd was handed a status");
  }
  assert.doesNotMatch(JSON.stringify(calls.map((c) => c.args)), /"ACTIVE"/);
}

beforeEach(() => clearRuleCache());

/* ═══════════════════════════════════════════════════════════════════════ */

describe("the happy path, step by step", () => {
  test("screen → upload (id saved at once) → wait 10 s → thumbnail → creative → read back → guard → claim → createAd PAUSED → our rows", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world, { statuses: ["processing", "ready"] });

    // Run 1: uploads, Meta is still processing → comes back in 10 s.
    const first = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(first.state, "waiting");
    assert.equal(world.state.video.meta_video_id, "vid-1");
    assert.deepEqual(world.state.requeues, [{ id: JOB, runAfter: world.clock.t + POLL_EVERY_MS }]);

    // Run 2, 10 s later.
    world.clock.t += POLL_EVERY_MS;
    const second = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(second.state, "loaded", JSON.stringify(second));

    assert.deepEqual(names(calls), [
      "uploadVideo", "getVideoStatus",
      "getVideoStatus", "getVideoThumbnails", "createCreative", "readCreativeFeatures",
      "getAdSetGuardInfo", "createAd"
    ]);
    assertNothingForbidden(calls);

    // The order of everything, run 1: the screen (and its audit row) before
    // anything else; the log row before each Meta write; the id saved at once.
    const run1 = world.events.slice(0, world.events.indexOf("job:requeue") + 1);
    assert.equal(run1[0], "db:screen", "the screen reads before anything else");
    assert.deepEqual(run1.filter((e) => e !== "db:screen"), [
      "db:screening",
      "db:log:upload_video", "meta:uploadVideo", "db:save:meta_video_id",
      "meta:getVideoStatus", "job:requeue"
    ]);
    const all = world.events;
    assert.ok(all.indexOf("db:log:create_creative") < all.indexOf("meta:createCreative"));
    assert.ok(all.indexOf("meta:createCreative") < all.indexOf("db:save:meta_creative_id"));
    assert.ok(all.indexOf("meta:readCreativeFeatures") < all.indexOf("meta:getAdSetGuardInfo"));
    assert.ok(all.indexOf("meta:getAdSetGuardInfo") < all.indexOf("db:claim"));
    assert.ok(all.indexOf("db:claim") < all.indexOf("db:log:create_ad"));
    assert.ok(all.indexOf("db:log:create_ad") < all.indexOf("meta:createAd"));
    assert.ok(all.indexOf("meta:createAd") < all.indexOf("db:save:meta_ad_external_id"));
    assert.ok(all.indexOf("db:save:meta_ad_external_id") < all.indexOf("db:finish"));

    // What went to Meta.
    const upload = calls.find((c) => c.name === "uploadVideo").args[1];
    assert.match(upload.file_url, /^https:\/\/0123456789abcdef0123456789abcdef\.r2\.cloudflarestorage\.com\/fundhub-ad-video\/partners\//);
    assert.match(upload.file_url, /X-Amz-Expires=86400/);
    const creative = calls.find((c) => c.name === "createCreative").args[1];
    assert.equal(creative.url_tags, "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content=91");
    assert.equal(creative.link, "https://apply.fundhub.ai/roadmap");
    assert.equal(creative.page_id, ENV.META_PAGE_ID);
    assert.equal(creative.instagram_user_id, ENV.META_INSTAGRAM_USER_ID);
    assert.equal(creative.image_url, "https://scontent.example/thumb-2.jpg", "the preferred thumbnail");
    assert.equal(creative.message, COPY.primary_text);
    assert.equal(creative.title, COPY.headline);
    assert.equal(creative.link_description, COPY.description);
    assert.equal(creative.cta_type, "LEARN_MORE");
    const ad = calls.find((c) => c.name === "createAd").args[1];
    assert.deepEqual(ad, {
      name: "Roadmap Ad 91 — Haynes, the call that was never a roadmap",
      external_ad_set_id: "120210000000000101",
      external_creative_id: "cr-1"
    });

    // Our rows.
    assert.equal(world.state.assets.length, 1);
    assert.equal(world.state.assets[0].storage_key, FINAL_KEY);
    assert.equal(world.state.ads.length, 1);
    assert.equal(world.state.ads[0].status, "PAUSED");
    assert.equal(world.state.ads[0].fundhub_ad_number, "91");
    assert.equal(world.state.ads[0].fundhub_ad_number_source, "loader");
    assert.ok(world.state.video.loaded_at);
    assert.equal(world.state.video.meta_ad_external_id, "ad-1");
    assert.equal(second.meta_ad_external_id, "ad-1");
    // House video, direct ad set: the asset cannot be linked across partners (377).
    assert.equal(second.asset_linked, false);
    assert.equal(world.state.ads[0].asset_id, null);

    // Every Meta write was logged as a human action, with the step and the staff id.
    assert.deepEqual(world.state.actionLog.map((r) => [r.target_type, r.after.step]), [
      ["creative_asset", "upload_video"], ["creative_asset", "create_creative"], ["ad", "create_ad"]
    ]);
    assert.ok(world.state.actionLog.every((r) => r.after.staff_id === STAFF && r.executed_at && !r.error));

    // The screen passed because a person approved the video.
    assert.equal(world.state.screenings[0].state, "passed");
  });

  test("a loaded video is not loaded again", async () => {
    const world = makeWorld({ video: { loaded_at: "2026-10-06T08:00:00.000Z", meta_ad_external_id: "ad-9" } });
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.equal(out.already, true);
    assert.deepEqual(calls, []);
  });

  test("another load of the same video running → busy, nothing sent", async () => {
    const world = makeWorld();
    world.state.otherRunning = true;
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.deepEqual(out, { state: "busy", reasons: [REASONS.BUSY] });
    assert.deepEqual(calls, []);
  });

  test("same partner on both sides: the ads row carries the asset", async () => {
    const world = makeWorld({ adSet: { partner_id: HOUSE }, campaign: { partner_id: HOUSE }, connection: { partner_id: HOUSE } });
    const { meta } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.equal(out.asset_linked, true);
    assert.equal(world.state.ads[0].asset_id, world.state.assets[0].id);
  });
});

describe("waiting for Meta to process the video", () => {
  test("re-queued every 10 s while processing; failed at 20 minutes, and the upload is let go", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world, { statuses: ["processing"] });
    const start = world.clock.t;
    let out = await runLoad(JOB_ROW, depsFor(world, meta));
    let runs = 1;
    while (out.state === "waiting") {
      assert.equal(world.state.requeues.at(-1).runAfter, world.clock.t + POLL_EVERY_MS);
      world.clock.t += POLL_EVERY_MS;
      out = await runLoad(JOB_ROW, depsFor(world, meta));
      runs++;
      assert.ok(runs < 200, "never gave up");
    }
    assert.equal(out.state, "failed");
    assert.match(out.reasons[0], /^Meta was still working on the video after 20 minutes\. Press Retry/);
    assert.ok(world.clock.t - start >= WAIT_LIMIT_MS);
    assert.ok(world.clock.t - start < WAIT_LIMIT_MS + POLL_EVERY_MS);
    assert.equal(world.state.fails.length, 1);
    assert.equal(world.state.video.meta_video_id, null, "a Retry uploads afresh");
    assert.match(world.state.video.load_error, /vid-1/);
    assert.equal(names(calls).filter((n) => n === "uploadVideo").length, 1, "uploaded once");
    assert.ok(!names(calls).includes("createCreative"));
  });

  for (const status of ["error", "expired"]) {
    test(`Meta says ${status} → failed in plain words, the upload let go`, async () => {
      const world = makeWorld();
      const { meta, calls } = fakeMeta(world, { statuses: [status] });
      const out = await runLoad(JOB_ROW, depsFor(world, meta));
      assert.equal(out.state, "failed");
      assert.match(out.reasons[0], new RegExp(`^Meta could not use this video \\(it says ${status}\\)`));
      assert.equal(world.state.video.meta_video_id, null);
      assert.equal(world.state.fails.length, 1);
      assert.ok(!names(calls).includes("createCreative"));
    });
  }

  test("ready but no thumbnail yet → wait, not fail", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, { impl: { async getVideoThumbnails() { return []; } } });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "waiting");
    assert.equal(world.state.requeues.length, 1);
  });
});

describe("a crash after any step resumes from the saved ids", () => {
  test("after the upload: the next run does not upload again", async () => {
    const world = makeWorld();
    let blowUp = true;
    const { meta, calls } = fakeMeta(world, {
      impl: { async getVideoStatus() { if (blowUp) { blowUp = false; throw new Error("worker died"); } return "ready"; } }
    });
    await assert.rejects(() => runLoad(JOB_ROW, depsFor(world, meta)), /worker died/);
    assert.equal(world.state.video.meta_video_id, "vid-1");
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.equal(names(calls).filter((n) => n === "uploadVideo").length, 1);
  });

  test("after the creative: the next run does not make a second creative", async () => {
    const world = makeWorld();
    let blowUp = true;
    const { meta, calls } = fakeMeta(world, {
      impl: { async readCreativeFeatures() { if (blowUp) { blowUp = false; throw new Error("worker died"); } return { all_opt_out: true, opt_in: [] }; } }
    });
    await assert.rejects(() => runLoad(JOB_ROW, depsFor(world, meta)), /worker died/);
    assert.equal(world.state.video.meta_creative_id, "cr-1");
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.equal(names(calls).filter((n) => n === "uploadVideo").length, 1);
    assert.equal(names(calls).filter((n) => n === "createCreative").length, 1);
  });

  test("after the ad: the next run only writes our rows", async () => {
    const world = makeWorld();
    world.state.crash.finishLoad = 1;
    const { meta, calls } = fakeMeta(world);
    await assert.rejects(() => runLoad(JOB_ROW, depsFor(world, meta)), /crash at finishLoad/);
    assert.equal(world.state.video.meta_ad_external_id, "ad-1");
    assert.equal(world.state.video.loaded_at, null);
    const before = calls.length;
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.deepEqual(names(calls.slice(before)), [], "Meta is not asked for anything again");
    assert.equal(world.state.ads.length, 1);
  });

  test("claimed, then Meta never answered: the next run asks again with the same reserved row id", async () => {
    const world = makeWorld();
    let blowUp = true;
    const { meta, calls } = fakeMeta(world, {
      impl: {
        async createAd() {
          if (blowUp) {
            blowUp = false;
            const e = new Error("platform unreachable: socket hang up");
            e.platformMessage = "The platform could not be reached."; e.retryable = true;
            throw e;
          }
          return { id: "ad-1" };
        }
      }
    });
    await assert.rejects(() => runLoad(JOB_ROW, depsFor(world, meta)), /create ad: The platform could not be reached/);
    const reserved = world.state.video.ad_row_id;
    assert.ok(reserved, "the claim reserved our ads row id first");
    assert.equal(world.state.video.meta_ad_external_id, null);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.equal(world.state.ads[0].id, reserved);
    assert.equal(names(calls).filter((n) => n === "createAd").length, 2);
    assert.equal(names(calls).filter((n) => n === "createCreative").length, 1);
    assertNothingForbidden(calls);
  });
});

describe("refusals, in plain words, before anything reaches Meta", () => {
  const cases = [
    ["no person approval", { video: { status: "awaiting_approval", approved_at: null, approved_by: null } }, REASONS.NOT_APPROVED],
    ["approved state but no approver", { video: { approved_by: " " } }, REASONS.NOT_APPROVED],
    ["no meta_copy on the script", { script: { meta_copy: null } }, REASONS.NO_META_COPY],
    ["meta_copy with no primary text", { script: { meta_copy: { headline: "Hi" } } }, REASONS.NO_META_COPY],
    ["no script", { script: null }, REASONS.NO_SCRIPT],
    ["the script has no funnel", { script: { funnel_key: null } }, REASONS.NO_FUNNEL],
    ["the funnel is gone", { funnel: null }, REASONS.funnelGone("roadmap_147")],
    ["no default ad set", { funnel: { default_ad_set_external_id: null } }, REASONS.noAdSet("Roadmap")],
    ["ad set not synced", { adSet: null }, REASONS.AD_SET_NOT_SYNCED],
    ["final video not in storage (NULL)", { video: { storage_final_key: null } }, REASONS.NOT_IN_STORAGE],
    ["final video not in storage (drive:)", { video: { storage_final_key: "drive:1AbCdEf" } }, REASONS.NOT_IN_STORAGE],
    ["final key under another partner", { video: { storage_final_key: `partners/${DIRECT}/ad-video/final/91-r0.mp4` } }, REASONS.NOT_IN_STORAGE],
    ["UTMs already in the funnel link", { funnel: { landing_url: "https://apply.fundhub.ai/roadmap?utm_source=fb" } }, REASONS.UTM_IN_LINK],
    ["a lane our tracking does not know", { funnel: { lane: "mystery" } }, REASONS.lane("mystery")],
    ["the connection is not active", { connection: { connection_state: "pending" } }, REASONS.connection("pending")]
  ];
  for (const [label, over, reason] of cases) {
    test(label, async () => {
      const world = makeWorld(over);
      const { meta, calls } = fakeMeta(world);
      const out = await runLoad(JOB_ROW, depsFor(world, meta));
      assert.equal(out.state, "refused");
      assert.ok(out.reasons.includes(reason), `${JSON.stringify(out.reasons)} should include ${reason}`);
      assert.deepEqual(calls, [], "nothing reached Meta");
      assert.equal(world.state.actionLog.length, 0);
      assert.equal(world.state.video.load_error, out.reasons.join(" "));
    });
  }

  test("R2 keys or Page ids not set → refused, each named", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world);
    const env = { ...ENV, R2_SECRET_ACCESS_KEY: "****************abcd", META_PAGE_ID: "", META_INSTAGRAM_USER_ID: undefined };
    const out = await runLoad(JOB_ROW, depsFor(world, meta, { env }));
    assert.equal(out.state, "refused");
    assert.deepEqual(out.reasons, [REASONS.NO_STORAGE_KEYS, REASONS.NO_PAGE, REASONS.NO_INSTAGRAM]);
    assert.deepEqual(calls, []);
  });

  test("today's live shape (no final key, no R2, no Page ids) refuses with 'final video is not in storage yet' first", async () => {
    const world = makeWorld({ video: { storage_final_key: null } });
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta, { env: {} }));
    assert.equal(out.state, "refused");
    assert.equal(out.reasons[0], "The final video is not in storage yet.");
    assert.deepEqual(calls, []);
  });

  test("compliance block: no special ad category configured → the screen's own words", async () => {
    const world = makeWorld();
    world.state.categoryRows = [];
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "refused");
    assert.match(out.reasons[0], /^Our copy screen stopped this: No special_ad_category is configured for meta\/funding/);
    assert.deepEqual(calls, []);
    assert.equal(world.state.screenings[0].state, "blocked");
  });

  test("needs_approval (a credit repair campaign) is not a pass", async () => {
    const world = makeWorld({ campaign: { offer_type: "credit_repair" } });
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "refused");
    assert.match(out.reasons.join(" "), /Credit-repair creative always requires human approval/);
    assert.deepEqual(calls, []);
  });

  test("an enhancement reads back OPT_IN → refused, the creative let go, no ad", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world, {
      impl: {
        async readCreativeFeatures() {
          return realMeta.creativeFeaturesVerdict({
            degrees_of_freedom_spec: { creative_features_spec: { ...creativeFeaturesOptOut(), image_touchups: { enroll_status: "OPT_IN" } } },
            contextual_multi_ads: { enroll_status: "OPT_OUT" }
          });
        }
      }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "refused");
    assert.match(out.reasons[0], /Meta has these enhancements turned on: image_touchups\. The ad was not loaded\. \(Meta creative cr-1\)/);
    assert.equal(world.state.video.meta_creative_id, null);
    assert.ok(!names(calls).includes("createAd"));
    assertNothingForbidden(calls);
  });

  test("the ad set guard fails (50 ads) → refused with the guard's words, no ad", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world, {
      impl: { async getAdSetGuardInfo() { return { effective_status: "ACTIVE", is_dynamic_creative: false, ad_count: 50, campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" } }; } }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "refused");
    assert.deepEqual(out.reasons, ["This ad set already has 50 ads. Meta allows 50. Pick another ad set."]);
    assert.ok(!names(calls).includes("createAd"));
    assert.equal(world.state.video.ad_row_id, null, "no claim was made");
  });

  test("a paused ad set is not a refusal; the note comes back", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, {
      impl: { async getAdSetGuardInfo() { return { effective_status: "PAUSED", is_dynamic_creative: false, ad_count: 0, campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" } }; } }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "loaded");
    assert.match(out.notes.join(" "), /This ad set is paused in Meta/);
  });

  test("a job with no ad video id refuses without reading anything", async () => {
    const world = makeWorld();
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad({ ...JOB_ROW, payload: {} }, depsFor(world, meta));
    assert.deepEqual(out, { state: "refused", reasons: [REASONS.NO_JOB_VIDEO] });
    assert.deepEqual(calls, []);
  });

  test("a video that is gone", async () => {
    const world = makeWorld();
    world.state.video = null;
    const { meta, calls } = fakeMeta(world);
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.deepEqual(out, { state: "refused", reasons: [REASONS.GONE] });
    assert.deepEqual(calls, []);
  });
});

describe("Meta errors", () => {
  test("Meta asks us to slow down → re-queued for that long, no attempt counted", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, {
      impl: {
        async uploadVideo() {
          const e = new Error("throttled"); e.platformMessage = "Meta asked us to slow down."; e.retryable = true; e.throttled = true; e.retryAfterMs = 120_000;
          throw e;
        }
      }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "waiting");
    assert.deepEqual(world.state.requeues, [{ id: JOB, runAfter: world.clock.t + 120_000 }]);
    assert.equal(world.state.fails.length, 0);
  });

  test("a throttle on a read (the status check) is re-queued too", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, {
      impl: {
        async getVideoStatus() {
          const e = new Error("throttled"); e.platformMessage = "slow down"; e.retryable = true; e.retryAfterMs = 60_000;
          throw e;
        }
      }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.equal(out.state, "waiting");
    assert.equal(world.state.requeues[0].runAfter, world.clock.t + 60_000);
  });

  test("Meta refuses a write (4xx) → failed for good with Meta's own words", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, {
      impl: {
        async createCreative() {
          const e = new Error("platform 400"); e.platformMessage = "Invalid parameter: page_id"; e.status = 400; e.retryable = false;
          throw e;
        }
      }
    });
    const out = await runLoad(JOB_ROW, depsFor(world, meta));
    assert.deepEqual(out, { state: "failed", reasons: ["Meta said no: Invalid parameter: page_id"] });
    assert.equal(world.state.fails.length, 1);
    assert.equal(world.state.video.load_error, "Meta said no: Invalid parameter: page_id");
    assert.equal(world.state.actionLog.at(-1).error, "Invalid parameter: page_id", "guardedWrite kept Meta's words");
  });

  test("a passing hiccup (5xx) is thrown, so the queue tries again", async () => {
    const world = makeWorld();
    const { meta } = fakeMeta(world, {
      impl: {
        async uploadVideo() {
          const e = new Error("platform 503"); e.platformMessage = "Service temporarily unavailable"; e.status = 503; e.retryable = true;
          throw e;
        }
      }
    });
    await assert.rejects(() => runLoad(JOB_ROW, depsFor(world, meta)), /upload video: Service temporarily unavailable/);
    assert.equal(world.state.fails.length, 0, "the worker fails it, with tries left");
  });
});

describe("nothing in the loader turns an ad on", () => {
  test("the source never sends ACTIVE or calls resume, updateBudget, createCampaign or createAdSet", () => {
    const src = readFileSync(fileURLToPath(new URL("./meta-load.mjs", import.meta.url)), "utf8");
    // Comments explain the rule and name the words; code must not use them.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    for (const word of ["ACTIVE", "resume", "updateBudget", "createCampaign", "createAdSet", "pause("]) {
      assert.ok(!code.includes(word), `meta-load.mjs code mentions ${word}`);
    }
  });

  test("meta_load is registered in the loader group", async () => {
    assert.equal(JOB_KINDS[META_LOAD_KIND].group, "loader");
    const mod = await JOB_KINDS[META_LOAD_KIND].load();
    assert.equal(typeof mod.run, "function");
    assert.equal(mod.run, run);
  });
});

describe("against the real src/adplatforms/meta.mjs, with a fake fetch", () => {
  test("PAUSED, url_tags, every enhancement off, never ACTIVE, never a campaign or ad set", async () => {
    const world = makeWorld({ connection: { encrypted_access_token: encryptToken("fake-meta-token-for-tests-only", { partnerId: DIRECT }) } });
    const sent = [];
    const fetch = async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      sent.push({ url: String(url), method: init.method, body });
      const u = String(url);
      let answer = {};
      if (/\/advideos$/.test(u)) answer = { id: "1234567890123456" };
      else if (/\?fields=status$/.test(u)) answer = { status: { video_status: "ready" } };
      else if (/\/thumbnails\?/.test(u)) answer = { data: [{ uri: "https://scontent.example/t.jpg", is_preferred: true }] };
      else if (/\/adcreatives$/.test(u)) answer = { id: "120210000000000301" };
      else if (/degrees_of_freedom_spec/.test(u)) {
        answer = { degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesOptOut() }, contextual_multi_ads: { enroll_status: "OPT_OUT" } };
      } else if (/ads\.limit/.test(decodeURIComponent(u))) {
        answer = { effective_status: "ACTIVE", is_dynamic_creative: false, ads: { summary: { total_count: 4 } }, campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" } };
      } else if (/\/ads$/.test(u)) answer = { id: "120210000000000201" };
      else throw new Error(`unexpected Meta call ${u}`);
      return { ok: true, status: 200, headers: new Headers({}), text: async () => JSON.stringify(answer) };
    };
    const metaCtx = { fetch, sleep: async () => {}, now: () => world.clock.t, cooldown: new Map() };
    const out = await runLoad(JOB_ROW, depsFor(world, realMeta, { metaCtx }));
    assert.equal(out.state, "loaded", JSON.stringify(out));
    assert.equal(out.meta_ad_external_id, "120210000000000201");

    const posts = sent.filter((s) => s.method === "POST");
    assert.deepEqual(posts.map((p) => new URL(p.url).pathname.split("/").pop()), ["advideos", "adcreatives", "ads"]);
    for (const p of posts) {
      assert.doesNotMatch(JSON.stringify(p.body), /"ACTIVE"/);
      assert.doesNotMatch(p.url, /\/(campaigns|adsets)$/);
    }
    const ad = posts.find((p) => p.url.endsWith("/ads")).body;
    assert.equal(ad.status, "PAUSED");
    assert.equal(ad.adset_id, "120210000000000101");
    assert.deepEqual(ad.creative, { creative_id: "120210000000000301" });
    const cr = posts.find((p) => p.url.endsWith("/adcreatives")).body;
    assert.equal(cr.url_tags, "utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content=91");
    assert.equal(cr.object_story_spec.video_data.call_to_action.value.link, "https://apply.fundhub.ai/roadmap");
    assert.equal(cr.object_story_spec.instagram_user_id, ENV.META_INSTAGRAM_USER_ID);
    for (const v of Object.values(cr.degrees_of_freedom_spec.creative_features_spec)) assert.equal(v.enroll_status, "OPT_OUT");
    assert.deepEqual(cr.contextual_multi_ads, { enroll_status: "OPT_OUT" });
    // The token travels only in the header, never in a body or a URL.
    assert.doesNotMatch(JSON.stringify(sent), /fake-meta-token-for-tests-only/);
  });
});

describe("the pure parts", () => {
  test("finalVideoUrl: a 24-hour signed R2 link for an R2 key, null for today's shapes", () => {
    const row = { partner_id: HOUSE, storage_final_key: FINAL_KEY };
    const url = finalVideoUrl(row, ENV, { now: new Date("2026-10-06T09:00:00Z") });
    assert.match(url, /^https:\/\/0123456789abcdef0123456789abcdef\.r2\.cloudflarestorage\.com\/fundhub-ad-video\/partners\/aaaaaaaa-0000-4000-8000-0000000000a1\/ad-video\/final\/91-r0\.mp4\?/);
    assert.match(url, /X-Amz-Expires=86400/);
    assert.match(url, /X-Amz-Signature=[0-9a-f]{64}/);
    assert.equal(finalVideoUrl({ partner_id: HOUSE, storage_final_key: null }, ENV), null);
    assert.equal(finalVideoUrl({ partner_id: HOUSE, storage_final_key: "drive:1AbC" }, ENV), null);
    assert.equal(finalVideoUrl({ partner_id: HOUSE, storage_final_key: `partners/${DIRECT}/x.mp4` }, ENV), null);
    assert.equal(finalVideoUrl(row, {}), null, "no R2 env");
    assert.equal(finalVideoUrl(row, { ...ENV, R2_ACCESS_KEY_ID: "****************abcd" }), null, "a masked key is not a key");
    assert.equal(finalVideoUrl(row, { ...ENV, CLOUDFLARE_ACCOUNT_ID: "not-an-account" }), null, "the signer refuses → null");
  });

  test("isR2FinalKey", () => {
    assert.equal(isR2FinalKey(FINAL_KEY, HOUSE), true);
    assert.equal(isR2FinalKey(FINAL_KEY, HOUSE.toUpperCase()), true);
    assert.equal(isR2FinalKey(`partners/${HOUSE}/`, HOUSE), false);
    assert.equal(isR2FinalKey("drive:abc", HOUSE), false);
    assert.equal(isR2FinalKey(FINAL_KEY, "not-a-uuid"), false);
  });

  test("adName: '<Offer> Ad <n> — <angle>'", () => {
    assert.equal(adName({ offerLabel: "Roadmap", adNumber: "91", angle: "Haynes,  the call" }), "Roadmap Ad 91 — Haynes, the call");
    assert.equal(adName({ offerLabel: "Roadmap", adNumber: "91", angle: null }), "Roadmap Ad 91");
    assert.equal(adName({ offerLabel: "", adNumber: "7" }), "Fundhub Ad 7");
  });

  test("the ad name's offer comes from offerFacts, else the funnel's name", () => {
    const plan = planLoad(baseContext(), ENV);
    assert.equal(plan.name, "Roadmap Ad 91 — Haynes, the call that was never a roadmap");
    const other = planLoad(baseContext({ funnel: { offer_key: null, name: "Book a call" } }), ENV);
    assert.equal(other.name, "Book a call Ad 91 — Haynes, the call that was never a roadmap");
    assert.deepEqual(plan.reasons, []);
  });

  test("the funnel's CTA is used when the copy has none", () => {
    const plan = planLoad(baseContext({ script: { meta_copy: { primary_text: "Hi" } }, funnel: { cta_type: "BOOK_NOW" } }), ENV);
    assert.equal(plan.ctaType, "BOOK_NOW");
  });

  test("metaCopyOf and copyText", () => {
    assert.equal(metaCopyOf(null), null);
    assert.equal(metaCopyOf("not json"), null);
    assert.equal(metaCopyOf({ primary_text: "  " }), null);
    assert.deepEqual(metaCopyOf(JSON.stringify({ primary_text: " A ", headline: "B" })),
      { primary_text: "A", headline: "B", description: null, cta_type: null });
    assert.equal(copyText(metaCopyOf(COPY)), `${COPY.primary_text}\n${COPY.headline}\n${COPY.description}`);
  });

  test("envValue treats blank and masked values as unset", () => {
    assert.equal(envValue({ A: " x " }, "A"), "x");
    assert.equal(envValue({ A: "" }, "A"), null);
    assert.equal(envValue({ A: "****1234" }, "A"), null);
    assert.equal(envValue({}, "A"), null);
  });

  test("deriveLoadState: every state the Launch tab shows", () => {
    assert.deepEqual(deriveLoadState({ loaded_at: "2026-10-06T00:00:00Z" }), { state: "loaded", reasons: [], step: "loaded" });
    assert.equal(deriveLoadState({ job_status: "queued" }).state, "waiting");
    assert.equal(deriveLoadState({ job_status: "queued", meta_video_id: "v" }).state, "loading");
    assert.equal(deriveLoadState({ job_status: "queued", meta_video_id: "v" }).step, "waiting for Meta");
    assert.deepEqual(deriveLoadState({ job_status: "queued", job_error: "upload video: 503" }).reasons,
      ["Trying again soon. Last time: upload video: 503"]);
    assert.equal(deriveLoadState({ job_status: "running" }).state, "loading");
    assert.deepEqual(deriveLoadState({ job_status: "done", job_result: { state: "refused", reasons: [REASONS.NOT_IN_STORAGE] } }),
      { state: "refused", reasons: ["The final video is not in storage yet."], step: null });
    assert.equal(deriveLoadState({ job_status: "done", job_result: JSON.stringify({ state: "refused", reasons: ["x"] }) }).state, "refused");
    assert.deepEqual(deriveLoadState({ job_status: "failed", load_error: REASONS.TIMEOUT, job_error: "x" }).reasons, [REASONS.TIMEOUT]);
    assert.equal(deriveLoadState({ job_status: "done", job_result: { state: "busy" }, meta_video_id: "v" }).state, "loading");
    assert.equal(deriveLoadState({}).state, "waiting");
  });

  test("stepOf follows the saved ids", () => {
    assert.equal(stepOf({}), "uploading video");
    assert.equal(stepOf({ meta_video_id: "v" }), "waiting for Meta");
    assert.equal(stepOf({ meta_video_id: "v", meta_creative_id: "c" }), "creating the ad");
    assert.equal(stepOf({ loaded_at: "x" }), "loaded");
  });
});
