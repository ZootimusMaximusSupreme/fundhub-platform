// The Meta loader: one approved video in, one PAUSED Meta ad out.
//
// Job kind `meta_load` (src/marketing/job-kinds.mjs, group 'loader'), payload
// {ad_video_id}. Queued by POST /api/marketing/meta/load; read back by
// GET /api/marketing/meta/load-status. Spec docs/specs/marketing-machine-2026-10-04.md
// §10.2 (the steps), §10.4 (our rows), §10.5 (guards, routes), §2 items 6 and 11
// (load paused only; only Chris turns an ad on). Build plan unit U28.
//
// THE STEPS, IN ORDER. Each one saves what it got before the next one starts,
// so a run that dies anywhere starts again from the last saved id:
//
//   preflight ─ refuse in plain words (no approval, no Meta copy, no funnel or
//   │           default ad set, final video not in storage, no Page id …)
//   screen ──── the compliance screen on the Meta copy (screenAndRecord)
//   upload ──── uploadVideo with a 24-hour signed R2 link → meta_video_id saved at once
//   wait ────── getVideoStatus once; still processing → re-queue 10 s out, for
//   │           up to 20 minutes; error / expired / 20 minutes → failed
//   thumbnail ─ the preferred thumbnail uri → image_url
//   creative ── createCreative (url_tags from buildUrlTags, every enhancement
//   │           OPT_OUT) → meta_creative_id saved at once
//   read back ─ readCreativeFeatures; any OPT_IN → refused
//   guard ───── getAdSetGuardInfo + checkAdSetGuard (archived, dynamic
//   │           creative, 50 ads, special ad category)
//   claim ───── reserve our ads row id on the video (ad_row_id) before Meta is asked
//   createAd ── PAUSED (meta.mjs hardcodes it) → meta_ad_external_id saved at once
//   finish ──── ONE short transaction: creative_assets + ads (ON CONFLICT
//               (connection_id, external_id) DO UPDATE, source 'loader') + loaded_at
//
// NOTHING HERE TURNS AN AD ON. This file never sends ACTIVE and never calls
// resume, updateBudget, createCampaign or createAdSet. meta-load.test.mjs reads
// this file's source and fails if any of those words appear in code.
//
// NO TRANSACTION IS HELD OPEN ACROSS A META CALL (spec §4 trap 3). guardedWrite
// (src/adplatforms/index.mjs) screens, logs to action_log and then calls Meta,
// all on the handle it is given. Handed a real transaction it would hold that
// transaction open while Meta answers. So the loader hands it a STAFF HANDLE
// whose every query is its own short asStaff() transaction: the screen reads,
// the action_log row is committed BEFORE Meta is called (the log-first rule in
// index.mjs holds, and is now durable even if the call dies), Meta is called
// with nothing open, and executed_at is stamped in a third short transaction.
// The wait loop holds nothing: it re-queues the job and returns.
//
// THE APPROVAL RULE (screen.mjs trap). screen() defaults approveBeforeLaunch to
// true and answers needs_approval, which is not a pass. The approval it asks
// for is a person's: ad_videos.approved_at with an approver, which only a human
// can set (HUMAN_ONLY in src/ad-videos/states.mjs). The preflight refuses any
// video without it, so the screen is asked with approveBeforeLaunch false only
// for a video a person approved. credit_repair still always needs approval in
// screen.mjs; a campaign of that offer type is refused with the screen's words.
//
// HOW A RUN ENDS (the worker contract in job-kinds.mjs: a return finishes the
// job, a throw fails it and the queue tries again):
//   loaded / refused / busy      → returned; the worker marks the job done with
//                                  this result (load-status reads it).
//   waiting on Meta, slow down   → this file calls requeueJob itself (no attempt
//                                  counted) and returns; the worker's finishJob
//                                  then finds the job queued and changes nothing.
//   failed for good              → this file calls failJob(final) itself and
//                                  returns; same no-op finish. Retry re-queues it.
//   a passing hiccup (Meta 5xx,  → thrown; the queue retries it (1 min, 5 min,
//   unreachable, our database)     then failed with the reason).
//
// THE TWO PARTNERS (measured on production 2026-10-06, read-only). The Meta
// connection and its campaigns, ad sets and ads sit on partner fundhub-direct;
// ad_videos and ad_scripts sit on fundhub-house. creative_assets follows the
// video (house): its storage_key must start with partners/<partner_id>/ (045)
// and its script must share its partner (377). ads follows its ad set (046).
// trg_ads_asset_partner (377) refuses an ads.asset_id from another partner, so
// when the two differ the ads row is written with asset_id NULL and the ad is
// tied to its script by fundhub_ad_number alone. Reported as a gap, not hidden.

import { db as defaultDb } from "../db.mjs";
import { asStaff as defaultAsStaff } from "../partners/rls.mjs";
import { enqueueJob, requeueJob, failJob } from "./jobs.mjs";
import { offerFacts } from "./offer-facts.mjs";
import { buildUrlTags } from "./url-tags.mjs";
import { presignR2, DEFAULT_EXPIRES_SEC } from "../storage/r2-sign.mjs";
import { checkAdSetGuard } from "../adplatforms/meta-guards.mjs";
import * as metaAdapter from "../adplatforms/meta.mjs";
import { guardedWrite as defaultGuardedWrite } from "../adplatforms/index.mjs";
import { screenAndRecord } from "../compliance/screen.mjs";

export const META_LOAD_KIND = "meta_load";

/** Meta is asked once per run; a video still processing comes back this soon. */
export const POLL_EVERY_MS = 10_000;

/** After this long since the upload, a video Meta is still processing has failed. */
export const WAIT_LIMIT_MS = 20 * 60_000;

/** Only a video a person approved is loaded (389: approved needs approved_at). */
export const APPROVED_STATES = Object.freeze(["approved", "delivered"]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AD_NUMBER_RE = /^(0|[1-9][0-9]{0,8})$/;

/* ── the words Chris reads on the Launch tab ─────────────────────────────── */

export const REASONS = Object.freeze({
  NO_JOB_VIDEO: "This load does not say which video to send.",
  GONE: "This video is not in our records anymore.",
  NOT_APPROVED: "A person has not approved this video yet. Approve it on the Videos tab first.",
  NOT_AN_AD: "This video is not an ad, so it does not go to Meta.",
  AD_NUMBER: "This video has no good ad number.",
  NO_SCRIPT: "This video is not tied to a script yet.",
  NO_META_COPY: "The script has no Meta copy yet (the words that go on the ad).",
  NO_FUNNEL: "The script is not tied to a funnel.",
  funnelGone: (key) => `The script's funnel "${key}" is not in Settings.`,
  noAdSet: (name) => `The ${name} funnel has no default ad set. Set it in Settings.`,
  AD_SET_NOT_SYNCED: "That ad set is not in our records yet. It shows up after the next Meta pull.",
  NO_CAMPAIGN: "We do not know which campaign that ad set is in yet. It shows up after the next Meta pull.",
  connection: (state) => `The Meta connection for that ad set is not working (it says ${state || "nothing"}).`,
  UTM_IN_LINK: "The funnel's link already has tracking tags in it. Take them out; the loader adds its own.",
  lane: (lane) => `The funnel's lane "${lane}" is not one our tracking knows, so leads could not be tied to this ad.`,
  NOT_IN_STORAGE: "The final video is not in storage yet.",
  NO_STORAGE_KEYS: "The final video is in storage, but this site cannot make a link to it yet (the storage keys are not set).",
  NO_PAGE: "We do not know which Facebook Page the ad posts as yet (META_PAGE_ID is not set).",
  NO_INSTAGRAM: "We do not know which Instagram account the ad posts as yet (META_INSTAGRAM_USER_ID is not set).",
  BUSY: "Another load of this ad is running now.",
  TIMEOUT: "Meta was still working on the video after 20 minutes. Press Retry to send it again.",
  videoBroken: (status) => `Meta could not use this video (it says ${status}). Press Retry to send it again.`,
  metaSaidNo: (msg) => `Meta said no: ${String(msg || "no reason given").trim()}`,
  screen: (msg) => `Our copy screen stopped this: ${String(msg || "no reason given").trim()}`
});

/* ── small pure helpers ──────────────────────────────────────────────────── */

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

/** An env value, or null when it is unset, blank or a masked copy (****). */
export function envValue(env, name) {
  const v = String(env?.[name] ?? "").trim();
  return v && !v.includes("*") ? v : null;
}

/** The ad name: '<Offer> Ad <n> — <angle>'. No angle → '<Offer> Ad <n>'. */
export function adName({ offerLabel, adNumber, angle } = {}) {
  const label = clean(offerLabel) || "Fundhub";
  const a = clean(angle).slice(0, 150);
  return a ? `${label} Ad ${adNumber} — ${a}` : `${label} Ad ${adNumber}`;
}

/** ad_scripts.meta_copy ({primary_text, headline, description, cta_type}) → trimmed, or null without primary text. */
export function metaCopyOf(raw) {
  let c = raw;
  if (typeof c === "string") { try { c = JSON.parse(c); } catch { return null; } }
  if (!c || typeof c !== "object" || Array.isArray(c)) return null;
  const primary_text = String(c.primary_text ?? "").trim();
  if (!primary_text) return null;
  return {
    primary_text,
    headline: String(c.headline ?? "").trim() || null,
    description: String(c.description ?? "").trim() || null,
    cta_type: String(c.cta_type ?? "").trim() || null
  };
}

/**
 * True when the key is an R2 final key for this partner: it starts with
 * partners/<partner_id>/ (what creative_assets' 045 check needs). Today's live
 * shapes — NULL, or 'drive:<id>' from the old pipeline — are not.
 */
export function isR2FinalKey(key, partnerId) {
  const k = String(key ?? "");
  const p = String(partnerId ?? "").toLowerCase();
  if (!UUID_RE.test(p)) return false;
  return k.startsWith(`partners/${p}/`) && k.length > `partners/${p}/`.length;
}

/** The R2 settings from env, or null when any is missing or masked (Appendix D names). */
export function r2Config(env = process.env) {
  const accountId = envValue(env, "CLOUDFLARE_ACCOUNT_ID");
  const bucket = envValue(env, "R2_BUCKET_AD_VIDEO");
  const accessKeyId = envValue(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = envValue(env, "R2_SECRET_ACCESS_KEY");
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

/**
 * finalVideoUrl(row, env) → a 24-hour signed R2 GET link to the finished ad, or
 * null. Null when storage_final_key is not an R2 key for the row's partner, when
 * the R2 settings are not all set, or when the signer refuses. Meta downloads
 * the file from this link itself (uploadVideo's file_url). Pure: no network.
 */
export function finalVideoUrl(row, env = process.env, { now = new Date() } = {}) {
  if (!row || !isR2FinalKey(row.storage_final_key, row.partner_id)) return null;
  const cfg = r2Config(env);
  if (!cfg) return null;
  try {
    return presignR2({ method: "GET", ...cfg, key: row.storage_final_key, expiresSec: DEFAULT_EXPIRES_SEC, now });
  } catch {
    return null;
  }
}

/** A person approved it: an approved state, approved_at, and an approver (389). */
export function isPersonApproved(video) {
  return !!video &&
    APPROVED_STATES.includes(String(video.status)) &&
    video.approved_at != null &&
    clean(video.approved_by) !== "";
}

/**
 * planLoad(context, env, { now }) → { reasons, ...what the steps need }.
 * Every refusal is collected, so Chris sees them all at once. Pure.
 */
export function planLoad(c = {}, env = process.env, { now = new Date() } = {}) {
  const reasons = [];
  const v = c.video || {};
  const s = c.script || null;
  const f = c.funnel || null;

  if (!isPersonApproved(v)) reasons.push(REASONS.NOT_APPROVED);
  if (v.video_kind && v.video_kind !== "ad") reasons.push(REASONS.NOT_AN_AD);
  const adNumber = String(v.ad_id ?? "");
  const goodNumber = AD_NUMBER_RE.test(adNumber);
  if (!goodNumber) reasons.push(REASONS.AD_NUMBER);

  let fileUrl = null;
  if (!isR2FinalKey(v.storage_final_key, v.partner_id)) reasons.push(REASONS.NOT_IN_STORAGE);
  else {
    fileUrl = finalVideoUrl(v, env, { now });
    if (!fileUrl) reasons.push(REASONS.NO_STORAGE_KEYS);
  }

  let copy = null;
  if (!s) reasons.push(REASONS.NO_SCRIPT);
  else {
    copy = metaCopyOf(s.meta_copy);
    if (!copy) reasons.push(REASONS.NO_META_COPY);
    if (!s.funnel_key) reasons.push(REASONS.NO_FUNNEL);
    else if (!f) reasons.push(REASONS.funnelGone(s.funnel_key));
  }

  let urlTags = null;
  if (f) {
    if (!f.default_ad_set_external_id) reasons.push(REASONS.noAdSet(clean(f.name) || f.key));
    else if (!c.adSet) reasons.push(REASONS.AD_SET_NOT_SYNCED);
    else if (!c.campaign) reasons.push(REASONS.NO_CAMPAIGN);
    else if (!c.connection || c.connection.platform !== "meta" || c.connection.connection_state !== "active") {
      reasons.push(REASONS.connection(c.connection?.connection_state));
    }
    if (/[?&]utm_/i.test(String(f.landing_url || ""))) reasons.push(REASONS.UTM_IN_LINK);
    if (goodNumber) {
      try { urlTags = buildUrlTags({ lane: f.lane, adNumber }); }
      catch { reasons.push(REASONS.lane(f.lane)); }
    }
  }

  const pageId = envValue(env, "META_PAGE_ID");
  const instagramUserId = envValue(env, "META_INSTAGRAM_USER_ID");
  if (!pageId) reasons.push(REASONS.NO_PAGE);
  if (!instagramUserId) reasons.push(REASONS.NO_INSTAGRAM);

  const offerLabel = (f && offerFacts(f.offer_key)?.label) || (f && clean(f.name)) || null;
  const name = adName({ offerLabel, adNumber, angle: s?.title || null });

  return {
    reasons,
    adNumber,
    fileUrl,
    copy,
    urlTags,
    name,
    pageId,
    instagramUserId,
    link: f?.landing_url || null,
    ctaType: copy?.cta_type || f?.cta_type || null,
    offerType: c.campaign?.offer_type || null
  };
}

/** The words the screen reads: the Meta copy, as Meta will show it. */
export function copyText(copy) {
  if (!copy) return "";
  return [copy.primary_text, copy.headline, copy.description].filter(Boolean).join("\n");
}

/** The screen's reasons as plain sentences. */
export function screenReasons(verdict) {
  const list = Array.isArray(verdict?.reasons) ? verdict.reasons : [];
  const out = list.filter((r) => r && r.severity !== "warn").map((r) => REASONS.screen(r.message || r.code));
  return out.length ? out : [REASONS.screen(`it came back ${verdict?.state || "with no answer"}`)];
}

/* ── the run ─────────────────────────────────────────────────────────────── */

const isPlatformError = (e) => !!e && typeof e === "object" && "platformMessage" in e;

/**
 * runLoad(job, deps) — the whole load for one job. Every outside piece is
 * passed in, so the test drives it with a fake Meta and a fake store.
 *
 * deps: { store, meta, guardedWrite, screen, jobs: {requeue(id, runAfter), fail(id, reason)},
 *         env, now() → ms, metaCtx }
 */
export async function runLoad(job, deps) {
  const { store, meta, jobs, env = process.env, metaCtx = {} } = deps;
  const now = typeof deps.now === "function" ? deps.now : Date.now;
  const guarded = deps.guardedWrite;
  const screen = deps.screen;
  const orgId = job?.org_id;
  const adVideoId = job?.payload?.ad_video_id;
  const jobId = job?.id || null;
  const requestedBy = job?.payload?.requested_by || job?.requested_by || null;

  if (!UUID_RE.test(String(adVideoId || "")) || !orgId) {
    return { state: "refused", reasons: [REASONS.NO_JOB_VIDEO] };
  }

  const c = await store.loadContext({ orgId, adVideoId, jobId });
  if (!c.video) return { state: "refused", reasons: [REASONS.GONE] };
  if (c.video.loaded_at) return { state: "loaded", already: true, ...idsOf(c.video) };
  if (c.otherRunning) return { state: "busy", reasons: [REASONS.BUSY] };

  const video = { ...c.video };
  let notes = [];

  const refuse = async (reasons, clear = {}) => {
    await store.recordStop({ orgId, adVideoId, loadError: reasons.join(" "), clear });
    return { state: "refused", reasons };
  };
  const failForGood = async (reason, clear = {}) => {
    await store.recordStop({ orgId, adVideoId, loadError: reason, clear });
    await jobs.fail(jobId, reason);
    return { state: "failed", reasons: [reason] };
  };
  const comeBackIn = async (ms, why) => {
    await jobs.requeue(jobId, new Date(now() + Math.max(POLL_EVERY_MS, Number(ms) || 0)));
    return { state: "waiting", why, ...idsOf(video) };
  };

  const plan = planLoad(c, env, { now: new Date(now()) });
  if (plan.reasons.length) return refuse(plan.reasons);

  const conn = c.connection;
  const handle = store.staffHandle();
  const subject = {
    kind: "ad",
    offerType: plan.offerType,
    text: copyText(plan.copy),
    aiGenerated: false,
    // A person approved this video (planLoad refused anything else), so the
    // screen's approve-before-launch gate is already met. See the header.
    approveBeforeLaunch: !isPersonApproved(c.video),
    subjectId: c.video.id
  };

  /* 1. THE SCREEN, once up front, with its audit row. guardedWrite screens
     again before each write. */
  const verdict = await screen(handle, { ...subject, orgId, partnerId: conn.partner_id, platform: "meta" });
  if (!verdict || verdict.state !== "passed") return refuse(screenReasons(verdict));

  await store.clearLoadError({ orgId, adVideoId });

  /* One Meta write, through guardedWrite on the staff handle. Returns
     { result } or { stop } (the run's answer when it cannot go on). */
  const write = async (step, targetType, call) => {
    let thrown = null;
    const out = await guarded(handle, {
      orgId,
      partnerId: conn.partner_id,
      platform: "meta",
      targetType,
      targetId: null,
      reason: `Load ad ${plan.adNumber} into Meta, paused (${step.replace(/_/g, " ")})`,
      actor: "human",
      userId: null,
      screenSubject: subject,
      before: {},
      after: { step, ad_video_id: adVideoId, ad_number: plan.adNumber, job_id: jobId, staff_id: requestedBy },
      execute: async () => {
        try { return await call(); } catch (e) { thrown = e; throw e; }
      }
    });
    if (out?.ok) return { result: out.result };
    if (out?.blocked) return { stop: await refuse(screenReasons(out)) };
    if (thrown && thrown.retryAfterMs) return { stop: await comeBackIn(thrown.retryAfterMs, "Meta asked us to slow down") };
    if (thrown && thrown.retryable) {
      throw new Error(`${step.replace(/_/g, " ")}: ${out?.error || thrown.platformMessage || thrown.message}`);
    }
    return { stop: await failForGood(REASONS.metaSaidNo(out?.error || thrown?.message)) };
  };

  try {
    if (!video.meta_ad_external_id) {
      if (!video.meta_creative_id) {
        /* 2. UPLOAD. Meta fetches the file from the signed link itself. */
        let uploadedAt = c.uploadStartedAt ? new Date(c.uploadStartedAt).getTime() : null;
        if (!video.meta_video_id) {
          const w = await write("upload_video", "creative_asset",
            () => meta.uploadVideo(conn, { file_url: plan.fileUrl, name: plan.name }, metaCtx));
          if (w.stop) return w.stop;
          video.meta_video_id = w.result.video_id;
          await store.saveIds({ orgId, adVideoId, ids: { meta_video_id: video.meta_video_id } });
          uploadedAt = now();
        }
        if (uploadedAt == null) uploadedAt = job?.created_at ? new Date(job.created_at).getTime() : now();

        const waitOrGiveUp = async () => {
          if (now() - uploadedAt >= WAIT_LIMIT_MS) {
            return failForGood(`${REASONS.TIMEOUT} (Meta video ${video.meta_video_id})`, { video: true });
          }
          return comeBackIn(POLL_EVERY_MS, "Meta is still working on the video");
        };

        /* 3. WAIT. Asked once; the job comes back in 10 s. */
        const status = await meta.getVideoStatus(conn, video.meta_video_id, metaCtx);
        if (status === "error" || status === "expired") {
          return failForGood(`${REASONS.videoBroken(status)} (Meta video ${video.meta_video_id})`, { video: true });
        }
        if (status !== "ready") return waitOrGiveUp();

        /* 4. THUMBNAIL. None yet means Meta is not done making them. */
        const thumbs = await meta.getVideoThumbnails(conn, video.meta_video_id, metaCtx);
        const imageUrl = meta.preferredThumbnail(thumbs);
        if (!imageUrl) return waitOrGiveUp();

        /* 5. CREATIVE, every enhancement OPT_OUT, UTMs in url_tags. */
        const w = await write("create_creative", "creative_asset", () => meta.createCreative(conn, {
          name: plan.name,
          page_id: plan.pageId,
          instagram_user_id: plan.instagramUserId,
          video_id: video.meta_video_id,
          image_url: imageUrl,
          message: plan.copy.primary_text,
          title: plan.copy.headline || undefined,
          link_description: plan.copy.description || undefined,
          cta_type: plan.ctaType,
          link: plan.link,
          url_tags: plan.urlTags
        }, metaCtx));
        if (w.stop) return w.stop;
        video.meta_creative_id = w.result.creative_id;
        await store.saveIds({ orgId, adVideoId, ids: { meta_creative_id: video.meta_creative_id } });
      }

      /* 6. READ IT BACK. Any enhancement on → refused, and the creative is let
         go so the next press makes a fresh one. */
      const features = await meta.readCreativeFeatures(conn, video.meta_creative_id, metaCtx);
      if (!features || features.all_opt_out !== true) {
        const why = features?.reason || "Meta did not show the creative's enhancement settings, so we cannot prove they are off.";
        return refuse([`${why} (Meta creative ${video.meta_creative_id})`], { creative: true });
      }

      /* 7. THE AD SET GUARD, as late as possible so the ad count is fresh. */
      const info = await meta.getAdSetGuardInfo(conn, c.adSet.external_id, metaCtx);
      const guard = checkAdSetGuard(info, { ourSpecialAdCategory: c.campaign.special_ad_category });
      if (!guard.ok) return refuse(guard.reasons);

      /* 8. CLAIM, then the ad. */
      const claim = await store.claim({ orgId, adVideoId, jobId });
      if (claim.busy) return { state: "busy", reasons: [REASONS.BUSY] };
      video.ad_row_id = claim.adRowId;
      if (claim.metaAdExternalId) video.meta_ad_external_id = claim.metaAdExternalId;
      else {
        const w = await write("create_ad", "ad", () => meta.createAd(conn, {
          name: plan.name,
          external_ad_set_id: c.adSet.external_id,
          external_creative_id: video.meta_creative_id
        }, metaCtx));
        if (w.stop) return w.stop;
        video.meta_ad_external_id = String(w.result?.id || "");
        if (!video.meta_ad_external_id) {
          return failForGood(REASONS.metaSaidNo("it did not send back an ad id"));
        }
        await store.saveIds({ orgId, adVideoId, ids: { meta_ad_external_id: video.meta_ad_external_id } });
      }
      notes = guard.notes || [];
    }

    /* 9. OUR ROWS, in one short transaction. */
    const done = await store.finishLoad({
      orgId,
      adVideoId,
      video,
      script: c.script,
      adSet: c.adSet,
      name: plan.name,
      adNumber: plan.adNumber
    });
    return {
      state: "loaded",
      ...idsOf({ ...video, ad_row_id: done.adRowId }),
      asset_id: done.assetId,
      asset_linked: done.assetLinked,
      notes
    };
  } catch (err) {
    if (!isPlatformError(err)) throw err;
    if (err.retryAfterMs) return comeBackIn(err.retryAfterMs, "Meta asked us to slow down");
    if (err.retryable) throw err;
    return failForGood(REASONS.metaSaidNo(err.platformMessage));
  }
}

function idsOf(v = {}) {
  return {
    meta_video_id: v.meta_video_id || null,
    meta_creative_id: v.meta_creative_id || null,
    meta_ad_external_id: v.meta_ad_external_id || null,
    ad_row_id: v.ad_row_id || null
  };
}

/* ── the database side ───────────────────────────────────────────────────── */

/* asStaff() takes a pool. src/db.mjs's `db` (query only) means "the app's own
   pool"; a pool-shaped object (connect()) is used as is. Same rule as
   src/marketing/http.mjs. */
function scopeDeps(db) {
  if (db && typeof db.connect === "function") return { pool: () => db };
  if (db && typeof db.pool === "function") return { pool: db.pool };
  return {};
}

/**
 * createStore(db) — every query the loader makes. Each method is ONE short
 * asStaff() transaction (ad_videos, ad_scripts, ads, ad_sets, campaigns,
 * creative_assets and action_log all force row security). None is ever open
 * while Meta is called.
 */
export function createStore(db = defaultDb, { asStaff = defaultAsStaff } = {}) {
  const deps = scopeDeps(db);
  const staff = (fn) => asStaff(fn, deps);

  return {
    /** For guardedWrite and the screen: every query is its own staff transaction. */
    staffHandle() {
      return { query: (sql, params) => staff((tx) => tx.query(sql, params)) };
    },

    async loadContext({ orgId, adVideoId, jobId }) {
      return staff(async (tx) => {
        const v = (await tx.query(
          `SELECT to_jsonb(v) AS row FROM ad_videos v WHERE v.id = $1 AND v.org_id = $2`,
          [adVideoId, orgId]
        )).rows[0]?.row || null;
        if (!v) return { video: null };

        const script = v.script_id ? (await tx.query(
          `SELECT id, partner_id, title, angle_key, funnel_key, meta_copy, ad_id
             FROM ad_scripts WHERE id = $1 AND org_id = $2`,
          [v.script_id, orgId]
        )).rows[0] || null : null;

        const funnel = script?.funnel_key ? (await tx.query(
          `SELECT id, key, name, landing_url, offer_key, lane::text AS lane, cta_type,
                  default_ad_set_external_id, active
             FROM marketing_funnels WHERE org_id = $1 AND key = $2`,
          [orgId, script.funnel_key]
        )).rows[0] || null : null;

        const adSet = funnel?.default_ad_set_external_id ? (await tx.query(
          `SELECT s.id, s.external_id, s.name, s.status, s.campaign_id, s.connection_id, s.partner_id
             FROM ad_sets s
             JOIN ad_platform_connections c ON c.id = s.connection_id AND c.platform = 'meta'
            WHERE s.org_id = $1 AND s.external_id = $2
            ORDER BY s.synced_at DESC NULLS LAST, s.created_at DESC
            LIMIT 1`,
          [orgId, funnel.default_ad_set_external_id]
        )).rows[0] || null : null;

        const campaign = adSet ? (await tx.query(
          `SELECT id, external_id, name, status, offer_type, special_ad_category, partner_id
             FROM campaigns WHERE id = $1`,
          [adSet.campaign_id]
        )).rows[0] || null : null;

        const connection = adSet ? (await tx.query(
          `SELECT id, org_id, partner_id, platform, external_ad_account_id,
                  encrypted_access_token, connection_state
             FROM ad_platform_connections WHERE id = $1`,
          [adSet.connection_id]
        )).rows[0] || null : null;

        const other = (await tx.query(
          `SELECT id FROM marketing_jobs
            WHERE org_id = $1 AND kind = '${META_LOAD_KIND}' AND status = 'running'
              AND ($2::uuid IS NULL OR id <> $2::uuid)
              AND payload->>'ad_video_id' = $3
            LIMIT 1`,
          [orgId, jobId, adVideoId]
        )).rows[0] || null;

        const uploaded = (await tx.query(
          `SELECT max(executed_at) AS at FROM action_log
            WHERE org_id = $1 AND target_type = 'creative_asset'
              AND after->>'step' = 'upload_video' AND after->>'ad_video_id' = $2
              AND executed_at IS NOT NULL AND execute_error IS NULL`,
          [orgId, adVideoId]
        )).rows[0]?.at || null;

        return {
          video: v, script, funnel, adSet, campaign, connection,
          otherRunning: !!other, uploadStartedAt: uploaded
        };
      });
    },

    /** Save Meta ids the moment Meta returns them. Only these three columns. */
    async saveIds({ orgId, adVideoId, ids = {} }) {
      const cols = ["meta_video_id", "meta_creative_id", "meta_ad_external_id"].filter((k) => ids[k] != null);
      if (!cols.length) return;
      const sets = cols.map((k, i) => `${k} = $${i + 3}`).join(", ");
      await staff((tx) => tx.query(
        `UPDATE ad_videos SET ${sets} WHERE id = $1 AND org_id = $2`,
        [adVideoId, orgId, ...cols.map((k) => String(ids[k]))]
      ));
    },

    async clearLoadError({ orgId, adVideoId }) {
      await staff((tx) => tx.query(
        `UPDATE ad_videos SET load_error = NULL WHERE id = $1 AND org_id = $2 AND load_error IS NOT NULL`,
        [adVideoId, orgId]
      ));
    },

    /** A refusal or a failure: the reason in plain words, and let go of a Meta
        video or creative that can no longer be used (its id stays in the reason). */
    async recordStop({ orgId, adVideoId, loadError, clear = {} }) {
      await staff((tx) => tx.query(
        `UPDATE ad_videos
            SET load_error = $3,
                meta_video_id    = CASE WHEN $4::boolean THEN NULL ELSE meta_video_id END,
                meta_creative_id = CASE WHEN $4::boolean OR $5::boolean THEN NULL ELSE meta_creative_id END
          WHERE id = $1 AND org_id = $2 AND loaded_at IS NULL`,
        [adVideoId, orgId, String(loadError || "").slice(0, 2000) || null, !!clear.video, !!clear.creative]
      ));
    },

    /**
     * claim — reserve our ads row id on the video before Meta is asked for the
     * ad. → { adRowId, metaAdExternalId, stale, busy }
     *   already has Meta's ad id         → that id; createAd is skipped
     *   claimed, another load running    → busy
     *   claimed, nobody running (a run   → stale: this run asks Meta again with
     *   died while asking Meta)             the same reserved id (worst case a
     *                                       second PAUSED ad, which spends nothing)
     */
    async claim({ orgId, adVideoId, jobId }) {
      return staff(async (tx) => {
        const row = (await tx.query(
          `SELECT ad_row_id, meta_ad_external_id FROM ad_videos
            WHERE id = $1 AND org_id = $2 FOR UPDATE`,
          [adVideoId, orgId]
        )).rows[0];
        if (!row) throw new Error("claim: the video is gone");
        if (row.meta_ad_external_id) {
          return { adRowId: row.ad_row_id || null, metaAdExternalId: row.meta_ad_external_id, stale: false, busy: false };
        }
        if (row.ad_row_id) {
          const other = (await tx.query(
            `SELECT id FROM marketing_jobs
              WHERE org_id = $1 AND kind = '${META_LOAD_KIND}' AND status = 'running'
                AND ($2::uuid IS NULL OR id <> $2::uuid)
                AND payload->>'ad_video_id' = $3
              LIMIT 1`,
            [orgId, jobId, adVideoId]
          )).rows[0];
          if (other) return { adRowId: row.ad_row_id, metaAdExternalId: null, stale: false, busy: true };
          return { adRowId: row.ad_row_id, metaAdExternalId: null, stale: true, busy: false };
        }
        const claimed = (await tx.query(
          `UPDATE ad_videos SET ad_row_id = gen_random_uuid()
            WHERE id = $1 AND org_id = $2 RETURNING ad_row_id`,
          [adVideoId, orgId]
        )).rows[0];
        return { adRowId: claimed.ad_row_id, metaAdExternalId: null, stale: false, busy: false };
      });
    },

    /**
     * finishLoad — ONE transaction, no Meta call: the creative_assets row, the
     * ads row (ON CONFLICT on Meta's id, so a sync that got there first is
     * updated, not doubled), and loaded_at.
     */
    async finishLoad({ orgId, adVideoId, video, script, adSet, name, adNumber }) {
      return staff(async (tx) => {
        const v = (await tx.query(
          `SELECT to_jsonb(v) AS row FROM ad_videos v WHERE v.id = $1 AND v.org_id = $2 FOR UPDATE`,
          [adVideoId, orgId]
        )).rows[0]?.row;
        if (!v) throw new Error("finishLoad: the video is gone");

        // 9.1a adds master_duration_seconds (the cut's length). Until then the
        // finished length is unknown: NULL, never the raw take's length.
        const dur = Number(v.master_duration_seconds);
        const duration = Number.isFinite(dur) && dur > 0 ? dur : null;

        const asset = (await tx.query(
          `INSERT INTO creative_assets
             (org_id, partner_id, kind, format, storage_key, duration_sec,
              ai_generated, synthetic_performer, compliance_state, script_id)
           VALUES ($1, $2, 'video', '9x16', $3, $4, false, false, 'approved', $5)
           RETURNING id, partner_id`,
          [orgId, v.partner_id, v.storage_final_key, duration, script?.id || v.script_id || null]
        )).rows[0];

        const sameOwner = String(asset.partner_id) === String(adSet.partner_id);
        const ad = (await tx.query(
          `INSERT INTO ads
             (id, org_id, partner_id, connection_id, campaign_id, ad_set_id, asset_id,
              external_id, name, status, fundhub_ad_number, fundhub_ad_number_source)
           VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7,
                   $8, $9, 'PAUSED', $10, 'loader')
           ON CONFLICT (connection_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
             asset_id = COALESCE(ads.asset_id, EXCLUDED.asset_id),
             fundhub_ad_number = CASE
               WHEN ads.fundhub_ad_number_source = 'manual' AND ads.fundhub_ad_number IS NOT NULL
                 THEN ads.fundhub_ad_number ELSE EXCLUDED.fundhub_ad_number END,
             fundhub_ad_number_source = CASE
               WHEN ads.fundhub_ad_number_source = 'manual' AND ads.fundhub_ad_number IS NOT NULL
                 THEN ads.fundhub_ad_number_source ELSE 'loader' END,
             status = COALESCE(ads.status, EXCLUDED.status),
             updated_at = now()
           RETURNING id`,
          [video.ad_row_id || v.ad_row_id || null, orgId, adSet.partner_id, adSet.connection_id,
           adSet.campaign_id, adSet.id, sameOwner ? asset.id : null,
           video.meta_ad_external_id, name, adNumber]
        )).rows[0];

        await tx.query(
          `UPDATE ad_videos
              SET ad_row_id = $3, meta_ad_external_id = $4, loaded_at = now(), load_error = NULL
            WHERE id = $1 AND org_id = $2`,
          [adVideoId, orgId, ad.id, video.meta_ad_external_id]
        );
        return { adRowId: ad.id, assetId: asset.id, assetLinked: sameOwner };
      });
    }
  };
}

/* ── the handler the worker runs ─────────────────────────────────────────── */

/**
 * run(job, ctx) — the meta_load job handler (job-kinds.mjs). ctx: { db, env, deps }.
 * deps may replace store, meta, guardedWrite, screen, jobs, now and metaCtx (tests).
 */
export async function run(job, ctx = {}) {
  const database = ctx.db || defaultDb;
  const d = ctx.deps || {};
  return runLoad(job, {
    store: d.store || createStore(database, { asStaff: d.asStaff || defaultAsStaff }),
    meta: d.meta || metaAdapter,
    guardedWrite: d.guardedWrite || defaultGuardedWrite,
    screen: d.screen || screenAndRecord,
    jobs: d.jobs || {
      requeue: (id, runAfter) => (id ? requeueJob(database, id, { runAfter }) : null),
      fail: (id, reason) => (id ? failJob(database, id, reason, { final: true }) : null)
    },
    env: ctx.env || process.env,
    now: d.now || Date.now,
    metaCtx: d.metaCtx || {}
  });
}

/* ── the two routes' database work ───────────────────────────────────────── */

const IN_FLIGHT_SQL = `
  SELECT id FROM marketing_jobs
   WHERE org_id = $1 AND kind = '${META_LOAD_KIND}' AND status IN ('queued', 'running')
     AND payload->>'ad_video_id' = $2
   ORDER BY created_at DESC
   LIMIT 1`;

/**
 * queueLoads(tx, { orgId, adVideoId, all, requestedBy }) → [{ad_number, ad_video_id, job_id}],
 * or null when one ad video was named and it is not in this company.
 *
 * Runs inside the route's withRequest transaction (no Meta call). One job per
 * video; a video that already has a load waiting or running gets that job back
 * instead of a second one. all:true → every approved, not-yet-loaded ad video.
 * A named video is queued whatever its state: the job refuses in plain words,
 * and the refusal shows in load-status.
 */
export async function queueLoads(tx, { orgId, adVideoId = null, all = false, requestedBy = null } = {}) {
  const rows = all
    ? (await tx.query(
        `SELECT id, ad_id FROM ad_videos
          WHERE org_id = $1
            AND status = ANY($2::text[])
            AND approved_at IS NOT NULL AND btrim(coalesce(approved_by, '')) <> ''
            AND loaded_at IS NULL
            AND video_kind = 'ad'
          ORDER BY CASE WHEN ad_id ~ '^[0-9]{1,9}$' THEN ad_id::bigint END NULLS LAST, take_no, created_at`,
        [orgId, [...APPROVED_STATES]]
      )).rows
    : (await tx.query(
        `SELECT id, ad_id FROM ad_videos WHERE id = $1 AND org_id = $2`,
        [adVideoId, orgId]
      )).rows;
  if (!all && !rows.length) return null;

  const out = [];
  for (const r of rows) {
    const id = String(r.id);
    let jobId = (await tx.query(IN_FLIGHT_SQL, [orgId, id])).rows[0]?.id || null;
    if (!jobId) {
      const job = await enqueueJob(tx, {
        orgId,
        kind: META_LOAD_KIND,
        payload: requestedBy ? { ad_video_id: id, requested_by: requestedBy } : { ad_video_id: id }
      });
      jobId = job.id;
      if (requestedBy && UUID_RE.test(String(requestedBy))) {
        await tx.query(`UPDATE marketing_jobs SET requested_by = $2 WHERE id = $1`, [jobId, requestedBy]);
      }
    }
    out.push({ ad_number: r.ad_id == null ? null : String(r.ad_id), ad_video_id: id, job_id: String(jobId) });
  }
  return out;
}

/** The step words the Launch tab shows (design §3.6). */
export function stepOf(row = {}) {
  if (row.loaded_at) return "loaded";
  if (row.meta_ad_external_id) return "saving";
  if (row.meta_creative_id) return "creating the ad";
  if (row.meta_video_id) return "waiting for Meta";
  return "uploading video";
}

/**
 * deriveLoadState(row) → { state, reasons, step }. Pure.
 * row: the video's load columns plus its job: { job_status, job_error, job_result }.
 * The job looked at is the one in flight, else the newest.
 */
export function deriveLoadState(row = {}) {
  const hasIds = !!(row.meta_video_id || row.meta_creative_id || row.meta_ad_external_id);
  const loadError = clean(row.load_error) || null;
  if (row.loaded_at) return { state: "loaded", reasons: [], step: "loaded" };

  const status = row.job_status || null;
  let result = row.job_result;
  if (typeof result === "string") { try { result = JSON.parse(result); } catch { result = null; } }

  if (status === "running") return { state: "loading", reasons: [], step: stepOf(row) };
  if (status === "queued") {
    const reasons = row.job_error ? [`Trying again soon. Last time: ${clean(row.job_error)}`] : [];
    return hasIds
      ? { state: "loading", reasons, step: stepOf(row) }
      : { state: "waiting", reasons, step: null };
  }
  if (status === "failed") {
    return { state: "failed", reasons: [loadError || clean(row.job_error) || "The load failed and did not say why."], step: null };
  }
  if (status === "done") {
    if (result && result.state === "refused") {
      const list = Array.isArray(result.reasons) && result.reasons.length ? result.reasons.map(clean) : [loadError || "Refused."];
      return { state: "refused", reasons: list, step: null };
    }
    if (result && result.state === "busy") return { state: "loading", reasons: [], step: stepOf(row) };
    if (loadError) return { state: "failed", reasons: [loadError], step: null };
    return { state: "waiting", reasons: [], step: null };
  }
  if (loadError) return { state: "failed", reasons: [loadError], step: null };
  return { state: hasIds ? "loading" : "waiting", reasons: [], step: hasIds ? stepOf(row) : null };
}

/**
 * readLoadStatus(tx, { orgId }) → the `loads` list for GET marketing/meta/load-status.
 * One row per ad video that was asked to load (it has a meta_load job) or that
 * already holds a Meta id or loaded_at. Runs inside a staff read transaction.
 */
export async function readLoadStatus(tx, { orgId }) {
  const { rows } = await tx.query(
    `SELECT v.id, v.ad_id, v.take_no, v.loaded_at, v.load_error,
            v.meta_video_id, v.meta_creative_id, v.meta_ad_external_id,
            s.title AS angle, s.funnel_key,
            j.status AS job_status, j.error AS job_error, j.result AS job_result,
            a.id AS ad_row_id, a.status AS ad_status,
            f.default_ad_set_external_id AS funnel_ad_set,
            ase.external_id AS ad_set_external_id, ase.name AS ad_set_name, ase.status AS ad_set_status,
            c.external_id AS campaign_external_id, c.status AS campaign_status
       FROM ad_videos v
       LEFT JOIN ad_scripts s ON s.id = v.script_id
       LEFT JOIN marketing_funnels f ON f.org_id = v.org_id AND f.key = s.funnel_key
       LEFT JOIN ads a ON a.id = v.ad_row_id
       LEFT JOIN LATERAL (
         SELECT status, error, result
           FROM marketing_jobs mj
          WHERE mj.org_id = v.org_id AND mj.kind = '${META_LOAD_KIND}'
            AND mj.payload->>'ad_video_id' = v.id::text
          ORDER BY (mj.status IN ('queued', 'running')) DESC, mj.created_at DESC
          LIMIT 1
       ) j ON true
       LEFT JOIN LATERAL (
         SELECT x.external_id, x.name, x.status, x.campaign_id
           FROM ad_sets x
          WHERE x.org_id = v.org_id
            AND ((a.id IS NOT NULL AND x.id = a.ad_set_id)
                 OR (a.id IS NULL AND x.external_id = f.default_ad_set_external_id))
          ORDER BY x.synced_at DESC NULLS LAST, x.created_at DESC
          LIMIT 1
       ) ase ON true
       LEFT JOIN campaigns c ON c.id = ase.campaign_id
      WHERE v.org_id = $1
        AND (v.loaded_at IS NOT NULL
             OR v.meta_video_id IS NOT NULL OR v.meta_creative_id IS NOT NULL
             OR v.meta_ad_external_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM marketing_jobs q
                         WHERE q.org_id = v.org_id AND q.kind = '${META_LOAD_KIND}'
                           AND q.payload->>'ad_video_id' = v.id::text))
      ORDER BY CASE WHEN v.ad_id ~ '^[0-9]{1,9}$' THEN v.ad_id::bigint END NULLS LAST, v.take_no, v.id`,
    [orgId]
  );

  return rows.map((r) => {
    const d = deriveLoadState(r);
    const adSetExternal = r.ad_set_external_id || r.funnel_ad_set || null;
    return {
      ad_number: r.ad_id == null ? null : String(r.ad_id),
      ad_video_id: String(r.id),
      state: d.state,
      reasons: d.reasons,
      meta_video_id: r.meta_video_id || null,
      meta_creative_id: r.meta_creative_id || null,
      meta_ad_external_id: r.meta_ad_external_id || null,
      // Only once our ads row exists (the claim reserves the id first).
      ad_row_id: r.ad_row_id ? String(r.ad_row_id) : null,
      ad_status: r.ad_status || null,
      ad_set: adSetExternal
        ? { external_id: String(adSetExternal), status: r.ad_set_status || null, name: r.ad_set_name || null }
        : null,
      campaign: r.campaign_external_id
        ? { external_id: String(r.campaign_external_id), status: r.campaign_status || null }
        : null,
      // Extra keys for the Launch tab (design §3.6); the contract allows them.
      step: d.step,
      angle: r.angle || null,
      funnel_key: r.funnel_key || null,
      loaded_at: r.loaded_at ? new Date(r.loaded_at).toISOString() : null
    };
  });
}

export default run;
