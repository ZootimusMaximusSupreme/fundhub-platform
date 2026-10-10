// Money helper stuck rows. Fake database only. Nothing moves, nothing is texted.
// What the SQL itself answers, on a real Postgres, is in gap-customer-records.pg.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  CSM_PREP_SOURCE,
  FAILED_TURN_LOOK_MS,
  PREP_CALL_BODY,
  PROPOSAL_GRACE_DAYS,
  READY_PRESS_GRACE_MS,
  STUCK_AFTER_MS,
  STUCK_SQL,
  gapChecks,
  judge,
  newYorkDay,
  proposalCutoffDay
} from "./gap-money-helper.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import { STALE_RUNNING_MS } from "../../finance/money-helper.mjs";
import { EXECUTION_GRACE_DAYS } from "../../finance/money-transfers.mjs";
import { CSM_PREP_SOURCE as REAL_PREP_SOURCE, PREP_CALL_DEDUPE } from "../../blueprint/closer-ready.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-money-helper.mjs"), "utf8");
const NOW = new Date("2026-10-10T13:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";

const zero = { tasks_queued: 0, tasks_claimed: 0, proposals_late: 0, turns_open: 0, turns_failed: 0, ready_no_task: 0 };

function dbWith(row, seen = []) {
  return {
    seen,
    async query(sql, params) {
      seen.push({ sql, params });
      if (row instanceof Error) throw row;
      return { rows: row === null ? [] : [row] };
    }
  };
}

test("the windows are the code's own numbers, not new ones", () => {
  assert.equal(STUCK_AFTER_MS, STALE_RUNNING_MS, "the 10 minute line is money-helper.mjs STALE_RUNNING_MS");
  assert.equal(PROPOSAL_GRACE_DAYS, EXECUTION_GRACE_DAYS, "the proposal expiry is money-transfers.mjs EXECUTION_GRACE_DAYS");
  assert.equal(CSM_PREP_SOURCE, REAL_PREP_SOURCE);
  assert.equal(PREP_CALL_BODY, PREP_CALL_DEDUPE);
  assert.equal(READY_PRESS_GRACE_MS, 60 * 60 * 1000);
  assert.equal(FAILED_TURN_LOOK_MS, 24 * 60 * 60 * 1000);
});

test("the SQL is one read, writes nothing, and keeps the engine's own proposal rule", () => {
  assert.match(STUCK_SQL.replace(/^\s*\/\*[\s\S]*?\*\//, "").trim(), /^SELECT\b/);
  assert.doesNotMatch(STUCK_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i);
  // queued: only the agent's own rows. A person row waits on its CSM task.
  assert.match(STUCK_SQL, /t\.assignee = 'agent' AND t\.status = 'queued'/);
  // claimed: a row held on purpose is not stuck.
  assert.match(STUCK_SQL, /COALESCE\(t\.result ->> 'in_progress', ''\) <> 'true'/);
  // proposals: the same date rule as overdueProposals in src/finance/money-transfers-store.mjs.
  const store = fs.readFileSync(path.join(HERE, "../../finance/money-transfers-store.mjs"), "utf8").replace(/\s+/g, " ");
  assert.ok(store.includes("GREATEST(COALESCE(due_on, (created_at AT TIME ZONE 'America/New_York')::date), (created_at AT TIME ZONE 'America/New_York')::date) < $1::date"));
  assert.ok(STUCK_SQL.replace(/\s+/g, " ").includes(
    "GREATEST(COALESCE(t.due_on, (t.created_at AT TIME ZONE 'America/New_York')::date), (t.created_at AT TIME ZONE 'America/New_York')::date) < $5::date"
  ));
  assert.match(STUCK_SQL, /t\.status = 'needs_approval' AND t\.moves_money/);
  // turns: no answer, or failed in the last day.
  assert.match(STUCK_SQL, /h\.status IN \('queued', 'running'\)/);
  assert.match(STUCK_SQL, /h\.status = 'failed'/);
  // ready to fund: the log action, and the prep-call task by source and round body.
  assert.match(STUCK_SQL, /l\.action = 'ready_to_fund'/);
  assert.match(STUCK_SQL, /k\.source_workflow = \$8::text/);
  assert.match(STUCK_SQL, /substring\(l\.idempotency_key from ':r\(\[0-9\]\+\)\$'\)/);
  // Test clients are left out unless demoOn.
  assert.match(STUCK_SQL, /\$2::boolean OR NOT EXISTS/);
  assert.doesNotMatch(SRC, /fetch\(|node:fs|readFileSync|method:\s*["']POST/);
});

test("the round body rule is the one ready-to-fund.mjs uses (round 1 is the bare key, later rounds add :rN)", async () => {
  const { roundBody } = await import("../../finance/ready-to-fund.mjs");
  assert.equal(roundBody(1), PREP_CALL_BODY);
  assert.equal(roundBody(2), `${PREP_CALL_BODY}:r2`);
  assert.equal(roundBody(7), `${PREP_CALL_BODY}:r7`);
});

test("newYorkDay and the proposal cut-off use New York dates", () => {
  assert.equal(newYorkDay(new Date("2026-10-10T13:00:00Z")), "2026-10-10");
  // 03:30 UTC is 23:30 the day before in New York (daylight time).
  assert.equal(newYorkDay(new Date("2026-10-10T03:30:00Z")), "2026-10-09");
  assert.equal(proposalCutoffDay(new Date("2026-10-10T13:00:00Z")), "2026-10-07");
  assert.equal(proposalCutoffDay(new Date("2026-10-10T03:30:00Z")), "2026-10-06");
  // A month boundary.
  assert.equal(proposalCutoffDay(new Date("2026-11-02T15:00:00Z")), "2026-10-30");
});

test("no database is one skip", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, CHECK_IDS[0]);
  assert.equal(rows[0].status, "skip");
});

test("PASS: nothing is stuck", async () => {
  const seen = [];
  const rows = await gapChecks({ db: dbWith(zero, seen), now: NOW, orgId: ORG });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[0].suggestedFix, null);
  const q = seen[0];
  assert.equal(q.params[0], ORG);
  assert.equal(q.params[1], false);
  assert.equal(q.params[2], TEST_CLIENT_EMAIL_RE);
  assert.equal(q.params[3], new Date(NOW.getTime() - STUCK_AFTER_MS).toISOString());
  assert.equal(q.params[4], "2026-10-07");
  assert.equal(q.params[5], new Date(NOW.getTime() - FAILED_TURN_LOOK_MS).toISOString());
  assert.equal(q.params[6], new Date(NOW.getTime() - READY_PRESS_GRACE_MS).toISOString());
  assert.equal(q.params[7], CSM_PREP_SOURCE);
  assert.equal(q.params[8], PREP_CALL_BODY);
});

test("FAIL: each of the six stuck states turns the row red by itself, and says which", () => {
  const cases = [
    ["tasks_queued", /3 Do task rows are still queued after 10 minutes/, 3],
    ["tasks_claimed", /1 Do task row was claimed and never finished/, 1],
    ["proposals_late", /2 money proposals are still waiting on the client after its 3-day expiry/, 2],
    ["turns_open", /1 helper chat message has no answer after 10 minutes/, 1],
    ["turns_failed", /4 helper chat messages failed in the last day/, 4],
    ["ready_no_task", /2 clients pressed "ready to get funded" and have no CSM prep-call task/, 2]
  ];
  for (const [key, re, n] of cases) {
    const r = judge({ ...zero, [key]: n });
    assert.equal(r.status, "FAIL", key);
    assert.match(r.detail, re, key);
    assert.match(r.suggestedFix, /Do not move money/);
    assert.match(r.suggestedFix, /Do not auto-fix/);
    // Only that state is named.
    const named = cases.filter(([, other]) => other.test(r.detail)).length;
    assert.equal(named, 1, `${key} names only itself`);
  }
});

test("FAIL: several stuck states are all named in one row", () => {
  const r = judge({ ...zero, tasks_queued: 1, turns_open: 2, ready_no_task: 1 });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /Do task row is still queued/);
  assert.match(r.detail, /2 helper chat messages have no answer/);
  assert.match(r.detail, /1 client pressed "ready to get funded" and has no CSM prep-call task/);
});

test("a read that fails, or comes back with no row, is a skip with the reason", async () => {
  const boom = await gapChecks({ db: dbWith(new Error("canceling statement due to statement timeout")), now: NOW, orgId: ORG });
  assert.equal(boom[0].status, "skip");
  assert.match(boom[0].detail, /statement timeout/);
  const empty = await gapChecks({ db: dbWith(null), now: NOW, orgId: ORG });
  assert.equal(empty[0].status, "skip");
});

test("demoOn is passed through, and the staff scope is used when given", async () => {
  const viaScope = [];
  const viaDb = [];
  await gapChecks({ db: dbWith(zero, viaDb), scope: (fn) => fn(dbWith(zero, viaScope)), now: NOW, orgId: ORG, demoOn: true });
  assert.equal(viaDb.length, 0);
  assert.equal(viaScope.length, 1);
  assert.equal(viaScope[0].params[1], true);
});
