// The FinanceOS Money Helper's thread — turns, the queue, the bridge, and the
// writes the helper is allowed to make. The brain is src/finance/money-agent-ai.mjs;
// this file feeds it the client's records and carries out what it decided.
//
// Tables: db/migrations/465_money_helper_agent.sql. Endpoint: api/money/helper.mjs.
// Mac runner: src/finance/money-helper-runner.mjs (scripts/money-agent-run-queue.mjs).
//
// ONE TURN, START TO END
//   1. The client types (or presses Do task — src/finance/money-agent-tasks.mjs).
//      A row lands in money_helper_turns.
//   2. Who answers (routeTurn):
//        STOP / a lawyer / "a person"  → the rules brain, now. No model.
//        MONEY_HELPER_RUNNER=rules     → the rules brain, now.
//        MONEY_HELPER_RUNNER=server    → the AI, now, inside the request (the
//                                         API has credit); rules if it fails.
//        mac (default)                 → queued for the Mac runner while its
//                                         heartbeat is fresh; with the Mac off,
//                                         the rules brain answers now. A turn
//                                         left queued when the Mac stops is
//                                         answered by rules on the next read.
//   3. processTurn reads the client's records (readContext), asks the brain
//      (decideTurn), carries out the actions it allows (executeActions), writes
//      the answer on the turn, and logs it: agent_shadow_log gets the text the
//      helper WOULD have texted (it is shadow — nothing is ever texted), and
//      agent_runs gets one row per turn.
//
// WHAT IT MAY WRITE, AND NOTHING ELSE
//   reminders and plan steps   money_agent_pins (shows on the Plan, source 'agent')
//   CSM tasks                  tasks via createTask, source_workflow 'money-agent'
//                              (so the daily ladder holds its texts while a person has it)
//   task progress              money_agent_tasks.status → 'claimed' (W5's table, 464),
//                              a no-money agent row only
//   transfer PROPOSALS         W5's proposeTransfer (src/finance/money-transfer-seam.mjs):
//                              a money_agent_tasks row at needs_approval, nothing else
//   a STOP                     opt_outs (the same recordOptOut the SMS inbound path
//                              uses) + money_helper_threads
// It never moves money and never sends a text.
//
// Every query names org_id AND client_id.

import { moneyOverview } from "./money-overview.mjs";
import { allPins } from "./plan-sources/index.mjs";
import { listClarityPayments } from "./clarity-payments.mjs";
import { askForPerson as defaultAskForPerson } from "./money-agent.mjs";
import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { recordOptOut as defaultRecordOptOut } from "../lib/opt-out.mjs";
import { proposeTransfer as defaultProposeTransfer } from "./money-transfer-seam.mjs";
import { recordShadow as defaultRecordShadow, recordRun as defaultRecordRun } from "../agents/shadow-log.mjs";
import { byCode } from "../agents/registry.mjs";
import { callModel as defaultCallModel } from "../agents/model.mjs";
import { dollars, shortDate } from "../banking/card-due-reminders.mjs";
import {
  AGENT_CODE, AGENT_NAME, HELPER_PROMPT, HELPER_GUARDRAILS, BRAIN_AI,
  decideTurn, readRecentTurns, runnerMode, classifyInbound, addDaysIso
} from "./money-agent-ai.mjs";

export const BRIDGE_NAME = "money-helper-mac";
/** A heartbeat younger than this means the Mac runner is on. It beats every 15 s. */
export const BRIDGE_FRESH_MS = 60_000;
/** A queued turn older than this, with the Mac off, is answered by rules on the next read. */
export const ORPHAN_AFTER_MS = 20_000;
/** A running turn whose runner went quiet this long is taken back. */
export const STALE_RUNNING_MS = 10 * 60_000;
/** Model tries per turn before the rules brain answers it. */
export const MAX_ATTEMPTS = 2;
/** Turns one client may start in a day (UTC) — a guard against a runaway loop. */
export const DAILY_TURN_CAP = 60;
export const MAX_INPUT_CHARS = 2000;
/** The server path's model time limit, inside a web request. */
export const INLINE_AI_TIMEOUT_MS = 18_000;
/** Same source as src/finance/money-agent.mjs, so its ladder sees a person has it. */
export const TASK_SOURCE = "money-agent";
/** money_agent_tasks.claimed_by when the helper takes a "Do task" row. */
export const TASK_CLAIMER = "money-helper";

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const clip = (s, n) => (s == null ? null : String(s).replace(/\s+/g, " ").trim().slice(0, n));
const centsOrNull = (v) => (v === null || v === undefined || v === "" ? null : Number.isSafeInteger(Number(v)) ? Number(v) : null);

/* ═════════════════════════════════════════════════════════════════════════
   THE AGENT ROW
   ═════════════════════════════════════════════════════════════════════════ */

/** The FOS-01 row for this org, with the in-code prompt and guardrails as the
 *  fallback when the row holds none. A missing row is an agent that is off. */
export async function loadAgent(db, { orgId }) {
  let row = null;
  try { row = await byCode(db, { orgId, code: AGENT_CODE }); } catch { row = null; }
  if (!row) return { code: AGENT_CODE, name: AGENT_NAME, status: null, prompt: HELPER_PROMPT, guardrails: HELPER_GUARDRAILS, fromRow: false };
  const g = isObj(row.guardrails) && Object.keys(row.guardrails).length ? row.guardrails : HELPER_GUARDRAILS;
  return {
    code: row.code, name: row.name || AGENT_NAME, status: row.status,
    prompt: row.prompt && String(row.prompt).trim() ? row.prompt : HELPER_PROMPT,
    guardrails: g, fromRow: true
  };
}

/** Running means shadow or live. Shadow answers in the app and never texts. */
export function helperIsOn(agent) {
  return !!agent && (agent.status === "shadow" || agent.status === "live");
}

/* ═════════════════════════════════════════════════════════════════════════
   THE READS BEHIND ONE TURN — read only
   ═════════════════════════════════════════════════════════════════════════ */

const PIN_COLS = `id, purpose, pin_date::text AS date, kind, title, detail, amount_cents, status, turn_id`;

export async function readAgentPins(db, { orgId, clientId, from, to }) {
  const r = await db.query(
    `SELECT ${PIN_COLS} FROM money_agent_pins
      WHERE org_id = $1 AND client_id = $2 AND status <> 'cancelled'
        AND pin_date BETWEEN $3::date AND $4::date
      ORDER BY pin_date, created_at, id`,
    [orgId, clientId, from, to]
  );
  return r.rows.map((p) => ({ ...p, amount_cents: centsOrNull(p.amount_cents) }));
}

/* "Do task" rows — money_agent_tasks, owned by W5 (migration 464,
   docs/finance/money-agent-tasks.md). The helper sees only the rows it may
   work: assignee 'agent', no money (a money row is a proposal waiting on the
   client's own approval, never the helper's to touch), queued or already
   claimed. `why` is the row's own reason, read as the task's detail. */
const TASK_COLS = `id, task_key, kind, source, title, why AS detail, due_on::text AS due_on, amount_cents,
                   status, assignee, moves_money, to_kind, to_account_id, requested_by_kind,
                   requested_by_staff_id, claimed_by, created_at`;

export async function listOpenTasks(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT ${TASK_COLS} FROM money_agent_tasks
      WHERE org_id = $1 AND client_id = $2 AND assignee = 'agent' AND moves_money = false
        AND status IN ('queued', 'claimed')
      ORDER BY created_at, id`,
    [orgId, clientId]
  );
  return r.rows.map((t) => ({ ...t, amount_cents: centsOrNull(t.amount_cents) }));
}

export async function readTask(db, { orgId, clientId, taskId }) {
  if (!taskId) return null;
  const r = await db.query(
    `SELECT ${TASK_COLS} FROM money_agent_tasks WHERE id = $1 AND org_id = $2 AND client_id = $3`,
    [taskId, orgId, clientId]
  );
  const t = r.rows[0];
  return t ? { ...t, amount_cents: centsOrNull(t.amount_cents) } : null;
}

/**
 * readContext(db, { orgId, clientId, asOf, env, helperTables, extraReads }) →
 *   { today, asOf, overview, plans, pins, pinSources, agentPins, openTasks, extras } | null
 *
 * The same reads the money pages make: the overview (src/finance/money-overview.mjs),
 * the plan (src/finance/plan-sources/), Clarity plans (src/finance/clarity-payments.mjs),
 * plus the helper's own reminders and open tasks. helperTables:false skips the
 * two tables migration 465 adds — the role-play runs before 465 is on
 * production. extraReads: [{ name, read(db, args) }] — fundability and payment
 * strategy plug in here when their units land (a read that fails is left out).
 */
export async function readContext(db, { orgId, clientId, asOf = new Date(), env = process.env, helperTables = true, extraReads = [] } = {}) {
  const now = new Date(asOf);
  const today = now.toISOString().slice(0, 10);
  const to = addDaysIso(today, 45);
  /* One at a time on purpose: the role-play reads inside one READ ONLY
     transaction on one connection, where parallel queries only queue. */
  const overview = await moneyOverview(db, { orgId, clientId, env, asOf: now });
  if (!overview) return null;
  const plans = await listClarityPayments(db, { orgId, clientId, today });
  const plan = await allPins(db, { orgId, clientId, from: today, to, env, now, today, log: () => {} });
  const agentPins = helperTables ? await readAgentPins(db, { orgId, clientId, from: today, to }) : [];
  const openTasks = helperTables ? await listOpenTasks(db, { orgId, clientId }) : [];
  const extras = {};
  for (const r of list(extraReads)) {
    if (!r || typeof r.read !== "function" || !r.name) continue;
    try { extras[r.name] = await r.read(db, { orgId, clientId, asOf: now, env, today }); } catch { /* left out, never guessed */ }
  }
  return {
    today, asOf: now.toISOString(), overview, plans,
    pins: list(plan.pins).filter((p) => p.source !== "agent"), pinSources: plan.sources,
    agentPins, openTasks, extras
  };
}

/* ═════════════════════════════════════════════════════════════════════════
   THE THREAD
   ═════════════════════════════════════════════════════════════════════════ */

const TURN_COLS = `id, org_id, client_id, kind, actor, staff_id, input, task_id, status, reply, actions,
                   brain, model, reason, attempts, claimed_at, answered_at, created_at`;

export async function threadState(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT halted_at, halt_reason FROM money_helper_threads WHERE client_id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const row = r.rows[0];
  return { halted_at: row && row.halted_at ? new Date(row.halted_at).toISOString() : null, halt_reason: (row && row.halt_reason) || null };
}

export async function haltThread(db, { orgId, clientId, reason }) {
  await db.query(
    `INSERT INTO money_helper_threads (client_id, org_id, halted_at, halt_reason)
     VALUES ($1, $2, now(), $3)
     ON CONFLICT (client_id) DO UPDATE SET halted_at = COALESCE(money_helper_threads.halted_at, now()),
                                            halt_reason = COALESCE(money_helper_threads.halt_reason, EXCLUDED.halt_reason)`,
    [clientId, orgId, reason]
  );
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

export async function turnsToday(db, { orgId, clientId, now = new Date() }) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM money_helper_turns
      WHERE org_id = $1 AND client_id = $2 AND created_at >= $3::date`,
    [orgId, clientId, new Date(now).toISOString().slice(0, 10)]
  );
  return (r.rows[0] && r.rows[0].n) || 0;
}

export async function insertTurn(db, { orgId, clientId, kind, actor, staffId = null, input, taskId = null, status }) {
  const r = await db.query(
    `INSERT INTO money_helper_turns (org_id, client_id, kind, actor, staff_id, input, task_id, status, claimed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'running' THEN now() ELSE NULL END)
     RETURNING ${TURN_COLS}`,
    [orgId, clientId, kind, actor, staffId, clip(input, MAX_INPUT_CHARS), taskId, status]
  );
  return r.rows[0];
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

export async function beat(db, { detail = {} } = {}) {
  await db.query(
    `INSERT INTO agent_bridge_heartbeats (name, last_at, detail) VALUES ($1, now(), $2::jsonb)
     ON CONFLICT (name) DO UPDATE SET last_at = now(), detail = EXCLUDED.detail`,
    [BRIDGE_NAME, JSON.stringify(isObj(detail) ? detail : {})]
  );
}

/** The runner is stopping: say so at once, so the app answers with rules
 *  instead of queueing for a computer that just went away. */
export async function bridgeOff(db) {
  await db.query(
    `UPDATE agent_bridge_heartbeats SET last_at = now() - interval '1 hour' WHERE name = $1`,
    [BRIDGE_NAME]
  );
}

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
   CARRYING OUT WHAT THE BRAIN DECIDED
   ═════════════════════════════════════════════════════════════════════════
   Every action arrives already validated (validateAnswer or the rules brain).
   Each write is keyed <turn>:<n> so a turn run twice writes once. The label on
   each result is written HERE from the validated fields — never model text
   about what happened. */

const KIND_WORDS = {
  open_account: "Open an account", deposit: "Deposit", pay_down: "Pay down", apply: "Apply",
  due: "Payment", checkpoint: "Step", other: "Step"
};

export function actionLabel(a) {
  const amt = Number.isSafeInteger(a.amount_cents) ? ` · ${dollars(a.amount_cents)}` : "";
  switch (a.type) {
    case "create_reminder": return `Reminder for ${shortDate(a.date) || a.date}: ${a.title}${amt}`;
    case "schedule_pin": return `On your plan for ${shortDate(a.date) || a.date}: ${a.title}${amt}`;
    case "create_csm_task": return "Your client success manager has a task to reach out";
    case "mark_task_in_progress": return `Marked in progress: ${a.title || "your task"}`;
    case "propose_transfer": return `Transfer proposal: ${dollars(a.amount_cents)} to ${a.to_name}, from ${a.from_name} — needs your approval`;
    case "halt": return a.reason === "stop" ? "Texts stopped. The helper will not text you." : "The helper stopped. A person will follow up.";
    default: return KIND_WORDS[a.pin_kind] || "Done";
  }
}

/** The account type the overview read gave → W5's TransferDestination. */
const TO_KIND = { depository: "bank_account", credit: "card", loan: "loan" };

/**
 * executeActions(db, { orgId, clientId, turnId, todayIso, actor, staffId, actions, dry, deps }) → results
 * dry:true (the role-play) writes nothing and returns status 'would_do'.
 * deps: { createTask, askForPerson, proposeTransfer }.
 */
export async function executeActions(db, {
  orgId, clientId, turnId, todayIso, actor = "client", staffId = null, actions = [], dry = false, deps = {}
} = {}) {
  const createTask = deps.createTask || defaultCreateTask;
  const ask = deps.askForPerson || defaultAskForPerson;
  const propose = deps.proposeTransfer || defaultProposeTransfer;
  const out = [];
  let n = 0;
  for (const a of list(actions)) {
    n += 1;
    const key = `money-helper:${turnId}:${n}`;
    const base = { ...a, by: "agent", label: actionLabel(a) };
    if (dry) { out.push({ ...base, status: "would_do" }); continue; }
    try {
      if (a.type === "create_reminder" || a.type === "schedule_pin") {
        const r = await db.query(
          `INSERT INTO money_agent_pins (org_id, client_id, turn_id, purpose, pin_date, kind, title, detail, amount_cents, idempotency_key)
           VALUES ($1, $2, $3, $4, $5::date, $6, $7, $8, $9, $10)
           ON CONFLICT (idempotency_key) DO NOTHING
           RETURNING id`,
          [orgId, clientId, turnId, a.type === "create_reminder" ? "reminder" : "plan", a.date,
            a.pin_kind || "other", clip(a.title, 160), clip(a.detail, 500), a.amount_cents ?? null, key]
        );
        out.push({ ...base, status: "done", ref_id: (r.rows[0] && r.rows[0].id) || null });
      } else if (a.type === "create_csm_task") {
        if (a.ask_for_person) {
          const r = await ask(db, { orgId, clientId, todayIso, note: a.detail || null });
          out.push({ ...base, status: "done", ref_id: (r && r.taskId) || null });
        } else {
          const r = await createTask(db, {
            orgId, clientId,
            title: `Money helper: ${clip(a.title, 140)}`,
            sourceWorkflow: TASK_SOURCE,
            assigneeRole: "csm",
            eventId: key,
            body: a.detail ? `${key}\n${clip(a.detail, 500)}` : key
          });
          out.push({ ...base, status: "done", ref_id: (r && r.id) || null });
        }
      } else if (a.type === "mark_task_in_progress") {
        /* In progress, in W5's words, is 'claimed': the helper holds the row.
           Only a no-money agent row — a money row is a proposal that waits on
           the client's own approval (464 refuses a money row claimed without it). */
        const r = await db.query(
          `UPDATE money_agent_tasks
              SET status = 'claimed', claimed_by = COALESCE(claimed_by, $4), claimed_at = COALESCE(claimed_at, now())
            WHERE id = $1 AND org_id = $2 AND client_id = $3
              AND assignee = 'agent' AND moves_money = false AND status IN ('queued', 'claimed')
            RETURNING id`,
          [a.task_id, orgId, clientId, TASK_CLAIMER]
        );
        out.push({ ...base, status: r.rows[0] ? "done" : "skipped", ref_id: a.task_id });
      } else if (a.type === "propose_transfer") {
        /* A PROPOSAL, through W5's one seam (src/finance/money-transfer-seam.mjs):
           one money_agent_tasks row at needs_approval with the exact amount and
           where the money goes. Nothing moves; the client picks the account it
           comes from when they approve (W7). The account the helper named is
           kept in the row's detail as a suggestion only. */
        const toKind = TO_KIND[a.to_type] || null;
        const r = toKind ? await propose(db, {
          orgId, clientId,
          taskKey: `helper:${turnId}`,
          kind: toKind === "bank_account" ? "deposit" : "pay_down",
          title: `Move ${dollars(a.amount_cents)} to ${a.to_name}`,
          why: clip(a.reason, 300),
          dueOn: null,
          source: "money-helper",
          amountCents: a.amount_cents,
          toKind,
          toAccountId: a.to_account_id,
          requestedByKind: actor === "staff" ? "staff" : "client",
          requestedByStaffId: actor === "staff" ? staffId : null,
          detail: { by: "money-helper", turn_id: turnId, suggested_from_account_id: a.from_account_id, suggested_from_name: a.from_name }
        }) : { ok: false, reason: "bad_destination" };
        out.push(r && r.ok
          ? { ...base, status: r.status || "needs_approval", ref_id: r.proposalId || null }
          : { ...base, status: "failed", error: (r && r.reason) || "not_saved" });
      } else {
        out.push({ ...base, status: "skipped" });
      }
    } catch (err) {
      out.push({ ...base, status: "failed", error: clip(err && err.message ? err.message : err, 160) });
    }
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════
   ONE TURN, PROCESSED
   ═════════════════════════════════════════════════════════════════════════ */

async function markFailed(db, turn, reason) {
  const r = await db.query(
    `UPDATE money_helper_turns SET status = 'failed', reason = $2
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING ${TURN_COLS}`,
    [turn.id, clip(reason, 500)]
  );
  return r.rows[0] || { ...turn, status: "failed", reason };
}

/**
 * processTurn(db, turn, opts) → the turn row as written.
 * opts: { env, now, useAi, fallbackReason, agent, timeoutMs, callModelFn, deps }
 * deps: { createTask, askForPerson, proposeTransfer, recordOptOut, recordShadow, recordRun, readContext }.
 * The turn must be one this caller holds (status running).
 */
export async function processTurn(db, turn, {
  env = process.env, now = new Date(), useAi = true, fallbackReason = null, agent = null,
  timeoutMs, callModelFn = defaultCallModel, deps = {}
} = {}) {
  const recordShadow = deps.recordShadow || defaultRecordShadow;
  const recordRun = deps.recordRun || defaultRecordRun;
  const optOut = deps.recordOptOut || defaultRecordOptOut;
  const read = deps.readContext || readContext;
  const orgId = turn.org_id;
  const clientId = turn.client_id;
  const who = agent || await loadAgent(db, { orgId });

  let context;
  try {
    context = await read(db, { orgId, clientId, asOf: now, env });
  } catch (err) {
    return markFailed(db, turn, `context_failed: ${clip(err && err.message ? err.message : err, 200)}`);
  }
  if (!context) return markFailed(db, turn, "client_not_found");

  const thread = await readRecentTurns(db, { orgId, clientId, limit: 8, beforeId: turn.id }).catch(() => []);
  const task = turn.kind === "task" ? await readTask(db, { orgId, clientId, taskId: turn.task_id }) : null;

  const decision = await decideTurn({
    agent: who, context, thread, turn: { kind: turn.kind, input: turn.input, task },
    useAi, fallbackReason, callModelFn, env, timeoutMs
  });

  const results = await executeActions(db, {
    orgId, clientId, turnId: turn.id, todayIso: context.today, actor: turn.actor, staffId: turn.staff_id || null,
    actions: decision.actions, deps
  });
  if (decision.halt) {
    await haltThread(db, { orgId, clientId, reason: decision.halt });
    /* STOP is honoured the way the SMS inbound path honours it: an SMS opt-out
       through the one sanctioned writer (src/lib/opt-out.mjs). */
    if (decision.halt === "stop") await optOut(db, clientId, orgId, "sms", "money_helper");
    results.push({ type: "halt", by: "system", reason: decision.halt, status: "done", label: actionLabel({ type: "halt", reason: decision.halt }) });
  }

  const status = decision.halt ? "halted" : "answered";
  const factsForAudit = { facts: decision.facts, intent: decision.intent };
  const upd = await db.query(
    `UPDATE money_helper_turns
        SET status = $2, reply = $3, actions = $4::jsonb, brain = $5, model = $6, reason = $7,
            facts = $8::jsonb, answered_at = $9, claimed_at = COALESCE(claimed_at, $9)
      WHERE id = $1 AND status IN ('queued', 'running')
      RETURNING ${TURN_COLS}`,
    [turn.id, status, decision.reply, JSON.stringify(results), decision.brain, decision.model,
      clip(decision.reason, 500), JSON.stringify(factsForAudit), new Date(now).toISOString()]
  );
  const written = upd.rows[0] || null;

  /* The shadow log: the text the helper WOULD have sent. It is shadow, so it
     sent nothing — the answer shows in the app only. */
  const shadowReason = decision.halt ? "guardrail_halt" : who.status === "shadow" ? "shadow_status" : "in_app";
  await recordShadow(db, {
    orgId, agentCode: AGENT_CODE, clientId, channel: "in_app",
    inboundBody: turn.input, wouldSendBody: decision.reply,
    contextSnapshot: { turn_id: turn.id, kind: turn.kind, brain: decision.brain, model: decision.model, reason: decision.reason, actions: results.map((r) => r.type) },
    modelRequest: decision.ai.request, reason: shadowReason
  }).catch(() => null);
  if (decision.ai.raw && !decision.ai.ok) {
    await recordShadow(db, {
      orgId, agentCode: AGENT_CODE, clientId, channel: "in_app",
      inboundBody: turn.input, wouldSendBody: typeof decision.ai.raw.reply === "string" ? clip(decision.ai.raw.reply, 2000) : null,
      contextSnapshot: { turn_id: turn.id, problems: decision.ai.problems, actions: list(decision.ai.raw.actions).map((a) => a && a.type) },
      modelRequest: decision.ai.request, reason: "guardrail_block"
    }).catch(() => null);
  }
  await recordRun(db, {
    orgId, agentCode: AGENT_CODE, clientId,
    triggerEvent: turn.kind === "task" ? "money.helper.task" : "money.helper.message",
    eventId: turn.id, channel: "in_app", mode: who.status || null,
    outcome: decision.halt ? "halted" : decision.brain === BRAIN_AI ? "replied" : decision.ai.raw ? "blocked_then_rules" : "rules",
    detail: decision.reason
  });

  return written || { ...turn, status, reply: decision.reply, actions: results, brain: decision.brain, model: decision.model, reason: decision.reason };
}

/* ═════════════════════════════════════════════════════════════════════════
   WHO ANSWERS — the routing every new turn goes through
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * routeTurn(db, { orgId, clientId, kind, actor, staffId, input, taskId, intent, agent, env, now, deps, callModelFn })
 * → { turn, queued }
 */
export async function routeTurn(db, {
  orgId, clientId, kind, actor, staffId = null, input, taskId = null, intent = "question",
  agent, env = process.env, now = new Date(), deps = {}, callModelFn = defaultCallModel
}) {
  const mode = runnerMode(env);
  let useAi = false;
  let fallbackReason = null;
  let queue = false;
  if (intent === "stop" || intent === "legal" || intent === "person") {
    useAi = false;
  } else if (mode === "rules") {
    fallbackReason = "rules_mode";
  } else if (mode === "server") {
    useAi = true;
  } else {
    const b = await bridgeStatus(db, { now });
    if (b.on) queue = true;
    else fallbackReason = "bridge_off";
  }
  const turn = await insertTurn(db, { orgId, clientId, kind, actor, staffId, input, taskId, status: queue ? "queued" : "running" });
  if (queue) return { turn, queued: true };
  const done = await processTurn(db, turn, {
    env, now, useAi, fallbackReason, agent, timeoutMs: INLINE_AI_TIMEOUT_MS, callModelFn, deps
  });
  return { turn: done, queued: false };
}

/**
 * submitMessage(db, { orgId, clientId, input, actor, staffId, env, now, deps, callModelFn })
 * → { ok: true, turn, queued } | { ok: false, error, message }
 */
export async function submitMessage(db, { orgId, clientId, input, actor, staffId = null, env = process.env, now = new Date(), deps = {}, callModelFn } = {}) {
  const words = typeof input === "string" ? input.trim() : "";
  if (!words) return { ok: false, error: "message_required", message: "Type a message first." };
  if (words.length > MAX_INPUT_CHARS) return { ok: false, error: "message_too_long", message: `Keep it under ${MAX_INPUT_CHARS} characters.` };
  const agent = await loadAgent(db, { orgId });
  if (!helperIsOn(agent)) return { ok: false, error: "helper_off", message: "The money helper is not switched on." };
  const state = await threadState(db, { orgId, clientId });
  if (state.halted_at) {
    return { ok: false, error: "helper_stopped", message: "The money helper stopped here. A person from Fundhub will follow up." };
  }
  if ((await turnsToday(db, { orgId, clientId, now })) >= DAILY_TURN_CAP) {
    return { ok: false, error: "too_many", message: "That is a lot of messages for one day. Ask again tomorrow, or ask for a person." };
  }
  const intent = classifyInbound(words, agent.guardrails);
  const r = await routeTurn(db, { orgId, clientId, kind: "message", actor, staffId, input: words, intent, agent, env, now, deps, callModelFn });
  return { ok: true, turn: r.turn, queued: r.queued };
}

/**
 * answerOrphans(db, { orgId, clientId, env, now, deps }) — a turn still queued
 * after ORPHAN_AFTER_MS while the Mac runner is off gets the rules brain now,
 * so a client is never left on "Thinking…" forever. Returns how many.
 */
export async function answerOrphans(db, { orgId, clientId, env = process.env, now = new Date(), deps = {} } = {}) {
  if (runnerMode(env) !== "mac") return 0;
  const b = await bridgeStatus(db, { now });
  if (b.on) return 0;
  const cutoff = new Date(new Date(now).getTime() - ORPHAN_AFTER_MS).toISOString();
  const r = await db.query(
    `UPDATE money_helper_turns SET status = 'running', claimed_at = now()
      WHERE org_id = $1 AND client_id = $2 AND status = 'queued' AND created_at < $3
      RETURNING ${TURN_COLS}`,
    [orgId, clientId, cutoff]
  );
  const agent = r.rows.length ? await loadAgent(db, { orgId }) : null;
  for (const t of r.rows) {
    await processTurn(db, t, { env, now, useAi: false, fallbackReason: "bridge_off", agent, deps });
  }
  return r.rows.length;
}

/* ═════════════════════════════════════════════════════════════════════════
   THE QUEUE — what the Mac runner claims
   ═════════════════════════════════════════════════════════════════════════ */

export async function claimNextTurn(db) {
  const r = await db.query(
    `UPDATE money_helper_turns t
        SET status = 'running', claimed_at = now(), attempts = t.attempts + 1
      WHERE t.id = (SELECT id FROM money_helper_turns
                     WHERE status = 'queued'
                     ORDER BY created_at, id
                     LIMIT 1
                     FOR UPDATE SKIP LOCKED)
      RETURNING ${TURN_COLS}`
  );
  return r.rows[0] || null;
}

export async function requeueTurn(db, id) {
  const r = await db.query(
    `UPDATE money_helper_turns SET status = 'queued', claimed_at = NULL
      WHERE id = $1 AND status = 'running'
      RETURNING id`,
    [id]
  );
  return r.rows[0] || null;
}

/** Running turns whose runner went quiet: back to the queue, or — after
 *  MAX_ATTEMPTS model tries — handed back to be answered by rules. */
export async function reclaimStale(db, { now = new Date() } = {}) {
  const cutoff = new Date(new Date(now).getTime() - STALE_RUNNING_MS).toISOString();
  const back = await db.query(
    `UPDATE money_helper_turns SET status = 'queued', claimed_at = NULL
      WHERE status = 'running' AND claimed_at < $1 AND attempts < $2
      RETURNING id`,
    [cutoff, MAX_ATTEMPTS]
  );
  const giveUp = await db.query(
    `UPDATE money_helper_turns SET claimed_at = now()
      WHERE status = 'running' AND claimed_at < $1 AND attempts >= $2
      RETURNING ${TURN_COLS}`,
    [cutoff, MAX_ATTEMPTS]
  );
  return { requeued: back.rows.length, giveUp: giveUp.rows };
}

export default { submitMessage, routeTurn, processTurn, readThread, readContext, claimNextTurn, executeActions };
