// Every Creative Factory read endpoint's SQL, executed for real.
//
// Skipped without DATABASE_URL.
//
// WHY THIS EXISTS. The endpoint files are thin — a query and some wiring — which
// makes it tempting to leave them untested. But "thin" does not mean "correct": a
// mistyped column, a stale name after a migration edit, or a GROUP BY that does
// not cover its select list all parse fine and fail only when a partner opens the
// screen. So each fetchRows runs against a real database with real rows.
//
// The isolation assertions matter as much as the syntax ones. Each endpoint is
// run twice — once as the partner that owns the data and once as a partner that
// owns none of it — and the second must come back empty. That is the RLS policy
// being exercised through the actual query the product ships, not through a
// hand-written probe.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { asStaff as _asStaff, asPartner as _asPartner } from "../partners/rls.mjs";
import { rlsPool, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";

/* SET UP as the owner, ASSERT as the unprivileged role. A superuser
   bypasses every RLS policy, so these isolation assertions are only
   meaningful through APP_DATABASE_URL. See src/testing/rls-pool.mjs. */
const asStaff = (fn, deps) => _asStaff(fn, { pool: rlsPool, ...(deps || {}) });
const asPartner = (partnerId, fn, deps) => _asPartner(partnerId, fn, { pool: rlsPool, ...(deps || {}) });

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG = "ep-test-";

// Every endpoint, its module, and the query that exercises it.
const ENDPOINTS = [
  ["brand-kits",  "../../api/creative/brand-kits.mjs",     {}],
  ["brand-kits?state", "../../api/creative/brand-kits.mjs", { state: "active" }],
  ["library",     "../../api/creative/library.mjs",        {}],
  ["library?state=blocked", "../../api/creative/library.mjs", { state: "blocked" }],
  ["library?kind+format", "../../api/creative/library.mjs", { kind: "static", format: "1x1" }],
  ["jobs",        "../../api/creative/jobs.mjs",           {}],
  ["jobs?state",  "../../api/creative/jobs.mjs",           { state: "succeeded,failed" }],
  ["approvals",   "../../api/creative/approvals.mjs",      {}],
  ["approvals?state=blocked", "../../api/creative/approvals.mjs", { state: "blocked" }],
  ["connections", "../../api/campaigns/connections.mjs",   {}],
  ["campaign list", "../../api/campaigns/list.mjs",        {}],
  ["campaign list?platform", "../../api/campaigns/list.mjs", { platform: "meta", state: "live" }],
  ["action-log",  "../../api/campaigns/action-log.mjs",    {}],
  ["action-log?state=revertible", "../../api/campaigns/action-log.mjs", { state: "revertible" }],
  ["spend",       "../../api/campaigns/spend.mjs",         {}],
  ["fatigue",     "../../api/campaigns/fatigue.mjs",       {}],
  ["fatigue?state=refresh", "../../api/campaigns/fatigue.mjs", { state: "refresh" }]
];

describe("creative read endpoints", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, owner, stranger, campaignId;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
      // The category map is seeded with real values by 052_config_defaults.sql, so no
      // fixture row is needed. It used to insert TEST_CATEGORY here with ON CONFLICT
      // DO NOTHING, which meant whichever ran first won — and on a database where the
      // tests had run, the fixture value shadowed the migration's. A test fixture must
      // not compete with a migration for the same config row.
    ({ partnerId: owner, campaignId } = await seed("owner"));
    // The stranger is a real, active partner that owns NOTHING. Seeding it with
    // its own content would make every isolation assertion below vacuous — the
    // endpoint would return rows and the test would be measuring the fixture
    // rather than the policy.
    stranger = await barePartner("stranger");
  });
  after(async () => { await cleanup(); await close(); });

  for (const [name, mod, query] of ENDPOINTS) {
    test(`${name} — the SQL runs`, async () => {
      const { fetchRows } = await import(mod);
      const rows = await asPartner(owner, (tx) =>
        fetchRows(tx, { limit: 50, offset: 0, query, partnerId: owner,
                        principal: { kind: "partner", partnerId: owner } }));
      assert.ok(Array.isArray(rows), `${name} should return rows`);
    });

    test(`${name} — returns nothing for a partner who owns none of it`, async () => {
      const { fetchRows } = await import(mod);
      const rows = await asPartner(stranger, (tx) =>
        fetchRows(tx, { limit: 50, offset: 0, query, partnerId: stranger,
                        principal: { kind: "partner", partnerId: stranger } }));
      assert.deepStrictEqual(rows, [], `${name} leaked rows across partners`);
    });
  }

  test("campaign detail runs and is scoped", async () => {
    const { fetchRows } = await import("../../api/campaigns/detail.mjs");
    const own = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { id: campaignId }, partnerId: owner }));
    assert.ok(own?.id, "the owner should get the campaign");
    assert.ok(Array.isArray(own.metrics_daily), "detail carries the daily series");
    assert.ok(Array.isArray(own.ad_sets));
    assert.ok(Array.isArray(own.recent_actions));

    // A guessed uuid returns null → the handler renders 404, indistinguishable
    // from "exists but is not yours".
    const stolen = await asPartner(stranger, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { id: campaignId }, partnerId: stranger }));
    assert.strictEqual(stolen, null, "a partner read another partner's campaign detail");
  });

  test("campaign detail requires an id", async () => {
    const { fetchRows } = await import("../../api/campaigns/detail.mjs");
    await assert.rejects(
      () => asPartner(owner, (tx) => fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner })),
      /id is required/);
  });

  test("the library never selects a storage key", async () => {
    // storage_key is a capability. read-api.mjs's redact() would strip it, but not
    // selecting it means it never enters the process at all.
    const { fetchRows } = await import("../../api/creative/library.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    assert.ok(rows.length > 0, "fixture should have assets");
    for (const r of rows) {
      assert.strictEqual(r.storage_key, undefined);
      assert.strictEqual(typeof r.has_storage_key, "boolean");
    }
  });

  test("the library returns copy_text for both a passed and a blocked copy asset", async () => {
    // 301_creative_copy_text.sql: a blocked copy asset keeps its words, and the
    // library must show them. src/http/read-api.mjs's redactor drops any field
    // whose NAME contains storage_key/storage_path/s3_key/object_key/password/
    // token_hash — this proves copy_text is not caught by that net, through the
    // real HTTP-shaped read (fetchRows, same as the handler calls), not by
    // reading the code.
    const PASSED_TEXT = "Business funding for qualified applicants, terms apply.";
    const BLOCKED_TEXT = "Guaranteed approval for everyone, no credit check ever.";
    const inserted = await asStaff((tx) => tx.query(
      `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated,
                                     compliance_state, copy_text, blocked_reasons)
       VALUES
         ($1,$2,'copy','1x1',true,'passed',$3,'[]'::jsonb),
         ($1,$2,'copy','1x1',true,'blocked',$4,'[{"code":"guaranteed-approval","message":"no"}]'::jsonb)
       RETURNING id, compliance_state`,
      [org, owner, PASSED_TEXT, BLOCKED_TEXT])).then((r) => r.rows);
    const passedId = inserted.find((r) => r.compliance_state === "passed").id;
    const blockedId = inserted.find((r) => r.compliance_state === "blocked").id;

    const { fetchRows } = await import("../../api/creative/library.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { kind: "copy" }, partnerId: owner }));

    const passed = rows.find((r) => r.id === passedId);
    const blocked = rows.find((r) => r.id === blockedId);
    assert.ok(passed, "the passed copy asset must appear in the library");
    assert.ok(blocked, "the blocked copy asset must appear in the library");
    assert.strictEqual(passed.copy_text, PASSED_TEXT,
      "the library must show the passed asset's words, not strip them");
    assert.strictEqual(blocked.copy_text, BLOCKED_TEXT,
      "the library must show the blocked asset's words too — a blocked ad nobody can read is one nobody can fix");
  });

  test("connections never carry token ciphertext, before or after redaction", async () => {
    const { fetchRows } = await import("../../api/campaigns/connections.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    assert.ok(rows.length > 0);
    const serialised = JSON.stringify(rows);
    assert.ok(!serialised.includes("SUPERSECRET"), "token ciphertext reached the response");
    for (const r of rows) {
      assert.strictEqual(r.encrypted_access_token, undefined);
      assert.strictEqual(r.has_access_token, true);
    }
  });

  test("the blocked asset reaches the approval queue with its reasons", async () => {
    const { fetchRows } = await import("../../api/creative/approvals.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { state: "blocked" }, partnerId: owner }));
    const blocked = rows.find((r) => r.item_type === "creative_asset");
    assert.ok(blocked, "the blocked asset must appear in the queue");
    assert.ok(Array.isArray(blocked.reasons) && blocked.reasons.length > 0,
      "a blocked asset without its reasons is the same as dropping it");
  });

  test("a brand sent for review reaches the approval queue", async () => {
    // The third arm of the UNION in approvals.mjs. A brand waits on the same
    // person as a campaign awaiting approval, so it answers to the same
    // ?state=awaiting_approval value.
    const { fetchRows } = await import("../../api/creative/approvals.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { state: "awaiting_approval" }, partnerId: owner }));
    const brand = rows.find((r) => r.item_type === "partner_brand");
    assert.ok(brand, "a brand in review must appear in the queue");
    assert.strictEqual(brand.state, "review");
    assert.strictEqual(brand.subtype, "brand");
    assert.strictEqual(brand.detail, "EP Test Entity LLC", "the queue shows the business name");
    // The whole UNION is ordered by this column, so a null here would sort the
    // row to an arbitrary place. COALESCE(submitted_at, updated_at) is what
    // keeps a row that predates 242 from dropping out of the sort.
    assert.ok(brand.updated_at, "the brand row must carry a timestamp to sort on");
  });

  test("a brand in review does not reach another partner's queue", async () => {
    // THE WHERE CLAUSE IS THE ONLY GUARD ON THIS ARM. partner_brand is not one
    // of the nineteen tables 045 puts a row-level security policy on, so the
    // scoped transaction protects it not at all — `b.partner_id = $7` in
    // approvals.mjs is the entire isolation story here. Delete that predicate
    // and every partner sees every partner's brand; this test is what notices.
    const { fetchRows } = await import("../../api/creative/approvals.mjs");
    const rows = await asPartner(stranger, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: { state: "awaiting_approval" }, partnerId: stranger }));
    assert.deepStrictEqual(
      rows.filter((r) => r.item_type === "partner_brand"), [],
      "another partner's brand reached this queue");
  });

  test("jobs surface the failure reason but never the vendor cost", async () => {
    const { fetchRows } = await import("../../api/creative/jobs.mjs");
    const rows = await asPartner(owner, (tx) =>
      fetchRows(tx, { limit: 50, offset: 0, query: {}, partnerId: owner }));
    assert.ok(rows.length > 0);
    for (const r of rows) assert.strictEqual(r.cost_cents, undefined,
      "cost_cents is fundhub's vendor cost — returning it publishes the UNIT 9 markup");
    assert.ok(rows.some((r) => r.error), "a failed job must say why");
  });

  // ------------------------------------------------------------------ fixture

  async function barePartner(name) {
    const { rows } = await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, `${SLUG}${name}`]);
    const partnerId = rows[0].id;
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings (org_id, partner_id) VALUES ($1,$2)`, [org, partnerId]));
    return partnerId;
  }

  async function seed(name) {
    const slug = `${SLUG}${name}`;
    const partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, slug])).rows[0].id;

    return asStaff(async (tx) => {
      await tx.query(
        `INSERT INTO partner_module_settings (org_id, partner_id) VALUES ($1,$2)`, [org, partnerId]);

      const kitId = (await tx.query(
        `INSERT INTO brand_kits (org_id, partner_id, name, status)
         VALUES ($1,$2,'Kit','active') RETURNING id`, [org, partnerId])).rows[0].id;

      await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, brand_kit_id, kind, format,
                                      ai_generated, compliance_state, storage_key)
         VALUES ($1,$2,$3,'static','1x1',true,'passed',$4)`,
        [org, partnerId, kitId, `partners/${partnerId}/creative/1x1/a.png`]);
      await tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, brand_kit_id, kind, format,
                                      ai_generated, compliance_state, blocked_reasons)
         VALUES ($1,$2,$3,'copy','1x1',true,'blocked',
                 '[{"code":"guaranteed-approval","message":"no"}]'::jsonb)`,
        [org, partnerId, kitId]);

      // A brand sitting in review, so the third arm of the approvals UNION has
      // something to return. submitted_at is set because this one was sent;
      // approved_at stays NULL, which 043's CHECK requires for any status other
      // than 'approved'.
      await tx.query(
        `INSERT INTO partner_brand (org_id, partner_id, entity_name, approval_status, submitted_at)
         VALUES ($1,$2,'EP Test Entity LLC','review', now())`,
        [org, partnerId]);

      await tx.query(
        `INSERT INTO generation_jobs (org_id, partner_id, brand_kit_id, spec, status, error, idempotency_key)
         VALUES ($1,$2,$3,'{"assetKind":"static","formats":["1x1"],"variants":2}'::jsonb,
                 'failed','provider unreachable',$4)`,
        [org, partnerId, kitId, `${slug}-job`]);

      const connId = (await tx.query(
        `INSERT INTO ad_platform_connections
           (org_id, partner_id, platform, external_ad_account_id, connection_state,
            platform_verification_state, encrypted_access_token)
         VALUES ($1,$2,'meta',$3,'active','approved','v1:iv:tag:SUPERSECRET') RETURNING id`,
        [org, partnerId, `acct-${slug}`])).rows[0].id;

      const campId = (await tx.query(
        `INSERT INTO campaigns (org_id, partner_id, connection_id, name, offer_type,
                                budget_cents, approval_state, approved_at)
         VALUES ($1,$2,$3,'C','funding',10000,'live',now()) RETURNING id`,
        [org, partnerId, connId])).rows[0].id;

      const setId = (await tx.query(
        `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents, approval_state)
         VALUES ($1,$2,$3,$4,'AS',10000,'live') RETURNING id`,
        [org, partnerId, connId, campId])).rows[0].id;

      const adId = (await tx.query(
        `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name, approval_state, rotated_at)
         VALUES ($1,$2,$3,$4,$5,'AD','live', now() - interval '5 days') RETURNING id`,
        [org, partnerId, connId, campId, setId])).rows[0].id;

      // Metrics with a high frequency and low CTR so the fatigue endpoint has a
      // 'refresh' row to return rather than an empty set that proves nothing.
      for (let i = 1; i <= 3; i++) {
        await tx.query(
          `INSERT INTO ad_metrics_daily (org_id, partner_id, ad_id, date, spend_cents,
                                         impressions, clicks, conversions, frequency, ctr, cpa_cents, roas)
           VALUES ($1,$2,$3,(now() AT TIME ZONE 'America/Phoenix')::date - $4::int, 5000, 10000, 80, 2, 4.5, 0.8, 2500, 1.2)`,
          [org, partnerId, adId, i]);
      }

      await tx.query(
        `INSERT INTO spend_ceilings (org_id, partner_id, scope, daily_limit_cents)
         VALUES ($1,$2,'partner',1000000)`, [org, partnerId]);

      await tx.query(
        `INSERT INTO action_log (org_id, partner_id, actor, agent_id, target_type, target_id,
                                 rule_key, reason, undo_payload, executed_at)
         VALUES ($1,$2,'agent',NULL,'ad_set',$3,'scale_winner','ROAS above target',
                 '{"action":"set_budget","budget_cents":10000}'::jsonb, now())`,
        [org, partnerId, setId]);

      await tx.query(
        `INSERT INTO partner_onboarding_tasks (org_id, partner_id, task_key, title, connection_id)
         VALUES ($1,$2,'verify_business','Complete business verification',$3)`,
        [org, partnerId, connId]);

      return { partnerId, campaignId: campId };
    });
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG}%`])).rows.map((r) => r.id);
    if (!ids.length) return;
    const OFF = [["action_log", "trg_action_log_no_delete"],
                 ["creative_assets", "trg_creative_assets_no_delete"],
                 ["compliance_screenings", "trg_compliance_screenings_no_delete"]];
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);
    await asStaff(async (tx) => {
      for (const t of ["action_log", "partner_onboarding_tasks", "ad_metrics_daily", "ads", "ad_sets",
                       "campaigns", "spend_ceilings", "compliance_screenings", "generation_job_assets",
                       "generation_jobs", "creative_assets", "brand_kits", "partner_brand",
                       "partner_module_settings", "ad_platform_connections"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    for (const [t, trg] of OFF) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);
  }
});
