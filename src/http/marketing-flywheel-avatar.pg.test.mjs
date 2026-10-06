// Build the avatar on the server (design slice 5a, unit X1), against real Postgres:
// migration 418, POST marketing/flywheel/run, the worker running one saved step per
// claim, the run cap, Retry, GET marketing/costs, GET marketing/flywheel, GET
// marketing/flywheel/job, Approve, Tweak and Start a flywheel. Lives under src/http/
// because npm test globs src/** and scripts/** only (CLAUDE.md §12).
//
// WAVE 2B MERGE. X3 built the same flywheel routes; the merge keeps X3's GET, Approve,
// Start a flywheel and stages 3-6, and hands step 1 of run and tweak to X1's code. This
// file (renamed from X3's file name, which X3's own test keeps) reads the merged answers:
// stages[].state is X3's (the status script's MISSING / READY / ...), a step with no
// file to approve is X3's 400 on stage, and a new flywheel's folder is X3's name for the
// offer (FUNDING_DFY -> funding-done-for-you).
//
// Never pointed at the live database (CLAUDE.md §12, spec §0.7): CI builds a scratch
// database from db/migrations. Without DATABASE_URL every test skips, and a skipped
// .pg.test.mjs is not green.
//
// NOTHING LEAVES THE MACHINE. The model is a fake; there is no GITHUB_REPO_TOKEN, so the
// outbox is never drained here; wakes are fakes; globalThis.fetch is swapped for a spy
// that fails the test if anything is sent. TWO COMPANIES OF ITS OWN (slugs
// mflywheel-pg-a, mflywheel-pg-b); everything is removed after.

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { db, close } from "../db.mjs";
import { createSession } from "../auth/session.mjs";
import runRoute from "../../api/marketing/flywheel/run.mjs";
import jobRoute from "../../api/marketing/flywheel/job.mjs";
import flywheelRoute from "../../api/marketing/flywheel.mjs";
import approveRoute from "../../api/marketing/flywheel/approve.mjs";
import tweakRoute from "../../api/marketing/flywheel/tweak.mjs";
import campaignRoute from "../../api/marketing/flywheel/campaign.mjs";
import costsRoute from "../../api/marketing/costs.mjs";
import { claimJobs, finishJob, failJob } from "../marketing/jobs.mjs";
import { run } from "../marketing/avatar/run.mjs";
import { runPass } from "../marketing/worker.mjs";
import { DESIRE_SOURCES, INFO_SOURCES } from "../marketing/avatar/prompts.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const SLUG_A = "mflywheel-pg-a";
const SLUG_B = "mflywheel-pg-b";
const EMAIL_TAG = "mflywheel_pg_test";
const ENV = Object.freeze({ ANTHROPIC_API_KEY: "test-key-not-real" });

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = JSON.parse(JSON.stringify(b)); return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; return r; };
  return r;
};

let wakes = 0;
const wake = async () => { wakes += 1; return { started: true }; };

async function call(handler, token, { method = "GET", body, query = {}, env = ENV } = {}) {
  const r = res();
  await handler({ method, headers: token ? { authorization: "Bearer " + token } : {}, query, body }, r, { db, env, wake });
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

/* ── a fake model that answers by which SOP prompt it was sent ── */
const famUrl = (i, k) => `https://pg-forum${i}.example.com/t/${k}`;
const famQuote = (i, k) => `pg family ${i} broker says my funder went around me on deal ${k}`;
function fakeModel() {
  const calls = [];
  const callModel = async (args) => {
    const u = String(args.user || "");
    const usage = { input_tokens: 2000, output_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 };
    let kind = "write";
    if (u.includes("PROMPT 4 OF 7")) kind = "desire";
    else if (u.includes("PROMPT 6 OF 7")) kind = "info";
    else if (u.includes("Adversarially review")) kind = "verify";
    calls.push(kind);
    if (kind === "desire") {
      const i = DESIRE_SOURCES.findIndex((s) => u.includes(s));
      const json = { findings: "notes", quotes: [
        { quote: famQuote(i, 1), source: famUrl(i, 1), tag: "pain" },
        { quote: "an invented line with a link nobody searched for", source: "https://nowhere-invented.example.org/x" }
      ], nothingNew: false };
      return { error: null, usage: { ...usage, web_search_requests: 3 }, servedModel: "claude-sonnet-5-5", content: [
        { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: famUrl(i, 1), title: "t" }] },
        { type: "text", text: "x", citations: [{ type: "web_search_result_location", url: famUrl(i, 1), cited_text: famQuote(i, 1) }] },
        { type: "text", text: JSON.stringify(json) }
      ] };
    }
    if (kind === "info") {
      const i = INFO_SOURCES.findIndex((s) => u.includes(s));
      return { error: null, usage: { ...usage, web_search_requests: 1 }, servedModel: "claude-sonnet-5-5", content: [
        { type: "web_search_tool_result", tool_use_id: "s", content: [{ type: "web_search_result", url: `https://pg-report${i}.example.org/a`, title: "r" }] },
        { type: "text", text: JSON.stringify({ findings: [{ source: `https://pg-report${i}.example.org/a`, information: `fact ${i}` }] }) }
      ] };
    }
    if (kind === "verify") return { error: null, usage, servedModel: "claude-sonnet-5-5", json: { problems: [], fabricatedQuotes: [], passed: true }, content: [] };
    const text = u.includes("PROMPT 7 OF 7") ? "# Core_Avatar_Profile.md\n\n## Avatar Name: \"Pg Pete\"\n" : `# Doc\n\n${u.slice(0, 40).replace(/\s+/g, " ")}`;
    return { error: null, usage, servedModel: "claude-opus-5-5", text, content: [{ type: "text", text }] };
  };
  return { calls, callModel };
}

/** One worker claim, the way the worker does it: claim → run → finish or fail. */
async function workerClaim(model) {
  const [job] = await claimJobs(db, { limit: 1, kinds: ["avatar"] });
  if (!job) return null;
  try {
    const out = await run(job, { db, env: ENV, deps: { callModel: model.callModel } });
    await finishJob(db, job.id, out);
  } catch (err) {
    await failJob(db, job.id, err, { final: !!(err && err.final === true) });
  }
  return job;
}

describe("Build the avatar on the server (real Postgres)", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let orgA, orgB, ownerA, closerA, ownerB;

  async function cleanup() {
    const orgs = (await db.query(`SELECT id FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]])).rows.map((r) => r.id);
    if (orgs.length) {
      for (const t of ["marketing_model_usage", "marketing_buzzes", "marketing_jobs", "repo_outbox", "marketing_heartbeats", "marketing_requests", "marketing_settings"]) {
        await db.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [orgs]);
      }
    }
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
    try { await db.query(`DELETE FROM orgs WHERE slug = ANY($1)`, [[SLUG_A, SLUG_B]]); } catch { /* reused next run */ }
  }

  async function staffIn(org, role, tag) {
    const row = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status) VALUES ($1,$2,$3,$4,'active') RETURNING id`,
      [org, `${EMAIL_TAG}.${tag}@example.com`, `Flywheel ${tag}`, role]
    )).rows[0];
    return { id: row.id, token: (await createSession(db, { staffId: row.id, orgId: org })).token };
  }

  const mkOrg = async (slug) => (await db.query(
    `INSERT INTO orgs (slug, name) VALUES ($1, 'Flywheel fixture')
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`, [slug]
  )).rows[0].id;

  const rid = (s) => `x1-${s}-${Math.random().toString(36).slice(2, 10)}`;

  before(async () => {
    await cleanup();
    orgA = await mkOrg(SLUG_A);
    orgB = await mkOrg(SLUG_B);
    ownerA = await staffIn(orgA, "owner", "a.owner");
    closerA = await staffIn(orgA, "closer", "a.closer");
    ownerB = await staffIn(orgB, "owner", "b.owner");
  });

  after(async () => { await cleanup(); await close(); });

  // ── migration 418 ─────────────────────────────────────────────────────────

  test("migration 418: an avatar row must name its campaign and step; one run in flight per campaign", async (t) => {
    // Whatever this test leaves behind must never reach the worker claims below.
    t.after(() => db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgB]));
    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"step":"foundation"}')`, [orgB]),
      (e) => e.code === "23514" && /marketing_jobs_avatar_payload_ck/.test(e.message)
    );
    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"campaign":"partner"}')`, [orgB]),
      (e) => e.code === "23514"
    );
    await db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"campaign":"partner","step":"foundation"}')`, [orgB]);
    await assert.rejects(
      db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"campaign":"partner","step":"foundation"}')`, [orgB]),
      (e) => e.code === "23505" && /marketing_jobs_one_avatar_in_flight_uq/.test(e.message)
    );
    // Another campaign, or the same campaign once the first run is over, is fine.
    await db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"campaign":"funding-dfy","step":"foundation"}')`, [orgB]);
    await db.query(`UPDATE marketing_jobs SET status = 'done', result = '{}' WHERE org_id = $1 AND payload->>'campaign' = 'partner'`, [orgB]);
    await db.query(`INSERT INTO marketing_jobs (org_id, kind, payload) VALUES ($1, 'avatar', '{"campaign":"partner","step":"foundation"}')`, [orgB]);
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgB]);

    await db.query(`INSERT INTO marketing_settings (org_id) VALUES ($1) ON CONFLICT DO NOTHING`, [orgB]);
    const s = (await db.query(`SELECT run_caps FROM marketing_settings WHERE org_id = $1`, [orgB])).rows[0];
    assert.deepEqual(s.run_caps, { avatar: 20 });
    const cols = (await db.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'marketing_model_usage' AND column_name = ANY($1)`,
      [["web_search_requests", "web_fetch_requests", "step"]]
    )).rows.map((r) => r.column_name).sort();
    assert.deepEqual(cols, ["step", "web_fetch_requests", "web_search_requests"]);
  });

  // ── the gate ──────────────────────────────────────────────────────────────

  test("owner and admin only; a bad campaign, another stage and no key are refused in words", async () => {
    assert.equal((await call(runRoute, null, { method: "POST", body: {} })).code, 401);
    assert.equal((await call(runRoute, closerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("c") } })).code, 403);
    assert.equal((await call(costsRoute, closerA.token)).code, 403);
    const bad = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "../../.env", stage: 1, request_id: rid("b") } });
    assert.equal(bad.code, 400);
    assert.equal(bad.body.field, "campaign");
    // Wave 2b merge: step 2 now runs (unit X2), so "another stage" is one past the last.
    const s2 = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 7, request_id: rid("s") } });
    assert.equal(s2.code, 400);
    assert.equal(s2.body.field, "stage");
    const nokey = await call(runRoute, ownerA.token, { method: "POST", env: {}, body: { campaign: "partner", stage: 1, request_id: rid("k") } });
    assert.equal(nokey.code, 503);
    assert.equal(nokey.body.error, "no_model");
    const none = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "no-offer-here", stage: 1, request_id: rid("n") } });
    assert.equal(none.code, 400);
    assert.equal(none.body.field, "service_description");
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM marketing_jobs WHERE org_id = $1`, [orgA])).rows[0].n, 0, "nothing was queued");
  });

  // ── the run ───────────────────────────────────────────────────────────────

  test("POST run queues one saved-step job; a second tap gets the same run; the worker runs one step per claim; finished steps never re-run", async () => {
    const before = await call(costsRoute, ownerA.token);
    assert.equal(before.code, 200);
    assert.equal(before.body.kinds.avatar, null, "unknown, not measured yet");
    assert.match(before.body.avatar_line, /^Cost: unknown, not measured yet\. This run stops by itself at \$20/);
    assert.equal(before.body.limits.avatar.max_searches, 184);

    const requestId = rid("run");
    wakes = 0;
    const first = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: requestId } });
    assert.equal(first.code, 202);
    assert.equal(first.body.started, true);
    assert.equal(first.body.job.status, "queued");
    assert.equal(first.body.job.step, "foundation");
    assert.match(first.body.job.sentence, /^Running: step 1 of 10, writing down the business facts\./);
    assert.equal(wakes, 1, "the worker is woken after the commit");
    const again = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("run2") } });
    assert.equal(again.body.already_running, true);
    assert.equal(again.body.job.id, first.body.job.id);
    assert.equal(again.body.message, "The avatar is already being built. This is that run.");
    const replay = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: requestId } });
    assert.deepEqual(replay.body, first.body, "the same request_id answers the first answer again");
    const job = (await db.query(`SELECT * FROM marketing_jobs WHERE id = $1`, [first.body.job.id])).rows[0];
    assert.equal(job.kind, "avatar");
    assert.equal(Number(job.payload.run_cap_usd), 20);
    assert.match(job.payload.service_description, /^The Fundhub \$10,000 white-label partnership/);

    const model = fakeModel();
    const { hits } = await withNoNetwork(async () => {
      // Claim 1: step 1 only.
      await workerClaim(model);
      let row = (await db.query(`SELECT status, payload FROM marketing_jobs WHERE id = $1`, [job.id])).rows[0];
      assert.equal(row.status, "queued", "handed back to the queue between steps");
      assert.equal(row.payload.step, "overview");
      assert.deepEqual(model.calls, ["write"]);
      // A re-claim of a step already done (a crash between saving and moving on) calls nothing for it.
      await db.query(`UPDATE marketing_jobs SET payload = jsonb_set(payload, '{step}', '"foundation"') WHERE id = $1`, [job.id]);
      await workerClaim(model);
      assert.deepEqual(model.calls, ["write", "write"], "foundation was not paid for twice; the claim ran overview");
      // The poll while it runs.
      const poll = await call(jobRoute, ownerA.token, { query: { id: job.id } });
      assert.equal(poll.code, 200);
      assert.equal(poll.body.job.step, "quotes");
      assert.equal(poll.body.job.steps.length, 10);
      assert.deepEqual(poll.body.job.steps.slice(0, 2).map((s) => s.status), ["done", "done"]);
      assert.ok(poll.body.job.cost_so_far_usd > 0, "the spend so far is read from the ledger");
      assert.match(poll.body.job.sentence, /^Running: step 3 of 10, searching the web for buyer quotes, round 1\./);
      // Another company cannot read it.
      assert.equal((await call(jobRoute, ownerB.token, { query: { id: job.id } })).code, 404);
      // The rest of the run.
      for (let i = 0; i < 30; i++) {
        const r = (await db.query(`SELECT status FROM marketing_jobs WHERE id = $1`, [job.id])).rows[0];
        if (r.status !== "queued") break;
        await workerClaim(model);
      }
      row = (await db.query(`SELECT status, payload, result FROM marketing_jobs WHERE id = $1`, [job.id])).rows[0];
      assert.equal(row.status, "done");
      assert.equal(row.payload.step, "done");
      assert.match(row.result.sentence, /^Done\. \d+ new quotes?, \d+ kept\. Version 2, built on the server\. Not reviewed\.$/);
    });
    assert.deepEqual(hits, [], "nothing left the machine");

    // Eight files in the outbox, waiting for the drain; the invented link reached none.
    const out = (await db.query(`SELECT path, content FROM repo_outbox WHERE org_id = $1 AND committed_sha IS NULL ORDER BY path`, [orgA])).rows;
    assert.equal(out.length, 8);
    assert.ok(out.every((o) => o.path.startsWith("marketing/flywheel/partner/01-avatar")));
    for (const o of out) assert.doesNotMatch(o.content, /nowhere-invented\.example\.org/);
    // The ledger has every call with its step and its searches.
    const ledger = (await db.query(`SELECT count(*)::int AS n, sum(web_search_requests)::int AS s, count(*) FILTER (WHERE step IS NULL)::int AS nostep FROM marketing_model_usage WHERE job_id = $1`, [job.id])).rows[0];
    assert.equal(ledger.n, model.calls.length);
    assert.equal(ledger.nostep, 0);
    assert.ok(ledger.s > 0);
    // One buzz.
    const buzz = (await db.query(`SELECT body FROM marketing_buzzes WHERE org_id = $1 AND kind = 'avatar_ready'`, [orgA])).rows;
    assert.deepEqual(buzz.map((b) => b.body), ["The avatar for Partner offer is ready to read."]);

    // GET marketing/costs: the avatar line now reads the last run from the ledger.
    const after = await call(costsRoute, ownerA.token);
    assert.equal(after.body.kinds.avatar.job_id, job.id);
    const sum = (await db.query(`SELECT sum(cost_usd)::float8 AS c FROM marketing_model_usage WHERE job_id = $1`, [job.id])).rows[0].c;
    assert.equal(after.body.kinds.avatar.last_cost_usd, Math.round(sum * 1e6) / 1e6);
    assert.equal(after.body.kinds.avatar.last_searches, ledger.s);
    assert.match(after.body.avatar_line, /^About \$[\d.,]+ and \d+ minutes \(last run, /);
    assert.equal(after.body.kinds.offer, null);
    assert.ok(after.body.month.used_usd >= sum - 1e-6);

    // GET marketing/flywheel: step 1 says it is saving; the run is on the row.
    const fw = await call(flywheelRoute, ownerA.token, { query: { campaign: "partner" } });
    assert.equal(fw.code, 200);
    assert.equal(fw.body.stages.length, 6);
    assert.equal(fw.body.stages[0].label_words, "Who we sell to");
    assert.equal(fw.body.stages[0].source, "outbox-pending");
    assert.match(fw.body.stages[0].sentence, /Saved\. Reaching the repo…$/);
    assert.equal(fw.body.stages[0].run.id, job.id);
    assert.match(fw.body.owner_notes_stage_1, /the avatar is assumed on purpose/);
    assert.equal(fw.body.campaign_words, "Partner offer");
  });

  test("the run stops at its cap with the plain sentence; Retry after raising the cap keeps every finished step", async () => {
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgA]);
    // A cap that fits the writing steps but not one quote search.
    await db.query(`UPDATE marketing_settings SET run_caps = '{"avatar": 0.5}' WHERE org_id = $1`, [orgA]);
    const started = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("cap") } });
    const id = started.body.job.id;
    const model = fakeModel();
    await withNoNetwork(async () => {
      for (let i = 0; i < 5; i++) {
        const r = (await db.query(`SELECT status FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
        if (r.status !== "queued") break;
        await workerClaim(model);
      }
    });
    const row = (await db.query(`SELECT status, error, attempts, payload FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
    assert.equal(row.status, "failed", "a cap stop fails at once; it is not retried by itself");
    assert.match(row.error, /^Stopped at the \$0\.50 run cap after step \d\. What it found so far is saved\./);
    assert.equal(row.payload.progress.stopped_at_cap.cap, "run");
    const callsBefore = model.calls.length;
    const fw = await call(flywheelRoute, ownerA.token, { query: { campaign: "partner" } });
    assert.equal(fw.body.stages[0].run.status, "failed");
    assert.equal(fw.body.stages[0].run.stopped_at_cap, true);
    assert.equal(fw.body.stages[0].state_word, "Stopped at the cap");

    // Raise the cap, tap Retry: back in the queue, the saved steps kept, the new cap on the row.
    await db.query(`UPDATE marketing_settings SET run_caps = '{"avatar": 20}' WHERE org_id = $1`, [orgA]);
    const retried = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("retry"), retry_job_id: id } });
    assert.equal(retried.code, 202);
    assert.equal(retried.body.retried, true);
    const back = (await db.query(`SELECT status, attempts, payload FROM marketing_jobs WHERE id = $1`, [id])).rows[0];
    assert.equal(back.status, "queued");
    assert.equal(Number(back.payload.run_cap_usd), 20);
    assert.equal(back.payload.progress.steps.foundation.status, "done");
    assert.equal(back.payload.progress.stopped_at_cap, undefined);
    await withNoNetwork(() => workerClaim(model));
    assert.deepEqual([...new Set(model.calls.slice(callsBefore))], ["desire"],
      "the claim after Retry runs the quote round it stopped before; steps 1 and 2 are not paid for again");
    // A retry id that is not a failed avatar run of this company starts nothing.
    const nope = await call(runRoute, ownerB.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("nope"), retry_job_id: id } });
    assert.equal(nope.code, 404);
  });

  test("the marketing worker claims an avatar job through the registry and runs it", async () => {
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgA]);
    const started = await call(runRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, request_id: rid("pass") } });
    const model = fakeModel();
    // The real clock (the database's now() decides what is claimable) and tiny real waits.
    const { out } = await withNoNetwork(() => runPass({
      db, env: ENV,
      jobDeps: { avatar: { callModel: model.callModel } },
      deps: {
        beat: async () => 0, lastDrain: async () => ({ at: null, detail: null }), outboxWaiting: async () => 0,
        drainOutbox: async () => ({ skipped: "no_token" }), recordDrain: async () => 0,
        sendDueBuzzes: async () => ({ sent: 0 }), wake: async () => ({ started: false }),
        reclaimStale: async () => [], now: () => new Date(),
        sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 5))), log: () => {}
      }
    }));
    assert.equal(out.failed, 0, JSON.stringify(out.errors));
    assert.ok(out.claimed >= 10, `one claim per step: ${out.claimed}`);
    const row = (await db.query(`SELECT status FROM marketing_jobs WHERE id = $1`, [started.body.job.id])).rows[0];
    assert.equal(row.status, "done");
  });

  // ── Approve, Tweak, Start a flywheel ──────────────────────────────────────

  test("Approve queues one stamp edit; a step with no file is refused", async () => {
    const ok = await call(approveRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 3, request_id: rid("ap") } });
    assert.equal(ok.code, 200);
    const row = (await db.query(`SELECT path, mode, edit FROM repo_outbox WHERE id = $1`, [ok.body.outbox_id])).rows[0];
    assert.equal(row.path, "marketing/flywheel/partner/03-offer.md");
    assert.equal(row.mode, "edit");
    assert.deepEqual(row.edit, { op: "set_front_matter_key", key: "status", value: "approved" });
    const missing = await call(approveRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 6, request_id: rid("ap6") } });
    assert.equal(missing.code, 400);
    assert.equal(missing.body.field, "stage");
    assert.equal((await call(approveRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 9, request_id: rid("ap9") } })).code, 400);
  });

  test("Tweak adds one dated line to the owner notes; on step 1 it also starts a run that carries the line", async () => {
    await db.query(`DELETE FROM marketing_jobs WHERE org_id = $1`, [orgA]);
    const s3 = await call(tweakRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 2, note: "keep the price | at 10k", request_id: rid("t3") } });
    assert.equal(s3.code, 202);
    assert.equal(s3.body.job, null);
    const e3 = (await db.query(`SELECT path, edit FROM repo_outbox WHERE id = $1`, [s3.body.outbox_id])).rows[0];
    assert.equal(e3.path, "marketing/flywheel/partner/00-OWNER-NOTES.md");
    assert.equal(e3.edit.op, "append_line_under_heading");
    assert.match(e3.edit.line, /^\d{4}-\d{2}-\d{2} \| stage 2 \| keep the price \/ at 10k$/);
    assert.equal(e3.edit.heading, "## Notes");
    const s1 = await call(tweakRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, note: "the buyer is a broker with a book", request_id: rid("t1") } });
    assert.equal(s1.code, 202);
    assert.equal(s1.body.started, true);
    const j = (await db.query(`SELECT payload FROM marketing_jobs WHERE id = $1`, [s1.body.job.id])).rows[0];
    assert.equal(j.payload.tweak, "the buyer is a broker with a book");
    assert.equal((await call(tweakRoute, ownerA.token, { method: "POST", body: { campaign: "partner", stage: 1, note: "  ", request_id: rid("t0") } })).code, 400);
  });

  test("Start a flywheel makes the folder's owner notes for any offer key, once", async () => {
    const made = await call(campaignRoute, ownerA.token, { method: "POST", body: { key: "FUNDING_DFY", request_id: rid("c1") } });
    assert.equal(made.code, 201);
    assert.equal(made.body.campaign, "funding-done-for-you");
    const file = (await db.query(`SELECT path, content FROM repo_outbox WHERE id = $1`, [made.body.outbox_id])).rows[0];
    assert.equal(file.path, "marketing/flywheel/funding-done-for-you/00-OWNER-NOTES.md");
    assert.match(file.content, /## Notes/);
    const again = await call(campaignRoute, ownerA.token, { method: "POST", body: { key: "FUNDING_DFY", request_id: rid("c2") } });
    assert.equal(again.code, 200);
    assert.equal(again.body.created, false);
    const partner = await call(campaignRoute, ownerA.token, { method: "POST", body: { key: "PARTNER_ENTRY", request_id: rid("c3") } });
    assert.equal(partner.body.campaign, "partner");
    assert.equal(partner.body.created, false, "the partner folder ships with the site");
    assert.equal((await call(campaignRoute, ownerA.token, { method: "POST", body: { key: "NOT_AN_OFFER", request_id: rid("c4") } })).code, 400);
    // The new campaign shows in the picker while its save waits.
    const fw = await call(flywheelRoute, ownerA.token, { query: { campaign: "funding-done-for-you" } });
    assert.ok(fw.body.campaigns.some((c) => c.key === "funding-done-for-you" && c.source === "outbox-pending"));
    assert.equal(fw.body.stages[0].state, "MISSING");
    // X3's folder name still maps back to its offer for X1's "What we sell" pre-fill.
    assert.match(fw.body.service_description_default, /^Funding, done-for-you from Fundhub/);
  });
});
