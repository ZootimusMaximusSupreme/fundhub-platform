// The marketing numbers (src/marketing/metrics.mjs), against real Postgres.
//
// Lives under src/http/ because npm test's glob is src/** and scripts/** only
// (CLAUDE.md §12) and the endpoints that read these numbers (U31/U32) will be
// tested here too.
//
// ⚠️ NEVER EXECUTED WHERE IT WAS WRITTEN. There is no Postgres on the Mac this
// was written on (2026-10-06). With DATABASE_URL unset the whole describe block
// SKIPS, and a skipped .pg.test.mjs is NOT green. It runs in CI ("tests"
// workflow, a fresh pgvector Postgres 16 built from every migration). Never
// point it at production: it writes rows.
//
// ITS OWN COMPANY. Every row lives in a fixture org (slug "mmetrics-pg-test"),
// so exact sums are safe while other pg files write into the default company.
//
// THE FIXTURE — three ads by NUMBER, one ad with no number, a window of
// 2026-09-01..2026-09-10 (Arizona days), and the clock fixed at
// 2026-09-18T00:00Z. Nothing depends on the real date.
//
//   ad 90  (ads row A1)   spend 09-02 $100.00, 09-03 $50.00; 09-11 is outside
//          L1  booked by client id, showed (deposit, $500 typed), active sale,
//              $997.00 succeeded payment — all inside 14 days
//          L2  booked by EMAIL only (no client id on the booking), no-show,
//              paid /roadmap order (slo_) + the $147.00 'slo' transaction
//          L3  booking cancelled; its sale and payment land after 14 days
//          L4  a demo client — not a lead
//          L5  tagged 90 but captured 09-11 — outside the window
//   ad 84  (ads row B, Meta name "oVid: SLO4" in ad set 120000000000000001)
//          L6  booking completed, showed (downsell, $200 typed), sale REFUNDED,
//              a succeeded payment with NO amount, a demo payment, a demo
//              slo_ order, a failed payment, a non-roadmap paid order
//          L7  captured 2026-09-01T05:00Z = Aug 31 in Arizona — outside
//          L8  captured 2026-09-11T06:30Z = Sep 10 in Arizona — inside
//   ad 86  (ads row C, an image ad: no video numbers, no link-click line)
//          L9  the 'slo' transaction only (roadmap by funnel), $147.00
//   ad 91  no ads row at all: L11 is a lead with no spend
//   ads row U has no number: its $70.00 is unmapped; L10's tags match nothing
//
// WHO EACH QUERY RUNS AS. ads, ad_sets, campaigns, ad_metrics_daily and
// ad_platform_connections FORCE row-level security, so their fixture rows and
// every reader go through asStaff(). The rest use the plain pool.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { asStaff } from "../partners/rls.mjs";
import {
  readAdNumbers, readTotals, readDaily, readFunnelEvents, roadmapPaidPredicates, ratiosFor
} from "../marketing/metrics.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "mmetrics-pg-test";
const NONCE = `mmetrics-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`;

const FROM = "2026-09-01";
const TO = "2026-09-10";
const NOW = new Date("2026-09-18T00:00:00Z");
const ADSET_EXT = "120000000000000001";

describe("marketing metrics against real Postgres", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner, conn, campaign, adSet, staffId, productId;
  const ads = {};
  const lead = {};

  async function cleanup() {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (!o) return;
    const id = o.id;
    for (const t of ["events", "call_outcomes", "sales", "transactions", "payment_links", "bookings"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    }
    await db.query(`DELETE FROM client_ad_attribution WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM products WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [id]);
    await asStaff(async (tx) => {
      for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
        await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
      }
    });
    await db.query(`DELETE FROM partners WHERE org_id = $1`, [id]);
    // The org row last. If some other table grew a row under it, the next run reuses it.
    try { await db.query(`DELETE FROM orgs WHERE id = $1`, [id]); } catch { /* reused next run */ }
  }

  async function client(tag, { demo = false } = {}) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
       VALUES ($1,$2,'Metric',$3,$4) RETURNING id`,
      [org, mail(tag), tag.toUpperCase(), demo]
    )).rows[0].id;
  }

  async function tagged(tag, capturedAt, tags, opts) {
    const id = await client(tag, opts);
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, utm_term, captured_at)
       VALUES ($1,$2,'fb','slo',$3,$4,$5)`,
      [id, org, tags.utm_content ?? null, tags.utm_term ?? null, capturedAt]
    );
    lead[tag] = id;
    return id;
  }

  const booking = (clientId, status, createdAt, attendeeEmail = null) => db.query(
    `INSERT INTO bookings (org_id, client_id, source, status, attendee_email, created_at)
     VALUES ($1,$2,'sim',$3,$4,$5)`,
    [org, clientId, status, attendeeEmail, createdAt]
  );

  const outcome = (clientId, kind, cents, loggedAt, demo = false) => db.query(
    `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at, is_demo)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [org, clientId, staffId, kind, cents, loggedAt, demo]
  );

  const sale = (clientId, status, soldAt, ref) => db.query(
    `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at, external_ref)
     VALUES ($1,$2,$3,'997.00',$4,$5,$6)`,
    [org, clientId, productId, status, soldAt, `${NONCE}-${ref}`]
  );

  const payment = (clientId, { amount, status = "succeeded", source = null, at, demo = false }) => db.query(
    `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at, is_demo)
     VALUES ($1,$2,'fixture',$3,$4,$5::jsonb,$6,$7)`,
    [org, clientId, amount, status, JSON.stringify(source ? { source } : {}), at, demo]
  );

  const order = (clientId, ref, { status = "paid", demo = false, at }) => db.query(
    `INSERT INTO payment_links (org_id, client_id, purpose, amount_cents, link_ref, checkout_url,
                                status, is_demo, paid_amount_cents, paid_at)
     VALUES ($1,$2,'diagnostic',14700,$3,'https://example.invalid/pay',$4,$5,
             CASE WHEN $4 = 'paid' THEN 14700 END, CASE WHEN $4 = 'paid' THEN $6::timestamptz END)`,
    [org, clientId, ref, status, demo, at]
  );

  const event = (name, payload, at, demo = false) => db.query(
    `INSERT INTO events (org_id, name, payload, created_at, is_demo) VALUES ($1,$2,$3::jsonb,$4,$5)`,
    [org, name, JSON.stringify(payload), at, demo]
  );

  before(async () => {
    await cleanup();

    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Marketing metrics fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    partner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Metrics fixture','mmetrics-direct') RETURNING id`, [org]
    )).rows[0].id;
    staffId = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,'Metrics Closer','closer','active') RETURNING id`,
      [org, mail("closer")]
    )).rows[0].id;
    productId = (await db.query(
      `INSERT INTO products (org_id, code, name, category) VALUES ($1,'mmetrics-product','Metrics fixture product','funding') RETURNING id`,
      [org]
    )).rows[0].id;

    // ── ads and their days ──────────────────────────────────────────────────
    await asStaff(async (tx) => {
      // Meta campaigns need a category row for their company (046:348-354).
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [org]);
      conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta','acct-mmetrics','active','approved','v1:x:y:z') RETURNING id`,
        [org, partner]
      )).rows[0].id;
      campaign = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state)
         VALUES ($1,$2,$3,'oPur: TOF-SLO: fixture','funding',10000,'draft') RETURNING id`,
        [org, partner, conn]
      )).rows[0].id;
      adSet = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id)
         VALUES ($1,$2,$3,$4,'Metrics ad set',10000,'draft',$5) RETURNING id`,
        [org, partner, conn, campaign, ADSET_EXT]
      )).rows[0].id;

      const ad = async (key, name, number, externalId) => {
        ads[key] = (await tx.query(
          `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                            fundhub_ad_number, external_id)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8) RETURNING id`,
          [org, partner, conn, campaign, adSet, name, number, externalId]
        )).rows[0].id;
      };
      await ad("A1", "oVid: SLO2", "90", "mm-metrics-meta-a1");
      await ad("B", "oVid: SLO4", "84", "mm-metrics-meta-b");
      await ad("C", "Static C", "86", "mm-metrics-meta-c");
      await ad("U", "oVid: August", null, "mm-metrics-meta-u");

      const day = (adKey, date, m) => tx.query(
        `INSERT INTO ad_metrics_daily
           (org_id, partner_id, ad_id, date, spend_cents, impressions, link_clicks,
            video_plays, video_p25_watched, video_thruplay_watched, video_continuous_2s_watched)
         VALUES ($1,$2,$3,$4::date,$5,$6,$7,$8,$9,$10,$11)`,
        [org, partner, ads[adKey], date, m.spend, m.imp, m.lc ?? null,
         m.plays ?? null, m.p25 ?? null, m.thru ?? null, m.two ?? null]
      );
      await day("A1", "2026-09-02", { spend: 10000, imp: 1000, lc: 40, plays: 200, p25: 50, thru: 20 });
      await day("A1", "2026-09-03", { spend: 5000, imp: 500, plays: 100, p25: 25, thru: 10 }); // no link-click line
      await day("A1", "2026-09-11", { spend: 99999, imp: 9999, lc: 999 });                     // outside the window
      await day("B", "2026-09-01", { spend: 2000, imp: 300, lc: 6, plays: 50, p25: 10, thru: 5, two: 30 });
      await day("C", "2026-09-05", { spend: 3000, imp: 600 });                                  // image ad
      await day("U", "2026-09-02", { spend: 7000, imp: 700, lc: 14 });                          // no number
    });

    // ── ad 90 ───────────────────────────────────────────────────────────────
    const l1 = await tagged("l1", "2026-09-02T16:00:00Z", { utm_content: "90-slo" });
    await booking(l1, "booked", "2026-09-03T15:00:00Z");
    await outcome(l1, "deposit", 50000, "2026-09-05T18:00:00Z");
    await sale(l1, "active", "2026-09-05T18:00:00Z", "l1");
    await payment(l1, { amount: "997.00", at: "2026-09-05T18:05:00Z" });

    const l2 = await tagged("l2", "2026-09-04T18:00:00Z", { utm_content: "90" });
    // Booked by email only: no client id on the booking, the email in other case and spaces.
    await booking(null, "rescheduled", "2026-09-05T15:00:00Z", `  ${mail("l2").toUpperCase()} `);
    await outcome(l2, "no_show", 0, "2026-09-08T18:00:00Z");
    await order(l2, `slo_${NONCE}_l2`, { at: "2026-09-04T18:10:00Z" });
    await payment(l2, { amount: "147.00", source: "slo", at: "2026-09-04T18:10:00Z" });

    const l3 = await tagged("l3", "2026-09-05T15:00:00Z", { utm_content: "90_two" });
    await booking(l3, "cancelled", "2026-09-06T15:00:00Z");
    await sale(l3, "active", "2026-09-25T15:00:00Z", "l3");            // after its 14 days
    await payment(l3, { amount: "500.00", at: "2026-09-25T15:00:00Z" }); // after its 14 days

    const l4 = await tagged("l4", "2026-09-03T15:00:00Z", { utm_content: "90" }, { demo: true });
    await booking(l4, "booked", "2026-09-03T16:00:00Z");
    await tagged("l5", "2026-09-11T15:00:00Z", { utm_content: "90" });

    // ── ad 84 ───────────────────────────────────────────────────────────────
    const l6 = await tagged("l6", "2026-09-01T08:00:00Z", { utm_content: "84" });
    await booking(l6, "completed", "2026-09-02T15:00:00Z");
    await outcome(l6, "downsell", 20000, "2026-09-03T18:00:00Z");
    await sale(l6, "refunded", "2026-09-03T18:00:00Z", "l6");
    await payment(l6, { amount: null, at: "2026-09-03T18:05:00Z" });                 // amount not reported
    await payment(l6, { amount: "500.00", at: "2026-09-03T18:06:00Z", demo: true }); // demo
    await payment(l6, { amount: "300.00", status: "failed", at: "2026-09-03T18:07:00Z" });
    await order(l6, `slo_${NONCE}_l6demo`, { demo: true, at: "2026-09-03T18:08:00Z" });
    await order(l6, `dep_${NONCE}_l6`, { at: "2026-09-03T18:09:00Z" });              // not a roadmap order

    await tagged("l7", "2026-09-01T05:00:00Z", { utm_content: "84" });  // Aug 31 in Arizona
    await tagged("l8", "2026-09-11T06:30:00Z", { utm_content: "84" });  // Sep 10 in Arizona

    // ── ad 86, ad 91, and a lead with no number ────────────────────────────
    const l9 = await tagged("l9", "2026-09-01T12:00:00Z", { utm_content: "86" });
    await payment(l9, { amount: "147.00", source: "slo", at: "2026-09-02T12:00:00Z" });
    await tagged("l10", "2026-09-03T15:00:00Z", { utm_content: "oVid: Nobody", utm_term: ADSET_EXT });
    await tagged("l11", "2026-09-06T15:00:00Z", { utm_content: "91" });

    // ── page events ────────────────────────────────────────────────────────
    const person = (page, session, attribution, extra = {}) =>
      ({ page, session_id: session, actor: "person", actor_reason: "fixture", attribution, ...extra });
    await event("funnel.page", person("/roadmap", "s1", { utm_content: "90-slo" }, { funnel: "roadmap", step: 1, event: "page_view" }), "2026-09-02T17:00:00Z");
    await event("funnel.page", person("/roadmap", "s2", { utm_content: "90" }, { funnel: "roadmap", step: 1, event: "page_view" }), "2026-09-04T17:00:00Z");
    await event("funnel.click", person("/roadmap", "s1", { utm_content: "90-slo" }, { funnel: "roadmap", step: 1, event: "click" }), "2026-09-02T17:01:00Z");
    await event("funnel.page", person("/roadmap-book", "s1", { utm_content: "90-slo" }, { funnel: "roadmap", step: 2, event: "page_view" }), "2026-09-02T17:02:00Z");
    // The Meta match: ad name + ad set id, no number in the link.
    await event("funnel.page", person("/watch", "s3", { utm_content: "oVid: SLO4", utm_term: ADSET_EXT }, { funnel: "watch", step: 1, event: "page_view" }), "2026-09-01T17:00:00Z");
    // A row saved before 2026-10-02: page, no funnel or step.
    await event("funnel.page", person("/roadmap", "s4", { utm_content: "86" }), "2026-09-05T17:00:00Z");
    await event("funnel.page", person("/home", "s5", null, { funnel: "homepage", step: 1, event: "page_view" }), "2026-09-06T17:00:00Z");
    // Not counted: a bot, a demo row, a day outside the window.
    await event("funnel.page", { ...person("/roadmap", "s6", { utm_content: "90" }), actor: "agent" }, "2026-09-02T18:00:00Z");
    await event("funnel.page", person("/roadmap", "s7", { utm_content: "90" }), "2026-09-02T19:00:00Z", true);
    await event("funnel.page", person("/roadmap", "s8", { utm_content: "90" }), "2026-09-12T17:00:00Z");
  });

  after(async () => { await cleanup(); await close(); });

  const byNumber = (rows) => Object.fromEntries(rows.map((r) => [r.ad_number, r]));
  const read = (fn, args) => asStaff((tx) => fn(tx, { orgId: org, ...args }));

  // ── per ad number ─────────────────────────────────────────────────────────

  test("ad 90: exact spend, leads, booked, showed, sales, roadmaps, cash and reported cash", async () => {
    const rows = byNumber(await read(readAdNumbers, { from: FROM, to: TO, now: NOW }));
    const r = rows["90"];
    assert.ok(r, JSON.stringify(Object.keys(rows)));
    assert.equal(r.ads, 1);
    assert.equal(r.spend_cents, 15000, "09-11 is outside the window");
    assert.equal(r.impressions, 1500);
    assert.equal(r.link_clicks, 40, "the day with no link-click line adds nothing, and is not counted as 0");
    assert.deepEqual(r.reported_days, { link_clicks: 1, plays: 2, two_sec: 0 });
    assert.equal(r.plays, 300);
    assert.equal(r.p25, 75);
    assert.equal(r.thruplay, 30);
    assert.equal(r.two_sec, null, "Meta never reported 2-second plays: unknown, not 0");
    assert.equal(r.leads, 3, "L1, L2, L3 — not the demo client, not the 09-11 lead");
    assert.equal(r.booked, 2, "L1 by client id, L2 by email; L3's booking was cancelled");
    assert.equal(r.showed, 1, "L1; L2 was a no-show");
    assert.equal(r.sales, 1, "L1; L3's sale came after its 14 days");
    assert.equal(r.roadmaps, 1, "L2's slo_ order");
    assert.equal(r.cash_cents, 99700 + 14700, "L1 + L2; L3's payment came after its 14 days");
    assert.equal(r.cash_unknown, 0);
    assert.equal(r.reported_cash_cents, 50000);
    assert.equal(r.maturing, true, "L2 and L3 are younger than 14 days at the fixed clock");
    assert.equal(r.maturing_leads, 2);

    const ratios = ratiosFor(r);
    assert.equal(ratios.cpl_cents, 5000);
    assert.equal(ratios.cost_per_booked_cents, 7500);
    assert.equal(ratios.hook_rate, null);
    assert.equal(ratios.hold_25, 0.25);
    assert.equal(ratios.close_rate, 1);
  });

  test("ad 84: refunded sale, unknown amount, demo and failed payments never count; Arizona days", async () => {
    const r = byNumber(await read(readAdNumbers, { from: FROM, to: TO, now: NOW }))["84"];
    assert.equal(r.spend_cents, 2000);
    assert.equal(r.two_sec, 30);
    assert.equal(r.leads, 2, "L6 and L8 (Sep 10 in Arizona); L7 is Aug 31 in Arizona");
    assert.equal(r.booked, 1);
    assert.equal(r.showed, 1);
    assert.equal(r.sales, 0, "a refunded sale is not a sale");
    assert.equal(r.roadmaps, 0, "a demo slo_ order and a non-roadmap order are not roadmaps");
    assert.equal(r.cash_cents, null, "the only real payment reported no amount: unknown, not $0");
    assert.equal(r.cash_unknown, 1);
    assert.equal(r.reported_cash_cents, 20000);
    assert.equal(r.maturing, true, "L8 is 7 days old");
    assert.equal(r.maturing_leads, 1);
  });

  test("ad 86: image ad and a roadmap paid through the funnel only", async () => {
    const r = byNumber(await read(readAdNumbers, { from: FROM, to: TO, now: NOW }))["86"];
    assert.equal(r.spend_cents, 3000);
    assert.equal(r.link_clicks, null);
    assert.equal(r.plays, null);
    assert.equal(ratiosFor(r).hold_25, null);
    assert.equal(r.leads, 1);
    assert.equal(r.booked, 0);
    assert.equal(r.roadmaps, 1);
    assert.equal(r.cash_cents, 14700);
    assert.equal(r.reported_cash_cents, 0);
    assert.equal(r.maturing, false);
  });

  test("ad 91: leads with no ads row read spend unknown, not $0; unmapped spend is not a number row", async () => {
    const rows = await read(readAdNumbers, { from: FROM, to: TO, now: NOW });
    assert.deepEqual(rows.map((r) => r.ad_number), ["84", "86", "90", "91"]);
    const r = byNumber(rows)["91"];
    assert.equal(r.spend_cents, null);
    assert.equal(r.ads, 0);
    assert.equal(r.leads, 1);
    assert.equal(r.cash_cents, 0);
    assert.equal(ratiosFor(r).cpl_cents, null);
  });

  test("adNumbers narrows the read to those numbers", async () => {
    const rows = await read(readAdNumbers, { from: FROM, to: TO, now: NOW, adNumbers: ["84"] });
    assert.deepEqual(rows.map((r) => r.ad_number), ["84"]);
    assert.equal(rows[0].leads, 2);
  });

  test("two ads rows sharing number 90 add their spend; leads are counted once", async () => {
    // U14 (migration 416) lets one number span several Meta ads. Until it lands,
    // ads_fundhub_number_uq allows one. The case is built inside one
    // transaction that drops that unique index (if it is still there), adds a
    // second ad 90, reads, and ROLLS BACK — the index and the rows come back.
    const ROLLBACK = new Error("rollback on purpose");
    let rows;
    await assert.rejects(asStaff(async (tx) => {
      await tx.query(`DROP INDEX IF EXISTS ads_fundhub_number_uq`);
      const a2 = (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                          fundhub_ad_number, external_id)
         VALUES ($1,$2,$3,$4,$5,'oVid: SLO2 copy','draft','90','mm-metrics-meta-a2') RETURNING id`,
        [org, partner, conn, campaign, adSet]
      )).rows[0].id;
      await tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions, link_clicks)
         VALUES ($1,$2,$3,'2026-09-04',1000,100,4)`,
        [org, partner, a2]
      );
      rows = byNumber(await readAdNumbers(tx, { orgId: org, from: FROM, to: TO, now: NOW }));
      throw ROLLBACK;
    }), (err) => err === ROLLBACK);

    assert.equal(rows["90"].ads, 2);
    assert.equal(rows["90"].spend_cents, 16000);
    assert.equal(rows["90"].link_clicks, 44);
    assert.equal(rows["90"].leads, 3, "two ads rows must not double the leads");
    assert.equal(rows["90"].booked, 2);
    assert.equal(rows["90"].cash_cents, 114400);

    const after = (await asStaff((tx) => tx.query(
      `SELECT count(*)::int AS n FROM ads WHERE org_id = $1 AND fundhub_ad_number = '90'`, [org]))).rows[0].n;
    assert.equal(after, 1, "the rollback took the second ad back out");
  });

  // ── the whole company ─────────────────────────────────────────────────────

  test("totals: every lead and every ad-day, with what could not be tied to a number", async () => {
    const t = await read(readTotals, { from: FROM, to: TO, now: NOW });
    assert.equal(t.spend_cents, 15000 + 2000 + 3000 + 7000);
    assert.equal(t.impressions, 1500 + 300 + 600 + 700);
    assert.equal(t.link_clicks, 40 + 6 + 14);
    assert.equal(t.leads, 8, "L1 L2 L3 L6 L8 L9 L10 L11");
    assert.equal(t.booked, 3);
    assert.equal(t.showed, 2);
    assert.equal(t.sales, 1);
    assert.equal(t.roadmaps, 2);
    assert.equal(t.cash_cents, 99700 + 14700 + 14700);
    assert.equal(t.cash_unknown, 1);
    assert.equal(t.reported_cash_cents, 70000);
    assert.equal(t.maturing_leads, 4, "L2, L3, L8, L11");
    assert.deepEqual(t.unmapped, { spend_cents: 7000, ad_days: 1, ads: 1, leads: 1 });
  });

  test("daily: every Arizona day in the window, spend null on a day with no ad-days", async () => {
    const rows = await read(readDaily, { days: 10, now: new Date("2026-09-10T20:00:00Z") });
    assert.equal(rows.length, 10);
    assert.equal(rows[0].day, "2026-09-01");
    assert.equal(rows[9].day, "2026-09-10");
    const d = Object.fromEntries(rows.map((r) => [r.day, r]));
    assert.equal(d["2026-09-01"].spend_cents, 2000);
    assert.equal(d["2026-09-01"].leads, 2, "L6 and L9; L7 belongs to Aug 31");
    assert.equal(d["2026-09-02"].spend_cents, 17000);
    assert.equal(d["2026-09-02"].leads, 1);
    assert.equal(d["2026-09-02"].sales, 1);
    assert.equal(d["2026-09-03"].leads, 1, "L10; the demo client is not a lead");
    assert.equal(d["2026-09-04"].spend_cents, null, "no ad-days saved: not synced is not $0");
    assert.equal(d["2026-09-04"].roadmaps, 1);
    assert.equal(d["2026-09-07"].leads, 0);
    assert.equal(d["2026-09-10"].leads, 1, "L8 at 11:30 pm Arizona");
  });

  // ── page events ───────────────────────────────────────────────────────────

  test("page events per page and ad number: people only, demo and outside days out", async () => {
    const rows = await read(readFunnelEvents, { from: FROM, to: TO });
    const key = (r) => `${r.name} ${r.page} ${r.ad_number ?? "-"}`;
    const got = Object.fromEntries(rows.map((r) => [key(r), r]));
    assert.deepEqual(Object.keys(got).sort(), [
      "funnel.click /roadmap 90",
      "funnel.page /home -",
      "funnel.page /roadmap 86",
      "funnel.page /roadmap 90",
      "funnel.page /roadmap-book 90",
      "funnel.page /watch 84"
    ]);
    assert.equal(got["funnel.page /roadmap 90"].events, 2);
    assert.equal(got["funnel.page /roadmap 90"].sessions, 2);
    assert.equal(got["funnel.page /roadmap 90"].funnel, "roadmap");
    assert.equal(got["funnel.page /roadmap 90"].step, 1);
    assert.equal(got["funnel.page /roadmap-book 90"].step, 2);
    assert.equal(got["funnel.click /roadmap 90"].event, "click");
    assert.equal(got["funnel.page /watch 84"].funnel, "watch", "ad 84 found by Meta ad name + ad set id");
    assert.equal(got["funnel.page /roadmap 86"].funnel, "roadmap", "an old row with no funnel field still maps");
  });

  // ── the lifted roadmap rule ───────────────────────────────────────────────

  test("roadmapPaidPredicates answers readSloPaid's question on a fixture pool", async () => {
    const ask = (clientId) => asStaff((tx) => roadmapPaidPredicates(tx, { orgId: org, clientId }));
    assert.deepEqual(await ask(lead.l2), { by_order: true, by_funnel: true, paid: true });
    assert.deepEqual(await ask(lead.l9), { by_order: false, by_funnel: true, paid: true });
    assert.deepEqual(await ask(lead.l6), { by_order: false, by_funnel: false, paid: false },
      "a demo slo_ order and a non-roadmap order are not a roadmap");
    assert.deepEqual(await ask(lead.l1), { by_order: false, by_funnel: false, paid: false });
  });
});
