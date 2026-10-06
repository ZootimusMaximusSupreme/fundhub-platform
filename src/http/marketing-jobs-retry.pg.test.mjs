// POST /api/marketing/jobs/retry (plan unit U26, spec §8.3: Today lists each
// stuck machine step with Retry) against real Postgres. Lives under src/http/
// because npm test globs src/** and scripts/** only (CLAUDE.md §12).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL every test skips,
// and a skipped .pg.test.mjs is not green.
//
// TWO COMPANIES OF ITS OWN (slug prefix below); everything is removed after.
// 'write_slot' is the writer's kind (plan unit U24). Until its handler lands it
// is not in JOB_KINDS, so this file registers a stub for its own length and puts
// back whatever was there.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/marketing/jobs/retry.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { JOB_KINDS } from "../marketing/job-kinds.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG_TAG = "zz-mm-retry-pg";
const EMAIL_TAG = "zz_mm_retry_pg";
const ROUTE = "marketing/jobs/retry";

let seq = 0;
const rid = (tag) => `mm-retry-${tag}-${RUN}-${++seq}`;

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("/api/marketing/jobs/retry", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, tokenOwnerA, tokenAdminA, tokenCloserA;
  let wakes = 0;
  const hadWriteSlot = Object.prototype.hasOwnProperty.call(JOB_KINDS, "write_slot");
  const savedWriteSlot = JOB_KINDS.write_slot;

  async function call(token, body, { method = "POST" } = {}) {
    const r = res();
    await handler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query: {}, body },
      r,
      { db, env: {}, wake: async () => { wakes++; return { ok: true, started: false }; } }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }

  const job = async (id) => (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [id])).rows[0];

  /** A job row put straight in, the way the worker would have left it. */
  async function mkJob(org, kind, status, { attempts = 3, error = "Tried 3 times and it still failed. Last error: the model timed out." } = {}) {
    return (await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, payload, status, attempts, error, result, claimed_at, finished_at, run_after)
       VALUES ($1, $2, '{"slot":1}'::jsonb, $3, $4,
               CASE WHEN $3 IN ('failed', 'queued') THEN $5 END,
               CASE WHEN $3 = 'done' THEN '{}'::jsonb END,
               CASE WHEN $3 IN ('running', 'failed') THEN now() - interval '20 minutes' END,
               CASE WHEN $3 IN ('failed', 'done') THEN now() - interval '5 minutes' END,
               now() - interval '1 hour')
       RETURNING *`,
      [org, kind, status, attempts, error]
    )).rows[0];
  }

  async function cleanup() {
    const orgs = `(SELECT id FROM orgs WHERE slug LIKE '${SLUG_TAG}%')`;
    await db.query(`DELETE FROM marketing_requests WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id IN ${orgs}`);
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug LIKE '${SLUG_TAG}%'`); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Retry ${tag}`, role]
    )).rows[0];
    return (await createSession(db, { staffId: row.id, orgId: org })).token;
  }

  const mkOrg = async (suffix) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing retry fixture') RETURNING id`, [`${SLUG_TAG}-${suffix}-${RUN}`]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");
    tokenOwnerA = await staffIn(orgA, "owner", "a.owner");
    tokenAdminA = await staffIn(orgA, "admin", "a.admin");
    tokenCloserA = await staffIn(orgA, "closer", "a.closer");
    JOB_KINDS.write_slot = { group: "writer", load: async () => ({ run: async () => ({}) }) };
  });

  after(async () => {
    if (hadWriteSlot) JOB_KINDS.write_slot = savedWriteSlot;
    else delete JOB_KINDS.write_slot;
    await cleanup();
    await close();
  });

  test("a failed write_slot job of the caller's company goes back to queued: attempts 0, error null, due now", async () => {
    const failed = await mkJob(orgA, "write_slot", "failed");
    const before = wakes;
    const r = await call(tokenOwnerA, { request_id: rid("ok"), job_id: failed.id });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/jobs/retry", r.body);
    assert.deepEqual(r.body, { ok: true, job: { id: failed.id, kind: "write_slot", status: "queued" } });

    const row = await job(failed.id);
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    assert.equal(row.error, null);
    assert.equal(row.result, null);
    assert.equal(row.claimed_at, null);
    assert.equal(row.finished_at, null);
    assert.ok(new Date(row.run_after).getTime() <= Date.now() + 1000, "due now");
    assert.equal(wakes, before + 1, "the worker is woken after the commit");

    const saved = (await db.query(`SELECT route, response FROM marketing_requests WHERE org_id = $1 AND route = $2`, [orgA, ROUTE])).rows;
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0].response, r.body);
  });

  test("an admin can retry too; a repeated request_id answers the same body and changes nothing", async () => {
    const failed = await mkJob(orgA, "write_slot", "failed");
    const id = rid("repeat");
    const first = await call(tokenAdminA, { request_id: id, job_id: failed.id });
    assert.equal(first.code, 200, JSON.stringify(first.body));
    // The job fails again before the second copy of the press arrives.
    await db.query(`UPDATE marketing_jobs SET status = 'failed', attempts = 3, error = 'failed again' WHERE id = $1`, [failed.id]);
    const second = await call(tokenAdminA, { request_id: id, job_id: failed.id });
    assert.equal(second.code, 200);
    assert.deepEqual(second.body, first.body);
    assert.equal((await job(failed.id)).status, "failed", "the repeat did not run the retry again");
  });

  test("another company's job, an 'offer' job and a kind the worker does not know answer 404", async () => {
    const foreign = await mkJob(orgB, "write_slot", "failed");
    const offer = await mkJob(orgA, "offer", "failed");
    const unknown = await mkJob(orgA, `zz_unknown_${RUN}`, "failed");
    for (const target of [foreign, offer, unknown]) {
      const before = wakes;
      const r = await call(tokenOwnerA, { request_id: rid("404"), job_id: target.id });
      assert.equal(r.code, 404, `${target.kind}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "not_found");
      assert.equal(typeof r.body.message, "string");
      const row = await job(target.id);
      assert.equal(row.status, "failed", `${target.kind} was left as it was`);
      assert.equal(row.attempts, 3);
      assert.equal(wakes, before, "no wake for a refusal");
    }
    const missing = await call(tokenOwnerA, { request_id: rid("404"), job_id: "00000000-0000-4000-8000-0000000000ff" });
    assert.equal(missing.code, 404);
  });

  test("a job that is not failed answers 400 invalid job_id and is left alone", async () => {
    for (const status of ["queued", "running", "done"]) {
      const j = await mkJob(orgA, "write_slot", status, { attempts: 1 });
      const r = await call(tokenOwnerA, { request_id: rid("400"), job_id: j.id });
      assert.equal(r.code, 400, `${status}: ${JSON.stringify(r.body)}`);
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, "job_id");
      assert.equal((await job(j.id)).status, status);
    }
    const bad = await call(tokenOwnerA, { request_id: rid("400"), job_id: "not-a-job" });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "job_id");
  });

  test("a closer gets 403 and the job stays failed; no session 401; GET 405", async () => {
    const failed = await mkJob(orgA, "write_slot", "failed");
    const r = await call(tokenCloserA, { request_id: rid("gate"), job_id: failed.id });
    assert.equal(r.code, 403);
    assert.equal(r.body.error, "forbidden");
    assert.equal((await job(failed.id)).status, "failed");
    assert.equal((await call(null, { request_id: rid("gate"), job_id: failed.id })).code, 401);
    const g = await call(tokenOwnerA, undefined, { method: "GET" });
    assert.equal(g.code, 405);
    assert.equal(g.headers.Allow, "POST");
  });
});
