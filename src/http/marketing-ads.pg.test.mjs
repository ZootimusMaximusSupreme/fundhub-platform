// GET /api/marketing/ads and GET /api/marketing/ad?n=, against real Postgres.
//
// Lives under src/http/ because npm test globs src/** and scripts/** only
// (CLAUDE.md §12); it imports the api/ handlers.
//
// ⚠️ NEVER EXECUTED WHERE IT WAS WRITTEN. There is no Postgres on the Mac this
// was written on (2026-10-06). With DATABASE_URL unset the whole describe block
// SKIPS, and a skipped .pg.test.mjs is NOT green. It runs in CI ("tests"
// workflow: a fresh pgvector Postgres 16 built from every migration). Never
// point it at production: it writes rows.
//
// A COMPANY OF ITS OWN (org slug mads-pg-test), so exact sums are safe while
// other pg files write into the default company. A second company
// (mads-pg-other) runs its own ad 91 with spend, a script and a lead: none of
// it may show up in the first company's answers.
//
// THE CLOCK is fixed at 2026-09-18T00:00Z = Sep 17, 5 pm in Arizona. So the
// default window (the last 30 Arizona days) is 2026-08-19 .. 2026-09-17.
//
// THE 30-DAY FIXTURE (the window above, Arizona days):
//
//   ad 91  two Meta ads (U14/416: one number, two ad sets)
//          A91a every day of the 30: $10.00, 1000 shows, 12 taps, 400 plays,
//               100 at 25%, 40 ThruPlays, 300 2-second plays, a watch curve
//          A91a also 2026-08-18 (one day too old): $999.99 — not counted
//          A91b the last 10 days: $5.00, 400 shows, 4 taps, 100 plays, 30 at
//               25%, 10 ThruPlays, NO 2-second line, NO curve
//          L1  Aug 25: booked, showed (deposit, $500 typed), sale, $997 paid
//          L2  Sep 10: booked by email only, /roadmap order + $147 'slo' payment
//          L3  Sep 12: nothing yet
//          L4  a demo client — not a lead;  L5  Aug 10 — before the window
//          script: v1 archived (book_call / sorting / inquiries_off), v2 live
//                  (roadmap_147 / standard / two_files) — v2's labels win
//          watch: an alert (Sep 15), diagnoses on Sep 15 and on Aug 18
//   ad 92  A92 every day: $3.00, 500 shows, no link-click line, 50 plays, 5 at
//          25%, 2 ThruPlays; no leads; script book_call / sorting / inquiries_off
//   ad 93  A93 only on Aug 1-2 (before the window); script roadmap_147 /
//          standard / two_files; a diagnosis on Aug 1
//   ad 94  a script and nothing else
//   ad 95  one lead (Sep 1, settled) and nothing else
//   AU1    no number, campaign "MAds Retargeting": $2.00 every day → $60.00
//   AU2    no number, campaign "MAds SLO": $1.00 on the last 5 days → $5.00
//   L7     a lead whose tags name no ad
//
// WHO EACH QUERY RUNS AS. ads, ad_sets, campaigns, ad_metrics_daily,
// ad_scripts, ad_platform_* and the two watch tables FORCE row-level
// security, so their fixture rows go through asStaff(). The rest use the pool.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import { readAdNumbers, ratiosFor } from "../marketing/metrics.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import adsHandler, { readAdsPage, AD_ROW_KEYS, EXTRA_ROW_KEYS } from "../../api/marketing/ads.mjs";
import adHandler, { readAdDetail, DIAGNOSES_LIMIT } from "../../api/marketing/ad.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "mads-pg-test";
const OTHER_SLUG = "mads-pg-other";
const EMAIL_TAG = "mads_pg_test";
const NONCE = `mads-${process.pid}-${Date.now()}`;
const mail = (tag) => `${EMAIL_TAG}.${NONCE}.${tag}@example.com`;

const NOW = new Date("2026-09-18T00:00:00Z");
const FROM = "2026-08-19";
const TO = "2026-09-17";
const META_SYNCED = new Date("2026-09-17T14:01:50.000Z");

const C1_EXT = "880000000000000001";
const C2_EXT = "880000000000000002";
const S1_EXT = "880000000000000101";
const S2_EXT = "880000000000000102";
const S3_EXT = "880000000000000103";

// 22 buckets, Meta's own percents (394).
const CURVE_A = [100, 61, 45, 38, 33, 30, 27, 25, 23, 21, 20, 19, 18, 17, 16, 14, 11, 9, 7, 5, 4, 3];
const CURVE_B = [100, 50, 30, 20, 15, 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1];

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(handler, token, query = {}, { method = "GET" } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query, body: undefined }, r,
    { db, now: () => NOW });
  // What the wire carries: Dates become ISO strings.
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}
const getAds = (token, query) => call(adsHandler, token, query);
const getAd = (token, query) => call(adHandler, token, query);

describe("/api/marketing/ads and /api/marketing/ad", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, other, partner, otherPartner, closerId, productId;
  let tokenOwner, tokenAdmin, tokenCloser, tokenCsm;
  const ads = {};

  async function cleanupOrg(slug) {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [slug])).rows[0];
    if (!o) return;
    const id = o.id;
    for (const t of ["call_outcomes", "sales", "transactions", "payment_links", "bookings"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    }
    await db.query(`DELETE FROM client_ad_attribution WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM products WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE org_id = $1)`, [id]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [id]);
    await asStaff(async (tx) => {
      for (const t of ["ad_watch_curve_diagnoses", "ad_watch_curve_alerts", "ad_metrics_daily", "ads",
        "ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
        await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
      }
      // Children first: parent_script_id and root_script_id are ON DELETE RESTRICT.
      await tx.query(`DELETE FROM ad_scripts WHERE org_id = $1 AND parent_script_id IS NOT NULL`, [id]);
      await tx.query(`DELETE FROM ad_scripts WHERE org_id = $1`, [id]);
    });
    await db.query(`DELETE FROM partners WHERE org_id = $1`, [id]);
    // The org row last. If some other table grew a row under it, the next run reuses it.
    try { await db.query(`DELETE FROM orgs WHERE id = $1`, [id]); } catch { /* reused next run */ }
  }
  const cleanup = async () => { await cleanupOrg(ORG_SLUG); await cleanupOrg(OTHER_SLUG); };

  const makeOrg = async (slug, name) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1,$2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug, name]
  )).rows[0].id;

  async function staffIn(role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, mail(tag), `Marketing ads ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  async function client(orgId, tag, { demo = false } = {}) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
       VALUES ($1,$2,'Ads',$3,$4) RETURNING id`,
      [orgId, mail(tag), tag.toUpperCase(), demo]
    )).rows[0].id;
  }

  async function tagged(orgId, tag, capturedAt, utmContent, opts) {
    const id = await client(orgId, tag, opts);
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, captured_at)
       VALUES ($1,$2,'fb','slo',$3,$4)`,
      [id, orgId, utmContent, capturedAt]
    );
    return id;
  }

  /* One Meta account, campaigns, ad sets and ads for a company, inside asStaff. */
  async function metaFixture(tx, orgId, partnerId, slug) {
    // Meta campaigns need a category row for their company (046:348-354).
    await tx.query(
      `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
       VALUES ($1,'meta','funding','CREDIT')`, [orgId]);
    const conn = (await tx.query(
      `INSERT INTO ad_platform_connections
         (org_id, partner_id, platform, external_ad_account_id, connection_state,
          platform_verification_state, encrypted_access_token, last_synced_at)
       VALUES ($1,$2,'meta',$3,'active','approved','v1:x:y:z',$4) RETURNING id`,
      [orgId, partnerId, `acct-${slug}`, META_SYNCED]
    )).rows[0].id;
    const campaign = async (name, ext) => (await tx.query(
      `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id, status)
       VALUES ($1,$2,$3,$4,'funding',10000,'draft',$5,'ACTIVE') RETURNING id`,
      [orgId, partnerId, conn, name, ext]
    )).rows[0].id;
    const adSet = async (campaignId, name, ext) => (await tx.query(
      `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id, status)
       VALUES ($1,$2,$3,$4,$5,10000,'draft',$6,'ACTIVE') RETURNING id`,
      [orgId, partnerId, conn, campaignId, name, ext]
    )).rows[0].id;
    const ad = async (campaignId, adSetId, { name, number, ext, status, createdAt }) => (await tx.query(
      `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                        fundhub_ad_number, external_id, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9,$10) RETURNING id`,
      [orgId, partnerId, conn, campaignId, adSetId, name, number, ext, status, createdAt]
    )).rows[0].id;
    return { campaign, adSet, ad };
  }

  /* Ad-days for one ad, one row per Arizona day from..to, the same numbers each day. */
  const days = (tx, orgId, partnerId, adId, from, to, m) => tx.query(
    `INSERT INTO ad_metrics_daily
       (org_id, partner_id, ad_id, date, spend_cents, impressions, link_clicks,
        video_plays, video_p25_watched, video_thruplay_watched, video_continuous_2s_watched,
        video_play_curve, synced_at)
     SELECT $1::uuid, $2::uuid, $3::uuid, d::date, $6::bigint, $7::bigint, $8::bigint, $9::bigint,
            $10::bigint, $11::bigint, $12::bigint, $13::jsonb, $14::timestamptz
       FROM generate_series($4::date, $5::date, interval '1 day') AS g(d)`,
    [orgId, partnerId, adId, from, to, m.spend, m.imp, m.lc ?? null, m.plays ?? null, m.p25 ?? null,
     m.thru ?? null, m.two ?? null, m.curve ? JSON.stringify(m.curve) : null, META_SYNCED]
  );

  const script = (tx, orgId, partnerId, s) => tx.query(
    `INSERT INTO ad_scripts (org_id, partner_id, body, title, ad_id, funnel_key, script_format, angle_key,
                             status, version, parent_script_id, archived_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [orgId, partnerId, `${s.title}. Fixture body.`, s.title, s.n, s.funnel, s.format, s.angle,
     s.status ?? "locked", s.version ?? 1, s.parent ?? null, s.archivedAt ?? null]
  ).then((r) => r.rows[0].id);

  before(async () => {
    await cleanup();

    org = await makeOrg(ORG_SLUG, "Marketing ads fixture");
    other = await makeOrg(OTHER_SLUG, "Marketing ads, another company");
    partner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Ads fixture','mads-direct') RETURNING id`, [org]
    )).rows[0].id;
    otherPartner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Ads other','mads-other-direct') RETURNING id`, [other]
    )).rows[0].id;

    tokenOwner = (await staffIn("owner", "owner")).token;
    tokenAdmin = (await staffIn("admin", "admin")).token;
    const closer = await staffIn("closer", "closer");
    closerId = closer.id;
    tokenCloser = closer.token;
    tokenCsm = (await staffIn("csm", "csm")).token;
    productId = (await db.query(
      `INSERT INTO products (org_id, code, name, category) VALUES ($1,'mads-product','Ads fixture product','funding') RETURNING id`,
      [org]
    )).rows[0].id;

    // ── this company's Meta side, scripts and watch rows ────────────────────
    await asStaff(async (tx) => {
      const f = await metaFixture(tx, org, partner, ORG_SLUG);
      const c1 = await f.campaign("MAds SLO", C1_EXT);
      const c2 = await f.campaign("MAds Retargeting", C2_EXT);
      const s1 = await f.adSet(c1, "MAds set 1", S1_EXT);
      const s2 = await f.adSet(c1, "MAds set 2", S2_EXT);
      const s3 = await f.adSet(c2, "MAds set 3", S3_EXT);
      ads.A91a = await f.ad(c1, s1, { name: "SLO Ad 91 — Lenders read two files", number: "91", ext: "880000000000000201", status: "ACTIVE", createdAt: "2026-08-01T00:00:00Z" });
      ads.A91b = await f.ad(c1, s2, { name: "SLO Ad 91 — Lenders read two files (set 2)", number: "91", ext: "880000000000000202", status: "PAUSED", createdAt: "2026-09-01T00:00:00Z" });
      ads.A92 = await f.ad(c1, s1, { name: "SLO Ad 92 — Inquiries off first", number: "92", ext: "880000000000000203", status: "ACTIVE", createdAt: "2026-08-02T00:00:00Z" });
      ads.A93 = await f.ad(c1, s1, { name: "SLO Ad 93 — Old ad", number: "93", ext: "880000000000000206", status: "PAUSED", createdAt: "2026-07-20T00:00:00Z" });
      ads.AU1 = await f.ad(c2, s3, { name: "MAds retargeting carousel", number: null, ext: "880000000000000204", status: "ACTIVE", createdAt: "2026-08-03T00:00:00Z" });
      ads.AU2 = await f.ad(c1, s1, { name: "MAds August test", number: null, ext: "880000000000000205", status: "ACTIVE", createdAt: "2026-08-04T00:00:00Z" });

      await days(tx, org, partner, ads.A91a, FROM, TO, { spend: 1000, imp: 1000, lc: 12, plays: 400, p25: 100, thru: 40, two: 300, curve: CURVE_A });
      await days(tx, org, partner, ads.A91a, "2026-08-18", "2026-08-18", { spend: 99999, imp: 9999, lc: 999, plays: 999, p25: 99, thru: 9, two: 999, curve: CURVE_A });
      await days(tx, org, partner, ads.A91b, "2026-09-08", TO, { spend: 500, imp: 400, lc: 4, plays: 100, p25: 30, thru: 10 });
      await days(tx, org, partner, ads.A92, FROM, TO, { spend: 300, imp: 500, plays: 50, p25: 5, thru: 2, curve: CURVE_B });
      await days(tx, org, partner, ads.A93, "2026-08-01", "2026-08-02", { spend: 2000, imp: 1500, lc: 20, plays: 300, p25: 90, thru: 30, two: 400, curve: CURVE_B });
      await days(tx, org, partner, ads.AU1, FROM, TO, { spend: 200, imp: 100 });
      await days(tx, org, partner, ads.AU2, "2026-09-13", TO, { spend: 100, imp: 50 });

      // Scripts. 91 v1 is archived with other labels; v2 (live) is the one that counts.
      const v1 = await script(tx, org, partner, { n: "91", title: "Lenders read two files (first draft)", funnel: "book_call", format: "sorting", angle: "inquiries_off", status: "superseded", archivedAt: "2026-08-01T00:00:00Z" });
      await script(tx, org, partner, { n: "91", title: "Lenders read two files", funnel: "roadmap_147", format: "standard", angle: "two_files", version: 2, parent: v1 });
      await script(tx, org, partner, { n: "92", title: "Inquiries off first", funnel: "book_call", format: "sorting", angle: "inquiries_off" });
      await script(tx, org, partner, { n: "93", title: "Old ad", funnel: "roadmap_147", format: "standard", angle: "two_files" });
      await script(tx, org, partner, { n: "94", title: "Not filmed yet", funnel: "roadmap_147", format: "standard", angle: "fresh_angle" });

      // Watch rows (394/395).
      await tx.query(
        `INSERT INTO ad_watch_curve_alerts (ad_id, org_id, partner_id, dies_before_25_alerted_on, updated_at)
         VALUES ($1,$2,$3,'2026-09-15','2026-09-15T16:00:00Z')`, [ads.A91a, org, partner]);
      const diagnose = async (adId, date, d) => {
        const m = (await tx.query(`SELECT id FROM ad_metrics_daily WHERE ad_id = $1 AND date = $2::date`, [adId, date])).rows[0].id;
        await tx.query(
          `INSERT INTO ad_watch_curve_diagnoses (org_id, partner_id, ad_metrics_daily_id, diagnosis, fix_type, film_note, next_take_improved)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [org, partner, m, d.diagnosis, d.fix, d.note, d.improved ?? null]);
      };
      await diagnose(ads.A91a, "2026-09-15", { diagnosis: "opening", fix: "words", note: "Most plays stop before the quarter mark. Film a new first line, same body." });
      await diagnose(ads.A91a, "2026-08-18", { diagnosis: "ask", fix: "both", note: "They watch and do not tap. Change the ask.", improved: true });
      await diagnose(ads.A93, "2026-08-01", { diagnosis: "middle", fix: "visual", note: "They leave in the middle. Add a picture there." });
    });

    // ── leads ────────────────────────────────────────────────────────────────
    const booking = (clientId, status, createdAt, attendeeEmail = null) => db.query(
      `INSERT INTO bookings (org_id, client_id, source, status, attendee_email, created_at)
       VALUES ($1,$2,'sim',$3,$4,$5)`, [org, clientId, status, attendeeEmail, createdAt]);

    const l1 = await tagged(org, "l1", "2026-08-25T16:00:00Z", "91-two-files");
    await booking(l1, "booked", "2026-08-26T15:00:00Z");
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at)
       VALUES ($1,$2,$3,'deposit',50000,'2026-08-28T18:00:00Z')`, [org, l1, closerId]);
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at, external_ref)
       VALUES ($1,$2,$3,'997.00','active','2026-08-28T18:00:00Z',$4)`, [org, l1, productId, `${NONCE}-l1`]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','997.00','succeeded','{}'::jsonb,'2026-08-28T18:05:00Z')`, [org, l1]);

    const l2 = await tagged(org, "l2", "2026-09-10T18:00:00Z", "91");
    await booking(null, "booked", "2026-09-11T15:00:00Z", ` ${mail("l2").toUpperCase()} `);
    await db.query(
      `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents, link_ref, checkout_url,
                                  status, is_demo, paid_amount_cents, paid_at)
       VALUES ($1,$2,'diagnostic',14700,$3,'https://example.invalid/pay','paid',false,14700,'2026-09-10T18:10:00Z')`,
      [org, l2, `slo_${NONCE}_l2`]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','147.00','succeeded','{"source":"slo"}'::jsonb,'2026-09-10T18:10:00Z')`, [org, l2]);

    await tagged(org, "l3", "2026-09-12T15:00:00Z", "91");
    const l4 = await tagged(org, "l4", "2026-09-01T15:00:00Z", "91", { demo: true });
    await booking(l4, "booked", "2026-09-01T16:00:00Z");
    await tagged(org, "l5", "2026-08-10T15:00:00Z", "91");
    await tagged(org, "l6", "2026-09-01T15:00:00Z", "95");
    await tagged(org, "l7", "2026-09-03T15:00:00Z", "oVid: Nobody");

    // ── another company with its own ad 91 ───────────────────────────────────
    await asStaff(async (tx) => {
      const f = await metaFixture(tx, other, otherPartner, OTHER_SLUG);
      const c = await f.campaign("Other SLO", "770000000000000001");
      const s = await f.adSet(c, "Other set", "770000000000000101");
      const a = await f.ad(c, s, { name: "Other Ad 91", number: "91", ext: "770000000000000201", status: "ACTIVE", createdAt: "2026-08-01T00:00:00Z" });
      const u = await f.ad(c, s, { name: "Other unnumbered", number: null, ext: "770000000000000202", status: "ACTIVE", createdAt: "2026-08-01T00:00:00Z" });
      await days(tx, other, otherPartner, a, FROM, TO, { spend: 77777, imp: 7777, lc: 77, plays: 777, p25: 77, thru: 7, two: 777, curve: CURVE_B });
      await days(tx, other, otherPartner, u, FROM, TO, { spend: 5555, imp: 555 });
      await script(tx, other, otherPartner, { n: "91", title: "Other company's 91", funnel: "roadmap_147", format: "standard", angle: "two_files" });
      await script(tx, other, otherPartner, { n: "96", title: "Only in the other company", funnel: "roadmap_147", format: "standard", angle: "two_files" });
    });
    await tagged(other, "o1", "2026-09-05T15:00:00Z", "91");
  });

  after(async () => { await cleanup(); await close(); });

  const byNumber = (rows) => Object.fromEntries(rows.map((r) => [r.ad_number, r]));

  /* The route's row must carry exactly what U20's reader and ratiosFor say. */
  function assertMatchesReader(row, readerRow, label) {
    const q = ratiosFor(readerRow);
    const want = {
      ad_number: readerRow.ad_number,
      spend_cents: readerRow.spend_cents, impressions: readerRow.impressions,
      ctr: q.ctr, hook_rate: q.hook_rate, hold_25: q.hold_25, thruplay_rate: q.thruplay_rate,
      leads: readerRow.leads, booked: readerRow.booked, showed: readerRow.showed, sales: readerRow.sales,
      close_rate: q.close_rate, roadmaps: readerRow.roadmaps, cash_cents: readerRow.cash_cents,
      reported_cash_cents: readerRow.reported_cash_cents, cpl_cents: q.cpl_cents,
      cost_per_booked_cents: q.cost_per_booked_cents, roas: q.roas, maturing: readerRow.maturing,
      ads: readerRow.ads, link_clicks: readerRow.link_clicks, plays: readerRow.plays,
      ad_days: readerRow.ad_days, reported_days: readerRow.reported_days,
      maturing_leads: readerRow.maturing_leads, cash_unknown: readerRow.cash_unknown
    };
    for (const [k, v] of Object.entries(want)) {
      assert.deepEqual(row[k], v, `${label}: ${k} is ${JSON.stringify(row[k])}, the reader says ${JSON.stringify(v)}`);
    }
  }

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403; owner and admin 200; POST 405", async () => {
    for (const [get, q] of [[getAds, {}], [getAd, { n: "91" }]]) {
      assert.equal((await get(null, q)).code, 401);
      for (const t of [tokenCloser, tokenCsm]) {
        const r = await get(t, q);
        assert.equal(r.code, 403, JSON.stringify(r.body));
        assert.equal(r.body.error, "forbidden");
        assert.equal(r.body.rows, undefined, "a 403 carries no numbers");
        assert.equal(r.body.ad, undefined, "a 403 carries no numbers");
      }
      assert.equal((await get(tokenOwner, q)).code, 200);
      assert.equal((await get(tokenAdmin, q)).code, 200);
    }
    const p = await call(adsHandler, tokenOwner, {}, { method: "POST" });
    assert.equal(p.code, 405);
    assert.equal(p.headers.Allow, "GET");
    const p2 = await call(adHandler, tokenOwner, { n: "91" }, { method: "POST" });
    assert.equal(p2.code, 405);
    assert.equal(p2.headers.Allow, "GET");
  });

  // ── GET marketing/ads ─────────────────────────────────────────────────────

  test("ads: the contract shape, the last 30 Arizona days by default, as_of = the last Meta sync", async () => {
    const r = await getAds(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/ads", r.body);
    assert.deepEqual(Object.keys(r.body), ["rows", "unmapped", "as_of"]);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());
    for (const row of r.body.rows) {
      assert.deepEqual(Object.keys(row), [...AD_ROW_KEYS, ...EXTRA_ROW_KEYS], "contract keys first, in order");
    }
    // One row per number with spend or a lead in the window; most spend first, unknown spend last.
    assert.deepEqual(r.body.rows.map((x) => x.ad_number), ["91", "92", "95"],
      "93 ran only before the window, 94 never ran, 96 is another company's");
  });

  test("ads: exact numbers per ad number, equal to U20's readers", async () => {
    const r = await getAds(tokenOwner);
    const rows = byNumber(r.body.rows);
    const reader = byNumber(await asStaff((tx) => readAdNumbers(tx, { orgId: org, from: FROM, to: TO, now: NOW })));
    assert.deepEqual(Object.keys(reader).sort(), ["91", "92", "95"]);
    for (const n of Object.keys(reader)) assertMatchesReader(rows[n], reader[n], `ad ${n}`);

    // 91: two Meta ads add up; leads count once per number.
    const a = rows["91"];
    assert.equal(a.title, "Lenders read two files", "the live version's title, not the archived one");
    assert.equal(a.funnel_key, "roadmap_147");
    assert.equal(a.script_format, "standard");
    assert.equal(a.angle_key, "two_files");
    assert.equal(a.ads, 2);
    assert.equal(a.spend_cents, 30 * 1000 + 10 * 500, "Aug 18 is outside the window");
    assert.equal(a.impressions, 30 * 1000 + 10 * 400);
    assert.equal(a.link_clicks, 30 * 12 + 10 * 4);
    assert.equal(a.plays, 30 * 400 + 10 * 100);
    assert.equal(a.ad_days, 40);
    assert.deepEqual(a.reported_days, { link_clicks: 40, plays: 40, two_sec: 30 });
    assert.equal(a.ctr, 0.0118);          // 400 / 34000
    assert.equal(a.hook_rate, 0.2647);    // 9000 / 34000
    assert.equal(a.hold_25, 0.2538);      // 3300 / 13000
    assert.equal(a.thruplay_rate, 0.1);   // 1300 / 13000
    assert.equal(a.leads, 3, "L1 L2 L3 — not the demo client, not Aug 10");
    assert.equal(a.booked, 2, "L1 by client, L2 by email");
    assert.equal(a.showed, 1);
    assert.equal(a.sales, 1);
    assert.equal(a.close_rate, 1);
    assert.equal(a.roadmaps, 1);
    assert.equal(a.cash_cents, 99700 + 14700);
    assert.equal(a.reported_cash_cents, 50000);
    assert.equal(a.cpl_cents, 11667);     // 35000 / 3, rounded
    assert.equal(a.cost_per_booked_cents, 17500);
    assert.equal(a.roas, 3.2686);         // 114400 / 35000
    assert.equal(a.maturing, true, "L2 and L3 are younger than 14 days");
    assert.equal(a.maturing_leads, 2);

    // 92: spend, no leads, Meta never sent link clicks or 2-second plays.
    const b = rows["92"];
    assert.equal(b.title, "Inquiries off first");
    assert.equal(b.funnel_key, "book_call");
    assert.equal(b.spend_cents, 9000);
    assert.equal(b.impressions, 15000);
    assert.equal(b.ctr, null, "no link-click line from Meta: unknown, not 0");
    assert.equal(b.hook_rate, null, "no 2-second line from Meta: unknown, not 0");
    assert.equal(b.hold_25, 0.1);
    assert.equal(b.thruplay_rate, 0.04);
    assert.equal(b.leads, 0);
    assert.equal(b.close_rate, null, "nobody showed: no close rate");
    assert.equal(b.cpl_cents, null, "no leads: no cost per lead");
    assert.equal(b.cost_per_booked_cents, null);
    assert.equal(b.cash_cents, 0);
    assert.equal(b.roas, 0, "spend and no cash is a real 0");
    assert.equal(b.maturing, false);

    // 95: a lead, no Meta ad.
    const c = rows["95"];
    assert.equal(c.title, null, "no script: unknown");
    assert.equal(c.funnel_key, null);
    assert.equal(c.spend_cents, null, "no ad-days: unknown, never $0");
    assert.equal(c.impressions, null);
    assert.equal(c.ctr, null);
    assert.equal(c.leads, 1);
    assert.equal(c.cpl_cents, null);
    assert.equal(c.roas, null);
    assert.equal(c.ads, 0);
    assert.equal(c.maturing, false, "Sep 1 + 14 days is before the clock");

    // Money is whole cents.
    for (const row of r.body.rows) {
      for (const k of ["spend_cents", "cash_cents", "reported_cash_cents", "cpl_cents", "cost_per_booked_cents"]) {
        assert.ok(row[k] === null || Number.isInteger(row[k]), `${row.ad_number} ${k} = ${row[k]}`);
      }
    }
  });

  test("ads: unmapped spend per campaign, this company only", async () => {
    const r = await getAds(tokenOwner);
    assert.deepEqual(r.body.unmapped.map(({ campaign_id, ...rest }) => rest), [
      { campaign_external_id: C2_EXT, name: "MAds Retargeting", spend_cents: 30 * 200 },
      { campaign_external_id: C1_EXT, name: "MAds SLO", spend_cents: 5 * 100 }
    ]);
    for (const u of r.body.unmapped) assert.match(u.campaign_id, /^[0-9a-f-]{36}$/);
  });

  test("ads: from / to narrow the window, and still match the reader", async () => {
    const r = await getAds(tokenOwner, { from: "2026-09-08", to: "2026-09-17" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/ads", r.body);
    const rows = byNumber(r.body.rows);
    const reader = byNumber(await asStaff((tx) =>
      readAdNumbers(tx, { orgId: org, from: "2026-09-08", to: "2026-09-17", now: NOW })));
    assert.deepEqual(Object.keys(rows).sort(), Object.keys(reader).sort());
    for (const n of Object.keys(reader)) assertMatchesReader(rows[n], reader[n], `ad ${n} (Sep 8-17)`);
    assert.deepEqual(r.body.rows.map((x) => x.ad_number), ["91", "92"], "95's only lead is Sep 1");
    assert.equal(rows["91"].spend_cents, 10 * 1000 + 10 * 500);
    assert.equal(rows["91"].leads, 2, "L2 and L3");
    assert.equal(rows["91"].cash_cents, 14700);
    assert.equal(rows["92"].spend_cents, 10 * 300);
    assert.deepEqual(r.body.unmapped.map((u) => [u.name, u.spend_cents]), [["MAds Retargeting", 2000], ["MAds SLO", 500]]);

    // Only from: from .. today. Only to: the 30 days ending on to.
    const onlyFrom = await getAds(tokenOwner, { from: "2026-09-08" });
    assert.deepEqual(onlyFrom.body.rows, r.body.rows);
    const onlyTo = await getAds(tokenOwner, { to: TO });
    assert.deepEqual(onlyTo.body, (await getAds(tokenOwner)).body);
  });

  test("ads: funnel, format and angle filter on the live script's labels", async () => {
    const numbers = async (q) => {
      const r = await getAds(tokenOwner, q);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assertMatchesContract("GET marketing/ads", r.body);
      return r.body.rows.map((x) => x.ad_number);
    };
    assert.deepEqual(await numbers({ funnel: "roadmap_147" }), ["91"], "93 has no numbers in the window; 96 is another company's");
    assert.deepEqual(await numbers({ funnel: "book_call" }), ["92"], "91's archived draft said book_call; only its live version counts");
    assert.deepEqual(await numbers({ format: "sorting" }), ["92"]);
    assert.deepEqual(await numbers({ angle: "two_files" }), ["91"]);
    assert.deepEqual(await numbers({ funnel: "roadmap_147", format: "standard", angle: "two_files" }), ["91"]);
    assert.deepEqual(await numbers({ funnel: "roadmap_147", format: "sorting" }), []);
    assert.deepEqual(await numbers({ funnel: "no_such_funnel" }), [], "an unknown value is no rows, not an error");
    assert.deepEqual(await numbers({ funnel: "  " }), ["91", "92", "95"], "a blank filter is no filter");

    // A filtered row carries the same numbers as the unfiltered one.
    const all = byNumber((await getAds(tokenOwner)).body.rows);
    const one = (await getAds(tokenOwner, { funnel: "roadmap_147" })).body;
    assert.deepEqual(one.rows[0], all["91"]);
    assert.equal(one.unmapped.length, 2, "unmapped spend has no script, so the label filters do not narrow it");
  });

  test("ads: a bad from or to is a 400 that names the field", async () => {
    const bad = async (q, field) => {
      const r = await getAds(tokenOwner, q);
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
      assert.equal(typeof r.body.message, "string");
    };
    await bad({ from: "2026-13-01" }, "from");
    await bad({ from: "Sep 1" }, "from");
    await bad({ to: "nope" }, "to");
    await bad({ to: "2026-02-30" }, "to");
    await bad({ from: "2026-09-10", to: "2026-09-01" }, "from");
    await bad({ from: "2026-09-20" }, "from"); // after today, with no to
  });

  // ── GET marketing/ad?n= ───────────────────────────────────────────────────

  test("ad?n=91: the same row as the list, plus its Meta ads, the daily curve and the watch rows", async () => {
    const r = await getAd(tokenOwner, { n: "91" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/ad", r.body);
    assert.deepEqual(Object.keys(r.body), ["ad", "as_of"]);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());

    const { meta_ads, curve, watch, ...row } = r.body.ad;
    const listRow = byNumber((await getAds(tokenOwner)).body.rows)["91"];
    assert.deepEqual(row, listRow, "the drawer's numbers are the Ads view's numbers");

    assert.deepEqual(meta_ads, [
      { id: ads.A91a, external_id: "880000000000000201", name: "SLO Ad 91 — Lenders read two files", status: "ACTIVE", ad_set_external_id: S1_EXT },
      { id: ads.A91b, external_id: "880000000000000202", name: "SLO Ad 91 — Lenders read two files (set 2)", status: "PAUSED", ad_set_external_id: S2_EXT }
    ], "this company's ads only, oldest first");

    assert.equal(curve.length, 40, "30 days of A91a + 10 of A91b; Aug 18 is outside the 30 days");
    assert.deepEqual(curve[0], { date: FROM, video_play_curve: CURVE_A, ad_id: ads.A91a });
    const sep8 = curve.filter((c) => c.date === "2026-09-08");
    assert.deepEqual(sep8, [
      { date: "2026-09-08", video_play_curve: CURVE_A, ad_id: ads.A91a },
      { date: "2026-09-08", video_play_curve: null, ad_id: ads.A91b }
    ], "each Meta ad keeps its own curve; Meta sent none for A91b: null, never []");
    assert.equal(curve.at(-1).date, TO);
    assert.ok(curve.every((c, i) => i === 0 || c.date >= curve[i - 1].date), "oldest day first");

    assert.deepEqual(watch.alerts, [
      { ad_id: ads.A91a, dies_before_25_alerted_on: "2026-09-15", updated_at: "2026-09-15T16:00:00.000Z" }
    ]);
    assert.deepEqual(watch.diagnoses.map(({ id, created_at, ...d }) => d), [
      { date: "2026-09-15", diagnosis: "opening", fix_type: "words", film_note: "Most plays stop before the quarter mark. Film a new first line, same body.", next_take_improved: null, ad_id: ads.A91a },
      { date: "2026-08-18", diagnosis: "ask", fix_type: "both", film_note: "They watch and do not tap. Change the ask.", next_take_improved: true, ad_id: ads.A91a }
    ], "newest day first; an older diagnosis still shows; 93's never does");
    assert.ok(watch.diagnoses.length <= DIAGNOSES_LIMIT);
  });

  test("ad?n=93: a number that ran only before the 30 days: spend unknown, counts 0, its old diagnosis kept", async () => {
    const r = await getAd(tokenOwner, { n: "93" });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/ad", r.body);
    const a = r.body.ad;
    assert.equal(a.ad_number, "93");
    assert.equal(a.title, "Old ad");
    assert.equal(a.angle_key, "two_files");
    assert.equal(a.spend_cents, null);
    assert.equal(a.impressions, null);
    assert.equal(a.ctr, null);
    assert.equal(a.leads, 0);
    assert.equal(a.cash_cents, 0);
    assert.equal(a.roas, null);
    assert.equal(a.maturing, false);
    assert.equal(a.ads, 0, "no Meta ad of 93 has an ad-day in the 30 days");
    assert.deepEqual(a.meta_ads.map((m) => m.id), [ads.A93]);
    assert.deepEqual(a.curve, []);
    assert.deepEqual(a.watch.alerts, []);
    assert.deepEqual(a.watch.diagnoses.map((d) => [d.date, d.diagnosis, d.fix_type]), [["2026-08-01", "middle", "visual"]]);
  });

  test("ad?n=94 (a script only) and n=95 (a lead only) answer 200; n=96 is another company's: 404", async () => {
    const s = await getAd(tokenOwner, { n: "94" });
    assert.equal(s.code, 200, JSON.stringify(s.body));
    assertMatchesContract("GET marketing/ad", s.body);
    assert.equal(s.body.ad.title, "Not filmed yet");
    assert.equal(s.body.ad.spend_cents, null);
    assert.deepEqual(s.body.ad.meta_ads, []);
    assert.deepEqual(s.body.ad.curve, []);
    assert.deepEqual(s.body.ad.watch, { alerts: [], diagnoses: [] });

    const l = await getAd(tokenOwner, { n: "95" });
    assert.equal(l.code, 200, JSON.stringify(l.body));
    assertMatchesContract("GET marketing/ad", l.body);
    const listRow = byNumber((await getAds(tokenOwner)).body.rows)["95"];
    const { meta_ads, curve, watch, ...row } = l.body.ad;
    assert.deepEqual(row, listRow);
    assert.deepEqual(meta_ads, []);

    const o = await getAd(tokenOwner, { n: "96" });
    assert.equal(o.code, 404, "96 lives in the other company only");
    assert.equal(o.body.error, "not_found");
  });

  test("ad?n=: unknown number 404; missing or not digits 400 on field n", async () => {
    for (const n of ["999", "091", "123456789"]) {
      const r = await getAd(tokenOwner, { n });
      assert.equal(r.code, 404, `${n}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "not_found");
      assert.equal(typeof r.body.message, "string");
    }
    for (const q of [{}, { n: "" }, { n: "abc" }, { n: "9-1" }, { n: "1234567890" }, { n: "-1" }]) {
      const r = await getAd(tokenOwner, q);
      assert.equal(r.code, 400, `${JSON.stringify(q)}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, "n");
    }
  });

  // ── read only, nothing texted (M5 done #3) ────────────────────────────────

  test("nothing is texted and nothing is written: every query both routes run is a read", async () => {
    const seen = [];
    const spyOn = (tx) => ({ query: (sql, params) => { seen.push(sql); return tx.query(sql, params); } });
    await asStaff((tx) => readAdsPage(spyOn(tx), { orgId: org, from: FROM, to: TO, now: NOW }));
    await asStaff((tx) => readAdsPage(spyOn(tx), { orgId: org, from: FROM, to: TO, funnel: "roadmap_147", now: NOW }));
    for (const n of ["91", "93", "94", "95", "999"]) {
      await asStaff((tx) => readAdDetail(spyOn(tx), { orgId: org, n, from: FROM, to: TO, now: NOW }));
    }
    assert.ok(seen.length >= 10);
    for (const sql of seen) {
      assert.match(sql.trim(), /^(SELECT|WITH)\b/i, `not a read: ${sql.slice(0, 80)}`);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|MERGE)\b/i, `writes: ${sql.slice(0, 80)}`);
    }
    for (const id of [org, other]) {
      const texts = (await db.query(`SELECT count(*)::int AS n FROM messages WHERE org_id = $1`, [id])).rows[0].n;
      const buzzes = (await db.query(`SELECT count(*)::int AS n FROM marketing_buzzes WHERE org_id = $1`, [id])).rows[0].n;
      assert.equal(texts, 0, "no message row");
      assert.equal(buzzes, 0, "no buzz row");
    }
  });

  // ── fast with 30 days (M5 done #2): the plans use indexes ─────────────────
  //
  // A CI stopwatch proves nothing about production, so this proves the shape
  // instead: every read of ad_metrics_daily and client_ad_attribution is found
  // through an index, with an index condition. On a fixture this small Postgres
  // would read each table whole, because that is cheaper for 200 rows, so the
  // transaction turns seq scans off (SET LOCAL, gone at COMMIT). That asks the
  // planner "can an index serve this query?". When no index fits, Postgres
  // still reads the whole table and this test fails: that is the "an index is
  // missing" signal (lane D migration number 425). The live timing of each
  // route is taken after ship and written on the board by the orchestrator.
  //
  // One query is left out on purpose: readLastSync (api/marketing/today.mjs,
  // shared with GET marketing/funnels) reads max(synced_at) over the company's
  // ad-days, which no index orders. It is one aggregate over the company's own
  // rows and is not this unit's code.

  const SCAN_TYPES = new Set(["Index Scan", "Index Only Scan", "Bitmap Heap Scan"]);
  const WATCHED = new Set(["ad_metrics_daily", "client_ad_attribution"]);

  function nodesOf(plan, out = []) {
    out.push(plan);
    for (const child of plan.Plans || []) nodesOf(child, out);
    return out;
  }
  function hasIndexCond(node) {
    if (node["Index Cond"]) return true;
    return (node.Plans || []).some((c) => /Bitmap/.test(c["Node Type"]) && (c["Index Cond"] || hasIndexCond(c)));
  }

  async function explainAll(run) {
    const plans = [];
    await asStaff(async (tx) => {
      await tx.query("SET LOCAL enable_seqscan = off");
      const spy = {
        query: async (sql, params) => {
          const ex = await tx.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, params);
          plans.push({ sql, plan: ex.rows[0]["QUERY PLAN"][0] });
          return tx.query(sql, params);
        }
      };
      await run(spy);
    });
    return plans;
  }

  test("EXPLAIN (ANALYZE) on the 30-day fixture: index scans on ad_metrics_daily and client_ad_attribution", async (t) => {
    const plans = [
      ...await explainAll((tx) => readAdsPage(tx, { orgId: org, from: FROM, to: TO, now: NOW })),
      ...await explainAll((tx) => readAdsPage(tx, { orgId: org, from: FROM, to: TO, funnel: "roadmap_147", now: NOW })),
      ...await explainAll((tx) => readAdDetail(tx, { orgId: org, n: "91", from: FROM, to: TO, now: NOW })),
      ...await explainAll((tx) => readAdDetail(tx, { orgId: org, n: "95", from: FROM, to: TO, now: NOW }))
    ];
    const seen = new Set();
    for (const { sql, plan } of plans) {
      const lastSync = /max\(synced_at\)/.test(sql);
      const nodes = nodesOf(plan.Plan);
      const summary = nodes.filter((n) => n["Relation Name"]).map((n) => `${n["Node Type"]} ${n["Relation Name"]}${n["Index Name"] ? ` (${n["Index Name"]})` : ""}`);
      t.diagnostic(`${lastSync ? "[not checked] " : ""}${sql.trim().split("\n")[0].slice(0, 70)} … ${plan["Execution Time"]} ms: ${summary.join("; ")}`);
      if (lastSync) continue;
      for (const node of nodes) {
        const rel = node["Relation Name"];
        if (!WATCHED.has(rel)) continue;
        seen.add(rel);
        assert.ok(SCAN_TYPES.has(node["Node Type"]),
          `${rel} read by ${node["Node Type"]}, not an index, in: ${sql.trim().slice(0, 120)}\n${summary.join("\n")}`);
        assert.ok(hasIndexCond(node),
          `${rel} read by ${node["Node Type"]} with no index condition (a whole-index walk), in: ${sql.trim().slice(0, 120)}\n${summary.join("\n")}`);
      }
    }
    assert.deepEqual([...seen].sort(), ["ad_metrics_daily", "client_ad_attribution"], "both tables were read and checked");
  });
});
