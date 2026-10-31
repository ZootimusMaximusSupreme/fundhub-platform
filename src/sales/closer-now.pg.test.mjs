// Read-only SQL proof: a taskless booking outcome closes the correct closer
// card, while a different buyer's or organization's outcome cannot close it.
// All fixture rows live inside PostgreSQL CTEs; no tables are written.
import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { closerNow } from "./closer-now.mjs";

const CAN_RUN = process.env.CI === "true" && Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-08-17T18:00:00.000Z");
const FIXTURE = `WITH tasks AS (
  SELECT g::text AS id,
         CASE WHEN g = 7 THEN 'other-org' ELSE 'own-org' END AS org_id,
         CASE WHEN g = 8 THEN 'archived-buyer' ELSE 'buyer-a' END AS client_id,
         'BK-' || g AS body,
         CASE WHEN g = 5 THEN 'setter' ELSE 'closer' END AS assignee_role,
         CASE WHEN g IN (1, 6) THEN 'closer-a' ELSE NULL::text END AS assignee_staff_id,
         (g = 9) AS done,
         CASE WHEN g = 9 THEN '2026-08-17 16:50:00+00'::timestamptz
              ELSE '2026-08-17 17:00:00+00'::timestamptz + g * interval '10 minutes' END AS due_at,
         NULL::text AS meeting_url,
         'Strategy session booked'::text AS title
    FROM generate_series(1, 9) AS g
), clients AS (
  SELECT * FROM (VALUES
    ('buyer-a', 'own-org', 'Dana', 'Buyer', 'dana@example.invalid', '{}'::jsonb),
    ('archived-buyer', 'own-org', 'Archived', 'Buyer', 'archived@example.invalid', '{"crm_archived_at":"2026-08-01"}'::jsonb),
    ('buyer-a', 'other-org', 'Other', 'Buyer', 'other@example.invalid', '{}'::jsonb)
  ) AS v(id, org_id, first_name, last_name, email, custom_fields)
), call_outcomes AS (
  SELECT * FROM (VALUES
    (1, 'own-org', 'buyer-a', '2', NULL::text),
    (2, 'own-org', 'buyer-a', NULL::text, 'BK-3'),
    (3, 'own-org', 'different-buyer', NULL::text, 'BK-4'),
    (4, 'other-org', 'buyer-a', NULL::text, 'BK-1')
  ) AS v(id, org_id, client_id, task_id, booking_ref)
) `;

test("Postgres closerNow hides cancelled tasks and buyer-scoped dispositions", {
  skip: CAN_RUN ? false : "CI PostgreSQL unavailable"
}, async () => {
  const dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const db = { query: (sql, params) => dbPool.query(FIXTURE + sql, params) };
  try {
    const own = await closerNow(db, { orgId: "own-org", staffId: "closer-a", now: NOW });
    assert.equal(own.current?.task_id, "1", "foreign-org disposition cannot close this task");
    assert.equal(own.next?.task_id, "4", "different buyer's booking UID cannot close this task");
    const otherStaff = await closerNow(db, { orgId: "own-org", staffId: "closer-b", now: NOW });
    assert.equal(otherStaff.current?.task_id, "4", "other closer sees only unassigned open call");
    assert.equal(otherStaff.next, null);
  } finally {
    await dbPool.end();
  }
});
