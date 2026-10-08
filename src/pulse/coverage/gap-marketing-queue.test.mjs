import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLOCK_INTERVAL_MS, RED_MULTIPLIER } from "./slice-03-marketing.mjs";
import {
  CHECK_IDS,
  EMPTY_FAIL_NOTES,
  FAILED_LOOKBACK_DAYS,
  JOB_READ_PATH,
  QUEUE_WAIT_MS,
  SKIPPED_KINDS,
  gapChecks,
  jobReadRouteAlive
} from "./gap-marketing-queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-marketing-queue.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

// A transaction that answers the way the real tables would for an empty, healthy
// company. It answers by what the SQL says, so a check that asks the wrong thing
// gets an error back instead of a canned row. Every statement is kept in `seen`.
function fakeTx({ counts = {}, kinds = {}, throwOn = null, seen = [] } = {}) {
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql: String(sql), params });
      const text = String(sql);
      if (throwOn && throwOn.pattern.test(text)) throw throwOn.err;
      if (/gap:stuck-queued/.test(text)) return { rows: [{ n: counts.stuck ?? 0, kinds: kinds.stuck ?? null }] };
      if (/gap:failed-no-note/.test(text)) return { rows: [{ n: counts.failed ?? 0, kinds: kinds.failed ?? null }] };
      if (/gap:job-read-settings/.test(text)) {
        return { rows: [{ enabled: false, max_batch_cost_usd: null, max_month_cost_usd: null }] };
      }
      if (/FROM orgs/.test(text)) return { rows: [{ id: ORG }] };
      if (/FROM marketing_heartbeats/.test(text)) return { rows: [] };
      if (/count\(\*\) FILTER \(WHERE status = 'queued'\)/.test(text)) return { rows: [{ queued: 0, running: 0 }] };
      if (/FROM marketing_jobs/.test(text) && /status = 'failed'/.test(text)) return { rows: [] };
      if (/FROM repo_outbox/.test(text)) {
        return { rows: [{ waiting: 0, oldest_waiting_at: null, last_error: null, last_commit_sha: null, last_commit_at: null }] };
      }
      if (/FROM ad_platform_connections/.test(text)) return { rows: [{ meta_synced_at: null }] };
      if (/FROM ad_metrics_daily/.test(text)) return { rows: [{ metrics_synced_at: null, latest_metrics_date: null }] };
      if (/FROM marketing_batches/.test(text)) return { rows: [] };
      if (/marketing_model_usage/.test(text)) return { rows: [{}] };
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

function scopeOf(tx) {
  return async (fn) => fn(tx);
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not start a paid model run/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
    assert.doesNotMatch(row.suggestedFix, /ad_metrics_daily|meta-campaign-sync/);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

const aliveRead = (rel) => {
  if (rel.endsWith("api.mjs")) {
    return [
      'import marketingHealth from "../../api/marketing/health.mjs";',
      '"marketing/health": marketingHealth,'
    ].join("\n");
  }
  if (rel.endsWith("health.mjs")) {
    return [
      "export async function readJobCounts() {}",
      "export default async function handler(req, res) {",
      "  if (req.method !== \"GET\") return;",
      "}"
    ].join("\n");
  }
  throw new Error(`unexpected read: ${rel}`);
};

const deadRead = (rel) => {
  if (rel.endsWith("api.mjs")) return "no marketing health route here";
  if (rel.endsWith("health.mjs")) return "export default async function handler() {}";
  throw new Error(`unexpected read: ${rel}`);
};

test("gap marketing queue: source stays read-only and uses the clock wait", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\b(callModel|runPass|enqueueJob|claimJobs|wakeWorker|wakeOfferWorker)\s*\(/);
  assert.doesNotMatch(SRC, /\b(getOrCreateSettings|beat)\s*\(/);
  assert.doesNotMatch(SRC, /ad_metrics_daily/);
  assert.doesNotMatch(SRC, /meta-campaign-sync/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  // No transaction control on the shared pool: the scope owns the transaction.
  assert.doesNotMatch(SRC, /["'`]\s*(BEGIN|COMMIT|ROLLBACK|SET)\b/i);
  assert.equal(QUEUE_WAIT_MS, CLOCK_INTERVAL_MS * RED_MULTIPLIER);
  assert.equal(QUEUE_WAIT_MS, 45 * 60 * 1000);
  assert.deepEqual([...SKIPPED_KINDS], ["meta_load"]);
  assert.equal(FAILED_LOOKBACK_DAYS, 7);
  assert.deepEqual([...CHECK_IDS], [
    "marketing-queue:stuck-queued",
    "marketing-queue:failed-no-note",
    "marketing-queue:read-api"
  ]);
});

test("gap marketing queue: no database and no fetch is three skips, never a PASS", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[2].detail, /no fetch and no database/);
});

test("gap marketing queue: a clear queue is three PASS rows, from the exact reads the health card makes", async () => {
  const tx = fakeTx();
  const rows = await gapChecks({
    scope: scopeOf(tx),
    orgId: ORG,
    now: NOW,
    fetchImpl: async () => ({ status: 401 })
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"), JSON.stringify(rows.map((r) => [r.id, r.status, r.detail])));
  assert.match(rows[2].detail, /answered 401/);
  assert.match(rows[2].detail, /health card's reads ran/);

  const stuck = tx.seen.find((c) => /gap:stuck-queued/.test(c.sql));
  assert.equal(stuck.params[0], ORG);
  assert.deepEqual(stuck.params[1], [...SKIPPED_KINDS]);
  assert.equal(stuck.params[2], "2026-10-08T14:15:00.000Z");
  assert.doesNotMatch(stuck.sql, /kind = ANY/);

  const failed = tx.seen.find((c) => /gap:failed-no-note/.test(c.sql));
  assert.deepEqual(failed.params[2], EMPTY_FAIL_NOTES.map((n) => `%${n}%`));
  assert.equal(failed.params[3], "2026-10-01T15:00:00.000Z");

  // The reads of GET marketing/health ran: heartbeats, job counts, outbox, last sync, batch, cost.
  const sqls = tx.seen.map((c) => c.sql);
  for (const part of [
    /FROM marketing_heartbeats/,
    /count\(\*\) FILTER \(WHERE status = 'queued'\)/,
    /FROM repo_outbox/,
    /FROM ad_platform_connections/,
    /FROM marketing_batches/,
    /marketing_model_usage/
  ]) {
    assert.ok(sqls.some((s) => part.test(s)), `the health card read ${part} did not run`);
  }
  // Nothing in the whole run writes.
  for (const s of sqls) assert.doesNotMatch(s.replace(/\/\*[\s\S]*?\*\//g, ""), /\b(insert|update|delete|truncate|drop|alter)\b/i);
});

test("gap marketing queue: a queued job past the wait is a FAIL and names its kind", async () => {
  const tx = fakeTx({ counts: { stuck: 2 }, kinds: { stuck: "start_batch, write_slot" } });
  const rows = await gapChecks({ scope: scopeOf(tx), orgId: ORG, now: NOW });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "marketing-queue:stuck-queued");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /2 jobs are still queued past the 45 minute wait \(start_batch, write_slot\)/);
  assert.ok(rows.filter((r) => r !== hit).every((r) => r.status !== "FAIL"));
});

test("gap marketing queue: one stuck job reads in the singular", async () => {
  const rows = await gapChecks({ scope: scopeOf(fakeTx({ counts: { stuck: 1 } })), orgId: ORG, now: NOW });
  assert.match(rows[0].detail, /1 job is still queued/);
});

test("gap marketing queue: a failed job with an empty note is a FAIL", async () => {
  const tx = fakeTx({ counts: { failed: 1 }, kinds: { failed: "funnel_push" } });
  const rows = await gapChecks({ scope: scopeOf(tx), orgId: ORG, now: NOW });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "marketing-queue:failed-no-note");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /1 failed job has no note \(funnel_push\)/);
  assert.match(hit.suggestedFix, /A failed job must say why/);
});

test("gap marketing queue: the placeholder reasonOf() writes is one of the notes it looks for", () => {
  assert.ok(EMPTY_FAIL_NOTES.includes("failed, no reason recorded"));
  // The wrapped note after three tries still contains it, so a LIKE match finds it.
  const wrapped = "Tried 3 times and it still failed. Last error: failed, no reason recorded";
  assert.ok(EMPTY_FAIL_NOTES.some((n) => wrapped.toLowerCase().includes(n)));
  const jobs = fs.readFileSync(path.join(HERE, "../../marketing/jobs.mjs"), "utf8");
  assert.ok(jobs.includes('"failed, no reason recorded"'), "jobs.mjs no longer writes the placeholder this check looks for");
});

test("gap marketing queue: a health-card read that throws is a read API 500, and the rest stay green", async () => {
  const tx = fakeTx({
    throwOn: { pattern: /FROM repo_outbox/, err: new Error("column repo_outbox.error is missing") }
  });
  const rows = await gapChecks({ scope: scopeOf(tx), orgId: ORG, now: NOW });
  rows.forEach(shape);
  const hit = rows.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /marketing job read API 500: column repo_outbox\.error is missing/);
  assert.ok(rows.filter((r) => r !== hit).every((r) => r.status === "PASS"));
});

test("gap marketing queue: a live GET 500 is FAIL, a 404 is FAIL, a 401 is not", async () => {
  const seen = [];
  const mk = (status) => async (url, opts) => {
    seen.push({ url, opts });
    return { status };
  };
  const base = { scope: scopeOf(fakeTx()), orgId: ORG, now: NOW, baseUrl: "https://fundhub.ai/" };
  const five = await gapChecks({ ...base, fetchImpl: mk(500) });
  five.forEach(shape);
  const hit = five.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /marketing job read API 500: GET \/api\/marketing\/health/);
  assert.equal(seen[0].url, `https://fundhub.ai${JOB_READ_PATH}`);
  assert.equal(seen[0].opts.method, "GET");
  assert.equal(seen[0].opts.body, undefined);

  const gone = await gapChecks({ ...base, fetchImpl: mk(404) });
  const notWired = gone.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(notWired.status, "FAIL");
  assert.match(notWired.detail, /read API down: GET \/api\/marketing\/health 404/);

  const ok = await gapChecks({ ...base, fetchImpl: mk(401) });
  assert.ok(ok.every((r) => r.status === "PASS"));

  const notReady = await gapChecks({ ...base, fetchImpl: mk(503) });
  assert.equal(notReady.find((r) => r.id === "marketing-queue:read-api").status, "skip");
});

test("gap marketing queue: a fetch that throws is FAIL, not PASS", async () => {
  const rows = await gapChecks({
    scope: scopeOf(fakeTx()),
    orgId: ORG,
    now: NOW,
    fetchImpl: async () => { throw new Error("socket hang up"); }
  });
  const hit = rows.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /unreachable/);
  assert.match(hit.detail, /socket hang up/);
});

test("gap marketing queue: the pulse's ctx.fetch name works when fetchImpl is not set", async () => {
  const seen = [];
  const rows = await gapChecks({
    scope: scopeOf(fakeTx()),
    orgId: ORG,
    now: NOW,
    fetch: async (url) => { seen.push(url); return { status: 401 }; }
  });
  assert.equal(seen.length, 1);
  assert.ok(rows.every((r) => r.status === "PASS"));
});

test("gap marketing queue: with only a fetch, the route probe alone can PASS", async () => {
  const rows = await gapChecks({ fetchImpl: async () => ({ status: 401 }) });
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "PASS"]);
  assert.match(rows[2].detail, /answered 401/);
  assert.doesNotMatch(rows[2].detail, /reads ran/);
});

test("gap marketing queue: a missing marketing_jobs table is skip, not a 500", async () => {
  const missing = Object.assign(new Error('relation "marketing_jobs" does not exist'), { code: "42P01" });
  const db = {
    async query(sql) {
      if (/FROM orgs/.test(String(sql))) return { rows: [{ id: ORG }] };
      throw missing;
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[2].detail, /not a 500/);
});

test("gap marketing queue: a read error is FAIL, not a throw", async () => {
  const db = {
    async query() {
      throw new Error("connection refused");
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /connection refused/);
  assert.match(rows[2].detail, /marketing job read API 500/);
});

test("gap marketing queue: the staff scope is used when the pulse has one, and db is left alone", async () => {
  let dbCalls = 0;
  const db = { async query() { dbCalls += 1; return { rows: [] }; } };
  const tx = fakeTx();
  await gapChecks({ db, scope: scopeOf(tx), orgId: ORG, now: NOW });
  assert.equal(dbCalls, 0);
  assert.ok(tx.seen.length >= 3);
});

test("gap marketing queue: no orgId in ctx falls back to the default company", async () => {
  const tx = fakeTx();
  const rows = await gapChecks({ scope: scopeOf(tx), now: NOW });
  assert.ok(tx.seen.some((c) => /FROM orgs/.test(c.sql)));
  assert.ok(rows.every((r) => r.status === "PASS"));
  const stuck = tx.seen.find((c) => /gap:stuck-queued/.test(c.sql));
  assert.equal(stuck.params[0], ORG);
});

test("gap marketing queue: no company at all is a skip with the reason, not a PASS", async () => {
  const db = { async query() { return { rows: [] }; } };
  const rows = await gapChecks({ db, now: NOW });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /no company/);
  assert.equal(rows[1].status, "skip");
});

test("gap marketing queue: the repo-level route proof still holds and does not start a model", () => {
  assert.equal(jobReadRouteAlive(), true);
  assert.equal(jobReadRouteAlive(aliveRead), true);
  assert.equal(jobReadRouteAlive(deadRead), false);
});
