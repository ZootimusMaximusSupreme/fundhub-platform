// "Do task" — the client hands one item from "What to do next" to the money
// helper. This is the consumer; the contract is docs/finance/money-agent-tasks.md.
//
// Owner (2026-10-06): "AI tells you exactly what to do; press Do task to assign
// actions to AI agents." W5 builds the buttons; this file is what a press does:
//
//   runAgentTask(db, { orgId, clientId, task, requestedBy, staffId, env, now })
//     1. checks the item (validateTask) and that the helper is on and not stopped;
//     2. writes one money_agent_tasks row — or, when that item is already open
//        (queued or in progress), hands back the open one and starts nothing
//        new, so a double press is one task;
//     3. starts a 'task' turn on the helper thread through the same routing a
//        typed message takes (src/finance/money-helper.mjs routeTurn): the Mac
//        runner's AI, the server's AI, or the rules brain.
//
// What the helper can do with a task is its closed action set and nothing else:
// a reminder, a plan step, a CSM task, a transfer PROPOSAL that needs the
// client's own approval, and "marked in progress". It never moves money.

import {
  loadAgent, helperIsOn, threadState, routeTurn, viewTurn
} from "./money-helper.mjs";
import { parseIsoDate } from "../banking/statement-cycles.mjs";

export const SOURCE_RE = /^[a-z0-9-]{2,40}$/;

export class TaskInputError extends Error {
  constructor(message, code = "invalid_task") {
    super(message);
    this.code = code;
  }
}

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * validateTask(raw) → { key, source, title, detail, due_on, amount_cents }
 * Throws TaskInputError with words a person can fix.
 */
export function validateTask(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new TaskInputError("task must be an object");
  const key = text(raw.key);
  if (!key || key.length > 200) throw new TaskInputError("task.key is required (the item's own id, 200 characters or fewer)");
  const source = text(raw.source);
  if (!source || !SOURCE_RE.test(source)) throw new TaskInputError("task.source is required (lower-case words and dashes, like dues or next-steps)");
  const title = text(raw.title);
  if (!title || title.length > 200) throw new TaskInputError("task.title is required (200 characters or fewer)");
  const detail = text(raw.detail);
  if (detail && detail.length > 1000) throw new TaskInputError("task.detail is too long");
  let dueOn = null;
  if (raw.due_on !== undefined && raw.due_on !== null && raw.due_on !== "") {
    if (!parseIsoDate(String(raw.due_on))) throw new TaskInputError("task.due_on must be a date like 2026-10-15");
    dueOn = String(raw.due_on);
  }
  let amount = null;
  if (raw.amount_cents !== undefined && raw.amount_cents !== null && raw.amount_cents !== "") {
    const n = Number(raw.amount_cents);
    if (!Number.isSafeInteger(n) || n <= 0) throw new TaskInputError("task.amount_cents must be whole cents above 0");
    amount = n;
  }
  return { key, source, title, detail, due_on: dueOn, amount_cents: amount };
}

/** The open row for this item, if there is one. */
async function openTaskByKey(db, { orgId, clientId, key }) {
  const r = await db.query(
    `SELECT id, status FROM money_agent_tasks
      WHERE org_id = $1 AND client_id = $2 AND task_key = $3 AND status IN ('queued', 'in_progress')
      LIMIT 1`,
    [orgId, clientId, key]
  );
  return r.rows[0] || null;
}

async function latestTurnFor(db, { orgId, clientId, taskId }) {
  const r = await db.query(
    `SELECT id, org_id, client_id, kind, actor, staff_id, input, task_id, status, reply, actions,
            brain, model, reason, attempts, claimed_at, answered_at, created_at
       FROM money_helper_turns
      WHERE org_id = $1 AND client_id = $2 AND task_id = $3
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId, taskId]
  );
  return r.rows[0] || null;
}

/**
 * runAgentTask(db, { orgId, clientId, task, requestedBy, staffId, env, now, deps, callModelFn })
 * → { ok: true, created, task: { id, status }, turn, queued }
 *   | { ok: false, error, message }
 */
export async function runAgentTask(db, {
  orgId, clientId, task, requestedBy = "client", staffId = null,
  env = process.env, now = new Date(), deps = {}, callModelFn
} = {}) {
  let t;
  try {
    t = validateTask(task);
  } catch (e) {
    if (e instanceof TaskInputError) return { ok: false, error: e.code, message: e.message };
    throw e;
  }
  if (requestedBy !== "client" && requestedBy !== "staff") return { ok: false, error: "invalid_requester", message: "requestedBy must be client or staff" };

  const agent = await loadAgent(db, { orgId });
  if (!helperIsOn(agent)) return { ok: false, error: "helper_off", message: "The money helper is not switched on." };
  const state = await threadState(db, { orgId, clientId });
  if (state.halted_at) return { ok: false, error: "helper_stopped", message: "The money helper stopped here. A person from Fundhub will follow up." };

  const open = await openTaskByKey(db, { orgId, clientId, key: t.key });
  if (open) {
    const turn = await latestTurnFor(db, { orgId, clientId, taskId: open.id });
    return { ok: true, created: false, task: { id: open.id, status: open.status }, turn: viewTurn(turn), queued: !!turn && turn.status === "queued" };
  }

  const ins = await db.query(
    `INSERT INTO money_agent_tasks (org_id, client_id, task_key, source, title, detail, due_on, amount_cents, requested_by, staff_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10)
     ON CONFLICT DO NOTHING
     RETURNING id, status`,
    [orgId, clientId, t.key, t.source, t.title, t.detail, t.due_on, t.amount_cents, requestedBy, staffId]
  );
  const row = ins.rows[0];
  if (!row) {
    /* Two presses raced: the other one won the open slot. Same answer as a
       double press. */
    const winner = await openTaskByKey(db, { orgId, clientId, key: t.key });
    const turn = winner ? await latestTurnFor(db, { orgId, clientId, taskId: winner.id }) : null;
    return { ok: true, created: false, task: winner ? { id: winner.id, status: winner.status } : null, turn: viewTurn(turn), queued: !!turn && turn.status === "queued" };
  }

  const r = await routeTurn(db, {
    orgId, clientId, kind: "task", actor: requestedBy, staffId, input: `Do task: ${t.title}`,
    taskId: row.id, intent: "task", agent, env, now, deps, callModelFn
  });
  const after = await db.query(`SELECT status FROM money_agent_tasks WHERE id = $1`, [row.id]);
  return {
    ok: true, created: true,
    task: { id: row.id, status: (after.rows[0] && after.rows[0].status) || row.status },
    turn: viewTurn(r.turn), queued: r.queued
  };
}

export default runAgentTask;
