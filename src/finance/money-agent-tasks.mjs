// "Do task" — the money agent's side of W5's queue. The press, the queue table
// and the transfer seam are W5's (migration 464, src/finance/money-tasks.mjs,
// src/finance/money-transfer-seam.mjs); the contract is
// docs/finance/money-agent-tasks.md §4. This file is what the agent does with a
// row, and nothing else.
//
// Owner (2026-10-06): "AI tells you exactly what to do; press Do task to assign
// actions to AI agents." Money moves only with the client's approval of that
// exact transfer.
//
//   claimAgentTask(db, { includeApproved })   one row, oldest first, FOR UPDATE
//                                             SKIP LOCKED → status 'claimed'
//   runAgentTask(db, row, opts)               work one claimed row
//   sweepAgentTasks(db, opts)                 claim and work up to N rows (the
//                                             Mac runner calls it every cycle)
//
// WHAT A ROW BECOMES
//   no money (queued → claimed)   a 'task' turn on the helper thread: the AI
//                                 (or the rules brain) works it with the closed
//                                 action set — a reminder, a plan step, a CSM
//                                 task, a transfer PROPOSAL through W5's seam.
//                                 Finished 'done' with the helper's words in
//                                 result.client_message, or left 'claimed' when
//                                 the helper marked it in progress (a step is
//                                 still the client's), or 'failed' with plain
//                                 words when the helper could not work it.
//   money (approved → claimed)    only W7's engine sends money, with the row's
//                                 own amount and accounts. W6 never moves money:
//                                 without an engine wired in, approved rows are
//                                 not claimed at all, so W7 can run them itself.
//   needs_approval                never touched — it waits on the client.
//
// Every finish writes one money_agent_log row (464's words): task_done or
// task_failed, item_kind money_task, actor agent with the brain that answered,
// key money-task:<row id>:<action>.

import { logMoneyAction as defaultLog } from "./clarity-payments.mjs";
import {
  loadAgent, helperIsOn, threadState, insertTurn, processTurn, TASK_CLAIMER
} from "./money-helper.mjs";

/** The longest client_message W5's page shows. */
export const CLIENT_MESSAGE_MAX = 200;

const clip = (s, n) => (s == null ? null : String(s).replace(/\s+/g, " ").trim().slice(0, n));
const list = (v) => (Array.isArray(v) ? v : []);

const FAIL_WORDS = {
  helper_off: "The money helper is not switched on right now. A person from Fundhub can help with this.",
  helper_stopped: "The money helper stopped for this account, so a person from Fundhub will follow up.",
  turn_failed: "The money helper could not work on this. Press Do task again later, or ask for a person.",
  engine_failed: "This payment could not be sent. Nothing moved. A person from Fundhub will look at it."
};

/**
 * claimAgentTask(db, { includeApproved, claimedBy }) → the claimed row, or null.
 * The contract's own claim (§4.1). includeApproved is true only when a money
 * engine (W7) is wired in.
 */
export async function claimAgentTask(db, { includeApproved = false, claimedBy = TASK_CLAIMER } = {}) {
  const r = await db.query(
    `UPDATE money_agent_tasks SET status = 'claimed', claimed_by = $1, claimed_at = now()
      WHERE id = (SELECT id FROM money_agent_tasks
                   WHERE assignee = 'agent'
                     AND (status = 'queued' OR ($2::boolean AND status = 'approved'))
                   ORDER BY created_at, id
                   FOR UPDATE SKIP LOCKED
                   LIMIT 1)
      RETURNING id, org_id, client_id, task_key, kind, title, why, due_on::text AS due_on, source,
                assignee, status, moves_money, amount_cents, to_kind, to_account_id, from_account_id,
                approved_at, requested_by_kind, requested_by_staff_id, claimed_by, claimed_at, detail, created_at`,
    [claimedBy, includeApproved === true]
  );
  return r.rows[0] || null;
}

/**
 * finishTask(db, row, { status: 'done'|'failed', result, brain, todayIso, log })
 * → { finished } — only a row this agent still holds ('claimed') is finished.
 */
export async function finishTask(db, row, { status, result = {}, brain = "rules", todayIso, log = defaultLog } = {}) {
  if (status !== "done" && status !== "failed") throw new Error("finishTask: status must be done or failed");
  const message = clip(result.client_message, CLIENT_MESSAGE_MAX);
  const body = { ...result, client_message: message };
  const upd = await db.query(
    `UPDATE money_agent_tasks
        SET status = $4, done_at = CASE WHEN $4 = 'done' THEN now() ELSE done_at END, result = $5::jsonb
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status = 'claimed'
      RETURNING id`,
    [row.id, row.org_id, row.client_id, status, JSON.stringify(body)]
  );
  if (!upd.rows[0]) return { finished: false };
  const action = status === "done" ? "task_done" : "task_failed";
  await log(db, {
    orgId: row.org_id, clientId: row.client_id,
    itemKind: "money_task", itemId: row.id, itemLabel: clip(row.title, 200),
    decidedOn: todayIso || new Date().toISOString().slice(0, 10),
    action, actor: "agent", brain: brain || "rules",
    reason: message || action,
    amountCents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
    idempotencyKey: `money-task:${row.id}:${action}`,
    detail: { task_key: row.task_key, turn_id: result.turn_id || null }
  });
  return { finished: true };
}

/** Keep a row claimed (in progress) and say where it stands. */
async function holdTask(db, row, result) {
  await db.query(
    `UPDATE money_agent_tasks SET result = $4::jsonb
      WHERE id = $1 AND org_id = $2 AND client_id = $3 AND status = 'claimed'`,
    [row.id, row.org_id, row.client_id, JSON.stringify({ ...result, client_message: clip(result.client_message, CLIENT_MESSAGE_MAX) })]
  );
}

/**
 * runAgentTask(db, row, opts) → { outcome: 'done'|'in_progress'|'failed'|'skipped', turn? }
 * row: a money_agent_tasks row this agent claimed (claimAgentTask).
 * opts: { env, now, useAi, fallbackReason, agent, callModelFn, deps, engine, log, processTurnFn }
 * engine(db, row) → { ok, message? } — W7's sender for an APPROVED money row.
 */
export async function runAgentTask(db, row, {
  env = process.env, now = new Date(), useAi = true, fallbackReason = null, agent = null,
  callModelFn, deps = {}, engine = null, log = defaultLog, processTurnFn = processTurn
} = {}) {
  const todayIso = new Date(now).toISOString().slice(0, 10);
  if (!row || row.status !== "claimed") return { outcome: "skipped" };

  if (row.moves_money) {
    /* Money: only the engine moves it, with the row's own amount and accounts.
       W6 adds nothing and changes nothing. No engine → this row was never ours
       to claim (claimAgentTask leaves approved rows alone without one). */
    if (typeof engine !== "function") return { outcome: "skipped" };
    let r;
    try { r = await engine(db, row); } catch (err) { r = { ok: false, message: null, error: clip(err && err.message, 200) }; }
    const ok = !!(r && r.ok);
    await finishTask(db, row, {
      status: ok ? "done" : "failed",
      result: { client_message: ok ? (r.message || "Sent.") : (r && r.message) || FAIL_WORDS.engine_failed, engine_error: (r && r.error) || null },
      brain: "rules", todayIso, log
    });
    return { outcome: ok ? "done" : "failed" };
  }

  const who = agent || await loadAgent(db, { orgId: row.org_id });
  if (!helperIsOn(who)) {
    await finishTask(db, row, { status: "failed", result: { client_message: FAIL_WORDS.helper_off }, brain: "rules", todayIso, log });
    return { outcome: "failed" };
  }
  const state = await threadState(db, { orgId: row.org_id, clientId: row.client_id });
  if (state.halted_at) {
    await finishTask(db, row, { status: "failed", result: { client_message: FAIL_WORDS.helper_stopped }, brain: "rules", todayIso, log });
    return { outcome: "failed" };
  }

  // A turn on the helper thread, so the client sees what was done and by which brain.
  const turn = await insertTurn(db, {
    orgId: row.org_id, clientId: row.client_id, kind: "task",
    actor: row.requested_by_kind === "staff" ? "staff" : "client",
    staffId: row.requested_by_staff_id || null,
    input: `Do task: ${clip(row.title, 300)}`, taskId: row.id, status: "running"
  });
  const done = await processTurnFn(db, turn, { env, now, useAi, fallbackReason, agent: who, callModelFn, deps });

  if (!done || done.status === "failed") {
    await finishTask(db, row, { status: "failed", result: { client_message: FAIL_WORDS.turn_failed, turn_id: turn.id }, brain: "rules", todayIso, log });
    return { outcome: "failed", turn: done };
  }
  const acts = list(done.actions);
  const result = {
    client_message: done.reply,
    turn_id: turn.id,
    brain: done.brain,
    actions: acts.map((a) => ({ type: a.type, status: a.status }))
  };
  const kept = acts.some((a) => a.type === "mark_task_in_progress" && String(a.task_id) === String(row.id) && a.status === "done");
  if (kept) {
    await holdTask(db, row, { ...result, in_progress: true });
    return { outcome: "in_progress", turn: done };
  }
  await finishTask(db, row, { status: "done", result, brain: done.brain, todayIso, log });
  return { outcome: "done", turn: done };
}

/**
 * sweepAgentTasks(db, opts) → { ran, outcomes } — claim and work up to `max`
 * rows. opts as runAgentTask, plus max and an optional logLine for the runner.
 */
export async function sweepAgentTasks(db, { max = 5, engine = null, logLine = () => {}, ...opts } = {}) {
  const outcomes = [];
  for (let i = 0; i < max; i++) {
    const row = await claimAgentTask(db, { includeApproved: typeof engine === "function" });
    if (!row) break;
    logLine(`task ${String(row.id).slice(0, 8)} (${row.moves_money ? "money" : "no money"}) claimed`);
    const r = await runAgentTask(db, row, { ...opts, engine });
    outcomes.push({ id: row.id, outcome: r.outcome });
    logLine(`task ${String(row.id).slice(0, 8)} ${r.outcome}`);
  }
  return { ran: outcomes.length, outcomes };
}

export default runAgentTask;
