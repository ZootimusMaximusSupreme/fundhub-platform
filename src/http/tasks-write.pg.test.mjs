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
import { db, pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { listSetterQueue, updateSetterHandoff } from "../setter/dashboard.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;

// Sentinels. Everything this file creates carries one, and the purge runs
// before() as well as after(): a crashed previous run must not collide with
// idx_staff_email_org.
const STAFF_EMAIL = "taskgate_pg_test@example.com";
const MATE_EMAIL = "taskgate_pg_test_mate@example.com";
const CLOSER_EMAIL = "taskgate_pg_test_closer@example.com";
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
  let handler, org, staffId, mateId, token, mateToken, closerToken, taskId;

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
    const closerId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,$2,'closer',$3,'active') RETURNING id`,
      [org, "Taskgate Pgtest Closer", CLOSER_EMAIL])).rows[0].id;

    token = (await createSession(db, { staffId, orgId: org })).token;
    mateToken = (await createSession(db, { staffId: mateId, orgId: org })).token;
    closerToken = (await createSession(db, { staffId: closerId, orgId: org })).token;

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

    test("GET pages 201 same-time tasks without losing or repeating a row", async () => {
      await resetTask();
      const seeded = await db.query(
        `INSERT INTO tasks (org_id, title, body, assignee_role, done, due_at, created_at)
         SELECT $1, $2, 'pg-page-' || n::text, 'setter', false,
                '2026-11-02T16:00:00Z'::timestamptz, '2026-11-01T01:00:00Z'::timestamptz
           FROM generate_series(1, 201) AS n RETURNING id`, [org, TITLE]);
      try {
        const first = await call("GET", { token, query: { q: TITLE, done: "false", limit: "200", stable: "1" } });
        assert.match(first.body.revision, /^[a-f0-9]{32}$/);
        assert.ok(first.body.next_after);
        const nextQuery = { q: TITLE, done: "false", limit: "200", stable: "1",
          after: first.body.next_after, revision: first.body.revision };
        const second = await call("GET", { token, query: nextQuery });
        assert.equal(first.code, 200, JSON.stringify(first.body));
        assert.equal(second.code, 200, JSON.stringify(second.body));
        assert.equal(first.body.can_open_setter, true);
        assert.equal(first.body.tasks.length, 200);
        assert.equal(second.body.tasks.length, 2);
        const ids = first.body.tasks.concat(second.body.tasks).map(row => row.id);
        assert.equal(new Set(ids).size, 202);
        assert.deepEqual(new Set(ids), new Set([taskId, ...seeded.rows.map(row => row.id)]));
        const repeat = await call("GET", { token, query: nextQuery });
        assert.deepEqual(repeat.body.tasks.map(row => row.id), second.body.tasks.map(row => row.id));
        await db.query(`UPDATE tasks SET due_at = '2026-11-01T16:00:00Z'::timestamptz
          WHERE id = $1`, [second.body.tasks[0].id]);
        const changed = await call("GET", { token, query: nextQuery });
        assert.equal(changed.code, 409);
        assert.equal(changed.body.error, "task_queue_changed");
        for (const offset of ["0", "200", "0 OR 1=1"]) {
          const bad = await call("GET", { token, query: { offset } });
          assert.equal(bad.code, 400);
          assert.equal(bad.body.error, "offset_not_supported");
        }
      } finally {
        await db.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [seeded.rows.map(row => row.id)]);
      }
    });

    test("GET ?unclaimed=1 — the pick-from list — also still works off the clock", async () => {
      await resetTask();
      const r = await call("GET", { token, query: { role: "setter", unclaimed: "1", limit: "200" } });
      assert.equal(r.code, 200, JSON.stringify(r.body));
      assert.ok(r.body.tasks.some((t) => t.id === taskId));
    });

    test("GET keeps unlinked and other-assignee setter tasks from opening a lead", async () => {
      const setterRead = await call("GET", { token, query: { q: TITLE, limit: "1" } });
      const closerRead = await call("GET", { token: closerToken, query: { q: TITLE, limit: "1" } });
      assert.equal(setterRead.code, 200);
      assert.equal(closerRead.code, 200);
      assert.equal(setterRead.body.can_open_setter, true);
      assert.equal(closerRead.body.can_open_setter, false);
      assert.equal(setterRead.body.tasks[0].can_open_setter, false);
      await db.query(`UPDATE tasks SET assignee_staff_id = $2 WHERE id = $1`, [taskId, mateId]);
      try {
        const assignedRead = await call("GET", { token, query: { q: TITLE, limit: "1" } });
        assert.equal(assignedRead.body.tasks[0].can_open_setter, false);
      } finally {
        await resetTask();
      }
    });

    test("exact setter queue read keeps assignment and archive gates", async () => {
      const clients = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1,'taskgate_exact_1@example.com','Older','Lead'),
                ($1,'taskgate_exact_2@example.com','Other','Setter')
         RETURNING id`, [org])).rows.map(row => row.id);
      try {
        await db.query(
          `INSERT INTO tasks (org_id, client_id, title, body, assignee_role, assignee_staff_id, source_workflow)
           VALUES ($1,$2,$4,'exact-open','setter',NULL,'setter-entry'),
                  ($1,$3,$4,'exact-other','setter',$5,'setter-entry')`,
          [org, clients[0], clients[1], TITLE, mateId]);
        const staff = { id: staffId, org_id: org, role: "setter" };
        const own = await listSetterQueue(db, staff, { clientId: clients[0], limit: 1 });
        const other = await listSetterQueue(db, staff, { clientId: clients[1], limit: 1 });
        assert.deepEqual(own.items.map(item => item.client_id), [clients[0]]);
        assert.equal(other.items.length, 0);
        await db.query(
          `UPDATE clients SET custom_fields = jsonb_build_object('crm_archived_at', now()::text)
            WHERE id = $1`, [clients[0]]);
        const archived = await listSetterQueue(db, staff, { clientId: clients[0], limit: 1 });
        assert.equal(archived.items.length, 0);
        const calendarRead = await call("GET", { token, query: {
          client_id: clients[0], done: "false", stable: "1" } });
        assert.equal(calendarRead.code, 200);
        assert.equal(calendarRead.body.tasks.length, 0);
      } finally {
        await db.query("DELETE FROM tasks WHERE client_id = ANY($1::uuid[])", [clients]);
        await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [clients]);
      }
    });

    test("a newer task assigned to B hides A's old setter link and exact card", async () => {
      const clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1,'taskgate_setter_transfer@example.com','Current','Setter') RETURNING id`,
        [org])).rows[0].id;
      try {
        await db.query(
          `UPDATE clients SET custom_fields = jsonb_build_object('setter_handoff',
             jsonb_build_object('setter_staff_id',$2::text,'setter_name','Old Setter','call_attempts',0))
           WHERE id = $1`, [clientId, staffId]);
        const tasks = (await db.query(
          `INSERT INTO tasks
             (org_id, client_id, title, body, assignee_role, assignee_staff_id,
              source_workflow, created_at)
           VALUES
             ($1,$2,$3,'old-A','setter',$4,'setter-entry','2026-11-01T01:00:00Z'),
             ($1,$2,$3,'new-B','setter',$5,'setter-booking','2026-11-01T02:00:00Z')
           RETURNING id, body`, [org, clientId, TITLE, staffId, mateId])).rows;
        const oldId = tasks.find(row => row.body === "old-A").id;
        const newId = tasks.find(row => row.body === "new-B").id;
        const a = { id: staffId, org_id: org, role: "setter" };
        const b = { id: mateId, org_id: org, role: "setter", name: "Taskgate Pgtest Mate" };
        assert.equal((await listSetterQueue(db, a, { clientId, limit: 1 })).items.length, 0);
        const bQueue = await listSetterQueue(db, b, { clientId, limit: 1 });
        assert.deepEqual(bQueue.items.map(item => item.client_id), [clientId]);
        assert.equal(bQueue.items[0].setter_staff_id, mateId);

        const aRead = await call("GET", { token, query: { client_id: clientId, done: "false" } });
        const bRead = await call("GET", { token: mateToken, query: { client_id: clientId, done: "false" } });
        assert.equal(aRead.code, 200, JSON.stringify(aRead.body));
        assert.equal(bRead.code, 200, JSON.stringify(bRead.body));
        assert.deepEqual(aRead.body.tasks.map(row => [row.id, row.can_open_setter]).sort(),
          [[oldId, false], [newId, false]].sort());
        assert.deepEqual(bRead.body.tasks.map(row => [row.id, row.can_open_setter]).sort(),
          [[oldId, false], [newId, true]].sort());

        const aSave = await updateSetterHandoff(db, a, {
          client_id: clientId, action: "save", handoff: { call_attempts: 1 }
        });
        assert.equal(aSave.status, 403);
        const bSave = await updateSetterHandoff(db, b, {
          client_id: clientId, action: "save", handoff: { call_attempts: 1 }
        });
        assert.equal(bSave.status, 200, JSON.stringify(bSave.body));
        const saved = (await db.query("SELECT custom_fields FROM clients WHERE id = $1", [clientId])).rows[0];
        assert.equal(saved.custom_fields.setter_handoff.setter_staff_id, mateId);
        assert.equal(saved.custom_fields.setter_handoff.setter_name, "Taskgate Pgtest Mate");
        assert.equal(saved.custom_fields.setter_handoff.call_attempts, 1);
      } finally {
        await db.query("DELETE FROM tasks WHERE client_id = $1", [clientId]);
        await db.query("DELETE FROM clients WHERE id = $1", [clientId]);
      }
    });

    test("a transfer after A's first read cannot use A's older row to save", async () => {
      for (const action of ["save", "save_survey"]) {
        const clientId = (await db.query(
          `INSERT INTO clients (org_id, email, first_name, last_name, custom_fields)
           VALUES ($1,$2,'Raced','Lead',$3::jsonb) RETURNING id`,
          [org, `taskgate_race_${action}@example.com`, JSON.stringify({
            cf_svy_funding_target_amount_label: "$50k - $100k"
          })])).rows[0].id;
        try {
          const tasks = (await db.query(
            `INSERT INTO tasks
               (org_id, client_id, title, body, assignee_role, assignee_staff_id,
                source_workflow, created_at)
             VALUES
               ($1,$2,$3,'race-old','setter',$4,'setter-entry','2026-11-01T01:00:00Z'),
               ($1,$2,$3,'race-latest','setter',$4,'setter-booking','2026-11-01T02:00:00Z')
             RETURNING id, body`, [org, clientId, TITLE, staffId])).rows;
          const oldId = tasks.find(row => row.body === "race-old").id;
          const latestId = tasks.find(row => row.body === "race-latest").id;
          let sawInitialAssignment = false;
          let transferred = false;
          const racingDb = {
            query: async (sql, params) => {
              const result = await db.query(sql, params);
              if (sql.trim().startsWith("SELECT assignee_staff_id FROM tasks")) {
                sawInitialAssignment = result.rows[0]?.assignee_staff_id === staffId;
              }
              return result;
            },
            connect: async () => {
              assert.equal(sawInitialAssignment, true);
              await db.query("UPDATE tasks SET assignee_staff_id = $2 WHERE id = $1", [latestId, mateId]);
              transferred = true;
              return pool().connect();
            }
          };
          const attempt = await updateSetterHandoff(racingDb,
            { id: staffId, org_id: org, role: "setter", name: "A Setter" },
            action === "save"
              ? { client_id: clientId, action, handoff: { call_attempts: 1 } }
              : { client_id: clientId, action, survey_edits: { cf_svy_funding_target_amount: "$100k - $200k" } });
          assert.equal(transferred, true);
          assert.equal(attempt.status, 403, JSON.stringify(attempt.body));
          const state = (await db.query(
            `SELECT c.custom_fields,
                    (SELECT assignee_staff_id FROM tasks WHERE id = $2) AS old_assignee,
                    (SELECT assignee_staff_id FROM tasks WHERE id = $3) AS latest_assignee
               FROM clients c WHERE c.id = $1`, [clientId, oldId, latestId])).rows[0];
          assert.equal(state.old_assignee, staffId);
          assert.equal(state.latest_assignee, mateId);
          assert.equal(state.custom_fields.setter_handoff, undefined);
          assert.equal(state.custom_fields.setter_survey_edits, undefined);
        } finally {
          await db.query("DELETE FROM tasks WHERE client_id = $1", [clientId]);
          await db.query("DELETE FROM clients WHERE id = $1", [clientId]);
        }
      }
    });

    test("setter sends run only after commit and never after a rolled-back commit", async () => {
      const handoff = {
        lead_type: "booked", setter_staff_id: staffId, closer_staff_id: staffId,
        dialed_at: "2026-11-01T19:00:00Z", call_attempts: 1, disposition: "reached",
        time_confirmed: true, frame_warmed: true, problem: "Working capital",
        goal: "Original goal", computer_ready: true, app_on_phone: false,
        complete_at: "2026-11-01T19:10:00Z"
      };
      const clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name, custom_fields)
         VALUES ($1,'taskgate_send_order@example.com','Send','Order',$2::jsonb) RETURNING id`,
        [org, JSON.stringify({ setter_handoff: handoff })])).rows[0].id;
      try {
        await db.query(
          `INSERT INTO bookings (org_id, client_id, source, starts_at, status)
           VALUES ($1,$2,'sim','2026-11-03T19:00:00Z','booked')`, [org, clientId]);
        await db.query(
          `INSERT INTO tasks (org_id, client_id, title, body, assignee_role, assignee_staff_id, source_workflow)
           VALUES ($1,$2,$3,'send-order','setter',$4,'setter-booking')`,
          [org, clientId, TITLE, staffId]);

        const transactionalDb = (onCommit, failCommit = false) => ({
          query: (...args) => db.query(...args),
          connect: async () => {
            const client = await pool().connect();
            return {
              query: async (...args) => {
                if (args[0] === "COMMIT" && failCommit) throw new Error("injected_commit_failure");
                const result = await client.query(...args);
                if (args[0] === "COMMIT") onCommit();
                return result;
              },
              release: () => client.release()
            };
          }
        });
        const setter = { id: staffId, org_id: org, role: "setter", name: "A Setter" };
        for (const action of ["send_intro_video", "send_handoff"]) {
          let committed = false;
          let sends = 0;
          const wrapped = transactionalDb(() => { committed = true; });
          const result = await updateSetterHandoff(wrapped, setter,
            { client_id: clientId, action, handoff: { goal: action + " saved" } }, {
              sendAction: async args => {
                sends++;
                assert.equal(committed, true, "provider callback ran before COMMIT");
                assert.equal(args.db, wrapped, "send must use the committed database handle");
                const visible = (await db.query(
                  `SELECT custom_fields->'setter_handoff'->>'goal' AS goal
                     FROM clients WHERE id = $1`, [clientId])).rows[0].goal;
                assert.equal(visible, action + " saved", "a separate connection must see the saved handoff");
                return { outcome: "sent", handoffPatch: { video_sent_at: "2026-11-01T20:00:00Z" } };
              }
            });
          assert.equal(result.status, 200, JSON.stringify(result.body));
          assert.equal(sends, 1);
          assert.equal(result.body.send.outcome, "sent");
        }

        let sendsAfterFailure = 0;
        await assert.rejects(
          updateSetterHandoff(transactionalDb(() => {}, true), setter,
            { client_id: clientId, action: "send_intro_video", handoff: { goal: "Must roll back" } },
            { sendAction: async () => { sendsAfterFailure++; return { outcome: "sent" }; } }),
          /injected_commit_failure/
        );
        assert.equal(sendsAfterFailure, 0);
        const afterFailure = (await db.query(
          `SELECT custom_fields->'setter_handoff'->>'goal' AS goal
             FROM clients WHERE id = $1`, [clientId])).rows[0].goal;
        assert.equal(afterFailure, "send_handoff saved");
      } finally {
        await db.query("DELETE FROM tasks WHERE client_id = $1", [clientId]);
        await db.query("DELETE FROM bookings WHERE client_id = $1", [clientId]);
        await db.query("DELETE FROM clients WHERE id = $1", [clientId]);
      }
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

    test("generic completion cannot bypass the setter handoff for either setter task type", async () => {
      for (const source of ["setter-entry", "setter-booking"]) {
        await resetTask();
        await db.query(`UPDATE tasks SET source_workflow = $2 WHERE id = $1`, [taskId, source]);
        try {
          const r = await call("PATCH", { token, body: { id: taskId, done: true } });
          assert.equal(r.code, 409);
          assert.equal(r.body.error, "setter_handoff_required");
          assert.equal((await taskRow()).done, false);
        } finally {
          await db.query(`UPDATE tasks SET source_workflow = NULL WHERE id = $1`, [taskId]);
        }
      }
    });

    test("the dedicated completed handoff still closes setter work in real Postgres", async () => {
      const clientId = (await db.query(
        `INSERT INTO clients (org_id, email, first_name, last_name)
         VALUES ($1,'taskgate_handoff@example.com','Handoff','Buyer') RETURNING id`, [org])).rows[0].id;
      try {
        await db.query(
          `INSERT INTO bookings (org_id, client_id, source, starts_at, status)
           VALUES ($1,$2,'sim','2026-11-03T19:00:00Z','booked')`, [org, clientId]);
        const setterTask = (await db.query(
          `INSERT INTO tasks (org_id, client_id, title, body, assignee_role, assignee_staff_id, source_workflow)
           VALUES ($1,$2,$3,'handoff-open','setter',$4,'setter-entry') RETURNING id`,
          [org, clientId, TITLE, staffId])).rows[0].id;
        const result = await updateSetterHandoff(db,
          { id: staffId, org_id: org, role: "owner", name: "Taskgate Owner" },
          { client_id: clientId, action: "complete", handoff: {
            dialed_at: "2026-11-01T19:00:00Z", call_attempts: 1, disposition: "reached",
            time_confirmed: true, frame_warmed: true, problem: "Working capital",
            goal: "Open a second location", computer_ready: true, app_on_phone: false
          } },
          { buildText: () => "Saved handoff", advanceStage: async () =>
            ({ moved: false, reason: "already_at_or_past" }), closerAlert: async () => ({ queued: 0 }) });
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const saved = (await db.query(
          `SELECT t.done, c.custom_fields->'setter_handoff'->>'complete_at' AS completed
             FROM tasks t JOIN clients c ON c.id = t.client_id WHERE t.id = $1`, [setterTask])).rows[0];
        assert.equal(saved.done, true);
        assert.ok(saved.completed);
      } finally {
        await db.query("DELETE FROM tasks WHERE client_id = $1", [clientId]);
        await db.query("DELETE FROM clients WHERE id = $1", [clientId]);
      }
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
