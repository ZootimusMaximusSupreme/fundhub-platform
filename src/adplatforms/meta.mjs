// Meta Marketing API adapter.
//
// ⚠️ CONFIRM BEFORE THIS RUNS LIVE. The endpoint shapes below follow the
// documented Marketing API, but have not been exercised against a real ad
// account — same status as the adapters in src/adapters/ carrying this marker.
// Confirm against one real call per operation before a partner's budget flows
// through it.
//
// THE SPECIAL AD CATEGORY IS READ FROM CONFIG AND IS MANDATORY. It is not a
// parameter this module accepts, because a caller able to pass it is a caller
// able to pass the wrong one. It comes from ad_platform_category_map via the
// campaign row, which the trigger in 046 populates and refuses to leave null.
//
// ⚠️ THE CONFIGURED VALUE IS UNSET AND FLAGGED. The spec named
// 'FINANCIAL_PRODUCTS_AND_SERVICES', which is not a Meta enum member, and for
// funding/credit_cards offers the applicable category is likely CREDIT. Rather
// than guess, ad_platform_category_map ships empty and every Meta write here
// fails closed until a human populates it. See 046's header.
//
// CAMPAIGN BUDGET OPTIMIZATION IS ON BY DEFAULT, per the spec: the budget lives
// on the campaign and Meta distributes it across ad sets.

import { callPlatform } from "./_api.mjs";
import { decryptToken } from "./tokens.mjs";
import { buildTargeting } from "../compliance/targeting.mjs";
import {
  creativeFeaturesOptOut,
  CONTEXTUAL_MULTI_ADS_FIELD
} from "./meta-creative-features.mjs";

export const PLATFORM = "meta";
/* v26.0 is the newest Marketing API version on 2026-10-04 (spec M0 step 5);
   META_API_VERSION overrides it. Read once, when the module loads. */
export const API_VERSION = process.env.META_API_VERSION || "v26.0";
const BASE = "https://graph.facebook.com";

/* Every call takes the connection row and derives its own token, so no caller
   ever holds a decrypted token longer than one request. */
function tokenFor(connection) {
  const t = decryptToken(connection.encrypted_access_token, { partnerId: connection.partner_id });
  if (!t) throw new Error("connection has no access token");
  return t;
}

const acct = (connection) => {
  const id = String(connection.external_ad_account_id || "");
  return id.startsWith("act_") ? id : `act_${id}`;
};

export async function createCampaign(connection, campaign, ctx = {}) {
  if (!campaign.special_ad_category) {
    // Belt to the database's braces. Reaching here with a null category means the
    // trigger was bypassed, and shipping without one is the compliance failure the
    // whole chain exists to prevent.
    throw new Error(
      "refusing to create a Meta campaign with no special_ad_category — " +
      "populate ad_platform_category_map (046)"
    );
  }

  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/campaigns`,
    token: tokenFor(connection),
    body: {
      name: campaign.name,
      objective: campaign.objective || "OUTCOME_LEADS",
      status: "PAUSED",                       // never created live; launch is a separate, gated step
      special_ad_categories: [campaign.special_ad_category],
      // Campaign budget optimization on by default (spec UNIT 5).
      daily_budget: String(campaign.budget_cents),
      bid_strategy: campaign.bid_strategy || "LOWEST_COST_WITHOUT_CAP"
    },
    ctx
  });
}

export async function createAdSet(connection, adSet, ctx = {}) {
  // buildTargeting throws with every reason at once rather than silently
  // correcting a payload — see src/compliance/targeting.mjs.
  const targeting = buildTargeting(adSet.targeting || {}, { platform: PLATFORM });

  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/adsets`,
    token: tokenFor(connection),
    body: {
      name: adSet.name,
      campaign_id: adSet.external_campaign_id,
      status: "PAUSED",
      targeting,
      billing_event: adSet.billing_event || "IMPRESSIONS",
      optimization_goal: adSet.optimization_goal || "OFFSITE_CONVERSIONS",
      // Omitted when the campaign carries the budget (CBO), which is the default.
      ...(adSet.budget_cents ? { daily_budget: String(adSet.budget_cents) } : {})
    },
    ctx
  });
}

/* createAd — always PAUSED. Only Chris turns an ad on (spec §2 item 6), and
   that is a separate, per-ad action. So this takes NO status at all: a caller
   that passes one — even "PAUSED" — is a caller that thinks it can choose, and
   it is refused before anything is sent. */
export async function createAd(connection, ad, ctx = {}) {
  if (ad && Object.prototype.hasOwnProperty.call(ad, "status")) {
    throw new Error("createAd takes no status: every new ad is loaded PAUSED, and only Chris turns ads on");
  }
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${acct(connection)}/ads`,
    token: tokenFor(connection),
    body: {
      name: ad.name,
      adset_id: ad.external_ad_set_id,
      status: "PAUSED",
      creative: { creative_id: ad.external_creative_id },
      // The AI-content disclosure, attached at publish time. Recorded on the ad
      // row as well, so "we disclosed" is auditable per ad rather than asserted.
      ...(ad.ai_disclosure ? { ad_labels: [{ name: ad.ai_disclosure }] } : {})
    },
    ctx
  });
}

export async function updateBudget(connection, { externalId, budgetCents }, ctx = {}) {
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${externalId}`,
    token: tokenFor(connection),
    body: { daily_budget: String(budgetCents) },
    ctx
  });
}

export const pause  = (connection, { externalId }, ctx = {}) =>
  callPlatform({ url: `${BASE}/${API_VERSION}/${externalId}`, token: tokenFor(connection),
                 body: { status: "PAUSED" }, ctx });

export const resume = (connection, { externalId }, ctx = {}) =>
  callPlatform({ url: `${BASE}/${API_VERSION}/${externalId}`, token: tokenFor(connection),
                 body: { status: "ACTIVE" }, ctx });

/* ═══════════════════════════════════════════════════════════════════════════
   LOADING A FINISHED VIDEO AS A PAUSED AD (spec §10.1, §10.2, §10.5)

   upload → wait until Meta says ready → thumbnail → creative (every
   enhancement OFF) → read the creative back → ad set guard → createAd (PAUSED).

   NOTHING HERE SPENDS OR TURNS ANYTHING ON. A video, an image, a creative and a
   paused ad cost nothing. No function in this block sends ACTIVE, changes a
   budget, or makes a campaign or an ad set. The order and the database writes
   are the loader's job (src/marketing/meta-load.mjs); it wraps each write in
   guardedWrite with the copy as screenSubject.

   Every field name asked for below is a field Meta's v26.0 types declare
   (checked 2026-10-05 against Meta's v26.0.2 Python SDK: AdVideo.status,
   VideoStatus.video_status, VideoThumbnail.uri/is_preferred, AdSet
   effective_status/is_dynamic_creative/campaign, Campaign
   special_ad_categories/effective_status, AdCreative degrees_of_freedom_spec/
   contextual_multi_ads). See the trap at VIDEO_INSIGHT_FIELDS below: one unknown
   field fails the whole request.

   ⚠️ NOT YET RUN AGAINST THE LIVE AD ACCOUNT. Proven with a fake Meta only
   (meta-load.test.mjs). The first real load is the confirmation. */

const graph = (path) => `${BASE}/${API_VERSION}/${path}`;

/* uploadVideo — POST /act_{id}/advideos with file_url. Meta fetches the file
   itself from that address (the R2 final), so no bytes pass through us.
   → { video_id } */
export async function uploadVideo(connection, { file_url, name } = {}, ctx = {}) {
  if (!/^https:\/\//i.test(String(file_url || ""))) {
    throw new Error("uploadVideo needs an https file_url Meta can download");
  }
  const res = await callPlatform({
    url: graph(`${acct(connection)}/advideos`),
    token: tokenFor(connection),
    body: { file_url, ...(name ? { name } : {}) },
    ctx
  });
  if (!res?.id) throw new Error("Meta did not return a video id");
  return { video_id: String(res.id) };
}

export const VIDEO_STATUSES = Object.freeze(["ready", "processing", "error", "expired"]);

/* getVideoStatus — asks ONCE. The loader re-queues itself every 10 s for up to
   20 minutes (spec §10.2); holding a function open to poll here would not fit.
   → 'ready' | 'processing' | 'error' | 'expired'. A value Meta adds later reads
   as 'processing' — never as ready — so the loader keeps waiting and its own
   20-minute limit records the failure. */
export async function getVideoStatus(connection, video_id, ctx = {}) {
  if (!video_id) throw new Error("getVideoStatus needs a video_id");
  const res = await callPlatform({
    url: graph(`${encodeURIComponent(String(video_id))}?fields=status`),
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  const s = String(res?.status?.video_status || "").toLowerCase();
  return VIDEO_STATUSES.includes(s) ? s : "processing";
}

/* getVideoThumbnails — GET /{video_id}/thumbnails.
   → [{ uri, is_preferred }], Meta's order kept. Entries with no uri dropped. */
export async function getVideoThumbnails(connection, video_id, ctx = {}) {
  if (!video_id) throw new Error("getVideoThumbnails needs a video_id");
  const res = await callPlatform({
    url: graph(`${encodeURIComponent(String(video_id))}/thumbnails?fields=uri,is_preferred`),
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  return (Array.isArray(res?.data) ? res.data : [])
    .filter((t) => t && typeof t.uri === "string" && t.uri)
    .map((t) => ({ uri: t.uri, is_preferred: t.is_preferred === true }));
}

/* preferredThumbnail(list) → the uri Meta marked preferred, else the first, else
   null. The loader puts it in createCreative as image_url (spec §10.2). */
export function preferredThumbnail(list = []) {
  const all = Array.isArray(list) ? list : [];
  return (all.find((t) => t?.is_preferred) || all[0])?.uri || null;
}

/* uploadImage — a custom thumbnail. POST /act_{id}/adimages with `bytes`
   (base64). Meta's v26 reference for this edge takes only `bytes` or
   `copy_from`; it has no "fetch this address" parameter. So a { url } is
   refused in plain words: put that address straight into createCreative as
   image_url instead (Meta saves it to the image library itself).
   → { image_hash } */
export async function uploadImage(connection, { url, bytes } = {}, ctx = {}) {
  if (bytes === undefined || bytes === null || bytes === "") {
    const e = new Error(url
      ? "Meta's image upload takes the picture itself, not a web address. Pass the address to createCreative as image_url instead."
      : "uploadImage needs the image bytes");
    e.code = url ? "IMAGE_URL_NOT_UPLOADABLE" : "NO_IMAGE";
    throw e;
  }
  const b64 = typeof bytes === "string" ? bytes : Buffer.from(bytes).toString("base64");
  const res = await callPlatform({
    url: graph(`${acct(connection)}/adimages`),
    token: tokenFor(connection),
    body: { bytes: b64 },
    ctx
  });
  // { images: { <name>: { hash, url, … } } } — one image in, one entry out.
  const first = Object.values(res?.images || {})[0];
  if (!first?.hash) throw new Error("Meta did not return an image hash");
  return { image_hash: String(first.hash) };
}

/* createCreative — a video ad creative with every enhancement OFF.

   object_story_spec: { page_id, instagram_user_id (the v22+ name; never
   instagram_actor_id), video_data: { video_id, image_url | image_hash, message,
   title, link_description, call_to_action: { type, value: { link } } } }

   url_tags carries the UTMs. They never go in the link itself (spec §10.3), so
   a link holding utm_ is refused.

   degrees_of_freedom_spec.creative_features_spec opts out of every key in
   meta-creative-features.mjs, and contextual_multi_ads (multi-advertiser ads —
   a field of the creative itself, not a creative_features_spec key) is
   OPT_OUT too. The caller then reads the creative back (readCreativeFeatures)
   and stops on any OPT_IN.
   → { creative_id } */
export async function createCreative(connection, spec = {}, ctx = {}) {
  const {
    name, page_id, instagram_user_id, video_id, image_url, image_hash,
    message, title, link_description, cta_type, link, url_tags
  } = spec;
  const missing = [];
  if (!page_id) missing.push("page_id");
  if (!video_id) missing.push("video_id");
  if (!message) missing.push("message");
  if (!cta_type) missing.push("cta_type");
  if (!link) missing.push("link");
  if (!url_tags) missing.push("url_tags");
  if (missing.length) throw new Error(`createCreative is missing ${missing.join(", ")}`);
  if (Boolean(image_url) === Boolean(image_hash)) {
    throw new Error("createCreative needs exactly one of image_url or image_hash");
  }
  if (/[?&]utm_/i.test(String(link))) {
    throw new Error("the UTMs go in url_tags, never in the link itself");
  }

  const video_data = {
    video_id: String(video_id),
    ...(image_url ? { image_url } : { image_hash }),
    message,
    ...(title ? { title } : {}),
    ...(link_description ? { link_description } : {}),
    call_to_action: { type: cta_type, value: { link } }
  };

  const res = await callPlatform({
    url: graph(`${acct(connection)}/adcreatives`),
    token: tokenFor(connection),
    body: {
      ...(name ? { name } : {}),
      object_story_spec: {
        page_id: String(page_id),
        ...(instagram_user_id ? { instagram_user_id: String(instagram_user_id) } : {}),
        video_data
      },
      url_tags: String(url_tags).replace(/^\?/, ""),
      degrees_of_freedom_spec: { creative_features_spec: creativeFeaturesOptOut() },
      [CONTEXTUAL_MULTI_ADS_FIELD]: { enroll_status: "OPT_OUT" }
    },
    ctx
  });
  if (!res?.id) throw new Error("Meta did not return a creative id");
  return { creative_id: String(res.id) };
}

/* readCreativeFeatures — read the creative back and say whether every
   enhancement is off. FAILS CLOSED:
     - any key whose enroll_status is not OPT_OUT (OPT_IN, or anything Meta
       invents later) is listed in opt_in;
     - no creative_features_spec on the read at all → all_opt_out false, because
       nothing was proved.
   A key we sent that Meta did not echo back is listed in `unconfirmed` only:
   Meta drops features that do not apply to the format (its own docs say so),
   and a feature that is not there cannot be on.
   → { all_opt_out, opt_in: [keys], unconfirmed: [keys], missing_spec, reason } */
export async function readCreativeFeatures(connection, creative_id, ctx = {}) {
  if (!creative_id) throw new Error("readCreativeFeatures needs a creative_id");
  const res = await callPlatform({
    url: graph(`${encodeURIComponent(String(creative_id))}?fields=degrees_of_freedom_spec,${CONTEXTUAL_MULTI_ADS_FIELD}`),
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  return creativeFeaturesVerdict(res);
}

/* creativeFeaturesVerdict(readBack) — the pure half of readCreativeFeatures. */
export function creativeFeaturesVerdict(readBack = {}) {
  const spec = readBack?.degrees_of_freedom_spec?.creative_features_spec;
  const missing_spec = !spec || typeof spec !== "object";
  const opt_in = [];
  if (!missing_spec) {
    for (const [key, detail] of Object.entries(spec)) {
      if (String(detail?.enroll_status || "") !== "OPT_OUT") opt_in.push(key);
    }
  }
  const cma = readBack?.[CONTEXTUAL_MULTI_ADS_FIELD];
  if (cma && String(cma.enroll_status || "") !== "OPT_OUT") opt_in.push(CONTEXTUAL_MULTI_ADS_FIELD);

  const sent = Object.keys(creativeFeaturesOptOut());
  const unconfirmed = missing_spec ? sent.slice() : sent.filter((k) => !(k in spec));
  if (!cma) unconfirmed.push(CONTEXTUAL_MULTI_ADS_FIELD);

  const all_opt_out = !missing_spec && opt_in.length === 0;
  const reason = all_opt_out ? null
    : missing_spec
      ? "Meta did not show the creative's enhancement settings, so we cannot prove they are off. The ad was not loaded."
      : `Meta has these enhancements turned on: ${opt_in.join(", ")}. The ad was not loaded.`;
  return { all_opt_out, opt_in, unconfirmed, missing_spec, reason };
}

/* getAdSetGuardInfo — what checkAdSetGuard (meta-guards.mjs) needs, in one GET.
   ads.limit(0).summary(total_count) asks Meta for the count without the list.
   summary takes named fields on this edge (v26 Ad Set "Ads" edge reference:
   https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ads/
   — total_count is one of them), so we name the field, not the generic `true`.
   → { effective_status, is_dynamic_creative, ad_count,
       campaign: { special_ad_categories, effective_status } } */
export async function getAdSetGuardInfo(connection, ad_set_external_id, ctx = {}) {
  if (!ad_set_external_id) throw new Error("getAdSetGuardInfo needs the ad set's Meta id");
  const fields = [
    "effective_status",
    "is_dynamic_creative",
    "campaign{special_ad_categories,effective_status}",
    "ads.limit(0).summary(total_count)"
  ].join(",");
  const res = await callPlatform({
    url: graph(`${encodeURIComponent(String(ad_set_external_id))}?fields=${encodeURIComponent(fields)}`),
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  return adSetGuardInfoFrom(res);
}

/* adSetGuardInfoFrom(answer) — the pure half. NULL means Meta did not say.
   An ad set with no ads at all can come back with no `ads` key; that is 0. An
   `ads` key with no readable count is null (unknown), never 0. */
export function adSetGuardInfoFrom(res = {}) {
  let ad_count;
  if (res?.ads === undefined || res?.ads === null) ad_count = 0;
  else {
    const n = Number(res.ads?.summary?.total_count);
    ad_count = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }
  const c = res?.campaign;
  return {
    effective_status: res?.effective_status ?? null,
    is_dynamic_creative: typeof res?.is_dynamic_creative === "boolean" ? res.is_dynamic_creative : null,
    ad_count,
    campaign: c && typeof c === "object"
      ? {
          special_ad_categories: Array.isArray(c.special_ad_categories) ? c.special_ad_categories.map(String) : null,
          effective_status: c.effective_status ?? null
        }
      : null
  };
}

/* fetchInsights — the metrics sync, and what the kill switch reads for ACTUAL
   spend. Deliberately goes to the platform every time rather than to
   ad_metrics_daily: the whole value of the independent check is that it does not
   share a failure mode with our mirror. */
export async function fetchInsights(connection, { externalId, since, until }, ctx = {}) {
  const params = new URLSearchParams({
    fields: "spend,impressions,reach,frequency,clicks,ctr,actions,cost_per_action_type,purchase_roas",
    time_range: JSON.stringify({ since, until }),
    level: "ad"
  });
  const res = await callPlatform({
    url: `${BASE}/${API_VERSION}/${externalId}/insights?${params}`,
    token: tokenFor(connection),
    method: "GET",
    ctx
  });
  return (res?.data || []).map(normalizeInsight);
}

/* THE EIGHT VIDEO FIELDS — where people stop watching an ad.

   Meta reports the drop-off curve for free on the same insights call we already
   make. The field names are Meta's; the column names are ours (378).

   ⚠️ EVERY NAME ON THE LEFT MUST BE A FIELD META ACTUALLY DECLARES. Meta refuses
   the WHOLE insights request when one field name is unknown — it does not skip
   the bad name and answer the rest — so a single invented field takes spend,
   clicks and impressions down with it and the connection looks completely
   broken. This list was checked on 2026-09-09 against Meta's own Python SDK
   field list, facebook_business/adobjects/adsinsights.py.

   THERE IS NO 3-SECOND FIELD. Not video_3sec_watched_actions, not
   video_3_sec_watched_actions. We asked for one until 2026-09-09 and it would
   have broken every sync. The real field closest in meaning is
   video_continuous_2_sec_watched_actions — "kept watching past the opening" —
   and our column is named after what it holds, not after 3 seconds.

   video_play_actions is how many plays STARTED at all. It is the honest
   denominator for a hook-style rate and it is free on this same request.

   video_play_curve_actions is Meta's second-by-second retention curve (confirmed
   on developers.facebook.com Ad Account Insights, 2026-09-27). It is a LIST of
   percentages, not one count — so it is not in VIDEO_INSIGHT_FIELDS (those all
   go through watchedActionCount). It is still on the same request. Stored as
   jsonb on ad_metrics_daily.video_play_curve (394).

   REQUEST_FIELDS is exported so the request and the parser can never drift
   apart: the list a caller asks Meta for is literally the list this file knows
   how to read. */
export const VIDEO_INSIGHT_FIELDS = Object.freeze([
  ["video_continuous_2_sec_watched_actions", "video_continuous_2s_watched"],
  ["video_play_actions",                     "video_plays"],
  ["video_p25_watched_actions",              "video_p25_watched"],
  ["video_p50_watched_actions",              "video_p50_watched"],
  ["video_p75_watched_actions",              "video_p75_watched"],
  ["video_p95_watched_actions",              "video_p95_watched"],
  ["video_p100_watched_actions",             "video_p100_watched"],
  ["video_thruplay_watched_actions",         "video_thruplay_watched"]
]);

/* Meta's exact field name for the second-by-second curve. Do not rename. */
export const VIDEO_PLAY_CURVE_FIELD = "video_play_curve_actions";
export const VIDEO_PLAY_CURVE_COLUMN = "video_play_curve";

/* The names to put in the insights request's `fields` parameter. */
export const VIDEO_INSIGHT_REQUEST_FIELDS = Object.freeze([
  ...VIDEO_INSIGHT_FIELDS.map(([metaField]) => metaField),
  VIDEO_PLAY_CURVE_FIELD
]);

/* watchedActionCount — turn one of Meta's action arrays into one number, or
   null.

   THESE FIELDS ARE NOT NUMBERS. Meta answers each of them with a LIST of
   objects, `[{ action_type: "video_view", value: "1234" }]`, and `value` is a
   STRING. Reading `Number(row.video_p25_watched_actions)` gives NaN, which
   stores as NULL and looks forever like "Meta has no data" — so the shape is
   handled here, once, and unit-tested in meta-video.test.mjs.

   NULL WHEN META DID NOT ANSWER, NEVER 0. A photo ad has no video fields at
   all; a video ad nobody watched has real zeros. Those are different facts
   (378's header) and this function keeps them apart: absent, empty or
   unreadable → null; a number Meta actually sent → that number, zero included.

   WHY THE LARGEST VALUE AND NOT THE SUM. With no breakdown requested the list
   holds exactly one entry and every rule agrees. With a breakdown Meta returns
   the parts AND their total in the same list, so adding them up counts the same
   people twice — silently, with no error. Taking the largest is right in both
   cases. `video_view` entries win over any other action_type, because that is
   the row these fields are actually about.

   video_play_actions IS THE ONE FIELD HERE WHOSE ROWS ARE NOT `video_view` —
   Meta labels them `video_play`. They land on the fallback path, where the
   largest entry still wins, so the answer is the same. No special case is
   needed and none is added. */
export function watchedActionCount(field) {
  if (field === null || field === undefined) return null;

  // Defensive: if Meta ever hands one of these back as a plain number or a
  // numeric string, use it rather than throwing the value away.
  if (!Array.isArray(field)) {
    const direct = countOrNull(field);
    return direct;
  }

  let best = null;      // largest value seen on a video_view entry
  let fallback = null;  // largest value seen on any other entry
  for (const entry of field) {
    if (!entry || typeof entry !== "object") continue;
    const v = countOrNull(entry.value);
    if (v === null) continue;
    if (entry.action_type === "video_view") best = best === null ? v : Math.max(best, v);
    else fallback = fallback === null ? v : Math.max(fallback, v);
  }
  return best !== null ? best : fallback;
}

/* countOrNull — a whole, non-negative count, or null. Empty string, null,
   undefined, NaN, Infinity and negatives are all "no answer" rather than 0;
   ad_metrics_daily_video_nonneg_ck (378) would refuse a negative anyway. */
function countOrNull(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/* playCurveActions — Meta's video_play_curve_actions → number[] or null.
 *
 * Shape (Ad Account Insights): a list of { action_type, value }, where value
 * is the array of percentages for buckets 0–21. Absent / empty / unreadable →
 * null (same rule as the count fields: photo ads have no curve). */
export function playCurveActions(field) {
  if (field === null || field === undefined) return null;
  if (Array.isArray(field) && field.length && typeof field[0] === "number") {
    return field.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  }
  if (!Array.isArray(field) || field.length === 0) return null;

  let best = null;
  let fallback = null;
  for (const entry of field) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry.value;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const nums = raw.map((v) => Number(v)).filter((n) => Number.isFinite(n));
    if (nums.length === 0) continue;
    if (entry.action_type === "video_view") best = nums;
    else if (fallback === null) fallback = nums;
  }
  return best !== null ? best : fallback;
}

/* videoMetrics — every video field on one insights row, keyed by OUR column
   names. Count keys are always present (number or null). The curve key is
   always present (number[] or null). */
export function videoMetrics(row = {}) {
  const out = {};
  for (const [metaField, column] of VIDEO_INSIGHT_FIELDS) {
    out[column] = watchedActionCount(row[metaField]);
  }
  out[VIDEO_PLAY_CURVE_COLUMN] = playCurveActions(row[VIDEO_PLAY_CURVE_FIELD]);
  return out;
}

/* normalizeInsight — Meta returns money as decimal STRINGS in the account
   currency. Everything downstream is integer cents, so the conversion happens
   once, here. Doing it at each call site is how a rounding bug gets into the
   ceiling maths. */
export function normalizeInsight(row) {
  const conversions = sumActions(row.actions);
  return {
    external_id: row.ad_id || row.id,
    date: row.date_start,
    spend_cents: toCents(row.spend),
    impressions: int(row.impressions),
    reach: int(row.reach),
    frequency: num(row.frequency),
    clicks: int(row.clicks),
    ctr: num(row.ctr),
    conversions,
    cpa_cents: conversions > 0 ? Math.round(toCents(row.spend) / conversions) : null,
    roas: num(row.purchase_roas?.[0]?.value),
    // The eight video counts plus the play curve. null when Meta did not
    // report them — see videoMetrics, 378, and 394.
    ...videoMetrics(row)
  };
}

const sumActions = (actions) => (Array.isArray(actions) ? actions : [])
  .filter((a) => /purchase|lead|complete_registration/i.test(a.action_type || ""))
  .reduce((n, a) => n + int(a.value), 0);

const toCents = (v) => Math.round(Number(v || 0) * 100);
const int = (v) => Math.trunc(Number(v || 0));
const num = (v) => (v === undefined || v === null || v === "" ? null : Number(v));

/* Agency (Business-to-Business) helpers. These use Fundhub's agency Business +
   system-user token — not Social Studio OAuth. The client must still Approve
   once in Meta Business Settings → Requests; we cannot skip that click. */

export function normalizeMetaBusinessId(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits || null;
}

export function normalizeMetaAdAccountId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const bare = s.replace(/^act_/i, "").replace(/\D/g, "");
  return bare ? `act_${bare}` : null;
}

export function pendingAdAccountPlaceholder(businessId) {
  const biz = normalizeMetaBusinessId(businessId);
  if (!biz) throw new Error("pendingAdAccountPlaceholder: businessId required");
  return `pending:biz:${biz}`;
}

/* POST /{agencyBusinessId}/managed_businesses — request partnership by the
   client's Meta Business ID. Capability varies by app; callers must handle
   platform errors and still queue a pending CRM row. */
export async function requestManagedBusiness(
  { agencyBusinessId, clientBusinessId, accessToken },
  ctx = {}
) {
  const agency = normalizeMetaBusinessId(agencyBusinessId);
  const client = normalizeMetaBusinessId(clientBusinessId);
  if (!agency || !client) throw new Error("agency and client business ids required");
  if (!accessToken) throw new Error("accessToken required");
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${agency}/managed_businesses`,
    token: accessToken,
    body: { existing_client_business_id: client },
    ctx
  });
}

/* POST /{agencyBusinessId}/client_ad_accounts — request agency tasks on a known
   client ad account. Often needs App capability / Marketing Partner status. */
export async function requestClientAdAccountAccess(
  { agencyBusinessId, adAccountId, accessToken, permittedTasks = ["ADVERTISE", "ANALYZE"] },
  ctx = {}
) {
  const agency = normalizeMetaBusinessId(agencyBusinessId);
  const act = normalizeMetaAdAccountId(adAccountId);
  if (!agency || !act) throw new Error("agency business id and ad account id required");
  if (!accessToken) throw new Error("accessToken required");
  return callPlatform({
    url: `${BASE}/${API_VERSION}/${agency}/client_ad_accounts`,
    token: accessToken,
    body: {
      adaccount_id: act,
      permitted_tasks: permittedTasks
    },
    ctx
  });
}

export default {
  PLATFORM, API_VERSION, createCampaign, createAdSet, createAd, updateBudget, pause, resume, fetchInsights,
  uploadVideo, getVideoStatus, getVideoThumbnails, preferredThumbnail, uploadImage,
  createCreative, readCreativeFeatures, creativeFeaturesVerdict,
  getAdSetGuardInfo, adSetGuardInfoFrom, VIDEO_STATUSES,
  watchedActionCount, playCurveActions, videoMetrics,
  VIDEO_INSIGHT_FIELDS, VIDEO_INSIGHT_REQUEST_FIELDS,
  VIDEO_PLAY_CURVE_FIELD, VIDEO_PLAY_CURVE_COLUMN,
  normalizeMetaBusinessId, normalizeMetaAdAccountId, pendingAdAccountPlaceholder,
  requestManagedBusiness, requestClientAdAccountAccess
};
