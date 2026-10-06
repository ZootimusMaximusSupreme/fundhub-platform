// Endpoint tests for GET /api/marketing/today, against real Postgres.
//
// Lives under src/http/, not next to the handler under api/, because npm test's
// glob is "src/**" and "scripts/**" only (CLAUDE.md §12).
//
// Skips cleanly with DATABASE_URL unset. A skipped .pg.test.mjs is NOT green
// (CLAUDE.md §12), and this file has never been executed against a real
// database: there is no Postgres on the Mac it was written on. Its database-free
// sibling, src/http/marketing-today.test.mjs, drives the same handler with fakes
// and runs everywhere; this file is the proof that the SQL, the column names and
// row-level security hold up for real. Never point it at the live database.
//
// TWO COMPANIES, ON PURPOSE.
//   - A fixture company of its own (org slug "mtoday-pg-test") holds every row
//     whose number is asserted exactly. The spend read sums the whole company,
//     and other pg test files write ad-days into the default company while this
//     one runs, so exact sums are only safe in a company nothing else touches.
//     It gets its own "fundhub-house" partner (slugs are unique per company).
//   - The default company is only READ, to prove db/seed/296 landed: its house
//     partner has the copy writer row and the marketing switch on.
//
// WHO EACH QUERY RUNS AS. ad_metrics_daily, ads, campaigns, ad_platform_*,
// creative_assets, generation_jobs and partner_module_settings all FORCE
// row-level security, so fixture writes go through asStaff(). orgs, staff,
// sessions, partners and creative_providers carry no policy.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import { phoenixDay } from "../slo/visitor.mjs";
import todayHandler, { addDays, HOUSE_SLUG, readSpendEnd } from "../../api/marketing/today.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.resolve(HERE, "../../db/seed/296_marketing_copy_writer_house.sql");

const ORG_SLUG = "mtoday-pg-test";
const DIRECT_SLUG = "mtoday-direct";
// A partner in the DEFAULT company with its switch OFF. Seed 296 must leave it off.
const OTHER_SLUG = "mtoday-other";
const EMAIL_TAG = "mtoday_pg_test";
// A fake key, passed to the handler only. Nothing in this file calls a model.
const ENV = { ANTHROPIC_API_KEY: "sk-ant-fake-pg-test" };

// One clock for the whole file, so "today" cannot change between the fixture
// and the read if the run straddles Arizona midnight.
const NOW = new Date();
const TODAY = phoenixDay(NOW);
// Today's midnight pull (07:01 UTC is 12:01 AM Arizona). It covered yesterday,
// the same day the newest fixture row is on.
const META_SYNCED = new Date(`${TODAY}T07:01:50Z`);
const CF_SYNCED = new Date("2026-10-04T22:10:00Z");
// One finished Write offer run: picked up, then done 269 seconds later.
const OFFER_CLAIMED = new Date("2026-10-05T18:00:00Z");
const OFFER_FINISHED = new Date("2026-10-05T18:04:29Z");

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token) {
  const r = res();
  await todayHandler({
    method: "GET",
    headers: token ? { authorization: "Bearer " + token } : {},
    query: {}
  }, r, { db, env: ENV, now: () => NOW });
  return r;
}

describe("GET /api/marketing/today", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let defaultOrg, orgB, houseB, directB, houseDefault, otherDefault;
  let tokenOwnerB, tokenAdminB, tokenCloserB, tokenOwnerDefault;

  async function cleanup() {
    const org = (await db.query(`SELECT id FROM orgs WHERE slug = $1`, [ORG_SLUG])).rows[0];
    if (org) {
      // U32's M5 rows: org-level tables first, then the scripts (they hang off
      // a partner, ON DELETE RESTRICT), all before the partners go.
      for (const t of ["events", "call_outcomes", "sales", "transactions", "bookings",
                       "client_ad_attribution", "clients", "products",
                       "marketing_jobs", "marketing_funnels"]) {
        await db.query(`DELETE FROM ${t} WHERE org_id = $1`, [org.id]);
      }
      await asStaff((tx) => tx.query(`DELETE FROM ad_scripts WHERE org_id = $1`, [org.id]));
      await db.query(`DELETE FROM marketing_batches WHERE org_id = $1`, [org.id]);
      const ids = (await db.query(`SELECT id FROM partners WHERE org_id = $1`, [org.id])).rows.map((r) => r.id);
      if (ids.length) {
        // creative_assets refuses a direct DELETE (fundhub_no_delete, 045:236-240).
        // Same escape hatch src/http/ad-spine.pg.test.mjs uses, around our rows only.
        await db.query(`ALTER TABLE creative_assets DISABLE TRIGGER trg_creative_assets_no_delete`);
        try {
          await asStaff(async (tx) => {
            for (const t of ["generation_job_assets", "creative_assets", "generation_jobs",
                             "partner_ai_usage", "partner_module_settings",
                             "ad_metrics_daily", "ads", "ad_sets", "campaigns",
                             "ad_platform_connections"]) {
              await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
            }
          });
        } finally {
          await db.query(`ALTER TABLE creative_assets ENABLE TRIGGER trg_creative_assets_no_delete`);
        }
        await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
      }
      await db.query(`DELETE FROM creative_providers WHERE org_id = $1`, [org.id]);
      await asStaff(async (tx) => {
        await tx.query(`DELETE FROM ad_platform_category_map WHERE org_id = $1`, [org.id]);
        await tx.query(`DELETE FROM analytics_connections WHERE org_id = $1`, [org.id]);
        await tx.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [org.id]);
      });
    }
    const other = (await db.query(`SELECT id FROM partners WHERE slug = $1`, [OTHER_SLUG])).rows.map((r) => r.id);
    if (other.length) {
      await asStaff((tx) => tx.query(`DELETE FROM partner_module_settings WHERE partner_id = ANY($1)`, [other]));
      await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [other]);
    }
    await db.query(
      `DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    // The org row itself goes last. If some other table grew a row under it, the
    // delete is skipped rather than failing the run; the next run reuses the org.
    try { await db.query(`DELETE FROM orgs WHERE slug = $1`, [ORG_SLUG]); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Marketing Today ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  before(async () => {
    defaultOrg = await resolveDefaultOrg(db);
    await cleanup();

    orgB = (await db.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing today fixture')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [ORG_SLUG]
    )).rows[0].id;

    tokenOwnerB = await staffIn(orgB, "owner", "b.owner");
    tokenAdminB = await staffIn(orgB, "admin", "b.admin");
    tokenCloserB = await staffIn(orgB, "closer", "b.closer");
    tokenOwnerDefault = await staffIn(defaultOrg, "owner", "default.owner");

    houseDefault = (await db.query(
      `SELECT id FROM partners WHERE org_id = $1 AND slug = $2`, [defaultOrg, HOUSE_SLUG]
    )).rows[0]?.id;
    otherDefault = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Other partner fixture',$2) RETURNING id`,
      [defaultOrg, OTHER_SLUG]
    )).rows[0].id;
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
       VALUES ($1,$2,false)`, [defaultOrg, otherDefault]));

    houseB = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'House fixture',$2) RETURNING id`,
      [orgB, HOUSE_SLUG]
    )).rows[0].id;
    directB = (await db.query(
      `INSERT INTO partners (org_id, name, slug) VALUES ($1,'Direct fixture',$2) RETURNING id`,
      [orgB, DIRECT_SLUG]
    )).rows[0].id;

    // The copy writer row for the fixture company (the seed only covers the
    // default one), with nothing secret in config (048 refuses that).
    await db.query(
      `INSERT INTO creative_providers (org_id, asset_kind, provider_key, config, active)
       VALUES ($1,'copy','copy','{}'::jsonb,true)`, [orgB]);

    await asStaff(async (tx) => {
      // The fixture company's house switch ON.
      await tx.query(
        `INSERT INTO partner_module_settings (org_id, partner_id, marketing_suite_enabled)
         VALUES ($1,$2,true)`, [orgB, houseB]);

      // Meta campaigns need a category row for their company (046:348-354);
      // 052 only seeded the default company.
      await tx.query(
        `INSERT INTO ad_platform_category_map (org_id, platform, offer_type, special_ad_category)
         VALUES ($1,'meta','funding','CREDIT')`, [orgB]);

      // Spend lives under a partner that is NOT the house one, the way Chris's
      // real Meta account is synced under fundhub-direct.
      const conn = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token, last_synced_at)
         VALUES ($1,$2,'meta','acct-mtoday','active','approved','v1:x:y:z',$3) RETURNING id`,
        [orgB, directB, META_SYNCED]
      )).rows[0].id;
      const campaign = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type, budget_cents, approval_state)
         VALUES ($1,$2,$3,'MToday campaign','funding',10000,'draft') RETURNING id`,
        [orgB, directB, conn]
      )).rows[0].id;
      const adSet = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'MToday ad set',10000,'draft') RETURNING id`,
        [orgB, directB, conn, campaign]
      )).rows[0].id;
      const ad = async (name) => (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state)
         VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING id`,
        [orgB, directB, conn, campaign, adSet, name]
      )).rows[0].id;
      const adA = await ad("MToday ad A");
      const adB = await ad("MToday ad B");
      // U32: ad A carries number 701 (its script names a funnel); ad B has none.
      await tx.query(`UPDATE ads SET fundhub_ad_number = '701' WHERE id = $1`, [adA]);
      await tx.query(`UPDATE campaigns SET external_id = 'mtoday-c1' WHERE id = $1`, [campaign]);

      const day = async (adId, back, cents) => tx.query(
        `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents, synced_at)
         VALUES ($1,$2,$3,$4::date,$5,$6)`,
        [orgB, directB, adId, addDays(TODAY, -back), cents, META_SYNCED]
      );
      // The newest saved day is yesterday, so the 7 and 30 day windows end
      // there (whole days only). `back` counts from today.
      await day(adA, 1, 1000);    // last day of last 7 and last 30
      await day(adB, 1, 500);     // a second ad, same day
      await day(adA, 7, 200);     // first day of last 7
      await day(adA, 8, 300);     // last day of prior 7
      await day(adA, 14, 400);    // first day of prior 7
      await day(adA, 30, 50);     // first day of last 30
      await day(adA, 31, 70);     // last day of prior 30
      await day(adA, 60, 80);     // first day of prior 30
      await day(adA, 61, 9999);   // outside every window

      // ClickFunnels: the account's last pull.
      await tx.query(
        `INSERT INTO analytics_connections (org_id, platform, connection_state, last_synced_at)
         VALUES ($1,'clickfunnels','active',$2)`, [orgB, CF_SYNCED]);

      // One finished Write offer run with its saved token counts (the shape
      // src/marketing/offer-generator.mjs writes), and one failed run that must
      // not be read as the measured one.
      await tx.query(
        `INSERT INTO marketing_jobs (org_id, kind, status, payload, result, claimed_at, finished_at)
         VALUES ($1,'offer','done','{}'::jsonb,$2::jsonb,$3,$4)`,
        [orgB, JSON.stringify({ offer: { name: "Fixture" }, usage: {
          input_tokens: 24551, output_tokens: 28640,
          calls: [{ step: "candidates", model: "claude-opus-5-5", input_tokens: 24551, output_tokens: 28640 }]
        } }), OFFER_CLAIMED, OFFER_FINISHED]);
      await tx.query(
        `INSERT INTO marketing_jobs (org_id, kind, status, payload, error, claimed_at, finished_at)
         VALUES ($1,'offer','failed','{}'::jsonb,'fixture failure',now(),now())`, [orgB]);

      // The copy writer's model calls (purpose 'creative'), plus one call from
      // a different writer (purpose 'copy') that the cost line must not count.
      // 100,000 output tokens on Opus 5.5 is 200 cents.
      for (const minutesAgo of [1, 2]) {
        await tx.query(
          `INSERT INTO partner_ai_usage (org_id, partner_id, purpose, input_tokens, output_tokens, model, created_at)
           VALUES ($1,$2,'creative',0,100000,'claude-opus-5-5', now() - make_interval(mins => $3))`,
          [orgB, houseB, minutesAgo]);
      }
      await tx.query(
        `INSERT INTO partner_ai_usage (org_id, partner_id, purpose, input_tokens, output_tokens, model)
         VALUES ($1,$2,'copy',5,5,'gpt-4o-mini')`, [orgB, houseB]);

      // One copy job and the piece it wrote, for the house partner.
      const job = (await tx.query(
        `INSERT INTO generation_jobs (org_id, partner_id, spec, provider, status, idempotency_key, finished_at)
         VALUES ($1,$2,'{"assetKind":"copy","prompt":"fixture angle","offerType":"funding"}'::jsonb,
                 'copy','succeeded','mtoday-pg-1',now()) RETURNING id`,
        [orgB, houseB]
      )).rows[0].id;
      // A non-copy job that must NOT show up in the copy list.
      await tx.query(
        `INSERT INTO generation_jobs (org_id, partner_id, spec, status, idempotency_key, error)
         VALUES ($1,$2,'{"assetKind":"static"}'::jsonb,'failed','mtoday-pg-2','no provider')`,
        [orgB, houseB]
      );
      const asset = (await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, provider, copy_text, ai_generated, compliance_state)
         VALUES ($1,$2,'copy','1x1','copy','Fixture words.',true,'passed') RETURNING id`,
        [orgB, houseB]
      )).rows[0].id;
      await tx.query(
        `INSERT INTO generation_job_assets (org_id, partner_id, job_id, asset_id) VALUES ($1,$2,$3,$4)`,
        [orgB, houseB, job, asset]
      );
    });
  });

  // ── U32: the M5 fixture (no ad-days added, so every spend number above holds) ──
  //
  //   funnels   book_call (/watch) and roadmap_147 (/roadmap), no campaign mapped
  //   ad 701    ad A; its locked script says roadmap_147. Ad B has no number, its
  //             campaign is on no funnel: its $5.00 is Unmapped.
  //   leads     LA  701, two days ago: booked, showed (deposit, $300 typed),
  //                 active sale, $500.00 paid
  //             LB  no ad number, today
  //             LC  701, twenty days ago (in 30 days, not in 7)
  //             LD  a demo client: not a lead
  //   events    /roadmap 2 people + a bot, /watch 1 person, /roadmap-book 1
  //   scripts   4 released drafts waiting (2 flagged by the machine); 5 others
  //             that must not count
  //   jobs      2 failed (shown, newest first), a failed offer, a queued and a
  //             done job (not shown)
  const noonAz = (day) => `${day}T19:00:00Z`;
  const ids = {};

  before(async () => {
    const staffId = (await db.query(`SELECT id FROM staff WHERE email = $1`, [`${EMAIL_TAG}.b.owner@example.com`])).rows[0].id;
    const productId = (await db.query(
      `INSERT INTO products (org_id, code, name, category) VALUES ($1,'mtoday-product','Today fixture product','funding') RETURNING id`,
      [orgB]
    )).rows[0].id;

    const funnel = (key, name, path) => db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane) VALUES ($1,$2,$3,$4,'sorting'::ad_lane)`,
      [orgB, key, name, `https://apply.fundhub.ai${path}`]);
    await funnel("book_call", "Book a call", "/watch");
    await funnel("roadmap_147", "Roadmap", "/roadmap");

    const lead = async (tag, day, utmContent, demo = false) => {
      const id = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name, is_demo)
         VALUES ($1,$2,'Today',$3,$4) RETURNING id`,
        [orgB, `${EMAIL_TAG}.${tag}.${process.pid}@example.com`, tag.toUpperCase(), demo]
      )).rows[0].id;
      await db.query(
        `INSERT INTO client_ad_attribution (client_id, org_id, utm_source, utm_campaign, utm_content, captured_at)
         VALUES ($1,$2,'fb','slo',$3,$4)`, [id, orgB, utmContent, noonAz(day)]);
      return id;
    };
    const la = await lead("la", addDays(TODAY, -2), "701");
    const after1h = `${addDays(TODAY, -2)}T20:00:00Z`;
    await db.query(`INSERT INTO bookings (org_id, client_id, source, status, created_at) VALUES ($1,$2,'sim','booked',$3)`, [orgB, la, after1h]);
    await db.query(
      `INSERT INTO call_outcomes (org_id, client_id, staff_id, outcome, cash_collected_cents, logged_at)
       VALUES ($1,$2,$3,'deposit',30000,$4)`, [orgB, la, staffId, after1h]);
    await db.query(
      `INSERT INTO sales (org_id, client_id, product_id, agreed_price, status, sold_at, external_ref)
       VALUES ($1,$2,$3,'997.00','active',$4,$5)`, [orgB, la, productId, after1h, `mtoday-${process.pid}-la`]);
    await db.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, raw_payload, created_at)
       VALUES ($1,$2,'fixture','500.00','succeeded','{}'::jsonb,$3)`, [orgB, la, after1h]);
    await lead("lb", TODAY, "oVid: Nobody");
    await lead("lc", addDays(TODAY, -20), "701");
    await lead("ld", addDays(TODAY, -1), "701", true);

    const event = (page, session, day, actor = "person") => db.query(
      `INSERT INTO events (org_id, name, payload, created_at) VALUES ($1,'funnel.page',$2::jsonb,$3)`,
      [orgB, JSON.stringify({ page, session_id: session, actor, actor_reason: "fixture" }), noonAz(day)]);
    await event("/roadmap", "s1", addDays(TODAY, -1));
    await event("/roadmap", "s2", addDays(TODAY, -1));
    await event("/roadmap", "bot", addDays(TODAY, -1), "agent");
    await event("/watch", "s3", addDays(TODAY, -3));
    await event("/roadmap-book", "s1", addDays(TODAY, -1));

    const hourAgo = new Date(NOW.getTime() - 3600_000).toISOString();
    const tomorrow = new Date(NOW.getTime() + 86_400_000).toISOString();
    const batch = async (status, releaseAt, releasedAt) => (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, status, release_at, released_at)
       VALUES ($1,'on_command',$2,$3,$4) RETURNING id`, [orgB, status, releaseAt, releasedAt]
    )).rows[0].id;
    const released = await batch("released", hourAgo, hourAgo);
    const notReleased = await batch("ready", hourAgo, null);
    const releasedLater = await batch("released", tomorrow, hourAgo);

    await asStaff(async (tx) => {
      const script = (fields) => {
        const row = { org_id: orgB, partner_id: houseB, body: "HOOK: two files.", ...fields };
        const cols = Object.keys(row);
        return tx.query(
          `INSERT INTO ad_scripts (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
          cols.map((k) => (k === "check_results" ? JSON.stringify(row[k]) : row[k])));
      };
      // Counted (4): a flagged machine draft in a released batch, a clean one,
      // a person's draft (never machine-flagged), a machine draft a check failed.
      await script({ source: "machine", status: "draft", batch_id: released, check_results: { flagged: true } });
      await script({ source: "machine", status: "draft", check_results: { strict: { passed: true } } });
      await script({ source: "chris", status: "draft", check_results: { strict: { passed: false } } });
      await script({ source: "machine", status: "draft", check_results: { judge: { passed: false } } });
      // Not counted (5): batch not released, an import, locked, archived, released later.
      await script({ source: "machine", status: "draft", batch_id: notReleased, check_results: { flagged: true } });
      await script({ source: "import", status: "draft" });
      await script({ source: "machine", status: "locked", ad_id: "701", funnel_key: "roadmap_147" });
      await script({ source: "machine", status: "draft", archived_at: hourAgo });
      await script({ source: "machine", status: "draft", batch_id: releasedLater });
    });

    const job = async (kind, status, error, finishedAt, result = null) => (await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, status, error, finished_at, result)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [orgB, kind, status, error, finishedAt, result === null ? null : JSON.stringify(result)]
    )).rows[0].id;
    ids.older = await job("write_slot", "failed", "The writer stopped: the model took longer than 5 minutes.",
      new Date(NOW.getTime() - 7200_000).toISOString());
    ids.newer = await job("meta_load", "failed", "Meta said the video is still processing.", hourAgo);
    ids.offer = await job("offer", "failed", "The offer writer ran out of time.", hourAgo);
    await job("write_slot", "queued", null, null);
    await job("write_slot", "done", null, hourAgo, { ok: true });
  });

  after(async () => { await cleanup(); await close(); });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session → 401", async () => {
    const r = await call(null);
    assert.equal(r.code, 401);
  });

  test("a closer → 403 (MARKETING is owner and admin)", async () => {
    const r = await call(tokenCloserB);
    assert.equal(r.code, 403);
  });

  test("admin → 200", async () => {
    const r = await call(tokenAdminB);
    assert.equal(r.code, 200, JSON.stringify(r.body));
  });

  // ── the fixture company: exact numbers ────────────────────────────────────

  test("spend: exact integer cents per whole-day Arizona window; today with no rows is null, not 0", async () => {
    const r = await call(tokenOwnerB);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const w = r.body.spend.windows;
    assert.equal(r.body.today, TODAY);
    assert.equal(r.body.spend.through, addDays(TODAY, -1), "windows end on yesterday: the newest saved day and the last day the pull covered");
    assert.deepEqual([w.last_7_days.from, w.last_7_days.to], [addDays(TODAY, -7), addDays(TODAY, -1)]);
    assert.equal(w.last_7_days.spend_cents, 1700);
    assert.equal(w.last_7_days.ad_days, 3);
    assert.equal(w.last_7_days.days_with_data, 2);
    assert.equal(w.prior_7_days.spend_cents, 700);
    assert.equal(w.last_30_days.spend_cents, 2450);
    assert.equal(w.prior_30_days.spend_cents, 150);
    assert.equal(w.today.spend_cents, null);
    assert.equal(w.today.ad_days, 0);
    assert.ok(!r.body.waiting.some((x) => x.part === "spend"));
  });

  test("readSpendEnd: the newest saved day and the newest Meta pull, in one read", async () => {
    const end = await asStaff((tx) => readSpendEnd(tx, { orgId: orgB }));
    assert.equal(end.latest, addDays(TODAY, -1));
    assert.equal(new Date(end.metaSyncedAt).toISOString(), META_SYNCED.toISOString());
  });

  test("last sync: the Meta connection's time and the newest saved day", async () => {
    const r = await call(tokenOwnerB);
    assert.equal(new Date(r.body.last_sync.meta_synced_at).toISOString(), META_SYNCED.toISOString());
    assert.equal(r.body.last_sync.latest_metrics_date, addDays(TODAY, -1));
    assert.equal(new Date(r.body.last_sync.clickfunnels_synced_at).toISOString(), CF_SYNCED.toISOString());
  });

  test("costs: the finished offer run's seconds and dollars; the failed run is not the measured one", async () => {
    const r = await call(tokenOwnerB);
    const o = r.body.costs.offer;
    assert.equal(o.measured, true, JSON.stringify(r.body.costs));
    assert.equal(o.seconds, 269);
    assert.equal(o.input_tokens, 24551);
    assert.equal(o.output_tokens, 28640);
    assert.equal(o.cost_cents, 67);
    assert.ok(!r.body.waiting.some((x) => x.part === "costs"), JSON.stringify(r.body.waiting));
  });

  test("costs: the copy writer's calls only (purpose creative), averaged", async () => {
    const r = await call(tokenOwnerB);
    const c = r.body.costs.copy;
    assert.equal(c.runs, 2, "the 'copy' purpose row is another writer and is not counted");
    assert.equal(c.avg_output_tokens, 100000);
    assert.equal(c.avg_cost_cents, 200);
    assert.deepEqual(c.models, ["claude-opus-5-5"]);
  });

  test("copy: the house partner's copy piece and copy job only, newest first", async () => {
    const r = await call(tokenOwnerB);
    assert.equal(r.body.copy.partner_id, houseB);
    assert.equal(r.body.copy.pieces.length, 1);
    assert.equal(r.body.copy.pieces[0].copy_text, "Fixture words.");
    assert.equal(r.body.copy.pieces[0].compliance_state, "passed");
    assert.ok(r.body.copy.pieces[0].job_id, "the piece is linked to the job that wrote it");
    assert.equal(r.body.copy.jobs.length, 1, "the static job is not a copy job");
    assert.equal(r.body.copy.jobs[0].status, "succeeded");
    assert.equal(r.body.copy.jobs[0].prompt, "fixture angle");
  });

  test("copy_ready: switch on + writer row + key + budget → ready, nothing missing", async () => {
    const r = await call(tokenOwnerB);
    assert.equal(r.body.copy_ready.ready, true, JSON.stringify(r.body.copy_ready));
    assert.deepEqual(r.body.copy_ready.missing, []);
  });

  test("copy_ready: the same company with the writer row switched off → not ready, in plain words", async () => {
    await db.query(`UPDATE creative_providers SET active = false WHERE org_id = $1`, [orgB]);
    try {
      const r = await call(tokenOwnerB);
      assert.equal(r.body.copy_ready.ready, false);
      assert.deepEqual(r.body.copy_ready.missing, ["No copy writer is set up for this company."]);
    } finally {
      await db.query(`UPDATE creative_providers SET active = true WHERE org_id = $1`, [orgB]);
    }
  });

  test("flywheel: the repo's stage files are read", async () => {
    const r = await call(tokenOwnerB);
    assert.ok(r.body.flywheel, "flywheel files are in this checkout");
    assert.ok(r.body.flywheel.campaigns.some((c) => c.campaign === "partner"));
  });

  // ── the default company: db/seed/296 landed ───────────────────────────────

  test("seed 296: the default company's house partner can write copy (writer row + switch on)", async () => {
    const r = await call(tokenOwnerDefault);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    const checks = Object.fromEntries(r.body.copy_ready.checks.map((c) => [c.key, c.ok]));
    assert.equal(checks.copy_provider, true, "db/seed/296 should have added the copy writer row");
    assert.equal(checks.marketing_switch, true, "db/seed/296 should have switched the house partner on");
  });

  test("seed 296 is safe to run again, and touches the default house partner only", async () => {
    assert.ok(houseDefault, "377 made the house partner in the default company");
    /* Watched rows only. Other pg files write partner_module_settings for their
       own partners while this one runs, so a whole-table snapshot would be
       flaky. These three are rows nothing else in the suite touches:
         - the default company's house partner (the one the seed turns on)
         - a default-company partner whose switch is OFF (must stay off)
         - this file's own "fundhub-house" in another company (not the default
           one, so the seed must not reach it) */
    const watched = [houseDefault, otherDefault, houseB];
    const snapshot = async () => asStaff(async (tx) => ({
      provider: (await tx.query(
        `SELECT priority, config, active, updated_at FROM creative_providers
          WHERE org_id = $1 AND asset_kind = 'copy' AND provider_key = 'copy'`, [defaultOrg])).rows,
      switches: (await tx.query(
        `SELECT partner_id, marketing_suite_enabled, updated_at FROM partner_module_settings
          WHERE partner_id = ANY($1) ORDER BY partner_id`, [watched])).rows
    }));
    const beforeRun = await snapshot();

    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(fs.readFileSync(SEED_FILE, "utf8"));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const afterRun = await snapshot();
    assert.deepEqual(afterRun, beforeRun, "a second run changes nothing");
    assert.equal(afterRun.provider.length, 1, "exactly one copy writer row for the default company");

    const on = Object.fromEntries(afterRun.switches.map((r) => [r.partner_id, r.marketing_suite_enabled]));
    assert.equal(on[houseDefault], true, "the default house partner is on");
    assert.equal(on[otherDefault], false, "another partner's switch is left off");
    assert.equal(on[houseB], true, "a house partner in another company is not the seed's to change");
    const providersB = (await db.query(
      `SELECT count(*)::int AS n FROM creative_providers WHERE org_id = $1`, [orgB])).rows[0].n;
    assert.equal(providersB, 1, "the seed adds no writer row to any other company");
  });
  // ── U32: the M5 keys ──────────────────────────────────────────────────────

  test("M5: every old key is still there and the six new keys are added; the answer matches the contract", async () => {
    const r = await call(tokenOwnerB);
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.deepEqual(Object.keys(r.body), [
      "ok", "as_of", "today", "timezone", "waiting", "flywheel", "copy", "copy_ready", "spend", "last_sync", "costs",
      "numbers", "daily", "spend_by_funnel", "flow", "scripts_waiting", "stuck_jobs"
    ]);
    assert.doesNotThrow(() => assertMatchesContract("GET marketing/today", r.body));
    assert.ok(!r.body.waiting.some((x) => ["numbers", "spend_by_funnel", "scripts_waiting", "stuck_jobs"].includes(x.part)),
      JSON.stringify(r.body.waiting));
  });

  test("M5 numbers: exact per window; today's spend is unknown (null), not 0", async () => {
    const r = await call(tokenOwnerB);
    // d7 and d30 are spend's whole-day windows (slice 0): they end yesterday, so
    // lead LB (today) counts in today only.
    assert.deepEqual(r.body.numbers, {
      today: { spend_cents: null, leads: 1, booked: 0, showed: 0, sales: 0, roadmaps: 0,
               cash_cents: 0, reported_cash_cents: 0, roas: null },
      d7: { spend_cents: 1700, leads: 1, booked: 1, showed: 1, sales: 1, roadmaps: 0,
            cash_cents: 50000, reported_cash_cents: 30000, roas: 29.4118 },
      d30: { spend_cents: 2450, leads: 2, booked: 1, showed: 1, sales: 1, roadmaps: 0,
             cash_cents: 50000, reported_cash_cents: 30000, roas: 20.4082 }
    });
    // The same spend the old key prints, never a second answer.
    assert.equal(r.body.numbers.d7.spend_cents, r.body.spend.windows.last_7_days.spend_cents);
    assert.equal(r.body.numbers.d30.spend_cents, r.body.spend.windows.last_30_days.spend_cents);
  });

  test("M5 daily: 30 Arizona days, oldest first; spend null on a day with no ad-day", async () => {
    const r = await call(tokenOwnerB);
    const d = r.body.daily;
    assert.equal(d.length, 30);
    assert.equal(d[0].date, addDays(TODAY, -29));
    assert.equal(d[29].date, TODAY);
    const at = Object.fromEntries(d.map((x) => [x.date, x]));
    assert.deepEqual(at[addDays(TODAY, -1)], { date: addDays(TODAY, -1), spend_cents: 1500, leads: 0 });
    assert.deepEqual(at[addDays(TODAY, -2)], { date: addDays(TODAY, -2), spend_cents: null, leads: 1 });
    assert.deepEqual(at[addDays(TODAY, -7)], { date: addDays(TODAY, -7), spend_cents: 200, leads: 0 });
    assert.deepEqual(at[addDays(TODAY, -20)], { date: addDays(TODAY, -20), spend_cents: null, leads: 1 });
    assert.deepEqual(at[TODAY], { date: TODAY, spend_cents: null, leads: 1 });
  });

  test("M5 spend_by_funnel (7 days): the script places ad 701; nothing maps ad B, so it is Unmapped", async () => {
    const r = await call(tokenOwnerB);
    assert.deepEqual(r.body.spend_by_funnel, [
      { funnel_key: "roadmap_147", name: "Roadmap", spend_cents: 1200 },
      { funnel_key: "book_call", name: "Book a call", spend_cents: null },
      { funnel_key: null, name: "Unmapped", spend_cents: 500 }
    ]);
  });

  test("M5 flow (7 days): landing page views from people, link clicks unknown, then lead, call, sale", async () => {
    const r = await call(tokenOwnerB);
    assert.deepEqual(r.body.flow, { page_views: 3, clicks: null, leads: 1, booked: 1, showed: 1, sales: 1 });
  });

  test("M5 scripts_waiting: released drafts, and the machine's flagged ones among them", async () => {
    const r = await call(tokenOwnerB);
    assert.deepEqual(r.body.scripts_waiting, { ready: 4, flagged: 2 });
  });

  test("M5 stuck_jobs: failed jobs with id, kind, reason and since, newest first; offer and unfailed jobs left out", async () => {
    const r = await call(tokenOwnerB);
    assert.deepEqual(r.body.stuck_jobs.map((j) => [j.id, j.kind, j.error]), [
      [ids.newer, "meta_load", "Meta said the video is still processing."],
      [ids.older, "write_slot", "The writer stopped: the model took longer than 5 minutes."]
    ]);
    for (const j of r.body.stuck_jobs) assert.match(j.since, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(!r.body.stuck_jobs.some((j) => j.id === ids.offer));

    const other = await call(tokenOwnerDefault);
    assert.equal(other.code, 200, JSON.stringify(other.body));
    assert.ok(!other.body.stuck_jobs.some((j) => j.id === ids.newer || j.id === ids.older),
      "another company never sees these jobs");
  });
});
