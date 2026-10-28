// Read-only contract: staff and manager KPIs count the entire overdue call
// queue. A screen may list only 200 rows, but the count must never stop there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countUnlogged, listUnloggedCalls, CallOutcomeError } from "./call-outcomes.mjs";

const ORG = "org-test";
const STAFF = "closer-test";

test("unlogged KPI uses an uncapped SQL count, not the limited screen rows", async () => {
  const reads = [];
  const db = {
    query: async (sql, params) => {
      reads.push({ sql, params });
      return { rows: [{ n: "250" }] };
    }
  };
  assert.equal(await countUnlogged(db, { orgId: ORG }), 250);
  assert.equal(reads.length, 1);
  const { sql, params } = reads[0];
  assert.match(sql, /SELECT count\(\*\)::int AS n/i);
  assert.match(sql, /FROM tasks t/);
  assert.match(sql, /t\.org_id = \$1/);
  assert.match(sql, /t\.assignee_role = 'closer'/);
  assert.match(sql, /t\.title LIKE \$2/);
  assert.match(sql, /t\.due_at IS NOT NULL/);
  assert.match(sql, /t\.due_at < now\(\)/);
  assert.match(sql, /NOT EXISTS\s*\(\s*SELECT 1 FROM call_outcomes o/);
  assert.match(sql, /o\.task_id = t\.id AND o\.org_id = t\.org_id/);
  assert.doesNotMatch(sql, /\bLIMIT\b/i);
  assert.deepEqual(params, [ORG, "Strategy session%"]);
});

test("staff-level KPI keeps the exact assignment-or-unassigned rule", async () => {
  const reads = [];
  const db = {
    query: async (sql, params) => {
      reads.push({ sql, params });
      return { rows: [{ n: 207 }] };
    }
  };
  assert.equal(await countUnlogged(db, { orgId: ORG, staffId: STAFF }), 207);
  assert.equal(reads.length, 1);
  assert.match(reads[0].sql, /t\.assignee_staff_id = \$2 OR t\.assignee_staff_id IS NULL/);
  assert.match(reads[0].sql, /t\.title LIKE \$3/);
  assert.deepEqual(reads[0].params, [ORG, STAFF, "Strategy session%"]);
});

test("the staff detail list remains safely capped at 200 rows", async () => {
  let received;
  const db = {
    query: async (_sql, params) => {
      received = params;
      return { rows: [] };
    }
  };
  assert.deepEqual(await listUnloggedCalls(db, { orgId: ORG, limit: 500 }), []);
  assert.equal(received.at(-1), 200);
});

test("an organization is required before counting any tasks", async () => {
  const db = { query: async () => { throw new Error("should not run"); } };
  await assert.rejects(
    () => countUnlogged(db, { staffId: STAFF }),
    (err) => err instanceof CallOutcomeError && err.status === 403
  );
});
