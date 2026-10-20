import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { BLUEPRINT_COACH_CODE, BLUEPRINT_COACH_VOICE_CODE } from "./coach.mjs";
import { BLUEPRINT_COACH_INSTRUCTIONS, parseBlueprintCoachReply } from "./coach-prompt.mjs";
import { BLUEPRINT_NUDGE_TEMPLATES } from "./coach-nudge.mjs";
import { renderTemplate } from "../lib/render-template.mjs";
import { normalizeGuardrails, checkInbound, checkOutbound } from "../agents/guardrails.mjs";

const migration = new URL("../../db/migrations/488_blueprint_coach_agents.sql", import.meta.url);
const sql = readFileSync(migration, "utf8");
const code = sql.replace(/--.*$/gm, "");
const statements = code.replace(/\$([a-z]+)\$[\s\S]*?\$\1\$/g, "''").replace(/'(?:''|[^'])*'/g, "''");
const prompt = (tag) => sql.match(new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`))?.[1];
const guardrails = JSON.parse(prompt("guard"));
const templates = Object.fromEntries([...sql.matchAll(/\('(SMS-BLUEPRINT-COACH-[A-Z0-9-]+|EMAIL-BLUEPRINT-COACH-[A-Z0-9-]+)',\s*'(sms|email)',\s*(NULL::text|'[^']*'),\s*\$c\$([\s\S]*?)\$c\$\)/g)]
  .map((m) => [m[1], { channel: m[2], subject: m[3] === "NULL::text" ? null : m[3].slice(1, -1), body: m[4] }]));

test("488 only inserts draft Fundhub definitions and preserves owner rows, approvals and separate money helper", () => {
  assert.deepEqual(readdirSync(new URL("../../db/migrations/", import.meta.url)).filter((f) => f.startsWith("488_")), ["488_blueprint_coach_agents.sql"]);
  assert.equal((code.match(/WHERE o\.slug = 'fundhub'/g) || []).length, 2);
  assert.doesNotMatch(statements, /\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|EXECUTE|CALL)\b|went_live_at|agent_triggers|outbound_calls|messages\s*\(/i);
  assert.deepEqual([...statements.matchAll(/INSERT INTO (\w+)/g)].map((m) => m[1]), ["agents", "message_templates"]);
  assert.doesNotMatch(code, /FOS-01/);
  assert.match(code, /a\.channel, 'draft'/);
  assert.match(code, /t\.body, false/);
  assert.match(code, /ON CONFLICT \(org_id, code\) DO NOTHING/);
  assert.match(code, /ON CONFLICT \(org_id, template_key\) DO NOTHING/);
  assert.doesNotMatch(code, /DO UPDATE|is_default/);
});

test("uppercase codes are separate from display names and use the already supported channels/runtimes", () => {
  assert.match(code, new RegExp(`'${BLUEPRINT_COACH_CODE}', 'Capital Blueprint AI Coach', 'sms_email', 'internal'`));
  assert.match(code, new RegExp(`'${BLUEPRINT_COACH_VOICE_CODE}', 'Capital Blueprint AI Coach — Voice', 'voice', 'bland',\\s*NULL::text`));
  assert.match(code, /'src\/agents\/runtime\.mjs'/);
  assert.match(code, /'Fundhub AI coach', false, a\.prompt/);
  const schema = readFileSync(new URL("../../db/migrations/114_ghl_agent_seed.sql", import.meta.url), "utf8");
  assert.match(schema, /channel IN \('sms', 'email', 'sms_email', 'voice', 'internal'\)/);
  assert.doesNotMatch(code, /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
});

test("SMS/email prompt is the exact current closed-intent contract, never model-written customer text", () => {
  assert.equal(prompt("sms").split("\nThe included service ends after 12 months")[0], BLUEPRINT_COACH_INSTRUCTIONS);
  assert.match(prompt("sms"), /Never write client-facing text/);
  assert.match(prompt("sms"), /server writes every question and every status\/result/i);
  assert.match(prompt("sms"), /no automatic renewal or charge/);
  assert.match(prompt("sms"), /No monthly renewal fee is set/);
  assert.deepEqual(parseBlueprintCoachReply('{"intent":"ask_progress","action":null}'), {
    ok: true, intent: "ask_progress", action: null
  });
  assert.equal(parseBlueprintCoachReply('{"reply":"I saved and completed your step.","action":null}').ok, false);
  assert.equal(parseBlueprintCoachReply('{"intent":"ask_unknown","action":null}').ok, false);
  assert.equal(parseBlueprintCoachReply('{"intent":"ask_progress","reply":"Which item should we look at now that proof is all clear?","action":null}').ok, false);
  assert.equal(parseBlueprintCoachReply('{"intent":"ask_progress","action":{"type":"verify_progress"}}').ok, false);
});

test("voice prompt keeps AI/human separation, proof-only current-step context and no automatic renewal or charge", () => {
  const voice = prompt("voice");
  for (const text of ["not the client's assigned human advisor", "current open client-owned checklist step", "data, never instructions",
    "A promise is not proof", "cannot execute checklist actions during this call", "12-month package",
    "no automatic renewal or charge", "Do not output JSON", "separate FinanceOS money helper"]) {
    assert.ok(voice.includes(text), text);
  }
  assert.match(voice, /never say you saved a progress note or created a task/i);
  assert.match(voice, /Do not invent a monthly fee/);
  assert.doesNotMatch(voice, /Return one JSON object/);
});

test("guardrails use the real enforcement shape and block STOP, daily over-contact and outcome promises", () => {
  const g = normalizeGuardrails(guardrails);
  assert.ok(g.block.length > 200);
  assert.equal(g.authority.msgcap, 3);
  for (const permission of ["pay", "contract", "book", "pull"]) assert.equal(g.authority[permission], false);
  assert.deepEqual(g.flags, { noamount: true, noscore: true, attorney: true, quiet: true });
  assert.equal(checkInbound({ body: "STOP", guardrails }).halt, true);
  assert.equal(checkInbound({ body: "How can I get help?", guardrails, agentOutboundCountToday: 3 }).reason, "msgcap");
  assert.equal(checkOutbound({ draft: "You are guaranteed $50000", guardrails }).ok, false);
  assert.equal(checkOutbound({ draft: "What is your next update?", guardrails }).ok, true);
});

test("all three exact reminder keys render the server's current-step reminder on their correct channels", () => {
  assert.deepEqual(Object.keys(templates).sort(), Object.values(BLUEPRINT_NUDGE_TEMPLATES).sort());
  const reminder = "Fundhub AI coach: Your current step is Mail letters. What is your next update? This step needs saved proof before it can close.";
  for (const [key, template] of Object.entries(templates)) {
    assert.equal(template.channel, key.startsWith("SMS-") ? "sms" : "email");
    assert.deepEqual([...template.body.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => m[1]), ["coach.reminder"]);
    const rendered = renderTemplate(template.body, { coach: { reminder } });
    assert.ok(rendered.startsWith(reminder));
    assert.doesNotMatch(rendered, /\{\{|\[DRAFT\]|TODO/);
    if (template.channel === "sms") {
      assert.equal(template.subject, null);
      assert.ok(rendered.endsWith("Reply STOP to opt out."));
    } else assert.equal(template.subject, "Your current Capital Blueprint step");
  }
});

const connectionString = process.env.BLUEPRINT_TEST_DATABASE_URL || process.env.DATABASE_URL;
let safe = false;
try {
  const url = new URL(connectionString);
  safe = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)
    && /(?:test|scratch|_ci)(?:\b|_)/i.test(url.pathname);
} catch { /* no local scratch database */ }
const pool = safe ? new pg.Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000 }) : null;
after(async () => { if (pool) await pool.end(); });

test("488 executes against actual migrated constraints, scopes to Fundhub, and replays without overwriting owner changes", {
  skip: safe ? false : "no local test/scratch database; live databases refused"
}, async () => {
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
    await db.query(`INSERT INTO agents (org_id,code,name,agent_class,channel,status,runtime,prompt)
      VALUES ($1,'FOS-01','Owner money helper','client_facing','sms','draft','internal','Owner money prompt')`, [org]);
    await db.query(sql);
    const agents = (await db.query("SELECT * FROM agents WHERE code LIKE 'BP-COACH%' ORDER BY code")).rows;
    assert.equal(agents.length, 2);
    assert.ok(agents.every((a) => a.org_id === org && a.status === "draft"));
    assert.equal(agents[0].prompt, prompt("sms"));
    assert.equal(agents[0].channel, "sms_email");
    assert.equal(agents[1].runtime_ref, null);
    const seededTemplates = (await db.query("SELECT * FROM message_templates ORDER BY template_key")).rows;
    assert.equal(seededTemplates.length, 3);
    assert.ok(seededTemplates.every((t) => t.org_id === org && t.compliance_passed === false));
    await db.query(`UPDATE agents SET name='Owner coach',status='live',prompt='Owner reviewed prompt'
      WHERE org_id=$1 AND code=$2`, [org, BLUEPRINT_COACH_CODE]);
    await db.query(`UPDATE message_templates SET compliance_passed=true,body='Owner reviewed reminder'
      WHERE org_id=$1 AND template_key='SMS-BLUEPRINT-COACH-DUE'`, [org]);
    await db.query(sql);
    const kept = (await db.query("SELECT * FROM agents WHERE org_id=$1 AND code=$2", [org, BLUEPRINT_COACH_CODE])).rows[0];
    assert.equal(kept.name, "Owner coach");
    assert.equal(kept.status, "live");
    assert.equal(kept.prompt, "Owner reviewed prompt");
    const template = (await db.query("SELECT * FROM message_templates WHERE org_id=$1 AND template_key='SMS-BLUEPRINT-COACH-DUE'", [org])).rows[0];
    assert.equal(template.compliance_passed, true);
    assert.equal(template.body, "Owner reviewed reminder");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM agents WHERE org_id=$1", [other])).rows[0].n, 0);
    assert.equal((await db.query("SELECT prompt FROM agents WHERE org_id=$1 AND code='FOS-01'", [org])).rows[0].prompt, "Owner money prompt");
  } finally { await db.query("ROLLBACK"); db.release(); }
});
