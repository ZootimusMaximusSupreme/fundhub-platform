// GET /api/marketing/batches and POST /api/marketing/batches/write-now (plan
// unit U26, spec §7.8, §7.4, §2 item 1, §7.7) against real Postgres. Lives under
// src/http/ because npm test globs src/** and scripts/** only (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// TWO COMPANIES OF ITS OWN (slug prefix below); everything is removed after.
// write_now_ready reads JOB_KINDS: the test takes 'start_batch' out (or puts a
// stub in) for the length of one test and puts back whatever was there, so it
// still holds once plan unit U35 registers the real handler.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import batchesHandler from "../../api/marketing/batches.mjs";
import writeNowHandler from "../../api/marketing/batches/write-now.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { JOB_KINDS } from "../marketing/job-kinds.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG_TAG = "zz-mm-batches-pg";
const EMAIL_TAG = "zz_mm_batches_pg";

let seq = 0;
const rid = (tag) => `mm-batches-${tag}-${RUN}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

/** Run fn with JOB_KINDS.start_batch set to `entry` (undefined = absent), then put it back. */
async function withStartBatch(entry, fn) {
  const had = Object.prototype.hasOwnProperty.call(JOB_KINDS, "start_batch");
  const saved = JOB_KINDS.start_batch;
  if (entry === undefined) delete JOB_KINDS.start_batch;
  else JOB_KINDS.start_batch = entry;
  try { return await fn(); } finally {
    if (had) JOB_KINDS.start_batch = saved;
    else delete JOB_KINDS.start_batch;
  }
}

describe("/api/marketing/batches and /api/marketing/batches/write-now", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, tokenOwnerA, tokenCloserA, tokenOwnerB;
  let wakes = 0;

  async function call(handler, token, { method = "GET", body } = {}) {
    const r = res();
    await handler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body },
      r,
      { db, env: {}, wake: async () => { wakes++; return { ok: true, started: false }; } }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }
  const writeNow = (token, body) => call(writeNowHandler, token, { method: "POST", body });
  const batches = (token) => call(batchesHandler, token);

  const batchRows = async (org) => (await db.query(`SELECT * FROM marketing_batches WHERE org_id = $1 ORDER BY created_at`, [org])).rows;
  const jobRows = async (org) => (await db.query(`SELECT * FROM marketing_jobs WHERE org_id = $1 ORDER BY created_at`, [org])).rows;

  async function cleanup() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    await db.query(`DELETE FROM repo_outbox WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_requests WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM ad_ideas WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_batches WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_model_usage WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_funnels WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_settings WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Batches ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  const mkOrg = async (suffix) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing batches fixture') RETURNING id`, [`${SLUG_TAG}-${suffix}-${RUN}`]
  )).rows[0].id;

  const mkIdea = async (org, text) => (await db.query(
    `INSERT INTO ad_ideas (org_id, source, raw_points) VALUES ($1, 'chris', $2) RETURNING id`, [org, text]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");
    tokenOwnerA = await staffIn(orgA, "owner", "a.owner");
    tokenCloserA = await staffIn(orgA, "closer", "a.closer");
    tokenOwnerB = await staffIn(orgB, "owner", "b.owner");
    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane)
       VALUES ($1, 'book_call', 'Book a call', 'https://apply.fundhub.ai/watch', 'sorting')`,
      [orgA]
    );
  });

  after(async () => { await cleanup(); await close(); });

  test("a closer gets 403 on both and nothing is queued; the wrong method gets 405", async () => {
    const g = await batches(tokenCloserA);
    assert.equal(g.code, 403);
    const p = await writeNow(tokenCloserA, { request_id: rid("gate") });
    assert.equal(p.code, 403);
    assert.equal((await batchRows(orgA)).length, 0);
    assert.equal((await jobRows(orgA)).length, 0);
    assert.equal((await batches(null)).code, 401);
    const w = await call(writeNowHandler, tokenOwnerA, { method: "GET" });
    assert.equal(w.code, 405);
    assert.equal(w.headers.Allow, "POST");
    const b = await call(batchesHandler, tokenOwnerA, { method: "POST", body: {} });
    assert.equal(b.code, 405);
    assert.equal(b.headers.Allow, "GET");
  });

  test("write-now: 202 {queued, batch_id, job_id}; an on-command batch released now; start_batch queued; works with the schedule off", async () => {
    const before = wakes;
    const r = await writeNow(tokenOwnerA, { request_id: rid("now") });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/batches/write-now", r.body);
    assert.equal(r.body.queued, true);

    const settings = (await db.query(`SELECT enabled, scripts_per_day FROM marketing_settings WHERE org_id = $1`, [orgA])).rows[0];
    assert.equal(settings.enabled, false, "the weekly schedule is off, and Write now still runs");

    const batch = (await db.query(`SELECT * FROM marketing_batches WHERE id = $1`, [r.body.batch_id])).rows[0];
    assert.equal(batch.org_id, orgA);
    assert.equal(batch.kind, "on_command");
    assert.equal(batch.status, "planned");
    assert.ok(Math.abs(new Date(batch.release_at).getTime() - Date.now()) < 60_000, "release_at is now");
    assert.match(batch.week_key, /^\d{4}-W\d{2}$/);
    assert.equal(batch.released_at, null);

    const job = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [r.body.job_id])).rows[0];
    assert.equal(job.org_id, orgA);
    assert.equal(job.kind, "start_batch");
    assert.equal(job.status, "queued");
    assert.deepEqual(job.payload, { batch_id: r.body.batch_id, count: settings.scripts_per_day, funnel_key: null, idea_ids: [] });
    assert.equal(wakes, before + 1, "the worker is woken after the commit");
  });

  test("write-now with count, funnel_key and idea_ids carries them to start_batch and holds the ideas", async () => {
    const i1 = await mkIdea(orgA, "first idea");
    const i2 = await mkIdea(orgA, "second idea");
    const r = await writeNow(tokenOwnerA, { request_id: rid("full"), count: 2, funnel_key: "book_call", idea_ids: [i1, i2] });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    const job = (await db.query(`SELECT payload FROM marketing_jobs WHERE id = $1`, [r.body.job_id])).rows[0];
    assert.deepEqual(job.payload, { batch_id: r.body.batch_id, count: 2, funnel_key: "book_call", idea_ids: [i1, i2] });
    const held = (await db.query(`SELECT batch_id FROM ad_ideas WHERE id = ANY($1::uuid[])`, [[i1, i2]])).rows;
    assert.ok(held.every((x) => x.batch_id === r.body.batch_id));
  });

  test("write-now refuses bad input with the field named, and queues nothing", async () => {
    const foreignIdea = await mkIdea(orgB, "company B idea");
    const batchesBefore = (await batchRows(orgA)).length;
    const jobsBefore = (await jobRows(orgA)).length;
    const cases = [
      [{ count: 0 }, "count"],
      [{ count: 2.5 }, "count"],
      [{ count: "3" }, "count"],
      [{ funnel_key: "roadmap_147" }, "funnel_key"],
      [{ idea_ids: ["not-a-uuid"] }, "idea_ids"],
      [{ idea_ids: [foreignIdea] }, "idea_ids"],
      [{}, "request_id"]
    ];
    for (const [body, field] of cases) {
      const r = await writeNow(tokenOwnerA, field === "request_id" ? body : { request_id: rid("bad"), ...body });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
    }
    assert.equal((await batchRows(orgA)).length, batchesBefore);
    assert.equal((await jobRows(orgA)).length, jobsBefore);
  });

  test("write-now refuses with a plain reason when costStatus says a cap is reached", async () => {
    const batchesBefore = (await batchRows(orgA)).length;
    const jobsBefore = (await jobRows(orgA)).length;
    await db.query(
      `INSERT INTO marketing_model_usage (org_id, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, 'claude-opus-5-5', 1, 1, 300)`,
      [orgA]
    );
    const capId = rid("cap");
    try {
      const r = await writeNow(tokenOwnerA, { request_id: capId });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "cap_reached");
      assert.match(r.body.message, /month cap/);
      assert.match(r.body.message, /Nothing was queued/);
      assert.equal((await batchRows(orgA)).length, batchesBefore);
      assert.equal((await jobRows(orgA)).length, jobsBefore);
    } finally {
      await db.query(`DELETE FROM marketing_model_usage WHERE org_id = $1`, [orgA]);
    }
    // Under the cap again: the same press goes through (a refusal saved nothing).
    const again = await writeNow(tokenOwnerA, { request_id: capId });
    assert.equal(again.code, 202, JSON.stringify(again.body));
  });

  test("a repeated request_id answers the same 202 and makes one batch", async () => {
    const id = rid("repeat");
    const first = await writeNow(tokenOwnerA, { request_id: id, count: 1 });
    const second = await writeNow(tokenOwnerA, { request_id: id, count: 1 });
    assert.equal(first.code, 202);
    assert.equal(second.code, 202);
    assert.deepEqual(second.body, first.body);
    assert.equal((await batchRows(orgA)).filter((b) => b.id === first.body.batch_id).length, 1);
    assert.equal((await jobRows(orgA)).filter((j) => j.payload.batch_id === first.body.batch_id).length, 1);
  });

  test("GET batches: history newest first with counts; write_now_ready false until start_batch is registered", async () => {
    // One weekly batch with real counts, the way the batch lifecycle (U35) leaves it.
    await db.query(
      `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at, released_at, total, ready, flagged, failed, created_at)
       VALUES ($1, 'weekly', '2026-W40', 'released', now() - interval '7 days', now() - interval '7 days', 21, 20, 2, 1, now() - interval '7 days')`,
      [orgA]
    );
    await withStartBatch(undefined, async () => {
      const r = await batches(tokenOwnerA);
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assertMatchesContract("GET marketing/batches", r.body);
      assert.equal(r.body.write_now_ready, false);
      const mine = await batchRows(orgA);
      assert.equal(r.body.batches.length, mine.length);
      const times = r.body.batches.map((b) => Date.parse(b.release_at));
      assert.ok(r.body.batches[0].kind === "on_command", "the newest (a Write now) is first");
      const weekly = r.body.batches.find((b) => b.kind === "weekly");
      assert.deepEqual(weekly.counts, { total: 21, ready: 20, flagged: 2, failed: 1 });
      assert.equal(weekly.week_key, "2026-W40");
      assert.equal(weekly.status, "released");
      assert.ok(weekly.released_at);
      assert.equal(weekly.error, null);
      assert.ok(times.every((t) => Number.isFinite(t)));
      const fresh = r.body.batches.find((b) => b.kind === "on_command");
      assert.deepEqual(fresh.counts, { total: 0, ready: 0, flagged: 0, failed: 0 });
    });

    await withStartBatch({ group: "system", load: async () => ({ run: async () => ({}) }) }, async () => {
      const r = await batches(tokenOwnerA);
      assert.equal(r.code, 200);
      assert.equal(r.body.write_now_ready, true);
    });

    const other = await batches(tokenOwnerB);
    assert.equal(other.code, 200);
    assert.deepEqual(other.body.batches, [], "another company sees none of these");
  });
});
