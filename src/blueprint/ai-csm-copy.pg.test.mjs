// 490 against the real migrated table shapes: it rewrites only rows that still
// hold the exact 488 wording (owner-set 2026-10-20: the CSM is the AI coaches
// plus the Fundhub team queue), keeps agents live, switches the changed email
// off like the template editor, and leaves owner edits and other orgs alone.
// Local named scratch/test databases only; a live database is refused.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";

const sql488 = readFileSync(new URL("../../db/migrations/488_blueprint_coach_agents.sql", import.meta.url), "utf8");
const sql490 = readFileSync(new URL("../../db/migrations/490_blueprint_ai_csm_copy.sql", import.meta.url), "utf8");
const [newSms, newVoice, newBlock, newEmail] = [...sql490.matchAll(/\$new\$([\s\S]*?)\$new\$/g)].map((m) => m[1]);
const [oldSms, oldVoice, oldBlock, oldEmail] = [...sql490.matchAll(/\$old\$([\s\S]*?)\$old\$/g)].map((m) => m[1]);

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local scratch database */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });
const options = { skip: safe ? false : "no local test/scratch database; live databases refused" };

async function scratch(fn) {
  const db = await pool.connect();
  await db.query("BEGIN");
  try {
    for (const table of ["orgs", "agents", "message_templates"]) {
      await db.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
    }
    const org = randomUUID();
    const other = randomUUID();
    await db.query(`INSERT INTO orgs (id,slug,name,is_default) VALUES
      ($1,'fundhub','Fundhub',false),($2,'other-company','Other company',true)`, [org, other]);
    // A second company holding the same 488 words must never be touched.
    await db.query(`INSERT INTO agents (org_id,code,name,agent_class,channel,status,runtime,prompt)
      VALUES ($1,'BP-COACH','Other coach','client_facing','sms_email','live','internal',$2)`, [other, oldSms]);
    await db.query(`INSERT INTO message_templates (org_id,template_key,channel,subject,body,compliance_passed)
      VALUES ($1,'EMAIL-BLUEPRINT-COACH-NUDGE-1','email','Other',$2,true)`, [other, oldEmail]);
    await db.query(sql488);
    // Production state: both coaches live, every reminder template approved.
    await db.query(`UPDATE agents SET status='live' WHERE org_id=$1 AND code LIKE 'BP-COACH%'`, [org]);
    await db.query(`UPDATE message_templates SET compliance_passed=true, approved_at=now(), approved_body_sha='sha-488'
      WHERE org_id=$1`, [org]);
    await fn(db, { org, other });
  } finally { await db.query("ROLLBACK"); db.release(); }
}

const agent = (db, org, code) => db.query("SELECT * FROM agents WHERE org_id=$1 AND code=$2", [org, code]).then((r) => r.rows[0]);
const template = (db, org, key) => db.query("SELECT * FROM message_templates WHERE org_id=$1 AND template_key=$2", [org, key]).then((r) => r.rows[0]);

test("490 rewrites exact-488 Fundhub rows to AI-CSM team copy, keeps agents live and switches the changed email off", options, async () => {
  await scratch(async (db, { org, other }) => {
    const beforeGuard = (await agent(db, org, "BP-COACH")).guardrails;
    assert.equal(beforeGuard.block, oldBlock);
    await db.query(sql490);
    const sms = await agent(db, org, "BP-COACH");
    const voice = await agent(db, org, "BP-COACH-VOICE");
    assert.equal(sms.prompt, newSms);
    assert.equal(voice.prompt, newVoice);
    for (const row of [sms, voice]) {
      assert.equal(row.status, "live", "agent status is untouched");
      assert.equal(row.guardrails.block, newBlock);
      assert.deepEqual({ ...row.guardrails, block: null }, { ...beforeGuard, block: null }, "every other guardrail key is unchanged");
    }
    const email = await template(db, org, "EMAIL-BLUEPRINT-COACH-NUDGE-1");
    assert.equal(email.body, newEmail);
    assert.equal(email.compliance_passed, false, "changed copy stops sending until re-approved");
    assert.equal(email.approved_body_sha, "sha-488", "the editor keeps the last approval as audit trail");
    for (const key of ["SMS-BLUEPRINT-COACH-DUE", "SMS-BLUEPRINT-COACH-NUDGE-2"]) {
      assert.equal((await template(db, org, key)).compliance_passed, true, `${key} is unchanged`);
    }
    assert.equal((await agent(db, other, "BP-COACH")).prompt, oldSms, "other company untouched");
    assert.equal((await template(db, other, "EMAIL-BLUEPRINT-COACH-NUDGE-1")).body, oldEmail);
    assert.equal((await template(db, other, "EMAIL-BLUEPRINT-COACH-NUDGE-1")).compliance_passed, true);
    // Replay is a no-op: nothing still holds the 488 text.
    await db.query("UPDATE message_templates SET compliance_passed=true WHERE org_id=$1", [org]);
    await db.query(sql490);
    assert.equal((await template(db, org, "EMAIL-BLUEPRINT-COACH-NUDGE-1")).compliance_passed, true, "re-approval survives a replay");
    assert.equal((await agent(db, org, "BP-COACH")).prompt, newSms);
  });
});

test("490 leaves owner-edited prompts, guardrails and template bodies exactly as the owner saved them", options, async () => {
  await scratch(async (db, { org }) => {
    await db.query(`UPDATE agents SET prompt='Owner voice prompt',
      guardrails = jsonb_set(guardrails, '{block}', to_jsonb('Owner block'::text)) WHERE org_id=$1 AND code='BP-COACH-VOICE'`, [org]);
    await db.query(`UPDATE message_templates SET body='Owner email words'
      WHERE org_id=$1 AND template_key='EMAIL-BLUEPRINT-COACH-NUDGE-1'`, [org]);
    await db.query(sql490);
    const voice = await agent(db, org, "BP-COACH-VOICE");
    assert.equal(voice.prompt, "Owner voice prompt");
    assert.equal(voice.guardrails.block, "Owner block");
    const email = await template(db, org, "EMAIL-BLUEPRINT-COACH-NUDGE-1");
    assert.equal(email.body, "Owner email words");
    assert.equal(email.compliance_passed, true, "an owner-approved edit stays approved");
    assert.equal((await agent(db, org, "BP-COACH")).prompt, newSms, "the untouched 488 row still updates");
  });
});
