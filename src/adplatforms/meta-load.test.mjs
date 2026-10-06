// The Meta load path (spec §10.1, §10.2), driven by a fake Meta. No network.
//
// What this proves:
//   - every POST to /ads says PAUSED, and createAd refuses any status at all;
//   - a creative opts out of every key in meta-creative-features.mjs, plus
//     contextual_multi_ads, and a read-back with any OPT_IN is not "all off";
//   - upload, status, thumbnails, image and the ad set guard read ask Meta the
//     right thing and read its answer right;
//   - callPlatform (_api.mjs) backs off on Meta's throttle codes 4, 17, 32, 613
//     and 80004, on 429 and on a GET's 5xx, and slows down when
//     x-business-use-case-usage passes 75%;
//   - nothing in the load path sends ACTIVE, changes a budget, or makes a
//     campaign or an ad set.
//
// The fake answers follow Meta's documented shapes; none is captured from the
// live account.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

if (!process.env.AD_TOKEN_ENC_KEY) {
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
}

const { encryptToken } = await import("./tokens.mjs");
const meta = await import("./meta.mjs");
const {
  META_CREATIVE_FEATURE_KEYS, NOT_SENT, SDK_ONLY_NOT_SENT, SOURCES, CHECKED_ON
} = await import("./meta-creative-features.mjs");
const api = await import("./_api.mjs");

const PARTNER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "fake-meta-token-for-tests-only";
const CONN = {
  partner_id: PARTNER,
  external_ad_account_id: "act_555000111",
  encrypted_access_token: encryptToken(TOKEN, { partnerId: PARTNER })
};

/* A fake Meta. `answer(url, init)` returns { status, body, headers }. Every
   call is recorded with its parsed body. */
function fakeMeta(answer) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ url: String(url), method: init.method, body, headers: init.headers });
    const a = (await answer(String(url), { ...init, body })) || {};
    const status = a.status ?? 200;
    const headers = new Headers(a.headers || {});
    return {
      ok: status >= 200 && status < 300,
      status,
      headers,
      text: async () => (a.body === undefined ? "{}" : JSON.stringify(a.body))
    };
  };
  return { calls, fetch };
}

/* A clock the fake sleep moves, so no test waits for real. */
function fakeClock() {
  let t = 1_000_000;
  const sleeps = [];
  return {
    sleeps,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms; }
  };
}

const ctxFor = (m, clock = fakeClock(), extra = {}) =>
  ({ fetch: m.fetch, sleep: clock.sleep, now: clock.now, cooldown: new Map(), ...extra });

const metaError = (code, message = "throttled", status = 400) =>
  ({ status, body: { error: { message, code, type: "OAuthException" } } });

describe("API version", () => {
  test("meta.mjs defaults to v26.0 (META_API_VERSION overrides)", () => {
    if (process.env.META_API_VERSION) {
      assert.equal(meta.API_VERSION, process.env.META_API_VERSION);
    } else {
      assert.equal(meta.API_VERSION, "v26.0");
    }
  });
});

describe("createAd — always PAUSED, never a status from the caller", () => {
  test("the POST to /ads carries status PAUSED", async () => {
    const m = fakeMeta(() => ({ body: { id: "ad_1" } }));
    await meta.createAd(CONN, { name: "SLO Ad 91", external_ad_set_id: "set_1", external_creative_id: "cr_1" }, ctxFor(m));
    assert.equal(m.calls.length, 1);
    const c = m.calls[0];
    assert.equal(c.method, "POST");
    assert.match(c.url, new RegExp(`/${meta.API_VERSION}/act_555000111/ads$`));
    assert.equal(c.body.status, "PAUSED");
    assert.deepEqual(c.body.creative, { creative_id: "cr_1" });
  });

  for (const status of ["ACTIVE", "PAUSED", undefined, null]) {
    test(`a status argument (${String(status)}) is refused before anything is sent`, async () => {
      const m = fakeMeta(() => ({ body: { id: "ad_1" } }));
      await assert.rejects(
        meta.createAd(CONN, { name: "x", external_ad_set_id: "s", external_creative_id: "c", status }, ctxFor(m)),
        /takes no status/
      );
      assert.equal(m.calls.length, 0, "nothing reached Meta");
    });
  }
});

describe("createCreative — every enhancement off", () => {
  const SPEC = {
    name: "SLO Ad 91 — creative",
    page_id: "page_9",
    instagram_user_id: "ig_9",
    video_id: "vid_9",
    image_url: "https://scontent.example/thumb.jpg",
    message: "Primary text",
    title: "Headline",
    link_description: "Description",
    cta_type: "LEARN_MORE",
    link: "https://apply.fundhub.ai/roadmap/",
    url_tags: "utm_source=fb&utm_medium=paid&utm_campaign=slo&utm_content=91"
  };

  test("sends creative_features_spec with every listed key OPT_OUT, plus contextual_multi_ads OPT_OUT", async () => {
    const m = fakeMeta(() => ({ body: { id: "cr_9" } }));
    const out = await meta.createCreative(CONN, SPEC, ctxFor(m));
    assert.deepEqual(out, { creative_id: "cr_9" });
    const c = m.calls[0];
    assert.equal(c.method, "POST");
    assert.match(c.url, /\/act_555000111\/adcreatives$/);

    const cfs = c.body.degrees_of_freedom_spec.creative_features_spec;
    assert.deepEqual(Object.keys(cfs).sort(), [...META_CREATIVE_FEATURE_KEYS].sort());
    for (const k of META_CREATIVE_FEATURE_KEYS) {
      assert.deepEqual(cfs[k], { enroll_status: "OPT_OUT" }, k);
    }
    assert.deepEqual(c.body.contextual_multi_ads, { enroll_status: "OPT_OUT" });
    // Never OPT_IN anywhere in the request.
    assert.doesNotMatch(JSON.stringify(c.body), /OPT_IN/);
    // The deprecated bundle is not sent.
    assert.equal("standard_enhancements" in cfs, false);
  });

  test("object_story_spec uses instagram_user_id, video_data and a CTA link; UTMs ride in url_tags", async () => {
    const m = fakeMeta(() => ({ body: { id: "cr_9" } }));
    await meta.createCreative(CONN, SPEC, ctxFor(m));
    const b = m.calls[0].body;
    assert.deepEqual(b.object_story_spec, {
      page_id: "page_9",
      instagram_user_id: "ig_9",
      video_data: {
        video_id: "vid_9",
        image_url: "https://scontent.example/thumb.jpg",
        message: "Primary text",
        title: "Headline",
        link_description: "Description",
        call_to_action: { type: "LEARN_MORE", value: { link: "https://apply.fundhub.ai/roadmap/" } }
      }
    });
    assert.equal("instagram_actor_id" in b.object_story_spec, false);
    assert.equal(b.url_tags, SPEC.url_tags);
    assert.equal(b.name, SPEC.name);
  });

  test("image_hash works in place of image_url; both or neither is refused", async () => {
    const m = fakeMeta(() => ({ body: { id: "cr_9" } }));
    const { image_url, ...noImage } = SPEC;
    void image_url;
    await meta.createCreative(CONN, { ...noImage, image_hash: "abc123" }, ctxFor(m));
    assert.equal(m.calls[0].body.object_story_spec.video_data.image_hash, "abc123");
    assert.equal("image_url" in m.calls[0].body.object_story_spec.video_data, false);
    await assert.rejects(meta.createCreative(CONN, { ...SPEC, image_hash: "abc" }, ctxFor(m)), /exactly one/);
    await assert.rejects(meta.createCreative(CONN, noImage, ctxFor(m)), /exactly one/);
    assert.equal(m.calls.length, 1);
  });

  test("a link carrying utm_ is refused, and missing fields are named", async () => {
    const m = fakeMeta(() => ({ body: { id: "cr_9" } }));
    await assert.rejects(
      meta.createCreative(CONN, { ...SPEC, link: "https://apply.fundhub.ai/roadmap/?utm_content=91" }, ctxFor(m)),
      /url_tags, never in the link/
    );
    await assert.rejects(meta.createCreative(CONN, { image_url: "https://x/y.jpg" }, ctxFor(m)),
      /missing page_id, video_id, message, cta_type, link, url_tags/);
    assert.equal(m.calls.length, 0);
  });
});

describe("readCreativeFeatures — the read-back", () => {
  const allOff = () => Object.fromEntries(META_CREATIVE_FEATURE_KEYS.map((k) => [k, { enroll_status: "OPT_OUT" }]));

  test("asks for degrees_of_freedom_spec and contextual_multi_ads with a GET", async () => {
    const m = fakeMeta(() => ({
      body: { degrees_of_freedom_spec: { creative_features_spec: allOff() }, contextual_multi_ads: { enroll_status: "OPT_OUT" } }
    }));
    const r = await meta.readCreativeFeatures(CONN, "cr_9", ctxFor(m));
    assert.equal(m.calls[0].method, "GET");
    assert.match(m.calls[0].url, /\/cr_9\?fields=degrees_of_freedom_spec,contextual_multi_ads$/);
    assert.equal(r.all_opt_out, true);
    assert.deepEqual(r.opt_in, []);
    assert.equal(r.reason, null);
  });

  test("any OPT_IN makes all_opt_out false and names the key", async () => {
    const spec = { ...allOff(), inline_comment: { enroll_status: "OPT_IN" } };
    const m = fakeMeta(() => ({
      body: { degrees_of_freedom_spec: { creative_features_spec: spec }, contextual_multi_ads: { enroll_status: "OPT_OUT" } }
    }));
    const r = await meta.readCreativeFeatures(CONN, "cr_9", ctxFor(m));
    assert.equal(r.all_opt_out, false);
    assert.deepEqual(r.opt_in, ["inline_comment"]);
    assert.match(r.reason, /inline_comment/);
  });

  test("an OPT_IN on a key we never sent still stops the load", () => {
    const r = meta.creativeFeaturesVerdict({
      degrees_of_freedom_spec: { creative_features_spec: { ...allOff(), standard_enhancements: { enroll_status: "OPT_IN" } } },
      contextual_multi_ads: { enroll_status: "OPT_OUT" }
    });
    assert.equal(r.all_opt_out, false);
    assert.deepEqual(r.opt_in, ["standard_enhancements"]);
  });

  test("contextual_multi_ads OPT_IN stops it too", () => {
    const r = meta.creativeFeaturesVerdict({
      degrees_of_freedom_spec: { creative_features_spec: allOff() },
      contextual_multi_ads: { enroll_status: "OPT_IN" }
    });
    assert.equal(r.all_opt_out, false);
    assert.deepEqual(r.opt_in, ["contextual_multi_ads"]);
  });

  test("an unknown status counts as on (fails closed)", () => {
    const r = meta.creativeFeaturesVerdict({
      degrees_of_freedom_spec: { creative_features_spec: { ...allOff(), text_generation: { enroll_status: "DEFAULT_OPT_IN" } } }
    });
    assert.equal(r.all_opt_out, false);
    assert.deepEqual(r.opt_in, ["text_generation"]);
  });

  test("no creative_features_spec on the read proves nothing: not all off", () => {
    const r = meta.creativeFeaturesVerdict({ id: "cr_9" });
    assert.equal(r.all_opt_out, false);
    assert.equal(r.missing_spec, true);
    assert.match(r.reason, /cannot prove/);
  });

  test("keys Meta dropped as not applying are only listed as unconfirmed", () => {
    const { image_touchups, ...rest } = allOff();
    void image_touchups;
    const r = meta.creativeFeaturesVerdict({
      degrees_of_freedom_spec: { creative_features_spec: rest },
      contextual_multi_ads: { enroll_status: "OPT_OUT" }
    });
    assert.equal(r.all_opt_out, true);
    assert.deepEqual(r.unconfirmed, ["image_touchups"]);
  });
});

describe("video, thumbnail and image", () => {
  test("uploadVideo POSTs file_url to /act_<id>/advideos and returns the video id", async () => {
    const m = fakeMeta(() => ({ body: { id: "vid_42" } }));
    const out = await meta.uploadVideo(CONN, { file_url: "https://media.fundhub.ai/partners/p/final.mp4", name: "SLO Ad 91" }, ctxFor(m));
    assert.deepEqual(out, { video_id: "vid_42" });
    assert.equal(m.calls[0].method, "POST");
    assert.match(m.calls[0].url, /\/act_555000111\/advideos$/);
    assert.deepEqual(m.calls[0].body, { file_url: "https://media.fundhub.ai/partners/p/final.mp4", name: "SLO Ad 91" });
  });

  test("uploadVideo refuses an address that is not https", async () => {
    const m = fakeMeta(() => ({ body: { id: "vid_42" } }));
    await assert.rejects(meta.uploadVideo(CONN, { file_url: "file:///tmp/x.mp4" }, ctxFor(m)), /https file_url/);
    assert.equal(m.calls.length, 0);
  });

  test("getVideoStatus reads status.video_status once; anything new reads as processing", async () => {
    for (const [said, want] of [["ready", "ready"], ["processing", "processing"], ["error", "error"],
                                ["expired", "expired"], ["something_new", "processing"], [undefined, "processing"]]) {
      const m = fakeMeta(() => ({ body: { id: "vid_42", status: said === undefined ? undefined : { video_status: said } } }));
      assert.equal(await meta.getVideoStatus(CONN, "vid_42", ctxFor(m)), want, String(said));
      assert.equal(m.calls.length, 1);
      assert.equal(m.calls[0].method, "GET");
      assert.match(m.calls[0].url, /\/vid_42\?fields=status$/);
    }
  });

  test("getVideoThumbnails lists uri and is_preferred; preferredThumbnail picks Meta's choice", async () => {
    const m = fakeMeta(() => ({
      body: { data: [
        { id: "t1", uri: "https://scontent.example/1.jpg", is_preferred: false },
        { id: "t2", uri: "https://scontent.example/2.jpg", is_preferred: true },
        { id: "t3", is_preferred: false }
      ] }
    }));
    const list = await meta.getVideoThumbnails(CONN, "vid_42", ctxFor(m));
    assert.equal(m.calls[0].method, "GET");
    assert.match(m.calls[0].url, /\/vid_42\/thumbnails\?fields=uri,is_preferred$/);
    assert.deepEqual(list, [
      { uri: "https://scontent.example/1.jpg", is_preferred: false },
      { uri: "https://scontent.example/2.jpg", is_preferred: true }
    ]);
    assert.equal(meta.preferredThumbnail(list), "https://scontent.example/2.jpg");
    assert.equal(meta.preferredThumbnail([{ uri: "a", is_preferred: false }]), "a");
    assert.equal(meta.preferredThumbnail([]), null);
  });

  test("uploadImage sends base64 bytes to /adimages and returns the hash", async () => {
    const m = fakeMeta(() => ({ body: { images: { bytes: { hash: "h_77", url: "https://x/y.jpg" } } } }));
    const out = await meta.uploadImage(CONN, { bytes: Buffer.from("png-bytes") }, ctxFor(m));
    assert.deepEqual(out, { image_hash: "h_77" });
    assert.match(m.calls[0].url, /\/act_555000111\/adimages$/);
    assert.equal(m.calls[0].body.bytes, Buffer.from("png-bytes").toString("base64"));
  });

  test("uploadImage with only an address is refused in plain words, nothing sent", async () => {
    const m = fakeMeta(() => ({ body: {} }));
    await assert.rejects(meta.uploadImage(CONN, { url: "https://x/y.jpg" }, ctxFor(m)),
      (e) => e.code === "IMAGE_URL_NOT_UPLOADABLE" && /image_url/.test(e.message));
    assert.equal(m.calls.length, 0);
  });
});

describe("getAdSetGuardInfo — one GET, real fields only", () => {
  test("asks for status, dynamic creative, campaign category and the ad count", async () => {
    const m = fakeMeta(() => ({
      body: {
        id: "set_1", effective_status: "ACTIVE", is_dynamic_creative: false,
        campaign: { id: "c_1", special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" },
        ads: { data: [], summary: { total_count: 12 } }
      }
    }));
    const info = await meta.getAdSetGuardInfo(CONN, "set_1", ctxFor(m));
    assert.equal(m.calls[0].method, "GET");
    const fields = decodeURIComponent(new URL(m.calls[0].url).searchParams.get("fields"));
    assert.equal(fields,
      "effective_status,is_dynamic_creative,campaign{special_ad_categories,effective_status},ads.limit(0).summary(true)");
    assert.deepEqual(info, {
      effective_status: "ACTIVE", is_dynamic_creative: false, ad_count: 12,
      campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" }
    });
  });

  test("no ads key is 0 ads; an ads key with no count is unknown (null), never 0", () => {
    assert.equal(meta.adSetGuardInfoFrom({ effective_status: "ACTIVE" }).ad_count, 0);
    assert.equal(meta.adSetGuardInfoFrom({ ads: { data: [] } }).ad_count, null);
    assert.equal(meta.adSetGuardInfoFrom({}).campaign, null);
    assert.equal(meta.adSetGuardInfoFrom({}).is_dynamic_creative, null);
  });
});

describe("meta-creative-features.mjs — Meta's list, with where it came from", () => {
  test("the list has a date, sources, and no duplicates", () => {
    assert.match(CHECKED_ON, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(SOURCES.length >= 2);
    for (const s of SOURCES) assert.match(s.url, /^https:\/\/(developers\.facebook\.com|github\.com\/facebook)\//);
    assert.equal(new Set(META_CREATIVE_FEATURE_KEYS).size, META_CREATIVE_FEATURE_KEYS.length);
    for (const k of META_CREATIVE_FEATURE_KEYS) assert.match(k, /^[a-z0-9_]+$/);
    for (const k of Object.keys(NOT_SENT)) assert.equal(META_CREATIVE_FEATURE_KEYS.includes(k), false, k);
    for (const k of SDK_ONLY_NOT_SENT) assert.equal(META_CREATIVE_FEATURE_KEYS.includes(k), false, k);
    // The video features — the ones that touch our ads — are on it.
    for (const k of ["video_auto_crop", "video_filtering", "video_uncrop", "translate_voiceover",
                     "text_optimizations", "inline_comment", "text_generation", "music_generation"]) {
      assert.ok(META_CREATIVE_FEATURE_KEYS.includes(k), k);
    }
    assert.equal(META_CREATIVE_FEATURE_KEYS.includes("contextual_multi_ads"), false,
      "contextual_multi_ads is a field of the creative, not a creative_features_spec key");
  });
});

describe("_api.mjs — backing off", () => {
  beforeEach(() => api.resetBackoff());

  for (const code of [4, 17, 32, 613, 80004]) {
    test(`Meta code ${code} on a POST: wait, ask again, succeed`, async () => {
      let n = 0;
      const m = fakeMeta(() => (n++ === 0 ? metaError(code) : { body: { id: "ok" } }));
      const clock = fakeClock();
      const out = await api.callPlatform({ url: "https://graph.facebook.com/v26.0/act_1/ads", token: TOKEN, body: {}, ctx: ctxFor(m, clock) });
      assert.deepEqual(out, { id: "ok" });
      assert.equal(m.calls.length, 2);
      assert.deepEqual(clock.sleeps, [api.BASE_BACKOFF_MS]);
    });
  }

  test("429 is a throttle too", async () => {
    let n = 0;
    const m = fakeMeta(() => (n++ === 0 ? { status: 429, body: { error: { message: "slow", code: 0 } } } : { body: { id: "ok" } }));
    const clock = fakeClock();
    await api.callPlatform({ url: "https://graph.facebook.com/v26.0/x", token: TOKEN, body: {}, ctx: ctxFor(m, clock) });
    assert.equal(m.calls.length, 2);
    assert.equal(clock.sleeps.length, 1);
  });

  test("the pauses grow, and a throttle that never lifts ends retryable after MAX_RETRIES repeats", async () => {
    const m = fakeMeta(() => metaError(17, "User request limit reached"));
    const clock = fakeClock();
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/x", token: TOKEN, body: {}, ctx: ctxFor(m, clock) }),
      (e) => e.retryable === true && e.throttled === true && e.platformCode === 17 &&
             /User request limit reached/.test(e.platformMessage)
    );
    assert.equal(m.calls.length, 1 + api.MAX_RETRIES);
    assert.deepEqual(clock.sleeps, [api.BASE_BACKOFF_MS, api.BASE_BACKOFF_MS * 2]);
  });

  test("a 5xx on a POST is NOT repeated here (it may have created something); it stays retryable", async () => {
    const m = fakeMeta(() => ({ status: 500, body: { error: { message: "boom", code: 2 } } }));
    const clock = fakeClock();
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/act_1/ads", token: TOKEN, body: {}, ctx: ctxFor(m, clock) }),
      (e) => e.retryable === true && e.status === 500
    );
    assert.equal(m.calls.length, 1);
    assert.deepEqual(clock.sleeps, []);
  });

  test("a 5xx on a GET is repeated after a pause", async () => {
    let n = 0;
    const m = fakeMeta(() => (n++ === 0 ? { status: 503, body: {} } : { body: { data: [] } }));
    const clock = fakeClock();
    const out = await api.callPlatform({ url: "https://graph.facebook.com/v26.0/x", token: TOKEN, method: "GET", ctx: ctxFor(m, clock) });
    assert.deepEqual(out, { data: [] });
    assert.equal(m.calls.length, 2);
    assert.deepEqual(clock.sleeps, [api.BASE_BACKOFF_MS]);
  });

  test("a real rejection (code 100) is not repeated", async () => {
    const m = fakeMeta(() => metaError(100, "Invalid parameter"));
    const clock = fakeClock();
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/x", token: TOKEN, body: {}, ctx: ctxFor(m, clock) }),
      (e) => e.retryable === false && e.platformCode === 100
    );
    assert.equal(m.calls.length, 1);
    assert.deepEqual(clock.sleeps, []);
  });

  test("x-business-use-case-usage over 75%: the NEXT call to that connection waits first", async () => {
    const header = JSON.stringify({ "66782684": [{ type: "ads_management", call_count: 80, total_cputime: 20, total_time: 20, estimated_time_to_regain_access: 0 }] });
    const m = fakeMeta(() => ({ body: { id: "ok" }, headers: { "x-business-use-case-usage": header } }));
    const clock = fakeClock();
    const ctx = ctxFor(m, clock);
    await api.callPlatform({ url: "https://graph.facebook.com/v26.0/a", token: TOKEN, method: "GET", ctx });
    assert.deepEqual(clock.sleeps, [], "the first call goes straight out");
    await api.callPlatform({ url: "https://graph.facebook.com/v26.0/b", token: TOKEN, method: "GET", ctx });
    assert.equal(clock.sleeps.length, 1, "the second call waited");
    assert.ok(clock.sleeps[0] >= api.BASE_BACKOFF_MS && clock.sleeps[0] <= api.MAX_WAIT_MS, String(clock.sleeps[0]));
    assert.equal(m.calls.length, 2);
  });

  test("at or under 75% nothing waits", async () => {
    const header = JSON.stringify({ "1": [{ type: "ads_management", call_count: 75, total_cputime: 10, total_time: 60 }] });
    const m = fakeMeta(() => ({ body: {}, headers: { "x-business-use-case-usage": header } }));
    const clock = fakeClock();
    const ctx = ctxFor(m, clock);
    await api.callPlatform({ url: "https://graph.facebook.com/v26.0/a", token: TOKEN, method: "GET", ctx });
    await api.callPlatform({ url: "https://graph.facebook.com/v26.0/b", token: TOKEN, method: "GET", ctx });
    assert.deepEqual(clock.sleeps, []);
  });

  test("Meta's regain time longer than we hold a function open: nothing more is sent, retryAfterMs says when", async () => {
    const header = JSON.stringify({ "1": [{ type: "ads_management", call_count: 100, total_cputime: 30, total_time: 30, estimated_time_to_regain_access: 19 }] });
    const m = fakeMeta(() => ({ ...metaError(80004, "There have been too many calls to this ad-account."), headers: { "x-business-use-case-usage": header } }));
    const clock = fakeClock();
    const ctx = ctxFor(m, clock);
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/act_1/adcreatives", token: TOKEN, body: {}, ctx }),
      (e) => e.retryable === true && e.retryAfterMs === 19 * 60_000
    );
    assert.equal(m.calls.length, 1);
    assert.deepEqual(clock.sleeps, [], "never sleeps 19 minutes inside a function");

    // The next call to the same connection is not sent at all.
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/act_1/advideos", token: TOKEN, body: {}, ctx }),
      (e) => e.retryable === true && e.retryAfterMs > api.MAX_WAIT_MS && /slow down/.test(e.platformMessage)
    );
    assert.equal(m.calls.length, 1, "nothing reached Meta");
  });

  test("the usage header is read the way Meta documents it", () => {
    const h = new Headers({ "X-Business-Use-Case-Usage": JSON.stringify({
      "a": [{ type: "ads_insights", call_count: 97, total_cputime: 23, total_time: 23, estimated_time_to_regain_access: 0 }],
      "b": [{ type: "ads_management", call_count: 95, total_cputime: 20, total_time: 20, estimated_time_to_regain_access: 3 }]
    }) });
    assert.deepEqual(api.readBusinessUseCaseUsage(h), { percent: 97, regainMinutes: 3 });
    assert.deepEqual(api.readBusinessUseCaseUsage(new Headers()), { percent: null, regainMinutes: null });
    assert.deepEqual(api.readBusinessUseCaseUsage({ "x-business-use-case-usage": "not json" }), { percent: null, regainMinutes: null });
    assert.equal(api.usagePauseMs({ percent: 75 }), 0);
    assert.equal(api.usagePauseMs({ percent: 100 }), api.MAX_WAIT_MS);
    assert.equal(api.usagePauseMs({ percent: 10, regainMinutes: 2 }), 120_000);
  });

  test("the token never shows in an error", async () => {
    const m = fakeMeta(() => ({ status: 400, body: { error: { message: `bad token ${TOKEN}`, code: 190 } } }));
    await assert.rejects(
      api.callPlatform({ url: "https://graph.facebook.com/v26.0/x", token: TOKEN, body: {}, ctx: ctxFor(m) }),
      (e) => !e.message.includes(TOKEN) && !e.platformMessage.includes(TOKEN)
    );
  });
});

describe("nothing in the load path turns anything on, spends, or makes a campaign or ad set", () => {
  test("driving every load function sends no ACTIVE and never touches /campaigns or /adsets", async () => {
    const m = fakeMeta((url) => {
      if (/\/advideos$/.test(url)) return { body: { id: "vid_1" } };
      if (/fields=status$/.test(url)) return { body: { status: { video_status: "ready" } } };
      if (/\/thumbnails/.test(url)) return { body: { data: [{ uri: "https://t/1.jpg", is_preferred: true }] } };
      if (/\/adimages$/.test(url)) return { body: { images: { bytes: { hash: "h" } } } };
      if (/\/adcreatives$/.test(url)) return { body: { id: "cr_1" } };
      if (/degrees_of_freedom_spec/.test(url)) return { body: { degrees_of_freedom_spec: { creative_features_spec: {} } } };
      if (/fields=effective_status/.test(url)) return { body: { effective_status: "PAUSED" } };
      if (/\/ads$/.test(url)) return { body: { id: "ad_1" } };
      return { body: {} };
    });
    const ctx = ctxFor(m);
    const { video_id } = await meta.uploadVideo(CONN, { file_url: "https://media.fundhub.ai/partners/p/f.mp4" }, ctx);
    await meta.getVideoStatus(CONN, video_id, ctx);
    const thumbs = await meta.getVideoThumbnails(CONN, video_id, ctx);
    await meta.uploadImage(CONN, { bytes: "aGVsbG8=" }, ctx);
    const { creative_id } = await meta.createCreative(CONN, {
      page_id: "p", video_id, image_url: meta.preferredThumbnail(thumbs), message: "m",
      cta_type: "LEARN_MORE", link: "https://apply.fundhub.ai/x/", url_tags: "utm_source=fb"
    }, ctx);
    await meta.readCreativeFeatures(CONN, creative_id, ctx);
    await meta.getAdSetGuardInfo(CONN, "set_1", ctx);
    await meta.createAd(CONN, { name: "n", external_ad_set_id: "set_1", external_creative_id: creative_id }, ctx);

    for (const c of m.calls) {
      assert.doesNotMatch(JSON.stringify(c.body ?? {}), /"ACTIVE"/, c.url);
      assert.doesNotMatch(c.url, /\/(campaigns|adsets)(\?|$)/, c.url);
      if (c.body) assert.equal("daily_budget" in c.body || "lifetime_budget" in c.body, false, c.url);
    }
  });

  test("the load block of meta.mjs never calls resume, updateBudget, createCampaign or createAdSet", () => {
    const src = readFileSync(fileURLToPath(new URL("./meta.mjs", import.meta.url)), "utf8");
    const start = src.indexOf("LOADING A FINISHED VIDEO AS A PAUSED AD");
    const end = src.indexOf("/* fetchInsights");
    assert.ok(start > 0 && end > start, "the load block is where this test expects it");
    const block = src.slice(start, end);
    assert.doesNotMatch(block, /\b(resume|updateBudget|createCampaign|createAdSet)\s*\(/);
    assert.doesNotMatch(block, /["']ACTIVE["']/);
    assert.doesNotMatch(block, /\bfetch\s*\(/, "every call goes through callPlatform");
  });
});
