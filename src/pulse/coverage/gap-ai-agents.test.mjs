import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BLAND_LOOKBACK_MS,
  BLAND_SQL,
  CHECK_ID,
  FAIL_OUTCOMES,
  FAILED_RUN_SQL,
  RECON_CODE,
  RECON_TRIGGER,
  RETIRED_SQL,
  RETRY_GRACE_MS,
  gapChecks,
  judge
} from "./gap-ai-agents.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-ai-agents.mjs"), "utf8");

const NOW = new Date("2026-10-08T18:00:00.000Z");
const OLD = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const YOUNG = new Date(NOW.getTime() - 60 * 1000).toISOString();

function shape(row) {
  assert.equal(row.id, CHECK_ID);
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok(row.suggestedFix == null || typeof row.suggestedFix === "string");
  assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
}

function fakeDb({ retired = [], failed = [], bland = [], failSql = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (failSql && failSql.test(text)) throw new Error(failSql.message || "read failed");
      if (text.startsWith("BEGIN") || text.startsWith("ROLLBACK")) return { rows: [] };
      if (text.includes("FROM agents")) return { rows: retired };
      if (text.includes("FROM agent_runs")) return { rows: failed };
      if (text.includes("webhook_captures")) return { rows: bland };
      return { rows: [] };
    }
  };
}

test("one tripwire, and the file only reads", () => {
  assert.equal(CHECK_ID, "ai-agents");
  assert.equal(RECON_CODE, "AG-07");
  assert.equal(RECON_TRIGGER, "cron.daily-pulse");
  assert.equal(RETRY_GRACE_MS, 15 * 60 * 1000);
  assert.equal(BLAND_LOOKBACK_MS, 24 * 60 * 60 * 1000);
  assert.ok(FAIL_OUTCOMES.includes("runtime_error"));
  assert.ok(FAIL_OUTCOMES.includes("bland_rejected"));
  assert.match(RETIRED_SQL, /AG-07/);
  assert.match(RETIRED_SQL, /GHL-%/);
  assert.match(RETIRED_SQL, /agent_triggers/);
  assert.match(FAILED_RUN_SQL, /cron\.daily-pulse/);
  assert.match(FAILED_RUN_SQL, /NOT EXISTS/);
  assert.match(FAILED_RUN_SQL, /retry of /);
  assert.match(BLAND_SQL, /provider = 'bland'/);
  assert.match(SRC, /BEGIN READ ONLY/);
  assert.match(SRC, /ROLLBACK/);
  assert.match(SRC, /method:\s*"GET"/);
  assert.doesNotMatch(SRC, /method:\s*"POST"/);
  assert.doesNotMatch(SRC, /placeCall/);
  assert.doesNotMatch(SRC, /\bINSERT\b/);
  assert.doesNotMatch(SRC, /\bUPDATE\b/);
  assert.doesNotMatch(SRC, /\bDELETE\b/);
  assert.doesNotMatch(SRC, /from "\.\.\/registry\.mjs"/);
  assert.doesNotMatch(SRC, /slice-24-agents/);
});

test("no database and no route probe is a skip", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 1);
  shape(rows[0]);
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[0].suggestedFix, null);
});

test("clean agent rows pass, and a GET 405 is not a failure", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  assert.equal(rows.length, 1);
  shape(rows[0]);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[0].suggestedFix, null);
  assert.match(rows[0].detail, /405/);
  assert.ok(db.calls.some((c) => c.sql.startsWith("BEGIN READ ONLY")));
  assert.ok(db.calls.some((c) => c.sql === "ROLLBACK"));
  const failedCall = db.calls.find((c) => c.sql.includes("FROM agent_runs"));
  assert.ok(failedCall);
  assert.equal(failedCall.params[0].toISOString(), new Date(NOW.getTime() - RETRY_GRACE_MS).toISOString());
  assert.deepEqual(failedCall.params[1], FAIL_OUTCOMES);
});

test("a retired agent that still has a trigger fails", async () => {
  const db = fakeDb({ retired: [{ code: "DOC-CHECK", status: "retired" }] });
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  shape(rows[0]);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /DOC-CHECK/);
  assert.match(rows[0].detail, /retired/);
  assert.match(rows[0].suggestedFix, /Leave the phone alone/);
  assert.match(rows[0].suggestedFix, /Leave every agent status as it is/);
});

test("Recon and GoHighLevel rows do not trip this check", async () => {
  const db = fakeDb({
    retired: [
      { code: "AG-07", status: "retired" },
      { code: "GHL-A1", status: "retired" }
    ],
    failed: [{
      agent_code: "AG-07",
      outcome: "runtime_error",
      trigger_event: "cron.daily-pulse",
      created_at: OLD
    }]
  });
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  assert.equal(rows[0].status, "PASS");
});

test("a failed run past the retry window fails", async () => {
  const db = fakeDb({
    failed: [{
      agent_code: "AG-04",
      outcome: "bland_rejected",
      trigger_event: "booking.created",
      created_at: OLD
    }]
  });
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /AG-04/);
  assert.match(rows[0].detail, /bland_rejected/);
  assert.match(rows[0].detail, /not retried/);
});

test("a failed run inside the retry window does not fail yet", async () => {
  const db = fakeDb({
    failed: [{
      agent_code: "AG-04",
      outcome: "runtime_error",
      trigger_event: "message.inbound",
      created_at: YOUNG
    }]
  });
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  assert.equal(rows[0].status, "PASS");
});

test("the agent call route answering 500 fails, and the probe is GET", async () => {
  const db = fakeDb();
  const seen = [];
  const fetch = async (url, opts) => {
    seen.push({ url, opts });
    return { status: 500 };
  };
  const rows = await gapChecks({
    db,
    now: NOW,
    fetch,
    baseUrl: "https://fundhub.ai/"
  });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /answered 500/);
  assert.match(rows[0].detail, /No call was placed/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://fundhub.ai/api/agent-call");
  assert.equal(seen[0].opts.method, "GET");
  assert.equal(seen[0].opts.body, undefined);
});

test("a Bland voice webhook 500 fails", async () => {
  const db = fakeDb({ bland: [{ status: 500 }] });
  const rows = await gapChecks({ db, now: NOW, agentCallStatus: 405 });
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /Bland voice webhook answered 500/);
});

test("a database read error is a skip unless the call route is already 500", async () => {
  const broken = fakeDb({ failSql: /FROM agents/ });
  const skipped = await gapChecks({ db: broken, now: NOW, agentCallStatus: 405 });
  assert.equal(skipped[0].status, "skip");
  assert.match(skipped[0].detail, /could not be read/);

  const down = fakeDb({ failSql: /FROM agents/ });
  const failed = await gapChecks({ db: down, now: NOW, agentCallStatus: 500 });
  assert.equal(failed[0].status, "FAIL");
  assert.match(failed[0].detail, /answered 500/);
});

test("judge drops a young failure and a recon row", () => {
  const quiet = judge({
    dbRead: true,
    retired: [{ code: "AG-07", status: "retired" }],
    failed: [{
      agent_code: "DOC-CHECK",
      outcome: "model_error",
      trigger_event: "docs.received",
      created_at: YOUNG
    }],
    route: { probed: true, status: 405 },
    now: NOW
  });
  assert.equal(quiet.status, "PASS");

  const loud = judge({
    dbRead: true,
    failed: [{
      agent_code: "DOC-CHECK",
      outcome: "model_error",
      trigger_event: "docs.received",
      created_at: OLD
    }],
    blandStatus: 200,
    route: { probed: false, status: null },
    now: NOW
  });
  assert.equal(loud.status, "FAIL");
  assert.match(loud.detail, /DOC-CHECK/);
  assert.match(loud.detail, /model_error/);
  assert.doesNotMatch(loud.detail, /AG-07/);
});
