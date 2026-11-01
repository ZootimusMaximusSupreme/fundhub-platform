// Closer-drill coach turns — staff talk to an ops agent on Agent Editor.
// Does not text or call a buyer. Never touches AG-04 or AG-09.
//
// Real-call samples come from call_outcomes that already exist:
//   easy = they paid (deposit / downsell)
//   hard = they did not close (callback / not_a_fit)
// Meet words come from call_outcomes.transcript (Drive sibling doc or Whisper).

import { callModel } from "./model.mjs";
import { recordRun } from "./shadow-log.mjs";

export const PROTECTED_AGENT_CODES = Object.freeze(["AG-04", "AG-09"]);
const EASY = new Set(["deposit", "downsell"]);
const HARD = new Set(["callback", "not_a_fit"]);

export function isDrillAgent(agent) {
  if (!agent) return false;
  const code = String(agent.code || "").trim().toUpperCase();
  if (!code || PROTECTED_AGENT_CODES.includes(code)) return false;
  if (String(agent.agent_class || "") !== "ops") return false;
  if (String(agent.channel || "") !== "internal") return false;
  if (code === "OP-06") return true;
  const g = agent.guardrails && typeof agent.guardrails === "object" ? agent.guardrails : {};
  return Array.isArray(g.report_keys) && g.report_keys.length > 0;
}

export function gradeCallOutcome(outcome) {
  const v = String(outcome || "").trim().toLowerCase();
  if (EASY.has(v)) return "easy";
  if (HARD.has(v)) return "hard";
  return "other";
}

export function formatCallSamples(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const easy = [];
  const hard = [];
  for (const row of list) {
    const grade = gradeCallOutcome(row.outcome);
    const line = [
      grade.toUpperCase(),
      row.outcome || "unknown",
      row.belief_failed ? `belief=${row.belief_failed}` : null,
      row.duration_seconds != null ? `${row.duration_seconds}s` : null,
      row.has_recording ? "recording=yes" : "recording=no",
      row.has_words ? "words=yes" : "words=no",
      row.notes ? `notes=${String(row.notes).slice(0, 180)}` : null,
      row.transcript_excerpt ? `said=${String(row.transcript_excerpt).slice(0, 280)}` : null
    ].filter(Boolean).join(" · ");
    if (grade === "easy") easy.push(line);
    else if (grade === "hard") hard.push(line);
  }
  if (!easy.length && !hard.length) {
    return "No paid or missed sales-call logs yet. Drill from the written scenarios only.";
  }
  return [
    "Easy closes (they paid):",
    easy.length ? easy.slice(0, 8).map((l) => `- ${l}`).join("\n") : "- none logged",
    "",
    "Hard closes (no deposit):",
    hard.length ? hard.slice(0, 8).map((l) => `- ${l}`).join("\n") : "- none logged"
  ].join("\n");
}

export async function listCoachCallSamples(db, { orgId, limit = 30 } = {}) {
  if (!db || !orgId) return [];
  const cap = Math.max(1, Math.min(40, Number(limit) || 30));
  const res = await db.query(
    `SELECT outcome, belief_failed, duration_seconds, notes, logged_at,
            (recording_url IS NOT NULL AND btrim(recording_url) <> '') AS has_recording,
            (transcript IS NOT NULL AND btrim(transcript) <> '') AS has_words,
            left(transcript, 400) AS transcript_excerpt
       FROM call_outcomes
      WHERE org_id = $1
        AND COALESCE(is_demo, false) = false
      ORDER BY logged_at DESC NULLS LAST
      LIMIT $2`,
    [orgId, cap]
  );
  return res.rows || [];
}

function normalizeTurns(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const row of list.slice(-20)) {
    const role = String(row && (row.role || row.kind) || "").toLowerCase();
    const text = String(row && (row.text || row.body) || "").trim();
    if (!text) continue;
    if (role !== "user" && role !== "assistant") continue;
    out.push({ role, text: text.slice(0, 4000) });
  }
  return out;
}

function bannedHit(text, guardrails) {
  const g = guardrails && typeof guardrails === "object" ? guardrails : {};
  const lines = Array.isArray(g.banned_buyer_lines) ? g.banned_buyer_lines : [];
  const hay = String(text || "").toLowerCase();
  for (const line of lines) {
    const needle = String(line || "").trim().toLowerCase();
    if (needle && hay.includes(needle)) return needle;
  }
  return null;
}

export async function runDrill(db, {
  orgId,
  agent,
  message,
  history = [],
  env = process.env,
  callModelFn = callModel
} = {}) {
  if (!orgId) return { ok: false, error: "org_required", message: "No company on this sign-in." };
  if (!isDrillAgent(agent)) {
    return {
      ok: false,
      error: "not_a_drill",
      message: "This coach is not the closer drill. Do not run Setter Chris or Inquiry Removal as a drill."
    };
  }
  const status = String(agent.status || "");
  if (status === "draft" || status === "retired") {
    return {
      ok: false,
      error: "not_live",
      message: status === "draft"
        ? "This coach is still a draft. Promote it first."
        : "This coach is retired."
    };
  }
  if (status !== "live" && status !== "shadow") {
    return { ok: false, error: "not_live", message: "This coach is not running." };
  }

  const userText = String(message || "").trim();
  if (!userText) {
    return { ok: false, error: "message_required", message: "Type what you want to say to the coach." };
  }

  const rows = await listCoachCallSamples(db, { orgId });
  const samples = formatCallSamples(rows);
  const turns = normalizeTurns(history);
  const prior = turns.map((t) => `${t.role === "user" ? "CLOSER" : "COACH"}: ${t.text}`).join("\n\n");
  const user = [
    prior ? `Earlier turns:\n${prior}` : "",
    `CLOSER: ${userText}`
  ].filter(Boolean).join("\n\n");

  const system = [
    String(agent.prompt || "").trim(),
    "",
    "---",
    "Real logged sales calls (no names). Use these to pick harder or easier buyer moves. Do not invent a bank yes or a score move.",
    samples,
    "",
    "You talk to staff only. Never contact a buyer."
  ].join("\n");

  const model = await callModelFn({
    system,
    user,
    env,
    maxTokens: 900
  });

  if (model.error && !model.text) {
    await recordRun(db, {
      orgId,
      agentCode: agent.code,
      triggerEvent: "staff.drill",
      channel: "internal",
      mode: model.mode || null,
      outcome: "model_error",
      detail: model.error
    });
    return {
      ok: false,
      error: "model_error",
      message: "The coach could not answer just now. Try again in a minute."
    };
  }

  let text = String(model.text || "").trim();
  if (!text) {
    return {
      ok: false,
      error: "empty_reply",
      message: "The coach had nothing to say. Try again."
    };
  }

  const hit = bannedHit(text, agent.guardrails);
  if (hit) {
    text += "\n\n[COACH NOTE: A banned line showed up. This drill is a fail.]";
  }

  await recordRun(db, {
    orgId,
    agentCode: agent.code,
    triggerEvent: "staff.drill",
    channel: "internal",
    mode: status === "shadow" || model.mode === "shadow" ? "shadow" : "live",
    outcome: hit ? "banned_line" : "replied",
    detail: hit || null
  });

  return {
    ok: true,
    reply: text,
    banned_line: !!hit,
    call_samples: {
      easy: rows.filter((r) => gradeCallOutcome(r.outcome) === "easy").length,
      hard: rows.filter((r) => gradeCallOutcome(r.outcome) === "hard").length
    }
  };
}
