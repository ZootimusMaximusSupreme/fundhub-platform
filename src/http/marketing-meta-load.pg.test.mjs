// POST /api/marketing/meta/load, GET /api/marketing/meta/load-status, and the
// meta_load job itself (src/marketing/meta-load.mjs), against real Postgres.
// Lives under src/http/ because npm test globs src/** and scripts/** only
// (CLAUDE.md §12); it imports the api/ handlers.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations and db/seed. Without DATABASE_URL every
// test skips, and a skipped .pg.test.mjs is not green.
//
// META IS FAKE. The job runs with the real store (every SQL statement the
// loader makes), the real guardedWrite and the real compliance screen, and a
// fake Meta object. Nothing here reaches the network.
//
// A COMPANY OF ITS OWN (org slug mmload-pg-test), shaped like production on
// 2026-10-06: the Meta connection, campaign and ad set on one partner
// ("direct"), the videos and scripts on another ("house").
//
// ad_videos, ad_scripts, ads, ad_sets, campaigns, creative_assets, action_log
// and ad_platform_* FORCE row security, so fixture writes go through asStaff().

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import loadHandler from "../../api/marketing/meta/load.mjs";
import statusHandler from "../../api/marketing/meta/load-status.mjs";
import { run, META_LOAD_KIND, REASONS } from "../marketing/meta-load.mjs";
import { finishJob } from "../marketing/jobs.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

const ORG_SLUG = "mmload-pg-test";
const HOUSE_SLUG = "mmload-house";
const DIRECT_SLUG = "mmload-direct";
const EMAIL_TAG = "mmload_pg_test";
const META_SYNCED = new Date("2026-10-06T07:01:50.000Z");

const AD_SET_EXT = "990000000000000501";
const CAMPAIGN_EXT = "990000000000000401";

const ENV = Object.freeze({
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET_AD_VIDEO: "fundhub-ad-video",
  R2_ACCESS_KEY_ID: "fedcba9876543210fedcba9876543210",
  R2_SECRET_ACCESS_KEY: "test-secret-not-a-real-key",
  META_PAGE_ID: "100000000000001",
  META_INSTAGRAM_USER_ID: "178400000000001"
});

let seq = 0;
const rid = (tag) => `mmload-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

const wakes = [];
async function callLoad(token, body) {
  const r = res();
  await loadHandler({ method: "POST", headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body }, r,
    { db, wake: async () => { wakes.push(1); return { ok: true, started: false, skipped: "test" }; }, env: {} });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}
async function callStatus(token, method = "GET") {
  const r = res();
  await statusHandler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query: {} }, r, { db });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

/* A fake Meta that also proves no transaction of ours is open while it is
   called: the loader's asStaff is wrapped to count open transactions. */
let openTx = 0;
const countingAsStaff = async (fn, deps) => {
  openTx++;
  try { return await asStaff(fn, deps); } finally { openTx--; }
};

function fakeMeta({ statuses = ["ready"], adId, crashStatusOnce = false } = {}) {
  const calls = [];
  let statusCall = 0;
  let crashed = false;
  const at = (name) => {
    calls.push(name);
    assert.equal(openTx, 0, `a transaction was open while Meta was asked: ${name}`);
  };
  const meta = {
    async uploadVideo(conn, args) { at("uploadVideo"); assert.match(args.file_url, /^https:\/\//); return { video_id: `vid-${crypto.randomUUID().slice(0, 8)}` }; },
    async getVideoStatus() {
      at("getVideoStatus");
      if (crashStatusOnce && !crashed) { crashed = true; throw new Error("worker died"); }
      return statuses[Math.min(statusCall++, statuses.length - 1)];
    },
    async getVideoThumbnails() { at("getVideoThumbnails"); return [{ uri: "https://scontent.example/t.jpg", is_preferred: true }]; },
    preferredThumbnail: (list) => list[0]?.uri || null,
    async createCreative(conn, spec) { at("createCreative"); assert.ok(spec.url_tags.startsWith("utm_source=fb&utm_medium=paid&utm_campaign=uwiq&utm_content=")); return { creative_id: `cr-${crypto.randomUUID().slice(0, 8)}` }; },
    async readCreativeFeatures() { at("readCreativeFeatures"); return { all_opt_out: true, opt_in: [], reason: null }; },
    async getAdSetGuardInfo() {
      at("getAdSetGuardInfo");
      return { effective_status: "ACTIVE", is_dynamic_creative: false, ad_count: 2, campaign: { special_ad_categories: ["CREDIT"], effective_status: "ACTIVE" } };
    },
    async createAd(conn, ad) { at("createAd"); assert.equal("status" in ad, false); return { id: adId || `ad-${crypto.randomUUID().slice(0, 8)}` }; }
  };
  return { meta, calls };
}

describe("/api/marketing/meta/load + load-status + the meta_load job", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, house, direct, conn, campaignId, adSetId;
  let tokenOwner, tokenCloser, tokenCsm, ownerStaffId;
  const vids = {};
  const firstJobs = {};

  async function cleanup() {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (o) {
      await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_requests WHERE org_id = $1`, [o.id]);
      const ids = (await db.query(`SELECT id FROM partners WHERE org_id = $1`, [o.id])).rows.map((r) => r.id);
      if (ids.length) {
        // creative_assets refuses a direct DELETE (045); same escape hatch as
        // src/http/ad-asset-link.pg.test.mjs. action_log and
        // compliance_screenings are append-only and stay; the partners they
        // point at are reused by slug on the next run.
        await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
        try {
          await asStaff(async (tx) => {
            await tx.query(`DELETE FROM ad_videos WHERE org_id = $1`, [o.id]);
            await tx.query(`DELETE FROM ads WHERE partner_id = ANY($1)`, [ids]);
            await tx.query(`DELETE FROM creative_assets WHERE partner_id = ANY($1)`, [ids]);
            await tx.query(`DELETE FROM ad_scripts WHERE partner_id = ANY($1)`, [ids]);
            await tx.query(`DELETE FROM ad_sets WHERE partner_id = ANY($1)`, [ids]);
            await tx.query(`DELETE FROM campaigns WHERE partner_id = ANY($1)`, [ids]);
          });
        } finally {
          await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
        }
      }
      await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1`, [o.id]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  async function staffIn(role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Meta load ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  async function partner(slug, name) {
    const found = (await db.query(`SELECT id FROM partners WHERE org_id = $1 AND slug = $2`, [org, slug])).rows[0];
    if (found) return found.id;
    return (await db.query(`INSERT INTO partners (org_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [org, name, slug])).rows[0].id;
  }

  async function video(tag, { adId, status = "approved", approved = true, finalKey = "r2", loaded = false } = {}) {
    return asStaff(async (tx) => {
      const script = (await tx.query(
        `INSERT INTO ad_scripts (org_id, partner_id, title, body, status, ad_id, funnel_key, meta_copy, lane)
         VALUES ($1,$2,$3,$4,'filmed',$5,'roadmap_147',$6::jsonb,'uwiq') RETURNING id`,
        [org, house, `Meta load angle ${tag}`, `Body for ${tag}.`, adId,
         JSON.stringify({ primary_text: `Your file decides what the bank says (${tag}).`, headline: "See your roadmap", description: "Ten minutes", cta_type: "LEARN_MORE" })]
      )).rows[0].id;
      const key = finalKey === "r2" ? `partners/${house}/ad-video/final/${adId}-r0.mp4` : finalKey;
      return (await tx.query(
        `INSERT INTO ad_videos (org_id, partner_id, ad_id, take_no, script_id, status, approved_at, approved_by,
                                storage_final_key, loaded_at)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [org, house, adId, script, status,
         approved ? new Date() : null, approved ? ownerStaffId : null, key, loaded ? new Date() : null]
      )).rows[0].id;
    });
  }

  before(async () => {
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Meta load fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    await cleanup();
    const owner = await staffIn("owner", "owner");
    tokenOwner = owner.token; ownerStaffId = owner.id;
    tokenCloser = (await staffIn("closer", "closer")).token;
    tokenCsm = (await staffIn("csm", "csm")).token;
    house = await partner(HOUSE_SLUG, "House fixture");
    direct = await partner(DIRECT_SLUG, "Direct fixture");

    await asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')
         ON CONFLICT DO NOTHING`, [org]);
      conn = (await tx.query(
        `SELECT id FROM ad_platform_connections WHERE org_id = $1 AND partner_id = $2 AND platform = 'meta'`, [org, direct]
      )).rows[0]?.id;
      if (!conn) {
        conn = (await tx.query(
          `INSERT INTO ad_platform_connections
             (org_id, partner_id, platform, external_ad_account_id, connection_state,
              platform_verification_state, encrypted_access_token, last_synced_at)
           VALUES ($1,$2,'meta','acct-mmload','active','approved','v1:x:y:z',$3) RETURNING id`,
          [org, direct, META_SYNCED]
        )).rows[0].id;
      }
      await tx.query(`UPDATE ad_platform_connections SET last_synced_at = $2 WHERE id = $1`, [conn, META_SYNCED]);
      campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id, status)
         VALUES ($1,$2,$3,'Roadmap fixture','funding',10000,'draft',$4,'ACTIVE') RETURNING id`,
        [org, direct, conn, CAMPAIGN_EXT]
      )).rows[0].id;
      adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id, status)
         VALUES ($1,$2,$3,$4,'Roadmap broad',10000,'draft',$5,'PAUSED') RETURNING id`,
        [org, direct, conn, campaignId, AD_SET_EXT]
      )).rows[0].id;
    });
    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, offer_key, lane, default_ad_set_external_id)
       VALUES ($1,'roadmap_147','Roadmap','https://apply.fundhub.ai/roadmap','slo_roadmap','uwiq',$2)`,
      [org, AD_SET_EXT]
    );

    vids.ok = await video("ok", { adId: "991" });
    vids.noStorage = await video("no-storage", { adId: "992", finalKey: null });
    vids.notApproved = await video("not-approved", { adId: "993", status: "awaiting_approval", approved: false });
    vids.loaded = await video("loaded", { adId: "994", loaded: true });
    vids.synced = await video("synced", { adId: "995" });
    vids.drive = await video("drive", { adId: "996", finalKey: "drive:1AbCdEfGh" });
  });

  after(async () => { await cleanup(); await close(); });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403 on both routes; nothing queued", async () => {
    assert.equal((await callLoad(null, { request_id: rid("gate"), all: true })).code, 401);
    assert.equal((await callStatus(null)).code, 401);
    for (const t of [tokenCloser, tokenCsm]) {
      const p = await callLoad(t, { request_id: rid("gate"), all: true });
      assert.equal(p.code, 403, JSON.stringify(p.body));
      assert.equal((await callStatus(t)).code, 403);
    }
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [org])).rows[0].n;
    assert.equal(n, 0);
  });

  test("wrong methods answer 405 and write nothing", async () => {
    const r = res();
    await loadHandler({ method: "GET", headers: {}, query: {} }, r, { db });
    assert.equal(r.code, 405);
    assert.equal((await callStatus(tokenOwner, "POST")).code, 405);
  });

  test("bad bodies: 400 in plain words, 404 for a video that is not ours", async () => {
    const none = await callLoad(tokenOwner, { request_id: rid("bad") });
    assert.equal(none.code, 400);
    assert.equal(none.body.field, "ad_video_id");
    const both = await callLoad(tokenOwner, { request_id: rid("bad"), all: true, ad_video_id: vids.ok });
    assert.equal(both.code, 400);
    const notUuid = await callLoad(tokenOwner, { request_id: rid("bad"), ad_video_id: "nope" });
    assert.equal(notUuid.code, 400);
    assert.equal(notUuid.body.field, "ad_video_id");
    const noRid = await callLoad(tokenOwner, { all: true });
    assert.equal(noRid.code, 400);
    assert.equal(noRid.body.field, "request_id");
    const missing = await callLoad(tokenOwner, { request_id: rid("bad"), ad_video_id: crypto.randomUUID() });
    assert.equal(missing.code, 404);
    assert.equal(missing.body.error, "not_found");
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [org])).rows[0].n;
    assert.equal(n, 0, "a refused request queues nothing");
  });

  test("load-status before any load: empty list, as_of is the last Meta pull, contract shape", async () => {
    const r = await callStatus(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.loads, []);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());
    assertMatchesContract("GET marketing/meta/load-status", r.body);
  });

  test("load {all:true}: one job per approved, not-yet-loaded ad video, inside withRequest; a repeat queues nothing", async () => {
    const requestId = rid("all");
    const wakesBefore = wakes.length;
    const r = await callLoad(tokenOwner, { request_id: requestId, all: true });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/meta/load", r.body);
    assert.equal(r.body.queued, true);
    // Approved and not loaded: 991, 992, 995, 996. Not 993 (no approval) or 994 (loaded).
    assert.deepEqual(r.body.jobs.map((j) => j.ad_number), ["991", "992", "995", "996"]);
    assert.deepEqual(r.body.jobs.map((j) => j.ad_video_id), [vids.ok, vids.noStorage, vids.synced, vids.drive]);
    for (const j of r.body.jobs) firstJobs[j.ad_video_id] = j.job_id;

    const rows = (await db.query(
      `SELECT id, kind, status, payload, requested_by FROM marketing_jobs WHERE org_id = $1 ORDER BY created_at`, [org]
    )).rows;
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.kind, META_LOAD_KIND);
      assert.equal(row.status, "queued");
      assert.equal(row.requested_by, ownerStaffId);
      assert.equal(row.payload.requested_by, ownerStaffId);
    }
    assert.deepEqual(rows.map((x) => x.payload.ad_video_id).sort(), [vids.ok, vids.noStorage, vids.synced, vids.drive].sort());

    // withRequest saved the answer as its last statement.
    const saved = (await db.query(`SELECT route, response FROM marketing_requests WHERE request_id = $1`, [requestId])).rows[0];
    assert.equal(saved.route, "marketing/meta/load");
    assert.deepEqual(saved.response, r.body);
    assert.equal(wakes.length, wakesBefore + 1, "the worker is woken once, after the commit");

    // The same press again: the saved answer, no new rows.
    const again = await callLoad(tokenOwner, { request_id: requestId, all: true });
    assert.equal(again.code, 202);
    assert.deepEqual(again.body, r.body);
    // A new press while those wait: the same jobs come back, no second job per video.
    const second = await callLoad(tokenOwner, { request_id: rid("all-2"), all: true });
    assert.deepEqual(second.body.jobs.map((j) => j.job_id), r.body.jobs.map((j) => j.job_id));
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [org])).rows[0].n;
    assert.equal(n, 4);
  });

  test("load one named video, even one a person has not approved (the job refuses it, in load-status)", async () => {
    const r = await callLoad(tokenOwner, { request_id: rid("one"), ad_video_id: vids.notApproved });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assert.equal(r.body.jobs.length, 1);
    assert.equal(r.body.jobs[0].ad_number, "993");
    firstJobs[vids.notApproved] = r.body.jobs[0].job_id;

    const status = await callStatus(tokenOwner);
    assertMatchesContract("GET marketing/meta/load-status", status.body);
    const states = Object.fromEntries(status.body.loads.map((l) => [l.ad_number, l.state]));
    assert.deepEqual(states, { 991: "waiting", 992: "waiting", 993: "waiting", 995: "waiting", 996: "waiting" });
  });

  /* The worker's claim, for one named job (claimJobs would also take another
     test's rows). Then run() exactly as the worker calls it. */
  async function claimAndRun(adVideoId, meta, { finish = true } = {}) {
    const job = (await db.query(
      `UPDATE marketing_jobs SET status = 'running', claimed_at = now(), run_after = now()
        WHERE org_id = $1 AND kind = $2 AND payload->>'ad_video_id' = $3 AND status = 'queued'
        RETURNING *`,
      [org, META_LOAD_KIND, adVideoId]
    )).rows[0];
    assert.ok(job, `no queued job for ${adVideoId}`);
    clearRuleCache();
    const result = await run(job, { db, env: ENV, deps: { meta, asStaff: countingAsStaff } });
    if (finish) await finishJob(db, job.id, result); // what the worker does on a return; a no-op after a requeue or a fail
    return { job, result };
  }

  test("the job: refusals in plain words, nothing sent to Meta", async () => {
    for (const [id, reason] of [
      [vids.noStorage, REASONS.NOT_IN_STORAGE],
      [vids.drive, REASONS.NOT_IN_STORAGE],
      [vids.notApproved, REASONS.NOT_APPROVED]
    ]) {
      const { meta, calls } = fakeMeta();
      const { job, result } = await claimAndRun(id, meta);
      assert.equal(result.state, "refused", JSON.stringify(result));
      assert.ok(result.reasons.includes(reason), JSON.stringify(result.reasons));
      assert.deepEqual(calls, []);
      const row = (await db.query(`SELECT status, result FROM marketing_jobs WHERE id = $1`, [job.id])).rows[0];
      assert.equal(row.status, "done");
      assert.equal(row.result.state, "refused");
      const v = (await asStaff((tx) => tx.query(`SELECT load_error, loaded_at FROM ad_videos WHERE id = $1`, [id]))).rows[0];
      assert.match(v.load_error, new RegExp(reason.replace(/[.()]/g, "\\$&")));
      assert.equal(v.loaded_at, null);
    }
  });

  test("the job: upload, wait 10 s (re-queued), crash, resume from the saved id, load PAUSED; no transaction open across a Meta call", async () => {
    // Run 1: Meta is still processing → the job is re-queued 10 s out, no attempt counted.
    const one = fakeMeta({ statuses: ["processing"] });
    const first = await claimAndRun(vids.ok, one.meta);
    assert.equal(first.result.state, "waiting");
    assert.deepEqual(one.calls, ["uploadVideo", "getVideoStatus"]);
    const queued = (await db.query(
      `SELECT status, attempts, run_after > now() + interval '5 seconds' AS later FROM marketing_jobs WHERE id = $1`, [first.job.id]
    )).rows[0];
    assert.deepEqual(queued, { status: "queued", attempts: 0, later: true });
    const v1 = (await asStaff((tx) => tx.query(`SELECT meta_video_id FROM ad_videos WHERE id = $1`, [vids.ok]))).rows[0];
    assert.match(v1.meta_video_id, /^vid-/, "meta_video_id saved at once");

    // load-status mid-way: loading, waiting for Meta.
    const mid = (await callStatus(tokenOwner)).body.loads.find((l) => l.ad_video_id === vids.ok);
    assert.equal(mid.state, "loading");
    assert.equal(mid.step, "waiting for Meta");
    assert.equal(mid.meta_video_id, v1.meta_video_id);

    // Run 2: the worker dies at the status check (a thrown error, as a crash).
    const two = fakeMeta({ crashStatusOnce: true });
    await assert.rejects(() => claimAndRun(vids.ok, two.meta, { finish: false }), /worker died/);
    await db.query(`UPDATE marketing_jobs SET status = 'queued' WHERE id = $1`, [first.job.id]); // the reclaim

    // Run 3: resumes from the saved video id — no second upload.
    const three = fakeMeta();
    const done = await claimAndRun(vids.ok, three.meta);
    assert.equal(done.result.state, "loaded", JSON.stringify(done.result));
    assert.deepEqual(three.calls, ["getVideoStatus", "getVideoThumbnails", "createCreative", "readCreativeFeatures", "getAdSetGuardInfo", "createAd"]);

    const v = (await asStaff((tx) => tx.query(`SELECT * FROM ad_videos WHERE id = $1`, [vids.ok]))).rows[0];
    assert.ok(v.loaded_at);
    assert.equal(v.load_error, null);
    assert.equal(v.meta_video_id, v1.meta_video_id);
    assert.match(v.meta_creative_id, /^cr-/);
    assert.match(v.meta_ad_external_id, /^ad-/);
    assert.equal(v.status, "approved", "ad_videos.status is not changed (the loaded state comes with 9.1a)");

    const ad = (await asStaff((tx) => tx.query(`SELECT * FROM ads WHERE id = $1`, [v.ad_row_id]))).rows[0];
    assert.ok(ad, "ad_row_id points at our ads row");
    assert.equal(ad.external_id, v.meta_ad_external_id);
    assert.equal(ad.status, "PAUSED");
    assert.equal(ad.fundhub_ad_number, "991");
    assert.equal(ad.fundhub_ad_number_source, "loader");
    assert.equal(ad.ad_set_id, adSetId);
    assert.equal(ad.campaign_id, campaignId);
    assert.equal(ad.connection_id, conn);
    assert.equal(ad.partner_id, direct);
    assert.equal(ad.name, "Roadmap Ad 991 — Meta load angle ok");
    assert.equal(ad.asset_id, null, "house asset, direct ad: trg_ads_asset_partner forbids the link");

    const asset = (await asStaff((tx) => tx.query(
      `SELECT * FROM creative_assets WHERE storage_key = $1`, [`partners/${house}/ad-video/final/991-r0.mp4`]
    ))).rows;
    assert.equal(asset.length, 1);
    assert.equal(asset[0].partner_id, house);
    assert.equal(asset[0].kind, "video");
    assert.equal(asset[0].format, "9x16");
    assert.equal(asset[0].ai_generated, false);
    assert.equal(asset[0].compliance_state, "approved");
    assert.equal(asset[0].duration_sec, null, "unknown until 9.1a records the cut's length");
    assert.equal(asset[0].script_id, v.script_id);

    // Three Meta writes, each logged as a human action before it went out, each stamped after.
    const logs = (await asStaff((tx) => tx.query(
      `SELECT target_type, actor, after->>'step' AS step, executed_at, execute_error
         FROM action_log WHERE org_id = $1 AND after->>'ad_video_id' = $2 ORDER BY created_at`,
      [org, vids.ok]
    ))).rows;
    assert.deepEqual(logs.map((l) => [l.target_type, l.step, l.actor]), [
      ["creative_asset", "upload_video", "human"], ["creative_asset", "create_creative", "human"], ["ad", "create_ad", "human"]
    ]);
    assert.ok(logs.every((l) => l.executed_at && !l.execute_error));

    // The up-front screen left its audit row, passed (a person approved the video).
    const screened = (await asStaff((tx) => tx.query(
      `SELECT state FROM compliance_screenings WHERE org_id = $1 AND subject_id = $2 ORDER BY created_at`, [org, vids.ok]
    ))).rows;
    assert.ok(screened.length >= 1);
    assert.ok(screened.every((s) => s.state === "passed"));

    const job = (await db.query(`SELECT status, result FROM marketing_jobs WHERE id = $1`, [first.job.id])).rows[0];
    assert.equal(job.status, "done");
    assert.equal(job.result.state, "loaded");
  });

  test("the ads row is written ON CONFLICT on Meta's id: a row the sync made first is updated, not doubled", async () => {
    const external = `ad-sync-${crypto.randomUUID().slice(0, 8)}`;
    const syncRow = await asStaff(async (tx) => (await tx.query(
      `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, external_id, name, status)
       VALUES ($1,$2,$3,$4,$5,$6,'Synced name','PAUSED') RETURNING id`,
      [org, direct, conn, campaignId, adSetId, external]
    )).rows[0].id);

    const { meta } = fakeMeta({ adId: external });
    const { result } = await claimAndRun(vids.synced, meta);
    assert.equal(result.state, "loaded", JSON.stringify(result));
    const rows = (await asStaff((tx) => tx.query(`SELECT * FROM ads WHERE connection_id = $1 AND external_id = $2`, [conn, external]))).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, syncRow);
    assert.equal(rows[0].fundhub_ad_number, "995");
    assert.equal(rows[0].fundhub_ad_number_source, "loader");
    const v = (await asStaff((tx) => tx.query(`SELECT ad_row_id FROM ad_videos WHERE id = $1`, [vids.synced]))).rows[0];
    assert.equal(v.ad_row_id, syncRow, "the video points at the row that exists, not the reserved id");
  });

  test("load-status: every state with plain reasons, ad set and campaign from our rows, contract shape", async () => {
    const r = await callStatus(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/meta/load-status", r.body);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());
    const by = Object.fromEntries(r.body.loads.map((l) => [l.ad_number, l]));
    assert.deepEqual(Object.keys(by).sort(), ["991", "992", "993", "994", "995", "996"]);

    assert.equal(by["991"].state, "loaded");
    assert.equal(by["991"].ad_status, "PAUSED");
    assert.ok(by["991"].ad_row_id);
    assert.match(by["991"].meta_ad_external_id, /^ad-/);
    assert.deepEqual({ external_id: by["991"].ad_set.external_id, status: by["991"].ad_set.status },
      { external_id: AD_SET_EXT, status: "PAUSED" }, "a paused ad set shows as paused");
    assert.deepEqual(by["991"].campaign, { external_id: CAMPAIGN_EXT, status: "ACTIVE" });
    assert.ok(by["991"].loaded_at);

    assert.equal(by["992"].state, "refused");
    assert.deepEqual(by["992"].reasons, ["The final video is not in storage yet."]);
    assert.equal(by["992"].ad_row_id, null);
    assert.equal(by["992"].ad_set.external_id, AD_SET_EXT, "the funnel's default ad set, before any load");
    assert.equal(by["996"].state, "refused");
    assert.equal(by["993"].state, "refused");
    assert.ok(by["993"].reasons.includes(REASONS.NOT_APPROVED));

    // 994 was loaded before any job (loaded_at set by hand in the fixture).
    assert.equal(by["994"].state, "loaded");
    assert.equal(by["995"].state, "loaded");
  });

  test("another company sees none of it", async () => {
    const otherOrg = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ('mmload-pg-other', 'Other') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`
    )).rows[0].id;
    const other = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,'Other owner','owner','active') RETURNING id`,
      [otherOrg, `${EMAIL_TAG}.other@example.com`]
    )).rows[0].id;
    const token = (await createSession(db, { staffId: other, orgId: otherOrg })).token;
    const r = await callStatus(token);
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.loads, []);
    const p = await callLoad(token, { request_id: rid("other"), ad_video_id: vids.ok });
    assert.equal(p.code, 404, "our video is not found from another company");
    await db.query(`DELETE FROM marketing_requests WHERE org_id = $1`, [otherOrg]);
  });
});
