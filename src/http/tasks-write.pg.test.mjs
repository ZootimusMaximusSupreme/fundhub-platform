// Postgres-backed tests for the ACTIVE-SHIFT GATE on PATCH /api/tasks.
//
// THIS FILE LIVES UNDER src/http/, NOT NEXT TO THE HANDLER. package.json's test
// glob is "src/**/*.test.mjs" and "scripts/**/*.test.mjs"; a test placed in api/
// is never collected and passes forever by never running. The handler is
// imported from here instead.
//
// WHAT THESE ASSERT AGAINST. Every refusal is checked against the `tasks` table,
// not against the JSON the handler returned. A 403 body is the endpoint's account
// of what it did; the unchanged row is what it did. A gate that answers 403 and
// updates anyway is the failure that matters, and only the table can see it.
//
// THE WHOLE PATCH BRANCH IS GATED — claim, reassign AND done — so all three are
// checked here. See the header of api/tasks.mjs for why `done` is included on
// weaker evidence than the other two.
//
// GET is checked from the other direction: the queue screen must still answer 200
// for a staff member with no shift at all. That is the guard against over-gating,
// which is the more expensive mistake — it locks a working employee out of the
// screen that holds the clock-in button.
//
// Skipped without DATABASE_URL like every other *.pg.test.mjs. The handler is
// imported inside before() so that the skip is a real skip.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinels. Everything this file creates carries one, and the purge runs
// before() as well as after(): a crashed previous run must not collide with
// idx_staff_email_org.
const STAFF_EMAIL = "taskgate_pg_test@example.com";
const MATE_EMAIL = "taskgate_pg_test_mate@example.com";
const STAFF_EMAIL_LIKE = "taskgate_pg_test%@example.com";
const TITLE = "taskgate pgtest work item";

const res = () => {
  const r = { code: null, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[String(k).toLowerCase()] = v; return r; };
  r.getHeader = (k) => r.headers[String(k).toLowerCase()];
  return r;
};

describe("PATCH /api/tasks — active-shift gate", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let handler, org, staffId, mateId, token, taskId;

  /* The handler runs the real requirePrincipal against the real sessions table,
     so every call carries a token minted for a real staff row. There is no
     injection seam, deliberately. */
  const call = async (method, { body, query, token: tok } = {}) => {
    const r = res();
    await handler({
      method,
      query: query || {},
      body,
      headers: tok ? { authorization: "Bearer " + tok } : {}
    }, r);
    return r;
  };

  // --- what the database actually holds -------------------------------------
  const taskRow = async () => (await db.query(
    `SELECT id, assignee_staff_id, assignee_role, done FROM tasks WHERE id = $1`,
    [taskId])).rows[0];

  // --- the clock ------------------------------------------------------------
  // Plain SQL rather than src/shifts/store.mjs on purpose: that module belongs to
  // another workflow, and this suite tests the gate, not the clock. `ended_at IS
  // NULL` is the whole definition of "open" (it is the predicate on
  // uq_shifts_one_open), so these two statements are it.
  const openShift = async () => (await db.query(
    `INSERT INTO shifts (org_id, staff_id) VALUES ($1,$2) RETURNING id`,
    [org, staffId])).rows[0].id;

  const closeAllShifts = async () => {
    await db.query(`DELETE FROM shifts WHERE staff_id = ANY($1)`, [[staffId, mateId].filter(Boolean)]);
  };

  // Put the task back to unclaimed + not done, so "the write did not happen" is a
  // statement about THIS test and not about whichever one ran before it.
  const resetTask = async () => {
    await db.query(
      `UPDATE tasks SET assignee_staff_id = NULL, done = false WHERE id = $1`, [taskId]);
  };

  const assertUntouched = async (where) => {
    const row = await taskRow();
    assert.equal(row.assignee_staff_id, null, `${where}: assignee_staff_id was written anyway`);
    assert.equal(row.done, false, `${where}: done was flipped anyway`);
  };

  async function purge() {
    // tasks.assignee_staff_id is ON DELETE SET NULL, not CASCADE, so the task
    // rows are deleted by title before the staff rows go. sessions.staff_id and
    // shifts.staff_id are both ON DELETE CASCADE and ride along with the staff
    // delete.
    await db.query(`DELETE FROM tasks WHERE title = $1`, [TITLE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  before(async () => {
    ({ default: handler } = await import("../../api/tasks.mjs"));

    org = await resolveDefaultOrg(db);
    await purge();

    const mkStaff = async (name, email) => (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,'setter',$3,'active') RETURNING id`, [org, name, email])).rows[0].id;

    staffId = await mkStaff("Taskgate Pgtest Caller", STAFF_EMAIL);
    mateId = await mkStaff("Taskgate Pgtest Mate", MATE_EMAIL);

    token = (await createSession(db, { staffId, orgId: org })).token;

    // Unclaimed, in a role queue — exactly what a person picks from.
    taskId = (await db.query(
      `INSERT INTO tasks (org_id, title, assignee_role, done)
       VALUES ($1,$2,'setter',false) RETURNING id`, [org, TITLE])).rows[0].id;
  });

  after(async () => {
    await purge();
    await close();
  });

  // =========================================================================
  // NO OPEN SHIFT → 403 no_active_shift, and nothing written.
  // =========================================================================
  describe("with no open shift", () => {
    before(async () => { await closeAllShifts(); });

    test("claim:true is refused and the task stays unclaimed", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, claim: true } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("claim");
    });

    test("assignee_staff_id reassignment is refused and assigns nobody", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, assignee_staff_id: mateId } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("reassign");
    });

    test("done:true is refused and the task stays open", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, done: true } });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
      await assertUntouched("done");
    });

    test("the refusal names the fix, so the screen can tell it from a role denial", async () => {
      const r = await call("PATCH", { token, body: { id: taskId, claim: true } });
      assert.equal(r.code, 403);
      assert.match(String(r.body.message), /clock in/i);
    });

    test("the gate fires BEFORE the body is validated — a bodyless PATCH is 403, not 400", async () => {
      // Whether you may write at all is not a question about the payload. If this
      // ever returns 400 `id_required` it means the gate moved below the
      // validation and the endpoint's parameter rules are mappable off the clock.
      const r = await call("PATCH", { token, body: {} });
      assert.equal(r.code, 403);
      assert.equal(r.body.error, "no_active_shift");
    });

    // ---- the untouched read. The guard against over-gating. ----
    test("GET /api/tasks still returns the queue off the clock", async () => {
      await resetTask();
      const r = await call("GET", { token, query: { role: "setter", limit: "200" } });
      assert.equal(r.code, 200, `the queue screen was gated: ${JSON.stringify(r.body)}`);
      assert.ok(Array.isArray(r.body.tasks));
      assert.ok(r.body.tasks.some((t) => t.id === taskId),
        "the seeded task was not in the queue — the read did not really run");
    });

    test("GET ?unclaimed=1 — the pick-from list — also still works off the clock", async () => {
      await resetTask();
      const r = await call("GET", { token, query: { role: "setter", unclaimed: "1", limit: "200" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.ok(r.body.tasks.some((t) => t.id === taskId));
    });

    // The document vault (Capital Blueprint B3) puts one readable sentence on the
    // closing prep call and the closer alert: tasks.detail, migration 472.
    test("GET returns each task's readable note (tasks.detail), null when there is none", async () => {
      await resetTask();
      let r = await call("GET", { token, query: { role: "setter", limit: "200" } });
      const before = r.body.tasks.find((t) => t.id === taskId);
      assert.ok(Object.hasOwn(before, "detail"), "detail is part of every task row");
      assert.equal(before.detail, null);
      await db.query(`UPDATE tasks SET detail = $2 WHERE id = $1`, [taskId, "Document vault: file complete — 3 of 3 items accepted."]);
      r = await call("GET", { token, query: { role: "setter", limit: "200" } });
      assert.equal(r.body.tasks.find((t) => t.id === taskId).detail, "Document vault: file complete — 3 of 3 items accepted.");
      await db.query(`UPDATE tasks SET detail = NULL WHERE id = $1`, [taskId]);
    });
  });

  // =========================================================================
  // AN OPEN SHIFT → the writes go through, exactly as before the gate existed.
  // =========================================================================
  describe("with an open shift", () => {
    before(async () => { await closeAllShifts(); await openShift(); });
    after(async () => { await closeAllShifts(); });

    test("claim:true assigns the task to the caller", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, claim: true } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal(r.body.ok, true);
      const row = await taskRow();
      assert.equal(row.assignee_staff_id, staffId,
        "the assignment column is the reason this is gated");
    });

    test("assignee_staff_id hands the task to somebody else", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, assignee_staff_id: mateId } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal((await taskRow()).assignee_staff_id, mateId);
    });

    test("done:true closes the task", async () => {
      await resetTask();
      const r = await call("PATCH", { token, body: { id: taskId, done: true } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.equal((await taskRow()).done, true);
    });

    test("the claim race still answers 409, so the gate did not eat the domain error", async () => {
      // The handler's own rule: claim is conditional on assignee_staff_id IS NULL
      // and the loser must be told. Gating the branch must not swallow that.
      await resetTask();
      await db.query(`UPDATE tasks SET assignee_staff_id = $2 WHERE id = $1`, [taskId, mateId]);
      const r = await call("PATCH", { token, body: { id: taskId, claim: true } });
      assert.equal(r.code, 409);
      assert.equal(r.body.error, "already_claimed");
      assert.equal((await taskRow()).assignee_staff_id, mateId, "the loser overwrote the winner");
    });
  });

  // =========================================================================
  // THE GATE FOLLOWS THE SHIFT. Clocking out closes the endpoint again — it is
  // not a one-time check performed at sign-in.
  // =========================================================================
  test("clocking out closes the endpoint again", async () => {
    await closeAllShifts();
    await resetTask();
    await openShift();

    const ok = await call("PATCH", { token, body: { id: taskId, claim: true } });
    assert.equal(ok.code, 200, JSON.stringify(ok.body));
    assert.equal((await taskRow()).assignee_staff_id, staffId);

    await db.query(`UPDATE shifts SET ended_at = now() WHERE staff_id = $1 AND ended_at IS NULL`, [staffId]);

    const refused = await call("PATCH", { token, body: { id: taskId, done: true } });
    assert.equal(refused.code, 403);
    assert.equal(refused.body.error, "no_active_shift");
    assert.equal((await taskRow()).done, false, "the task was closed after clock-out");

    await closeAllShifts();
    await resetTask();
  });

  // =========================================================================
  // A FAILED CHECK IS 503, NOT A SILENT PASS.
  //
  // AUDIT-FINDINGS.md lesson 3: "'Absent config' must never mean 'no gate.'" An
  // outage is absent config. requireActiveShift already answers 503 when the
  // shift lookup throws; what is proved HERE is that this handler's composition
  // does not defeat it — that the 503 reaches the caller unreshaped by the PATCH
  // branch's own try/catch (which maps failures onto 400/500), and above all that
  // the UPDATE does not happen anyway.
  //
  // The failure is injected at the one query the gate makes (SELECT ... FROM
  // shifts) rather than by breaking the pool, because breaking the pool would
  // fail requirePrincipal first and this test would pass for the wrong reason.
  // db is a plain { query } object from src/db.mjs and this file runs in its own
  // process, so the patch cannot leak into another suite; it is restored in a
  // finally regardless.
  // =========================================================================
  test("a database failure inside the shift check is a 503, and still writes nothing", async () => {
    await closeAllShifts();
    await openShift();          // clocked IN — so a pass here would be a real write
    await resetTask();

    const realQuery = db.query;
    let sawShiftQuery = false;
    db.query = (sql, params) => {
      if (/FROM\s+shifts/i.test(String(sql))) {
        sawShiftQuery = true;
        return Promise.reject(Object.assign(new Error("simulated outage"), { code: "25P02" }));
      }
      return realQuery(sql, params);
    };

    let r;
    try {
      r = await call("PATCH", { token, body: { id: taskId, claim: true } });
    } finally {
      db.query = realQuery;
    }

    assert.ok(sawShiftQuery, "the shift check never ran — this test proved nothing");
    assert.equal(r.code, 503, `a failed shift check must not fall through: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error, "shift_unavailable");
    assert.equal(r.body.db, "down");
    await assertUntouched("outage");

    await closeAllShifts();
  });
});
