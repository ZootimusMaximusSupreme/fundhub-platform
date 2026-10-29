// F-01 fulfillment proof: one advisor pod task per client despite new round IDs.
// Real disposable localhost CI PostgreSQL only. Temporary tasks, rolled back.
// Never opens production connections or sends messages, payments, or credit calls.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createPodTask } from "./f-01-funding-intake.mjs";

const connectionString = process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:$|_)/i.test(url.pathname);
} catch { /* Reject unknown and production database URLs. */ }
const options = { skip: safe ? false : "local CI/test/scratch PostgreSQL only; production refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("different and concurrent round starts produce one tenant-scoped dated pod task (real PostgreSQL)",
  options, async () => {
    const conn = await pool.connect();
    const orgA = randomUUID();
    const orgB = randomUUID();
    const clientA = randomUUID();
    const clientB = randomUUID();
    try {
      await conn.query("BEGIN");
      // Shadow the real table with a session-local table. All fixture writes
      // stay in this transaction and are always rolled back.
      await conn.query(`CREATE TEMP TABLE tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id uuid NOT NULL,
        client_id uuid NOT NULL,
        assignee uuid,
        title text NOT NULL,
        body text,
        due_at timestamptz,
        source_workflow text NOT NULL,
        assignee_role text,
        assignee_staff_id uuid,
        meeting_url text,
        CONSTRAINT pod_fixture_dedupe UNIQUE (client_id, source_workflow, body)
      ) ON COMMIT DROP`);

      // Three different round events may reach F-01 in parallel; assignment
      // is a single open work item while no pod has been assigned.
      const results = await Promise.all([1, 2, 3].map(() =>
        createPodTask(conn, { orgId: orgA, clientId: clientA })));
      assert.equal(results.filter((r) => r.created).length, 1);
      assert.equal((await conn.query(
        "SELECT count(*)::int AS n FROM tasks WHERE org_id = $1 AND client_id = $2",
        [orgA, clientA])).rows[0].n, 1);
      const row = (await conn.query(
        "SELECT title, body, assignee_role, due_at FROM tasks WHERE client_id = $1",
        [clientA])).rows[0];
      assert.equal(row.title, "Assign pod roles for funding client");
      assert.equal(row.body, `pod-assignment:${orgA}:${clientA}`);
      assert.equal(row.assignee_role, "funding_advisor");
      assert.ok(new Date(row.due_at) > new Date());

      // A different company's real client still receives its own pod task.
      const other = await createPodTask(conn, { orgId: orgB, clientId: clientB });
      assert.equal(other.created, true);
      assert.equal((await conn.query(
        "SELECT count(*)::int AS n FROM tasks")).rows[0].n, 2);
    } finally {
      await conn.query("ROLLBACK");
      conn.release();
    }
  });
