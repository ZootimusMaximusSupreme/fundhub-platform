#!/usr/bin/env node
// npm run money:roleplay — role-play the FinanceOS Money Helper against the test client.
//
//   node scripts/money-agent-roleplay.mjs --scripted                 client lines scripted, AI through Claude Code
//   node scripts/money-agent-roleplay.mjs                            the client is played by the model too
//   node scripts/money-agent-roleplay.mjs --scripted --brain=rules   no model at all (the rules brain)
//   node scripts/money-agent-roleplay.mjs --scripted --brain=stub    a stub model (no Claude needed)
//   --persona=a,b,f   only these personas      --out=<dir>   where the report goes
//
// READ ONLY. Every read of the test client happens up front inside one
// BEGIN READ ONLY … ROLLBACK on one connection (no SET), then the connection is
// closed BEFORE any model is asked anything. The helper's actions are carried
// out dry. Nothing is written to the database, nothing is texted.
//
// --brain=bridge (the default) routes every model call to Claude Code on this Mac
// (routeModelCallsToClaudeCode) — the same switch the money helper's Mac runner
// flips — so it costs no API credit. The report says which brain answered every turn.
//
// Report: ops/workflows/finance-os-wave5-2026-10-06-evidence/w6/roleplay-<stamp>.md
// (+ .json), gitignored. The work is src/finance/money-agent-sim.mjs.

import "./load-env.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  PERSONAS, TEST_CLIENT_ID, runPersona, scoreRun, renderReport, serializableRun, stubModel
} from "../src/finance/money-agent-sim.mjs";
import { readContext } from "../src/finance/money-helper.mjs";
import { HELPER_PROMPT, HELPER_GUARDRAILS, AGENT_CODE } from "../src/finance/money-agent-ai.mjs";
import { callModel } from "../src/agents/model.mjs";
import { routeModelCallsToClaudeCode, findClaudeBinary } from "../src/agents/claude-code.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const scripted = process.argv.includes("--scripted");
const brain = arg("brain") || "bridge";
const only = (arg("persona") || "").split(",").map((s) => s.trim()).filter(Boolean);
const outDir = path.resolve(arg("out") || path.join(ROOT, "ops/workflows/finance-os-wave5-2026-10-06-evidence/w6"));
const clientId = arg("client") || TEST_CLIENT_ID;
const log = (line) => console.log(line);

if (!["bridge", "stub", "rules"].includes(brain)) {
  log(`Unknown --brain=${brain}. Use bridge, stub or rules.`);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  log("Stopped: DATABASE_URL is not in .env, so the test client cannot be read.");
  process.exit(1);
}
if (brain === "bridge") {
  const bin = findClaudeBinary(process.env);
  if (!bin) {
    log("Stopped: the claude command was not found, so the AI brain cannot run here. Use --brain=stub or --brain=rules.");
    process.exit(1);
  }
  routeModelCallsToClaudeCode(true);
  log(`Agent brain: Claude Code at ${bin} (through callModel).`);
}

/* ── 1. every read, up front, read only ─────────────────────────────────── */
const conn = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 20000 });
await conn.connect();
const db = { query: (sql, params) => conn.query(sql, params) };
let agent = { prompt: HELPER_PROMPT, guardrails: HELPER_GUARDRAILS, status: "shadow" };
let promptSource = "migration 465 text (HELPER_PROMPT in src/finance/money-agent-ai.mjs) — agents FOS-01 is not on production until 465 ships";
const personas = PERSONAS.filter((p) => !only.length || only.includes(p.id));
const plans = [];
const skipped = [];
try {
  await conn.query("BEGIN READ ONLY");
  const c = await conn.query(`SELECT id, org_id FROM clients WHERE id = $1`, [clientId]);
  if (!c.rows[0]) throw new Error(`client ${clientId} not found`);
  const orgId = c.rows[0].org_id;
  const row = await conn.query(`SELECT prompt, guardrails, status FROM agents WHERE org_id = $1 AND code = $2`, [orgId, AGENT_CODE]);
  if (row.rows[0] && row.rows[0].prompt) {
    agent = { prompt: row.rows[0].prompt, guardrails: row.rows[0].guardrails || HELPER_GUARDRAILS, status: row.rows[0].status };
    promptSource = `agents ${AGENT_CODE} row (status ${row.rows[0].status})`;
  }
  const base = await readContext(db, { orgId, clientId, asOf: new Date(), env: {}, helperTables: false });
  if (!base) throw new Error("the overview read came back empty");
  for (const p of personas) {
    const day = p.day(base);
    if (day.skip) { skipped.push({ id: p.id, title: p.title, reason: day.skip }); continue; }
    const ctx = day.asOf === base.asOf ? base : await readContext(db, { orgId, clientId, asOf: new Date(day.asOf), env: {}, helperTables: false });
    plans.push({ persona: p, context: ctx, note: day.note });
  }
} finally {
  await conn.query("ROLLBACK").catch(() => {});
  await conn.end().catch(() => {});
}
log(`Read ${plans.length} persona day(s) from the test client, read only. Connection closed.`);

/* ── 2. the role-play — no database from here on ────────────────────────── */
const callModelFn = brain === "stub" ? stubModel() : callModel;
const runs = [];
for (const { persona, context, note } of plans) {
  const t0 = Date.now();
  log(`Persona ${persona.id}: ${persona.title} …`);
  const run = await runPersona({
    persona, context, agent, useAi: brain !== "rules", callModelFn, env: process.env,
    seat: scripted ? "scripted" : "model", note
  });
  runs.push(run);
  log(`  ${run.turns.length} turn(s), ${Math.round((Date.now() - t0) / 1000)}s; brains: ${run.turns.map((t) => t.brain || "-").join(", ")}`);
}

/* ── 3. score and report ────────────────────────────────────────────────── */
const scores = runs.map((r) => scoreRun(r, PERSONAS.find((p) => p.id === r.id)));
const when = new Date().toISOString();
const brainPath = brain === "bridge"
  ? "AI — callModel routed to Claude Code (claude -p) on this Mac; the rules brain answers any turn the AI could not or was blocked on"
  : brain === "stub" ? "stub model (no Claude) through callModel's place — plumbing only" : "rules brain only (no model)";
const md = renderReport({ runs, scores, meta: { when, brainPath, seat: scripted ? "scripted" : "model", promptSource, clientId, readOnly: true, skipped } });
fs.mkdirSync(outDir, { recursive: true });
const stamp = when.replace(/[:.]/g, "-");
const mdPath = path.join(outDir, `roleplay-${stamp}.md`);
fs.writeFileSync(mdPath, md);
fs.writeFileSync(path.join(outDir, `roleplay-${stamp}.json`), JSON.stringify({ meta: { when, brain, seat: scripted ? "scripted" : "model", promptSource, clientId, skipped }, runs: runs.map(serializableRun), scores }, null, 2));

log("");
log("SCORE CARD");
for (const s of scores) {
  const r = runs.find((x) => x.id === s.id);
  const fails = Object.entries(s.checks).filter(([, c]) => c.result === "fail").map(([k]) => k);
  log(`  ${s.id}. ${r.title}: ${s.pass ? "PASS" : "FAIL"}${fails.length ? ` (${fails.join(", ")})` : ""} — AI answered ${s.ai_answered}, AI blocked ${s.ai_blocked.length}`);
}
for (const sk of skipped) log(`  ${sk.id}. ${sk.title}: NOT RUN — ${sk.reason}`);
log(`Report: ${mdPath}`);
process.exit(scores.every((s) => s.pass) ? 0 : 2);
