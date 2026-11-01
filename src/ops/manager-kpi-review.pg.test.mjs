// Real SQL and task insert proof on disposable GitHub Actions Postgres only.
// All fixtures shadow production tables in one transaction and roll back.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { runManagerKpiReview, SOURCE_WORKFLOW } from "./manager-kpi-review.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const url = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      && url.pathname === "/fundhub_ci";
  } catch { return false; }
})();
const pool = SCRATCH
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
  : null;
after(async () => { if (pool) await pool.end(); });

test("manager KPI review creates one owned dated task per closer and month on real Postgres", {
  skip: !SCRATCH
}, async () => {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(`CREATE TEMP TABLE staff (
      id uuid PRIMARY KEY, org_id uuid NOT NULL, name text, email text,
      role text NOT NULL, status text NOT NULL, is_demo boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE hiring_roles (
      org_id uuid NOT NULL, key text NOT NULL,
      hiring_manager_staff_id uuid, owner_role text NOT NULL
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE clients (
      id uuid PRIMARY KEY, org_id uuid NOT NULL, is_demo boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE call_outcomes (
      id uuid PRIMARY KEY, org_id uuid NOT NULL, client_id uuid NOT NULL,
      staff_id uuid NOT NULL, outcome text NOT NULL, transaction_id uuid,
      cash_collected_cents integer NOT NULL, logged_at timestamptz NOT NULL,
      is_demo boolean NOT NULL DEFAULT false
    ) ON COMMIT DROP`);
    await db.query(`CREATE TEMP TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL,
      client_id uuid, assignee text, title text NOT NULL, body text,
      due_at timestamptz, source_workflow text, assignee_role text,
      assignee_staff_id uuid, meeting_url text, detail text
    ) ON COMMIT DROP`);
    await db.query(`CREATE UNIQUE INDEX tasks_idempotency_idx
      ON tasks (client_id, source_workflow, body) NULLS NOT DISTINCT`);

    const orgA = randomUUID(), orgB = randomUUID();
    const closerA = randomUUID(), managerA = randomUUID();
    const chrisA = randomUUID(), otherOwnerA = randomUUID();
    const closerB = randomUUID(), managerB = randomUUID();
    const clientA = randomUUID(), clientB = randomUUID();
    await db.query(`INSERT INTO staff (id, org_id, name, email, role, status) VALUES
      ($1,$2,'Avery Closer','avery@example.invalid','closer','active'),
      ($3,$2,'Morgan Manager','morgan@example.invalid','sales_manager','active'),
      ($4,$5,'Blair Closer','blair@example.invalid','closer','active'),
      ($6,$5,'Taylor Manager','taylor@example.invalid','sales_manager','active'),
      ($7,$2,'Chris Stanbridge','chris@fundhub.ai','owner','active'),
      ($8,$2,'Other Owner','other@example.invalid','owner','active')`,
    [closerA, orgA, managerA, closerB, orgB, managerB, chrisA, otherOwnerA]);
    await db.query(`INSERT INTO hiring_roles
      (org_id, key, hiring_manager_staff_id, owner_role) VALUES
      ($1,'closer',$2,'sales_manager'), ($3,'closer',NULL,'sales_manager')`,
    [orgA, managerA, orgB]);
    await db.query("INSERT INTO clients (id, org_id) VALUES ($1,$2),($3,$4)",
      [clientA, orgA, clientB, orgB]);
    for (const [orgId, clientId, staffId] of [
      [orgA, clientA, closerA], [orgA, clientA, chrisA],
      [orgA, clientA, otherOwnerA], [orgB, clientB, closerB]
    ]) {
      await db.query(`INSERT INTO call_outcomes
        (id, org_id, client_id, staff_id, outcome, transaction_id,
         cash_collected_cents, logged_at)
        SELECT gen_random_uuid(), $1, $2, $3,
               CASE WHEN n <= 2 THEN 'deposit' ELSE 'callback' END,
               CASE WHEN n <= 2 THEN gen_random_uuid() ELSE NULL END,
               CASE WHEN n <= 2 THEN 3000 ELSE 0 END,
               '2026-10-20T14:00:00Z'::timestamptz
          FROM generate_series(1, 10) AS n`, [orgId, clientId, staffId]);
    }
    // A foreign client and a demo outcome must not distort A's real close rate.
    await db.query(`INSERT INTO call_outcomes
      (id,org_id,client_id,staff_id,outcome,cash_collected_cents,logged_at,is_demo)
      VALUES (gen_random_uuid(),$1,$2,$3,'callback',0,$4,false),
             (gen_random_uuid(),$1,$5,$3,'callback',0,$4,true),
             (gen_random_uuid(),$1,$5,$3,'no_show',0,$4,false)`,
    [orgA, clientB, closerA, "2026-10-20T14:00:00Z", clientA]);

    const now = new Date("2026-10-30T14:30:00Z");
    const first = await runManagerKpiReview(db, { orgId: orgA, now });
    assert.deepEqual({ checked: first.checked, flagged: first.flagged, created: first.created, ok: first.ok },
      { checked: 2, flagged: 2, created: 2, ok: true });
    const savedA = (await db.query("SELECT * FROM tasks WHERE org_id = $1", [orgA])).rows;
    assert.equal(savedA.length, 2, "the ordinary and owner-set closers each get one review");
    for (const [staffId, name] of [[closerA, "Avery Closer"], [chrisA, "Chris Stanbridge"]]) {
      const task = savedA.find(row => row.body.includes(staffId));
      assert.ok(task, `${name} has a task`);
      assert.equal(task.client_id, null, "staff work is not attached to a customer");
      assert.equal(task.source_workflow, SOURCE_WORKFLOW);
      assert.equal(task.assignee_role, "sales_manager");
      assert.equal(task.assignee_staff_id, managerA, "the configured manager receives A's task");
      assert.equal(task.due_at.toISOString(), "2026-11-02T17:00:00.000Z");
      assert.match(task.detail, /2 deposits from 10 held calls/);
      assert.match(task.detail, /decide whether coaching or a PIP is needed/);
    }
    assert.ok(savedA.every(row => !row.body.includes(otherOwnerA)),
      "another owner is not treated as a closer");

    const replay = await runManagerKpiReview(db, { orgId: orgA, now });
    assert.equal(replay.created, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n, 2,
      "a staff-only NULL-client task remains unique on replay");

    const otherOrg = await runManagerKpiReview(db, { orgId: orgB, now });
    assert.equal(otherOrg.created, 1);
    const savedB = (await db.query("SELECT * FROM tasks WHERE org_id = $1", [orgB])).rows;
    assert.equal(savedB.length, 1);
    assert.equal(savedB[0].assignee_staff_id, managerB,
      "B's sole active manager receives B's task, never A's manager");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM tasks")).rows[0].n, 3);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    db.release();
  }
});
