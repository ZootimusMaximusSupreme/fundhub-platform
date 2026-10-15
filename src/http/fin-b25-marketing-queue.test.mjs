// Finish-the-853 batch 25, practice tests for three Command Center machine doors: the health card
// (clock, worker, queue, outbox, model cost against the caps), the Retry button on a failed step, and
// how each ad video's Meta load is doing. Each test runs the REAL api/ handler over a stand-in database
// that answers by the SQL text the code sends. Fake data only. No GitHub, no Meta, no worker.
import assert from "node:assert/strict";
import test from "node:test";

import healthHandler from "../../api/marketing/health.mjs";
import retryHandler from "../../api/marketing/jobs/retry.mjs";
import loadStatusHandler from "../../api/marketing/meta/load-status.mjs";
import { worstCaseUsd } from "../marketing/model-usage.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, assertRoleGate, assertSqlHas, call, dataCalls, requestLog, sqlCalls,
} from "../testing/fin-b25-kit.mjs";

const REQ = (n) => `req-${String(n).padStart(8, "0")}`;
const NOW = new Date("2026-10-14T18:00:00.000Z");
const JOB_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_JOB = "10000000-0000-4000-8000-0000000000aa";
const BATCH_ID = "ba000000-0000-4000-8000-000000000001";

/* ── the health card: marketing/health ─────────────────────────────────────────────────────────────── */

function healthWorld(over = {}) {
  const world = {
    settings: { org_id: ORG_ID, enabled: true, max_batch_cost_usd: 40, max_month_cost_usd: 300, batch_weekday: 1, batch_time: "07:00:00", timezone: "America/Phoenix", updated_at: NOW },
    beats: [
      { org_id: ORG_ID, name: "clock", last_at: new Date("2026-10-14T17:45:00.000Z"), detail: {} },
      { org_id: ORG_ID, name: "worker", last_at: new Date("2026-10-14T17:50:00.000Z"), detail: {} },
      { org_id: ORG_ID, name: "outbox_drain", last_at: new Date("2026-10-14T17:55:00.000Z"), detail: { held_reason: "dry_run" } },
      { org_id: OTHER_ORG_ID, name: "clock", last_at: new Date("2020-01-01T00:00:00.000Z"), detail: {} },
    ],
    counts: { queued: "3", running: "1" },
    failed: [
      { kind: "write_slot", error: "model cap reached", at: new Date("2026-10-14T16:00:00.000Z") },
      { kind: "meta_load", error: "Meta refused the video", at: new Date("2026-10-14T12:00:00.000Z") },
    ],
    outbox: { waiting: "2", oldest_waiting_at: new Date("2026-10-14T15:00:00.000Z"), last_error: null, last_commit_sha: "abc1234", last_commit_at: new Date("2026-10-14T14:00:00.000Z") },
    metaSyncedAt: new Date("2026-10-14T16:30:00.000Z"),
    metricsSyncedAt: new Date("2026-10-14T17:00:00.000Z"),
    lastBatchId: BATCH_ID,
    cost: { month_priced_usd: "12.5", batch_priced_usd: "4.25" },
    beatsWritten: [],
    ...over,
  };
  world.rules = [
    [/^\s*INSERT INTO marketing_settings \(org_id\) VALUES/, []],
    [/^\s*SELECT \* FROM marketing_settings WHERE org_id = \$1/, (sql, params) => rowsWhere([world.settings], sql, params)],
    [/^\s*INSERT INTO marketing_heartbeats/, (_sql, params) => { world.beatsWritten.push(params); return []; }],
    [/^\s*SELECT name, last_at, detail FROM marketing_heartbeats WHERE org_id = \$1/, (sql, params) => rowsWhere(world.beats, sql, params)],
    [/count\(\*\) FILTER \(WHERE status = 'queued'\)::int\s+AS queued/, () => [world.counts]],
    [/AND status = 'failed'\s+AND COALESCE\(finished_at, updated_at\) > now\(\)/, () => world.failed],
    [/\(SELECT count\(\*\) FROM repo_outbox WHERE org_id = \$1 AND committed_sha IS NULL\)::int AS waiting/, () => [world.outbox]],
    [/^\s*SELECT max\(last_synced_at\) AS meta_synced_at/, () => [{ meta_synced_at: world.metaSyncedAt }]],
    [/^\s*SELECT max\(synced_at\) AS metrics_synced_at/, () => [{ metrics_synced_at: world.metricsSyncedAt, latest_metrics_date: "2026-10-13" }]],
    [/^\s*SELECT id FROM marketing_batches WHERE org_id = \$1 ORDER BY created_at DESC/, () => (world.lastBatchId ? [{ id: world.lastBatchId }] : [])],
    [/WITH bounds AS/, () => [world.cost]],
  ];
  return world;
}

test("GET marketing/health answers the clock, the worker queue, the outbox, the last sync and the model cost against the caps, for this company only", async () => {
  const world = healthWorld();
  const result = await call(healthHandler, { rules: world.rules, deps: { env: { GITHUB_REPO_TOKEN: "fake-not-a-real-token" } } });
  assert.equal(result.status, 200);
  const body = result.body;
  assert.deepEqual(body.clock, { last_tick_at: "2026-10-14T17:45:00.000Z", enabled: true }, "the other company's older beat is not shown");
  assert.deepEqual(body.worker, {
    last_run_at: "2026-10-14T17:50:00.000Z",
    queued: 3,
    running: 1,
    failed_24h: [
      { kind: "write_slot", error: "model cap reached", at: "2026-10-14T16:00:00.000Z" },
      { kind: "meta_load", error: "Meta refused the video", at: "2026-10-14T12:00:00.000Z" },
    ],
  });
  assert.deepEqual(body.outbox, {
    waiting: 2,
    oldest_waiting_at: "2026-10-14T15:00:00.000Z",
    last_commit_sha: "abc1234",
    last_commit_at: "2026-10-14T14:00:00.000Z",
    last_error: null,
    token_present: true,
    held_reason: "dry_run",
  });
  assert.deepEqual(body.sync, { last_sync_at: "2026-10-14T17:00:00.000Z" }, "the later of the Meta sync and the newest saved ad-day");
  assert.deepEqual(body.model, { month_cost_usd: 12.5, max_month_cost_usd: 300, last_batch_cost_usd: 4.25, max_batch_cost_usd: 40 });
  assert.match(body.as_of, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(JSON.stringify(body).includes("fake-not-a-real-token"), false, "the token's value is never in the answer");

  const beat = world.beatsWritten[0];
  assert.deepEqual(beat.slice(0, 2), ["page_seen", [ORG_ID]], "the caller's visit is saved as a heartbeat for this company");
  assert.deepEqual(JSON.parse(beat[2][0]), { staff_id: STAFF_ID, role: "owner" });
  const counts = sqlCalls(result, /AS queued/)[0];
  assert.deepEqual(counts.params, [ORG_ID]);
  assertSqlHas(counts.sql, { company: "WHERE org_id = $1", noOffer: "kind <> 'offer'" });
  const failed = sqlCalls(result, /status = 'failed'/)[0];
  assert.deepEqual(failed.params, [ORG_ID, 24, 20]);
  assertSqlHas(failed.sql, { company: "WHERE org_id = $1", noOffer: "kind <> 'offer'", newest: "ORDER BY COALESCE(finished_at, updated_at) DESC, id" });
  const outbox = sqlCalls(result, /FROM repo_outbox/)[0];
  assert.deepEqual(outbox.params, [ORG_ID]);
  assertSqlHas(outbox.sql, { waitingOnly: "committed_sha IS NULL", company: "WHERE org_id = $1" });
  const cost = sqlCalls(result, /WITH bounds AS/)[0];
  assert.equal(cost.params[0], ORG_ID);
  assert.equal(cost.params[1], BATCH_ID, "the cost is read for the newest batch");
});

test("GET marketing/health keeps unknowns honest: no batch means no batch cost, no token says no_token, a masked token is not a token, unpriced calls count at the highest rate", async () => {
  const unpriced = { input_tokens: 1000000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  const world = healthWorld({
    lastBatchId: null,
    beats: [],
    settings: { org_id: ORG_ID, enabled: false, max_batch_cost_usd: null, max_month_cost_usd: 250 },
    metaSyncedAt: null,
    metricsSyncedAt: null,
    outbox: { waiting: 0, oldest_waiting_at: null, last_error: null, last_commit_sha: null, last_commit_at: null },
    failed: [],
    counts: { queued: 0, running: 0 },
    cost: { month_priced_usd: "10", month_null_input: unpriced.input_tokens, month_null_output: 0, month_null_cache_read: 0, month_null_cache_write: 0, unpriced_rows: 1 },
  });
  const noToken = await call(healthHandler, { rules: world.rules, deps: { env: {} } });
  assert.equal(noToken.status, 200);
  assert.deepEqual(noToken.body.clock, { last_tick_at: null, enabled: false });
  assert.equal(noToken.body.worker.last_run_at, null);
  assert.equal(noToken.body.outbox.token_present, false);
  assert.equal(noToken.body.outbox.held_reason, "no_token");
  assert.equal(noToken.body.sync.last_sync_at, null);
  assert.equal(noToken.body.model.last_batch_cost_usd, null, "no batch yet: unknown, not 0");
  assert.equal(noToken.body.model.max_batch_cost_usd, null);
  assert.equal(noToken.body.model.max_month_cost_usd, 250);
  assert.equal(noToken.body.model.month_cost_usd, Math.round((10 + worstCaseUsd(unpriced)) * 1e6) / 1e6, "a call with no known price is counted at the highest known rate, never as free");
  assert.ok(noToken.body.model.month_cost_usd > 10);

  const masked = await call(healthHandler, { rules: healthWorld().rules, deps: { env: { GITHUB_REPO_TOKEN: "****************abcd" } } });
  assert.equal(masked.body.outbox.token_present, false);
  assert.equal(masked.body.outbox.held_reason, "no_token");

  const stuck = healthWorld({
    outbox: { waiting: 4, oldest_waiting_at: new Date("2026-10-14T01:00:00.000Z"), last_error: null, last_commit_sha: null, last_commit_at: null },
    beats: [{ org_id: ORG_ID, name: "outbox_drain", last_at: NOW, detail: { error: "GitHub said 502" } }],
  });
  const withDrainError = await call(healthHandler, { rules: stuck.rules, deps: { env: { GITHUB_REPO_TOKEN: "fake-not-a-real-token" } } });
  assert.equal(withDrainError.body.outbox.last_error, "GitHub said 502", "a waiting row with no error of its own shows the drain's error");
  assert.equal(withDrainError.body.outbox.held_reason, null);
  assert.equal(dataCalls(withDrainError).filter((c) => /^\s*(UPDATE|DELETE)/.test(c.sql)).length, 0);
  await assertRoleGate(healthHandler, ["owner", "admin"], { rules: world.rules, deps: { env: {} } });
});

/* ── the Retry button: marketing/jobs/retry ────────────────────────────────────────────────────────── */

function retryWorld(jobs) {
  const log = requestLog();
  const world = { jobs, log, retried: [], lockReads: [] };
  world.rules = [
    ...log.rules,
    [/^\s*SELECT id, kind, status FROM marketing_jobs WHERE id = \$1 AND org_id = \$2 FOR UPDATE/, (sql, params) => {
      world.lockReads.push({ sql, params });
      return rowsWhere(jobs, sql, params).map(({ id, kind, status }) => ({ id, kind, status }));
    }],
    [/^\s*UPDATE marketing_jobs\s+SET status = 'queued', attempts = 0, error = NULL/, (sql, params) => {
      world.retried.push({ sql, params });
      const hit = jobs.filter((j) => j.id === params[0] && j.org_id === params[1] && j.status === "failed" && params[2].includes(j.kind));
      for (const job of hit) Object.assign(job, { status: "queued", attempts: 0, error: null });
      return hit;
    }],
  ];
  return world;
}

test("POST marketing/jobs/retry puts one failed step of this company back in the queue clean, wakes the worker, and a repeated request_id changes nothing", async () => {
  const world = retryWorld([
    { id: JOB_ID, org_id: ORG_ID, kind: "write_slot", status: "failed", attempts: 3, error: "Tried 3 times" },
    { id: OTHER_JOB, org_id: OTHER_ORG_ID, kind: "write_slot", status: "failed", attempts: 3, error: "x" },
  ]);
  const woke = [];
  const deps = { wake: async (env) => { woke.push(env); return {}; }, env: { MARK: "1" } };
  const result = await call(retryHandler, { method: "POST", body: { request_id: REQ(1), job_id: JOB_ID }, rules: world.rules, deps });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true, job: { id: JOB_ID, kind: "write_slot", status: "queued" } });
  assert.equal(world.jobs[0].status, "queued");
  assert.equal(world.jobs[0].attempts, 0);
  assert.equal(world.jobs[0].error, null);
  assert.equal(world.jobs[1].status, "failed", "another company's failed job is untouched");
  assert.deepEqual(world.lockReads[0].params, [JOB_ID, ORG_ID]);
  assertSqlHas(world.lockReads[0].sql, { company: "WHERE id = $1 AND org_id = $2", locked: "FOR UPDATE" });
  const retry = world.retried[0];
  assert.deepEqual(retry.params.slice(0, 2), [JOB_ID, ORG_ID]);
  assert.ok(retry.params[2].includes("write_slot") && !retry.params[2].includes("offer"), "never the offer kind");
  assertSqlHas(retry.sql, { onlyFailed: "AND status = 'failed'", noOffer: "AND kind <> 'offer'", company: "WHERE id = $1 AND org_id = $2" });
  assert.deepEqual(woke, [{ MARK: "1" }]);

  const again = await call(retryHandler, { method: "POST", body: { request_id: REQ(1), job_id: JOB_ID }, rules: world.rules, deps });
  assert.deepEqual(again.body, result.body);
  assert.equal(world.retried.length, 1, "a repeated request_id changes nothing");
});

test("POST marketing/jobs/retry refuses a step that has not failed, another company's step, an offer step, a kind the worker does not know, and a bad id", async () => {
  const world = retryWorld([
    { id: JOB_ID, org_id: ORG_ID, kind: "write_slot", status: "running" },
    { id: "10000000-0000-4000-8000-000000000002", org_id: ORG_ID, kind: "write_slot", status: "done" },
    { id: "10000000-0000-4000-8000-000000000003", org_id: ORG_ID, kind: "offer", status: "failed" },
    { id: "10000000-0000-4000-8000-000000000004", org_id: ORG_ID, kind: "mystery_kind", status: "failed" },
    { id: OTHER_JOB, org_id: OTHER_ORG_ID, kind: "write_slot", status: "failed" },
  ]);
  const deps = { wake: async () => ({}), env: {} };
  const post = (jobId, n) => call(retryHandler, { method: "POST", body: { request_id: REQ(n), job_id: jobId }, rules: world.rules, deps });

  const running = await post(JOB_ID, 10);
  assert.equal(running.status, 400);
  assert.equal(running.body.field, "job_id");
  assert.match(running.body.message, /waiting or running/);
  const done = await post("10000000-0000-4000-8000-000000000002", 11);
  assert.equal(done.status, 400);
  assert.match(done.body.message, /already finished/);
  const offer = await post("10000000-0000-4000-8000-000000000003", 12);
  assert.equal(offer.status, 404, "the Write offer button has its own path");
  const unknown = await post("10000000-0000-4000-8000-000000000004", 13);
  assert.equal(unknown.status, 404);
  const other = await post(OTHER_JOB, 14);
  assert.equal(other.status, 404, "another company's job is not found");
  assert.equal(world.retried.length, 0);
  const bad = await post("not-a-uuid", 15);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "job_id");
  const noRequest = await call(retryHandler, { method: "POST", body: { job_id: JOB_ID }, rules: world.rules, deps });
  assert.equal(noRequest.status, 400);
  assert.equal(noRequest.body.field, "request_id");
  await assertRoleGate(retryHandler, ["owner", "admin"], { method: "POST", body: { request_id: REQ(16), job_id: JOB_ID }, rules: world.rules, deps });
});

/* ── how each ad video's Meta load is doing: marketing/meta/load-status ────────────────────────────── */

test("GET marketing/meta/load-status answers one row per ad video asked to load with its state in plain words, never calls Meta, and reads this company only", async () => {
  const base = { org_id: ORG_ID, load_error: null, meta_video_id: null, meta_creative_id: null, meta_ad_external_id: null, loaded_at: null, take_no: 1,
    angle: "Say the cause first", funnel_key: "book_call", job_status: null, job_error: null, job_result: null, ad_row_id: null, ad_status: null,
    funnel_ad_set: "230000000000000001", ad_set_external_id: null, ad_set_name: null, ad_set_status: null, campaign_external_id: null, campaign_status: null };
  const rows = [
    { ...base, id: "d0000000-0000-4000-8000-000000000001", ad_id: "91", job_status: "queued" },
    { ...base, id: "d0000000-0000-4000-8000-000000000002", ad_id: "92", job_status: "running", meta_video_id: "v-1" },
    { ...base, id: "d0000000-0000-4000-8000-000000000003", ad_id: "93", job_status: "done", meta_video_id: "v-2", meta_creative_id: "c-2", meta_ad_external_id: "a-2", loaded_at: "2026-10-14T15:00:00.000Z",
      ad_row_id: "ad-row-3", ad_status: "PAUSED", ad_set_external_id: "230000000000000009", ad_set_name: "Broad", ad_set_status: "ACTIVE", campaign_external_id: "120200000000000001", campaign_status: "ACTIVE" },
    { ...base, id: "d0000000-0000-4000-8000-000000000004", ad_id: "94", job_status: "done", job_result: { state: "refused", reasons: ["The ad set is paused.", "No pixel."] } },
    { ...base, id: "d0000000-0000-4000-8000-000000000005", ad_id: "95", job_status: "failed", job_error: "Meta said the video is too long" },
    { ...base, id: "d0000000-0000-4000-8000-000000000006", ad_id: "96", job_status: "queued", job_error: "Meta was busy", meta_video_id: "v-6" },
    { ...base, id: "d0000000-0000-4000-8000-000000000007", org_id: OTHER_ORG_ID, ad_id: "97", job_status: "queued" },
  ];
  const syncedAt = new Date("2026-10-14T16:00:00.000Z");
  const result = await call(loadStatusHandler, {
    rules: [
      [/FROM ad_videos v\s+LEFT JOIN ad_scripts s/, (_sql, params) => rows.filter((r) => r.org_id === params[0])],
      [/^\s*SELECT max\(last_synced_at\) AS meta_synced_at/, () => [{ meta_synced_at: syncedAt }]],
      [/^\s*SELECT max\(synced_at\) AS metrics_synced_at/, () => [{ metrics_synced_at: new Date("2026-10-14T17:00:00.000Z"), latest_metrics_date: "2026-10-13" }]],
    ],
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.as_of, syncedAt.toISOString(), "as_of is the last Meta pull, not the newest saved ad-day");
  const byAd = Object.fromEntries(result.body.loads.map((l) => [l.ad_number, l]));
  assert.deepEqual(Object.keys(byAd).sort(), ["91", "92", "93", "94", "95", "96"], "another company's ad video is not listed");
  assert.equal(byAd["91"].state, "waiting");
  assert.equal(byAd["91"].step, null);
  assert.equal(byAd["92"].state, "loading");
  assert.equal(byAd["92"].step, "waiting for Meta");
  assert.equal(byAd["93"].state, "loaded");
  assert.equal(byAd["93"].loaded_at, "2026-10-14T15:00:00.000Z");
  assert.deepEqual(byAd["93"].ad_set, { external_id: "230000000000000009", status: "ACTIVE", name: "Broad" });
  assert.deepEqual(byAd["93"].campaign, { external_id: "120200000000000001", status: "ACTIVE" });
  assert.equal(byAd["93"].ad_status, "PAUSED");
  assert.equal(byAd["94"].state, "refused");
  assert.deepEqual(byAd["94"].reasons, ["The ad set is paused.", "No pixel."]);
  assert.equal(byAd["95"].state, "failed");
  assert.deepEqual(byAd["95"].reasons, ["Meta said the video is too long"]);
  assert.equal(byAd["96"].state, "loading");
  assert.match(byAd["96"].reasons[0], /Trying again soon\. Last time: Meta was busy/);
  assert.deepEqual(byAd["91"].ad_set, { external_id: "230000000000000001", status: null, name: null }, "an ad not built yet shows the funnel's default ad set");
  assert.equal(byAd["91"].campaign, null);
  assert.equal(byAd["91"].angle, "Say the cause first");

  const [read] = sqlCalls(result, /FROM ad_videos v/);
  assert.deepEqual(read.params, [ORG_ID]);
  assertSqlHas(read.sql, {
    company: "WHERE v.org_id = $1",
    jobCompany: "mj.org_id = v.org_id AND mj.kind = 'meta_load'",
    inFlightFirst: "ORDER BY (mj.status IN ('queued', 'running')) DESC, mj.created_at DESC",
    adSetCompany: "WHERE x.org_id = v.org_id",
  });
  assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)/.test(c.sql)), true, "a read writes nothing");
  await assertRoleGate(loadStatusHandler, ["owner", "admin"], { rules: [] });
  const post = await call(loadStatusHandler, { method: "POST", rules: [] });
  assert.equal(post.status, 405);
});
