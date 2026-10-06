// The research buttons against real Postgres: "Research it" (deep research, J20) and
// "Research the market" (flywheel step 2, J2). Design docs/specs/command-center-design-2026-10-05.md
// §6 slice 10; contract docs/specs/marketing-machine-api.md §6.10. Unit X2. Lives under
// src/http/ because npm test globs src/** and scripts/** only (CLAUDE.md §12); it imports
// the api/ handlers.
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a scratch
// database from db/migrations. Without DATABASE_URL every test skips, and a skipped
// .pg.test.mjs is not green.
//
// NOTHING LEAVES THE MACHINE. The model is a fake (src/marketing/research/fixtures), the
// worker is never woken (wake is a recorder), GitHub has no token (reads fall back to the
// bundled flywheel files; the outbox is never drained), Company Brain is a stub, and
// globalThis.fetch fails the test if anything is sent. Two companies of its own (slugs
// mresearch-pg-a, mresearch-pg-b); everything is removed after.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import research from "../../api/marketing/research.mjs";
import approve from "../../api/marketing/research/approve.mjs";
import tweak from "../../api/marketing/research/tweak.mjs";
import brain from "../../api/marketing/research/brain.mjs";
import flywheelRun from "../../api/marketing/flywheel/run.mjs";
import { assertMatchesContract } from "../marketing/api-contract.mjs";
import { claimJobs, finishJob, failJob, retryJob } from "../marketing/jobs.mjs";
import * as deep from "../marketing/research/deep-research.mjs";
import * as stageJob from "../marketing/flywheel/stage-job.mjs";
import { fakeResearchModel } from "../marketing/research/fixtures/fake-model.mjs";
import { fakeMarketModel } from "../marketing/research/fixtures/fake-market-model.mjs";
import { splitFrontMatter, parseFrontMatter, bodyHash } from "../../scripts/flywheel/status.mjs";
import fs from "node:fs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG_A = "mresearch-pg-a";
const SLUG_B = "mresearch-pg-b";
const EMAIL_TAG = "mresearch_pg_test";
const ENV = Object.freeze({ ANTHROPIC_API_KEY: "test-key-not-a-real-anthropic-key" });
const VAULT_DOC = {
  path: "marketing/knowledge/hormozi/alex-hormozi-library/100m-offers.md",
  title: "$100M Offers",
  text: "# $100M Offers\n\nThe offer is the thing that matters most for a funding broker. Make the offer so good people feel stupid saying no."
};

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

const wakes = [];
const fakeWake = async () => { wakes.push(1); return { ok: true, started: false, skipped: "test" }; };

async function call(h, token, { method = "POST", body, query = {}, env = ENV, deps = {} } = {}) {
  const r = res();
  await h({ method, headers: token ? { authorization: "Bearer " + token } : {}, query, body }, r, { db, env, wake: fakeWake, ...deps });
  if (r.body !== null) r.body = JSON.parse(JSON.stringify(r.body));
  return r;
}

let reqN = 0;
const rid = () => `mresearch-pg-${process.pid}-${Date.now()}-${++reqN}`;

/** Drive one job the way the worker does: claim it, run its handler, finish or fail it. */
async function drive(id, kind, mod, deps, { maxClaims = 80, between } = {}) {
  for (let i = 0; i < maxClaims; i++) {
    const row = (await db.query(`SELECT status FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
    if (row.status === "done" || row.status === "failed") return (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
    if (between) await between(i);
    await db.query(`UPDATE marketing_jobs SET run_after = now() WHERE id = $1 AND status = 'queued'`, [id]);
    const claimed = await claimJobs(db, { limit: 5, kinds: [kind] });
    const job = claimed.find((j) => j.id === id);
    assert.ok(job, `claim ${i} got the job`);
    for (const other of claimed) if (other.id !== id) await db.query(`UPDATE marketing_jobs SET status = 'queued', claimed_at = NULL WHERE id = $1`, [other.id]);
    try {
      const out = await mod.run(job, { db, env: ENV, deps });
      await finishJob(db, id, out);
    } catch (err) {
      await failJob(db, id, err, { final: !!(err && err.final) });
    }
  }
  throw new Error(`job ${id} did not finish in ${maxClaims} claims`);
}

/** Run fn with a fetch that records and refuses every call. */
async function withNoNetwork(fn) {
  const real = globalThis.fetch;
  const hits = [];
  globalThis.fetch = /** @type {any} */ (async (url) => { hits.push(String(url)); throw new Error("network is off in this test"); });
  try { return { out: await fn(), hits }; }
  finally { globalThis.fetch = real; }
}

describe("research buttons (real Postgres)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, ownerA, adminA, closerA, ownerB;

  async function cleanup() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      await db.query(`DELETE FROM marketing_model_usage WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_buzzes WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM repo_outbox WHERE org_id = ANY($1)`, [orgs]);
      await db.query(`DELETE FROM marketing_jobs WHERE org_id = ANY($1)`, [orgs]);
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
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Research ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Research fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;

  before(async () => {
    await cleanup();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    ownerA = await staffIn(orgA, "owner", "a.owner");
    adminA = await staffIn(orgA, "admin", "a.admin");
    closerA = await staffIn(orgA, "closer", "a.closer");
    ownerB = await staffIn(orgB, "owner", "b.owner");
  });

  after(async () => { await cleanup(); await close(); });

  const deepDeps = () => {
    const model = fakeResearchModel();
    return { model, deps: { callModel: model.callModel, loadVault: () => [VAULT_DOC], readVaultFile: (p) => (p === VAULT_DOC.path ? VAULT_DOC.text : null) } };
  };

  // ── migration 429 ─────────────────────────────────────────────────────────

  test("migration 429: the columns, the two in-flight indexes and the checks", async () => {
    const cols = (await db.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'marketing_jobs' AND column_name IN ('approved_by', 'approved_at'))
            OR (table_name = 'marketing_settings' AND column_name IN ('max_research_cost_usd', 'research_shares_month_cap'))
            OR (table_name = 'marketing_model_usage' AND column_name IN ('web_search_requests', 'web_fetch_requests', 'step')))`
    )).rows;
    assert.equal(cols.length, 7, JSON.stringify(cols));
    const idx = (await db.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'marketing_jobs'
          AND indexname IN ('marketing_jobs_one_research_in_flight_uq', 'marketing_jobs_one_flywheel_stage_in_flight_uq')`
    )).rows;
    assert.equal(idx.length, 2);

    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, status, result) VALUES ($1, 'deep_research', 'done', '{"report":{"markdown":"  "}}')`, [orgB]),
      /marketing_jobs_research_report_ck/, "a finished research run must hold a report with words in it"
    );
    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'flywheel_stage', '{"stage":2}')`, [orgB]),
      /marketing_jobs_flywheel_stage_payload_ck/, "a flywheel stage run names its campaign"
    );
    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, approved_at) VALUES ($1, 'deep_research', now())`, [orgB]),
      /marketing_jobs_approved_done_ck/, "only a finished run can be approved"
    );
    await assert.rejects(
      db.query(`INSERT INTO marketing_settings (org_id, max_research_cost_usd) VALUES ($1, 0)`, [orgB]),
      /marketing_settings_research_cap_ck/, "a stop amount of $0 is refused"
    );
    const s = (await db.query(`INSERT INTO marketing_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO UPDATE SET org_id = EXCLUDED.org_id RETURNING max_research_cost_usd, research_shares_month_cap`, [orgB])).rows[0];
    assert.equal(s.max_research_cost_usd, null, "no stop amount is invented");
    assert.equal(s.research_shares_month_cap, true);
    await db.query(`DELETE FROM marketing_settings WHERE org_id = $1`, [orgB]);
  });

  // ── POST marketing/research ───────────────────────────────────────────────

  test("the gate: no session 401, a closer 403; no Anthropic key 503 no_model; nothing queued", async () => {
    const body = { request_id: rid(), question: "Who sells broker programs?", max_cost_usd: 5 };
    assert.equal((await call(research, null, { body })).code, 401);
    const r = await call(research, closerA.token, { body });
    assert.equal(r.code, 403);
    const nk = await call(research, ownerA.token, { body, env: { ANTHROPIC_API_KEY: "****************abcd" } });
    assert.equal(nk.code, 503);
    assert.deepEqual(nk.body, { error: "no_model", message: "No Anthropic key is set on the site. An agent must set it." });
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgA])).rows[0].n;
    assert.equal(n, 0);
  });

  test("400 bad_question: no question, no place to look, no stop amount (Settings blank)", async () => {
    const a = await call(research, ownerA.token, { body: { request_id: rid(), question: " ", max_cost_usd: 5 } });
    assert.equal(a.code, 400);
    assert.deepEqual(a.body, { error: "bad_question", field: "question", message: "Type the question first." });
    const b = await call(research, ownerA.token, { body: { request_id: rid(), question: "Who sells programs?", max_cost_usd: 5, sources: { web: false, vault: false } } });
    assert.equal(b.body.field, "sources");
    const c = await call(research, ownerA.token, { body: { request_id: rid(), question: "Who sells programs?" } });
    assert.deepEqual(c.body, { error: "bad_question", field: "max_cost_usd", message: "Type a stop amount first." });
    const d = await call(research, ownerA.token, { body: { request_id: rid(), question: "Who sells programs?", depth: "medium", max_cost_usd: 5 } });
    assert.equal(d.code, 400);
    assert.equal(d.body.field, "depth");
  });

  let researchId;

  test("202: queued with the contract shape; a second tap is the same run; the same request_id answers the same", async () => {
    const body = { request_id: rid(), question: "Who sells business funding broker programs and for how much?", depth: "quick", sources: { web: true, vault: true, own_files: false }, max_cost_usd: 5 };
    const r = await call(research, ownerA.token, { body });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/research", r.body);
    assert.equal(r.body.started, true);
    assert.equal(r.body.job.status, "queued");
    assert.equal(r.body.job.step_word, "Waiting to start. It runs in the background.");
    researchId = r.body.job.id;
    const again = await call(research, adminA.token, { body: { ...body, request_id: rid() } });
    assert.equal(again.code, 202);
    assert.equal(again.body.already_running, true);
    assert.equal(again.body.job.id, researchId, "one run in flight per company");
    const replay = await call(research, ownerA.token, { body });
    assert.deepEqual(replay.body, r.body, "a repeated request_id answers the saved body");
    const n = (await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1 AND kind = 'deep_research'`, [orgA])).rows[0].n;
    assert.equal(n, 1);
    const row = (await db.query(`SELECT requested_by, payload FROM marketing_jobs WHERE id = $1`, [researchId])).rows[0];
    assert.equal(row.requested_by, ownerA.id);
    assert.match(row.payload.today, /^\d{4}-\d{2}-\d{2}$/);
  });

  test("the run goes through its saved steps to a cited report, saved through the outbox, with every call on the ledger", async () => {
    const { model, deps } = deepDeps();
    const { out: done, hits } = await withNoNetwork(() => drive(researchId, "deep_research", deep, deps));
    assert.deepEqual(hits, [], "nothing left the machine");
    assert.equal(done.status, "done", done.error);
    assert.equal(done.attempts, 0);
    const rep = done.result.report;
    assert.ok(rep.markdown.includes("## How this was checked"));
    assert.ok(!rep.markdown.includes("made-up.example"), "a link the run never read is removed");
    assert.match(rep.repo_path, new RegExp(`^marketing/research/\\d{4}-\\d{2}-\\d{2}-who-sells-business-funding-broker-${researchId.slice(0, 8)}/report\\.md$`));
    const ob = (await db.query(`SELECT path, mode, content, committed_sha FROM repo_outbox WHERE org_id = $1 ORDER BY id`, [orgA])).rows;
    assert.deepEqual(ob.map((o) => o.path.split("/").pop()), ["report.md", "sources.json"]);
    assert.ok(ob.every((o) => o.mode === "replace" && o.committed_sha === null));
    const src = JSON.parse(ob[1].content);
    assert.ok(src.findings.length > 0 && src.findings.every((f) => /^https:\/\/good\.example\//.test(f.source) || f.source.startsWith("marketing/knowledge/hormozi/")));
    const usage = (await db.query(`SELECT step, web_search_requests, cost_usd FROM marketing_model_usage WHERE job_id = $1`, [researchId])).rows;
    assert.equal(usage.length, model.calls.length, "one ledger row per call");
    assert.ok(usage.some((u) => u.step === "sweep-r1-q1" && u.web_search_requests === 3));
    assert.ok(usage.every((u) => u.cost_usd != null && Number(u.cost_usd) > 0));
    const buzz = (await db.query(`SELECT kind, body FROM marketing_buzzes WHERE org_id = $1`, [orgA])).rows;
    assert.deepEqual(buzz.map((b) => b.kind), ["research_ready"]);
  });

  test("GET: the list (contract shape, limits computed), one run with its report, another company's run is 404", async () => {
    const list = await call(research, ownerA.token, { method: "GET" });
    assert.equal(list.code, 200, JSON.stringify(list.body));
    assertMatchesContract("GET marketing/research", list.body);
    assert.equal(list.body.runs[0].id, researchId);
    assert.match(list.body.runs[0].step_word, /^Done, \d+ of \d+ key claims held up$/);
    assert.deepEqual([list.body.limits.quick.searches, list.body.limits.quick.search_usd], [62, 0.62]);
    assert.deepEqual([list.body.limits.deep.searches, list.body.limits.deep.search_usd], [542, 5.42]);
    assert.equal(list.body.settings.measured, true, "a finished Quick look is measured");
    assert.ok(list.body.settings.last_run.quick.cost_usd > 0);
    assert.equal(list.body.settings.max_research_cost_usd, null);

    const one = await call(research, ownerA.token, { method: "GET", query: { id: researchId } });
    assert.equal(one.code, 200);
    assert.deepEqual(Object.keys(one.body), ["ok", "job", "report"]);
    assert.equal(one.body.report.repo_state.words, "Saved. Reaching the repo…");
    assert.ok(one.body.report.key_verified >= 1);
    assert.ok(Array.isArray(one.body.report.unreachable));

    const other = await call(research, ownerB.token, { method: "GET", query: { id: researchId } });
    assert.equal(other.code, 404);
    const listB = await call(research, ownerB.token, { method: "GET" });
    assert.deepEqual(listB.body.runs, [], "another company never sees this company's runs");
  });

  test("approve: a person's tap, stored with who and when, the file saved again as approved; twice changes nothing", async () => {
    const a = await call(approve, ownerA.token, { body: { request_id: rid(), id: researchId } });
    assert.equal(a.code, 200, JSON.stringify(a.body));
    assertMatchesContract("POST marketing/research/approve", a.body);
    assert.equal(a.body.job.approved, true);
    const row = (await db.query(`SELECT approved_by, approved_at FROM marketing_jobs WHERE id = $1`, [researchId])).rows[0];
    assert.equal(row.approved_by, ownerA.id);
    assert.ok(row.approved_at);
    const files = (await db.query(`SELECT op_id, content FROM repo_outbox WHERE org_id = $1 AND op_id LIKE '%approved'`, [orgA])).rows;
    assert.equal(files.length, 1);
    assert.match(files[0].content, /\nstatus: approved\n/);
    const b = await call(approve, adminA.token, { body: { request_id: rid(), id: researchId } });
    assert.equal(b.code, 200);
    const again = (await db.query(`SELECT approved_by FROM marketing_jobs WHERE id = $1`, [researchId])).rows[0];
    assert.equal(again.approved_by, ownerA.id, "the first approval stands");
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE org_id = $1 AND op_id LIKE '%approved'`, [orgA])).rows[0].n, 1);
    const b2 = await call(approve, ownerB.token, { body: { request_id: rid(), id: researchId } });
    assert.equal(b2.code, 404);
  });

  test("brain: saves through the brain helper; a refusal is 503 brain_unavailable in plain words", async () => {
    const seen = [];
    const ok = await call(brain, ownerA.token, {
      body: { request_id: rid(), id: researchId },
      deps: { upsertGeneratedDocument: async (_db, a) => { seen.push(a); return { ok: true, fileId: "00000000-0000-4000-8000-000000000d04", chunkCount: 3 }; } }
    });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assertMatchesContract("POST marketing/research/brain", ok.body);
    assert.equal(seen[0].sourceType, "deep-research");
    assert.equal(seen[0].sourceKey, researchId);
    assert.equal(seen[0].accessTier, "owner");
    const no = await call(brain, ownerA.token, {
      body: { request_id: rid(), id: researchId },
      deps: { upsertGeneratedDocument: async () => ({ ok: false, reason: "openai 429: insufficient_quota" }) }
    });
    assert.equal(no.code, 503);
    assert.deepEqual(no.body, { error: "brain_unavailable", message: "The brain cannot save new pages right now: its embedding key has no credit." });
  });

  test("tweak: a short re-run of the same question that goes deeper on the note; the first run is kept", async () => {
    const t = await call(tweak, ownerA.token, { body: { request_id: rid(), id: researchId, note: "go deeper on bank overlays" } });
    assert.equal(t.code, 202, JSON.stringify(t.body));
    assertMatchesContract("POST marketing/research/tweak", t.body);
    const row = (await db.query(`SELECT payload FROM marketing_jobs WHERE id = $1`, [t.body.job.id])).rows[0];
    assert.equal(row.payload.focus, "go deeper on bank overlays");
    assert.equal(row.payload.parent_id, researchId);
    assert.equal(row.payload.depth, "quick");
    const first = (await db.query(`SELECT status, approved_at FROM marketing_jobs WHERE id = $1`, [researchId])).rows[0];
    assert.equal(first.status, "done");
    const busy = await call(tweak, ownerA.token, { body: { request_id: rid(), id: t.body.job.id, note: "x y z" } });
    assert.equal(busy.code, 400, "a run that is still going cannot be tweaked");
    await db.query(`DELETE FROM marketing_jobs WHERE id = $1`, [t.body.job.id]);
  });

  test("the month cap: a month already spent refuses a new run with 400 cap_reached and saves nothing", async () => {
    await db.query(`INSERT INTO marketing_model_usage (org_id, model, cost_usd) VALUES ($1, 'claude-opus-5-5', 300)`, [orgB]);
    const r = await call(research, ownerB.token, { body: { request_id: rid(), question: "Anything at all?", max_cost_usd: 5 } });
    assert.equal(r.code, 400);
    assert.deepEqual(r.body, { error: "cap_reached", message: "Stopped at the $300 month cap. Raise it in Settings or wait for next month." });
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgB])).rows[0].n, 0);
    await db.query(`DELETE FROM marketing_model_usage WHERE org_id = $1`, [orgB]);
  });

  // ── POST marketing/flywheel/run (stage 2) ─────────────────────────────────

  test("flywheel/run: a step this route does not start, a bad name and a missing folder are refused in words", async () => {
    const s1 = await call(flywheelRun, ownerA.token, { body: { request_id: rid(), campaign: "partner", stage: 1 } });
    assert.equal(s1.code, 400);
    assert.equal(s1.body.field, "stage");
    const bad = await call(flywheelRun, ownerA.token, { body: { request_id: rid(), campaign: "../x", stage: 2 } });
    assert.equal(bad.body.field, "campaign");
    const none = await call(flywheelRun, ownerA.token, { body: { request_id: rid(), campaign: "no-such-flywheel", stage: 2 } });
    assert.equal(none.code, 400);
    assert.equal(none.body.error, "bad_campaign");
  });

  let marketId;

  test("flywheel/run stage 2: 202 queued (contract shape), one in flight per campaign", async () => {
    const body = { request_id: rid(), campaign: "partner", stage: 2, competitors: ["Fund&Grow"] };
    const r = await call(flywheelRun, ownerA.token, { body });
    assert.equal(r.code, 202, JSON.stringify(r.body));
    assertMatchesContract("POST marketing/flywheel/run", r.body);
    marketId = r.body.job.job_id;
    assert.equal(r.body.job.campaign_words, "Partner offer");
    const again = await call(flywheelRun, ownerA.token, { body: { ...body, request_id: rid() } });
    assert.equal(again.body.already_running, true);
    assert.equal(again.body.job.job_id, marketId);
  });

  test("market research stops at its run cap with what it found saved, then Resume (retry_job_id) finishes it", async () => {
    const model = fakeMarketModel();
    const deps = { callModel: model.callModel };
    await db.query(`INSERT INTO marketing_settings (org_id, max_batch_cost_usd) VALUES ($1, 1)
                    ON CONFLICT (org_id) DO UPDATE SET max_batch_cost_usd = 1`, [orgA]);
    // After step 1, pretend 60 cents were spent: with the board's reserve held back, a $1 cap
    // has no room for a sweep call.
    const { out: stopped, hits } = await withNoNetwork(() => drive(marketId, "flywheel_stage", stageJob, deps, {
      between: async (i) => {
        if (i === 1) await db.query(`INSERT INTO marketing_model_usage (org_id, job_id, model, cost_usd, step) VALUES ($1, $2, 'claude-opus-5-5', 0.6, 'test-spend')`, [orgA, marketId]);
      }
    }));
    assert.deepEqual(hits, []);
    assert.equal(stopped.status, "failed");
    assert.equal(stopped.error, "Stopped at the $1 run cap after step 1. What it found so far is saved.");
    assert.equal(stopped.result.step, "sweep");
    assert.ok(stopped.result.steps.plan.done_at);
    const before = model.calls.length;

    // Resume: raise the cap, tap Resume. The saved steps are kept (retryJob keeps a checkpoint).
    await db.query(`UPDATE marketing_settings SET max_batch_cost_usd = 40 WHERE org_id = $1`, [orgA]);
    const resume = await call(flywheelRun, ownerA.token, { body: { request_id: rid(), campaign: "partner", stage: 2, retry_job_id: marketId } });
    assert.equal(resume.code, 202, JSON.stringify(resume.body));
    assert.equal(resume.body.resumed, true);
    const kept = (await db.query(`SELECT status, result FROM marketing_jobs WHERE id = $1`, [marketId])).rows[0];
    assert.equal(kept.status, "queued");
    assert.equal(kept.result.step, "sweep", "Resume carries on from the step that stopped");

    const { out: done } = await withNoNetwork(() => drive(marketId, "flywheel_stage", stageJob, deps));
    assert.equal(done.status, "done", done.error);
    assert.equal(model.calls.slice(before).filter((c) => c.label === "reach" || c.label === "plan").length, 0, "step 1 was not paid for twice");

    // The stage file, stamped with the avatar hash from the bundled copy (no GitHub token here).
    const file = (await db.query(`SELECT content FROM repo_outbox WHERE org_id = $1 AND path = 'marketing/flywheel/partner/02-ad-research.md'`, [orgA])).rows[0];
    assert.ok(file, "02-ad-research.md queued through the outbox");
    const fm = parseFrontMatter(splitFrontMatter(file.content).frontMatter);
    assert.equal(fm.stage, 2);
    assert.equal(fm.status, "draft");
    const bundledAvatar = fs.readFileSync(new URL("../../marketing/flywheel/partner/01-avatar.md", import.meta.url), "utf8");
    assert.equal(fm.inputs["01-avatar.md"], bodyHash(bundledAvatar));
    assert.equal(done.result.board.inputs_source, "bundle-fallback");
    assert.match(file.content, /## Review card/);
    const buzz = (await db.query(`SELECT body FROM marketing_buzzes WHERE org_id = $1 AND kind = 'flywheel_ready'`, [orgA])).rows;
    assert.deepEqual(buzz.map((b) => b.body), ["The market research for Partner offer is ready to read."]);
  });

  test("retryJob keeps a saved-step checkpoint and still clears any other result", async () => {
    const cp = (await db.query(
      `INSERT INTO marketing_jobs (org_id, kind, payload, status, error, result)
       VALUES ($1, 'deep_research', '{"question":"q"}', 'failed', 'stopped', '{"v":1,"steps":{"plan":{"attempts":0}},"state":{"x":1}}')
       RETURNING id`, [orgB]
    )).rows[0].id;
    const r = await retryJob(db, { orgId: orgB, id: cp, kinds: ["deep_research"] });
    assert.deepEqual(r.result.state, { x: 1 });
    await db.query(`DELETE FROM marketing_jobs WHERE id = $1`, [cp]);
  });
});
