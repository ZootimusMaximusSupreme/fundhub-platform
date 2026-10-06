// GET /api/marketing/health, the marketing clock and the worker pass, against real
// Postgres. Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 and §8.3;
// contract docs/specs/marketing-machine-api.md §6.5. Plan unit U22. Lives under src/http/
// because npm test globs src/** and scripts/** only (CLAUDE.md §12); it imports the api/
// handler.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a scratch
// database from db/migrations. Without DATABASE_URL every test skips, and a skipped
// .pg.test.mjs is not green.
//
// NOTHING LEAVES THE MACHINE. The worker pass runs with a made-up GITHUB_REPO_TOKEN and
// no ADAPTERS_DRY_RUN, so the dry-run fence holds the first GitHub call; globalThis.fetch
// is swapped for a spy that fails the test if anything is sent; texts and wakes are
// fakes. TWO COMPANIES OF ITS OWN (slugs mhealth-pg-a, mhealth-pg-b); everything is
// removed after.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import { asStaff } from "../partners/rls.mjs";
import handler, { readOutbox, readJobCounts } from "../../api/marketing/health.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { tick, beat, readHeartbeats, machineOrgIds } from "../marketing/clock.mjs";
import { runPass, recordDrain, claimForGroup } from "../marketing/worker.mjs";
import { enqueueRepoWrite } from "../repo/outbox.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG_A = "mhealth-pg-a";
const SLUG_B = "mhealth-pg-b";
const EMAIL_TAG = "mhealth_pg_test";
const FAKE_TOKEN = "test-token-not-a-real-github-token";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

async function call(token, { method = "GET", env = {} } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query: {} }, r, { db, env });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

/** Run fn with a fetch that records and refuses every call. */
async function withNoNetwork(fn) {
  const real = globalThis.fetch;
  const hits = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { hits.push(String(url)); throw new Error("network is off in this test"); });
  try { return { out: await fn(), hits }; }
  finally { globalThis.fetch = real; }
}

describe("marketing health, clock and worker (real Postgres)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, ownerA, adminA, tokenCloserA, tokenCsmA, ownerB;

  async function cleanup() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM marketing_model_usage WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_batches WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_jobs WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM repo_outbox WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_heartbeats WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_requests WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_settings WHERE org_id = ANY($1)`, [orgs]);
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Marketing health ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing health fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;

  const beatRow = async (org, name) =>
    (await db.query(`SELECT last_at, detail FROM marketing_heartbeats WHERE org_id = $1 AND name = $2`, [org, name])).rows[0] || null;

  before(async () => {
    await cleanup();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    ownerA = await staffIn(orgA, "owner", "a.owner");
    adminA = await staffIn(orgA, "admin", "a.admin");
    tokenCloserA = (await staffIn(orgA, "closer", "a.closer")).token;
    tokenCsmA = (await staffIn(orgA, "csm", "a.csm")).token;
    ownerB = await staffIn(orgB, "owner", "b.owner");
  });

  after(async () => { await cleanup(); await close(); });

  // ── migration 415 ─────────────────────────────────────────────────────────

  test("migration 415: one row per company per name, only the four names, row security forced", async () => {
    const t = (await db.query(
      `SELECT c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'marketing_heartbeats'`
    )).rows[0];
    assert.ok(t, "marketing_heartbeats exists");
    assert.equal(t.relrowsecurity, true);
    assert.equal(t.relforcerowsecurity, true);
    const pol = (await db.query(
      `SELECT 1 FROM pg_policies WHERE tablename = 'marketing_heartbeats' AND policyname = 'marketing_heartbeats_app_all'`
    )).rows;
    assert.equal(pol.length, 1);

    await assert.rejects(
      db.query(`INSERT INTO marketing_heartbeats (org_id, name) VALUES ($1, 'nap')`, [orgB]),
      /marketing_heartbeats_name_ck/
    );
    await assert.rejects(
      db.query(`INSERT INTO marketing_heartbeats (org_id, name, detail) VALUES ($1, 'clock', '[]'::jsonb)`, [orgB]),
      /marketing_heartbeats_detail_ck/
    );
    assert.equal(await beat(db, "clock", [{ orgId: orgB, detail: { n: 1 } }]), 1);
    assert.equal(await beat(db, "clock", [{ orgId: orgB, detail: { n: 2 } }]), 1);
    const rows = (await db.query(`SELECT detail FROM marketing_heartbeats WHERE org_id = $1 AND name = 'clock'`, [orgB])).rows;
    assert.deepEqual(rows.map((r) => r.detail), [{ n: 2 }], "a beat overwrites; it never piles up");
    await db.query(`DELETE FROM marketing_heartbeats WHERE org_id = $1`, [orgB]);
  });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("no session 401; closer and csm 403 and nothing is written; owner and admin 200; POST 405", async () => {
    assert.equal((await call(null)).code, 401);
    for (const t of [tokenCloserA, tokenCsmA]) {
      const r = await call(t);
      assert.equal(r.code, 403, JSON.stringify(r.body));
      assert.equal(r.body.error, "forbidden");
    }
    assert.equal(await beatRow(orgA, "page_seen"), null, "a refused caller wrote no page_seen");
    const settings = (await db.query(`SELECT 1 FROM marketing_settings WHERE org_id = $1`, [orgA])).rows;
    assert.equal(settings.length, 0, "a refused caller made no settings row");
    assert.equal((await call(ownerA.token)).code, 200);
    assert.equal((await call(adminA.token)).code, 200);
    const p = await call(ownerA.token, { method: "POST" });
    assert.equal(p.code, 405);
    assert.equal(p.headers.Allow, "GET");
  });

  // ── the answer ────────────────────────────────────────────────────────────

  test("owner 200 with the contract shape; no token → token_present false, held_reason 'no_token'", async () => {
    const r = await call(ownerB.token, { env: {} });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("GET marketing/health", r.body);
    const b = r.body;
    assert.deepEqual(Object.keys(b), ["clock", "worker", "outbox", "sync", "model", "as_of"]);
    assert.equal(b.clock.enabled, false, "the weekly-batch switch starts off");
    assert.equal(b.worker.queued, 0);
    assert.equal(b.worker.running, 0);
    assert.deepEqual(b.worker.failed_24h, []);
    assert.equal(b.outbox.waiting, 0);
    assert.equal(b.outbox.oldest_waiting_at, null);
    assert.equal(b.outbox.last_commit_sha, null);
    assert.equal(b.outbox.token_present, false);
    assert.equal(b.outbox.held_reason, "no_token");
    assert.equal(b.sync.last_sync_at, null, "never synced → null, not a made-up time");
    assert.equal(b.model.month_cost_usd, 0);
    assert.equal(b.model.max_month_cost_usd, 300);
    assert.equal(b.model.max_batch_cost_usd, 40);
    assert.equal(b.model.last_batch_cost_usd, null, "no batch yet → null");
    assert.ok(!Number.isNaN(Date.parse(b.as_of)));
    // A masked copy of the token is not a token.
    const masked = await call(ownerB.token, { env: { GITHUB_REPO_TOKEN: "****************abcd" } });
    assert.equal(masked.body.outbox.token_present, false);
    assert.equal(masked.body.outbox.held_reason, "no_token");
    // The answer never carries the token, set or not.
    const set = await call(ownerB.token, { env: { GITHUB_REPO_TOKEN: FAKE_TOKEN } });
    assert.equal(set.body.outbox.token_present, true);
    assert.ok(!JSON.stringify(set.body).includes(FAKE_TOKEN));
  });

  test("reading it writes a page_seen heartbeat for the caller", async () => {
    await call(ownerA.token);
    const first = await beatRow(orgA, "page_seen");
    assert.ok(first, "page_seen written");
    assert.equal(first.detail.staff_id, ownerA.id);
    await call(adminA.token);
    const second = await beatRow(orgA, "page_seen");
    assert.equal(second.detail.staff_id, adminA.id);
    assert.ok(new Date(second.last_at).getTime() >= new Date(first.last_at).getTime());
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_heartbeats WHERE org_id = $1 AND name = 'page_seen'`, [orgA])).rows[0].n;
    assert.equal(n, 1);
  });

  test("job counts and failures of the last 24 hours — this company only, never 'offer'", async () => {
    await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, status, error, finished_at, claimed_at, result) VALUES
         ($1, 'write_slot', 'queued',  NULL, NULL, NULL, NULL),
         ($1, 'write_slot', 'running', NULL, NULL, now(), NULL),
         ($1, 'write_slot', 'failed',  'The writer stopped: the model took longer than 5 minutes.', now() - interval '1 hour', NULL, NULL),
         ($1, 'meta_load',  'failed',  'old failure', now() - interval '2 days', NULL, NULL),
         ($1, 'offer',      'queued',  NULL, NULL, NULL, NULL),
         ($2, 'write_slot', 'failed',  'another company', now(), NULL, NULL)`,
      [orgA, orgB]
    );
    const r = await call(ownerA.token);
    assert.equal(r.code, 200);
    assert.equal(r.body.worker.queued, 1, "the offer row is not counted");
    assert.equal(r.body.worker.running, 1);
    assert.equal(r.body.worker.failed_24h.length, 1);
    assert.equal(r.body.worker.failed_24h[0].kind, "write_slot");
    assert.equal(r.body.worker.failed_24h[0].error, "The writer stopped: the model took longer than 5 minutes.");
    assert.ok(!Number.isNaN(Date.parse(r.body.worker.failed_24h[0].at)));
    const direct = await asStaff((tx) => readJobCounts(tx, { orgId: orgB }));
    assert.equal(direct.failed_24h.length, 1);
    assert.equal(direct.failed_24h[0].error, "another company");
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = ANY($1)`, [[orgA, orgB]]);
  });

  test("outbox: waiting rows, the oldest, the last commit and the newest error — this company only", async () => {
    await asStaff((tx) => enqueueRepoWrite(tx, {
      orgId: orgA, opId: "mhealth-1", path: "marketing/ads/ideas/mhealth-test-1.md", mode: "replace", content: "one\n"
    }));
    await asStaff((tx) => enqueueRepoWrite(tx, {
      orgId: orgA, opId: "mhealth-2", path: "marketing/ads/ideas/mhealth-test-2.md", mode: "replace", content: "two\n"
    }));
    await db.query(
      `UPDATE repo_outbox SET error = 'GitHub would not move the branch: HTTP 422' WHERE org_id = $1 AND op_id = 'mhealth-2'`,
      [orgA]
    );
    const sha = "0123456789abcdef0123456789abcdef01234567";
    await db.query(
      `INSERT INTO repo_outbox (org_id, op_id, path, mode, content, committed_sha, committed_at)
       VALUES ($1, 'mhealth-0', 'marketing/ads/ideas/mhealth-test-0.md', 'replace', 'zero', $2, now() - interval '1 hour')`,
      [orgA, sha]
    );
    const o = await asStaff((tx) => readOutbox(tx, { orgId: orgA }));
    assert.equal(o.waiting, 2);
    assert.ok(o.oldest_waiting_at);
    assert.equal(o.last_commit_sha, sha);
    assert.ok(o.last_commit_at);
    assert.equal(o.last_error, "GitHub would not move the branch: HTTP 422");
    const other = await asStaff((tx) => readOutbox(tx, { orgId: orgB }));
    assert.deepEqual(other, { waiting: 0, oldest_waiting_at: null, last_commit_sha: null, last_commit_at: null, last_error: null });

    const r = await call(ownerA.token, { env: {} });
    assert.equal(r.body.outbox.waiting, 2);
    assert.equal(r.body.outbox.last_commit_sha, sha);
    assert.equal(r.body.outbox.last_error, "GitHub would not move the branch: HTTP 422");
    assert.equal(r.body.outbox.held_reason, "no_token");
  });

  // ── the clock ─────────────────────────────────────────────────────────────

  test("tick: reads, beats 'clock' on every company it serves, logs 'disabled', and wakes the worker because saves wait", async () => {
    const wakes = [];
    const logs = [];
    const { out, hits } = await withNoNetwork(() => tick({
      db, env: {},
      deps: { wake: async () => { wakes.push(1); return { ok: true, started: true, status: 202, reason: null }; }, log: (l) => logs.push(l) }
    }));
    assert.deepEqual(hits, []);
    assert.ok(out.work.outbox_waiting >= 2);
    assert.equal(wakes.length, 1);
    const a = out.batch.find((x) => x.org_id === orgA);
    assert.equal(a.batch, "disabled");
    assert.equal(a.planned, 0);
    assert.ok(logs.some((l) => l.includes(orgA.slice(0, 8)) && /disabled/.test(l)));
    const hb = await beatRow(orgA, "clock");
    assert.ok(hb, "clock beat written for org A");
    assert.equal(hb.detail.enabled, false);
    assert.equal(hb.detail.batch, "disabled");
    assert.ok((await machineOrgIds(db)).includes(orgA));
    // Nothing planned: no job was queued by the tick.
    const jobs = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgA])).rows[0].n;
    assert.equal(jobs, 0);

    const r = await call(ownerA.token);
    assert.ok(r.body.clock.last_tick_at);
    assert.equal(r.body.clock.enabled, false);
  });

  // ── the worker ────────────────────────────────────────────────────────────

  test("a real worker pass: the drain is held by the dry-run fence (no request sent); health then says held_reason 'dry_run'", async () => {
    const env = { GITHUB_REPO_TOKEN: FAKE_TOKEN };
    const texts = [];
    const wakes = [];
    const { out: s, hits } = await withNoNetwork(() => runPass({
      db, env, registry: {},
      send: async (m) => { texts.push(m); return { ok: true, status: "sent" }; },
      deps: { wake: async () => { wakes.push(1); return { ok: true, started: true }; }, log: () => {} }
    }));
    assert.deepEqual(hits, [], "nothing reached the network");
    assert.deepEqual(s.errors, []);
    assert.equal(s.drains, 1);
    assert.equal(s.last_drain.skipped, "dry_run");
    assert.equal(s.last_drain.held_reason, "dry_run");
    assert.equal(s.stopped, "idle", "a held drain is not waited on");
    assert.equal(wakes.length, 0);

    const drainBeat = await beatRow(orgA, "outbox_drain");
    assert.equal(drainBeat.detail.held_reason, "dry_run");
    const workerBeat = await beatRow(orgA, "worker");
    assert.equal(workerBeat.detail.state, "done");

    // The rows still wait, unclaimed, and the hold did not count as an attempt.
    const rows = (await db.query(
      `SELECT claimed_at, attempts FROM repo_outbox WHERE org_id = $1 AND committed_sha IS NULL ORDER BY id`, [orgA]
    )).rows;
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.claimed_at === null && x.attempts === 0), JSON.stringify(rows));

    const r = await call(ownerA.token, { env });
    assert.equal(r.code, 200);
    assertMatchesContract("GET marketing/health", r.body);
    assert.equal(r.body.outbox.token_present, true);
    assert.equal(r.body.outbox.held_reason, "dry_run");
    assert.ok(r.body.worker.last_run_at);
    // No token beats a dry run: the token is what is missing first.
    const r2 = await call(ownerA.token, { env: {} });
    assert.equal(r2.body.outbox.held_reason, "no_token");
  });

  test("a 'busy' drain moves the time and keeps the last real result", async () => {
    const before = await beatRow(orgA, "outbox_drain");
    await recordDrain(db, { skipped: "busy" });
    const after = await beatRow(orgA, "outbox_drain");
    assert.equal(after.detail.held_reason, "dry_run");
    assert.ok(new Date(after.last_at).getTime() >= new Date(before.last_at).getTime());
    await recordDrain(db, { committed_sha: "f".repeat(40), ids: [1] });
    const committed = await beatRow(orgA, "outbox_drain");
    assert.equal(committed.detail.held_reason, null);
    const r = await call(ownerA.token, { env: { GITHUB_REPO_TOKEN: FAKE_TOKEN } });
    assert.equal(r.body.outbox.held_reason, null);
  });

  test("claimForGroup holds the writer cap across passes, in a real transaction", async () => {
    await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, status, claimed_at) VALUES ($1, 'mhealth_writer', 'running', now()), ($1, 'mhealth_writer', 'running', now())`,
      [orgA]
    );
    await db.query(
      `INSERT INTO marketing_jobs (org_id, kind) VALUES ($1, 'mhealth_writer'), ($1, 'mhealth_writer'), ($1, 'offer')`,
      [orgA]
    );
    const got = await claimForGroup(db, { group: "writer", kinds: ["mhealth_writer", "offer"], limit: 3 });
    assert.equal(got.length, 1, "3 writers at once: 2 were running, so 1 more");
    assert.equal(got[0].kind, "mhealth_writer");
    assert.equal(got[0].status, "running");
    assert.deepEqual(await claimForGroup(db, { group: "writer", kinds: ["mhealth_writer"], limit: 3 }), []);
    const offer = (await db.query(`SELECT status FROM marketing_jobs WHERE org_id = $1 AND kind = 'offer'`, [orgA])).rows[0];
    assert.equal(offer.status, "queued", "the offer row was never claimed");
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgA]);
  });

  test("model cost: this month and the newest batch, in dollars", async () => {
    const batch = (await db.query(
      `INSERT INTO marketing_batches (org_id, kind, status) VALUES ($1, 'on_command', 'planned') RETURNING id`, [orgA]
    )).rows[0].id;
    await db.query(
      `INSERT INTO marketing_model_usage (org_id, batch_id, model, input_tokens, output_tokens, cost_usd) VALUES
         ($1, NULL, 'claude-sonnet-5-5', 100, 100, 1.5),
         ($1, $2,   'claude-sonnet-5-5', 100, 100, 0.75)`,
      [orgA, batch]
    );
    const r = await call(ownerA.token);
    assert.equal(r.body.model.month_cost_usd, 2.25);
    assert.equal(r.body.model.last_batch_cost_usd, 0.75);
    assert.equal(r.body.model.max_month_cost_usd, 300);
    assert.equal(r.body.model.max_batch_cost_usd, 40);
  });

  test("readHeartbeats is one company's rows only", async () => {
    const a = await readHeartbeats(db, orgA);
    assert.ok(a.page_seen && a.clock && a.worker && a.outbox_drain);
    await db.query(`DELETE FROM marketing_heartbeats WHERE org_id = $1`, [orgB]);
    assert.deepEqual(await readHeartbeats(db, orgB), {});
  });
});
