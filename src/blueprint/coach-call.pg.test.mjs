// Actual candidate SQL, migrated receipt constraints and writer idempotency.
// Local scratch/CI only. Every fixture lives in transaction-local shadows and
// rolls back. Providers/models are not called; this is not live delivery proof.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { planBlueprintCoachCalls, deliverBlueprintCoachCall } from "./coach-call.mjs";

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no scratch configured */ }
const options = { skip: safe ? false : "no local test/scratch database; live databases refused" };
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });
const NOW = new Date("2026-10-20T18:00:00Z");
const FIRST = new Date("2026-10-14T18:00:00Z");
const SECOND = new Date("2026-10-19T18:00:00Z");
const migration = readFileSync(new URL("../../db/migrations/489_blueprint_coach_call_ledger.sql", import.meta.url), "utf8")
  .replaceAll("public.waypoint_nudges", "pg_temp.waypoint_nudges");

async function fixture(run) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    await db.query("SET LOCAL statement_timeout = '5s'");
    for (const table of ["clients", "client_waypoints", "waypoint_nudges", "messages", "outbound_calls", "conversations", "agents", "products", "transactions", "tasks"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    await db.query("CREATE TEMP TABLE v_client_entitlements (org_id uuid,client_id uuid,entitlement_code text,active boolean) ON COMMIT DROP");
    const orgId = randomUUID();
    const clientId = (await db.query(`INSERT INTO clients (org_id,first_name,email,phone,custom_fields)
      VALUES ($1,'Coach Call',$2,'+16025550100','{"timezone":"America/Phoenix"}') RETURNING id`,
    [orgId, `e2e+aff-coach-call-${randomUUID()}@example.com`])).rows[0].id;
    const waypointId = (await db.query(`INSERT INTO client_waypoints
      (org_id,client_id,key,title,position,owner_kind,state,verify_kind,due_at,created_at,updated_at)
      VALUES ($1,$2,'mail','Mail letters',1,'client','in_progress','dispute_mail_receipt',$3,$3,$3) RETURNING id`,
    [orgId, clientId, new Date("2026-10-13T18:00:00Z")])).rows[0].id;
    await db.query(`INSERT INTO products (org_id,code,name) VALUES ($1,'consulting-package','Scratch Consulting Package')`, [orgId]);
    await db.query(`INSERT INTO transactions (org_id,client_id,product_name,amount_paid,status)
      VALUES ($1,$2,'Scratch Consulting Package',7500,'succeeded')`, [orgId, clientId]);
    await db.query(`INSERT INTO v_client_entitlements VALUES ($1,$2,'credit-optimization-roadmap',true)`, [orgId, clientId]);
    await db.query(`INSERT INTO agents (org_id,code,name,agent_class,channel,status,runtime,prompt,guardrails)
      VALUES ($1,'BP-COACH-VOICE','AI coach','client_facing','voice','live','bland','You are the AI coach, not the human advisor.','{"authority":{"msgcap":3}}')`, [orgId]);
    const messages = [];
    for (const [step, key, date] of [[1,"SMS-BLUEPRINT-COACH-DUE",FIRST],[3,"SMS-BLUEPRINT-COACH-NUDGE-2",SECOND]]) {
      const id = (await db.query(`INSERT INTO messages
        (org_id,client_id,direction,channel,template_key,rendered_body,provider,provider_ref,provider_message_id,status,created_at)
        VALUES ($1,$2,'outbound','sms',$3,'Saved current-step reminder','twilio',$4,$5,'sent',$6) RETURNING id`,
      [orgId, clientId, key, `test:${randomUUID()}`, `accepted-${step}`, date])).rows[0].id;
      messages.push(id);
      await db.query(`INSERT INTO waypoint_nudges
        (org_id,client_id,waypoint_id,step,kind,channel,template_key,outcome,message_id,idempotency_key,
          client_local_date,client_time_zone,destination_key,created_at)
        VALUES ($1,$2,$3,$4,'client_message','sms',$5,'queued',$6,$7,$8::date,'America/Phoenix','6025550100',$8)`,
      [orgId, clientId, waypointId, step, key, id, `test-nudge:${randomUUID()}`, date]);
    }
    const candidate = { waypoint_id: waypointId, org_id: orgId, client_id: clientId, key: "mail", title: "Mail letters" };
    const context = { client: { id: clientId, flags: {} }, blueprint: { access_active: true },
      checklist: { open_step: { key: "mail", title: "Mail letters", owner: "client", state: "in_progress", verify_kind: "dispute_mail_receipt" } },
      as_prompt_block: "Saved scratch client context" };
    await run({ db, orgId, clientId, waypointId, messages, candidate, context });
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
}

test("real candidate SQL refuses queued/failed/unattributed texts, replies, progress, later steps and inactive access", options, async () => {
  await fixture(async ({ db, orgId, clientId, waypointId, messages }) => {
    const plan = () => planBlueprintCoachCalls(db, { orgId, now: NOW });
    assert.equal((await plan()).length, 1);
    for (const status of ["queued", "failed", "dispatching"]) {
      await db.query("UPDATE messages SET status=$2 WHERE id=$1", [messages[1], status]);
      assert.equal((await plan()).length, 0, status);
    }
    await db.query("UPDATE messages SET status='sent',provider_message_id=NULL WHERE id=$1", [messages[1]]);
    assert.equal((await plan()).length, 0);
    await db.query("UPDATE messages SET provider_message_id='accepted-1' WHERE id=$1", [messages[1]]);
    assert.equal((await plan()).length, 0, "one provider receipt cannot count as two texts");
    await db.query("UPDATE messages SET provider_message_id='accepted-3' WHERE id=$1", [messages[1]]);
    const reply = (await db.query(`INSERT INTO messages (org_id,client_id,direction,channel,created_at)
      VALUES ($1,$2,'inbound','email',$3) RETURNING id`, [orgId, clientId, SECOND])).rows[0].id;
    assert.equal((await plan()).length, 0, "cross-channel reply ends old sequence");
    await db.query("DELETE FROM messages WHERE id=$1", [reply]);
    await db.query("UPDATE client_waypoints SET updated_at=$2 WHERE id=$1", [waypointId, SECOND]);
    assert.equal((await plan()).length, 0, "saved progress ends old sequence");
    await db.query("UPDATE client_waypoints SET updated_at=$2 WHERE id=$1", [waypointId, new Date("2026-10-13T18:00:00Z")]);
    await db.query("UPDATE v_client_entitlements SET active=false");
    assert.equal((await plan()).length, 0);
    await db.query("UPDATE v_client_entitlements SET active=true");
    await db.query(`INSERT INTO conversations (org_id,client_id,channel,agent_code) VALUES ($1,$2,'sms','AG-01')`, [orgId, clientId]);
    assert.equal((await plan()).length, 0, "explicit other agent owns the conversation");
    await db.query("UPDATE conversations SET agent_code='BP-COACH',agent_halted_at=$1", [NOW]);
    assert.equal((await plan()).length, 0);
    await db.query("UPDATE conversations SET agent_halted_at=NULL");
    assert.equal((await plan()).length, 1);
    assert.equal((await planBlueprintCoachCalls(db, { orgId: randomUUID(), now: NOW })).length, 0);
    await db.query(`INSERT INTO client_waypoints (org_id,client_id,key,title,position,owner_kind,state)
      VALUES ($1,$2,'prior','Prior client job',0,'client','not_started')`, [orgId, clientId]);
    assert.equal((await plan()).length, 0);
  });
});

test("real voice writer and ledger UNIQUE admit one call and retain provider attribution on racing attempts", options, async () => {
  await fixture(async ({ db, orgId, candidate, context }) => {
    let calls = 0;
    const deps = { now: NOW, env: { MESSAGING_DRY_RUN: "0", BLAND_API_KEY: "unit-placeholder" },
      prepareTurnImpl: async () => ({ ok: true, context }), gateImpl: async () => ({ state: "allowed" }),
      blockersForImpl: async () => [], isOptedOutImpl: async () => false,
      placeCallImpl: async () => { calls++; return { status: "sent", callId: `scratch-${randomUUID()}` }; },
      createTaskImpl: async () => { throw new Error("No human exception expected"); } };
    const results = await Promise.all(Array.from({ length: 8 }, () => deliverBlueprintCoachCall(db, candidate, deps)));
    assert.equal(calls, 1);
    assert.equal(results.filter((result) => result.placed).length, 1);
    const receipt = (await db.query("SELECT * FROM waypoint_nudges WHERE org_id=$1 AND step=5", [orgId])).rows[0];
    assert.equal(receipt.kind, "voice_call");
    assert.equal(receipt.outcome, "queued");
    const message = (await db.query("SELECT * FROM messages WHERE id=$1", [receipt.message_id])).rows[0];
    assert.equal(message.status, "sent");
    assert.equal(message.provider, "bland");
    assert.equal(message.sender_agent_code, "BP-COACH-VOICE");
    const dispatch = (await db.query("SELECT * FROM outbound_calls WHERE call_id=$1", [message.provider_message_id])).rows[0];
    assert.equal(dispatch.org_id, orgId);
    assert.equal(dispatch.client_id, candidate.client_id);
    assert.equal((await planBlueprintCoachCalls(db, { orgId, now: NOW })).length, 0);
  });
});

test("489 replay preserves old ladder rows; real CHECKs reject arbitrary voice shapes and both daily caps still apply", options, async () => {
  await fixture(async ({ db, orgId, clientId, waypointId }) => {
    await db.query(migration);
    await db.query(migration);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM waypoint_nudges")).rows[0].n), 2);
    const voice = [orgId, clientId, waypointId, "2026-10-20", "6025550100"];
    const insert = `INSERT INTO waypoint_nudges
      (org_id,client_id,waypoint_id,step,kind,channel,template_key,outcome,idempotency_key,client_local_date,destination_key)
      VALUES ($1,$2,$3,5,'voice_call','voice','BP-COACH-VOICE','claimed','voice-shape',$4::date,$5)`;
    const refuses = async (sql, params, code) => {
      await db.query("SAVEPOINT refusal");
      await assert.rejects(db.query(sql, params), (err) => err.code === code);
      await db.query("ROLLBACK TO SAVEPOINT refusal");
    };
    for (const sql of [insert.replace("5,'voice_call'", "6,'voice_call'"),
      insert.replace("5,'voice_call'", "1,'voice_call'"), insert.replace("'voice','BP-COACH-VOICE'", "'sms','BP-COACH-VOICE'"),
      insert.replace("'BP-COACH-VOICE'", "NULL"), insert.replace("'BP-COACH-VOICE'", "'AG-04'")]) {
      await refuses(sql, voice, "23514");
    }
    await refuses(insert, [orgId, clientId, waypointId, "2026-10-19", "6025550100"], "23505");
    await db.query(insert, voice);
    await refuses(insert, voice, "23505");
    const secondClient = (await db.query("INSERT INTO clients (org_id,first_name) VALUES ($1,'Same phone') RETURNING id", [orgId])).rows[0].id;
    const secondWaypoint = (await db.query(`INSERT INTO client_waypoints (org_id,client_id,key,title,owner_kind)
      VALUES ($1,$2,'other','Other','client') RETURNING id`, [orgId, secondClient])).rows[0].id;
    await refuses(insert, [orgId, secondClient, secondWaypoint, "2026-10-20", "6025550100"], "23505");
    await db.query(`INSERT INTO waypoint_nudges (org_id,client_id,waypoint_id,step,kind,outcome,idempotency_key)
      VALUES ($1,$2,$3,4,'staff_task','staff_task','still-human')`, [orgId, clientId, waypointId]);
    assert.equal(Number((await db.query("SELECT count(*) AS n FROM waypoint_nudges WHERE step=4")).rows[0].n), 1);
  });
});
