// GET /api/marketing/angles against real Postgres (plan unit U32, spec §11.2).
//
// Lives under src/http/ because npm test's glob is src/** and scripts/** only
// (CLAUDE.md §12). Skips with DATABASE_URL unset, and a skipped .pg test is NOT
// green: there is no Postgres on the Mac this was written on, so it is proved in
// GitHub CI ("tests" workflow, a fresh pgvector Postgres 16 built from every
// migration). Never point it at production: it writes rows.
//
// ITS OWN COMPANY (org slug "mangles-pg-test"), so the exact sums cannot be moved
// by another file's rows. The clock is fixed at 2026-09-18T00:00Z, which is
// 2026-09-17 in Arizona: the window is 2026-08-19..2026-09-17.
//
//   ad 90  ads row A90 in campaign C1. Its LIVE script (version 2) says angle
//          speed; version 1 (archived) said old_angle and must not count.
//          spend 09-02 $100, 09-03 $50; 08-10 $999.99 is outside the window.
//          L1 booked + active sale + $997.00 paid; L2 nothing; L5 a demo client;
//          L7 captured 08-10 (outside).
//   ad 84  ads row A84, no script by number; its creative's script carries
//          the_guarantee (the v_ad_label_spine path). spend 09-01 $20.
//          L3 booked, one payment with NO amount (cash unknown).
//   AU     an ads row with no number whose creative's script says speed:
//          spend 09-05 $30 lands on speed and counts as one more ad.
//   AX     no number, no creative: spend 09-06 $7 belongs to no angle.
//   ad 91  a script with angle not_in_file_angle (not in angles.json) and no ads
//          row: L4 is a lead with no spend.
//   L6     tags that match no ad: no angle.
//
// WHO EACH QUERY RUNS AS. ads, campaigns, ad_sets, ad_metrics_daily,
// ad_platform_*, creative_assets and ad_scripts FORCE row security, so their
// fixture rows go through asStaff(). The rest use the plain pool.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { asStaff } from "../partners/rls.mjs";
import anglesHandler from "../../api/marketing/angles.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const ORG_SLUG = "mangles-pg-test";
const NONCE = `mangles-${process.pid}-${Date.now()}`;
const mail = (tag) => `${NONCE}.${tag}@example.com`;
const NOW = new Date("2026-09-18T00:00:00Z");
const META_SYNCED = new Date("2026-09-17T07:01:50Z");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token, { method = "GET", now = NOW } = {}) {
  const r = res();
  await anglesHandler({
    method,
    headers: token ? { authorization: "Bearer " + token } : {},
    query: {}
  }, r, { db, now: () => now });
  return r;
}

describe("GET /api/marketing/angles", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, partner, conn, campaign, adSet, productId;
  let tokenOwner, tokenAdmin, tokenCloser, tokenDefaultOwner;

  async function cleanup() {
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, ["%.mangles-default@example.com"]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, ["%.mangles-default@example.com"]);
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (!o) return;
    const id = o.id;
    for (const t of ["events", "call_outcomes", "sales", "transactions", "payment_links", "bookings"]) {
      await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    }
    await db.query(`DELETE FROM client_ad_attribution WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM clients WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM products WHERE org_id = $1`, [id]);
    await asStaff(async (tx) => {
      for (const t of ["ad_metrics_daily", "ads"]) await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
    });
    // creative_assets refuses a direct DELETE (fundhub_no_delete, 045). Same
    // escape hatch src/http/marketing-today.pg.test.mjs uses, around our rows only.
    await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
    try {
      await asStaff((tx) => tx.query(`DELETE FROM creative_assets WHERE org_id = $1`, [id]));
    } finally {
      await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
    }
    // Leaves first: a script nothing else points at (as parent or root) can go.
    await asStaff(async (tx) => {
      for (let i = 0; i < 20; i++) {
        const gone = await tx.query(
          `DELETE FROM ad_scripts s
            WHERE s.org_id = $1
              AND NOT EXISTS (SELECT 1 FROM ad_scripts k
                               WHERE k.id <> s.id
                                 AND (k.parent_script_id = s.id OR k.root_script_id = s.id))`, [id]);
        if (!gone.rowCount) break;
      }
      for (const t of ["ad_sets", "campaigns", "ad_platform_connections", "ad_platform_category_map"]) {
        await tx.query(`DELETE FROM ${t} WHERE org_id = $1`, [id]);
      }
    });
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE org_id = $1)`, [id]);
    await db.query(`DELETE FROM staff WHERE org_id = $1`, [id]);
    await db.query(`DELETE FROM partners WHERE org_id = $1`, [id]);
    try { await db.query(`DELETE FROM orgs WHERE id = $1`, [id]); } catch { /* reused next run */ }
  }

  async function staffIn(orgId, role, email) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [orgId, email, `Angles ${role}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId })).token };
  }

  async function client(tag, { demo = false } = {}) {
    return (await db.query(
      `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
       VALUES ($1,$2,'Angle',$3,$4) RETURNING id`, [org, mail(tag), tag.toUpperCase(), demo]
    )).rows[0].id;
  }

  async function tagged(tag, capturedAt, utmContent, opts) {
    const id = await client(tag, opts);
    await db.query(
      `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, captured_at)
       VALUES ($1,$2,'fb','slo',$3,$4)`, [id, org, utmContent, capturedAt]);
    return id;
  }

  before(async () => {
    await cleanup();
    const defaultOrg = await resolveDefaultOrg(db);

    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1,'Marketing angles fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    partner = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Angles fixture','mangles-direct') RETURNING id`, [org]
    )).rows[0].id;
    tokenOwner = (await staffIn(org, "owner", mail("owner"))).token;
    tokenAdmin = (await staffIn(org, "admin", mail("admin"))).token;
    tokenCloser = (await staffIn(org, "closer", mail("closer"))).token;
    tokenDefaultOwner = (await staffIn(defaultOrg, "owner", `${NONCE}.mangles-default@example.com`)).token;
    productId = (await db.query(
      `INSERT INTO products (org_id, code, name, category) VALUES ($1,'mangles-product','Angles fixture product','funding') RETURNING id`,
      [org]
    )).rows[0].id;

    await asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [org]);
      conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token, last_synced_at)
         VALUES ($1,$2,'meta','acct-mangles','active','approved','v1:x:y:z',$3) RETURNING id`,
        [org, partner, META_SYNCED]
      )).rows[0].id;
      campaign = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id)
         VALUES ($1,$2,$3,'Angles campaign','funding',10000,'draft','mangles-c1') RETURNING id`,
        [org, partner, conn]
      )).rows[0].id;
      adSet = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'Angles ad set',10000,'draft') RETURNING id`,
        [org, partner, conn, campaign]
      )).rows[0].id;

      const script = async (fields) => {
        const row = { org_id: org, partner_id: partner, body: "HOOK: two files.\nCTA: book a call.", ...fields };
        const cols = Object.keys(row);
        return (await tx.query(
          `INSERT INTO ad_scripts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
          cols.map((k) => row[k])
        )).rows[0].id;
      };
      // Ad 90: version 1 said old_angle and is archived; version 2 (live) says speed.
      const v1 = await script({ ad_id: "90", status: "superseded", angle_key: "old_angle", source: "machine" });
      await tx.query(`UPDATE ad_scripts SET archived_at = now() WHERE id = $1`, [v1]);
      await script({ ad_id: "90", status: "locked", angle_key: "speed", parent_script_id: v1, version: 2, source: "machine" });
      // Ad 91: a script with an angle that is not in angles.json, and no ads row.
      await script({ ad_id: "91", status: "locked", angle_key: "not_in_file_angle", source: "machine" });
      // The creatives' scripts (no number): the spine path.
      const guarantee = await script({ angle_key: "the_guarantee", source: "chris" });
      const speedCreative = await script({ angle_key: "speed", source: "chris" });

      const asset = async (scriptId) => (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, provider, copy_text, ai_generated, compliance_state, script_id)
         VALUES ($1,$2,'copy','1x1','copy','Angle fixture words.',true,'passed',$3) RETURNING id`,
        [org, partner, scriptId]
      )).rows[0].id;
      const ad = async (name, number, assetId) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state,
                          fundhub_ad_number, asset_id, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,'draft',$7,$8,$9) RETURNING id`,
        [org, partner, conn, campaign, adSet, name, number, assetId, `${NONCE}-${name}`]
      )).rows[0].id;
      const a90 = await ad("A90", "90", null);
      const a84 = await ad("A84", "84", await asset(guarantee));
      const aU = await ad("AU", null, await asset(speedCreative));
      const aX = await ad("AX", null, null);

      const day = (adId, date, cents) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, impressions, synced_at)
         VALUES ($1,$2,$3,$4::date,$5,100,$6)`, [org, partner, adId, date, cents, META_SYNCED]);
      await day(a90, "2026-09-02", 10000);
      await day(a90, "2026-09-03", 5000);
      await day(a90, "2026-08-10", 99999);   // outside the window
      await day(a84, "2026-09-01", 2000);
      await day(aU, "2026-09-05", 3000);
      await day(aX, "2026-09-06", 700);
    });

    const l1 = await tagged("l1", "2026-09-02T16:00:00Z", "90-slo");
    await db.query(`INSERT INTO bookings (org_id, client_id, source, status, created_at) VALUES ($1,$2,'sim','booked','2026-09-03T15:00:00Z')`, [org, l1]);
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at, external_ref)
       VALUES ($1,$2,$3,'997.00','active','2026-09-05T18:00:00Z',$4)`, [org, l1, productId, `${NONCE}-l1`]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','997.00','succeeded','{}'::jsonb,'2026-09-05T18:05:00Z')`, [org, l1]);
    await tagged("l2", "2026-09-04T18:00:00Z", "90");
    const l3 = await tagged("l3", "2026-09-01T18:00:00Z", "84");
    await db.query(`INSERT INTO bookings (org_id, client_id, source, status, created_at) VALUES ($1,$2,'sim','completed','2026-09-02T15:00:00Z')`, [org, l3]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture',NULL,'succeeded','{}'::jsonb,'2026-09-03T18:05:00Z')`, [org, l3]);
    await tagged("l4", "2026-09-06T15:00:00Z", "91");
    await tagged("l5", "2026-09-03T15:00:00Z", "90", { demo: true });
    await tagged("l6", "2026-09-03T15:00:00Z", "oVid: Nobody");
    await tagged("l7", "2026-08-10T15:00:00Z", "90");
  });

  after(async () => { await cleanup(); await close(); });

  test("no session → 401", async () => {
    assert.equal((await call(null)).code, 401);
  });

  test("a closer → 403, and no numbers in the answer", async () => {
    const r = await call(tokenCloser);
    assert.equal(r.code, 403);
    assert.equal(r.body.rows, undefined);
  });

  test("POST → 405 with Allow: GET", async () => {
    const r = await call(tokenOwner, { method: "POST" });
    assert.equal(r.code, 405);
    assert.equal(r.headers.Allow, "GET");
  });

  test("owner: one row per angle, exact numbers, names from angles.json, matches the contract", async () => {
    const r = await call(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.doesNotThrow(() => assertMatchesContract("GET marketing/angles", r.body));
    assert.deepEqual(r.body.rows, [
      // A90 $150 (script angle) + AU $30 (spine angle); leads L1, L2 from ad 90.
      { angle_key: "speed", name: "Speed", spend_cents: 18000, ads: 2,
        leads: 2, booked: 1, sales: 1, cash_cents: 99700, roas: 5.5389 },
      // A84 through its creative's script; L3's only payment reported no amount.
      { angle_key: "the_guarantee", name: "The Guarantee", spend_cents: 2000, ads: 1,
        leads: 1, booked: 1, sales: 0, cash_cents: null, roas: null },
      // Ad 91 has leads and no ads row: spend unknown, not $0.
      { angle_key: "not_in_file_angle", name: "not_in_file_angle", spend_cents: null, ads: 1,
        leads: 1, booked: 0, sales: 0, cash_cents: 0, roas: null }
    ]);
  });

  test("the archived version's angle never counts; AX's spend has no angle", async () => {
    const r = await call(tokenAdmin);
    assert.equal(r.code, 200);
    assert.ok(!r.body.rows.some((x) => x.angle_key === "old_angle"));
    const total = r.body.rows.reduce((t, x) => t + (x.spend_cents ?? 0), 0);
    assert.equal(total, 20000, "every ad-day in the window but AX's $7.00");
  });

  test("as_of is the last Meta sync", async () => {
    const r = await call(tokenOwner);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());
  });

  test("null stays null: a window with no saved ad-day reads spend unknown, never 0", async () => {
    const r = await call(tokenOwner, { now: new Date("2026-12-31T20:00:00Z") });
    assert.equal(r.code, 200);
    assert.deepEqual(r.body.rows, [], "nothing ran in Dec: no angle row");
    const later = await call(tokenOwner, { now: new Date("2026-09-20T20:00:00Z") });
    const hat = later.body.rows.find((x) => x.angle_key === "not_in_file_angle");
    assert.equal(hat.spend_cents, null);
    assert.equal(hat.roas, null);
  });

  test("another company's owner never sees these rows", async () => {
    const r = await call(tokenDefaultOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.ok(!r.body.rows.some((x) => x.angle_key === "not_in_file_angle"));
  });
});
