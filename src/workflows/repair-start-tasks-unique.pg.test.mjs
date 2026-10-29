// Paid repair kickoff: two different required staff jobs from ONE payment event.
// Prove against the exact tasks idempotency UNIQUE index in disposable PG only.
// NEVER connect to a live Supabase database; rollback and release all test data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createRepairStartTasks, firstRepairTasks } from "./repair-enrollment.mjs";

const scratch = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("repair-start: one event creates both tasks despite UNIQUE (client, workflow, body); replay/legacy safe (PG)",
  { skip: scratch ? false : "requires CI-only local disposable fundhub_ci PostgreSQL" },
  async () => {
    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const conn = await pool.connect();
    try {
      await conn.query("BEGIN");
      await conn.query(`CREATE TEMP TABLE tasks (
        id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
        org_id uuid NOT NULL,
        client_id uuid NOT NULL,
        assignee text,
        title text NOT NULL,
        body text,
        due_at timestamptz,
        source_workflow text NOT NULL,
        assignee_role text,
        assignee_staff_id uuid,
        meeting_url text
      ) ON COMMIT DROP`);
      // Reproduce db/schema/006_tasks_idempotency.sql, including NULL semantics.
      await conn.query(`CREATE UNIQUE INDEX tasks_test_idempotency
        ON tasks(client_id, source_workflow, body) NULLS NOT DISTINCT`);
      const orgId = randomUUID(), clientId = randomUUID();
      const now = new Date("2026-10-29T12:00:00Z");
      const spec = { orgId, clientId, roundsCap: 6, now };

      const first = await createRepairStartTasks(conn, { ...spec, eventId: "payment-1" });
      assert.equal(first.count, 2, "both required staff jobs must survive one payment's dedupe key");
      let rows = (await conn.query(`SELECT title, body, due_at, assignee_role
        FROM tasks WHERE client_id = $1 ORDER BY title`, [clientId])).rows;
      assert.equal(rows.length, 2);
      assert.equal(new Set(rows.map((r) => r.body)).size, 2,
        "distinct jobs need distinct stable database idempotency keys");
      assert.ok(rows.every((r) => r.assignee_role === "inquiry_specialist" && r.due_at),
        "both jobs must be owned and visible on the staff Calendar");

      const replay = await createRepairStartTasks(conn, { ...spec, eventId: "payment-2" });
      assert.equal(replay.count, 0, "later installment must not mint another pair");
      assert.equal((await conn.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n, 2);

      // Real legacy partial state: first task was saved but the other lost.
      await conn.query("DELETE FROM tasks");
      const oldTitle = firstRepairTasks({ roundsCap: 6, now })[0].title;
      await conn.query(`INSERT INTO tasks
        (org_id, client_id, title, body, source_workflow, assignee_role)
        VALUES ($1,$2,$3,'old-payment-event','repair-enrollment','inquiry_specialist')`,
        [orgId, clientId, oldTitle]);
      const recover = await createRepairStartTasks(conn, { ...spec, eventId: "payment-retry" });
      assert.equal(recover.count, 1, "missing documents job must be recovered without duplicating intake");
      rows = (await conn.query("SELECT title, body FROM tasks ORDER BY title")).rows;
      assert.equal(rows.length, 2);
      assert.ok(rows.some((r) => r.title === oldTitle && r.body === "old-payment-event"),
        "historical staff work must never be rewritten");
      assert.ok(rows.some((r) => /photo identification and proof of address/.test(r.title)));
    } finally {
      await conn.query("ROLLBACK").catch(() => {});
      conn.release();
      await pool.end();
    }
  });
