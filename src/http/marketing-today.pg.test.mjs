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
});
