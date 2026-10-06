// /api/marketing/ideas (plan unit U26, spec §7.8, §7.5 step 7, §8.1 tab 4)
// against real Postgres. Lives under src/http/ because npm test globs src/** and
// scripts/** only (CLAUDE.md §12); it imports the api/ handler.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a
// scratch database from db/migrations. Without DATABASE_URL the database tests
// skip, and a skipped .pg.test.mjs is not green. The checks at the top need no
// database and always run.
//
// TWO COMPANIES OF ITS OWN (slug prefix below). Everything it writes — ideas,
// batches, jobs, outbox rows, saved answers, settings, funnels, usage — belongs
// to them and is removed after, so the repo-outbox suite's drain never sees a
// row from here.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import handler from "../../api/marketing/ideas.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import {
  validateIdeaInput, validateIdeaStatus, ideaFilePath, ideaFileContent, ideaView, IDEA_VIEW_KEYS
} from "../marketing/ideas-store.mjs";
import { InvalidError } from "../marketing/http.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SLUG_TAG = "zz-mm-ideas-pg";
const EMAIL_TAG = "zz_mm_ideas_pg";
const ROUTE = "marketing/ideas";

let seq = 0;
const rid = (tag) => `mm-ideas-${tag}-${RUN}-${++seq}`;

// ── no database: the pure parts ─────────────────────────────────────────────

describe("ideas-store: checking and shaping (no database)", () => {
  const bad = (body, field) =>
    assert.throws(() => validateIdeaInput(body), (e) => e instanceof InvalidError && e.field === field);

  test("raw_points is required; source is chris or suggestion, never machine", () => {
    bad({}, "raw_points");
    bad({ raw_points: "   " }, "raw_points");
    bad({ raw_points: "x", source: "machine" }, "source");
    bad({ raw_points: "x", source: "agent" }, "source");
    bad({ raw_points: "x", script_format: "tiktok" }, "script_format");
    bad({ raw_points: "x", funnel_key: "Roadmap-147" }, "funnel_key");
    bad({ raw_points: "x", angle_key: "two-files" }, "angle_key");
    bad({ raw_points: "x", write_now: "yes" }, "write_now");
    const ok = validateIdeaInput({ raw_points: "  Lenders read two files.\n", script_format: "long", angle_key: "the_sorting_hat" });
    assert.equal(ok.rawPoints, "  Lenders read two files.\n", "kept word for word");
    assert.equal(ok.source, "chris");
    assert.equal(ok.writeNow, false);
    assert.equal(validateIdeaInput({ raw_points: "x", source: "suggestion" }).source, "suggestion");
  });

  test("the status filter takes the five statuses or nothing", () => {
    assert.equal(validateIdeaStatus(undefined), null);
    assert.equal(validateIdeaStatus("written"), "written");
    assert.throws(() => validateIdeaStatus("done"), (e) => e instanceof InvalidError && e.field === "status");
  });

  test("the idea's file: marketing/ads/ideas/<Arizona day>-<id8>.md, flat front matter, the points word for word", () => {
    const row = {
      id: "0b1c2d3e-0000-4000-8000-000000000402", source: "chris", kind: "script",
      raw_points: "Lenders check the business file too.", topic: null, script_format: "standard",
      funnel_key: "roadmap_147", angle_key: null, status: "new", script_id: null,
      // 02:30 UTC on Oct 13 is still Oct 12 in Arizona (UTC-7).
      created_at: new Date("2026-10-13T02:30:00.000Z")
    };
    assert.equal(ideaFilePath(row), "marketing/ads/ideas/2026-10-12-0b1c2d3e.md");
    const text = ideaFileContent(row);
    assert.match(text, /^---\nidea: 0b1c2d3e-0000-4000-8000-000000000402\nsource: chris\n/);
    assert.match(text, /\nfunnel: roadmap_147\nangle: none\n/);
    assert.ok(text.endsWith("---\n\nLenders check the business file too.\n"));
    assert.deepEqual(Object.keys(ideaView(row)), [...IDEA_VIEW_KEYS]);
  });
});

// ── the route, against Postgres ─────────────────────────────────────────────

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

describe("/api/marketing/ideas", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, ownerA, tokenOwnerA, tokenAdminA, tokenCloserA, tokenOwnerB;
  let wakes = 0;

  async function call(token, { method = "GET", body, query = {} } = {}) {
    const r = res();
    await handler(
      { method, headers: token ? { authorization: "Bearer " + token } : {}, query, body },
      r,
      { db, env: {}, wake: async () => { wakes++; return { ok: true, started: false }; } }
    );
    if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
    return r;
  }

  const ideaRows = async (org) => (await db.query(`SELECT * FROM ad_ideas WHERE org_id = $1 ORDER BY created_at`, [org])).rows;
  const outboxRows = async (org) => (await db.query(`SELECT * FROM repo_outbox WHERE org_id = $1 ORDER BY id`, [org])).rows;
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
      [org, `${EMAIL_TAG}.${tag}.${RUN}@example.com`, `Ideas ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (suffix) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Marketing ideas fixture') RETURNING id`, [`${SLUG_TAG}-${suffix}-${RUN}`]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg("a");
    orgB = await mkOrg("b");
    ownerA = await staffIn(orgA, "owner", "a.owner");
    tokenOwnerA = ownerA.token;
    tokenAdminA = (await staffIn(orgA, "admin", "a.admin")).token;
    tokenCloserA = (await staffIn(orgA, "closer", "a.closer")).token;
    tokenOwnerB = (await staffIn(orgB, "owner", "b.owner")).token;
    await db.query(
      `INSERT INTO marketing_funnels (org_id, key, name, landing_url, lane)
       VALUES ($1, 'roadmap_147', 'Roadmap $147', 'https://apply.fundhub.ai/roadmap', 'uwiq')`,
      [orgA]
    );
  });

  after(async () => { await cleanup(); await close(); });

  test("no session 401; a closer gets 403 and nothing is saved; owner and admin get in", async () => {
    assert.equal((await call(null)).code, 401);
    const g = await call(tokenCloserA);
    assert.equal(g.code, 403);
    assert.equal(g.body.error, "forbidden");
    const p = await call(tokenCloserA, { method: "POST", body: { request_id: rid("gate"), raw_points: "closer idea" } });
    assert.equal(p.code, 403);
    assert.equal((await ideaRows(orgA)).length, 0);
    assert.equal((await outboxRows(orgA)).length, 0);
    assert.equal((await call(tokenOwnerA)).code, 200);
    assert.equal((await call(tokenAdminA)).code, 200);
    const wrong = await call(tokenOwnerA, { method: "DELETE" });
    assert.equal(wrong.code, 405);
    assert.equal(wrong.headers.Allow, "GET, POST");
  });

  test("POST saves the idea (source chris, status new) and its repo file in one transaction", async () => {
    const id = rid("save");
    const points = "Lenders check the business file too. Show a clean one next to a messy one.";
    const before = wakes;
    const r = await call(tokenOwnerA, {
      method: "POST",
      body: { request_id: id, raw_points: points, script_format: "standard", funnel_key: "roadmap_147" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/ideas", r.body);
    assert.deepEqual(Object.keys(r.body), ["idea"], "no batch without write_now");
    const idea = r.body.idea;
    assert.equal(idea.source, "chris");
    assert.equal(idea.kind, "script");
    assert.equal(idea.status, "new");
    assert.equal(idea.raw_points, points);
    assert.equal(idea.script_format, "standard");
    assert.equal(idea.funnel_key, "roadmap_147");
    assert.equal(idea.script_id, null);

    const rows = await ideaRows(orgA);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, idea.id);
    assert.equal(rows[0].created_by, ownerA.id);
    assert.equal(rows[0].batch_id, null);

    const ob = await outboxRows(orgA);
    assert.equal(ob.length, 1, "one outbox row for the idea's file");
    assert.equal(ob[0].mode, "replace");
    assert.equal(ob[0].op_id, `idea-file:${idea.id}`);
    assert.equal(ob[0].path, ideaFilePath(rows[0]));
    assert.match(ob[0].path, /^marketing\/ads\/ideas\/\d{4}-\d{2}-\d{2}-[0-9a-f]{8}\.md$/);
    assert.equal(ob[0].content, ideaFileContent(rows[0]));
    assert.ok(ob[0].content.includes(points));
    assert.equal(ob[0].committed_sha, null, "waiting for the worker");

    const saved = (await db.query(`SELECT org_id, route, response FROM marketing_requests WHERE request_id = $1`, [id])).rows;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].route, ROUTE);
    assert.deepEqual(saved[0].response, r.body);
    assert.equal(wakes, before + 1, "the worker is woken after the commit");
  });

  test("a repeated request_id answers the same idea and writes once", async () => {
    const id = rid("repeat");
    const body = { request_id: id, raw_points: "Same press twice." };
    const first = await call(tokenOwnerA, { method: "POST", body });
    const second = await call(tokenOwnerA, { method: "POST", body });
    assert.equal(first.code, 200);
    assert.equal(second.code, 200);
    assert.deepEqual(second.body, first.body);
    const ideaId = first.body.idea.id;
    assert.equal((await ideaRows(orgA)).filter((x) => x.raw_points === "Same press twice.").length, 1);
    assert.equal((await outboxRows(orgA)).filter((x) => x.op_id === `idea-file:${ideaId}`).length, 1);

    const otherOrg = await call(tokenOwnerB, { method: "POST", body });
    assert.equal(otherOrg.code, 400);
    assert.equal(otherOrg.body.field, "request_id");
  });

  test("source 'suggestion' with an angle_key saves an accepted planner suggestion", async () => {
    const r = await call(tokenOwnerA, {
      method: "POST",
      body: { request_id: rid("sugg"), raw_points: "Bank turned you down: $212 spend, 2 leads.", source: "suggestion", angle_key: "the_bank_rejected_builder" }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/ideas", r.body);
    assert.equal(r.body.idea.source, "suggestion");
    assert.equal(r.body.idea.angle_key, "the_bank_rejected_builder");
    const row = (await db.query(`SELECT source, angle_key, status FROM ad_ideas WHERE id = $1`, [r.body.idea.id])).rows[0];
    assert.deepEqual(row, { source: "suggestion", angle_key: "the_bank_rejected_builder", status: "new" });
  });

  test("refused with 400 and nothing saved: source 'machine', no points, an unknown funnel", async () => {
    const ideasBefore = (await ideaRows(orgA)).length;
    const outboxBefore = (await outboxRows(orgA)).length;
    const cases = [
      [{ raw_points: "x", source: "machine" }, "source"],
      [{ raw_points: "" }, "raw_points"],
      [{ raw_points: "x", funnel_key: "book_call" }, "funnel_key"],
      [{ raw_points: "x", script_format: "tiktok" }, "script_format"]
    ];
    for (const [body, field] of cases) {
      const r = await call(tokenOwnerA, { method: "POST", body: { request_id: rid("bad"), ...body } });
      assert.equal(r.code, 400, JSON.stringify(r.body));
      assert.equal(r.body.error, "invalid");
      assert.equal(r.body.field, field);
      assert.equal(typeof r.body.message, "string");
    }
    assert.equal((await ideaRows(orgA)).length, ideasBefore);
    assert.equal((await outboxRows(orgA)).length, outboxBefore);
  });

  test("write_now:true also makes the on-command batch and queues start_batch for this idea", async () => {
    const r = await call(tokenOwnerA, {
      method: "POST",
      body: { request_id: rid("now"), raw_points: "Write this one now.", funnel_key: "roadmap_147", write_now: true }
    });
    assert.equal(r.code, 200, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/ideas", r.body);
    assert.ok(r.body.batch_id && r.body.job_id);

    const batch = (await db.query(`SELECT * FROM marketing_batches WHERE id = $1`, [r.body.batch_id])).rows[0];
    assert.equal(batch.org_id, orgA);
    assert.equal(batch.kind, "on_command");
    assert.equal(batch.status, "planned");
    assert.ok(Math.abs(new Date(batch.release_at).getTime() - Date.now()) < 60_000, "release_at is now");
    assert.match(batch.week_key, /^\d{4}-W\d{2}$/);

    const job = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [r.body.job_id])).rows[0];
    assert.equal(job.org_id, orgA);
    assert.equal(job.kind, "start_batch");
    assert.equal(job.status, "queued");
    assert.deepEqual(job.payload, { batch_id: r.body.batch_id, count: 1, funnel_key: "roadmap_147", idea_ids: [r.body.idea.id] });

    const idea = (await db.query(`SELECT status, batch_id FROM ad_ideas WHERE id = $1`, [r.body.idea.id])).rows[0];
    assert.equal(idea.status, "new", "the writer moves it on, not this route");
    assert.equal(idea.batch_id, r.body.batch_id, "the idea is held for this batch");
  });

  test("write_now with the month cap reached: the idea is saved, nothing is queued, a note says why", async () => {
    await db.query(
      `INSERT INTO marketing_model_usage (org_id, model, input_tokens, output_tokens, cost_usd)
       VALUES ($1, 'claude-opus-5-5', 1, 1, 400)`,
      [orgA]
    );
    try {
      const batchesBefore = (await batchRows(orgA)).length;
      const jobsBefore = (await jobRows(orgA)).length;
      const r = await call(tokenOwnerA, {
        method: "POST",
        body: { request_id: rid("cap"), raw_points: "Write this when money allows.", write_now: true }
      });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assertMatchesContract("POST marketing/ideas", r.body);
      assert.equal(r.body.batch_id, undefined);
      assert.equal(r.body.job_id, undefined);
      assert.match(r.body.note, /saved/);
      assert.match(r.body.note, /month cap/);
      assert.equal((await batchRows(orgA)).length, batchesBefore);
      assert.equal((await jobRows(orgA)).length, jobsBefore);
      assert.ok((await ideaRows(orgA)).some((x) => x.id === r.body.idea.id));
    } finally {
      await db.query(`DELETE FROM marketing_model_usage WHERE org_id = $1`, [orgA]);
    }
  });

  test("GET lists newest first, filters by status, and never shows another company's ideas", async () => {
    const written = await call(tokenOwnerA, { method: "POST", body: { request_id: rid("w"), raw_points: "This one got written." } });
    await db.query(`UPDATE ad_ideas SET status = 'written' WHERE id = $1`, [written.body.idea.id]);
    await call(tokenOwnerB, { method: "POST", body: { request_id: rid("b"), raw_points: "Company B's idea." } });

    const all = await call(tokenOwnerA);
    assert.equal(all.code, 200);
    assertMatchesContract("GET marketing/ideas", all.body);
    const mine = await ideaRows(orgA);
    assert.equal(all.body.ideas.length, mine.length);
    assert.ok(!all.body.ideas.some((x) => x.raw_points === "Company B's idea."));
    const times = all.body.ideas.map((x) => Date.parse(x.created_at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a), "newest first");

    const only = await call(tokenOwnerA, { query: { status: "written" } });
    assert.equal(only.code, 200);
    assert.deepEqual(only.body.ideas.map((x) => x.id), [written.body.idea.id]);
    assert.equal(only.body.ideas[0].status, "written");

    const fresh = await call(tokenOwnerA, { query: { status: "new" } });
    assert.ok(fresh.body.ideas.length >= 1);
    assert.ok(fresh.body.ideas.every((x) => x.status === "new"));

    const bad = await call(tokenOwnerA, { query: { status: "done" } });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "status");
  });
});
