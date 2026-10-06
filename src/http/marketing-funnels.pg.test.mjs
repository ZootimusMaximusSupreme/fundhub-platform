// /api/marketing/funnels and db/seed/297, against real Postgres. Lives under
// src/http/ because npm test globs src/** and scripts/** only (CLAUDE.md §12);
// it imports the api/ handler.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations and db/seed. Without DATABASE_URL every
// test skips, and a skipped .pg.test.mjs is not green.
//
// A COMPANY OF ITS OWN (org slug mfun-pg-test) holds the Meta fixture — a
// connection, four campaigns, their ad sets, ads and ad-days — so the 7-day
// spend can be asserted exactly. The default company is only READ, to prove the
// seed landed, and the seed file is run a second time to prove a re-run changes
// nothing.
//
// campaigns, ad_sets, ads, ad_metrics_daily and ad_platform_* FORCE row
// security, so fixture writes go through asStaff().

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import { phoenixDay } from "../slo/visitor.mjs";
import handler from "../../api/marketing/funnels.mjs";
import { FUNNEL_KEYS } from "../marketing/settings-store.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(HERE, "../../db/seed/297_marketing_funnels.sql");

const ORG_SLUG = "mfun-pg-test";
const DIRECT_SLUG = "mfun-direct";
const EMAIL_TAG = "mfun_pg_test";

// One clock for the whole file, so the window cannot move mid-run.
const NOW = new Date();
const TODAY = phoenixDay(NOW);
const META_SYNCED = new Date("2026-10-05T07:01:50.000Z");

const C_SPEND = "990000000000000001";
const C_QUIET = "990000000000000002";
const C_OLD = "990000000000000003";
const S_SPEND = "990000000000000101";
const S_QUIET = "990000000000000102";
const S_OLD = "990000000000000103";

let seq = 0;
const rid = (tag) => `mfun-pg-${tag}-${process.pid}-${Date.now()}-${++seq}`;

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token, { method = "GET", body } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body }, r,
    { db, now: () => NOW });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

describe("/api/marketing/funnels", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, direct, tokenOwner, tokenCloser, tokenCsm;

  const funnelRows = async (key) =>
    (await db.query(`SELECT * FROM marketing_funnels WHERE org_id = $1 AND key = $2`, [org, key])).rows;

  async function cleanup() {
    const o = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (o) {
      const ids = (await db.query(`SELECT id FROM partners WHERE org_id = $1`, [o.id])).rows.map((r) => r.id);
      if (ids.length) {
        await asStaff(async (tx) => {
          for (const t of ["ad_metrics_daily", "ads", "ad_sets", "campaigns", "ad_platform_connections"]) {
            await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
          }
        });
        await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
      }
      await asStaff((tx) => tx.query(`DELETE FROM ad_platform_category_map WHERE org_id = $1`, [o.id]));
      await db.query(`DELETE FROM marketing_requests WHERE org_id = $1`, [o.id]);
      await db.query(`DELETE FROM marketing_funnels WHERE org_id = $1`, [o.id]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = $1`, [ORG_SLUG]); } catch { /* reused next run */ }
  }

  async function staffIn(role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Marketing funnels ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  before(async () => {
    await cleanup();
    org = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing funnels fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;
    tokenOwner = await staffIn("owner", "owner");
    tokenCloser = await staffIn("closer", "closer");
    tokenCsm = await staffIn("csm", "csm");
    direct = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Direct fixture',$2) RETURNING id`, [org, DIRECT_SLUG]
    )).rows[0].id;

    await asStaff(async (tx) => {
      // Meta campaigns need a category row for their company (046); 052 seeded the default one only.
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [org]);
      const conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token, last_synced_at)
         VALUES ($1,$2,'meta','acct-mfun','active','approved','v1:x:y:z',$3) RETURNING id`,
        [org, direct, META_SYNCED]
      )).rows[0].id;

      const campaign = async (name, externalId, status) => (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state, external_id, status)
         VALUES ($1,$2,$3,$4,'funding',10000,'draft',$5,$6) RETURNING id`,
        [org, direct, conn, name, externalId, status]
      )).rows[0].id;
      const adSet = async (campaignId, name, externalId) => (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state, external_id, status)
         VALUES ($1,$2,$3,$4,$5,10000,'draft',$6,'ACTIVE') RETURNING id`,
        [org, direct, conn, campaignId, name, externalId]
      )).rows[0].id;
      const ad = async (campaignId, adSetId, name) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state)
         VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING id`,
        [org, direct, conn, campaignId, adSetId, name]
      )).rows[0].id;
      const day = (adId, back, cents) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, synced_at)
         VALUES ($1,$2,$3,$4::date,$5,$6)`,
        [org, direct, adId, addDays(TODAY, -back), cents, META_SYNCED]
      );

      const cSpend = await campaign("MFun spend", C_SPEND, "ACTIVE");
      const sSpend = await adSet(cSpend, "MFun spend set", S_SPEND);
      const a1 = await ad(cSpend, sSpend, "MFun ad 1");
      const a2 = await ad(cSpend, sSpend, "MFun ad 2");
      await day(a1, 0, 1000);   // today (Arizona) — in
      await day(a2, 0, 250);    // a second ad, same day — in
      await day(a1, 6, 300);    // the first day of the 7 — in
      await day(a1, 7, 5000);   // one day too old — out

      const cQuiet = await campaign("MFun quiet", C_QUIET, "PAUSED");
      const sQuiet = await adSet(cQuiet, "MFun quiet set", S_QUIET);
      await ad(cQuiet, sQuiet, "MFun ad 3");  // an ad, but no saved ad-days at all

      const cOld = await campaign("MFun old", C_OLD, "PAUSED");
      const sOld = await adSet(cOld, "MFun old set", S_OLD);
      const a4 = await ad(cOld, sOld, "MFun ad 4");
      await day(a4, 10, 700);   // ad-days, all outside the window

      // A draft that never reached Meta: no external id, so it is not offered for mapping.
      const cDraft = await campaign("MFun draft", null, null);
      await adSet(cDraft, "MFun draft set", null);
    });
  });

  after(async () => { await cleanup(); await close(); });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403; owner 200", async () => {
    assert.equal((await call(null)).code, 401);
    for (const t of [tokenCloser, tokenCsm]) {
      const r = await call(t);
      assert.equal(r.code, 403, JSON.stringify(r.body));
      const p = await call(t, { method: "POST", body: { request_id: rid("gate"), funnel: { key: "nope", name: "x", landing_url: "https://a.b", lane: "sorting" } } });
      assert.equal(p.code, 403);
    }
    assert.equal((await funnelRows("nope")).length, 0);
    assert.equal((await call(tokenOwner)).code, 200);
  });

  // ── reading ───────────────────────────────────────────────────────────────

  test("GET: the fixed shape, synced campaigns with 7-day spend, ad sets, and the last sync", async () => {
    const r = await call(tokenOwner);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), ["funnels", "campaigns", "ad_sets", "as_of"]);
    assert.deepEqual(r.body.funnels, []);
    assert.equal(r.body.as_of, META_SYNCED.toISOString());

    assert.deepEqual(r.body.campaigns, [
      { external_id: C_SPEND, name: "MFun spend", status: "ACTIVE", spend_7d_cents: 1550, funnel_key: null },
      // No ad-days in the window → null, never 0. Ties sort by name.
      { external_id: C_OLD, name: "MFun old", status: "PAUSED", spend_7d_cents: null, funnel_key: null },
      { external_id: C_QUIET, name: "MFun quiet", status: "PAUSED", spend_7d_cents: null, funnel_key: null }
    ]);
    assert.deepEqual(r.body.ad_sets, [
      { external_id: S_OLD, name: "MFun old set", status: "ACTIVE", campaign_external_id: C_OLD },
      { external_id: S_QUIET, name: "MFun quiet set", status: "ACTIVE", campaign_external_id: C_QUIET },
      { external_id: S_SPEND, name: "MFun spend set", status: "ACTIVE", campaign_external_id: C_SPEND }
    ]);
  });

  // ── saving ────────────────────────────────────────────────────────────────

  let made;

  test("POST makes a funnel by key and maps a campaign to it", async () => {
    const id = rid("make");
    const r = await call(tokenOwner, { method: "POST", body: { request_id: id, funnel: {
      key: "test_roadmap", name: "Test roadmap", landing_url: "https://apply.fundhub.ai/roadmap",
      offer_key: "slo_roadmap", lane: "slo", format_mix: { standard: 1 }, meta_campaign_ids: [C_SPEND],
      default_ad_set_external_id: S_SPEND
    } } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), ["funnel"]);
    made = r.body.funnel;
    assert.deepEqual(Object.keys(made), [...FUNNEL_KEYS]);
    assert.equal(made.key, "test_roadmap");
    assert.equal(made.lane, "slo");
    assert.equal(made.offer_key, "slo_roadmap");
    assert.equal(made.book_call, false);
    assert.equal(made.cta_type, "LEARN_MORE");
    assert.equal(made.weight, 1);
    assert.equal(made.active, true);
    assert.deepEqual(made.meta_campaign_ids, [C_SPEND]);
    assert.equal(made.default_ad_set_external_id, S_SPEND);

    const g = await call(tokenOwner);
    assert.deepEqual(g.body.funnels, [made]);
    assert.equal(g.body.campaigns.find((c) => c.external_id === C_SPEND).funnel_key, "test_roadmap");
    assert.equal(g.body.campaigns.find((c) => c.external_id === C_QUIET).funnel_key, null);
  });

  test("POST on an existing key changes that funnel (one row), with its updated_at", async () => {
    const r = await call(tokenOwner, { method: "POST", body: { request_id: rid("change"), funnel: {
      key: "test_roadmap", name: "Test roadmap, renamed", weight: 2.5, meta_campaign_ids: [C_SPEND, C_OLD],
      updated_at: made.updated_at
    } } });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.funnel.id, made.id);
    assert.equal(r.body.funnel.name, "Test roadmap, renamed");
    assert.equal(r.body.funnel.weight, 2.5);
    assert.equal(r.body.funnel.lane, "slo", "fields not sent are kept");
    assert.ok(Date.parse(r.body.funnel.updated_at) > Date.parse(made.updated_at));
    assert.equal((await funnelRows("test_roadmap")).length, 1);
    made = r.body.funnel;
  });

  test("an existing key with no updated_at, or an old one, is 409 with what is saved", async () => {
    const noStamp = await call(tokenOwner, { method: "POST", body: { request_id: rid("nostamp"), funnel: { key: "test_roadmap", active: false } } });
    assert.equal(noStamp.code, 409, JSON.stringify(noStamp.body));
    assert.equal(noStamp.body.error, "stale");
    assert.deepEqual(noStamp.body.current, made);

    const old = new Date(Date.parse(made.updated_at) - 1000).toISOString();
    const stale = await call(tokenOwner, { method: "POST", body: { request_id: rid("stale"), funnel: { key: "test_roadmap", active: false, updated_at: old } } });
    assert.equal(stale.code, 409);
    assert.deepEqual(stale.body.current, made);
    assert.equal((await funnelRows("test_roadmap"))[0].active, true, "nothing was written");
  });

  test("a campaign already on another funnel is refused, so its spend is never counted twice", async () => {
    const r = await call(tokenOwner, { method: "POST", body: { request_id: rid("taken"), funnel: {
      key: "test_call", name: "Test call", landing_url: "https://apply.fundhub.ai/watch", lane: "sorting",
      book_call: true, meta_campaign_ids: [C_QUIET, C_OLD]
    } } });
    assert.equal(r.code, 400, JSON.stringify(r.body));
    assert.equal(r.body.field, "funnel.meta_campaign_ids");
    assert.match(r.body.message, new RegExp(`${C_OLD}.*test_roadmap`));
    assert.equal((await funnelRows("test_call")).length, 0);
  });

  test("a bad enum, an unknown field, or a new funnel with no name is 400 and writes nothing", async () => {
    const cases = [
      [{ key: "test_bad", name: "x", landing_url: "https://a.example", lane: "tiktok" }, "funnel.lane"],
      [{ key: "test_bad", name: "x", landing_url: "https://a.example", lane: "sorting", offer_key: "mystery" }, "funnel.offer_key"],
      [{ key: "test_bad", name: "x", landing_url: "https://a.example", lane: "sorting", colour: "red" }, "funnel.colour"],
      [{ key: "test_bad", landing_url: "https://a.example", lane: "sorting" }, "funnel.name"],
      [{ key: "Test Bad" }, "funnel.key"]
    ];
    for (const [funnel, field] of cases) {
      const id = rid("bad");
      const r = await call(tokenOwner, { method: "POST", body: { request_id: id, funnel } });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
      assert.equal((await db.query(`SELECT 1 FROM marketing_requests WHERE request_id = $1`, [id])).rows.length, 0);
    }
    assert.equal((await funnelRows("test_bad")).length, 0);
  });

  test("a repeated request_id answers the same body and writes once", async () => {
    const id = rid("repeat");
    const body = { request_id: id, funnel: { key: "test_roadmap", active: false, updated_at: made.updated_at } };
    const first = await call(tokenOwner, { method: "POST", body });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    const stamp = (await funnelRows("test_roadmap"))[0].updated_at.getTime();
    const again = await call(tokenOwner, { method: "POST", body });
    assert.equal(again.code, 200, JSON.stringify(again.body));
    assert.deepEqual(again.body, first.body);
    assert.equal((await funnelRows("test_roadmap"))[0].updated_at.getTime(), stamp);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_requests WHERE request_id = $1`, [id])).rows[0].n, 1);
  });

  test("410's rules hold in the database: one key per company, https only, lane is the enum", async () => {
    const ins = (key, url, lane) => db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane) VALUES ($1,$2,'x',$3,$4::ad_lane)`,
      [org, key, url, lane]);
    await assert.rejects(ins("test_roadmap", "https://a.example", "uwiq"), /marketing_funnels_org_key_uq/);
    await assert.rejects(ins("test_http", "http://a.example", "uwiq"), /marketing_funnels_text_ck/);
    await assert.rejects(ins("Test_Upper", "https://a.example", "uwiq"), /marketing_funnels_key_ck/);
    await assert.rejects(ins("test_lane", "https://a.example", "tiktok"), /invalid input value for enum ad_lane/);
  });

  // ── the seed ──────────────────────────────────────────────────────────────

  test("seed 297: book_call and roadmap_147 in the default company, no campaigns, and a re-run is a no-op", async () => {
    const def = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    const read = async () => (await db.query(
      `SELECT key, name, landing_url, offer_key, lane::text AS lane, book_call, format_mix,
              meta_campaign_ids, cta_type, active, updated_at
         FROM marketing_funnels WHERE org_id = $1 AND key IN ('book_call', 'roadmap_147') ORDER BY key`, [def]
    )).rows;
    const rows = await read();
    assert.equal(rows.length, 2, "both seeded funnels are there");
    const [bookCall, roadmap] = rows;
    assert.equal(bookCall.key, "book_call");
    assert.equal(bookCall.landing_url, "https://apply.fundhub.ai/watch");
    assert.equal(bookCall.lane, "sorting");
    assert.equal(bookCall.offer_key, "funding_dfy");
    assert.equal(bookCall.book_call, true);
    assert.deepEqual(bookCall.format_mix, { standard: 2, sorting: 1 });
    assert.equal(roadmap.key, "roadmap_147");
    assert.equal(roadmap.landing_url, "https://apply.fundhub.ai/roadmap");
    assert.equal(roadmap.lane, "uwiq");
    assert.equal(roadmap.offer_key, "slo_roadmap");
    assert.equal(roadmap.book_call, false);
    assert.deepEqual(roadmap.format_mix, { standard: 1 });
    for (const r of rows) {
      assert.deepEqual(r.meta_campaign_ids, [], `${r.key}: no campaign is guessed`);
      assert.equal(r.cta_type, "LEARN_MORE");
      assert.equal(r.active, true);
    }

    const settingsBefore = (await db.query(`SELECT count(*)::int AS n FROM marketing_settings WHERE enabled`)).rows[0].n;
    await db.query(fs.readFileSync(SEED_FILE, "utf8"));
    const again = await read();
    assert.deepEqual(again, rows, "a second run changed nothing");
    const n = (await db.query(
      `SELECT count(*)::int AS n FROM marketing_funnels WHERE org_id = $1 AND key IN ('book_call', 'roadmap_147')`, [def]
    )).rows[0].n;
    assert.equal(n, 2);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_settings WHERE enabled`)).rows[0].n,
      settingsBefore, "the seed never turns the machine on");
  });
});
