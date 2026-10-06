// The marketing job queue (src/marketing/jobs.mjs), model-usage logging and cost caps
// (src/marketing/model-usage.mjs) and the shape migration 411 adds, against real Postgres.
// Lives under src/http/ because npm test only globs src/** and scripts/** (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a scratch
// database from db/migrations. Without DATABASE_URL every test skips.
//
// ISOLATION. Everything this file writes belongs to two companies it makes itself (slug
// starting with SLUG_TAG) and uses job kinds unique to this run (KIND_TAG), so it never
// claims, blocks or changes another suite's rows — the one-offer-in-flight index is per
// company, so the offer rows here cannot get in the Write offer test's way. The "no filter"
// claim runs inside a transaction that is rolled back, so it changes nothing.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { db, pool, close } from "../db.mjs";
import {
  enqueueJob, claimJobs, finishJob, requeueJob, failJob, reclaimStale, retryJob, nextRunAfter,
  MAX_ATTEMPTS, STALE_AFTER_MINUTES
} from "../marketing/jobs.mjs";
import { logUsage, costStatus } from "../marketing/model-usage.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const SLUG_TAG = "zz-mm-jobs-pg-test";
const KIND_TAG = `zz_jobs_${RUN}`;
const kind = (name) => `${KIND_TAG}_${name}`;

const NEW_TABLES = ["marketing_buzzes", "marketing_model_usage", "marketing_shoots"];

describe("marketing job queue, model usage and migration 411", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB;

  async function purge() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    await db.query(`DELETE FROM marketing_model_usage WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_shoots WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`);
  }

  const row = async (id) => (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
  const makeDue = (id) => db.query(`UPDATE marketing_jobs SET run_after = now() - interval '1 second' WHERE id = $1`, [id]);
  const secondsAhead = async (id) => Number((await db.query(
    `SELECT extract(epoch FROM run_after - now()) AS s FROM marketing_jobs WHERE id = $1`, [id])).rows[0].s);
  const ids = (rows) => rows.map((r) => r.id);

  /** An offer row put straight in, the way the Write offer path would have left it. */
  async function offerRow(orgId, status) {
    return (await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, payload, status, error, run_after, claimed_at)
       VALUES ($1, 'offer', '{"campaign":"${SLUG_TAG}"}'::jsonb, $2,
               CASE WHEN $2 = 'failed' THEN 'closed by test' END,
               now() - interval '1 hour',
               CASE WHEN $2 = 'running' THEN now() - interval '40 minutes' END)
       RETURNING *`,
      [orgId, status]
    )).rows[0];
  }

  before(async () => {
    await purge();
    orgA = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'MM jobs test A') RETURNING id`, [`${SLUG_TAG}-a-${RUN}`])).rows[0].id;
    orgB = (await db.query(`INSERT INTO orgs (slug, name) VALUES ($1, 'MM jobs test B') RETURNING id`, [`${SLUG_TAG}-b-${RUN}`])).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  // ── migration 411 ──────────────────────────────────────────────────────────

  test("411 adds the claim index and leaves 409's marketing_jobs exactly as it was", async () => {
    const idx = (await db.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'marketing_jobs'`
    )).rows;
    const claim = idx.find((i) => i.indexname === "marketing_jobs_claim_idx");
    assert.ok(claim, "marketing_jobs_claim_idx is missing");
    assert.match(claim.indexdef, /\(status, run_after\)/);
    assert.ok(idx.find((i) => i.indexname === "marketing_jobs_one_offer_in_flight_uq"), "409's one-offer index is gone");
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'marketing_jobs'`
    )).rows.map((r) => r.column_name);
    for (const c of ["id", "org_id", "kind", "payload", "status", "attempts", "run_after", "claimed_at", "finished_at", "error", "result", "requested_by"]) {
      assert.ok(cols.includes(c), `marketing_jobs lost column ${c}`);
    }
    const sql = fs.readFileSync(new URL("../../db/migrations/411_marketing_buzzes_usage_shoots.sql", import.meta.url), "utf8");
    assert.doesNotMatch(sql, /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(public\.)?marketing_jobs\s*\(/i, "411 must not re-create marketing_jobs");
    assert.doesNotMatch(sql, /CONCURRENTLY/i);
  });

  test("411's three tables: row security on and forced, an app policy, the app grant, no web-role access", async () => {
    const rls = (await db.query(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = c.relname || '_app_all') AS app_policy
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY($1)`, [NEW_TABLES]
    )).rows;
    assert.equal(rls.length, 3);
    for (const r of rls) {
      assert.equal(r.relrowsecurity, true, `${r.relname}: row security off`);
      assert.equal(r.relforcerowsecurity, true, `${r.relname}: row security not forced`);
      assert.equal(r.app_policy, 1, `${r.relname}: no ${r.relname}_app_all policy`);
    }
    const roles = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('fundhub_app', 'anon', 'authenticated')`)).rows.map((r) => r.rolname);
    for (const t of NEW_TABLES) {
      if (roles.includes("fundhub_app")) {
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
          const ok = (await db.query(`SELECT has_table_privilege('fundhub_app', $1, $2) AS ok`, [`public.${t}`, priv])).rows[0].ok;
          assert.equal(ok, true, `fundhub_app cannot ${priv} ${t}`);
        }
      }
      for (const web of ["anon", "authenticated"]) {
        if (!roles.includes(web)) continue;
        const any = (await db.query(`SELECT has_table_privilege($1, $2, 'SELECT, INSERT, UPDATE, DELETE') AS any`, [web, `public.${t}`])).rows[0].any;
        assert.equal(any, false, `${web} can still touch ${t}`);
      }
    }
  });

  test("marketing_shoots: planned by default, Arizona's date, and the database refuses a bad state", async () => {
    const s = (await db.query(`INSERT INTO marketing_shoots (org_id) VALUES ($1) RETURNING *, (now() AT TIME ZONE 'America/Phoenix')::date AS az_today`, [orgA])).rows[0];
    assert.equal(s.status, "planned");
    assert.deepEqual(s.root_script_ids, []);
    assert.deepEqual(s.marks, {});
    assert.equal(String(s.shoot_date), String(s.az_today));
    const refuse = async (sql, params) => assert.rejects(db.query(sql, params), (e) => e.code === "23514");
    await refuse(`INSERT INTO marketing_shoots (org_id, status) VALUES ($1, 'wrapped')`, [orgA]);
    await refuse(`INSERT INTO marketing_shoots (org_id, status) VALUES ($1, 'done')`, [orgA]);
    await refuse(`INSERT INTO marketing_shoots (org_id, marks) VALUES ($1, '[]'::jsonb)`, [orgA]);
    const done = (await db.query(
      `INSERT INTO marketing_shoots (org_id, status, root_script_ids, marks, started_at, finished_at)
       VALUES ($1, 'done', ARRAY[gen_random_uuid(), gen_random_uuid()], '{"x":{"takes":2,"got_it":true}}'::jsonb, now() - interval '1 hour', now())
       RETURNING status, array_length(root_script_ids, 1) AS n`, [orgA])).rows[0];
    assert.deepEqual(done, { status: "done", n: 2 });
  });

  // ── the queue ──────────────────────────────────────────────────────────────

  test("enqueueJob makes a queued row and refuses 'offer'", async () => {
    const j = await enqueueJob(db, { orgId: orgA, kind: kind("enq"), payload: { a: 1 } });
    assert.equal(j.status, "queued");
    assert.equal(j.attempts, 0);
    assert.deepEqual(j.payload, { a: 1 });
    await assert.rejects(enqueueJob(db, { orgId: orgA, kind: "offer" }), /createOfferJob/);
    await assert.rejects(enqueueJob(db, { orgId: orgA, kind: " " }), /kind is required/);
  });

  test("two concurrent claimers get disjoint rows", async () => {
    // 1) One claimer holds its rows inside an open transaction; the second skips them.
    const k1 = kind("disjoint1");
    const made = [];
    for (let i = 0; i < 6; i++) made.push((await enqueueJob(db, { orgId: orgA, kind: k1 })).id);
    const client = await pool().connect();
    let first, second;
    try {
      await client.query("BEGIN");
      first = await claimJobs(client, { limit: 3, kinds: [k1] });
      second = await claimJobs(db, { limit: 6, kinds: [k1] });
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    assert.equal(first.length, 3);
    assert.equal(second.length, 3);
    assert.equal(ids(first).filter((id) => ids(second).includes(id)).length, 0, "a row was claimed twice");
    assert.deepEqual([...ids(first), ...ids(second)].sort(), made.slice().sort());
    for (const r of [...first, ...second]) {
      assert.equal(r.status, "running");
      assert.ok(r.claimed_at);
      assert.equal(r.attempts, 0, "claiming does not count an attempt");
    }

    // 2) Five claimers racing for ten rows: every row once, none twice.
    const k2 = kind("disjoint2");
    for (let i = 0; i < 10; i++) await enqueueJob(db, { orgId: orgA, kind: k2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => claimJobs(db, { limit: 3, kinds: [k2] })));
    const all = results.flatMap(ids);
    assert.equal(new Set(all).size, all.length, "a row was claimed twice");
    assert.equal(all.length, 10);
  });

  test("claimJobs honours kinds, excludeKinds and run_after", async () => {
    const kA = kind("filterA"), kB = kind("filterB");
    const a = await enqueueJob(db, { orgId: orgA, kind: kA });
    const b = await enqueueJob(db, { orgId: orgA, kind: kB });
    const later = await enqueueJob(db, { orgId: orgA, kind: kA, runAfter: new Date(Date.now() + 60 * 60 * 1000) });
    assert.deepEqual(await claimJobs(db, { kinds: [] }), [], "an empty kinds list claims nothing");
    const got = await claimJobs(db, { limit: 10, kinds: [kA, kB], excludeKinds: [kB] });
    assert.deepEqual(ids(got), [a.id]);
    assert.equal((await row(b.id)).status, "queued");
    assert.equal((await row(later.id)).status, "queued", "a job is never claimed before its run_after");
  });

  test("an 'offer' row is never claimed, reclaimed, retried, finished, failed or requeued", async () => {
    const queued = await offerRow(orgA, "queued");

    // No filter at all, inside a transaction that is rolled back so nothing else changes.
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      const any = await claimJobs(client, { limit: 50 });
      assert.ok(!ids(any).includes(queued.id), "claimJobs with no filter took the offer");
      const asked = await claimJobs(client, { limit: 50, kinds: ["offer"] });
      assert.deepEqual(asked, [], "claimJobs took an offer when asked for it by name");
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    assert.equal((await row(queued.id)).status, "queued");
    assert.equal(await nextRunAfter(db, { kinds: ["offer"] }), null, "nextRunAfter counted an offer");

    const running = await offerRow(orgB, "running");
    const back = await reclaimStale(db, { olderThanMin: STALE_AFTER_MINUTES });
    assert.ok(!ids(back).includes(running.id), "reclaimStale took back an offer");
    const r = await row(running.id);
    assert.equal(r.status, "running");
    assert.equal(r.attempts, 0);

    assert.equal(await finishJob(db, running.id, { x: 1 }), null);
    assert.equal(await failJob(db, running.id, "nope"), null);
    assert.equal(await requeueJob(db, running.id, {}), null);
    assert.equal((await row(running.id)).status, "running");

    await db.query(`UPDATE marketing_jobs SET status = 'failed', error = 'closed by test', finished_at = now() WHERE id = ANY($1)`, [[queued.id, running.id]]);
    assert.equal(await retryJob(db, { orgId: orgA, id: queued.id, kinds: ["offer"] }), null, "retryJob re-queued an offer");
    assert.equal((await row(queued.id)).status, "failed");
  });

  test("a claim older than 16 minutes is reclaimed; a younger one is not; the 3rd time it fails", async () => {
    const k = kind("stale");
    await enqueueJob(db, { orgId: orgA, kind: k });
    await enqueueJob(db, { orgId: orgA, kind: k });
    const [old, young] = await claimJobs(db, { limit: 2, kinds: [k] });
    await db.query(`UPDATE marketing_jobs SET claimed_at = now() - interval '17 minutes' WHERE id = $1`, [old.id]);
    await db.query(`UPDATE marketing_jobs SET claimed_at = now() - interval '10 minutes' WHERE id = $1`, [young.id]);

    const back = await reclaimStale(db, { olderThanMin: 16 });
    const mine = back.find((b) => b.id === old.id);
    assert.ok(mine, "the 17-minute-old claim was not reclaimed");
    assert.equal(mine.status, "queued");
    assert.equal(mine.attempts, 1, "a worker that died counts an attempt");
    const o = await row(old.id);
    assert.equal(o.claimed_at, null);
    assert.match(o.error, /worker stopped without finishing/);
    assert.ok(!ids(back).includes(young.id));
    assert.equal((await row(young.id)).status, "running");

    // Already tried twice: the third dead claim fails it, with the reason.
    const third = (await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, status, attempts, claimed_at)
       VALUES ($1, $2, 'running', ${MAX_ATTEMPTS - 1}, now() - interval '20 minutes') RETURNING id`,
      [orgA, k])).rows[0];
    await reclaimStale(db, { olderThanMin: 16 });
    const t = await row(third.id);
    assert.equal(t.status, "failed");
    assert.equal(t.attempts, MAX_ATTEMPTS);
    assert.match(t.error, /stopped without finishing 3 times/);
    assert.ok(t.finished_at);

    await assert.rejects(reclaimStale(db, { olderThanMin: 5 }), RangeError);
  });

  test("the 3rd failure marks the job failed with a plain reason; earlier ones back off", async () => {
    const k = kind("fail");
    const j = await enqueueJob(db, { orgId: orgA, kind: k });

    await claimJobs(db, { kinds: [k] });
    let r = await failJob(db, j.id, new Error("Meta said the video is still processing"));
    assert.equal(r.status, "queued");
    assert.equal(r.attempts, 1);
    assert.equal(r.error, "Meta said the video is still processing");
    assert.equal(r.claimed_at, null);
    let ahead = await secondsAhead(j.id);
    assert.ok(ahead > 50 && ahead <= 61, `1st backoff should be about 1 minute, was ${ahead}s`);
    assert.deepEqual(await claimJobs(db, { kinds: [k] }), [], "claimed during its backoff");

    await makeDue(j.id);
    await claimJobs(db, { kinds: [k] });
    r = await failJob(db, j.id, "Meta said the video is still processing");
    assert.equal(r.status, "queued");
    assert.equal(r.attempts, 2);
    ahead = await secondsAhead(j.id);
    assert.ok(ahead > 290 && ahead <= 301, `2nd backoff should be about 5 minutes, was ${ahead}s`);

    await makeDue(j.id);
    await claimJobs(db, { kinds: [k] });
    r = await failJob(db, j.id, "Meta said the video is still processing");
    assert.equal(r.status, "failed");
    assert.equal(r.attempts, 3);
    assert.equal(r.error, "Tried 3 times and it still failed. Last error: Meta said the video is still processing");
    assert.ok(r.finished_at);

    assert.equal(await failJob(db, j.id, "again"), null, "a job that is not running cannot fail again");

    // final: true fails at once (an error that will not fix itself).
    const f = await enqueueJob(db, { orgId: orgA, kind: k });
    await claimJobs(db, { kinds: [k] });
    r = await failJob(db, f.id, "cost cap reached", { final: true });
    assert.equal(r.status, "failed");
    assert.equal(r.attempts, 1);
    assert.equal(r.error, "cost cap reached");

    // A failure with no words still says something.
    const g = await enqueueJob(db, { orgId: orgA, kind: k });
    await claimJobs(db, { kinds: [k] });
    r = await failJob(db, g.id, "", { final: true });
    assert.equal(r.error, "failed, no reason recorded");
  });

  test("requeue keeps attempts and sets the next run; nextRunAfter sees it", async () => {
    const k = kind("requeue");
    const j = await enqueueJob(db, { orgId: orgA, kind: k });
    await claimJobs(db, { kinds: [k] });
    await failJob(db, j.id, "first try went wrong");
    await makeDue(j.id);

    for (let i = 0; i < 4; i++) {
      const [c] = await claimJobs(db, { kinds: [k] });
      assert.equal(c.id, j.id);
      const runAfter = new Date(Date.now() + 10 * 1000);
      const r = await requeueJob(db, j.id, { runAfter });
      assert.equal(r.status, "queued");
      assert.equal(r.attempts, 1, "a requeue must not count an attempt");
      assert.equal(r.claimed_at, null);
      assert.equal(new Date(r.run_after).getTime(), runAfter.getTime());
      const next = await nextRunAfter(db, { kinds: [k] });
      assert.equal(next.getTime(), runAfter.getTime());
      await makeDue(j.id);
    }
    assert.equal((await row(j.id)).error, "first try went wrong", "the last reason stays for the screen");
    assert.equal(await requeueJob(db, j.id, {}), null, "a queued job is not requeued");

    assert.equal(await nextRunAfter(db, { kinds: [] }), null);
    assert.equal(await nextRunAfter(db, { kinds: [kind("nothing-here")] }), null);
  });

  test("finishJob saves the result; a handler that returns nothing saves {}", async () => {
    const k = kind("finish");
    const a = await enqueueJob(db, { orgId: orgA, kind: k });
    const b = await enqueueJob(db, { orgId: orgA, kind: k });
    await claimJobs(db, { limit: 2, kinds: [k] });
    const ra = await finishJob(db, a.id, { scripts: 3 });
    assert.equal(ra.status, "done");
    assert.deepEqual(ra.result, { scripts: 3 });
    assert.ok(ra.finished_at);
    const rb = await finishJob(db, b.id, undefined);
    assert.deepEqual(rb.result, {});
    assert.equal(await finishJob(db, a.id, { again: true }), null);
  });

  test("retryJob re-queues a failed job of the same company only, and only for the kinds passed", async () => {
    const k = kind("retry");
    const j = await enqueueJob(db, { orgId: orgA, kind: k, payload: { slot: 4 } });
    await claimJobs(db, { kinds: [k] });
    await failJob(db, j.id, "cost cap reached", { final: true });
    await db.query(`UPDATE marketing_jobs SET result = '{"partial":true}'::jsonb WHERE id = $1`, [j.id]);

    assert.equal(await retryJob(db, { orgId: orgB, id: j.id, kinds: [k] }), null, "another company's job");
    assert.equal(await retryJob(db, { orgId: orgA, id: j.id, kinds: [kind("other")] }), null, "a kind not passed in");
    assert.equal(await retryJob(db, { orgId: orgA, id: j.id, kinds: [] }), null);
    assert.equal(await retryJob(db, { orgId: orgA, id: j.id }), null);
    assert.equal(await retryJob(db, { orgId: orgA, id: "not-a-uuid", kinds: [k] }), null);
    assert.equal((await row(j.id)).status, "failed");

    const r = await retryJob(db, { orgId: orgA, id: j.id, kinds: [k] });
    assert.equal(r.id, j.id);
    assert.equal(r.status, "queued");
    assert.equal(r.attempts, 0);
    assert.equal(r.error, null);
    assert.equal(r.result, null);
    assert.equal(r.finished_at, null);
    assert.deepEqual(r.payload, { slot: 4 }, "the job keeps what it was asked to do");
    assert.ok(await secondsAhead(j.id) <= 0, "a retried job is due now");

    assert.equal(await retryJob(db, { orgId: orgA, id: j.id, kinds: [k] }), null, "a job that is not failed");
    const [c] = await claimJobs(db, { kinds: [k] });
    assert.equal(c.id, j.id, "the worker picks the retried job up");
  });

  // ── model usage and the cost caps ──────────────────────────────────────────

  test("logUsage saves the served model and its price; costStatus sums the batch and the Arizona month", async () => {
    const job = await enqueueJob(db, { orgId: orgA, kind: kind("usage") });
    const batch = (await db.query(`SELECT gen_random_uuid() AS id`)).rows[0].id;
    const at = async (row, created) => {
      await db.query(`UPDATE marketing_model_usage SET created_at = $2::timestamptz WHERE id = $1`, [row.id, created]);
      return row;
    };

    // In October (Arizona): Oct 1 00:00 Arizona is 07:00 UTC.
    const r1 = await at(await logUsage(db, { orgId: orgA, jobId: job.id, model: "claude-opus-5-5", usage: { input_tokens: 1e6 } }), "2026-10-01T07:00:00Z");
    assert.equal(Number(r1.cost_usd), 4);
    assert.equal(r1.job_id, job.id);
    const r2 = await at(await logUsage(db, { orgId: orgA, model: "a-model-with-no-price", outputTokens: 1e6 }), "2026-10-10T12:00:00Z");
    assert.equal(r2.cost_usd, null, "an unknown price is NULL, never 0");
    // Sep 30 23:59:59 Arizona (Oct 1 in UTC): last month, but in the batch.
    await at(await logUsage(db, { orgId: orgA, batchId: batch, model: "claude-sonnet-5-5", inputTokens: 1e6 }), "2026-10-01T06:59:59Z");
    await at(await logUsage(db, { orgId: orgA, batchId: batch, model: "claude-opus-5-5", outputTokens: 1e6 }), "2026-10-12T12:00:00Z");
    // Another company's spend never counts.
    await at(await logUsage(db, { orgId: orgB, batchId: batch, model: "claude-opus-5-5", inputTokens: 5e6 }), "2026-10-12T12:00:00Z");

    const now = new Date("2026-10-15T12:00:00Z");
    const s = await costStatus(db, { orgId: orgA, batchId: batch, maxBatchUsd: 40, maxMonthUsd: 300, now });
    // month: $4 (r1) + $20 (r2 at the highest output rate, never free) + $20 (r4) = $44
    // batch: $2 (r3) + $20 (r4) = $22
    assert.deepEqual(s, { batch_usd: 22, month_usd: 44, unpriced_rows: 1, batch_capped: false, month_capped: false });

    const capped = await costStatus(db, { orgId: orgA, batchId: batch, maxBatchUsd: 22, maxMonthUsd: 44, now });
    assert.equal(capped.batch_capped, true);
    assert.equal(capped.month_capped, true);

    const noBatch = await costStatus(db, { orgId: orgA, now });
    assert.equal(noBatch.batch_usd, null);
    assert.equal(noBatch.batch_capped, false);
    assert.equal(noBatch.month_usd, 44);

    // November in Arizona starts at Nov 1 07:00 UTC: October's spend is not November's.
    const nov = await costStatus(db, { orgId: orgA, now: new Date("2026-11-01T07:00:00Z") });
    assert.equal(nov.month_usd, 0);
  });

  test("the database refuses negative tokens and a blank model", async () => {
    await assert.rejects(
      db.query(`INSERT INTO marketing_model_usage (org_id, model, input_tokens) VALUES ($1, 'claude-opus-5-5', -1)`, [orgA]),
      (e) => e.code === "23514");
    await assert.rejects(
      db.query(`INSERT INTO marketing_model_usage (org_id, model) VALUES ($1, '  ')`, [orgA]),
      (e) => e.code === "23514");
  });
});
