// The money helper — Finance OS's in-house agent. Spec:
// docs/finance/client-finance-os-build-spec-2026-09-19.md §6, and the owner
// calls in docs/finance/finance-os-direction-2026-10-06.md.
//
// IT RUNS ON RULES until the API is funded (owner 2026-10-06: no AI spend yet).
// The decision is one pluggable function, `brain`: rulesBrain below, or the AI
// brain from src/finance/money-agent-ai.mjs when MONEY_HELPER_RUNNER=server —
// see BRAIN SEAM. This file never calls a model itself.
//
// WHAT IT LOOKS AT, once a day, for each client with Finance OS:
//   * Clarity Payments — installments a client owes Fundhub (443).
//   * Card bills already tracked (account_statement_cycles from Plaid) that are
//     PAST their due date with no payment on file. Reminders BEFORE a card's due
//     date are not this file's job: src/workflows/finance-os-card-due-reminders.mjs
//     sends those, and this file never repeats them.
//
// THE LADDER, one action per item per day (owner-set 2026-10-06):
//   due in 0-3 days  reminder text          (Clarity Payments only)
//   1 day late       late check-in text
//   3 days late      second check-in text
//   7 days late      CSM task — and no more texts about that item
// The highest rung reached wins. An item first seen 4 days late gets the
// second check-in, not a pile of the earlier ones.
//
// IT NEVER MOVES MONEY AND IT DOES NOT SEND. sendTemplated writes a `messages`
// row at status='queued'; the dispatcher is the only thing that hands it to a
// provider (CLAUDE.md §12). sendTemplated also refuses an opted-out client.
//
// CLAIM, THEN QUEUE — the order src/nudge/run.mjs uses. The money_agent_log row
// is written first. Its unique indexes are the caps: each rung of each item
// happens once, ever, and a client gets at most one text from the helper a day.
// A losing insert writes nothing and the item waits for tomorrow.
//
// STOP RULES (spec §6): opted out, or an escalation on file (a lawyer, a
// threat) → no texts; the row says "held". A Clarity Payment linked to an
// invoice is left to the AR ladder (src/workflows/ar-collections.mjs). A person
// already on it (an open money-agent CSM task) → no more texts.

import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { sendTemplated as defaultSend } from "../workflows/messaging.mjs";
import { providerCycles } from "../workflows/finance-os-card-due-reminders.mjs";
import { parseIsoDate, daysBetween } from "../banking/statement-cycles.mjs";
import { shortDate, dollars, cardLabel } from "../banking/card-due-reminders.mjs";
import { isoDay, planWords, logMoneyAction } from "./clarity-payments.mjs";
import { makeLadderBrain, runnerMode } from "./money-agent-ai.mjs";

export const SOURCE_WORKFLOW = "money-agent";
export const STAFF_TASK_ROLE = "csm";
export const KEY_PREFIX = "money-agent";

export const TEMPLATES = Object.freeze({
  reminder: "SMS-MONEY-AGENT-REMINDER",
  late_check_in: "SMS-MONEY-AGENT-LATE-1",
  second_check_in: "SMS-MONEY-AGENT-LATE-2"
});

/** The ladder. `from` is days late (negative = days before the due date). */
export const LADDER = Object.freeze([
  { rung: 0, action: "reminder", from: -3, texts: true },
  { rung: 1, action: "late_check_in", from: 1, texts: true },
  { rung: 2, action: "second_check_in", from: 3, texts: true },
  { rung: 3, action: "csm_task", from: 7, texts: false }
]);
export const FINAL_RUNG = LADDER[LADDER.length - 1].rung;

/** Which rung an item has reached today, or null. */
export function rungFor(daysLate) {
  if (!Number.isInteger(daysLate)) return null;
  let hit = null;
  for (const r of LADDER) {
    if (daysLate >= r.from) hit = r;
  }
  // The reminder only applies before or on the due date. Day 0 late is the due
  // day itself, which still reads as a reminder.
  if (hit && hit.rung === 0 && daysLate > 0) return null;
  return hit;
}

/* ═════════════════════════════════════════════════════════════════════════
   BRAIN SEAM
   ═════════════════════════════════════════════════════════════════════════
   A brain is (item, facts) → decision, sync or async.

     item   { kind: 'clarity_installment' | 'card_due', key, id, label, what,
              dueOn, daysLate, leftCents, doneRungs: Set<number>, linkedInvoice }
     facts  { optedOut, escalated, handedToPerson }
     decision
            { action: null, reason }                     nothing today
            { action, rung, reason, texts }              one ladder step
            { action: 'held', rung, reason }             a step we will not take

   The runner below — not the brain — owns the claim, the caps, the send and
   the task. So a brain can only ever pick from LADDER; it cannot send twice,
   text an opted-out client, or skip the CSM.

   THE AI BRAIN (wave 5, W6): makeLadderBrain() in src/finance/money-agent-ai.mjs.
   It keeps this signature, takes a third argument runForClient passes —
   { conn, orgId, clientId, todayIso } — so it can read what the client told
   the helper in the chat, and names itself per decision (decision.brain): its
   own id when it decided, "rules" when it fell back to rulesBrain because no
   model answered. pickBrain() returns it only when the API is funded
   (MONEY_HELPER_RUNNER=server); the daily clock runs on Netlify, where the Mac
   runner cannot reach it. */

/** The rules brain. Pure: no database, no clock. */
export function rulesBrain(item = {}, facts = {}) {
  if (!(item.leftCents > 0)) return { action: null, reason: "paid" };
  if (item.linkedInvoice) return { action: null, reason: "invoice_owned_by_ar_ladder" };
  const step = rungFor(item.daysLate);
  if (!step) return { action: null, reason: "not_yet" };
  if (item.kind === "card_due" && step.rung === 0) {
    return { action: null, reason: "card_reminder_sent_by_card_due_texts" };
  }
  const done = item.doneRungs instanceof Set ? item.doneRungs : new Set();
  for (const r of done) {
    if (r >= step.rung) return { action: null, reason: "already_done" };
  }
  if (step.texts) {
    if (facts.optedOut) return { action: "held", rung: step.rung, reason: "opted_out" };
    if (facts.escalated) return { action: "held", rung: step.rung, reason: "escalation_on_file" };
    if (facts.helperStopped) return { action: "held", rung: step.rung, reason: "helper_stopped" };
    if (facts.handedToPerson) return { action: "held", rung: step.rung, reason: "a_person_has_this" };
  }
  const why = item.daysLate > 0 ? `${item.daysLate} days late` : item.daysLate === 0 ? "due today" : `due in ${-item.daysLate} days`;
  return { action: step.action, rung: step.rung, reason: why, texts: step.texts };
}
rulesBrain.brainId = "rules";

/** Which brain runs: the AI brain when the API is funded
 *  (MONEY_HELPER_RUNNER=server), else rules. Either way the runner below owns
 *  the claim, the caps, the send and the task. */
export function pickBrain(env = process.env) {
  return runnerMode(env) === "server" ? makeLadderBrain({ rules: rulesBrain, env }) : rulesBrain;
}

/* ───────────────────────── items ───────────────────────── */

/** idempotency key for one rung of one item. Built only from facts that do not
    move, so a retry, a second scheduler or tomorrow's pass find the same key. */
export function keyFor(itemKey, rung, held = null) {
  return `${KEY_PREFIX}:${itemKey}:${rung}${held ? `:held:${held}` : ""}`;
}

/** The rungs already taken, per item key, read back from the log's own keys. */
export function doneRungsFrom(keys = []) {
  const out = new Map();
  for (const k of keys) {
    const m = /^money-agent:(.+):(\d)$/.exec(String(k || ""));
    if (!m) continue;
    if (!out.has(m[1])) out.set(m[1], new Set());
    out.get(m[1]).add(Number(m[2]));
  }
  return out;
}

/** Open Clarity installments due within 3 days or already late. */
export async function clarityItems(conn, { orgId, clientId, todayIso }) {
  const r = await conn.query(
    `SELECT i.id, i.seq, i.due_on::text AS due_on, i.amount_cents, i.paid_cents,
            p.id AS plan_id, p.kind, p.owed_to, p.label, p.invoice_id
       FROM clarity_payment_installments i
       JOIN clarity_payments p ON p.id = i.clarity_payment_id
      WHERE p.org_id = $1 AND p.client_id = $2 AND p.status = 'open'
        AND i.paid_cents < i.amount_cents
        AND i.due_on <= ($3::date + 3)
      ORDER BY i.due_on, i.seq`,
    [orgId, clientId, todayIso]
  );
  return r.rows.map((x) => {
    const dueOn = isoDay(x.due_on);
    const left = Number(x.amount_cents) - Number(x.paid_cents);
    const what = planWords(x);
    return {
      kind: "clarity_installment",
      key: `clarity_installment:${x.id}`,
      id: x.id,
      label: `${what} — payment ${x.seq}`,
      what,
      dueOn,
      daysLate: dueOn ? -daysBetween(todayIso, dueOn) : null,
      leftCents: left,
      linkedInvoice: !!x.invoice_id
    };
  });
}

/** cardLateItem(row, today) — a Plaid card whose due date has passed with no
 *  payment on file since the last statement. Same "payment on file" test as
 *  src/banking/card-due-reminders.mjs planCardDue, so the two never disagree. */
export function cardLateItem(row = {}, todayIso) {
  const raw = row.raw && typeof row.raw === "object" ? row.raw : {};
  const dueOn = parseIsoDate(raw.next_payment_due_date) ? raw.next_payment_due_date : null;
  if (!dueOn || !parseIsoDate(todayIso)) return null;
  const daysLate = -daysBetween(todayIso, dueOn);
  if (daysLate < 1) return null;
  const minCents = row.minimum_payment_cents === null || row.minimum_payment_cents === undefined ? null : Number(row.minimum_payment_cents);
  const stmtCents = row.last_statement_balance_cents === null || row.last_statement_balance_cents === undefined ? null : Number(row.last_statement_balance_cents);
  if (minCents === 0 || (stmtCents !== null && stmtCents <= 0)) return null;
  const plaidStmt = raw.plaid && parseIsoDate(raw.plaid.last_statement_issue_date) ? raw.plaid.last_statement_issue_date : null;
  const stmtDate = plaidStmt || isoDay(row.last_statement_date);
  const paidOn = parseIsoDate(raw.last_payment_date) ? raw.last_payment_date : null;
  if (paidOn && stmtDate && daysBetween(stmtDate, paidOn) >= 0) return null;
  const label = cardLabel(row);
  return {
    kind: "card_due",
    key: `card_due:${row.bank_account_id}:${dueOn}`,
    id: row.bank_account_id,
    label,
    what: `${label} card`,
    dueOn,
    daysLate,
    // Unknown minimum stays unknown; the ladder still runs on a known late bill.
    leftCents: minCents === null ? 1 : minCents,
    amountCents: minCents,
    linkedInvoice: false
  };
}

async function clientFacts(conn, { orgId, clientId }) {
  /* helper_stopped: the client said STOP or named a lawyer in the money
     helper's chat (money_helper_threads, migration 465). The chat helper stops
     there, and so do these texts. */
  const r = await conn.query(
    `SELECT
       EXISTS (SELECT 1 FROM opt_outs o WHERE o.client_id = $2 AND o.channel = 'sms' AND o.opted_in_at IS NULL) AS opted_out,
       EXISTS (SELECT 1 FROM client_escalations e WHERE e.client_id = $2) AS escalated,
       EXISTS (SELECT 1 FROM money_helper_threads h WHERE h.org_id = $1 AND h.client_id = $2
                AND h.halted_at IS NOT NULL) AS helper_stopped,
       EXISTS (SELECT 1 FROM tasks t WHERE t.org_id = $1 AND t.client_id = $2
                AND t.source_workflow = $3 AND t.done = false) AS handed`,
    [orgId, clientId, SOURCE_WORKFLOW]
  );
  const row = r.rows[0] || {};
  return { optedOut: !!row.opted_out, escalated: !!row.escalated, helperStopped: !!row.helper_stopped, handedToPerson: !!row.handed };
}

async function loggedKeys(conn, { orgId, clientId }) {
  const r = await conn.query(
    `SELECT idempotency_key FROM money_agent_log
      WHERE org_id = $1 AND client_id = $2 AND idempotency_key LIKE 'money-agent:%'`,
    [orgId, clientId]
  );
  return r.rows.map((x) => x.idempotency_key);
}

/* ───────────────────────── one client ───────────────────────── */

/**
 * runForClient(conn, { orgId, clientId, todayIso, brain, send, createTask })
 * → tally. Exported so the sweeper and tests can drive one client.
 */
export async function runForClient(conn, {
  orgId, clientId, todayIso,
  brain = pickBrain(), send = defaultSend, createTask = defaultCreateTask
} = {}) {
  const out = { items: 0, decided: 0, queued: 0, notQueued: [], tasks: 0, held: 0, waiting: 0, actions: [] };
  const facts = await clientFacts(conn, { orgId, clientId });
  const done = doneRungsFrom(await loggedKeys(conn, { orgId, clientId }));
  const cards = (await providerCycles(conn, { orgId, clientId }))
    .map((row) => cardLateItem(row, todayIso))
    .filter(Boolean);
  const items = [...(await clarityItems(conn, { orgId, clientId, todayIso })), ...cards]
    // Most late first: if only one text fits today, it is about the oldest bill.
    .sort((a, b) => (b.daysLate ?? -99) - (a.daysLate ?? -99));
  out.items = items.length;
  const brainId = brain.brainId || "rules";

  for (const item of items) {
    item.doneRungs = done.get(item.key) || new Set();
    const d = await brain(item, facts, { conn, orgId, clientId, todayIso });
    if (!d || !d.action) continue;
    const step = LADDER.find((r) => r.rung === d.rung);
    if (!step || (d.action !== "held" && d.action !== step.action)) continue; // a brain may only pick a real rung
    out.decided += 1;

    const held = d.action === "held";
    const texts = !held && step.texts;
    const key = keyFor(item.key, step.rung, held ? d.reason : null);
    const claim = await logMoneyAction(conn, {
      orgId, clientId,
      itemKind: item.kind, itemId: item.id, itemLabel: item.label,
      decidedOn: todayIso,
      // Which brain decided THIS step: a brain that fell back names "rules".
      action: d.action, actor: "agent", brain: d.brain || brainId,
      reason: held ? d.reason : `${step.action}: ${d.reason}`,
      textsClient: texts,
      templateKey: texts ? TEMPLATES[step.action] : null,
      amountCents: item.amountCents ?? item.leftCents ?? null,
      idempotencyKey: key,
      detail: { due_on: item.dueOn, days_late: item.daysLate, rung: step.rung, ...(d.note ? { brain_note: String(d.note).slice(0, 200) } : {}) }
    });
    if (!claim.created) { out.waiting += 1; continue; }
    out.actions.push({ key, action: d.action });

    if (held) { out.held += 1; continue; }

    if (step.action === "csm_task") {
      const task = await createTask(conn, {
        orgId, clientId,
        title: `Late payment: ${item.what} (${item.daysLate} days)`,
        sourceWorkflow: SOURCE_WORKFLOW,
        assigneeRole: STAFF_TASK_ROLE,
        body: key,
        eventId: key
      });
      if (task?.id) await conn.query(`UPDATE money_agent_log SET task_id = $2 WHERE id = $1`, [claim.id, task.id]);
      out.tasks += 1;
      continue;
    }

    const amount = item.kind === "card_due" ? item.amountCents : item.leftCents;
    const sent = await send(conn, {
      orgId, clientId, channel: "sms",
      templateKey: TEMPLATES[step.action],
      eventId: key,
      context: {
        money: {
          what: item.what,
          amount_phrase: amount === null || amount === undefined ? "" : ` of ${dollars(amount)}`,
          due: shortDate(item.dueOn) || item.dueOn
        }
      }
    });
    const status = sent?.sent ? "queued" : (sent?.reason || "not_sent");
    await conn.query(`UPDATE money_agent_log SET message_status = $2 WHERE id = $1`, [claim.id, status]);
    if (sent?.sent) out.queued += 1;
    else out.notQueued.push({ key, reason: status });
  }
  return out;
}

/**
 * askForPerson — the client tapped "Talk to a person". One CSM task per client
 * per day, and the helper stops texting while it is open.
 */
export async function askForPerson(conn, { orgId, clientId, todayIso, note = null, createTask = defaultCreateTask }) {
  const key = `${KEY_PREFIX}:asked:${clientId}:${todayIso}`;
  const task = await createTask(conn, {
    orgId, clientId,
    title: "Client asked for a person (Money page)",
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: STAFF_TASK_ROLE,
    body: note ? `${key}\n${String(note).slice(0, 500)}` : key,
    eventId: key
  });
  const log = await logMoneyAction(conn, {
    orgId, clientId, itemKind: "client", itemId: clientId, itemLabel: "Talk to a person",
    decidedOn: todayIso, action: "asked_for_person", actor: "client",
    reason: "client asked for a person", idempotencyKey: key
  });
  if (log.created && task?.id) {
    await conn.query(`UPDATE money_agent_log SET task_id = $2 WHERE id = $1`, [log.id, task.id]);
  }
  return { ok: true, created: !!task?.created || log.created, taskId: task?.id ?? null };
}

export default { rulesBrain, pickBrain, runForClient, askForPerson, rungFor, cardLateItem, LADDER, TEMPLATES };
