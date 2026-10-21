// The FinanceOS Money Helper screen's read: GET /api/money/helper's payload, and the
// reads under it. Read only. No imports, no I/O of its own: every read goes through the
// database handle the caller passes in.
//
// ONE READ, TWO CLOCKS (2026-10-20). This code used to live in four places and now lives
// here once, moved unchanged:
//   src/finance/money-helper.mjs     loadAgent, helperIsOn, threadState, readThread,
//                                    viewTurn, reasonWords, bridgeStatus, BRIDGE_NAME,
//                                    BRIDGE_FRESH_MS (it re-exports every one)
//   src/finance/money-agent-ai.mjs   AGENT_CODE, AGENT_NAME, RUNNER_ENV, RUNNER_MODES,
//                                    runnerMode (re-exported; the product's runnerMode
//                                    keeps its process.env default and calls this one)
//   src/agents/registry.mjs          byCode (re-exported)
//   api/money/helper.mjs             the payload assembly (helperPayload calls helperView
//                                    below, after its answerOrphans step)
// and the morning lane's read-only copy of that payload (src/pulse/coverage/gap-finance-os.mjs
// readOnlyHelperPayload) is now this same helperView with no step before the reads.
//
// Why: the hourly beat money-tasks judges finance-os:helper (the helper screen's thread
// loads for the linked client) with the exact read the page runs. A beat may import only
// from src/pulse/beats/lib, so the read moved here and the product imports it back.
//
// The page's own write step (answering queued turns when the Mac is off) is NOT here: it
// stays in src/finance/money-helper.mjs and api/money/helper.mjs passes it in as
// beforeRead. Nothing here writes.

/** The FOS-01 row's code (agents.code). */
export const AGENT_CODE = "FOS-01";
export const AGENT_NAME = "FinanceOS Money Helper";

export const BRIDGE_NAME = "money-helper-mac";
/** A heartbeat younger than this means the Mac runner is on. It beats every 15 s. */
export const BRIDGE_FRESH_MS = 60_000;

export const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
export const list = (v) => (Array.isArray(v) ? v : []);

/* ═════════════════════════════════════════════════════════════════════════
   WHO RUNS THE MODEL (moved from src/finance/money-agent-ai.mjs)
   ═════════════════════════════════════════════════════════════════════════
   MONEY_HELPER_RUNNER, read on the server:
     mac     (the default — owner 2026-10-06: no API credit) a client message is
             queued for the Mac runner while its heartbeat is fresh; with the
             Mac off, the rules brain answers at once.
     server  the API is funded: the request calls the model itself (same code),
             and the daily ladder uses the AI brain too.
     rules   no model at all.
   The caller hands in the env (the product's runnerMode defaults it to the server's). */

export const RUNNER_ENV = "MONEY_HELPER_RUNNER";
export const RUNNER_MODES = Object.freeze(["mac", "server", "rules"]);

export function runnerMode(env) {
  const v = String((env && env[RUNNER_ENV]) || "").trim().toLowerCase();
  return RUNNER_MODES.includes(v) ? v : "mac";
}

/* ═════════════════════════════════════════════════════════════════════════
   THE AGENT ROW
   ═════════════════════════════════════════════════════════════════════════ */

/* byCode — one agent, or null. (Moved from src/agents/registry.mjs, which re-exports it.) */
export async function byCode(db, { orgId, code } = {}) {
  if (!orgId || !code) return null;
  const { rows } = await db.query(
    `SELECT * FROM agents WHERE org_id = $1 AND code = $2`,
    [orgId, String(code).trim().toUpperCase()]
  );
  return rows[0] || null;
}

/** The FOS-01 row for this org, with the caller's prompt and guardrails as the
 *  fallback when the row holds none. A missing row is an agent that is off.
 *  src/finance/money-helper.mjs loadAgent passes the in-code HELPER_PROMPT and
 *  HELPER_GUARDRAILS; the screen's payload reads only code, name and status. */
export async function loadAgent(db, { orgId, prompt = null, guardrails = null }) {
  let row = null;
  try { row = await byCode(db, { orgId, code: AGENT_CODE }); } catch { row = null; }
  if (!row) return { code: AGENT_CODE, name: AGENT_NAME, status: null, prompt, guardrails, fromRow: false };
  const g = isObj(row.guardrails) && Object.keys(row.guardrails).length ? row.guardrails : guardrails;
  return {
    code: row.code, name: row.name || AGENT_NAME, status: row.status,
    prompt: row.prompt && String(row.prompt).trim() ? row.prompt : prompt,
    guardrails: g, fromRow: true
  };
}

/** Running means shadow or live. Shadow answers in the app and never texts. */
export function helperIsOn(agent) {
  return !!agent && (agent.status === "shadow" || agent.status === "live");
}

/* ═════════════════════════════════════════════════════════════════════════
   THE THREAD
   ═════════════════════════════════════════════════════════════════════════ */

export const TURN_COLS = `id, org_id, client_id, kind, actor, staff_id, input, task_id, status, reply, actions,
                   brain, model, reason, attempts, claimed_at, answered_at, created_at`;

export async function threadState(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT halted_at, halt_reason FROM money_helper_threads WHERE client_id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const row = r.rows[0];
  return { halted_at: row && row.halted_at ? new Date(row.halted_at).toISOString() : null, halt_reason: (row && row.halt_reason) || null };
}

/** The thread for the screen, oldest first. */
export async function readThread(db, { orgId, clientId, limit = 50 }) {
  const r = await db.query(
    `SELECT ${TURN_COLS} FROM money_helper_turns
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at DESC, id DESC
      LIMIT $3`,
    [orgId, clientId, Math.max(1, Math.min(200, Number(limit) || 50))]
  );
  return r.rows.slice().reverse();
}

const REASON_WORDS = [
  [/^bridge_off/, "Answered by the rules helper: the AI helper's computer is off right now."],
  [/^rules_(mode|only)/, "Answered by the rules helper."],
  [/^ai_unavailable/, "Answered by the rules helper: the AI could not be reached."],
  [/^ai_blocked/, "Answered by the rules helper: the AI's answer broke one of its rules."],
  [/^ai_gave_up/, "Answered by the rules helper: the AI took too long."],
  [/^intent:stop/, "Stopped because you said STOP."],
  [/^intent:legal/, "Stopped and handed to a person."],
  [/^intent:person/, "Handed to a person."],
  [/^intent:/, "Answered by the rules helper."]
];

export function reasonWords(reason) {
  if (!reason) return null;
  for (const [re, words] of REASON_WORDS) if (re.test(String(reason))) return words;
  return "Answered by the rules helper.";
}

/** One turn as the screen reads it. The full reason (which rule an AI answer
 *  broke) is for staff; a client gets it in plain words. */
export function viewTurn(row, { staff = false } = {}) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    actor: row.actor,
    input: row.input,
    task_id: row.task_id || null,
    status: row.status,
    reply: row.reply || null,
    actions: list(row.actions).map((a) => ({ ...a })),
    brain: row.brain || null,
    model: row.model || null,
    reason_words: reasonWords(row.reason),
    ...(staff ? { reason: row.reason || null } : {}),
    created_at: row.created_at ? new Date(row.created_at).toISOString() : null,
    answered_at: row.answered_at ? new Date(row.answered_at).toISOString() : null
  };
}

/* ═════════════════════════════════════════════════════════════════════════
   THE BRIDGE — is the Mac runner on?
   ═════════════════════════════════════════════════════════════════════════ */

export async function bridgeStatus(db, { now = new Date() } = {}) {
  try {
    const r = await db.query(`SELECT last_at FROM agent_bridge_heartbeats WHERE name = $1`, [BRIDGE_NAME]);
    const last = r.rows[0] && r.rows[0].last_at ? new Date(r.rows[0].last_at) : null;
    return { on: !!last && new Date(now).getTime() - last.getTime() < BRIDGE_FRESH_MS, last_at: last ? last.toISOString() : null };
  } catch {
    return { on: false, last_at: null };
  }
}

/* ═════════════════════════════════════════════════════════════════════════
   THE SCREEN'S PAYLOAD — GET /api/money/helper (moved from api/money/helper.mjs)
   ═════════════════════════════════════════════════════════════════════════ */

export const HELPER_CLIENT_SQL = `SELECT id, first_name, last_name FROM clients WHERE id = $1 AND org_id = $2`;

/**
 * The thread payload the helper screen draws. null when the client is not in this org.
 *
 * beforeRead runs after the client is found and before the thread is read: the page
 * passes its answerOrphans step there (a write, so it lives in the product, never here).
 * The morning lane and the hourly beat pass none, so they only read.
 * agentLoader is the product's loadAgent (with its in-code prompt as the fallback) when
 * the page calls this; the payload reads only the agent's code, name and status.
 */
export async function helperView(database, {
  orgId, clientId, staff = false, env, now = new Date(), agentLoader = loadAgent, beforeRead = null
} = {}) {
  const c = await database.query(HELPER_CLIENT_SQL, [clientId, orgId]);
  const client = c.rows[0];
  if (!client) return null;
  if (typeof beforeRead === "function") await beforeRead();
  const [agent, state, rows, bridge] = await Promise.all([
    agentLoader(database, { orgId }),
    threadState(database, { orgId, clientId }),
    readThread(database, { orgId, clientId, limit: 60 }),
    bridgeStatus(database, { now })
  ]);
  const turns = rows.map((r) => viewTurn(r, { staff }));
  const name = [client.first_name, client.last_name].filter((x) => x && String(x).trim()).join(" ") || null;
  return {
    ok: true,
    client: { id: String(client.id), name },
    viewer: staff ? "staff" : "client",
    today: new Date(now).toISOString().slice(0, 10),
    helper: {
      code: agent.code,
      name: agent.name,
      status: agent.status,
      on: helperIsOn(agent),
      // Shadow answers here only; nothing is texted. Live texting is not built.
      sends_texts: false,
      brain: runnerMode(env),
      bridge_on: bridge.on,
      halted: !!state.halted_at,
      halt_reason: state.halt_reason
    },
    turns,
    pending: turns.filter((t) => t.status === "queued" || t.status === "running").length
  };
}
