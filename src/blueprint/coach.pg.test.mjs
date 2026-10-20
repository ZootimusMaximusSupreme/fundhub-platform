// Actual migrated progress/task constraints and writer SQL. Local scratch only;
// transaction-local table shadows, always rollback, no model/provider calls.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { applyBlueprintCoachAction } from "./coach.mjs";
import { nextStepOf } from "../progress/read.mjs";
import { deliverNudge } from "../nudge/run.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local database configured */ }
const options = { skip: safe ? false : "no local test/scratch database; live databases refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

async function fixture(run) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout = '5s'");
    for (const table of ["clients", "staff", "client_waypoints", "tasks", "agents", "waypoint_nudges", "messages", "events"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const orgId = randomUUID();
    const clientId = (await db.query("INSERT INTO clients (org_id, first_name, email,phone) VALUES ($1,'Coach',$2,'+16025550100') RETURNING id",
      [orgId, `e2e+aff-coach-${randomUUID()}@example.com`])).rows[0].id;
    const advisorId = (await db.query("INSERT INTO staff (org_id,name,role,status,active,is_demo) VALUES ($1,'Real advisor','csm','active',true,false) RETURNING id", [orgId])).rows[0].id;
    await db.query("UPDATE clients SET assigned_csm_staff_id=$2 WHERE id=$1", [clientId, advisorId]);
    await db.query(`INSERT INTO client_waypoints (org_id,client_id,key,title,position,owner_kind,state,verify_kind)
      VALUES ($1,$2,'our_job','Prepare letters',0,'fundhub','in_progress',NULL),
        ($1,$2,'mail_letters','Mail letters',1,'client','in_progress','dispute_mail_receipt'),
        ($1,$2,'later_step','Later step',2,'client','not_started',NULL)`, [orgId, clientId]);
    const scope = { orgId, clientId, conversationId: null, channel: "sms", eventId: `event-${randomUUID()}`,
      inboundBody: "I have started mailing the letters", agent: { code: "BP-COACH", status: "live" } };
    // Eligibility/context are isolated from unrelated purchase/projection tables
    // in this writer proof. They still read this real fixture using BOTH IDs.
    const isBuyerImpl = async (conn, ids) => !!(await conn.query("SELECT id FROM clients WHERE org_id=$1 AND id=$2", [ids.orgId, ids.clientId])).rows[0];
    const fetchContextImpl = async (conn, ids) => {
      const client = (await conn.query("SELECT id, assigned_csm_staff_id FROM clients WHERE org_id=$1 AND id=$2", [ids.orgId, ids.clientId])).rows[0];
      const steps = (await conn.query("SELECT *, owner_kind AS owner FROM client_waypoints WHERE org_id=$1 AND client_id=$2 ORDER BY position,key", [ids.orgId, ids.clientId])).rows;
      const next = nextStepOf(steps);
      return { client, blueprint: { access_active: true, human_advisor: client?.assigned_csm_staff_id ? { id: client.assigned_csm_staff_id } : null },
        checklist: { open_step: steps.find((row) => row.id === next?.waypointId) || null }, as_prompt_block: "Actual scratch checklist" };
    };
    await run({ db, scope, advisorId, deps: { isBuyerImpl, fetchContextImpl } });
  } finally { await db.query("ROLLBACK"); db.release(); }
}

test("real current-step UPDATE records progress but never another step or company/client", options, async () => {
  await fixture(async ({ db, scope, deps }) => {
    const action = { type: "report_progress", waypointKey: "mail_letters", state: "in_progress" };
    assert.equal((await applyBlueprintCoachAction(db, scope, action, deps)).ok, true);
    const row = (await db.query("SELECT state,state_reason,completed_at FROM client_waypoints WHERE org_id=$1 AND client_id=$2 AND key='mail_letters'", [scope.orgId, scope.clientId])).rows[0];
    assert.equal(row.state, "in_progress");
    assert.match(row.state_reason, /I have started mailing/);
    assert.equal(row.completed_at, null);
    for (const changed of [{ orgId: randomUUID() }, { clientId: randomUUID() }]) {
      assert.equal((await applyBlueprintCoachAction(db, { ...scope, ...changed }, action, deps)).ok, false);
    }
    assert.equal((await applyBlueprintCoachAction(db, scope, { ...action, waypointKey: "later_step" }, deps)).reason, "not_current_client_step");
    for (const bad of [{ ...action, state: "done" }, { type: "complete" }, { type: "verify_progress", crsResult: { fake: true } }]) {
      assert.equal((await applyBlueprintCoachAction(db, scope, bad, deps)).ok, false);
    }
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM tasks")).rows[0].n), 0);
    assert.equal((await db.query("SELECT state FROM client_waypoints WHERE key='later_step'")).rows[0].state, "not_started");
  });
});

test("actual nudge claim constraints preserve draft/later-step recovery and prevent racing duplicate queues", options, async () => {
  await fixture(async ({ db, scope }) => {
    const now = new Date("2026-10-20T18:00:00Z");
    await db.query("UPDATE client_waypoints SET due_at=$3 WHERE org_id=$1 AND client_id=$2", [scope.orgId, scope.clientId, now]);
    await db.query(`INSERT INTO agents (org_id,code,name,agent_class,channel,status,runtime,prompt)
      VALUES ($1,'BP-COACH','AI coach','client_facing','sms_email','draft','internal','Reviewed fixture prompt')`, [scope.orgId]);
    const rows = (await db.query("SELECT * FROM client_waypoints WHERE owner_kind='client' ORDER BY position,key")).rows;
    const candidate = (index) => ({ orgId: scope.orgId, clientId: scope.clientId, waypointId: rows[index].id,
      key: rows[index].key, title: rows[index].title, step: 1 });
    // This proof isolates purchase eligibility/projection. All checklist,
    // client, agent, claim, cap and queued-message storage below is real SQL.
    const isolated = { query: (sql, params) => {
      if (/FROM transactions/.test(sql)) return Promise.resolve({ rows: [{ id: randomUUID(), status: "succeeded", amount_paid: "7500.00" }] });
      if (/FROM v_client_entitlements/.test(sql)) return Promise.resolve({ rows: [{ active: true }] });
      return db.query(sql, params);
    } };
    const queue = async (conn, input) => {
      const inserted = await conn.query(`INSERT INTO messages (org_id,client_id,direction,channel,rendered_body,provider_ref,status)
        VALUES ($1,$2,'outbound',$3,'Actual scratch queued reminder',$4,'queued')
        ON CONFLICT (org_id,provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING RETURNING id`,
      [input.orgId, input.clientId, input.channel, `coach-pg:${input.eventId}`]);
      return { sent: true, messageId: inserted.rows[0]?.id || null };
    };
    assert.equal((await deliverNudge(isolated, candidate(1), { now, send: queue })).reasons[0], "blueprint_coach_not_live");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM waypoint_nudges")).rows[0].n), 0);
    await db.query("UPDATE agents SET status='live' WHERE code='BP-COACH'");
    assert.equal((await deliverNudge(isolated, candidate(1), { now, send: queue })).reasons[0], "not_current_client_step");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM waypoint_nudges")).rows[0].n), 0);
    await db.query("UPDATE client_waypoints SET state='done',completed_at=now() WHERE key='mail_letters'");
    const held = await deliverNudge(isolated, candidate(1), { now, send: async () => ({ sent: false, reason: "template_pending", retryable: true }) });
    assert.equal(held.action, "skipped");
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM waypoint_nudges")).rows[0].n), 0);
    const outcomes = await Promise.all(Array.from({ length: 8 }, () => deliverNudge(isolated, candidate(1), { now, send: queue })));
    assert.equal(outcomes.filter((out) => out.action === "queued").length, 1);
    const claim = (await db.query("SELECT outcome,message_id FROM waypoint_nudges")).rows;
    assert.equal(claim.length, 1);
    assert.equal(claim[0].outcome, "queued");
    assert.ok(claim[0].message_id);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM messages WHERE direction='outbound'")).rows[0].n), 1);
  });
});

test("proof completion between context read and write cannot be reopened by a stale coach turn", options, async () => {
  await fixture(async ({ db, scope, deps }) => {
    let frozen;
    const raced = { ...deps, fetchContextImpl: async (conn, ids) => {
      frozen = await deps.fetchContextImpl(conn, ids);
      await conn.query("UPDATE client_waypoints SET state='done', completed_at=now() WHERE org_id=$1 AND client_id=$2 AND key='mail_letters'", [scope.orgId, scope.clientId]);
      return frozen;
    } };
    const out = await applyBlueprintCoachAction(db, scope, { type: "report_progress", waypointKey: "mail_letters", state: "blocked" }, raced);
    assert.equal(frozen.checklist.open_step.state, "in_progress");
    assert.equal(out.reason, "step_changed");
    const row = (await db.query("SELECT state,completed_at FROM client_waypoints WHERE key='mail_letters'")).rows[0];
    assert.equal(row.state, "done");
    assert.ok(row.completed_at);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM tasks")).rows[0].n), 0);
  });
});

test("a blocked step creates one real assigned-advisor task across event replay", options, async () => {
  await fixture(async ({ db, scope, advisorId, deps }) => {
    const action = { type: "report_progress", waypointKey: "mail_letters", state: "blocked" };
    const first = await applyBlueprintCoachAction(db, scope, action, deps);
    const second = await applyBlueprintCoachAction(db, scope, action, deps);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.taskId, first.taskId);
    const rows = (await db.query("SELECT * FROM tasks WHERE org_id=$1 AND client_id=$2", [scope.orgId, scope.clientId])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assignee_role, "csm");
    assert.equal(rows[0].assignee_staff_id, advisorId);
    assert.match(rows[0].detail, /Client message: I have started mailing/);
    assert.equal((await db.query("SELECT state FROM client_waypoints WHERE key='mail_letters'")).rows[0].state, "blocked");
  });
});
