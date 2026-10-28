// PostgreSQL SELECT-only semantic proof. The CTEs shadow table names and
// contain all synthetic rows in the query; no customer or test rows are stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { countUnlogged } from "./call-outcomes.mjs";

const CAN_RUN = process.env.CI === "true" && !!process.env.DATABASE_URL;

// Over 200 legitimate overdue tasks plus foreign-org, future, other-role, and
// wrong-title tasks. One own-org outcome closes task 2. An unrelated org's
// outcome for task 4 must not close that task.
const FIXTURE = `WITH tasks AS (
  SELECT g AS id,
         CASE WHEN g IN (252, 253) THEN 'other-org' ELSE 'own-org' END AS org_id,
         CASE WHEN g = 254 THEN 'setter' ELSE 'closer' END AS assignee_role,
         CASE WHEN g = 255 THEN 'Other action' ELSE 'Strategy session booked' END AS title,
         CASE WHEN g = 256 THEN now() + interval '1 hour'
              ELSE now() - interval '1 hour' END AS due_at,
         CASE WHEN g % 2 = 0 THEN 'closer-a' ELSE NULL::text END AS assignee_staff_id
    FROM generate_series(1, 256) AS g
), call_outcomes AS (
  SELECT 2 AS task_id, 'own-org' AS org_id
  UNION ALL
  SELECT 4 AS task_id, 'other-org' AS org_id
) `;

test("Postgres counts all 250 real overdue tasks without reading or writing actual tables", {
  skip: CAN_RUN ? false : "CI PostgreSQL unavailable"
}, async () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = { query: (sql, params) => pool.query(FIXTURE + sql, params) };
  try {
    const companyTotal = await countUnlogged(db, { orgId: "own-org" });
    const closerTotal = await countUnlogged(db, { orgId: "own-org", staffId: "closer-a" });
    const otherCloser = await countUnlogged(db, { orgId: "own-org", staffId: "closer-b" });
    assert.equal(companyTotal, 250, "task 2 closed; wrong-org outcome cannot close task 4");
    assert.equal(closerTotal, 250, "assigned and unassigned tasks for closer-a");
    assert.equal(otherCloser, 126, "another closer sees only the 126 unassigned overdue tasks");
  } finally {
    await pool.end();
  }
});
