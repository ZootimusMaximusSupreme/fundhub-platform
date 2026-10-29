// F-08 Calendar acceptance uses only disposable localhost GitHub Actions Postgres.
// TEMP tables live in one transaction, rolled back. No production/customer/provider effects.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { handle } from "./f-08-post-funding-monitoring.mjs";
import { fakeStep, ev } from "./test-support.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname) &&
      u.pathname === "/fundhub_ci";
  } catch { return false; }
})();
const testPool = SCRATCH
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000 })
  : null;
after(async () => { if (testPool) await testPool.end(); });

test("F-08 stores a due 30-day advisor check-in, one per funded round, with real PG", {
  skip: !SCRATCH
}, async () => {
  const conn = await testPool.connect();
  try {
    await conn.query("BEGIN");
    await conn.query("CREATE TEMP TABLE clients (id uuid PRIMARY KEY, org_id uuid NOT NULL, email text)");
    await conn.query(`CREATE TEMP TABLE tasks (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      org_id uuid NOT NULL,
      client_id uuid NOT NULL,
      assignee text,
      title text NOT NULL,
      body text,
      due_at timestamptz,
      source_workflow text NOT NULL,
      assignee_role text NOT NULL,
      assignee_staff_id uuid,
      meeting_url text,
      UNIQUE (client_id, source_workflow, body)
    )`);
    const org = randomUUID(), otherOrg = randomUUID();
    const client = randomUUID(), otherClient = randomUUID();
    await conn.query(
      "INSERT INTO clients(id,org_id,email) VALUES ($1,$2,'owned@example.invalid'),($3,$4,'foreign@example.invalid')",
      [client, org, otherClient, otherOrg]
    );

    const now = new Date("2026-10-29T14:00:00Z");
    const e1 = ev("round.funded", { rail: "card_stacking" }, {
      id: randomUUID(), orgId: org, clientId: client
    });
    const first = await handle({ event: e1, db: conn, step: fakeStep(), now });
    assert.equal(first.done, true);
    assert.equal(first.task.created, true);

    const saved = await conn.query(
      "SELECT body, source_workflow, assignee_role, due_at FROM tasks WHERE org_id=$1 AND client_id=$2",
      [org, client]
    );
    assert.equal(saved.rows.length, 1);
    assert.equal(saved.rows[0].source_workflow, "f-08-post-funding-monitoring");
    assert.equal(saved.rows[0].assignee_role, "funding_advisor");
    assert.equal(saved.rows[0].due_at.toISOString(), "2026-11-28T14:00:00.000Z");
    assert.equal(saved.rows[0].body, e1.id);

    await handle({ event: e1, db: conn, step: fakeStep(), now: new Date("2026-11-10T14:00:00Z") });
    const replay = await conn.query(
      "SELECT due_at FROM tasks WHERE org_id=$1 AND client_id=$2",
      [org, client]
    );
    assert.equal(replay.rows.length, 1, "replay did not insert a duplicate row");
    assert.equal(replay.rows[0].due_at.toISOString(), "2026-11-28T14:00:00.000Z",
      "later retry must not shift existing check-in");

    const e2 = ev("round.funded", { rail: "card_stacking" }, {
      id: randomUUID(), orgId: org, clientId: client
    });
    await handle({
      event: e2, db: conn, step: fakeStep(), now: new Date("2026-10-31T14:00:00Z")
    });
    const second = await conn.query(
      "SELECT due_at FROM tasks WHERE org_id=$1 AND client_id=$2 ORDER BY due_at",
      [org, client]
    );
    assert.equal(second.rows.length, 2);
    assert.equal(second.rows[1].due_at.toISOString(), "2026-11-30T14:00:00.000Z");

    const foreignEvent = ev("round.funded", {}, {
      id: randomUUID(), orgId: org, clientId: otherClient
    });
    const rejected = await handle({ event: foreignEvent, db: conn, step: fakeStep(), now });
    assert.equal(rejected.done, false);
    assert.equal(rejected.reason, "no_client");
    const afterForeign = await conn.query("SELECT COUNT(*)::int AS n FROM tasks");
    assert.equal(afterForeign.rows[0].n, 2);
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
    conn.release();
  }
});
