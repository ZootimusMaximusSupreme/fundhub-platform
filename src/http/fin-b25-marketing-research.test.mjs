// Finish-the-853 batch 25, practice tests for "Research it": start a deep research run, list and read
// runs, approve a finished report, save it to the brain, and tweak it. Each test runs the REAL api/
// handler (real sign-in and role gate, real research store, real cost-cap rules) over an in-memory
// marketing_jobs / repo_outbox world that answers by the SQL text the code sends. Fake data only.
// No model call, no web, no embedding: the brain writer and the worker wake are injected stand-ins.
import assert from "node:assert/strict";
import test from "node:test";

import approveHandler from "../../api/marketing/research/approve.mjs";
import brainHandler from "../../api/marketing/research/brain.mjs";
import researchHandler from "../../api/marketing/research.mjs";
import tweakHandler from "../../api/marketing/research/tweak.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, dataCalls, requestLog, sqlCalls,
} from "../testing/fin-b25-kit.mjs";

const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const NOW = new Date("2026-10-14T18:00:00.000Z");
const RUN_DONE = "70000000-0000-4000-8000-000000000001";
const RUN_RUNNING = "70000000-0000-4000-8000-000000000002";
const RUN_FAILED = "70000000-0000-4000-8000-000000000003";
const RUN_OTHER = "70000000-0000-4000-8000-0000000000aa";
const NEW_RUN = "70000000-0000-4000-8000-0000000000bb";
const REPO_PATH = "marketing/research/2026-10-13-why-do-banks-decline.md";
const MODEL_ENV = { ANTHROPIC_API_KEY: "fake-model-key-not-real" };

const doneRow = (over = {}) => ({
  id: RUN_DONE, org_id: ORG_ID, kind: "deep_research", status: "done", attempts: 1, error: null, requested_by: STAFF_ID, approved_by: null, approved_at: null,
  payload: { question: "Why do banks decline small businesses?", depth: "quick", sources: { web: true, vault: true, own_files: false }, belief: null, max_cost_usd: 5, today: "2026-10-13" },
  result: {
    state: { question: "Why do banks decline small businesses?", depth: "quick", today: "2026-10-13", round: 1 },
    report: { markdown: "# Why banks decline\n\nToo many inquiries.", fallback_report: false, key_verified: 4, key_killed: 1, unreachable: [], dropped: 0, quotes_unchecked: 0, rounds: 1, cost_usd: 1.234, searches: 9, minutes: 3, stopped_at_cap: null, repo_path: REPO_PATH },
    progress: { round: 1, findings: 22, searches_used: 9, cost_usd_so_far: 1.234 },
  },
  created_at: new Date("2026-10-13T10:00:00.000Z"), finished_at: new Date("2026-10-13T10:04:00.000Z"),
  ...over,
});

function researchWorld({ jobs = [], settings = null, monthPriced = "0", outbox = [] } = {}) {
  const log = requestLog();
  const world = {
    jobs, outbox, log, inserts: [], approvals: [], settings: settings || { org_id: ORG_ID, max_research_cost_usd: null, research_shares_month_cap: true, max_month_cost_usd: 300, enabled: false, updated_at: NOW },
    monthPriced, costReads: [],
  };
  world.rules = [
    ...log.rules,
    [/^\s*INSERT INTO marketing_settings \(org_id\) VALUES/, []],
    [/^\s*SELECT \* FROM marketing_settings WHERE org_id = \$1/, (sql, params) => rowsWhere([world.settings], sql, params)],
    [/WITH bounds AS/, (_sql, params) => { world.costReads.push(params); return [{ month_priced_usd: world.monthPriced, batch_priced_usd: "0", unpriced_rows: 0 }]; }],
    // GET list
    [/^\s*SELECT \* FROM marketing_jobs WHERE org_id = \$1 AND kind = 'deep_research' ORDER BY created_at DESC LIMIT 20/, (sql, params) =>
      rowsWhere(jobs, sql, params).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 20)],
    [/^\s*SELECT payload ->> 'depth' AS depth, result -> 'report' AS report/, (_sql, params) =>
      jobs.filter((j) => j.org_id === params[0] && j.kind === "deep_research" && j.status === "done")
        .map((j) => ({ depth: j.payload.depth, report: j.result?.report ?? null }))],
    // one run, optionally locked
    [/^\s*SELECT \* FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 AND kind = 'deep_research'/, (sql, params) => rowsWhere(jobs, sql, params)],
    [/^\s*SELECT id, status, payload, result FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 AND kind = 'deep_research'/, (sql, params) =>
      rowsWhere(jobs, sql, params).map(({ id, status, payload, result }) => ({ id, status, payload, result }))],
    [/^\s*SELECT committed_sha, error FROM repo_outbox WHERE org_id = \$1 AND path = \$2/, (_sql, params) =>
      outbox.filter((r) => r.org_id === params[0] && r.path === params[1]).sort((a, b) => b.id - a.id).slice(0, 1)],
    // start
    [/^\s*INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'deep_research'/, (sql, params) => {
      const inFlight = jobs.find((j) => j.org_id === params[0] && j.kind === "deep_research" && ["queued", "running"].includes(j.status));
      if (inFlight) return [];
      const row = { id: NEW_RUN, org_id: params[0], kind: "deep_research", status: "queued", attempts: 0, error: null, requested_by: params[2], payload: JSON.parse(params[1]), result: null, approved_at: null, created_at: NOW, finished_at: null };
      world.inserts.push({ sql, params, row });
      jobs.push(row);
      return [row];
    }],
    [/^\s*SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'deep_research' AND status IN \('queued', 'running'\)/, (_sql, params) =>
      jobs.filter((j) => j.org_id === params[0] && j.kind === "deep_research" && ["queued", "running"].includes(j.status)).slice(0, 1)],
    // approve
    [/^\s*UPDATE marketing_jobs SET approved_by = \$3, approved_at = now\(\)/, (sql, params) => {
      const hit = rowsWhere(jobs, sql, params);
      world.approvals.push({ sql, params });
      for (const row of hit) Object.assign(row, { approved_by: params[2], approved_at: NOW });
      return hit;
    }],
    [/^\s*INSERT INTO repo_outbox/, (_sql, params) => {
      const row = { id: outbox.length + 1, org_id: params[0], op_id: params[1], path: params[2], mode: params[3], content: params[4], committed_sha: null, error: null };
      outbox.push(row);
      return [{ id: row.id, op_id: row.op_id, path: row.path, mode: row.mode }];
    }],
  ];
  return world;
}

const woke = () => {
  const seen = [];
  return { seen, wake: async (env) => { seen.push(env); return {}; } };
};

/* ── marketing/research ────────────────────────────────────────────────────────────────────────────── */

test("GET marketing/research lists this company's runs newest first in plain words, with the month spend against the cap and the search limits of each depth", async () => {
  const world = researchWorld({
    jobs: [
      doneRow(),
      { ...doneRow({ id: RUN_RUNNING, status: "running", created_at: new Date("2026-10-14T09:00:00.000Z"), finished_at: null, approved_at: null }), result: { step: "sweep", step_n: 3, steps_total: 8, step_word: "sweeping round 1", progress: { round: 1, findings: 7, cost_usd_so_far: 0.5 } } },
      { ...doneRow({ id: RUN_FAILED, status: "failed", error: "The model ran out of credit.", created_at: new Date("2026-10-12T09:00:00.000Z"), result: null }) },
      doneRow({ id: RUN_OTHER, org_id: OTHER_ORG_ID, created_at: new Date("2026-10-14T12:00:00.000Z") }),
    ],
    settings: { org_id: ORG_ID, max_research_cost_usd: "7.5", research_shares_month_cap: true, max_month_cost_usd: 300, updated_at: NOW },
    monthPriced: "42.337",
  });
  const result = await call(researchHandler, { rules: world.rules, deps: { env: MODEL_ENV } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.runs.map((r) => r.id), [RUN_RUNNING, RUN_DONE, RUN_FAILED], "newest first, this company only");
  const [running, done, failed] = result.body.runs;
  assert.equal(running.step_word, "Running: sweeping round 1 · 7 findings · $0.50 so far");
  assert.equal(done.step_word, "Done, 4 of 5 key claims held up");
  assert.equal(done.question, "Why do banks decline small businesses?");
  assert.equal(failed.step_word, "Could not finish: The model ran out of credit.");
  assert.equal(failed.error, "The model ran out of credit.");
  assert.equal(done.approved, false);
  assert.deepEqual(result.body.settings, {
    max_research_cost_usd: 7.5, research_shares_month_cap: true, month_used_usd: 42.34, month_cap_usd: 300, measured: true,
    last_run: { quick: { cost_usd: 1.23, minutes: 3, searches: 9 }, deep: null },
  });
  assert.ok(result.body.limits.quick.searches > 0 && result.body.limits.deep.searches > result.body.limits.quick.searches);
  assert.equal(result.body.limits.quick.search_usd, Math.round(result.body.limits.quick.searches * 0.01 * 100) / 100);
  const list = sqlCalls(result, /ORDER BY created_at DESC LIMIT 20/)[0];
  assert.deepEqual(list.params, [ORG_ID]);
  assertSqlHas(list.sql, { company: "WHERE org_id = $1", kind: "kind = 'deep_research'" });
  assert.equal(world.costReads[0][0], ORG_ID);
  await assertRoleGate(researchHandler, ["owner", "admin"], { rules: world.rules, deps: { env: MODEL_ENV } });
});

test("GET marketing/research?id= reads one run with its report and where the report file stands, 404s another company's run, and refuses a bad id", async () => {
  const world = researchWorld({
    jobs: [doneRow(), doneRow({ id: RUN_OTHER, org_id: OTHER_ORG_ID })],
    outbox: [{ id: 1, org_id: ORG_ID, path: REPO_PATH, committed_sha: null, error: null }],
  });
  const result = await call(researchHandler, { query: { id: RUN_DONE }, rules: world.rules, deps: { env: MODEL_ENV } });
  assert.equal(result.status, 200);
  assert.equal(result.body.job.id, RUN_DONE);
  assert.equal(result.body.report.markdown, "# Why banks decline\n\nToo many inquiries.");
  assert.equal(result.body.report.key_verified, 4);
  assert.equal(result.body.report.key_killed, 1);
  assert.equal(result.body.report.cost_usd, 1.23);
  assert.deepEqual(result.body.report.repo_state, { state: "pending", words: "Saved. Reaching the repo…", committed_sha: null });
  assert.deepEqual(sqlCalls(result, /FROM marketing_jobs WHERE id = \$1/)[0].params, [RUN_DONE, ORG_ID]);

  world.outbox[0].committed_sha = "abc1234";
  const committed = await call(researchHandler, { query: { id: RUN_DONE }, rules: world.rules, deps: { env: MODEL_ENV } });
  assert.equal(committed.body.report.repo_state.state, "in_repo");

  const other = await call(researchHandler, { query: { id: RUN_OTHER }, rules: world.rules, deps: { env: MODEL_ENV } });
  assert.equal(other.status, 404, "another company's run is not found");
  const bad = await call(researchHandler, { query: { id: "nope" }, rules: world.rules, deps: { env: MODEL_ENV } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "id");
  assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)), true);
});

test("POST marketing/research queues one run for the session's company with the question, places to look and stop amount, wakes the worker, and a repeat of the request starts nothing", async () => {
  const world = researchWorld();
  const { seen, wake } = woke();
  const body = { request_id: REQ(1), question: "  Why do banks   decline small businesses?  ", depth: "deep", sources: { web: true, vault: false, own_files: true }, belief: "Inquiries matter most", max_cost_usd: 6.499 };
  const result = await call(researchHandler, { method: "POST", body, rules: world.rules, deps: { env: MODEL_ENV, wake } });
  assert.equal(result.status, 202);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.started, true);
  assert.equal(result.body.already_running, false);
  assert.equal(result.body.job.id, NEW_RUN);
  assert.equal(result.body.job.status, "queued");
  assert.equal(result.body.poll, `marketing/research?id=${NEW_RUN}`);
  assert.equal(world.inserts.length, 1);
  const { params } = world.inserts[0];
  assert.equal(params[0], ORG_ID);
  assert.equal(params[2], STAFF_ID, "the run names who asked for it");
  const payload = JSON.parse(params[1]);
  assert.equal(payload.question, "Why do banks decline small businesses?", "spaces are folded");
  assert.equal(payload.depth, "deep");
  assert.deepEqual(payload.sources, { web: true, vault: false, own_files: true });
  assert.equal(payload.belief, "Inquiries matter most");
  assert.equal(payload.max_cost_usd, 6.5);
  assert.match(payload.today, /^\d{4}-\d{2}-\d{2}$/);
  assertSqlHas(world.inserts[0].sql, { oneInFlight: "ON CONFLICT (org_id) WHERE kind = 'deep_research' AND status IN ('queued', 'running') DO NOTHING" });
  assert.equal(seen.length, 1);

  const again = await call(researchHandler, { method: "POST", body, rules: world.rules, deps: { env: MODEL_ENV, wake } });
  assert.equal(again.status, 202);
  assert.deepEqual(again.body, result.body);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.log.saved.get(REQ(1)).route, "marketing/research");
});

test("POST marketing/research gives the running run back when one is already in flight, and refuses a missing key, a used-up month cap, an empty question, no place to look and a bad stop amount", async () => {
  const running = researchWorld({ jobs: [doneRow({ id: RUN_RUNNING, status: "running", finished_at: null })] });
  const { seen, wake } = woke();
  const ask = (world, extra, n, env = MODEL_ENV) => call(researchHandler, {
    method: "POST", body: { request_id: REQ(n), question: "Why do banks decline?", depth: "quick", sources: { web: true }, max_cost_usd: 5, ...extra }, rules: world.rules, deps: { env, wake },
  });
  const already = await ask(running, {}, 10);
  assert.equal(already.status, 202);
  assert.equal(already.body.started, false);
  assert.equal(already.body.already_running, true);
  assert.equal(already.body.job.id, RUN_RUNNING);
  assert.equal(seen.length, 0, "no second paid run, and no wake");
  assert.equal(running.inserts.length, 0);

  const noKey = researchWorld();
  const noModel = await ask(noKey, {}, 11, {});
  assert.equal(noModel.status, 503);
  assert.equal(noModel.body.error, "no_model");
  const masked = await ask(noKey, {}, 12, { ANTHROPIC_API_KEY: "****************abcd" });
  assert.equal(masked.status, 503);
  assert.equal(noKey.inserts.length, 0);

  const capped = researchWorld({ monthPriced: "300" });
  const cap = await ask(capped, {}, 13);
  assert.equal(cap.status, 400);
  assert.equal(cap.body.error, "cap_reached");
  assert.match(cap.body.message, /\$300 month cap/);
  assert.equal(capped.inserts.length, 0, "a refusal saves nothing, so the same request can be sent again");
  assert.equal(capped.log.saved.has(REQ(13)), false);

  const notShared = researchWorld({ monthPriced: "300", settings: { org_id: ORG_ID, max_research_cost_usd: null, research_shares_month_cap: false, max_month_cost_usd: 300, updated_at: NOW } });
  const free = await ask(notShared, {}, 14);
  assert.equal(free.status, 202, "when research does not count against the month cap, a used-up month does not stop it");

  const world = researchWorld();
  const emptyQuestion = await ask(world, { question: "  " }, 15);
  assert.equal(emptyQuestion.status, 400);
  assert.equal(emptyQuestion.body.error, "bad_question");
  assert.equal(emptyQuestion.body.field, "question");
  const nowhere = await ask(world, { sources: { web: false, vault: false } }, 16);
  assert.equal(nowhere.status, 400);
  assert.equal(nowhere.body.field, "sources");
  const tiny = await ask(world, { max_cost_usd: 0.5 }, 17);
  assert.equal(tiny.status, 400);
  assert.equal(tiny.body.error, "bad_question");
  assert.equal(tiny.body.field, "max_cost_usd");
  const noCap = await ask(world, { max_cost_usd: undefined }, 18);
  assert.equal(noCap.status, 400);
  assert.match(noCap.body.message, /stop amount/);
  const huge = await ask(world, { max_cost_usd: 5000 }, 19);
  assert.equal(huge.status, 400);
  assert.equal(huge.body.error, "invalid");
  const badDepth = await ask(world, { depth: "medium" }, 20);
  assert.equal(badDepth.status, 400);
  assert.equal(badDepth.body.field, "depth");
  assert.equal(world.inserts.length, 0);

  const fromSettings = researchWorld({ settings: { org_id: ORG_ID, max_research_cost_usd: "4", research_shares_month_cap: true, max_month_cost_usd: 300, updated_at: NOW } });
  const useSaved = await ask(fromSettings, { max_cost_usd: undefined }, 21);
  assert.equal(useSaved.status, 202);
  assert.equal(JSON.parse(fromSettings.inserts[0].params[1]).max_cost_usd, 4, "the stop amount saved in Settings is used when none is typed");
  await assertRoleGate(researchHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(22), question: "Why?", max_cost_usd: 5 }, rules: world.rules, deps: { env: MODEL_ENV, wake } });
});

/* ── marketing/research/approve ────────────────────────────────────────────────────────────────────── */

test("POST marketing/research/approve stamps who approved and when, saves the report file again as approved through the outbox, and approving twice changes nothing", async () => {
  const world = researchWorld({ jobs: [doneRow(), doneRow({ id: RUN_OTHER, org_id: OTHER_ORG_ID })] });
  const { seen, wake } = woke();
  const result = await call(approveHandler, { method: "POST", body: { request_id: REQ(30), id: RUN_DONE }, rules: world.rules, deps: { wake, env: {} } });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.job.approved, true);
  assert.equal(world.jobs[0].approved_by, STAFF_ID);
  assert.deepEqual(world.approvals[0].params, [RUN_DONE, ORG_ID, STAFF_ID]);
  assertSqlHas(world.approvals[0].sql, { company: "WHERE id = $1 AND org_id = $2" });
  assert.equal(world.outbox.length, 1);
  assert.equal(world.outbox[0].org_id, ORG_ID);
  assert.equal(world.outbox[0].path, REPO_PATH);
  assert.equal(world.outbox[0].mode, "replace");
  assert.match(world.outbox[0].content, /^---\nkind: deep-research\njob: 70000000-0000-4000-8000-000000000001\nstatus: approved\n/);
  assert.match(world.outbox[0].content, /approved_at: 2026-10-14T18:00:00\.000Z/);
  assert.match(world.outbox[0].content, /# Why banks decline/);
  assert.equal(seen.length, 1);

  const again = await call(approveHandler, { method: "POST", body: { request_id: REQ(31), id: RUN_DONE }, rules: world.rules, deps: { wake, env: {} } });
  assert.equal(again.status, 200);
  assert.equal(world.approvals.length, 1, "approving twice changes nothing the second time");
  assert.equal(world.outbox.length, 1);
});

test("POST marketing/research/approve refuses a run that is not finished, another company's run and a bad id, and only owner and admin may approve", async () => {
  const world = researchWorld({ jobs: [doneRow({ id: RUN_RUNNING, status: "running" }), doneRow({ id: RUN_OTHER, org_id: OTHER_ORG_ID })] });
  const deps = { wake: async () => ({}), env: {} };
  const unfinished = await call(approveHandler, { method: "POST", body: { request_id: REQ(32), id: RUN_RUNNING }, rules: world.rules, deps });
  assert.equal(unfinished.status, 400);
  assert.match(unfinished.body.message, /Only a finished report/);
  const other = await call(approveHandler, { method: "POST", body: { request_id: REQ(33), id: RUN_OTHER }, rules: world.rules, deps });
  assert.equal(other.status, 404);
  assert.equal(world.jobs[1].approved_at, null);
  const bad = await call(approveHandler, { method: "POST", body: { request_id: REQ(34), id: "x" }, rules: world.rules, deps });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "id");
  assert.equal(world.approvals.length, 0);
  assert.equal(world.outbox.length, 0);
  await assertRoleGate(approveHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(35), id: RUN_DONE }, rules: world.rules, deps });
});

/* ── marketing/research/brain ──────────────────────────────────────────────────────────────────────── */

test("POST marketing/research/brain saves a finished report into the brain as an owner-tier page keyed by the run, and says plainly when the brain cannot take it", async () => {
  const world = researchWorld({ jobs: [doneRow(), doneRow({ id: RUN_RUNNING, status: "running", result: null }), doneRow({ id: RUN_OTHER, org_id: OTHER_ORG_ID })] });
  const saves = [];
  const saver = (answer) => async (_db, args) => { saves.push(args); return answer; };
  const post = (id, n, upsert) => call(brainHandler, { method: "POST", body: { request_id: REQ(n), id }, rules: world.rules, deps: { env: { MARK: "env" }, upsertGeneratedDocument: upsert } });

  const ok = await post(RUN_DONE, 40, saver({ ok: true, fileId: "bf-1", chunkCount: 6, skipped: false }));
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body, { ok: true, brain_file_id: "bf-1", chunks: 6, unchanged: false });
  assert.deepEqual(saves[0], {
    orgId: ORG_ID, sourceType: "deep-research", sourceKey: RUN_DONE, title: "Research: Why do banks decline small businesses?",
    text: "# Why banks decline\n\nToo many inquiries.", accessTier: "owner", env: { MARK: "env" },
  });
  assert.deepEqual(sqlCalls(ok, /FROM marketing_jobs WHERE id = \$1/)[0].params, [RUN_DONE, ORG_ID]);

  const same = await post(RUN_DONE, 41, saver({ ok: true, fileId: "bf-1", chunkCount: 0, skipped: true }));
  assert.equal(same.body.unchanged, true, "the same report saved twice is skipped, so a second tap never pays again");

  const noCredit = await post(RUN_DONE, 42, saver({ ok: false, reason: "embedding 429 insufficient credit" }));
  assert.equal(noCredit.status, 503);
  assert.equal(noCredit.body.error, "brain_unavailable");
  assert.equal(noCredit.body.message, "The brain cannot save new pages right now: its embedding key has no credit.");
  const noKey = await post(RUN_DONE, 43, saver({ ok: false, reason: "OPENAI key not set" }));
  assert.equal(noKey.body.message, "The brain cannot save new pages right now: its embedding key is not set.");

  const callsBefore = saves.length;
  const unfinished = await post(RUN_RUNNING, 44, saver({ ok: true }));
  assert.equal(unfinished.status, 400);
  assert.match(unfinished.body.message, /Only a finished report/);
  const other = await post(RUN_OTHER, 45, saver({ ok: true }));
  assert.equal(other.status, 404, "another company's report is never saved under this company");
  const bad = await post("nope", 46, saver({ ok: true }));
  assert.equal(bad.status, 400);
  assert.equal(saves.length, callsBefore, "nothing reaches the brain for a refused request");
  await assertRoleGate(brainHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(47), id: RUN_DONE }, rules: world.rules, deps: { env: {}, upsertGeneratedDocument: saver({ ok: true }) } });
});

/* ── marketing/research/tweak ──────────────────────────────────────────────────────────────────────── */

test("POST marketing/research/tweak starts a short re-run of the same question with the note as its focus, keeps the first report, and wakes the worker", async () => {
  const world = researchWorld({ jobs: [doneRow({ payload: { ...doneRow().payload, depth: "deep", belief: "Inquiries matter most", max_cost_usd: 8 } })] });
  const { seen, wake } = woke();
  const result = await call(tweakHandler, {
    method: "POST", body: { request_id: REQ(50), id: RUN_DONE, note: "  go deeper   on bank overlays  " }, rules: world.rules, deps: { env: MODEL_ENV, wake },
  });
  assert.equal(result.status, 202);
  assert.equal(result.body.started, true);
  assert.equal(result.body.job.id, NEW_RUN);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.inserts[0].params[0], ORG_ID);
  assert.equal(world.inserts[0].params[2], STAFF_ID);
  const payload = JSON.parse(world.inserts[0].params[1]);
  assert.equal(payload.question, "Why do banks decline small businesses?");
  assert.equal(payload.depth, "quick", "a tweak is a short Quick look");
  assert.deepEqual(payload.sources, { web: true, vault: true, own_files: false });
  assert.equal(payload.max_cost_usd, 8, "the same stop amount");
  assert.equal(payload.focus, "go deeper on bank overlays");
  assert.equal(payload.parent_id, RUN_DONE);
  assert.equal(world.jobs[0].status, "done", "the first report stays as it is");
  assert.equal(seen.length, 1);
  assert.deepEqual(sqlCalls(result, /FROM marketing_jobs WHERE id = \$1/)[0].params, [RUN_DONE, ORG_ID]);
});

test("POST marketing/research/tweak refuses a run still going, another company's run, an empty note, a missing key and a used-up month cap, and hands back a run already in flight", async () => {
  const deps = { env: MODEL_ENV, wake: async () => ({}) };
  const post = (world, body, n, d = deps) => call(tweakHandler, { method: "POST", body: { request_id: REQ(n), id: RUN_DONE, note: "dig in", ...body }, rules: world.rules, deps: d });

  const going = researchWorld({ jobs: [doneRow({ status: "running" })] });
  const goingAnswer = await post(going, {}, 51);
  assert.equal(goingAnswer.status, 400);
  assert.match(goingAnswer.body.message, /still going/);

  const other = researchWorld({ jobs: [doneRow({ org_id: OTHER_ORG_ID })] });
  const otherAnswer = await post(other, {}, 52);
  assert.equal(otherAnswer.status, 404);
  assert.equal(other.inserts.length, 0);

  const world = researchWorld({ jobs: [doneRow()] });
  const empty = await post(world, { note: "   " }, 53);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "note");
  const noKey = await post(world, {}, 54, { env: {}, wake: async () => ({}) });
  assert.equal(noKey.status, 503);
  assert.equal(noKey.body.error, "no_model");
  const badId = await post(world, { id: "x" }, 55);
  assert.equal(badId.status, 400);
  assert.equal(world.inserts.length, 0);

  const capped = researchWorld({ jobs: [doneRow()], monthPriced: "300" });
  const cap = await post(capped, {}, 56);
  assert.equal(cap.status, 400);
  assert.equal(cap.body.error, "cap_reached");
  assert.equal(capped.inserts.length, 0);

  const busy = researchWorld({ jobs: [doneRow(), doneRow({ id: RUN_RUNNING, status: "running", finished_at: null })] });
  const { seen, wake } = woke();
  const busyAnswer = await post(busy, {}, 57, { env: MODEL_ENV, wake });
  assert.equal(busyAnswer.status, 202);
  assert.equal(busyAnswer.body.started, false);
  assert.equal(busyAnswer.body.already_running, true);
  assert.equal(busyAnswer.body.job.id, RUN_RUNNING);
  assert.equal(seen.length, 0);
  await assertRoleGate(tweakHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(58), id: RUN_DONE, note: "x y" }, rules: world.rules, deps });
});
