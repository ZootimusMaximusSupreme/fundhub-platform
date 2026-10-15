// Finish-the-853 batch 25, practice tests for the ideas inbox (list; save an idea and its repo file;
// Write now with the model-bill caps) and the Write offer button (start a run, read one back). Each
// test runs the REAL api/ handler over a stand-in database that answers by the SQL text the code
// sends. Fake data only. No model call, no worker: the wake and the input reader are injected.
import assert from "node:assert/strict";
import test from "node:test";

import ideasHandler from "../../api/marketing/ideas.mjs";
import offerHandler from "../../api/marketing/offer/generate.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, dataCalls, insertedRow, requestLog, sqlCalls,
} from "../testing/fin-b25-kit.mjs";

const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const NOW = new Date("2026-10-14T18:00:00.000Z");
const IDEA_ID = "1d000000-0000-4000-8000-000000000001";
const IDEA_2 = "1d000000-0000-4000-8000-000000000002";
const BATCH_ID = "ba000000-0000-4000-8000-000000000001";
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const OFFER_JOB = "0f000000-0000-4000-8000-000000000001";

/* ── the ideas inbox: marketing/ideas ──────────────────────────────────────────────────────────────── */

const ideaRow = (over = {}) => ({
  id: IDEA_ID, org_id: ORG_ID, source: "chris", kind: "script", raw_points: "Open with the inquiry count.", topic: null, script_format: "standard",
  funnel_key: "book_call", angle_key: "cause", status: "new", script_id: null, created_at: new Date("2026-10-13T20:00:00.000Z"), ...over,
});

function ideasWorld({ ideas = [], funnels = [{ org_id: ORG_ID, key: "book_call" }], settings = null } = {}) {
  const log = requestLog();
  const world = {
    ideas, funnels, log, inserts: [], outbox: [], batches: [], jobs: [], ideaUpdates: [], lists: [],
    settings: settings || { org_id: ORG_ID, enabled: false, scripts_per_day: 3, max_batch_cost_usd: 40, max_month_cost_usd: 300, timezone: "America/Phoenix", updated_at: NOW },
    cost: { month_priced_usd: "0", batch_priced_usd: "0" },
  };
  world.rules = [
    ...log.rules,
    [/^\s*INSERT INTO marketing_settings \(org_id\) VALUES/, []],
    [/^\s*SELECT \* FROM marketing_settings WHERE org_id = \$1/, (sql, params) => rowsWhere([world.settings], sql, params)],
    [/^\s*SELECT \* FROM ad_ideas\s+WHERE org_id = \$1 AND \(\$2::text IS NULL OR status = \$2::text\)/, (sql, params) => {
      world.lists.push({ sql, params });
      return ideas.filter((i) => i.org_id === params[0] && (params[1] === null || i.status === params[1]))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }],
    [/^\s*SELECT 1 FROM marketing_funnels WHERE org_id = \$1 AND key = \$2/, (_sql, params) =>
      funnels.filter((f) => f.org_id === params[0] && f.key === params[1]).map(() => ({ "?column?": 1 }))],
    [/^\s*INSERT INTO ad_ideas/, (sql, params) => {
      // made at 8pm Arizona time, which is already the next day in UTC: the file is named for the Arizona day
      const row = { id: IDEA_ID, topic: null, script_id: null, created_at: new Date("2026-10-15T03:00:00.000Z"), ...insertedRow(sql, params), status: "new", kind: "script" };
      world.inserts.push({ sql, params, row });
      ideas.push(row);
      return [row];
    }],
    [/^\s*INSERT INTO repo_outbox/, (_sql, params) => {
      const row = { org_id: params[0], op_id: params[1], path: params[2], mode: params[3], content: params[4] };
      world.outbox.push(row);
      return [{ id: world.outbox.length, op_id: row.op_id, path: row.path, mode: row.mode }];
    }],
    [/^\s*SELECT id FROM ad_ideas WHERE org_id = \$1 AND id = ANY\(\$2::uuid\[\]\)/, (_sql, params) =>
      ideas.filter((i) => i.org_id === params[0] && params[1].includes(i.id)).map((i) => ({ id: i.id }))],
    [/WITH bounds AS/, () => [world.cost]],
    [/^\s*INSERT INTO marketing_batches/, (sql, params) => {
      const row = { id: params[0], org_id: params[1], kind: "on_command", status: "planned" };
      world.batches.push({ sql, params, row });
      return [row];
    }],
    [/^\s*UPDATE ad_ideas SET batch_id = \$3/, (sql, params) => { world.ideaUpdates.push({ sql, params }); return []; }],
    [/^\s*INSERT INTO marketing_jobs/, (_sql, params) => {
      const job = { id: JOB_ID, org_id: params[0], kind: params[1], payload: JSON.parse(params[2]), status: "queued" };
      world.jobs.push(job);
      return [job];
    }],
  ];
  return world;
}

test("GET marketing/ideas lists this company's ideas newest first, can filter by status, and refuses an unknown status", async () => {
  const world = ideasWorld({
    ideas: [
      ideaRow({ created_at: new Date("2026-10-12T10:00:00.000Z") }),
      ideaRow({ id: IDEA_2, status: "written", script_id: "a5000000-0000-4000-8000-000000000001", created_at: new Date("2026-10-13T10:00:00.000Z") }),
      ideaRow({ id: "1d000000-0000-4000-8000-0000000000aa", org_id: OTHER_ORG_ID, raw_points: "Not ours." }),
    ],
  });
  const all = await call(ideasHandler, { rules: world.rules });
  assert.equal(all.status, 200);
  assert.deepEqual(all.body.ideas.map((i) => i.id), [IDEA_2, IDEA_ID], "newest first, this company only");
  assert.deepEqual(all.body.ideas[1], {
    id: IDEA_ID, source: "chris", kind: "script", raw_points: "Open with the inquiry count.", topic: null, script_format: "standard",
    funnel_key: "book_call", angle_key: "cause", status: "new", script_id: null, created_at: "2026-10-12T10:00:00.000Z",
  });
  assert.deepEqual(world.lists[0].params, [ORG_ID, null]);
  assertSqlHas(world.lists[0].sql, { company: "WHERE org_id = $1", order: "ORDER BY created_at DESC, id DESC", cap: "LIMIT 200" });

  const written = await call(ideasHandler, { query: { status: "written" }, rules: world.rules });
  assert.deepEqual(written.body.ideas.map((i) => i.id), [IDEA_2]);
  assert.deepEqual(world.lists[1].params, [ORG_ID, "written"]);

  const bad = await call(ideasHandler, { query: { status: "banana" }, rules: world.rules });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "status");
  assert.equal(world.lists.length, 2, "a refused filter reads nothing");
  await assertRoleGate(ideasHandler, ["owner", "admin"], { rules: world.rules });
});

test("POST marketing/ideas saves the idea for the session's company, queues its repo file with Chris's words kept exactly, wakes the worker, and a repeat saves nothing", async () => {
  const world = ideasWorld();
  const woke = [];
  const deps = { wake: async (env) => { woke.push(env); return {}; }, env: { MARK: "1" } };
  const body = { request_id: REQ(1), raw_points: "  1. Open with the count.\n2. Say what it cost.\n", script_format: "sorting", funnel_key: "book_call", angle_key: "cause" };
  const result = await call(ideasHandler, { method: "POST", body: { ...body, org_id: OTHER_ORG_ID }, rules: world.rules, deps });
  assert.equal(result.status, 200);
  assert.equal(result.body.idea.id, IDEA_ID);
  assert.equal(result.body.idea.status, "new");
  assert.equal(result.body.idea.source, "chris");
  assert.equal(result.body.idea.script_format, "sorting");
  assert.equal(result.body.batch_id, undefined, "no batch unless write_now");
  assert.equal(world.inserts.length, 1);
  assert.equal(world.inserts[0].row.org_id, ORG_ID, "filed under the session's company, never the body's");
  assert.equal(world.inserts[0].row.raw_points, body.raw_points, "the words go in exactly as typed");
  assert.equal(world.inserts[0].row.created_by, STAFF_ID);
  assert.deepEqual(sqlCalls(result, /FROM marketing_funnels/)[0].params, [ORG_ID, "book_call"]);

  assert.equal(world.outbox.length, 1);
  assert.equal(world.outbox[0].org_id, ORG_ID);
  assert.equal(world.outbox[0].mode, "replace");
  assert.equal(world.outbox[0].path, `marketing/ads/ideas/2026-10-14-${IDEA_ID.slice(0, 8)}.md`, "the Arizona day it was made and the first 8 letters of its id");
  assert.match(world.outbox[0].content, new RegExp(`^---\\nidea: ${IDEA_ID}\\nsource: chris\\nkind: script\\nstatus: new\\nformat: sorting\\nfunnel: book_call\\nangle: cause\\n`));
  assert.ok(world.outbox[0].content.endsWith(`---\n\n${body.raw_points}`), "the points follow, byte for byte");
  assert.deepEqual(woke, [{ MARK: "1" }]);

  const again = await call(ideasHandler, { method: "POST", body, rules: world.rules, deps });
  assert.deepEqual(again.body, result.body);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.outbox.length, 1);
  assert.equal(world.log.saved.get(REQ(1)).route, "marketing/ideas");
});

test("POST marketing/ideas refuses an empty or oversize idea, a source the machine owns, a bad format, a funnel this company has not got, and a non-boolean write_now", async () => {
  const world = ideasWorld({ funnels: [{ org_id: OTHER_ORG_ID, key: "their_funnel" }] });
  const deps = { wake: async () => ({}), env: {} };
  const post = (extra, n) => call(ideasHandler, { method: "POST", body: { request_id: REQ(n), raw_points: "An idea.", ...extra }, rules: world.rules, deps });
  const empty = await post({ raw_points: "   " }, 10);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.field, "raw_points");
  const huge = await post({ raw_points: "x".repeat(20001) }, 11);
  assert.equal(huge.status, 400);
  assert.equal(huge.body.field, "raw_points");
  const machine = await post({ source: "machine" }, 12);
  assert.equal(machine.status, 400);
  assert.equal(machine.body.field, "source");
  const format = await post({ script_format: "poem" }, 13);
  assert.equal(format.status, 400);
  assert.equal(format.body.field, "script_format");
  const angle = await post({ angle_key: "Bad Key" }, 14);
  assert.equal(angle.status, 400);
  assert.equal(angle.body.field, "angle_key");
  const notMine = await post({ funnel_key: "their_funnel" }, 15);
  assert.equal(notMine.status, 400, "another company's funnel does not exist here");
  assert.equal(notMine.body.field, "funnel_key");
  const writeNow = await post({ write_now: "yes" }, 16);
  assert.equal(writeNow.status, 400);
  assert.equal(writeNow.body.field, "write_now");
  assert.equal(world.inserts.length, 0);
  assert.equal(world.outbox.length, 0, "a refused idea saves nothing, and queues no file");
  await assertRoleGate(ideasHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(17), raw_points: "An idea." }, rules: world.rules, deps });
});

test("POST marketing/ideas with write_now also queues a one-script batch and its start job under the cap, and keeps the idea with a plain note when a cap is reached", async () => {
  const world = ideasWorld();
  const deps = { wake: async () => ({}), env: {} };
  const result = await call(ideasHandler, {
    method: "POST", body: { request_id: REQ(20), raw_points: "Write this now.", funnel_key: "book_call", write_now: true }, rules: world.rules, deps,
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.idea.id, IDEA_ID);
  assert.equal(typeof result.body.batch_id, "string");
  assert.equal(result.body.job_id, JOB_ID);
  assert.equal(world.batches.length, 1);
  assert.equal(world.batches[0].params[1], ORG_ID);
  assert.equal(world.batches[0].params[0], result.body.batch_id);
  assertSqlHas(world.batches[0].sql, { onCommand: "'on_command'", planned: "'planned'" });
  assert.equal(world.jobs[0].kind, "start_batch");
  assert.equal(world.jobs[0].org_id, ORG_ID);
  assert.deepEqual(world.jobs[0].payload, { batch_id: result.body.batch_id, count: 1, funnel_key: "book_call", idea_ids: [IDEA_ID] });
  assert.deepEqual(world.ideaUpdates[0].params, [ORG_ID, [IDEA_ID], result.body.batch_id], "the idea is stamped with its batch so the weekly planner does not take it again");
  assertSqlHas(world.ideaUpdates[0].sql, { onlyFree: "AND batch_id IS NULL", company: "WHERE org_id = $1" });
  const cost = sqlCalls(result, /WITH bounds AS/)[0];
  assert.equal(cost.params[0], ORG_ID);
  assert.equal(cost.params[1], result.body.batch_id);

  const capped = ideasWorld();
  capped.cost = { month_priced_usd: "300", batch_priced_usd: "0" };
  const note = await call(ideasHandler, {
    method: "POST", body: { request_id: REQ(21), raw_points: "Write this now.", write_now: true }, rules: capped.rules, deps,
  });
  assert.equal(note.status, 200);
  assert.equal(note.body.idea.id, IDEA_ID, "the idea is kept");
  assert.match(note.body.note, /Your idea is saved\. It was not written now: .*month cap is \$300/);
  assert.equal(note.body.batch_id, undefined);
  assert.equal(capped.batches.length, 0);
  assert.equal(capped.jobs.length, 0, "nothing is queued when a cap is reached");
  assert.equal(capped.inserts.length, 1);
});

/* ── Write offer: marketing/offer/generate ─────────────────────────────────────────────────────────── */

function offerWorld({ jobs = [] } = {}) {
  const world = { jobs, inserts: [], failed: [], expired: [] };
  world.rules = [
    [/^\s*UPDATE marketing_jobs\s+SET status = 'failed', error = \$2, finished_at = now\(\)\s+WHERE org_id = \$1 AND kind = 'offer'/, (_sql, params) => {
      world.expired.push(params);
      return [];
    }],
    [/^\s*INSERT INTO marketing_jobs \(org_id, kind, payload, requested_by\)\s+VALUES \(\$1, 'offer'/, (sql, params) => {
      const inFlight = jobs.find((j) => j.org_id === params[0] && j.kind === "offer" && ["queued", "running"].includes(j.status));
      if (inFlight) return [];
      const row = { id: OFFER_JOB, org_id: params[0], kind: "offer", status: "queued", payload: JSON.parse(params[1]), requested_by: params[2], attempts: 0, created_at: NOW, claimed_at: null, finished_at: null, error: null, result: null };
      world.inserts.push({ sql, params, row });
      jobs.push(row);
      return [row];
    }],
    [/^\s*SELECT \* FROM marketing_jobs\s+WHERE org_id = \$1 AND kind = 'offer' AND status IN \('queued', 'running'\)/, (_sql, params) =>
      jobs.filter((j) => j.org_id === params[0] && j.kind === "offer" && ["queued", "running"].includes(j.status)).slice(0, 1)],
    [/^\s*UPDATE marketing_jobs\s+SET status = 'failed', error = \$3, result = \$4::jsonb/, (sql, params) => {
      world.failed.push({ sql, params });
      return [{ id: params[0] }];
    }],
    [/^\s*SELECT \* FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 AND kind = 'offer'/, (sql, params) => rowsWhere(jobs, sql, params)],
    [/^\s*SELECT \* FROM marketing_jobs WHERE org_id = \$1 AND kind = 'offer'\s+ORDER BY created_at DESC LIMIT 1/, (_sql, params) =>
      jobs.filter((j) => j.org_id === params[0] && j.kind === "offer").sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 1)],
    [/^\s*SELECT \* FROM marketing_jobs WHERE org_id = \$1 AND kind = 'offer' AND status = 'done'/, (_sql, params) =>
      jobs.filter((j) => j.org_id === params[0] && j.kind === "offer" && j.status === "done").sort((a, b) => new Date(b.finished_at) - new Date(a.finished_at)).slice(0, 1)],
  ];
  return world;
}

const INPUTS = { ok: true, inputs: { campaign: "partner", avatarSummary: "A buyer.", adResearchSummary: "", ownerNotes: "", sources: {}, cut: {} } };
const MODEL_ENV = { ANTHROPIC_API_KEY: "fake-model-key-not-real", URL: "https://example.test" };
const finishedOffer = (over = {}) => ({
  id: OFFER_JOB, org_id: ORG_ID, kind: "offer", status: "done", payload: { campaign: "partner" }, attempts: 1, requested_by: STAFF_ID,
  created_at: new Date("2026-10-13T10:00:00.000Z"), claimed_at: new Date("2026-10-13T10:00:05.000Z"), finished_at: new Date("2026-10-13T10:05:00.000Z"), error: null,
  result: { campaign: "partner", asOf: "2026-10-13", offer: { name: "The Capital Plan" }, reviewCard: { headline: "h" }, document: "# Offer", synthesized: true, winner: "A", runnerUp: "B", runoffAdvised: false, scores: {}, unjudged: [], candidates: [], counts: {}, checks: {}, inputs: {}, model: "m", usage: {} },
  ...over,
});

test("POST marketing/offer/generate saves one queued run for the session's company with the checked inputs, wakes the background writer, and gives a running run back instead of paying twice", async () => {
  const world = offerWorld();
  const wakes = [];
  const deps = { env: MODEL_ENV, resolveInputs: () => INPUTS, wake: async (args) => { wakes.push(args); return { ok: true }; } };
  const result = await call(offerHandler, { method: "POST", body: { campaign: "partner" }, rules: world.rules, deps });
  assert.equal(result.status, 202);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.started, true);
  assert.equal(result.body.already_running, false);
  assert.equal(result.body.job.id, OFFER_JOB);
  assert.equal(result.body.job.status, "queued");
  assert.equal(result.body.poll, `/api/marketing/offer/generate?id=${OFFER_JOB}`);
  assert.equal(world.inserts.length, 1);
  assert.equal(world.inserts[0].params[0], ORG_ID);
  assert.equal(world.inserts[0].params[2], STAFF_ID);
  const payload = JSON.parse(world.inserts[0].params[1]);
  assert.equal(payload.campaign, "partner");
  assert.equal(payload.avatarSummary, "A buyer.");
  assert.match(payload.today, /^\d{4}-\d{2}-\d{2}$/);
  assertSqlHas(world.inserts[0].sql, { oneInFlight: "ON CONFLICT (org_id) WHERE kind = 'offer' AND status IN ('queued', 'running') DO NOTHING" });
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].jobId, OFFER_JOB);
  assert.equal(world.expired[0][0], ORG_ID, "an old stuck run is closed for this company before a new one starts");

  const again = await call(offerHandler, { method: "POST", body: { campaign: "partner" }, rules: world.rules, deps });
  assert.equal(again.status, 202);
  assert.equal(again.body.started, false);
  assert.equal(again.body.already_running, true);
  assert.equal(again.body.job.id, OFFER_JOB);
  assert.equal(world.inserts.length, 1, "a double press cannot pay for two runs");
  assert.equal(wakes.length, 1);
});

test("POST marketing/offer/generate refuses with no model key, a bad input or campaign, and fails the saved run in plain words when the writer cannot be woken; the Mac runner waits instead", async () => {
  const world = offerWorld();
  const noKey = await call(offerHandler, { method: "POST", body: {}, rules: world.rules, deps: { env: {}, resolveInputs: () => INPUTS, wake: async () => ({ ok: true }) } });
  assert.equal(noKey.status, 503);
  assert.equal(noKey.body.error, "no_model");
  assert.equal(world.inserts.length, 0);

  const bad = await call(offerHandler, {
    method: "POST", body: {}, rules: world.rules,
    deps: { env: MODEL_ENV, resolveInputs: () => ({ ok: false, error: "avatar_required", message: "There is no buyer summary on file." }), wake: async () => ({ ok: true }) },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "avatar_required");
  assert.equal(world.inserts.length, 0, "nothing is saved for a request that cannot run");

  const unwoken = offerWorld();
  const failed = await call(offerHandler, {
    method: "POST", body: {}, rules: unwoken.rules, deps: { env: MODEL_ENV, resolveInputs: () => INPUTS, wake: async () => ({ ok: false, reason: "the worker answered 500" }) },
  });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "worker_unreachable");
  assert.match(failed.body.message, /The writer could not be started: the worker answered 500\. Nothing was written\./);
  assert.equal(failed.body.job.status, "failed");
  assert.deepEqual([unwoken.failed[0].params[0], unwoken.failed[0].params[1]], [OFFER_JOB, ORG_ID], "the saved run is closed so it cannot block the next press");

  const mac = offerWorld();
  const waiting = await call(offerHandler, {
    method: "POST", body: {}, rules: mac.rules,
    deps: { env: { ...MODEL_ENV, MARKETING_AI_RUNNER: "local" }, resolveInputs: () => INPUTS, wake: async () => { throw new Error("must not wake"); } },
  });
  assert.equal(waiting.status, 202);
  assert.equal(waiting.body.started, false);
  assert.equal(waiting.body.waiting_for, "mac");
  assert.equal(mac.inserts.length, 1);

  await assertRoleGate(offerHandler, ["owner", "admin"], { method: "POST", body: {}, rules: [], deps: { env: MODEL_ENV, resolveInputs: () => INPUTS, wake: async () => ({ ok: true }) } });
});

test("GET marketing/offer/generate reads one run back by id (this company's only), or the newest run and the newest finished offer, and says not ready before the table exists", async () => {
  const world = offerWorld({
    jobs: [
      finishedOffer(),
      { ...finishedOffer({ id: "0f000000-0000-4000-8000-000000000002", status: "running", result: null, finished_at: null, created_at: new Date("2026-10-14T09:00:00.000Z") }) },
      finishedOffer({ id: "0f000000-0000-4000-8000-0000000000aa", org_id: OTHER_ORG_ID }),
    ],
  });
  const one = await call(offerHandler, { query: { id: OFFER_JOB }, rules: world.rules, deps: { env: {} } });
  assert.equal(one.status, 200);
  assert.equal(one.body.job.id, OFFER_JOB);
  assert.equal(one.body.job.status, "done");
  assert.equal(one.body.offer.offer.name, "The Capital Plan");
  assert.equal(one.body.offer.winner, "A");
  assert.deepEqual(sqlCalls(one, /FROM marketing_jobs WHERE id = \$1/)[0].params, [OFFER_JOB, ORG_ID]);

  const other = await call(offerHandler, { query: { id: "0f000000-0000-4000-8000-0000000000aa" }, rules: world.rules, deps: { env: {} } });
  assert.equal(other.status, 404, "another company's run is not found");
  const badId = await call(offerHandler, { query: { id: "nope" }, rules: world.rules, deps: { env: {} } });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.error, "bad_id");

  const latest = await call(offerHandler, { rules: world.rules, deps: { env: {} } });
  assert.equal(latest.status, 200);
  assert.equal(latest.body.ready, true);
  assert.equal(latest.body.job.id, "0f000000-0000-4000-8000-000000000002", "the newest run of any state");
  assert.equal(latest.body.job.status, "running");
  assert.equal(latest.body.offer.job_id, OFFER_JOB, "and the newest finished offer");
  assertSqlHas(sqlCalls(latest, /status = 'done'/)[0].sql, { company: "WHERE org_id = $1", doneOnly: "status = 'done'" });

  const missingTable = await call(offerHandler, {
    rules: [[/FROM marketing_jobs/, new Error('relation "marketing_jobs" does not exist')]], deps: { env: {} },
  });
  assert.equal(missingTable.status, 200);
  assert.equal(missingTable.body.ready, false);
  assert.match(missingTable.body.message, /not live yet/);
  assert.equal(dataCalls(latest).every((c) => !/^\s*(INSERT|UPDATE|DELETE)/.test(c.sql)), true, "reading a run writes nothing");
});
