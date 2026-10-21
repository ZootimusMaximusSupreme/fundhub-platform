// Where people stop watching an ad — the eight columns, against real Postgres.
//
// Two halves, and the second is the one that matters:
//
//   1. THE COLUMNS EXIST AND NULL SURVIVES. A row written with the eight video
//      numbers reads back with those numbers; a row written without them reads
//      back NULL, not 0. That difference is the entire reason
//      db/migrations/378_ad_video_metrics.sql was written: a photo ad has NO
//      such number, a video nobody watched has zero, and a screen must never
//      show those two as the same thing.
//
//   2. THE WHOLE PULL, END TO END, WITH A FAKE META. POST /api/campaigns/sync is
//      driven with an injected fetch that answers exactly the way Meta's
//      documentation says it does — the eight fields come back as LISTS of
//      { action_type, value } objects with STRING values. It asserts that the
//      request asked for all eight, and that the numbers landed in the columns.
//
//      ⚠️ AND THAT NO FIELD NAME IS INVENTED. Meta refuses the WHOLE insights
//      request when one field name is unknown, so one bad name empties spend,
//      clicks and impressions too. We asked for video_3sec_watched_actions
//      until 2026-09-09 and Meta has no such field. The names below are Meta's
//      own, read from facebook_business/adobjects/adsinsights.py.
//
// Lives under src/http/, not next to the handler under api/, because npm test's
// glob is "src/**" and "scripts/**" only (CLAUDE.md §12) — a test file under
// api/ silently never runs while looking green.
//
// ⚠️ NEVER EXECUTED. There is no Postgres on the machine this was written on, so
// the whole describe block skips with DATABASE_URL unset. A skipped
// .pg.test.mjs is NOT green (CLAUDE.md §12). Nothing here has been observed
// passing, and the Meta payload below is written from Meta's documentation, not
// captured from a real ad account.
//
// WHO EACH QUERY RUNS AS. ad_metrics_daily, ads, ad_sets, campaigns and
// ad_platform_connections all carry FORCEd row-level security. A bare db.query
// against one of them is anonymous to those policies and touches ZERO rows
// rather than erroring, so every fixture write and every verification read here
// goes through asStaff(). The bare db.query calls are against partners, staff
// and accounts, which carry no such policy.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import syncHandler from "../../api/campaigns/sync.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG = "videometrics-pg-test";
const EMAIL = `partner.videometrics_pg_test@example.com`;

const VIDEO_COLUMNS = [
  "video_continuous_2s_watched",
  "video_plays",
  "video_p25_watched",
  "video_p50_watched",
  "video_p75_watched",
  "video_p95_watched",
  "video_p100_watched",
  "video_thruplay_watched"
];

const META_FIELDS = [
  "video_continuous_2_sec_watched_actions",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_thruplay_watched_actions"
];

/* One Meta action array, exactly as documented: a list, one object, a STRING. */
const views = (n) => [{ action_type: "video_view", value: String(n) }];

/* video_play_actions is the one field Meta labels video_play, not video_view. */
const plays = (n) => [{ action_type: "video_play", value: String(n) }];

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

describe("ad video drop-off metrics", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partnerId, connId, campaignId, adSetId, adId, partnerToken;
  const requestedUrls = [];

  /* The fake Meta. Four shapes of URL, answered in the documented shape.
     `ok` + `text()` is all callPlatform reads (src/adplatforms/_api.mjs:22-39). */
  const fakeFetch = async (url) => {
    requestedUrls.push(String(url));
    const u = String(url);
    let payload;
    if (u.includes("/campaigns?")) {
      payload = { data: [{ id: "vm-camp-1", name: "Video metrics campaign", status: "ACTIVE" }] };
    } else if (u.includes("/adsets?")) {
      payload = { data: [{ id: "vm-set-1", name: "Video metrics ad set", status: "ACTIVE" }] };
    } else if (u.includes("/ads?")) {
      payload = { data: [{ id: "vm-ad-1", name: "Video metrics ad", status: "ACTIVE" }] };
    } else if (u.includes("/insights?")) {
      payload = {
        data: [{
          // The pull is now ONE account-level request at level=ad, so every row
          // carries the ad it belongs to. Without ad_id a row cannot be tied to
          // an ad and is dropped on purpose.
          ad_id: "vm-ad-1",
          date_start: "2026-09-01",
          spend: "12.34",
          impressions: "1000",
          clicks: "25",
          ctr: "2.5",
          video_continuous_2_sec_watched_actions: views(400),
          video_play_actions: plays(650),
          video_p25_watched_actions: views(220),
          video_p50_watched_actions: views(140),
          video_p75_watched_actions: views(90),
          video_p95_watched_actions: views(60),
          video_p100_watched_actions: views(55),
          video_thruplay_watched_actions: views(180)
        }]
      };
    } else {
      payload = { data: [] };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
  };

  before(async () => {
    org = await resolveDefaultOrg(db);

    // The token this suite stores is decrypted again inside the same process, so
    // a throwaway key is enough. A real key already in the environment is left
    // alone rather than overwritten.
    if (!process.env.AD_TOKEN_ENC_KEY) {
      process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
    }

    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email, agreement_signed_at)
       VALUES ($1,'Video metrics fixture',$2,'active',$3,now())
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, SLUG, EMAIL]
    )).rows[0].id;

    await dropRows();

    // Oldest active staff row, for the invite the partner account needs. Ordered
    // rather than LIMIT 1 unordered, because test files run concurrently and an
    // arbitrary staff row can be deleted mid-run by another suite.
    const staffId = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND status = 'active'
        ORDER BY created_at LIMIT 1`, [org]
    )).rows[0]?.id;
    if (!staffId) throw new Error("no active staff — run scripts/seed-staff.mjs");

    const { createAccount, createAccountSession } = await import("../auth/account-session.mjs");
    const existing = await db.query(`SELECT id FROM accounts WHERE email = $1`, [EMAIL]);
    const accountId = existing.rows[0]
      ? existing.rows[0].id
      : (await createAccount(db, {
          orgId: org, kind: "partner", email: EMAIL, name: "Video metrics partner",
          password: `Videometrics-passw0rd!`, partnerId, invitedBy: staffId
        })).id;
    partnerToken = (await createAccountSession(db, { accountId, orgId: org })).token;

    await asStaff(async (tx) => {
      connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved',$4) RETURNING id`,
        [org, partnerId, `act_${SLUG}`,
         encryptToken("fake-meta-user-token", { partnerId })]
      )).rows[0].id;

      // offer_type 'funding' is one of the three seeded into
      // ad_platform_category_map by 052_config_defaults.sql, so 046's launch
      // guard lets this through at approval_state 'draft'.
      campaignId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                                budget_cents, approval_state)
         VALUES ($1,$2,$3,'Video metrics campaign','funding',10000,'draft') RETURNING id`,
        [org, partnerId, connId]
      )).rows[0].id;

      adSetId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name,
                              budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'Video metrics ad set',10000,'draft') RETURNING id`,
        [org, partnerId, connId, campaignId]
      )).rows[0].id;

      adId = (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name)
         VALUES ($1,$2,$3,$4,$5,'Video metrics ad') RETURNING id`,
        [org, partnerId, connId, campaignId, adSetId]
      )).rows[0].id;
    });
  });

  after(async () => { await dropRows(); await close(); });

  /* Everything this suite creates that the schema permits deleting, child
     first. The partner and the account are left in place — the partner is
     RESTRICTed by rows other suites may hold, and a find-or-create in before()
     adopts them on the next run. */
  async function dropRows() {
    await asStaff(async (tx) => {
      for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = $1`, [partnerId]);
      }
      await tx.query(`DELETE FROM ad_platform_connections WHERE partner_id = $1`, [partnerId]);
    });
  }

  const readRow = (date) => asStaff((tx) => tx.query(
    `SELECT * FROM ad_metrics_daily WHERE ad_id = $1 AND date = $2::date`, [adId, date]
  ).then((r) => r.rows[0]));

  // ── 1. the columns, and the difference between 0 and nothing ─────────────

  test("all eight columns exist on ad_metrics_daily", async () => {
    const r = await db.query(
      `SELECT column_name, data_type, is_nullable, column_default
         FROM information_schema.columns
        WHERE table_name = 'ad_metrics_daily' AND column_name = ANY($1)`,
      [VIDEO_COLUMNS]
    );
    assert.equal(r.rows.length, 8,
      `migration 378 has not been applied here — found ${r.rows.length} of 8 video columns`);
    for (const row of r.rows) {
      assert.equal(row.is_nullable, "YES", `${row.column_name} is NOT NULL, so "no video" cannot be stored`);
      assert.strictEqual(row.column_default, null,
        `${row.column_name} has a default of ${row.column_default} — a default would make every photo ad look watched-by-nobody`);
      assert.equal(row.data_type, "bigint", `${row.column_name} is ${row.data_type}, not bigint`);
    }
  });

  test("a row written with the eight numbers reads them all back", async () => {
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (
         org_id, partner_id, ad_id, date, spend_cents, impressions, clicks,
         video_continuous_2s_watched, video_plays,
         video_p25_watched, video_p50_watched, video_p75_watched,
         video_p95_watched, video_p100_watched, video_thruplay_watched
       ) VALUES ($1,$2,$3,'2026-08-01',1234,1000,25,400,650,220,140,90,60,55,180)`,
      [org, partnerId, adId]
    ));
    const row = await readRow("2026-08-01");
    assert.ok(row, "the row was not written");
    assert.equal(Number(row.video_continuous_2s_watched), 400);
    assert.equal(Number(row.video_plays), 650);
    assert.equal(Number(row.video_p25_watched), 220);
    assert.equal(Number(row.video_p50_watched), 140);
    assert.equal(Number(row.video_p75_watched), 90);
    assert.equal(Number(row.video_p95_watched), 60);
    assert.equal(Number(row.video_p100_watched), 55);
    assert.equal(Number(row.video_thruplay_watched), 180);
    assert.equal(Number(row.spend_cents), 1234, "money stopped being integer cents");
  });

  // The whole point of migration 378.
  test("a row written without them reads back NULL — not 0", async () => {
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions)
       VALUES ($1,$2,$3,'2026-08-02',500,900)`,
      [org, partnerId, adId]
    ));
    const row = await readRow("2026-08-02");
    for (const c of VIDEO_COLUMNS) {
      assert.strictEqual(row[c], null,
        `${c} came back as ${JSON.stringify(row[c])} — a photo ad now looks like a video nobody watched`);
    }
  });

  test("a real zero is stored as zero and stays different from NULL", async () => {
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, video_continuous_2s_watched)
       VALUES ($1,$2,$3,'2026-08-03',0)`,
      [org, partnerId, adId]
    ));
    const row = await readRow("2026-08-03");
    assert.equal(Number(row.video_continuous_2s_watched), 0, "a real zero did not survive");
    assert.notStrictEqual(row.video_continuous_2s_watched, null, "a real zero was flattened into 'unknown'");
    assert.strictEqual(row.video_p25_watched, null, "an unasked column was invented");
  });

  test("a negative count is refused by the database", async () => {
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, video_p50_watched)
         VALUES ($1,$2,$3,'2026-08-04',-1)`,
        [org, partnerId, adId]
      )),
      /video_nonneg|check constraint/i,
      "a negative watch count was accepted"
    );
  });

  test("the upsert key still updates in place rather than adding a second row", async () => {
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, video_p75_watched)
       VALUES ($1,$2,$3,'2026-08-05',10)
       ON CONFLICT (ad_id, date) DO UPDATE SET video_p75_watched = EXCLUDED.video_p75_watched`,
      [org, partnerId, adId]
    ));
    await asStaff((tx) => tx.query(
      `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, video_p75_watched)
       VALUES ($1,$2,$3,'2026-08-05',99)
       ON CONFLICT (ad_id, date) DO UPDATE SET video_p75_watched = EXCLUDED.video_p75_watched`,
      [org, partnerId, adId]
    ));
    const count = await asStaff((tx) => tx.query(
      `SELECT count(*)::int AS n FROM ad_metrics_daily WHERE ad_id = $1 AND date = '2026-08-05'`,
      [adId]
    ).then((r) => r.rows[0].n));
    assert.equal(count, 1, "the same ad and day wrote two rows");
    assert.equal(Number((await readRow("2026-08-05")).video_p75_watched), 99);
  });

  // ── 2. the sync, driven end to end against a fake Meta ────────────────────

  test("the sync asks Meta for all eight video fields and stores what comes back", async () => {
    requestedUrls.length = 0;
    const r = res();
    await syncHandler(
      { method: "POST", headers: { authorization: "Bearer " + partnerToken }, body: {}, query: {} },
      r,
      { db, fetch: fakeFetch }
    );

    assert.equal(r.code, 200, `the sync failed: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.errors, [], "the sync reported errors");
    assert.ok(r.body.insights >= 1, "no insight rows were stored");

    /* TWO insights calls for the whole ad account — the money, then the rest
       (2026-10-21: Meta answers the combined list over many days with false
       zeros, TWO INSIGHTS REQUESTS in api/campaigns/sync.mjs) — and never one
       per ad. One call per ad was hundreds of calls in a row on a real
       account, and did not finish in time. */
    const insightsCalls = requestedUrls.filter((u) => u.includes("/insights?"));
    assert.equal(insightsCalls.length, 2,
      `the numbers were pulled with ${insightsCalls.length} calls — it must be two calls for the whole ad account`);
    for (const insightsUrl of insightsCalls) {
      const decodedInsightsUrl = decodeURIComponent(insightsUrl);
      assert.ok(/act_[^/]+\/insights/.test(decodedInsightsUrl),
        `the numbers were asked of ${insightsUrl} — it must be the ad account, not one ad`);
      assert.ok(decodedInsightsUrl.includes("level=ad"),
        "the request did not ask for level=ad, so Meta would not return a row per ad");
      assert.ok(decodedInsightsUrl.includes("ad_id"),
        "the request never asked for ad_id, so the rows cannot be tied back to an ad");

      /* THE ONE THAT WOULD HAVE CAUGHT THE BUG. A field name Meta does not know
         makes Meta refuse the ENTIRE request, so spend, clicks and impressions
         come back empty too and the connection looks completely broken. Meta has
         no 3-second field in any spelling. */
      assert.ok(!/3_?sec/i.test(decodedInsightsUrl),
        "the request asks Meta for a 3-second field, which does not exist — Meta would refuse the whole call");
    }
    const fieldsOf = (u) => new URL(u).searchParams.get("fields").split(",");
    const videoCall = insightsCalls.find((u) => fieldsOf(u).includes("video_play_actions"));
    assert.ok(videoCall, "no request asked Meta for the video fields");
    for (const field of META_FIELDS) {
      assert.ok(videoCall.includes(field), `the request never asked Meta for ${field}`);
    }
    assert.equal(fieldsOf(videoCall).includes("spend"), false,
      "spend is on the video request — Meta answers that combined list with false zeros");

    const row = await asStaff((tx) => tx.query(
      `SELECT m.* FROM ad_metrics_daily m
         JOIN ads a ON a.id = m.ad_id
        WHERE a.external_id = 'vm-ad-1' AND m.date = '2026-09-01'::date`
    ).then((x) => x.rows[0]));
    assert.ok(row, "the synced day did not land in ad_metrics_daily");

    // The numbers arrived as lists of objects holding strings. These are the
    // numbers that were inside them.
    assert.equal(Number(row.video_continuous_2s_watched), 400,
      "the past-the-opening number did not survive the parse");
    assert.equal(Number(row.video_plays), 650,
      "the play count did not survive the parse — its rows are labelled video_play, not video_view");
    assert.equal(Number(row.video_p25_watched), 220);
    assert.equal(Number(row.video_p50_watched), 140);
    assert.equal(Number(row.video_p75_watched), 90);
    assert.equal(Number(row.video_p95_watched), 60);
    assert.equal(Number(row.video_p100_watched), 55);
    assert.equal(Number(row.video_thruplay_watched), 180, "ThruPlay did not survive the parse");
    assert.equal(Number(row.spend_cents), 1234, "the old columns broke while the new ones were added");
  });

  test("a photo ad — Meta sends no video fields — stores seven NULLs, not seven zeros", async () => {
    requestedUrls.length = 0;
    const photoFetch = async (url) => {
      const u = String(url);
      if (u.includes("/insights?")) {
        return {
          ok: true, status: 200,
          text: async () => JSON.stringify({
            data: [{
              ad_id: "vm-ad-1", date_start: "2026-09-02",
              spend: "5.00", impressions: "800", clicks: "9"
            }]
          })
        };
      }
      return fakeFetch(url);
    };

    const r = res();
    await syncHandler(
      { method: "POST", headers: { authorization: "Bearer " + partnerToken }, body: {}, query: {} },
      r,
      { db, fetch: photoFetch }
    );
    assert.equal(r.code, 200, `the sync failed: ${JSON.stringify(r.body)}`);

    const row = await asStaff((tx) => tx.query(
      `SELECT m.* FROM ad_metrics_daily m
         JOIN ads a ON a.id = m.ad_id
        WHERE a.external_id = 'vm-ad-1' AND m.date = '2026-09-02'::date`
    ).then((x) => x.rows[0]));
    assert.ok(row, "the day with no video fields was not stored at all");
    for (const c of VIDEO_COLUMNS) {
      assert.strictEqual(row[c], null,
        `${c} was stored as ${JSON.stringify(row[c])} for an ad Meta reported no video for`);
    }
    assert.equal(Number(row.spend_cents), 500, "spend was lost on a row with no video numbers");
  });
});
