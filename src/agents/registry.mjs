// Agent registry — the AI agents as records, so something other than markup can
// answer "which agents are live", "what is this one allowed to do", and "who owns
// it".
//
// Two agents were recorded as live on Bland AI: Setter Chris and the Inquiry
// Removal AI. Phone inquiry is on hold. 037_agent_registry.sql seeds
// those as live with their runtime recorded and everything else as draft — the
// agent-editor screen shows eleven as live, which is sample data.
//
// Prompts and guardrails ship EMPTY on purpose. The screen carries text for
// fifteen entries but only Setter Chris's is the real live agent's; the rest is
// sample copy, and loading sample prompts into a registry that gates production
// behaviour is worse than leaving them blank. needsAttention() is how that gap
// stays visible rather than being forgotten.

import { byCode } from "../pulse/beats/lib/money-helper-read.mjs";

const STATUSES = new Set(["draft", "shadow", "live", "retired"]);
const RUNNING = new Set(["live", "shadow"]);

export const AGENT_STATUSES = STATUSES;

/* list — the registry, optionally filtered by status or class. */
export async function list(db, { orgId, status = null, agentClass = null } = {}) {
  if (!orgId) throw new Error("list: orgId is required");
  const params = [orgId];
  const where = ["org_id = $1"];
  if (status) {
    if (!STATUSES.has(status)) throw new Error(`list: unknown status "${status}"`);
    params.push(status); where.push(`status = $${params.length}`);
  }
  if (agentClass) { params.push(agentClass); where.push(`agent_class = $${params.length}`); }

  const { rows } = await db.query(
    `SELECT code, name, agent_class, channel, status, runtime, runtime_ref,
            runtime_notes, owner_staff_id, owner_label, went_live_at, retired_at,
            sort_order,
            (prompt IS NULL OR btrim(prompt) = '') AS prompt_missing,
            (guardrails = '{}'::jsonb)             AS guardrails_missing
       FROM agents
      WHERE ${where.join(" AND ")}
      ORDER BY sort_order, code`,
    params
  );
  return rows;
}

/* byCode — one agent, or null. Moved, unchanged, to src/pulse/beats/lib/money-helper-read.mjs
   (2026-10-20): the hourly beat money-tasks loads the money helper's row with it, and a beat may
   import only from the beat library. Re-exported here; setStatus below uses it as before. */
export { byCode };

/* live — what is actually acting on clients right now. The question an ops screen
   leads with, so it gets its own call rather than a filter argument. */
export async function live(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM v_agents_live WHERE org_id = $1 ORDER BY code`, [orgId]);
  return rows;
}

/* setStatus — promote or retire. Guards the two things the database also guards,
   so the caller gets a readable error rather than a constraint name:
   a running agent must have a runtime, and retiring must stamp retired_at. */
export async function setStatus(db, {
  orgId, code, status, runtime = undefined, runtimeRef = undefined, now = new Date()
} = {}) {
  if (!STATUSES.has(status)) {
    throw new Error(`setStatus: status must be one of ${[...STATUSES].join(", ")}`);
  }
  const agent = await byCode(db, { orgId, code });
  if (!agent) return null;

  const nextRuntime = runtime === undefined ? agent.runtime : runtime;
  if (RUNNING.has(status) && !nextRuntime) {
    throw new Error(
      `setStatus: ${code} cannot be "${status}" with no runtime — ` +
      `a running agent nobody can point at is unoperable`
    );
  }

  const { rows } = await db.query(
    `UPDATE agents
        SET status       = $2,
            runtime      = $3,
            runtime_ref  = COALESCE($4, runtime_ref),
            went_live_at = CASE WHEN $2 = 'live' AND went_live_at IS NULL THEN $5
                                ELSE went_live_at END,
            retired_at   = CASE WHEN $2 = 'retired' THEN COALESCE(retired_at, $5)
                                ELSE NULL END,
            updated_at   = now()
      WHERE org_id = $1 AND code = $6
      RETURNING code, status, runtime, runtime_ref, went_live_at, retired_at`,
    [orgId, status, nextRuntime, runtimeRef === undefined ? null : runtimeRef,
     now, String(code).trim().toUpperCase()]
  );
  return rows[0] || null;
}

/* setDefinition — load a real prompt and guardrails onto an agent. Separate from
   setStatus because promoting and rewriting are different acts with different
   review needs. */
export async function setDefinition(db, {
  orgId, code, prompt = undefined, guardrails = undefined
} = {}) {
  if (prompt === undefined && guardrails === undefined) {
    throw new Error("setDefinition: pass a prompt, guardrails, or both");
  }
  const { rows } = await db.query(
    `UPDATE agents
        SET prompt     = COALESCE($3, prompt),
            guardrails = COALESCE($4, guardrails),
            updated_at = now()
      WHERE org_id = $1 AND code = $2
      RETURNING code, (prompt IS NULL OR btrim(prompt) = '') AS prompt_missing,
                (guardrails = '{}'::jsonb) AS guardrails_missing`,
    [orgId, String(code).trim().toUpperCase(),
     prompt === undefined ? null : prompt,
     guardrails === undefined ? null : JSON.stringify(guardrails)]
  );
  return rows[0] || null;
}

/* needsAttention — the reporting surface for the gap 037 leaves open: agents that
   are RUNNING with no prompt or no guardrails recorded. Both live agents are in
   this list today, which is the honest state, and the list is how it stops being
   invisible. */
export async function needsAttention(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT code, name, status, runtime, prompt_missing, guardrails_missing
       FROM v_agents_live
      WHERE org_id = $1 AND (prompt_missing OR guardrails_missing)
      ORDER BY code`,
    [orgId]
  );
  return rows;
}
