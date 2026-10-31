// PostgreSQL SELECT-only semantic proof. The CTEs shadow table names and
// contain all synthetic rows in the query; no customer or test rows are stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { countUnlogged, listUnloggedCalls } from "./call-outcomes.mjs";

const CAN_RUN = process.env.CI === "true" && !!process.env.DATABASE_URL;

// Over 200 legitimate overdue tasks plus foreign-org, future, other-role, and
// wrong-title tasks. Task 2 closes by task ID, task 3 by a same-client
// booking UID. A foreign-org task-4 outcome and wrong-client task-5 booking
// reference cannot silence this org/client's still-unlogged calls.
// Task 257 is cancelled (done=true), and must not count as unlogged.
const FIXTURE = `WITH tasks AS (
  SELECT g AS id,
         CASE WHEN g IN (252, 253) THEN 'other-org' ELSE 'own-org' END AS org_id,
         'own-client'::text AS client_id,
         'BK-' || g AS body,
         NULL::text AS meeting_url,
         CASE WHEN g = 254 THEN 'setter' ELSE 'closer' END AS assignee_role,
         CASE WHEN g = 255 THEN 'Other action' ELSE 'Strategy session booked' END AS title,
         CASE WHEN g = 256 THEN now() + interval '1 hour'
              ELSE now() - interval '1 hour' END AS due_at,
         (g = 257) AS done,
         CASE WHEN g % 2 = 0 THEN 'closer-a' ELSE NULL::text END AS assignee_staff_id
    FROM generate_series(1, 257) AS g
), clients AS (
  SELECT 'own-client'::text AS id, 'own-org'::text AS org_id,
         '{}'::jsonb AS custom_fields,
         'Test'::text AS first_name, 'Buyer'::text AS last_name,
         'test@example.invalid'::text AS email
), call_outcomes AS (
  SELECT 1 AS id, 2 AS task_id, 'own-org' AS org_id,
         'own-client' AS client_id, NULL::text AS booking_ref
  UNION ALL
  SELECT 2, 4, 'other-org', 'own-client', NULL
  UNION ALL
  SELECT 3, NULL::integer, 'own-org', 'own-client', 'BK-3'
  UNION ALL
  SELECT 4, NULL::integer, 'own-org', 'another-client', 'BK-5'
  UNION ALL
  SELECT 5, NULL::integer, 'other-org', 'own-client', 'BK-6'
) `;

test("Postgres counts overdue tasks by task ID or same-client booking UID without reading customer tables", {
  skip: CAN_RUN ? false : "CI PostgreSQL unavailable"
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = { query: (sql, params) => pool.query(FIXTURE + sql, params) };
  try {
    const companyTotal = await countUnlogged(db, { orgId: "own-org" });
    const closerTotal = await countUnlogged(db, { orgId: "own-org", staffId: "closer-a" });
    const otherCloser = await countUnlogged(db, { orgId: "own-org", staffId: "closer-b" });
    assert.equal(companyTotal, 249, "tasks 2 and 3 closed; foreign matches cannot close 4, 5 or 6");
    assert.equal(closerTotal, 249, "assigned and unassigned tasks for closer-a");
    assert.equal(otherCloser, 125, "another closer sees only 125 unassigned overdue tasks");
  } finally {
    await pool.end();
  }
});

test("Postgres list and KPI agree: task-less booking outcome closes only its own client", {
  skip: CAN_RUN ? false : "CI PostgreSQL unavailable"
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const smallFixture = FIXTURE.replace("generate_series(1, 257)", "generate_series(1, 8)");
  const db = { query: (sql, params) => pool.query(smallFixture + sql, params) };
  try {
    const rows = await listUnloggedCalls(db, { orgId: "own-org", limit: 50 });
    assert.deepEqual(rows.map(row => row.task_id).sort((a, b) => a - b),
      [1, 4, 5, 6, 7, 8],
      "matched booking UID closes 3; cross-org/client refs do not close 4–6");
    assert.equal(await countUnlogged(db, { orgId: "own-org" }), rows.length);
  } finally {
    await pool.end();
  }
});
