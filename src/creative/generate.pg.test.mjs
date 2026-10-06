// The generation service against a real Postgres, because the properties worth
// testing here are database properties.
//
// Skipped without DATABASE_URL, like the other *.pg.test.mjs files.
//
// WHAT THIS PROVES, none of which a mocked db would:
//   - the unique index really does absorb a duplicate idempotency key
//   - RLS really does hide one partner's jobs and assets from another
//   - an unscoped read really does return nothing rather than everything
//   - a provider outage leaves the job QUEUED, not succeeded-and-empty
//   - a blocked asset lands in the review queue with its reasons, not dropped
//   - the storage-key namespace CHECK rejects a key outside the partner prefix

import { test, before, beforeEach, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { withPartnerScope as _withPartnerScope, asPartner as _asPartner, asStaff as _asStaff } from "../partners/rls.mjs";
import { rlsPool, rlsDb } from "../testing/rls-pool.mjs";

/* SET UP as the owner, ASSERT as the unprivileged role. A superuser
   bypasses every RLS policy, so these isolation assertions are only
   meaningful through APP_DATABASE_URL. See src/testing/rls-pool.mjs. */
const withPartnerScope = (principal, fn, deps) => _withPartnerScope(principal, fn, { pool: rlsPool, ...(deps || {}) });
const asPartner = (partnerId, fn, deps) => _asPartner(partnerId, fn, { pool: rlsPool, ...(deps || {}) });
const asStaff = (fn, deps) => _asStaff(fn, { pool: rlsPool, ...(deps || {}) });

import { enqueue, claim, run } from "./generate.mjs";
import { QUICK_COPY_MODEL } from "./providers/copy.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const SLUG_A = "cf-test-alpha";
const SLUG_B = "cf-test-beta";
// Every fixture partner shares this prefix so cleanup can find them all, including
// the per-test ones the run cases create.
const SLUG_PREFIX = "cf-test-";

describe("creative generation", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, pA, pB;

  before(async () => {
    org = (await db.query(`SELECT id FROM orgs WHERE is_default LIMIT 1`)).rows[0].id;
    await cleanup();
    pA = await mkPartner(SLUG_A, "CF Alpha");
    pB = await mkPartner(SLUG_B, "CF Beta");

    // A provider for each kind. config carries no credentials — the CHECK in 048
    // rejects that — so the fake provider is driven through ctx instead.
    for (const [kind, key] of [["static", "static"], ["copy", "copy"]]) {
      await db.query(
        `INSERT INTO creative_providers (org_id, asset_kind, provider_key, config, active)
         VALUES ($1,$2,$3,'{"unit_cost_cents":25}'::jsonb,true)
         ON CONFLICT (org_id, asset_kind, provider_key) DO NOTHING`,
        [org, kind, key]
      );
    }
  });

  beforeEach(() => clearRuleCache());
  after(async () => { await cleanup(); await close(); });

  // ------------------------------------------------------------------ idempotency

  test("the same idempotency key produces one job, not two bills", async () => {
    const first = await asPartner(pA, (tx) =>
      enqueue(tx, { orgId: org, partnerId: pA, assetKind: "static", idempotencyKey: "idem-1",
                    spec: { prompt: "x", offerType: "funding" } }));
    const second = await asPartner(pA, (tx) =>
      enqueue(tx, { orgId: org, partnerId: pA, assetKind: "static", idempotencyKey: "idem-1",
                    spec: { prompt: "x", offerType: "funding" } }));

    assert.strictEqual(first.created, true);
    assert.strictEqual(second.created, false);
    assert.strictEqual(first.job.id, second.job.id);
  });

  test("two partners may use the same idempotency key independently", async () => {
    // Scoped to the partner, not global: colliding them would let one partner's
    // request silently return the other partner's job row.
    const a = await asPartner(pA, (tx) =>
      enqueue(tx, { orgId: org, partnerId: pA, assetKind: "static", idempotencyKey: "shared-key",
                    spec: { offerType: "funding" } }));
    const b = await asPartner(pB, (tx) =>
      enqueue(tx, { orgId: org, partnerId: pB, assetKind: "static", idempotencyKey: "shared-key",
                    spec: { offerType: "funding" } }));
    assert.notStrictEqual(a.job.id, b.job.id);
  });

  test("enqueue refuses a generated idempotency key", async () => {
    await assert.rejects(
      () => asPartner(pA, (tx) => enqueue(tx, { orgId: org, partnerId: pA, assetKind: "static" })),
      /idempotencyKey is required/);
  });

  // ------------------------------------------------------------------ isolation

  test("partner B cannot see partner A's generation jobs", async () => {
    await asPartner(pA, (tx) =>
      enqueue(tx, { orgId: org, partnerId: pA, assetKind: "static", idempotencyKey: "iso-1",
                    spec: { offerType: "funding" } }));

    const seen = await asPartner(pB, (tx) =>
      tx.query(`SELECT id FROM generation_jobs WHERE idempotency_key = 'iso-1'`).then((r) => r.rows));
    assert.deepStrictEqual(seen, [], "partner B read partner A's job");
  });

  test("an unscoped read returns nothing rather than everything", async () => {
    // The whole point of RLS here: a query that forgets its predicate fails closed.
    /* rlsDb, not db — the owner bypasses RLS, so this would "leak" no matter
       how correct the policies are. See src/testing/rls-pool.mjs. */
    const rows = (await rlsDb.query(`SELECT id FROM generation_jobs`)).rows;
    assert.deepStrictEqual(rows, [], "an unscoped session read partner rows");
  });

  test("staff context sees across partners", async () => {
    const n = await asStaff((tx) =>
      tx.query(`SELECT count(*)::int AS n FROM generation_jobs`).then((r) => r.rows[0].n));
    assert.ok(n > 0, "staff should see the book");
  });

  test("a partner cannot write a job owned by another partner", async () => {
    await assert.rejects(
      () => asPartner(pA, (tx) => tx.query(
        `INSERT INTO generation_jobs (org_id, partner_id, spec, status, idempotency_key)
         VALUES ($1,$2,'{}'::jsonb,'queued','cross-write')`, [org, pB])),
      /row-level security/i);
  });

  test("withPartnerScope refuses a partner principal with no id", async () => {
    await assert.rejects(
      () => withPartnerScope({ kind: "partner" }, async () => {}),
      /no partnerId/);
  });

  test("withPartnerScope refuses an unknown principal kind", async () => {
    await assert.rejects(
      () => withPartnerScope({ kind: "robot" }, async () => {}), /unknown principal kind/);
  });

  // ------------------------------------------------------------------ running

  /* enqueueAndRun — one partner, one job, one run. The fresh partner is what makes
     the claim deterministic; see mkPartner. */
  async function enqueueAndRun(slug, { assetKind, spec, ctx }) {
    const p = await mkPartner(`${SLUG_PREFIX}${slug}`, slug);
    const { job } = await asPartner(p, (tx) =>
      enqueue(tx, { orgId: org, partnerId: p, assetKind, idempotencyKey: `${slug}-1`, spec }));
    const out = await asPartner(p, async (tx) => {
      const claimed = await claim(tx, { partnerId: p });
      assert.strictEqual(claimed.id, job.id, "claimed the wrong job — the fixture partner is not clean");
      return run(tx, claimed, ctx);
    });
    return { partnerId: p, job, out };
  }

  test("a successful run stores assets, screens them, and records cost", async () => {
    const { partnerId, job, out } = await enqueueAndRun("run-ok", {
      assetKind: "static",
      spec: { prompt: "Business funding for qualified applicants",
              offerType: "funding", formats: ["1x1"], variants: 1 },
      ctx: fakeProviderCtx({ ok: true })
    });

    assert.strictEqual(out.status, "succeeded", `job failed: ${out.error}`);
    assert.strictEqual(out.assets.length, 1);
    // X3: run() names the model that wrote it (the Quick copy card prints it). This
    // stand-in provider names none, so the answer is null, never a guess.
    assert.strictEqual(out.model, null);

    const row = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT status, cost_cents FROM generation_jobs WHERE id = $1`, [job.id])
        .then((r) => r.rows[0]));
    assert.strictEqual(row.status, "succeeded");
    assert.ok(Number(row.cost_cents) > 0, "cost must be recorded for UNIT 9");

    // Clean funding copy with approve_before_launch ON screens to needs_approval,
    // which is not a block — so the asset is usable-pending-approval.
    assert.strictEqual(out.assets[0].compliance_state, "passed");
    assert.ok(out.assets[0].storage_key.startsWith(`partners/${partnerId}/`),
      "storage key must be namespaced to the partner");
  });

  test("a provider outage leaves the job QUEUED, never succeeded-and-empty", async () => {
    // The failure the spec names explicitly: a silent empty result would look like
    // a working system with an empty library.
    const { partnerId, job, out } = await enqueueAndRun("run-outage", {
      assetKind: "static",
      spec: { prompt: "x", offerType: "funding", formats: ["1x1"] },
      ctx: fakeProviderCtx({ throwRetryable: true })
    });

    assert.strictEqual(out.status, "queued");
    const row = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT status, error FROM generation_jobs WHERE id = $1`, [job.id]).then((r) => r.rows[0]));
    assert.strictEqual(row.status, "queued");
    assert.ok(row.error, "the failure reason must be preserved");
  });

  test("a provider returning zero assets is a failure, not an empty success", async () => {
    const { out } = await enqueueAndRun("run-empty", {
      assetKind: "static",
      spec: { prompt: "x", offerType: "funding", formats: ["1x1"] },
      ctx: fakeProviderCtx({ empty: true })
    });
    assert.notStrictEqual(out.status, "succeeded");
  });

  test("blocked copy lands in the review queue WITH reasons, not dropped", async () => {
    const { partnerId, out } = await enqueueAndRun("run-blocked", {
      assetKind: "copy",
      spec: { prompt: "x", offerType: "funding", variants: 1 },
      ctx: fakeProviderCtx({ ok: true, copyText: "Guaranteed approval for everyone!" })
    });

    assert.strictEqual(out.status, "succeeded", "the JOB succeeded; the ASSET is blocked");
    // X3: the copy writer is forced to Claude, and run() hands back the model that
    // wrote it (the Quick copy card prints it); the stored row carries the words.
    assert.strictEqual(out.model, QUICK_COPY_MODEL);
    const asset = out.assets[0];
    assert.strictEqual(asset.copy_text, "Guaranteed approval for everyone!");
    assert.strictEqual(asset.compliance_state, "blocked");

    const row = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT compliance_state, blocked_reasons FROM creative_assets WHERE id = $1`, [asset.id])
        .then((r) => r.rows[0]));
    assert.strictEqual(row.compliance_state, "blocked");
    assert.ok(row.blocked_reasons.length > 0, "a blocked asset must say why");
    assert.ok(row.blocked_reasons.some((r) => r.code === "guaranteed-approval"));

    // And it is reachable through the review-queue read, not just present.
    const queued = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT id FROM creative_assets
                 WHERE compliance_state IN ('pending','blocked') AND archived_at IS NULL`)
        .then((r) => r.rows));
    assert.ok(queued.some((x) => x.id === asset.id), "blocked asset must appear in the review queue");
  });

  test("a blocked copy asset keeps the exact words it generated (301)", async () => {
    // 301_creative_copy_text.sql's own comment: storeAsset() writes copy_text
    // in the same insert as the row, before the screen runs, so a blocked asset
    // keeps its words like any other. This is a different rule from the test
    // above (guaranteed-funding-amount, not guaranteed-approval) — proof that
    // the column survives the block generally, not just for one rule.
    const COPY_TEXT = "Get $50,000 guaranteed for your business this week.";
    const { partnerId, out } = await enqueueAndRun("run-blocked-amount", {
      assetKind: "copy",
      spec: { prompt: "x", offerType: "funding", variants: 1 },
      ctx: fakeProviderCtx({ ok: true, copyText: COPY_TEXT })
    });

    assert.strictEqual(out.status, "succeeded", "the JOB succeeded; the ASSET is blocked");
    const asset = out.assets[0];
    assert.strictEqual(asset.compliance_state, "blocked");

    const row = await asPartner(partnerId, (tx) =>
      tx.query(`SELECT compliance_state, copy_text, blocked_reasons FROM creative_assets WHERE id = $1`, [asset.id])
        .then((r) => r.rows[0]));
    assert.strictEqual(row.compliance_state, "blocked");
    assert.ok(row.blocked_reasons.some((r) => r.code === "guaranteed-funding-amount"),
      "must actually be blocked by the rule this test names, not some other one");
    assert.ok(row.copy_text, "a blocked copy asset with no words is one nobody can fix");
    assert.strictEqual(row.copy_text, COPY_TEXT,
      "the stored words must be the real generated text, not stripped or replaced by the screen");
  });

  test("every screen leaves an audit row", async () => {
    const n = await asStaff((tx) =>
      tx.query(`SELECT count(*)::int AS n FROM compliance_screenings`).then((r) => r.rows[0].n));
    assert.ok(n > 0, "screens must be auditable after the fact");
  });

  test("the per-partner concurrency cap holds", async () => {
    const p = await mkPartner(`${SLUG_PREFIX}cap`, "cap", { maxConcurrent: 2 });
    for (const k of ["cap-1", "cap-2", "cap-3"]) {
      await asPartner(p, (tx) =>
        enqueue(tx, { orgId: org, partnerId: p, assetKind: "static", idempotencyKey: k,
                      spec: { offerType: "funding" } }));
    }
    const claims = await asPartner(p, async (tx) => {
      const out = [];
      for (let i = 0; i < 3; i++) out.push(await claim(tx, { partnerId: p }));
      return out;
    });
    assert.ok(claims[0] && claims[1], "the first two should claim");
    assert.strictEqual(claims[2], null, "the third must be held back by the cap");
  });

  // ------------------------------------------------------------------ constraints

  test("a storage key outside the partner namespace is rejected at the engine", async () => {
    await assert.rejects(
      () => asPartner(pA, (tx) => tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, storage_key)
         VALUES ($1,$2,'static','1x1',true,$3)`,
        [org, pA, `partners/${pB}/creative/stolen.png`])),
      /creative_assets_storage_ns_ck/);
  });

  test("a synthetic performer that is not ai_generated is rejected at the engine", async () => {
    await assert.rejects(
      () => asPartner(pA, (tx) => tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, synthetic_performer)
         VALUES ($1,$2,'video','9x16',false,true)`, [org, pA])),
      /creative_assets_synthetic_ck/);
  });

  test("a blocked asset with no reasons is rejected at the engine", async () => {
    await assert.rejects(
      () => asPartner(pA, (tx) => tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, compliance_state)
         VALUES ($1,$2,'static','1x1',true,'blocked')`, [org, pA])),
      /creative_assets_blocked_reason_ck/);
  });

  test("creative assets cannot be hard-deleted", async () => {
    const id = await asPartner(pA, (tx) => tx.query(
      `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated)
       VALUES ($1,$2,'static','1x1',true) RETURNING id`, [org, pA]).then((r) => r.rows[0].id));
    await assert.rejects(
      () => asPartner(pA, (tx) => tx.query(`DELETE FROM creative_assets WHERE id = $1`, [id])),
      /not deletable/);
  });

  test("an asset cannot inherit a parent belonging to another partner", async () => {
    const parent = await asPartner(pB, (tx) => tx.query(
      `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated)
       VALUES ($1,$2,'static','1x1',true) RETURNING id`, [org, pB]).then((r) => r.rows[0].id));
    await assert.rejects(
      () => asStaff((tx) => tx.query(
        `INSERT INTO creative_assets (org_id, partner_id, kind, format, ai_generated, parent_asset_id)
         VALUES ($1,$2,'static','4x5',true,$3)`, [org, pA, parent])),
      /lineage crosses partners/);
  });

  // ------------------------------------------------------------------ helpers

  /* mkPartner — a fixture partner with its module settings.

     The run tests each take a FRESH one. claim() is FIFO across a partner's whole
     queue, so tests sharing a partner claim each other's jobs — and the outage
     test deliberately leaves a job queued, which the next test would then pick up.
     A test that runs whichever job happens to be oldest is not testing the job it
     enqueued, so each gets its own queue instead. */
  async function mkPartner(slug, name, { maxConcurrent = 2 } = {}) {
    const { rows } = await db.query(
      `INSERT INTO partners (org_id, name, slug, status, agreement_signed_at)
       VALUES ($1,$2,$3,'active',now()) RETURNING id`, [org, name, slug]);
    const id = rows[0].id;
    await asStaff((tx) => tx.query(
      `INSERT INTO partner_module_settings
         (org_id, partner_id, approve_before_launch, max_concurrent_jobs, marketing_suite_enabled)
       VALUES ($1,$2,true,$3,true) ON CONFLICT (partner_id) DO NOTHING`, [org, id, maxConcurrent]));
    return id;
  }

  async function cleanup() {
    const ids = (await db.query(
      `SELECT id FROM partners WHERE slug LIKE $1`, [`${SLUG_PREFIX}%`])).rows.map((r) => r.id);
    if (!ids.length) return;

    const ARCHIVE_ONLY = [
      ["compliance_screenings", "trg_compliance_screenings_no_delete"],
      ["creative_assets", "trg_creative_assets_no_delete"]
    ];
    // The archive-only triggers are what production relies on; a test fixture is
    // the one place they get switched off, and only around its own rows. Same
    // approach as scope.pg.test.mjs does for partner_revenue.
    for (const [t, trg] of ARCHIVE_ONLY) await db.query(`ALTER TABLE ${t} DISABLE TRIGGER ${trg}`);

    // Deletes must run in a staff scope too: under RLS an unscoped DELETE matches
    // no rows and reports success, which would leave the fixture behind and make
    // the next run fail on a unique index for reasons that look unrelated.
    await asStaff(async (tx) => {
      for (const t of ["generation_job_assets", "compliance_screenings", "creative_assets",
                       "generation_jobs", "partner_ai_usage", "partner_module_settings"]) {
        await tx.query(`DELETE FROM ${t} WHERE partner_id = ANY($1)`, [ids]);
      }
    });
    await db.query(`DELETE FROM partners WHERE id = ANY($1)`, [ids]);

    for (const [t, trg] of ARCHIVE_ONLY) await db.query(`ALTER TABLE ${t} ENABLE TRIGGER ${trg}`);
  }
});

/* A fetch stand-in shaped like the providers expect, so the whole service runs
   without a network and without a vendor account. */
function fakeProviderCtx({ ok = false, throwRetryable = false, empty = false, copyText } = {}) {
  return {
    env: {
      CREATIVE_STATIC_API_KEY: "test-key",
      ANTHROPIC_API_KEY: "test-key"
    },
    sleep: async () => {},
    maxAttempts: 2,
    fetch: async (url) => {
      if (throwRetryable) throw new Error("ECONNRESET");
      if (empty) return jsonRes({ data: [] });
      if (String(url).includes("anthropic") || String(url).includes("llm")) {
        const body = {
          content: [{ type: "text", text: copyText || "Business funding for qualified applicants." }],
          usage: { input_tokens: 12, output_tokens: 8 }
        };
        return {
          ok: true,
          status: 200,
          json: async () => body,
          text: async () => JSON.stringify(body)
        };
      }
      return ok
        ? jsonRes({ data: [{ id: "prov-" + Math.random().toString(36).slice(2), url: "https://cdn/x.png" }], cost_cents: 25 })
        : jsonRes({ data: [] });
    }
  };
}

const jsonRes = (body) => ({
  ok: true, status: 200, text: async () => JSON.stringify(body)
});
