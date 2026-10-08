import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLOCK_INTERVAL_MS, RED_MULTIPLIER } from "./slice-03-marketing.mjs";
import {
  CHECK_IDS,
  EMPTY_FAIL_NOTES,
  JOB_READ_PATH,
  QUEUE_KINDS,
  QUEUE_WAIT_MS,
  gapChecks,
  jobReadRouteAlive
} from "./gap-marketing-queue.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-marketing-queue.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

function fakeDb(counts, { throwOn } = {}) {
  return {
    async query(sql) {
      if (throwOn && throwOn.pattern.test(sql)) throw throwOn.err;
      if (/gap:stuck-queued/.test(sql)) return { rows: [{ n: counts.stuck ?? 0 }] };
      if (/gap:failed-no-note/.test(sql)) return { rows: [{ n: counts.failed ?? 0 }] };
      if (/gap:job-read/.test(sql)) return { rows: [{ queued: 0, running: 0 }] };
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
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

test("gap marketing queue: source stays read-only and uses the clock wait", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\b(callModel|runPass|enqueueJob|claimJobs|wakeWorker|wakeOfferWorker)\s*\(/);
  assert.doesNotMatch(SRC, /ad_metrics_daily/);
  assert.doesNotMatch(SRC, /meta-campaign-sync/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.equal(QUEUE_WAIT_MS, CLOCK_INTERVAL_MS * RED_MULTIPLIER);
  assert.equal(QUEUE_WAIT_MS, 45 * 60 * 1000);
  assert.deepEqual([...QUEUE_KINDS], [
    "write_slot", "fix_script", "funnel", "avatar", "flywheel_stage", "deep_research", "offer"
  ]);
  assert.equal(QUEUE_KINDS.includes("meta_load"), false);
  assert.deepEqual([...CHECK_IDS], [
    "marketing-queue:stuck-queued",
    "marketing-queue:failed-no-note",
    "marketing-queue:read-api"
  ]);
});

test("gap marketing queue: no database skips the two row reads and still checks the route", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "PASS"]);
  assert.match(rows[2].detail, /GET \/api\/marketing\/health/);
});

test("gap marketing queue: a clear queue is three PASS rows", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      return { rows: [{ n: 0 }] };
    }
  };
  const rows = await gapChecks({
    db,
    orgId: ORG,
    now: NOW,
    readText: aliveRead
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(seen.length, 3);
  for (const call of seen) {
    assert.match(call.sql, /^\s*\/\* gap:/);
    assert.doesNotMatch(call.sql, /\b(insert|update|delete|drop)\b/i);
    assert.doesNotMatch(call.sql, /ad_metrics_daily/);
    assert.equal(call.params[0], ORG);
    assert.deepEqual(call.params[1], [...QUEUE_KINDS]);
  }
  const stuck = seen.find((c) => /gap:stuck-queued/.test(c.sql));
  assert.equal(stuck.params[2], "2026-10-08T14:15:00.000Z");
  const failed = seen.find((c) => /gap:failed-no-note/.test(c.sql));
  assert.deepEqual(failed.params[2], [...EMPTY_FAIL_NOTES]);
});

test("gap marketing queue: each named break is a FAIL and the others stay PASS", async () => {
  const cases = [
    { counts: { stuck: 2 }, id: "marketing-queue:stuck-queued", detail: /2 jobs are still queued past the 45 minute wait/ },
    { counts: { failed: 1 }, id: "marketing-queue:failed-no-note", detail: /1 failed job has no note/ },
    {
      counts: {},
      id: "marketing-queue:read-api",
      detail: /marketing job read API 500/,
      throwOn: { pattern: /gap:job-read/, err: new Error("column marketing_jobs.error is missing") }
    }
  ];
  for (const c of cases) {
    const rows = await gapChecks({
      db: fakeDb(c.counts, { throwOn: c.throwOn }),
      orgId: ORG,
      now: NOW,
      readText: aliveRead
    });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === c.id);
    assert.equal(hit.status, "FAIL");
    assert.match(hit.detail, c.detail);
    const rest = rows.filter((r) => r.id !== c.id);
    assert.ok(rest.every((r) => r.status === "PASS"));
  }
});

test("gap marketing queue: a dead job read route is FAIL and does not call the network", async () => {
  let called = false;
  const rows = await gapChecks({
    db: fakeDb({}),
    orgId: ORG,
    now: NOW,
    readText: deadRead,
    fetchImpl: async () => {
      called = true;
      return { status: 200 };
    }
  });
  rows.forEach(shape);
  const route = rows.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(route.status, "FAIL");
  assert.match(route.detail, /route is dead/);
  assert.match(route.suggestedFix, /\/api\/marketing\/health/);
  assert.equal(called, false);
  assert.ok(rows.filter((r) => r.id !== route.id).every((r) => r.status === "PASS"));
  assert.equal(jobReadRouteAlive(deadRead), false);
  assert.equal(jobReadRouteAlive(aliveRead), true);
});

test("gap marketing queue: a live GET 500 is FAIL and a 401 is not", async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, opts });
    return { status: 500 };
  };
  const bad = await gapChecks({
    db: fakeDb({}),
    orgId: ORG,
    now: NOW,
    readText: aliveRead,
    fetchImpl,
    baseUrl: "https://fundhub.ai/"
  });
  bad.forEach(shape);
  const hit = bad.find((r) => r.id === "marketing-queue:read-api");
  assert.equal(hit.status, "FAIL");
  assert.match(hit.detail, /marketing job read API 500: GET \/api\/marketing\/health/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://fundhub.ai${JOB_READ_PATH}`);
  assert.equal(seen[0].opts.method, "GET");
  assert.equal(bad.filter((r) => r.id !== hit.id).every((r) => r.status === "PASS"), true);

  const ok = await gapChecks({
    db: fakeDb({}),
    orgId: ORG,
    now: NOW,
    readText: aliveRead,
    fetchImpl: async () => ({ status: 401 })
  });
  ok.forEach(shape);
  assert.ok(ok.every((r) => r.status === "PASS"));
});

test("gap marketing queue: a missing marketing_jobs table is skip, not a 500", async () => {
  const missing = Object.assign(new Error('relation "marketing_jobs" does not exist'), { code: "42P01" });
  const db = {
    async query() {
      throw missing;
    }
  };
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readText: aliveRead });
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
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, readText: aliveRead });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /connection refused/);
  assert.match(rows[2].detail, /marketing job read API 500/);
});

test("gap marketing queue: the live health door is still wired and does not start a model", () => {
  assert.equal(jobReadRouteAlive(), true);
});
