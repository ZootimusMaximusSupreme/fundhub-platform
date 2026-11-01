// CI disposable Postgres: synthetic two-buyer booking identity and no sends.
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool, close } from "../db.mjs";
import { CallOutcomeError, logCallOutcome } from "./call-outcomes.mjs";

const SCRATCH = (() => {
  if (process.env.CI !== "true" || !process.env.DATABASE_URL) return false;
  try {
    const u = new URL(process.env.DATABASE_URL);
    return ["localhost", "127.0.0.1"].includes(u.hostname)
      && u.pathname === "/fundhub_ci";
  } catch { return false; }
})();

test("real Postgres refuses cross-buyer booking UID before any writer or event",
  { skip: !SCRATCH }, async () => {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    await conn.query(`CREATE TEMP TABLE clients
      (id uuid PRIMARY KEY, org_id uuid, custom_fields jsonb) ON COMMIT DROP`);
    await conn.query(`CREATE TEMP TABLE bookings
      (org_id uuid, client_id uuid, provider_uid text) ON COMMIT DROP`);
    await conn.query(`CREATE TEMP TABLE tasks
      (id uuid, org_id uuid, client_id uuid, body text,
       assignee_role text, title text) ON COMMIT DROP`);
    await conn.query(`CREATE TEMP TABLE call_outcomes
      (id uuid, org_id uuid, client_id uuid, task_id uuid, booking_ref text) ON COMMIT DROP`);
    const orgId = randomUUID(), a = randomUUID(), b = randomUUID();
    const staffId = randomUUID(), taskId = randomUUID();
    const uidA = "ci-A-" + randomUUID(), uidB = "ci-B-" + randomUUID();
    await conn.query("INSERT INTO clients VALUES ($1,$2,'{}'),($3,$2,'{}')",
      [a, orgId, b]);
    await conn.query("INSERT INTO bookings VALUES ($1,$2,$3),($1,$4,$5)",
      [orgId, a, uidA, b, uidB]);
    await conn.query(`INSERT INTO tasks
      (id,org_id,client_id,body,assignee_role,title)
      VALUES ($1,$2,$3,$4,'closer','Strategy session booked')`,
      [taskId, orgId, b, uidA]);
    let inserts = 0, events = 0, taskUpdates = 0;
    const reached = new Error("valid write reached, deliberately intercepted");
    const db = { query: async (sql, args) => {
      if (/INSERT INTO call_outcomes/.test(sql)) { inserts++; throw reached; }
      if (/INSERT INTO events/.test(sql)) { events++; throw Error("no events in test"); }
      if (/UPDATE tasks/.test(sql)) { taskUpdates++; throw Error("no task writes"); }
      return conn.query(sql, args);
    } };
    const log = (uid, extra = {}) => logCallOutcome(db, {
      orgId, clientId: b, staffId, bookingRef: uid,
      outcome: "callback", ...extra
    });
    // Before the fix these two calls reached INSERT despite A owning UID.
    await assert.rejects(log(uidA),
      (e) => e instanceof CallOutcomeError && e.code === "booking_not_found");
    await assert.rejects(log(uidA, { taskId }),
      (e) => e instanceof CallOutcomeError && e.code === "booking_not_found");
    assert.equal(inserts, 0);
    assert.equal(events, 0);
    assert.equal(taskUpdates, 0);
    await assert.rejects(log(uidB), (e) => e === reached);
    assert.equal(inserts, 1);
    await assert.rejects(log("unknown-" + randomUUID()),
      (e) => e instanceof CallOutcomeError && e.code === "booking_not_found");
    assert.equal(inserts, 1);
    const legacy = "legacy-" + randomUUID();
    await conn.query("UPDATE tasks SET body=$1 WHERE id=$2", [legacy, taskId]);
    await assert.rejects(log(legacy), (e) => e === reached);
    assert.equal(inserts, 2, "same-client exact legacy task allowed");
    assert.equal(events, 0);
    assert.equal(taskUpdates, 0);
    assert.equal((await conn.query("SELECT count(*)::int AS n FROM call_outcomes")).rows[0].n, 0);
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
    conn.release();
    await close();
  }
});
