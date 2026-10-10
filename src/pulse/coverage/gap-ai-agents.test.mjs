import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_FAILED,
  CHECK_IDS,
  CHECK_RETIRED,
  DOC_READ_TRIGGER,
  FAILED_LOOKBACK_MS,
  FAILED_RUN_SQL,
  FAIL_OUTCOMES,
  RECON_CODE,
  RECON_TRIGGER,
  RETIRED_SQL,
  RETRY_GRACE_MS,
  gapChecks,
  ignoredAgent,
  judgeFailedRuns,
  judgeRetired
} from "./gap-ai-agents.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Code only. The header comments name the things this file refuses to do.
const SRC = fs
  .readFileSync(path.join(HERE, "gap-ai-agents.mjs"), "utf8")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T18:00:00.000Z");
const MIN = 60 * 1000;
const OLD = new Date(NOW.getTime() - 60 * MIN).toISOString();
const YOUNG = new Date(NOW.getTime() - 1 * MIN).toISOString();
const ANCIENT = new Date(NOW.getTime() - 9 * 24 * 60 * MIN).toISOString();

function shape(r, id) {
  assert.deepEqual(Object.keys(r).sort(), ["detail", "id", "status", "suggestedFix"]);
  assert.ok(CHECK_IDS.includes(r.id));
  if (id) assert.equal(r.id, id);
  assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
  assert.equal(typeof r.detail, "string");
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") {
    assert.equal(typeof r.suggestedFix, "string");
    assert.match(r.suggestedFix, /leaves the phone alone/);
    assert.match(r.suggestedFix, /leaves every agent status as it is/);
  } else {
    assert.equal(r.suggestedFix, null);
  }
}

/** A db that answers by which of the two real SQL strings it was sent. Anything else throws. */
function fakeDb({ retired = [], failed = [], throwOn = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (throwOn && throwOn === String(sql)) throw new Error("read failed");
      if (sql === RETIRED_SQL) return { rows: retired };
      if (sql === FAILED_RUN_SQL) return { rows: failed };
      throw new Error(`unexpected sql: ${String(sql).slice(0, 60)}`);
    }
  };
}

test("source stays read-only: no transaction control, no write, no call, no network", () => {
  assert.doesNotMatch(SRC, /\bBEGIN\b/);
  assert.doesNotMatch(SRC, /\bCOMMIT\b/);
  assert.doesNotMatch(SRC, /\bROLLBACK\b/);
  assert.doesNotMatch(SRC, /\bSET\s+(LOCAL|SESSION|TRANSACTION)\b/i);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
  assert.doesNotMatch(SRC, /\bfetch\b/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.doesNotMatch(SRC, /placeCall|bland-voice/);
  assert.doesNotMatch(SRC, /from "\.\.\/registry\.mjs"/);
  assert.doesNotMatch(SRC, /slice-24-agents/);
  assert.doesNotMatch(RETIRED_SQL + FAILED_RUN_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  // The Bland webhook row is gone. The router stores a capture only for a 200, so a 500 can never be read back.
  assert.doesNotMatch(SRC, /webhook_captures|bland-webhook|CHECK_BLAND/);
});

test("constants: two rows, Recon left alone, windows as written", () => {
  assert.deepEqual([...CHECK_IDS], [CHECK_RETIRED, CHECK_FAILED]);
  assert.deepEqual([...CHECK_IDS], ["ai-agents:retired", "ai-agents:failed-runs"]);
  assert.equal(RECON_CODE, "AG-07");
  assert.equal(RECON_TRIGGER, "cron.daily-pulse");
  assert.equal(DOC_READ_TRIGGER, "docs.received");
  assert.equal(RETRY_GRACE_MS, 15 * MIN);
  assert.equal(FAILED_LOOKBACK_MS, 7 * 24 * 60 * MIN);
  assert.deepEqual([...FAIL_OUTCOMES], [
    "runtime_error",
    "model_error",
    "empty_model_reply",
    "bland_rejected",
    "transport",
    "no_call_id",
    "error",
    "failed",
    "fail"
  ]);
  // Left out on purpose: the AI spend is on hold, so a keyless live agent writes this by design.
  assert.ok(!FAIL_OUTCOMES.includes("no_api_key"));
});

test("the retired SQL keeps every exclusion and every condition it is built on", () => {
  const sql = RETIRED_SQL.replace(/\s+/g, " ");
  assert.match(sql, /a\.code <> 'AG-07'/);
  assert.match(sql, /a\.code NOT LIKE 'GHL-%'/);
  assert.match(sql, /a\.runtime IS NOT NULL/);
  assert.match(sql, /btrim\(COALESCE\(a\.prompt, ''\)\) <> ''/);
  assert.match(sql, /a\.status = 'retired'/);
  assert.match(sql, /FROM agent_triggers t WHERE t\.org_id = a\.org_id AND t\.agent_code = a\.code AND t\.enabled IS TRUE/);
  assert.match(sql, /\$1::uuid IS NULL OR a\.org_id = \$1::uuid/);
});

test("the failed-run SQL keeps every exclusion, the time window, and the retry clear", () => {
  const sql = FAILED_RUN_SQL.replace(/\s+/g, " ");
  // Real agent rows only: a script row in agent_runs has no agents row.
  assert.match(sql, /JOIN agents ag ON ag\.org_id = r\.org_id AND ag\.code = r\.agent_code/);
  // Recon and document reads are left to their own watchers.
  assert.match(sql, /r\.agent_code <> 'AG-07'/);
  assert.match(sql, /COALESCE\(r\.trigger_event, ''\) <> 'cron\.daily-pulse'/);
  assert.match(sql, /COALESCE\(r\.trigger_event, ''\) <> 'docs\.received'/);
  // Params: $1 org, $2 newest allowed, $3 oldest allowed, $4 outcome list.
  assert.match(sql, /r\.created_at <= \$2::timestamptz/);
  assert.match(sql, /r\.created_at >= \$3::timestamptz/);
  assert.match(sql, /lower\(r\.outcome\) = ANY\(\$4::text\[\]\)/);
  assert.match(sql, /r\.outcome ILIKE 'openai %'/);
  assert.match(sql, /r\.outcome ILIKE 'anthropic %'/);
  // A later run clears it: same event, a "retry of" note, or (no event) same client and trigger.
  assert.match(sql, /NOT EXISTS \( SELECT 1 FROM agent_runs later WHERE later\.org_id = r\.org_id AND later\.agent_code = r\.agent_code AND later\.created_at > r\.created_at/);
  assert.match(sql, /later\.event_id = r\.event_id/);
  assert.match(sql, /later\.detail ILIKE \('retry of ' \|\| r\.event_id::text \|\| '%'\)/);
  assert.match(sql, /later\.client_id IS NOT DISTINCT FROM r\.client_id AND later\.trigger_event = r\.trigger_event/);
  assert.match(sql, /ORDER BY r\.created_at DESC LIMIT 20$/);
});

test("no database and no scope: both rows skip", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 2);
  rows.forEach((r) => shape(r));
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip"]);
});

test("clean rows: PASS, PASS, and only plain SELECTs reach the db", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  rows.forEach((r) => shape(r));
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.equal(db.calls.length, 2);
  for (const c of db.calls) {
    assert.match(c.sql.trimStart(), /^SELECT/);
    assert.doesNotMatch(c.sql, /\b(BEGIN|COMMIT|ROLLBACK)\b/);
  }
  const failedCall = db.calls.find((c) => c.sql === FAILED_RUN_SQL);
  assert.equal(failedCall.params[0], ORG);
  assert.equal(failedCall.params[1].toISOString(), new Date(NOW.getTime() - RETRY_GRACE_MS).toISOString());
  assert.equal(failedCall.params[2].toISOString(), new Date(NOW.getTime() - FAILED_LOOKBACK_MS).toISOString());
  assert.deepEqual(failedCall.params[3], FAIL_OUTCOMES);
  assert.equal(db.calls.find((c) => c.sql === RETIRED_SQL).params[0], ORG);
});

test("no org id still reads: the SQL takes a null org", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: NOW });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.equal(db.calls[0].params[0], null);
});

test("the staff scope is the fallback when no plain handle is passed", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ scope: (fn) => fn(db), now: NOW, orgId: ORG });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.equal(db.calls.length, 2);
});

test("the plain handle wins when both a handle and a scope are passed", async () => {
  const plain = fakeDb();
  const staff = fakeDb();
  const rows = await gapChecks({ db: plain, scope: (fn) => fn(staff), now: NOW, orgId: ORG });
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  assert.equal(plain.calls.length, 2);
  assert.equal(staff.calls.length, 0);
});

test("a db with no query function falls back to the scope, and nothing at all skips", async () => {
  const staff = fakeDb();
  const rows = await gapChecks({ db: {}, scope: (fn) => fn(staff), now: NOW, orgId: ORG });
  assert.equal(staff.calls.length, 2);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  const none = await gapChecks({ db: {}, now: NOW, orgId: ORG });
  assert.deepEqual(none.map((r) => r.status), ["skip", "skip"]);
});

test("retired: an agent with a script, a runtime and a trigger on that is retired is FAIL", async () => {
  const db = fakeDb({ retired: [{ code: "DOC-CHECK", status: "retired" }] });
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  shape(rows[0], CHECK_RETIRED);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /DOC-CHECK/);
  assert.match(rows[0].detail, /is retired/);
  assert.match(rows[0].suggestedFix, /Agent Editor/);
  assert.equal(rows[1].status, "PASS");
  assert.equal(rows.length, 2);
});

test("retired: Recon and the GoHighLevel rows never trip it", () => {
  const quiet = judgeRetired([
    { code: "AG-07", status: "retired" },
    { code: "GHL-A1", status: "retired" },
    { code: "ghl-doc", status: "retired" }
  ]);
  assert.equal(quiet.status, "PASS");
  assert.equal(judgeRetired([]).status, "PASS");
  assert.equal(judgeRetired(null).status, "PASS");
  const loud = judgeRetired([{ code: "AG-07" }, { code: "AG-09" }, { code: "DOC-CHECK" }]);
  assert.equal(loud.status, "FAIL");
  assert.match(loud.detail, /AG-09, DOC-CHECK should be on and are retired/);
  assert.doesNotMatch(loud.detail, /AG-07/);
});

test("failed runs: a run past the retry window with no retry is FAIL and names the agent and outcome", async () => {
  const db = fakeDb({
    failed: [{ agent_code: "AG-04", outcome: "model_error", trigger_event: "message.inbound", created_at: OLD }]
  });
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  shape(rows[1], CHECK_FAILED);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /AG-04/);
  assert.match(rows[1].detail, /model_error/);
  assert.match(rows[1].detail, /not retried/);
  assert.match(rows[1].suggestedFix, /retry the failed run/);
});

test("failed runs: a young failure is not red yet, and an old one past 7 days is history", () => {
  const young = judgeFailedRuns(
    [{ agent_code: "AG-04", outcome: "runtime_error", trigger_event: "message.inbound", created_at: YOUNG }],
    { now: NOW }
  );
  assert.equal(young.status, "PASS");
  const ancient = judgeFailedRuns(
    [{ agent_code: "AG-04", outcome: "runtime_error", trigger_event: "message.inbound", created_at: ANCIENT }],
    { now: NOW }
  );
  assert.equal(ancient.status, "PASS");
  const edge = judgeFailedRuns(
    [{ agent_code: "AG-04", outcome: "runtime_error", trigger_event: "x", created_at: new Date(NOW.getTime() - RETRY_GRACE_MS).toISOString() }],
    { now: NOW }
  );
  assert.equal(edge.status, "FAIL");
});

test("failed runs: a row with no usable time is not counted", () => {
  // null reads as 1970 (outside the window); "garbage" and undefined are NaN. None may count.
  for (const created_at of [null, undefined, "garbage", ""]) {
    const r = judgeFailedRuns(
      [{ agent_code: "AG-04", outcome: "runtime_error", trigger_event: "x", created_at }],
      { now: NOW }
    );
    assert.equal(r.status, "PASS", `created_at=${String(created_at)}`);
  }
  // A good row next to a bad one still counts.
  const mixed = judgeFailedRuns(
    [
      { agent_code: "AG-04", outcome: "runtime_error", trigger_event: "x", created_at: "garbage" },
      { agent_code: "OP-06", outcome: "model_error", trigger_event: "y", created_at: OLD }
    ],
    { now: NOW }
  );
  assert.equal(mixed.status, "FAIL");
  assert.match(mixed.detail, /OP-06 1 failed run /);
  assert.doesNotMatch(mixed.detail, /AG-04/);
});

test("failed runs: Recon and GoHighLevel failures are ignored, a real agent's are counted", () => {
  const quiet = judgeFailedRuns(
    [
      { agent_code: "AG-07", outcome: "runtime_error", trigger_event: "cron.daily-pulse", created_at: OLD },
      { agent_code: "GHL-A2", outcome: "model_error", trigger_event: "x", created_at: OLD }
    ],
    { now: NOW }
  );
  assert.equal(quiet.status, "PASS");
  const loud = judgeFailedRuns(
    [
      { agent_code: "AG-07", outcome: "runtime_error", trigger_event: "cron.daily-pulse", created_at: OLD },
      { agent_code: "OP-06", outcome: "model_error", trigger_event: "staff.drill", created_at: OLD },
      { agent_code: "OP-06", outcome: "model_error", trigger_event: "staff.drill", created_at: OLD }
    ],
    { now: NOW }
  );
  assert.equal(loud.status, "FAIL");
  assert.match(loud.detail, /OP-06 2 failed runs/);
  assert.doesNotMatch(loud.detail, /AG-07/);
});

test("failed runs: the outcome named is the newest failure (the SQL sorts newest first)", () => {
  const r = judgeFailedRuns(
    [
      { agent_code: "OP-06", outcome: "openai 429", trigger_event: "staff.drill", created_at: OLD },
      { agent_code: "AG-04", outcome: "model_error", trigger_event: "message.inbound", created_at: ANCIENT.replace("2026-09-29", "2026-10-02") }
    ],
    { now: NOW }
  );
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /\(openai 429\)/);
  assert.match(r.detail, /OP-06/);
});

test("ignoredAgent: Recon by code or trigger, GHL by prefix, blank code", () => {
  assert.equal(ignoredAgent({ code: "ag-07" }), true);
  assert.equal(ignoredAgent({ agent_code: "X", trigger_event: "cron.daily-pulse" }), true);
  assert.equal(ignoredAgent({ code: "GHL-DOC" }), true);
  assert.equal(ignoredAgent({ code: "" }), true);
  assert.equal(ignoredAgent({ code: "DOC-CHECK" }), false);
});

test("there is no Bland webhook row: the router stores only a 200, so a 500 could never be read", async () => {
  const db = fakeDb();
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  assert.equal(rows.length, 2);
  assert.ok(!rows.some((r) => /bland/i.test(r.id)));
  assert.ok(db.calls.every((c) => !/webhook_captures/.test(c.sql)));
});

test("a read error is a FAIL on that row, never a PASS and never a throw", async () => {
  for (const [sql, index, id] of [
    [RETIRED_SQL, 0, CHECK_RETIRED],
    [FAILED_RUN_SQL, 1, CHECK_FAILED]
  ]) {
    const rows = await gapChecks({ db: fakeDb({ throwOn: sql }), now: NOW, orgId: ORG });
    assert.equal(rows.length, 2);
    shape(rows[index], id);
    assert.equal(rows[index].status, "FAIL");
    assert.match(rows[index].detail, /could not read/);
    const others = rows.filter((_, i) => i !== index);
    assert.ok(others.every((r) => r.status === "PASS"));
  }
});

test("a connection string in an error never reaches the detail", async () => {
  const db = {
    async query() {
      throw new Error("connect failed postgres://user:secret@db.example:5432/x");
    }
  };
  const rows = await gapChecks({ db, now: NOW, orgId: ORG });
  for (const r of rows) {
    assert.equal(r.status, "FAIL");
    assert.doesNotMatch(r.detail, /secret|postgres:\/\//);
    assert.match(r.detail, /\[redacted\]/);
  }
});
